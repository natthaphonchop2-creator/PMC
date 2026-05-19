---
title: Dashboard Redesign Workflow
description: Recommended workflow for redesigning the PMC Ads Agent clinic ads dashboard.
status: draft
owner: Knowledge Base Agent
last_updated: 2026-05-18
---

# Dashboard Redesign Workflow

## 1. Discover

Review the current app structure, visible dashboard sections, data models, and existing documentation. Record only verified concepts and open questions.

Outputs:

- Current navigation map.
- List of core dashboard jobs.
- Known data sources and missing data assumptions.

## 2. Frame

Define the redesign objective for each major view. The dashboard should help operators understand performance, spot risk, approve AI recommendations, and manage ads work with clinic context.

Outputs:

- View-by-view brief.
- Primary user actions.
- Metrics and status states needed per view.

## 3. Design

Create layouts that favor scanning and repeated operations. Use compact sections, clear hierarchy, consistent status colors, accessible contrast, and stable responsive dimensions.

Outputs:

- Proposed information architecture.
- Component inventory.
- Empty, loading, error, and connected-data states.

## 4. Implement

Make scoped code changes that match the existing app conventions. Avoid unrelated refactors. Keep names and copy aligned with verified dashboard concepts.

Outputs:

- Updated UI files.
- Any required type or fixture changes.
- Notes for behavior that still needs backend or API confirmation.

## 5. Review

Validate the redesigned experience against the checklist. Confirm content is accurate, layouts do not overlap, responsive behavior is usable, and AI/automation actions remain clearly gated.

Outputs:

- Review checklist result.
- Known issues.
- Handoff notes for the next agent.

## 6. Cross-Agent Approval Loop

Run the review loop until all review agents approve the Figma/mockup/spec or explicitly waive review. Feedback should be routed through inbox/outbox handoffs, with each revision tied to the agent that requested it.

Outputs:

- Completed approval matrix.
- Revision log showing what changed in the mockup/spec.
- Final approval note for the main Codex agent.
