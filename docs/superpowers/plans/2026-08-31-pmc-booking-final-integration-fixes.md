# PMC Booking Final Integration Fixes Plan

**Goal:** Close the four Important blockers from the overall Attribution + Performance + Sheet UX review without performing any live deployment, migration, cleanup, or workbook apply.

**Base:** `d503d03`

## Global constraints

- Preserve exact P1 rolling compatibility; new prepare/worker evidence uses versioned V2 identity.
- No automatic evidence deletion. Discovery/expiry/reconciliation may run daily; approval and cleanup are separate owner actions.
- No live Apps Script push, Cloud Run deploy, Sheet migration/presentation apply, Drive/GCS deletion, queue/property mutation, browser, or external call.
- Never emit resource IDs, object keys, filenames, hashes, principals, URLs, customer data, or secrets in owner previews/logs/audits.
- Existing owner-lock and maintenance barriers remain authoritative.

### Task 1 — Ordinal-bound evidence identity

- Add one shared slot identity: requestId, draftId, kind, zero-based ordinal, MIME, raw content SHA-256.
- V2 upload IDs, GCS keys, Drive filenames/markers and cleanup descriptors include ordinal. Identical bytes at different ordinals remain distinct; exact slot retry remains stable.
- Apps Script evidence ingress accepts exact V1/V2 during rollout; prepare/worker emits V2.
- GCS metadata/read/delete validation binds the exact slot. Keep legacy object-key reader support for existing P1 rows.
- Test sync/async prepare→confirm with identical same-kind bytes, response loss, partial failure, worker projection, cleanup descriptor validation.
- Commit: `fix: bind Booking evidence identity to ordinal`.

### Task 2 — Typed draft-evidence retention lifecycle

- Extend `RETENTION_QUEUE` to a typed V2 schema supporting CASE_FOLDER and DRAFT_EVIDENCE manifests, digests, approval/cleanup lifecycle, leases, safe errors and versions.
- Add exact bounded manifest types (<=20 resources, <=32KB), dual V1/V2 readers, pure guarded V1 migration joining case rows to BOOKING_MASTER.driveFolderId, and fail closed on ambiguity.
- PREPARE_PARTIAL/READY/CANCEL/EXPIRE/CONFIRM and async completion reconcile one deterministic batch per draft under the Apps Script owner lock. Response loss/replay repairs without duplicates.
- Daily operations may discover/repair/expire stale drafts from explicit `MINI_APP_DRAFT_TTL_HOURS`; never delete.
- Test migration, lifecycle, TTL, response loss, manifest growth invalidating approval, and no-auto-delete.
- Commit: `feat: track Booking draft evidence retention`.

### Task 3 — Owner-approved cleanup executor

- Add owner-only preview, approve, execute and readback functions. Approver comes from Session effective user; preview is count/status/digest only.
- Approval validates terminal CANCELLED/EXPIRED request + matching manifest and has no storage side effect.
- Execute claims CLEANING under lock, preflights all resources, then cleans exact GCS descriptors through a signed Cloud Run route and exact loose Drive files through Apps Script. Moved/promoted evidence is rejected.
- GCS/Drive response loss and Sheet completion failure are idempotently recoverable; no scheduled retry/automatic delete.
- Sanitize results/audits/runbook; add build footer/trigger absence and local-only tests.
- Commit: `feat: add owner-approved Booking evidence cleanup`.

### Task 4 — Cross-plan manifest and fail-fast deploy runner

- After attribution manifest COMPLETE, re-entry validates exact headers, value/non-target hashes and all current row contracts, but does not treat later authorized presentation metadata drift as migration corruption. Initial migration readback still verifies preservation fully.
- Add COMPLETE→presentation→attribution re-entry tests proving no lock/backup/write/manifest transition; real schema/value faults still RESTORE_REQUIRED.
- Add a Bash 3.2 fail-fast private runner with preflight/approve/deploy phases. Preflight validates clean reviewed commit/build/hash/private clasp project/account/deployment before any push. Deploy captures/validates the newly created immutable version and redeploys exactly it.
- Executable negative tests prove every failed gate stops later mutation commands. Update runbook.
- Commit: `fix: close Booking final rollout gates`.

## Stop point

Stop after local tests, builds, runtime smoke, offline CLI/runner tests, and final review. Live retention migration/cleanup, performance canary, attribution migration, Sheet presentation apply and deployments remain separately owner-approved.
