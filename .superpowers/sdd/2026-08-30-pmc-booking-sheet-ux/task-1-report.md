# Task 1 Report — Clear all stale Dashboard operation cells

## Status

Implemented locally on base `0853839`. No Apps Script push, live Google Sheet read/write, backup, presentation change, deployment, or external call was performed.

## Implementation

- `createGoogleDashboardPort.write()` now clears content only from columns A:H.
- The clear extent is `max(1000, sheet.getLastRow(), startRow + operationCount)`, so both stale rows beyond 1,000 and a larger incoming snapshot are covered.
- KPI positions, operation-header positions, operation row mapping, and the existing `DashboardPort.write(snapshot)` contract are unchanged.
- Column I and later columns are untouched; formatting is preserved because the adapter still uses `clearContent()` rather than `clear()`.
- Preserved and included the parent-amended Sheet-plan prerequisite that binds this plan to the completed performance-plan commit title.

## TDD evidence

RED was observed before the production change:

```text
Test Files 1 failed
Tests 2 failed | 1 passed
```

The failures showed the old fixed `A1:G1000` clear instead of the required dynamic eight-column extent.

GREEN verification:

- Focused Dashboard and integrity suites: `2` files, `9` tests passed.
- Full Booking suite: `50` files, `696` tests passed.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- Touched-path ESLint: passed with zero findings.
- Full `npm run lint`: zero errors; one pre-existing generated unused-disable warning only.
- `git diff --check`: passed.

## Self-review

- A zero-operation refresh clears stale H content beyond row 1,000.
- A new snapshot longer than the existing Sheet clears through its full future row extent before writing.
- KPI and operation headers remain in their prior rows and columns.
- The fake Sheet preserves independent format metadata and content outside A:H, catching accidental `clear()` or over-wide clears.
- No Sheet-presentation Task 2+ behavior or live operation was added.
