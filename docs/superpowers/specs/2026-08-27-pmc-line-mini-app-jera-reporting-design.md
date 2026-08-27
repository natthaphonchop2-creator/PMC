# PMC Internal LINE Mini App and JERA Reporting Design

**Date:** 2026-08-27

**Status:** Approved by owner; ready for implementation planning

**Project:** PMC Web

**Audience:** PMC owner, booking Admins, and internal operations staff

## 1. Objective

Replace the staff-facing Google Form as the primary booking interface with an internal LINE Mini App while preserving the existing Google-centered booking workflow and Google Sheet source of truth.

Version 1 has exactly two product modules:

1. **Booking** — Admins create normal or automatic bookings from the Mini App. Confirmed submissions enter the existing `BOOKING_MASTER` workflow and continue to Calendar, Drive, LINE notifications, call tasks, audit, and retry handling.
2. **JERA reports** — Authorized staff view read-only operational and financial reports sourced from the JERA Production API through a secure Cloud Run backend.

The intended staff experience is:

```text
open PMC Rich Menu
  -> LINE Mini App
      -> create booking
      -> view JERA reports
```

The design deliberately keeps Google Form as a fallback during the pilot and does not introduce JERA writes in version 1.

## 2. Approved Product Decisions

- The product is an internal LINE Mini App opened from the `PMC notification` Official Account Rich Menu.
- Google Sheets remains the booking system of record and Dashboard source.
- JERA Production remains the authority for patients, front-desk activity, payments, refunds, and clinic case closure.
- Version 1 contains only `ลงนัดหมาย` and `รายงาน JERA`.
- Google Form remains available as a pilot fallback.
- Both booking modes are supported: `คิวปกติ` and `คิวอัตโนมัติ`.
- Admin identity is derived from verified LINE identity and cannot be changed in the booking form.
- AE remains selectable and may be `ไม่ระบุ` or the same person as Admin.
- Every active, allowlisted staff member can view every version-1 report. Role-based report hiding is deferred.
- The report landing page is a report center with six top-level choices:
  - `สรุปวันนี้`
  - `ยอดรับชำระ`
  - `มัดจำ`
  - `คืนเงิน`
  - `นัดหมาย`
  - `รายงานเพิ่มเติม`
- Reports render cached data immediately, then refresh against JERA in the background.
- Staff can request a manual refresh. The server throttles repeated refreshes.
- Cloud Run in the existing Google Cloud project is the primary runtime.
- LINE identity plus `CONFIG_STAFF` replaces PIN and repeated email entry.
- Version 1 uses JERA Production in read-only mode only.

## 3. Non-Goals

- No conversational LINE Assistant in version 1.
- No replacement or deletion of the current Google Form during the pilot.
- No `POST`, `PATCH`, or `DELETE` of JERA patients, appointments, payments, or clinic data.
- No automatic creation of JERA patients or appointments.
- No automatic case closure or commission recalculation from JERA in version 1.
- No change to current commission formulas.
- No customer-facing booking or self-service portal.
- No new Supabase, PostgreSQL, Redis, or general-purpose database.
- No public signup, public report access, or external sharing.
- No role-specific report visibility in version 1.
- No claim of event-driven JERA real time; the supplied JERA documentation does not expose a webhook.

## 4. Source-of-Truth Boundaries

| Domain | Authoritative system | Mini App behavior |
|---|---|---|
| Booking Case ID, Admin, AE, evidence counts, workflow state | Google `BOOKING_MASTER` | Creates through the existing booking workflow |
| Customer booking evidence | Private Google Drive | Uploads privately, then references Drive file IDs |
| Staff identity and active access | `CONFIG_STAFF` / existing staff configuration | Reads active mapping by LINE user ID |
| Doctor schedule projection | Google Calendar | Existing booking workflow creates or updates events |
| Booking and call notifications | LINE Messaging API | Existing booking workflow sends notifications |
| Patient and clinical front-desk record | JERA Production | Read-only in version 1 |
| Payment, deposit, refund, payment detail | JERA Production | Read-only reports through Cloud Run |
| Report cache and synchronization state | Google Sheets | Cloud Run writes normalized cache rows and sync metadata |

The Mini App never writes directly to Sheet or JERA from browser JavaScript. Every write passes through an authenticated backend boundary.

## 5. Recommended Architecture

### 5.1 Topology

```text
PMC notification Rich Menu
          |
          v
LINE Mini App (mobile-first React)
          |
          | LINE ID token on every API request
          v
Google Cloud Run: pmc-staff-mini-app
  - verify LINE ID token
  - authorize active CONFIG_STAFF user
  - manage booking drafts and evidence uploads
  - sign and dispatch confirmed booking intake
  - obtain and cache JERA access token
  - call allowlisted JERA GET endpoints
  - normalize/cache report records in Sheets
  - expose report APIs
          |
          +----------------------+
          |                      |
          v                      v
Existing Booking Apps Script   JERA Production API
  - BOOKING_MASTER               - patients
  - Calendar                     - appointments
  - Drive case folder            - payments
  - LINE notifications           - deposits/refunds
  - CALL_QUEUE                    - payment details
  - AUDIT_LOG
```

### 5.2 Repository boundaries

The implementation should add isolated modules rather than expanding the legacy SPA or duplicating booking logic:

```text
src/apps/pmc-mini-app/
  - Mini App shell
  - Booking pages
  - Report center and report pages
  - LINE SDK initialization
  - typed API client

server/pmc-mini-app/
  - HTTP router
  - LINE identity verification
  - staff authorization
  - booking draft and upload service
  - signed Booking ingress client
  - report cache service

server/jera/
  - configuration
  - token client
  - allowlisted read-only API client
  - response schemas and normalization
  - report service
  - sync worker
```

Reuse the current OCR LIFF implementation patterns for raw LINE ID tokens, server-side verification, membership/allowlist checks, mobile sizing, and authenticated API calls. Do not couple booking or JERA reports to the OCR ledger's business tables or webhook.

## 6. Internal Authentication and Authorization

1. A staff member opens the Mini App from the PMC Rich Menu.
2. The Mini App initializes the LINE SDK and obtains a raw ID token.
3. Every API request sends `Authorization: Bearer <LINE_ID_TOKEN>`.
4. Cloud Run verifies the token against the configured LINE Login/Mini App channel ID.
5. The verified LINE user ID is matched to one active staff record.
6. Unknown or inactive users receive `403` and the Thai screen `รอผู้ดูแลอนุมัติ`.
7. The server uses the resolved staff record for `adminId`, `adminName`, and all audit events.

Version 1 gives every active staff member access to all report types. The authorization model still retains a role field so report restrictions can be enabled later without changing identity or audit records.

Security requirements:

- Never trust a LINE profile object supplied by the browser.
- Verify the raw ID token server-side on every session establishment.
- Do not expose JERA, Google, LINE channel, or signing credentials to the client.
- Do not use a shared company PIN or repeated email form.
- Record denied access without logging raw ID tokens.

## 7. Mini App Information Architecture

### 7.1 Home

The home page contains two primary cards only:

- `ลงนัดหมาย`
- `รายงาน JERA`

Secondary UI contains the verified staff name, last successful report sync time, and a compact help/fallback link to Google Form.

### 7.2 Navigation

Use a compact four-item bottom navigation:

- `หน้าหลัก`
- `ลงนัด`
- `รายงาน`
- `บัญชี`

Minimum tap target is 48 px. Thai labels remain short, and financial tables support horizontal containment without forcing whole-page horizontal scrolling.

## 8. Booking Module

### 8.1 Booking fields

The Mini App mirrors the canonical current booking intake fields:

```text
adminId/adminName          derived and locked from LINE identity
aeName                     required selection; supports ไม่ระบุ and same as Admin
customerName               required
facebookName               required; supports ไม่มี
phone                      required Thai mobile validation
doctorId                   required selection
serviceId                  required selection
queueType                  NORMAL | AUTO
appointmentDate            required for NORMAL; absent for AUTO
appointmentTime            required for NORMAL; absent for AUTO
depositAmount              required positive amount
channelId                  required selection
payment evidence           1-10 JPEG/PNG files, maximum 10 MB each
chat evidence              1-10 JPEG/PNG files, maximum 10 MB each
```

### 8.2 Booking screens

1. **ข้อมูลลูกค้า** — customer name, Facebook name, phone.
2. **รายละเอียดการจอง** — doctor, service, AE, channel.
3. **รูปแบบคิว** — normal or automatic; normal reveals date/time.
4. **ยอดจองและหลักฐาน** — amount, slip images, chat images.
5. **ตรวจสอบก่อนยืนยัน** — complete read-only preview, thumbnails, and validation warnings.
6. **สำเร็จ** — Case ID and current booking/appointment state.

The UI can keep state between steps, but no canonical booking is created until the staff member explicitly confirms.

### 8.3 Normal queue

- Staff enter the customer-selected date and time.
- Confirmation sends a signed, idempotent intake to the existing booking workflow.
- The existing workflow writes Sheet/Drive, creates the confirmed Calendar event, sends Admin/doctor LINE, and creates the Day 1-7 call task.

### 8.4 Automatic queue

- Staff do not enter a date or time.
- Confirmation sends `queueType=AUTO` to the existing booking workflow.
- The existing automatic queue algorithm proposes a provisional slot or sets `AWAITING_ADMIN_SLOT`.
- Doctor LINE and call tasks remain blocked until the appointment is confirmed.

### 8.5 Evidence upload

Evidence must not travel through Google Form when the Mini App is used.

1. Cloud Run creates a short-lived `draftId` and immutable `requestId`.
2. The client uploads bounded JPEG/PNG evidence to the authenticated Cloud Run endpoint.
3. Cloud Run validates MIME type, file signature, size, and count.
4. Cloud Run uses keyless Google Cloud service identity to create private temporary Drive files inside an allowlisted intake folder shared to that identity.
5. The confirmation request contains only the approved Drive file IDs and signed metadata.
6. The existing Apps Script booking workflow moves/renames those files into the final customer/Case ID folder.

The client never receives a Google OAuth token or unrestricted Drive URL.

Cancelled, expired, or abandoned draft evidence is marked for the existing retention workflow. Version 1 does not permanently delete evidence without the existing approval boundary.

### 8.6 Confirmation and idempotency

- `requestId` is the immutable booking idempotency key.
- One successful confirmation creates at most one Case ID.
- Repeated taps return the prior success result.
- A failed downstream Calendar, Drive, media, or LINE step uses the existing retry queue rather than creating another booking.
- The signed ingress rejects expired signatures, changed payloads, unknown staff, and reused request IDs with conflicting payload hashes.

The Apps Script `doPost` boundary must route an explicit signed `MINI_APP_BOOKING` envelope without changing or bypassing existing LINE directory/webhook behavior. Unknown envelope kinds fail closed.

### 8.7 Google Form fallback

During pilot, the existing Google Form remains published and operational. Both Form and Mini App converge on the same booking domain and canonical Sheet schema.

The fallback link is visible from Mini App help. Disabling Mini App must not disable Form submissions, triggers, Calendar, Drive, LINE, call queue, JERA CSV fallback, or Dashboard reads.

## 9. JERA Production Reporting Module

### 9.1 Authentication

The supplied JERA OpenAPI uses:

- `POST /openapi/v1/token/`
- HTTP Basic Auth with the provisioned production username and password
- form body `grant_type=client_credentials`
- returned Bearer token with `expires_in=36000`

Cloud Run stores JERA username/password in Secret Manager. It caches the token in process for less than its advertised lifetime and refreshes once on an authentication failure. Tokens and credentials never enter Sheets, logs, browser storage, or API responses.

Although the returned JERA scope is documented as `read write`, the version-1 client enforces an application-level read-only allowlist. The only permitted non-GET request is the token request.

### 9.2 Allowlisted JERA reads

Version 1 may call only approved paths needed by the report center:

- clinic and branch information
- staff/user list for display mapping
- patient search/read for report drill-down only
- appointment list
- payment report
- deposit report
- refund report
- payment list
- payment detail
- additional report GET endpoints exposed under `รายงานเพิ่มเติม`

The client must reject any attempted patient, appointment, clinic, or payment mutation before an HTTP request is created.

### 9.3 Report center

Top-level cards:

1. `สรุปวันนี้`
2. `ยอดรับชำระ`
3. `มัดจำ`
4. `คืนเงิน`
5. `นัดหมาย`
6. `รายงานเพิ่มเติม`

`รายงานเพิ่มเติม` exposes supported JERA reports such as payment list, product/service sales, OPD, medicine/service/course use, cancelled payments, cancelled unpaid payments, course sales, and remaining-course reports.

### 9.4 Shared filters

All reports use one consistent filter model where supported by JERA:

- today
- yesterday
- current month
- custom date range
- branch
- doctor
- salesperson
- payment status

Unsupported combinations are disabled rather than silently ignored.

### 9.5 Cache-first live refresh

The report experience is stale-while-revalidate:

1. Return the latest successful normalized cache immediately.
2. Start a deduplicated background JERA refresh for the selected cache key.
3. Update the current view when the refreshed result succeeds.
4. Show `อัปเดตล่าสุดเมื่อ ...` on every report.
5. Provide `รีเฟรชข้อมูล` for staff-triggered refresh.
6. Throttle manual refresh to once per cache key per five minutes.

A Cloud Scheduler job refreshes the current operational windows at least every 15 minutes. The sync worker also performs a daily lookback reconciliation so late changes are not missed.

This is near-real-time when a report is opened, not event-driven real time. If JERA later provides a webhook, webhook invalidation can be added without changing the report UI contract.

### 9.6 Report cache model

Add managed tabs:

#### `JERA_API_CACHE`

One normalized source record per row. Minimum columns:

```text
cacheKey
reportType
sourceUuid
branchUuid
eventDate
patientUuid
patientCode
paymentCode
status
type
total
paidAmount
refundAmount
doctorName
salespersonName
sourceCreatedAt
sourceUpdatedAt
fetchedAt
sourceHash
```

Avoid storing unbounded full JSON in one cell. Detailed payment data is fetched on demand and normalized into bounded response objects.

#### `JERA_SYNC_STATE`

```text
cacheKey
reportType
filterHash
lastAttemptAt
lastSuccessAt
lastSourceDate
status
recordCount
nextPage
safeErrorCode
```

#### `JERA_SYNC_AUDIT`

```text
syncRunId
actorType
actorId
reportType
filterHash
startedAt
finishedAt
status
recordCount
safeErrorCode
correlationId
```

Audit rows never contain bearer tokens, credentials, unrestricted response bodies, or unnecessary patient details.

### 9.7 Report integrity

- Use JERA UUIDs as source idempotency keys.
- Upsert by `(reportType, sourceUuid)` or another endpoint-specific stable identity.
- Preserve decimal money values without float rounding.
- Treat HTML-looking names or remarks as text; never render source strings as HTML.
- Display `ข้อมูลอาจล่าช้า` when the latest refresh failed.
- Do not replace failed/empty responses with zero-valued success data.
- Compare summary totals with normalized detail totals and emit a data-quality warning when they disagree.

## 10. Google Sheet Changes

Add four managed tabs:

1. `MINI_APP_REQUESTS`
2. `JERA_API_CACHE`
3. `JERA_SYNC_STATE`
4. `JERA_SYNC_AUDIT`

### 10.1 `MINI_APP_REQUESTS`

```text
requestId
draftId
staffId
lineUserIdHash
state
retentionState
payloadHash
aeName
customerName
facebookName
phoneNormalized
doctorId
serviceId
queueType
appointmentDate
appointmentTime
depositAmount
channelId
paymentEvidenceFileIdsJson
chatEvidenceFileIdsJson
evidenceCount
createdAt
confirmedAt
caseId
safeErrorCode
updatedAt
```

Allowed states:

```text
DRAFT
UPLOADING
READY_TO_CONFIRM
CONFIRMING
CONFIRMED
FAILED_RETRYABLE
CANCELLED
EXPIRED
```

The draft fields are stored as bounded explicit columns so a Cloud Run restart cannot lose an in-progress booking. Do not store raw LINE ID tokens, JERA credentials, unrestricted URLs, or unbounded request JSON in this tab.

### 10.2 Existing tabs

- `BOOKING_MASTER` remains canonical and retains its current schema unless a later implementation plan identifies a strictly required compatibility field.
- `AUDIT_LOG`, `RETRY_QUEUE`, `CALL_QUEUE`, `RECONCILIATION`, and existing configuration tabs remain operational.
- Existing JERA CSV tabs remain available during the pilot as a fallback and comparison source.

## 11. Cloud Run Runtime

Use one Cloud Run service in the existing Google Cloud project for the Mini App frontend and backend API.

### 11.1 Configuration

Non-secret environment configuration:

```text
PMC_MINI_APP_ENABLED
PMC_MINI_APP_LIFF_CHANNEL_ID
PMC_MINI_APP_ID
PMC_SPREADSHEET_ID
PMC_DRIVE_INTAKE_FOLDER_ID
PMC_BOOKING_INGRESS_URL
JERA_API_BASE_URL
JERA_DEFAULT_BRANCH_UUID
JERA_SYNC_INTERVAL_MINUTES
```

Secret Manager bindings:

```text
JERA_API_USERNAME
JERA_API_PASSWORD
PMC_BOOKING_INGRESS_SECRET
PMC_MINI_APP_SIGNING_SECRET
```

No service-account key file is used. Google access uses the Cloud Run service identity and least-privilege sharing/roles.

### 11.2 Routes

```text
GET  /mini-app/
GET  /api/mini-app/session
GET  /api/mini-app/config
POST /api/mini-app/booking-drafts
POST /api/mini-app/booking-drafts/:draftId/evidence
PATCH /api/mini-app/booking-drafts/:draftId
POST /api/mini-app/booking-drafts/:draftId/confirm
POST /api/mini-app/booking-drafts/:draftId/cancel
GET  /api/mini-app/reports/:reportType
POST /api/mini-app/reports/:reportType/refresh
GET  /api/mini-app/integration-health
POST /internal/mini-app/jera-sync
```

The internal sync route requires Cloud Scheduler OIDC authentication and is not exposed to Mini App users.

### 11.3 Concurrency and retry

- Booking confirmation uses a distributed idempotency record in `MINI_APP_REQUESTS`, not process memory.
- JERA refresh uses one lease per cache key so concurrent users do not duplicate Production API calls.
- Token refresh uses single-flight behavior within each instance.
- A safe retry never changes a confirmed request payload.
- Cloud Run instance restarts must not lose drafts, idempotency decisions, or sync cursor state.

## 12. Failure Behavior

### 12.1 Booking failures

- Upload failure: retain the draft and allow retrying only the failed file.
- Validation failure: show field-level Thai errors without creating a booking.
- Duplicate confirmation: return the existing Case ID.
- Booking ingress timeout: query by `requestId` before retrying.
- Calendar/Drive/LINE failure after Case creation: use existing retry workflow and show the Case ID plus pending status.
- Cloud Run unavailable: staff use the Google Form fallback.

### 12.2 JERA failures

- Authentication failure: refresh token once, then fail closed.
- Rate limit or transient failure: keep cache, display stale status, and back off.
- Schema mismatch: stop normalization for that report type, keep prior cache, and create a sync warning.
- Empty response: distinguish a valid empty result from an error.
- Production timeout: do not retry indefinitely during a user request; enqueue a bounded background refresh.

## 13. Security and Privacy

- Treat all booking, patient, and financial data as internal sensitive data.
- Verify LINE identity server-side and require an active allowlist match.
- Apply strict Content Security Policy to the Mini App.
- Reject requests from unapproved origins and methods.
- Use bounded request bodies, image count, image size, report ranges, and pagination.
- Validate image signatures; do not trust extensions.
- Escape all JERA and Sheet strings on render.
- Never render JERA fields through `innerHTML`.
- Redact phone, email, patient identifiers, tokens, and credentials from logs.
- Keep Secret Manager access limited to the Cloud Run runtime service account.
- Separate production secrets from local and test fixtures.
- Use structured safe error codes in client responses and audit rows.
- Record admin identity and correlation ID for confirmed booking and manual report refresh actions.

## 14. Rollout Plan and Gates

### Gate 0 — local and synthetic

- Build Mini App against synthetic booking and JERA fixtures.
- Verify LINE token validation with test identities.
- Verify all JERA client methods reject disallowed HTTP methods before network access.
- Run mobile browser acceptance for booking and report screens.

### Gate 1 — production JERA read-only shadow

- Owner supplies JERA Production credentials directly into Secret Manager, never chat or source files.
- Call token, clinic, and one small one-day GET window only.
- Compare API output against the same JERA report in the clinic UI and CSV fallback.
- Record sanitized counts and totals, not customer rows, in the rollout evidence.

### Gate 2 — internal staff pilot

- Allowlist a small staff pilot group.
- Keep Google Form visible as fallback.
- Create clearly marked synthetic or approved pilot bookings only.
- Verify one normal queue and one automatic queue end to end.
- Verify report cache, live refresh, stale fallback, and manual refresh throttle.

### Gate 3 — primary intake

- Make Mini App the Rich Menu primary booking action.
- Keep Form fallback through an agreed stabilization period.
- Monitor booking failure, duplicate, report refresh, JERA error, and fallback-use rates.

No gate authorizes JERA writes. Any future JERA appointment or patient write requires a separate design, tests, and explicit owner approval.

## 15. Rollback

Set `PMC_MINI_APP_ENABLED=false` and remove or switch the Rich Menu action to the Google Form fallback.

Rollback must leave these systems unchanged:

- current Google Form
- Booking Apps Script triggers
- `BOOKING_MASTER`
- Calendar
- Drive evidence folders
- LINE notifications
- call queue and reminders
- JERA CSV import fallback
- Dashboard reads

Disable JERA scheduled sync independently while retaining the last successful cache for audit and comparison.

## 16. Testing Strategy

### Unit and contract tests

- LINE ID token verification and staff allowlist.
- Booking field validation and queue branching.
- Evidence MIME, size, count, and upload retry.
- Signed booking ingress and idempotency.
- JERA token lifecycle and single refresh on authentication failure.
- GET-only endpoint allowlist.
- Pagination and date filters.
- Decimal monetary normalization.
- HTML/source-string escaping.
- Cache key, lease, throttle, and stale fallback.

### Integration tests

- Mini App draft -> confirm -> existing booking workflow.
- Normal and automatic queue behavior.
- Duplicate confirmation returns one Case ID.
- Cloud Run service identity access to allowlisted Sheet/Drive resources.
- JERA fixtures for payment, deposit, refund, appointment, payment-list, and detail reports.
- Schema-change and empty-result handling.

### Browser acceptance

- LINE in-app mobile viewport.
- Thai typography and 48 px controls.
- Multi-step booking with multiple images.
- Report center navigation and shared filters.
- Cache-first rendering followed by live refresh.
- Disabled/unknown staff access.
- Form fallback link.

### Production-safe verification

- No production JERA mutation request.
- No secret value in bundles, HTML, logs, Sheet cells, test snapshots, or error responses.
- One-day read-only comparison before wider date ranges.
- Explicit owner gate before Rich Menu changes or production booking submissions.

## 17. Acceptance Criteria

Version 1 is complete only when:

1. An active staff member opens the Mini App without PIN or repeated email entry.
2. An unknown or inactive LINE user cannot access booking or reports.
3. Admin identity is derived from verified LINE identity and written to booking audit.
4. Both normal and automatic booking modes behave like the current canonical workflow.
5. Multiple slip/chat files reach the private final Drive case folder without truncation.
6. Repeated confirmation creates only one Case ID.
7. Google Form remains usable as a fallback.
8. Report center exposes the six approved top-level choices.
9. Every active staff member can access all version-1 reports.
10. Reports render cache immediately and refresh against JERA without exposing credentials.
11. Manual refresh is throttled and audited.
12. Failed JERA refresh keeps prior cache and displays `ข้อมูลอาจล่าช้า` with the last-success time.
13. JERA Production is accessed through the approved read-only allowlist only.
14. No JERA patient, appointment, clinic, or payment mutation occurs.
15. Disabling Mini App restores Form-first operation without data migration or loss.

## 18. Authoritative External References

- LINE LIFF / Mini App overview: `https://developers.line.biz/en/docs/liff/`
- LINE URL schemes and LIFF URLs: `https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/`
- JERA OpenAPI collection: `https://documenter.getpostman.com/view/11316657/2s9YypE3FC`
