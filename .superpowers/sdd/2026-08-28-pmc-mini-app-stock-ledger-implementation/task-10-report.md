# Task 10 — History, Setup, End-to-End Verification, and Rollout Gates

Date: 2026-08-28

## Outcome

Task 10 now provides a read-only, paginated Stock history surface; a real-domain simulated ledger lifecycle that calls the shared Apps Script command implementation; disabled-first Stock rollout gates; a safe runtime readiness report; and mobile browser acceptance coverage. No production deployment, Sheet, Apps Script, Cloud Run, or live configuration was changed.

## Files changed

- `src/apps/pmc-mini-app/stock/StockHistory.tsx` — newest-first, in-place expandable immutable document history with Thai date/time, manager-only adjustment reason, opaque cursor load-more, and no mutation/Sheet controls.
- `src/apps/pmc-mini-app/PmcMiniApp.tsx` — reads the first history page, appends later pages without duplicate document IDs, ignores stale responses, and keeps Stock navigation available while the initial history request is pending.
- `src/apps/pmc-mini-app/styles.css` — compact mobile history layout and touch-safe load-more control.
- `src/apps/pmc-mini-app/main.tsx` and `src/apps/pmc-mini-app/preview.ts` — deterministic enabled/disabled and staff/manager preview modes plus a stateful, idempotent preview Stock store for browser acceptance.
- `tests/pmc-mini-app/stockHistory.test.tsx` — history ordering, disclosure, manager-only reason, pagination, and Mini App integration tests.
- `tests/pmc-mini-app/helpers/stockSystem.ts` and `tests/pmc-mini-app/stockEndToEnd.test.ts` — real shared-contract lifecycle helper and ledger reconciliation test.
- `tests/pmc-mini-app/browserAcceptance.spec.ts` and `tests/pmc-mini-app/localServer.mjs` — disabled-first, staff, manager, retry/history, no-Sheet-link, Android-viewport, and console-error acceptance coverage.
- `scripts/check-pmc-mini-app-runtime.mjs` and `tests/pmc-mini-app/runtimeConfig.test.ts` — Stock flag/binding presence checks without serializing configuration values.
- `docs/pmc-mini-app/pilot-runbook.md` — exact three-manager readback, disabled-first revision, Apps Script immutable-version procedure, managed tabs, synthetic ledger checks, manager-only pilot, owner gate, and non-destructive rollback.
- `tests/pmc-mini-app/clientShell.test.tsx` — regression test for retaining navigation while initial history loading is in progress.
- `apps/pmc-google-booking-ops/tests/runtimeStockMigration.test.ts` — no-behavior lint correction required for the requested lint gate.

## Behavior verified

- History displays newest documents first; disclosure shows line items in place; active staff cannot see adjustment reasons, Sheet links, or edit controls.
- Load-more sends only the opaque cursor and appends unique document IDs.
- A pending initial history fetch leaves the existing Stock screen, bottom navigation, and loading indicator available; a stale response cannot pull a user back from Account.
- The end-to-end helper delegates every mutation to `executeStockCommand()` using the real Apps Script repository and Cloud Run read projection. The lifecycle reconciles from opening 10, receive +5, issue -8, and adjust -1 to final balance 6 with deltas `[10000, 5000, -8000, -1000]`.
- Preview browser scenarios cover disabled Stock, active-staff two-product issue and low-stock filter, hidden non-manager controls, manager create/receive/adjust, repeated-submit idempotency, and absence of a Google Sheet escape hatch.
- Runtime output is read-only and lists names/presence only. The `/dev/null` run reported no values, URLs, IDs, or secrets.

## Verification evidence

| Command | Result |
| --- | --- |
| `npx vitest run tests/pmc-mini-app/stockHistory.test.tsx tests/pmc-mini-app/stockEndToEnd.test.ts` | 2 files, 5 tests passed (before final regression addition) |
| `npx vitest run tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/stockHistory.test.tsx tests/pmc-mini-app/stockEndToEnd.test.ts` | 3 files, 16 tests passed |
| `npm run build` | passed: client, OCR review, Mini App, and server builds |
| `npx vitest run --exclude tests/ocr-ledger/job.test.ts` | 130 files, 1296 tests passed |
| `npx vitest run tests/ocr-ledger/job.test.ts` | 1 file, 2 tests passed |
| `npm run booking:test` | 40 files, 328 tests passed |
| `npm run booking:typecheck` | passed |
| `npm run booking:build` | passed |
| `npm run lint` | passed |
| `npx playwright test --config=playwright.mini-app.config.ts` | 9 tests passed, including four Android Stock scenarios |
| `node scripts/check-pmc-mini-app-runtime.mjs --env-file /dev/null` | passed; `READ_ONLY`, all Stock names reported missing, no values emitted |
| `git diff --check` | passed |

Browser plugin QA used the local preview at a 412 × 915 Android-sized viewport. It verified disabled Stock, staff low-stock filtering/no manager controls, a successful issue that expanded read-only history, manager creation, and zero browser console errors in each checked preview flow. Playwright separately exercised the full scripted Android suite.

## Self-review

- History has no mutation controls or Sheet links, and it only renders adjustment reasons for Stock managers.
- The initial-history regression showed that switching to a standalone loading notice removed bottom navigation. The component now switches to History only after the first page resolves; the new test proves navigation remains usable and stale results are ignored.
- The runtime checker never includes environment values in its returned report; the test uses sentinel values and asserts serialization excludes both.
- The runbook remains approval-gated and explicitly preserves all Stock rows/tabs during rollback and recovery.

## Modern-web and Thai UI influence

Modern-web guidance was used for native semantic form/disclosure behavior, visible labels and live status/error feedback, focus preservation, and mobile tap sizing. The Stock history uses native `details`/`summary`, a real button for pagination, and no custom click-only disclosure behavior. Thai UI guidance informed the Thai-capable existing typography system, Thai-safe line-height, normal letter spacing in the history container, tabular numbers, and mobile spacing that avoids clipping Thai marks.

## Rollout concerns and gates

- Local/browser verification uses the simulated preview only. Android and iPhone LINE WebView checks, Cloud Run revision changes, Apps Script deployment/versioning, managed Sheet setup, synthetic writes to the canonical Sheet, and owner approval remain explicit runbook gates and were intentionally not executed.
- `npm run build` reports the existing Vite client chunk-size advisory (>500 kB) but exits successfully; this task did not widen scope into application-level bundle splitting.
- The installed modern-web guidance CLI reported that its skill metadata has a newer patch release. Its retrieved form, accessibility-error, and platform-dialog guidance was still applied; skill upgrade is outside this code task.

## Commit

Implementation commit SHA is recorded in the final Task 10 handoff after the primary commit is created.
