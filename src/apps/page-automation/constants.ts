import type {
  PageAutomationFeature,
  PageAutomationPermission,
  PageAutomationPlatform,
  PageAutomationRouteId,
  PostDraftChannel,
} from './types'

export const PAGE_AUTOMATION_ROUTES: Array<{ id: PageAutomationRouteId; href: string; label: string }> = [
  { id: 'dashboard', href: '/page-automation', label: 'Dashboard' },
  { id: 'auto-post', href: '/page-automation/auto-post', label: 'Ads Auto Post' },
  { id: 'pages', href: '/page-automation/pages', label: 'วิเคราะห์เพจ' },
  { id: 'messages', href: '/page-automation/messages', label: 'กล่องข้อความรวม' },
  { id: 'analytics', href: '/page-automation/analytics', label: 'Analytics' },
]

export const FEATURE_PERMISSION_REQUIREMENTS: Record<PageAutomationFeature, PageAutomationPermission[]> = {
  page_selection: ['pages_show_list'],
  page_insights: ['pages_read_engagement'],
  content_leaderboard: ['pages_read_user_content'],
  facebook_publishing: ['pages_manage_posts'],
  facebook_messages: ['pages_messaging'],
  instagram_profile: ['instagram_basic'],
  instagram_analytics: ['instagram_manage_insights'],
  instagram_publishing: ['instagram_content_publish'],
  instagram_comments: ['instagram_manage_comments'],
  instagram_messages: ['instagram_manage_messages'],
  ads_ai_bridge: ['ads_read'],
}

export const PLATFORM_PERMISSION_FEATURES: Record<PageAutomationPlatform, PageAutomationFeature[]> = {
  facebook: [
    'page_selection',
    'page_insights',
    'content_leaderboard',
    'facebook_publishing',
    'facebook_messages',
    'ads_ai_bridge',
  ],
  instagram: [
    'instagram_profile',
    'instagram_analytics',
    'instagram_publishing',
    'instagram_comments',
    'instagram_messages',
    'ads_ai_bridge',
  ],
}

export const AUTO_SUPPORTED_V1_PUBLISH_SURFACES: ReadonlySet<PostDraftChannel> = new Set([
  'facebook_feed',
])

export const AUTO_PUBLISH_SURFACE_REQUIRED_PERMISSIONS: Partial<Record<PostDraftChannel, PageAutomationPermission[]>> = {
  facebook_feed: ['pages_read_engagement', 'pages_manage_posts'],
}

export const ADS_AI_AUTO_STALE_MS = 6 * 60 * 60 * 1000
export const ADS_AI_DASHBOARD_STALE_MS = 24 * 60 * 60 * 1000
export const PAGE_SYNC_AUTO_STALE_MS = 60 * 60 * 1000
export const PERMISSION_AUTO_STALE_MS = 15 * 60 * 1000
