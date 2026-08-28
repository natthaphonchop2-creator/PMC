# PMC Stock rollout evidence — 2026-08-29

## Release identity

- Stock source commit: `5107f12acd5a49638e0719a13f68d9237f606eb7`.
- Integrated branch merge commit: `e607da2`.
- Apps Script immutable version: `31`.
- Active Cloud Run revision: `pmc-mini-app-00022-kez` at 100% traffic.
- Stock flags: enabled for active staff; manager-pilot-only disabled.
- Disabled rollback revision retained: `pmc-mini-app-00019-cav`.
- Previous full-service revision retained: `pmc-mini-app-00017-fin`.

No unrestricted URL, deployment ID, Sheet ID, LINE ID, token, or secret is recorded in this evidence.

## Workbook and authorization

- Workbook tab count changed from 25 to 28: exactly three Stock tabs created and zero tabs deleted.
- `STOCK_PRODUCTS`, `STOCK_LEDGER`, and `STOCK_AUDIT` passed exact-header and frozen-row readback.
- `CONFIG_STAFF` migrated safely from 8 to 9 columns with `canManageStock` as the ninth column.
- All 8 active staff can access Stock and issue products.
- Managers are exactly `shared-account-test`, `ADMIN_07`, and `ADMIN_03`.
- The other 5 active staff have no manager flag.
- Owner confirmed both manager and non-manager LINE role checks passed.

## Synthetic lifecycle and security

- Synthetic product: `STK-08e3245b-1041-41ae-ab1d-58da91c798b9`.
- Retained immutable documents:
  - `STK-08e3245b-1041-41ae-ab1d-58da91c798b9`
  - `RCV-3635eaba-251e-4e1c-96f2-33d75d01ebcf`
  - `ISS-3f66de90-ed0b-4b1a-8d28-87982d239735`
  - `ADJ-b403e2bb-a40b-4ec1-9107-71a006eef534`
- Deltas: `[10000, 5000, -8000, -1000]`; final balance: 6000 milli-units.
- Excess issue returned `STOCK_INSUFFICIENT_BALANCE` without changing Stock rows.
- Exact request replay returned the original document without duplicate rows.
- Altered signature, expired timestamp, repeated nonce, and conflicting request hash were rejected.
- Synthetic product was deactivated at version 2 while product, ledger, and audit history remained intact.
- Final synthetic row counts: 1 product, 4 ledger entries, 10 audit events.

## Verification

- Production health returned 200; unauthenticated Stock API remained protected with 401.
- No unexpected active-revision ERROR/5xx log remained after cutover. Two deliberate OCR parity probes returned the same pre-existing 503 status on old and new revisions.
- Integrated result:
  - Booking: 42 files / 421 tests passed.
  - Mini App: 50 files / 599 tests passed.
  - Full Vitest excluding the isolated OCR build test: 144 files / 1609 tests passed.
  - Isolated OCR build test: 1 file / 2 tests passed.
  - Client/server/Apps Script typechecks and builds passed.
  - Playwright Mini App acceptance: 9 tests passed.
  - ESLint: 0 errors; one pre-existing generated-output warning from Async Booking remained.

## Rollback

- Stock-only rollback: route to `pmc-mini-app-00019-cav` or deploy the current image with Stock disabled and manager-pilot-only enabled.
- Full-service rollback: route to `pmc-mini-app-00017-fin`.
- Never delete Stock tabs, product rows, ledger rows, or audit rows during rollback.
