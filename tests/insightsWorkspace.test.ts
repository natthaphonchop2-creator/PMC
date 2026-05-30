import { describe, expect, it, vi } from 'vitest'
import {
  buildFallbackInsightsCache,
  buildInsightsAnalysisPayload,
  canOpenInsightsApprovalCommand,
  deriveInsightsMetrics,
  formatInsightMetricValue,
  normalizeInsightsAiResponse,
  readInsightsCache,
  writeInsightsCache,
  type InsightsRecommendation,
} from '../src/insightsWorkspace'
import type { WorkspaceData } from '../src/types'

describe('insightsWorkspace helpers', () => {
  it('does not divide by zero and marks unavailable formulas explicitly', () => {
    const workspace = workspaceFixture({
      campaigns: [
        { spend: 1200, conversions: 0, revenue: 0, ctr: 0, roas: 0, cpa: 0, frequency: 0 },
        { spend: 800, conversions: 0, revenue: 0, ctr: 0, roas: 0, cpa: 0, frequency: 0 },
      ],
      trendData: [{ bookings: 0, clicks: 0, date: '2026-05-01', impressions: 0, leads: 0, reach: 0, revenue: 0, showUps: 0, spend: 1200, treatments: 0, cpa: 0 }],
    })
    workspace.adInsights = workspace.adInsights.map((ad) => ({ ...ad, bookings: 0, clicks: 0, impressions: 0, leads: 0 }))

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

  it('adds driver-level values to campaign evidence cards from ad activity', () => {
    const workspace = workspaceFixture()
    const metrics = deriveInsightsMetrics(workspace)
    const evidenceCard = metrics.evidenceCards.find((card) => card.objectId === 'cmp-1')
    const fallbackInsight = buildFallbackInsightsCache(buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'เดือนนี้', workspace }))
    const fallbackCard = fallbackInsight.evidenceCards.find((card) => card.objectId === 'cmp-1')

    expect(evidenceCard?.metricValues).toEqual(expect.arrayContaining([
      { label: 'Clicks', value: '100' },
      { label: 'Impressions', value: '2,000' },
      { label: 'CVR', value: '15%' },
      { label: 'CPM', value: '฿1,000' },
      { label: 'Frequency', value: '2.2x' },
    ]))
    expect(fallbackCard?.metricValues).toEqual(expect.arrayContaining([
      { label: 'Clicks', value: '100' },
      { label: 'CVR', value: '15%' },
      { label: 'CPM', value: '฿1,000' },
    ]))
  })

  it('calculates percent change from real trend comparison windows', () => {
    const workspace = workspaceFixture()
    const metrics = deriveInsightsMetrics(workspace)
    const spend = metrics.scoreboard.find((item) => item.key === 'spend')

    expect(spend?.value).toBe(4000)
    expect(spend?.previousValue).toBe(3000)
    expect(spend?.changeRate).toBeCloseTo(0.8333, 4)
    expect(spend?.comparisonLabel).toBe('เทียบ 2 จุดล่าสุดกับ 2 จุดก่อนหน้า')
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

  it('normalizes partial AI responses into a safe cached insight', () => {
    const workspace = workspaceFixture()
    const payload = buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'วันนี้', workspace })
    const cached = normalizeInsightsAiResponse({
      brief: { summary: 'ควรรักษางบผู้ชนะไว้', title: 'ROAS ดีขึ้น' },
      confidence: { level: 'สูง', overall: 82, reasons: ['ข้อมูลสด'] },
      recommendations: [{ targetId: 'set-1', targetType: 'adset', title: 'รีวิว creative fatigue' }],
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
      removeItem: (key: string) => {
        delete storage[key]
      },
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
    })

    const cached = buildFallbackInsightsCache(buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'วันนี้', workspace: workspaceFixture() }))
    writeInsightsCache(cached)
    expect(readInsightsCache()?.id).toBe(cached.id)
    vi.unstubAllGlobals()
  })

  it('blocks low confidence approval commands', () => {
    const blocked: InsightsRecommendation = {
      action: 'pause',
      confidence: { level: 'ต่ำ', overall: 58, reasons: ['ข้อมูลยังน้อย'] },
      evidenceIds: ['ev-1'],
      id: 'rec-low',
      requiresApproval: true,
      riskNote: 'sample size ต่ำ',
      targetId: 'set-1',
      targetName: 'Low sample',
      targetType: 'adset',
      title: 'พัก Ad Set ที่ข้อมูลยังน้อย',
    }

    expect(canOpenInsightsApprovalCommand(blocked)).toEqual({ allowed: false, reason: 'ความมั่นใจยังไม่พอสำหรับเปิดคำสั่งอนุมัติ' })
  })
})

function workspaceFixture(overrides: {
  campaigns?: Array<Partial<WorkspaceData['campaigns'][number]>>
  trendData?: WorkspaceData['trendData']
} = {}): WorkspaceData {
  const campaigns: WorkspaceData['campaigns'] = [
    {
      aiStatus: 'healthy',
      aiSummary: 'ROAS ดี',
      budget: 5000,
      conversions: 15,
      cpa: 333,
      ctr: 3.2,
      deliveryStatus: 'active',
      frequency: 2.2,
      id: 'cmp-1',
      name: 'Lead Botox',
      objective: 'Leads',
      revenue: 4000,
      roas: 2,
      spend: 2000,
    },
    {
      aiStatus: 'watch',
      aiSummary: 'ต้องจับตา',
      budget: 3000,
      conversions: 4,
      cpa: 500,
      ctr: 1.2,
      deliveryStatus: 'active',
      frequency: 4.8,
      id: 'cmp-2',
      name: 'Filler Review',
      objective: 'Leads',
      revenue: 500,
      roas: 0.5,
      spend: 2000,
    },
  ].map((campaign, index) => ({ ...campaign, ...(overrides.campaigns?.[index] ?? {}) }))

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
    campaigns,
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
