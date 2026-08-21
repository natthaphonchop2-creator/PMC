# PMC Booking Web App Design

## Status

- Architecture, mobile flow, availability rules, evidence handling, security, rollout, and rollback were approved in chat on 2026-08-21.
- The selected mobile calendar layout is **B: monthly calendar plus the selected day's queue list**.
- This specification authorizes design only. It does not authorize implementation or a production deployment.
- This specification extends and partially supersedes the Google Form intake boundary in `2026-08-20-pmc-google-booking-operations-design.md`. Google Sheets remains the operational source of truth and JERA remains the only case-closing authority.

## 1. Purpose

Replace the daily Google Form booking intake with a mobile-first Apps Script Web App that lets clinic staff complete the whole paid-booking workflow in one place:

1. identify the booking closer and AE;
2. enter the minimum customer and booking details;
3. view a doctor's Google Calendar availability;
4. book under the normal two-case capacity or deliberately add a special queue;
5. upload any required number of payment-slip and chat-evidence images;
6. review and confirm the booking; and
7. reuse the existing Sheet, Drive, Calendar, LINE, call-reminder, JERA, audit, and retry workflows.

The Web App must work well on a phone while staff are walking and responding to LINE. It must not depend on an always-running Render Free web service.

## 2. Approved Product Boundary

### 2.1 In scope

- Apps Script HTML Service Web App served from the existing PMC booking Apps Script project.
- A separate Web App deployment URL from the existing LINE webhook deployment.
- Company PIN authentication with remembered-device sessions.
- Four-step mobile booking flow.
- Doctor and service selection before availability calculation.
- Monthly calendar plus per-day queue list.
- Default clinic window from 10:30 to 20:30.
- Appointment starts on 30-minute boundaries.
- Normal capacity of two overlapping cases.
- Admin-created special queues beyond normal capacity without a separate approval.
- Hard-block Calendar events that cannot be overridden.
- Multiple payment-slip images with no product-level count limit.
- Multiple chat-evidence images with no product-level count limit.
- Staged, resumable evidence uploads.
- Existing Google Form retained as an emergency fallback.
- Feature-flagged rollout and immediate rollback to the existing Form.

### 2.2 Out of scope

- Customer self-service booking.
- Doctor approval before a special queue is added.
- Direct JERA integration.
- National ID collection or storage.
- Moving the operational database away from Google Sheets.
- A new Render, database, or paid always-on service for this booking UI.
- Commission calculation rules.

## 3. Architecture

```text
Staff phone
    |
    v
Apps Script Web App (HTML Service)
    |
    +--> PIN + remembered-device session
    +--> CONFIG_STAFF / CONFIG_DOCTORS / CONFIG_SERVICES / CONFIG_CHANNELS
    +--> Google Calendar availability and capacity calculation
    +--> staged private Drive uploads
    |
    v
final confirmation + lock + capacity recheck
    |
    v
WEBAPP_INTAKE_RAW --> BOOKING_MASTER
                         |
                         +--> final Drive evidence folder
                         +--> doctor Calendar event
                         +--> Admin and doctor LINE Flex
                         +--> call queue and dashboard
                         +--> JERA reconciliation later
```

### 3.1 Runtime placement

The Web App UI and its server functions run in Apps Script. `doGet()` serves the login shell and application HTML. Client-side calls use asynchronous `google.script.run` server functions.

The current `doPost()` LINE ingress behavior remains unchanged. The new booking Web App receives its own deployment URL so the rollout can be controlled independently from the existing LINE webhook URL.

Render remains responsible only for its existing workloads. The booking UI must continue to work when the Render Free service is spun down.

### 3.2 Existing workflow reuse

The Web App must not duplicate the downstream booking implementation. Its final server-side submission builds a validated `BookingIntake` and calls the existing booking workflow through the same domain ports used by the Google Form adapter. The current binary overlap check is replaced by one shared capacity classifier so Web App and fallback Form submissions cannot apply contradictory Calendar rules.

Web App submissions use a deterministic synthetic response key derived from the Draft ID, such as `WEBAPP:<draft-id>`, so the current idempotency boundary remains effective.

## 4. Mobile Experience

### 4.1 Login gate

The PIN screen is shown only when the device has no valid session.

- First successful login may select `จำอุปกรณ์นี้ 30 วัน`.
- The phone stores only an opaque session token and the active Draft ID.
- The PIN, customer data, phone, and evidence metadata are never stored in browser storage.
- The user must log in again after expiry, logout, central revocation, PIN rotation, browser-data deletion, incognito use, or switching browsers.
- The UI provides logout and a manager-controlled session-revocation path.

### 4.2 Approved four-step flow

#### Step 1 — Booking details

Required fields:

- `ผู้ปิดการจอง`
- `AE ผู้เปิดแชท`
- customer name
- Thai mobile phone
- doctor
- service/program
- page/channel when required by the current configuration

Closer and AE may be the same staff member. The selected closer and AE, not the shared technical account, remain the performance-attribution authority.

#### Step 2 — Doctor calendar

The approved layout is a month calendar followed by the selected day's queue list.

- Default view: 10:30–20:30.
- Candidate appointment starts: every 30 minutes.
- The view expands automatically when existing events run later than 20:30.
- A `ดูเวลาหลัง 20:30` control reveals later 30-minute candidates on demand. There is no product-level late cutoff; the selected date and derived cross-midnight end time must remain explicit in the review screen.
- Availability uses the selected service duration from `CONFIG_SERVICES`.
- The day list shows time, service/program, and capacity status first.
- An authenticated staff member may tap an existing PMC case to reveal the operational customer name and phone. Non-PMC events display only that the Calendar contains an event.
- `ว่าง` means that the candidate does not exceed Calendar capacity. It does not guarantee that the doctor is physically present.

#### Step 3 — Deposit and evidence

- Deposit amount.
- Multiple payment-slip images.
- Multiple chat-evidence images.
- Camera and photo-library selection on supported mobile browsers.
- Preview, remove-before-submit, per-file progress, per-file retry, and resumable upload state.
- No product-level count limit for slips or chat images.
- Configurable per-file safety validation may reject unsupported or impractically large files before upload.

#### Step 4 — Review and confirm

The review shows:

- customer and full phone;
- closer and AE;
- doctor and service;
- appointment date, start, and derived end;
- deposit and channel;
- slip and chat counts; and
- a prominent orange `คิวพิเศษ` warning when applicable.

The primary action is `ยืนยันและสร้างเคส`. The page explains that Sheet, Drive, Calendar, and LINE actions happen after confirmation.

## 5. Availability and Capacity Rules

### 5.1 Candidate generation

For the selected day:

1. generate starts at 30-minute increments from 10:30 through 20:30;
2. derive the candidate end using the selected service duration;
3. include later candidates only when the user expands late hours or existing events make the later schedule operationally relevant; and
4. evaluate all Calendar events that overlap the candidate interval.

### 5.2 Normal capacity

Normal capacity is two concurrent cases.

For every point in the candidate interval, calculate the number of overlapping capacity-consuming events. A candidate is normal when adding the new booking keeps the peak concurrency at two or fewer.

Example:

- existing case: 10:30–11:30;
- candidate: 11:00–12:00;
- result: allowed as a normal second case because the peak concurrency becomes two.

The UI exposes capacity as `ว่าง 2`, `เหลือ 1`, or `คิวเต็ม` rather than only using color.

### 5.3 Special queue

If any point in the candidate interval is already at normal capacity, staff may deliberately add the booking as a special queue without doctor approval.

- The UI requires a second confirmation.
- The system never silently converts a normal selection into a special queue.
- `capacityStatus = SPECIAL` is stored on the canonical booking.
- The Calendar event, Admin Flex, doctor Flex, and booking UI display an orange `คิวพิเศษ` marker.
- The observed peak capacity at final submission is stored for audit.

### 5.4 Hard block

A Calendar event containing the controlled PMC hard-block marker represents `งดรับคิว`.

- A hard block consumes all capacity for its interval.
- It cannot be overridden by the special-queue control.
- It must have a visually distinct blocked state in the calendar UI.
- The implementation must use an explicit machine marker in event metadata or description, not rely only on a human title string.

### 5.5 Final recheck

The final submit workflow acquires a script lock and reads the Calendar again.

- Still normal: create a normal booking.
- Became full: return a choice to select a new time or explicitly continue as special.
- Hard block appeared: reject the booking and return to calendar selection.
- Calendar unavailable: do not create the booking or send LINE.

## 6. Evidence Upload Design

### 6.1 Staged upload

Evidence is not sent as one large final payload. Each file is uploaded independently into a private draft folder associated with the Draft ID.

```text
PMC Booking Drafts/
  <draft-id>/
    payment/
    chat/
```

Each file has a stable client upload ID. The server returns a stored file ID only after Drive confirms the write. The draft records original category, safe filename, MIME type, byte size, upload state, and Drive file ID.

### 6.2 Reliability

- Upload a small bounded number of files concurrently; queue the remainder.
- Retry only the failed file.
- Returning to the same valid session and Draft ID restores completed uploads.
- Final confirmation is unavailable while required evidence is missing or uploads are incomplete.
- Finalization moves and renames files into the existing customer-and-Case-ID folder structure.
- A failed finalization reuses stored file IDs and cannot create duplicate Drive files.

### 6.3 Abandoned drafts

Unconfirmed draft data and private draft files expire after 24 hours. A scheduled cleanup workflow deletes expired draft files and records a sanitized cleanup audit event. Confirmed booking evidence follows the existing evidence-retention policy instead.

## 7. Data Model

### 7.1 Existing source of truth

`BOOKING_MASTER` remains canonical. Historical Google Form rows and existing Case IDs are preserved without rewriting.

Add the following canonical fields:

- `intakeSource`: `GOOGLE_FORM` or `PMC_WEB_APP`
- `capacityStatus`: `NORMAL` or `SPECIAL`
- `capacityCountAtSubmit`: observed peak Calendar capacity before the new case is added

Existing `formResponseId` stores the deterministic Web App Draft key for Web App submissions.

The schema migration backfills existing canonical rows as `intakeSource = GOOGLE_FORM` and `capacityStatus = NORMAL` without changing any pre-existing field. `capacityCountAtSubmit` remains blank for historical rows because the old workflow did not record the observed concurrency.

### 7.2 New protected tabs

#### `WEBAPP_INTAKE_RAW`

Append-only evidence of the submitted Web App payload after server validation and before downstream external writes. It stores normalized fields and evidence file IDs/counts, not image bytes.

#### `BOOKING_DRAFTS`

One current row per Draft ID, including owner session reference, current step, non-secret field state, upload states, created/updated timestamps, expiry, and final Case ID when confirmed.

#### `WEBAPP_SESSIONS`

Hashed session token, created time, expiry, last-used time, revoked state, and an optional staff-readable device label. Raw tokens and PIN values are prohibited.

### 7.3 Configuration

Add controlled rules to `CONFIG_RULES`:

- default opening time: 10:30;
- default closing time: 20:30;
- slot interval: 30 minutes;
- normal concurrent capacity: 2;
- remembered-device duration: 30 days;
- abandoned-draft retention: 24 hours; and
- Web App feature flag.

## 8. Authentication and Security

### 8.1 PIN storage and login

- Store only a salted PIN hash in Script Properties.
- Compare hashes server-side.
- Rate-limit failed login attempts and temporarily lock repeated failures.
- PIN rotation revokes all remembered-device sessions.
- Do not expose availability, PII, Drive IDs, or configuration before session validation.

### 8.2 Sessions

- Generate a cryptographically random opaque token after successful PIN validation.
- Store only its hash server-side.
- Validate expiry and revocation on every callable server function.
- Keep the raw token only in the device browser.
- Use a fresh request nonce for state-changing operations.
- Do not place PII or raw session tokens in logs.

### 8.3 Data exposure

- The login page contains no operational data.
- All customer details require an authenticated session.
- Evidence folders remain private.
- National ID remains prohibited everywhere in this Web App.
- Calendar event details follow the already-approved audience rules.
- Web App errors return safe user messages and log sanitized technical codes.

## 9. Submission Workflow

The final confirmation workflow must:

1. validate session, Draft ID, request nonce, and feature flag;
2. acquire a script lock;
3. reject an already-confirmed Draft ID or return its existing Case ID;
4. validate closer, AE, customer, phone, doctor, service, channel, deposit, and evidence;
5. re-read Calendar and classify normal, special, or hard-blocked;
6. require explicit special confirmation when the current classification is special;
7. append `WEBAPP_INTAKE_RAW`;
8. build the canonical `BookingIntake` using the deterministic Draft response key;
9. call the existing booking workflow;
10. record the final Case ID on the draft; and
11. return a success view with the Case ID and downstream states.

If the canonical booking exists but Drive, Calendar, or LINE later fails, the existing retry workflow remains authoritative.

## 10. Error Handling

| Condition | User behavior | System behavior |
|---|---|---|
| Session expired | Return to PIN login; preserve Draft ID locally | Do not expose draft until re-authenticated |
| Calendar read failed | Show retry and stop confirmation | No Case ID, Calendar event, or LINE message |
| Capacity changed to full | Choose another slot or explicitly confirm special | Re-run final classification after the user's choice |
| Hard block appeared | Return to calendar | Reject; special override unavailable |
| One file upload failed | Retry that file | Preserve successful file IDs |
| Browser closed during upload | Resume from draft | Restore uploaded-file state after login |
| Duplicate final tap | Return existing result | Draft key and nonce prevent duplicate case creation |
| Sheet inserted, external output failed | Show processing state | Existing retry queue completes Drive/Calendar/LINE |
| Feature flag disabled | Show maintenance/fallback link | Reject all Web App mutations |

## 11. Google Form Fallback

The existing Google Form, triggers, historical responses, and current production workflow remain available during pilot and rollback.

- Staff use the Web App as the primary intake after pilot approval.
- A manager may disable Web App mutations through the feature flag and direct staff back to the Form.
- Fallback Form submissions keep `intakeSource = GOOGLE_FORM`.
- The fallback Form uses the shared capacity engine for normal capacity checks but does not silently create special queues.
- No Sheet, Drive, Calendar, or LINE data migration is required for rollback.

## 12. Deployment

### 12.1 Build output

The Apps Script build must bundle the TypeScript server/domain code and copy versioned HTML/CSS/client assets into the clasp `dist` directory. The Web App client stays thin; validation and authorization remain server-side.

### 12.2 Separate deployment

Create a new versioned Web App deployment URL for booking intake. Preserve the existing LINE webhook deployment and URL. Deployment access may permit the login shell to load anonymously, but every data or mutation function must enforce the approved PIN session boundary.

### 12.3 Feature flag and rollback

- Default disabled until pilot authorization.
- When disabled, the login shell displays maintenance and the Google Form fallback link.
- Rollback requires only disabling the flag; no code rollback or data migration is required.

## 13. Verification and Acceptance

### 13.1 Automated tests

- Session login, expiry, logout, revocation, PIN rotation, and repeated-failure lockout.
- Draft creation, step persistence, expiry, and duplicate confirmation.
- Thai phone validation and required-field rules.
- Candidate generation at 30-minute intervals.
- Variable service durations across 10:30–20:30 and late hours.
- Peak-concurrency calculation with zero, one, and two existing cases.
- Normal second case at a 30-minute stagger.
- Explicit special queue beyond capacity.
- Hard-block rejection.
- Calendar change between preview and final submit.
- Sequential evidence upload, partial failure, retry, resume, finalization, and cleanup.
- Existing Google Form flow, LINE webhook, Drive, Calendar, JERA, and retry regressions.

### 13.2 Visual and device verification

- Mobile viewport approximately 390×844.
- iPhone Safari, Android Chrome, and LINE in-app browser.
- Thai stacked-mark strings and 200% zoom without clipping.
- Minimum 48px tap targets and visible focus states.
- Month calendar, day list, upload queue, error states, special queue, and confirmation state.
- Camera/photo-library behavior with multiple evidence images.

### 13.3 Pilot acceptance criteria

- A staff member can complete a normal booking from a phone without using Google Form.
- A second staggered case remains normal while capacity is available.
- A full slot requires an explicit special-queue confirmation.
- A hard block cannot be overridden.
- Multiple slips and more than five chat images upload and resume reliably.
- Duplicate taps cannot create duplicate Case IDs, folders, events, or LINE messages.
- Selected closer and AE appear correctly in Sheet, Calendar, Flex, and monthly reporting.
- Rollback to Google Form requires only the feature flag and preserves all records.

## 14. Approved Visual Direction

- Clean, minimal, white interface with restrained PMC gold accents.
- IBM Plex Sans Thai for headings and IBM Plex Sans Thai Looped for body text.
- No decorative hero image or mascot in this operational flow.
- Monthly calendar plus selected-day queue list.
- Green for capacity available, amber for one remaining, gray for full, orange for special, and a separate hard-block treatment.
- Status always uses text in addition to color.
- Four-step layout: booking details, calendar, evidence, review.

The approved visual companion artifact is stored under the ignored `.superpowers/brainstorm/` project directory and is a design reference, not production UI code.
