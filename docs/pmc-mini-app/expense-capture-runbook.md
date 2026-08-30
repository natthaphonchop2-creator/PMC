# PMC expense capture rollout runbook

This runbook is the owner-gated procedure for the first expense-capture release. It is not authorization to change Google Drive, Sheets, GCS, Cloud Run, Apps Script, IAM, Scheduler, secrets, feature flags, traffic, or production records.

The first release enables only `BILL_DOCUMENT`, `BOOK_CLINIC`, and `BOOK_DOCTOR_PERSONAL`. Salary, employee DF, doctor DF, OCR, approval, accounting posting, and all unresolved revenue/allocation/category rollout flags remain disabled.

## Required rollout order

Do not skip, merge, or reorder these steps.

1. Deploy Cloud Run and Apps Script code with `PMC_EXPENSE_CAPTURE_ENABLED=false` and `PMC_FINANCE_READS_ENABLED=false`.
2. Configure the private finance folder, finance master workbook, expense staging bucket, existing Apps Script deployment URL, and a distinct expense-ingress HMAC secret in both Secret Manager/Cloud Run and Apps Script properties. Configure the dedicated recovery OIDC bindings `PMC_EXPENSE_RECOVERY_AUDIENCE` and `PMC_EXPENSE_RECOVERY_TASK_INVOKER_EMAIL`; the audience is the Cloud Run HTTPS origin and the Scheduler/Cloud Tasks target URL ends exactly `/internal/mini-app/recover-expenses`. These bindings are independent of async Booking. Never reuse the Booking ingress secret or Mini App browser-signing secret. Never print secret values or private resource IDs in logs or reports.
3. Apply a GCS lifecycle rule that deletes expense staging objects after exactly 1 day. The rule must not target committed or voided Drive evidence.
4. Run `setupPmcExpenseFinanceStorage` and verify exact finance master/month headers and readback before continuing.
5. Run the compatible `CONFIG_STAFF` migration and verify that `canSubmitExpense`, `canViewFinance`, and `canManageExpense` are all boolean `false` for every row.
6. Run `preparePmcExpensePermissions`; review only the safe staff ID/name roster and obtain owner approval. Do not expose LINE user IDs.
7. Set the explicit submitter IDs and the three owner-verified manager IDs in Apps Script properties, obtain cutover approval, then run `applyPmcExpensePermissions`.
8. Enable `PMC_FINANCE_READS_ENABLED` for the three managers only, keep `PMC_EXPENSE_CAPTURE_ENABLED=false`, and run the read-only checker.
9. Grant `canSubmitExpense` initially only to the same three approved IDs, then enable `PMC_EXPENSE_CAPTURE_ENABLED`.
10. Submit exactly one bill, one clinic-book day, one doctor-personal day, one duplicate-book conflict, and one lost-response retry.
11. Verify that monthly clinic expense excludes doctor-personal expense and that every durable receipt has private evidence available only through verified finance access.
12. Obtain a new owner approval, then grant `canSubmitExpense` to additional explicitly reviewed staff IDs. New staff remain denied by default.

## Disabled-feature preflight and checker

The checker is read-only and consumes a sanitized local snapshot. It never accepts or prints secret values, LINE tokens, Apps Script URLs, workbook/folder/file IDs, bucket names, or Drive metadata.

```bash
node scripts/check-pmc-expense-runtime.mjs \
  --snapshot-file /absolute/path/to/sanitized-expense-runtime-snapshot.json \
  --expected-target pmc-mini-app \
  --expected-environment production \
  --strict
```

The snapshot must be collected with separately approved read-only operator access and must contain only safe statuses, booleans, binding names, selected-month request counts, lifecycle days, recovery configuration booleans/path, and header arrays. The preflight profile is exactly `DISABLED_PREFLIGHT`: `PMC_EXPENSE_CAPTURE_ENABLED=false` and `PMC_FINANCE_READS_ENABLED=true` after the three manager grants in step 8. Any other flag combination fails strict mode.

### Read-only snapshot collector procedure

The operator collecting the snapshot must perform these read-only checks against one named target/environment within one 15-minute window:

1. GET `/api/healthz` and record only the status.
2. GET `/api/mini-app/config` with the approved manager probe identity and inspect it in memory. Persist a redacted key/type map only: keep the five finance booleans as booleans, retain other key names only with a fixed non-sensitive placeholder, and never persist their original values. The exact manager profile at this gate is `expenseCaptureEnabled=false`, `financeReadsEnabled=true`, `canSubmitExpense=false`, `canViewFinance=true`, and `canManageExpense=true`; any mismatch fails. This lets the checker detect contradictory rollout state or forbidden finance-private keys without storing private IDs or URLs.
3. Use the submit-only probe identity against the exact history and evidence-token routes; persist only status and safe error code.
4. Invoke the finance read port with one selected `YYYY-MM` while wrapping `readMonth`; persist only the selected month and requested-month list.
5. Read Cloud Run binding names, the GCS lifecycle, and the exact recovery Scheduler/Cloud Tasks target/audience/invoker through approved read-only describe operations; persist names, booleans, path, and lifecycle days only.
6. Read only header rows from the finance master, one selected monthly ledger, and `CONFIG_STAFF`; persist header strings only.
7. Add provenance with `schemaVersion=1`, `profile=DISABLED_PREFLIGHT`, the approved logical target/environment, the UTC `collectedAt`, and all seven source checks set true only after their read completed. Do not copy tokens, secret values, URLs, bucket/workbook/folder/file IDs, provider payloads, or evidence into the snapshot.
8. Run the checker before the fixed 900-second maximum age expires. Missing, future, stale, target-mismatched, environment-mismatched, or incomplete source provenance fails closed.

The checker verifies:

- `/api/healthz` returned 200;
- Mini App config contains the five expense/finance permission booleans and no finance-private keys;
- the disabled-preflight flag profile is exact and all seven required private/recovery binding names are coherent;
- submit-only history and evidence requests both returned 403 `EXPENSE_FINANCE_PERMISSION_REQUIRED`;
- the finance projection requested exactly one selected `YYYY-MM` ledger;
- the staging lifecycle is exactly 1 day;
- the recovery target is exactly `/internal/mini-app/recover-expenses` with configured OIDC audience and task-invoker identity; and
- Apps Script finance master/month topology and the 12-column `CONFIG_STAFF` header are exact.

The Task 10 implementation and tests use local fakes and explicit local snapshots only. The procedure above documents future collection; it was not executed against Production. No production preflight or owner gate has been executed.

## Recovery operator

The recovery target is `POST /internal/mini-app/recover-expenses` with no body and no query string. It requires the existing configured Google OIDC task-invoker identity. Cloud Run binds the verified worker email and subject plus a correlation ID into the distinct expense HMAC envelope sent to the existing Apps Script deployment URL.

A successful response contains only:

```json
{"recovered":0,"abandoned":0,"unchanged":0,"failed":0}
```

Logs contain only the correlation ID and `EXPENSE_RECOVERY_COMPLETED` or `EXPENSE_RECOVERY_FAILED`. They must never contain counts, worker identity, secrets, URLs, provider bodies, or private IDs.

## Exact rollback

Rollback is exactly:

1. Set `PMC_EXPENSE_CAPTURE_ENABLED=false` and `PMC_FINANCE_READS_ENABLED=false`.
2. Redeploy.
3. Do not manually edit or delete any private ledger row or evidence object as part of the flag/deploy rollback.
4. Run recovery once for existing `PREPARED` rows through the authenticated recovery endpoint.
5. Confirm Booking, Stock, and reports remain healthy.

Rollback never deletes committed, voided, or prepared finance data. It never deletes committed or voided evidence. Staging lifecycle cleanup remains limited to the approved 1-day expense staging boundary; committed and voided evidence remains retained until a separately approved finance-retention policy exists.

The authenticated recovery pass in step 4 is the only intentional finance mutation during rollback: it may idempotently finish a durable partial commit or change a stale `PREPARED` row to terminal `VOID` with an append-only `ABANDON` audit. That governed recovery mutation is not a manual ledger edit or deletion.
