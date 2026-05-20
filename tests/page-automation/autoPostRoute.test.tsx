import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AutoPost } from '../../src/apps/page-automation/routes/AutoPost'
import { Messages } from '../../src/apps/page-automation/routes/Messages'
import { PageAnalysis } from '../../src/apps/page-automation/routes/PageAnalysis'
import type {
  ManagedPage,
  PageAutomationPermission,
  PageAutomationPermissionReport,
  SharedAdsInsightForPage,
} from '../../src/apps/page-automation/types'

const fullFacebookPermissions: PageAutomationPermission[] = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
  'pages_manage_metadata',
  'pages_manage_engagement',
  'pages_messaging',
  'ads_read',
]

describe('Page Automation route guardrails', () => {
  it('keeps approval-required Ads recommendations out of Mark eligible', () => {
    const page = makePage({ healthScore: 96, permissions: [makePermissionReport()] })
    const adsInsight = makeAdsInsight({
      recommendations: [
        {
          id: 'rec-1',
          action: 'Scale the winning offer angle from the high ROAS ad.',
          expectedImpact: 'More consultation requests',
          guardrail: 'Approval required before page publishing',
          requiresApproval: true,
          risk: 'Medium',
          confidence: 0.92,
        },
      ],
    })

    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={adsInsight}
        autoMode="on"
        messages={[]}
        pages={[page]}
        summary={{ avgHealth: 96, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('Needs human approval')
    expect(html).not.toContain('Eligible for low-risk Auto ON')
    expect(html).toMatch(/<button(?=[^>]*disabled)[^>]*>\s*Mark eligible\s*<\/button>/)
  })

  it('uses an unknown Ads confidence state for creative signals without finding confidence', () => {
    const page = makePage({ healthScore: 96, permissions: [makePermissionReport()] })
    const adsInsight = makeAdsInsight({
      creativeSignals: [
        {
          adId: 'ad-1',
          campaignId: 'cmp-1',
          creative: 'Winning consultation angle from the top ad.',
          score: 94,
          ctr: 2.1,
          roas: 4.8,
          bookings: 12,
        },
      ],
    })

    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={adsInsight}
        autoMode="on"
        messages={[]}
        pages={[page]}
        summary={{ avgHealth: 96, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('unknown, below auto threshold')
    expect(html).toContain('Needs human approval')
    expect(html).toMatch(/<button(?=[^>]*disabled)[^>]*>\s*Mark eligible\s*<\/button>/)
  })

  it('shows unknown permission state in AutoPost instead of reporting all permissions granted', () => {
    const page = makePage({ permissions: [] })

    const html = renderToStaticMarkup(
      <AutoPost
        adsInsight={null}
        autoMode="on"
        messages={[]}
        pages={[page]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('Permission state unknown')
    expect(html).not.toContain('All reported permissions granted')
  })

  it('shows unknown permission state in PageAnalysis permission hints', () => {
    const page = makePage({ permissions: [] })

    const html = renderToStaticMarkup(
      <PageAnalysis
        adsInsight={null}
        autoMode="off"
        messages={[]}
        pages={[page]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('Permission state unknown')
    expect(html).not.toContain('No missing permissions in current page reports.')
  })

  it('shows unknown permission state in Messages before treating an empty inbox as message data', () => {
    const page = makePage({ permissions: [] })

    const html = renderToStaticMarkup(
      <Messages
        adsInsight={null}
        autoMode="off"
        messages={[]}
        pages={[page]}
        summary={{ avgHealth: 92, followers: 1200, pages: 1, unread: 0 }}
      />,
    )

    expect(html).toContain('Permission state unknown')
    expect(html).not.toContain('The polling endpoint returned no messages for connected pages.')
  })
})

function makePage(overrides: Partial<ManagedPage> = {}): ManagedPage {
  return {
    id: 'page-1',
    name: 'Fifth Clinic',
    handle: '@fifthclinic',
    platform: 'facebook',
    followers: 1200,
    followerDelta: 15,
    reach: 5400,
    engagementRate: 3.4,
    unreadCount: 0,
    responseRate: 96,
    avgFirstResponseMins: 12,
    healthScore: 92,
    permissions: [makePermissionReport()],
    lastSyncedAt: recentIso(2),
    ...overrides,
  }
}

function makePermissionReport(overrides: Partial<PageAutomationPermissionReport> = {}): PageAutomationPermissionReport {
  return {
    pageId: 'page-1',
    platform: 'facebook',
    granted: fullFacebookPermissions,
    missing: [],
    checkedAt: recentIso(1),
    ...overrides,
  }
}

function makeAdsInsight(overrides: Partial<SharedAdsInsightForPage> = {}): SharedAdsInsightForPage {
  return {
    source: { datePreset: 'last_7d', checkedAt: recentIso(1), taskId: 'brain-1' },
    scope: { pageId: 'page-1', pageName: 'Fifth Clinic', campaignIds: ['cmp-1'], adSetIds: ['set-1'], adIds: ['ad-1'] },
    metrics: { spend: 12000, revenue: 54000, roas: 4.5, cpa: 320, ctr: 1.8, leads: 42, bookings: 11 },
    findings: [],
    recommendations: [],
    creativeSignals: [],
    outcomeSignals: { alerts: [], learnings: [], nextActions: [] },
    policy: { readOnly: true, noMetaWrites: true, noInventedMetrics: true, approvalRequired: true },
    ...overrides,
  }
}

function recentIso(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()
}
