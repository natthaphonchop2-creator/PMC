import type { AuditEvent, BookingCase, CallTask } from './domain/types'

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

export interface ChannelConfig {
  id: string
  name: string
  active: boolean
}

export interface ConfigPort {
  findAdminByName(name: string): AdminConfig | null
  findAdminById(id: string): AdminConfig | null
  findDoctor(id: string): DoctorConfig | null
  findService(id: string): ServiceConfig | null
  findChannel(id: string): ChannelConfig | null
  adminLineGroupId(): string
  listAdmins(): AdminConfig[]
  listDoctors(): DoctorConfig[]
  listServices(): ServiceConfig[]
  listChannels(): ChannelConfig[]
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
  insert(task: CallTask): CallTask
  update(taskId: string, expectedVersion: number, patch: Partial<CallTask>): CallTask
  list(): CallTask[]
  getOpenByCase(caseId: string): CallTask | null
  cancelOpenByCase(caseId: string, reason: string): void
}

export interface ImportRepository {
  hasFileHash(hash: string): boolean
  recordFile(input: ImportFileRecord): void
  completed(): ImportFileRecord[]
  hasPaymentId(paymentId: string): boolean
  rememberPaymentId(paymentId: string, caseId: string, fileId: string): void
  appendRaw(input: Record<string, unknown>): void
}

export interface ImportFileRecord {
  fileId: string
  hash: string
  status: 'COMPLETED' | 'QUARANTINED'
  transactionCount: number
  rejectedCount: number
  importedAt: string
  safeError: string
}

export interface ReconciliationRepository {
  create(input: Record<string, unknown>): void
  listOpen(): Record<string, unknown>[]
}

export interface RetryRepository {
  enqueue(input: Record<string, unknown>): void
  listPending(): Record<string, unknown>[]
  complete(id: string): void
  fail(id: string, safeError: string): void
}

export interface LineDirectoryRepository {
  remember(input: { sourceType: 'user' | 'group'; sourceId: string; capturedAt: string }): void
  list(): Array<{ sourceType: 'user' | 'group'; sourceId: string; capturedAt: string }>
  hasNonce(nonce: string): boolean
  rememberNonce(nonce: string, capturedAt: string): void
}

export interface RetentionRepository {
  queue(input: Record<string, unknown>): void
  pending(): Record<string, unknown>[]
  hasCase(caseId: string): boolean
  approve(id: string, approver: string, reason: string): Record<string, unknown>
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
  trashFolder(folderId: string): void
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
export interface LineMessage {
  to: string
  audience: 'doctor' | 'admin'
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' | 'DAILY_SCHEDULE' | 'CALL_REMINDER' | 'EXPIRY_REMINDER'
  caseIds: string[]
  text: string
  apiMessage?: Record<string, unknown>
  retryKey: string
}

export interface LinePort {
  push(message: LineMessage): void
}

export interface EvidenceImageRef {
  previewUrl: string
  fullUrl: string
}

export interface BookingEvidenceImages {
  payment: EvidenceImageRef | null
  chats: EvidenceImageRef[]
  totalChatCount: number
}

export interface EvidenceMediaPort {
  images(caseId: string, paymentFileIds: string[], chatFileIds: string[]): BookingEvidenceImages
}

export interface FormsPort {
  syncBookingChoices(adminNames: string[], doctorIds: string[], serviceIds: string[], channelIds: string[]): void
  syncCallResultChoices(results: string[]): void
}
export interface FilePort {
  readText(fileId: string, encoding: 'Windows-874'): string
  listIncomingFileIds(): string[]
  moveToImported(fileId: string): void
  quarantine(fileId: string): void
}

export interface SecretsPort {
  lineAccessToken(): string
  bookingIngressSecret(): string
  lineDirectoryCaptureEnabled(): boolean
}

export interface CryptoPort {
  hmacSha256Hex(value: string, secret: string): string
  sha256Hex(value: string): string
  base64UrlUtf8(value: string): string
}

export interface DashboardPort {
  write(snapshot: {
    kpis: Record<string, number>
    operations: Array<Record<string, string | number | null>>
  }): void
}

export interface BackupPort {
  hasBackup(bangkokDate: string): boolean
  createBackup(bangkokDate: string): void
}

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
  secrets: SecretsPort
  crypto: CryptoPort
  media: EvidenceMediaPort
  dashboard: DashboardPort
  backups: BackupPort
}
