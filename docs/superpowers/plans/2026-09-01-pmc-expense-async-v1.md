# PMC Expense Async V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acknowledge a validated expense within 3 seconds after evidence staging, return the LINE Mini App to Finance Home, and complete the existing PREPARE/evidence/COMMIT workflow through an idempotent private Cloud Task.

**Architecture:** Cloud Run resolves staff-bound staging receipts, creates an atomically fenced job in a dedicated private GCS bucket, enqueues one deterministic task, and returns HTTP 202. An OIDC worker claims the job and invokes the existing `ExpenseSubmissionService`; resume reads the async job first and falls back to the existing Apps Script journal for legacy roots.

**Tech Stack:** TypeScript 6, Node.js 24, React 19, Vite 8, Vitest 4, Google Cloud Storage, Google Cloud Tasks, Cloud Run, Google Auth Library, Apps Script, LINE LIFF, Google Sheets, Google Drive.

**Spec:** `docs/superpowers/specs/2026-09-01-pmc-expense-async-v1-design.md`

## Global Constraints

- `PMC_EXPENSE_ASYNC_ENABLED` defaults to `false`; synchronous submission remains the rollback path.
- Async applies only to immutable staff IDs listed in `PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS` until owner acceptance.
- Queue `pmc-expense-finalize` is separate from `pmc-booking-finalize` and starts at one concurrent dispatch.
- Job bucket `pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c` is private, uses Uniform Bucket-Level Access, Public Access Prevention, region `asia-southeast1`, and a 7-day delete lifecycle.
- Task bodies contain only `rootRequestId` and `fingerprint`; no financial, customer, staff-display, evidence, Drive, or credential data.
- GCS job writes use generation-match fencing; Cloud Tasks names are deterministic; financial effects remain guarded by the existing PREPARE/COMMIT journal, submission lease, Drive slot claim, and Apps Script lock.
- Only effective `COMMITTED` rows enter reports. `QUEUED`, `PROCESSING`, `RETRYING`, `FAILED`, and `NEEDS_REVIEW` jobs never enter financial totals.
- Create and Replace use async; Void remains synchronous.
- No live infrastructure, traffic, feature-flag, or pilot-staff mutation runs before its explicit task verification gate.
- No owner acceptance claim is made without one brand-new Bill Document submitted through the real LINE Mini App after async enablement.

## Planned File Structure

New shared contract:

- `shared/pmcExpenseAsync.ts` — canonical job/ack/task types and strict validators.

New server modules:

- `server/pmc-mini-app/finance/asyncConfig.ts` — fail-closed async bindings and pilot list.
- `server/pmc-mini-app/finance/asyncJobStore.ts` — generation-fenced private GCS jobs.
- `server/pmc-mini-app/finance/taskQueue.ts` — deterministic finance Cloud Task creation.
- `server/pmc-mini-app/finance/asyncWorker.ts` — leased worker around `ExpenseSubmissionService`.
- `server/pmc-mini-app/finance/asyncTelemetry.ts` — safe structured timing events.

New operations artifacts:

- `scripts/check-pmc-expense-async-runtime.mjs` — read-only deployment and infrastructure checker.
- `docs/pmc-mini-app/expense-async-runbook.md` — pilot, rollback, incident, and acceptance steps.

Existing files modified:

- `server/pmc-mini-app/finance/config.ts`
- `server/pmc-mini-app/config.ts`
- `server/pmc-mini-app/contracts.ts`
- `server/pmc-mini-app/runtime.ts`
- `server/pmc-mini-app/finance/middleware.ts`
- `server/pmc-mini-app/middleware.ts`
- `src/apps/pmc-mini-app/contracts.ts`
- `src/apps/pmc-mini-app/api.ts`
- `src/apps/pmc-mini-app/expense/ExpenseForm.tsx`
- `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- `src/apps/pmc-mini-app/preview.ts`

---

### Task 1: Shared async expense contract and fail-closed configuration

**Files:**
- Create: `shared/pmcExpenseAsync.ts`
- Modify: `shared/pmcMiniAppExpenseIngress.ts`
- Create: `server/pmc-mini-app/finance/asyncConfig.ts`
- Modify: `server/pmc-mini-app/finance/config.ts`
- Modify: `server/pmc-mini-app/config.ts`
- Test: `tests/pmc-mini-app/expenseAsyncContract.test.ts`
- Test: `tests/pmc-mini-app/expenseAsyncConfig.test.ts`
- Test: `tests/pmc-mini-app/expenseRuntimeConfig.test.ts`

**Interfaces:**

- Consumes: existing expense domain types, environment bindings, and Booking queue name from `PmcMiniAppServerConfig`.
- Produces: shared acknowledgement/task/state types plus `PmcExpenseAsyncConfig` for all later tasks.

```ts
export type ExpenseAsyncJobState =
  | 'QUEUING' | 'QUEUED' | 'PROCESSING' | 'RETRYING'
  | 'COMMITTED' | 'FAILED' | 'NEEDS_REVIEW'

export type ExpenseAsyncOperation =
  | { kind: 'CREATE'; replacementOfExpenseId: null; expectedVersion: null }
  | { kind: 'REPLACE'; replacementOfExpenseId: string; expectedVersion: number }

export interface ExpenseAsyncAck {
  rootRequestId: string
  status: 'PENDING'
  acceptedAt: string
}

export interface ExpenseAsyncTaskPayload {
  rootRequestId: string
  fingerprint: string
}

export function parseExpenseAsyncAck(value: unknown): ExpenseAsyncAck
```

```ts
export interface PmcExpenseAsyncConfig {
  enabled: true
  projectId: string
  location: 'asia-southeast1'
  jobBucketName: string
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  pilotStaffIds: ReadonlySet<string>
}

export function readPmcExpenseAsyncConfig(
  env: Record<string, string | undefined>,
  bookingQueueName: string | null,
): PmcExpenseAsyncConfig | null
```

- [ ] **Step 1: Write failing shared-contract tests**

```ts
expect(parseExpenseAsyncAck({
  rootRequestId: 'request-1',
  status: 'PENDING',
  acceptedAt: '2026-09-01T18:00:00.000Z',
})).toEqual({
  rootRequestId: 'request-1',
  status: 'PENDING',
  acceptedAt: '2026-09-01T18:00:00.000Z',
})

expect(() => parseExpenseAsyncAck({
  rootRequestId: 'request-1',
  status: 'COMMITTED',
  acceptedAt: '2026-09-01T18:00:00.000Z',
})).toThrow('EXPENSE_ASYNC_INVALID_ACK')
```

- [ ] **Step 2: Write failing configuration tests**

```ts
expect(readPmcExpenseAsyncConfig({ PMC_EXPENSE_ASYNC_ENABLED: 'false' }, null)).toBeNull()

expect(readPmcExpenseAsyncConfig({
  PMC_EXPENSE_ASYNC_ENABLED: 'true',
  PMC_GCP_PROJECT_ID: 'project-2099d92f-51c8-4d2b-a8c',
  PMC_ASYNC_LOCATION: 'asia-southeast1',
  PMC_EXPENSE_ASYNC_JOB_BUCKET: 'pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c',
  PMC_EXPENSE_ASYNC_QUEUE: 'pmc-expense-finalize',
  PMC_EXPENSE_ASYNC_WORKER_URL: 'https://pmc.example/internal/mini-app/finalize-expense',
  PMC_EXPENSE_ASYNC_WORKER_AUDIENCE: 'https://pmc.example',
  PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL: 'pmc-mini-app-task-invoker@project-2099d92f-51c8-4d2b-a8c.iam.gserviceaccount.com',
  PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS: 'STAFF_OWNER',
}, 'pmc-booking-finalize')).toMatchObject({
  enabled: true,
  location: 'asia-southeast1',
  queueName: 'pmc-expense-finalize',
})
```

Add negative cases for an expense queue equal to the Booking queue, job bucket equal to either evidence staging bucket, empty/duplicate pilot IDs, credentialed URLs, wrong region, and malformed task-invoker email.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/expenseAsyncContract.test.ts tests/pmc-mini-app/expenseAsyncConfig.test.ts tests/pmc-mini-app/expenseRuntimeConfig.test.ts
```

Expected: FAIL because the shared contract, async parser, and finance-config property do not exist.

- [ ] **Step 4: Implement strict shared validators and configuration**

Add `async: PmcExpenseAsyncConfig | null` to `PmcFinanceConfig`. Parse async only when `PMC_EXPENSE_ASYNC_ENABLED=true`. Keep the existing finance config valid when async is absent or false. Do not serialize configured values to client config or runtime-check output.

Add `EXPENSE_NEEDS_REVIEW` to the shared allowlisted expense error union and reject it everywhere except async terminal projection.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/expenseAsyncContract.test.ts tests/pmc-mini-app/expenseAsyncConfig.test.ts tests/pmc-mini-app/expenseRuntimeConfig.test.ts
npm run build:server
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add shared/pmcExpenseAsync.ts shared/pmcMiniAppExpenseIngress.ts server/pmc-mini-app/finance/asyncConfig.ts server/pmc-mini-app/finance/config.ts server/pmc-mini-app/config.ts tests/pmc-mini-app/expenseAsyncContract.test.ts tests/pmc-mini-app/expenseAsyncConfig.test.ts tests/pmc-mini-app/expenseRuntimeConfig.test.ts
git commit -m "feat: define async expense runtime contract"
```

---

### Task 2: Generation-fenced GCS async job store

**Files:**
- Create: `server/pmc-mini-app/finance/asyncJobStore.ts`
- Test: `tests/pmc-mini-app/expenseAsyncJobStore.test.ts`

**Interfaces:**

- Consumes: Task 1 async state/operation types and existing `ExpenseSubmissionInput`/`ExpenseReceipt` types.
- Produces: `ExpenseAsyncJob`, canonical fingerprint functions, and `ExpenseAsyncJobStore` for middleware and worker tasks.

```ts
export type ExpenseAsyncJobInput = ExpenseAsyncOperation & {
  submission: ExpenseSubmissionInput
  acceptedAt: string
}

export interface ExpenseAsyncJob extends ExpenseAsyncJobInput {
  version: 1
  generation: string
  fingerprint: string
  state: ExpenseAsyncJobState
  taskName: string | null
  createdAt: string
  updatedAt: string
  attemptCount: number
  leaseOwnerToken: string | null
  leaseExpiresAt: string | null
  receipt: ExpenseReceipt | null
  safeErrorCode: MiniAppExpenseSafeErrorCode | 'EXPENSE_NEEDS_REVIEW' | null
}

export function canonicalExpenseAsyncJobInput(input: ExpenseAsyncJobInput): string
export function expenseAsyncFingerprint(input: ExpenseAsyncJobInput): string

export interface ExpenseAsyncJobStore {
  createOrRead(input: ExpenseAsyncJobInput): Promise<{
    job: ExpenseAsyncJob
    created: boolean
  }>
  markQueued(job: ExpenseAsyncJob, taskName: string): Promise<ExpenseAsyncJob>
  read(rootRequestId: string): Promise<ExpenseAsyncJob | null>
  claim(input: {
    rootRequestId: string
    fingerprint: string
    ownerToken: string
    leaseExpiresAt: string
    taskAttempt: number
  }): Promise<ExpenseAsyncJob>
  renew(job: ExpenseAsyncJob, leaseExpiresAt: string): Promise<ExpenseAsyncJob>
  markRetrying(job: ExpenseAsyncJob, safeErrorCode: string): Promise<ExpenseAsyncJob>
  commit(job: ExpenseAsyncJob, receipt: ExpenseReceipt): Promise<ExpenseAsyncJob>
  fail(job: ExpenseAsyncJob, safeErrorCode: MiniAppExpenseSafeErrorCode): Promise<ExpenseAsyncJob>
  needsReview(job: ExpenseAsyncJob): Promise<ExpenseAsyncJob>
}

export function createGoogleExpenseAsyncJobStore(input: {
  bucketName: string
  storage?: Storage
  now?: () => string
}): ExpenseAsyncJobStore
```

- [ ] **Step 1: Write failing create/replay tests**

```ts
const first = await store.createOrRead(input)
const replay = await store.createOrRead(structuredClone(input))
expect(first.created).toBe(true)
expect(replay.created).toBe(false)
expect(replay.job.fingerprint).toBe(first.job.fingerprint)
await expect(store.createOrRead({ ...input, submissionInput: changedInput }))
  .rejects.toMatchObject({ code: 'EXPENSE_IDEMPOTENCY_CONFLICT' })
```

- [ ] **Step 2: Write failing fencing tests**

Cover create-only generation 0, stale-generation rejection, first claim, live-lease rejection, expired-lease reclaim, owner-only renew, exact terminal replay, terminal immutability, and rejection of malformed persisted JSON or custom metadata.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/expenseAsyncJobStore.test.ts
```

Expected: FAIL because the store and state validators do not exist.

- [ ] **Step 4: Implement canonical persisted JSON and generation preconditions**

Use object key `expense-async-jobs/v1/<rootRequestId>.json`, `cacheControl: no-store`, `contentType: application/json`, exact keys, bounded size, and GCS generation-match on every write. Never list the bucket.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/expenseAsyncJobStore.test.ts tests/pmc-mini-app/expenseStaging.test.ts
npm run build:server
```

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/finance/asyncJobStore.ts tests/pmc-mini-app/expenseAsyncJobStore.test.ts
git commit -m "feat: add fenced async expense job store"
```

---

### Task 3: Deterministic expense task queue and safe telemetry

**Files:**
- Create: `server/pmc-mini-app/finance/taskQueue.ts`
- Create: `server/pmc-mini-app/finance/asyncTelemetry.ts`
- Test: `tests/pmc-mini-app/expenseTaskQueue.test.ts`
- Test: `tests/pmc-mini-app/expenseAsyncTelemetry.test.ts`

**Interfaces:**

- Consumes: Task 1 task payload/config types.
- Produces: `ExpenseTaskQueue` and `ExpenseAsyncTelemetry` for Task 4 and Task 5.

```ts
export interface ExpenseTaskQueue {
  enqueue(input: ExpenseAsyncTaskPayload & { scheduleAt: Date }): Promise<{
    taskName: string
    alreadyExists: boolean
  }>
}

export function createGoogleExpenseTaskQueue(input: {
  projectId: string
  location: 'asia-southeast1'
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  client?: CloudTasksClient
}): ExpenseTaskQueue
```

- [ ] **Step 1: Write failing queue tests**

Assert the task ID is `expense-<sha256(rootRequestId + fingerprint)>`, body contains exactly `rootRequestId,fingerprint`, dispatch deadline is 300 seconds, schedule time is deterministic, OIDC fields match configuration, gRPC 6 returns `alreadyExists: true`, and all other provider failures become `EXPENSE_TASK_QUEUE_FAILED` without provider metadata.

- [ ] **Step 2: Write failing telemetry tests**

```ts
expect(() => emit('expense_job_accepted', {
  route: 'submit', status: 202, state: 'QUEUED', elapsedMs: 20,
})).not.toThrow()
expect(JSON.stringify(log.mock.calls)).not.toMatch(/amount|merchant|description|fileId/i)
```

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/expenseTaskQueue.test.ts tests/pmc-mini-app/expenseAsyncTelemetry.test.ts
```

- [ ] **Step 4: Implement queue and allowlisted event serializer**

Follow `server/pmc-mini-app/taskQueue.ts` for OIDC and gRPC handling but use an independent interface, prefix, and error code. Telemetry accepts only route, action, status, state, attempt, safe error code, file count, and elapsed milliseconds.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/expenseTaskQueue.test.ts tests/pmc-mini-app/expenseAsyncTelemetry.test.ts
npm run build:server
```

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/finance/taskQueue.ts server/pmc-mini-app/finance/asyncTelemetry.ts tests/pmc-mini-app/expenseTaskQueue.test.ts tests/pmc-mini-app/expenseAsyncTelemetry.test.ts
git commit -m "feat: enqueue private async expense tasks"
```

---

### Task 4: Leased async expense worker

**Files:**
- Create: `server/pmc-mini-app/finance/asyncWorker.ts`
- Modify: `server/pmc-mini-app/finance/submissionService.ts`
- Test: `tests/pmc-mini-app/expenseAsyncWorker.test.ts`
- Test: `tests/pmc-mini-app/expenseSubmissionService.test.ts`

**Interfaces:**

- Consumes: Task 2 job store, Task 3 telemetry, and the existing `ExpenseSubmissionService`.
- Produces: `ExpenseAsyncWorker` for the internal worker route.

```ts
export interface ExpenseAsyncWorker {
  finalize(input: {
    rootRequestId: string
    fingerprint: string
    attempt: number
  }): Promise<{
    rootRequestId: string
    state: 'COMMITTED' | 'FAILED' | 'NEEDS_REVIEW'
  }>
}

export function createExpenseAsyncWorker(input: {
  jobs: ExpenseAsyncJobStore
  submission: ExpenseSubmissionService
  now: () => Date
  ownerToken?: () => string
  telemetry?: ExpenseAsyncTelemetry
}): ExpenseAsyncWorker
```

- [ ] **Step 1: Write failing success and terminal replay tests**

```ts
await expect(worker.finalize({ rootRequestId, fingerprint, attempt: 0 }))
  .resolves.toEqual({ rootRequestId, state: 'COMMITTED' })
expect(submission.submit).toHaveBeenCalledOnce()
await worker.finalize({ rootRequestId, fingerprint, attempt: 1 })
expect(submission.submit).toHaveBeenCalledOnce()
```

- [ ] **Step 2: Write failing retry/fencing tests**

Cover retryable `EXPENSE_STORAGE_UNAVAILABLE -> RETRYING + throw`, deterministic `EXPENSE_REVISION_CONFLICT -> FAILED + return`, attempt 8 -> `NEEDS_REVIEW`, owner-token loss before terminal write, reclaim after 240-second lease expiry, fingerprint mismatch, and refusal to begin a phase with under 30 seconds remaining.

- [ ] **Step 3: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/expenseAsyncWorker.test.ts tests/pmc-mini-app/expenseSubmissionService.test.ts
```

- [ ] **Step 4: Implement the worker as orchestration only**

Pass the persisted `ExpenseSubmissionInput` unchanged into `ExpenseSubmissionService`. Renew before and after the call. Let the existing submission service own PREPARE, evidence upload, Drive verification, COMMIT, submission-lease commit, and staging cleanup.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/expenseAsyncWorker.test.ts tests/pmc-mini-app/expenseSubmissionService.test.ts tests/pmc-mini-app/expenseGoogleClient.test.ts
npm run build:server
```

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/finance/asyncWorker.ts server/pmc-mini-app/finance/submissionService.ts tests/pmc-mini-app/expenseAsyncWorker.test.ts tests/pmc-mini-app/expenseSubmissionService.test.ts
git commit -m "feat: finalize expenses in a leased worker"
```

---

### Task 5: Runtime, HTTP 202, worker route, resume, and rollback wiring

**Files:**
- Modify: `server/pmc-mini-app/contracts.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/finance/middleware.ts`
- Test: `tests/pmc-mini-app/expenseApi.test.ts`
- Test: `tests/pmc-mini-app/expenseResume.test.ts`
- Test: `tests/pmc-mini-app/expenseAsyncWorkerRoute.test.ts`
- Test: `tests/pmc-mini-app/sessionApi.test.ts`

**Interfaces:**

- Consumes: Tasks 1–4 config, job store, queue, worker, and existing LINE/OIDC authentication.
- Produces: HTTP 202 create/replace endpoints, the OIDC worker route, safe client config, and async-first resume projection.

```ts
export interface FinanceAsyncDependencies {
  config: PmcExpenseAsyncConfig
  jobs: ExpenseAsyncJobStore
  queue: ExpenseTaskQueue
  worker: ExpenseAsyncWorker
  identity: WorkerIdentityVerifier
}

export interface FinanceServerDependencies {
  // existing fields unchanged
  async?: FinanceAsyncDependencies
}
```

- [ ] **Step 1: Write failing POST 202 tests**

Assert an allowlisted pilot staff create and replacement request resolves staging tokens, writes/replays one job, enqueues once, returns exact HTTP 202 acknowledgement, and never calls `submission.submit` inline. Assert a non-pilot submitter remains on the synchronous route while the flag is enabled.

- [ ] **Step 2: Write failing enqueue-uncertainty tests**

Cover persisted `QUEUING` plus queue provider error -> safe retryable 503, exact retry -> deterministic task replay -> `QUEUED`, and changed input under the same root -> 409 conflict.

- [ ] **Step 3: Write failing resume and worker-route tests**

```ts
expect(await invokeResume(job('PROCESSING'))).toEqual({ status: 'PENDING' })
expect(await invokeResume(job('COMMITTED', receipt))).toEqual({ status: 'COMMITTED', receipt })
expect(await invokeResume(null)).toEqual(await legacyIngress.resume(...))
```

Also assert missing/wrong OIDC token returns 401, malformed task body returns 400, retryable worker error returns 503, and terminal worker result returns 200.

- [ ] **Step 4: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/expenseApi.test.ts tests/pmc-mini-app/expenseResume.test.ts tests/pmc-mini-app/expenseAsyncWorkerRoute.test.ts tests/pmc-mini-app/sessionApi.test.ts
```

- [ ] **Step 5: Implement runtime factories and exact routing**

Construct job store, queue, worker, and `createWorkerIdentityVerifier` only when async config is valid. Route `/internal/mini-app/finalize-expense` before interactive LINE authentication. Add `expenseAsyncEnabled` to safe client config only for authenticated pilot staff; expose no resource names.

- [ ] **Step 6: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/expenseApi.test.ts tests/pmc-mini-app/expenseResume.test.ts tests/pmc-mini-app/expenseAsyncWorkerRoute.test.ts tests/pmc-mini-app/sessionApi.test.ts tests/pmc-mini-app/expenseSecurity.test.ts
npm run build:server
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add server/pmc-mini-app/contracts.ts server/pmc-mini-app/runtime.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/finance/middleware.ts tests/pmc-mini-app/expenseApi.test.ts tests/pmc-mini-app/expenseResume.test.ts tests/pmc-mini-app/expenseAsyncWorkerRoute.test.ts tests/pmc-mini-app/sessionApi.test.ts tests/pmc-mini-app/expenseSecurity.test.ts
git commit -m "feat: expose async expense API and worker route"
```

---

### Task 6: Mini App acknowledgement, return-home, and foreground resume

**Files:**
- Modify: `src/apps/pmc-mini-app/contracts.ts`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Modify: `src/apps/pmc-mini-app/preview.ts`
- Modify: `src/apps/pmc-mini-app/expense/ExpenseForm.tsx`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Test: `tests/pmc-mini-app/expenseApi.test.ts`
- Test: `tests/pmc-mini-app/expenseForm.test.tsx`
- Test: `tests/pmc-mini-app/clientShell.test.tsx`
- Test: `tests/pmc-mini-app/defaultApiStability.test.tsx`

**Interfaces:**

- Consumes: Task 1 `ExpenseAsyncAck` and Task 5 HTTP/resume contracts.
- Produces: a non-blocking form acknowledgement and foreground-only terminal-state polling.

```ts
export type ExpenseSubmitResult = ExpenseReceipt | ExpenseAsyncAck

export interface ExpenseFormAdapter {
  stage(rootRequestId: string, files: File[]): Promise<{ stagingTokens: string[] }>
  submit(input: ExpenseSubmitInput): Promise<ExpenseSubmitResult>
  resume(rootRequestId: string): Promise<ExpenseResumeStatus>
}
```

Add to `ExpenseForm`:

```ts
onAccepted: (ack: ExpenseAsyncAck) => void
```

- [ ] **Step 1: Write failing API parser tests**

Assert status 202 accepts only the exact acknowledgement, status 200 still accepts a strict receipt for rollback, and mixed/extra fields fail with `MINI_APP_INVALID_RESPONSE`.

- [ ] **Step 2: Write failing form tests**

```ts
vi.mocked(adapter.submit).mockResolvedValue({
  rootRequestId: 'expense-root-1',
  status: 'PENDING',
  acceptedAt: '2026-09-01T18:00:00.000Z',
})
await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))
expect(onAccepted).toHaveBeenCalledOnce()
expect(onCommitted).not.toHaveBeenCalled()
```

- [ ] **Step 3: Write failing shell and polling tests**

Assert acceptance keeps protected resume storage, clears form state, navigates to Finance Home, and shows `รับรายการแล้ว ระบบกำลังบันทึกเบื้องหลัง`. Assert one immediate resume plus one non-overlapping 10-second timer only while visible, pause on hidden, resume on visible, committed receipt cleanup, deterministic failure copy, and `EXPENSE_NEEDS_REVIEW` without resubmit instructions.

- [ ] **Step 4: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/expenseApi.test.ts tests/pmc-mini-app/expenseForm.test.tsx tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/defaultApiStability.test.tsx
```

- [ ] **Step 5: Implement union response and foreground-only polling**

Use the existing application success-message surface and `aria-live`; add no Popover dependency. Prevent overlapping checks with a ref, clear timers on unmount, and preserve the root until a terminal result.

- [ ] **Step 6: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/expenseApi.test.ts tests/pmc-mini-app/expenseForm.test.tsx tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/defaultApiStability.test.tsx
npm run build:mini-app
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/apps/pmc-mini-app/contracts.ts src/apps/pmc-mini-app/api.ts src/apps/pmc-mini-app/preview.ts src/apps/pmc-mini-app/expense/ExpenseForm.tsx src/apps/pmc-mini-app/PmcMiniApp.tsx tests/pmc-mini-app/expenseApi.test.ts tests/pmc-mini-app/expenseForm.test.tsx tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/defaultApiStability.test.tsx
git commit -m "feat: acknowledge expenses without blocking the Mini App"
```

---

### Task 7: Runtime checker and operations runbook

**Files:**
- Create: `scripts/check-pmc-expense-async-runtime.mjs`
- Create: `docs/pmc-mini-app/expense-async-runbook.md`
- Modify: `scripts/check-pmc-mini-app-runtime.mjs`
- Test: `tests/pmc-mini-app/expenseAsyncRuntimeCheck.test.ts`

**Interfaces:**

- Consumes: Tasks 1–6 runtime bindings, routes, and safe health projections.
- Produces: a read-only checker and exact operator runbook used by Tasks 8–9.

```js
export function inspectPmcExpenseAsyncRuntime(snapshot, options = {}) {
  return {
    mode: 'READ_ONLY',
    ready: true,
    queue: { state: 'RUNNING', taskCount: 0 },
    bucket: { location: 'ASIA-SOUTHEAST1', publicAccessPrevention: 'enforced', lifecycleDays: 7 },
    service: { healthStatus: 200, workerUnauthorizedStatus: 401 },
    bindings: { presentCount: 7, requiredCount: 7 },
  }
}
```

- [ ] **Step 1: Write failing checker tests**

Cover stale snapshot, wrong environment, missing source checks, queue not running, non-zero task count at a drain gate, wrong bucket location/lifecycle/public access, worker route not rejecting unauthenticated traffic, missing flag/binding names, and forbidden secret/resource values in serialized output.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/pmc-mini-app/expenseAsyncRuntimeCheck.test.ts
```

- [ ] **Step 3: Implement checker and exact runbook commands**

The runbook documents read-only preflight, bucket/queue creation, IAM, no-traffic deployment, pilot enablement, task inspection, live acceptance evidence, rollback, and drain. Commands use explicit project, region, queue, bucket, service, and revision values; no credential content is printed.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/pmc-mini-app/expenseAsyncRuntimeCheck.test.ts tests/pmc-mini-app/expenseRuntimeCheck.test.ts
node scripts/check-pmc-expense-async-runtime.mjs --help
```

- [ ] **Step 5: Commit**

```bash
git add scripts/check-pmc-expense-async-runtime.mjs scripts/check-pmc-mini-app-runtime.mjs docs/pmc-mini-app/expense-async-runbook.md tests/pmc-mini-app/expenseAsyncRuntimeCheck.test.ts
git commit -m "docs: add async expense rollout checks"
```

---

### Task 8: Full regression gate and infrastructure creation

**Files:**
- No new production source files.
- Verify: all files changed in Tasks 1–7.

**Interfaces:** Production resource contract:

- Consumes: all source and operations artifacts from Tasks 1–7.
- Produces: private job bucket, separate queue, narrow IAM bindings, and a clean preflight gate with async still disabled.

```text
project: project-2099d92f-51c8-4d2b-a8c
region: asia-southeast1
bucket: pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c
queue: pmc-expense-finalize
service: pmc-mini-app
worker: /internal/mini-app/finalize-expense
```

- [ ] **Step 1: Run the complete automated gate**

```bash
npm run booking:test
npx vitest run tests/pmc-mini-app
npm run booking:typecheck
npm run booking:build
npm run build:mini-app
npm run build:server
npm run lint
git diff --check
```

Expected: every command exits 0. Run the Booking and Mini App suites serially to avoid UI-test resource contention.

- [ ] **Step 2: Create the private job bucket**

```bash
gcloud storage buckets create gs://pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --location=asia-southeast1 \
  --uniform-bucket-level-access \
  --public-access-prevention
```

Apply an exact 7-day delete lifecycle and verify it through `gcloud storage buckets describe`. Grant the current Cloud Run runtime service account object-admin only on this bucket.

- [ ] **Step 3: Create the dedicated queue**

```bash
gcloud tasks queues create pmc-expense-finalize \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --location=asia-southeast1 \
  --max-concurrent-dispatches=1 \
  --max-dispatches-per-second=2 \
  --max-attempts=8 \
  --min-backoff=10s \
  --max-backoff=300s \
  --max-retry-duration=86400s
```

Grant the Cloud Run runtime service account `roles/cloudtasks.enqueuer` and verify the configured OIDC task-invoker service account retains `roles/run.invoker` on `pmc-mini-app`.

- [ ] **Step 4: Run the read-only infrastructure checker**

Create a local snapshot containing only allowlisted states/counts, then run:

```bash
node scripts/check-pmc-expense-async-runtime.mjs \
  --snapshot-file /tmp/pmc-expense-async-preflight.json \
  --expected-target pmc-mini-app \
  --expected-environment production \
  --strict
```

Expected: `ready:true` while the feature flag remains false.

- [ ] **Step 5: Require a clean source tree before rollout**

```bash
git status --short
```

Expected: no output. Do not commit local snapshots, credentials, or `/tmp` files.

---

### Task 9: No-traffic deployment, owner pilot, live acceptance, and all-staff gate

**Files:**
- Operations only after Tasks 1–8 pass.

**Interfaces:** Rollout flags:

- Consumes: the verified Task 8 infrastructure and full source regression gate.
- Produces: a tagged revision, owner-only live acceptance evidence, owner acceptance checkpoint, and eventual all-staff rollout.

```text
PMC_EXPENSE_ASYNC_ENABLED=true
PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS=ADMIN_03
```

- [ ] **Step 1: Deploy a no-traffic revision with async code and the flag false**

```bash
gcloud run deploy pmc-mini-app \
  --source . \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --no-traffic \
  --tag=expense-async-v1 \
  --quiet
```

Verify tagged `/api/healthz` and `/mini-app/` return 200, the worker returns 401 without OIDC, client config exposes no resource names, and synchronous expense remains unchanged with the flag false.

- [ ] **Step 2: Configure the exact async bindings and owner-only pilot**

Create a second no-traffic revision with these exact bindings, then verify the queue is empty and the job bucket has zero objects before traffic:

```text
PMC_EXPENSE_ASYNC_ENABLED=true
PMC_EXPENSE_ASYNC_JOB_BUCKET=pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c
PMC_EXPENSE_ASYNC_QUEUE=pmc-expense-finalize
PMC_EXPENSE_ASYNC_WORKER_URL=https://pmc-mini-app-d22ig5ujoq-as.a.run.app/internal/mini-app/finalize-expense
PMC_EXPENSE_ASYNC_WORKER_AUDIENCE=https://pmc-mini-app-d22ig5ujoq-as.a.run.app
PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL=pmc-mini-app-task-invoker@project-2099d92f-51c8-4d2b-a8c.iam.gserviceaccount.com
PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS=ADMIN_03
```

- [ ] **Step 3: Route 100% traffic only after tagged checks pass**

```bash
pmc_expense_verified_revision="$(gcloud run services describe pmc-mini-app \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --format='value(status.latestReadyRevisionName)')"
test -n "$pmc_expense_verified_revision"
gcloud run services update-traffic pmc-mini-app \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --to-revisions="${pmc_expense_verified_revision}=100" \
  --quiet
```

Record the exact revision before execution; never substitute an unverified latest revision.

- [ ] **Step 4: Execute one fresh owner Bill Document acceptance**

From the real LINE Mini App, submit a brand-new Bill Document that is not one of the recovered roots. Capture only safe evidence:

```text
interactive status: 202
acknowledgement latency: <= 3 seconds
navigation: Finance Home
job: QUEUED -> PROCESSING -> COMMITTED
task count after drain: 0
PREPARE requests: 1
COMMIT requests: 1
submission rows: 1 COMMITTED version 2
attachment rows: expected count
Drive files: exact expected count and SHA-256
submission lease: COMMITTED
staging objects: 0
report count delta: +1
duplicate effects: 0
```

- [ ] **Step 5: Execute one owner daily-book conflict acceptance**

Submit an already-recorded book/day and verify HTTP 202 acknowledgement followed by terminal `EXPENSE_REVISION_CONFLICT`, no second effective total, no duplicate attachment row, no indefinite form lock, and operator-safe copy.

- [ ] **Step 6: Owner acceptance checkpoint**

Report acknowledgement latency, background latency, terminal states, queue drain, Sheet/Drive/lease/staging evidence, and any warnings. Do not add staff IDs until the owner explicitly accepts the pilot result.

- [ ] **Step 7: Expand the pilot list to every active `canSubmitExpense` staff ID**

After explicit owner acceptance, update only `PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS`, create a new revision, verify tagged health/config, route traffic, and monitor the first three staff submissions. Roll back by setting `PMC_EXPENSE_ASYNC_ENABLED=false` while leaving accepted tasks available to drain.

- [ ] **Step 8: Final verification and branch handoff**

```bash
git status --short
git log --oneline --decorate -12
gcloud tasks list --queue=pmc-expense-finalize --location=asia-southeast1 --project=project-2099d92f-51c8-4d2b-a8c
gcloud run services describe pmc-mini-app --region=asia-southeast1 --format=json
```

Final status must distinguish automated verification, tagged deployment checks, owner live acceptance, and all-staff rollout. Do not call the feature complete when only the first two are present.
