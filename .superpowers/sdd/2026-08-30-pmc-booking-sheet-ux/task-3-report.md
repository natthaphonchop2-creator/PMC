# Task 3 Report — Sheets-v4 gateway, private backup, apply, and readback

## Status

Implemented locally on base `88815cd`. No Apps Script push, owner entrypoint, live Google Sheet read/write, real Drive backup, queue action, deployment, or external call was performed.

## Implementation

- Added a narrow `WorkbookPresentationGateway` and workflow port for structural inspection, verified private native backup creation, one presentation-only batch, and bounded document locking.
- Added a Sheets Advanced Service v4 adapter that reads one allowlisted metadata attestation and returns only structural metadata plus SHA-256 hashes. Raw values, formulas, notes, validation payloads, Drive URLs, and identifiers are not logged or returned by workflow results.
- The source fingerprint binds the complete allowlisted Sheets-v4 response with injected SHA-256, so a change to values or any inspected presentation metadata between backup and apply stops before `batchUpdate`.
- Dry run performs one inspection and pure planning only. Apply runs under a document lock: inspect/plan, translate and validate, create and verify one private native Spreadsheet copy, re-inspect the exact fingerprint, send exactly one Sheets `batchUpdate`, inspect readback, and run the pure Task 2 verifier.
- An already-presented workbook returns an idempotent no-op without backup or batch mutation. Backup, stale-state, batch, and readback failures release the lock, perform no automatic rollback, and never claim verification.
- Translation accepts only sheet move/hide/freeze, exact full-grid basic filter, targeted column width, bounded cell format, and bounded actionable conditional-format requests. It rejects forged action/style/rule types, duplicate filters/actions, overlapping owned ranges, and unsafe request shapes.
- Cell updates contain only `userEnteredFormat` with precise field masks. They cannot write/clear values, formulas, notes, validations, protections, filter views, rows, columns, tabs, or autofit dimensions.
- Reused the existing single Sheets v4 Advanced Service manifest entry and strengthened the build regression to require exactly one matching entry.

## TDD evidence

RED was observed before production implementation:

1. The first focused run failed at module import because `googleWorkbookPresentation.ts` did not exist.
2. A focused color-style compatibility test failed because the first reader recognized deprecated color fields only; normalization was then added for both Sheets v4 color encodings.
3. A focused unsupported-metadata test failed because spreadsheet-level named ranges were not rejected; the attestation and preflight were tightened before GREEN.

GREEN verification:

- Focused policy/gateway/build suites: `2` files, `57` tests passed; the final presentation suite contains `52` passing tests.
- Full Booking suite: `51` files, `748` tests passed.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- Full `npm run lint`: zero errors; one pre-existing generated unused-disable warning only.
- `git diff --check`: passed.

## Self-review

- Preview has no lock, backup, Drive mutation, batch update, or owner/runtime export.
- Backup occurs only for a nonempty plan and before the sole batch; exact source fingerprint is rechecked after backup.
- Batch request top-level keys and nested cell fields are allowlisted and deterministic; no value/protection/filter-view/schema mutation is representable.
- Readback checks immutable value/formula/validation/protection hashes, exact presentation fingerprint, and zero remaining presentation actions.
- Errors use fixed safe codes and workflow results expose only counts/status/hash digests, never cell contents or Google resource references.
- The live workbook remains untouched; owner-only preview/apply entrypoints and the maintenance runbook remain Task 4.
