# Insights Decision River Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved `Decision River` visualization into the existing `/ads-agent` `Insights` workspace so users can see how Spend, CPM, CTR, CVR, and Frequency/Fatigue drivers flow into CPA and ROAS outcomes with evidence, confidence, caveats, and approval-gated recommendations.

**Architecture:** Add a focused decision-river model builder beside the existing Insights metric helpers, then render the visualization inside the existing `InsightsPage` without replacing the Ads Agent shell. Keep deterministic metric calculation in `src/insightsWorkspace.ts`; the new model only maps already-derived metrics into visual states. Keep UI changes scoped to the current Insights surface and CSS namespace.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest, existing SSR `renderToStaticMarkup` tests, SVG/HTML/CSS for the visualization, no new runtime dependencies.

---

## File Structure

- Create: `src/insightsDecisionRiver.ts`
  - Owns the data-to-visual model: driver lanes, outcomes, pressure direction, severity, evidence counts, caveats, and selected default driver.
  - Does not call APIs, write storage, or duplicate metric formulas.
- Modify: `src/App.tsx`
  - Imports the model builder.
  - Adds `InsightsDecisionRiver` UI functions near the existing Insights components.
  - Inserts the river after `InsightsBriefPanel` and before the old detailed chart/formula/evidence sections.
- Modify: `src/App.css`
  - Adds `insights-river-*` classes and mobile stepper/bottom-sheet styles.
  - Keeps existing `insights-*` classes intact.
- Create: `tests/insightsDecisionRiver.test.ts`
  - Unit tests for pressure classification, default selection, unavailable states, evidence counts, and caveats.
- Modify: `tests/homeApp.test.tsx`
  - SSR tests that the rebuilt Insights page renders the Decision River, visible caveats, driver/outcome/evidence labels, mobile tab controls, and approval-gated action copy.

---

### Task 1: Add Decision River Model

**Files:**
- Create: `src/insightsDecisionRiver.ts`
- Create: `tests/insightsDecisionRiver.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `tests/insightsDecisionRiver.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { buildFallbackInsightsCache, buildInsightsAnalysisPayload, deriveInsightsMetrics } from '../src/insightsWorkspace'
import { buildInsightsDecisionRiverModel, pressureToneForDriver } from '../src/insightsDecisionRiver'
import type { WorkspaceData } from '../src/types'

describe('insightsDecisionRiver model', () => {
  it('maps derived metrics into driver lanes, outcomes, and evidence counts', () => {
    const workspace = workspaceFixture()
    const metrics = deriveInsightsMetrics(workspace)
    const insight = buildFallbackInsightsCache(buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'เดือนนี้', workspace }))

    const model = buildInsightsDecisionRiverModel({ insight, metrics })

    expect(model.drivers.map((driver) => driver.id)).toEqual(['spend', 'cpm', 'ctr', 'conversion_rate', 'frequency'])
    expect(model.outcomes.map((outcome) => outcome.id)).toEqual(['cpa', 'roas'])
    expect(model.defaultDriverId).toBe('cpm')
    expect(model.evidenceCounts.total).toBeGreaterThan(0)
    expect(model.caveats.some((caveat) => caveat.includes('Meta'))).toBe(true)
    expect(model.signalCounts.supporting + model.signalCounts.neutral + model.signalCounts.contradicting).toBeGreaterThan(0)
  })

  it('classifies pressure direction according to metric meaning', () => {
    expect(pressureToneForDriver('cpm', 0.18)).toEqual({ label: 'Pressure', tone: 'watch', direction: 'up' })
    expect(pressureToneForDriver('cpm', -0.18)).toEqual({ label: 'Relief', tone: 'good', direction: 'down' })
    expect(pressureToneForDriver('ctr', 0.18)).toEqual({ label: 'Relief', tone: 'good', direction: 'up' })
    expect(pressureToneForDriver('ctr', -0.18)).toEqual({ label: 'Pressure', tone: 'critical', direction: 'down' })
    expect(pressureToneForDriver('spend', null)).toEqual({ label: 'Neutral', tone: 'neutral', direction: 'flat' })
  })

  it('marks lanes unavailable when the source metric is unavailable', () => {
    const workspace = workspaceFixture({
      trendData: [{ bookings: 0, clicks: 0, cpa: 0, date: '2026-05-01', impressions: 0, leads: 0, reach: 0, revenue: 0, showUps: 0, spend: 1000, treatments: 0 }],
    })
    workspace.adInsights = workspace.adInsights.map((ad) => ({ ...ad, bookings: 0, clicks: 0, impressions: 0, leads: 0 }))

    const metrics = deriveInsightsMetrics(workspace)
    const insight = buildFallbackInsightsCache(buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'วันนี้', workspace }))
    const model = buildInsightsDecisionRiverModel({ insight, metrics })

    const ctr = model.drivers.find((driver) => driver.id === 'ctr')
    const cpa = model.outcomes.find((outcome) => outcome.id === 'cpa')

    expect(ctr).toEqual(expect.objectContaining({ statusLabel: 'รอข้อมูล', tone: 'neutral' }))
    expect(cpa).toEqual(expect.objectContaining({ statusLabel: 'รอข้อมูล', tone: 'neutral' }))
  })
})

function workspaceFixture(overrides: { trendData?: WorkspaceData['trendData'] } = {}): WorkspaceData {
  return {
    actions: [],
    adInsights: [
      { adSetId: 'set-1', bookings: 10, campaignId: 'cmp-1', clicks: 100, cpc: 10, creative: 'Image', ctr: 5, id: 'ad-1', impressions: 2000, leads: 12, name: 'Botox A', roas: 2.2, score: 82, showRate: 50, spend: 1000, status: 'active' },
      { adSetId: 'set-2', bookings: 2, campaignId: 'cmp-2', clicks: 40, cpc: 25, creative: 'Video', ctr: 1, id: 'ad-2', impressions: 4000, leads: 3, name: 'Filler A', roas: 0.4, score: 42, showRate: 40, spend: 1000, status: 'active' },
    ],
    adSets: [
      { audience: 'Bangkok', bookings: 10, budget: 1500, campaignId: 'cmp-1', cpa: 100, deliveryStatus: 'active', id: 'set-1', name: 'Bangkok Core', roas: 2.2, spend: 1000, status: 'healthy' },
      { audience: 'Retarget', bookings: 2, budget: 1500, campaignId: 'cmp-2', cpa: 500, deliveryStatus: 'active', id: 'set-2', name: 'Retarget Filler', roas: 0.4, spend: 1000, status: 'watch' },
    ],
    appointmentStages: [],
    auditTrail: [],
    autoAds: [],
    autoMode: 'suggest',
    campaigns: [
      { aiStatus: 'healthy', aiSummary: 'ROAS ดี', budget: 5000, conversions: 15, cpa: 333, ctr: 3.2, deliveryStatus: 'active', frequency: 2.2, id: 'cmp-1', name: 'Lead Botox', objective: 'Leads', revenue: 4000, roas: 2, spend: 2000 },
      { aiStatus: 'watch', aiSummary: 'ต้องจับตา', budget: 3000, conversions: 4, cpa: 500, ctr: 1.2, deliveryStatus: 'active', frequency: 4.8, id: 'cmp-2', name: 'Filler Review', objective: 'Leads', revenue: 500, roas: 0.5, spend: 2000 },
    ],
    channelPerformance: [],
    complianceReviews: [],
    funnelMetrics: [],
    insightComponents: [],
    insights: [],
    memoryItems: [],
    serviceLines: [],
    tasks: [],
    trendData: overrides.trendData ?? [
      { bookings: 5, clicks: 40, cpa: 200, date: '2026-05-01', impressions: 2000, leads: 6, reach: 1400, revenue: 2000, showUps: 3, spend: 1000, treatments: 1 },
      { bookings: 12, clicks: 100, cpa: 167, date: '2026-05-02', impressions: 3000, leads: 13, reach: 1800, revenue: 2500, showUps: 7, spend: 2000, treatments: 2 },
      { bookings: 16, clicks: 120, cpa: 156, date: '2026-05-03', impressions: 3600, leads: 18, reach: 2200, revenue: 3000, showUps: 9, spend: 2500, treatments: 3 },
      { bookings: 20, clicks: 150, cpa: 150, date: '2026-05-04', impressions: 4200, leads: 22, reach: 2600, revenue: 4800, showUps: 12, spend: 3000, treatments: 4 },
    ],
    updatedAt: '2026-05-29T08:00:00.000Z',
  }
}

```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
npm run test -- tests/insightsDecisionRiver.test.ts
```

Expected: FAIL because `src/insightsDecisionRiver.ts` does not exist.

- [ ] **Step 3: Create the model helper**

Create `src/insightsDecisionRiver.ts` with:

```ts
import {
  formatInsightMetricValue,
  type InsightsCachedInsight,
  type InsightsDerivedMetric,
  type InsightsEvidenceCard,
  type InsightsMetricKey,
  type InsightsMetrics,
} from './insightsWorkspace'

export type InsightsRiverDriverKey = 'spend' | 'cpm' | 'ctr' | 'conversion_rate' | 'frequency'
export type InsightsRiverOutcomeKey = 'cpa' | 'roas'
export type InsightsRiverTone = 'good' | 'watch' | 'critical' | 'neutral'
export type InsightsRiverDirection = 'up' | 'down' | 'flat'

export type InsightsRiverPressure = {
  direction: InsightsRiverDirection
  label: 'Pressure' | 'Relief' | 'Neutral'
  tone: InsightsRiverTone
}

export type InsightsRiverLane = {
  changeLabel: string
  description: string
  evidenceIds: string[]
  formattedValue: string
  id: InsightsRiverDriverKey
  label: string
  metricKey: InsightsMetricKey
  sparkline: number[]
  statusLabel: string
  tone: InsightsRiverTone
  trendDirection: InsightsRiverDirection
  value: number | null
}

export type InsightsRiverOutcome = {
  formattedValue: string
  id: InsightsRiverOutcomeKey
  label: string
  metricKey: InsightsMetricKey
  sparkline: number[]
  statusLabel: string
  tone: InsightsRiverTone
  value: number | null
}

export type InsightsRiverEvidenceCounts = {
  ad: number
  adset: number
  campaign: number
  account: number
  total: number
}

export type InsightsRiverSignalCounts = {
  contradicting: number
  neutral: number
  supporting: number
}

export type InsightsDecisionRiverModel = {
  caveats: string[]
  defaultDriverId: InsightsRiverDriverKey
  drivers: InsightsRiverLane[]
  evidenceCounts: InsightsRiverEvidenceCounts
  outcomes: InsightsRiverOutcome[]
  signalCounts: InsightsRiverSignalCounts
}

type BuildModelInput = {
  insight: InsightsCachedInsight
  metrics: InsightsMetrics
}

const DRIVER_META: Array<{ id: InsightsRiverDriverKey; label: string; metricKey: InsightsMetricKey; description: string }> = [
  { description: 'Total amount spent', id: 'spend', label: 'Spend', metricKey: 'spend' },
  { description: 'Cost per 1,000 impressions', id: 'cpm', label: 'CPM', metricKey: 'cpm' },
  { description: 'Click-through rate', id: 'ctr', label: 'CTR', metricKey: 'ctr' },
  { description: 'Conversion rate', id: 'conversion_rate', label: 'CVR', metricKey: 'conversion_rate' },
  { description: 'Avg. frequency and fatigue risk', id: 'frequency', label: 'Frequency / Fatigue', metricKey: 'frequency' },
]

const OUTCOME_META: Array<{ id: InsightsRiverOutcomeKey; label: string; metricKey: InsightsMetricKey }> = [
  { id: 'cpa', label: 'CPA/CPL', metricKey: 'cpa' },
  { id: 'roas', label: 'ROAS', metricKey: 'roas' },
]

export function buildInsightsDecisionRiverModel({ insight, metrics }: BuildModelInput): InsightsDecisionRiverModel {
  const drivers = DRIVER_META.map((driver) => buildDriverLane(driver, metrics, insight.evidenceCards))
  const outcomes = OUTCOME_META.map((outcome) => buildOutcome(outcome, metrics))
  const defaultDriverId = pickDefaultDriver(drivers)

  return {
    caveats: buildCaveats(insight, metrics),
    defaultDriverId,
    drivers,
    evidenceCounts: countEvidence(insight.evidenceCards),
    outcomes,
    signalCounts: countSignals(insight, metrics),
  }
}

export function pressureToneForDriver(metricKey: InsightsRiverDriverKey, changeRate: number | null): InsightsRiverPressure {
  if (changeRate === null || Math.abs(changeRate) < 0.03) return { direction: 'flat', label: 'Neutral', tone: 'neutral' }

  const improvementWhenUp = metricKey === 'ctr' || metricKey === 'conversion_rate'
  const pressureWhenUp = !improvementWhenUp
  const direction: InsightsRiverDirection = changeRate > 0 ? 'up' : 'down'
  const isPressure = changeRate > 0 ? pressureWhenUp : !pressureWhenUp
  const intense = Math.abs(changeRate) >= 0.15

  if (isPressure) return { direction, label: 'Pressure', tone: intense ? 'critical' : 'watch' }
  return { direction, label: 'Relief', tone: 'good' }
}

function buildDriverLane(
  driver: { id: InsightsRiverDriverKey; label: string; metricKey: InsightsMetricKey; description: string },
  metrics: InsightsMetrics,
  evidenceCards: InsightsEvidenceCard[],
): InsightsRiverLane {
  const metric = findMetric(metrics.scoreboard, driver.metricKey)
  if (metric.availability === 'unavailable') {
    return {
      changeLabel: 'รอข้อมูล',
      description: driver.description,
      evidenceIds: evidenceCards.slice(0, 3).map((card) => card.id),
      formattedValue: formatInsightMetricValue(metric),
      id: driver.id,
      label: driver.label,
      metricKey: driver.metricKey,
      sparkline: sparklineForMetric(metrics, driver.metricKey),
      statusLabel: 'รอข้อมูล',
      tone: 'neutral',
      trendDirection: 'flat',
      value: metric.value,
    }
  }

  const pressure = pressureToneForDriver(driver.id, metric.changeRate)
  return {
    changeLabel: formatChange(metric.changeRate),
    description: driver.description,
    evidenceIds: evidenceCards.slice(0, 3).map((card) => card.id),
    formattedValue: formatInsightMetricValue(metric),
    id: driver.id,
    label: driver.label,
    metricKey: driver.metricKey,
    sparkline: sparklineForMetric(metrics, driver.metricKey),
    statusLabel: pressure.label,
    tone: pressure.tone,
    trendDirection: pressure.direction,
    value: metric.value,
  }
}

function buildOutcome(
  outcome: { id: InsightsRiverOutcomeKey; label: string; metricKey: InsightsMetricKey },
  metrics: InsightsMetrics,
): InsightsRiverOutcome {
  const metric = findMetric(metrics.scoreboard, outcome.metricKey)
  if (metric.availability === 'unavailable') {
    return {
      formattedValue: formatInsightMetricValue(metric),
      id: outcome.id,
      label: outcome.label,
      metricKey: outcome.metricKey,
      sparkline: sparklineForMetric(metrics, outcome.metricKey),
      statusLabel: 'รอข้อมูล',
      tone: 'neutral',
      value: metric.value,
    }
  }

  const improving = outcome.id === 'roas' ? (metric.changeRate ?? 0) >= 0 : (metric.changeRate ?? 0) <= 0
  const tone: InsightsRiverTone = Math.abs(metric.changeRate ?? 0) < 0.03 ? 'neutral' : improving ? 'good' : 'critical'
  return {
    formattedValue: formatInsightMetricValue(metric),
    id: outcome.id,
    label: outcome.label,
    metricKey: outcome.metricKey,
    sparkline: sparklineForMetric(metrics, outcome.metricKey),
    statusLabel: tone === 'good' ? 'Relief' : tone === 'critical' ? 'Pressure' : 'Neutral',
    tone,
    value: metric.value,
  }
}

function pickDefaultDriver(drivers: InsightsRiverLane[]): InsightsRiverDriverKey {
  const priority: InsightsRiverDriverKey[] = ['cpm', 'conversion_rate', 'frequency', 'ctr', 'spend']
  return priority.find((driverId) => {
    const driver = drivers.find((item) => item.id === driverId)
    return driver?.tone === 'critical' || driver?.tone === 'watch'
  }) ?? drivers.find((driver) => driver.tone === 'good')?.id ?? 'cpm'
}

function findMetric(metrics: InsightsDerivedMetric[], key: InsightsMetricKey): InsightsDerivedMetric {
  const metric = metrics.find((item) => item.key === key)
  if (!metric) throw new Error(`Missing Insights metric: ${key}`)
  return metric
}

function sparklineForMetric(metrics: InsightsMetrics, key: InsightsMetricKey): number[] {
  return metrics.trends
    .map((point) => {
      if (key === 'conversion_rate') return null
      return point[key as keyof typeof point]
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .slice(-8)
}

function formatChange(changeRate: number | null): string {
  if (changeRate === null) return 'รอข้อมูลเทียบ'
  const percent = Math.abs(changeRate * 100).toFixed(1)
  return `${changeRate >= 0 ? '+' : '-'}${percent}%`
}

function countEvidence(evidenceCards: InsightsEvidenceCard[]): InsightsRiverEvidenceCounts {
  const counts: InsightsRiverEvidenceCounts = { account: 0, ad: 0, adset: 0, campaign: 0, total: evidenceCards.length }
  for (const card of evidenceCards) counts[card.objectType] += 1
  return counts
}

function countSignals(insight: InsightsCachedInsight, metrics: InsightsMetrics): InsightsRiverSignalCounts {
  const diagnostics = insight.metricDiagnostics.length ? insight.metricDiagnostics : metrics.formulaDiagnostics
  return diagnostics.reduce<InsightsRiverSignalCounts>(
    (counts, diagnostic) => {
      if (diagnostic.tone === 'good') counts.supporting += 1
      else if (diagnostic.tone === 'critical' || diagnostic.tone === 'watch') counts.contradicting += 1
      else counts.neutral += 1
      return counts
    },
    { contradicting: 0, neutral: 0, supporting: 0 },
  )
}

function buildCaveats(insight: InsightsCachedInsight, metrics: InsightsMetrics): string[] {
  const caveats = [
    'Data from connected Meta workspace.',
    insight.payload.attribution.setting,
    ...insight.dataWarnings,
    ...metrics.dataWarnings,
  ].filter(Boolean)
  return Array.from(new Set(caveats)).slice(0, 4)
}
```

- [ ] **Step 4: Run model tests**

Run:

```bash
npm run test -- tests/insightsDecisionRiver.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit model helper**

Run:

```bash
git add src/insightsDecisionRiver.ts tests/insightsDecisionRiver.test.ts
git commit -m "feat: add insights decision river model"
```

---

### Task 2: Render Decision River In Insights Page

**Files:**
- Modify: `src/App.tsx`
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Write failing SSR test expectations**

In `tests/homeApp.test.tsx`, extend the existing `renders the rebuilt Insights page without old assistant-first UI` test with:

```ts
expect(text).toContain('Decision River')
expect(text).toContain('Drivers')
expect(text).toContain('Outcomes')
expect(text).toContain('Evidence')
expect(text).toContain('Source & caveats')
expect(text).toContain('Approval required before Meta changes')
expect(html).toContain('class="insights-decision-river"')
expect(html).toContain('class="insights-river-desktop"')
expect(html).toContain('class="insights-river-mobile"')
expect(html).toContain('role="tablist"')
expect(html).toContain('aria-label="Decision River mobile view"')
```

- [ ] **Step 2: Run SSR test and verify failure**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: FAIL because the Decision River markup does not exist.

- [ ] **Step 3: Import model helper and types**

Modify the import section in `src/App.tsx` by adding:

```ts
import {
  buildInsightsDecisionRiverModel,
  type InsightsDecisionRiverModel,
  type InsightsRiverDriverKey,
  type InsightsRiverLane,
  type InsightsRiverOutcome,
} from './insightsDecisionRiver'
```

- [ ] **Step 4: Add Decision River model and selected state in `InsightsPage`**

Inside `InsightsPage`, after `const visibleInsight = cachedInsight ?? fallbackInsight`, add:

```ts
  const decisionRiverModel = useMemo<InsightsDecisionRiverModel | null>(
    () => (metrics && visibleInsight ? buildInsightsDecisionRiverModel({ insight: visibleInsight, metrics }) : null),
    [metrics, visibleInsight],
  )
  const defaultRiverDriverId = decisionRiverModel?.defaultDriverId
  const [selectedRiverDriver, setSelectedRiverDriver] = useState<InsightsRiverDriverKey>('cpm')
  const [isRiverEvidenceOpen, setIsRiverEvidenceOpen] = useState(false)

  useEffect(() => {
    if (defaultRiverDriverId) setSelectedRiverDriver(defaultRiverDriverId)
  }, [defaultRiverDriverId])
```

- [ ] **Step 5: Insert Decision River after the action message**

In the `InsightsPage` return block, immediately after:

```tsx
        {actionMessage ? <p className="insights-action-message">{actionMessage}</p> : null}
```

Add:

```tsx
        {decisionRiverModel ? (
          <InsightsDecisionRiver
            evidenceCards={visibleInsight.evidenceCards.length ? visibleInsight.evidenceCards : metrics.evidenceCards}
            isEvidenceOpen={isRiverEvidenceOpen}
            model={decisionRiverModel}
            onCloseEvidence={() => setIsRiverEvidenceOpen(false)}
            onOpenEvidence={() => setIsRiverEvidenceOpen(true)}
            onSelectDriver={setSelectedRiverDriver}
            selectedDriverId={selectedRiverDriver}
            topRecommendation={(visibleInsight.recommendations.length ? visibleInsight.recommendations : metrics.recommendations)[0]}
          />
        ) : null}
```

- [ ] **Step 6: Add the component functions near the other Insights components**

Insert these functions after `InsightsTrendCharts` and before `InsightsFormulaDiagnostics`:

```tsx
function InsightsDecisionRiver({
  evidenceCards,
  isEvidenceOpen,
  model,
  onCloseEvidence,
  onOpenEvidence,
  onSelectDriver,
  selectedDriverId,
  topRecommendation,
}: {
  evidenceCards: InsightsEvidenceCard[]
  isEvidenceOpen: boolean
  model: InsightsDecisionRiverModel
  onCloseEvidence: () => void
  onOpenEvidence: () => void
  onSelectDriver: (driverId: InsightsRiverDriverKey) => void
  selectedDriverId: InsightsRiverDriverKey
  topRecommendation?: InsightsRecommendation
}) {
  const selectedDriver = model.drivers.find((driver) => driver.id === selectedDriverId) ?? model.drivers[0]
  const selectedEvidenceCards = evidenceCards.filter((card) => selectedDriver.evidenceIds.includes(card.id)).slice(0, 3)

  return (
    <section className="insights-section insights-decision-river" aria-labelledby="insights-decision-river-title">
      <div className="insights-section-head">
        <div>
          <h2 id="insights-decision-river-title">Decision River</h2>
          <p>เห็นเส้นทางจาก driver metrics ไป CPA และ ROAS พร้อมหลักฐานก่อนตัดสินใจ</p>
        </div>
        <div className="insights-river-legend" aria-label="Decision River legend">
          <span><i className="pressure" /> Pressure</span>
          <span><i className="relief" /> Relief</span>
          <span><i className="neutral" /> Neutral</span>
        </div>
      </div>

      <div className="insights-river-desktop">
        <div className="insights-river-lanes" aria-label="Drivers">
          {model.drivers.map((driver) => (
            <InsightsRiverDriverButton
              driver={driver}
              isSelected={driver.id === selectedDriverId}
              key={driver.id}
              onOpenEvidence={onOpenEvidence}
              onSelectDriver={onSelectDriver}
            />
          ))}
        </div>
        <InsightsRiverFlow drivers={model.drivers} selectedDriverId={selectedDriverId} />
        <div className="insights-river-outcomes" aria-label="Outcomes">
          {model.outcomes.map((outcome) => (
            <InsightsRiverOutcomeCard key={outcome.id} outcome={outcome} />
          ))}
        </div>
        <InsightsRiverEvidencePanel
          caveats={model.caveats}
          evidenceCards={selectedEvidenceCards}
          evidenceCounts={model.evidenceCounts}
          signalCounts={model.signalCounts}
        />
      </div>

      <div className="insights-river-mobile" aria-label="Decision River mobile view">
        <div className="insights-river-mobile-tabs" role="tablist" aria-label="Decision River sections">
          <button className="active" type="button">Drivers</button>
          <button type="button">Outcomes</button>
          <button type="button" onClick={onOpenEvidence}>Evidence</button>
        </div>
        <div className="insights-river-mobile-stepper">
          {model.drivers.map((driver) => (
            <InsightsRiverDriverButton
              driver={driver}
              isSelected={driver.id === selectedDriverId}
              key={driver.id}
              onOpenEvidence={onOpenEvidence}
              onSelectDriver={onSelectDriver}
            />
          ))}
        </div>
        <div className="insights-river-mobile-outcomes">
          {model.outcomes.map((outcome) => (
            <InsightsRiverOutcomeCard key={outcome.id} outcome={outcome} />
          ))}
        </div>
      </div>

      <InsightsRiverRecommendationStrip recommendation={topRecommendation} />

      {isEvidenceOpen ? (
        <div className="insights-river-evidence-sheet" role="dialog" aria-modal="false" aria-label={`${selectedDriver.label} evidence preview`}>
          <div>
            <strong>{selectedDriver.label} Evidence Preview</strong>
            <button className="modal-close" type="button" onClick={onCloseEvidence} aria-label="ปิดหลักฐาน Decision River">
              <X size={16} />
            </button>
          </div>
          <InsightsRiverEvidenceList evidenceCards={selectedEvidenceCards} />
        </div>
      ) : null}
    </section>
  )
}

function InsightsRiverDriverButton({
  driver,
  isSelected,
  onOpenEvidence,
  onSelectDriver,
}: {
  driver: InsightsRiverLane
  isSelected: boolean
  onOpenEvidence: () => void
  onSelectDriver: (driverId: InsightsRiverDriverKey) => void
}) {
  return (
    <button
      className={`insights-river-driver ${driver.tone} ${isSelected ? 'selected' : ''}`}
      type="button"
      onClick={() => {
        onSelectDriver(driver.id)
        onOpenEvidence()
      }}
      aria-pressed={isSelected}
      aria-label={`${driver.label}: ${driver.statusLabel}, ${driver.formattedValue}, ${driver.changeLabel}`}
    >
      <span>
        <strong>{driver.label}</strong>
        <small>{driver.description}</small>
      </span>
      <InsightsMiniSparkline values={driver.sparkline} tone={driver.tone} />
      <em>{driver.statusLabel} · {driver.changeLabel}</em>
    </button>
  )
}

function InsightsRiverOutcomeCard({ outcome }: { outcome: InsightsRiverOutcome }) {
  return (
    <article className={`insights-river-outcome ${outcome.tone}`}>
      <span>{outcome.label}</span>
      <strong>{outcome.formattedValue}</strong>
      <InsightsMiniSparkline values={outcome.sparkline} tone={outcome.tone} />
      <small>{outcome.statusLabel}</small>
    </article>
  )
}

function InsightsRiverFlow({ drivers, selectedDriverId }: { drivers: InsightsRiverLane[]; selectedDriverId: InsightsRiverDriverKey }) {
  return (
    <svg className="insights-river-flow" viewBox="0 0 220 360" role="img" aria-label="Driver flow into CPA and ROAS outcomes">
      {drivers.map((driver, index) => {
        const y = 34 + index * 66
        const selected = driver.id === selectedDriverId
        return (
          <path
            d={`M 8 ${y} C 82 ${y}, 96 120, 128 164 S 168 228, 212 228`}
            key={driver.id}
            className={`${driver.tone} ${selected ? 'selected' : ''}`}
            fill="none"
            strokeWidth={selected ? 4 : 2}
          />
        )
      })}
    </svg>
  )
}

function InsightsRiverEvidencePanel({
  caveats,
  evidenceCards,
  evidenceCounts,
  signalCounts,
}: {
  caveats: string[]
  evidenceCards: InsightsEvidenceCard[]
  evidenceCounts: InsightsDecisionRiverModel['evidenceCounts']
  signalCounts: InsightsDecisionRiverModel['signalCounts']
}) {
  return (
    <aside className="insights-river-evidence-panel">
      <div className="insights-river-confidence-card">
        <strong>{signalCounts.supporting} supporting</strong>
        <span>{signalCounts.neutral} neutral · {signalCounts.contradicting} pressure</span>
      </div>
      <div className="insights-river-counts" aria-label="Evidence counts">
        <MetricLine label="Campaigns" value={String(evidenceCounts.campaign)} />
        <MetricLine label="Ad Sets" value={String(evidenceCounts.adset)} />
        <MetricLine label="Ads" value={String(evidenceCounts.ad)} />
      </div>
      <InsightsRiverEvidenceList evidenceCards={evidenceCards} />
      <div className="insights-river-caveats">
        <strong>Source & caveats</strong>
        {caveats.map((caveat) => (
          <span key={caveat}>{caveat}</span>
        ))}
      </div>
    </aside>
  )
}

function InsightsRiverEvidenceList({ evidenceCards }: { evidenceCards: InsightsEvidenceCard[] }) {
  return (
    <div className="insights-river-evidence-list">
      {evidenceCards.length ? evidenceCards.map((card) => (
        <article key={card.id}>
          <span>{objectTypeLabelForInsight(card.objectType)}</span>
          <strong>{card.objectName}</strong>
          <small>{card.formulaResult}</small>
        </article>
      )) : <p>ยังไม่มีหลักฐานเฉพาะ driver นี้ ใช้ภาพรวมบัญชีและสูตร diagnostic ก่อน</p>}
    </div>
  )
}

function InsightsRiverRecommendationStrip({ recommendation }: { recommendation?: InsightsRecommendation }) {
  if (!recommendation) {
    return (
      <div className="insights-river-recommendation">
        <strong>Approval required before Meta changes</strong>
        <span>ยังไม่มีคำแนะนำที่เปิดอนุมัติได้จากข้อมูลชุดนี้</span>
      </div>
    )
  }

  return (
    <div className="insights-river-recommendation">
      <strong>Approval required before Meta changes</strong>
      <span>{recommendation.title}</span>
      <em>{recommendation.requiresApproval ? 'ต้องอนุมัติก่อนส่ง Meta' : 'รีวิวเท่านั้น'}</em>
    </div>
  )
}

function InsightsMiniSparkline({ tone, values }: { tone: Tone; values: number[] }) {
  const points = sparklinePoints(values)
  return (
    <svg className={`insights-mini-sparkline ${tone}`} viewBox="0 0 80 26" aria-hidden="true">
      <polyline fill="none" points={points} strokeWidth="2" />
    </svg>
  )
}

function sparklinePoints(values: number[]): string {
  if (!values.length) return '0,18 80,18'
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  return values.map((value, index) => {
    const x = values.length === 1 ? 40 : (index / (values.length - 1)) * 80
    const y = 22 - ((value - min) / range) * 18
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}
```

- [ ] **Step 7: Run SSR test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit UI wiring**

Run:

```bash
git add src/App.tsx tests/homeApp.test.tsx
git commit -m "feat: render insights decision river"
```

---

### Task 3: Add Decision River Styling And Mobile Behavior

**Files:**
- Modify: `src/App.css`
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Add source checks for CSS contract**

In `tests/homeApp.test.tsx`, add a source-based test near the existing Insights tests:

```ts
it('defines responsive Decision River styles for desktop and mobile', () => {
  const css = readText('../src/App.css')

  expect(css).toContain('.insights-river-desktop')
  expect(css).toContain('.insights-river-mobile')
  expect(css).toContain('.insights-river-evidence-sheet')
  expect(css).toContain('@media (max-width: 900px)')
  expect(css).toContain('display: none')
  expect(css).toContain('position: sticky')
  expect(css).toContain('min-height: 44px')
})
```

- [ ] **Step 2: Run targeted SSR/source test and verify failure**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: FAIL because the CSS selectors are not present yet.

- [ ] **Step 3: Add CSS near existing Insights styles**

In `src/App.css`, after `.insights-data-warning.watch`, add:

```css
.insights-decision-river {
  border: 1px solid rgba(49, 92, 107, 0.18);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.8);
  padding: 14px;
}

.insights-river-legend,
.insights-river-mobile-tabs,
.insights-river-recommendation {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.insights-river-legend span,
.insights-river-recommendation em {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #5e5144;
  font-size: 12px;
  font-weight: 800;
}

.insights-river-legend i {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.insights-river-legend .pressure {
  background: #d7655d;
}

.insights-river-legend .relief {
  background: #1f9d8a;
}

.insights-river-legend .neutral {
  background: #8793a0;
}

.insights-river-desktop {
  display: grid;
  grid-template-columns: minmax(240px, 1.1fr) minmax(160px, 0.7fr) minmax(170px, 0.8fr) minmax(220px, 0.9fr);
  gap: 12px;
  margin-top: 14px;
}

.insights-river-lanes,
.insights-river-outcomes,
.insights-river-mobile-stepper,
.insights-river-mobile-outcomes,
.insights-river-evidence-list,
.insights-river-evidence-panel {
  display: grid;
  gap: 10px;
}

.insights-river-driver {
  min-height: 74px;
  border: 1px solid rgba(121, 92, 57, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  color: #2f271e;
  cursor: pointer;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 82px auto;
  gap: 10px;
  align-items: center;
  padding: 10px;
  text-align: left;
}

.insights-river-driver.selected {
  border-color: #168b7b;
  box-shadow: 0 0 0 3px rgba(31, 157, 138, 0.14);
}

.insights-river-driver strong,
.insights-river-outcome strong,
.insights-river-confidence-card strong,
.insights-river-recommendation strong {
  color: #2f271e;
  font-size: 14px;
}

.insights-river-driver small,
.insights-river-outcome small,
.insights-river-evidence-list small,
.insights-river-caveats span,
.insights-river-recommendation span {
  color: #6e6153;
  font-size: 12px;
  line-height: 1.45;
}

.insights-river-driver em {
  justify-self: end;
  border-radius: 999px;
  background: rgba(135, 147, 160, 0.14);
  color: #5e5144;
  font-size: 12px;
  font-style: normal;
  font-weight: 900;
  padding: 6px 8px;
}

.insights-river-driver.good em,
.insights-river-outcome.good small {
  background: rgba(31, 157, 138, 0.12);
  color: #167b6e;
}

.insights-river-driver.watch em,
.insights-river-outcome.watch small {
  background: rgba(185, 130, 71, 0.14);
  color: #875d2e;
}

.insights-river-driver.critical em,
.insights-river-outcome.critical small {
  background: rgba(185, 85, 73, 0.14);
  color: #8a3c35;
}

.insights-river-flow {
  width: 100%;
  min-height: 320px;
}

.insights-river-flow path {
  stroke: rgba(107, 117, 128, 0.48);
}

.insights-river-flow path.good {
  stroke: #1f9d8a;
}

.insights-river-flow path.watch {
  stroke: #b98247;
}

.insights-river-flow path.critical {
  stroke: #d7655d;
}

.insights-river-flow path.selected {
  filter: drop-shadow(0 4px 8px rgba(49, 92, 107, 0.18));
}

.insights-river-outcome,
.insights-river-confidence-card,
.insights-river-caveats,
.insights-river-evidence-list article,
.insights-river-recommendation {
  border: 1px solid rgba(121, 92, 57, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  padding: 12px;
}

.insights-river-outcome {
  display: grid;
  gap: 8px;
}

.insights-river-outcome > span,
.insights-river-evidence-list article > span {
  color: #7b6a58;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.insights-mini-sparkline polyline {
  stroke: #8793a0;
}

.insights-mini-sparkline.good polyline {
  stroke: #1f9d8a;
}

.insights-mini-sparkline.watch polyline {
  stroke: #b98247;
}

.insights-mini-sparkline.critical polyline {
  stroke: #d7655d;
}

.insights-river-counts {
  display: grid;
  gap: 6px;
}

.insights-river-caveats {
  display: grid;
  gap: 6px;
}

.insights-river-mobile {
  display: none;
}

.insights-river-mobile-tabs {
  position: sticky;
  top: 0;
  z-index: 2;
  border: 1px solid rgba(121, 92, 57, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  padding: 6px;
}

.insights-river-mobile-tabs button {
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #5e5144;
  flex: 1;
  font-size: 12px;
  font-weight: 900;
}

.insights-river-mobile-tabs button.active {
  background: #168b7b;
  color: #fff;
}

.insights-river-evidence-sheet {
  display: grid;
  gap: 12px;
  border: 1px solid rgba(49, 92, 107, 0.2);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 -16px 48px rgba(30, 52, 80, 0.16);
  margin-top: 12px;
  padding: 14px;
}

.insights-river-evidence-sheet > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
```

Inside the existing mobile media area near `@media (max-width: 900px)`, add:

```css
  .insights-river-desktop {
    display: none;
  }

  .insights-river-mobile {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }

  .insights-river-driver {
    grid-template-columns: minmax(0, 1fr);
    min-height: 86px;
  }

  .insights-river-driver em {
    justify-self: start;
  }

  .insights-river-mobile-outcomes {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 4: Run targeted test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit styling**

Run:

```bash
git add src/App.css tests/homeApp.test.tsx
git commit -m "style: add responsive insights decision river"
```

---

### Task 4: Verify Full Insights Behavior

**Files:**
- Modify only if failures reveal a scoped issue:
  - `src/insightsDecisionRiver.ts`
  - `src/App.tsx`
  - `src/App.css`
  - `tests/insightsDecisionRiver.test.ts`
  - `tests/homeApp.test.tsx`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm run test -- tests/insightsDecisionRiver.test.ts tests/insightsWorkspace.test.ts tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS for both client and server builds.

- [ ] **Step 4: Commit any verification fixes**

If files changed while fixing verification failures, run:

```bash
git add src/insightsDecisionRiver.ts src/App.tsx src/App.css tests/insightsDecisionRiver.test.ts tests/homeApp.test.tsx
git commit -m "fix: tighten insights decision river verification"
```

If no files changed, skip this commit.

---

### Task 5: Browser QA Against Approved Concept

**Files:**
- Modify only if QA reveals a scoped visual or behavior issue:
  - `src/App.tsx`
  - `src/App.css`

- [ ] **Step 1: Start local dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`.

- [ ] **Step 2: Open `/ads-agent` and select Insights**

Use the browser at:

```text
http://127.0.0.1:5173/ads-agent
```

Expected:

- Existing Ads Agent shell remains visible.
- `Insights` toolbar item can be selected.
- Top AI brief appears before Decision River.
- Decision River appears before detailed charts/formulas/evidence.
- Right rail or desktop evidence area includes confidence/risk, evidence counts, and `Source & caveats`.
- Recommendation strip says `Approval required before Meta changes`.

- [ ] **Step 3: Desktop screenshot QA**

Capture a desktop viewport around `1440x1000`.

Expected:

- No generic decorative background or raster chart labels.
- Driver lanes are readable.
- Selected driver has an explicit selected state.
- Flow lines connect drivers to outcomes.
- CPA/CPL and ROAS outcome cards are visible.
- Caveat/source text is visible without hover.

- [ ] **Step 4: Mobile portrait screenshot QA**

Capture a mobile viewport around `390x844`.

Expected:

- Compact AI brief appears first.
- Decision River mobile stepper appears immediately after the brief.
- At least the first two driver cards are visible before long detail sections.
- `Drivers`, `Outcomes`, and `Evidence` controls are visible.
- Tapping a driver opens the evidence preview sheet.
- No horizontal overflow.

- [ ] **Step 5: Commit QA fixes**

If QA requires styling or markup changes, run:

```bash
git add src/App.tsx src/App.css
git commit -m "fix: polish insights decision river qa"
```

If no files changed, skip this commit.

---

## Final Verification

Run the full final command set:

```bash
npm run test -- tests/insightsDecisionRiver.test.ts tests/insightsWorkspace.test.ts tests/homeApp.test.tsx
npm run lint
npm run build
git status --short
```

Expected:

- Focused tests PASS.
- Lint PASS.
- Build PASS.
- `git status --short` shows no unintended unstaged changes.

Before reporting completion, compare the rendered page against `docs/superpowers/specs/assets/2026-05-30-insights-decision-river-concept.png` and confirm these locked elements are preserved:

- AI brief before chart.
- Decision River central evidence path.
- Desktop evidence/caveat panel.
- Mobile stepper, not squeezed desktop.
- Approval-gated recommendation language.
- No hover-only essential values.
