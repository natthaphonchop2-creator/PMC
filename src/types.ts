import type { LucideIcon } from 'lucide-react'

export type TabId =
  | 'platform'
  | 'overview'
  | 'appointments'
  | 'campaigns'
  | 'investigator'
  | 'actions'
  | 'auto'
  | 'tasks'
  | 'memory'
  | 'compliance'
  | 'settings'
  | 'audit'

export type AiStatus = 'healthy' | 'watch' | 'critical' | 'scaling'
export type RiskLevel = 'Low' | 'Medium' | 'High'
export type ActionStatus = 'pending' | 'approved' | 'executing' | 'executed' | 'failed' | 'rejected'
export type TaskStatus = 'pending' | 'running' | 'done'
export type AutomationMode = 'suggest' | 'autoPilot'
export type AdDeliveryStatus = 'active' | 'paused'
export type MetaObjectType = 'campaign' | 'adset' | 'ad'
export type MetaObjectStatus = 'ACTIVE' | 'PAUSED'
export type AutoDecision = 'pause' | 'enable' | 'keep' | 'reduceBudget'
export type MemoryCategory = 'Insight' | 'Creative' | 'Audience' | 'Strategy' | 'Preference'

export interface CampaignInsight {
  id: string
  name: string
  objective: string
  deliveryStatus: AdDeliveryStatus
  budget: number
  spend: number
  revenue: number
  roas: number
  cpa: number
  ctr: number
  conversions: number
  frequency: number
  aiStatus: AiStatus
  aiSummary: string
}

export interface ServiceLine {
  id: string
  name: string
  category: string
  revenue: number
  bookings: number
  showRate: number
  closeRate: number
  cpa: number
  aiStatus: AiStatus
}

export interface AppointmentStage {
  id: string
  label: string
  count: number
  rate: string
  note: string
  status: AiStatus
}

export interface ComplianceReview {
  id: string
  title: string
  service: string
  status: 'approved' | 'needsReview' | 'blocked'
  issue: string
  fix: string
  adId?: string
  campaignId?: string
  creativeId?: string
  thumbnailUrl?: string
  source?: string
  spend?: number
  impressions?: number
  ctr?: number
  roas?: number
  deliveryStatus?: AdDeliveryStatus
}

export interface AIInsight {
  campaignId: string
  whatHappened: string
  why: string
  evidence: string[]
  recommendation: string
  confidence: number
  risk: RiskLevel
}

export interface RecommendedAction {
  id: string
  campaignId: string
  type: string
  target: string
  summary: string
  expectedImpact: string
  guardrail: string
  before: string
  after: string
  rollbackNote: string
  risk: RiskLevel
  confidence: number
  status: ActionStatus
  execution?: {
    endpoint: '/api/meta/object-status' | '/api/meta/object'
    method: 'POST'
    objectType: MetaObjectType
    objectId: string
    status?: MetaObjectStatus
    operation?: 'update'
    params?: Record<string, string | number | boolean>
    label: string
  }
  executionError?: string
  executedAt?: string
}

export interface AutoAdControl {
  id: string
  adId: string
  campaignId: string
  adName: string
  status: AdDeliveryStatus
  recommendation: AutoDecision
  reason: string
  guardrail: string
  confidence: number
  risk: RiskLevel
  before: string
  after: string
  rollbackNote: string
  applied: boolean
}

export interface AgentTask {
  id: string
  agent: string
  taskType: string
  owner: string
  sourceCampaign: string
  inputContext: string
  expectedOutput: string
  status: TaskStatus
  result: string
  updatedAt: string
}

export interface MemoryItem {
  id: string
  category: MemoryCategory
  title: string
  detail: string
  source: string
  confidence: number
  updatedAt: string
}

export interface AuditEvent {
  id: string
  actor: string
  action: string
  target: string
  before: string
  after: string
  reason: string
  timestamp: string
}

export type ApprovalRequest =
  | { kind: 'recommendation'; id: string }
  | { kind: 'auto'; id: string }

export interface ToolTab {
  id: TabId
  label: string
  description: string
  icon: LucideIcon
}

export interface ToolSection {
  title: string
  description: string
  tabs: ToolTab[]
}

export interface InsightComponent {
  id: string
  campaignId: string
  title: string
  service: string
  ads: number
  score: number
  spend: number
  clicks: number
  ctr: number
  results: number
  costPerResult: number
  purchaseValue: number
  roas: number
  tone: 'good' | 'watch' | 'critical'
  thumbTone: string
}

export interface ChannelPerformance {
  channel: string
  spend: number
  impressions: number
  reach: number
  clicks: number
  leads: number
  bookings: number
  showUps: number
  treatments: number
  firstTimePatients: number
  revenue: number
  leadQuality: number
}

export interface TrendPoint {
  date: string
  spend: number
  revenue: number
  cpa: number
  clicks: number
  leads: number
  bookings: number
  showUps: number
  treatments: number
}

export interface FunnelMetric {
  stage: string
  count: number
  conversionRate: number
  dropOffRate: number
  benchmark: string
  help: string
}

export interface AudienceGeoTarget {
  type: 'country' | 'region' | 'city' | 'zip' | 'custom' | 'location'
  name: string
  key?: string
  country?: string
  region?: string
  radius?: number
  distanceUnit?: string
}

export interface AudienceTarget {
  type: 'interest' | 'behavior' | 'demographic' | 'custom_audience' | 'lookalike' | 'excluded' | 'other'
  id?: string
  name: string
  path?: string
  source?: string
}

export interface AudienceTargeting {
  ageMin?: number
  ageMax?: number
  genders: string[]
  publisherPlatforms: string[]
  placements: string[]
  devicePlatforms: string[]
  geoLocations: AudienceGeoTarget[]
  interests: AudienceTarget[]
  exclusions: AudienceTarget[]
  locales: string[]
  rawSummary: string
}

export interface AdSetInsight {
  id: string
  campaignId: string
  name: string
  audience: string
  audienceTargeting?: AudienceTargeting
  deliveryStatus: AdDeliveryStatus
  budget: number
  spend: number
  bookings: number
  cpa: number
  roas: number
  status: AiStatus
}

export interface AdInsight {
  id: string
  campaignId: string
  adSetId: string
  name: string
  creative: string
  status: AdDeliveryStatus
  spend: number
  impressions: number
  clicks: number
  leads: number
  bookings: number
  showRate: number
  ctr: number
  cpc: number
  roas: number
  score: number
}

export interface DrilldownMetric {
  label: string
  value: string
  help: string
}

export interface PerformanceDrilldown {
  type: 'metric' | 'channel' | 'funnel'
  title: string
  subtitle: string
  summary: string
  metrics: DrilldownMetric[]
  findings: string[]
  nextAction: string
}

export interface AiInsightDrawerContext {
  kind: 'campaign' | 'creative' | 'ad'
  campaignId: string
  title: string
  subtitle: string
}

export interface WorkspaceData {
  campaigns: CampaignInsight[]
  serviceLines: ServiceLine[]
  appointmentStages: AppointmentStage[]
  complianceReviews: ComplianceReview[]
  insights: AIInsight[]
  insightComponents: InsightComponent[]
  adSets: AdSetInsight[]
  adInsights: AdInsight[]
  actions: RecommendedAction[]
  autoAds: AutoAdControl[]
  tasks: AgentTask[]
  memoryItems: MemoryItem[]
  auditTrail: AuditEvent[]
  trendData: TrendPoint[]
  channelPerformance: ChannelPerformance[]
  funnelMetrics: FunnelMetric[]
  autoMode: AutomationMode
  updatedAt: string
}
