# Task 5 Report — Cache-Only Finance Read and One-Day Refresh APIs

## Outcome

Implemented the Task 5 server scope only:

- cache-only daily and monthly finance reads;
- exact 1–31 Bangkok-day expansion with one `readCachedBatch()` call;
- one bounded allocation snapshot read for the selected days;
- finance-role authorization and exact query allowlists;
- sequential one-day PAYMENT, REFUND, PRODUCT_SALES refresh;
- allocation coverage seeding and cursor `0` / attempt `0` task enqueue;
- exact OIDC-protected `/internal/mini-app/finance-daily-seed` routing;
- explicit production allowlisting while preserving legacy report routes.

No client UI, permission migration, expense capture, deployment tooling, Sheet migration, scheduler/IAM change, provider write, or live rollout action was performed.

## RED evidence

### Finance service

Command:

```text
npx vitest run tests/jera/financeService.test.ts
```

Observed result before implementation:

```text
FAIL tests/jera/financeService.test.ts
Error: Cannot find module '../../server/jera/financeService'
Test Files 1 failed
```

This was the expected missing-service failure for `createJeraFinanceService()`.

### Finance routes and production allowlist

Command:

```text
npx vitest run tests/jera/financeService.test.ts tests/jera/reportApi.test.ts tests/pmc-mini-app/security.test.ts tests/pmc-mini-app/productionApp.test.ts
```

Observed result before route implementation:

```text
Test Files 2 failed | 2 passed
Tests 23 failed | 54 passed
```

The finance API cases returned 404 and the internal seed remained behind legacy Basic Auth, which was the intended RED signal.

### Bounded allocation snapshot mutation check

After adding the real allocation-store regression, an intentional extra Sheet read was temporarily introduced.

Command:

```text
npx vitest run tests/jera/allocationStore.test.ts -t 'reads up to 31 exact days'
```

Observed result:

```text
Test Files 1 failed
Tests 1 failed | 10 skipped
expected batchGets length 1, received 2
```

The mutation was removed and the regression returned green.

## GREEN evidence

### Required focused set

Command:

```text
npx vitest run tests/jera/financeService.test.ts tests/jera/reportApi.test.ts tests/pmc-mini-app/security.test.ts tests/pmc-mini-app/productionApp.test.ts
```

Result:

```text
Test Files 4 passed
Tests 78 passed
```

### Allocation-store regression

Command:

```text
npx vitest run tests/jera/allocationStore.test.ts
```

Result:

```text
Test Files 1 passed
Tests 11 passed
```

### Server TypeScript build and diff hygiene

Commands:

```text
npm run build:server
git diff --check
```

Results: both exited 0.

### Full suite

Command:

```text
npm test
```

Result:

```text
Test Files 155 passed
Tests 1830 passed
Duration 28.58s
```

## Files changed

- `server/jera/financeService.ts` — cache-only projection reads, monthly boundary derivation, one-day refresh orchestration, safe service errors.
- `server/jera/allocationStore.ts` — bounded `readDays()` using one three-table Sheet batch snapshot.
- `server/jera/middleware.ts` — finance endpoints, exact filters, finance authorization, safe error mapping, internal seed OIDC route.
- `server/jera/runtime.ts` — finance service/store/queue construction and fail-closed category-money flag wiring.
- `server/pmc-mini-app/middleware.ts` — internal seed dispatch and safe unavailable response.
- `server/productionApp.ts` — exact raw internal seed allowlist.
- `tests/jera/financeService.test.ts` — Task 5 service RED/GREEN coverage.
- `tests/jera/allocationStore.test.ts` — real one-batch, 31-day-bounded allocation read regression.
- `tests/jera/reportApi.test.ts` — authentication, authorization, exact-filter, safe-response, refresh, and OIDC route coverage.
- `tests/pmc-mini-app/security.test.ts` — finance service logging/injection security scan coverage.
- `tests/pmc-mini-app/productionApp.test.ts` — exact production route allowlist coverage.

## Self-review

- GET daily/monthly call only `readCachedBatch()` plus allocation `readDays()`; they do not call `manualRefresh()`, enqueue tasks, poll, or create timers.
- Daily expansion validates canonical dates first, uses integer UTC stepping, and permits exactly 1–31 inclusive days.
- Monthly accepts only integer `year` 2020–2100 and `month` 1–12; the service derives `monthKey`, first day, and last day.
- Each day requests separate exact-day PAYMENT, REFUND, and PRODUCT_SALES keys; no month-range cache key is used.
- Unseeded component caches fail as `FINANCE_CACHE_EMPTY` and are mapped to `FINANCE_CACHE_UNAVAILABLE`, never a confirmed zero.
- Category money remains null unless complete matching coverage exists and the server flag is exactly `true`; timestamp skew remains fail-closed.
- Any active linked staff can read daily; monthly and manual refresh check `canViewFinance` before calling the finance service.
- Refresh calls PAYMENT, REFUND, and PRODUCT_SALES sequentially, persists no replacement itself on source failure, seeds exact-day hashes, then enqueues cursor `0`, attempt `0`.
- A throttled partial sequence returns the maximum observed cooldown, which is the minimum safe time before rerunning the whole sequence.
- Internal seed verifies the exact audience/service-account pair used by the allocation worker, accepts no query or body, derives the previous completed Bangkok day, and uses a scheduler actor.
- Finance responses expose projections/progress only; raw details, contact fields, cache keys, provider payloads, Sheet IDs, and credentials are not returned.
- Legacy `/api/mini-app/reports/*` and existing internal routes remain unchanged and passed the full suite.

## Concerns / follow-up gates

- `npm run lint` is not green on the branch: it reports 9 errors and 1 warning in pre-existing unchanged lines (including prior allocation-store destructuring, allocation lease/task queue, prior report API tests, and an existing generated file warning). The Task 5 additions themselves introduced no reported lint finding. This was verified against the zero-context diff and `HEAD` source; unrelated lint cleanup was intentionally not included.
- Runtime finance construction currently follows the approved allocation configuration gate because manual refresh must seed the existing allocation queue. Production activation still requires the separately approved environment/configuration and external rollout gates; none were changed here.

## Fix Round 1 — Important review findings

### Findings addressed

1. Allocation identity and refresh idempotency
   - Added exact `metadataSnapshotHash` to allocation task input, deterministic task identity, HTTP body, internal route validation, worker input, and every continuation.
   - The worker now compares both the PAYMENT set hash and current PRODUCT_SALES metadata snapshot hash before skipping, preserving a cursor, or resetting work.
   - `refreshDay()` reads current coverage before source refresh. Matching PAYMENT + metadata hashes preserve COMPLETE or INCOMPLETE coverage without a save or enqueue.
   - Changed hashes enqueue cursor `0` / attempt `0` before any reset write. Queue failure or `alreadyExists` preserves working coverage; only a newly created task permits the reset write.

2. Timer-free finance cache reads
   - Split the real report-store table loader from the legacy five-second PAYMENT cache snapshot.
   - `readSnapshots()` now performs one request-scoped cache read and one state read without creating or renewing a process timer.
   - Legacy `readRows()` retains the existing five-second single-flight cache behavior.

3. Authorization before finance dependency checks
   - Monthly and manual-refresh finance paths now enforce `canViewFinance` before checking whether the finance service exists.
   - An ordinary active staff member receives `403 FINANCE_FORBIDDEN` even when finance runtime construction is unavailable, without invoking JERA store/coordinator dependencies.
   - Daily remains available to all active linked staff and may return the safe unavailable response when the finance service is absent.

### Fix Round 1 RED evidence

Command:

```text
npx vitest run tests/jera/financeService.test.ts tests/jera/allocationTaskQueue.test.ts tests/jera/allocationWorker.test.ts tests/jera/reportApi.test.ts tests/jera/store.test.ts
```

Pre-fix result:

```text
Test Files 5 failed
Tests 15 failed | 78 passed
```

The failures independently showed coverage reset on same-hash replay, metadata missing from task identity/body/worker, the finance snapshot creating one timer, and unavailable finance returning 503 before the role gate.

An additional enqueue-result regression was run separately:

```text
npx vitest run tests/jera/financeService.test.ts -t 'changed-hash task already exists'
```

Pre-fix result:

```text
Test Files 1 failed
Tests 1 failed | 22 skipped
```

It proved that `alreadyExists` still caused an unsafe coverage overwrite before the final guard was added.

### Fix Round 1 GREEN evidence

Command:

```text
npx vitest run tests/jera/financeService.test.ts tests/jera/reportApi.test.ts tests/pmc-mini-app/security.test.ts tests/pmc-mini-app/productionApp.test.ts tests/jera/store.test.ts tests/jera/allocationStore.test.ts tests/jera/syncCoordinator.test.ts tests/jera/allocationTaskQueue.test.ts tests/jera/allocationWorker.test.ts
```

Result:

```text
Test Files 9 passed
Tests 141 passed
```

Commands:

```text
npm run build:server
git diff --check
```

Results: both exited 0.

### Fix Round 1 self-review

- Same-hash COMPLETE and INCOMPLETE refresh replays preserve cursor, state, and timestamps by performing no coverage write.
- Metadata-only and PAYMENT-set changes produce distinct task identities containing both hashes.
- New work is enqueued before reset coverage is persisted, and ambiguous/failed enqueue results leave working coverage untouched.
- Worker retries and continuations retain both hashes and fail closed when the exact-day metadata snapshot differs.
- Finance `readSnapshots()` is timer-free while legacy `readRows()` cache tests remain green.
- Monthly/manual-refresh role denial is independent of finance service availability and occurs before JERA dependency access.
