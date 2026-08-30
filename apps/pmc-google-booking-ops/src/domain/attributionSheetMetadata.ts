export interface NormalizedAttributionSheetMetadata {
  structure: unknown
  rows: unknown[]
}

const ALLOWED_SHEET_KEYS = new Set([
  'properties', 'data', 'merges', 'basicFilter', 'filterViews', 'bandedRanges',
  'conditionalFormats', 'rowGroups', 'columnGroups',
])
const UNSUPPORTED_SHEET_KEYS = new Set([
  'charts', 'tables', 'protectedRanges', 'developerMetadata', 'slicers', 'drawings',
])

export function normalizeAttributionSheetMetadata(
  input: unknown,
  insertedColumnIndexes: readonly number[],
): NormalizedAttributionSheetMetadata {
  const sheet = record(input)
  const inserted = normalizedInsertedColumns(insertedColumnIndexes)
  rejectUnsupportedSheetObjects(sheet)
  const properties = record(sheet.properties)
  const grid = record(properties.gridProperties)
  if (properties.sheetType !== undefined && properties.sheetType !== 'GRID') {
    throw new Error('UNSUPPORTED_SHEETS_METADATA')
  }
  const originalColumnCount = integer(grid.columnCount, 'UNSUPPORTED_SHEETS_METADATA')
  integer(grid.rowCount, 'UNSUPPORTED_SHEETS_METADATA')
  const title = text(properties.title)
  rejectUnstableFormulaReferences(sheet, title)
  if (inserted.some((index) => index >= originalColumnCount)) throw new Error('UNSUPPORTED_SHEETS_METADATA')
  const frozenColumns = optionalInteger(grid.frozenColumnCount) ?? 0
  const normalizedGrid = sortedObject({
    columnCount: originalColumnCount - inserted.length,
    frozenRowCount: optionalInteger(grid.frozenRowCount) ?? 0,
    frozenColumnCount: normalizeBoundary(frozenColumns, inserted),
    hideGridlines: grid.hideGridlines ?? false,
    rowGroupControlAfter: grid.rowGroupControlAfter ?? false,
    columnGroupControlAfter: grid.columnGroupControlAfter ?? false,
  })

  const gridMetadata = normalizeGridData(sheet.data, inserted)
  return {
    structure: sortedObject({
      title,
      gridProperties: normalizedGrid,
      columnMetadata: gridMetadata.columns,
      merges: normalizeRanges(sheet.merges, inserted),
      basicFilter: normalizeFilter(sheet.basicFilter, inserted),
      filterViews: array(sheet.filterViews).map((item) => normalizeFilter(item, inserted)),
      bandedRanges: array(sheet.bandedRanges).map((item) => normalizeBandedRange(item, inserted)),
      conditionalFormats: array(sheet.conditionalFormats).map((item) => normalizeConditionalRule(item, inserted)),
      rowGroups: array(sheet.rowGroups).map((item) => normalizeDimensionGroup(item, inserted)),
      columnGroups: array(sheet.columnGroups).map((item) => normalizeDimensionGroup(item, inserted)),
    }),
    rows: gridMetadata.rows,
  }
}

function rejectUnstableFormulaReferences(value: unknown, sheetTitle: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => rejectUnstableFormulaReferences(item, sheetTitle))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'userEnteredValue' || key === 'formulaValue')
      && typeof item === 'string' && item.startsWith('=')) {
      const quotedTitle = `'${sheetTitle.replace(/'/g, "''")}'!`
      if (!item.includes('!') || item.includes(`${sheetTitle}!`) || item.includes(quotedTitle)) {
        throw new Error('UNSUPPORTED_SHEETS_METADATA')
      }
    }
    rejectUnstableFormulaReferences(item, sheetTitle)
  }
}

function normalizeGridData(value: unknown, inserted: readonly number[]): {
  columns: unknown[]
  rows: unknown[]
} {
  const columns = new Map<number, unknown>()
  const rows = new Map<number, { rowMetadata?: unknown; cells: Map<number, unknown> }>()
  for (const segmentValue of array(value)) {
    const segment = record(segmentValue)
    rejectUnknownNonempty(segment, new Set(['startRow', 'startColumn', 'rowData', 'rowMetadata', 'columnMetadata']))
    const startRow = optionalInteger(segment.startRow) ?? 0
    const startColumn = optionalInteger(segment.startColumn) ?? 0
    array(segment.columnMetadata).forEach((metadata, offset) => {
      const absolute = startColumn + offset
      if (inserted.includes(absolute)) return
      columns.set(normalizeColumn(absolute, inserted), sortedObject(record(metadata)))
    })
    array(segment.rowMetadata).forEach((metadata, offset) => {
      const rowIndex = startRow + offset
      const current = rows.get(rowIndex) ?? { cells: new Map<number, unknown>() }
      current.rowMetadata = sortedObject(record(metadata))
      rows.set(rowIndex, current)
    })
    array(segment.rowData).forEach((rowValue, rowOffset) => {
      const rowIndex = startRow + rowOffset
      const current = rows.get(rowIndex) ?? { cells: new Map<number, unknown>() }
      const row = record(rowValue)
      rejectUnknownNonempty(row, new Set(['values']))
      array(row.values).forEach((cellValue, columnOffset) => {
        const absolute = startColumn + columnOffset
        if (inserted.includes(absolute)) return
        const metadata = normalizeCellMetadata(cellValue)
        if (metadata !== null) current.cells.set(normalizeColumn(absolute, inserted), metadata)
      })
      rows.set(rowIndex, current)
    })
  }
  return {
    columns: [...columns.entries()].sort(numberEntry).map(([index, metadata]) => ({ index, metadata })),
    rows: [...rows.entries()].sort(numberEntry).map(([rowIndex, value]) => sortedObject({
      rowIndex,
      rowMetadata: value.rowMetadata ?? {},
      cells: [...value.cells.entries()].sort(numberEntry).map(([columnIndex, metadata]) => ({ columnIndex, metadata })),
    })),
  }
}

function normalizeCellMetadata(value: unknown): unknown | null {
  const cell = record(value)
  if (nonempty(cell.pivotTable)
    || nonempty(cell.dataSourceTable)
    || nonempty(cell.dataSourceFormula)) {
    throw new Error('UNSUPPORTED_SHEETS_METADATA')
  }
  const selected = sortedObject({
    userEnteredFormula: record(cell.userEnteredValue).formulaValue,
    userEnteredFormat: cell.userEnteredFormat,
    dataValidation: cell.dataValidation,
    note: cell.note,
    textFormatRuns: cell.textFormatRuns,
  })
  return Object.keys(selected).length > 0 ? selected : null
}

function normalizeFilter(value: unknown, inserted: readonly number[]): unknown {
  if (!nonempty(value)) return null
  const filter = record(value)
  if (nonempty(filter.tableId) || nonempty(filter.namedRangeId)) throw new Error('UNSUPPORTED_SHEETS_METADATA')
  return sortedObject({
    filterViewId: filter.filterViewId,
    title: filter.title,
    range: normalizeRange(filter.range, inserted),
    criteria: normalizeIndexedObject(filter.criteria, inserted),
    sortSpecs: array(filter.sortSpecs).map((item) => {
      const sort = record(item)
      return sortedObject({
        ...sort,
        dimensionIndex: normalizeColumn(integer(sort.dimensionIndex, 'UNSUPPORTED_SHEETS_METADATA'), inserted),
      })
    }),
  })
}

function normalizeBandedRange(value: unknown, inserted: readonly number[]): unknown {
  const band = { ...record(value) }
  band.range = normalizeRange(band.range, inserted)
  return sortedObject(band)
}

function normalizeConditionalRule(value: unknown, inserted: readonly number[]): unknown {
  const rule = { ...record(value) }
  rule.ranges = normalizeRanges(rule.ranges, inserted)
  return sortedObject(rule)
}

function normalizeDimensionGroup(value: unknown, inserted: readonly number[]): unknown {
  const group = { ...record(value) }
  const range = record(group.range)
  if (range.dimension === 'COLUMNS') {
    group.range = sortedObject({
      dimension: 'COLUMNS',
      startIndex: normalizeBoundary(integer(range.startIndex, 'UNSUPPORTED_SHEETS_METADATA'), inserted),
      endIndex: normalizeBoundary(integer(range.endIndex, 'UNSUPPORTED_SHEETS_METADATA'), inserted),
    })
  } else if (range.dimension === 'ROWS') {
    group.range = sortedObject({
      dimension: 'ROWS',
      startIndex: integer(range.startIndex, 'UNSUPPORTED_SHEETS_METADATA'),
      endIndex: integer(range.endIndex, 'UNSUPPORTED_SHEETS_METADATA'),
    })
  } else {
    throw new Error('UNSUPPORTED_SHEETS_METADATA')
  }
  return sortedObject(group)
}

function normalizeRanges(value: unknown, inserted: readonly number[]): unknown[] {
  return array(value).map((item) => normalizeRange(item, inserted))
}

function normalizeRange(value: unknown, inserted: readonly number[]): unknown {
  const range = record(value)
  const startColumn = optionalInteger(range.startColumnIndex)
  const endColumn = optionalInteger(range.endColumnIndex)
  return sortedObject({
    startRowIndex: optionalInteger(range.startRowIndex),
    endRowIndex: optionalInteger(range.endRowIndex),
    startColumnIndex: startColumn === undefined ? undefined : normalizeBoundary(startColumn, inserted),
    endColumnIndex: endColumn === undefined ? undefined : normalizeBoundary(endColumn, inserted),
  })
}

function normalizeIndexedObject(value: unknown, inserted: readonly number[]): unknown {
  if (!nonempty(value)) return {}
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record(value))) {
    if (!/^\d+$/.test(key)) throw new Error('UNSUPPORTED_SHEETS_METADATA')
    const index = Number(key)
    if (inserted.includes(index)) continue
    result[String(normalizeColumn(index, inserted))] = sortedObject(item)
  }
  return sortedObject(result)
}

function rejectUnsupportedSheetObjects(sheet: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(sheet)) {
    if (UNSUPPORTED_SHEET_KEYS.has(key) && nonempty(value)) throw new Error('UNSUPPORTED_SHEETS_METADATA')
    if (!ALLOWED_SHEET_KEYS.has(key) && !UNSUPPORTED_SHEET_KEYS.has(key) && nonempty(value)) {
      throw new Error('UNSUPPORTED_SHEETS_METADATA')
    }
  }
}

function rejectUnknownNonempty(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key) && nonempty(item)) throw new Error('UNSUPPORTED_SHEETS_METADATA')
  }
}

function normalizedInsertedColumns(value: readonly number[]): number[] {
  if (value.some((item) => !Number.isSafeInteger(item) || item < 0)) throw new Error('UNSUPPORTED_SHEETS_METADATA')
  const result = [...new Set(value)].sort((left, right) => left - right)
  if (result.length !== value.length) throw new Error('UNSUPPORTED_SHEETS_METADATA')
  return result
}

function normalizeColumn(index: number, inserted: readonly number[]): number {
  if (inserted.includes(index)) throw new Error('UNSUPPORTED_SHEETS_METADATA')
  return normalizeBoundary(index, inserted)
}

function normalizeBoundary(index: number, inserted: readonly number[]): number {
  return index - inserted.filter((insertedIndex) => insertedIndex < index).length
}

function sortedObject(value: unknown): Record<string, unknown> {
  const candidate = record(value)
  return Object.fromEntries(Object.keys(candidate).sort().flatMap((key) => {
    const item = candidate[key]
    if (item === undefined) return []
    return [[key, normalizeNested(item)]]
  }))
}

function normalizeNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNested)
  if (value && typeof value === 'object') return sortedObject(value)
  return value
}

function numberEntry(left: [number, unknown], right: [number, unknown]): number {
  return left[0] - right[0]
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function nonempty(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  if (typeof value === 'string') return value.length > 0
  return true
}

function integer(value: unknown, error: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(error)
  return Number(value)
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  return integer(value, 'UNSUPPORTED_SHEETS_METADATA')
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('UNSUPPORTED_SHEETS_METADATA')
  return value
}
