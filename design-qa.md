# PMC Mini App Home Cards — Design QA

## Comparison target

- Source visual truth: `/var/folders/j1/2g761dps6r1cjhtkw8hjbry00000gn/T/codex-clipboard-e25b7c40-78d8-4b26-8f86-fa0f775da255.png`
- Implementation URL: `http://127.0.0.1:4178/mini-app/?preview=1`
- Implementation screenshot: `/tmp/pmc-home-stock-final.png`
- Combined comparison: `/tmp/pmc-home-stock-final-comparison.png`
- State: Home screen with synthetic staff name `มัส`
- CSS viewport: 390 × 844; additional responsive check at 360 × 800
- Source pixels: 864 × 1821, including the reference device frame
- Implementation pixels: 780 × 765 from the Codex in-app Browser capture
- Density normalization: the full reference was proportionally scaled to the implementation capture height. Device chrome was treated as reference-owned framing and excluded from fidelity findings.

## Full-view comparison evidence

The implementation follows the reference hierarchy: centered company identity, large greeting, one dominant primary-action card, a two-column shortcut grid, one additional utility row, and fixed four-item bottom navigation. PMC gold replaces the reference green by explicit brand decision. The reference has six secondary utilities, while PMC version 1 exposes JERA reports and account plus a visibly disabled Stock placeholder requested by the owner.

## Focused-region comparison

A separate crop was not required because headings, card anatomy, icon containers, CTA, radii, and bottom navigation were all clearly readable in the 1167 × 765 combined comparison.

## Required fidelity surfaces

- Fonts and typography: Thai uses the existing Thai-capable fallback stack, body line height remains 1.7, headings use 1.3, and no Thai letter spacing is applied. Greeting, card headings, supporting copy, and navigation labels preserve the reference hierarchy.
- Spacing and layout rhythm: page gutters, primary-card prominence, two-column shortcut spacing, card radii, soft elevation, and bottom-navigation separation match the reference structure. At 360 px the grid remains two columns (`156px 156px`) with no horizontal overflow.
- Colors and visual tokens: the neutral page, white cards, subtle borders, and low-opacity shadows match the reference treatment. Teal was intentionally mapped to PMC gold tokens.
- Image quality and asset fidelity: the supplied PMC logo is retained. Standard UI symbols use the existing Lucide icon library; rejected generated 3D raster decorations were removed.
- Copy and content: active destinations are real version-1 functions. Stock is explicitly labeled `ยังไม่เปิดใช้งาน`, uses a native disabled button, and performs no action.
- Accessibility and behavior: semantic buttons/links, exact accessible names, focus styles, minimum mobile tap sizes, and reduced-motion handling remain present.

## Comparison history

1. Earlier generated 3D decorations were a P1 visual mismatch: they were oversized, visually heavy, and changed the clean information hierarchy. They were removed completely from the project.
2. The Home screen was rebuilt from the selected card reference using the existing logo and icon system. Post-fix comparison shows no remaining actionable P0/P1/P2 mismatch.
3. Owner annotation removed Google Form from the Home shortcut grid. It was replaced with a disabled Stock card; the existing Google Form fallback remains available only in Account.

## Interaction and runtime verification

- `เริ่มลงนัด` opens the booking wizard.
- `รายงาน JERA` opens the report surface.
- `บัญชีผู้ใช้` opens the account surface.
- `Stock` is visible and disabled; it has no click behavior or backend work.
- No Google Form link appears on Home. The configured Google Form fallback remains present in Account and was inspected but not opened during QA.
- Fresh-browser console check: 0 errors and 0 warnings.
- Responsive check: 360 px viewport, no horizontal overflow.

## Findings

No actionable P0, P1, or P2 findings remain.

## Follow-up polish

- The JERA report center now inherits the approved card radius, white surfaces, gold icon containers, spacing rhythm, and fixed bottom navigation.

## JERA report-center verification

- Report Center screenshot: `/tmp/pmc-report-center.png`
- Payment report screenshot: `/tmp/pmc-report-payment.png`
- Reference comparison: `/tmp/pmc-report-reference-comparison.png`
- Mobile viewport: 390 × 844
- Report choices rendered: 6
- Report card minimum height: 148 px
- Refresh control height: 48 px
- Root horizontal overflow: none (`scrollWidth=clientWidth=390`)
- Report table overflow is contained in its own keyboard-focusable horizontal region.
- Console errors and warnings: 0
- The information density stays lower than the earlier rejected report treatments: one filter card, two-column KPI cards, one compact breakdown, and one bounded detail table.
- Additional-report screenshot: `/tmp/pmc-additional-reports.png`
- Additional-report mobile check at 360 × 800: 8 visible destinations, 72 px minimum row height, no root horizontal overflow, and no console warnings/errors.

final result: passed
