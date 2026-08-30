import {
  effectiveCommittedExpenses,
  parseExpenseDate,
  type ExpenseAuditEvent,
  type ExpenseSubmission,
} from '../../../../shared/pmcExpense'
import type {
  ExpensePrivateAttachment,
  MiniAppExpenseCommand,
} from '../../../../shared/pmcMiniAppExpenseIngress'
import type {
  ExpenseBookRevisionClaim,
  ExpenseRecoveryCandidate,
  ExpenseRecoveryRequestSnapshot,
  ExpenseResumeSnapshot,
  ExpenseRepository,
} from '../ports'
import { createGoogleExpenseTopologyPort } from '../adapters/googleSheets'
import { ensureExpenseMonthTopology } from './setup'
import {
  EXPENSE_MASTER_SCHEMAS,
  EXPENSE_MONTH_SCHEMAS,
} from './sheetTopology'

export type ExpenseStorageRow = Record<string, unknown>
export type ExpenseRepositoryMasterTab = keyof typeof EXPENSE_MASTER_SCHEMAS
export type ExpenseRepositoryMonthTab = keyof typeof EXPENSE_MONTH_SCHEMAS

export interface ExpenseRepositoryBackend {
  ensureMonth(monthKey: string, createdAt: string): {
    ledgerSpreadsheetId: string
    monthFolderId: string
  }
  readMaster(tab: ExpenseRepositoryMasterTab): ExpenseStorageRow[]
  appendMaster(tab: ExpenseRepositoryMasterTab, rows: ExpenseStorageRow[]): void
  updateMaster(tab: ExpenseRepositoryMasterTab, rowIndex: number, row: ExpenseStorageRow): void
  readMonth(monthKey: string, tab: ExpenseRepositoryMonthTab): ExpenseStorageRow[]
  appendMonth(monthKey: string, tab: ExpenseRepositoryMonthTab, rows: ExpenseStorageRow[]): void
  updateMonth(
    monthKey: string,
    tab: ExpenseRepositoryMonthTab,
    rowIndex: number,
    row: ExpenseStorageRow,
  ): void
  replaceMonth(monthKey: string, tab: ExpenseRepositoryMonthTab, rows: ExpenseStorageRow[]): void
  verifyPrivateAttachments(
    monthKey: string,
    expenseId: string,
    attachments: ExpensePrivateAttachment[],
  ): void
  sha256Hex(value: string): string
}

interface ExpenseRequestRow {
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

const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/
const SHA256 = /^[a-f0-9]{64}$/
const LITERAL_TEXT_PREFIX = '\u200c'
const MUTABLE_SUBMISSION_FIELDS = new Set<keyof ExpenseSubmission>([
  'recordState',
  'committedAt',
  'updatedAt',
  'supersedesExpenseId',
])

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nullableString(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function asRequest(row: ExpenseStorageRow): ExpenseRequestRow {
  return {
    commandIdempotencyKey: String(row.commandIdempotencyKey ?? ''),
    rootRequestId: String(row.rootRequestId ?? ''),
    commandType: String(row.commandType ?? '') as MiniAppExpenseCommand['commandType'],
    commandFingerprint: String(row.commandFingerprint ?? ''),
    commandJson: String(row.commandJson ?? ''),
    expenseId: String(row.expenseId ?? ''),
    monthKey: String(row.monthKey ?? ''),
    recordState: String(row.recordState ?? '') as ExpenseRequestRow['recordState'],
    resultJson: nullableString(row.resultJson),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  }
}

function asSubmission(row: ExpenseStorageRow): ExpenseSubmission {
  return {
    expenseId: String(row.expenseId ?? ''),
    expenseDate: String(row.expenseDate ?? ''),
    monthKey: String(row.monthKey ?? ''),
    category: String(row.category ?? '') as ExpenseSubmission['category'],
    scope: String(row.scope ?? '') as ExpenseSubmission['scope'],
    amountSatang: Number(row.amountSatang),
    counterpartyName: nullableText(row.counterpartyName),
    description: String(row.description ?? ''),
    paymentMethod: nullableString(row.paymentMethod) as ExpenseSubmission['paymentMethod'],
    recordState: String(row.recordState ?? '') as ExpenseSubmission['recordState'],
    bookDailyKey: nullableString(row.bookDailyKey),
    revision: Number(row.revision),
    supersedesExpenseId: nullableString(row.supersedesExpenseId),
    submittedByStaffId: String(row.submittedByStaffId ?? ''),
    submittedByName: String(row.submittedByName ?? ''),
    submittedAt: String(row.submittedAt ?? ''),
    committedAt: nullableString(row.committedAt),
    updatedAt: String(row.updatedAt ?? ''),
    version: Number(row.version),
    idempotencyKey: String(row.idempotencyKey ?? ''),
  }
}

function asAttachment(row: ExpenseStorageRow): ExpensePrivateAttachment {
  return {
    attachmentId: String(row.attachmentId ?? ''),
    expenseId: String(row.expenseId ?? ''),
    rootRequestId: String(row.rootRequestId ?? ''),
    ordinal: Number(row.ordinal),
    mediaType: String(row.mediaType ?? '') as ExpensePrivateAttachment['mediaType'],
    originalFileName: String(row.originalFileName ?? ''),
    privateFileId: String(row.privateFileId ?? ''),
    deterministicName: String(row.deterministicName ?? ''),
    sizeBytes: Number(row.sizeBytes),
    driveVersion: String(row.driveVersion ?? ''),
    slotClaimId: String(row.slotClaimId ?? ''),
    sha256: String(row.sha256 ?? ''),
    uploadedByStaffId: String(row.uploadedByStaffId ?? ''),
    uploadedAt: String(row.uploadedAt ?? ''),
  }
}

function asAudit(row: ExpenseStorageRow): ExpenseAuditEvent {
  return {
    eventId: String(row.eventId ?? ''),
    expenseId: String(row.expenseId ?? ''),
    actorStaffId: String(row.actorStaffId ?? ''),
    action: String(row.action ?? '') as ExpenseAuditEvent['action'],
    beforeJson: String(row.beforeJson ?? ''),
    afterJson: String(row.afterJson ?? ''),
    createdAt: String(row.createdAt ?? ''),
    correlationId: String(row.correlationId ?? ''),
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function requireMonthKey(monthKey: string): void {
  try {
    if (parseExpenseDate(`${monthKey}-01`).monthKey !== monthKey) throw new Error('invalid')
  } catch {
    throw new Error('EXPENSE_INVALID_DATE')
  }
}

function validateRequestInput(input: Parameters<ExpenseRepository['reserveRequest']>[0]): void {
  requireMonthKey(input.monthKey)
  if (
    !SAFE_ID.test(input.commandIdempotencyKey)
    || !SAFE_ID.test(input.rootRequestId)
    || !SAFE_ID.test(input.expenseId)
    || !SHA256.test(input.commandFingerprint)
    || typeof input.commandJson !== 'string'
    || input.commandJson.length < 2
    || input.commandJson.length > 8_192
    || !Number.isFinite(Date.parse(input.createdAt))
  ) throw new Error('EXPENSE_INVALID_REQUEST')
}

function parseAuditAfter(event: ExpenseAuditEvent): Record<string, unknown> | null {
  try {
    const value = JSON.parse(event.afterJson) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function bookRevisionClaims(
  submissions: ExpenseSubmission[],
  audits: ExpenseAuditEvent[],
): ExpenseBookRevisionClaim[] {
  return submissions.flatMap((submission) => {
    const commits = audits.filter((event) => (
      event.expenseId === submission.expenseId && event.action === 'COMMIT'
    ))
    if (commits.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    return commits[0]
      ? [{ submission: clonePlain(submission), commitAudit: clonePlain(commits[0]) }]
      : []
  })
}

export function createExpenseRepository(backend: ExpenseRepositoryBackend): ExpenseRepository {
  const repository: ExpenseRepository = {
    ensureMonth(monthKey, createdAt) {
      requireMonthKey(monthKey)
      return clonePlain(backend.ensureMonth(monthKey, createdAt))
    },
    reserveRequest(input) {
      validateRequestInput(input)
      if (backend.sha256Hex(input.commandJson) !== input.commandFingerprint) {
        throw new Error('EXPENSE_INVALID_REQUEST')
      }
      const rows = backend.readMaster('EXPENSE_REQUESTS')
      const matches = rows
        .map(asRequest)
        .filter((row) => row.commandIdempotencyKey === input.commandIdempotencyKey)
      if (matches.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      const existing = matches[0]
      if (existing) {
        if (
          existing.commandFingerprint !== input.commandFingerprint
          || existing.commandJson !== input.commandJson
          || existing.rootRequestId !== input.rootRequestId
          || existing.commandType !== input.commandType
        ) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
        return {
          state: 'REPLAY',
          expenseId: existing.expenseId,
          monthKey: existing.monthKey,
          resultJson: existing.resultJson,
        }
      }
      const row: ExpenseRequestRow = {
        ...input,
        recordState: 'RESERVED',
        resultJson: null,
        updatedAt: input.createdAt,
      }
      backend.appendMaster('EXPENSE_REQUESTS', [row as unknown as ExpenseStorageRow])
      return {
        state: 'RESERVED',
        expenseId: input.expenseId,
        monthKey: input.monthKey,
        resultJson: null,
      }
    },
    completeRequest(input, knownRequest) {
      if (!SAFE_ID.test(input.commandIdempotencyKey) || !SHA256.test(input.commandFingerprint)) {
        throw new Error('EXPENSE_INVALID_REQUEST')
      }
      let index: number
      let before: ExpenseRequestRow
      if (knownRequest) {
        index = knownRequest.rowIndex
        before = asRequest(knownRequest as unknown as ExpenseStorageRow)
      } else {
        const rows = backend.readMaster('EXPENSE_REQUESTS')
        index = rows.findIndex((row) => row.commandIdempotencyKey === input.commandIdempotencyKey)
        if (index < 0) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        if (rows.some((row, candidate) => candidate !== index && row.commandIdempotencyKey === input.commandIdempotencyKey)) {
          throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        }
        before = asRequest(rows[index]!)
      }
      if (before.commandIdempotencyKey !== input.commandIdempotencyKey || index < 0) {
        throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      }
      if (before.commandFingerprint !== input.commandFingerprint) {
        throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
      }
      if (before.resultJson !== null) {
        if (before.resultJson !== input.resultJson) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
        return
      }
      backend.updateMaster('EXPENSE_REQUESTS', index, {
        ...before,
        recordState: 'COMPLETED',
        resultJson: input.resultJson,
        updatedAt: input.updatedAt,
      })
    },
    getSubmission(monthKey, expenseId) {
      const matches = backend.readMonth(monthKey, 'EXPENSE_SUBMISSIONS')
        .map(asSubmission)
        .filter((row) => row.expenseId === expenseId)
      if (matches.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      return matches[0] ? clonePlain(matches[0]) : null
    },
    insertPrepared(submission) {
      if (submission.recordState !== 'PREPARED' || submission.version !== 1) {
        throw new Error('EXPENSE_INVALID_REQUEST')
      }
      const rows = backend.readMonth(submission.monthKey, 'EXPENSE_SUBMISSIONS')
      const matches = rows.map(asSubmission).filter((row) => row.expenseId === submission.expenseId)
      if (matches.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      if (matches[0]) {
        if (!sameValue(matches[0], submission)) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
        return clonePlain(matches[0])
      }
      backend.appendMonth(
        submission.monthKey,
        'EXPENSE_SUBMISSIONS',
        [submission as unknown as ExpenseStorageRow],
      )
      return clonePlain(submission)
    },
    updateSubmission(monthKey, expenseId, expectedVersion, patch) {
      if (Object.keys(patch).some((key) => !MUTABLE_SUBMISSION_FIELDS.has(key as keyof ExpenseSubmission))) {
        throw new Error('EXPENSE_IMMUTABLE_FIELD')
      }
      const rows = backend.readMonth(monthKey, 'EXPENSE_SUBMISSIONS')
      const indexes = rows
        .map((row, index) => ({ row: asSubmission(row), index }))
        .filter(({ row }) => row.expenseId === expenseId)
      if (indexes.length === 0) throw new Error('EXPENSE_NOT_FOUND')
      if (indexes.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      const { row: before, index } = indexes[0]!
      if (before.version !== expectedVersion) throw new Error('EXPENSE_NOT_PREPARED')
      const nextState = patch.recordState ?? before.recordState
      if (
        before.recordState === 'VOID'
        || (before.recordState === 'COMMITTED' && nextState !== 'VOID')
        || (before.recordState === 'PREPARED' && nextState !== 'PREPARED' && nextState !== 'COMMITTED' && nextState !== 'VOID')
      ) throw new Error('EXPENSE_NOT_PREPARED')
      const after: ExpenseSubmission = {
        ...before,
        ...patch,
        expenseId: before.expenseId,
        expenseDate: before.expenseDate,
        monthKey: before.monthKey,
        category: before.category,
        scope: before.scope,
        bookDailyKey: before.bookDailyKey,
        revision: before.revision,
        submittedByStaffId: before.submittedByStaffId,
        submittedByName: before.submittedByName,
        submittedAt: before.submittedAt,
        idempotencyKey: before.idempotencyKey,
        version: before.version + 1,
      }
      backend.updateMonth(monthKey, 'EXPENSE_SUBMISSIONS', index, after as unknown as ExpenseStorageRow)
      return clonePlain(after)
    },
    listMonth(monthKey) {
      requireMonthKey(monthKey)
      return backend.readMonth(monthKey, 'EXPENSE_SUBMISSIONS').map(asSubmission)
    },
    listAttachments(monthKey, expenseId) {
      return backend.readMonth(monthKey, 'EXPENSE_ATTACHMENTS')
        .map(asAttachment)
        .filter((row) => row.expenseId === expenseId)
        .sort((left, right) => left.ordinal - right.ordinal)
    },
    appendAttachments(monthKey, attachments) {
      if (attachments.length === 0) return
      const rows = backend.readMonth(monthKey, 'EXPENSE_ATTACHMENTS')
      const existing = rows.map(asAttachment)
      const missing: ExpensePrivateAttachment[] = []
      for (const attachment of attachments) {
        const matches = existing.filter((row) => row.attachmentId === attachment.attachmentId)
        if (matches.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        if (matches[0]) {
          if (!sameValue(matches[0], attachment)) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
        } else {
          if (missing.some((row) => row.attachmentId === attachment.attachmentId)) {
            throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
          }
          missing.push(clonePlain(attachment))
        }
      }
      backend.appendMonth(
        monthKey,
        'EXPENSE_ATTACHMENTS',
        missing.map((row) => row as unknown as ExpenseStorageRow),
      )
    },
    effectiveByBookDailyKey(monthKey, bookDailyKey) {
      try {
        const matches = effectiveCommittedExpenses(repository.listMonth(monthKey))
          .filter((row) => row.bookDailyKey === bookDailyKey)
          .sort((left, right) => right.revision - left.revision)
        if (matches.length > 1) throw new Error('invalid')
        return matches[0] ? clonePlain(matches[0]) : null
      } catch {
        throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      }
    },
    listBookRevisionClaims(monthKey, bookDailyKey) {
      const submissions = backend.readMonth(monthKey, 'EXPENSE_SUBMISSIONS')
        .map(asSubmission)
        .filter((row) => row.recordState === 'PREPARED' && row.bookDailyKey === bookDailyKey)
      const audits = backend.readMaster('EXPENSE_AUDIT').map(asAudit)
      return bookRevisionClaims(submissions, audits)
    },
    getAuditByEventId(eventId) {
      const matches = backend.readMaster('EXPENSE_AUDIT')
        .map(asAudit)
        .filter((row) => row.eventId === eventId)
      if (matches.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      return matches[0] ? clonePlain(matches[0]) : null
    },
    appendAudit(event, knownEvents) {
      const events = knownEvents ? [...knownEvents] : backend.readMaster('EXPENSE_AUDIT').map(asAudit)
      const matches = events.filter((row) => row.eventId === event.eventId)
      if (matches.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      if (matches[0]) {
        if (!sameValue(matches[0], event)) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
        return clonePlain(matches[0])
      }
      backend.appendMaster('EXPENSE_AUDIT', [event as unknown as ExpenseStorageRow])
      return clonePlain(event)
    },
    auditForExpense(expenseId) {
      return backend.readMaster('EXPENSE_AUDIT')
        .map(asAudit)
        .filter((row) => row.expenseId === expenseId)
    },
    replaceMonthlySummary(monthKey, projection, calculatedAt) {
      let effective: ExpenseSubmission[]
      try {
        effective = effectiveCommittedExpenses(repository.listMonth(monthKey))
      } catch {
        throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      }
      const sourceHash = backend.sha256Hex(JSON.stringify(effective.map((row) => ({
        expenseId: row.expenseId,
        revision: row.revision,
        amountSatang: row.amountSatang,
        recordState: row.recordState,
      }))))
      const groups = [
        { scope: 'CLINIC', category: 'BILL_DOCUMENT', committedSatang: projection.clinicByCategorySatang.BILL_DOCUMENT },
        { scope: 'CLINIC', category: 'BOOK_CLINIC', committedSatang: projection.clinicByCategorySatang.BOOK_CLINIC },
        { scope: 'DOCTOR_PERSONAL', category: 'BOOK_DOCTOR_PERSONAL', committedSatang: projection.doctorPersonalCommittedSatang },
      ] as const
      backend.replaceMonth(monthKey, 'MONTHLY_SUMMARY', groups.map((group) => ({
        monthKey,
        ...group,
        effectiveCount: effective.filter((row) => row.scope === group.scope && row.category === group.category).length,
        calculatedAt,
        sourceHash,
      })))
    },
    verifyPrivateAttachments(monthKey, expenseId, attachments) {
      backend.verifyPrivateAttachments(monthKey, expenseId, attachments)
    },
    listRecoveryCandidates(limit = 100) {
      const boundedLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100
      const audits = backend.readMaster('EXPENSE_AUDIT').map(asAudit)
      const requestEntries = backend.readMaster('EXPENSE_REQUESTS')
        .map((row, rowIndex) => ({ request: asRequest(row), rowIndex }))
      const requestByKey = new Map<string, ExpenseRecoveryRequestSnapshot>()
      for (const { request, rowIndex } of requestEntries) {
        if (requestByKey.has(request.commandIdempotencyKey)) {
          throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        }
        requestByKey.set(request.commandIdempotencyKey, { ...request, rowIndex })
      }
      const auditByExpense = new Map<string, ExpenseAuditEvent[]>()
      for (const audit of audits) {
        const events = auditByExpense.get(audit.expenseId) ?? []
        events.push(audit)
        auditByExpense.set(audit.expenseId, events)
      }
      const unresolved = audits.filter((event) => event.action === 'PREPARE')
        .flatMap<ExpenseRecoveryCandidate>((event): ExpenseRecoveryCandidate[] => {
        const after = parseAuditAfter(event)
        const rootRequestId = String(after?.rootRequestId ?? '')
        const monthKey = String(after?.monthKey ?? '')
        if (!SAFE_ID.test(rootRequestId) || !/^\d{4}-\d{2}$/.test(monthKey)) return []
        const events = auditByExpense.get(event.expenseId) ?? []
        if (events.filter((candidate) => candidate.action === 'PREPARE').length !== 1) {
          throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        }
        const voidAudits = events.filter((candidate) => candidate.action === 'VOID')
        const abandonAudits = events.filter((candidate) => candidate.action === 'ABANDON')
        if (voidAudits.length > 1 || abandonAudits.length > 1 || (voidAudits.length && abandonAudits.length)) {
          throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        }
        const commitAudits = events.filter((candidate) => candidate.action === 'COMMIT')
        if (commitAudits.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        const commitRequest = requestByKey.get(`${rootRequestId}:commit`) ?? null
        const voidRequests = requestEntries
          .map(({ request, rowIndex }) => ({ ...request, rowIndex }))
          .filter((request) => request.commandType === 'VOID_EXPENSE' && request.expenseId === event.expenseId)
        if (voidRequests.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        const voidRequest = voidRequests[0] ?? null
        if (voidAudits.length === 1 || voidRequest) {
          if (!voidRequest || voidRequest.resultJson !== null) return []
          return [{
            kind: 'VOID' as const,
            expenseId: event.expenseId,
            monthKey,
            rootRequestId,
            preparedAt: event.createdAt,
            events: clonePlain(events),
            commitRequest: commitRequest ? clonePlain(commitRequest) : null,
            voidRequest: clonePlain(voidRequest),
            bookRevisionClaims: [] as ExpenseBookRevisionClaim[],
          }]
        }
        if (abandonAudits.length === 1) {
          if (!commitRequest || commitRequest.resultJson !== null) return []
          return [{
            kind: 'ABANDON' as const,
            expenseId: event.expenseId,
            monthKey,
            rootRequestId,
            preparedAt: event.createdAt,
            events: clonePlain(events),
            commitRequest: clonePlain(commitRequest),
            voidRequest: null,
            bookRevisionClaims: [] as ExpenseBookRevisionClaim[],
          }]
        }
        if (commitAudits.length === 1 && !commitRequest) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        if (commitAudits.length === 1 && commitRequest?.resultJson !== null) return []
        return [{
          kind: 'PREPARED' as const,
          expenseId: event.expenseId,
          monthKey,
          rootRequestId,
          preparedAt: event.createdAt,
          events: clonePlain(events),
          commitRequest: commitRequest ? clonePlain(commitRequest) : null,
          voidRequest: null,
          bookRevisionClaims: [] as ExpenseBookRevisionClaim[],
        }]
        })
      unresolved.sort((left, right) => (
        Date.parse(left.preparedAt) - Date.parse(right.preparedAt)
        || left.expenseId.localeCompare(right.expenseId)
      ))
      const selected = unresolved.slice(0, boundedLimit)
      const submissionsByMonth = new Map<string, ExpenseSubmission[]>()
      for (const candidate of selected) {
        if (!submissionsByMonth.has(candidate.monthKey)) {
          submissionsByMonth.set(
            candidate.monthKey,
            backend.readMonth(candidate.monthKey, 'EXPENSE_SUBMISSIONS').map(asSubmission),
          )
        }
        const submission = submissionsByMonth.get(candidate.monthKey)!
          .find((row) => row.expenseId === candidate.expenseId)
        if (submission?.bookDailyKey) {
          const sameBookPrepared = submissionsByMonth.get(candidate.monthKey)!
            .filter((row) => row.recordState === 'PREPARED' && row.bookDailyKey === submission.bookDailyKey)
          candidate.bookRevisionClaims = bookRevisionClaims(sameBookPrepared, audits)
        }
      }
      return selected
    },
    resumeSnapshot(rootRequestId): ExpenseResumeSnapshot {
      if (!SAFE_ID.test(rootRequestId)) throw new Error('EXPENSE_INVALID_REQUEST')
      const requests = backend.readMaster('EXPENSE_REQUESTS')
        .map((row, rowIndex) => ({ ...asRequest(row), rowIndex }))
        .filter((request) => request.rootRequestId === rootRequestId)
      const requestKeys = requests.map(({ commandIdempotencyKey }) => commandIdempotencyKey)
      if (new Set(requestKeys).size !== requestKeys.length || requests.length > 4) {
        throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      }
      for (const request of requests) {
        if (backend.sha256Hex(request.commandJson) !== request.commandFingerprint) {
          throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
        }
      }
      const identities = new Set(requests.map(({ expenseId, monthKey }) => `${monthKey}\u0000${expenseId}`))
      if (identities.size > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      const selected = requests[0]
      if (!selected) return { rootRequestId, requests: [], submission: null, events: [] }
      const submissions = backend.readMonth(selected.monthKey, 'EXPENSE_SUBMISSIONS')
        .map(asSubmission)
        .filter(({ expenseId }) => expenseId === selected.expenseId)
      if (submissions.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      const events = backend.readMaster('EXPENSE_AUDIT')
        .map(asAudit)
        .filter(({ expenseId }) => expenseId === selected.expenseId)
      return {
        rootRequestId,
        requests: clonePlain(requests),
        submission: submissions[0] ? clonePlain(submissions[0]) : null,
        events: clonePlain(events),
      }
    },
  }
  return repository
}

export interface GoogleExpenseRepositoryOptions {
  masterSpreadsheetId: string
  financeFolderId: string
}

export function createGoogleExpenseRepository(
  options: GoogleExpenseRepositoryOptions,
): ExpenseRepository {
  return createExpenseRepository(createGoogleExpenseRepositoryBackend(options))
}

function createGoogleExpenseRepositoryBackend(
  options: GoogleExpenseRepositoryOptions,
): ExpenseRepositoryBackend {
  const configuredMasterSpreadsheetId = options.masterSpreadsheetId
  const configuredFinanceFolderId = options.financeFolderId

  function financeFolder(): GoogleAppsScript.Drive.Folder {
    const financeFolderId = requiredConfigId(configuredFinanceFolderId)
    const folder = DriveApp.getFolderById(financeFolderId)
    if (folder.isTrashed() || folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    }
    return folder
  }

  function masterSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    const masterSpreadsheetId = requiredConfigId(configuredMasterSpreadsheetId)
    const root = financeFolder()
    const file = DriveApp.getFileById(masterSpreadsheetId)
    if (
      file.isTrashed()
      || file.getSharingAccess() !== DriveApp.Access.PRIVATE
      || !hasDirectParent(file.getParents(), root.getId())
    ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    const spreadsheet = SpreadsheetApp.openById(masterSpreadsheetId)
    validateSchemas(spreadsheet, EXPENSE_MASTER_SCHEMAS)
    return spreadsheet
  }

  function indexedMonth(monthKey: string): { ledgerSpreadsheetId: string; monthFolderId: string } {
    const rows = readRows(masterSpreadsheet(), 'EXPENSE_MONTHLY_INDEX', EXPENSE_MASTER_SCHEMAS.EXPENSE_MONTHLY_INDEX)
      .filter((row) => row.monthKey === monthKey)
    if (rows.length !== 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    return {
      ledgerSpreadsheetId: requiredConfigId(String(rows[0]?.ledgerSpreadsheetId ?? '')),
      monthFolderId: requiredConfigId(String(rows[0]?.monthFolderId ?? '')),
    }
  }

  function monthContext(monthKey: string): {
    spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet
    monthFolder: GoogleAppsScript.Drive.Folder
  } {
    const root = financeFolder()
    const indexed = indexedMonth(monthKey)
    const monthFolder = DriveApp.getFolderById(indexed.monthFolderId)
    const file = DriveApp.getFileById(indexed.ledgerSpreadsheetId)
    const checks = {
      monthFolderNotTrashed: !monthFolder.isTrashed(),
      monthFolderPrivate: monthFolder.getSharingAccess() === DriveApp.Access.PRIVATE,
      monthFolderDirectParent: hasDirectParent(monthFolder.getParents(), root.getId()),
      ledgerNotTrashed: !file.isTrashed(),
      ledgerPrivate: file.getSharingAccess() === DriveApp.Access.PRIVATE,
      ledgerDirectParent: hasDirectParent(file.getParents(), monthFolder.getId()),
    }
    console.log(JSON.stringify({ event: 'expense-month-context', ...checks }))
    if (Object.values(checks).some((value) => value !== true)) {
      throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    }
    const spreadsheet = SpreadsheetApp.openById(indexed.ledgerSpreadsheetId)
    console.log('expense-month-context:spreadsheet:open')
    validateSchemas(spreadsheet, EXPENSE_MONTH_SCHEMAS)
    console.log('expense-month-context:schema:ready')
    return { spreadsheet, monthFolder }
  }

  return {
    ensureMonth(monthKey, createdAt) {
      const master = masterSpreadsheet()
      console.log('expense-bootstrap:master:ready')
      const existing = readRows(master, 'EXPENSE_MONTHLY_INDEX', EXPENSE_MASTER_SCHEMAS.EXPENSE_MONTHLY_INDEX)
        .filter((row) => row.monthKey === monthKey)
      console.log(`expense-bootstrap:index-count:${existing.length}`)
      if (existing.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      if (existing[0]) {
        const context = monthContext(monthKey)
        return {
          ledgerSpreadsheetId: context.spreadsheet.getId(),
          monthFolderId: context.monthFolder.getId(),
        }
      }

      const root = financeFolder()
      console.log('expense-bootstrap:root:ready')
      const monthFolder = uniqueOrCreateFolder(root, `PMC Expenses ${monthKey}`)
      console.log('expense-bootstrap:folder:ready')
      const spreadsheetName = `PMC Expenses ${monthKey}`
      const spreadsheet = uniqueOrCreateSpreadsheet(monthFolder, spreadsheetName)
      console.log('expense-bootstrap:spreadsheet:ready')
      const spreadsheetFile = DriveApp.getFileById(spreadsheet.getId())
      if (
        spreadsheetFile.isTrashed()
        || spreadsheetFile.getSharingAccess() !== DriveApp.Access.PRIVATE
        || !hasDirectParent(spreadsheetFile.getParents(), monthFolder.getId())
      ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      console.log('expense-bootstrap:sharing:ready')
      ensureExpenseMonthTopology(createGoogleExpenseTopologyPort(spreadsheet))
      console.log('expense-bootstrap:topology:ready')
      validateSchemas(spreadsheet, EXPENSE_MONTH_SCHEMAS)
      console.log('expense-bootstrap:schema:ready')
      appendRows(master, 'EXPENSE_MONTHLY_INDEX', EXPENSE_MASTER_SCHEMAS.EXPENSE_MONTHLY_INDEX, [{
        monthKey,
        ledgerSpreadsheetId: spreadsheet.getId(),
        monthFolderId: monthFolder.getId(),
        createdAt,
        updatedAt: createdAt,
      }])
      console.log('expense-bootstrap:index:appended')
      return { ledgerSpreadsheetId: spreadsheet.getId(), monthFolderId: monthFolder.getId() }
    },
    readMaster(tab) {
      return readRows(masterSpreadsheet(), tab, EXPENSE_MASTER_SCHEMAS[tab])
    },
    appendMaster(tab, rows) {
      appendRows(masterSpreadsheet(), tab, EXPENSE_MASTER_SCHEMAS[tab], rows)
    },
    updateMaster(tab, rowIndex, row) {
      updateRow(masterSpreadsheet(), tab, EXPENSE_MASTER_SCHEMAS[tab], rowIndex, row)
    },
    readMonth(monthKey, tab) {
      return readRows(monthContext(monthKey).spreadsheet, tab, EXPENSE_MONTH_SCHEMAS[tab])
    },
    appendMonth(monthKey, tab, rows) {
      appendRows(monthContext(monthKey).spreadsheet, tab, EXPENSE_MONTH_SCHEMAS[tab], rows)
    },
    updateMonth(monthKey, tab, rowIndex, row) {
      updateRow(monthContext(monthKey).spreadsheet, tab, EXPENSE_MONTH_SCHEMAS[tab], rowIndex, row)
    },
    replaceMonth(monthKey, tab, rows) {
      replaceRows(monthContext(monthKey).spreadsheet, tab, EXPENSE_MONTH_SCHEMAS[tab], rows)
    },
    verifyPrivateAttachments(monthKey, expenseId, attachments) {
      try {
        const { monthFolder } = monthContext(monthKey)
        const expenseFolders = iteratorValues(monthFolder.getFoldersByName(expenseId))
        if (expenseFolders.length !== 1) throw new Error('invalid')
        const expenseFolder = expenseFolders[0]!
        if (
          expenseFolder.isTrashed()
          || expenseFolder.getSharingAccess() !== DriveApp.Access.PRIVATE
          || !hasDirectParent(expenseFolder.getParents(), monthFolder.getId())
        ) throw new Error('invalid')
        const before = listExpenseFiles(expenseFolder.getId())
        verifyExpenseSiblingSlots(before, monthKey, expenseId, expenseFolder.getId(), attachments)
        for (const attachment of attachments) {
          const file = DriveApp.getFileById(attachment.privateFileId)
          const metadata = before.find(({ id }) => id === attachment.privateFileId)
          if (
            !metadata
            || file.isTrashed()
            || file.getSharingAccess() !== DriveApp.Access.PRIVATE
            || !hasDirectParent(file.getParents(), expenseFolder.getId())
            || file.getMimeType() !== attachment.mediaType
            || file.getBlob().getContentType() !== attachment.mediaType
          ) throw new Error('invalid')
          verifyExpenseFileMetadata(metadata, monthKey, expenseId, expenseFolder.getId(), attachment)
          const bytes = file.getBlob().getBytes()
          if (
            bytes.length !== attachment.sizeBytes
            || sha256Bytes(bytes) !== attachment.sha256
          ) throw new Error('invalid')
        }
        const after = listExpenseFiles(expenseFolder.getId())
        verifyExpenseSiblingSlots(after, monthKey, expenseId, expenseFolder.getId(), attachments)
      } catch {
        throw new Error('EXPENSE_PRIVATE_FILE_INVALID')
      }
    },
    sha256Hex(value) {
      const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
      return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('')
    },
  }
}

type ExpenseDriveMetadata = GoogleAppsScript.Drive_v3.Drive.V3.Schema.File

function listExpenseFiles(folderId: string): ExpenseDriveMetadata[] {
  const advancedDrive = Drive
  if (!advancedDrive) throw new Error('invalid')
  const files: ExpenseDriveMetadata[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const response = advancedDrive.Files.list({
      q: `'${folderId}' in parents and trashed = false`,
      spaces: 'drive',
      fields: 'incompleteSearch,nextPageToken,files(id,name,description,mimeType,parents,trashed,size,version,appProperties,permissions(id,type,role,deleted))',
      pageSize: 100,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      ...(pageToken ? { pageToken } : {}),
    })
    if (response.incompleteSearch !== false) throw new Error('invalid')
    const nextFiles = response.files ?? []
    if (!Array.isArray(nextFiles)) throw new Error('invalid')
    files.push(...nextFiles)
    if (!response.nextPageToken) return files
    if (typeof response.nextPageToken !== 'string' || response.nextPageToken.length > 2_048) {
      throw new Error('invalid')
    }
    pageToken = response.nextPageToken
  }
  throw new Error('invalid')
}

function verifyExpenseSiblingSlots(
  files: ExpenseDriveMetadata[],
  monthKey: string,
  expenseId: string,
  folderId: string,
  attachments: ExpensePrivateAttachment[],
): void {
  if (files.length !== attachments.length || files.length < 1 || files.length > 5) {
    throw new Error('invalid')
  }
  for (const attachment of attachments) {
    const matches = files.filter((file) => (
      file.name === attachment.deterministicName
      || file.appProperties?.pmcExpenseId === expenseId
        && file.appProperties?.pmcExpenseOrdinal === String(attachment.ordinal)
      || file.appProperties?.pmcExpenseSlotClaimId === attachment.slotClaimId
    ))
    if (matches.length !== 1 || matches[0]?.id !== attachment.privateFileId) {
      throw new Error('invalid')
    }
    verifyExpenseFileMetadata(matches[0], monthKey, expenseId, folderId, attachment)
  }
}

function verifyExpenseFileMetadata(
  file: ExpenseDriveMetadata,
  monthKey: string,
  expenseId: string,
  folderId: string,
  attachment: ExpensePrivateAttachment,
): void {
  const description = JSON.stringify({
    originalFileName: attachment.originalFileName,
    uploadedAt: attachment.uploadedAt,
  })
  const expectedProperties: Record<string, string> = {
    pmcExpenseId: expenseId,
    pmcExpenseMonthKey: monthKey,
    pmcExpenseOrdinal: String(attachment.ordinal),
    pmcExpenseSha256: attachment.sha256,
    pmcExpenseSlotClaimId: attachment.slotClaimId,
    pmcExpenseRootRequestId: attachment.rootRequestId,
    pmcExpenseUploadedByStaffId: attachment.uploadedByStaffId,
    pmcExpenseAttachmentId: attachment.attachmentId,
    pmcExpenseMetadataSha256: sha256String(description),
  }
  const actualProperties = file.appProperties
  const permissions = file.permissions
  if (
    file.id !== attachment.privateFileId
    || file.name !== attachment.deterministicName
    || file.description !== description
    || file.mimeType !== attachment.mediaType
    || file.trashed !== false
    || !Array.isArray(file.parents)
    || file.parents.length !== 1
    || file.parents[0] !== folderId
    || Number(file.size) !== attachment.sizeBytes
    || file.version !== attachment.driveVersion
    || !isPrivateExpensePermissions(permissions)
    || !actualProperties
    || Object.keys(actualProperties).length !== Object.keys(expectedProperties).length
    || Object.keys(expectedProperties).some((key) => String(actualProperties[key] ?? '') !== expectedProperties[key])
  ) throw new Error('invalid')
}

function isPrivateExpensePermissions(
  permissions: GoogleAppsScript.Drive_v3.Drive.V3.Schema.Permission[] | undefined,
): boolean {
  return Array.isArray(permissions) && permissions.length > 0 && permissions.every((permission) => (
    typeof permission.id === 'string'
    && permission.id.length > 0
    && (permission.type === 'user' || permission.type === 'group')
    && typeof permission.role === 'string'
    && permission.role.length > 0
    && permission.deleted !== true
  ))
}

function sha256String(value: string): string {
  return digestHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value))
}

function sha256Bytes(value: number[]): string {
  return digestHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value))
}

function digestHex(bytes: number[]): string {
  return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('')
}

function requiredConfigId(value: string): string {
  const normalized = value.trim()
  if (!SAFE_ID.test(normalized)) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  return normalized
}

function hasDirectParent(
  parents: { hasNext(): boolean; next(): GoogleAppsScript.Drive.Folder },
  parentId: string,
): boolean {
  while (parents.hasNext()) {
    if (parents.next().getId() === parentId) return true
  }
  return false
}

function iteratorValues<T>(iterator: { hasNext(): boolean; next(): T }): T[] {
  const values: T[] = []
  while (iterator.hasNext()) values.push(iterator.next())
  return values
}

function uniqueOrCreateFolder(
  parent: GoogleAppsScript.Drive.Folder,
  name: string,
): GoogleAppsScript.Drive.Folder {
  const matches = iteratorValues(parent.getFoldersByName(name))
  if (matches.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  const folder = matches[0] ?? parent.createFolder(name)
  if (
    folder.isTrashed()
    || folder.getSharingAccess() !== DriveApp.Access.PRIVATE
    || !hasDirectParent(folder.getParents(), parent.getId())
  ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  return folder
}

function uniqueOrCreateSpreadsheet(
  folder: GoogleAppsScript.Drive.Folder,
  name: string,
): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const matches = iteratorValues(folder.getFilesByName(name))
    .filter((file) => file.getMimeType() === 'application/vnd.google-apps.spreadsheet' && !file.isTrashed())
  if (matches.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  if (matches[0]) return SpreadsheetApp.openById(matches[0].getId())
  const spreadsheet = SpreadsheetApp.create(name)
  DriveApp.getFileById(spreadsheet.getId()).moveTo(folder)
  return spreadsheet
}

function validateSchemas(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  schemas: Record<string, readonly string[]>,
): void {
  for (const [tab, expected] of Object.entries(schemas)) {
    const sheet = spreadsheet.getSheetByName(tab)
    if (!sheet || sheet.getLastColumn() !== expected.length) {
      throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    }
    const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0].map(String)
    if (actual.some((header, index) => header !== expected[index])) {
      throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    }
  }
}

function readRows(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  tab: string,
  headers: readonly string[],
): ExpenseStorageRow[] {
  const sheet = spreadsheet.getSheetByName(tab)
  if (!sheet) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  if (sheet.getLastRow() < 2) return []
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .map((values) => Object.fromEntries(headers.map((header, index) => [
      header,
      decodeCell(values[index] ?? ''),
    ])))
}

function appendRows(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  tab: string,
  headers: readonly string[],
  rows: ExpenseStorageRow[],
): void {
  if (rows.length === 0) return
  const sheet = spreadsheet.getSheetByName(tab)
  if (!sheet) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
    .setValues(rows.map((row) => headers.map((header) => encodeCell(row[header]))))
}

function updateRow(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  tab: string,
  headers: readonly string[],
  rowIndex: number,
  row: ExpenseStorageRow,
): void {
  const sheet = spreadsheet.getSheetByName(tab)
  if (!sheet || rowIndex < 0 || rowIndex >= sheet.getLastRow() - 1) {
    throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  }
  sheet.getRange(rowIndex + 2, 1, 1, headers.length)
    .setValues([headers.map((header) => encodeCell(row[header]))])
}

function replaceRows(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  tab: string,
  headers: readonly string[],
  rows: ExpenseStorageRow[],
): void {
  const sheet = spreadsheet.getSheetByName(tab)
  if (!sheet) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  const existing = Math.max(sheet.getLastRow() - 1, 0)
  if (existing > 0) sheet.getRange(2, 1, existing, headers.length).clearContent()
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length)
      .setValues(rows.map((row) => headers.map((header) => encodeCell(row[header]))))
  }
}

function encodeCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    return value.startsWith(LITERAL_TEXT_PREFIX) || /^\s*[=+\-@]/.test(value)
      ? `${LITERAL_TEXT_PREFIX}${value}`
      : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

function decodeCell(value: unknown): unknown {
  return typeof value === 'string' && value.startsWith(LITERAL_TEXT_PREFIX)
    ? value.slice(LITERAL_TEXT_PREFIX.length)
    : value
}
