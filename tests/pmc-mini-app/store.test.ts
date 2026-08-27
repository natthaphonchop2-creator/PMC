import { describe, expect, it } from 'vitest'
import type { MiniAppSheetsPort } from '../../server/pmc-mini-app/googleClient'
import {
  createGoogleMiniAppStore,
  type MiniAppRequestRecord,
} from '../../server/pmc-mini-app/store'

describe('PMC Mini App Sheet store', () => {
  it('claims one confirmation and returns the persisted case after a restart', async () => {
    const sheets = new MemorySheets()
    const firstStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    await firstStore.createDraft(validDraft())

    expect((await firstStore.claimConfirmation('request-1', 'hash-1')).claimed).toBe(true)
    await firstStore.completeConfirmation('request-1', 'PMC-202608-0001', '2026-08-27T10:05:00.000Z')

    const restartedStore = createGoogleMiniAppStore({ spreadsheetId: 'sheet-1', sheets })
    expect(await restartedStore.claimConfirmation('request-1', 'hash-1')).toEqual({
      claimed: false,
      caseId: 'PMC-202608-0001',
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
})

function validDraft(patch: Partial<MiniAppRequestRecord> = {}): MiniAppRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-active', lineUserIdHash: 'line-user-hash',
    state: 'READY_TO_CONFIRM', retentionState: '', version: 1, payloadHash: null, aeName: 'ไม่ระบุ',
    customerName: 'ลูกค้า ทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1',
    paymentEvidenceFileIds: ['payment-1'], chatEvidenceFileIds: ['chat-1'], evidenceCount: 2,
    createdAt: '2026-08-27T10:00:00.000Z', confirmedAt: null, caseId: null, safeErrorCode: null,
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
