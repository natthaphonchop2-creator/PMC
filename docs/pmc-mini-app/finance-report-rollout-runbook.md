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
```

Deploy a tagged revision with zero traffic. Do not print or commit its URL, environment values, secret bindings, or resource IDs. Read back only the revision label, traffic percentage, flag booleans, and binding-presence booleans.

Run the stage-specific read-only check. At `DISABLED`, an absent/paused Scheduler and an absent latest no-traffic ready revision are valid; the three flags must be exactly false:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3 \
  --expected-stage=DISABLED
```

## Gate 2 — owner approval for queue, lease bucket, and least-privilege IAM

After separate approval, create the allocation queue in `asia-southeast1` with:

```text
queue: pmc-revenue-allocation
max concurrent dispatches: 1
max dispatch rate: 0.016 tasks/second
```

Grant only the runtime identity permission to enqueue that queue, the verified OIDC identity permission to invoke the no-traffic service, and the runtime identity the minimum object permission on the dedicated allocation lease bucket. Do not grant project Owner, Editor, broad Secret Manager, Cloud Tasks admin, Storage admin, or broad Cloud Run invoker roles.

Every task must contain a valid `metadataSnapshotHash` and integer `attempt`. Each task processes at most 20 payment-detail attempts; the worker keeps one provider request in flight and waits at least 3,000 ms between attempts. Continuations for a day wait at least 60 seconds. This preserves the global ceiling of 20 `PAYMENT_DETAIL` requests per minute even while multiple days are pending.

## Gate 3 — owner approval for managed allocation tabs

With approval for the canonical workbook only, build the server and run `ensureMiniAppWorkbook()`. It may create or validate these tabs only:

```text
JERA_PAYMENT_DETAIL_CACHE
JERA_PAYMENT_DETAIL_LINES
JERA_ALLOCATION_COVERAGE
```

Require exact header readback and frozen row 1 for all three. Stop on an incompatible header. Never rename, clear, delete, replace, or manually repair a tab to make setup pass.

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
  --expected-stage=DISABLED
```

Require exactly three active finance viewers and zero name-based derivations in the safe report. The `DISABLED` stage itself requires only the exact false flags, no enabled finance Scheduler, and a readable service; later stages make infrastructure and schema evidence blocking. `check` is read-only; it must never mutate Cloud or Sheets.

## Gate 7 — owner approval to enable allocation on zero traffic

Approve a new zero-traffic revision or configuration revision with `JERA_REVENUE_ALLOCATION_ENABLED=true`; keep both `PMC_FINANCE_REPORTS_ENABLED=false` and `JERA_FINANCE_CATEGORY_MONEY_ENABLED=false`. Read back flag booleans and required binding presence only.

Run the `ALLOCATION` preflight with operator-owned expected values. Do not paste or commit those values:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3 \
  --expected-stage=ALLOCATION \
  --expected-queue pmc-revenue-allocation \
  --expected-worker-audience "$OPERATOR_EXPECTED_WORKER_AUDIENCE" \
  --expected-invoker "$OPERATOR_EXPECTED_INVOKER"
```

Require exact false/true/false flags, the approved project and region, exact queue/worker destination/invoker, queue and lease-bucket location/configuration, least-privilege queue/lease/OIDC bindings, a latest ready revision receiving zero traffic, three exact allocation headers, exactly three immutable finance viewers, valid pending task hash/attempt fields, and no active lease older than 15 minutes. Scheduler absent or paused remains valid at this stage.

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

## Gate 10 — owner approval for Cloud Scheduler

Create one daily POST at `02:15 Asia/Bangkok` to `/internal/mini-app/finance-daily-seed` using the verified OIDC invoker. The route derives the previous completed Bangkok day; it does not accept a caller-supplied date and refreshes no other date. Verify schedule, time zone, enabled status, route, and OIDC binding by presence/status only. Do not record the target URL or identity value.

## Gate 11 — explicit category-money approval

Present the source-day comparison and 31-day cache/coverage counts to the owner. Only after separate explicit approval set `JERA_FINANCE_CATEGORY_MONEY_ENABLED=true` on a zero-traffic revision. Keep `PMC_FINANCE_REPORTS_ENABLED=false`.

Run synthetic daily, 31-day, monthly, ordinary-staff 403, and finance-staff 200 checks against the tagged zero-traffic revision. Confirm no provider write and no report GET-triggered refresh, Sheet write, task, or polling loop. Only after every check passes may the owner separately approve `PMC_FINANCE_REPORTS_ENABLED=true` on zero traffic.

After the report flag is enabled on zero traffic, run the final `READY` preflight with operator-owned expected values:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3 \
  --expected-stage=READY \
  --expected-queue pmc-revenue-allocation \
  --expected-worker-audience "$OPERATOR_EXPECTED_WORKER_AUDIENCE" \
  --expected-invoker "$OPERATOR_EXPECTED_INVOKER" \
  --expected-finance-seed-url "$OPERATOR_EXPECTED_FINANCE_SEED_URL" \
  --expected-oidc-audience "$OPERATOR_EXPECTED_OIDC_AUDIENCE"
```

Require exact true/true/true flags and every `ALLOCATION` requirement, plus exactly one enabled Scheduler candidate whose URL path is the finance daily-seed path. That sole candidate must use the exact HTTPS target, POST method, `02:15 Asia/Bangkok`, OIDC audience, and OIDC invoker. A missing/malformed feature flag, duplicate finance-seed candidate, wrong project, region, queue destination, worker host/path, Scheduler host/path/method, audience, or invoker fails closed. Unrelated enabled Scheduler paths are ignored. `READY` must pass before any canary traffic.

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
