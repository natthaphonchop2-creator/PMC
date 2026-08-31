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

Before every checker invocation, the operator must set the three owner-approved immutable `CONFIG_STAFF.id` values in the current shell. These values are operator input; do not hard-code or commit them:

```bash
export OPERATOR_FINANCE_STAFF_ID_1="<approved-staff-id-1>"
export OPERATOR_FINANCE_STAFF_ID_2="<approved-staff-id-2>"
export OPERATOR_FINANCE_STAFF_ID_3="<approved-staff-id-3>"
```

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
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

Deploy the reviewed image as a separate private Cloud Run service named `pmc-finance-worker`. The public `pmc-mini-app` LIFF service must not be treated as the worker IAM boundary. Queue and Scheduler OIDC requests target only the private worker service; the worker policy contains only the dedicated invoker.

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

Keep every finance permission false while producing a roster containing only immutable staff ID, name, active status, and the three finance booleans. The owner must separately confirm exactly three immutable IDs: owner, doctor, and Mus.

Set `canViewFinance=true` only for those three confirmed IDs. Leave `canSubmitExpense=false` and `canManageExpense=false` for every row in this report-only release. Never derive a role from a name, email, or LINE user ID, and never print LINE user IDs.

Build the server before using the checker, then run the read-only preflight:

```bash
npm run build:server
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
  --expected-stage=DISABLED \
  --expected-finance-pilot-only false \
  --expected-finance-ui-preview-enabled false \
  --expected-finance-pilot-default-date UNSET \
  --expected-finance-monthly-income-enabled false
```

Require the exact three operator-provided IDs, with each row active, LINE-linked, and `canViewFinance=true`, and no additional `canViewFinance=true` row. The `DISABLED` stage itself requires exact false feature flags, exact disabled rollout controls, no enabled finance Scheduler, and a readable service; later stages make staff, infrastructure, IAM, and schema evidence blocking. `check` is read-only; it must never mutate Cloud or Sheets.

## Gate 7 — owner approval to enable allocation on zero traffic

Approve a new zero-traffic revision or configuration revision with `JERA_REVENUE_ALLOCATION_ENABLED=true`; keep both `PMC_FINANCE_REPORTS_ENABLED=false` and `JERA_FINANCE_CATEGORY_MONEY_ENABLED=false`. Keep `PMC_FINANCE_REPORTS_PILOT_ONLY=false`, `PMC_FINANCE_UI_PREVIEW_ENABLED=false`, the pilot date unset, and `PMC_FINANCE_MONTHLY_INCOME_ENABLED=false`. Read back flag booleans and required binding presence only.

Run the `ALLOCATION` preflight with operator-owned expected values. Do not paste or commit those values:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
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

Require exact false/true/false flags, the approved project and region, exact queue/worker destination/invoker, queue and lease-bucket location/configuration, exact least-privilege queue/lease/Cloud Run policies with no public, broad, unexpected, or extra principal, a latest ready revision receiving zero traffic, three exact allocation headers, the exact three active LINE-linked immutable finance viewers, valid pending task hash/attempt fields, and no active lease older than 15 minutes. Scheduler absent or paused remains valid at this stage.

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

## Gate 10 — deferred full-rollout Cloud Scheduler

Do not create or enable the finance Scheduler for the one-day pilot. The `PILOT` preflight requires zero enabled finance-seed Scheduler candidates.

Only when leaving the one-day pilot for full `READY`, create one daily POST at `02:15 Asia/Bangkok` to `/internal/mini-app/finance-daily-seed` using the verified OIDC invoker. The route derives the previous completed Bangkok day; it does not accept a caller-supplied date and refreshes no other date. Verify schedule, time zone, enabled status, route, and OIDC binding by presence/status only. Do not record the target URL or identity value.

## Gate 11 — explicit category-money approval

Present the source-day comparison to the owner. Only after separate explicit approval set `JERA_FINANCE_CATEGORY_MONEY_ENABLED=true` and `PMC_FINANCE_REPORTS_ENABLED=true` on a zero-traffic one-day pilot revision. Set `PMC_FINANCE_REPORTS_PILOT_ONLY=true`, `PMC_FINANCE_UI_PREVIEW_ENABLED=false`, `PMC_FINANCE_PILOT_DEFAULT_DATE=2026-08-22`, and `PMC_FINANCE_MONTHLY_INCOME_ENABLED=false` explicitly. Keep the finance Scheduler absent.

Run the one-day daily report, ordinary-staff 403, finance-staff 200, and direct monthly 403 checks against the tagged zero-traffic revision. Confirm no provider write and no report GET-triggered refresh, Sheet write, task, or polling loop.

Run the exact `PILOT` preflight with operator-owned expected infrastructure values:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
  --expected-stage=PILOT \
  --expected-finance-pilot-only true \
  --expected-finance-ui-preview-enabled false \
  --expected-finance-pilot-default-date 2026-08-22 \
  --expected-finance-monthly-income-enabled false \
  --expected-worker-service pmc-finance-worker \
  --expected-queue pmc-revenue-allocation \
  --expected-worker-audience "$OPERATOR_EXPECTED_WORKER_AUDIENCE" \
  --expected-invoker "$OPERATOR_EXPECTED_INVOKER"
```

Require exact true/true/true flags, exact one-day pilot controls, every `ALLOCATION` requirement, and zero enabled finance-seed Scheduler candidates. A missing or malformed boolean is not `false`; an absent, malformed, or different pilot date fails closed. `PILOT` must pass before any pilot traffic.

For a later full rollout, backfill and verify the approved range, then explicitly set `PMC_FINANCE_REPORTS_PILOT_ONLY=false`, `PMC_FINANCE_UI_PREVIEW_ENABLED=false`, unset `PMC_FINANCE_PILOT_DEFAULT_DATE`, and set `PMC_FINANCE_MONTHLY_INCOME_ENABLED=true`. Enable the single Scheduler described in Gate 10 and run the full `READY` preflight:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3 \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_1" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_2" \
  --approved-finance-staff-id "$OPERATOR_FINANCE_STAFF_ID_3" \
  --expected-stage=READY \
  --expected-finance-pilot-only false \
  --expected-finance-ui-preview-enabled false \
  --expected-finance-pilot-default-date UNSET \
  --expected-finance-monthly-income-enabled true \
  --expected-worker-service pmc-finance-worker \
  --expected-queue pmc-revenue-allocation \
  --expected-worker-audience "$OPERATOR_EXPECTED_WORKER_AUDIENCE" \
  --expected-invoker "$OPERATOR_EXPECTED_INVOKER" \
  --expected-finance-seed-url "$OPERATOR_EXPECTED_FINANCE_SEED_URL" \
  --expected-oidc-audience "$OPERATOR_EXPECTED_OIDC_AUDIENCE"
```

`READY` requires exact true/true/true flags, exact full-rollout controls, every `ALLOCATION` requirement, and exactly one enabled Scheduler candidate whose URL path is the finance daily-seed path. That sole candidate must use the exact HTTPS target, POST method, `02:15 Asia/Bangkok`, OIDC audience, and OIDC invoker. A duplicate candidate or any wrong project, region, queue destination, worker host/path, Scheduler host/path/method, audience, or invoker fails closed. Unrelated enabled Scheduler paths are ignored.

## Gate 12 — explicit 10% traffic approval

Route exactly 10% to the approved finance revision. Observe at least 30 minutes. Stop and roll back for unexpected 5xx, Sheets 429, queue retry storm, Scheduler error, provider write, permission widening, allocation mismatch, stale/missing category guard, or regression in Booking, Stock, OCR, Drive, Calendar, LINE, or Form fallback.

Record only approved revision labels, traffic percentages, aggregate request/error counts, queue status/counts, viewer count, and timestamps.

## Gate 13 — explicit 100% traffic approval

After the 10% observation passes, obtain separate approval to route 100%. Repeat daily, history, monthly, ordinary-staff, finance-staff, and device checks. Record exact approved revision labels and safe counts; never record URLs, resource IDs, tokens, provider rows, patient data, Sheet IDs, or LINE IDs.

## Gate 14 — rollback approval and procedure

Rollback does not require deleting data:

1. pause the finance daily Scheduler;
2. route 100% traffic to the rollback revision recorded before Gate 1;
3. verify health and ordinary authorization behavior; and
4. preserve JERA source cache, allocation cache, permission columns, Booking, Stock, OCR, Drive, Calendar, and LINE evidence for investigation.

Do not delete queues, cache tabs, allocation tabs, audit rows, permissions, evidence, or source exports during rollback. A later cleanup needs its own diagnosis and owner approval.

## Production approval stop

Before any live action, present the exact proposed no-traffic revision, rollback revision, queue settings, schema diff, three approved immutable staff IDs, source-day reconciliation table, test counts, and expected recurring runtime cost. This repository intentionally contains no completed Task 9 rollout evidence because no such live rollout has been approved or executed.
