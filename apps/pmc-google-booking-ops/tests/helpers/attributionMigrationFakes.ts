export function advancedMetadataFixture(): Record<string, unknown> {
  return {
    properties: {
      sheetId: 11,
      title: 'BOOKING_MASTER',
      gridProperties: {
        rowCount: 20, columnCount: 5, frozenRowCount: 1, frozenColumnCount: 2,
        hideGridlines: false, rowGroupControlAfter: true, columnGroupControlAfter: false,
      },
    },
    data: [{
      startRow: 0,
      startColumn: 0,
      rowData: [
        { values: metadataCells(5, 'header') },
        { values: metadataCells(5, 'body') },
      ],
      rowMetadata: [
        { pixelSize: 32, hiddenByUser: false },
        { pixelSize: 24, hiddenByUser: false },
      ],
      columnMetadata: [
        { pixelSize: 120, hiddenByUser: false },
        { pixelSize: 80, hiddenByUser: false },
        { pixelSize: 160, hiddenByUser: false },
        { pixelSize: 140, hiddenByUser: true },
        { pixelSize: 100, hiddenByUser: false },
      ],
    }],
    merges: [range(0, 1, 0, 5)],
    basicFilter: {
      range: range(0, 20, 0, 5),
      criteria: { 3: { hiddenValues: ['ARCHIVED'] } },
      sortSpecs: [{ dimensionIndex: 3, sortOrder: 'ASCENDING' }],
    },
    filterViews: [{
      filterViewId: 21,
      title: 'Open',
      range: range(0, 20, 0, 5),
      criteria: { 3: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'OPEN' }] } } },
      sortSpecs: [{ dimensionIndex: 3, sortOrder: 'ASCENDING' }],
    }],
    bandedRanges: [{
      bandedRangeId: 31,
      range: range(0, 20, 0, 5),
      rowProperties: {
        firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
        secondBandColorStyle: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } },
      },
    }],
    conditionalFormats: [{
      ranges: [range(1, 20, 3, 4)],
      booleanRule: {
        condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'OPEN' }] },
        format: { backgroundColorStyle: { rgbColor: { red: 1, green: 0.9, blue: 0.9 } } },
      },
    }],
    rowGroups: [{ range: { sheetId: 11, dimension: 'ROWS', startIndex: 2, endIndex: 6 }, depth: 1, collapsed: false }],
    columnGroups: [{ range: { sheetId: 11, dimension: 'COLUMNS', startIndex: 3, endIndex: 5 }, depth: 1, collapsed: false }],
  }
}

export function metadataFixtureWithInsertedColumn(
  source: Record<string, unknown>,
  insertedColumn: number,
): Record<string, unknown> {
  const target = clone(source)
  const properties = target.properties as Record<string, unknown>
  const grid = properties.gridProperties as Record<string, unknown>
  grid.columnCount = Number(grid.columnCount) + 1
  if (Number(grid.frozenColumnCount) > insertedColumn) {
    grid.frozenColumnCount = Number(grid.frozenColumnCount) + 1
  }
  const data = (target.data as Array<Record<string, unknown>>)[0]
  for (const row of data.rowData as Array<{ values: unknown[] }>) row.values.splice(insertedColumn, 0, {})
  ;(data.columnMetadata as unknown[]).splice(insertedColumn, 0, { pixelSize: 100, hiddenByUser: false })
  shiftSheetRanges(target, insertedColumn)
  return target
}

export function mutateMetadataComponent(
  source: Record<string, unknown>,
  component: string,
): Record<string, unknown> {
  const value = clone(source)
  const data = (value.data as Array<Record<string, unknown>>)[0]
  const cell = ((data.rowData as Array<{ values: Array<Record<string, unknown>> }>)[1].values[1])
  if (component === 'format') cell.userEnteredFormat = { backgroundColorStyle: { rgbColor: { red: 0.1 } } }
  else if (component === 'validation') cell.dataValidation = { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=OTHER!$A$2:$A$9' }] }, strict: true }
  else if (component === 'note') cell.note = 'changed'
  else if (component === 'textRuns') cell.textFormatRuns = [{ startIndex: 0, format: { bold: false } }]
  else if (component === 'formula') cell.userEnteredValue = { formulaValue: '=CONFIG_STAFF!$B$2' }
  else if (component === 'rowSize') (data.rowMetadata as Array<Record<string, unknown>>)[1].pixelSize = 99
  else if (component === 'columnHidden') (data.columnMetadata as Array<Record<string, unknown>>)[1].hiddenByUser = true
  else if (component === 'frozen') ((value.properties as Record<string, Record<string, unknown>>).gridProperties).frozenColumnCount = 3
  else if (component === 'merge') ((value.merges as Array<Record<string, unknown>>)[0]).endColumnIndex = 4
  else if (component === 'basicFilter') ((value.basicFilter as Record<string, unknown>).criteria as Record<string, unknown>)['2'] = { hiddenValues: ['X'] }
  else if (component === 'filterView') (value.filterViews as Array<Record<string, unknown>>)[0].title = 'Changed'
  else if (component === 'banding') (value.bandedRanges as Array<Record<string, unknown>>)[0].bandedRangeId = 99
  else if (component === 'conditional') (value.conditionalFormats as Array<Record<string, unknown>>)[0].booleanRule = { condition: { type: 'ISBLANK' } }
  else if (component === 'rowGroup') (value.rowGroups as Array<Record<string, unknown>>)[0].collapsed = true
  else if (component === 'columnGroup') (value.columnGroups as Array<Record<string, unknown>>)[0].depth = 2
  else throw new Error(`unknown metadata component: ${component}`)
  return value
}

function metadataCells(count: number, kind: string): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_value, index) => ({
    userEnteredFormat: {
      backgroundColorStyle: { rgbColor: { red: index / 10, green: 0.9, blue: 0.8 } },
      borders: { bottom: { style: 'SOLID', colorStyle: { rgbColor: { red: 0.2, green: 0.2, blue: 0.2 } } } },
      horizontalAlignment: index % 2 ? 'LEFT' : 'CENTER',
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'WRAP',
      textRotation: { angle: 0 },
      textFormat: { bold: kind === 'header', fontFamily: 'Arial', fontSize: 10 },
      numberFormat: { type: 'TEXT', pattern: '@' },
      padding: { top: 2, right: 2, bottom: 2, left: 2 },
    },
    dataValidation: index === 1 ? {
      condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=CONFIG_STAFF!$A$2:$A$10' }] },
      strict: true,
      showCustomUi: true,
      inputMessage: 'Choose',
    } : undefined,
    note: index === 2 ? 'operator note' : undefined,
    textFormatRuns: index === 3 ? [{ startIndex: 0, format: { bold: true } }] : undefined,
    userEnteredValue: index === 1 ? { formulaValue: '=CONFIG_STAFF!$A$2' } : undefined,
  }))
}

function shiftSheetRanges(value: Record<string, unknown>, inserted: number): void {
  const shiftRange = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
    const range = candidate as Record<string, unknown>
    if (typeof range.startColumnIndex === 'number' && range.startColumnIndex >= inserted) range.startColumnIndex += 1
    if (typeof range.endColumnIndex === 'number' && range.endColumnIndex > inserted) range.endColumnIndex += 1
  }
  for (const merge of value.merges as unknown[]) shiftRange(merge)
  const basic = value.basicFilter as Record<string, unknown>
  shiftRange(basic.range)
  shiftIndexedCriteria(basic, inserted)
  for (const view of value.filterViews as Array<Record<string, unknown>>) {
    shiftRange(view.range); shiftIndexedCriteria(view, inserted)
  }
  for (const band of value.bandedRanges as Array<Record<string, unknown>>) shiftRange(band.range)
  for (const rule of value.conditionalFormats as Array<Record<string, unknown>>) {
    for (const range of rule.ranges as unknown[]) shiftRange(range)
  }
  for (const group of value.columnGroups as Array<Record<string, unknown>>) shiftDimensionRange(group.range, inserted)
}

function shiftIndexedCriteria(container: Record<string, unknown>, inserted: number): void {
  const criteria = (container.criteria ?? {}) as Record<string, unknown>
  container.criteria = Object.fromEntries(Object.entries(criteria).map(([key, value]) => [
    String(Number(key) >= inserted ? Number(key) + 1 : Number(key)), value,
  ]))
  for (const sort of (container.sortSpecs ?? []) as Array<Record<string, unknown>>) {
    if (Number(sort.dimensionIndex) >= inserted) sort.dimensionIndex = Number(sort.dimensionIndex) + 1
  }
}

function shiftDimensionRange(candidate: unknown, inserted: number): void {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
  const range = candidate as Record<string, unknown>
  if (range.dimension !== 'COLUMNS') return
  if (Number(range.startIndex) >= inserted) range.startIndex = Number(range.startIndex) + 1
  if (Number(range.endIndex) > inserted) range.endIndex = Number(range.endIndex) + 1
}

function range(startRow: number, endRow: number, startColumn: number, endColumn: number) {
  return { sheetId: 11, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startColumn, endColumnIndex: endColumn }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
