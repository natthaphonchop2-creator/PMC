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

---

## Fix round 2 — Owner-lock terminal retention

The second review proved that the round-1 direct Sheet operation was not a cross-instance CAS and that allowing null-binding drafts with existing references could rebind unverifiable legacy Drive files to different incoming bytes.

Both regressions were reproduced before the final implementation:

- A sync draft with `evidenceProjectionHash=null` and an existing legacy Drive ID incorrectly skipped the incoming payment upload and reached `READY_TO_CONFIRM`; the async legacy-object variant also reached ready.
- The signed client rejected `RETAIN_PREPARE`, and the Apps Script state-ingress domain rejected the operation before owner-lock mutation.

The final design restores the strict rule that any null-binding draft carrying a Drive or staged-object reference conflicts before a remote call or Sheet mutation. Same-binding partial recovery remains valid because references and binding are persisted atomically together.

Terminal reference attachment now uses the existing signed `MINI_APP_ASYNC_STATE` ingress with the exact `RETAIN_PREPARE` operation. Under the Apps Script script lock it:

- accepts only `CANCELLED`/`EXPIRED` rows and preserves terminal/business fields;
- requires null task, lease, error, Case and confirmation fields plus exact version/attempt sentinels;
- validates draft/kind object-key namespaces, bounded Drive IDs, counts and one storage mode;
- makes the first non-null prepare binding authoritative;
- canonical-unions same-binding disjoint reference subsets and updates `evidenceCount`/`PENDING_APPROVAL` in one owner-locked row mutation;
- returns an idempotent no-op for exact replay and rejects a different binding.

Cloud Run no longer exposes or calls `retainTerminalPrepareEvidence` on the direct Sheet store. It sends the signed owner mutation, then always performs an authoritative Sheet reread. A response lost after mutation is accepted only when the same binding and every submitted reference are attested; a request lost before mutation is reread as missing and retried under the same binding. The returned ingress body is never the retention authority.

Fix-round-2 verification:

- Focused prepare, signed client, Sheet-store baseline, evidence ingress and Apps Script owner-lock domain: **6 files, 115 tests passed**.
- Full Mini App suite: **71 files, 972 tests passed**.
- Full Apps Script Booking suite: **48 files, 681 tests passed**.
- `npm run build:server`: passed.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- `npm run build:mini-app`: passed.
- Touched-path ESLint and `git diff --check`: passed.

---

## Fix round 3 — Complete draft-state owner serialization

The architecture ruling supersedes the round-2 reuse of `MINI_APP_ASYNC_STATE`. Worker state v1 is restored byte-shape compatible and contains no prepare/cancel operation. The round-1 direct Sheet retention CAS and all Cloud Run `updateDraft` prepare writes remain removed.

Added the versioned sibling `MINI_APP_DRAFT_STATE v1` contract with exact discriminants:

- `PREPARE_READY`
- `PREPARE_PARTIAL`
- `CANCEL`

The shared contract defines the normalized protocol-2 booking input, ordinal evidence manifest, prepare-binding canonical form, draft-projection canonical form, signed envelope and safe result. Node and Apps Script hash the same canonical strings.

Apps Script now executes the complete read, validation, transition and row write inside the existing script lock. It recomputes the binding from the persisted recorder identity, active canonical config snapshots, exact normalized P2 input, original base version, ordered content hashes and typed evidence manifest. Partial mutations never bind booking/customer input; full same-binding mutations can promote the partial DRAFT to READY. Different bindings conflict. READY and CANCEL are serialized so only one transition wins; if cancellation already won, later prepare evidence is attached to the terminal row with `PENDING_APPROVAL` and the state is never reopened.

Cloud Run persists remote evidence first, then sends only the sibling owner mutation. `bookingPrepare` has a read-only Sheet store dependency and contains no `updateDraft` call. It validates the exact safe result and shared projection digest. Timeout, malformed response or digest ambiguity triggers exactly one authoritative reread; it resends once only when that reread proves no prepare mutation applied. Response loss after apply is accepted only by digest/reference attestation.

Round-3 TDD evidence:

- New client suite first failed because `draftStateIngressClient` did not exist.
- New Apps Script domain suite first failed because the sibling shared contract/domain did not exist.
- Existing clean-success and partial tests were changed to require zero direct Cloud Run Sheet writes and failed against the previous implementation before the refactor.

Round-3 verification:

- Focused sibling client/domain, prepare orchestration, legacy async-state v1, evidence and worker regressions: **8 files, 156 tests passed**.
- Full Mini App suite: **72 files, 975 tests passed**.
- Full Apps Script Booking suite: **49 files, 680 tests passed**.
- `npm run build:server`: passed.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- `npm run build:mini-app`: passed.
- Touched-path ESLint and `git diff --check`: passed.

No route was registered, no capability was enabled, no async allowlist changed, and no deploy, live upload, Sheet mutation or external production call was made. Task 4 still owns all-staff runtime wiring and switching P2 CANCEL to this owner ingress before advertising prepare.
