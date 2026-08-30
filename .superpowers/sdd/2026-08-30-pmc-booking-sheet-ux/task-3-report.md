# Task 3 Report — Sheets-v4 gateway, private backup, apply, and readback

## Status

Implemented locally on base `88815cd`. No Apps Script push, owner entrypoint, live Google Sheet read/write, real Drive backup, queue action, deployment, or external call was performed.

## Implementation

- Added a narrow `WorkbookPresentationGateway` and workflow port for structural inspection, verified private native backup creation, one presentation-only batch, and bounded document locking.
- Added a Sheets Advanced Service v4 adapter that reads one allowlisted metadata attestation and returns only structural metadata plus SHA-256 hashes. Raw values, formulas, notes, validation payloads, Drive URLs, and identifiers are not logged or returned by workflow results.
- The source fingerprint binds the complete allowlisted Sheets-v4 response with injected SHA-256, so a change to values or any inspected presentation metadata between backup and apply stops before `batchUpdate`.
- Dry run performs one inspection and pure planning only. Apply runs under the standalone project's bounded script lock: inspect/plan, translate and validate, create and verify one private native Spreadsheet copy, re-inspect the exact fingerprint, send exactly one Sheets `batchUpdate`, inspect readback, and run the pure Task 2 verifier.
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

## Fix round 1 — Google production contracts

All three Critical findings and the Important metadata finding from `task-3-review.md` were addressed locally without a live call.

- Replaced the unavailable standalone `getDocumentLock()` path with bounded `getScriptLock()` and retained guaranteed release. The production-shape fake exposes a null document lock and proves it is never selected.
- Replaced the unsupported DriveApp permission mutation with the already-enabled Drive Advanced Service v3. Before copy, the source must be the exact owned native Spreadsheet and the destination must be an owned, non-shared My Drive folder with exactly one user/owner permission and no inherited permission details. Permission requests intentionally exclude principal names, emails, domains, and permission IDs.
- Native copy verification re-reads exact MIME, owner, My Drive state, parent, trash state, URL presence, and the exact owner-only permission shape. Any post-copy failure attempts to trash only the newly-created copy; cleanup failure still emits one fixed safe code and never targets the source.
- Replaced deprecated color writes with RGB `ColorStyle` fields for backgrounds, text, borders, and conditional rules. Readback honors theme precedence, rejects theme-color false positives, and compares RGB/alpha with the documented `1e-5` tolerance so float32 round trips remain idempotent.
- Extended the Sheets v4 attestation with chip runs, text/rich-link runs, data-source formulas/tables, pivot tables, and row metadata. Chip/rich-link content and data-source formulas affect SHA-256 hashes without entering snapshots; pivot/data-source tables plus hidden/filtered/developer-metadata rows fail closed before backup.
- Added an immutable `rowMetadataHash` and readback check for supported row-height metadata.
- Reused exactly one Sheets v4 and exactly one Drive v3 Advanced Service manifest entry.

Fix-round TDD evidence:

- RED reproduced the null standalone document lock, unsupported DriveApp backup path, deprecated-color request shape, float32/theme readback failures, omitted chip/data-source hashes, unclassified pivot/table/hidden-row objects, and absent row-metadata readback check.
- Focused policy/gateway/build suites: `2` files, `80` tests passed.
- Full Booking suite: `51` files, `771` tests passed.
- Booking typecheck/build passed; full lint reported zero errors and the same one pre-existing generated warning; `git diff --check` passed.
