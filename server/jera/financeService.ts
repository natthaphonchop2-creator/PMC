import { createHash } from 'node:crypto'
import type { DailyIncomeProjection, MonthlyIncomeProjection, PaymentRevenueAllocation } from '../../shared/pmcFinance.js'
import { allocatePaymentRevenue, buildItemTypeMetadata, type JeraItemTypeMetadata } from './allocation.js'
import {
  jeraAllocationDayKey,
  type JeraAllocationCoverage,
  type JeraAllocationStore,
  type JeraCachedPaymentDetail,
} from './allocationStore.js'
import {
  enqueueJeraAllocationTaskGeneration,
  type JeraAllocationTaskQueuePort,
} from './allocationTaskQueue.js'
import { jeraCacheKey } from './cacheKey.js'
import type { JeraCacheEnvelope, JeraNormalizedRow, JeraSourceReportType } from './contracts.js'
import {
  buildDailyIncomeProjection,
  buildMonthlyIncomeProjection,
  type FinanceDaySourceSnapshot,
} from './financeReports.js'
import type { JeraSyncCoordinator, JeraSyncQuery } from './syncCoordinator.js'

export interface JeraFinanceService {
  readDaily(input: { branchUuid: string; startDate: string; endDate: string }): Promise<DailyIncomeProjection>
  readMonthly(input: { branchUuid: string; year: number; month: number }): Promise<MonthlyIncomeProjection>
  refreshDay(input: {
    branchUuid: string
    eventDate: string
    actor: { type: 'STAFF'; staffId: string } | { type: 'SCHEDULER'; schedulerId: string }
  }): Promise<{ accepted: true; allocationQueued: boolean; retryAfterSeconds: number }>
}

export class JeraFinanceServiceError extends Error {
  readonly code: 'FINANCE_FILTER_INVALID' | 'FINANCE_CACHE_EMPTY' | 'FINANCE_REFRESH_UNAVAILABLE'
  readonly retryAfterSeconds: number | null

  constructor(code: JeraFinanceServiceError['code'], retryAfterSeconds: number | null = null) {
    super(code)
    this.name = 'JeraFinanceServiceError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const FINANCE_REPORT_TYPES = ['PAYMENT', 'REFUND', 'PRODUCT_SALES'] as const

export function createJeraFinanceService(options: {
  coordinator: JeraSyncCoordinator
  allocationStore: JeraAllocationStore
  allocationQueue: JeraAllocationTaskQueuePort
  categoryMoneyEnabled: boolean
  now?: () => Date
}): JeraFinanceService {
  const now = options.now ?? (() => new Date())

  async function readRange(input: { branchUuid: string; startDate: string; endDate: string }): Promise<FinanceDaySourceSnapshot[]> {
    const branchUuid = requiredUuid(input.branchUuid)
    const days = dateLabels(input.startDate, input.endDate)
    const queries = days.flatMap((eventDate) => FINANCE_REPORT_TYPES.map((reportType) => exactQuery(reportType, branchUuid, eventDate)))
    let envelopes: Array<JeraCacheEnvelope<JeraNormalizedRow[]>>
    try {
      envelopes = await options.coordinator.readCachedBatch(queries)
    } catch {
      throw new JeraFinanceServiceError('FINANCE_CACHE_EMPTY')
    }
    if (envelopes.length !== queries.length) throw new JeraFinanceServiceError('FINANCE_CACHE_EMPTY')

    const sources = days.map((eventDate, index) => {
      const payment = envelopes[index * 3]
      const refund = envelopes[index * 3 + 1]
      const productSales = envelopes[index * 3 + 2]
      if (!payment || !refund || !productSales || !payment.lastSuccessAt || !refund.lastSuccessAt || !productSales.lastSuccessAt) {
        throw new JeraFinanceServiceError('FINANCE_CACHE_EMPTY')
      }
      const payments = exactRows(payment.data, 'PAYMENT', branchUuid, eventDate)
      const productSalesRows = exactRows(productSales.data, 'PRODUCT_SALES', branchUuid, eventDate)
      const metadata = buildItemTypeMetadata(productSalesRows.map((row) => ({
        itemCode: row.itemCode, type: row.type, sourceHash: row.sourceHash,
      })))
      return {
        eventDate, payment, refund, productSales, payments, metadata, productSalesRows,
        paymentSetHash: paymentSetHash(payments),
      }
    })

    let allocationDays: Awaited<ReturnType<JeraAllocationStore['readDays']>>
    try {
      allocationDays = await options.allocationStore.readDays(sources.map((source) => ({
        branchUuid, eventDate: source.eventDate, paymentSetHash: source.paymentSetHash,
        metadataSnapshotHash: source.metadata.snapshotHash,
      })))
    } catch {
      throw new JeraFinanceServiceError('FINANCE_CACHE_EMPTY')
    }
    if (allocationDays.length !== sources.length) throw new JeraFinanceServiceError('FINANCE_CACHE_EMPTY')

    return sources.map((source, index): FinanceDaySourceSnapshot => {
      const allocationDay = allocationDays[index]!
      return {
        eventDate: source.eventDate,
        payment: source.payment,
        refund: source.refund,
        productSales: source.productSales,
        allocations: allocationsFor(source.payments, allocationDay.details, source.metadata),
        sourceBinding: {
          paymentCacheKey: jeraCacheKey('PAYMENT', exactQuery('PAYMENT', branchUuid, source.eventDate).filters),
          productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', exactQuery('PRODUCT_SALES', branchUuid, source.eventDate).filters),
          paymentSetHash: source.paymentSetHash,
          paymentRowCount: source.payments.length,
          metadataSnapshotHash: source.metadata.snapshotHash,
          productSalesRowCount: source.productSalesRows.length,
        },
        allocationCoverage: financeCoverage(allocationDay.coverage),
      }
    })
  }

  return {
    async readDaily(input) {
      const days = await readRange(input)
      return buildDailyIncomeProjection({ days, categoryMoneyEnabled: options.categoryMoneyEnabled, now: validNow(now()) })
    },
    async readMonthly(input) {
      const branchUuid = requiredUuid(input.branchUuid)
      if (!Number.isSafeInteger(input.year) || input.year < 2020 || input.year > 2100
        || !Number.isSafeInteger(input.month) || input.month < 1 || input.month > 12) {
        throw new JeraFinanceServiceError('FINANCE_FILTER_INVALID')
      }
      const monthKey = `${input.year}-${String(input.month).padStart(2, '0')}`
      const startDate = `${monthKey}-01`
      const endDate = new Date(Date.UTC(input.year, input.month, 0)).toISOString().slice(0, 10)
      const days = await readRange({ branchUuid, startDate, endDate })
      return buildMonthlyIncomeProjection({ monthKey, days, categoryMoneyEnabled: options.categoryMoneyEnabled, now: validNow(now()) })
    },
    async refreshDay(input) {
      const branchUuid = requiredUuid(input.branchUuid)
      const eventDate = requiredDate(input.eventDate)
      const actorId = actorIdentity(input.actor)
      const retryAfterSeconds: number[] = []
      try {
        const dayKey = jeraAllocationDayKey(branchUuid, eventDate)
        const existingCoverage = await options.allocationStore.getCoverage(dayKey)
        for (const reportType of FINANCE_REPORT_TYPES) {
          const result = await options.coordinator.manualRefresh(exactQuery(reportType, branchUuid, eventDate), actorId)
          retryAfterSeconds.push(safeRetry(result.retryAfterSeconds))
          if (!result.accepted) {
            throw new JeraFinanceServiceError('FINANCE_REFRESH_UNAVAILABLE', Math.max(...retryAfterSeconds))
          }
        }
        const queries = FINANCE_REPORT_TYPES.map((reportType) => exactQuery(reportType, branchUuid, eventDate))
        const envelopes = await options.coordinator.readCachedBatch(queries)
        if (envelopes.length !== 3 || envelopes.some((envelope) => !envelope.lastSuccessAt)) {
          throw new JeraFinanceServiceError('FINANCE_REFRESH_UNAVAILABLE')
        }
        const payments = exactRows(envelopes[0]!.data, 'PAYMENT', branchUuid, eventDate)
        const productSalesRows = exactRows(envelopes[2]!.data, 'PRODUCT_SALES', branchUuid, eventDate)
        const metadata = buildItemTypeMetadata(productSalesRows.map((row) => ({
          itemCode: row.itemCode, type: row.type, sourceHash: row.sourceHash,
        })))
        const hash = paymentSetHash(payments)
        const sameSourceCoverage = existingCoverage?.paymentSetHash === hash
          && existingCoverage.metadataSnapshotHash === metadata.snapshotHash
        if (sameSourceCoverage && existingCoverage.status === 'COMPLETE') {
          return {
            accepted: true,
            allocationQueued: false,
            retryAfterSeconds: Math.max(...retryAfterSeconds),
          }
        }
        const cursor = sameSourceCoverage ? existingCoverage.cursor : 0
        const queued = await enqueueJeraAllocationTaskGeneration(options.allocationQueue, {
          branchUuid, eventDate, paymentSetHash: hash, metadataSnapshotHash: metadata.snapshotHash,
          cursor, previousTaskAttempt: sameSourceCoverage ? existingCoverage.taskAttempt : -1,
          scheduleAt: validNow(now()),
        })
        const coverage: JeraAllocationCoverage = sameSourceCoverage
          ? {
              ...existingCoverage,
              paymentRowCount: payments.length,
              productSalesRowCount: productSalesRows.length,
              paymentLastSuccessAt: envelopes[0]!.lastSuccessAt,
              productSalesLastSuccessAt: envelopes[2]!.lastSuccessAt,
              status: 'INCOMPLETE', safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null,
              taskAttempt: queued.taskAttempt,
            }
          : {
              dayKey, branchUuid, eventDate,
              paymentCacheKey: jeraCacheKey('PAYMENT', queries[0]!.filters),
              productSalesCacheKey: jeraCacheKey('PRODUCT_SALES', queries[2]!.filters),
              paymentSetHash: hash, paymentRowCount: payments.length, successfulDetailCount: 0,
              productSalesRowCount: productSalesRows.length,
              metadataSnapshotHash: metadata.snapshotHash,
              paymentLastSuccessAt: envelopes[0]!.lastSuccessAt,
              productSalesLastSuccessAt: envelopes[2]!.lastSuccessAt,
              cursor: 0, status: 'INCOMPLETE', lastAttemptAt: null, lastSuccessAt: null,
              safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null, taskAttempt: queued.taskAttempt,
            }
        await options.allocationStore.saveCoverage(coverage)
        return {
          accepted: true,
          allocationQueued: queued.created,
          retryAfterSeconds: Math.max(...retryAfterSeconds),
        }
      } catch (error) {
        if (error instanceof JeraFinanceServiceError) throw error
        throw new JeraFinanceServiceError('FINANCE_REFRESH_UNAVAILABLE')
      }
    },
  }
}

function exactQuery(reportType: JeraSourceReportType, branchUuid: string, eventDate: string): JeraSyncQuery {
  return { reportType, filters: { branchUuid, startDate: eventDate, endDate: eventDate } }
}

function dateLabels(startDate: string, endDate: string): string[] {
  const start = dateNumber(requiredDate(startDate))
  const end = dateNumber(requiredDate(endDate))
  const dayCount = Math.floor((end - start) / 86_400_000) + 1
  if (dayCount < 1 || dayCount > 31) throw new JeraFinanceServiceError('FINANCE_FILTER_INVALID')
  return Array.from({ length: dayCount }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10))
}

function requiredDate(value: string): string {
  if (typeof value !== 'string') throw new JeraFinanceServiceError('FINANCE_FILTER_INVALID')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new JeraFinanceServiceError('FINANCE_FILTER_INVALID')
  }
  return value
}

function requiredUuid(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new JeraFinanceServiceError('FINANCE_FILTER_INVALID')
  }
  return value.toLowerCase()
}

function dateNumber(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`)
}

function exactRows(rows: JeraNormalizedRow[], reportType: JeraSourceReportType, branchUuid: string, eventDate: string): JeraNormalizedRow[] {
  return rows.filter((row) => row.reportType === reportType && row.branchUuid === branchUuid && row.eventDate === eventDate)
}

function paymentSetHash(rows: JeraNormalizedRow[]): string {
  const pairs = [...rows].sort((left, right) => left.sourceUuid.localeCompare(right.sourceUuid)).map((row) => [row.sourceUuid, row.sourceHash])
  return createHash('sha256').update(JSON.stringify(pairs)).digest('hex')
}

function allocationsFor(
  payments: JeraNormalizedRow[],
  details: JeraCachedPaymentDetail[],
  metadata: JeraItemTypeMetadata,
): PaymentRevenueAllocation[] {
  return payments.map((payment) => {
    const detail = details.find((candidate) => candidate.paymentUuid === payment.sourceUuid && candidate.paymentSourceHash === payment.sourceHash)
    return allocatePaymentRevenue({
      paymentUuid: payment.sourceUuid, paymentSourceHash: payment.sourceHash,
      paidAmountSatang: payment.paidAmountSatang ?? 0, paymentType: payment.type,
      detail: detail ? {
        truncated: detail.truncated,
        lines: detail.lines.map((line) => ({ kind: line.lineKind, itemCode: line.itemCode, netLineSatang: line.netLineSatang })),
      } : null,
      metadata,
    })
  })
}

function financeCoverage(value: JeraAllocationCoverage | null): FinanceDaySourceSnapshot['allocationCoverage'] {
  return value ? {
    status: value.status, paymentCacheKey: value.paymentCacheKey, productSalesCacheKey: value.productSalesCacheKey,
    paymentSetHash: value.paymentSetHash, paymentRowCount: value.paymentRowCount,
    metadataSnapshotHash: value.metadataSnapshotHash, productSalesRowCount: value.productSalesRowCount,
    paymentLastSuccessAt: value.paymentLastSuccessAt, productSalesLastSuccessAt: value.productSalesLastSuccessAt,
    lastSuccessAt: value.lastSuccessAt,
  } : null
}

function actorIdentity(actor: { type: 'STAFF'; staffId: string } | { type: 'SCHEDULER'; schedulerId: string }): string {
  const value = actor.type === 'STAFF' ? actor.staffId : actor.schedulerId
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw new JeraFinanceServiceError('FINANCE_FILTER_INVALID')
  return value
}

function safeRetry(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600) return 60
  return value
}

function validNow(value: Date): Date {
  const copy = new Date(value)
  if (!Number.isFinite(copy.getTime())) throw new JeraFinanceServiceError('FINANCE_REFRESH_UNAVAILABLE')
  return copy
}
