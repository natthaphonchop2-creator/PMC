# PMC Booking Google Sheet UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PMC Booking Operations` readable for daily operators while preserving exact managed schemas, values, formulas, validations, protections, raw/cache data, and source-of-truth behavior.

**Architecture:** Fix the stale Dashboard H-column defect first. Add a pure presentation-policy planner and a narrow Apps Script/Sheets-v4 gateway that can preview, privately back up, atomically apply, and verify tab order/visibility/freeze/filter/width/format metadata without changing workbook values.

**Tech Stack:** TypeScript 6, Apps Script V8, SpreadsheetApp, Sheets Advanced Service v4, DriveApp, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-pmc-booking-speed-attribution-sheet-ux-design.md`

## Global Constraints

- `BOOKING_MASTER` remains canonical; Dashboard is derived.
- Do not rename/delete tabs, move managed columns, insert title rows, clear data, or change formulas/validations/protections.
- Hiding/reordering is presentation only and is not an access-control claim.
- Unknown tabs, headers, filters, filter views, merges, or protections fail before backup/write unless explicitly allowed here.
- Do not apply workbook-wide autofit or heavy raw/cache conditional formatting.
- Apply only white cells, black text, light-gray headers, subtle borders, targeted widths, bounded status rules, filters, and freezes.
- A new private native backup is mandatory immediately before apply; dry run creates no backup and performs no write.
- Live apply requires separate owner approval after reviewed dry-run digest and a maintenance window.
- No live values, PII, Sheet/Drive IDs, or secret values appear in logs/reports.

## Execution Prerequisite and Program Order

Run this plan after the Attribution V2 and Save/Confirm Performance plans have completed their local gates. Before Task 1:

```bash
test "$(git log -1 --pretty=%s)" = "test: measure Booking Save and Confirm performance"
PROGRAM_BASE="$(git rev-parse HEAD)"
test -n "$PROGRAM_BASE"
test -z "$(git status --porcelain)"
```

Do not execute plans concurrently: attribution and performance change shared Mini App contracts/routes, while attribution and Sheet UX both change Apps Script runtime/entrypoints/schema-adjacent code.

---

## File Structure

```text
apps/pmc-google-booking-ops/src/
  domain/workbookPresentation.ts          pure policy/preflight/verification
  adapters/googleWorkbookPresentation.ts  Sheets-v4 metadata, backup, batch apply, readback
  adapters/googleSheets.ts                Dashboard stale-H fix only
  runtime.ts                               dry-run/apply workflows
  entrypoints.ts                           owner-callable functions
  ports.ts                                 presentation gateway port

apps/pmc-google-booking-ops/tests/
  googleSheetsDashboard.test.ts
  workbookPresentation.test.ts
```

---

### Task 1: Clear all stale Dashboard operation cells

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts`
- Create: `apps/pmc-google-booking-ops/tests/googleSheetsDashboard.test.ts`

**Interfaces:**
- Keeps existing `DashboardPort.write(snapshot)` contract.
- Changes only the cleared range calculation.

- [ ] **Step 1: Write failing >1,000-row stale-H test**

```ts
it('clears every prior A:H operation cell before a shorter refresh', () => {
  const sheet = dashboardSheet({ lastRow: 1_025, staleHRow: 1_025 })
  createGoogleDashboardPort(spreadsheet(sheet)).write({ kpis: zeroKpis(), operations: [] })
  expect(sheet.clearedRanges()).toContain('A1:H1025')
  expect(sheet.valueAt(1025, 8)).toBe('')
})
```

Also cover new snapshot extent greater than prior last row and unchanged KPI/operation header positions.

- [ ] **Step 2: Run RED test**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/googleSheetsDashboard.test.ts
```

Expected: FAIL because current code clears only `A1:G1000`.

- [ ] **Step 3: Implement dynamic H clear extent**

```ts
const startRow = Object.keys(snapshot.kpis).length + 4
const requiredLastRow = startRow + snapshot.operations.length
const clearEndRow = Math.max(1_000, sheet.getLastRow(), requiredLastRow)
sheet.getRange(1, 1, clearEndRow, 8).clearContent()
```

Retain KPI and operation writes unchanged.

- [ ] **Step 4: Run GREEN and dashboard regression suites**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/googleSheetsDashboard.test.ts \
  apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts
npm run booking:typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pmc-google-booking-ops/src/adapters/googleSheets.ts \
  apps/pmc-google-booking-ops/tests/googleSheetsDashboard.test.ts
git commit -m "fix: clear stale Dashboard operation column"
```

---

### Task 2: Pure guarded workbook-presentation policy

**Files:**
- Create: `apps/pmc-google-booking-ops/src/domain/workbookPresentation.ts`
- Create: `apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts`

**Interfaces:**
- Produces: `buildWorkbookPresentationPlan(snapshot): WorkbookPresentationPlan`.
- Produces: `verifyWorkbookPresentation(before, after, plan): void`.

- [ ] **Step 1: Write failing policy/precondition tests**

```ts
expect(buildWorkbookPresentationPlan(canonicalSnapshot()).visibleOrder).toEqual([
  'DASHBOARD', 'BOOKING_MASTER', 'CALL_QUEUE', 'RECONCILIATION', 'RETENTION_QUEUE',
  'CONFIG_ADMINS', 'CONFIG_STAFF', 'CONFIG_DOCTORS', 'CONFIG_SERVICES',
  'CONFIG_CHANNELS', 'CONFIG_RULES',
])
expect(() => buildWorkbookPresentationPlan(snapshotWithTab('UNKNOWN_TAB')))
  .toThrow('UNCLASSIFIED_TAB')
```

Add tests for exact headers, unexpected basic filter/filter view, merged cells, protected ranges, hidden classifier, frozen panes, filters only on four operator grids, plain-text/currency formats, width maps, status rules, no Dashboard filter, and unchanged value/formula/validation/protection hashes.

- [ ] **Step 2: Run RED policy tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts
```

Expected: FAIL because policy module does not exist.

- [ ] **Step 3: Implement exact immutable policy**

```ts
export interface WorkbookMetadataSnapshot {
  spreadsheetId: string
  sheets: readonly SheetPresentationSnapshot[]
  fingerprint: string
}

export interface GridRangeSnapshot {
  sheetId: number
  startRowIndex: number
  endRowIndex: number
  startColumnIndex: number
  endColumnIndex: number
}

export type WorkbookPresentationAction =
  | { kind: 'MOVE_SHEET'; sheetId: number; targetIndex: number }
  | { kind: 'SET_HIDDEN'; sheetId: number; hidden: boolean }
  | { kind: 'SET_FROZEN'; sheetId: number; rows: number; columns: number }
  | { kind: 'SET_BASIC_FILTER'; range: GridRangeSnapshot }
  | { kind: 'SET_COLUMN_WIDTH'; sheetId: number; columnIndex: number; pixelSize: number }
  | { kind: 'FORMAT_RANGE'; range: GridRangeSnapshot; styleKey: string }
  | { kind: 'ADD_STATUS_RULE'; range: GridRangeSnapshot; ruleKey: string }

export interface WorkbookPresentationPlan {
  sourceFingerprint: string
  visibleOrder: readonly string[]
  actions: readonly WorkbookPresentationAction[]
  expectedPresentationFingerprint: string
}

export interface SheetPresentationSnapshot {
  sheetId: number
  title: string
  index: number
  hidden: boolean
  maxRows: number
  maxColumns: number
  frozenRows: number
  frozenColumns: number
  headers: readonly string[]
  basicFilter: GridRangeSnapshot | null
  filterViewCount: number
  mergedRangeCount: number
  protectedRangeCount: number
  valuesHash: string
  formulasHash: string
  validationsHash: string
  protectionsHash: string
}
```

Explicit policy:

- visible order exactly as the Step 1 test;
- known raw/import/retry/audit/nonce/sequence/Mini-App/JERA-cache/sync/payment/allocation/Stock tabs hidden;
- unknown tabs fail closed;
- row 1 frozen on managed data/config tabs; A:C frozen on `BOOKING_MASTER`, A:B on `CALL_QUEUE`;
- basic filter on full grid only for `BOOKING_MASTER`, `CALL_QUEUE`, `RECONCILIATION`, `RETENTION_QUEUE`;
- status rules only on Booking/appointment, call, reconciliation, retention status columns;
- IDs/hashes/phones/URLs/JSON plain text; deposit/revenue/commission currency;
- no workbook-wide autofit.

Exact width/wrap policy keyed by header:

```ts
export const COLUMN_WIDTHS = {
  DASHBOARD: [220, 140, 130, 120, 130, 130, 180, 145],
  BOOKING_MASTER: {
    caseId: 150, formResponseId: 160, status: 135, recorderName: 135,
    adminName: 135, aeName: 135, submitterEmail: 220, customerName: 180,
    facebookName: 180, phoneNormalized: 120, phoneMasked: 120,
    appointmentStart: 165, appointmentEnd: 165, depositAmount: 120,
    driveFolderUrl: 240, createdAt: 165, updatedAt: 165,
  },
  CALL_QUEUE: {
    taskId: 150, caseId: 150, ownerAdminId: 135, status: 115,
    windowStart: 165, windowEnd: 165, nextCallAt: 165, lastReminderDate: 165,
    result: 150, note: 320,
  },
  RECONCILIATION: {
    id: 150, source: 140, sourceId: 150, reasonCode: 140,
    candidateCaseIds: 300, status: 115, resolvedCaseId: 150, resolvedAt: 165,
  },
  RETENTION_QUEUE: {
    id: 150, caseId: 150, eligibleAt: 165, status: 115,
    approvedBy: 140, approvedAt: 165, reason: 300,
  },
  CONFIG_DEFAULTS: { id: 140, name: 160, email: 220, url: 260, boolean: 105, timestamp: 165 },
} as const

export const WRAPPED_HEADERS = new Set([
  'note', 'candidateCaseIds', 'reasonCode', 'reason',
])
```

- [ ] **Step 4: Run GREEN policy tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts
npm run booking:typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pmc-google-booking-ops/src/domain/workbookPresentation.ts \
  apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts
git commit -m "feat: define guarded Booking workbook presentation"
```

---

### Task 3: Apps Script Sheets-v4 gateway, backup, apply, and readback

**Files:**
- Create: `apps/pmc-google-booking-ops/src/adapters/googleWorkbookPresentation.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/appsscript.json`
- Modify: `apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts`

**Interfaces:**
- Produces: `WorkbookPresentationGateway.inspect/createPrivateNativeBackup/apply`.
- Uses Sheets Advanced Service v4 for filter-view/basic-filter metadata and batch updates.

- [ ] **Step 1: Write failing gateway workflow tests**

```ts
expect(previewWorkbookPresentation(gateway).mutationCount).toBe(0)
expect(gateway.backups()).toHaveLength(0)

const applied = applyWorkbookPresentation(gateway)
expect(applied).toMatchObject({ backupCreated: true, readbackVerified: true })
expect(gateway.batchUpdateCalls()).toHaveLength(1)
```

Cover dry-run no mutation, private backup before apply, second fingerprint equality, lock release on failure, one safe batch, no delete/clear/value/validation/protection/filter-view mutations, readback hash mismatch safe failure, and idempotent second apply.

- [ ] **Step 2: Run RED gateway tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts
```

Expected: FAIL because gateway/workflows do not exist.

- [ ] **Step 3: Implement narrow port and Sheets-v4 adapter**

```ts
export interface WorkbookPresentationGateway {
  inspect(): WorkbookMetadataSnapshot
  createPrivateNativeBackup(label: string): { fileId: string; url: string }
  apply(plan: WorkbookPresentationPlan): void
}
```

Add to `appsscript.json`:

```json
{
  "userSymbol": "Sheets",
  "serviceId": "sheets",
  "version": "v4"
}
```

Apply under a bounded document lock: inspect → pure preflight → private native copy → inspect same fingerprint → one `Sheets.Spreadsheets.batchUpdate` → inspect/verify. Error output contains tab names/hash labels only.

- [ ] **Step 4: Run GREEN, manifest, and build tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: PASS and bundled manifest contains Calendar and Sheets advanced services.

- [ ] **Step 5: Commit**

```bash
git add apps/pmc-google-booking-ops/src/adapters/googleWorkbookPresentation.ts \
  apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/appsscript.json \
  apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts
git commit -m "feat: apply Booking workbook presentation safely"
```

---

### Task 4: Owner-only preview/apply entrypoints and live runbook

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Modify: `apps/pmc-google-booking-ops/tests/build.test.ts`
- Modify: `apps/pmc-google-booking-ops/docs/pilot-runbook.md`

**Interfaces:**
- Produces: `previewPmcBookingWorkbookPresentation()` dry-run only.
- Produces: `applyPmcBookingWorkbookPresentation()` explicit owner action only.

- [ ] **Step 1: Write failing export and owner-gate tests**

```ts
expect(bundled.previewPmcBookingWorkbookPresentation).toBeTypeOf('function')
expect(bundled.applyPmcBookingWorkbookPresentation).toBeTypeOf('function')
expect(projectTriggers()).not.toContain('applyPmcBookingWorkbookPresentation')
```

Test preview returns digest/planned metadata without backup/write; apply repeats preflight, creates backup, applies, and returns backup reference plus verification metadata only.

- [ ] **Step 2: Run RED export/workflow tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
```

Expected: FAIL because entrypoints/exports do not exist.

- [ ] **Step 3: Implement entrypoints and exact runbook gate**

Runbook preconditions:

1. queue paused/empty and no active schema migration;
2. reviewed dry-run digest with no unclassified/precondition failures;
3. owner accepts tab hiding as presentation only;
4. apply creates a new private native backup;
5. readback plus 1280×720/100% zoom screenshots for Dashboard, Booking, Call, Reconciliation;
6. queue resumes only after metadata/value-hash verification.

- [ ] **Step 4: Run complete Sheet-plan local gate**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/googleSheetsDashboard.test.ts \
  apps/pmc-google-booking-ops/tests/workbookPresentation.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
npm run booking:typecheck
npm run booking:test
npm run booking:build
npm run lint
git diff --check
```

Expected: all pass with zero lint errors.

- [ ] **Step 5: Commit**

```bash
git add apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/scripts/build.mjs \
  apps/pmc-google-booking-ops/tests/build.test.ts \
  apps/pmc-google-booking-ops/docs/pilot-runbook.md
git commit -m "feat: add owner-gated Booking Sheet presentation"
```

## Sheet UX Plan Stop Point

Stop after local build/dry-run capability. Do not push Apps Script or invoke live apply until the owner approves the exact dry-run digest and maintenance window.
