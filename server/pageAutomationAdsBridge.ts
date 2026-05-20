import type { WorkspaceData } from '../src/types'
import type { SharedAdsInsightForPageRecord } from './pageAutomationTypes.js'

type RiskLevel = SharedAdsInsightForPageRecord['findings'][number]['risk']

const DERIVED_FINDING_CONFIDENCE = 50

const READ_ONLY_POLICY = {
  readOnly: true,
  noMetaWrites: true,
  noInventedMetrics: true,
  approvalRequired: true,
} as const

export function normalizeAdsInsightForPage({
  datePreset,
  pageId,
  pageName,
  workspace,
}: {
  datePreset: string
  pageId?: string
  pageName?: string
  workspace: WorkspaceData | null
}): SharedAdsInsightForPageRecord {
  const campaigns = workspace?.campaigns ?? []
  const adSets = workspace?.adSets ?? []
  const ads = workspace?.adInsights ?? []
  const channelPerformance = workspace?.channelPerformance ?? []

  const spend = sumBy(campaigns, (campaign) => campaign.spend)
  const revenue = sumBy(campaigns, (campaign) => campaign.revenue)
  const conversions = sumBy(campaigns, (campaign) => campaign.conversions)
  const ctr = averageBy(campaigns, (campaign) => campaign.ctr)
  const leads = sumBy(channelPerformance, (channel) => channel.leads)
  const bookings = sumBy(channelPerformance, (channel) => channel.bookings)
  const topAds = [...ads].sort((left, right) => safeNumber(right.roas) - safeNumber(left.roas)).slice(0, 5)

  return {
    source: {
      datePreset,
      checkedAt: new Date().toISOString(),
      taskId: `page-automation-${Date.now()}`,
    },
    scope: {
      pageId,
      pageName,
      campaignIds: campaigns.map((campaign) => campaign.id),
      adSetIds: adSets.map((adSet) => adSet.id),
      adIds: ads.map((ad) => ad.id),
    },
    metrics: {
      spend,
      revenue,
      roas: spend > 0 ? revenue / spend : 0,
      cpa: conversions > 0 ? spend / conversions : 0,
      ctr,
      leads,
      bookings,
    },
    findings: campaigns.slice(0, 3).map((campaign) => ({
      title: campaign.name,
      summary:
        campaign.aiSummary ||
        `ROAS ${safeNumber(campaign.roas).toFixed(2)}x, CPA ${Math.round(safeNumber(campaign.cpa)).toLocaleString('th-TH')}`,
      evidence: [
        `Spend ${safeNumber(campaign.spend)}`,
        `CTR ${safeNumber(campaign.ctr)}`,
        `Conversions ${safeNumber(campaign.conversions)}`,
      ],
      risk: riskFromAiStatus(campaign.aiStatus),
      confidence: DERIVED_FINDING_CONFIDENCE,
    })),
    recommendations: (workspace?.actions ?? []).slice(0, 5).map((action) => ({
      id: action.id,
      action: action.summary,
      expectedImpact: action.expectedImpact,
      guardrail: action.guardrail,
      requiresApproval: true,
      risk: action.risk,
      confidence: action.confidence,
    })),
    creativeSignals: topAds.map((ad) => ({
      adId: ad.id,
      campaignId: ad.campaignId,
      creative: ad.creative || ad.name,
      score: safeNumber(ad.score),
      ctr: safeNumber(ad.ctr),
      roas: safeNumber(ad.roas),
      bookings: safeNumber(ad.bookings),
    })),
    outcomeSignals: {
      alerts: [],
      learnings: [],
      nextActions: [],
    },
    policy: READ_ONLY_POLICY,
  }
}

function sumBy<T>(items: T[], readValue: (item: T) => number) {
  return items.reduce((sum, item) => sum + safeNumber(readValue(item)), 0)
}

function averageBy<T>(items: T[], readValue: (item: T) => number) {
  return items.length > 0 ? sumBy(items, readValue) / items.length : 0
}

function safeNumber(value: number) {
  return Number.isFinite(value) ? value : 0
}

function riskFromAiStatus(status: WorkspaceData['campaigns'][number]['aiStatus']): RiskLevel {
  if (status === 'critical') return 'High'
  if (status === 'watch') return 'Medium'
  return 'Low'
}
