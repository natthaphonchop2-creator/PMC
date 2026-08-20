# PMC Google Booking Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a company-owned Google Form and Google Sheet operating system that creates doctor-specific Drive, Calendar, and LINE outputs, manages six-month deposit follow-up, and closes cases only from reconciled JERA `ชำระแล้ว` exports.

**Architecture:** Add a standalone TypeScript Apps Script package at `apps/pmc-google-booking-ops/`. Keep domain rules and workflows pure and dependency-injected for Vitest, put Google/LINE calls behind narrow adapters, and bundle the package into Apps Script V8 global entrypoints with esbuild. Google Sheets remains the canonical operational state; Form responses and JERA imports remain immutable evidence inputs. Use the existing PMC Web Node server only as a raw-body LINE webhook signature bridge because Apps Script Web Apps cannot read `x-line-signature`; the bridge forwards source IDs only through a second HMAC-protected ingress.

**Tech Stack:** TypeScript 6, Vitest 4, esbuild, Node HTTP middleware, Google Apps Script V8, Google Forms, Google Sheets, Google Drive, Google Calendar, LINE Messaging API, CP874 tab-separated JERA exports.

**Spec:** `docs/superpowers/specs/2026-08-20-pmc-google-booking-operations-design.md`

## Global Constraints

- Google Sheets `BOOKING_MASTER` is the operational source of truth.
- `FORM_RESPONSES`, `JERA_IMPORT_RAW`, and `AUDIT_LOG` are append-only evidence surfaces.
- The initial Booking Form has ten required inputs plus one optional `เพจคลินิก/ช่องทาง` Dropdown and is designed for mobile completion.
- The Admin submits the Booking Form only after confirming the booking payment.
- All Admins use one shared company Google account; the required selected Admin name is the authority for performance credit.
- Each doctor has one Calendar and one LINE group; doctors are read-only recipients.
- A Calendar conflict must produce `TIME_CONFLICT` and must not notify the doctor.
- The deposit expires six calendar months after receipt, not after a fixed 180 days.
- First-call reminders begin on the appointment date, repeat daily, and become overdue after Day 7.
- Call reminders go to both the Admin group and the direct Admin owner.
- Only a unique reconciliation to JERA status `ชำระแล้ว` may produce `CLOSED_JERA`.
- No Thai national ID number may be stored in Google Form, Sheets, Drive metadata, Calendar, LINE, logs, or test fixtures.
- No payment slip, chat screenshot, full phone number, or unrestricted Drive link may be sent to doctor LINE groups.
- LINE directory capture stores only source type, LINE user/group ID, and capture time; it never stores incoming message text.
- Commission eligibility may be `PENDING_RULE`; commission amount must stay blank until a separate owner-approved rule exists.
- Evidence deletion requires manager approval and becomes eligible 90 days after close, refund, or expiry.
- All runtime timestamps use `Asia/Bangkok`; persisted timestamps use ISO 8601 with offset.
- Secrets live in Script Properties; never place tokens, secrets, real Google IDs, or customer PII in source control.
- Every task follows RED → GREEN → focused refactor → verification → commit.

---

## File Structure

### Create

```text
apps/pmc-google-booking-ops/appsscript.json
apps/pmc-google-booking-ops/tsconfig.json
apps/pmc-google-booking-ops/scripts/build.mjs
apps/pmc-google-booking-ops/src/config.ts
apps/pmc-google-booking-ops/src/domain/types.ts
apps/pmc-google-booking-ops/src/domain/normalize.ts
apps/pmc-google-booking-ops/src/domain/stateMachine.ts
apps/pmc-google-booking-ops/src/domain/caseId.ts
apps/pmc-google-booking-ops/src/domain/callSchedule.ts
apps/pmc-google-booking-ops/src/domain/jera.ts
apps/pmc-google-booking-ops/src/ports.ts
apps/pmc-google-booking-ops/src/sheetSchema.ts
apps/pmc-google-booking-ops/src/repositories.ts
apps/pmc-google-booking-ops/src/adapters/googleSheets.ts
apps/pmc-google-booking-ops/src/adapters/googleDrive.ts
apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts
apps/pmc-google-booking-ops/src/adapters/googleForms.ts
apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts
apps/pmc-google-booking-ops/src/workflows/formSubmit.ts
apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts
apps/pmc-google-booking-ops/src/workflows/callQueue.ts
apps/pmc-google-booking-ops/src/workflows/jeraImport.ts
apps/pmc-google-booking-ops/src/workflows/dashboard.ts
apps/pmc-google-booking-ops/src/workflows/integrity.ts
apps/pmc-google-booking-ops/src/workflows/retention.ts
apps/pmc-google-booking-ops/src/runtime.ts
apps/pmc-google-booking-ops/src/entrypoints.ts
apps/pmc-google-booking-ops/tests/helpers/fakes.ts
apps/pmc-google-booking-ops/tests/build.test.ts
apps/pmc-google-booking-ops/tests/domain.test.ts
apps/pmc-google-booking-ops/tests/repositories.test.ts
apps/pmc-google-booking-ops/tests/formSubmit.test.ts
apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
apps/pmc-google-booking-ops/tests/callQueue.test.ts
apps/pmc-google-booking-ops/tests/jeraImport.test.ts
apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts
apps/pmc-google-booking-ops/tests/endToEnd.test.ts
apps/pmc-google-booking-ops/docs/setup.md
apps/pmc-google-booking-ops/docs/pilot-runbook.md
apps/pmc-google-booking-ops/.clasp.json.example
server/bookingLineWebhook.ts
tests/bookingLineWebhook.test.ts
```

### Modify

```text
package.json
package-lock.json
eslint.config.js
.gitignore
.env.example
docs/PROJECT_UPDATES.md
server/productionServer.ts
```

### Generated and ignored

```text
apps/pmc-google-booking-ops/dist/Code.js
apps/pmc-google-booking-ops/.clasp.json
```

## Interface Map

Task implementers must keep these names and shapes consistent.

```ts
export type BookingStatus =
  | 'FORM_SUBMITTED'
  | 'VALIDATION_ERROR'
  | 'TIME_CONFLICT'
  | 'BOOKING_CONFIRMED'
  | 'CALL_ACTIVE'
  | 'CALL_OVERDUE'
  | 'REBOOKED'
  | 'CLOSED_JERA'
  | 'REFUNDED'
  | 'EXPIRED_6M'
  | 'RECONCILIATION'

export interface BookingIntake {
  formResponseId: string
  submittedAt: string
  submitterEmail: string
  adminName: string
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

export interface BookingCase {
  caseId: string
  version: number
  status: BookingStatus
  formResponseId: string
  adminId: string | null
  adminName: string
  submitterEmail: string
  adminIdentityStatus: 'MATCHED' | 'MISMATCH'
  customerName: string
  customerNameNormalized: string
  phoneNormalized: string
  phoneMasked: string
  doctorId: string
  serviceId: string
  channelId: string | null
  appointmentStart: string
  appointmentEnd: string
  depositAmount: number
  depositReceivedAt: string
  depositExpiresAt: string
  depositStatus: 'VALID' | 'REFUNDED' | 'EXPIRED'
  driveFolderId: string | null
  driveFolderUrl: string | null
  paymentEvidenceCount: number
  chatEvidenceCount: number
  calendarId: string | null
  calendarEventId: string | null
  doctorLineGroupId: string | null
  doctorLineNotifiedAt: string | null
  callStatus: 'PENDING' | 'ACTIVE' | 'DONE' | 'OVERDUE' | 'CANCELLED'
  firstCallWindowStart: string
  firstCallWindowEnd: string
  nextCallAt: string | null
  jeraPaymentId: string | null
  jeraStatus: string | null
  jeraClosedAt: string | null
  jeraActualRevenue: number | null
  jeraImportFileId: string | null
  reconciliationStatus: 'NONE' | 'OPEN' | 'RESOLVED'
  commissionEligibility: 'NOT_ELIGIBLE' | 'PENDING_RULE' | 'ELIGIBLE'
  commissionAmount: number | null
  driveState: 'PENDING' | 'OK' | 'RETRY' | 'FAILED'
  calendarState: 'PENDING' | 'OK' | 'RETRY' | 'FAILED' | 'CONFLICT'
  lineState: 'PENDING' | 'OK' | 'RETRY' | 'FAILED'
  jeraImportState: 'NOT_IMPORTED' | 'MATCHED' | 'RECONCILIATION'
  createdAt: string
  updatedAt: string
}

export interface BookingRepositories {
  bookings: BookingRepository
  calls: CallTaskRepository
  imports: ImportRepository
  reconciliation: ReconciliationRepository
  retries: RetryRepository
  lineDirectory: LineDirectoryRepository
  retention: RetentionRepository
  audit: AuditRepository
}

export interface BookingPorts {
  clock: Clock
  locks: LockPort
  config: ConfigPort
  repositories: BookingRepositories
  drive: DrivePort
  calendar: CalendarPort
  line: LinePort
  forms: FormsPort
  files: FilePort
}

export interface TestPorts extends BookingPorts {
  bookings: BookingRepository
  calls: CallTaskRepository
  imports: ImportRepository
  reconciliation: ReconciliationRepository
  retries: RetryRepository
  lineDirectory: LineDirectoryRepository
  retention: RetentionRepository
  clock: FakeClock
  drive: FakeDrivePort
  calendar: FakeCalendarPort
  line: FakeLinePort
  seedIntegrityFailures(): void
}
```

`createTestPorts()` returns `TestPorts`. Its convenience properties reference the exact same repository/port instances stored under `repositories` and the base port fields; they are not separate stores.

---

### Task 1: Add the Apps Script Build and Test Harness

**Files:**
- Modify: `package.json:6-37`
- Modify: `package-lock.json`
- Modify: `eslint.config.js:8-27`
- Modify: `.gitignore`
- Create: `apps/pmc-google-booking-ops/tsconfig.json`
- Create: `apps/pmc-google-booking-ops/appsscript.json`
- Create: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Create: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Create: `apps/pmc-google-booking-ops/tests/build.test.ts`

**Interfaces:**
- Consumes: root TypeScript, ESLint, and Vitest toolchain.
- Produces: `npm run booking:test`, `npm run booking:typecheck`, `npm run booking:build`, `npm run booking:push`, and generated Apps Script global functions `onBookingFormSubmit`, `onCallResultSubmit`, `doPost`, `runDailyOperations`, `pollJeraIncoming`, `runIntegrityChecks`, and `setupPmcBookingSystem`.

- [ ] **Step 1: Write the failing build-contract test**

Create `apps/pmc-google-booking-ops/tests/build.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Apps Script bundle', () => {
  it('exports every installable-trigger entrypoint as a top-level function', () => {
    execFileSync('npm', ['run', 'booking:build'], { stdio: 'pipe' })
    const bundle = readFileSync('apps/pmc-google-booking-ops/dist/Code.js', 'utf8')
    for (const name of [
      'onBookingFormSubmit',
      'onCallResultSubmit',
      'doPost',
      'runDailyOperations',
      'pollJeraIncoming',
      'runIntegrityChecks',
      'setupPmcBookingSystem',
    ]) {
      expect(bundle).toContain(`function ${name}(`)
    }
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/build.test.ts
```

Expected: FAIL because `booking:build` and the package files do not exist.

- [ ] **Step 3: Install only the required build dependencies**

Run:

```bash
npm install -D esbuild @google/clasp @types/google-apps-script
```

Expected: `package.json` and `package-lock.json` add the three development dependencies without changing existing runtime dependencies.

- [ ] **Step 4: Add root scripts and ignores**

Add to `package.json` scripts:

```json
"booking:test": "vitest run apps/pmc-google-booking-ops/tests",
"booking:typecheck": "tsc -p apps/pmc-google-booking-ops/tsconfig.json --noEmit",
"booking:build": "node apps/pmc-google-booking-ops/scripts/build.mjs",
"booking:push": "cd apps/pmc-google-booking-ops && clasp push"
```

Add to `.gitignore`:

```gitignore
apps/pmc-google-booking-ops/dist/
apps/pmc-google-booking-ops/.clasp.json
```

Add an ESLint override for the Apps Script package using ES2022 globals. Do not add customer-specific global names.

- [ ] **Step 5: Add the TypeScript and Apps Script manifests**

Create `apps/pmc-google-booking-ops/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": ["google-apps-script", "node", "vitest/globals"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs"]
}
```

Create `apps/pmc-google-booking-ops/appsscript.json`:

```json
{
  "timeZone": "Asia/Bangkok",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Calendar",
        "serviceId": "calendar",
        "version": "v3"
      }
    ]
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/forms",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

- [ ] **Step 6: Add the bundle and wrapper entrypoints**

Create `scripts/build.mjs` with esbuild `bundle: true`, `format: 'iife'`, `globalName: 'PmcBooking'`, `platform: 'browser'`, and a footer that declares the seven top-level wrapper functions. The build script also copies `appsscript.json` to `dist/appsscript.json`. Create `src/entrypoints.ts` with named exports that initially throw `Not configured` so the wrapper contract can compile.

The footer must be exactly equivalent to:

```js
function onBookingFormSubmit(e) { return PmcBooking.onBookingFormSubmit(e); }
function onCallResultSubmit(e) { return PmcBooking.onCallResultSubmit(e); }
function doPost(e) { return PmcBooking.doPost(e); }
function runDailyOperations() { return PmcBooking.runDailyOperations(); }
function pollJeraIncoming() { return PmcBooking.pollJeraIncoming(); }
function runIntegrityChecks() { return PmcBooking.runIntegrityChecks(); }
function setupPmcBookingSystem() { return PmcBooking.setupPmcBookingSystem(); }
```

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
npm run booking:build
npm run booking:typecheck
npm run test -- apps/pmc-google-booking-ops/tests/build.test.ts
npm run lint
```

Expected: bundle, typecheck, targeted test, and lint all PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json eslint.config.js .gitignore apps/pmc-google-booking-ops
git commit -m "build: scaffold PMC booking Apps Script"
```

---

### Task 2: Implement Domain Types, Normalization, State Rules, and Case IDs

**Files:**
- Create: `apps/pmc-google-booking-ops/src/domain/types.ts`
- Create: `apps/pmc-google-booking-ops/src/domain/normalize.ts`
- Create: `apps/pmc-google-booking-ops/src/domain/stateMachine.ts`
- Create: `apps/pmc-google-booking-ops/src/domain/caseId.ts`
- Create: `apps/pmc-google-booking-ops/src/domain/callSchedule.ts`
- Create: `apps/pmc-google-booking-ops/src/ports.ts`
- Create: `apps/pmc-google-booking-ops/tests/domain.test.ts`

**Interfaces:**
- Consumes: none beyond standard TypeScript.
- Produces: `BookingIntake`, `BookingCase`, port interfaces, `normalizeThaiPhone`, `normalizeCustomerName`, `maskThaiPhone`, `addCalendarMonths`, `transitionBooking`, `formatCaseId`, and `deriveCallWindow`.

- [ ] **Step 1: Write failing domain tests**

Create `tests/domain.test.ts` with these exact behaviors:

```ts
import { describe, expect, it } from 'vitest'
import { formatCaseId } from '../src/domain/caseId'
import { addCalendarMonths, deriveCallWindow } from '../src/domain/callSchedule'
import { maskThaiPhone, normalizeCustomerName, normalizeThaiPhone } from '../src/domain/normalize'
import { transitionBooking } from '../src/domain/stateMachine'

describe('booking domain', () => {
  it('normalizes Thai phone and masks it', () => {
    expect(normalizeThaiPhone('+66 81-234-5678')).toBe('0812345678')
    expect(maskThaiPhone('0812345678')).toBe('081-xxx-5678')
  })

  it('normalizes customer names without losing Thai characters', () => {
    expect(normalizeCustomerName(' สม หญิง  ใจดี ')).toBe('สมหญิงใจดี')
  })

  it('formats an atomic monthly case sequence', () => {
    expect(formatCaseId('2026-08-20T09:00:00+07:00', 12)).toBe('PMC-202608-0012')
  })

  it('adds six calendar months instead of 180 days', () => {
    expect(addCalendarMonths('2026-08-31T10:00:00+07:00', 6)).toBe('2027-02-28T10:00:00+07:00')
  })

  it('opens the first-call window on appointment day and ends after day 7', () => {
    expect(deriveCallWindow('2026-08-20T13:00:00+07:00')).toEqual({
      start: '2026-08-20T00:00:00+07:00',
      end: '2026-08-27T23:59:59+07:00',
    })
  })

  it('rejects Google-only closure without JERA evidence', () => {
    expect(() => transitionBooking('BOOKING_CONFIRMED', 'CLOSED_JERA', { jeraStatus: null })).toThrow(
      'CLOSED_JERA requires JERA status ชำระแล้ว',
    )
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/domain.test.ts
```

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Define the exact shared types and ports**

Implement the Interface Map at the top of this plan in `domain/types.ts` and `ports.ts`. Add narrow ports for clock, lock, configuration, Sheet repositories, Drive, Calendar, LINE, Forms, and file decoding. No domain file may reference `SpreadsheetApp`, `DriveApp`, `CalendarApp`, `FormApp`, `UrlFetchApp`, or `PropertiesService`.

- [ ] **Step 4: Implement minimal pure domain functions**

Implement:

```ts
normalizeThaiPhone(value: string): string
normalizeCustomerName(value: string): string
maskThaiPhone(value: string): string
formatCaseId(nowIso: string, sequence: number): string
addCalendarMonths(valueIso: string, months: number): string
deriveCallWindow(appointmentStartIso: string): { start: string; end: string }
transitionBooking(from: BookingStatus, to: BookingStatus, evidence: TransitionEvidence): BookingStatus
```

Use `Asia/Bangkok` offsets explicitly in tests. Do not read the machine timezone.

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/domain.test.ts
npm run booking:typecheck
```

Expected: targeted tests and typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pmc-google-booking-ops/src/domain apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/tests/domain.test.ts
git commit -m "feat: add PMC booking domain rules"
```

---

### Task 3: Create Sheet Topology, Repositories, Audit, and Idempotency

**Files:**
- Create: `apps/pmc-google-booking-ops/src/sheetSchema.ts`
- Create: `apps/pmc-google-booking-ops/src/repositories.ts`
- Create: `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts`
- Create: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`
- Create: `apps/pmc-google-booking-ops/tests/repositories.test.ts`

**Interfaces:**
- Consumes: `BookingCase`, `BookingRepositories`, `BookingStatus`, and `Clock` from Task 2.
- Produces: `SHEET_SCHEMAS`, `createGoogleSheetRepositories`, `appendAuditEvent`, `allocateMonthlySequence`, `findBookingByFormResponseId`, and optimistic `updateBooking(caseId, expectedVersion, patch)`.

- [ ] **Step 1: Write failing repository tests**

Create `tests/repositories.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createMemoryRepositories } from './helpers/fakes'

describe('booking repositories', () => {
  it('allocates case sequences atomically per month', () => {
    const repos = createMemoryRepositories()
    expect(repos.bookings.allocateMonthlySequence('2026-08')).toBe(1)
    expect(repos.bookings.allocateMonthlySequence('2026-08')).toBe(2)
    expect(repos.bookings.allocateMonthlySequence('2026-09')).toBe(1)
  })

  it('prevents duplicate form response processing', () => {
    const repos = createMemoryRepositories()
    repos.bookings.rememberFormResponse('response-1', 'PMC-202608-0001')
    expect(() => repos.bookings.rememberFormResponse('response-1', 'PMC-202608-0002')).toThrow(
      'form response already processed',
    )
  })

  it('rejects stale version updates and appends before-after audit', () => {
    const repos = createMemoryRepositories()
    const booking = repos.bookings.insertFixture({ caseId: 'PMC-202608-0001', version: 1 })
    repos.bookings.updateBooking(booking.caseId, 1, { status: 'TIME_CONFLICT' }, 'admin@example.com', 'calendar overlap')
    expect(() => repos.bookings.updateBooking(booking.caseId, 1, { status: 'BOOKING_CONFIRMED' }, 'admin@example.com', 'stale')).toThrow(
      'version conflict',
    )
    expect(repos.audit.listForCase(booking.caseId)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/repositories.test.ts
```

Expected: FAIL because repositories and fakes do not exist.

- [ ] **Step 3: Define exact Sheet schemas**

Implement all tabs from spec section 6.1 plus `CONFIG_LINE_DIRECTORY`, which stores only LINE source type, captured user/group ID, capture time, and a manager-assigned alias. `BOOKING_MASTER` must include every field from spec section 6.2. Export immutable arrays of column keys and validate existing Sheet headers before any write.

The setup function must create missing tabs, freeze header rows, apply protected ranges, and never delete or reorder an existing non-empty column silently.

- [ ] **Step 4: Implement repository contracts and in-memory fakes**

Implement deterministic repositories for tests and Google Sheet adapters for runtime. Repository writes must:

1. use exact column-key mapping rather than numeric magic indexes;
2. append raw/evidence rows;
3. use optimistic version checks for canonical updates;
4. append `AUDIT_LOG` before/after values for controlled mutations; and
5. reserve `ScriptLock` for sequence and idempotency writes.

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/repositories.test.ts
npm run booking:typecheck
npm run lint
```

Expected: targeted tests, typecheck, and lint PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pmc-google-booking-ops/src/sheetSchema.ts apps/pmc-google-booking-ops/src/repositories.ts apps/pmc-google-booking-ops/src/adapters/googleSheets.ts apps/pmc-google-booking-ops/tests/helpers apps/pmc-google-booking-ops/tests/repositories.test.ts
git commit -m "feat: add booking Sheet repositories"
```

---

### Task 4: Validate Quick Form Intake and Persist the Canonical Case

**Files:**
- Create: `apps/pmc-google-booking-ops/src/config.ts`
- Create: `apps/pmc-google-booking-ops/src/adapters/googleForms.ts`
- Create: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Create: `apps/pmc-google-booking-ops/tests/formSubmit.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`

**Interfaces:**
- Consumes: repository ports from Task 3 and domain functions from Task 2.
- Produces: `parseBookingFormEvent(event): BookingIntake`, `validateBookingIntake(intake, config): IntakeValidation`, and `submitBookingIntake(intake, ports): BookingCase` through the pre-external-write phase.

- [ ] **Step 1: Write failing Form workflow tests**

Create `tests/formSubmit.test.ts` with these cases:

```ts
import { describe, expect, it } from 'vitest'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { createTestPorts, validBookingIntake } from './helpers/fakes'

describe('booking Form workflow', () => {
  it('creates one canonical case with automatic values', async () => {
    const ports = createTestPorts()
    const result = await submitBookingIntake(validBookingIntake(), ports)
    expect(result.caseId).toBe('PMC-202608-0001')
    expect(result.depositExpiresAt).toBe('2027-02-20T09:00:00+07:00')
    expect(result.commissionEligibility).toBe('NOT_ELIGIBLE')
    expect(result.commissionAmount).toBeNull()
  })

  it('does not process the same Form response twice', async () => {
    const ports = createTestPorts()
    await submitBookingIntake(validBookingIntake(), ports)
    await expect(submitBookingIntake(validBookingIntake(), ports)).rejects.toThrow('form response already processed')
  })

  it('attributes a shared-account submission to the selected Admin', async () => {
    const ports = createTestPorts()
    const result = await submitBookingIntake(validBookingIntake({ submitterEmail: 'shared@example.com' }), ports)
    expect(result.status).toBe('BOOKING_CONFIRMED')
    expect(result.adminId).toBe('admin-1')
    expect(result.adminIdentityStatus).toBe('SHARED_ACCOUNT')
  })

  it('rejects missing slip or chat evidence', async () => {
    const ports = createTestPorts()
    await expect(submitBookingIntake(validBookingIntake({ chatEvidenceFileIds: [] }), ports)).rejects.toThrow(
      'chat evidence is required',
    )
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/formSubmit.test.ts
```

Expected: FAIL because the workflow and Form adapter do not exist.

- [ ] **Step 3: Implement configuration reading and validation**

Create `config.ts` with typed readers for active Admins, doctors, services, optional channels, and rules. The adapter must map the ten required Thai Form labels plus optional `เพจคลินิก/ช่องทาง` to `BookingIntake` and must fail closed when required labels are missing or duplicated.

Add these script-property names as constants, never values:

```ts
export const SCRIPT_PROPERTY_KEYS = {
  spreadsheetId: 'PMC_SPREADSHEET_ID',
  bookingFormId: 'PMC_BOOKING_FORM_ID',
  callResultFormId: 'PMC_CALL_RESULT_FORM_ID',
  driveRootId: 'PMC_DRIVE_ROOT_ID',
  jeraIncomingFolderId: 'PMC_JERA_INCOMING_FOLDER_ID',
  backupFolderId: 'PMC_BACKUP_FOLDER_ID',
  adminLineGroupId: 'PMC_ADMIN_LINE_GROUP_ID',
  lineAccessToken: 'LINE_CHANNEL_ACCESS_TOKEN',
  lineDirectoryCaptureEnabled: 'LINE_DIRECTORY_CAPTURE_ENABLED',
  bookingIngressSecret: 'PMC_BOOKING_INGRESS_SECRET',
} as const
```

- [ ] **Step 4: Implement minimal canonical persistence**

`submitBookingIntake` must lock, enforce idempotency, validate selected Admin, optional channel, phone, doctor, service duration, appointment timestamp, deposit, and evidence IDs, allocate the sequence, derive automatic dates, insert `FORM_SUBMITTED`, and append the initial audit event. Shared submitter email is stored for technical audit only.

Do not call Drive, Calendar, or LINE in this task. Return a canonical case ready for external orchestration.

- [ ] **Step 5: Wire the Form entrypoint without Google calls in tests**

Keep the production trigger function as the explicit `Not configured` export created in Task 1. Tests call `parseBookingFormEvent` and `submitBookingIntake` directly. Task 11 replaces the stub with `createRuntime()` wiring after every adapter exists, so this task's typecheck and bundle do not depend on a future file.

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/formSubmit.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: targeted tests, typecheck, and bundle PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/config.ts apps/pmc-google-booking-ops/src/adapters/googleForms.ts apps/pmc-google-booking-ops/src/workflows/formSubmit.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: validate and persist booking intake"
```

---

### Task 5: Create Drive Evidence Folders Safely

**Files:**
- Create: `apps/pmc-google-booking-ops/src/adapters/googleDrive.ts`
- Create: `apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts`
- Create: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: `BookingCase`, `DrivePort`, and canonical repositories.
- Produces: `ensureCaseEvidenceFolder(booking, intake, drive): Promise<DriveEvidenceResult>` and controlled booking updates for `driveFolderId`, `paymentEvidenceCount`, and `chatEvidenceCount`.

- [ ] **Step 1: Add failing Drive tests**

Add to `tests/driveCalendarLine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ensureCaseEvidenceFolder } from '../src/adapters/googleDrive'
import { bookingFixture, createFakeDrive, validBookingIntake } from './helpers/fakes'

describe('Drive evidence', () => {
  it('creates year/month/customer-case folder and deterministic filenames', async () => {
    const drive = createFakeDrive()
    const result = await ensureCaseEvidenceFolder(bookingFixture(), validBookingIntake(), drive)
    expect(result.path).toBe('PMC Bookings/2026/08/สมหญิง ใจดี - PMC-202608-0001')
    expect(result.renamedFiles).toEqual([
      'PMC-202608-0001_PAYMENT_01.jpg',
      'PMC-202608-0001_CHAT_01.jpg',
      'PMC-202608-0001_CHAT_02.jpg',
    ])
  })

  it('reuses the existing folder and files on retry', async () => {
    const drive = createFakeDrive()
    const first = await ensureCaseEvidenceFolder(bookingFixture(), validBookingIntake(), drive)
    const second = await ensureCaseEvidenceFolder(bookingFixture({ driveFolderId: first.folderId }), validBookingIntake(), drive)
    expect(second.folderId).toBe(first.folderId)
    expect(drive.createdFolderCount()).toBe(3)
  })

  it('never creates public sharing', async () => {
    const drive = createFakeDrive()
    await ensureCaseEvidenceFolder(bookingFixture(), validBookingIntake(), drive)
    expect(drive.publicLinks()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
```

Expected: FAIL because the Drive adapter and fake do not exist.

- [ ] **Step 3: Expand the Drive port and fake**

Define methods for folder lookup/create, file lookup/move/rename, permission inspection, and trash-after-approval. Every create method accepts an idempotency key derived from Case ID and evidence type.

- [ ] **Step 4: Implement Drive evidence orchestration**

Use the approved folder path and filenames. Sanitize only filesystem-invalid or control characters; preserve Thai names. If a same-name folder exists, require the matching Case ID marker before reuse.

On failure, update `drive_state = 'RETRY'`, enqueue one retry item, and keep the canonical case. Do not proceed to Calendar/doctor LINE until Drive succeeds.

- [ ] **Step 5: Integrate Drive after canonical persistence**

Extend `submitBookingIntake` to call `ensureCaseEvidenceFolder`, update the canonical row with folder/file IDs, and append one audit event. A duplicate Form trigger must return the existing Case ID without moving files again.

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
npm run test -- apps/pmc-google-booking-ops/tests/formSubmit.test.ts
npm run booking:typecheck
```

Expected: Drive and intake tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/adapters/googleDrive.ts apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts apps/pmc-google-booking-ops/src/workflows/formSubmit.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/tests
git commit -m "feat: store booking evidence in Drive"
```

---

### Task 6: Enforce Doctor Calendar Conflicts and Event Idempotency

**Files:**
- Create: `apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/repositories.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: `CalendarPort`, doctor configuration, service duration, and Drive-complete Booking Case.
- Produces: `ensureDoctorCalendarEvent(booking, calendar): Promise<CalendarResult>` and `rescheduleBooking(caseId, update, ports): Promise<BookingCase>`.

- [ ] **Step 1: Add failing Calendar tests**

Add:

```ts
describe('doctor Calendar', () => {
  it('sets TIME_CONFLICT and creates no event when interval overlaps', async () => {
    const ports = createTestPorts({ calendarConflicts: true })
    const result = await submitBookingIntake(validBookingIntake(), ports)
    expect(result.status).toBe('TIME_CONFLICT')
    expect(ports.calendar.createdEvents()).toHaveLength(0)
    expect(ports.line.doctorMessages()).toHaveLength(0)
  })

  it('creates one event with Case ID and safe fields', async () => {
    const ports = createTestPorts()
    const result = await submitBookingIntake(validBookingIntake(), ports)
    expect(result.calendarEventId).toBe('event-PMC-202608-0001')
    expect(ports.calendar.createdEvents()[0]).toMatchObject({
      calendarId: 'doctor-calendar-1',
      externalId: 'PMC-202608-0001',
    })
    expect(JSON.stringify(ports.calendar.createdEvents()[0])).not.toContain('0812345678')
  })

  it('patches the same event on reschedule', async () => {
    const ports = createTestPorts()
    const booking = await submitBookingIntake(validBookingIntake(), ports)
    await rescheduleBooking(booking.caseId, { appointmentStart: '2026-08-21T14:00:00+07:00', reason: 'customer requested' }, ports)
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.calendar.updatedEvents()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
```

Expected: FAIL because Calendar behavior is absent.

- [ ] **Step 3: Implement the Calendar port and adapter**

Use the selected doctor's `calendarId`, derive appointment end from `CONFIG_SERVICES.durationMinutes`, and query overlap before event creation. The event body contains Case ID, masked customer identity, service, duration, and an authorized Sheet link; it excludes evidence and payment details.

Use Case ID as the external idempotency key. Persist the returned `calendar_event_id` before doctor notification.

- [ ] **Step 4: Implement controlled reschedule**

`rescheduleBooking` updates `BOOKING_MASTER` with optimistic versioning, rechecks conflict, patches the existing event, reopens/adjusts the call task, and appends an audit reason. A failed patch creates a retry without discarding the approved new appointment.

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
npm run test -- apps/pmc-google-booking-ops/tests/formSubmit.test.ts
npm run booking:typecheck
```

Expected: Calendar, conflict, and intake tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts apps/pmc-google-booking-ops/src/workflows/formSubmit.ts apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/tests
git commit -m "feat: sync doctor booking Calendars"
```

---

### Task 7: Route Privacy-Safe LINE Notifications

**Files:**
- Create: `apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts`
- Create: `server/bookingLineWebhook.ts`
- Create: `tests/bookingLineWebhook.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/repositories.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `server/productionServer.ts:20-69`
- Modify: `.env.example`
- Modify: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: doctor `lineGroupId`, Admin group ID, direct Admin LINE user ID, and calendar-confirmed Booking Case.
- Produces: `sendDoctorBookingMessage`, `sendAdminTaskMessage`, `sendDailyDoctorSchedules`, Node `verifyLineSignature`, `createBookingLineWebhookHandler`, Apps Script `handleLineDirectoryIngress`, the `doPost` entrypoint, and retry-safe `LinePort.push`.

- [ ] **Step 1: Add failing LINE safety and routing tests**

Extend the Apps Script test imports with `handleLineDirectoryIngress`, `signedBookingIngressFixture`, and the existing Form workflow helpers, then add:

```ts
describe('LINE routing', () => {
  it('sends a confirmed booking only to the selected doctor group', async () => {
    const ports = createTestPorts()
    await submitBookingIntake(validBookingIntake(), ports)
    expect(ports.line.doctorMessages()).toHaveLength(1)
    expect(ports.line.doctorMessages()[0].to).toBe('doctor-group-1')
  })

  it('excludes evidence, full phone, and national-id-like values', async () => {
    const ports = createTestPorts()
    await submitBookingIntake(validBookingIntake(), ports)
    const payload = JSON.stringify(ports.line.doctorMessages()[0])
    expect(payload).not.toContain('0812345678')
    expect(payload).not.toContain('drive.google.com')
    expect(payload).not.toMatch(/\b\d{13}\b/)
  })

  it('does not send doctor LINE before Calendar success', async () => {
    const ports = createTestPorts({ calendarCreateFails: true })
    await submitBookingIntake(validBookingIntake(), ports)
    expect(ports.line.doctorMessages()).toEqual([])
  })

  it('rejects a sanitized directory ingress before any write when HMAC is invalid', async () => {
    const ports = createTestPorts({ lineDirectoryCaptureEnabled: true })
    await expect(handleLineDirectoryIngress({ timestamp: 1787191200, nonce: 'nonce-1', sourceType: 'group', sourceId: 'doctor-group-1', signature: 'invalid' }, ports)).rejects.toThrow(
      'invalid booking ingress signature',
    )
    expect(ports.lineDirectory.list()).toEqual([])
  })

  it('captures only verified LINE source IDs', async () => {
    const ports = createTestPorts({ lineDirectoryCaptureEnabled: true })
    const event = signedBookingIngressFixture({ sourceType: 'group', sourceId: 'doctor-group-1' })
    await handleLineDirectoryIngress(event, ports)
    expect(ports.lineDirectory.list()[0]).toMatchObject({ sourceType: 'group', sourceId: 'doctor-group-1' })
  })
})
```

Create `tests/bookingLineWebhook.test.ts` with raw-body Node tests:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createBookingLineWebhookHandler, signLineBody } from '../server/bookingLineWebhook'

describe('booking LINE webhook bridge', () => {
  it('rejects an invalid x-line-signature and never forwards', async () => {
    const forward = vi.fn()
    const handler = createBookingLineWebhookHandler({ lineChannelSecret: 'line-secret', ingressSecret: 'ingress-secret', forward })
    const response = await handler({ rawBody: '{"events":[]}', signature: 'invalid' })
    expect(response.status).toBe(401)
    expect(forward).not.toHaveBeenCalled()
  })

  it('forwards source IDs only after LINE signature verification', async () => {
    const rawBody = JSON.stringify({ events: [{ type: 'message', source: { type: 'group', groupId: 'doctor-group-1', userId: 'admin-user-1' }, message: { type: 'text', text: 'must not forward' } }] })
    const forward = vi.fn().mockResolvedValue(undefined)
    const handler = createBookingLineWebhookHandler({ lineChannelSecret: 'line-secret', ingressSecret: 'ingress-secret', forward, now: () => 1787191200, nonce: () => 'nonce-1' })
    const response = await handler({ rawBody, signature: signLineBody(rawBody, 'line-secret') })
    expect(response.status).toBe(200)
    expect(JSON.stringify(forward.mock.calls)).not.toContain('must not forward')
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'group', sourceId: 'doctor-group-1' }))
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
npm run test -- tests/bookingLineWebhook.test.ts
```

Expected: FAIL because LINE routing is absent.

- [ ] **Step 3: Implement LINE adapter and message builders**

Use `UrlFetchApp.fetch` only inside the Apps Script adapter. Read the outbound access token from Script Properties. Every push uses a retry key derived from `caseId:eventType:version`. Message builders accept masked fields only.

Doctor message events are `BOOKING_CONFIRMED`, `RESCHEDULED`, `CANCELLED`, and `DAILY_SCHEDULE`. Admin task messages are separate builders and may include masked phone plus a prefilled internal action link.

Apps Script Web Apps do not expose `x-line-signature`, so LINE must never call Apps Script directly. `server/bookingLineWebhook.ts` receives `/api/booking-line/webhook` before Basic Auth, reads the exact raw body, verifies LINE HMAC-SHA256 with `BOOKING_LINE_CHANNEL_SECRET`, discards message content, and forwards only source type/ID plus timestamp and nonce to the Apps Script ingress URL. The forwarded JSON is signed with `BOOKING_INGRESS_SECRET`. Add the three variable names with empty values and safe comments to `.env.example`.

`handleLineDirectoryIngress` verifies the internal body HMAC, rejects timestamps older than five minutes, deduplicates nonce, and checks `LINE_DIRECTORY_CAPTURE_ENABLED`. During controlled setup it stores only `sourceType`, `sourceId`, `capturedAt`, and an empty manager alias in `CONFIG_LINE_DIRECTORY`. Keep the production `doPost` export as the Task 1 stub in this task; Task 11 wires it after `createRuntime` exists.

Define the Apps Script ingress event explicitly rather than assuming request headers exist:

```ts
export interface AppsScriptDoPostEvent {
  postData: { contents: string; length: number; name: string; type: string }
}

export interface BookingIngressPayload {
  timestamp: number
  nonce: string
  sourceType: 'user' | 'group'
  sourceId: string
  signature: string
}
```

- [ ] **Step 4: Integrate doctor notifications after Calendar persistence**

Extend Form and update workflows so LINE follows Drive and Calendar. On LINE failure, keep `BOOKING_CONFIRMED`, set `line_state = 'RETRY'`, append one retry item, and show an operational alert; do not recreate Drive or Calendar.

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
npm run test -- tests/bookingLineWebhook.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: LINE privacy, order, idempotency, and build checks PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts apps/pmc-google-booking-ops/src/workflows/formSubmit.ts apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/src/repositories.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/tests server/bookingLineWebhook.ts server/productionServer.ts tests/bookingLineWebhook.test.ts .env.example
git commit -m "feat: route booking LINE notifications"
```

---

### Task 8: Implement the Call Queue, Call Result Form, and Daily Reminders

**Files:**
- Create: `apps/pmc-google-booking-ops/src/workflows/callQueue.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleForms.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`
- Create: `apps/pmc-google-booking-ops/tests/callQueue.test.ts`

**Interfaces:**
- Consumes: `BookingCase`, `CallTaskRepository`, Admin group/direct routing, `Clock`, and `CONFIG_RULES`.
- Produces: `createInitialCallTask`, `recordCallResult`, `runDailyCallReminders`, `runDepositExpiryReminders`, `runDailyDoctorSchedules`, and the `onCallResultSubmit` entrypoint.

- [ ] **Step 1: Write failing call-queue tests**

Create `tests/callQueue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { recordCallResult, runDailyCallReminders, runDailyDoctorSchedules } from '../src/workflows/callQueue'
import { createTestPorts } from './helpers/fakes'

describe('call queue', () => {
  it('starts reminders on appointment day and routes to group plus owner', async () => {
    const ports = createTestPorts({ now: '2026-08-20T09:00:00+07:00' })
    ports.calls.insertFixture({ caseId: 'PMC-202608-0001', windowStart: '2026-08-20T00:00:00+07:00', windowEnd: '2026-08-27T23:59:59+07:00' })
    await runDailyCallReminders(ports)
    expect(ports.line.adminMessages().map((message) => message.to)).toEqual(['admin-group', 'admin-user-1'])
  })

  it('repeats daily until a result is recorded without duplicating the same day', async () => {
    const ports = createTestPorts({ now: '2026-08-21T09:00:00+07:00' })
    ports.calls.insertFixture({ caseId: 'PMC-202608-0001', lastReminderDate: null })
    await runDailyCallReminders(ports)
    await runDailyCallReminders(ports)
    expect(ports.line.adminMessages()).toHaveLength(2)
  })

  it('marks the task overdue after Day 7', async () => {
    const ports = createTestPorts({ now: '2026-08-28T09:00:00+07:00' })
    ports.calls.insertFixture({ caseId: 'PMC-202608-0001', windowEnd: '2026-08-27T23:59:59+07:00' })
    await runDailyCallReminders(ports)
    expect(ports.calls.getOpenByCase('PMC-202608-0001')?.status).toBe('OVERDUE')
  })

  it('suggests but allows overriding the next call date', async () => {
    const ports = createTestPorts({ now: '2026-08-20T12:00:00+07:00' })
    const result = await recordCallResult({ caseId: 'PMC-202608-0001', result: 'NOT_READY', nextCallAt: '2026-09-10T09:00:00+07:00', note: '' }, ports)
    expect(result.nextCallAt).toBe('2026-09-10T09:00:00+07:00')
  })

  it('sends each doctor only that doctor’s daily schedule', async () => {
    const ports = createTestPorts({ now: '2026-08-20T09:00:00+07:00' })
    ports.bookings.insertConfirmedFixture({ caseId: 'PMC-202608-0001', doctorId: 'doctor-1' })
    ports.bookings.insertConfirmedFixture({ caseId: 'PMC-202608-0002', doctorId: 'doctor-2' })
    await runDailyDoctorSchedules(ports)
    expect(ports.line.doctorMessages()).toHaveLength(2)
    expect(ports.line.doctorMessages()[0].caseIds).toEqual(['PMC-202608-0001'])
    expect(ports.line.doctorMessages()[1].caseIds).toEqual(['PMC-202608-0002'])
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/callQueue.test.ts
```

Expected: FAIL because call workflow is absent.

- [ ] **Step 3: Implement call tasks and result parsing**

Use the approved result enum: `REBOOKED`, `NO_ANSWER`, `CALL_BACK_REQUESTED`, `NOT_READY`, `DECLINED`, `WRONG_NUMBER`.

Implement default suggestions exactly as the spec and accept an Admin override. Prefilled call links include only Case ID; the Form still collects submitter email for audit.

- [ ] **Step 4: Implement daily reminder and expiry runs**

At the configured Bangkok time:

1. select tasks due on or before today;
2. skip closed/refunded/expired/cancelled tasks;
3. deduplicate on `taskId + BangkokDate + destination`;
4. send to Admin group and direct owner;
5. increment reminder evidence only after successful delivery; and
6. mark overdue when `now > firstCallWindowEnd` and no result exists.

Send deposit-expiry reminders at 30, 14, and 7 days. At expiry, set `EXPIRED_6M`, cancel routine calls, and require manager audit for extension.

`runDailyDoctorSchedules` groups today's confirmed appointments by doctor and sends one safe summary per configured doctor group. It excludes other doctors' cases, full phones, evidence links, payment details, and national-ID-like strings. Deduplicate on `doctorId + BangkokDate + DAILY_SCHEDULE`.

- [ ] **Step 5: Wire entrypoints**

Expose `parseCallResultFormEvent` and a dependency-injected `runDailyOperations(ports)` that runs doctor schedule summaries, call reminders, deposit-expiry reminders, eligible retries, and dashboard refresh in that order. Keep `onCallResultSubmit` and the zero-argument production `runDailyOperations` entrypoint exports as Task 1 stubs until Task 11 wires them through `createRuntime`.

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/callQueue.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: call and expiry tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/workflows/callQueue.ts apps/pmc-google-booking-ops/src/adapters/googleForms.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/tests
git commit -m "feat: add booking call reminders"
```

---

### Task 9: Parse JERA CP874 Exports and Reconcile Closures

**Files:**
- Create: `apps/pmc-google-booking-ops/src/domain/jera.ts`
- Create: `apps/pmc-google-booking-ops/src/workflows/jeraImport.ts`
- Create: `apps/pmc-google-booking-ops/tests/jeraImport.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: `FilePort`, import/reconciliation/booking repositories, name/phone normalization, and JERA incoming-folder configuration.
- Produces: `decodeJeraReport`, `parseJeraTransactions`, `matchJeraTransaction`, `importJeraFile`, and `pollJeraIncoming`.

- [ ] **Step 1: Write privacy-safe failing parser and reconciliation tests**

Create synthetic CP874/tab fixtures in memory; do not copy customer rows from the supplied sample.

```ts
import { describe, expect, it } from 'vitest'
import { parseJeraTransactions } from '../src/domain/jera'
import { importJeraFile } from '../src/workflows/jeraImport'
import { createTestPorts, jeraCp874Fixture } from './helpers/fakes'

describe('JERA import', () => {
  it('finds the header after metadata and ignores detail/summary rows', () => {
    const rows = parseJeraTransactions(jeraCp874Fixture())
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.status)).toEqual(['ชำระแล้ว', 'คืนมัดจำ'])
  })

  it('closes only a unique phone plus name match with ชำระแล้ว', async () => {
    const ports = createTestPorts()
    ports.bookings.insertOpenFixture({ customerNameNormalized: 'สมหญิงใจดี', phoneNormalized: '0812345678' })
    await importJeraFile('jera-file-1', ports)
    const booking = ports.bookings.getByCaseId('PMC-202608-0001')
    expect(booking?.status).toBe('CLOSED_JERA')
    expect(booking?.commissionEligibility).toBe('PENDING_RULE')
    expect(booking?.commissionAmount).toBeNull()
  })

  it('sends name-only, missing, or multiple matches to reconciliation', async () => {
    const ports = createTestPorts({ jeraPhone: '' })
    await importJeraFile('jera-file-1', ports)
    expect(ports.reconciliation.listOpen()).toHaveLength(1)
    expect(ports.bookings.listByStatus('CLOSED_JERA')).toHaveLength(0)
  })

  it('does not import the same file hash or payment ID twice', async () => {
    const ports = createTestPorts()
    await importJeraFile('jera-file-1', ports)
    await importJeraFile('jera-file-1-copy', ports)
    expect(ports.imports.completed()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/jeraImport.test.ts
```

Expected: FAIL because parser/import workflow does not exist.

- [ ] **Step 3: Implement CP874 tab decoding and robust header detection**

`FilePort.readText(fileId, 'Windows-874')` supplies text. The parser detects a tab delimiter and locates a header containing all required names:

```ts
const REQUIRED_JERA_HEADERS = [
  'วันที่',
  'เวลา',
  'รหัสใบชำระเงิน',
  'ผู้ป่วย',
  'HN',
  'มือถือ',
  'สถานะ',
  'ยอดเงินที่ได้รับจริง',
] as const
```

Select transaction headers only when payment ID and a recognized transaction status exist. Ignore metadata, service detail, and totals. Record parsed counts and rejected-row reasons without raw PII in logs.

- [ ] **Step 4: Implement deterministic matching and state effects**

For `ชำระแล้ว`, require exactly one open case matching normalized phone plus normalized name. Store payment ID, close timestamp, actual revenue, source file ID, and `PENDING_RULE`; cancel open call tasks.

For `คืนมัดจำ`, require the same deterministic match before `REFUNDED`. All unsupported, blank, `0`, ambiguous, missing, or already-consumed items enter reconciliation and cannot mutate booking status.

- [ ] **Step 5: Implement import idempotency and quarantine**

Compute a SHA-256 content hash, reserve it before parsing, and record file ID/hash/status/counts. Parse failure sets import status `QUARANTINED`, leaves `BOOKING_MASTER` unchanged, and records a safe error message.

- [ ] **Step 6: Wire Drive polling**

The dependency-injected `pollJeraIncoming(ports)` workflow lists unprocessed files in the configured folder, processes them in deterministic filename order, and moves completed or quarantined files to separate controlled folders. Keep the zero-argument production entrypoint stub until Task 11 wires it through `createRuntime`.

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/jeraImport.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: parser, matching, idempotency, and quarantine tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/pmc-google-booking-ops/src/domain/jera.ts apps/pmc-google-booking-ops/src/workflows/jeraImport.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/tests
git commit -m "feat: reconcile JERA payment exports"
```

---

### Task 10: Build the Dashboard, Integrity Checks, Backup, and Retention Queue

**Files:**
- Create: `apps/pmc-google-booking-ops/src/workflows/dashboard.ts`
- Create: `apps/pmc-google-booking-ops/src/workflows/integrity.ts`
- Create: `apps/pmc-google-booking-ops/src/workflows/retention.ts`
- Create: `apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleDrive.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`

**Interfaces:**
- Consumes: canonical booking/call/import/retry rows and Google Sheet/Drive ports.
- Produces: `buildDashboardSnapshot`, `writeDashboard`, `runIntegrityReport`, `createDailyBackup`, `queueEvidenceRetention`, and `approveEvidenceDeletion`.

- [ ] **Step 1: Write failing dashboard and integrity tests**

Create `tests/dashboardIntegrityRetention.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDashboardSnapshot } from '../src/workflows/dashboard'
import { runIntegrityReport } from '../src/workflows/integrity'
import { queueEvidenceRetention } from '../src/workflows/retention'
import { bookingFixture, createTestPorts } from './helpers/fakes'

describe('dashboard and controls', () => {
  it('derives operational and management metrics without raw PII', () => {
    const snapshot = buildDashboardSnapshot([
      bookingFixture({ status: 'BOOKING_CONFIRMED', depositAmount: 1000 }),
      bookingFixture({ caseId: 'PMC-202608-0002', status: 'CLOSED_JERA', depositAmount: 2000 }),
    ], [])
    expect(snapshot.kpis).toMatchObject({ bookings: 2, deposits: 3000, closedJera: 1 })
    expect(JSON.stringify(snapshot)).not.toContain('0812345678')
  })

  it('finds closed cases with active call tasks and duplicate JERA IDs', async () => {
    const ports = createTestPorts()
    ports.seedIntegrityFailures()
    const report = await runIntegrityReport(ports)
    expect(report.codes).toEqual(expect.arrayContaining(['CLOSED_WITH_ACTIVE_CALL', 'DUPLICATE_JERA_PAYMENT_ID']))
  })

  it('queues evidence after 90 days but never deletes without approval', async () => {
    const ports = createTestPorts({ now: '2026-11-19T09:00:00+07:00' })
    ports.bookings.insertClosedFixture({ jeraClosedAt: '2026-08-20T09:00:00+07:00' })
    await queueEvidenceRetention(ports)
    expect(ports.retention.pending()).toHaveLength(1)
    expect(ports.drive.trashedFileIds()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts
```

Expected: FAIL because dashboard/control workflows do not exist.

- [ ] **Step 3: Implement pure dashboard aggregation**

Calculate every approved daily and management metric from `BOOKING_MASTER` and support rows. Return masked case lists for drill-down. Keep commission output to eligible-case counts and `PENDING_RULE`; never synthesize an amount.

- [ ] **Step 4: Implement Sheet dashboard rendering**

Create a deterministic `DASHBOARD` layout with KPI cells, filtered operation tables, pivots/charts, and slicer-ready normalized support ranges. Protect calculated areas. `writeDashboard` clears only its managed named ranges, not arbitrary user cells.

- [ ] **Step 5: Implement the integrity report and daily backup**

Implement all checks from spec section 19 with stable error codes. Write findings to a managed dashboard block and Admin alert summary. `createDailyBackup` copies the spreadsheet into the configured backup folder with Bangkok date and source spreadsheet ID, and deduplicates one backup per day.

- [ ] **Step 6: Implement manager-approved retention**

`queueEvidenceRetention` creates approval rows 90 days after closed/refunded/expired. `approveEvidenceDeletion` requires manager email, case ID, reason, and row version; it trashes only stored evidence IDs and appends an audit event. It never deletes Booking/JERA/Audit rows.

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: metrics, PII safety, integrity, backup, and retention tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/pmc-google-booking-ops/src/workflows/dashboard.ts apps/pmc-google-booking-ops/src/workflows/integrity.ts apps/pmc-google-booking-ops/src/workflows/retention.ts apps/pmc-google-booking-ops/src/adapters apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts
git commit -m "feat: add booking dashboard controls"
```

---

### Task 11: Wire Runtime Setup, End-to-End Tests, and Pilot Runbook

**Files:**
- Create: `apps/pmc-google-booking-ops/src/runtime.ts`
- Create: `apps/pmc-google-booking-ops/tests/endToEnd.test.ts`
- Create: `apps/pmc-google-booking-ops/docs/setup.md`
- Create: `apps/pmc-google-booking-ops/docs/pilot-runbook.md`
- Create: `apps/pmc-google-booking-ops/.clasp.json.example`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Modify: `docs/PROJECT_UPDATES.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: `createRuntime`, `setupPmcBookingSystem`, fully bundled trigger entrypoints, reproducible setup instructions, and pilot acceptance evidence.

- [ ] **Step 1: Write the failing end-to-end contract test**

Create `tests/endToEnd.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { submitBookingIntake } from '../src/workflows/formSubmit'
import { runDailyCallReminders } from '../src/workflows/callQueue'
import { importJeraFile } from '../src/workflows/jeraImport'
import { createTestPorts, validBookingIntake } from './helpers/fakes'

describe('PMC booking end to end', () => {
  it('books once, routes safely, reminds, and closes only from JERA paid evidence', async () => {
    const ports = createTestPorts()
    const booking = await submitBookingIntake(validBookingIntake(), ports)
    expect(booking.status).toBe('BOOKING_CONFIRMED')
    expect(ports.drive.caseFolders()).toHaveLength(1)
    expect(ports.calendar.createdEvents()).toHaveLength(1)
    expect(ports.line.doctorMessages()).toHaveLength(1)

    ports.clock.set('2026-08-20T09:00:00+07:00')
    await runDailyCallReminders(ports)
    expect(ports.line.adminMessages()).toHaveLength(2)

    await importJeraFile('jera-file-1', ports)
    expect(ports.bookings.getByCaseId(booking.caseId)?.status).toBe('CLOSED_JERA')
    expect(ports.calls.getOpenByCase(booking.caseId)).toBeNull()
    expect(ports.bookings.getByCaseId(booking.caseId)?.commissionAmount).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run test -- apps/pmc-google-booking-ops/tests/endToEnd.test.ts
```

Expected: FAIL until runtime and all workflow integration points are wired.

- [ ] **Step 3: Implement `createRuntime`**

Construct all production ports from Apps Script globals and Script Properties. Validate every required property at startup and return one explicit configuration error listing missing property names without printing values.

The runtime must inject adapters; workflows must remain free of Apps Script globals.

Replace every Task 1 `Not configured` export in `entrypoints.ts` with a thin runtime wrapper. Each wrapper creates one runtime and delegates once:

```ts
export const onBookingFormSubmit = (event: GoogleAppsScript.Events.SheetsOnFormSubmit) =>
  submitBookingIntake(parseBookingFormEvent(event), createRuntime())
export const onCallResultSubmit = (event: GoogleAppsScript.Events.SheetsOnFormSubmit) =>
  recordCallResult(parseCallResultFormEvent(event), createRuntime())
export const doPost = (event: AppsScriptDoPostEvent) =>
  toAppsScriptResponse(handleLineDirectoryIngress(parseBookingIngressEvent(event), createRuntime()))
export const runDailyOperations = () => runDailyOperationsWorkflow(createRuntime())
export const pollJeraIncoming = () => pollJeraIncomingWorkflow(createRuntime())
export const runIntegrityChecks = () => runIntegrityAndBackup(createRuntime())
export const setupPmcBookingSystem = () => setupSystem(createRuntime())
```

Alias imported workflow functions as shown so wrapper names never recursively call themselves.

- [ ] **Step 4: Implement idempotent setup**

`setupPmcBookingSystem` must:

1. validate Script Properties;
2. create/validate all Sheet tabs and headers;
3. protect managed ranges;
4. synchronize Admin/doctor/service choices into both Forms;
5. create installable triggers for Booking Form submit, Call Result Form submit, 15-minute JERA polling, daily operations, and daily integrity/backup;
6. avoid duplicate triggers by handler/source/schedule identity; and
7. return a safe setup summary without IDs or tokens.

- [ ] **Step 5: Write exact setup and deployment instructions**

`docs/setup.md` must include:

- company-account ownership and access prerequisites;
- exact Script Property names;
- exact PMC Web environment names `BOOKING_LINE_CHANNEL_SECRET`, `BOOKING_APPS_SCRIPT_INGRESS_URL`, and `BOOKING_INGRESS_SECRET`;
- required Google assets and configuration-tab rows;
- LINE OA group join/user-ID capture steps without secrets;
- PMC Web `/api/booking-line/webhook` deployment before Basic Auth, signature-verified Apps Script ingress deployment, temporary directory capture enablement, manager alias mapping, and capture disablement;
- Google Calendar advanced-service and Cloud-project API enablement;
- build and `clasp push` commands;
- setup-function authorization and trigger verification;
- how to publish one shared Form link with a required Admin Dropdown;
- how to upload JERA files; and
- rollback steps that disable triggers and the LINE Web App deployment without deleting data.

`.clasp.json.example` uses placeholders only:

```json
{
  "scriptId": "REPLACE_WITH_COMPANY_APPS_SCRIPT_ID",
  "rootDir": "dist"
}
```

- [ ] **Step 6: Write the pilot runbook**

`docs/pilot-runbook.md` must define a privacy-safe pilot with:

- one manager, one Admin/assistant, and two doctor groups;
- synthetic customers only during technical verification;
- one valid booking, one time conflict, one missing-evidence rejection, one LINE retry, one call-overdue simulation, one JERA paid match, one ambiguous JERA item, and one expiry/retention simulation;
- expected Sheet, Drive, Calendar, LINE, JERA, Audit, Retry, and Dashboard evidence for each scenario; and
- explicit go/no-go gates before real customer use.

- [ ] **Step 7: Run full verification**

Run:

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npm run test
npm run build
git diff --check
```

Expected: all targeted and repository-wide tests, typechecks, builds, lint, and whitespace checks PASS.

- [ ] **Step 8: Review the built bundle for secret and PII leakage**

Run:

```bash
rg -n "LINE_CHANNEL_ACCESS_TOKEN|LINE_CHANNEL_SECRET|REPLACE_WITH|0812345678|\b[0-9]{13}\b" apps/pmc-google-booking-ops/dist apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/docs
```

Expected: property *names* and documented placeholders may appear; no token values, real IDs, real phones, customer names, or national-ID fixtures appear. Review every match manually.

- [ ] **Step 9: Update the project log**

Append a dated entry to `docs/PROJECT_UPDATES.md` describing the implemented Google Booking package, verification commands, and the fact that production Google/LINE assets remain setup-gated until the pilot runbook passes.

- [ ] **Step 10: Commit**

```bash
git add apps/pmc-google-booking-ops docs/PROJECT_UPDATES.md package.json package-lock.json eslint.config.js .gitignore
git commit -m "feat: complete PMC Google booking operations"
```

---

## Spec Coverage Map

| Spec area | Implementation task |
|---|---|
| Product boundary, roles, status authority | Tasks 2, 4, 9, 11 |
| Quick Form, shared account, selected Admin, optional channel, automatic values | Tasks 4 and 11 |
| Sheet topology, canonical record, protection, audit | Tasks 3 and 10 |
| Form idempotency and validation | Task 4 |
| Drive folder/evidence and permissions | Tasks 5 and 10 |
| Doctor Calendars, conflict, reschedule | Task 6 |
| Doctor/Admin LINE routing and safe payloads | Tasks 7 and 8 |
| Daily call queue, result suggestions, expiry | Task 8 |
| JERA CP874 parser, import, close/refund, reconciliation | Task 9 |
| Dashboard, integrity, backup, retention | Task 10 |
| Company setup, triggers, deployment, pilot, rollout gates | Task 11 |

## Final Review Gate

Before any production setup or real customer data:

- [ ] Confirm all eleven task commits are present and focused.
- [ ] Confirm full verification from Task 11 passes on the merged tree.
- [ ] Confirm no unrelated dirty-worktree changes were included.
- [ ] Confirm the Script project, Sheet, Forms, Drive root, Calendars, and triggers are company-owned.
- [ ] Confirm LINE secrets exist only in Script Properties.
- [ ] Confirm doctor groups receive only their own synthetic pilot bookings.
- [ ] Confirm JERA import uses a copied privacy-safe file during pilot and never commits source exports.
- [ ] Confirm `CLOSED_JERA` cannot be reached without a unique `ชำระแล้ว` match.
- [ ] Confirm the commission amount remains blank while the rule is deferred.
- [ ] Confirm the manager explicitly authorizes transition from synthetic pilot to real customer use.
