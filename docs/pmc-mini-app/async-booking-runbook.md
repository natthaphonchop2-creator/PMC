# PMC Mini App — Async Booking Operations Runbook

**Status:** Disabled-first. This document is a review checklist and command record only. Do not run any infrastructure, IAM, Sheet, Apps Script, deployment, traffic, or feature-flag command without the named owner gate and explicit approval.

## Non-negotiable boundaries

- `PMC_MINI_APP_ASYNC_ENABLED=false` remains the default. Synchronous booking and the Google Form fallback remain available throughout every phase.
- Apps Script signed async-state ingress is the sole distributed `MINI_APP_REQUESTS` mutation authority. Cloud Storage is private evidence staging only.
- Do not create or upload service-account keys. Do not print customer, Facebook, phone, staff/Admin/AE names or emails, evidence identifiers/content/bytes, URLs, task/resource names, credentials, tokens, or provider exceptions.
- Use synthetic data only before the owner pilot. Preserve the stock-ledger files and all legacy booking paths.

## Owner gate A — APIs and resources

**Stop for owner approval.** Confirm the approved project, Singapore region, billing ownership, and exact names out of band. The following are documentation-only commands; they have not been executed by this implementation task.

```bash
gcloud services enable cloudtasks.googleapis.com storage.googleapis.com iamcredentials.googleapis.com
gcloud storage buckets create gs://pmc-mini-app-evidence-staging --location=asia-southeast1 --uniform-bucket-level-access --public-access-prevention
gcloud tasks queues create pmc-booking-finalize --location=asia-southeast1 --max-concurrent-dispatches=1 --max-dispatches-per-second=2 --max-attempts=8 --min-backoff=10s --max-backoff=300s --max-retry-duration=86400s
gcloud iam service-accounts create pmc-mini-app-task-invoker --display-name="PMC Mini App task invoker"
```

Acceptance evidence contains only safe booleans, counts, API names, role names, and status names. After approval, Gate A runs the read-only checker **without** `--strict` and requires `infrastructureReady:true`. Its output must not echo the supplied project, region, service, bucket, queue, email, or resource values. Full `--strict` / `ready:true` is reserved for after the separately approved disabled Cloud Run environment and revision gate, because it requires deployed async-disabled configuration and all deployed environment/secret names.

## Owner gate B — narrow IAM

**Stop for owner approval.** Bind only these scopes and validate the resulting role names with the checker:

- Cloud Run runtime identity: `roles/storage.objectUser` on the staging bucket only.
- Cloud Run runtime identity: `roles/cloudtasks.enqueuer` on the booking-finalize queue only.
- Cloud Run runtime identity: `roles/iam.serviceAccountUser` on the dedicated task-invoker identity only, so Cloud Tasks may attach its OIDC identity.
- Dedicated task-invoker identity: `roles/run.invoker` on the existing Mini App service only.
- No project-wide Owner, Editor, Storage Admin, Cloud Tasks Admin, or broad Secret Manager binding.

Keep Uniform Bucket-Level Access and Public Access Prevention enforced. The worker uses its Cloud Run identity; no key file is permitted.

Documentation-only binding templates, to be filled with owner-approved shell variables and run only after this gate:

```bash
gcloud storage buckets add-iam-policy-binding gs://"$PMC_ASYNC_BUCKET" --member="serviceAccount:$PMC_RUNTIME_SERVICE_ACCOUNT" --role=roles/storage.objectUser
gcloud tasks queues add-iam-policy-binding "$PMC_ASYNC_QUEUE" --location="$PMC_ASYNC_LOCATION" --member="serviceAccount:$PMC_RUNTIME_SERVICE_ACCOUNT" --role=roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding "$PMC_ASYNC_TASK_INVOKER_EMAIL" --member="serviceAccount:$PMC_RUNTIME_SERVICE_ACCOUNT" --role=roles/iam.serviceAccountUser
gcloud run services add-iam-policy-binding "$PMC_MINI_APP_SERVICE" --region="$PMC_ASYNC_LOCATION" --member="serviceAccount:$PMC_ASYNC_TASK_INVOKER_EMAIL" --role=roles/run.invoker
```

Then run the read-only checker. It reads the deployed Cloud Run service configuration, resource policies, and project IAM; it derives the two service-account emails only in memory and reports neither email nor supplied resource values.

## Owner gate C — Sheet migration

**Stop for owner approval.** Apply the append-only `MINI_APP_REQUESTS` migration once. Confirm header readback and report only the added column names and row count:

1. Earlier async state fields.
2. `processingOwnerToken`.
3. `evidenceProjectionHash`.

The complete appended header sequence is:

```text
paymentEvidenceObjectKeysJson
chatEvidenceObjectKeysJson
taskName
queuedAt
processingStartedAt
processingLeaseUntil
lastProgressAt
attemptCount
processingOwnerToken
evidenceProjectionHash
```

Do not print spreadsheet IDs, rows, evidence keys, customer data, or values. Keep the Apps Script state-ingress deployment separate from this gate.

After owner approval and `npm run build:server`, use this documentation-only ADC migration template. It prints only the append result:

```bash
node --input-type=module -e '
import { createMiniAppGooglePorts } from "./dist-server/server/pmc-mini-app/googleClient.js";
import { migrateMiniAppAsyncRequestColumns } from "./dist-server/server/pmc-mini-app/setup.js";
const spreadsheetId = process.env.PMC_SPREADSHEET_ID;
const intakeFolderId = process.env.PMC_DRIVE_INTAKE_FOLDER_ID;
if (!spreadsheetId || !intakeFolderId) throw new Error("Required bindings are absent");
const { sheets } = createMiniAppGooglePorts({ spreadsheetId, intakeFolderId });
const { appendedColumns } = await migrateMiniAppAsyncRequestColumns({ spreadsheetId, sheets });
console.log(JSON.stringify({ appendedColumns }));
'
```

## Owner gate D — Apps Script version and deployment

**Stop for owner approval.** Confirm the active account and intended Apps Script project, review the generated diff, push only after approval, create an immutable version, and update only the deployment used by the configured ingress endpoint. Use a synthetic signed state mutation to verify the projection response. Do not display the endpoint, signature, secret, or deployment identifier.

Documentation-only build/push/version/deploy template:

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run booking:push
clasp version "PMC async state ingress"
clasp deploy --deploymentId="$PMC_BOOKING_EXISTING_DEPLOYMENT_ID" --versionNumber="$PMC_APPS_SCRIPT_VERSION" --description="PMC async state ingress"
```

The Cloud Task body is the authenticated immutable snapshot `{ requestId, draftId, payloadHash, baseVersion }`; task names are non-PII snapshot digests. Preserve fencing, deadline, and idempotency behavior. Polling stays read-only and the client HTTP 202 response contains only the persisted safe projection.

## Owner gate E — no-traffic disabled revision

**Stop for owner approval.** Deploy a tagged Cloud Run revision at 0% traffic with:

```text
PMC_MINI_APP_ASYNC_ENABLED=false
```

Documentation-only 0%-traffic template:

```bash
gcloud run deploy "$PMC_MINI_APP_SERVICE" --region=asia-southeast1 --no-traffic --tag=async-disabled --update-env-vars=PMC_MINI_APP_ASYNC_ENABLED=false
```

Bind only approved environment variable and secret names. Verify health, public Mini App shell/config, unauthenticated session rejection, worker OIDC rejection, legacy booking routes, Google Form fallback, and stock-ledger paths. Do not change traffic or enable the async flag at this gate.

After this gate's deployed revision is verified, the owner may run the checker with `--strict`; require `ready:true` in addition to `infrastructureReady:true`.

## Owner gate F — synthetic acceptance

**Stop for owner approval.** Enable asynchronous booking only for the owner allowlist after the prior gates succeed. Submit two synthetic bookings (normal and automatic), each with three payment images and one chat image. Confirm safe counts only:

- evidence acknowledgement at or below 5 seconds;
- confirmation acknowledgement at or below 3 seconds;
- background completion at or below 60 seconds;
- one request, one task, one Case ID, ordered evidence, one Drive folder, one Calendar event, and expected LINE delivery state;
- duplicate confirmation returns the same Case ID; retry exhaustion reaches `NEEDS_REVIEW` without a duplicate side effect.

## Owner gate G — owner pilot, then all-staff rollout

**Stop for owner approval at each step.** Run the owner pilot for the agreed observation period. Record only commit SHA, revision status, safe counts, latency percentiles, error codes, reviewer, and timestamp. A separate approval is required before expanding the staff allowlist. Do not combine the owner pilot approval with all-staff rollout approval.

## Safe telemetry and log review

Structured events are allowlisted: `prepare_completed`, `confirm_completed`, `evidence_stage_started`, `evidence_stage_completed`, `booking_task_enqueued`, `booking_worker_claimed`, `drive_copy_completed`, `booking_ingress_completed`, `booking_worker_retrying`, `booking_worker_completed`, and `booking_worker_needs_review`.

Allowed fields are only `route`, `action`, numeric `status`, safe `state`, bounded `attempt`, bounded `fileCount`, and `elapsedMs`. Request/draft/Case IDs and safe error codes are no longer emitted. The event builders reject unknown fields, nested values, URLs, bearer tokens, evidence content/bytes, file names, customer/business fields, and non-finite or out-of-range numbers. Never add raw request bodies, DOM text/attributes/input values, task/resource names, provider details, exception strings, identifiers, or secrets to log queries or dashboards.

Use Logs Explorer filters by event name, route/action/status/state, and numeric `elapsedMs` only. Keep exported results aggregate-only; do not export source log entries.

Documentation-only Log Analytics templates (the result must retain only aggregate values and time window):

```sql
WITH safe_events AS (
  SELECT CAST(jsonPayload.elapsedMs AS INT64) AS elapsed_ms
  FROM `LOG_TABLE`
  WHERE jsonPayload.event = 'booking_task_enqueued'
    AND jsonPayload.route = 'confirm'
    AND jsonPayload.action = 'enqueue'
    AND CAST(jsonPayload.status AS INT64) = 202
)
SELECT APPROX_QUANTILES(elapsed_ms, 100)[OFFSET(50)] AS ack_p50_ms,
  APPROX_QUANTILES(elapsed_ms, 100)[OFFSET(95)] AS ack_p95_ms
FROM safe_events
```

```sql
WITH safe_events AS (
  SELECT jsonPayload.event AS event, CAST(jsonPayload.elapsedMs AS INT64) AS elapsed_ms,
    jsonPayload.action AS action
  FROM `LOG_TABLE`
  WHERE jsonPayload.event IN ('booking_worker_completed', 'booking_worker_retrying', 'booking_worker_needs_review')
)
SELECT APPROX_QUANTILES(IF(event = 'booking_worker_completed', elapsed_ms, NULL), 100)[OFFSET(50)] AS background_p50_ms,
  APPROX_QUANTILES(IF(event = 'booking_worker_completed', elapsed_ms, NULL), 100)[OFFSET(95)] AS background_p95_ms,
  COUNTIF(action = 'retry') AS retry_count,
  COUNTIF(action = 'review') AS needs_review_count
FROM safe_events
```

## Local performance evidence gate

Task 6 adds two offline-safe CLIs. `--help` and `--evaluate` do not import a browser, runner, or network client and do not send a Booking request.

```bash
node scripts/measure-pmc-booking-performance.mjs --help
node scripts/measure-pmc-booking-performance.mjs --evaluate tests/fixtures/booking-performance-pass.json
node scripts/measure-pmc-mini-app-inp.mjs --help
```

The failing threshold fixture must exit nonzero:

```bash
node scripts/measure-pmc-booking-performance.mjs --evaluate tests/fixtures/booking-performance-fail.json
```

The performance budget requires 30 retained successful runs after one discarded warm-up for async prepare, sync prepare, legacy sync prepare, and async confirm; seven exact bounded fixtures; then five concurrent clients. It fails for insufficient success runs, async prepare p95 above 3,000 ms, sync prepare median above 70% of the legacy median, async confirm p95 above 6,000 ms, any unavailable-route probe, any maximum-fixture failure, or any concurrency duplicate.

The exact fixture labels are `payment-chat-2x500kb`, `five-files-2mb`, `twenty-files-max25mb`, `chunk-overflow`, `invalid-mime`, `partial-failure`, and `response-loss`. Artifacts retain only revision label, UTC/Bangkok timestamps, safe route/status, fixture label, count, p50/p95/max, and aggregate gate counts. Raw samples, URLs, IDs, rows, payloads, evidence metadata, and secrets are forbidden.

**Stop for a new owner approval before live measurement.** Live mode additionally requires the literal `--owner-approved` flag, `PMC_BOOKING_PERFORMANCE_OWNER_GATE=APPROVED`, a reviewed `PMC_BOOKING_PERFORMANCE_REVISION` label, a separately reviewed runner module, and a new non-existing aggregate output path. The implementation task does not run this mode. INP/Long Animation Frame evidence records only `preview`/`confirm` categories and aggregate input-delay, processing, presentation, longest-frame, and longest-script durations. A p95 INP above 200 ms or a script duration above 50 ms records `routeSplittingGate=REQUIRED`; it does not authorize speculative lazy loading or route changes.

## Monthly cost check

Once a month, review aggregate Cloud Tasks operations, staging-storage GiB-month, and incremental Cloud Run usage. Compare the incremental estimate to the approved **0–20 baht/month** range, excluding existing Cloud Run, Artifact Registry, and unrelated project charges. Escalate to the owner before increasing limits, changing region, or accepting a higher incremental spend.

## Rollback

**Stop for owner approval before changing a flag or traffic.** Roll back non-destructively:

1. Set `PMC_MINI_APP_ASYNC_ENABLED=false` or send traffic to the last disabled revision.
2. Keep synchronous booking, Google Form fallback, Sheets, Apps Script, Drive, and stock-ledger files intact.
3. Do not delete staged evidence automatically; cancelled/abandoned evidence remains behind `PENDING_APPROVAL`.
4. Investigate only safe event names, states, codes, counts, and timings before any retry or remediation.
