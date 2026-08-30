import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHEET_SCHEMAS } from '../src/sheetSchema'
import {
  applyWorkbookPresentation,
  createGoogleWorkbookPresentationGateway,
  inspectWorkbookPresentationMetadata,
  previewWorkbookPresentation,
  translateWorkbookPresentationPlan,
} from '../src/adapters/googleWorkbookPresentation'
import type { WorkbookPresentationWorkflowPort } from '../src/ports'
import {
  COLUMN_WIDTHS,
  KNOWN_HIDDEN_TAB_HEADERS,
  VISIBLE_TAB_ORDER,
  buildWorkbookPresentationPlan,
  verifyWorkbookPresentation,
  type GridRangeSnapshot,
  type SheetPresentationSnapshot,
  type WorkbookMetadataSnapshot,
  type WorkbookPresentationAction,
  type WorkbookPresentationPlan,
} from '../src/domain/workbookPresentation'

const HIDDEN_FIXTURES: ReadonlyArray<{ title: string; headers: readonly string[] }> = Object.entries(
  KNOWN_HIDDEN_TAB_HEADERS,
).map(([title, headers]) => ({
  title,
  headers: headers ?? ['Timestamp', 'Email'],
}))

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

describe('guarded Booking workbook presentation policy', () => {
  it('builds the exact deterministic visible, hidden, freeze, filter, width, format, and status plan', () => {
    const snapshot = canonicalSnapshot()
    const plan = buildPlan(snapshot)
    const replay = buildPlan(cloneSnapshot(snapshot))

    expect(plan.visibleOrder).toEqual([
      'DASHBOARD', 'BOOKING_MASTER', 'CALL_QUEUE', 'RECONCILIATION', 'RETENTION_QUEUE',
      'CONFIG_ADMINS', 'CONFIG_STAFF', 'CONFIG_DOCTORS', 'CONFIG_SERVICES',
      'CONFIG_CHANNELS', 'CONFIG_RULES',
    ])
    expect(plan).toEqual(replay)
    expect(new Set(plan.actions.map((action) => action.kind))).toEqual(new Set([
      'MOVE_SHEET', 'SET_HIDDEN', 'SET_FROZEN', 'SET_BASIC_FILTER',
      'SET_COLUMN_WIDTH', 'FORMAT_RANGE', 'ADD_STATUS_RULE',
    ]))
    expect(plan.actions.every((action) => [
      'MOVE_SHEET', 'SET_HIDDEN', 'SET_FROZEN', 'SET_BASIC_FILTER',
      'SET_COLUMN_WIDTH', 'FORMAT_RANGE', 'ADD_STATUS_RULE',
    ].includes(action.kind))).toBe(true)

    const hiddenIds = new Set(HIDDEN_FIXTURES.map(({ title }) => sheet(snapshot, title).sheetId))
    expect(HIDDEN_FIXTURES).toHaveLength(20)
    expect(plan.actions.filter((action) => action.kind === 'SET_HIDDEN')).toEqual(
      expect.arrayContaining([...hiddenIds].map((sheetId) => ({ kind: 'SET_HIDDEN', sheetId, hidden: true }))),
    )

    const frozen = plan.actions.filter((action) => action.kind === 'SET_FROZEN')
    expect(frozen).toContainEqual({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId, rows: 1, columns: 3,
    })
    expect(frozen).toContainEqual({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'CALL_QUEUE').sheetId, rows: 1, columns: 2,
    })

    const filters = plan.actions.filter((action) => action.kind === 'SET_BASIC_FILTER')
    expect(filters.map((action) => titleForId(snapshot, action.range.sheetId))).toEqual([
      'BOOKING_MASTER', 'CALL_QUEUE', 'RECONCILIATION', 'RETENTION_QUEUE',
    ])
    expect(filters).not.toContainEqual(expect.objectContaining({
      range: expect.objectContaining({ sheetId: sheet(snapshot, 'DASHBOARD').sheetId }),
    }))
    for (const action of filters) {
      const target = snapshot.sheets.find(({ sheetId }) => sheetId === action.range.sheetId)!
      expect(action.range).toEqual(fullGrid(target))
    }

    const widths = plan.actions.filter((action) => action.kind === 'SET_COLUMN_WIDTH')
    expect(widths).toContainEqual({
      kind: 'SET_COLUMN_WIDTH',
      sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId,
      columnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('driveFolderUrl'),
      pixelSize: 240,
    })
    expect(widths).toContainEqual({
      kind: 'SET_COLUMN_WIDTH',
      sheetId: sheet(snapshot, 'CALL_QUEUE').sheetId,
      columnIndex: SHEET_SCHEMAS.CALL_QUEUE!.indexOf('note'),
      pixelSize: 320,
    })
    expect(COLUMN_WIDTHS.DASHBOARD).toEqual([220, 140, 130, 120, 130, 130, 180, 145])

    const formats = plan.actions.filter((action) => action.kind === 'FORMAT_RANGE')
    expect(formats).toContainEqual(expect.objectContaining({
      range: expect.objectContaining({
        sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId,
        startColumnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('phoneNormalized'),
        endColumnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('phoneNormalized') + 1,
      }),
      styleKey: 'BODY_PLAIN_TEXT',
    }))
    expect(formats).toContainEqual(expect.objectContaining({
      range: expect.objectContaining({
        sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId,
        startColumnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('depositAmount'),
      }),
      styleKey: 'BODY_CURRENCY',
    }))
    expect(formats).toContainEqual(expect.objectContaining({
      range: expect.objectContaining({
        sheetId: sheet(snapshot, 'BOOKING_MASTER').sheetId,
        startColumnIndex: SHEET_SCHEMAS.BOOKING_MASTER!.indexOf('commissionEligibility'),
      }),
      styleKey: 'BODY',
    }))
    expect(formats).toContainEqual(expect.objectContaining({
      range: expect.objectContaining({
        sheetId: sheet(snapshot, 'RECONCILIATION').sheetId,
        startColumnIndex: SHEET_SCHEMAS.RECONCILIATION!.indexOf('candidateCaseIds'),
      }),
      styleKey: 'BODY_PLAIN_TEXT_WRAP',
    }))

    const statusRules = plan.actions.filter((action) => action.kind === 'ADD_STATUS_RULE')
    expect(statusRules.map((action) => action.ruleKey)).toEqual([
      'BOOKING_STATUS', 'APPOINTMENT_STATUS', 'CALL_STATUS',
      'RECONCILIATION_STATUS', 'RETENTION_STATUS',
    ])
    const dashboard = sheet(snapshot, 'DASHBOARD')
    expect(formats.filter((action) => action.range.sheetId === dashboard.sheetId)).toEqual([
      { kind: 'FORMAT_RANGE', range: gridRange(dashboard, 0, 1, 0, 2), styleKey: 'HEADER' },
      { kind: 'FORMAT_RANGE', range: gridRange(dashboard, 1, 10, 0, 2), styleKey: 'BODY' },
      { kind: 'FORMAT_RANGE', range: gridRange(dashboard, 12, 13, 0, 8), styleKey: 'HEADER' },
      { kind: 'FORMAT_RANGE', range: gridRange(dashboard, 13, dashboard.maxRows, 0, 8), styleKey: 'BODY' },
    ])

    expect(plan.actions).toContainEqual({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'MINI_APP_REQUESTS').sheetId, rows: 1, columns: 0,
    })
    expect(plan.actions).not.toContainEqual(expect.objectContaining({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'FORM_RESPONSES').sheetId,
    }))
    expect(plan.expectedPresentationFingerprint).toMatch(/^wp1-[0-9a-f]{64}$/)
  })

  it.each([
    ['unknown tab', (value: WorkbookMetadataSnapshot) => addSheet(value, 'UNKNOWN_TAB'), 'UNCLASSIFIED_TAB'],
    ['unknown prefixed tab', (value: WorkbookMetadataSnapshot) => addSheet(value, 'MINI_APP_UNKNOWN'), 'UNCLASSIFIED_TAB'],
    ['missing managed tab', (value: WorkbookMetadataSnapshot) => removeSheet(value, 'CALL_QUEUE'), 'MISSING_MANAGED_TAB'],
    ['duplicate title', (value: WorkbookMetadataSnapshot) => renameSheet(value, 'FORM_RESPONSES', 'DASHBOARD'), 'DUPLICATE_TAB_TITLE'],
    ['duplicate sheet id', (value: WorkbookMetadataSnapshot) => duplicateSheetId(value), 'DUPLICATE_SHEET_ID'],
    ['duplicate index', (value: WorkbookMetadataSnapshot) => duplicateIndex(value), 'DUPLICATE_SHEET_INDEX'],
    ['wrong header', (value: WorkbookMetadataSnapshot) => mutateHeader(value), 'HEADER_MISMATCH'],
    ['unexpected basic filter', (value: WorkbookMetadataSnapshot) => setUnexpectedFilter(value), 'UNEXPECTED_BASIC_FILTER'],
    ['filter view', (value: WorkbookMetadataSnapshot) => patchSheet(value, 'CALL_QUEUE', { filterViewCount: 1 }), 'UNEXPECTED_FILTER_VIEW'],
    ['merged cells', (value: WorkbookMetadataSnapshot) => patchSheet(value, 'CALL_QUEUE', { mergedRangeCount: 1 }), 'UNEXPECTED_MERGED_RANGE'],
    ['protected range', (value: WorkbookMetadataSnapshot) => patchSheet(value, 'CALL_QUEUE', { protectedRangeCount: 1 }), 'UNEXPECTED_PROTECTED_RANGE'],
    ['unsupported metadata', (value: WorkbookMetadataSnapshot) => patchSheet(value, 'CALL_QUEUE', { unsupportedMetadataCount: 1 }), 'UNSUPPORTED_PRESENTATION_METADATA'],
  ])('fails closed on %s before producing actions', (_label, mutate, errorCode) => {
    const snapshot = canonicalSnapshot()
    mutate(snapshot)
    expect(() => buildPlan(snapshot)).toThrow(errorCode)
  })

  it.each(HIDDEN_FIXTURES.filter(({ title }) => title !== 'FORM_RESPONSES'))(
    'rejects exact managed-header drift on hidden tab $title',
    ({ title }) => {
      const snapshot = canonicalSnapshot()
      const target = sheet(snapshot, title)
      target.headers = ['wrong', ...target.headers.slice(1)]
      expect(() => buildPlan(snapshot)).toThrow('HEADER_MISMATCH')
    },
  )

  it('rejects duplicate or overlapping managed format and status metadata', () => {
    const snapshot = canonicalSnapshot()
    const target = sheet(snapshot, 'CALL_QUEUE')
    target.managedFormats = [
      { range: columnBody(target, 0), styleKey: 'BODY_PLAIN_TEXT' },
      { range: { ...columnBody(target, 0), endColumnIndex: 2 }, styleKey: 'BODY' },
    ]
    expect(() => buildPlan(snapshot)).toThrow('PRESENTATION_METADATA_CONFLICT')

    const statusConflict = canonicalSnapshot()
    const callQueue = sheet(statusConflict, 'CALL_QUEUE')
    const statusColumn = SHEET_SCHEMAS.CALL_QUEUE!.indexOf('status')
    callQueue.statusRules = [
      { range: columnBody(callQueue, statusColumn), ruleKey: 'CALL_STATUS' },
      { range: columnBody(callQueue, statusColumn), ruleKey: 'CALL_STATUS' },
    ]
    expect(() => buildPlan(statusConflict)).toThrow('PRESENTATION_METADATA_CONFLICT')
  })

  it('verifies immutable content hashes and the exact planned presentation, then becomes idempotent', () => {
    const before = canonicalSnapshot()
    const plan = buildPlan(before)
    const after = applyPlanForTest(before, plan)

    expect(() => verifyWorkbookPresentation(before, after, plan, sha256Hex)).not.toThrow()
    expect(buildPlan(after).actions).toEqual([])
    expect(buildPlan(after).expectedPresentationFingerprint)
      .toBe(plan.expectedPresentationFingerprint)

    const changedValue = cloneSnapshot(after)
    sheet(changedValue, 'BOOKING_MASTER').valuesHash = 'changed-value-hash'
    expect(() => verifyWorkbookPresentation(before, changedValue, plan, sha256Hex)).toThrow('VALUES_HASH_CHANGED')

    const changedFormula = cloneSnapshot(after)
    sheet(changedFormula, 'BOOKING_MASTER').formulasHash = 'changed-formula-hash'
    expect(() => verifyWorkbookPresentation(before, changedFormula, plan, sha256Hex)).toThrow('FORMULAS_HASH_CHANGED')

    const changedValidation = cloneSnapshot(after)
    sheet(changedValidation, 'BOOKING_MASTER').validationsHash = 'changed-validation-hash'
    expect(() => verifyWorkbookPresentation(before, changedValidation, plan, sha256Hex)).toThrow('VALIDATIONS_HASH_CHANGED')

    const changedProtection = cloneSnapshot(after)
    sheet(changedProtection, 'BOOKING_MASTER').protectionsHash = 'changed-protection-hash'
    expect(() => verifyWorkbookPresentation(before, changedProtection, plan, sha256Hex)).toThrow('PROTECTIONS_HASH_CHANGED')
  })

  it('fails verification for an incomplete result or a forged/conflicting plan', () => {
    const before = canonicalSnapshot()
    const plan = buildPlan(before)
    const incomplete = cloneSnapshot(before)
    expect(() => verifyWorkbookPresentation(before, incomplete, plan, sha256Hex)).toThrow('PRESENTATION_FINGERPRINT_MISMATCH')

    const forged: WorkbookPresentationPlan = {
      ...plan,
      actions: [
        ...plan.actions,
        {
          kind: 'SET_COLUMN_WIDTH',
          sheetId: sheet(before, 'BOOKING_MASTER').sheetId,
          columnIndex: 0,
          pixelSize: 999,
        },
      ],
    }
    expect(() => verifyWorkbookPresentation(before, applyPlanForTest(before, plan), forged, sha256Hex))
      .toThrow('PRESENTATION_PLAN_CONFLICT')
  })

  it('requires a valid injected SHA-256 implementation and has no weak production fallback', () => {
    const snapshot = canonicalSnapshot()
    expect(() => (buildWorkbookPresentationPlan as unknown as (
      value: WorkbookMetadataSnapshot,
    ) => WorkbookPresentationPlan)(snapshot)).toThrow('PRESENTATION_SHA256_REQUIRED')
    expect(() => buildWorkbookPresentationPlan(snapshot, () => 'weak'))
      .toThrow('INVALID_PRESENTATION_SHA256')
  })

  it('deep-freezes exported policy and every returned action range without changing later plans', () => {
    const snapshot = canonicalSnapshot()
    const before = buildPlan(snapshot)
    const ranged = before.actions.find((action) => 'range' in action)
    expect(ranged && 'range' in ranged && Object.isFrozen(ranged.range)).toBe(true)
    expect(Object.isFrozen(before.actions)).toBe(true)
    expect(Object.isFrozen(COLUMN_WIDTHS)).toBe(true)
    expect(Object.isFrozen(COLUMN_WIDTHS.DASHBOARD)).toBe(true)
    expect(Object.isFrozen(COLUMN_WIDTHS.BOOKING_MASTER)).toBe(true)
    expect(Object.isFrozen(VISIBLE_TAB_ORDER)).toBe(true)
    expect(Object.isFrozen(KNOWN_HIDDEN_TAB_HEADERS)).toBe(true)
    expect(Object.isFrozen(KNOWN_HIDDEN_TAB_HEADERS.MINI_APP_REQUESTS)).toBe(true)

    expect(() => { (VISIBLE_TAB_ORDER as unknown as string[])[0] = 'MUTATED' }).toThrow()
    expect(() => { (COLUMN_WIDTHS.DASHBOARD as unknown as number[])[0] = 1 }).toThrow()
    expect(() => {
      (KNOWN_HIDDEN_TAB_HEADERS.MINI_APP_REQUESTS as unknown as string[])[0] = 'MUTATED'
    }).toThrow()
    expect(() => {
      if (ranged && 'range' in ranged) ranged.range.startRowIndex = 999
    }).toThrow()

    expect(buildPlan(cloneSnapshot(snapshot))).toEqual(before)
  })

  it('preserves the source-owned Form freeze while enforcing row one on every exact managed hidden table', () => {
    const snapshot = canonicalSnapshot()
    sheet(snapshot, 'FORM_RESPONSES').frozenRows = 2
    sheet(snapshot, 'FORM_RESPONSES').frozenColumns = 1
    const plan = buildPlan(snapshot)
    expect(plan.actions).not.toContainEqual(expect.objectContaining({
      kind: 'SET_FROZEN', sheetId: sheet(snapshot, 'FORM_RESPONSES').sheetId,
    }))
    for (const { title } of HIDDEN_FIXTURES.filter(({ title }) => title !== 'FORM_RESPONSES')) {
      expect(plan.actions).toContainEqual({
        kind: 'SET_FROZEN', sheetId: sheet(snapshot, title).sheetId, rows: 1, columns: 0,
      })
    }
  })
})

describe('Sheets-v4 Booking workbook presentation gateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('previews from one inspection without acquiring a lock, backing up, or mutating', () => {
    const fake = workflowFake(canonicalSnapshot())

    const result = previewWorkbookPresentation(fake.port)

    expect(result).toMatchObject({
      mutationCount: 0,
      plannedActionCount: expect.any(Number),
      sourceFingerprint: 'source-full-fingerprint',
    })
    expect(result.plannedActionCount).toBeGreaterThan(0)
    expect(fake.events).toEqual(['inspect'])
    expect(fake.backupCount()).toBe(0)
    expect(fake.batchCount()).toBe(0)
  })

  it('locks, backs up, re-inspects, sends one safe batch, verifies readback, and releases', () => {
    const fake = workflowFake(canonicalSnapshot())

    const result = applyWorkbookPresentation(fake.port)

    expect(result).toMatchObject({
      status: 'APPLIED',
      backupCreated: true,
      batchApplied: true,
      readbackVerified: true,
    })
    expect(fake.events).toEqual([
      'lock:wait', 'inspect', 'backup', 'inspect', 'batch', 'inspect', 'lock:release',
    ])
    expect(fake.backupCount()).toBe(1)
    expect(fake.batchCount()).toBe(1)
  })

  it('returns an idempotent no-op without a backup or batch and a second apply stays a no-op', () => {
    const fake = workflowFake(canonicalSnapshot())
    expect(applyWorkbookPresentation(fake.port).status).toBe('APPLIED')
    const eventsAfterFirst = fake.events.length

    const second = applyWorkbookPresentation(fake.port)

    expect(second).toEqual({
      status: 'NOOP',
      plannedActionCount: 0,
      backupCreated: false,
      batchApplied: false,
      readbackVerified: true,
    })
    expect(fake.events.slice(eventsAfterFirst)).toEqual(['lock:wait', 'inspect', 'lock:release'])
    expect(fake.backupCount()).toBe(1)
    expect(fake.batchCount()).toBe(1)
  })

  it('rejects a stale post-backup reinspection before the batch and releases the lock', () => {
    const fake = workflowFake(canonicalSnapshot(), { staleOnInspection: 2 })

    expect(() => applyWorkbookPresentation(fake.port)).toThrow('WORKBOOK_PRESENTATION_STALE')
    expect(fake.events).toEqual(['lock:wait', 'inspect', 'backup', 'inspect', 'lock:release'])
    expect(fake.backupCount()).toBe(1)
    expect(fake.batchCount()).toBe(0)
  })

  it.each(['backup', 'batch', 'readback'] as const)(
    'releases the lock and never retries a failed %s phase',
    (failurePhase) => {
      const fake = workflowFake(canonicalSnapshot(), { failurePhase })

      expect(() => applyWorkbookPresentation(fake.port)).toThrow()
      expect(fake.events[fake.events.length - 1]).toBe('lock:release')
      expect(fake.backupCount()).toBe(failurePhase === 'backup' ? 0 : 1)
      expect(fake.batchCount()).toBe(failurePhase === 'backup' ? 0 : 1)
      expect(fake.batchCount()).toBeLessThanOrEqual(1)
    },
  )

  it('translates the reviewed plan into an exact presentation-only request allowlist', () => {
    const plan = buildPlan(canonicalSnapshot())
    const batch = translateWorkbookPresentationPlan(plan)
    const allowed = new Set([
      'updateSheetProperties', 'setBasicFilter', 'updateDimensionProperties',
      'repeatCell', 'addConditionalFormatRule',
    ])

    expect(batch.requests.length).toBeGreaterThan(0)
    for (const request of batch.requests) {
      const keys = Object.keys(request)
      expect(keys).toHaveLength(1)
      expect(allowed.has(keys[0]!)).toBe(true)
    }
    const serialized = JSON.stringify(batch)
    for (const forbidden of [
      'delete', 'clear', 'dataValidation', 'protectedRange',
      'filterView', 'insertDimension', 'appendDimension', 'autoResizeDimensions',
      'addSheet', 'title',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    for (const request of batch.requests.filter((request) => 'repeatCell' in request)) {
      expect(Object.keys(request.repeatCell?.cell ?? {})).toEqual(['userEnteredFormat'])
      expect(request.repeatCell?.cell?.userEnteredValue).toBeUndefined()
      expect(request.repeatCell?.cell?.dataValidation).toBeUndefined()
      expect(request.repeatCell?.cell?.note).toBeUndefined()
    }
    expect(batch.requests.filter((request) => 'setBasicFilter' in request)).toHaveLength(4)
    expect(batch.requests.filter((request) => 'addConditionalFormatRule' in request)).toHaveLength(5)
  })

  it('rejects forged actions, styles, duplicate filters, and overlapping formats before translation', () => {
    const snapshot = canonicalSnapshot()
    const plan = buildPlan(snapshot)
    const booking = sheet(snapshot, 'BOOKING_MASTER')
    const filter = plan.actions.find((action) => action.kind === 'SET_BASIC_FILTER')!
    const format = plan.actions.find((action) => action.kind === 'FORMAT_RANGE'
      && action.range.sheetId === booking.sheetId)!

    const cases: WorkbookPresentationPlan[] = [
      { ...plan, actions: [...plan.actions, { kind: 'DELETE_SHEET', sheetId: booking.sheetId } as never] },
      { ...plan, actions: [...plan.actions, { ...format, styleKey: 'UNKNOWN_STYLE' } as never] },
      { ...plan, actions: [...plan.actions, filter] },
      {
        ...plan,
        actions: [...plan.actions, {
          kind: 'FORMAT_RANGE',
          range: { ...('range' in format ? format.range : fullGrid(booking)), endColumnIndex: 2 },
          styleKey: 'BODY',
        }],
      },
    ]

    for (const forged of cases) {
      expect(() => translateWorkbookPresentationPlan(forged)).toThrow()
    }
  })

  it('normalizes one Sheets-v4 response into structural metadata and hashes without returning cell values', () => {
    const source = canonicalSnapshot()
    const response = sheetsV4Response(source)
    const booking = response.sheets!.find((item) => item.properties?.title === 'BOOKING_MASTER')!
    const rowData = booking.data![0]!.rowData!
    rowData.push({
      values: [
        { userEnteredValue: { stringValue: 'private-customer-value' }, note: 'private-note' },
        { userEnteredValue: { formulaValue: '=1+1' } },
        { dataValidation: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'YES' }] } } },
      ],
    })

    const snapshot = inspectWorkbookPresentationMetadata(response, sha256Hex)
    const normalizedBooking = sheet(snapshot, 'BOOKING_MASTER')

    expect(normalizedBooking.headers).toEqual(SHEET_SCHEMAS.BOOKING_MASTER)
    expect(normalizedBooking.columnWidths).toEqual(Array(normalizedBooking.maxColumns).fill(100))
    expect(normalizedBooking.valuesHash).toMatch(/^[0-9a-f]{64}$/)
    expect(normalizedBooking.formulasHash).toMatch(/^[0-9a-f]{64}$/)
    expect(normalizedBooking.validationsHash).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(snapshot)).not.toContain('private-customer-value')
    expect(JSON.stringify(snapshot)).not.toContain('private-note')

    const changed = structuredClone(response)
    const changedBooking = changed.sheets!.find((item) => item.properties?.title === 'BOOKING_MASTER')!
    changedBooking.data![0]!.rowData![1]!.values![0]!.userEnteredValue = { stringValue: 'changed' }
    const changedSnapshot = inspectWorkbookPresentationMetadata(changed, sha256Hex)
    expect(sheet(changedSnapshot, 'BOOKING_MASTER').valuesHash).not.toBe(normalizedBooking.valuesHash)
    expect(changedSnapshot.fingerprint).not.toBe(snapshot.fingerprint)
  })

  it('fails closed on unsupported spreadsheet-level metadata before a plan can be built', () => {
    const response = sheetsV4Response(canonicalSnapshot())
    response.namedRanges = [{ name: 'private-operator-range' }]

    expect(() => inspectWorkbookPresentationMetadata(response, sha256Hex))
      .toThrow('UNSUPPORTED_PRESENTATION_METADATA')
  })

  it('recognizes only the exact adapter-owned cell style and actionable status rule', () => {
    const source = canonicalSnapshot()
    const booking = sheet(source, 'BOOKING_MASTER')
    booking.maxRows = 14
    booking.columnWidths = Array(booking.maxColumns).fill(100)
    const response = sheetsV4Response(source)
    const raw = response.sheets!.find((item) => item.properties?.title === 'BOOKING_MASTER')!
    raw.data![0]!.rowData = formattedBookingRows(booking)
    raw.conditionalFormats = [bookingStatusRule(booking)]

    const inspected = inspectWorkbookPresentationMetadata(response, sha256Hex)
    const result = sheet(inspected, 'BOOKING_MASTER')

    expect(result.managedFormats).toHaveLength(booking.headers.length + 1)
    expect(result.statusRules).toContainEqual({
      range: columnBody(booking, booking.headers.indexOf('status')),
      ruleKey: 'BOOKING_STATUS',
    })
    expect(result.unsupportedMetadataCount).toBe(0)

    const colorStyled = structuredClone(response)
    const colorStyledRule = colorStyled.sheets!
      .find((item) => item.properties?.title === 'BOOKING_MASTER')!
      .conditionalFormats![0]!
    colorStyledRule.booleanRule!.format!.backgroundColorStyle = {
      rgbColor: colorStyledRule.booleanRule!.format!.backgroundColor,
    }
    delete colorStyledRule.booleanRule!.format!.backgroundColor
    colorStyledRule.booleanRule!.format!.textFormat!.foregroundColorStyle = {
      rgbColor: colorStyledRule.booleanRule!.format!.textFormat!.foregroundColor,
    }
    delete colorStyledRule.booleanRule!.format!.textFormat!.foregroundColor
    expect(sheet(
      inspectWorkbookPresentationMetadata(colorStyled, sha256Hex),
      'BOOKING_MASTER',
    ).statusRules).toContainEqual({
      range: columnBody(booking, booking.headers.indexOf('status')),
      ruleKey: 'BOOKING_STATUS',
    })

    const altered = structuredClone(response)
    const alteredBooking = altered.sheets!.find((item) => item.properties?.title === 'BOOKING_MASTER')!
    alteredBooking.conditionalFormats![0]!.booleanRule!.condition!.type = 'TEXT_EQ'
    const alteredResult = sheet(inspectWorkbookPresentationMetadata(altered, sha256Hex), 'BOOKING_MASTER')
    expect(alteredResult.statusRules).toEqual([])
    expect(alteredResult.unsupportedMetadataCount).toBe(1)
  })

  it('uses one Sheets batchUpdate and a bounded document lock in the production adapter', () => {
    const batchUpdate = vi.fn()
    const waitLock = vi.fn()
    const releaseLock = vi.fn()
    vi.stubGlobal('Sheets', { Spreadsheets: { batchUpdate, get: vi.fn() } })
    vi.stubGlobal('LockService', { getDocumentLock: () => ({ waitLock, releaseLock }) })
    const gateway = createGoogleWorkbookPresentationGateway({
      spreadsheetId: 'spreadsheet-test-id',
      backupFolderId: 'backup-folder-test-id',
      sha256Hex,
      lockTimeoutMs: 12_345,
    })
    const plan = buildPlan(canonicalSnapshot())

    gateway.withDocumentLock(() => gateway.apply(plan))

    expect(waitLock).toHaveBeenCalledOnce()
    expect(waitLock).toHaveBeenCalledWith(12_345)
    expect(releaseLock).toHaveBeenCalledOnce()
    expect(batchUpdate).toHaveBeenCalledOnce()
    expect(batchUpdate).toHaveBeenCalledWith(translateWorkbookPresentationPlan(plan), 'spreadsheet-test-id')
  })

  it('creates and verifies a private native copy in the exact private backup folder', () => {
    const setSharing = vi.fn()
    const backup = {
      getId: () => 'backup-file-test-id',
      getUrl: () => 'https://example.invalid/private-backup',
      getMimeType: () => 'application/vnd.google-apps.spreadsheet',
      getSharingAccess: () => 'PRIVATE',
      setSharing,
      getParents: () => parentIterator(['backup-folder-test-id']),
    }
    const makeCopy = vi.fn(() => backup)
    vi.stubGlobal('DriveApp', {
      Access: { PRIVATE: 'PRIVATE' },
      Permission: { NONE: 'NONE' },
      getFolderById: () => ({ getSharingAccess: () => 'PRIVATE' }),
      getFileById: () => ({ makeCopy }),
    })
    const gateway = createGoogleWorkbookPresentationGateway({
      spreadsheetId: 'spreadsheet-test-id',
      backupFolderId: 'backup-folder-test-id',
      sha256Hex,
    })

    expect(gateway.createPrivateNativeBackup('PMC Booking Presentation Backup')).toEqual({
      fileId: 'backup-file-test-id',
      url: 'https://example.invalid/private-backup',
    })
    expect(makeCopy).toHaveBeenCalledOnce()
    expect(setSharing).toHaveBeenCalledWith('PRIVATE', 'NONE')
  })
})

function canonicalSnapshot(): WorkbookMetadataSnapshot {
  const visible = VISIBLE_TAB_ORDER.map((title) => ({
    title,
    headers: title === 'DASHBOARD' ? ['KPI', 'Value'] : SHEET_SCHEMAS[title]!,
  }))
  const definitions = [...HIDDEN_FIXTURES, ...visible]
  return {
    spreadsheetId: 'spreadsheet-test-id',
    fingerprint: 'source-full-fingerprint',
    sheets: definitions.map(({ title, headers }, index) => makeSheet(title, headers, index)),
  }
}

function makeSheet(title: string, headers: readonly string[], index: number): SheetPresentationSnapshot {
  const maxColumns = Math.max(title === 'DASHBOARD' ? 8 : headers.length, 1)
  return {
    sheetId: 100 + index,
    title,
    index,
    hidden: false,
    maxRows: 1_000,
    maxColumns,
    frozenRows: 0,
    frozenColumns: 0,
    headers: [...headers],
    basicFilter: null,
    filterViewCount: 0,
    mergedRangeCount: 0,
    protectedRangeCount: 0,
    unsupportedMetadataCount: 0,
    columnWidths: Array(maxColumns).fill(100),
    managedFormats: [],
    statusRules: [],
    valuesHash: `values-${index}`,
    formulasHash: `formulas-${index}`,
    validationsHash: `validations-${index}`,
    protectionsHash: `protections-${index}`,
  }
}

function sheet(snapshot: WorkbookMetadataSnapshot, title: string): SheetPresentationSnapshot {
  const found = snapshot.sheets.find((candidate) => candidate.title === title)
  if (!found) throw new Error(`test fixture missing ${title}`)
  return found as SheetPresentationSnapshot
}

function titleForId(snapshot: WorkbookMetadataSnapshot, sheetId: number): string {
  return snapshot.sheets.find((sheet) => sheet.sheetId === sheetId)?.title ?? 'missing'
}

function fullGrid(target: SheetPresentationSnapshot): GridRangeSnapshot {
  return {
    sheetId: target.sheetId,
    startRowIndex: 0,
    endRowIndex: target.maxRows,
    startColumnIndex: 0,
    endColumnIndex: target.headers.length,
  }
}

function gridRange(
  target: SheetPresentationSnapshot,
  startRowIndex: number,
  endRowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number,
): GridRangeSnapshot {
  return { sheetId: target.sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }
}

function columnBody(target: SheetPresentationSnapshot, columnIndex: number): GridRangeSnapshot {
  return {
    sheetId: target.sheetId,
    startRowIndex: 1,
    endRowIndex: target.maxRows,
    startColumnIndex: columnIndex,
    endColumnIndex: columnIndex + 1,
  }
}

function cloneSnapshot(snapshot: WorkbookMetadataSnapshot): WorkbookMetadataSnapshot {
  return structuredClone(snapshot)
}

function addSheet(snapshot: WorkbookMetadataSnapshot, title: string): void {
  ;(snapshot.sheets as SheetPresentationSnapshot[]).push(makeSheet(title, ['id'], snapshot.sheets.length))
}

function removeSheet(snapshot: WorkbookMetadataSnapshot, title: string): void {
  const index = snapshot.sheets.findIndex((candidate) => candidate.title === title)
  ;(snapshot.sheets as SheetPresentationSnapshot[]).splice(index, 1)
  snapshot.sheets.forEach((candidate, nextIndex) => { (candidate as SheetPresentationSnapshot).index = nextIndex })
}

function renameSheet(snapshot: WorkbookMetadataSnapshot, title: string, nextTitle: string): void {
  sheet(snapshot, title).title = nextTitle
}

function duplicateSheetId(snapshot: WorkbookMetadataSnapshot): void {
  snapshot.sheets[1]!.sheetId = snapshot.sheets[0]!.sheetId
}

function duplicateIndex(snapshot: WorkbookMetadataSnapshot): void {
  snapshot.sheets[1]!.index = snapshot.sheets[0]!.index
}

function mutateHeader(snapshot: WorkbookMetadataSnapshot): void {
  const target = sheet(snapshot, 'BOOKING_MASTER')
  target.headers = ['wrong', ...target.headers.slice(1)]
}

function setUnexpectedFilter(snapshot: WorkbookMetadataSnapshot): void {
  const target = sheet(snapshot, 'BOOKING_MASTER')
  target.basicFilter = { ...fullGrid(target), endColumnIndex: target.headers.length - 1 }
}

function patchSheet(
  snapshot: WorkbookMetadataSnapshot,
  title: string,
  patch: Partial<SheetPresentationSnapshot>,
): void {
  Object.assign(sheet(snapshot, title), patch)
}

function applyPlanForTest(
  source: WorkbookMetadataSnapshot,
  plan: WorkbookPresentationPlan,
): WorkbookMetadataSnapshot {
  const after = cloneSnapshot(source)
  const mutable = after.sheets as SheetPresentationSnapshot[]
  for (const action of plan.actions) applyAction(mutable, action)
  after.fingerprint = 'after-full-fingerprint'
  return after
}

function applyAction(sheets: SheetPresentationSnapshot[], action: WorkbookPresentationAction): void {
  const targetSheetId = 'sheetId' in action ? action.sheetId : action.range.sheetId
  const target = sheets.find((sheet) => sheet.sheetId === targetSheetId)
  if (!target && action.kind !== 'SET_BASIC_FILTER' && action.kind !== 'FORMAT_RANGE' && action.kind !== 'ADD_STATUS_RULE') {
    throw new Error('bad test plan')
  }
  switch (action.kind) {
    case 'MOVE_SHEET': {
      const current = sheets.findIndex((sheet) => sheet.sheetId === action.sheetId)
      const [moved] = sheets.splice(current, 1)
      sheets.splice(action.targetIndex, 0, moved!)
      sheets.forEach((sheet, index) => { sheet.index = index })
      return
    }
    case 'SET_HIDDEN':
      target!.hidden = action.hidden
      return
    case 'SET_FROZEN':
      target!.frozenRows = action.rows
      target!.frozenColumns = action.columns
      return
    case 'SET_BASIC_FILTER':
      sheetByRange(sheets, action.range).basicFilter = structuredClone(action.range)
      return
    case 'SET_COLUMN_WIDTH':
      ;(target!.columnWidths as number[])[action.columnIndex] = action.pixelSize
      return
    case 'FORMAT_RANGE': {
      const ranged = sheetByRange(sheets, action.range)
      ranged.managedFormats = replaceRange(ranged.managedFormats, action.range, { ...action })
      return
    }
    case 'ADD_STATUS_RULE': {
      const ranged = sheetByRange(sheets, action.range)
      ranged.statusRules = [...ranged.statusRules, { range: structuredClone(action.range), ruleKey: action.ruleKey }]
    }
  }
}

function sheetByRange(sheets: SheetPresentationSnapshot[], range: GridRangeSnapshot): SheetPresentationSnapshot {
  const target = sheets.find((sheet) => sheet.sheetId === range.sheetId)
  if (!target) throw new Error('bad test range')
  return target
}

function replaceRange<T extends { range: GridRangeSnapshot }>(
  items: readonly T[],
  range: GridRangeSnapshot,
  replacement: T,
): T[] {
  return [...items.filter((item) => JSON.stringify(item.range) !== JSON.stringify(range)), replacement]
}

function buildPlan(snapshot: WorkbookMetadataSnapshot): WorkbookPresentationPlan {
  return buildWorkbookPresentationPlan(snapshot, sha256Hex)
}

function workflowFake(
  initial: WorkbookMetadataSnapshot,
  options: {
    staleOnInspection?: number
    failurePhase?: 'backup' | 'batch' | 'readback'
  } = {},
): {
  port: WorkbookPresentationWorkflowPort
  events: string[]
  backupCount(): number
  batchCount(): number
} {
  let current = cloneSnapshot(initial)
  let inspections = 0
  let backups = 0
  let batches = 0
  const events: string[] = []
  const port: WorkbookPresentationWorkflowPort = {
    sha256Hex,
    backupLabel: 'PMC Booking Presentation Backup',
    withDocumentLock<T>(operation: () => T): T {
      events.push('lock:wait')
      try {
        return operation()
      } finally {
        events.push('lock:release')
      }
    },
    gateway: {
      inspect() {
        events.push('inspect')
        inspections += 1
        const result = cloneSnapshot(current)
        if (options.staleOnInspection === inspections) result.fingerprint = 'stale-full-fingerprint'
        if (options.failurePhase === 'readback' && inspections === 3) {
          sheet(result, 'BOOKING_MASTER').valuesHash = 'changed-after-write'
        }
        return result
      },
      createPrivateNativeBackup() {
        events.push('backup')
        if (options.failurePhase === 'backup') throw new Error('WORKBOOK_PRESENTATION_BACKUP_FAILED')
        backups += 1
        return { fileId: 'private-backup-id', url: 'https://example.invalid/private-backup' }
      },
      apply(plan) {
        events.push('batch')
        batches += 1
        if (options.failurePhase === 'batch') throw new Error('WORKBOOK_PRESENTATION_BATCH_FAILED')
        current = applyPlanForTest(current, plan)
      },
    },
  }
  return {
    port,
    events,
    backupCount: () => backups,
    batchCount: () => batches,
  }
}

function sheetsV4Response(
  source: WorkbookMetadataSnapshot,
): GoogleAppsScript.Sheets.Schema.Spreadsheet {
  return {
    spreadsheetId: source.spreadsheetId,
    sheets: source.sheets.map((item) => ({
      properties: {
        sheetId: item.sheetId,
        title: item.title,
        index: item.index,
        hidden: item.hidden,
        sheetType: 'GRID',
        gridProperties: {
          rowCount: item.maxRows,
          columnCount: item.maxColumns,
          frozenRowCount: item.frozenRows,
          frozenColumnCount: item.frozenColumns,
        },
      },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: [{
          values: item.headers.map((header) => ({ userEnteredValue: { stringValue: header } })),
        }],
        rowMetadata: Array(item.maxRows).fill(null).map(() => ({})),
        columnMetadata: item.columnWidths.map((pixelSize) => ({ pixelSize })),
      }],
      merges: [],
      filterViews: [],
      bandedRanges: [],
      conditionalFormats: [],
      protectedRanges: [],
      charts: [],
      tables: [],
      developerMetadata: [],
      rowGroups: [],
      columnGroups: [],
      basicFilter: item.basicFilter ? { range: structuredClone(item.basicFilter) } : undefined,
    })),
  }
}

function formattedBookingRows(
  target: SheetPresentationSnapshot,
): GoogleAppsScript.Sheets.Schema.RowData[] {
  return Array.from({ length: target.maxRows }, (_, rowIndex) => ({
    values: target.headers.map((header) => ({
      userEnteredValue: rowIndex === 0 ? { stringValue: header } : undefined,
      userEnteredFormat: testManagedStyle(rowIndex === 0 ? 'HEADER' : testBodyStyle(header)),
    })),
  }))
}

function testBodyStyle(header: string):
  'BODY' | 'BODY_PLAIN_TEXT' | 'BODY_CURRENCY' | 'BODY_WRAP' | 'BODY_PLAIN_TEXT_WRAP' {
  const normalized = header.toLowerCase()
  const plain = normalized === 'id' || normalized.endsWith('id') || normalized.endsWith('ids')
    || normalized.includes('hash') || normalized.includes('phone') || normalized.includes('url')
    || normalized.endsWith('json')
  const currency = ['depositAmount', 'jeraActualRevenue', 'commissionAmount'].includes(header)
  const wrap = ['note', 'candidateCaseIds', 'reasonCode', 'reason'].includes(header)
  if (plain && wrap) return 'BODY_PLAIN_TEXT_WRAP'
  if (plain) return 'BODY_PLAIN_TEXT'
  if (currency) return 'BODY_CURRENCY'
  if (wrap) return 'BODY_WRAP'
  return 'BODY'
}

function testManagedStyle(
  styleKey: 'HEADER' | 'BODY' | 'BODY_PLAIN_TEXT' | 'BODY_CURRENCY' | 'BODY_WRAP' | 'BODY_PLAIN_TEXT_WRAP',
): GoogleAppsScript.Sheets.Schema.CellFormat {
  const header = styleKey === 'HEADER'
  const plain = styleKey === 'BODY_PLAIN_TEXT' || styleKey === 'BODY_PLAIN_TEXT_WRAP'
  const currency = styleKey === 'BODY_CURRENCY'
  const wrap = styleKey === 'BODY_WRAP' || styleKey === 'BODY_PLAIN_TEXT_WRAP'
  return {
    backgroundColor: header
      ? { red: 0.9568627451, green: 0.9607843137, blue: 0.9647058824 }
      : { red: 1, green: 1, blue: 1 },
    textFormat: {
      bold: header,
      foregroundColor: { red: 0.0666666667, green: 0.0666666667, blue: 0.0666666667 },
    },
    verticalAlignment: 'MIDDLE',
    wrapStrategy: wrap || header ? 'WRAP' : 'CLIP',
    borders: {
      top: testBorder(), bottom: testBorder(), left: testBorder(), right: testBorder(),
    },
    numberFormat: plain
      ? { type: 'TEXT', pattern: '@' }
      : currency ? { type: 'NUMBER', pattern: '฿#,##0.00' } : undefined,
  }
}

function testBorder(): GoogleAppsScript.Sheets.Schema.Border {
  return {
    style: 'SOLID',
    color: { red: 0.8980392157, green: 0.9058823529, blue: 0.9215686275 },
  }
}

function bookingStatusRule(
  target: SheetPresentationSnapshot,
): GoogleAppsScript.Sheets.Schema.ConditionalFormatRule {
  const statusIndex = target.headers.indexOf('status')
  return {
    ranges: [columnBody(target, statusIndex)],
    booleanRule: {
      condition: {
        type: 'CUSTOM_FORMULA',
        values: [{
          userEnteredValue: '=OR($C2="VALIDATION_ERROR",$C2="TIME_CONFLICT",$C2="CALL_OVERDUE",$C2="RECONCILIATION")',
        }],
      },
      format: {
        backgroundColor: { red: 0.9960784314, green: 0.9529411765, blue: 0.7803921569 },
        textFormat: {
          bold: true,
          foregroundColor: { red: 0.5725490196, green: 0.2509803922, blue: 0.0549019608 },
        },
      },
    },
  }
}

function parentIterator(ids: readonly string[]): GoogleAppsScript.Drive.FolderIterator {
  let index = 0
  return {
    getContinuationToken: () => '',
    hasNext: () => index < ids.length,
    next: () => ({ getId: () => ids[index++] }) as GoogleAppsScript.Drive.Folder,
  }
}
