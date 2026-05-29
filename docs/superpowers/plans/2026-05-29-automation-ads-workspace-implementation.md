# Automation Ads Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the paused Automation Ads placeholder with a real Hybrid Safe Automation workspace: run monitor, scheduled approval queue, configurable preset rules, conflict handling, and auditable run history. Phase 1 must not send any Meta write without explicit human approval.

**Architecture:** Put rule evaluation, queue generation, validation, schedule labels, and run records in `src/automationAdsWorkspace.ts`. Keep UI state in `AutomationAdsPage` inside `src/App.tsx`. The page reads current campaigns, ad sets, ads, and insight components from the existing Ads Agent workspace, generates queue items locally, and keeps approvals gated in the page.

**Tech Stack:** React, TypeScript, Vite, Vitest, React SSR tests, existing Ads Agent shell, existing `StatusBadge`, `MetricLine`, `StatePanel`, and existing PMC visual system.

---

## File Structure

- Create `src/automationAdsWorkspace.ts`: rule model, preset defaults, validation, deterministic rule engine, queue item builder, conflict detection, duplicate guard, schedule labels, and run record helpers.
- Create `tests/automationAdsWorkspace.test.ts`: pure unit tests for rules, invalid conditions, queue generation, AI-unavailable fallback, conflicts, duplicate queue suppression, schedule labels, and run records.
- Modify `src/App.tsx`: pass workspace data into `AutomationAdsPage`, replace the paused placeholder with Run Monitor + Tabs, add approval/reject/edit-local queue controls, add Rule Builder, and add Run History.
- Modify `src/App.css`: add responsive Automation Ads workspace styles and remove reliance on the paused placeholder styles.
- Modify `tests/homeApp.test.tsx`: update old placeholder expectations to the real workspace and add SSR/source tests for approval-gated behavior.
- Modify `docs/PROJECT_UPDATES.md`: log the plan and implementation.
- Modify `/Users/natthaphon/Documents/LB Ax/Ax/Projects/PMC Ads Agent/Current Work.md`: mirror work state in Obsidian.

---

## Task 1: Rule Engine

**Files:**
- Create: `src/automationAdsWorkspace.ts`
- Test: `tests/automationAdsWorkspace.test.ts`

- [ ] Write failing tests for:
  - default rules include `pause_loser`, `reduce_budget`, `increase_winner`, `flag_fatigue`, and `create_review_task`;
  - invalid thresholds block saving;
  - manual run creates a run record even with no queue items;
  - low-confidence or AI-unavailable write actions become review/blocked, not direct writes;
  - conflicting actions on the same target move to conflict review;
  - duplicate active queue items are skipped;
  - schedule presets produce readable Thai labels.
- [ ] Implement exported contracts:
  - `AutomationRule`
  - `AutomationQueueItem`
  - `AutomationRunRecord`
  - `createDefaultAutomationRules`
  - `validateAutomationRule`
  - `evaluateAutomationRules`
  - `buildAutomationQueueItem`
  - `createAutomationRunRecord`
  - `schedulePresetLabel`
  - `nextRunLabel`
  - queue/status/risk label helpers.
- [ ] Keep the rule engine deterministic and testable without rendering React.
- [ ] Run: `npm run test -- tests/automationAdsWorkspace.test.ts`.

## Task 2: Automation Ads Page

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `tests/homeApp.test.tsx`

- [ ] Pass `workspace`, `campaigns`, `adSets`, and `ads` into `AutomationAdsPage` from the `creative` tab route.
- [ ] Replace the paused placeholder with:
  - Run Monitor header;
  - schedule preset selector;
  - `ตรวจ Automation ตอนนี้` manual run button;
  - `Approval Queue`, `Rule Builder`, and `Run History` tabs.
- [ ] Queue items must show target, proposed action, current/proposed value, rule source, rationale, evidence metrics, confidence, risk, conflict state, and approval controls.
- [ ] Rule Builder must expose preset cards plus constrained advanced fields only, with validation before save.
- [ ] Run History must show run ID, trigger type, data freshness, AI availability, rules used, generated/skipped/conflict counts, and approval outcomes.
- [ ] Keep Meta writes approval-gated; phase 1 UI must not call Meta directly while generating queue items.
- [ ] Add responsive CSS for desktop and mobile with stable tab and card dimensions.
- [ ] Update SSR tests so the new workspace replaces old paused copy.

## Task 3: Verification And Handoff

- [ ] Run focused tests: `npm run test -- tests/automationAdsWorkspace.test.ts tests/homeApp.test.tsx`.
- [ ] Run full tests: `npm run test`.
- [ ] Run lint: `npm run lint`.
- [ ] Run build: `npm run build`.
- [ ] Open `/ads-agent` in the in-app browser and verify Automation Ads desktop/mobile.
- [ ] Update `docs/PROJECT_UPDATES.md` and Obsidian `Current Work.md` with completion notes.
- [ ] Commit implementation with a focused message.

## Acceptance Criteria

- Automation Ads no longer renders the paused placeholder as the primary page.
- Manual run creates an auditable run record and queue output.
- Rules are configurable through constrained fields, not free-form logic.
- Queue items require approval before any Meta write path.
- Conflicts, duplicates, stale/low-confidence data, and AI-unavailable states are visible and safe.
- Desktop and mobile layouts remain usable inside the existing Ads Agent shell.
