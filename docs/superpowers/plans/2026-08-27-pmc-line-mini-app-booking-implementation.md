# PMC LINE Mini App Platform and Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the internal LINE Mini App platform and a production-safe booking wizard that reuses the existing Google Sheet booking workflow while keeping Google Form as fallback.

**Architecture:** Add a dedicated React Mini App bundle and an isolated Cloud Run router. Verify LINE identity server-side, authorize against `CONFIG_STAFF`, persist drafts and idempotency in Sheets, upload bounded evidence to private Drive with keyless service identity, and confirm bookings through a signed Apps Script ingress that calls the existing booking domain.

**Tech Stack:** React 19, TypeScript 6, Vite 8, `@line/liff` 2.30, Node HTTP server, `googleapis`, Busboy, Google Cloud Run, Secret Manager, Google Sheets/Drive, Apps Script, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-pmc-line-mini-app-jera-reporting-design.md`

## Global Constraints

- Version 1 contains only internal booking and JERA reporting; this plan implements the shared platform and booking half.
- Google `BOOKING_MASTER` remains canonical; browser JavaScript never writes Sheet, Drive, Calendar, LINE, or JERA directly.
- Google Form remains published and operational as pilot fallback.
- Support both `NORMAL` and `AUTO` queue modes without changing existing scheduling rules.
- Admin identity comes from verified LINE identity and an active `CONFIG_STAFF` mapping; no PIN or repeated email.
- AE remains selectable, including `ไม่ระบุ` and same-as-Admin.
- Evidence accepts 1-10 JPEG/PNG files per kind, maximum 10 MB each.
- Cloud Run uses keyless service identity; no service-account key file.
- No JERA write is introduced by this plan.
- Never place LINE ID tokens, JERA credentials, unrestricted Drive URLs, Google credentials, or signing secrets in bundles, logs, Sheets, fixtures, or error responses.
- Every confirmation is idempotent by immutable `requestId` and payload hash.
- Existing Booking, OCR, Meta, page automation, health, Calendar, Drive, LINE, retry, call queue, and Dashboard routes must remain isolated.
- Do not deploy, mutate Rich Menu, share Drive/Sheet permissions, create secrets, or submit production bookings without a fresh explicit owner gate.

---

## File Structure

### New client bundle

```text
src/apps/pmc-mini-app/
  index.html                 static entry only
  main.tsx                   React bootstrap
  PmcMiniApp.tsx             route/state composition
  api.ts                     LIFF initialization and typed HTTP client
  contracts.ts               client-safe request/response types
  bookingModel.ts            pure wizard reducer and client validation
  BookingWizard.tsx          booking steps and preview
  Home.tsx                   two-card home shell
  styles.css                 Thai mobile design system
```

### New server modules

```text
server/pmc-mini-app/
  config.ts                  strict environment parsing
  lineIdentity.ts            raw ID-token verification
  contracts.ts               server-only authenticated types
  bookingDraft.ts            validation/state transitions/payload hash
  googleClient.ts            keyless Sheets/Drive ports
  store.ts                   MINI_APP_REQUESTS persistence
  evidence.ts                image validation and private Drive upload
  bookingIngressClient.ts    signed Apps Script request client
  middleware.ts              Mini App HTTP API
  runtime.ts                 dependency construction, fail closed
```

### Shared and Apps Script changes

```text
shared/pmcMiniAppBooking.ts
apps/pmc-google-booking-ops/src/domain/miniAppIngress.ts
apps/pmc-google-booking-ops/src/workflows/miniAppSubmit.ts
apps/pmc-google-booking-ops/src/entrypoints.ts
apps/pmc-google-booking-ops/src/runtime.ts
apps/pmc-google-booking-ops/src/sheetSchema.ts
```

### Build, routing, tests, and operations

```text
vite.mini-app.config.ts
server/productionApp.ts
server/productionServer.ts
package.json
package-lock.json
tests/pmc-mini-app/*.test.ts(x)
docs/pmc-mini-app/pilot-runbook.md
scripts/check-pmc-mini-app-runtime.mjs
```

---

### Task 1: Shared Mini App contracts and buildable client shell

**Files:**
- Create: `src/apps/pmc-mini-app/contracts.ts`
- Create: `src/apps/pmc-mini-app/index.html`
- Create: `src/apps/pmc-mini-app/main.tsx`
- Create: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Create: `src/apps/pmc-mini-app/Home.tsx`
- Create: `src/apps/pmc-mini-app/styles.css`
- Create: `vite.mini-app.config.ts`
- Create: `tests/pmc-mini-app/clientShell.test.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `MiniAppSession`, `MiniAppConfig`, `BookingDraftInput`, `BookingDraftProjection`, `BookingConfirmationResult` in `contracts.ts`.
- Produces: static bundle at `dist/mini-app/` with base `/mini-app/`.
- Consumes: no server API yet; test injects fixed session/config.

- [ ] **Step 1: Write the failing client shell test**

```tsx
it('shows only the two approved version-1 home actions', () => {
  render(<PmcMiniApp initialSession={{ staffId: 'ADMIN_01', displayName: 'มัส' }} />)
  expect(screen.getByRole('button', { name: 'ลงนัดหมาย' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'รายงาน JERA' })).toBeVisible()
  expect(screen.queryByText('LINE Assistant')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npx vitest run tests/pmc-mini-app/clientShell.test.tsx`

Expected: FAIL because `PmcMiniApp` and the Mini App bundle do not exist.

- [ ] **Step 3: Add exact contracts and the minimal shell**

```ts
export interface MiniAppSession {
  staffId: string
  displayName: string
  active: true
}

export interface MiniAppConfig {
  miniAppId: string
  fallbackFormUrl: string
  doctors: Array<{ id: string; name: string }>
  services: Array<{ id: string; name: string; durationMinutes: number }>
  channels: Array<{ id: string; name: string }>
  aes: Array<{ id: string; name: string }>
}

export type BookingQueueType = 'NORMAL' | 'AUTO'

export interface BookingDraftInput {
  requestId: string
  aeName: string
  customerName: string
  facebookName: string
  phone: string
  doctorId: string
  serviceId: string
  queueType: BookingQueueType
  appointmentDate: string | null
  appointmentTime: string | null
  depositAmount: number
  channelId: string
}
```

Create `vite.mini-app.config.ts` with `root=src/apps/pmc-mini-app`, `base=/mini-app/`, and output `dist/mini-app` without clearing other `dist` bundles.

- [ ] **Step 4: Add build scripts and verify shell/build**

Add:

```json
"build:mini-app": "vite build --config vite.mini-app.config.ts"
```

Update root `build` to run `build:mini-app` after `build:ocr-review`.

Run:

```bash
npx vitest run tests/pmc-mini-app/clientShell.test.tsx
npm run build:mini-app
test -f dist/mini-app/index.html
```

Expected: PASS and `dist/mini-app/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.mini-app.config.ts src/apps/pmc-mini-app tests/pmc-mini-app/clientShell.test.tsx
git commit -m "build: scaffold PMC LINE Mini App"
```

---

### Task 2: Strict Mini App configuration and LINE identity verification

**Files:**
- Create: `server/pmc-mini-app/config.ts`
- Create: `server/pmc-mini-app/lineIdentity.ts`
- Create: `server/pmc-mini-app/contracts.ts`
- Create: `tests/pmc-mini-app/config.test.ts`
- Create: `tests/pmc-mini-app/lineIdentity.test.ts`

**Interfaces:**
- Produces: `readPmcMiniAppConfig(env): PmcMiniAppServerConfig | null`.
- Produces: `LineIdentityPort.verify(idToken): Promise<{ lineUserId: string }>`.
- Produces safe errors: `MINI_APP_UNAUTHORIZED`, `MINI_APP_ID_TOKEN_EXPIRED`, `MINI_APP_NOT_CONFIGURED`.

- [ ] **Step 1: Write failing configuration tests**

```ts
it('fails closed without logging secret values', () => {
  expect(readPmcMiniAppConfig({ PMC_MINI_APP_ENABLED: 'true' })).toBeNull()
})

it('accepts only exact production-safe limits', () => {
  const config = readPmcMiniAppConfig(validEnvironment())
  expect(config).toMatchObject({ maxImageBytes: 10_000_000, maxFilesPerKind: 10 })
})
```

- [ ] **Step 2: Run the configuration tests and verify failure**

Run: `npx vitest run tests/pmc-mini-app/config.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement strict environment parsing**

Required non-secret names:

```ts
const REQUIRED = [
  'PMC_MINI_APP_ID', 'PMC_MINI_APP_LIFF_CHANNEL_ID', 'PMC_SPREADSHEET_ID',
  'PMC_DRIVE_INTAKE_FOLDER_ID', 'PMC_BOOKING_INGRESS_URL', 'PMC_BOOKING_FALLBACK_FORM_URL',
] as const
```

Required secret names are read from environment only after Secret Manager injection:

```ts
const REQUIRED_SECRETS = ['PMC_BOOKING_INGRESS_SECRET', 'PMC_MINI_APP_SIGNING_SECRET'] as const
```

Reject non-HTTPS production ingress URLs, unsafe numeric limits, blank IDs, and `PMC_MINI_APP_ENABLED=true` with missing dependencies. Return `null` so other production routes stay available.

- [ ] **Step 4: Write failing ID-token verification tests**

```ts
it('accepts only a valid LINE subject and configured audience', async () => {
  const identity = createLineIdentityClient({
    channelId: '2001234567', now: () => 1_800_000_000,
    fetch: vi.fn(async () => response(200, { sub: 'Ustaff', aud: '2001234567', exp: 1_800_000_100 })),
  })
  await expect(identity.verify('raw-token')).resolves.toEqual({ lineUserId: 'Ustaff' })
})
```

Also cover wrong audience, expired token, missing `sub`, provider non-2xx, and provider body redaction.

- [ ] **Step 5: Implement verification and run tests**

Use `POST https://api.line.me/oauth2/v2.1/verify` with URL-encoded `id_token` and `client_id`. Return only the LINE user ID.

Run:

```bash
npx vitest run tests/pmc-mini-app/config.test.ts tests/pmc-mini-app/lineIdentity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/config.ts server/pmc-mini-app/contracts.ts server/pmc-mini-app/lineIdentity.ts tests/pmc-mini-app/config.test.ts tests/pmc-mini-app/lineIdentity.test.ts
git commit -m "feat: verify PMC Mini App staff identity"
```

---

### Task 3: Keyless Google ports and managed Mini App Sheet schema

**Files:**
- Create: `server/pmc-mini-app/googleClient.ts`
- Create: `server/pmc-mini-app/store.ts`
- Create: `server/pmc-mini-app/setup.ts`
- Create: `tests/pmc-mini-app/googleClient.test.ts`
- Create: `tests/pmc-mini-app/store.test.ts`
- Create: `tests/pmc-mini-app/setup.test.ts`

**Interfaces:**
- Produces: `MiniAppSheetsPort`, `MiniAppDrivePort` using `google.auth.GoogleAuth` ADC.
- Produces: `MiniAppStore` with `getActiveStaffByLineUserId`, `createDraft`, `getDraft`, `updateDraft`, `markRetentionPending`, `claimConfirmation`, `completeConfirmation`, `failConfirmation`.
- Produces: exact `MINI_APP_REQUESTS`, `JERA_API_CACHE`, `JERA_SYNC_STATE`, `JERA_SYNC_AUDIT` headers from the spec.

- [ ] **Step 1: Write failing Google port tests**

```ts
it('uses keyless ADC scopes and never accepts credential JSON', () => {
  const ports = createMiniAppGooglePorts({ spreadsheetId: 'sheet', intakeFolderId: 'folder' }, fakeGoogle())
  expect(ports.authMode).toBe('ADC_SERVICE_IDENTITY')
})
```

Test Drive hierarchy allowlisting, MIME metadata, appProperties, upload, download, and Sheet batch reads/writes with injected fakes.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run tests/pmc-mini-app/googleClient.test.ts`

Expected: FAIL because the Google port does not exist.

- [ ] **Step 3: Implement keyless ports**

Use:

```ts
const auth = new google.auth.GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
})
```

The port must reject Sheet IDs and parent folders other than configured allowlisted resources. Tag uploaded files with `pmcMiniAppDraftId`, `pmcMiniAppRequestId`, and `evidenceKind` appProperties.

- [ ] **Step 4: Write failing store/idempotency tests**

```ts
it('claims one confirmation and returns the completed case on duplicate taps', async () => {
  const store = memoryStore()
  await store.createDraft(validDraft({ requestId: 'req-1' }))
  expect((await store.claimConfirmation('req-1', 'hash-1')).claimed).toBe(true)
  await store.completeConfirmation('req-1', 'PMC-202608-0001')
  expect(await store.claimConfirmation('req-1', 'hash-1')).toEqual({ claimed: false, caseId: 'PMC-202608-0001' })
})
```

Also test conflicting payload hash, stale version, inactive staff, and restart persistence using fake Sheet rows.

- [ ] **Step 5: Implement store and setup**

Keep booking fields in explicit bounded columns. Use row-level optimistic version and a process mutex only as a local optimization; persisted state and payload hash remain authoritative.

Cancellation and expiry must set `retentionState=PENDING_APPROVAL` through `markRetentionPending`; version 1 must not permanently delete uploaded evidence automatically.

Setup must:

1. create missing managed tabs;
2. reject incompatible non-empty headers;
3. preserve all existing tabs and values;
4. freeze row 1 and install no formulas that can reinterpret IDs.

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run tests/pmc-mini-app/googleClient.test.ts tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts
git add server/pmc-mini-app/googleClient.ts server/pmc-mini-app/store.ts server/pmc-mini-app/setup.ts tests/pmc-mini-app/googleClient.test.ts tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts
git commit -m "feat: persist PMC Mini App drafts in Sheets"
```

---

### Task 4: Booking draft validation and state machine

**Files:**
- Create: `server/pmc-mini-app/bookingDraft.ts`
- Create: `tests/pmc-mini-app/bookingDraft.test.ts`

**Interfaces:**
- Produces: `parseBookingDraft(input, context): MiniAppBookingDraft`.
- Produces: `bookingPayloadHash(draft): string` with canonical key ordering.
- Produces: `transitionDraft(draft, action): MiniAppBookingDraft`.
- Consumes: exact `BookingDraftInput` from Task 1 and authenticated staff from Task 2.

- [ ] **Step 1: Write failing normal/automatic validation tests**

```ts
it('requires date and time for NORMAL but forbids them for AUTO', () => {
  expect(() => parseBookingDraft(validInput({ queueType: 'NORMAL', appointmentDate: null }))).toThrow('APPOINTMENT_DATE_REQUIRED')
  expect(() => parseBookingDraft(validInput({ queueType: 'AUTO', appointmentDate: '2026-09-01' }))).toThrow('AUTO_QUEUE_DATE_FORBIDDEN')
})
```

Cover Thai phone, positive deposit, configured choice IDs, AE eligibility, evidence counts, and locked Admin identity.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/pmc-mini-app/bookingDraft.test.ts`

Expected: FAIL because draft parsing does not exist.

- [ ] **Step 3: Implement the exact state machine**

```ts
export type MiniAppRequestState =
  | 'DRAFT' | 'UPLOADING' | 'READY_TO_CONFIRM' | 'CONFIRMING'
  | 'CONFIRMED' | 'FAILED_RETRYABLE' | 'CANCELLED' | 'EXPIRED'

const ALLOWED: Record<MiniAppRequestState, MiniAppRequestState[]> = {
  DRAFT: ['UPLOADING', 'READY_TO_CONFIRM', 'CANCELLED', 'EXPIRED'],
  UPLOADING: ['DRAFT', 'READY_TO_CONFIRM', 'FAILED_RETRYABLE', 'CANCELLED', 'EXPIRED'],
  READY_TO_CONFIRM: ['CONFIRMING', 'DRAFT', 'CANCELLED', 'EXPIRED'],
  CONFIRMING: ['CONFIRMED', 'FAILED_RETRYABLE'],
  FAILED_RETRYABLE: ['CONFIRMING', 'DRAFT', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: [], CANCELLED: [], EXPIRED: [],
}
```

Use SHA-256 over the normalized booking fields plus ordered evidence IDs. Exclude transient timestamps and tokens.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/pmc-mini-app/bookingDraft.test.ts
git add server/pmc-mini-app/bookingDraft.ts tests/pmc-mini-app/bookingDraft.test.ts
git commit -m "feat: validate PMC Mini App booking drafts"
```

---

### Task 5: Authenticated session, configuration, and staff choice API

**Files:**
- Create: `server/pmc-mini-app/middleware.ts`
- Create: `tests/pmc-mini-app/sessionApi.test.ts`
- Modify: `server/pmc-mini-app/store.ts`

**Interfaces:**
- Produces: `createPmcMiniAppMiddleware(deps): ProductionMiddleware`.
- Routes: `GET /api/mini-app/client-config`, `GET /api/mini-app/session`, `GET /api/mini-app/config`.
- Consumes: `LineIdentityPort`, `MiniAppStore`, active staff/config rows.

- [ ] **Step 1: Write failing public/private boundary tests**

```ts
it('returns only Mini App ID publicly and protects operational configuration', async () => {
  expect(await invoke('/api/mini-app/client-config')).toMatchObject({ status: 200, body: { miniAppId: 'mini-id' } })
  expect((await invoke('/api/mini-app/config')).status).toBe(401)
})
```

Also require `403 STAFF_NOT_ALLOWED` for valid LINE users missing active mapping and ensure staff email/LINE ID of other users never appears in config responses.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/pmc-mini-app/sessionApi.test.ts`

Expected: FAIL because Mini App middleware does not exist.

- [ ] **Step 3: Implement authenticated projection**

```ts
interface AuthenticatedMiniAppContext {
  staffId: string
  displayName: string
  lineUserId: string
}
```

The client config returns only `{ miniAppId }`. Session returns the current staff projection. Config returns active doctors, services, channels, and eligible AE names using canonical Sheet configuration.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/pmc-mini-app/sessionApi.test.ts
git add server/pmc-mini-app/middleware.ts server/pmc-mini-app/store.ts tests/pmc-mini-app/sessionApi.test.ts
git commit -m "feat: expose authenticated Mini App configuration"
```

---

### Task 6: Bounded multipart evidence uploads to private Drive

**Files:**
- Create: `server/pmc-mini-app/evidence.ts`
- Create: `tests/pmc-mini-app/evidence.test.ts`
- Create: `tests/pmc-mini-app/evidenceApi.test.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/googleClient.ts`
- Modify: `server/pmc-mini-app/store.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `validateEvidence(bytes, advertisedMime): 'image/jpeg' | 'image/png'`.
- Route: `POST /api/mini-app/booking-drafts/:draftId/evidence?kind=PAYMENT|CHAT`.
- Consumes: authenticated staff, owned draft, `MiniAppDrivePort.uploadEvidence`.

- [ ] **Step 1: Add Busboy and write failing parser tests**

Add exact dependencies:

```bash
npm install busboy
npm install --save-dev @types/busboy
```

Write tests for one multipart file, repeated files, incomplete boundaries, unknown fields, oversized body, and filename/path injection.

- [ ] **Step 2: Write failing image and ownership tests**

```ts
it.each([
  ['GIF masquerading as PNG', Buffer.from('GIF89a'), 'image/png'],
  ['empty body', Buffer.alloc(0), 'image/png'],
])('rejects %s', (_name, bytes, mime) => {
  expect(() => validateEvidence(bytes, mime)).toThrow('UNSUPPORTED_EVIDENCE')
})
```

Require draft ownership, state `DRAFT|UPLOADING`, maximum 10 files per kind, 10 MB per file, JPEG/PNG signatures, and no client-chosen Drive parent.

- [ ] **Step 3: Run tests and verify failure**

Run: `npx vitest run tests/pmc-mini-app/evidence.test.ts tests/pmc-mini-app/evidenceApi.test.ts`

Expected: FAIL because upload route and validators do not exist.

- [ ] **Step 4: Implement streaming upload**

Busboy limits:

```ts
{ files: 10, fileSize: 10_000_000, fields: 0, parts: 10 }
```

Buffer one bounded file at a time, validate magic bytes before Drive upload, assign a server name, and store the resulting ordered file ID in the draft. On failure, delete no prior successful file and leave the draft retryable.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/pmc-mini-app/evidence.test.ts tests/pmc-mini-app/evidenceApi.test.ts
git add package.json package-lock.json server/pmc-mini-app/evidence.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/googleClient.ts server/pmc-mini-app/store.ts tests/pmc-mini-app/evidence.test.ts tests/pmc-mini-app/evidenceApi.test.ts
git commit -m "feat: upload Mini App booking evidence privately"
```

---

### Task 7: Shared signed booking ingress and Apps Script route isolation

**Files:**
- Create: `shared/pmcMiniAppBooking.ts`
- Create: `server/pmc-mini-app/bookingIngressClient.ts`
- Create: `tests/pmc-mini-app/bookingIngressClient.test.ts`
- Create: `apps/pmc-google-booking-ops/src/domain/miniAppIngress.ts`
- Create: `apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`

**Interfaces:**
- Produces shared `MiniAppBookingIngressEnvelope` and stable canonical serialization.
- Produces server `sendMiniAppBookingIngress(envelope): Promise<{ caseId: string; status: string }>`.
- Produces Apps Script `parseAndVerifyMiniAppIngress(event, ports)`.
- Preserves existing LINE directory `doPost` handling.

- [ ] **Step 1: Write failing server signature tests**

```ts
it('signs the exact canonical payload and sends no secret field', async () => {
  const request = await buildMiniAppIngress(validConfirmedDraft(), context(), 'secret')
  expect(request.body.kind).toBe('MINI_APP_BOOKING')
  expect(JSON.stringify(request.body)).not.toContain('secret')
  expect(request.headers).toMatchObject({ 'content-type': 'application/json' })
})
```

Test timeout, provider non-2xx, invalid response, and safe error redaction.

- [ ] **Step 2: Write failing Apps Script verification tests**

```ts
it('rejects altered, expired, replayed, and unknown envelope kinds', () => {
  const ports = createTestPorts()
  expect(() => parseAndVerifyMiniAppIngress(alteredEvent(), ports)).toThrow('invalid mini app ingress signature')
})
```

Require exact keys, timestamp ±300 seconds, nonce, request ID format, active staff ID, allowed choice IDs, bounded evidence IDs, and constant-time signature comparison.

- [ ] **Step 3: Run and verify both failures**

```bash
npx vitest run tests/pmc-mini-app/bookingIngressClient.test.ts apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts
```

Expected: FAIL because shared ingress does not exist.

- [ ] **Step 4: Implement fail-closed route discrimination**

```ts
export function doPost(event: AppsScriptDoPostEvent) {
  const kind = JSON.parse(event.postData.contents).kind
  if (kind === 'MINI_APP_BOOKING') return handleMiniAppBookingIngress(event, createRuntime())
  if (kind === undefined) return handleLegacyLineDirectoryIngress(event, createRuntime())
  throw new Error('unsupported ingress kind')
}
```

The implementation must parse once into a bounded plain object and preserve the legacy payload contract exactly. Do not log request bodies.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/pmc-mini-app/bookingIngressClient.test.ts apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts tests/bookingLineWebhook.test.ts
git add shared/pmcMiniAppBooking.ts server/pmc-mini-app/bookingIngressClient.ts tests/pmc-mini-app/bookingIngressClient.test.ts apps/pmc-google-booking-ops/src/domain/miniAppIngress.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts
git commit -m "feat: add signed Mini App booking ingress"
```

---

### Task 8: Idempotent Mini App submission through the existing booking domain

**Files:**
- Create: `apps/pmc-google-booking-ops/src/workflows/miniAppSubmit.ts`
- Create: `apps/pmc-google-booking-ops/tests/miniAppSubmit.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/miniAppIngress.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`

**Interfaces:**
- Produces: `submitMiniAppBooking(input, ports): BookingCase`.
- Consumes: verified staff, normalized booking fields, existing `submitBookingIntake`.
- Duplicate same `requestId` returns the prior booking; conflicting hash is rejected before mutation.

- [ ] **Step 1: Write failing end-to-end submission tests**

```ts
it('creates one canonical booking and returns it on a duplicate request', () => {
  const ports = createTestPorts()
  const first = submitMiniAppBooking(validMiniAppInput({ requestId: 'req-1' }), ports)
  const second = submitMiniAppBooking(validMiniAppInput({ requestId: 'req-1' }), ports)
  expect(second.caseId).toBe(first.caseId)
  expect(ports.bookings.list()).toHaveLength(1)
})
```

Add normal queue, automatic queue, staff identity, multiple evidence, invalid configured choice, and conflicting request tests.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/miniAppSubmit.test.ts`

Expected: FAIL because `submitMiniAppBooking` does not exist.

- [ ] **Step 3: Implement the adapter, not a second booking workflow**

Map Mini App input to:

```ts
const intake: BookingIntake = {
  formResponseId: `mini:${requestId}`,
  submitterEmail: staff.email || 'mini-app@internal.invalid',
  closerName: staff.name,
  // all remaining canonical fields copied after server validation
}
```

On duplicate, resolve the canonical booking by `formResponseId`. Do not change duplicate behavior for Google Form submissions.

- [ ] **Step 4: Run regression tests and commit**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/miniAppSubmit.test.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts
git add apps/pmc-google-booking-ops/src/workflows/miniAppSubmit.ts apps/pmc-google-booking-ops/src/domain/miniAppIngress.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/tests/miniAppSubmit.test.ts
git commit -m "feat: submit Mini App bookings idempotently"
```

---

### Task 9: Cloud Run draft and confirmation API

**Files:**
- Create: `tests/pmc-mini-app/bookingApi.test.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/store.ts`
- Modify: `server/pmc-mini-app/bookingIngressClient.ts`

**Interfaces:**
- Routes: create/get/patch/cancel/confirm booking drafts.
- Confirmation returns `200 { caseId, status }` for first and duplicate accepted requests.
- Consumes Tasks 2-8.

- [ ] **Step 1: Write failing HTTP transaction tests**

Cover:

```text
POST   /api/mini-app/booking-drafts
GET    /api/mini-app/booking-drafts/:draftId
PATCH  /api/mini-app/booking-drafts/:draftId
POST   /api/mini-app/booking-drafts/:draftId/confirm
POST   /api/mini-app/booking-drafts/:draftId/cancel
```

Example:

```ts
it('does not call Apps Script before explicit confirmation', async () => {
  await createDraft()
  await patchDraft(validInput())
  expect(deps.ingress.send).not.toHaveBeenCalled()
  const response = await confirmDraft()
  expect(response.body.caseId).toBe('PMC-202608-0001')
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/pmc-mini-app/bookingApi.test.ts`

Expected: FAIL because booking API routes do not exist.

- [ ] **Step 3: Implement bounded JSON APIs**

Use `readJsonBody(req, 64 * 1024)` for draft metadata. Enforce `application/json`, exact key allowlists, draft ownership, optimistic version, and no customer data in errors.

For confirm:

1. validate `READY_TO_CONFIRM`;
2. claim `(requestId, payloadHash)`;
3. call signed ingress;
4. persist `CONFIRMED` and Case ID;
5. on timeout/nonterminal provider error, persist `FAILED_RETRYABLE`;
6. on retry, use the same request ID and payload hash.

For cancel or expiry, persist the terminal draft state and call `markRetentionPending`. Do not delete Drive evidence in the request path.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/pmc-mini-app/bookingApi.test.ts
git add server/pmc-mini-app/middleware.ts server/pmc-mini-app/store.ts server/pmc-mini-app/bookingIngressClient.ts tests/pmc-mini-app/bookingApi.test.ts
git commit -m "feat: add Mini App booking API"
```

---

### Task 10: Mobile booking wizard, preview, confirmation, and fallback

**Files:**
- Create: `src/apps/pmc-mini-app/api.ts`
- Create: `src/apps/pmc-mini-app/bookingModel.ts`
- Create: `src/apps/pmc-mini-app/BookingWizard.tsx`
- Create: `tests/pmc-mini-app/bookingModel.test.ts`
- Create: `tests/pmc-mini-app/bookingWizard.test.tsx`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/styles.css`

**Interfaces:**
- Produces client `initializeMiniApp`, `loadSession`, `loadConfig`, draft/upload/confirm methods.
- Consumes authenticated API from Tasks 5, 6, and 9.

- [ ] **Step 1: Write failing wizard reducer tests**

```ts
it('skips date/time for AUTO and preserves evidence order', () => {
  const state = reduceBooking(initialBooking(), { type: 'SET_QUEUE_TYPE', value: 'AUTO' })
  expect(state.values).toMatchObject({ appointmentDate: null, appointmentTime: null })
})
```

Test Thai phone normalization, step validation, evidence limits, back navigation, and preview projection.

- [ ] **Step 2: Write failing UI tests**

```tsx
it('shows locked Admin, editable AE, and requires explicit final confirmation', async () => {
  renderBookingWizard({ session: { staffId: 'ADMIN_01', displayName: 'มัส', active: true } })
  expect(screen.getByLabelText('Admin')).toHaveValue('มัส')
  expect(screen.getByLabelText('Admin')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'ยืนยันบันทึก' })).not.toBeInTheDocument()
})
```

- [ ] **Step 3: Run and verify failures**

```bash
npx vitest run tests/pmc-mini-app/bookingModel.test.ts tests/pmc-mini-app/bookingWizard.test.tsx
```

Expected: FAIL because client booking modules do not exist.

- [ ] **Step 4: Implement the six approved screens**

Implement customer, booking details, queue type, deposit/evidence, preview, and success. Keep each primary action at least 48 px and show upload count/thumbnail/remove controls. The success screen displays Case ID and `CONFIRMED`, `TENTATIVE`, or `AWAITING_ADMIN_SLOT` status returned by the server.

Initialize LIFF using `/api/mini-app/client-config`; send the raw ID token as bearer. Unknown/inactive users render `รอผู้ดูแลอนุมัติ`.

- [ ] **Step 5: Run tests/build and commit**

```bash
npx vitest run tests/pmc-mini-app/bookingModel.test.ts tests/pmc-mini-app/bookingWizard.test.tsx tests/pmc-mini-app/clientShell.test.tsx
npm run build:mini-app
git add src/apps/pmc-mini-app tests/pmc-mini-app/bookingModel.test.ts tests/pmc-mini-app/bookingWizard.test.tsx
git commit -m "feat: build PMC Mini App booking wizard"
```

---

### Task 11: Production route isolation and runtime construction

**Files:**
- Create: `server/pmc-mini-app/runtime.ts`
- Create: `tests/pmc-mini-app/productionApp.test.ts`
- Modify: `server/productionApp.ts`
- Modify: `server/productionServer.ts`
- Modify: `package.json`

**Interfaces:**
- Adds optional `pmcMiniApp?: ProductionMiddleware` to `ProductionAppDependencies`.
- Serves `/mini-app` and `/mini-app/*` statically before legacy Basic Auth.
- Delegates `/api/mini-app/*` only to Mini App middleware.
- Fail-closed absence returns 503 only for Mini App routes.

- [ ] **Step 1: Write failing isolation tests**

```ts
it('keeps Booking, OCR, health, and legacy routes available when Mini App config is absent', async () => {
  const app = handler({ pmcMiniApp: undefined })
  expect((await invoke(app, '/api/mini-app/session')).status).toBe(503)
  expect((await invoke(app, '/healthz')).status).toBe(200)
  expect((await invoke(app, '/api/booking-line/webhook', { method: 'POST' })).status).not.toBe(503)
})
```

Also test path traversal, hashed asset cache, no request-data injection into static HTML, method rejection, and OCR independence.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/pmc-mini-app/productionApp.test.ts tests/ocr-ledger/productionApp.test.ts`

Expected: FAIL because production app has no Mini App route.

- [ ] **Step 3: Implement runtime and static routing**

`createPmcMiniAppRuntime(env)` catches constructor/config errors and returns `undefined`; do not let invalid Mini App settings crash the process. Serve only `dist/mini-app` at `/mini-app/`.

Update `productionServer.ts` to construct Mini App independently and pass it into `createProductionRequestHandler`.

- [ ] **Step 4: Run regressions and commit**

```bash
npx vitest run tests/pmc-mini-app/productionApp.test.ts tests/ocr-ledger/productionApp.test.ts tests/bookingLineWebhook.test.ts
npm run build
git add server/pmc-mini-app/runtime.ts server/productionApp.ts server/productionServer.ts package.json tests/pmc-mini-app/productionApp.test.ts
git commit -m "feat: serve PMC Mini App independently"
```

---

### Task 12: Local end-to-end acceptance and security regression

**Files:**
- Create: `tests/pmc-mini-app/endToEnd.test.ts`
- Create: `tests/pmc-mini-app/security.test.ts`
- Create: `tests/pmc-mini-app/browserAcceptance.spec.ts`
- Create: `tests/pmc-mini-app/localServer.mjs`
- Create: `playwright.mini-app.config.ts`

**Interfaces:**
- Produces deterministic local Mini App with fake LINE identity, fake Google ports, and fake Apps Script ingress.
- Verifies one normal booking, one automatic booking, duplicate confirmation, multiple evidence, unknown staff, and Form fallback.

- [ ] **Step 1: Write the failing full-flow test**

```ts
it('submits one normal and one automatic booking without duplicate Case IDs', async () => {
  const system = miniAppTestSystem()
  const normal = await system.submit(normalBooking({ requestId: 'normal-1' }))
  const automatic = await system.submit(autoBooking({ requestId: 'auto-1' }))
  expect(normal.status).toBe('CONFIRMED')
  expect(automatic.status).toMatch(/TENTATIVE|AWAITING_ADMIN_SLOT/)
  expect((await system.submit(normalBooking({ requestId: 'normal-1' }))).caseId).toBe(normal.caseId)
})
```

- [ ] **Step 2: Write security tests**

Scan built assets and API responses for configured secret values, reject overlong URLs/JSON/multipart, require HTTPS production config, and assert all PII logs use hashes/masks.

- [ ] **Step 3: Implement the deterministic test server and browser scenarios**

Browser checks:

```text
unknown staff -> waiting screen
active staff -> home
normal booking -> date/time required
automatic booking -> date/time absent
multi-image upload -> preview counts preserved
confirm double tap -> one Case ID
fallback -> Google Form link present
```

- [ ] **Step 4: Run the acceptance suite**

```bash
npx vitest run tests/pmc-mini-app
npx playwright test --config=playwright.mini-app.config.ts
npm run build
npm run booking:test
npm run booking:typecheck
npm run booking:build
npx eslint src/apps/pmc-mini-app server/pmc-mini-app tests/pmc-mini-app shared/pmcMiniAppBooking.ts apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests
git diff --check
```

Expected: all pass; no production network calls.

- [ ] **Step 5: Commit**

```bash
git add tests/pmc-mini-app playwright.mini-app.config.ts
git commit -m "test: verify PMC Mini App booking flow"
```

---

### Task 13: Cloud Run configuration, pilot runbook, and production gates

**Files:**
- Create: `scripts/check-pmc-mini-app-runtime.mjs`
- Create: `docs/pmc-mini-app/pilot-runbook.md`
- Test: `tests/pmc-mini-app/runtimeConfig.test.ts`

**Interfaces:**
- Produces a read-only runtime checker that reports environment variable names/status only.
- Produces exact Cloud Run, Secret Manager, service identity, Drive/Sheet sharing, Rich Menu, and rollback steps.
- Does not perform deployment or secret creation automatically.

- [ ] **Step 1: Write failing runtime configuration tests**

```ts
it('documents every required non-secret and secret binding without values', () => {
  expect(runbook).toContain('JERA_API_USERNAME')
  expect(runbook).not.toContain('JERA_API_USERNAME=')
  expect(runbook).toContain('PMC_MINI_APP_ENABLED=false')
})
```

The JERA secret names are included because the same Cloud Run service will host reporting in the next plan, but Booking acceptance does not call JERA.

- [ ] **Step 2: Write the runbook**

Runbook order:

1. deploy code with `PMC_MINI_APP_ENABLED=false`;
2. create/bind secrets manually after owner approval;
3. share only allowlisted Sheet/Drive resources to the Cloud Run service identity;
4. run local/synthetic acceptance;
5. deploy no-traffic revision;
6. verify `/healthz`, static shell, ID-token rejection, and feature-disabled response;
7. enable for pilot allowlist only;
8. submit owner-approved synthetic normal/automatic bookings;
9. switch Rich Menu only after explicit owner approval;
10. rollback by disabling flag and restoring Form link.

- [ ] **Step 3: Add Render isolation documentation**

Do not deploy Mini App to Render. Keep the existing `render.yaml` unchanged. Document in the pilot runbook that Mini App environment variables are absent there and test this by reading `render.yaml` without modifying it. The Cloud Run service is a separate production surface using the same built code boundary.

- [ ] **Step 4: Run documentation/runtime checks and commit**

```bash
npx vitest run tests/pmc-mini-app/runtimeConfig.test.ts
node scripts/check-pmc-mini-app-runtime.mjs --env-file /dev/null
git diff --check
git add scripts/check-pmc-mini-app-runtime.mjs docs/pmc-mini-app/pilot-runbook.md tests/pmc-mini-app/runtimeConfig.test.ts
git commit -m "docs: add PMC Mini App production gates"
```

---

## Booking Plan Final Verification Gate

Before requesting any Cloud Run, LINE Console, Google sharing, Apps Script push, Form submission, or Rich Menu approval, run:

```bash
npm ci
npx vitest run tests/pmc-mini-app tests/ocr-ledger tests/bookingLineWebhook.test.ts
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run build
npx playwright test --config=playwright.mini-app.config.ts
npx eslint src/apps/pmc-mini-app server/pmc-mini-app tests/pmc-mini-app shared/pmcMiniAppBooking.ts apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests
git diff --check
git status --short
```

Record only pass/fail, commit SHA, safe counts, and sanitized URLs. Stop for a fresh owner gate before every production mutation.
