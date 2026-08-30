# Task 5 Report — Owner-fenced confirm and validated queue fast path

## Status

Implemented locally on base `74fa066`. No deployment, live request, Cloud Task, external Booking ingress, Apps Script push, Google Sheet mutation, configuration/property change, telemetry change, performance-harness work, or async-owner allowlist expansion was performed.

## Async confirm fast path

- Added the pure `validatedQueueFastPath(binding, result)` predicate.
- The local binding is fixed before state ingress and contains the exact request ID, draft ID, canonical payload hash, deterministic Cloud Task name, base version, and base attempt.
- `APPLIED` accepts only exact `QUEUED`, `baseVersion + 1`, unchanged attempt, and null Case/status.
- `IDEMPOTENT` accepts only the same exact `QUEUED` projection. Version-1 async results cannot attest a persisted task name for processing/retrying/terminal rows, so every such result returns `null`.
- Terminal outcomes, `PROCESSING`, `RETRYING`, `BUSY`, wrong IDs, malformed/missing bindings, impossible versions/attempts, wrong outcome/state combinations, and nonterminal Case/status all require the authoritative reread.
- A trusted exact QUEUED result builds the response from the returned state/version/attempt plus the locally bound payload/task and skips the post-ingress Sheet read.
- Every `null`, timeout, thrown error, or malformed/uncertain result performs exactly one authoritative `getDraft` recovery read. The reread now also requires the exact deterministic task name and canonical payload hash before acknowledgement.
- Deterministic task creation, the two-second schedule offset, task-name idempotency, payload/version/attempt fencing, worker leases, and retries remain unchanged.

## Synchronous protocol-2 owner fence

- Extended the versioned signed `MINI_APP_DRAFT_STATE v1` sibling with exact `CONFIRM_CLAIM`, `CONFIRM_COMPLETE`, and `CONFIRM_FAIL` discriminants while preserving every existing prepare/cancel shape.
- Moved the protocol-2 payload identity canonicalization to a shared contract. Cloud Run and Apps Script now hash the same recorder/Admin/AE snapshots, booking fields, and evidence identity.
- Apps Script recomputes the canonical P2 payload hash and executes claim/cancel competition under the same script lock.
- `CONFIRM_CLAIM` atomically changes eligible `READY_TO_CONFIRM`/`FAILED_RETRYABLE` rows to `CONFIRMING`. Exact replay is idempotent; CANCEL-before-CLAIM returns terminal, while CLAIM-before-CANCEL blocks the stale cancellation.
- Cloud Run calls Booking ingress only after an exact owner result or one authoritative reread attests the exact claim generation (`baseVersion + 1`, unchanged attempt, canonical hash and projection digest). A new HTTP retry that initially reads a persisted `CONFIRMING` row retains the broader safe-resume rule.
- `CONFIRM_COMPLETE` atomically records `CONFIRMED`, Case ID, appointment status, and confirmation timestamp. `CONFIRM_FAIL` records `FAILED_RETRYABLE` and a safe ingress error without removing prepared input, attribution, or evidence.
- Claim, complete, and fail response loss performs one authoritative reread and at most one same-mutation resend when the reread proves the mutation did not apply. No direct Cloud Run `claimConfirmation`, `completeConfirmation`, `failConfirmation`, or `updateDraft` mutation is reachable for prepare-enabled protocol 2.
- A persisted `CONFIRMING` client retry safely repeats the idempotent Booking ingress and owner completion. Five concurrent confirms converge on the same durable Case/result.
- Protocol 1 and protocol 2 while `prepare=false` keep the legacy direct synchronous path unchanged.

## TDD evidence

RED was observed before production changes:

- The new queue-state matrix failed at import because `queuedProjection.ts` did not exist.
- Booking fast-path tests showed two draft reads and could not use an actual `PROCESSING` ingress result without rereading.
- Binding-validation tests accepted empty payload and malformed task bindings before the guard was added.
- Apps Script owner tests rejected all confirm discriminants as invalid prepare payloads.
- HTTP owner-fence tests showed direct store claim/complete/fail calls, no owner operations, no recovery reread, and Booking ingress running after the injected cancel race.

GREEN evidence:

- Focused queue/confirm/owner/prepare/end-to-end selection: **7 files, 177 tests passed**.
- Full Mini App suite: **73 files, 1,054 tests passed**.
- Full Apps Script Booking suite: **49 files, 693 tests passed**.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- `npm run build:server`: passed.
- `npm run build:mini-app`: passed.
- Full `npm run build`: passed; the existing main-client large-chunk advisory remains unchanged.
- Full `npm run lint`: zero errors and one pre-existing generated `dist-server/server/pmc-mini-app/taskQueue.js` unused-disable warning.
- Touched-path ESLint: passed with zero findings.
- `git diff --check`: passed.

## Safety and compatibility review

- Result bodies contain only safe state metadata and canonical digests; no evidence bytes, URLs, LINE tokens, or customer/business fields were added to logs or telemetry.
- The existing prepare projection digest was strengthened with payload, attempt, completion, Case/status, and safe-error fields on both Cloud Run and Apps Script. Mixed old/new revisions fail the trusted-digest fast path and fall back to the authoritative read rather than acknowledging uncertainty.
- Existing `MINI_APP_ASYNC_STATE v1` payload/result shapes are unchanged.
- Apps Script async-state ingress now carries the real legacy/target row union and recomputes a null persisted hash with the exact P1 or P2 canonical identity. Protocol-1 bytes/behavior remain unchanged.
- The parent-amended design-spec attribution reservation text remains included in this task's commit as requested.

## Deferred boundary

Task 6 still owns privacy-safe phase timings, aggregate-only performance scripts, and measured budget evidence. Production deployment, live owner testing, and all-staff async expansion remain out of scope.

---

## Fix round 1 — Exact runtime, protocol, task, and claim ownership

The first review found one production-startup defect and three ownership gaps. All four were reproduced before the fixes:

- the freshly compiled middleware failed with Node `ERR_MODULE_NOT_FOUND` because a new shared runtime import omitted the `.js` extension;
- a freshly prepared protocol-2 async row rejected its first QUEUE because Apps Script recomputed the legacy P1 hash;
- an ambiguous stale claim could attach to a later `CONFIRMING` generation with the same payload hash;
- processing, retrying, and terminal version-1 async results could synthesize the local task name without attesting the persisted task binding.

Corrections:

- The shared runtime import is NodeNext-compatible. `npm run smoke:server` now builds the server and dynamically imports the compiled production middleware, failing if ESM resolution or the expected export is broken.
- The Apps Script request-state port carries the actual union of the exact legacy row and the target P1/P2 row. Async ingress selects `canonicalMiniAppAsyncIdentity` for legacy/P1 and `canonicalMiniAppP2BookingIdentity` for P2 while preserving the existing signed `MINI_APP_ASYNC_STATE v1` wire.
- A real integration sends `bookingPayloadHash()` from Cloud Run through the signed async client into the real Apps Script QUEUE domain, then runs worker CLAIM, evidence PROJECT, and COMPLETE on the same P2 row. Recorder/Admin/AE snapshots and the canonical hash survive through `CONFIRMED`.
- Ambiguous claim recovery accepts only the exact claim generation: `baseVersion + 1`, unchanged attempt, canonical payload identity, `CONFIRMING`, and the exact expected projection digest. The broader `CONFIRMING` resume remains only for a new HTTP request that initially read that state. A `READY -> CLAIM -> FAIL -> CLAIM` stale-response race now returns safe unavailable without calling Booking ingress.
- The no-reread queue predicate accepts only exact APPLIED/IDEMPOTENT `QUEUED` results. PROCESSING, RETRYING, terminal, BUSY, malformed, and impossible results perform exactly one authoritative reread; wrong persisted task bindings are rejected.
- The parent-amended performance plan and design spec documenting this narrower version-1 trust boundary remain included.

Fix-round verification:

- Focused queue/async/sync/row-store/client/domain/end-to-end selection: **9 files, 164 tests passed**.
- Full Mini App suite: **74 files, 1,059 tests passed**.
- Full Apps Script Booking suite: **49 files, 693 tests passed**.
- Default full repository run: **185 files and 2,595 tests passed**; only the unrelated OCR build smoke exceeded its fixed 20-second timeout under full parallel load, then passed **2/2** in isolation.
- Full repository single-worker run: **186 files, 2,596 tests passed**.
- `npm run smoke:server`: passed with `COMPILED_PMC_MIDDLEWARE_OK`.
- `npm run booking:typecheck`, `npm run booking:build`, and full `npm run build`: passed.
- Full `npm run lint`: zero errors and one pre-existing generated `dist-server/server/pmc-mini-app/taskQueue.js` unused-disable warning.
- Touched-path ESLint and `git diff --check`: passed.

No deploy, live request, external mutation, Apps Script push, Sheet/Drive/GCS write, Cloud Task, property/config change, or allowlist expansion was performed.
