# PMC finance reports — disabled-first rollout runbook

**Status:** tooling and procedure only. No Production migration, deployment, IAM change, queue or Scheduler creation, flag change, traffic change, or backfill is authorized by this document.

The rollout remains stopped until the owner approves each gate separately. Repository evidence may contain only safe counts, timestamps, booleans, safe codes, immutable staff IDs with names, and approved revision labels. Never record credentials, provider rows, patient data, Sheet or LINE IDs, service URLs, deployment IDs, task names, tokens, or secret values.

## Gate 0 — full local verification

Run from the reviewed worktree and require every command to pass:

```bash
npm ci
npx vitest run tests/jera/financeOperatorScripts.test.ts
npm test
npm run booking:test
npm run ocr:test
npm run booking:typecheck
npm run booking:build
npm run build
npm run lint
npx playwright test --config=playwright.mini-app.config.ts
git diff --check
```

The browser matrix must include daily, 1–31-day history, monthly, ordinary-staff 403, finance-staff 200, and existing Booking, Stock, OCR, Calendar, LINE, Form fallback, and legacy report-cache behavior. A green local matrix is not Production approval.

## Gate 1 — owner approval for a no-traffic Cloud Run revision

Before deploying, record the current revision receiving 100% traffic as the rollback target. Obtain owner approval for the exact image, service, region, runtime identity, and these disabled flags:

```text
PMC_FINANCE_REPORTS_ENABLED=false
JERA_REVENUE_ALLOCATION_ENABLED=false
JERA_FINANCE_CATEGORY_MONEY_ENABLED=false
PMC_FINANCE_REPORTS_PILOT_ONLY=false
PMC_FINANCE_UI_PREVIEW_ENABLED=false
PMC_FINANCE_PILOT_DEFAULT_DATE=<unset>
PMC_FINANCE_MONTHLY_INCOME_ENABLED=false
```

Deploy a tagged revision with zero traffic. Do not print or commit its URL, environment values, secret bindings, or resource IDs. Read back only the revision label, traffic percentage, flag booleans, and binding-presence booleans.

Run the stage-specific read-only check. At `DISABLED`, an absent/paused Scheduler and an absent latest no-traffic ready revision are valid; the three feature flags and all four rollout controls must match exactly. A missing boolean is not equivalent to explicit `false`:

Before every checker invocation, the operator must declare the owner-approved immutable `CONFIG_STAFF.id` set in the current shell. The checker accepts 1–20 unique IDs and requires the repeated ID count to match `--expected-finance-viewers` exactly. The live approved set currently contains four IDs. These values are operator input; do not hard-code or commit them:

```bash
export OPERATOR_FINANCE_STAFF_ID_1="<approved-staff-id-1>"
export OPERATOR_FINANCE_STAFF_ID_2="<approved-staff-id-2>"
export OPERATOR_FINANCE_STAFF_ID_3="<approved-staff-id-3>"
export OPERATOR_FINANCE_STAFF_ID_4="<approved-staff-id-4>"
```

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 4 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_4" \
  --expected-stage=DISABLED \
  --expected-finance-pilot-only false \
  --expected-finance-ui-preview-enabled false \
  --expected-finance-pilot-default-date UNSET \
  --expected-finance-monthly-income-enabled false
```

## Gate 2 — owner approval for queue, lease bucket, and least-privilege IAM

After separate approval, create the allocation queue in `asia-southeast1` with:

```text
queue: pmc-revenue-allocation
max concurrent dispatches: 1
max dispatch rate: 0.016 tasks/second
```

Deploy the reviewed image as a separate private Cloud Run service named `pmc-finance-worker`. The public `pmc-mini-app` LIFF service must not be treated as the worker IAM boundary. Cloud Tasks targets only the private worker service. Finance seed Scheduler HTTP targets use the exact deployed public `pmc-mini-app` `status.url`; their OIDC audience intentionally remains the private allocation-worker origin and is verified by the application. The worker policy contains only the dedicated invoker.

Grant only the runtime identity permission to enqueue that queue, the verified OIDC identity permission to invoke the no-traffic service, and the runtime identity the minimum object permission on the dedicated allocation lease bucket. Do not grant project Owner, Editor, broad Secret Manager, Cloud Tasks admin, Storage admin, or broad Cloud Run invoker roles.

Every task must contain a valid `metadataSnapshotHash` and integer `attempt`. Each task processes at most 20 payment-detail attempts; the worker keeps one provider request in flight and waits at least 3,000 ms between attempts. Continuations for a day wait at least 60 seconds. This preserves the global ceiling of 20 `PAYMENT_DETAIL` requests per minute even while multiple days are pending.

The allocation lease is global to the allocation Sheet store, not one lease per report day. This deliberately serializes row allocation across every day and Cloud Run instance. The worker and manual refresh path must both hold that generation-matched lease before queue or Sheet mutation, persist the current generation as `leaseFencingToken`, reject a lower generation, renew before the mutation guard, and use bounded Google write timeouts. Cached-detail cursor visits count toward the same 20-item worker budget even when no provider call is needed.

## Gate 3 — owner approval for managed allocation tabs

With approval for the canonical workbook only, build the server and run `ensureMiniAppWorkbook()`. It may create or validate these tabs only:

```text
JERA_PAYMENT_DETAIL_CACHE
JERA_PAYMENT_DETAIL_LINES
JERA_ALLOCATION_COVERAGE
```

Require exact header readback and frozen row 1 for all three. Stop on an incompatible header. Never rename, clear, delete, replace, or manually repair a tab to make setup pass.

Require exact grid row-capacity readback after setup:

```text
JERA_PAYMENT_DETAIL_CACHE: 50,002 rows
JERA_PAYMENT_DETAIL_LINES: 200,002 rows
JERA_ALLOCATION_COVERAGE: 10,002 rows
```

The two extra rows are the header and overflow sentinel. The coverage header must end with `taskAttempt`, `productSalesRowCount`, and `leaseFencingToken`. Allocation stays disabled if any capacity or header is missing.

## Gate 4 — Apps Script owner/account/project/deployment approval

This gate is independent from the workbook gate. The Apps Script owner must:

1. verify the signed-in Google account;
2. verify the exact existing Apps Script project and current deployment;
3. run `npm run booking:test`, `npm run booking:typecheck`, and `npm run booking:build`;
4. review the generated bundle diff and confirm no unrelated Booking behavior changed;
5. approve a push through the already verified project configuration;
6. create an immutable Apps Script version; and
7. update only the existing deployment to that version.

Do not create a second ingress deployment. Never print or commit the project ID, deployment ID, web-app URL, Sheet ID, ingress secret, or account credential.

## Gate 5 — owner approval for the one-time permission migration

Run `migratePmcFinancePermissionColumns()` exactly once. Require the exact safe readback:

```json
{"changed":true,"columnCount":12}
```

If the migration reports another shape, a non-12 column count, an incompatible header, or a partial write, stop. Do not manually append, rename, reorder, clear, or overwrite `CONFIG_STAFF` columns.

## Gate 6 — owner approval for immutable finance staff IDs

Produce a read-only roster containing only immutable staff ID, name, active status, and the three finance booleans. The owner must separately confirm the four current immutable finance IDs before the exact `canViewFinance` set is checked.

Set `canViewFinance=true` only for those four confirmed IDs. This checker gates the exact report-view set only. `canSubmitExpense` and `canManageExpense` are validated by the separate expense-permission acceptance gate and must not be forced false here; the four live approved holders may legitimately have those permissions. Never derive a role from a name, email, or LINE user ID, and never print LINE user IDs.

Build the server before using the checker, then run the read-only preflight:

```bash
npm run build:server
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 4 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_4" \
  --expected-stage=DISABLED \
  --expected-finance-pilot-only false \
  --expected-finance-ui-preview-enabled false \
  --expected-finance-pilot-default-date UNSET \
  --expected-finance-monthly-income-enabled false
```

Require the exact operator-provided ID set, with every configured row active and `canViewFinance=true`, and no additional `canViewFinance=true` row. LINE linkage is reported separately: an explicitly approved active finance grant may remain latent/unlinked without invalidating the permission set. The `DISABLED` stage itself requires exact false feature flags, exact disabled rollout controls, no enabled finance Scheduler, and a readable service; later stages make staff, infrastructure, IAM, and schema evidence blocking. `check` is read-only; it must never mutate Cloud or Sheets.

## Gate 7 — owner approval to enable allocation on zero traffic

Approve a new zero-traffic revision or configuration revision with `JERA_REVENUE_ALLOCATION_ENABLED=true`; keep both `PMC_FINANCE_REPORTS_ENABLED=false` and `JERA_FINANCE_CATEGORY_MONEY_ENABLED=false`. Keep `PMC_FINANCE_REPORTS_PILOT_ONLY=false`, `PMC_FINANCE_UI_PREVIEW_ENABLED=false`, the pilot date unset, and `PMC_FINANCE_MONTHLY_INCOME_ENABLED=false`. Read back flag booleans and required binding presence only.

Run the `ALLOCATION` preflight with operator-owned expected values. Do not paste or commit those values:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 4 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_4" \
  --expected-stage=ALLOCATION \
  --expected-finance-pilot-only false \
  --expected-finance-ui-preview-enabled false \
  --expected-finance-pilot-default-date UNSET \
  --expected-finance-monthly-income-enabled false \
  --expected-worker-service pmc-finance-worker \
  --expected-queue pmc-revenue-allocation \
  --expected-worker-audience "$OPERATOR_EXPECTED_WORKER_AUDIENCE" \
  --expected-invoker "$OPERATOR_EXPECTED_INVOKER"
```

Require exact false/true/false flags, the approved project and region, exact queue/worker destination/invoker, queue and lease-bucket location/configuration, exact least-privilege queue/lease/Cloud Run policies with no public, broad, unexpected, or extra principal, a latest ready revision receiving zero traffic, three exact allocation headers, the exact four currently approved active immutable finance viewers, valid pending task hash/attempt fields, and no active lease older than 15 minutes. Report LINE linkage separately without revoking an approved latent grant. Scheduler absent or paused remains valid at this stage.

The checker must also inspect project-level IAM. A public project member or any project-level role granted to the runtime or OIDC invoker identity blocks `ALLOCATION`, `PILOT`, and `READY`, even when each resource policy is exact. Unrelated human/project administration bindings are reported only as unrelated and do not expand either runtime identity.

## Gate 8 — owner approval for the one-day source comparison

The approved comparison date is `2026-08-22`. Build the server and run exactly one seed:

```bash
npm run build:server
node scripts/seed-finance-report-day.mjs \
  --allow-readonly-production \
  --allow-cache-write \
  --project "$(gcloud config get-value project)" \
  --date 2026-08-22
```

The script refreshes `PAYMENT`, `REFUND`, and `PRODUCT_SALES` sequentially, with at least 20 seconds between report types, then seeds allocation coverage and performs bounded status reads only. It never calls `PAYMENT_DETAIL` directly.

If PAYMENT and item metadata hashes are unchanged but source success timestamps advance, refresh must rebind the existing COMPLETE coverage to those exact timestamps under the global fence without calling `PAYMENT_DETAIL` again. Until that rebind is durably stored, category money remains `CHECKING`.

Compare the approved source export with cache and allocation evidence. Require payment count and received satang equality, refund count and satang equality, per-payment `service + product + unclassified = paidAmountSatang`, and day-level category equality with received money. Category amounts partition received money; they are never added to it. Stop on missing/ambiguous/truncated detail, metadata mismatch, stale source timestamps, or incomplete coverage. Record only safe aggregate counts, integer satang totals, timestamps, hash prefix, and safe codes.

## Gate 9 — owner approval for the bounded 31-day backfill

Approve the exact latest 31 completed Bangkok dates and an absolute operator-owned resume-file path. Run oldest first:

```bash
node scripts/backfill-finance-report-days.mjs \
  --allow-readonly-production \
  --allow-cache-write \
  --project "$(gcloud config get-value project)" \
  --start-date <OLDEST_COMPLETED_DATE> \
  --end-date <NEWEST_COMPLETED_DATE> \
  --resume-file /operator-owned/path/pmc-finance-backfill.json
```

The range must contain 1–31 exact dates. The script reuses the one-day seed workflow, waits at least 20 seconds between source report types and at least 60 seconds between dates, and never requests payment detail directly. Its atomic resume file contains only `version`, `startDate`, `endDate`, `nextDate`, `completedDates`, and `safeFailures`. Resume from `nextDate`; stop on schema or authentication failure. After completion, require exact-day `PAYMENT`, `REFUND`, and `PRODUCT_SALES` cache state and coverage evidence for every day.

## Gate 10 — define Scheduler jobs without enabling them

Record the intended jobs but do not create or enable either Scheduler while the reviewed revision has zero traffic or split traffic. The current-day job is one bodyless POST every 15 minutes in `Asia/Bangkok` to the exact public `pmc-mini-app` `status.url` plus `/internal/mini-app/finance-current-seed`. Its OIDC audience is intentionally the verified private `JERA_ALLOCATION_WORKER_AUDIENCE`, and its attempt deadline is exactly 180 seconds.

The deferred previous-day job is one bodyless POST at `02:15 Asia/Bangkok` to the same exact public service origin plus `/internal/mini-app/finance-daily-seed`, with the same invoker, audience, and deadline. Do not record target URLs or identity values.

## Gate 11 — no-traffic tagged smoke and authorization rejection

Present the source-day comparison to the owner. Only after separate explicit approval set `JERA_FINANCE_CATEGORY_MONEY_ENABLED=true` and `PMC_FINANCE_REPORTS_ENABLED=true` on a tagged zero-traffic revision. Set `PMC_FINANCE_REPORTS_PILOT_ONLY=true`, `PMC_FINANCE_UI_PREVIEW_ENABLED=false`, `PMC_FINANCE_PILOT_DEFAULT_DATE=2026-08-22`, and `PMC_FINANCE_MONTHLY_INCOME_ENABLED=false` explicitly.

Keep both finance Scheduler jobs absent. Smoke the tagged revision directly: require health success, ordinary report authorization behavior, and explicit rejection from both seed routes when OIDC is missing or invalid. Confirm no provider write, Sheet write, task, or polling loop. Do not enable a Scheduler and do not run the `PILOT` checker while the reviewed revision is at 0% or any traffic split.

## Gate 12 — deterministic 100% cutover

After the tagged smoke passes, obtain separate approval and route exactly 100% to the one reviewed revision in a single deterministic cutover. Do not use a 10% split for this hotfix. Before creating any Scheduler, repeat health, daily/history/monthly, ordinary-staff, finance-staff, Booking, Stock, OCR, Drive, Calendar, LINE, Form fallback, and device checks. Stop and route 100% to the recorded rollback revision for any unexpected 5xx, Sheets 429, provider write, permission widening, stale/missing category guard, or regression.

## Gate 13 — post-cutover Scheduler and freshness verification

Only after the reviewed revision receives exactly 100% traffic on one target, create and enable the current-day Scheduler from Gate 10. Run it once, verify a successful current-day source refresh and fresh allocation coverage, then run the exact `PILOT` checker:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 4 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_4" \
  --expected-stage=PILOT \
  --expected-finance-pilot-only true \
  --expected-finance-ui-preview-enabled false \
  --expected-finance-pilot-default-date 2026-08-22 \
  --expected-finance-monthly-income-enabled false \
  --expected-worker-service pmc-finance-worker \
  --expected-queue pmc-revenue-allocation \
  --expected-worker-audience "$OPERATOR_EXPECTED_WORKER_AUDIENCE" \
  --expected-invoker "$OPERATOR_EXPECTED_INVOKER" \
  --expected-finance-current-seed-url "$OPERATOR_EXPECTED_FINANCE_CURRENT_SEED_URL"
```

`PILOT` requires the latest ready revision to receive exactly 100% traffic on one deterministic target, exactly one current-day candidate across all Scheduler states that is enabled and exact, and zero previous-day candidates. Its target origin must equal the described public service `status.url`; its OIDC audience must equal the deployed private worker audience. A paused duplicate fails.

For a later full `READY`, backfill and verify the approved range, set full-rollout controls, add the previous-day Scheduler, run it once, and verify freshness before the `READY` checker. `READY` requires latest-ready 100% traffic plus exactly one enabled exact candidate of each kind across all states. A paused/enabled duplicate or wrong host, path, method, body, schedule, audience, or invoker fails. Rollback begins by pausing both Scheduler jobs.

## Gate 14 — rollback approval and procedure

Rollback does not require deleting data:

1. pause both finance Scheduler jobs;
2. route 100% traffic to the rollback revision recorded before Gate 1;
3. verify health and ordinary authorization behavior; and
4. preserve JERA source cache, allocation cache, permission columns, Booking, Stock, OCR, Drive, Calendar, and LINE evidence for investigation.

Do not delete queues, cache tabs, allocation tabs, audit rows, permissions, evidence, or source exports during rollback. A later cleanup needs its own diagnosis and owner approval.

## Production approval stop

Before any live action, present the exact proposed no-traffic revision, rollback revision, queue settings, schema diff, four approved immutable staff IDs, source-day reconciliation table, test counts, and expected recurring runtime cost. This repository intentionally contains no completed Task 9 rollout evidence because no such live rollout has been approved or executed.
