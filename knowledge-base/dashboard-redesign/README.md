---
title: Dashboard Redesign Knowledge Base
description: Entry point for concise redesign documentation for the PMC Ads Agent clinic ads dashboard.
status: final
owner: Knowledge Base Agent
last_updated: 2026-05-18
---

# Dashboard Redesign Knowledge Base

This folder collects working notes for the PMC Ads Agent dashboard redesign. The source app appears to be a React/Vite/TypeScript prototype for an internal clinic ads command dashboard with Meta Marketing API data, AI recommendations, approvals, reports, and clinic performance views.

These docs are intentionally concise. They should guide redesign work without inventing product behavior that has not been verified in the codebase.

## Files

- [agent-roles.md](./agent-roles.md): responsibilities for agents collaborating on the redesign.
- [workflow.md](./workflow.md): proposed operating flow from discovery through handoff.
- [dashboard-brief.md](./dashboard-brief.md): verified product context, audience assumptions, and redesign goals.
- [reference-image.md](./reference-image.md): generated visual reference and prompt source.
- [mascot.md](./mascot.md): user-provided mascot/logo assets and usage rules.
- [figma-mockup-v1-spec.md](./figma-mockup-v1-spec.md): created Figma v1 structure.
- [figma-mockup-v2-spec.md](./figma-mockup-v2-spec.md): revised canonical spec for Cycle 2 recheck.
- [design-review-checklist.md](./design-review-checklist.md): practical checklist for reviewing dashboard changes.
- [review-loop.md](./review-loop.md): cross-agent inbox/outbox review loop that repeats until all agents approve.
- [approval-matrix.md](./approval-matrix.md): who reviews whom, approval criteria, and revision ownership.

## Current Artifacts

- Reference image: `knowledge-base/dashboard-redesign/assets/pmc-dashboard-reference.png`
- Mascot asset: `public/pmc-ai-mascot.png`
- Logo asset: `public/promedclinicpmc-logo.png`
- Figma file: https://www.figma.com/design/e51pdNi0vcWlvyOalOrt0O
- Figma root frame: `Desktop Mockup / PMC Ads Agent Dashboard / 1440x1000`
- Current canonical spec: `figma-mockup-v2-spec.md`
- Review status: `agent-workspace/orchestrator/review-status.md`

## Ground Rules

- Treat the dashboard as a work tool for clinic ads operations, not a marketing landing page.
- Preserve verified app concepts: Meta API data, campaign/ad set/ad views, AI recommendations, approval guardrails, creative/audience/compliance context, settings, and reporting.
- Mark assumptions clearly when details are not confirmed.
- Keep redesign artifacts small, navigable, and easy for implementation agents to consume.
- Do not treat a Figma mockup, dashboard spec, or implementation plan as final until every listed review agent has marked it OK or has explicitly waived review.
