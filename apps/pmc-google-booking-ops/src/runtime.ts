import { createGoogleCalendarPort } from './adapters/googleCalendar'
import { ensureDoctorCalendarEvent } from './adapters/googleCalendar'
import { createGoogleBackupPort, createGoogleDrivePort } from './adapters/googleDrive'
import { ensureCaseEvidenceFolder } from './adapters/googleDrive'
import { createGoogleFilePort } from './adapters/googleFiles'
import { createGoogleFormsPort } from './adapters/googleForms'
import { createAppsScriptCryptoPort, createGoogleLinePort, sendBookingConfirmationMessages } from './adapters/lineMessaging'
import { sendDoctorBookingMessage } from './adapters/lineMessaging'
import { createGoogleDashboardPort, createGoogleSheetStore, ensureSheetTopology } from './adapters/googleSheets'
import { SCRIPT_PROPERTY_KEYS } from './config'
import type { CallResult } from './domain/types'
import type { BookingIntake } from './domain/types'
import type { AdminConfig, BookingPorts, ChannelConfig, ConfigPort, DoctorConfig, ServiceConfig } from './ports'
import { createBookingRepositories, type SheetStore } from './repositories'
import { runDailyCallReminders, runDailyDoctorSchedules, runDepositExpiryReminders } from './workflows/callQueue'
import { writeDashboard } from './workflows/dashboard'
import { createDailyBackup, runIntegrityReport } from './workflows/integrity'
import { queueEvidenceRetention } from './workflows/retention'

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
] as const

export function validateRuntimeProperties(properties: Record<string, string | undefined>): void {
  const missing = REQUIRED_PROPERTIES.filter((key) => !properties[key]?.trim())
  if (missing.length) throw new Error(`Missing Script Properties: ${missing.join(', ')}`)
}

function isActive(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'
}

function createConfigPort(store: SheetStore, adminLineGroupId: string): ConfigPort {
  const admins = (): AdminConfig[] =>
    store.read('CONFIG_ADMINS').map((row) => ({
      id: String(row.id),
      name: String(row.name),
      email: String(row.email).toLowerCase(),
      lineUserId: String(row.lineUserId),
      active: isActive(row.active),
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
    findAdminByName: (name) => admins().find((admin) => admin.name === name) ?? null,
    findAdminById: (id) => admins().find((admin) => admin.id === id) ?? null,
    findDoctor: (id) => doctors().find((doctor) => doctor.id === id) ?? null,
    findService: (id) => services().find((service) => service.id === id) ?? null,
    findChannel: (id) => channels().find((channel) => channel.id === id) ?? null,
    adminLineGroupId: () => adminLineGroupId,
    listAdmins: admins,
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
    config: createConfigPort(store, properties[SCRIPT_PROPERTY_KEYS.adminLineGroupId]),
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
    crypto: createAppsScriptCryptoPort(),
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
        sendBookingConfirmationMessages(booking, ports.line, ports.config.adminLineGroupId())
        ports.repositories.bookings.update(
          caseId,
          booking.version,
          { lineState: 'OK', doctorLineNotifiedAt: ports.clock.nowIso() },
          { actor: 'system', reason: 'LINE retry succeeded', correlationId: id },
        )
      } else if (operation === 'DOCTOR_LINE' || operation === 'DOCTOR_LINE_RESCHEDULE') {
        sendDoctorBookingMessage(booking, ports.line, operation === 'DOCTOR_LINE_RESCHEDULE' ? 'RESCHEDULED' : 'BOOKING_CONFIRMED')
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
          adminName: booking.adminName,
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

export function isConfigurationReady(counts: { admins: number; doctors: number; services: number }): boolean {
  return counts.admins > 0 && counts.doctors > 0 && counts.services > 0
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
  syncedAdmins: number
  syncedDoctors: number
  syncedServices: number
  syncedChannels: number
} {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheet = SpreadsheetApp.openById(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
  ensureSheetTopology(spreadsheet)
  const runtime = createRuntime()
  const admins = runtime.config.listAdmins().filter((admin) => admin.active)
  const doctors = runtime.config.listDoctors().filter((doctor) => doctor.active)
  const services = runtime.config.listServices().filter((service) => service.active)
  const channels = runtime.config.listChannels().filter((channel) => channel.active)
  if (!isConfigurationReady({ admins: admins.length, doctors: doctors.length, services: services.length })) {
    return {
      createdTriggers: 0,
      syncedAdmins: admins.length,
      syncedDoctors: doctors.length,
      syncedServices: services.length,
      syncedChannels: channels.length,
    }
  }
  runtime.forms.syncBookingChoices(
    admins.map((admin) => admin.name),
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
    syncedAdmins: admins.length,
    syncedDoctors: doctors.length,
    syncedServices: services.length,
    syncedChannels: channels.length,
  }
}
