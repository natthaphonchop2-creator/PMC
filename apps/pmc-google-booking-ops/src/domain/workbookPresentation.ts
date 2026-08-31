import { PMC_MINI_APP_REQUEST_HEADERS_V2 } from '../../../../shared/pmcBookingRowContracts'
import { SHEET_SCHEMAS } from '../sheetSchema'

export interface GridRangeSnapshot {
  sheetId: number
  startRowIndex: number
  endRowIndex: number
  startColumnIndex: number
  endColumnIndex: number
}

export type WorkbookPresentationStyleKey =
  | 'HEADER'
  | 'BODY'
  | 'BODY_PLAIN_TEXT'
  | 'BODY_CURRENCY'
  | 'BODY_WRAP'
  | 'BODY_PLAIN_TEXT_WRAP'

export type WorkbookStatusRuleKey =
  | 'BOOKING_STATUS'
  | 'APPOINTMENT_STATUS'
  | 'CALL_STATUS'
  | 'RECONCILIATION_STATUS'
  | 'RETENTION_STATUS'

export interface ManagedFormatSnapshot {
  range: GridRangeSnapshot
  styleKey: WorkbookPresentationStyleKey
}

export interface StatusRuleSnapshot {
  range: GridRangeSnapshot
  ruleKey: WorkbookStatusRuleKey
}

export interface SheetPresentationSnapshot {
  sheetId: number
  title: string
  index: number
  hidden: boolean
  maxRows: number
  maxColumns: number
  frozenRows: number
  frozenColumns: number
  headers: readonly string[]
  basicFilter: GridRangeSnapshot | null
  filterViewCount: number
  mergedRangeCount: number
  protectedRangeCount: number
  unsupportedMetadataCount: number
  columnWidths: readonly number[]
  managedFormats: readonly ManagedFormatSnapshot[]
  statusRules: readonly StatusRuleSnapshot[]
  valuesHash: string
  formulasHash: string
  validationsHash: string
  protectionsHash: string
  rowMetadataHash: string
}

export interface WorkbookMetadataSnapshot {
  spreadsheetId: string
  sheets: readonly SheetPresentationSnapshot[]
  fingerprint: string
}

export type WorkbookPresentationAction =
  | { kind: 'MOVE_SHEET'; sheetId: number; targetIndex: number }
  | { kind: 'SET_HIDDEN'; sheetId: number; hidden: boolean }
  | { kind: 'SET_FROZEN'; sheetId: number; rows: number; columns: number }
  | { kind: 'SET_BASIC_FILTER'; range: GridRangeSnapshot }
  | { kind: 'SET_COLUMN_WIDTH'; sheetId: number; columnIndex: number; pixelSize: number }
  | { kind: 'FORMAT_RANGE'; range: GridRangeSnapshot; styleKey: WorkbookPresentationStyleKey }
  | { kind: 'ADD_STATUS_RULE'; range: GridRangeSnapshot; ruleKey: WorkbookStatusRuleKey }

export interface WorkbookPresentationPlan {
  sourceFingerprint: string
  visibleOrder: readonly string[]
  actions: readonly WorkbookPresentationAction[]
  expectedPresentationFingerprint: string
}

export type WorkbookPresentationSha256 = (canonicalValue: string) => string

export const VISIBLE_TAB_ORDER = Object.freeze([
  'DASHBOARD',
  'BOOKING_MASTER',
  'CALL_QUEUE',
  'RECONCILIATION',
  'RETENTION_QUEUE',
  'CONFIG_ADMINS',
  'CONFIG_STAFF',
  'CONFIG_DOCTORS',
  'CONFIG_SERVICES',
  'CONFIG_CHANNELS',
  'CONFIG_RULES',
] as const)

export const COLUMN_WIDTHS = deepFreeze({
  DASHBOARD: [220, 140, 130, 120, 130, 130, 180, 145],
  BOOKING_MASTER: {
    caseId: 150, formResponseId: 160, status: 135, recorderName: 135,
    adminName: 135, aeName: 135, submitterEmail: 220, customerName: 180,
    facebookName: 180, phoneNormalized: 120, phoneMasked: 120,
    appointmentStart: 165, appointmentEnd: 165, depositAmount: 120,
    driveFolderUrl: 240, createdAt: 165, updatedAt: 165,
  },
  CALL_QUEUE: {
    taskId: 150, caseId: 150, ownerAdminId: 135, status: 115,
    windowStart: 165, windowEnd: 165, nextCallAt: 165, lastReminderDate: 165,
    result: 150, note: 320,
  },
  RECONCILIATION: {
    id: 150, source: 140, sourceId: 150, reasonCode: 140,
    candidateCaseIds: 300, status: 115, resolvedCaseId: 150, resolvedAt: 165,
  },
  RETENTION_QUEUE: {
    id: 150, caseId: 150, eligibleAt: 165, status: 115,
    approvedBy: 140, approvedAt: 165, reason: 300,
  },
  CONFIG_DEFAULTS: { id: 140, name: 160, email: 220, url: 260, boolean: 105, timestamp: 165 },
} as const)

const WRAPPED_HEADERS = new Set([
  'note', 'candidateCaseIds', 'reasonCode', 'reason',
])

const CURRENCY_HEADERS = new Set([
  'depositAmount', 'jeraActualRevenue', 'commissionAmount',
])

const FILTER_TABS = new Set(['BOOKING_MASTER', 'CALL_QUEUE', 'RECONCILIATION', 'RETENTION_QUEUE'])
const VISIBLE_TABS = new Set<string>(VISIBLE_TAB_ORDER)

const VISIBLE_EXACT_HEADERS: Readonly<Record<string, readonly string[]>> = deepFreeze({
  DASHBOARD: ['KPI', 'Value'],
  BOOKING_MASTER: [...SHEET_SCHEMAS.BOOKING_MASTER!],
  CALL_QUEUE: [...SHEET_SCHEMAS.CALL_QUEUE!],
  RECONCILIATION: [...SHEET_SCHEMAS.RECONCILIATION!],
  RETENTION_QUEUE: [...SHEET_SCHEMAS.RETENTION_QUEUE!],
  CONFIG_ADMINS: [...SHEET_SCHEMAS.CONFIG_ADMINS!],
  CONFIG_STAFF: [...SHEET_SCHEMAS.CONFIG_STAFF!],
  CONFIG_DOCTORS: [...SHEET_SCHEMAS.CONFIG_DOCTORS!],
  CONFIG_SERVICES: [...SHEET_SCHEMAS.CONFIG_SERVICES!],
  CONFIG_CHANNELS: [...SHEET_SCHEMAS.CONFIG_CHANNELS!],
  CONFIG_RULES: [...SHEET_SCHEMAS.CONFIG_RULES!],
})

export const KNOWN_HIDDEN_TAB_HEADERS: Readonly<Record<string, readonly string[] | null>> = deepFreeze({
  FORM_RESPONSES: null,
  JERA_IMPORT_RAW: [...SHEET_SCHEMAS.JERA_IMPORT_RAW!],
  JERA_IMPORT_FILES: [...SHEET_SCHEMAS.JERA_IMPORT_FILES!],
  FORM_RESPONSE_MAP: [...SHEET_SCHEMAS.FORM_RESPONSE_MAP!],
  RETRY_QUEUE: [...SHEET_SCHEMAS.RETRY_QUEUE!],
  AUDIT_LOG: [...SHEET_SCHEMAS.AUDIT_LOG!],
  CONFIG_LINE_DIRECTORY: [...SHEET_SCHEMAS.CONFIG_LINE_DIRECTORY!],
  LINE_INGRESS_NONCES: [...SHEET_SCHEMAS.LINE_INGRESS_NONCES!],
  SYSTEM_SEQUENCES: [...SHEET_SCHEMAS.SYSTEM_SEQUENCES!],
  MINI_APP_REQUESTS: [...PMC_MINI_APP_REQUEST_HEADERS_V2],
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
  STOCK_PRODUCTS: [...SHEET_SCHEMAS.STOCK_PRODUCTS!],
  STOCK_LEDGER: [...SHEET_SCHEMAS.STOCK_LEDGER!],
  STOCK_AUDIT: [...SHEET_SCHEMAS.STOCK_AUDIT!],
})

interface DesiredSheetPresentation {
  hidden: boolean
  frozenRows: number
  frozenColumns: number
  basicFilter: GridRangeSnapshot | null
  widths: ReadonlyMap<number, number>
  formats: readonly ManagedFormatSnapshot[]
  statusRules: readonly StatusRuleSnapshot[]
}

interface ValidatedWorkbook {
  orderedSheets: readonly SheetPresentationSnapshot[]
  desiredById: ReadonlyMap<number, DesiredSheetPresentation>
}

export function buildWorkbookPresentationPlan(
  snapshot: WorkbookMetadataSnapshot,
  sha256Hex: WorkbookPresentationSha256,
): WorkbookPresentationPlan {
  const validated = validateWorkbook(snapshot)
  const actions = buildActions(validated)
  assertSafeActionSet(actions, validated.orderedSheets)
  const projected = projectPresentation(snapshot, actions)
  return freezePlan({
    sourceFingerprint: snapshot.fingerprint,
    visibleOrder: [...VISIBLE_TAB_ORDER],
    actions,
    expectedPresentationFingerprint: workbookPresentationFingerprint(projected, sha256Hex),
  })
}

export function verifyWorkbookPresentation(
  before: WorkbookMetadataSnapshot,
  after: WorkbookMetadataSnapshot,
  plan: WorkbookPresentationPlan,
  sha256Hex: WorkbookPresentationSha256,
): void {
  validateWorkbook(before)
  validateWorkbook(after)
  if (before.fingerprint !== plan.sourceFingerprint) fail('SOURCE_FINGERPRINT_MISMATCH')

  const expectedPlan = buildWorkbookPresentationPlan(before, sha256Hex)
  if (canonicalPlan(expectedPlan) !== canonicalPlan(plan)) fail('PRESENTATION_PLAN_CONFLICT')

  assertImmutableWorkbook(before, after)
  const actualFingerprint = workbookPresentationFingerprint(after, sha256Hex)
  if (actualFingerprint !== plan.expectedPresentationFingerprint) fail('PRESENTATION_FINGERPRINT_MISMATCH')

  const readbackPlan = buildWorkbookPresentationPlan(after, sha256Hex)
  if (readbackPlan.actions.length !== 0
    || readbackPlan.expectedPresentationFingerprint !== plan.expectedPresentationFingerprint) {
    fail('PRESENTATION_READBACK_NOT_IDEMPOTENT')
  }
}

export function workbookPresentationFingerprint(
  snapshot: WorkbookMetadataSnapshot,
  sha256Hex: WorkbookPresentationSha256,
): string {
  const payload = snapshot.sheets
    .slice()
    .sort((left, right) => left.index - right.index)
    .map((sheet) => ({
      sheetId: sheet.sheetId,
      title: sheet.title,
      index: sheet.index,
      hidden: sheet.hidden,
      frozenRows: sheet.frozenRows,
      frozenColumns: sheet.frozenColumns,
      basicFilter: sheet.basicFilter,
      columnWidths: [...sheet.columnWidths],
      managedFormats: sortFormats(sheet.managedFormats),
      statusRules: sortStatusRules(sheet.statusRules),
    }))
  if (typeof sha256Hex !== 'function') fail('PRESENTATION_SHA256_REQUIRED')
  const digest = sha256Hex(JSON.stringify(payload)).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(digest)) fail('INVALID_PRESENTATION_SHA256')
  return `wp1-${digest}`
}

function validateWorkbook(snapshot: WorkbookMetadataSnapshot): ValidatedWorkbook {
  if (!snapshot.spreadsheetId.trim() || !snapshot.fingerprint.trim()) fail('INVALID_WORKBOOK_SNAPSHOT')
  if (snapshot.sheets.length === 0) fail('MISSING_MANAGED_TAB')

  const titleSet = new Set<string>()
  const idSet = new Set<number>()
  const indexSet = new Set<number>()
  for (const sheet of snapshot.sheets) {
    if (titleSet.has(sheet.title)) fail('DUPLICATE_TAB_TITLE')
    if (idSet.has(sheet.sheetId)) fail('DUPLICATE_SHEET_ID')
    if (indexSet.has(sheet.index)) fail('DUPLICATE_SHEET_INDEX')
    titleSet.add(sheet.title)
    idSet.add(sheet.sheetId)
    indexSet.add(sheet.index)
  }

  const orderedSheets = snapshot.sheets.slice().sort((left, right) => left.index - right.index)
  if (orderedSheets.some((sheet, index) => sheet.index !== index)) fail('INVALID_SHEET_INDEX_SEQUENCE')
  for (const title of VISIBLE_TAB_ORDER) {
    if (!titleSet.has(title)) fail('MISSING_MANAGED_TAB')
  }

  const desiredById = new Map<number, DesiredSheetPresentation>()
  for (const sheet of orderedSheets) {
    validateSheetShape(sheet)
    const classification = classifyTab(sheet.title)
    if (classification === 'UNKNOWN') fail('UNCLASSIFIED_TAB')
    validateHeaders(sheet, classification)
    validateUnsupportedMetadata(sheet)
    const desired = desiredPresentation(sheet, classification)
    validateExistingBasicFilter(sheet, desired.basicFilter)
    validateManagedPresentationMetadata(sheet, desired)
    desiredById.set(sheet.sheetId, desired)
  }
  return { orderedSheets, desiredById }
}

function validateSheetShape(sheet: SheetPresentationSnapshot): void {
  if (!Number.isSafeInteger(sheet.sheetId)
    || !Number.isSafeInteger(sheet.index)
    || !Number.isSafeInteger(sheet.maxRows)
    || !Number.isSafeInteger(sheet.maxColumns)
    || sheet.maxRows < 2
    || sheet.maxColumns < 1
    || sheet.headers.length > sheet.maxColumns
    || !Number.isSafeInteger(sheet.frozenRows)
    || !Number.isSafeInteger(sheet.frozenColumns)
    || sheet.frozenRows < 0
    || sheet.frozenRows > sheet.maxRows
    || sheet.frozenColumns < 0
    || sheet.frozenColumns > sheet.maxColumns
    || sheet.columnWidths.length !== sheet.maxColumns
    || sheet.columnWidths.some((width) => !Number.isSafeInteger(width) || width < 20 || width > 2_000)
    || [
      sheet.valuesHash, sheet.formulasHash, sheet.validationsHash,
      sheet.protectionsHash, sheet.rowMetadataHash,
    ]
      .some((hash) => !hash.trim())) {
    fail('INVALID_SHEET_METADATA')
  }
  if (sheet.basicFilter) validateRange(sheet.basicFilter, sheet)
  for (const item of sheet.managedFormats) validateRange(item.range, sheet)
  for (const item of sheet.statusRules) validateRange(item.range, sheet)
}

function validateHeaders(sheet: SheetPresentationSnapshot, classification: 'VISIBLE' | 'HIDDEN'): void {
  let expected: readonly string[] | null | undefined
  if (classification === 'VISIBLE') {
    expected = VISIBLE_EXACT_HEADERS[sheet.title]
  } else {
    expected = KNOWN_HIDDEN_TAB_HEADERS[sheet.title]
  }
  if (expected !== undefined && expected !== null && !sameArray(sheet.headers, expected)) fail('HEADER_MISMATCH')
}

function validateUnsupportedMetadata(sheet: SheetPresentationSnapshot): void {
  if (!Number.isSafeInteger(sheet.filterViewCount) || sheet.filterViewCount < 0
    || !Number.isSafeInteger(sheet.mergedRangeCount) || sheet.mergedRangeCount < 0
    || !Number.isSafeInteger(sheet.protectedRangeCount) || sheet.protectedRangeCount < 0
    || !Number.isSafeInteger(sheet.unsupportedMetadataCount) || sheet.unsupportedMetadataCount < 0) {
    fail('INVALID_SHEET_METADATA')
  }
  if (sheet.filterViewCount !== 0) fail('UNEXPECTED_FILTER_VIEW')
  if (sheet.mergedRangeCount !== 0) fail('UNEXPECTED_MERGED_RANGE')
  if (sheet.protectedRangeCount !== 0) fail('UNEXPECTED_PROTECTED_RANGE')
  if (sheet.unsupportedMetadataCount !== 0) fail('UNSUPPORTED_PRESENTATION_METADATA')
}

function validateExistingBasicFilter(
  sheet: SheetPresentationSnapshot,
  desired: GridRangeSnapshot | null,
): void {
  if (sheet.basicFilter && (!desired || !sameRange(sheet.basicFilter, desired))) {
    fail('UNEXPECTED_BASIC_FILTER')
  }
}

function validateManagedPresentationMetadata(
  sheet: SheetPresentationSnapshot,
  desired: DesiredSheetPresentation,
): void {
  assertNonOverlappingRanges(sheet.managedFormats.map((item) => item.range))
  assertNonOverlappingRanges(sheet.statusRules.map((item) => item.range))
  assertUnique(sheet.managedFormats.map((item) => `${rangeKey(item.range)}:${item.styleKey}`))
  assertUnique(sheet.statusRules.map((item) => `${rangeKey(item.range)}:${item.ruleKey}`))

  for (const current of sheet.managedFormats) {
    if (!desired.formats.some((candidate) => sameRange(candidate.range, current.range))) {
      fail('UNEXPECTED_MANAGED_FORMAT')
    }
  }
  for (const current of sheet.statusRules) {
    if (!desired.statusRules.some((candidate) => sameRange(candidate.range, current.range)
      && candidate.ruleKey === current.ruleKey)) {
      fail('UNEXPECTED_STATUS_RULE')
    }
  }
}

function desiredPresentation(
  sheet: SheetPresentationSnapshot,
  classification: 'VISIBLE' | 'HIDDEN',
): DesiredSheetPresentation {
  if (classification === 'HIDDEN') {
    const sourceOwnedForm = sheet.title === 'FORM_RESPONSES'
    return {
      hidden: true,
      frozenRows: sourceOwnedForm ? sheet.frozenRows : 1,
      frozenColumns: sourceOwnedForm ? sheet.frozenColumns : 0,
      basicFilter: null,
      widths: new Map(),
      formats: [],
      statusRules: [],
    }
  }

  const frozenColumns = sheet.title === 'BOOKING_MASTER' ? 3 : sheet.title === 'CALL_QUEUE' ? 2 : 0
  const frozenRows = sheet.title === 'DASHBOARD' ? 0 : 1
  const basicFilter = FILTER_TABS.has(sheet.title) ? fullGrid(sheet) : null
  const formats = desiredFormats(sheet)
  const statusRules = desiredStatusRules(sheet)
  return {
    hidden: false,
    frozenRows,
    frozenColumns,
    basicFilter,
    widths: desiredWidths(sheet),
    formats,
    statusRules,
  }
}

function desiredWidths(sheet: SheetPresentationSnapshot): ReadonlyMap<number, number> {
  const widths = new Map<number, number>()
  if (sheet.title === 'DASHBOARD') {
    COLUMN_WIDTHS.DASHBOARD.forEach((pixelSize, columnIndex) => widths.set(columnIndex, pixelSize))
    return widths
  }
  const exact = sheet.title === 'BOOKING_MASTER'
    ? COLUMN_WIDTHS.BOOKING_MASTER
    : sheet.title === 'CALL_QUEUE'
      ? COLUMN_WIDTHS.CALL_QUEUE
      : sheet.title === 'RECONCILIATION'
        ? COLUMN_WIDTHS.RECONCILIATION
        : sheet.title === 'RETENTION_QUEUE'
          ? COLUMN_WIDTHS.RETENTION_QUEUE
          : null

  sheet.headers.forEach((header, columnIndex) => {
    if (exact && header in exact) {
      widths.set(columnIndex, exact[header as keyof typeof exact])
      return
    }
    if (sheet.title.startsWith('CONFIG_')) {
      const fallback = configWidth(header)
      if (fallback !== null) widths.set(columnIndex, fallback)
    }
  })
  return widths
}

function configWidth(header: string): number | null {
  const normalized = header.toLowerCase()
  if (normalized === 'id' || normalized.endsWith('id')) return COLUMN_WIDTHS.CONFIG_DEFAULTS.id
  if (normalized === 'name' || normalized.endsWith('name')) return COLUMN_WIDTHS.CONFIG_DEFAULTS.name
  if (normalized.includes('email')) return COLUMN_WIDTHS.CONFIG_DEFAULTS.email
  if (normalized.includes('url')) return COLUMN_WIDTHS.CONFIG_DEFAULTS.url
  if (normalized === 'active' || normalized.startsWith('can')) return COLUMN_WIDTHS.CONFIG_DEFAULTS.boolean
  if (normalized.endsWith('at')) return COLUMN_WIDTHS.CONFIG_DEFAULTS.timestamp
  return null
}

function desiredFormats(sheet: SheetPresentationSnapshot): readonly ManagedFormatSnapshot[] {
  if (sheet.title === 'DASHBOARD') {
    if (sheet.maxRows < 14 || sheet.maxColumns < 8) fail('INVALID_DASHBOARD_GRID')
    return [
      { range: gridRange(sheet, 0, 1, 0, 2), styleKey: 'HEADER' },
      { range: gridRange(sheet, 1, 10, 0, 2), styleKey: 'BODY' },
      { range: gridRange(sheet, 12, 13, 0, 8), styleKey: 'HEADER' },
      { range: gridRange(sheet, 13, sheet.maxRows, 0, 8), styleKey: 'BODY' },
    ]
  }
  const formats: ManagedFormatSnapshot[] = [
    { range: gridRange(sheet, 0, 1, 0, sheet.headers.length), styleKey: 'HEADER' },
  ]
  sheet.headers.forEach((header, columnIndex) => {
    formats.push({
      range: columnBody(sheet, columnIndex),
      styleKey: bodyStyle(header),
    })
  })
  return formats
}

function bodyStyle(header: string): WorkbookPresentationStyleKey {
  const plain = isPlainTextHeader(header)
  const currency = isCurrencyHeader(header)
  const wrap = WRAPPED_HEADERS.has(header)
  if (plain && wrap) return 'BODY_PLAIN_TEXT_WRAP'
  if (plain) return 'BODY_PLAIN_TEXT'
  if (currency) return 'BODY_CURRENCY'
  if (wrap) return 'BODY_WRAP'
  return 'BODY'
}

function isPlainTextHeader(header: string): boolean {
  const normalized = header.toLowerCase()
  return normalized === 'id'
    || normalized.endsWith('id')
    || normalized.endsWith('ids')
    || normalized.includes('hash')
    || normalized.includes('phone')
    || normalized.includes('url')
    || normalized.endsWith('json')
}

function isCurrencyHeader(header: string): boolean {
  return CURRENCY_HEADERS.has(header)
}

function desiredStatusRules(sheet: SheetPresentationSnapshot): readonly StatusRuleSnapshot[] {
  const definitions: ReadonlyArray<{ title: string; header: string; ruleKey: WorkbookStatusRuleKey }> = [
    { title: 'BOOKING_MASTER', header: 'status', ruleKey: 'BOOKING_STATUS' },
    { title: 'BOOKING_MASTER', header: 'appointmentStatus', ruleKey: 'APPOINTMENT_STATUS' },
    { title: 'CALL_QUEUE', header: 'status', ruleKey: 'CALL_STATUS' },
    { title: 'RECONCILIATION', header: 'status', ruleKey: 'RECONCILIATION_STATUS' },
    { title: 'RETENTION_QUEUE', header: 'status', ruleKey: 'RETENTION_STATUS' },
  ]
  return definitions
    .filter((definition) => definition.title === sheet.title)
    .map((definition) => {
      const columnIndex = sheet.headers.indexOf(definition.header)
      if (columnIndex < 0) fail('HEADER_MISMATCH')
      return { range: columnBody(sheet, columnIndex), ruleKey: definition.ruleKey }
    })
}

function buildActions(validated: ValidatedWorkbook): WorkbookPresentationAction[] {
  const actions: WorkbookPresentationAction[] = []
  const movingOrder = validated.orderedSheets.map((sheet) => sheet.sheetId)
  for (let targetIndex = 0; targetIndex < VISIBLE_TAB_ORDER.length; targetIndex += 1) {
    const title = VISIBLE_TAB_ORDER[targetIndex]!
    const sheet = validated.orderedSheets.find((candidate) => candidate.title === title)!
    const currentIndex = movingOrder.indexOf(sheet.sheetId)
    if (currentIndex !== targetIndex) {
      actions.push({ kind: 'MOVE_SHEET', sheetId: sheet.sheetId, targetIndex })
      movingOrder.splice(currentIndex, 1)
      movingOrder.splice(targetIndex, 0, sheet.sheetId)
    }
  }

  const rank = sheetRank(validated.orderedSheets)
  for (const sheet of validated.orderedSheets.slice().sort((left, right) => rank(left) - rank(right))) {
    const desired = validated.desiredById.get(sheet.sheetId)!
    if (sheet.hidden !== desired.hidden) {
      actions.push({ kind: 'SET_HIDDEN', sheetId: sheet.sheetId, hidden: desired.hidden })
    }
    if (sheet.frozenRows !== desired.frozenRows || sheet.frozenColumns !== desired.frozenColumns) {
      actions.push({
        kind: 'SET_FROZEN', sheetId: sheet.sheetId,
        rows: desired.frozenRows, columns: desired.frozenColumns,
      })
    }
    if (desired.basicFilter && !sameNullableRange(sheet.basicFilter, desired.basicFilter)) {
      actions.push({ kind: 'SET_BASIC_FILTER', range: cloneRange(desired.basicFilter) })
    }
    for (const [columnIndex, pixelSize] of [...desired.widths].sort(([left], [right]) => left - right)) {
      if (sheet.columnWidths[columnIndex] !== pixelSize) {
        actions.push({ kind: 'SET_COLUMN_WIDTH', sheetId: sheet.sheetId, columnIndex, pixelSize })
      }
    }
    for (const desiredFormat of sortFormats(desired.formats)) {
      const current = sheet.managedFormats.find((item) => sameRange(item.range, desiredFormat.range))
      if (current?.styleKey !== desiredFormat.styleKey) {
        actions.push({
          kind: 'FORMAT_RANGE', range: cloneRange(desiredFormat.range), styleKey: desiredFormat.styleKey,
        })
      }
    }
    for (const desiredRule of sortStatusRules(desired.statusRules)) {
      const exists = sheet.statusRules.some((item) => sameRange(item.range, desiredRule.range)
        && item.ruleKey === desiredRule.ruleKey)
      if (!exists) {
        actions.push({
          kind: 'ADD_STATUS_RULE', range: cloneRange(desiredRule.range), ruleKey: desiredRule.ruleKey,
        })
      }
    }
  }
  return actions
}

function assertSafeActionSet(
  actions: readonly WorkbookPresentationAction[],
  sheets: readonly SheetPresentationSnapshot[],
): void {
  const sheetById = new Map(sheets.map((sheet) => [sheet.sheetId, sheet]))
  const uniqueKeys = new Set<string>()
  const formatRanges: GridRangeSnapshot[] = []
  const statusRanges: GridRangeSnapshot[] = []
  for (const action of actions) {
    const sheetId = 'sheetId' in action ? action.sheetId : action.range.sheetId
    const sheet = sheetById.get(sheetId)
    if (!sheet) fail('PRESENTATION_ACTION_CONFLICT')
    let key: string
    switch (action.kind) {
      case 'MOVE_SHEET':
        if (!Number.isSafeInteger(action.targetIndex) || action.targetIndex < 0 || action.targetIndex >= sheets.length) {
          fail('PRESENTATION_ACTION_CONFLICT')
        }
        key = `${action.kind}:${action.sheetId}`
        break
      case 'SET_HIDDEN':
      case 'SET_FROZEN':
        key = `${action.kind}:${action.sheetId}`
        break
      case 'SET_BASIC_FILTER':
        validateRange(action.range, sheet)
        key = `${action.kind}:${action.range.sheetId}`
        break
      case 'SET_COLUMN_WIDTH':
        if (!Number.isSafeInteger(action.columnIndex) || action.columnIndex < 0
          || action.columnIndex >= sheet.maxColumns || !Number.isSafeInteger(action.pixelSize)
          || action.pixelSize < 20 || action.pixelSize > 2_000) fail('PRESENTATION_ACTION_CONFLICT')
        key = `${action.kind}:${action.sheetId}:${action.columnIndex}`
        break
      case 'FORMAT_RANGE':
        validateRange(action.range, sheet)
        formatRanges.push(action.range)
        key = `${action.kind}:${rangeKey(action.range)}`
        break
      case 'ADD_STATUS_RULE':
        validateRange(action.range, sheet)
        statusRanges.push(action.range)
        key = `${action.kind}:${rangeKey(action.range)}`
        break
    }
    if (uniqueKeys.has(key)) fail('PRESENTATION_ACTION_CONFLICT')
    uniqueKeys.add(key)
  }
  assertNonOverlappingRanges(formatRanges)
  assertNonOverlappingRanges(statusRanges)
}

function projectPresentation(
  snapshot: WorkbookMetadataSnapshot,
  actions: readonly WorkbookPresentationAction[],
): WorkbookMetadataSnapshot {
  const sheets = snapshot.sheets.map((sheet) => cloneSheet(sheet))
  for (const action of actions) {
    const targetId = 'sheetId' in action ? action.sheetId : action.range.sheetId
    const target = sheets.find((sheet) => sheet.sheetId === targetId)
    if (!target) fail('PRESENTATION_ACTION_CONFLICT')
    switch (action.kind) {
      case 'MOVE_SHEET': {
        const currentIndex = sheets.indexOf(target)
        sheets.splice(currentIndex, 1)
        sheets.splice(action.targetIndex, 0, target)
        sheets.forEach((sheet, index) => { sheet.index = index })
        break
      }
      case 'SET_HIDDEN':
        target.hidden = action.hidden
        break
      case 'SET_FROZEN':
        target.frozenRows = action.rows
        target.frozenColumns = action.columns
        break
      case 'SET_BASIC_FILTER':
        target.basicFilter = cloneRange(action.range)
        break
      case 'SET_COLUMN_WIDTH':
        target.columnWidths[action.columnIndex] = action.pixelSize
        break
      case 'FORMAT_RANGE':
        target.managedFormats = [
          ...target.managedFormats.filter((item) => !sameRange(item.range, action.range)),
          { range: cloneRange(action.range), styleKey: action.styleKey },
        ]
        break
      case 'ADD_STATUS_RULE':
        target.statusRules = [
          ...target.statusRules,
          { range: cloneRange(action.range), ruleKey: action.ruleKey },
        ]
        break
    }
  }
  return { ...snapshot, sheets }
}

function cloneSheet(sheet: SheetPresentationSnapshot): MutableSheetPresentationSnapshot {
  return {
    ...sheet,
    headers: [...sheet.headers],
    basicFilter: sheet.basicFilter ? cloneRange(sheet.basicFilter) : null,
    columnWidths: [...sheet.columnWidths],
    managedFormats: sheet.managedFormats.map((item) => ({
      range: cloneRange(item.range), styleKey: item.styleKey,
    })),
    statusRules: sheet.statusRules.map((item) => ({
      range: cloneRange(item.range), ruleKey: item.ruleKey,
    })),
  }
}

type MutableSheetPresentationSnapshot = Omit<
  SheetPresentationSnapshot,
  'headers' | 'columnWidths' | 'managedFormats' | 'statusRules'
> & {
  headers: string[]
  columnWidths: number[]
  managedFormats: ManagedFormatSnapshot[]
  statusRules: StatusRuleSnapshot[]
}

function assertImmutableWorkbook(before: WorkbookMetadataSnapshot, after: WorkbookMetadataSnapshot): void {
  if (before.spreadsheetId !== after.spreadsheetId) fail('WORKBOOK_ID_CHANGED')
  if (before.sheets.length !== after.sheets.length) fail('WORKBOOK_STRUCTURE_CHANGED')
  const afterById = new Map(after.sheets.map((sheet) => [sheet.sheetId, sheet]))
  for (const beforeSheet of before.sheets) {
    const afterSheet = afterById.get(beforeSheet.sheetId)
    if (!afterSheet || beforeSheet.title !== afterSheet.title) fail('WORKBOOK_STRUCTURE_CHANGED')
    if (beforeSheet.maxRows !== afterSheet.maxRows || beforeSheet.maxColumns !== afterSheet.maxColumns) {
      fail('GRID_DIMENSIONS_CHANGED')
    }
    if (!sameArray(beforeSheet.headers, afterSheet.headers)) fail('HEADERS_CHANGED')
    if (beforeSheet.valuesHash !== afterSheet.valuesHash) fail('VALUES_HASH_CHANGED')
    if (beforeSheet.formulasHash !== afterSheet.formulasHash) fail('FORMULAS_HASH_CHANGED')
    if (beforeSheet.validationsHash !== afterSheet.validationsHash) fail('VALIDATIONS_HASH_CHANGED')
    if (beforeSheet.protectionsHash !== afterSheet.protectionsHash) fail('PROTECTIONS_HASH_CHANGED')
    if (beforeSheet.rowMetadataHash !== afterSheet.rowMetadataHash) fail('ROW_METADATA_HASH_CHANGED')
  }
}

function classifyTab(title: string): 'VISIBLE' | 'HIDDEN' | 'UNKNOWN' {
  if (VISIBLE_TABS.has(title)) return 'VISIBLE'
  if (Object.prototype.hasOwnProperty.call(KNOWN_HIDDEN_TAB_HEADERS, title)) return 'HIDDEN'
  return 'UNKNOWN'
}

function validateRange(range: GridRangeSnapshot, sheet: SheetPresentationSnapshot): void {
  if (range.sheetId !== sheet.sheetId
    || !Number.isSafeInteger(range.startRowIndex)
    || !Number.isSafeInteger(range.endRowIndex)
    || !Number.isSafeInteger(range.startColumnIndex)
    || !Number.isSafeInteger(range.endColumnIndex)
    || range.startRowIndex < 0
    || range.startRowIndex >= range.endRowIndex
    || range.endRowIndex > sheet.maxRows
    || range.startColumnIndex < 0
    || range.startColumnIndex >= range.endColumnIndex
    || range.endColumnIndex > sheet.maxColumns) {
    fail('INVALID_GRID_RANGE')
  }
}

function assertNonOverlappingRanges(ranges: readonly GridRangeSnapshot[]): void {
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      if (rangesOverlap(ranges[left]!, ranges[right]!)) fail('PRESENTATION_METADATA_CONFLICT')
    }
  }
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail('PRESENTATION_METADATA_CONFLICT')
}

function rangesOverlap(left: GridRangeSnapshot, right: GridRangeSnapshot): boolean {
  return left.sheetId === right.sheetId
    && left.startRowIndex < right.endRowIndex
    && right.startRowIndex < left.endRowIndex
    && left.startColumnIndex < right.endColumnIndex
    && right.startColumnIndex < left.endColumnIndex
}

function fullGrid(sheet: SheetPresentationSnapshot): GridRangeSnapshot {
  return gridRange(sheet, 0, sheet.maxRows, 0, sheet.headers.length)
}

function columnBody(sheet: SheetPresentationSnapshot, columnIndex: number): GridRangeSnapshot {
  return gridRange(sheet, 1, sheet.maxRows, columnIndex, columnIndex + 1)
}

function gridRange(
  sheet: SheetPresentationSnapshot,
  startRowIndex: number,
  endRowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number,
): GridRangeSnapshot {
  return { sheetId: sheet.sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }
}

function cloneRange(range: GridRangeSnapshot): GridRangeSnapshot {
  return { ...range }
}

function sameNullableRange(left: GridRangeSnapshot | null, right: GridRangeSnapshot | null): boolean {
  return left === null ? right === null : right !== null && sameRange(left, right)
}

function sameRange(left: GridRangeSnapshot, right: GridRangeSnapshot): boolean {
  return left.sheetId === right.sheetId
    && left.startRowIndex === right.startRowIndex
    && left.endRowIndex === right.endRowIndex
    && left.startColumnIndex === right.startColumnIndex
    && left.endColumnIndex === right.endColumnIndex
}

function rangeKey(range: GridRangeSnapshot): string {
  return [
    range.sheetId, range.startRowIndex, range.endRowIndex,
    range.startColumnIndex, range.endColumnIndex,
  ].join(':')
}

function sortFormats(items: readonly ManagedFormatSnapshot[]): ManagedFormatSnapshot[] {
  return items.slice().sort((left, right) => {
    const rangeOrder = compareRanges(left.range, right.range)
    return rangeOrder || left.styleKey.localeCompare(right.styleKey)
  }).map((item) => ({ range: cloneRange(item.range), styleKey: item.styleKey }))
}

function sortStatusRules(items: readonly StatusRuleSnapshot[]): StatusRuleSnapshot[] {
  return items.slice().sort((left, right) => {
    const rangeOrder = compareRanges(left.range, right.range)
    return rangeOrder || left.ruleKey.localeCompare(right.ruleKey)
  }).map((item) => ({ range: cloneRange(item.range), ruleKey: item.ruleKey }))
}

function compareRanges(left: GridRangeSnapshot, right: GridRangeSnapshot): number {
  const leftParts = [
    left.sheetId, left.startRowIndex, left.endRowIndex,
    left.startColumnIndex, left.endColumnIndex,
  ]
  const rightParts = [
    right.sheetId, right.startRowIndex, right.endRowIndex,
    right.startColumnIndex, right.endColumnIndex,
  ]
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!
    if (difference !== 0) return difference
  }
  return 0
}

function sheetRank(sheets: readonly SheetPresentationSnapshot[]): (sheet: SheetPresentationSnapshot) => number {
  const visibleRank = new Map<string, number>(VISIBLE_TAB_ORDER.map((title, index) => [title, index]))
  const hiddenTitles = sheets.filter((sheet) => !VISIBLE_TABS.has(sheet.title))
    .map((sheet) => sheet.title).sort()
  const hiddenRank = new Map(hiddenTitles.map((title, index) => [title, VISIBLE_TAB_ORDER.length + index]))
  return (sheet) => visibleRank.get(sheet.title) ?? hiddenRank.get(sheet.title) ?? Number.MAX_SAFE_INTEGER
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function canonicalPlan(plan: WorkbookPresentationPlan): string {
  return JSON.stringify({
    sourceFingerprint: plan.sourceFingerprint,
    visibleOrder: [...plan.visibleOrder],
    actions: plan.actions,
    expectedPresentationFingerprint: plan.expectedPresentationFingerprint,
  })
}

function freezePlan(plan: WorkbookPresentationPlan): WorkbookPresentationPlan {
  return deepFreeze({
    ...plan,
    visibleOrder: [...plan.visibleOrder],
    actions: plan.actions.map(cloneAction),
  })
}

function cloneAction(action: WorkbookPresentationAction): WorkbookPresentationAction {
  if ('range' in action) return { ...action, range: cloneRange(action.range) }
  return { ...action }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

function fail(code: string): never {
  throw new Error(code)
}
