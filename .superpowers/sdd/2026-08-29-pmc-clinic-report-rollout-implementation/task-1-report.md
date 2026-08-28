# Task 1 implementation report

## Outcome

Implemented the PMC Clinic Reports product-facing language contract. Rendered and ARIA-facing report surfaces now use clinic language and do not expose `JERA` (case-insensitive). Internal TypeScript identifiers, routes, warning codes, and storage keys remain unchanged.

## Guidance applied

- `modern-web-guidance` was searched first and the `accessibility` guide was retrieved. The implementation preserves native buttons, semantic headings, explicit accessible names, and `aria-hidden="true"` on decorative Lucide SVGs. The new copy test checks both visible output and ARIA labels.
- `praneet-front` was applied to the Thai-facing copy review: Thai strings remain natural and readable, no Thai `letter-spacing` or word-break changes were introduced, and existing Thai-capable typography/layout tokens were left intact because this task is copy-only.

## TDD evidence

1. Added `tests/pmc-mini-app/reportCopy.test.tsx` before production edits.
2. RED: `npx vitest run tests/pmc-mini-app/reportCopy.test.tsx` failed 2/2 tests for the expected old Home accessible name and old Report Center source note.
3. GREEN: after the minimal copy changes, the same test passed 2/2.

## Changes

- `src/apps/pmc-mini-app/Home.tsx`
  - Renamed the enabled quick card accessible name and label to `รายงานคลินิก`.
  - Applied the exact description `ดูข้อมูลการเงิน นัดหมาย และการดำเนินงาน`.
- `src/apps/pmc-mini-app/ReportCenter.tsx`
  - Replaced the provider source note with `ข้อมูลจากระบบคลินิกแบบอ่านอย่างเดียว`.
  - Changed the additional-report eyebrow to `CLINIC REPORT`.
  - Changed additional-report item notes to `ดูข้อมูลรายงาน`.
- `src/apps/pmc-mini-app/ReportPage.tsx`
  - Changed the report-page eyebrow to `CLINIC REPORT`.
- `tests/pmc-mini-app/reportCopy.test.tsx`
  - Added rendered-copy and provider-name guard coverage for Home, Report Center, Additional Report Menu, and Report Page.
- `tests/pmc-mini-app/clientShell.test.tsx`
  - Updated report navigation selectors to `รายงานคลินิก`.

## Verification

- Focused suite: `npx vitest run tests/pmc-mini-app/reportCopy.test.tsx tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/reportCenter.test.tsx tests/pmc-mini-app/reportPage.test.tsx`
  - PASS: 4 files, 21 tests.
- PMC Mini App regression suite: `npx vitest run tests/pmc-mini-app`
  - PASS: 51 files, 605 tests.
- `git diff --check`
  - PASS.
- Render-surface scan for `JERA` in the changed report components found only allowed internal TypeScript names/error codes; no provider name is rendered by the changed surfaces.

## Self-review

- Exact copy contract is implemented for Home, source note, both report eyebrows, and additional-report notes.
- Provider-name guard checks text content and case-insensitive ARIA labels.
- Booking, async navigation, and Stock behavior was covered by the existing client shell regression tests and remained green.
- No changes were made to report API contracts, internal provider types, routes, warning codes, storage keys, or unrelated report/Stock/Booking code.

## Concerns

- The full PMC Mini App run emits existing Node `punycode` deprecation warnings from dependencies; there are no test failures.
- `tests/pmc-mini-app/browserAcceptance.spec.ts` retains a negative assertion for the old label because it verifies that the old label is absent and was outside the task's specified file set; it does not create rendered `JERA` output.

## Commit

- Implementation commit: `89299d8d00da28424d3a6eca5473b1ba37659903` (`feat: rebrand PMC clinic reports`)
