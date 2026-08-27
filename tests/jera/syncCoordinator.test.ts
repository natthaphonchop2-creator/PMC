import { describe, expect, it, vi } from 'vitest'
import type { JeraNormalizedRow, JeraReadPort, JeraReportFilters, JeraSourceReportType } from '../../server/jera/contracts'
import {
  createJeraSyncCoordinator,
  isJeraRefreshDue,
  type JeraSyncQuery,
} from '../../server/jera/syncCoordinator'
import type {
  JeraCacheReadQuery,
  JeraReportStore,
  JeraStoreWriteResult,
  JeraSyncAuditRecord,
  JeraSyncStateRecord,
} from '../../server/jera/store'
import { jeraCacheKey } from '../../server/jera/cacheKey'

describe('JERA sync coordinator', () => {
  it('returns cache immediately and shares one background refresh', async () => {
    const store = new MemoryReportStore([paymentRow({ paidAmountSatang: 10_000 })])
    let releaseProvider = (): void => undefined
    const providerWait = new Promise<void>((resolve) => { releaseProvider = resolve })
    const client = readPort(async () => {
      await providerWait
      return [providerPayment('120.00')]
    })
    const coordinator = createCoordinator(store, client)

    const [first, second] = await Promise.all([
      coordinator.readAndRefresh(query()), coordinator.readAndRefresh(query()),
    ])

    expect(first.data[0]?.paidAmountSatang).toBe(10_000)
    expect(second.source).toBe('CACHE')
    expect(first.refreshing).toBe(true)
    await vi.waitFor(() => expect(client.request).toHaveBeenCalledOnce())
    releaseProvider()
    await coordinator.waitForIdle()
    expect((await store.readRows('PAYMENT', { cacheKey: cacheKey() }))[0]?.paidAmountSatang).toBe(12_000)
  })

  it('throttles accepted manual refreshes for five minutes per cache key', async () => {
    const store = new MemoryReportStore([paymentRow()])
    const client = readPort(async () => [providerPayment('100.00')])
    const coordinator = createCoordinator(store, client)

    const first = await coordinator.manualRefresh(query(), 'staff-hash')
    await coordinator.waitForIdle()
    const second = await coordinator.manualRefresh(query(), 'staff-hash')

    expect(first.accepted).toBe(true)
    expect(second).toMatchObject({ accepted: false, retryAfterSeconds: 300 })
    expect(client.request).toHaveBeenCalledOnce()
  })

  it('recovers an expired lease and performs a scheduled refresh', async () => {
    const store = new MemoryReportStore([paymentRow()])
    store.states.set(cacheKey(), state({
      status: 'RUNNING', leaseOwner: 'old-worker', leaseExpiresAt: '2026-08-27T09:59:59.000Z',
    }))
    const client = readPort(async () => [providerPayment('130.00')])
    const coordinator = createCoordinator(store, client)

    const result = await coordinator.scheduledRefresh(query())

    expect(result.source).toBe('LIVE')
    expect(result.data[0]?.paidAmountSatang).toBe(13_000)
    expect((await store.getSyncState(cacheKey()))?.status).toBe('SUCCESS')
  })

  it('preserves prior cache and last success when the provider fails', async () => {
    const store = new MemoryReportStore([paymentRow({ paidAmountSatang: 10_000 })])
    store.states.set(cacheKey(), state({
      status: 'SUCCESS', lastSuccessAt: '2026-08-27T09:55:00.000Z', recordCount: 1,
    }))
    const client = readPort(async () => { throw Object.assign(new Error('private provider body'), { code: 'JERA_RATE_LIMITED' }) })
    const coordinator = createCoordinator(store, client)

    await expect(coordinator.scheduledRefresh(query())).rejects.toThrow('JERA_RATE_LIMITED')

    expect((await store.readRows('PAYMENT', { cacheKey: cacheKey() }))[0]?.paidAmountSatang).toBe(10_000)
    expect(await store.getSyncState(cacheKey())).toMatchObject({
      status: 'FAILED', lastSuccessAt: '2026-08-27T09:55:00.000Z', safeErrorCode: 'JERA_RATE_LIMITED',
    })
    expect(JSON.stringify(store.audits)).not.toContain('private provider body')
  })

  it('replaces old cache with an empty result only after a valid provider success', async () => {
    const store = new MemoryReportStore([paymentRow()])
    const coordinator = createCoordinator(store, readPort(async () => []))

    const result = await coordinator.scheduledRefresh(query())

    expect(result).toMatchObject({ source: 'LIVE', data: [], warningCode: null })
    expect(await store.readRows('PAYMENT', { cacheKey: cacheKey() })).toEqual([])
    expect(await store.getSyncState(cacheKey())).toMatchObject({ status: 'SUCCESS', recordCount: 0 })
  })

  it('builds a bounded 90-day daily lookback and refreshes selected reports', async () => {
    const store = new MemoryReportStore()
    const client = readPort(async () => [])
    const coordinator = createCoordinator(store, client)

    await coordinator.dailyLookback({ reportTypes: ['PAYMENT', 'REFUND'], branchUuid: BRANCH, endDate: '2026-08-27' })

    expect(client.request).toHaveBeenCalledTimes(2)
    expect(client.request).toHaveBeenNthCalledWith(1, 'PAYMENT', expect.objectContaining({
      startDate: '2026-05-30', endDate: '2026-08-27', branchUuid: BRANCH,
    }))
    expect(store.audits.map((audit) => audit.actorType)).toEqual(['LOOKBACK', 'LOOKBACK'])
  })

  it('marks the 15-minute scheduler boundary as due without clock drift ambiguity', () => {
    expect(isJeraRefreshDue('2026-08-27T09:45:00.000Z', '2026-08-27T10:00:00.000Z', 15)).toBe(true)
    expect(isJeraRefreshDue('2026-08-27T09:45:01.000Z', '2026-08-27T10:00:00.000Z', 15)).toBe(false)
  })
})

const BRANCH = '11111111-2222-4333-8444-555555555555'
const PAYMENT_UUID = '10000000-0000-4000-8000-000000000001'
const NOW = '2026-08-27T10:00:00.000Z'

function query(): JeraSyncQuery {
  return { reportType: 'PAYMENT', filters: { branchUuid: BRANCH, startDate: '2026-08-27', endDate: '2026-08-27' } }
}

function cacheKey(): string { return jeraCacheKey('PAYMENT', query().filters) }

function createCoordinator(store: MemoryReportStore, client: JeraReadPort) {
  let sequence = 0
  return createJeraSyncCoordinator({
    client, store, now: () => new Date(NOW), id: () => `synthetic-run-${++sequence}`,
    manualRefreshSeconds: 300, staleAfterMs: 30 * 60_000, leaseTtlMs: 60_000,
  })
}

function readPort(handler: (reportType: JeraSourceReportType, filters: JeraReportFilters) => Promise<unknown[]>): JeraReadPort {
  return { request: vi.fn(handler) }
}

function providerPayment(paidAmount: string) {
  return {
    uuid: PAYMENT_UUID, code: 'PAY-SYN-1', patient_uuid: '20000000-0000-4000-8000-000000000001',
    patient_code: 'PAT-SYN-1', patient_name: 'Synthetic Patient', create_date: '2026-08-27 16:00:00',
    total: paidAmount, paid_amount: paidAmount, status: 'paid', type: 'normal', doctor_name: 'Doctor Synthetic', seller: null,
  }
}

function paymentRow(patch: Partial<JeraNormalizedRow> = {}): JeraNormalizedRow {
  return {
    cacheKey: cacheKey(), reportType: 'PAYMENT', sourceUuid: PAYMENT_UUID, branchUuid: BRANCH,
    branchName: 'Synthetic Branch', eventDate: '2026-08-27', patientUuid: null, patientCode: 'PAT-SYN-1',
    patientName: 'Synthetic Patient', paymentCode: 'PAY-SYN-1', status: 'PAID', type: 'normal',
    totalSatang: 10_000, paidAmountSatang: 10_000, refundAmountSatang: null,
    cashSatang: null, transferSatang: null, creditCardSatang: null, eWalletSatang: null,
    paymentLinkSatang: null, otherPaymentSatang: null,
    itemCode: null, itemName: null, quantity: null, remainingQuantity: null, remainingValueSatang: null,
    doctorName: 'Doctor Synthetic', salespersonName: null, sourceCreatedAt: '2026-08-27T16:00:00+07:00',
    sourceUpdatedAt: null, fetchedAt: '2026-08-27T09:55:00.000Z', sourceHash: 'a'.repeat(64),
    ...patch,
  }
}

function state(patch: Partial<JeraSyncStateRecord> = {}): JeraSyncStateRecord {
  return {
    cacheKey: cacheKey(), reportType: 'PAYMENT', filterHash: cacheKey().split(':')[1]!,
    lastAttemptAt: null, lastManualAt: null, lastSuccessAt: null, lastSourceDate: null, status: 'IDLE',
    recordCount: 0, nextPage: null, safeErrorCode: null, leaseOwner: null, leaseExpiresAt: null,
    ...patch,
  }
}

class MemoryReportStore implements JeraReportStore {
  readonly rows = new Map<string, JeraNormalizedRow[]>()
  readonly states = new Map<string, JeraSyncStateRecord>()
  readonly audits: JeraSyncAuditRecord[] = []

  constructor(rows: JeraNormalizedRow[] = []) {
    for (const row of rows) this.rows.set(row.cacheKey, [...(this.rows.get(row.cacheKey) ?? []), structuredClone(row)])
  }

  async upsertRows(_reportType: JeraSourceReportType, rows: JeraNormalizedRow[]): Promise<JeraStoreWriteResult> {
    for (const row of rows) {
      const current = this.rows.get(row.cacheKey) ?? []
      const index = current.findIndex((candidate) => candidate.reportType === row.reportType && candidate.sourceUuid === row.sourceUuid)
      if (index >= 0) current[index] = structuredClone(row); else current.push(structuredClone(row))
      this.rows.set(row.cacheKey, current)
    }
    return { inserted: rows.length, updated: 0, unchanged: 0, removed: 0 }
  }

  async replaceRows(_reportType: JeraSourceReportType, key: string, rows: JeraNormalizedRow[]): Promise<JeraStoreWriteResult> {
    const removed = this.rows.get(key)?.length ?? 0
    this.rows.set(key, structuredClone(rows))
    return { inserted: rows.length, updated: 0, unchanged: 0, removed }
  }

  async readRows(reportType: JeraSourceReportType, query: JeraCacheReadQuery = {}): Promise<JeraNormalizedRow[]> {
    return [...this.rows.values()].flat().filter((row) => row.reportType === reportType && (!query.cacheKey || row.cacheKey === query.cacheKey))
  }

  async getSyncState(key: string): Promise<JeraSyncStateRecord | null> { return structuredClone(this.states.get(key) ?? null) }
  async listSyncStates(): Promise<JeraSyncStateRecord[]> { return structuredClone([...this.states.values()]) }
  async saveSyncState(value: JeraSyncStateRecord): Promise<void> { this.states.set(value.cacheKey, structuredClone(value)) }
  async appendSyncAudit(value: JeraSyncAuditRecord): Promise<void> { this.audits.push(structuredClone(value)) }

  async claimLease(input: { cacheKey: string; reportType: JeraSourceReportType; filterHash: string; owner: string; now: string; ttlMs: number }): Promise<boolean> {
    const current = this.states.get(input.cacheKey)
    if (current?.leaseOwner && current.leaseOwner !== input.owner && current.leaseExpiresAt
      && Date.parse(current.leaseExpiresAt) > Date.parse(input.now)) return false
    this.states.set(input.cacheKey, state({
      ...(current ?? {}), cacheKey: input.cacheKey, reportType: input.reportType, filterHash: input.filterHash,
      status: 'RUNNING', leaseOwner: input.owner, leaseExpiresAt: new Date(Date.parse(input.now) + input.ttlMs).toISOString(),
    }))
    return true
  }

  async releaseLease(key: string, owner: string): Promise<void> {
    const current = this.states.get(key)
    if (current?.leaseOwner === owner) this.states.set(key, { ...current, leaseOwner: null, leaseExpiresAt: null })
  }
}
