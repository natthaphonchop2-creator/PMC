import type { AuditEvent, BookingCase } from './domain/types'

export interface Clock {
  nowIso(): string
}

export interface LockPort {
  withLock<T>(operation: () => T): T
}

export interface AdminConfig {
  id: string
  name: string
  email: string
  lineUserId: string
  active: boolean
}

export interface DoctorConfig {
  id: string
  name: string
  calendarId: string
  lineGroupId: string
  active: boolean
}

export interface ServiceConfig {
  id: string
  name: string
  durationMinutes: number
  active: boolean
}

export interface ConfigPort {
  findAdminByName(name: string): AdminConfig | null
  findDoctor(id: string): DoctorConfig | null
  findService(id: string): ServiceConfig | null
}

export interface BookingRepository {
  allocateMonthlySequence(month: string): number
  findByFormResponseId(formResponseId: string): BookingCase | null
  rememberFormResponse(formResponseId: string, caseId: string): void
  insert(booking: BookingCase): BookingCase
  getByCaseId(caseId: string): BookingCase | null
  update(
    caseId: string,
    expectedVersion: number,
    patch: Partial<BookingCase>,
    context: MutationContext,
  ): BookingCase
  list(): BookingCase[]
}

export interface MutationContext {
  actor: string
  reason: string
  correlationId: string
}

export interface CallTaskRepository {
  cancelOpenByCase(caseId: string, reason: string): void
}

export interface ImportRepository {
  hasFileHash(hash: string): boolean
}

export interface ReconciliationRepository {
  create(input: Record<string, unknown>): void
}

export interface RetryRepository {
  enqueue(input: Record<string, unknown>): void
}

export interface LineDirectoryRepository {
  remember(input: { sourceType: 'user' | 'group'; sourceId: string; capturedAt: string }): void
}

export interface RetentionRepository {
  queue(input: Record<string, unknown>): void
}

export interface AuditRepository {
  append(event: AuditEvent): void
  listForCase(caseId: string): AuditEvent[]
}

export interface BookingRepositories {
  bookings: BookingRepository
  calls: CallTaskRepository
  imports: ImportRepository
  reconciliation: ReconciliationRepository
  retries: RetryRepository
  lineDirectory: LineDirectoryRepository
  retention: RetentionRepository
  audit: AuditRepository
}

export interface DrivePort {
  rootFolderId(): string
  ensureChildFolder(parentId: string, name: string, marker: string): { id: string; name: string }
  fileName(fileId: string): string
  findFileByName(folderId: string, name: string): string | null
  moveAndRenameFile(fileId: string, folderId: string, name: string): string
  folderUrl(folderId: string): string
}
export interface CalendarEventInput {
  calendarId: string
  externalId: string
  summary: string
  description: string
  start: string
  end: string
}

export interface CalendarPort {
  hasConflict(calendarId: string, start: string, end: string, excludeEventId?: string | null): boolean
  createEvent(input: CalendarEventInput): string
  updateEvent(eventId: string, input: CalendarEventInput): void
}
export type LinePort = object
export type FormsPort = object
export type FilePort = object

export interface BookingPorts {
  clock: Clock
  locks: LockPort
  config: ConfigPort
  repositories: BookingRepositories
  drive: DrivePort
  calendar: CalendarPort
  line: LinePort
  forms: FormsPort
  files: FilePort
}
