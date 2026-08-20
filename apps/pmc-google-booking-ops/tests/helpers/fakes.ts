import { createHash, createHmac } from 'node:crypto'
import type { BookingCase, BookingIntake } from '../../src/domain/types'
import type { BookingPorts, CalendarEventInput, CalendarPort, DrivePort, LineMessage, LinePort } from '../../src/ports'
import type { BookingIngressPayload } from '../../src/adapters/lineMessaging'
import { createBookingRepositories, type SheetRow, type SheetStore } from '../../src/repositories'

class MemorySheetStore implements SheetStore {
  private readonly tabs = new Map<string, SheetRow[]>()

  read(tab: string): SheetRow[] {
    return structuredClone(this.tabs.get(tab) ?? [])
  }

  replace(tab: string, rows: SheetRow[]): void {
    this.tabs.set(tab, structuredClone(rows))
  }
}

export function createMemoryRepositories() {
  return createBookingRepositories(
    new MemorySheetStore(),
    { withLock: (operation) => operation() },
    { nowIso: () => '2026-08-20T09:00:00+07:00' },
  )
}

export function bookingFixture(patch: Partial<BookingCase> = {}): BookingCase {
  return {
    caseId: 'PMC-202608-0001',
    version: 1,
    status: 'FORM_SUBMITTED',
    formResponseId: 'response-1',
    adminId: 'admin-1',
    adminName: 'Admin A',
    submitterEmail: 'admin@example.com',
    adminIdentityStatus: 'MATCHED',
    customerName: 'ลูกค้าทดสอบ',
    customerNameNormalized: 'ลูกค้าทดสอบ',
    phoneNormalized: '0812345678',
    phoneMasked: '081-xxx-5678',
    doctorId: 'doctor-1',
    serviceId: 'service-1',
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

export interface TestPorts extends BookingPorts {
  bookings: ReturnType<typeof createMemoryRepositories>['bookings']
  calendar: FakeCalendarPort
  line: FakeLinePort
  lineDirectory: ReturnType<typeof createMemoryRepositories>['lineDirectory']
  signedBookingIngressFixture(sourceType: 'user' | 'group', sourceId: string): BookingIngressPayload
}

export interface TestPortOptions {
  calendarConflicts?: boolean
  calendarCreateFails?: boolean
  lineDirectoryCaptureEnabled?: boolean
  now?: string
}

export function createTestPorts(options: TestPortOptions = {}): TestPorts {
  const repositories = createMemoryRepositories()
  const now = options.now ?? '2026-08-20T09:00:00+07:00'
  const ingressSecret = 'ingress-secret'
  return {
    clock: { nowIso: () => now },
    locks: { withLock: (operation) => operation() },
    config: {
      findAdminByName: (name) =>
        name === 'Admin A'
          ? { id: 'admin-1', name: 'Admin A', email: 'admin@example.com', lineUserId: 'admin-user-1', active: true }
          : null,
      findDoctor: (id) =>
        id === 'doctor-1'
          ? { id: 'doctor-1', name: 'Doctor One', calendarId: 'doctor-calendar-1', lineGroupId: 'doctor-group-1', active: true }
          : null,
      findService: (id) =>
        id === 'service-1' ? { id: 'service-1', name: 'Service One', durationMinutes: 60, active: true } : null,
    },
    repositories,
    bookings: repositories.bookings,
    lineDirectory: repositories.lineDirectory,
    drive: createFakeDrive(),
    calendar: createFakeCalendar(options),
    line: createFakeLine(),
    forms: {},
    files: {},
    secrets: {
      lineAccessToken: () => 'line-access-token',
      bookingIngressSecret: () => ingressSecret,
      lineDirectoryCaptureEnabled: () => options.lineDirectoryCaptureEnabled ?? false,
    },
    crypto: {
      hmacSha256Hex: (value, secret) => createHmac('sha256', secret).update(value).digest('hex'),
      sha256Hex: (value) => createHash('sha256').update(value).digest('hex'),
    },
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
  }
}

export interface FakeLinePort extends LinePort {
  doctorMessages(): LineMessage[]
  adminMessages(): LineMessage[]
}

export function createFakeLine(): FakeLinePort {
  const messages: LineMessage[] = []
  return {
    push(message) {
      messages.push(structuredClone(message))
    },
    doctorMessages: () => structuredClone(messages.filter((message) => message.audience === 'doctor')),
    adminMessages: () => structuredClone(messages.filter((message) => message.audience === 'admin')),
  }
}

export interface FakeCalendarPort extends CalendarPort {
  createdEvents(): CalendarEventInput[]
  updatedEvents(): Array<{ eventId: string; input: CalendarEventInput }>
}

export function createFakeCalendar(options: TestPortOptions = {}): FakeCalendarPort {
  const created: CalendarEventInput[] = []
  const updated: Array<{ eventId: string; input: CalendarEventInput }> = []
  return {
    hasConflict: () => options.calendarConflicts ?? false,
    createEvent(input) {
      if (options.calendarCreateFails) throw new Error('Calendar create failed')
      created.push(structuredClone(input))
      return `event-${input.externalId}`
    },
    updateEvent(eventId, input) {
      updated.push({ eventId, input: structuredClone(input) })
    },
    createdEvents: () => structuredClone(created),
    updatedEvents: () => structuredClone(updated),
  }
}

export function validBookingIntake(patch: Partial<BookingIntake> = {}): BookingIntake {
  return {
    formResponseId: 'response-1',
    submittedAt: '2026-08-20T09:00:00+07:00',
    submitterEmail: 'admin@example.com',
    adminName: 'Admin A',
    customerName: 'ลูกค้าทดสอบ',
    phone: '0812345678',
    doctorId: 'doctor-1',
    serviceId: 'service-1',
    appointmentDate: '2026-08-20',
    appointmentTime: '13:00',
    depositAmount: 1000,
    paymentEvidenceFileIds: ['payment-file-1'],
    chatEvidenceFileIds: ['chat-file-1'],
    ...patch,
  }
}

export interface FakeDrivePort extends DrivePort {
  createdFolderCount(): number
  movedFileCount(): number
  publicLinks(): string[]
}

export function createFakeDrive(): FakeDrivePort {
  const folders = new Map<string, { parentId: string; name: string; marker: string }>()
  const files = new Map<string, { name: string; folderId: string | null }>([
    ['payment-file-1', { name: 'payment.jpg', folderId: null }],
    ['chat-file-1', { name: 'chat.jpg', folderId: null }],
    ['chat-file-2', { name: 'chat.png', folderId: null }],
  ])
  let moved = 0

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
    fileName(fileId) {
      const file = files.get(fileId)
      if (!file) throw new Error('file not found')
      return file.name
    },
    findFileByName(folderId, name) {
      return [...files.entries()].find(([, file]) => file.folderId === folderId && file.name === name)?.[0] ?? null
    },
    moveAndRenameFile(fileId, folderId, name) {
      const file = files.get(fileId)
      if (!file) throw new Error('file not found')
      file.folderId = folderId
      file.name = name
      moved += 1
      return fileId
    },
    folderUrl: (folderId) => `https://drive.google.com/drive/folders/${folderId}`,
    createdFolderCount: () => folders.size,
    movedFileCount: () => moved,
    publicLinks: () => [],
  }
}
