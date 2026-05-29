# Insights AI Analysis Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old Insights page with an AI Brief First workspace that uses deterministic metric formulas, cached AI analysis, structured AI refresh payloads, charts, evidence, confidence, and approval-gated recommendations.

**Architecture:** Put formula, payload, cache, and approval gating logic in `src/insightsWorkspace.ts` so tests can verify business rules without rendering the whole app. Replace the current `AiMarketerPage` route with `InsightsPage` inside `src/App.tsx`, keeping the existing Ads Agent shell and existing approval modal bridge. The page calls the real `/api/ai/brain` endpoint with a structured `insightsPayload`, falls back to cached insight on API failure, and never sends Meta mutation requests directly from Insights.

**Tech Stack:** React, TypeScript, Vite, Vitest, React SSR tests, Recharts, existing `apiJson`, existing `PlanExecutionModal`, existing `/api/ai/brain` server endpoint.

---

## File Structure

- Create `src/insightsWorkspace.ts`: deterministic Insights formula engine, structured AI payload builder, cache helpers, AI response normalization, confidence scoring, and approval gating.
- Create `tests/insightsWorkspace.test.ts`: pure unit tests for formulas, zero denominators, shared chart/scoreboard metrics, confidence, structured payload, cache round trip, and recommendation approval rules.
- Modify `src/App.tsx`: import Insights helpers, replace `AiMarketerPage` route with `InsightsPage`, add AI Brief First components, remove old visible Insights structure, and wire refresh/approval callbacks.
- Modify `src/App.css`: add responsive styles for the new Insights workspace with stable chart/card dimensions.
- Modify `server/openAiPlugin.ts`: include optional `insightsPayload` inside the `/api/ai/brain` OpenAI payload so the model receives raw metrics, derived formulas, freshness, and attribution metadata.
- Modify `tests/homeApp.test.tsx`: add SSR/source tests for the new Insights route, old UI removal, AI refresh payload wiring, and no direct Meta writes.
- Modify `docs/PROJECT_UPDATES.md`: log the plan and implementation.
- Modify `/Users/natthaphon/Documents/LB Ax/Ax/Projects/PMC Ads Agent/Current Work.md`: mirror the work state in Obsidian.

---

### Task 1: Insights Metric Engine

**Files:**
- Create: `src/insightsWorkspace.ts`
- Test: `tests/insightsWorkspace.test.ts`

- [ ] **Step 1: Write the failing formula tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  buildInsightsAnalysisPayload,
  canOpenInsightsApprovalCommand,
  deriveInsightsMetrics,
  formatInsightMetricValue,
  type InsightsRecommendation,
} from '../src/insightsWorkspace'
import type { WorkspaceData } from '../src/types'

describe('insightsWorkspace metrics', () => {
  it('does not divide by zero and marks unavailable formulas explicitly', () => {
    const workspace = workspaceFixture({
      campaigns: [{ spend: 1200, conversions: 0, revenue: 0, ctr: 0, roas: 0, cpa: 0, frequency: 0 }],
      trendData: [{ date: '2026-05-01', spend: 1200, revenue: 0, bookings: 0, clicks: 0, impressions: 0 }],
    })

    const metrics = deriveInsightsMetrics(workspace)
    const cpa = metrics.scoreboard.find((item) => item.key === 'cpa')
    const ctr = metrics.scoreboard.find((item) => item.key === 'ctr')

    expect(cpa).toEqual(expect.objectContaining({ availability: 'unavailable', value: null }))
    expect(ctr).toEqual(expect.objectContaining({ availability: 'unavailable', value: null }))
    expect(formatInsightMetricValue(cpa!)).toBe('รอข้อมูล')
  })

  it('uses the same derived source for scoreboard and trend charts', () => {
    const workspace = workspaceFixture()
    const metrics = deriveInsightsMetrics(workspace)

    expect(metrics.scoreboard.find((item) => item.key === 'spend')?.value).toBe(metrics.rawTotals.spend)
    expect(metrics.trends[0]).toEqual(expect.objectContaining({ spend: 1000, results: 5, roas: 2 }))
  })

  it('builds a structured AI payload with raw metrics, formulas, freshness, and attribution', () => {
    const workspace = workspaceFixture()
    const payload = buildInsightsAnalysisPayload({
      accountName: 'PMC Aesthetic Clinic',
      datePreset: 'เดือนนี้',
      workspace,
    })

    expect(payload.account.name).toBe('PMC Aesthetic Clinic')
    expect(payload.rawMetrics.campaigns).toHaveLength(2)
    expect(payload.derivedMetrics.scoreboard.some((item) => item.key === 'roas')).toBe(true)
    expect(payload.derivedMetrics.formulaDiagnostics.some((item) => item.key === 'cpa_driver')).toBe(true)
    expect(payload.freshness.metaSyncedAt).toBe(workspace.updatedAt)
    expect(payload.attribution.setting).toContain('Meta reported')
  })

  it('blocks low confidence approval commands', () => {
    const blocked: InsightsRecommendation = {
      id: 'rec-low',
      title: 'พัก Ad Set ที่ข้อมูลยังน้อย',
      action: 'pause',
      confidence: { overall: 58, level: 'ต่ำ', reasons: ['ข้อมูลยังน้อย'] },
      evidenceIds: ['ev-1'],
      requiresApproval: true,
      riskNote: 'sample size ต่ำ',
      targetId: 'set-1',
      targetName: 'Low sample',
      targetType: 'adset',
    }

    expect(canOpenInsightsApprovalCommand(blocked)).toEqual({ allowed: false, reason: 'ความมั่นใจยังไม่พอสำหรับเปิดคำสั่งอนุมัติ' })
  })
})
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm run test -- tests/insightsWorkspace.test.ts`

Expected: fail because `src/insightsWorkspace.ts` does not exist.

- [ ] **Step 3: Implement the metric engine**

Create `src/insightsWorkspace.ts` with these exported contracts:

```ts
import type { RiskLevel, TrendPoint, WorkspaceData } from './types'

export type InsightsMetricKey = 'spend' | 'results' | 'cpa' | 'roas' | 'ctr' | 'cpc' | 'cpm' | 'frequency' | 'conversion_rate'
export type InsightsAvailability = 'ready' | 'unavailable'
export type InsightsConfidenceLevel = 'สูง' | 'กลาง' | 'ต่ำ'
export type InsightsTargetType = 'campaign' | 'adset' | 'ad' | 'account'

export type InsightsConfidence = {
  overall: number
  level: InsightsConfidenceLevel
  reasons: string[]
}

export type InsightsDerivedMetric = {
  key: InsightsMetricKey
  label: string
  value: number | null
  previousValue: number | null
  changeRate: number | null
  formula: string
  sourceFields: string[]
  availability: InsightsAvailability
}

export type InsightsTrendPoint = {
  date: string
  label: string
  spend: number
  results: number
  cpa: number | null
  roas: number | null
  ctr: number | null
  cpc: number | null
  frequency: number | null
}

export type InsightsFormulaDiagnostic = {
  id: string
  key: 'cpa_driver' | 'roas_driver' | 'fatigue_score' | 'waste_score' | 'momentum' | 'data_quality'
  title: string
  summary: string
  value: number | null
  availability: InsightsAvailability
  formula: string
  sourceMetricKeys: InsightsMetricKey[]
  confidence: InsightsConfidence
  tone: 'good' | 'watch' | 'critical' | 'neutral'
}

export type InsightsEvidenceCard = {
  id: string
  objectType: InsightsTargetType
  objectId: string
  objectName: string
  title: string
  metricValues: Array<{ label: string; value: string }>
  formulaResult: string
  dateWindow: string
  confidence: InsightsConfidence
}

export type InsightsRecommendation = {
  id: string
  title: string
  action: 'pause' | 'reduce_budget' | 'review_creative' | 'investigate_tracking' | 'open_workspace'
  confidence: InsightsConfidence
  evidenceIds: string[]
  requiresApproval: boolean
  riskNote: string
  targetId: string
  targetName: string
  targetType: InsightsTargetType
}
```

Implement `safeRatio`, `deriveInsightsMetrics`, `buildInsightsAnalysisPayload`, `formatInsightMetricValue`, and `canOpenInsightsApprovalCommand` using these rules:

```ts
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return numerator / denominator
}

export function canOpenInsightsApprovalCommand(recommendation: InsightsRecommendation): { allowed: boolean; reason: string } {
  if (!recommendation.requiresApproval) return { allowed: false, reason: 'รายการนี้เป็นคำแนะนำสำหรับรีวิวเท่านั้น' }
  if (recommendation.confidence.level !== 'สูง' || recommendation.confidence.overall < 75) {
    return { allowed: false, reason: 'ความมั่นใจยังไม่พอสำหรับเปิดคำสั่งอนุมัติ' }
  }
  if (!recommendation.evidenceIds.length) return { allowed: false, reason: 'ยังไม่มีหลักฐานพอสำหรับเปิดคำสั่งอนุมัติ' }
  if (recommendation.targetType === 'account') return { allowed: false, reason: 'คำแนะนำระดับบัญชีต้องรีวิวก่อน ไม่ส่งคำสั่งตรง' }
  return { allowed: true, reason: 'ต้องอนุมัติก่อนส่ง Meta' }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/insightsWorkspace.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/insightsWorkspace.ts tests/insightsWorkspace.test.ts
git commit -m "feat: add insights metric engine"
```

---

### Task 2: Cache And AI Response Normalization

**Files:**
- Modify: `src/insightsWorkspace.ts`
- Modify: `tests/insightsWorkspace.test.ts`

- [ ] **Step 1: Write failing cache and normalization tests**

```ts
import {
  buildFallbackInsightsCache,
  normalizeInsightsAiResponse,
  readInsightsCache,
  writeInsightsCache,
} from '../src/insightsWorkspace'

it('normalizes partial AI responses into a safe cached insight', () => {
  const workspace = workspaceFixture()
  const payload = buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'วันนี้', workspace })
  const cached = normalizeInsightsAiResponse({
    brief: { title: 'ROAS ดีขึ้น', summary: 'ควรรักษางบผู้ชนะไว้' },
    confidence: { overall: 82, level: 'สูง', reasons: ['ข้อมูลสด'] },
    recommendations: [{ title: 'รีวิว creative fatigue', targetType: 'adset', targetId: 'set-1' }],
  }, payload)

  expect(cached.brief.title).toBe('ROAS ดีขึ้น')
  expect(cached.recommendations[0]).toEqual(expect.objectContaining({
    requiresApproval: false,
    targetType: 'adset',
  }))
})

it('round-trips cache through localStorage without crashing SSR', () => {
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    removeItem: (key: string) => delete storage[key],
    setItem: (key: string, value: string) => {
      storage[key] = value
    },
  })

  const cached = buildFallbackInsightsCache(buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'วันนี้', workspace: workspaceFixture() }))
  writeInsightsCache(cached)
  expect(readInsightsCache()?.id).toBe(cached.id)
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/insightsWorkspace.test.ts`

Expected: fail because cache helpers are missing.

- [ ] **Step 3: Add cache and normalization helpers**

Add:

```ts
export const INSIGHTS_CACHE_KEY = 'pmc-ads-agent-insights-cache-v1'

export type InsightsCachedInsight = {
  id: string
  analyzedAt: string
  source: 'cached' | 'ai' | 'fallback'
  payload: InsightsAnalysisPayload
  brief: {
    title: string
    summary: string
    whatChanged: string[]
    whatToDoNext: string[]
    risks: string[]
  }
  confidence: InsightsConfidence
  metricDiagnostics: InsightsFormulaDiagnostic[]
  evidenceCards: InsightsEvidenceCard[]
  recommendations: InsightsRecommendation[]
  dataWarnings: string[]
}
```

Rules:
- `buildFallbackInsightsCache(payload)` produces an immediate readable brief from deterministic formulas.
- `normalizeInsightsAiResponse(raw, payload)` accepts partial AI output and fills missing arrays from fallback cache.
- `readInsightsCache()` returns `null` when `window` or `localStorage` is unavailable.
- `writeInsightsCache(cache)` catches storage errors and does not throw.

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/insightsWorkspace.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/insightsWorkspace.ts tests/insightsWorkspace.test.ts
git commit -m "feat: add insights cache normalization"
```

---

### Task 3: Replace Old Insights Route With New Page Shell

**Files:**
- Modify: `src/App.tsx`
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Write failing route and SSR tests**

Add tests:

```tsx
it('routes the Insights toolbar item to the rebuilt InsightsPage', () => {
  const source = readText('../src/App.tsx')
  const routeSource = source.slice(source.indexOf("{activeTab === 'marketer'"), source.indexOf("{activeTab === 'optimization'"))

  expect(routeSource).toContain('<InsightsPage')
  expect(routeSource).not.toContain('<AiMarketerPage')
})

it('renders the rebuilt Insights page without old assistant-first UI', () => {
  const html = renderToStaticMarkup(
    <InsightsPage
      datePreset="เดือนนี้"
      onBrainApprovalActions={() => undefined}
      onOpenPlanExecution={() => undefined}
      onQueueBrainAction={() => undefined}
      recommendationStates={{}}
      websiteContext={websiteContextFixture()}
      workspace={workspaceData()}
    />,
  )
  const text = visibleText(html)

  expect(text).toContain('สรุปล่าสุดจาก AI')
  expect(text).toContain('วิเคราะห์ใหม่ด้วย AI')
  expect(text).toContain('ความมั่นใจ')
  expect(text).toContain('วันนี้ควรรู้อะไร')
  expect(text).toContain('ตัวเลขสำคัญ')
  expect(text).toContain('กราฟแนวโน้ม')
  expect(text).toContain('วิเคราะห์สาเหตุ')
  expect(text).toContain('หลักฐานที่ใช้')
  expect(text).toContain('คำแนะนำที่ควรตรวจ')
  expect(text).not.toContain('ผู้ช่วย Insights')
  expect(text).not.toContain('แผนที่เลือกทำต่อ')
  expect(html).not.toContain('ai-brain-panel')
  expect(html).not.toContain('master-agent-launch')
})
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm run test -- tests/homeApp.test.tsx -t Insights`

Expected: fail because `InsightsPage` is not exported and route still uses `AiMarketerPage`.

- [ ] **Step 3: Implement the new page shell**

In `src/App.tsx`:
- Import helper types from `./insightsWorkspace`.
- Change marketer route to:

```tsx
{activeTab === 'marketer' && (
  <InsightsPage
    datePreset={datePreset}
    onBrainApprovalActions={setBrainApprovalActions}
    onOpenPlanExecution={openBrainPlanExecution}
    onQueueBrainAction={queueBrainAction}
    recommendationStates={recommendationStates}
    websiteContext={websiteContext}
    workspace={visibleWorkspace}
  />
)}
```

- Add `export function InsightsPage(...)` where `AiMarketerPage` currently lives.
- Remove old visible JSX that renders `ผู้ช่วย Insights`, `ai-brain-panel`, `master-agent-launch`, old finding grid, and old approval list.
- Keep any shared helper functions used by other pages until tests prove they are dead.

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/homeApp.test.tsx -t Insights`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx tests/homeApp.test.tsx
git commit -m "feat: rebuild insights page shell"
```

---

### Task 4: Real AI Refresh With Structured Payload

**Files:**
- Modify: `src/App.tsx`
- Modify: `server/openAiPlugin.ts`
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Write failing source tests**

```tsx
it('sends structured Insights payload to the real AI brain endpoint', () => {
  const source = readText('../src/App.tsx')
  const pageSource = source.slice(source.indexOf('export function InsightsPage'), source.indexOf('function InsightsBriefPanel'))

  expect(pageSource).toContain("apiJson<AiBrainApiResponse>('/api/ai/brain'")
  expect(pageSource).toContain('insightsPayload')
  expect(pageSource).toContain('buildInsightsAnalysisPayload')
  expect(pageSource).toContain('rawMetrics')
  expect(pageSource).toContain('derivedMetrics')
  expect(pageSource).toContain('freshness')
  expect(pageSource).toContain('attribution')
})

it('passes insightsPayload through the AI brain server payload', () => {
  const source = readText('../server/openAiPlugin.ts')
  const endpointSource = source.slice(source.indexOf("requestUrl.pathname === '/api/ai/brain'"), source.indexOf("requestUrl.pathname === '/api/ai/outcomes'"))

  expect(endpointSource).toContain('insightsPayload')
  expect(endpointSource).toContain('sanitizeUnknownRecord(body.insightsPayload)')
  expect(endpointSource).toContain('structuredInsightsPayload')
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/homeApp.test.tsx -t Insights`

Expected: fail because refresh and server payload passthrough are missing.

- [ ] **Step 3: Wire manual AI refresh**

Inside `InsightsPage`:

```tsx
const analysisPayload = useMemo(
  () => (workspace ? buildInsightsAnalysisPayload({ accountName: websiteContext.pageTitle || 'PMC Ads Agent', datePreset, workspace }) : null),
  [datePreset, websiteContext.pageTitle, workspace],
)
const [cachedInsight, setCachedInsight] = useState<InsightsCachedInsight | null>(() => readInsightsCache())
const [aiError, setAiError] = useState('')
const [isAiRunning, setIsAiRunning] = useState(false)

const visibleInsight = cachedInsight ?? (analysisPayload ? buildFallbackInsightsCache(analysisPayload) : null)

const runInsightsAiAnalysis = useCallback(async () => {
  if (!workspace || !analysisPayload || isAiRunning) return
  setIsAiRunning(true)
  setAiError('')
  try {
    const result = await apiJson<AiBrainApiResponse>('/api/ai/brain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intent: 'Build the Insights AI Brief First analysis from structured Meta metrics, formulas, freshness, attribution, evidence, and approval-gated recommendations.',
        insightsPayload: analysisPayload,
        websiteContext,
        workspace,
      }),
    })
    const normalized = normalizeInsightsAiResponse(result, analysisPayload)
    setCachedInsight(normalized)
    writeInsightsCache(normalized)
    onBrainApprovalActions(result.approvalActions ?? [])
  } catch (error) {
    setAiError(error instanceof Error ? formatApiMessage(error.message) : 'AI วิเคราะห์ Insights ไม่สำเร็จ')
  } finally {
    setIsAiRunning(false)
  }
}, [analysisPayload, isAiRunning, onBrainApprovalActions, websiteContext, workspace])
```

- [ ] **Step 4: Pass structured payload to OpenAI**

In `/api/ai/brain` server branch:

```ts
const structuredInsightsPayload = sanitizeUnknownRecord(body.insightsPayload)
```

Include it in the OpenAI payload:

```ts
payload: {
  instruction: 'Act as PMC Master Agent. Route specialist thinking, enforce policy, and return Thai executive-ready analysis.',
  insightsPayload: structuredInsightsPayload,
  masterTask,
  routing,
  contextBundle,
},
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- tests/homeApp.test.tsx -t Insights`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx server/openAiPlugin.ts tests/homeApp.test.tsx
git commit -m "feat: wire insights ai refresh"
```

---

### Task 5: Scoreboard, Charts, Diagnostics, Evidence, Recommendations

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Write failing render tests**

```tsx
it('renders Insights charts and recommendations from derived metrics', () => {
  const html = renderToStaticMarkup(
    <InsightsPage
      datePreset="เดือนนี้"
      onBrainApprovalActions={() => undefined}
      onOpenPlanExecution={() => undefined}
      onQueueBrainAction={() => undefined}
      recommendationStates={{}}
      websiteContext={websiteContextFixture()}
      workspace={workspaceData()}
    />,
  )

  expect(html).toContain('class="insights-scoreboard"')
  expect(html).toContain('class="insights-chart-grid"')
  expect(html).toContain('class="insights-formula-grid"')
  expect(html).toContain('class="insights-evidence-grid"')
  expect(html).toContain('class="insights-recommendation-list"')
  expect(html).toContain('ต้องอนุมัติก่อนส่ง Meta')
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/homeApp.test.tsx -t Insights`

Expected: fail until the components render.

- [ ] **Step 3: Add component boundaries**

Add these local components below `InsightsPage`:

```tsx
function InsightsBriefPanel(...)
function InsightsConfidenceBadge(...)
function InsightsMetricScoreboard(...)
function InsightsTrendCharts(...)
function InsightsFormulaDiagnostics(...)
function InsightsEvidenceCards(...)
function InsightsRecommendationList(...)
function InsightsDataWarning(...)
```

Use Recharts for compact charts:

```tsx
<ResponsiveContainer width="100%" height={220}>
  <BarChart data={metrics.trends}>
    <CartesianGrid strokeDasharray="3 3" vertical={false} />
    <XAxis dataKey="label" tickLine={false} />
    <YAxis tickLine={false} />
    <Tooltip />
    <Bar dataKey="spend" fill="#B98247" radius={[6, 6, 0, 0]} />
    <Bar dataKey="results" fill="#315C6B" radius={[6, 6, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

- [ ] **Step 4: Add CSS**

Add stable dimensions and responsive rules:

```css
.insights-workspace {
  display: grid;
  gap: 16px;
}

.insights-brief-panel,
.insights-section {
  border: 1px solid rgba(121, 92, 57, 0.18);
  border-radius: 8px;
  background: rgba(255, 252, 247, 0.92);
  box-shadow: 0 18px 40px rgba(71, 53, 31, 0.08);
  padding: 18px;
}

.insights-scoreboard,
.insights-chart-grid,
.insights-formula-grid,
.insights-evidence-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.insights-chart-card {
  min-height: 290px;
}

@media (max-width: 720px) {
  .insights-brief-grid,
  .insights-scoreboard,
  .insights-chart-grid,
  .insights-formula-grid,
  .insights-evidence-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- tests/homeApp.test.tsx -t Insights`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css tests/homeApp.test.tsx
git commit -m "feat: render insights analysis workspace"
```

---

### Task 6: Approval Guardrails And No Direct Meta Writes

**Files:**
- Modify: `src/App.tsx`
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it('keeps Insights recommendations approval-gated and avoids direct Meta writes', () => {
  const source = readText('../src/App.tsx')
  const pageSource = source.slice(source.indexOf('export function InsightsPage'), source.indexOf('function InsightsBriefPanel'))

  expect(pageSource).toContain('canOpenInsightsApprovalCommand')
  expect(pageSource).toContain('onQueueBrainAction')
  expect(pageSource).not.toContain("'/api/meta/")
  expect(pageSource).not.toContain('apiJson<MetaStatusResponse>')
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test -- tests/homeApp.test.tsx -t Insights`

Expected: fail until approval guard is wired.

- [ ] **Step 3: Wire guarded approval opening**

Implement:

```tsx
const openInsightsApproval = useCallback((recommendation: InsightsRecommendation) => {
  const approval = canOpenInsightsApprovalCommand(recommendation)
  if (!approval.allowed) {
    setAiError(approval.reason)
    return
  }
  const action = insightsRecommendationToMetaAction(recommendation)
  onQueueBrainAction(action)
}, [onQueueBrainAction])
```

Map only simple high-evidence actions into `MetaRecommendedAction`. For unknown or complex actions, display review-only copy and route to the relevant workspace later.

- [ ] **Step 4: Run tests**

Run: `npm run test -- tests/homeApp.test.tsx -t Insights`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx tests/homeApp.test.tsx
git commit -m "feat: guard insights approvals"
```

---

### Task 7: Full Verification, Browser QA, And Logs

**Files:**
- Modify: `docs/PROJECT_UPDATES.md`
- Modify: `/Users/natthaphon/Documents/LB Ax/Ax/Projects/PMC Ads Agent/Current Work.md`

- [ ] **Step 1: Run full local checks**

Run:

```bash
npm run test -- tests/insightsWorkspace.test.ts tests/homeApp.test.tsx
npm run test
npm run lint
npm run build
```

Expected:
- Focused tests pass.
- Full test suite passes.
- Lint passes.
- Build passes, allowing the existing Vite chunk-size warning if unchanged.

- [ ] **Step 2: Browser QA**

Open `http://127.0.0.1:5176/ads-agent`.

Check:
- Sidebar `Insights` opens the rebuilt AI Brief First workspace.
- Old copy `ผู้ช่วย Insights` and old `พับข้อมูล` controls are gone.
- Cached/fallback brief shows before manual refresh.
- `วิเคราะห์ใหม่ด้วย AI` is enabled only when workspace data exists.
- Charts are visible and do not overflow desktop or mobile.
- Recommendation buttons say approval/review language and do not send Meta writes directly.
- Console has no error/warn noise from the new page.

Capture screenshots:
- `/tmp/pmc-insights-desktop.png`
- `/tmp/pmc-insights-mobile.png`

- [ ] **Step 3: Update logs**

Add to `docs/PROJECT_UPDATES.md`:

```md
- Implemented the rebuilt Insights AI Analysis workspace with cached AI brief, structured AI refresh payload, formula metrics, charts, evidence, confidence, and approval-gated recommendations.
```

Add to Obsidian Current Work:

```md
- Insights workspace implementation completed: rebuilt the old page into AI Brief First analysis with formula-backed metrics, charts, cached AI refresh, evidence, confidence, and approval-gated recommendations.
```

- [ ] **Step 4: Commit**

```bash
git add src/insightsWorkspace.ts src/App.tsx src/App.css tests/insightsWorkspace.test.ts tests/homeApp.test.tsx server/openAiPlugin.ts docs/PROJECT_UPDATES.md
git commit -m "feat: rebuild insights workspace"
```

---

## Self-Review Checklist

- [ ] The old `AiMarketerPage` visible UI is not rendered by the `marketer` route.
- [ ] The first visible Insights section is the AI brief.
- [ ] The page shows cached/fallback insight immediately.
- [ ] Manual refresh sends a structured payload with account, dateWindow, attribution, freshness, rawMetrics, derivedMetrics, and recommendationsContext.
- [ ] Scoreboard and charts use the same `deriveInsightsMetrics` output.
- [ ] Formula engine never divides by zero; unavailable metrics render `รอข้อมูล`.
- [ ] Confidence is shown for brief, diagnostics, evidence, and recommendations.
- [ ] Low-confidence recommendations cannot open approval commands.
- [ ] Insights does not call `/api/meta/*` directly.
- [ ] Browser QA confirms desktop/mobile layouts are readable.
