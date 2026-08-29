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
  taskAttempt: number
  productSalesRowCount: number
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
  openRunSession(): Promise<JeraAllocationRunSession>
}

export interface JeraAllocationRunSession {
  replacePaymentDetail(input: JeraCachedPaymentDetail): Promise<void>
  persistPaymentDetail(input: { detail: JeraCachedPaymentDetail; coverage: JeraAllocationCoverage }): Promise<void>
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

export const JERA_ALLOCATION_SHEET_OPERATION_BUDGET = Object.freeze({
  maxDetailRows: 50_000,
  maxLineRows: 200_000,
  maxCoverageRows: 10_000,
  repeatedFinanceGetBatchGets: 1,
  workerRunBatchGets: 1,
  worker20DetailBatchUpdates: 40,
  snapshotTtlMs: 5_000,
})

export class JeraAllocationStoreError extends Error {
  readonly code: 'JERA_ALLOCATION_STORE_INCOMPATIBLE_HEADER' | 'JERA_ALLOCATION_STORE_CORRUPT_ROW' | 'JERA_ALLOCATION_STORE_INVALID_INPUT' | 'JERA_ALLOCATION_STORE_ROW_LIMIT'
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

export function createGoogleJeraAllocationStore(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
  readCacheMs?: number
  now?: () => number
}): JeraAllocationStore {
  const { spreadsheetId, sheets } = input
  const mutexKey = `jera-allocation-store:${spreadsheetId}`
  const readCacheMs = input.readCacheMs ?? JERA_ALLOCATION_SHEET_OPERATION_BUDGET.snapshotTtlMs
  const now = input.now ?? Date.now
  if (!Number.isSafeInteger(readCacheMs) || readCacheMs < 1_000 || readCacheMs > 60_000) invalid()

  type DetailHeaderRow = { rowNumber: number; value: Omit<JeraCachedPaymentDetail, 'lines'> }
  type DetailLineRow = { rowNumber: number; value: JeraCachedPaymentDetailLine & { detailKey: string } }
  type CoverageRow = { rowNumber: number; value: JeraAllocationCoverage }
  interface AllocationSnapshot {
    details: DetailHeaderRow[]
    lines: DetailLineRow[]
    coverages: CoverageRow[]
    freeDetailRows: number[]
    freeLineRows: number[]
    freeCoverageRows: number[]
    nextDetailRow: number
    nextLineRow: number
    nextCoverageRow: number
  }
  let cachedSnapshot: { expiresAt: number; value: AllocationSnapshot } | null = null
  let activeSnapshot: Promise<AllocationSnapshot> | null = null

  function boundedRange(tab: string, headers: readonly string[], maxRows: number): string {
    return `'${tab}'!A1:${columnName(headers.length)}${maxRows + 2}`
  }

  function indexedRows<T>(
    values: unknown[][],
    headers: readonly string[],
    maxRows: number,
    parse: (cells: unknown[]) => T,
  ): { rows: Array<{ rowNumber: number; value: T }>; freeRows: number[]; nextRow: number } {
    if (values.length > maxRows + 1) throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_ROW_LIMIT')
    if (!sameHeader((values[0] ?? []).map(text), headers)) {
      throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_INCOMPATIBLE_HEADER')
    }
    const rows: Array<{ rowNumber: number; value: T }> = []
    const freeRows: number[] = []
    for (let index = 1; index < values.length; index += 1) {
      const cells = values[index] ?? []
      if (cells.every(blank)) freeRows.push(index + 1)
      else rows.push({ rowNumber: index + 1, value: parse(cells) })
    }
    return { rows, freeRows, nextRow: Math.max(2, values.length + 1) }
  }

  async function loadSnapshot(): Promise<AllocationSnapshot> {
    if (cachedSnapshot && cachedSnapshot.expiresAt > now()) return structuredClone(cachedSnapshot.value)
    if (activeSnapshot) return structuredClone(await activeSnapshot)
    const detailRange = boundedRange(DETAIL_TAB, JERA_PAYMENT_DETAIL_CACHE_HEADERS, JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxDetailRows)
    const lineRange = boundedRange(LINE_TAB, JERA_PAYMENT_DETAIL_LINES_HEADERS, JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxLineRows)
    const coverageRange = boundedRange(COVERAGE_TAB, JERA_ALLOCATION_COVERAGE_HEADERS, JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxCoverageRows)
    const operation = (async () => {
      const values = await sheets.batchGet(spreadsheetId, [detailRange, lineRange, coverageRange])
      const detailTable = indexedRows(values[detailRange] ?? [], JERA_PAYMENT_DETAIL_CACHE_HEADERS,
        JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxDetailRows, detailHeader)
      const lineTable = indexedRows(values[lineRange] ?? [], JERA_PAYMENT_DETAIL_LINES_HEADERS,
        JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxLineRows, detailLine)
      const coverageTable = indexedRows(values[coverageRange] ?? [], JERA_ALLOCATION_COVERAGE_HEADERS,
        JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxCoverageRows, coverage)
      const headerKeys = new Set(detailTable.rows.map((row) => row.value.detailKey))
      if (lineTable.rows.some((row) => !headerKeys.has(row.value.detailKey))) corrupt()
      const snapshot: AllocationSnapshot = {
        details: detailTable.rows,
        lines: lineTable.rows,
        coverages: coverageTable.rows,
        freeDetailRows: detailTable.freeRows,
        freeLineRows: lineTable.freeRows,
        freeCoverageRows: coverageTable.freeRows,
        nextDetailRow: detailTable.nextRow,
        nextLineRow: lineTable.nextRow,
        nextCoverageRow: coverageTable.nextRow,
      }
      cachedSnapshot = { expiresAt: now() + readCacheMs, value: structuredClone(snapshot) }
      return snapshot
    })()
    activeSnapshot = operation
    try {
      return structuredClone(await operation)
    } finally {
      if (activeSnapshot === operation) activeSnapshot = null
    }
  }

  function invalidateSnapshot(): void { cachedSnapshot = null }

  function createSession(snapshot: AllocationSnapshot): JeraAllocationRunSession {
    const detailsByKey = new Map(snapshot.details.map((row) => [row.value.detailKey, row]))
    const linesByKey = new Map<string, DetailLineRow[]>()
    for (const row of snapshot.lines) linesByKey.set(row.value.detailKey, [...(linesByKey.get(row.value.detailKey) ?? []), row])
    for (const row of snapshot.details) {
      const ordered = [...(linesByKey.get(row.value.detailKey) ?? [])].sort((left, right) => left.value.lineOrdinal - right.value.lineOrdinal)
      if (ordered.length !== row.value.lineCount || ordered.some((line, index) => line.value.lineOrdinal !== index)) corrupt()
      linesByKey.set(row.value.detailKey, ordered)
    }
    const coverageByDay = new Map(snapshot.coverages.map((row) => [row.value.dayKey, row]))
    const freeDetailRows = [...snapshot.freeDetailRows].sort((a, b) => a - b)
    const freeLineRows = [...snapshot.freeLineRows].sort((a, b) => a - b)
    const freeCoverageRows = [...snapshot.freeCoverageRows].sort((a, b) => a - b)
    let nextDetailRow = snapshot.nextDetailRow
    let nextLineRow = snapshot.nextLineRow
    let nextCoverageRow = snapshot.nextCoverageRow

    function takeDetailRow(): number {
      const reused = freeDetailRows.shift()
      if (reused !== undefined) return reused
      if (nextDetailRow > JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxDetailRows + 1) rowLimit()
      return nextDetailRow++
    }
    function takeLineRow(): number {
      const reused = freeLineRows.shift()
      if (reused !== undefined) return reused
      if (nextLineRow > JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxLineRows + 1) rowLimit()
      return nextLineRow++
    }
    function takeCoverageRow(): number {
      const reused = freeCoverageRows.shift()
      if (reused !== undefined) return reused
      if (nextCoverageRow > JERA_ALLOCATION_SHEET_OPERATION_BUDGET.maxCoverageRows + 1) rowLimit()
      return nextCoverageRow++
    }
    function hydrated(row: DetailHeaderRow): JeraCachedPaymentDetail {
      return { ...row.value, lines: (linesByKey.get(row.value.detailKey) ?? []).map(({ value }) => stripDetailKey(value)) }
    }
    function dayDetails(branchUuid: string, eventDate: string): JeraCachedPaymentDetail[] {
      return [...detailsByKey.values()]
        .filter((row) => row.value.branchUuid === branchUuid && row.value.eventDate === eventDate)
        .sort((left, right) => left.rowNumber - right.rowNumber)
        .map(hydrated)
    }
    function coverageWrite(value: JeraAllocationCoverage): { rowNumber: number; value: JeraAllocationCoverage; write: { range: string; values: unknown[][] } } {
      const normalized = validateCoverage(value)
      const current = coverageByDay.get(normalized.dayKey)
      const rowNumber = current?.rowNumber ?? takeCoverageRow()
      return {
        rowNumber,
        value: normalized,
        write: {
          range: `'${COVERAGE_TAB}'!A${rowNumber}:${columnName(JERA_ALLOCATION_COVERAGE_HEADERS.length)}${rowNumber}`,
          values: [coverageCells(normalized)],
        },
      }
    }
    async function persistDetail(value: JeraCachedPaymentDetail, nextCoverage: JeraAllocationCoverage | null): Promise<void> {
      const normalized = validateDetail(value)
      if (nextCoverage && (nextCoverage.branchUuid !== normalized.branchUuid || nextCoverage.eventDate !== normalized.eventDate)) invalid()
      await withMutex(mutexKey, async () => {
        const current = detailsByKey.get(normalized.detailKey)
        const currentValue = current ? hydrated(current) : null
        const unchanged = currentValue !== null && JSON.stringify(currentValue) === JSON.stringify(normalized)
        const coverageMutation = nextCoverage ? coverageWrite(nextCoverage) : null
        if (unchanged && !coverageMutation) return
        const writes: Array<{ range: string; values: unknown[][] }> = []
        let detailRow = current?.rowNumber ?? -1
        let lineRows: number[] = []
        let reclaimableDetails: DetailHeaderRow[] = []
        let reclaimableLines: DetailLineRow[] = []
        if (!unchanged) {
          const obsolete = [...detailsByKey.values()].filter((row) => row.value.branchUuid === normalized.branchUuid
            && row.value.eventDate === normalized.eventDate && row.value.paymentUuid === normalized.paymentUuid
            && row.value.detailKey !== normalized.detailKey)
          reclaimableDetails = [...(current ? [current] : []), ...obsolete].sort((left, right) => left.rowNumber - right.rowNumber)
          detailRow = reclaimableDetails[0]?.rowNumber ?? takeDetailRow()
          reclaimableLines = reclaimableDetails.flatMap((row) => linesByKey.get(row.value.detailKey) ?? [])
            .sort((left, right) => left.rowNumber - right.rowNumber)
          lineRows = normalized.lines.map((_, index) => reclaimableLines[index]?.rowNumber ?? takeLineRow())
          for (const row of reclaimableDetails.filter((row) => row.rowNumber !== detailRow)) writes.push({
            range: `'${DETAIL_TAB}'!A${row.rowNumber}:${columnName(JERA_PAYMENT_DETAIL_CACHE_HEADERS.length)}${row.rowNumber}`,
            values: [Array(JERA_PAYMENT_DETAIL_CACHE_HEADERS.length).fill('')],
          })
          for (const row of reclaimableLines.filter((row) => !lineRows.includes(row.rowNumber))) writes.push({
            range: `'${LINE_TAB}'!A${row.rowNumber}:${columnName(JERA_PAYMENT_DETAIL_LINES_HEADERS.length)}${row.rowNumber}`,
            values: [Array(JERA_PAYMENT_DETAIL_LINES_HEADERS.length).fill('')],
          })
          writes.push({
            range: `'${DETAIL_TAB}'!A${detailRow}:${columnName(JERA_PAYMENT_DETAIL_CACHE_HEADERS.length)}${detailRow}`,
            values: [detailCells(normalized)],
          })
          for (const [index, line] of normalized.lines.entries()) writes.push({
            range: `'${LINE_TAB}'!A${lineRows[index]!}:${columnName(JERA_PAYMENT_DETAIL_LINES_HEADERS.length)}${lineRows[index]!}`,
            values: [lineCells(normalized.detailKey, line)],
          })
        }
        if (coverageMutation) writes.push(coverageMutation.write)
        await sheets.batchUpdate(spreadsheetId, writes)
        invalidateSnapshot()
        if (!unchanged) {
          for (const row of reclaimableDetails) {
            detailsByKey.delete(row.value.detailKey)
            linesByKey.delete(row.value.detailKey)
          }
          recycleRows(freeDetailRows, reclaimableDetails.map((row) => row.rowNumber).filter((row) => row !== detailRow))
          recycleRows(freeLineRows, reclaimableLines.map((row) => row.rowNumber).filter((row) => !lineRows.includes(row)))
          detailsByKey.set(normalized.detailKey, { rowNumber: detailRow, value: stripLines(normalized) })
          linesByKey.set(normalized.detailKey, normalized.lines.map((line, index) => ({
            rowNumber: lineRows[index]!, value: { detailKey: normalized.detailKey, ...line },
          })))
        }
        if (coverageMutation) coverageByDay.set(coverageMutation.value.dayKey, {
          rowNumber: coverageMutation.rowNumber, value: structuredClone(coverageMutation.value),
        })
      })
    }

    return {
      replacePaymentDetail(value) { return persistDetail(value, null) },
      persistPaymentDetail(value) { return persistDetail(value.detail, value.coverage) },
      async readDay(query) {
        assertUuid(query.branchUuid); assertDate(query.eventDate); assertHash(query.paymentSetHash)
        const dayKey = jeraAllocationDayKey(query.branchUuid, query.eventDate)
        const storedCoverage = coverageByDay.get(dayKey)?.value ?? null
        return {
          coverage: storedCoverage?.paymentSetHash === query.paymentSetHash ? structuredClone(storedCoverage) : null,
          details: structuredClone(dayDetails(query.branchUuid, query.eventDate)),
        }
      },
      async readDays(inputs) {
        validateReadDays(inputs)
        return inputs.map((query) => {
          const storedCoverage = coverageByDay.get(jeraAllocationDayKey(query.branchUuid, query.eventDate))?.value ?? null
          return {
            coverage: storedCoverage?.paymentSetHash === query.paymentSetHash
              && storedCoverage.metadataSnapshotHash === query.metadataSnapshotHash ? structuredClone(storedCoverage) : null,
            details: structuredClone(dayDetails(query.branchUuid, query.eventDate)),
          }
        })
      },
      async getCoverage(dayKey) {
        assertHash(dayKey)
        return structuredClone(coverageByDay.get(dayKey)?.value ?? null)
      },
      async saveCoverage(value) {
        const mutation = coverageWrite(value)
        await withMutex(mutexKey, async () => {
          await sheets.batchUpdate(spreadsheetId, [mutation.write])
          invalidateSnapshot()
          coverageByDay.set(mutation.value.dayKey, { rowNumber: mutation.rowNumber, value: structuredClone(mutation.value) })
        })
      },
      async listIncompleteCoverage(limit) {
        if (!Number.isSafeInteger(limit) || limit < 1) invalid()
        return [...coverageByDay.values()].map((row) => structuredClone(row.value)).filter((row) => row.status === 'INCOMPLETE')
          .sort((a, b) => (a.lastAttemptAt ?? '').localeCompare(b.lastAttemptAt ?? '') || a.dayKey.localeCompare(b.dayKey))
          .slice(0, Math.min(limit, 20))
      },
    }
  }

  const store: JeraAllocationStore = {
    async openRunSession() { return createSession(await loadSnapshot()) },
    async replacePaymentDetail(value) { await (await store.openRunSession()).replacePaymentDetail(value) },
    async readDay(value) { return (await store.openRunSession()).readDay(value) },
    async readDays(value) { return (await store.openRunSession()).readDays(value) },
    async getCoverage(value) { return (await store.openRunSession()).getCoverage(value) },
    async saveCoverage(value) { await (await store.openRunSession()).saveCoverage(value) },
    async listIncompleteCoverage(value) { return (await store.openRunSession()).listIncompleteCoverage(value) },
  }
  return store
}

function validateDetail(value: JeraCachedPaymentDetail): JeraCachedPaymentDetail {
  if (!value || typeof value !== 'object') invalid(); assertUuid(value.branchUuid); assertDate(value.eventDate); assertUuid(value.paymentUuid)
  assertHash(value.detailKey); assertHash(value.paymentSourceHash); assertHash(value.detailSourceHash); instant(value.detailFetchedAt)
  if (value.detailKey !== jeraPaymentDetailKey(value.branchUuid, value.eventDate, value.paymentUuid, value.paymentSourceHash)
    || !Number.isSafeInteger(value.lineCount) || value.lineCount < 0 || value.lineCount !== value.lines.length || typeof value.truncated !== 'boolean') invalid()
  const ordinals = new Set<number>()
  for (const [index, line] of value.lines.entries()) {
    if (!line || !Number.isSafeInteger(line.lineOrdinal) || line.lineOrdinal !== index || ordinals.has(line.lineOrdinal)
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
  for (const number of [value.paymentRowCount, value.productSalesRowCount, value.successfulDetailCount, value.cursor, value.taskAttempt]) if (!Number.isSafeInteger(number) || number < 0) invalid()
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
  return {
    detailKey: value.detailKey, branchUuid: value.branchUuid, eventDate: value.eventDate,
    paymentUuid: value.paymentUuid, paymentSourceHash: value.paymentSourceHash,
    detailSourceHash: value.detailSourceHash, detailFetchedAt: value.detailFetchedAt,
    lineCount: value.lineCount, truncated: value.truncated,
  }
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
  dayKey: text(cells[0]), branchUuid: text(cells[1]), eventDate: text(cells[2]), paymentCacheKey: text(cells[3]), productSalesCacheKey: text(cells[4]), paymentSetHash: text(cells[5]), paymentRowCount: integer(cells[6]), successfulDetailCount: integer(cells[7]), metadataSnapshotHash: text(cells[8]), paymentLastSuccessAt: nullable(cells[9]), productSalesLastSuccessAt: nullable(cells[10]), cursor: integer(cells[11]), status: text(cells[12]) as JeraAllocationCoverageStatus, lastAttemptAt: nullable(cells[13]), lastSuccessAt: nullable(cells[14]), safeErrorCode: nullable(cells[15]), leaseOwner: nullable(cells[16]), leaseExpiresAt: nullable(cells[17]), taskAttempt: integer(cells[18]), productSalesRowCount: integer(cells[19]),
}) }
function detailCells(value: JeraCachedPaymentDetail): unknown[] { return [value.detailKey, value.branchUuid, value.eventDate, value.paymentUuid, value.paymentSourceHash, value.detailSourceHash, value.detailFetchedAt, value.lineCount, value.truncated] }
function lineCells(detailKey: string, value: JeraCachedPaymentDetailLine): unknown[] { return [detailKey, value.lineOrdinal, value.lineKind, value.itemCode ?? '', value.netLineSatang] }
function coverageCells(value: JeraAllocationCoverage): unknown[] { return [value.dayKey, value.branchUuid, value.eventDate, value.paymentCacheKey, value.productSalesCacheKey, value.paymentSetHash, value.paymentRowCount, value.successfulDetailCount, value.metadataSnapshotHash, value.paymentLastSuccessAt ?? '', value.productSalesLastSuccessAt ?? '', value.cursor, value.status, value.lastAttemptAt ?? '', value.lastSuccessAt ?? '', value.safeErrorCode ?? '', value.leaseOwner ?? '', value.leaseExpiresAt ?? '', value.taskAttempt, value.productSalesRowCount] }
function stripDetailKey(value: JeraCachedPaymentDetailLine & { detailKey: string }): JeraCachedPaymentDetailLine {
  return {
    lineOrdinal: value.lineOrdinal, lineKind: value.lineKind,
    itemCode: value.itemCode, netLineSatang: value.netLineSatang,
  }
}
function stripLines(value: JeraCachedPaymentDetail): Omit<JeraCachedPaymentDetail, 'lines'> {
  return structuredClone({
    detailKey: value.detailKey,
    branchUuid: value.branchUuid,
    eventDate: value.eventDate,
    paymentUuid: value.paymentUuid,
    paymentSourceHash: value.paymentSourceHash,
    detailSourceHash: value.detailSourceHash,
    detailFetchedAt: value.detailFetchedAt,
    lineCount: value.lineCount,
    truncated: value.truncated,
  })
}
function recycleRows(target: number[], rows: number[]): void {
  const unique = new Set([...target, ...rows])
  target.splice(0, target.length, ...[...unique].sort((a, b) => a - b))
}
function validateReadDays(inputs: Array<{
  branchUuid: string; eventDate: string; paymentSetHash: string; metadataSnapshotHash: string
}>): void {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 31) invalid()
  for (const input of inputs) {
    assertUuid(input.branchUuid); assertDate(input.eventDate); assertHash(input.paymentSetHash); assertHash(input.metadataSnapshotHash)
  }
}
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
function sameHeader(actual: string[], expected: readonly string[]): boolean { return actual.length === expected.length && actual.every((value, index) => value === expected[index]) }
function columnName(count: number): string { let value = count; let result = ''; while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26) } return result }
function invalid(): never { throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_INVALID_INPUT') }
function corrupt(): never { throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_CORRUPT_ROW') }
function rowLimit(): never { throw new JeraAllocationStoreError('JERA_ALLOCATION_STORE_ROW_LIMIT') }
async function withMutex<T>(key: string, operation: () => Promise<T>): Promise<T> { const previous = mutexes.get(key) ?? Promise.resolve(); let release = (): void => undefined; const current = new Promise<void>((resolve) => { release = resolve }); const queued = previous.then(() => current); mutexes.set(key, queued); await previous; try { return await operation() } finally { release(); if (mutexes.get(key) === queued) mutexes.delete(key) } }
