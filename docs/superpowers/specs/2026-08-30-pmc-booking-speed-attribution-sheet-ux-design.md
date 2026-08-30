# PMC Booking Mini App — Speed, Attribution, and Sheet UX Design

**Date:** 2026-08-30
**Status:** Approved for implementation planning
**Worktree:** `codex/pmc-booking-speed-sheet-ux`
**Systems:** LINE LIFF Mini App, Cloud Run, Google Sheets, Apps Script, Drive, Calendar, LINE Messaging API

## 1. Goal

Make the Booking Mini App materially faster at the two user-visible waits:

1. `ตรวจสอบข้อมูล` after evidence selection; and
2. `ยืนยันบันทึก` before the app returns Home.

At the same time, separate booking attribution into three explicit roles and reorganize the operational Google Sheet without changing its role as the source of truth.

## 2. Verified baseline

The design starts from live Cloud Run request logs from the preceding 24 hours and a clean local baseline.

- New isolated branch: `codex/pmc-booking-speed-sheet-ux` from `3caacb5`.
- Repository baseline: 2,145 tests passed; production builds passed; lint had zero errors and one pre-existing generated warning.
- Evidence batch `200`: p50 about 2.46 seconds, observed maximum about 9.72 seconds.
- Draft PATCH `200`: p50 about 2.46 seconds, observed maximum about 2.60 seconds.
- Legacy single-kind evidence `200`: observed about 10.81–17.57 seconds before the separate PATCH.
- Async confirm `202`: p50 about 7.44 seconds, observed maximum about 11.11 seconds.
- Confirm `200` includes synchronous downstream executions with observed tail latency about 35.89–38.34 seconds.
- Async booking is enabled for one configured staff ID only; other staff retain the synchronous path.
- Mini App production bundle is about 463 KB minified / 128 KB gzip. This is a secondary startup/INP concern, not the primary Save/Confirm network wait.
- Live workbook has 28 visible tabs, almost no filters/conditional formatting, and only basic header freezing.

## 3. Non-goals

- Do not acknowledge a booking before its queue state is durably persisted.
- Do not remove payload hashes, versions, locks, idempotency, retries, or evidence validation.
- Do not enable async confirmation for all staff before worker throughput is proven.
- Do not rename managed tabs, reorder managed columns without a guarded migration, or change source-of-truth ownership.
- Do not delete raw, cache, audit, Stock, JERA, or configuration data to make the Sheet look simpler.
- Do not log evidence bytes, customer content, phone numbers, LINE tokens, Google IDs, or secret values.

## 4. User-visible attribution model

The Booking form and persisted booking record have three distinct roles.

| Display label | Authority/source | Editable per booking | Stored identity | Commission meaning |
| --- | --- | --- | --- | --- |
| `ผู้บันทึก` | Verified LINE account mapped to `CONFIG_STAFF` | No | recorder ID + recorder name | Audit only |
| `Admin` | Required form dropdown | Yes | Admin ID + server-resolved name snapshot | Existing Admin attribution |
| `AE` | Form dropdown | Yes | AE ID + server-resolved name snapshot or `ไม่ระบุ` | Existing AE attribution |

### 4.1 Choice rules

- `ผู้บันทึก` displays the staff name selected during first LINE enrollment and is read-only.
- `Admin` uses the same `CONFIG_STAFF` rows as AE (`active = true` and `canBeAe = true`), in the same order, excluding `ไม่ระบุ`; it is required. This is an intentional attribution-policy change: selected Admin does not need `canCloseBooking`.
- `AE` uses those same active `canBeAe` rows and permits `ไม่ระบุ`.
- Dropdowns display names but submit immutable staff IDs. The server resolves and snapshots names; browser-supplied names are rejected.
- Authenticated Mini App config returns `admins: Array<{id,name}>` and `aes: Array<{id,name}>` from the same eligible rows; the AE control adds a client/server `null` choice rendered as `ไม่ระบุ`.
- Selecting an Admin or AE never grants that person's Mini App permissions. Authorization remains bound to the verified recorder's LINE identity.
- `canCloseBooking` remains required for the recorder who operates Booking. Commission and call ownership use the selected Admin/AE IDs. Recorder identity is not a commission role.
- Google Form Admin choices are updated to this same active `canBeAe` set so Form and Mini App follow one attribution policy.

### 4.2 UI order

Booking step 1 renders:

1. `ผู้บันทึก` — disabled/read-only recorder name;
2. `Admin` — required dropdown;
3. `AE` — dropdown including `ไม่ระบุ`;
4. customer identity and phone fields.

Preview, Calendar description, internal LINE booking card, `BOOKING_MASTER`, and attribution/commission reports show role order `ผู้บันทึก → Admin → AE`. The compact derived Dashboard keeps its existing Admin/AE operation columns in this release; recorder detail remains available in `BOOKING_MASTER` and dedicated reports.

## 5. Attribution data model

### 5.1 `MINI_APP_REQUESTS`

Keep `staffId` as the immutable authorization-bound recorder ID. Add:

- `protocolVersion` — exact request-row protocol version (`1` for normalized legacy rows, `2` for new rows);
- `recorderName` — snapshot of the mapped staff name when the draft is created;
- `adminId` and `adminName` — selected Admin ID and server-resolved name snapshot;
- `aeId` — selected AE ID or null; retain `aeName` as the server-resolved snapshot.

Insert both columns directly after `staffId`, giving the relevant prefix:

`requestId → draftId → protocolVersion → staffId → recorderName → adminId → adminName → lineUserIdHash → ... → aeId → aeName → ...`

`BookingDraftInput` accepts required `adminId` and nullable `aeId`, never Admin/AE names. Add both IDs plus server-resolved snapshots to the signed booking identity, async payload hash, ingress payload, recovery comparisons, and idempotency tests. `recorderName`, `adminName`, and `aeName` are server-derived and must never be accepted from the browser.

### 5.2 `BOOKING_MASTER`

Insert after `formResponseId`:

- `recorderId` — nullable for non-LINE legacy sources;
- `recorderName` — display snapshot;
- `recorderSource` — `VERIFIED_LINE`, `LEGACY_ASSUMED_ADMIN`, `FORM_EMAIL_MATCH`, or `FORM_UNRESOLVED`.

Existing `adminId/adminName` become only the selected Admin. Existing `aeId/aeName` retain their meaning.

The final relevant order is:

`caseId → version → status → formResponseId → recorderId → recorderName → recorderSource → adminId → adminName → ... → aeId → aeName`

### 5.3 Fallback Google Form

- Existing Admin/AE questions remain unchanged.
- If submitter email resolves to exactly one active staff row, populate recorder ID/name with `recorderSource = FORM_EMAIL_MATCH`.
- Otherwise use `recorderId = null`, `recorderName = Google Form`, and `recorderSource = FORM_UNRESOLVED`; retain submitter email for audit.
- Standard Google Forms submits choice text, so Form Admin/AE continue to submit exact display names. Form sync requires active eligible names to be unique, and Apps Script resolves each exact unique name to a stable ID before persistence. Duplicate eligible names block sync/cutover.

### 5.4 Migration and active drafts

Before any live write:

1. create a private native Spreadsheet backup;
2. require exact existing headers and bounded row counts;
3. insert the new columns atomically and preserve formatting/validation;
4. read back exact headers and unchanged non-target values.

Because Google Sheets column insertion is not transactional, apply also uses one durable Script-Property manifest with `PREPARED`, `COMPLETE`, and `RESTORE_REQUIRED` states. The manifest binds the source fingerprint, verified native-backup identity, one immutable queue-attestation digest, and exact expected target/readback hashes. It is written as `PREPARED` after backup verification and before the first Sheet mutation, then changed to `COMPLETE` only after exact readback. Any rerun that sees `PREPARED`, `RESTORE_REQUIRED`, or an unmanifested non-empty target schema fails closed with a sanitized restore-required result; it never reports a generic idempotent success. Automatic repair/rollback is intentionally out of scope for this release.

Queue state and task count come from one exact, SHA-256-bound attestation JSON read per preflight, never from separate mutable properties. Preservation verification uses normalized Sheets v4 metadata for non-target cell formats, validation, notes/rich text, row/column dimensions and hidden state, frozen/grid settings, merges, filters/filter views, banding, and conditional-format rules. Unsupported over-grid objects are rejected before backup/write and deferred to the later Sheet-UX maintenance plan.

Backfill rules:

- Existing confirmed/cancelled Mini App requests: recorder comes from the old `staffId`; backfill `adminId = old staffId`, resolve recorder/Admin name from that exact ID, and resolve `aeId` from the exact unique old AE name for historical compatibility.
- Existing `BOOKING_MASTER` Mini App rows: correlate to historical `MINI_APP_REQUESTS.staffId`. A unique exact correlation uses `VERIFIED_LINE`. If correlation is impossible, copy old Admin ID/name into recorder ID/name with `LEGACY_ASSUMED_ADMIN`, never `VERIFIED_LINE`.
- If any nonterminal legacy draft exists, live migration stops before write. Staff must complete/cancel it or reopen on version 2 and start a new draft; migration never silently invents its Admin.
- Legacy Form rows use the fallback resolution in section 5.3.

### 5.5 Rolling compatibility and cutover

Use booking protocol version 2. The server exposes the supported/minimum version in authenticated config. The deployable client is dual-mode during cutover: when `minimumMutation` is absent or 1 it preserves the exact protocol-1 request shapes and legacy attribution UI while already containing the persistent upgrade handler; when `minimumMutation` is 2 it exposes the new three-role UI and sends version 2 on create, prepare, save, confirm, and cancel.

Deployment order is mandatory:

1. deploy backward-compatible Cloud Run and Apps Script readers that accept both old and new Sheet headers/rows and retain current protocol-1 behavior;
2. deploy the dual-mode client while the minimum is 1, require staff to close/reopen LINE once, and verify it still emits exact protocol-1 mutations but already contains the persistent upgrade handler;
3. wait until there are zero nonterminal legacy drafts and zero active Cloud Tasks; do not reinterpret an in-flight draft;
4. deploy a maintenance revision with an exact fail-closed Booking write barrier, route 100% of traffic to it, pause Cloud Tasks, and verify both barriers before creating a private Sheet backup or running migration; the barrier blocks create/save/cancel/confirm and every evidence write before body parsing or external effects;
5. run the guarded schema/backfill migration, deploy the minimum-2 revision while the Booking write barrier remains active, and verify 100% serving traffic before resuming writes/tasks;
6. freshly opened clients read minimum 2 and use the version-2 UI/protocol; an already-open bridge client that still attempts protocol 1 receives `CLIENT_UPGRADE_REQUIRED` and instructs the user to close/reopen LINE;
7. keep protocol-1 read/idempotent terminal recovery until the active-draft TTL has elapsed, then remove it in a later release. A pre-bridge page cannot acquire new UI code retroactively, so the maintenance gate must verify the bridge deployment and staff refresh before migration.

Strict readers must fail closed on unknown headers but explicitly normalize both the exact legacy and exact version-2 schemas during the rolling window. Both deployment directions require tests.

## 6. Save-path performance design

### 6.1 Problem

The current critical path authenticates and reads Sheets for evidence upload, waits for remote evidence storage, then authenticates and reads Sheets again for a separate PATCH. Non-async staff also probe an unavailable batch route before falling back to slower evidence endpoints.

### 6.2 Combined prepare endpoint

Add:

`POST /api/mini-app/booking-drafts/:draftId/prepare`

It accepts one bounded multipart request containing:

- one exact JSON `input` part;
- 1–10 payment images;
- 1–10 chat images;
- the expected draft version.

Limits remain compatible with the current Booking contract:

- MIME: JPEG or PNG with matching magic bytes;
- maximum 10,000,000 decoded bytes per file;
- maximum 10 files per kind and 20 total;
- maximum 25,000,000 decoded bytes across all files;
- maximum raw multipart request size of 26,000,000 bytes;
- reject oversized `Content-Length` before reading, and enforce the same raw limit for chunked requests while stopping/unpiping the stream;
- buffer no more than the bounded request contract; async GCS staging uses at most four concurrent writes, synchronous Apps Script evidence ingress remains serialized by its owner lock;
- prepare request timeout remains bounded by the existing server/ingress ceilings and must return a safe retryable code rather than an ambiguous success.

The handler:

1. verifies LINE identity and recorder authorization once;
2. reads the owned draft once;
3. reads active Admin/AE/doctor/service/channel configuration once;
4. validates input and all evidence before mutation;
5. persists evidence using the configured safe path;
6. writes one final `READY_TO_CONFIRM` draft mutation containing evidence references and booking input.

For async-enabled staff, evidence is staged in private GCS with existing generation/hash/CRC checks. For synchronous staff, the handler uses deterministic Apps Script evidence ingress and accumulates file IDs before one final Sheet draft update. It must not perform a Sheet draft write after every file.

The current evidence and PATCH routes remain during rollout for idempotent recovery and older cached clients. Client capability comes from authenticated config; the browser must not intentionally probe a known-unavailable route.

### 6.3 Failure semantics

- No input mutation occurs until every required evidence item is durably stored.
- Deterministic upload IDs make response-loss retry safe.
- A retry with identical version/input/evidence returns the persisted projection.
- A different payload with the same request/draft identity returns conflict.
- If remote evidence persistence partially succeeds, write a failure-only draft patch containing only the deterministic persisted evidence references and `retentionState = PENDING_APPROVAL`; never set `READY_TO_CONFIRM`. Exact retry reuses those references. Cancellation/expiry feeds the existing retention approval workflow, whose owner is Apps Script daily operations. Cleanup retry is idempotent by draft ID, evidence kind, and deterministic upload ID.

## 7. Confirm-path performance design

### 7.1 Preserve durability boundary

Async confirmation still requires:

1. deterministic Cloud Task creation; and
2. durable Apps Script `QUEUE` mutation.

The UI cannot show success before both are known or recovered idempotently.

### 7.2 Remove avoidable authoritative reread

`AsyncStateIngressPort.mutate()` already returns a signed, validated persisted state projection. On exact `APPLIED` or `IDEMPOTENT` queue results:

- bind the locally returned deterministic task name and payload hash before calling state ingress;
- `APPLIED` is accepted only when state is `QUEUED`, version equals base version + 1, and attempt count is unchanged;
- `IDEMPOTENT` is accepted when request/draft IDs and payload bindings match and the state is `QUEUED`, `PROCESSING`, or `RETRYING`; `QUEUED` requires version base + 1 and unchanged attempt, while processing/retrying requires version at least base + 2 and attempt count in the valid worker range;
- use the actual returned state/version/attempt in the safe projection rather than claiming `QUEUED` after a worker has already claimed it;
- terminal outcomes return only an exact valid terminal projection; `BUSY`, unknown state/version, missing binding, or impossible attempt falls back to authoritative reread;
- construct the safe response from the trusted current draft, local task binding, and validated ingress result;
- return `202` without an additional full `MINI_APP_REQUESTS` Sheet reread.

If the state-ingress call times out, returns an uncertain result, or fails validation, retain the existing Sheet reread recovery path. This preserves response-loss safety.

### 7.3 Request-scoped authentication/config snapshot

Continue verifying the LINE ID token and active recorder mapping on every mutation request. Do not cache authorization-bound staff identity across requests.

Within one prepare request, perform one bounded `batchGet` for the exact staff/doctor/service/channel ranges and reuse that immutable request-scoped snapshot for recorder, Admin, AE, doctor, service, and channel validation. Confirm does not reread booking configuration because the prepared payload is already hash-bound; it still verifies LINE identity, active recorder mapping, draft ownership, version, and payload hash.

Cross-request caching is limited to non-authoritative display data and is not part of this release. A deactivated/unlinked recorder therefore fails on the next request without a cache revocation window.

## 8. Background worker phase and all-staff async rollout

All-staff async is a separate release gate.

Before expanding the allowlist:

1. batch or otherwise reduce the current per-file Apps Script evidence projection round trips;
2. retain deterministic file identity, hash checks, lease fencing, and partial-recovery behavior;
3. run concurrency tests against the one-worker queue and realistic evidence sets;
4. prove no duplicate Drive files, bookings, Calendar events, LINE messages, or commissions;
5. meet the accepted worker completion and queue-backlog budgets.

Do not remove the existing two-second task schedule offset merely to improve HTTP acknowledgement; it protects worker/state ordering and does not itself block task creation response.

## 9. Performance observability and budgets

Add allowlisted millisecond timings only:

- client: prepare request, confirm request, navigation-to-preview, navigation-to-Home;
- server: LINE verification, staff/config snapshot, draft read, multipart parse, evidence persistence, draft write, task enqueue, state ingress, recovery reread;
- worker: claim, evidence projection, booking ingress, completion mutation.

Allowed context is route/action, status, state, file count, attempt, and elapsed milliseconds. Do not log evidence byte size or business/customer fields.

Performance acceptance uses at least 30 successful runs per path after one discarded warm-up, plus a five-client concurrent run. Record revision, UTC/Asia-Bangkok timestamps, route/status, timing boundaries, fixture, and aggregate output in the rollout evidence directory.

Fixtures:

- typical: one 500 KB JPEG payment image plus one 500 KB JPEG chat image;
- medium: five 2 MB JPEG images split across both kinds, within the 25 MB total contract;
- maximum-count: 10 payment plus 10 chat JPEG/PNG images with total decoded bytes at or below 25 MB;
- failure fixtures: missing Content-Length chunked overflow, invalid magic/MIME, partial persistence failure, response loss, and five concurrent clients.

Timing boundaries:

- client prepare: button click through validated preview render, including upload transfer;
- server prepare overhead: multipart parse completion through response write, excluding client network upload;
- client confirm: confirm click through Home navigation/terminal error;
- server confirm: handler entry through `202`/terminal response.

Initial acceptance budgets under a warm instance and typical fixture:

- async prepare server overhead after multipart parse: p95 ≤ 3 seconds;
- synchronous prepare removes the extra unavailable-route probe and separate PATCH/auth/config cycle, and reduces median server processing time by at least 30% from its measured legacy baseline; Apps Script Drive persistence remains part of that path until all-staff async rollout;
- async confirm tap-to-`202`: p95 ≤ 6 seconds;
- no additional unavailable-route probe;
- zero unavailable-route probes in all 30 runs;
- maximum-count fixture completes within existing request/ingress ceilings without memory-limit or partial-commit failure;
- no regression in idempotency, authorization, retry, or recovery tests.

Live mobile timing is reported separately from server overhead because cellular upload speed is not controlled by the application.

## 10. Mini App bundle and interaction work

After network-path work, measure Android INP attribution. If parsing or interaction work is material:

- split Stock, Reports, Finance, and Expense views with `React.lazy`/dynamic import;
- keep Home and Booking in the initial bundle;
- preserve a deterministic loading state and error boundary for each lazy route;
- do not add a service worker for POST caching.

This is a secondary optimization and does not substitute for backend latency reduction.

## 11. Google Sheet operational UX

### 11.1 Functional correction

Dashboard refresh currently clears `A1:G1000` but writes operation data through column H. Clear `A1:H{clearEndRow}`, where `clearEndRow` is the maximum of 1,000, the current sheet `getLastRow()`, and the final row required by the new snapshot. Add a regression with more than 1,000 prior operation rows followed by a short/zero snapshot and prove no stale values remain anywhere in A:H.

### 11.2 Visible tab order

Keep visible, in this order:

1. `DASHBOARD`
2. `BOOKING_MASTER`
3. `CALL_QUEUE`
4. `RECONCILIATION`
5. `RETENTION_QUEUE`
6. `CONFIG_ADMINS`
7. `CONFIG_STAFF`
8. `CONFIG_DOCTORS`
9. `CONFIG_SERVICES`
10. `CONFIG_CHANNELS`
11. `CONFIG_RULES`

Hide by default, without deletion or renaming:

- Form/raw/import: `FORM_RESPONSES`, `JERA_IMPORT_RAW`, `JERA_IMPORT_FILES`, `FORM_RESPONSE_MAP`;
- recovery/audit: `RETRY_QUEUE`, `AUDIT_LOG`, `CONFIG_LINE_DIRECTORY`, `LINE_INGRESS_NONCES`, `SYSTEM_SEQUENCES`;
- Mini App/cache: `MINI_APP_REQUESTS`, `MINI_APP_LINK_ATTEMPTS`, all `JERA_*CACHE`, `JERA_SYNC_*`, payment-detail/allocation system tabs;
- Stock system tabs when the workbook is used as the Booking operator surface.

Hiding is presentation only, never an access-control claim.

### 11.3 Formatting

Implement one idempotent Apps Script workbook-presentation workflow with exact-header preconditions.

- Use native white grid, black text, light gray headers, and subtle borders.
- Freeze header row on managed data tabs.
- Freeze columns A:C on `BOOKING_MASTER`; A:B on `CALL_QUEUE`.
- Do not add a basic filter to `DASHBOARD`, which has two header regions. Apply one basic filter to the full managed grid range of `BOOKING_MASTER`, `CALL_QUEUE`, `RECONCILIATION`, and `RETENTION_QUEUE`, starting at row 1 and ending at the sheet grid row count so new rows remain covered.
- Use targeted widths and wrapping; never workbook-wide autofit.
- Use conditional formatting only for actionable status cells.
- Apply currency formats to deposit/revenue/commission numeric cells.
- Keep IDs, hashes, phone strings, external IDs, and JSON as plain text.
- Do not insert title rows into managed tabs.
- Do not add heavy formatting rules to cache/raw tabs.

Before write, fail if an operator tab has an unexpected basic filter, filter view, protected range, merged cell, or header. The workflow may replace only its own exact basic-filter range; it must not add, remove, or update protections, validations, formulas, or filter views. It creates a private backup, applies presentation-only requests atomically where possible, and verifies exact headers, value/formula hashes, validations, protections, order, hidden state, filters, frozen panes, and widths afterward.

## 12. Rollout sequence

1. Local tests and performance instrumentation only.
2. Attribution schema + guarded migration tests.
3. Combined prepare endpoint and compatible client.
4. Async confirm reread fast path with uncertainty fallback.
5. Dashboard clear defect and workbook presentation workflow.
6. Private Sheet backup and owner-approved live presentation migration.
7. Cloud Run 0%-traffic canary, synthetic no-PII probes, then owner-only traffic.
8. Real owner Save/Confirm timing review.
9. Worker evidence optimization and concurrency proof.
10. Separate approval before all-staff async expansion.

## 13. Verification matrix

### Attribution

- Recorder cannot be changed in browser payload.
- Admin ID is required and resolved from the same active `canBeAe` ID set as AE, excluding `ไม่ระบุ`; browser-supplied names are rejected.
- AE ID remains optional through `ไม่ระบุ`; names are server snapshots.
- Duplicate display names remain unambiguous because IDs are canonical; renamed or inactive selections fail or resolve according to the current exact ID and version rules.
- Draft, payload hash, ingress, Sheet, Calendar, Flex, audit, call owner, and commission attribution agree.
- Existing records and drafts converge under migration/backfill rules.
- Protocol-1/2 rolling-deploy tests cover both legacy-reader/new-writer and new-reader/legacy-writer order, cached-client rejection, and no-active-draft migration gate.

### Save

- One prepare request for new clients.
- Multi-image payment/chat order and counts preserved.
- Exact retry returns the same projection.
- Changed retry conflicts.
- Partial evidence failure leaves no ready-to-confirm draft.
- Android response-loss recovery remains usable.

### Confirm

- Exact state-ingress success avoids Sheet reread.
- Timeout/invalid response performs authoritative reread.
- Task already-exists remains idempotent.
- No acknowledgement before durable queued state.
- Synchronous fallback behavior remains correct until async rollout.

### Sheet

- Dashboard H is cleared on every refresh.
- Managed headers and data values remain exact.
- Operator tab order/hidden state/freeze/filter/widths match the design.
- Raw/cache/system values, formulas, validations, and protections remain unchanged.
- Native visual QA uses the clinic owner account in the in-app browser at 1280×720 and 100% Sheet zoom, with screenshots saved under the rollout evidence directory.
- `DASHBOARD`: KPI labels/zero-or-current values are fully visible, A13:H header is not clipped, and no stale H values appear below the last operation.
- `BOOKING_MASTER`: row 1 and columns A:C remain frozen; required operator columns are readable without header overlap; the basic filter covers the exact managed grid width.
- `CALL_QUEUE`: row 1 and A:B remain frozen; status/next-call fields are visible; note wraps within the target width.
- `RECONCILIATION`: OPEN/resolved status formatting is visible; candidate/reason wraps without covering adjacent cells.
- Verify the same metadata and value hashes through Sheets API; screenshots are operator QA evidence, not the sole automated pass criterion.

## 14. Rollback

- Code rollout uses immutable Cloud Run and Apps Script versions; keep the prior production revisions deployable.
- Sheet migration requires a private native copy before column or presentation changes.
- Restore the prior Sheet copy only during a controlled maintenance window after queue/task checks.
- Do not roll back by deleting new recorder columns while new-version rows exist; deploy backward-compatible readers first.
- Hidden/order/format changes can be reversed independently without touching booking values.
