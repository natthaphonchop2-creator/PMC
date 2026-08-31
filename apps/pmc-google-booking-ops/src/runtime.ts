import { createGoogleCalendarPort } from './adapters/googleCalendar'
import { calendarEventInput, ensureDoctorCalendarEvent } from './adapters/googleCalendar'
import { createGoogleBackupPort, createGoogleDrivePort } from './adapters/googleDrive'
import { ensureCaseEvidenceFolder } from './adapters/googleDrive'
import { createGoogleFilePort } from './adapters/googleFiles'
import {
  createGoogleFormsPort,
} from './adapters/googleForms'
import { createEvidenceMediaPort } from './adapters/evidenceMedia'
import { createAppsScriptDraftCleanupPort } from './adapters/draftCleanupClient'
import {
  adminBookingMessageBatches,
  adminTentativeMessageBatches,
  adminAwaitingSlotMessageBatches,
  adminEvidenceMessageBatches,
  adminTimeConflictMessage,
  bookingTeamProfiles,
  createAppsScriptCryptoPort,
  createGoogleLinePort,
  doctorBookingMessage,
  sendBookingConfirmationMessages,
} from './adapters/lineMessaging'
import { sendDoctorBookingMessage } from './adapters/lineMessaging'
import {
  createGoogleDashboardPort,
  createGoogleExpenseTopologyPort,
  createGoogleSheetStore,
  ensureSheetTopology,
  migrateBookingMasterStaffColumns,
  migrateConfigStaffColumns,
  readGoogleBookingAttributionMigrationSnapshot,
  writeGoogleBookingAttributionMigration,
} from './adapters/googleSheets'
import { SCRIPT_PROPERTY_KEYS } from './config'
import { BOOKING_FORM_LABELS, NO_AE_OPTION } from './config'
import {
  bookingAttributionFormChoices,
  resolveCloserByEmail,
  resolveCloserByName,
  resolveEligibleAeByName,
  parseStaffConfigRow,
  validateStaffDirectory,
} from './domain/staffDirectory'
import { staffProfileUrlPlan } from './domain/staffProfileConfig'
import { migrateAppointmentRows } from './domain/appointmentMigration'
import { STAFF_CONFIG_COLUMNS } from './sheetSchema'
import type { CallResult } from './domain/types'
import type { BookingIntake } from './domain/types'
import type {
  BookingPorts,
  ChannelConfig,
  ConfigPort,
  DoctorConfig,
  ServiceConfig,
  StaffConfig,
  WorkbookPresentationWorkflowPort,
} from './ports'
import {
  createBookingRepositories,
  createStockRepository,
  type SheetRow,
  type SheetStore,
} from './repositories'
import { createGoogleMiniAppRequestStatePort } from './adapters/miniAppRequestState'
import { canonicalMiniAppStockCommand } from '../../../shared/pmcMiniAppStockIngress'
import { canonicalMiniAppExpenseCommand } from '../../../shared/pmcMiniAppExpenseIngress'
import {
  configureStockManagers,
  type StockIngressPorts,
} from './stock/ingress'
import { createGoogleExpenseRepository } from './expense/repository'
import { runExpenseRecovery, type ExpenseRecoveryResult } from './expense/commands'
import type { ExpenseIngressPorts } from './expense/ingress'
import {
  createInitialCallTask,
  runDailyCallReminders,
  runDailyDoctorSchedules,
  runDepositExpiryReminders,
} from './workflows/callQueue'
import { writeDashboard } from './workflows/dashboard'
import {
  buildProductionFlexValidationMessages,
  lineValidationPropertyPaths,
} from './workflows/flexValidation'
import { sendCallReminderFlexPilot, sendProductionFlexPilot } from './workflows/flexPilot'
import { createDailyBackup, runIntegrityReport } from './workflows/integrity'
import { queueEvidenceRetention, reconcileAndExpireDraftEvidenceRetention } from './workflows/retention'
import {
  approveDraftEvidenceRetention,
  executeDraftEvidenceRetention,
  previewDraftEvidenceRetention,
  readbackDraftEvidenceRetention,
  type DraftRetentionPreview,
} from './workflows/draftEvidenceCleanup'
import { seedStaffRowsFromLegacy } from './workflows/staffAeMigration'
import { prepareAutomaticQueue } from './workflows/automaticQueue'
import {
  applyExpensePermissionGrants,
  ensureFinanceMasterTopology,
  prepareExpensePermissionRoster,
  type ExpensePermissionRosterItem,
} from './expense/setup'
import {
  applyBookingAttributionMigration,
  previewBookingAttributionMigration,
  type BookingAttributionMigrationPorts,
} from './workflows/attributionMigration'
import {
  canonicalAttributionMigrationSnapshot,
  migrationSnapshotFingerprint,
  type AttributionMigrationSheetSnapshot,
} from './domain/attributionMigration'
import {
  createBookingMigrationManifestEnvelope,
  parseBookingMigrationManifestJson,
  parseBookingQueueAttestationJson,
  validateBookingMigrationManifestTransition,
  type BookingMigrationManifest,
  type BookingQueueAttestation,
} from './domain/attributionMigrationState'
import {
  applyWorkbookPresentation,
  createGoogleWorkbookPresentationGateway,
} from './adapters/googleWorkbookPresentation'
import {
  buildWorkbookPresentationPlan,
  type WorkbookMetadataSnapshot,
  type WorkbookPresentationAction,
} from './domain/workbookPresentation'

const REQUIRED_PROPERTIES = [
  SCRIPT_PROPERTY_KEYS.spreadsheetId,
  SCRIPT_PROPERTY_KEYS.bookingFormId,
  SCRIPT_PROPERTY_KEYS.callResultFormId,
  SCRIPT_PROPERTY_KEYS.driveRootId,
  SCRIPT_PROPERTY_KEYS.jeraIncomingFolderId,
  SCRIPT_PROPERTY_KEYS.backupFolderId,
  SCRIPT_PROPERTY_KEYS.adminLineGroupId,
  SCRIPT_PROPERTY_KEYS.lineAccessToken,
  SCRIPT_PROPERTY_KEYS.bookingIngressSecret,
  SCRIPT_PROPERTY_KEYS.mediaBaseUrl,
  SCRIPT_PROPERTY_KEYS.mediaSigningSecret,
  SCRIPT_PROPERTY_KEYS.brandLogoUrl,
] as const

const ATTRIBUTION_MIGRATION_QUEUE_ATTESTATION = 'PMC_BOOKING_ATTRIBUTION_QUEUE_ATTESTATION'
const ATTRIBUTION_MIGRATION_EXPECTED_QUEUE_DIGEST = 'PMC_BOOKING_ATTRIBUTION_EXPECTED_QUEUE_DIGEST'
const ATTRIBUTION_MIGRATION_MANIFEST = 'PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST'
const ATTRIBUTION_MIGRATION_APPROVAL = 'PMC_BOOKING_ATTRIBUTION_APPROVED_FINGERPRINT'
const ATTRIBUTION_MIGRATION_GATE_MAX_AGE_MS = 10 * 60 * 1_000
const ATTRIBUTION_MIGRATION_ENVIRONMENT = 'production'
const ATTRIBUTION_MIGRATION_CHECKER_VERSION = 'pmc-booking-attribution-v2/1'
const ATTRIBUTION_REQUEST_ROW_LIMIT = 10_000
const ATTRIBUTION_MASTER_ROW_LIMIT = 100_000
const WORKBOOK_PRESENTATION_OWNER_APPROVAL = 'PMC_BOOKING_WORKBOOK_PRESENTATION_APPROVED_DIGEST'

export const BOOKING_INSTALLABLE_TRIGGER_REGISTRY = Object.freeze({
  bookingForm: Object.freeze({ handler: 'onBookingFormSubmit', kind: 'FORM' } as const),
  callResultForm: Object.freeze({ handler: 'onCallResultSubmit', kind: 'FORM' } as const),
  queueConfirmationForm: Object.freeze({
    handler: 'onQueueConfirmationSubmit', kind: 'FORM',
  } as const),
  dailyOperations: Object.freeze({ handler: 'runDailyOperations', kind: 'CLOCK' } as const),
  integrityChecks: Object.freeze({ handler: 'runIntegrityChecks', kind: 'CLOCK' } as const),
})

export type BookingInstallableTrigger = typeof BOOKING_INSTALLABLE_TRIGGER_REGISTRY[
  keyof typeof BOOKING_INSTALLABLE_TRIGGER_REGISTRY
]
type BookingFormTriggerHandler = Extract<BookingInstallableTrigger, { kind: 'FORM' }>['handler']
type BookingClockTriggerHandler = Extract<BookingInstallableTrigger, { kind: 'CLOCK' }>['handler']

const WORKBOOK_PRESENTATION_ACTION_ORDER: readonly WorkbookPresentationAction['kind'][] = Object.freeze([
  'MOVE_SHEET',
  'SET_HIDDEN',
  'SET_FROZEN',
  'SET_BASIC_FILTER',
  'SET_COLUMN_WIDTH',
  'FORMAT_RANGE',
  'ADD_STATUS_RULE',
])
const WORKBOOK_PRESENTATION_MANUAL_HANDLERS = Object.freeze([
  'previewPmcBookingWorkbookPresentation',
  'applyPmcBookingWorkbookPresentation',
] as const)

export function validateRuntimeProperties(properties: Record<string, string | undefined>): void {
  const missing = REQUIRED_PROPERTIES.filter((key) => !properties[key]?.trim())
  if (missing.length) throw new Error(`Missing Script Properties: ${missing.join(', ')}`)
}

function isActive(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'
}

function createConfigPort(
  store: SheetStore,
  adminLineGroupId: string,
  brandLogoUrl: string,
  sharedAccountEmail: string,
  callQueueUrl: string,
): ConfigPort {
  const staff = (): StaffConfig[] =>
    store.read('CONFIG_STAFF').map(parseStaffConfigRow)
  const doctors = (): DoctorConfig[] =>
    store.read('CONFIG_DOCTORS').map((row) => ({
      id: String(row.id),
      name: String(row.name),
      calendarId: String(row.calendarId),
      lineGroupId: String(row.lineGroupId),
      active: isActive(row.active),
    }))
  const services = (): ServiceConfig[] =>
    store.read('CONFIG_SERVICES').map((row) => ({
      id: String(row.id),
      name: String(row.name),
      durationMinutes: Number(row.durationMinutes),
      active: isActive(row.active),
    }))
  const channels = (): ChannelConfig[] =>
    store.read('CONFIG_CHANNELS').map((row) => ({
      id: String(row.id),
      name: String(row.name),
      active: isActive(row.active),
    }))
  const ruleValue = (key: string): string | null => {
    const matches = store.read('CONFIG_RULES').filter((row) => String(row.key ?? '') === key)
    return matches.length === 1 ? String(matches[0]!.value ?? '') : null
  }
  return {
    findCloserByEmail: (email) => resolveCloserByEmail(staff(), email),
    findCloserByName: (name) => resolveCloserByName(staff(), name),
    isSharedCloserEmail: (email) =>
      Boolean(sharedAccountEmail.trim()) &&
      email.trim().toLowerCase() === sharedAccountEmail.trim().toLowerCase(),
    findEligibleAeByName: (name) => resolveEligibleAeByName(staff(), name),
    findStaffById: (id) => staff().find((item) => item.id === id) ?? null,
    listStaff: staff,
    listEligibleAes: () => staff().filter((item) => item.active && item.canBeAe),
    findDoctor: (id) => doctors().find((doctor) => doctor.id === id) ?? null,
    findService: (id) => services().find((service) => service.id === id) ?? null,
    findChannel: (id) => channels().find((channel) => channel.id === id) ?? null,
    adminLineGroupId: () => adminLineGroupId,
    brandLogoUrl: () => brandLogoUrl,
    callQueueUrl: () => callQueueUrl,
    listDoctors: doctors,
    listServices: services,
    listChannels: channels,
    ruleValue,
  }
}

function bangkokNow(): string {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ssXXX")
}

export function createRuntime(): BookingPorts & StockIngressPorts & ExpenseIngressPorts {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheet = SpreadsheetApp.openById(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
  const callQueueSheet = spreadsheet.getSheetByName('CALL_QUEUE')
  if (!callQueueSheet) throw new Error('missing required sheet: CALL_QUEUE')
  const store = createGoogleSheetStore(spreadsheet)
  const clock = { nowIso: bangkokNow }
  const crypto = createAppsScriptCryptoPort()
  const draftCleanupUrl = properties[SCRIPT_PROPERTY_KEYS.draftCleanupUrl]?.trim() ?? ''
  const stock = createStockRepository(store)
  const expense = createGoogleExpenseRepository({
    masterSpreadsheetId: properties[SCRIPT_PROPERTY_KEYS.financeMasterSpreadsheetId] ?? '',
    financeFolderId: properties[SCRIPT_PROPERTY_KEYS.financeFolderId] ?? '',
  })
  const locks = {
    withLock<T>(operation: () => T): T {
      const lock = LockService.getScriptLock()
      lock.waitLock(30_000)
      try {
        return operation()
      } finally {
        lock.releaseLock()
      }
    },
  }
  return {
    clock,
    locks,
    config: createConfigPort(
      store,
      properties[SCRIPT_PROPERTY_KEYS.adminLineGroupId],
      properties[SCRIPT_PROPERTY_KEYS.brandLogoUrl],
      properties[SCRIPT_PROPERTY_KEYS.sharedAccountEmail] ?? '',
      `${spreadsheet.getUrl()}#gid=${callQueueSheet.getSheetId()}`,
    ),
    repositories: createBookingRepositories(store, locks, clock),
    miniAppRequests: createGoogleMiniAppRequestStatePort(spreadsheet),
    stock,
    commandFingerprint: (command) => crypto.sha256Hex(canonicalMiniAppStockCommand(command)),
    allocateId: (prefix) => `${prefix}-${Utilities.getUuid()}`,
    expense,
    expenseSecrets: {
      expenseIngressSecret: () => {
        const secret = properties[SCRIPT_PROPERTY_KEYS.expenseIngressSecret]?.trim()
        if (!secret) throw new Error('expense runtime is unavailable')
        return secret
      },
    },
    expenseCommandFingerprint: (command) => crypto.sha256Hex(canonicalMiniAppExpenseCommand(command)),
    allocateExpenseId: (monthKey) => `EXP-${monthKey.replace('-', '')}-${Utilities.getUuid()}`,
    drive: createGoogleDrivePort(properties[SCRIPT_PROPERTY_KEYS.driveRootId]),
    calendar: createGoogleCalendarPort(),
    line: createGoogleLinePort(properties[SCRIPT_PROPERTY_KEYS.lineAccessToken]),
    forms: createGoogleFormsPort(
      properties[SCRIPT_PROPERTY_KEYS.bookingFormId],
      properties[SCRIPT_PROPERTY_KEYS.callResultFormId],
      properties[SCRIPT_PROPERTY_KEYS.queueConfirmationFormId] ?? '',
    ),
    files: createGoogleFilePort(properties[SCRIPT_PROPERTY_KEYS.jeraIncomingFolderId]),
    secrets: {
      lineAccessToken: () => properties[SCRIPT_PROPERTY_KEYS.lineAccessToken],
      bookingIngressSecret: () => properties[SCRIPT_PROPERTY_KEYS.bookingIngressSecret],
      lineDirectoryCaptureEnabled: () =>
        properties[SCRIPT_PROPERTY_KEYS.lineDirectoryCaptureEnabled] === 'true',
    },
    crypto,
    media: createEvidenceMediaPort(
      properties[SCRIPT_PROPERTY_KEYS.mediaBaseUrl],
      properties[SCRIPT_PROPERTY_KEYS.mediaSigningSecret],
      crypto,
    ),
    dashboard: createGoogleDashboardPort(spreadsheet),
    backups: createGoogleBackupPort(
      properties[SCRIPT_PROPERTY_KEYS.spreadsheetId],
      properties[SCRIPT_PROPERTY_KEYS.backupFolderId],
    ),
    ...(draftCleanupUrl ? { draftCleanup: createAppsScriptDraftCleanupPort({
      url: draftCleanupUrl,
      secret: properties[SCRIPT_PROPERTY_KEYS.bookingIngressSecret],
      crypto,
      clock,
    }) } : {}),
  }
}

export function runExpenseRecoveryWorkflow(): ExpenseRecoveryResult {
  try {
    const runtime = createRuntime()
    return runExpenseRecovery({
      clock: runtime.clock,
      locks: runtime.locks,
      staff: { findById: (staffId) => runtime.config.findStaffById(staffId) },
      expense: runtime.expense,
      crypto: { sha256Hex: runtime.crypto.sha256Hex },
      commandFingerprint: runtime.expenseCommandFingerprint,
      allocateExpenseId: runtime.allocateExpenseId,
    })
  } catch {
    return {
      inspected: 0,
      recovered: 0,
      abandoned: 0,
      errors: ['EXPENSE_STORAGE_UNAVAILABLE'],
    }
  }
}

export function previewPmcBookingAttributionMigrationWorkflow(): {
  kind: 'NONE' | 'MIGRATE' | 'RESTORE_REQUIRED'
  preflightFingerprint: string | null
  requestRowsMigrated: number
  bookingRowsMigrated: number
  requestInsertions: readonly string[]
  masterInsertions: readonly string[]
  liveWrites: false
} {
  const plan = previewBookingAttributionMigration(createPmcBookingAttributionMigrationRuntime())
  if (plan.kind === 'RESTORE_REQUIRED') {
    return {
      kind: 'RESTORE_REQUIRED', preflightFingerprint: null,
      requestRowsMigrated: 0, bookingRowsMigrated: 0,
      requestInsertions: [], masterInsertions: [], liveWrites: false,
    }
  }
  return {
    kind: plan.kind,
    preflightFingerprint: plan.preflightFingerprint,
    requestRowsMigrated: plan.requestRowsMigrated,
    bookingRowsMigrated: plan.bookingRowsMigrated,
    requestInsertions: plan.kind === 'MIGRATE'
      ? [plan.requestProtocolInsertion, ...plan.requestInsertions]
      : [],
    masterInsertions: plan.kind === 'MIGRATE' ? plan.masterInsertions : [],
    liveWrites: false,
  }
}

export function applyPmcBookingAttributionMigrationWorkflow(): {
  status: 'COMPLETE' | 'RESTORE_REQUIRED'
  readbackVerified: boolean
} {
  return applyBookingAttributionMigration(createPmcBookingAttributionMigrationRuntime())
}

export function previewPmcDraftEvidenceRetentionWorkflow(retentionId: string): DraftRetentionPreview {
  requireEffectiveOwnerEmail()
  return previewDraftEvidenceRetention(retentionId, createRuntime())
}

export function approvePmcDraftEvidenceRetentionWorkflow(
  retentionId: string,
  expectedVersion: number,
  approvalDigest: string,
  reason: string,
): DraftRetentionPreview {
  const owner = requireEffectiveOwnerEmail()
  return approveDraftEvidenceRetention(
    retentionId,
    expectedVersion,
    approvalDigest,
    reason,
    owner,
    createRuntime(),
  )
}

export function executePmcDraftEvidenceRetentionWorkflow(
  retentionId: string,
  expectedVersion: number,
): DraftRetentionPreview {
  const owner = requireEffectiveOwnerEmail()
  return executeDraftEvidenceRetention(retentionId, expectedVersion, owner, createRuntime())
}

export function readbackPmcDraftEvidenceRetentionWorkflow(retentionId: string): DraftRetentionPreview {
  requireEffectiveOwnerEmail()
  return readbackDraftEvidenceRetention(retentionId, createRuntime())
}

function requireEffectiveOwnerEmail(): string {
  const email = Session.getEffectiveUser().getEmail().trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error('RETENTION_OWNER_IDENTITY_REQUIRED')
  }
  return email
}

export interface PmcBookingWorkbookPresentationRuntime extends WorkbookPresentationWorkflowPort {
  assertManualInvocation(): void
  readQueueAttestation(): BookingQueueAttestation
  readMigrationManifest(): BookingMigrationManifest | null
  readOwnerApprovedPreviewDigest(): string | null
  transitionOwnerApproval(expected: string, next: string): void
}

export interface PmcBookingWorkbookPresentationPreview {
  status: 'PREVIEWED'
  actionCount: number
  actionTypes: readonly { type: WorkbookPresentationAction['kind']; count: number }[]
  visibleTabs: readonly string[]
  tabsHiddenByPolicy: readonly string[]
  sourceDigest: string
  planDigest: string
  queueAttestationDigest: string
  migrationManifestDigest: string | null
  reviewDigest: string
  preflightPassed: true
  queuePausedAndEmpty: boolean
  migrationComplete: boolean
  readyForOwnerApproval: boolean
  backupCreated: false
  liveWrites: false
}

export type PmcBookingWorkbookPresentationApply = {
  status: 'APPLIED' | 'NOOP'
  actionCount: number
  backupCreated: boolean
  readbackVerified: true
  sourceDigest: string
  planDigest: string
  reviewDigest: string
  queuePausedAndEmpty: true
  migrationComplete: true
  approvalMatched: true
}

interface OwnerPresentationInspection {
  snapshot: WorkbookMetadataSnapshot
  preview: PmcBookingWorkbookPresentationPreview
}

export function previewPmcBookingWorkbookPresentationWorkflow(
  runtime: PmcBookingWorkbookPresentationRuntime = createPmcBookingWorkbookPresentationRuntime(),
): PmcBookingWorkbookPresentationPreview {
  runtime.assertManualInvocation()
  const queue = runtime.readQueueAttestation()
  const manifest = runtime.readMigrationManifest()
  return inspectOwnerWorkbookPresentation(runtime, queue, manifest).preview
}

export function applyPmcBookingWorkbookPresentationWorkflow(
  runtime: PmcBookingWorkbookPresentationRuntime = createPmcBookingWorkbookPresentationRuntime(),
): PmcBookingWorkbookPresentationApply {
  runtime.assertManualInvocation()
  return runtime.withDocumentLock(() => {
    runtime.assertManualInvocation()
    const queue = runtime.readQueueAttestation()
    if (queue.state !== 'PAUSED' || queue.activeTaskCount !== 0) {
      throw new Error('BOOKING_WORKBOOK_PRESENTATION_QUEUE_NOT_PAUSED')
    }
    const manifest = runtime.readMigrationManifest()
    if (!manifest || manifest.state !== 'COMPLETE') {
      throw new Error('BOOKING_WORKBOOK_PRESENTATION_MIGRATION_NOT_COMPLETE')
    }

    const inspected = inspectOwnerWorkbookPresentation(runtime, queue, manifest)
    const approval = runtime.readOwnerApprovedPreviewDigest()?.trim() ?? ''
    if (approval.startsWith('ATTEMPTED:') || approval.startsWith('APPLIED:')) {
      throw new Error('BOOKING_WORKBOOK_PRESENTATION_APPROVAL_ALREADY_ATTEMPTED')
    }
    if (!isSha256Digest(approval) || approval !== inspected.preview.reviewDigest) {
      throw new Error('BOOKING_WORKBOOK_PRESENTATION_OWNER_APPROVAL_MISMATCH')
    }
    const attemptedApproval = `ATTEMPTED:${approval}`
    runtime.transitionOwnerApproval(approval, attemptedApproval)

    let firstInspection = true
    const applied = applyWorkbookPresentation({
      sha256Hex: runtime.sha256Hex,
      backupLabel: runtime.backupLabel,
      withDocumentLock<T>(operation: () => T): T { return operation() },
      gateway: {
        inspect() {
          if (firstInspection) {
            firstInspection = false
            return inspected.snapshot
          }
          return runtime.gateway.inspect()
        },
        createPrivateNativeBackup: (label) => runtime.gateway.createPrivateNativeBackup(label),
        apply: (plan) => runtime.gateway.apply(plan),
      },
    })
    runtime.transitionOwnerApproval(
      attemptedApproval,
      `APPLIED:${inspected.preview.reviewDigest}`,
    )
    return {
      status: applied.status,
      actionCount: applied.plannedActionCount,
      backupCreated: applied.backupCreated,
      readbackVerified: applied.readbackVerified,
      sourceDigest: inspected.preview.sourceDigest,
      planDigest: inspected.preview.planDigest,
      reviewDigest: inspected.preview.reviewDigest,
      queuePausedAndEmpty: true,
      migrationComplete: true,
      approvalMatched: true,
    }
  })
}

export function createPmcBookingWorkbookPresentationRuntime(): PmcBookingWorkbookPresentationRuntime {
  const scriptProperties = PropertiesService.getScriptProperties()
  const spreadsheetId = scriptProperties.getProperty(SCRIPT_PROPERTY_KEYS.spreadsheetId)?.trim() ?? ''
  const backupFolderId = scriptProperties.getProperty(SCRIPT_PROPERTY_KEYS.backupFolderId)?.trim() ?? ''
  if (!spreadsheetId || !backupFolderId) {
    throw new Error('WORKBOOK_PRESENTATION_CONFIG_INVALID')
  }
  const presentationCrypto = createAppsScriptCryptoPort()
  const gateway = createGoogleWorkbookPresentationGateway({
    spreadsheetId,
    backupFolderId,
    sha256Hex: presentationCrypto.sha256Hex,
  })
  return {
    gateway,
    sha256Hex: presentationCrypto.sha256Hex,
    backupLabel: `PMC Booking Pre-Presentation ${new Date().toISOString()}`,
    assertManualInvocation: assertPmcBookingWorkbookPresentationManualInvocation,
    withDocumentLock<T>(operation: () => T): T {
      return gateway.withDocumentLock(operation)
    },
    readQueueAttestation() {
      const expectedQueueDigest = scriptProperties
        .getProperty(ATTRIBUTION_MIGRATION_EXPECTED_QUEUE_DIGEST)?.trim() ?? ''
      if (!isSha256Digest(expectedQueueDigest)) {
        throw new Error('BOOKING_QUEUE_EXPECTED_IDENTITY_INVALID')
      }
      const raw = scriptProperties.getProperty(ATTRIBUTION_MIGRATION_QUEUE_ATTESTATION)
      if (raw === null) throw new Error('QUEUE_ATTESTATION_INVALID')
      return parseBookingQueueAttestationJson(raw, {
        nowMs: Date.now(),
        maxAgeMs: ATTRIBUTION_MIGRATION_GATE_MAX_AGE_MS,
        environment: ATTRIBUTION_MIGRATION_ENVIRONMENT,
        queueResourceDigest: expectedQueueDigest,
        checkerVersion: ATTRIBUTION_MIGRATION_CHECKER_VERSION,
        sha256: presentationCrypto.sha256Hex,
      })
    },
    readMigrationManifest() {
      const raw = scriptProperties.getProperty(ATTRIBUTION_MIGRATION_MANIFEST)
      return raw === null || raw.trim() === ''
        ? null
        : parseBookingMigrationManifestJson(raw, presentationCrypto.sha256Hex)
    },
    readOwnerApprovedPreviewDigest() {
      return scriptProperties.getProperty(WORKBOOK_PRESENTATION_OWNER_APPROVAL)
    },
    transitionOwnerApproval(expected, next) {
      if (!isValidWorkbookPresentationApprovalValue(expected)
        || !isValidWorkbookPresentationApprovalValue(next)) {
        throw new Error('BOOKING_WORKBOOK_PRESENTATION_APPROVAL_STATE_WRITE_FAILED')
      }
      let current: string
      try {
        current = scriptProperties.getProperty(WORKBOOK_PRESENTATION_OWNER_APPROVAL)?.trim() ?? ''
      } catch {
        throw new Error('BOOKING_WORKBOOK_PRESENTATION_APPROVAL_STATE_WRITE_FAILED')
      }
      if (current !== expected) {
        throw new Error('BOOKING_WORKBOOK_PRESENTATION_APPROVAL_STATE_WRITE_FAILED')
      }
      try {
        scriptProperties.setProperty(WORKBOOK_PRESENTATION_OWNER_APPROVAL, next)
        const persisted = scriptProperties
          .getProperty(WORKBOOK_PRESENTATION_OWNER_APPROVAL)?.trim() ?? ''
        if (persisted !== next) throw new Error('approval readback mismatch')
      } catch {
        if (expected.startsWith('ATTEMPTED:') && next.startsWith('APPLIED:')) {
          try {
            scriptProperties.setProperty(WORKBOOK_PRESENTATION_OWNER_APPROVAL, expected)
            const recovered = scriptProperties
              .getProperty(WORKBOOK_PRESENTATION_OWNER_APPROVAL)?.trim() ?? ''
            if (recovered !== expected) throw new Error('approval recovery mismatch')
          } catch {
            // Both ATTEMPTED and APPLIED are fail-closed used states. The fixed
            // error below remains authoritative when recovery cannot be proved.
          }
        }
        throw new Error('BOOKING_WORKBOOK_PRESENTATION_APPROVAL_STATE_WRITE_FAILED')
      }
    },
  }
}

export function assertPmcBookingWorkbookPresentationManualInvocation(): void {
  let handlers: string[]
  try {
    handlers = ScriptApp.getProjectTriggers().map((trigger) => trigger.getHandlerFunction())
  } catch {
    throw new Error('BOOKING_WORKBOOK_PRESENTATION_TRIGGER_FORBIDDEN')
  }
  if (handlers.some((handler) => WORKBOOK_PRESENTATION_MANUAL_HANDLERS.includes(
    handler as typeof WORKBOOK_PRESENTATION_MANUAL_HANDLERS[number],
  ))) {
    throw new Error('BOOKING_WORKBOOK_PRESENTATION_TRIGGER_FORBIDDEN')
  }
}

function inspectOwnerWorkbookPresentation(
  runtime: PmcBookingWorkbookPresentationRuntime,
  queue: BookingQueueAttestation,
  manifest: BookingMigrationManifest | null,
): OwnerPresentationInspection {
  const snapshot = runtime.gateway.inspect()
  const plan = buildWorkbookPresentationPlan(snapshot, runtime.sha256Hex)
  const sourceDigest = safePresentationDigest(runtime, `source:${plan.sourceFingerprint}`)
  const planDigest = safePresentationDigest(runtime, JSON.stringify(plan))
  const migrationManifestDigest = manifest?.digest ?? null
  const reviewDigest = safePresentationDigest(runtime, JSON.stringify({
    version: 1,
    sourceDigest,
    planDigest,
    queueAttestationDigest: queue.digest,
    migrationManifestDigest,
  }))
  const visible = new Set(plan.visibleOrder)
  const actionTypes = WORKBOOK_PRESENTATION_ACTION_ORDER
    .map((type) => ({
      type,
      count: plan.actions.filter((action) => action.kind === type).length,
    }))
    .filter(({ count }) => count > 0)
  const queuePausedAndEmpty = queue.state === 'PAUSED' && queue.activeTaskCount === 0
  const migrationComplete = manifest?.state === 'COMPLETE'
  return {
    snapshot,
    preview: {
      status: 'PREVIEWED',
      actionCount: plan.actions.length,
      actionTypes,
      visibleTabs: [...plan.visibleOrder],
      tabsHiddenByPolicy: snapshot.sheets
        .filter((sheet) => !visible.has(sheet.title))
        .sort((left, right) => left.index - right.index)
        .map((sheet) => sheet.title),
      sourceDigest,
      planDigest,
      queueAttestationDigest: queue.digest,
      migrationManifestDigest,
      reviewDigest,
      preflightPassed: true,
      queuePausedAndEmpty,
      migrationComplete,
      readyForOwnerApproval: queuePausedAndEmpty && migrationComplete,
      backupCreated: false,
      liveWrites: false,
    },
  }
}

function safePresentationDigest(
  runtime: PmcBookingWorkbookPresentationRuntime,
  value: string,
): string {
  const digest = runtime.sha256Hex(value)
  if (!isSha256Digest(digest)) throw new Error('BOOKING_WORKBOOK_PRESENTATION_DIGEST_INVALID')
  return digest
}

function isSha256Digest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value)
}

function isValidWorkbookPresentationApprovalValue(value: string): boolean {
  return isSha256Digest(value)
    || /^(?:ATTEMPTED|APPLIED):[a-f0-9]{64}$/.test(value)
}

export function createPmcBookingAttributionMigrationRuntime(): BookingAttributionMigrationPorts {
  const scriptProperties = PropertiesService.getScriptProperties()
  const properties = scriptProperties.getProperties()
  const spreadsheetId = properties[SCRIPT_PROPERTY_KEYS.spreadsheetId]?.trim()
  const backupFolderId = properties[SCRIPT_PROPERTY_KEYS.backupFolderId]?.trim()
  if (!spreadsheetId) throw new Error('PMC_SPREADSHEET_ID is not configured')
  if (!backupFolderId) throw new Error('PMC_BACKUP_FOLDER_ID is not configured')
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  const migrationCrypto = createAppsScriptCryptoPort()
  const expectedQueueDigest = properties[ATTRIBUTION_MIGRATION_EXPECTED_QUEUE_DIGEST]?.trim() ?? ''
  if (!/^[a-f0-9]{64}$/.test(expectedQueueDigest)) {
    throw new Error('BOOKING_QUEUE_EXPECTED_IDENTITY_INVALID')
  }

  const readAdvancedMetadata = (targetSpreadsheetId: string): {
    MINI_APP_REQUESTS: unknown
    BOOKING_MASTER: unknown
  } => {
    let response: GoogleAppsScript.Sheets.Schema.Spreadsheet
    try {
      const sheetsService = Sheets
      if (!sheetsService) throw new Error('unavailable')
      response = sheetsService.Spreadsheets.get(targetSpreadsheetId, {
        includeGridData: true,
        ranges: ['MINI_APP_REQUESTS', 'BOOKING_MASTER'],
        fields: [
          'sheets(properties(sheetId,title,sheetType,gridProperties),data(startRow,startColumn,',
          'rowData(values(userEnteredValue,userEnteredFormat,dataValidation,note,textFormatRuns,pivotTable,',
          'dataSourceTable,dataSourceFormula)),',
          'rowMetadata,columnMetadata),merges,basicFilter,filterViews,bandedRanges,',
          'conditionalFormats,rowGroups,columnGroups,charts,tables,protectedRanges,developerMetadata,slicers)',
        ].join(''),
      })
    } catch {
      throw new Error('SHEETS_V4_METADATA_UNAVAILABLE')
    }
    const byTitle = new Map((response.sheets ?? []).map((sheet) => [sheet.properties?.title ?? '', sheet]))
    const request = byTitle.get('MINI_APP_REQUESTS')
    const master = byTitle.get('BOOKING_MASTER')
    if (!request || !master) throw new Error('SHEETS_V4_METADATA_UNAVAILABLE')
    return { MINI_APP_REQUESTS: request, BOOKING_MASTER: master }
  }

  const readSnapshot = (
    workbook: GoogleAppsScript.Spreadsheet.Spreadsheet,
  ): AttributionMigrationSheetSnapshot => {
    const snapshot: AttributionMigrationSheetSnapshot = {
      ...readGoogleBookingAttributionMigrationSnapshot(
        workbook,
        migrationCrypto.sha256Hex,
        readAdvancedMetadata(workbook.getId()),
      ),
      queueState: 'RUNNING',
      activeTaskCount: -1,
      requestRowLimit: ATTRIBUTION_REQUEST_ROW_LIMIT,
      masterRowLimit: ATTRIBUTION_MASTER_ROW_LIMIT,
      hashValue: migrationCrypto.sha256Hex,
    }
    return {
      ...snapshot,
      preflightFingerprint: migrationCrypto.sha256Hex(
        canonicalAttributionMigrationSnapshot(snapshot),
      ),
    }
  }

  const readManifest = () => {
    const raw = scriptProperties.getProperty(ATTRIBUTION_MIGRATION_MANIFEST)
    return raw === null || raw.trim() === ''
      ? null
      : parseBookingMigrationManifestJson(raw, migrationCrypto.sha256Hex)
  }

  return {
    queueGate: {
      readAttestation() {
        const raw = scriptProperties.getProperty(ATTRIBUTION_MIGRATION_QUEUE_ATTESTATION)
        if (raw === null) throw new Error('QUEUE_ATTESTATION_INVALID')
        return parseBookingQueueAttestationJson(raw, {
          nowMs: Date.now(),
          maxAgeMs: ATTRIBUTION_MIGRATION_GATE_MAX_AGE_MS,
          environment: ATTRIBUTION_MIGRATION_ENVIRONMENT,
          queueResourceDigest: expectedQueueDigest,
          checkerVersion: ATTRIBUTION_MIGRATION_CHECKER_VERSION,
          sha256: migrationCrypto.sha256Hex,
        })
      },
    },
    manifest: {
      read: readManifest,
      createPrepared(payload) {
        if (payload.state !== 'PREPARED' || readManifest() !== null) {
          throw new Error('MIGRATION_MANIFEST_CONFLICT')
        }
        const envelope = createBookingMigrationManifestEnvelope(payload, migrationCrypto.sha256Hex)
        scriptProperties.setProperty(ATTRIBUTION_MIGRATION_MANIFEST, JSON.stringify(envelope))
        const persisted = readManifest()
        if (!persisted || persisted.digest !== envelope.digest) {
          throw new Error('MIGRATION_MANIFEST_WRITE_FAILED')
        }
        return persisted
      },
      replaceExpected(expectedDigest, payload) {
        const current = readManifest()
        if (!current || current.digest !== expectedDigest) throw new Error('MIGRATION_MANIFEST_CONFLICT')
        validateBookingMigrationManifestTransition(current, payload)
        const envelope = createBookingMigrationManifestEnvelope(payload, migrationCrypto.sha256Hex)
        scriptProperties.setProperty(ATTRIBUTION_MIGRATION_MANIFEST, JSON.stringify(envelope))
        const persisted = readManifest()
        if (!persisted || persisted.digest !== envelope.digest) {
          throw new Error('MIGRATION_MANIFEST_WRITE_FAILED')
        }
        return persisted
      },
    },
    readSnapshot: () => readSnapshot(spreadsheet),
    withLock<T>(operation: () => T): T {
      const lock = LockService.getScriptLock()
      lock.waitLock(30_000)
      try { return operation() } finally { lock.releaseLock() }
    },
    createAndVerifyPrivateNativeBackup(preflightFingerprint) {
      const approval = scriptProperties.getProperty(ATTRIBUTION_MIGRATION_APPROVAL)?.trim()
      if (!approval || approval !== preflightFingerprint) {
        throw new Error('ATTRIBUTION_MIGRATION_OWNER_APPROVAL_MISMATCH')
      }
      try {
        const timestamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd_HH-mm-ss')
        const backupFolder = DriveApp.getFolderById(backupFolderId)
        if (backupFolder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
          throw new Error('not private')
        }
        const backup = DriveApp.getFileById(spreadsheetId).makeCopy(
          `PMC Booking Pre-Attribution-V2 ${timestamp}`,
          backupFolder,
        )
        if (backup.getMimeType() !== 'application/vnd.google-apps.spreadsheet'
          || backup.getSharingAccess() !== DriveApp.Access.PRIVATE) {
          throw new Error('invalid backup')
        }
        const parents = backup.getParents()
        if (!parents.hasNext() || parents.next().getId() !== backupFolderId || parents.hasNext()) {
          throw new Error('invalid parent')
        }
        const backupSnapshot = readSnapshot(SpreadsheetApp.openById(backup.getId()))
        if (migrationSnapshotFingerprint(backupSnapshot) !== preflightFingerprint) {
          throw new Error('fingerprint mismatch')
        }
        return {
          fileId: backup.getId(),
          mimeType: 'application/vnd.google-apps.spreadsheet' as const,
          parentId: backupFolderId,
          sourceFingerprint: preflightFingerprint,
        }
      } catch {
        throw new Error('MIGRATION_BACKUP_FAILED')
      }
    },
    writeMigration(plan) {
      writeGoogleBookingAttributionMigration(spreadsheet, plan)
    },
    nowIso: () => new Date().toISOString(),
    sha256: migrationCrypto.sha256Hex,
  }
}

export interface DailyOperationsResult {
  stages: Record<
    'retries' | 'doctorSchedules' | 'callReminders' | 'depositExpiry' | 'dashboard',
    'OK' | 'FAILED'
  >
}

function runDailyStage(
  name: keyof DailyOperationsResult['stages'],
  operation: () => void,
): 'OK' | 'FAILED' {
  try {
    operation()
    return 'OK'
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'failed'
    const safeDetail = detail
      .replace(/https?:\/\/\S+/g, '[url]')
      .replace(/PMC-\d{6}-\d{4}/g, '[case]')
      .replace(/0\d{8,9}/g, '[phone]')
      .slice(0, 300)
    console.error(`${name}: ${safeDetail}`)
    return 'FAILED'
  }
}

export function runDailyOperationsWorkflow(ports: BookingPorts): DailyOperationsResult {
  return {
    stages: {
      retries: runDailyStage('retries', () => runEligibleRetries(ports)),
      doctorSchedules: runDailyStage('doctorSchedules', () => runDailyDoctorSchedules(ports)),
      callReminders: runDailyStage('callReminders', () => runDailyCallReminders(ports)),
      depositExpiry: runDailyStage('depositExpiry', () => runDepositExpiryReminders(ports)),
      dashboard: runDailyStage('dashboard', () => writeDashboard(ports)),
    },
  }
}

export function runBookingRetriesWorkflow(): {
  pendingBefore: number
  pendingAfter: number
} {
  const runtime = createRuntime()
  const pendingBefore = runtime.repositories.retries.listPending().length
  runEligibleRetries(runtime)
  return {
    pendingBefore,
    pendingAfter: runtime.repositories.retries.listPending().length,
  }
}

function retryPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function runEligibleRetries(ports: BookingPorts): void {
  for (const retry of ports.repositories.retries.listPending()) {
    const id = String(retry.id)
    const caseId = String(retry.caseId)
    const booking = ports.repositories.bookings.getByCaseId(caseId)
    if (!booking) {
      ports.repositories.retries.fail(id, 'booking not found')
      continue
    }
    try {
      const operation = String(retry.operation)
      if (operation === 'BOOKING_LINE') {
        const payload = retryPayload(retry.payload)
        const paymentEvidenceFileIds = (payload.paymentEvidenceFileIds as string[]) ?? []
        const chatEvidenceFileIds = (payload.chatEvidenceFileIds as string[]) ?? []
        const messageVersion = Number(payload.messageVersion) || booking.version
        const evidence = ports.media.images(
          booking.caseId,
          paymentEvidenceFileIds,
          chatEvidenceFileIds,
        )
        sendBookingConfirmationMessages(
          booking,
          ports.line,
          ports.config.adminLineGroupId(),
          evidence,
          ports.config.brandLogoUrl(),
          messageVersion,
          bookingTeamProfiles(booking, ports.config),
        )
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { lineState: 'OK', doctorLineNotifiedAt: ports.clock.nowIso() },
          { actor: 'system', reason: 'LINE retry succeeded', correlationId: id },
        )
      } else if (operation === 'ADMIN_BOOKING_LINE_BATCH') {
        const payload = retryPayload(retry.payload)
        const paymentEvidenceFileIds = (payload.paymentEvidenceFileIds as string[]) ?? []
        const chatEvidenceFileIds = (payload.chatEvidenceFileIds as string[]) ?? []
        const messageVersion = Number(payload.messageVersion) || booking.version
        const batchIndex = Number(payload.batchIndex)
        if (!Number.isInteger(batchIndex) || batchIndex < 0) {
          throw new Error('invalid Admin LINE batch index')
        }
        const evidence = ports.media.images(
          booking.caseId,
          paymentEvidenceFileIds,
          chatEvidenceFileIds,
        )
        const batches = adminBookingMessageBatches(
          booking,
          ports.config.adminLineGroupId(),
          evidence,
          ports.config.brandLogoUrl(),
          messageVersion,
          bookingTeamProfiles(booking, ports.config),
        )
        const message = batches[batchIndex]
        if (!message) throw new Error('Admin LINE batch index out of range')
        ports.line.push(message)
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { lineState: 'OK' },
          { actor: 'system', reason: 'Admin LINE batch retry succeeded', correlationId: id },
        )
      } else if (operation === 'ADMIN_AUTOMATIC_LINE_BATCH') {
        const payload = retryPayload(retry.payload)
        const paymentEvidenceFileIds = (payload.paymentEvidenceFileIds as string[]) ?? []
        const chatEvidenceFileIds = (payload.chatEvidenceFileIds as string[]) ?? []
        const messageVersion = Number(payload.messageVersion) || booking.version
        const batchIndex = Number(payload.batchIndex)
        if (!Number.isInteger(batchIndex) || batchIndex < 0) {
          throw new Error('invalid automatic Admin LINE batch index')
        }
        const evidence = ports.media.images(
          booking.caseId,
          paymentEvidenceFileIds,
          chatEvidenceFileIds,
        )
        const profiles = bookingTeamProfiles(booking, ports.config)
        const changeUrl = ports.forms.queueConfirmationUrl({
          caseId: booking.caseId,
          action: 'CHANGE',
          ...(booking.appointmentStart
            ? {
                appointmentDate: booking.appointmentStart.slice(0, 10),
                appointmentTime: booking.appointmentStart.slice(11, 16),
              }
            : {}),
        })
        const batches = booking.appointmentStatus === 'TENTATIVE' && booking.appointmentStart
          ? adminTentativeMessageBatches(
              booking,
              ports.config.adminLineGroupId(),
              evidence,
              ports.forms.queueConfirmationUrl({
                caseId: booking.caseId,
                action: 'CONFIRM',
                appointmentDate: booking.appointmentStart.slice(0, 10),
                appointmentTime: booking.appointmentStart.slice(11, 16),
              }),
              changeUrl,
              ports.config.brandLogoUrl(),
              messageVersion,
              profiles,
            )
          : adminAwaitingSlotMessageBatches(
              booking,
              ports.config.adminLineGroupId(),
              evidence,
              changeUrl,
              ports.config.brandLogoUrl(),
              messageVersion,
              profiles,
            )
        const message = batches[batchIndex]
        if (!message) throw new Error('automatic Admin LINE batch index out of range')
        ports.line.push(message)
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { lineState: 'OK' },
          { actor: 'system', reason: 'Automatic Admin LINE retry succeeded', correlationId: id },
        )
      } else if (operation === 'ADMIN_TIME_CONFLICT_LINE') {
        const payload = retryPayload(retry.payload)
        const messageVersion = Number(payload.messageVersion) || booking.version
        ports.line.push(
          adminTimeConflictMessage(
            booking,
            ports.config.adminLineGroupId(),
            ports.config.brandLogoUrl(),
            messageVersion,
            bookingTeamProfiles(booking, ports.config),
          ),
        )
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { lineState: 'OK' },
          { actor: 'system', reason: 'Admin time-conflict LINE retry succeeded', correlationId: id },
        )
      } else if (operation === 'ADMIN_EVIDENCE_LINE') {
        const payload = retryPayload(retry.payload)
        const paymentEvidenceFileIds = (payload.paymentEvidenceFileIds as string[]) ?? []
        const chatEvidenceFileIds = (payload.chatEvidenceFileIds as string[]) ?? []
        const messageVersion = Number(payload.messageVersion) || booking.version
        const evidence = ports.media.images(
          booking.caseId,
          paymentEvidenceFileIds,
          chatEvidenceFileIds,
        )
        const messages = adminEvidenceMessageBatches(
          booking,
          ports.config.adminLineGroupId(),
          evidence,
          messageVersion,
        )
        for (const message of messages) ports.line.push(message)
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { lineState: 'OK' },
          { actor: 'system', reason: 'Admin evidence LINE retry succeeded', correlationId: id },
        )
      } else if (operation === 'DOCTOR_LINE' || operation === 'DOCTOR_LINE_RESCHEDULE') {
        sendDoctorBookingMessage(
          booking,
          ports.line,
          ports.config.brandLogoUrl(),
          operation === 'DOCTOR_LINE_RESCHEDULE' ? 'RESCHEDULED' : 'BOOKING_CONFIRMED',
          bookingTeamProfiles(booking, ports.config),
        )
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { lineState: 'OK', doctorLineNotifiedAt: ports.clock.nowIso() },
          { actor: 'system', reason: 'LINE retry succeeded', correlationId: id },
        )
      } else if (operation === 'DOCTOR_LINE_CONFIRMATION') {
        const payload = retryPayload(retry.payload)
        const messageVersion = Number(payload.messageVersion) || booking.version
        ports.line.push(doctorBookingMessage(
          booking,
          'BOOKING_CONFIRMED',
          ports.config.brandLogoUrl(),
          messageVersion,
          bookingTeamProfiles(booking, ports.config),
        ))
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { lineState: 'OK', doctorLineNotifiedAt: ports.clock.nowIso() },
          { actor: 'system', reason: 'Doctor confirmation LINE retry succeeded', correlationId: id },
        )
      } else if (operation === 'CALENDAR_EVENT') {
        const calendarEventId = ensureDoctorCalendarEvent(booking, ports.calendar)
        const confirmed = ports.repositories.bookings.update(
          caseId,
          booking.version,
          { calendarEventId, calendarState: 'OK', status: 'BOOKING_CONFIRMED' },
          { actor: 'system', reason: 'Calendar retry succeeded', correlationId: id },
        )
        createInitialCallTask(confirmed, ports)
        const payload = retryPayload(retry.payload)
        const paymentEvidenceFileIds = (payload.paymentEvidenceFileIds as string[]) ?? []
        const chatEvidenceFileIds = (payload.chatEvidenceFileIds as string[]) ?? []
        let mediaSafeError: string | null = null
        let evidence
        try {
          evidence = ports.media.images(
            confirmed.caseId,
            paymentEvidenceFileIds,
            chatEvidenceFileIds,
          )
        } catch (error) {
          mediaSafeError = error instanceof Error ? error.message : 'Evidence media signing failed'
          evidence = {
            payments: [],
            chats: [],
            totalPaymentCount: paymentEvidenceFileIds.length,
            totalChatCount: chatEvidenceFileIds.length,
          }
        }
        sendBookingConfirmationMessages(
          confirmed,
          ports.line,
          ports.config.adminLineGroupId(),
          evidence,
          ports.config.brandLogoUrl(),
          confirmed.version,
          bookingTeamProfiles(confirmed, ports.config),
        )
        if (mediaSafeError) {
          ports.repositories.retries.enqueue({
            id: `RETRY-${caseId}-ADMIN-EVIDENCE`,
            caseId,
            operation: 'ADMIN_EVIDENCE_LINE',
            idempotencyKey: `${caseId}:ADMIN_EVIDENCE_READY:${confirmed.version}`,
            attempts: 0,
            status: 'PENDING',
            safeError: mediaSafeError,
            payload: {
              paymentEvidenceFileIds,
              chatEvidenceFileIds,
              messageVersion: confirmed.version,
            },
          })
        }
        ports.repositories.bookings.update(
          caseId,
          confirmed.version,
          {
            lineState: mediaSafeError ? 'RETRY' : 'OK',
            doctorLineNotifiedAt: ports.clock.nowIso(),
          },
          {
            actor: 'system',
            reason: mediaSafeError
              ? mediaSafeError
              : 'Calendar retry completed Admin and doctor LINE notifications',
            correlationId: id,
          },
        )
      } else if (operation === 'TENTATIVE_CALENDAR_EVENT') {
        if (booking.appointmentStatus !== 'TENTATIVE') {
          throw new Error('booking is not tentative')
        }
        const calendarEventId = booking.calendarEventId ??
          ports.calendar.createEvent(calendarEventInput(booking))
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { calendarEventId, calendarState: 'OK' },
          { actor: 'system', reason: 'Tentative Calendar retry succeeded', correlationId: id },
        )
      } else if (operation === 'DRIVE_EVIDENCE') {
        const payload = retryPayload(retry.payload)
        const intake: BookingIntake = {
          queueType: booking.queueType,
          formResponseId: booking.formResponseId,
          submittedAt: booking.depositReceivedAt,
          submitterEmail: booking.submitterEmail,
          closerName: booking.adminName,
          aeName: booking.aeName ?? booking.adminName,
          customerName: booking.customerName,
          facebookName: booking.facebookName,
          phone: booking.phoneNormalized,
          doctorId: booking.doctorId,
          serviceId: booking.serviceId,
          channelId: booking.channelId,
          appointmentDate: booking.appointmentStart?.slice(0, 10) ?? null,
          appointmentTime: booking.appointmentStart?.slice(11, 16) ?? null,
          depositAmount: booking.depositAmount,
          paymentEvidenceFileIds: (payload.paymentEvidenceFileIds as string[]) ?? [],
          chatEvidenceFileIds: (payload.chatEvidenceFileIds as string[]) ?? [],
        }
        const evidence = ensureCaseEvidenceFolder(booking, intake, ports.drive)
        const recovered = ports.repositories.bookings.update(
          caseId,
          booking.version,
          { driveFolderId: evidence.folderId, driveFolderUrl: evidence.folderUrl, driveState: 'OK' },
          { actor: 'system', reason: 'Drive retry succeeded', correlationId: id },
        )
        if (recovered.queueType === 'AUTO') {
          prepareAutomaticQueue(recovered, intake, ports)
        }
      } else {
        throw new Error(`unsupported retry operation: ${operation}`)
      }
      ports.repositories.retries.complete(id)
    } catch (error) {
      ports.repositories.retries.fail(id, error instanceof Error ? error.message : 'retry failed')
    }
  }
}

export function runIntegrityAndBackupWorkflow(ports: BookingPorts): string[] {
  const report = runIntegrityReport(ports)
  createDailyBackup(ports)
  reconcileAndExpireDraftEvidenceRetention(ports)
  queueEvidenceRetention(ports)
  writeDashboard(ports)
  return report.codes
}

export function isConfigurationReady(counts: {
  staff: number
  aes: number
  doctors: number
  services: number
}): boolean {
  return counts.staff > 0 && counts.aes > 0 && counts.doctors > 0 && counts.services > 0
}

function ensureFormTrigger(handler: BookingFormTriggerHandler, formId: string): boolean {
  if (ScriptApp.getProjectTriggers().some((trigger) => trigger.getHandlerFunction() === handler)) return false
  ScriptApp.newTrigger(handler).forForm(FormApp.openById(formId)).onFormSubmit().create()
  return true
}

function ensureClockTrigger(
  handler: BookingClockTriggerHandler,
  create: (builder: GoogleAppsScript.Script.ClockTriggerBuilder) => void,
): boolean {
  if (ScriptApp.getProjectTriggers().some((trigger) => trigger.getHandlerFunction() === handler)) return false
  create(ScriptApp.newTrigger(handler).timeBased())
  return true
}

export function setupSystem(): {
  createdTriggers: number
  syncedStaff: number
  syncedAes: number
  syncedDoctors: number
  syncedServices: number
  syncedChannels: number
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheet = SpreadsheetApp.openById(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
  migrateBookingMasterStaffColumns(spreadsheet)
  migrateConfigStaffColumns(spreadsheet)
  ensureSheetTopology(spreadsheet)
  const runtime = createRuntime()
  const staff = runtime.config.listStaff().filter((item) => item.active)
  const formAttributionChoices = bookingAttributionFormChoices(staff)
  validateStaffDirectory(staff)
  if (!runtime.forms.bookingCollectsEmail()) throw new Error('booking Form must collect email')
  const doctors = runtime.config.listDoctors().filter((doctor) => doctor.active)
  const services = runtime.config.listServices().filter((service) => service.active)
  const channels = runtime.config.listChannels().filter((channel) => channel.active)
  if (!isConfigurationReady({
    staff: staff.length,
    aes: formAttributionChoices.aes.length,
    doctors: doctors.length,
    services: services.length,
  })) {
    return {
      createdTriggers: 0,
      syncedStaff: staff.length,
      syncedAes: formAttributionChoices.aes.length,
      syncedDoctors: doctors.length,
      syncedServices: services.length,
      syncedChannels: channels.length,
    }
  }
  runtime.forms.ensureCloserField()
  runtime.forms.ensureFacebookNameField()
  runtime.forms.syncBookingChoices(
    formAttributionChoices.admins,
    formAttributionChoices.aes,
    doctors.map((doctor) => doctor.id),
    services.map((service) => service.id),
    channels.map((channel) => channel.id),
  )
  const callResults: CallResult[] = [
    'REBOOKED',
    'NO_ANSWER',
    'CALL_BACK_REQUESTED',
    'NOT_READY',
    'DECLINED',
    'WRONG_NUMBER',
  ]
  runtime.forms.syncCallResultChoices(callResults)
  const created = [
    ensureFormTrigger(
      BOOKING_INSTALLABLE_TRIGGER_REGISTRY.bookingForm.handler,
      properties[SCRIPT_PROPERTY_KEYS.bookingFormId],
    ),
    ensureFormTrigger(
      BOOKING_INSTALLABLE_TRIGGER_REGISTRY.callResultForm.handler,
      properties[SCRIPT_PROPERTY_KEYS.callResultFormId],
    ),
    ensureClockTrigger(
      BOOKING_INSTALLABLE_TRIGGER_REGISTRY.dailyOperations.handler,
      (builder) => builder.everyDays(1).atHour(9).create(),
    ),
    ensureClockTrigger(
      BOOKING_INSTALLABLE_TRIGGER_REGISTRY.integrityChecks.handler,
      (builder) => builder.everyDays(1).atHour(2).create(),
    ),
  ].filter(Boolean).length
  return {
    createdTriggers: created,
    syncedStaff: staff.length,
    syncedAes: formAttributionChoices.aes.length,
    syncedDoctors: doctors.length,
    syncedServices: services.length,
    syncedChannels: channels.length,
  }
}

export function migrateFinancePermissionColumnsWorkflow(): {
  changed: boolean
  columnCount: 12
} {
  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperties()[SCRIPT_PROPERTY_KEYS.spreadsheetId]
    ?.trim()
  if (!spreadsheetId) throw new Error('PMC_SPREADSHEET_ID is not configured')
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  const changed = migrateConfigStaffColumns(spreadsheet)
  const sheet = spreadsheet.getSheetByName('CONFIG_STAFF')
  if (!sheet || sheet.getLastColumn() !== STAFF_CONFIG_COLUMNS.length) {
    throw new Error('sheet header mismatch: CONFIG_STAFF')
  }
  const headers = sheet
    .getRange(1, 1, 1, STAFF_CONFIG_COLUMNS.length)
    .getValues()[0]
    .map(String)
  if (JSON.stringify(headers) !== JSON.stringify(STAFF_CONFIG_COLUMNS)) {
    throw new Error('sheet header mismatch: CONFIG_STAFF')
  }
  return { changed, columnCount: STAFF_CONFIG_COLUMNS.length }
}

function requireCanonicalStaffSheet(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = spreadsheet.getSheetByName('CONFIG_STAFF')
  if (!sheet || sheet.getLastColumn() !== STAFF_CONFIG_COLUMNS.length) {
    throw new Error('sheet header mismatch: CONFIG_STAFF')
  }
  const headers = sheet
    .getRange(1, 1, 1, STAFF_CONFIG_COLUMNS.length)
    .getValues()[0]
    .map(String)
  if (JSON.stringify(headers) !== JSON.stringify(STAFF_CONFIG_COLUMNS)) {
    throw new Error('sheet header mismatch: CONFIG_STAFF')
  }
  return sheet
}

function requiredExpenseSetupValue(value: string | undefined): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error('expense finance setup is not configured')
  return normalized
}

function configuredExpenseStaffIds(value: string | undefined): string[] {
  return requiredExpenseSetupValue(value).split(',').map((id) => id.trim())
}

const SAFE_EXPENSE_DOMAIN_MESSAGES = new Set([
  'unsupported CONFIG_STAFF header',
  'CONFIG_STAFF migration did not converge',
  'sheet header mismatch: CONFIG_STAFF',
  'sheet header mismatch: EXPENSE_MONTHLY_INDEX',
  'sheet header mismatch: EXPENSE_REQUESTS',
  'sheet header mismatch: EXPENSE_AUDIT',
  'invalid expense permission configuration',
  'expense permission cutover is not approved',
  'expense permission setup is not configured',
  'expense finance setup is not configured',
  'expense permission readback mismatch',
  'finance master is outside the configured private folder',
])

function throwSafeExpenseOperatorError(error: unknown, unavailableCode: string): never {
  const message = error instanceof Error ? error.message : ''
  if (SAFE_EXPENSE_DOMAIN_MESSAGES.has(message)) throw new Error(message)
  throw new Error(unavailableCode)
}

function runSafeExpenseOperatorWorkflow<T>(
  unavailableCode: string,
  operation: () => T,
): T {
  try {
    return operation()
  } catch (error) {
    return throwSafeExpenseOperatorError(error, unavailableCode)
  }
}

export function prepareExpensePermissionsWorkflow(): ExpensePermissionRosterItem[] {
  return runSafeExpenseOperatorWorkflow('EXPENSE_PERMISSION_PREPARE_UNAVAILABLE', () => {
    const spreadsheetId = PropertiesService.getScriptProperties()
      .getProperties()[SCRIPT_PROPERTY_KEYS.spreadsheetId]
      ?.trim()
    if (!spreadsheetId) throw new Error('expense permission setup is not configured')
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
    migrateConfigStaffColumns(spreadsheet)
    requireCanonicalStaffSheet(spreadsheet)
    return prepareExpensePermissionRoster(
      createGoogleSheetStore(spreadsheet).read('CONFIG_STAFF').map(parseStaffConfigRow),
    )
  })
}

export function applyExpensePermissionsWorkflow(): {
  submitterCount: number
  managerCount: 3
  changedRows: number
} {
  return runSafeExpenseOperatorWorkflow('EXPENSE_PERMISSION_APPLY_UNAVAILABLE', () => {
    const properties = PropertiesService.getScriptProperties().getProperties()
    if (properties[SCRIPT_PROPERTY_KEYS.financePermissionCutoverApproved]?.trim() !== 'true') {
      throw new Error('expense permission cutover is not approved')
    }
    const spreadsheetId = requiredExpenseSetupValue(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
    const submitterIds = configuredExpenseStaffIds(properties[SCRIPT_PROPERTY_KEYS.expenseSubmitterIds])
    const managerIds = configuredExpenseStaffIds(properties[SCRIPT_PROPERTY_KEYS.financeManagerIds])
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
    const lock = LockService.getScriptLock()
    lock.waitLock(30_000)
    try {
      const sheet = requireCanonicalStaffSheet(spreadsheet)
      const staff = createGoogleSheetStore(spreadsheet)
        .read('CONFIG_STAFF')
        .map(parseStaffConfigRow)
      const plan = applyExpensePermissionGrants(staff, submitterIds, managerIds)
      const permissionColumn = STAFF_CONFIG_COLUMNS.indexOf('canSubmitExpense') + 1
      const expected = plan.grants.map((grant) => [
        grant.canSubmitExpense,
        grant.canViewFinance,
        grant.canManageExpense,
      ])
      if (plan.changedRows > 0) {
        sheet.getRange(2, permissionColumn, expected.length, 3).setValues(expected)
      }
      const readback = sheet
        .getRange(2, permissionColumn, expected.length, 3)
        .getValues()
      if (
        readback.length !== expected.length
        || readback.some((row, rowIndex) => (
          row.length !== 3 || row.some((value, columnIndex) => value !== expected[rowIndex]?.[columnIndex])
        ))
      ) {
        throw new Error('expense permission readback mismatch')
      }
      return {
        submitterCount: plan.submitterCount,
        managerCount: plan.managerCount,
        changedRows: plan.changedRows,
      }
    } finally {
      lock.releaseLock()
    }
  })
}

function fileHasDirectParent(
  file: GoogleAppsScript.Drive.File,
  folderId: string,
): boolean {
  const parents = file.getParents()
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return true
  }
  return false
}

export function setupExpenseFinanceStorageWorkflow(): {
  masterReady: true
  createdTabCount: number
  verifiedTabCount: number
} {
  return runSafeExpenseOperatorWorkflow('EXPENSE_FINANCE_STORAGE_UNAVAILABLE', () => {
    const properties = PropertiesService.getScriptProperties().getProperties()
    const masterSpreadsheetId = requiredExpenseSetupValue(
      properties[SCRIPT_PROPERTY_KEYS.financeMasterSpreadsheetId],
    )
    const financeFolderId = requiredExpenseSetupValue(
      properties[SCRIPT_PROPERTY_KEYS.financeFolderId],
    )
    const folder = DriveApp.getFolderById(financeFolderId)
    const file = DriveApp.getFileById(masterSpreadsheetId)
    const masterInsidePrivateFolder = !folder.isTrashed()
      && !file.isTrashed()
      && folder.getSharingAccess() === DriveApp.Access.PRIVATE
      && file.getSharingAccess() === DriveApp.Access.PRIVATE
      && fileHasDirectParent(file, financeFolderId)
    if (!masterInsidePrivateFolder) {
      throw new Error('finance master is outside the configured private folder')
    }
    const topology = ensureFinanceMasterTopology(
      createGoogleExpenseTopologyPort(SpreadsheetApp.openById(masterSpreadsheetId)),
    )
    return {
      masterReady: true,
      createdTabCount: topology.createdTabCount,
      verifiedTabCount: topology.verifiedTabCount,
    }
  })
}

export function prepareStaffAeMigrationWorkflow(): {
  staffRows: number
  missingPersonalEmailNames: string[]
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheet = SpreadsheetApp.openById(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
  migrateBookingMasterStaffColumns(spreadsheet)
  migrateConfigStaffColumns(spreadsheet)
  ensureSheetTopology(spreadsheet)
  const store = createGoogleSheetStore(spreadsheet)
  let staffRows = store.read('CONFIG_STAFF')
  if (!staffRows.length) {
    staffRows = seedStaffRowsFromLegacy(store.read('CONFIG_ADMINS'))
    store.replace('CONFIG_STAFF', staffRows)
  }
  return {
    staffRows: staffRows.length,
    missingPersonalEmailNames: staffRows
      .filter((row) => isActive(row.active) && isActive(row.canCloseBooking) && !String(row.email).trim())
      .map((row) => String(row.name)),
  }
}

export function configureStaffProfileImagesWorkflow(): {
  backupCreated: true
  updatedProfiles: number
  blankProfiles: number
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheetId = properties[SCRIPT_PROPERTY_KEYS.spreadsheetId]
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  let sheet = spreadsheet.getSheetByName('CONFIG_STAFF')
  if (!sheet) throw new Error('missing required sheet: CONFIG_STAFF')
  if (sheet.getLastRow() < 2) throw new Error('CONFIG_STAFF has no staff rows')

  const logoSuffix = '/assets/pmc-flex-logo-v1.png'
  const logoUrl = properties[SCRIPT_PROPERTY_KEYS.brandLogoUrl].trim()
  if (!logoUrl.endsWith(logoSuffix)) throw new Error('brand logo URL has an unexpected path')
  const baseUrl = logoUrl.slice(0, -logoSuffix.length)
  const rowCount = sheet.getLastRow() - 1
  const nameColumn = STAFF_CONFIG_COLUMNS.indexOf('name') + 1
  const profileColumn = STAFF_CONFIG_COLUMNS.indexOf('profileImageUrl') + 1
  const names = sheet
    .getRange(2, nameColumn, rowCount, 1)
    .getDisplayValues()
    .map(([name]) => name)
  const plan = staffProfileUrlPlan(names, baseUrl)

  const backupFolder = DriveApp.getFolderById(properties[SCRIPT_PROPERTY_KEYS.backupFolderId])
  const backupTimestamp = Utilities.formatDate(
    new Date(),
    'Asia/Bangkok',
    'yyyy-MM-dd_HH-mm-ss',
  )
  DriveApp.getFileById(spreadsheetId).makeCopy(
    `PMC Booking Pre-Profile-Avatar Cutover ${backupTimestamp}`,
    backupFolder,
  )

  migrateConfigStaffColumns(spreadsheet)
  sheet = spreadsheet.getSheetByName('CONFIG_STAFF')
  if (!sheet) throw new Error('missing required sheet: CONFIG_STAFF')
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(String)
  if (JSON.stringify(headers) !== JSON.stringify(STAFF_CONFIG_COLUMNS)) {
    throw new Error('sheet header mismatch: CONFIG_STAFF')
  }
  sheet
    .getRange(2, profileColumn, rowCount, 1)
    .setValues(plan.map((item) => [item.profileImageUrl]))

  const readback = sheet
    .getRange(2, profileColumn, rowCount, 1)
    .getDisplayValues()
    .map(([value]) => value)
  if (readback.some((value, index) => value !== plan[index].profileImageUrl)) {
    throw new Error('staff profile URL readback mismatch')
  }
  return {
    backupCreated: true,
    updatedProfiles: plan.filter((item) => item.profileImageUrl).length,
    blankProfiles: plan.filter((item) => !item.profileImageUrl).length,
  }
}

export function configureStockManagersWorkflow(): {
  managerCount: 3
  changedRows: number
} {
  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(SCRIPT_PROPERTY_KEYS.spreadsheetId)
    ?.trim()
  if (!spreadsheetId) throw new Error('PMC_SPREADSHEET_ID is not configured')
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  const sheet = spreadsheet.getSheetByName('CONFIG_STAFF')
  if (!sheet) throw new Error('missing required sheet: CONFIG_STAFF')
  const lock = LockService.getScriptLock()
  lock.waitLock(30_000)
  try {
    const headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(String)
    if (JSON.stringify(headers) !== JSON.stringify(STAFF_CONFIG_COLUMNS)) {
      throw new Error('sheet header mismatch: CONFIG_STAFF')
    }
    const source = createGoogleSheetStore(spreadsheet)
    const managerColumn = STAFF_CONFIG_COLUMNS.indexOf('canManageStock') + 1
    const plan: { rows: SheetRow[] | null } = { rows: null }
    const result = configureStockManagers({
      read: (tab) => source.read(tab),
      replace(tab, rows) {
        if (tab !== 'CONFIG_STAFF') throw new Error('unexpected Stock manager tab')
        plan.rows = rows
      },
      append() { throw new Error('unexpected Stock manager append') },
      update() { throw new Error('unexpected Stock manager update') },
    })
    const liveRows = source.read('CONFIG_STAFF')
    if (plan.rows) {
      if (liveRows.length !== plan.rows.length || liveRows.some((row, index) => (
        row.id !== plan.rows![index]?.id || isActiveStockManagerRow(row.active) !== isActiveStockManagerRow(plan.rows![index]?.active)
      ))) {
        throw new Error('CONFIG_STAFF changed during Stock manager cutover')
      }
      const expected = plan.rows.map((row) => [row.canManageStock === true])
      sheet.getRange(2, managerColumn, plan.rows.length, 1).setValues(expected)
    }
    const readback = source.read('CONFIG_STAFF')
    if (!hasExactStockManagerCutover(readback)) throw new Error('PMC Stock manager readback mismatch')
    return result
  } finally {
    lock.releaseLock()
  }
}

function isActiveStockManagerRow(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'
}

function hasExactStockManagerCutover(rows: SheetRow[]): boolean {
  const expected = new Set(['shared-account-test', 'ADMIN_07', 'ADMIN_03'])
  const activeManagers = rows
    .filter((row) => isActiveStockManagerRow(row.active) && row.canManageStock === true)
    .map((row) => String(row.id))
  return activeManagers.length === expected.size && activeManagers.every((id) => expected.has(id))
}

export function validateProductionFlexMessagesWorkflow(): {
  validatorStatus: 200
  accepted: true
  adminHasProfiles: true
  doctorHasProfiles: true
  adminHasEvidence: true
  doctorHasEvidence: false
  callReminderReady: true
  automaticQueueReady: true
  validationRequests: 2
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const logoSuffix = '/assets/pmc-flex-logo-v1.png'
  const logoUrl = properties[SCRIPT_PROPERTY_KEYS.brandLogoUrl].trim()
  if (!logoUrl.endsWith(logoSuffix)) throw new Error('brand logo URL has an unexpected path')
  const baseUrl = logoUrl.slice(0, -logoSuffix.length)
  const messages = buildProductionFlexValidationMessages(logoUrl, baseUrl)
  const chunks = Array.from(
    { length: Math.ceil(messages.length / 5) },
    (_, index) => messages.slice(index * 5, index * 5 + 5),
  )
  for (const [index, chunk] of chunks.entries()) {
    const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/validate/push', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: `Bearer ${properties[SCRIPT_PROPERTY_KEYS.lineAccessToken]}`,
      },
      payload: JSON.stringify({ messages: chunk }),
      muteHttpExceptions: true,
    })
    const status = response.getResponseCode()
    if (status !== 200) {
      const propertyPaths = lineValidationPropertyPaths(response.getContentText())
      throw new Error(
        `LINE Flex validation batch ${index + 1} failed with status ${status}` +
        (propertyPaths.length ? ` at ${propertyPaths.join(',')}` : ''),
      )
    }
  }
  return {
    validatorStatus: 200,
    accepted: true,
    adminHasProfiles: true,
    doctorHasProfiles: true,
    adminHasEvidence: true,
    doctorHasEvidence: false,
    callReminderReady: true,
    automaticQueueReady: true,
    validationRequests: 2,
  }
}

export function sendProductionFlexPilotWorkflow(): {
  sentMessages: 2
  adminSent: true
  doctorSent: true
  doctorName: string
} {
  const runtime = createRuntime()
  return sendProductionFlexPilot(runtime.config, runtime.line)
}

export function sendCallReminderFlexPilotWorkflow(): {
  sentMessages: 1
  adminSent: true
} {
  const runtime = createRuntime()
  return sendCallReminderFlexPilot(runtime.config, runtime.line)
}

export function configureCompactBookingIdentityFieldsWorkflow(): {
  closerTitle: typeof BOOKING_FORM_LABELS.closerName
  aeTitle: typeof BOOKING_FORM_LABELS.aeName
  noAeOption: typeof NO_AE_OPTION
  aeChoiceCount: number
} {
  const runtime = createRuntime()
  const activeAes = bookingAttributionFormChoices(runtime.config.listStaff()).aes
  if (!runtime.forms.bookingCollectsEmail()) throw new Error('booking Form must collect email')
  runtime.forms.configureCompactIdentityFields(activeAes)
  if (!runtime.forms.bookingHasCloserField()) throw new Error('booking Form closer field is missing')
  if (!runtime.forms.bookingHasAeField()) throw new Error('booking Form AE field is missing')
  return {
    closerTitle: BOOKING_FORM_LABELS.closerName,
    aeTitle: BOOKING_FORM_LABELS.aeName,
    noAeOption: NO_AE_OPTION,
    aeChoiceCount: activeAes.length + 1,
  }
}

export function configureQueueModeFormsWorkflow(): {
  queueQuestionReady: true
  confirmationFormReady: true
  createdTrigger: boolean
  createdConfirmationForm: boolean
} {
  const scriptProperties = PropertiesService.getScriptProperties()
  let confirmationFormId = scriptProperties
    .getProperty(SCRIPT_PROPERTY_KEYS.queueConfirmationFormId)
    ?.trim()
  let createdConfirmationForm = false
  if (!confirmationFormId) {
    const confirmationForm = FormApp.create('PMC Queue Confirmation')
    confirmationForm.setCollectEmail(true)
    confirmationFormId = confirmationForm.getId()
    scriptProperties.setProperty(
      SCRIPT_PROPERTY_KEYS.queueConfirmationFormId,
      confirmationFormId,
    )
    createdConfirmationForm = true
  }
  const runtime = createRuntime()
  runtime.forms.pauseBookingResponses()
  try {
    const queue = runtime.forms.configureQueueModeForm()
    const confirmation = runtime.forms.ensureQueueConfirmationForm()
    const createdTrigger = ensureFormTrigger(
      BOOKING_INSTALLABLE_TRIGGER_REGISTRY.queueConfirmationForm.handler,
      confirmationFormId,
    )
    return { ...queue, ...confirmation, createdTrigger, createdConfirmationForm }
  } finally {
    runtime.forms.resumeBookingResponses()
  }
}

export function prepareAutoQueueMigrationWorkflow(): {
  bookingRows: number
  rowsNeedingBackfill: number
  queueConfirmationFormReady: boolean
  triggerWouldBeCreated: boolean
  liveWrites: false
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  const spreadsheetId = properties[SCRIPT_PROPERTY_KEYS.spreadsheetId]?.trim()
  if (!spreadsheetId) throw new Error('PMC_SPREADSHEET_ID is not configured')
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  const sheet = spreadsheet.getSheetByName('BOOKING_MASTER')
  if (!sheet) throw new Error('missing required sheet: BOOKING_MASTER')
  const bookingRows = Math.max(sheet.getLastRow() - 1, 0)
  const headers = sheet.getLastColumn()
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    : []
  const queueIndex = headers.indexOf('queueType')
  const appointmentIndex = headers.indexOf('appointmentStatus')
  let rowsNeedingBackfill = bookingRows
  if (bookingRows && queueIndex >= 0 && appointmentIndex >= 0) {
    const values = sheet
      .getRange(2, 1, bookingRows, headers.length)
      .getDisplayValues()
    rowsNeedingBackfill = values.filter((row) =>
      !row[queueIndex]?.trim() || !row[appointmentIndex]?.trim(),
    ).length
  } else if (!bookingRows) {
    rowsNeedingBackfill = 0
  }
  const queueConfirmationFormReady = Boolean(
    properties[SCRIPT_PROPERTY_KEYS.queueConfirmationFormId]?.trim(),
  )
  const triggerWouldBeCreated = !ScriptApp.getProjectTriggers().some(
    (trigger) => trigger.getHandlerFunction()
      === BOOKING_INSTALLABLE_TRIGGER_REGISTRY.queueConfirmationForm.handler,
  )
  return {
    bookingRows,
    rowsNeedingBackfill,
    queueConfirmationFormReady,
    triggerWouldBeCreated,
    liveWrites: false,
  }
}

export function applyAutoQueueMigrationWorkflow(): {
  backupCreated: true
  migratedRows: number
  preservedReferences: true
} {
  const scriptProperties = PropertiesService.getScriptProperties()
  const properties = scriptProperties.getProperties()
  if (properties[SCRIPT_PROPERTY_KEYS.autoQueueMigrationApproval] !== 'true') {
    throw new Error('auto queue migration approval marker is missing')
  }
  scriptProperties.deleteProperty(SCRIPT_PROPERTY_KEYS.autoQueueMigrationApproval)
  const spreadsheetId = properties[SCRIPT_PROPERTY_KEYS.spreadsheetId]
  if (!spreadsheetId) throw new Error('PMC_SPREADSHEET_ID is not configured')
  const backupFolderId = properties[SCRIPT_PROPERTY_KEYS.backupFolderId]
  if (!backupFolderId) throw new Error('PMC_BACKUP_FOLDER_ID is not configured')
  const timestamp = Utilities.formatDate(
    new Date(),
    'Asia/Bangkok',
    'yyyy-MM-dd_HH-mm-ss',
  )
  DriveApp.getFileById(spreadsheetId).makeCopy(
    `PMC Booking Pre-Auto-Queue ${timestamp}`,
    DriveApp.getFolderById(backupFolderId),
  )
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  migrateBookingMasterStaffColumns(spreadsheet)
  migrateConfigStaffColumns(spreadsheet)
  ensureSheetTopology(spreadsheet)
  const store = createGoogleSheetStore(spreadsheet)
  const before = store.read('BOOKING_MASTER')
  const references = before.map((row) => ({
    caseId: String(row.caseId ?? ''),
    calendarEventId: String(row.calendarEventId ?? ''),
    driveFolderId: String(row.driveFolderId ?? ''),
  }))
  store.replace('BOOKING_MASTER', migrateAppointmentRows(before) as unknown as SheetRow[])
  const after = store.read('BOOKING_MASTER')
  const readbackReferences = after.map((row) => ({
    caseId: String(row.caseId ?? ''),
    calendarEventId: String(row.calendarEventId ?? ''),
    driveFolderId: String(row.driveFolderId ?? ''),
  }))
  if (JSON.stringify(readbackReferences) !== JSON.stringify(references)) {
    throw new Error('auto queue migration reference readback mismatch')
  }
  if (after.some((row) => !row.queueType || !row.appointmentStatus)) {
    throw new Error('auto queue migration state readback mismatch')
  }
  return {
    backupCreated: true,
    migratedRows: after.length,
    preservedReferences: true,
  }
}

export function configureFacebookNameFieldWorkflow(): {
  backupCreated: true
  formField: typeof BOOKING_FORM_LABELS.facebookName
  sheetColumn: 'facebookName'
  acceptingResponses: true
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheetId = properties[SCRIPT_PROPERTY_KEYS.spreadsheetId]
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  const runtime = createRuntime()
  if (!runtime.forms.bookingCollectsEmail()) throw new Error('booking Form must collect email')

  runtime.forms.pauseBookingResponses()
  const backupFolder = DriveApp.getFolderById(properties[SCRIPT_PROPERTY_KEYS.backupFolderId])
  const backupTimestamp = Utilities.formatDate(
    new Date(),
    'Asia/Bangkok',
    'yyyy-MM-dd_HH-mm-ss',
  )
  DriveApp.getFileById(spreadsheetId).makeCopy(
    `PMC Booking Pre-Facebook-Name Cutover ${backupTimestamp}`,
    backupFolder,
  )

  migrateBookingMasterStaffColumns(spreadsheet)
  migrateConfigStaffColumns(spreadsheet)
  ensureSheetTopology(spreadsheet)
  runtime.forms.ensureFacebookNameField()
  if (!runtime.forms.bookingHasFacebookNameField()) {
    throw new Error('booking Form Facebook name field is missing or optional')
  }
  runtime.forms.resumeBookingResponses()
  return {
    backupCreated: true,
    formField: BOOKING_FORM_LABELS.facebookName,
    sheetColumn: 'facebookName',
    acceptingResponses: true,
  }
}

export function pauseAndCutoverBookingFormWorkflow(): {
  paused: true
  syncedClosers: number
  syncedAes: number
} {
  const runtime = createRuntime()
  validateStaffDirectory(runtime.config.listStaff())
  const formAttributionChoices = bookingAttributionFormChoices(runtime.config.listStaff())
  if (!runtime.forms.bookingCollectsEmail()) throw new Error('booking Form must collect email')
  runtime.forms.pauseBookingResponses()
  runtime.forms.renameAdminFieldToAe()
  runtime.forms.ensureCloserField()
  runtime.forms.syncBookingChoices(
    formAttributionChoices.admins,
    formAttributionChoices.aes,
    runtime.config.listDoctors().filter((doctor) => doctor.active).map((doctor) => doctor.id),
    runtime.config.listServices().filter((service) => service.active).map((service) => service.id),
    runtime.config.listChannels().filter((channel) => channel.active).map((channel) => channel.id),
  )
  return {
    paused: true,
    syncedClosers: formAttributionChoices.admins.length,
    syncedAes: formAttributionChoices.aes.length,
  }
}

export function resumeBookingFormAfterAeCutoverWorkflow(): { acceptingResponses: true } {
  const runtime = createRuntime()
  validateStaffDirectory(runtime.config.listStaff())
  if (!runtime.forms.bookingCollectsEmail()) throw new Error('booking Form must collect email')
  if (!runtime.forms.bookingHasCloserField()) throw new Error('booking Form closer field is missing')
  if (!runtime.forms.bookingHasAeField()) throw new Error('booking Form AE field is missing')
  runtime.forms.resumeBookingResponses()
  return { acceptingResponses: true }
}
