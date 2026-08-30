# PMC Booking Save and Confirm Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce user-visible Booking Save and async Confirm waits while preserving authorization, durable queue acknowledgement, deterministic evidence recovery, and idempotency.

**Architecture:** Add a protocol-2 combined multipart prepare endpoint so evidence and booking input share one authentication/config/draft cycle and one final draft mutation. Validate exact Apps Script queue-state results to skip only the redundant confirmation Sheet reread, retain authoritative reread for every uncertain outcome, and record privacy-safe phase timings.

**Tech Stack:** React 19, TypeScript 6, Node HTTP, Busboy, Google Cloud Storage, Cloud Tasks, Google Sheets, Apps Script, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-30-pmc-booking-speed-attribution-sheet-ux-design.md`

## Global Constraints

- This plan consumes protocol-2 contracts/config/attribution from `2026-08-30-pmc-booking-attribution-v2.md`.
- One prepare request accepts exactly one input JSON part, 1–10 payment images, and 1–10 chat images.
- Enforce JPEG/PNG magic/MIME, 10,000,000 decoded bytes per file, 25,000,000 decoded bytes total, and 26,000,000 raw multipart bytes.
- New clients never probe a route advertised unavailable. Legacy routes remain for compatibility and deterministic recovery.
- No input becomes `READY_TO_CONFIRM` until every required evidence reference is durably persisted.
- Async acknowledgement still requires deterministic Cloud Task creation and durable Apps Script queue mutation.
- Never acknowledge uncertain queue state; use exactly one authoritative Sheet reread for uncertainty.
- Do not remove the two-second task schedule offset, version/hash/lease fencing, retries, or task-name idempotency.
- Telemetry permits route/action/status/state/fileCount/attempt/elapsedMs only—never evidence bytes, IDs, URLs, LINE tokens, or business/customer fields.
- Stop before all-staff async expansion and worker-throughput rollout.

## Execution Prerequisite and Program Order

Run this plan only after all six tasks in `2026-08-30-pmc-booking-attribution-v2.md` are committed and its complete local gate is green. Before Task 1, record:

```bash
test "$(git log -1 --pretty=%s)" = "fix: preserve P2 attribution through Booking ingress"
ATTRIBUTION_BASE="$(git rev-parse HEAD)"
test -n "$ATTRIBUTION_BASE"
test -z "$(git status --porcelain)"
```

This plan consumes the exact `BookingDraftInputV2`, `BookingMutationEnvelopeV2`, `MiniAppConfig.bookingProtocol`, dual-schema readers, and protocol gate produced by that attribution commit. Do not execute attribution and performance tasks concurrently because both modify `middleware.ts`, client contracts/API/Wizard, and protocol config.

---

## File Structure

```text
shared/
  pmcMiniAppBookingPrepare.ts            exact protocol-2 prepare contract

server/pmc-mini-app/
  bookingPrepare.ts                      pure prepare validation/orchestration
  evidenceBatch.ts                       bounded multipart parser
  evidenceIngressClient.ts               deterministic sync evidence binding
  middleware.ts                          prepare route and confirm fast path
  queuedProjection.ts                    exact ingress-result predicate
  bookingPerformanceTelemetry.ts         allowlisted timing events

src/apps/pmc-mini-app/
  contracts.ts / api.ts                  typed prepare capability/client
  BookingWizard.tsx                      one-request prepare flow

tests/pmc-mini-app/
  bookingPrepareMultipart.test.ts
  bookingPrepareApi.test.ts
  bookingPerformance.test.ts

scripts/
  measure-pmc-booking-performance.mjs    aggregate-only performance harness
```

---

### Task 1: Protocol-2 prepare capability and client contract

**Files:**
- Create: `shared/pmcMiniAppBookingPrepare.ts`
- Modify: `server/pmc-mini-app/contracts.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `src/apps/pmc-mini-app/contracts.ts`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Test: `tests/pmc-mini-app/api.test.ts`
- Test: `tests/pmc-mini-app/sessionApi.test.ts`
- Test: `tests/pmc-mini-app/bookingWizard.test.tsx`

**Interfaces:**
- Produces: `BookingPrepareCapability` in authenticated config.
- Produces: `MiniAppBrowserApi.prepare(idToken, draftId, version, input)`.
- Consumes: `BookingDraftInputV2` from the attribution plan.

- [ ] **Step 1: Write failing capability/client tests**

```ts
expect(config.bookingProtocol).toEqual({ supported: 2, minimumMutation: 1, prepare: false })

await api.prepare('token', 'draft-1', 4, {
  input: bookingInputV2(), paymentFiles: [payment], chatFiles: [chat],
})
expect(fetch).toHaveBeenCalledWith('/api/mini-app/booking-drafts/draft-1/prepare',
  expect.objectContaining({ method: 'POST', body: expect.any(FormData) }))
```

Also assert cached protocol 1 stays on its declared legacy path, `prepare=false` causes no speculative request, and minimum 2 returns `CLIENT_UPGRADE_REQUIRED` UI handling. Task 1 adds the typed client method but does not advertise the route before Task 4.

- [ ] **Step 2: Run RED tests**

```bash
npx vitest run tests/pmc-mini-app/api.test.ts tests/pmc-mini-app/sessionApi.test.ts \
  tests/pmc-mini-app/bookingWizard.test.tsx
```

Expected: FAIL because prepare capability/client do not exist.

- [ ] **Step 3: Implement exact prepare contract**

```ts
export interface BookingPrepareCapability {
  supported: 2
  minimumMutation: 1 | 2
  prepare: boolean
}

export interface BookingPrepareInput {
  protocolVersion: 2
  version: number
  input: BookingDraftInputV2
  paymentFiles: File[]
  chatFiles: File[]
}
```

`api.prepare()` appends one JSON part named `input`, then `paymentFiles` and `chatFiles`. It includes no customer data in telemetry/logs.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run tests/pmc-mini-app/api.test.ts tests/pmc-mini-app/sessionApi.test.ts \
  tests/pmc-mini-app/bookingWizard.test.tsx
npm run build:mini-app
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/pmcMiniAppBookingPrepare.ts server/pmc-mini-app/contracts.ts \
  server/pmc-mini-app/middleware.ts src/apps/pmc-mini-app/contracts.ts \
  src/apps/pmc-mini-app/api.ts tests/pmc-mini-app/api.test.ts \
  tests/pmc-mini-app/sessionApi.test.ts tests/pmc-mini-app/bookingWizard.test.tsx
git commit -m "feat: advertise Booking prepare protocol"
```

---

### Task 2: Bounded prepare multipart parser

**Files:**
- Modify: `server/pmc-mini-app/evidenceBatch.ts`
- Create: `tests/pmc-mini-app/bookingPrepareMultipart.test.ts`

**Interfaces:**
- Produces: `consumeBookingPrepareMultipart(req, limits): Promise<ParsedBookingPrepare>`.
- Produces deterministic safe errors `BOOKING_PREPARE_JSON_REQUIRED`, `EVIDENCE_FILE_LIMIT`, `EVIDENCE_TOO_LARGE`, `EVIDENCE_BATCH_TOO_LARGE`, `UNSUPPORTED_EVIDENCE`.

- [ ] **Step 1: Write failing parser tests**

```ts
await expect(parsePrepare(multipart({ duplicateInput: true })))
  .rejects.toMatchObject({ code: 'BOOKING_PREPARE_JSON_REQUIRED' })
await expect(parsePrepare(chunkedBytes(26_000_001)))
  .rejects.toMatchObject({ code: 'EVIDENCE_BATCH_TOO_LARGE' })
```

Cover missing input, invalid JSON/extra keys, 0 or 11 files per kind, 21 total, 10,000,001-byte file, 25,000,001 decoded total, bad MIME/magic, oversized advertised length before read, chunked overflow stop/unpipe, and valid boundary input.

- [ ] **Step 2: Run RED parser tests**

```bash
npx vitest run tests/pmc-mini-app/bookingPrepareMultipart.test.ts
```

Expected: FAIL because parser does not exist.

- [ ] **Step 3: Implement parser with exact limits**

```ts
export interface ParsedBookingPrepare {
  protocolVersion: 2
  version: number
  input: BookingDraftInputV2
  paymentFiles: EvidenceBatchFile[]
  chatFiles: EvidenceBatchFile[]
}

export const BOOKING_PREPARE_LIMITS = {
  maxFilesPerKind: 10,
  maxFileBytes: 10_000_000,
  maxDecodedBytes: 25_000_000,
  maxRawBytes: 26_000_000,
} as const
```

Reject Content-Length before consuming; enforce raw bytes while streaming and stop/unpipe/destroy at the limit. Parse exactly one JSON input field.

- [ ] **Step 4: Run GREEN parser tests**

```bash
npx vitest run tests/pmc-mini-app/bookingPrepareMultipart.test.ts
npm run build:server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pmc-mini-app/evidenceBatch.ts tests/pmc-mini-app/bookingPrepareMultipart.test.ts
git commit -m "feat: parse bounded Booking prepare uploads"
```

---

### Task 3: Deterministic evidence persistence and partial recovery

**Files:**
- Create: `server/pmc-mini-app/bookingPrepare.ts`
- Modify: `server/pmc-mini-app/evidenceIngressClient.ts`
- Modify: `server/pmc-mini-app/store.ts`
- Modify: `server/pmc-mini-app/bookingDraft.ts`
- Modify: `shared/pmcMiniAppAsyncState.ts`
- Modify: `server/pmc-mini-app/asyncStateIngressClient.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/miniAppEvidenceIngress.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/miniAppAsyncStateIngress.ts`
- Test: `tests/pmc-mini-app/bookingPrepareApi.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/miniAppEvidenceIngress.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/miniAppAsyncStateIngress.test.ts`

**Interfaces:**
- Produces: `persistPrepareEvidence(input): Promise<PersistedPrepareEvidence>`.
- Produces: exact deterministic binding by draft ID, kind, and SHA-256.

- [ ] **Step 1: Write failing persistence/recovery tests**

```ts
expect(await persistAndRetrySameEvidence()).toEqual({ duplicateFiles: 0, sameReferences: true })
expect(await failAfterTwoEvidenceWrites()).toMatchObject({
  state: 'DRAFT', retentionState: 'PENDING_APPROVAL', persistedReferenceCount: 2,
})
```

Cover GCS maximum four puts, synchronous serialization, one final success draft write, response-loss exact retry, changed bytes/order/input conflict, partial failure never ready, cancellation/expiry retention, and deterministic Apps Script file reuse.

- [ ] **Step 2: Run RED persistence tests**

```bash
npx vitest run tests/pmc-mini-app/bookingPrepareApi.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppEvidenceIngress.test.ts
```

Expected: FAIL because prepare persistence does not exist.

- [ ] **Step 3: Implement narrow persistence result**

```ts
export interface EvidenceReference {
  deterministicUploadId: string
  storage: 'STAGED_OBJECT' | 'DRIVE_FILE'
  value: string
  contentSha256: string
}

export interface PersistedPrepareEvidence {
  payment: readonly EvidenceReference[]
  chat: readonly EvidenceReference[]
  complete: boolean
}
```

Persist only existing object-key/file-ID columns in Sheets; recompute deterministic bindings. On partial success, write only accumulated references plus `PENDING_APPROVAL` and return a retryable error. Exact retry reuses references and changed binding conflicts. A terminal cancel/expiry race attaches references only through the signed Apps Script state-ingress owner lock; Cloud Run never claims a local mutex plus unconditional Sheets write is an atomic CAS.

- [ ] **Step 4: Run GREEN persistence tests**

```bash
npx vitest run tests/pmc-mini-app/bookingPrepareApi.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppEvidenceIngress.test.ts
npm run booking:typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pmc-mini-app/bookingPrepare.ts server/pmc-mini-app/evidenceIngressClient.ts \
  server/pmc-mini-app/store.ts server/pmc-mini-app/bookingDraft.ts \
  apps/pmc-google-booking-ops/src/domain/miniAppEvidenceIngress.ts \
  tests/pmc-mini-app/bookingPrepareApi.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppEvidenceIngress.test.ts
git commit -m "feat: recover deterministic Booking evidence uploads"
```

---

### Task 4: Combined prepare route and one-request client flow

**Files:**
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/bookingPrepare.ts`
- Modify: `src/apps/pmc-mini-app/BookingWizard.tsx`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Test: `tests/pmc-mini-app/bookingPrepareApi.test.ts`
- Test: `tests/pmc-mini-app/bookingWizard.test.tsx`
- Test: `tests/pmc-mini-app/api.test.ts`

**Interfaces:**
- Produces route: `POST /api/mini-app/booking-drafts/:draftId/prepare`.
- Consumes P2 attribution/config and deterministic persistence from Tasks 1–3.
- Produces exactly one final `READY_TO_CONFIRM` draft update on success.

- [ ] **Step 1: Write failing route/orchestration tests**

```ts
expect(identity.verify).toHaveBeenCalledOnce()
expect(store.getDraft).toHaveBeenCalledOnce()
expect(store.getActiveBookingConfig).toHaveBeenCalledOnce()
expect(store.updateDraft).toHaveBeenCalledOnce()
expect(response).toMatchObject({ status: 200, body: { state: 'READY_TO_CONFIRM' } })
```

Cover async GCS and sync Apps Script paths, no unavailable probe, exact idempotent retry, changed payload 409, safe ingress failure, and legacy endpoint compatibility.

Add an authenticated-config assertion that this task changes `bookingProtocol.prepare` from false to true only after the route handler is registered and tested.

- [ ] **Step 2: Run RED route/client tests**

```bash
npx vitest run tests/pmc-mini-app/bookingPrepareApi.test.ts \
  tests/pmc-mini-app/bookingWizard.test.tsx tests/pmc-mini-app/api.test.ts
```

Expected: FAIL because route/wizard one-request flow do not exist.

- [ ] **Step 3: Implement handler order and client selection**

Handler order is authenticate once → owned draft once → one config snapshot → parse/validate → persist evidence → one final update. Client chooses prepare from config, not error probing. Legacy flow remains only when protocol capability explicitly says prepare false.

- [ ] **Step 4: Run GREEN and affected suites**

```bash
npx vitest run tests/pmc-mini-app/bookingPrepareApi.test.ts \
  tests/pmc-mini-app/evidenceBatchApi.test.ts tests/pmc-mini-app/bookingWizard.test.tsx \
  tests/pmc-mini-app/api.test.ts
npm run build:mini-app
npm run build:server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pmc-mini-app/middleware.ts server/pmc-mini-app/bookingPrepare.ts \
  src/apps/pmc-mini-app/BookingWizard.tsx src/apps/pmc-mini-app/api.ts \
  tests/pmc-mini-app/bookingPrepareApi.test.ts tests/pmc-mini-app/bookingWizard.test.tsx \
  tests/pmc-mini-app/api.test.ts
git commit -m "feat: combine Booking evidence and draft preparation"
```

---

### Task 5: Validated confirm fast path and reread fallback

**Files:**
- Create: `server/pmc-mini-app/queuedProjection.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Test: `tests/pmc-mini-app/bookingApi.test.ts`
- Test: `tests/pmc-mini-app/asyncStateIngressClient.test.ts`

**Interfaces:**
- Produces: `validatedQueueFastPath(binding, result): SafeQueueProjection | null`.
- `null` always triggers one authoritative reread.

- [ ] **Step 1: Write failing exact-state matrix tests**

```ts
expect(validatedQueueFastPath(binding({ baseVersion: 4, baseAttempt: 0 }), {
  outcome: 'APPLIED', state: 'QUEUED', version: 5, attemptCount: 0,
  requestId: 'request-1', draftId: 'draft-1', caseId: null, confirmationStatus: null,
})).toMatchObject({ state: 'QUEUED', version: 5, attemptCount: 0 })

expect(validatedQueueFastPath(binding(), invalidBusyResult())).toBeNull()
```

Cover APPLIED exact queue, IDEMPOTENT queued/processing/retrying ranges, terminal validation, wrong IDs, wrong version/attempt, nonterminal case/status, BUSY, unknown outcome, state-ingress timeout, malformed result, and one reread only.

- [ ] **Step 2: Run RED confirm tests**

```bash
npx vitest run tests/pmc-mini-app/bookingApi.test.ts \
  tests/pmc-mini-app/asyncStateIngressClient.test.ts
```

Expected: FAIL because helper/fast path do not exist.

- [ ] **Step 3: Implement exact predicate**

```ts
export interface QueueFastPathBinding {
  requestId: string
  draftId: string
  payloadHash: string
  taskName: string
  baseVersion: number
  baseAttempt: number
}
```

APPLIED accepts only QUEUED/base+1/unchanged attempt. IDEMPOTENT additionally accepts PROCESSING/RETRYING at version ≥ base+2 and attempt base+1…8. Use returned state/version/attempt. BUSY/invalid/uncertain returns null. Bind local deterministic task name and payload hash before mutation.

- [ ] **Step 4: Run GREEN and response-loss tests**

```bash
npx vitest run tests/pmc-mini-app/bookingApi.test.ts \
  tests/pmc-mini-app/asyncStateIngressClient.test.ts \
  tests/pmc-mini-app/endToEnd.test.ts
npm run build:server
```

Expected: PASS; valid fast path calls no post-mutation `getDraft`, every uncertain path calls exactly one.

- [ ] **Step 5: Commit**

```bash
git add server/pmc-mini-app/queuedProjection.ts server/pmc-mini-app/middleware.ts \
  tests/pmc-mini-app/bookingApi.test.ts tests/pmc-mini-app/asyncStateIngressClient.test.ts
git commit -m "perf: skip confirm reread after validated queue state"
```

---

### Task 6: Privacy-safe timings and performance evidence harness

**Files:**
- Create: `server/pmc-mini-app/bookingPerformanceTelemetry.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Modify: `src/apps/pmc-mini-app/BookingWizard.tsx`
- Create: `tests/pmc-mini-app/bookingPerformance.test.ts`
- Modify: `tests/pmc-mini-app/asyncTelemetry.test.ts`
- Create: `scripts/measure-pmc-booking-performance.mjs`
- Create: `scripts/measure-pmc-mini-app-inp.mjs`
- Create: `tests/fixtures/booking-performance-pass.json`
- Create: `tests/fixtures/booking-performance-fail.json`
- Modify: `docs/pmc-mini-app/async-booking-runbook.md`

**Interfaces:**
- Produces allowlisted phase events and aggregate-only measurement artifact.
- Consumes no PII/evidence size/identifier fields.

- [ ] **Step 1: Write failing telemetry/privacy tests**

```ts
expect(() => emitBookingTiming('prepare_completed', {
  route: 'prepare', action: 'persist', status: 200, state: 'READY_TO_CONFIRM',
  fileCount: 2, attempt: 1, elapsedMs: 812,
})).not.toThrow()
expect(() => emitBookingTiming('prepare_completed', { ...allowed, totalBytes: 1 }))
  .toThrow('UNSAFE_BOOKING_TIMING_FIELD')
```

Cover all server boundaries, browser click→preview/Home callbacks, safe key allowlist, and rejection of IDs/content/URLs/bytes/arbitrary keys.

Add executable budget assertions:

```ts
expect(evaluateBookingPerformanceBudget(passingAggregate())).toEqual({ pass: true, failures: [] })
expect(evaluateBookingPerformanceBudget(aggregate({ asyncConfirmP95Ms: 6_001 })))
  .toEqual({ pass: false, failures: ['ASYNC_CONFIRM_P95'] })
```

- [ ] **Step 2: Run RED telemetry tests**

```bash
npx vitest run tests/pmc-mini-app/bookingPerformance.test.ts \
  tests/pmc-mini-app/asyncTelemetry.test.ts
```

Expected: FAIL because timing module/harness do not exist.

- [ ] **Step 3: Implement timings and 31-run harness**

Harness discards one warm-up and retains 30 successes, then runs five concurrent clients. Fixtures are exact: 2×500 KB, 5×2 MB, 20 files ≤25 MB, chunk overflow, invalid MIME, partial failure, response loss. Output includes revision, timestamps, route/status, fixture label, count, p50/p95/max only.

The harness implements `--evaluate <aggregate.json>` and exits nonzero unless every exact budget passes:

```ts
export interface BookingPerformanceBudgetResult {
  pass: boolean
  failures: Array<
    | 'INSUFFICIENT_SUCCESS_RUNS'
    | 'ASYNC_PREPARE_P95'
    | 'SYNC_PREPARE_MEDIAN_REDUCTION'
    | 'ASYNC_CONFIRM_P95'
    | 'UNAVAILABLE_ROUTE_PROBE'
    | 'MAX_FIXTURE_FAILURE'
    | 'CONCURRENCY_DUPLICATE'
  >
}

const pass = successesPerPath >= 30
  && asyncPreparePostParseP95Ms <= 3_000
  && syncPrepareMedianMs <= legacySyncPrepareMedianMs * 0.70
  && asyncConfirmP95Ms <= 6_000
  && unavailableRouteProbeCount === 0
  && maximumFixtureFailures === 0
  && concurrencyDuplicateCount === 0
```

`measure-pmc-mini-app-inp.mjs` runs the Booking preview flow in the supported browser harness, records Event Timing INP subparts and Long Animation Frames when available, and writes aggregate interaction target category, input delay, processing duration, presentation delay, and longest-frame duration without DOM text or user data. If p95 INP exceeds 200 ms or a Booking interaction produces a >50 ms script task, record a follow-up route-splitting gate; do not add speculative lazy-loading changes in this plan.

- [ ] **Step 4: Run complete performance-plan local gate**

```bash
npx vitest run tests/pmc-mini-app/bookingPrepareMultipart.test.ts \
  tests/pmc-mini-app/bookingPrepareApi.test.ts tests/pmc-mini-app/bookingApi.test.ts \
  tests/pmc-mini-app/evidenceBatchApi.test.ts tests/pmc-mini-app/bookingWizard.test.tsx \
  tests/pmc-mini-app/api.test.ts tests/pmc-mini-app/asyncStateIngressClient.test.ts \
  tests/pmc-mini-app/asyncTelemetry.test.ts tests/pmc-mini-app/bookingPerformance.test.ts
npm run booking:test
npm run booking:typecheck
npm test
npm run lint
npm run build
node scripts/measure-pmc-booking-performance.mjs --help
node scripts/measure-pmc-booking-performance.mjs --evaluate tests/fixtures/booking-performance-pass.json
node scripts/measure-pmc-mini-app-inp.mjs --help
git diff --check
```

Expected: all tests/builds pass; harness help and passing-fixture evaluation exit 0; a failing threshold fixture exits nonzero; no live request runs without a later owner gate.

- [ ] **Step 5: Commit**

```bash
git add server/pmc-mini-app/bookingPerformanceTelemetry.ts server/pmc-mini-app/middleware.ts \
  src/apps/pmc-mini-app/api.ts src/apps/pmc-mini-app/BookingWizard.tsx \
  tests/pmc-mini-app/bookingPerformance.test.ts tests/pmc-mini-app/asyncTelemetry.test.ts \
  scripts/measure-pmc-booking-performance.mjs scripts/measure-pmc-mini-app-inp.mjs \
  tests/fixtures/booking-performance-pass.json tests/fixtures/booking-performance-fail.json \
  docs/pmc-mini-app/async-booking-runbook.md
git commit -m "test: measure Booking Save and Confirm performance"
```

## Performance Plan Stop Point

Stop after local tests/harness. Do not expand the async allowlist, run live performance bookings, deploy, or mutate external systems until the owner approves the canary and synthetic fixture window.
