# Task 2 Report — Pure guarded workbook-presentation policy

## Status

Implemented locally on base `a4f31bb`. No Apps Script push, Google API call, live Google Sheet read/write, backup, deployment, lock, runtime entrypoint, or external action was performed.

## Implementation

- Added a pure `buildWorkbookPresentationPlan(snapshot)` policy with the exact eleven-tab visible order and an explicit fail-closed hidden-tab allowlist for current Form/raw/import/retry/audit/nonce/sequence/Mini App/JERA/payment/allocation/Stock tabs.
- Rejects unknown or missing operator tabs, duplicate titles/IDs/indices, invalid index sequences/ranges, managed-header drift, unexpected filters/filter views/merges/protections, unsupported metadata, and overlapping or duplicate presentation metadata before any action can be returned.
- Emits only the allowed presentation actions: sheet move/hide, freeze, full-grid basic filters on the four operator tabs, targeted widths, bounded format ranges, and bounded status rules. There is no rename/delete/insert/clear/value/formula/validation/protection/filter-view/autofit action.
- Applies the exact row/column freeze policy, no Dashboard filter, the plan's width maps, wrapped headers, plain-text identifier/hash/phone/URL/JSON columns, currency columns, white-grid/header style keys, and five actionable status rules.
- Added stable action ordering, duplicate/overlap conflict guards, deterministic projected presentation fingerprints, exact plan verification, unchanged value/formula/validation/protection hash checks, and idempotent readback verification.
- Raw `FORM_RESPONSES` column names are explicitly preserved as unmanaged source headers; the policy validates and formats only the managed operator/config schemas and exact known system schemas.

### Review fix round 1

- Replaced substring currency detection with an exact numeric allowlist: `depositAmount`, `jeraActualRevenue`, and `commissionAmount`; `commissionEligibility` remains categorical body text.
- Split Dashboard formatting into four non-overlapping regions: row 1 KPI header, rows 2–10 KPI body, row 13 operation header, and row 14 onward operation body. Rows 11–12 remain untouched.
- Deep-froze exported policy data and recursively cloned/froze returned plans, actions, and nested ranges; later plans cannot be changed through a previously returned object.
- Enforced frozen row 1 and zero frozen columns on all exact schema-owned hidden tables. `FORM_RESPONSES` is the sole explicit source-owned freeze exception.
- Removed the custom 64-bit checksum. Plan building and verification now require a caller-injected portable SHA-256 hex function and reject missing or malformed digest implementations.
- Expanded the canonical test topology to all 20 current hidden tabs (the 28-tab Booking workbook plus three optional Stock tabs), with per-tab managed-header drift checks and retained unknown-prefix rejection.

## TDD evidence

RED was observed twice before the corresponding production behavior:

1. The first focused run failed at import because `workbookPresentation.ts` did not exist.
2. A later focused run failed `1` of `16` tests because a fabricated `MINI_APP_UNKNOWN` tab was accepted by an overly broad prefix classifier. The classifier was tightened to the explicit allowlist.
3. Review fix round 1 first failed `4` of `19` focused tests on the categorical commission field, Dashboard split, injected SHA-256/deep immutability, and managed hidden-tab freeze requirements. Each behavior was then implemented and rerun.

GREEN verification:

- Focused presentation policy suite: `1` file, `38` tests passed.
- Full Booking suite: `51` files, `734` tests passed.
- `npm run booking:typecheck`: passed.
- `npm run booking:build`: passed.
- Touched-path ESLint: passed with zero findings.
- Full `npm run lint`: zero errors; one pre-existing generated unused-disable warning only.
- `git diff --check`: passed.

## Self-review

- Plan generation is pure and stable for equivalent snapshots.
- A fully presented readback produces zero actions and the same expected presentation fingerprint.
- Verification rejects incomplete application, forged plans, and changes to values, formulas, validations, or protections.
- Unknown prefixed tabs fail closed rather than inheriting broad Mini App/Stock classification.
- Hidden tabs receive only hidden-state/order handling; raw/cache content and formatting are not rewritten.
- No identifier, value, PII, secret, or live workbook metadata is logged or included in an error message.
- Work is limited to Sheet UX Task 2; adapter, backup, runtime, entrypoint, and live apply work remain for later tasks.
