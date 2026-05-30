import type { WorkspaceData } from './types'

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
  availability: InsightsAvailability
  changeRate: number | null
  comparisonLabel: string
  formula: string
  key: InsightsMetricKey
  label: string
  previousValue: number | null
  sourceFields: string[]
  value: number | null
}

export type InsightsTrendPoint = {
  conversionRate: number | null
  cpa: number | null
  cpc: number | null
  cpm: number | null
  ctr: number | null
  date: string
  frequency: number | null
  label: string
  roas: number | null
  results: number
  spend: number
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

export type InsightsRawTotals = {
  clicks: number
  impressions: number
  reach: number
  results: number
  revenue: number
  spend: number
}

type InsightsTrendComparison = {
  current: InsightsRawTotals
  label: string
  previous: InsightsRawTotals
}

export type InsightsMetrics = {
  rawTotals: InsightsRawTotals
  scoreboard: InsightsDerivedMetric[]
  trends: InsightsTrendPoint[]
  formulaDiagnostics: InsightsFormulaDiagnostic[]
  evidenceCards: InsightsEvidenceCard[]
  recommendations: InsightsRecommendation[]
  dataWarnings: string[]
  confidence: InsightsConfidence
  wasteScores: Array<{ objectId: string; objectName: string; score: number }>
  fatigueScores: Array<{ objectId: string; objectName: string; score: number }>
  momentumScores: Array<{ objectId: string; objectName: string; score: number }>
}

export type InsightsAnalysisPayload = {
  account: {
    id: string
    name: string
    currency: 'THB'
    timezone: 'Asia/Bangkok'
  }
  dateWindow: {
    preset: string
    start: string
    end: string
    previousStart: string
    previousEnd: string
  }
  attribution: {
    setting: string
    actionAttributionWindows: string[]
    changedFromPreviousWindow: boolean
  }
  freshness: {
    metaSyncedAt: string
    aiAnalyzedAt: string
    staleReason: string
  }
  rawMetrics: {
    account: InsightsRawTotals
    campaigns: Array<{
      id: string
      name: string
      spend: number
      revenue: number
      conversions: number
      cpa: number
      roas: number
      ctr: number
      frequency: number
      deliveryStatus: string
    }>
    adSets: Array<{
      id: string
      campaignId: string
      name: string
      spend: number
      bookings: number
      cpa: number
      roas: number
      deliveryStatus: string
    }>
    ads: Array<{
      id: string
      campaignId: string
      adSetId: string
      name: string
      spend: number
      impressions: number
      clicks: number
      leads: number
      bookings: number
      ctr: number
      cpc: number
      roas: number
      status: string
    }>
  }
  derivedMetrics: {
    scoreboard: InsightsDerivedMetric[]
    trends: InsightsTrendPoint[]
    formulaDiagnostics: InsightsFormulaDiagnostic[]
    wasteScores: InsightsMetrics['wasteScores']
    fatigueScores: InsightsMetrics['fatigueScores']
    momentumScores: InsightsMetrics['momentumScores']
  }
  recommendationsContext: {
    existingRecommendations: string[]
    approvalHistory: string[]
    blockedActions: string[]
  }
}

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

export const INSIGHTS_CACHE_KEY = 'pmc-ads-agent-insights-cache-v1'

export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return numerator / denominator
}

export function deriveInsightsMetrics(workspace: WorkspaceData): InsightsMetrics {
  const rawTotals = buildRawTotals(workspace)
  const trendComparison = buildTrendComparison(workspace.trendData)
  const confidence = scoreInsightsConfidence(workspace, rawTotals)
  const scoreboard = buildScoreboard(rawTotals, trendComparison)
  const trends = buildTrendPoints(workspace, rawTotals)
  const dataWarnings = buildDataWarnings(workspace, rawTotals)
  const wasteScores = buildWasteScores(workspace)
  const fatigueScores = buildFatigueScores(workspace)
  const momentumScores = buildMomentumScores(workspace.trendData)
  const formulaDiagnostics = buildFormulaDiagnostics({
    confidence,
    fatigueScores,
    momentumScores,
    rawTotals,
    scoreboard,
    wasteScores,
  })
  const evidenceCards = buildEvidenceCards(workspace, scoreboard, confidence)
  const recommendations = buildRecommendations(workspace, evidenceCards, confidence, wasteScores, fatigueScores)

  return {
    confidence,
    dataWarnings,
    evidenceCards,
    fatigueScores,
    formulaDiagnostics,
    momentumScores,
    rawTotals,
    recommendations,
    scoreboard,
    trends,
    wasteScores,
  }
}

export function buildInsightsAnalysisPayload({
  accountName,
  datePreset,
  workspace,
}: {
  accountName?: string
  datePreset: string
  workspace: WorkspaceData
}): InsightsAnalysisPayload {
  const metrics = deriveInsightsMetrics(workspace)
  const window = inferDateWindow(datePreset, workspace.trendData)

  return {
    account: {
      currency: 'THB',
      id: 'meta-workspace',
      name: cleanText(accountName, 'PMC Ads Agent'),
      timezone: 'Asia/Bangkok',
    },
    attribution: {
      actionAttributionWindows: ['Meta reported window'],
      changedFromPreviousWindow: false,
      setting: 'Meta reported attribution from synced workspace',
    },
    dateWindow: window,
    derivedMetrics: {
      fatigueScores: metrics.fatigueScores,
      formulaDiagnostics: metrics.formulaDiagnostics,
      momentumScores: metrics.momentumScores,
      scoreboard: metrics.scoreboard,
      trends: metrics.trends,
      wasteScores: metrics.wasteScores,
    },
    freshness: {
      aiAnalyzedAt: new Date().toISOString(),
      metaSyncedAt: workspace.updatedAt || '',
      staleReason: metrics.dataWarnings.find((warning) => warning.includes('ข้อมูล')) ?? '',
    },
    rawMetrics: {
      account: metrics.rawTotals,
      adSets: workspace.adSets.map((adSet) => ({
        bookings: finiteOrZero(adSet.bookings),
        campaignId: adSet.campaignId,
        cpa: finiteOrZero(adSet.cpa),
        deliveryStatus: adSet.deliveryStatus,
        id: adSet.id,
        name: adSet.name,
        roas: finiteOrZero(adSet.roas),
        spend: finiteOrZero(adSet.spend),
      })),
      ads: workspace.adInsights.map((ad) => ({
        adSetId: ad.adSetId,
        bookings: finiteOrZero(ad.bookings),
        campaignId: ad.campaignId,
        clicks: finiteOrZero(ad.clicks),
        cpc: finiteOrZero(ad.cpc),
        ctr: finiteOrZero(ad.ctr),
        id: ad.id,
        impressions: finiteOrZero(ad.impressions),
        leads: finiteOrZero(ad.leads),
        name: ad.name,
        roas: finiteOrZero(ad.roas),
        spend: finiteOrZero(ad.spend),
        status: ad.status,
      })),
      campaigns: workspace.campaigns.map((campaign) => ({
        conversions: finiteOrZero(campaign.conversions),
        cpa: finiteOrZero(campaign.cpa),
        ctr: finiteOrZero(campaign.ctr),
        deliveryStatus: campaign.deliveryStatus,
        frequency: finiteOrZero(campaign.frequency),
        id: campaign.id,
        name: campaign.name,
        revenue: finiteOrZero(campaign.revenue),
        roas: finiteOrZero(campaign.roas),
        spend: finiteOrZero(campaign.spend),
      })),
    },
    recommendationsContext: {
      approvalHistory: workspace.auditTrail.map((event) => `${event.action}: ${event.target}`),
      blockedActions: metrics.recommendations.filter((item) => !canOpenInsightsApprovalCommand(item).allowed).map((item) => item.title),
      existingRecommendations: workspace.actions.map((action) => action.summary),
    },
  }
}

export function buildFallbackInsightsCache(payload: InsightsAnalysisPayload): InsightsCachedInsight {
  const spend = payload.derivedMetrics.scoreboard.find((item) => item.key === 'spend')
  const roas = payload.derivedMetrics.scoreboard.find((item) => item.key === 'roas')
  const cpa = payload.derivedMetrics.scoreboard.find((item) => item.key === 'cpa')
  const warnings = payload.derivedMetrics.formulaDiagnostics.filter((item) => item.tone !== 'good').slice(0, 2)

  return {
    analyzedAt: payload.freshness.aiAnalyzedAt,
    brief: {
      risks: payload.freshness.staleReason ? [payload.freshness.staleReason] : warnings.map((item) => item.summary),
      summary: `ใช้จ่าย ${spend ? formatInsightMetricValue(spend) : 'รอข้อมูล'} พร้อม ROAS ${roas ? formatInsightMetricValue(roas) : 'รอข้อมูล'} และ CPA ${cpa ? formatInsightMetricValue(cpa) : 'รอข้อมูล'} จากข้อมูลล่าสุดที่ซิงก์`,
      title: 'สรุปล่าสุดจากข้อมูลที่มี',
      whatChanged: warnings.length ? warnings.map((item) => item.title) : ['ยังไม่พบสัญญาณผิดปกติชัดเจนจากสูตรหลัก'],
      whatToDoNext: payload.derivedMetrics.formulaDiagnostics.some((item) => item.tone === 'critical')
        ? ['ตรวจแคมเปญหรือ Ad Set ที่ใช้เงินสูงก่อนปรับงบ']
        : ['รีวิวผู้ชนะและผู้แพ้จากหลักฐานด้านล่างก่อนส่งคำสั่ง'],
    },
    confidence: scorePayloadConfidence(payload),
    dataWarnings: payload.freshness.staleReason ? [payload.freshness.staleReason] : [],
    evidenceCards: buildEvidenceCardsFromPayload(payload),
    id: `insights-cache-${payload.freshness.aiAnalyzedAt}`,
    metricDiagnostics: payload.derivedMetrics.formulaDiagnostics,
    payload,
    recommendations: buildRecommendationsFromPayload(payload),
    source: 'fallback',
  }
}

export function normalizeInsightsAiResponse(raw: unknown, payload: InsightsAnalysisPayload): InsightsCachedInsight {
  const fallback = buildFallbackInsightsCache(payload)
  const record = isRecord(raw) ? raw : {}
  const brief = isRecord(record.brief) ? record.brief : {}
  const confidence = normalizeConfidence(record.confidence, fallback.confidence)
  const summary = cleanText(brief.summary, cleanText(record.summary, fallback.brief.summary))

  return {
    analyzedAt: cleanText(record.checkedAt, new Date().toISOString()),
    brief: {
      risks: cleanStringList(brief.risks, fallback.brief.risks),
      summary,
      title: cleanText(brief.title, fallback.brief.title),
      whatChanged: cleanStringList(brief.whatChanged, fallback.brief.whatChanged),
      whatToDoNext: cleanStringList(brief.whatToDoNext, fallback.brief.whatToDoNext),
    },
    confidence,
    dataWarnings: cleanStringList(record.dataWarnings, fallback.dataWarnings),
    evidenceCards: normalizeEvidenceCards(record.evidenceCards, fallback.evidenceCards, confidence),
    id: `insights-ai-${Date.now()}`,
    metricDiagnostics: normalizeDiagnostics(record.metricDiagnostics, fallback.metricDiagnostics, confidence),
    payload,
    recommendations: normalizeRecommendations(record.recommendations, fallback.recommendations, confidence),
    source: 'ai',
  }
}

export function readInsightsCache(): InsightsCachedInsight | null {
  try {
    const storage = globalThis.localStorage
    const raw = storage?.getItem(INSIGHTS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as InsightsCachedInsight
    if (!parsed || typeof parsed.id !== 'string') return null
    const fallbackEvidenceCards = parsed.payload ? buildEvidenceCardsFromPayload(parsed.payload) : []
    return {
      ...parsed,
      evidenceCards: mergeEvidenceMetricValues(parsed.evidenceCards, fallbackEvidenceCards),
      source: 'cached',
    }
  } catch {
    return null
  }
}

export function writeInsightsCache(cache: InsightsCachedInsight) {
  try {
    globalThis.localStorage?.setItem(INSIGHTS_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Cache should never block the live workspace.
  }
}

export function formatInsightMetricValue(metric: InsightsDerivedMetric): string {
  if (metric.availability === 'unavailable' || metric.value === null) return 'รอข้อมูล'
  if (metric.key === 'spend' || metric.key === 'cpa' || metric.key === 'cpc' || metric.key === 'cpm') return formatMoney(metric.value)
  if (metric.key === 'roas') return `${formatDecimal(metric.value)}x`
  if (metric.key === 'frequency') return `${formatDecimal(metric.value)}x`
  if (metric.key === 'ctr' || metric.key === 'conversion_rate') return `${formatDecimal(metric.value)}%`
  return formatNumber(metric.value)
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

function buildRawTotals(workspace: WorkspaceData): InsightsRawTotals {
  const campaignSpend = sum(workspace.campaigns, (campaign) => campaign.spend)
  const adSpend = sum(workspace.adInsights, (ad) => ad.spend)
  const spend = workspace.campaigns.length ? campaignSpend : adSpend
  const campaignRevenue = sum(workspace.campaigns, (campaign) => campaign.revenue)
  const adRevenue = sum(workspace.adInsights, (ad) => ad.spend * ad.roas)
  const revenue = workspace.campaigns.length ? campaignRevenue : adRevenue
  const campaignResults = sum(workspace.campaigns, (campaign) => campaign.conversions)
  const adResults = sum(workspace.adInsights, (ad) => ad.bookings)
  const results = workspace.campaigns.length ? campaignResults : adResults
  const impressions = sum(workspace.adInsights, (ad) => ad.impressions) || sum(workspace.trendData, (point) => point.impressions ?? 0)
  const clicks = sum(workspace.adInsights, (ad) => ad.clicks) || sum(workspace.trendData, (point) => point.clicks)
  const reachFromTrend = sum(workspace.trendData, (point) => point.reach ?? 0)
  const weightedFrequency = weightedAverage(workspace.campaigns, (campaign) => campaign.frequency, (campaign) => campaign.spend)
  const reach = reachFromTrend || (weightedFrequency ? Math.round(impressions / weightedFrequency) : 0)

  return {
    clicks,
    impressions,
    reach,
    results,
    revenue,
    spend,
  }
}

function buildTrendComparison(trendData: WorkspaceData['trendData']): InsightsTrendComparison | null {
  if (trendData.length < 2) return null
  const orderedTrendData = trendData
    .map((point, index) => ({ index, point, timestamp: Date.parse(point.date) }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : left.index
      const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : right.index
      return leftTime - rightTime
    })
    .map((item) => item.point)
  const midpoint = Math.max(1, Math.floor(trendData.length / 2))
  const previousPoints = orderedTrendData.slice(0, midpoint)
  const currentPoints = orderedTrendData.slice(midpoint)
  if (!previousPoints.length || !currentPoints.length) return null

  return {
    current: buildTrendTotals(currentPoints),
    label: `เทียบ ${currentPoints.length} จุดล่าสุดกับ ${previousPoints.length} จุดก่อนหน้า`,
    previous: buildTrendTotals(previousPoints),
  }
}

function buildTrendTotals(points: WorkspaceData['trendData']): InsightsRawTotals {
  return {
    clicks: sum(points, (point) => point.clicks),
    impressions: sum(points, (point) => point.impressions ?? 0),
    reach: sum(points, (point) => point.reach ?? 0),
    results: sum(points, (point) => point.bookings),
    revenue: sum(points, (point) => point.revenue),
    spend: sum(points, (point) => point.spend),
  }
}

function buildMetricValues(totals: InsightsRawTotals): Record<InsightsMetricKey, number | null> {
  const cpa = safeRatio(totals.spend, totals.results)
  const roas = safeRatio(totals.revenue, totals.spend)
  const ctr = percentRatio(totals.clicks, totals.impressions)
  const cpc = safeRatio(totals.spend, totals.clicks)
  const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null
  const frequency = safeRatio(totals.impressions, totals.reach)
  const conversionRate = percentRatio(totals.results, totals.clicks)

  return {
    conversion_rate: conversionRate,
    cpa,
    cpc,
    cpm,
    ctr,
    frequency,
    results: totals.results,
    roas,
    spend: totals.spend,
  }
}

function buildScoreboard(current: InsightsRawTotals, comparison: InsightsTrendComparison | null): InsightsDerivedMetric[] {
  const currentValues = buildMetricValues(current)
  const comparisonCurrentValues = comparison ? buildMetricValues(comparison.current) : null
  const comparisonPreviousValues = comparison ? buildMetricValues(comparison.previous) : null
  const metric = (
    key: InsightsMetricKey,
    label: string,
    formula: string,
    sourceFields: string[],
  ): InsightsDerivedMetric => {
    const value = currentValues[key]
    const comparisonValue = comparisonCurrentValues?.[key] ?? null
    const previousValue = comparisonPreviousValues?.[key] ?? null
    return {
      availability: value === null ? 'unavailable' : 'ready',
      changeRate: comparisonValue !== null && previousValue !== null ? safeRatio(comparisonValue - previousValue, Math.abs(previousValue)) : null,
      comparisonLabel: comparison ? comparison.label : 'รอ trend จริงสำหรับเทียบช่วงก่อน',
      formula,
      key,
      label,
      previousValue,
      sourceFields,
      value,
    }
  }

  return [
    metric('spend', 'Spend', 'spend', ['campaigns.spend', 'ads.spend', 'trendData.spend']),
    metric('results', 'Results', 'conversions or bookings', ['campaigns.conversions', 'ads.bookings', 'trendData.bookings']),
    metric('cpa', 'CPA/CPL', 'spend / conversions', ['spend', 'results', 'trendData.spend', 'trendData.bookings']),
    metric('roas', 'ROAS', 'conversion_value / spend', ['revenue', 'spend', 'trendData.revenue', 'trendData.spend']),
    metric('ctr', 'CTR', 'clicks / impressions', ['clicks', 'impressions', 'trendData.clicks', 'trendData.impressions']),
    metric('cpc', 'CPC', 'spend / clicks', ['spend', 'clicks', 'trendData.spend', 'trendData.clicks']),
    metric('cpm', 'CPM', 'spend / impressions * 1000', ['spend', 'impressions', 'trendData.spend', 'trendData.impressions']),
    metric('frequency', 'Frequency', 'impressions / reach', ['impressions', 'reach', 'trendData.impressions', 'trendData.reach']),
    metric('conversion_rate', 'Conversion rate', 'conversions / clicks', ['results', 'clicks', 'trendData.bookings', 'trendData.clicks']),
  ]
}

function buildTrendPoints(workspace: WorkspaceData, rawTotals: InsightsRawTotals): InsightsTrendPoint[] {
  const source = workspace.trendData.length
    ? workspace.trendData
    : [{ bookings: rawTotals.results, clicks: rawTotals.clicks, cpa: 0, date: workspace.updatedAt || 'current', impressions: rawTotals.impressions, leads: 0, reach: rawTotals.reach, revenue: rawTotals.revenue, showUps: 0, spend: rawTotals.spend, treatments: 0 }]

  return source.map((point) => {
    const impressions = finiteOrZero(point.impressions)
    const clicks = finiteOrZero(point.clicks)
    const reach = finiteOrZero(point.reach)
    const results = finiteOrZero(point.bookings)
    return {
      conversionRate: percentRatio(results, clicks),
      cpa: safeRatio(point.spend, results),
      cpc: safeRatio(point.spend, clicks),
      cpm: impressions > 0 ? (point.spend / impressions) * 1000 : null,
      ctr: percentRatio(clicks, impressions),
      date: point.date,
      frequency: safeRatio(impressions, reach),
      label: formatTrendLabel(point.date),
      results,
      roas: safeRatio(point.revenue, point.spend),
      spend: finiteOrZero(point.spend),
    }
  })
}

function buildDataWarnings(workspace: WorkspaceData, totals: InsightsRawTotals): string[] {
  const warnings: string[] = []
  if (!workspace.campaigns.length && !workspace.adInsights.length) warnings.push('ข้อมูลยังไม่พอ ต้อง Sync Meta ก่อนวิเคราะห์ด้วย AI')
  if (workspace.trendData.length < 2) warnings.push('ยังไม่มี trend รายวันพอสำหรับคำนวณ % เทียบช่วงก่อน')
  if (totals.impressions < 1000 || totals.clicks < 20) warnings.push('ข้อมูลยังมีปริมาณต่ำ ความมั่นใจของข้อสรุปจะลดลง')
  if (!workspace.updatedAt) warnings.push('ยังไม่มีเวลาซิงก์ข้อมูลล่าสุด')
  return warnings
}

function buildWasteScores(workspace: WorkspaceData): InsightsMetrics['wasteScores'] {
  const totalSpend = sum(workspace.adSets, (adSet) => adSet.spend)
  const totalResults = sum(workspace.adSets, (adSet) => adSet.bookings)
  if (!totalSpend || !totalResults) return []

  return workspace.adSets.map((adSet) => {
    const spendShare = adSet.spend / totalSpend
    const resultShare = adSet.bookings / totalResults
    return {
      objectId: adSet.id,
      objectName: adSet.name,
      score: round((spendShare - resultShare) * 100, 1),
    }
  }).sort((left, right) => right.score - left.score)
}

function buildFatigueScores(workspace: WorkspaceData): InsightsMetrics['fatigueScores'] {
  return workspace.campaigns.map((campaign) => {
    const frequencyPressure = Math.max(0, campaign.frequency - 3) * 16
    const ctrPressure = Math.max(0, 2.5 - campaign.ctr) * 12
    const roasPressure = Math.max(0, 1 - campaign.roas) * 20
    return {
      objectId: campaign.id,
      objectName: campaign.name,
      score: clamp(Math.round(frequencyPressure + ctrPressure + roasPressure), 0, 100),
    }
  }).sort((left, right) => right.score - left.score)
}

function buildMomentumScores(trendData: WorkspaceData['trendData']): InsightsMetrics['momentumScores'] {
  if (trendData.length < 4) return []
  const midpoint = Math.max(1, Math.floor(trendData.length / 2))
  const previous = trendData.slice(0, midpoint)
  const current = trendData.slice(midpoint)
  const previousResults = sum(previous, (point) => point.bookings)
  const currentResults = sum(current, (point) => point.bookings)
  const score = safeRatio(currentResults - previousResults, Math.max(1, previousResults))
  return [{
    objectId: 'account',
    objectName: 'บัญชีโฆษณา',
    score: score === null ? 0 : round(score * 100, 1),
  }]
}

function buildFormulaDiagnostics({
  confidence,
  fatigueScores,
  momentumScores,
  rawTotals,
  scoreboard,
  wasteScores,
}: {
  confidence: InsightsConfidence
  fatigueScores: InsightsMetrics['fatigueScores']
  momentumScores: InsightsMetrics['momentumScores']
  rawTotals: InsightsRawTotals
  scoreboard: InsightsDerivedMetric[]
  wasteScores: InsightsMetrics['wasteScores']
}): InsightsFormulaDiagnostic[] {
  const cpa = findMetric(scoreboard, 'cpa')
  const roas = findMetric(scoreboard, 'roas')
  const ctr = findMetric(scoreboard, 'ctr')
  const conversionRate = findMetric(scoreboard, 'conversion_rate')
  const topWaste = wasteScores[0]
  const topFatigue = fatigueScores[0]
  const momentum = momentumScores[0]

  return [
    {
      availability: cpa.availability,
      confidence,
      formula: 'CPA = CPC / CVR',
      id: 'diag-cpa-driver',
      key: 'cpa_driver',
      sourceMetricKeys: ['cpa', 'cpc', 'conversion_rate'],
      summary: cpa.value === null ? 'ยังคำนวณ CPA ไม่ได้ เพราะยังไม่มีผลลัพธ์พอ' : `CPA ตอนนี้ ${formatInsightMetricValue(cpa)} โดยมี CTR ${formatInsightMetricValue(ctr)} และ CVR ${formatInsightMetricValue(conversionRate)}`,
      title: 'CPA แพงขึ้นเพราะอะไร',
      tone: cpa.value === null ? 'neutral' : cpa.value > 1200 ? 'critical' : cpa.value > 650 ? 'watch' : 'good',
      value: cpa.value,
    },
    {
      availability: roas.availability,
      confidence,
      formula: 'ROAS = conversion value / spend',
      id: 'diag-roas-driver',
      key: 'roas_driver',
      sourceMetricKeys: ['roas', 'cpa', 'results'],
      summary: roas.value === null ? 'ยังไม่มี conversion value พอสำหรับ ROAS' : `ROAS ตอนนี้ ${formatInsightMetricValue(roas)} จากค่าโฆษณา ${formatMoney(rawTotals.spend)} และมูลค่า ${formatMoney(rawTotals.revenue)}`,
      title: 'ROAS ลดจากอะไร',
      tone: roas.value === null ? 'neutral' : roas.value < 1 ? 'critical' : roas.value < 1.5 ? 'watch' : 'good',
      value: roas.value,
    },
    {
      availability: topFatigue ? 'ready' : 'unavailable',
      confidence,
      formula: 'weighted(rising_frequency, falling_ctr, rising_cpa, falling_roas)',
      id: 'diag-fatigue-score',
      key: 'fatigue_score',
      sourceMetricKeys: ['frequency', 'ctr', 'cpa', 'roas'],
      summary: topFatigue ? `${topFatigue.objectName} มี fatigue score ${topFatigue.score}/100` : 'ยังไม่มีข้อมูลพอสำหรับ fatigue score',
      title: 'Creative fatigue',
      tone: topFatigue && topFatigue.score > 60 ? 'critical' : topFatigue && topFatigue.score > 35 ? 'watch' : 'good',
      value: topFatigue?.score ?? null,
    },
    {
      availability: topWaste ? 'ready' : 'unavailable',
      confidence,
      formula: 'spend_share - result_share',
      id: 'diag-waste-score',
      key: 'waste_score',
      sourceMetricKeys: ['spend', 'results'],
      summary: topWaste ? `${topWaste.objectName} ใช้งบมากกว่าสัดส่วนผลลัพธ์ ${topWaste.score}%` : 'ยังไม่มีข้อมูลพอสำหรับ waste score',
      title: 'Budget waste',
      tone: topWaste && topWaste.score > 20 ? 'critical' : topWaste && topWaste.score > 10 ? 'watch' : 'good',
      value: topWaste?.score ?? null,
    },
    {
      availability: momentum ? 'ready' : 'unavailable',
      confidence,
      formula: 'current_period_results / previous_period_results - 1',
      id: 'diag-momentum',
      key: 'momentum',
      sourceMetricKeys: ['results'],
      summary: momentum ? `Momentum ผลลัพธ์ ${momentum.score > 0 ? '+' : ''}${momentum.score}% เทียบครึ่งช่วงก่อน` : 'ยังไม่มีข้อมูลรายวันพอสำหรับ momentum',
      title: 'Momentum ของ Campaign',
      tone: momentum && momentum.score < -20 ? 'critical' : momentum && momentum.score < 0 ? 'watch' : 'good',
      value: momentum?.score ?? null,
    },
    {
      availability: 'ready',
      confidence,
      formula: 'volume + freshness + attribution + trend stability',
      id: 'diag-data-quality',
      key: 'data_quality',
      sourceMetricKeys: ['spend', 'results', 'ctr'],
      summary: confidence.reasons.join(' · '),
      title: 'Data quality warning',
      tone: confidence.level === 'ต่ำ' ? 'critical' : confidence.level === 'กลาง' ? 'watch' : 'good',
      value: confidence.overall,
    },
  ]
}

function buildEvidenceCards(workspace: WorkspaceData, scoreboard: InsightsDerivedMetric[], confidence: InsightsConfidence): InsightsEvidenceCard[] {
  const dateWindow = workspace.updatedAt ? `ข้อมูลล่าสุด ${formatDateTime(workspace.updatedAt)}` : 'ช่วงข้อมูลที่แสดง'
  const campaignCards = workspace.campaigns
    .slice()
    .sort((left, right) => right.spend - left.spend)
    .slice(0, 2)
    .map((campaign) => {
      const campaignAds = workspace.adInsights.filter((ad) => ad.campaignId === campaign.id)
      return {
        confidence,
        dateWindow,
        formulaResult: `ROAS ${formatDecimal(campaign.roas)}x · CPA ${formatMoney(campaign.cpa)}`,
        id: `evidence-campaign-${campaign.id}`,
        metricValues: buildCampaignEvidenceMetricValues(campaign, campaignAds),
        objectId: campaign.id,
        objectName: campaign.name,
        objectType: 'campaign' as const,
        title: campaign.roas < 1 ? 'Campaign ใช้งบแต่ ROAS ต่ำ' : 'Campaign ที่ควรรักษาจังหวะ',
      }
    })

  const cpa = findMetric(scoreboard, 'cpa')
  const accountCard: InsightsEvidenceCard = {
    confidence,
    dateWindow,
    formulaResult: `สูตรรวม CPA = ${formatInsightMetricValue(cpa)}`,
    id: 'evidence-account-scoreboard',
    metricValues: scoreboard.map((metric) => ({ label: metric.label, value: formatInsightMetricValue(metric) })),
    objectId: 'account',
    objectName: 'บัญชีโฆษณา',
    objectType: 'account',
    title: 'ตัวเลขรวมที่ใช้เป็นฐานวิเคราะห์',
  }

  return [accountCard, ...campaignCards]
}

type CampaignEvidenceMetricSource = {
  conversions: number
  cpa: number
  ctr: number
  frequency: number
  id: string
  roas: number
  spend: number
}

type CampaignEvidenceActivitySource = {
  bookings?: number
  campaignId: string
  clicks: number
  impressions: number
}

function buildCampaignEvidenceMetricValues(
  campaign: CampaignEvidenceMetricSource,
  activityItems: CampaignEvidenceActivitySource[],
): InsightsEvidenceCard['metricValues'] {
  const hasActivity = activityItems.length > 0
  const clicks = hasActivity ? sum(activityItems, (item) => item.clicks) : null
  const impressions = hasActivity ? sum(activityItems, (item) => item.impressions) : null
  const activityBookings = hasActivity ? sum(activityItems, (item) => item.bookings ?? 0) : 0
  const results = finiteOrZero(campaign.conversions) || activityBookings
  const ctr = finiteOrZero(campaign.ctr) || (clicks !== null && impressions !== null ? percentRatio(clicks, impressions) ?? 0 : 0)
  const cvr = clicks !== null ? percentRatio(results, clicks) : null
  const cpm = impressions !== null && impressions > 0 ? (finiteOrZero(campaign.spend) / impressions) * 1000 : null

  return [
    { label: 'Spend', value: formatMoney(finiteOrZero(campaign.spend)) },
    { label: 'Results', value: formatNumber(results) },
    { label: 'Clicks', value: formatOptionalNumber(clicks) },
    { label: 'Impressions', value: formatOptionalNumber(impressions) },
    { label: 'CTR', value: `${formatDecimal(ctr)}%` },
    { label: 'CVR', value: formatOptionalPercent(cvr) },
    { label: 'CPM', value: formatOptionalMoney(cpm) },
    { label: 'Frequency', value: `${formatDecimal(finiteOrZero(campaign.frequency))}x` },
    { label: 'ROAS', value: `${formatDecimal(finiteOrZero(campaign.roas))}x` },
    { label: 'CPA', value: formatMoney(finiteOrZero(campaign.cpa)) },
  ]
}

function buildRecommendations(
  workspace: WorkspaceData,
  evidenceCards: InsightsEvidenceCard[],
  confidence: InsightsConfidence,
  wasteScores: InsightsMetrics['wasteScores'],
  fatigueScores: InsightsMetrics['fatigueScores'],
): InsightsRecommendation[] {
  const topWaste = wasteScores.find((item) => item.score > 10)
  const topFatigue = fatigueScores.find((item) => item.score > 35)
  const evidenceIds = evidenceCards.map((card) => card.id)
  const recommendations: InsightsRecommendation[] = []

  if (topWaste) {
    const adSet = workspace.adSets.find((item) => item.id === topWaste.objectId)
    recommendations.push({
      action: topWaste.score > 20 ? 'reduce_budget' : 'open_workspace',
      confidence,
      evidenceIds,
      id: `insights-rec-waste-${topWaste.objectId}`,
      requiresApproval: confidence.level === 'สูง' && topWaste.score > 20,
      riskNote: 'ตรวจว่าเกิดจาก sample size หรือ tracking issue ก่อนปรับงบ',
      targetId: topWaste.objectId,
      targetName: topWaste.objectName,
      targetType: adSet ? 'adset' : 'campaign',
      title: topWaste.score > 20 ? 'ลดงบ Ad Set ที่ใช้เงินเกินสัดส่วนผลลัพธ์' : 'เปิด Ad Groups เพื่อตรวจงบของชุดโฆษณานี้',
    })
  }

  if (topFatigue) {
    recommendations.push({
      action: 'review_creative',
      confidence,
      evidenceIds,
      id: `insights-rec-fatigue-${topFatigue.objectId}`,
      requiresApproval: false,
      riskNote: 'รีวิวมุม creative ก่อนปิดหรือเปลี่ยนงบ',
      targetId: topFatigue.objectId,
      targetName: topFatigue.objectName,
      targetType: 'campaign',
      title: 'รีวิว creative fatigue และมุมข้อความ',
    })
  }

  if (!recommendations.length) {
    recommendations.push({
      action: 'open_workspace',
      confidence,
      evidenceIds,
      id: 'insights-rec-review-winners',
      requiresApproval: false,
      riskNote: 'เป็นการรีวิวข้อมูล ไม่ส่งคำสั่งไป Meta',
      targetId: 'account',
      targetName: 'บัญชีโฆษณา',
      targetType: 'account',
      title: 'รีวิวผู้ชนะและรักษาจังหวะการใช้งบ',
    })
  }

  return recommendations
}

function scoreInsightsConfidence(workspace: WorkspaceData, totals: InsightsRawTotals): InsightsConfidence {
  let score = 35
  const reasons: string[] = []

  if (totals.impressions >= 5000) {
    score += 15
    reasons.push('impressions เพียงพอ')
  } else {
    reasons.push('impressions ยังน้อย')
  }

  if (totals.clicks >= 80) {
    score += 14
    reasons.push('clicks เพียงพอ')
  } else {
    reasons.push('clicks ยังน้อย')
  }

  if (totals.results >= 10) {
    score += 16
    reasons.push('results พอให้ดูทิศทาง')
  } else {
    reasons.push('results ยังน้อย')
  }

  if (workspace.trendData.length >= 4) {
    score += 10
    reasons.push('มี trend หลายวัน')
  } else {
    reasons.push('trend ยังสั้น')
  }

  if (workspace.updatedAt) {
    score += 10
    reasons.push('มีเวลาซิงก์ล่าสุด')
  } else {
    reasons.push('ยังไม่มีเวลาซิงก์')
  }

  const overall = clamp(score, 20, 95)
  return {
    level: overall >= 75 ? 'สูง' : overall >= 55 ? 'กลาง' : 'ต่ำ',
    overall,
    reasons,
  }
}

function scorePayloadConfidence(payload: InsightsAnalysisPayload): InsightsConfidence {
  const diagnostic = payload.derivedMetrics.formulaDiagnostics.find((item) => item.key === 'data_quality')
  if (diagnostic?.confidence) return diagnostic.confidence
  const totals = payload.rawMetrics.account
  const score = clamp(40 + (totals.impressions > 1000 ? 20 : 0) + (totals.results > 5 ? 20 : 0), 20, 90)
  return { level: score >= 75 ? 'สูง' : score >= 55 ? 'กลาง' : 'ต่ำ', overall: score, reasons: ['คำนวณจาก payload ล่าสุด'] }
}

function findMetric(scoreboard: InsightsDerivedMetric[], key: InsightsMetricKey): InsightsDerivedMetric {
  return scoreboard.find((metric) => metric.key === key) ?? {
    availability: 'unavailable',
    changeRate: null,
    comparisonLabel: 'รอ trend จริงสำหรับเทียบช่วงก่อน',
    formula: key,
    key,
    label: key,
    previousValue: null,
    sourceFields: [],
    value: null,
  }
}

function inferDateWindow(datePreset: string, trendData: WorkspaceData['trendData']): InsightsAnalysisPayload['dateWindow'] {
  const sortedDates = trendData.map((point) => point.date).filter(Boolean).sort()
  const start = sortedDates[0] ?? ''
  const end = sortedDates[sortedDates.length - 1] ?? ''
  return {
    end,
    preset: datePreset,
    previousEnd: '',
    previousStart: '',
    start,
  }
}

function buildEvidenceCardsFromPayload(payload: InsightsAnalysisPayload): InsightsEvidenceCard[] {
  return payload.rawMetrics.campaigns.slice(0, 2).map((campaign) => {
    const campaignAds = payload.rawMetrics.ads.filter((ad) => ad.campaignId === campaign.id)
    return {
      confidence: scorePayloadConfidence(payload),
      dateWindow: payload.dateWindow.preset,
      formulaResult: `ROAS ${formatDecimal(campaign.roas)}x · CPA ${formatMoney(campaign.cpa)}`,
      id: `ai-evidence-${campaign.id}`,
      metricValues: buildCampaignEvidenceMetricValues(campaign, campaignAds),
      objectId: campaign.id,
      objectName: campaign.name,
      objectType: 'campaign',
      title: 'หลักฐานจาก Campaign',
    }
  })
}

function mergeEvidenceMetricValues(cards: InsightsEvidenceCard[] | undefined, fallbackCards: InsightsEvidenceCard[]): InsightsEvidenceCard[] {
  if (!Array.isArray(cards) || !cards.length) return fallbackCards
  return cards.map((card, index) => {
    const fallback = fallbackCards.find((item) => item.objectId === card.objectId && item.objectType === card.objectType) ?? fallbackCards[index]
    if (!fallback) return card
    const mergedMetrics = Array.isArray(card.metricValues) ? [...card.metricValues] : []
    for (const fallbackMetric of fallback.metricValues) {
      const hasMetric = mergedMetrics.some((metric) => normalizeEvidenceMetricLabel(metric.label) === normalizeEvidenceMetricLabel(fallbackMetric.label))
      if (!hasMetric) mergedMetrics.push(fallbackMetric)
    }
    return { ...card, metricValues: mergedMetrics }
  })
}

function normalizeEvidenceMetricLabel(label: string): string {
  const normalized = label.trim().toLowerCase()
  if (normalized === 'conversion rate') return 'cvr'
  if (normalized === 'cpa/cpl') return 'cpa'
  return normalized
}

function buildRecommendationsFromPayload(payload: InsightsAnalysisPayload): InsightsRecommendation[] {
  const confidence = scorePayloadConfidence(payload)
  const evidenceIds = buildEvidenceCardsFromPayload(payload).map((card) => card.id)
  return [{
    action: 'open_workspace',
    confidence,
    evidenceIds,
    id: 'fallback-recommendation-review',
    requiresApproval: false,
    riskNote: 'คำแนะนำ fallback ต้องรีวิวก่อน',
    targetId: 'account',
    targetName: payload.account.name,
    targetType: 'account',
    title: 'ตรวจหลักฐานก่อนปรับแคมเปญ',
  }]
}

function normalizeConfidence(raw: unknown, fallback: InsightsConfidence): InsightsConfidence {
  if (!isRecord(raw)) return fallback
  const overall = clamp(Math.round(finiteOrZero(raw.overall)), 0, 100)
  const level = raw.level === 'สูง' || raw.level === 'กลาง' || raw.level === 'ต่ำ'
    ? raw.level
    : overall >= 75
      ? 'สูง'
      : overall >= 55
        ? 'กลาง'
        : 'ต่ำ'
  return {
    level,
    overall: overall || fallback.overall,
    reasons: cleanStringList(raw.reasons, fallback.reasons),
  }
}

function normalizeDiagnostics(raw: unknown, fallback: InsightsFormulaDiagnostic[], confidence: InsightsConfidence): InsightsFormulaDiagnostic[] {
  if (!Array.isArray(raw)) return fallback
  const normalized = raw.filter(isRecord).map((item, index) => ({
    availability: item.availability === 'unavailable' ? 'unavailable' as const : 'ready' as const,
    confidence,
    formula: cleanText(item.formula, fallback[index]?.formula ?? 'reported metric'),
    id: cleanText(item.id, `ai-diagnostic-${index}`),
    key: isDiagnosticKey(item.key) ? item.key : fallback[index]?.key ?? 'data_quality',
    sourceMetricKeys: Array.isArray(item.sourceMetricKeys) ? item.sourceMetricKeys.filter(isMetricKey) : fallback[index]?.sourceMetricKeys ?? ['spend'],
    summary: cleanText(item.summary, fallback[index]?.summary ?? ''),
    title: cleanText(item.title, fallback[index]?.title ?? 'AI diagnostic'),
    tone: isDiagnosticTone(item.tone) ? item.tone : fallback[index]?.tone ?? 'neutral',
    value: typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : null,
  }))
  return normalized.length ? normalized : fallback
}

function normalizeEvidenceCards(raw: unknown, fallback: InsightsEvidenceCard[], confidence: InsightsConfidence): InsightsEvidenceCard[] {
  if (!Array.isArray(raw)) return fallback
  const normalized = raw.filter(isRecord).map((item, index) => ({
    confidence,
    dateWindow: cleanText(item.dateWindow, fallback[index]?.dateWindow ?? ''),
    formulaResult: cleanText(item.formulaResult, fallback[index]?.formulaResult ?? ''),
    id: cleanText(item.id, `ai-evidence-${index}`),
    metricValues: Array.isArray(item.metricValues) ? item.metricValues.filter(isRecord).map((metric) => ({
      label: cleanText(metric.label, 'Metric'),
      value: cleanText(metric.value, ''),
    })) : fallback[index]?.metricValues ?? [],
    objectId: cleanText(item.objectId, fallback[index]?.objectId ?? 'account'),
    objectName: cleanText(item.objectName, fallback[index]?.objectName ?? 'บัญชีโฆษณา'),
    objectType: isTargetType(item.objectType) ? item.objectType : fallback[index]?.objectType ?? 'account',
    title: cleanText(item.title, fallback[index]?.title ?? 'หลักฐานที่ใช้'),
  }))
  return normalized.length ? mergeEvidenceMetricValues(normalized, fallback) : fallback
}

function normalizeRecommendations(raw: unknown, fallback: InsightsRecommendation[], confidence: InsightsConfidence): InsightsRecommendation[] {
  if (!Array.isArray(raw)) return fallback
  const normalized = raw.filter(isRecord).map((item, index) => ({
    action: isRecommendationAction(item.action) ? item.action : 'open_workspace' as const,
    confidence: normalizeConfidence(item.confidence, confidence),
    evidenceIds: cleanStringList(item.evidenceIds, fallback[index]?.evidenceIds ?? []),
    id: cleanText(item.id, `ai-recommendation-${index}`),
    requiresApproval: item.requiresApproval === true,
    riskNote: cleanText(item.riskNote, 'ต้องรีวิวหลักฐานก่อน'),
    targetId: cleanText(item.targetId, fallback[index]?.targetId ?? 'account'),
    targetName: cleanText(item.targetName, fallback[index]?.targetName ?? cleanText(item.title, 'บัญชีโฆษณา')),
    targetType: isTargetType(item.targetType) ? item.targetType : fallback[index]?.targetType ?? 'account',
    title: cleanText(item.title, cleanText(item.action, 'คำแนะนำที่ควรตรวจ')),
  }))
  return normalized.length ? normalized : fallback
}

function sum<T>(items: T[], getValue: (item: T) => number | undefined): number {
  return items.reduce((total, item) => total + finiteOrZero(getValue(item)), 0)
}

function weightedAverage<T>(items: T[], getValue: (item: T) => number | undefined, getWeight: (item: T) => number | undefined): number {
  const totalWeight = sum(items, getWeight)
  if (totalWeight <= 0) return 0
  return sum(items, (item) => finiteOrZero(getValue(item)) * finiteOrZero(getWeight(item))) / totalWeight
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function percentRatio(numerator: number, denominator: number): number | null {
  const value = safeRatio(numerator, denominator)
  return value === null ? null : value * 100
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function cleanStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  return list.length ? list : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMetricKey(value: unknown): value is InsightsMetricKey {
  return typeof value === 'string' && ['spend', 'results', 'cpa', 'roas', 'ctr', 'cpc', 'cpm', 'frequency', 'conversion_rate'].includes(value)
}

function isDiagnosticKey(value: unknown): value is InsightsFormulaDiagnostic['key'] {
  return typeof value === 'string' && ['cpa_driver', 'roas_driver', 'fatigue_score', 'waste_score', 'momentum', 'data_quality'].includes(value)
}

function isDiagnosticTone(value: unknown): value is InsightsFormulaDiagnostic['tone'] {
  return typeof value === 'string' && ['good', 'watch', 'critical', 'neutral'].includes(value)
}

function isTargetType(value: unknown): value is InsightsTargetType {
  return typeof value === 'string' && ['campaign', 'adset', 'ad', 'account'].includes(value)
}

function isRecommendationAction(value: unknown): value is InsightsRecommendation['action'] {
  return typeof value === 'string' && ['pause', 'reduce_budget', 'review_creative', 'investigate_tracking', 'open_workspace'].includes(value)
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('th-TH', { currency: 'THB', maximumFractionDigits: 0, style: 'currency' }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(value)
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value)
}

function formatOptionalMoney(value: number | null): string {
  return value === null ? 'รอข้อมูล' : formatMoney(value)
}

function formatOptionalNumber(value: number | null): string {
  return value === null ? 'รอข้อมูล' : formatNumber(value)
}

function formatOptionalPercent(value: number | null): string {
  return value === null ? 'รอข้อมูล' : `${formatDecimal(value)}%`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', hour: '2-digit', minute: '2-digit', month: 'short' }).format(date)
}

function formatTrendLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short' }).format(date)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
