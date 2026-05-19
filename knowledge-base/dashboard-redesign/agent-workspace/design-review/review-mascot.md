---
owner_agent: design-review-mascot
status: complete
intended_readers:
  - orchestrator
  - figma-mockup
  - knowledge-curator
source_files:
  - knowledge-base/dashboard-redesign/mascot.md
  - knowledge-base/dashboard-redesign/figma-mockup-v2-spec.md
  - knowledge-base/dashboard-redesign/reference-image.md
  - knowledge-base/dashboard-redesign/design-review-checklist.md
review_focus:
  - visual hierarchy
  - accessibility
  - density
  - decorative mascot misuse
updated_at: 2026-05-18T00:00:00+07:00
decision: OK
---

# Mascot Design Review

## Decision

OK.

The mascot guidance is acceptable for the dashboard redesign as documented. It keeps the asset secondary to operational content, avoids using it as a status or automation signal, and includes enough placement and accessibility constraints to prevent decorative misuse.

## Review Notes

### Visual Hierarchy

- The mascot is correctly positioned as a small accent for setup, no-data, AI queue footer, help, and onboarding contexts.
- The spec explicitly keeps it out of KPI cards, campaign rows, charts, and destructive Meta write confirmation controls. This protects the dashboard's primary hierarchy: metrics, funnel health, campaign comparison, and approval safety remain visually dominant.
- The 48-96px dense-panel size and 140px setup/no-data limit are appropriate. These bounds prevent the asset from becoming a hero image or competing with decision-critical content.

### Accessibility

- The mascot is correctly treated as decorative unless surrounding copy explicitly gives it meaning.
- Empty and setup states do not rely on the image alone; the written state message carries the operational meaning.
- The spec avoids using the mascot as the only indicator of AI activity, approval, risk, or execution state. This aligns with the checklist requirement that status meaning not depend on color, icons, or visual decoration alone.

### Density

- The placement rules fit the dense cockpit direction from the reference image and v2 spec.
- Restricting mascot use to secondary surfaces prevents unnecessary visual weight in high-density areas such as KPI grids, campaign tables, and charts.
- The AI queue footer placement is acceptable only as a small assistant accent. It should not add another persistent visual block that increases right-rail crowding.

### Decorative Misuse

- The documented constraints prevent the main misuse cases: mascot as hero, mascot behind text, mascot inside destructive confirmation, mascot as automation indicator, and mascot as a replacement for state copy.
- The component inventory should preserve the `Component / Mascot Accent` boundary so implementation can enforce decorative-only variants instead of allowing arbitrary placement.

## Non-Blocking Follow-Up

When the Figma canvas can be updated again, add the mascot only to the documented companion states and footer/help contexts. If the canvas shows mascot usage in primary data surfaces or approval controls, that should be treated as a revision request even though this document review is OK.
