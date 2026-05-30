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
    expect(model.evidenceCounts).toEqual({ account: 0, ad: 0, adset: 0, campaign: 2, total: 2 })
    expect(model.caveats.some((caveat) => caveat.includes('Meta'))).toBe(true)
    expect(model.signalCounts.supporting + model.signalCounts.neutral + model.signalCounts.contradicting).toBeGreaterThan(0)

    expect(model.drivers.find((driver) => driver.id === 'cpm')?.sparkline).toHaveLength(4)
    expect(model.drivers.find((driver) => driver.id === 'conversion_rate')?.sparkline).toHaveLength(4)
  })

  it('selects evidence cards that carry values for the selected driver', () => {
    const workspace = workspaceFixture()
    const metrics = deriveInsightsMetrics(workspace)
    const insight = buildFallbackInsightsCache(buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'เดือนนี้', workspace }))

    const model = buildInsightsDecisionRiverModel({ insight: { ...insight, evidenceCards: metrics.evidenceCards }, metrics })
    const ctrEvidence = model.drivers.find((driver) => driver.id === 'ctr')?.evidenceIds ?? []
    const cvrEvidence = model.drivers.find((driver) => driver.id === 'conversion_rate')?.evidenceIds ?? []
    const cardsById = new Map(metrics.evidenceCards.map((card) => [card.id, card]))

    expect(ctrEvidence.every((id) => id.startsWith('evidence-campaign-'))).toBe(true)
    expect(cvrEvidence.every((id) => id.startsWith('evidence-campaign-'))).toBe(true)
    expect(cvrEvidence.map((id) => cardsById.get(id)?.metricValues)).toEqual(expect.arrayContaining([
      expect.arrayContaining([{ label: 'CVR', value: '15%' }]),
      expect.arrayContaining([{ label: 'CVR', value: '10%' }]),
    ]))
  })

  it('classifies pressure direction according to metric meaning', () => {
    expect(pressureToneForDriver('cpm', 0.18)).toEqual({ label: 'กดดัน', tone: 'watch', direction: 'up' })
    expect(pressureToneForDriver('cpm', -0.18)).toEqual({ label: 'ช่วยดีขึ้น', tone: 'good', direction: 'down' })
    expect(pressureToneForDriver('ctr', 0.18)).toEqual({ label: 'ช่วยดีขึ้น', tone: 'good', direction: 'up' })
    expect(pressureToneForDriver('ctr', -0.18)).toEqual({ label: 'กดดัน', tone: 'critical', direction: 'down' })
    expect(pressureToneForDriver('spend', null)).toEqual({ label: 'ทรงตัว', tone: 'neutral', direction: 'flat' })
  })

  it('marks lanes unavailable when the source metric is unavailable', () => {
    const workspace = workspaceFixture({
      campaigns: [
        { conversions: 0, cpa: 0, revenue: 0, roas: 0 },
        { conversions: 0, cpa: 0, revenue: 0, roas: 0 },
      ],
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

  it('keeps CPA ready when conversion rate is unavailable but CPA is available', () => {
    const workspace = workspaceFixture({
      trendData: [{ bookings: 0, clicks: 0, cpa: 0, date: '2026-05-01', impressions: 0, leads: 0, reach: 0, revenue: 4500, showUps: 0, spend: 4000, treatments: 0 }],
    })
    workspace.adInsights = workspace.adInsights.map((ad) => ({ ...ad, bookings: 0, clicks: 0, impressions: 0, leads: 0 }))

    const metrics = deriveInsightsMetrics(workspace)
    const insight = buildFallbackInsightsCache(buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'วันนี้', workspace }))
    const model = buildInsightsDecisionRiverModel({ insight, metrics })

    const cvr = model.drivers.find((driver) => driver.id === 'conversion_rate')
    const cpa = model.outcomes.find((outcome) => outcome.id === 'cpa')

    expect(cvr).toEqual(expect.objectContaining({ statusLabel: 'รอข้อมูล', tone: 'neutral' }))
    expect(cpa).toEqual(expect.objectContaining({ formattedValue: '฿211', statusLabel: 'รอเทียบ', tone: 'neutral' }))
  })

  it('keeps caveats unique and capped', () => {
    const workspace = workspaceFixture()
    const metrics = deriveInsightsMetrics(workspace)
    const insight = buildFallbackInsightsCache(buildInsightsAnalysisPayload({ accountName: 'PMC', datePreset: 'เดือนนี้', workspace }))

    const model = buildInsightsDecisionRiverModel({
      insight: {
        ...insight,
        dataWarnings: ['duplicate warning', 'duplicate warning', 'extra warning one', 'extra warning two'],
      },
      metrics: {
        ...metrics,
        dataWarnings: ['duplicate warning', 'extra warning three'],
      },
    })

    expect(model.caveats).toHaveLength(4)
    expect(new Set(model.caveats).size).toBe(model.caveats.length)
  })
})

function workspaceFixture(overrides: {
  campaigns?: Array<Partial<WorkspaceData['campaigns'][number]>>
  trendData?: WorkspaceData['trendData']
} = {}): WorkspaceData {
  const campaigns: WorkspaceData['campaigns'] = [
    { aiStatus: 'healthy', aiSummary: 'ROAS ดี', budget: 5000, conversions: 15, cpa: 333, ctr: 3.2, deliveryStatus: 'active', frequency: 2.2, id: 'cmp-1', name: 'Lead Botox', objective: 'Leads', revenue: 4000, roas: 2, spend: 2000 },
    { aiStatus: 'watch', aiSummary: 'ต้องจับตา', budget: 3000, conversions: 4, cpa: 500, ctr: 1.2, deliveryStatus: 'active', frequency: 4.8, id: 'cmp-2', name: 'Filler Review', objective: 'Leads', revenue: 500, roas: 0.5, spend: 2000 },
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
