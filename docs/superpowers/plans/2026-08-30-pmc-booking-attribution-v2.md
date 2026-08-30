# PMC Booking Attribution V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate immutable LINE recorder identity from selected Admin and AE attribution across Mini App, Apps Script, Sheets, Calendar, LINE Flex, call ownership, and commission reporting.

**Architecture:** Introduce booking protocol version 2 with canonical recorder/Admin/AE IDs and server-resolved display-name snapshots. Deploy dual protocol/schema readers first, gate migration on zero nonterminal legacy drafts/tasks, atomically migrate `MINI_APP_REQUESTS` and `BOOKING_MASTER`, then require protocol 2 for new mutations while retaining protocol-1 terminal recovery through TTL.

**Tech Stack:** React 19, TypeScript 6, Node HTTP, Google Sheets API, Apps Script V8, Vitest, Testing Library, HMAC-SHA256.

**Spec:** `docs/superpowers/specs/2026-08-30-pmc-booking-speed-attribution-sheet-ux-design.md`

## Global Constraints

- `ผู้บันทึก` is the verified LINE-mapped recorder and is never browser-editable.
- Recorder authorization continues to require active `CONFIG_STAFF.canCloseBooking=true`.
- Admin and AE choices use the same ordered active `CONFIG_STAFF.canBeAe=true` rows; Admin is required and AE may be null/`ไม่ระบุ`.
- Browser payloads submit Admin/AE IDs only; names are resolved and snapshotted server-side.
- Selected Admin owns existing Admin attribution, call ownership, and Admin commission; recorder is audit-only.
- Do not remove payload hashes, versions, locks, idempotency, recovery comparisons, or strict exact-key parsing.
- Do not mutate live Sheets, deploy, or raise the minimum protocol version inside implementation tasks.
- Migration requires a private native backup, exact known headers, zero nonterminal protocol-1 drafts, and zero active Cloud Tasks.
- Unknown headers/versions fail closed. Protocol-1 terminal/idempotent recovery remains during the compatibility window.
- Never log LINE tokens, emails, phone numbers, customer content, evidence identifiers, Sheet/Drive IDs, or secret values.

---

## File Structure

```text
shared/
  pmcBookingProtocol.ts                 protocol constants and exact attribution contracts
  pmcMiniAppAsyncState.ts               request-row attribution fields
  pmcMiniAppBooking.ts                  discriminated P1/P2 signed ingress

server/pmc-mini-app/
  bookingDraft.ts                       P2 input validation and server snapshots
  bookingIngressClient.ts               signed P2 ingress builder
  contracts.ts                          config projection with Admin/AE choices
  middleware.ts                         protocol/capability enforcement
  setup.ts                              exact request-schema compatibility and migration
  store.ts                              dual-row reader and P2 writer

src/apps/pmc-mini-app/
  contracts.ts                          P2 browser-safe types
  bookingModel.ts                       ID-based form state and validation
  BookingWizard.tsx                     ผู้บันทึก/Admin/AE UI
  api.ts                                protocol headers/bodies
  preview.ts                            preview fixtures

apps/pmc-google-booking-ops/src/
  domain/attributionMigration.ts        pure migration/backfill plan
  workflows/attributionMigration.ts     owner-gated backup/apply/readback
  domain/types.ts                       BookingCase recorder fields
  domain/staffDirectory.ts              canonical Admin/AE resolvers
  domain/miniAppIngress.ts              exact signed P1/P2 validation
  domain/sheetMigration.ts              exact BOOKING_MASTER migration
  sheetSchema.ts                        recorder columns
  adapters/miniAppRequestState.ts       exact dual-schema normalized reader
  adapters/googleForms.ts               unique-name Form choices
  adapters/googleCalendar.ts            three-role presentation
  adapters/lineMessaging.ts              three-role internal Flex
  workflows/formSubmit.ts               recorder/Admin/AE persistence
  workflows/miniAppSubmit.ts            P2 recorder/Admin/AE resolution
  runtime.ts / entrypoints.ts            preflight and owner-only migration entrypoints
```

---

### Task 1: Shared protocol-2 attribution contracts

**Files:**
- Create: `shared/pmcBookingProtocol.ts`
- Modify: `shared/pmcMiniAppAsyncState.ts`
- Modify: `shared/pmcMiniAppBooking.ts`
- Test: `tests/pmc-mini-app/bookingProtocol.test.ts`
- Test: `tests/pmc-mini-app/bookingIngressClient.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts`

**Interfaces:**
- Produces: `PMC_BOOKING_PROTOCOL_VERSION = 2`, `BookingProtocolVersion`, `RecorderSource`.
- Produces: exact discriminated P1/P2 ingress contracts; P2 canonical fields include recorder/Admin/AE IDs and snapshots.
- Produces: `MINI_APP_ASYNC_REQUEST_HEADERS_V1` as the current exact tuple, plus request-row fields `protocolVersion`, `recorderName`, `adminId`, `adminName`, `aeId`, `aeName` for V2.

- [ ] **Step 1: Write failing exact-canonicalization tests**

```ts
it('binds every protocol-2 attribution identity into the signed canonical body', () => {
  const base = protocol2Envelope({
    staffId: 'ADMIN_01', recorderName: 'มัส',
    adminId: 'ADMIN_02', adminName: 'แวว', aeId: 'ADMIN_03', aeName: 'หมวย',
  })
  expect(canonicalMiniAppBookingIngress(base))
    .not.toBe(canonicalMiniAppBookingIngress(protocol2Envelope({ ...base.payload, adminId: 'ADMIN_04' })))
})

it('rejects names in the browser attribution selection', () => {
  expect(parseBookingAttributionSelection({ adminId: 'ADMIN_02', aeId: null, adminName: 'spoof' }))
    .toEqual({ ok: false, code: 'UNKNOWN_BOOKING_FIELD' })
})
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
npx vitest run tests/pmc-mini-app/bookingProtocol.test.ts \
  tests/pmc-mini-app/bookingIngressClient.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts
```

Expected: FAIL because protocol-2 types/canonicalizers do not exist.

- [ ] **Step 3: Implement exact shared types**

```ts
export const PMC_BOOKING_PROTOCOL_VERSION = 2 as const
export type BookingProtocolVersion = 1 | 2
export type RecorderSource =
  | 'VERIFIED_LINE'
  | 'LEGACY_ASSUMED_ADMIN'
  | 'FORM_EMAIL_MATCH'
  | 'FORM_UNRESOLVED'

export interface BookingAttributionSelectionV2 {
  adminId: string
  aeId: string | null
}

export interface BookingMutationEnvelopeV2<T> {
  protocolVersion: 2
  version: number
  input: T
}

export interface BookingCreateEnvelopeV2 {
  protocolVersion: 2
}

export interface BookingVersionEnvelopeV2 {
  protocolVersion: 2
  version: number
}

export type MiniAppBookingIngressPayloadV2 = Omit<
  MiniAppBookingIngressPayloadV1,
  'aeName'
> & {
  protocolVersion: 2
  recorderName: string
  adminId: string
  adminName: string
  aeId: string | null
  aeName: string | null
}
```

Keep `staffId` in both protocols as the immutable recorder authorization ID. Export the current exact request header tuple as `MINI_APP_ASYNC_REQUEST_HEADERS_V1` while keeping the existing canonical header alias on V1 until Task 2. Keep P1/P2 as separate exact-key unions and separate canonical branches. Reject unknown versions and extra fields.

- [ ] **Step 4: Run GREEN and affected contract tests**

```bash
npx vitest run tests/pmc-mini-app/bookingProtocol.test.ts \
  tests/pmc-mini-app/bookingIngressClient.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts
npm run booking:typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/pmcBookingProtocol.ts shared/pmcMiniAppAsyncState.ts shared/pmcMiniAppBooking.ts \
  tests/pmc-mini-app/bookingProtocol.test.ts tests/pmc-mini-app/bookingIngressClient.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts
git commit -m "feat: add protocol-v2 booking attribution contracts"
```

---

### Task 2: Cloud Run request-row and config attribution

**Files:**
- Modify: `server/pmc-mini-app/store.ts`
- Modify: `server/pmc-mini-app/setup.ts`
- Modify: `server/pmc-mini-app/bookingDraft.ts`
- Modify: `server/pmc-mini-app/contracts.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Test: `tests/pmc-mini-app/store.test.ts`
- Test: `tests/pmc-mini-app/setup.test.ts`
- Test: `tests/pmc-mini-app/bookingDraft.test.ts`
- Test: `tests/pmc-mini-app/sessionApi.test.ts`

**Interfaces:**
- Produces: `MiniAppBookingConfigProjection.admins` and `.aes` from the same ordered active `canBeAe` rows.
- Produces: normalized dual-schema `MiniAppRequestRecord` with P2 attribution snapshots.
- Produces: `parseBookingDraftV2(input, context)` resolving IDs to snapshots.

- [ ] **Step 1: Write failing store/config/validation tests**

```ts
it('returns the same eligible IDs for required Admin and optional AE choices', async () => {
  const config = await store.getActiveBookingConfig()
  expect(config.admins).toEqual(config.aes)
  expect(config.admins.every((item) => item.id !== 'NONE')).toBe(true)
})

it('keeps recorder immutable and resolves Admin/AE names by exact ID', () => {
  expect(parseBookingDraftV2(input({ adminId: 'ADMIN_02', aeId: 'ADMIN_03' }), context()))
    .toMatchObject({ staffId: 'ADMIN_01', recorderName: 'มัส', adminName: 'แวว', aeName: 'หมวย' })
})
```

Also cover inactive/unknown Admin ID, null AE, browser name spoof, duplicate display names, P1 row normalization, P2 row roundtrip, and unknown header rejection.

- [ ] **Step 2: Run RED tests**

```bash
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts \
  tests/pmc-mini-app/bookingDraft.test.ts tests/pmc-mini-app/sessionApi.test.ts
```

Expected: FAIL on missing P2 columns/config fields.

- [ ] **Step 3: Implement dual-schema reader and P2 writer**

Use exact headers:

```ts
const LEGACY_REQUEST_HEADERS = MINI_APP_ASYNC_REQUEST_HEADERS_V1
const legacyAeNameIndex = LEGACY_REQUEST_HEADERS.indexOf('aeName')
const ATTRIBUTION_V2_REQUEST_HEADERS = [
  ...LEGACY_REQUEST_HEADERS.slice(0, 2),
  'protocolVersion',
  LEGACY_REQUEST_HEADERS[2],
  'recorderName', 'adminId', 'adminName',
  ...LEGACY_REQUEST_HEADERS.slice(3, legacyAeNameIndex),
  'aeId',
  ...LEGACY_REQUEST_HEADERS.slice(legacyAeNameIndex),
] as const
```

Task 1 defines `MINI_APP_ASYNC_REQUEST_HEADERS_V1`; Task 2 defines `ATTRIBUTION_V2_REQUEST_HEADERS`, switches the canonical writer alias only after the dual reader exists, and normalizes legacy rows with `protocolVersion: 1`. Readers accept only those two exact schemas. Writers use the actual compatible schema before migration and P2 only afterward. P2 browser input contains `adminId`/`aeId`; names come from the request-scoped config snapshot.

- [ ] **Step 4: Run GREEN and server build**

```bash
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts \
  tests/pmc-mini-app/bookingDraft.test.ts tests/pmc-mini-app/sessionApi.test.ts
npm run build:server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pmc-mini-app/store.ts server/pmc-mini-app/setup.ts \
  server/pmc-mini-app/bookingDraft.ts server/pmc-mini-app/contracts.ts server/pmc-mini-app/middleware.ts \
  tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts \
  tests/pmc-mini-app/bookingDraft.test.ts tests/pmc-mini-app/sessionApi.test.ts
git commit -m "feat: resolve booking attribution IDs server-side"
```

---

### Task 3: Protocol-2 Mini App form and cached-client gate

**Files:**
- Modify: `src/apps/pmc-mini-app/contracts.ts`
- Modify: `src/apps/pmc-mini-app/bookingModel.ts`
- Modify: `src/apps/pmc-mini-app/BookingWizard.tsx`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/preview.ts`
- Test: `tests/pmc-mini-app/bookingModel.test.ts`
- Test: `tests/pmc-mini-app/bookingWizard.test.tsx`
- Test: `tests/pmc-mini-app/api.test.ts`
- Test: `tests/pmc-mini-app/clientShell.test.tsx`

**Interfaces:**
- Consumes: config `admins`/`aes` and protocol capability from Task 2.
- Produces: `BookingDraftInputV2` with required `adminId` and nullable `aeId`.

- [ ] **Step 1: Write failing UI tests**

```tsx
expect(screen.getByLabelText('ผู้บันทึก')).toBeDisabled()
expect(screen.getByLabelText('ผู้บันทึก')).toHaveValue('มัส')
await user.selectOptions(screen.getByLabelText('Admin'), 'ADMIN_02')
await user.selectOptions(screen.getByLabelText('AE'), '')
await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
expect(api.save).toHaveBeenCalledWith(
  expect.any(String), expect.any(Number),
  expect.objectContaining({ adminId: 'ADMIN_02', aeId: null }),
)
```

Add exact order assertion `ผู้บันทึก → Admin → AE`, required Admin validation, preview labels, and `CLIENT_UPGRADE_REQUIRED` close/reopen copy.

- [ ] **Step 2: Run RED tests**

```bash
npx vitest run tests/pmc-mini-app/bookingModel.test.ts \
  tests/pmc-mini-app/bookingWizard.test.tsx tests/pmc-mini-app/api.test.ts \
  tests/pmc-mini-app/clientShell.test.tsx
```

Expected: FAIL because the UI still treats recorder as Admin and submits AE name.

- [ ] **Step 3: Implement ID-based UI**

```ts
export type BookingDraftInputV2 = Omit<BookingDraftInputV1, 'aeName'> & {
  adminId: string
  aeId: string | null
}
```

Render recorder from session read-only. Dropdown option value is staff ID and label is name. Convert AE empty option to null. Every mutation sends protocol 2. New mutations below minimum fail with one persistent instruction to close/reopen LINE.

- [ ] **Step 4: Run GREEN and Mini App build**

```bash
npx vitest run tests/pmc-mini-app/bookingModel.test.ts \
  tests/pmc-mini-app/bookingWizard.test.tsx tests/pmc-mini-app/api.test.ts \
  tests/pmc-mini-app/clientShell.test.tsx
npm run build:mini-app
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/pmc-mini-app tests/pmc-mini-app/bookingModel.test.ts \
  tests/pmc-mini-app/bookingWizard.test.tsx tests/pmc-mini-app/api.test.ts \
  tests/pmc-mini-app/clientShell.test.tsx
git commit -m "feat: submit canonical Admin and AE IDs"
```

---

### Task 4: Apps Script booking persistence and three-role presentation

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/domain/types.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/staffDirectory.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/miniAppIngress.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/miniAppSubmit.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleForms.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Test: `apps/pmc-google-booking-ops/tests/miniAppSubmit.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/formSubmit.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts`

**Interfaces:**
- Produces: `BookingCase.recorderId`, `.recorderName`, `.recorderSource`.
- Produces: `resolveSelectableAdminById`, `resolveEligibleAeById`.
- Produces: Calendar/Flex order `ผู้บันทึก → Admin → AE`.

- [ ] **Step 1: Write failing attribution persistence tests**

```ts
expect(submitMiniAppBooking(v2Ingress(), ports)).toMatchObject({
  recorderId: 'ADMIN_01', recorderName: 'มัส', recorderSource: 'VERIFIED_LINE',
  adminId: 'ADMIN_02', adminName: 'แวว', aeId: 'ADMIN_03', aeName: 'หมวย',
  callOwnerAdminId: 'ADMIN_02',
})
```

Add tests for Admin `canBeAe=true/canCloseBooking=false`, recorder authorization failure, Form email match/unresolved source, duplicate Form choice-name cutover failure, Calendar description order, Flex role order, and commission inputs remaining selected Admin/AE.

- [ ] **Step 2: Run RED tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/miniAppSubmit.test.ts \
  apps/pmc-google-booking-ops/tests/formSubmit.test.ts \
  apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts \
  apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts
```

Expected: FAIL on missing recorder fields and Admin ID resolution.

- [ ] **Step 3: Implement P2 persistence and exact presentation**

```ts
export interface BookingRecorderFields {
  recorderId: string | null
  recorderName: string
  recorderSource: RecorderSource
}
```

Add `BookingRecorderFields` to the existing `BookingCase` declaration without changing its existing fields. P2 ingress validates each signed ID/name pair against current config. Form choices use unique names and resolve to IDs. Call owner and commission continue to use selected Admin/AE. Recorder is audit-only.

- [ ] **Step 4: Run GREEN and Booking build**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/miniAppSubmit.test.ts \
  apps/pmc-google-booking-ops/tests/formSubmit.test.ts \
  apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts \
  apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests
git commit -m "feat: persist recorder and selected attribution"
```

---

### Task 5: Guarded Sheet attribution migration

**Files:**
- Create: `apps/pmc-google-booking-ops/src/domain/attributionMigration.ts`
- Create: `apps/pmc-google-booking-ops/src/workflows/attributionMigration.ts`
- Modify: `apps/pmc-google-booking-ops/src/sheetSchema.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/sheetMigration.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/miniAppRequestState.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Test: `apps/pmc-google-booking-ops/tests/attributionMigration.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/sheetMigration.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/miniAppRequestStateStore.test.ts`

**Interfaces:**
- Produces: `planBookingAttributionMigration(snapshot): BookingAttributionMigrationPlan`.
- Produces owner entrypoints: `previewPmcBookingAttributionMigration()` and `applyPmcBookingAttributionMigration()`.
- Consumes injected `QueueGatePort` returning paused/state/task counts.

- [ ] **Step 1: Write failing pure migration tests**

```ts
expect(() => planBookingAttributionMigration(snapshot({
  nonterminalLegacyDraftCount: 1,
}))).toThrow('NONTERMINAL_LEGACY_DRAFTS')

expect(planBookingAttributionMigration(cleanLegacySnapshot())).toMatchObject({
  requestInsertions: ['recorderName', 'adminId', 'adminName', 'aeId'],
  masterInsertions: ['recorderId', 'recorderName', 'recorderSource'],
})
```

Cover exact legacy/P2 headers, unknown headers, active tasks, duplicate legacy AE names, authoritative request correlation, assumed-admin source, Form email source, idempotent rerun, and no-write dry run.

- [ ] **Step 2: Run RED tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/attributionMigration.test.ts \
  apps/pmc-google-booking-ops/tests/sheetMigration.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppRequestStateStore.test.ts
```

Expected: FAIL because the planner/workflow do not exist.

- [ ] **Step 3: Implement backup/preflight/atomic migration/readback**

```ts
export interface QueueGatePort {
  state(): 'PAUSED' | 'RUNNING'
  activeTaskCount(): number
}

export interface BookingAttributionMigrationResult {
  backupCreated: true
  requestRowsMigrated: number
  bookingRowsMigrated: number
  readbackVerified: true
}
```

Apply under `LockService`; re-read and require the same fingerprint before mutation. Insert columns with exact zero-based ranges, write backfills, and verify header/value hashes. A second run performs zero mutations. Preview never creates a backup or writes.

- [ ] **Step 4: Run GREEN and build exported entrypoints**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/attributionMigration.test.ts \
  apps/pmc-google-booking-ops/tests/sheetMigration.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppRequestStateStore.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: PASS; build footer exposes only the two named owner functions.

- [ ] **Step 5: Commit**

```bash
git add apps/pmc-google-booking-ops/src/domain/attributionMigration.ts \
  apps/pmc-google-booking-ops/src/workflows/attributionMigration.ts \
  apps/pmc-google-booking-ops/src/sheetSchema.ts \
  apps/pmc-google-booking-ops/src/domain/sheetMigration.ts \
  apps/pmc-google-booking-ops/src/adapters/googleSheets.ts \
  apps/pmc-google-booking-ops/src/adapters/miniAppRequestState.ts \
  apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/src/entrypoints.ts \
  apps/pmc-google-booking-ops/scripts/build.mjs apps/pmc-google-booking-ops/tests
git commit -m "feat: migrate Booking attribution schema safely"
```

---

### Task 6: Protocol cutover gates and release runbook

**Files:**
- Modify: `server/pmc-mini-app/config.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `docs/pmc-mini-app/pilot-runbook.md`
- Create: `scripts/check-pmc-booking-attribution-v2.mjs`
- Test: `tests/pmc-mini-app/config.test.ts`
- Test: `tests/pmc-mini-app/bookingApi.test.ts`
- Test: `tests/pmc-mini-app/endToEnd.test.ts`

**Interfaces:**
- Produces: config `bookingProtocol: { supported: 2, minimumMutation: 1 | 2, prepare: false }`; the performance plan changes `prepare` only after the route exists.
- Produces: safe `409 CLIENT_UPGRADE_REQUIRED` for mutation below minimum.
- Produces: no-value checker output with header/draft/task/deployment readiness booleans only.

- [ ] **Step 1: Write failing rolling-deploy tests**

```ts
expect(await mutateWithProtocol(1, minimum2Deps())).toMatchObject({
  status: 409, body: { error: 'CLIENT_UPGRADE_REQUIRED' },
})
expect(await loadTerminalProtocol1(minimum2Deps())).toMatchObject({ status: 200 })
```

Cover legacy-reader/new-writer, new-reader/legacy-writer before cutover, cached client after cutover, no partial mutation, and exact zero-draft/task migration gate.

- [ ] **Step 2: Run RED tests**

```bash
npx vitest run tests/pmc-mini-app/config.test.ts tests/pmc-mini-app/bookingApi.test.ts \
  tests/pmc-mini-app/endToEnd.test.ts
```

Expected: FAIL on missing protocol floor/checker.

- [ ] **Step 3: Implement config gate and no-value checker**

The checker reads deployed env names, exact Sheet headers, nonterminal draft count, queue state/task count, and Apps Script version without printing members, IDs, rows, or secrets. Runbook order is reader compatibility → zero-state preflight → pause/backup/migrate → P2 client → minimum 2 → TTL cleanup.

- [ ] **Step 4: Run complete local gate**

```bash
npx vitest run tests/pmc-mini-app/config.test.ts tests/pmc-mini-app/bookingApi.test.ts \
  tests/pmc-mini-app/endToEnd.test.ts
npm run booking:test
npm run booking:typecheck
npm test
npm run lint
npm run build
node scripts/check-pmc-booking-attribution-v2.mjs --help
git diff --check
```

Expected: all tests/builds pass; lint has zero errors; checker help exits 0.

- [ ] **Step 5: Commit**

```bash
git add server/pmc-mini-app/config.ts server/pmc-mini-app/middleware.ts \
  docs/pmc-mini-app/pilot-runbook.md scripts/check-pmc-booking-attribution-v2.mjs \
  tests/pmc-mini-app/config.test.ts tests/pmc-mini-app/bookingApi.test.ts tests/pmc-mini-app/endToEnd.test.ts
git commit -m "chore: gate Booking protocol-v2 cutover"
```

## Attribution Plan Stop Point

Stop after the local gate. Do not push Apps Script, migrate the live Sheet, change protocol minimum, or route Cloud Run traffic until the owner reviews the preflight and approves a maintenance window.
