# PMC Booking Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first Apps Script booking Web App that replaces daily Google Form intake while preserving Google Sheets as the source of truth and reusing the existing Drive, Calendar, LINE, call, JERA, audit, and retry workflows.

**Architecture:** Add a PIN-authenticated Apps Script HTML Service UI and pure TypeScript domain modules for capacity, sessions, drafts, and staged evidence uploads. Final confirmation rechecks Calendar capacity under a reentrant script lock, writes the canonical booking once, and then reuses existing idempotent downstream adapters. The existing Google Form remains an emergency fallback and the new Web App is deployed behind a separate versioned URL and feature flag.

**Tech Stack:** TypeScript 6, Vitest 4, esbuild, Google Apps Script V8, HTML Service, `google.script.run`, Google Sheets, Google Drive, Google Calendar Advanced Service, LINE Messaging API, CSS, and browser-based mobile verification.

**Spec:** `docs/superpowers/specs/2026-08-21-pmc-booking-web-app-design.md`

## Global Constraints

- `BOOKING_MASTER` remains the canonical operational record.
- JERA `ชำระแล้ว` remains the only authority for `CLOSED_JERA`.
- No Thai national ID may enter Form, Web App, Sheet, Drive metadata, Calendar, LINE, logs, or fixtures.
- The approved mobile flow is details → calendar layout B → evidence queue → review.
- Default booking hours are 10:30–20:30; starts use 30-minute boundaries; later times remain available on demand.
- Normal capacity is two concurrent cases; staff may explicitly add a special queue; hard blocks cannot be overridden.
- Payment-slip and chat evidence have no product-level count limit and upload independently.
- PIN sessions remember a device for 30 days; abandoned drafts expire after 24 hours.
- The Web App must not depend on Render availability.
- The existing Form, LINE webhook URL, Sheet records, and production triggers remain available for rollback.
- The UI is clean white with restrained PMC gold, IBM Plex Sans Thai headings, IBM Plex Sans Thai Looped body, 48px minimum tap targets, and text plus color for status.
- All timestamps use `Asia/Bangkok`; persisted timestamps use ISO 8601 with offset.
- Every code task follows RED → verify RED → GREEN → verify GREEN → focused refactor → full relevant regression → commit.
- After every GREEN step, also run `npm run booking:typecheck`; do not commit a task that leaves the package uncompilable.
- Never push Apps Script, create a deployment, rotate a PIN, edit live Script Properties, migrate the live Sheet, or enable the feature flag without a fresh explicit production approval.
- Never print, paste, log, or commit PINs, session tokens, Google IDs, LINE tokens, OAuth credentials, or customer PII.

## Mandatory Execution Preflight

The current checkout contains already-deployed PMC booking changes that are not all committed. Before creating an execution worktree:

1. Run `git status --short` and preserve unrelated/untracked user files.
2. Run `npm run booking:test`, `npm run booking:typecheck`, and `npm run booking:build` in the current checkout.
3. Review only the existing tracked `apps/pmc-google-booking-ops/` diff and create a baseline commit for those already-approved live changes before branching or creating a worktree.
4. Confirm the execution base contains the closer/AE shared-account cutover, capacity-predecessor Calendar code, current Flex, phone normalization, and current sequence fixes.
5. Use `superpowers:using-git-worktrees` after that baseline commit. Do not create a clean worktree from a commit that omits the already-deployed booking changes.

Baseline commit command after review:

```bash
git add apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests
git commit -m "feat: finalize PMC booking intake workflow"
```

Do not stage artifacts, `.codex-tmp/`, reports, outputs, unrelated docs, or top-level scripts in that baseline commit.

## File Structure

### Create

```text
apps/pmc-google-booking-ops/src/domain/availability.ts
apps/pmc-google-booking-ops/src/domain/webAuth.ts
apps/pmc-google-booking-ops/src/domain/webDraft.ts
apps/pmc-google-booking-ops/src/workflows/webAuth.ts
apps/pmc-google-booking-ops/src/workflows/webAvailability.ts
apps/pmc-google-booking-ops/src/workflows/webDraft.ts
apps/pmc-google-booking-ops/src/workflows/webEvidence.ts
apps/pmc-google-booking-ops/src/workflows/webSubmit.ts
apps/pmc-google-booking-ops/src/adapters/appsScriptCache.ts
apps/pmc-google-booking-ops/src/adapters/appsScriptHtml.ts
apps/pmc-google-booking-ops/src/web/client.ts
apps/pmc-google-booking-ops/src/web/state.ts
apps/pmc-google-booking-ops/src/web/googleScriptRun.d.ts
apps/pmc-google-booking-ops/web/Index.html
apps/pmc-google-booking-ops/web/styles.css
apps/pmc-google-booking-ops/tests/availability.test.ts
apps/pmc-google-booking-ops/tests/webAuth.test.ts
apps/pmc-google-booking-ops/tests/webDraft.test.ts
apps/pmc-google-booking-ops/tests/webEvidence.test.ts
apps/pmc-google-booking-ops/tests/webSubmit.test.ts
apps/pmc-google-booking-ops/tests/webClientState.test.ts
apps/pmc-google-booking-ops/docs/web-app-pilot-runbook.md
```

### Modify

```text
apps/pmc-google-booking-ops/src/domain/types.ts
apps/pmc-google-booking-ops/src/domain/sheetMigration.ts
apps/pmc-google-booking-ops/src/config.ts
apps/pmc-google-booking-ops/src/ports.ts
apps/pmc-google-booking-ops/src/sheetSchema.ts
apps/pmc-google-booking-ops/src/repositories.ts
apps/pmc-google-booking-ops/src/adapters/googleSheets.ts
apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts
apps/pmc-google-booking-ops/src/adapters/googleDrive.ts
apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts
apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts
apps/pmc-google-booking-ops/src/workflows/formSubmit.ts
apps/pmc-google-booking-ops/src/runtime.ts
apps/pmc-google-booking-ops/src/entrypoints.ts
apps/pmc-google-booking-ops/scripts/build.mjs
apps/pmc-google-booking-ops/tests/helpers/fakes.ts
apps/pmc-google-booking-ops/tests/build.test.ts
apps/pmc-google-booking-ops/tests/sheetMigration.test.ts
apps/pmc-google-booking-ops/tests/formSubmit.test.ts
apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts
apps/pmc-google-booking-ops/tests/endToEnd.test.ts
apps/pmc-google-booking-ops/docs/setup.md
apps/pmc-google-booking-ops/appsscript.json
```

## Spec Coverage Map

| Approved spec area | Implementation tasks |
|---|---|
| Apps Script-only architecture and separate deployment | 9, 11, 12 |
| Four-step mobile flow and Thai visual direction | 9, 10, 12 |
| PIN, 30-day session, revocation, rate limiting | 3, 9, 10, 12 |
| Draft persistence and 24-hour cleanup | 4, 11, 12 |
| Multiple staged slip/chat uploads and resume | 5, 10, 11, 12 |
| 10:30–20:30, 30-minute starts, variable duration | 1, 6, 7 |
| Two-case capacity, special queue, hard block | 1, 6, 7, 8, 12 |
| Sheet schema, raw intake, canonical source | 2, 4, 7 |
| Shared downstream Drive/Calendar/LINE/call/JERA flow | 7, 8, 12 |
| Google Form fallback, feature flag, rollback | 2, 7, 11, 12 |
| Security, PII boundary, idempotency, audit | 3, 4, 5, 7, 11, 12 |
| Browser, accessibility, and pilot verification | 10, 11, 12 |

---

### Task 1: Shared Calendar Capacity Engine

**Files:**
- Create: `apps/pmc-google-booking-ops/src/domain/availability.ts`
- Create: `apps/pmc-google-booking-ops/tests/availability.test.ts`

**Interfaces:**
- Consumes: ISO 8601 timestamps with `+07:00`, service duration in minutes, normal capacity, and Calendar event intervals.
- Produces:

```ts
export type CalendarOccupancyKind = 'CASE' | 'HARD_BLOCK' | 'OTHER'

export interface CalendarOccupancy {
  eventId: string
  start: string
  end: string
  kind: CalendarOccupancyKind
  caseId: string | null
  serviceLabel: string | null
  customerName: string | null
  phone: string | null
}

export interface CapacityDecision {
  classification: 'NORMAL' | 'SPECIAL' | 'HARD_BLOCKED'
  peakExisting: number
  remainingNormalCapacity: number
  blockingEventIds: string[]
}

export interface SlotCandidate extends CapacityDecision {
  start: string
  end: string
}

export function classifyCapacity(input: {
  start: string
  end: string
  events: CalendarOccupancy[]
  normalCapacity: number
  excludeEventId?: string | null
}): CapacityDecision

export function generateSlotCandidates(input: {
  date: string
  openTime: string
  closeTime: string
  intervalMinutes: number
  durationMinutes: number
  events: CalendarOccupancy[]
  normalCapacity: number
}): SlotCandidate[]
```

- Task 6 replaces `CalendarPort.hasConflict()` with `CalendarPort.listOccupancy(calendarId, start, end, excludeEventId?)` after the pure classifier is independently green.

- [ ] **Step 1: Write failing capacity tests**

```ts
it('allows a second 60-minute case starting 30 minutes later', () => {
  const events = [caseEvent('10:30', '11:30')]
  expect(classifyCapacity({
    start: iso('11:00'),
    end: iso('12:00'),
    events,
    normalCapacity: 2,
  })).toMatchObject({ classification: 'NORMAL', peakExisting: 1, remainingNormalCapacity: 1 })
})

it('requires special confirmation when two cases already overlap', () => {
  const events = [caseEvent('10:30', '11:30'), caseEvent('11:00', '12:00')]
  expect(classifyCapacity({
    start: iso('11:00'),
    end: iso('12:00'),
    events,
    normalCapacity: 2,
  }).classification).toBe('SPECIAL')
})

it('never allows a special override across a hard block', () => {
  expect(classifyCapacity({
    start: iso('14:00'),
    end: iso('15:00'),
    events: [hardBlock('13:00', '16:00')],
    normalCapacity: 2,
  }).classification).toBe('HARD_BLOCKED')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/availability.test.ts`

Expected: FAIL because `availability.ts` and exported functions do not exist.

- [ ] **Step 3: Implement the sweep-line classifier and 30-minute candidate generator**

Implementation rules:

```ts
const relevant = events.filter((event) => event.start < end && event.end > start)
if (relevant.some((event) => event.kind === 'HARD_BLOCK')) return hardBlocked(relevant)

const points = relevant.flatMap((event) => [
  { at: maxIso(event.start, start), delta: 1 },
  { at: minIso(event.end, end), delta: -1 },
])
// Sort end points before start points at the same timestamp.
// peakExisting >= normalCapacity means SPECIAL.
```

Reject invalid intervals, non-positive duration, non-30-minute boundary inputs where required, and a normal capacity below one.

- [ ] **Step 4: Run targeted tests to verify GREEN**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/availability.test.ts`

Expected: PASS with the capacity engine independent of Google adapters.

- [ ] **Step 5: Commit**

```bash
git add apps/pmc-google-booking-ops/src/domain/availability.ts \
  apps/pmc-google-booking-ops/tests/availability.test.ts
git commit -m "feat: add PMC booking capacity engine"
```

---

### Task 2: Canonical Web App Fields and Sheet Migration

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/domain/types.ts:34-106`
- Modify: `apps/pmc-google-booking-ops/src/domain/sheetMigration.ts:1-18`
- Modify: `apps/pmc-google-booking-ops/src/sheetSchema.ts:3-80`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts:20-52`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleForms.ts:24-45`
- Modify: `apps/pmc-google-booking-ops/src/repositories.ts:46-53`
- Modify: `apps/pmc-google-booking-ops/tests/sheetMigration.test.ts:1-26`
- Modify: `apps/pmc-google-booking-ops/tests/repositories.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts:20-106,506-524`

**Interfaces:**
- Consumes: current 53-column booking schema and existing AE migration.
- Produces:

```ts
export type IntakeSource = 'GOOGLE_FORM' | 'PMC_WEB_APP'
export type CapacityStatus = 'NORMAL' | 'SPECIAL'

export interface BookingIntake {
  // existing fields
  intakeSource: IntakeSource
  requestedCapacityStatus: CapacityStatus
}

export interface BookingCase {
  // existing fields
  intakeSource: IntakeSource
  capacityStatus: CapacityStatus
  capacityCountAtSubmit: number | null
}
```

- Adds protected schemas for `WEBAPP_INTAKE_RAW`, `BOOKING_DRAFTS`, and `WEBAPP_SESSIONS`.
- Existing rows are backfilled only in new fields: `intakeSource = GOOGLE_FORM`, `capacityStatus = NORMAL`, `capacityCountAtSubmit = blank`.

- [ ] **Step 1: Write failing migration and repository tests**

```ts
it('appends Web App columns to the current canonical header', () => {
  expect(bookingMasterMigrationPlan(currentFiftyThreeColumns)).toEqual({
    kind: 'APPEND_WEBAPP_COLUMNS',
    afterColumn: 53,
    headers: ['intakeSource', 'capacityStatus', 'capacityCountAtSubmit'],
  })
})

it('reads blank historical capacity count as null', () => {
  expect(repositories.bookings.getByCaseId('PMC-202608-0001')).toMatchObject({
    intakeSource: 'GOOGLE_FORM',
    capacityStatus: 'NORMAL',
    capacityCountAtSubmit: null,
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/repositories.test.ts`

Expected: FAIL because the columns and migration variant do not exist.

- [ ] **Step 3: Extend types and canonical column order**

Append the three fields after `updatedBy` to avoid shifting any current production field. Update all booking/intake fixtures with explicit values.

The Google Form parser sets `intakeSource = GOOGLE_FORM` and `requestedCapacityStatus = NORMAL` so the fallback path remains explicit. `capacityCountAtSubmit` is derived only by the final locked Calendar classification.

```ts
const intake: BookingIntake = {
  // existing parsed Form fields
  intakeSource: 'GOOGLE_FORM',
  requestedCapacityStatus: 'NORMAL',
}

export const BOOKING_MASTER_COLUMNS = [
  // all existing columns in their current order
  'updatedBy',
  'intakeSource',
  'capacityStatus',
  'capacityCountAtSubmit',
] as const
```

- [ ] **Step 4: Generalize the migration planner**

Support exactly these known headers:

1. legacy without AE and without Web App fields;
2. current with AE and without Web App fields;
3. canonical with AE and Web App fields.

Reject every unknown order. Return a plan that can insert AE after column 8 and append Web App columns after the last current column in a deterministic sequence.

```ts
export type BookingMasterMigrationStep =
  | { kind: 'INSERT_COLUMNS'; afterColumn: number; headers: string[] }
  | { kind: 'BACKFILL_WEBAPP_DEFAULTS' }

export function bookingMasterMigrationPlan(existing: string[]): BookingMasterMigrationStep[] {
  if (same(existing, canonical)) return []
  if (same(existing, currentWithAe)) {
    return [
      { kind: 'INSERT_COLUMNS', afterColumn: currentWithAe.length, headers: webAppHeaders },
      { kind: 'BACKFILL_WEBAPP_DEFAULTS' },
    ]
  }
  if (same(existing, legacyWithoutAe)) {
    return [
      { kind: 'INSERT_COLUMNS', afterColumn: 8, headers: ['aeId', 'aeName'] },
      { kind: 'INSERT_COLUMNS', afterColumn: currentWithAe.length, headers: webAppHeaders },
      { kind: 'BACKFILL_WEBAPP_DEFAULTS' },
    ]
  }
  throw new Error('unsupported BOOKING_MASTER header')
}
```

- [ ] **Step 5: Add new Sheet schemas**

```ts
WEBAPP_INTAKE_RAW: [
  'draftId', 'submittedAt', 'sessionId', 'closerId', 'aeId', 'customerName',
  'phoneNormalized', 'doctorId', 'serviceId', 'channelId', 'appointmentStart',
  'appointmentEnd', 'depositAmount', 'capacityStatus', 'capacityCountAtSubmit',
  'paymentEvidenceFileIds', 'chatEvidenceFileIds', 'caseId',
]
BOOKING_DRAFTS: [
  'draftId', 'sessionId', 'status', 'step', 'payload', 'createdAt', 'updatedAt',
  'expiresAt', 'confirmedCaseId', 'version',
]
WEBAPP_SESSIONS: [
  'sessionId', 'tokenHash', 'deviceLabel', 'createdAt', 'lastUsedAt', 'expiresAt',
  'revokedAt', 'version',
]
```

- [ ] **Step 6: Implement safe production migration and backfill**

The Google Sheets adapter must create a daily backup before live execution, insert/append only planned headers, and write new-field defaults without altering any existing cell. Do not call the migration against live data in this task.

```ts
for (const step of bookingMasterMigrationPlan(headers)) {
  if (step.kind === 'INSERT_COLUMNS') insertPlannedColumns(sheet, step)
  if (step.kind === 'BACKFILL_WEBAPP_DEFAULTS') backfillNewColumnsOnly(sheet)
}
```

- [ ] **Step 7: Run targeted tests to verify GREEN**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/repositories.test.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/pmc-google-booking-ops/src/domain/types.ts \
  apps/pmc-google-booking-ops/src/domain/sheetMigration.ts \
  apps/pmc-google-booking-ops/src/sheetSchema.ts \
  apps/pmc-google-booking-ops/src/adapters/googleSheets.ts \
  apps/pmc-google-booking-ops/src/adapters/googleForms.ts \
  apps/pmc-google-booking-ops/src/repositories.ts \
  apps/pmc-google-booking-ops/tests/sheetMigration.test.ts \
  apps/pmc-google-booking-ops/tests/repositories.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: add PMC Web App booking schema"
```

---

### Task 3: PIN Authentication and Remembered-Device Sessions

**Files:**
- Create: `apps/pmc-google-booking-ops/src/domain/webAuth.ts`
- Create: `apps/pmc-google-booking-ops/src/workflows/webAuth.ts`
- Create: `apps/pmc-google-booking-ops/src/adapters/appsScriptCache.ts`
- Create: `apps/pmc-google-booking-ops/tests/webAuth.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/config.ts:1-16`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts:113-148,227-237,251-266`
- Modify: `apps/pmc-google-booking-ops/src/repositories.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts:149-157`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: `WEBAPP_SESSIONS`, `Clock`, `CryptoPort`, and Script Properties.
- Produces:

```ts
export interface WebSession {
  sessionId: string
  tokenHash: string
  deviceLabel: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  revokedAt: string | null
  version: number
}

export interface WebSessionRepository {
  insert(session: WebSession): WebSession
  findByTokenHash(tokenHash: string): WebSession | null
  update(sessionId: string, expectedVersion: number, patch: Partial<WebSession>): WebSession
  revoke(sessionId: string, revokedAt: string): void
  revokeAll(revokedAt: string): number
}

export interface LoginThrottlePort {
  failedAttempts(deviceKey: string): number
  recordFailure(deviceKey: string, ttlSeconds: number): number
  clear(deviceKey: string): void
}

export interface WebAuthPorts {
  clock: Clock
  crypto: CryptoPort
  sessions: WebSessionRepository
  throttle: LoginThrottlePort
  pinHash(): string
  pinSalt(): string
  pinPepper(): string
  sessionSecret(): string
}

export function createWebSessionRepository(
  store: SheetStore,
  clock: Clock,
): WebSessionRepository

export function loginWebApp(input: {
  pin: string
  deviceKey: string
  deviceLabel: string
  rememberDevice: boolean
}, ports: WebAuthPorts): { sessionToken: string; expiresAt: string }

export function requireWebSession(sessionToken: string, ports: WebAuthPorts): WebSession
export function logoutWebApp(sessionToken: string, ports: WebAuthPorts): void
```

- Extend `CryptoPort` with `randomToken(secret: string): string` and implement it as an HMAC of two UUIDs and the current timestamp using the dedicated session secret. Never use `Math.random()` for tokens.

- [ ] **Step 1: Write failing authentication tests**

```ts
it('returns a 30-day session without persisting the raw token', () => {
  const result = loginWebApp(validLogin(), ports)
  expect(result.expiresAt).toBe('2026-09-20T09:00:00+07:00')
  expect(ports.sessions.rows()[0].tokenHash).not.toBe(result.sessionToken)
})

it('locks repeated bad PIN attempts', () => {
  for (let index = 0; index < 5; index += 1) expectBadPin()
  expect(() => loginWebApp(validLogin(), ports)).toThrow('login temporarily locked')
})

it('rejects an expired or revoked session', () => {
  expect(() => requireWebSession(expiredToken, ports)).toThrow('web session expired')
  expect(() => requireWebSession(revokedToken, ports)).toThrow('web session revoked')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webAuth.test.ts`

Expected: FAIL because Web Auth modules do not exist.

- [ ] **Step 3: Implement deterministic PIN hashing and constant-time comparison**

`hashPin(pin, salt, crypto)` must validate the PIN shape, derive the salted hash, and compare equal-length hex values without early exit. Raw PIN values must never enter errors, audit, repository rows, or fixtures.

```ts
export function hashPin(pin: string, salt: string, pepper: string, crypto: CryptoPort): string {
  if (!/^\d{6,12}$/.test(pin)) throw new Error('invalid company PIN')
  return crypto.hmacSha256Hex(`${salt}:${pin}`, pepper)
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
```

- [ ] **Step 4: Implement sessions and throttling**

- Remembered session: 30 calendar days.
- Non-remembered session: 12 hours.
- Maximum failed attempts: 5 per device key per 15 minutes.
- Successful login clears the throttle.
- Every authenticated operation updates `lastUsedAt` with optimistic versioning.
- PIN rotation is an operational workflow that stores a new hash/salt and revokes all sessions; it is not called during ordinary setup.

```ts
if (ports.throttle.failedAttempts(input.deviceKey) >= 5) throw new Error('login temporarily locked')
if (!constantTimeHexEqual(hashPin(input.pin, ports.pinSalt(), ports.pinPepper(), ports.crypto), ports.pinHash())) {
  ports.throttle.recordFailure(input.deviceKey, 15 * 60)
  throw new Error('invalid company PIN')
}
const sessionToken = ports.crypto.randomToken(ports.sessionSecret())
ports.sessions.insert(sessionFromToken(sessionToken, input, ports))
```

- [ ] **Step 5: Implement Apps Script adapters**

Add Script Property keys:

```ts
webAppPinHash: 'PMC_WEBAPP_PIN_HASH'
webAppPinSalt: 'PMC_WEBAPP_PIN_SALT'
webAppPinPepper: 'PMC_WEBAPP_PIN_PEPPER'
webAppSessionSecret: 'PMC_WEBAPP_SESSION_SECRET'
```

Create a CacheService-backed throttle adapter. Add an operator function that consumes a temporary setup property, hashes the PIN, deletes the plaintext setup property in the same execution, and revokes sessions. Do not push or run it against live properties yet.

```ts
const temporaryPin = properties.getProperty('PMC_WEBAPP_PIN_SETUP')
if (!temporaryPin) throw new Error('temporary PIN setup value is missing')
try {
  properties.setProperties({
    PMC_WEBAPP_PIN_SALT: salt,
    PMC_WEBAPP_PIN_HASH: hashPin(temporaryPin, salt, pinPepper, crypto),
  })
  sessions.revokeAll(clock.nowIso())
} finally {
  properties.deleteProperty('PMC_WEBAPP_PIN_SETUP')
}
```

- [ ] **Step 6: Run targeted tests to verify GREEN**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webAuth.test.ts apps/pmc-google-booking-ops/tests/repositories.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/domain/webAuth.ts \
  apps/pmc-google-booking-ops/src/workflows/webAuth.ts \
  apps/pmc-google-booking-ops/src/adapters/appsScriptCache.ts \
  apps/pmc-google-booking-ops/src/config.ts \
  apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/src/repositories.ts \
  apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts \
  apps/pmc-google-booking-ops/tests/webAuth.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: add PMC Web App sessions"
```

---

### Task 4: Booking Drafts and Raw Intake Repositories

**Files:**
- Create: `apps/pmc-google-booking-ops/src/domain/webDraft.ts`
- Create: `apps/pmc-google-booking-ops/src/workflows/webDraft.ts`
- Create: `apps/pmc-google-booking-ops/tests/webDraft.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/repositories.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: authenticated `WebSession`, 24-hour draft expiry, configuration directories, and protected Sheet schemas.
- Produces:

```ts
export type WebDraftStatus = 'ACTIVE' | 'CONFIRMING' | 'CONFIRMED' | 'EXPIRED'

export interface WebDraftPayload {
  closerName: string
  aeName: string
  customerName: string
  phone: string
  doctorId: string
  serviceId: string
  channelId: string | null
  appointmentDate: string
  appointmentTime: string
  depositAmount: number | null
  requestedCapacityStatus: 'NORMAL' | 'SPECIAL'
}

export interface WebBookingDraft {
  draftId: string
  sessionId: string
  status: WebDraftStatus
  step: 1 | 2 | 3 | 4
  payload: WebDraftPayload
  createdAt: string
  updatedAt: string
  expiresAt: string
  confirmedCaseId: string | null
  version: number
}

export interface WebDraftRepository {
  insert(draft: WebBookingDraft): WebBookingDraft
  get(draftId: string): WebBookingDraft | null
  update(draftId: string, expectedVersion: number, patch: Partial<WebBookingDraft>): WebBookingDraft
  listExpired(nowIso: string): WebBookingDraft[]
  remove(draftId: string): void
}

export interface WebRawIntakeRepository {
  appendOnce(draftId: string, row: Record<string, unknown>): void
  findByDraftId(draftId: string): Record<string, unknown> | null
}

export interface AuthenticatedDraftInput {
  sessionToken: string
  draftId: string
}

export interface AuthenticatedDraftFileInput extends AuthenticatedDraftInput {
  fileId: string
}

export interface WebBookingPorts extends BookingPorts, WebAuthPorts {
  drafts: WebDraftRepository
  webRawIntake: WebRawIntakeRepository
}

export function createWebDraftRepository(
  store: SheetStore,
  clock: Clock,
): WebDraftRepository

export function createWebRawIntakeRepository(
  store: SheetStore,
): WebRawIntakeRepository
```

- [ ] **Step 1: Write failing draft tests**

```ts
it('creates one 24-hour draft owned by the current session', () => {
  const draft = createWebDraft({ sessionToken, deviceDraftId: 'draft-1' }, ports)
  expect(draft).toMatchObject({
    draftId: 'draft-1',
    sessionId: 'session-1',
    status: 'ACTIVE',
    step: 1,
    expiresAt: '2026-08-21T09:00:00+07:00',
  })
})

it('does not let another session read or update the draft', () => {
  expect(() => loadWebDraft({ sessionToken: otherToken, draftId: 'draft-1' }, ports))
    .toThrow('draft does not belong to session')
})

it('returns the existing confirmed Case ID on a duplicate finalization', () => {
  expect(confirmDraftAgain()).toEqual({ caseId: 'PMC-202608-0001', duplicate: true })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webDraft.test.ts`

Expected: FAIL because draft types and workflows do not exist.

- [ ] **Step 3: Implement minimal draft repository and ownership checks**

Persist only JSON-compatible payload values. Normalize nulls on read. Use optimistic versions for every save. Store only `draftId` in browser storage; customer data stays in `BOOKING_DRAFTS` and is loaded only after session validation.

```ts
export function saveWebDraft(input: {
  sessionToken: string
  draftId: string
  expectedVersion: number
  step: 1 | 2 | 3 | 4
  payload: WebDraftPayload
}, ports: WebBookingPorts): WebBookingDraft {
  const session = requireWebSession(input.sessionToken, ports)
  const draft = requireOwnedActiveDraft(input.draftId, session.sessionId, ports)
  return ports.drafts.update(draft.draftId, input.expectedVersion, {
    step: input.step,
    payload: normalizeDraftPayload(input.payload),
    updatedAt: ports.clock.nowIso(),
  })
}
```

- [ ] **Step 4: Implement raw intake append-once semantics**

`appendOnce` must be idempotent by Draft ID and must reject a second row with different content. It stores evidence IDs/counts, not image bytes.

```ts
const existing = store.read('WEBAPP_INTAKE_RAW').find((row) => row.draftId === draftId)
if (existing && stableJson(existing) !== stableJson(row)) throw new Error('raw Web App intake mismatch')
if (!existing) store.replace('WEBAPP_INTAKE_RAW', [...rows, row])
```

- [ ] **Step 5: Run targeted tests to verify GREEN**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webDraft.test.ts apps/pmc-google-booking-ops/tests/repositories.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pmc-google-booking-ops/src/domain/webDraft.ts \
  apps/pmc-google-booking-ops/src/workflows/webDraft.ts \
  apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/src/repositories.ts \
  apps/pmc-google-booking-ops/tests/webDraft.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: add resumable PMC booking drafts"
```

---

### Task 5: Staged Evidence Uploads

**Files:**
- Create: `apps/pmc-google-booking-ops/src/workflows/webEvidence.ts`
- Create: `apps/pmc-google-booking-ops/tests/webEvidence.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/config.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts:150-158`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleDrive.ts:82-118`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts:527-580`
- Modify: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts:26-61`

**Interfaces:**
- Consumes: valid Web session, owned active Draft ID, one upload form object, private Drive root.
- Produces:

```ts
export type EvidenceCategory = 'payment' | 'chat'

export interface DraftEvidenceFile {
  uploadId: string
  category: EvidenceCategory
  fileId: string
  fileName: string
  mimeType: string
  size: number
}

export interface WebEvidenceUploadForm {
  sessionToken: string
  draftId: string
  uploadId: string
  category: EvidenceCategory
  evidenceFile: GoogleAppsScript.Base.BlobSource
}

export interface DrivePort {
  // existing methods
  ensureDraftFolder(draftId: string): string
  findDraftFolder(draftId: string): string | null
  createDraftFile(input: {
    draftFolderId: string
    uploadId: string
    category: EvidenceCategory
    blob: GoogleAppsScript.Base.BlobSource
  }): DraftEvidenceFile
  listDraftFiles(draftFolderId: string): DraftEvidenceFile[]
  trashFile(fileId: string): void
}

export function uploadDraftEvidence(form: WebEvidenceUploadForm, ports: WebBookingPorts): DraftEvidenceFile
export function listDraftEvidence(input: AuthenticatedDraftInput, ports: WebBookingPorts): DraftEvidenceFile[]
export function removeDraftEvidence(input: AuthenticatedDraftFileInput, ports: WebBookingPorts): void
```

- [ ] **Step 1: Write failing upload tests**

```ts
it('uploads payment and chat files independently and restores them by Draft ID', () => {
  uploadDraftEvidence(upload('payment', 'payment-1'), ports)
  uploadDraftEvidence(upload('payment', 'payment-2'), ports)
  for (let index = 1; index <= 8; index += 1) uploadDraftEvidence(upload('chat', `chat-${index}`), ports)
  expect(listDraftEvidence(authDraft(), ports)).toHaveLength(10)
})

it('returns the same file for a retried upload ID', () => {
  expect(uploadTwice('chat-1').map((file) => file.fileId)).toEqual(['file-1', 'file-1'])
})

it('removes only a file owned by the authenticated draft', () => {
  expect(() => removeOtherDraftFile()).toThrow('draft evidence ownership mismatch')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webEvidence.test.ts`

Expected: FAIL because staged upload methods do not exist.

- [ ] **Step 3: Implement Drive draft folders and marker-based idempotency**

Create `PMC Booking Drafts/<draft-id>/payment` and `/chat` under the existing private root. Store `PMC_DRAFT:<draft-id>:<category>:<upload-id>` in the file description. Reuse a matching marker on retry. Never create public sharing.

The browser submits one mini `<form>` per file because an HTML Service form element must be the only `google.script.run` parameter. Put `sessionToken`, `draftId`, `uploadId`, and `category` in hidden inputs and one Blob-producing file input named `evidenceFile`. Never send more than one file in one RPC.

```ts
const marker = `PMC_DRAFT:${draftId}:${category}:${uploadId}`
const existing = findDraftFileByMarker(draftFolderId, marker)
if (existing) return existing
const file = folder.createFile(blob.getBlob()).setDescription(marker)
file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE)
return draftEvidenceFromFile(file, uploadId, category)
```

- [ ] **Step 4: Validate files before Drive writes**

Accept configured image MIME types only. Reject empty blobs and values above the configured per-file safety limit with safe user messages. Do not enforce a count limit. Sanitize filenames and never log the original filename with customer details.

Add `ConfigPort.allowedEvidenceMimeTypes(): string[]` and `ConfigPort.maxEvidenceBytes(): number`, backed by required `CONFIG_RULES` keys. Update the fake config in the same RED/GREEN cycle.

```ts
const blob = input.evidenceFile.getBlob()
const allowedMimeTypes = new Set(ports.config.allowedEvidenceMimeTypes())
if (!allowedMimeTypes.has(blob.getContentType())) throw new Error('unsupported evidence file type')
const size = blob.getBytes().length
if (size < 1 || size > ports.config.maxEvidenceBytes()) throw new Error('evidence file size is not allowed')
```

- [ ] **Step 5: Implement list, remove, and finalization compatibility**

Return stable sorted file records. `ensureCaseEvidenceFolder()` must accept these staged file IDs unchanged and preserve existing deterministic final names.

```ts
return drive.listDraftFiles(draftFolderId).sort((left, right) =>
  left.category.localeCompare(right.category) || left.uploadId.localeCompare(right.uploadId),
)
```

- [ ] **Step 6: Run targeted tests to verify GREEN**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webEvidence.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/workflows/webEvidence.ts \
  apps/pmc-google-booking-ops/src/config.ts \
  apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/src/adapters/googleDrive.ts \
  apps/pmc-google-booking-ops/tests/webEvidence.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts \
  apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
git commit -m "feat: stage PMC booking evidence uploads"
```

---

### Task 6: Google Calendar Occupancy Adapter and Availability Workflow

**Files:**
- Create: `apps/pmc-google-booking-ops/src/workflows/webAvailability.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts:22-72`
- Modify: `apps/pmc-google-booking-ops/src/config.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/tests/availability.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: active doctor/service, authenticated session, Web App rules from `CONFIG_RULES`, Calendar occupancy.
- Produces:

```ts
export interface CalendarPort {
  hasConflict(calendarId: string, start: string, end: string, excludeEventId?: string | null): boolean
  listOccupancy(
    calendarId: string,
    start: string,
    end: string,
    excludeEventId?: string | null,
  ): CalendarOccupancy[]
  createEvent(input: CalendarEventInput): string
  updateEvent(eventId: string, input: CalendarEventInput): void
}

export interface AvailabilityRequest {
  sessionToken: string
  doctorId: string
  serviceId: string
  date: string
  lateThrough?: string | null
}

export interface AvailabilityDay {
  doctorId: string
  serviceId: string
  date: string
  durationMinutes: number
  slots: SlotCandidate[]
  events: Array<CalendarOccupancy & { canRevealCustomer: boolean }>
}

export function readOccupancy(event: AdvancedCalendarEvent): CalendarOccupancy

export function getWebAvailability(
  request: AvailabilityRequest,
  ports: WebBookingPorts,
): AvailabilityDay
```

- [ ] **Step 1: Add failing adapter and workflow tests**

```ts
it('maps PMC private extended properties to a revealable case event', () => {
  expect(readOccupancy(pmcEvent)).toMatchObject({
    kind: 'CASE',
    caseId: 'PMC-202608-0001',
    customerName: 'ลูกค้าทดสอบ',
    phone: '0812345678',
  })
})

it('maps the machine hard-block marker to HARD_BLOCK', () => {
  expect(readOccupancy(hardBlockEvent).kind).toBe('HARD_BLOCK')
})

it('returns normal-hour slots and late slots only when requested', () => {
  expect(getWebAvailability(normalRequest, ports).slots.at(-1)?.start.slice(11, 16)).toBe('20:30')
  expect(getWebAvailability({ ...normalRequest, lateThrough: '23:30' }, ports).slots.at(-1)?.start.slice(11, 16)).toBe('23:30')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/availability.test.ts`

Expected: FAIL because the Google adapter still exposes only binary conflict and the workflow is missing.

- [ ] **Step 3: Implement bounded Calendar listing**

Request only the selected day's needed interval with `singleEvents: true`, `showDeleted: false`, and explicit fields. Map all-day hard blocks and date-time events safely. A PMC hard block uses private extended property `pmcBookingKind=HARD_BLOCK`; human titles alone are not authoritative.

Keep `hasConflict()` as a compatibility wrapper around `listOccupancy()` until Task 7 removes the last binary-overlap caller. This keeps Task 6 typecheck-green on its own.

```ts
const response = service().Events.list(calendarId, {
  timeMin: start,
  timeMax: end,
  timeZone: 'Asia/Bangkok',
  singleEvents: true,
  showDeleted: false,
  fields: 'items(id,summary,description,start,end,extendedProperties)',
})
return (response.items ?? []).map(readOccupancy)
```

- [ ] **Step 4: Implement customer-detail exposure rules**

Only events with a valid PMC Case ID private property may expose customer name/phone to an authenticated session. Other Calendar events return time and a generic occupied label.

```ts
const privateProperties = event.extendedProperties?.private ?? {}
const kind = privateProperties.pmcBookingKind === 'HARD_BLOCK'
  ? 'HARD_BLOCK'
  : privateProperties.caseId
    ? 'CASE'
    : 'OTHER'
return {
  eventId: requiredEventId(event),
  start: eventStart(event),
  end: eventEnd(event),
  kind,
  caseId: kind === 'CASE' ? privateProperties.caseId : null,
  customerName: kind === 'CASE' ? parsePmcCustomer(event) : null,
  phone: kind === 'CASE' ? parsePmcPhone(event) : null,
  serviceLabel: kind === 'CASE' ? parsePmcService(event) : null,
}
```

- [ ] **Step 5: Read Web App rules from `CONFIG_RULES`**

Expose exact typed getters for:

```ts
webAppEnabled(): boolean
clinicOpenTime(): string // 10:30
clinicCloseTime(): string // 20:30
slotIntervalMinutes(): number // 30
normalConcurrentCapacity(): number // 2
rememberDeviceDays(): number // 30
draftRetentionHours(): number // 24
```

Reject missing/invalid rule values; do not silently invent production defaults after setup.

- [ ] **Step 6: Run targeted tests to verify GREEN**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/availability.test.ts apps/pmc-google-booking-ops/tests/webDraft.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/workflows/webAvailability.ts \
  apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts \
  apps/pmc-google-booking-ops/src/config.ts \
  apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/tests/availability.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: expose doctor availability for PMC Web App"
```

---

### Task 7: Atomic Capacity Reservation and Shared Submission Workflow

**Files:**
- Create: `apps/pmc-google-booking-ops/src/workflows/webSubmit.ts`
- Create: `apps/pmc-google-booking-ops/tests/webSubmit.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts:19-323`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts:117-179`
- Modify: `apps/pmc-google-booking-ops/src/repositories.ts:59-159`
- Modify: `apps/pmc-google-booking-ops/tests/formSubmit.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/endToEnd.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: confirmed draft fields, evidence IDs, capacity classifier, reentrant lock, existing `submitBookingIntake` downstream workflow.
- Produces:

```ts
export type CapacityMode = 'FORM_FALLBACK' | 'WEB_NORMAL' | 'WEB_SPECIAL'

export interface SubmitBookingOptions {
  capacityMode: CapacityMode
  expectedDraftId?: string | null
}

export type WebSubmitResult =
  | { status: 'CONFIRMED'; caseId: string; capacityStatus: 'NORMAL' | 'SPECIAL' }
  | { status: 'SPECIAL_CONFIRMATION_REQUIRED'; decision: CapacityDecision }
  | { status: 'HARD_BLOCKED'; blockingEventIds: string[] }

type ReserveBookingResult =
  | { status: 'RESERVED'; booking: BookingCase }
  | { status: 'SPECIAL_CONFIRMATION_REQUIRED'; decision: CapacityDecision }
  | { status: 'HARD_BLOCKED'; blockingEventIds: string[] }

export function submitBookingIntake(
  intake: BookingIntake,
  ports: BookingPorts,
  options?: SubmitBookingOptions,
): BookingCase

export function submitWebBooking(input: {
  sessionToken: string
  draftId: string
  requestNonce: string
  confirmSpecial: boolean
}, ports: WebBookingPorts): WebSubmitResult
```

- [ ] **Step 1: Write failing race, special, and idempotency tests**

```ts
it('rechecks capacity and returns confirmation-required before creating a Web case', () => {
  const result = submitWebBooking(webSubmit({ confirmSpecial: false }), fullCapacityPorts)
  expect(result.status).toBe('SPECIAL_CONFIRMATION_REQUIRED')
  expect(fullCapacityPorts.bookings.list()).toEqual([])
})

it('creates exactly one SPECIAL case after explicit confirmation', () => {
  const first = submitWebBooking(webSubmit({ confirmSpecial: true }), fullCapacityPorts)
  const second = submitWebBooking(webSubmit({ confirmSpecial: true }), fullCapacityPorts)
  expect(first).toEqual(second)
  expect(fullCapacityPorts.bookings.list()).toHaveLength(1)
})

it('serializes two normal submissions so the second sees the first Calendar event', () => {
  submitWebBooking(firstDraft, ports)
  const second = submitWebBooking(secondDraft, ports)
  expect(second.status).toBe('CONFIRMED')
  expect(ports.bookings.list().map((item) => item.capacityStatus)).toEqual(['NORMAL', 'NORMAL'])
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webSubmit.test.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts`

Expected: FAIL because Web submit and capacity modes do not exist.

- [ ] **Step 3: Make the runtime lock adapter reentrant within one execution**

Extract a pure helper around `LockService` with an execution-local depth counter:

```ts
export function createReentrantLockPort(acquire: () => void, release: () => void): LockPort {
  let depth = 0
  return {
    withLock(operation) {
      if (depth > 0) return operation()
      acquire()
      depth += 1
      try { return operation() } finally { depth -= 1; release() }
    },
  }
}
```

Add tests proving nested calls acquire and release the underlying lock once.

- [ ] **Step 4: Split canonical reservation from downstream completion**

Refactor `submitBookingIntake` into focused internal units:

```ts
function reserveBookingAndCalendar(
  intake: BookingIntake,
  options: SubmitBookingOptions,
  ports: BookingPorts,
): ReserveBookingResult

export function completeBookingOutputs(
  booking: BookingCase,
  intake: BookingIntake,
  ports: BookingPorts,
): BookingCase
```

`reserveBookingAndCalendar` runs under one reentrant script lock and performs final capacity read, accepted raw-intake append, sequence allocation, canonical insert, response mapping, and Calendar creation/update before releasing the lock. Drive finalization, call task, LINE, and retry handling run after the lock through `completeBookingOutputs`.

- [ ] **Step 5: Implement capacity modes**

- `WEB_NORMAL`: return confirmation-required before any canonical write when full.
- `WEB_SPECIAL`: allow `SPECIAL`, reject hard block.
- `FORM_FALLBACK`: preserve a `TIME_CONFLICT` record and Admin-only alert when capacity is full; never silently create special.
- All modes reject hard block before doctor LINE.
- Calls that omit `SubmitBookingOptions` default to `FORM_FALLBACK` so the existing Form entrypoint remains source-compatible.
- Remove `CalendarPort.hasConflict()` and its fake implementation after every submission/retry caller uses `listOccupancy()` plus `classifyCapacity()`.

```ts
const decision = classifyCapacity(capacityInput(intake, occupancy, ports.config))
if (decision.classification === 'HARD_BLOCKED') return { status: 'HARD_BLOCKED', blockingEventIds: decision.blockingEventIds }
if (decision.classification === 'SPECIAL' && options.capacityMode === 'WEB_NORMAL') {
  return { status: 'SPECIAL_CONFIRMATION_REQUIRED', decision }
}
if (decision.classification === 'SPECIAL' && options.capacityMode === 'FORM_FALLBACK') {
  return reserveTimeConflictCase(intake, decision, ports)
}
const capacityStatus = decision.classification === 'SPECIAL' ? 'SPECIAL' : 'NORMAL'
```

- [ ] **Step 6: Implement Web Draft finalization**

Validate session ownership, active draft, request nonce, field values, payment evidence ≥1, chat evidence ≥1, and all upload states. Set draft `CONFIRMING`, then call shared submission with deterministic `WEBAPP:<draft-id>`. Build the technical `submitterEmail` from `ConfigPort.sharedAccountEmail()` and resolve the selected closer by name whenever `intakeSource = PMC_WEB_APP`; the email is not performance attribution. Append raw intake only after the locked capacity decision is accepted and before the canonical insert. Mark the draft `CONFIRMED` with Case ID. If the Case ID already exists, return it without another external write.

Extend `ConfigPort` with `sharedAccountEmail(): string`; never hardcode the address in source.

When Calendar creation is queued for retry, include the evidence IDs and a `resumeOutputs` marker in the retry payload. After Calendar retry succeeds, call the idempotent `completeBookingOutputs` path so Drive finalization, call task, and LINE are not stranded.

```ts
const intake = webDraftToBookingIntake(draft, evidence, {
  formResponseId: `WEBAPP:${draft.draftId}`,
  submitterEmail: ports.config.sharedAccountEmail(),
  intakeSource: 'PMC_WEB_APP',
})
const result = reserveBookingAndCalendar(intake, options, ports)
if (result.status !== 'RESERVED') return result
return finalizeConfirmedDraft(draft, completeBookingOutputs(result.booking, intake, ports), ports)
```

- [ ] **Step 7: Run targeted tests to verify GREEN**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webSubmit.test.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/pmc-google-booking-ops/src/workflows/webSubmit.ts \
  apps/pmc-google-booking-ops/src/workflows/formSubmit.ts \
  apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/src/repositories.ts \
  apps/pmc-google-booking-ops/tests/webSubmit.test.ts \
  apps/pmc-google-booking-ops/tests/formSubmit.test.ts \
  apps/pmc-google-booking-ops/tests/endToEnd.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: submit PMC Web App bookings atomically"
```

---

### Task 8: Special Queue Calendar and LINE Presentation

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/ports.ts:159-167`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts:4-49`
- Modify: `apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts:4-333`
- Modify: `apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts:72-147`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts:290-300`
- Modify: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts:63-103,128-183`
- Modify: `apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: `booking.capacityStatus` and `booking.capacityCountAtSubmit`.
- Produces: Calendar color/metadata and Flex marker with no new LINE route or audience.

- [ ] **Step 1: Write failing presentation tests**

```ts
it('uses orange Calendar treatment and private capacity metadata for a special queue', () => {
  expect(calendarEventInput(bookingFixture({ capacityStatus: 'SPECIAL' }))).toMatchObject({
    colorId: '6',
    privateProperties: {
      pmcBookingKind: 'CASE',
      capacityStatus: 'SPECIAL',
    },
  })
})

it('shows คิวพิเศษ in both Admin and doctor Flex without exposing evidence to doctors', () => {
  const booking = bookingFixture({ capacityStatus: 'SPECIAL' })
  expect(visibleFlexText(buildAdminMinimalReceipt(booking, evidence, logo))).toContain('คิวพิเศษ')
  expect(visibleFlexText(buildDoctorMinimalReceipt(booking, 'BOOKING_CONFIRMED', logo))).toContain('คิวพิเศษ')
  expect(JSON.stringify(buildDoctorMinimalReceipt(booking, 'BOOKING_CONFIRMED', logo))).not.toContain('media.test')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`

Expected: FAIL because special presentation is missing.

- [ ] **Step 3: Implement Calendar metadata**

- Normal event color remains `5`.
- Special event color is `6`.
- Extend `CalendarEventInput` with `privateProperties: Record<string, string>`.
- Private extended properties include `caseId`, `pmcBookingKind=CASE`, and `capacityStatus`.
- Description includes `คิวพิเศษ` only for special bookings.

```ts
return {
  ...baseCalendarInput(booking),
  colorId: booking.capacityStatus === 'SPECIAL' ? '6' : '5',
  description: booking.capacityStatus === 'SPECIAL'
    ? `${baseDescription(booking)}\nคิวพิเศษ`
    : baseDescription(booking),
  privateProperties: {
    caseId: booking.caseId,
    pmcBookingKind: 'CASE',
    capacityStatus: booking.capacityStatus,
  },
}
```

- [ ] **Step 4: Implement the orange Flex marker**

Add one compact orange warning band near the appointment details. Preserve the approved clean white Minimal Receipt, full operational customer details for mapped groups, evidence only in Admin Flex, and no visible Case ID.

```ts
function specialQueueBanner(booking: BookingCase): FlexComponent[] {
  return booking.capacityStatus === 'SPECIAL'
    ? [{
        type: 'box', layout: 'vertical', backgroundColor: '#FFF0E3', cornerRadius: 'md',
        paddingAll: '10px', contents: [{ type: 'text', text: 'คิวพิเศษ', color: '#A95618', weight: 'bold' }],
      }]
    : []
}
```

- [ ] **Step 5: Make Calendar retry use the shared capacity mode**

Calendar retry for a reserved special booking must not downgrade or reject it merely because normal capacity is full. It still rejects a hard block that appeared before event creation and records a safe retry failure. When a retry payload has `resumeOutputs = true`, successful Calendar creation immediately resumes the idempotent Drive, call-task, and LINE completion path using the stored evidence IDs.

```ts
const decision = classifyCapacity(retryCapacityInput(booking, occupancy))
if (decision.classification === 'HARD_BLOCKED') throw new Error('Calendar retry blocked by doctor hard block')
const calendarEventId = ensureDoctorCalendarEvent(booking, ports.calendar)
if (payload.resumeOutputs) completeBookingOutputs(updatedBooking(calendarEventId), retryIntake(payload), ports)
```

- [ ] **Step 6: Run targeted tests to verify GREEN**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts \
  apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts \
  apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts \
  apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts \
  apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: mark PMC special booking queues"
```

---

### Task 9: Apps Script Web App Entrypoints and Build Output

**Files:**
- Create: `apps/pmc-google-booking-ops/src/adapters/appsScriptHtml.ts`
- Create: `apps/pmc-google-booking-ops/src/web/client.ts`
- Create: `apps/pmc-google-booking-ops/src/web/googleScriptRun.d.ts`
- Create: `apps/pmc-google-booking-ops/web/Index.html`
- Create: `apps/pmc-google-booking-ops/web/styles.css`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts:1-64`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs:1-35`
- Modify: `apps/pmc-google-booking-ops/tests/build.test.ts:6-48`
- Modify: `apps/pmc-google-booking-ops/appsscript.json`

**Interfaces:**
- Consumes: auth, draft, evidence, availability, submit workflows.
- Produces top-level Apps Script functions:

```ts
doGet(event)
webLogin(input)
webLogout(input)
webBootstrap(input)
webCreateDraft(input)
webSaveDraft(input)
webAvailability(input)
webUploadEvidence(formObject)
webListEvidence(input)
webRemoveEvidence(input)
webSubmitBooking(input)
```

Every function except `doGet` and `webLogin` validates a session token. `doGet` returns only the login shell and static assets; no operational data is rendered into the template.

- [ ] **Step 1: Write failing build-contract tests**

```ts
it('exports Web App RPC entrypoints and copies HTML assets', () => {
  execFileSync('npm', ['run', 'booking:build'], { stdio: 'pipe' })
  const sandbox = evaluateBundle()
  expect(sandbox.doGet).toBeTypeOf('function')
  expect(sandbox.webLogin).toBeTypeOf('function')
  expect(sandbox.webSubmitBooking).toBeTypeOf('function')
  expect(readFileSync('apps/pmc-google-booking-ops/dist/Index.html', 'utf8')).toContain('PMC Booking')
  expect(readFileSync('apps/pmc-google-booking-ops/dist/Styles.html', 'utf8')).toContain('<style>')
  expect(readFileSync('apps/pmc-google-booking-ops/dist/Client.html', 'utf8')).toContain('<script>')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/build.test.ts`

Expected: FAIL because the Web App entrypoints and assets do not exist.

- [ ] **Step 3: Implement HTML shell adapter**

```ts
export function renderBookingWebApp(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('PMC Booking')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
}

export function includeWebAsset(name: 'Styles' | 'Client'): string {
  return HtmlService.createHtmlOutputFromFile(name).getContent()
}
```

Do not use `ALLOWALL` framing. The production page is opened directly, including from the LINE in-app browser.

- [ ] **Step 4: Add thin entrypoint wrappers**

Entrypoints parse JSON-compatible payloads, call workflows, return plain JSON-compatible data, and map expected domain errors to stable codes. They do not contain business rules.

```ts
export function webAvailability(input: AvailabilityRequest) {
  return safeWebRpc(() => getWebAvailability(input, createWebRuntime()))
}

export function webSubmitBooking(input: WebSubmitInput) {
  return safeWebRpc(() => submitWebBooking(input, createWebRuntime()))
}
```

Refactor runtime construction so `createRuntime()` and `createWebRuntime()` share one internal context (properties, spreadsheet, store, clock, crypto, lock) rather than opening separate stores. `createWebRuntime()` adds `sessions`, `drafts`, `webRawIntake`, throttle, and hashed-secret getters required by `WebBookingPorts`.

- [ ] **Step 5: Extend the build script**

- Bundle server TypeScript to `dist/Code.js` as today.
- Bundle `src/web/client.ts` to browser IIFE text and wrap as `dist/Client.html`.
- Wrap `web/styles.css` as `dist/Styles.html`.
- Copy `web/Index.html` and `appsscript.json`.
- Include all RPC wrappers in the Code.js footer.
- Keep `doPost` and all five existing production triggers exported.

At this task boundary `src/web/client.ts` contains only the typed `google.script.run` Promise adapter and login-shell bootstrap. Task 10 expands it into the approved four-step interface.

```js
const clientBundle = await build({
  bundle: true,
  entryPoints: [resolve(packageRoot, 'src/web/client.ts')],
  format: 'iife',
  platform: 'browser',
  write: false,
})
await writeFile(resolve(outputDirectory, 'Client.html'), `<script>${clientBundle.outputFiles[0].text}</script>`)
await writeFile(resolve(outputDirectory, 'Styles.html'), `<style>${await readFile(stylesSource, 'utf8')}</style>`)
```

- [ ] **Step 6: Run build and type checks**

Run: `npm run booking:typecheck && npm run booking:build && npx vitest run apps/pmc-google-booking-ops/tests/build.test.ts`

Expected: PASS; `dist/` contains exactly the intended Apps Script `.js`, `.json`, and `.html` files.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/adapters/appsScriptHtml.ts \
  apps/pmc-google-booking-ops/src/web/client.ts \
  apps/pmc-google-booking-ops/src/web/googleScriptRun.d.ts \
  apps/pmc-google-booking-ops/web/Index.html \
  apps/pmc-google-booking-ops/web/styles.css \
  apps/pmc-google-booking-ops/src/entrypoints.ts \
  apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/scripts/build.mjs \
  apps/pmc-google-booking-ops/tests/build.test.ts \
  apps/pmc-google-booking-ops/appsscript.json
git commit -m "feat: expose PMC booking Apps Script Web App"
```

---

### Task 10: Mobile Client State and Approved Four-Step UI

**Files:**
- Create: `apps/pmc-google-booking-ops/src/web/state.ts`
- Modify: `apps/pmc-google-booking-ops/src/web/client.ts`
- Create: `apps/pmc-google-booking-ops/tests/webClientState.test.ts`
- Modify: `apps/pmc-google-booking-ops/web/Index.html`
- Modify: `apps/pmc-google-booking-ops/web/styles.css`
- Modify: `apps/pmc-google-booking-ops/tests/build.test.ts`

**Interfaces:**
- Consumes: plain JSON Web App RPC functions from Task 9.
- Produces:

```ts
export type BookingWebStep = 'DETAILS' | 'CALENDAR' | 'EVIDENCE' | 'REVIEW' | 'SUCCESS'

export interface PendingUpload {
  uploadId: string
  category: 'payment' | 'chat'
  fileName: string
  status: 'QUEUED' | 'UPLOADING' | 'FAILED' | 'DONE'
  progress: number
  safeError: string | null
}

export type BookingWebAction =
  | { type: 'AUTHENTICATED'; sessionToken: string; draftId: string | null }
  | { type: 'DRAFT_LOADED'; draft: WebDraftPayload }
  | { type: 'AVAILABILITY_LOADED'; availability: AvailabilityDay }
  | { type: 'UPLOAD_QUEUED'; upload: PendingUpload }
  | { type: 'UPLOAD_PROGRESS'; uploadId: string; progress: number }
  | { type: 'UPLOAD_FAILED'; uploadId: string; safeError: string }
  | { type: 'UPLOAD_DONE'; uploadId: string; file: DraftEvidenceFile }
  | { type: 'SPECIAL_REQUIRED'; decision: CapacityDecision }
  | { type: 'SUBMIT_STARTED' }
  | { type: 'SUBMIT_DONE'; caseId: string }
  | { type: 'SIGNED_OUT' }

export interface BookingWebState {
  auth: 'CHECKING' | 'SIGNED_OUT' | 'SIGNED_IN'
  sessionToken: string | null
  draftId: string | null
  step: BookingWebStep
  draft: WebDraftPayload
  availability: AvailabilityDay | null
  uploads: DraftEvidenceFile[]
  pendingUploads: PendingUpload[]
  submitState: 'IDLE' | 'CHECKING' | 'SPECIAL_CONFIRMATION' | 'SUBMITTING' | 'DONE'
  errorCode: string | null
}

export function reduceBookingWebState(
  state: BookingWebState,
  action: BookingWebAction,
): BookingWebState

export function persistedClientState(state: BookingWebState): {
  sessionToken: string | null
  draftId: string | null
}

export function canEnterReview(state: BookingWebState): boolean
```

- [ ] **Step 1: Write failing client-state tests**

```ts
it('keeps customer PII out of local persistence', () => {
  const persisted = persistedClientState(stateWithCustomer())
  expect(persisted).toEqual({ sessionToken: 'token', draftId: 'draft-1' })
})

it('does not enter review until every queued upload is complete', () => {
  expect(canEnterReview(stateWithOnePendingUpload())).toBe(false)
})

it('opens explicit special confirmation instead of submitting silently', () => {
  const next = reduceBookingWebState(state, { type: 'SPECIAL_REQUIRED', decision })
  expect(next.submitState).toBe('SPECIAL_CONFIRMATION')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webClientState.test.ts`

Expected: FAIL because client state does not exist.

- [ ] **Step 3: Implement the state reducer and RPC runner**

Use one centralized `google.script.run` Promise adapter with success/failure handlers. Persist only `sessionToken` and `draftId`. Debounce draft saves at step boundaries, not on every keystroke. Queue at most two file uploads concurrently and retain retryable failed items.

```ts
function rpc<T>(method: keyof GoogleScriptRpc, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: T) => resolve(result))
      .withFailureHandler((error: Error) => reject(new Error(error.message)))
      [method](payload)
  })
}

export function persistedClientState(state: BookingWebState) {
  return { sessionToken: state.sessionToken, draftId: state.draftId }
}
```

- [ ] **Step 4: Implement the approved mobile views**

1. Login with PIN and `จำอุปกรณ์นี้ 30 วัน`.
2. Details with closer, AE, customer, phone, doctor, service, channel.
3. Calendar B: month grid, selected-day list, capacity text, late-time control, special confirmation, hard block.
4. Deposit and evidence queue with multiple payment/chat files, previews, remove, progress, retry.
5. Review and success state with Case ID and downstream state summary.

Use native `<form>`, `<button>`, `<select>`, labels, fieldsets, and live regions. Do not simulate controls with clickable divs.

```html
<main id="app" tabindex="-1">
  <section id="login-view" hidden></section>
  <form id="details-view" hidden></form>
  <section id="calendar-view" hidden></section>
  <section id="evidence-view" hidden></section>
  <section id="review-view" hidden></section>
  <section id="success-view" hidden></section>
  <div id="polite-status" class="visually-hidden" aria-live="polite"></div>
  <div id="assertive-status" class="visually-hidden" aria-live="assertive"></div>
</main>
```

- [ ] **Step 5: Apply approved Thai design tokens**

```css
:root {
  --color-bg: #ffffff;
  --color-text: #25221f;
  --color-muted: #756f68;
  --color-line: #e8e4de;
  --color-gold: #b88832;
  --color-special: #a95618;
  --lh-display: 1.2;
  --lh-heading: 1.3;
  --lh-body: 1.7;
}
```

- Thai body uses IBM Plex Sans Thai Looped and line-height 1.6–1.8.
- Thai headings use IBM Plex Sans Thai and line-height 1.2–1.35.
- Never apply letter-spacing to Thai.
- Controls use at least 1rem text and 48px tap height.
- Capacity uses text plus color.
- No gradients, hero image, mascot, nested card grid, or decorative status filler.

- [ ] **Step 6: Run client and build tests**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webClientState.test.ts apps/pmc-google-booking-ops/tests/build.test.ts && npm run booking:typecheck && npm run booking:build`

Expected: PASS.

- [ ] **Step 7: Browser verification at mobile size**

Serve the built HTML through a local Apps Script-compatible fixture or thin local test harness. Verify 390×844 and desktop. Exercise login, details validation, month navigation, normal slot, full slot, hard block, multiple uploads, retry, review, duplicate submit, and success. Capture screenshots and inspect them with `view_image` before accepting the task.

- [ ] **Step 8: Commit**

```bash
git add apps/pmc-google-booking-ops/src/web/state.ts \
  apps/pmc-google-booking-ops/src/web/client.ts \
  apps/pmc-google-booking-ops/web/Index.html \
  apps/pmc-google-booking-ops/web/styles.css \
  apps/pmc-google-booking-ops/tests/webClientState.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
git commit -m "feat: build PMC mobile booking flow"
```

---

### Task 11: Draft Cleanup, Setup Workflow, and Operational Runbook

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/workflows/webDraft.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts:181-187,337-488`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/config.ts`
- Modify: `apps/pmc-google-booking-ops/tests/webDraft.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/build.test.ts`
- Create: `apps/pmc-google-booking-ops/docs/web-app-pilot-runbook.md`
- Modify: `apps/pmc-google-booking-ops/docs/setup.md`

**Interfaces:**
- Consumes: expired drafts, draft Drive folders, config rules, feature flag, PIN setup properties.
- Produces:

```ts
export function cleanupExpiredWebDrafts(ports: WebBookingPorts): {
  expiredDrafts: number
  trashedFolders: number
}

export function preparePmcBookingWebApp(): {
  sheetsReady: boolean
  rulesReady: boolean
  pinHashReady: boolean
  sessionSecretReady: boolean
  webAppEnabled: boolean
}
```

- [ ] **Step 1: Write failing cleanup and setup tests**

```ts
it('trashes only expired unconfirmed draft folders and records sanitized audit', () => {
  const result = cleanupExpiredWebDrafts(ports)
  expect(result).toEqual({ expiredDrafts: 1, trashedFolders: 1 })
  expect(ports.drive.trashedFolderIds()).toEqual(['draft-folder-expired'])
})

it('never cleans a confirmed draft through the 24-hour draft policy', () => {
  cleanupExpiredWebDrafts(ports)
  expect(ports.drive.trashedFolderIds()).not.toContain('draft-folder-confirmed')
})
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/webDraft.test.ts apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts`

Expected: FAIL because cleanup/setup workflows are missing.

- [ ] **Step 3: Implement cleanup**

Create one dedicated hourly trigger with `ensureClockTrigger('cleanupExpiredWebDrafts', builder => builder.everyHours(1).create())`. Mark the draft `EXPIRED`, trash its draft folder, remove protected draft payload, and append a sanitized existing-audit record with `caseId = WEBAPP_DRAFT:<draft-id>` and no filenames or PII. Update setup/build tests to expect six production triggers after Web App setup.

```ts
for (const draft of ports.drafts.listExpired(ports.clock.nowIso())) {
  if (draft.status === 'CONFIRMED') continue
  ports.drafts.update(draft.draftId, draft.version, { status: 'EXPIRED' })
  const folderId = ports.drive.findDraftFolder(draft.draftId)
  if (folderId) ports.drive.trashFolder(folderId)
  ports.repositories.audit.append(sanitizedDraftCleanupAudit(draft, ports.clock.nowIso()))
  ports.drafts.remove(draft.draftId)
}
```

- [ ] **Step 4: Implement setup readiness without generating secrets in logs**

`preparePmcBookingWebApp()` creates/migrates only after backup, validates all required rules and hashed secrets, confirms the existing Form remains available, and leaves `PMC_WEBAPP_ENABLED=false`. It returns booleans only.

```ts
return {
  sheetsReady: requiredWebTabs.every((tab) => spreadsheet.getSheetByName(tab)),
  rulesReady: validateWebRules(runtime.config),
  pinHashReady: Boolean(properties[webAppPinHash]),
  sessionSecretReady: Boolean(properties[webAppSessionSecret]),
  webAppEnabled: runtime.config.webAppEnabled(),
}
```

Document manager revocation through the protected `WEBAPP_SESSIONS` tab: setting `revokedAt` to a current ISO timestamp revokes one device; the PIN-rotation workflow revokes all devices.

- [ ] **Step 5: Write the pilot runbook**

Include exact operator checkpoints:

1. verify authenticated Apps Script owner;
2. create daily Sheet backup;
3. run schema migration and inspect row/column counts;
4. configure rules;
5. set temporary PIN setup property, run hash-and-delete workflow, verify plaintext removed;
6. create a new Web App deployment URL without changing LINE deployment;
7. run read-only Calendar pilot;
8. run test-mode evidence uploads;
9. enable one-device pilot only after owner approval;
10. rollback by disabling feature flag and using Form;
11. verify no tokens/PII in execution logs.

- [ ] **Step 6: Run tests and docs checks**

Run: `npm run booking:test && npm run booking:typecheck && npm run booking:build && git diff --check`

Expected: PASS with zero test failures and no whitespace errors.

- [ ] **Step 7: Commit**

```bash
git add apps/pmc-google-booking-ops/src/workflows/webDraft.ts \
  apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/src/entrypoints.ts \
  apps/pmc-google-booking-ops/src/config.ts \
  apps/pmc-google-booking-ops/tests/webDraft.test.ts \
  apps/pmc-google-booking-ops/tests/dashboardIntegrityRetention.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts \
  apps/pmc-google-booking-ops/docs/web-app-pilot-runbook.md \
  apps/pmc-google-booking-ops/docs/setup.md
git commit -m "docs: add PMC Web App pilot controls"
```

---

### Task 12: Full Regression, Security Review, and Pilot Artifact

**Files:**
- Modify: `apps/pmc-google-booking-ops/tests/endToEnd.test.ts`
- Modify: `apps/pmc-google-booking-ops/docs/web-app-pilot-runbook.md`
- Create for local verification: ignored screenshots under `.codex-tmp/pmc-booking-web-app-qa/`

**Interfaces:**
- Consumes: all completed tasks and the approved spec.
- Produces: a tested build and a read-only pilot handoff. It does not change live Google state.

- [ ] **Step 1: Add one complete end-to-end normal booking test**

Exercise login → draft → details → availability → multiple payment/chat files → normal submit → canonical Sheet → final Drive names → Calendar event → Admin/doctor LINE → call queue.

```ts
it('completes the full normal Web App booking flow', () => {
  const session = loginWebApp(validLogin(), ports)
  const draft = createAndFillDraft(session.sessionToken, ports)
  uploadManyEvidence(session.sessionToken, draft.draftId, { payment: 2, chat: 8 }, ports)
  const result = submitWebBooking(confirmInput(session.sessionToken, draft.draftId), ports)
  expect(result).toMatchObject({ status: 'CONFIRMED', capacityStatus: 'NORMAL' })
  expect(ports.drive.movedFileCount()).toBe(10)
  expect(ports.calendar.createdEvents()).toHaveLength(1)
  expect(ports.line.adminMessages()).toHaveLength(1)
  expect(ports.line.doctorMessages()).toHaveLength(1)
  expect(ports.calls.list()).toHaveLength(1)
})
```

- [ ] **Step 2: Add one complete special and one hard-block test**

- Special: two existing overlapping events, first response requires confirmation, second explicit response creates one `SPECIAL` case and orange outputs.
- Hard block: no Case ID, folder, event, LINE message, or call task.

```ts
expect(submitWebBooking(normalAttempt, fullPorts).status).toBe('SPECIAL_CONFIRMATION_REQUIRED')
expect(submitWebBooking(specialConfirmation, fullPorts)).toMatchObject({
  status: 'CONFIRMED', capacityStatus: 'SPECIAL',
})

expect(submitWebBooking(hardBlockedAttempt, blockedPorts).status).toBe('HARD_BLOCKED')
expect(blockedPorts.bookings.list()).toEqual([])
expect(blockedPorts.line.adminMessages()).toEqual([])
```

- [ ] **Step 3: Run the full booking suite**

Run: `npm run booking:test`

Expected: all test files pass with zero failed tests.

- [ ] **Step 4: Run static/build verification**

Run: `npm run booking:typecheck && npm run booking:build && git diff --check`

Expected: exit code 0 for every command.

- [ ] **Step 5: Inspect the generated Apps Script artifact**

Verify:

- old and new top-level functions exist;
- HTML files contain no real IDs, PINs, tokens, customer names, or fallback credentials;
- manifest scopes are the minimum already required by the approved workflows;
- `doPost` LINE behavior remains present;
- no `structuredClone()` exists in the Apps Script bundle;
- no client source persists customer PII in localStorage/sessionStorage.

- [ ] **Step 6: Perform browser and accessibility QA**

Use Browser/IAB with the local test harness. Check 390×844, iPhone-like safe areas, desktop, keyboard-only navigation, 200% zoom, Thai marks (`น้ำ ที่ ปั๊ม`), reduced motion, upload queue overflow, and LINE in-app browser behavior. Capture the approved concept and latest implementation screenshots; inspect both with `view_image` and write a five-point fidelity ledger.

- [ ] **Step 7: Security review checklist**

- PIN hash only; temporary plaintext setup value deleted.
- Raw session tokens absent from Sheet/logs.
- Every RPC validates session ownership.
- Rate limiting works.
- Draft/customer data absent from URLs and browser storage.
- Draft Drive folders private.
- Upload ownership and MIME/size checks enforced server-side.
- Nonces and Draft IDs prevent duplicate mutations.
- Hard block cannot be special-overridden.
- Feature flag blocks mutations.
- National ID absent.

- [ ] **Step 8: Commit verification changes**

```bash
git add apps/pmc-google-booking-ops/tests/endToEnd.test.ts \
  apps/pmc-google-booking-ops/docs/web-app-pilot-runbook.md
git commit -m "test: verify PMC booking Web App flow"
```

- [ ] **Step 9: Stop at the production gate**

Report:

- fresh test count;
- typecheck/build result;
- browser viewport and interaction evidence;
- spec deviations, if any;
- worktree/commit state;
- exact proposed Google changes: backup, Sheet migration, Script Properties readiness, new deployment, read-only Calendar pilot, and feature flag remaining off.

Ask for explicit production approval. Do not run `clasp push`, migration, PIN setup, deployment creation, or feature-flag enablement in this task.

---

## Execution Completion Criteria

Implementation is ready for the separate production-approval turn only when:

1. every task commit is present and scoped;
2. all booking tests pass fresh;
3. typecheck and build pass fresh;
4. mobile/browser QA has screenshots and a fidelity ledger;
5. no real secrets, IDs, or PII appear in source, artifacts, tests, or logs;
6. Google Form fallback remains intact;
7. existing LINE webhook and trigger entrypoints remain intact;
8. feature flag is still off; and
9. the owner receives an exact, reversible live-change checklist.
