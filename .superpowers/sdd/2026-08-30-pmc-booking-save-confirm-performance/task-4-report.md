# Task 4 Report — Combined prepare route and one-request client flow

## Status

Implemented locally on base `ecfe74c`. No deployment, live request, external evidence upload, Google Sheet mutation, Apps Script push, queue/property change, or async-owner allowlist expansion was performed.

## Implementation

- Added strict `PMC_BOOKING_PREPARE_ENABLED` parsing. Missing or exact `false` keeps prepare disabled; exact `true` is accepted only with protocol minimum 2. Unknown or blank values fail closed.
- Registered exact protocol-2 `POST /api/mini-app/booking-drafts/:draftId/prepare` only while the authenticated capability advertises `prepare=true`.
- The route applies the existing maintenance barrier before authentication/body work, then authenticates the LINE recorder once, reads the owned draft once, checks the required persistence dependency, reads one active Booking-config snapshot, and consumes one bounded multipart body.
- The route passes the immutable draft/config/parser snapshot to the reviewed Task-3 persistence orchestration. Normal trusted success performs owner `PREPARE_BEGIN`, evidence persistence, and owner `PREPARE_READY`, with no direct Cloud Run Sheet write and no post-mutation Sheet reread.
- Async-owner requests use the existing private staging store. Every other Booking recorder uses the deterministic Apps Script evidence ingress, while every runtime now constructs the sibling draft-state ingress independently of async Cloud Tasks configuration.
- Protocol-2 `CANCEL` uses owner-lock `CANCEL`. Exact owner results are digest-validated; response loss performs one authoritative Sheet reread and a single bounded no-effect resend only when the reread proves no mutation occurred. No direct `store.updateDraft` cancellation is reachable when prepare is enabled.
- When prepare is enabled, new protocol-2 legacy PATCH, single-evidence, and evidence-batch writers return persistent `CLIENT_UPGRADE_REQUIRED` before config, upload, or Sheet mutation. Exact stale PATCH recovery can still return the already durable prepared projection. Protocol-1/prepare-disabled bridge behavior is unchanged.
- The Booking Wizard selects the combined path only from authenticated `bookingProtocol.prepare=true`; it never probes. One request sends the canonical P2 input plus every payment/chat file, advances using the returned durable projection, preserves attribution snapshots and evidence counts, and uses an immediate in-flight fence against double submission.
- `prepare=false` keeps the exact existing batch/single-upload plus PATCH fallback path.

## Modern web guidance applied

Before client changes, the mandatory current forms guidance was retrieved and applied: semantic form submission remains intact, the valid submission is disabled/in-flight fenced only after submit, dynamic failures keep `role=alert`, and the existing mobile-sized controls/evidence inputs remain native and accessible.

## TDD evidence

RED was observed before production changes:

- Strict prepare flag tests failed because the server always projected `prepare=false` and accepted blank values.
- Route tests returned `MINI_APP_ROUTE_NOT_FOUND` because the prepare route was not registered.
- The Wizard reached review through legacy upload/PATCH and never called `prepare`.

GREEN evidence:

- Focused prepare/config/Wizard/API tests: **4 files, 102 tests passed**.
- Focused route/owner/fencing tests after cancellation and legacy-writer coverage: **1 file, 30 tests passed**.
- Latest affected prepare/parser/evidence/Wizard/API/config/cancel/pause gate: **10 files, 221 tests passed**.
- Full Mini App suite: **72 files, 989 tests passed**.
- Full Apps Script Booking suite: **49 files, 684 tests passed**.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- `npm run build:server`: passed.
- `npm run build:mini-app`: passed.
- Full `npm run build`: passed.
- Full `npm run lint`: zero errors; one pre-existing generated `dist-server` unused-disable warning only.
- `git diff --check`: passed.

## Safety and recovery coverage

- Sync and async route successes each prove one staff read, one owned-draft read, one config read, owner operations `PREPARE_BEGIN → PREPARE_READY`, and zero direct Sheet writes.
- Capability false returns 404 without authentication, draft read, multipart parsing, or evidence ingress.
- Maintenance mode returns 503 before authentication, draft read, multipart parsing, or evidence ingress.
- Lost P2 cancellation response recovers from one authoritative reread with one owner mutation and zero direct writes.
- New P2 legacy PATCH/evidence/evidence-batch calls are blocked before config, evidence ingress, or direct Sheet effects.
- Existing Task-2 parser suites retain exact file/count/MIME/magic/decoded/raw-body bounds and stopped-stream behavior.
- Existing Task-3 suites retain deterministic exact retry, partial recovery, terminal retention, binding conflicts, and owner projection-digest validation.

## Deferred boundaries

Task 5 still owns the confirm queue-result fast path and synchronous confirm owner fencing. Task 6 still owns privacy-safe performance telemetry and measurement harnesses. No all-staff async expansion, production flag change, live canary, deploy, or external mutation is included here.

---

## Fix round 1 — config-stable reservation and Android reload recovery

The first review found three recovery gaps. Each was reproduced before production changes:

- Apps Script `PREPARE_BEGIN` stored only the binding hash, while READY/PARTIAL re-resolved mutable config. Async READY and sync PARTIAL both failed after staff/doctor/service/channel configuration changed.
- A Wizard holding the original version after BEGIN/partial/READY response loss could not cancel because its request failed before reaching the owner lock.
- `/active` remained hidden from synchronous recorders, so reopening Android/LINE after a lost READY response created another draft.

The owner reservation now persists the exact resolved recorder/Admin/AE ID/name snapshots atomically with only the binding, version and timestamp. It still writes no customer fields, doctor/service/channel IDs, evidence references/count, retention flag, or READY state. READY/PARTIAL and exact BEGIN replay reconstruct and verify the canonical binding from those reserved snapshots and the signed input/evidence manifest; they do not read mutable staff/doctor/service/channel configuration after remote persistence. Cloud Run validates the same reserved snapshots on ambiguous BEGIN recovery before allowing any remote write.

Wizard cancellation now has one bounded stale-version recovery: load the exact owned draft once, exit immediately if it is already CANCELLED/EXPIRED, or retry owner CANCEL exactly once with the authoritative version only for DRAFT/UPLOADING/READY/FAILED_RETRYABLE. A competing queue/processing state is never cancelled or reopened, and the Wizard never replaces its original prepare base/version during Save retry recovery.

The PII-free `/active` projection is now available to every authorized Booking recorder when prepare is enabled, while the prior async-owner gate remains for `prepare=false`. A synchronous READY draft is hydrated to the exact full owned projection and opens directly at review/confirm. A reserved/partial DRAFT is hydrated and offered for cancellation/restart rather than silently creating a second draft. The safe active response still omits input, customer/phone data, evidence IDs/object keys and every private reference.

Fix-round verification:

- Focused owner/prepare/route/Wizard/shell/session/API gate: **9 files, 227 tests passed**.
- Full Mini App suite: **72 files, 999 tests passed**.
- Full Apps Script Booking suite: **49 files, 686 tests passed**.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- `npm run build:server`: passed.
- `npm run build:mini-app`: passed.
- Full `npm run build`: passed.
- Full `npm run lint`: zero errors; one pre-existing generated `dist-server` unused-disable warning only.
- `git diff --check`: passed.

No deploy, live request, external evidence upload, Sheet/Apps Script push, queue/property mutation or allowlist expansion was performed.

---

## Fix round 2 — reserved retry parsing

The fix-round-1 re-review found that a later HTTP retry still ran the live-config parser before consulting the durable reservation. Exact READY and PARTIAL retries therefore conflicted after Admin/AE or doctor/service/channel config changed, even though the owner row already held the authoritative binding and attribution snapshots.

`persistPrepareEvidence(...)` now selects its parser before any live-config resolution:

- a null-binding DRAFT continues to use the full request-scoped active Booking config and therefore preserves all first-BEGIN authorization/eligibility checks;
- a row with a non-null reservation strictly parses the exact P2 input schema and canonical booking semantics using only persisted recorder/Admin/AE snapshots plus the submitted doctor/service/channel IDs;
- the reserved path recomputes the canonical binding from the persisted snapshots, exact normalized input, ordered evidence hashes/storage and original base version, then requires the exact stored binding before READY replay, remote reuse or owner finalization;
- forged recorder/Admin/AE name fields remain impossible because the multipart reader rejects every non-contract input key before persistence.

New async and sync tests cover exact READY response-loss retries and PARTIAL retries after Admin rename, AE removal and doctor/service/channel removal. READY returns the existing projection with zero remote or owner calls. PARTIAL deterministically reuses existing evidence and completes without duplicate remote objects/files. Changed customer input or evidence order still conflicts before new remote work. The existing controls continue to cover changed bytes, base version and competing binding.

Fix-round-2 verification:

- Focused prepare/parser/route/owner gate: **9 files, 233 tests passed**.
- Full Mini App suite: **72 files, 1,005 tests passed**.
- Full Apps Script Booking suite: **49 files, 686 tests passed**.
- `npm run booking:typecheck`, `npm run booking:build`, `npm run build:server`, `npm run build:mini-app`, and full `npm run build`: passed.
- Full `npm run lint`: zero errors; one pre-existing generated `dist-server` unused-disable warning only.
- `git diff --check`: passed.

No deployment, live/external request, evidence upload, Sheet mutation, Apps Script push, queue/property change or allowlist expansion was performed.

---

## Fix round 3 — conditional config read for reserved retries

Reserved retries no longer call `getActiveBookingConfig()` at the HTTP boundary. After authentication and the one owned-draft read, the prepare handler now distinguishes:

- an exact durable reservation with binding plus recorder/Admin/AE snapshots: skip config entirely, parse the bounded multipart once, and let the reserved persistence path verify syntax/canonical semantics and the stored binding;
- a null-binding draft: require exactly one active Booking-config read before multipart parsing, preserving the original first-BEGIN validation and fail-closed behavior;
- a non-null binding without complete reserved attribution: reject as `BOOKING_PREPARE_CONFLICT` before config, multipart, remote evidence or owner effects.

`PersistPrepareEvidenceInput.bookingContext` is now optional only at the type boundary. The unbound persistence branch still requires it and fails closed if absent, while the reserved branch constructs no live-config dependency.

New HTTP tests prove exact READY, PARTIAL and terminal same-binding retries continue while the config batch read is forced to throw. Each reserved retry records `configReads=0`; READY performs no additional remote or owner call, PARTIAL reuses the first Drive file and creates only the missing deterministic file, and terminal retry attaches every reference without reopening. A new unbound control still performs one config read and returns 503 before multipart/evidence/owner effects when that read fails. Existing normal-route tests continue to prove one config read on first prepare.

Fix-round-3 verification:

- Focused HTTP/prepare/parser/Wizard/owner gate: **9 files, 237 tests passed**.
- Full Mini App suite: **72 files, 1,009 tests passed**.
- Full Apps Script Booking suite: **49 files, 686 tests passed**.
- `npm run booking:typecheck`, `npm run booking:build`, `npm run build:server`, `npm run build:mini-app`, and full `npm run build`: passed.
- Full `npm run lint`: zero errors; one pre-existing generated `dist-server` unused-disable warning only.
- `git diff --check`: passed.

No deployment, live request, external evidence write, Sheet mutation, Apps Script push, queue/property change or allowlist expansion was performed.
