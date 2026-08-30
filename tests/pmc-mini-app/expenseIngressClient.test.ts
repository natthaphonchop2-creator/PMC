import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  ExpenseCommandResult,
  MiniAppExpenseCommand,
} from '../../shared/pmcMiniAppExpenseIngress'
import {
  buildMiniAppExpenseIngress,
  createExpenseIngressClient,
} from '../../server/pmc-mini-app/finance/ingressClient'

const MANIFEST_HASH = 'a'.repeat(64)

describe('signed private expense ingress client', () => {
  it('signs the exact canonical expense envelope without exposing its distinct secret', () => {
    const built = buildMiniAppExpenseIngress(prepareCommand(), {
      timestamp: 1_800_000_000,
      nonce: 'expense-nonce-123',
    }, 'expense-ingress-secret')
    const canonical = '{"kind":"MINI_APP_EXPENSE","version":1,"timestamp":1800000000,"nonce":"expense-nonce-123","command":{"rootRequestId":"expense-request-1","commandIdempotencyKey":"expense-request-1:prepare","staffId":"ADMIN_01","commandType":"PREPARE_EXPENSE","payload":{"expenseDate":"2026-08-29","category":"BOOK_CLINIC","bookDailyKey":"CLINIC:2026-08-29","amountSatang":12000,"counterpartyName":null,"description":"สมุดประจำวันที่ 29","paymentMethod":null,"expectedAttachmentCount":2,"expectedManifestHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expectedRevision":0}}}'

    expect(built.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.stringify({ ...built.body, signature: undefined })).toContain('MINI_APP_EXPENSE')
    expect(built.body.signature).toBe(
      createHmac('sha256', 'expense-ingress-secret').update(canonical).digest('hex'),
    )
    expect(JSON.stringify(built.body)).not.toContain('expense-ingress-secret')
  })

  it('accepts only the exact PREPARE and COMMIT result variants for the sent phase', async () => {
    const prepare = prepareResult()
    const commit = commitResult()
    const receipt = Object.fromEntries(
      Object.entries(commit).filter(([key]) => key !== 'commandType'),
    )
    const request = vi.fn()
      .mockResolvedValueOnce(response(200, { ok: true, result: prepare }))
      .mockResolvedValueOnce(response(200, { ok: true, result: commit }))
    const client = clientWith(request)

    await expect(client.prepare(prepareCommand())).resolves.toEqual(prepare)
    await expect(client.commit(commitCommand())).resolves.toEqual(receipt)

    const sent = request.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as {
      command: MiniAppExpenseCommand
    })
    expect(sent.map(({ command }) => command.commandIdempotencyKey)).toEqual([
      'expense-request-1:prepare',
      'expense-request-1:commit',
    ])
  })

  it('sends and strictly parses the manager-only VOID result variant', async () => {
    const request = vi.fn(async () => response(200, { ok: true, result: voidResult() }))
    const client = clientWith(request)

    await expect(client.void(voidCommand())).resolves.toEqual(voidResult())
    const sent = JSON.parse(String(request.mock.calls[0]?.[1].body)) as {
      command: MiniAppExpenseCommand
    }
    expect(sent.command).toEqual(voidCommand())

    const malformed = clientWith(vi.fn(async () => response(200, {
      ok: true, result: { ...voidResult(), approvalState: 'APPROVED' },
    })))
    await expect(malformed.void(voidCommand())).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE', retryable: true,
    })
  })

  it.each([
    ['success with an extra key', { ok: true, result: prepareResult(), private: 'detail' }],
    ['PREPARE with COMMIT result', { ok: true, result: commitResult() }],
    ['PREPARE with the wrong month', { ok: true, result: { ...prepareResult(), monthKey: '2026-09' } }],
    ['PREPARE with the wrong revision', { ok: true, result: { ...prepareResult(), expectedRevision: 1 } }],
    ['success result with an extra key', { ok: true, result: { ...prepareResult(), private: 'detail' } }],
    ['error with an extra key', { ok: false, error: 'EXPENSE_REVISION_CONFLICT', private: 'detail' }],
    ['unknown error', { ok: false, error: 'EXPENSE_PRIVATE_PROVIDER_DETAIL' }],
  ])('rejects malformed exact response union: %s', async (_name, body) => {
    const client = clientWith(vi.fn(async () => response(200, body)))
    await expect(client.prepare(prepareCommand())).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
      message: 'Expense ingress failed: EXPENSE_STORAGE_UNAVAILABLE',
    })
  })

  it('propagates only allowlisted business errors with a stable retry classification', async () => {
    const conflict = clientWith(vi.fn(async () => response(200, {
      ok: false,
      error: 'EXPENSE_REVISION_CONFLICT',
    })))
    const unavailable = clientWith(vi.fn(async () => response(200, {
      ok: false,
      error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })))

    await expect(conflict.prepare(prepareCommand())).rejects.toMatchObject({
      code: 'EXPENSE_REVISION_CONFLICT',
      retryable: false,
    })
    await expect(unavailable.prepare(prepareCommand())).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
      retryable: true,
    })
  })

  it.each([
    ['non-2xx response', vi.fn(async () => response(503, { private: 'provider body' }))],
    ['invalid JSON', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('private body') } }))],
    ['transport cause', vi.fn(async () => { throw new Error('private transport cause') })],
  ])('maps %s to one safe retryable error without URL, body, secret, or cause', async (_name, request) => {
    const client = clientWith(request)
    let failure: unknown
    try {
      await client.prepare(prepareCommand())
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
      retryable: true,
      message: 'Expense ingress failed: EXPENSE_STORAGE_UNAVAILABLE',
    })
    expect(JSON.stringify(failure)).not.toMatch(/script\.google|provider body|private body|transport cause|expense-ingress-secret/)
  })

  it('aborts at the configured timeout and returns the same safe retryable error', async () => {
    const request = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('private abort detail')))
    }))
    const client = createExpenseIngressClient({
      url: 'https://script.google.com/macros/s/deployment/exec',
      secret: 'expense-ingress-secret',
      timeoutMs: 1,
      now: () => 1_800_000_000,
      nonce: () => 'expense-nonce-123',
      fetch: request,
    })

    await expect(client.prepare(prepareCommand())).rejects.toMatchObject({
      code: 'EXPENSE_STORAGE_UNAVAILABLE',
      retryable: true,
      message: 'Expense ingress failed: EXPENSE_STORAGE_UNAVAILABLE',
    })
    expect(request.mock.calls[0]?.[1].signal.aborted).toBe(true)
  })
})

function clientWith(request: ReturnType<typeof vi.fn>) {
  return createExpenseIngressClient({
    url: 'https://script.google.com/macros/s/deployment/exec',
    secret: 'expense-ingress-secret',
    now: () => 1_800_000_000,
    nonce: () => 'expense-nonce-123',
    fetch: request,
  })
}

function prepareCommand(): Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }> {
  return {
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
      expectedManifestHash: MANIFEST_HASH,
      expectedRevision: 0,
    },
  }
}

function commitCommand(): Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }> {
  return {
    rootRequestId: 'expense-request-1',
    commandIdempotencyKey: 'expense-request-1:commit',
    staffId: 'ADMIN_01',
    commandType: 'COMMIT_EXPENSE',
    payload: {
      expenseId: 'EXP-202608-0001',
      expectedVersion: 1,
      expectedRevision: 0,
      expectedManifestHash: MANIFEST_HASH,
      attachments: [{
        attachmentId: 'ATT-0001',
        expenseId: 'EXP-202608-0001',
        rootRequestId: 'expense-request-1',
        ordinal: 1,
        mediaType: 'image/jpeg',
        originalFileName: 'receipt.jpg',
        privateFileId: 'private-file-1',
        deterministicName: `001-${'b'.repeat(64)}.jpg`,
        sizeBytes: 1_024,
        driveVersion: '7',
        slotClaimId: `SLOT-${'c'.repeat(64)}`,
        sha256: 'b'.repeat(64),
        uploadedByStaffId: 'ADMIN_01',
        uploadedAt: '2026-08-29T10:00:00.000Z',
      }],
    },
  }
}

function voidCommand(): Extract<MiniAppExpenseCommand, { commandType: 'VOID_EXPENSE' }> {
  return {
    rootRequestId: 'expense-void-1',
    commandIdempotencyKey: 'expense-void-1:void',
    staffId: 'ADMIN_01',
    commandType: 'VOID_EXPENSE',
    payload: {
      expenseId: 'EXP-202608-0001',
      expectedVersion: 2,
      reason: 'ยอดรวมบันทึกผิด',
    },
  }
}

function prepareResult(): Extract<ExpenseCommandResult, { commandType: 'PREPARE_EXPENSE' }> {
  return {
    commandType: 'PREPARE_EXPENSE',
    expenseId: 'EXP-202608-0001',
    monthKey: '2026-08',
    recordState: 'PREPARED',
    version: 1,
    expectedRevision: 0,
    expectedAttachmentCount: 2,
    expectedManifestHash: MANIFEST_HASH,
  }
}

function commitResult(): Extract<ExpenseCommandResult, { commandType: 'COMMIT_EXPENSE' }> {
  return {
    commandType: 'COMMIT_EXPENSE',
    expenseId: 'EXP-202608-0001',
    receiptNumber: 'EXP-202608-0001',
    expenseDate: '2026-08-29',
    monthKey: '2026-08',
    category: 'BOOK_CLINIC',
    scope: 'CLINIC',
    amountSatang: 12_000,
    recordState: 'COMMITTED',
    revision: 1,
    committedAt: '2026-08-29T10:02:00.000Z',
    unreviewed: true,
  }
}

function voidResult(): Extract<ExpenseCommandResult, { commandType: 'VOID_EXPENSE' }> {
  return {
    commandType: 'VOID_EXPENSE',
    expenseId: 'EXP-202608-0001',
    recordState: 'VOID',
    version: 3,
    updatedAt: '2026-08-29T10:03:00.000Z',
  }
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
