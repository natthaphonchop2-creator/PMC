---
title: Approval Matrix
description: Reviewer assignments, approval criteria, and revision responsibilities for the dashboard redesign.
status: final
owner: Knowledge Base Agent
last_updated: 2026-05-18
---

# Approval Matrix

Use this matrix for each Figma/mockup/spec review cycle. Status values: `Pending`, `OK`, `Needs Revision`, or `Waived`.

| Reviewer | Reviews | Must Approve | Sends Feedback To | Status |
| --- | --- | --- | --- | --- |
| Knowledge Base Agent | Process clarity, handoffs, decision log | Inbox/outbox is complete and assumptions are labeled | Main Codex Agent | OK |
| Product Context Agent | Product scope, user jobs, verified concepts | Redesign matches clinic ads dashboard scope and avoids unsupported claims | Main Codex Agent | OK |
| UX/UI Agent | Layout, navigation, visual hierarchy, responsiveness | Dashboard is scan-friendly, task-focused, and usable across key breakpoints | Main Codex Agent | OK |
| Data & Metrics Agent | Metric names, formulas, data freshness, status meaning | Ads and clinic metrics are clear, sourced, and not misleading | Main Codex Agent | OK |
| Engineering Agent | Feasibility, components, data contracts, states | Spec can be implemented within existing React/TypeScript patterns | Main Codex Agent | OK |
| QA & Review Agent | Final acceptance, accessibility, regression risk | No blocking usability, content, accessibility, or behavior risks remain | Main Codex Agent | OK |

## Current Cycle Status

Cycle 1 result: `Needs Revision`.

Cycle 2 target: `figma-mockup-v2-spec.md`.

| Reviewer Evidence | Cycle 1 Decision | Cycle 2 Status |
| --- | --- | --- |
| `product-context/review-v1.md` -> `product-context/review-v2.md` | Needs Revision | OK |
| `figma-mockup/review-v1.md` -> `figma-mockup/review-v2.md` | Needs Revision | OK |
| `design-review/review-v1.md` -> `design-review/review-v2.md` | Needs Revision | OK |
| `knowledge-curator/review-v1.md` -> `knowledge-curator/review-v2.md` -> `knowledge-curator/review-v3.md` | Needs Revision | OK |

Final status: all active review areas are `OK` for `figma-mockup-v2-spec.md` as the canonical handoff.

R9 production asset replacement status: all active review areas are `OK` for using `public/pmc-ai-mascot.png` and `public/promedclinicpmc-logo.png` as source-of-truth assets.

Older OK evidence:

| Agent | Evidence | Scope |
| --- | --- | --- |
| Product Context Agent | `product-context/shared-outbox.md` | Initial product acceptance criteria and handoff requirements. |
| Knowledge Base Agent | `knowledge-curator/shared-outbox.md` | Initial KB scaffolding and review-loop docs. |
| Visual Reference Agent | `visual-reference/shared-outbox.md` | Visual direction, image prompt, anti-patterns, and pass/fail criteria. |

## Review Order

1. Product Context Agent reviews scope before detailed design feedback.
2. Data & Metrics Agent reviews metric framing before final UI polish.
3. UX/UI Agent reviews layout and interaction detail.
4. Engineering Agent reviews implementation feasibility.
5. QA & Review Agent performs final acceptance.
6. Knowledge Base Agent confirms the loop record is complete.

Parallel review is allowed when the mockup/spec is stable enough, but the main Codex agent must re-request review from any agent whose area changes after feedback.

## Who Reviews Whom

- Product Context Agent reviews the main Codex agent's interpretation of dashboard goals.
- Data & Metrics Agent reviews Product Context and UX/UI metric usage.
- UX/UI Agent reviews Product Context priorities as translated into screens.
- Engineering Agent reviews UX/UI feasibility and data contract impact.
- QA & Review Agent reviews the full combined result.
- Knowledge Base Agent reviews the process artifacts and approval trail.

## Blocking Feedback

Feedback is blocking when it shows that the redesign:

- Misstates verified product behavior.
- Hides or confuses a primary clinic ads workflow.
- Uses misleading metrics, formulas, statuses, or AI confidence language.
- Cannot be implemented without unplanned data model or backend changes.
- Creates serious responsive, accessibility, or layout risk.
- Leaves approval, automation, rollback, or audit behavior ambiguous.

## Main Codex Agent Revision Log

For each revision, record:

- Revision ID or timestamp.
- Feedback source.
- Changed mockup/spec area.
- Summary of change.
- Reviewer recheck needed: yes/no.
- Final decision after recheck.
