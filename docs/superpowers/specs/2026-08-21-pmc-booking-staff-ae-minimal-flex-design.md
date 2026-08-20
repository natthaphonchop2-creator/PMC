# PMC Booking Staff Identity, AE Attribution, and Minimal Flex Design

**Date:** 2026-08-21  
**Status:** Approved in design conversation; pending written-spec review before implementation planning  
**Project:** PMC Google Booking Operations  
**Related designs:**

- `docs/superpowers/specs/2026-08-20-pmc-google-booking-operations-design.md`
- `docs/superpowers/specs/2026-08-20-pmc-booking-evidence-flex-design.md`

## 1. Objective

Replace shared-account/manual Admin attribution with verified personal-email attribution, record the AE who opened the customer chat separately from the Admin who closed the booking, and redesign both LINE booking messages into the approved clean Minimal Receipt layout.

Google Sheets remains the operational source of truth. JERA remains the only source for actual case closure and actual revenue. This design does not define commission formulas; it preserves distinct Admin and AE attribution so a later commission policy can use either role safely.

## 2. Approved Decisions

- Each booking submitter uses their personal Google account.
- Google Form continues collecting a verified respondent email automatically; staff never type their email into the booking form.
- The submitter email identifies the `Admin ผู้ปิดการจอง` automatically.
- The current `Admin ผู้รับจอง` dropdown is repurposed and relabeled as the required `AE ผู้เปิดแชท` dropdown; the form does not gain an extra manual field.
- Admin closer and AE may be the same person.
- Admin closer and AE names appear in both the Admin-group and doctor-group Flex messages.
- Staff emails never appear in LINE messages.
- Use one canonical `CONFIG_STAFF` directory with role flags instead of two independently maintained Admin/AE tables.
- The current seven staff members initially have both closer and AE eligibility.
- Future AE-only and Admin-only staff are supported through role flags without changing historical bookings.
- Preserve `adminId` and `adminName` as the booking-closer fields for backward compatibility.
- Add `aeId` and `aeName` to every new booking.
- Keep the current Case ID internally in Sheet, audit, retry, Calendar, Drive, and idempotency records, but do not display it in Flex content, fallback text, or alt text.
- Do not display evidence counts in Flex.
- Use the approved Minimal Receipt layout with a small generated PMC monogram, generous white space, thin separators, black/gray text, and restrained gold.
- Do not use a status badge, decorative hero, profile chip, colored information card, carousel, or footer button.
- Admin evidence appears as one payment-slip thumbnail plus up to three chat thumbnails in a fixed-width strip.
- Doctor messages contain no evidence, deposit, channel, Drive link, or evidence URL.

## 3. Non-Goals

- No commission calculation or commission split between Admin and AE.
- No automatic JERA integration.
- No separate AE application, onboarding portal, or self-registration form.
- No manual email field in the booking form.
- No deletion or rewriting of historical booking attribution.
- No change to call-reminder ownership: the Admin closer remains the call owner.
- No change to JERA matching, six-month expiry, retention, Drive folder naming, or doctor Calendar ownership.
- No public Drive sharing and no evidence image in doctor groups.

## 4. Canonical Staff Directory

### 4.1 Sheet topology

Create `CONFIG_STAFF` with these exact columns:

```text
id
name
email
lineUserId
canCloseBooking
canBeAe
active
```

Field rules:

- `id`: stable internal identifier; never derived from row position.
- `name`: display name used in Form choices, Flex messages, Dashboard, and Sheet reports.
- `email`: normalized lowercase Google-account email. It is required and unique for every active row where `canCloseBooking=true`. It may be blank for an AE-only person who never submits booking forms.
- `lineUserId`: optional direct-message mapping retained for call reminders.
- `canCloseBooking`: boolean; allows submitter-email attribution as booking closer.
- `canBeAe`: boolean; includes the person in the AE dropdown.
- `active`: boolean master switch. Inactive staff cannot close bookings or be selected as AE.

The directory must reject duplicate active closer emails case-insensitively. It must also reject duplicate active staff IDs and duplicate active names because the Form stores the selected AE display name.

### 4.2 Current-team migration

Create one `CONFIG_STAFF` row for each of the seven existing `CONFIG_ADMINS` rows:

- preserve `id`, `name`, and `lineUserId`;
- replace the shared company email with the individual's verified Google-account email;
- set `canCloseBooking=true`;
- set `canBeAe=true`; and
- preserve the current active state.

Keep `CONFIG_ADMINS` intact as a read-only rollback snapshot. After cutover, runtime code and Form choice synchronization read only from `CONFIG_STAFF`; there is never more than one active source of staff truth.

### 4.3 Runtime contract

```ts
interface StaffConfig {
  id: string
  name: string
  email: string
  lineUserId: string
  canCloseBooking: boolean
  canBeAe: boolean
  active: boolean
}
```

`ConfigPort` exposes role-specific lookups rather than a generic ambiguous search:

```ts
findCloserByEmail(email: string): StaffConfig | null
findEligibleAeByName(name: string): StaffConfig | null
findStaffById(id: string): StaffConfig | null
listEligibleAes(): StaffConfig[]
```

Call-reminder routing uses `findStaffById`. Booking submission uses only the two role-specific resolution methods.

## 5. Google Form Experience

### 5.1 Booking form

The form remains signed-in and verified-email only.

Repurpose the existing dropdown rather than inserting another field:

```text
Before: Admin ผู้รับจอง
After:  AE ผู้เปิดแชท
```

The field is required. Its choices are the active `CONFIG_STAFF` names where `canBeAe=true`, sorted in the existing operational order.

The submitter does not select or type their own name. Their verified respondent email resolves the Admin closer.

### 5.2 Intake contract

`BookingIntake` changes from manual Admin name to AE name:

```ts
interface BookingIntake {
  formResponseId: string
  submittedAt: string
  submitterEmail: string
  aeName: string
  customerName: string
  phone: string
  doctorId: string
  serviceId: string
  appointmentDate: string
  appointmentTime: string
  depositAmount: number
  channelId: string | null
  paymentEvidenceFileIds: string[]
  chatEvidenceFileIds: string[]
}
```

The label constant is exactly:

```text
AE ผู้เปิดแชท
```

## 6. Booking Attribution and Validation

### 6.1 Resolution sequence

Before monthly sequence allocation or any Drive, Calendar, LINE, retry, call-task, or booking write:

1. normalize `submitterEmail` to lowercase and trim whitespace;
2. resolve one active `CONFIG_STAFF` row with matching email and `canCloseBooking=true`;
3. resolve one active `CONFIG_STAFF` row with matching `aeName` and `canBeAe=true`;
4. allow both resolutions to return the same staff ID; and
5. reject the submission if either resolution is missing or ambiguous.

Rejected identity/role validation has zero downstream side effects and consumes no Case ID sequence.

### 6.2 Booking fields

Keep the existing closer fields and add AE fields:

```text
adminId             = closer staff ID
adminName           = closer display name
submitterEmail       = verified personal email
adminIdentityStatus  = VERIFIED_EMAIL
aeId                 = AE staff ID or null for a historical row
aeName               = AE display name or null for a historical row
callOwnerAdminId     = closer staff ID
```

Insert `aeId` and `aeName` immediately after `adminIdentityStatus` in the canonical `BOOKING_MASTER` header order. New bookings require both fields. Historical rows keep both fields blank and are represented in TypeScript as `string | null`.

`adminIdentityStatus` supports both historical and new records:

```ts
type AdminIdentityStatus = 'SHARED_ACCOUNT' | 'VERIFIED_EMAIL'
```

Historical rows remain `SHARED_ACCOUNT`. No backfill guesses who submitted an old shared-account booking.

### 6.3 Audit and privacy

- Audit may retain normalized submitter email as the actor because it is an internal accountability record.
- Flex messages, fallback text, alt text, Calendar notification copy, and evidence URLs never expose staff email.
- Audit and retry payloads must not contain signed image URLs.
- `BOOKING_CREATED` audit after-state records closer staff ID and AE staff ID, not email or display-only Flex JSON.

## 7. Minimal Receipt Flex Message

This design supersedes the visible layout sections in the 2026-08-20 evidence Flex design. The signed-evidence security and routing design remains unchanged.

### 7.1 Visual system

- one white single bubble;
- no hero block and no carousel;
- small centered PMC monogram at the top;
- centered clinic label, message title, appointment date, and appointment time;
- appointment date uses Thai month text and Buddhist Era year, for example `21 สิงหาคม 2569`; time uses `เวลา 05:00 น.`;
- dark neutral text, medium gray secondary text, thin light-gray separators;
- gold restricted to the monogram and message-title accent;
- no status badge, colored card, section icon, profile chip, gradient background, or footer action;
- section hierarchy comes from white space, font weight, and separators.

### 7.2 Generated PMC monogram

Use the approved generated circular `PMC` monogram as a small header image. During implementation:

- preserve its transparent background;
- resize and optimize it to a production PNG no larger than `256x256` pixels;
- keep a versioned source asset in the repository;
- serve it publicly from the dedicated Cloud Run service at a stable HTTPS asset route;
- set an explicit Apps Script property `BOOKING_BRAND_LOGO_URL`; and
- never embed the image as Base64 in Flex JSON.

The public logo route contains no customer or evidence data and does not require an HMAC token. Evidence routes remain token-protected.

### 7.3 Admin-group bubble

Visible order:

1. generated PMC monogram;
2. `PROMED CLINIC`;
3. `จองเคสใหม่`;
4. appointment date;
5. appointment time;
6. thin separator;
7. `ข้อมูลลูกค้า` with full customer name and full phone;
8. thin separator;
9. `รายละเอียดการจอง` with doctor, service/program, channel, and emphasized deposit amount;
10. thin separator;
11. `ทีมผู้ดูแล` with `ปิดการจอง` and `AE เปิดแชท` as left/right key-value rows;
12. thin separator; and
13. `หลักฐาน` with the evidence strip and the helper `แตะรูปเพื่อเปิดภาพขนาดเต็ม`.

Do not show Case ID, status badge, evidence counts, Drive URL, email, retry status, or internal IDs.

Evidence strip rules:

- show the first payment image followed by up to three chat images;
- reserve four equal thumbnail slots so one or two images do not expand to full bubble width;
- use square `1:1` thumbnails;
- payment uses `aspectMode=fit` to avoid cropping a slip;
- chat uses `aspectMode=cover`;
- each visible thumbnail opens its signed full image;
- unused slots are invisible fillers; and
- do not show a `+N` evidence-count label.

### 7.4 Doctor-group bubble

Use the same typography, centered header, separators, and section rhythm.

Visible content:

- PMC monogram;
- `PROMED CLINIC`;
- event title: `จองเคสใหม่`, `เปลี่ยนเวลานัด`, or `ยกเลิกนัด`;
- appointment date and time;
- customer name and phone;
- doctor and service/program;
- `ปิดการจอง`; and
- `AE เปิดแชท`.

Do not show Case ID, deposit amount, channel, evidence section, evidence URL, Drive URL, status badge, email, or internal ID.

If a historical `SHARED_ACCOUNT` booking is resent or rescheduled and has no AE attribution, show `AE เปิดแชท: ไม่ระบุ (เคสเดิม)` rather than guessing a person.

### 7.5 Fallback and alt text

Case ID remains in the internal `LineMessage.caseIds` field for idempotency and audit correlation but is absent from visible text:

```text
Admin alt/fallback:  จองเคสใหม่ · <appointment date/time>
Doctor alt/fallback: นัดใหม่ · <appointment date/time>
```

## 8. Dashboard and Downstream Behavior

- Dashboard operational rows expose `adminId` and `aeId` as separate attribution dimensions.
- Call queue ownership remains `adminId`/`callOwnerAdminId`.
- JERA reconciliation and close logic remain unchanged.
- Commission remains `PENDING_RULE`; no amount or eligibility rule is inferred from AE attribution.
- Calendar event identity and doctor routing remain unchanged.
- Drive folder naming and evidence retention remain unchanged.

## 9. Error Handling

Setup fails safely when:

- an active closer lacks a personal email;
- two active closer rows share an email after normalization;
- active staff IDs or names are duplicated;
- no active staff can close bookings;
- no active staff can be AE;
- the booking form does not collect verified emails;
- the required AE dropdown is missing; or
- `BOOKING_BRAND_LOGO_URL` is missing or is not HTTPS.

Submission fails before Case ID allocation when:

- submitter email is blank, unmapped, inactive, or lacks closer permission; or
- selected AE is missing, ambiguous, inactive, or lacks AE permission.

The safe error contains no token, LINE ID, evidence file ID, or customer image content.

## 10. Migration and Deployment Order

1. Collect the seven personal Google-account emails outside source control and chat logs.
2. Create and validate `CONFIG_STAFF` while production version 5 still reads `CONFIG_ADMINS`.
3. Copy stable IDs, names, LINE IDs, and active states; set both role flags true.
4. Add `aeId` and `aeName` columns to `BOOKING_MASTER` without changing existing row values.
5. Add the optimized generated logo asset and public Cloud Run route.
6. Verify the public logo route returns PNG over HTTPS and evidence routes still enforce HMAC.
7. Temporarily stop the Booking Form from accepting responses for the cutover window.
8. Update the Form dropdown title to `AE ผู้เปิดแชท`, keep it required, and sync eligible choices.
9. Deploy the Apps Script code using the existing deployment ID only after staff validation succeeds.
10. Re-enable Form responses only after the deployed version reads the new label and `CONFIG_STAFF` successfully.
11. Submit one synthetic booking from an eligible personal email with a different AE.
12. Submit one synthetic booking where closer and AE are the same person.
13. Validate both Admin and doctor Flex objects through the official LINE validator.
14. Send one approved synthetic message to each mapped group and record audience/status only.
15. Keep real-customer use at NO-GO until both evidence upload questions are manually restricted from `ANY` to `IMAGE` by the Form owner.

Rollback:

- redeploy Apps Script version 5;
- restore the original Form dropdown title and choices;
- re-enable Form responses only after version 5 and the original label agree;
- leave `CONFIG_STAFF`, `aeId`, and `aeName` data intact;
- resume runtime reads from `CONFIG_ADMINS`; and
- do not delete new audit rows or evidence.

## 11. Testing

### 11.1 Staff and identity tests

- unique normalized closer email resolves one active staff row;
- unknown, inactive, duplicate, or unauthorized closer email rejects with zero side effects;
- eligible AE resolves by name;
- unknown, inactive, duplicate, or unauthorized AE rejects;
- same closer/AE ID succeeds;
- AE-only future staff can be selected but cannot close a booking;
- Admin-only future staff can close but is absent from AE choices;
- historical `SHARED_ACCOUNT` bookings remain readable.

### 11.2 Form and Sheet tests

- parser requires `AE ผู้เปิดแชท` and no longer reads `Admin ผู้รับจอง`;
- Form choice sync uses only active `canBeAe=true` names;
- `BOOKING_MASTER` persists `aeId` and `aeName` without shifting historical values;
- Dashboard contains separate closer and AE dimensions;
- setup rejects an invalid staff directory before deployment/pilot.

### 11.3 Flex contract tests

- real `header` and `body` blocks follow the approved Minimal Receipt order;
- no hero, footer, badge, colored information card, Case ID, or evidence-count text exists;
- Admin Flex contains the closer and AE display names;
- doctor Flex contains the closer and AE display names;
- staff emails are absent from both messages;
- Admin evidence uses fixed square slots, payment `fit`, and chat `cover`;
- doctor Flex contains no image/evidence URL;
- visible/fallback/alt text contains no Case ID;
- logo URL is HTTPS and message validation returns `200`.

### 11.4 Regression and production pilot

Run:

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npm test
npm run build
git diff --check
```

Then verify synthetic Drive, Calendar, LINE, call-task, retry, audit, Dashboard, permanent-image, and permission-revocation paths remain green.

## 12. Acceptance Criteria

- Staff never select or type their own closer identity during booking.
- One verified personal email maps to exactly one active closer.
- Every new booking records distinct closer and AE IDs/names, including same-person cases.
- Future AE-only/Admin-only staff require only role-flag changes, not a booking-schema change.
- Admin and doctor Flex messages show closer and AE names but no staff email.
- Flex matches the approved Minimal Receipt direction with the small generated PMC monogram.
- Case ID, evidence counts, status badge, decorative hero, and unnecessary actions are absent from visible LINE content.
- Admin evidence thumbnails are small, equal, proportional, and tappable.
- Doctor messages contain no evidence, deposit, or channel.
- Invalid identity/role submissions have zero booking side effects.
- Historical bookings remain unchanged and readable.
- Existing Google/LINE/JERA workflows pass the complete regression suite.
- Real-customer rollout remains blocked until personal-email mapping is complete and Form evidence uploads are `IMAGE` only.
