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

## Full-identity Calendar pilot — 2026-08-21

The owner approved full customer name and full phone visibility on the doctor Calendar plus Google Calendar event color `5` (`Banana`).

Verified with a synthetic customer only:

- created one active event on the mapped doctor Calendar for `22 August 2026 10:00–11:00 Asia/Bangkok`;
- readback duration was `60` minutes;
- event color ID was `5`;
- the event title contained the complete synthetic customer name and phone;
- the description contained the synthetic service and internal Case ID reference;
- exactly one active event matched the private Case ID in the appointment window; and
- the event remains on the Calendar for owner review.

The repository Calendar builder now produces this full-identity/color contract. Automatic Form-created events will adopt it when the deferred Apps Script/AE cutover is deployed; production Apps Script version 5 remains unchanged until then.

## Live phone validation and v5 schema recovery — 2026-08-21

- A Form submission was received with all required answers, but `onBookingFormSubmit` failed before Case ID allocation because the test phone contained only eight digits.
- No Booking row, response map, Audit, Retry, Drive, Calendar, or LINE side effect was created by that failed response.
- Removed the two empty pre-cutover `aeId`/`aeName` columns from live `BOOKING_MASTER`, restoring the 51-column schema expected by production Apps Script version 5; the historical sample remained aligned.
- Added Google Form response validation `^0[0-9]{9}$` to `เบอร์มือถือ` with the help/error message `กรุณากรอกเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0 เช่น 0800000000`.
- Browser readback showed an eight-digit synthetic value was rejected and the ten-digit value `0800000000` had no phone-format alert. The Form was not submitted during validation QA.
- Removed the temporary setup helper after success. Remote Apps Script files returned to `Code` and `appsscript`, and the production v5 Code hash remained unchanged.

## Staff profile avatar production cutover — 2026-08-21

- Deployed Cloud Run revision `pmc-booking-evidence-proxy-avatar-1f89bc3` with 100% traffic, the existing keyless Service Identity, and the existing Secret Manager binding.
- Verified health/logo, evidence guard `400/403`, and all six allowlisted `256x256` JPEG profile routes. Production SHA-256 values matched the reviewed local assets; unknown profile names and non-GET/HEAD requests returned `404`.
- Added the canonical `profileImageUrl` column to live `CONFIG_STAFF`. The first guarded configuration run detected the eighth system row `Admin` and stopped before any profile URL write; readback confirmed the new column was still blank.
- Updated the exact live roster mapping and reran successfully after a timestamped Spreadsheet backup. Readback showed eight staff rows, six Cloud Run profile URLs, and two intentional blanks (`ฝ้าย` and `Admin`).
- Deployed Apps Script version `8` through the existing deployment ID. Form URL/questions, Calendar state, and the five installable triggers were not changed.
- The official LINE push validator initially identified unsupported `cornerRadius` on the nested image component. Removed that one image property while retaining the circular parent box, reran local regression, and received final LINE validator `200` through a synthetic validation-only workflow.
- No validator payload was pushed to an Admin or doctor group, and no synthetic Form response, Drive case folder, Calendar event, booking row, or call task was created during this cutover.
- Rollback points remain Apps Script version `5` and Cloud Run revision `pmc-booking-evidence-proxy-00005-w8x`.

## Approved live group Flex smoke test — 2026-08-21

- The owner explicitly approved sending the validated synthetic Flex to live LINE groups.
- Deployed Apps Script version `9` through the existing deployment ID with an approval-only `sendPmcBookingFlexPilot()` operator entrypoint.
- Sent exactly two messages: the synthetic Admin card to the configured Admin group and the synthetic doctor card to the active `หมอ Benz` group.
- Apps Script execution completed successfully in five seconds. Both LINE pushes were accepted; fixed retry keys protect an accidental rerun from duplicating either pilot message.
- The pilot used only `PMC Validation` and the reserved synthetic phone `0800000000`. It did not create or modify a Form response, booking row, Drive case folder, Calendar event, call task, JERA record, or Dashboard value.

## Aligned team-row Flex V2 smoke test — 2026-08-21

- After live visual review, shortened the two team labels to `Admin` and `AE` and fixed both avatar/name groups to the same left-aligned columns.
- Deployed Apps Script version `10` through the existing deployment ID and advanced the explicit pilot retry key to V2 so the revised card would be delivered as a new smoke-test message.
- The official LINE validator accepted the revised Admin and doctor Flex objects before delivery.
- The approved V2 pilot then completed successfully in four seconds, delivering one revised synthetic Flex to the Admin group and one to the active `หมอ Benz` group with no booking-data side effect.

## Compact Admin / AE Form label cutover — 2026-08-21

- Deployed backward-compatible Apps Script version `11` through the existing deployment ID before editing the live Form. The submission parser accepts both legacy and compact identity field titles during rollout.
- Ran the idempotent `configurePmcCompactFormIdentityFields()` operator function successfully without pausing responses.
- Responder readback confirmed the Form remained accepting, contained exactly one required `Admin` Dropdown and one required `AE` Dropdown, and contained neither legacy title.
- The AE Dropdown readback order was `เลือก`, `ไม่ระบุ`, then the seven active eligible staff names. A later setup sync preserves `ไม่ระบุ` as the first real choice.
- No Form response was submitted and no Booking, Drive, Calendar, LINE, call-task, JERA, or Dashboard side effect was created during the cutover.

## Any-email selected Admin attribution — 2026-08-22

- Diagnosed the owner's personal-email test from the authoritative Apps Script execution: `onBookingFormSubmit` received the response but failed at the former email-to-closer gate before Case ID allocation or any Drive, Calendar, LINE, call-task, JERA, or Dashboard side effect.
- Live `CONFIG_STAFF` inspection showed seven active closer rows with nonblank unique emails; the failed test account was not one of the mapped closer identities.
- The owner selected the flexible policy: any signed-in Google Account that can access the Form may submit, and the required active `Admin` Dropdown choice is the canonical closer attribution.
- Deployed Apps Script version `12` through the existing deployment ID. New bookings store `adminIdentityStatus=SELECTED_ADMIN`; the submitter email is retained independently for audit and never blocks or overrides the selected Admin.
- Responder readback confirmed the Form remained accepting with exactly one `Admin`, one `AE`, and the `ไม่ระบุ` AE option.
- The failed response was not replayed automatically. A fresh Form submission is required to exercise the new policy and prevents accidental duplicate operational side effects.
