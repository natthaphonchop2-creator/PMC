import { createHash } from 'node:crypto'
import { buildItemTypeMetadata } from './allocation.js'
import { JeraReadError } from './client.js'
import type { JeraNormalizedRow, JeraReadPort } from './contracts.js'
import type { JeraAllocationLease, JeraAllocationLeasePort } from './allocationLeaseStore.js'
import {
  buildCachedPaymentDetail,
  jeraAllocationDayKey,
  type JeraAllocationCoverage,
  type JeraAllocationStore,
  type JeraCachedPaymentDetail,
} from './allocationStore.js'
import { MAX_JERA_ALLOCATION_ATTEMPT, type JeraAllocationTaskQueuePort } from './allocationTaskQueue.js'
import { jeraCacheKey } from './cacheKey.js'
import { normalizePaymentDetail } from './normalize.js'
import type { JeraReportStore } from './store.js'

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
      const dayKey = jeraAllocationDayKey(input.branchUuid, input.eventDate)
      const claimed = await options.lease.claim({
        dayKey, owner: input.workerId, now: instant(now()), ttlMs: 300_000,
      })
      if (!validClaim(claimed, dayKey, input.workerId)) return skipped()
      const lease = claimed
      try {
        const existingCoverage = await options.allocationStore.getCoverage(dayKey)

        const filters = { branchUuid: input.branchUuid, startDate: input.eventDate, endDate: input.eventDate }
        let snapshots: Awaited<ReturnType<JeraReportStore['readSnapshots']>>
        try {
          snapshots = await options.reportStore.readSnapshots([
            { reportType: 'PAYMENT', filters }, { reportType: 'PRODUCT_SALES', filters },
          ])
        } catch {
          const retryCursor = coverageMatches(existingCoverage, input.paymentSetHash, input.metadataSnapshotHash) ? existingCoverage.cursor : 0
          await enqueue(input.paymentSetHash, input.metadataSnapshotHash, retryCursor, nextAttempt(input.attempt), options.continuationDelaySeconds)
          return { status: 'CONTINUED', processed: 0, nextCursor: retryCursor }
        }
        const [paymentSnapshot, productSnapshot] = snapshots
        if (!paymentSnapshot || !productSnapshot) {
          const retryCursor = coverageMatches(existingCoverage, input.paymentSetHash, input.metadataSnapshotHash) ? existingCoverage.cursor : 0
          await enqueue(input.paymentSetHash, input.metadataSnapshotHash, retryCursor, nextAttempt(input.attempt), options.continuationDelaySeconds)
          return { status: 'CONTINUED', processed: 0, nextCursor: retryCursor }
        }
        const payments = exactDayPayments(paymentSnapshot.rows, input.branchUuid, input.eventDate)
        const currentPaymentSetHash = paymentSetHash(payments)
        const metadata = buildItemTypeMetadata(productSnapshot.rows.map((row) => ({
          itemCode: row.itemCode, type: row.type, sourceHash: row.sourceHash,
        })))
        const currentMetadataSnapshotHash = metadata.snapshotHash
        const sourceEvidence = {
          paymentCacheKey: jeraCacheKey('PAYMENT', filters), productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', filters),
          paymentLastSuccessAt: validInstantOrNull(paymentSnapshot.state?.lastSuccessAt ?? null),
          productSalesLastSuccessAt: validInstantOrNull(productSnapshot.state?.lastSuccessAt ?? null),
        }
        if (!sourceEvidence.paymentLastSuccessAt || !sourceEvidence.productSalesLastSuccessAt) {
          const retryCursor = coverageMatches(existingCoverage, currentPaymentSetHash, currentMetadataSnapshotHash) ? existingCoverage.cursor : 0
          const incomplete = coverageMatches(existingCoverage, currentPaymentSetHash, currentMetadataSnapshotHash)
            ? { ...existingCoverage, ...sourceEvidence, metadataSnapshotHash: metadata.snapshotHash, status: 'INCOMPLETE' as const,
                safeErrorCode: 'JERA_ALLOCATION_SOURCE_INCOMPLETE', leaseOwner: lease.owner, leaseExpiresAt: lease.expiresAt }
            : { ...coverageBase({
                input, lease, paymentSetHash: currentPaymentSetHash, paymentRowCount: payments.length,
                metadataSnapshotHash: metadata.snapshotHash, sourceEvidence, cursor: retryCursor, successfulDetailCount: 0,
              }), safeErrorCode: 'JERA_ALLOCATION_SOURCE_INCOMPLETE' }
          await options.allocationStore.saveCoverage(incomplete)
          await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, retryCursor, nextAttempt(input.attempt), options.continuationDelaySeconds)
          return { status: 'CONTINUED', processed: 0, nextCursor: retryCursor }
        }
        if (coverageMatches(existingCoverage, input.paymentSetHash, input.metadataSnapshotHash)
          && input.paymentSetHash === currentPaymentSetHash && input.metadataSnapshotHash === currentMetadataSnapshotHash
          && existingCoverage.status === 'COMPLETE') return skipped()
        const read = await options.allocationStore.readDay({
          branchUuid: input.branchUuid, eventDate: input.eventDate, paymentSetHash: currentPaymentSetHash,
        })

        if (currentPaymentSetHash !== input.paymentSetHash || currentMetadataSnapshotHash !== input.metadataSnapshotHash) {
          const reset = coverageBase({
            input, lease, paymentSetHash: currentPaymentSetHash, paymentRowCount: payments.length,
            metadataSnapshotHash: metadata.snapshotHash, sourceEvidence, cursor: 0, successfulDetailCount: matchingCount(read.details, payments),
          })
          await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, 0, 0, options.continuationDelaySeconds)
          await options.allocationStore.saveCoverage(reset)
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
        let details = [...read.details]
        let previousAttemptAt = coverage.lastAttemptAt ? Date.parse(coverage.lastAttemptAt) : null

        while (cursor < payments.length && processed < options.maxDetailsPerRun) {
          const payment = payments[cursor]!
          if (hasCurrentDetail(details, payment)) {
            cursor += 1
            Object.assign(coverage, completionFields({ cursor, payments, details, metadataHash: metadata.snapshotHash, sourceEvidence, lease, now: now() }))
            await options.allocationStore.saveCoverage(coverage)
            continue
          }

          if (previousAttemptAt !== null) {
            const delay = previousAttemptAt + 3_000 - now().getTime()
            if (delay > 0) await sleep(delay)
          }
          const attemptedAt = now()
          previousAttemptAt = attemptedAt.getTime()
          coverage.lastAttemptAt = instant(attemptedAt)
          coverage.safeErrorCode = null
          coverage.leaseOwner = lease.owner
          coverage.leaseExpiresAt = lease.expiresAt
          await options.allocationStore.saveCoverage(coverage)
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
            await options.allocationStore.replacePaymentDetail(cached)
            details = [...details.filter((stored) => stored.paymentUuid !== cached.paymentUuid), cached]
            cursor += 1
            Object.assign(coverage, completionFields({ cursor, payments, details, metadataHash: metadata.snapshotHash, sourceEvidence, lease, now: now() }))
            await options.allocationStore.saveCoverage(coverage)
          } catch (error) {
            const code = safeProviderCode(error)
            coverage.safeErrorCode = code
            coverage.status = 'INCOMPLETE'
            coverage.cursor = cursor
            coverage.successfulDetailCount = matchingCount(details, payments)
            await options.allocationStore.saveCoverage(coverage)
            const retryAfter = error instanceof JeraReadError ? error.retryAfterSeconds ?? 0 : 0
            await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, cursor, nextAttempt(input.attempt), Math.max(options.continuationDelaySeconds, retryAfter))
            return { status: 'CONTINUED', processed: processed - 1, nextCursor: cursor }
          }
        }

        if (cursor >= payments.length) {
          Object.assign(coverage, completionFields({ cursor, payments, details, metadataHash: metadata.snapshotHash, sourceEvidence, lease, now: now() }))
          await options.allocationStore.saveCoverage(coverage)
          return { status: 'COMPLETE', processed, nextCursor: null }
        }
        await enqueue(currentPaymentSetHash, currentMetadataSnapshotHash, cursor, 0, options.continuationDelaySeconds)
        return { status: 'CONTINUED', processed, nextCursor: cursor }

        async function enqueue(
          hash: string,
          metadataHash: string,
          nextCursor: number,
          attempt: number,
          delaySeconds: number,
        ): Promise<void> {
          await options.queue.enqueue({
            branchUuid: input.branchUuid, eventDate: input.eventDate, paymentSetHash: hash,
            metadataSnapshotHash: metadataHash, cursor: nextCursor, attempt,
            scheduleAt: new Date(now().getTime() + delaySeconds * 1_000),
          })
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
  }
}

interface SourceEvidence {
  paymentCacheKey: string
  productSalesCacheKey: string
  paymentLastSuccessAt: string | null
  productSalesLastSuccessAt: string | null
}

function coverageBase(input: {
  input: { branchUuid: string; eventDate: string }
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

function nextAttempt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_JERA_ALLOCATION_ATTEMPT) throw new Error('JERA_ALLOCATION_RETRY_EXHAUSTED')
  return value + 1
}

function instant(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('JERA_ALLOCATION_WORKER_INVALID_TIME')
  return value.toISOString()
}

function skipped(): { status: 'SKIPPED'; processed: 0; nextCursor: null } {
  return { status: 'SKIPPED', processed: 0, nextCursor: null }
}
