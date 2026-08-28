# PMC LINE Mini App — Pilot and Cloud Run Runbook

**Status:** Booking V1 is deployed on Cloud Run. First-time LINE account linking remains disabled until the owner adds the enrollment PIN secret and explicitly enables it.

## Safety boundary

- Cloud Run hosts only `/mini-app/*`, `/api/mini-app/*`, and the later internal JERA sync route.
- `BOOKING_MASTER` remains canonical. The Google Form remains the fallback throughout the pilot.
- Mini App identity is a server-verified LINE ID token mapped to active `CONFIG_STAFF` rows.
- An unlinked active staff member can claim one unlinked `CONFIG_STAFF` name with the six-digit company PIN. A linked name cannot be overwritten through the Mini App.
- PIN failures are persisted by a keyed LINE-user hash; five failures lock linking for 15 minutes. Raw PIN values are never stored in Sheets or returned to the browser.
- Google access uses the Cloud Run service identity. Do not create or upload a service-account key file.
- Version 1 does not write to JERA.
- Render stays unchanged and receives no Mini App or JERA variables.

## Required configuration names

Non-secret Cloud Run variables:

```text
PMC_MINI_APP_ENABLED
PMC_MINI_APP_ID
PMC_MINI_APP_LIFF_CHANNEL_ID
PMC_SPREADSHEET_ID
PMC_DRIVE_INTAKE_FOLDER_ID
PMC_BOOKING_INGRESS_URL
PMC_BOOKING_FALLBACK_FORM_URL
PMC_MINI_APP_ENROLLMENT_ENABLED
PMC_STOCK_ENABLED
PMC_STOCK_MANAGER_PILOT_ONLY
```

Secret Manager bindings:

```text
PMC_BOOKING_INGRESS_SECRET
PMC_MINI_APP_SIGNING_SECRET
PMC_MINI_APP_ENROLLMENT_PIN (required only when PMC_MINI_APP_ENROLLMENT_ENABLED=true)
```

Reserved for the separate read-only JERA reporting rollout:

```text
JERA_API_BASE_URL
JERA_DEFAULT_BRANCH_UUID
JERA_SYNC_INTERVAL_MINUTES
JERA_API_USERNAME
JERA_API_PASSWORD
JERA_SCHEDULER_AUDIENCE
JERA_SCHEDULER_SERVICE_ACCOUNT_EMAIL
```

The exact disabled-first comparison, one-day GET, audit, scheduler, and rollback gates are documented in `docs/pmc-mini-app/jera-shadow-runbook.md`. That runbook still requires fresh owner approval before every Production action.

Do not bind JERA credentials during Booking-only acceptance. Never paste credential values into this repository, terminal history, screenshots, logs, Sheets, or LINE.

## Local verification gate

Run from the isolated implementation worktree:

```bash
npm ci
npx vitest run tests/pmc-mini-app
npx playwright test --config=playwright.mini-app.config.ts
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run build
npx eslint src/apps/pmc-mini-app server/pmc-mini-app tests/pmc-mini-app shared/pmcMiniAppBooking.ts apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests
node scripts/check-pmc-mini-app-runtime.mjs --env-file /dev/null
node scripts/check-jera-readonly-runtime.mjs --env-file /dev/null
git diff --check
```

The runtime checker reports names and presence only. It never prints values.

## Owner gate 1 — Google Cloud preparation

Stop for explicit owner approval before these actions.

1. Select the existing PMC Google Cloud project locally.
2. Use region `asia-southeast1` unless the owner selects another existing region.
3. Create a dedicated runtime service identity named `pmc-mini-app-runtime`.
4. Enable Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Sheets, and Drive APIs.
5. Grant only the roles required to deploy and read the named secrets. Do not grant project Owner or Editor to the runtime identity.

Suggested resource names:

```text
Cloud Run service: pmc-mini-app
Runtime service account: pmc-mini-app-runtime
Pilot revision tag: pilot
```

## Owner gate 2 — Secret Manager

The owner enters each value directly through Google Cloud Console or an interactive local command. Codex must not request or display the values.

Create separate secrets named exactly:

```text
PMC_BOOKING_INGRESS_SECRET
PMC_MINI_APP_SIGNING_SECRET
PMC_MINI_APP_ENROLLMENT_PIN
```

Bind the runtime service identity as Secret Manager Secret Accessor on only these named secrets. Do not apply that role project-wide. Enter the six-digit enrollment PIN interactively; never place it in shell history, source, logs, screenshots, Sheets, LINE, or a `.env` file.

The Apps Script property `PMC_BOOKING_INGRESS_SECRET` must contain the same value as its Secret Manager counterpart. Updating or pushing Apps Script is a separate gate.

## Owner gate 3 — Sheet and Drive sharing

Stop for explicit approval before changing sharing.

1. Share only the canonical PMC booking spreadsheet with the runtime service identity as Editor.
2. Share only the configured private intake folder with the runtime identity. Do not share the Drive root or unrelated customer folders.
3. Keep the intake folder private to the clinic and runtime identity.
4. Confirm the identity cannot list or read unrelated Drive resources.

After approval and local ADC authentication, create or validate the eight managed tabs with the already-built setup function:

```bash
npm run build:server
node --input-type=module -e '
import { createMiniAppGooglePorts } from "./dist-server/server/pmc-mini-app/googleClient.js";
import { ensureMiniAppWorkbook } from "./dist-server/server/pmc-mini-app/setup.js";
const spreadsheetId = process.env.PMC_SPREADSHEET_ID;
const intakeFolderId = process.env.PMC_DRIVE_INTAKE_FOLDER_ID;
if (!spreadsheetId || !intakeFolderId) throw new Error("Required Google resource IDs are absent");
const google = createMiniAppGooglePorts({ spreadsheetId, intakeFolderId });
await ensureMiniAppWorkbook({ spreadsheetId, sheets: google.sheets });
console.log(JSON.stringify({ managedTabsReady: true }));
'
```

This creates only missing managed tabs, validates existing headers, and freezes row 1. It preserves every existing tab and value.

For Stock, the mandatory readback is all three tabs with these exact headers and frozen row 1:

```text
STOCK_PRODUCTS: productId, name, normalizedName, category, unit, minimumQuantityMilli, active, createdAt, createdByStaffId, updatedAt, updatedByStaffId, version
STOCK_LEDGER: transactionId, documentId, requestId, lineNumber, productId, transactionType, quantityDeltaMilli, balanceBeforeMilli, balanceAfterMilli, actorStaffId, actorDisplayName, reason, idempotencyKey, createdAt
STOCK_AUDIT: eventId, requestId, actorStaffId, action, status, safeErrorCode, targetProductIdsJson, correlationId, createdAt
```

The setup gate fails if any existing managed header is incompatible. Do not rename a header, clear a tab, delete a tab, or replace an existing Stock row to make setup pass.

## Owner gate 4 — Apps Script ingress

Before pushing Apps Script:

1. Run Booking tests, typecheck, and build.
2. Review the generated Apps Script diff.
3. Confirm the active Google account owns the correct PMC Apps Script project.
4. Obtain explicit owner approval.
5. Push with `npm run booking:push`.
6. Verify the legacy LINE directory ingress still accepts its existing signed payload.
7. Verify unknown kinds, altered signatures, expired timestamps, replayed nonces, and conflicting request hashes are rejected.

Do not submit a real booking at this gate.

## Disabled-first Cloud Run rollout

Create a no-traffic tagged revision with:

```text
PMC_MINI_APP_ENABLED=false
```

Bind the Booking secrets, set only the approved non-secret variables, and use the dedicated runtime service identity. The service must allow unauthenticated HTTP reachability because static LIFF assets and the public client-config endpoint must load; every operational API still requires a verified LINE ID token and active Staff mapping.

Acceptance order for the tagged revision:

1. `/healthz` returns 200.
2. `/mini-app/` serves the static shell without legacy Basic Auth.
3. `/api/mini-app/session` rejects a missing or invalid LINE token.
4. Legacy Dashboard, Booking webhook, OCR, Calendar, LINE, retry, call queue, and Google Form continue operating.
5. No request is sent to JERA.

## Stock rollout — disabled-first, managers-only pilot

Stock is a separate gate layered on top of the Booking Mini App. No step below authorizes a Production action by itself. Stop for fresh owner approval before Apps Script push/deploy, Sheet setup, Cloud Run revision changes, synthetic writes, or pilot traffic.

### Gate S0 — exact manager identities

The only initial Stock managers are:

```text
shared-account-test  owner/Admin
ADMIN_07             อาย
ADMIN_03             หมวย
```

Every other `CONFIG_STAFF` row must read back `canManageStock=false`. All three named rows must exist exactly once and remain active before running `configureStockManagersWorkflow()`. The workflow writes only the `canManageStock` column, verifies the written booleans by readback, and must return `managerCount: 3`. Re-open `CONFIG_STAFF` and confirm the exact three IDs above are `TRUE` and every other row is `FALSE` before continuing.

Do not delete a staff row while any Stock journal is unresolved. Recovery resolves the original actor by staff ID even if that row is now inactive; deleting the row can make deterministic recovery impossible.

### Gate S1 — initial disabled Cloud Run revision

Create a tagged/no-traffic revision with both flags explicit:

```text
PMC_STOCK_ENABLED=false
PMC_STOCK_MANAGER_PILOT_ONLY=true
```

Bind `PMC_STOCK_INGRESS_URL` and `PMC_STOCK_INGRESS_SECRET`, but do not print their values. Run:

```bash
node scripts/check-pmc-mini-app-runtime.mjs --env-file /path/to/operator-owned/runtime.env --strict
```

The report may show only flag booleans plus binding names/presence. It must never show ingress URLs, secret values, Sheet IDs, LINE IDs, or tokens. Verify Stock routes fail closed and the Stock Home card remains disabled while Booking, Google Form fallback, OCR, JERA read-only behavior, Calendar, LINE, and existing webhooks remain unchanged.

### Gate S2 — Apps Script source and immutable deployment

After a reviewed local build and explicit owner approval:

1. Confirm `clasp status` targets the canonical PMC Apps Script project.
2. Run `npm run booking:test`, `npm run booking:typecheck`, and `npm run booking:build`.
3. Review the generated Apps Script diff and confirm no unrelated function changed.
4. Push source with `npm run booking:push`.
5. Create an immutable Apps Script version with `clasp version "PMC Stock pilot"`; record only the returned version number.
6. Update the current web-app deployment with `clasp deploy -i <CURRENT_DEPLOYMENT_ID> -V <IMMUTABLE_VERSION> -d "PMC Stock pilot"`. Do not create a second public ingress deployment.
7. Read back the current deployment and confirm it points to that immutable version before changing any Cloud Run Stock flag.

Never place the deployment ID, unrestricted web-app URL, or ingress secret in this repository or rollout evidence.

### Gate S3 — managed tabs and managers

With separate approval for the canonical spreadsheet:

1. Run the managed-tab setup from Owner gate 3.
2. Read back the exact three Stock headers, frozen row 1, unchanged pre-existing tab count, and zero deleted tabs.
3. Run `configureStockManagersWorkflow()` once.
4. Read back exactly the three manager IDs from Gate S0 and confirm all other staff rows are false.
5. Record safe evidence only: header pass/fail, frozen-row pass/fail, manager count, changed-row count, reviewer, and timestamp.

### Gate S4 — synthetic ledger lifecycle

Keep Cloud Run disabled. Using synthetic product names only, run this exact lifecycle through the signed command path and read projection:

```text
CREATE opening 10
RECEIVE +5
ISSUE   -8
ADJUST  -1 to counted quantity 6, reason "ตรวจนับสิ้นวัน"
final balance 6
exact deltas [10, +5, -8, -1]
```

Then attempt an issue greater than 6. It must return `STOCK_INSUFFICIENT_BALANCE`, create no new ledger row, leave the balance at 6, and preserve the prior accepted documents. Repeat one accepted request ID with the exact same payload; it must return the original document and create no duplicate row.

Journal recovery is fail-closed:

- `PREPARED` without matching `ACCEPTED` may block every different write with `STOCK_RECOVERY_REQUIRED`.
- Recover only by replaying the exact original request ID, actor ID, command type, and payload after verifying the existing Product/Ledger state.
- Never manually append `ACCEPTED`, edit a prepared fingerprint, delete the actor staff row, or delete/replace Product, Ledger, or Audit rows to bypass recovery.
- Recovery and rollback never delete Stock rows or Stock tabs.

### Gate S5 — manager-only pilot

After Gate S4 passes and the owner approves the exact revision, deploy/tag a pilot revision with:

```text
PMC_STOCK_ENABLED=true
PMC_STOCK_MANAGER_PILOT_ONLY=true
```

Only the three managers from Gate S0 may see Stock. All other active staff must receive `stockEnabled=false`, have no Stock navigation, and remain unable to call Stock routes. Verify manager create, receive, adjust, product management, history reason visibility, and safe retry. Verify a normal staff identity cannot see or invoke manager controls.

Run the complete browser acceptance on an Android-sized viewport, then manually repeat the same manager and staff paths in both Android LINE WebView and iPhone LINE WebView. Confirm Thai marks are not clipped, touch targets remain reachable, history expands in place, load-more uses the opaque cursor, no console error appears, and no Stock screen contains a Google Sheet link or edit-history action.

### Gate S6 — owner approval before all-staff access

Present only commit SHA, Cloud Run revision name, Apps Script immutable version number, safe synthetic document IDs, row counts, final balance, exact manager IDs, pass/fail, reviewer, and timestamps. Do not include product-sensitive notes, Sheet IDs, LINE IDs, tokens, secrets, request bodies, or unrestricted URLs.

Keep manager-only mode until the owner explicitly approves all-staff enablement. Only after that approval may a new revision set:

```text
PMC_STOCK_ENABLED=true
PMC_STOCK_MANAGER_PILOT_ONLY=false
```

Re-run active-staff issue, manager authorization, Android/iPhone LINE WebView, idempotency, insufficient-balance, history, and no-Sheet-link checks before routing all traffic.

## Owner gate 5 — Pilot enablement

Stop for explicit approval before enabling the flag.

1. Deploy another tagged/no-traffic revision with `PMC_MINI_APP_ENABLED=true`.
2. Start with `PMC_MINI_APP_ENROLLMENT_ENABLED=false`; confirm Booking APIs remain healthy.
3. After the owner adds the PIN secret, enable first-time linking and let each staff member claim only their own unlinked name.
4. Submit one synthetic normal booking and one synthetic automatic booking.
5. Verify one Case ID per request, ordered evidence, Sheet rows, private Drive movement, Calendar behavior, Admin/doctor LINE behavior, and call-task rules.
6. Verify a valid LINE user sees the one-time linking form, a wrong PIN remains generic, five failures lock for 15 minutes, and a linked name cannot be claimed again.
7. Verify a duplicate confirmation returns the same Case ID.
8. Record only commit SHA, revision name, Case ID, safe counts, pass/fail, reviewer, and timestamp. Do not copy customer fields or tokens into rollout evidence.

## Owner gate 6 — Rich Menu switch

Change `PMC notification` Rich Menu only after the pilot revision passes and the owner approves the exact LIFF URL.

- Primary destination: LINE Mini App.
- Fallback: the existing Google Form remains available in Account and in the rollback Rich Menu.
- Do not remove Form triggers, Sheet schema, Calendar, Drive, LINE, call queue, retry queue, or Dashboard paths.

## Retention

Cancelled, expired, or abandoned draft evidence is marked `PENDING_APPROVAL`. Do not permanently delete evidence automatically. Use the existing retention approval boundary before any cleanup.

## Rollback

Rollback is non-destructive:

1. Set `PMC_MINI_APP_ENABLED=false` or send 100% traffic to the last disabled revision.
2. Restore the Rich Menu destination to the existing Google Form.
3. Keep Apps Script Form triggers, Booking Sheet rows, audit records, and evidence intact.
4. Pause the later JERA scheduler if it has been created; Booking rollback must not alter JERA records.
5. Diagnose from safe error codes and revision logs. Never print request bodies, LINE tokens, credentials, customer names, phone numbers, or unrestricted Drive URLs.

Stock rollback is non-destructive and independent of Booking rollback:

1. Set `PMC_STOCK_ENABLED=false` in a new revision or route traffic to the last known-good Stock-disabled revision.
2. Keep `PMC_STOCK_MANAGER_PILOT_ONLY=true` while diagnosing.
3. Preserve `STOCK_PRODUCTS`, `STOCK_LEDGER`, `STOCK_AUDIT`, and every `CONFIG_STAFF` row involved in an unresolved journal.
4. Never delete, clear, replace, reorder, or hand-edit Stock rows during rollback or recovery.
5. If a `PREPARED` journal remains unresolved, stop new writes, preserve all rows, and follow Gate S4 recovery with the exact original request.

## Render isolation

Do not deploy Mini App to Render. Keep `render.yaml` unchanged. Mini App and future JERA variables must remain absent from Render.
