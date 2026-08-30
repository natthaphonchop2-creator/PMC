import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  LEGACY_BOOKING_MASTER_HEADERS,
  LEGACY_MINI_APP_REQUEST_HEADERS,
  TARGET_BOOKING_MASTER_HEADERS,
  TARGET_MINI_APP_REQUEST_HEADERS,
  planBookingAttributionMigration,
  verifyBookingAttributionMigrationReadback,
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
  BOOKING_ATTRIBUTION_SHEET_WRITE_PHASES,
  readGoogleBookingAttributionMigrationSnapshot,
  writeGoogleBookingAttributionMigration,
} from '../src/adapters/googleSheets'
import {
  canonicalBookingQueueAttestation,
  createBookingMigrationManifestEnvelope,
  parseBookingMigrationManifestJson,
  parseBookingQueueAttestationJson,
  validateBookingMigrationManifestTransition,
  type BookingMigrationManifest,
  type BookingMigrationManifestPayload,
  type UnsignedBookingQueueAttestation,
} from '../src/domain/attributionMigrationState'
import {
  normalizeAttributionSheetMetadata,
} from '../src/domain/attributionSheetMetadata'
import {
  advancedMetadataFixture,
  metadataFixtureWithInsertedColumn,
  mutateMetadataComponent,
} from './helpers/attributionMigrationFakes'

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

  it.each([
    ['reserved recorder ID', { id: 'NONE', name: 'No AE' }, 'staffId'],
    ['reserved recorder name', { id: 'staff-reserved', name: 'ไม่ระบุ' }, 'staffId'],
    ['reserved AE ID', { id: 'NONE', name: 'No AE' }, 'aeName'],
    ['reserved AE name', { id: 'ae-reserved', name: 'ไม่ระบุ' }, 'aeName'],
  ])('rejects %s instead of persisting a sentinel as Staff', (_label, reserved, source) => {
    const snapshot = legacySnapshot()
    snapshot.staff.push({
      ...reserved,
      email: 'reserved@example.com',
      active: source === 'aeName',
      canBeAe: source === 'aeName',
    })
    if (source === 'staffId') {
      snapshot.request.rows[0][snapshot.request.headers.indexOf('staffId')] = reserved.id
    } else {
      snapshot.request.rows[0][snapshot.request.headers.indexOf('aeName')] = reserved.name
    }

    expect(() => planBookingAttributionMigration(snapshot)).toThrow('RESERVED_ATTRIBUTION_IDENTITY')
  })

  it.each([' ไม่ระบุ', 'ไม่ระบุ ', ' none '])('accepts only blank or exact ไม่ระบุ as legacy no-AE, rejecting %s', (label) => {
    const snapshot = legacySnapshot()
    snapshot.request.rows[0][snapshot.request.headers.indexOf('aeName')] = label

    expect(() => planBookingAttributionMigration(snapshot)).toThrow('LEGACY_REQUEST_AE_UNRESOLVED')
  })

  it('fails closed on ambiguous exact Mini App correlation', () => {
    const snapshot = legacySnapshot()
    snapshot.request.rows.push([...snapshot.request.rows[0]])

    expect(() => planBookingAttributionMigration(snapshot)).toThrow('AMBIGUOUS_MINI_APP_CORRELATION')
  })

  it('rejects contradictory Mini App form-response and case correlation keys', () => {
    const snapshot = legacySnapshot()
    snapshot.master.rows[0][snapshot.master.headers.indexOf('formResponseId')] = 'mini:missing-request'

    expect(() => planBookingAttributionMigration(snapshot)).toThrow('CONTRADICTORY_MINI_APP_CORRELATION')
  })

  it.each([
    ['missing assumed Admin ID', { adminId: 'missing', adminName: 'แวว' }],
    ['mismatched assumed Admin name', { adminId: 'staff-2', adminName: 'มัส' }],
    ['reserved assumed Admin', { adminId: 'NONE', adminName: 'No AE' }],
  ])('rejects %s instead of inventing assumed provenance', (_label, patch) => {
    const snapshot = legacySnapshot()
    if (patch.adminId === 'NONE') {
      snapshot.staff.push({ id: 'NONE', name: 'No AE', email: '', active: false, canBeAe: false })
    }
    const record = objectRows(LEGACY_BOOKING_MASTER_HEADERS, snapshot.master.rows)[0]
    snapshot.master.rows[0] = row(LEGACY_BOOKING_MASTER_HEADERS, {
      ...record, caseId: 'PMC-202608-9999', formResponseId: 'mini:missing-request', ...patch,
    })

    expect(() => planBookingAttributionMigration(snapshot)).toThrow(/LEGACY_ASSUMED_ADMIN_INVALID|RESERVED_ATTRIBUTION_IDENTITY/)
  })

  it('rejects a Form email match to a reserved Staff row', () => {
    const snapshot = legacySnapshot()
    snapshot.staff.push({ id: 'NONE', name: 'No AE', email: 'reserved@example.com', active: true, canBeAe: false })
    snapshot.master.rows[1][snapshot.master.headers.indexOf('submitterEmail')] = 'reserved@example.com'

    expect(() => planBookingAttributionMigration(snapshot)).toThrow('RESERVED_ATTRIBUTION_IDENTITY')
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
    expect(fake.effects).toEqual(['manifest.read', 'queue.read', 'sheet.read'])
  })

  it('persists PREPARED after verified backup and COMPLETE only after exact readback', () => {
    const source = legacySnapshot()
    const plan = planBookingAttributionMigration(source)
    const fake = workflowFake([source, source, targetSnapshotFrom(plan)])

    const result = applyBookingAttributionMigration(fake.ports)

    expect(result).toMatchObject({
      status: 'COMPLETE',
      readbackVerified: true,
    })
    expect(fake.effects).toEqual([
      'manifest.read', 'queue.read', 'sheet.read',
      'lock.enter', 'manifest.read', 'queue.read', 'sheet.read',
      'backup.createVerified', 'manifest.createPrepared',
      'sheet.write', 'sheet.read', 'manifest.replace.COMPLETE', 'lock.exit',
    ])
    expect(fake.manifest()?.state).toBe('COMPLETE')
  })

  it('fails on a changed under-lock fingerprint before backup or schema write', () => {
    const first = legacySnapshot()
    const changed = legacySnapshot()
    changed.master.rows[0][changed.master.headers.indexOf('adminName')] = 'changed'
    const fake = workflowFake([first, changed])

    expect(() => applyBookingAttributionMigration(fake.ports)).toThrow('MIGRATION_FINGERPRINT_CHANGED')
    expect(fake.effects).not.toContain('backup.createVerified')
    expect(fake.effects).not.toContain('sheet.write')
  })

  it('rejects a newer unsafe whole queue attestation under lock before backup', () => {
    const source = legacySnapshot()
    const initial = signedAttestation(queueAttestation({ attestationId: 'attestation-initial' }))
    const locked = signedAttestation(queueAttestation({
      attestationId: 'attestation-locked', state: 'RUNNING', activeTaskCount: 0,
    }))
    const fake = workflowFake([source, source], { attestations: [initial, locked] })

    expect(() => applyBookingAttributionMigration(fake.ports)).toThrow('QUEUE_NOT_PAUSED')
    expect(fake.effects).not.toContain('backup.createVerified')
    expect(fake.effects).not.toContain('manifest.createPrepared')
  })

  it('marks RESTORE_REQUIRED after a readback mismatch and reruns with zero Sheet writes', () => {
    const source = legacySnapshot()
    const plan = planBookingAttributionMigration(source)
    const readback = targetSnapshotFrom(plan)
    readback.master.rows[0][readback.master.headers.indexOf('adminName')] = 'corrupted'
    const fake = workflowFake([source, source, readback])

    expect(applyBookingAttributionMigration(fake.ports)).toMatchObject({
      status: 'RESTORE_REQUIRED', readbackVerified: false,
    })
    expect(fake.manifest()?.state).toBe('RESTORE_REQUIRED')
    expect(fake.effects).toContain('backup.createVerified')
    expect(fake.effects).toContain('sheet.write')
    const writes = fake.effects.filter((effect) => effect === 'sheet.write').length
    expect(applyBookingAttributionMigration(fake.ports)).toMatchObject({ status: 'RESTORE_REQUIRED' })
    expect(fake.effects.filter((effect) => effect === 'sheet.write')).toHaveLength(writes)
  })

  it('rejects a non-empty target workbook without a valid COMPLETE manifest', () => {
    const target = targetSnapshotFrom(planBookingAttributionMigration(legacySnapshot()))
    const fake = workflowFake([target])

    expect(() => applyBookingAttributionMigration(fake.ports)).toThrow('UNMANIFESTED_PARTIAL_TARGET')
    expect(fake.effects).not.toContain('lock.enter')
    expect(fake.effects).not.toContain('sheet.write')
  })

  it.each(['PREPARED', 'RESTORE_REQUIRED'] as const)('returns sanitized restore-required for %s with zero mutation', (state) => {
    const source = legacySnapshot()
    const plan = planBookingAttributionMigration(source)
    const fake = workflowFake([source], { manifest: manifestForPlan(plan, state) })

    expect(applyBookingAttributionMigration(fake.ports)).toEqual({
      status: 'RESTORE_REQUIRED', readbackVerified: false,
    })
    expect(fake.effects).toEqual(['manifest.read'])
  })

  it('uses COMPLETE idempotency after validating the manifest-bound prefix and permits valid appended rows', () => {
    const source = legacySnapshot()
    source.request.preservationStructureFingerprint = sha256('request-structure')
    source.request.preservationRowFingerprints = [sha256('request-header'), sha256('request-row-1')]
    source.master.preservationStructureFingerprint = sha256('master-structure')
    source.master.preservationRowFingerprints = [
      sha256('master-header'), sha256('master-row-1'), sha256('master-row-2'), sha256('master-row-3'),
    ]
    const plan = planBookingAttributionMigration(source)
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')
    const target = targetSnapshotFrom(plan)
    target.request.preservationStructureFingerprint = source.request.preservationStructureFingerprint
    target.request.preservationRowFingerprints = [
      ...source.request.preservationRowFingerprints, sha256('request-row-new'),
    ]
    target.master.preservationStructureFingerprint = source.master.preservationStructureFingerprint
    target.master.preservationRowFingerprints = [
      ...source.master.preservationRowFingerprints, sha256('master-row-new'),
    ]
    target.request.rows.push([...target.request.rows[0]])
    target.request.rows[1][target.request.headers.indexOf('requestId')] = 'request-new'
    target.request.rows[1][target.request.headers.indexOf('draftId')] = 'draft-new'
    target.request.rows[1][target.request.headers.indexOf('caseId')] = 'PMC-202608-0099'
    target.master.rows.push([...target.master.rows[0]])
    target.master.rows[3][target.master.headers.indexOf('caseId')] = 'PMC-202608-0099'
    const fake = workflowFake([target, target], { manifest: manifestForPlan(plan, 'COMPLETE') })

    expect(applyBookingAttributionMigration(fake.ports)).toEqual({
      status: 'COMPLETE', readbackVerified: true,
    })
    expect(fake.effects).toEqual(['manifest.read', 'sheet.read'])
  })

  it('accepts a valid appended protocol-2 pre-save draft with no Admin selection yet', () => {
    const plan = planBookingAttributionMigration(legacySnapshot())
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')
    const target = targetSnapshotFrom(plan)
    const draft = [...target.request.rows[0]]
    const set = (header: string, value: unknown) => {
      draft[(TARGET_MINI_APP_REQUEST_HEADERS as readonly string[]).indexOf(header)] = value
    }
    set('requestId', 'request-new')
    set('draftId', 'draft-new')
    set('protocolVersion', 2)
    set('state', 'DRAFT')
    set('payloadHash', '')
    set('adminId', '')
    set('adminName', '')
    set('aeId', '')
    set('aeName', 'ไม่ระบุ')
    set('caseId', '')
    target.request.rows.push(draft)
    const fake = workflowFake([target], { manifest: manifestForPlan(plan, 'COMPLETE') })

    expect(applyBookingAttributionMigration(fake.ports)).toEqual({
      status: 'COMPLETE', readbackVerified: true,
    })
    expect(fake.effects).toEqual(['manifest.read', 'sheet.read'])
  })

  it('conservatively marks RESTORE_REQUIRED when a COMPLETE manifest no longer matches target structure', () => {
    const plan = planBookingAttributionMigration(legacySnapshot())
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')
    const target = targetSnapshotFrom(plan)
    target.master.rows[0][target.master.headers.indexOf('recorderName')] = ''
    const fake = workflowFake([target], { manifest: manifestForPlan(plan, 'COMPLETE') })

    expect(applyBookingAttributionMigration(fake.ports)).toEqual({
      status: 'RESTORE_REQUIRED', readbackVerified: false,
    })
    expect(fake.manifest()?.state).toBe('RESTORE_REQUIRED')
    expect(fake.effects).not.toContain('sheet.write')
  })

  it.each([
    'backup', 'prepared', ...BOOKING_ATTRIBUTION_SHEET_WRITE_PHASES,
    'final.readback', 'before.complete', 'after.complete',
  ])('never reports a generic no-op after the %s fault boundary', (failAt) => {
    const source = legacySnapshot()
    const plan = planBookingAttributionMigration(source)
    const fake = workflowFake([source, source, targetSnapshotFrom(plan)], { failAt })

    if (failAt === 'backup') {
      expect(() => applyBookingAttributionMigration(fake.ports)).toThrow('BACKUP_FAILED')
      expect(fake.manifest()).toBeNull()
      return
    }
    const result = applyBookingAttributionMigration(fake.ports)
    expect(result.status).toMatch(/^(RESTORE_REQUIRED|COMPLETE)$/)
    expect(result).not.toHaveProperty('kind', 'NONE')
    expect(fake.manifest()?.state).toBe(result.status)
  })

  it('retains PREPARED if the RESTORE_REQUIRED manifest write itself fails', () => {
    const source = legacySnapshot()
    const plan = planBookingAttributionMigration(source)
    const fake = workflowFake([source, source, targetSnapshotFrom(plan)], {
      failAt: 'request.insert.protocol', failRestoreWrite: true,
    })

    expect(applyBookingAttributionMigration(fake.ports)).toMatchObject({ status: 'RESTORE_REQUIRED' })
    expect(fake.manifest()?.state).toBe('PREPARED')
  })
})

describe('Google Sheet attribution migration adapter', () => {
  it('inserts only target columns and preserves all non-target values and presentation metadata', () => {
    const source = legacySnapshot()
    const fake = fakeMigrationSpreadsheet(source)
    const adapterSnapshot = readGoogleBookingAttributionMigrationSnapshot(
      fake.spreadsheet, sha256, fake.advancedMetadata(),
    )
    const plan = planBookingAttributionMigration({
      ...adapterSnapshot,
      queueState: 'PAUSED', activeTaskCount: 0, requestRowLimit: 10_000, masterRowLimit: 100_000,
      hashValue: sha256,
    })
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')

    writeGoogleBookingAttributionMigration(fake.spreadsheet, plan)
    const readback = readGoogleBookingAttributionMigrationSnapshot(
      fake.spreadsheet, sha256, fake.advancedMetadata(),
    )

    expect(readback.request.headers).toEqual(TARGET_MINI_APP_REQUEST_HEADERS)
    expect(readback.master.headers).toEqual(TARGET_BOOKING_MASTER_HEADERS)
    expect(readback.request.rows).toEqual(plan.requestRows)
    expect(readback.master.rows).toEqual(plan.masterRows)
    expect(() => verifyBookingAttributionMigrationReadback(plan, {
      ...readback,
      staff: source.staff,
      queueState: 'PAUSED', activeTaskCount: 0,
      requestRowLimit: 10_000, masterRowLimit: 100_000,
      hashValue: sha256,
    })).not.toThrow()
    expect(fake.sheets.MINI_APP_REQUESTS.frozenRows).toBe(1)
    expect(fake.sheets.BOOKING_MASTER.frozenColumns).toBe(2)
  })

  it('fails closed on a reordered CONFIG_STAFF header used for attribution', () => {
    const fake = fakeMigrationSpreadsheet(legacySnapshot())
    const header = fake.sheets.CONFIG_STAFF.getRange(1, 1, 1, 7).getValues()[0]
    ;[header[0], header[1]] = [header[1], header[0]]
    fake.sheets.CONFIG_STAFF.getRange(1, 1, 1, 7).setValues([header])

    expect(() => readGoogleBookingAttributionMigrationSnapshot(
      fake.spreadsheet, sha256, fake.advancedMetadata(),
    ))
      .toThrow('CONFIG_STAFF attribution header mismatch')
  })

  it('detects when a pre-existing filter fails to expand with inserted attribution columns', () => {
    const fake = fakeMigrationSpreadsheet(legacySnapshot())
    fake.sheets.BOOKING_MASTER.filterColumnCount = LEGACY_BOOKING_MASTER_HEADERS.length
    fake.sheets.BOOKING_MASTER.expandFilterOnInsert = false
    const before = readGoogleBookingAttributionMigrationSnapshot(
      fake.spreadsheet, sha256, fake.advancedMetadata(),
    )
    const plan = planBookingAttributionMigration({
      ...before,
      queueState: 'PAUSED', activeTaskCount: 0, requestRowLimit: 10_000, masterRowLimit: 100_000,
      hashValue: sha256,
    })
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')

    writeGoogleBookingAttributionMigration(fake.spreadsheet, plan)
    const readback = readGoogleBookingAttributionMigrationSnapshot(
      fake.spreadsheet, sha256, fake.advancedMetadata(),
    )

    expect(readback.master.preservationFingerprint).not.toBe(plan.masterPreservationFingerprint)
  })

  it('fails preflight explicitly when Sheets v4 metadata is unavailable', () => {
    const fake = fakeMigrationSpreadsheet(legacySnapshot())
    expect(() => readGoogleBookingAttributionMigrationSnapshot(fake.spreadsheet, sha256))
      .toThrow('SHEETS_V4_METADATA_UNAVAILABLE')
  })

  it.each(BOOKING_ATTRIBUTION_SHEET_WRITE_PHASES)('exposes the exact post-effect fault boundary %s', (phase) => {
    const source = legacySnapshot()
    const fake = fakeMigrationSpreadsheet(source)
    const before = readGoogleBookingAttributionMigrationSnapshot(
      fake.spreadsheet, sha256, fake.advancedMetadata(),
    )
    const plan = planBookingAttributionMigration({
      ...before,
      queueState: 'PAUSED', activeTaskCount: 0,
      requestRowLimit: 10_000, masterRowLimit: 100_000,
      hashValue: sha256,
    })
    if (plan.kind !== 'MIGRATE') throw new Error('expected migration')
    const observed: string[] = []

    expect(() => writeGoogleBookingAttributionMigration(fake.spreadsheet, plan, {
      afterEffect(current) {
        observed.push(current)
        if (current === phase) throw new Error('INJECTED_MIGRATION_FAILURE')
      },
    })).toThrow('INJECTED_MIGRATION_FAILURE')
    expect(observed[observed.length - 1]).toBe(phase)
  })
})

describe('Booking migration queue attestation and durable manifest', () => {
  it('parses one exact SHA-256-bound queue attestation snapshot', () => {
    const unsigned = queueAttestation()
    const raw = JSON.stringify({ ...unsigned, digest: sha256(canonicalBookingQueueAttestation(unsigned)) })

    expect(parseBookingQueueAttestationJson(raw, {
      nowMs: Date.parse('2026-08-30T08:01:00.000Z'),
      maxAgeMs: 10 * 60_000,
      environment: 'production',
      queueResourceDigest: 'b'.repeat(64),
      checkerVersion: 'pmc-booking-attribution-v2/1',
      sha256,
    })).toMatchObject({ state: 'PAUSED', activeTaskCount: 0 })
  })

  it.each([
    ['malformed JSON', '{'],
    ['extra field', signedQueueJson({ extra: true })],
    ['stale', signedQueueJson({ verifiedAt: '2026-08-30T07:40:00.000Z' })],
    ['wrong environment', signedQueueJson({ environment: 'staging' })],
    ['wrong queue', signedQueueJson({ queueResourceDigest: 'c'.repeat(64) })],
    ['wrong checker', signedQueueJson({ checkerVersion: 'old-checker' })],
    ['torn digest', signedQueueJson({ activeTaskCount: 1 }, { digestFrom: queueAttestation() })],
  ])('rejects a %s attestation', (_label, raw) => {
    expect(() => parseBookingQueueAttestationJson(raw, {
      nowMs: Date.parse('2026-08-30T08:01:00.000Z'),
      maxAgeMs: 10 * 60_000,
      environment: 'production',
      queueResourceDigest: 'b'.repeat(64),
      checkerVersion: 'pmc-booking-attribution-v2/1',
      sha256,
    })).toThrow(/QUEUE_ATTESTATION/)
  })

  it('roundtrips an exact digest-bound PREPARED manifest and rejects tampering', () => {
    const payload = preparedManifestPayload()
    const envelope = createBookingMigrationManifestEnvelope(payload, sha256)

    expect(parseBookingMigrationManifestJson(JSON.stringify(envelope), sha256)).toEqual(envelope)
    expect(() => parseBookingMigrationManifestJson(JSON.stringify({
      ...envelope, state: 'COMPLETE',
    }), sha256)).toThrow('MIGRATION_MANIFEST_INVALID')
  })
})

describe('Advanced Sheets attribution metadata normalization', () => {
  it('normalizes a correct inserted column to the exact source presentation metadata', () => {
    const source = advancedMetadataFixture()
    const target = metadataFixtureWithInsertedColumn(source, 2)

    expect(normalizeAttributionSheetMetadata(target, [2])).toEqual(
      normalizeAttributionSheetMetadata(source, []),
    )
  })

  it.each([
    'format', 'validation', 'note', 'textRuns', 'formula', 'rowSize', 'columnHidden', 'frozen',
    'merge', 'basicFilter', 'filterView', 'banding', 'conditional', 'rowGroup', 'columnGroup',
  ])('detects a %s mutation in the promised non-target metadata surface', (component) => {
    const source = normalizeAttributionSheetMetadata(advancedMetadataFixture(), [])
    const changed = normalizeAttributionSheetMetadata(
      mutateMetadataComponent(advancedMetadataFixture(), component),
      [],
    )

    expect(changed).not.toEqual(source)
  })

  it.each(['charts', 'tables', 'protectedRanges', 'developerMetadata'])('rejects unsupported %s before backup', (field) => {
    const fixture = advancedMetadataFixture()
    fixture[field] = [{ id: 1 }]
    expect(() => normalizeAttributionSheetMetadata(fixture, [])).toThrow('UNSUPPORTED_SHEETS_METADATA')
  })

  it('rejects a pivot table embedded in managed grid data before backup', () => {
    const fixture = advancedMetadataFixture()
    const data = (fixture.data as Array<Record<string, unknown>>)[0]
    const rows = data.rowData as Array<{ values: Array<Record<string, unknown>> }>
    rows[1].values[1].pivotTable = { source: { sheetId: 11 } }
    expect(() => normalizeAttributionSheetMetadata(fixture, [])).toThrow('UNSUPPORTED_SHEETS_METADATA')
  })

  it('rejects self-referential validation formulas that cannot be range-normalized safely', () => {
    const fixture = advancedMetadataFixture()
    const data = (fixture.data as Array<Record<string, unknown>>)[0]
    const rows = data.rowData as Array<{ values: Array<Record<string, unknown>> }>
    rows[1].values[1].dataValidation = {
      condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=$A$2:$A$20' }] },
    }
    expect(() => normalizeAttributionSheetMetadata(fixture, [])).toThrow('UNSUPPORTED_SHEETS_METADATA')
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
      preservationFingerprint: sha256('request-preserved-v1'),
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
      preservationFingerprint: sha256('master-preserved-v1'),
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

function workflowFake(
  initialSnapshots: AttributionMigrationSheetSnapshot[],
  options: {
    manifest?: BookingMigrationManifest
    failAt?: string
    failRestoreWrite?: boolean
    attestations?: ReturnType<typeof signedAttestation>[]
  } = {},
) {
  const effects: string[] = []
  const snapshots = [...initialSnapshots]
  let manifest = options.manifest ? clone(options.manifest) : null
  const attestations = [...(options.attestations ?? [signedAttestation(queueAttestation())])]
  const maybeFail = (phase: string, afterEffect = false) => {
    if (options.failAt !== phase) return
    if (!afterEffect) throw new Error(phase === 'backup' ? 'BACKUP_FAILED' : 'INJECTED_MIGRATION_FAILURE')
    throw new Error('INJECTED_MIGRATION_FAILURE')
  }
  const ports: BookingAttributionMigrationPorts = {
    queueGate: {
      readAttestation() {
        effects.push('queue.read')
        const next = attestations.length > 1 ? attestations.shift() : attestations[0]
        if (!next) throw new Error('QUEUE_ATTESTATION_INVALID')
        return clone(next)
      },
    },
    manifest: {
      read() {
        effects.push('manifest.read')
        return manifest ? clone(manifest) : null
      },
      createPrepared(payload) {
        effects.push('manifest.createPrepared')
        if (manifest) throw new Error('MIGRATION_MANIFEST_ALREADY_EXISTS')
        manifest = createBookingMigrationManifestEnvelope(payload, sha256)
        maybeFail('prepared', true)
        return clone(manifest)
      },
      replaceExpected(expectedDigest, payload) {
        effects.push(`manifest.replace.${payload.state}`)
        if (!manifest || manifest.digest !== expectedDigest) throw new Error('MIGRATION_MANIFEST_CONFLICT')
        validateBookingMigrationManifestTransition(manifest, payload)
        if (payload.state === 'RESTORE_REQUIRED' && options.failRestoreWrite) {
          throw new Error('MIGRATION_MANIFEST_WRITE_FAILED')
        }
        manifest = createBookingMigrationManifestEnvelope(payload, sha256)
        if (payload.state === 'COMPLETE') maybeFail('after.complete', true)
        return clone(manifest)
      },
    },
    readSnapshot() {
      effects.push('sheet.read')
      if (options.failAt === 'final.readback' && effects.includes('sheet.write')) {
        throw new Error('INJECTED_MIGRATION_FAILURE')
      }
      const next = snapshots.shift()
      if (!next) throw new Error('unexpected read')
      return clone(next)
    },
    withLock(operation) {
      effects.push('lock.enter')
      try { return operation() } finally { effects.push('lock.exit') }
    },
    createAndVerifyPrivateNativeBackup(sourceFingerprint) {
      effects.push('backup.createVerified')
      maybeFail('backup')
      return {
        fileId: 'backup-file-0001',
        mimeType: 'application/vnd.google-apps.spreadsheet' as const,
        parentId: 'backup-folder-0001',
        sourceFingerprint,
      }
    },
    writeMigration() {
      effects.push('sheet.write')
      for (const phase of BOOKING_ATTRIBUTION_SHEET_WRITE_PHASES) maybeFail(phase)
    },
    nowIso: () => '2026-08-30T08:00:00.000Z',
    sha256,
    beforeComplete() {
      maybeFail('before.complete')
    },
  }
  return { ports, effects, manifest: () => manifest ? clone(manifest) : null }
}

function manifestForPlan(
  plan: BookingAttributionMigrationPlan,
  state: 'PREPARED' | 'COMPLETE' | 'RESTORE_REQUIRED',
): BookingMigrationManifest {
  if (plan.kind !== 'MIGRATE') throw new Error('expected migration plan')
  const base = preparedManifestPayload()
  return createBookingMigrationManifestEnvelope({
    ...base,
    state,
    sourceFingerprint: plan.preflightFingerprint,
    backupSourceFingerprint: plan.preflightFingerprint,
    expected: {
      requestHeaderHash: plan.requestHeaderHash,
      masterHeaderHash: plan.masterHeaderHash,
      requestValueHash: plan.requestValueHash,
      masterValueHash: plan.masterValueHash,
      requestNonTargetValueHash: plan.requestNonTargetValueHash,
      masterNonTargetValueHash: plan.masterNonTargetValueHash,
      requestPreservationHash: plan.requestPreservationFingerprint,
      masterPreservationHash: plan.masterPreservationFingerprint,
    },
    requestRowCount: plan.requestRows.length,
    masterRowCount: plan.masterRows.length,
    completedAt: state === 'COMPLETE' ? '2026-08-30T08:00:00.000Z' : null,
    safeFailureCode: state === 'RESTORE_REQUIRED' ? 'MIGRATION_APPLY_FAILED' : null,
  }, sha256)
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

function queueAttestation(patch: Partial<UnsignedBookingQueueAttestation> = {}): UnsignedBookingQueueAttestation {
  return {
    version: 1,
    environment: 'production',
    queueResourceDigest: 'b'.repeat(64),
    state: 'PAUSED',
    activeTaskCount: 0,
    verifiedAt: '2026-08-30T08:00:00.000Z',
    checkerVersion: 'pmc-booking-attribution-v2/1',
    attestationId: 'attestation-0001',
    ...patch,
  }
}

function signedAttestation(value: UnsignedBookingQueueAttestation) {
  return { ...value, digest: sha256(canonicalBookingQueueAttestation(value)) }
}

function signedQueueJson(
  patch: Record<string, unknown>,
  options: { digestFrom?: UnsignedBookingQueueAttestation } = {},
): string {
  const value = { ...queueAttestation(), ...patch }
  const digestInput = options.digestFrom ?? value as UnsignedBookingQueueAttestation
  return JSON.stringify({
    ...value,
    digest: sha256(canonicalBookingQueueAttestation(digestInput)),
  })
}

function preparedManifestPayload(): BookingMigrationManifestPayload {
  return {
    version: 1,
    migration: 'PMC_BOOKING_ATTRIBUTION_V2',
    state: 'PREPARED',
    sourceFingerprint: 'a'.repeat(64),
    backupFileId: 'backup-file-0001',
    backupMimeType: 'application/vnd.google-apps.spreadsheet',
    backupParentId: 'backup-folder-0001',
    backupSourceFingerprint: 'a'.repeat(64),
    expected: {
      requestHeaderHash: '1'.repeat(64), masterHeaderHash: '2'.repeat(64),
      requestValueHash: '3'.repeat(64), masterValueHash: '4'.repeat(64),
      requestNonTargetValueHash: '5'.repeat(64), masterNonTargetValueHash: '6'.repeat(64),
      requestPreservationHash: '7'.repeat(64), masterPreservationHash: '8'.repeat(64),
    },
    requestRowCount: 1,
    masterRowCount: 3,
    queueAttestationDigest: '9'.repeat(64),
    preparedAt: '2026-08-30T08:00:00.000Z',
    updatedAt: '2026-08-30T08:00:00.000Z',
    completedAt: null,
    safeFailureCode: null,
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
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
    advancedMetadata: () => ({
      MINI_APP_REQUESTS: sheets.MINI_APP_REQUESTS.advancedMetadata('MINI_APP_REQUESTS', 10),
      BOOKING_MASTER: sheets.BOOKING_MASTER.advancedMetadata('BOOKING_MASTER', 11),
    }),
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
    advancedMetadata(title: string, sheetId: number) {
      const rowData = values.map((_row, rowIndex) => ({
        values: formats[rowIndex].map((format, columnIndex) => ({
          userEnteredValue: formulas[rowIndex][columnIndex]
            ? { formulaValue: formulas[rowIndex][columnIndex] }
            : undefined,
          userEnteredFormat: {
            numberFormat: { type: 'TEXT', pattern: format },
            wrapStrategy: 'WRAP',
          },
          dataValidation: validations[rowIndex][columnIndex] ?? undefined,
        })),
      }))
      return {
        properties: {
          sheetId,
          title,
          gridProperties: {
            rowCount: values.length,
            columnCount: values[0]?.length ?? 0,
            frozenRowCount: sheet.frozenRows,
            frozenColumnCount: sheet.frozenColumns,
            hideGridlines: false,
          },
        },
        data: [{
          startRow: 0, startColumn: 0, rowData,
          rowMetadata: values.map(() => ({ pixelSize: 24, hiddenByUser: false })),
          columnMetadata: (values[0] ?? []).map(() => ({ pixelSize: 100, hiddenByUser: false })),
        }],
        merges: [],
        basicFilter: sheet.filterColumnCount === null ? undefined : {
          range: {
            sheetId, startRowIndex: 0, endRowIndex: values.length,
            startColumnIndex: 0, endColumnIndex: sheet.filterColumnCount,
          },
        },
        filterViews: [], bandedRanges: [], conditionalFormats: [], rowGroups: [], columnGroups: [],
      }
    },
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
