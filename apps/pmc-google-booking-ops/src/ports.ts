import type { AuditEvent, BookingCase, CallTask } from './domain/types'
import type { CalendarInterval } from './domain/automaticQueue'
import type { MiniAppAsyncRequestRecord } from '../../../shared/pmcMiniAppAsyncState'
import type { StockAuditEvent, StockDocumentSummary, StockLedgerEntry, StockProduct } from '../../../shared/pmcStock'
import type { ExpenseAuditEvent, ExpenseMonthlyProjection, ExpenseSubmission } from '../../../shared/pmcExpense'
import type { ExpensePrivateAttachment, MiniAppExpenseCommand } from '../../../shared/pmcMiniAppExpenseIngress'

export interface Clock {
  nowIso(): string
}

export interface LockPort {
  withLock<T>(operation: () => T): T
}

export interface ExpenseTopologyPort {
  readHeader(tab: string): string[] | null
  createTab(tab: string, headers: readonly string[]): void
  freezeHeader(tab: string): void
}

export interface StaffConfig {
  id: string
  name: string
  email: string
  lineUserId: string
  canCloseBooking: boolean
  canBeAe: boolean
  canManageStock: boolean
  canSubmitExpense: boolean
  canViewFinance: boolean
  canManageExpense: boolean
  active: boolean
  profileImageUrl?: string
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
  findCloserByEmail(email: string): StaffConfig | null
  findCloserByName(name: string): StaffConfig | null
  isSharedCloserEmail(email: string): boolean
  findEligibleAeByName(name: string): StaffConfig | null
  findStaffById(id: string): StaffConfig | null
  listStaff(): StaffConfig[]
  listEligibleAes(): StaffConfig[]
  findDoctor(id: string): DoctorConfig | null
  findService(id: string): ServiceConfig | null
  findChannel(id: string): ChannelConfig | null
  adminLineGroupId(): string
  brandLogoUrl(): string
  callQueueUrl(): string
  listDoctors(): DoctorConfig[]
  listServices(): ServiceConfig[]
  listChannels(): ChannelConfig[]
}

export interface BookingRepository {
  allocateMonthlySequence(month: string): number
  reserveInitialBooking(input: InitialBookingReservation): { booking: BookingCase; created: boolean }
  findByFormResponseId(formResponseId: string): BookingCase | null
  hasFormResponseMapping(formResponseId: string, caseId: string): boolean
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

export interface InitialBookingReservation {
  month: string
  formResponseId: string
  collisionPrefix: string | null
  conflictingFormResponseIds: string[]
  createBooking(sequence: number): BookingCase
  createAudit(booking: BookingCase): AuditEvent
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
  listByEventId(eventId: string): AuditEvent[]
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

export interface StockRepository {
  listProducts(): StockProduct[]
  getProduct(productId: string): StockProduct | null
  insertProduct(product: StockProduct): StockProduct
  updateProduct(productId: string, expectedVersion: number, patch: Partial<StockProduct>): StockProduct
  listLedger(): StockLedgerEntry[]
  appendLedgerBatch(entries: StockLedgerEntry[]): void
  balanceByProduct(): Map<string, number>
  findDocumentByRequestId(requestId: string): StockDocumentSummary | null
  findAuditJournalByRequestId(requestId: string): {
    prepared: StockAuditEvent | null
    accepted: StockAuditEvent | null
  }
  listUnresolvedPrepared(): StockAuditEvent[]
  findAcceptedAuditByRequestId(requestId: string): StockAuditEvent | null
  appendAudit(event: StockAuditEvent): void
}

export interface ExpenseRecoveryCandidate {
  kind: 'PREPARED' | 'VOID' | 'ABANDON'
  expenseId: string
  monthKey: string
  rootRequestId: string
  preparedAt: string
  events: ExpenseAuditEvent[]
  commitRequest: ExpenseRecoveryRequestSnapshot | null
  voidRequest: ExpenseRecoveryRequestSnapshot | null
  bookRevisionClaims: ExpenseBookRevisionClaim[]
}

export interface ExpenseRecoveryRequestSnapshot {
  rowIndex: number
  commandIdempotencyKey: string
  rootRequestId: string
  commandType: MiniAppExpenseCommand['commandType']
  commandFingerprint: string
  commandJson: string
  expenseId: string
  monthKey: string
  recordState: 'RESERVED' | 'COMPLETED'
  resultJson: string | null
  createdAt: string
  updatedAt: string
}

export interface ExpenseBookRevisionClaim {
  submission: ExpenseSubmission
  commitAudit: ExpenseAuditEvent
}

export interface ExpenseResumeSnapshot {
  rootRequestId: string
  requests: ExpenseRecoveryRequestSnapshot[]
  submission: ExpenseSubmission | null
  events: ExpenseAuditEvent[]
}

export interface ExpenseRepository {
  ensureMonth(monthKey: string, createdAt: string): {
    ledgerSpreadsheetId: string
    monthFolderId: string
  }
  reserveRequest(input: {
    commandIdempotencyKey: string
    rootRequestId: string
    commandType: MiniAppExpenseCommand['commandType']
    commandFingerprint: string
    commandJson: string
    expenseId: string
    monthKey: string
    createdAt: string
  }): {
    state: 'RESERVED' | 'REPLAY'
    expenseId: string
    monthKey: string
    resultJson: string | null
  }
  completeRequest(input: {
    commandIdempotencyKey: string
    commandFingerprint: string
    resultJson: string
    updatedAt: string
  }, knownRequest?: ExpenseRecoveryRequestSnapshot): void
  getSubmission(monthKey: string, expenseId: string): ExpenseSubmission | null
  insertPrepared(submission: ExpenseSubmission): ExpenseSubmission
  updateSubmission(
    monthKey: string,
    expenseId: string,
    expectedVersion: number,
    patch: Partial<ExpenseSubmission>,
  ): ExpenseSubmission
  listMonth(monthKey: string): ExpenseSubmission[]
  listAttachments(monthKey: string, expenseId: string): ExpensePrivateAttachment[]
  appendAttachments(monthKey: string, attachments: ExpensePrivateAttachment[]): void
  effectiveByBookDailyKey(monthKey: string, bookDailyKey: string): ExpenseSubmission | null
  listBookRevisionClaims(monthKey: string, bookDailyKey: string): ExpenseBookRevisionClaim[]
  getAuditByEventId(eventId: string): ExpenseAuditEvent | null
  appendAudit(event: ExpenseAuditEvent, knownEvents?: readonly ExpenseAuditEvent[]): ExpenseAuditEvent
  auditForExpense(expenseId: string): ExpenseAuditEvent[]
  replaceMonthlySummary(
    monthKey: string,
    projection: ExpenseMonthlyProjection,
    calculatedAt: string,
  ): void
  verifyPrivateAttachments(
    monthKey: string,
    expenseId: string,
    attachments: ExpensePrivateAttachment[],
  ): void
  listRecoveryCandidates(limit?: number): ExpenseRecoveryCandidate[]
  resumeSnapshot(rootRequestId: string): ExpenseResumeSnapshot
}

export interface DrivePort {
  rootFolderId(): string
  ensureChildFolder(parentId: string, name: string, marker: string): { id: string; name: string }
  createEvidenceFile(folderId: string, name: string, mimeType: 'image/jpeg' | 'image/png', bytes: number[]): string
  fileName(fileId: string): string
  findFileByName(folderId: string, name: string): string | null
  moveAndRenameFile(fileId: string, folderId: string, name: string): string
  folderUrl(folderId: string): string
  trashFolder(folderId: string): void
}
export interface CalendarEventInput {
  calendarId: string
  externalId: string
  colorId: string
  summary: string
  description: string
  start: string
  end: string
  privateProperties: Record<string, string>
}

export interface CalendarPort {
  hasConflict(calendarId: string, start: string, end: string, excludeEventId?: string | null): boolean
  listEvents(calendarId: string, start: string, end: string): CalendarInterval[]
  createEvent(input: CalendarEventInput): string
  updateEvent(eventId: string, input: CalendarEventInput): 'UPDATED' | 'NOT_FOUND'
}
export interface LineMessage {
  to: string
  audience: 'doctor' | 'admin'
  eventType: 'BOOKING_CONFIRMED' | 'TENTATIVE_BOOKING' | 'AWAITING_SLOT' | 'RESCHEDULED' | 'CANCELLED' | 'TIME_CONFLICT' | 'DAILY_SCHEDULE' | 'CALL_REMINDER' | 'EXPIRY_REMINDER'
  caseIds: string[]
  text: string
  apiMessage?: Record<string, unknown>
  apiMessages?: Record<string, unknown>[]
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
  payments: EvidenceImageRef[]
  chats: EvidenceImageRef[]
  totalPaymentCount: number
  totalChatCount: number
}

export interface EvidenceMediaPort {
  images(caseId: string, paymentFileIds: string[], chatFileIds: string[]): BookingEvidenceImages
}

export interface FormsPort {
  syncBookingChoices(
    closerNames: string[],
    aeNames: string[],
    doctorIds: string[],
    serviceIds: string[],
    channelIds: string[],
  ): void
  syncCallResultChoices(results: string[]): void
  bookingCollectsEmail(): boolean
  bookingHasCloserField(): boolean
  bookingHasAeField(): boolean
  bookingHasFacebookNameField(): boolean
  pauseBookingResponses(): void
  ensureCloserField(): void
  renameAdminFieldToAe(): void
  configureCompactIdentityFields(aeNames: string[]): void
  ensureFacebookNameField(): void
  resumeBookingResponses(): void
  callResultPrefillUrl(caseId: string): string
  queueConfirmationUrl(input: {
    caseId: string
    action: 'CONFIRM' | 'CHANGE'
    appointmentDate?: string
    appointmentTime?: string
  }): string
  ensureQueueConfirmationForm(): { confirmationFormReady: true }
  configureQueueModeForm(): { queueQuestionReady: true }
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
  sha256Base64Url(value: string): string
  base64UrlUtf8(value: string): string
  base64Decode(value: string): number[]
}

export interface MiniAppRequestStatePort {
  getByRequestId(requestId: string): MiniAppAsyncRequestRecord | null
  updateByRequestId(
    requestId: string,
    expectedVersion: number,
    next: MiniAppAsyncRequestRecord,
  ): MiniAppAsyncRequestRecord
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
  miniAppRequests: MiniAppRequestStatePort
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
