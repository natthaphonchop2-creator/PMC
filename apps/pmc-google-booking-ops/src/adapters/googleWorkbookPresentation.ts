import {
  VISIBLE_TAB_ORDER,
  buildWorkbookPresentationPlan,
  verifyWorkbookPresentation,
  type GridRangeSnapshot,
  type ManagedFormatSnapshot,
  type SheetPresentationSnapshot,
  type StatusRuleSnapshot,
  type WorkbookMetadataSnapshot,
  type WorkbookPresentationAction,
  type WorkbookPresentationPlan,
  type WorkbookPresentationSha256,
  type WorkbookPresentationStyleKey,
  type WorkbookStatusRuleKey,
} from '../domain/workbookPresentation'
import type {
  WorkbookPresentationGateway,
  WorkbookPresentationWorkflowPort,
} from '../ports'

const LOCK_TIMEOUT_MS = 30_000
const GOOGLE_SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
const DRIVE_FILE_FIELDS = [
  'id,mimeType,parents,trashed,driveId,ownedByMe,shared,webViewLink,',
  'capabilities(canAddChildren,canCopy)',
].join('')
const DRIVE_PERMISSION_FIELDS = [
  'nextPageToken,permissions(type,role,deleted,pendingOwner,allowFileDiscovery,',
  'permissionDetails(inherited,permissionType,role))',
].join('')
const SHEETS_V4_FIELDS = [
  'spreadsheetId,sheets(properties(sheetId,title,index,hidden,sheetType,gridProperties(',
  'rowCount,columnCount,frozenRowCount,frozenColumnCount)),data(startRow,startColumn,',
  'rowData(values(userEnteredValue,userEnteredFormat,dataValidation,note,textFormatRuns,chipRuns,',
  'pivotTable,dataSourceFormula,dataSourceTable)),',
  'rowMetadata(pixelSize,hiddenByUser,hiddenByFilter,developerMetadata),',
  'columnMetadata(pixelSize,hiddenByUser,hiddenByFilter,developerMetadata)),',
  'merges,basicFilter,filterViews,bandedRanges,conditionalFormats,protectedRanges,',
  'charts,tables,developerMetadata,rowGroups,columnGroups,slicers),namedRanges,developerMetadata',
].join('')

const MANAGED_STYLE_KEYS = new Set<WorkbookPresentationStyleKey>([
  'HEADER', 'BODY', 'BODY_PLAIN_TEXT', 'BODY_CURRENCY', 'BODY_WRAP', 'BODY_PLAIN_TEXT_WRAP',
])
const STATUS_RULE_KEYS = new Set<WorkbookStatusRuleKey>([
  'BOOKING_STATUS', 'APPOINTMENT_STATUS', 'CALL_STATUS', 'RECONCILIATION_STATUS', 'RETENTION_STATUS',
])
const ALLOWED_REQUEST_KEYS = new Set([
  'updateSheetProperties', 'setBasicFilter', 'updateDimensionProperties',
  'repeatCell', 'addConditionalFormatRule',
])
const VISIBLE_TABS = new Set<string>(VISIBLE_TAB_ORDER)
const WRAPPED_HEADERS = new Set(['note', 'candidateCaseIds', 'reasonCode', 'reason'])
const CURRENCY_HEADERS = new Set(['depositAmount', 'jeraActualRevenue', 'commissionAmount'])

const COLORS = Object.freeze({
  white: Object.freeze({ red: 1, green: 1, blue: 1 }),
  nearBlack: Object.freeze({ red: 0.0666666667, green: 0.0666666667, blue: 0.0666666667 }),
  headerGray: Object.freeze({ red: 0.9568627451, green: 0.9607843137, blue: 0.9647058824 }),
  borderGray: Object.freeze({ red: 0.8980392157, green: 0.9058823529, blue: 0.9215686275 }),
  actionAmber: Object.freeze({ red: 0.9960784314, green: 0.9529411765, blue: 0.7803921569 }),
  actionAmberText: Object.freeze({ red: 0.5725490196, green: 0.2509803922, blue: 0.0549019608 }),
})

const ACTIONABLE_STATUSES: Readonly<Record<WorkbookStatusRuleKey, readonly string[]>> = Object.freeze({
  BOOKING_STATUS: Object.freeze(['VALIDATION_ERROR', 'TIME_CONFLICT', 'CALL_OVERDUE', 'RECONCILIATION']),
  APPOINTMENT_STATUS: Object.freeze(['TENTATIVE', 'AWAITING_ADMIN_SLOT']),
  CALL_STATUS: Object.freeze(['PENDING', 'ACTIVE', 'OVERDUE']),
  RECONCILIATION_STATUS: Object.freeze(['OPEN']),
  RETENTION_STATUS: Object.freeze(['PENDING']),
})

export interface WorkbookPresentationPreviewResult {
  mutationCount: 0
  plannedActionCount: number
  sourceFingerprint: string
  expectedPresentationFingerprint: string
}

export type WorkbookPresentationApplyResult = {
  status: 'APPLIED'
  plannedActionCount: number
  backupCreated: true
  batchApplied: true
  readbackVerified: true
} | {
  status: 'NOOP'
  plannedActionCount: 0
  backupCreated: false
  batchApplied: false
  readbackVerified: true
}

export interface GoogleWorkbookPresentationGatewayOptions {
  spreadsheetId: string
  backupFolderId: string
  sha256Hex?: WorkbookPresentationSha256
  lockTimeoutMs?: number
}

export interface GoogleWorkbookPresentationGateway extends WorkbookPresentationGateway {
  withDocumentLock<T>(operation: () => T): T
}

export interface SafeWorkbookPresentationBatch
  extends GoogleAppsScript.Sheets.Schema.BatchUpdateSpreadsheetRequest {
  requests: GoogleAppsScript.Sheets.Schema.Request[]
}

export function previewWorkbookPresentation(
  port: WorkbookPresentationWorkflowPort,
): WorkbookPresentationPreviewResult {
  const snapshot = port.gateway.inspect()
  const plan = buildWorkbookPresentationPlan(snapshot, port.sha256Hex)
  return {
    mutationCount: 0,
    plannedActionCount: plan.actions.length,
    sourceFingerprint: plan.sourceFingerprint,
    expectedPresentationFingerprint: plan.expectedPresentationFingerprint,
  }
}

export function applyWorkbookPresentation(
  port: WorkbookPresentationWorkflowPort,
): WorkbookPresentationApplyResult {
  return port.withDocumentLock(() => {
    const before = port.gateway.inspect()
    const plan = buildWorkbookPresentationPlan(before, port.sha256Hex)
    if (plan.actions.length === 0) {
      return {
        status: 'NOOP', plannedActionCount: 0, backupCreated: false,
        batchApplied: false, readbackVerified: true,
      }
    }

    // Translation is deliberately completed before backup, so a forged or unsafe
    // plan cannot leave a needless backup behind and can never reach batchUpdate.
    translateWorkbookPresentationPlan(plan)
    const backup = port.gateway.createPrivateNativeBackup(port.backupLabel)
    if (!backup.fileId.trim() || !backup.url.trim()) fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')

    const stable = port.gateway.inspect()
    if (stable.fingerprint !== before.fingerprint) fail('WORKBOOK_PRESENTATION_STALE')
    const stablePlan = buildWorkbookPresentationPlan(stable, port.sha256Hex)
    if (canonicalJson(stablePlan) !== canonicalJson(plan)) fail('WORKBOOK_PRESENTATION_STALE')

    port.gateway.apply(plan)
    const after = port.gateway.inspect()
    verifyWorkbookPresentation(before, after, plan, port.sha256Hex)
    return {
      status: 'APPLIED', plannedActionCount: plan.actions.length, backupCreated: true,
      batchApplied: true, readbackVerified: true,
    }
  })
}

export function createGoogleWorkbookPresentationGateway(
  options: GoogleWorkbookPresentationGatewayOptions,
): GoogleWorkbookPresentationGateway {
  const spreadsheetId = requireOpaque(options.spreadsheetId, 'WORKBOOK_PRESENTATION_CONFIG_INVALID')
  const backupFolderId = requireOpaque(options.backupFolderId, 'WORKBOOK_PRESENTATION_CONFIG_INVALID')
  const sha256Hex = options.sha256Hex ?? appsScriptSha256Hex
  const lockTimeoutMs = options.lockTimeoutMs ?? LOCK_TIMEOUT_MS
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > LOCK_TIMEOUT_MS) {
    fail('WORKBOOK_PRESENTATION_CONFIG_INVALID')
  }

  return {
    inspect() {
      let response: GoogleAppsScript.Sheets.Schema.Spreadsheet
      try {
        const sheetsService = Sheets
        if (!sheetsService) fail('SHEETS_V4_PRESENTATION_METADATA_UNAVAILABLE')
        response = sheetsService.Spreadsheets.get(spreadsheetId, {
          includeGridData: true,
          fields: SHEETS_V4_FIELDS,
        })
      } catch {
        fail('SHEETS_V4_PRESENTATION_METADATA_UNAVAILABLE')
      }
      if (response.spreadsheetId !== spreadsheetId) fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
      return inspectWorkbookPresentationMetadata(response, sha256Hex)
    },
    createPrivateNativeBackup(label) {
      const safeLabel = label.trim()
      if (!safeLabel || safeLabel.length > 180) fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')
      const driveService = Drive as unknown as DrivePresentationService | undefined
      if (!driveService) fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')
      return createAndVerifyPrivateBackup(
        driveService,
        spreadsheetId,
        backupFolderId,
        safeLabel,
      )
    },
    apply(plan) {
      const batch = translateWorkbookPresentationPlan(plan)
      if (batch.requests.length !== plan.actions.length) fail('UNSAFE_PRESENTATION_BATCH')
      try {
        const sheetsService = Sheets
        if (!sheetsService) fail('WORKBOOK_PRESENTATION_BATCH_FAILED')
        sheetsService.Spreadsheets.batchUpdate(batch, spreadsheetId)
      } catch {
        fail('WORKBOOK_PRESENTATION_BATCH_FAILED')
      }
    },
    withDocumentLock<T>(operation: () => T): T {
      const lock = LockService.getScriptLock()
      lock.waitLock(lockTimeoutMs)
      try {
        return operation()
      } finally {
        lock.releaseLock()
      }
    },
  }
}

type DriveFile = GoogleAppsScript.Drive_v3.Drive.V3.Schema.File
type DrivePermission = GoogleAppsScript.Drive_v3.Drive.V3.Schema.Permission
type DrivePermissionList = GoogleAppsScript.Drive_v3.Drive.V3.Schema.PermissionList

interface DrivePresentationService {
  Files: {
    get(fileId: string, options: Record<string, unknown>): DriveFile
    copy(resource: DriveFile, fileId: string, options: Record<string, unknown>): DriveFile
    update(resource: DriveFile, fileId: string): DriveFile
  }
  Permissions: {
    list(fileId: string, options: Record<string, unknown>): DrivePermissionList
  }
}

function createAndVerifyPrivateBackup(
  driveService: DrivePresentationService,
  spreadsheetId: string,
  backupFolderId: string,
  label: string,
): { fileId: string; url: string } {
  let createdFileId = ''
  try {
    const source = driveService.Files.get(spreadsheetId, {
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: false,
    })
    if (!isExactOwnedMyDriveSource(source, spreadsheetId)) {
      fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')
    }

    const destination = driveService.Files.get(backupFolderId, {
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: false,
    })
    if (!isExactPrivateMyDriveFolder(destination, backupFolderId)
      || !hasExactOwnerOnlyPermissions(driveService, backupFolderId)) {
      fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')
    }

    const copy = driveService.Files.copy(
      { name: label, parents: [backupFolderId] },
      spreadsheetId,
      { fields: DRIVE_FILE_FIELDS, supportsAllDrives: false },
    )
    const candidateId = copy.id?.trim() ?? ''
    if (!candidateId || candidateId === spreadsheetId) fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')
    createdFileId = candidateId

    const verified = driveService.Files.get(createdFileId, {
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: false,
    })
    if (!isExactPrivateNativeBackup(verified, createdFileId, backupFolderId)
      || !hasExactOwnerOnlyPermissions(driveService, createdFileId)) {
      fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')
    }
    const url = verified.webViewLink?.trim() ?? ''
    if (!url) fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')
    return { fileId: createdFileId, url }
  } catch {
    if (createdFileId && createdFileId !== spreadsheetId) {
      try {
        driveService.Files.update({ trashed: true }, createdFileId)
      } catch {
        // The safe fixed failure below remains authoritative; never retry, delete,
        // or expose the private identifier when cleanup itself is unavailable.
      }
    }
    fail('WORKBOOK_PRESENTATION_BACKUP_FAILED')
  }
}

function isExactOwnedMyDriveSource(file: DriveFile, expectedId: string): boolean {
  return file.id === expectedId
    && file.mimeType === GOOGLE_SPREADSHEET_MIME
    && file.trashed === false
    && !file.driveId
    && file.ownedByMe === true
    && file.capabilities?.canCopy === true
}

function isExactPrivateMyDriveFolder(file: DriveFile, expectedId: string): boolean {
  return file.id === expectedId
    && file.mimeType === GOOGLE_FOLDER_MIME
    && file.trashed === false
    && !file.driveId
    && file.ownedByMe === true
    && file.shared !== true
    && file.capabilities?.canAddChildren === true
}

function isExactPrivateNativeBackup(
  file: DriveFile,
  expectedId: string,
  expectedParentId: string,
): boolean {
  return file.id === expectedId
    && file.mimeType === GOOGLE_SPREADSHEET_MIME
    && file.trashed === false
    && !file.driveId
    && file.ownedByMe === true
    && file.shared !== true
    && file.parents?.length === 1
    && file.parents[0] === expectedParentId
}

function hasExactOwnerOnlyPermissions(
  driveService: DrivePresentationService,
  fileId: string,
): boolean {
  const permissions: DrivePermission[] = []
  let pageToken = ''
  for (let page = 0; page < 10; page += 1) {
    const response = driveService.Permissions.list(fileId, {
      fields: DRIVE_PERMISSION_FIELDS,
      supportsAllDrives: false,
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    })
    permissions.push(...(response.permissions ?? []))
    pageToken = response.nextPageToken?.trim() ?? ''
    if (!pageToken) break
    if (page === 9) return false
  }
  if (permissions.length !== 1) return false
  const permission = permissions[0]!
  return permission.type === 'user'
    && permission.role === 'owner'
    && permission.deleted !== true
    && permission.pendingOwner !== true
    && permission.allowFileDiscovery !== true
    && !nonempty(permission.permissionDetails)
}

export function inspectWorkbookPresentationMetadata(
  response: GoogleAppsScript.Sheets.Schema.Spreadsheet,
  sha256Hex: WorkbookPresentationSha256,
): WorkbookMetadataSnapshot {
  const spreadsheetId = requireOpaque(response.spreadsheetId ?? '', 'SHEETS_V4_PRESENTATION_METADATA_INVALID')
  if (nonempty(response.namedRanges) || nonempty(response.developerMetadata)) {
    fail('UNSUPPORTED_PRESENTATION_METADATA')
  }
  const rawSheets = response.sheets
  if (!rawSheets || rawSheets.length === 0) fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
  const sheets = rawSheets.map((raw) => inspectSheet(raw, sha256Hex))
  // Bind the full allowlisted Sheets-v4 attestation, including formats that the
  // presentation policy does not own. Only the digest leaves this function.
  const fingerprint = hashCanonical(response, sha256Hex)
  return { spreadsheetId, sheets, fingerprint }
}

export function translateWorkbookPresentationPlan(
  plan: WorkbookPresentationPlan,
): SafeWorkbookPresentationBatch {
  validateTranslatablePlan(plan)
  const requests: GoogleAppsScript.Sheets.Schema.Request[] = []
  const conditionalIndexes = new Map<number, number>()
  for (const action of plan.actions) {
    switch (action.kind) {
      case 'MOVE_SHEET':
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: action.sheetId, index: action.targetIndex },
            fields: 'index',
          },
        })
        break
      case 'SET_HIDDEN':
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: action.sheetId, hidden: action.hidden },
            fields: 'hidden',
          },
        })
        break
      case 'SET_FROZEN':
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: action.sheetId,
              gridProperties: { frozenRowCount: action.rows, frozenColumnCount: action.columns },
            },
            fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
          },
        })
        break
      case 'SET_BASIC_FILTER':
        requests.push({ setBasicFilter: { filter: { range: cloneRange(action.range) } } })
        break
      case 'SET_COLUMN_WIDTH':
        requests.push({
          updateDimensionProperties: {
            range: {
              sheetId: action.sheetId,
              dimension: 'COLUMNS',
              startIndex: action.columnIndex,
              endIndex: action.columnIndex + 1,
            },
            properties: { pixelSize: action.pixelSize },
            fields: 'pixelSize',
          },
        })
        break
      case 'FORMAT_RANGE':
        requests.push({
          repeatCell: {
            range: cloneRange(action.range),
            cell: { userEnteredFormat: managedCellFormat(action.styleKey) },
            fields: managedCellFormatFields(action.styleKey),
          },
        })
        break
      case 'ADD_STATUS_RULE': {
        const nextIndex = conditionalIndexes.get(action.range.sheetId) ?? 0
        requests.push({
          addConditionalFormatRule: {
            index: nextIndex,
            rule: statusConditionalRule(action.range, action.ruleKey),
          },
        })
        conditionalIndexes.set(action.range.sheetId, nextIndex + 1)
        break
      }
      default:
        fail('UNSUPPORTED_PRESENTATION_ACTION')
    }
  }
  validateSafeBatch(requests)
  return {
    includeSpreadsheetInResponse: false,
    responseIncludeGridData: false,
    requests,
  }
}

function inspectSheet(
  raw: GoogleAppsScript.Sheets.Schema.Sheet,
  sha256Hex: WorkbookPresentationSha256,
): SheetPresentationSnapshot {
  const properties = raw.properties
  const grid = properties?.gridProperties
  if (!properties || properties.sheetType && properties.sheetType !== 'GRID'
    || !Number.isSafeInteger(properties.sheetId)
    || !properties.title?.trim()
    || !Number.isSafeInteger(properties.index)
    || !grid
    || !Number.isSafeInteger(grid.rowCount)
    || !Number.isSafeInteger(grid.columnCount)
    || Number(grid.rowCount) < 2
    || Number(grid.columnCount) < 1) {
    fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
  }

  const sheetId = Number(properties.sheetId)
  const maxRows = Number(grid.rowCount)
  const maxColumns = Number(grid.columnCount)
  const cells = readCells(raw.data ?? [], maxRows, maxColumns)
  const headers = readHeaders(cells, maxColumns)
  const widths = readColumnWidths(raw.data ?? [], maxColumns)
  const basicFilter = raw.basicFilter?.range
    ? readRange(raw.basicFilter.range, sheetId, maxRows, maxColumns)
    : null
  const unsupportedBasicFilter = raw.basicFilter
    && (nonempty(raw.basicFilter.criteria) || nonempty(raw.basicFilter.sortSpecs)) ? 1 : 0
  const formats = recognizeManagedFormats({
    sheetId,
    title: properties.title,
    maxRows,
    maxColumns,
    headers,
    cells,
  })
  const recognizedRules = recognizeStatusRules(
    raw.conditionalFormats ?? [], sheetId, maxRows, maxColumns,
  )
  const dimensionUnsupported = countUnsupportedDimensions(raw.data ?? [])
  const unsupportedMetadataCount = unsupportedBasicFilter
    + recognizedRules.unrecognizedCount
    + dimensionUnsupported
    + countUnsupportedCellObjects(cells)
    + count(raw.bandedRanges)
    + count(raw.charts)
    + count(raw.tables)
    + count(raw.developerMetadata)
    + count(raw.rowGroups)
    + count(raw.columnGroups)
    + count(record(raw).slicers)

  const content = contentAttestation(cells)
  const formulas = formulaAttestation(cells)
  const validations = validationAttestation(cells)
  const protections = canonicalValue(raw.protectedRanges ?? [])
  const rowMetadata = rowMetadataAttestation(raw.data ?? [], maxRows)
  return {
    sheetId,
    title: properties.title,
    index: Number(properties.index),
    hidden: properties.hidden === true,
    maxRows,
    maxColumns,
    frozenRows: integerOrZero(grid.frozenRowCount),
    frozenColumns: integerOrZero(grid.frozenColumnCount),
    headers,
    basicFilter,
    filterViewCount: count(raw.filterViews),
    mergedRangeCount: count(raw.merges),
    protectedRangeCount: count(raw.protectedRanges),
    unsupportedMetadataCount,
    columnWidths: widths,
    managedFormats: formats,
    statusRules: recognizedRules.rules,
    valuesHash: hashCanonical(content, sha256Hex),
    formulasHash: hashCanonical(formulas, sha256Hex),
    validationsHash: hashCanonical(validations, sha256Hex),
    protectionsHash: hashCanonical(protections, sha256Hex),
    rowMetadataHash: hashCanonical(rowMetadata, sha256Hex),
  }
}

interface InspectedCell {
  rowIndex: number
  columnIndex: number
  data: GoogleAppsScript.Sheets.Schema.CellData
}

interface ManagedFormatInspectionInput {
  sheetId: number
  title: string
  maxRows: number
  maxColumns: number
  headers: readonly string[]
  cells: ReadonlyMap<string, InspectedCell>
}

function readCells(
  segments: readonly GoogleAppsScript.Sheets.Schema.GridData[],
  maxRows: number,
  maxColumns: number,
): Map<string, InspectedCell> {
  const result = new Map<string, InspectedCell>()
  for (const segment of segments) {
    const startRow = integerOrZero(segment.startRow)
    const startColumn = integerOrZero(segment.startColumn)
    for (let rowOffset = 0; rowOffset < (segment.rowData?.length ?? 0); rowOffset += 1) {
      const rowIndex = startRow + rowOffset
      const values = segment.rowData?.[rowOffset]?.values ?? []
      for (let columnOffset = 0; columnOffset < values.length; columnOffset += 1) {
        const columnIndex = startColumn + columnOffset
        if (rowIndex >= maxRows || columnIndex >= maxColumns) {
          fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
        }
        const key = cellKey(rowIndex, columnIndex)
        if (result.has(key)) fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
        result.set(key, { rowIndex, columnIndex, data: values[columnOffset]! })
      }
    }
  }
  return result
}

function readHeaders(cells: ReadonlyMap<string, InspectedCell>, maxColumns: number): string[] {
  const values: string[] = []
  let lastNonempty = -1
  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    const entered = cells.get(cellKey(0, columnIndex))?.data.userEnteredValue
    const value = typeof entered?.stringValue === 'string' ? entered.stringValue : ''
    values.push(value)
    if (value !== '') lastNonempty = columnIndex
  }
  return lastNonempty < 0 ? [] : values.slice(0, lastNonempty + 1)
}

function readColumnWidths(
  segments: readonly GoogleAppsScript.Sheets.Schema.GridData[],
  maxColumns: number,
): number[] {
  const widths = Array(maxColumns).fill(100) as number[]
  for (const segment of segments) {
    const startColumn = integerOrZero(segment.startColumn)
    for (let offset = 0; offset < (segment.columnMetadata?.length ?? 0); offset += 1) {
      const columnIndex = startColumn + offset
      const pixelSize = segment.columnMetadata?.[offset]?.pixelSize
      if (columnIndex >= maxColumns || pixelSize !== undefined
        && (!Number.isSafeInteger(pixelSize) || pixelSize < 20 || pixelSize > 2_000)) {
        fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
      }
      if (pixelSize !== undefined) widths[columnIndex] = pixelSize
    }
  }
  return widths
}

function recognizeManagedFormats(input: ManagedFormatInspectionInput): ManagedFormatSnapshot[] {
  if (!VISIBLE_TABS.has(input.title)) return []
  const targets: ManagedFormatSnapshot[] = []
  if (input.title === 'DASHBOARD') {
    if (input.maxRows < 14 || input.maxColumns < 8) return []
    targets.push(
      { range: range(input.sheetId, 0, 1, 0, 2), styleKey: 'HEADER' },
      { range: range(input.sheetId, 1, 10, 0, 2), styleKey: 'BODY' },
      { range: range(input.sheetId, 12, 13, 0, 8), styleKey: 'HEADER' },
      { range: range(input.sheetId, 13, input.maxRows, 0, 8), styleKey: 'BODY' },
    )
  } else {
    targets.push({
      range: range(input.sheetId, 0, 1, 0, input.headers.length),
      styleKey: 'HEADER',
    })
    input.headers.forEach((header, columnIndex) => targets.push({
      range: range(input.sheetId, 1, input.maxRows, columnIndex, columnIndex + 1),
      styleKey: bodyStyle(header),
    }))
  }
  return targets.filter((target) => rangeMatchesStyle(input.cells, target.range, target.styleKey))
}

function rangeMatchesStyle(
  cells: ReadonlyMap<string, InspectedCell>,
  target: GridRangeSnapshot,
  styleKey: WorkbookPresentationStyleKey,
): boolean {
  for (let rowIndex = target.startRowIndex; rowIndex < target.endRowIndex; rowIndex += 1) {
    for (let columnIndex = target.startColumnIndex; columnIndex < target.endColumnIndex; columnIndex += 1) {
      const format = cells.get(cellKey(rowIndex, columnIndex))?.data.userEnteredFormat
      if (!format || !sameManagedFormat(format, managedCellFormat(styleKey), styleKey)) return false
    }
  }
  return true
}

function sameManagedFormat(
  actual: GoogleAppsScript.Sheets.Schema.CellFormat,
  expected: GoogleAppsScript.Sheets.Schema.CellFormat,
  styleKey: WorkbookPresentationStyleKey,
): boolean {
  if (!sameEffectiveColor(
    actual.backgroundColorStyle,
    actual.backgroundColor,
    expected.backgroundColorStyle,
    expected.backgroundColor,
  ) || !sameEffectiveColor(
    actual.textFormat?.foregroundColorStyle,
    actual.textFormat?.foregroundColor,
    expected.textFormat?.foregroundColorStyle,
    expected.textFormat?.foregroundColor,
  ) || (actual.textFormat?.bold === true) !== (expected.textFormat?.bold === true)
    || (actual.verticalAlignment ?? null) !== (expected.verticalAlignment ?? null)
    || (actual.wrapStrategy ?? null) !== (expected.wrapStrategy ?? null)
    || !sameBorders(actual.borders, expected.borders)) return false

  if (styleKey === 'BODY_PLAIN_TEXT' || styleKey === 'BODY_PLAIN_TEXT_WRAP'
    || styleKey === 'BODY_CURRENCY') {
    return canonicalJson(actual.numberFormat ?? null) === canonicalJson(expected.numberFormat ?? null)
  }
  return true
}

function recognizeStatusRules(
  rules: readonly GoogleAppsScript.Sheets.Schema.ConditionalFormatRule[],
  sheetId: number,
  maxRows: number,
  maxColumns: number,
): { rules: StatusRuleSnapshot[]; unrecognizedCount: number } {
  const recognized: StatusRuleSnapshot[] = []
  let unrecognizedCount = 0
  for (const candidate of rules) {
    const ranges = candidate.ranges ?? []
    if (ranges.length !== 1) {
      unrecognizedCount += 1
      continue
    }
    let normalizedRange: GridRangeSnapshot
    try {
      normalizedRange = readRange(ranges[0]!, sheetId, maxRows, maxColumns)
    } catch {
      unrecognizedCount += 1
      continue
    }
    const matched = [...STATUS_RULE_KEYS].find((ruleKey) => sameStatusConditionalRule(
      candidate,
      statusConditionalRule(normalizedRange, ruleKey),
      normalizedRange,
    ))
    if (!matched) {
      unrecognizedCount += 1
      continue
    }
    recognized.push({ range: normalizedRange, ruleKey: matched })
  }
  return { rules: recognized, unrecognizedCount }
}

function sameStatusConditionalRule(
  actual: GoogleAppsScript.Sheets.Schema.ConditionalFormatRule,
  expected: GoogleAppsScript.Sheets.Schema.ConditionalFormatRule,
  normalizedRange: GridRangeSnapshot,
): boolean {
  if (actual.gradientRule || hasUnexpectedKeys(actual, ['ranges', 'booleanRule'])
    || hasUnexpectedKeys(actual.booleanRule, ['condition', 'format'])
    || hasUnexpectedKeys(actual.booleanRule?.condition, ['type', 'values'])
    || hasUnexpectedKeys(actual.booleanRule?.format, [
      'backgroundColor', 'backgroundColorStyle', 'textFormat',
    ])
    || hasUnexpectedKeys(actual.booleanRule?.format?.textFormat, [
      'bold', 'foregroundColor', 'foregroundColorStyle',
    ])) return false

  const normalize = (rule: GoogleAppsScript.Sheets.Schema.ConditionalFormatRule) => ({
    ranges: [normalizedRange],
    condition: canonicalValue(rule.booleanRule?.condition ?? null),
  })
  return canonicalJson(normalize(actual)) === canonicalJson(normalize(expected))
    && sameEffectiveColor(
      actual.booleanRule?.format?.backgroundColorStyle,
      actual.booleanRule?.format?.backgroundColor,
      expected.booleanRule?.format?.backgroundColorStyle,
      expected.booleanRule?.format?.backgroundColor,
    )
    && sameEffectiveColor(
      actual.booleanRule?.format?.textFormat?.foregroundColorStyle,
      actual.booleanRule?.format?.textFormat?.foregroundColor,
      expected.booleanRule?.format?.textFormat?.foregroundColorStyle,
      expected.booleanRule?.format?.textFormat?.foregroundColor,
    )
    && (actual.booleanRule?.format?.textFormat?.bold === true)
      === (expected.booleanRule?.format?.textFormat?.bold === true)
}

function contentAttestation(cells: ReadonlyMap<string, InspectedCell>): unknown[] {
  return sortedCells(cells).flatMap(({ rowIndex, columnIndex, data }) => {
    const raw = record(data)
    const entered = data.userEnteredValue
    const literal = entered && entered.formulaValue === undefined ? canonicalValue(entered) : null
    const note = data.note ?? null
    const runs = data.textFormatRuns?.length ? canonicalValue(data.textFormatRuns) : null
    const chips = nonempty(raw.chipRuns) ? canonicalValue(raw.chipRuns) : null
    return literal === null && note === null && runs === null && chips === null
      ? []
      : [{ rowIndex, columnIndex, literal, note, textFormatRuns: runs, chipRuns: chips }]
  })
}

function formulaAttestation(cells: ReadonlyMap<string, InspectedCell>): unknown[] {
  return sortedCells(cells).flatMap(({ rowIndex, columnIndex, data }) => {
    const formula = data.userEnteredValue?.formulaValue
    const dataSourceFormula = record(data).dataSourceFormula
    return formula === undefined && !nonempty(dataSourceFormula)
      ? []
      : [{
        rowIndex,
        columnIndex,
        formula: formula ?? null,
        dataSourceFormula: nonempty(dataSourceFormula) ? canonicalValue(dataSourceFormula) : null,
      }]
  })
}

function validationAttestation(cells: ReadonlyMap<string, InspectedCell>): unknown[] {
  return sortedCells(cells).flatMap(({ rowIndex, columnIndex, data }) => data.dataValidation
    ? [{ rowIndex, columnIndex, validation: canonicalValue(data.dataValidation) }]
    : [])
}

function sortedCells(cells: ReadonlyMap<string, InspectedCell>): InspectedCell[] {
  return [...cells.values()].sort((left, right) => left.rowIndex - right.rowIndex
    || left.columnIndex - right.columnIndex)
}

function countUnsupportedDimensions(
  segments: readonly GoogleAppsScript.Sheets.Schema.GridData[],
): number {
  let countUnsupported = 0
  for (const segment of segments) {
    for (const metadata of segment.columnMetadata ?? []) {
      if (metadata.hiddenByFilter || metadata.hiddenByUser || nonempty(metadata.developerMetadata)) {
        countUnsupported += 1
      }
    }
    for (const metadata of segment.rowMetadata ?? []) {
      if (metadata.hiddenByFilter || metadata.hiddenByUser || nonempty(metadata.developerMetadata)) {
        countUnsupported += 1
      }
    }
  }
  return countUnsupported
}

function countUnsupportedCellObjects(cells: ReadonlyMap<string, InspectedCell>): number {
  let unsupported = 0
  for (const { data } of cells.values()) {
    const raw = record(data)
    if (nonempty(data.pivotTable)) unsupported += 1
    if (nonempty(raw.dataSourceTable)) unsupported += 1
    if (nonempty(raw.dataSourceTables)) unsupported += 1
  }
  return unsupported
}

function rowMetadataAttestation(
  segments: readonly GoogleAppsScript.Sheets.Schema.GridData[],
  maxRows: number,
): unknown[] {
  const rows = new Map<number, unknown>()
  for (const segment of segments) {
    const startRow = integerOrZero(segment.startRow)
    for (let offset = 0; offset < (segment.rowMetadata?.length ?? 0); offset += 1) {
      const rowIndex = startRow + offset
      if (rowIndex >= maxRows || rows.has(rowIndex)) fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
      const metadata = segment.rowMetadata?.[offset]
      if (metadata?.pixelSize !== undefined
        && (!Number.isSafeInteger(metadata.pixelSize) || metadata.pixelSize < 2 || metadata.pixelSize > 2_000)) {
        fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
      }
      rows.set(rowIndex, metadata?.pixelSize === undefined ? {} : { pixelSize: metadata.pixelSize })
    }
  }
  return [...rows.entries()]
    .filter(([, metadata]) => nonempty(metadata))
    .sort(([left], [right]) => left - right)
    .map(([rowIndex, metadata]) => ({ rowIndex, metadata }))
}

function validateTranslatablePlan(plan: WorkbookPresentationPlan): void {
  if (!plan || !Array.isArray(plan.actions) || !Array.isArray(plan.visibleOrder)
    || !plan.sourceFingerprint?.trim() || !/^wp1-[0-9a-f]{64}$/.test(plan.expectedPresentationFingerprint)
    || canonicalJson(plan.visibleOrder) !== canonicalJson(VISIBLE_TAB_ORDER)) {
    fail('UNSAFE_PRESENTATION_BATCH')
  }
  const unique = new Set<string>()
  const formatRanges: GridRangeSnapshot[] = []
  const statusRanges: GridRangeSnapshot[] = []
  for (const action of plan.actions as readonly WorkbookPresentationAction[]) {
    if (!action || typeof action !== 'object' || typeof action.kind !== 'string') {
      fail('UNSUPPORTED_PRESENTATION_ACTION')
    }
    let key: string
    switch (action.kind) {
      case 'MOVE_SHEET':
        requireSheetId(action.sheetId)
        requireIndex(action.targetIndex)
        key = `${action.kind}:${action.sheetId}`
        break
      case 'SET_HIDDEN':
        requireSheetId(action.sheetId)
        if (typeof action.hidden !== 'boolean') fail('UNSAFE_PRESENTATION_BATCH')
        key = `${action.kind}:${action.sheetId}`
        break
      case 'SET_FROZEN':
        requireSheetId(action.sheetId)
        requireIndex(action.rows)
        requireIndex(action.columns)
        key = `${action.kind}:${action.sheetId}`
        break
      case 'SET_BASIC_FILTER':
        validateActionRange(action.range)
        key = `${action.kind}:${action.range.sheetId}`
        break
      case 'SET_COLUMN_WIDTH':
        requireSheetId(action.sheetId)
        requireIndex(action.columnIndex)
        if (!Number.isSafeInteger(action.pixelSize) || action.pixelSize < 20 || action.pixelSize > 2_000) {
          fail('UNSAFE_PRESENTATION_BATCH')
        }
        key = `${action.kind}:${action.sheetId}:${action.columnIndex}`
        break
      case 'FORMAT_RANGE':
        validateActionRange(action.range)
        if (!MANAGED_STYLE_KEYS.has(action.styleKey)) fail('UNSAFE_PRESENTATION_BATCH')
        formatRanges.push(action.range)
        key = `${action.kind}:${rangeKey(action.range)}`
        break
      case 'ADD_STATUS_RULE':
        validateActionRange(action.range)
        if (!STATUS_RULE_KEYS.has(action.ruleKey)) fail('UNSAFE_PRESENTATION_BATCH')
        statusRanges.push(action.range)
        key = `${action.kind}:${rangeKey(action.range)}`
        break
      default:
        fail('UNSUPPORTED_PRESENTATION_ACTION')
    }
    if (unique.has(key)) fail('UNSAFE_PRESENTATION_BATCH')
    unique.add(key)
  }
  assertNonOverlapping(formatRanges)
  assertNonOverlapping(statusRanges)
}

function validateSafeBatch(requests: readonly GoogleAppsScript.Sheets.Schema.Request[]): void {
  if (requests.length === 0) fail('UNSAFE_PRESENTATION_BATCH')
  for (const request of requests) {
    const keys = Object.keys(request).filter((key) => record(request)[key] !== undefined)
    if (keys.length !== 1 || !ALLOWED_REQUEST_KEYS.has(keys[0]!)) fail('UNSAFE_PRESENTATION_BATCH')
    if (request.repeatCell) {
      const cellKeys = Object.keys(request.repeatCell.cell ?? {})
      if (cellKeys.length !== 1 || cellKeys[0] !== 'userEnteredFormat'
        || request.repeatCell.cell?.userEnteredValue !== undefined
        || request.repeatCell.cell?.dataValidation !== undefined
        || request.repeatCell.cell?.note !== undefined) {
        fail('UNSAFE_PRESENTATION_BATCH')
      }
    }
  }
  const serialized = JSON.stringify(requests)
  for (const forbidden of [
    'delete', 'clear', 'dataValidation', 'protectedRange', 'filterView',
    'insertDimension', 'appendDimension', 'autoResizeDimensions', 'addSheet', 'title',
  ]) {
    if (serialized.includes(forbidden)) fail('UNSAFE_PRESENTATION_BATCH')
  }
}

function managedCellFormat(
  styleKey: WorkbookPresentationStyleKey,
): GoogleAppsScript.Sheets.Schema.CellFormat {
  if (!MANAGED_STYLE_KEYS.has(styleKey)) fail('UNSAFE_PRESENTATION_BATCH')
  const header = styleKey === 'HEADER'
  const plain = styleKey === 'BODY_PLAIN_TEXT' || styleKey === 'BODY_PLAIN_TEXT_WRAP'
  const currency = styleKey === 'BODY_CURRENCY'
  const wrap = styleKey === 'BODY_WRAP' || styleKey === 'BODY_PLAIN_TEXT_WRAP'
  return {
    backgroundColorStyle: { rgbColor: cloneColor(header ? COLORS.headerGray : COLORS.white) },
    textFormat: {
      bold: header,
      foregroundColorStyle: { rgbColor: cloneColor(COLORS.nearBlack) },
    },
    verticalAlignment: 'MIDDLE',
    wrapStrategy: header || wrap ? 'WRAP' : 'CLIP',
    borders: {
      top: managedBorder(), bottom: managedBorder(), left: managedBorder(), right: managedBorder(),
    },
    numberFormat: plain
      ? { type: 'TEXT', pattern: '@' }
      : currency ? { type: 'NUMBER', pattern: '฿#,##0.00' } : undefined,
  }
}

function managedCellFormatFields(styleKey: WorkbookPresentationStyleKey): string {
  const fields = [
    'userEnteredFormat.backgroundColorStyle',
    'userEnteredFormat.textFormat.bold',
    'userEnteredFormat.textFormat.foregroundColorStyle',
    'userEnteredFormat.verticalAlignment',
    'userEnteredFormat.wrapStrategy',
    'userEnteredFormat.borders',
  ]
  if (styleKey === 'BODY_PLAIN_TEXT' || styleKey === 'BODY_PLAIN_TEXT_WRAP'
    || styleKey === 'BODY_CURRENCY') fields.push('userEnteredFormat.numberFormat')
  return fields.join(',')
}

function managedBorder(): GoogleAppsScript.Sheets.Schema.Border {
  return { style: 'SOLID', colorStyle: { rgbColor: cloneColor(COLORS.borderGray) } }
}

function statusConditionalRule(
  target: GridRangeSnapshot,
  ruleKey: WorkbookStatusRuleKey,
): GoogleAppsScript.Sheets.Schema.ConditionalFormatRule {
  if (!STATUS_RULE_KEYS.has(ruleKey)) fail('UNSAFE_PRESENTATION_BATCH')
  const column = columnLetter(target.startColumnIndex)
  const row = target.startRowIndex + 1
  const clauses = ACTIONABLE_STATUSES[ruleKey].map((value) => `$${column}${row}="${value}"`)
  return {
    ranges: [cloneRange(target)],
    booleanRule: {
      condition: {
        type: 'CUSTOM_FORMULA',
        values: [{ userEnteredValue: `=OR(${clauses.join(',')})` }],
      },
      format: {
        backgroundColorStyle: { rgbColor: cloneColor(COLORS.actionAmber) },
        textFormat: {
          bold: true,
          foregroundColorStyle: { rgbColor: cloneColor(COLORS.actionAmberText) },
        },
      },
    },
  }
}

function bodyStyle(header: string): WorkbookPresentationStyleKey {
  const normalized = header.toLowerCase()
  const plain = normalized === 'id'
    || normalized.endsWith('id')
    || normalized.endsWith('ids')
    || normalized.includes('hash')
    || normalized.includes('phone')
    || normalized.includes('url')
    || normalized.endsWith('json')
  const currency = CURRENCY_HEADERS.has(header)
  const wrap = WRAPPED_HEADERS.has(header)
  if (plain && wrap) return 'BODY_PLAIN_TEXT_WRAP'
  if (plain) return 'BODY_PLAIN_TEXT'
  if (currency) return 'BODY_CURRENCY'
  if (wrap) return 'BODY_WRAP'
  return 'BODY'
}

function readRange(
  input: GoogleAppsScript.Sheets.Schema.GridRange,
  expectedSheetId: number,
  maxRows: number,
  maxColumns: number,
): GridRangeSnapshot {
  const result = {
    sheetId: input.sheetId ?? expectedSheetId,
    startRowIndex: input.startRowIndex ?? 0,
    endRowIndex: input.endRowIndex ?? maxRows,
    startColumnIndex: input.startColumnIndex ?? 0,
    endColumnIndex: input.endColumnIndex ?? maxColumns,
  }
  validateActionRange(result)
  if (result.sheetId !== expectedSheetId || result.endRowIndex > maxRows
    || result.endColumnIndex > maxColumns) fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
  return result
}

function validateActionRange(target: GridRangeSnapshot): void {
  requireSheetId(target.sheetId)
  for (const value of [
    target.startRowIndex, target.endRowIndex, target.startColumnIndex, target.endColumnIndex,
  ]) requireIndex(value)
  if (target.startRowIndex >= target.endRowIndex || target.startColumnIndex >= target.endColumnIndex) {
    fail('UNSAFE_PRESENTATION_BATCH')
  }
}

function assertNonOverlapping(ranges: readonly GridRangeSnapshot[]): void {
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      if (rangesOverlap(ranges[left]!, ranges[right]!)) fail('UNSAFE_PRESENTATION_BATCH')
    }
  }
}

function rangesOverlap(left: GridRangeSnapshot, right: GridRangeSnapshot): boolean {
  return left.sheetId === right.sheetId
    && left.startRowIndex < right.endRowIndex
    && right.startRowIndex < left.endRowIndex
    && left.startColumnIndex < right.endColumnIndex
    && right.startColumnIndex < left.endColumnIndex
}

function appsScriptSha256Hex(value: string): string {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8,
  )
  return bytes.map((byte) => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('')
}

function hashCanonical(value: unknown, sha256Hex: WorkbookPresentationSha256): string {
  if (typeof sha256Hex !== 'function') fail('PRESENTATION_SHA256_REQUIRED')
  const digest = sha256Hex(canonicalJson(value)).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(digest)) fail('INVALID_PRESENTATION_SHA256')
  return digest
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().flatMap((key) => {
    const item = (value as Record<string, unknown>)[key]
    return item === undefined ? [] : [[key, canonicalValue(item)]]
  }))
}

const COLOR_TOLERANCE = 1e-5

function sameEffectiveColor(
  actualStyle: GoogleAppsScript.Sheets.Schema.ColorStyle | undefined,
  actualDeprecated: GoogleAppsScript.Sheets.Schema.Color | undefined,
  expectedStyle: GoogleAppsScript.Sheets.Schema.ColorStyle | undefined,
  expectedDeprecated: GoogleAppsScript.Sheets.Schema.Color | undefined,
): boolean {
  const actual = effectiveRgbColor(actualStyle, actualDeprecated)
  const expected = effectiveRgbColor(expectedStyle, expectedDeprecated)
  if (!actual || !expected) return actual === expected
  return ['red', 'green', 'blue', 'alpha'].every((component) => Math.abs(
    actual[component as keyof typeof actual] - expected[component as keyof typeof expected],
  ) <= COLOR_TOLERANCE)
}

function effectiveRgbColor(
  style: GoogleAppsScript.Sheets.Schema.ColorStyle | undefined,
  deprecated: GoogleAppsScript.Sheets.Schema.Color | undefined,
): { red: number; green: number; blue: number; alpha: number } | null {
  // ColorStyle takes precedence. A theme style is intentionally not resolved
  // through the deprecated RGB field because the visible color is theme-owned.
  const color = style
    ? style.themeColor || !style.rgbColor ? null : style.rgbColor
    : deprecated ?? null
  if (!color) return null
  const normalized = {
    red: color.red ?? 0,
    green: color.green ?? 0,
    blue: color.blue ?? 0,
    alpha: color.alpha ?? 1,
  }
  return Object.values(normalized).every((value) => Number.isFinite(value)
    && value >= 0 && value <= 1) ? normalized : null
}

function sameBorders(
  actual: GoogleAppsScript.Sheets.Schema.Borders | undefined,
  expected: GoogleAppsScript.Sheets.Schema.Borders | undefined,
): boolean {
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const actualBorder = actual?.[side]
    const expectedBorder = expected?.[side]
    if (!actualBorder || !expectedBorder
      || actualBorder.style !== expectedBorder.style
      || !sameEffectiveColor(
        actualBorder.colorStyle,
        actualBorder.color,
        expectedBorder.colorStyle,
        expectedBorder.color,
      )) return false
  }
  return true
}

function cloneColor(color: Readonly<{ red: number; green: number; blue: number }>): {
  red: number; green: number; blue: number
} {
  return { red: color.red, green: color.green, blue: color.blue }
}

function cloneRange(target: GridRangeSnapshot): GridRangeSnapshot {
  return { ...target }
}

function range(
  sheetId: number,
  startRowIndex: number,
  endRowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number,
): GridRangeSnapshot {
  return { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }
}

function rangeKey(target: GridRangeSnapshot): string {
  return [
    target.sheetId, target.startRowIndex, target.endRowIndex,
    target.startColumnIndex, target.endColumnIndex,
  ].join(':')
}

function cellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`
}

function columnLetter(columnIndex: number): string {
  let value = columnIndex + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

function requireSheetId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) fail('UNSAFE_PRESENTATION_BATCH')
}

function requireIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    fail('UNSAFE_PRESENTATION_BATCH')
  }
}

function integerOrZero(value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || value < 0) fail('SHEETS_V4_PRESENTATION_METADATA_INVALID')
  return value
}

function requireOpaque(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 1_000) fail(code)
  return normalized
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function nonempty(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  if (typeof value === 'string') return value.length > 0
  return true
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function hasUnexpectedKeys(value: unknown, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.entries(record(value)).some(([key, item]) => !allowedSet.has(key) && nonempty(item))
}

function fail(code: string): never {
  throw new Error(code)
}
