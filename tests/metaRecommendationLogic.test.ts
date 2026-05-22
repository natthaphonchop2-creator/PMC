import { describe, expect, it } from 'vitest'
import { buildRecommendedActions } from '../server/metaApiPlugin'
import type { CampaignInsight } from '../src/types'

describe('Meta recommendation logic', () => {
  it('does not create a pause execution for campaigns that are already paused', () => {
    const actions = buildRecommendedActions([
      campaign({
        deliveryStatus: 'paused',
        spend: 7200,
        conversions: 0,
        aiStatus: 'critical',
      }),
    ])

    expect(actions).toHaveLength(1)
    expect(actions[0].execution).toBeUndefined()
    expect(actions[0].after).not.toMatch(/pause/i)
    expect(actions[0].summary).toContain('ถูกพักอยู่แล้ว')
  })

  it('keeps pause execution only for active campaigns that still need budget protection', () => {
    const actions = buildRecommendedActions([
      campaign({
        deliveryStatus: 'active',
        spend: 7200,
        conversions: 0,
        aiStatus: 'critical',
      }),
    ])

    expect(actions[0].execution).toEqual(expect.objectContaining({
      objectType: 'campaign',
      objectId: 'campaign-1',
      status: 'PAUSED',
    }))
  })
})

function campaign(overrides: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    id: 'campaign-1',
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
