# PMC Mini App Asynchronous Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acknowledge typical evidence uploads within 3–5 seconds and booking confirmation within 2–3 seconds while Drive, Calendar, and LINE finish in an idempotent Cloud Tasks workflow.

**Architecture:** The LIFF API stages validated evidence in a private Singapore Cloud Storage bucket and records object keys in `MINI_APP_REQUESTS`. Confirmation creates one deterministic Cloud Task and returns HTTP 202; an OIDC-authenticated worker route on the existing Cloud Run service copies evidence to Drive through the signed Apps Script ingress, calls the booking ingress, and records the final Case ID and projection states in Sheets.

**Tech Stack:** TypeScript 6, Node.js 24, React 19, Vite 8, Vitest 4, Playwright, Google Sheets/Drive APIs, Google Cloud Storage, Google Cloud Tasks, Cloud Run, Google Auth Library, Apps Script, LINE LIFF.

**Spec:** `docs/superpowers/specs/2026-08-28-pmc-mini-app-async-booking-design.md`

## Global Constraints

- `PMC_MINI_APP_ASYNC_ENABLED` defaults to `false`; no asynchronous path runs when it is absent or false.
- Google Sheets remains the booking source of truth; Drive remains the canonical evidence store after finalization.
- Cloud Storage is private staging only in `asia-southeast1`, with Uniform Bucket-Level Access and Public Access Prevention.
- Do not create, download, or upload a service-account key.
- Limits are 10 files per kind, 10 MB per file, 25 MB per batch, and JPEG/PNG only.
- Object names, task bodies, URLs, logs, and metrics contain no customer, Facebook, phone, Admin, AE, evidence-byte, or credential values.
- Task payload contains only `requestId` and `draftId`.
- Worker requests require a valid Google OIDC token with the configured audience and task-invoker email.
- Every mutation is idempotent and returns the original Case ID on replay.
- Abandoned or cancelled evidence remains behind `PENDING_APPROVAL` cleanup.
- The synchronous flow and Google Form fallback remain available throughout rollout.
- Each live infrastructure, Sheet, Apps Script, traffic, and feature-flag action stops at the owner gate in Task 12.

## Planned File Structure

New server modules:

- `server/pmc-mini-app/asyncConfig.ts`
- `server/pmc-mini-app/asyncState.ts`
- `server/pmc-mini-app/stagingStore.ts`
- `server/pmc-mini-app/evidenceBatch.ts`
- `server/pmc-mini-app/taskQueue.ts`
- `server/pmc-mini-app/workerAuth.ts`
- `server/pmc-mini-app/asyncWorker.ts`
- `server/pmc-mini-app/asyncTelemetry.ts`

New client module:

- `src/apps/pmc-mini-app/BookingProcessing.tsx`

New operations artifacts:

- `scripts/check-pmc-async-runtime.mjs`
- `docs/pmc-mini-app/async-booking-runbook.md`

---

### Task 1: Feature-gated asynchronous runtime configuration

**Files:**
- Create: `server/pmc-mini-app/asyncConfig.ts`
- Modify: `server/pmc-mini-app/config.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Modify: `scripts/check-pmc-mini-app-runtime.mjs`
- Test: `tests/pmc-mini-app/asyncConfig.test.ts`
- Test: `tests/pmc-mini-app/runtimeConfig.test.ts`

**Interfaces:**

```ts
export interface PmcAsyncBookingConfig {
  enabled: true
  projectId: string
  location: 'asia-southeast1'
  bucketName: string
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  ownerStaffIds: ReadonlySet<string>
  maxBatchBytes: 25_000_000
}

export function readPmcAsyncBookingConfig(
  env: Record<string, string | undefined>,
): PmcAsyncBookingConfig | null
```

- [ ] **Step 1: Write failing configuration tests**

```ts
expect(readPmcAsyncBookingConfig({ PMC_MINI_APP_ASYNC_ENABLED: 'false' })).toBeNull()

expect(readPmcAsyncBookingConfig({
  PMC_MINI_APP_ASYNC_ENABLED: 'true',
  PMC_GCP_PROJECT_ID: 'project-2099d92f-51c8-4d2b-a8c',
  PMC_ASYNC_LOCATION: 'asia-southeast1',
  PMC_ASYNC_BUCKET: 'pmc-mini-app-evidence-staging',
  PMC_ASYNC_QUEUE: 'pmc-booking-finalize',
  PMC_ASYNC_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/finalize-booking',
  PMC_ASYNC_WORKER_AUDIENCE: 'https://pmc-mini-app.example',
  PMC_ASYNC_TASK_INVOKER_EMAIL: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
  PMC_ASYNC_OWNER_STAFF_IDS: 'staff-owner',
})).toMatchObject({ enabled: true, location: 'asia-southeast1', maxBatchBytes: 25_000_000 })
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/asyncConfig.test.ts tests/pmc-mini-app/runtimeConfig.test.ts
```

Expected: FAIL because the async parser and safe runtime report do not exist.

- [ ] **Step 3: Implement strict parsing**

Use exact project/resource/service-account/staff-ID regexes, exact `asia-southeast1`, and HTTPS URLs without credentials. Add `asyncBooking: PmcAsyncBookingConfig | null` to `PmcMiniAppServerConfig`. Require new values only when enabled.

- [ ] **Step 4: Extend the runtime checker**

Return only `asyncBookingEnabled` and present/missing variable names. Tests must prove serialized output omits every configured value.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/asyncConfig.test.ts tests/pmc-mini-app/runtimeConfig.test.ts
npx tsc -p tsconfig.server.json --noEmit
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/asyncConfig.ts server/pmc-mini-app/config.ts server/pmc-mini-app/runtime.ts scripts/check-pmc-mini-app-runtime.mjs tests/pmc-mini-app/asyncConfig.test.ts tests/pmc-mini-app/runtimeConfig.test.ts
git commit -m "feat: add async booking runtime configuration"
```

---

### Task 2: Append-only request schema migration

**Files:**
- Modify: `server/pmc-mini-app/store.ts`
- Modify: `server/pmc-mini-app/setup.ts`
- Test: `tests/pmc-mini-app/store.test.ts`
- Test: `tests/pmc-mini-app/setup.test.ts`

**Interfaces:** Add these fields to `MiniAppRequestRecord`:

```ts
paymentEvidenceObjectKeys: string[]
chatEvidenceObjectKeys: string[]
taskName: string | null
queuedAt: string | null
processingStartedAt: string | null
processingLeaseUntil: string | null
lastProgressAt: string | null
attemptCount: number
```

Produce:

```ts
export async function migrateMiniAppAsyncRequestColumns(input: {
  spreadsheetId: string
  sheets: MiniAppSheetsPort
}): Promise<{ appendedColumns: string[] }>
```

- [ ] **Step 1: Write failing serialization and migration tests**

Assert round-trip values, legacy-row defaults, a valid 28-column header receiving exactly eight appended columns, and a changed legacy column being rejected without writes.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts
```

Expected: FAIL because the new record fields and migration are absent.

- [ ] **Step 3: Append the exact headers**

```ts
const ASYNC_REQUEST_HEADERS = [
  'paymentEvidenceObjectKeysJson',
  'chatEvidenceObjectKeysJson',
  'taskName',
  'queuedAt',
  'processingStartedAt',
  'processingLeaseUntil',
  'lastProgressAt',
  'attemptCount',
] as const
```

Update row serialization, normalization, patch typing, and every draft fixture. Legacy defaults are empty arrays, nulls, and `attemptCount: 0`.

- [ ] **Step 4: Implement prefix-safe migration**

Require the production header to equal the legacy prefix exactly, then write only missing row-1 cells. Never rewrite existing headers or data rows.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts tests/pmc-mini-app/bookingApi.test.ts tests/pmc-mini-app/evidenceApi.test.ts
npx tsc -p tsconfig.server.json --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/store.ts server/pmc-mini-app/setup.ts tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts tests/pmc-mini-app
git commit -m "feat: append async booking request fields"
```

---

### Task 3: Async state machine, active-draft resume, and lease

**Files:**
- Create: `server/pmc-mini-app/asyncState.ts`
- Modify: `server/pmc-mini-app/store.ts`
- Test: `tests/pmc-mini-app/asyncState.test.ts`
- Test: `tests/pmc-mini-app/store.test.ts`

**Interfaces:**

Extend `MiniAppRequestState` with `QUEUED`, `PROCESSING`, `RETRYING`, `CONFIRMED_WITH_RETRY`, and `NEEDS_REVIEW`.

```ts
export function canTransitionAsyncBooking(
  from: MiniAppRequestState,
  to: MiniAppRequestState,
): boolean

export interface AsyncMiniAppStore {
  getLatestActiveDraftByStaff(staffId: string): Promise<MiniAppRequestRecord | null>
  queueDraft(requestId: string, payloadHash: string, taskName: string, queuedAt: string): Promise<MiniAppRequestRecord>
  claimProcessing(input: {
    requestId: string
    draftId: string
    leaseUntil: string
    nowIso: string
  }): Promise<{ claimed: boolean; draft: MiniAppRequestRecord }>
  markAsyncRetry(requestId: string, safeErrorCode: string, nowIso: string): Promise<MiniAppRequestRecord>
  completeAsyncBooking(input: {
    requestId: string
    caseId: string
    status: NonNullable<MiniAppRequestRecord['confirmationStatus']>
    projectionState: 'CONFIRMED' | 'CONFIRMED_WITH_RETRY'
    nowIso: string
  }): Promise<MiniAppRequestRecord>
}
```

- [ ] **Step 1: Write the failing transition table**

Cover allowed `READY_TO_CONFIRM -> QUEUED -> PROCESSING`, retry and terminal paths, plus forbidden transitions from `CANCELLED`, `EXPIRED`, and terminal states.

- [ ] **Step 2: Write failing store tests**

Cover owner isolation, newest active draft, first lease, task race claim from matching `READY_TO_CONFIRM`, rejection during a live lease, reclaim after expiry, attempt increment, and terminal idempotency.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/asyncState.test.ts tests/pmc-mini-app/store.test.ts
```

Expected: FAIL because transition and lease operations do not exist.

- [ ] **Step 4: Implement state and mutex-protected mutations**

A claim records the first processing timestamp, refreshes lease/progress timestamps, and increments attempts. Every mutation uses the existing spreadsheet mutex and optimistic version.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/asyncState.test.ts tests/pmc-mini-app/store.test.ts
npx tsc -p tsconfig.server.json --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/asyncState.ts server/pmc-mini-app/store.ts tests/pmc-mini-app/asyncState.test.ts tests/pmc-mini-app/store.test.ts
git commit -m "feat: add async booking state machine"
```

---

### Task 4: Private Cloud Storage staging port

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `server/pmc-mini-app/stagingStore.ts`
- Test: `tests/pmc-mini-app/stagingStore.test.ts`

**Interfaces:**

```ts
export interface EvidenceStagingPort {
  put(input: {
    draftId: string
    kind: 'PAYMENT' | 'CHAT'
    mimeType: 'image/jpeg' | 'image/png'
    bytes: Buffer
  }): Promise<{ objectKey: string; size: number; contentSha256: string }>
  get(objectKey: string): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }>
  deleteVerified(objectKey: string): Promise<void>
}

export function evidenceObjectKey(input: {
  draftId: string
  kind: 'PAYMENT' | 'CHAT'
  contentSha256: string
  mimeType: 'image/jpeg' | 'image/png'
}): string

export function createGoogleEvidenceStagingPort(input: {
  bucketName: string
  storage?: Storage
}): EvidenceStagingPort
```

- [ ] **Step 1: Install the official client**

```bash
npm install @google-cloud/storage
```

- [ ] **Step 2: Write failing deterministic-key and boundary tests**

```ts
expect(evidenceObjectKey({
  draftId: 'draft-1',
  kind: 'PAYMENT',
  contentSha256: 'a'.repeat(64),
  mimeType: 'image/jpeg',
})).toBe(`drafts/draft-1/PAYMENT/${'a'.repeat(64)}.jpg`)
```

Test `ifGenerationMatch: 0`, non-resumable CRC-validated upload, private/no-store metadata, exact MIME, no patient metadata, bounded download, and idempotent acceptance only when an existing object's size and metadata match.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/stagingStore.test.ts
```

Expected: FAIL because the staging port does not exist.

- [ ] **Step 4: Implement the port**

Use SHA-256 over original bytes. Reject unsafe draft IDs, empty bytes, unsupported MIME, keys outside `drafts/`, and mismatched existing objects.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/stagingStore.test.ts
npx tsc -p tsconfig.server.json --noEmit
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/pmc-mini-app/stagingStore.ts tests/pmc-mini-app/stagingStore.test.ts
git commit -m "feat: stage Mini App evidence in Cloud Storage"
```

---

### Task 5: Batch evidence parser and fast evidence API

**Files:**
- Create: `server/pmc-mini-app/evidenceBatch.ts`
- Modify: `server/pmc-mini-app/bookingDraft.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Test: `tests/pmc-mini-app/evidenceBatch.test.ts`
- Test: `tests/pmc-mini-app/evidenceBatchApi.test.ts`
- Test: `tests/pmc-mini-app/bookingDraft.test.ts`

**Interfaces:**

```ts
export interface EvidenceBatch {
  paymentFiles: ParsedEvidenceFile[]
  chatFiles: ParsedEvidenceFile[]
  totalBytes: number
}

export function consumeEvidenceBatchMultipart(
  req: IncomingMessage,
  limits: {
    maxFilesPerKind: 10
    maxFileBytes: 10_000_000
    maxTotalBytes: 25_000_000
  },
): Promise<EvidenceBatch>
```

Endpoint:

```text
POST /api/mini-app/booking-drafts/:draftId/evidence-batch
```

- [ ] **Step 1: Write failing parser tests**

Cover unknown fields, eleven files in one kind, per-file limit, total limit, incomplete stream, unsupported magic, and missing payment/chat evidence.

- [ ] **Step 2: Write failing API test**

```ts
it('stages three payment files and one chat file with one draft write', async () => {
  const response = await uploadBatch({ paymentCount: 3, chatCount: 1 })
  expect(response.status).toBe(200)
  expect(response.body).toMatchObject({ state: 'DRAFT' })
  expect(store.writeCount()).toBe(1)
})
```

Verify order, ownership, deterministic retries, partial network recovery, and that `/evidence?kind=` remains active when async mode is off.

Also verify cancellation with staged object keys sets `PENDING_APPROVAL` and does not delete the staged objects.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/evidenceBatch.test.ts tests/pmc-mini-app/evidenceBatchApi.test.ts
```

- [ ] **Step 4: Implement bounded parallel staging**

Stage at most four objects concurrently, restore original order by input index, and write all object keys to the draft once. A repeated batch must reuse deterministic objects.

Update booking-draft validation so asynchronous mode treats ordered staging object keys as required evidence while synchronous mode continues to require Drive file IDs. The later PATCH that saves customer/booking input performs the `DRAFT -> READY_TO_CONFIRM` transition.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/evidenceBatch.test.ts tests/pmc-mini-app/evidenceBatchApi.test.ts tests/pmc-mini-app/bookingDraft.test.ts tests/pmc-mini-app/evidenceApi.test.ts tests/pmc-mini-app/bookingApi.test.ts
npx tsc -p tsconfig.server.json --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/evidenceBatch.ts server/pmc-mini-app/bookingDraft.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/runtime.ts tests/pmc-mini-app/evidenceBatch.test.ts tests/pmc-mini-app/evidenceBatchApi.test.ts tests/pmc-mini-app/bookingDraft.test.ts
git commit -m "feat: add fast evidence batch staging"
```

---

### Task 6: Deterministic Cloud Tasks enqueue and HTTP 202 confirmation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `server/pmc-mini-app/taskQueue.ts`
- Modify: `server/pmc-mini-app/bookingDraft.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Modify: `src/apps/pmc-mini-app/contracts.ts`
- Test: `tests/pmc-mini-app/taskQueue.test.ts`
- Test: `tests/pmc-mini-app/bookingApi.test.ts`
- Test: `tests/pmc-mini-app/bookingDraft.test.ts`

**Interfaces:**

```ts
export interface BookingTaskQueuePort {
  enqueue(input: {
    requestId: string
    draftId: string
    scheduleAt: Date
  }): Promise<{ taskName: string; alreadyExists: boolean }>
}

export interface BookingQueuedResult {
  requestId: string
  status: 'QUEUED'
}

export function createGoogleBookingTaskQueue(input: {
  projectId: string
  location: 'asia-southeast1'
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  client?: CloudTasksClient
}): BookingTaskQueuePort
```

- [ ] **Step 1: Install the official client**

```bash
npm install @google-cloud/tasks
```

- [ ] **Step 2: Write failing task-contract tests**

Assert queue path, deterministic task name, POST method, exact worker URL, two-second delay, five-minute dispatch deadline, body containing only request/draft IDs, OIDC email/audience, and gRPC code 6 treated as idempotent success. Add a booking-draft test proving the payload hash includes the ordered staging object keys before Drive IDs exist.

- [ ] **Step 3: Write failing confirmation API tests**

```ts
it('returns 202 without calling Apps Script inline', async () => {
  const response = await confirmAsyncReadyDraft()
  expect(response).toEqual({
    status: 202,
    body: { requestId: 'request-1', status: 'QUEUED' },
  })
  expect(bookingIngress.send).not.toHaveBeenCalled()
})
```

Cover feature flag off, owner-only pilot, task creation failure, `ALREADY_EXISTS`, and Sheet update lost after task creation.

- [ ] **Step 4: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/taskQueue.test.ts tests/pmc-mini-app/bookingApi.test.ts tests/pmc-mini-app/bookingDraft.test.ts
```

- [ ] **Step 5: Implement enqueue-before-state ordering**

```ts
const task = await taskQueue.enqueue({
  requestId,
  draftId,
  scheduleAt: new Date(nowMs + 2_000),
})
const queued = await store.queueDraft(requestId, payloadHash, task.taskName, nowIso)
respond(res, 202, { requestId: queued.requestId, status: 'QUEUED' })
```

Task 8 handles the safe `READY_TO_CONFIRM` race.

- [ ] **Step 6: Verify GREEN and commit**

```bash
npx vitest run tests/pmc-mini-app/taskQueue.test.ts tests/pmc-mini-app/bookingApi.test.ts
npx tsc -p tsconfig.server.json --noEmit
npm run lint
git add package.json package-lock.json server/pmc-mini-app/taskQueue.ts server/pmc-mini-app/bookingDraft.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/runtime.ts src/apps/pmc-mini-app/contracts.ts tests/pmc-mini-app/taskQueue.test.ts tests/pmc-mini-app/bookingApi.test.ts tests/pmc-mini-app/bookingDraft.test.ts
git commit -m "feat: enqueue Mini App booking finalization"
```

---

### Task 7: OIDC-authenticated worker route

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `server/pmc-mini-app/workerAuth.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Test: `tests/pmc-mini-app/workerAuth.test.ts`
- Test: `tests/pmc-mini-app/workerRoute.test.ts`

**Interfaces:**

```ts
export interface WorkerIdentityVerifier {
  verify(token: string): Promise<{ email: string; subject: string }>
}

export function createWorkerIdentityVerifier(input: {
  audience: string
  allowedEmail: string
  client?: OAuth2Client
}): WorkerIdentityVerifier
```

Worker endpoint:

```text
POST /internal/mini-app/finalize-booking
```

- [ ] **Step 1: Install the direct auth dependency**

```bash
npm install google-auth-library
```

- [ ] **Step 2: Write failing identity tests**

Cover missing/malformed bearer token, wrong audience, unverified email, wrong email, and accepted Google-signed token. Assert safe error codes only.

- [ ] **Step 3: Write failing route/lease tests**

Verify OIDC before Sheet access, exact task-body keys, safe IDs, first claim, race claim from matching `READY_TO_CONFIRM`, live-lease conflict, and expired-lease reclaim.

After OIDC succeeds, parse `X-CloudTasks-TaskRetryCount` as an integer from 0 through 7 and pass `attempt = retryCount + 1` to the worker. Reject missing, repeated, negative, non-integer, or out-of-range retry headers.

- [ ] **Step 4: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/workerAuth.test.ts tests/pmc-mini-app/workerRoute.test.ts
```

- [ ] **Step 5: Implement fail-closed verification**

Call `verifyIdToken({ idToken, audience })`, require `email_verified === true`, and compare the exact configured email. Never log authorization headers, tokens, or decoded payloads.

- [ ] **Step 6: Verify GREEN and commit**

```bash
npx vitest run tests/pmc-mini-app/workerAuth.test.ts tests/pmc-mini-app/workerRoute.test.ts tests/pmc-mini-app/security.test.ts
npx tsc -p tsconfig.server.json --noEmit
npm run lint
git add package.json package-lock.json server/pmc-mini-app/workerAuth.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/runtime.ts tests/pmc-mini-app/workerAuth.test.ts tests/pmc-mini-app/workerRoute.test.ts
git commit -m "feat: authenticate async booking worker"
```

---

### Task 8: Durable background finalization orchestration

**Files:**
- Create: `server/pmc-mini-app/asyncWorker.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Modify: `server/pmc-mini-app/evidenceIngressClient.ts`
- Modify: `server/pmc-mini-app/bookingIngressClient.ts`
- Test: `tests/pmc-mini-app/asyncWorker.test.ts`

**Interfaces:**

```ts
export interface AsyncBookingWorker {
  finalize(input: { requestId: string; draftId: string; attempt: number }): Promise<{
    requestId: string
    caseId: string | null
    state: 'CONFIRMED' | 'RETRYING' | 'NEEDS_REVIEW'
  }>
}

export function createAsyncBookingWorker(input: {
  store: MiniAppStore & AsyncMiniAppStore
  staging: EvidenceStagingPort
  evidenceIngress: EvidenceIngressPort
  bookingIngress: BookingIngressPort
  now: () => Date
}): AsyncBookingWorker
```

- [ ] **Step 1: Write failing success-path test**

Assert ordered staged reads, deterministic Drive uploads, one Drive-ID draft update, one booking-ingress call, final Case ID/state, and staged deletion only after Drive verification.

- [ ] **Step 2: Write failing retry/idempotency tests**

Cover existing Drive IDs, evidence-copy failure, Apps Script timeout followed by same Case ID, attempts 1–7 returning retryable failure, attempt 8 setting `NEEDS_REVIEW`, and replay after a terminal state producing no side effect.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/asyncWorker.test.ts
```

- [ ] **Step 4: Implement explicit worker stages**

```ts
async function copyEvidenceToDrive(draft: MiniAppRequestRecord): Promise<MiniAppRequestRecord>
async function submitBooking(draft: MiniAppRequestRecord): Promise<MiniAppBookingIngressResult>
async function recordCompletion(draft: MiniAppRequestRecord, result: MiniAppBookingIngressResult): Promise<MiniAppRequestRecord>
async function cleanupVerifiedStaging(draft: MiniAppRequestRecord): Promise<void>
```

Each stage updates `lastProgressAt`. Map every exception to an allowlisted safe code before a state mutation or telemetry event.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npx vitest run tests/pmc-mini-app/asyncWorker.test.ts tests/pmc-mini-app/evidenceIngressClient.test.ts tests/pmc-mini-app/bookingIngressClient.test.ts
npx tsc -p tsconfig.server.json --noEmit
npm run lint
git add server/pmc-mini-app/asyncWorker.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/runtime.ts server/pmc-mini-app/evidenceIngressClient.ts server/pmc-mini-app/bookingIngressClient.ts tests/pmc-mini-app/asyncWorker.test.ts
git commit -m "feat: finalize bookings in Cloud Tasks worker"
```

---

### Task 9: Extend Apps Script result with safe projection states

**Files:**
- Modify: `shared/pmcMiniAppBooking.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/miniAppSubmit.ts`
- Modify: `server/pmc-mini-app/bookingIngressClient.ts`
- Modify: `server/pmc-mini-app/asyncWorker.ts`
- Test: `apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts`
- Test: `tests/pmc-mini-app/bookingIngressClient.test.ts`
- Test: `tests/pmc-mini-app/asyncWorker.test.ts`

**Interfaces:**

Extend `BookingDraftProjection` with `caseId`, `safeErrorCode`, `queuedAt`, and `lastProgressAt` so polling and resume render only server state.

```ts
export interface MiniAppBookingIngressResult {
  caseId: string
  status: MiniAppIngressStatus
  driveState: 'OK' | 'RETRY'
  calendarState: 'PENDING' | 'OK' | 'RETRY' | 'CONFLICT'
  lineState: 'PENDING' | 'OK' | 'RETRY'
}
```

- [ ] **Step 1: Write failing Apps Script result tests**

Verify first submission and verified duplicate return identical Case ID and safe states. Assert no names, phone, evidence, Drive URL, Calendar event ID, or LINE target appears. Add a worker test proving any `RETRY`/`CONFLICT` projection produces `CONFIRMED_WITH_RETRY` while preserving the Case ID.

- [ ] **Step 2: Write failing Cloud Run validation tests**

Reject missing, unknown, or extra result fields and unknown state values.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts tests/pmc-mini-app/bookingIngressClient.test.ts
```

- [ ] **Step 4: Implement exact result projection**

Map directly from the final `BookingCase`. Keep the response exact and bounded. Update `AsyncBookingWorker` to return `CONFIRMED_WITH_RETRY` when any projection is not `OK`.

- [ ] **Step 5: Verify Apps Script build without pushing**

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npx vitest run tests/pmc-mini-app/bookingIngressClient.test.ts
```

Do not run `booking:push` in this task.

- [ ] **Step 6: Commit**

```bash
git add shared/pmcMiniAppBooking.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/src/workflows/miniAppSubmit.ts server/pmc-mini-app/bookingIngressClient.ts server/pmc-mini-app/asyncWorker.ts apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts tests/pmc-mini-app/bookingIngressClient.test.ts tests/pmc-mini-app/asyncWorker.test.ts
git commit -m "feat: return booking projection states"
```

---

### Task 10: Mini App batch upload, acknowledgement, polling, and resume

**Files:**
- Create: `src/apps/pmc-mini-app/BookingProcessing.tsx`
- Modify: `src/apps/pmc-mini-app/contracts.ts`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/BookingWizard.tsx`
- Modify: `src/apps/pmc-mini-app/styles.css`
- Modify: `src/apps/pmc-mini-app/preview.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Test: `tests/pmc-mini-app/api.test.ts`
- Test: `tests/pmc-mini-app/bookingWizard.test.tsx`
- Test: `tests/pmc-mini-app/bookingProcessing.test.tsx`
- Test: `tests/pmc-mini-app/clientShell.test.tsx`
- Test: `tests/pmc-mini-app/browserAcceptance.spec.ts`

**Interfaces:**

```ts
uploadEvidenceBatch(
  idToken: string,
  draftId: string,
  input: { paymentFiles: File[]; chatFiles: File[] },
): Promise<BookingDraftProjection>

loadLatestActiveDraft(idToken: string): Promise<BookingDraftProjection | null>

confirm(
  idToken: string,
  draftId: string,
  version: number,
): Promise<BookingQueuedResult | BookingConfirmationResult>
```

New endpoint:

```text
GET /api/mini-app/booking-drafts/active
```

- [ ] **Step 1: Write failing browser API tests**

Verify payment/chat multipart fields, HTTP 202 parsing, active-draft auth, and terminal projection parsing.

- [ ] **Step 2: Write failing processing UI tests**

With fake timers, verify polling every 2–3 seconds for 30 seconds, every 5 seconds through 60 seconds, terminal stop, close-safe copy, Case ID, `CONFIRMED_WITH_RETRY`, and `NEEDS_REVIEW` copy that never instructs resubmission.

- [ ] **Step 3: Write failing resume test**

```ts
it('opens the latest active request instead of creating another draft', async () => {
  const api = miniAppApi({ activeDraft: queuedDraftFixture() })
  render(<PmcMiniApp api={api} />)
  expect(await screen.findByText('รับรายการแล้ว')).toBeVisible()
  expect(api.createDraft).not.toHaveBeenCalled()
})
```

- [ ] **Step 4: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/api.test.ts tests/pmc-mini-app/bookingWizard.test.tsx tests/pmc-mini-app/bookingProcessing.test.tsx tests/pmc-mini-app/clientShell.test.tsx
```

- [ ] **Step 5: Implement state-driven UI**

`BookingProcessing` renders only server state, uses an `AbortController` per poll, clears timers on unmount, keeps 48 px tap targets, and uses the approved Thai copy.

- [ ] **Step 6: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/api.test.ts tests/pmc-mini-app/bookingWizard.test.tsx tests/pmc-mini-app/bookingProcessing.test.tsx tests/pmc-mini-app/clientShell.test.tsx
npx playwright test --config=playwright.mini-app.config.ts
npm run build:mini-app
```

- [ ] **Step 7: Commit**

```bash
git add src/apps/pmc-mini-app/BookingProcessing.tsx src/apps/pmc-mini-app/contracts.ts src/apps/pmc-mini-app/api.ts src/apps/pmc-mini-app/PmcMiniApp.tsx src/apps/pmc-mini-app/BookingWizard.tsx src/apps/pmc-mini-app/styles.css src/apps/pmc-mini-app/preview.ts server/pmc-mini-app/middleware.ts tests/pmc-mini-app/api.test.ts tests/pmc-mini-app/bookingWizard.test.tsx tests/pmc-mini-app/bookingProcessing.test.tsx tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/browserAcceptance.spec.ts
git commit -m "feat: acknowledge and resume async bookings"
```

---

### Task 11: Safe telemetry, runtime checker, and runbook

**Files:**
- Create: `server/pmc-mini-app/asyncTelemetry.ts`
- Create: `tests/pmc-mini-app/asyncTelemetry.test.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Modify: `server/pmc-mini-app/asyncWorker.ts`
- Create: `scripts/check-pmc-async-runtime.mjs`
- Create: `tests/pmc-mini-app/asyncRuntimeCheck.test.ts`
- Create: `docs/pmc-mini-app/async-booking-runbook.md`
- Modify: `docs/pmc-mini-app/pilot-runbook.md`

**Interfaces:**

```ts
export type AsyncBookingEventName =
  | 'evidence_stage_started'
  | 'evidence_stage_completed'
  | 'booking_task_enqueued'
  | 'booking_worker_claimed'
  | 'drive_copy_completed'
  | 'booking_ingress_completed'
  | 'booking_worker_retrying'
  | 'booking_worker_completed'
  | 'booking_worker_needs_review'

export function asyncBookingEvent(
  name: AsyncBookingEventName,
  fields: {
    requestId: string
    draftId: string
    caseId?: string
    attempt?: number
    state?: string
    safeErrorCode?: string
    elapsedMs?: number
    fileCount?: number
    totalBytes?: number
  },
): Record<string, string | number>
```

- [ ] **Step 1: Write failing telemetry tests**

Reject unknown fields and values resembling Thai phone numbers, URLs, bearer tokens, or evidence content. Accept only safe IDs, counts, states, error codes, and timings.

- [ ] **Step 2: Write failing runtime-check tests**

Require reports for API enablement, resource existence/location, IAM role names, queue retry settings, bucket public-access prevention, and env-name presence without printing resource values or emails.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/asyncTelemetry.test.ts tests/pmc-mini-app/asyncRuntimeCheck.test.ts
```

- [ ] **Step 4: Implement telemetry and checker**

The checker accepts `--project`, `--region`, `--service`, `--bucket`, `--queue`, and `--strict`; output booleans, counts, role names, and safe status names only.

Wire telemetry into evidence staging, task enqueue, worker claim, Drive copy, booking ingress, retry, completion, and review transitions. Implement `--help` with exit 0 and no Google API calls.

- [ ] **Step 5: Write gated runbook commands**

Document but do not execute:

```bash
gcloud services enable cloudtasks.googleapis.com storage.googleapis.com iamcredentials.googleapis.com
gcloud storage buckets create gs://pmc-mini-app-evidence-staging --location=asia-southeast1 --uniform-bucket-level-access --public-access-prevention
gcloud tasks queues create pmc-booking-finalize --location=asia-southeast1 --max-concurrent-dispatches=1 --max-dispatches-per-second=2 --max-attempts=8 --min-backoff=10s --max-backoff=300s --max-retry-duration=86400s
gcloud iam service-accounts create pmc-mini-app-task-invoker --display-name="PMC Mini App task invoker"
```

Also document narrow bucket/queue/service/IAM bindings, feature-off env update, Sheet migration, Apps Script versioning, no-traffic deploy, synthetic acceptance, owner pilot, all-staff rollout, and rollback.

Include safe log queries for acknowledgement/background p50 and p95 latency, task retries, `NEEDS_REVIEW`, and a monthly cost check against the approved 0–20 baht incremental estimate.

- [ ] **Step 6: Verify GREEN and commit**

```bash
npx vitest run tests/pmc-mini-app/asyncTelemetry.test.ts tests/pmc-mini-app/asyncRuntimeCheck.test.ts
node scripts/check-pmc-async-runtime.mjs --help
git diff --check
git add server/pmc-mini-app/asyncTelemetry.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/runtime.ts server/pmc-mini-app/asyncWorker.ts tests/pmc-mini-app/asyncTelemetry.test.ts scripts/check-pmc-async-runtime.mjs tests/pmc-mini-app/asyncRuntimeCheck.test.ts docs/pmc-mini-app/async-booking-runbook.md docs/pmc-mini-app/pilot-runbook.md
git commit -m "docs: add async booking operations gates"
```

---

### Task 12: Full verification and gated production rollout

**Files:**
- No planned source edits. A failure returns execution to the task that owns the failing behavior.
- Operational evidence remains in safe command output; do not create a patient-data report file.

**Interfaces:** Consumes all interfaces from Tasks 1–11 and produces a verified disabled-first revision, then an owner-only pilot, then all-staff enablement after separate approvals.

- [ ] **Step 1: Run the complete local gate**

```bash
npm ci
npm test
npm run lint
npm run build
npm run booking:test
npm run booking:typecheck
npm run booking:build
npx playwright test --config=playwright.mini-app.config.ts
node scripts/check-pmc-mini-app-runtime.mjs --env-file /dev/null
git diff --check
```

Expected: all checks pass. If the known OCR cold-build test exceeds its 20-second harness timeout, run `npx vitest run tests/ocr-ledger/job.test.ts` and then `npx vitest run --exclude tests/ocr-ledger/job.test.ts`; both partitions must pass.

- [ ] **Step 2: Run the mutation/security checklist**

Confirm that tests fail when task-name determinism, OIDC audience/email validation, processing leases, Drive-before-cleanup ordering, or terminal replay guards are removed. Verify logs contain no customer fields, evidence bytes, URLs, or credentials.

- [ ] **Step 3: OWNER GATE A — infrastructure**

Stop for explicit approval before enabling APIs, creating the bucket/queue/task identity, or changing IAM. After approval, execute the runbook and verify:

```bash
node scripts/check-pmc-async-runtime.mjs --project project-2099d92f-51c8-4d2b-a8c --region asia-southeast1 --service pmc-mini-app --bucket pmc-mini-app-evidence-staging --queue pmc-booking-finalize --strict
```

Expected: exit 0 with safe readiness fields only.

- [ ] **Step 4: OWNER GATE B — Sheet migration**

Stop for explicit approval. Run the append-only migration once, read row 1 back, and report only appended column names and row count. Do not print Sheet ID or row values.

- [ ] **Step 5: OWNER GATE C — Apps Script deployment**

Stop for explicit approval. Verify account/project, push the built bundle, create an immutable version, and update only the deployment referenced by `PMC_BOOKING_INGRESS_URL`. Run a synthetic signed probe for the projection-state response without printing secrets or deployment IDs.

- [ ] **Step 6: OWNER GATE D — disabled-first Cloud Run revision**

Stop for explicit approval. Deploy a tagged 0% traffic revision with `PMC_MINI_APP_ASYNC_ENABLED=false`. Verify health 200, Mini App 200, public config 200, session without token 401, worker without OIDC 401/403, expected service account/env names, and unchanged legacy routes.

- [ ] **Step 7: OWNER GATE E — owner-only synthetic acceptance**

Stop for explicit approval. Enable async mode only for the owner's staff ID. Submit one synthetic normal and one synthetic automatic booking, each with three payment images and one chat image.

Acceptance criteria:

```text
evidence acknowledgement <= 5 seconds
confirmation acknowledgement <= 3 seconds
background completion <= 60 seconds
one request and one task
one Case ID
four ordered Drive files
one case folder
one Calendar event for the normal booking
expected LINE messages
zero duplicate side effects
staging deletion only after Drive verification
```

- [ ] **Step 8: OWNER GATE F — all-staff enablement**

Stop for explicit approval after owner acceptance. Remove the owner-only restriction while keeping async enabled. Verify one staff booking and safe latency/error metrics before declaring rollout complete.

- [ ] **Step 9: Prove rollback**

Create a 0% traffic revision with the feature flag false, verify synchronous and Google Form fallbacks, then restore the accepted async revision. Do not delete the bucket, queue, tasks, staged objects, or Sheet columns.

- [ ] **Step 10: Record final safe evidence**

Report only commit SHA, Cloud Run revision, Apps Script version, synthetic request/Case IDs, safe counts, latencies, pass/fail, reviewer, and timestamp. Exclude customer data, tokens, resource IDs, task names, Drive URLs, and unrestricted logs.
