import {
  bookingFormResponseEvent,
  callResultFormResponseEvent,
  queueConfirmationFormResponseEvent,
  parseBookingFormEvent,
  parseCallResultFormEvent,
} from './adapters/googleForms'
import {
  handleLineDirectoryIngress,
  parseBookingIngressEvent,
  type AppsScriptDoPostEvent,
} from './adapters/lineMessaging'
import {
  createRuntime,
  configureStaffProfileImagesWorkflow,
  configureCompactBookingIdentityFieldsWorkflow,
  configureFacebookNameFieldWorkflow,
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
  handleLineDirectoryIngress(parseBookingIngressEvent(event), createRuntime())
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
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
