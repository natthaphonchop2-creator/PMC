# PMC Google Booking Operations Pilot Runbook

## Pilot boundary

Use synthetic identities, synthetic phone numbers reserved for testing, non-customer images, and a copied privacy-safe JERA fixture. Do not use real customers during technical verification.

Pilot participants:

- one manager;
- one Admin/assistant;
- two doctor LINE groups; and
- the company automation account.

## Evidence register

For every scenario, record:

- Case ID;
- Form response timestamp;
- Booking status and version;
- Drive folder/file IDs;
- Calendar event ID;
- LINE destination and safe event type;
- call task state;
- JERA import file/hash/status;
- audit event IDs;
- retry/reconciliation IDs; and
- Dashboard KPI before/after values.

Do not paste tokens, full phone numbers, national IDs, slip/chat content, or unrestricted links into the register.

## Scenarios

### 1. Valid booking

Expected:

- one Case ID;
- one private Drive folder with renamed synthetic evidence;
- one event in the selected doctor's Calendar;
- one Admin-group LINE Flex with the approved slip/chat previews;
- one doctor-group LINE Flex with the necessary booking identity and no evidence image or URL;
- one open call task beginning on appointment day; and
- Dashboard booking/deposit counts increase once.

### 1A. Evidence media and Flex delivery

Expected:

- Cloud Run `/health` returns `200`, a missing token returns `400`, and an altered token returns `403`;
- valid synthetic JPEG/PNG previews return `200` without making Drive public;
- fetching the same permanent preview URL twice returns identical bytes;
- removing the Service Identity's Viewer permission makes the URL unavailable and restoring it recovers the same URL;
- the LINE official validator accepts both audience payloads;
- Admin receives the preview images and doctor receives no evidence component; and
- audit rows contain audience, version, count, and status only—never a signed URL, token, file ID, customer identity, or image content.

### 2. Calendar conflict

Expected:

- `TIME_CONFLICT` and `calendarState=CONFLICT`;
- no new Calendar event;
- no doctor LINE booking message; and
- Admin-visible exception.

### 3. Missing evidence

Expected:

- Form validation blocks submission or workflow rejects it;
- no Case ID reservation;
- no Drive, Calendar, or LINE side effect.

### 4. LINE retry

Simulate one non-2xx LINE response.

Expected:

- booking and Calendar remain valid;
- `lineState=RETRY`;
- one retry item with safe error;
- retry does not duplicate Drive or Calendar.

### 5. Call overdue

Advance a synthetic task beyond Day 7 without recording a call.

Expected:

- `CALL_OVERDUE`;
- reminder routed to Admin group and owner only once per day;
- Dashboard overdue count increases.

### 6. JERA paid match

Use one privacy-safe `ชำระแล้ว` row matching normalized phone plus name.

Expected:

- `CLOSED_JERA`;
- JERA payment ID consumed once;
- open call task cancelled;
- commission eligibility `PENDING_RULE`;
- commission amount blank.

### 7. Ambiguous JERA match

Create two open synthetic bookings with the same normalized name and phone.

Expected:

- no case closes;
- one `RECONCILIATION` item lists candidate Case IDs;
- manager identity/reason required for resolution.

### 8. Expiry and retention

Advance a synthetic case beyond six calendar months and then 90 days past terminal status.

Expected:

- `EXPIRED_6M` and call tasks cancelled;
- evidence enters retention approval queue;
- Drive evidence remains until manager approval;
- approval trashes only the evidence folder and appends an audit event.

### 9. Duplicate/replay safety

Resubmit the same Form response, JERA file content, JERA payment ID, LINE ingress nonce, and daily reminder run.

Expected:

- no duplicate Case ID, Calendar event, Drive evidence, closure, directory row, or same-day reminder.

## Verification commands

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npm run test
npm run build
git diff --check
```

## Go/no-go gates

Production is **NO-GO** if any of these are true:

- any test/build/lint command fails;
- either Google Form evidence question accepts file types other than images;
- a doctor receives another doctor's case;
- a LINE payload contains raw evidence, an unrestricted Drive link, or a national-ID-like value, or customer identity is routed to an unmapped group;
- Google closes a case without unique JERA `ชำระแล้ว` evidence;
- replay creates a duplicate side effect;
- a manager cannot trace a controlled change through `AUDIT_LOG`;
- a retention job deletes evidence without approval; or
- Google/LINE assets are not company-owned.

Production becomes **GO** only after the manager signs the evidence register and explicitly authorizes real-customer use.

## Evidence Flex pilot record — 2026-08-20

Verified with the approved synthetic case only:

- dedicated keyless Cloud Run Service Identity is healthy and has no Service Account JSON credential;
- valid evidence previews returned `200`; missing/altered tokens returned `400`/`403`;
- one synthetic slip and one synthetic chat preview were fetched successfully;
- permanent preview bytes were stable, folder-permission revocation returned `404`, and restoring Viewer access recovered `200` on the same URL;
- Apps Script production deployment is version `5`; the temporary evidence setup file was removed from the remote project;
- LINE official validation returned `200`;
- one Admin pilot push and one doctor pilot push returned `200`, with separate no-duplicate audit markers;
- Booking tests passed `64/64`; full project tests passed `275/275`; typecheck, lint, build, and `git diff --check` passed; and
- the two Google Form evidence questions still report file type `ANY`. Google Forms API does not support updating existing File Upload questions and the available browser accounts do not own the form. Real-customer use remains **NO-GO** until the form owner sets both questions to **Image only** and the setting is read back as `IMAGE`.

## Staff / AE Minimal Flex pre-deployment record — 2026-08-21

Verified locally with synthetic identity only:

- Booking tests passed `83/83`; full project tests passed `295/295`;
- Booking typecheck/build, project lint/build, and `git diff --check` passed;
- official LINE push-message validation returned `200` with no details;
- Admin payload contained the generated-logo URL and payment/chat evidence;
- doctor payload contained no payment/chat evidence;
- visible Admin/doctor Flex text contained no Case ID;
- neither payload contained the synthetic staff email; and
- no live Cloud Run, Apps Script, Form, Sheet, Calendar, or LINE-group state was changed in this local verification stage.

Live cutover remains **NO-GO** until `CONFIG_STAFF` is prepared and all seven personal closer emails are entered directly in Sheet without exposing them in source, commands, docs, or chat.

## Deferred live cutover record — 2026-08-21

Completed safely before the owner deferred personal-email entry:

- deployed the new keyless Cloud Run revision with the public PMC logo route;
- Cloud Run health/logo GET/logo HEAD returned `200`;
- the live logo is PNG `256x256` with alpha;
- evidence missing/altered token behavior remained `400`/`403`;
- Service Identity and Secret Manager remained attached with no JSON credential environment;
- created `CONFIG_STAFF` with seven legacy IDs/names/LINE mappings, blank personal emails, and both initial role flags enabled;
- inserted `aeId` and `aeName` without shifting the verified historical booking sample; and
- left the production Apps Script deployment and Booking Form label/accepting state unchanged.

The owner explicitly deferred email mapping and Form/Apps Script cutover. Resume only after all seven personal emails are entered directly in `CONFIG_STAFF`; then validate uniqueness, pause the Form, push/deploy the new Apps Script version, rename/sync the AE field, and resume responses.
