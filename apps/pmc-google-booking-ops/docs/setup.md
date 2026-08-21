# PMC Google Booking Operations Setup

## Status

The code package is deployable, but production remains setup-gated. Complete the synthetic pilot in `pilot-runbook.md` before using real customer data.

## Company-owned prerequisites

Create these assets under the designated company automation account:

1. one Google Spreadsheet;
2. `PMC Booking Intake` Google Form;
3. `PMC Call Result` Google Form;
4. one private `PMC Bookings` Drive root folder;
5. one private `JERA/INCOMING` Drive folder;
6. one private backup Drive folder;
7. one Google Calendar per doctor;
8. one LINE group per doctor;
9. one LINE Admin/assistant operations group; and
10. one LINE Official Account Messaging API channel.

Do not create production assets under an individual Admin's personal account.

## Google Form fields

### PMC Booking Intake

Create one page with these exact required titles:

1. `Admin ผู้รับจอง` — Dropdown
2. `ชื่อลูกค้า` — Short answer
3. `เบอร์มือถือ` — Short answer
4. `หมอ` — Dropdown
5. `บริการ/โปรแกรม` — Dropdown
6. `วันที่นัด` — Date
7. `เวลานัด` — Time
8. `จำนวนเงินจอง` — Short answer with numeric validation
9. `สลิปเงินจอง` — File upload, required
10. `หลักฐานแชท` — File upload, required, multiple files allowed

Optional:

11. `เพจคลินิก/ช่องทาง` — Dropdown, not required

All Admins use one company Google account. Enable email collection for technical audit, restrict submission to that authorized company account, and keep `Admin ผู้รับจอง` required because the selected Admin is the authority for performance attribution.

### PMC Call Result

Create these fields:

1. `Case ID` — Short answer
2. `ผลการโทร` — Dropdown
3. `วันโทรครั้งถัดไป` — Date, optional except when the result is `CALL_BACK_REQUESTED`
4. `หมายเหตุ` — Paragraph, optional

Enable email collection.

## Apps Script deployment

From the repository root:

```bash
cp apps/pmc-google-booking-ops/.clasp.json.example apps/pmc-google-booking-ops/.clasp.json
```

Edit the ignored `.clasp.json` locally and replace the example Script ID with the company Apps Script project ID. Never commit the real ID if the project policy treats it as restricted.

Enable the Google Calendar advanced service in Apps Script and enable the Google Calendar API in the linked Google Cloud project.

Build and push:

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run booking:push
```

Expected files under Apps Script are `Code.js` and `appsscript.json`.

## Script Properties

Set these in Apps Script Project Settings. Do not put values in Sheet cells, source files, chat, screenshots, or logs.

```text
PMC_SPREADSHEET_ID
PMC_BOOKING_FORM_ID
PMC_CALL_RESULT_FORM_ID
PMC_DRIVE_ROOT_ID
PMC_JERA_INCOMING_FOLDER_ID
PMC_BACKUP_FOLDER_ID
PMC_ADMIN_LINE_GROUP_ID
LINE_CHANNEL_ACCESS_TOKEN
PMC_BOOKING_INGRESS_SECRET
LINE_DIRECTORY_CAPTURE_ENABLED
```

Use `LINE_DIRECTORY_CAPTURE_ENABLED=false` during normal operation.

## Sheet configuration

Run `setupPmcBookingSystem` once after setting properties. It creates and validates the managed tabs and triggers.

Populate these tabs with non-secret business configuration:

### CONFIG_ADMINS

```text
id | name | email | lineUserId | active
```

Initial Admin names from the current operating Form are:

```text
เอม
มัส
หมวย
มิ้น
แวว
แคท
อาย
```

Use the same company Google email for each row. LINE user IDs remain individual where direct reminders are required.

For the initial group-only pilot, `lineUserId` may remain blank. Call and expiry reminders still go to the Admin group, and the runtime skips the direct-owner copy until an individual LINE user ID is mapped.

Confirmed bookings send validated Misty Rose (`#FEE5E0`) Flex Messages to both mapped groups. The Admin group receives the full operational booking summary; the selected doctor group receives full customer name/phone plus the service, appointment, and Admin owner. Slip/chat files, national IDs, and Drive links remain excluded from LINE.

### CONFIG_DOCTORS

```text
id | name | calendarId | lineGroupId | active
```

Share every doctor Calendar with the company Admin/manager account so the aggregate Google Calendar view works.

### CONFIG_SERVICES

```text
id | name | durationMinutes | active
```

Initial service choices from the current operating Form are:

```text
เติมไขมัน
เสริมจมูก
โบท็อกซ์
เมโสแฟต
เมโสหน้าใส
รักษาสิว
PRP
มาเด้
เลเซอร์
HIFU
ฟิลเลอร์ปาก
ดูดไขมัน
อื่นๆ
```

### CONFIG_CHANNELS

```text
id | name | active
```

Initial optional channel choices are:

```text
เพจหลัก
เพจขาว
เพจดำ
เพจทอง
Line official
เพจFIF
เพจTAB
เพจเขียว
เพจเทา
เพจน้ำตาล
เพจม่วง
เพจขาว-สกิน
เพจฟ้า
หน้าคลินิก
line VIP
เพจส้ม
Tiktok
ไลน์เครื่องคลินิก
```

After entering configuration, run `setupPmcBookingSystem` again to synchronize Form choices. Re-running setup must not duplicate triggers.

## Secure LINE ID capture

Apps Script cannot read `x-line-signature`, so LINE must call PMC Web, not Apps Script.

Set these server-side environment variables on the existing PMC Web service:

```text
BOOKING_LINE_CHANNEL_SECRET
BOOKING_APPS_SCRIPT_INGRESS_URL
BOOKING_INGRESS_SECRET
```

`BOOKING_INGRESS_SECRET` and `PMC_BOOKING_INGRESS_SECRET` must contain the same strong random value, stored only in their respective secret stores.

Deploy PMC Web and set the LINE Developers webhook URL to:

```text
https://<pmc-web-host>/api/booking-line/webhook
```

For controlled directory capture:

1. deploy the Apps Script project as a Web App executing as the company automation account;
2. use the Web App URL as `BOOKING_APPS_SCRIPT_INGRESS_URL`;
3. set `LINE_DIRECTORY_CAPTURE_ENABLED=true` temporarily;
4. invite the OA into each doctor/Admin group and send one synthetic setup message;
5. have each Admin send one synthetic setup message directly to the OA;
6. map captured source IDs in `CONFIG_LINE_DIRECTORY` to `CONFIG_DOCTORS` and `CONFIG_ADMINS`;
7. verify no message text was stored; and
8. set `LINE_DIRECTORY_CAPTURE_ENABLED=false` immediately.

The PMC Web bridge verifies LINE's raw-body signature. Apps Script accepts only the second timestamped HMAC payload and rejects replays.

## Evidence Image Cloud Run Service Identity

Evidence previews run in a dedicated Cloud Run service using a keyless Google Service Account identity. Organization policy `iam.disableServiceAccountKeyCreation` remains enabled; no JSON key is created or stored.

1. Enable Cloud Run, Cloud Build, Artifact Registry, Secret Manager, and Google Drive APIs in the PMC Cloud project.
2. Create/select Service Account `pmc-booking-evidence` without a key and without project data roles.
3. Attach that Service Account as the Cloud Run Service Identity.
4. Share only the `PMC Bookings` root folder to the Service Account email as `Viewer`.
5. Do not share the central Spreadsheet, Forms, Calendars, JERA folder, backup folder, or project Editor/Owner roles.
6. Store `BOOKING_MEDIA_SIGNING_SECRET` in Secret Manager and grant this Service Account access only to that secret.
7. In the Google Form editor, restrict both evidence questions to **Image** uploads; phase 1 supports JPEG and PNG only. This is an owner-account UI step: Google Forms API currently rejects updates to existing File Upload questions. Read the form back through Forms API and require `types=[IMAGE]` before real-customer go-live.

Cloud Run starts the dedicated entrypoint:

```bash
npm run start:booking-evidence
```

Apps Script property names:

```text
BOOKING_MEDIA_BASE_URL
BOOKING_MEDIA_SIGNING_SECRET
```

The deployed signed proxy is the production read-only verification path. Test it with synthetic evidence, then remove the synthetic file after the pilot. Never paste Service Account email, file IDs, signed URLs, or secret values into chat, source, logs, or Sheet cells.

## Shared Admin link

Publish one internal Form link for all staff. Before the verified-email cutover, version 5 uses the selected Admin name with the shared company account. After the cutover, each closer signs in with their mapped personal Google account and selects only the AE who opened the chat.

## Staff / AE verified-email cutover

The new runtime uses personal verified Google-account email for the Admin who closes the booking and a required `AE ผู้เปิดแชท` dropdown. Do not paste personal emails into source, commands, docs, audit summaries, or chat.

Run these Apps Script functions in order:

1. Set `BOOKING_BRAND_LOGO_URL` to the public HTTPS Cloud Run logo route without printing it.
2. `preparePmcStaffAeMigration()` — inserts the nullable `aeId`/`aeName` columns and seeds `CONFIG_STAFF` from legacy names/IDs/LINE IDs without copying the shared email.
3. Enter the seven personal emails directly in `CONFIG_STAFF`. Confirm every active closer has one unique email and both role flags are `TRUE` for the initial team.
4. `pauseAndCutoverPmcBookingForm()` — validates Staff, pauses responses, renames the existing Admin dropdown to `AE ผู้เปิดแชท`, and syncs eligible choices.
5. Build/push, create the next Apps Script version, and redeploy only the existing Web App deployment ID.
6. `resumePmcBookingFormAfterAeCutover()` — revalidates Staff, email collection, and the AE field before accepting responses again.

If cutover fails after the Form is paused, leave it paused. Redeploy Apps Script version 5, restore the label `Admin ผู้รับจอง`, restore the legacy choices, and then re-enable responses. Never delete `CONFIG_STAFF`, AE columns, or audit rows during rollback.

## Staff profile images in LINE Flex

The booking Flex reads the optional `profileImageUrl` column from `CONFIG_STAFF`. Running `setupPmcBookingSystem()` or `preparePmcStaffAeMigration()` appends this column after `active` when the legacy seven-column header is present. It does not change Form questions, booking rows, Calendar events, or staff identity rules.

For the approved seven-person roster, run `configurePmcStaffProfileImages()` once after the Cloud Run profile routes are verified. The function creates a timestamped Spreadsheet backup in the configured backup folder, verifies the exact roster before writing, migrates the column when needed, writes only `profileImageUrl`, and verifies the written values. A roster mismatch fails before the profile column write.

Use only the public HTTPS Cloud Run routes below. LINE fetches these images from outside Google Drive, so private Drive URLs must not be stored in the Sheet.

| Staff | Asset route |
| --- | --- |
| แคท | `/assets/staff-profiles/cat.jpg` |
| มัส | `/assets/staff-profiles/mus.jpg` |
| มิ้น | `/assets/staff-profiles/mint.jpg` |
| แวว | `/assets/staff-profiles/waew.jpg` |
| หมวย | `/assets/staff-profiles/muay.jpg` |
| อาย | `/assets/staff-profiles/eye.jpg` |
| ฝ้าย | leave `profileImageUrl` blank |

Each deployed asset is a metadata-stripped 256×256 JPEG. Both Admin and doctor Flex messages render a 32×32 circular avatar before the closer and AE names. A missing or non-HTTPS URL falls back to an empty light-gray circle so LINE delivery does not fail. The Cloud Run server serves only the six allowlisted profile filenames with `GET` and `HEAD`.

## JERA operation

Export the JERA payment-detail report and place the unchanged file in `JERA/INCOMING`. The 15-minute trigger:

- decodes Windows-874/CP874;
- detects the tab-separated header;
- ignores metadata/detail/summary rows;
- closes only unique `ชำระแล้ว` matches; and
- moves processed files to `Imported` or failed files to `Quarantine`.

Do not commit JERA exports to Git.

## Trigger verification

Confirm exactly one of each:

- `onBookingFormSubmit` — Booking Form submit
- `onCallResultSubmit` — Call Result Form submit
- `pollJeraIncoming` — every 15 minutes
- `runDailyOperations` — daily at approximately 09:00 Asia/Bangkok
- `runIntegrityChecks` — daily at approximately 02:00 Asia/Bangkok

Apps Script may slightly randomize clock-trigger execution within the selected hour.

## Rollback without data deletion

1. disable/delete the five installable triggers;
2. disable the Apps Script Web App deployment;
3. disable the LINE Developers webhook;
4. leave Forms, Sheets, Drive, Calendars, audit rows, and imported JERA evidence intact;
5. record the rollback reason and time in the company incident log; and
6. re-enable only after synthetic verification passes again.
