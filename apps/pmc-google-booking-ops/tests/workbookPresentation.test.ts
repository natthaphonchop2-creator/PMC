import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PMC_MINI_APP_REQUEST_HEADERS_V2 } from '../../../shared/pmcBookingRowContracts'
import { SHEET_SCHEMAS } from '../src/sheetSchema'
import {
  COLUMN_WIDTHS,
  VISIBLE_TAB_ORDER,
  buildWorkbookPresentationPlan,
  verifyWorkbookPresentation,
  type GridRangeSnapshot,
  type SheetPresentationSnapshot,
  type WorkbookMetadataSnapshot,
  type WorkbookPresentationAction,
  type WorkbookPresentationPlan,
} from '../src/domain/workbookPresentation'

const MINI_APP_SYSTEM_HEADERS = {
  MINI_APP_REQUESTS: PMC_MINI_APP_REQUEST_HEADERS_V2,
  MINI_APP_LINK_ATTEMPTS: [
    'lineUserIdHash', 'failureCount', 'windowStartedAt', 'lockedUntil', 'lastAttemptAt',
  ],
  JERA_API_CACHE: [
    'cacheKey', 'reportType', 'sourceUuid', 'branchUuid', 'branchName', 'eventDate', 'patientUuid',
    'patientCode', 'patientName', 'paymentCode', 'status', 'type', 'totalSatang', 'paidAmountSatang',
    'refundAmountSatang', 'cashSatang', 'transferSatang', 'creditCardSatang', 'eWalletSatang',
    'paymentLinkSatang', 'otherPaymentSatang', 'itemCode', 'itemName', 'quantity',
    'remainingQuantity', 'remainingValueSatang', 'doctorName', 'salespersonName', 'sourceCreatedAt',
    'sourceUpdatedAt', 'fetchedAt', 'sourceHash',
  ],
  JERA_SYNC_STATE: [
    'cacheKey', 'reportType', 'filterHash', 'lastAttemptAt', 'lastManualAt', 'lastSuccessAt',
    'lastSourceDate', 'status', 'recordCount', 'nextPage', 'safeErrorCode', 'leaseOwner', 'leaseExpiresAt',
  ],
  JERA_SYNC_AUDIT: [
    'syncRunId', 'actorType', 'actorId', 'reportType', 'filterHash', 'startedAt', 'finishedAt',
    'status', 'recordCount', 'safeErrorCode', 'correlationId',
  ],
  JERA_PAYMENT_DETAIL_CACHE: [
    'detailKey', 'branchUuid', 'eventDate', 'paymentUuid', 'paymentSourceHash',
    'detailSourceHash', 'detailFetchedAt', 'lineCount', 'truncated',
  ],
  JERA_PAYMENT_DETAIL_LINES: [
    'detailKey', 'lineOrdinal', 'lineKind', 'itemCode', 'netLineSatang',
  ],
  JERA_ALLOCATION_COVERAGE: [
    'dayKey', 'branchUuid', 'eventDate', 'paymentCacheKey', 'productSalesCacheKey', 'paymentSetHash',
    'paymentRowCount', 'successfulDetailCount', 'metadataSnapshotHash', 'paymentLastSuccessAt',
    'productSalesLastSuccessAt', 'cursor', 'status', 'lastAttemptAt', 'lastSuccessAt',
    'safeErrorCode', 'leaseOwner', 'leaseExpiresAt', 'taskAttempt', 'productSalesRowCount',
  ],
} as const

const HIDDEN_FIXTURES: ReadonlyArray<{ title: string; headers: readonly string[] }> = Object.entries({
  ...Object.fromEntries(Object.entries(SHEET_SCHEMAS).filter(([title]) => (
    title !== 'DASHBOARD' && !VISIBLE_TAB_ORDER.includes(title as typeof VISIBLE_TAB_ORDER[number])
  ))),
  ...MINI_APP_SYSTEM_HEADERS,
  FORM_RESPONSES: ['Timestamp', 'Email'],
}).map(([title, headers]) => ({ title, headers }))

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('guarded Booking workbook presentation policy', () => {
  it('builds the exact deterministic visible, hidden, freeze, filter, width, format, and status plan', () => {
    const snapshot = canonicalSnapshot()
    const plan = buildPlan(snapshot)
    const replay = buildPlan(cloneSnapshot(snapshot))

    expect(plan.visibleOrder).toEqual([
      'DASHBOARD', 'BOOKING_MASTER', 'CALL_QUEUE', 'RECONCILIATION', 'RETENTION_QUEUE',
      'CONFIG_ADMINS', 'CONFIG_STAFF', 'CONFIG_DOCTORS', 'CONFIG_SERVICES',
      'CONFIG_CHANNELS', 'CONFIG_RULES',
    ])
    expect(plan).toEqual(replay)
    expect(new Set(plan.actions.map((action) => action.kind))).toEqual(new Set([
      'MOVE_SHEET', 'SET_HIDDEN', 'SET_FROZEN', 'SET_BASIC_FILTER',
      'SET_COLUMN_WIDTH', 'FORMAT_RANGE', 'ADD_STATUS_RULE',
    ]))
    expect(plan.actions.every((action) => [
      'MOVE_SHEET', 'SET_HIDDEN', 'SET_FROZEN', 'SET_BASIC_FILTER',
      'SET_COLUMN_WIDTH', 'FORMAT_RANGE', 'ADD_STATUS_RULE',
    ].includes(action.kind))).toBe(true)

    const hiddenIds = new Set(HIDDEN_FIXTURES.map(({ title }) => sheet(snapshot, title).sheetId))
    expect(HIDDEN_FIXTURES).toHaveLength(20)
    expect(plan.actions.filter((action) => action.kind === 'SET_HIDDEN')).toEqual(
      expect.arrayContaining([...hiddenIds].map((sheetId) => ({ kind: 'SET_HIDDEN', sheetId, hidden: true }))),
    )

    const frozen = plan.actions.filter((action) => action.kind === 'SET_FROZEN')
    expect(frozen).toContainEqual({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId, rows: 1, columns: 3,
    })
    expect(frozen).toContainEqual({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'CALL_QUEUE').sheetId, rows: 1, columns: 2,
    })

    const filters = plan.actions.filter((action) => action.kind === 'SET_BASIC_FILTER')
    expect(filters.map((action) => titleForId(snapshot, action.range.sheetId))).toEqual([
      'BOOKING_MASTER', 'CALL_QUEUE', 'RECONCILIATION', 'RETENTION_QUEUE',
    ])
    expect(filters).not.toContainEqual(expect.objectContaining({
      range: expect.objectContaining({ sheetId: sheet(snapshot, 'DASHBOARD').sheetId }),
    }))
    for (const action of filters) {
      const target = snapshot.sheets.find(({ sheetId }) => sheetId === action.range.sheetId)!
      expect(action.range).toEqual(fullGrid(target))
    }

    const widths = plan.actions.filter((action) => action.kind === 'SET_COLUMN_WIDTH')
    expect(widths).toContainEqual({
      kind: 'SET_COLUMN_WIDTH',
      sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId,
      columnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('driveFolderUrl'),
      pixelSize: 240,
    })
    expect(widths).toContainEqual({
      kind: 'SET_COLUMN_WIDTH',
      sheetId: sheet(snapshot, 'CALL_QUEUE').sheetId,
      columnIndex: SHEET_SCHEMAS.CALL_QUEUE!.indexOf('note'),
      pixelSize: 320,
    })
    expect(COLUMN_WIDTHS.DASHBOARD).toEqual([220, 140, 130, 120, 130, 130, 180, 145])

    const formats = plan.actions.filter((action) => action.kind === 'FORMAT_RANGE')
    expect(formats).toContainEqual(expect.objectContaining({
      range: expect.objectContaining({
        sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId,
        startColumnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('phoneNormalized'),
        endColumnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('phoneNormalized') + 1,
      }),
      styleKey: 'BODY_PLAIN_TEXT',
    }))
    expect(formats).toContainEqual(expect.objectContaining({
      range: expect.objectContaining({
        sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId,
        startColumnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('depositAmount'),
      }),
      styleKey: 'BODY_CURRENCY',
    }))
    expect(formats).toContainEqual(expect.objectContaining({
      range: expect.objectContaining({
        sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId,
        startColumnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('commissionEligibility'),
      }),
      styleKey: 'BODY',
    }))
    expect(formats).toContainEqual(expect.objectContaining({
      range: expect.objectContaining({
        sheetId: sheet(snapshot, 'RECONCILIATION').sheetId,
        startColumnIndex: SHEET_SCHEMAS.RECONCILIATION!.indexOf('candidateCaseIds'),
      }),
      styleKey: 'BODY_PLAIN_TEXT_WRAP',
    }))

    const statusRules = plan.actions.filter((action) => action.kind === 'ADD_STATUS_RULE')
    expect(statusRules.map((action) => action.ruleKey)).toEqual([
      'BOOKING_STATUS', 'APPOINTMENT_STATUS', 'CALL_STATUS',
      'RECONCILIATION_STATUS', 'RETENTION_STATUS',
    ])
    const dashboard = sheet(snapshot, 'DASHBOARD')
    expect(formats.filter((action) => action.range.sheetId === dashboard.sheetId)).toEqual([
      { kind: 'FORMAT_RANGE', range: gridRange(dashboard, 0, 1, 0, 2), styleKey: 'HEADER' },
      { kind: 'FORMAT_RANGE', range: gridRange(dashboard, 1, 10, 0, 2), styleKey: 'BODY' },
      { kind: 'FORMAT_RANGE', range: gridRange(dashboard, 12, 13, 0, 8), styleKey: 'HEADER' },
      { kind: 'FORMAT_RANGE', range: gridRange(dashboard, 13, dashboard.maxRows, 0, 8), styleKey: 'BODY' },
    ])

    expect(plan.actions).toContainEqual({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'MINI_APP_REQUESTS').sheetId, rows: 1, columns: 0,
    })
    expect(plan.actions).not.toContainEqual(expect.objectContaining({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'FORM_RESPONSES').sheetId,
    }))
    expect(plan.expectedPresentationFingerprint).toMatch(/^wp1-[0-9a-f]{64}$/)
  })

  it.each([
    ['unknown tab', (value: WorkbookMetadataSnapshot) => addSheet(value, 'UNKNOWN_TAB'), 'UNCLASSIFIED_TAB'],
    ['unknown prefixed tab', (value: WorkbookMetadataSnapshot) => addSheet(value, 'MINI_APP_UNKNOWN'), 'UNCLASSIFIED_TAB'],
    ['missing managed tab', (value: WorkbookMetadataSnapshot) => removeSheet(value, 'CALL_QUEUE'), 'MISSING_MANAGED_TAB'],
    ['duplicate title', (value: WorkbookMetadataSnapshot) => renameSheet(value, 'FORM_RESPONSES', 'DASHBOARD'), 'DUPLICATE_TAB_TITLE'],
    ['duplicate sheet id', (value: WorkbookMetadataSnapshot) => duplicateSheetId(value), 'DUPLICATE_SHEET_ID'],
    ['duplicate index', (value: WorkbookMetadataSnapshot) => duplicateIndex(value), 'DUPLICATE_SHEET_INDEX'],
    ['wrong header', (value: WorkbookMetadataSnapshot) => mutateHeader(value), 'HEADER_MISMATCH'],
    ['unexpected basic filter', (value: WorkbookMetadataSnapshot) => setUnexpectedFilter(value), 'UNEXPECTED_BASIC_FILTER'],
    ['filter view', (value: WorkbookMetadataSnapshot) => patchSheet(value, 'CALL_QUEUE', { filterViewCount: 1 }), 'UNEXPECTED_FILTER_VIEW'],
    ['merged cells', (value: WorkbookMetadataSnapshot) => patchSheet(value, 'CALL_QUEUE', { mergedRangeCount: 1 }), 'UNEXPECTED_MERGED_RANGE'],
    ['protected range', (value: WorkbookMetadataSnapshot) => patchSheet(value, 'CALL_QUEUE', { protectedRangeCount: 1 }), 'UNEXPECTED_PROTECTED_RANGE'],
    ['unsupported metadata', (value: WorkbookMetadataSnapshot) => patchSheet(value, 'CALL_QUEUE', { unsupportedMetadataCount: 1 }), 'UNSUPPORTED_PRESENTATION_METADATA'],
  ])('fails closed on %s before producing actions', (_label, mutate, errorCode) => {
    const snapshot = canonicalSnapshot()
    mutate(snapshot)
    expect(() => buildPlan(snapshot)).toThrow(errorCode)
  })

  it.each(HIDDEN_FIXTURES.filter(({ title }) => title !== 'FORM_RESPONSES'))(
    'rejects exact managed-header drift on hidden tab $title',
    ({ title }) => {
      const snapshot = canonicalSnapshot()
      const target = sheet(snapshot, title)
      target.headers = ['wrong', ...target.headers.slice(1)]
      expect(() => buildPlan(snapshot)).toThrow('HEADER_MISMATCH')
    },
  )

  it('rejects duplicate or overlapping managed format and status metadata', () => {
    const snapshot = canonicalSnapshot()
    const target = sheet(snapshot, 'CALL_QUEUE')
    target.managedFormats = [
      { range: columnBody(target, 0), styleKey: 'BODY_PLAIN_TEXT' },
      { range: { ...columnBody(target, 0), endColumnIndex: 2 }, styleKey: 'BODY' },
    ]
    expect(() => buildPlan(snapshot)).toThrow('PRESENTATION_METADATA_CONFLICT')

    const statusConflict = canonicalSnapshot()
    const callQueue = sheet(statusConflict, 'CALL_QUEUE')
    const statusColumn = SHEET_SCHEMAS.CALL_QUEUE!.indexOf('status')
    callQueue.statusRules = [
      { range: columnBody(callQueue, statusColumn), ruleKey: 'CALL_STATUS' },
      { range: columnBody(callQueue, statusColumn), ruleKey: 'CALL_STATUS' },
    ]
    expect(() => buildPlan(statusConflict)).toThrow('PRESENTATION_METADATA_CONFLICT')
  })

  it('verifies immutable content hashes and the exact planned presentation, then becomes idempotent', () => {
    const before = canonicalSnapshot()
    const plan = buildPlan(before)
    const after = applyPlanForTest(before, plan)

    expect(() => verifyWorkbookPresentation(before, after, plan, sha256Hex)).not.toThrow()
    expect(buildPlan(after).actions).toEqual([])
    expect(buildPlan(after).expectedPresentationFingerprint)
      .toBe(plan.expectedPresentationFingerprint)

    const changedValue = cloneSnapshot(after)
    sheet(changedValue, 'BOOKING_MASTER').valuesHash = 'changed-value-hash'
    expect(() => verifyWorkbookPresentation(before, changedValue, plan, sha256Hex)).toThrow('VALUES_HASH_CHANGED')

    const changedFormula = cloneSnapshot(after)
    sheet(changedFormula, 'BOOKING_MASTER').formulasHash = 'changed-formula-hash'
    expect(() => verifyWorkbookPresentation(before, changedFormula, plan, sha256Hex)).toThrow('FORMULAS_HASH_CHANGED')

    const changedValidation = cloneSnapshot(after)
    sheet(changedValidation, 'BOOKING_MASTER').validationsHash = 'changed-validation-hash'
    expect(() => verifyWorkbookPresentation(before, changedValidation, plan, sha256Hex)).toThrow('VALIDATIONS_HASH_CHANGED')

    const changedProtection = cloneSnapshot(after)
    sheet(changedProtection, 'BOOKING_MASTER').protectionsHash = 'changed-protection-hash'
    expect(() => verifyWorkbookPresentation(before, changedProtection, plan, sha256Hex)).toThrow('PROTECTIONS_HASH_CHANGED')
  })

  it('fails verification for an incomplete result or a forged/conflicting plan', () => {
    const before = canonicalSnapshot()
    const plan = buildPlan(before)
    const incomplete = cloneSnapshot(before)
    expect(() => verifyWorkbookPresentation(before, incomplete, plan, sha256Hex)).toThrow('PRESENTATION_FINGERPRINT_MISMATCH')

    const forged: WorkbookPresentationPlan = {
      ...plan,
      actions: [
        ...plan.actions,
        {
          kind: 'SET_COLUMN_WIDTH',
          sheetId: sheet(before, 'BOOKING_MASTER').sheetId,
          columnIndex: 0,
          pixelSize: 999,
        },
      ],
    }
    expect(() => verifyWorkbookPresentation(before, applyPlanForTest(before, plan), forged, sha256Hex))
      .toThrow('PRESENTATION_PLAN_CONFLICT')
  })

  it('requires a valid injected SHA-256 implementation and has no weak production fallback', () => {
    const snapshot = canonicalSnapshot()
    expect(() => (buildWorkbookPresentationPlan as unknown as (
      value: WorkbookMetadataSnapshot,
    ) => WorkbookPresentationPlan)(snapshot)).toThrow('PRESENTATION_SHA256_REQUIRED')
    expect(() => buildWorkbookPresentationPlan(snapshot, () => 'weak'))
      .toThrow('INVALID_PRESENTATION_SHA256')
  })

  it('deep-freezes exported policy and every returned action range without changing later plans', () => {
    const snapshot = canonicalSnapshot()
    const before = buildPlan(snapshot)
    const ranged = before.actions.find((action) => 'range' in action)
    expect(ranged && 'range' in ranged && Object.isFrozen(ranged.range)).toBe(true)
    expect(Object.isFrozen(before.actions)).toBe(true)
    expect(Object.isFrozen(COLUMN_WIDTHS)).toBe(true)
    expect(Object.isFrozen(COLUMN_WIDTHS.DASHBOARD)).toBe(true)
    expect(Object.isFrozen(COLUMN_WIDTHS.BOOKING_MASTER)).toBe(true)
    expect(Object.isFrozen(VISIBLE_TAB_ORDER)).toBe(true)

    expect(() => { (VISIBLE_TAB_ORDER as unknown as string[])[0] = 'MUTATED' }).toThrow()
    expect(() => { (COLUMN_WIDTHS.DASHBOARD as unknown as number[])[0] = 1 }).toThrow()
    expect(() => {
      if (ranged && 'range' in ranged) ranged.range.startRowIndex = 999
    }).toThrow()

    expect(buildPlan(cloneSnapshot(snapshot))).toEqual(before)
  })

  it('preserves the source-owned Form freeze while enforcing row one on every exact managed hidden table', () => {
    const snapshot = canonicalSnapshot()
    sheet(snapshot, 'FORM_RESPONSES').frozenRows = 2
    sheet(snapshot, 'FORM_RESPONSES').frozenColumns = 1
    const plan = buildPlan(snapshot)
    expect(plan.actions).not.toContainEqual(expect.objectContaining({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'FORM_RESPONSES').sheetId,
    }))
    for (const { title } of HIDDEN_FIXTURES.filter(({ title }) => title !== 'FORM_RESPONSES')) {
      expect(plan.actions).toContainEqual({
        kind: 'SET_FROZEN', sheetId: sheet(snapshot, title).sheetId, rows: 1, columns: 0,
      })
    }
  })
})

function canonicalSnapshot(): WorkbookMetadataSnapshot {
  const visible = VISIBLE_TAB_ORDER.map((title) => ({
    title,
    headers: title === 'DASHBOARD' ? ['KPI', 'Value'] : SHEET_SCHEMAS[title]!,
  }))
  const definitions = [...HIDDEN_FIXTURES, ...visible]
  return {
    spreadsheetId: 'spreadsheet-test-id',
    fingerprint: 'source-full-fingerprint',
    sheets: definitions.map(({ title, headers }, index) => makeSheet(title, headers, index)),
  }
}

function makeSheet(title: string, headers: readonly string[], index: number): SheetPresentationSnapshot {
  const maxColumns = Math.max(title === 'DASHBOARD' ? 8 : headers.length, 1)
  return {
    sheetId: 100 + index,
    title,
    index,
    hidden: false,
    maxRows: 1_000,
    maxColumns,
    frozenRows: 0,
    frozenColumns: 0,
    headers: [...headers],
    basicFilter: null,
    filterViewCount: 0,
    mergedRangeCount: 0,
    protectedRangeCount: 0,
    unsupportedMetadataCount: 0,
    columnWidths: Array(maxColumns).fill(100),
    managedFormats: [],
    statusRules: [],
    valuesHash: `values-${index}`,
    formulasHash: `formulas-${index}`,
    validationsHash: `validations-${index}`,
    protectionsHash: `protections-${index}`,
  }
}

function sheet(snapshot: WorkbookMetadataSnapshot, title: string): SheetPresentationSnapshot {
  const found = snapshot.sheets.find((candidate) => candidate.title === title)
  if (!found) throw new Error(`test fixture missing ${title}`)
  return found as SheetPresentationSnapshot
}

function titleForId(snapshot: WorkbookMetadataSnapshot, sheetId: number): string {
  return snapshot.sheets.find((sheet) => sheet.sheetId === sheetId)?.title ?? 'missing'
}

function fullGrid(target: SheetPresentationSnapshot): GridRangeSnapshot {
  return {
    sheetId: target.sheetId,
    startRowIndex: 0,
    endRowIndex: target.maxRows,
    startColumnIndex: 0,
    endColumnIndex: target.headers.length,
  }
}

function gridRange(
  target: SheetPresentationSnapshot,
  startRowIndex: number,
  endRowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number,
): GridRangeSnapshot {
  return { sheetId: target.sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }
}

function columnBody(target: SheetPresentationSnapshot, columnIndex: number): GridRangeSnapshot {
  return {
    sheetId: target.sheetId,
    startRowIndex: 1,
    endRowIndex: target.maxRows,
    startColumnIndex: columnIndex,
    endColumnIndex: columnIndex + 1,
  }
}

function cloneSnapshot(snapshot: WorkbookMetadataSnapshot): WorkbookMetadataSnapshot {
  return structuredClone(snapshot)
}

function addSheet(snapshot: WorkbookMetadataSnapshot, title: string): void {
  ;(snapshot.sheets as SheetPresentationSnapshot[]).push(makeSheet(title, ['id'], snapshot.sheets.length))
}

function removeSheet(snapshot: WorkbookMetadataSnapshot, title: string): void {
  const index = snapshot.sheets.findIndex((candidate) => candidate.title === title)
  ;(snapshot.sheets as SheetPresentationSnapshot[]).splice(index, 1)
  snapshot.sheets.forEach((candidate, nextIndex) => { (candidate as SheetPresentationSnapshot).index = nextIndex })
}

function renameSheet(snapshot: WorkbookMetadataSnapshot, title: string, nextTitle: string): void {
  sheet(snapshot, title).title = nextTitle
}

function duplicateSheetId(snapshot: WorkbookMetadataSnapshot): void {
  snapshot.sheets[1]!.sheetId = snapshot.sheets[0]!.sheetId
}

function duplicateIndex(snapshot: WorkbookMetadataSnapshot): void {
  snapshot.sheets[1]!.index = snapshot.sheets[0]!.index
}

function mutateHeader(snapshot: WorkbookMetadataSnapshot): void {
  const target = sheet(snapshot, 'BOOKING_MASTER')
  target.headers = ['wrong', ...target.headers.slice(1)]
}

function setUnexpectedFilter(snapshot: WorkbookMetadataSnapshot): void {
  const target = sheet(snapshot, 'BOOKING_MASTER')
  target.basicFilter = { ...fullGrid(target), endColumnIndex: target.headers.length - 1 }
}

function patchSheet(
  snapshot: WorkbookMetadataSnapshot,
  title: string,
  patch: Partial<SheetPresentationSnapshot>,
): void {
  Object.assign(sheet(snapshot, title), patch)
}

function applyPlanForTest(
  source: WorkbookMetadataSnapshot,
  plan: WorkbookPresentationPlan,
): WorkbookMetadataSnapshot {
  const after = cloneSnapshot(source)
  const mutable = after.sheets as SheetPresentationSnapshot[]
  for (const action of plan.actions) applyAction(mutable, action)
  after.fingerprint = 'after-full-fingerprint'
  return after
}

function applyAction(sheets: SheetPresentationSnapshot[], action: WorkbookPresentationAction): void {
  const targetSheetId = 'sheetId' in action ? action.sheetId : action.range.sheetId
  const target = sheets.find((sheet) => sheet.sheetId === targetSheetId)
  if (!target && action.kind !== 'SET_BASIC_FILTER' && action.kind !== 'FORMAT_RANGE' && action.kind !== 'ADD_STATUS_RULE') {
    throw new Error('bad test plan')
  }
  switch (action.kind) {
    case 'MOVE_SHEET': {
      const current = sheets.findIndex((sheet) => sheet.sheetId === action.sheetId)
      const [moved] = sheets.splice(current, 1)
      sheets.splice(action.targetIndex, 0, moved!)
      sheets.forEach((sheet, index) => { sheet.index = index })
      return
    }
    case 'SET_HIDDEN':
      target!.hidden = action.hidden
      return
    case 'SET_FROZEN':
      target!.frozenRows = action.rows
      target!.frozenColumns = action.columns
      return
    case 'SET_BASIC_FILTER':
      sheetByRange(sheets, action.range).basicFilter = structuredClone(action.range)
      return
    case 'SET_COLUMN_WIDTH':
      ;(target!.columnWidths as number[])[action.columnIndex] = action.pixelSize
      return
    case 'FORMAT_RANGE': {
      const ranged = sheetByRange(sheets, action.range)
      ranged.managedFormats = replaceRange(ranged.managedFormats, action.range, { ...action })
      return
    }
    case 'ADD_STATUS_RULE': {
      const ranged = sheetByRange(sheets, action.range)
      ranged.statusRules = [...ranged.statusRules, { range: structuredClone(action.range), ruleKey: action.ruleKey }]
    }
  }
}

function sheetByRange(sheets: SheetPresentationSnapshot[], range: GridRangeSnapshot): SheetPresentationSnapshot {
  const target = sheets.find((sheet) => sheet.sheetId === range.sheetId)
  if (!target) throw new Error('bad test range')
  return target
}

function replaceRange<T extends { range: GridRangeSnapshot }>(
  items: readonly T[],
  range: GridRangeSnapshot,
  replacement: T,
): T[] {
  return [...items.filter((item) => JSON.stringify(item.range) !== JSON.stringify(range)), replacement]
}

function buildPlan(snapshot: WorkbookMetadataSnapshot): WorkbookPresentationPlan {
  return buildWorkbookPresentationPlan(snapshot, sha256Hex)
}
