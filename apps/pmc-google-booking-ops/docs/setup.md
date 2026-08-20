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

Enable email collection and restrict submission to authorized staff Google accounts.

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

### CONFIG_DOCTORS

```text
id | name | calendarId | lineGroupId | active
```

Share every doctor Calendar with the company Admin/manager account so the aggregate Google Calendar view works.

### CONFIG_SERVICES

```text
id | name | durationMinutes | active
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

## Admin prefilled links

In Google Forms, choose “Get pre-filled link,” select one Admin name, and create one link per Admin. Store links in the internal operations handbook, not in public documents.

The selected Admin remains visible. The system still compares the selection with the submitter Google email.

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
