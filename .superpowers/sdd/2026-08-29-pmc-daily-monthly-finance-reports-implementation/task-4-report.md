# Task 4 Report — Fail-Closed Finance Permissions

## Status

Implemented and verified locally. No production Sheet mutation, Apps Script push/deploy, permission grant, production configuration, finance API/UI, or expense feature was performed.

## Delivered

- Extended canonical `CONFIG_STAFF` from 9 to exactly 12 columns with `canSubmitExpense`, `canViewFinance`, and `canManageExpense` appended in that order.
- Renamed the migration contracts to `StaffConfigMigrationPlan`, `staffConfigMigrationPlan()`, and `migrateConfigStaffColumns()` across all callers.
- Preserved supported 7-column Profile and 8-column Stock migrations. The compatible migration now converges 7→8→9→12 without the prior three-iteration/final-readback failure and appends the three finance headers in one atomic three-column mutation.
- Added operator-only `migratePmcFinancePermissionColumns()`. It opens only the configured Booking Operations spreadsheet, performs exact 12-column readback, and returns only `{changed,columnCount:12}`. It does not log rows/IDs, grant roles, add required runtime properties, or perform any deployment.
- Changed the Mini App staff read range and enrollment preservation write to `CONFIG_STAFF!A:L`.
- Added all three finance booleans to `StaffConfig`, `MiniAppStaffRecord`, `AuthenticatedMiniAppContext`, and `MiniAppConfig`.
- Finance permission cells enable a role only when the canonical cell is the exact boolean `true`. Missing, blank, malformed, shifted, inactive, and unlinked records fail closed. Names, email, Stock role, and Booking roles are not authorization inputs.
- `/api/mini-app/config` exposes the three safe role booleans. `/api/mini-app/session` remains the existing minimal `{staffId,displayName,active}` projection and neither response exposes LINE user ID or email.

## RED evidence

### Canonical schema and atomic migration plan

Command:

```text
npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/staffDirectory.test.ts
```

Observed result: 2 files failed; 2 tests failed and 14 passed. The nine-column schema lacked all three finance headers and the legacy nine-column migration returned `NONE` instead of `APPEND_FINANCE_PERMISSIONS`.

### Renamed migration, convergence, safe operator, and bundle export

Command:

```text
npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/runtimeStockMigration.test.ts apps/pmc-google-booking-ops/tests/build.test.ts
```

Observed result: 3 files failed; 12 tests failed and 6 passed. The renamed APIs, compatible convergence path, safe operator workflow, and top-level bundle export did not yet exist.

### Server permission parsing and projections

Command:

```text
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/sessionApi.test.ts
```

Observed result: 2 files failed; 12 tests failed and 42 passed. Finance fields were absent from staff records and `/api/mini-app/config`, and enrollment still truncated the row at column I.

### Fail-closed preview contract

Command:

```text
npx vitest run tests/pmc-mini-app/preview.test.ts
```

Observed result: 1 of 6 tests failed because the local preview config omitted the three required false finance permissions.

## GREEN and focused verification

Canonical schema:

```text
npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/staffDirectory.test.ts
PASS: 2 files, 16 tests
```

Compatible migration and bundle:

```text
npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/runtimeStockMigration.test.ts apps/pmc-google-booking-ops/tests/build.test.ts
PASS: 3 files, 18 tests
```

Permission parsing and API projections:

```text
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/sessionApi.test.ts
PASS: 2 files, 54 tests
```

Required Stock/Booking regressions:

```text
npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/sessionApi.test.ts tests/pmc-mini-app/stockApi.test.ts tests/pmc-mini-app/security.test.ts && npm run booking:test
PASS: Mini App 4 files / 76 tests; Booking 42 files / 427 tests
```

Required Booking compile/bundle verification:

```text
npm run booking:typecheck && npm run booking:build
PASS: TypeScript exit 0; Apps Script bundle build exit 0
```

Additional client/server verification:

```text
npx vitest run tests/pmc-mini-app/preview.test.ts && npm run build:client
PASS: 1 file / 6 tests; client TypeScript and Vite production build exit 0

npm run build:server
PASS: server TypeScript exit 0
```

## Full suite

```text
npm test
```

Observed result: 154 test files passed; 1,791 tests passed; exit 0. The existing Node `punycode` deprecation warnings remained non-failing.

## Files changed

- `.superpowers/sdd/2026-08-29-pmc-daily-monthly-finance-reports-implementation/task-4-report.md`
- `apps/pmc-google-booking-ops/scripts/build.mjs`
- `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts`
- `apps/pmc-google-booking-ops/src/domain/sheetMigration.ts`
- `apps/pmc-google-booking-ops/src/entrypoints.ts`
- `apps/pmc-google-booking-ops/src/ports.ts`
- `apps/pmc-google-booking-ops/src/runtime.ts`
- `apps/pmc-google-booking-ops/src/sheetSchema.ts`
- `apps/pmc-google-booking-ops/tests/build.test.ts`
- `apps/pmc-google-booking-ops/tests/formSubmit.test.ts`
- `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`
- `apps/pmc-google-booking-ops/tests/runtimeStockMigration.test.ts`
- `apps/pmc-google-booking-ops/tests/sheetMigration.test.ts`
- `apps/pmc-google-booking-ops/tests/staffDirectory.test.ts`
- `server/pmc-mini-app/contracts.ts`
- `server/pmc-mini-app/middleware.ts`
- `server/pmc-mini-app/store.ts`
- `src/apps/pmc-mini-app/contracts.ts`
- `src/apps/pmc-mini-app/preview.ts`
- `tests/pmc-mini-app/preview.test.ts`
- `tests/pmc-mini-app/sessionApi.test.ts`
- `tests/pmc-mini-app/store.test.ts`

The test-helper and preview files beyond the brief's initial file list were required to keep the newly required permission contracts complete and fail-closed under TypeScript.

## Self-review

- Confirmed the only privilege source is the authenticated `CONFIG_STAFF` record selected by verified LINE user ID; authorization is carried forward from its immutable staff ID and exact permission cells.
- Confirmed `owner`, `doctor`, and `มัส` names, email, `canManageStock`, `canCloseBooking`, and `canBeAe` never derive finance roles.
- Confirmed Stock authorization still reads only `canManageStock`.
- Confirmed the migration inserts blank cells, validates exact header order before every write, and uses one three-column insert/write for finance permissions.
- Confirmed the operator response has only `changed` and `columnCount`; no row, Sheet ID, LINE ID, or role assignment is returned or logged.
- Confirmed `REQUIRED_PROPERTIES` was unchanged, no finance property became globally required, and no live mutation/deploy command was run.
- Confirmed `git diff --check` exits 0.

## Concerns

- No functional blocker found.
- The migration entrypoint is intentionally only built locally. Running it against the live Sheet still requires separate explicit owner approval.
