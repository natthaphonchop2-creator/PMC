export type PageAutomationStatus = {
  ok: boolean
  autoMode: 'off' | 'on'
  storage: 'ready' | 'unavailable'
  checkedAt: string
}

export type PageAutomationAuditRecord = {
  id: string
  actor: 'system' | 'user'
  action: string
  target: string
  reason: string
  createdAt: string
}

export type PageAutomationPermission =
  | 'pages_show_list'
  | 'pages_read_engagement'
  | 'pages_read_user_content'
  | 'pages_manage_posts'
  | 'pages_manage_metadata'
  | 'pages_manage_engagement'
  | 'pages_messaging'
  | 'instagram_basic'
  | 'instagram_manage_insights'
  | 'instagram_content_publish'
  | 'instagram_manage_comments'
  | 'instagram_manage_messages'
  | 'ads_read'
  | 'business_management'
  | 'leads_retrieval'

export type PageAutomationPermissionReport = {
  pageId: string
  platform: 'facebook' | 'instagram'
  granted: PageAutomationPermission[]
  missing: PageAutomationPermission[]
  checkedAt: string
}

export type ManagedPageRecord = {
  id: string
  name: string
  handle: string
  platform: 'facebook' | 'instagram'
  followers: number
  followerDelta: number
  reach: number
  engagementRate: number
  unreadCount: number
  responseRate: number
  avgFirstResponseMins: number
  healthScore: number
  permissions: PageAutomationPermissionReport[]
  lastSyncedAt: string
}

export type SharedAdsInsightForPageRecord = {
  source: {
    workspaceId?: string
    datePreset: string
    checkedAt: string
    taskId?: string
  }
  scope: {
    pageId?: string
    pageName?: string
    campaignIds: string[]
    adSetIds: string[]
    adIds: string[]
  }
  metrics: {
    spend: number
    revenue: number
    roas: number
    cpa: number
    ctr: number
    leads?: number
    bookings?: number
  }
  findings: Array<{
    title: string
    summary: string
    evidence: string[]
    risk: 'Low' | 'Medium' | 'High'
    confidence: number
  }>
  recommendations: Array<{
    id: string
    action: string
    expectedImpact: string
    guardrail: string
    requiresApproval: true
    risk: 'Low' | 'Medium' | 'High'
    confidence: number
  }>
  creativeSignals: Array<{
    adId: string
    campaignId: string
    creative: string
    score: number
    ctr: number
    roas: number
    bookings: number
  }>
  outcomeSignals: {
    alerts: unknown[]
    learnings: unknown[]
    nextActions: string[]
  }
  policy: {
    readOnly: true
    noMetaWrites: true
    noInventedMetrics: true
    approvalRequired: true
  }
}
