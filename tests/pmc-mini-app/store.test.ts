import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import {
  createGoogleMiniAppStore,
  type MiniAppRequestRecord,
} from '../../server/pmc-mini-app/store'

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
    })

    await store.createDraft(draft)

    expect(await createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getDraft('draft-1')).toMatchObject({
      paymentEvidenceObjectKeys: ['payments/request-1/payment-1.jpg'],
      chatEvidenceObjectKeys: ['chats/request-1/chat-1.jpg'],
      taskName: 'projects/p/tasks/123',
      queuedAt: '2026-08-28T02:00:00.000Z',
      processingStartedAt: '2026-08-28T02:01:00.000Z',
      processingLeaseUntil: '2026-08-28T02:06:00.000Z',
      lastProgressAt: '2026-08-28T02:02:00.000Z',
      attemptCount: 2,
    })
  })

  it('normalizes missing asynchronous fields from a legacy request row', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('MINI_APP_REQUESTS', [[
      'request-1', 'draft-1', 'staff-active', 'line-user-hash', 'READY_TO_CONFIRM', '', 1, '',
      'ไม่ระบุ', 'ลูกค้า ทดสอบ', 'Facebook Test', '0812345678', 'doctor-1', 'service-1', 'NORMAL',
      '2026-09-01', '13:00', 900, 'channel-1', '["payment-1"]', '["chat-1"]', 2,
      '2026-08-27T10:00:00.000Z', '', '', '', '', '2026-08-27T10:00:00.000Z',
    ]])

    const draft = await createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets }).getDraft('draft-1')

    expect(draft).toMatchObject({
      paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
      processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    })
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

  it('lists only unlinked booking staff and links each LINE account exactly once', async () => {
    const sheets = new MemorySheets()
    sheets.setTab('CONFIG_STAFF', [
      ['staff-open', 'มัส', 'open@example.com', '', true, true, true, ''],
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
    await expect(store.getActiveStaffByLineUserId('Unew')).resolves.toMatchObject({ id: 'staff-open', name: 'มัส' })
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
      ['staff-unlinked-ae', 'หมวย', 'unlinked@example.com', '', true, true, true, ''],
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
      aes: [{ id: 'staff-ae', name: 'มัส' }, { id: 'staff-unlinked-ae', name: 'หมวย' }],
    })
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
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-active', lineUserIdHash: 'line-user-hash',
    state: 'READY_TO_CONFIRM', retentionState: '', version: 1, payloadHash: null, aeName: 'ไม่ระบุ',
    customerName: 'ลูกค้า ทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], evidenceCount: 2,
    paymentEvidenceObjectKeys: [], chatEvidenceObjectKeys: [], taskName: null, queuedAt: null,
    processingStartedAt: null, processingLeaseUntil: null, lastProgressAt: null, attemptCount: 0,
    createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null, caseId: null, confirmationStatus: null, safeErrorCode: null,
    updatedAt: '2026-08-27T10:00:00.000Z',
    ...patch,
  }
}

class MemorySheets implements MiniAppSheetsPort {
  private readonly tabs = new Map<string, unknown[][]>()

  setTab(tab: string, rows: unknown[][]): void { this.tabs.set(tab, structuredClone(rows)) }

  async batchGet(_spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>> {
    return Object.fromEntries(ranges.map((range) => [range, structuredClone(this.tabs.get(tabName(range)) ?? [])]))
  }

  async append(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
    const tab = tabName(range)
    this.tabs.set(tab, [...(this.tabs.get(tab) ?? []), ...structuredClone(rows)])
  }

  async update(_spreadsheetId: string, range: string, rows: unknown[][]): Promise<void> {
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
