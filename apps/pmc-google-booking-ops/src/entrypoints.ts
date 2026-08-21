import {
  bookingFormResponseEvent,
  callResultFormResponseEvent,
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
  pauseAndCutoverBookingFormWorkflow,
  prepareStaffAeMigrationWorkflow,
  resumeBookingFormAfterAeCutoverWorkflow,
  runDailyOperationsWorkflow,
  runIntegrityAndBackupWorkflow,
  sendProductionFlexPilotWorkflow,
  setupSystem,
  validateProductionFlexMessagesWorkflow,
} from './runtime'
import { recordCallResult } from './workflows/callQueue'
import { submitBookingIntake } from './workflows/formSubmit'
import { pollJeraIncoming as pollJeraIncomingWorkflow } from './workflows/jeraImport'

export function onBookingFormSubmit(event: GoogleAppsScript.Events.FormsOnFormSubmit) {
  return submitBookingIntake(parseBookingFormEvent(bookingFormResponseEvent(event)), createRuntime())
}

export function onCallResultSubmit(event: GoogleAppsScript.Events.FormsOnFormSubmit) {
  return recordCallResult(parseCallResultFormEvent(callResultFormResponseEvent(event)), createRuntime())
}

export function doPost(event: AppsScriptDoPostEvent) {
  handleLineDirectoryIngress(parseBookingIngressEvent(event), createRuntime())
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
}

export function runDailyOperations() {
  return runDailyOperationsWorkflow(createRuntime())
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

export function configurePmcCompactFormIdentityFields() {
  return configureCompactBookingIdentityFieldsWorkflow()
}

export function pauseAndCutoverPmcBookingForm() {
  return pauseAndCutoverBookingFormWorkflow()
}

export function resumePmcBookingFormAfterAeCutover() {
  return resumeBookingFormAfterAeCutoverWorkflow()
}
