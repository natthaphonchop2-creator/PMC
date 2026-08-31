import { describe, expect, it } from 'vitest'
import {
  MINI_APP_ASYNC_REQUEST_HEADERS,
  type MiniAppAsyncRequestRecord,
} from '../../../shared/pmcMiniAppAsyncState'
import { createGoogleMiniAppRequestStatePort } from '../src/adapters/miniAppRequestState'
import { TARGET_MINI_APP_REQUEST_HEADERS } from '../src/domain/attributionMigration'

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

  it('reuses the locked request-table snapshot when updating the row it just read', () => {
    const fake = fakeSpreadsheet([
      requestRecord({ requestId: 'request-1', draftId: 'draft-1' }),
      requestRecord({ requestId: 'request-2', draftId: 'draft-2' }),
    ])
    const port = createGoogleMiniAppRequestStatePort(fake.spreadsheet)
    const current = port.getByRequestId('request-2')!

    port.updateByRequestId('request-2', current.version, {
      ...current, state: 'QUEUED', version: current.version + 1, payloadHash: 'payload-hash-2',
    })

    expect(fake.bodyReadCalls).toBe(1)
    expect(port.getByRequestId('request-2')).toMatchObject({ state: 'QUEUED', version: 2 })
    expect(fake.bodyReadCalls).toBe(2)
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

  it('preserves hash-bound text fields when Sheets would otherwise coerce a rewritten row', () => {
    const original = requestRecord()
    const fake = fakeSpreadsheet([original], { coerceUnformattedStrings: true })
    const port = createGoogleMiniAppRequestStatePort(fake.spreadsheet)
    const current = port.getByRequestId(original.requestId)!

    port.updateByRequestId(original.requestId, current.version, {
      ...current,
      state: 'QUEUED',
      version: current.version + 1,
      payloadHash: 'payload-hash-1',
      taskName: 'projects/p/locations/l/queues/q/tasks/t',
    })

    const persisted = port.getByRequestId(original.requestId)!
    expect(persisted.phoneNormalized).toBe('0812345678')
    expect(persisted.appointmentDate).toBe('2026-09-01')
    expect(persisted.appointmentTime).toBe('13:00')
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

  it('reads and updates the exact attribution-v2 schema without losing recorder, Admin, or AE snapshots', () => {
    const values = [targetRequestRow()]
    const setRanges: Array<{ row: number; column: number; rows: number; columns: number }> = []
    const sheet = {
      getLastColumn: () => TARGET_MINI_APP_REQUEST_HEADERS.length,
      getLastRow: () => 2,
      getRange(row: number, column: number, rows = 1, columns = 1) {
        return {
          getValues() {
            if (row === 1) return [[...TARGET_MINI_APP_REQUEST_HEADERS].slice(column - 1, column - 1 + columns)]
            return values.slice(row - 2, row - 2 + rows).map((item) => item.slice(column - 1, column - 1 + columns))
          },
          setValues(next: unknown[][]) {
            setRanges.push({ row, column, rows, columns })
            values[row - 2] = [...next[0]]
          },
          setNumberFormats() { /* format preservation is asserted by the migration workflow */ },
        }
      },
    }
    const spreadsheet = {
      getSheetByName: (name: string) => name === 'MINI_APP_REQUESTS' ? sheet : null,
    } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet
    const port = createGoogleMiniAppRequestStatePort(spreadsheet)

    const current = port.getByRequestId('request-v2-1')!
    expect(current).toMatchObject({
      protocolVersion: 2,
      staffId: 'staff-1', recorderName: 'มัส',
      adminId: 'staff-2', adminName: 'แวว', aeId: 'ae-1', aeName: 'หมวย',
    })

    port.updateByRequestId(current.requestId, current.version, {
      ...current, state: 'QUEUED', version: current.version + 1,
    })

    expect(setRanges).toEqual([{
      row: 2, column: 1, rows: 1, columns: TARGET_MINI_APP_REQUEST_HEADERS.length,
    }])
    expect(port.getByRequestId('request-v2-1')).toMatchObject({
      protocolVersion: 2,
      staffId: 'staff-1', recorderName: 'มัส',
      adminId: 'staff-2', adminName: 'แวว', aeId: 'ae-1', aeName: 'หมวย',
      state: 'QUEUED', version: 2,
    })
  })

  it('reads migrated terminal protocol-1 blank no-AE without mutating the hash-bound aeName cell', () => {
    const row = targetRequestRow()
    row[TARGET_MINI_APP_REQUEST_HEADERS.indexOf('protocolVersion')] = 1
    row[TARGET_MINI_APP_REQUEST_HEADERS.indexOf('state')] = 'EXPIRED'
    row[TARGET_MINI_APP_REQUEST_HEADERS.indexOf('aeId')] = ''
    row[TARGET_MINI_APP_REQUEST_HEADERS.indexOf('aeName')] = ''
    row[TARGET_MINI_APP_REQUEST_HEADERS.indexOf('caseId')] = ''
    const fake = fakeTargetSpreadsheet([row])
    const port = createGoogleMiniAppRequestStatePort(fake.spreadsheet)

    expect(port.getByRequestId('request-v2-1')).toMatchObject({
      protocolVersion: 1, state: 'EXPIRED', aeId: null, aeName: '',
    })
    expect(fake.values[0][TARGET_MINI_APP_REQUEST_HEADERS.indexOf('aeName')]).toBe('')
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

function fakeSpreadsheet(
  initial: MiniAppAsyncRequestRecord[],
  options: { coerceUnformattedStrings?: boolean } = {},
) {
  const headers: string[] = [...MINI_APP_ASYNC_REQUEST_HEADERS]
  const values = initial.map(toRow)
  const formats = initial.map(() => Array<string>(headers.length).fill('General'))
  const setRanges: Array<{ row: number; column: number; rows: number; columns: number }> = []
  let clearCalls = 0
  let bodyReadCalls = 0
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => values.length + 1,
    getRange(row: number, column: number, rows = 1, columns = 1) {
      return {
        getValues() {
          if (row === 1) return [headers.slice(column - 1, column - 1 + columns)]
          bodyReadCalls += 1
          return values.slice(row - 2, row - 2 + rows).map((item) => item.slice(column - 1, column - 1 + columns))
        },
        setValues(next: unknown[][]) {
          setRanges.push({ row, column, rows, columns })
          for (let index = 0; index < rows; index += 1) {
            values[row - 2 + index] = [...(next[index] ?? [])].map((value, valueIndex) => (
              options.coerceUnformattedStrings && formats[row - 2 + index]?.[column - 1 + valueIndex] !== '@'
                ? coerceLikeSheets(value)
                : value
            ))
          }
        },
        setNumberFormats(next: string[][]) {
          for (let index = 0; index < rows; index += 1) {
            const current = formats[row - 2 + index] ?? Array<string>(headers.length).fill('General')
            current.splice(column - 1, columns, ...(next[index] ?? []))
            formats[row - 2 + index] = current
          }
        },
        clearContent() { clearCalls += 1 },
      }
    },
  }
  const spreadsheet = {
    getSheetByName: (name: string) => name === 'MINI_APP_REQUESTS' ? sheet : null,
  } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet
  return {
    spreadsheet,
    headers,
    setRanges,
    get clearCalls() { return clearCalls },
    get bodyReadCalls() { return bodyReadCalls },
  }
}

function fakeTargetSpreadsheet(initialRows: unknown[][]) {
  const values = initialRows.map((row) => [...row])
  const setRanges: Array<{ row: number; column: number; rows: number; columns: number }> = []
  const sheet = {
    getLastColumn: () => TARGET_MINI_APP_REQUEST_HEADERS.length,
    getLastRow: () => values.length + 1,
    getRange(row: number, column: number, rows = 1, columns = 1) {
      return {
        getValues() {
          if (row === 1) return [[...TARGET_MINI_APP_REQUEST_HEADERS].slice(column - 1, column - 1 + columns)]
          return values.slice(row - 2, row - 2 + rows).map((item) => item.slice(column - 1, column - 1 + columns))
        },
        setValues(next: unknown[][]) {
          setRanges.push({ row, column, rows, columns })
          values[row - 2] = [...next[0]]
        },
        setNumberFormats() { /* no-op fake */ },
      }
    },
  }
  return {
    values,
    setRanges,
    spreadsheet: {
      getSheetByName: (name: string) => name === 'MINI_APP_REQUESTS' ? sheet : null,
    } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet,
  }
}

function coerceLikeSheets(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (/^\d+$/.test(value)) return Number(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`)
  if (/^\d{2}:\d{2}$/.test(value)) {
    const [hour, minute] = value.split(':').map(Number)
    return (hour * 60 + minute) / 1_440
  }
  return value
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

function targetRequestRow(): unknown[] {
  const legacy = requestRecord({ requestId: 'request-v2-1', draftId: 'draft-v2-1', aeName: 'หมวย' })
  const mapped: Record<string, unknown> = {
    ...legacy,
    protocolVersion: 2,
    recorderName: 'มัส',
    adminId: 'staff-2',
    adminName: 'แวว',
    aeId: 'ae-1',
    paymentEvidenceFileIdsJson: JSON.stringify(legacy.paymentEvidenceFileIds),
    chatEvidenceFileIdsJson: JSON.stringify(legacy.chatEvidenceFileIds),
    paymentEvidenceObjectKeysJson: JSON.stringify(legacy.paymentEvidenceObjectKeys),
    chatEvidenceObjectKeysJson: JSON.stringify(legacy.chatEvidenceObjectKeys),
  }
  return TARGET_MINI_APP_REQUEST_HEADERS.map((header) => mapped[header] ?? '')
}
