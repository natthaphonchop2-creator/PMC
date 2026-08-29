import { createHash } from 'node:crypto'
import type { MiniAppSheetsPort } from '../pmc-mini-app/googleClient.js'
import {
  JERA_ALLOCATION_COVERAGE_HEADERS,
  JERA_PAYMENT_DETAIL_CACHE_HEADERS,
  JERA_PAYMENT_DETAIL_LINES_HEADERS,
} from '../pmc-mini-app/setup.js'
import type { JeraNormalizedPaymentDetail } from './contracts.js'
import { jeraCacheKey } from './cacheKey.js'

export type JeraAllocationCoverageStatus = 'INCOMPLETE' | 'COMPLETE'

export interface JeraCachedPaymentDetailLine {
  lineOrdinal: number
  lineKind: 'OPD' | 'COURSE'
  itemCode: string | null
  netLineSatang: number
}

export interface JeraCachedPaymentDetail {
  detailKey: string
  branchUuid: string
  eventDate: string
  paymentUuid: string
  paymentSourceHash: string
  detailSourceHash: string
  detailFetchedAt: string
  lineCount: number
  truncated: boolean
  lines: JeraCachedPaymentDetailLine[]
}

export interface JeraAllocationCoverage {
  dayKey: string
  branchUuid: string
  eventDate: string
  paymentCacheKey: string
  productSalesCacheKey: string
  paymentSetHash: string
  paymentRowCount: number
  successfulDetailCount: number
  metadataSnapshotHash: string
  paymentLastSuccessAt: string | null
  productSalesLastSuccessAt: string | null
  cursor: number
  status: JeraAllocationCoverageStatus
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  safeErrorCode: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
}

export interface JeraAllocationStore {
  replacePaymentDetail(input: JeraCachedPaymentDetail): Promise<void>
  readDay(input: { branchUuid: string; eventDate: string; paymentSetHash: string }): Promise<{ coverage: JeraAllocationCoverage | null; details: JeraCachedPaymentDetail[] }>
  readDays(inputs: Array<{
    branchUuid: string
    eventDate: string
    paymentSetHash: string
    metadataSnapshotHash: string
  }>): Promise<Array<{ coverage: JeraAllocationCoverage | null; details: JeraCachedPaymentDetail[] }>>
  getCoverage(dayKey: string): Promise<JeraAllocationCoverage | null>
  saveCoverage(value: JeraAllocationCoverage): Promise<void>
  listIncompleteCoverage(limit: number): Promise<JeraAllocationCoverage[]>
}

const DETAIL_TAB = 'JERA_PAYMENT_DETAIL_CACHE'
const LINE_TAB = 'JERA_PAYMENT_DETAIL_LINES'
const COVERAGE_TAB = 'JERA_ALLOCATION_COVERAGE'
const mutexes = new Map<string, Promise<void>>()

export class JeraAllocationStoreError extends Error {
  readonly code: 'JERA_ALLOCATION_STORE_INCOMPATIBLE_HEADER' | 'JERA_ALLOCATION_STORE_CORRUPT_ROW' | 'JERA_ALLOCATION_STORE_INVALID_INPUT'
  constructor(code: JeraAllocationStoreError['code']) { super(code); this.name = 'JeraAllocationStoreError'; this.code = code }
}

export function jeraPaymentDetailKey(branchUuid: string, eventDate: string, paymentUuid: string, paymentSourceHash: string): string {
  assertUuid(branchUuid); assertDate(eventDate); assertUuid(paymentUuid); assertHash(paymentSourceHash)
  return createHash('sha256').update(JSON.stringify([branchUuid, eventDate, paymentUuid, paymentSourceHash])).digest('hex')
}

export function jeraAllocationDayKey(branchUuid: string, eventDate: string): string {
  assertUuid(branchUuid); assertDate(eventDate)
  return createHash('sha256').update(JSON.stringify([branchUuid, eventDate])).digest('hex')
}

/** Projects a normalized detail into the bounded fields permitted in the allocation cache. */
export function buildCachedPaymentDetail(input: {
  branchUuid: string
  paymentSourceHash: string
  detail: JeraNormalizedPaymentDetail
}): JeraCachedPaymentDetail {
  const { detail } = input
  assertUuid(input.branchUuid); assertHash(input.paymentSourceHash)
  const lines: JeraCachedPaymentDetailLine[] = []
  for (const opd of detail.opds) for (const item of opd.items) {
    if (!isMoney(item.priceSatang) || !isMoney(item.discountSatang) || !isPositiveFinite(item.quantity)) continue
    const weight = Math.max(0, (item.priceSatang - item.discountSatang) * item.quantity)
    if (!Number.isSafeInteger(weight)) continue
    lines.push({ lineOrdinal: lines.length, lineKind: 'OPD', itemCode: item.code, netLineSatang: weight })
  }
  for (const course of detail.courses) {
    const weight = course.paidAmountSatang ?? course.totalSatang ?? 0
    if (!isMoney(weight) || weight <= 0) continue
    lines.push({ lineOrdinal: lines.length, lineKind: 'COURSE', itemCode: course.code, netLineSatang: weight })
  }
  return {
    detailKey: jeraPaymentDetailKey(input.branchUuid, detail.eventDate, detail.sourceUuid, input.paymentSourceHash),
    branchUuid: input.branchUuid, eventDate: detail.eventDate, paymentUuid: detail.sourceUuid,
    paymentSourceHash: input.paymentSourceHash, detailSourceHash: detail.sourceHash, detailFetchedAt: detail.fetchedAt,
    lineCount: lines.length, truncated: detail.truncated, lines,
  }
}

export function createGoogleJeraAllocationStore(input: { spreadsheetId: string; sheets: MiniAppSheetsPort }): JeraAllocationStore {
  const { spreadsheetId, sheets } = input
  const mutexKey = `jera-allocation-store:${spreadsheetId}`

  async function readTable(tab: string, headers: readonly string[]): Promise<Array<{ rowNumber: number; cells: unknown[] }>> {
    const range = `'${tab}'!A1:${columnName(headers.length)}`
    const values = (await sheets.batchGet(spreadsheetId, [range]))[range] ?? []
    return tableRows(values, headers)
  }
  async function details(): Promise<Array<{ rowNumber: number; value: Omit<JeraCachedPaymentDetail, 'lines'> }>> {
    return (await readTable(DETAIL_TAB, JERA_PAYMENT_DETAIL_CACHE_HEADERS)).map(({ rowNumber, cells }) => ({ rowNumber, value: detailHeader(cells) }))
  }
  async function lines(): Promise<Array<{ rowNumber: number; value: JeraCachedPaymentDetailLine & { detailKey: string } }>> {
    return (await readTable(LINE_TAB, JERA_PAYMENT_DETAIL_LINES_HEADERS)).map(({ rowNumber, cells }) => ({ rowNumber, value: detailLine(cells) }))
  }
  async function coverageRows(): Promise<Array<{ rowNumber: number; value: JeraAllocationCoverage }>> {
    return (await readTable(COVERAGE_TAB, JERA_ALLOCATION_COVERAGE_HEADERS)).map(({ rowNumber, cells }) => ({ rowNumber, value: coverage(cells) }))
  }
  async function writeCoverage(value: JeraAllocationCoverage): Promise<void> {
    const normalized = validateCoverage(value)
    const stored = await coverageRows()
    const current = stored.find((row) => row.value.dayKey === normalized.dayKey)
    const range = current
      ? `'${COVERAGE_TAB}'!A${current.rowNumber}:${columnName(JERA_ALLOCATION_COVERAGE_HEADERS.length)}${current.rowNumber}`
      : `'${COVERAGE_TAB}'!A${Math.max(1, ...stored.map((row) => row.rowNumber)) + 1}:${columnName(JERA_ALLOCATION_COVERAGE_HEADERS.length)}${Math.max(1, ...stored.map((row) => row.rowNumber)) + 1}`
    await sheets.batchUpdate(spreadsheetId, [{ range, values: [coverageCells(normalized)] }])
  }

  return {
    async replacePaymentDetail(value) {
      const normalized = validateDetail(value)
      await withMutex(mutexKey, async () => {
        const [storedDetails, storedLines] = await Promise.all([details(), lines()])
        const current = storedDetails.find((row) => row.value.detailKey === normalized.detailKey)
        const existingLines = storedLines.filter((row) => row.value.detailKey === normalized.detailKey)
        if (current && JSON.stringify({ ...current.value, lines: existingLines.map((row) => row.value).map(({ detailKey, ...line }) => line) }) === JSON.stringify(normalized)) return
        const obsolete = storedDetails.filter((row) => row.value.branchUuid === normalized.branchUuid && row.value.eventDate === normalized.eventDate
          && row.value.paymentUuid === normalized.paymentUuid && row.value.detailKey !== normalized.detailKey)
        const reclaimableDetails = [...(current ? [current] : []), ...obsolete].sort((left, right) => left.rowNumber - right.rowNumber)
        const detailRow = reclaimableDetails[0]?.rowNumber ?? Math.max(1, ...storedDetails.map((row) => row.rowNumber)) + 1
        const reclaimableLines = storedLines.filter((row) => obsolete.some((detail) => detail.value.detailKey === row.value.detailKey) || row.value.detailKey === normalized.detailKey)
          .sort((left, right) => left.rowNumber - right.rowNumber)
        let nextLineRow = Math.max(1, ...storedLines.map((row) => row.rowNumber)) + 1
        const lineRows = normalized.lines.map((_, index) => reclaimableLines[index]?.rowNumber ?? nextLineRow++)
        const writes: Array<{ range: string; values: unknown[][] }> = []
        for (const row of reclaimableDetails.filter((row) => row.rowNumber !== detailRow)) writes.push({
          range: `'${DETAIL_TAB}'!A${row.rowNumber}:${columnName(JERA_PAYMENT_DETAIL_CACHE_HEADERS.length)}${row.rowNumber}`,
          values: [Array(JERA_PAYMENT_DETAIL_CACHE_HEADERS.length).fill('')],
        })
        for (const row of reclaimableLines.filter((row) => !lineRows.includes(row.rowNumber))) writes.push({
          range: `'${LINE_TAB}'!A${row.rowNumber}:${columnName(JERA_PAYMENT_DETAIL_LINES_HEADERS.length)}${row.rowNumber}`,
          values: [Array(JERA_PAYMENT_DETAIL_LINES_HEADERS.length).fill('')],
        })
        writes.push({ range: `'${DETAIL_TAB}'!A${detailRow}:${columnName(JERA_PAYMENT_DETAIL_CACHE_HEADERS.length)}${detailRow}`, values: [detailCells(normalized)] })
        for (const [index, line] of normalized.lines.entries()) {
          const rowNumber = lineRows[index]!
          writes.push({ range: `'${LINE_TAB}'!A${rowNumber}:${columnName(JERA_PAYMENT_DETAIL_LINES_HEADERS.length)}${rowNumber}`, values: [lineCells(normalized.detailKey, line)] })
        }
        await sheets.batchUpdate(spreadsheetId, writes)
      })
    },
    async readDay(query) {
      assertUuid(query.branchUuid); assertDate(query.eventDate); assertHash(query.paymentSetHash)
      const detailRange = `'${DETAIL_TAB}'!A1:${columnName(JERA_PAYMENT_DETAIL_CACHE_HEADERS.length)}`
      const lineRange = `'${LINE_TAB}'!A1:${columnName(JERA_PAYMENT_DETAIL_LINES_HEADERS.length)}`
      const coverageRange = `'${COVERAGE_TAB}'!A1:${columnName(JERA_ALLOCATION_COVERAGE_HEADERS.length)}`
      const values = await sheets.batchGet(spreadsheetId, [detailRange, lineRange, coverageRange])
      const storedDetails = tableRows(values[detailRange] ?? [], JERA_PAYMENT_DETAIL_CACHE_HEADERS)
        .map(({ rowNumber, cells }) => ({ rowNumber, value: detailHeader(cells) }))
      const storedLines = tableRows(values[lineRange] ?? [], JERA_PAYMENT_DETAIL_LINES_HEADERS)
        .map(({ rowNumber, cells }) => ({ rowNumber, value: detailLine(cells) }))
      const storedCoverage = tableRows(values[coverageRange] ?? [], JERA_ALLOCATION_COVERAGE_HEADERS)
        .map(({ rowNumber, cells }) => ({ rowNumber, value: coverage(cells) }))
      const byDetailKey = new Map<string, JeraCachedPaymentDetailLine[]>()
      for (const line of storedLines) byDetailKey.set(line.value.detailKey, [...(byDetailKey.get(line.value.detailKey) ?? []), stripDetailKey(line.value)])
      const headerKeys = new Set(storedDetails.map((row) => row.value.detailKey))
      if (storedLines.some((line) => !headerKeys.has(line.value.detailKey))) corrupt()
      const dayKey = jeraAllocationDayKey(query.branchUuid, query.eventDate)
      return {
        coverage: storedCoverage.find((row) => row.value.dayKey === dayKey && row.value.paymentSetHash === query.paymentSetHash)?.value ?? null,
        details: storedDetails.filter((row) => row.value.branchUuid === query.branchUuid && row.value.eventDate === query.eventDate).map(({ value }) => {
          const detailLines = byDetailKey.get(value.detailKey) ?? []
          const ordered = [...detailLines].sort((a, b) => a.lineOrdinal - b.lineOrdinal)
          if (ordered.length !== value.lineCount || ordered.some((line, index) => line.lineOrdinal !== index)) corrupt()
          return { ...value, lines: ordered }
        }),
      }
    },
    async readDays(inputs) {
      if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 31) {
        throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_INVALID_INPUT')
      }
      for (const input of inputs) {
        assertUuid(input.branchUuid); assertDate(input.eventDate); assertHash(input.paymentSetHash); assertHash(input.metadataSnapshotHash)
      }
      const detailRange = `'${DETAIL_TAB}'!A1:${columnName(JERA_PAYMENT_DETAIL_CACHE_HEADERS.length)}`
      const lineRange = `'${LINE_TAB}'!A1:${columnName(JERA_PAYMENT_DETAIL_LINES_HEADERS.length)}`
      const coverageRange = `'${COVERAGE_TAB}'!A1:${columnName(JERA_ALLOCATION_COVERAGE_HEADERS.length)}`
      const values = await sheets.batchGet(spreadsheetId, [detailRange, lineRange, coverageRange])
      const storedDetails = tableRows(values[detailRange] ?? [], JERA_PAYMENT_DETAIL_CACHE_HEADERS).map(({ cells }) => detailHeader(cells))
      const storedLines = tableRows(values[lineRange] ?? [], JERA_PAYMENT_DETAIL_LINES_HEADERS).map(({ cells }) => detailLine(cells))
      const storedCoverage = tableRows(values[coverageRange] ?? [], JERA_ALLOCATION_COVERAGE_HEADERS).map(({ cells }) => coverage(cells))
      const byDetailKey = new Map<string, JeraCachedPaymentDetailLine[]>()
      for (const line of storedLines) byDetailKey.set(line.detailKey, [...(byDetailKey.get(line.detailKey) ?? []), stripDetailKey(line)])
      const headerKeys = new Set(storedDetails.map((detail) => detail.detailKey))
      if (storedLines.some((line) => !headerKeys.has(line.detailKey))) corrupt()
      const hydrated = storedDetails.map((value): JeraCachedPaymentDetail => {
        const ordered = [...(byDetailKey.get(value.detailKey) ?? [])].sort((a, b) => a.lineOrdinal - b.lineOrdinal)
        if (ordered.length !== value.lineCount || ordered.some((line, index) => line.lineOrdinal !== index)) corrupt()
        return { ...value, lines: ordered }
      })
      return inputs.map((input) => {
        const dayKey = jeraAllocationDayKey(input.branchUuid, input.eventDate)
        return {
          coverage: storedCoverage.find((value) => value.dayKey === dayKey
            && value.paymentSetHash === input.paymentSetHash
            && value.metadataSnapshotHash === input.metadataSnapshotHash) ?? null,
          details: hydrated.filter((detail) => detail.branchUuid === input.branchUuid && detail.eventDate === input.eventDate),
        }
      })
    },
    async getCoverage(dayKey) { assertHash(dayKey); return (await coverageRows()).find((row) => row.value.dayKey === dayKey)?.value ?? null },
    async saveCoverage(value) { await withMutex(mutexKey, () => writeCoverage(value)) },
    async listIncompleteCoverage(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_INVALID_INPUT')
      return (await coverageRows()).map((row) => row.value).filter((row) => row.status === 'INCOMPLETE')
        .sort((a, b) => (a.lastAttemptAt ?? '').localeCompare(b.lastAttemptAt ?? '') || a.dayKey.localeCompare(b.dayKey)).slice(0, Math.min(limit, 20))
    },
  }
}

function validateDetail(value: JeraCachedPaymentDetail): JeraCachedPaymentDetail {
  if (!value || typeof value !== 'object') invalid(); assertUuid(value.branchUuid); assertDate(value.eventDate); assertUuid(value.paymentUuid)
  assertHash(value.detailKey); assertHash(value.paymentSourceHash); assertHash(value.detailSourceHash); instant(value.detailFetchedAt)
  if (value.detailKey !== jeraPaymentDetailKey(value.branchUuid, value.eventDate, value.paymentUuid, value.paymentSourceHash)
    || !Number.isSafeInteger(value.lineCount) || value.lineCount < 0 || value.lineCount !== value.lines.length || typeof value.truncated !== 'boolean') invalid()
  const ordinals = new Set<number>()
  for (const line of value.lines) {
    if (!line || !Number.isSafeInteger(line.lineOrdinal) || line.lineOrdinal < 0 || ordinals.has(line.lineOrdinal)
      || !['OPD', 'COURSE'].includes(line.lineKind) || (line.itemCode !== null && (typeof line.itemCode !== 'string' || line.itemCode.length > 256))
      || !Number.isSafeInteger(line.netLineSatang) || line.netLineSatang < 0) invalid()
    ordinals.add(line.lineOrdinal)
  }
  return structuredClone(value)
}

function validateCoverage(value: JeraAllocationCoverage): JeraAllocationCoverage {
  if (!value || typeof value !== 'object') invalid(); assertHash(value.dayKey); assertUuid(value.branchUuid); assertDate(value.eventDate)
  if (value.dayKey !== jeraAllocationDayKey(value.branchUuid, value.eventDate)) invalid()
  for (const hash of [value.paymentSetHash, value.metadataSnapshotHash]) assertHash(hash)
  if (value.paymentCacheKey !== jeraCacheKey('PAYMENT', { branchUuid: value.branchUuid, startDate: value.eventDate, endDate: value.eventDate })
    || value.productSalesCacheKey !== jeraCacheKey('PRODUCT_SALES', { branchUuid: value.branchUuid, startDate: value.eventDate, endDate: value.eventDate })) invalid()
  for (const number of [value.paymentRowCount, value.successfulDetailCount, value.cursor]) if (!Number.isSafeInteger(number) || number < 0) invalid()
  if (value.successfulDetailCount > value.paymentRowCount || !['INCOMPLETE', 'COMPLETE'].includes(value.status)) invalid()
  for (const date of [value.paymentLastSuccessAt, value.productSalesLastSuccessAt, value.lastAttemptAt, value.lastSuccessAt, value.leaseExpiresAt]) if (date !== null) instant(date)
  if (value.safeErrorCode !== null && !/^[A-Z0-9_]{1,80}$/.test(value.safeErrorCode)) invalid()
  if (value.leaseOwner !== null) assertToken(value.leaseOwner)
  if ((value.leaseOwner === null) !== (value.leaseExpiresAt === null)) invalid()
  return structuredClone(value)
}

function detailHeader(cells: unknown[]): Omit<JeraCachedPaymentDetail, 'lines'> {
  const lineCount = integer(cells[7])
  const value = validateDetail({
    detailKey: text(cells[0]), branchUuid: text(cells[1]), eventDate: text(cells[2]), paymentUuid: text(cells[3]), paymentSourceHash: text(cells[4]),
    detailSourceHash: text(cells[5]), detailFetchedAt: text(cells[6]), lineCount, truncated: boolean(cells[8]),
    lines: Array.from({ length: lineCount }, (_, lineOrdinal) => ({ lineOrdinal, lineKind: 'OPD' as const, itemCode: null, netLineSatang: 0 })),
  })
  const { lines: _lines, ...header } = value
  return header
}
function detailLine(cells: unknown[]): JeraCachedPaymentDetailLine & { detailKey: string } {
  const value = { detailKey: text(cells[0]), lineOrdinal: integer(cells[1]), lineKind: text(cells[2]) as 'OPD' | 'COURSE', itemCode: nullable(cells[3]), netLineSatang: integer(cells[4]) }
  assertHash(value.detailKey)
  if (!['OPD', 'COURSE'].includes(value.lineKind) || (value.itemCode !== null && value.itemCode.length > 256)) {
    throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_CORRUPT_ROW')
  }
  return value
}
function coverage(cells: unknown[]): JeraAllocationCoverage { return validateCoverage({
  dayKey: text(cells[0]), branchUuid: text(cells[1]), eventDate: text(cells[2]), paymentCacheKey: text(cells[3]), productSalesCacheKey: text(cells[4]), paymentSetHash: text(cells[5]), paymentRowCount: integer(cells[6]), successfulDetailCount: integer(cells[7]), metadataSnapshotHash: text(cells[8]), paymentLastSuccessAt: nullable(cells[9]), productSalesLastSuccessAt: nullable(cells[10]), cursor: integer(cells[11]), status: text(cells[12]) as JeraAllocationCoverageStatus, lastAttemptAt: nullable(cells[13]), lastSuccessAt: nullable(cells[14]), safeErrorCode: nullable(cells[15]), leaseOwner: nullable(cells[16]), leaseExpiresAt: nullable(cells[17]),
}) }
function detailCells(value: JeraCachedPaymentDetail): unknown[] { return [value.detailKey, value.branchUuid, value.eventDate, value.paymentUuid, value.paymentSourceHash, value.detailSourceHash, value.detailFetchedAt, value.lineCount, value.truncated] }
function lineCells(detailKey: string, value: JeraCachedPaymentDetailLine): unknown[] { return [detailKey, value.lineOrdinal, value.lineKind, value.itemCode ?? '', value.netLineSatang] }
function coverageCells(value: JeraAllocationCoverage): unknown[] { return [value.dayKey, value.branchUuid, value.eventDate, value.paymentCacheKey, value.productSalesCacheKey, value.paymentSetHash, value.paymentRowCount, value.successfulDetailCount, value.metadataSnapshotHash, value.paymentLastSuccessAt ?? '', value.productSalesLastSuccessAt ?? '', value.cursor, value.status, value.lastAttemptAt ?? '', value.lastSuccessAt ?? '', value.safeErrorCode ?? '', value.leaseOwner ?? '', value.leaseExpiresAt ?? ''] }
function stripDetailKey(value: JeraCachedPaymentDetailLine & { detailKey: string }): JeraCachedPaymentDetailLine { const { detailKey: _detailKey, ...line } = value; return line }
function isMoney(value: number | null): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function isPositiveFinite(value: number | null): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0 }
function assertHash(value: string): void { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid() }
function assertUuid(value: string): void { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid() }
function assertDate(value: string): void { const date = new Date(`${value}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid() }
function assertToken(value: string): void { if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) invalid() }
function instant(value: string): string { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid(); return new Date(value).toISOString() }
function text(value: unknown): string { return value === null || value === undefined ? '' : String(value) }
function nullable(value: unknown): string | null { const result = text(value); return result === '' ? null : result }
function integer(value: unknown): number { const result = typeof value === 'number' ? value : Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_CORRUPT_ROW'); return result }
function boolean(value: unknown): boolean { if (value === true || value === 'true') return true; if (value === false || value === 'false') return false; throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_CORRUPT_ROW') }
function blank(value: unknown): boolean { return value === '' || value === null || value === undefined }
function tableRows(values: unknown[][], headers: readonly string[]): Array<{ rowNumber: number; cells: unknown[] }> {
  if (!sameHeader((values[0] ?? []).map(text), headers)) throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_INCOMPATIBLE_HEADER')
  return values.slice(1).flatMap((cells, index) => cells.every(blank) ? [] : [{ rowNumber: index + 2, cells }])
}
function sameHeader(actual: string[], expected: readonly string[]): boolean { return actual.length === expected.length && actual.every((value, index) => value === expected[index]) }
function columnName(count: number): string { let value = count; let result = ''; while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26) } return result }
function invalid(): never { throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_INVALID_INPUT') }
function corrupt(): never { throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_CORRUPT_ROW') }
async function withMutex<T>(key: string, operation: () => Promise<T>): Promise<T> { const previous = mutexes.get(key) ?? Promise.resolve(); let release = (): void => undefined; const current = new Promise<void>((resolve) => { release = resolve }); const queued = previous.then(() => current); mutexes.set(key, queued); await previous; try { return await operation() } finally { release(); if (mutexes.get(key) === queued) mutexes.delete(key) } }
