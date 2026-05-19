---
title: Design Review Checklist
description: Checklist for reviewing dashboard redesign changes before handoff.
status: draft
owner: Knowledge Base Agent
last_updated: 2026-05-18
---

# Design Review Checklist

## Product Accuracy

- The UI does not claim unverified features or integrations.
- Meta API connection, sync state, and local settings behavior are represented accurately.
- AI recommendations show evidence, confidence, risk, guardrails, and approval/execution state where applicable.
- Automation language distinguishes suggested actions from approved or executed actions.

## Dashboard Usability

- Primary metrics are visible without excessive scrolling on desktop.
- Campaign, creative, audience, funnel, and report areas have distinct purposes.
- Tables, charts, cards, and filters support fast comparison.
- Empty, loading, error, and disconnected states explain the next action.

## Clinic Ads Context

- Ads metrics are connected to clinic outcomes where data exists.
- Spend, ROAS, CPA, leads, bookings, show-up, close rate, and revenue are labeled clearly.
- Risk states help operators decide what needs attention today.
- Reports and audit history support before/after review.

## Visual Design

- Layout is dense but not crowded.
- Status colors, badges, icons, and action buttons are consistent.
- Text fits containers on desktop and mobile.
- No overlapping UI elements at common breakpoints.
- Component styling matches the existing app direction unless a redesign decision says otherwise.

## Engineering Handoff

- Changes are scoped and documented.
- New copy uses verified terminology.
- Data assumptions are noted near the affected view or in handoff notes.
- The implementation can be tested with current local data and API settings states.
