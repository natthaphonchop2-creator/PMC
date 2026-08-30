# Task 3 Report — Deterministic evidence persistence and partial recovery

## Status

Implemented locally on base `47d6e33`. This task adds the prepare persistence/orchestration layer only. It does not register the prepare route, enable the prepare capability, switch the browser/Wizard, fetch authentication or configuration, change the async owner allowlist, add confirm fast paths or telemetry, deploy, upload live evidence, or call an external service outside test fakes.

## Implementation

- Added `persistPrepareEvidence(...)` for already parsed and authorized protocol-2 prepare inputs.
- Canonical prepare binding covers draft/request identity, protocol/base draft version, normalized booking input and attribution snapshots, plus ordered payment/chat SHA-256 lists.
- The binding is persisted in the existing `evidenceProjectionHash` column during prepare recovery; no Sheet header, column, schema, or migration was added. The async worker may later replace it with the existing Drive-projection hash at its fenced projection step.
- Async evidence uses the existing private GCS staging port, deterministic draft/kind/raw-content identities, generation-create guards, SHA/size result verification, and a four-worker maximum.
- Sync evidence uses the existing deterministic Apps Script evidence-ingress client strictly serially. The Apps Script owner lock plus deterministic file-name lookup already reuses the Drive file after response loss, so no Apps Script source change was required.
- A clean success persists every remote item before one final `READY_TO_CONFIRM` draft mutation. There is no per-file Sheet mutation.
- A partial remote success persists only accumulated existing reference columns, `evidenceCount`, the safe binding hash, and `retentionState=PENDING_APPROVAL`; it remains `DRAFT`, leaves customer/input fields unbound, and returns `BOOKING_PREPARE_RETRY`.
- Exact retries reuse deterministic GCS objects or Drive files. Bytes/order/input/base-version changes fail with `BOOKING_PREPARE_CONFLICT` before another remote call.
- A lost final Sheet response performs one recovery read and returns the exact durable projection when present. If all remote evidence exists but the final draft mutation did not persist, it records the references as non-ready partial state for a safe retry.
- Cancelled and expired drafts keep existing references pending approval and perform no upload, delete, or draft mutation.
- Refactored evidence-ingress identity construction into one shared helper so the envelope writer and prepare orchestration cannot drift, without changing the signed wire contract.

## TDD evidence

RED was observed before production changes:

- The new focused prepare suite failed at import because `server/pmc-mini-app/bookingPrepare.ts` did not exist.
- A later staged-upload identity assertion failed against the sync/Base64 identity before the GCS raw-content deterministic ID was added.

GREEN evidence:

- Focused prepare plus Apps Script evidence ingress: **2 files, 15 tests passed**.
- Affected persistence/parser/store/evidence selection: **11 files, 161 tests passed**.
- Full Mini App suite: **71 files, 957 tests passed**.
- Full Apps Script Booking suite: **48 files, 672 tests passed**.
- Full repository suite with stable single-worker scheduling: **182 files, 2,473 tests passed**. The default highly parallel run first exposed only an unrelated OCR build test timing out at its fixed 20-second limit; that test passed **2/2** in isolation before the complete single-worker run passed.
- `npm run booking:typecheck`: passed.
- `npm run build:server`: passed.
- `npm run booking:build`: passed.
- `npm run build:mini-app`: passed.
- Touched-path ESLint: passed with zero findings.
- `git diff --check`: passed.

## Recovery and safety coverage

- Exact success retry and lost-response recovery return the same ordered references without another remote write.
- Changed payment bytes, evidence order, normalized booking input, and base version conflict before remote persistence.
- Async staging never exceeds four active puts and preserves payment/chat order despite out-of-order completion.
- Sync Apps Script ingress never exceeds one active upload; a partial retry reuses deterministic Drive files and creates no duplicate.
- Partial async/sync failures never set `READY_TO_CONFIRM`, never bind customer input, and retain evidence for owner approval.
- Cancellation/expiry leaves retained evidence unchanged and idempotently blocks further prepare persistence.
- Errors and code paths add no logs and include no evidence bytes, identifiers, URLs, LINE tokens, or customer/business values.

## Deferred boundaries

Task 4 still owns route registration, one-request handler wiring, authenticated/config snapshot reuse, capability `prepare=true`, error-to-HTTP mapping, and the Wizard switch. Confirm performance, telemetry, deployment, live traffic, and all-staff async expansion remain deferred.

---

## Fix round 1 — Recovery binding and terminal-retention races

The first review found two stale-version races. Both were reproduced with deferred concurrent tests before production changes:

- Three A/B variants (different normalized input, evidence bytes, and evidence order) returned `BOOKING_PREPARE_RETRY` and allowed a stale caller to replace the first durable partial binding.
- Cancellation during async staging and expiry after sync Drive persistence left the terminal row at zero references even though remote evidence was durable.

The recovery path now classifies the reread before any mutation. Null binding may be claimed only with compatible references; the same binding converges a canonical union without dropping prior references; any different non-null binding or different ready projection returns `BOOKING_PREPARE_CONFLICT` and performs no recovery mutation or remote retry. The binding continues to include the original base version, so changed-version recovery conflicts before another remote call.

Added `retainTerminalPrepareEvidence(...)` as a narrowly scoped store operation. It:

- accepts only exact draft/kind-bound staged-object keys or valid Drive file IDs;
- rereads the terminal row and fences by persisted version plus prepare binding;
- preserves `CANCELLED`/`EXPIRED` state and every booking/business field;
- atomically writes only canonical references, count, the same binding, `PENDING_APPROVAL`, timestamp, and version in one row update;
- read-attests the durable row, recovers a lost Sheet response, makes exact same-binding retries no-op, and rejects another binding;
- returns stale for a same-binding concurrent partial that requires caller reread/remerge rather than guessing object order.

Fix-round GREEN evidence before the complete verification gate:

- Focused prepare/store/Apps Script evidence ingress: **3 files, 80 tests passed**.
- Affected persistence/parser/store/evidence selection: **11 files, 171 tests passed**.
- `npm run build:server`: passed.
- `npm run booking:typecheck`: passed.
- Touched-path ESLint and `git diff --check`: passed.

Complete fix-round verification:

- Full Mini App suite: **71 files, 967 tests passed**.
- Full Apps Script Booking suite: **48 files, 672 tests passed**.
- `npm run build:server`: passed.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- `npm run build:mini-app`: passed.
