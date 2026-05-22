export type RiskLevel = 'Low' | 'Medium' | 'High'

export type PageAutomationPlatform = 'facebook' | 'instagram'

export type PageAutomationRouteId = 'dashboard' | 'auto-post' | 'pages' | 'messages' | 'analytics'

export type AutoMode = 'off' | 'on'

export type AutoEligibilityState = 'auto_eligible' | 'needs_approval' | 'blocked'

export type PageMappingState = 'explicit' | 'inferred' | 'missing' | 'conflicting'

export type PageAutomationFeature =
  | 'page_selection'
  | 'page_insights'
  | 'content_leaderboard'
  | 'facebook_publishing'
  | 'facebook_messages'
  | 'instagram_profile'
  | 'instagram_analytics'
  | 'instagram_publishing'
  | 'instagram_comments'
  | 'instagram_messages'
  | 'ads_ai_bridge'

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
  platform: PageAutomationPlatform
  granted: PageAutomationPermission[]
  missing: PageAutomationPermission[]
  checkedAt: string
}

export type ManagedPage = {
  id: string
  name: string
  handle: string
  platform: PageAutomationPlatform
  avatarUrl?: string
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

export type PostDraftStatus = 'draft' | 'ready' | 'scheduled' | 'posted' | 'needs_review' | 'failed' | 'blocked'

export type PostDraftChannel =
  | 'facebook_feed'
  | 'facebook_video'
  | 'instagram_feed'
  | 'instagram_reels'
  | 'story_preview'
  | 'ad_reference'

export type PostDraft = {
  id: string
  pageId: string
  pageName: string
  channel: PostDraftChannel
  title: string
  objective: string
  captionTh: string
  cta: string
  destination: string
  scheduledAt?: string
  status: PostDraftStatus
  autoEligible: boolean
  guardrailScore: number
  aiConfidence: number
  adsInsightId?: string
  platformPostId?: string
  publishError?: string
  createdAt: string
  updatedAt: string
}

export type PageMessageStatus = 'new' | 'open' | 'waiting_customer' | 'booked' | 'resolved' | 'spam' | 'escalated'

export type PageMessagePriority = 'high' | 'medium' | 'low'

export type PageMessageChannel =
  | 'facebook_message'
  | 'instagram_dm'
  | 'comment'
  | 'ad_comment'
  | 'mention'
  | 'review'

export type PageMessageSentiment = 'positive' | 'neutral' | 'negative'

export type PageMessageIntent = 'booking' | 'price' | 'review_request' | 'complaint' | 'general'

export type PageMessageHistoryItem = {
  messageId: string
  senderName: string
  senderRole: 'customer' | 'page' | 'unknown'
  text: string
  createdAt: string
}

export type PageMessage = {
  conversationId: string
  messageId: string
  pageId: string
  channel: PageMessageChannel
  customerDisplayName: string
  textExcerpt: string
  receivedAt: string
  unread: boolean
  priority: PageMessagePriority
  status: PageMessageStatus
  sentiment: PageMessageSentiment
  intent: PageMessageIntent
  slaDueAt: string
  privacyFlags: string[]
  aiSummary?: string
  history?: PageMessageHistoryItem[]
}

export type SharedAdsInsightForPage = {
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
    risk: RiskLevel
    confidence: number
  }>
  recommendations: Array<{
    id: string
    action: string
    expectedImpact: string
    guardrail: string
    requiresApproval: true
    risk: RiskLevel
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

export type AutoEligibilityContentType =
  | 'education'
  | 'faq'
  | 'service_reminder'
  | 'awareness'
  | 'engagement'
  | 'soft_promotion'
  | 'winning_ad_angle'
  | 'price_mention'
  | 'medical_claim'
  | 'guarantee'
  | 'urgent_offer'
  | 'sensitive_before_after'

export type AutoEligibilityAssetState =
  | 'approved'
  | 'missing_optional_metadata'
  | 'missing_required_asset'
  | 'rejected'

export type AutoEligibilityInput = {
  adsAiConfidence: number
  guardrailScore: number
  pageId: string
  pageMapping: PageMappingState
  publishSurface: PostDraftChannel
  permissionReports: PageAutomationPermissionReport[]
  contentType: AutoEligibilityContentType
  hasPii: boolean
  hasSensitiveHealthDetail: boolean
  assetState: AutoEligibilityAssetState
  adsInsightCheckedAt: string
  pageSyncedAt: string
  permissionsSyncedAt: string
  now: string
}

export type AutoEligibilityResult = {
  state: AutoEligibilityState
  reason: string
}

export type MissingPermissionState = {
  feature: PageAutomationFeature
  missing: PageAutomationPermission[]
}
