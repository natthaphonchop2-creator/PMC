---
title: Figma Mockup v1 Spec
description: Created Figma mockup structure for the PMC Ads Agent dashboard redesign.
status: superseded
owner: Main Codex Agent
last_updated: 2026-05-18
figma_file: https://www.figma.com/design/e51pdNi0vcWlvyOalOrt0O
root_frame_id: "2:2"
notes_frame_id: "2:290"
---

# Figma Mockup v1 Spec

Superseded by `figma-mockup-v2-spec.md` after Cycle 1 review found missing metrics, states, safety details, and handoff structure.

Figma file: https://www.figma.com/design/e51pdNi0vcWlvyOalOrt0O

Root frame: `Desktop Mockup / PMC Ads Agent Dashboard / 1440x1000`

Notes frame: `Reviewer Notes / Acceptance Checklist`

## What Was Created

The mockup is a light, dense operations dashboard for `PMC Ads Agent`, based on the approved visual reference direction.

Main structure:

- 248px left sidebar named `Sidebar / Work Mode Navigation`.
- 72px top command bar named `Top Command Bar / Account Date Sync Mode`.
- Main analytics column with KPI cards, clinic funnel, performance chart, and campaign/ad set table.
- Right rail named `Right Rail / AI Marketer Queue`.
- Separate reviewer notes frame below the desktop mockup.

## Sidebar

Navigation groups:

- Main: Analytics, Ads Manager, AI Marketer, Optimization.
- Creative: Creative Studio, Audience Insights, Ad Library.
- System: Reports, Settings, Help Center.

Sidebar also includes a Meta connection summary with:

- `Meta synced`
- `Ad account: PMC Clinic`
- `Freshness: today 16:03 BKK`
- `Mode: Suggest only`

## Top Command Bar

Visible controls:

- Page title: `Analytics cockpit`
- Clinic selector: `Promed Clinic PMC`
- Date range: `Last 30 days`
- Sync state: `Live sync OK`
- Automation mode: `Suggest only`
- Export control: `Export report`

## KPI Cards

The first viewport includes eight KPI cards:

- Ad Spend: `฿428k`
- Revenue: `฿1.62M`
- ROAS: `3.8x`
- CPA / Booking: `฿1,390`
- Leads: `2,184`
- Bookings: `618`
- Show-up Rate: `71.5%`
- Close Rate: `44.3%`

## Clinic Funnel

The funnel frame is named `Funnel / Clinic Outcomes`.

Stages:

- Impressions: `1.24M`
- Clicks: `18,420`
- Leads: `2,184`
- Bookings: `618`
- Show-ups: `442`
- Paid: `196`

The funnel includes a watch note: `Drop-off Lead -> Booking 72%`.

## Performance Chart

The chart frame is named `Chart / Spend Revenue ROAS Trend`.

It shows:

- A line trend for revenue.
- Light bars for spend.
- Legend pills for `Revenue` and `Spend`.

## Campaign Table

The table frame is named `Table / Campaign and Ad Set Performance`.

Columns:

- Campaign / Ad Set
- Status
- Budget
- Spend
- CPA
- ROAS
- Freq.
- AI

Rows include active, watch, winner, fatigue, and pause risk examples. Each row includes `Meta API synced · today`.

## AI Marketer Queue

The right rail frame is named `Right Rail / AI Marketer Queue`.

Primary recommendation card:

- Title: `Pause Trial Offer - Messages`
- State: `Pending approval`
- Risk: `High risk`
- Evidence: `ROAS 0.8x · CPA ฿4,120 · Frequency 6.1 · 3-day spend spike`
- Guardrail: `pause only this ad set after approval; keep main campaign live`
- Before/after estimate and rollback note.
- Controls: `Approve pause`, `Reject`
- Confidence: `84%`

Additional recommendation cards:

- `Scale Rejuv Broad`
- `Refresh Acne Creative`
- `Review LINE response SLA`

Action state legend:

- Suggested
- Approved
- Executing
- Failed
- Audited

## Reviewer Notes

The notes frame lists these acceptance checks:

- First viewport includes ads KPIs plus clinic funnel outcomes.
- AI recommendation card shows evidence, confidence, risk, guardrail, approval, and rollback.
- Meta write action is visibly pending approval, not silently executed.
- Data freshness, account, date range, and automation mode are visible in top/sidebar.
- States required for implementation are listed: suggested, approved, executing, failed, audited.
- No unverified CRM/full automation/revenue guarantee claims are introduced.

## Local Visual Rules

- Radius: 8px panels, 7px controls.
- Border: `#E1E7F0`.
- Accent: `#7567D8` and `#2F86EB`.
- Status colors only for healthy, watch, critical.
- Font: IBM Plex Sans Thai for Thai/English fit.

## Current Limitation

The Figma file was created successfully, but screenshot capture and further Figma MCP edits are currently blocked by the Figma Starter plan tool-call limit. Reviewers should use this spec plus the Figma link for Cycle 1. If a blocker requires canvas changes, record the required update in the revision log so it can be applied when Figma MCP access is available again.
