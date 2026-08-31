import type { MiniAppExpenseCommand } from '../../../../shared/pmcMiniAppExpenseIngress'
import {
  canonicalExpenseAttachmentManifest,
  canonicalMiniAppExpenseEvidenceIngress,
  canonicalMiniAppExpenseIngress,
  canonicalMiniAppExpenseRecoveryIngress,
  canonicalMiniAppExpenseResumeIngress,
  isMiniAppExpenseSafeErrorCode,
  type ExpenseRecoveryCounts,
  type MiniAppExpenseEvidenceIngressEnvelope,
  type MiniAppExpenseEvidenceIngressResponse,
  type MiniAppExpenseIngressEnvelope,
  type MiniAppExpenseIngressResponse,
  type MiniAppExpenseRecoveryIngressEnvelope,
  type MiniAppExpenseRecoveryIngressResponse,
  type MiniAppExpenseResumeIngressEnvelope,
  type MiniAppExpenseResumeIngressResponse,
  type UnsignedMiniAppExpenseIngressEnvelope,
  type UnsignedMiniAppExpenseEvidenceIngressEnvelope,
  type UnsignedMiniAppExpenseRecoveryIngressEnvelope,
  type UnsignedMiniAppExpenseResumeIngressEnvelope,
} from '../../../../shared/pmcMiniAppExpenseIngress'
import type { ExpenseRepository } from '../ports'
import {
  authorizeExpenseEvidence,
  executeExpenseCommand,
  resolveExpenseResumeStatus,
  runExpenseRecovery,
} from './commands'

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'command', 'signature'] as const
const RECOVERY_ENVELOPE_KEYS = [
  'kind',
  'version',
  'timestamp',
  'nonce',
  'correlationId',
  'worker',
  'signature',
] as const
const RESUME_ENVELOPE_KEYS = [
  'kind', 'version', 'timestamp', 'nonce', 'rootRequestId', 'staffId', 'signature',
] as const

export interface ExpenseIngressPorts {
  clock: { nowIso(): string }
  locks: { withLock<T>(operation: () => T): T }
  config: {
    findStaffById(staffId: string): {
      id: string
      name: string
      active: boolean
      canSubmitExpense: boolean
      canManageExpense: boolean
    } | null
  }
  repositories: {
    lineDirectory: {
      hasNonce(nonce: string): boolean
      rememberNonce(nonce: string, capturedAt: string): void
    }
  }
  expense: ExpenseRepository
  expenseSecrets: { expenseIngressSecret(): string }
  crypto: {
    hmacSha256Hex(value: string, secret: string): string
    sha256Hex(value: string): string
    sha256BytesHex(value: number[]): string
    base64Decode(value: string): number[]
  }
  expenseCommandFingerprint(command: MiniAppExpenseCommand): string
  allocateExpenseId(monthKey: string): string
}

export function processExpenseEvidenceIngress(
  input: unknown,
  ports: ExpenseIngressPorts,
) {
  const envelope = verifyEvidenceEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) {
      throw new Error('mini app expense evidence ingress replay detected')
    }
    const payload = envelope.payload
    const authority = authorizeExpenseEvidence({
      rootRequestId: payload.rootRequestId,
      staffId: payload.staffId,
      expenseId: payload.expenseId,
      monthKey: payload.monthKey,
      expectedAttachmentCount: payload.manifest.length,
      expectedManifestHash: payload.expectedManifestHash,
    }, {
      clock: ports.clock,
      locks: { withLock: (operation) => operation() },
      staff: { findById: (staffId) => ports.config.findStaffById(staffId) },
      expense: ports.expense,
      crypto: { sha256Hex: ports.crypto.sha256Hex },
      commandFingerprint: ports.expenseCommandFingerprint,
      allocateExpenseId: ports.allocateExpenseId,
    })
    const manifestHash = ports.crypto.sha256Hex(canonicalExpenseAttachmentManifest(payload.manifest))
    const selected = payload.manifest[payload.ordinal - 1]
    const expectedAttachmentId = `ATT-${ports.crypto.sha256Hex(
      `${payload.rootRequestId}:${payload.expenseId}:${payload.ordinal}`,
    ).slice(0, 40)}`
    const expectedSlotClaimId = `SLOT-${ports.crypto.sha256Hex(JSON.stringify({
      rootRequestId: payload.rootRequestId,
      expenseId: payload.expenseId,
      ordinal: payload.ordinal,
      sha256: payload.sha256,
      mimeType: payload.mediaType,
      deterministicName: payload.deterministicName,
    }))}`
    let bytes: number[]
    try { bytes = ports.crypto.base64Decode(payload.bytesBase64).map((byte) => byte & 0xff) } catch { bytes = [] }
    if (
      manifestHash !== payload.expectedManifestHash
      || !selected
      || selected.sha256 !== payload.sha256
      || selected.mediaType !== payload.mediaType
      || selected.originalFileName !== payload.originalFileName
      || payload.attachmentId !== expectedAttachmentId
      || payload.slotClaimId !== expectedSlotClaimId
      || bytes.length < 1
      || bytes.length > 10_000_000
      || ports.crypto.sha256BytesHex(bytes) !== payload.sha256
      || !matchesExpenseEvidenceMagic(bytes, payload.mediaType)
    ) throw new Error('EXPENSE_PRIVATE_FILE_INVALID')
    if (authority.mode === 'FIND_ONLY') {
      const committed = authority.committedAttachments[payload.ordinal - 1]
      if (!committed
        || committed.attachmentId !== payload.attachmentId
        || committed.expenseId !== payload.expenseId
        || committed.rootRequestId !== payload.rootRequestId
        || committed.ordinal !== payload.ordinal
        || committed.mediaType !== payload.mediaType
        || committed.originalFileName !== payload.originalFileName
        || committed.deterministicName !== payload.deterministicName
        || committed.slotClaimId !== payload.slotClaimId
        || committed.sha256 !== payload.sha256
        || committed.uploadedByStaffId !== payload.staffId
        || committed.uploadedAt !== payload.uploadedAt
        || committed.sizeBytes !== bytes.length) throw new Error('EXPENSE_PRIVATE_FILE_INVALID')
    }
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    return ports.expense.createOrFindPrivateAttachment({
      mode: authority.mode,
      monthKey: payload.monthKey,
      attachment: {
        attachmentId: payload.attachmentId,
        expenseId: payload.expenseId,
        rootRequestId: payload.rootRequestId,
        ordinal: payload.ordinal,
        mediaType: payload.mediaType,
        originalFileName: payload.originalFileName,
        deterministicName: payload.deterministicName,
        slotClaimId: payload.slotClaimId,
        sha256: payload.sha256,
        uploadedByStaffId: payload.staffId,
        uploadedAt: payload.uploadedAt,
      },
      bytes,
    })
  })
}

function matchesExpenseEvidenceMagic(
  bytes: number[],
  mediaType: 'image/jpeg' | 'image/png',
): boolean {
  if (mediaType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
}

export function processExpenseEvidenceIngressResponse(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseEvidenceIngressResponse {
  try {
    return { ok: true, attachment: processExpenseEvidenceIngress(input, ports) }
  } catch (error) {
    return { ok: false, error: safeExpenseIngressError(error) }
  }
}

export function processExpenseIngress(
  input: unknown,
  ports: ExpenseIngressPorts,
) {
  const envelope = verifyEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) {
      throw new Error('mini app expense ingress replay detected')
    }
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    return executeExpenseCommand(envelope.command, {
      clock: ports.clock,
      locks: { withLock: (operation) => operation() },
      staff: { findById: (staffId) => ports.config.findStaffById(staffId) },
      expense: ports.expense,
      crypto: { sha256Hex: ports.crypto.sha256Hex },
      commandFingerprint: ports.expenseCommandFingerprint,
      allocateExpenseId: ports.allocateExpenseId,
    })
  })
}

export function processExpenseIngressResponse(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseIngressResponse {
  try {
    return { ok: true, result: processExpenseIngress(input, ports) }
  } catch (error) {
    return { ok: false, error: safeExpenseIngressError(error) }
  }
}

export function processExpenseRecoveryIngress(
  input: unknown,
  ports: ExpenseIngressPorts,
): ExpenseRecoveryCounts {
  const envelope = verifyRecoveryEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) {
      throw new Error('mini app expense recovery ingress replay detected')
    }
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    const result = runExpenseRecovery({
      clock: ports.clock,
      locks: { withLock: (operation) => operation() },
      staff: { findById: (staffId) => ports.config.findStaffById(staffId) },
      expense: ports.expense,
      crypto: { sha256Hex: ports.crypto.sha256Hex },
      commandFingerprint: ports.expenseCommandFingerprint,
      allocateExpenseId: ports.allocateExpenseId,
    })
    const failed = result.errors.length
    const unchanged = result.inspected - result.recovered - result.abandoned - failed
    if (
      unchanged < 0
      || result.recovered + result.abandoned + unchanged + failed > 100
    ) throw new Error('invalid expense recovery result')
    return {
      recovered: result.recovered,
      abandoned: result.abandoned,
      unchanged,
      failed,
    }
  })
}

export function processExpenseRecoveryIngressResponse(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseRecoveryIngressResponse {
  try {
    return { ok: true, result: processExpenseRecoveryIngress(input, ports) }
  } catch {
    return { ok: false, error: 'EXPENSE_STORAGE_UNAVAILABLE' }
  }
}

export function processExpenseResumeIngress(
  input: unknown,
  ports: ExpenseIngressPorts,
) {
  const envelope = verifyResumeEnvelope(input, ports)
  return ports.locks.withLock(() => {
    if (ports.repositories.lineDirectory.hasNonce(envelope.nonce)) {
      throw new Error('mini app expense resume ingress replay detected')
    }
    ports.repositories.lineDirectory.rememberNonce(envelope.nonce, ports.clock.nowIso())
    return resolveExpenseResumeStatus(envelope.rootRequestId, envelope.staffId, {
      clock: ports.clock,
      locks: { withLock: (operation) => operation() },
      staff: { findById: (staffId) => ports.config.findStaffById(staffId) },
      expense: ports.expense,
      crypto: { sha256Hex: ports.crypto.sha256Hex },
      commandFingerprint: ports.expenseCommandFingerprint,
      allocateExpenseId: ports.allocateExpenseId,
    })
  })
}

export function processExpenseResumeIngressResponse(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseResumeIngressResponse {
  try {
    return { ok: true, result: processExpenseResumeIngress(input, ports) }
  } catch (error) {
    return { ok: false, error: safeExpenseIngressError(error) }
  }
}

function safeExpenseIngressError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return isMiniAppExpenseSafeErrorCode(message) ? message : 'EXPENSE_STORAGE_UNAVAILABLE'
}

function verifyEnvelope(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseIngressEnvelope {
  if (!hasExactKeys(input, ENVELOPE_KEYS)) {
    throw new Error('invalid mini app expense ingress envelope')
  }
  if (
    input.kind !== 'MINI_APP_EXPENSE'
    || input.version !== 1
    || !Number.isSafeInteger(input.timestamp)
    || typeof input.nonce !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(input.nonce)
    || typeof input.signature !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.signature)
  ) throw new Error('invalid mini app expense ingress envelope')

  const unsigned: UnsignedMiniAppExpenseIngressEnvelope = {
    kind: 'MINI_APP_EXPENSE',
    version: 1,
    timestamp: input.timestamp as number,
    nonce: input.nonce,
    command: input.command as MiniAppExpenseCommand,
  }
  const canonical = canonicalMiniAppExpenseIngress(unsigned)
  const expected = ports.crypto.hmacSha256Hex(
    canonical,
    ports.expenseSecrets.expenseIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) {
    throw new Error('invalid mini app expense ingress signature')
  }
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app expense ingress timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function verifyEvidenceEnvelope(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseEvidenceIngressEnvelope {
  if (!isRecord(input) || !hasExactKeys(input, ['kind', 'version', 'timestamp', 'nonce', 'payload', 'signature'] as const)) {
    throw new Error('invalid mini app expense evidence envelope')
  }
  if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) {
    throw new Error('invalid mini app expense evidence signature')
  }
  const unsigned: UnsignedMiniAppExpenseEvidenceIngressEnvelope = {
    kind: input.kind as 'MINI_APP_EXPENSE_EVIDENCE',
    version: input.version as 1,
    timestamp: input.timestamp as number,
    nonce: input.nonce as string,
    payload: input.payload as UnsignedMiniAppExpenseEvidenceIngressEnvelope['payload'],
  }
  const canonical = canonicalMiniAppExpenseEvidenceIngress(unsigned)
  const expected = ports.crypto.hmacSha256Hex(canonical, ports.expenseSecrets.expenseIngressSecret())
  if (!constantTimeEqual(input.signature, expected)) throw new Error('invalid mini app expense evidence signature')
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app expense evidence timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function verifyRecoveryEnvelope(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseRecoveryIngressEnvelope {
  if (!hasExactKeys(input, RECOVERY_ENVELOPE_KEYS)) {
    throw new Error('invalid mini app expense recovery ingress envelope')
  }
  if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) {
    throw new Error('invalid mini app expense recovery ingress signature')
  }
  const unsigned: UnsignedMiniAppExpenseRecoveryIngressEnvelope = {
    kind: input.kind as 'MINI_APP_EXPENSE_RECOVERY',
    version: input.version as 1,
    timestamp: input.timestamp as number,
    nonce: input.nonce as string,
    correlationId: input.correlationId as string,
    worker: input.worker as UnsignedMiniAppExpenseRecoveryIngressEnvelope['worker'],
  }
  const canonical = canonicalMiniAppExpenseRecoveryIngress(unsigned)
  const expected = ports.crypto.hmacSha256Hex(
    canonical,
    ports.expenseSecrets.expenseIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) {
    throw new Error('invalid mini app expense recovery ingress signature')
  }
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app expense recovery ingress timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function verifyResumeEnvelope(
  input: unknown,
  ports: ExpenseIngressPorts,
): MiniAppExpenseResumeIngressEnvelope {
  if (!hasExactKeys(input, RESUME_ENVELOPE_KEYS)) {
    throw new Error('invalid mini app expense resume ingress envelope')
  }
  if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)) {
    throw new Error('invalid mini app expense resume ingress signature')
  }
  const unsigned: UnsignedMiniAppExpenseResumeIngressEnvelope = {
    kind: input.kind as 'MINI_APP_EXPENSE_RESUME',
    version: input.version as 1,
    timestamp: input.timestamp as number,
    nonce: input.nonce as string,
    rootRequestId: input.rootRequestId as string,
    staffId: input.staffId as string,
  }
  const canonical = canonicalMiniAppExpenseResumeIngress(unsigned)
  const expected = ports.crypto.hmacSha256Hex(
    canonical,
    ports.expenseSecrets.expenseIngressSecret(),
  )
  if (!constantTimeEqual(input.signature, expected)) {
    throw new Error('invalid mini app expense resume ingress signature')
  }
  const nowSeconds = Math.floor(Date.parse(ports.clock.nowIso()) / 1_000)
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - unsigned.timestamp) > 300) {
    throw new Error('expired mini app expense resume ingress timestamp')
  }
  return { ...unsigned, signature: input.signature }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
