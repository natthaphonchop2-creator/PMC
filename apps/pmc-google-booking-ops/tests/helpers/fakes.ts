import type { BookingCase, BookingIntake } from '../../src/domain/types'
import type { BookingPorts } from '../../src/ports'
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
}

export function createTestPorts(): TestPorts {
  const repositories = createMemoryRepositories()
  return {
    clock: { nowIso: () => '2026-08-20T09:00:00+07:00' },
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
    drive: {},
    calendar: {},
    line: {},
    forms: {},
    files: {},
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
