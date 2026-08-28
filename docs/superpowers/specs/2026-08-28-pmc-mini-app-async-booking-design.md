# PMC Mini App Asynchronous Booking Design

**Status:** Approved design, pending owner review of this written specification  
**Date:** 2026-08-28  
**System of record:** PMC Booking Operations Google Sheet  
**Primary user surface:** PMC LINE LIFF Mini App

## Context

The current Mini App waits synchronously for every downstream operation. A representative production booking required about 27 seconds to upload three payment images, 14 seconds to upload one chat image, and about 35 seconds to finalize Drive, Calendar, and LINE. The booking succeeded, but the browser received a timeout and displayed a false failure.

The approved user experience separates durable acceptance from downstream processing. Staff should receive an acknowledgement within seconds, may close the Mini App, and can later resume the same request. Drive, Calendar, and LINE continue in a durable background workflow.

## Goals

- Return a durable booking acknowledgement within 2–3 seconds after confirmation.
- Stage a typical evidence set within 3–5 seconds, subject to mobile network and image size.
- Complete Drive, Calendar, and LINE processing in the background, normally within 30–60 seconds.
- Preserve Google Sheets as the booking source of truth and Google Drive as the canonical evidence store.
- Make retries idempotent across browser, Cloud Run, Cloud Tasks, Apps Script, Calendar, Drive, and LINE.
- Allow staff to close and reopen the Mini App without losing the latest active request.
- Preserve the existing synchronous flow behind a feature flag for rollback during rollout.

## Non-goals

- This phase does not connect or write to JERA.
- Cloud Storage is not a permanent evidence archive.
- This phase does not redesign booking, commission, call queue, or doctor workflow rules.
- This phase does not publish the LINE Login channel. Channel publication remains a separate owner decision.
- This phase does not replace the Google Form fallback.

## Architecture

```text
LINE LIFF Mini App
        |
        v
Cloud Run API
   |          |
   |          +--> Google Sheet: MINI_APP_REQUESTS
   |
   +--> Private Cloud Storage staging bucket
   |
   +--> Cloud Tasks queue
                |
                v
        Private Cloud Run worker route
                |
                v
       Signed Apps Script ingress
          |       |       |
        Drive  Calendar  LINE
                |
                v
      Google Sheet final status + Case ID
```

The existing `pmc-mini-app` Cloud Run service hosts both interactive APIs and the internal worker route. The worker is I/O-bound and runs with bounded task concurrency. A separate worker service is not required for this phase.

## Evidence staging flow

1. The Mini App submits payment and chat images to a new batch evidence endpoint.
2. Cloud Run verifies LINE identity and draft ownership.
3. Cloud Run validates file count, individual size, total request size, MIME type, and magic bytes.
4. Cloud Run writes each image to the private staging bucket with an object name derived only from draft ID, evidence kind, and content hash.
5. Cloud Run updates the draft once with the full ordered set of staging object keys.
6. The API returns the updated draft projection.

Proposed endpoint:

```text
POST /api/mini-app/booking-drafts/:draftId/evidence-batch
```

Multipart fields:

```text
paymentFiles
chatFiles
```

Limits:

- Maximum 10 payment files and 10 chat files per draft.
- Maximum 10 MB per file.
- Maximum 25 MB per batch request.
- JPEG and PNG only in this phase.
- Object creation uses a generation precondition so a retry cannot overwrite a different object.

Object key format:

```text
drafts/<draftId>/<PAYMENT|CHAT>/<contentHash>.<jpg|png>
```

Customer name, phone, Facebook name, Admin name, and AE name must never appear in object keys or object metadata.

The existing Apps Script evidence ingress remains the mechanism that creates owner-owned Drive files. The background worker downloads staged objects and sends them through that signed ingress. The browser no longer waits for Drive file creation.

## Confirmation flow

1. The client submits the validated draft version to the confirmation endpoint.
2. Cloud Run calculates the existing payload hash and deterministic task name.
3. Cloud Run creates a Cloud Task with a two-second schedule delay. The task carries only the request ID and draft ID. Evidence bytes and customer data are not included in the task body.
4. Cloud Run records the draft as `QUEUED` with the task name and returns HTTP 202 immediately.
5. The worker claims either the expected `QUEUED` request or the same still-`READY_TO_CONFIRM` request if task delivery won a race with the Sheet update. It changes the request to `PROCESSING` and obtains a processing lease.
6. The worker copies staged evidence to Drive through the signed Apps Script evidence ingress.
7. The worker replaces staging references with verified Drive file IDs.
8. The worker calls the existing signed booking ingress. Apps Script creates or returns the same Case ID, then handles Drive folder placement, Calendar, LINE, call-task creation, audit, and projection retry records. The safe response includes Case ID, appointment status, `driveState`, `calendarState`, and `lineState`.
9. Cloud Run records the Case ID and sets `CONFIRMED` when all three projections are complete, or `CONFIRMED_WITH_RETRY` when Apps Script has accepted the booking but an existing projection retry remains.
10. Staged objects are deleted only after Drive files have been verified.

Confirmation response:

```json
{
  "requestId": "request-...",
  "status": "QUEUED"
}
```

## Draft state machine

```text
DRAFT
  -> UPLOADING
  -> READY_TO_CONFIRM
  -> QUEUED
  -> PROCESSING
  -> CONFIRMED
```

Additional states:

- `RETRYING`: a Cloud Task retry is pending; staff must not resubmit.
- `CONFIRMED_WITH_RETRY`: the booking and Case ID exist, while one or more Drive, Calendar, or LINE projections remain in their existing retry queue.
- `NEEDS_REVIEW`: automatic attempts are exhausted and a safe operator action is required.
- Existing `CANCELLED`, `EXPIRED`, and `FAILED_RETRYABLE` states remain available during migration and rollback.

State transitions use the existing optimistic version and payload hash. A worker must hold a non-expired processing lease before mutating a queued request. A Cloud Task retry may reclaim a request after the lease expires.

## Sheet schema changes

Append the following columns to `MINI_APP_REQUESTS` without reordering or renaming existing columns:

- `paymentEvidenceObjectKeysJson`
- `chatEvidenceObjectKeysJson`
- `taskName`
- `queuedAt`
- `processingStartedAt`
- `processingLeaseUntil`
- `lastProgressAt`
- `attemptCount`

The existing fields continue to serve these purposes:

- `paymentEvidenceFileIdsJson` and `chatEvidenceFileIdsJson`: verified Drive file IDs only.
- `caseId` and `confirmationStatus`: final Apps Script result.
- `payloadHash`: idempotency and conflict protection.
- `safeErrorCode`: allowlisted operator-safe error only.
- `version`: optimistic concurrency.

The migration is append-only, validates existing headers, preserves all rows and tabs, and freezes no additional user data.

## Cloud Tasks contract

Queue name:

```text
pmc-booking-finalize
```

Region:

```text
asia-southeast1
```

Task name is derived from the request ID hash. Creating the same task again is treated as success.

Task payload:

```json
{
  "requestId": "request-...",
  "draftId": "draft-..."
}
```

Retry policy:

- Maximum attempts: 8.
- Minimum backoff: 10 seconds.
- Maximum backoff: 5 minutes.
- Maximum retry duration: 24 hours.
- Worker dispatch deadline: 5 minutes.
- Initial queue concurrency: 1 task.
- Initial dispatch rate: no more than 2 tasks per second.

The worker endpoint is internal and rejects requests that do not carry a Google-signed OIDC token for the configured task invoker identity and audience.

## Idempotency

- Evidence object name: draft ID + kind + content hash.
- Evidence Drive file name: deterministic upload ID derived from draft ID + kind + content hash.
- Cloud Task name: request ID hash.
- Draft claim: version + processing lease + payload hash.
- Apps Script booking ingress: `mini:<requestId>` and payload hash.
- Drive folders: existing marker-based folder creation.
- Calendar: existing private external ID.
- LINE: existing retry keys and deterministic retry UUIDs.

Repeated browser taps, HTTP retries, task deliveries, worker restarts, and Apps Script replays must return the same Case ID and must not create duplicate Drive folders, Calendar events, LINE messages, or call tasks.

## Failure handling

- Task creation fails before acceptance: the confirmation endpoint returns a safe retryable error and keeps the draft resumable.
- Task creation succeeds but its response is lost: a retry receives the deterministic `ALREADY_EXISTS` result and continues as success.
- Task delivery wins the race with the Sheet update: the authenticated worker may claim the matching `READY_TO_CONFIRM` request directly after revalidating its payload hash.
- Sheet update or browser response is lost after task creation: deterministic task delivery and state reconciliation continue without duplicate work.
- Worker crash: Cloud Tasks retries after the processing lease expires.
- Evidence copy failure: retain staging objects and retry; do not call booking ingress with incomplete Drive evidence.
- Booking ingress timeout: retry the same request ID and payload hash; Apps Script returns the existing booking if it completed in the background.
- Drive, Calendar, or LINE projection failure after Case ID allocation: return `CONFIRMED_WITH_RETRY`; the existing Apps Script retry queue owns the missing projection.
- Retry exhaustion: set `NEEDS_REVIEW`, keep evidence and Case ID if one exists, and display an operator-safe message. Staff must not submit a new booking for the same request.

## Mini App experience

After confirmation returns HTTP 202, show:

```text
รับรายการแล้ว
ระบบกำลังจัดเก็บหลักฐานและส่งการแจ้งเตือน
สามารถปิดหน้านี้ได้
```

Polling behavior:

- Poll every 2–3 seconds for the first 30 seconds.
- Poll every 5 seconds until 60 seconds.
- Stop polling when the request reaches a terminal state.
- After 60 seconds, show that processing continues in the background and allow the user to return home.

On reopening the Mini App, query the latest active request owned by that staff identity. Resume `DRAFT`, `READY_TO_CONFIRM`, `QUEUED`, `PROCESSING`, `RETRYING`, or `NEEDS_REVIEW` instead of creating another draft automatically.

Terminal presentation:

- `CONFIRMED`: display Case ID and final appointment status.
- `CONFIRMED_WITH_RETRY`: display Case ID and state that some notifications are still being delivered.
- `NEEDS_REVIEW`: display the request ID and direct staff to the administrator; do not instruct them to submit again.

## Security and privacy

- Enable uniform bucket-level access and Public Access Prevention.
- Grant the Cloud Run runtime identity object access only to the staging bucket.
- Grant the Cloud Run runtime identity Cloud Tasks enqueue permission only on the named queue.
- Use a dedicated task invoker service account with only Cloud Run Invoker on the existing service.
- Do not create or upload a service-account key.
- Keep the existing HMAC boundary between Cloud Run and Apps Script.
- Keep evidence bytes, LINE tokens, Google tokens, customer names, phone numbers, Facebook names, and unrestricted Drive URLs out of task payloads, URLs, logs, object names, and metrics.
- Preserve the existing staff allowlist, verified LINE ID token, and draft ownership checks on every interactive API.
- Delete staged copies only after verified Drive persistence. Abandoned or cancelled evidence follows the existing `PENDING_APPROVAL` retention boundary and is not automatically deleted.

## Observability

Emit structured events containing only safe identifiers and timings:

- `evidence_stage_started`
- `evidence_stage_completed`
- `booking_task_enqueued`
- `booking_worker_claimed`
- `drive_copy_completed`
- `booking_ingress_completed`
- `booking_worker_retrying`
- `booking_worker_completed`
- `booking_worker_needs_review`

Allowed fields include request ID, draft ID, case ID after allocation, task attempt, state, safe error code, elapsed milliseconds, file count, and total bytes. Logs must never contain patient or credential fields.

Track these service targets:

- Typical evidence batch API latency: at or below 5 seconds.
- Confirmation acknowledgement latency: at or below 3 seconds.
- Background completion latency: at or below 60 seconds for normal clinic volume.
- Duplicate Case ID, Calendar event, Drive folder, and LINE message rate: zero.

## Cost estimate

At the current expected volume of about 250 bookings per month:

- Cloud Tasks is expected to remain inside the first 1 million monthly operations, currently free.
- Singapore Standard Cloud Storage is approximately USD 0.022 per GiB-month. Temporary storage below 1 GiB plus low operation counts is expected to cost only a few baht per month.
- The worker load is expected to remain within the existing Cloud Run free allowance under normal volume, but billing is usage-based and must be monitored.

Using the Bank of Thailand reference rate of 32.824 baht per USD on 2026-08-27, the conservative incremental estimate is 0–20 baht per month, excluding existing Cloud Run, Artifact Registry, and unrelated project usage.

Pricing references:

- <https://cloud.google.com/tasks/pricing>
- <https://cloud.google.com/storage/pricing>
- <https://cloud.google.com/run/pricing>
- <https://app.bot.or.th/BTWS_STAT/statistics/ReportPage.aspx?language=eng&reportID=123>

## Rollout

Feature flag:

```text
PMC_MINI_APP_ASYNC_ENABLED
```

Phases:

1. Create the bucket, queue, task invoker identity, and narrow IAM bindings. Keep the feature flag off.
2. Apply the append-only Sheet migration and verify header readback.
3. Deploy Cloud Run with asynchronous routes disabled.
4. Run synthetic normal and automatic bookings with multiple images.
5. Verify one request, one task, one Case ID, ordered evidence, one Drive folder, one Calendar event, expected LINE messages, and safe logs.
6. Enable asynchronous mode only for the owner's staff ID.
7. Measure evidence, acknowledgement, and background completion latency.
8. After owner acceptance, enable asynchronous mode for all active booking staff.

No real customer booking is used before the owner-only pilot passes.

## Rollback

- Set `PMC_MINI_APP_ASYNC_ENABLED=false` to restore the current synchronous path.
- Stop new task creation while allowing accepted tasks to drain or be paused deliberately.
- Preserve all Sheet rows, staged objects, Drive files, Calendar events, LINE retry records, and audit logs.
- Do not delete the queue or bucket during rollback.
- Keep the Google Form fallback available.

## Verification matrix

Automated verification must cover:

- JPEG/PNG validation, per-file limits, total request limits, and multipart field allowlists.
- Private deterministic object naming and generation preconditions.
- Ordered evidence references and one Sheet update per evidence batch.
- OIDC audience and principal rejection on the worker route.
- Deterministic task naming and duplicate enqueue handling.
- Every allowed and forbidden state transition.
- Processing lease claim, expiry, and crash recovery.
- Retry policy and retry exhaustion.
- Evidence copy idempotency and Drive verification before staging cleanup.
- Existing Apps Script booking idempotency and payload-hash conflicts.
- Existing Drive, Calendar, LINE, call-task, retry-queue, and audit behavior.
- Resume of the latest active staff-owned request.
- Feature-flag rollback to the synchronous path.
- Browser flow for acknowledgement, polling, background completion, resume, and `NEEDS_REVIEW`.

Production acceptance evidence records only commit SHA, revision, synthetic request ID, synthetic Case ID, safe counts, timings, pass/fail, reviewer, and timestamp.
