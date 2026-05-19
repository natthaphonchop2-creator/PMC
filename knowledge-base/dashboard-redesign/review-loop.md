---
title: Cross-Agent Review Loop
description: Inbox/outbox process for repeating dashboard redesign review until every agent approves.
status: draft
owner: Knowledge Base Agent
last_updated: 2026-05-18
---

# Cross-Agent Review Loop

The dashboard redesign is not final until every required review agent marks the current Figma/mockup/spec as OK or explicitly waives review. Any `Needs Revision` decision sends the work back to the main Codex agent for targeted updates.

## Loop States

- `Draft`: main Codex agent has prepared or revised the Figma/mockup/spec.
- `In Review`: one or more agents are reviewing assigned areas.
- `Needs Revision`: at least one reviewer has actionable feedback.
- `Revised`: main Codex agent has updated the Figma/mockup/spec and documented changes.
- `Approved`: every required reviewer has marked OK or waived.

## Inbox Handoff

Each reviewer inbox should receive:

- Current Figma/mockup/spec link or file path.
- Dashboard area under review.
- Known assumptions and open questions.
- Previous feedback and revision notes, if any.
- Requested decision: `OK`, `Needs Revision`, or `Waived`.

## Outbox Handoff

Each reviewer outbox should return:

- Decision: `OK`, `Needs Revision`, or `Waived`.
- Reviewer name/role and date.
- Blocking issues, if any.
- Non-blocking suggestions, if any.
- Exact target area: screen, component, copy, metric, state, or interaction.
- Acceptance condition for each blocking issue.

## What Counts as OK

`OK` means the reviewer found no blocking issue in their area of responsibility. Non-blocking suggestions may remain, but they must not prevent handoff.

Minimum OK conditions:

- Product scope is accurate and does not claim unverified capabilities.
- Primary workflows are understandable from the mockup/spec.
- Metrics, statuses, and AI/automation language are clear.
- Layout is feasible, responsive, and not visually ambiguous.
- Known assumptions are labeled.

## Revision Rules for Main Codex Agent

When feedback arrives, the main Codex agent should:

- Group feedback by blocker, reviewer, and dashboard area.
- Revise the Figma/mockup/spec only where needed to satisfy acceptance conditions.
- Preserve verified app concepts and avoid expanding scope without approval.
- Update copy, layout, component states, or annotations based on the reviewer evidence.
- Record a short revision note describing what changed and which feedback it closes.
- Re-run the loop for any reviewer whose area was affected by the revision.

## Exit Criteria

The loop exits only when:

- The approval matrix shows `OK` or `Waived` for every required reviewer.
- All blockers are closed or explicitly deferred with owner and reason.
- The final Figma/mockup/spec revision is identified by link, filename, timestamp, or version note.
