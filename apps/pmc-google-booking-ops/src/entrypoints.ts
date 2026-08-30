import {
  bookingFormResponseEvent,
  callResultFormResponseEvent,
  queueConfirmationFormResponseEvent,
  parseBookingFormEvent,
  parseCallResultFormEvent,
} from './adapters/googleForms'
import {
  handleLineDirectoryIngress,
  parseBookingIngressPayload,
  type AppsScriptDoPostEvent,
} from './adapters/lineMessaging'
import {
  createRuntime,
  configureStaffProfileImagesWorkflow,
  configureStockManagersWorkflow,
  configureCompactBookingIdentityFieldsWorkflow,
  configureFacebookNameFieldWorkflow,
  configureQueueModeFormsWorkflow,
  applyExpensePermissionsWorkflow,
  migrateFinancePermissionColumnsWorkflow,
  prepareExpensePermissionsWorkflow,
  prepareAutoQueueMigrationWorkflow,
  applyAutoQueueMigrationWorkflow,
  pauseAndCutoverBookingFormWorkflow,
  prepareStaffAeMigrationWorkflow,
  resumeBookingFormAfterAeCutoverWorkflow,
  runDailyOperationsWorkflow,
  runBookingRetriesWorkflow,
  runIntegrityAndBackupWorkflow,
  runExpenseRecoveryWorkflow,
  sendCallReminderFlexPilotWorkflow,
  sendProductionFlexPilotWorkflow,
  setupSystem,
  setupExpenseFinanceStorageWorkflow,
  bootstrapExpenseMonthWorkflow,
  validateProductionFlexMessagesWorkflow,
} from './runtime'
import { SCRIPT_PROPERTY_KEYS, SHARED_DOCTOR_CALENDAR_ID } from './config'
import { recordCallResult } from './workflows/callQueue'
import { parseQueueConfirmationFormEvent } from './domain/queueConfirmation'
import { confirmQueue } from './workflows/queueConfirmation'
import { configureSharedDoctorCalendar } from './workflows/calendarConfig'
import { submitBookingIntake } from './workflows/formSubmit'
import { pollJeraIncoming as pollJeraIncomingWorkflow } from './workflows/jeraImport'
import { parseAppsScriptDoPostBody, verifyMiniAppIngressPayload } from './domain/miniAppIngress'
import { submitMiniAppBooking } from './workflows/miniAppSubmit'
import {
  MAX_EVIDENCE_INGRESS_LENGTH,
  uploadMiniAppEvidence,
} from './domain/miniAppEvidenceIngress'
import type { BookingPorts } from './ports'
import { mutateMiniAppAsyncState } from './domain/miniAppAsyncStateIngress'
import type { BookingCase } from './domain/types'
import type { MiniAppBookingIngressResult } from '../../../shared/pmcMiniAppBooking'
import { processStockIngressResponse, type StockIngressPorts } from './stock/ingress'
import {
  processExpenseIngressResponse,
  processExpenseRecoveryIngressResponse,
  processExpenseResumeIngressResponse,
  type ExpenseIngressPorts,
} from './expense/ingress'

export function onBookingFormSubmit(event: GoogleAppsScript.Events.FormsOnFormSubmit) {
  return submitBookingIntake(parseBookingFormEvent(bookingFormResponseEvent(event)), createRuntime())
}

export function onCallResultSubmit(event: GoogleAppsScript.Events.FormsOnFormSubmit) {
  return recordCallResult(parseCallResultFormEvent(callResultFormResponseEvent(event)), createRuntime())
}

export function onQueueConfirmationSubmit(event: GoogleAppsScript.Events.FormsOnFormSubmit) {
  return confirmQueue(
    parseQueueConfirmationFormEvent(queueConfirmationFormResponseEvent(event)),
    createRuntime(),
  )
}

export function doPost(event: AppsScriptDoPostEvent) {
  const result = processBookingDoPost(event, createRuntime())
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON)
}

export function processBookingDoPost(
  event: AppsScriptDoPostEvent,
  ports: BookingPorts
    & Partial<Pick<StockIngressPorts, 'stock' | 'commandFingerprint' | 'allocateId'>>
    & Partial<Pick<
      ExpenseIngressPorts,
      | 'expense'
      | 'expenseSecrets'
      | 'expenseCommandFingerprint'
      | 'allocateExpenseId'
    >>,
) {
  const evidenceCandidate = event.postData?.contents.startsWith('{"kind":"MINI_APP_EVIDENCE"')
  const parsed = parseAppsScriptDoPostBody(event, evidenceCandidate ? MAX_EVIDENCE_INGRESS_LENGTH : undefined)
  if (isRecord(parsed) && parsed.kind === 'MINI_APP_STOCK') {
    return processStockIngressResponse(parsed, requireStockIngressPorts(ports))
  }
  if (isRecord(parsed) && parsed.kind === 'MINI_APP_EXPENSE_RECOVERY') {
    return processExpenseRecoveryIngressResponse(parsed, requireExpenseIngressPorts(ports))
  }
  if (isRecord(parsed) && parsed.kind === 'MINI_APP_EXPENSE_RESUME') {
    return processExpenseResumeIngressResponse(parsed, requireExpenseIngressPorts(ports))
  }
  if (isRecord(parsed) && parsed.kind === 'MINI_APP_EXPENSE') {
    return processExpenseIngressResponse(parsed, requireExpenseIngressPorts(ports))
  }
  if (isRecord(parsed) && parsed.kind === 'MINI_APP_EVIDENCE') {
    return uploadMiniAppEvidence(parsed, ports)
  }
  if (isRecord(parsed) && parsed.kind === 'MINI_APP_ASYNC_STATE') {
    return mutateMiniAppAsyncState(parsed, ports)
  }
  if (isRecord(parsed) && parsed.kind === 'MINI_APP_BOOKING') {
    const booking = submitMiniAppBooking(verifyMiniAppIngressPayload(parsed, ports), ports)
    return bookingIngressResult(booking)
  }
  if (isRecord(parsed) && !Object.prototype.hasOwnProperty.call(parsed, 'kind')) {
    handleLineDirectoryIngress(parseBookingIngressPayload(parsed), ports)
    return { ok: true as const }
  }
  throw new Error('unsupported ingress kind')
}

function requireExpenseIngressPorts(
  ports: BookingPorts
    & Partial<Pick<
      ExpenseIngressPorts,
      | 'expense'
      | 'expenseSecrets'
      | 'expenseCommandFingerprint'
      | 'allocateExpenseId'
    >>,
): ExpenseIngressPorts {
  if (
    !ports.expense
    || !ports.expenseSecrets
    || typeof ports.expenseCommandFingerprint !== 'function'
    || typeof ports.allocateExpenseId !== 'function'
  ) throw new Error('expense runtime is unavailable')
  return ports as BookingPorts & ExpenseIngressPorts
}

function bookingIngressResult(booking: BookingCase): MiniAppBookingIngressResult {
  if ((booking.driveState !== 'OK' && booking.driveState !== 'RETRY')
    || !isCalendarProjectionState(booking.calendarState)
    || !isLineProjectionState(booking.lineState)) {
    throw new Error('mini app booking projection state rejected')
  }
  return {
    caseId: booking.caseId,
    status: booking.appointmentStatus,
    driveState: booking.driveState,
    calendarState: booking.calendarState,
    lineState: booking.lineState,
  }
}

function isCalendarProjectionState(value: BookingCase['calendarState']): value is MiniAppBookingIngressResult['calendarState'] {
  return value === 'PENDING' || value === 'OK' || value === 'RETRY' || value === 'CONFLICT'
}

function isLineProjectionState(value: BookingCase['lineState']): value is MiniAppBookingIngressResult['lineState'] {
  return value === 'PENDING' || value === 'OK' || value === 'RETRY'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireStockIngressPorts(
  ports: BookingPorts & Partial<Pick<StockIngressPorts, 'stock' | 'commandFingerprint' | 'allocateId'>>,
): StockIngressPorts {
  if (
    !ports.stock ||
    typeof ports.commandFingerprint !== 'function' ||
    typeof ports.allocateId !== 'function'
  ) {
    throw new Error('stock runtime is unavailable')
  }
  return ports as BookingPorts & StockIngressPorts
}

export function runDailyOperations() {
  return runDailyOperationsWorkflow(createRuntime())
}

export function runPmcBookingRetries() {
  return runBookingRetriesWorkflow()
}

export function pollJeraIncoming() {
  const legacyTriggers = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === 'pollJeraIncoming',
  )
  for (const trigger of legacyTriggers) ScriptApp.deleteTrigger(trigger)
  return { paused: true as const, deletedTriggers: legacyTriggers.length }
}

export function runPmcJeraFileImportManually() {
  return pollJeraIncomingWorkflow(createRuntime())
}

export function runIntegrityChecks() {
  return runIntegrityAndBackupWorkflow(createRuntime())
}

export function setupPmcBookingSystem() {
  return setupSystem()
}

export function migratePmcFinancePermissionColumns() {
  return migrateFinancePermissionColumnsWorkflow()
}

export function preparePmcExpensePermissions() {
  const roster = prepareExpensePermissionsWorkflow()
  console.log(JSON.stringify(roster))
  return roster
}

export function applyPmcExpensePermissions() {
  return applyExpensePermissionsWorkflow()
}

export function setupPmcExpenseFinanceStorage() {
  return setupExpenseFinanceStorageWorkflow()
}

export function bootstrapPmcExpenseMonth(monthKey: string) {
  return bootstrapExpenseMonthWorkflow(monthKey)
}

export function runPmcExpenseRecovery() {
  return runExpenseRecoveryWorkflow()
}

export function preparePmcStaffAeMigration() {
  return prepareStaffAeMigrationWorkflow()
}

export function preparePmcAutoQueueMigration() {
  const result = prepareAutoQueueMigrationWorkflow()
  console.log(JSON.stringify(result))
  return result
}

export function applyPmcAutoQueueMigration() {
  return applyAutoQueueMigrationWorkflow()
}

export function configurePmcStaffProfileImages() {
  return configureStaffProfileImagesWorkflow()
}

export function configurePmcStockManagers() {
  return configureStockManagersWorkflow()
}

export function validatePmcBookingFlexMessages() {
  return validateProductionFlexMessagesWorkflow()
}

export function sendPmcBookingFlexPilot() {
  return sendProductionFlexPilotWorkflow()
}

export function sendPmcCallReminderFlexPilot() {
  return sendCallReminderFlexPilotWorkflow()
}

export function configurePmcCompactFormIdentityFields() {
  return configureCompactBookingIdentityFieldsWorkflow()
}

export function configurePmcFacebookNameField() {
  return configureFacebookNameFieldWorkflow()
}

export function configurePmcQueueModeForms() {
  return configureQueueModeFormsWorkflow()
}

export function pauseAndCutoverPmcBookingForm() {
  return pauseAndCutoverBookingFormWorkflow()
}

export function resumePmcBookingFormAfterAeCutover() {
  return resumeBookingFormAfterAeCutoverWorkflow()
}

export function configurePmcSharedDoctorCalendar() {
  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(SCRIPT_PROPERTY_KEYS.spreadsheetId)
    ?.trim()
  if (!spreadsheetId) throw new Error('PMC_SPREADSHEET_ID is not configured')
  return configureSharedDoctorCalendar(
    SpreadsheetApp.openById(spreadsheetId),
    SHARED_DOCTOR_CALENDAR_ID,
  )
}
