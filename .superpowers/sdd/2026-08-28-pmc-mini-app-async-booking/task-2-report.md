# Task 2 Report: Append-only async request schema migration

## Implementation

- Extended `MiniAppRequestRecord` and `MiniAppDraftPatch` with asynchronous evidence-object-key, task, timing, lease, progress, and attempt fields.
- Appended exactly eight request columns after the legacy 28-column schema:
  `paymentEvidenceObjectKeysJson`, `chatEvidenceObjectKeysJson`, `taskName`, `queuedAt`, `processingStartedAt`, `processingLeaseUntil`, `lastProgressAt`, and `attemptCount`.
- Added row serialization/deserialization and validation. Legacy 28-column rows deserialize to empty object-key arrays, `null` async timestamps/task name, and `attemptCount: 0`.
- Added `migrateMiniAppAsyncRequestColumns`. It accepts only the exact 28-column legacy prefix, writes only `MINI_APP_REQUESTS!AC1:AJ1`, returns the appended names, and rejects changed/reordered headers before any write. A fully migrated header is an idempotent no-op.
- Initialized all new fields in the two existing draft producers so every persisted draft has a complete record shape.

## TDD evidence

### RED

Command:

```bash
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts
```

Result: 4 failures / 12 passes, as expected before implementation.

- `migrateMiniAppAsyncRequestColumns is not a function` for both migration cases.
- Round-trip and legacy-row tests failed because asynchronous fields were absent after deserialization.

### GREEN

Command:

```bash
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/setup.test.ts tests/pmc-mini-app/bookingApi.test.ts tests/pmc-mini-app/evidenceApi.test.ts
npx tsc -p tsconfig.server.json --noEmit
```

Result: 29/29 tests passed; server typecheck exited 0.

## Full verification

```bash
npx vitest run tests/ocr-ledger/job.test.ts
# 2/2 passed

npx vitest run --exclude tests/ocr-ledger/job.test.ts
# 931/931 passed across 116 files

npx tsc -p tsconfig.server.json --noEmit
git diff --check
# both exited 0
```

The OCR job test was run standalone because its freshly-built-job harness can time out when co-scheduled with the complete suite. No Google API calls, deployment, or external mutation was performed.

## Self-review

- Confirmed the legacy comparison checks every column and position before the only write.
- Confirmed the migration updates only the missing row-1 range `AC1:AJ1`; it never rewrites the first 28 headers or data rows.
- Confirmed request read/write ranges expand from 28 to 36 columns through `MINI_APP_REQUEST_HEADERS`.
- Confirmed draft factories carry safe legacy defaults and existing focused API tests remain green.
- Confirmed the patch has no whitespace errors with `git diff --check`.

## Concerns

None for this scoped migration. Invocation against a production spreadsheet remains intentionally outside this task.

## Fix round 1: complete test request fixtures

### Finding and scope

Review identified an incomplete `MiniAppRequestRecord` fixture in `tests/pmc-mini-app/evidenceApi.test.ts`. Before editing, a focused TypeScript check reported the missing required asynchronous field at line 123:

```bash
npx tsc --ignoreConfig --noEmit --strict --target ES2022 --module esnext --moduleResolution bundler --skipLibCheck --types node,vitest/globals tests/pmc-mini-app/evidenceApi.test.ts
```

The focused command also reports pre-existing `BlobPart` compatibility diagnostics, but the relevant diagnostic was:

```text
TS2322: ... paymentEvidenceObjectKeys ... string[] | undefined is not assignable to string[]
```

Scoped search of every `MiniAppRequestRecord` use under `tests/pmc-mini-app` found one additional real object fixture in `tests/pmc-mini-app/bookingIngressClient.test.ts`; its focused TypeScript check also reported all eight required fields missing. No other direct request-record fixture was incomplete.

### Implementation

- Added the exact legacy defaults to `evidenceApi.test.ts`:
  `paymentEvidenceObjectKeys: []`, `chatEvidenceObjectKeys: []`, all five nullable async fields as `null`, and `attemptCount: 0`.
- Added the same defaults to `bookingIngressClient.test.ts`.

### GREEN verification

```bash
npx vitest run tests/pmc-mini-app/evidenceApi.test.ts tests/pmc-mini-app/store.test.ts
# 16/16 passed

npx tsc -p tsconfig.server.json --noEmit
# exited 0

npm run lint
# exited 0

git diff --check
# exited 0
```

### Self-review

- Confirmed the two changed values are test-only record factories.
- Confirmed both use the exact legacy normalization defaults required by Task 2.
- Confirmed scoped search found no additional direct incomplete `MiniAppRequestRecord` fixtures.

### Additional focused fixture verification

```bash
npx vitest run tests/pmc-mini-app/bookingIngressClient.test.ts
```

Result: 1/1 test file and 7/7 tests passed (136ms total duration).
