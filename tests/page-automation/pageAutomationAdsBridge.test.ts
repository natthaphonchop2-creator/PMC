import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { normalizeAdsInsightForPage } from '../../server/pageAutomationAdsBridge'
import type { WorkspaceData } from '../../src/types'

const READ_ONLY_POLICY = {
  readOnly: true,
  noMetaWrites: true,
  noInventedMetrics: true,
  approvalRequired: true,
}

describe('normalizeAdsInsightForPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-21T04:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a read-only SharedAdsInsightForPageRecord policy', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_7d',
      pageId: 'page-1',
      pageName: 'Fifth Clinic',
      workspace: workspaceData(),
    })

    expect(insight.policy).toEqual(READ_ONLY_POLICY)
  })

  it('aggregates supplied workspace metrics without inventing values', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_7d',
      workspace: workspaceData({
        campaigns: [
          campaign({ id: 'cmp-1', spend: 100, revenue: 300, conversions: 5, ctr: 2.5 }),
          campaign({ id: 'cmp-2', spend: 50, revenue: 150, conversions: 10, ctr: 1.5 }),
        ],
        adSets: [adSet({ id: 'set-1' }), adSet({ id: 'set-2' })],
        adInsights: [ad({ id: 'ad-1' }), ad({ id: 'ad-2' })],
        channelPerformance: [
          channelPerformance({ leads: 7, bookings: 2 }),
          channelPerformance({ leads: 3, bookings: 1 }),
        ],
      }),
    })

    expect(insight.source).toEqual({
      datePreset: 'last_7d',
      checkedAt: '2026-05-21T04:00:00.000Z',
      taskId: 'page-automation-1779336000000',
    })
    expect(insight.scope).toEqual({
      pageId: undefined,
      pageName: undefined,
      campaignIds: ['cmp-1', 'cmp-2'],
      adSetIds: ['set-1', 'set-2'],
      adIds: ['ad-1', 'ad-2'],
    })
    expect(insight.metrics).toEqual({
      spend: 150,
      revenue: 450,
      roas: 3,
      cpa: 10,
      ctr: 2,
      leads: 10,
      bookings: 3,
    })
  })

  it('scopes Ads insight to campaigns, ad sets, and ads that match the selected page name', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_7d',
      pageId: 'page-fifth',
      pageName: 'Fifth Clinic',
      workspace: workspaceData({
        campaigns: [
          campaign({ id: 'cmp-fifth', name: 'ตัวรี MSG เติมไขมัน 9900 CA เพจFifth 20.6.66 - สำเนา', spend: 100, revenue: 240, conversions: 4, ctr: 2 }),
          campaign({ id: 'cmp-tab', name: 'ตัวรี MSG เติมไขมัน 9900 CA เพจTab 20.6.66 - สำเนา', spend: 900, revenue: 100, conversions: 10, ctr: 1 }),
        ],
        adSets: [
          adSet({ id: 'set-fifth', campaignId: 'cmp-fifth', name: 'Fifth warm audience' }),
          adSet({ id: 'set-tab', campaignId: 'cmp-tab', name: 'Tab warm audience' }),
        ],
        adInsights: [
          ad({ id: 'ad-fifth', adSetId: 'set-fifth', campaignId: 'cmp-fifth', name: 'Fifth lead ad', spend: 100, clicks: 20, impressions: 1000, leads: 8, bookings: 4 }),
          ad({ id: 'ad-tab', adSetId: 'set-tab', campaignId: 'cmp-tab', name: 'Tab lead ad', spend: 900, clicks: 90, impressions: 9000, leads: 30, bookings: 10 }),
        ],
      }),
    })

    expect(insight.scope.campaignIds).toEqual(['cmp-fifth'])
    expect(insight.scope.adSetIds).toEqual(['set-fifth'])
    expect(insight.scope.adIds).toEqual(['ad-fifth'])
    expect(insight.metrics).toMatchObject({
      spend: 100,
      revenue: 240,
      roas: 2.4,
      cpa: 25,
      ctr: 2,
      leads: 8,
      bookings: 4,
    })
    expect(insight.findings).toHaveLength(1)
    expect(insight.creativeSignals.map((signal) => signal.adId)).toEqual(['ad-fifth'])
  })

  it('handles a null workspace with empty scope arrays and zero metrics', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_30d',
      pageId: 'page-1',
      pageName: 'Fifth Clinic',
      workspace: null,
    })

    expect(insight.scope).toEqual({
      pageId: 'page-1',
      pageName: 'Fifth Clinic',
      campaignIds: [],
      adSetIds: [],
      adIds: [],
    })
    expect(insight.metrics).toEqual({
      spend: 0,
      revenue: 0,
      roas: 0,
      cpa: 0,
      ctr: 0,
      leads: 0,
      bookings: 0,
    })
    expect(insight.policy).toEqual(READ_ONLY_POLICY)
  })

  it('creates findings with sanitized numbers and conservative derived confidence', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_7d',
      workspace: workspaceData({
        campaigns: [
          campaign({
            name: 'Campaign with invalid metrics',
            spend: Number.NaN,
            revenue: Number.POSITIVE_INFINITY,
            roas: Number.NaN,
            cpa: Number.POSITIVE_INFINITY,
            ctr: Number.NEGATIVE_INFINITY,
            conversions: Number.NaN,
            aiSummary: '',
            aiStatus: 'healthy',
          }),
        ],
      }),
    })

    expect(insight.findings).toEqual([
      {
        title: 'Campaign with invalid metrics',
        summary: 'ROAS 0.00x, CPA 0',
        evidence: ['Spend 0', 'CTR 0', 'Conversions 0'],
        risk: 'Low',
        confidence: 50,
      },
    ])
  })

  it('sanitizes non-finite creative signal numbers', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_7d',
      workspace: workspaceData({
        adInsights: [
          ad({
            id: 'ad-invalid',
            score: Number.NaN,
            ctr: Number.POSITIVE_INFINITY,
            roas: Number.NEGATIVE_INFINITY,
            bookings: Number.NaN,
          }),
        ],
      }),
    })

    expect(insight.creativeSignals).toEqual([
      {
        adId: 'ad-invalid',
        campaignId: 'cmp-1',
        creative: 'Creative 1',
        score: 0,
        ctr: 0,
        roas: 0,
        bookings: 0,
      },
    ])
  })

  it('omits source workspaceId when only an account memory title is available', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_7d',
      workspace: workspaceData({
        memoryItems: [
          memoryItem({
            id: 'meta-memory-account',
            title: 'PMC Ads Account',
          }),
        ],
      }),
    })

    expect(insight.source).toEqual({
      datePreset: 'last_7d',
      checkedAt: '2026-05-21T04:00:00.000Z',
      taskId: 'page-automation-1779336000000',
    })
    expect(insight.source).not.toHaveProperty('workspaceId')
  })

  it('creates creative signals from top ads sorted by ROAS and capped to five', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_7d',
      workspace: workspaceData({
        adInsights: [
          ad({ id: 'ad-1', creative: 'Creative 1', roas: 1, ctr: 1.1, bookings: 1 }),
          ad({ id: 'ad-2', creative: 'Creative 2', roas: 5, ctr: 5.5, bookings: 5 }),
          ad({ id: 'ad-3', creative: 'Creative 3', roas: 3, ctr: 3.3, bookings: 3 }),
          ad({ id: 'ad-4', creative: 'Creative 4', roas: 7, ctr: 7.7, bookings: 7 }),
          ad({ id: 'ad-5', creative: 'Creative 5', roas: 0, ctr: 0.5, bookings: 0 }),
          ad({ id: 'ad-6', creative: 'Creative 6', roas: 4, ctr: 4.4, bookings: 4 }),
        ],
      }),
    })

    expect(insight.creativeSignals.map((signal) => signal.adId)).toEqual(['ad-4', 'ad-2', 'ad-6', 'ad-3', 'ad-1'])
    expect(insight.creativeSignals[0]).toMatchObject({
      adId: 'ad-4',
      campaignId: 'cmp-1',
      creative: 'Creative 4',
      ctr: 7.7,
      roas: 7,
      bookings: 7,
    })
  })

  it('maps workspace actions into recommendations that always require approval', () => {
    const insight = normalizeAdsInsightForPage({
      datePreset: 'last_7d',
      workspace: workspaceData({
        actions: [
          action({
            id: 'action-1',
            summary: 'Turn best ad angle into a page post draft',
            expectedImpact: 'More qualified bookings',
            guardrail: 'Human review before any Page write',
            requiresApproval: false,
            risk: 'Medium',
            confidence: 81,
          }),
        ],
      }),
    })

    expect(insight.recommendations).toEqual([
      {
        id: 'action-1',
        action: 'Turn best ad angle into a page post draft',
        expectedImpact: 'More qualified bookings',
        guardrail: 'Human review before any Page write',
        requiresApproval: true,
        risk: 'Medium',
        confidence: 81,
      },
    ])
  })
})

function workspaceData(overrides: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    campaigns: [],
    serviceLines: [],
    appointmentStages: [],
    complianceReviews: [],
    insights: [],
    insightComponents: [],
    adSets: [],
    adInsights: [],
    actions: [],
    autoAds: [],
    tasks: [],
    memoryItems: [],
    auditTrail: [],
    trendData: [],
    channelPerformance: [],
    funnelMetrics: [],
    autoMode: 'suggest',
    updatedAt: '2026-05-21T04:00:00.000Z',
    ...overrides,
  }
}

function campaign(overrides: Partial<WorkspaceData['campaigns'][number]> = {}): WorkspaceData['campaigns'][number] {
  return {
    id: 'cmp-1',
    name: 'Campaign 1',
    objective: 'LEADS',
    deliveryStatus: 'active',
    budget: 0,
    spend: 0,
    revenue: 0,
    roas: 0,
    cpa: 0,
    ctr: 0,
    conversions: 0,
    frequency: 0,
    aiStatus: 'healthy',
    aiSummary: 'Healthy campaign',
    ...overrides,
  }
}

function adSet(overrides: Partial<WorkspaceData['adSets'][number]> = {}): WorkspaceData['adSets'][number] {
  return {
    id: 'set-1',
    campaignId: 'cmp-1',
    name: 'Ad Set 1',
    audience: 'Broad',
    deliveryStatus: 'active',
    budget: 0,
    spend: 0,
    bookings: 0,
    cpa: 0,
    roas: 0,
    status: 'healthy',
    ...overrides,
  }
}

function ad(overrides: Partial<WorkspaceData['adInsights'][number]> = {}): WorkspaceData['adInsights'][number] {
  return {
    id: 'ad-1',
    campaignId: 'cmp-1',
    adSetId: 'set-1',
    name: 'Ad 1',
    creative: 'Creative 1',
    status: 'active',
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    bookings: 0,
    showRate: 0,
    ctr: 0,
    cpc: 0,
    roas: 0,
    score: 0,
    ...overrides,
  }
}

function action(overrides: Partial<WorkspaceData['actions'][number]> = {}): WorkspaceData['actions'][number] {
  return {
    id: 'action-1',
    campaignId: 'cmp-1',
    type: 'creative',
    target: 'Campaign 1',
    summary: 'Create a page post from the winning ad angle',
    expectedImpact: 'Improve bookings',
    guardrail: 'Needs human approval',
    before: 'No page draft',
    after: 'Draft created',
    rollbackNote: 'Delete the draft',
    risk: 'Low',
    confidence: 90,
    status: 'pending',
    ...overrides,
  }
}

function memoryItem(overrides: Partial<WorkspaceData['memoryItems'][number]> = {}): WorkspaceData['memoryItems'][number] {
  return {
    id: 'memory-1',
    category: 'Insight',
    title: 'Memory 1',
    detail: 'Memory detail',
    source: 'test',
    confidence: 50,
    updatedAt: '2026-05-21T04:00:00.000Z',
    ...overrides,
  }
}

function channelPerformance(
  overrides: Partial<WorkspaceData['channelPerformance'][number]> = {},
): WorkspaceData['channelPerformance'][number] {
  return {
    channel: 'Meta Ads',
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leads: 0,
    bookings: 0,
    showUps: 0,
    treatments: 0,
    firstTimePatients: 0,
    revenue: 0,
    leadQuality: 0,
    ...overrides,
  }
}
