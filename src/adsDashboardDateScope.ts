import type { FunnelMetric, TrendPoint, WorkspaceData } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

type DatePresetWindow = {
  endMs: number
  startMs: number
}

type DateScopedTrendTotals = {
  bookings: number
  clicks: number
  impressions: number
  leads: number
  reach: number
  revenue: number
  spend: number
  treatments: number
}

type DateScopeScale = {
  bookings: number
  clicks: number
  impressions: number
  leads: number
  reach: number
  revenue: number
  spend: number
  treatments: number
}

export function scopeWorkspaceByDatePreset(workspace: WorkspaceData | null, preset: string): WorkspaceData | null {
  if (!workspace) return workspace
  const window = datePresetWindowForTrendData(workspace.trendData, preset)
  if (!window) return workspace

  const trendData = workspace.trendData.filter((point) => {
    const dateMs = trendPointDateMs(point)
    return dateMs !== null && dateMs >= window.startMs && dateMs <= window.endMs
  })
  if (trendData.length === workspace.trendData.length) return workspace

  const fullTotals = applyFunnelFallbacks(trendDataTotals(workspace.trendData), workspace.funnelMetrics)
  const totals = applyFunnelFallbacks(trendDataTotals(trendData), workspace.funnelMetrics)
  const scale = buildDateScopeScale(fullTotals, totals)

  return {
    ...workspace,
    appointmentStages: [],
    adInsights: workspace.adInsights.map((ad) => scaleAdInsightByDateScope(ad, scale)),
    adSets: workspace.adSets.map((adSet) => scaleAdSetByDateScope(adSet, scale)),
    campaigns: workspace.campaigns.map((campaign) => scaleCampaignByDateScope(campaign, scale)),
    channelPerformance: buildDateScopedChannelPerformance(totals),
    complianceReviews: workspace.complianceReviews.map((review) => scaleComplianceReviewByDateScope(review, scale)),
    funnelMetrics: buildDateScopedFunnelMetrics(totals),
    insightComponents: workspace.insightComponents.map((component) => scaleInsightComponentByDateScope(component, scale)),
    serviceLines: workspace.serviceLines.map((serviceLine) => scaleServiceLineByDateScope(serviceLine, scale)),
    trendData,
    updatedAt: `${workspace.updatedAt} · ${preset}`,
  }
}

function datePresetWindowForTrendData(trendData: TrendPoint[], preset: string): DatePresetWindow | null {
  const presetKey = metaDatePresetForUi(preset)
  if (presetKey === 'maximum') return null

  const datedPoints = trendData
    .map((point) => trendPointDateMs(point))
    .filter((dateMs): dateMs is number => dateMs !== null)
  if (!datedPoints.length) return null

  const endMs = Math.max(...datedPoints)
  const endDate = new Date(endMs)
  let startMs: number

  if (presetKey === 'last_7d') {
    startMs = endMs - 6 * DAY_MS
  } else if (presetKey === 'this_month') {
    startMs = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1)
  } else if (presetKey === 'last_90d') {
    const quarterStartMonth = Math.floor(endDate.getUTCMonth() / 3) * 3
    startMs = Date.UTC(endDate.getUTCFullYear(), quarterStartMonth, 1)
  } else {
    startMs = endMs - 29 * DAY_MS
  }

  return { startMs, endMs }
}

export function metaDatePresetForUi(preset: string) {
  if (preset === '7 วันล่าสุด' || preset === 'Last 7 days') return 'last_7d'
  if (preset === 'เดือนนี้' || preset === 'This month') return 'this_month'
  if (preset === 'ไตรมาสนี้' || preset === 'Quarter to date') return 'last_90d'
  if (preset === 'ข้อมูลทั้งหมด' || preset === 'Maximum history') return 'maximum'
  return 'last_30d'
}

function trendPointDateMs(point: TrendPoint) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(point.date)
  if (!match) return null
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function trendDataTotals(trendData: TrendPoint[]): DateScopedTrendTotals {
  return trendData.reduce<DateScopedTrendTotals>(
    (totals, point) => ({
      bookings: totals.bookings + finiteOrZero(point.bookings),
      clicks: totals.clicks + finiteOrZero(point.clicks),
      impressions: totals.impressions + finiteOrZero(point.impressions),
      leads: totals.leads + finiteOrZero(point.leads),
      reach: totals.reach + finiteOrZero(point.reach),
      revenue: totals.revenue + finiteOrZero(point.revenue),
      spend: totals.spend + finiteOrZero(point.spend),
      treatments: totals.treatments + finiteOrZero(point.treatments || point.showUps),
    }),
    { bookings: 0, clicks: 0, impressions: 0, leads: 0, reach: 0, revenue: 0, spend: 0, treatments: 0 },
  )
}

function applyFunnelFallbacks(totals: DateScopedTrendTotals, funnelMetrics: FunnelMetric[]): DateScopedTrendTotals {
  if (totals.impressions > 0) return totals

  const fullImpressions = funnelMetricCount(funnelMetrics, 'Impressions')
  const fullClicks = funnelMetricCount(funnelMetrics, 'Clicks')
  if (fullImpressions <= 0 || fullClicks <= 0 || totals.clicks <= 0) return totals

  return {
    ...totals,
    impressions: Math.round(fullImpressions * Math.min(1, totals.clicks / fullClicks)),
  }
}

function buildDateScopedChannelPerformance(totals: DateScopedTrendTotals): WorkspaceData['channelPerformance'] {
  if ([totals.spend, totals.revenue, totals.impressions, totals.clicks, totals.leads, totals.bookings, totals.treatments].every((value) => value <= 0)) return []

  return [
    {
      bookings: totals.bookings,
      channel: 'Meta Ads',
      clicks: totals.clicks,
      firstTimePatients: totals.treatments,
      impressions: totals.impressions,
      leadQuality: Math.round(Math.min(100, safeRate(totals.bookings || totals.treatments, totals.leads || totals.clicks) + Math.min(safeDivide(totals.revenue, totals.spend) * 12, 50))),
      leads: totals.leads,
      reach: totals.reach,
      revenue: totals.revenue,
      showUps: totals.treatments,
      spend: totals.spend,
      treatments: totals.treatments,
    },
  ]
}

function buildDateScopedFunnelMetrics(totals: DateScopedTrendTotals): FunnelMetric[] {
  const stages = [
    { stage: 'Impressions', count: totals.impressions, previous: totals.impressions, help: 'จำนวนครั้งที่โฆษณาถูกแสดงในช่วงที่เลือก' },
    { stage: 'Clicks', count: totals.clicks, previous: totals.impressions, help: 'จำนวน click ในช่วงที่เลือก' },
    { stage: 'Leads', count: totals.leads, previous: totals.clicks, help: 'Lead actions ในช่วงที่เลือก' },
    { stage: 'Bookings', count: totals.bookings, previous: totals.leads || totals.clicks, help: 'ยอดนัดหมายในช่วงที่เลือก' },
    { stage: 'Paid', count: totals.treatments, previous: totals.bookings || totals.leads || totals.clicks, help: 'Purchase conversions ในช่วงที่เลือก' },
  ]
  if (stages.every((stage) => stage.count <= 0)) return []

  return stages.map((stage) => {
    const conversionRate = stage.stage === 'Impressions' ? 100 : round1(safeRate(stage.count, stage.previous))
    return {
      benchmark: stage.stage === 'Impressions' ? 'ช่วงข้อมูลที่เลือก' : `${stage.stage} rate`,
      conversionRate,
      count: stage.count,
      dropOffRate: round1(Math.max(0, 100 - conversionRate)),
      help: stage.help,
      stage: stage.stage,
    }
  })
}

function buildDateScopeScale(fullTotals: DateScopedTrendTotals, scopedTotals: DateScopedTrendTotals): DateScopeScale {
  const fallback = firstPositiveRatio([
    ratio(scopedTotals.spend, fullTotals.spend),
    ratio(scopedTotals.bookings, fullTotals.bookings),
    ratio(scopedTotals.clicks, fullTotals.clicks),
    ratio(scopedTotals.revenue, fullTotals.revenue),
  ])

  return {
    bookings: ratio(scopedTotals.bookings, fullTotals.bookings, fallback),
    clicks: ratio(scopedTotals.clicks, fullTotals.clicks, fallback),
    impressions: ratio(scopedTotals.impressions, fullTotals.impressions, fallback),
    leads: ratio(scopedTotals.leads, fullTotals.leads, fallback),
    reach: ratio(scopedTotals.reach, fullTotals.reach, fallback),
    revenue: ratio(scopedTotals.revenue, fullTotals.revenue, fallback),
    spend: ratio(scopedTotals.spend, fullTotals.spend, fallback),
    treatments: ratio(scopedTotals.treatments, fullTotals.treatments, fallback),
  }
}

function scaleCampaignByDateScope(campaign: WorkspaceData['campaigns'][number], scale: DateScopeScale): WorkspaceData['campaigns'][number] {
  const spend = roundMoney(campaign.spend * scale.spend)
  const revenue = roundMoney(campaign.revenue * scale.revenue)
  const conversions = roundCount(campaign.conversions * scale.bookings)

  return {
    ...campaign,
    conversions,
    cpa: conversions > 0 ? roundMoney(spend / conversions) : 0,
    revenue,
    roas: spend > 0 ? round2(revenue / spend) : 0,
    spend,
  }
}

function scaleAdSetByDateScope(adSet: WorkspaceData['adSets'][number], scale: DateScopeScale): WorkspaceData['adSets'][number] {
  const spend = roundMoney(adSet.spend * scale.spend)
  const bookings = roundCount(adSet.bookings * scale.bookings)

  return {
    ...adSet,
    bookings,
    cpa: bookings > 0 ? roundMoney(spend / bookings) : 0,
    roas: round2(adSet.roas * relativeRatio(scale.revenue, scale.spend)),
    spend,
  }
}

function scaleAdInsightByDateScope(ad: WorkspaceData['adInsights'][number], scale: DateScopeScale): WorkspaceData['adInsights'][number] {
  const spend = roundMoney(ad.spend * scale.spend)
  const impressions = roundCount(ad.impressions * scale.impressions)
  const clicks = roundCount(ad.clicks * scale.clicks)
  const leads = roundCount(ad.leads * scale.leads)
  const bookings = roundCount(ad.bookings * scale.bookings)

  return {
    ...ad,
    bookings,
    clicks,
    cpc: clicks > 0 ? roundMoney(spend / clicks) : 0,
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
    impressions,
    leads,
    roas: round2(ad.roas * relativeRatio(scale.revenue, scale.spend)),
    spend,
  }
}

function scaleInsightComponentByDateScope(component: WorkspaceData['insightComponents'][number], scale: DateScopeScale): WorkspaceData['insightComponents'][number] {
  const spend = roundMoney(component.spend * scale.spend)
  const clicks = roundCount(component.clicks * scale.clicks)
  const results = roundCount(component.results * scale.bookings)
  const purchaseValue = roundMoney(component.purchaseValue * scale.revenue)

  return {
    ...component,
    clicks,
    costPerResult: results > 0 ? roundMoney(spend / results) : 0,
    ctr: round2(component.ctr * relativeRatio(scale.clicks, scale.impressions)),
    purchaseValue,
    results,
    roas: spend > 0 ? round2(purchaseValue / spend) : 0,
    spend,
  }
}

function scaleServiceLineByDateScope(serviceLine: WorkspaceData['serviceLines'][number], scale: DateScopeScale): WorkspaceData['serviceLines'][number] {
  const revenue = roundMoney(serviceLine.revenue * scale.revenue)
  const bookings = roundCount(serviceLine.bookings * scale.bookings)

  return {
    ...serviceLine,
    bookings,
    cpa: bookings > 0 ? roundMoney(serviceLine.cpa * scale.spend / scale.bookings) : 0,
    revenue,
  }
}

function scaleComplianceReviewByDateScope(review: WorkspaceData['complianceReviews'][number], scale: DateScopeScale): WorkspaceData['complianceReviews'][number] {
  const spend = typeof review.spend === 'number' ? roundMoney(review.spend * scale.spend) : review.spend
  const impressions = typeof review.impressions === 'number' ? roundCount(review.impressions * scale.impressions) : review.impressions

  return {
    ...review,
    ctr: typeof review.ctr === 'number' ? round2(review.ctr * relativeRatio(scale.clicks, scale.impressions)) : review.ctr,
    impressions,
    roas: typeof review.roas === 'number' ? round2(review.roas * relativeRatio(scale.revenue, scale.spend)) : review.roas,
    spend,
  }
}

function funnelMetricCount(funnelMetrics: FunnelMetric[], stage: string) {
  const match = funnelMetrics.find((metric) => metric.stage.trim().toLowerCase() === stage.trim().toLowerCase())
  const count = Number(match?.count)
  return Number.isFinite(count) && count >= 0 ? count : 0
}

function finiteOrZero(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0
}

function ratio(scoped: number, full: number, fallback = 0) {
  if (full > 0) return Math.max(0, Math.min(1, scoped / full))
  return fallback
}

function firstPositiveRatio(values: number[]) {
  return values.find((value) => value > 0) ?? 0
}

function relativeRatio(numeratorRatio: number, denominatorRatio: number) {
  return denominatorRatio > 0 ? numeratorRatio / denominatorRatio : numeratorRatio > 0 ? 1 : 0
}

function roundCount(value: number) {
  return Math.round(Math.max(0, value))
}

function roundMoney(value: number) {
  return Math.round(Math.max(0, value) * 100) / 100
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}
