---
title: Dashboard Brief
description: Concise brief for the PMC Ads Agent clinic ads dashboard redesign.
status: draft
owner: Knowledge Base Agent
last_updated: 2026-05-18
---

# Dashboard Brief

## Verified Context

The repo is named `PMC Ads agent`. The current README describes a `ClinicStellar AI Ads Dashboard`, built with React, Vite, and TypeScript for an internal clinic ads command dashboard. The app includes Meta Marketing API read sync and maps account, campaign, ad set, ad, and insight data into a shared workspace model.

The app UI references an AI media-buying cockpit for ads, creative, optimization, and reports. Current sections include Analytics, Help Center, Ads Manager, Creative Insights, AI Marketer, Optimization, Creative Studio, Audience Insights, Ad Library, Settings, and Reports.

## Product Purpose

Help a clinic ads team monitor campaign performance, understand funnel quality, manage creative and audience signals, review AI recommendations, and keep automation behind clear guardrails.

## Primary Users

- Clinic marketing operator reviewing ads performance.
- Media buyer managing campaigns, ad sets, ads, budgets, and delivery.
- Clinic manager reviewing revenue, bookings, show-up, close rate, and reports.
- Internal AI/operator team validating recommendations before execution.

These roles are inferred from the app structure and should be validated with stakeholders.

## Redesign Goals

- Make the dashboard easier to scan during daily ads operations.
- Clarify the relationship between ads spend, leads, bookings, treatment revenue, and risk.
- Keep AI recommendations transparent with evidence, confidence, guardrails, and approval state.
- Separate monitoring, action, creative review, settings, and reporting tasks clearly.
- Preserve trust by distinguishing synced data, local configuration, assumptions, and unavailable API behavior.

## Content Principles

- Use concise operational labels.
- Avoid claiming full automation unless the flow clearly shows approval and rollback behavior.
- Show dates, source, status, and freshness for data-heavy areas.
- Keep clinic business outcomes visible beside ad platform metrics.
