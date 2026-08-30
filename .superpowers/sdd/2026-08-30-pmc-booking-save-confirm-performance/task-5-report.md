# Task 5 Report — Owner-fenced confirm and validated queue fast path

## Status

Implemented locally on base `74fa066`. No deployment, live request, Cloud Task, external Booking ingress, Apps Script push, Google Sheet mutation, configuration/property change, telemetry change, performance-harness work, or async-owner allowlist expansion was performed.

## Async confirm fast path

- Added the pure `validatedQueueFastPath(binding, result)` predicate.
- The local binding is fixed before state ingress and contains the exact request ID, draft ID, canonical payload hash, deterministic Cloud Task name, base version, and base attempt.
- `APPLIED` accepts only exact `QUEUED`, `baseVersion + 1`, unchanged attempt, and null Case/status.
- `IDEMPOTENT` accepts exact `QUEUED`, or `PROCESSING`/`RETRYING` with version at least `baseVersion + 2` and a bounded worker attempt from `baseAttempt + 1` through 8.
- Exact terminal projections validate state-specific Case/status and attempt coherence. `BUSY`, wrong IDs, malformed/missing bindings, impossible versions/attempts, wrong outcome/state combinations, and nonterminal Case/status return `null`.
- A trusted result builds the response from the returned actual state/version/attempt plus the locally bound payload/task and skips the post-ingress Sheet read.
- Every `null`, timeout, thrown error, or malformed/uncertain result performs exactly one authoritative `getDraft` recovery read. The reread now also requires the exact deterministic task name and canonical payload hash before acknowledgement.
- Deterministic task creation, the two-second schedule offset, task-name idempotency, payload/version/attempt fencing, worker leases, and retries remain unchanged.

## Synchronous protocol-2 owner fence

- Extended the versioned signed `MINI_APP_DRAFT_STATE v1` sibling with exact `CONFIRM_CLAIM`, `CONFIRM_COMPLETE`, and `CONFIRM_FAIL` discriminants while preserving every existing prepare/cancel shape.
- Moved the protocol-2 payload identity canonicalization to a shared contract. Cloud Run and Apps Script now hash the same recorder/Admin/AE snapshots, booking fields, and evidence identity.
- Apps Script recomputes the canonical P2 payload hash and executes claim/cancel competition under the same script lock.
- `CONFIRM_CLAIM` atomically changes eligible `READY_TO_CONFIRM`/`FAILED_RETRYABLE` rows to `CONFIRMING`. Exact replay is idempotent; CANCEL-before-CLAIM returns terminal, while CLAIM-before-CANCEL blocks the stale cancellation.
- Cloud Run calls Booking ingress only after an exact owner result or one authoritative reread attests `CONFIRMING` with the canonical hash.
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
- The parent-amended design-spec attribution reservation text remains included in this task's commit as requested.

## Deferred boundary

Task 6 still owns privacy-safe phase timings, aggregate-only performance scripts, and measured budget evidence. Production deployment, live owner testing, and all-staff async expansion remain out of scope.
