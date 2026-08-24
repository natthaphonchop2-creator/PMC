# PMC Provisional Auto Queue and Complete Evidence Design

## Status

- The complete-evidence behavior, normal/automatic queue choice, provisional appointment behavior, automatic slot rule, and minimal staff flow were approved in chat on 2026-08-24.
- Google Sheets remains the company operational source of truth.
- JERA remains the only authority for closing a case at the clinic.
- This specification authorizes design only. It does not authorize implementation, Form mutation, Sheet migration, Apps Script push, LINE delivery, or production deployment.
- This design extends the current Google Form booking workflow. It does not revive the previously abandoned booking Web App project.

## 1. Purpose

Make two focused improvements without adding staff-facing rules:

1. show every payment-slip and chat-evidence image submitted with a booking in the Admin LINE notification; and
2. let staff choose either a customer-specified appointment or an automatically proposed provisional appointment when the customer has paid a deposit but has not selected a date.

Staff make only two decisions:

- choose `คิวปกติ` or `คิวอัตโนมัติ` when submitting the booking; and
- for an automatic queue, confirm the proposed appointment or change it after speaking with the customer.

Everything else is derived and recorded by the system.

## 2. Product Boundary

### 2.1 In scope

- The existing PMC Booking Google Form and Apps Script project.
- One required single-choice question named `รูปแบบคิวนัดหมาย`.
- Google Form section branching for normal and automatic queues.
- A separate appointment status from the paid-booking status.
- Automatic provisional-slot selection from the selected doctor's confirmed schedule.
- A gray provisional Calendar event when a candidate is found.
- Admin-only provisional notifications.
- A short queue-confirmation Form with prefilled Case ID and proposed date/time.
- Confirmation by any Admin who can access the company workflow.
- Updating the same Calendar event from provisional to confirmed.
- Doctor LINE notification and call-queue creation only after appointment confirmation.
- Every evidence image accepted by the booking Form, with no additional truncation in application code.
- Automatic evidence batching within LINE Flex Message limits.

### 2.2 Out of scope

- Customer self-service confirmation.
- A new Render service, database, or always-on server.
- Reintroducing appointment-capacity blocking for normal queues.
- Doctor approval before an automatic provisional slot is proposed.
- Direct JERA integration.
- Changing commission formulas.
- Making evidence files public.

## 3. Minimal Staff Flow

### 3.1 Queue type question

The booking Form adds one required Multiple choice question:

`รูปแบบคิวนัดหมาย`

- `คิวปกติ`
- `คิวอัตโนมัติ`

It is not a Checkbox because exactly one mode must be selected and Google Forms can branch a Multiple choice answer to a specific section.

### 3.2 Normal queue

`คิวปกติ` routes the respondent to the existing date and time fields.

The existing workflow remains:

1. staff enter the customer-requested date and time;
2. the paid booking is recorded in Sheets and Drive;
3. the confirmed Calendar event is created;
4. Admin and doctor LINE notifications are sent; and
5. the Day 1–7 call task begins from the appointment date.

The earlier owner decision to allow overlapping manual appointments remains unchanged.

### 3.3 Automatic queue

`คิวอัตโนมัติ` skips the date and time section. Staff do not enter placeholder values.

The workflow:

1. records the paid booking and attribution immediately;
2. stores all evidence in Drive;
3. searches for a provisional appointment;
4. creates a gray provisional Calendar event when a candidate exists;
5. sends the provisional booking and evidence only to the Admin group;
6. waits for an Admin to confirm or change the appointment; and
7. only after confirmation, updates Calendar, notifies the doctor group, and creates the Day 1–7 call task.

If no candidate is found, the appointment status becomes `AWAITING_ADMIN_SLOT`, no Calendar event is created, and the Admin group receives `รอ Admin เลือกวัน`.

## 4. Separate Booking and Appointment State

Payment and appointment certainty are different facts and must not share one status field.

### 4.1 Paid-booking status

The canonical booking remains a successful paid booking after the evidence and deposit are accepted. Existing commission attribution and deposit-expiry behavior continue to use the paid booking and JERA rules.

### 4.2 Appointment mode and status

Add canonical fields:

| Field | Values / meaning |
|---|---|
| `queueType` | `NORMAL` or `AUTO` |
| `appointmentStatus` | `CONFIRMED`, `TENTATIVE`, or `AWAITING_ADMIN_SLOT` |
| `appointmentProposedAt` | Timestamp when the automatic candidate was selected, or blank |
| `appointmentConfirmedAt` | Timestamp when an Admin confirmed the appointment, or blank |
| `appointmentConfirmedBy` | Collected email of the confirming Admin, or blank |

Existing rows migrate to:

- `queueType = NORMAL`; and
- `appointmentStatus = CONFIRMED` when they already have a confirmed Calendar event.

No existing Case ID, evidence folder, Calendar event ID, or audit history is regenerated.

## 5. Automatic Provisional Slot Rule

### 5.1 Search horizon

Search from the booking submission date through the deposit-expiry date, which is six calendar months after payment receipt.

### 5.2 Eligible day

A day is eligible only when the selected doctor already has at least one confirmed PMC appointment on that day.

Confirmed doctor appointments are identified from `BOOKING_MASTER` and correlated to Calendar by stored Calendar event ID and doctor ID. The algorithm must not infer doctor ownership from free-text titles alone.

### 5.3 Candidate time

For each eligible day, in chronological order:

1. order the selected doctor's confirmed appointments by end time;
2. after each confirmed appointment, generate candidate starts on a 30-minute boundary;
3. keep candidates between 10:30 and 20:30 Asia/Bangkok;
4. derive the candidate end from the selected service duration in `CONFIG_SERVICES`;
5. reject a candidate that overlaps any Calendar event during its full duration; and
6. select the first remaining candidate.

Example:

- confirmed doctor case: 13:00–14:00;
- selected service duration: 60 minutes;
- 14:00–15:00 is clear;
- proposed provisional appointment: 14:00.

This availability rule applies only to automatic proposal generation. It does not restore overlap blocking for a staff-entered normal queue.

### 5.4 No candidate

If no candidate exists inside the six-month horizon:

- set `appointmentStatus = AWAITING_ADMIN_SLOT`;
- do not create a fake date or Calendar event;
- send an Admin notification with a `เลือกวัน` action; and
- do not notify the doctor or create a call task.

## 6. Provisional Calendar Event

When a candidate is found:

- create the event on the configured shared doctor Calendar;
- use Calendar color ID `8` for a gray provisional event;
- prefix the title with `รอยืนยัน |`;
- retain full internal Case ID and doctor ID in private extended properties;
- store `appointmentStatus = TENTATIVE` in private extended properties;
- use the same deterministic event identity as the booking so confirmation updates rather than duplicates it; and
- do not send a doctor LINE notification.

The visible description keeps only the currently approved customer, Facebook, phone, channel, deposit, Admin, and AE fields, plus `สถานะนัด: รอยืนยัน`.

## 7. Queue Confirmation

### 7.1 Confirmation Form

Use one short Google Form named `PMC Queue Confirmation`.

It collects respondent email and supports two actions:

- `ยืนยันคิวนี้`; and
- `เปลี่ยนวัน`.

The Admin Flex button opens a prefilled response containing the Case ID, proposed date, and proposed time. For `ยืนยันคิวนี้`, the user only reviews and submits. For `เปลี่ยนวัน`, the user enters the replacement date and time before submitting.

Any Admin may submit the confirmation. There is no owner-only restriction. The collected email is written to `appointmentConfirmedBy` and the audit log.

### 7.2 Confirmation transaction

Under a script lock:

1. read the canonical booking and current Calendar event;
2. reject a duplicate confirmation idempotently without creating another event or doctor message;
3. validate the selected date and time;
4. update the existing Calendar event;
5. change color from gray `8` to confirmed color `5`;
6. remove `รอยืนยัน |` from the title;
7. set `appointmentStatus = CONFIRMED` and confirmation audit fields;
8. send the doctor booking Flex once; and
9. create the Day 1–7 call task from the confirmed appointment date.

If the provisional event was manually deleted, confirmation recreates one deterministic confirmed event and records the recovery in the audit log.

## 8. Complete Evidence Display

### 8.1 Source and ordering

The current application truncates evidence to one payment slip and three chat images. Remove both truncation points.

For every booking, create signed preview and full-image references for:

1. all payment-slip files in upload order; then
2. all chat-evidence files in upload order.

The application displays every file accepted by Google Forms. It adds no lower count limit of its own.

### 8.2 LINE presentation

The Admin delivery consists of:

1. the existing compact booking-summary Flex; followed by
2. one or more evidence Flex carousels.

Remove the old partial thumbnail strip from the summary card so the same images are not shown twice. The summary may state the total slip and chat counts, while the following evidence carousels are the complete visual record.

Each evidence bubble contains:

- one square preview;
- a short label such as `สลิป 1` or `แชท 7`; and
- a tap action that opens the signed full image.

Use at most ten evidence bubbles per carousel, preserving two bubbles of headroom under LINE's maximum of twelve. Build additional carousels until every image is represented.

The LINE adapter groups up to five message objects in one push request. If the summary and evidence require more than five objects, it creates additional deterministic push batches. Each batch has its own retry key and durable retry record so an accepted earlier batch is never resent.

No evidence is sent to the doctor group.

### 8.3 Privacy and media safety

- Drive files remain private.
- LINE receives only signed media-proxy URLs.
- Preview and full URLs expire according to the existing media security boundary.
- Tokens retain Case ID, file ID, evidence kind, ordinal, and variant validation.
- Evidence count and order are read back from the canonical intake/retry payload; filenames are not trusted as authority.

## 9. LINE Notifications

### 9.1 Normal queue

- Admin: confirmed booking summary plus all evidence batches.
- Doctor: existing confirmed booking Flex without evidence.

### 9.2 Automatic queue with candidate

- Admin: provisional booking summary, proposed date/time, `ยืนยันคิวนี้`, `เปลี่ยนวัน`, and all evidence batches.
- Doctor: nothing until confirmation.

### 9.3 Automatic queue without candidate

- Admin: paid booking summary, `รอ Admin เลือกวัน`, `เลือกวัน`, and all evidence batches.
- Doctor: nothing.

### 9.4 After confirmation

- Admin: optional concise confirmation acknowledgement only if it can share the same outbound request without creating noisy duplication.
- Doctor: one confirmed booking Flex.
- Call queue: created once from the confirmed appointment date.

## 10. Failure and Retry Behavior

### 10.1 Paid booking succeeds but slot selection fails

The paid booking and evidence remain canonical. Set `appointmentStatus = AWAITING_ADMIN_SLOT`, audit the safe error, and notify Admin through a retry-safe operation. Do not invent a date.

### 10.2 Provisional Calendar creation fails

Queue a deterministic `TENTATIVE_CALENDAR_EVENT` retry. Admin receives a safe `กำลังสร้างคิวชั่วคราว` state only after the booking summary can be delivered. Doctor remains unnotified.

### 10.3 Evidence batch fails

Retry only the failed batch. Previously accepted batches retain their LINE retry keys and are not duplicated.

### 10.4 Confirmation fails midway

The workflow is resumable from canonical appointment state and Calendar event ID. Doctor LINE and call-task creation each keep their own idempotency key. A failure in one does not roll the booking back to unpaid or discard evidence.

### 10.5 Daily-operation isolation

The daily call reminder, deposit expiry, doctor schedule, retry, and dashboard stages must run in isolated failure boundaries. A LINE error in one stage must not prevent deposit-expiry processing or dashboard refresh.

## 11. Form and Schema Cutover

The production cutover order is:

1. create a timestamped Sheet backup;
2. deploy a parser that accepts both the old Form shape and the new queue-type shape;
3. add and migrate canonical Sheet columns;
4. create and verify the Queue Confirmation Form and install its submit trigger;
5. pause booking responses briefly;
6. add the queue-type question and Form sections;
7. configure branching so normal queues require date/time and automatic queues skip them;
8. verify the visible mobile Form and response parsing with synthetic submissions;
9. resume responses; and
10. validate Admin and doctor Flex payloads through LINE's validation endpoint before any pilot push.

Rollback restores the prior Form structure while leaving new canonical columns intact. Backward-compatible parsing remains deployed so responses already submitted during the cutover are not lost.

## 12. Testing

Required automated coverage:

- old Form responses parse as `NORMAL`;
- normal queue requires date and time;
- automatic queue rejects supplied fake placeholders and does not require date/time;
- automatic search uses the selected doctor and service duration;
- search chooses the earliest eligible day and first clear 30-minute candidate after a confirmed case;
- search never proposes outside 10:30–20:30 or after deposit expiry;
- no candidate produces `AWAITING_ADMIN_SLOT` and no Calendar event;
- tentative event is gray, deterministic, and doctor-silent;
- any Admin email can confirm;
- confirmation updates the same event, not a duplicate;
- duplicate confirmation does not duplicate doctor LINE or call tasks;
- all payment and chat files receive signed references in order;
- zero truncation at the former one-slip/three-chat boundaries;
- ten evidence images per carousel and deterministic continuation batches;
- every generated Flex object remains under LINE's 50 KB carousel limit;
- a failed evidence batch retries without resending accepted batches;
- daily-stage isolation allows expiry and dashboard work after a LINE reminder failure; and
- full booking tests, TypeScript, lint, build, LINE validation, and readback checks pass before production activation.

## 13. Acceptance Criteria

The feature is complete only when:

1. staff see only one additional required choice in the booking Form;
2. normal queue behavior remains unchanged;
3. automatic queue submissions require no date/time entry;
4. the system proposes a provisional slot using the approved rule or clearly requests Admin selection;
5. provisional appointments never notify the doctor or start Day 1–7 calls;
6. any Admin can confirm with a short prefilled Form;
7. confirmation updates one Calendar event and triggers doctor/call workflows once;
8. every submitted evidence image appears in the Admin LINE delivery and opens full size;
9. no evidence is made public or sent to doctors;
10. failure in one outbound batch or daily stage does not block unrelated operational stages; and
11. existing bookings remain readable and operational after migration.
