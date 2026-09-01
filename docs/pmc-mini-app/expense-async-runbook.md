# PMC Expense Async V1 rollout runbook

This runbook moves only expense **create** and **replace** finalization to a private Cloud Tasks worker. Expense evidence staging, the existing Apps Script PREPARE/evidence/COMMIT journal, submission lease, Drive slot claim, monthly ledgers, and VOID behavior remain unchanged.

The rollback switch is `PMC_EXPENSE_ASYNC_ENABLED=false`. When false, eligible expense submissions use the existing synchronous path.

## Safety invariants

- Use project `project-2099d92f-51c8-4d2b-a8c`, region `asia-southeast1`, service `pmc-mini-app`.
- Use queue `pmc-expense-finalize`; never reuse `pmc-booking-finalize`.
- Use bucket `pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c`; never reuse either Booking evidence staging or expense evidence staging.
- Bucket must have Uniform Bucket-Level Access, Public Access Prevention, and an exact seven-day delete lifecycle.
- Queue must have one concurrent dispatch, two dispatches per second, eight attempts, 10-second minimum backoff, 300-second maximum backoff, and one-day retry duration.
- The worker target is exactly `/internal/mini-app/finalize-expense` and requires the existing dedicated Google OIDC task-invoker identity.
- A task body contains only `rootRequestId` and `fingerprint`.
- Only Apps Script `COMMITTED` rows enter reports. Async `QUEUED`, `PROCESSING`, `RETRYING`, `FAILED`, and `NEEDS_REVIEW` states never enter totals.
- Do not print, copy into snapshots, or commit secrets, LINE tokens, financial inputs, staff identities, private Drive IDs, queue URLs, or GCS job bodies.

## 1. Read-only source and runtime preflight

Run the complete source gate from the approved worktree:

```bash
npm run booking:test
npx vitest run tests/pmc-mini-app
npm run booking:typecheck
npm run booking:build
npm run build:mini-app
npm run build:server
npm run lint
git diff --check
```

Before infrastructure changes, describe the current service, runtime identity, task-invoker IAM, existing Booking queue, and both evidence-staging buckets. Verify the new names do not already point to incompatible resources.

## 2. Create the private job bucket

```bash
gcloud storage buckets create \
  gs://pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --location=asia-southeast1 \
  --uniform-bucket-level-access \
  --public-access-prevention
```

Apply one lifecycle rule: delete every object at age seven days. Re-read the bucket and require location `ASIA-SOUTHEAST1`, Uniform Bucket-Level Access enabled, Public Access Prevention `enforced`, and exactly one seven-day delete rule.

Grant the current `pmc-mini-app` runtime service account `roles/storage.objectAdmin` on this bucket only. Do not grant bucket admin, storage admin, editor, or owner.

## 3. Create the independent queue

```bash
gcloud tasks queues create pmc-expense-finalize \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --location=asia-southeast1 \
  --max-concurrent-dispatches=1 \
  --max-dispatches-per-second=2 \
  --max-attempts=8 \
  --min-backoff=10s \
  --max-backoff=300s \
  --max-retry-duration=86400s
```

Grant the Cloud Run runtime service account `roles/cloudtasks.enqueuer`. Re-read the service IAM and require the configured task-invoker service account to retain `roles/run.invoker` on `pmc-mini-app`.

## 4. Sanitized disabled-preflight snapshot

Collect one local snapshot within 15 minutes containing only:

- provenance, logical target/environment, and five source-check booleans;
- health status and unauthenticated expense-worker status;
- queue state, task count, and numeric retry/rate settings;
- bucket location, two access-control booleans, and lifecycle days;
- the exact seven expense-async binding **names**; and
- the explicit async flag string.

Run:

```bash
node scripts/check-pmc-expense-async-runtime.mjs \
  --snapshot-file /absolute/path/to/sanitized-expense-async-preflight.json \
  --expected-target pmc-mini-app \
  --expected-environment production \
  --strict
```

Strict disabled-preflight readiness requires an empty running queue, a private seven-day bucket, `/api/healthz` status 200, the exact worker route absent with status 404, all seven binding names, and `PMC_EXPENSE_ASYNC_ENABLED=false`. After the owner-pilot flag is enabled on a tagged revision, the separate security gate requires the same unauthenticated worker request to change from 404 to 401, never 200.

## 5. No-traffic code deployment

Deploy the verified commit without traffic and keep async disabled:

```bash
gcloud run deploy pmc-mini-app \
  --source . \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --no-traffic \
  --tag=expense-async-v1 \
  --quiet
```

Against the tagged URL, require:

- `/api/healthz` returns 200;
- `/mini-app/` returns 200;
- unauthenticated `/internal/mini-app/finalize-expense` returns 404 while async is disabled; after the pilot bindings and flag are enabled on the next tagged revision it must return 401, never 200;
- client config contains only `expenseAsyncEnabled` as a role-filtered boolean and no resource names; and
- a non-pilot expense still follows the synchronous 200 receipt path.

## 6. Owner-only pilot

Configure these non-secret bindings on a new no-traffic revision:

```text
PMC_EXPENSE_ASYNC_ENABLED=true
PMC_EXPENSE_ASYNC_JOB_BUCKET=pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c
PMC_EXPENSE_ASYNC_QUEUE=pmc-expense-finalize
PMC_EXPENSE_ASYNC_WORKER_URL=https://pmc-mini-app-d22ig5ujoq-as.a.run.app/internal/mini-app/finalize-expense
PMC_EXPENSE_ASYNC_WORKER_AUDIENCE=https://pmc-mini-app-d22ig5ujoq-as.a.run.app
PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL=pmc-mini-app-task-invoker@project-2099d92f-51c8-4d2b-a8c.iam.gserviceaccount.com
PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS=ADMIN_03
```

Before traffic, require queue task count zero and bucket object count zero. Route traffic only to the exact revision whose tagged checks passed.

From the real LINE Mini App, `ADMIN_03` submits one brand-new Bill Document. Acceptance requires:

- interactive response 202 in at most three seconds after evidence staging;
- immediate return to Finance Home with `รับรายการแล้ว ระบบกำลังบันทึกเบื้องหลัง`;
- one job transition `QUEUED -> PROCESSING -> COMMITTED`;
- queue drains to zero;
- exactly one PREPARE and one COMMIT for the root;
- one effective COMMITTED row and the expected evidence count in Drive; and
- no duplicate ledger, audit, Drive, or LINE side effect.

Recovered historical roots do not count as pilot acceptance.

## 7. Rollback and incident handling

Immediate rollback:

1. Set `PMC_EXPENSE_ASYNC_ENABLED=false` and deploy.
2. Keep the job bucket, queue, staging evidence, Drive evidence, and finance ledgers intact.
3. Do not manually replay, edit, or delete financial rows.
4. Let already-dispatched jobs finish idempotently, or pause the queue only after recording the exact non-terminal count.
5. Verify a new non-pilot/synchronous expense returns the existing strict 200 receipt.

Incident states:

- `QUEUING`: retry the exact same root/input; deterministic task creation repairs enqueue uncertainty.
- `QUEUED`, `PROCESSING`, `RETRYING`: do not resubmit; inspect only safe task/job state and existing PREPARE/COMMIT journal status.
- `FAILED`: do not resubmit automatically; inspect the safe terminal error and the authoritative finance journal.
- `NEEDS_REVIEW`: keep the Mini App message `รายการนี้ต้องให้ผู้ดูแลตรวจสอบ ไม่ต้องส่งซ้ำ`; perform governed operator review.
- Fence or generation mismatch: never overwrite the job object manually.

All-staff rollout requires a separate owner checkpoint after the new owner Bill Document acceptance. Replace the pilot list only with the explicitly approved staff IDs; do not use display names or a wildcard.
