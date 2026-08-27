# PMC LINE Mini App — Pilot and Cloud Run Runbook

**Status:** Local implementation only. This document does not authorize a deployment, Google permission change, Apps Script push, LINE Console change, or production booking.

## Safety boundary

- Cloud Run hosts only `/mini-app/*`, `/api/mini-app/*`, and the later internal JERA sync route.
- `BOOKING_MASTER` remains canonical. The Google Form remains the fallback throughout the pilot.
- Mini App identity is a server-verified LINE ID token mapped to active `CONFIG_STAFF` rows.
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
```

Secret Manager bindings:

```text
PMC_BOOKING_INGRESS_SECRET
PMC_MINI_APP_SIGNING_SECRET
```

Reserved for the separate read-only JERA reporting rollout:

```text
JERA_API_BASE_URL
JERA_DEFAULT_BRANCH_UUID
JERA_SYNC_INTERVAL_MINUTES
JERA_API_USERNAME
JERA_API_PASSWORD
```

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
git diff --check
```

The runtime checker reports names and presence only. It never prints values.

## Owner gate 1 — Google Cloud preparation

Stop for explicit owner approval before these actions.

1. Select the existing PMC Google Cloud project locally.
2. Use region `asia-southeast1` unless the owner selects another existing region.
3. Create a dedicated runtime service identity named `pmc-mini-app-runtime`.
4. Enable Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Sheets, and Drive APIs.
5. Grant only the roles required to deploy and read the two named secrets. Do not grant project Owner or Editor to the runtime identity.

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
```

Bind the runtime service identity as Secret Manager Secret Accessor on only these two secrets. Do not apply that role project-wide.

The Apps Script property `PMC_BOOKING_INGRESS_SECRET` must contain the same value as its Secret Manager counterpart. Updating or pushing Apps Script is a separate gate.

## Owner gate 3 — Sheet and Drive sharing

Stop for explicit approval before changing sharing.

1. Share only the canonical PMC booking spreadsheet with the runtime service identity as Editor.
2. Share only the configured private intake folder with the runtime identity. Do not share the Drive root or unrelated customer folders.
3. Keep the intake folder private to the clinic and runtime identity.
4. Confirm the identity cannot list or read unrelated Drive resources.

After approval and local ADC authentication, create or validate the four managed tabs with the already-built setup function:

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

Bind the two Booking secrets, set only the approved non-secret variables, and use the dedicated runtime service identity. The service must allow unauthenticated HTTP reachability because static LIFF assets and the public client-config endpoint must load; every operational API still requires a verified LINE ID token and active Staff mapping.

Acceptance order for the tagged revision:

1. `/healthz` returns 200.
2. `/mini-app/` serves the static shell without legacy Basic Auth.
3. `/api/mini-app/session` rejects a missing or invalid LINE token.
4. Legacy Dashboard, Booking webhook, OCR, Calendar, LINE, retry, call queue, and Google Form continue operating.
5. No request is sent to JERA.

## Owner gate 5 — Pilot enablement

Stop for explicit approval before enabling the flag.

1. Deploy another tagged/no-traffic revision with `PMC_MINI_APP_ENABLED=true`.
2. Add only approved pilot LINE users to active `CONFIG_STAFF` rows.
3. Submit one synthetic normal booking and one synthetic automatic booking.
4. Verify one Case ID per request, ordered evidence, Sheet rows, private Drive movement, Calendar behavior, Admin/doctor LINE behavior, and call-task rules.
5. Verify an unknown LINE user sees `รอผู้ดูแลอนุมัติ`.
6. Verify a duplicate confirmation returns the same Case ID.
7. Record only commit SHA, revision name, Case ID, safe counts, pass/fail, reviewer, and timestamp. Do not copy customer fields or tokens into rollout evidence.

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

## Render isolation

Do not deploy Mini App to Render. Keep `render.yaml` unchanged. Mini App and future JERA variables must remain absent from Render.
