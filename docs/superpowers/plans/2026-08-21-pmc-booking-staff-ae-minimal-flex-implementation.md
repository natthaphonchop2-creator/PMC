# PMC Booking Staff, AE Attribution, and Minimal Flex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Attribute every new booking to the verified-email Admin closer and selected AE, then deliver the approved Minimal Receipt Flex with the generated PMC logo and proportional evidence thumbnails.

**Architecture:** A canonical CONFIG_STAFF Sheet directory resolves closer identity from verified email and AE identity from a required Form dropdown. Booking records preserve existing admin fields, add nullable AE fields for historical compatibility, and pass both display names into audience-specific Minimal Receipt builders. The keyless Cloud Run evidence service additionally exposes one public immutable logo asset while keeping evidence routes HMAC-protected.

**Tech Stack:** TypeScript 6, Google Apps Script V8, Google Forms/Sheets APIs, Vitest 4, LINE Messaging API Flex Messages, Node.js HTTP server, Sharp, Cloud Run, Secret Manager.

**Spec:** docs/superpowers/specs/2026-08-21-pmc-booking-staff-ae-minimal-flex-design.md

## Global Constraints

- Google Sheets remains the operational source of truth.
- JERA remains the only source for actual close status and actual revenue.
- Do not calculate or infer an Admin/AE commission rule.
- Staff email identifies the closer internally and never appears in LINE.
- Keep adminId/adminName as closer fields; add aeId/aeName without rewriting historical attribution.
- Closer and AE may be the same person.
- Invalid staff identity or role must fail before Case ID allocation or any Drive, Calendar, LINE, retry, call-task, or booking write.
- Keep Case ID in internal idempotency/audit fields but remove it from visible Flex, fallback text, and alt text.
- Remove evidence counts, status badges, decorative hero, carousel, profile chips, and footer buttons.
- Doctor messages must contain no evidence URL/image, deposit, channel, or Drive link.
- Evidence Drive sharing remains private and read-only through Cloud Run Service Identity.
- Do not print, commit, or paste personal emails, LINE tokens, signing secrets, file IDs, signed URLs, Google IDs, or customer evidence.
- The existing unrelated untracked paths in the main checkout belong to the user and must remain untouched.
- Real-customer rollout remains NO-GO until staff email mapping is complete and both Form upload questions read IMAGE rather than ANY.

## File Map

- Create apps/pmc-google-booking-ops/src/domain/staffDirectory.ts for normalized staff validation and role-safe resolution.
- Create apps/pmc-google-booking-ops/src/domain/sheetMigration.ts for pure header/legacy migration planning.
- Create apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts for audience-neutral Minimal Receipt JSON primitives.
- Create apps/pmc-google-booking-ops/src/workflows/staffAeMigration.ts for safe schema seeding and cutover state.
- Create apps/pmc-google-booking-ops/tests/staffDirectory.test.ts.
- Create apps/pmc-google-booking-ops/tests/sheetMigration.test.ts.
- Create apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts.
- Create assets/pmc-flex-logo-v1.png from the approved generated monogram.
- Modify domain/types.ts, ports.ts, config.ts, sheetSchema.ts, repositories.ts.
- Modify adapters/googleForms.ts, googleSheets.ts, lineMessaging.ts.
- Modify workflows/formSubmit.ts, dashboard.ts, callQueue.ts.
- Modify runtime.ts, entrypoints.ts, scripts/build.mjs.
- Modify server/bookingEvidenceServer.ts and tests/bookingEvidenceServer.test.ts.
- Modify existing Booking tests, setup docs, pilot runbook, and project update logs.

---

### Task 1: Add the Canonical Staff Directory Contract

**Files:**
- Create: apps/pmc-google-booking-ops/src/domain/staffDirectory.ts
- Create: apps/pmc-google-booking-ops/tests/staffDirectory.test.ts
- Modify: apps/pmc-google-booking-ops/src/ports.ts
- Modify: apps/pmc-google-booking-ops/tests/helpers/fakes.ts

**Interfaces:**
- Consumes: raw StaffConfig rows from CONFIG_STAFF.
- Produces: StaffConfig, normalizeStaffEmail, validateStaffDirectory, resolveCloserByEmail, resolveEligibleAeByName.

- [ ] **Step 1: Write failing Staff directory tests**

~~~ts
import { describe, expect, it } from 'vitest'
import {
  resolveCloserByEmail,
  resolveEligibleAeByName,
  validateStaffDirectory,
} from '../src/domain/staffDirectory'
import type { StaffConfig } from '../src/ports'

const staff: StaffConfig[] = [
  {
    id: 'staff-mus',
    name: 'มัส',
    email: 'mus@example.com',
    lineUserId: '',
    canCloseBooking: true,
    canBeAe: true,
    active: true,
  },
  {
    id: 'staff-aim',
    name: 'เอม',
    email: '',
    lineUserId: '',
    canCloseBooking: false,
    canBeAe: true,
    active: true,
  },
]

describe('staff directory', () => {
  it('resolves closer by normalized verified email', () => {
    expect(resolveCloserByEmail(staff, ' MUS@EXAMPLE.COM ')).toMatchObject({ id: 'staff-mus' })
  })

  it('resolves only active AE-eligible staff by name', () => {
    expect(resolveEligibleAeByName(staff, 'เอม')).toMatchObject({ id: 'staff-aim' })
  })

  it('allows the same staff member to close and be AE', () => {
    expect(resolveEligibleAeByName(staff, 'มัส')?.id).toBe(
      resolveCloserByEmail(staff, 'mus@example.com')?.id,
    )
  })

  it('rejects duplicate active closer emails', () => {
    expect(() =>
      validateStaffDirectory([
        staff[0],
        { ...staff[0], id: 'staff-duplicate', name: 'ซ้ำ' },
      ]),
    ).toThrow('duplicate active closer email')
  })

  it('keeps AE-only staff from closing a booking', () => {
    expect(resolveCloserByEmail(staff, '')).toBeNull()
    expect(resolveCloserByEmail(staff, 'aim@example.com')).toBeNull()
  })
})
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/staffDirectory.test.ts
~~~

Expected: FAIL because staffDirectory.ts and StaffConfig do not exist.

- [ ] **Step 3: Add StaffConfig and role-safe lookup methods**

Replace AdminConfig in ports.ts with:

~~~ts
export interface StaffConfig {
  id: string
  name: string
  email: string
  lineUserId: string
  canCloseBooking: boolean
  canBeAe: boolean
  active: boolean
}

export interface ConfigPort {
  findCloserByEmail(email: string): StaffConfig | null
  findEligibleAeByName(name: string): StaffConfig | null
  findStaffById(id: string): StaffConfig | null
  listStaff(): StaffConfig[]
  listEligibleAes(): StaffConfig[]
  findDoctor(id: string): DoctorConfig | null
  findService(id: string): ServiceConfig | null
  findChannel(id: string): ChannelConfig | null
  adminLineGroupId(): string
  brandLogoUrl(): string
  listDoctors(): DoctorConfig[]
  listServices(): ServiceConfig[]
  listChannels(): ChannelConfig[]
}
~~~

- [ ] **Step 4: Implement pure Staff validation and resolution**

~~~ts
import type { StaffConfig } from '../ports'

export function normalizeStaffEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function validateStaffDirectory(staff: StaffConfig[]): {
  activeClosers: StaffConfig[]
  activeAes: StaffConfig[]
} {
  const active = staff.filter((item) => item.active)
  const activeClosers = active.filter((item) => item.canCloseBooking)
  const activeAes = active.filter((item) => item.canBeAe)
  if (!activeClosers.length) throw new Error('no active booking closer')
  if (!activeAes.length) throw new Error('no active AE')
  const ids = active.map((item) => item.id)
  const names = active.map((item) => item.name)
  const closerEmails = activeClosers.map((item) => normalizeStaffEmail(item.email))
  if (closerEmails.some((email) => !email)) throw new Error('active closer email is required')
  if (new Set(ids).size !== ids.length) throw new Error('duplicate active staff ID')
  if (new Set(names).size !== names.length) throw new Error('duplicate active staff name')
  if (new Set(closerEmails).size !== closerEmails.length) {
    throw new Error('duplicate active closer email')
  }
  return { activeClosers, activeAes }
}

export function resolveCloserByEmail(staff: StaffConfig[], email: string): StaffConfig | null {
  const normalized = normalizeStaffEmail(email)
  const matches = staff.filter(
    (item) =>
      item.active &&
      item.canCloseBooking &&
      normalizeStaffEmail(item.email) === normalized,
  )
  return matches.length === 1 ? matches[0] : null
}

export function resolveEligibleAeByName(staff: StaffConfig[], name: string): StaffConfig | null {
  const matches = staff.filter(
    (item) => item.active && item.canBeAe && item.name === name.trim(),
  )
  return matches.length === 1 ? matches[0] : null
}
~~~

- [ ] **Step 5: Update test fakes to expose the new ConfigPort**

Use one closer and two AE-eligible staff in createTestPorts. Include an AE-only fixture so later workflow tests can prove role separation.

- [ ] **Step 6: Run GREEN and commit**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/staffDirectory.test.ts
git add apps/pmc-google-booking-ops/src/domain/staffDirectory.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/tests/staffDirectory.test.ts apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: add canonical booking staff directory"
~~~

Expected: Staff directory tests PASS.

---

### Task 2: Migrate Booking and Sheet Schemas Without Rewriting History

**Files:**
- Create: apps/pmc-google-booking-ops/src/domain/sheetMigration.ts
- Create: apps/pmc-google-booking-ops/tests/sheetMigration.test.ts
- Modify: apps/pmc-google-booking-ops/src/domain/types.ts
- Modify: apps/pmc-google-booking-ops/src/sheetSchema.ts
- Modify: apps/pmc-google-booking-ops/src/repositories.ts
- Modify: apps/pmc-google-booking-ops/src/adapters/googleSheets.ts
- Modify: apps/pmc-google-booking-ops/tests/helpers/fakes.ts

**Interfaces:**
- Consumes: legacy BOOKING_MASTER header and row objects.
- Produces: nullable aeId/aeName fields, CONFIG_STAFF schema, bookingMasterMigrationPlan, historical-row normalization.

- [ ] **Step 1: Write failing schema migration tests**

~~~ts
import { describe, expect, it } from 'vitest'
import { bookingMasterMigrationPlan } from '../src/domain/sheetMigration'
import { BOOKING_MASTER_COLUMNS } from '../src/sheetSchema'

describe('booking staff schema migration', () => {
  it('inserts AE columns immediately after adminIdentityStatus', () => {
    const legacy = BOOKING_MASTER_COLUMNS.filter(
      (column) => !['aeId', 'aeName'].includes(column),
    )
    expect(bookingMasterMigrationPlan(legacy)).toEqual({
      kind: 'INSERT_AE_COLUMNS',
      afterColumn: 8,
      headers: ['aeId', 'aeName'],
    })
  })

  it('does nothing when the canonical header already exists', () => {
    expect(bookingMasterMigrationPlan([...BOOKING_MASTER_COLUMNS])).toEqual({ kind: 'NONE' })
  })

  it('rejects an unknown header instead of shifting customer data', () => {
    expect(() => bookingMasterMigrationPlan(['caseId', 'unexpected'])).toThrow(
      'unsupported BOOKING_MASTER header',
    )
  })
})
~~~

- [ ] **Step 2: Run RED**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts
~~~

Expected: FAIL because AE fields and migration planner do not exist.

- [ ] **Step 3: Extend Booking types and canonical columns**

~~~ts
export type AdminIdentityStatus = 'SHARED_ACCOUNT' | 'VERIFIED_EMAIL'

export interface BookingCase {
  // existing fields through adminIdentityStatus
  adminIdentityStatus: AdminIdentityStatus
  aeId: string | null
  aeName: string | null
  // remaining existing fields
}
~~~

Insert aeId and aeName after adminIdentityStatus in BOOKING_MASTER_COLUMNS. Add:

~~~ts
CONFIG_STAFF: [
  'id',
  'name',
  'email',
  'lineUserId',
  'canCloseBooking',
  'canBeAe',
  'active',
],
~~~

- [ ] **Step 4: Implement a pure migration planner**

~~~ts
import { BOOKING_MASTER_COLUMNS } from '../sheetSchema'

export type BookingMasterMigrationPlan =
  | { kind: 'NONE' }
  | { kind: 'INSERT_AE_COLUMNS'; afterColumn: number; headers: ['aeId', 'aeName'] }

export function bookingMasterMigrationPlan(existing: string[]): BookingMasterMigrationPlan {
  if (JSON.stringify(existing) === JSON.stringify(BOOKING_MASTER_COLUMNS)) return { kind: 'NONE' }
  const legacy = BOOKING_MASTER_COLUMNS.filter((column) => !['aeId', 'aeName'].includes(column))
  if (JSON.stringify(existing) === JSON.stringify(legacy)) {
    return { kind: 'INSERT_AE_COLUMNS', afterColumn: 8, headers: ['aeId', 'aeName'] }
  }
  throw new Error('unsupported BOOKING_MASTER header')
}
~~~

- [ ] **Step 5: Apply the plan before ensureSheetTopology**

Add migrateBookingMasterStaffColumns(spreadsheet) to googleSheets.ts. It must read row 1, call bookingMasterMigrationPlan, insert two columns after the eighth column only for INSERT_AE_COLUMNS, and write aeId/aeName into the new header cells. No row value is rewritten.

- [ ] **Step 6: Normalize historical rows in repositories**

~~~ts
function nullableString(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function asBooking(row: SheetRow): BookingCase {
  return {
    ...row,
    aeId: nullableString(row.aeId),
    aeName: nullableString(row.aeName),
  } as unknown as BookingCase
}
~~~

Update bookingFixture with aeId: 'staff-ae' and aeName: 'เอม'; add one historical fixture with both null.

- [ ] **Step 7: Run GREEN and commit**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts
npm run booking:typecheck
git add apps/pmc-google-booking-ops/src/domain/sheetMigration.ts apps/pmc-google-booking-ops/src/domain/types.ts apps/pmc-google-booking-ops/src/sheetSchema.ts apps/pmc-google-booking-ops/src/repositories.ts apps/pmc-google-booking-ops/src/adapters/googleSheets.ts apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: add AE-safe booking schema migration"
~~~

Expected: migration tests and typecheck PASS.

---

### Task 3: Switch Form Parsing and Runtime Configuration to Staff/AE

**Files:**
- Modify: apps/pmc-google-booking-ops/src/config.ts
- Modify: apps/pmc-google-booking-ops/src/domain/types.ts
- Modify: apps/pmc-google-booking-ops/src/ports.ts
- Modify: apps/pmc-google-booking-ops/src/adapters/googleForms.ts
- Modify: apps/pmc-google-booking-ops/src/runtime.ts
- Modify: apps/pmc-google-booking-ops/tests/formSubmit.test.ts
- Modify: apps/pmc-google-booking-ops/tests/endToEnd.test.ts
- Modify: apps/pmc-google-booking-ops/tests/helpers/fakes.ts

**Interfaces:**
- Consumes: CONFIG_STAFF, verified respondent email, AE ผู้เปิดแชท.
- Produces: BookingIntake.aeName, staff-backed ConfigPort, eligible-AE Form choices, BOOKING_BRAND_LOGO_URL.

- [ ] **Step 1: Change Form tests first**

Replace the old Admin field in the parser fixture:

~~~ts
namedValues: {
  'AE ผู้เปิดแชท': ['เอม'],
  ชื่อลูกค้า: ['ลูกค้าทดสอบ'],
  เบอร์มือถือ: ['0812345678'],
  หมอ: ['doctor-1'],
  'บริการ/โปรแกรม': ['service-1'],
  วันที่นัด: ['2026-08-20'],
  เวลานัด: ['13:00'],
  จำนวนเงินจอง: ['1000'],
  สลิปเงินจอง: ['payment-file-id-123456789012345'],
  หลักฐานแชท: ['chat-file-id-123456789012345'],
}
~~~

Assert:

~~~ts
expect(intake.aeName).toBe('เอม')
expect('adminName' in intake).toBe(false)
expect(intake.submitterEmail).toBe('admin@example.com')
~~~

Add a test that the parser throws missing Form field: AE ผู้เปิดแชท when only Admin ผู้รับจอง is present.

- [ ] **Step 2: Run RED**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/formSubmit.test.ts
~~~

Expected: FAIL because parser still requires Admin ผู้รับจอง.

- [ ] **Step 3: Update labels, Intake, and FormPort**

~~~ts
export const BOOKING_FORM_LABELS = {
  aeName: 'AE ผู้เปิดแชท',
  // existing customer, phone, doctor, service, date, time, deposit, channel, evidence labels
} as const

export interface BookingIntake {
  formResponseId: string
  submittedAt: string
  submitterEmail: string
  aeName: string
  // existing remaining intake fields
}
~~~

Change FormsPort:

~~~ts
export interface FormsPort {
  syncBookingChoices(
    aeNames: string[],
    doctorIds: string[],
    serviceIds: string[],
    channelIds: string[],
  ): void
  syncCallResultChoices(results: string[]): void
  bookingCollectsEmail(): boolean
  pauseBookingResponses(): void
  renameAdminFieldToAe(): void
  resumeBookingResponses(): void
}
~~~

- [ ] **Step 4: Update Google Forms adapter**

parseBookingFormEvent reads aeName. createGoogleFormsPort.syncBookingChoices updates only BOOKING_FORM_LABELS.aeName. bookingCollectsEmail returns FormApp.openById(bookingFormId).collectsEmail(). pause/resume use setAcceptingResponses(false/true). renameAdminFieldToAe finds one LIST item titled either Admin ผู้รับจอง or AE ผู้เปิดแชท, sets the new title, and keeps it required.

- [ ] **Step 5: Replace CONFIG_ADMINS runtime reads**

Change createConfigPort to createConfigPort(store, adminLineGroupId, brandLogoUrl). Create StaffConfig rows from CONFIG_STAFF, parsing canCloseBooking/canBeAe/active with isActive. Return:

~~~ts
findCloserByEmail: (email) => resolveCloserByEmail(staff(), email),
findEligibleAeByName: (name) => resolveEligibleAeByName(staff(), name),
findStaffById: (id) => staff().find((item) => item.id === id) ?? null,
listStaff: staff,
listEligibleAes: () => staff().filter((item) => item.active && item.canBeAe),
brandLogoUrl: () => properties[SCRIPT_PROPERTY_KEYS.brandLogoUrl],
~~~

Add BOOKING_BRAND_LOGO_URL to SCRIPT_PROPERTY_KEYS and REQUIRED_PROPERTIES.

- [ ] **Step 6: Validate setup inputs before choice sync**

setupSystem must call migrateBookingMasterStaffColumns before ensureSheetTopology, validateStaffDirectory(runtime.config.listStaff()), require bookingCollectsEmail(), and pass listEligibleAes names into syncBookingChoices. Replace syncedAdmins with both syncedStaff and syncedAes after all calling tests/docs are updated.

- [ ] **Step 7: Run GREEN and commit**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts
npm run booking:typecheck
git add apps/pmc-google-booking-ops/src/config.ts apps/pmc-google-booking-ops/src/domain/types.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/src/adapters/googleForms.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: identify booking closer by email and select AE"
~~~

Expected: Form/runtime tests and typecheck PASS.

---

### Task 4: Attribute Booking Workflow With Zero-Side-Effect Rejection

**Files:**
- Modify: apps/pmc-google-booking-ops/src/workflows/formSubmit.ts
- Modify: apps/pmc-google-booking-ops/src/runtime.ts
- Modify: apps/pmc-google-booking-ops/tests/formSubmit.test.ts
- Modify: apps/pmc-google-booking-ops/tests/endToEnd.test.ts
- Modify: apps/pmc-google-booking-ops/tests/helpers/fakes.ts

**Interfaces:**
- Consumes: ConfigPort.findCloserByEmail and findEligibleAeByName.
- Produces: new BookingCase rows with VERIFIED_EMAIL, closer fields, AE fields, closer-owned call task.

- [ ] **Step 1: Write failing attribution tests**

~~~ts
it('attributes closer from verified email and AE from the required choice', () => {
  const ports = createTestPorts()
  const result = submitBookingIntake(
    validBookingIntake({ submitterEmail: 'admin@example.com', aeName: 'เอม' }),
    ports,
  )
  expect(result).toMatchObject({
    adminId: 'staff-admin',
    adminName: 'มัส',
    adminIdentityStatus: 'VERIFIED_EMAIL',
    aeId: 'staff-ae',
    aeName: 'เอม',
    callOwnerAdminId: 'staff-admin',
  })
})

it('accepts the closer as AE in the same booking', () => {
  const result = submitBookingIntake(validBookingIntake({ aeName: 'มัส' }), createTestPorts())
  expect(result.aeId).toBe(result.adminId)
})

it('rejects unknown closer email before sequence allocation or side effects', () => {
  const ports = createTestPorts()
  expect(() =>
    submitBookingIntake(validBookingIntake({ submitterEmail: 'unknown@example.com' }), ports),
  ).toThrow('submitter is not an active booking closer')
  expect(ports.bookings.list()).toEqual([])
  expect(ports.calendar.createdEvents()).toEqual([])
  expect(ports.line.adminMessages()).toEqual([])
  const firstValid = submitBookingIntake(validBookingIntake({ formResponseId: 'response-2' }), ports)
  expect(firstValid.caseId).toBe('PMC-202608-0001')
})

it('rejects an ineligible AE before any booking side effect', () => {
  const ports = createTestPorts()
  expect(() =>
    submitBookingIntake(validBookingIntake({ aeName: 'Admin Only' }), ports),
  ).toThrow('selected AE is not active or eligible')
  expect(ports.bookings.list()).toEqual([])
})
~~~

- [ ] **Step 2: Run RED**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/formSubmit.test.ts
~~~

Expected: FAIL because submitBookingIntake still resolves a selected Admin name and writes SHARED_ACCOUNT.

- [ ] **Step 3: Resolve roles before sequence allocation**

At the top of submitBookingIntake, after evidence/basic value checks and duplicate Form-response check:

~~~ts
const closer = ports.config.findCloserByEmail(intake.submitterEmail)
if (!closer) throw new Error('submitter is not an active booking closer')
const ae = ports.config.findEligibleAeByName(intake.aeName)
if (!ae) throw new Error('selected AE is not active or eligible')
~~~

Do this before normalize phone, derive appointment, allocateMonthlySequence, or any repository write.

- [ ] **Step 4: Persist closer and AE attribution**

~~~ts
adminId: closer.id,
adminName: closer.name,
submitterEmail: intake.submitterEmail.trim().toLowerCase(),
adminIdentityStatus: 'VERIFIED_EMAIL',
aeId: ae.id,
aeName: ae.name,
callOwnerAdminId: closer.id,
~~~

Extend BOOKING_CREATED audit after-state to:

~~~ts
after: {
  status: booking.status,
  adminId: closer.id,
  aeId: ae.id,
},
~~~

- [ ] **Step 5: Keep retry reconstruction historical-safe**

For DRIVE_EVIDENCE retry, set aeName to booking.aeName ?? 'ไม่ระบุ (เคสเดิม)'. This field is required by the Intake type but does not change Drive naming. Do not synthesize aeId.

- [ ] **Step 6: Run GREEN and commit**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts
npm run booking:typecheck
git add apps/pmc-google-booking-ops/src/workflows/formSubmit.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: record verified closer and AE attribution"
~~~

Expected: new attribution, same-person, and zero-side-effect tests PASS.

---

### Task 5: Propagate AE Through Dashboard, Calls, and Historical Reads

**Files:**
- Modify: apps/pmc-google-booking-ops/src/workflows/dashboard.ts
- Modify: apps/pmc-google-booking-ops/src/adapters/googleSheets.ts
- Modify: apps/pmc-google-booking-ops/src/workflows/callQueue.ts
- Modify: apps/pmc-google-booking-ops/tests/dashboard.test.ts
- Modify: apps/pmc-google-booking-ops/tests/callQueue.test.ts
- Modify: apps/pmc-google-booking-ops/tests/helpers/fakes.ts

**Interfaces:**
- Consumes: BookingCase.adminId, aeId, callOwnerAdminId.
- Produces: separate Dashboard closer/AE dimensions and unchanged closer-owned call routing.

- [ ] **Step 1: Write failing Dashboard and call-owner tests**

~~~ts
expect(buildDashboardSnapshot([bookingFixture()], []).operations[0]).toMatchObject({
  adminId: 'staff-admin',
  aeId: 'staff-ae',
})
~~~

Add a call reminder test where aeId differs from adminId and assert the direct reminder resolves adminId/callOwnerAdminId only.

- [ ] **Step 2: Run RED**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/dashboard.test.ts apps/pmc-google-booking-ops/tests/callQueue.test.ts
~~~

Expected: FAIL because Dashboard has no aeId and call lookup still uses findAdminById.

- [ ] **Step 3: Add the AE Dashboard dimension**

Add aeId: string | null to DashboardSnapshot.operations. Include aeId in buildDashboardSnapshot and add aeId immediately after adminId in createGoogleDashboardPort.operationHeaders.

- [ ] **Step 4: Keep call routing on the closer**

Replace findAdminById with findStaffById in callQueue.ts. Do not reference booking.aeId when assigning or routing call reminders.

- [ ] **Step 5: Run GREEN and commit**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/dashboard.test.ts apps/pmc-google-booking-ops/tests/callQueue.test.ts
git add apps/pmc-google-booking-ops/src/workflows/dashboard.ts apps/pmc-google-booking-ops/src/adapters/googleSheets.ts apps/pmc-google-booking-ops/src/workflows/callQueue.ts apps/pmc-google-booking-ops/tests/dashboard.test.ts apps/pmc-google-booking-ops/tests/callQueue.test.ts apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: expose AE attribution without changing call ownership"
~~~

Expected: Dashboard and call tests PASS.

---

### Task 6: Build the Minimal Receipt Flex Contract

**Files:**
- Create: apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts
- Create: apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts
- Modify: apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts
- Modify: apps/pmc-google-booking-ops/src/runtime.ts
- Modify: apps/pmc-google-booking-ops/src/workflows/formSubmit.ts
- Modify: apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
- Modify: apps/pmc-google-booking-ops/tests/helpers/fakes.ts

**Interfaces:**
- Consumes: BookingCase, BookingEvidenceImages, HTTPS brandLogoUrl.
- Produces: buildAdminMinimalReceipt, buildDoctorMinimalReceipt, Thai appointment formatting, four fixed evidence slots.

- [ ] **Step 1: Write the failing Minimal Receipt tests**

~~~ts
import { describe, expect, it } from 'vitest'
import {
  buildAdminMinimalReceipt,
  buildDoctorMinimalReceipt,
} from '../src/adapters/minimalReceiptFlex'
import { bookingFixture } from './helpers/fakes'

const logoUrl = 'https://evidence.example/assets/pmc-flex-logo.png'
const evidence = {
  payment: { previewUrl: 'https://media/pay-preview', fullUrl: 'https://media/pay-full' },
  chats: [
    { previewUrl: 'https://media/chat-preview', fullUrl: 'https://media/chat-full' },
  ],
  totalChatCount: 1,
}

describe('Minimal Receipt Flex', () => {
  it('uses real header/body blocks and omits rejected decorations', () => {
    const payload = buildAdminMinimalReceipt(bookingFixture(), evidence, logoUrl)
    const json = JSON.stringify(payload)
    expect(payload.contents).toMatchObject({ type: 'bubble', header: { type: 'box' }, body: { type: 'box' } })
    expect(json).toContain('PROMED CLINIC')
    expect(json).toContain('21 สิงหาคม 2569')
    expect(json).not.toContain('PMC-202608-0001')
    expect(json).not.toContain('ยืนยันแล้ว')
    expect(json).not.toContain('สลิป 1')
    expect(json).not.toContain('+')
    expect(json).not.toContain('"hero"')
    expect(json).not.toContain('"footer"')
  })

  it('shows closer and AE names in both audiences without email', () => {
    const booking = bookingFixture({
      adminName: 'มัส',
      aeName: 'เอม',
      submitterEmail: 'mus@example.com',
    })
    for (const message of [
      buildAdminMinimalReceipt(booking, evidence, logoUrl),
      buildDoctorMinimalReceipt(booking, 'BOOKING_CONFIRMED', logoUrl),
    ]) {
      const json = JSON.stringify(message)
      expect(json).toContain('มัส')
      expect(json).toContain('เอม')
      expect(json).not.toContain('mus@example.com')
    }
  })

  it('uses fixed square evidence slots with payment fit and chat cover', () => {
    const json = JSON.stringify(buildAdminMinimalReceipt(bookingFixture(), evidence, logoUrl))
    expect(json).toContain('"aspectRatio":"1:1"')
    expect(json).toContain('"aspectMode":"fit"')
    expect(json).toContain('"aspectMode":"cover"')
    expect((json.match(/"type":"filler"/g) ?? [])).toHaveLength(2)
  })

  it('keeps doctor payload evidence, deposit, and channel free', () => {
    const json = JSON.stringify(
      buildDoctorMinimalReceipt(bookingFixture(), 'BOOKING_CONFIRMED', logoUrl),
    )
    expect(json).not.toContain('media/')
    expect(json).not.toContain('ยอดจอง')
    expect(json).not.toContain('ช่องทาง')
    expect(json).not.toContain('หลักฐาน')
  })
})
~~~

- [ ] **Step 2: Run RED**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts
~~~

Expected: FAIL because the Minimal Receipt builder does not exist.

- [ ] **Step 3: Implement Thai date and plain-section primitives**

minimalReceiptFlex.ts must export:

~~~ts
export function formatThaiAppointment(value: string): { date: string; time: string }
export function buildAdminMinimalReceipt(
  booking: BookingCase,
  evidence: BookingEvidenceImages,
  brandLogoUrl: string,
): Record<string, unknown>
export function buildDoctorMinimalReceipt(
  booking: BookingCase,
  eventType: 'BOOKING_CONFIRMED' | 'RESCHEDULED' | 'CANCELLED',
  brandLogoUrl: string,
): Record<string, unknown>
~~~

Parse YYYY-MM-DDTHH:mm directly, add 543 to the year, and map month numbers to the twelve Thai month names. Avoid Date timezone conversion.

- [ ] **Step 4: Implement the fixed evidence strip**

Build four horizontal flex-1 slots. Slot 1 is payment with aspectMode fit. Slots 2-4 are chats with aspectMode cover. Every image uses aspectRatio 1:1 and a URI action to fullUrl. Missing slots are { type: 'filler', flex: 1 }. Do not render totalChatCount or a +N label.

- [ ] **Step 5: Replace visible message builders**

lineMessaging.ts calls the new builders. Update signatures:

~~~ts
adminBookingMessage(booking, adminLineGroupId, evidence, brandLogoUrl, messageVersion)
doctorBookingMessage(booking, eventType, brandLogoUrl, messageVersion)
sendBookingConfirmationMessages(booking, line, adminLineGroupId, evidence, brandLogoUrl, messageVersion)
~~~

Visible text/alt text becomes appointment-only:

~~~ts
text: 'จองเคสใหม่ · ' + booking.appointmentStart
altText: 'จองเคสใหม่ · ' + booking.appointmentStart
~~~

Keep caseIds and retryKey unchanged internally.

- [ ] **Step 6: Pass brandLogoUrl through new sends and retries**

Use ports.config.brandLogoUrl() in formSubmit.ts and every LINE retry/reschedule path in runtime.ts. Historical null AE displays ไม่ระบุ (เคสเดิม).

- [ ] **Step 7: Replace outdated LINE assertions**

driveCalendarLine.test.ts must assert Minimal Receipt structure, no visible Case ID/count/badge, both staff names, correct evidence slot modes, and no doctor evidence. Remove expectations for +N รูปเพิ่มเติมใน Drive and large payment image.

- [ ] **Step 8: Run GREEN and commit**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
npm run booking:typecheck
git add apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/src/workflows/formSubmit.ts apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: redesign booking LINE as Minimal Receipt"
~~~

Expected: focused Flex tests and typecheck PASS.

---

### Task 7: Add the Generated PMC Logo and Public Cloud Run Route

**Files:**
- Create: assets/pmc-flex-logo-v1.png
- Modify: server/bookingEvidenceServer.ts
- Modify: tests/bookingEvidenceServer.test.ts
- Modify: docs/PROJECT_UPDATES.md

**Interfaces:**
- Consumes: approved generated source /Users/natthaphon/.codex/generated_images/01a01d81-51eb-7b63-9da0-e600131614c9/exec-092b05a1-9e52-473c-98a3-6c2769b3aa01.png.
- Produces: optimized transparent PNG and GET/HEAD /assets/pmc-flex-logo-v1.png.

- [ ] **Step 1: Write failing logo-route tests**

Extend invoke to accept method. Add:

~~~ts
it('serves the public PMC logo without invoking the evidence proxy', async () => {
  let proxyCalls = 0
  const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const handler = createBookingEvidenceRequestHandler(
    async () => { proxyCalls += 1 },
    logo,
  )
  const response = await invoke(handler, '/assets/pmc-flex-logo-v1.png')
  expect(response.status).toBe(200)
  expect(response.headers['content-type']).toBe('image/png')
  expect(response.headers['cache-control']).toContain('public')
  expect(response.bodyBuffer).toEqual(logo)
  expect(proxyCalls).toBe(0)
})
~~~

Add a HEAD assertion returning 200 with an empty body. Keep evidence-path delegation tests unchanged.

- [ ] **Step 2: Run RED**

~~~bash
npm test -- tests/bookingEvidenceServer.test.ts
~~~

Expected: FAIL because handler has no logo dependency/route.

- [ ] **Step 3: Create the optimized asset**

Use the existing Sharp dependency in a one-time Node command; preserve alpha:

~~~bash
node --input-type=module -e "import sharp from 'sharp'; await sharp('/Users/natthaphon/.codex/generated_images/01a01d81-51eb-7b63-9da0-e600131614c9/exec-092b05a1-9e52-473c-98a3-6c2769b3aa01.png').resize(256,256,{fit:'contain'}).png({compressionLevel:9}).toFile('assets/pmc-flex-logo-v1.png')"
~~~

Verify with sips that pixelWidth/pixelHeight are 256 and hasAlpha is yes.

- [ ] **Step 4: Serve the logo safely**

Change createBookingEvidenceRequestHandler(evidenceProxy, logoPng). For GET/HEAD /assets/pmc-flex-logo-v1.png return:

~~~text
status: 200
content-type: image/png
cache-control: public, max-age=86400, immutable
x-content-type-options: nosniff
~~~

startServer reads assets/pmc-flex-logo-v1.png with readFileSync(resolve('assets/pmc-flex-logo-v1.png')). Evidence and health behavior remain unchanged.

- [ ] **Step 5: Run GREEN and commit**

~~~bash
npm test -- tests/bookingEvidenceServer.test.ts
npm run build:server
git add assets/pmc-flex-logo-v1.png server/bookingEvidenceServer.ts tests/bookingEvidenceServer.test.ts docs/PROJECT_UPDATES.md
git commit -m "feat: serve PMC Flex logo from Cloud Run"
~~~

Expected: server tests/build PASS and no evidence route loses HMAC enforcement.

---

### Task 8: Add Safe Staff/Form Migration Entry Points

**Files:**
- Create: apps/pmc-google-booking-ops/src/workflows/staffAeMigration.ts
- Modify: apps/pmc-google-booking-ops/src/runtime.ts
- Modify: apps/pmc-google-booking-ops/src/entrypoints.ts
- Modify: apps/pmc-google-booking-ops/scripts/build.mjs
- Modify: apps/pmc-google-booking-ops/tests/build.test.ts
- Modify: apps/pmc-google-booking-ops/tests/endToEnd.test.ts
- Modify: apps/pmc-google-booking-ops/docs/setup.md

**Interfaces:**
- Consumes: CONFIG_ADMINS rollback rows, CONFIG_STAFF, FormPort cutover controls.
- Produces: preparePmcStaffAeMigration, pauseAndCutoverPmcBookingForm, resumePmcBookingFormAfterAeCutover.

- [ ] **Step 1: Write failing migration-state tests**

Test the pure legacy seeding function:

~~~ts
expect(seedStaffRowsFromLegacy([
  { id: 'admin-1', name: 'มัส', email: 'shared@example.com', lineUserId: '', active: true },
])).toEqual([
  {
    id: 'admin-1',
    name: 'มัส',
    email: '',
    lineUserId: '',
    canCloseBooking: true,
    canBeAe: true,
    active: true,
  },
])
~~~

The shared email must not be copied into CONFIG_STAFF.

Add build.test.ts expectations that Code.js exposes the three new top-level functions.

- [ ] **Step 2: Run RED**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/build.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts
~~~

Expected: FAIL because migration functions/entrypoints do not exist.

- [ ] **Step 3: Implement one-time migration preparation**

staffAeMigration.ts exports seedStaffRowsFromLegacy. runtime.prepareStaffAeMigrationWorkflow:

1. migrate BOOKING_MASTER AE columns;
2. create CONFIG_STAFF through ensureSheetTopology;
3. if CONFIG_STAFF is empty, seed IDs/names/LINE IDs/active from CONFIG_ADMINS with blank emails and both role flags true;
4. never overwrite a non-empty CONFIG_STAFF; and
5. return counts and missing-personal-email names only, never email values.

- [ ] **Step 4: Implement pause/cutover/resume controls**

pauseAndCutoverBookingFormWorkflow must validate Staff directory, require bookingCollectsEmail(), pause responses, rename the field, and sync eligible AE/doctor/service/channel choices. If validation fails, it must not pause or rename the Form.

resumeBookingFormAfterAeCutoverWorkflow validates properties, Staff directory, verified-email collection, and the new AE field before re-enabling responses.

- [ ] **Step 5: Export stable Apps Script functions**

entrypoints.ts:

~~~ts
export function preparePmcStaffAeMigration() {
  return prepareStaffAeMigrationWorkflow()
}

export function pauseAndCutoverPmcBookingForm() {
  return pauseAndCutoverBookingFormWorkflow()
}

export function resumePmcBookingFormAfterAeCutover() {
  return resumeBookingFormAfterAeCutoverWorkflow()
}
~~~

Add matching top-level footer wrappers to build.mjs.

- [ ] **Step 6: Document operator order and rollback**

setup.md records the exact three functions, the requirement to fill personal emails in Sheet rather than chat/source, Form pause state, existing deployment ID reuse, and version 5 rollback order.

- [ ] **Step 7: Run GREEN and commit**

~~~bash
npx vitest run apps/pmc-google-booking-ops/tests/build.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts
npm run booking:build
git add apps/pmc-google-booking-ops/src/workflows/staffAeMigration.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/scripts/build.mjs apps/pmc-google-booking-ops/tests/build.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts apps/pmc-google-booking-ops/docs/setup.md
git commit -m "feat: add safe Staff and AE cutover controls"
~~~

Expected: entrypoint/build tests and Apps Script build PASS.

---

### Task 9: Complete Local Verification and LINE Contract Validation

**Files:**
- Modify: apps/pmc-google-booking-ops/tests/endToEnd.test.ts
- Modify: apps/pmc-google-booking-ops/docs/pilot-runbook.md
- Modify: docs/PROJECT_UPDATES.md

**Interfaces:**
- Consumes: all Tasks 1-8.
- Produces: full local regression evidence and official LINE validator proof with no secret output.

- [ ] **Step 1: Add final cross-workflow assertions**

Extend endToEnd.test.ts to prove a LINE retry preserves closer/AE names, permanent evidence URLs remain deterministic, Dashboard exposes aeId, and no retry duplicates Drive/Calendar.

- [ ] **Step 2: Run the complete local gate**

~~~bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npm test
npm run build
git diff --check
~~~

Expected: every command exits 0. The existing Vite bundle-size warning may remain a warning.

- [ ] **Step 3: Validate real message objects against LINE**

Build Admin and doctor message objects from a synthetic BookingCase with closer มัส and AE เอม. POST only the messages array to /v2/bot/message/validate/push using the existing local LINE token without printing token, destination IDs, evidence URLs, or customer identity.

Expected:

~~~text
validator_status=200
admin_has_logo=true
admin_has_evidence=true
doctor_has_evidence=false
visible_case_id=false
staff_email_visible=false
~~~

- [ ] **Step 4: Record safe verification evidence**

pilot-runbook.md and PROJECT_UPDATES.md record test counts, validator status, message audience, logo/evidence booleans, and remaining live prerequisites only.

- [ ] **Step 5: Commit**

~~~bash
git add apps/pmc-google-booking-ops/tests/endToEnd.test.ts apps/pmc-google-booking-ops/docs/pilot-runbook.md docs/PROJECT_UPDATES.md
git commit -m "test: verify Staff AE Minimal Flex workflow"
~~~

---

### Task 10: Execute the Keyless Cloud Run and Apps Script Pilot

**Files:**
- Modify: apps/pmc-google-booking-ops/docs/pilot-runbook.md
- Modify: docs/PROJECT_UPDATES.md
- Modify outside Git: Projects/PMC Ads Agent/Current Work.md and daily Obsidian project update

**Interfaces:**
- Consumes: approved company personal-email mappings entered directly in CONFIG_STAFF, existing Cloud Run service, existing Apps Script deployment, existing Form/Sheet/LINE groups.
- Produces: Cloud Run logo route, Apps Script next version, Form AE cutover, two synthetic identity scenarios, safe pilot record.

- [ ] **Step 1: Re-verify live preconditions without exposing identifiers**

Confirm:

~~~text
Cloud Run health=200
missing evidence token=400
altered evidence token=403
Service Identity attached=true
Secret Manager binding=true
JSON credential env count=0
Form email collection=VERIFIED
personal email mapping available for Sheet entry=true
~~~

Do not require CONFIG_STAFF to exist before the preparation function runs. The mapping availability check means the manager has the seven personal emails ready to enter directly in Sheet without pasting them into chat or commands.

- [ ] **Step 2: Deploy the new Cloud Run revision**

Deploy the same keyless service in asia-southeast1 with existing Service Identity, secret binding, min 0, max 2, 512 MiB, CPU 1, and the existing GOOGLE_ENTRYPOINT. Do not alter organization policy.

Verify:

~~~text
GET /health -> 200
GET /assets/pmc-flex-logo-v1.png -> 200 image/png
HEAD /assets/pmc-flex-logo-v1.png -> 200
GET evidence without token -> 400
GET evidence with altered token -> 403
~~~

- [ ] **Step 3: Set BOOKING_BRAND_LOGO_URL without printing it**

Set the stable Cloud Run logo HTTPS URL in Apps Script Properties. Validate property presence by name only.

- [ ] **Step 4: Prepare Staff/AE Sheet migration**

Push Apps Script head content, run preparePmcStaffAeMigration, and verify:

~~~text
CONFIG_STAFF rows=7
ae columns present=true
historical rows unchanged=true
~~~

Pause here so the manager can enter the seven personal emails directly into CONFIG_STAFF. Re-run validation and continue only when:

~~~text
missing personal email count=0
duplicate closer email count=0
active closer count=7
eligible AE count=7
~~~

Do not put personal emails into commands, docs, audit summaries, or chat. If validation fails, report staff display names only.

- [ ] **Step 5: Pause and cut over the Form**

Run pauseAndCutoverPmcBookingForm. Read back:

~~~text
accepting responses=false
verified email collection=true
required AE field count=1
old Admin field count=0
AE choices=7
~~~

Do not change the two File Upload questions through Forms API; keep real-customer status NO-GO until the owner sets both to IMAGE.

- [ ] **Step 6: Deploy the existing Apps Script Web App**

Run booking:build, push only Code.js/appsscript.json, verify remote files contain no temporary setup source, create the next numbered version, and redeploy the existing Web App deployment ID. Never create a second production Web App deployment.

- [ ] **Step 7: Resume the Form**

Run resumePmcBookingFormAfterAeCutover. Read back accepting responses=true only after the deployed code, CONFIG_STAFF, AE label, verified-email collection, and logo property agree.

- [ ] **Step 8: Run two synthetic submissions**

Scenario A:

~~~text
closer personal email -> มัส
selected AE -> เอม
expected samePerson=false
~~~

Scenario B:

~~~text
closer personal email -> มัส
selected AE -> มัส
expected samePerson=true
~~~

For each, verify BOOKING_CONFIRMED, Drive OK, Calendar OK, Admin LINE OK, doctor LINE OK, call task 1, retry 0, and separate adminId/aeId values as expected. Use synthetic customer identity and non-customer images only.

- [ ] **Step 9: Inspect both LINE groups**

Admin group must show Minimal Receipt, generated logo, no Case ID/count/badge, closer and AE names, and proportional tappable evidence thumbnails. Doctor group must show the same minimal hierarchy and both names but no evidence/deposit/channel.

- [ ] **Step 10: Final regression, docs, and commit**

Run the complete local gate again. Update pilot-runbook, PROJECT_UPDATES, Obsidian Current Work, and the 2026-08-21 daily note with safe statuses only.

~~~bash
git add apps/pmc-google-booking-ops/docs/pilot-runbook.md docs/PROJECT_UPDATES.md
git commit -m "docs: record Staff AE Minimal Flex pilot"
~~~

Keep the implementation branch/worktree until the user chooses merge/PR/keep through the finishing-development-branch workflow.

## Final Go/No-Go Gate

Production remains NO-GO if any of these conditions is true:

- an active closer lacks one unique personal Google-account email;
- Form email collection is not VERIFIED;
- the required AE dropdown is missing or contains ineligible staff;
- closer or AE validation can allocate a Case ID before rejection;
- historical booking rows shift or receive guessed AE attribution;
- visible LINE content contains Case ID, evidence counts, staff email, Drive URL, or internal IDs;
- doctor payload contains evidence, deposit, or channel;
- Admin evidence thumbnails expand beyond fixed equal slots or crop a payment slip;
- logo URL is non-HTTPS, unavailable to LINE, or routed through the private evidence-token path;
- Cloud Run loses Service Identity, Secret Manager binding, or evidence HMAC protection;
- retry duplicates Drive, Calendar, Admin LINE, or doctor LINE side effects;
- any focused/full test, typecheck, lint, build, diff check, or LINE validator call fails;
- the Form remains paused after cutover; or
- either evidence upload question still reports ANY when real-customer use is requested.
