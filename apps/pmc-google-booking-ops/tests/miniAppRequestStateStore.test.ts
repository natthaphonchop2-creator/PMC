import { describe, expect, it } from 'vitest'
import {
  MINI_APP_ASYNC_REQUEST_HEADERS,
  type MiniAppAsyncRequestRecord,
} from '../../../shared/pmcMiniAppAsyncState'
import { createGoogleMiniAppRequestStatePort } from '../src/adapters/miniAppRequestState'

describe('Apps Script Mini App request row store', () => {
  it('updates only the matched MINI_APP_REQUESTS row and preserves every other row', () => {
    const first = requestRecord({ requestId: 'request-1', draftId: 'draft-1' })
    const second = requestRecord({ requestId: 'request-2', draftId: 'draft-2' })
    const fake = fakeSpreadsheet([first, second])
    const port = createGoogleMiniAppRequestStatePort(fake.spreadsheet)
    const current = port.getByRequestId('request-2')!

    const updated = port.updateByRequestId('request-2', current.version, {
      ...current, state: 'QUEUED', version: current.version + 1, payloadHash: 'payload-hash-2',
    })

    expect(updated).toMatchObject({ requestId: 'request-2', state: 'QUEUED', version: 2 })
    expect(fake.setRanges).toEqual([{ row: 3, column: 1, rows: 1, columns: MINI_APP_ASYNC_REQUEST_HEADERS.length }])
    expect(port.getByRequestId('request-1')).toEqual(first)
    expect(port.getByRequestId('request-2')).toEqual(updated)
    expect(fake.clearCalls).toBe(0)
  })

  it('rejects header drift and stale expected versions without writing', () => {
    const fake = fakeSpreadsheet([requestRecord()])
    const port = createGoogleMiniAppRequestStatePort(fake.spreadsheet)
    const current = port.getByRequestId('request-1')!

    expect(() => port.updateByRequestId('request-1', 99, current)).toThrow(/version/i)
    fake.headers[0] = 'wrongRequestId'
    expect(() => port.getByRequestId('request-1')).toThrow(/header/i)
    expect(fake.setRanges).toEqual([])
  })

  it('constructs lazily so disabled async state does not require the optional tab', () => {
    const spreadsheet = { getSheetByName: () => null } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet

    const port = createGoogleMiniAppRequestStatePort(spreadsheet)

    expect(() => port.getByRequestId('request-1')).toThrow('missing required sheet: MINI_APP_REQUESTS')
  })

  it('fails closed on duplicate request identities without choosing a row to update', () => {
    const fake = fakeSpreadsheet([
      requestRecord({ requestId: 'request-1', draftId: 'draft-1' }),
      requestRecord({ requestId: 'request-1', draftId: 'draft-2' }),
    ])
    const port = createGoogleMiniAppRequestStatePort(fake.spreadsheet)

    expect(() => port.getByRequestId('request-1')).toThrow(/duplicate/i)
    expect(fake.setRanges).toEqual([])
  })
})

function requestRecord(patch: Partial<MiniAppAsyncRequestRecord> = {}): MiniAppAsyncRequestRecord {
  return {
    requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-1', lineUserIdHash: 'line-user-hash',
    state: 'READY_TO_CONFIRM', retentionState: '', version: 1, payloadHash: null, aeName: 'เอม',
    customerName: 'ลูกค้าทดสอบ', facebookName: 'Facebook Test', phoneNormalized: '0812345678',
    doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
    appointmentTime: '13:00', depositAmount: 900, channelId: 'เพจหลัก', paymentEvidenceFileIds: [],
    chatEvidenceFileIds: [], evidenceCount: 2,
    paymentEvidenceObjectKeys: [`drafts/${patch.draftId ?? 'draft-1'}/PAYMENT/${'a'.repeat(64)}.png`],
    chatEvidenceObjectKeys: [`drafts/${patch.draftId ?? 'draft-1'}/CHAT/${'b'.repeat(64)}.png`],
    taskName: null, queuedAt: null, processingStartedAt: null, processingLeaseUntil: null,
    lastProgressAt: null, attemptCount: 0, processingOwnerToken: null,
    evidenceProjectionHash: null,
    createdAt: '2026-08-20T08:58:00+07:00', confirmedAt: null, caseId: null,
    confirmationStatus: null, safeErrorCode: null, updatedAt: '2026-08-20T08:58:00+07:00',
    ...patch,
  }
}

function fakeSpreadsheet(initial: MiniAppAsyncRequestRecord[]) {
  const headers: string[] = [...MINI_APP_ASYNC_REQUEST_HEADERS]
  const values = initial.map(toRow)
  const setRanges: Array<{ row: number; column: number; rows: number; columns: number }> = []
  let clearCalls = 0
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => values.length + 1,
    getRange(row: number, column: number, rows = 1, columns = 1) {
      return {
        getValues() {
          if (row === 1) return [headers.slice(column - 1, column - 1 + columns)]
          return values.slice(row - 2, row - 2 + rows).map((item) => item.slice(column - 1, column - 1 + columns))
        },
        setValues(next: unknown[][]) {
          setRanges.push({ row, column, rows, columns })
          for (let index = 0; index < rows; index += 1) values[row - 2 + index] = [...(next[index] ?? [])]
        },
        clearContent() { clearCalls += 1 },
      }
    },
  }
  const spreadsheet = {
    getSheetByName: (name: string) => name === 'MINI_APP_REQUESTS' ? sheet : null,
  } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet
  return { spreadsheet, headers, setRanges, get clearCalls() { return clearCalls } }
}

function toRow(record: MiniAppAsyncRequestRecord): unknown[] {
  const mapped: Record<string, unknown> = {
    ...record,
    paymentEvidenceFileIdsJson: JSON.stringify(record.paymentEvidenceFileIds),
    chatEvidenceFileIdsJson: JSON.stringify(record.chatEvidenceFileIds),
    paymentEvidenceObjectKeysJson: JSON.stringify(record.paymentEvidenceObjectKeys),
    chatEvidenceObjectKeysJson: JSON.stringify(record.chatEvidenceObjectKeys),
  }
  return MINI_APP_ASYNC_REQUEST_HEADERS.map((header) => mapped[header] ?? '')
}
