import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalExpenseAttachmentManifest,
  canonicalMiniAppExpenseCommand,
  canonicalMiniAppExpenseEvidenceIngress,
  canonicalMiniAppExpenseIngress,
  canonicalMiniAppExpenseRecoveryIngress,
  canonicalMiniAppExpenseResumeIngress,
  type MiniAppExpenseCommand,
  type MiniAppExpenseIngressEnvelope,
  type MiniAppExpenseEvidenceIngressEnvelope,
  type MiniAppExpenseRecoveryIngressEnvelope,
  type MiniAppExpenseResumeIngressEnvelope,
  MAX_EXPENSE_EVIDENCE_INGRESS_LENGTH,
} from '../../../shared/pmcMiniAppExpenseIngress'
import { processBookingDoPost } from '../src/entrypoints'
import {
  processExpenseIngress,
  processExpenseEvidenceIngressResponse,
  processExpenseIngressResponse,
  processExpenseRecoveryIngressResponse,
  processExpenseResumeIngressResponse,
  type ExpenseIngressPorts,
} from '../src/expense/ingress'
import { createTestPorts } from './helpers/fakes'
import {
  EXPENSE_NOW,
  createExpenseTestPorts,
  commitCommand,
  prepareCommand,
  prepareWithManifest,
} from './helpers/expenseFakes'
import { executeExpenseCommand, type ExpenseCommandPorts } from '../src/expense/commands'

const SECRET = 'expense-ingress-secret'
const NOW_SECONDS = Math.floor(Date.parse(EXPENSE_NOW) / 1_000)

describe('Apps Script Mini App expense ingress', () => {
  it('creates owner-backed evidence only for the exact prepared manifest and replays one file', () => {
    const ports = createExpenseIngressPorts()
    const bytes = [0xff, 0xd8, 0xff, 0xd9]
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    const manifest = [{ ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'receipt.jpg', sha256 }]
    const rootRequestId = 'owner-evidence-1'
    const prepared = processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId,
      commandIdempotencyKey: `${rootRequestId}:prepare`,
      payload: {
        ...prepareCommand().payload,
        expectedManifestHash: createHash('sha256')
          .update(canonicalExpenseAttachmentManifest(manifest), 'utf8').digest('hex'),
      },
    }), 'owner-evidence-prepare'), ports)
    if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected prepare result')

    const first = processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId,
      expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash,
      manifest,
      bytes,
    }, 'owner-evidence-upload-1'), ports)
    const replay = processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId,
      expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash,
      manifest,
      bytes,
    }, 'owner-evidence-upload-2'), ports)

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      ok: true,
      attachment: {
        expenseId: prepared.expenseId,
        rootRequestId,
        ordinal: 1,
        mediaType: 'image/jpeg',
        sha256,
        uploadedByStaffId: 'STAFF_01',
      },
    })
    expect(ports.expenseBackend.ownerCreatedFiles).toHaveLength(1)

    const routed = createRoutedPorts()
    const routedRoot = 'owner-evidence-routed'
    const routedPrepare = processBookingDoPost(event(signedEnvelope(prepareCommand({
      rootRequestId: routedRoot,
      commandIdempotencyKey: `${routedRoot}:prepare`,
      payload: {
        ...prepareCommand().payload,
        expectedManifestHash: createHash('sha256')
          .update(canonicalExpenseAttachmentManifest(manifest), 'utf8').digest('hex'),
      },
    }), 'owner-evidence-routed-prepare')), routed)
    const routedResult = routedPrepare as { ok?: unknown; result?: Record<string, unknown> }
    if (routedResult.ok !== true || !routedResult.result) {
      throw new Error('unexpected routed prepare result')
    }
    expect(processBookingDoPost(event(signedEvidenceEnvelope({
      rootRequestId: routedRoot,
      expenseId: String(routedResult.result.expenseId),
      expectedManifestHash: String(routedResult.result.expectedManifestHash),
      manifest,
      bytes,
    }, 'owner-evidence-routed-upload')), routed)).toMatchObject({
      ok: true,
      attachment: { rootRequestId: routedRoot, ordinal: 1 },
    })
  })

  it('rejects advertised JPEG metadata when owner-ingress bytes have PNG magic', () => {
    const ports = createExpenseIngressPorts()
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    const manifest = [{ ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'receipt.jpg', sha256 }]
    const rootRequestId = 'owner-evidence-mime-mismatch'
    const prepared = processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId,
      commandIdempotencyKey: `${rootRequestId}:prepare`,
      payload: {
        ...prepareCommand().payload,
        expectedManifestHash: createHash('sha256')
          .update(canonicalExpenseAttachmentManifest(manifest), 'utf8').digest('hex'),
      },
    }), 'owner-evidence-mime-prepare'), ports)
    if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected prepare result')

    expect(processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId, expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash, manifest, bytes,
    }, 'owner-evidence-mime-upload'), ports)).toEqual({
      ok: false,
      error: 'EXPENSE_PRIVATE_FILE_INVALID',
    })
    expect(ports.expenseBackend.ownerCreatedFiles).toHaveLength(0)
  })

  it('rejects expense evidence postData larger than its exact route limit before JSON parsing', () => {
    const routed = createRoutedPorts()
    expect(() => processBookingDoPost({
      postData: {
        contents: '{"kind":"MINI_APP_EXPENSE_EVIDENCE"}',
        length: MAX_EXPENSE_EVIDENCE_INGRESS_LENGTH + 1,
        name: 'postData',
        type: 'application/json',
      },
    }, routed)).toThrow('invalid mini app ingress event')
  })

  it('fails closed before owner storage for a mixed prepared manifest', () => {
    const ports = createExpenseIngressPorts()
    const originalBytes = [0xff, 0xd8, 0xff, 0xd9]
    const originalSha = createHash('sha256').update(Buffer.from(originalBytes)).digest('hex')
    const originalManifest = [{
      ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'receipt.jpg', sha256: originalSha,
    }]
    const rootRequestId = 'owner-evidence-mixed'
    const prepared = processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId,
      commandIdempotencyKey: `${rootRequestId}:prepare`,
      payload: {
        ...prepareCommand().payload,
        expectedManifestHash: createHash('sha256')
          .update(canonicalExpenseAttachmentManifest(originalManifest), 'utf8').digest('hex'),
      },
    }), 'owner-evidence-mixed-prepare'), ports)
    if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected prepare result')
    const differentBytes = [0xff, 0xd8, 0xff, 0xda]
    const differentSha = createHash('sha256').update(Buffer.from(differentBytes)).digest('hex')

    expect(processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId,
      expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash,
      manifest: [{
        ordinal: 1, mediaType: 'image/jpeg', originalFileName: 'different.jpg', sha256: differentSha,
      }],
      bytes: differentBytes,
    }, 'owner-evidence-mixed-upload'), ports)).toEqual({
      ok: false,
      error: 'EXPENSE_PRIVATE_FILE_INVALID',
    })
    expect(ports.expenseBackend.ownerCreatedFiles).toHaveLength(0)
  })

  it('rejects a prepared audit with an unexpected field before creating evidence', () => {
    const ports = createExpenseIngressPorts()
    const bytes = [0xff, 0xd8, 0xff, 0xd9]
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    const manifest = [{ ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'receipt.jpg', sha256 }]
    const rootRequestId = 'owner-evidence-audit'
    const prepared = processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId,
      commandIdempotencyKey: `${rootRequestId}:prepare`,
      payload: {
        ...prepareCommand().payload,
        expectedManifestHash: createHash('sha256')
          .update(canonicalExpenseAttachmentManifest(manifest), 'utf8').digest('hex'),
      },
    }), 'owner-evidence-audit-prepare'), ports)
    if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected prepare result')
    const audit = ports.expenseBackend.master.get('EXPENSE_AUDIT')![0]!
    audit.afterJson = JSON.stringify({ ...JSON.parse(String(audit.afterJson)), unexpected: true })

    expect(processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId,
      expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash,
      manifest,
      bytes,
    }, 'owner-evidence-audit-upload'), ports)).toEqual({
      ok: false,
      error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
    expect(ports.expenseBackend.ownerCreatedFiles).toHaveLength(0)
  })

  it('rejects well-shaped prepare hashes that do not recompute from the durable request and submission', () => {
    const ports = createExpenseIngressPorts()
    const bytes = [0xff, 0xd8, 0xff, 0xd9]
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    const manifest = [{ ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'receipt.jpg', sha256 }]
    const rootRequestId = 'owner-evidence-semantic'
    const prepared = processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId,
      commandIdempotencyKey: `${rootRequestId}:prepare`,
      payload: {
        ...prepareCommand().payload,
        expectedManifestHash: createHash('sha256')
          .update(canonicalExpenseAttachmentManifest(manifest), 'utf8').digest('hex'),
      },
    }), 'owner-evidence-semantic-prepare'), ports)
    if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected prepare result')
    const audit = ports.expenseBackend.master.get('EXPENSE_AUDIT')![0]!
    const tamperedFingerprint = 'f'.repeat(64)
    audit.afterJson = JSON.stringify({
      ...JSON.parse(String(audit.afterJson)),
      commandFingerprint: tamperedFingerprint,
      prepareIntentHash: 'e'.repeat(64),
    })
    audit.eventId = `EAUD:${tamperedFingerprint.slice(0, 48)}:P`

    expect(processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId,
      expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash,
      manifest,
      bytes,
    }, 'owner-evidence-semantic-upload'), ports)).toEqual({
      ok: false,
      error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
    expect(ports.expenseBackend.ownerCreatedFiles).toHaveLength(0)
  })

  it('rejects an abandoned PREPARED root before any owner file lookup or creation', () => {
    const ports = createExpenseIngressPorts()
    const bytes = [0xff, 0xd8, 0xff, 0xd9]
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    const manifest = [{ ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'receipt.jpg', sha256 }]
    const rootRequestId = 'owner-evidence-abandoned'
    const prepared = processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId,
      commandIdempotencyKey: `${rootRequestId}:prepare`,
      payload: {
        ...prepareCommand().payload,
        expectedManifestHash: createHash('sha256')
          .update(canonicalExpenseAttachmentManifest(manifest), 'utf8').digest('hex'),
      },
    }), 'owner-evidence-abandoned-prepare'), ports)
    if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected prepare result')
    ports.expenseBackend.appendMaster('EXPENSE_AUDIT', [{
      eventId: 'EAUD:abandoned:A', expenseId: prepared.expenseId, actorStaffId: 'STAFF_01',
      action: 'ABANDON', beforeJson: '{}', afterJson: '{"recordState":"PREPARED","terminal":true}',
      createdAt: EXPENSE_NOW, correlationId: `${rootRequestId}:abandon`,
    }])

    expect(processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId, expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash, manifest, bytes,
    }, 'owner-evidence-abandoned-upload'), ports)).toEqual({
      ok: false,
      error: 'EXPENSE_NOT_PREPARED',
    })
    expect(ports.expenseBackend.ownerCreatedFiles).toHaveLength(0)
  })

  it('finds committed evidence without creating after a lost COMMIT response and replays one receipt', () => {
    const ports = createExpenseIngressPorts()
    const bytes = [0xff, 0xd8, 0xff, 0xd9]
    const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    const manifest = [{ ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'receipt.jpg', sha256 }]
    const rootRequestId = 'owner-evidence-lost-commit'
    const prepared = processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId,
      commandIdempotencyKey: `${rootRequestId}:prepare`,
      payload: {
        ...prepareCommand().payload,
        expectedManifestHash: createHash('sha256')
          .update(canonicalExpenseAttachmentManifest(manifest), 'utf8').digest('hex'),
      },
    }), 'owner-evidence-lost-prepare'), ports)
    if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected prepare result')
    const upload = signedEvidenceEnvelope({
      rootRequestId, expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash, manifest, bytes,
    }, 'owner-evidence-lost-upload-1')
    const uploaded = processExpenseEvidenceIngressResponse(upload, ports)
    if (!uploaded.ok) throw new Error('unexpected evidence failure')
    const commit = commitCommand({
      rootRequestId,
      expenseId: prepared.expenseId,
      attachments: [uploaded.attachment],
    })
    const firstCommit = processExpenseIngressResponse(
      signedEnvelope(commit, 'owner-evidence-lost-commit-1'),
      ports,
    )
    if (!firstCommit.ok) throw new Error('unexpected commit failure')
    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId,
      staffId: 'STAFF_01',
      nonce: 'owner-evidence-lost-resume',
    }), ports)).toMatchObject({ ok: true, result: { status: 'COMMITTED' } })

    const replayUpload = processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId, expenseId: prepared.expenseId,
      expectedManifestHash: prepared.expectedManifestHash, manifest, bytes,
    }, 'owner-evidence-lost-upload-2'), ports)
    const replayCommit = processExpenseIngressResponse(
      signedEnvelope(commit, 'owner-evidence-lost-commit-2'),
      ports,
    )

    expect(replayUpload).toEqual(uploaded)
    expect(replayCommit).toEqual(firstCommit)
    expect(ports.expenseBackend.ownerCreatedFiles).toHaveLength(1)
    expect(ports.expense.listMonth('2026-08')).toHaveLength(1)
    expect(ports.expense.listAttachments('2026-08', prepared.expenseId)).toHaveLength(1)
  })

  it('uses find-only evidence replay after an exact reserved COMMIT on a PREPARED row', () => {
    const fixture = prepareOwnerEvidenceFixture('owner-evidence-reserved-commit')
    const commit = commitCommand({
      rootRequestId: fixture.rootRequestId,
      expenseId: fixture.prepared.expenseId,
      attachments: [fixture.uploaded],
    })
    const commandJson = canonicalMiniAppExpenseCommand(commit)
    fixture.ports.expense.reserveRequest({
      commandIdempotencyKey: commit.commandIdempotencyKey,
      rootRequestId: commit.rootRequestId,
      commandType: commit.commandType,
      commandFingerprint: fixture.ports.crypto.sha256Hex(commandJson),
      commandJson,
      expenseId: fixture.prepared.expenseId,
      monthKey: '2026-08',
      createdAt: EXPENSE_NOW,
    })

    expect(processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId: fixture.rootRequestId,
      expenseId: fixture.prepared.expenseId,
      expectedManifestHash: fixture.prepared.expectedManifestHash,
      manifest: fixture.manifest,
      bytes: fixture.bytes,
    }, 'owner-evidence-reserved-replay'), fixture.ports)).toEqual({
      ok: true,
      attachment: fixture.uploaded,
    })
    expect(fixture.ports.expenseBackend.ownerCreatedFiles).toHaveLength(1)
  })

  it('finds committed evidence when COMMIT audit/state persisted before request resultJson', () => {
    const fixture = prepareOwnerEvidenceFixture('owner-evidence-partial-commit')
    const commit = commitCommand({
      rootRequestId: fixture.rootRequestId,
      expenseId: fixture.prepared.expenseId,
      attachments: [fixture.uploaded],
    })
    const committed = processExpenseIngressResponse(
      signedEnvelope(commit, 'owner-evidence-partial-commit-run'),
      fixture.ports,
    )
    if (!committed.ok) throw new Error('unexpected commit failure')
    const requests = fixture.ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const commitRow = requests.find((row) => row.commandType === 'COMMIT_EXPENSE')!
    commitRow.recordState = 'RESERVED'
    commitRow.resultJson = null

    expect(processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId: fixture.rootRequestId,
      expenseId: fixture.prepared.expenseId,
      expectedManifestHash: fixture.prepared.expectedManifestHash,
      manifest: fixture.manifest,
      bytes: fixture.bytes,
    }, 'owner-evidence-partial-replay'), fixture.ports)).toEqual({
      ok: true,
      attachment: fixture.uploaded,
    })
    expect(fixture.ports.expenseBackend.ownerCreatedFiles).toHaveLength(1)
  })

  it('rejects a COMMIT audit attachment with an extra field before find-only evidence I/O', () => {
    const fixture = prepareOwnerEvidenceFixture('owner-evidence-commit-audit-extra')
    const commit = commitCommand({
      rootRequestId: fixture.rootRequestId,
      expenseId: fixture.prepared.expenseId,
      attachments: [fixture.uploaded],
    })
    const committed = processExpenseIngressResponse(
      signedEnvelope(commit, 'owner-evidence-commit-audit-run'), fixture.ports,
    )
    if (!committed.ok) throw new Error('unexpected commit failure')
    const audit = fixture.ports.expenseBackend.master.get('EXPENSE_AUDIT')!
      .find((row) => row.action === 'COMMIT')!
    const after = JSON.parse(String(audit.afterJson))
    after.attachments[0].unexpected = true
    audit.afterJson = JSON.stringify(after)

    expect(processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
      rootRequestId: fixture.rootRequestId,
      expenseId: fixture.prepared.expenseId,
      expectedManifestHash: fixture.prepared.expectedManifestHash,
      manifest: fixture.manifest,
      bytes: fixture.bytes,
    }, 'owner-evidence-commit-audit-replay'), fixture.ports)).toEqual({
      ok: false,
      error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
    expect(fixture.ports.expenseBackend.ownerCreatedFiles).toHaveLength(1)
  })

  it('accepts a signed PREPARE, routes MINI_APP_EXPENSE through doPost, and consumes the nonce', () => {
    const ports = createExpenseIngressPorts()
    const command = prepareCommand({ rootRequestId: 'ingress-direct', commandIdempotencyKey: 'ingress-direct:prepare' })
    expect(processExpenseIngress(signedEnvelope(command), ports)).toMatchObject({
      commandType: 'PREPARE_EXPENSE', recordState: 'PREPARED', monthKey: '2026-08',
    })
    expect(ports.repositories.lineDirectory.hasNonce('expense-nonce-123')).toBe(true)

    const routed = createRoutedPorts()
    const routedCommand = prepareCommand({
      rootRequestId: 'ingress-routed', commandIdempotencyKey: 'ingress-routed:prepare',
    })
    expect(processBookingDoPost(event(signedEnvelope(routedCommand, 'expense-route-123')), routed)).toMatchObject({
      ok: true,
      result: { commandType: 'PREPARE_EXPENSE', recordState: 'PREPARED' },
    })
  })

  it('runs signed recovery for the bound worker and returns only safe counts', () => {
    const ports = createExpenseIngressPorts()
    processExpenseIngress(signedEnvelope(prepareCommand({
      rootRequestId: 'recovery-recent', commandIdempotencyKey: 'recovery-recent:prepare',
    }), 'expense-recovery-prep'), ports)

    const response = processExpenseRecoveryIngressResponse(signedRecoveryEnvelope(), ports)

    expect(response).toEqual({
      ok: true,
      result: { recovered: 0, abandoned: 0, unchanged: 1, failed: 0 },
    })
    if (!response.ok) throw new Error('unexpected recovery failure')
    expect(Object.keys(response.result).sort()).toEqual(['abandoned', 'failed', 'recovered', 'unchanged'])
  })

  it('returns one submitter-owned durable receipt and denies another staff member without history', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-committed', commandIdempotencyKey: 'resume-committed:prepare',
    }))
    const committed = executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-committed', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    if (committed.commandType !== 'COMMIT_EXPENSE') throw new Error('unexpected commit')
    const receipt = Object.fromEntries(
      Object.entries(committed).filter(([key]) => key !== 'commandType'),
    )

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-committed', staffId: 'STAFF_01', nonce: 'resume-owner-123',
    }), ports)).toEqual({
      ok: true,
      result: { status: 'COMMITTED', receipt },
    })
    const response = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-committed', staffId: 'MANAGER_01', nonce: 'resume-other-123',
    }), ports)
    expect(response).toEqual({ ok: false, error: 'EXPENSE_RESUME_FORBIDDEN' })
    expect(JSON.stringify(response)).not.toContain(prepared.prepared.expenseId)
  })

  it('returns PREPARED only for an owned prepared root with no commit request', () => {
    const ports = createExpenseIngressPorts()
    executeExpenseCommand(prepareCommand({
      rootRequestId: 'resume-pending', commandIdempotencyKey: 'resume-pending:prepare',
    }), ports)

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-pending', staffId: 'STAFF_01', nonce: 'resume-pending-1',
    }), ports)).toEqual({
      ok: true,
      result: { status: 'PREPARED', expenseId: expect.stringMatching(/^EXP-202608-/) },
    })
    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-unused', staffId: 'STAFF_01', nonce: 'resume-unused-12',
    }), ports)).toEqual({ ok: true, result: { status: 'SAFE_TO_RETRY' } })
  })

  it('keeps a prepared ledger protected when a commit request already exists', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-commit-in-flight', commandIdempotencyKey: 'resume-commit-in-flight:prepare',
    }))
    const command = commitCommand({
      rootRequestId: 'resume-commit-in-flight', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    })
    const commandJson = canonicalMiniAppExpenseCommand(command)
    ports.expense.reserveRequest({
      commandIdempotencyKey: command.commandIdempotencyKey,
      rootRequestId: command.rootRequestId,
      commandType: command.commandType,
      commandFingerprint: ports.crypto.sha256Hex(commandJson),
      commandJson,
      expenseId: command.payload.expenseId,
      monthKey: '2026-08',
      createdAt: EXPENSE_NOW,
    })

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: command.rootRequestId, staffId: 'STAFF_01', nonce: 'resume-commit-flight',
    }), ports)).toEqual({ ok: true, result: { status: 'PENDING' } })
  })

  it('keeps a committed ledger protected while the commit request result is missing', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-commit-result-lost', commandIdempotencyKey: 'resume-commit-result-lost:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-commit-result-lost', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const commitRequest = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
      .find((row) => row.commandIdempotencyKey === 'resume-commit-result-lost:commit')!
    commitRequest.resultJson = null
    commitRequest.recordState = 'RESERVED'

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-commit-result-lost', staffId: 'STAFF_01', nonce: 'resume-result-lost',
    }), ports)).toEqual({ ok: true, result: { status: 'PENDING' } })
  })

  it('derives reservation-only resume ownership from the verified canonical command', () => {
    const ports = createExpenseIngressPorts()
    const command = prepareCommand({
      rootRequestId: 'resume-reserved', commandIdempotencyKey: 'resume-reserved:prepare',
    })
    const commandJson = canonicalMiniAppExpenseCommand(command)
    ports.expense.reserveRequest({
      commandIdempotencyKey: command.commandIdempotencyKey,
      rootRequestId: command.rootRequestId,
      commandType: command.commandType,
      commandFingerprint: ports.crypto.sha256Hex(commandJson),
      commandJson,
      expenseId: 'EXP-202608-0099',
      monthKey: '2026-08',
      createdAt: EXPENSE_NOW,
    })

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: command.rootRequestId, staffId: 'STAFF_01', nonce: 'resume-reserved-owner',
    }), ports)).toEqual({ ok: true, result: { status: 'PENDING' } })
    const denied = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: command.rootRequestId, staffId: 'MANAGER_01', nonce: 'resume-reserved-other',
    }), ports)
    expect(denied).toEqual({ ok: false, error: 'EXPENSE_RESUME_FORBIDDEN' })
    expect(JSON.stringify(denied)).not.toContain(command.staffId)
  })

  it('fails closed when a valid COMMITTED result is swapped from another root', () => {
    const ports = createExpenseIngressPorts()
    const first = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-swap-a', commandIdempotencyKey: 'resume-swap-a:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-swap-a', expenseId: first.prepared.expenseId,
      attachments: first.attachments,
    }), ports)
    const secondBase = prepareCommand({
      rootRequestId: 'resume-swap-b', commandIdempotencyKey: 'resume-swap-b:prepare',
    })
    const second = prepareWithManifest(ports, {
      ...secondBase,
      payload: { ...secondBase.payload, amountSatang: 99_000 },
    })
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-swap-b', expenseId: second.prepared.expenseId,
      attachments: second.attachments,
    }), ports)
    const requests = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const firstCommit = requests.find((row) => row.commandIdempotencyKey === 'resume-swap-a:commit')!
    const secondCommit = requests.find((row) => row.commandIdempotencyKey === 'resume-swap-b:commit')!
    firstCommit.resultJson = secondCommit.resultJson

    const response = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-swap-a', staffId: 'STAFF_01', nonce: 'resume-swap-owner',
    }), ports)
    expect(response).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
    expect(JSON.stringify(response)).not.toContain(second.prepared.expenseId)
  })

  it('fails closed when COMMITTED request authority no longer binds the stored submission and audit', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-corrupt-authority', commandIdempotencyKey: 'resume-corrupt-authority:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-corrupt-authority', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const requests = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const commitRequest = requests.find((row) => row.commandIdempotencyKey === 'resume-corrupt-authority:commit')!
    const command = JSON.parse(String(commitRequest.commandJson)) as Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }>
    command.payload.expectedVersion = 2
    commitRequest.commandJson = canonicalMiniAppExpenseCommand(command)
    commitRequest.commandFingerprint = ports.crypto.sha256Hex(String(commitRequest.commandJson))

    const response = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-corrupt-authority', staffId: 'STAFF_01', nonce: 'resume-corrupt-command',
    }), ports)
    expect(response).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
  })

  it('fails closed when the COMMIT audit timestamp is swapped away from the exact durable receipt', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-corrupt-audit', commandIdempotencyKey: 'resume-corrupt-audit:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-corrupt-audit', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const audits = ports.expenseBackend.master.get('EXPENSE_AUDIT')!
    const commitAudit = audits.find((row) => row.action === 'COMMIT')!
    const payload = JSON.parse(String(commitAudit.afterJson)) as Record<string, unknown>
    commitAudit.afterJson = JSON.stringify({ ...payload, committedAt: '2026-08-29T10:00:01+07:00' })

    const response = processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-corrupt-audit', staffId: 'STAFF_01', nonce: 'resume-corrupt-audit',
    }), ports)
    expect(response).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
    expect(JSON.stringify(response)).not.toContain(prepared.prepared.expenseId)
  })

  it('fails closed when COMMIT attachments no longer match the signed PREPARE manifest', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-corrupt-manifest', commandIdempotencyKey: 'resume-corrupt-manifest:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-corrupt-manifest', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const requests = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const commitRequest = requests.find((row) => row.commandIdempotencyKey === 'resume-corrupt-manifest:commit')!
    const command = JSON.parse(String(commitRequest.commandJson)) as Extract<MiniAppExpenseCommand, { commandType: 'COMMIT_EXPENSE' }>
    command.payload.attachments[0] = {
      ...command.payload.attachments[0]!,
      originalFileName: 'tampered-receipt.jpg',
    }
    commitRequest.commandJson = canonicalMiniAppExpenseCommand(command)
    commitRequest.commandFingerprint = ports.crypto.sha256Hex(String(commitRequest.commandJson))
    const commitAudit = ports.expenseBackend.master.get('EXPENSE_AUDIT')!
      .find((row) => row.action === 'COMMIT')!
    const auditPayload = JSON.parse(String(commitAudit.afterJson)) as Record<string, unknown>
    commitAudit.afterJson = JSON.stringify({
      ...auditPayload,
      commandFingerprint: commitRequest.commandFingerprint,
      attachments: command.payload.attachments,
    })
    commitAudit.eventId = `EAUD:${String(commitRequest.commandFingerprint).slice(0, 48)}:C`

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-corrupt-manifest', staffId: 'STAFF_01', nonce: 'resume-corrupt-manifest',
    }), ports)).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
  })

  it('fails closed when the stored PREPARE command business intent diverges from its durable submission', () => {
    const ports = createExpenseIngressPorts()
    const prepared = prepareWithManifest(ports, prepareCommand({
      rootRequestId: 'resume-corrupt-prepare', commandIdempotencyKey: 'resume-corrupt-prepare:prepare',
    }))
    executeExpenseCommand(commitCommand({
      rootRequestId: 'resume-corrupt-prepare', expenseId: prepared.prepared.expenseId,
      attachments: prepared.attachments,
    }), ports)
    const requests = ports.expenseBackend.master.get('EXPENSE_REQUESTS')!
    const prepareRequest = requests.find((row) => row.commandIdempotencyKey === 'resume-corrupt-prepare:prepare')!
    const command = JSON.parse(String(prepareRequest.commandJson)) as Extract<MiniAppExpenseCommand, { commandType: 'PREPARE_EXPENSE' }>
    command.payload.amountSatang += 1
    prepareRequest.commandJson = canonicalMiniAppExpenseCommand(command)
    prepareRequest.commandFingerprint = ports.crypto.sha256Hex(String(prepareRequest.commandJson))
    const prepareAudit = ports.expenseBackend.master.get('EXPENSE_AUDIT')!
      .find((row) => row.action === 'PREPARE')!
    const auditPayload = JSON.parse(String(prepareAudit.afterJson)) as Record<string, unknown>
    prepareAudit.afterJson = JSON.stringify({
      ...auditPayload,
      commandFingerprint: prepareRequest.commandFingerprint,
    })
    prepareAudit.eventId = `EAUD:${String(prepareRequest.commandFingerprint).slice(0, 48)}:P`

    expect(processExpenseResumeIngressResponse(signedResumeEnvelope({
      rootRequestId: 'resume-corrupt-prepare', staffId: 'STAFF_01', nonce: 'resume-corrupt-prepare',
    }), ports)).toEqual({
      ok: true, result: { status: 'FAILED', error: 'EXPENSE_STORAGE_UNAVAILABLE' },
    })
  })

  it('routes signed recovery through doPost without exposing worker or private topology', () => {
    const routed = createRoutedPorts()
    const response = processBookingDoPost(event(signedRecoveryEnvelope('expense-recovery-route')), routed)

    expect(response).toEqual({
      ok: true,
      result: { recovered: 0, abandoned: 0, unchanged: 0, failed: 0 },
    })
    expect(JSON.stringify(response)).not.toContain('pmc-mini-app-task-invoker')
    expect(JSON.stringify(response)).not.toContain('spreadsheet')
    expect(JSON.stringify(response)).not.toContain('folder')
  })

  it('rejects recovery worker tampering and nonce replay with one fixed safe code', () => {
    const ports = createExpenseIngressPorts()
    const tampered = signedRecoveryEnvelope('expense-recovery-tamper')
    tampered.worker = { ...tampered.worker, subject: 'different-google-subject' }
    expect(processExpenseRecoveryIngressResponse(tampered, ports)).toEqual({
      ok: false, error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })

    const replayed = signedRecoveryEnvelope('expense-recovery-replay')
    expect(processExpenseRecoveryIngressResponse(replayed, ports)).toEqual({
      ok: true, result: { recovered: 0, abandoned: 0, unchanged: 0, failed: 0 },
    })
    expect(processExpenseRecoveryIngressResponse(replayed, ports)).toEqual({
      ok: false, error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
  })

  it.each([
    ['expired', NOW_SECONDS - 301],
    ['future', NOW_SECONDS + 301],
  ])('rejects a %s recovery envelope outside the exact five-minute boundary', (_case, timestamp) => {
    const ports = createExpenseIngressPorts()
    expect(processExpenseRecoveryIngressResponse(
      signedRecoveryEnvelope(`expense-recovery-${_case}`, timestamp),
      ports,
    )).toEqual({ ok: false, error: 'EXPENSE_STORAGE_UNAVAILABLE' })
    expect(ports.expenseBackend.monthOperationCount).toBe(0)
  })

  it.each([
    ['tampered signature', () => ({ ...signedEnvelope(prepareCommand()), signature: '0'.repeat(64) })],
    ['expired timestamp', () => signedEnvelope(prepareCommand(), 'expense-expired-1', NOW_SECONDS - 301)],
    ['future timestamp', () => signedEnvelope(prepareCommand(), 'expense-future-12', NOW_SECONDS + 301)],
  ])('rejects %s without touching monthly storage', (_name, candidate) => {
    const ports = createExpenseIngressPorts()
    expect(() => processExpenseIngress(candidate(), ports)).toThrow()
    expect(ports.expenseBackend.monthOperationCount).toBe(0)
  })

  it('rejects unknown envelope and command keys before HMAC verification', () => {
    const envelope = signedEnvelope(prepareCommand()) as MiniAppExpenseIngressEnvelope & { debug?: boolean }
    envelope.debug = true
    const ports = createExpenseIngressPorts()

    expect(() => processExpenseIngress(envelope, ports)).toThrow('invalid mini app expense')
    expect(ports.hmacCalls()).toBe(0)
  })

  it('rejects a replayed nonce before executing a second command', () => {
    const ports = createExpenseIngressPorts()
    const envelope = signedEnvelope(prepareCommand())
    processExpenseIngress(envelope, ports)

    expect(() => processExpenseIngress(envelope, ports)).toThrow('mini app expense ingress replay detected')
    expect(ports.expense.listMonth('2026-08')).toHaveLength(1)
  })

  it('fails closed for inactive and non-submitter staff', () => {
    const inactive = createExpenseIngressPorts()
    expect(processExpenseIngressResponse(signedEnvelope(prepareCommand({
      rootRequestId: 'inactive-request', commandIdempotencyKey: 'inactive-request:prepare', staffId: 'INACTIVE_01',
    }), 'expense-inactive-1'), inactive)).toEqual({ ok: false, error: 'EXPENSE_STAFF_REQUIRED' })

    const denied = createExpenseIngressPorts({ denySubmit: true })
    expect(processExpenseIngressResponse(signedEnvelope(prepareCommand({
      rootRequestId: 'denied-request', commandIdempotencyKey: 'denied-request:prepare',
    }), 'expense-denied-123'), denied)).toEqual({
      ok: false,
      error: 'EXPENSE_SUBMIT_PERMISSION_REQUIRED',
    })
  })

  it('returns only fixed safe codes and never raw repository or signature detail', () => {
    const ports = createExpenseIngressPorts()
    ports.expenseBackend.ensureMonth = () => { throw new Error('external Sheets failure SECRET-ID') }
    expect(processExpenseIngressResponse(signedEnvelope(prepareCommand()), ports)).toEqual({
      ok: false,
      error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })

    const invalid = signedEnvelope(prepareCommand(), 'expense-invalid-1')
    invalid.signature = '0'.repeat(64)
    expect(processExpenseIngressResponse(invalid, createExpenseIngressPorts())).toEqual({
      ok: false,
      error: 'EXPENSE_STORAGE_UNAVAILABLE',
    })
  })
})

function prepareOwnerEvidenceFixture(rootRequestId: string) {
  const ports = createExpenseIngressPorts()
  const bytes = [0xff, 0xd8, 0xff, 0xd9]
  const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
  const manifest = [{ ordinal: 1, mediaType: 'image/jpeg' as const, originalFileName: 'receipt.jpg', sha256 }]
  const prepared = processExpenseIngress(signedEnvelope(prepareCommand({
    rootRequestId,
    commandIdempotencyKey: `${rootRequestId}:prepare`,
    payload: {
      ...prepareCommand().payload,
      expectedManifestHash: createHash('sha256')
        .update(canonicalExpenseAttachmentManifest(manifest), 'utf8').digest('hex'),
    },
  }), `${rootRequestId}-prepare`), ports)
  if (prepared.commandType !== 'PREPARE_EXPENSE') throw new Error('unexpected prepare result')
  const uploadedResult = processExpenseEvidenceIngressResponse(signedEvidenceEnvelope({
    rootRequestId, expenseId: prepared.expenseId,
    expectedManifestHash: prepared.expectedManifestHash, manifest, bytes,
  }, `${rootRequestId}-upload`), ports)
  if (!uploadedResult.ok) throw new Error('unexpected upload result')
  return { ports, rootRequestId, bytes, manifest, prepared, uploaded: uploadedResult.attachment }
}

type TestExpenseIngressPorts = ExpenseIngressPorts & ExpenseCommandPorts & {
  expenseBackend: ReturnType<typeof createExpenseTestPorts>['backend']
  hmacCalls(): number
}

function createExpenseIngressPorts(options: { denySubmit?: boolean } = {}): TestExpenseIngressPorts {
  const commandPorts = createExpenseTestPorts()
  const nonces = new Set<string>()
  let calls = 0
  return {
    ...commandPorts,
    expenseBackend: commandPorts.backend,
    config: {
      findStaffById(staffId) {
        const staff = commandPorts.staff.findById(staffId)
        return staff ? { ...staff, canSubmitExpense: options.denySubmit ? false : staff.canSubmitExpense } : null
      },
    },
    repositories: {
      lineDirectory: {
        hasNonce: (nonce) => nonces.has(nonce),
        rememberNonce: (nonce) => { nonces.add(nonce) },
      },
    },
    expenseSecrets: { expenseIngressSecret: () => SECRET },
    expenseCommandFingerprint: commandPorts.commandFingerprint,
    crypto: {
      sha256Hex: commandPorts.crypto.sha256Hex,
      sha256BytesHex: (value) => createHash('sha256').update(Buffer.from(value)).digest('hex'),
      base64Decode: (value) => [...Buffer.from(value, 'base64')],
      hmacSha256Hex(value, secret) {
        calls += 1
        return createHmac('sha256', secret).update(value).digest('hex')
      },
    },
    hmacCalls: () => calls,
  }
}

function createRoutedPorts() {
  const booking = createTestPorts({ now: EXPENSE_NOW })
  const expense = createExpenseIngressPorts()
  return {
    ...booking,
    config: {
      ...booking.config,
      findStaffById(staffId: string) {
        const staff = expense.config.findStaffById(staffId)
        return staff ? {
          ...staff,
          email: `${staff.id.toLowerCase()}@example.test`,
          lineUserId: `U-${staff.id}`,
          canCloseBooking: false,
          canBeAe: false,
          canManageStock: false,
          canViewFinance: staff.canManageExpense,
        } : null
      },
    },
    repositories: {
      ...booking.repositories,
      lineDirectory: {
        ...booking.repositories.lineDirectory,
        hasNonce: expense.repositories.lineDirectory.hasNonce,
        rememberNonce: expense.repositories.lineDirectory.rememberNonce,
      },
    },
    expense: expense.expense,
    expenseSecrets: expense.expenseSecrets,
    expenseCommandFingerprint: expense.expenseCommandFingerprint,
    allocateExpenseId: expense.allocateExpenseId,
    crypto: {
      ...booking.crypto,
      hmacSha256Hex: expense.crypto.hmacSha256Hex,
      sha256Hex: expense.crypto.sha256Hex,
    },
  }
}

function signedEnvelope(
  command: MiniAppExpenseCommand,
  nonce = 'expense-nonce-123',
  timestamp = NOW_SECONDS,
): MiniAppExpenseIngressEnvelope {
  const unsigned = { kind: 'MINI_APP_EXPENSE' as const, version: 1 as const, timestamp, nonce, command }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET)
      .update(canonicalMiniAppExpenseIngress(unsigned))
      .digest('hex'),
  }
}

function signedEvidenceEnvelope(input: {
  rootRequestId: string
  expenseId: string
  expectedManifestHash: string
  manifest: Array<{ ordinal: number; mediaType: 'image/jpeg' | 'image/png'; originalFileName: string; sha256: string }>
  bytes: number[]
}, nonce: string): MiniAppExpenseEvidenceIngressEnvelope {
  const slot = input.manifest[0]!
  const deterministicName = `001-${slot.sha256}.jpg`
  const unsigned = {
    kind: 'MINI_APP_EXPENSE_EVIDENCE' as const,
    version: 1 as const,
    timestamp: NOW_SECONDS,
    nonce,
    payload: {
      rootRequestId: input.rootRequestId,
      expenseId: input.expenseId,
      monthKey: '2026-08',
      staffId: 'STAFF_01',
      expectedManifestHash: input.expectedManifestHash,
      manifest: input.manifest,
      attachmentId: `ATT-${createHash('sha256').update(`${input.rootRequestId}:${input.expenseId}:1`, 'utf8').digest('hex').slice(0, 40)}`,
      ordinal: 1,
      mediaType: slot.mediaType,
      originalFileName: slot.originalFileName,
      deterministicName,
      slotClaimId: `SLOT-${createHash('sha256').update(JSON.stringify({
        rootRequestId: input.rootRequestId,
        expenseId: input.expenseId,
        ordinal: 1,
        sha256: slot.sha256,
        mimeType: slot.mediaType,
        deterministicName,
      }), 'utf8').digest('hex')}`,
      sha256: slot.sha256,
      uploadedAt: EXPENSE_NOW,
      bytesBase64: Buffer.from(input.bytes).toString('base64'),
    },
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET)
      .update(canonicalMiniAppExpenseEvidenceIngress(unsigned))
      .digest('hex'),
  }
}

function signedRecoveryEnvelope(
  nonce = 'expense-recovery-123',
  timestamp = NOW_SECONDS,
): MiniAppExpenseRecoveryIngressEnvelope {
  const unsigned = {
    kind: 'MINI_APP_EXPENSE_RECOVERY' as const,
    version: 1 as const,
    timestamp,
    nonce,
    correlationId: 'expense-recovery-correlation-1',
    worker: {
      email: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
      subject: 'google-subject-1',
    },
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET)
      .update(canonicalMiniAppExpenseRecoveryIngress(unsigned))
      .digest('hex'),
  }
}

function signedResumeEnvelope(input: {
  rootRequestId: string
  staffId: string
  nonce: string
}): MiniAppExpenseResumeIngressEnvelope {
  const unsigned = {
    kind: 'MINI_APP_EXPENSE_RESUME' as const,
    version: 1 as const,
    timestamp: NOW_SECONDS,
    nonce: input.nonce,
    rootRequestId: input.rootRequestId,
    staffId: input.staffId,
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', SECRET)
      .update(canonicalMiniAppExpenseResumeIngress(unsigned))
      .digest('hex'),
  }
}

function event(envelope: unknown) {
  return {
    postData: {
      contents: JSON.stringify(envelope),
      length: JSON.stringify(envelope).length,
      name: 'postData',
      type: 'application/json',
    },
  }
}
