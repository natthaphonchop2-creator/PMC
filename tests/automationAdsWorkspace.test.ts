import { describe, expect, it } from 'vitest'
import {
  createDefaultAutomationRules,
  evaluateAutomationRules,
  nextRunLabel,
  schedulePresetLabel,
  validateAutomationRule,
  type AutomationQueueItem,
} from '../src/automationAdsWorkspace'
import type { WorkspaceData } from '../src/types'

describe('automationAdsWorkspace helpers', () => {
  it('creates the approved safe rule presets', () => {
    const rules = createDefaultAutomationRules('2026-05-29T08:00:00.000Z')

    expect(rules.map((rule) => rule.presetType)).toEqual([
      'pause_loser',
      'reduce_budget',
      'increase_winner',
      'flag_fatigue',
      'create_review_task',
    ])
    expect(rules.every((rule) => rule.enabled)).toBe(true)
  })

  it('validates constrained advanced fields before saving', () => {
    const [rule] = createDefaultAutomationRules()
    const result = validateAutomationRule({
      ...rule,
      budgetChangeLimit: 80,
      confidenceThreshold: 120,
      minSpend: -1,
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('งบที่ปรับได้ต้องอยู่ระหว่าง 1-30%')
    expect(result.errors).toContain('ความมั่นใจต้องอยู่ระหว่าง 0-95')
    expect(result.errors).toContain('ค่าใช้จ่ายขั้นต่ำต้องไม่ติดลบ')
  })

  it('creates an auditable manual run even when no queue items are generated', () => {
    const rules = createDefaultAutomationRules().map((rule) => ({ ...rule, enabled: false }))
    const result = evaluateAutomationRules({
      now: '2026-05-29T09:00:00.000Z',
      rules,
      trigger: 'manual',
      workspace: workspaceFixture({ quiet: true }),
    })

    expect(result.queueItems).toHaveLength(0)
    expect(result.run.trigger).toBe('manual')
    expect(result.run.itemsGenerated).toBe(0)
    expect(result.run.status).toBe('completed')
  })

  it('generates approval-gated queue items from active rules', () => {
    const result = evaluateAutomationRules({
      now: '2026-05-29T09:00:00.000Z',
      rules: createDefaultAutomationRules(),
      trigger: 'manual',
      workspace: workspaceFixture(),
    })

    const pauseItem = result.queueItems.find((item) => item.actionType === 'pause_loser')
    const reduceItem = result.queueItems.find((item) => item.actionType === 'reduce_budget')

    expect(pauseItem).toEqual(expect.objectContaining({
      metaWriteEligible: true,
      requiresApproval: true,
      status: 'queued',
      targetType: 'ad',
    }))
    expect(reduceItem).toEqual(expect.objectContaining({
      currentValue: 'งบปัจจุบัน ฿1,500',
      proposedValue: 'ลดงบ 20% เป็น ฿1,200',
      targetType: 'adset',
    }))
    expect(result.run.itemsGenerated).toBe(result.queueItems.length)
  })

  it('blocks write commands when AI is unavailable and keeps deterministic rationale visible', () => {
    const result = evaluateAutomationRules({
      aiAvailable: false,
      now: '2026-05-29T09:00:00.000Z',
      rules: createDefaultAutomationRules(),
      trigger: 'manual',
      workspace: workspaceFixture(),
    })

    const writeItem = result.queueItems.find((item) => item.metaWriteEligible === false && item.actionType === 'pause_loser')
    expect(writeItem).toEqual(expect.objectContaining({
      status: 'blocked',
      blockedReason: 'AI insight ไม่พร้อม จึงให้รีวิวก่อนส่งคำสั่ง Meta',
    }))
    expect(writeItem?.rationale).toContain('ประเมินจากกฎ')
  })

  it('moves conflicting write actions on the same target to conflict review', () => {
    const rules = createDefaultAutomationRules().map((rule) => {
      if (rule.presetType === 'reduce_budget') {
        return { ...rule, cpaThreshold: 50, roasThreshold: 3, minConversions: 1 }
      }
      if (rule.presetType === 'increase_winner') {
        return { ...rule, cpaThreshold: 900, roasThreshold: 0.3, minConversions: 1 }
      }
      return { ...rule, enabled: rule.presetType === 'reduce_budget' || rule.presetType === 'increase_winner' }
    })

    const result = evaluateAutomationRules({
      now: '2026-05-29T09:00:00.000Z',
      rules,
      trigger: 'manual',
      workspace: workspaceFixture(),
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.queueItems.filter((item) => item.status === 'conflict_review')).toHaveLength(2)
  })

  it('skips duplicate active queue items for the same target and rule version', () => {
    const rules = createDefaultAutomationRules()
    const existingQueueItems: AutomationQueueItem[] = [
      {
        actionType: 'pause_loser',
        aiRationale: 'existing',
        confidence: 84,
        createdAt: '2026-05-29T08:00:00.000Z',
        currentValue: 'เปิดอยู่',
        evidence: [],
        id: 'existing-item',
        metaWriteEligible: true,
        proposedValue: 'ปิดโฆษณา',
        rationale: 'existing',
        requiresApproval: true,
        risk: 'medium',
        ruleId: 'rule-pause-loser',
        ruleName: 'พักรายการที่เสียเงิน',
        ruleVersion: 1,
        status: 'queued',
        targetId: 'ad-2',
        targetName: 'Filler Loser',
        targetType: 'ad',
      },
    ]

    const result = evaluateAutomationRules({
      existingQueueItems,
      now: '2026-05-29T09:00:00.000Z',
      rules,
      trigger: 'manual',
      workspace: workspaceFixture(),
    })

    expect(result.queueItems.some((item) => item.targetId === 'ad-2' && item.actionType === 'pause_loser')).toBe(false)
    expect(result.skippedReasons.some((skip) => skip.reason === 'มีคิวที่ยังรออนุมัติอยู่แล้ว')).toBe(true)
  })

  it('formats schedule presets and next run labels for operators', () => {
    expect(schedulePresetLabel('every_6_hours')).toBe('ทุก 6 ชั่วโมง')
    expect(nextRunLabel('manual', '2026-05-29T09:00:00.000Z')).toBe('ตรวจด้วยมือเท่านั้น')
    expect(nextRunLabel('daily', '2026-05-29T09:00:00.000Z')).toContain('พรุ่งนี้')
  })
})

function workspaceFixture(options: { quiet?: boolean } = {}): WorkspaceData {
  const poorRoas = options.quiet ? 1.4 : 0.4
  const poorBookings = options.quiet ? 5 : 1

  return {
    actions: [],
    adInsights: [
      { adSetId: 'set-1', bookings: 8, campaignId: 'cmp-1', clicks: 120, cpc: 10, creative: 'Image', ctr: 4, id: 'ad-1', impressions: 3000, leads: 12, name: 'Botox Winner', roas: 2.6, score: 88, showRate: 60, spend: 1200, status: 'active' },
      { adSetId: 'set-2', bookings: poorBookings, campaignId: 'cmp-2', clicks: 44, cpc: 24, creative: 'Video', ctr: 1.1, id: 'ad-2', impressions: 4000, leads: 3, name: 'Filler Loser', roas: poorRoas, score: 38, showRate: 33, spend: 1050, status: 'active' },
    ],
    adSets: [
      { audience: 'Bangkok Core', bookings: 8, budget: 1500, campaignId: 'cmp-1', cpa: 150, deliveryStatus: 'active', id: 'set-1', name: 'Bangkok Winner', roas: 2.6, spend: 1200, status: 'healthy' },
      { audience: 'Retarget', bookings: poorBookings, budget: 1500, campaignId: 'cmp-2', cpa: options.quiet ? 240 : 520, deliveryStatus: 'active', id: 'set-2', name: 'Retarget Filler', roas: poorRoas, spend: 1300, status: 'watch' },
    ],
    appointmentStages: [],
    auditTrail: [],
    autoAds: [],
    autoMode: 'suggest',
    campaigns: [
      { aiStatus: 'healthy', aiSummary: 'ROAS ดี', budget: 5000, conversions: 8, cpa: 150, ctr: 4, deliveryStatus: 'active', frequency: 2.1, id: 'cmp-1', name: 'Lead Botox', objective: 'Leads', revenue: 3120, roas: 2.6, spend: 1200 },
      { aiStatus: 'watch', aiSummary: 'ต้องจับตา creative fatigue', budget: 3000, conversions: poorBookings, cpa: options.quiet ? 240 : 520, ctr: 1.1, deliveryStatus: 'active', frequency: 4.7, id: 'cmp-2', name: 'Filler Review', objective: 'Leads', revenue: options.quiet ? 1820 : 520, roas: poorRoas, spend: 1300 },
    ],
    channelPerformance: [],
    complianceReviews: [],
    funnelMetrics: [],
    insightComponents: [],
    insights: [],
    memoryItems: [],
    serviceLines: [],
    tasks: [],
    trendData: [],
    updatedAt: '2026-05-29T08:00:00.000Z',
  }
}
