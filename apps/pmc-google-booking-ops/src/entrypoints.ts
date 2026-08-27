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
  configureCompactBookingIdentityFieldsWorkflow,
  configureFacebookNameFieldWorkflow,
  configureQueueModeFormsWorkflow,
  prepareAutoQueueMigrationWorkflow,
  applyAutoQueueMigrationWorkflow,
  pauseAndCutoverBookingFormWorkflow,
  prepareStaffAeMigrationWorkflow,
  resumeBookingFormAfterAeCutoverWorkflow,
  runDailyOperationsWorkflow,
  runBookingRetriesWorkflow,
  runIntegrityAndBackupWorkflow,
  sendCallReminderFlexPilotWorkflow,
  sendProductionFlexPilotWorkflow,
  setupSystem,
  validateProductionFlexMessagesWorkflow,
} from './runtime'
import { SCRIPT_PROPERTY_KEYS, SHARED_DOCTOR_CALENDAR_ID } from './config'
import { recordCallResult } from './workflows/callQueue'
import { parseQueueConfirmationFormEvent } from './domain/queueConfirmation'
import { confirmQueue } from './workflows/queueConfirmation'
import { configureSharedDoctorCalendar } from './workflows/calendarConfig'
import { refreshBookingCalendarPresentation } from './workflows/bookingUpdate'
import { submitBookingIntake } from './workflows/formSubmit'
import { pollJeraIncoming as pollJeraIncomingWorkflow } from './workflows/jeraImport'
import { parseAppsScriptDoPostBody, verifyMiniAppIngressPayload } from './domain/miniAppIngress'
import { submitMiniAppBooking } from './workflows/miniAppSubmit'
import type { BookingPorts } from './ports'

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

export function processBookingDoPost(event: AppsScriptDoPostEvent, ports: BookingPorts) {
  const parsed = parseAppsScriptDoPostBody(event)
  if (isRecord(parsed) && parsed.kind === 'MINI_APP_BOOKING') {
    const booking = submitMiniAppBooking(verifyMiniAppIngressPayload(parsed, ports), ports)
    return { caseId: booking.caseId, status: booking.appointmentStatus }
  }
  if (isRecord(parsed) && !Object.prototype.hasOwnProperty.call(parsed, 'kind')) {
    handleLineDirectoryIngress(parseBookingIngressPayload(parsed), ports)
    return { ok: true as const }
  }
  throw new Error('unsupported ingress kind')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function runDailyOperations() {
  return runDailyOperationsWorkflow(createRuntime())
}

export function runPmcBookingRetries() {
  return runBookingRetriesWorkflow()
}

export function pollJeraIncoming() {
  return pollJeraIncomingWorkflow(createRuntime())
}

export function runIntegrityChecks() {
  return runIntegrityAndBackupWorkflow(createRuntime())
}

export function setupPmcBookingSystem() {
  return setupSystem()
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

export function refreshPmcCalendarPresentation0007() {
  return refreshBookingCalendarPresentation('PMC-202608-0007', createRuntime())
}
