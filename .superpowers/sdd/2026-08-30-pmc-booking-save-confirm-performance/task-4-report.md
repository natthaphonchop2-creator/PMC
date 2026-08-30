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
