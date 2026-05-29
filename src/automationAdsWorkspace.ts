import type { AdInsight, AdSetInsight, CampaignInsight, WorkspaceData } from './types'

export type AutomationSchedulePreset = 'manual' | 'every_6_hours' | 'daily' | 'business_days'
export type AutomationRulePreset = 'pause_loser' | 'reduce_budget' | 'increase_winner' | 'flag_fatigue' | 'create_review_task'
export type AutomationTargetScope = 'account' | 'campaign' | 'adset' | 'ad'
export type AutomationActionType = AutomationRulePreset
export type AutomationRisk = 'low' | 'medium' | 'high'
export type AutomationQueueStatus = 'queued' | 'approved' | 'rejected' | 'conflict_review' | 'blocked' | 'executed'
export type AutomationRunTrigger = 'manual' | 'scheduled'
export type AutomationRunStatus = 'completed' | 'failed' | 'skipped'
export type AutomationDataFreshness = 'fresh' | 'stale' | 'missing'

export type AutomationRule = {
  id: string
  name: string
  presetType: AutomationRulePreset
  targetScope: AutomationTargetScope
  timeWindow: string
  minSpend: number
  minImpressions: number
  minClicks: number
  minConversions: number
  confidenceThreshold: number
  riskLimit: AutomationRisk
  actionType: AutomationActionType
  budgetChangeLimit: number
  frequencyLimit: number
  cpaThreshold: number
  roasThreshold: number
  wasteScoreThreshold: number
  fatigueScoreThreshold: number
  schedulePreset: AutomationSchedulePreset
  enabled: boolean
  version: number
  updatedAt: string
}

export type AutomationEvidenceMetric = {
  label: string
  value: string
  sourceField: string
}

export type AutomationQueueItem = {
  id: string
  actionType: AutomationActionType
  aiRationale: string
  blockedReason?: string
  confidence: number
  conflictIds?: string[]
  createdAt: string
  currentValue: string
  evidence: AutomationEvidenceMetric[]
  idempotencyKey?: string
  metaWriteEligible: boolean
  proposedValue: string
  rationale: string
  requiresApproval: boolean
  risk: AutomationRisk
  ruleId: string
  ruleName: string
  ruleVersion: number
  runId?: string
  status: AutomationQueueStatus
  targetId: string
  targetName: string
  targetType: AutomationTargetScope
}

export type AutomationConflict = {
  id: string
  itemIds: string[]
  reason: string
  targetId: string
  targetName: string
  targetType: AutomationTargetScope
}

export type AutomationSkippedReason = {
  id: string
  ruleId: string
  targetId?: string
  targetName?: string
  reason: string
}

export type AutomationRunRecord = {
  id: string
  trigger: AutomationRunTrigger
  status: AutomationRunStatus
  startedAt: string
  completedAt: string
  schedulePreset: AutomationSchedulePreset
  dataFreshness: AutomationDataFreshness
  aiAvailable: boolean
  aiInsightTimestamp: string
  ruleVersions: Array<{ id: string; version: number }>
  itemsGenerated: number
  itemsSkipped: number
  conflicts: number
  errors: string[]
  approvedCount: number
  executedCount: number
}

export type AutomationRuleValidation = {
  valid: boolean
  errors: string[]
}

export type AutomationEvaluationInput = {
  aiAvailable?: boolean
  existingQueueItems?: AutomationQueueItem[]
  now?: string
  rules: AutomationRule[]
  schedulePreset?: AutomationSchedulePreset
  trigger: AutomationRunTrigger
  workspace: WorkspaceData
}

export type AutomationEvaluationResult = {
  conflicts: AutomationConflict[]
  queueItems: AutomationQueueItem[]
  run: AutomationRunRecord
  skippedReasons: AutomationSkippedReason[]
}

const WRITE_ACTIONS = new Set<AutomationActionType>(['pause_loser', 'reduce_budget', 'increase_winner'])
const ACTIVE_QUEUE_STATUSES = new Set<AutomationQueueStatus>(['queued', 'approved', 'conflict_review', 'blocked'])
const RISK_ORDER: Record<AutomationRisk, number> = { low: 1, medium: 2, high: 3 }

export function createDefaultAutomationRules(now = new Date().toISOString()): AutomationRule[] {
  return [
    {
      actionType: 'pause_loser',
      budgetChangeLimit: 0,
      confidenceThreshold: 70,
      cpaThreshold: 500,
      enabled: true,
      fatigueScoreThreshold: 80,
      frequencyLimit: 4,
      id: 'rule-pause-loser',
      minClicks: 20,
      minConversions: 1,
      minImpressions: 1000,
      minSpend: 800,
      name: 'พักรายการที่เสียเงิน',
      presetType: 'pause_loser',
      riskLimit: 'medium',
      roasThreshold: 0.8,
      schedulePreset: 'every_6_hours',
      targetScope: 'ad',
      timeWindow: '7 วันล่าสุด',
      updatedAt: now,
      version: 1,
      wasteScoreThreshold: 70,
    },
    {
      actionType: 'reduce_budget',
      budgetChangeLimit: 20,
      confidenceThreshold: 68,
      cpaThreshold: 450,
      enabled: true,
      fatigueScoreThreshold: 70,
      frequencyLimit: 4,
      id: 'rule-reduce-budget',
      minClicks: 20,
      minConversions: 1,
      minImpressions: 1000,
      minSpend: 1000,
      name: 'ลดงบรายการที่เริ่มเปลือง',
      presetType: 'reduce_budget',
      riskLimit: 'medium',
      roasThreshold: 1,
      schedulePreset: 'every_6_hours',
      targetScope: 'adset',
      timeWindow: '7 วันล่าสุด',
      updatedAt: now,
      version: 1,
      wasteScoreThreshold: 60,
    },
    {
      actionType: 'increase_winner',
      budgetChangeLimit: 20,
      confidenceThreshold: 72,
      cpaThreshold: 250,
      enabled: true,
      fatigueScoreThreshold: 60,
      frequencyLimit: 3.5,
      id: 'rule-increase-winner',
      minClicks: 30,
      minConversions: 3,
      minImpressions: 1000,
      minSpend: 1000,
      name: 'เพิ่มงบรายการที่ชนะ',
      presetType: 'increase_winner',
      riskLimit: 'medium',
      roasThreshold: 2,
      schedulePreset: 'daily',
      targetScope: 'adset',
      timeWindow: '7 วันล่าสุด',
      updatedAt: now,
      version: 1,
      wasteScoreThreshold: 35,
    },
    {
      actionType: 'flag_fatigue',
      budgetChangeLimit: 0,
      confidenceThreshold: 60,
      cpaThreshold: 450,
      enabled: true,
      fatigueScoreThreshold: 65,
      frequencyLimit: 3.8,
      id: 'rule-flag-fatigue',
      minClicks: 10,
      minConversions: 0,
      minImpressions: 1000,
      minSpend: 500,
      name: 'แจ้งเตือน Creative fatigue',
      presetType: 'flag_fatigue',
      riskLimit: 'low',
      roasThreshold: 1.1,
      schedulePreset: 'daily',
      targetScope: 'campaign',
      timeWindow: '7 วันล่าสุด',
      updatedAt: now,
      version: 1,
      wasteScoreThreshold: 45,
    },
    {
      actionType: 'create_review_task',
      budgetChangeLimit: 0,
      confidenceThreshold: 45,
      cpaThreshold: 0,
      enabled: true,
      fatigueScoreThreshold: 0,
      frequencyLimit: 0,
      id: 'rule-create-review-task',
      minClicks: 0,
      minConversions: 0,
      minImpressions: 0,
      minSpend: 0,
      name: 'สร้างงานรีวิวเมื่อข้อมูลไม่พร้อม',
      presetType: 'create_review_task',
      riskLimit: 'low',
      roasThreshold: 0,
      schedulePreset: 'business_days',
      targetScope: 'account',
      timeWindow: '7 วันล่าสุด',
      updatedAt: now,
      version: 1,
      wasteScoreThreshold: 0,
    },
  ]
}

export function validateAutomationRule(rule: AutomationRule): AutomationRuleValidation {
  const errors: string[] = []

  if (rule.minSpend < 0) errors.push('ค่าใช้จ่ายขั้นต่ำต้องไม่ติดลบ')
  if (rule.minImpressions < 0) errors.push('Impressions ขั้นต่ำต้องไม่ติดลบ')
  if (rule.minClicks < 0) errors.push('Clicks ขั้นต่ำต้องไม่ติดลบ')
  if (rule.minConversions < 0) errors.push('Conversions ขั้นต่ำต้องไม่ติดลบ')
  if (rule.confidenceThreshold < 0 || rule.confidenceThreshold > 95) errors.push('ความมั่นใจต้องอยู่ระหว่าง 0-95')
  if (!['low', 'medium', 'high'].includes(rule.riskLimit)) errors.push('ระดับความเสี่ยงไม่ถูกต้อง')
  if (rule.budgetChangeLimit < 0 || rule.budgetChangeLimit > 30 || (WRITE_ACTIONS.has(rule.actionType) && rule.actionType !== 'pause_loser' && rule.budgetChangeLimit < 1)) {
    errors.push('งบที่ปรับได้ต้องอยู่ระหว่าง 1-30%')
  }
  if (rule.frequencyLimit < 0) errors.push('Frequency limit ต้องไม่ติดลบ')
  if (rule.cpaThreshold < 0) errors.push('CPA/CPL threshold ต้องไม่ติดลบ')
  if (rule.roasThreshold < 0) errors.push('ROAS threshold ต้องไม่ติดลบ')
  if (rule.wasteScoreThreshold < 0 || rule.wasteScoreThreshold > 100) errors.push('Waste score ต้องอยู่ระหว่าง 0-100')
  if (rule.fatigueScoreThreshold < 0 || rule.fatigueScoreThreshold > 100) errors.push('Fatigue score ต้องอยู่ระหว่าง 0-100')

  return { errors, valid: errors.length === 0 }
}

export function evaluateAutomationRules(input: AutomationEvaluationInput): AutomationEvaluationResult {
  const now = input.now ?? new Date().toISOString()
  const aiAvailable = input.aiAvailable ?? true
  const schedulePreset = input.schedulePreset ?? firstEnabledSchedule(input.rules)
  const freshness = dataFreshness(input.workspace.updatedAt, now)
  const skippedReasons: AutomationSkippedReason[] = []
  const queueItems: AutomationQueueItem[] = []

  const runId = createRunId(now)

  for (const rule of input.rules) {
    if (!rule.enabled) continue

    const validation = validateAutomationRule(rule)
    if (!validation.valid) {
      skippedReasons.push({
        id: `skip-${rule.id}-invalid`,
        reason: validation.errors.join(', '),
        ruleId: rule.id,
      })
      continue
    }

    const candidates = evaluateRule(rule, input.workspace, now, aiAvailable, freshness)
    for (const candidate of candidates) {
      const duplicate = findDuplicateQueueItem(candidate, input.existingQueueItems ?? [])
      if (duplicate) {
        skippedReasons.push({
          id: `skip-${candidate.id}`,
          reason: 'มีคิวที่ยังรออนุมัติอยู่แล้ว',
          ruleId: rule.id,
          targetId: candidate.targetId,
          targetName: candidate.targetName,
        })
        continue
      }
      queueItems.push({ ...candidate, runId })
    }
  }

  const conflicts = markConflicts(queueItems)
  const run = createAutomationRunRecord({
    aiAvailable,
    conflicts,
    now,
    queueItems,
    rules: input.rules,
    schedulePreset,
    skippedReasons,
    trigger: input.trigger,
    workspace: input.workspace,
  })

  return { conflicts, queueItems, run, skippedReasons }
}

export function buildAutomationQueueItem(input: {
  actionType: AutomationActionType
  aiAvailable: boolean
  blockedReason?: string
  confidence: number
  currentValue: string
  evidence: AutomationEvidenceMetric[]
  metaWriteEligible: boolean
  now: string
  proposedValue: string
  rationale: string
  risk: AutomationRisk
  rule: AutomationRule
  status?: AutomationQueueStatus
  targetId: string
  targetName: string
  targetType: AutomationTargetScope
}): AutomationQueueItem {
  const writeAction = WRITE_ACTIONS.has(input.actionType)
  const blockedByConfidence = writeAction && input.confidence < input.rule.confidenceThreshold
  const blockedByRisk = writeAction && RISK_ORDER[input.risk] > RISK_ORDER[input.rule.riskLimit]
  const blockedReason =
    input.blockedReason ??
    (blockedByConfidence ? 'ความมั่นใจต่ำกว่าเงื่อนไขที่ตั้งไว้' : undefined) ??
    (blockedByRisk ? 'ความเสี่ยงสูงกว่าเพดานที่ตั้งไว้' : undefined)
  const status = input.status ?? (blockedReason ? 'blocked' : 'queued')
  const metaWriteEligible = input.metaWriteEligible && status === 'queued'

  return {
    actionType: input.actionType,
    aiRationale: input.aiAvailable ? 'AI insight พร้อมใช้ประกอบเหตุผลและลำดับความสำคัญ' : 'AI insight ไม่พร้อม ใช้กฎ deterministic และบล็อกคำสั่งเขียนไว้ก่อน',
    blockedReason,
    confidence: clamp(Math.round(input.confidence), 0, 95),
    createdAt: input.now,
    currentValue: input.currentValue,
    evidence: input.evidence,
    id: `auto-${compactStamp(input.now)}-${input.rule.id}-${input.targetType}-${input.targetId}`,
    idempotencyKey: `${input.rule.id}:${input.rule.version}:${input.actionType}:${input.targetType}:${input.targetId}`,
    metaWriteEligible,
    proposedValue: input.proposedValue,
    rationale: input.rationale,
    requiresApproval: writeAction,
    risk: input.risk,
    ruleId: input.rule.id,
    ruleName: input.rule.name,
    ruleVersion: input.rule.version,
    status,
    targetId: input.targetId,
    targetName: input.targetName,
    targetType: input.targetType,
  }
}

export function createAutomationRunRecord(input: {
  aiAvailable: boolean
  conflicts: AutomationConflict[]
  now: string
  queueItems: AutomationQueueItem[]
  rules: AutomationRule[]
  schedulePreset: AutomationSchedulePreset
  skippedReasons: AutomationSkippedReason[]
  trigger: AutomationRunTrigger
  workspace: WorkspaceData
}): AutomationRunRecord {
  return {
    aiAvailable: input.aiAvailable,
    aiInsightTimestamp: input.aiAvailable ? input.now : 'ไม่พร้อม',
    approvedCount: input.queueItems.filter((item) => item.status === 'approved').length,
    completedAt: input.now,
    conflicts: input.conflicts.length,
    dataFreshness: dataFreshness(input.workspace.updatedAt, input.now),
    errors: [],
    executedCount: input.queueItems.filter((item) => item.status === 'executed').length,
    id: createRunId(input.now),
    itemsGenerated: input.queueItems.length,
    itemsSkipped: input.skippedReasons.length,
    ruleVersions: input.rules.filter((rule) => rule.enabled).map((rule) => ({ id: rule.id, version: rule.version })),
    schedulePreset: input.schedulePreset,
    startedAt: input.now,
    status: 'completed',
    trigger: input.trigger,
  }
}

export function schedulePresetLabel(preset: AutomationSchedulePreset): string {
  const labels: Record<AutomationSchedulePreset, string> = {
    business_days: 'วันทำการ',
    daily: 'ทุกวัน',
    every_6_hours: 'ทุก 6 ชั่วโมง',
    manual: 'ตรวจด้วยมือเท่านั้น',
  }
  return labels[preset]
}

export function nextRunLabel(preset: AutomationSchedulePreset, now = new Date().toISOString()): string {
  if (preset === 'manual') return 'ตรวจด้วยมือเท่านั้น'

  const date = new Date(now)
  if (Number.isNaN(date.getTime())) return schedulePresetLabel(preset)

  if (preset === 'every_6_hours') {
    date.setHours(date.getHours() + 6)
    return `รอบถัดไป ${formatThaiDateTime(date)}`
  }
  if (preset === 'business_days') return 'รอบถัดไปวันทำการถัดไป 09:00'

  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return `พรุ่งนี้ ${formatThaiDateTime(date)}`
}

export function automationQueueStatusLabel(status: AutomationQueueStatus): string {
  const labels: Record<AutomationQueueStatus, string> = {
    approved: 'อนุมัติแล้ว',
    blocked: 'บล็อกไว้ก่อน',
    conflict_review: 'ต้องตรวจ conflict',
    executed: 'ส่งแล้ว',
    queued: 'รออนุมัติ',
    rejected: 'ปฏิเสธแล้ว',
  }
  return labels[status]
}

export function automationRiskLabel(risk: AutomationRisk): string {
  const labels: Record<AutomationRisk, string> = {
    high: 'สูง',
    low: 'ต่ำ',
    medium: 'กลาง',
  }
  return labels[risk]
}

export function automationActionLabel(action: AutomationActionType): string {
  const labels: Record<AutomationActionType, string> = {
    create_review_task: 'สร้างงานรีวิว',
    flag_fatigue: 'แจ้งเตือน Fatigue',
    increase_winner: 'เพิ่มงบผู้ชนะ',
    pause_loser: 'พักโฆษณาที่เสียเงิน',
    reduce_budget: 'ลดงบรายการเปลือง',
  }
  return labels[action]
}

export function automationFreshnessLabel(freshness: AutomationDataFreshness): string {
  const labels: Record<AutomationDataFreshness, string> = {
    fresh: 'ข้อมูลล่าสุดพร้อมตรวจ',
    missing: 'ยังไม่มีเวลาซิงก์ข้อมูล',
    stale: 'ข้อมูลอาจไม่ล่าสุด',
  }
  return labels[freshness]
}

function evaluateRule(
  rule: AutomationRule,
  workspace: WorkspaceData,
  now: string,
  aiAvailable: boolean,
  freshness: AutomationDataFreshness,
): AutomationQueueItem[] {
  switch (rule.presetType) {
    case 'pause_loser':
      return workspace.adInsights.flatMap((ad) => evaluatePauseLoser(rule, ad, now, aiAvailable, freshness))
    case 'reduce_budget':
      return workspace.adSets.flatMap((adSet) => evaluateBudgetRule(rule, adSet, workspace, now, aiAvailable, freshness, 'reduce_budget'))
    case 'increase_winner':
      return workspace.adSets.flatMap((adSet) => evaluateBudgetRule(rule, adSet, workspace, now, aiAvailable, freshness, 'increase_winner'))
    case 'flag_fatigue':
      return workspace.campaigns.flatMap((campaign) => evaluateFatigue(rule, campaign, now, aiAvailable))
    case 'create_review_task':
      return evaluateReviewTask(rule, workspace, now, aiAvailable, freshness)
  }
}

function evaluatePauseLoser(
  rule: AutomationRule,
  ad: AdInsight,
  now: string,
  aiAvailable: boolean,
  freshness: AutomationDataFreshness,
): AutomationQueueItem[] {
  if (ad.status !== 'active') return []
  if (ad.spend < rule.minSpend || ad.impressions < rule.minImpressions || ad.clicks < rule.minClicks) return []

  const cpa = safeRatio(ad.spend, ad.bookings)
  const wasteScore = calculateWasteScore({ cpa, cpaThreshold: rule.cpaThreshold, roas: ad.roas, roasThreshold: rule.roasThreshold, spend: ad.spend })
  const qualifies = ad.bookings <= rule.minConversions || ad.roas <= rule.roasThreshold || cpa === null || cpa >= rule.cpaThreshold || wasteScore >= rule.wasteScoreThreshold
  if (!qualifies) return []

  const confidence = candidateConfidence({
    aiAvailable,
    clicks: ad.clicks,
    conversions: ad.bookings,
    freshness,
    impressions: ad.impressions,
    spend: ad.spend,
  })
  const blockedReason = writeBlockedReason(aiAvailable, freshness)

  return [
    buildAutomationQueueItem({
      actionType: 'pause_loser',
      aiAvailable,
      blockedReason,
      confidence,
      currentValue: 'เปิดอยู่',
      evidence: [
        metric('ใช้จ่าย', formatMoney(ad.spend), 'ad.spend'),
        metric('ROAS', formatNumber(ad.roas), 'ad.roas'),
        metric('CPA', cpa === null ? 'ยังไม่มี booking' : formatMoney(cpa), 'ad.spend/ad.bookings'),
        metric('Waste score', `${wasteScore}/100`, 'computed.wasteScore'),
      ],
      metaWriteEligible: true,
      now,
      proposedValue: 'ปิดโฆษณา',
      rationale: `ประเมินจากกฎ: ใช้จ่าย ${formatMoney(ad.spend)} แต่ ROAS ${formatNumber(ad.roas)} และ booking ${ad.bookings} ต่ำกว่าเงื่อนไข`,
      risk: ad.bookings === 0 ? 'high' : 'medium',
      rule,
      targetId: ad.id,
      targetName: ad.name,
      targetType: 'ad',
    }),
  ]
}

function evaluateBudgetRule(
  rule: AutomationRule,
  adSet: AdSetInsight,
  workspace: WorkspaceData,
  now: string,
  aiAvailable: boolean,
  freshness: AutomationDataFreshness,
  actionType: 'reduce_budget' | 'increase_winner',
): AutomationQueueItem[] {
  if (adSet.deliveryStatus !== 'active') return []
  if (adSet.spend < rule.minSpend || adSet.bookings < rule.minConversions) return []

  const campaign = workspace.campaigns.find((item) => item.id === adSet.campaignId)
  const cpa = safeRatio(adSet.spend, adSet.bookings)
  const fatigueScore = calculateFatigueScore(campaign)
  const wasteScore = calculateWasteScore({ cpa, cpaThreshold: rule.cpaThreshold, roas: adSet.roas, roasThreshold: rule.roasThreshold, spend: adSet.spend })
  const confidence = candidateConfidence({
    aiAvailable,
    clicks: Math.max(rule.minClicks, adSet.bookings * 12),
    conversions: adSet.bookings,
    freshness,
    impressions: Math.max(rule.minImpressions, adSet.bookings * 400),
    spend: adSet.spend,
  })
  const blockedReason = writeBlockedReason(aiAvailable, freshness)

  if (actionType === 'reduce_budget') {
    const qualifies = adSet.cpa >= rule.cpaThreshold || adSet.roas <= rule.roasThreshold || wasteScore >= rule.wasteScoreThreshold
    if (!qualifies) return []

    const nextBudget = Math.max(0, Math.round(adSet.budget * (1 - rule.budgetChangeLimit / 100)))
    return [
      buildAutomationQueueItem({
        actionType,
        aiAvailable,
        blockedReason,
        confidence,
        currentValue: `งบปัจจุบัน ${formatMoney(adSet.budget)}`,
        evidence: [
          metric('ใช้จ่าย', formatMoney(adSet.spend), 'adSet.spend'),
          metric('CPA', formatMoney(adSet.cpa), 'adSet.cpa'),
          metric('ROAS', formatNumber(adSet.roas), 'adSet.roas'),
          metric('Waste score', `${wasteScore}/100`, 'computed.wasteScore'),
        ],
        metaWriteEligible: true,
        now,
        proposedValue: `ลดงบ ${rule.budgetChangeLimit}% เป็น ${formatMoney(nextBudget)}`,
        rationale: `ประเมินจากกฎ: CPA ${formatMoney(adSet.cpa)} หรือ ROAS ${formatNumber(adSet.roas)} ยังต่ำกว่าเพดานที่ตั้งไว้`,
        risk: rule.budgetChangeLimit > 20 ? 'high' : 'medium',
        rule,
        targetId: adSet.id,
        targetName: adSet.name,
        targetType: 'adset',
      }),
    ]
  }

  const qualifies = adSet.cpa <= rule.cpaThreshold && adSet.roas >= rule.roasThreshold && fatigueScore < rule.fatigueScoreThreshold && (!campaign || campaign.frequency <= rule.frequencyLimit)
  if (!qualifies) return []

  const nextBudget = Math.round(adSet.budget * (1 + rule.budgetChangeLimit / 100))
  return [
    buildAutomationQueueItem({
      actionType,
      aiAvailable,
      blockedReason,
      confidence,
      currentValue: `งบปัจจุบัน ${formatMoney(adSet.budget)}`,
      evidence: [
        metric('Bookings', `${adSet.bookings}`, 'adSet.bookings'),
        metric('CPA', formatMoney(adSet.cpa), 'adSet.cpa'),
        metric('ROAS', formatNumber(adSet.roas), 'adSet.roas'),
        metric('Fatigue score', `${fatigueScore}/100`, 'computed.fatigueScore'),
      ],
      metaWriteEligible: true,
      now,
      proposedValue: `เพิ่มงบ ${rule.budgetChangeLimit}% เป็น ${formatMoney(nextBudget)}`,
      rationale: `ประเมินจากกฎ: ROAS ${formatNumber(adSet.roas)} และ CPA ${formatMoney(adSet.cpa)} ผ่านเงื่อนไขสำหรับ scale`,
      risk: rule.budgetChangeLimit > 20 ? 'medium' : 'low',
      rule,
      targetId: adSet.id,
      targetName: adSet.name,
      targetType: 'adset',
    }),
  ]
}

function evaluateFatigue(rule: AutomationRule, campaign: CampaignInsight, now: string, aiAvailable: boolean): AutomationQueueItem[] {
  if (campaign.spend < rule.minSpend) return []
  const fatigueScore = calculateFatigueScore(campaign)
  const qualifies = campaign.frequency >= rule.frequencyLimit || fatigueScore >= rule.fatigueScoreThreshold
  if (!qualifies) return []

  return [
    buildAutomationQueueItem({
      actionType: 'flag_fatigue',
      aiAvailable,
      confidence: clamp(55 + fatigueScore / 2, 0, 95),
      currentValue: `Frequency ${formatNumber(campaign.frequency)} / CTR ${formatNumber(campaign.ctr)}%`,
      evidence: [
        metric('Frequency', formatNumber(campaign.frequency), 'campaign.frequency'),
        metric('CTR', `${formatNumber(campaign.ctr)}%`, 'campaign.ctr'),
        metric('ROAS', formatNumber(campaign.roas), 'campaign.roas'),
        metric('Fatigue score', `${fatigueScore}/100`, 'computed.fatigueScore'),
      ],
      metaWriteEligible: false,
      now,
      proposedValue: 'สร้างรายการตรวจ Creative fatigue',
      rationale: `ประเมินจากกฎ: Frequency ${formatNumber(campaign.frequency)} สูงและ CTR ${formatNumber(campaign.ctr)}% เริ่มอ่อนลง`,
      risk: 'low',
      rule,
      targetId: campaign.id,
      targetName: campaign.name,
      targetType: 'campaign',
    }),
  ]
}

function evaluateReviewTask(
  rule: AutomationRule,
  workspace: WorkspaceData,
  now: string,
  aiAvailable: boolean,
  freshness: AutomationDataFreshness,
): AutomationQueueItem[] {
  const needsReview = freshness !== 'fresh' || workspace.adInsights.length === 0 || workspace.adSets.length === 0
  if (!needsReview) return []

  return [
    buildAutomationQueueItem({
      actionType: 'create_review_task',
      aiAvailable,
      confidence: aiAvailable ? 65 : 45,
      currentValue: automationFreshnessLabel(freshness),
      evidence: [
        metric('Ads', `${workspace.adInsights.length}`, 'workspace.adInsights.length'),
        metric('Ad Sets', `${workspace.adSets.length}`, 'workspace.adSets.length'),
        metric('Meta synced at', workspace.updatedAt || 'ไม่พบเวลา sync', 'workspace.updatedAt'),
      ],
      metaWriteEligible: false,
      now,
      proposedValue: 'สร้างงานตรวจข้อมูลก่อนสั่ง Automation',
      rationale: 'ประเมินจากกฎ: ข้อมูลไม่พร้อมสำหรับคำสั่งเขียน จึงสร้างงานรีวิวแทน',
      risk: 'low',
      rule,
      targetId: 'account',
      targetName: 'บัญชีโฆษณา',
      targetType: 'account',
    }),
  ]
}

function findDuplicateQueueItem(candidate: AutomationQueueItem, existingQueueItems: AutomationQueueItem[]): AutomationQueueItem | undefined {
  return existingQueueItems.find((item) => {
    if (!ACTIVE_QUEUE_STATUSES.has(item.status)) return false
    return item.ruleId === candidate.ruleId && item.ruleVersion === candidate.ruleVersion && item.actionType === candidate.actionType && item.targetType === candidate.targetType && item.targetId === candidate.targetId
  })
}

function markConflicts(queueItems: AutomationQueueItem[]): AutomationConflict[] {
  const conflicts: AutomationConflict[] = []
  const itemsByTarget = new Map<string, AutomationQueueItem[]>()

  for (const item of queueItems) {
    if (!WRITE_ACTIONS.has(item.actionType) || item.status === 'blocked') continue
    const key = `${item.targetType}:${item.targetId}`
    itemsByTarget.set(key, [...(itemsByTarget.get(key) ?? []), item])
  }

  for (const items of itemsByTarget.values()) {
    const actionTypes = new Set(items.map((item) => item.actionType))
    if (actionTypes.size < 2) continue

    const conflictId = `conflict-${items[0].targetType}-${items[0].targetId}`
    for (const item of items) {
      item.status = 'conflict_review'
      item.metaWriteEligible = false
      item.conflictIds = [...(item.conflictIds ?? []), conflictId]
    }
    conflicts.push({
      id: conflictId,
      itemIds: items.map((item) => item.id),
      reason: 'พบหลายคำสั่งเขียนบนเป้าหมายเดียวกัน ต้องตรวจและเลือกคำสั่งเดียว',
      targetId: items[0].targetId,
      targetName: items[0].targetName,
      targetType: items[0].targetType,
    })
  }

  return conflicts
}

function writeBlockedReason(aiAvailable: boolean, freshness: AutomationDataFreshness): string | undefined {
  if (!aiAvailable) return 'AI insight ไม่พร้อม จึงให้รีวิวก่อนส่งคำสั่ง Meta'
  if (freshness !== 'fresh') return 'ข้อมูล Meta อาจไม่ล่าสุด จึงบล็อกคำสั่งเขียนไว้ก่อน'
  return undefined
}

function dataFreshness(updatedAt: string, now: string): AutomationDataFreshness {
  if (!updatedAt) return 'missing'
  const updatedTime = new Date(updatedAt).getTime()
  const nowTime = new Date(now).getTime()
  if (!Number.isFinite(updatedTime) || !Number.isFinite(nowTime)) return 'missing'
  return nowTime - updatedTime > 24 * 60 * 60 * 1000 ? 'stale' : 'fresh'
}

function firstEnabledSchedule(rules: AutomationRule[]): AutomationSchedulePreset {
  return rules.find((rule) => rule.enabled)?.schedulePreset ?? 'manual'
}

function createRunId(now: string): string {
  return `auto-run-${compactStamp(now)}`
}

function compactStamp(now: string): string {
  return now.replace(/[^0-9]/g, '').slice(0, 14) || 'now'
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return numerator / denominator
}

function candidateConfidence(input: {
  aiAvailable: boolean
  clicks: number
  conversions: number
  freshness: AutomationDataFreshness
  impressions: number
  spend: number
}): number {
  const score =
    48 +
    Math.min(input.spend / 2000, 1) * 14 +
    Math.min(input.clicks / 100, 1) * 10 +
    Math.min(input.impressions / 5000, 1) * 8 +
    Math.min(input.conversions, 5) * 4 +
    (input.aiAvailable ? 10 : -8) +
    (input.freshness === 'fresh' ? 8 : -15)

  return clamp(score, 0, 95)
}

function calculateWasteScore(input: {
  cpa: number | null
  cpaThreshold: number
  roas: number
  roasThreshold: number
  spend: number
}): number {
  const cpaPressure = input.cpa === null ? 40 : clamp((input.cpa / Math.max(input.cpaThreshold, 1)) * 35, 0, 45)
  const roasPressure = input.roasThreshold <= 0 ? 0 : clamp(((input.roasThreshold - input.roas) / input.roasThreshold) * 35, 0, 35)
  const spendPressure = clamp(input.spend / 2000, 0, 1) * 20
  return Math.round(clamp(cpaPressure + roasPressure + spendPressure, 0, 100))
}

function calculateFatigueScore(campaign?: CampaignInsight): number {
  if (!campaign) return 0
  const frequencyPressure = clamp((campaign.frequency - 2) * 18, 0, 45)
  const ctrPressure = clamp((2 - campaign.ctr) * 18, 0, 30)
  const roasPressure = clamp((1.2 - campaign.roas) * 20, 0, 25)
  return Math.round(clamp(frequencyPressure + ctrPressure + roasPressure, 0, 100))
}

function metric(label: string, value: string, sourceField: string): AutomationEvidenceMetric {
  return { label, sourceField, value }
}

function formatMoney(value: number): string {
  return `฿${Math.round(value).toLocaleString('th-TH')}`
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : '0'
}

function formatThaiDateTime(date: Date): string {
  return date.toLocaleString('th-TH', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
