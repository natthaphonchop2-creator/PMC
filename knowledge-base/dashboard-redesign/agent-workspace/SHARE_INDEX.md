# Agent Share Index

All cross-Agent file handoffs are appended here.

## 2026-05-18

| Source Agent | Source File | Target Agent(s) | Handoff Note |
| --- | --- | --- | --- |
| orchestrator | `orchestrator/product-context-handoff.md` | visual-reference, figma-mockup, design-review | Validate dashboard redesign work against product scope, required metrics, risk states, and blocking risks. |
| orchestrator | `orchestrator/visual-reference-handoff.md` | figma-mockup, design-review | Use this visual direction and pass/fail criteria for the reference image and Figma mockup. |
| orchestrator | `orchestrator/review-status.md` | knowledge-curator | Track cross-agent approvals, revision notes, and pending rechecks. |
| orchestrator | `../figma-mockup-v1-spec.md` | figma-mockup, design-review | Review the created Figma v1 structure and identify any blockers before final approval. |
| product-context | `product-context/review-v1.md` | orchestrator, figma-mockup, design-review | Cycle 1 decision: Needs Revision for missing metrics, states, sample-value disclosure, and unverified claims. |
| figma-mockup | `figma-mockup/review-v1.md` | orchestrator, design-review, knowledge-curator | Cycle 1 decision: Needs Revision for state coverage, component inventory, Thai/English fit rules, and implementation mapping. |
| design-review | `design-review/review-v1.md` | orchestrator, figma-mockup, knowledge-curator | Cycle 1 decision: Needs Revision for action states, destructive confirmation, taxonomy, empty/error states, responsive, and accessibility. |
| knowledge-curator | `knowledge-curator/review-v1.md` | orchestrator, main-codex-agent | Cycle 1 decision: Needs Revision for traceability, outbox evidence, matrix sync, and response indexing. |
| orchestrator | `../figma-mockup-v2-spec.md` | product-context, figma-mockup, design-review, knowledge-curator | R3 recheck target. Closes Cycle 1 blockers in the canonical design handoff while Figma canvas edits are blocked by plan limit. |
| product-context | `product-context/review-v2.md` | orchestrator, figma-mockup, design-review | Cycle 2 decision: OK for product scope, metrics, states, sample disclosure, and claim cleanup. |
| figma-mockup | `figma-mockup/review-v2.md` | orchestrator, design-review, knowledge-curator | Cycle 2 decision: OK for component structure, state coverage, Thai/English fit, and implementation mapping. |
| design-review | `design-review/review-v2.md` | orchestrator, figma-mockup, knowledge-curator | Cycle 2 decision: OK for action safety, taxonomy, responsive behavior, and accessibility targets. |
| knowledge-curator | `knowledge-curator/review-v2.md` | orchestrator, main-codex-agent | Cycle 2 decision: Needs Revision because Cycle 2 decisions were not yet synchronized into status/index/outboxes. |
| knowledge-curator | `knowledge-curator/review-v3.md` | orchestrator, main-codex-agent | Cycle 3 decision: OK for traceability after Cycle 2 decisions were synchronized. |
| orchestrator | `../mascot.md` | figma-mockup, design-review, knowledge-curator | R7 mascot addition for targeted review: decorative usage, placement rules, and traceability. |
| orchestrator | `../mascot.md` | product-context, figma-mockup, design-review, knowledge-curator | R9 production asset replacement: use `public/pmc-ai-mascot.png` and `public/promedclinicpmc-logo.png` as source of truth. |
| product-context | `product-context/review-assets.md` | orchestrator, figma-mockup, design-review | R9 decision: OK for product context and automation-claim safety. |
| figma-mockup | `figma-mockup/review-assets.md` | orchestrator, design-review, knowledge-curator | R9 decision: OK for Figma/implementation handoff and deferred canvas sync. |
| design-review | `design-review/review-assets.md` | orchestrator, figma-mockup, knowledge-curator | R9 decision: OK for visual hierarchy, accessibility, density, and misuse constraints. |
| knowledge-curator | `knowledge-curator/review-assets.md` | orchestrator, main-codex-agent | R9 decision: OK for traceability and finalization under the Figma MCP limit. |
