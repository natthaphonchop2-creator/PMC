---
owner_agent: knowledge-curator
status: complete
decision: OK
reviewer_role: Knowledge Curator Asset Replacement Review Agent
created_at: 2026-05-18T00:00:00+07:00
source_files:
  - knowledge-base/dashboard-redesign/mascot.md
  - knowledge-base/dashboard-redesign/README.md
  - knowledge-base/dashboard-redesign/figma-mockup-v2-spec.md
  - knowledge-base/dashboard-redesign/agent-workspace/SHARE_INDEX.md
  - knowledge-base/dashboard-redesign/approval-matrix.md
  - knowledge-base/dashboard-redesign/agent-workspace/orchestrator/review-status.md
handoff_to:
  - orchestrator
  - main-codex-agent
summary: Targeted R9 asset replacement review for indexing, traceability, and finalization under the documented Figma MCP plan-limit constraint.
---

# Knowledge Curator Asset Replacement Review

## Decision

OK.

The R9 user-provided asset replacement is indexed, traceable, and finalizable as a documented source-of-truth update while Figma canvas synchronization remains blocked by the Figma Starter plan MCP tool-call limit.

This review only covers whether the replacement assets are documented well enough for handoff and later Figma sync. It does not re-review visual quality, product fit, accessibility implementation, or Figma canvas fidelity.

## Review Findings

### Indexed

Closed.

- `README.md` lists `mascot.md` as the mascot/logo asset document.
- `README.md` lists current artifacts for both production assets:
  - `public/pmc-ai-mascot.png`
  - `public/promedclinicpmc-logo.png`
- `SHARE_INDEX.md` includes the R9 handoff from orchestrator to product-context, figma-mockup, design-review, and knowledge-curator, naming both production public asset paths as the source of truth.

### Traceable

Closed.

- `mascot.md` front matter names `asset_path: public/pmc-ai-mascot.png` and `logo_asset_path: public/promedclinicpmc-logo.png`.
- `mascot.md` records the superseded exploratory generated mascot paths so the replacement from generated asset to user-provided production asset is explicit.
- `figma-mockup-v2-spec.md` uses `public/pmc-ai-mascot.png` for `Component / Mascot Accent` and `public/promedclinicpmc-logo.png` for the sidebar/header and asset reference section.
- `orchestrator/review-status.md` records R9 as the user-provided production asset replacement and states that `mascot.md`, README, and the v2 spec were updated so the public assets supersede the generated exploratory mascot.

### Figma MCP Limit Handling

Closed.

- `mascot.md` states that Figma sync is deferred because the `V2 Companion / Mascot Accent Rules` canvas update was blocked by the Figma Starter plan MCP tool-call limit.
- `figma-mockup-v2-spec.md` states that future Figma canvas sync should use the public production assets, not the exploratory generated mascot.
- `orchestrator/review-status.md` keeps the Figma canvas patch deferred under the same Starter plan MCP limit and records R9 as requiring targeted recheck.

## Approval Matrix Note

`approval-matrix.md` remains a general approval matrix for the canonical `figma-mockup-v2-spec.md` and does not add an R9-specific asset row. That is acceptable for this targeted knowledge-curator review because the R9 asset replacement is separately indexed in `SHARE_INDEX.md`, recorded in the orchestrator revision log, and incorporated into the canonical v2 spec and `mascot.md`.

## Finalization Readiness

Ready from the knowledge-curator traceability scope.

The production mascot and logo paths are durable enough for handoff:

- Mascot: `public/pmc-ai-mascot.png`
- Logo: `public/promedclinicpmc-logo.png`

Future Figma sync can proceed from those paths when MCP quota/access is available.
