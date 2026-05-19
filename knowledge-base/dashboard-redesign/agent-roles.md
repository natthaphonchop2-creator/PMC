---
title: Agent Roles
description: Working responsibilities for agents involved in the PMC Ads Agent dashboard redesign.
status: draft
owner: Knowledge Base Agent
last_updated: 2026-05-18
---

# Agent Roles

## Knowledge Base Agent

Maintains concise documentation for the redesign process. Captures verified app context, naming, constraints, decisions, and review criteria. Avoids adding speculative product claims.

Review duty: confirms every handoff has an inbox, outbox, reviewer, decision, and unresolved-feedback log.

## Product Context Agent

Maps the current dashboard structure and user workflows. Focus areas include campaign performance, clinic funnel metrics, AI recommendations, approvals, reports, and operational settings.

Review duty: checks that the mockup/spec matches verified app scope and does not imply unsupported workflows.

## UX/UI Agent

Translates product goals into dense, scan-friendly dashboard layouts. Prioritizes clear navigation, hierarchy, table/card readability, responsive behavior, and low-friction workflows for repeated daily use.

Review duty: checks information architecture, visual hierarchy, responsive behavior, and task ergonomics.

## Data & Metrics Agent

Defines how metrics should be displayed and interpreted. Keeps ads metrics connected to clinic outcomes where verified, including spend, ROAS, CPA, leads, bookings, show-up, close rate, and revenue.

Review duty: checks metric labels, formulas, freshness, source clarity, and risk/status interpretation.

## Engineering Agent

Implements scoped frontend changes using the existing React/TypeScript structure. Preserves current data contracts unless an explicit migration is planned and reviewed.

Review duty: checks feasibility, component boundaries, data contracts, loading/error states, and implementation risk.

## QA & Review Agent

Checks behavior, layout, accessibility, and content consistency before handoff. Confirms the redesign does not misrepresent API readiness, automation behavior, or approval state.

Review duty: checks final acceptance, regression risk, accessibility, and unresolved blocker handling.
