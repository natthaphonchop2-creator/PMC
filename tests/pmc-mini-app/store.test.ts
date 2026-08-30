import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import { bookingPayloadHash } from '../../server/pmc-mini-app/bookingDraft'
import {
  ATTRIBUTION_V2_REQUEST_HEADERS,
  createGoogleMiniAppStore,
  type MiniAppRequestRecord,
} from '../../server/pmc-mini-app/store'
import { MINI_APP_ASYNC_REQUEST_HEADERS_V1 } from '../../shared/pmcMiniAppAsyncState'

describe('PMC Mini App Sheet store', () => {
  it('round-trips asynchronous booking request fields', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const draft = validDraft({
      paymentEvidenceObjectKeys: ['payments/request-1/payment-1.jpg'],
      chatEvidenceObjectKeys: ['chats/request-1/chat-1.jpg'],
      taskName: 'projects/p/tasks/123',
      queuedAt: '2026-08-28T02:00:00.000Z',
      processingStartedAt: '2026-08-28T02:01:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:00.000Z',
      lastProgressAt: '2026-08-28T02:02:00.000Z',
      attemptCount: 2,
      processingOwnerToken: 'worker-owner-token-1',
      evidenceProjectionHash: 'a'.repeat(43),
    })

    await store.createDraft(draft)

    expect(sheets.rows('MINI_APP_REQUESTS')[0]).toHaveLength(ATTRIBUTION_V2_REQUEST_HEADERS.length)
    expect(await createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getDraft('draft-1')).toMatchObject({
      protocolVersion: 2,
      recorderName: 'มัส',
      adminId: 'staff-admin',
      adminName: 'แวว',
      aeId: 'staff-ae',
      aeName: 'หมวย',
      paymentEvidenceObjectKeys: ['payments/request-1/payment-1.jpg'],
      chatEvidenceObjectKeys: ['chats/request-1/chat-1.jpg'],
      taskName: 'projects/p/tasks/123',
      queuedAt: '2026-08-28T02:00:00.000Z',
      processingStartedAt: '2026-08-28T02:01:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:00.000Z',
      lastProgressAt: '2026-08-28T02:02:00.000Z',
      attemptCount: 2,
      processingOwnerToken: 'worker-owner-token-1',
      evidenceProjectionHash: 'a'.repeat(43),
    })
  })

  it('normalizes missing asynchronous fields from a legacy request row', async () => {
    const sheets = new MemorySheets()
    sheets.setRequestHeaders(MINI_APP_ASYNC_REQUEST_HEADERS_V1)
    sheets.setTab('MINI_APP_REQUESTS', [[
      'request-1', 'draft-1', 'staff-active', 'line-user-hash', 'READY_TO_CONFIRM', '', 1, '',
      'ไม่ระบุ', 'ลูกค้า ทดสอบ', 'Facebook Test', '0812345678', 'doctor-1', 'service-1', 'NORMAL',
      '2026-09-01', '13:00', 900, 'channel-1', '["payment-1"]', '["chat-1"]', 2,
      '2026-08-27T10:00:00.000Z', '', '', '', '', '2026-08-27T10:00:00.000Z',
    ]])

    const draft = await createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getDraft('draft-1')

    expect(draft).toMatchObject({
      protocolVersion: 1, recorderName: '', adminId: 'staff-active', adminName: '', aeId: null, aeName: 'ไม่ระบุ',
      paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
      processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
      processingOwnerToken: null,
      evidenceProjectionHash: null,
    })
  })

  it('writes protocol 1 with the actual legacy schema before migration', async () => {
    const sheets = new MemorySheets()
    sheets.setRequestHeaders(MINI_APP_ASYNC_REQUEST_HEADERS_V1)
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await store.createDraft(validDraft({
      protocolVersion: 1,
      recorderName: '',
      adminId: 'staff-active',
      adminName: '',
      aeId: null,
      aeName: 'ไม่ระบุ',
    }))

    expect(sheets.rows('MINI_APP_REQUESTS')[0]).toHaveLength(MINI_APP_ASYNC_REQUEST_HEADERS_V1.length)
    await expect(store.getDraft('draft-1')).resolves.toMatchObject({
      protocolVersion: 1, staffId: 'staff-active', adminId: 'staff-active', aeName: 'ไม่ระบุ',
    })
  })

  it('permits an initial protocol-2 draft without selected Admin or AE on the v2 schema', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await store.createDraft(validDraft({
      state: 'DRAFT', recorderName: 'มัส', adminId: '', adminName: '', aeId: null, aeName: 'ไม่ระบุ',
      customerName: '', facebookName: '', phoneNormalized: '', doctorId: '', serviceId: '',
      appointmentDate: null, appointmentTime: null, depositAmount: 0, channelId: '',
      paymentEvidenceFileIds: [], chatEvidenceFileIds: [], evidenceCount: 0,
    }))

    await expect(store.getDraft('draft-1')).resolves.toMatchObject({
      protocolVersion: 2, state: 'DRAFT', recorderName: 'มัส', adminId: '', adminName: '', aeId: null, aeName: 'ไม่ระบุ',
    })
    await expect(store.updateDraft('draft-1', 1, { state: 'READY_TO_CONFIRM' })).rejects.toThrow('BOOKING_ADMIN_REQUIRED')
    await expect(store.updateDraft('draft-1', 1, {
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', updatedAt: '2026-08-27T10:01:00.000Z',
    })).resolves.toMatchObject({ state: 'CANCELLED', adminId: '', adminName: '' })
  })

  it.each([
    ['protocol 1 on v2 schema', 2, 1],
    ['protocol 2 on v1 schema', 1, 2],
  ] as const)('rejects %s', async (_label, schemaVersion, protocolVersion) => {
    const sheets = new MemorySheets()
    if (schemaVersion === 1) sheets.setRequestHeaders(MINI_APP_ASYNC_REQUEST_HEADERS_V1)
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const draft = protocolVersion === 1
      ? validDraft({ protocolVersion: 1, recorderName: '', adminId: 'staff-active', adminName: '', aeId: null, aeName: 'ไม่ระบุ' })
      : validDraft()

    await expect(store.createDraft(draft)).rejects.toThrow('BOOKING_PROTOCOL_SCHEMA_MISMATCH')
    expect(sheets.rows('MINI_APP_REQUESTS')).toEqual([])
  })

  it('rejects an unknown request header instead of shifting booking fields', async () => {
    const sheets = new MemorySheets()
    const unknown = [...ATTRIBUTION_V2_REQUEST_HEADERS]
    unknown[4] = 'spoofedRecorderName'
    sheets.setRequestHeaders(unknown)

    await expect(createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getDraft('draft-1'))
      .rejects.toThrow('incompatible header: MINI_APP_REQUESTS')
  })

  it('claims one confirmation and returns the persisted case after a restart', async () => {
    const sheets = new MemorySheets()
    const firstStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await firstStore.createDraft(validDraft())

    expect((await firstStore.claimConfirmation('request-1', 'hash-1')).claimed).toBe(true)
    await firstStore.completeConfirmation('request-1', 'PMC-202608-0001', '2026-08-27T10:05:00.000Z', 'CONFIRMED')

    const restartedStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    expect(await restartedStore.claimConfirmation('request-1', 'hash-1')).toEqual({
      claimed: false,
      caseId: 'PMC-202608-0001',
      status: 'CONFIRMED',
    })
    expect((await restartedStore.getDraft('draft-1'))?.state).toBe('CONFIRMED')
  })

  it('rejects a conflicting confirmation payload and stale draft version', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({ payloadHash: 'hash-1' }))

    await expect(store.claimConfirmation('request-1', 'hash-2')).rejects.toThrow('PAYLOAD_HASH_CONFLICT')
    await expect(store.updateDraft('draft-1', 0, { aeName: 'แวว' })).rejects.toThrow('STALE_DRAFT_VERSION')
  })

  it('resumes only the newest valid active draft owned by the staff member', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft({ draftId: 'draft-old', requestId: 'request-old', state: 'DRAFT', updatedAt: '2026-08-27T10:00:00.000Z' }))
    await store.createDraft(validDraft({ draftId: 'draft-other', requestId: 'request-other', staffId: 'staff-other', updatedAt: '2026-08-28T12:00:00.000Z' }))
    await store.createDraft(validDraft({ draftId: 'draft-invalid', requestId: 'request-invalid', state: 'QUEUED', updatedAt: 'not-a-date' }))
    await store.createDraft(validDraft({ draftId: 'draft-terminal', requestId: 'request-terminal', state: 'CONFIRMED', updatedAt: '2026-08-29T12:00:00.000Z' }))
    await store.createDraft(validDraft({ draftId: 'draft-review', requestId: 'request-review', state: 'NEEDS_REVIEW', updatedAt: '2026-08-28T11:00:00.000Z' }))

    await expect(store.getLatestActiveDraftByStaff('staff-active')).resolves.toMatchObject({
      draftId: 'draft-review', requestId: 'request-review', staffId: 'staff-active', state: 'NEEDS_REVIEW',
    })
    await expect(store.getLatestActiveDraftByStaff('staff-missing')).resolves.toBeNull()
  })

  it('exposes no direct distributed async mutation authority from Cloud Run', () => {
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets: new MemorySheets() }) as Record<string, unknown>

    for (const method of ['queueDraft', 'claimProcessing', 'updateProcessingProjection', 'markAsyncRetry', 'completeAsyncBooking']) {
      expect(store[method]).toBeUndefined()
    }
  })

  it.each([
    ['state', { state: 'DRAFT' }],
    ['customer identity', { customerName: 'ลูกค้าอื่น' }],
    ['ordered evidence', { paymentEvidenceObjectKeys: ['drafts/draft-1/PAYMENT/other.jpg'] }],
  ] as const)('rejects generic %s mutation after processing identity is bound', async (_label, patch) => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const original = validDraft({
      state: 'PROCESSING', payloadHash: bookingPayloadHash(validDraft()),
      processingStartedAt: '2026-08-28T02:00:00.000Z', processingLeaseUntil: '2026-08-28T02:05:00.000Z',
      lastProgressAt: '2026-08-28T02:00:00.000Z', attemptCount: 1,
    })
    await store.createDraft(original)

    await expect(store.updateDraft('draft-1', 1, patch)).rejects.toThrow('BOUND_DRAFT_MUTATION_FORBIDDEN')
    expect(await store.getDraft('draft-1')).toEqual(original)
  })

  it('rejects generic terminal-state regression without a no-op write', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const terminal = validDraft({
      state: 'CONFIRMED', payloadHash: bookingPayloadHash(validDraft()), version: 4,
      confirmedAt: '2026-08-28T02:01:00.000Z', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
    })
    await store.createDraft(terminal)

    await expect(store.updateDraft('draft-1', 4, { state: 'READY_TO_CONFIRM' })).rejects.toThrow('BOUND_DRAFT_MUTATION_FORBIDDEN')
    expect(await store.getDraft('draft-1')).toEqual(terminal)
  })

  it('atomically cancels a bound failed confirmation with pending retention in one version increment', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft())
    const claimed = await store.claimConfirmation('request-1', 'hash-1')
    if (!claimed.claimed) throw new Error('expected confirmation claim')
    const failed = await store.failConfirmation('request-1', 'BOOKING_RETRY', '2026-08-28T02:01:00.000Z')
    const writesBeforeCancellation = sheets.updateCount()

    const cancelled = await store.updateDraft('draft-1', failed.version, {
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', updatedAt: '2026-08-28T02:02:00.000Z',
    })

    expect(cancelled).toMatchObject({
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', payloadHash: 'hash-1', safeErrorCode: 'BOOKING_RETRY',
      updatedAt: '2026-08-28T02:02:00.000Z', version: 4,
    })
    expect(sheets.updateCount() - writesBeforeCancellation).toBe(1)
  })

  it('does not persist a partial cancellation when the one atomic Sheet write fails', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft())
    const claimed = await store.claimConfirmation('request-1', 'hash-1')
    if (!claimed.claimed) throw new Error('expected confirmation claim')
    const failed = await store.failConfirmation('request-1', 'BOOKING_RETRY', '2026-08-28T02:01:00.000Z')
    sheets.failNextUpdate()

    await expect(store.updateDraft('draft-1', failed.version, {
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', updatedAt: '2026-08-28T02:02:00.000Z',
    })).rejects.toThrow('SHEETS_WRITE_FAILED')

    expect(await store.getDraft('draft-1')).toEqual(failed)
  })

  it.each([
    ['identity', { customerName: 'ลูกค้าอื่น' }],
    ['evidence', { paymentEvidenceObjectKeys: ['drafts/draft-1/PAYMENT/other.jpg'] }],
    ['payload', { payloadHash: 'other-hash' }],
    ['task', { taskName: 'projects/p/locations/l/queues/q/tasks/t' }],
    ['lease', { processingLeaseUntil: '2026-08-28T03:00:00.000Z' }],
    ['attempt', { attemptCount: 2 }],
    ['case', { caseId: 'PMC-202608-9999' }],
    ['error', { safeErrorCode: 'OTHER_ERROR' }],
  ] as const)('rejects an atomic failed-confirmation cancel that piggybacks %s fields', async (_label, extraPatch) => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft())
    const claimed = await store.claimConfirmation('request-1', 'hash-1')
    if (!claimed.claimed) throw new Error('expected confirmation claim')
    const failed = await store.failConfirmation('request-1', 'BOOKING_RETRY', '2026-08-28T02:01:00.000Z')

    await expect(store.updateDraft('draft-1', failed.version, {
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', updatedAt: '2026-08-28T02:02:00.000Z',
      ...extraPatch,
    })).rejects.toThrow('BOUND_DRAFT_MUTATION_FORBIDDEN')
    expect(await store.getDraft('draft-1')).toEqual(failed)
  })

  it.each([
    'QUEUED', 'PROCESSING', 'RETRYING', 'CONFIRMING', 'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW', 'CANCELLED', 'EXPIRED',
  ] as const)('keeps generic cancellation blocked from protected %s state', async (state) => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const protectedDraft = validDraft({ state, payloadHash: 'hash-1', version: 3 })
    await store.createDraft(protectedDraft)

    await expect(store.updateDraft('draft-1', 3, {
      state: 'CANCELLED', retentionState: 'PENDING_APPROVAL', updatedAt: '2026-08-28T02:02:00.000Z',
    })).rejects.toThrow('BOUND_DRAFT_MUTATION_FORBIDDEN')
    expect(await store.getDraft('draft-1')).toEqual(protectedDraft)
  })

  it('marks cancelled evidence for approval-bound retention without deleting IDs', async () => {
    const sheets = new MemorySheets()
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await store.createDraft(validDraft())

    const updated = await store.markRetentionPending('draft-1', 1, '2026-08-27T10:06:00.000Z')

    expect(updated).toMatchObject({
      retentionState: 'PENDING_APPROVAL',
      paymentEvidenceFileIds: ['payment-1'],
      chatEvidenceFileIds: ['chat-1'],
    })
  })

  it('resolves only active staff from the canonical LINE mapping', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-active', 'มัส', 'staff@example.com', 'Uactive', true, true, true, 'https://example.com/profile.png'],
      ['staff-inactive', 'เก่า', 'old@example.com', 'Uinactive', true, true, false, ''],
    ])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.getActiveStaffByLineUserId('Uactive')).resolves.toMatchObject({ id: 'staff-active', name: 'มัส', active: true })
    await expect(store.getActiveStaffByLineUserId('Uinactive')).resolves.toBeNull()
  })

  it('reads canManageStock from the ninth CONFIG_STAFF column', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-stock', 'สต็อก', 'stock@example.com', 'Ustock', true, false, true, '', true],
    ])

    await expect(createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getActiveStaffByLineUserId('Ustock'))
      .resolves.toMatchObject({ id: 'staff-stock', canManageStock: true })
  })

  it('defaults canManageStock to false for legacy eight-column CONFIG_STAFF rows', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-legacy', 'เดิม', 'legacy@example.com', 'Ulegacy', true, false, true, ''],
    ])

    await expect(createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getActiveStaffByLineUserId('Ulegacy'))
      .resolves.toMatchObject({ id: 'staff-legacy', canManageStock: false })
  })

  it('reads each finance permission only from an exact boolean true in its canonical column', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-finance', 'การเงิน', 'finance@example.com', 'Ufinance', true, false, true, '', false, true, true, true],
    ])

    await expect(createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getActiveStaffByLineUserId('Ufinance'))
      .resolves.toMatchObject({
        id: 'staff-finance',
        canSubmitExpense: true,
        canViewFinance: true,
        canManageExpense: true,
      })
  })

  it.each([
    ['blank', ['', '', '']],
    ['missing', []],
    ['malformed', ['true', 1, { value: true }]],
  ])('fails closed for %s finance permission values', async (suffix, permissionValues) => {
    const sheets = new MemorySheets()
    const lineUserId = `U${suffix}`
    sheets.setTab('CONFIG_STAFF', [
      [`staff-${suffix}`, suffix, `${suffix}@example.com`, lineUserId, true, false, true, '', false, ...permissionValues],
    ])

    await expect(createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getActiveStaffByLineUserId(lineUserId))
      .resolves.toMatchObject({
        canSubmitExpense: false,
        canViewFinance: false,
        canManageExpense: false,
      })
  })

  it.each([
    ['canSubmitExpense', ['', true, false]],
    ['canViewFinance', [false, '', true]],
    ['canManageExpense', [true, false, '']],
  ] as const)('does not enable %s from a true value shifted into another permission column', async (permission, values) => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-shifted', 'shifted', 'shifted@example.com', 'Ushifted', true, false, true, '', false, ...values],
    ])

    const staff = await createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
      .getActiveStaffByLineUserId('Ushifted')

    expect(staff?.[permission]).toBe(false)
  })

  it.each(['owner', 'doctor', 'มัส'])('does not derive finance permissions from the staff name %s', async (name) => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-named', name, 'named@example.com', 'Unamed', true, true, true, '', true],
    ])

    await expect(createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getActiveStaffByLineUserId('Unamed'))
      .resolves.toMatchObject({
        canSubmitExpense: false,
        canViewFinance: false,
        canManageExpense: false,
      })
  })

  it('denies inactive and unlinked records even when every finance permission cell is true', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-inactive-finance', 'inactive', 'inactive@example.com', 'UinactiveFinance', true, true, false, '', false, true, true, true],
      ['staff-unlinked-finance', 'unlinked', 'unlinked@example.com', '', true, true, true, '', false, true, true, true],
    ])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.getActiveStaffByLineUserId('UinactiveFinance')).resolves.toBeNull()
    await expect(store.getActiveStaffByLineUserId('UunlinkedFinance')).resolves.toBeNull()
  })

  it('lists only unlinked booking staff and links each LINE account exactly once', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-open', 'มัส', 'open@example.com', '', true, true, true, '', false, true, true, false],
      ['staff-second', 'หมวย', 'second@example.com', '', true, true, true, ''],
      ['staff-linked', 'มิ้น', 'linked@example.com', 'Uexisting', true, true, true, ''],
      ['staff-ae-only', 'เออี', 'ae@example.com', '', false, true, true, ''],
      ['staff-inactive', 'เก่า', 'old@example.com', '', true, true, false, ''],
    ])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.listUnlinkedBookingStaff()).resolves.toEqual([
      { id: 'staff-open', name: 'มัส' },
      { id: 'staff-second', name: 'หมวย' },
    ])
    await expect(store.linkLineUserToStaff('staff-open', 'Unew')).resolves.toMatchObject({ id: 'staff-open', name: 'มัส' })
    await expect(store.getActiveStaffByLineUserId('Unew')).resolves.toMatchObject({
      id: 'staff-open', name: 'มัส', canSubmitExpense: true, canViewFinance: true, canManageExpense: false,
    })
    await expect(store.linkLineUserToStaff('staff-open', 'Uother')).rejects.toThrow('STAFF_ALREADY_LINKED')
    await expect(store.linkLineUserToStaff('staff-second', 'Unew')).rejects.toThrow('LINE_USER_ALREADY_LINKED')
  })

  it('persists PIN attempt lockout across store restarts', async () => {
    const sheets = new MemorySheets()
    const firstStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    const start = '2026-08-28T01:00:00.000Z'

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(firstStore.consumeEnrollmentAttempt('line-user-hash', false, start)).resolves.toEqual({
        allowed: false, retryAfterSeconds: 0,
      })
    }
    await expect(firstStore.consumeEnrollmentAttempt('line-user-hash', false, start)).resolves.toEqual({
      allowed: false, retryAfterSeconds: 900,
    })

    const restartedStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await expect(restartedStore.consumeEnrollmentAttempt('line-user-hash', true, '2026-08-28T01:05:00.000Z')).resolves.toEqual({
      allowed: false, retryAfterSeconds: 600,
    })
    await expect(restartedStore.consumeEnrollmentAttempt('line-user-hash', true, '2026-08-28T01:16:00.000Z')).resolves.toEqual({
      allowed: true, retryAfterSeconds: 0,
    })
  })

  it('projects only active booking choices without operational identifiers', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-ae', 'มัส', 'private@example.com', 'Uprivate', true, true, true, 'https://example.com/private.png'],
      ['NONE', 'ไม่ระบุ', 'none@example.com', '', false, true, true, ''],
      ['staff-unlinked-ae', 'หมวย', 'unlinked@example.com', '', true, true, true, ''],
      ['staff-duplicate-name', 'มัส', 'duplicate@example.com', '', false, true, true, ''],
      ['staff-old', 'เก่า', 'old@example.com', 'Uold', true, true, false, ''],
    ])
    sheets.setTab('CONFIG_DOCTORS', [
      ['doctor-1', 'หมอ Benz', 'private-calendar', 'private-group', true],
      ['doctor-old', 'หมอเก่า', 'old-calendar', 'old-group', false],
    ])
    sheets.setTab('CONFIG_SERVICES', [
      ['service-1', 'เติมไขมัน', 60, true],
      ['service-old', 'ปิดบริการ', 30, false],
    ])
    sheets.setTab('CONFIG_CHANNELS', [
      ['channel-1', 'เพจTAB', true],
      ['channel-old', 'ปิดช่องทาง', false],
    ])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.getActiveBookingConfig()).resolves.toEqual({
      doctors: [{ id: 'doctor-1', name: 'หมอ Benz' }],
      services: [{ id: 'service-1', name: 'เติมไขมัน', durationMinutes: 60 }],
      channels: [{ id: 'channel-1', name: 'เพจTAB' }],
      admins: [
        { id: 'staff-ae', name: 'มัส' },
        { id: 'staff-unlinked-ae', name: 'หมวย' },
        { id: 'staff-duplicate-name', name: 'มัส' },
      ],
      aes: [
        { id: 'staff-ae', name: 'มัส' },
        { id: 'staff-unlinked-ae', name: 'หมวย' },
        { id: 'staff-duplicate-name', name: 'มัส' },
      ],
    })
    const config = await store.getActiveBookingConfig()
    expect(config.admins).toEqual(config.aes)
    expect(config.admins.every(({ id }) => id !== 'NONE')).toBe(true)
  })

  it('keeps allowlisted Thai names as canonical doctor, service, and channel IDs', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_DOCTORS', [['หมอ Benz', 'หมอ Benz', 'private-calendar', 'private-group', true]])
    sheets.setTab('CONFIG_SERVICES', [['เติมไขมัน', 'เติมไขมัน', 60, true]])
    sheets.setTab('CONFIG_CHANNELS', [['เพจหลัก', 'เพจหลัก', true]])
    const store = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })

    await expect(store.getActiveBookingConfig()).resolves.toMatchObject({
      doctors: [{ id: 'หมอ Benz', name: 'หมอ Benz' }],
      services: [{ id: 'เติมไขมัน', name: 'เติมไขมัน', durationMinutes: 60 }],
      channels: [{ id: 'เพจหลัก', name: 'เพจหลัก' }],
    })
  })
})

function validDraft(patch: Partial<MiniAppRequestRecord> = {}): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', protocolVersion: 2, staffId: 'staff-active', recorderName: 'มัส',
    adminId: 'staff-admin', adminName: 'แวว', lineUserIdHash: 'line-user-hash', aeId: 'staff-ae',
    state: 'READY_TO_CONFIRM', retentionState: '', version: 1, payloadHash: null, aeName: 'หมวย',
    customerName: 'ลูกค้า ทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], evidenceCount: 2,
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    processingOwnerToken: null,
    evidenceProjectionHash: null,
    createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-27T10:00:00.000Z',
    ...patch,
  }
}

class MemorySheets implements MiniAppSheetsPort {
  private readonly tabs = new Map<string, unknown[][]>()
  private requestHeaders: unknown[] = [...ATTRIBUTION_V2_REQUEST_HEADERS]
  private updates = 0
  private failUpdate = false

  setTab(tab: string, rows: unknown[][]): void { this.tabs.set(tab, structuredClone(rows)) }
  setRequestHeaders(headers: readonly unknown[]): void { this.requestHeaders = structuredClone([...headers]) }
  rows(tab: string): unknown[][] { return structuredClone(this.tabs.get(tab) ?? []) }
  updateCount(): number { return this.updates }
  failNextUpdate(): void { this.failUpdate = true }

  async batchGet(_spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    return Object.fromEntries(ranges.map((range) => [range,
      tabName(range) === 'MINI_APP_REQUESTS' && range.endsWith('!1:1')
        ? [structuredClone(this.requestHeaders)]
        : structuredClone(this.tabs.get(tabName(range)) ?? []),
    ]))
  }

  async append(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    this.tabs.set(tab, [...(this.tabs.get(tab) ?? []), ...structuredClone(rows)])
  }

  async update(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    if (this.failUpdate) {
      this.failUpdate = false
      throw new Error('SHEETS_WRITE_FAILED')
    }
    this.updates += 1
    const tab = tabName(range)
    const rowNumber = Number(range.match(/!(?:[A-Z]+)(\d+)/)?.[1] ?? 2)
    const index = Math.max(0, rowNumber - 2)
    const current = [...(this.tabs.get(tab) ?? [])]
    current[index] = structuredClone(rows[0] ?? [])
    this.tabs.set(tab, current)
  }

  async batchUpdate(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void> {
    for (const item of data) await this.update(spreadsheetId, item.range, item.values)
  }

  async getWorkbook(): Promise<Array<{ sheetId: number; title: string }>> { return [] }
  async applyWorkbookRequests(): Promise<void> { return undefined }
}

function tabName(range: string): string {
  return range.split('!', 1)[0]!.replaceAll("'", '')
}
