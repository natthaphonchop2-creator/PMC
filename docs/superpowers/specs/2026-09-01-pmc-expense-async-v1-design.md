# PMC Expense Async V1 Design

**Status:** Approved direction; pending owner review of this written specification  
**Date:** 2026-09-01  
**Primary surface:** PMC LINE LIFF Mini App  
**Financial source of truth:** Private monthly expense ledgers referenced by `EXPENSE_MONTHLY_INDEX`

## 1. Context

The current expense form stages evidence quickly, then keeps the mobile request open while Cloud Run performs `PREPARE_EXPENSE`, owner-account Drive evidence creation, Drive verification, and `COMMIT_EXPENSE`. Production requests have taken roughly 60–100 seconds. A response can fail even when Drive or Sheet side effects have already occurred, leaving a `PREPARED` submission, an active lease, or a claimed Drive slot that must later be replayed.

Booking already solves the equivalent mobile reliability problem with durable acceptance, a deterministic Cloud Task, an OIDC-protected worker, idempotent downstream execution, and resumable status. Expense Async V1 applies that operating model without weakening the existing financial ledger, attachment verification, revision rules, or permissions.

## 2. Goals

- Return a durable expense acknowledgement within 3 seconds after the user presses `ยืนยันบันทึก`, excluding the preceding image upload time.
- Return the user to Finance Home immediately after acknowledgement; do not keep the review screen blocked while Apps Script and Drive run.
- Complete `PREPARE -> EVIDENCE -> COMMIT` through a private background worker.
- Preserve exactly-once financial effects across browser retries, Cloud Task retries, worker restarts, Apps Script timeouts, and Drive visibility delays.
- Count only effective `COMMITTED` expense rows in reports.
- Keep the synchronous path behind a feature flag as an immediate rollback path.
- Preserve and resume every expense root accepted before the async rollout.

## 3. Non-goals

- This change does not add OCR, approval, payroll, employee DF, doctor DF, or accounting-provider posting.
- This change does not alter expense categories, daily-book revision rules, finance permissions, evidence limits, or report arithmetic.
- This change does not move the financial source of truth out of the monthly Google Sheets ledgers.
- This change does not share queue capacity with Booking.
- This change does not make LINE or browser local storage the authority for an expense result.

## 4. Architecture

```text
LINE Mini App
  |
  | POST evidence -> private GCS staging
  |
  | POST expense command
  v
Cloud Run interactive API
  |-- validate LINE staff + staging receipts
  |-- create/replay durable async job in GCS
  |-- enqueue deterministic Cloud Task
  `-- HTTP 202 PENDING
               |
               v
       pmc-expense-finalize queue
               |
               v
  OIDC-protected Cloud Run worker route
               |
               |-- claim/fence GCS job
               |-- existing ExpenseSubmissionService
               |     PREPARE -> owner Drive evidence -> COMMIT
               |-- persist terminal job projection
               `-- retry or NEEDS_REVIEW

Mini App resume -> GCS job state first -> legacy Apps Script resume fallback
```

The existing `pmc-mini-app` Cloud Run service hosts the interactive API and the internal expense-worker route. Expense uses a dedicated Cloud Tasks queue so slow finance processing cannot block Booking tasks.

## 5. Durable async job store

Create `server/pmc-mini-app/finance/asyncJobStore.ts` backed by a dedicated private async-job bucket. The job bucket is separate from the 24-hour evidence staging bucket so a job cannot disappear while Cloud Tasks still has retry authority.

Object key:

```text
expense-async-jobs/v1/<rootRequestId>.json
```

The object contains no secret, LINE token, Drive URL, or evidence bytes. It contains the validated server-side submission input, immutable staging receipt descriptors, a fingerprint, task identity, state, attempt counters, lease fields, safe terminal result, and timestamps.

State machine:

```text
QUEUING
  -> QUEUED
  -> PROCESSING
  -> COMMITTED

PROCESSING -> RETRYING -> PROCESSING
PROCESSING -> FAILED
PROCESSING -> NEEDS_REVIEW
```

Required persisted fields:

```text
version: 1
rootRequestId
staffId
fingerprint
operation: CREATE | REPLACE
replacementOfExpenseId
expectedVersion
submissionInput
stagingReceipts
state
taskName
createdAt
updatedAt
attemptCount
leaseOwnerToken
leaseExpiresAt
receipt
safeErrorCode
```

`replacementOfExpenseId` and `expectedVersion` are null for `CREATE` and required for `REPLACE`. All writes use GCS generation-match preconditions. The job fingerprint covers the operation, replacement identity, expected version, every immutable command field, and every staging-receipt field. Reusing the same root with a different fingerprint returns `EXPENSE_IDEMPOTENCY_CONFLICT`. Reusing the same root and fingerprint returns the existing acknowledgement or terminal result.

The job bucket uses uniform bucket-level access, public-access prevention, and a 7-day delete lifecycle. A committed financial record remains authoritative in Sheets after the async job object expires. Evidence staging retains its existing 24-hour lifecycle.

## 6. Interactive submission flow

The existing evidence staging endpoint remains unchanged.

For new create requests:

```text
POST /api/mini-app/expenses
```

For manager replacements:

```text
POST /api/mini-app/finance/expenses/:expenseId/replace
```

When `PMC_EXPENSE_ASYNC_ENABLED=true`, both routes:

1. verify LINE identity and expense permission;
2. validate the exact request body;
3. resolve and verify every staging token into an immutable server-side receipt descriptor;
4. create or replay the durable job;
5. create a deterministic Cloud Task;
6. persist `QUEUED` plus task name; and
7. return HTTP 202.

During rollout, async behavior applies only when the authenticated staff ID is in `PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS`. Other authorized staff continue on the synchronous rollback path until their immutable staff IDs are explicitly added after owner acceptance.

Exact response:

```json
{
  "rootRequestId": "request-id",
  "status": "PENDING",
  "acceptedAt": "2026-09-01T18:00:00.000Z"
}
```

If job persistence succeeds but task creation response is lost, retrying the same browser request reuses the deterministic task name. Cloud Tasks `ALREADY_EXISTS` is success. If queue creation fails before durable acceptance, return a safe retryable 503 while preserving the same root for retry.

When the async flag is false, the existing synchronous behavior remains unchanged.

Void stays synchronous because it has no evidence upload and is already a bounded, manager-only ledger mutation.

## 7. Cloud Tasks contract

Queue:

```text
pmc-expense-finalize
```

Region:

```text
asia-southeast1
```

Worker route:

```text
POST /internal/mini-app/finalize-expense
```

Task body:

```json
{
  "rootRequestId": "request-id",
  "fingerprint": "sha256"
}
```

The body contains no expense amount, merchant name, note, evidence identity, or staff display name.

Task names are derived from `rootRequestId + fingerprint`. The route requires a Google-signed OIDC token whose audience and service-account email exactly match configuration.

Initial queue policy:

- maximum attempts: 8;
- minimum backoff: 10 seconds;
- maximum backoff: 5 minutes;
- maximum retry duration: 24 hours;
- dispatch deadline: 5 minutes;
- maximum concurrent dispatches: 1; and
- maximum dispatch rate: 2 per second.

## 8. Worker behavior

Create `server/pmc-mini-app/finance/asyncWorker.ts`.

For each delivery the worker:

1. validates task input and retry-count headers;
2. reads the exact job generation;
3. returns the terminal projection when already `COMMITTED`, `FAILED`, or `NEEDS_REVIEW`;
4. claims `QUEUED` or reclaimable `RETRYING/PROCESSING` with a random owner token and a 240-second lease;
5. calls the existing `ExpenseSubmissionService` with the persisted input and same root;
6. writes `COMMITTED` plus the projected receipt only after the monthly ledger, attachment row, Drive evidence, and submission lease are durable;
7. returns HTTP 200 for terminal success or deterministic terminal failure; and
8. returns HTTP 503 for retryable infrastructure uncertainty after writing `RETRYING`.

The worker does not implement a second financial state machine. `ExpenseSubmissionService`, signed Apps Script commands, GCS submission leases, Drive slot claims, and the monthly ledger remain the exactly-once financial boundary.

The worker renews its async-job lease before and after each external phase. If ownership or generation fencing is lost, it stops without writing a terminal state and returns a retryable 503. No external phase begins when fewer than 30 seconds remain before the 300-second task deadline.

Deterministic errors such as `EXPENSE_REVISION_CONFLICT`, invalid immutable replacement fields, or permission loss become terminal `FAILED` jobs with the allowlisted code. Storage, provider, timeout, and transient Drive errors retry. Attempt 8 without a terminal result becomes `NEEDS_REVIEW` and stops automatic dispatch.

## 9. Resume and legacy compatibility

The existing route remains:

```text
POST /api/mini-app/expenses/resume/:rootRequestId
```

Resolution order:

1. read the async job owned by the authenticated staff ID;
2. project `QUEUED`, `PROCESSING`, and `RETRYING` as `PENDING`;
3. return the stored receipt for `COMMITTED`;
4. return the stored allowlisted error for `FAILED`;
5. return `EXPENSE_NEEDS_REVIEW` for `NEEDS_REVIEW`; and
6. if no async job exists, execute the existing Apps Script resume path for legacy synchronous roots.

Async job reads must be bounded to one exact object key. The route never lists the bucket.

## 10. Mini App experience

After HTTP 202:

- retain the root in the existing protected resume storage;
- clear the completed form state;
- navigate to Finance Home immediately;
- show a transient success message using the existing application message surface:

```text
รับรายการแล้ว ระบบกำลังบันทึกเบื้องหลัง
```

- do not claim that the expense is recorded or included in reports yet.

While the Mini App is open and visible, check the exact root immediately and then every 10 seconds without overlapping requests. Pause polling when `document.visibilityState !== 'visible'`. On reopen, check the protected root before starting a new expense.

Terminal behavior:

- `COMMITTED`: clear the root and show `บันทึกรายจ่ายสำเร็จ` with access to the receipt for authorized users;
- deterministic `FAILED`: clear the root and show the category-specific safe error;
- `NEEDS_REVIEW`: keep the request identity visible, clear the form lock, and instruct staff to contact an administrator without submitting again.

The UI uses semantic status text and `aria-live`. It does not require the Popover API, a polyfill, or a new notification dependency.

## 11. Configuration

Add fail-closed bindings:

```text
PMC_EXPENSE_ASYNC_ENABLED
PMC_EXPENSE_ASYNC_JOB_BUCKET
PMC_EXPENSE_ASYNC_QUEUE
PMC_EXPENSE_ASYNC_WORKER_URL
PMC_EXPENSE_ASYNC_WORKER_AUDIENCE
PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL
PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS
```

Reuse:

```text
PMC_GCP_PROJECT_ID
PMC_ASYNC_LOCATION
PMC_FINANCE_STAGING_BUCKET
```

The dedicated job bucket, expense queue, and non-empty pilot staff list are mandatory when the async flag is true. The job bucket must not equal either evidence staging bucket, and the expense queue must not equal the Booking queue name. Missing, malformed, or cross-wired configuration disables async expense capture rather than falling back silently. Rollout to all staff is an explicit environment update that replaces the pilot list with every active staff ID granted `canSubmitExpense`.

## 12. Security and privacy

- Use the existing Cloud Run runtime identity to access the finance staging bucket, the dedicated async-job bucket, and only the expense queue.
- Reuse the existing task-invoker service account only if its IAM binding is explicitly scoped to invoke this Cloud Run service; otherwise create a dedicated expense-task invoker without a key.
- Do not place amounts, merchant names, descriptions, evidence names, staff names, LINE IDs, Drive IDs, or tokens in task bodies, task names, URLs, metrics, or logs.
- Bind every job to immutable staff ID and root request ID after LINE authentication.
- Verify evidence receipt ownership before writing a job.
- Keep all existing SHA-256, MIME/magic, parent, private-permission, deterministic-name, Drive-property, slot-claim, lease, and Apps Script HMAC checks.

## 13. Observability

Emit safe structured events:

```text
expense_job_accepted
expense_task_enqueued
expense_worker_claimed
expense_prepare_completed
expense_evidence_completed
expense_commit_completed
expense_worker_retrying
expense_worker_completed
expense_worker_failed
expense_worker_needs_review
```

Allowed fields are root hash, task attempt, state, safe error code, elapsed milliseconds, file count, and HTTP status. Never log financial or customer fields.

Service targets:

- acknowledgement p95 at or below 3 seconds after evidence staging;
- normal background completion at or below 120 seconds under current Apps Script latency;
- duplicate committed expenses: zero;
- accepted jobs without a terminal state after 24 hours: zero; and
- interactive expense requests running longer than 10 seconds: zero.

## 14. Rollout

1. Add async job store, task queue, worker, config, middleware, resume projection, client acknowledgement, and tests with the flag off.
2. Create the private 7-day async-job bucket and `pmc-expense-finalize` with the approved retry policy.
3. Grant narrow enqueue and OIDC invocation permissions.
4. Deploy Cloud Run at 0% traffic and verify health, Mini App shell, config, OIDC rejection, task payload safety, and legacy synchronous behavior.
5. Enable async expense only for the owner test staff ID in `PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS`.
6. Submit one new Bill Document from the real LINE Mini App and verify: HTTP 202, return to Finance Home, one task, one PREPARE, one Drive file, one registered slot, one COMMIT, one attachment row, one report total, committed lease, zero staging objects, and zero duplicate effects.
7. Test one daily-book revision conflict and verify a terminal, human-readable failure without a duplicate total.
8. Enable for all staff with `canSubmitExpense` after owner acceptance.

No prior failed root is reused as the first-live acceptance case.

## 15. Rollback

- Set `PMC_EXPENSE_ASYNC_ENABLED=false` to restore synchronous submission for new requests.
- Keep the worker route and queue available until every accepted async job reaches a terminal state.
- Do not delete the queue, job objects, staging objects, leases, Drive evidence, or ledger rows during rollback.
- Preserve legacy resume fallback indefinitely for roots created before cutover.
- Roll back Cloud Run traffic if the tagged revision fails before flag enablement.

## 16. Testing and acceptance

Automated tests must cover:

- strict async configuration and Booking-queue inequality;
- generation-match job create, exact replay, fingerprint conflict, claim, renew, terminal write, and stale-owner rejection;
- deterministic task name, safe task body, OIDC fields, `ALREADY_EXISTS`, and provider-error sanitization;
- POST 202 acknowledgement without invoking `ExpenseSubmissionService` inline;
- create and replacement async jobs; void remains synchronous;
- enqueue response loss and retry of the same root;
- worker claim/reclaim, exact submission input, retryable error, deterministic failure, attempt exhaustion, and terminal replay;
- resume projection for every async state plus legacy fallback;
- no report inclusion before `COMMITTED`;
- receipt, attachment, audit, lease, and staging cleanup after commit;
- browser return-to-home, protected root retention, foreground-only polling, committed receipt, revision conflict, and `NEEDS_REVIEW` copy;
- feature-flag rollback; and
- Booking, Stock, reports, synchronous expense, and Google Form fallback regressions.

Production acceptance requires one brand-new owner-submitted Bill Document after async enablement. Completion is not claimed from synthetic tests, recovered roots, health checks, or queue creation alone.
