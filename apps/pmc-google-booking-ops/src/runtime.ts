import { createGoogleCalendarPort } from './adapters/googleCalendar'
import { calendarEventInput, ensureDoctorCalendarEvent } from './adapters/googleCalendar'
import { createGoogleBackupPort, createGoogleDrivePort } from './adapters/googleDrive'
import { ensureCaseEvidenceFolder } from './adapters/googleDrive'
import { createGoogleFilePort } from './adapters/googleFiles'
import {
  createGoogleFormsPort,
} from './adapters/googleForms'
import { createEvidenceMediaPort } from './adapters/evidenceMedia'
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
import { migrateAppointmentRows } from './domain/appointmentMigration'
import { STAFF_CONFIG_COLUMNS } from './sheetSchema'
import type { CallResult } from './domain/types'
import type { BookingIntake } from './domain/types'
import type { BookingPorts, ChannelConfig, ConfigPort, DoctorConfig, ServiceConfig, StaffConfig } from './ports'
import {
  createBookingRepositories,
  createStockRepository,
  type SheetRow,
  type SheetStore,
} from './repositories'
import { canonicalMiniAppStockCommand } from '../../../shared/pmcMiniAppStockIngress'
import {
  configureStockManagers,
  type StockIngressPorts,
} from './stock/ingress'
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
import { prepareAutomaticQueue } from './workflows/automaticQueue'

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
      canManageStock: isActive(row.canManageStock),
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

export function createRuntime(): BookingPorts & StockIngressPorts {
  const properties = PropertiesService.getScriptProperties().getProperties()
  validateRuntimeProperties(properties)
  const spreadsheet = SpreadsheetApp.openById(properties[SCRIPT_PROPERTY_KEYS.spreadsheetId])
  const callQueueSheet = spreadsheet.getSheetByName('CALL_QUEUE')
  if (!callQueueSheet) throw new Error('missing required sheet: CALL_QUEUE')
  const store = createGoogleSheetStore(spreadsheet)
  const clock = { nowIso: bangkokNow }
  const crypto = createAppsScriptCryptoPort()
  const stock = createStockRepository(store)
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
    stock,
    commandFingerprint: (command) => crypto.sha256Hex(canonicalMiniAppStockCommand(command)),
    allocateId: (prefix) => `${prefix}-${Utilities.getUuid()}`,
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
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(String)
  if (JSON.stringify(headers) !== JSON.stringify(STAFF_CONFIG_COLUMNS)) {
    throw new Error('sheet header mismatch: CONFIG_STAFF')
  }
  const source = createGoogleSheetStore(spreadsheet)
  const managerColumn = STAFF_CONFIG_COLUMNS.indexOf('canManageStock') + 1
  return configureStockManagers({
    read: (tab) => source.read(tab),
    replace(tab, rows) {
      if (tab !== 'CONFIG_STAFF') throw new Error('unexpected Stock manager tab')
      const rowCount = sheet.getLastRow() - 1
      if (rows.length !== rowCount) throw new Error('CONFIG_STAFF row count changed')
      const expected = rows.map((row) => [row.canManageStock === true])
      sheet.getRange(2, managerColumn, rowCount, 1).setValues(expected)
      const readback = sheet.getRange(2, managerColumn, rowCount, 1).getValues()
      if (readback.some(([value], index) => value !== expected[index][0])) {
        throw new Error('PMC Stock manager readback mismatch')
      }
    },
  })
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
    const createdTrigger = ensureFormTrigger('onQueueConfirmationSubmit', confirmationFormId)
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
    (trigger) => trigger.getHandlerFunction() === 'onQueueConfirmationSubmit',
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
  migrateConfigStaffProfileColumn(spreadsheet)
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
  migrateConfigStaffProfileColumn(spreadsheet)
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
