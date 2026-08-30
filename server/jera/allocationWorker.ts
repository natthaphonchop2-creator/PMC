import { createHash } from 'node:crypto'
import { buildItemTypeMetadata } from './allocation.js'
import { JeraReadError } from './client.js'
import type { JeraNormalizedRow, JeraReadPort } from './contracts.js'
import { JERA_ALLOCATION_STORE_LEASE_KEY, type JeraAllocationLease, type JeraAllocationLeasePort } from './allocationLeaseStore.js'
import {
  buildCachedPaymentDetail,
  jeraAllocationDayKey,
  type JeraAllocationCoverage,
  type JeraAllocationRunSession,
  type JeraAllocationStore,
  type JeraCachedPaymentDetail,
} from './allocationStore.js'
import {
  enqueueJeraAllocationTaskGeneration,
  MAX_JERA_ALLOCATION_ATTEMPT,
  type JeraAllocationTaskQueuePort,
} from './allocationTaskQueue.js'
import { jeraCacheKey } from './cacheKey.js'
import { normalizePaymentDetail } from './normalize.js'
import type { JeraReportStore } from './store.js'

export const JERA_ALLOCATION_WORKER_MAX_RUN_MS = 240_000
export const JERA_ALLOCATION_LEASE_TTL_MS = 270_000
export const JERA_ALLOCATION_LEASE_RENEW_WINDOW_MS = 90_000
export const JERA_ALLOCATION_MUTATION_MIN_LEASE_MS = 60_000
const JERA_ALLOCATION_REQUEST_RESERVE_MS = 10_000

export interface JeraAllocationWorker {
  run(input: {
    branchUuid: string
    eventDate: string
    paymentSetHash: string
    metadataSnapshotHash: string
    cursor: number
    attempt: number
    workerId: string
  }): Promise<{ status: 'COMPLETE' | 'CONTINUED' | 'SKIPPED'; processed: number; nextCursor: number | null }>
}

export function createJeraAllocationWorker(options: {
  client: JeraReadPort
  reportStore: JeraReportStore
  allocationStore: JeraAllocationStore
  lease: JeraAllocationLeasePort
  queue: JeraAllocationTaskQueuePort
  maxDetailsPerRun: number
  continuationDelaySeconds: number
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
}): JeraAllocationWorker {
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  if (!Number.isSafeInteger(options.maxDetailsPerRun) || options.maxDetailsPerRun < 1 || options.maxDetailsPerRun > 20
    || !Number.isSafeInteger(options.continuationDelaySeconds) || options.continuationDelaySeconds < 60) {
    throw new Error('JERA_ALLOCATION_WORKER_INVALID_CONFIG')
  }

  return {
    async run(input) {
      validateRunInput(input)
      const startedAt = now()
      const deadline = startedAt.getTime() + JERA_ALLOCATION_WORKER_MAX_RUN_MS
      const coverageDayKey = jeraAllocationDayKey(input.branchUuid, input.eventDate)
      const leaseKey = JERA_ALLOCATION_STORE_LEASE_KEY
      const claimed = await options.lease.claim({
        dayKey: leaseKey, owner: input.workerId, now: instant(startedAt), ttlMs: JERA_ALLOCATION_LEASE_TTL_MS,
      })
      if (claimed === null) throw new Error('JERA_ALLOCATION_LEASE_BUSY')
      if (!validClaim(claimed, leaseKey, input.workerId)) return skipped()
      let lease = claimed
      try {
        const runSession: JeraAllocationRunSession = await options.allocationStore.openRunSession()
        const existingCoverage = await runSession.getCoverage(coverageDayKey)

        async function assertLeaseForMutation(): Promise<void> {
          const checkedAt = now()
          const remaining = Date.parse(lease.expiresAt) - checkedAt.getTime()
          if (!Number.isFinite(remaining) || remaining <= 0) leaseLost()
          if (remaining <= JERA_ALLOCATION_LEASE_RENEW_WINDOW_MS) {
            const renewed = await options.lease.renew(lease, {
              now: instant(checkedAt), ttlMs: JERA_ALLOCATION_LEASE_TTL_MS,
            })
            if (!validClaim(renewed, leaseKey, input.workerId)) leaseLost()
            lease = renewed
          }
          const mutationAt = now()
          if (Date.parse(lease.expiresAt) - mutationAt.getTime() <= JERA_ALLOCATION_MUTATION_MIN_LEASE_MS) leaseLost()
          if (!await options.lease.assertCurrent(lease, instant(mutationAt))) leaseLost()
        }

        async function fencedMutation<T>(operation: () => Promise<T>): Promise<T> {
          await assertLeaseForMutation()
          const result = await operation()
          if (!await options.lease.assertCurrent(lease, instant(now()))) leaseLost()
          return result
        }

        async function saveCoverage(value: JeraAllocationCoverage): Promise<void> {
          await fencedMutation(async () => {
            value.leaseOwner = lease.owner
            value.leaseExpiresAt = lease.expiresAt
            value.leaseFencingToken = lease.fencingToken
            await runSession.saveCoverage(value)
          })
        }

        async function persistDetail(detail: JeraCachedPaymentDetail, value: JeraAllocationCoverage): Promise<void> {
          await fencedMutation(async () => {
            value.leaseOwner = lease.owner
            value.leaseExpiresAt = lease.expiresAt
            value.leaseFencingToken = lease.fencingToken
            await runSession.persistPaymentDetail({ detail, coverage: value })
          })
        }

        const filters = { branchUuid: input.branchUuid, startDate: input.eventDate, endDate: input.eventDate }
        let snapshots: Awaited<ReturnType<JeraReportStore['readSnapshots']>>
        try {
          snapshots = await options.reportStore.readSnapshots([
            { reportType: 'PAYMENT', filters }, { reportType: 'PRODUCT_SALES', filters },
          ])
        } catch {
          const retryCursor = coverageMatches(existingCoverage, input.paymentSetHash, input.metadataSnapshotHash) ? existingCoverage.cursor : 0
          const taskAttempt = await enqueue(input.paymentSetHash, input.metadataSnapshotHash, retryCursor,
            previousTaskAttempt(input.attempt, existingCoverage), options.continuationDelaySeconds)
          if (existingCoverage?.status === 'INCOMPLETE') {
            existingCoverage.taskAttempt = taskAttempt
            await saveCoverage(existingCoverage)
          }
          return { status: 'CONTINUED', processed: 0, nextCursor: retryCursor }
        }
        const [paymentSnapshot, productSnapshot] = snapshots
        if (!paymentSnapshot || !productSnapshot) {
          const retryCursor = coverageMatches(existingCoverage, input.paymentSetHash, input.metadataSnapshotHash) ? existingCoverage.cursor : 0
          const taskAttempt = await enqueue(input.paymentSetHash, input.metadataSnapshotHash, retryCursor,
            previousTaskAttempt(input.attempt, existingCoverage), options.continuationDelaySeconds)
          if (existingCoverage?.status === 'INCOMPLETE') {
            existingCoverage.taskAttempt = taskAttempt
            await saveCoverage(existingCoverage)
          }
          return { status: 'CONTINUED', processed: 0, nextCursor: retryCursor }
        }
        const payments = exactDayPayments(paymentSnapshot.rows, input.branchUuid, input.eventDate)
        const currentPaymentSetHash = paymentSetHash(payments)
        const productSalesRows = productSnapshot.rows.filter((row) => row.reportType === 'PRODUCT_SALES'
          && row.branchUuid === input.branchUuid && row.eventDate === input.eventDate)
        const metadata = buildItemTypeMetadata(productSalesRows.map((row) => ({
          itemCode: row.itemCode, type: row.type, sourceHash: row.sourceHash,
        })))
        const currentMetadataSnapshotHash = metadata.snapshotHash
        const sourceEvidence = {
          paymentCacheKey: jeraCacheKey('PAYMENT', filters), productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', filters),
          productSalesRowCount: productSalesRows.length,
          paymentLastSuccessAt: validInstantOrNull(paymentSnapshot.state?.lastSuccessAt ?? null),
          productSalesLastSuccessAt: validInstantOrNull(productSnapshot.state?.lastSuccessAt ?? null),
        }
        if (!sourceEvidence.paymentLastSuccessAt || !sourceEvidence.productSalesLastSuccessAt) {
          const retryCursor = coverageMatches(existingCoverage, currentPaymentSetHash, currentMetadataSnapshotHash) ? existingCoverage.cursor : 0
          const incomplete = coverageMatches(existingCoverage, currentPaymentSetHash, currentMetadataSnapshotHash)
            ? { ...existingCoverage, ...sourceEvidence, metadataSnapshotHash: metadata.snapshotHash, status: 'INCOMPLETE' as const,
                safeErrorCode: 'JERA_ALLOCATION_SOURCE_INCOMPLETE', leaseOwner: lease.owner, leaseExpiresAt: lease.expiresAt,
                leaseFencingToken: lease.fencingToken }
            : { ...coverageBase({
                input, lease, paymentSetHash: currentPaymentSetHash, paymentRowCount: payments.length,
                metadataSnapshotHash: metadata.snapshotHash, sourceEvidence, cursor: retryCursor, successfulDetailCount: 0,
              }), safeErrorCode: 'JERA_ALLOCATION_SOURCE_INCOMPLETE' }
          incomplete.taskAttempt = await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, retryCursor,
            currentPaymentSetHash === input.paymentSetHash && currentMetadataSnapshotHash === input.metadataSnapshotHash
              ? previousTaskAttempt(input.attempt, existingCoverage) : -1,
            options.continuationDelaySeconds)
          await saveCoverage(incomplete)
          return { status: 'CONTINUED', processed: 0, nextCursor: retryCursor }
        }
        if (coverageMatches(existingCoverage, input.paymentSetHash, input.metadataSnapshotHash)
          && input.paymentSetHash === currentPaymentSetHash && input.metadataSnapshotHash === currentMetadataSnapshotHash
          && existingCoverage.status === 'COMPLETE') return skipped()
        const read = await runSession.readDay({
          branchUuid: input.branchUuid, eventDate: input.eventDate, paymentSetHash: currentPaymentSetHash,
        })

        if (currentPaymentSetHash !== input.paymentSetHash || currentMetadataSnapshotHash !== input.metadataSnapshotHash) {
          const reset = coverageBase({
            input, lease, paymentSetHash: currentPaymentSetHash, paymentRowCount: payments.length,
            metadataSnapshotHash: metadata.snapshotHash, sourceEvidence, cursor: 0, successfulDetailCount: matchingCount(read.details, payments),
          })
          reset.taskAttempt = await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, 0, -1, options.continuationDelaySeconds)
          await saveCoverage(reset)
          return { status: 'CONTINUED', processed: 0, nextCursor: 0 }
        }

        const coverage = coverageMatches(read.coverage, currentPaymentSetHash, currentMetadataSnapshotHash)
          ? { ...read.coverage }
          : coverageBase({
              input, lease, paymentSetHash: currentPaymentSetHash, paymentRowCount: payments.length,
              metadataSnapshotHash: metadata.snapshotHash, sourceEvidence,
              cursor: contiguousCursor(read.details, payments), successfulDetailCount: matchingCount(read.details, payments),
            })
        let cursor = Math.min(coverage.cursor, payments.length)
        let processed = 0
        let examined = 0
        let details = [...read.details]
        let previousAttemptAt = coverage.lastAttemptAt ? Date.parse(coverage.lastAttemptAt) : null

        while (cursor < payments.length && examined < options.maxDetailsPerRun) {
          if (now().getTime() >= deadline) {
            coverage.taskAttempt = await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, cursor,
              previousTaskAttempt(input.attempt, coverage), options.continuationDelaySeconds)
            await saveCoverage(coverage)
            return { status: 'CONTINUED', processed, nextCursor: cursor }
          }
          const payment = payments[cursor]!
          examined += 1
          if (hasCurrentDetail(details, payment)) {
            cursor += 1
            Object.assign(coverage, completionFields({ cursor, payments, details, metadataHash: metadata.snapshotHash, sourceEvidence, lease, now: now() }))
            await saveCoverage(coverage)
            continue
          }

          if (previousAttemptAt !== null) {
            const delay = previousAttemptAt + 3_000 - now().getTime()
            if (now().getTime() + Math.max(0, delay) + JERA_ALLOCATION_REQUEST_RESERVE_MS > deadline) {
              coverage.taskAttempt = await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, cursor,
                previousTaskAttempt(input.attempt, coverage), options.continuationDelaySeconds)
              await saveCoverage(coverage)
              return { status: 'CONTINUED', processed, nextCursor: cursor }
            }
            if (delay > 0) await sleep(delay)
          } else if (now().getTime() + JERA_ALLOCATION_REQUEST_RESERVE_MS > deadline) {
            coverage.taskAttempt = await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, cursor,
              previousTaskAttempt(input.attempt, coverage), options.continuationDelaySeconds)
            await saveCoverage(coverage)
            return { status: 'CONTINUED', processed, nextCursor: cursor }
          }
          const attemptedAt = now()
          previousAttemptAt = attemptedAt.getTime()
          coverage.lastAttemptAt = instant(attemptedAt)
          coverage.safeErrorCode = null
          coverage.leaseOwner = lease.owner
          coverage.leaseExpiresAt = lease.expiresAt
          await saveCoverage(coverage)
          processed += 1

          try {
            const rows = await options.client.request('PAYMENT_DETAIL', { paymentUuid: payment.sourceUuid } as never)
            if (rows.length !== 1) throw new JeraReadError('JERA_SCHEMA_INVALID')
            const detail = normalizePaymentDetail(rows[0], {
              cacheKey: `PAYMENT_DETAIL:${payment.sourceUuid}`,
              branchUuid: input.branchUuid,
              fetchedAt: instant(now()),
              startDate: input.eventDate,
              endDate: input.eventDate,
            })
            if (detail.sourceUuid !== payment.sourceUuid || detail.eventDate !== input.eventDate) throw new JeraReadError('JERA_SCHEMA_INVALID')
            const cached = buildCachedPaymentDetail({ branchUuid: input.branchUuid, paymentSourceHash: payment.sourceHash, detail })
            const nextDetails = [...details.filter((stored) => stored.paymentUuid !== cached.paymentUuid), cached]
            const nextCursor = cursor + 1
            Object.assign(coverage, completionFields({ cursor: nextCursor, payments, details: nextDetails, metadataHash: metadata.snapshotHash, sourceEvidence, lease, now: now() }))
            await persistDetail(cached, coverage)
            details = nextDetails
            cursor = nextCursor
          } catch (error) {
            if (isLeaseLost(error)) throw error
            const code = safeProviderCode(error)
            coverage.safeErrorCode = code
            coverage.status = 'INCOMPLETE'
            coverage.cursor = cursor
            coverage.successfulDetailCount = matchingCount(details, payments)
            await saveCoverage(coverage)
            const retryAfter = error instanceof JeraReadError ? error.retryAfterSeconds ?? 0 : 0
            coverage.taskAttempt = await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, cursor,
              previousTaskAttempt(input.attempt, coverage), Math.max(options.continuationDelaySeconds, retryAfter))
            await saveCoverage(coverage)
            return { status: 'CONTINUED', processed: processed - 1, nextCursor: cursor }
          }
        }

        if (cursor >= payments.length) {
          if (coverage.status !== 'COMPLETE') {
            Object.assign(coverage, completionFields({ cursor, payments, details, metadataHash: metadata.snapshotHash, sourceEvidence, lease, now: now() }))
            await saveCoverage(coverage)
          }
          return { status: 'COMPLETE', processed, nextCursor: null }
        }
        coverage.taskAttempt = await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, cursor,
          previousTaskAttempt(input.attempt, coverage), options.continuationDelaySeconds)
        await saveCoverage(coverage)
        return { status: 'CONTINUED', processed, nextCursor: cursor }

        async function enqueue(
          hash: string,
          metadataHash: string,
          nextCursor: number,
          previousAttempt: number,
          delaySeconds: number,
        ): Promise<number> {
          const guardedQueue: JeraAllocationTaskQueuePort = {
            enqueue(task) {
              return fencedMutation(() => options.queue.enqueue(task))
            },
          }
          const result = await enqueueJeraAllocationTaskGeneration(guardedQueue, {
            branchUuid: input.branchUuid, eventDate: input.eventDate, paymentSetHash: hash,
            metadataSnapshotHash: metadataHash, cursor: nextCursor, previousTaskAttempt: previousAttempt,
            scheduleAt: new Date(now().getTime() + delaySeconds * 1_000),
          })
          return result.taskAttempt
        }
      } finally {
        await options.lease.release(lease)
      }
    },
  }
}

function completionFields(input: {
  cursor: number
  payments: JeraNormalizedRow[]
  details: JeraCachedPaymentDetail[]
  metadataHash: string
  sourceEvidence: SourceEvidence
  lease: JeraAllocationLease
  now: Date
}): Partial<JeraAllocationCoverage> {
  const complete = input.cursor >= input.payments.length && matchingCount(input.details, input.payments) === input.payments.length
  return {
    cursor: input.cursor, paymentRowCount: input.payments.length, successfulDetailCount: matchingCount(input.details, input.payments),
    metadataSnapshotHash: input.metadataHash, ...input.sourceEvidence, status: complete ? 'COMPLETE' : 'INCOMPLETE',
    lastSuccessAt: instant(input.now), safeErrorCode: null, leaseOwner: input.lease.owner, leaseExpiresAt: input.lease.expiresAt,
    leaseFencingToken: input.lease.fencingToken,
  }
}

interface SourceEvidence {
  paymentCacheKey: string
  productSalesCacheKey: string
  productSalesRowCount: number
  paymentLastSuccessAt: string | null
  productSalesLastSuccessAt: string | null
}

function coverageBase(input: {
  input: { branchUuid: string; eventDate: string; attempt: number }
  lease: JeraAllocationLease
  paymentSetHash: string
  paymentRowCount: number
  metadataSnapshotHash: string
  sourceEvidence: SourceEvidence
  cursor: number
  successfulDetailCount: number
}): JeraAllocationCoverage {
  return {
    dayKey: jeraAllocationDayKey(input.input.branchUuid, input.input.eventDate), branchUuid: input.input.branchUuid,
    eventDate: input.input.eventDate, ...input.sourceEvidence, paymentSetHash: input.paymentSetHash,
    paymentRowCount: input.paymentRowCount, successfulDetailCount: input.successfulDetailCount,
    metadataSnapshotHash: input.metadataSnapshotHash, cursor: input.cursor, status: 'INCOMPLETE', lastAttemptAt: null,
    lastSuccessAt: null, safeErrorCode: null, leaseOwner: input.lease.owner, leaseExpiresAt: input.lease.expiresAt,
    taskAttempt: input.input.attempt, leaseFencingToken: input.lease.fencingToken,
  }
}

function exactDayPayments(rows: JeraNormalizedRow[], branchUuid: string, eventDate: string): JeraNormalizedRow[] {
  const filtered = rows.filter((row) => row.reportType === 'PAYMENT' && row.branchUuid === branchUuid && row.eventDate === eventDate)
    .sort((left, right) => left.sourceUuid.localeCompare(right.sourceUuid))
  if (new Set(filtered.map((row) => row.sourceUuid)).size !== filtered.length) throw new Error('JERA_ALLOCATION_SOURCE_INVALID')
  return filtered
}

function paymentSetHash(payments: JeraNormalizedRow[]): string {
  return createHash('sha256').update(JSON.stringify(payments.map((row) => [row.sourceUuid, row.sourceHash]))).digest('hex')
}

function hasCurrentDetail(details: JeraCachedPaymentDetail[], payment: JeraNormalizedRow): boolean {
  return details.some((detail) => detail.paymentUuid === payment.sourceUuid && detail.paymentSourceHash === payment.sourceHash)
}

function matchingCount(details: JeraCachedPaymentDetail[], payments: JeraNormalizedRow[]): number {
  return payments.filter((payment) => hasCurrentDetail(details, payment)).length
}

function contiguousCursor(details: JeraCachedPaymentDetail[], payments: JeraNormalizedRow[]): number {
  const firstMissing = payments.findIndex((payment) => !hasCurrentDetail(details, payment))
  return firstMissing < 0 ? payments.length : firstMissing
}

function safeProviderCode(error: unknown): string {
  return error instanceof JeraReadError && /^JERA_[A-Z0-9_]{1,75}$/.test(error.code) ? error.code : 'JERA_PROVIDER_FAILED'
}

function validClaim(lease: JeraAllocationLease | null, dayKey: string, owner: string): lease is JeraAllocationLease {
  return Boolean(lease && lease.dayKey === dayKey && lease.owner === owner && /^[1-9]\d*$/.test(lease.fencingToken)
    && !Number.isNaN(Date.parse(lease.expiresAt)))
}

function validInstantOrNull(value: string | null): string | null {
  return value !== null && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null
}

function validateRunInput(input: {
  branchUuid: string; eventDate: string; paymentSetHash: string; metadataSnapshotHash: string
  cursor: number; attempt: number; workerId: string
}): void {
  const date = new Date(`${input.eventDate}T00:00:00Z`)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.branchUuid)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.eventDate
    || !/^[a-f0-9]{64}$/.test(input.paymentSetHash) || !/^[a-f0-9]{64}$/.test(input.metadataSnapshotHash)
    || !Number.isSafeInteger(input.cursor) || input.cursor < 0
    || !Number.isSafeInteger(input.attempt) || input.attempt < 0 || input.attempt > MAX_JERA_ALLOCATION_ATTEMPT
    || !/^[A-Za-z0-9._:-]{1,256}$/.test(input.workerId)) throw new Error('JERA_ALLOCATION_WORKER_INVALID_INPUT')
}

function coverageMatches(
  coverage: JeraAllocationCoverage | null | undefined,
  paymentSetHash: string,
  metadataSnapshotHash: string,
): coverage is JeraAllocationCoverage {
  return coverage?.paymentSetHash === paymentSetHash && coverage.metadataSnapshotHash === metadataSnapshotHash
}

function previousTaskAttempt(inputAttempt: number, coverage: JeraAllocationCoverage | null | undefined): number {
  return Math.max(inputAttempt, coverage?.taskAttempt ?? -1)
}

function instant(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('JERA_ALLOCATION_WORKER_INVALID_TIME')
  return value.toISOString()
}

function skipped(): { status: 'SKIPPED'; processed: 0; nextCursor: null } {
  return { status: 'SKIPPED', processed: 0, nextCursor: null }
}

function leaseLost(): never {
  throw new Error('JERA_ALLOCATION_LEASE_LOST')
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.message === 'JERA_ALLOCATION_LEASE_LOST'
}
