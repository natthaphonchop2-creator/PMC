import { describe, expect, it } from 'vitest'
import {
  LEGACY_BOOKING_MASTER_HEADERS,
  LEGACY_MINI_APP_REQUEST_HEADERS,
  TARGET_BOOKING_MASTER_HEADERS,
  TARGET_MINI_APP_REQUEST_HEADERS,
  planBookingAttributionMigration,
  type AttributionMigrationSheetSnapshot,
  type AttributionStaffSnapshot,
  type BookingAttributionMigrationPlan,
} from '../src/domain/attributionMigration'
import {
  applyBookingAttributionMigration,
  previewBookingAttributionMigration,
  type BookingAttributionMigrationPorts,
} from '../src/workflows/attributionMigration'
import {
  readGoogleBookingAttributionMigrationSnapshot,
  writeGoogleBookingAttributionMigration,
} from '../src/adapters/googleSheets'

describe('Booking attribution migration planner', () => {
  it('plans the exact request and master insertions and deterministic historical backfill', () => {
    const plan = planBookingAttributionMigration(legacySnapshot())

    expect(plan).toMatchObject({
      kind: 'MIGRATE',
      requestProtocolInsertion: 'protocolVersion',
      requestInsertions: ['recorderName', 'adminId', 'adminName', 'aeId'],
      masterInsertions: ['recorderId', 'recorderName', 'recorderSource'],
      requestRowsMigrated: 1,
      bookingRowsMigrated: 3,
    })
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')
    expect(objectRows(TARGET_MINI_APP_REQUEST_HEADERS, plan.requestRows)).toEqual([
      expect.objectContaining({
        protocolVersion: 1,
        staffId: 'staff-1',
        recorderName: 'มัส',
        adminId: 'staff-1',
        adminName: 'มัส',
        aeId: 'ae-1',
        aeName: 'หมวย',
      }),
    ])
    expect(objectRows(TARGET_BOOKING_MASTER_HEADERS, plan.masterRows)).toEqual([
      expect.objectContaining({
        caseId: 'PMC-202608-0001',
        recorderId: 'staff-1',
        recorderName: 'มัส',
        recorderSource: 'VERIFIED_LINE',
      }),
      expect.objectContaining({
        caseId: 'PMC-202608-0002',
        recorderId: 'staff-2',
        recorderName: 'แวว',
        recorderSource: 'FORM_EMAIL_MATCH',
      }),
      expect.objectContaining({
        caseId: 'PMC-202608-0003',
        recorderId: '',
        recorderName: 'Google Form',
        recorderSource: 'FORM_UNRESOLVED',
      }),
    ])
  })

  it('uses assumed Admin provenance for an uncorrelated Mini App row and never invents verified LINE', () => {
    const snapshot = legacySnapshot()
    snapshot.master.rows[0] = row(TARGET_BOOKING_MASTER_HEADERS.filter((header) => ![
      'recorderId', 'recorderName', 'recorderSource',
    ].includes(header)), {
      ...objectRows(LEGACY_BOOKING_MASTER_HEADERS, snapshot.master.rows)[0],
      caseId: 'PMC-202608-9999',
      formResponseId: 'mini:missing-request',
      adminId: 'staff-2',
      adminName: 'แวว',
    })

    const plan = planBookingAttributionMigration(snapshot)
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')

    expect(objectRows(TARGET_BOOKING_MASTER_HEADERS, plan.masterRows)[0]).toMatchObject({
      recorderId: 'staff-2', recorderName: 'แวว', recorderSource: 'LEGACY_ASSUMED_ADMIN',
    })
  })

  it.each([
    ['unknown request header', (snapshot: AttributionMigrationSheetSnapshot) => { snapshot.request.headers[0] = 'wrong' }, 'UNKNOWN_REQUEST_HEADERS'],
    ['reordered master header', (snapshot: AttributionMigrationSheetSnapshot) => {
      ;[snapshot.master.headers[0], snapshot.master.headers[1]] = [snapshot.master.headers[1], snapshot.master.headers[0]]
    }, 'UNKNOWN_MASTER_HEADERS'],
    ['running queue', (snapshot: AttributionMigrationSheetSnapshot) => { snapshot.queueState = 'RUNNING' }, 'QUEUE_NOT_PAUSED'],
    ['active tasks', (snapshot: AttributionMigrationSheetSnapshot) => { snapshot.activeTaskCount = 1 }, 'ACTIVE_BOOKING_TASKS'],
    ['nonterminal legacy draft', (snapshot: AttributionMigrationSheetSnapshot) => {
      snapshot.request.rows[0][snapshot.request.headers.indexOf('state')] = 'READY_TO_CONFIRM'
    }, 'NONTERMINAL_LEGACY_DRAFTS'],
    ['request bound exceeded', (snapshot: AttributionMigrationSheetSnapshot) => { snapshot.requestRowLimit = 0 }, 'REQUEST_ROW_LIMIT_EXCEEDED'],
    ['master bound exceeded', (snapshot: AttributionMigrationSheetSnapshot) => { snapshot.masterRowLimit = 2 }, 'MASTER_ROW_LIMIT_EXCEEDED'],
  ])('fails closed for %s', (_label, mutate, code) => {
    const snapshot = legacySnapshot()
    mutate(snapshot)
    expect(() => planBookingAttributionMigration(snapshot)).toThrow(code)
  })

  it('fails before mutation planning when eligible legacy AE names are duplicated', () => {
    const snapshot = legacySnapshot()
    snapshot.staff.push({
      id: 'ae-duplicate', name: 'หมวย', email: 'duplicate@example.com', active: true, canBeAe: true,
    })

    expect(() => planBookingAttributionMigration(snapshot)).toThrow('DUPLICATE_LEGACY_AE_NAME')
  })

  it('fails closed on ambiguous exact Mini App correlation', () => {
    const snapshot = legacySnapshot()
    snapshot.request.rows.push([...snapshot.request.rows[0]])

    expect(() => planBookingAttributionMigration(snapshot)).toThrow('AMBIGUOUS_MINI_APP_CORRELATION')
  })

  it('accepts only the exact target schemas and returns an idempotent zero-mutation plan', () => {
    const migrated = targetSnapshotFrom(planBookingAttributionMigration(legacySnapshot()))

    expect(planBookingAttributionMigration(migrated)).toMatchObject({
      kind: 'NONE', requestRowsMigrated: 0, bookingRowsMigrated: 0,
    })
  })

  it('still blocks a protocol-1 nonterminal row after a partial request-header migration', () => {
    const source = legacySnapshot()
    const migrated = targetSnapshotFrom(planBookingAttributionMigration(source))
    migrated.master = clone(source.master)
    migrated.request.rows[0][migrated.request.headers.indexOf('state')] = 'READY_TO_CONFIRM'

    expect(() => planBookingAttributionMigration(migrated)).toThrow('NONTERMINAL_LEGACY_DRAFTS')
  })

  it('uses the adapter-provided SHA-256 fingerprint for the owner approval boundary', () => {
    const snapshot = legacySnapshot()
    snapshot.preflightFingerprint = 'a'.repeat(64)

    expect(planBookingAttributionMigration(snapshot).preflightFingerprint).toBe('a'.repeat(64))
  })

  it('fails closed on an unknown protocol version even when both target headers already exist', () => {
    const target = targetSnapshotFrom(planBookingAttributionMigration(legacySnapshot()))
    target.request.rows[0][target.request.headers.indexOf('protocolVersion')] = 3

    expect(() => planBookingAttributionMigration(target)).toThrow('UNKNOWN_REQUEST_PROTOCOL_VERSION')
  })
})

describe('Booking attribution migration workflow', () => {
  it('keeps preview read-only without lock, backup, Sheet write, or queue mutation', () => {
    const fake = workflowFake([legacySnapshot()])

    const preview = previewBookingAttributionMigration(fake.ports)

    expect(preview.kind).toBe('MIGRATE')
    expect(fake.effects).toEqual(['queue.state', 'queue.activeTaskCount', 'sheet.read'])
  })

  it('rechecks queue and the exact fingerprint under lock before backup, write, and readback', () => {
    const source = legacySnapshot()
    const plan = planBookingAttributionMigration(source)
    const fake = workflowFake([source, source, targetSnapshotFrom(plan)])

    const result = applyBookingAttributionMigration(fake.ports)

    expect(result).toMatchObject({
      backupCreated: true,
      requestRowsMigrated: 1,
      bookingRowsMigrated: 3,
      readbackVerified: true,
    })
    expect(fake.effects).toEqual([
      'queue.state', 'queue.activeTaskCount', 'sheet.read',
      'lock.enter', 'queue.state', 'queue.activeTaskCount', 'sheet.read',
      'backup.create', 'sheet.write', 'sheet.read', 'lock.exit',
    ])
  })

  it('fails on a changed under-lock fingerprint before backup or schema write', () => {
    const first = legacySnapshot()
    const changed = legacySnapshot()
    changed.master.rows[0][changed.master.headers.indexOf('adminName')] = 'changed'
    const fake = workflowFake([first, changed])

    expect(() => applyBookingAttributionMigration(fake.ports)).toThrow('MIGRATION_FINGERPRINT_CHANGED')
    expect(fake.effects).not.toContain('backup.create')
    expect(fake.effects).not.toContain('sheet.write')
  })

  it('fails readback when values or preservation metadata drift after the schema write', () => {
    const source = legacySnapshot()
    const plan = planBookingAttributionMigration(source)
    const readback = targetSnapshotFrom(plan)
    readback.master.rows[0][readback.master.headers.indexOf('adminName')] = 'corrupted'
    const fake = workflowFake([source, source, readback])

    expect(() => applyBookingAttributionMigration(fake.ports)).toThrow('MIGRATION_READBACK_MISMATCH')
    expect(fake.effects).toContain('backup.create')
    expect(fake.effects).toContain('sheet.write')
  })

  it('performs no lock, backup, or write on an idempotent rerun', () => {
    const target = targetSnapshotFrom(planBookingAttributionMigration(legacySnapshot()))
    target.queueState = 'RUNNING'
    target.activeTaskCount = 3
    const fake = workflowFake([target])

    const result = applyBookingAttributionMigration(fake.ports)

    expect(result).toMatchObject({ backupCreated: false, readbackVerified: true })
    expect(fake.effects).toEqual(['queue.state', 'queue.activeTaskCount', 'sheet.read'])
  })
})

describe('Google Sheet attribution migration adapter', () => {
  it('inserts only target columns and preserves all non-target values and presentation metadata', () => {
    const source = legacySnapshot()
    const fake = fakeMigrationSpreadsheet(source)
    const adapterSnapshot = readGoogleBookingAttributionMigrationSnapshot(fake.spreadsheet)
    const plan = planBookingAttributionMigration({
      ...adapterSnapshot,
      queueState: 'PAUSED', activeTaskCount: 0, requestRowLimit: 10_000, masterRowLimit: 100_000,
    })
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')

    writeGoogleBookingAttributionMigration(fake.spreadsheet, plan)
    const readback = readGoogleBookingAttributionMigrationSnapshot(fake.spreadsheet)

    expect(readback.request.headers).toEqual(TARGET_MINI_APP_REQUEST_HEADERS)
    expect(readback.master.headers).toEqual(TARGET_BOOKING_MASTER_HEADERS)
    expect(readback.request.rows).toEqual(plan.requestRows)
    expect(readback.master.rows).toEqual(plan.masterRows)
    expect(readback.request.preservationFingerprint).toBe(plan.requestPreservationFingerprint)
    expect(readback.master.preservationFingerprint).toBe(plan.masterPreservationFingerprint)
    expect(fake.sheets.MINI_APP_REQUESTS.frozenRows).toBe(1)
    expect(fake.sheets.BOOKING_MASTER.frozenColumns).toBe(2)
  })

  it('fails closed on a reordered CONFIG_STAFF header used for attribution', () => {
    const fake = fakeMigrationSpreadsheet(legacySnapshot())
    const header = fake.sheets.CONFIG_STAFF.getRange(1, 1, 1, 7).getValues()[0]
    ;[header[0], header[1]] = [header[1], header[0]]
    fake.sheets.CONFIG_STAFF.getRange(1, 1, 1, 7).setValues([header])

    expect(() => readGoogleBookingAttributionMigrationSnapshot(fake.spreadsheet))
      .toThrow('CONFIG_STAFF attribution header mismatch')
  })

  it('detects when a pre-existing filter fails to expand with inserted attribution columns', () => {
    const fake = fakeMigrationSpreadsheet(legacySnapshot())
    fake.sheets.BOOKING_MASTER.filterColumnCount = LEGACY_BOOKING_MASTER_HEADERS.length
    fake.sheets.BOOKING_MASTER.expandFilterOnInsert = false
    const before = readGoogleBookingAttributionMigrationSnapshot(fake.spreadsheet)
    const plan = planBookingAttributionMigration({
      ...before,
      queueState: 'PAUSED', activeTaskCount: 0, requestRowLimit: 10_000, masterRowLimit: 100_000,
    })
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')

    writeGoogleBookingAttributionMigration(fake.spreadsheet, plan)
    const readback = readGoogleBookingAttributionMigrationSnapshot(fake.spreadsheet)

    expect(readback.master.preservationFingerprint).not.toBe(plan.masterPreservationFingerprint)
  })
})

function legacySnapshot(): AttributionMigrationSheetSnapshot {
  const staff: AttributionStaffSnapshot[] = [
    { id: 'staff-1', name: 'มัส', email: 'mas@example.com', active: true, canBeAe: true },
    { id: 'staff-2', name: 'แวว', email: 'waew@example.com', active: true, canBeAe: true },
    { id: 'ae-1', name: 'หมวย', email: 'muay@example.com', active: true, canBeAe: true },
  ]
  return {
    request: {
      headers: [...LEGACY_MINI_APP_REQUEST_HEADERS],
      rows: [row(LEGACY_MINI_APP_REQUEST_HEADERS, {
        requestId: 'request-1', draftId: 'draft-1', staffId: 'staff-1', lineUserIdHash: 'hash-1',
        state: 'CONFIRMED', retentionState: '', version: 7, payloadHash: 'payload-1', aeName: 'หมวย',
        customerName: 'ลูกค้า 1', facebookName: 'FB 1', phoneNormalized: '0812345678',
        doctorId: 'doctor-1', serviceId: 'service-1', queueType: 'NORMAL', appointmentDate: '2026-09-01',
        appointmentTime: '13:00', depositAmount: 900, channelId: 'channel-1', paymentEvidenceFileIdsJson: '[]',
        chatEvidenceFileIdsJson: '[]', evidenceCount: 2, createdAt: '2026-08-01T10:00:00+07:00',
        confirmedAt: '2026-08-01T10:01:00+07:00', caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED',
        safeErrorCode: '', updatedAt: '2026-08-01T10:01:00+07:00', paymentEvidenceObjectKeysJson: '[]',
        chatEvidenceObjectKeysJson: '[]', taskName: '', queuedAt: '', processingStartedAt: '',
        processingLeaseUntil: '', lastProgressAt: '', attemptCount: 1, processingOwnerToken: '',
        evidenceProjectionHash: '',
      })],
      preservationFingerprint: 'request-preserved-v1',
    },
    master: {
      headers: [...LEGACY_BOOKING_MASTER_HEADERS],
      rows: [
        masterRow({
          caseId: 'PMC-202608-0001', formResponseId: 'mini:request-1', adminId: 'staff-1', adminName: 'มัส',
          submitterEmail: 'mas@example.com', aeId: 'ae-1', aeName: 'หมวย',
        }),
        masterRow({
          caseId: 'PMC-202608-0002', formResponseId: 'form-response-2', adminId: 'staff-1', adminName: 'มัส',
          submitterEmail: 'waew@example.com', aeId: '', aeName: 'ไม่ระบุ',
        }),
        masterRow({
          caseId: 'PMC-202608-0003', formResponseId: 'form-response-3', adminId: 'staff-1', adminName: 'มัส',
          submitterEmail: 'unknown@example.com', aeId: '', aeName: 'ไม่ระบุ',
        }),
      ],
      preservationFingerprint: 'master-preserved-v1',
    },
    staff,
    queueState: 'PAUSED',
    activeTaskCount: 0,
    requestRowLimit: 10_000,
    masterRowLimit: 100_000,
  }
}

function masterRow(patch: Record<string, unknown>): unknown[] {
  return row(LEGACY_BOOKING_MASTER_HEADERS, {
    caseId: 'PMC-202608-0001', version: 1, status: 'BOOKING_CONFIRMED', formResponseId: 'form-response',
    adminId: 'staff-1', adminName: 'มัส', submitterEmail: 'mas@example.com', adminIdentityStatus: 'SELECTED_ADMIN',
    aeId: '', aeName: 'ไม่ระบุ', queueType: 'NORMAL', appointmentStatus: 'CONFIRMED',
    customerName: 'ลูกค้า', facebookName: 'FB', phoneNormalized: '0812345678', phoneMasked: '081-xxx-5678',
    doctorId: 'doctor-1', serviceId: 'service-1', channelId: 'channel-1', depositAmount: 900,
    ...patch,
  })
}

function targetSnapshotFrom(plan: BookingAttributionMigrationPlan): AttributionMigrationSheetSnapshot {
  if (plan.kind !== 'MIGRATE') throw new Error('expected migration plan')
  return {
    request: {
      headers: [...TARGET_MINI_APP_REQUEST_HEADERS], rows: plan.requestRows.map((item) => [...item]),
      preservationFingerprint: plan.requestPreservationFingerprint,
    },
    master: {
      headers: [...TARGET_BOOKING_MASTER_HEADERS], rows: plan.masterRows.map((item) => [...item]),
      preservationFingerprint: plan.masterPreservationFingerprint,
    },
    staff: legacySnapshot().staff,
    queueState: 'PAUSED', activeTaskCount: 0, requestRowLimit: 10_000, masterRowLimit: 100_000,
  }
}

function workflowFake(initialSnapshots: AttributionMigrationSheetSnapshot[]) {
  const effects: string[] = []
  const snapshots = [...initialSnapshots]
  const source = initialSnapshots[0]
  const queue = { state: source.queueState, active: source.activeTaskCount }
  const ports: BookingAttributionMigrationPorts = {
    queueGate: {
      state() { effects.push('queue.state'); return queue.state },
      activeTaskCount() { effects.push('queue.activeTaskCount'); return queue.active },
    },
    readSnapshot() {
      effects.push('sheet.read')
      const next = snapshots.shift()
      if (!next) throw new Error('unexpected read')
      return clone(next)
    },
    withLock(operation) {
      effects.push('lock.enter')
      try { return operation() } finally { effects.push('lock.exit') }
    },
    createPrivateNativeBackup() { effects.push('backup.create') },
    writeMigration() { effects.push('sheet.write') },
  }
  return { ports, effects }
}

function row(headers: readonly string[], value: Record<string, unknown>): unknown[] {
  return headers.map((header) => value[header] ?? '')
}

function objectRows(headers: readonly string[], rows: readonly unknown[][]): Array<Record<string, unknown>> {
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function fakeMigrationSpreadsheet(source: AttributionMigrationSheetSnapshot) {
  const staffHeaders = ['id', 'name', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active']
  const staffRows = source.staff.map((item) => [
    item.id, item.name, item.email, '', true, item.canBeAe, item.active,
  ])
  const sheets = {
    MINI_APP_REQUESTS: fakeMigrationSheet([source.request.headers, ...source.request.rows], 1, 0),
    BOOKING_MASTER: fakeMigrationSheet([source.master.headers, ...source.master.rows], 1, 2),
    CONFIG_STAFF: fakeMigrationSheet([staffHeaders, ...staffRows], 1, 0),
  }
  return {
    sheets,
    spreadsheet: {
      getSheetByName(name: string) {
        return sheets[name as keyof typeof sheets] ?? null
      },
    } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet,
  }
}

function fakeMigrationSheet(initial: unknown[][], frozenRows: number, frozenColumns: number) {
  const values = initial.map((item) => [...item])
  const formats = initial.map((item, rowIndex) => item.map((_value, columnIndex) => (
    rowIndex === 0 ? `header-${columnIndex}` : `format-${rowIndex}-${columnIndex}`
  )))
  const formulas = initial.map((item) => item.map(() => ''))
  const validations = initial.map((item) => item.map(() => null))
  const sheet = {
    frozenRows,
    frozenColumns,
    filterColumnCount: null as number | null,
    expandFilterOnInsert: true,
    getLastRow: () => values.length,
    getLastColumn: () => values[0]?.length ?? 0,
    getFrozenRows: () => sheet.frozenRows,
    getFrozenColumns: () => sheet.frozenColumns,
    getFilter: () => sheet.filterColumnCount === null ? null : ({
      getRange: () => ({
        getRow: () => 1,
        getColumn: () => 1,
        getNumRows: () => values.length,
        getNumColumns: () => sheet.filterColumnCount!,
      }),
      getColumnFilterCriteria: () => null,
    }),
    getRange(row: number, column: number, rows = 1, columns = 1) {
      const pick = <T>(matrix: T[][]) => matrix.slice(row - 1, row - 1 + rows)
        .map((item) => item.slice(column - 1, column - 1 + columns))
      return {
        getValues: () => pick(values),
        getFormulas: () => pick(formulas),
        getNumberFormats: () => pick(formats),
        getDataValidations: () => pick(validations),
        setValues(next: unknown[][]) {
          for (let rowOffset = 0; rowOffset < rows; rowOffset += 1) {
            for (let columnOffset = 0; columnOffset < columns; columnOffset += 1) {
              values[row - 1 + rowOffset][column - 1 + columnOffset] = next[rowOffset][columnOffset]
            }
          }
        },
        setNumberFormat(format: string) {
          for (let rowOffset = 0; rowOffset < rows; rowOffset += 1) {
            for (let columnOffset = 0; columnOffset < columns; columnOffset += 1) {
              formats[row - 1 + rowOffset][column - 1 + columnOffset] = format
            }
          }
        },
      }
    },
    insertColumnsBefore(before: number, count: number) { insert(before - 1, count) },
    insertColumnsAfter(after: number, count: number) { insert(after, count) },
  }
  function insert(index: number, count: number) {
    if (sheet.expandFilterOnInsert && sheet.filterColumnCount !== null && index < sheet.filterColumnCount) {
      sheet.filterColumnCount += count
    }
    for (const row of values) row.splice(index, 0, ...Array(count).fill(''))
    for (const row of formats) row.splice(index, 0, ...Array(count).fill('inserted'))
    for (const row of formulas) row.splice(index, 0, ...Array(count).fill(''))
    for (const row of validations) row.splice(index, 0, ...Array(count).fill(null))
  }
  return sheet
}
