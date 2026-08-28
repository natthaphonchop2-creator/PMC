# Task 1 Report: Feature-gated asynchronous runtime configuration

## Status

Implemented locally only. No Google Cloud, Apps Script, Sheet, LINE, Render, or production state was changed.

## Implementation

- Added `readPmcAsyncBookingConfig`, which defaults to disabled and accepts an async configuration only when `PMC_MINI_APP_ASYNC_ENABLED=true` and every required value is present and valid.
- Enforced the fixed `asia-southeast1` location, fixed 25 MB batch limit, resource/project/service-account/staff-ID validation, and HTTPS URLs without credentials.
- Added `asyncBooking` to the server configuration. The existing synchronous runtime remains unchanged when the async flag is absent or false. An enabled-but-invalid async configuration fails closed.
- Extended the read-only runtime checker with `asyncBookingEnabled` and async variable presence only. It never returns configured async values.
- Updated typed Mini App test fixtures with `asyncBooking: null` to preserve existing synchronous test behavior.

## Files

- `server/pmc-mini-app/asyncConfig.ts` (new)
- `server/pmc-mini-app/config.ts`
- `scripts/check-pmc-mini-app-runtime.mjs`
- `tests/pmc-mini-app/asyncConfig.test.ts` (new)
- `tests/pmc-mini-app/config.test.ts`
- `tests/pmc-mini-app/runtimeConfig.test.ts`
- `tests/pmc-mini-app/bookingApi.test.ts`
- `tests/pmc-mini-app/evidenceApi.test.ts`
- `tests/jera/reportApi.test.ts`
- `tests/jera/schedulerApi.test.ts`

`server/pmc-mini-app/runtime.ts` did not require a behavioral edit: it already consumes the complete `PmcMiniAppServerConfig`, and the newly feature-gated configuration is inert until later async-path tasks introduce a consumer.

## TDD Evidence

### RED

1. `npx vitest run tests/pmc-mini-app/asyncConfig.test.ts tests/pmc-mini-app/runtimeConfig.test.ts`
   - Failed as expected: `Cannot find module '../../server/pmc-mini-app/asyncConfig'` and the runtime report lacked `asyncBookingEnabled`.
2. `npx vitest run tests/pmc-mini-app/config.test.ts`
   - Failed as expected: a Mini App config with `PMC_MINI_APP_ASYNC_ENABLED=true` but no async resources was returned instead of failing closed.
3. `npx vitest run tests/pmc-mini-app/asyncConfig.test.ts`
   - Failed as expected: the initial strict staff-ID expression rejected the existing short `staff-1` format.

### GREEN

- `npx vitest run tests/pmc-mini-app/asyncConfig.test.ts tests/pmc-mini-app/config.test.ts tests/pmc-mini-app/runtimeConfig.test.ts`
  - Passed: 3 files, 25 tests.
- `npx tsc -p tsconfig.server.json --noEmit`
  - Passed.
- `npm run lint`
  - Passed.
- Full-suite execution was started with `npm test`; the terminal detached during the known OCR cold build before its aggregate summary could be collected. The prescribed partition commands were then run; their child processes completed, but this terminal similarly dropped their final buffered summaries after the 30-second execution boundary. Baseline supplied for this task is OCR job 2/2 plus remaining suite 914/914.

## Self-review

- The async parser is fail-closed and does not enable asynchronously on an absent, false, malformed, or incomplete configuration.
- Only feature state plus variable names are serialized by the runtime checker; the test checks all configured resource values are absent from serialized output.
- Existing sync configuration stays `asyncBooking: null` when the new flag is disabled; no async client or external call was introduced.
- `git diff --check` passed before commit.

## Concerns

- The local terminal runner truncates/detaches commands crossing roughly 30 seconds, so it did not preserve a conclusive aggregate full-suite summary despite the required suite and both prescribed partitions being initiated and their processes later observed complete. Focused tests, server typecheck, and lint have conclusive passing output.
- Existing `npm audit` advisories were not changed, per task instruction.
