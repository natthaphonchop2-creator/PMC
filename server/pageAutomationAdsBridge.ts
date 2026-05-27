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
  const scopedWorkspace = scopeWorkspaceForPage(workspace, pageName)
  const campaigns = scopedWorkspace.campaigns
  const adSets = scopedWorkspace.adSets
  const ads = scopedWorkspace.adInsights
  const channelPerformance = scopedWorkspace.channelPerformance

  const spend = sumBy(campaigns, (campaign) => campaign.spend)
  const revenue = sumBy(campaigns, (campaign) => campaign.revenue)
  const conversions = sumBy(campaigns, (campaign) => campaign.conversions)
  const ctr = averageBy(campaigns, (campaign) => campaign.ctr)
  const leads = channelPerformance.length ? sumBy(channelPerformance, (channel) => channel.leads) : sumBy(ads, (ad) => ad.leads)
  const bookings = channelPerformance.length ? sumBy(channelPerformance, (channel) => channel.bookings) : sumBy(ads, (ad) => ad.bookings)
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
    recommendations: scopedWorkspace.actions.slice(0, 5).map((action) => ({
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

function scopeWorkspaceForPage(workspace: WorkspaceData | null, pageName?: string) {
  const empty = {
    actions: [],
    adInsights: [],
    adSets: [],
    campaigns: [],
    channelPerformance: [],
  }
  if (!workspace) return empty

  const tokens = pageScopeTokens(pageName)
  if (!tokens.length) {
    return {
      actions: workspace.actions,
      adInsights: workspace.adInsights,
      adSets: workspace.adSets,
      campaigns: workspace.campaigns,
      channelPerformance: workspace.channelPerformance,
    }
  }

  const matchedCampaignIds = new Set<string>()
  const matchedAdSetIds = new Set<string>()
  const matchedAdIds = new Set<string>()

  for (const campaign of workspace.campaigns) {
    if (matchesPageScope([campaign.name, campaign.objective, campaign.id], tokens)) matchedCampaignIds.add(campaign.id)
  }

  for (const adSet of workspace.adSets) {
    if (matchedCampaignIds.has(adSet.campaignId) || matchesPageScope([adSet.name, adSet.audience, adSet.id], tokens)) {
      matchedAdSetIds.add(adSet.id)
      matchedCampaignIds.add(adSet.campaignId)
    }
  }

  for (const ad of workspace.adInsights) {
    if (
      matchedCampaignIds.has(ad.campaignId) ||
      matchedAdSetIds.has(ad.adSetId) ||
      matchesPageScope([ad.name, ad.creative, ad.id], tokens)
    ) {
      matchedAdIds.add(ad.id)
      matchedAdSetIds.add(ad.adSetId)
      matchedCampaignIds.add(ad.campaignId)
    }
  }

  const campaigns = workspace.campaigns.filter((campaign) => matchedCampaignIds.has(campaign.id))
  const adSets = workspace.adSets.filter((adSet) => matchedCampaignIds.has(adSet.campaignId) || matchedAdSetIds.has(adSet.id))
  const adInsights = workspace.adInsights.filter(
    (ad) => matchedCampaignIds.has(ad.campaignId) || matchedAdSetIds.has(ad.adSetId) || matchedAdIds.has(ad.id),
  )
  const actions = workspace.actions.filter(
    (action) => matchedCampaignIds.has(action.campaignId) || matchesPageScope([action.target, action.summary], tokens),
  )
  const channelPerformance = workspace.channelPerformance.filter((channel) => matchesPageScope([channel.channel], tokens))

  return {
    actions,
    adInsights,
    adSets,
    campaigns,
    channelPerformance,
  }
}

function pageScopeTokens(pageName?: string) {
  const normalized = normalizeScopeText(pageName ?? '')
  if (!normalized) return []

  const stopWords = new Set(['page', 'clinic', 'aesthetic', 'pmc', 'official', 'facebook', 'instagram', 'เพจ', 'คลินิก'])
  return Array.from(
    new Set(
      normalized
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !stopWords.has(token)),
    ),
  )
}

function matchesPageScope(values: Array<string | undefined>, tokens: string[]) {
  const haystack = normalizeScopeText(values.filter(Boolean).join(' '))
  if (!haystack) return false
  const compactHaystack = haystack.replace(/\s+/g, '')
  return tokens.some((token) => haystack.includes(token) || compactHaystack.includes(token.replace(/\s+/g, '')))
}

function normalizeScopeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[_/|()[\]{}.,:;'"`~!@#$%^&*+=?<>\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
