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
  source?: 'meta_metrics' | 'ai_brain'
  sourceDecisionId?: string
  requiresApproval?: boolean
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
  impressions?: number
  reach?: number
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

export type AgentInputSource = 'meta_api' | 'website_ui' | 'knowledgebase' | 'user_input' | 'codebase'
export type KnowledgeMemoryType = 'campaign' | 'creative' | 'audience' | 'compliance' | 'business' | 'system'
export type DecisionStatus = 'suggested' | 'approved' | 'executed' | 'rejected' | 'failed' | 'rolled_back'
export type AgentExecutionStatus = 'done' | 'blocked' | 'needs_review'

export interface AgentPolicyConstraints {
  noInventedMetrics: boolean
  requireEvidence: boolean
  requireApprovalForWrites: boolean
  medicalCompliance: boolean
}

export interface WebsiteContext {
  route: string
  activeTab: string
  datePreset: string
  dataState: 'loading' | 'live' | 'empty' | 'error' | 'unknown'
  selectedCampaignId?: string
  selectedAdSetId?: string
  selectedAdId?: string
  visibleCards: string[]
  visibleTableRows: Array<{
    objectType: 'campaign' | 'adset' | 'ad'
    objectId: string
    title: string
    visibleMetrics: Record<string, string | number>
  }>
  modal?: {
    type: string
    title: string
    targetId?: string
  }
  lastError?: string
  capturedAt: string
}

export interface KnowledgeMemory {
  id: string
  type: KnowledgeMemoryType
  title: string
  summary: string
  evidence: Array<{
    source: 'meta_api' | 'website_ui' | 'user_input' | 'ai_analysis' | 'execution_result'
    sourceId?: string
    observedAt: string
    value: string
  }>
  entities: Array<{
    kind: 'campaign' | 'adset' | 'ad' | 'creative' | 'service' | 'audience'
    id?: string
    name: string
  }>
  metrics?: {
    spend?: number
    revenue?: number
    roas?: number
    cpa?: number
    ctr?: number
    conversions?: number
  }
  recommendation?: string
  outcome?: string
  confidence: number
  tags: string[]
  createdAt: string
  updatedAt: string
  expiresAt?: string
}

export interface DecisionRecord {
  id: string
  syncId: string
  actor: 'ai' | 'human' | 'system'
  actionType: string
  target: {
    objectType: 'campaign' | 'adset' | 'ad' | 'creative' | 'account'
    objectId: string
    name: string
  }
  before: Record<string, unknown>
  recommendedAfter: Record<string, unknown>
  approvedAfter?: Record<string, unknown>
  evidence: string[]
  guardrail: string
  risk: RiskLevel
  confidence: number
  status: DecisionStatus
  userNote?: string
  executionResult?: Record<string, unknown>
  createdAt: string
  executedAt?: string
}

export interface AgentTaskEnvelope {
  taskId: string
  requestedBy: 'master'
  agentName: string
  intent: string
  inputSources: AgentInputSource[]
  payload: Record<string, unknown>
  constraints: AgentPolicyConstraints
}

export interface AgentTaskResult {
  taskId: string
  agentName: string
  status: AgentExecutionStatus
  summary: string
  evidence: string[]
  output: Record<string, unknown>
  proposedActions: Array<{
    actionType: string
    targetId: string
    risk: RiskLevel
    requiresApproval: boolean
  }>
  memoryWrites: KnowledgeMemory[]
  blockers: string[]
}

export interface AiBrainFinding {
  title: string
  explanation: string
  evidence: string[]
  confidence: number
  risk: RiskLevel
}

export interface AiBrainRecommendation {
  type: string
  targetId: string
  targetName: string
  action: string
  expectedImpact: string
  guardrail: string
  rollbackNote: string
  risk: RiskLevel
  confidence: number
  executable: boolean
  requiresApproval: boolean
  evidence: string[]
}

export interface AiBrainSpecialistReport {
  agentName: string
  status: AgentExecutionStatus
  priority: RiskLevel
  summary: string
  evidence: string[]
  nextStep: string
  confidence: number
  blockers: string[]
}

export interface AiBrainSpecialistOutputs {
  campaignAnalyst?: AiBrainSpecialistReport
  adSetAnalyst?: AiBrainSpecialistReport
  adAnalyst?: AiBrainSpecialistReport
  budgetOptimization?: AiBrainSpecialistReport
  funnelDiagnosis?: AiBrainSpecialistReport
  creativeStrategist?: AiBrainSpecialistReport
  audienceSegment?: AiBrainSpecialistReport
  medicalCompliance?: AiBrainSpecialistReport
  approvalGatekeeper?: AiBrainSpecialistReport
  actionBuilder?: AiBrainSpecialistReport
}

export interface AiBrainResponse {
  summary: string
  masterDecision: string
  findings: AiBrainFinding[]
  recommendations: AiBrainRecommendation[]
  specialistOutputs: AiBrainSpecialistOutputs
  approvalActions: RecommendedAction[]
  agentResults: AgentTaskResult[]
  memoryWrites: KnowledgeMemory[]
  decisionRecords: DecisionRecord[]
  policy: {
    approvedForDirectExecution: boolean
    reasons: string[]
  }
}

export type OutcomeWindow = 'same_sync' | '24h' | '48h' | '7d' | 'manual_review'
export type OutcomeStatus = 'improved' | 'declined' | 'unchanged' | 'pending' | 'blocked'
export type MonitoringSeverity = 'info' | 'watch' | 'critical'

export interface OutcomeObservation {
  id: string
  decisionId?: string
  target: DecisionRecord['target']
  window: OutcomeWindow
  before: Record<string, unknown>
  after: Record<string, unknown>
  deltas: {
    spend?: number
    revenue?: number
    roas?: number
    cpa?: number
    ctr?: number
    conversions?: number
  }
  status: OutcomeStatus
  summary: string
  evidence: string[]
  confidence: number
  observedAt: string
}

export interface OutcomeLearningRecord {
  id: string
  title: string
  summary: string
  pattern: string
  recommendation: string
  supportingOutcomeIds: string[]
  confidence: number
  tags: string[]
  createdAt: string
}

export interface MonitoringAlert {
  id: string
  severity: MonitoringSeverity
  title: string
  detail: string
  source: 'sync' | 'ai' | 'meta' | 'knowledgebase' | 'compliance'
  evidence: string[]
  status: 'open' | 'acknowledged' | 'resolved'
  createdAt: string
}

export interface Phase4Report {
  id: string
  generatedAt: string
  period: string
  summary: string
  outcomeStatus: OutcomeStatus
  metrics: {
    spend: number
    revenue: number
    roas: number
    cpa: number
    ctr: number
    conversions: number
    activeCampaigns: number
  }
  keyFindings: string[]
  nextActions: string[]
}

export interface AiPhase4Response {
  summary: string
  agents: AiBrainSpecialistReport[]
  outcomes: OutcomeObservation[]
  learnings: OutcomeLearningRecord[]
  alerts: MonitoringAlert[]
  report: Phase4Report
  memoryWrites: KnowledgeMemory[]
  knowledge: {
    source: 'runtime-jsonl'
    decisionsRead: number
    memoriesRead: number
    memoriesWritten: number
    outcomesWritten: number
    learningsWritten: number
    alertsWritten: number
    reportsWritten: number
  }
  policy: {
    approvedForDirectExecution: false
    reasons: string[]
  }
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
