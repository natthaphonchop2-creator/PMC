import { createGoogleCalendarPort } from './adapters/googleCalendar'
import { ensureDoctorCalendarEvent } from './adapters/googleCalendar'
import { createGoogleBackupPort, createGoogleDrivePort } from './adapters/googleDrive'
import { ensureCaseEvidenceFolder } from './adapters/googleDrive'
import { createGoogleFilePort } from './adapters/googleFiles'
import {
  bookingFormResponseEvent,
  createGoogleFormsPort,
  parseBookingFormEvent,
} from './adapters/googleForms'
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
import { BOOKING_FORM_LABELS, NO_AE_OPTION } from './config'
import {
  resolveCloserByEmail,
  resolveCloserByName,
  resolveEligibleAeByName,
  validateStaffDirectory,
} from './domain/staffDirectory'
import { staffProfileUrlPlan } from './domain/staffProfileConfig'
import { repairShiftedFacebookBookingRow } from './domain/facebookRowRepair'
import {
  addCalendarMonths,
  addMinutesInBangkok,
  deriveCallWindow,
} from './domain/callSchedule'
import { maskThaiPhone, normalizeCustomerName, normalizeThaiPhone } from './domain/normalize'
import { BOOKING_MASTER_COLUMNS, STAFF_CONFIG_COLUMNS } from './sheetSchema'
import type { CallResult } from './domain/types'
import type { BookingIntake } from './domain/types'
import type { BookingPorts, ChannelConfig, ConfigPort, DoctorConfig, ServiceConfig, StaffConfig } from './ports'
import { createBookingRepositories, type SheetStore } from './repositories'
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
  callQueueUrl: string,
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
    callQueueUrl: () => callQueueUrl,
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
  const callQueueSheet = spreadsheet.getSheetByName('CALL_QUEUE')
  if (!callQueueSheet) throw new Error('missing required sheet: CALL_QUEUE')
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
      `${spreadsheet.getUrl()}#gid=${callQueueSheet.getSheetId()}`,
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

export function repairAndRetryFacebookShiftedCaseWorkflow(caseId: string): {
  caseId: string
  status: string
  calendarState: string
  lineState: string
} {
  if (!/^PMC-\d{6}-\d{4}$/.test(caseId)) throw new Error('invalid repair Case ID')
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheet = SpreadsheetApp.openById(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
  const sheet = spreadsheet.getSheetByName('BOOKING_MASTER')
  if (!sheet) throw new Error('missing BOOKING_MASTER sheet')
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
  if (JSON.stringify(headers) !== JSON.stringify(BOOKING_MASTER_COLUMNS)) {
    throw new Error('BOOKING_MASTER header mismatch')
  }
  const caseIdIndex = headers.indexOf('caseId')
  const formResponseIndex = headers.indexOf('formResponseId')
  const rows = sheet.getLastRow() < 2
    ? []
    : sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
  const offset = rows.findIndex((row) => String(row[caseIdIndex]) === caseId)
  if (offset === -1) throw new Error('repair booking not found')
  const rowNumber = offset + 2
  const currentRow = rows[offset]
  const responseId = String(currentRow[formResponseIndex] ?? '').trim()
  const formResponse = FormApp.openById(properties[SCRIPT_PROPERTY_KEYS.bookingFormId])
    .getResponse(responseId)
  if (!formResponse) throw new Error('repair Form response not found')
  const intake = parseBookingFormEvent(bookingFormResponseEvent({
    response: formResponse,
  } as GoogleAppsScript.Events.FormsOnFormSubmit))
  const index = Object.fromEntries(headers.map((header, position) => [header, position]))
  const runtime = createRuntime()
  const doctor = runtime.config.findDoctor(intake.doctorId)
  const service = runtime.config.findService(intake.serviceId)
  if (!doctor?.active || !service?.active) throw new Error('repair booking config is inactive')
  if (String(currentRow[index.status]) !== 'FORM_SUBMITTED') {
    throw new Error('repair booking status is not FORM_SUBMITTED')
  }
  const expectedStart = `${intake.appointmentDate}T${intake.appointmentTime}:00+07:00`
  const expectedEnd = addMinutesInBangkok(expectedStart, service.durationMinutes)
  const callWindow = deriveCallWindow(expectedStart)
  const previousHeaders = headers.filter((header) => header !== 'facebookName')
  const previousValue = (field: string) => {
    const previousIndex = previousHeaders.indexOf(field)
    if (previousIndex === -1) throw new Error(`repair previous field missing: ${field}`)
    return currentRow[previousIndex]
  }
  const driveFolderId = String(previousValue('driveFolderId') ?? '').trim()
  const driveFolderUrl = String(previousValue('driveFolderUrl') ?? '').trim()
  if (!driveFolderId || !driveFolderUrl) {
    throw new Error('repair booking Drive folder is missing')
  }
  const phoneNormalized = normalizeThaiPhone(intake.phone)
  const repaired = repairShiftedFacebookBookingRow(
    headers,
    currentRow,
    intake.facebookName,
    {
      caseId,
      version: Number(currentRow[index.version]),
      status: 'FORM_SUBMITTED',
      formResponseId: responseId,
      adminId: currentRow[index.adminId],
      adminName: currentRow[index.adminName],
      submitterEmail: intake.submitterEmail,
      adminIdentityStatus: currentRow[index.adminIdentityStatus],
      aeId: currentRow[index.aeId],
      aeName: currentRow[index.aeName],
      queueType: 'NORMAL',
      appointmentStatus: 'CONFIRMED',
      appointmentProposedAt: '',
      appointmentConfirmedAt: intake.submittedAt,
      appointmentConfirmedBy: intake.submitterEmail,
      customerName: intake.customerName.trim(),
      facebookName: intake.facebookName.trim(),
      customerNameNormalized: normalizeCustomerName(intake.customerName),
      phoneNormalized,
      phoneMasked: maskThaiPhone(phoneNormalized),
      doctorId: doctor.id,
      serviceId: service.id,
      channelId: intake.channelId ?? '',
      appointmentStart: expectedStart,
      appointmentEnd: expectedEnd,
      depositAmount: intake.depositAmount,
      depositReceivedAt: intake.submittedAt,
      depositExpiresAt: addCalendarMonths(intake.submittedAt, 6),
      depositStatus: 'VALID',
      driveFolderId,
      driveFolderUrl,
      paymentEvidenceCount: intake.paymentEvidenceFileIds.length,
      chatEvidenceCount: intake.chatEvidenceFileIds.length,
      calendarId: doctor.calendarId,
      calendarEventId: '',
      doctorLineGroupId: doctor.lineGroupId,
      doctorLineNotifiedAt: '',
      callStatus: 'PENDING',
      firstCallWindowStart: callWindow.start,
      firstCallWindowEnd: callWindow.end,
      nextCallAt: `${intake.appointmentDate}T09:00:00+07:00`,
      lastCallAt: '',
      callOwnerAdminId: currentRow[index.adminId],
      jeraPaymentId: '',
      jeraStatus: '',
      jeraClosedAt: '',
      jeraActualRevenue: '',
      jeraImportFileId: '',
      reconciliationStatus: 'NONE',
      commissionEligibility: 'NOT_ELIGIBLE',
      commissionAmount: '',
      driveState: 'OK',
      calendarState: 'PENDING',
      lineState: 'PENDING',
      jeraImportState: 'NOT_IMPORTED',
      createdAt: intake.submittedAt,
      createdBy: intake.submitterEmail,
      updatedAt: runtime.clock.nowIso(),
      updatedBy: 'system',
    },
  )

  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([repaired])
  const readback = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0]
  if (String(readback[index.facebookName] ?? '').trim() !== intake.facebookName.trim()) {
    throw new Error('repair booking readback mismatch')
  }

  runtime.repositories.retries.enqueue({
    id: `RETRY-${caseId}-CALENDAR-FACEBOOK-REPAIR`,
    caseId,
    operation: 'CALENDAR_EVENT',
    idempotencyKey: `${caseId}:CALENDAR_EVENT:FACEBOOK_REPAIR`,
    attempts: 0,
    nextAttemptAt: '',
    status: 'PENDING',
    safeError: '',
    payload: {
      paymentEvidenceFileIds: intake.paymentEvidenceFileIds,
      chatEvidenceFileIds: intake.chatEvidenceFileIds,
    },
  })
  runEligibleRetries(runtime)
  const result = runtime.repositories.bookings.getByCaseId(caseId)
  if (!result) throw new Error('repair booking readback missing')
  return {
    caseId,
    status: result.status,
    calendarState: result.calendarState,
    lineState: result.lineState,
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
  runtime.forms.ensureFacebookNameField()
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

  migrateConfigStaffProfileColumn(spreadsheet)
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

export function validateProductionFlexMessagesWorkflow(): {
  validatorStatus: 200
  accepted: true
  adminHasProfiles: true
  doctorHasProfiles: true
  adminHasEvidence: true
  doctorHasEvidence: false
  callReminderReady: true
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
  if (status !== 200) {
    const propertyPaths = lineValidationPropertyPaths(response.getContentText())
    throw new Error(
      `LINE Flex validation failed with status ${status}` +
      (propertyPaths.length ? ` at ${propertyPaths.join(',')}` : ''),
    )
  }
  return {
    validatorStatus: 200,
    accepted: true,
    adminHasProfiles: true,
    doctorHasProfiles: true,
    adminHasEvidence: true,
    doctorHasEvidence: false,
    callReminderReady: true,
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
  const activeAes = runtime.config.listEligibleAes()
  if (!runtime.forms.bookingCollectsEmail()) throw new Error('booking Form must collect email')
  runtime.forms.configureCompactIdentityFields(activeAes.map((ae) => ae.name))
  if (!runtime.forms.bookingHasCloserField()) throw new Error('booking Form closer field is missing')
  if (!runtime.forms.bookingHasAeField()) throw new Error('booking Form AE field is missing')
  return {
    closerTitle: BOOKING_FORM_LABELS.closerName,
    aeTitle: BOOKING_FORM_LABELS.aeName,
    noAeOption: NO_AE_OPTION,
    aeChoiceCount: activeAes.length + 1,
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
