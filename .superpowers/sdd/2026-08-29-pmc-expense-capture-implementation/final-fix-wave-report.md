# Expense Final Fix Wave Report

Date: 2026-08-30

Base: `d7dc29615bf12f60c2d3ea1cdab486010c59021f`

## Outcome

All validated items A-E in `final-fix-wave-brief.md` were implemented and verified locally. The wave closes the financial-integrity, upload fencing, fresh-month topology, auditable-read, lost-response resume, reads-only client, exact-money, parser, VOID contract, and accessibility gaps identified by final review.

No production or live provider action was performed. Revenue rollout remains parked, finance feature flags were not enabled, and production rollout remains owner-gated.

## A. Financial integrity and terminal recovery

- PREPARE now persists a canonical immutable-intent hash covering the full submission intent. Fresh COMMIT and recovery recompute it from the stored row and fail closed on amount, date/month, category/scope, payment, counterparty, description, book key, revision, actor, or root drift.
- The shared ledger validator rejects impossible graphs before Apps Script and Cloud Run projections: duplicate IDs/revisions, invalid lifecycle versions/timestamps, invalid or cross-scope supersession, cycles, PREPARED tombstones, broken book chains, multiple effective book rows, and predecessor resurrection.
- VOID and ABANDON terminal transitions reconcile audit-first, state-first, summary, and request-result partials idempotently. Fault-injection tests prove repeated recovery converges without duplicate totals or audit records.
- VOID requires an active actor with `canManageExpense`; it does not independently require submit permission. The client exposes VOID to a manage-only finance user while keeping replacement unavailable without submit permission.
- VOID is revision-bound end to end. A stale `expectedRevision` is durably completed as `EXPENSE_REVISION_CONFLICT`, produces no VOID audit/state mutation, and is excluded from recovery candidates.

## B. Storage and upload fencing

- Drive upload slots use durable `CLAIMED -> REGISTERED` state bound to lease owner and generation. Only the registered file ID is authoritative for COMMIT or reconstruction.
- A late stale create cannot replace the winner. The loser cleanup path revalidates the exact unregistered file before safe deletion and re-lists the slot. Delayed-create/takeover tests prove one durable slot and one COMMIT.
- This wave implemented and tested the cleanup boundary only. No live Drive deletion was executed.
- Original filenames use one shared 160-Unicode-character contract across browser, multipart, staging, submission, Drive, signed ingress, and reads. Boundary tests cover 160/161.
- Staging tokens now carry `issuedAt`, enforce an exact maximum 24-hour TTL, safe integer arithmetic, canonical base64url, bounded parts/secret/total length, and future/expired/oversized rejection.
- Upload single-flight identity binds the complete immutable metadata and content fingerprint. Same-slot calls with different metadata conflict instead of sharing a promise.
- The canonical attachment manifest is shared across runtimes and covered by golden tests.

## C. Fresh topology, auditable reads, and resume authority

- Added explicit idempotent `bootstrapPmcExpenseMonth(YYYY-MM)` guarded by exact owner approval property `PMC_EXPENSE_MONTH_BOOTSTRAP_APPROVED`. It creates/verifies the selected month without a pilot expense write.
- The checker attests the exact bootstrapped month and the runbook orders master setup, permission migration, month bootstrap, then disabled reads-only preflight.
- The bootstrap entrypoint, runbook, checker, and tests were exercised locally only. No Apps Script or Google setup call was made.
- Totals use effective COMMITTED rows only. Auditable history returns bounded effective COMMITTED plus retained VOID rows; abandoned PREPARED rows remain hidden. Retained COMMITTED/VOID evidence stays available after finance authorization, while correction actions remain state/capability gated.
- Added a distinct HMAC `MINI_APP_EXPENSE_RESUME` contract and authenticated `POST /api/mini-app/expenses/resume/:root` path. Resolution is submitter-owned, returns only COMMITTED/PENDING/SAFE_TO_RETRY/FAILED, exposes no history, and remains constructible in resume-only rollback topology.
- Other-staff resume attempts fail with `EXPENSE_RESUME_FORBIDDEN`. Reload after a lost response returns the same durable receipt without another submit or duplicate bill.

## D. Client resilience and exact contracts

- Reads-only finance mode works with revenue reports and capture disabled: it exposes monthly expenses, history, and evidence without calling income APIs or rendering estimated balance.
- Browser session storage contains exactly `{"version":1,"rootRequestId":"..."}`. No form value, file, staging token, receipt, staff/private ID, or evidence is persisted. Extra or malformed stored fields fail closed.
- Ambiguous submit/status results lock editing, Back, and new-root submission. Only authoritative COMMITTED, SAFE_TO_RETRY, FAILED, or a retryable-false rejection clears/rotates state. All-flags-off terminal resume returns Home rather than disabled report UI.
- Root IDs initialize once, remain stable while PENDING, and rotate after a definite terminal or safe-to-retry result before any changed payload is staged/submitted.
- Satang formatting uses integer/BigInt decomposition everywhere; `Number.MAX_SAFE_INTEGER` renders exactly `90,071,992,547,409.91 บาท`.
- History parsing uses real calendar validation and requires attachment ordinals `1..N` in exact order. Evidence tokens use the shared browser cap. VOID responses bind the requested expense ID and exact next lifecycle version.
- VOID reason is aligned at 3..300 JavaScript string units in UI, Cloud Run, and signed command parsing, with 2/3/300/301 plus non-BMP boundary tests.
- Duplicate filenames include image ordinals. History action/evidence accessible names include a safe row ordinal, category, date, and revision, including same-day/revision rows. Monthly definition lists use valid `dt`/`dd` pairs.
- Preview remains zero-outbound, uses contract-valid staging tokens, unique append-only replacement/attachment IDs, and prevents predecessor resurrection through multiple replacements and a final VOID.

## E. Verification evidence

Focused RED-to-GREEN gates:

- Integrity/recovery: 6 files / 108 tests passed.
- Upload/storage: 11 files / 157 tests passed.
- Topology/read/resume server slice: 10 files / 188 tests passed.
- Final client/resilience slice: 17 files / 238 tests passed.
- Focused reads-only and lost-response Playwright: 2/2 passed.

Serialized final matrix:

- `npx vitest run --maxWorkers=1 --no-file-parallelism`: 183 files / 2,365 tests passed after the targeted independent-review corrections.
- `npm run booking:test`: 46 files / 534 tests passed.
- `npm run ocr:test`: 18 files / 231 tests passed; no rerun was needed.
- `npm run build`: exit 0 for client, OCR review, Mini App, and server.
- `npx tsc -b --pretty false`: exit 0.
- `npm run booking:typecheck`: exit 0.
- `npm run booking:build`: exit 0.
- `npm run lint`: exit 0 with one pre-existing generated-file warning at `dist-server/server/pmc-mini-app/taskQueue.js` for an unused `preserve-caught-error` disable; 0 errors.
- `git diff --check`: exit 0.
- `npx playwright test -c playwright.mini-app.config.ts`: 19/19 passed using one worker.

Build emitted the existing Vite chunk-size advisories only. These advisories and the generated lint warning did not fail their commands.

## Commits

- `2c8a13c fix: harden expense ledger integrity`
- `db76978 fix: fence expense evidence uploads`
- `ccee7ea fix: add auditable expense resume reads`
- `2585fd7 fix: harden expense client resilience`
- `8b1256d fix: close expense resume and drive races`
- `87ee2de fix: reconcile expense replay authority`

## Targeted independent-review corrections

Independent read-only verification after the first final matrix reproduced additional fail-closed edges. Commits `8b1256d` and `87ee2de` close them:

- A two-process delayed Drive create now preserves each exact created descriptor, selects the registered winner on retry, and deletes a loser only after two current-claim reads prove the same non-null registered authority. Claim-read/register uncertainty never deletes a file.
- A COMMITTED replay now loads the immutable registered slot claims, reconciles any surviving late loser through the same two-read fence, then performs strict attachment listing. Cleanup uncertainty can be retried without permanently blocking the durable receipt.
- Resume persistence now fails closed before staging or submission when `sessionStorage` cannot write and read back exactly `{"version":1,"rootRequestId":"..."}`. Tests prove unavailable/quota storage causes zero expense network mutation.
- Reservation-only resume derives the durable owner from the verified canonical command journal and denies other staff. COMMITTED resume rebinds request result, PREPARE/COMMIT commands, submission, and audit payloads before returning the exact receipt; swapped or corrupt results fail closed without history disclosure.
- Resume receipts now require a real calendar date, month-bound `EXP-YYYYMM-*` identifier, canonical timestamp, exact lifecycle state/version, and category/scope consistency.
- COMMITTED resume reconstructs the PREPARE business intent and recomputes the COMMIT attachment manifest against the original PREPARE hash before returning a receipt. Swapped request results, mutated command/audit attachments, or altered PREPARE business fields fail closed.
- Shared ledger validation additionally rejects expense-ID month drift, unsupported payment methods, `updatedAt < committedAt`, successors whose predecessor is not COMMITTED, and reversed successor chronology.
- A pending durable VOID audit blocks replacement commit before any successor write. Legacy audit-first VOID recovery re-checks the current effective authority before mutation and completes a conflict without voiding a superseded predecessor.
- Focused post-review verification passed 22 expense test files / 341 tests, plus the final five-file Drive/resume/VOID matrix / 107 tests. The final serialized, Booking, OCR, build/type/lint, and browser matrices above were rerun from the exact final code.

## No-live and scope evidence

- No deployment, `gcloud`, `clasp`, Google Drive/Sheets/GCS/Apps Script/Cloud Run call, IAM/secret/scheduler/traffic mutation, permission change, snapshot collection, flag change, or pilot write was performed.
- No live loser-file deletion or month bootstrap was executed.
- Revenue, allocation, and category rollout remediation remained out of scope and off.
- OCR approval, payroll, salary/DF, accounting posting, and other deferred expense categories were not implemented.
- `progress.md` was not edited.
- Production activation still requires owner approval, current-state verification, and the runbook gates.
