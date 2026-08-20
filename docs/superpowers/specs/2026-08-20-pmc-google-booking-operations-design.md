# PMC Google Booking Operations Design

## Status

- Design sections approved in chat on 2026-08-20.
- Written specification awaiting final owner review.
- This document defines architecture and behavior only. It does not authorize implementation or production setup.

## 1. Purpose

Replace the current repeated booking workflow with a Google-first operating system that minimizes mobile data entry while preserving LINE as the fast communication surface for doctors and mobile staff.

The system must:

1. let the Admin/assistant record a paid booking quickly from a phone;
2. make Google Sheets the company's operational source of truth and dashboard;
3. create and route Google Calendar, Google Drive, and LINE outputs automatically;
4. keep each doctor limited to their own booking notifications;
5. create and monitor the Admin's call-follow-up work from the appointment date;
6. treat the JERA payment report as the only authority that closes a case;
7. prepare commission eligibility data without inventing a commission formula; and
8. avoid storing national ID card numbers in Google or LINE.

## 2. Approved Product Boundary

### 2.1 In scope

- Google Form for the initial paid-booking intake.
- Google Sheets as the primary operational system and dashboard.
- Google Apps Script orchestration.
- One Google Calendar per doctor plus an Admin aggregate view.
- Google Drive folders and evidence storage per case.
- LINE group notification per doctor.
- LINE Admin-group and direct-Admin call reminders.
- Six-calendar-month deposit validity.
- Daily call reminders from the appointment date through day 7.
- Manual JERA CSV export followed by automated Drive-folder ingestion.
- JERA reconciliation using the `ชำระแล้ว` status only.
- Audit, retry, exception, and retention workflows.

### 2.2 Explicitly out of scope for Phase 1

- Direct API or database connection to JERA.
- Storing or matching on full Thai national ID card numbers.
- Letting Google Sheets declare a case closed without JERA evidence.
- A commission amount formula.
- Doctor edits or acknowledgements through LINE.
- Customer self-service booking.
- AppSheet or a custom booking web app.
- Automatic slip verification or payment-gateway settlement.

### 2.3 Deferred commission rule

Phase 1 stores all data required for a later commission policy:

- Admin owner;
- Case ID;
- deposit amount and receipt date;
- appointment and deposit-expiry dates;
- JERA payment ID, status, close time, and actual revenue; and
- commission eligibility state.

Until an owner-approved rule exists, the system must set qualifying records to `PENDING_RULE` and must not calculate or display a commission amount.

## 3. Roles and Authorities

| Role | Responsibilities | Authority |
|---|---|---|
| Admin/assistant | Receive booking payment, submit the Form, manage appointment exceptions, call customers, record call outcomes, and resolve reconciliation items | Owns booking intake and follow-up work, but cannot close a case without JERA evidence |
| Doctor | Read booking, reschedule, and cancellation notifications in the doctor's LINE group | Read-only; no Google Sheet or LINE write action is required |
| Manager | View all bookings and dashboards, approve sensitive corrections and evidence deletion, manage configuration, and review audit logs | Can approve controlled exceptions and retention actions |
| JERA | Record the actual front-desk identity workflow and completed payment/service outcome | Sole authority for `CLOSED_JERA` |
| Apps Script | Validate, route, synchronize, remind, import, reconcile, audit, and retry | May write only through defined workflows and idempotent operations |

The Admin and assistant are the same operating role. There is no separate “closing Admin.”

## 4. Architecture

```text
Admin confirms booking payment
        |
        v
PMC Booking Intake Google Form
        |
        v
FORM_RESPONSES (immutable raw intake)
        |
        v
Apps Script validation + Case ID + conflict check
        |
        +--> TIME_CONFLICT --> Admin exception workflow
        |
        v
BOOKING_MASTER (canonical current state)
        |
        +--> Drive folder and evidence
        +--> Doctor Calendar event
        +--> Doctor-specific LINE group
        +--> six-month deposit expiry
        +--> CALL_QUEUE from appointment date
        +--> DASHBOARD

JERA CSV export placed in Drive
        |
        v
JERA_IMPORT_RAW
        |
        v
status = ชำระแล้ว + deterministic matching
        |
        +--> unique match --> CLOSED_JERA
        +--> no/ambiguous match --> RECONCILIATION
```

### 4.1 Source-of-truth rule

`BOOKING_MASTER` is the canonical operational record. Calendar, Drive, LINE, call tasks, and dashboard values are derived from its Case ID and workflow state.

`FORM_RESPONSES` and `JERA_IMPORT_RAW` are immutable evidence sources. They are not user-maintained state tables.

Calendar and LINE are delivery surfaces, not alternate databases. Manual changes made only in Calendar or LINE must not silently overwrite the Sheet.

## 5. Google Form Design

### 5.1 Form name

`PMC Booking Intake`

### 5.2 Operating rule

The Admin submits the Form only after verifying that the booking payment was received.

### 5.3 One-page Quick Form

The Form contains only these ten required inputs:

1. `Admin ผู้รับจอง`
2. `ชื่อลูกค้า`
3. `เบอร์มือถือ`
4. `หมอ`
5. `บริการ/โปรแกรม`
6. `วันที่นัด`
7. `เวลานัด`
8. `จำนวนเงินจอง`
9. `สลิปเงินจอง`
10. `หลักฐานแชท`

The chat-evidence question allows multiple files.

The Form is one page with no section branching. Doctor, service, and Admin fields are controlled selections synchronized from configuration.

### 5.4 Automatic values

The Admin does not enter:

- submission timestamp;
- submitter Google email;
- Case ID;
- appointment duration;
- deposit receipt date when no override is approved;
- deposit expiry date;
- booking status;
- Drive folder link;
- Calendar event ID;
- doctor LINE group ID;
- call task dates;
- created/updated timestamps; or
- JERA and commission fields.

The default deposit receipt timestamp is the Form submission timestamp because the Form is submitted only after payment confirmation.

### 5.5 Admin prefilled links and audit

Each Admin receives a prefilled Form URL that preselects the Admin name. The selected name remains visible.

The system stores both `admin_name` and `submitter_email`. If they do not match `CONFIG_ADMINS`, the case is set to `ADMIN_MISMATCH` and is not counted in Admin performance until resolved.

## 6. Google Sheet Topology

### 6.1 Required tabs

| Tab | Purpose | Human editing |
|---|---|---|
| `FORM_RESPONSES` | Raw Google Form responses | Prohibited |
| `BOOKING_MASTER` | One current row per Case ID | Protected; approved fields only |
| `CALL_QUEUE` | Current and historical call tasks | Result, next date, and allowed notes only |
| `JERA_IMPORT_RAW` | Imported JERA transaction headers | Prohibited |
| `JERA_IMPORT_FILES` | File ID, hash, import status, and counts | Prohibited |
| `RECONCILIATION` | Unmatched or ambiguous JERA items | Controlled resolution fields only |
| `RETRY_QUEUE` | Failed external steps with retry state | Prohibited except manager override |
| `CONFIG_ADMINS` | Admin identity and LINE routing | Manager only |
| `CONFIG_DOCTORS` | Doctor, Calendar ID, and LINE group ID | Manager only |
| `CONFIG_SERVICES` | Service duration and active state | Manager only |
| `CONFIG_RULES` | Reminder, expiry, and retention settings | Manager only |
| `AUDIT_LOG` | Append-only before/after events | Prohibited |
| `DASHBOARD` | Operational and management views | Prohibited except filters/slicers |

### 6.2 `BOOKING_MASTER` key fields

#### Identity and ownership

- `case_id`
- `form_response_id`
- `admin_id`
- `admin_name`
- `submitter_email`
- `admin_identity_status`

#### Customer

- `customer_name`
- `customer_name_normalized`
- `phone_masked`
- `phone_normalized`

The national ID number is not a field.

#### Booking

- `doctor_id`
- `service_id`
- `appointment_start`
- `appointment_end`
- `booking_status`
- `conflict_reason`

#### Deposit

- `deposit_amount`
- `deposit_received_at`
- `deposit_expires_at`
- `deposit_status`

`deposit_expires_at` is six calendar months after `deposit_received_at`, not a fixed 180-day duration.

#### External outputs

- `drive_folder_id`
- `drive_folder_url`
- `payment_evidence_count`
- `chat_evidence_count`
- `calendar_id`
- `calendar_event_id`
- `doctor_line_group_id`
- `doctor_line_notified_at`

#### Follow-up

- `call_status`
- `first_call_window_start`
- `first_call_window_end`
- `next_call_at`
- `last_call_at`
- `call_owner_admin_id`

#### JERA and commission

- `jera_payment_id`
- `jera_status`
- `jera_closed_at`
- `jera_actual_revenue`
- `jera_import_file_id`
- `reconciliation_status`
- `commission_eligibility`
- `commission_amount`

`commission_amount` remains blank while eligibility is `PENDING_RULE`.

#### Audit metadata

- `created_at`
- `created_by`
- `updated_at`
- `updated_by`
- `version`

## 7. Form Submission Workflow

### 7.1 Idempotency and locking

The `onFormSubmit` workflow must:

1. acquire a script lock;
2. check whether `form_response_id` was already processed;
3. generate a unique Case ID;
4. persist the raw-to-case mapping before external writes; and
5. release the lock after the canonical record and retry state are durable.

Case ID format:

`PMC-YYYYMM-NNNN`

Sequence allocation is atomic and scoped by calendar month.

### 7.2 Validation

Required checks:

- selected Admin exists and is active;
- submitter email matches the selected Admin;
- phone normalizes to an accepted Thai phone form;
- selected doctor and service are active;
- service duration exists;
- appointment start is valid in `Asia/Bangkok`;
- deposit is positive;
- at least one payment-slip file exists;
- at least one chat-evidence file exists; and
- upload types and sizes are allowed.

### 7.3 Calendar conflict

The selected doctor's Calendar is checked for overlap over the derived appointment interval.

If an overlap exists:

- set `TIME_CONFLICT`;
- do not create the Calendar event;
- do not notify the doctor group;
- keep the evidence and canonical case record;
- notify the Admin group and owner; and
- require the controlled reschedule workflow.

### 7.4 Successful confirmation

If validation and conflict checks pass:

1. set `BOOKING_CONFIRMED`;
2. create the Drive folder;
3. move and rename evidence files;
4. create the doctor Calendar event;
5. send the doctor-specific LINE message;
6. set deposit expiry;
7. create the initial call task; and
8. refresh dashboard aggregates.

External steps are independently idempotent. A retry must reuse stored Drive and Calendar IDs instead of creating duplicates.

## 8. Drive Design

### 8.1 Folder structure

```text
PMC Bookings/
  YYYY/
    MM/
      ชื่อลูกค้า - PMC-YYYYMM-NNNN/
```

Case ID is required even though the folder originates from the customer name. It prevents collisions between customers with the same name and repeat bookings.

### 8.2 Evidence filenames

- `CASE-ID_PAYMENT_01.ext`
- `CASE-ID_CHAT_01.ext`
- `CASE-ID_CHAT_02.ext`

The Sheet stores file and folder IDs/URLs, not embedded images.

### 8.3 Permissions

- Evidence folders are restricted to authorized Admins and managers.
- Doctors do not receive Drive evidence links in LINE.
- Sharing changes are audited.
- Evidence is never made public-by-link.

## 9. Calendar Design

### 9.1 Calendar topology

- one Calendar per doctor;
- the Admin/manager account can overlay all doctor Calendars;
- `CONFIG_DOCTORS` maps `doctor_id` to `calendar_id` and `line_group_id`.

### 9.2 Event content

The Calendar event includes:

- Case ID;
- masked customer identity;
- service/program;
- appointment duration;
- operational notes that are safe for clinical scheduling; and
- source link back to the authorized booking record.

It excludes national ID, payment slip, chat screenshots, and full payment details.

### 9.3 Update rules

Reschedule and cancellation changes are made through a controlled update workflow. The workflow updates `BOOKING_MASTER` first, then patches the existing event by `calendar_event_id`, then notifies the relevant LINE groups.

## 10. LINE Design

### 10.1 Doctor groups

Each doctor has a separate LINE group. Doctors only read messages.

Doctor-group events:

- booking confirmed;
- appointment rescheduled;
- appointment cancelled; and
- daily schedule summary.

No acknowledgement or doctor write-back is required.

### 10.2 Admin routing

Call reminders are sent to both:

- the Admin/assistant operations group; and
- the direct LINE user ID of the Case's Admin owner.

### 10.3 Minimum necessary information

LINE messages contain only operationally necessary fields:

- Case ID;
- masked customer name;
- masked phone when needed by the Admin;
- doctor;
- appointment date/time;
- service/program;
- task state; and
- safe notes.

LINE messages never contain national ID numbers, slip images, chat evidence, or unrestricted Drive links.

### 10.4 Secrets and verification

LINE tokens and secrets are stored in Script Properties or an approved secret store, not in cells. Incoming webhook signatures are verified before any write.

## 11. Call Follow-up Workflow

### 11.1 First-call window

- Notification begins on the appointment date (`Day 0`).
- The Admin must complete the first call by the end of `Day 7`.
- The system reminds the Admin every day until a call result is recorded.
- At the end of Day 7, an unfinished task becomes `CALL_OVERDUE`.
- A `CLOSED_JERA` match cancels open call tasks immediately.

### 11.2 Reminder schedule

The default daily reminder time is configurable in `CONFIG_RULES`; the Phase 1 default is 09:00 `Asia/Bangkok`.

### 11.3 Call result capture

A short prefilled `PMC Call Result` Form captures:

1. Case ID;
2. call result;
3. next-call date; and
4. optional short note.

Allowed results:

- `REBOOKED`
- `NO_ANSWER`
- `CALL_BACK_REQUESTED`
- `NOT_READY`
- `DECLINED`
- `WRONG_NUMBER`

The system suggests the next call date from the result, but the Admin can adjust it before submission:

| Result | Default next action |
|---|---|
| `REBOOKED` | No call date; controlled reschedule workflow updates the appointment |
| `NO_ANSWER` | Next calendar day |
| `CALL_BACK_REQUESTED` | Admin selects the requested date |
| `NOT_READY` | 14 days later |
| `DECLINED` | 30 days later while the deposit remains valid |
| `WRONG_NUMBER` | Immediate reconciliation task; no blind repeat reminders |

Future calls continue until rebooking, JERA close, refund, or deposit expiry.

### 11.4 Deposit expiry reminders

The Admin owner and Admin group are reminded at 30, 14, and 7 days before deposit expiry.

If no JERA close or refund exists at expiry, set `EXPIRED_6M` and stop routine call reminders. Any extension requires a manager-approved, audited exception.

## 12. JERA Import and Reconciliation

### 12.1 Integration boundary

There is no direct JERA connection. Staff exports the JERA payment-detail report and places it in the authorized Drive `JERA/INCOMING` folder.

A time-driven Apps Script checks the folder every 15 minutes. A manager can also run the same idempotent importer from a custom Sheet menu.

### 12.2 Sample-report evidence

The inspected sample was:

`payment_report_detail_2026-08-19_to_2026-08-19 (1).csv`

Observed format:

- CP874 encoding;
- tab-separated despite the `.csv` extension;
- report metadata before the header row;
- 53 main columns;
- mixed transaction-header, detail, and summary rows; and
- no national-ID column.

The sample contained 15 transaction headers. Ten had status `ชำระแล้ว`. Within those ten qualifying records, payment ID, HN, normalized phone, and normalized customer name were complete and unique. No raw customer values are copied into this specification.

### 12.3 Robust parser

The importer must not assume every row is a transaction.

It must:

1. decode CP874 and reject unsupported encoding explicitly;
2. detect the tab delimiter;
3. locate the header row by required names such as `รหัสใบชำระเงิน`, `ผู้ป่วย`, `HN`, `สถานะ`, and `ยอดเงินที่ได้รับจริง`;
4. select rows with a valid payment ID and transaction-level status;
5. ignore report metadata, detail lines, and summary lines;
6. persist the raw transaction headers in `JERA_IMPORT_RAW`; and
7. store file ID, content hash, import time, row counts, and outcome in `JERA_IMPORT_FILES`.

### 12.4 Closing rule

Only JERA status `ชำระแล้ว` can close a case.

Other observed statuses map as follows:

| JERA status | Booking effect |
|---|---|
| `ชำระแล้ว` | Candidate for `CLOSED_JERA` |
| `มัดจำชำระแล้ว` | Deposit-only evidence; do not close |
| `มัดจำค้างชำระ` | Do not close |
| `คืนมัดจำ` | Candidate for `REFUNDED` after deterministic match |
| `ลิงค์ชำระเงิน` | Do not close; review if necessary |
| blank or `0` | `RECONCILIATION` |

### 12.5 Matching hierarchy

For a `ชำระแล้ว` candidate:

1. normalize Thai phone values;
2. normalize customer names by trimming whitespace and safe punctuation;
3. require exact `phone_normalized + customer_name_normalized` match for automatic closure;
4. use date/time, doctor, and service as corroborating checks when available;
5. accept automatic closure only when exactly one eligible open booking remains; and
6. store the JERA payment ID on the closed Case ID.

Name-only matching cannot close automatically.

### 12.6 Reconciliation outcomes

Send to `RECONCILIATION` when:

- phone is missing or invalid;
- name differs materially;
- zero open bookings match;
- multiple bookings match;
- payment ID was already consumed;
- status is unsupported; or
- corroborating fields conflict.

Manual resolution requires manager identity, selected Case ID, reason, timestamp, and a before/after audit event.

## 13. Status Model

| Status | Meaning |
|---|---|
| `FORM_SUBMITTED` | Raw intake received |
| `ADMIN_MISMATCH` | Selected Admin and submitter email disagree |
| `VALIDATION_ERROR` | Required data or evidence failed validation |
| `TIME_CONFLICT` | Doctor Calendar overlap; no doctor notification sent |
| `BOOKING_CONFIRMED` | Evidence, Calendar, and routing are established |
| `CALL_ACTIVE` | Appointment date reached; daily call reminder is active |
| `CALL_OVERDUE` | No first-call result by end of Day 7 |
| `REBOOKED` | Customer received a new appointment |
| `CLOSED_JERA` | Unique match to JERA `ชำระแล้ว` |
| `REFUNDED` | Deterministic match to JERA `คืนมัดจำ` |
| `EXPIRED_6M` | Deposit validity ended without JERA closure/refund |
| `RECONCILIATION` | JERA or operational data needs controlled review |

Status transitions are append-audited. Users cannot type arbitrary statuses.

## 14. Dashboard Design

### 14.1 Daily operations

- appointments today by doctor;
- time conflicts awaiting action;
- Admin calls due today;
- overdue calls;
- rebooked customers;
- deposits expiring in 30, 14, or 7 days;
- JERA reconciliation queue;
- missing or failed evidence processing; and
- retry queue failures.

Each metric provides a filter or linked view into the underlying cases.

### 14.2 Management

- booking count;
- deposit amount;
- `CLOSED_JERA` count;
- Booking-to-Closed-JERA rate;
- refund count;
- expired-deposit count;
- closed cases by Admin owner;
- bookings by doctor;
- bookings by service;
- median and average time from booking to JERA close; and
- commission-eligible cases waiting for a rule.

### 14.3 Filters

- date range;
- Admin;
- doctor;
- service; and
- booking status.

### 14.4 Dashboard integrity

Dashboard cells are derived from `BOOKING_MASTER` and controlled support tabs. Users do not type totals or operational statuses into the dashboard.

Customer names are masked or abbreviated. Full phone numbers, evidence images, and chat content are excluded.

## 15. Error Handling and Retry

Every external step has its own state and last-error fields:

- `drive_state`
- `calendar_state`
- `line_state`
- `jera_import_state`
- `reconciliation_state`

| Failure | Required behavior |
|---|---|
| Drive folder/file operation | Keep canonical case, enqueue retry, do not duplicate files |
| Calendar creation | Do not notify doctor, enqueue retry, alert Admin |
| LINE send | Preserve Calendar and booking, enqueue retry, show dashboard alert |
| JERA decode/parse | Do not modify booking status; quarantine file and report reason |
| JERA ambiguous match | Do not close; create reconciliation item |
| Daily reminder send | Preserve call task and retry without incrementing a successful-send count |

Retries use exponential backoff with a maximum attempt count. Exhausted items remain visible until manager resolution.

## 16. Security, Privacy, and Retention

### 16.1 Ownership

Google Form, Sheet, Script, Drive root, and Calendars are owned by a company-controlled Google account or approved company Workspace. They are not owned solely by an individual Admin.

### 16.2 Access

- Managers: full operational access and controlled configuration.
- Admins: intake, assigned call work, and approved corrections.
- Doctors: LINE read-only operational notifications.
- Raw evidence: authorized Admins/managers only.

Protected ranges prevent edits to IDs, system states, timestamps, external IDs, formulas, and audit records.

### 16.3 Data minimization

- No national ID field.
- No full phone or evidence on Dashboard.
- No payment/chat evidence in LINE.
- No public Drive links.
- No secrets in Sheet cells or source control.

### 16.4 Retention

Evidence becomes eligible for deletion 90 days after `CLOSED_JERA`, `REFUNDED`, or `EXPIRED_6M`.

The system moves eligible evidence to a manager approval queue. Phase 1 does not auto-delete without approval. Approved deletion is audited with file IDs, case ID, approver, and timestamp.

## 17. Audit Requirements

`AUDIT_LOG` is append-only and records:

- event ID;
- Case ID;
- actor identity;
- source workflow;
- action;
- field or target;
- before value;
- after value;
- reason;
- timestamp; and
- correlation/import/run ID.

Audited events include:

- Admin identity correction;
- appointment reschedule/cancellation;
- status transition;
- call result and next-call change;
- manual JERA match;
- deposit expiry extension;
- permission change; and
- evidence deletion approval.

## 18. Scheduled Operations

| Schedule | Operation |
|---|---|
| Form submit | Validate and orchestrate booking |
| Every 15 minutes | Check JERA incoming folder and retry eligible failed steps |
| Daily 09:00 Asia/Bangkok | Send call reminders and expiry reminders |
| Daily after reminders | Run integrity checks and refresh Dashboard |
| Daily off-hours | Copy/snapshot the operational Sheet to the approved backup location |

Installable triggers run from the designated company automation account.

## 19. Integrity Checks

The daily check reports:

- `BOOKING_CONFIRMED` without Drive folder;
- confirmed booking without Calendar event;
- Calendar event without a valid Case ID;
- doctor notification marked successful without Calendar success;
- closed/refunded/expired case with active call task;
- consumed JERA payment ID attached to multiple cases;
- duplicate form response processing;
- overdue call without reminder evidence;
- expired deposit still counted as active; and
- dashboard totals that do not reconcile to source rows.

## 20. Testing and Acceptance Criteria

### 20.1 Form and identity

- A valid prefilled Admin submission creates one Case ID.
- Duplicate trigger delivery does not create a second case.
- Admin/email mismatch is visible and excluded from Admin performance.
- Missing slip or chat evidence cannot become `BOOKING_CONFIRMED`.

### 20.2 Calendar and routing

- A non-conflicting booking creates exactly one event in the selected doctor's Calendar.
- An overlapping booking becomes `TIME_CONFLICT` and sends no doctor message.
- Each doctor receives only that doctor's booking notification.
- Reschedule patches the existing event and does not create an orphan duplicate.

### 20.3 Drive

- Folder name includes customer name and Case ID.
- Slip and multiple chat files are moved and renamed deterministically.
- Evidence links are not public.
- Retry reuses existing folder/file IDs.

### 20.4 Call queue

- A call task becomes visible on the appointment date.
- Daily reminders go to both Admin group and owner.
- Logging a call stops the current daily reminder.
- Missing first-call result becomes overdue after Day 7.
- JERA closure cancels open calls.
- Expiry ends routine follow-up unless a manager extends it.

### 20.5 JERA

- CP874 tab-separated sample parses without customer-data corruption.
- Metadata/detail/summary rows do not become transactions.
- Only `ชำระแล้ว` can close automatically.
- Exact unique phone+name match closes one case.
- Missing, zero, or multiple matches create reconciliation items.
- Importing the same file or payment ID twice does not duplicate closure or revenue.

### 20.6 Dashboard and audit

- Dashboard values reconcile to `BOOKING_MASTER` for the selected filters.
- No full phone, national ID, slip, or chat content is visible on Dashboard.
- Controlled changes create append-only before/after audit entries.
- Commission amount stays blank while the rule is deferred.

## 21. Rollout Sequence

1. Create company-owned Google assets and access groups.
2. Create configuration tabs and protected operational topology.
3. Create Quick Form and Admin prefilled links.
4. Implement Form-to-Master validation and idempotency.
5. Add Drive evidence workflow.
6. Add doctor Calendar conflict checks and events.
7. Add doctor and Admin LINE routing.
8. Add call queue and daily reminders.
9. Add JERA importer and reconciliation.
10. Add Dashboard, integrity checks, backup, audit, and retention queue.
11. Run privacy-safe pilot with a small Admin/doctor group.
12. Compare pilot records against Calendar, Drive, LINE, and JERA before production cutover.

## 22. Success Criteria

The design succeeds when:

- the Admin completes the intake from a phone in approximately one minute, excluding file-selection time;
- the booking is entered once and downstream Google/LINE work is automatic;
- doctors receive only their own useful booking information in LINE;
- call work is visible from the appointment date and cannot disappear silently;
- Google never closes a case without qualifying JERA evidence;
- exceptions are visible and controlled rather than silently guessed;
- management can see trusted operational counts from one Sheet; and
- no national ID number is stored in the Google/LINE workflow.
