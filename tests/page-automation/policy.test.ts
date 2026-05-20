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
  pageId: 'page-1',
  pageMapping: 'explicit',
  contentType: 'education',
  hasPii: false,
  hasSensitiveHealthDetail: false,
  assetState: 'approved',
  adsInsightCheckedAt: freshInsight.source.checkedAt,
  pageSyncedAt: new Date('2026-05-21T03:30:00.000Z').toISOString(),
  permissionsSyncedAt: new Date('2026-05-21T03:50:00.000Z').toISOString(),
  publishSurface: 'facebook_feed',
  permissionReports: [
    {
      pageId: 'page-1',
      platform: 'facebook',
      granted: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
      missing: [],
      checkedAt: new Date('2026-05-21T03:50:00.000Z').toISOString(),
    },
  ],
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

  it('blocks Facebook auto publishing when required publishing permission is missing', () => {
    expect(
      classifyAutoEligibility({
        ...baseInput,
        permissionReports: [
          {
            pageId: 'page-1',
            platform: 'facebook',
            granted: ['pages_show_list', 'pages_read_engagement'],
            missing: [],
            checkedAt: '2026-05-21T04:00:00.000Z',
          },
        ],
      }),
    ).toEqual({
      state: 'blocked',
      reason: 'permission ไม่ครบสำหรับ Auto ON publishing surface',
    })
  })

  it('blocks Facebook feed auto publishing when engagement read permission is missing', () => {
    expect(
      classifyAutoEligibility({
        ...baseInput,
        permissionReports: [
          {
            pageId: 'page-1',
            platform: 'facebook',
            granted: ['pages_show_list', 'pages_manage_posts'],
            missing: [],
            checkedAt: '2026-05-21T04:00:00.000Z',
          },
        ],
      }),
    ).toEqual({
      state: 'blocked',
      reason: 'permission ไม่ครบสำหรับ Auto ON publishing surface',
    })
  })

  it('keeps Facebook video out of v1 auto eligibility', () => {
    expect(classifyAutoEligibility({ ...baseInput, publishSurface: 'facebook_video' })).toEqual({
      state: 'needs_approval',
      reason: 'publishing surface ยังไม่รองรับ Auto ON v1',
    })
  })

  it('keeps unsupported v1 auto publish surfaces out of auto eligibility', () => {
    const unsupportedSurfaces = ['instagram_feed', 'instagram_reels', 'story_preview'] as const

    for (const publishSurface of unsupportedSurfaces) {
      expect(classifyAutoEligibility({ ...baseInput, publishSurface }).state).not.toBe('auto_eligible')
    }
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
      granted: ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'ads_read'],
      missing: ['pages_manage_posts', 'pages_messaging'],
      checkedAt: '2026-05-21T04:00:00.000Z',
    }
    expect(missingPermissionStates(report)).toEqual([
      { feature: 'facebook_publishing', missing: ['pages_manage_posts'] },
      { feature: 'facebook_messages', missing: ['pages_messaging'] },
    ])
  })

  it('derives missing permissions from granted permissions even when report.missing is empty', () => {
    const report: PageAutomationPermissionReport = {
      pageId: 'page-1',
      platform: 'facebook',
      granted: ['pages_show_list', 'pages_read_engagement'],
      missing: [],
      checkedAt: '2026-05-21T04:00:00.000Z',
    }

    expect(missingPermissionStates(report)).toEqual([
      { feature: 'content_leaderboard', missing: ['pages_read_user_content'] },
      { feature: 'facebook_publishing', missing: ['pages_manage_posts'] },
      { feature: 'facebook_messages', missing: ['pages_messaging'] },
      { feature: 'ads_ai_bridge', missing: ['ads_read'] },
    ])
  })
})
