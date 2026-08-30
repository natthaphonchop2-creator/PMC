import {
  deriveBookDailyKey,
  deriveExpenseScope,
  parseExpenseDate,
  projectMonthlyExpenses,
  type ExpenseAuditEvent,
  type ExpenseReceipt,
  type ExpenseSubmission,
} from '../../../../shared/pmcExpense'
import {
  canonicalMiniAppExpenseCommand,
  MINI_APP_EXPENSE_SAFE_ERROR_CODES,
  type ExpenseCommandResult,
  type ExpensePrivateAttachment,
  type MiniAppExpenseCommand,
  type MiniAppExpenseSafeErrorCode,
} from '../../../../shared/pmcMiniAppExpenseIngress'
import type {
  ExpenseBookRevisionClaim,
  ExpenseRecoveryCandidate,
  ExpenseRecoveryRequestSnapshot,
  ExpenseRepository,
} from '../ports'

export interface ExpenseCommandPorts {
  clock: { nowIso(): string }
  locks: { withLock<T>(operation: () => T): T }
  staff: {
    findById(staffId: string): {
      id: string
      name: string
      active: boolean
      canSubmitExpense: boolean
      canManageExpense: boolean
    } | null
  }
  expense: ExpenseRepository
  crypto: { sha256Hex(value: string): string }
  commandFingerprint(command: MiniAppExpenseCommand): string
  allocateExpenseId(monthKey: string): string
}

export interface ExpenseRecoveryResult {
  inspected: number
  recovered: number
  abandoned: number
  errors: MiniAppExpenseSafeErrorCode[]
}

type ExpenseActor = NonNullable<ReturnType<ExpenseCommandPorts['staff']['findById']>>
type PrepareCommand = Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }>
type CommitCommand = Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }>
type VoidCommand = Extract<MiniAppExpenseCommand, { commandType: 'VOID_EXPENSE' }>

interface PrepareAuditPayload {
  rootRequestId: string
  monthKey: string
  commandFingerprint: string
  expectedAttachmentCount: number
  expectedManifestHash: string
  expectedRevision: number
}

interface CommitAuditPayload {
  rootRequestId: string
  monthKey: string
  commandIdempotencyKey: string
  commandFingerprint: string
  expectedVersion: number
  expectedRevision: number
  expectedManifestHash: string
  committedAt: string
  supersedesExpenseId: string | null
  attachments: ExpensePrivateAttachment[]
}

interface StoredCommandSuccess {
  ok: true
  result: ExpenseCommandResult
}

interface StoredCommandFailure {
  ok: false
  error: MiniAppExpenseSafeErrorCode
}

interface ExpenseRecoveryContext {
  events: ExpenseAuditEvent[]
  request: ExpenseRecoveryRequestSnapshot | null
  bookRevisionClaims: ExpenseBookRevisionClaim[]
}

const SAFE_ERRORS = new Set<string>(MINI_APP_EXPENSE_SAFE_ERROR_CODES)
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9._:-]{1,124}$/

export function canonicalExpenseAttachmentManifest(
  attachments: readonly ExpensePrivateAttachment[],
): string {
  return JSON.stringify(attachments.map((attachment) => ({
    ordinal: attachment.ordinal,
    mediaType: attachment.mediaType,
    originalFileName: attachment.originalFileName,
    sha256: attachment.sha256,
  })))
}

export function executeExpenseCommand(
  command: MiniAppExpenseCommand,
  ports: ExpenseCommandPorts,
): ExpenseCommandResult {
  return ports.locks.withLock(() => executeExpenseCommandLocked(command, ports))
}

function executeExpenseCommandLocked(
  command: MiniAppExpenseCommand,
  ports: ExpenseCommandPorts,
): ExpenseCommandResult {
  const fingerprint = requireFingerprint(command, ports)
  if (command.commandType === 'PREPARE_EXPENSE') return prepareExpense(command, fingerprint, ports)
  if (command.commandType === 'COMMIT_EXPENSE') return commitExpense(command, fingerprint, ports)
  return voidExpense(command, fingerprint, ports)
}

function requireFingerprint(command: MiniAppExpenseCommand, ports: ExpenseCommandPorts): string {
  try {
    canonicalMiniAppExpenseCommand(command)
    const fingerprint = ports.commandFingerprint(command)
    if (!SHA256.test(fingerprint)) throw new Error('invalid')
    return fingerprint
  } catch {
    throw new Error('EXPENSE_INVALID_REQUEST')
  }
}

function requireSubmitter(staffId: string, ports: ExpenseCommandPorts): ExpenseActor {
  const actor = ports.staff.findById(staffId)
  if (!actor || actor.active !== true) throw new Error('EXPENSE_STAFF_REQUIRED')
  if (actor.canSubmitExpense !== true) throw new Error('EXPENSE_SUBMIT_PERMISSION_REQUIRED')
  return actor
}

function requireManager(actor: ExpenseActor): void {
  if (actor.canManageExpense !== true) throw new Error('EXPENSE_FINANCE_PERMISSION_REQUIRED')
}

function prepareExpense(
  command: PrepareCommand,
  fingerprint: string,
  ports: ExpenseCommandPorts,
): ExpenseCommandResult {
  const { expenseDate, monthKey } = parseExpenseDate(command.payload.expenseDate)
  const scope = deriveExpenseScope(command.payload.category)
  const bookDailyKey = deriveBookDailyKey(command.payload.category, expenseDate)
  if (command.payload.bookDailyKey !== bookDailyKey) throw new Error('EXPENSE_INVALID_REQUEST')
  if (command.payload.category === 'BILL_DOCUMENT') {
    if (
      command.payload.expectedRevision !== 0
      || !command.payload.counterpartyName?.trim()
      || command.payload.paymentMethod === null
    ) throw new Error('EXPENSE_INVALID_REQUEST')
  }
  const createdAt = ports.clock.nowIso()
  const candidateExpenseId = ports.allocateExpenseId(monthKey)
  const reservation = ports.expense.reserveRequest({
    commandIdempotencyKey: command.commandIdempotencyKey,
    rootRequestId: command.rootRequestId,
    commandType: command.commandType,
    commandFingerprint: fingerprint,
    expenseId: candidateExpenseId,
    monthKey,
    createdAt,
  })
  if (reservation.resultJson !== null) return replayStoredOutcome(reservation.resultJson)
  if (reservation.monthKey !== monthKey) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
  const actor = requireSubmitter(command.staffId, ports)
  if (command.payload.category !== 'BILL_DOCUMENT' && command.payload.expectedRevision > 0) {
    requireManager(actor)
  }
  ports.expense.ensureMonth(monthKey, createdAt)

  const revision = command.payload.category === 'BILL_DOCUMENT'
    ? 1
    : command.payload.expectedRevision + 1
  const priorPrepareAudits = ports.expense.auditForExpense(reservation.expenseId)
    .filter((event) => event.action === 'PREPARE')
  if (priorPrepareAudits.length > 1) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  const priorPrepareAudit = priorPrepareAudits[0]
  if (
    priorPrepareAudit
    && (
      priorPrepareAudit.actorStaffId !== actor.id
      || priorPrepareAudit.correlationId !== command.commandIdempotencyKey
      || JSON.stringify(parseJsonRecord(priorPrepareAudit.afterJson)) !== JSON.stringify({
        rootRequestId: command.rootRequestId,
        monthKey,
        commandFingerprint: fingerprint,
        expectedAttachmentCount: command.payload.expectedAttachmentCount,
        expectedManifestHash: command.payload.expectedManifestHash,
        expectedRevision: command.payload.expectedRevision,
      })
    )
  ) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
  const submittedAt = priorPrepareAudit?.createdAt ?? createdAt
  const proposed: ExpenseSubmission = {
    expenseId: reservation.expenseId,
    expenseDate,
    monthKey,
    category: command.payload.category,
    scope,
    amountSatang: command.payload.amountSatang,
    counterpartyName: command.payload.counterpartyName,
    description: command.payload.description,
    paymentMethod: command.payload.paymentMethod,
    recordState: 'PREPARED',
    bookDailyKey,
    revision,
    supersedesExpenseId: null,
    submittedByStaffId: actor.id,
    submittedByName: actor.name,
    submittedAt,
    committedAt: null,
    updatedAt: submittedAt,
    version: 1,
    idempotencyKey: command.rootRequestId,
  }
  const existing = ports.expense.getSubmission(monthKey, reservation.expenseId)
  const submission = existing ?? proposed
  if (existing && !samePreparedIntent(existing, proposed)) {
    throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
  }
  const preparePayload: PrepareAuditPayload = {
    rootRequestId: command.rootRequestId,
    monthKey,
    commandFingerprint: fingerprint,
    expectedAttachmentCount: command.payload.expectedAttachmentCount,
    expectedManifestHash: command.payload.expectedManifestHash,
    expectedRevision: command.payload.expectedRevision,
  }
  ports.expense.appendAudit({
    eventId: auditEventId(fingerprint, 'P'),
    expenseId: submission.expenseId,
    actorStaffId: actor.id,
    action: 'PREPARE',
    beforeJson: '{}',
    afterJson: JSON.stringify(preparePayload),
    createdAt: submittedAt,
    correlationId: command.commandIdempotencyKey,
  })
  if (!existing) ports.expense.insertPrepared(submission)
  const result: ExpenseCommandResult = {
    commandType: 'PREPARE_EXPENSE',
    expenseId: submission.expenseId,
    monthKey,
    recordState: 'PREPARED',
    version: submission.version,
    expectedRevision: command.payload.expectedRevision,
    expectedAttachmentCount: command.payload.expectedAttachmentCount,
    expectedManifestHash: command.payload.expectedManifestHash,
  }
  completeSuccess(command.commandIdempotencyKey, fingerprint, result, ports)
  return result
}

function commitExpense(
  command: CommitCommand,
  fingerprint: string,
  ports: ExpenseCommandPorts,
): ExpenseCommandResult {
  const monthKey = monthFromExpenseId(command.payload.expenseId)
  const now = ports.clock.nowIso()
  const reservation = ports.expense.reserveRequest({
    commandIdempotencyKey: command.commandIdempotencyKey,
    rootRequestId: command.rootRequestId,
    commandType: command.commandType,
    commandFingerprint: fingerprint,
    expenseId: command.payload.expenseId,
    monthKey,
    createdAt: now,
  })
  if (reservation.resultJson !== null) return replayStoredOutcome(reservation.resultJson)
  if (reservation.expenseId !== command.payload.expenseId || reservation.monthKey !== monthKey) {
    throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
  }
  const actor = requireSubmitter(command.staffId, ports)
  const existingCommit = ports.expense.auditForExpense(command.payload.expenseId)
    .find((event) => event.action === 'COMMIT' && event.correlationId === command.commandIdempotencyKey)
  if (existingCommit) {
    return finishDurableCommit(parseCommitAudit(existingCommit), ports)
  }

  const submission = ports.expense.getSubmission(monthKey, command.payload.expenseId)
  if (!submission) throw new Error('EXPENSE_NOT_FOUND')
  if (
    submission.recordState !== 'PREPARED'
    || submission.version !== command.payload.expectedVersion
    || submission.idempotencyKey !== command.rootRequestId
    || submission.submittedByStaffId !== actor.id
  ) throw new Error('EXPENSE_NOT_PREPARED')
  validateStoredSubmission(submission, command.payload.expectedRevision)
  const prepare = requirePrepareAudit(submission, ports)
  if (
    prepare.rootRequestId !== command.rootRequestId
    || prepare.monthKey !== monthKey
    || prepare.expectedRevision !== command.payload.expectedRevision
    || prepare.expectedManifestHash !== command.payload.expectedManifestHash
  ) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')

  ports.expense.verifyPrivateAttachments(monthKey, submission.expenseId, command.payload.attachments)
  validateAttachmentManifest(command, submission, prepare, ports)

  let supersedesExpenseId: string | null = null
  if (submission.bookDailyKey !== null) {
    if (command.payload.expectedRevision > 0) requireManager(actor)
    const authority = bookRevisionAuthority(monthKey, submission.bookDailyKey, null, ports)
    if ((authority?.revision ?? 0) !== command.payload.expectedRevision) {
      completeFailure(
        command.commandIdempotencyKey,
        fingerprint,
        'EXPENSE_REVISION_CONFLICT',
        ports,
      )
      throw new Error('EXPENSE_REVISION_CONFLICT')
    }
    supersedesExpenseId = authority?.expenseId ?? null
  } else if (command.payload.expectedRevision !== 0) {
    throw new Error('EXPENSE_REVISION_CONFLICT')
  }

  const payload: CommitAuditPayload = {
    rootRequestId: command.rootRequestId,
    monthKey,
    commandIdempotencyKey: command.commandIdempotencyKey,
    commandFingerprint: fingerprint,
    expectedVersion: command.payload.expectedVersion,
    expectedRevision: command.payload.expectedRevision,
    expectedManifestHash: command.payload.expectedManifestHash,
    committedAt: now,
    supersedesExpenseId,
    attachments: command.payload.attachments,
  }
  ports.expense.appendAudit({
    eventId: auditEventId(fingerprint, 'C'),
    expenseId: submission.expenseId,
    actorStaffId: actor.id,
    action: 'COMMIT',
    beforeJson: JSON.stringify(submission),
    afterJson: JSON.stringify(payload),
    createdAt: now,
    correlationId: command.commandIdempotencyKey,
  })
  return finishDurableCommit(payload, ports)
}

function finishDurableCommit(
  payload: CommitAuditPayload,
  ports: ExpenseCommandPorts,
  recoveryContext?: ExpenseRecoveryContext,
): ExpenseCommandResult {
  const expenseId = payload.attachments[0]?.expenseId ?? ''
  const submission = ports.expense.getSubmission(payload.monthKey, expenseId)
  if (!submission) throw new Error('EXPENSE_NOT_FOUND')
  validateStoredSubmission(submission, payload.expectedRevision)
  const prepare = requirePrepareAudit(submission, ports, recoveryContext?.events)
  if (
    prepare.rootRequestId !== payload.rootRequestId
    || prepare.monthKey !== payload.monthKey
    || prepare.expectedRevision !== payload.expectedRevision
    || prepare.expectedManifestHash !== payload.expectedManifestHash
    || submission.idempotencyKey !== payload.rootRequestId
  ) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')

  ports.expense.verifyPrivateAttachments(payload.monthKey, expenseId, payload.attachments)
  validateAttachments(
    payload.attachments,
    submission,
    prepare.expectedAttachmentCount,
    payload.expectedManifestHash,
    ports,
  )

  if (submission.recordState === 'PREPARED') {
    if (submission.version !== payload.expectedVersion) throw new Error('EXPENSE_NOT_PREPARED')
    if (submission.bookDailyKey !== null) {
      const authority = bookRevisionAuthority(
        payload.monthKey,
        submission.bookDailyKey,
        expenseId,
        ports,
        recoveryContext?.bookRevisionClaims,
      )
      if (
        (authority?.revision ?? 0) !== payload.expectedRevision
        || (authority?.expenseId ?? null) !== payload.supersedesExpenseId
      ) throw new Error('EXPENSE_REVISION_CONFLICT')
    }
  } else if (
    submission.recordState !== 'COMMITTED'
    || submission.committedAt !== payload.committedAt
    || submission.supersedesExpenseId !== payload.supersedesExpenseId
  ) {
    throw new Error('EXPENSE_NOT_PREPARED')
  }

  const existingAttachmentIds = new Set(
    ports.expense.listAttachments(payload.monthKey, expenseId).map(({ attachmentId }) => attachmentId),
  )
  ports.expense.appendAttachments(
    payload.monthKey,
    payload.attachments.filter(({ attachmentId }) => !existingAttachmentIds.has(attachmentId)),
  )
  const committed = submission.recordState === 'COMMITTED'
    ? submission
    : ports.expense.updateSubmission(payload.monthKey, expenseId, payload.expectedVersion, {
        recordState: 'COMMITTED',
        committedAt: payload.committedAt,
        updatedAt: payload.committedAt,
        supersedesExpenseId: payload.supersedesExpenseId,
      })

  if (payload.supersedesExpenseId) {
    ports.expense.appendAudit({
      eventId: auditEventId(payload.commandFingerprint, 'S'),
      expenseId,
      actorStaffId: committed.submittedByStaffId,
      action: 'SUPERSEDE',
      beforeJson: JSON.stringify({ expenseId: payload.supersedesExpenseId }),
      afterJson: JSON.stringify({ supersededByExpenseId: expenseId }),
      createdAt: payload.committedAt,
      correlationId: payload.commandIdempotencyKey,
    }, recoveryContext?.events)
  }
  ports.expense.replaceMonthlySummary(
    payload.monthKey,
    projectMonthlyExpenses(ports.expense.listMonth(payload.monthKey), payload.monthKey),
    ports.clock.nowIso(),
  )
  const receipt = receiptFromSubmission(committed)
  const result: ExpenseCommandResult = { commandType: 'COMMIT_EXPENSE', ...receipt }
  if (recoveryContext) {
    const eventId = auditEventId(payload.commandFingerprint, 'R')
    const existing = recoveryContext.events.find((event) => event.eventId === eventId)
    ports.expense.appendAudit({
      eventId,
      expenseId,
      actorStaffId: committed.submittedByStaffId,
      action: 'RECOVER',
      beforeJson: '{}',
      afterJson: JSON.stringify({ recordState: 'COMMITTED' }),
      createdAt: existing?.createdAt ?? ports.clock.nowIso(),
      correlationId: payload.commandIdempotencyKey,
    }, recoveryContext.events)
    if (!recoveryContext.request) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  }
  completeSuccess(
    payload.commandIdempotencyKey,
    payload.commandFingerprint,
    result,
    ports,
    recoveryContext?.request,
  )
  return result
}

function voidExpense(
  command: VoidCommand,
  fingerprint: string,
  ports: ExpenseCommandPorts,
): ExpenseCommandResult {
  const monthKey = monthFromExpenseId(command.payload.expenseId)
  const now = ports.clock.nowIso()
  const reservation = ports.expense.reserveRequest({
    commandIdempotencyKey: command.commandIdempotencyKey,
    rootRequestId: command.rootRequestId,
    commandType: command.commandType,
    commandFingerprint: fingerprint,
    expenseId: command.payload.expenseId,
    monthKey,
    createdAt: now,
  })
  if (reservation.resultJson !== null) return replayStoredOutcome(reservation.resultJson)
  const actor = requireSubmitter(command.staffId, ports)
  requireManager(actor)
  const submission = ports.expense.getSubmission(monthKey, command.payload.expenseId)
  if (!submission) throw new Error('EXPENSE_NOT_FOUND')
  const eventId = auditEventId(fingerprint, 'V')
  const priorVoid = ports.expense.getAuditByEventId(eventId)
  const afterJson = JSON.stringify({
    rootRequestId: command.rootRequestId,
    commandFingerprint: fingerprint,
    reason: command.payload.reason,
  })
  if (
    priorVoid
    && (
      priorVoid.expenseId !== submission.expenseId
      || priorVoid.actorStaffId !== actor.id
      || priorVoid.action !== 'VOID'
      || priorVoid.afterJson !== afterJson
      || priorVoid.correlationId !== command.commandIdempotencyKey
    )
  ) throw new Error('EXPENSE_IDEMPOTENCY_CONFLICT')
  if (
    !priorVoid
    && (submission.recordState === 'VOID' || submission.version !== command.payload.expectedVersion)
  ) throw new Error('EXPENSE_NOT_PREPARED')
  if (
    priorVoid
    && submission.recordState !== 'VOID'
    && submission.version !== command.payload.expectedVersion
  ) throw new Error('EXPENSE_NOT_PREPARED')
  const durableVoid = ports.expense.appendAudit({
    eventId,
    expenseId: submission.expenseId,
    actorStaffId: actor.id,
    action: 'VOID',
    beforeJson: priorVoid?.beforeJson ?? JSON.stringify(submission),
    afterJson,
    createdAt: priorVoid?.createdAt ?? now,
    correlationId: command.commandIdempotencyKey,
  }, priorVoid ? [priorVoid] : [])
  const voided = submission.recordState === 'VOID'
    ? submission
    : ports.expense.updateSubmission(monthKey, submission.expenseId, command.payload.expectedVersion, {
        recordState: 'VOID',
        updatedAt: durableVoid.createdAt,
      })
  ports.expense.replaceMonthlySummary(
    monthKey,
    projectMonthlyExpenses(ports.expense.listMonth(monthKey), monthKey),
    durableVoid.createdAt,
  )
  const result: ExpenseCommandResult = {
    commandType: 'VOID_EXPENSE',
    expenseId: voided.expenseId,
    recordState: 'VOID',
    version: voided.version,
    updatedAt: voided.updatedAt,
  }
  completeSuccess(command.commandIdempotencyKey, fingerprint, result, ports)
  return result
}

export function runExpenseRecovery(ports: ExpenseCommandPorts): ExpenseRecoveryResult {
  return ports.locks.withLock(() => {
    const result: ExpenseRecoveryResult = { inspected: 0, recovered: 0, abandoned: 0, errors: [] }
    for (const candidate of ports.expense.listRecoveryCandidates(100)) {
      result.inspected += 1
      try {
        const commit = candidate.events.find((event) => event.action === 'COMMIT')
        if (commit) {
          try {
            finishDurableCommit(parseCommitAudit(commit), ports, {
              events: candidate.events,
              request: candidate.commitRequest,
              bookRevisionClaims: candidate.bookRevisionClaims,
            })
            result.recovered += 1
            continue
          } catch (error) {
            if (
              safeExpenseError(error) === 'EXPENSE_PRIVATE_FILE_INVALID'
              && recoveryAgeHours(candidate.preparedAt, ports.clock.nowIso()) >= 48
            ) {
              abandonRecoveryCandidate(candidate, ports)
              result.abandoned += 1
              continue
            }
            throw error
          }
        }
        if (recoveryAgeHours(candidate.preparedAt, ports.clock.nowIso()) < 48) continue
        abandonRecoveryCandidate(candidate, ports)
        result.abandoned += 1
      } catch (error) {
        const code = safeExpenseError(error)
        if (!result.errors.includes(code)) result.errors.push(code)
      }
    }
    return result
  })
}

function abandonRecoveryCandidate(
  candidate: ExpenseRecoveryCandidate,
  ports: ExpenseCommandPorts,
): void {
  const submission = ports.expense.getSubmission(candidate.monthKey, candidate.expenseId)
  if (submission && submission.recordState !== 'PREPARED') {
    throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  }
  const beforeJson = JSON.stringify(submission ?? {})
  if (submission?.recordState === 'PREPARED') {
    ports.expense.updateSubmission(candidate.monthKey, candidate.expenseId, submission.version, {
      recordState: 'VOID',
      updatedAt: ports.clock.nowIso(),
    })
  }
  if (submission) {
    ports.expense.replaceMonthlySummary(
      candidate.monthKey,
      projectMonthlyExpenses(ports.expense.listMonth(candidate.monthKey), candidate.monthKey),
      ports.clock.nowIso(),
    )
  }
  const prepare = candidate.events.find((event) => event.action === 'PREPARE')
  if (!prepare) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  ports.expense.appendAudit({
    eventId: auditEventIdFromExpense(candidate.expenseId, 'A'),
    expenseId: candidate.expenseId,
    actorStaffId: prepare.actorStaffId,
    action: 'ABANDON',
    beforeJson,
    afterJson: JSON.stringify({ recordState: 'VOID' }),
    createdAt: ports.clock.nowIso(),
    correlationId: `${candidate.rootRequestId}:prepare`,
  }, candidate.events)
}

function recoveryAgeHours(preparedAt: string, now: string): number {
  const age = (Date.parse(now) - Date.parse(preparedAt)) / 3_600_000
  return Number.isFinite(age) ? age : -1
}

function requirePrepareAudit(
  submission: ExpenseSubmission,
  ports: ExpenseCommandPorts,
  knownEvents?: readonly ExpenseAuditEvent[],
): PrepareAuditPayload {
  const events = (knownEvents ?? ports.expense.auditForExpense(submission.expenseId))
    .filter((event) => event.action === 'PREPARE')
  if (events.length !== 1 || events[0]?.actorStaffId !== submission.submittedByStaffId) {
    throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  }
  const payload = parseJsonRecord(events[0].afterJson)
  if (
    events[0].eventId !== auditEventId(String(payload.commandFingerprint ?? ''), 'P')
    || events[0].correlationId !== `${String(payload.rootRequestId ?? '')}:prepare`
    || typeof payload.rootRequestId !== 'string'
    || typeof payload.monthKey !== 'string'
    || !SHA256.test(String(payload.commandFingerprint ?? ''))
    || !Number.isSafeInteger(payload.expectedAttachmentCount)
    || !SHA256.test(String(payload.expectedManifestHash ?? ''))
    || !Number.isSafeInteger(payload.expectedRevision)
  ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  return payload as unknown as PrepareAuditPayload
}

function parseCommitAudit(event: ExpenseAuditEvent): CommitAuditPayload {
  const payload = parseJsonRecord(event.afterJson)
  if (
    typeof payload.rootRequestId !== 'string'
    || typeof payload.monthKey !== 'string'
    || typeof payload.commandIdempotencyKey !== 'string'
    || !SHA256.test(String(payload.commandFingerprint ?? ''))
    || !Number.isSafeInteger(payload.expectedVersion)
    || !Number.isSafeInteger(payload.expectedRevision)
    || !SHA256.test(String(payload.expectedManifestHash ?? ''))
    || typeof payload.committedAt !== 'string'
    || !Number.isFinite(Date.parse(payload.committedAt))
    || !Array.isArray(payload.attachments)
    || payload.attachments.length < 1
    || payload.attachments.length > 5
    || payload.commandIdempotencyKey !== event.correlationId
    || event.eventId !== auditEventId(String(payload.commandFingerprint ?? ''), 'C')
    || payload.attachments.some((attachment, index) => (
      !attachment
      || typeof attachment !== 'object'
      || Array.isArray(attachment)
      || !SAFE_ID.test(String((attachment as Record<string, unknown>).attachmentId ?? ''))
      || (attachment as Record<string, unknown>).expenseId !== event.expenseId
      || (attachment as Record<string, unknown>).uploadedByStaffId !== event.actorStaffId
      || (attachment as Record<string, unknown>).ordinal !== index + 1
      || !SHA256.test(String((attachment as Record<string, unknown>).sha256 ?? ''))
    ))
  ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  return payload as unknown as CommitAuditPayload
}

function validateAttachmentManifest(
  command: CommitCommand,
  submission: ExpenseSubmission,
  prepare: PrepareAuditPayload,
  ports: ExpenseCommandPorts,
): void {
  validateAttachments(
    command.payload.attachments,
    submission,
    prepare.expectedAttachmentCount,
    command.payload.expectedManifestHash,
    ports,
  )
}

function bookRevisionAuthority(
  monthKey: string,
  bookDailyKey: string,
  excludedExpenseId: string | null,
  ports: ExpenseCommandPorts,
  knownClaims?: ExpenseBookRevisionClaim[],
): ExpenseSubmission | null {
  const committed = ports.expense.effectiveByBookDailyKey(monthKey, bookDailyKey)
  const claims = (knownClaims ?? ports.expense.listBookRevisionClaims(monthKey, bookDailyKey))
    .filter(({ submission }) => submission.expenseId !== excludedExpenseId)
    .map(({ submission, commitAudit }) => {
      const payload = parseCommitAudit(commitAudit)
      validateStoredSubmission(submission, payload.expectedRevision)
      if (
        submission.recordState !== 'PREPARED'
        || submission.bookDailyKey !== bookDailyKey
        || payload.monthKey !== monthKey
        || payload.attachments[0]?.expenseId !== submission.expenseId
      ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
      return submission
    })
  const candidates = [...(committed ? [committed] : []), ...claims]
    .sort((left, right) => right.revision - left.revision)
  if (
    candidates[0]
    && candidates[1]
    && candidates[0].revision === candidates[1].revision
    && candidates[0].expenseId !== candidates[1].expenseId
  ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  return candidates[0] ?? null
}

function validateAttachments(
  attachments: ExpensePrivateAttachment[],
  submission: ExpenseSubmission,
  expectedCount: number,
  expectedManifestHash: string,
  ports: ExpenseCommandPorts,
): void {
  if (
    attachments.length !== expectedCount
    || attachments.some((attachment, index) => (
      attachment.ordinal !== index + 1
      || attachment.expenseId !== submission.expenseId
      || attachment.rootRequestId !== submission.idempotencyKey
      || attachment.uploadedByStaffId !== submission.submittedByStaffId
    ))
    || new Set(attachments.map(({ attachmentId }) => attachmentId)).size !== attachments.length
    || ports.crypto.sha256Hex(canonicalExpenseAttachmentManifest(attachments)) !== expectedManifestHash
  ) throw new Error('EXPENSE_INVALID_ATTACHMENTS')
}

function receiptFromSubmission(submission: ExpenseSubmission): ExpenseReceipt {
  if (submission.recordState !== 'COMMITTED' || !submission.committedAt) {
    throw new Error('EXPENSE_NOT_PREPARED')
  }
  return {
    expenseId: submission.expenseId,
    receiptNumber: submission.expenseId,
    expenseDate: submission.expenseDate,
    monthKey: submission.monthKey,
    category: submission.category,
    scope: submission.scope,
    amountSatang: submission.amountSatang,
    recordState: 'COMMITTED',
    revision: submission.revision,
    committedAt: submission.committedAt,
    unreviewed: true,
  }
}

function validateStoredSubmission(
  submission: ExpenseSubmission,
  expectedRevision: number,
): void {
  try {
    if (
      submission.category !== 'BILL_DOCUMENT'
      && submission.category !== 'BOOK_CLINIC'
      && submission.category !== 'BOOK_DOCTOR_PERSONAL'
    ) throw new Error('invalid')
    const parsed = parseExpenseDate(submission.expenseDate)
    const expectedBookKey = deriveBookDailyKey(submission.category, submission.expenseDate)
    const expectedStoredRevision = submission.category === 'BILL_DOCUMENT'
      ? 1
      : expectedRevision + 1
    if (
      parsed.monthKey !== submission.monthKey
      || submission.scope !== deriveExpenseScope(submission.category)
      || submission.bookDailyKey !== expectedBookKey
      || submission.revision !== expectedStoredRevision
      || (submission.category === 'BILL_DOCUMENT' && expectedRevision !== 0)
      || !Number.isSafeInteger(submission.amountSatang)
      || submission.amountSatang <= 0
    ) throw new Error('invalid')
  } catch {
    throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  }
}

function completeSuccess(
  commandIdempotencyKey: string,
  fingerprint: string,
  result: ExpenseCommandResult,
  ports: ExpenseCommandPorts,
  knownRequest?: ExpenseRecoveryRequestSnapshot | null,
): void {
  const stored: StoredCommandSuccess = { ok: true, result }
  ports.expense.completeRequest({
    commandIdempotencyKey,
    commandFingerprint: fingerprint,
    resultJson: JSON.stringify(stored),
    updatedAt: ports.clock.nowIso(),
  }, knownRequest ?? undefined)
}

function completeFailure(
  commandIdempotencyKey: string,
  fingerprint: string,
  error: MiniAppExpenseSafeErrorCode,
  ports: ExpenseCommandPorts,
): void {
  const stored: StoredCommandFailure = { ok: false, error }
  ports.expense.completeRequest({
    commandIdempotencyKey,
    commandFingerprint: fingerprint,
    resultJson: JSON.stringify(stored),
    updatedAt: ports.clock.nowIso(),
  })
}

function replayStoredOutcome(resultJson: string): ExpenseCommandResult {
  const parsed = parseJsonRecord(resultJson)
  if (
    hasExactKeys(parsed, ['ok', 'error'])
    && parsed.ok === false
    && typeof parsed.error === 'string'
    && SAFE_ERRORS.has(parsed.error)
  ) {
    throw new Error(parsed.error)
  }
  if (!hasExactKeys(parsed, ['ok', 'result']) || parsed.ok !== true) {
    throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  }
  return parseStoredCommandResult(parsed.result)
}

function parseStoredCommandResult(value: unknown): ExpenseCommandResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  }
  const result = value as Record<string, unknown>
  if (result.commandType === 'PREPARE_EXPENSE') {
    if (
      !hasExactKeys(result, [
        'commandType', 'expenseId', 'monthKey', 'recordState', 'version', 'expectedRevision',
        'expectedAttachmentCount', 'expectedManifestHash',
      ])
      || !SAFE_ID.test(String(result.expenseId ?? ''))
      || !validStoredMonth(String(result.monthKey ?? ''), String(result.expenseId ?? ''))
      || result.recordState !== 'PREPARED'
      || result.version !== 1
      || !safeInteger(result.expectedRevision, 0)
      || !safeInteger(result.expectedAttachmentCount, 1)
      || result.expectedAttachmentCount > 5
      || typeof result.expectedManifestHash !== 'string'
      || !SHA256.test(result.expectedManifestHash)
    ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    return {
      commandType: 'PREPARE_EXPENSE',
      expenseId: result.expenseId as string,
      monthKey: result.monthKey as string,
      recordState: 'PREPARED',
      version: result.version,
      expectedRevision: result.expectedRevision,
      expectedAttachmentCount: result.expectedAttachmentCount,
      expectedManifestHash: result.expectedManifestHash,
    }
  }
  if (result.commandType === 'COMMIT_EXPENSE') {
    if (
      !hasExactKeys(result, [
        'commandType', 'expenseId', 'receiptNumber', 'expenseDate', 'monthKey', 'category',
        'scope', 'amountSatang', 'recordState', 'revision', 'committedAt', 'unreviewed',
      ])
      || !SAFE_ID.test(String(result.expenseId ?? ''))
      || result.receiptNumber !== result.expenseId
      || typeof result.expenseDate !== 'string'
      || typeof result.monthKey !== 'string'
      || !validStoredDate(result.expenseDate, result.monthKey, result.expenseId as string)
      || !isStoredCategory(result.category)
      || result.scope !== deriveExpenseScope(result.category)
      || !safeInteger(result.amountSatang, 1)
      || result.recordState !== 'COMMITTED'
      || !safeInteger(result.revision, 1)
      || typeof result.committedAt !== 'string'
      || !Number.isFinite(Date.parse(result.committedAt))
      || result.unreviewed !== true
    ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    return {
      commandType: 'COMMIT_EXPENSE',
      expenseId: result.expenseId as string,
      receiptNumber: result.receiptNumber as string,
      expenseDate: result.expenseDate,
      monthKey: result.monthKey,
      category: result.category,
      scope: deriveExpenseScope(result.category),
      amountSatang: result.amountSatang,
      recordState: 'COMMITTED',
      revision: result.revision,
      committedAt: result.committedAt,
      unreviewed: true,
    }
  }
  if (result.commandType === 'VOID_EXPENSE') {
    if (
      !hasExactKeys(result, ['commandType', 'expenseId', 'recordState', 'version', 'updatedAt'])
      || !validStoredExpenseId(String(result.expenseId ?? ''))
      || result.recordState !== 'VOID'
      || !safeInteger(result.version, 2)
      || typeof result.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(result.updatedAt))
    ) throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
    return {
      commandType: 'VOID_EXPENSE',
      expenseId: result.expenseId as string,
      recordState: 'VOID',
      version: result.version,
      updatedAt: result.updatedAt,
    }
  }
  throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function safeInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function isStoredCategory(value: unknown): value is ExpenseSubmission['category'] {
  return value === 'BILL_DOCUMENT' || value === 'BOOK_CLINIC' || value === 'BOOK_DOCTOR_PERSONAL'
}

function validStoredMonth(monthKey: string, expenseId: string): boolean {
  try {
    return parseExpenseDate(`${monthKey}-01`).monthKey === monthKey
      && monthFromExpenseId(expenseId) === monthKey
  } catch {
    return false
  }
}

function validStoredExpenseId(expenseId: string): boolean {
  try {
    monthFromExpenseId(expenseId)
    return true
  } catch {
    return false
  }
}

function validStoredDate(expenseDate: string, monthKey: string, expenseId: string): boolean {
  try {
    return parseExpenseDate(expenseDate).monthKey === monthKey
      && monthFromExpenseId(expenseId) === monthKey
  } catch {
    return false
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    return parsed as Record<string, unknown>
  } catch {
    throw new Error('EXPENSE_STORAGE_UNAVAILABLE')
  }
}

function monthFromExpenseId(expenseId: string): string {
  const match = expenseId.match(/^EXP-(\d{4})(\d{2})-[A-Za-z0-9._:-]{1,107}$/)
  if (!match) throw new Error('EXPENSE_INVALID_REQUEST')
  const monthKey = `${match[1]}-${match[2]}`
  parseExpenseDate(`${monthKey}-01`)
  return monthKey
}

function auditEventId(fingerprint: string, suffix: 'P' | 'C' | 'S' | 'V' | 'R'): string {
  return `EAUD:${fingerprint.slice(0, 48)}:${suffix}`
}

function auditEventIdFromExpense(expenseId: string, suffix: 'A'): string {
  return `EAUD:${expenseId}:${suffix}`.slice(0, 124)
}

function samePreparedIntent(left: ExpenseSubmission, right: ExpenseSubmission): boolean {
  return JSON.stringify({
    ...left,
    submittedByName: '',
    submittedAt: '',
    updatedAt: '',
  }) === JSON.stringify({
    ...right,
    submittedByName: '',
    submittedAt: '',
    updatedAt: '',
  })
}

function safeExpenseError(error: unknown): MiniAppExpenseSafeErrorCode {
  const message = error instanceof Error ? error.message : ''
  return SAFE_ERRORS.has(message)
    ? message as MiniAppExpenseSafeErrorCode
    : 'EXPENSE_STORAGE_UNAVAILABLE'
}
