import { describe, expect, it } from 'vitest'
import { applyOptimizerAiDecisionToPlan } from '../src/App'

describe('Optimizer plan logic', () => {
  it('turns duplicate pause advice for an already paused ad into a non-writable review item', () => {
    const plan = applyOptimizerAiDecisionToPlan(autoAdPlan({ ad: ad({ status: 'paused' }) }), {
      adId: 'ad-1',
      actionLabel: 'ปิดโฆษณา',
      conditionAnalysis: 'AI เห็นว่า spend สูง',
      confidence: 86,
      decision: 'pause',
      guardrail: 'ตรวจ tracking ก่อน',
      nextStep: 'ส่งคำสั่ง PAUSED',
      reason: 'ควรปิดโฆษณา',
      risk: 'High',
    })

    expect(plan.decision).toBe('watch')
    expect(plan.targetStatus).toBeUndefined()
    expect(plan.canQueue).toBe(false)
    expect(plan.blockedReason).toContain('พักอยู่แล้ว')
    expect(plan.reason).toContain('พักอยู่แล้ว')
  })

  it('keeps pause advice writable when the ad is currently active', () => {
    const plan = applyOptimizerAiDecisionToPlan(autoAdPlan({ ad: ad({ status: 'active' }) }), {
      adId: 'ad-1',
      actionLabel: 'ปิดโฆษณา',
      conditionAnalysis: 'AI เห็นว่า spend สูง',
      confidence: 86,
      decision: 'pause',
      guardrail: 'ตรวจ tracking ก่อน',
      nextStep: 'ส่งคำสั่ง PAUSED',
      reason: 'ควรปิดโฆษณา',
      risk: 'High',
    })

    expect(plan.decision).toBe('pause')
    expect(plan.targetStatus).toBe('PAUSED')
    expect(plan.canQueue).toBe(true)
  })
})

function autoAdPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    ad: ad(),
    decision: 'watch',
    label: 'Ad 1',
    actionLabel: 'ตรวจสอบ',
    reason: 'รอดูข้อมูล',
    guardrail: 'ตรวจข้อมูลล่าสุด',
    impact: 'ลดความเสี่ยง',
    nextStep: 'ตรวจสอบ',
    evidence: [],
    confidence: 70,
    priority: 1,
    risk: 'Medium',
    tone: 'watch',
    canQueue: false,
    sortScore: 1,
    ...overrides,
  } as never
}

function ad(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ad-1',
    adSetId: 'adset-1',
    campaignId: 'campaign-1',
    name: 'Ad 1',
    status: 'active',
    spend: 1000,
    roas: 0,
    bookings: 0,
    ctr: 0.3,
    impressions: 1000,
    cpa: 0,
    score: 3,
    ...overrides,
  } as never
}
