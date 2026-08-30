import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppExpenseCommand,
  canonicalMiniAppExpenseIngress,
  canonicalMiniAppExpenseRecoveryIngress,
  type MiniAppExpenseCommand,
} from '../../shared/pmcMiniAppExpenseIngress'

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
  payload: { expenseId: 'EXP-202608-1', expectedVersion: 2, reason: 'duplicate entry' },
}

describe('expense ingress contract', () => {
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
