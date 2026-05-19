---
owner_agent: figma-mockup
review_type: asset_replacement_recheck
decision: OK
reviewed_at: 2026-05-18T00:00:00+07:00
source_files:
  - knowledge-base/dashboard-redesign/mascot.md
  - knowledge-base/dashboard-redesign/figma-mockup-v2-spec.md
  - knowledge-base/dashboard-redesign/README.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/review-status.md
  - src/App.tsx
allowed_write_scope: knowledge-base/dashboard-redesign/agent-workspace/figma-mockup/
---

# Asset Replacement Review

Decision: OK

## Scope

This review is limited to:

- Asset paths.
- Component naming.
- Implementation feasibility.
- Deferred Figma canvas sync.

## Findings

- `mascot.md` now treats `public/pmc-ai-mascot.png` and `public/promedclinicpmc-logo.png` as the production source-of-truth assets, with the generated mascot paths explicitly marked as superseded.
- `figma-mockup-v2-spec.md` names `Component / Mascot Accent` and uses implementation-friendly placement rules for setup, no-data, AI queue footer, and help/onboarding states.
- `README.md` lists both public assets under Current Artifacts, matching the source-of-truth paths in `mascot.md`.
- `orchestrator/review-status.md` records R9 as a production asset replacement that requires targeted recheck, and keeps Figma canvas sync deferred under the documented MCP Starter plan limit.
- `src/App.tsx` references the public assets with valid Vite runtime URLs:
  - `/pmc-ai-mascot.png`
  - `/promedclinicpmc-logo.png`
- The checked files exist at:
  - `public/pmc-ai-mascot.png`
  - `public/promedclinicpmc-logo.png`

## Assessment

The documented `public/...` paths and React `/...` runtime references are consistent for a Vite app because files in `public/` are served from the web root.

Component naming is feasible for Figma and implementation handoff. The canonical spec uses `Component / Mascot Accent`, while the current React implementation maps the same concept through concrete UI classes such as `sidebar-mascot`, `assistant-avatar`, `empty-mascot`, and `platform-mascot-card`. No blocking naming mismatch was found for this asset replacement recheck.

Implementation is feasible without additional asset migration. The app already loads both production PNGs from the public root, and the documentation no longer requires the superseded generated mascot.

Figma canvas sync remains correctly deferred. The source docs identify the current blocker as the Figma Starter plan MCP tool-call limit and keep `mascot.md` plus `figma-mockup-v2-spec.md` as canonical until canvas updates are possible.

## Decision Rationale

OK. The asset replacement is internally consistent across source docs and current React references. No revision is required for asset paths, component naming, implementation feasibility, or deferred Figma canvas sync.
