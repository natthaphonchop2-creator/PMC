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

type DriverMeta = {
  description: string
  id: InsightsRiverDriverKey
  label: string
  metricKey: InsightsMetricKey
}

type OutcomeMeta = {
  id: InsightsRiverOutcomeKey
  label: string
  metricKey: InsightsMetricKey
}

const DRIVER_META: DriverMeta[] = [
  { description: 'Total amount spent', id: 'spend', label: 'Spend', metricKey: 'spend' },
  { description: 'Cost per 1,000 impressions', id: 'cpm', label: 'CPM', metricKey: 'cpm' },
  { description: 'Click-through rate', id: 'ctr', label: 'CTR', metricKey: 'ctr' },
  { description: 'Conversion rate', id: 'conversion_rate', label: 'CVR', metricKey: 'conversion_rate' },
  { description: 'Avg. frequency and fatigue risk', id: 'frequency', label: 'Frequency / Fatigue', metricKey: 'frequency' },
]

const OUTCOME_META: OutcomeMeta[] = [
  { id: 'cpa', label: 'CPA/CPL', metricKey: 'cpa' },
  { id: 'roas', label: 'ROAS', metricKey: 'roas' },
]

export function buildInsightsDecisionRiverModel({ insight, metrics }: BuildModelInput): InsightsDecisionRiverModel {
  const evidenceCards = insight.evidenceCards.length ? insight.evidenceCards : metrics.evidenceCards
  const drivers = DRIVER_META.map((driver) => buildDriverLane(driver, metrics, evidenceCards))
  const outcomes = OUTCOME_META.map((outcome) => buildOutcome(outcome, metrics))

  return {
    caveats: buildCaveats(insight, metrics),
    defaultDriverId: pickDefaultDriver(drivers),
    drivers,
    evidenceCounts: countEvidence(evidenceCards),
    outcomes,
    signalCounts: countSignals(insight, metrics),
  }
}

export function pressureToneForDriver(metricKey: InsightsRiverDriverKey, changeRate: number | null): InsightsRiverPressure {
  if (changeRate === null || Math.abs(changeRate) < 0.03) return { direction: 'flat', label: 'Neutral', tone: 'neutral' }

  const direction: InsightsRiverDirection = changeRate > 0 ? 'up' : 'down'
  const reliefWhenUp = metricKey === 'ctr' || metricKey === 'conversion_rate'
  const isPressure = changeRate > 0 ? !reliefWhenUp : reliefWhenUp
  if (!isPressure) return { direction, label: 'Relief', tone: 'good' }

  return {
    direction,
    label: 'Pressure',
    tone: metricKey === 'ctr' || metricKey === 'conversion_rate' ? 'critical' : 'watch',
  }
}

function buildDriverLane(driver: DriverMeta, metrics: InsightsMetrics, evidenceCards: InsightsEvidenceCard[]): InsightsRiverLane {
  const metric = findMetric(metrics.scoreboard, driver.metricKey)
  const evidenceIds = evidenceCards.slice(0, 3).map((card) => card.id)
  if (metric.availability === 'unavailable') {
    return {
      changeLabel: 'รอข้อมูล',
      description: driver.description,
      evidenceIds,
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
    evidenceIds,
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

function buildOutcome(outcome: OutcomeMeta, metrics: InsightsMetrics): InsightsRiverOutcome {
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

  const changeRate = metric.changeRate ?? 0
  const isFlat = Math.abs(changeRate) < 0.03
  const improving = outcome.id === 'roas' ? changeRate > 0 : changeRate < 0
  const tone: InsightsRiverTone = isFlat ? 'neutral' : improving ? 'good' : 'critical'

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
  const pressurePriority: InsightsRiverDriverKey[] = ['cpm', 'conversion_rate', 'frequency', 'ctr', 'spend']
  const pressured = pressurePriority.find((driverId) => {
    const driver = drivers.find((item) => item.id === driverId)
    return driver?.tone === 'critical' || driver?.tone === 'watch'
  })
  return pressured ?? drivers.find((driver) => driver.tone === 'good')?.id ?? 'cpm'
}

function findMetric(metrics: InsightsDerivedMetric[], key: InsightsMetricKey): InsightsDerivedMetric {
  const metric = metrics.find((item) => item.key === key)
  if (!metric) throw new Error(`Missing Insights metric: ${key}`)
  return metric
}

function sparklineForMetric(metrics: InsightsMetrics, key: InsightsMetricKey): number[] {
  return metrics.trends
    .map((point) => {
      switch (key) {
        case 'spend':
        case 'results':
        case 'cpa':
        case 'roas':
        case 'ctr':
        case 'cpc':
        case 'frequency':
          return point[key]
        case 'cpm':
          return point.cpc !== null && point.ctr !== null ? point.cpc * point.ctr * 10 : null
        case 'conversion_rate': {
          const clicks = point.cpc !== null ? safeRatio(point.spend, point.cpc) : null
          const conversionRate = clicks !== null ? safeRatio(point.results, clicks) : null
          return conversionRate !== null ? conversionRate * 100 : null
        }
      }
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

function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return numerator / denominator
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
  return Array.from(new Set([
    'Data from connected Meta workspace.',
    insight.payload.attribution.setting,
    ...insight.dataWarnings,
    ...metrics.dataWarnings,
  ].filter(Boolean))).slice(0, 4)
}
