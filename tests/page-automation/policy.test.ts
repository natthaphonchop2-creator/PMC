import { describe, expect, it } from 'vitest'
import { classifyAutoEligibility, isAdsInsightStaleForAuto, missingPermissionStates } from '../../src/apps/page-automation/policy'
import type { AutoEligibilityInput, PageAutomationPermissionReport, SharedAdsInsightForPage } from '../../src/apps/page-automation/types'

const freshInsight: SharedAdsInsightForPage = {
  source: { datePreset: 'last_7d', checkedAt: new Date('2026-05-21T03:00:00.000Z').toISOString(), taskId: 'brain-1' },
  scope: { pageId: 'page-1', pageName: 'Fifth Clinic', campaignIds: ['cmp-1'], adSetIds: ['set-1'], adIds: ['ad-1'] },
  metrics: { spend: 12000, revenue: 54000, roas: 4.5, cpa: 320, ctr: 1.8, leads: 42, bookings: 11 },
  findings: [],
  recommendations: [],
  creativeSignals: [],
  outcomeSignals: { alerts: [], learnings: [], nextActions: [] },
  policy: { readOnly: true, noMetaWrites: true, noInventedMetrics: true, approvalRequired: true },
}

const baseInput: AutoEligibilityInput = {
  adsAiConfidence: 0.9,
  guardrailScore: 95,
  pageMapping: 'explicit',
  contentType: 'education',
  hasPii: false,
  hasSensitiveHealthDetail: false,
  assetState: 'approved',
  adsInsightCheckedAt: freshInsight.source.checkedAt,
  pageSyncedAt: new Date('2026-05-21T03:30:00.000Z').toISOString(),
  permissionsSyncedAt: new Date('2026-05-21T03:50:00.000Z').toISOString(),
  now: new Date('2026-05-21T04:00:00.000Z').toISOString(),
}

describe('Page Automation policy', () => {
  it('allows low-risk explicit mapped content when Auto is on', () => {
    expect(classifyAutoEligibility(baseInput)).toEqual({
      state: 'auto_eligible',
      reason: 'ผ่านทุก guardrail สำหรับ Auto ON',
    })
  })

  it('moves inferred page mapping to approval instead of auto publishing', () => {
    expect(classifyAutoEligibility({ ...baseInput, pageMapping: 'inferred' })).toEqual({
      state: 'needs_approval',
      reason: 'page-to-ads mapping เป็น inferred',
    })
  })

  it('blocks unredacted sensitive customer data', () => {
    expect(classifyAutoEligibility({ ...baseInput, hasPii: true })).toEqual({
      state: 'blocked',
      reason: 'มี PII หรือข้อมูลสุขภาพที่ยังไม่ redacted',
    })
  })

  it('treats Ads AI insight older than 6 hours as stale for Auto decisions', () => {
    expect(
      isAdsInsightStaleForAuto({
        checkedAt: '2026-05-20T21:59:00.000Z',
        now: '2026-05-21T04:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('reports missing permissions by feature', () => {
    const report: PageAutomationPermissionReport = {
      pageId: 'page-1',
      platform: 'facebook',
      granted: ['pages_show_list', 'pages_read_engagement'],
      missing: ['pages_manage_posts', 'pages_messaging'],
      checkedAt: '2026-05-21T04:00:00.000Z',
    }
    expect(missingPermissionStates(report)).toEqual([
      { feature: 'facebook_publishing', missing: ['pages_manage_posts'] },
      { feature: 'facebook_messages', missing: ['pages_messaging'] },
    ])
  })
})
