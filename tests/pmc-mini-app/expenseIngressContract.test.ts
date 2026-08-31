import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalExpenseAttachmentManifest,
  canonicalMiniAppExpenseCommand,
  canonicalMiniAppExpenseIngress,
  canonicalMiniAppExpenseEvidenceIngress,
  expenseFilePublicProperties,
  canonicalMiniAppExpenseRecoveryIngress,
  canonicalMiniAppExpenseResumeIngress,
  isExpenseIngressResumeStatus,
  isExpenseResumeStatus,
  type MiniAppExpenseCommand,
  type UnsignedMiniAppExpenseEvidenceIngressEnvelope,
} from '../../shared/pmcMiniAppExpenseIngress'
import { expenseAttachmentManifestHash } from '../../server/pmc-mini-app/finance/submissionService'

const manifestHash = 'a'.repeat(64)

const prepareCommand: MiniAppExpenseCommand = {
  rootRequestId: 'expense-request-1',
  commandIdempotencyKey: 'expense-request-1:prepare',
  staffId: 'ADMIN_01',
  commandType: 'PREPARE_EXPENSE',
  payload: {
    expenseDate: '2026-08-29',
    category: 'BOOK_CLINIC',
    bookDailyKey: 'CLINIC:2026-08-29',
    amountSatang: 12_000,
    counterpartyName: null,
    description: 'สมุดประจำวันที่ 29',
    paymentMethod: null,
    expectedAttachmentCount: 2,
    expectedManifestHash: manifestHash,
    expectedRevision: 0,
  },
}

const commitCommand: MiniAppExpenseCommand = {
  rootRequestId: 'expense-request-1',
  commandIdempotencyKey: 'expense-request-1:commit',
  staffId: 'ADMIN_01',
  commandType: 'COMMIT_EXPENSE',
  payload: {
    expenseId: 'EXP-202608-1',
    expectedVersion: 1,
    expectedRevision: 0,
    expectedManifestHash: manifestHash,
    attachments: [
      {
        attachmentId: 'ATT-1',
        expenseId: 'EXP-202608-1',
        rootRequestId: 'expense-request-1',
        ordinal: 1,
        mediaType: 'image/jpeg',
        originalFileName: 'receipt-1.jpg',
        privateFileId: 'private-file-1',
        deterministicName: `001-${'b'.repeat(64)}.jpg`,
        sizeBytes: 1_024,
        driveVersion: '7',
        slotClaimId: `SLOT-${'d'.repeat(64)}`,
        sha256: 'b'.repeat(64),
        uploadedByStaffId: 'ADMIN_01',
        uploadedAt: '2026-08-29T10:00:00+07:00',
      },
      {
        attachmentId: 'ATT-2',
        expenseId: 'EXP-202608-1',
        rootRequestId: 'expense-request-1',
        ordinal: 2,
        mediaType: 'image/png',
        originalFileName: 'receipt-2.png',
        privateFileId: 'private-file-2',
        deterministicName: `002-${'c'.repeat(64)}.png`,
        sizeBytes: 2_048,
        driveVersion: '8',
        slotClaimId: `SLOT-${'e'.repeat(64)}`,
        sha256: 'c'.repeat(64),
        uploadedByStaffId: 'ADMIN_01',
        uploadedAt: '2026-08-29T10:01:00+07:00',
      },
    ],
  },
}

const voidCommand: MiniAppExpenseCommand = {
  rootRequestId: 'expense-request-1',
  commandIdempotencyKey: 'expense-request-1:void',
  staffId: 'ADMIN_01',
  commandType: 'VOID_EXPENSE',
  payload: { expenseId: 'EXP-202608-1', expectedVersion: 2, expectedRevision: 1, reason: 'duplicate entry' },
}

describe('expense ingress contract', () => {
  it('uses one cross-runtime canonical attachment manifest and exact 160-character filename boundary', () => {
    const attachments = (commitCommand as Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }>).payload.attachments
    const canonical = canonicalExpenseAttachmentManifest(attachments)
    expect(expenseAttachmentManifestHash(attachments)).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    )
    expect(() => canonicalExpenseAttachmentManifest([{ ...attachments[0]!, originalFileName: `${'ก'.repeat(156)}.jpg` }]))
      .not.toThrow()
    expect(() => canonicalExpenseAttachmentManifest([{ ...attachments[0]!, originalFileName: `${'ก'.repeat(157)}.jpg` }]))
      .toThrow('invalid mini app expense attachment manifest')
  })
  it('produces deterministic field-order canonical JSON for every command phase', () => {
    expect(canonicalMiniAppExpenseCommand(prepareCommand)).toBe(
      '{"rootRequestId":"expense-request-1","commandIdempotencyKey":"expense-request-1:prepare","staffId":"ADMIN_01","commandType":"PREPARE_EXPENSE","payload":{"expenseDate":"2026-08-29","category":"BOOK_CLINIC","bookDailyKey":"CLINIC:2026-08-29","amountSatang":12000,"counterpartyName":null,"description":"สมุดประจำวันที่ 29","paymentMethod":null,"expectedAttachmentCount":2,"expectedManifestHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expectedRevision":0}}',
    )
    expect(canonicalMiniAppExpenseCommand(commitCommand)).toContain(
      `"privateFileId":"private-file-1","deterministicName":"001-${'b'.repeat(64)}.jpg","sizeBytes":1024,"driveVersion":"7","slotClaimId":"SLOT-${'d'.repeat(64)}","sha256":"${'b'.repeat(64)}"`,
    )
    expect(canonicalMiniAppExpenseCommand(voidCommand)).toContain('"commandType":"VOID_EXPENSE"')
    expect(canonicalMiniAppExpenseCommand(structuredClone(prepareCommand))).toBe(
      canonicalMiniAppExpenseCommand(prepareCommand),
    )
  })

  it('canonicalizes a validated unsigned envelope in its fixed order', () => {
    expect(canonicalMiniAppExpenseIngress({
      kind: 'MINI_APP_EXPENSE',
      version: 1,
      timestamp: 1_788_000_000,
      nonce: 'nonce-0001',
      command: prepareCommand,
    })).toBe(
      '{"kind":"MINI_APP_EXPENSE","version":1,"timestamp":1788000000,"nonce":"nonce-0001","command":{"rootRequestId":"expense-request-1","commandIdempotencyKey":"expense-request-1:prepare","staffId":"ADMIN_01","commandType":"PREPARE_EXPENSE","payload":{"expenseDate":"2026-08-29","category":"BOOK_CLINIC","bookDailyKey":"CLINIC:2026-08-29","amountSatang":12000,"counterpartyName":null,"description":"สมุดประจำวันที่ 29","paymentMethod":null,"expectedAttachmentCount":2,"expectedManifestHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expectedRevision":0}}}',
    )
  })

  it('binds recovery to one verified worker identity and correlation ID in fixed-order canonical JSON', () => {
    expect(canonicalMiniAppExpenseRecoveryIngress({
      kind: 'MINI_APP_EXPENSE_RECOVERY',
      version: 1,
      timestamp: 1_788_000_000,
      nonce: 'recovery-nonce-0001',
      correlationId: 'expense-recovery-0001',
      worker: {
        email: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
        subject: 'google-subject-0001',
      },
    })).toBe(
      '{"kind":"MINI_APP_EXPENSE_RECOVERY","version":1,"timestamp":1788000000,"nonce":"recovery-nonce-0001","correlationId":"expense-recovery-0001","worker":{"email":"pmc-mini-app-task-invoker@example.iam.gserviceaccount.com","subject":"google-subject-0001"}}',
    )
  })

  it('canonicalizes a minimal submitter-owned resume envelope with no form or evidence data', () => {
    const canonical = canonicalMiniAppExpenseResumeIngress({
      kind: 'MINI_APP_EXPENSE_RESUME', version: 1, timestamp: 1_788_000_000,
      nonce: 'resume-nonce-123', rootRequestId: 'expense-request-1', staffId: 'ADMIN_01',
    })
    expect(canonical).toBe(
      '{"kind":"MINI_APP_EXPENSE_RESUME","version":1,"timestamp":1788000000,"nonce":"resume-nonce-123","rootRequestId":"expense-request-1","staffId":"ADMIN_01"}',
    )
    expect(canonical).not.toContain('amountSatang')
    expect(canonical).not.toContain('attachment')
  })

  it('binds owner-created expense evidence to the prepared manifest, exact slot, and bytes', () => {
    const envelope: UnsignedMiniAppExpenseEvidenceIngressEnvelope = {
      kind: 'MINI_APP_EXPENSE_EVIDENCE',
      version: 1,
      timestamp: 1_788_000_000,
      nonce: 'expense-evidence-nonce-1',
      payload: {
        rootRequestId: 'expense-request-1',
        expenseId: 'EXP-202608-1',
        monthKey: '2026-08',
        staffId: 'ADMIN_01',
        expectedManifestHash: manifestHash,
        manifest: [{
          ordinal: 1,
          mediaType: 'image/jpeg',
          originalFileName: 'receipt-1.jpg',
          sha256: 'b'.repeat(64),
        }],
        attachmentId: `ATT-${'c'.repeat(40)}`,
        ordinal: 1,
        mediaType: 'image/jpeg',
        originalFileName: 'receipt-1.jpg',
        deterministicName: `001-${'b'.repeat(64)}.jpg`,
        slotClaimId: `SLOT-${'d'.repeat(64)}`,
        sha256: 'b'.repeat(64),
        uploadedAt: '2026-08-29T10:00:00.000Z',
        bytesBase64: '/9j/',
      },
    }

    const canonical = canonicalMiniAppExpenseEvidenceIngress(envelope)
    expect(canonical).toContain('"kind":"MINI_APP_EXPENSE_EVIDENCE"')
    expect(canonical).toContain(`"slotClaimId":"SLOT-${'d'.repeat(64)}"`)
    expect(canonical).toContain('"bytesBase64":"/9j/"')
    expect(() => canonicalMiniAppExpenseEvidenceIngress({
      ...envelope,
      payload: { ...envelope.payload, privateFolderId: 'forbidden' },
    } as never)).toThrow('invalid mini app expense evidence payload')
  })

  it('hashes long cross-principal identities into exact public Drive properties below 124 bytes', () => {
    const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
    const properties = expenseFilePublicProperties({
      monthKey: '2026-08',
      attachment: {
        attachmentId: `ATT-${'a'.repeat(40)}`,
        expenseId: `EXP-202608-${'x'.repeat(107)}`,
        rootRequestId: 'r'.repeat(124),
        ordinal: 1,
        mediaType: 'image/jpeg',
        originalFileName: 'receipt.jpg',
        deterministicName: `001-${'b'.repeat(64)}.jpg`,
        slotClaimId: `SLOT-${'c'.repeat(64)}`,
        sha256: 'b'.repeat(64),
        uploadedByStaffId: 's'.repeat(124),
        uploadedAt: '2026-08-29T10:00:00.000Z',
      },
    }, sha)

    expect(Object.keys(properties)).toHaveLength(10)
    expect(Object.entries(properties).every(([key, value]) => key.length + value.length <= 124)).toBe(true)
    expect(JSON.stringify(properties)).not.toContain('r'.repeat(124))
    expect(JSON.stringify(properties)).not.toContain('s'.repeat(124))
    expect(JSON.stringify(properties)).not.toContain(`EXP-202608-${'x'.repeat(107)}`)
  })

  it.each([
    ['impossible calendar date', { expenseDate: '2026-08-32' }],
    ['expense ID month mismatch', {
      expenseId: 'EXP-202607-RESULT', receiptNumber: 'EXP-202607-RESULT',
    }],
    ['non-canonical committed timestamp', { committedAt: '2026-08-30 04:00:00Z' }],
    ['wrong terminal state', { recordState: 'PREPARED' }],
    ['zero revision', { revision: 0 }],
    ['unexpected lifecycle version', { version: 2 }],
  ])('rejects a COMMITTED resume receipt with %s', (_case, patch) => {
    const receipt = {
      expenseId: 'EXP-202608-RESULT', receiptNumber: 'EXP-202608-RESULT',
      expenseDate: '2026-08-30', monthKey: '2026-08', category: 'BILL_DOCUMENT',
      scope: 'CLINIC', amountSatang: 12_000, recordState: 'COMMITTED', revision: 1,
      committedAt: '2026-08-30T04:00:00.000Z', unreviewed: true,
      ...patch,
    }

    expect(isExpenseResumeStatus({ status: 'COMMITTED', receipt })).toBe(false)
  })

  it('accepts only the exact explicit PREPARED resume status', () => {
    expect(isExpenseResumeStatus({ status: 'PREPARED' })).toBe(true)
    expect(isExpenseResumeStatus({ status: 'PREPARED', requestId: 'private' })).toBe(false)
    expect(isExpenseIngressResumeStatus({ status: 'PREPARED', expenseId: 'EXP-202608-RESULT' })).toBe(true)
    expect(isExpenseIngressResumeStatus({ status: 'PREPARED' })).toBe(false)
  })

  it('rejects unknown or unsafe recovery worker fields before signing', () => {
    const recovery = {
      kind: 'MINI_APP_EXPENSE_RECOVERY' as const,
      version: 1 as const,
      timestamp: 1_788_000_000,
      nonce: 'recovery-nonce-0001',
      correlationId: 'expense-recovery-0001',
      worker: {
        email: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
        subject: 'google-subject-0001',
      },
    }

    expect(() => canonicalMiniAppExpenseRecoveryIngress({
      ...recovery,
      worker: { ...recovery.worker, lineUserId: 'private-line-id' },
    } as never)).toThrow('invalid mini app expense recovery worker')
    expect(() => canonicalMiniAppExpenseRecoveryIngress({
      ...recovery,
      worker: { ...recovery.worker, email: 'ordinary-user@example.test' },
    })).toThrow('invalid mini app expense recovery worker')
    expect(() => canonicalMiniAppExpenseRecoveryIngress({
      ...recovery,
      privateFolderId: 'private-folder-id',
    } as never)).toThrow('invalid mini app expense recovery envelope')
  })

  it('rejects unknown fields at every signed contract boundary', () => {
    expect(() => canonicalMiniAppExpenseCommand({ ...prepareCommand, injected: true } as never))
      .toThrow('invalid mini app expense command')
    expect(() => canonicalMiniAppExpenseCommand({
      ...prepareCommand,
      payload: { ...prepareCommand.payload, injected: true },
    } as never)).toThrow('invalid mini app expense command payload')
    expect(() => canonicalMiniAppExpenseIngress({
      kind: 'MINI_APP_EXPENSE', version: 1, timestamp: 1_788_000_000, nonce: 'nonce-0001', command: prepareCommand,
      injected: true,
    } as never)).toThrow('invalid mini app expense envelope')
  })

  it('requires a separate phase-specific idempotency key', () => {
    expect(() => canonicalMiniAppExpenseCommand({
      ...commitCommand,
      commandIdempotencyKey: 'expense-request-1:prepare',
    })).toThrow('invalid mini app expense command phase key')
  })

  it('rejects unsafe IDs and hashes and attachment order that differs from ordinal', () => {
    expect(() => canonicalMiniAppExpenseCommand({ ...prepareCommand, staffId: 'ADMIN 01' }))
      .toThrow('invalid mini app expense command')
    expect(() => canonicalMiniAppExpenseCommand({
      ...commitCommand,
      payload: { ...commitCommand.payload, expectedManifestHash: 'A'.repeat(64) },
    })).toThrow('invalid mini app expense command payload')
    expect(() => canonicalMiniAppExpenseCommand({
      ...commitCommand,
      payload: {
        ...commitCommand.payload,
        attachments: [commitCommand.payload.attachments[1]!, commitCommand.payload.attachments[0]!],
      },
    })).toThrow('invalid mini app expense attachment order')
    expect(() => canonicalMiniAppExpenseCommand({
      ...commitCommand,
      payload: {
        ...commitCommand.payload,
        attachments: [{ ...commitCommand.payload.attachments[0]!, driveVersion: '0' }],
      },
    })).toThrow('invalid mini app expense attachment')
    expect(() => canonicalMiniAppExpenseCommand({
      ...commitCommand,
      payload: {
        ...commitCommand.payload,
        attachments: [{ ...commitCommand.payload.attachments[0]!, deterministicName: 'receipt.jpg' }],
      },
    })).toThrow('invalid mini app expense attachment')
  })
})
