import { createGoogleCalendarPort } from './adapters/googleCalendar'
import { ensureDoctorCalendarEvent } from './adapters/googleCalendar'
import { createGoogleBackupPort, createGoogleDrivePort } from './adapters/googleDrive'
import { ensureCaseEvidenceFolder } from './adapters/googleDrive'
import { createGoogleFilePort } from './adapters/googleFiles'
import { createGoogleFormsPort } from './adapters/googleForms'
import { createEvidenceMediaPort } from './adapters/evidenceMedia'
import {
  adminBookingMessage,
  adminTimeConflictMessage,
  bookingTeamProfiles,
  createAppsScriptCryptoPort,
  createGoogleLinePort,
  sendBookingConfirmationMessages,
} from './adapters/lineMessaging'
import { sendDoctorBookingMessage } from './adapters/lineMessaging'
import {
  createGoogleDashboardPort,
  createGoogleSheetStore,
  ensureSheetTopology,
  migrateBookingMasterStaffColumns,
  migrateConfigStaffProfileColumn,
} from './adapters/googleSheets'
import { SCRIPT_PROPERTY_KEYS } from './config'
import {
  resolveCloserByEmail,
  resolveCloserByName,
  resolveEligibleAeByName,
  validateStaffDirectory,
} from './domain/staffDirectory'
import { staffProfileUrlPlan } from './domain/staffProfileConfig'
import { STAFF_CONFIG_COLUMNS } from './sheetSchema'
import type { CallResult } from './domain/types'
import type { BookingIntake } from './domain/types'
import type { BookingPorts, ChannelConfig, ConfigPort, DoctorConfig, ServiceConfig, StaffConfig } from './ports'
import { createBookingRepositories, type SheetStore } from './repositories'
import { runDailyCallReminders, runDailyDoctorSchedules, runDepositExpiryReminders } from './workflows/callQueue'
import { writeDashboard } from './workflows/dashboard'
import { buildProductionFlexValidationMessages } from './workflows/flexValidation'
import { createDailyBackup, runIntegrityReport } from './workflows/integrity'
import { queueEvidenceRetention } from './workflows/retention'
import { seedStaffRowsFromLegacy } from './workflows/staffAeMigration'

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
): ConfigPort {
  const staff = (): StaffConfig[] =>
    store.read('CONFIG_STAFF').map((row) => ({
      id: String(row.id),
      name: String(row.name),
      email: String(row.email).trim().toLowerCase(),
      lineUserId: String(row.lineUserId),
      canCloseBooking: isActive(row.canCloseBooking),
      canBeAe: isActive(row.canBeAe),
      active: isActive(row.active),
      profileImageUrl: String(row.profileImageUrl ?? '').trim(),
    }))
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
    listDoctors: doctors,
    listServices: services,
    listChannels: channels,
  }
}

function bangkokNow(): string {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ssXXX")
}

export function createRuntime(): BookingPorts {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheet = SpreadsheetApp.openById(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
  const store = createGoogleSheetStore(spreadsheet)
  const clock = { nowIso: bangkokNow }
  const crypto = createAppsScriptCryptoPort()
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
    ),
    repositories: createBookingRepositories(store, locks, clock),
    drive: createGoogleDrivePort(properties[SCRIPT_PROPERTY_KEYS.driveRootId]),
    calendar: createGoogleCalendarPort(),
    line: createGoogleLinePort(properties[SCRIPT_PROPERTY_KEYS.lineAccessToken]),
    forms: createGoogleFormsPort(
      properties[SCRIPT_PROPERTY_KEYS.bookingFormId],
      properties[SCRIPT_PROPERTY_KEYS.callResultFormId],
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
  }
}

export function runDailyOperationsWorkflow(ports: BookingPorts): void {
  runEligibleRetries(ports)
  runDailyDoctorSchedules(ports)
  runDailyCallReminders(ports)
  runDepositExpiryReminders(ports)
  writeDashboard(ports)
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
        const message = adminBookingMessage(
          booking,
          ports.config.adminLineGroupId(),
          evidence,
          ports.config.brandLogoUrl(),
          messageVersion,
          bookingTeamProfiles(booking, ports.config),
        )
        message.retryKey = `${booking.caseId}:ADMIN_EVIDENCE_READY:${messageVersion}`
        ports.line.push(message)
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
      } else if (operation === 'CALENDAR_EVENT') {
        if (ports.calendar.hasConflict(booking.calendarId ?? '', booking.appointmentStart, booking.appointmentEnd)) {
          throw new Error('Doctor Calendar overlap')
        }
        const calendarEventId = ensureDoctorCalendarEvent(booking, ports.calendar)
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { calendarEventId, calendarState: 'OK', status: 'BOOKING_CONFIRMED' },
          { actor: 'system', reason: 'Calendar retry succeeded', correlationId: id },
        )
      } else if (operation === 'DRIVE_EVIDENCE') {
        const payload = retryPayload(retry.payload)
        const intake: BookingIntake = {
          formResponseId: booking.formResponseId,
          submittedAt: booking.depositReceivedAt,
          submitterEmail: booking.submitterEmail,
          closerName: booking.adminName,
          aeName: booking.aeName ?? booking.adminName,
          customerName: booking.customerName,
          phone: booking.phoneNormalized,
          doctorId: booking.doctorId,
          serviceId: booking.serviceId,
          channelId: booking.channelId,
          appointmentDate: booking.appointmentStart.slice(0, 10),
          appointmentTime: booking.appointmentStart.slice(11, 16),
          depositAmount: booking.depositAmount,
          paymentEvidenceFileIds: (payload.paymentEvidenceFileIds as string[]) ?? [],
          chatEvidenceFileIds: (payload.chatEvidenceFileIds as string[]) ?? [],
        }
        const evidence = ensureCaseEvidenceFolder(booking, intake, ports.drive)
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { driveFolderId: evidence.folderId, driveFolderUrl: evidence.folderUrl, driveState: 'OK' },
          { actor: 'system', reason: 'Drive retry succeeded', correlationId: id },
        )
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

function ensureFormTrigger(handler: string, formId: string): boolean {
  if (ScriptApp.getProjectTriggers().some((trigger) => trigger.getHandlerFunction() === handler)) return false
  ScriptApp.newTrigger(handler).forForm(FormApp.openById(formId)).onFormSubmit().create()
  return true
}

function ensureClockTrigger(handler: string, create: (builder: GoogleAppsScript.Script.ClockTriggerBuilder) => void): boolean {
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
  migrateConfigStaffProfileColumn(spreadsheet)
  ensureSheetTopology(spreadsheet)
  const runtime = createRuntime()
  const staff = runtime.config.listStaff().filter((item) => item.active)
  const aes = runtime.config.listEligibleAes()
  const { activeClosers } = validateStaffDirectory(staff)
  if (!runtime.forms.bookingCollectsEmail()) throw new Error('booking Form must collect email')
  const doctors = runtime.config.listDoctors().filter((doctor) => doctor.active)
  const services = runtime.config.listServices().filter((service) => service.active)
  const channels = runtime.config.listChannels().filter((channel) => channel.active)
  if (!isConfigurationReady({
    staff: staff.length,
    aes: aes.length,
    doctors: doctors.length,
    services: services.length,
  })) {
    return {
      createdTriggers: 0,
      syncedStaff: staff.length,
      syncedAes: aes.length,
      syncedDoctors: doctors.length,
      syncedServices: services.length,
      syncedChannels: channels.length,
    }
  }
  runtime.forms.ensureCloserField()
  runtime.forms.syncBookingChoices(
    activeClosers.map((closer) => closer.name),
    aes.map((ae) => ae.name),
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
    ensureFormTrigger('onBookingFormSubmit', properties[SCRIPT_PROPERTY_KEYS.bookingFormId]),
    ensureFormTrigger('onCallResultSubmit', properties[SCRIPT_PROPERTY_KEYS.callResultFormId]),
    ensureClockTrigger('pollJeraIncoming', (builder) => builder.everyMinutes(15).create()),
    ensureClockTrigger('runDailyOperations', (builder) => builder.everyDays(1).atHour(9).create()),
    ensureClockTrigger('runIntegrityChecks', (builder) => builder.everyDays(1).atHour(2).create()),
  ].filter(Boolean).length
  return {
    createdTriggers: created,
    syncedStaff: staff.length,
    syncedAes: aes.length,
    syncedDoctors: doctors.length,
    syncedServices: services.length,
    syncedChannels: channels.length,
  }
}

export function prepareStaffAeMigrationWorkflow(): {
  staffRows: number
  missingPersonalEmailNames: string[]
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheet = SpreadsheetApp.openById(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
  migrateBookingMasterStaffColumns(spreadsheet)
  migrateConfigStaffProfileColumn(spreadsheet)
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

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId)
  migrateConfigStaffProfileColumn(spreadsheet)
  const sheet = spreadsheet.getSheetByName('CONFIG_STAFF')
  if (!sheet) throw new Error('missing required sheet: CONFIG_STAFF')
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(String)
  if (JSON.stringify(headers) !== JSON.stringify(STAFF_CONFIG_COLUMNS)) {
    throw new Error('sheet header mismatch: CONFIG_STAFF')
  }
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

export function validateProductionFlexMessagesWorkflow(): {
  validatorStatus: 200
  accepted: true
  adminHasProfiles: true
  doctorHasProfiles: true
  adminHasEvidence: true
  doctorHasEvidence: false
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const logoSuffix = '/assets/pmc-flex-logo-v1.png'
  const logoUrl = properties[SCRIPT_PROPERTY_KEYS.brandLogoUrl].trim()
  if (!logoUrl.endsWith(logoSuffix)) throw new Error('brand logo URL has an unexpected path')
  const baseUrl = logoUrl.slice(0, -logoSuffix.length)
  const messages = buildProductionFlexValidationMessages(logoUrl, baseUrl)
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/validate/push', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${properties[SCRIPT_PROPERTY_KEYS.lineAccessToken]}`,
    },
    payload: JSON.stringify({ messages }),
    muteHttpExceptions: true,
  })
  const status = response.getResponseCode()
  if (status !== 200) throw new Error(`LINE Flex validation failed with status ${status}`)
  return {
    validatorStatus: 200,
    accepted: true,
    adminHasProfiles: true,
    doctorHasProfiles: true,
    adminHasEvidence: true,
    doctorHasEvidence: false,
  }
}

export function pauseAndCutoverBookingFormWorkflow(): {
  paused: true
  syncedClosers: number
  syncedAes: number
} {
  const runtime = createRuntime()
  const { activeClosers, activeAes } = validateStaffDirectory(runtime.config.listStaff())
  if (!runtime.forms.bookingCollectsEmail()) throw new Error('booking Form must collect email')
  runtime.forms.pauseBookingResponses()
  runtime.forms.renameAdminFieldToAe()
  runtime.forms.ensureCloserField()
  runtime.forms.syncBookingChoices(
    activeClosers.map((closer) => closer.name),
    activeAes.map((ae) => ae.name),
    runtime.config.listDoctors().filter((doctor) => doctor.active).map((doctor) => doctor.id),
    runtime.config.listServices().filter((service) => service.active).map((service) => service.id),
    runtime.config.listChannels().filter((channel) => channel.active).map((channel) => channel.id),
  )
  return { paused: true, syncedClosers: activeClosers.length, syncedAes: activeAes.length }
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
