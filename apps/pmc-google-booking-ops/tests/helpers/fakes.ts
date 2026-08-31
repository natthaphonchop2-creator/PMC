import { createHash, createHmac } from 'node:crypto'
import type { BookingCase, BookingIntake, CallTask } from '../../src/domain/types'
import type {
  BookingPorts,
  CalendarEventInput,
  CalendarPort,
  BookingEvidenceImages,
  DrivePort,
  EvidenceImageRef,
  FilePort,
  LineMessage,
  LinePort,
} from '../../src/ports'
import type { BookingIngressPayload } from '../../src/adapters/lineMessaging'
import type { CalendarInterval } from '../../src/domain/automaticQueue'
import { createBookingRepositories, type SheetRow, type SheetStore } from '../../src/repositories'

class MemorySheetStore implements SheetStore {
  private readonly tabs = new Map<string, SheetRow[]>()

  read(tab: string): SheetRow[] {
    return structuredClone(this.tabs.get(tab) ?? [])
  }

  replace(tab: string, rows: SheetRow[]): void {
    this.tabs.set(tab, structuredClone(rows))
  }

  append(tab: string, rows: SheetRow[]): void {
    this.tabs.set(tab, [...this.read(tab), ...structuredClone(rows)])
  }

  update(tab: string, rowIndex: number, row: SheetRow): void {
    const rows = this.read(tab)
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) {
      throw new Error(`row index out of range: ${tab}`)
    }
    rows[rowIndex] = structuredClone(row)
    this.tabs.set(tab, rows)
  }
}

export function createMemorySheetStore(): SheetStore {
  return new MemorySheetStore()
}

export function createMemoryRepositories(now = '2026-08-20T09:00:00+07:00') {
  return createBookingRepositories(
    createMemorySheetStore(),
    { withLock: (operation) => operation() },
    { nowIso: () => now },
  )
}

export function bookingFixture(patch: Partial<BookingCase> = {}): BookingCase {
  return {
    caseId: 'PMC-202608-0001',
    version: 1,
    status: 'FORM_SUBMITTED',
    formResponseId: 'response-1',
    recorderId: 'admin-1',
    recorderName: 'Admin A',
    recorderSource: 'LEGACY_ASSUMED_ADMIN',
    adminId: 'admin-1',
    adminName: 'Admin A',
    submitterEmail: 'admin@example.com',
    adminIdentityStatus: 'SHARED_ACCOUNT',
    aeId: 'staff-ae',
    aeName: 'เอม',
    queueType: 'NORMAL',
    appointmentStatus: 'CONFIRMED',
    appointmentProposedAt: null,
    appointmentConfirmedAt: null,
    appointmentConfirmedBy: null,
    customerName: 'ลูกค้าทดสอบ',
    customerNameNormalized: 'ลูกค้าทดสอบ',
    facebookName: 'PMC Beauty',
    phoneNormalized: '0812345678',
    phoneMasked: '081-xxx-5678',
    doctorId: 'doctor-1',
    serviceId: 'service-1',
    channelId: null,
    appointmentStart: '2026-08-20T13:00:00+07:00',
    appointmentEnd: '2026-08-20T14:00:00+07:00',
    depositAmount: 1000,
    depositReceivedAt: '2026-08-20T09:00:00+07:00',
    depositExpiresAt: '2027-02-20T09:00:00+07:00',
    depositStatus: 'VALID',
    driveFolderId: null,
    driveFolderUrl: null,
    paymentEvidenceCount: 1,
    chatEvidenceCount: 1,
    calendarId: null,
    calendarEventId: null,
    doctorLineGroupId: null,
    doctorLineNotifiedAt: null,
    callStatus: 'PENDING',
    firstCallWindowStart: '2026-08-20T00:00:00+07:00',
    firstCallWindowEnd: '2026-08-27T23:59:59+07:00',
    nextCallAt: '2026-08-20T09:00:00+07:00',
    lastCallAt: null,
    callOwnerAdminId: 'admin-1',
    jeraPaymentId: null,
    jeraStatus: null,
    jeraClosedAt: null,
    jeraActualRevenue: null,
    jeraImportFileId: null,
    reconciliationStatus: 'NONE',
    commissionEligibility: 'NOT_ELIGIBLE',
    commissionAmount: null,
    driveState: 'PENDING',
    calendarState: 'PENDING',
    lineState: 'PENDING',
    jeraImportState: 'NOT_IMPORTED',
    createdAt: '2026-08-20T09:00:00+07:00',
    createdBy: 'admin@example.com',
    updatedAt: '2026-08-20T09:00:00+07:00',
    updatedBy: 'admin@example.com',
    ...patch,
  }
}

export function evidenceFixture(input: {
  paymentCount: number
  chatCount: number
}): BookingEvidenceImages {
  const ref = (kind: 'payment' | 'chat', index: number): EvidenceImageRef => ({
    previewUrl: `https://media.test/${kind}-${index + 1}/preview`,
    fullUrl: `https://media.test/${kind}-${index + 1}/full`,
  })
  return {
    payments: Array.from({ length: input.paymentCount }, (_, index) => ref('payment', index)),
    chats: Array.from({ length: input.chatCount }, (_, index) => ref('chat', index)),
    totalPaymentCount: input.paymentCount,
    totalChatCount: input.chatCount,
  }
}

export interface TestPorts extends BookingPorts {
  bookings: ReturnType<typeof createMemoryRepositories>['bookings']
  drive: FakeDrivePort
  calendar: FakeCalendarPort
  line: FakeLinePort
  lineDirectory: ReturnType<typeof createMemoryRepositories>['lineDirectory']
  calls: ReturnType<typeof createMemoryRepositories>['calls'] & {
    insertFixture(patch?: Partial<CallTask>): CallTask
  }
  imports: ReturnType<typeof createMemoryRepositories>['imports']
  reconciliation: ReturnType<typeof createMemoryRepositories>['reconciliation']
  retention: ReturnType<typeof createMemoryRepositories>['retention']
  retries: ReturnType<typeof createMemoryRepositories>['retries']
  bookingFixture(patch?: Partial<BookingCase>): BookingCase
  seedIntegrityFailures(): void
  dashboard: FakeDashboardPort
  backups: FakeBackupPort
  signedBookingIngressFixture(sourceType: 'user' | 'group', sourceId: string): BookingIngressPayload
  files: FakeFilePort
}

export interface TestPortOptions {
  calendarConflicts?: boolean
  calendarCreateFails?: boolean
  lineDirectoryCaptureEnabled?: boolean
  now?: string
  jeraPhone?: string
  linePushFails?: boolean
  lineFailsAtPush?: number
  mediaSigningFailsOnce?: boolean
  extraDriveFileIds?: string[]
  calendarEvents?: CalendarInterval[]
  calendarUpdateResult?: 'UPDATED' | 'NOT_FOUND'
  calendarListFails?: boolean
  driveMoveFailsOnce?: boolean
}

export function createTestPorts(options: TestPortOptions = {}): TestPorts {
  const now = options.now ?? '2026-08-20T09:00:00+07:00'
  const repositories = createMemoryRepositories(now)
  const ingressSecret = 'ingress-secret'
  return {
    clock: { nowIso: () => now },
    locks: { withLock: (operation) => operation() },
    config: {
      findCloserByEmail: (email) =>
        email.trim().toLowerCase() === 'admin@example.com'
          ? {
              id: 'admin-1',
              name: 'Admin A',
              email: 'admin@example.com',
              lineUserId: 'admin-user-1',
              canCloseBooking: true,
              canBeAe: true,
              canManageStock: false,
              canSubmitExpense: false,
              canViewFinance: false,
              canManageExpense: false,
              active: true,
            }
          : null,
      findCloserByName: (name) =>
        name === 'Admin A'
          ? {
              id: 'admin-1',
              name: 'Admin A',
              email: 'admin@example.com',
              lineUserId: 'admin-user-1',
              canCloseBooking: true,
              canBeAe: true,
              canManageStock: false,
              canSubmitExpense: false,
              canViewFinance: false,
              canManageExpense: false,
              active: true,
            }
          : null,
      isSharedCloserEmail: () => false,
      findEligibleAeByName: (name) =>
        name === 'Admin A'
          ? {
              id: 'admin-1',
              name: 'Admin A',
              email: 'admin@example.com',
              lineUserId: 'admin-user-1',
              canCloseBooking: true,
              canBeAe: true,
              canManageStock: false,
              canSubmitExpense: false,
              canViewFinance: false,
              canManageExpense: false,
              active: true,
            }
          : name === 'เอม'
            ? {
                id: 'staff-ae',
                name: 'เอม',
                email: '',
                lineUserId: '',
                canCloseBooking: false,
                canBeAe: true,
                canManageStock: false,
                canSubmitExpense: false,
                canViewFinance: false,
                canManageExpense: false,
                active: true,
              }
            : null,
      findStaffById: (id) =>
        id === 'admin-1'
          ? {
              id: 'admin-1',
              name: 'Admin A',
              email: 'admin@example.com',
              lineUserId: 'admin-user-1',
              canCloseBooking: true,
              canBeAe: true,
              canManageStock: false,
              canSubmitExpense: false,
              canViewFinance: false,
              canManageExpense: false,
              active: true,
            }
          : id === 'staff-ae'
            ? {
                id: 'staff-ae',
                name: 'เอม',
                email: '',
                lineUserId: '',
                canCloseBooking: false,
                canBeAe: true,
                canManageStock: false,
                canSubmitExpense: false,
                canViewFinance: false,
                canManageExpense: false,
                active: true,
              }
            : null,
      listStaff: () => [
        {
          id: 'admin-1',
          name: 'Admin A',
          email: 'admin@example.com',
          lineUserId: 'admin-user-1',
          canCloseBooking: true,
          canBeAe: true,
          canManageStock: false,
          canSubmitExpense: false,
          canViewFinance: false,
          canManageExpense: false,
          active: true,
        },
        {
          id: 'staff-ae',
          name: 'เอม',
          email: '',
          lineUserId: '',
          canCloseBooking: false,
          canBeAe: true,
          canManageStock: false,
          canSubmitExpense: false,
          canViewFinance: false,
          canManageExpense: false,
          active: true,
        },
      ],
      listEligibleAes: () => [
        {
          id: 'admin-1',
          name: 'Admin A',
          email: 'admin@example.com',
          lineUserId: 'admin-user-1',
          canCloseBooking: true,
          canBeAe: true,
          canManageStock: false,
          canSubmitExpense: false,
          canViewFinance: false,
          canManageExpense: false,
          active: true,
        },
        {
          id: 'staff-ae',
          name: 'เอม',
          email: '',
          lineUserId: '',
          canCloseBooking: false,
          canBeAe: true,
          canManageStock: false,
          canSubmitExpense: false,
          canViewFinance: false,
          canManageExpense: false,
          active: true,
        },
      ],
      findDoctor: (id) =>
        id === 'doctor-1'
          ? { id: 'doctor-1', name: 'Doctor One', calendarId: 'doctor-calendar-1', lineGroupId: 'doctor-group-1', active: true }
          : id === 'doctor-2'
            ? { id: 'doctor-2', name: 'Doctor Two', calendarId: 'doctor-calendar-2', lineGroupId: 'doctor-group-2', active: true }
            : null,
      findService: (id) =>
        id === 'service-1' ? { id: 'service-1', name: 'Service One', durationMinutes: 60, active: true } : null,
      findChannel: (id) =>
        id === 'เพจหลัก' ? { id: 'เพจหลัก', name: 'เพจหลัก', active: true } : null,
      adminLineGroupId: () => 'admin-group',
      brandLogoUrl: () => 'https://evidence.example/assets/pmc-flex-logo-v1.png',
      callQueueUrl: () => 'https://docs.google.com/spreadsheets/d/test/edit#gid=CALL_QUEUE',
      listDoctors: () => [
        { id: 'doctor-1', name: 'Doctor One', calendarId: 'doctor-calendar-1', lineGroupId: 'doctor-group-1', active: true },
        { id: 'doctor-2', name: 'Doctor Two', calendarId: 'doctor-calendar-2', lineGroupId: 'doctor-group-2', active: true },
      ],
      listServices: () => [
        { id: 'service-1', name: 'Service One', durationMinutes: 60, active: true },
      ],
      listChannels: () => [{ id: 'เพจหลัก', name: 'เพจหลัก', active: true }],
      ruleValue: (key) => key === 'MINI_APP_DRAFT_TTL_HOURS' ? '24' : null,
    },
    repositories,
    miniAppRequests: {
      list: () => [],
      getByRequestId: () => null,
      updateByRequestId: () => { throw new Error('mini app request not configured') },
    },
    bookings: repositories.bookings,
    calls: Object.assign(repositories.calls, {
      insertFixture(patch: Partial<CallTask> = {}) {
        return repositories.calls.insert(callTaskFixture(patch))
      },
    }),
    imports: repositories.imports,
    reconciliation: repositories.reconciliation,
    retention: repositories.retention,
    retries: repositories.retries,
    lineDirectory: repositories.lineDirectory,
    drive: createFakeDrive(options.extraDriveFileIds, options.driveMoveFailsOnce),
    calendar: createFakeCalendar(options),
    line: createFakeLine(options.linePushFails ?? false, options.lineFailsAtPush),
    forms: {
      syncBookingChoices: () => undefined,
      syncCallResultChoices: () => undefined,
      bookingCollectsEmail: () => true,
      bookingHasCloserField: () => true,
      bookingHasAeField: () => true,
      bookingHasFacebookNameField: () => true,
      pauseBookingResponses: () => undefined,
      ensureCloserField: () => undefined,
      renameAdminFieldToAe: () => undefined,
      configureCompactIdentityFields: () => undefined,
      ensureFacebookNameField: () => undefined,
      resumeBookingResponses: () => undefined,
      callResultPrefillUrl: (caseId) =>
        `https://docs.google.com/forms/d/e/test/viewform?case=${encodeURIComponent(caseId)}`,
      queueConfirmationUrl: ({ caseId, action, appointmentDate, appointmentTime }) =>
        `https://forms.test/queue?case=${caseId}&action=${action}&date=${appointmentDate ?? ''}&time=${appointmentTime ?? ''}`,
      ensureQueueConfirmationForm: () => ({ confirmationFormReady: true }),
      configureQueueModeForm: () => ({ queueQuestionReady: true }),
    },
    files: createFakeFiles(options.jeraPhone ?? '0812345678'),
    secrets: {
      lineAccessToken: () => 'line-access-token',
      bookingIngressSecret: () => ingressSecret,
      lineDirectoryCaptureEnabled: () => options.lineDirectoryCaptureEnabled ?? false,
    },
    crypto: {
      hmacSha256Hex: (value, secret) => createHmac('sha256', secret).update(value).digest('hex'),
      sha256Hex: (value) => createHash('sha256').update(value).digest('hex'),
      sha256BytesHex: (value) => createHash('sha256').update(Buffer.from(value)).digest('hex'),
      sha256Base64Url: (value) => createHash('sha256').update(value).digest('base64url'),
      base64UrlUtf8: (value) => Buffer.from(value, 'utf8').toString('base64url'),
      base64Decode: (value) => [...Buffer.from(value, 'base64')],
    },
    media: (() => {
      let shouldFail = options.mediaSigningFailsOnce ?? false
      return {
      images(caseId, paymentFileIds, chatFileIds) {
        if (shouldFail) {
          shouldFail = false
          throw new Error('evidence signer unavailable')
        }
        const ref = (fileId: string, variant: 'preview' | 'full') =>
          `https://media.test/${caseId}/${fileId}/${variant}`
        return {
          payments: paymentFileIds.map((fileId) => ({
            previewUrl: ref(fileId, 'preview'),
            fullUrl: ref(fileId, 'full'),
          })),
          chats: chatFileIds.map((fileId) => ({
            previewUrl: ref(fileId, 'preview'),
            fullUrl: ref(fileId, 'full'),
          })),
          totalPaymentCount: paymentFileIds.length,
          totalChatCount: chatFileIds.length,
        }
      },
      }
    })(),
    dashboard: createFakeDashboard(),
    backups: createFakeBackups(),
    signedBookingIngressFixture(sourceType, sourceId) {
      const timestamp = Math.floor(Date.parse(now) / 1000)
      const nonce = 'nonce-1'
      const canonical = `${timestamp}.${nonce}.${sourceType}.${sourceId}`
      return {
        timestamp,
        nonce,
        sourceType,
        sourceId,
        signature: createHmac('sha256', ingressSecret).update(canonical).digest('hex'),
      }
    },
    bookingFixture,
    seedIntegrityFailures() {
      repositories.bookings.insert(
        bookingFixture({ status: 'CLOSED_JERA', jeraPaymentId: 'PAY-DUP', callStatus: 'ACTIVE' }),
      )
      repositories.bookings.insert(
        bookingFixture({
          caseId: 'PMC-202608-0002',
          formResponseId: 'response-2',
          status: 'CLOSED_JERA',
          jeraPaymentId: 'PAY-DUP',
        }),
      )
      repositories.calls.insert(callTaskFixture())
    },
  }
}

export interface FakeDashboardPort {
  write(snapshot: { kpis: Record<string, number>; operations: Array<Record<string, string | number | null>> }): void
  lastSnapshot(): { kpis: Record<string, number>; operations: Array<Record<string, string | number | null>> } | null
}

function createFakeDashboard(): FakeDashboardPort {
  let snapshot: ReturnType<FakeDashboardPort['lastSnapshot']> = null
  return {
    write(value) {
      snapshot = structuredClone(value)
    },
    lastSnapshot: () => structuredClone(snapshot),
  }
}

export interface FakeBackupPort {
  hasBackup(date: string): boolean
  createBackup(date: string): void
  createdDates(): string[]
}

function createFakeBackups(): FakeBackupPort {
  const dates: string[] = []
  return {
    hasBackup: (date) => dates.includes(date),
    createBackup(date) {
      if (!dates.includes(date)) dates.push(date)
    },
    createdDates: () => [...dates],
  }
}

export function jeraReportFixture(phone = '0812345678'): string {
  return [
    'รายงานยอดขาย:',
    'ช่วงวันที่\t2026-08-19',
    [
      'วันที่',
      'เวลา',
      'รหัสใบชำระเงิน',
      'ผู้ป่วย',
      'HN',
      'มือถือ',
      'สถานะ',
      'ยอดเงินที่ได้รับจริง',
    ].join('\t'),
    ['2026-08-19', '10:00:00', 'PAY-001', 'สมหญิง ใจดี', 'HN-001', phone, 'ชำระแล้ว', '5000'].join('\t'),
    ['รายละเอียดบริการ', '1', '5000'].join('\t'),
    ['2026-08-19', '11:00', 'PAY-002', 'ลูกค้าคืนเงิน', 'HN-002', '0899999999', 'คืนมัดจำ', '-1000'].join('\t'),
    'รวม\t4000',
  ].join('\n')
}

function jeraImportFixture(phone: string): string {
  return jeraReportFixture(phone).split('\n').slice(0, 5).join('\n')
}

export interface FakeFilePort extends FilePort {
  importedFileIds(): string[]
  quarantinedFileIds(): string[]
}

export function createFakeFiles(phone: string): FakeFilePort {
  const text = jeraImportFixture(phone)
  const incoming = ['jera-file-1', 'jera-file-1-copy']
  const imported: string[] = []
  const quarantined: string[] = []
  return {
    readText(fileId) {
      if (!incoming.includes(fileId)) throw new Error('file not found')
      return text
    },
    listIncomingFileIds: () => [...incoming],
    moveToImported(fileId) {
      if (!imported.includes(fileId)) imported.push(fileId)
    },
    quarantine(fileId) {
      if (!quarantined.includes(fileId)) quarantined.push(fileId)
    },
    importedFileIds: () => [...imported],
    quarantinedFileIds: () => [...quarantined],
  }
}

export function callTaskFixture(patch: Partial<CallTask> = {}): CallTask {
  return {
    taskId: 'CALL-PMC-202608-0001-1',
    caseId: 'PMC-202608-0001',
    ownerAdminId: 'admin-1',
    status: 'PENDING',
    windowStart: '2026-08-20T00:00:00+07:00',
    windowEnd: '2026-08-27T23:59:59+07:00',
    nextCallAt: '2026-08-20T09:00:00+07:00',
    lastReminderDate: null,
    result: null,
    note: '',
    version: 1,
    ...patch,
  }
}

export interface FakeLinePort extends LinePort {
  doctorMessages(): LineMessage[]
  adminMessages(): LineMessage[]
  allowPushes(): void
}

export function createFakeLine(initiallyFailing = false, initialFailAtPush?: number): FakeLinePort {
  const messages: LineMessage[] = []
  const acceptedRetryKeys = new Set<string>()
  let failing = initiallyFailing
  let failAtPush = initialFailAtPush
  let attempts = 0
  return {
    push(message) {
      attempts += 1
      if (acceptedRetryKeys.has(message.retryKey)) return
      if (failAtPush === attempts) {
        failAtPush = undefined
        throw new Error('LINE push failed with status 500')
      }
      if (failing) throw new Error('LINE push failed with status 500')
      acceptedRetryKeys.add(message.retryKey)
      messages.push(structuredClone(message))
    },
    doctorMessages: () => structuredClone(messages.filter((message) => message.audience === 'doctor')),
    adminMessages: () => structuredClone(messages.filter((message) => message.audience === 'admin')),
    allowPushes() {
      failing = false
      failAtPush = undefined
    },
  }
}

export interface FakeCalendarPort extends CalendarPort {
  createdEvents(): CalendarEventInput[]
  updatedEvents(): Array<{ eventId: string; input: CalendarEventInput }>
  allowCreates(): void
}

export function createFakeCalendar(options: TestPortOptions = {}): FakeCalendarPort {
  const created: CalendarEventInput[] = []
  const updated: Array<{ eventId: string; input: CalendarEventInput }> = []
  let createFails = options.calendarCreateFails ?? false
  return {
    hasConflict: () => options.calendarConflicts ?? false,
    listEvents: () => {
      if (options.calendarListFails) throw new Error('Calendar list failed')
      return structuredClone(options.calendarEvents ?? [])
    },
    createEvent(input) {
      if (createFails) throw new Error('Calendar create failed')
      created.push(structuredClone(input))
      return `event-${input.externalId}`
    },
    updateEvent(eventId, input) {
      updated.push({ eventId, input: structuredClone(input) })
      return options.calendarUpdateResult ?? 'UPDATED'
    },
    createdEvents: () => structuredClone(created),
    updatedEvents: () => structuredClone(updated),
    allowCreates() {
      createFails = false
    },
  }
}

export function validBookingIntake(patch: Partial<BookingIntake> = {}): BookingIntake {
  return {
    queueType: 'NORMAL',
    formResponseId: 'response-1',
    submittedAt: '2026-08-20T09:00:00+07:00',
    submitterEmail: 'admin@example.com',
    closerName: 'Admin A',
    aeName: 'Admin A',
    customerName: 'ลูกค้าทดสอบ',
    facebookName: 'PMC Beauty',
    phone: '0812345678',
    doctorId: 'doctor-1',
    serviceId: 'service-1',
    appointmentDate: '2026-08-20',
    appointmentTime: '13:00',
    depositAmount: 1000,
    channelId: null,
    paymentEvidenceFileIds: ['payment-file-1'],
    chatEvidenceFileIds: ['chat-file-1'],
    ...patch,
  }
}

export interface FakeDrivePort extends DrivePort {
  createdFolderCount(): number
  createdEvidenceFileIds(): string[]
  createdEvidenceFiles(): Array<{ id: string; folderId: string; name: string; mimeType: string; marker: string | null }>
  seedEvidenceFile(input: { id: string; folderId: string; name: string; mimeType: string; marker: string | null }): void
  movedFileCount(): number
  publicLinks(): string[]
  trashedFolderIds(): string[]
  allowMoves(): void
}

export function createFakeDrive(
  extraFileIds: string[] = [],
  initiallyFailing = false,
): FakeDrivePort {
  const folders = new Map<string, { parentId: string; name: string; marker: string }>()
  const files = new Map<string, { name: string; folderId: string | null; mimeType?: string; marker?: string | null }>([
    ['payment-file-1', { name: 'payment.jpg', folderId: null }],
    ['chat-file-1', { name: 'chat.jpg', folderId: null }],
    ['chat-file-2', { name: 'chat.png', folderId: null }],
    ...extraFileIds.map((fileId, index) => [
      fileId,
      { name: `evidence-${index + 1}.jpg`, folderId: null },
    ] as const),
  ])
  let moved = 0
  let moveFails = initiallyFailing
  const trashed: string[] = []
  const createdEvidence: string[] = []

  return {
    rootFolderId: () => 'drive-root',
    ensureChildFolder(parentId, name, marker) {
      const existing = [...folders.entries()].find(
        ([, folder]) => folder.parentId === parentId && folder.name === name && folder.marker === marker,
      )
      if (existing) return { id: existing[0], name }
      const id = `folder-${folders.size + 1}`
      folders.set(id, { parentId, name, marker })
      return { id, name }
    },
    createEvidenceFile(folderId, name, mimeType, bytes, marker?: string) {
      void bytes
      const id = `uploaded-evidence-${createdEvidence.length + 1}`
      files.set(id, { name, folderId, mimeType, marker: marker ?? null })
      createdEvidence.push(id)
      return id
    },
    fileName(fileId) {
      const file = files.get(fileId)
      if (!file) throw new Error('file not found')
      return file.name
    },
    findFileByName(folderId, name) {
      return [...files.entries()].find(([, file]) => file.folderId === folderId && file.name === name)?.[0] ?? null
    },
    findEvidenceFile(folderId, name, mimeType, marker) {
      const matches = [...files.entries()].filter(([, file]) => file.folderId === folderId && file.name === name
        && file.mimeType === mimeType && file.marker === marker)
      if (matches.length > 1) throw new Error('duplicate exact evidence file')
      return matches[0]?.[0] ?? null
    },
    moveAndRenameFile(fileId, folderId, name) {
      if (moveFails) throw new Error('Drive move failed')
      const file = files.get(fileId)
      if (!file) throw new Error('file not found')
      file.folderId = folderId
      file.name = name
      moved += 1
      return fileId
    },
    folderUrl: (folderId) => `https://drive.google.com/drive/folders/${folderId}`,
    trashFolder(folderId) {
      if (!trashed.includes(folderId)) trashed.push(folderId)
    },
    createdFolderCount: () => folders.size,
    createdEvidenceFileIds: () => [...createdEvidence],
    createdEvidenceFiles: () => createdEvidence.map((id) => {
      const file = files.get(id)!
      return { id, folderId: file.folderId!, name: file.name, mimeType: file.mimeType!, marker: file.marker ?? null }
    }),
    seedEvidenceFile(input) {
      files.set(input.id, {
        folderId: input.folderId, name: input.name, mimeType: input.mimeType, marker: input.marker,
      })
    },
    movedFileCount: () => moved,
    publicLinks: () => [],
    trashedFolderIds: () => [...trashed],
    allowMoves() {
      moveFails = false
    },
  }
}
