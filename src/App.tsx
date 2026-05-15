import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  Database,
  Download,
  FileClock,
  Flag,
  HelpCircle,
  HeartPulse,
  ImageIcon,
  Info,
  Layers3,
  LineChart,
  MapPin,
  Menu,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plug,
  Power,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Trophy,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import type {
  AdDeliveryStatus,
  AdSetInsight,
  AIInsight,
  AiInsightDrawerContext,
  AiStatus,
  AgentTask,
  AppointmentStage,
  ApprovalRequest,
  AutoAdControl,
  AutoDecision,
  AutomationMode,
  AudienceGeoTarget,
  AudienceTarget,
  AudienceTargeting,
  CampaignInsight,
  ChannelPerformance,
  ComplianceReview,
  MemoryCategory,
  MemoryItem,
  MetaObjectStatus,
  MetaObjectType,
  PerformanceDrilldown,
  RecommendedAction,
  RiskLevel,
  ServiceLine,
  TabId,
  TaskStatus,
  ToolSection,
  ToolTab,
  TrendPoint,
  WorkspaceData,
} from './types'

const metricHelp = {
  adSpend: 'เงินที่ใช้กับ media buying ทั้งหมดในช่วงเวลานี้ ใช้เป็นตัวตั้งต้นของ CPA, CAC และ ROAS',
  revenue: 'รายได้ treatment ที่ผูกกับ campaign/channel ใช้แทน conversion value เพื่อดูผลลัพธ์ทางธุรกิจจริง',
  roas: 'Return on Ad Spend = Revenue / Ad Spend ใช้วัดว่าทุก 1 บาทโฆษณาสร้างรายได้กี่บาท',
  cpa: 'Cost per Booking = Spend / Bookings ใช้วัดต้นทุนต่อการนัดหมาย ไม่ใช่ต้นทุนต่อคนไข้ที่จ่ายเงิน',
  bookings: 'จำนวนนัดหมายจาก ads, LINE, inbox หรือ CRM เป็น mid-funnel metric ก่อน show-up',
  ctr: 'Click-through rate = Clicks / Impressions ใช้วัดว่า creative และ hook น่าสนใจพอให้คนคลิกหรือไม่',
  cpc: 'Cost per click = Spend / Clicks ใช้ดูต้นทุน traffic และ message match ก่อนเกิด lead',
  cpm: 'Cost per 1,000 impressions = Spend / Impressions x 1,000 ใช้เทียบต้นทุน reach ข้าม channel',
  cpl: 'Cost per lead = Spend / Leads ใช้ดูต้นทุนการได้ lead แต่ต้องอ่านคู่กับ booking และ paid treatment',
  leadToBooking: 'Lead to Booking = Bookings / Leads ใช้วัดคุณภาพ lead และประสิทธิภาพทีมแชท/โทร',
  showRate: 'Show-up Rate = Show-ups / Bookings ใช้วัดคุณภาพนัดและการยืนยันนัดก่อนเข้าคลินิก',
  closeRate: 'Close Rate = Paid Treatments / Show-ups ใช้วัดประสิทธิภาพ consult และ offer ที่หน้าคลินิก',
  cac: 'Customer Acquisition Cost = Spend / First-time Patients ใช้วัดต้นทุนคนไข้ใหม่ที่ปิดจ่ายจริง',
  aov: 'Average Order Value = Revenue / Paid Treatments ใช้ดู ticket size ต่อเคสที่ปิดได้',
  salesVelocity: 'Sales Velocity = Opportunities x Average Deal Value x Win Rate / Sales Cycle ใช้ประเมินความเร็วของ pipeline',
  frequency: 'Frequency = Impressions / Reach ใช้วัดความถี่ที่คนเห็น ads เพื่อจับ fatigue',
  leadQuality: 'Lead Quality Score เป็นคะแนนรวมจาก booking rate, show-up rate, close rate และ revenue quality',
  conversionValue: 'Conversion Value คือมูลค่ารวมของ conversion ใช้วัด true business impact แทนการดูจำนวน conversion อย่างเดียว',
  dropOff: 'Drop-off Rate คือสัดส่วนคนที่หลุดออกระหว่าง stage ใช้หา bottleneck ใน funnel',
  autoAds: 'จำนวน ads ที่ active และจำนวน recommendation ที่รอ action ภายใต้ guardrails',
  alerts: 'จำนวน service/campaign ที่ AI จัดเป็น Watch หรือ Critical จาก performance และ quality signals',
}

const emptyWorkspaceData: WorkspaceData = {
  campaigns: [],
  serviceLines: [],
  appointmentStages: [],
  complianceReviews: [],
  insights: [],
  insightComponents: [],
  adSets: [],
  adInsights: [],
  actions: [],
  autoAds: [],
  tasks: [],
  memoryItems: [],
  auditTrail: [],
  trendData: [],
  channelPerformance: [],
  funnelMetrics: [],
  autoMode: 'suggest',
  updatedAt: 'ยังไม่มีข้อมูลจาก Meta API',
}

const toolSections: ToolSection[] = [
  {
    title: 'Main',
    description: 'ระบบหลักของคลินิก',
    tabs: [
      { id: 'campaigns', label: 'Ads Manager', description: 'จัดการ Campaign, Ad Set, Ads', icon: Zap },
      { id: 'auto', label: 'Optimization', description: 'เปิด/ปิดและปรับ Ads ด้วย guardrails', icon: Power },
    ],
  },
  {
    title: 'Creative',
    description: 'เครื่องมือทำงานกับ creative และ audience',
    tabs: [
      { id: 'tasks', label: 'Creative Studio', description: 'Creative performance และ work orders', icon: Layers3 },
      { id: 'memory', label: 'Audience Insights', description: 'Audience memory และ segment context', icon: Users },
      { id: 'compliance', label: 'Ad Library', description: 'ตรวจ claim และ creative assets', icon: ImageIcon },
    ],
  },
  {
    title: 'Insights',
    description: 'วิเคราะห์ performance และ action',
    tabs: [
      { id: 'overview', label: 'Analytics', description: 'ภาพรวม performance และรายงาน', icon: LineChart },
      { id: 'investigator', label: 'Creative Insights', description: 'จัดอันดับ creative และ signal', icon: BarChart3 },
      { id: 'actions', label: 'AI Marketer', description: 'Daily recommendations ที่รอ approve', icon: ClipboardList },
    ],
  },
  {
    title: 'System',
    description: 'ระบบเสริมและประวัติ',
    tabs: [
      { id: 'settings', label: 'Settings', description: 'API keys, connection checks, system health', icon: Settings },
      { id: 'audit', label: 'Reports', description: 'Before/after และ approval history', icon: Plug },
      { id: 'appointments', label: 'Help Center', description: 'Lead, booking, show-up', icon: HelpCircle },
    ],
  },
]

const platformModules: ToolTab[] = toolSections.flatMap((section) => section.tabs).filter((tab) => tab.id !== 'platform')

const platformToolHelp: Record<Exclude<TabId, 'platform'>, string> = {
  campaigns: 'Ads Manager ใช้ดูและจัดการ Meta Campaign, Ad Set และ Ads พร้อมสั่งเปิด ปิด สร้าง แก้ไข หรือลบรายการที่เชื่อมกับ API',
  auto: 'Optimization คือระบบ Ads Auto สำหรับให้ AI แนะนำหรือทำงานตาม guardrails เช่น pause ads ที่เสียเงิน, scale winner และคุมงบ',
  tasks: 'Creative Studio ใช้ดู creative performance, สร้าง asset work orders, บันทึก launch notes และเตรียมโพสต์/ยิง Ads Meta',
  memory: 'Audience Insights รวมข้อมูลกลุ่มเป้าหมายจาก Ads เช่น อายุ พื้นที่ placement ความสนใจ และ segment ที่ควรใช้ต่อ',
  compliance: 'Ad Library ใช้ตรวจ creative assets, claim, risk และ metadata ของโฆษณาก่อนนำไปใช้หรือเปิด campaign',
  overview: 'Analytics สรุป performance, funnel, revenue, ROAS, CPA และกราฟสำหรับอ่านภาพรวมธุรกิจหรือส่งออกเป็นรายงาน',
  investigator: 'Creative Insights จัดอันดับผลลัพธ์แบบ Group By เช่น creative, campaign, ad set, audience และ placement เพื่อหา winner/loser',
  actions: 'AI Marketer รวม recommendation ที่รอ approve หรือ execute พร้อมเหตุผล evidence และผลลัพธ์ก่อน/หลังจาก API',
  settings: 'Settings ใช้ตั้งค่า API keys, Meta account, connection check, system health และ readiness ก่อนดึงข้อมูลจริง',
  audit: 'Reports เก็บประวัติ action, approval, before/after และ export summary ให้ตรวจสอบย้อนหลังได้',
  appointments: 'Help Center ใช้ดู lead, booking, show-up และ operational signals ที่เชื่อม performance ads กับงานหน้าคลินิก',
}

const pageMeta: Record<TabId, { title: string; subtitle: string; icon: typeof BarChart3 }> = {
  platform: {
    title: 'AdVibes Clinic OS',
    subtitle: 'AI media-buying cockpit สำหรับ ads, creative, optimization และ reports',
    icon: Sparkles,
  },
  overview: {
    title: 'Analytics',
    subtitle: 'Business dashboard, funnel health และ one-click report',
    icon: LineChart,
  },
  appointments: {
    title: 'Help Center',
    subtitle: 'Appointment pipeline และ operational signals ของทีมคลินิก',
    icon: HelpCircle,
  },
  campaigns: {
    title: 'Ads Manager',
    subtitle: 'Meta Campaigns, Ad Sets, Ads และ delivery controls',
    icon: Zap,
  },
  investigator: {
    title: 'Creative Insights',
    subtitle: 'Creative, campaign และ audience components ranked by performance',
    icon: BarChart3,
  },
  actions: {
    title: 'AI Marketer',
    subtitle: 'Daily account audit, recommendations, approval และ before/after',
    icon: ClipboardList,
  },
  auto: {
    title: 'Optimization',
    subtitle: 'Budget protection, scale winners และ automation guardrails',
    icon: Power,
  },
  tasks: {
    title: 'Creative Studio',
    subtitle: 'Creative performance, asset work orders และ launch notes',
    icon: Layers3,
  },
  memory: {
    title: 'Audience Insights',
    subtitle: 'Age, location, platform, target names และ performance จาก Meta Ad Sets',
    icon: Users,
  },
  compliance: {
    title: 'Ad Library',
    subtitle: 'Creative assets, compliance risk และ performance metadata',
    icon: ImageIcon,
  },
  settings: {
    title: 'Settings',
    subtitle: 'ตั้งค่า API, ตรวจ connection และ system readiness',
    icon: Settings,
  },
  audit: {
    title: 'Reports',
    subtitle: 'Audit trail, one-click report และ snapshot ของ action',
    icon: Plug,
  },
}

const fmtMoney = (value: number) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(value)

const fmtNum = (value: number) => new Intl.NumberFormat('th-TH').format(value)
const fmtPct = (value: number) => `${value.toFixed(1)}%`
const safeDivide = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : 0)
const safeRate = (numerator: number, denominator: number) => (denominator > 0 ? (numerator / denominator) * 100 : 0)
const metaTemplateTokenPattern = /\{\{[^{}]+\}\}/g

function cleanMetaDisplayText(value: string | undefined, fallback = '') {
  const cleaned = String(value ?? '')
    .replace(metaTemplateTokenPattern, '')
    .replace(/\s+([·,;:])/g, '$1')
    .replace(/([·,;:])\s*([·,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·,;:\-–—]+|[\s·,;:\-–—]+$/g, '')
    .trim()

  return cleaned || fallback
}

function statusMeta(status: AiStatus) {
  if (status === 'healthy') return { label: 'Healthy', className: 'good' }
  if (status === 'watch') return { label: 'Watch', className: 'watch' }
  if (status === 'critical') return { label: 'Critical', className: 'critical' }
  return { label: 'Scale', className: 'scale' }
}

function riskClass(risk: RiskLevel) {
  return risk === 'Low' ? 'good' : risk === 'Medium' ? 'watch' : 'critical'
}

function taskClass(status: TaskStatus) {
  return status === 'done' ? 'good' : status === 'running' ? 'scale' : 'watch'
}

function autoDecisionLabel(decision: AutoDecision) {
  if (decision === 'pause') return 'Pause Ad'
  if (decision === 'enable') return 'Enable Ad'
  if (decision === 'reduceBudget') return 'Reduce Budget'
  return 'Keep Running'
}

function autoDecisionTone(decision: AutoDecision) {
  if (decision === 'pause') return 'critical'
  if (decision === 'enable') return 'good'
  if (decision === 'reduceBudget') return 'watch'
  return 'scale'
}

function deliveryStatusLabel(status: AdDeliveryStatus) {
  return status === 'active' ? 'ACTIVE' : 'PAUSED'
}

function deliveryStatusTone(status: AdDeliveryStatus) {
  return status === 'active' ? 'good' : 'critical'
}

function actionStatusLabel(status: RecommendedAction['status']) {
  if (status === 'approved') return 'Approved'
  if (status === 'executing') return 'Executing'
  if (status === 'executed') return 'Executed'
  if (status === 'failed') return 'Failed'
  if (status === 'rejected') return 'Rejected'
  return 'Pending'
}

function actionStatusTone(status: RecommendedAction['status']) {
  if (status === 'approved' || status === 'executed') return 'good'
  if (status === 'executing') return 'scale'
  if (status === 'failed' || status === 'rejected') return 'critical'
  return 'watch'
}

function nextDeliveryStatus(status: AdDeliveryStatus): AdDeliveryStatus {
  return status === 'active' ? 'paused' : 'active'
}

function toMetaObjectStatus(status: AdDeliveryStatus): MetaObjectStatus {
  return status === 'active' ? 'ACTIVE' : 'PAUSED'
}

function executionForCampaignRecommendation(campaign: CampaignInsight, type: string): RecommendedAction['execution'] | undefined {
  const normalizedType = type.toLowerCase()
  if (normalizedType.includes('budget protection') || normalizedType.includes('tracking')) {
    return {
      endpoint: '/api/meta/object-status',
      method: 'POST',
      objectType: 'campaign',
      objectId: campaign.id,
      status: 'PAUSED',
      label: 'Pause campaign in Meta',
    }
  }

  return undefined
}

function normalizeDeliveryStatus(status?: AdDeliveryStatus, spend = 0): AdDeliveryStatus {
  if (status === 'active' || status === 'paused') return status
  return spend > 0 ? 'active' : 'paused'
}

function autoAdObjectId(ad: AutoAdControl) {
  return ad.adId || ad.id.replace(/^meta-auto-/, '')
}

function buildAutoStatusCandidates(args: {
  rule: AutoRuleSettings
  campaigns: CampaignInsight[]
  adSets: AdSetInsight[]
  adInsights: WorkspaceData['adInsights']
}): AutoStatusCandidate[] {
  const rule = args.rule
  return args.adInsights
    .map((ad): AutoStatusCandidate => {
      const campaign = args.campaigns.find((item) => item.id === ad.campaignId)
      const adSet = args.adSets.find((item) => item.id === ad.adSetId)
      const currentStatus = normalizeDeliveryStatus(ad.status, ad.spend)
      let decision: AutoDecision = 'keep'
      let nextStatus: AdDeliveryStatus | null = null
      let reason = `ROAS ${ad.roas.toFixed(2)}x · spend ${fmtMoney(ad.spend)} · bookings ${fmtNum(ad.bookings)}`
      let risk: RiskLevel = 'Low'
      let confidence = Math.max(58, Math.min(88, Math.round(58 + ad.score * 3)))

      if (currentStatus === 'active' && ad.spend >= rule.minSpend && ad.bookings === 0) {
        decision = 'pause'
        nextStatus = 'paused'
        reason = `Spend ถึง ${fmtMoney(rule.minSpend)} แล้ว แต่ยังไม่มี booking tracked`
        risk = 'High'
        confidence = 86
      } else if (currentStatus === 'active' && ad.spend >= rule.minSpend && ad.roas > 0 && ad.roas < rule.pauseRoas) {
        decision = 'pause'
        nextStatus = 'paused'
        reason = `ROAS ต่ำกว่า rule (${ad.roas.toFixed(2)}x < ${rule.pauseRoas.toFixed(2)}x)`
        risk = 'Medium'
        confidence = 78
      } else if (currentStatus === 'paused' && ad.roas >= rule.scaleRoas && ad.bookings >= rule.minBookingsToReactivate) {
        decision = 'enable'
        nextStatus = 'active'
        reason = `Paused ad มี ROAS ${ad.roas.toFixed(2)}x และ booking ${fmtNum(ad.bookings)} ตาม rule`
        risk = 'Medium'
        confidence = 74
      } else if (currentStatus === 'active' && ad.roas >= rule.scaleRoas && ad.score >= 7.5) {
        reason = `ยังควร monitor: ROAS ${ad.roas.toFixed(2)}x และ score ${ad.score.toFixed(1)} อยู่ในโซนดี`
        confidence = 72
      }

      return {
        id: `auto-candidate-${ad.id}`,
        adId: ad.id,
        campaignId: ad.campaignId,
        adSetId: ad.adSetId,
        adName: ad.name,
        campaignName: campaign?.name ?? 'Unknown campaign',
        adSetName: adSet?.name ?? 'Unknown ad set',
        currentStatus,
        nextStatus,
        decision,
        reason,
        guardrail: `Rule: ${rule.label} · min spend ${fmtMoney(rule.minSpend)} · pause below ${rule.pauseRoas.toFixed(2)}x ROAS`,
        confidence,
        risk,
        spend: ad.spend,
        bookings: ad.bookings,
        clicks: ad.clicks,
        ctr: ad.ctr,
        cpc: ad.cpc,
        roas: ad.roas,
        score: ad.score,
      }
    })
    .sort((a, b) => {
      const actionSort = Number(Boolean(b.nextStatus)) - Number(Boolean(a.nextStatus))
      if (actionSort !== 0) return actionSort
      return b.spend - a.spend
    })
}

function isAutoPilotEligible(candidate: AutoStatusCandidate, rule: AutoRuleSettings) {
  if (!candidate.nextStatus) return false
  if (candidate.confidence < rule.minConfidenceToAutoPilot) return false
  if (candidate.nextStatus === 'active') return candidate.bookings >= rule.minBookingsToReactivate && candidate.roas >= rule.scaleRoas
  return candidate.spend >= rule.minSpend
}

function emptyMetaObjectFormValues(overrides: Partial<MetaObjectFormValues> = {}): MetaObjectFormValues {
  return {
    name: '',
    status: 'PAUSED',
    campaignId: '',
    adSetId: '',
    objective: 'OUTCOME_LEADS',
    dailyBudget: '',
    billingEvent: 'IMPRESSIONS',
    optimizationGoal: 'LEAD_GENERATION',
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
    countries: 'TH',
    ageMin: '20',
    ageMax: '65',
    creativeId: '',
    targetingJson: '',
    promotedObjectJson: '',
    creativeJson: '',
    extraJson: '',
    ...overrides,
  }
}

function parseOptionalJson(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    throw new Error(`${label} JSON ไม่ถูกต้อง`)
  }
}

function bahtToMetaCents(value: string) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined
}

function stripEmptyParams(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

function buildTargetingFromForm(form: MetaObjectFormValues) {
  const countries = form.countries
    .split(',')
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean)
  const ageMin = Number(form.ageMin)
  const ageMax = Number(form.ageMax)
  return stripEmptyParams({
    geo_locations: countries.length > 0 ? { countries } : undefined,
    age_min: Number.isFinite(ageMin) && ageMin > 0 ? ageMin : undefined,
    age_max: Number.isFinite(ageMax) && ageMax > 0 ? ageMax : undefined,
  })
}

function buildMetaObjectParams(request: MetaObjectMutationRequest, form: MetaObjectFormValues) {
  if (request.operation === 'delete') return {}

  const extra = parseOptionalJson(form.extraJson, 'Extra params')
  if (extra !== undefined && (typeof extra !== 'object' || Array.isArray(extra) || extra === null)) {
    throw new Error('Extra params ต้องเป็น JSON object')
  }

  const base: Record<string, unknown> = stripEmptyParams({
    name: form.name.trim(),
    status: form.status,
  })

  if (request.objectType === 'campaign') {
    Object.assign(
      base,
      stripEmptyParams({
        objective: form.objective.trim(),
        daily_budget: bahtToMetaCents(form.dailyBudget),
        bid_strategy: form.bidStrategy.trim(),
        special_ad_categories: request.operation === 'create' ? [] : undefined,
      }),
    )
  }

  if (request.objectType === 'adset') {
    const targeting = parseOptionalJson(form.targetingJson, 'Targeting') ?? buildTargetingFromForm(form)
    const promotedObject = parseOptionalJson(form.promotedObjectJson, 'Promoted object')
    Object.assign(
      base,
      stripEmptyParams({
        campaign_id: form.campaignId.trim(),
        daily_budget: bahtToMetaCents(form.dailyBudget),
        billing_event: form.billingEvent.trim(),
        optimization_goal: form.optimizationGoal.trim(),
        targeting,
        promoted_object: promotedObject,
      }),
    )
  }

  if (request.objectType === 'ad') {
    const creative = form.creativeId.trim()
      ? { creative_id: form.creativeId.trim() }
      : parseOptionalJson(form.creativeJson, 'Creative')
    Object.assign(
      base,
      stripEmptyParams({
        adset_id: form.adSetId.trim(),
        creative,
      }),
    )
  }

  return {
    ...base,
    ...((extra as Record<string, unknown> | undefined) ?? {}),
  }
}

function mutationOperationLabel(operation: MetaObjectMutationOperation) {
  if (operation === 'create') return 'Create'
  if (operation === 'update') return 'Edit'
  return 'Delete'
}

function metaObjectLabel(type: MetaObjectType) {
  if (type === 'adset') return 'Ad Set'
  if (type === 'ad') return 'Ad'
  return 'Campaign'
}

function fallbackInsightForCampaign(campaign: CampaignInsight): AIInsight {
  return {
    campaignId: campaign.id,
    whatHappened: 'Campaign นี้มาจากข้อมูลที่นำเข้า ยังไม่มี AI investigation เฉพาะรายการ',
    why: 'ระบบใช้งานจริงขั้นแรกอ่านข้อมูลจากไฟล์และคำนวณ metric ก่อน ส่วน AI analysis จริงจะต่อเพิ่มในขั้น API/LLM',
    evidence: [
      `Spend ${fmtMoney(campaign.spend)}`,
      `Revenue ${fmtMoney(campaign.revenue)}`,
      `Bookings ${fmtNum(campaign.conversions)}`,
      `ROAS ${campaign.roas.toFixed(2)}x`,
    ],
    recommendation: 'ใช้ Performance drill-down หรือสร้าง Action Queue เพื่อตรวจ campaign นี้ก่อนปรับงบจริง',
    confidence: 62,
    risk: campaign.aiStatus === 'critical' ? 'High' : campaign.aiStatus === 'watch' ? 'Medium' : 'Low',
  }
}

function buildWorkspaceRecommendations(workspace: WorkspaceData, runId: number): RecommendedAction[] {
  const defaultCampaignId = workspace.campaigns[0]?.id ?? 'meta-account'
  const campaignActions: RecommendedAction[] = workspace.campaigns.flatMap((campaign) => {
    const recommendations: RecommendedAction[] = []

    if (campaign.spend > 0 && campaign.roas < 1.6) {
      recommendations.push({
        id: `analysis-${runId}-${campaign.id}-roas`,
        campaignId: campaign.id,
        type: 'Budget protection',
        target: campaign.name,
        summary: `ROAS ${campaign.roas.toFixed(2)}x ต่ำกว่าโซนทำกำไร ควรลดงบส่วนที่เสี่ยงและตรวจ offer ก่อนใช้เงินต่อ`,
        expectedImpact: `ลด spend leakage ประมาณ 10-20% ระหว่างรอแก้ creative/landing/chat flow`,
        guardrail: 'ลดงบเฉพาะ campaign ที่มี spend และ conversion volume เพียงพอ ห้าม pause ทั้งหมดถ้ายังเป็น campaign หลักของคลินิก',
        before: `Spend ${fmtMoney(campaign.spend)} · Revenue ${fmtMoney(campaign.revenue)} · ROAS ${campaign.roas.toFixed(2)}x`,
        after: 'Reduce risky budget 15% and monitor booking quality 48 hours',
        rollbackNote: 'ถ้า booking volume หายเกิน 20% หรือ CPA ดีขึ้นไม่ชัด ให้คืนงบเดิมและทดสอบ creative ใหม่แทน',
        risk: campaign.roas < 1 ? 'High' : 'Medium',
        confidence: campaign.conversions >= 50 ? 84 : 72,
        status: 'pending',
        execution: executionForCampaignRecommendation(campaign, 'Budget protection'),
      })
    }

    if (campaign.frequency >= 5 && campaign.ctr < 1.1) {
      recommendations.push({
        id: `analysis-${runId}-${campaign.id}-fatigue`,
        campaignId: campaign.id,
        type: 'Creative refresh',
        target: campaign.name,
        summary: `Frequency ${campaign.frequency.toFixed(1)} และ CTR ${campaign.ctr.toFixed(2)}% สะท้อน creative fatigue`,
        expectedImpact: 'เพิ่ม CTR และลด CPC/CPL ด้วย angle ใหม่ที่เหมาะกับ service intent',
        guardrail: 'สร้าง creative ใหม่ก่อนลดของเดิม และคุม claim เรื่องผลลัพธ์ทางการแพทย์ให้ผ่าน compliance',
        before: `CTR ${campaign.ctr.toFixed(2)}% · Frequency ${campaign.frequency.toFixed(1)} · CPA ${fmtMoney(campaign.cpa)}`,
        after: 'Launch 3 new creative angles with limited budget split test',
        rollbackNote: 'ถ้า CTR ใหม่ต่ำกว่าเดิมหลังครบ click threshold ให้หยุดชุดทดลองและเก็บ winner เดิม',
        risk: 'Medium',
        confidence: 81,
        status: 'pending',
      })
    }

    if (campaign.roas >= 3.5 && campaign.conversions >= 50) {
      recommendations.push({
        id: `analysis-${runId}-${campaign.id}-scale`,
        campaignId: campaign.id,
        type: 'Scale opportunity',
        target: campaign.name,
        summary: `Campaign นี้มี ROAS ${campaign.roas.toFixed(2)}x และ booking volume ${fmtNum(campaign.conversions)} เหมาะกับ staged scale`,
        expectedImpact: 'เพิ่ม booking/revenue โดยไม่กระทบ CAC มากเกินไป',
        guardrail: 'เพิ่มงบทีละ 10-15% และหยุด scale หาก show-up หรือ close rate ลดลง',
        before: `Budget ${fmtMoney(campaign.budget)} · ROAS ${campaign.roas.toFixed(2)}x · Bookings ${fmtNum(campaign.conversions)}`,
        after: 'Increase budget 12% for 48-hour staged scale',
        rollbackNote: 'ถ้า CPA เพิ่มเกิน 18% หรือ ROAS ต่ำกว่า target ให้กลับงบเดิม',
        risk: 'Low',
        confidence: 86,
        status: 'pending',
      })
    }

    return recommendations
  })

  const channelActions: RecommendedAction[] = workspace.channelPerformance.flatMap((channel) => {
    const recommendations: RecommendedAction[] = []
    const showRate = safeRate(channel.showUps, channel.bookings)
    const roas = safeDivide(channel.revenue, channel.spend)

    if (channel.bookings > 0 && showRate < 70) {
      recommendations.push({
        id: `analysis-${runId}-${slugify(channel.channel, 'channel')}-showup`,
        campaignId: defaultCampaignId,
        type: 'Channel quality fix',
        target: channel.channel,
        summary: `Show-up ${fmtPct(showRate)} ต่ำกว่าเกณฑ์ ควรตรวจ lead expectation, follow-up และ reminder flow`,
        expectedImpact: 'เพิ่ม paid treatment โดยไม่ต้องเพิ่ม spend หาก booking quality ดีขึ้น',
        guardrail: 'อย่าตัด channel ทิ้งทันที ให้ดู lead quality, call SLA และ service mix ร่วมกัน',
        before: `${fmtNum(channel.bookings)} bookings · ${fmtNum(channel.showUps)} show-ups · Quality ${channel.leadQuality}/100`,
        after: 'Create CRM follow-up task and adjust pre-booking qualification',
        rollbackNote: 'ถ้า show-up ไม่ดีขึ้นใน 7 วัน ให้ลด spend หรือย้ายงบไป channel ที่ quality ดีกว่า',
        risk: showRate < 55 ? 'High' : 'Medium',
        confidence: 79,
        status: 'pending',
      })
    }

    if (channel.spend > 0 && roas >= 5 && channel.revenue > 0) {
      recommendations.push({
        id: `analysis-${runId}-${slugify(channel.channel, 'channel')}-scale`,
        campaignId: defaultCampaignId,
        type: 'Channel scale test',
        target: channel.channel,
        summary: `${channel.channel} ทำ ROAS ${roas.toFixed(2)}x มีโอกาส scale แบบคุม CAC`,
        expectedImpact: 'เพิ่ม revenue จาก channel ที่มี conversion value แข็งแรง',
        guardrail: 'เพิ่ม spend แบบ capped test และติดตาม CAC, show-up, close rate รายวัน',
        before: `Spend ${fmtMoney(channel.spend)} · Revenue ${fmtMoney(channel.revenue)} · ROAS ${roas.toFixed(2)}x`,
        after: 'Shift 10% test budget into this channel for 3 days',
        rollbackNote: 'ถ้า CAC สูงกว่าค่าเฉลี่ยหรือ show-up ลดลง ให้หยุด budget shift',
        risk: 'Low',
        confidence: 83,
        status: 'pending',
      })
    }

    return recommendations
  })

  return [...campaignActions, ...channelActions].slice(0, 8)
}

function mergeRecommendedActionState(nextActions: RecommendedAction[], currentActions: RecommendedAction[]) {
  const currentById = new Map(currentActions.map((action) => [action.id, action]))
  const nextIds = new Set(nextActions.map((action) => action.id))
  const mergedGenerated = nextActions.map((action) => {
    const current = currentById.get(action.id)
    if (!current || current.status === 'pending') return action
    return {
      ...action,
      status: current.status,
      executionError: current.executionError,
      executedAt: current.executedAt,
    }
  })
  const localOnlyActions = currentActions.filter((action) => !nextIds.has(action.id) && action.id.startsWith('perf-action-'))
  return [...localOnlyActions, ...mergedGenerated]
}

function mergeAuditTrail(nextAuditTrail: WorkspaceData['auditTrail'], currentAuditTrail: WorkspaceData['auditTrail']) {
  const seen = new Set<string>()
  return [...currentAuditTrail, ...nextAuditTrail].filter((event) => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  })
}

function mergeAiInsights(nextInsights: AIInsight[], currentInsights: AIInsight[]) {
  const nextIds = new Set(nextInsights.map((insight) => insight.campaignId))
  return [...nextInsights, ...currentInsights.filter((insight) => !nextIds.has(insight.campaignId))]
}

const WORKSPACE_STORAGE_KEY = 'clinicstellar-ai-live-workspace-v1'
const DEFAULT_META_DATE_PRESET = 'last_30d'
const datePresetOptions = [
  { value: 'today', label: 'Today', group: 'Current' },
  { value: 'yesterday', label: 'Yesterday', group: 'Current' },
  { value: 'last_7d', label: '7 days', group: 'Recent' },
  { value: 'last_14d', label: '14 days', group: 'Recent' },
  { value: 'last_30d', label: '30 days', group: 'Recent' },
  { value: 'last_90d', label: '90 days', group: 'Extended' },
  { value: 'this_month', label: 'This month', group: 'Month' },
  { value: 'last_month', label: 'Last month', group: 'Month' },
  { value: 'maximum', label: 'All time', group: 'Lifetime' },
]

function datePresetLabel(value: string) {
  return datePresetOptions.find((option) => option.value === value)?.label ?? value
}

type FieldUpdate<T> = T | ((current: T) => T)

interface MetaSyncState {
  configured: boolean
  connected: boolean
  loading: boolean
  checking: boolean
  error: string | null
  accountName: string | null
  adAccountId: string | null
  graphVersion: string
  datePreset: string
  fetchedAt: string | null
  lastStatusCheckAt: string | null
  checkResult: MetaCheckPayload | null
  envChecks: MetaEnvCheck[]
  counts: {
    campaigns: number
    adSets: number
    ads: number
    timeSeries: number
  } | null
}

interface MetaStatusPayload {
  configured?: boolean
  connected?: boolean
  graphVersion?: string
  adAccountId?: string | null
  datePreset?: string
  requiredEnv?: MetaEnvCheck[]
}

interface MetaWorkspacePayload {
  workspace: WorkspaceData
  meta: {
    account?: { name?: string; account_id?: string }
    datePreset?: string
    graphVersion?: string
    fetchedAt?: string
    counts?: MetaSyncState['counts']
  }
}

interface MetaConfigPayload {
  configured?: boolean
  settingsSource?: 'web-settings' | 'server-env' | null
  hasSavedToken?: boolean
  adAccountId?: string
  graphVersion?: string
  datePreset?: string
  maxPages?: number
  requiredEnv?: MetaEnvCheck[]
}

interface MetaConfigFormValues {
  accessToken: string
  adAccountId: string
  graphVersion: string
  datePreset: string
  maxPages: number
}

interface MetaEnvCheck {
  key: string
  present: boolean
  source: string
  help: string
}

interface MetaCheckItem {
  key: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

interface MetaCheckPayload {
  ok: boolean
  checkedAt: string
  durationMs?: number
  graphVersion?: string
  datePreset?: string
  adAccountId?: string | null
  user?: { id: string; name: string } | null
  account?: {
    id?: string
    account_id?: string
    name?: string
    currency?: string
    account_status?: number
    timezone_name?: string
  } | null
  checks: MetaCheckItem[]
  error?: string
}

interface DeliveryStatusChangeRequest {
  objectType: MetaObjectType
  objectId: string
  targetName: string
  currentStatus: AdDeliveryStatus
  nextStatus: AdDeliveryStatus
  summary: string
  source: 'campaigns' | 'ads-auto'
}

interface MetaObjectStatusPayload {
  ok: boolean
  objectType: MetaObjectType
  objectId: string
  status: MetaObjectStatus
  checkedAt: string
  error?: string
}

interface MetaBulkStatusPayload {
  ok: boolean
  count: number
  checkedAt: string
  results: MetaObjectStatusPayload[]
  error?: string
}

type MetaObjectMutationOperation = 'create' | 'update' | 'delete'

interface MetaObjectMutationRequest {
  operation: MetaObjectMutationOperation
  objectType: MetaObjectType
  objectId?: string
  targetName: string
  initialValues: MetaObjectFormValues
}

interface MetaObjectFormValues {
  name: string
  status: MetaObjectStatus
  campaignId: string
  adSetId: string
  objective: string
  dailyBudget: string
  billingEvent: string
  optimizationGoal: string
  bidStrategy: string
  countries: string
  ageMin: string
  ageMax: string
  creativeId: string
  targetingJson: string
  promotedObjectJson: string
  creativeJson: string
  extraJson: string
}

interface MetaObjectMutationPayload {
  ok: boolean
  operation: MetaObjectMutationOperation
  objectType: MetaObjectType
  objectId: string | null
  checkedAt: string
  error?: string
}

interface CreativeLaunchFormValues {
  pageId: string
  adSetId: string
  adName: string
  creativeName: string
  linkUrl: string
  primaryText: string
  headline: string
  description: string
  ctaType: string
  status: MetaObjectStatus
}

interface CreativeLaunchPayload {
  ok: boolean
  creativeId: string
  adId: string | null
  adSetId: string
  status: MetaObjectStatus
  checkedAt: string
  error?: string
}

interface AiStatusPayload {
  configured?: boolean
  connected?: boolean
  model?: string
  source?: string
  tokenLocation?: 'server-env' | 'local-env-file' | null
  requiredEnv?: MetaEnvCheck[]
  error?: string
}

interface AiRuntimeState {
  configured: boolean
  connected: boolean
  loading: boolean
  model: string
  source: string
  tokenLocation: string | null
  lastCheckedAt: string | null
  error: string | null
  envChecks: MetaEnvCheck[]
}

interface AiMarketerPayload {
  ok: boolean
  source: string
  model: string
  durationMs: number
  checkedAt: string
  summary: string
  modelNotes: string[]
  insights: AIInsight[]
  actions: RecommendedAction[]
  error?: string
}

interface AiCreativeKitResult {
  summary: string
  brief: {
    objective: string
    audience: string
    offer: string
    positioning: string
  }
  hooks: string[]
  primaryTexts: string[]
  headlines: string[]
  descriptions: string[]
  launchNotes: string[]
  complianceNotes: string[]
  recommendedCta: string
  workOrders: Array<{
    title: string
    owner: string
    inputContext: string
    expectedOutput: string
  }>
}

interface AiCreativePayload {
  ok: boolean
  source: string
  model: string
  durationMs: number
  checkedAt: string
  result: AiCreativeKitResult
  error?: string
}

type CampaignControlScope = MetaObjectType
type InsightGroupBy = 'creative' | 'campaign' | 'adset' | 'ad' | 'service' | 'objective' | 'status'
type AutoRulePreset = 'balanced' | 'protect' | 'scale'
type AutoQueueFilter = 'all' | 'action' | 'pause' | 'enable' | 'monitor'

interface AutoRuleSettings {
  label: string
  description: string
  minSpend: number
  pauseRoas: number
  scaleRoas: number
  minBookingsToReactivate: number
  minConfidenceToAutoPilot: number
  maxActionsPerRun: number
}

interface InsightTableRow {
  id: string
  kind: AiInsightDrawerContext['kind']
  campaignId: string
  title: string
  subtitle: string
  count: number
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

interface AutoStatusCandidate {
  id: string
  adId: string
  campaignId: string
  adSetId: string
  adName: string
  campaignName: string
  adSetName: string
  currentStatus: AdDeliveryStatus
  nextStatus: AdDeliveryStatus | null
  decision: AutoDecision
  reason: string
  guardrail: string
  confidence: number
  risk: RiskLevel
  spend: number
  bookings: number
  clicks: number
  ctr: number
  cpc: number
  roas: number
  score: number
}

interface BulkAutoExecutionRequest {
  candidates: AutoStatusCandidate[]
}

const insightGroupOptions: Array<{ value: InsightGroupBy; label: string; description: string }> = [
  { value: 'creative', label: 'Creative', description: 'Images / videos / angles' },
  { value: 'campaign', label: 'Campaign', description: 'Meta campaign level' },
  { value: 'adset', label: 'Ad Set', description: 'Audience and budget set' },
  { value: 'ad', label: 'Ad', description: 'Single ad performance' },
  { value: 'service', label: 'Service', description: 'Clinic service grouping' },
  { value: 'objective', label: 'Objective', description: 'Meta objective grouping' },
  { value: 'status', label: 'Status', description: 'ACTIVE / PAUSED grouping' },
]

const campaignObjectiveOptions = [
  { value: 'OUTCOME_LEADS', label: 'Leads', description: 'เก็บ lead / appointment จากฟอร์ม, chat หรือเว็บไซต์' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic', description: 'ส่งคนเข้า landing page หรือ LINE OA' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement', description: 'เน้น message, inbox หรือ interaction' },
  { value: 'OUTCOME_SALES', label: 'Sales', description: 'ใช้เมื่อมี conversion purchase/treatment value ชัดเจน' },
]

const budgetQuickOptions = ['300', '500', '1000', '2000']
const statusOptions: Array<{ value: MetaObjectStatus; label: string; description: string }> = [
  { value: 'PAUSED', label: 'Draft / Paused', description: 'ปลอดภัยสำหรับสร้างหรือแก้ก่อนเปิดส่งจริง' },
  { value: 'ACTIVE', label: 'Active', description: 'เปิดส่งจริงหลัง Meta รับคำสั่งสำเร็จ' },
]

const bidStrategyOptions = [
  { value: 'LOWEST_COST_WITHOUT_CAP', label: 'Lowest cost', description: 'ให้ Meta หา result ราคาต่ำสุดโดยไม่กำหนด cap' },
  { value: 'LOWEST_COST_WITH_BID_CAP', label: 'Bid cap', description: 'ใช้เมื่อมี bid cap ใน Extra Params' },
  { value: 'COST_CAP', label: 'Cost cap', description: 'ควบคุมต้นทุนเฉลี่ยต่อ result' },
]

const billingEventOptions = [
  { value: 'IMPRESSIONS', label: 'Impressions', description: 'คิดตามการแสดงผล ใช้บ่อยกับ campaign ส่วนใหญ่' },
  { value: 'LINK_CLICKS', label: 'Link clicks', description: 'ใช้เมื่อ optimization เน้นคลิก' },
]

const optimizationGoalOptions = [
  { value: 'LEAD_GENERATION', label: 'Lead', description: 'เหมาะกับคลินิกที่เก็บ lead/booking' },
  { value: 'CONVERSATIONS', label: 'Messages', description: 'เหมาะกับ LINE/inbox/chat' },
  { value: 'LINK_CLICKS', label: 'Clicks', description: 'เหมาะกับ traffic ไป landing page' },
  { value: 'OFFSITE_CONVERSIONS', label: 'Conversion', description: 'ใช้เมื่อ pixel/conversion tracking พร้อม' },
]

const agePresetOptions = [
  { label: '20-45', min: '20', max: '45' },
  { label: '25-55', min: '25', max: '55' },
  { label: '20-65', min: '20', max: '65' },
  { label: '35-65', min: '35', max: '65' },
]

const autoRulePresets: Record<
  AutoRulePreset,
  AutoRuleSettings
> = {
  balanced: {
    label: 'Balanced',
    description: 'เหมาะกับการใช้งานประจำวัน หยุดตัวเปลือง และเปิดตัวที่มีหลักฐานพอ',
    minSpend: 500,
    pauseRoas: 1,
    scaleRoas: 3,
    minBookingsToReactivate: 2,
    minConfidenceToAutoPilot: 78,
    maxActionsPerRun: 5,
  },
  protect: {
    label: 'Protect Budget',
    description: 'เข้มขึ้น เหมาะกับช่วงคุมงบหรือไม่อยากให้ ads เปลืองเงิน',
    minSpend: 300,
    pauseRoas: 0.8,
    scaleRoas: 2.5,
    minBookingsToReactivate: 1,
    minConfidenceToAutoPilot: 80,
    maxActionsPerRun: 8,
  },
  scale: {
    label: 'Scale Winners',
    description: 'เน้นหา ads ที่ควรเปิดกลับหรือปล่อยให้วิ่งต่อเมื่อ ROAS สูง',
    minSpend: 1000,
    pauseRoas: 1.2,
    scaleRoas: 3.5,
    minBookingsToReactivate: 3,
    minConfidenceToAutoPilot: 82,
    maxActionsPerRun: 4,
  },
}

function nowLabel() {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())
}

function pickArray<T>(value: unknown, fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback
  return value as T[]
}

function normalizeAudienceTargeting(input: AudienceTargeting | undefined): AudienceTargeting | undefined {
  if (!input) return undefined
  return {
    ageMin: Number.isFinite(input.ageMin) ? input.ageMin : undefined,
    ageMax: Number.isFinite(input.ageMax) ? input.ageMax : undefined,
    genders: pickArray<string>(input.genders, []),
    publisherPlatforms: pickArray<string>(input.publisherPlatforms, []),
    placements: pickArray<string>(input.placements, []),
    devicePlatforms: pickArray<string>(input.devicePlatforms, []),
    geoLocations: pickArray<AudienceGeoTarget>(input.geoLocations, []),
    interests: pickArray<AudienceTarget>(input.interests, []),
    exclusions: pickArray<AudienceTarget>(input.exclusions, []),
    locales: pickArray<string>(input.locales, []),
    rawSummary: cleanMetaDisplayText(input.rawSummary, input.rawSummary),
  }
}

function normalizeWorkspaceData(input?: Partial<WorkspaceData> | null): WorkspaceData {
  return {
    ...emptyWorkspaceData,
    ...input,
    campaigns: pickArray<CampaignInsight>(input?.campaigns, emptyWorkspaceData.campaigns).map((campaign) => ({
      ...campaign,
      name: cleanMetaDisplayText(campaign.name, 'Meta campaign'),
      aiSummary: cleanMetaDisplayText(campaign.aiSummary, campaign.aiSummary),
    })),
    serviceLines: pickArray<ServiceLine>(input?.serviceLines, emptyWorkspaceData.serviceLines),
    appointmentStages: pickArray<AppointmentStage>(input?.appointmentStages, emptyWorkspaceData.appointmentStages),
    complianceReviews: pickArray<ComplianceReview>(input?.complianceReviews, emptyWorkspaceData.complianceReviews).map((review) => ({
      ...review,
      title: cleanMetaDisplayText(review.title, 'Meta creative'),
      service: cleanMetaDisplayText(review.service, review.service),
      issue: cleanMetaDisplayText(review.issue, review.issue),
      fix: cleanMetaDisplayText(review.fix, review.fix),
      source: cleanMetaDisplayText(review.source, review.source),
    })),
    insights: pickArray<AIInsight>(input?.insights, emptyWorkspaceData.insights),
    insightComponents: pickArray(input?.insightComponents, emptyWorkspaceData.insightComponents).map((component) => ({
      ...component,
      title: cleanMetaDisplayText(component.title, 'Meta creative'),
      service: cleanMetaDisplayText(component.service, component.service),
    })),
    adSets: pickArray(input?.adSets, emptyWorkspaceData.adSets).map((adSet) => ({
      ...adSet,
      name: cleanMetaDisplayText(adSet.name, 'Meta ad set'),
      audience: cleanMetaDisplayText(adSet.audience, adSet.audience),
      audienceTargeting: normalizeAudienceTargeting(adSet.audienceTargeting),
    })),
    adInsights: pickArray(input?.adInsights, emptyWorkspaceData.adInsights).map((ad) => ({
      ...ad,
      name: cleanMetaDisplayText(ad.name, 'Meta ad'),
      creative: cleanMetaDisplayText(ad.creative, 'Meta creative'),
    })),
    actions: pickArray<RecommendedAction>(input?.actions, emptyWorkspaceData.actions).map((action) => ({
      ...action,
      target: cleanMetaDisplayText(action.target, action.target),
      summary: cleanMetaDisplayText(action.summary, action.summary),
      before: cleanMetaDisplayText(action.before, action.before),
      after: cleanMetaDisplayText(action.after, action.after),
    })),
    autoAds: pickArray<AutoAdControl>(input?.autoAds, emptyWorkspaceData.autoAds).map((ad) => ({
      ...ad,
      adName: cleanMetaDisplayText(ad.adName, 'Meta ad'),
      reason: cleanMetaDisplayText(ad.reason, ad.reason),
      before: cleanMetaDisplayText(ad.before, ad.before),
      after: cleanMetaDisplayText(ad.after, ad.after),
    })),
    tasks: pickArray(input?.tasks, emptyWorkspaceData.tasks).map((task) => ({
      ...task,
      sourceCampaign: cleanMetaDisplayText(task.sourceCampaign, task.sourceCampaign),
      inputContext: cleanMetaDisplayText(task.inputContext, task.inputContext),
      expectedOutput: cleanMetaDisplayText(task.expectedOutput, task.expectedOutput),
      result: cleanMetaDisplayText(task.result, task.result),
    })),
    memoryItems: pickArray<MemoryItem>(input?.memoryItems, emptyWorkspaceData.memoryItems).map((item) => ({
      ...item,
      title: cleanMetaDisplayText(item.title, item.title),
      detail: cleanMetaDisplayText(item.detail, item.detail),
      source: cleanMetaDisplayText(item.source, item.source),
    })),
    auditTrail: pickArray(input?.auditTrail, emptyWorkspaceData.auditTrail).map((event) => ({
      ...event,
      action: cleanMetaDisplayText(event.action, event.action),
      target: cleanMetaDisplayText(event.target, event.target),
      before: cleanMetaDisplayText(event.before, event.before),
      after: cleanMetaDisplayText(event.after, event.after),
      reason: cleanMetaDisplayText(event.reason, event.reason),
    })),
    trendData: pickArray<TrendPoint>(input?.trendData, emptyWorkspaceData.trendData),
    channelPerformance: pickArray<ChannelPerformance>(input?.channelPerformance, emptyWorkspaceData.channelPerformance),
    funnelMetrics: pickArray(input?.funnelMetrics, emptyWorkspaceData.funnelMetrics),
    autoMode: input?.autoMode === 'autoPilot' ? 'autoPilot' : 'suggest',
    updatedAt: input?.updatedAt ?? nowLabel(),
  }
}

function loadStoredWorkspace() {
  if (typeof window === 'undefined') return emptyWorkspaceData

  try {
    const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!stored) return emptyWorkspaceData
    return normalizeWorkspaceData(JSON.parse(stored))
  } catch {
    return emptyWorkspaceData
  }
}

function usePersistentWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceData>(() => loadStoredWorkspace())

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace))
  }, [workspace])

  return [workspace, setWorkspace] as const
}

function updateField<T>(current: T, update: FieldUpdate<T>) {
  return typeof update === 'function' ? (update as (value: T) => T)(current) : update
}

function slugify(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ก-ฮ]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function useMascotGsapMotion(activeTab: TabId) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduceMotion.matches) return

    let cleanup: (() => void) | undefined
    let cancelled = false

    void import('gsap').then(({ gsap }) => {
      if (cancelled) return
      let hoverCleanup: (() => void) | undefined
      document.documentElement.dataset.gsapMotion = 'ready'

      const ctx = gsap.context(() => {
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(
            [
              '.assistant-status-strip',
              '.panel',
              '.insights-card',
              '.metric-card',
              '.app-module-card',
              '.campaign-list button',
              '.insights-table tbody tr',
              '.studio-creative-row',
              '.audience-detail-card',
              '.audience-snapshot',
            ].join(', '),
          ),
        ).slice(0, 28)

        gsap.fromTo(
          '.topbar-title, .topbar-actions',
          { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power2.out', stagger: 0.05, clearProps: 'all' },
        )

        gsap.fromTo(
          cards,
          { autoAlpha: 0, y: 12, scale: 0.992 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.46,
            ease: 'power2.out',
            stagger: { each: 0.025, from: 'start' },
            clearProps: 'all',
          },
        )

        const accentTargets = cards
        const listeners = accentTargets.map((target) => {
          const enter = () => gsap.to(target, { '--accent-progress': 1, duration: 0.28, ease: 'power2.out', overwrite: 'auto' })
          const leave = () => gsap.to(target, { '--accent-progress': 0.16, duration: 0.24, ease: 'power2.out', overwrite: 'auto' })
          target.addEventListener('pointerenter', enter)
          target.addEventListener('pointerleave', leave)
          return () => {
            target.removeEventListener('pointerenter', enter)
            target.removeEventListener('pointerleave', leave)
          }
        })

        hoverCleanup = () => {
          listeners.forEach((remove) => remove())
        }
      })

      cleanup = () => {
        hoverCleanup?.()
        ctx.revert()
        delete document.documentElement.dataset.gsapMotion
      }
    })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [activeTab])
}

function App() {
  const [workspace, setWorkspace] = usePersistentWorkspace()
  const [activeTab, setActiveTab] = useState<TabId>('platform')
  const [selectedCampaignId, setSelectedCampaignId] = useState(workspace.campaigns[0]?.id ?? '')
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [metaSync, setMetaSync] = useState<MetaSyncState>({
    configured: false,
    connected: false,
    loading: false,
    checking: false,
    error: null,
    accountName: null,
    adAccountId: null,
    graphVersion: 'checking',
    datePreset: DEFAULT_META_DATE_PRESET,
    fetchedAt: null,
    lastStatusCheckAt: null,
    checkResult: null,
    envChecks: [],
    counts: null,
  })
  const [aiRuntime, setAiRuntime] = useState<AiRuntimeState>({
    configured: false,
    connected: false,
    loading: false,
    model: 'checking',
    source: 'OpenAI Responses API',
    tokenLocation: null,
    lastCheckedAt: null,
    error: null,
    envChecks: [],
  })
  const [aiMarketerRun, setAiMarketerRun] = useState<{
    running: boolean
    error: string | null
    summary: string
    modelNotes: string[]
    lastRunAt: string | null
  }>({
    running: false,
    error: null,
    summary: '',
    modelNotes: [],
    lastRunAt: null,
  })
  const autoMetaSyncRef = useRef(false)
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [approvalExecutionState, setApprovalExecutionState] = useState<{ running: boolean; error: string | null }>({
    running: false,
    error: null,
  })
  const [performanceDrilldown, setPerformanceDrilldown] = useState<PerformanceDrilldown | null>(null)
  const [aiInsightDrawer, setAiInsightDrawer] = useState<AiInsightDrawerContext | null>(null)
  const [statusChangeRequest, setStatusChangeRequest] = useState<DeliveryStatusChangeRequest | null>(null)
  const [statusChangeState, setStatusChangeState] = useState<{ running: boolean; error: string | null }>({
    running: false,
    error: null,
  })
  const [objectMutationRequest, setObjectMutationRequest] = useState<MetaObjectMutationRequest | null>(null)
  const [objectMutationState, setObjectMutationState] = useState<{ running: boolean; error: string | null }>({
    running: false,
    error: null,
  })
  const [bulkAutoRequest, setBulkAutoRequest] = useState<BulkAutoExecutionRequest | null>(null)
  const [bulkAutoState, setBulkAutoState] = useState<{ running: boolean; error: string | null }>({
    running: false,
    error: null,
  })

  const {
    campaigns,
    serviceLines,
    appointmentStages,
    complianceReviews,
    insights,
    insightComponents,
    adSets,
    adInsights,
    actions,
    autoAds,
    tasks,
    memoryItems,
    auditTrail,
    trendData,
    channelPerformance,
    funnelMetrics,
    autoMode,
  } = workspace

  const updateWorkspaceField = <K extends keyof WorkspaceData>(key: K, update: FieldUpdate<WorkspaceData[K]>) => {
    setWorkspace((current) => ({
      ...current,
      [key]: updateField(current[key], update),
      updatedAt: nowLabel(),
    }))
  }

  const setActions = (update: FieldUpdate<RecommendedAction[]>) => updateWorkspaceField('actions', update)
  const setAutoAds = (update: FieldUpdate<AutoAdControl[]>) => updateWorkspaceField('autoAds', update)
  const setAuditTrail = (update: FieldUpdate<WorkspaceData['auditTrail']>) => updateWorkspaceField('auditTrail', update)
  const setAutoMode = (mode: AutomationMode) => updateWorkspaceField('autoMode', mode)

  const activeSelectedCampaignId = campaigns.some((campaign) => campaign.id === selectedCampaignId)
    ? selectedCampaignId
    : campaigns[0]?.id ?? ''
  const selectedCampaign = campaigns.find((campaign) => campaign.id === activeSelectedCampaignId) ?? campaigns[0] ?? null
  const selectedInsight = selectedCampaign
    ? insights.find((insight) => insight.campaignId === selectedCampaign.id) ?? fallbackInsightForCampaign(selectedCampaign)
    : null
  const hasPerformanceData =
    campaigns.length > 0 || trendData.length > 0 || channelPerformance.length > 0 || funnelMetrics.length > 0

  const totals = useMemo(() => {
    const campaignSpend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0)
    const campaignRevenue = campaigns.reduce((sum, campaign) => sum + campaign.revenue, 0)
    const campaignConversions = campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
    const channelSpend = channelPerformance.reduce((sum, channel) => sum + channel.spend, 0)
    const channelRevenue = channelPerformance.reduce((sum, channel) => sum + channel.revenue, 0)
    const channelBookings = channelPerformance.reduce((sum, channel) => sum + channel.bookings, 0)
    const spend = campaignSpend || channelSpend
    const revenue = campaignRevenue || channelRevenue
    const conversions = campaignConversions || channelBookings
    return {
      spend,
      revenue,
      conversions,
      roas: safeDivide(revenue, spend),
      cpa: safeDivide(spend, conversions),
      watchCount: campaigns.filter((campaign) => campaign.aiStatus === 'watch' || campaign.aiStatus === 'critical').length,
    }
  }, [campaigns, channelPerformance])

  const pendingActions = actions.filter((action) => action.status === 'pending').length
  const autoPending = autoAds.filter((ad) => !ad.applied && ad.recommendation !== 'keep').length
  const activeAutoAds = autoAds.filter((ad) => ad.status === 'active').length
  const assistantRecordLabel = metaSync.counts
    ? `${fmtNum(metaSync.counts.campaigns)} campaigns · ${fmtNum(metaSync.counts.adSets)} ad sets · ${fmtNum(metaSync.counts.ads)} ads`
    : `${fmtNum(campaigns.length)} campaigns · ${fmtNum(adSets.length)} ad sets · ${fmtNum(adInsights.length)} ads`

  const rejectAction = (id: string) => {
    const target = actions.find((action) => action.id === id)
    if (!target) return

    setActions((current) => current.map((action) => (action.id === id ? { ...action, status: 'rejected' } : action)))
    setAuditTrail((current) => [
      {
        id: `audit-reject-${id}`,
        actor: 'Current user',
        action: 'Rejected recommendation',
        target: target.target,
        before: target.before,
        after: 'No change executed',
        reason: target.summary,
        timestamp: 'เมื่อสักครู่',
      },
      ...current,
    ])
  }

  const approveRecommendedAction = async (id: string) => {
    const target = actions.find((action) => action.id === id)
    if (!target) return

    if (!target.execution) {
      setActions((current) => current.map((action) => (action.id === id ? { ...action, status: 'approved', executionError: undefined } : action)))
      setAuditTrail((current) => [
        {
          id: `audit-approve-${id}`,
          actor: 'Current user',
          action: `${target.type} approved`,
          target: target.target,
          before: target.before,
          after: target.after,
          reason: target.summary,
          timestamp: 'เมื่อสักครู่',
        },
        ...current,
      ])
      setApprovalExecutionState({ running: false, error: null })
      setApprovalRequest(null)
      return
    }
    const execution = target.execution

    setApprovalExecutionState({ running: true, error: null })
    setActions((current) => current.map((action) => (action.id === id ? { ...action, status: 'executing', executionError: undefined } : action)))

    try {
      const response = await fetch(execution.endpoint, {
        method: execution.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          execution.endpoint === '/api/meta/object-status'
            ? {
                objectType: execution.objectType,
                objectId: execution.objectId,
                status: execution.status,
              }
            : {
                operation: execution.operation ?? 'update',
                objectType: execution.objectType,
                objectId: execution.objectId,
                params: execution.params ?? {},
              },
        ),
      })
      const payload = (await response.json()) as { error?: string; ok?: boolean }
      if (!response.ok || payload.error || payload.ok === false) {
        throw new Error(payload.error || 'Action execution failed')
      }

      const nextDeliveryStatus: AdDeliveryStatus | null =
        execution.endpoint === '/api/meta/object-status' && execution.status
          ? execution.status === 'ACTIVE'
            ? 'active'
            : 'paused'
          : null

      setWorkspace((current) => ({
        ...current,
        campaigns: current.campaigns.map((campaign) =>
          nextDeliveryStatus && execution.objectType === 'campaign' && campaign.id === execution.objectId
            ? { ...campaign, deliveryStatus: nextDeliveryStatus }
            : campaign,
        ),
        adSets: current.adSets.map((adSet) =>
          nextDeliveryStatus && execution.objectType === 'adset' && adSet.id === execution.objectId
            ? { ...adSet, deliveryStatus: nextDeliveryStatus }
            : adSet,
        ),
        adInsights: current.adInsights.map((ad) =>
          nextDeliveryStatus && execution.objectType === 'ad' && ad.id === execution.objectId
            ? { ...ad, status: nextDeliveryStatus }
            : ad,
        ),
        autoAds: current.autoAds.map((ad) =>
          nextDeliveryStatus && execution.objectType === 'ad' && autoAdObjectId(ad) === execution.objectId
            ? { ...ad, status: nextDeliveryStatus, applied: true }
            : ad,
        ),
        actions: current.actions.map((action) =>
          action.id === id
            ? {
                ...action,
                status: 'executed',
                executionError: undefined,
                executedAt: nowLabel(),
              }
            : action,
        ),
        auditTrail: [
          {
            id: `audit-execute-${id}-${Date.now()}`,
            actor: 'Action Queue',
            action: execution.label,
            target: target.target,
            before: target.before,
            after: execution.endpoint === '/api/meta/object-status' ? `Meta ${execution.objectType} status ${execution.status}` : target.after,
            reason: target.summary,
            timestamp: nowLabel(),
          },
          ...current.auditTrail,
        ],
        updatedAt: nowLabel(),
      }))
      setApprovalExecutionState({ running: false, error: null })
      setApprovalRequest(null)
      void handleSyncMetaWorkspace()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action execution failed'
      setActions((current) =>
        current.map((action) => (action.id === id ? { ...action, status: 'failed', executionError: message } : action)),
      )
      setAuditTrail((current) => [
        {
          id: `audit-execute-failed-${id}-${Date.now()}`,
          actor: 'Action Queue',
          action: `${execution.label} failed`,
          target: target.target,
          before: target.before,
          after: 'No Meta change executed',
          reason: message,
          timestamp: nowLabel(),
        },
        ...current,
      ])
      setApprovalExecutionState({ running: false, error: message })
    }
  }

  const applyAutoDecision = (id: string) => {
    const target = autoAds.find((ad) => ad.id === id)
    if (!target || target.applied) return

    const nextStatus: AdDeliveryStatus =
      target.recommendation === 'pause' ? 'paused' : target.recommendation === 'enable' ? 'active' : target.status

    setAutoAds((current) =>
      current.map((ad) =>
        ad.id === id
          ? {
              ...ad,
              status: nextStatus,
              applied: true,
            }
          : ad,
      ),
    )

    setAuditTrail((current) => [
      {
        id: `audit-auto-${id}`,
        actor: autoMode === 'autoPilot' ? 'AI Auto Ads' : 'Current user',
        action: `${autoDecisionLabel(target.recommendation)} staged`,
        target: target.adName,
        before: target.before,
        after: target.after,
        reason: target.reason,
        timestamp: 'เมื่อสักครู่',
      },
      ...current,
    ])
  }

  const requestDeliveryStatusChange = (request: DeliveryStatusChangeRequest) => {
    setStatusChangeState({ running: false, error: null })
    setStatusChangeRequest(request)
  }

  const confirmDeliveryStatusChange = async () => {
    if (!statusChangeRequest) return

    setStatusChangeState({ running: true, error: null })
    const metaStatus = toMetaObjectStatus(statusChangeRequest.nextStatus)

    try {
      const response = await fetch('/api/meta/object-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          objectType: statusChangeRequest.objectType,
          objectId: statusChangeRequest.objectId,
          status: metaStatus,
        }),
      })
      const payload = (await response.json()) as Partial<MetaObjectStatusPayload>
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Meta status update failed')
      }

      const nextStatus = statusChangeRequest.nextStatus
      setWorkspace((current) => ({
        ...current,
        campaigns: current.campaigns.map((campaign) =>
          statusChangeRequest.objectType === 'campaign' && campaign.id === statusChangeRequest.objectId
            ? { ...campaign, deliveryStatus: nextStatus }
            : campaign,
        ),
        adSets: current.adSets.map((adSet) =>
          statusChangeRequest.objectType === 'adset' && adSet.id === statusChangeRequest.objectId
            ? { ...adSet, deliveryStatus: nextStatus }
            : adSet,
        ),
        adInsights: current.adInsights.map((ad) =>
          statusChangeRequest.objectType === 'ad' && ad.id === statusChangeRequest.objectId ? { ...ad, status: nextStatus } : ad,
        ),
        autoAds: current.autoAds.map((ad) =>
          statusChangeRequest.objectType === 'ad' && autoAdObjectId(ad) === statusChangeRequest.objectId
            ? { ...ad, status: nextStatus, applied: true }
            : ad,
        ),
        auditTrail: [
          {
            id: `audit-meta-status-${Date.now()}`,
            actor: statusChangeRequest.source === 'ads-auto' ? 'Ads Auto' : 'Current user',
            action: `Meta ${statusChangeRequest.objectType} status ${metaStatus}`,
            target: statusChangeRequest.targetName,
            before: `Status ${deliveryStatusLabel(statusChangeRequest.currentStatus)}`,
            after: `Status ${metaStatus}`,
            reason: statusChangeRequest.summary,
            timestamp: nowLabel(),
          },
          ...current.auditTrail,
        ],
        updatedAt: nowLabel(),
      }))
      setStatusChangeRequest(null)
      setStatusChangeState({ running: false, error: null })
      void handleSyncMetaWorkspace()
    } catch (error) {
      setStatusChangeState({
        running: false,
        error: error instanceof Error ? error.message : 'Meta status update failed',
      })
    }
  }

  const requestMetaObjectMutation = (request: MetaObjectMutationRequest) => {
    setObjectMutationState({ running: false, error: null })
    setObjectMutationRequest(request)
  }

  const confirmMetaObjectMutation = async (form: MetaObjectFormValues) => {
    if (!objectMutationRequest) return

    setObjectMutationState({ running: true, error: null })

    try {
      const params = buildMetaObjectParams(objectMutationRequest, form)
      const response = await fetch('/api/meta/object', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: objectMutationRequest.operation,
          objectType: objectMutationRequest.objectType,
          objectId: objectMutationRequest.objectId,
          params,
        }),
      })
      const payload = (await response.json()) as Partial<MetaObjectMutationPayload>
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Meta object mutation failed')
      }

      setAuditTrail((current) => [
        {
          id: `audit-meta-object-${Date.now()}`,
          actor: 'Current user',
          action: `${mutationOperationLabel(objectMutationRequest.operation)} ${metaObjectLabel(objectMutationRequest.objectType)}`,
          target: objectMutationRequest.targetName || form.name || payload.objectId || '-',
          before: objectMutationRequest.operation === 'create' ? 'No object' : `Meta object ${objectMutationRequest.objectId}`,
          after:
            objectMutationRequest.operation === 'delete'
              ? 'Deleted from Meta'
              : `Meta object ${payload.objectId ?? objectMutationRequest.objectId ?? 'created/updated'}`,
          reason: 'Executed from Campaigns object manager',
          timestamp: nowLabel(),
        },
        ...current,
      ])
      setObjectMutationRequest(null)
      setObjectMutationState({ running: false, error: null })
      void handleSyncMetaWorkspace()
    } catch (error) {
      setObjectMutationState({
        running: false,
        error: error instanceof Error ? error.message : 'Meta object mutation failed',
      })
    }
  }

  const requestBulkAutoExecution = (candidates: AutoStatusCandidate[]) => {
    setBulkAutoState({ running: false, error: null })
    setBulkAutoRequest({ candidates })
  }

  const confirmBulkAutoExecution = async () => {
    if (!bulkAutoRequest) return

    setBulkAutoState({ running: true, error: null })

    try {
      const actions = bulkAutoRequest.candidates
        .filter((candidate): candidate is AutoStatusCandidate & { nextStatus: AdDeliveryStatus } => Boolean(candidate.nextStatus))
        .map((candidate) => ({
          objectType: 'ad',
          objectId: candidate.adId,
          status: toMetaObjectStatus(candidate.nextStatus),
        }))

      if (actions.length === 0) {
        throw new Error('No Ads Auto actions selected')
      }

      const response = await fetch('/api/meta/bulk-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actions }),
      })
      const payload = (await response.json()) as Partial<MetaBulkStatusPayload>
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Bulk Ads Auto execution failed')
      }

      const nextStatusByAdId = new Map(
        bulkAutoRequest.candidates
          .filter((candidate): candidate is AutoStatusCandidate & { nextStatus: AdDeliveryStatus } => Boolean(candidate.nextStatus))
          .map((candidate) => [candidate.adId, candidate.nextStatus]),
      )

      setWorkspace((current) => ({
        ...current,
        adInsights: current.adInsights.map((ad) => {
          const nextStatus = nextStatusByAdId.get(ad.id)
          return nextStatus ? { ...ad, status: nextStatus } : ad
        }),
        autoAds: current.autoAds.map((ad) => {
          const nextStatus = nextStatusByAdId.get(autoAdObjectId(ad))
          return nextStatus ? { ...ad, status: nextStatus, applied: true } : ad
        }),
        updatedAt: nowLabel(),
      }))

      setAuditTrail((current) => [
        {
          id: `audit-bulk-auto-${Date.now()}`,
          actor: 'Ads Auto',
          action: 'Bulk Meta ad status update',
          target: `${bulkAutoRequest.candidates.length} ads`,
          before: bulkAutoRequest.candidates.map((candidate) => `${candidate.adName}: ${deliveryStatusLabel(candidate.currentStatus)}`).join(' · '),
          after: bulkAutoRequest.candidates
            .map((candidate) => `${candidate.adName}: ${candidate.nextStatus ? deliveryStatusLabel(candidate.nextStatus) : 'MONITOR'}`)
            .join(' · '),
          reason: 'Bulk approved from Ads Auto rule preview',
          timestamp: nowLabel(),
        },
        ...current,
      ])
      setBulkAutoRequest(null)
      setBulkAutoState({ running: false, error: null })
      void handleSyncMetaWorkspace()
    } catch (error) {
      setBulkAutoState({
        running: false,
        error: error instanceof Error ? error.message : 'Bulk Ads Auto execution failed',
      })
    }
  }

  const createPerformanceAction = (drilldown: PerformanceDrilldown) => {
    const newAction: RecommendedAction = {
      id: `perf-action-${Date.now()}`,
      campaignId: selectedCampaign?.id ?? 'workspace',
      type:
        drilldown.type === 'channel'
          ? 'Channel optimization'
          : drilldown.type === 'funnel'
            ? 'Funnel fix'
            : 'Metric review',
      target: drilldown.title,
      summary: drilldown.nextAction,
      expectedImpact: `Improve ${drilldown.title} based on ${drilldown.type} drill-down signals`,
      guardrail: 'ต้องตรวจ volume, spend, booking, show-up และ close rate ก่อน approve action จริง',
      before: drilldown.metrics.map((metric) => `${metric.label}: ${metric.value}`).join(' · '),
      after: 'Create optimization task and monitor next 48 hours',
      rollbackNote: 'ถ้า cost เพิ่มหรือ booking/show-up quality ลดลงใน 48 ชั่วโมง ให้ย้อนกลับ strategy เดิม',
      risk: drilldown.findings.some((finding) => finding.includes('สูง') || finding.includes('ต่ำ')) ? 'Medium' : 'Low',
      confidence: drilldown.type === 'metric' ? 78 : drilldown.type === 'channel' ? 84 : 80,
      status: 'pending',
    }

    setActions((current) => [newAction, ...current])
    setAuditTrail((current) => [
      {
        id: `audit-${newAction.id}`,
        actor: 'Clinic AI Agent',
        action: 'Created performance action',
        target: newAction.target,
        before: newAction.before,
        after: newAction.after,
        reason: newAction.summary,
        timestamp: 'เมื่อสักครู่',
      },
      ...current,
    ])
    setPerformanceDrilldown(null)
    setActiveTab('actions')
  }

  const handleSyncMetaWorkspace = useCallback(async (datePreset?: string) => {
    const syncDatePreset = datePreset ?? metaSync.datePreset ?? DEFAULT_META_DATE_PRESET
    setMetaSync((current) => ({ ...current, loading: true, error: null }))

    try {
      const response = await fetch(`/api/meta/workspace?datePreset=${encodeURIComponent(syncDatePreset)}`)
      const payload = (await response.json()) as Partial<MetaWorkspacePayload> & { error?: string }
      if (!response.ok || !payload.workspace) {
        throw new Error(payload.error || 'Meta API sync failed')
      }

      const normalized = normalizeWorkspaceData(payload.workspace)
      const nextWorkspace =
        normalized.actions.length > 0
          ? normalized
          : {
              ...normalized,
              actions: buildWorkspaceRecommendations(normalized, Date.now()),
            }
      setWorkspace((current) => ({
        ...nextWorkspace,
        actions: mergeRecommendedActionState(nextWorkspace.actions, current.actions),
        auditTrail: mergeAuditTrail(nextWorkspace.auditTrail, current.auditTrail),
      }))
      setSelectedCampaignId(nextWorkspace.campaigns[0]?.id ?? '')
      setMetaSync((current) => ({
        ...current,
        configured: true,
        connected: true,
        loading: false,
        error: null,
        accountName: payload.meta?.account?.name ?? current.accountName,
        adAccountId: payload.meta?.account?.account_id ?? current.adAccountId,
        graphVersion: payload.meta?.graphVersion ?? current.graphVersion,
        datePreset: payload.meta?.datePreset ?? syncDatePreset,
        fetchedAt: payload.meta?.fetchedAt ?? new Date().toISOString(),
        counts: payload.meta?.counts ?? current.counts,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Meta API sync failed'
      setMetaSync((current) => ({
        ...current,
        loading: false,
        error: message,
        connected: false,
      }))
    }
  }, [metaSync.datePreset, setWorkspace])

  const handleDatePresetChange = (datePreset: string) => {
    setMetaSync((current) => ({ ...current, datePreset }))
    if (metaSync.connected) void handleSyncMetaWorkspace(datePreset)
  }

  const handleRefreshMetaStatus = useCallback(async (showNotice = false) => {
    try {
      const response = await fetch('/api/meta/status')
      const payload = (await response.json()) as MetaStatusPayload
      setMetaSync((current) => ({
        ...current,
        configured: Boolean(payload.configured),
        connected: Boolean(payload.connected),
        graphVersion: payload.graphVersion ?? current.graphVersion,
        adAccountId: payload.adAccountId ?? current.adAccountId,
        datePreset: payload.datePreset ?? current.datePreset,
        envChecks: payload.requiredEnv ?? current.envChecks,
        lastStatusCheckAt: new Date().toISOString(),
        error: response.ok ? current.error : 'Meta status check failed',
      }))
      if (showNotice) {
        setMetaSync((current) => ({
          ...current,
          checkResult: {
            ok: Boolean(payload.connected),
            checkedAt: new Date().toISOString(),
            graphVersion: payload.graphVersion,
            datePreset: payload.datePreset,
            adAccountId: payload.adAccountId,
            checks: (payload.requiredEnv ?? []).map((check) => ({
              key: check.key,
              label: check.key,
              status: check.present || check.source.includes('optional') ? 'pass' : 'fail',
              detail: check.present ? `${check.source} configured` : check.help,
            })),
          },
        }))
      }
    } catch (error: unknown) {
      setMetaSync((current) => ({
        ...current,
        configured: false,
        connected: false,
        lastStatusCheckAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Meta status check failed',
      }))
    }
  }, [])

  const handleRefreshAiStatus = useCallback(async () => {
    setAiRuntime((current) => ({ ...current, loading: true, error: null }))

    try {
      const response = await fetch('/api/ai/status')
      const payload = (await response.json()) as AiStatusPayload
      setAiRuntime((current) => ({
        ...current,
        configured: Boolean(payload.configured),
        connected: Boolean(payload.connected),
        loading: false,
        model: payload.model ?? current.model,
        source: payload.source ?? current.source,
        tokenLocation: payload.tokenLocation ?? null,
        lastCheckedAt: new Date().toISOString(),
        error: response.ok ? null : payload.error ?? 'OpenAI status check failed',
        envChecks: payload.requiredEnv ?? current.envChecks,
      }))
    } catch (error) {
      setAiRuntime((current) => ({
        ...current,
        configured: false,
        connected: false,
        loading: false,
        lastCheckedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'OpenAI status check failed',
      }))
    }
  }, [])

  const handleGenerateAiMarketerPlan = useCallback(async () => {
    if (campaigns.length === 0 && adInsights.length === 0 && adSets.length === 0) {
      setAiMarketerRun((current) => ({
        ...current,
        running: false,
        error: 'ต้อง Sync Meta API ก่อนให้ AI Marketer วิเคราะห์ข้อมูลจริง',
      }))
      return
    }

    setAiMarketerRun((current) => ({ ...current, running: true, error: null }))

    try {
      const response = await fetch('/api/ai/marketer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspace: {
            campaigns,
            adSets,
            adInsights,
            channelPerformance,
            funnelMetrics,
            trendData,
            updatedAt: workspace.updatedAt,
          },
        }),
      })
      const payload = (await response.json()) as Partial<AiMarketerPayload>
      if (!response.ok || payload.error || !payload.ok) {
        throw new Error(payload.error || 'AI Marketer generation failed')
      }

      const generatedActions = (payload.actions ?? []).map((action) => ({
        ...action,
        status: 'pending' as const,
      }))
      const generatedInsights = payload.insights ?? []

      setWorkspace((current) => ({
        ...current,
        insights: generatedInsights.length > 0 ? mergeAiInsights(generatedInsights, current.insights) : current.insights,
        actions: [
          ...generatedActions,
          ...current.actions.filter((action) => !action.id.startsWith('ai-action-')),
        ],
        auditTrail: [
          {
            id: `audit-ai-marketer-${Date.now()}`,
            actor: 'OpenAI Marketer',
            action: 'Generated AI marketer plan',
            target: metaSync.accountName ?? 'Meta workspace',
            before: `${current.actions.filter((action) => action.status === 'pending').length} pending actions`,
            after: `${generatedActions.length} AI actions · ${generatedInsights.length} insights`,
            reason: payload.summary ?? 'OpenAI analyzed Meta Ads workspace',
            timestamp: nowLabel(),
          },
          ...current.auditTrail,
        ],
        updatedAt: nowLabel(),
      }))

      setAiRuntime((current) => ({
        ...current,
        configured: true,
        connected: true,
        model: payload.model ?? current.model,
        source: payload.source ?? current.source,
        lastCheckedAt: payload.checkedAt ?? new Date().toISOString(),
        error: null,
      }))
      setAiMarketerRun({
        running: false,
        error: null,
        summary: payload.summary ?? 'AI Marketer วิเคราะห์ข้อมูลเสร็จแล้ว',
        modelNotes: payload.modelNotes ?? [],
        lastRunAt: payload.checkedAt ?? new Date().toISOString(),
      })
    } catch (error) {
      setAiMarketerRun((current) => ({
        ...current,
        running: false,
        error: error instanceof Error ? error.message : 'AI Marketer generation failed',
      }))
    }
  }, [
    adInsights,
    adSets,
    campaigns,
    channelPerformance,
    funnelMetrics,
    metaSync.accountName,
    setWorkspace,
    trendData,
    workspace.updatedAt,
  ])

  const handleCheckMetaApi = useCallback(async () => {
    setMetaSync((current) => ({ ...current, checking: true, error: null }))

    try {
      const response = await fetch('/api/meta/check')
      const payload = (await response.json()) as MetaCheckPayload
      setMetaSync((current) => ({
        ...current,
        checking: false,
        configured: response.ok || current.configured,
        connected: response.ok && payload.ok,
        error: response.ok ? null : payload.error ?? 'Meta API check failed',
        accountName: payload.account?.name ?? current.accountName,
        adAccountId: payload.account?.account_id ?? payload.adAccountId ?? current.adAccountId,
        graphVersion: payload.graphVersion ?? current.graphVersion,
        datePreset: payload.datePreset ?? current.datePreset,
        lastStatusCheckAt: payload.checkedAt ?? new Date().toISOString(),
        checkResult: payload,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Meta API check failed'
      setMetaSync((current) => ({
        ...current,
        checking: false,
        connected: false,
        error: message,
        lastStatusCheckAt: new Date().toISOString(),
      }))
    }
  }, [])

  const handleSaveMetaConfig = useCallback(async (form: MetaConfigFormValues) => {
    setMetaSync((current) => ({ ...current, checking: true, error: null }))

    const response = await fetch('/api/meta/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    })
    const payload = (await response.json()) as MetaCheckPayload & { configured?: boolean; settingsSource?: 'web-settings' | 'server-env' }

    setMetaSync((current) => ({
      ...current,
      checking: false,
      configured: Boolean(payload.configured ?? response.ok),
      connected: response.ok && payload.ok,
      error: response.ok ? payload.error ?? null : payload.error ?? 'Save Meta API config failed',
      accountName: payload.account?.name ?? current.accountName,
      adAccountId: payload.account?.account_id ?? payload.adAccountId ?? form.adAccountId ?? current.adAccountId,
      graphVersion: payload.graphVersion ?? form.graphVersion,
      datePreset: payload.datePreset ?? form.datePreset,
      lastStatusCheckAt: payload.checkedAt ?? new Date().toISOString(),
      checkResult: payload,
    }))

    return payload
  }, [])

  const handleClearMetaConfig = useCallback(async () => {
    setMetaSync((current) => ({ ...current, checking: true, error: null }))
    const response = await fetch('/api/meta/config', { method: 'DELETE' })
    const payload = (await response.json()) as MetaConfigPayload
    setMetaSync((current) => ({
      ...current,
      checking: false,
      configured: Boolean(payload.configured),
      connected: Boolean(payload.configured),
      error: response.ok ? null : 'Clear Meta API config failed',
      accountName: null,
      adAccountId: payload.adAccountId ?? null,
      graphVersion: payload.graphVersion ?? 'v21.0',
      datePreset: payload.datePreset ?? DEFAULT_META_DATE_PRESET,
      envChecks: payload.requiredEnv ?? current.envChecks,
      checkResult: null,
    }))
  }, [])

  useEffect(() => {
    void handleRefreshMetaStatus()
  }, [handleRefreshMetaStatus])

  useEffect(() => {
    void handleRefreshAiStatus()
  }, [handleRefreshAiStatus])

  useEffect(() => {
    if (!metaSync.connected || autoMetaSyncRef.current) return
    autoMetaSyncRef.current = true
    void handleSyncMetaWorkspace()
  }, [handleSyncMetaWorkspace, metaSync.connected])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [activeTab])

  const confirmApproval = async () => {
    if (!approvalRequest) return
    if (approvalRequest.kind === 'recommendation') {
      await approveRecommendedAction(approvalRequest.id)
    } else {
      applyAutoDecision(approvalRequest.id)
      setApprovalRequest(null)
    }
  }

  const approvalTarget =
    approvalRequest?.kind === 'recommendation'
      ? actions.find((action) => action.id === approvalRequest.id)
      : approvalRequest?.kind === 'auto'
        ? autoAds.find((ad) => ad.id === approvalRequest.id)
        : null
  const currentPage = pageMeta[activeTab]
  const CurrentPageIcon = currentPage.icon
  useMascotGsapMotion(activeTab)

  return (
    <div className={`app-shell ${mobileNavOpen ? 'mobile-nav-open' : ''}`} data-theme={themeMode}>
      <aside className="sidebar" aria-label="Clinic growth navigation">
        <div className="brand">
          <button className="brand-home" type="button" onClick={() => setActiveTab('platform')} aria-label="Open app platform">
            <div className="brand-mark brand-logo-mark">
              <img className="brand-logo" src="/promedclinicpmc-logo.png" alt="" />
            </div>
            <strong>Promedclinicpmc</strong>
          </button>
          <button
            className={`theme-button ${themeMode === 'dark' ? 'active' : ''}`}
            type="button"
            aria-label="Toggle theme"
            title="Toggle light/dark theme"
            onClick={() => setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            <Sun size={17} />
          </button>
          <button
            className="mobile-menu-button"
            type="button"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-dashboard-nav"
            title={mobileNavOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
            onClick={() => setMobileNavOpen((current) => !current)}
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <button
          className="workspace-switch"
          type="button"
          aria-label="Open workspace settings"
          title="เปิด Settings เพื่อตั้งค่า Meta workspace"
          onClick={() => setActiveTab('settings')}
        >
          <span className="workspace-icon">
            <ShieldCheck size={15} />
          </span>
          <span>{metaSync.accountName ?? metaSync.adAccountId ?? 'Meta Workspace'}</span>
          <ChevronDown size={15} />
        </button>

        <nav id="mobile-dashboard-nav" className="tool-nav" aria-label="Dashboard tools">
          {toolSections.map((section) => (
            <section key={section.title} className="tool-section">
              <div className="tool-section-header">
                <strong>{section.title}</strong>
              </div>
              <div className="nav-list">
                {section.tabs.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      title={`${tab.label}: ${tab.description}`}
                    >
                      <Icon size={17} />
                      <span>
                        <strong>{tab.label}</strong>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="agent-card mascot-agent-card" aria-hidden="true">
          <img className="sidebar-mascot" src="/pmc-ai-mascot.png" alt="" />
          <div>
            <strong>PMC AI Buddy</strong>
            <p>Meta ads helper</p>
          </div>
        </div>

      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <div className="page-icon">
              <CurrentPageIcon size={24} />
            </div>
            <div>
              <h1>{currentPage.title}</h1>
              <p>{currentPage.subtitle}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className={`date-filter ${metaSync.connected ? 'is-live' : ''}`}
              type="button"
              onClick={() => {
                if (metaSync.connected) {
                  void handleSyncMetaWorkspace()
                } else {
                  setActiveTab('settings')
                }
              }}
              disabled={metaSync.loading}
              aria-label="Sync Meta API data"
              title={metaSync.connected ? 'Sync ข้อมูลจริงจาก Meta API' : 'เปิด Settings เพื่อตั้งค่า Meta API'}
            >
              <RefreshCw size={17} />
              {metaSync.loading ? 'Syncing Meta' : metaSync.connected ? 'Meta live' : 'Meta setup'}
            </button>
            <label className="date-range-control" aria-label="Date range" title="เลือกช่วงเวลาแล้ว sync ใหม่เมื่อเชื่อมต่อ Meta แล้ว">
              <span className="date-range-icon">
                <CalendarCheck size={16} />
              </span>
              <span className="date-range-copy">
                <small>Range</small>
                <strong>{datePresetLabel(metaSync.datePreset)}</strong>
              </span>
              <select value={metaSync.datePreset} aria-label="Date range" onChange={(event) => handleDatePresetChange(event.target.value)}>
                {datePresetOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
            <div className="organization-badge" aria-label="Current organization Promedclinicpmc" title="Promedclinicpmc">
              <img src="/promedclinicpmc-logo.png" alt="" />
              <strong>Promedclinicpmc</strong>
            </div>
          </div>
        </header>

        <AssistantStatusStrip
          metaSync={metaSync}
          pageTitle={currentPage.title}
          recordLabel={assistantRecordLabel}
          updatedAt={workspace.updatedAt}
          onSync={() => handleSyncMetaWorkspace()}
          onOpenSettings={() => setActiveTab('settings')}
        />

        {activeTab === 'platform' && (
          <PlatformHome
            modules={platformModules}
            services={serviceLines}
            stages={appointmentStages}
            onOpen={setActiveTab}
          />
        )}

        {activeTab === 'overview' && hasPerformanceData && (
          <PerformancePage
            totals={totals}
            pendingActions={pendingActions}
            activeAutoAds={activeAutoAds}
            autoPending={autoPending}
            autoMode={autoMode}
            campaigns={campaigns}
            serviceLines={serviceLines}
            trendData={trendData}
            channelPerformance={channelPerformance}
            funnelMetrics={funnelMetrics}
            onOpenDrilldown={setPerformanceDrilldown}
            onSelectCampaign={setSelectedCampaignId}
          />
        )}
        {activeTab === 'overview' && !hasPerformanceData && (
          <NoDataPanel
            icon={LineChart}
            title="ยังไม่มีข้อมูล Performance"
            message="ตั้งค่า Meta API แล้วกด Sync Meta เพื่อดึง campaign, insights และ funnel metrics จริงเข้าหน้านี้"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'campaigns' && campaigns.length > 0 && (
          <CampaignDetailPage
            selectedCampaignId={activeSelectedCampaignId}
            campaigns={campaigns}
            adSets={adSets}
            adInsights={adInsights}
            onSelectCampaign={setSelectedCampaignId}
            onOpenAiDrawer={setAiInsightDrawer}
            onRequestStatusChange={requestDeliveryStatusChange}
            onRequestMutation={requestMetaObjectMutation}
          />
        )}
        {activeTab === 'campaigns' && campaigns.length === 0 && (
          <NoDataPanel
            icon={Zap}
            title="ยังไม่มี Campaign จาก Meta"
            message="หน้านี้จะแสดง campaign, ad set และ ad details หลังจาก sync ข้อมูลจริงจาก Meta Marketing API"
            actionLabel="Sync / Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'appointments' && (appointmentStages.length > 0 || serviceLines.length > 0) && (
          <AppointmentsPage stages={appointmentStages} services={serviceLines} />
        )}
        {activeTab === 'appointments' && appointmentStages.length === 0 && serviceLines.length === 0 && (
          <NoDataPanel
            icon={CalendarCheck}
            title="ยังไม่มี Appointment Pipeline"
            message="ระบบจะสร้าง funnel จาก lead, booking, show-up และ paid signals ที่ดึงได้จากข้อมูลจริง"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'investigator' && selectedCampaign && selectedInsight && (
          <Investigator
            campaign={selectedCampaign}
            insight={selectedInsight}
            campaigns={campaigns}
            insightComponents={insightComponents}
            adSets={adSets}
            adInsights={adInsights}
            onSelectCampaign={setSelectedCampaignId}
            onOpenAiDrawer={setAiInsightDrawer}
          />
        )}
        {activeTab === 'investigator' && (!selectedCampaign || !selectedInsight) && (
          <NoDataPanel
            icon={BarChart3}
            title="ยังไม่มี AI Insights"
            message="AI Insights ต้องใช้ campaign/ad/creative metrics จริงก่อน จึงจะจัดอันดับ component และเปิด drawer ได้"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'actions' && (
          <section className="panel ai-marketer-hero">
            <PanelHeader
              icon={BrainCircuit}
              title="AI Marketer"
              meta={aiRuntime.configured ? `${aiRuntime.model} · ${aiRuntime.source}` : 'OpenAI setup required'}
              help="เรียก OpenAI จาก backend เพื่อวิเคราะห์ Meta Ads workspace จริง แล้วสร้าง AI Insights และ Action Queue ที่มี guardrails"
            />
            <div className="ai-marketer-layout">
              <div>
                <h2>วิเคราะห์ account แล้วสร้าง action จากข้อมูลจริง</h2>
                <p>ใช้ campaign, ad set, ad-level metrics, funnel และ trend ที่ sync จาก Meta API เพื่อสร้างแผน optimization แบบ approve-first</p>
                <div className="ai-runtime-strip">
                  <span className={`badge ${aiRuntime.connected ? 'good' : 'critical'}`}>
                    {aiRuntime.connected ? 'OpenAI configured' : 'OpenAI not ready'}
                  </span>
                  <span>{aiRuntime.tokenLocation ?? 'no key'} · {fmtNum(campaigns.length)} campaigns · {fmtNum(adInsights.length)} ads</span>
                </div>
              </div>
              <div className="ai-marketer-actions">
                <button className="secondary-button" type="button" onClick={handleRefreshAiStatus} disabled={aiRuntime.loading}>
                  <RefreshCw size={16} />
                  {aiRuntime.loading ? 'Checking...' : 'Check AI'}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleGenerateAiMarketerPlan}
                  disabled={aiMarketerRun.running || !aiRuntime.configured || (campaigns.length === 0 && adInsights.length === 0)}
                >
                  <Sparkles size={16} />
                  {aiMarketerRun.running ? 'Generating...' : 'Generate AI Plan'}
                </button>
                {!aiRuntime.configured && (
                  <button className="secondary-button" type="button" onClick={() => setActiveTab('settings')}>
                    <Settings size={16} />
                    Open Settings
                  </button>
                )}
              </div>
            </div>
            {aiMarketerRun.summary && (
              <div className="ai-result-summary">
                <strong>{aiMarketerRun.summary}</strong>
                {aiMarketerRun.modelNotes.length > 0 && (
                  <div>
                    {aiMarketerRun.modelNotes.map((note) => (
                      <span key={note}>{note}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {aiMarketerRun.error && <div className="data-notice critical">{aiMarketerRun.error}</div>}
            {aiRuntime.error && <div className="data-notice watch">{aiRuntime.error}</div>}
          </section>
        )}

        {activeTab === 'actions' && actions.length > 0 && (
          <section className="panel">
            <PanelHeader icon={ClipboardList} title="Clinic Action Queue" meta="Approve-only หรือ Execute ผ่าน Meta API" />
            <div className="action-list">
              {actions.map((action) => (
                <article key={action.id} className="action-card">
                  <div className="action-main">
                    <span className={`badge ${riskClass(action.risk)}`}>{action.risk} risk</span>
                    <span className={`badge ${actionStatusTone(action.status)}`}>{actionStatusLabel(action.status)}</span>
                    <h3>{action.type}</h3>
                    <strong>{action.target}</strong>
                    <p>{action.summary}</p>
                    <small>{action.expectedImpact}</small>
                    {action.execution ? (
                      <div className="action-execution-note">
                        <Power size={14} />
                        <span>{action.execution.label} · {metaObjectLabel(action.execution.objectType)} {action.execution.objectId}</span>
                      </div>
                    ) : (
                      <div className="action-execution-note muted">
                        <ShieldCheck size={14} />
                        <span>Approval only · ยังไม่มี endpoint ที่ execute อัตโนมัติสำหรับ action นี้</span>
                      </div>
                    )}
                    {action.executionError && <div className="data-notice critical action-error">{action.executionError}</div>}
                  </div>
                  <div className="confidence-ring">
                    <span>{action.confidence}%</span>
                    <small>AI Confidence</small>
                  </div>
                  <div className="queue-actions">
                    {action.status === 'pending' || action.status === 'failed' ? (
                      <>
                        <button
                          className="approve-button"
                          type="button"
                          onClick={() => {
                            setApprovalExecutionState({ running: false, error: null })
                            setApprovalRequest({ kind: 'recommendation', id: action.id })
                          }}
                        >
                          {action.execution ? <Power size={16} /> : <Check size={16} />}
                          {action.execution ? 'Execute' : 'Approve'}
                        </button>
                        <button className="reject-button" type="button" onClick={() => rejectAction(action.id)}>
                          <X size={16} />
                          Reject
                        </button>
                      </>
                    ) : (
                      <span className={`badge ${actionStatusTone(action.status)}`}>{actionStatusLabel(action.status)}</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {activeTab === 'actions' && actions.length === 0 && (
          <NoDataPanel
            icon={ClipboardList}
            title="ยังไม่มี Action Queue"
            message="Recommendation จะถูกสร้างจาก campaign/channel ที่มี spend, ROAS, frequency หรือ quality signals จริงเท่านั้น"
            actionLabel="Open Performance"
            onAction={() => setActiveTab('overview')}
          />
        )}

        {activeTab === 'auto' && adInsights.length > 0 && (
          <AutoAdsPanel
            mode={autoMode}
            ads={autoAds}
            campaigns={campaigns}
            adSets={adSets}
            adInsights={adInsights}
            onModeChange={setAutoMode}
            onApplyCandidate={(candidate) => {
              if (!candidate.nextStatus) return
              requestDeliveryStatusChange({
                objectType: 'ad',
                objectId: candidate.adId,
                targetName: candidate.adName,
                currentStatus: candidate.currentStatus,
                nextStatus: candidate.nextStatus,
                summary: `${autoDecisionLabel(candidate.decision)} · ${candidate.reason}`,
                source: 'ads-auto',
              })
            }}
            onBulkApply={requestBulkAutoExecution}
          />
        )}
        {activeTab === 'auto' && adInsights.length === 0 && (
          <NoDataPanel
            icon={Power}
            title="ยังไม่มี Ads Auto Actions"
            message="ระบบจะเสนอการเปิด ปิด หรือลดงบ ad-level จากข้อมูล ad จริงหลัง Sync Meta แล้วเท่านั้น"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'tasks' && adInsights.length > 0 && (
          <CreativeStudioPage
            tasks={tasks}
            campaigns={campaigns}
            adSets={adSets}
            adInsights={adInsights}
            aiRuntime={aiRuntime}
            onSyncMeta={() => handleSyncMetaWorkspace()}
            onRefreshAiStatus={handleRefreshAiStatus}
          />
        )}
        {activeTab === 'tasks' && adInsights.length === 0 && (
          <NoDataPanel
            icon={Layers3}
            title="ยังไม่มี Agent Tasks"
            message="Creative Studio จะทำงานจาก ad-level creative metrics ที่ดึงจาก Meta API หลัง Sync เท่านั้น"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'memory' && adSets.length > 0 && (
          <AudienceStudioPage items={memoryItems} campaigns={campaigns} adSets={adSets} adInsights={adInsights} />
        )}
        {activeTab === 'memory' && adSets.length === 0 && (
          <NoDataPanel
            icon={Database}
            title="ยังไม่มี Audience Memory"
            message="Audience Studio จะอ่าน ad set targeting, budget และ performance จาก Meta API หลัง Sync"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'compliance' && complianceReviews.length > 0 && (
          <MediaLibraryPage reviews={complianceReviews} />
        )}
        {activeTab === 'compliance' && complianceReviews.length === 0 && (
          <NoDataPanel
            icon={ImageIcon}
            title="ยังไม่มี Media Review"
            message="ระบบจะอ่าน creative/ad copy จาก Meta API เพื่อสร้างรายการตรวจ claim และ risk เมื่อมีข้อมูลจริง"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPage
            metaSync={metaSync}
            aiRuntime={aiRuntime}
            onRefreshStatus={() => handleRefreshMetaStatus(true)}
            onRefreshAiStatus={handleRefreshAiStatus}
            onCheckMeta={handleCheckMetaApi}
            onSyncMeta={() => handleSyncMetaWorkspace()}
            onSaveConfig={handleSaveMetaConfig}
            onClearConfig={handleClearMetaConfig}
          />
        )}

        {activeTab === 'audit' && auditTrail.length > 0 && (
          <section className="panel">
            <PanelHeader icon={FileClock} title="Audit Log" meta="Before / After snapshot สำหรับสร้าง trust" />
            <div className="timeline">
              {auditTrail.map((event) => (
                <article key={event.id} className="timeline-item">
                  <div className="timeline-icon">
                    <Clock3 size={16} />
                  </div>
                  <div>
                    <div className="timeline-head">
                      <h3>{event.action}</h3>
                      <span>{event.timestamp}</span>
                    </div>
                    <strong>{event.target}</strong>
                    <p>{event.reason}</p>
                    <div className="snapshot-grid">
                      <span>Before: {event.before}</span>
                      <span>After: {event.after}</span>
                    </div>
                    <small>Actor: {event.actor}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {activeTab === 'audit' && auditTrail.length === 0 && (
          <NoDataPanel
            icon={FileClock}
            title="ยังไม่มี Audit Log"
            message="Audit จะเกิดจากการ sync, approve, reject และ staged action ที่ใช้ข้อมูลจริงในระบบ"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}
      </main>

      {performanceDrilldown && (
        <PerformanceDrilldownDrawer
          drilldown={performanceDrilldown}
          onClose={() => setPerformanceDrilldown(null)}
          onCreateAction={createPerformanceAction}
        />
      )}

      {aiInsightDrawer && (
        <AIInsightDrawer
          context={aiInsightDrawer}
          campaigns={campaigns}
          insights={insights}
          actions={actions}
          onClose={() => setAiInsightDrawer(null)}
        />
      )}

      {approvalRequest && approvalTarget && (
        <ApprovalModal
          request={approvalRequest}
          target={approvalTarget}
          running={approvalExecutionState.running}
          error={approvalExecutionState.error}
          onCancel={() => {
            if (approvalExecutionState.running) return
            setApprovalRequest(null)
            setApprovalExecutionState({ running: false, error: null })
          }}
          onConfirm={confirmApproval}
        />
      )}

      {statusChangeRequest && (
        <DeliveryStatusModal
          request={statusChangeRequest}
          running={statusChangeState.running}
          error={statusChangeState.error}
          onCancel={() => setStatusChangeRequest(null)}
          onConfirm={confirmDeliveryStatusChange}
        />
      )}

      {objectMutationRequest && (
        <MetaObjectMutationModal
          request={objectMutationRequest}
          campaigns={campaigns}
          adSets={adSets}
          running={objectMutationState.running}
          error={objectMutationState.error}
          onCancel={() => setObjectMutationRequest(null)}
          onConfirm={confirmMetaObjectMutation}
        />
      )}

      {bulkAutoRequest && (
        <BulkAutoExecutionModal
          request={bulkAutoRequest}
          running={bulkAutoState.running}
          error={bulkAutoState.error}
          onCancel={() => setBulkAutoRequest(null)}
          onConfirm={confirmBulkAutoExecution}
        />
      )}
    </div>
  )
}

function AssistantStatusStrip({
  metaSync,
  pageTitle,
  recordLabel,
  updatedAt,
  onSync,
  onOpenSettings,
}: {
  metaSync: MetaSyncState
  pageTitle: string
  recordLabel: string
  updatedAt: string
  onSync: () => void
  onOpenSettings: () => void
}) {
  const isBusy = metaSync.loading || metaSync.checking
  const tone = isBusy ? 'scale' : metaSync.connected ? 'good' : metaSync.configured ? 'watch' : 'critical'
  const statusText = isBusy ? 'Syncing' : metaSync.connected ? 'Meta live' : metaSync.configured ? 'Check API' : 'Setup API'
  const detailText = metaSync.connected
    ? recordLabel
    : metaSync.configured
      ? 'ตรวจ token และสิทธิ์ API ก่อน sync'
      : 'ใส่ Meta token และ Ad Account ID ใน Settings'

  return (
    <section className="assistant-status-strip" aria-label="PMC AI data status">
      <div className="assistant-avatar" aria-hidden="true">
        <img src="/pmc-ai-mascot.png" alt="" />
      </div>
      <div className="assistant-status-copy">
        <div>
          <span className={`status-dot ${tone}`} />
          <strong>{statusText}</strong>
          <small>{pageTitle}</small>
        </div>
        <p>{detailText}</p>
      </div>
      <div className="assistant-status-meta">
        <span>{updatedAt}</span>
        <button
          className={metaSync.connected ? 'ghost-mini-button' : 'ghost-mini-button warning'}
          type="button"
          onClick={metaSync.connected ? onSync : onOpenSettings}
          disabled={isBusy}
        >
          {metaSync.connected ? <RefreshCw size={13} /> : <Settings size={13} />}
          {metaSync.connected ? 'Sync' : 'Settings'}
        </button>
      </div>
    </section>
  )
}

function NoDataPanel({
  icon: Icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: typeof BarChart3
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <section className="panel no-data-panel">
      <div className="empty-state no-data-state">
        <img className="empty-mascot" src="/pmc-ai-mascot.png" alt="" aria-hidden="true" />
        <Icon size={22} />
        <strong>{title}</strong>
        <p>{message}</p>
        {actionLabel && onAction && (
          <button className="primary-button" type="button" onClick={onAction}>
            <Settings size={16} />
            {actionLabel}
          </button>
        )}
      </div>
    </section>
  )
}

function AutoAdsPanel({
  mode,
  ads,
  campaigns,
  adSets,
  adInsights,
  onModeChange,
  onApplyCandidate,
  onBulkApply,
}: {
  mode: AutomationMode
  ads: AutoAdControl[]
  campaigns: CampaignInsight[]
  adSets: WorkspaceData['adSets']
  adInsights: WorkspaceData['adInsights']
  onModeChange: (mode: AutomationMode) => void
  onApplyCandidate: (candidate: AutoStatusCandidate) => void
  onBulkApply: (candidates: AutoStatusCandidate[]) => void
}) {
  const [preset, setPreset] = useState<AutoRulePreset>('balanced')
  const [rule, setRule] = useState<AutoRuleSettings>(autoRulePresets.balanced)
  const [queueFilter, setQueueFilter] = useState<AutoQueueFilter>('action')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const candidates = useMemo(
    () => buildAutoStatusCandidates({ rule, campaigns, adSets, adInsights }),
    [adInsights, adSets, campaigns, rule],
  )
  const actionableCandidates = useMemo(() => candidates.filter((candidate) => Boolean(candidate.nextStatus)), [candidates])
  const autoPilotCandidates = useMemo(
    () => actionableCandidates.filter((candidate) => isAutoPilotEligible(candidate, rule)).slice(0, rule.maxActionsPerRun),
    [actionableCandidates, rule],
  )
  const totalTrackedAds = adInsights.length > 0 ? adInsights.length : ads.length
  const activeCount =
    adInsights.length > 0 ? adInsights.filter((ad) => ad.status === 'active').length : ads.filter((ad) => ad.status === 'active').length
  const pausedCount = totalTrackedAds - activeCount
  const visibleCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        if (queueFilter === 'action') return Boolean(candidate.nextStatus)
        if (queueFilter === 'pause') return candidate.decision === 'pause'
        if (queueFilter === 'enable') return candidate.decision === 'enable'
        if (queueFilter === 'monitor') return !candidate.nextStatus
        return true
      }),
    [candidates, queueFilter],
  )
  const selectedCandidates = useMemo(
    () => actionableCandidates.filter((candidate) => selectedIds.includes(candidate.id)),
    [actionableCandidates, selectedIds],
  )
  const autoPilotSelectedCandidates = useMemo(
    () => selectedCandidates.filter((candidate) => isAutoPilotEligible(candidate, rule)).slice(0, rule.maxActionsPerRun),
    [rule, selectedCandidates],
  )
  const pauseCount = actionableCandidates.filter((candidate) => candidate.nextStatus === 'paused').length
  const enableCount = actionableCandidates.filter((candidate) => candidate.nextStatus === 'active').length
  const executionCandidates = mode === 'autoPilot' ? autoPilotSelectedCandidates : selectedCandidates
  const executionActionLabel = mode === 'autoPilot' ? 'Run Auto Pilot' : 'Review selected'

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((mode === 'autoPilot' ? autoPilotCandidates : actionableCandidates.slice(0, 5)).map((candidate) => candidate.id))
  }, [actionableCandidates, autoPilotCandidates, mode])

  const applyPreset = (key: AutoRulePreset) => {
    setPreset(key)
    setRule(autoRulePresets[key])
  }

  const updateRuleNumber = (field: keyof Pick<AutoRuleSettings, 'minSpend' | 'pauseRoas' | 'scaleRoas' | 'minBookingsToReactivate' | 'minConfidenceToAutoPilot' | 'maxActionsPerRun'>, value: string) => {
    const nextValue = Number(value)
    if (!Number.isFinite(nextValue) || nextValue < 0) return
    let safeValue = nextValue
    if (field === 'minConfidenceToAutoPilot') safeValue = Math.min(100, Math.max(50, nextValue))
    if (field === 'maxActionsPerRun') safeValue = Math.min(25, Math.max(1, nextValue))
    setPreset('balanced')
    setRule((current) => ({
      ...current,
      label: 'Custom',
      description: 'ตั้งค่า rules เองจากข้อมูล ads จริงใน workspace ปัจจุบัน',
      [field]: field === 'pauseRoas' || field === 'scaleRoas' ? Number(safeValue.toFixed(2)) : Math.round(safeValue),
    }))
  }

  const toggleCandidate = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  return (
    <section className="auto-grid">
      <div className="panel auto-hero">
        <PanelHeader icon={Power} title="Ads Auto Control" meta="Meta status execution" />
        <div className="auto-hero-content">
          <div>
            <h2>Auto rules สำหรับเปิด/ปิด Ads จากข้อมูลจริง</h2>
            <p>เลือก preset แล้ว review รายการก่อนยิง Meta API จริง ใช้สำหรับ pause ตัวเปลืองและ activate ตัวที่มีสัญญาณกลับมาดี</p>
          </div>
          <div className="mode-switch" aria-label="Automation mode">
            <button className={mode === 'suggest' ? 'active' : ''} type="button" onClick={() => onModeChange('suggest')}>
              Suggest Mode
            </button>
            <button className={mode === 'autoPilot' ? 'active' : ''} type="button" onClick={() => onModeChange('autoPilot')}>
              Auto Pilot
            </button>
          </div>
        </div>

        <div className="auto-stat-grid">
          <div>
            <span>Active Ads</span>
            <strong>{activeCount}</strong>
          </div>
          <div>
            <span>Paused Ads</span>
            <strong>{pausedCount}</strong>
          </div>
          <div>
            <span>Pending Auto Actions</span>
            <strong>{actionableCandidates.length}</strong>
          </div>
          <div>
            <span>Pause / Enable</span>
            <strong>{pauseCount}/{enableCount}</strong>
          </div>
          <div>
            <span>Execution Mode</span>
            <strong>{mode === 'suggest' ? 'Suggest' : 'Auto Pilot'}</strong>
          </div>
          <div>
            <span>Auto Pilot Ready</span>
            <strong>{autoPilotCandidates.length}</strong>
          </div>
        </div>
        <div className={`data-notice ${mode === 'autoPilot' ? 'watch' : 'good'} auto-mode-notice`}>
          {mode === 'autoPilot'
            ? `Auto Pilot จะเลือกเฉพาะ ads ที่ผ่าน confidence ${rule.minConfidenceToAutoPilot}% ขึ้นไป และจำกัดไม่เกิน ${rule.maxActionsPerRun} actions ต่อรอบ ก่อนยิง Meta API จริง`
            : 'Suggest Mode จะแสดง recommendation จากข้อมูล Meta จริง ให้ผู้ใช้เลือกและ confirm ก่อน execution'}
        </div>
      </div>

      <div className="panel guardrail-panel">
        <PanelHeader icon={ShieldCheck} title="Auto Rules" meta={rule.label} />
        <div className="auto-rule-grid">
          {(Object.keys(autoRulePresets) as AutoRulePreset[]).map((key) => {
            const presetRule = autoRulePresets[key]
            return (
              <button key={key} className={preset === key && rule.label === presetRule.label ? 'active' : ''} type="button" onClick={() => applyPreset(key)}>
                <strong>{presetRule.label}</strong>
                <small>{presetRule.description}</small>
                <span>{fmtMoney(presetRule.minSpend)} min spend · {presetRule.pauseRoas.toFixed(1)}x pause</span>
              </button>
            )
          })}
        </div>
        <div className="auto-rule-control-grid">
          <label>
            <span>Min spend before pause</span>
            <input type="number" min="0" step="50" value={rule.minSpend} onChange={(event) => updateRuleNumber('minSpend', event.target.value)} />
            <small>Ads ต้องใช้เงินถึงค่านี้ก่อนถึงจะ pause ได้</small>
          </label>
          <label>
            <span>Pause below ROAS</span>
            <input type="number" min="0" step="0.1" value={rule.pauseRoas} onChange={(event) => updateRuleNumber('pauseRoas', event.target.value)} />
            <small>Active ads ที่ ROAS ต่ำกว่านี้จะเข้า queue pause</small>
          </label>
          <label>
            <span>Reactivate from ROAS</span>
            <input type="number" min="0" step="0.1" value={rule.scaleRoas} onChange={(event) => updateRuleNumber('scaleRoas', event.target.value)} />
            <small>Paused ads ที่ ROAS ถึงค่านี้มีสิทธิ์เปิดกลับ</small>
          </label>
          <label>
            <span>Min bookings to reactivate</span>
            <input
              type="number"
              min="0"
              step="1"
              value={rule.minBookingsToReactivate}
              onChange={(event) => updateRuleNumber('minBookingsToReactivate', event.target.value)}
            />
            <small>กันการเปิดกลับจากข้อมูลที่ volume ต่ำเกินไป</small>
          </label>
          <label>
            <span>Auto Pilot confidence</span>
            <input
              type="number"
              min="50"
              max="100"
              step="1"
              value={rule.minConfidenceToAutoPilot}
              onChange={(event) => updateRuleNumber('minConfidenceToAutoPilot', event.target.value)}
            />
            <small>Auto Pilot จะไม่เลือก candidate ที่ confidence ต่ำกว่า</small>
          </label>
          <label>
            <span>Max actions / run</span>
            <input
              type="number"
              min="1"
              max="25"
              step="1"
              value={rule.maxActionsPerRun}
              onChange={(event) => updateRuleNumber('maxActionsPerRun', event.target.value)}
            />
            <small>จำกัดจำนวน write actions ต่อรอบ execution</small>
          </label>
        </div>
        <div className="guardrail-list">
          <Signal icon={ShieldCheck} text="ทุก action ต้องมี reason, confidence และ before/after snapshot" tone="good" />
          <Signal icon={PauseCircle} text="Pause เฉพาะ ads ที่ผ่าน spend threshold ของ preset" tone="watch" />
          <Signal icon={AlertTriangle} text="Bulk execution ต้องกด Confirm ใน modal ก่อนยิง Meta API" tone="critical" />
          <Signal icon={PlayCircle} text="Reactivate เฉพาะ paused ads ที่มี ROAS และ bookings ตาม rule" tone="good" />
        </div>
      </div>

      <div className="panel auto-list-panel">
        <div className="auto-queue-header">
          <PanelHeader icon={Zap} title="Ads Auto Queue" meta={`${visibleCandidates.length} rows · ${selectedCandidates.length} selected`} />
          <div className="auto-queue-actions">
            <div className="mode-switch compact" aria-label="Queue filter">
              {[
                { id: 'action' as const, label: 'Action' },
                { id: 'all' as const, label: 'All' },
                { id: 'pause' as const, label: 'Pause' },
                { id: 'enable' as const, label: 'Enable' },
                { id: 'monitor' as const, label: 'Monitor' },
              ].map((item) => (
                <button key={item.id} className={queueFilter === item.id ? 'active' : ''} type="button" onClick={() => setQueueFilter(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <button className="secondary-button" type="button" onClick={() => setSelectedIds(actionableCandidates.map((candidate) => candidate.id))}>
              Select all
            </button>
            <button className="secondary-button" type="button" onClick={() => setSelectedIds([])} disabled={selectedCandidates.length === 0}>
              Clear
            </button>
            {mode === 'autoPilot' && (
              <button className="secondary-button" type="button" onClick={() => setSelectedIds(autoPilotCandidates.map((candidate) => candidate.id))}>
                Auto select
              </button>
            )}
            <button className="primary-button" type="button" disabled={executionCandidates.length === 0} onClick={() => onBulkApply(executionCandidates)}>
              <ShieldCheck size={16} />
              {executionActionLabel}
            </button>
          </div>
        </div>

        <div className="auto-candidate-list">
          {visibleCandidates.length === 0 && (
            <div className="empty-state">
              <ShieldCheck size={18} />
              <strong>ยังไม่มีรายการใน filter นี้</strong>
              <p>ลองเปลี่ยน preset หรือเลือก All เพื่อดู ads ทั้งหมด</p>
            </div>
          )}
          {visibleCandidates.map((candidate) => {
            const canRunStatusAction = Boolean(candidate.nextStatus)
            return (
              <article key={candidate.id} className={`auto-candidate-card ${selectedIds.includes(candidate.id) ? 'selected' : ''}`}>
                <label className="auto-select">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(candidate.id)}
                    disabled={!canRunStatusAction}
                    onChange={() => toggleCandidate(candidate.id)}
                  />
                </label>
                <div className="auto-card-main">
                  <div className="auto-card-topline">
                    <span className={`badge ${candidate.currentStatus === 'active' ? 'good' : 'critical'}`}>
                      {deliveryStatusLabel(candidate.currentStatus)}
                    </span>
                    <span className={`badge ${autoDecisionTone(candidate.decision)}`}>
                      {autoDecisionLabel(candidate.decision)}
                    </span>
                    <span className={`badge ${riskClass(candidate.risk)}`}>{candidate.risk} risk</span>
                  </div>
                  <h3>{candidate.adName}</h3>
                  <p>{candidate.reason}</p>
                  <small>{candidate.campaignName} · {candidate.adSetName}</small>
                  <div className="auto-guardrail">
                    <ShieldCheck size={15} />
                    <span>{candidate.guardrail}</span>
                  </div>
                  <div className="auto-metric-strip">
                    <span>{fmtMoney(candidate.spend)} spend</span>
                    <span>{candidate.roas.toFixed(2)}x ROAS</span>
                    <span>{fmtNum(candidate.bookings)} bookings</span>
                    <span>{candidate.ctr.toFixed(2)}% CTR</span>
                    <span>Score {candidate.score.toFixed(1)}</span>
                  </div>
                </div>
                <div className="confidence-ring">
                  <span>{candidate.confidence}%</span>
                  <small>AI Confidence</small>
                </div>
                <div className="queue-actions">
                  {!canRunStatusAction ? (
                    <span className="badge scale">Monitor only</span>
                  ) : (
                    <button className="approve-button" type="button" onClick={() => onApplyCandidate(candidate)}>
                      <Check size={16} />
                      {candidate.nextStatus === 'active' ? 'Review activate' : 'Review pause'}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function BulkAutoExecutionModal({
  request,
  running,
  error,
  onCancel,
  onConfirm,
}: {
  request: BulkAutoExecutionRequest
  running: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const pauseCount = request.candidates.filter((candidate) => candidate.nextStatus === 'paused').length
  const enableCount = request.candidates.filter((candidate) => candidate.nextStatus === 'active').length
  const highRiskCount = request.candidates.filter((candidate) => candidate.risk === 'High').length

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="approval-modal bulk-auto-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-auto-title">
        <div className="approval-modal-header">
          <div>
            <span className="badge scale">Ads Auto Execution</span>
            <h2 id="bulk-auto-title">Review {request.candidates.length} Meta Ads actions</h2>
            <p>ตรวจรายการก่อนเปลี่ยนสถานะ ads จริงผ่าน Meta Marketing API</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close bulk auto modal" onClick={onCancel} disabled={running}>
            <X size={17} />
          </button>
        </div>

        <div className="bulk-auto-summary">
          <div>
            <span>Pause</span>
            <strong>{pauseCount}</strong>
          </div>
          <div>
            <span>Activate</span>
            <strong>{enableCount}</strong>
          </div>
          <div>
            <span>High risk</span>
            <strong>{highRiskCount}</strong>
          </div>
        </div>

        <div className="bulk-auto-list">
          {request.candidates.map((candidate) => (
            <article key={candidate.id} className="bulk-auto-item">
              <div>
                <div className="auto-card-topline">
                  <span className={`badge ${deliveryStatusTone(candidate.currentStatus)}`}>{deliveryStatusLabel(candidate.currentStatus)}</span>
                  {candidate.nextStatus && (
                    <span className={`badge ${deliveryStatusTone(candidate.nextStatus)}`}>{deliveryStatusLabel(candidate.nextStatus)}</span>
                  )}
                  <span className={`badge ${riskClass(candidate.risk)}`}>{candidate.confidence}% confidence</span>
                </div>
                <h3>{candidate.adName}</h3>
                <p>{candidate.reason}</p>
                <small>{candidate.campaignName} · {candidate.adSetName}</small>
              </div>
              <div className="bulk-auto-item-metrics">
                <span>{fmtMoney(candidate.spend)} spend</span>
                <span>{candidate.roas.toFixed(2)}x ROAS</span>
                <span>{fmtNum(candidate.bookings)} bookings</span>
              </div>
            </article>
          ))}
        </div>

        <div className="approval-warning">
          <ShieldCheck size={16} />
          <span>เมื่อกด Confirm ระบบจะเปลี่ยนสถานะ ads เหล่านี้จริงใน Meta และบันทึก Audit Log พร้อม sync workspace หลังสำเร็จ</span>
        </div>

        {error && <div className="data-notice critical">{error}</div>}

        <div className="approval-actions">
          <button className="reject-button" type="button" onClick={onCancel} disabled={running}>
            <X size={16} />
            Cancel
          </button>
          <button className="approve-button" type="button" onClick={onConfirm} disabled={running}>
            <Check size={16} />
            {running ? 'Running...' : 'Confirm Meta changes'}
          </button>
        </div>
      </section>
    </div>
  )
}

function PerformancePage({
  totals,
  pendingActions,
  activeAutoAds,
  autoPending,
  autoMode,
  campaigns,
  serviceLines,
  trendData,
  channelPerformance,
  funnelMetrics,
  onOpenDrilldown,
  onSelectCampaign,
}: {
  totals: { spend: number; revenue: number; conversions: number; roas: number; cpa: number; watchCount: number }
  pendingActions: number
  activeAutoAds: number
  autoPending: number
  autoMode: AutomationMode
  campaigns: CampaignInsight[]
  serviceLines: ServiceLine[]
  trendData: TrendPoint[]
  channelPerformance: ChannelPerformance[]
  funnelMetrics: WorkspaceData['funnelMetrics']
  onOpenDrilldown: (drilldown: PerformanceDrilldown) => void
  onSelectCampaign: (id: string) => void
}) {
  const channelTotals = channelPerformance.reduce(
    (summary, channel) => ({
      spend: summary.spend + channel.spend,
      impressions: summary.impressions + channel.impressions,
      reach: summary.reach + channel.reach,
      clicks: summary.clicks + channel.clicks,
      leads: summary.leads + channel.leads,
      bookings: summary.bookings + channel.bookings,
      showUps: summary.showUps + channel.showUps,
      treatments: summary.treatments + channel.treatments,
      firstTimePatients: summary.firstTimePatients + channel.firstTimePatients,
      revenue: summary.revenue + channel.revenue,
    }),
    {
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      leads: 0,
      bookings: 0,
      showUps: 0,
      treatments: 0,
      firstTimePatients: 0,
      revenue: 0,
    },
  )
  const cpc = safeDivide(channelTotals.spend, channelTotals.clicks)
  const cpm = safeDivide(channelTotals.spend, channelTotals.impressions) * 1000
  const cpl = safeDivide(channelTotals.spend, channelTotals.leads)
  const leadToBooking = safeRate(channelTotals.bookings, channelTotals.leads)
  const showRate = safeRate(channelTotals.showUps, channelTotals.bookings)
  const closeRate = safeRate(channelTotals.treatments, channelTotals.showUps)
  const cac = safeDivide(channelTotals.spend, channelTotals.firstTimePatients)
  const aov = safeDivide(channelTotals.revenue, channelTotals.treatments)
  const salesVelocity = (channelTotals.showUps * aov * (closeRate / 100)) / 11.4
  const openMetricDrilldown = (title: string, value: string, help: string, findings: string[]) => {
    onOpenDrilldown({
      type: 'metric',
      title,
      subtitle: 'Performance metric drill-down',
      summary: help,
      metrics: [
        { label: 'Current value', value, help },
        { label: 'Source', value: 'Ads + CRM workspace', help: 'รวมข้อมูลจาก spend, click, lead, booking, show-up และ paid treatment' },
        { label: 'Action layer', value: `${pendingActions} pending`, help: 'จำนวน recommendation ที่รอ approve ใน Action Queue' },
      ],
      findings,
      nextAction: 'ตรวจ channel และ service ที่ทำให้ metric นี้เปลี่ยน แล้วสร้าง action เข้า queue หากมี risk หรือ upside ชัดเจน',
    })
  }
  const hasChannelData = channelPerformance.length > 0
  const avgLeadQuality = Math.round(safeDivide(channelPerformance.reduce((sum, channel) => sum + channel.leadQuality, 0), channelPerformance.length))
  const highestSpendChannel = channelPerformance.reduce<ChannelPerformance | null>(
    (best, channel) => (!best || channel.spend > best.spend ? channel : best),
    null,
  )
  const bestRoasChannel = channelPerformance.reduce<ChannelPerformance | null>((best, channel) => {
    if (channel.spend <= 0) return best
    return !best || safeDivide(channel.revenue, channel.spend) > safeDivide(best.revenue, best.spend) ? channel : best
  }, null)
  const metricStateLabel = hasChannelData ? 'live data' : 'รอข้อมูล'
  const spendFindings = [
    highestSpendChannel ? `${highestSpendChannel.channel} ใช้งบมากสุดใน channel mix` : 'ยังไม่มี channel spend breakdown',
    cpm > 0 && cpc > 0 ? `CPM ${fmtMoney(cpm)} · CPC ${fmtMoney(cpc)} ช่วยแยกต้นทุน reach/click` : 'ต้องมี impression และ click เพื่ออ่าน CPM/CPC',
  ]
  const revenueFindings = [
    bestRoasChannel ? `${bestRoasChannel.channel} มี ROAS สูงสุดจากข้อมูลที่ sync` : 'ยังไม่มี conversion value จาก channel',
    totals.revenue > 0 ? 'ควรเทียบ revenue กับ paid treatment และ AOV ก่อน scale' : 'รอข้อมูล revenue หรือ conversion value จาก Meta/CRM',
  ]
  const bookingFindings = [
    leadToBooking > 0 ? `Lead → Booking ${fmtPct(leadToBooking)} จากข้อมูล funnel` : 'ยังไม่มี lead-to-booking signal',
    showRate > 0 ? `Show-up ${fmtPct(showRate)} ต้องอ่านคู่กับ booking volume` : 'ต้องมี show-up เพื่อวัด quality หลัง booking',
  ]
  const reportGeneratedAt = nowLabel()
  const reportChannelData = channelPerformance.map((channel) => ({
    channel: channel.channel,
    spend: Math.round(channel.spend),
    revenue: Math.round(channel.revenue),
    bookings: channel.bookings,
    roas: safeDivide(channel.revenue, channel.spend),
  }))
  const reportFunnelData = funnelMetrics.slice(1).map((stage) => ({
    stage: stage.stage,
    conversionRate: Math.max(0, Math.min(100, stage.conversionRate)),
    dropOffRate: Math.max(0, Math.min(100, stage.dropOffRate)),
    count: stage.count,
  }))
  const mostLeakyStage = funnelMetrics.slice(1).reduce<WorkspaceData['funnelMetrics'][number] | null>(
    (worst, stage) => (!worst || stage.dropOffRate > worst.dropOffRate ? stage : worst),
    null,
  )
  const performanceTone = totals.roas >= 2.5 && showRate >= 55 ? 'good' : totals.roas >= 1.2 || showRate >= 45 ? 'watch' : 'critical'
  const performanceLabel = performanceTone === 'good' ? 'พร้อม scale แบบคุมความเสี่ยง' : performanceTone === 'watch' ? 'ต้องติดตามก่อนเพิ่มงบ' : 'ต้องแก้ funnel/cost ก่อน'
  const revenuePerBooking = safeDivide(totals.revenue, channelTotals.bookings)
  const reportCards = [
    {
      label: 'Business Health',
      value: performanceLabel,
      detail: `ROAS ${totals.roas.toFixed(2)}x · Show-up ${fmtPct(showRate)}`,
      tone: performanceTone,
      help: 'สรุปจาก ROAS และ show-up เพื่อแยกว่า scale ได้, ต้องดูต่อ หรือควรแก้ปัญหาก่อน',
    },
    {
      label: 'Best Channel',
      value: bestRoasChannel ? bestRoasChannel.channel : 'รอข้อมูล',
      detail: bestRoasChannel ? `${safeDivide(bestRoasChannel.revenue, bestRoasChannel.spend).toFixed(2)}x ROAS · ${fmtMoney(bestRoasChannel.spend)} spend` : 'ยังไม่มี channel ที่มี spend/revenue ครบ',
      tone: bestRoasChannel ? 'good' : 'watch',
      help: metricHelp.roas,
    },
    {
      label: 'Funnel Bottleneck',
      value: mostLeakyStage ? mostLeakyStage.stage : 'รอข้อมูล',
      detail: mostLeakyStage ? `${fmtPct(mostLeakyStage.dropOffRate)} drop-off · ${fmtNum(mostLeakyStage.count)} records` : 'ต้องมี stage funnel เพื่อหา bottleneck',
      tone: mostLeakyStage && mostLeakyStage.dropOffRate > 55 ? 'critical' : 'watch',
      help: metricHelp.dropOff,
    },
    {
      label: 'Value / Booking',
      value: fmtMoney(revenuePerBooking),
      detail: `${fmtNum(channelTotals.bookings)} bookings · ${fmtMoney(totals.revenue)} revenue`,
      tone: revenuePerBooking > 0 ? 'scale' : 'watch',
      help: 'Revenue per booking ใช้ดูมูลค่าเฉลี่ยของ booking ที่เข้ามา ก่อนตัดสินใจเพิ่มหรือลดงบ',
    },
  ]
  const reportFindings = [
    highestSpendChannel ? `${highestSpendChannel.channel} ใช้งบสูงสุด ควรตรวจว่า ROAS และ funnel quality สอดคล้องกับงบหรือไม่` : 'ยังไม่มี spend breakdown ราย channel',
    bestRoasChannel ? `${bestRoasChannel.channel} เป็น channel ที่ควรถูกใช้เป็น benchmark สำหรับ creative และ audience` : 'ยังไม่มี channel ที่อ่าน ROAS ได้ครบ',
    mostLeakyStage ? `${mostLeakyStage.stage} มี drop-off สูงสุดใน funnel ต้องตรวจ process, offer หรือ expectation ก่อน scale` : 'ยังไม่มี funnel stage เพียงพอสำหรับหา bottleneck',
    pendingActions > 0 ? `มี ${pendingActions} actions รอ approve ควรตรวจ decision log ก่อนเปลี่ยนสถานะ ads จริง` : 'ยังไม่มี action ค้าง ระบบพร้อมใช้สำหรับ monitor',
  ]
  const handleExportPdf = () => {
    window.requestAnimationFrame(() => window.print())
  }
  const openAutoGuardrailDrilldown = () => {
    onOpenDrilldown({
      type: 'metric',
      title: 'AI Auto Guardrails',
      subtitle: `${activeAutoAds} active ads · ${autoPending} recommendations`,
      summary: 'สรุปสถานะ automation ภายในหน้า Performance โดยไม่ย้ายไปหน้าอื่น เพื่ออ่านความเสี่ยงและ next action ก่อนเปิด/ปิด ads จริง',
      metrics: [
        { label: 'Mode', value: autoMode === 'suggest' ? 'Suggest' : 'Auto Pilot', help: metricHelp.autoAds },
        { label: 'Active Ads', value: fmtNum(activeAutoAds), help: 'จำนวน ads ที่ยัง active จาก workspace ปัจจุบัน' },
        { label: 'Pending Actions', value: fmtNum(pendingActions), help: 'จำนวน action ที่ยังรอ approve หรือ execute' },
      ],
      findings: [
        autoPending > 0 ? `${autoPending} auto recommendations ต้องตรวจ guardrail ก่อน execute` : 'ยังไม่มี auto recommendation ค้าง',
        pendingActions > 0 ? `${pendingActions} queued actions ควรอ่าน before/after ก่อนยิง Meta API` : 'Action Queue ไม่มีรายการค้าง',
        'การเปิด/ปิด ads จริงยังต้องผ่าน confirmation ของ tool ที่รับผิดชอบ',
      ],
      nextAction: 'ใช้ Performance เพื่อวิเคราะห์ภาพรวม แล้วใช้ sidebar เลือก Optimization เมื่อต้องการทำ execution เฉพาะทาง',
    })
  }
  const openCampaignSignalDrilldown = (campaign: CampaignInsight) => {
    onSelectCampaign(campaign.id)
    onOpenDrilldown({
      type: 'metric',
      title: campaign.name,
      subtitle: `${campaign.objective} · ${statusMeta(campaign.aiStatus).label}`,
      summary: campaign.aiSummary,
      metrics: [
        { label: 'Spend', value: fmtMoney(campaign.spend), help: metricHelp.adSpend },
        { label: 'ROAS', value: `${campaign.roas.toFixed(2)}x`, help: metricHelp.roas },
        { label: 'CPA', value: fmtMoney(campaign.cpa), help: 'Cost per acquisition/result จาก campaign insights' },
        { label: 'CTR', value: fmtPct(campaign.ctr), help: metricHelp.ctr },
      ],
      findings: [
        campaign.aiStatus === 'critical' ? 'Campaign นี้มี critical signal ต้องตรวจ cost/funnel ก่อน scale' : 'Campaign นี้ควร monitor signal เพิ่มก่อน action จริง',
        campaign.frequency >= 5 ? `Frequency ${campaign.frequency.toFixed(1)} สูง ควรตรวจ creative fatigue` : `Frequency ${campaign.frequency.toFixed(1)} ยังไม่สูงมาก`,
        campaign.conversions > 0 ? `${fmtNum(campaign.conversions)} tracked conversions ใช้อ่านร่วมกับ CPA/ROAS` : 'ยังไม่มี conversion ในช่วงเวลานี้',
      ],
      nextAction: 'ใช้ drawer นี้สรุปเหตุผลก่อน แล้วเลือก Ads Manager จาก sidebar เมื่อต้องแก้ campaign/ad set/ad โดยตรง',
    })
  }

  return (
    <section className="performance-grid performance-report-page">
      <div className="panel wide performance-report-panel">
        <div className="performance-report-head">
          <PanelHeader icon={FileClock} title="Performance Summary" meta={`Report · ${reportGeneratedAt}`} help="สรุปข้อมูล Meta และ clinic funnel เป็นรายงานที่พร้อม Export PDF" />
          <button className="primary-button no-print" type="button" onClick={handleExportPdf} title="เปิดหน้าต่าง Print เพื่อบันทึกเป็น PDF">
            <Download size={16} />
            Export PDF
          </button>
        </div>

        <div className="performance-report-cards">
          {reportCards.map((card) => (
            <article key={card.label} className={`performance-report-card ${card.tone}`}>
              <span>
                {card.label}
                <InfoHint text={card.help} />
              </span>
              <strong>{card.value}</strong>
              <p>{card.detail}</p>
            </article>
          ))}
        </div>

        <div className="performance-report-charts">
          <div className="report-chart-card">
            <div className="report-chart-title">
              <strong>Spend vs Revenue by Channel</strong>
              <span>เทียบ media cost กับ business value</span>
            </div>
            {reportChannelData.length > 0 ? (
              <MeasuredChart className="chart-wrap report-chart-wrap">
                {({ width, height }) => (
                  <BarChart width={width} height={height} data={reportChannelData} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#dce5f1" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="channel" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                    <ChartTooltip
                      formatter={(value, name) => [fmtMoney(Number(value) || 0), name === 'revenue' ? 'Revenue' : 'Spend']}
                      labelFormatter={(label) => `${label} · ดูงบกับรายได้ที่เกิดขึ้น`}
                      contentStyle={{ borderRadius: 8, border: '1px solid #dce5f1', fontSize: 12 }}
                    />
                    <Bar dataKey="spend" name="Spend" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="revenue" name="Revenue" fill="#0f9f6e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </MeasuredChart>
            ) : (
              <div className="empty-state chart-empty-state">
                <Database size={18} />
                <strong>ยังไม่มีข้อมูล channel</strong>
                <p>Sync Meta API เพื่อสร้างกราฟ spend/revenue ราย channel</p>
              </div>
            )}
          </div>

          <div className="report-chart-card">
            <div className="report-chart-title">
              <strong>Processed Funnel Health</strong>
              <span>Conversion และ drop-off ราย stage</span>
            </div>
            {reportFunnelData.length > 0 ? (
              <MeasuredChart className="chart-wrap report-chart-wrap">
                {({ width, height }) => (
                  <BarChart width={width} height={height} data={reportFunnelData} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#dce5f1" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="stage" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(value) => `${value}%`} />
                    <ChartTooltip
                      formatter={(value, name) => [fmtPct(Number(value) || 0), name === 'conversionRate' ? 'Conversion' : 'Drop-off']}
                      labelFormatter={(label) => `${label} · สัดส่วนที่ระบบประมวลผลจาก funnel`}
                      contentStyle={{ borderRadius: 8, border: '1px solid #dce5f1', fontSize: 12 }}
                    />
                    <Bar dataKey="conversionRate" name="Conversion" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="dropOffRate" name="Drop-off" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </MeasuredChart>
            ) : (
              <div className="empty-state chart-empty-state">
                <Database size={18} />
                <strong>ยังไม่มีข้อมูล funnel</strong>
                <p>เมื่อมี lead, booking, show-up และ treatment ระบบจะแสดงกราฟนี้</p>
              </div>
            )}
          </div>
        </div>

        <div className="report-finding-list">
          {reportFindings.map((finding, index) => (
            <Signal
              key={finding}
              icon={index === 0 ? Activity : index === 1 ? Trophy : index === 2 ? AlertTriangle : ClipboardList}
              text={finding}
              tone={finding.includes('สูงสุด') || finding.includes('รอ approve') ? 'watch' : 'good'}
            />
          ))}
        </div>
      </div>

      <div className="performance-category-grid wide">
        <section className="metric-category">
          <div className="metric-category-head">
            <span>01</span>
            <strong>Media Cost</strong>
          </div>
          <div className="metric-grid performance-metrics">
            <MetricCard title="Ad Spend" value={fmtMoney(totals.spend)} trend={metricStateLabel} icon={Activity} help={metricHelp.adSpend} onClick={() => openMetricDrilldown('Ad Spend', fmtMoney(totals.spend), metricHelp.adSpend, spendFindings)} />
            <MetricCard title="CPC" value={fmtMoney(cpc)} trend="traffic cost" icon={Activity} help={metricHelp.cpc} onClick={() => openMetricDrilldown('CPC', fmtMoney(cpc), metricHelp.cpc, [cpc > 0 ? `CPC ${fmtMoney(cpc)} จาก spend/clicks` : 'ยังไม่มี click data', 'ถ้า CPC สูงให้ตรวจ CTR, creative relevance และ landing/chat friction'])} />
            <MetricCard title="CPM" value={fmtMoney(cpm)} trend="reach cost" icon={BarChart3} help={metricHelp.cpm} onClick={() => openMetricDrilldown('CPM', fmtMoney(cpm), metricHelp.cpm, [cpm > 0 ? `CPM ${fmtMoney(cpm)} จาก spend/impressions` : 'ยังไม่มี impression data', 'อ่านคู่กับ frequency เพื่อจับ creative fatigue และ auction pressure'])} />
            <MetricCard title="CPL" value={fmtMoney(cpl)} trend="lead cost" icon={Flag} tone="watch" help={metricHelp.cpl} onClick={() => openMetricDrilldown('CPL', fmtMoney(cpl), metricHelp.cpl, [cpl > 0 ? `CPL ${fmtMoney(cpl)} จาก spend/leads` : 'ยังไม่มี lead data', 'CPL ต้องอ่านคู่กับ booking, show-up และ paid treatment'])} />
          </div>
        </section>

        <section className="metric-category">
          <div className="metric-category-head">
            <span>02</span>
            <strong>Funnel Quality</strong>
          </div>
          <div className="metric-grid performance-metrics">
            <MetricCard title="Bookings" value={fmtNum(totals.conversions)} trend="tracked conversions" icon={CalendarCheck} help={metricHelp.bookings} onClick={() => openMetricDrilldown('Bookings', fmtNum(totals.conversions), metricHelp.bookings, bookingFindings)} />
            <MetricCard title="Lead → Booking" value={fmtPct(leadToBooking)} trend="funnel quality" icon={ArrowDownRight} tone="good" help={metricHelp.leadToBooking} onClick={() => openMetricDrilldown('Lead → Booking', fmtPct(leadToBooking), metricHelp.leadToBooking, [leadToBooking > 0 ? `Lead-to-booking ${fmtPct(leadToBooking)} จากข้อมูล funnel` : 'ยังไม่มี lead/booking ครบ', avgLeadQuality > 0 ? `Lead quality เฉลี่ย ${avgLeadQuality}/100` : 'รอคะแนน lead quality จาก channel'])} />
            <MetricCard title="Show-up" value={fmtPct(showRate)} trend="appointment quality" icon={CheckCircle2} tone="good" help={metricHelp.showRate} onClick={() => openMetricDrilldown('Show-up', fmtPct(showRate), metricHelp.showRate, [showRate > 0 ? `Show-up รวม ${fmtPct(showRate)}` : 'ยังไม่มี show-up data', 'ใช้ดู expectation, reminder และ call confirmation หลัง booking'])} />
            <MetricCard title="Close Rate" value={fmtPct(closeRate)} trend="consult to paid" icon={Trophy} tone="scale" help={metricHelp.closeRate} onClick={() => openMetricDrilldown('Close Rate', fmtPct(closeRate), metricHelp.closeRate, [closeRate > 0 ? `Close rate ${fmtPct(closeRate)} จาก show-up → paid` : 'ยังไม่มี paid treatment data', 'แยกตาม service line เพื่อดู offer และ consult quality'])} />
          </div>
        </section>

        <section className="metric-category">
          <div className="metric-category-head">
            <span>03</span>
            <strong>Business Outcome</strong>
          </div>
          <div className="metric-grid performance-metrics">
            <MetricCard title="Revenue" value={fmtMoney(totals.revenue)} trend="conversion value" icon={ArrowUpRight} tone="good" help={metricHelp.revenue} onClick={() => openMetricDrilldown('Revenue', fmtMoney(totals.revenue), metricHelp.revenue, revenueFindings)} />
            <MetricCard title="ROAS" value={`${totals.roas.toFixed(2)}x`} trend="revenue / spend" icon={Target} tone="scale" help={metricHelp.roas} onClick={() => openMetricDrilldown('ROAS', `${totals.roas.toFixed(2)}x`, metricHelp.roas, [totals.roas > 0 ? `ROAS รวม ${totals.roas.toFixed(2)}x จากข้อมูลจริงที่ sync` : 'ยังไม่มี spend/revenue ครบสำหรับ ROAS', bestRoasChannel ? `เทียบกับ ${bestRoasChannel.channel} เพื่อหา channel ที่ควร scale` : 'ต้องมี channel breakdown เพื่อดู upside'])} />
            <MetricCard title="CAC" value={fmtMoney(cac)} trend="first-time patient" icon={Users} tone="watch" help={metricHelp.cac} onClick={() => openMetricDrilldown('CAC', fmtMoney(cac), metricHelp.cac, [cac > 0 ? `CAC ${fmtMoney(cac)} จาก first-time patients` : 'ยังไม่มี first-time patient data', 'ควรเทียบ CAC กับ AOV และ LTV ก่อนลดหรือเพิ่มงบ'])} />
            <MetricCard title="AOV" value={fmtMoney(aov)} trend="paid treatment" icon={ArrowUpRight} tone="good" help={metricHelp.aov} onClick={() => openMetricDrilldown('AOV', fmtMoney(aov), metricHelp.aov, [aov > 0 ? `AOV ${fmtMoney(aov)} จาก revenue/paid treatments` : 'ยังไม่มี revenue/paid treatment ครบ', 'ควรแยก AOV ตาม service line ก่อนตัดสินใจ scale'])} />
          </div>
        </section>
      </div>

      <div className="panel wide performance-main-chart">
        <PanelHeader icon={BarChart3} title="Revenue Efficiency Trend" meta="Spend · Revenue · Bookings" help={metricHelp.conversionValue} />
        <MeasuredChart className="chart-wrap">
          {({ width, height }) => (
            <AreaChart width={width} height={height} data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#dce5f1" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis yAxisId="money" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <YAxis yAxisId="volume" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
              <ChartTooltip
                formatter={(value, name) => {
                  if (name === 'Bookings') return [fmtNum(Number(value) || 0), 'Bookings']
                  return [fmtMoney(Number(value) || 0), String(name)]
                }}
                labelFormatter={(label) => `${label} · hover เพื่อดู spend/revenue/bookings`}
                contentStyle={{ borderRadius: 8, border: '1px solid #dce5f1', fontSize: 12 }}
              />
              <Area yAxisId="money" type="monotone" dataKey="revenue" name="Revenue" stroke="#0f9f6e" strokeWidth={2} fill="#dff7ed" />
              <Area yAxisId="money" type="monotone" dataKey="spend" name="Spend" stroke="#2563eb" strokeWidth={2} fill="#dbeafe" />
              <Area yAxisId="volume" type="monotone" dataKey="bookings" name="Bookings" stroke="#7c3aed" strokeWidth={2} fill="#f3e8ff" />
            </AreaChart>
          )}
        </MeasuredChart>
      </div>

      <div className="panel">
        <PanelHeader icon={LineChart} title="Funnel Conversion" meta="Stage rate & drop-off" help={metricHelp.dropOff} />
        <MeasuredChart className="chart-wrap compact-chart">
          {({ width, height }) => (
            <BarChart width={width} height={height} data={funnelMetrics} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#dce5f1" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="stage" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(value) => `${value}%`} />
              <ChartTooltip
                formatter={(value, name) => [fmtPct(Number(value) || 0), String(name)]}
                labelFormatter={(label) => `${label} stage`}
                contentStyle={{ borderRadius: 8, border: '1px solid #dce5f1', fontSize: 12 }}
              />
              <Bar dataKey="conversionRate" name="Conversion" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="dropOffRate" name="Drop-off" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </MeasuredChart>
        <div className="funnel-stage-list">
          {funnelMetrics.slice(1).map((stage) => (
            <button
              key={stage.stage}
              type="button"
              onClick={() =>
                onOpenDrilldown({
                  type: 'funnel',
                  title: stage.stage,
                  subtitle: `${stage.benchmark} · ${fmtNum(stage.count)} records`,
                  summary: stage.help,
                  metrics: [
                    { label: 'Count', value: fmtNum(stage.count), help: stage.help },
                    { label: 'Conversion', value: fmtPct(stage.conversionRate), help: 'Conversion rate จาก stage ก่อนหน้า' },
                    { label: 'Drop-off', value: fmtPct(stage.dropOffRate), help: metricHelp.dropOff },
                  ],
                  findings: [
                    stage.dropOffRate > 60 ? 'Drop-off สูง ควรตรวจ friction ใน stage นี้' : 'Drop-off อยู่ในระดับรับได้',
                    stage.stage === 'Show-up' ? 'ต้องดู reminder, call confirm และ expectation จาก creative' : 'เชื่อมผลลัพธ์กับ channel และ service เพื่อหา root cause',
                  ],
                  nextAction: 'เปิด drill-down ราย channel/service แล้วสร้าง recommendation หาก drop-off สูงหรือ conversion ต่ำกว่า benchmark',
                })
              }
            >
              <span>{stage.stage}</span>
              <strong>{fmtPct(stage.conversionRate)}</strong>
              <small>{fmtPct(stage.dropOffRate)} drop</small>
            </button>
          ))}
        </div>
      </div>

      <div className="panel performance-score">
        <PanelHeader icon={BrainCircuit} title="Sales Quality" meta="Clinic pipeline" help={metricHelp.salesVelocity} />
        <div className="health-score">
          <span>B+</span>
          <div>
            <strong>{fmtMoney(salesVelocity)} / day</strong>
            <p>Sales velocity จาก show-up, AOV, close rate และรอบการขาย 11.4 วัน</p>
          </div>
        </div>
        <div className="signal-list">
          <Signal icon={CheckCircle2} text={showRate > 0 ? `Show-up ${fmtPct(showRate)} จากข้อมูลนัดจริง` : 'รอข้อมูล show-up'} tone="good" help={metricHelp.showRate} />
          <Signal icon={AlertTriangle} text={funnelMetrics.length > 1 ? 'ตรวจ drop-off ราย stage เพื่อหา bottleneck' : 'รอข้อมูล stage funnel'} tone="critical" help={metricHelp.dropOff} />
          <Signal icon={Flag} text={avgLeadQuality > 0 ? `Lead quality เฉลี่ย ${avgLeadQuality}/100` : 'รอคะแนน lead quality'} tone="watch" help={metricHelp.leadQuality} />
        </div>
      </div>

      <ClinicOpsPanel services={serviceLines} funnelMetrics={funnelMetrics} />

      <div className="panel wide">
        <PanelHeader icon={Activity} title="Channel Performance" meta="Ads + sales variables" help={metricHelp.conversionValue} />
        <div className="table-wrap compact-table-wrap">
          <table className="performance-table">
            <thead>
              <tr>
                <MetricTh label="Channel" help="แหล่งที่มาของ traffic/lead เช่น Meta, Google, LINE หรือ organic" />
                <MetricTh label="Spend" help={metricHelp.adSpend} />
                <MetricTh label="CPM" help={metricHelp.cpm} />
                <MetricTh label="CTR" help={metricHelp.ctr} />
                <MetricTh label="CPC" help={metricHelp.cpc} />
                <MetricTh label="CPL" help={metricHelp.cpl} />
                <MetricTh label="Lead→Booking" help={metricHelp.leadToBooking} />
                <MetricTh label="Show-up" help={metricHelp.showRate} />
                <MetricTh label="Close" help={metricHelp.closeRate} />
                <MetricTh label="CAC" help={metricHelp.cac} />
                <MetricTh label="ROAS" help={metricHelp.roas} />
              </tr>
            </thead>
            <tbody>
              {channelPerformance.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={11}>
                    <div className="empty-state table-empty-state">
                      <Database size={18} />
                      <strong>ยังไม่มี channel breakdown</strong>
                      <p>เมื่อ Meta API ส่ง insights ครบ ระบบจะแสดง spend, CPC, CPL, show-up, CAC และ ROAS ราย channel</p>
                    </div>
                  </td>
                </tr>
              )}
              {channelPerformance.map((channel) => {
                const channelCpm = safeDivide(channel.spend, channel.impressions) * 1000
                const channelCtr = safeRate(channel.clicks, channel.impressions)
                const channelCpc = safeDivide(channel.spend, channel.clicks)
                const channelCpl = safeDivide(channel.spend, channel.leads)
                const channelLeadToBooking = safeRate(channel.bookings, channel.leads)
                const channelShowRate = safeRate(channel.showUps, channel.bookings)
                const channelCloseRate = safeRate(channel.treatments, channel.showUps)
                const channelCac = safeDivide(channel.spend, channel.firstTimePatients)
                const channelRoas = safeDivide(channel.revenue, channel.spend)
                return (
                  <tr
                    key={channel.channel}
                    onClick={() =>
                      onOpenDrilldown({
                        type: 'channel',
                        title: channel.channel,
                        subtitle: `${fmtNum(channel.leads)} leads · quality ${channel.leadQuality}/100`,
                        summary: 'Channel drill-down รวม ads efficiency และ sales funnel quality เพื่อดูว่าปัญหาเกิดที่ media, lead, booking หรือ close',
                        metrics: [
                          { label: 'Spend', value: fmtMoney(channel.spend), help: metricHelp.adSpend },
                          { label: 'CPM', value: fmtMoney(channelCpm), help: metricHelp.cpm },
                          { label: 'CTR', value: fmtPct(channelCtr), help: metricHelp.ctr },
                          { label: 'CPL', value: fmtMoney(channelCpl), help: metricHelp.cpl },
                          { label: 'Show-up', value: fmtPct(channelShowRate), help: metricHelp.showRate },
                          { label: 'ROAS', value: `${channelRoas.toFixed(2)}x`, help: metricHelp.roas },
                        ],
                        findings: [
                          channelCpl > cpl ? 'CPL สูงกว่าค่าเฉลี่ยรวม' : 'CPL ดีกว่าหรือใกล้ค่าเฉลี่ยรวม',
                          channelShowRate < showRate ? 'Show-up ต่ำกว่าค่าเฉลี่ย ต้องดู lead expectation' : 'Show-up แข็งแรงกว่าค่าเฉลี่ย',
                          channelRoas > totals.roas ? 'ROAS สูงกว่าค่าเฉลี่ยรวม มีโอกาส scale' : 'ROAS ต่ำกว่าค่าเฉลี่ย ต้องตรวจ cost หรือ revenue quality',
                        ],
                        nextAction: 'ใช้ drill-down นี้เพื่ออ่านปัญหาในหน้า Performance ก่อน แล้วค่อยเลือก tool เฉพาะจาก sidebar เมื่อต้องการ execution',
                      })
                    }
                  >
                    <td>
                      <strong className="table-title table-title-text">
                        {channel.channel}
                      </strong>
                      <span>{fmtNum(channel.leads)} leads · quality {channel.leadQuality}/100</span>
                    </td>
                    <td>{fmtMoney(channel.spend)}</td>
                    <td>{fmtMoney(channelCpm)}</td>
                    <td>{fmtPct(channelCtr)}</td>
                    <td>{fmtMoney(channelCpc)}</td>
                    <td>{fmtMoney(channelCpl)}</td>
                    <td>{fmtPct(channelLeadToBooking)}</td>
                    <td>{fmtPct(channelShowRate)}</td>
                    <td>{fmtPct(channelCloseRate)}</td>
                    <td>{fmtMoney(channelCac)}</td>
                    <td>{channelRoas.toFixed(2)}x</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <PanelHeader icon={Target} title="Measurement Model" meta="Ads → Sales → Clinic" help="โครงวัดผลที่ผสม ad platform metrics กับ CRM/clinic revenue metrics" />
        <div className="measurement-list">
          <MeasurementItem title="Ad delivery" value="CPM · CTR · CPC · Frequency" help={`${metricHelp.cpm} ${metricHelp.ctr} ${metricHelp.frequency}`} />
          <MeasurementItem title="Lead quality" value="CPL · Lead→Booking · Show-up" help={`${metricHelp.cpl} ${metricHelp.leadToBooking} ${metricHelp.showRate}`} />
          <MeasurementItem title="Sales outcome" value="Close · AOV · CAC · ROAS" help={`${metricHelp.closeRate} ${metricHelp.aov} ${metricHelp.cac} ${metricHelp.roas}`} />
        </div>
      </div>

      <div className="panel">
        <PanelHeader icon={Power} title="AI Auto & Alerts" meta={`${autoMode === 'suggest' ? 'Suggest' : 'Auto Pilot'} mode`} help={metricHelp.autoAds} />
        <div className="auto-overview">
          <div>
            <strong>{activeAutoAds} active ads</strong>
            <p>{autoPending} auto recommendations · {pendingActions} queued actions</p>
          </div>
          <button className="primary-button" type="button" onClick={openAutoGuardrailDrilldown} title={metricHelp.autoAds}>
            Guardrails
          </button>
        </div>
        <div className="signal-list">
          <Signal icon={ShieldCheck} text="ทุก write action ต้องมี guardrail" tone="good" help="ก่อนเปิด/ปิด/ลดงบ ต้องมี reason, before/after และ rollback note" />
          <Signal icon={PauseCircle} text="Pause เมื่อ data volume พอ" tone="watch" help="ลด false positive ด้วย threshold เช่น spend, clicks, conversions และเวลารันขั้นต่ำ" />
          <Signal icon={PlayCircle} text="Enable แบบ limited test" tone="good" help="เปิด ad กลับด้วยงบทดลอง จำกัดความเสี่ยงก่อน scale" />
        </div>
      </div>

      <div className="panel wide">
        <PanelHeader icon={Zap} title="Clinic Signals" meta="AI-ranked by urgency" help={metricHelp.alerts} />
        <div className="alert-grid">
          {campaigns.filter((campaign) => campaign.aiStatus !== 'healthy').length === 0 && (
            <div className="empty-state">
              <ShieldCheck size={18} />
              <strong>ยังไม่มี campaign ที่ต้องเตือน</strong>
              <p>เมื่อมี Watch หรือ Critical signal จากข้อมูลจริง รายการจะขึ้นตรงนี้</p>
            </div>
          )}
          {campaigns
            .filter((campaign) => campaign.aiStatus !== 'healthy')
            .map((campaign) => {
              const meta = statusMeta(campaign.aiStatus)
              return (
                <button
                  key={campaign.id}
                  type="button"
                  className="alert-row"
                  onClick={() => openCampaignSignalDrilldown(campaign)}
                  title={`${campaign.aiSummary} · เปิด drill-down ในหน้า Performance`}
                >
                  <span className={`status-dot ${meta.className}`} />
                  <div>
                    <strong>{campaign.name}</strong>
                    <p>{campaign.aiSummary}</p>
                  </div>
                  <span className={`badge ${meta.className}`}>{meta.label}</span>
                </button>
              )
            })}
        </div>
      </div>
    </section>
  )
}

function PerformanceDrilldownDrawer({
  drilldown,
  onClose,
  onCreateAction,
}: {
  drilldown: PerformanceDrilldown
  onClose: () => void
  onCreateAction: (drilldown: PerformanceDrilldown) => void
}) {
  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="performance-drilldown-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <span className="badge scale">{drilldown.type}</span>
            <h2 id="performance-drilldown-title">{drilldown.title}</h2>
            <p>{drilldown.subtitle}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close detail drawer" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="drawer-summary">
          <strong>Summary</strong>
          <p>{drilldown.summary}</p>
        </div>

        <div className="drawer-metric-grid">
          {drilldown.metrics.map((metric) => (
            <article key={metric.label}>
              <span>
                {metric.label}
                <InfoHint text={metric.help} />
              </span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </div>

        <div className="drawer-section">
          <h3>Findings</h3>
          <div className="signal-list">
            {drilldown.findings.map((finding, index) => (
              <Signal
                key={finding}
                icon={index === 0 ? BrainCircuit : index === 1 ? AlertTriangle : CheckCircle2}
                text={finding}
                tone={finding.includes('สูง') || finding.includes('ต่ำ') ? 'watch' : 'good'}
              />
            ))}
          </div>
        </div>

        <div className="drawer-next">
          <strong>Next action</strong>
          <p>{drilldown.nextAction}</p>
          <button className="primary-button drawer-action-button" type="button" onClick={() => onCreateAction(drilldown)}>
            <ClipboardList size={16} />
            Create Action
          </button>
        </div>
      </aside>
    </div>
  )
}

function AIInsightDrawer({
  context,
  campaigns,
  insights,
  actions,
  onClose,
}: {
  context: AiInsightDrawerContext
  campaigns: CampaignInsight[]
  insights: AIInsight[]
  actions: RecommendedAction[]
  onClose: () => void
}) {
  const campaign = campaigns.find((item) => item.id === context.campaignId) ?? campaigns[0]
  if (!campaign) return null

  const insight = insights.find((item) => item.campaignId === campaign.id) ?? {
    campaignId: campaign.id,
    whatHappened: 'ข้อมูลนี้ถูกนำเข้าใหม่ ระบบยังไม่มี AI insight เฉพาะ campaign นี้',
    why: 'ยังไม่ได้เชื่อม AI analysis จริงหรือ rules engine สำหรับข้อมูลที่นำเข้า',
    evidence: [
      `Spend ${fmtMoney(campaign.spend)}`,
      `ROAS ${campaign.roas.toFixed(2)}x`,
      `Bookings ${fmtNum(campaign.conversions)}`,
      `CTR ${campaign.ctr.toFixed(2)}%`,
    ],
    recommendation: 'ตรวจ campaign detail, channel quality และสร้าง action ใน Action Queue ก่อนปรับจริง',
    confidence: 62,
    risk: campaign.aiStatus === 'critical' ? 'High' : campaign.aiStatus === 'watch' ? 'Medium' : 'Low',
  }
  const relatedAction = actions.find((action) => action.campaignId === campaign.id)
  const meta = statusMeta(campaign.aiStatus)

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="detail-drawer ai-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-insight-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <span className={`badge ${meta.className}`}>{context.kind}</span>
            <h2 id="ai-insight-drawer-title">{context.title}</h2>
            <p>{context.subtitle}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close AI insight drawer" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="approval-summary">
          <div className="confidence-ring">
            <span>{insight.confidence}%</span>
            <small>AI Confidence</small>
          </div>
          <div>
            <h3>{campaign.name}</h3>
            <p>{campaign.objective} · ROAS {campaign.roas.toFixed(2)}x · Cost/Booking {fmtMoney(campaign.cpa)}</p>
          </div>
        </div>

        <div className="investigation-steps drawer-investigation">
          <InvestigationBlock title="What happened" body={insight.whatHappened} icon={Activity} />
          <InvestigationBlock title="Why" body={insight.why} icon={AlertTriangle} />
          <div className="evidence-block">
            <h3>Evidence</h3>
            <div className="evidence-grid">
              {insight.evidence.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
          <InvestigationBlock title="Recommendation" body={insight.recommendation} icon={Zap} />
        </div>

        <div className="snapshot-grid approval-snapshot">
          <span>Before: {relatedAction?.before ?? `ROAS ${campaign.roas.toFixed(2)}x · CPA ${fmtMoney(campaign.cpa)}`}</span>
          <span>After: {relatedAction?.after ?? insight.recommendation}</span>
        </div>

        <div className="drawer-next">
          <strong>Risk & guardrail</strong>
          <p>{insight.risk} risk · {relatedAction?.guardrail ?? 'ต้องตรวจ spend, volume, show-up และ close rate ก่อน action จริง'}</p>
        </div>
      </aside>
    </div>
  )
}

function InvestigationBlock({ title, body, icon: Icon }: { title: string; body: string; icon: typeof Activity }) {
  return (
    <article className="investigation-block">
      <div>
        <Icon size={17} />
      </div>
      <section>
        <h3>{title}</h3>
        <p>{body}</p>
      </section>
    </article>
  )
}

function CampaignDetailPage({
  selectedCampaignId,
  campaigns,
  adSets,
  adInsights,
  onSelectCampaign,
  onOpenAiDrawer,
  onRequestStatusChange,
  onRequestMutation,
}: {
  selectedCampaignId: string
  campaigns: CampaignInsight[]
  adSets: WorkspaceData['adSets']
  adInsights: WorkspaceData['adInsights']
  onSelectCampaign: (id: string) => void
  onOpenAiDrawer: (context: AiInsightDrawerContext) => void
  onRequestStatusChange: (request: DeliveryStatusChangeRequest) => void
  onRequestMutation: (request: MetaObjectMutationRequest) => void
}) {
  const [selectedAdSetId, setSelectedAdSetId] = useState('')
  const [controlScope, setControlScope] = useState<CampaignControlScope>('adset')
  const [expandedSections, setExpandedSections] = useState({
    navigator: false,
    metrics: true,
    delivery: true,
    adSets: false,
    ads: true,
  })
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0]
  const campaignAdSets = adSets.filter((adSet) => adSet.campaignId === selectedCampaign.id)
  const activeAdSetId = campaignAdSets.some((adSet) => adSet.id === selectedAdSetId)
    ? selectedAdSetId
    : campaignAdSets[0]?.id ?? ''
  const campaignAds = adInsights.filter((ad) => ad.campaignId === selectedCampaign.id)
  const visibleAds = campaignAds.filter((ad) => !activeAdSetId || ad.adSetId === activeAdSetId)
  const activeAdSet = campaignAdSets.find((adSet) => adSet.id === activeAdSetId)
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }))
  }
  const selectedCampaignDeliveryStatus = normalizeDeliveryStatus(selectedCampaign.deliveryStatus, selectedCampaign.spend)
  const selectedCampaignStatusMeta = statusMeta(selectedCampaign.aiStatus)
  const campaignControlRows = [{
    id: selectedCampaign.id,
    objectType: 'campaign' as const,
    name: selectedCampaign.name,
    subtitle: selectedCampaign.objective,
    status: selectedCampaignDeliveryStatus,
    spend: selectedCampaign.spend,
    roas: selectedCampaign.roas,
    results: selectedCampaign.conversions,
  }]
  const adSetControlRows = campaignAdSets.map((adSet) => ({
    id: adSet.id,
    objectType: 'adset' as const,
    name: adSet.name,
    subtitle: adSet.audience,
    status: normalizeDeliveryStatus(adSet.deliveryStatus, adSet.spend),
    spend: adSet.spend,
    roas: adSet.roas,
    results: adSet.bookings,
  }))
  const adControlRows = visibleAds.map((ad) => ({
    id: ad.id,
    objectType: 'ad' as const,
    name: ad.name,
    subtitle: ad.creative,
    status: normalizeDeliveryStatus(ad.status, ad.spend),
    spend: ad.spend,
    roas: ad.roas,
    results: ad.bookings,
  }))
  const controlRows =
    controlScope === 'campaign' ? campaignControlRows : controlScope === 'adset' ? adSetControlRows : adControlRows
  const controlOptions = [
    { id: 'campaign' as const, label: 'Campaign', rows: campaignControlRows },
    { id: 'adset' as const, label: 'Ad Sets', rows: adSetControlRows },
    { id: 'ad' as const, label: 'Ads', rows: adControlRows },
  ]
  const campaignListItems = expandedSections.navigator ? campaigns : [selectedCampaign]
  const selectedCampaignForm = emptyMetaObjectFormValues({
    name: selectedCampaign.name,
    status: toMetaObjectStatus(selectedCampaignDeliveryStatus),
    objective: selectedCampaign.objective,
    dailyBudget: selectedCampaign.budget > 0 ? String(Math.round(selectedCampaign.budget)) : '',
  })
  const activeAdSetForm = activeAdSet
    ? emptyMetaObjectFormValues({
        name: activeAdSet.name,
        status: toMetaObjectStatus(normalizeDeliveryStatus(activeAdSet.deliveryStatus, activeAdSet.spend)),
        campaignId: activeAdSet.campaignId || selectedCampaign.id,
        dailyBudget: activeAdSet.budget > 0 ? String(Math.round(activeAdSet.budget)) : '',
      })
    : emptyMetaObjectFormValues({ campaignId: selectedCampaign.id })

  return (
    <section className={`campaign-detail-grid ${expandedSections.navigator ? '' : 'navigator-collapsed'}`}>
      <div className="panel campaign-list-panel">
        <div className="campaign-panel-header">
          <div>
            <HeartPulse size={18} />
            <h2>{expandedSections.navigator ? 'Campaigns' : 'Selected Campaign'}</h2>
            <span>{expandedSections.navigator ? `${campaigns.length} campaigns` : 'compact'}</span>
          </div>
          <button
            className="collapse-button"
            type="button"
            aria-expanded={expandedSections.navigator}
            onClick={() => toggleSection('navigator')}
            title={expandedSections.navigator ? 'ย่อรายการ Campaigns' : 'ขยายรายการ Campaigns'}
          >
            <ChevronDown size={15} />
            {expandedSections.navigator ? 'ย่อ' : 'ขยาย'}
          </button>
        </div>
        <div className="campaign-list">
          {campaignListItems.map((campaign) => {
            const meta = statusMeta(campaign.aiStatus)
            return (
              <button
                key={campaign.id}
                type="button"
                className={campaign.id === selectedCampaign.id ? 'active' : ''}
                onClick={() => {
                  onSelectCampaign(campaign.id)
                  setSelectedAdSetId('')
                }}
              >
                <span className={`status-dot ${meta.className}`} />
                <strong>{campaign.name}</strong>
                <small>{campaign.roas.toFixed(2)}x ROAS · {fmtMoney(campaign.cpa)} CPA</small>
                <span className={`badge ${deliveryStatusTone(normalizeDeliveryStatus(campaign.deliveryStatus, campaign.spend))}`}>
                  {deliveryStatusLabel(normalizeDeliveryStatus(campaign.deliveryStatus, campaign.spend))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="panel campaign-main-panel">
        <div className="campaign-detail-hero">
          <div>
            <span className={`badge ${selectedCampaignStatusMeta.className}`}>
              {selectedCampaignStatusMeta.label}
            </span>
            <span className={`badge ${deliveryStatusTone(selectedCampaignDeliveryStatus)}`}>
              {deliveryStatusLabel(selectedCampaignDeliveryStatus)}
            </span>
            <h2>{selectedCampaign.name}</h2>
            <p>{selectedCampaign.aiSummary}</p>
          </div>
          <div className="object-command-bar">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                onRequestMutation({
                  operation: 'create',
                  objectType: 'campaign',
                  targetName: 'New campaign',
                  initialValues: emptyMetaObjectFormValues({ name: `${selectedCampaign.name} copy` }),
                })
              }
            >
              <Plus size={15} />
              Campaign
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                onRequestMutation({
                  operation: 'update',
                  objectType: 'campaign',
                  objectId: selectedCampaign.id,
                  targetName: selectedCampaign.name,
                  initialValues: selectedCampaignForm,
                })
              }
            >
              <Pencil size={15} />
              Edit
            </button>
            <button
              className="reject-button"
              type="button"
              onClick={() =>
                onRequestMutation({
                  operation: 'delete',
                  objectType: 'campaign',
                  objectId: selectedCampaign.id,
                  targetName: selectedCampaign.name,
                  initialValues: selectedCampaignForm,
                })
              }
            >
              <Trash2 size={15} />
              Delete
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() =>
                onOpenAiDrawer({
                  kind: 'campaign',
                  campaignId: selectedCampaign.id,
                  title: selectedCampaign.name,
                  subtitle: 'Campaign root-cause insight',
                })
              }
            >
              <BrainCircuit size={16} />
              AI Insights
            </button>
          </div>
        </div>

        <div className="campaign-section-bar">
          <div>
            <strong>Metrics</strong>
            <span>Budget, Spend, Booking, ROAS</span>
          </div>
          <button className="collapse-button" type="button" aria-expanded={expandedSections.metrics} onClick={() => toggleSection('metrics')}>
            <ChevronDown size={15} />
            {expandedSections.metrics ? 'ย่อ' : 'ขยาย'}
          </button>
        </div>
        {expandedSections.metrics && (
          <div className="campaign-summary-grid">
            <MiniMetric label="Budget" value={fmtMoney(selectedCampaign.budget)} help="Daily budget ของ campaign" />
            <MiniMetric label="Spend" value={fmtMoney(selectedCampaign.spend)} help={metricHelp.adSpend} />
            <MiniMetric label="Bookings" value={fmtNum(selectedCampaign.conversions)} help={metricHelp.bookings} />
            <MiniMetric label="ROAS" value={`${selectedCampaign.roas.toFixed(2)}x`} help={metricHelp.roas} />
            <MiniMetric label="CTR" value={`${selectedCampaign.ctr.toFixed(2)}%`} help={metricHelp.ctr} />
            <MiniMetric label="Frequency" value={selectedCampaign.frequency.toFixed(1)} help={metricHelp.frequency} />
          </div>
        )}

        <div className="delivery-control-panel">
          <div className="delivery-control-head">
            <div>
              <strong>Meta Delivery Control</strong>
              <span>ควบคุม selected campaign, ad sets และ ads</span>
            </div>
            <div className="delivery-header-actions">
              <div className="control-scope-tabs" aria-label="Delivery control scope">
                {controlOptions.map((option) => {
                  const active = option.rows.filter((row) => row.status === 'active').length
                  return (
                    <button
                      key={option.id}
                      className={controlScope === option.id ? 'active' : ''}
                      type="button"
                      onClick={() => setControlScope(option.id)}
                      title={`${active}/${option.rows.length} active`}
                    >
                      <span>{option.label}</span>
                      <strong>{active}/{option.rows.length}</strong>
                    </button>
                  )
                })}
              </div>
              <button className="collapse-button" type="button" aria-expanded={expandedSections.delivery} onClick={() => toggleSection('delivery')}>
                <ChevronDown size={15} />
                {expandedSections.delivery ? 'ย่อ' : 'ขยาย'}
              </button>
            </div>
          </div>

          {expandedSections.delivery && <div className="delivery-control-list">
            {controlRows.length === 0 && (
              <div className="empty-state table-empty-state">
                <Database size={18} />
                <strong>ยังไม่มีข้อมูลใน scope นี้</strong>
                <p>กด Sync Meta เพื่อดึงรายการ Campaign, Ad set และ Ads ล่าสุด</p>
              </div>
            )}
            {controlRows.map((row) => {
              const nextStatus = nextDeliveryStatus(row.status)
              return (
                <article key={`${row.objectType}-${row.id}`} className="delivery-control-row">
                  <div>
                    <span className={`badge ${deliveryStatusTone(row.status)}`}>{deliveryStatusLabel(row.status)}</span>
                    <strong>{row.name}</strong>
                    <small>{row.subtitle}</small>
                  </div>
                  <div className="delivery-metrics">
                    <span>{fmtMoney(row.spend)} spend</span>
                    <span>{row.roas.toFixed(2)}x ROAS</span>
                    <span>{fmtNum(row.results)} results</span>
                  </div>
                  <button
                    className={nextStatus === 'active' ? 'approve-button' : 'reject-button'}
                    type="button"
                    onClick={() =>
                      onRequestStatusChange({
                        objectType: row.objectType,
                        objectId: row.id,
                        targetName: row.name,
                        currentStatus: row.status,
                        nextStatus,
                        summary: `${nextStatus === 'active' ? 'Activate' : 'Pause'} ${row.name} จากหน้า Campaigns`,
                        source: 'campaigns',
                      })
                    }
                  >
                    {nextStatus === 'active' ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
                    {nextStatus === 'active' ? 'Activate' : 'Pause'}
                  </button>
                </article>
              )
            })}
          </div>}
        </div>
      </div>

      <div className="panel adset-panel">
        <div className="campaign-panel-header">
          <div>
            <Layers3 size={18} />
            <h2>Ad Sets</h2>
            <span>{activeAdSet ? activeAdSet.name : `${campaignAdSets.length} ad sets`}</span>
          </div>
          <div className="section-command-bar">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                onRequestMutation({
                  operation: 'create',
                  objectType: 'adset',
                  targetName: 'New ad set',
                  initialValues: emptyMetaObjectFormValues({ campaignId: selectedCampaign.id, name: `${selectedCampaign.name} - Ad Set` }),
                })
              }
            >
              <Plus size={15} />
              Ad Set
            </button>
            {activeAdSet && (
              <>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    onRequestMutation({
                      operation: 'update',
                      objectType: 'adset',
                      objectId: activeAdSet.id,
                      targetName: activeAdSet.name,
                      initialValues: activeAdSetForm,
                    })
                  }
                >
                  <Pencil size={15} />
                  Edit
                </button>
                <button
                  className="reject-button"
                  type="button"
                  onClick={() =>
                    onRequestMutation({
                      operation: 'delete',
                      objectType: 'adset',
                      objectId: activeAdSet.id,
                      targetName: activeAdSet.name,
                      initialValues: activeAdSetForm,
                    })
                  }
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              </>
            )}
            <button className="collapse-button" type="button" aria-expanded={expandedSections.adSets} onClick={() => toggleSection('adSets')}>
              <ChevronDown size={15} />
              {expandedSections.adSets ? 'ย่อ' : 'ขยาย'}
            </button>
          </div>
        </div>
        {expandedSections.adSets && <div className="adset-grid">
          {campaignAdSets.length === 0 && (
            <div className="empty-state">
              <Database size={18} />
              <strong>ยังไม่มี Ad Set details</strong>
              <p>Campaign นี้มาจากข้อมูล campaign-level หรือ CSV import ขั้นแรก ให้เพิ่ม ad set/ad CSV ในรอบถัดไปเพื่อ drill-down ลึกขึ้น</p>
            </div>
          )}
          {campaignAdSets.map((adSet) => {
            const meta = statusMeta(adSet.status)
            return (
              <button
                key={adSet.id}
                type="button"
                className={adSet.id === activeAdSetId ? 'active' : ''}
                onClick={() => setSelectedAdSetId(adSet.id)}
              >
                <span className={`badge ${meta.className}`}>{meta.label}</span>
                <span className={`badge ${deliveryStatusTone(normalizeDeliveryStatus(adSet.deliveryStatus, adSet.spend))}`}>
                  {deliveryStatusLabel(normalizeDeliveryStatus(adSet.deliveryStatus, adSet.spend))}
                </span>
                <strong>{adSet.name}</strong>
                <small>{adSet.audience}</small>
                <div>
                  <span>{fmtMoney(adSet.spend)} spend</span>
                  <span>{adSet.bookings} bookings</span>
                  <span>{adSet.roas.toFixed(2)}x ROAS</span>
                </div>
              </button>
            )
          })}
        </div>}
      </div>

      <div className="panel ads-panel">
        <div className="campaign-panel-header">
          <div>
            <ImageIcon size={18} />
            <h2>Ads</h2>
            <span>{`${visibleAds.length} ads in selected ad set`}</span>
          </div>
          <div className="section-command-bar">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                onRequestMutation({
                  operation: 'create',
                  objectType: 'ad',
                  targetName: 'New ad',
                  initialValues: emptyMetaObjectFormValues({
                    campaignId: selectedCampaign.id,
                    adSetId: activeAdSetId,
                    name: `${selectedCampaign.name} - Ad`,
                  }),
                })
              }
            >
              <Plus size={15} />
              Ad
            </button>
            <button className="collapse-button" type="button" aria-expanded={expandedSections.ads} onClick={() => toggleSection('ads')}>
              <ChevronDown size={15} />
              {expandedSections.ads ? 'ย่อ' : 'ขยาย'}
            </button>
          </div>
        </div>
        {expandedSections.ads && (
          <div className="ads-card-list">
            {visibleAds.length === 0 && (
              <div className="empty-state table-empty-state">
                <ImageIcon size={18} />
                <strong>ยังไม่มี Ads detail สำหรับ campaign นี้</strong>
                <p>ตอนนี้ระบบยังใช้ campaign metrics ในการวิเคราะห์ได้ แต่ creative/ad-level optimization ต้องรอ ad detail import</p>
              </div>
            )}
            {visibleAds.map((ad) => {
              const currentStatus = normalizeDeliveryStatus(ad.status, ad.spend)
              const nextStatus = nextDeliveryStatus(currentStatus)
              const adForm = emptyMetaObjectFormValues({
                name: ad.name,
                status: toMetaObjectStatus(currentStatus),
                campaignId: ad.campaignId,
                adSetId: ad.adSetId,
                creativeId: ad.creative,
              })
              return (
                <article key={ad.id} className="ads-detail-card">
                  <div className="ads-detail-main">
                    <button
                      className="table-title ads-detail-title"
                      type="button"
                      onClick={() =>
                        onOpenAiDrawer({
                          kind: 'ad',
                          campaignId: ad.campaignId,
                          title: ad.name,
                          subtitle: `${ad.creative} · ${ad.status.toUpperCase()}`,
                        })
                      }
                    >
                      {ad.name}
                    </button>
                    <span>{ad.creative} · {fmtNum(ad.impressions)} impressions</span>
                    <div className="ads-detail-metrics">
                      <span>Spend <strong>{fmtMoney(ad.spend)}</strong></span>
                      <span>CTR <strong>{ad.ctr.toFixed(2)}%</strong></span>
                      <span>CPC <strong>{fmtMoney(ad.cpc)}</strong></span>
                      <span>Leads <strong>{fmtNum(ad.leads)}</strong></span>
                      <span>Bookings <strong>{fmtNum(ad.bookings)}</strong></span>
                      <span>Show-up <strong>{ad.showRate}%</strong></span>
                      <span>ROAS <strong>{ad.roas.toFixed(2)}x</strong></span>
                    </div>
                  </div>
                  <div className="ads-detail-controls">
                    <div className="ads-detail-status">
                      <span className={`badge ${currentStatus === 'active' ? 'good' : 'critical'}`}>
                        {currentStatus === 'active' ? 'ACTIVE' : 'PAUSED'}
                      </span>
                      <strong>Score {ad.score.toFixed(1)}</strong>
                    </div>
                    <div className="row-action-group ads-row-actions">
                      <button
                        className={nextStatus === 'active' ? 'mini-control-button good' : 'mini-control-button critical'}
                        type="button"
                        onClick={() =>
                          onRequestStatusChange({
                            objectType: 'ad',
                            objectId: ad.id,
                            targetName: ad.name,
                            currentStatus,
                            nextStatus,
                            summary: `${nextStatus === 'active' ? 'Activate' : 'Pause'} ad จาก Ads card`,
                            source: 'campaigns',
                          })
                        }
                      >
                        {nextStatus === 'active' ? 'Activate' : 'Pause'}
                      </button>
                      <button
                        className="mini-control-button neutral"
                        type="button"
                        onClick={() =>
                          onRequestMutation({
                            operation: 'update',
                            objectType: 'ad',
                            objectId: ad.id,
                            targetName: ad.name,
                            initialValues: adForm,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="mini-control-button critical"
                        type="button"
                        onClick={() =>
                          onRequestMutation({
                            operation: 'delete',
                            objectType: 'ad',
                            objectId: ad.id,
                            targetName: ad.name,
                            initialValues: adForm,
                          })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function MiniMetric({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <article className="mini-metric">
      <span>
        {label}
        <InfoHint text={help} />
      </span>
      <strong>{value}</strong>
    </article>
  )
}

function MeasuredChart({
  className,
  children,
}: {
  className: string
  children: (size: { width: number; height: number }) => ReactNode
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const node = frameRef.current
    if (!node) return undefined

    const updateSize = () => {
      const rect = node.getBoundingClientRect()
      setSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      })
    }

    updateSize()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null
    observer?.observe(node)
    window.addEventListener('resize', updateSize)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  return (
    <div ref={frameRef} className={className}>
      {size.width > 1 && size.height > 1 ? children(size) : null}
    </div>
  )
}

function PlatformHome({
  modules,
  services,
  stages,
  onOpen,
}: {
  modules: ToolTab[]
  services: ServiceLine[]
  stages: AppointmentStage[]
  onOpen: (tab: TabId) => void
}) {
  const booked = stages.find((stage) => stage.id === 'booked')?.count ?? 0
  const showRate = stages.find((stage) => stage.id === 'show')?.rate ?? '-'
  const functionStack: Array<{ label: string; detail: string; target: TabId; icon: typeof BarChart3; meta: string }> = [
    {
      label: 'AI Marketer',
      detail: 'Audit account ทุกวัน แล้วเสนอ action ที่ทีมกด approve หรือ execute ได้',
      target: 'actions',
      icon: BrainCircuit,
      meta: 'daily audit',
    },
    {
      label: 'Optimization',
      detail: 'จับ spend leakage, winner ads และ pause/activate ผ่าน Meta guardrails',
      target: 'auto',
      icon: Power,
      meta: 'budget control',
    },
    {
      label: 'Creative Workflow',
      detail: 'ดู creative performance, work orders และ asset library ใน flow เดียว',
      target: 'tasks',
      icon: ImageIcon,
      meta: 'creative loop',
    },
    {
      label: 'Analytics Report',
      detail: 'รวม dashboard, funnel, service revenue และ PDF-ready reporting',
      target: 'overview',
      icon: LineChart,
      meta: 'one-click report',
    },
  ]

  return (
    <section className="platform-grid">
      <div className="platform-main-stack">
        <div className="platform-hero panel">
          <div>
            <span className="badge scale">AI Ads Operating System</span>
            <h2>จัดการ Meta Ads แบบ media buyer dashboard</h2>
            <p>รวม AI Marketer, optimization, creative insights, automation และ reports สำหรับธุรกิจคลินิกไว้ในหน้าเดียว</p>
          </div>
          <div className="platform-hero-visual">
            <div className="platform-mascot-card" aria-hidden="true">
              <span className="mascot-orbit one" />
              <span className="mascot-orbit two" />
              <span className="mascot-orbit three" />
              <img src="/pmc-ai-mascot.png" alt="" />
            </div>
            <div className="platform-hero-stats">
              <div>
                <span>Bookings</span>
                <strong>{booked}</strong>
              </div>
              <div>
                <span>Show-up</span>
                <strong>{showRate}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="app-module-grid">
          {modules.map((module, index) => {
            const Icon = module.icon
            const helpText = platformToolHelp[module.id as Exclude<TabId, 'platform'>] ?? module.description
            const tooltipId = `platform-tool-help-${module.id}`
            return (
              <button
                key={module.id}
                type="button"
                className={`app-module-card tone-${(index % 5) + 1}`}
                aria-label={`${module.label}: ${helpText}`}
                aria-describedby={tooltipId}
                onClick={() => onOpen(module.id)}
              >
                <span className="app-module-head">
                  <span className="app-icon">
                    <Icon size={22} />
                  </span>
                  <span className="tool-info-dot" aria-hidden="true">
                    <Info size={13} />
                  </span>
                </span>
                <strong>{module.label}</strong>
                <small>{module.description}</small>
                <span id={tooltipId} className="tool-help-tooltip" role="tooltip">
                  {helpText}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="panel platform-side">
        <PanelHeader icon={BrainCircuit} title="AI Marketer Flow" meta="audit · optimize · launch" />
        <div className="platform-function-list">
          {functionStack.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.label} type="button" onClick={() => onOpen(item.target)}>
                <span className="function-icon">
                  <Icon size={15} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <em>{item.meta}</em>
              </button>
            )
          })}
        </div>
      </div>

      <div className="panel platform-service-panel">
        <PanelHeader icon={HeartPulse} title="Service Snapshot" meta={`${services.length} service apps`} />
        <div className="platform-service-list">
          {services.length === 0 && (
            <div className="empty-state">
              <Database size={18} />
              <strong>ยังไม่มี service snapshot</strong>
              <p>Service line จะถูกสร้างจาก campaign/service names และ conversion value หลัง sync ข้อมูลจริง</p>
            </div>
          )}
          {services.map((service) => {
            const meta = statusMeta(service.aiStatus)
            return (
              <button key={service.id} type="button" onClick={() => onOpen('campaigns')}>
                <span className={`status-dot ${meta.className}`} />
                <strong>{service.name}</strong>
                <small>{service.showRate > 0 ? `${service.showRate}% show-up` : 'show-up pending'}</small>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function SettingsPage({
  metaSync,
  aiRuntime,
  onRefreshStatus,
  onRefreshAiStatus,
  onCheckMeta,
  onSyncMeta,
  onSaveConfig,
  onClearConfig,
}: {
  metaSync: MetaSyncState
  aiRuntime: AiRuntimeState
  onRefreshStatus: () => void
  onRefreshAiStatus: () => void
  onCheckMeta: () => void
  onSyncMeta: () => void
  onSaveConfig: (form: MetaConfigFormValues) => Promise<MetaCheckPayload>
  onClearConfig: () => Promise<void>
}) {
  const [form, setForm] = useState<MetaConfigFormValues>({
    accessToken: '',
    adAccountId: '',
    graphVersion: 'v21.0',
    datePreset: DEFAULT_META_DATE_PRESET,
    maxPages: 6,
  })
  const [hasSavedToken, setHasSavedToken] = useState(false)
  const [formMessage, setFormMessage] = useState<{ tone: 'good' | 'watch' | 'critical'; text: string } | null>(null)
  const statusLabel = metaSync.connected ? 'Connected' : metaSync.configured ? 'Configured' : 'Not configured'
  const statusTone = metaSync.connected ? 'good' : metaSync.configured ? 'watch' : 'critical'
  const checkItems =
    metaSync.checkResult?.checks ??
    metaSync.envChecks.map((check) => ({
      key: check.key,
      label: check.key,
      status: check.present || check.source.includes('optional') ? ('pass' as const) : ('fail' as const),
      detail: check.present ? `${check.source} configured` : check.help,
    }))

  useEffect(() => {
    let cancelled = false

    fetch('/api/meta/config')
      .then((response) => response.json())
      .then((payload: MetaConfigPayload) => {
        if (cancelled) return
        setHasSavedToken(Boolean(payload.hasSavedToken))
        setForm((current) => ({
          ...current,
          accessToken: '',
          adAccountId: payload.adAccountId ?? current.adAccountId,
          graphVersion: payload.graphVersion ?? current.graphVersion,
          datePreset: payload.datePreset ?? current.datePreset,
          maxPages: payload.maxPages ?? current.maxPages,
        }))
      })
      .catch(() => {
        if (!cancelled) setFormMessage({ tone: 'critical', text: 'โหลด config ไม่สำเร็จ' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const updateForm = <K extends keyof MetaConfigFormValues>(key: K, value: MetaConfigFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const saveForm = async () => {
    try {
      const result = await onSaveConfig(form)
      setHasSavedToken(true)
      setForm((current) => ({ ...current, accessToken: '' }))
      setFormMessage({
        tone: result.ok ? 'good' : 'critical',
        text: result.ok ? 'บันทึกและตรวจ Meta API ผ่านแล้ว' : result.error ?? 'บันทึกแล้ว แต่ connection check ยังไม่ผ่าน',
      })
    } catch (error) {
      setFormMessage({
        tone: 'critical',
        text: error instanceof Error ? error.message : 'บันทึก Meta API config ไม่สำเร็จ',
      })
    }
  }

  const clearForm = async () => {
    await onClearConfig()
    setHasSavedToken(false)
    setForm((current) => ({ ...current, accessToken: '', adAccountId: '' }))
    setFormMessage({ tone: 'watch', text: 'ล้าง config ที่บันทึกจากหน้าเว็บแล้ว' })
  }

  return (
    <section className="settings-grid">
      <div className="panel settings-hero">
        <PanelHeader icon={Settings} title="API Settings" meta="Meta API · server proxy" />
        <div className="settings-hero-content">
          <div>
            <span className={`badge ${statusTone}`}>{statusLabel}</span>
            <h2>ตั้งค่า Meta API จากหน้าเว็บ</h2>
            <p>ใส่ Access Token และ Ad Account ID ที่นี่ได้เลย ระบบจะบันทึกเป็นไฟล์ local ฝั่ง server แล้วใช้ดึงข้อมูล Meta จริงเข้าทั้ง Dashboard</p>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={onRefreshStatus}>
              <RefreshCw size={16} />
              Check Status
            </button>
            <button className="primary-button" type="button" onClick={onCheckMeta} disabled={metaSync.checking}>
              <ShieldCheck size={16} />
              {metaSync.checking ? 'Checking...' : 'Test Connection'}
            </button>
            <button className="secondary-button" type="button" onClick={onSyncMeta} disabled={metaSync.loading || !metaSync.configured}>
              <Database size={16} />
              {metaSync.loading ? 'Syncing...' : 'Sync Meta'}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-summary-grid">
        <MiniMetric label="Connection" value={statusLabel} help="สถานะการตั้งค่า Meta API จาก backend proxy" />
        <MiniMetric label="Graph" value={metaSync.graphVersion} help="Meta Graph / Marketing API version ที่ server ใช้เรียก" />
        <MiniMetric label="Date Preset" value={metaSync.datePreset} help="ช่วงเวลาของ insights ที่ใช้ตอน sync" />
        <MiniMetric label="OpenAI" value={aiRuntime.connected ? aiRuntime.model : 'Not ready'} help="สถานะ OpenAI API key สำหรับ AI Marketer และ Creative Kit ฝั่ง backend" />
        <MiniMetric label="Last Check" value={metaSync.lastStatusCheckAt ? new Date(metaSync.lastStatusCheckAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'} help="เวลาล่าสุดที่ตรวจ status หรือ connection" />
      </div>

      <div className="panel api-card">
        <PanelHeader icon={Plug} title="API Credentials" meta={hasSavedToken ? 'saved locally' : 'web form'} />
        <div className="api-form-grid">
          <label>
            <span>Access Token</span>
            <input
              value={form.accessToken}
              type="password"
              autoComplete="off"
              placeholder={hasSavedToken ? 'Saved token exists · ใส่ใหม่เมื่อต้องการเปลี่ยน' : 'EAAB...'}
              onChange={(event) => updateForm('accessToken', event.target.value)}
            />
          </label>
          <label>
            <span>Ad Account ID</span>
            <input
              value={form.adAccountId}
              placeholder="act_1234567890"
              onChange={(event) => updateForm('adAccountId', event.target.value)}
            />
          </label>
          <label>
            <span>Graph Version</span>
            <input
              value={form.graphVersion}
              placeholder="v21.0"
              onChange={(event) => updateForm('graphVersion', event.target.value)}
            />
          </label>
          <label>
            <span>Date Preset</span>
            <select value={form.datePreset} onChange={(event) => updateForm('datePreset', event.target.value)}>
              {datePresetOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Max Pages</span>
            <input
              value={form.maxPages}
              type="number"
              min={1}
              max={20}
              onChange={(event) => updateForm('maxPages', Number(event.target.value) || 1)}
            />
          </label>
        </div>
        <div className="data-action-row">
          <button className="primary-button" type="button" onClick={saveForm} disabled={metaSync.checking}>
            <ShieldCheck size={16} />
            {metaSync.checking ? 'Saving...' : 'Save & Test'}
          </button>
          <button className="reject-button" type="button" onClick={clearForm} disabled={metaSync.checking}>
            <X size={16} />
            Clear Saved
          </button>
        </div>
        {formMessage && <div className={`data-notice ${formMessage.tone}`}>{formMessage.text}</div>}
        <p className="data-hint">Token จะถูกส่งไปเก็บที่ `.meta-api.local.json` ฝั่ง server และไฟล์นี้ถูก ignore แล้ว</p>
      </div>

      <div className="panel api-card">
        <PanelHeader icon={Database} title="Current API State" meta={metaSync.connected ? 'ready' : 'not ready'} />
        <div className="api-config-grid">
          <div>
            <span>Account</span>
            <strong>{metaSync.accountName ?? metaSync.adAccountId ?? '-'}</strong>
          </div>
          <div>
            <span>Records</span>
            <strong>{metaSync.counts ? `${metaSync.counts.campaigns} campaigns · ${metaSync.counts.adSets} ad sets · ${metaSync.counts.ads} ads` : '-'}</strong>
          </div>
          <div>
            <span>Token location</span>
            <strong>{hasSavedToken ? 'web settings file' : 'not saved'}</strong>
          </div>
          <div>
            <span>Write execution</span>
            <strong>confirm-only</strong>
          </div>
        </div>
        {metaSync.error && <div className="data-notice critical">{metaSync.error}</div>}
      </div>

      <div className="panel api-card">
        <PanelHeader icon={BrainCircuit} title="OpenAI Runtime" meta={aiRuntime.connected ? 'configured' : 'not ready'} />
        <div className="api-config-grid">
          <div>
            <span>Model</span>
            <strong>{aiRuntime.model}</strong>
          </div>
          <div>
            <span>Source</span>
            <strong>{aiRuntime.source}</strong>
          </div>
          <div>
            <span>Key location</span>
            <strong>{aiRuntime.tokenLocation ?? 'missing'}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{aiRuntime.connected ? 'Configured' : 'Not configured'}</strong>
          </div>
        </div>
        <div className="data-action-row">
          <button className="secondary-button" type="button" onClick={onRefreshAiStatus} disabled={aiRuntime.loading}>
            <RefreshCw size={16} />
            {aiRuntime.loading ? 'Checking...' : 'Check OpenAI'}
          </button>
        </div>
        {aiRuntime.error && <div className="data-notice critical">{aiRuntime.error}</div>}
        <div className="api-check-list compact-check-list">
          {aiRuntime.envChecks.map((item) => (
            <div key={item.key}>
              <span className={`status-dot ${item.present ? 'good' : 'critical'}`} />
              <strong>{item.key}</strong>
              <small>{item.present ? `${item.source} configured` : item.help}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="panel api-card">
        <PanelHeader icon={CheckCircle2} title="Connection Checks" meta={metaSync.checkResult?.ok ? 'passed' : 'ready to test'} />
        <div className="api-check-list">
          {checkItems.length === 0 && (
            <div className="empty-state">
              <ShieldCheck size={18} />
              <strong>ยังไม่มีผลตรวจ</strong>
              <p>กด Test Connection เพื่อตรวจ server env, token, ad account และ insights read</p>
            </div>
          )}
          {checkItems.map((item) => (
            <div key={item.key}>
              <span className={`status-dot ${item.status === 'pass' ? 'good' : item.status === 'warn' ? 'watch' : 'critical'}`} />
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="panel api-card">
        <PanelHeader icon={Activity} title="API Endpoints" meta="local backend proxy" />
        <div className="endpoint-list">
          <div>
            <strong>GET /api/meta/config</strong>
            <span>อ่านสถานะ config ที่บันทึกจากหน้า Settings โดยไม่ส่ง token กลับมา</span>
          </div>
          <div>
            <strong>POST /api/meta/config</strong>
            <span>บันทึก Access Token และ Ad Account ID จากหน้าเว็บลงไฟล์ local server</span>
          </div>
          <div>
            <strong>GET /api/meta/status</strong>
            <span>ตรวจว่า env ถูกตั้งค่าและ frontend เห็นสถานะ connection หรือไม่</span>
          </div>
          <div>
            <strong>GET /api/meta/check</strong>
            <span>ตรวจ /me, ad account และ insights read โดยไม่ sync ข้อมูลเข้า workspace</span>
          </div>
          <div>
            <strong>POST /api/meta/object-status</strong>
            <span>เปลี่ยนสถานะ Campaign, Ad set หรือ Ad เป็น ACTIVE/PAUSED ผ่าน confirmation ในเว็บ</span>
          </div>
          <div>
            <strong>POST /api/meta/bulk-status</strong>
            <span>เปลี่ยนสถานะ Ads หลายรายการจาก Optimization Auto rules ในคำสั่งเดียว จำกัด 25 actions ต่อรอบ</span>
          </div>
          <div>
            <strong>POST /api/meta/object</strong>
            <span>สร้าง แก้ไข หรือลบ Campaign, Ad set และ Ad ผ่าน Object Manager พร้อม confirmation</span>
          </div>
          <div>
            <strong>POST /api/meta/creative-launch</strong>
            <span>สร้าง Ad Creative แบบ Auto Post และ Ad ใน Meta จาก Creative Studio โดยแนะนำให้เริ่มเป็น PAUSED</span>
          </div>
          <div>
            <strong>GET /api/meta/workspace</strong>
            <span>ดึง Meta dataset และ map เป็นข้อมูลทั้ง Dashboard</span>
          </div>
          <div>
            <strong>GET /api/ai/status</strong>
            <span>ตรวจ OpenAI API key และ model สำหรับ AI Marketer / Creative Kit โดยไม่ส่ง key กลับ browser</span>
          </div>
          <div>
            <strong>POST /api/ai/marketer</strong>
            <span>ให้ OpenAI วิเคราะห์ Meta workspace จริงและสร้าง AI Insights กับ Action Queue แบบมี guardrails</span>
          </div>
          <div>
            <strong>POST /api/ai/creative</strong>
            <span>ให้ OpenAI สร้าง creative brief, hooks, copy, compliance notes และ work orders จาก source ad จริง</span>
          </div>
        </div>
      </div>

      <div className="panel api-card wide-settings-card">
        <PanelHeader icon={ShieldCheck} title="Security Guardrails" meta="internal use" />
        <div className="settings-guardrails">
          <Signal icon={ShieldCheck} text="Token ไม่ถูกเก็บใน browser" tone="good" help="เมื่อกด Save token จะถูกส่งไป server และไม่ถูกบันทึกใน localStorage" />
          <Signal icon={Power} text="Write execution ต้อง confirm ก่อนทุกครั้ง" tone="watch" help="การเปลี่ยนสถานะ Campaign, Ad set และ Ad จะยิง Meta API หลังผู้ใช้กด confirm เท่านั้น" />
          <Signal icon={FileClock} text="ทุก sync เขียน Audit Log" tone="good" help="เมื่อ sync สำเร็จ workspace จะมี audit event ระบุ account และจำนวน records" />
        </div>
      </div>
    </section>
  )
}

function AppointmentsPage({ stages, services }: { stages: AppointmentStage[]; services: ServiceLine[] }) {
  return (
    <section className="appointments-grid">
      <div className="panel appointments-hero">
        <PanelHeader icon={CalendarCheck} title="Appointment Pipeline" meta="Lead → Treatment" />
        <div className="pipeline-flow">
          {stages.map((stage) => {
            const meta = statusMeta(stage.status)
            return (
              <article key={stage.id} className="pipeline-card">
                <span className={`badge ${meta.className}`}>{stage.label}</span>
                <strong>{fmtNum(stage.count)}</strong>
                <small>{stage.rate}</small>
                <p>{stage.note}</p>
              </article>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <PanelHeader icon={AlertTriangle} title="No-show Risk" meta="AI queue" />
        <div className="risk-list">
          {services.filter((service) => service.showRate > 0 && service.showRate < 75).length === 0 && (
            <div className="empty-state">
              <ShieldCheck size={18} />
              <strong>ยังไม่มี no-show risk ที่ยืนยันได้</strong>
              <p>ต้องมี show-up data จาก appointment/CRM ก่อนจึงจะจัด risk รายบริการ</p>
            </div>
          )}
          {services
            .filter((service) => service.showRate > 0 && service.showRate < 75)
            .map((service) => (
              <article key={service.id}>
                <strong>{service.name}</strong>
                <p>{service.showRate}% show-up · ส่งให้ Admin โทร confirm และส่ง reminder</p>
              </article>
            ))}
        </div>
      </div>
    </section>
  )
}

function CreativeStudioPage({
  tasks,
  campaigns,
  adSets,
  adInsights,
  aiRuntime,
  onSyncMeta,
  onRefreshAiStatus,
}: {
  tasks: AgentTask[]
  campaigns: CampaignInsight[]
  adSets: WorkspaceData['adSets']
  adInsights: WorkspaceData['adInsights']
  aiRuntime: AiRuntimeState
  onSyncMeta: () => Promise<void>
  onRefreshAiStatus: () => void
}) {
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]))
  const adSetById = new Map(adSets.map((adSet) => [adSet.id, adSet]))
  const topAds = adInsights.slice().sort((a, b) => b.spend - a.spend).slice(0, 12)
  const totalSpend = adInsights.reduce((sum, ad) => sum + ad.spend, 0)
  const totalResults = adInsights.reduce((sum, ad) => sum + ad.bookings, 0)
  const avgScore = safeDivide(adInsights.reduce((sum, ad) => sum + ad.score, 0), adInsights.length)
  const activeAds = adInsights.filter((ad) => ad.status === 'active').length
  const launchPanelRef = useRef<HTMLDivElement | null>(null)
  const performancePanelRef = useRef<HTMLDivElement | null>(null)
  const [selectedSourceAdId, setSelectedSourceAdId] = useState(topAds[0]?.id ?? '')
  const selectedSourceAd = topAds.find((ad) => ad.id === selectedSourceAdId) ?? topAds[0]
  const selectedAdSet = selectedSourceAd ? adSetById.get(selectedSourceAd.adSetId) : adSets[0]
  const defaultAdSetId = selectedAdSet?.id ?? adSets[0]?.id ?? ''
  const [launchForm, setLaunchForm] = useState<CreativeLaunchFormValues>(() => ({
    pageId: typeof window !== 'undefined' ? window.localStorage.getItem('pmc-creative-launch-page-id') ?? '' : '',
    adSetId: defaultAdSetId,
    adName: selectedSourceAd ? `Auto post · ${selectedSourceAd.name}` : 'Auto post ad',
    creativeName: selectedSourceAd ? `Creative · ${selectedSourceAd.creative}` : 'Auto post creative',
    linkUrl: '',
    primaryText: selectedSourceAd ? `ดูโปรโมชันและปรึกษากับทีมคลินิกได้เลย\n\n${selectedSourceAd.name}` : '',
    headline: selectedSourceAd?.name ?? 'โปรโมชันคลินิก',
    description: 'จองคิวปรึกษาและรับข้อเสนอจากคลินิก',
    ctaType: 'LEARN_MORE',
    status: 'PAUSED',
  }))
  const [launchState, setLaunchState] = useState<{ running: boolean; error: string | null; result: CreativeLaunchPayload | null }>({
    running: false,
    error: null,
    result: null,
  })
  const [creativeAiState, setCreativeAiState] = useState<{
    running: boolean
    error: string | null
    result: AiCreativeKitResult | null
  }>({
    running: false,
    error: null,
    result: null,
  })

  useEffect(() => {
    if (launchForm.pageId.trim()) {
      window.localStorage.setItem('pmc-creative-launch-page-id', launchForm.pageId.trim())
    }
  }, [launchForm.pageId])

  useEffect(() => {
    if (!launchForm.adSetId && defaultAdSetId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLaunchForm((current) => ({ ...current, adSetId: defaultAdSetId }))
    }
  }, [defaultAdSetId, launchForm.adSetId])

  useEffect(() => {
    if (!selectedSourceAd) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLaunchForm((current) => {
      const nextAdName = current.adName === 'Auto post ad' ? `Auto post · ${selectedSourceAd.name}` : current.adName
      const nextCreativeName = current.creativeName === 'Auto post creative' ? `Creative · ${selectedSourceAd.creative}` : current.creativeName
      const nextPrimaryText = current.primaryText.trim()
        ? current.primaryText
        : `ดูโปรโมชันและปรึกษากับทีมคลินิกได้เลย\n\n${selectedSourceAd.name}`
      const nextHeadline = current.headline === 'โปรโมชันคลินิก' || !current.headline.trim() ? selectedSourceAd.name : current.headline
      const nextAdSetId = current.adSetId || selectedSourceAd.adSetId || defaultAdSetId

      if (
        nextAdName === current.adName
        && nextCreativeName === current.creativeName
        && nextPrimaryText === current.primaryText
        && nextHeadline === current.headline
        && nextAdSetId === current.adSetId
      ) {
        return current
      }

      return {
        ...current,
        adSetId: nextAdSetId,
        adName: nextAdName,
        creativeName: nextCreativeName,
        primaryText: nextPrimaryText,
        headline: nextHeadline,
      }
    })
  }, [selectedSourceAd, defaultAdSetId])

  const updateLaunchForm = <K extends keyof CreativeLaunchFormValues>(key: K, value: CreativeLaunchFormValues[K]) => {
    setLaunchForm((current) => ({ ...current, [key]: value }))
  }

  const selectSourceAd = (adId: string) => {
    const ad = topAds.find((item) => item.id === adId)
    setSelectedSourceAdId(adId)
    if (!ad) return

    setLaunchForm((current) => ({
      ...current,
      adSetId: ad.adSetId || current.adSetId,
      adName: `Auto post · ${ad.name}`,
      creativeName: `Creative · ${ad.creative}`,
      primaryText: current.primaryText.trim() ? current.primaryText : `ดูโปรโมชันและปรึกษากับทีมคลินิกได้เลย\n\n${ad.name}`,
      headline: ad.name,
    }))
  }

  const handleCreativeLaunch = async () => {
    if (!launchForm.pageId.trim() || !launchForm.adSetId.trim() || !launchForm.linkUrl.trim() || !launchForm.primaryText.trim() || !launchForm.headline.trim()) {
      setLaunchState({ running: false, error: 'กรุณากรอก Meta Page ID, Ad Set, URL, Primary Text และ Headline ให้ครบก่อนสร้าง Ad', result: null })
      return
    }

    setLaunchState({ running: true, error: null, result: null })
    try {
      const response = await fetch('/api/meta/creative-launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(launchForm),
      })
      const payload = (await response.json()) as Partial<CreativeLaunchPayload>
      if (!response.ok || payload.error) {
        throw new Error(payload.error || 'Meta creative launch failed')
      }
      setLaunchState({ running: false, error: null, result: payload as CreativeLaunchPayload })
      await onSyncMeta()
    } catch (error) {
      setLaunchState({ running: false, error: error instanceof Error ? error.message : 'Meta creative launch failed', result: null })
    }
  }

  const handleGenerateCreativeKit = async () => {
    if (!selectedSourceAd) {
      setCreativeAiState({ running: false, error: 'ต้องเลือก source creative จาก Meta ad-level data ก่อน', result: null })
      return
    }

    setCreativeAiState({ running: true, error: null, result: null })
    try {
      const response = await fetch('/api/ai/creative', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceAd: selectedSourceAd,
          adSet: selectedAdSet,
          campaign: campaignById.get(selectedSourceAd.campaignId),
          launchForm,
        }),
      })
      const payload = (await response.json()) as Partial<AiCreativePayload>
      if (!response.ok || payload.error || !payload.ok || !payload.result) {
        throw new Error(payload.error || 'AI Creative Kit generation failed')
      }
      setCreativeAiState({ running: false, error: null, result: payload.result })
    } catch (error) {
      setCreativeAiState({
        running: false,
        error: error instanceof Error ? error.message : 'AI Creative Kit generation failed',
        result: null,
      })
    }
  }

  const applyCreativeKitToLaunchForm = () => {
    const kit = creativeAiState.result
    if (!kit) return
    setLaunchForm((current) => ({
      ...current,
      primaryText: kit.primaryTexts[0] ?? current.primaryText,
      headline: kit.headlines[0] ?? current.headline,
      description: kit.descriptions[0] ?? current.description,
      ctaType: ['LEARN_MORE', 'SIGN_UP', 'CONTACT_US', 'BOOK_TRAVEL', 'WHATSAPP_MESSAGE'].includes(kit.recommendedCta)
        ? kit.recommendedCta
        : current.ctaType,
      adName: selectedSourceAd ? `AI variation · ${selectedSourceAd.name}` : current.adName,
      creativeName: selectedSourceAd ? `AI creative · ${selectedSourceAd.creative}` : current.creativeName,
    }))
    launchPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const launchNotes = buildCreativeLaunchNotes(selectedSourceAd, selectedAdSet)
  const launchReady = Boolean(
    launchForm.pageId.trim()
      && launchForm.adSetId.trim()
      && launchForm.linkUrl.trim()
      && launchForm.primaryText.trim()
      && launchForm.headline.trim(),
  )
  const scrollToPanel = (ref: { current: HTMLDivElement | null }) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="studio-grid">
      <div className="panel studio-hero">
        <PanelHeader icon={Layers3} title="Creative Studio" meta="Meta ad-level API" />
        <div className="studio-hero-content">
          <div>
            <h2>Creative performance, work orders และ Auto Post พร้อม Meta Ads</h2>
            <p>จัดอันดับ ads, สร้าง launch notes และเตรียมโพสต์/โฆษณาใหม่เข้ากับ Meta Ad Set จริง โดย default สร้างเป็น PAUSED เพื่อให้ตรวจ preview ก่อนเปิดใช้งาน</p>
          </div>
          <div className="studio-actions">
            <button className="secondary-button" type="button" onClick={() => scrollToPanel(performancePanelRef)}>
              <BarChart3 size={16} />
              Creative Score
            </button>
            <button className="primary-button" type="button" onClick={() => scrollToPanel(launchPanelRef)}>
              <Plus size={16} />
              Auto Post
            </button>
          </div>
        </div>
        <div className="studio-summary-grid">
          <MiniMetric label="Synced Ads" value={fmtNum(adInsights.length)} help="จำนวน ads ที่ดึงจาก Meta API ใน date preset ปัจจุบัน" />
          <MiniMetric label="Active Ads" value={fmtNum(activeAds)} help="จำนวน ads ที่ Meta effective status เป็น ACTIVE" />
          <MiniMetric label="Spend" value={fmtMoney(totalSpend)} help="ยอด spend รวมของ ad-level creative metrics" />
          <MiniMetric label="Results" value={fmtNum(totalResults)} help="จำนวน booking/conversion จาก ad-level insights" />
          <MiniMetric label="Avg Score" value={avgScore.toFixed(1)} help="คะแนน creative เฉลี่ยจาก ROAS, CTR, conversion และ fatigue signals" />
        </div>
      </div>

      <div className="panel creative-ai-panel">
        <PanelHeader
          icon={BrainCircuit}
          title="AI Creative Kit"
          meta={aiRuntime.configured ? `${aiRuntime.model} · source ad` : 'OpenAI setup required'}
          help="สร้าง creative brief, hooks, primary text, headline, compliance notes และ work orders จาก source ad ที่ดึงมาจาก Meta API"
        />
        <div className="creative-ai-layout">
          <div className="creative-ai-source">
            <span className={`badge ${selectedSourceAd?.status === 'active' ? 'good' : 'watch'}`}>
              {selectedSourceAd ? deliveryStatusLabel(selectedSourceAd.status) : 'No source'}
            </span>
            <h3>{selectedSourceAd?.name ?? 'เลือก source creative ก่อน'}</h3>
            <p>
              {selectedSourceAd
                ? `${fmtMoney(selectedSourceAd.spend)} spend · ${selectedSourceAd.ctr.toFixed(2)}% CTR · ${selectedSourceAd.roas.toFixed(2)}x ROAS · Score ${selectedSourceAd.score.toFixed(1)}`
                : 'AI Creative Kit ต้องใช้ ad-level metrics จริงก่อน'}
            </p>
            <div className="ai-marketer-actions compact-actions">
              <button className="secondary-button" type="button" onClick={onRefreshAiStatus} disabled={aiRuntime.loading}>
                <RefreshCw size={16} />
                {aiRuntime.loading ? 'Checking...' : 'Check AI'}
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={handleGenerateCreativeKit}
                disabled={creativeAiState.running || !aiRuntime.configured || !selectedSourceAd}
              >
                <Sparkles size={16} />
                {creativeAiState.running ? 'Generating...' : 'Generate Kit'}
              </button>
            </div>
            {!aiRuntime.configured && <div className="data-notice watch">ต้องตั้งค่า OPENAI_API_KEY ฝั่ง server ก่อนใช้ AI Creative Kit</div>}
            {creativeAiState.error && <div className="data-notice critical">{creativeAiState.error}</div>}
          </div>
          <div className="creative-ai-result">
            {!creativeAiState.result && (
              <div className="empty-state ai-empty-state">
                <BrainCircuit size={18} />
                <strong>ยังไม่ได้ generate</strong>
                <p>กด Generate Kit เพื่อให้ OpenAI สร้าง copy และ notes จาก source ad นี้</p>
              </div>
            )}
            {creativeAiState.result && (
              <>
                <div className="ai-result-summary creative-kit-summary">
                  <strong>{creativeAiState.result.summary}</strong>
                  <div>
                    <span>Objective: {creativeAiState.result.brief.objective}</span>
                    <span>Audience: {creativeAiState.result.brief.audience}</span>
                    <span>Offer: {creativeAiState.result.brief.offer}</span>
                  </div>
                </div>
                <div className="creative-kit-columns">
                  <div>
                    <h4>Hooks</h4>
                    {creativeAiState.result.hooks.map((hook) => <span key={hook}>{hook}</span>)}
                  </div>
                  <div>
                    <h4>Headlines</h4>
                    {creativeAiState.result.headlines.map((headline) => <span key={headline}>{headline}</span>)}
                  </div>
                  <div>
                    <h4>Compliance</h4>
                    {creativeAiState.result.complianceNotes.map((note) => <span key={note}>{note}</span>)}
                  </div>
                </div>
                <div className="creative-kit-copy">
                  <h4>Primary Text</h4>
                  {creativeAiState.result.primaryTexts.map((text) => <p key={text}>{text}</p>)}
                </div>
                <div className="data-action-row">
                  <button className="primary-button" type="button" onClick={applyCreativeKitToLaunchForm}>
                    <Pencil size={16} />
                    Use in Auto Post
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="panel studio-launch-panel" ref={launchPanelRef}>
        <PanelHeader icon={Sparkles} title="Auto Post + Meta Ads" meta="dark post creative + ad" help="สร้าง Ad Creative แบบ object_story_spec และ Ad ใน Meta จากฟอร์มนี้ โดยค่าเริ่มต้นเป็น PAUSED เพื่อให้ทีมตรวจ preview ก่อนเปิดจริง" />
        <div className="creative-launch-grid">
          <div className="creative-launch-form">
            <label>
              <span>Source Creative</span>
              <select value={selectedSourceAd?.id ?? ''} onChange={(event) => selectSourceAd(event.target.value)}>
                {topAds.map((ad) => (
                  <option key={ad.id} value={ad.id}>
                    {ad.name} · {ad.score.toFixed(1)} score
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Meta Page ID</span>
              <input value={launchForm.pageId} placeholder="เช่น 1234567890" onChange={(event) => updateLaunchForm('pageId', event.target.value)} />
            </label>
            <label>
              <span>Ad Set</span>
              <select value={launchForm.adSetId} onChange={(event) => updateLaunchForm('adSetId', event.target.value)}>
                {adSets.map((adSet) => (
                  <option key={adSet.id} value={adSet.id}>
                    {adSet.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select value={launchForm.status} onChange={(event) => updateLaunchForm('status', event.target.value as MetaObjectStatus)}>
                <option value="PAUSED">PAUSED - สร้างไว้ตรวจก่อน</option>
                <option value="ACTIVE">ACTIVE - เปิดใช้งานทันที</option>
              </select>
            </label>
            <label>
              <span>Landing / Booking URL</span>
              <input value={launchForm.linkUrl} placeholder="https://..." onChange={(event) => updateLaunchForm('linkUrl', event.target.value)} />
            </label>
            <label>
              <span>CTA</span>
              <select value={launchForm.ctaType} onChange={(event) => updateLaunchForm('ctaType', event.target.value)}>
                <option value="LEARN_MORE">Learn More</option>
                <option value="SIGN_UP">Sign Up</option>
                <option value="CONTACT_US">Contact Us</option>
                <option value="BOOK_TRAVEL">Book Now</option>
                <option value="WHATSAPP_MESSAGE">WhatsApp Message</option>
              </select>
            </label>
            <label className="field-wide">
              <span>Primary Text</span>
              <textarea value={launchForm.primaryText} onChange={(event) => updateLaunchForm('primaryText', event.target.value)} />
            </label>
            <label>
              <span>Headline</span>
              <input value={launchForm.headline} onChange={(event) => updateLaunchForm('headline', event.target.value)} />
            </label>
            <label>
              <span>Description</span>
              <input value={launchForm.description} onChange={(event) => updateLaunchForm('description', event.target.value)} />
            </label>
            <label>
              <span>Ad Name</span>
              <input value={launchForm.adName} onChange={(event) => updateLaunchForm('adName', event.target.value)} />
            </label>
            <label>
              <span>Creative Name</span>
              <input value={launchForm.creativeName} onChange={(event) => updateLaunchForm('creativeName', event.target.value)} />
            </label>
          </div>
          <div className="creative-launch-preview">
            <span className="badge scale">Launch Notes</span>
            <h3>{launchForm.headline || 'Headline'}</h3>
            <p>{launchForm.primaryText || 'Primary text preview'}</p>
            <div className="launch-note-list">
              {launchNotes.map((note) => (
                <Signal key={note} icon={CheckCircle2} text={note} tone="good" />
              ))}
            </div>
            <div className="approval-warning">
              <ShieldCheck size={16} />
              <span>ระบบจะสร้าง Ad Creative และ Ad ผ่าน Meta API หลังคุณกดปุ่มนี้เท่านั้น แนะนำใช้ PAUSED ก่อนตรวจ preview</span>
            </div>
            {!launchReady && (
              <div className="data-notice watch">
                ต้องกรอก Page ID, Ad Set, URL, Primary Text และ Headline ก่อนยิง Meta API
              </div>
            )}
            {launchState.error && <div className="data-notice critical">{launchState.error}</div>}
            {launchState.result && (
              <div className="data-notice good">
                Created creative {launchState.result.creativeId} · ad {launchState.result.adId ?? 'pending'} · {launchState.result.status}
              </div>
            )}
            <button className="primary-button" type="button" onClick={handleCreativeLaunch} disabled={launchState.running || !launchReady}>
              <Sparkles size={16} />
              {launchState.running ? 'Creating in Meta...' : `Create ${launchForm.status} Meta Ad`}
            </button>
          </div>
        </div>
      </div>

      <div className="panel studio-main-panel" ref={performancePanelRef}>
        <PanelHeader icon={ImageIcon} title="Live Creative Performance" meta={`${topAds.length} ads from Meta`} />
        <div className="studio-card-list">
          {topAds.map((ad, index) => {
            const campaign = campaignById.get(ad.campaignId)
            return (
              <article key={ad.id} className="studio-creative-row">
                <div className={`creative-thumb ${['blue', 'violet', 'teal', 'navy', 'orange'][index % 5]}`} aria-hidden="true">
                  <ImageIcon size={16} />
                </div>
                <div>
                  <div className="auto-card-topline">
                    <span className={`badge ${deliveryStatusTone(ad.status)}`}>{deliveryStatusLabel(ad.status)}</span>
                    <span className={`badge ${ad.score >= 7.5 ? 'good' : ad.score >= 5 ? 'watch' : 'critical'}`}>Score {ad.score.toFixed(1)}</span>
                  </div>
                  <h3>{ad.name}</h3>
                  <p>{ad.creative}</p>
                  <small>{campaign?.name ?? 'Unknown campaign'}</small>
                </div>
                <div className="studio-metric-strip">
                  <span>{fmtMoney(ad.spend)} spend</span>
                  <span>{fmtNum(ad.impressions)} impressions</span>
                  <span>{fmtNum(ad.clicks)} clicks</span>
                  <span>{ad.ctr.toFixed(2)}% CTR</span>
                  <span>{ad.roas.toFixed(2)}x ROAS</span>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <div className="panel studio-side-panel">
        <PanelHeader icon={ClipboardList} title="API Work Orders" meta={`${tasks.length} generated`} />
        <div className="task-grid studio-task-grid">
          {tasks.length === 0 && (
            <div className="empty-state">
              <ShieldCheck size={18} />
              <strong>ยังไม่มี work order</strong>
              <p>เมื่อ Meta API ส่ง ad insights ระบบจะสร้าง creative action note จากข้อมูลจริง</p>
            </div>
          )}
          {tasks.map((task) => (
            <article key={task.id} className="task-card">
              <div className="task-topline">
                <span className={`badge ${taskClass(task.status)}`}>{task.status}</span>
                <span>{task.updatedAt}</span>
              </div>
              <h3>{task.taskType}</h3>
              <p>{task.result}</p>
              <div className="task-context">
                <strong>Meta input</strong>
                <span>{task.inputContext}</span>
                <strong>Output</strong>
                <span>{task.expectedOutput}</span>
              </div>
              <div className="task-meta">
                <span>{task.owner}</span>
                <span>{task.sourceCampaign}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function buildCreativeLaunchNotes(ad: WorkspaceData['adInsights'][number] | undefined, adSet: WorkspaceData['adSets'][number] | undefined) {
  if (!ad) return ['เลือก source creative เพื่อสร้าง launch note', 'สร้าง ad เป็น PAUSED ก่อนตรวจ preview', 'Sync Meta หลัง launch เพื่อดู ad ใหม่ในระบบ']

  const notes = [
    `Source: ${ad.name} · CTR ${ad.ctr.toFixed(2)}% · ROAS ${ad.roas.toFixed(2)}x · Score ${ad.score.toFixed(1)}`,
    adSet ? `Launch into Ad Set: ${adSet.name}` : 'เลือก Ad Set ก่อน launch',
    ad.score >= 7.5
      ? 'ใช้เป็น winner variation ได้ แต่ควรเปลี่ยน hook/visual เล็กน้อยเพื่อเลี่ยง creative fatigue'
      : ad.ctr < 1
        ? 'ควรปรับ hook 3 วินาทีแรกและ headline ก่อนเปิด spend จริง'
        : 'ควรเปิดเป็น limited test และรอ signal ก่อน scale',
    'Default PAUSED ช่วยให้ตรวจ preview, link, claim และ policy risk ก่อนเปิดใช้งานจริง',
  ]

  return notes
}

function AudienceStudioPage({
  items,
  campaigns,
  adSets,
  adInsights,
}: {
  items: MemoryItem[]
  campaigns: CampaignInsight[]
  adSets: WorkspaceData['adSets']
  adInsights: WorkspaceData['adInsights']
}) {
  const categories: MemoryCategory[] = ['Insight', 'Creative', 'Audience', 'Strategy', 'Preference']
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]))
  const adsByAdSet = adInsights.reduce((map, ad) => {
    map.set(ad.adSetId, (map.get(ad.adSetId) ?? 0) + 1)
    return map
  }, new Map<string, number>())
  const topAdSets = adSets.slice().sort((a, b) => b.spend - a.spend).slice(0, 10)
  const activeAdSets = adSets.filter((adSet) => adSet.deliveryStatus === 'active').length
  const totalSpend = adSets.reduce((sum, adSet) => sum + adSet.spend, 0)
  const totalBookings = adSets.reduce((sum, adSet) => sum + adSet.bookings, 0)
  const targetingCoverage = Math.round(safeRate(adSets.filter((adSet) => adSet.audienceTargeting).length, adSets.length))
  const ageRows = summarizeAudienceMetric(adSets, (adSet) => [audienceAgeLabel(adSet.audienceTargeting)])
  const geoRows = summarizeAudienceMetric(adSets, (adSet) => audienceGeoLabels(adSet.audienceTargeting))
  const platformRows = summarizeAudienceMetric(adSets, (adSet) => audiencePlatformLabels(adSet.audienceTargeting))
  const targetRows = summarizeAudienceMetric(adSets, (adSet) => audienceNameLabels(adSet.audienceTargeting))
  const topGeo = geoRows[0]?.label ?? 'รอข้อมูลพื้นที่'
  const topAge = ageRows[0]?.label ?? 'รอข้อมูลอายุ'
  const topTarget = targetRows[0]?.label ?? 'รอชื่อกลุ่มเป้าหมาย'

  return (
    <section className="audience-insights-grid">
      <div className="panel studio-hero audience-hero">
        <PanelHeader icon={Users} title="Audience Insights" meta="Meta ad set targeting API" />
        <div className="studio-hero-content">
          <div>
            <h2>กลุ่มเป้าหมายจาก Ads ที่ใช้งานจริง</h2>
            <p>สรุปอายุ ชื่อกลุ่มเป้าหมาย พื้นที่ platform และผลลัพธ์จาก Ad Set targeting ของ Meta API โดยไม่ใช้ mock data</p>
          </div>
          <div className="memory-count">
            <strong>{fmtNum(adSets.length)}</strong>
            <span>ad sets</span>
          </div>
        </div>
        <div className="studio-summary-grid">
          <MiniMetric label="Active Ad Sets" value={fmtNum(activeAdSets)} help="จำนวน ad sets ที่ Meta effective status เป็น ACTIVE" />
          <MiniMetric label="Targeting Data" value={`${targetingCoverage}%`} help="สัดส่วน ad sets ที่มี structured targeting object จาก Meta API" />
          <MiniMetric label="Spend" value={fmtMoney(totalSpend)} help="ยอด spend รวมของ ad sets ในช่วงเวลาปัจจุบัน" />
          <MiniMetric label="Bookings" value={fmtNum(totalBookings)} help="จำนวน conversion/booking ที่รวมจาก ad set insights" />
          <MiniMetric label="CPA" value={fmtMoney(safeDivide(totalSpend, totalBookings))} help="ต้นทุนเฉลี่ยต่อ booking จาก ad set spend / bookings" />
        </div>
      </div>

      <div className="panel audience-highlight-panel">
        <PanelHeader icon={Target} title="Target Snapshot" meta="age · name · location" />
        <div className="audience-highlight-grid">
          <AudienceSnapshot label="อายุหลัก" value={topAge} detail={`${fmtMoney(ageRows[0]?.spend ?? 0)} spend`} help="ช่วงอายุที่พบจาก ad set targeting และเรียงตาม spend" />
          <AudienceSnapshot label="พื้นที่หลัก" value={topGeo} detail={`${fmtNum(geoRows[0]?.count ?? 0)} ad sets`} help="ประเทศ เมือง เขต หรือ custom location ที่ Meta targeting ส่งมา" />
          <AudienceSnapshot label="ชื่อกลุ่มเป้าหมาย" value={topTarget} detail={`${fmtNum(targetRows[0]?.count ?? 0)} ad sets`} help="interest, behavior, demographic, custom audience หรือ lookalike name จาก targeting" />
        </div>
        <div className="audience-privacy-note">
          <ShieldCheck size={16} />
          <span>Meta Ads ไม่เปิดเผยรายชื่อบุคคลหรือที่อยู่ส่วนบุคคล หน้านี้แสดงข้อมูลระดับ targeting group, location และ segment จาก Ads เท่านั้น</span>
        </div>
      </div>

      <div className="panel audience-chart-panel">
        <PanelHeader icon={BarChart3} title="Age Performance" meta={`${ageRows.length} age groups`} />
        <AudienceBarList rows={ageRows.slice(0, 8)} metric="spend" emptyLabel="ยังไม่มีข้อมูลอายุจาก targeting" />
      </div>

      <div className="panel audience-chart-panel">
        <PanelHeader icon={MapPin} title="Location Performance" meta={`${geoRows.length} locations`} />
        <AudienceBarList rows={geoRows.slice(0, 8)} metric="spend" emptyLabel="ยังไม่มีข้อมูลพื้นที่จาก targeting" />
      </div>

      <div className="panel audience-chart-panel">
        <PanelHeader icon={Layers3} title="Platform Mix" meta={`${platformRows.length} platforms`} />
        <AudienceBarList rows={platformRows.slice(0, 8)} metric="count" emptyLabel="ยังไม่มีข้อมูล platform จาก targeting" />
      </div>

      <div className="panel audience-chart-panel">
        <PanelHeader icon={BrainCircuit} title="Target / Audience Names" meta={`${targetRows.length} names`} />
        <AudienceBarList rows={targetRows.slice(0, 10)} metric="spend" emptyLabel="ยังไม่มี interest/custom audience name จาก Meta targeting" />
      </div>

      <div className="panel audience-table-panel">
        <PanelHeader icon={Target} title="Ad Set Audience Detail" meta={`${topAdSets.length} top ad sets by spend`} />
        <div className="audience-table-list">
          {topAdSets.map((adSet) => {
            const campaign = campaignById.get(adSet.campaignId)
            const meta = statusMeta(adSet.status)
            const targeting = adSet.audienceTargeting
            const geos = audienceGeoLabels(targeting)
            const names = audienceNameLabels(targeting)
            const platforms = audiencePlatformLabels(targeting)
            return (
              <article key={adSet.id} className="audience-detail-card">
                <div className="audience-detail-main">
                  <div className="compliance-topline">
                    <span className={`badge ${deliveryStatusTone(adSet.deliveryStatus)}`}>{deliveryStatusLabel(adSet.deliveryStatus)}</span>
                    <span className={`badge ${meta.className}`}>{meta.label}</span>
                    <span className="badge scale">{fmtNum(adsByAdSet.get(adSet.id) ?? 0)} ads</span>
                  </div>
                  <h3>{adSet.name}</h3>
                  <p>{campaign?.name ?? 'Unknown campaign'}</p>
                  <div className="audience-chip-grid">
                    <AudienceChip label="อายุ" value={audienceAgeLabel(targeting)} />
                    <AudienceChip label="เพศ" value={targeting?.genders.length ? targeting.genders.join(', ') : 'All gender / ไม่ระบุ'} />
                    <AudienceChip label="พื้นที่" value={geos.slice(0, 3).join(', ') || 'ไม่ระบุพื้นที่'} />
                    <AudienceChip label="ชื่อกลุ่มเป้าหมาย" value={names.slice(0, 3).join(', ') || 'ไม่ระบุ interest/custom audience'} />
                    <AudienceChip label="Platform" value={platforms.slice(0, 4).join(', ') || 'ไม่ระบุ platform'} />
                    <AudienceChip label="Placement" value={targeting?.placements.slice(0, 4).join(', ') || 'ไม่ระบุ placement'} />
                  </div>
                </div>
                <div className="audience-detail-metrics">
                  <MiniMetric label="Spend" value={fmtMoney(adSet.spend)} help="Spend ของ ad set ในช่วงเวลาปัจจุบัน" />
                  <MiniMetric label="Budget" value={fmtMoney(adSet.budget)} help="Daily/lifetime budget ที่ Meta API ส่งมา" />
                  <MiniMetric label="Bookings" value={fmtNum(adSet.bookings)} help="Conversion/booking จาก ad set insights" />
                  <MiniMetric label="ROAS" value={`${adSet.roas.toFixed(2)}x`} help="Revenue / Spend ของ ad set" />
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <div className="panel studio-side-panel">
        <PanelHeader icon={BrainCircuit} title="Audience Memory" meta="generated from sync" />
        <div className="category-grid studio-category-grid">
          {categories.map((category) => (
            <div key={category}>
              <span className="badge scale">{category}</span>
              <strong>{items.filter((item) => item.category === category).length}</strong>
            </div>
          ))}
        </div>
        <div className="memory-list studio-memory-list">
          {items.map((item) => (
            <article key={item.id} className="memory-card">
              <div className="memory-card-topline">
                <span className={`badge ${item.confidence >= 85 ? 'good' : item.confidence >= 75 ? 'watch' : 'scale'}`}>
                  {item.category}
                </span>
                <span>{item.updatedAt}</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <div className="task-meta">
                <span>{item.source}</span>
                <span>{item.confidence}% confidence</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

type AudienceMetricRow = {
  label: string
  count: number
  spend: number
  bookings: number
  budget: number
  active: number
}

function summarizeAudienceMetric(adSets: WorkspaceData['adSets'], getLabels: (adSet: WorkspaceData['adSets'][number]) => string[]): AudienceMetricRow[] {
  const rows = new Map<string, AudienceMetricRow>()

  adSets.forEach((adSet) => {
    const labels = Array.from(new Set(getLabels(adSet).map((label) => label.trim()).filter(Boolean)))
    const safeLabels = labels.length > 0 ? labels : ['ไม่ระบุ']

    safeLabels.forEach((label) => {
      const row = rows.get(label) ?? { label, count: 0, spend: 0, bookings: 0, budget: 0, active: 0 }
      row.count += 1
      row.spend += adSet.spend
      row.bookings += adSet.bookings
      row.budget += adSet.budget
      row.active += adSet.deliveryStatus === 'active' ? 1 : 0
      rows.set(label, row)
    })
  })

  return Array.from(rows.values()).sort((a, b) => b.spend - a.spend || b.count - a.count || a.label.localeCompare(b.label))
}

function audienceAgeLabel(targeting: AudienceTargeting | undefined) {
  if (!targeting?.ageMin && !targeting?.ageMax) return 'All age / ไม่ระบุ'
  return `${targeting.ageMin ?? '?'}-${targeting.ageMax ?? '?'}`
}

function audienceGeoLabels(targeting: AudienceTargeting | undefined) {
  return targeting?.geoLocations.map((geo) => [geo.name, geo.region, geo.country].filter(Boolean).join(', ')) ?? []
}

function audiencePlatformLabels(targeting: AudienceTargeting | undefined) {
  return targeting?.publisherPlatforms.length ? targeting.publisherPlatforms : targeting?.devicePlatforms ?? []
}

function audienceNameLabels(targeting: AudienceTargeting | undefined) {
  return targeting?.interests.map((target) => target.name) ?? []
}

function AudienceSnapshot({ label, value, detail, help }: { label: string; value: string; detail: string; help: string }) {
  return (
    <article className="audience-snapshot">
      <span>
        {label}
        <InfoHint text={help} />
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function AudienceChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="audience-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AudienceBarList({
  rows,
  metric,
  emptyLabel,
}: {
  rows: AudienceMetricRow[]
  metric: 'spend' | 'count'
  emptyLabel: string
}) {
  const max = Math.max(...rows.map((row) => (metric === 'spend' ? row.spend : row.count)), 0)

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <Database size={18} />
        <strong>{emptyLabel}</strong>
        <p>ถ้า Meta API ส่ง targeting field มา หน้านี้จะแสดงกราฟอัตโนมัติหลัง Sync</p>
      </div>
    )
  }

  return (
    <div className="audience-bar-list">
      {rows.map((row) => {
        const value = metric === 'spend' ? row.spend : row.count
        const width = max > 0 ? Math.max(8, (value / max) * 100) : 8
        return (
          <article
            key={row.label}
            className="audience-bar-row"
            title={`${row.label} · ${fmtMoney(row.spend)} spend · ${fmtNum(row.count)} ad sets · ${fmtNum(row.bookings)} bookings`}
          >
            <div className="audience-bar-head">
              <strong>{row.label}</strong>
              <span>{metric === 'spend' ? fmtMoney(row.spend) : `${fmtNum(row.count)} ad sets`}</span>
            </div>
            <div className="audience-bar-track">
              <span style={{ width: `${width}%` }} />
            </div>
            <div className="audience-bar-meta">
              <small>{fmtNum(row.count)} ad sets</small>
              <small>{fmtNum(row.active)} active</small>
              <small>{fmtNum(row.bookings)} bookings</small>
              <small>{fmtMoney(safeDivide(row.spend, row.bookings))} CPA</small>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function MediaLibraryPage({ reviews }: { reviews: ComplianceReview[] }) {
  const statusTone = (status: ComplianceReview['status']) =>
    status === 'approved' ? 'good' : status === 'needsReview' ? 'watch' : 'critical'
  const approvedCount = reviews.filter((review) => review.status === 'approved').length
  const reviewCount = reviews.filter((review) => review.status === 'needsReview').length
  const blockedCount = reviews.filter((review) => review.status === 'blocked').length
  const totalSpend = reviews.reduce((sum, review) => sum + (review.spend ?? 0), 0)

  return (
    <section className="studio-grid">
      <div className="panel studio-hero">
        <PanelHeader icon={ImageIcon} title="Media Library" meta="Meta ads + creative API" />
        <div className="studio-hero-content">
          <div>
            <h2>Creative และ compliance จาก Meta API</h2>
            <p>แสดง ad/creative metadata, thumbnail, spend และ policy risk ที่คำนวณจากข้อมูลจริงในบัญชี</p>
          </div>
          <div className="studio-summary-grid compact">
            <MiniMetric label="Approved" value={fmtNum(approvedCount)} help="จำนวน creative ที่ยังไม่พบ claim risk จาก metadata" />
            <MiniMetric label="Review" value={fmtNum(reviewCount)} help="จำนวน creative ที่ควรตรวจ claim หรือ before/after signal" />
            <MiniMetric label="Blocked" value={fmtNum(blockedCount)} help="จำนวน creative ที่พบคำสัญญาผลลัพธ์หรือ claim เสี่ยงสูง" />
            <MiniMetric label="Spend" value={fmtMoney(totalSpend)} help="ยอด spend รวมของรายการ media library ที่โหลดจาก Meta API" />
          </div>
        </div>
      </div>

      <div className="panel studio-main-panel full">
        <PanelHeader icon={ShieldCheck} title="Creative Review Queue" meta={`${reviews.length} live assets`} />
        <div className="compliance-grid media-library-grid">
        {reviews.map((review) => (
          <article key={review.id} className="compliance-card">
            {review.thumbnailUrl ? (
              <img className="media-thumb" src={review.thumbnailUrl} alt="" loading="lazy" />
            ) : (
              <div className="media-thumb fallback" aria-hidden="true">
                <ImageIcon size={18} />
              </div>
            )}
            <div className="compliance-topline">
              <span className={`badge ${statusTone(review.status)}`}>
                {review.status === 'approved' ? 'Approved' : review.status === 'needsReview' ? 'Review' : 'Blocked'}
              </span>
              <span>{review.deliveryStatus ? deliveryStatusLabel(review.deliveryStatus) : review.service}</span>
            </div>
            <h3>{review.title}</h3>
            <small>{review.source ?? review.service}</small>
            <p>{review.issue}</p>
            <div className="auto-guardrail">
              <ShieldCheck size={15} />
              <span>{review.fix}</span>
            </div>
            <div className="studio-metric-strip">
              <span>{fmtMoney(review.spend ?? 0)} spend</span>
              <span>{fmtNum(review.impressions ?? 0)} impressions</span>
              <span>{(review.ctr ?? 0).toFixed(2)}% CTR</span>
              <span>{(review.roas ?? 0).toFixed(2)}x ROAS</span>
            </div>
            <div className="task-meta">
              <span>{review.creativeId ? `creative ${review.creativeId}` : 'creative id pending'}</span>
              <span>{review.adId ? `ad ${review.adId}` : 'ad id pending'}</span>
            </div>
          </article>
        ))}
      </div>
      </div>
    </section>
  )
}

function ClinicOpsPanel({ services, funnelMetrics }: { services: ServiceLine[]; funnelMetrics: WorkspaceData['funnelMetrics'] }) {
  const totalBookings = services.reduce((sum, service) => sum + service.bookings, 0)
  const avgShowRate = safeDivide(services.reduce((sum, service) => sum + service.showRate, 0), services.length)
  const leadTotal = funnelMetrics.find((stage) => stage.stage.toLowerCase().includes('lead'))?.count ?? 0
  const paidStage = funnelMetrics.find((stage) => stage.stage.toLowerCase().includes('paid'))

  return (
    <div className="panel clinic-panel">
      <PanelHeader icon={HeartPulse} title="Clinic Service Lines" meta={`${services.length} services · ${totalBookings} bookings`} />
      <div className="clinic-service-grid">
        {services.map((service) => {
          const meta = statusMeta(service.aiStatus)
          return (
            <article key={service.id} className="service-card">
              <div className="service-topline">
                <span className={`badge ${meta.className}`}>{service.name}</span>
                <strong>{fmtMoney(service.revenue)}</strong>
              </div>
              <p>{service.category}</p>
              <div className="service-metrics">
                <span>{service.bookings} bookings</span>
                <span>{service.showRate > 0 ? `${service.showRate}% show-up` : 'show-up pending'}</span>
                <span>{service.closeRate > 0 ? `${service.closeRate}% close` : 'close pending'}</span>
                <span>{fmtMoney(service.cpa)} / booking</span>
              </div>
            </article>
          )
        })}
      </div>
      <div className="clinic-funnel">
        <div>
          <span>Lead</span>
          <strong>{fmtNum(leadTotal)}</strong>
        </div>
        <div>
          <span>Booked</span>
          <strong>{totalBookings}</strong>
        </div>
        <div>
          <span>Show-up</span>
          <strong>{avgShowRate.toFixed(0)}%</strong>
        </div>
        <div>
          <span>Treatment</span>
          <strong>{paidStage ? fmtPct(paidStage.conversionRate) : '-'}</strong>
        </div>
      </div>
    </div>
  )
}

function ApprovalModal({
  request,
  target,
  running,
  error,
  onCancel,
  onConfirm,
}: {
  request: ApprovalRequest
  target: RecommendedAction | AutoAdControl
  running: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const isAuto = request.kind === 'auto'
  const autoTarget = isAuto ? (target as AutoAdControl) : null
  const recommendationTarget = !isAuto ? (target as RecommendedAction) : null
  const title = autoTarget ? autoDecisionLabel(autoTarget.recommendation) : recommendationTarget?.type ?? 'Approve action'
  const targetName = autoTarget?.adName ?? recommendationTarget?.target ?? ''
  const reason = autoTarget?.reason ?? recommendationTarget?.summary ?? ''
  const impact = autoTarget ? autoTarget.after : recommendationTarget?.expectedImpact ?? ''
  const execution = recommendationTarget?.execution
  const isRealExecution = Boolean(execution)

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="approval-modal-header">
          <div>
            <span className="badge scale">Approval Layer</span>
            <h2 id="approval-title">{title}</h2>
            <p>{targetName}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close approval modal" onClick={onCancel} disabled={running}>
            <X size={17} />
          </button>
        </div>

        <div className="approval-summary">
          <div className="confidence-ring">
            <span>{target.confidence}%</span>
            <small>AI Confidence</small>
          </div>
          <div>
            <h3>Reason</h3>
            <p>{reason}</p>
            <h3>Expected result</h3>
            <p>{impact}</p>
          </div>
        </div>

        <div className="approval-checklist">
          <div>
            <span className={`badge ${riskClass(target.risk)}`}>{target.risk} risk</span>
            <strong>Guardrail</strong>
            <p>{target.guardrail}</p>
          </div>
          <div>
            <span className="badge good">Rollback ready</span>
            <strong>Rollback note</strong>
            <p>{target.rollbackNote}</p>
          </div>
        </div>

        <div className="snapshot-grid approval-snapshot">
          <span>Before: {target.before}</span>
          <span>After: {target.after}</span>
        </div>

        <div className="approval-warning">
          {isRealExecution ? <Power size={16} /> : <ShieldCheck size={16} />}
          <span>
            {isRealExecution
              ? `เมื่อ Confirm ระบบจะเรียก ${execution?.endpoint} จริงเพื่อ ${execution?.label}; ผลลัพธ์จะถูกบันทึกใน Audit Log`
              : 'การอนุมัตินี้บันทึก Action Queue และ Audit ใน workspace เท่านั้น ยังไม่มีการเปลี่ยน Meta จริงสำหรับ action ประเภทนี้'}
          </span>
        </div>

        {error && <div className="data-notice critical approval-error">{error}</div>}

        <div className="approval-actions">
          <button className="reject-button" type="button" onClick={onCancel} disabled={running}>
            <X size={16} />
            Cancel
          </button>
          <button className="approve-button" type="button" onClick={onConfirm} disabled={running}>
            {isRealExecution ? <Power size={16} /> : <Check size={16} />}
            {running ? 'Executing...' : isRealExecution ? 'Confirm & Execute' : 'Confirm approval'}
          </button>
        </div>
      </section>
    </div>
  )
}

function DeliveryStatusModal({
  request,
  running,
  error,
  onCancel,
  onConfirm,
}: {
  request: DeliveryStatusChangeRequest
  running: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const nextStatus = toMetaObjectStatus(request.nextStatus)
  const objectLabel = request.objectType === 'adset' ? 'Ad Set' : request.objectType === 'ad' ? 'Ad' : 'Campaign'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="approval-modal" role="dialog" aria-modal="true" aria-labelledby="status-change-title">
        <div className="approval-modal-header">
          <div>
            <span className="badge scale">Meta Execution</span>
            <h2 id="status-change-title">
              {nextStatus === 'ACTIVE' ? 'Activate' : 'Pause'} {objectLabel}
            </h2>
            <p>{request.targetName}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close status modal" onClick={onCancel} disabled={running}>
            <X size={17} />
          </button>
        </div>

        <div className="approval-checklist">
          <div>
            <span className={`badge ${deliveryStatusTone(request.currentStatus)}`}>{deliveryStatusLabel(request.currentStatus)}</span>
            <strong>Current</strong>
            <p>สถานะก่อนยิงคำสั่ง Meta API</p>
          </div>
          <div>
            <span className={`badge ${deliveryStatusTone(request.nextStatus)}`}>{nextStatus}</span>
            <strong>Next</strong>
            <p>{request.summary}</p>
          </div>
        </div>

        <div className="approval-warning">
          <ShieldCheck size={16} />
          <span>คำสั่งนี้จะยิง Meta Marketing API จริง ต้องใช้ token ที่มีสิทธิ์ ads_management และระบบจะ sync ข้อมูลหลังสำเร็จ</span>
        </div>

        {error && <div className="data-notice critical">{error}</div>}

        <div className="approval-actions">
          <button className="reject-button" type="button" onClick={onCancel} disabled={running}>
            <X size={16} />
            Cancel
          </button>
          <button className="approve-button" type="button" onClick={onConfirm} disabled={running}>
            <Check size={16} />
            {running ? 'Running...' : `Confirm ${nextStatus}`}
          </button>
        </div>
      </section>
    </div>
  )
}

function MetaObjectMutationModal({
  request,
  campaigns,
  adSets,
  running,
  error,
  onCancel,
  onConfirm,
}: {
  request: MetaObjectMutationRequest
  campaigns: CampaignInsight[]
  adSets: WorkspaceData['adSets']
  running: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (form: MetaObjectFormValues) => Promise<void>
}) {
  const [form, setForm] = useState<MetaObjectFormValues>(request.initialValues)
  const title = `${mutationOperationLabel(request.operation)} ${metaObjectLabel(request.objectType)}`
  const isDelete = request.operation === 'delete'
  const updateForm = <K extends keyof MetaObjectFormValues>(key: K, value: MetaObjectFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  const setBudget = (value: string) => updateForm('dailyBudget', value)
  const setAgePreset = (min: string, max: string) => {
    setForm((current) => ({ ...current, ageMin: min, ageMax: max }))
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="approval-modal meta-object-modal" role="dialog" aria-modal="true" aria-labelledby="meta-object-title">
        <div className="approval-modal-header">
          <div>
            <span className={`badge ${isDelete ? 'critical' : 'scale'}`}>Meta Object Manager</span>
            <h2 id="meta-object-title">{title}</h2>
            <p>{request.targetName}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close object modal" onClick={onCancel} disabled={running}>
            <X size={17} />
          </button>
        </div>

        {isDelete ? (
          <div className="approval-warning critical-warning">
            <Trash2 size={16} />
            <span>คำสั่งนี้จะลบ {metaObjectLabel(request.objectType)} จริงจาก Meta API และอาจกระทบ delivery/history ของบัญชี</span>
          </div>
        ) : (
          <div className="mutation-form-grid">
            <label className="field-wide">
              <span>Name</span>
              <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
              <small>ชื่อที่จะแสดงใน Meta Ads Manager ควรใส่ service, audience และวันที่ให้หาเจอง่าย</small>
            </label>
            <label className="field-wide">
              <span>Status</span>
              <div className="choice-grid two">
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    className={form.status === option.value ? 'active' : ''}
                    type="button"
                    onClick={() => updateForm('status', option.value)}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            </label>

            {request.objectType === 'campaign' && (
              <>
                <label className="field-wide">
                  <span>Objective</span>
                  <div className="choice-grid">
                    {campaignObjectiveOptions.map((option) => (
                      <button
                        key={option.value}
                        className={form.objective === option.value ? 'active' : ''}
                        type="button"
                        onClick={() => updateForm('objective', option.value)}
                      >
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  <span>Daily Budget (THB)</span>
                  <input value={form.dailyBudget} inputMode="numeric" onChange={(event) => updateForm('dailyBudget', event.target.value)} />
                  <div className="quick-chip-row">
                    {budgetQuickOptions.map((value) => (
                      <button key={value} className={form.dailyBudget === value ? 'active' : ''} type="button" onClick={() => setBudget(value)}>
                        ฿{value}
                      </button>
                    ))}
                  </div>
                  <small>ระบบส่งให้ Meta เป็นหน่วย cents โดยอัตโนมัติ เช่น 500 = ฿500/day</small>
                </label>
                <label className="field-wide">
                  <span>Bid Strategy</span>
                  <div className="choice-grid">
                    {bidStrategyOptions.map((option) => (
                      <button
                        key={option.value}
                        className={form.bidStrategy === option.value ? 'active' : ''}
                        type="button"
                        onClick={() => updateForm('bidStrategy', option.value)}
                      >
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </button>
                    ))}
                  </div>
                </label>
              </>
            )}

            {request.objectType === 'adset' && (
              <>
                <label>
                  <span>Campaign</span>
                  <select value={form.campaignId} onChange={(event) => updateForm('campaignId', event.target.value)}>
                    <option value="">Select campaign</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                  <small>Ad Set ต้องอยู่ใต้ Campaign ที่เลือก</small>
                </label>
                <label>
                  <span>Daily Budget (THB)</span>
                  <input value={form.dailyBudget} inputMode="numeric" onChange={(event) => updateForm('dailyBudget', event.target.value)} />
                  <div className="quick-chip-row">
                    {budgetQuickOptions.map((value) => (
                      <button key={value} className={form.dailyBudget === value ? 'active' : ''} type="button" onClick={() => setBudget(value)}>
                        ฿{value}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="field-wide">
                  <span>Billing Event</span>
                  <div className="choice-grid two">
                    {billingEventOptions.map((option) => (
                      <button
                        key={option.value}
                        className={form.billingEvent === option.value ? 'active' : ''}
                        type="button"
                        onClick={() => updateForm('billingEvent', option.value)}
                      >
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </button>
                    ))}
                  </div>
                </label>
                <label className="field-wide">
                  <span>Optimization Goal</span>
                  <div className="choice-grid">
                    {optimizationGoalOptions.map((option) => (
                      <button
                        key={option.value}
                        className={form.optimizationGoal === option.value ? 'active' : ''}
                        type="button"
                        onClick={() => updateForm('optimizationGoal', option.value)}
                      >
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  <span>Countries</span>
                  <input value={form.countries} onChange={(event) => updateForm('countries', event.target.value)} />
                  <small>ใส่รหัสประเทศ เช่น TH หรือ TH,SG</small>
                </label>
                <label>
                  <span>Age</span>
                  <div className="split-inputs">
                    <input value={form.ageMin} inputMode="numeric" onChange={(event) => updateForm('ageMin', event.target.value)} />
                    <input value={form.ageMax} inputMode="numeric" onChange={(event) => updateForm('ageMax', event.target.value)} />
                  </div>
                  <div className="quick-chip-row">
                    {agePresetOptions.map((option) => (
                      <button
                        key={option.label}
                        className={form.ageMin === option.min && form.ageMax === option.max ? 'active' : ''}
                        type="button"
                        onClick={() => setAgePreset(option.min, option.max)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="field-wide">
                  <span>Targeting JSON</span>
                  <textarea value={form.targetingJson} placeholder='เว้นว่างเพื่อใช้ countries/age หรือใส่ {"geo_locations":{"countries":["TH"]}}' onChange={(event) => updateForm('targetingJson', event.target.value)} />
                  <small>Advanced: ใช้เมื่ออยากกำหนด placement, interest, custom audience หรือ targeting เฉพาะทาง</small>
                </label>
                <label className="field-wide">
                  <span>Promoted Object JSON</span>
                  <textarea value={form.promotedObjectJson} placeholder='เช่น {"page_id":"..."} สำหรับ objective ที่ต้องใช้ promoted_object' onChange={(event) => updateForm('promotedObjectJson', event.target.value)} />
                  <small>Advanced: บาง objective ต้องมี page_id, pixel_id หรือ custom_event_type</small>
                </label>
              </>
            )}

            {request.objectType === 'ad' && (
              <>
                <label className="field-wide">
                  <span>Ad Set</span>
                  <select value={form.adSetId} onChange={(event) => updateForm('adSetId', event.target.value)}>
                    <option value="">Select ad set</option>
                    {adSets.map((adSet) => (
                      <option key={adSet.id} value={adSet.id}>
                        {adSet.name}
                      </option>
                    ))}
                  </select>
                  <small>Ad จะถูกสร้างหรือแก้ภายใต้ Ad Set นี้</small>
                </label>
                <label className="field-wide">
                  <span>Creative ID</span>
                  <input value={form.creativeId} placeholder="Meta creative_id" onChange={(event) => updateForm('creativeId', event.target.value)} />
                  <small>ใส่ ID ของ creative ที่สร้างใน Meta แล้ว ถ้าไม่มีให้ใช้ Creative JSON ด้านล่าง</small>
                </label>
                <label className="field-wide">
                  <span>Creative JSON</span>
                  <textarea value={form.creativeJson} placeholder='หรือใส่ {"creative_id":"..."}' onChange={(event) => updateForm('creativeJson', event.target.value)} />
                  <small>Advanced: ใช้ส่ง object creative ตามรูปแบบ Meta API</small>
                </label>
              </>
            )}

            <label className="field-wide">
              <span>Extra Params JSON</span>
              <textarea value={form.extraJson} placeholder='Optional JSON object สำหรับ fields เพิ่มเติมของ Meta API' onChange={(event) => updateForm('extraJson', event.target.value)} />
              <small>Advanced: ใส่ field เพิ่มเติมที่ยังไม่มีในฟอร์ม เช่น bid_amount, attribution_spec, destination_type</small>
            </label>
          </div>
        )}

        <div className="approval-warning">
          <ShieldCheck size={16} />
          <span>ระบบจะส่งคำสั่งจริงไป Meta API หลัง confirm และ sync workspace กลับมาใหม่เมื่อสำเร็จ</span>
        </div>

        {error && <div className="data-notice critical">{error}</div>}

        <div className="approval-actions">
          <button className="reject-button" type="button" onClick={onCancel} disabled={running}>
            <X size={16} />
            Cancel
          </button>
          <button className={isDelete ? 'reject-button' : 'approve-button'} type="button" onClick={() => onConfirm(form)} disabled={running}>
            {isDelete ? <Trash2 size={16} /> : <Check size={16} />}
            {running ? 'Running...' : `Confirm ${mutationOperationLabel(request.operation)}`}
          </button>
        </div>
      </section>
    </div>
  )
}

function MetricCard({
  title,
  value,
  trend,
  icon: Icon,
  help,
  onClick,
  tone = 'neutral',
}: {
  title: string
  value: string
  trend: string
  icon: typeof Activity
  help?: string
  onClick?: () => void
  tone?: 'neutral' | 'good' | 'watch' | 'critical' | 'scale'
}) {
  return (
    <article
      className={`metric-card ${onClick ? 'clickable-card' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <div className={`metric-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <span className="metric-label">
        {title}
        {help && <InfoHint text={help} />}
      </span>
      <strong>{value}</strong>
      <small>{trend}</small>
    </article>
  )
}

function PanelHeader({ icon: Icon, title, meta, help }: { icon: typeof BarChart3; title: string; meta: string; help?: string }) {
  return (
    <div className="panel-header">
      <div>
        <Icon size={18} />
        <h2>{title}</h2>
        {help && <InfoHint text={help} />}
      </div>
      <span>{meta}</span>
    </div>
  )
}

function Signal({ icon: Icon, text, tone, help }: { icon: typeof CheckCircle2; text: string; tone: 'good' | 'watch' | 'critical'; help?: string }) {
  return (
    <div className={`signal ${tone}`}>
      <Icon size={16} />
      <span>{text}</span>
      {help && <InfoHint text={help} />}
    </div>
  )
}

function MetricTh({ label, help }: { label: string; help: string }) {
  return (
    <th>
      <span className="table-head-label">
        {label}
        <InfoHint text={help} />
      </span>
    </th>
  )
}

function MeasurementItem({ title, value, help }: { title: string; value: string; help: string }) {
  return (
    <article className="measurement-item">
      <span>
        {title}
        <InfoHint text={help} />
      </span>
      <strong>{value}</strong>
    </article>
  )
}

function InfoHint({ text }: { text: string }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{
    x: number
    y: number
    placement: 'top' | 'bottom'
  } | null>(null)

  const showTooltip = () => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const tooltipWidth = 280
    const edgePadding = 18
    const x = Math.min(
      Math.max(rect.left + rect.width / 2, tooltipWidth / 2 + edgePadding),
      window.innerWidth - tooltipWidth / 2 - edgePadding,
    )
    const placement = rect.top > 112 ? 'top' : 'bottom'
    const y = placement === 'top' ? rect.top - 10 : rect.bottom + 10

    setTooltipPosition({ x, y, placement })
  }

  const hideTooltip = () => setTooltipPosition(null)

  return (
    <>
      <span
        ref={anchorRef}
        className="info-hint"
        tabIndex={0}
        aria-label={text}
        onBlur={hideTooltip}
        onFocus={showTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        <Info size={12} />
      </span>
      {tooltipPosition &&
        createPortal(
          <span
            className={`tooltip-bubble ${tooltipPosition.placement}`}
            role="tooltip"
            style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  )
}

function insightScore(roas: number, ctr: number, results: number, spend: number) {
  const roasScore = Math.min(roas * 1.6, 5)
  const ctrScore = Math.min(ctr * 0.7, 2)
  const resultScore = Math.min(results / 20, 2)
  const noResultPenalty = spend > 0 && results === 0 ? 1 : 0
  return Math.round(Math.max(0, Math.min(10, 2 + roasScore + ctrScore + resultScore - noResultPenalty)) * 10) / 10
}

function insightTone(roas: number, spend: number): InsightTableRow['tone'] {
  if (roas >= 2.5) return 'good'
  if (spend > 0 && roas < 1.2) return 'critical'
  return 'watch'
}

function makeInsightRow(input: {
  id: string
  kind: AiInsightDrawerContext['kind']
  campaignId: string
  title: string
  subtitle: string
  count: number
  spend: number
  clicks: number
  ctr: number
  results: number
  purchaseValue: number
  score?: number
  thumbTone?: string
}): InsightTableRow {
  const roas = safeDivide(input.purchaseValue, input.spend)
  const score = input.score ?? insightScore(roas, input.ctr, input.results, input.spend)
  return {
    ...input,
    score,
    costPerResult: safeDivide(input.spend, input.results),
    roas,
    tone: insightTone(roas, input.spend),
    thumbTone: input.thumbTone ?? 'blue',
  }
}

function aggregateInsightGroup(
  id: string,
  title: string,
  subtitle: string,
  rows: InsightTableRow[],
  thumbTone: string,
  kind: AiInsightDrawerContext['kind'] = 'creative',
) {
  const spend = rows.reduce((sum, row) => sum + row.spend, 0)
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0)
  const results = rows.reduce((sum, row) => sum + row.results, 0)
  const purchaseValue = rows.reduce((sum, row) => sum + row.purchaseValue, 0)
  const weightedCtr = safeDivide(rows.reduce((sum, row) => sum + row.ctr * row.clicks, 0), clicks)
  return makeInsightRow({
    id,
    kind,
    campaignId: rows[0]?.campaignId ?? '',
    title,
    subtitle,
    count: rows.reduce((sum, row) => sum + row.count, 0),
    spend,
    clicks,
    ctr: weightedCtr,
    results,
    purchaseValue,
    thumbTone,
  })
}

function buildInsightRows(args: {
  groupBy: InsightGroupBy
  campaigns: CampaignInsight[]
  adSets: AdSetInsight[]
  adInsights: WorkspaceData['adInsights']
  insightComponents: WorkspaceData['insightComponents']
}): InsightTableRow[] {
  const thumbTones = ['blue', 'violet', 'teal', 'green', 'amber', 'navy', 'orange']
  const adRows = args.adInsights.map((ad, index) =>
    makeInsightRow({
      id: `ad-${ad.id}`,
      kind: 'ad',
      campaignId: ad.campaignId,
      title: ad.name,
      subtitle: `${ad.creative} · ${deliveryStatusLabel(ad.status)}`,
      count: 1,
      spend: ad.spend,
      clicks: ad.clicks,
      ctr: ad.ctr,
      results: ad.bookings,
      purchaseValue: ad.spend * ad.roas,
      score: ad.score,
      thumbTone: thumbTones[index % thumbTones.length],
    }),
  )

  if (args.groupBy === 'ad') return adRows.sort((a, b) => b.spend - a.spend)

  if (args.groupBy === 'creative') {
    return args.insightComponents
      .map((component) =>
        makeInsightRow({
          id: component.id,
          kind: 'creative',
          campaignId: component.campaignId,
          title: component.title,
          subtitle: `${component.ads} ads · ${component.service}`,
          count: component.ads,
          spend: component.spend,
          clicks: component.clicks,
          ctr: component.ctr,
          results: component.results,
          purchaseValue: component.purchaseValue,
          score: component.score,
          thumbTone: component.thumbTone,
        }),
      )
      .sort((a, b) => b.spend - a.spend)
  }

  if (args.groupBy === 'campaign') {
    return args.campaigns
      .map((campaign, index) => {
        const ads = adRows.filter((ad) => ad.campaignId === campaign.id)
        const clicks = ads.reduce((sum, ad) => sum + ad.clicks, 0)
        const ctr = clicks > 0 ? safeDivide(ads.reduce((sum, ad) => sum + ad.ctr * ad.clicks, 0), clicks) : campaign.ctr
        return makeInsightRow({
          id: `campaign-${campaign.id}`,
          kind: 'campaign',
          campaignId: campaign.id,
          title: campaign.name,
          subtitle: `${campaign.objective} · ${deliveryStatusLabel(normalizeDeliveryStatus(campaign.deliveryStatus, campaign.spend))}`,
          count: Math.max(ads.length, 1),
          spend: campaign.spend,
          clicks,
          ctr,
          results: campaign.conversions,
          purchaseValue: campaign.revenue,
          thumbTone: thumbTones[index % thumbTones.length],
        })
      })
      .sort((a, b) => b.spend - a.spend)
  }

  if (args.groupBy === 'adset') {
    return args.adSets
      .map((adSet, index) => {
        const ads = adRows.filter((ad) => args.adInsights.find((source) => source.id === ad.id.replace(/^ad-/, ''))?.adSetId === adSet.id)
        const clicks = ads.reduce((sum, ad) => sum + ad.clicks, 0)
        const purchaseValue = adSet.spend * adSet.roas
        return makeInsightRow({
          id: `adset-${adSet.id}`,
          kind: 'creative',
          campaignId: adSet.campaignId,
          title: adSet.name,
          subtitle: `${adSet.audience} · ${deliveryStatusLabel(normalizeDeliveryStatus(adSet.deliveryStatus, adSet.spend))}`,
          count: Math.max(ads.length, 1),
          spend: adSet.spend,
          clicks,
          ctr: safeDivide(ads.reduce((sum, ad) => sum + ad.ctr * ad.clicks, 0), clicks),
          results: adSet.bookings,
          purchaseValue,
          thumbTone: thumbTones[index % thumbTones.length],
        })
      })
      .sort((a, b) => b.spend - a.spend)
  }

  const groupMap = new Map<string, InsightTableRow[]>()
  const addGroup = (key: string, row: InsightTableRow) => {
    groupMap.set(key, [...(groupMap.get(key) ?? []), row])
  }

  if (args.groupBy === 'service') {
    for (const row of buildInsightRows({ ...args, groupBy: 'creative' })) {
      const parts = row.subtitle.split(' · ')
      addGroup(parts[parts.length - 1] || 'Service', row)
    }
  } else if (args.groupBy === 'objective') {
    for (const row of buildInsightRows({ ...args, groupBy: 'campaign' })) addGroup(row.subtitle.split(' · ')[0] || 'Objective', row)
  } else if (args.groupBy === 'status') {
    for (const row of adRows) addGroup(row.subtitle.includes('ACTIVE') ? 'ACTIVE' : 'PAUSED', row)
  }

  return Array.from(groupMap.entries())
    .map(([key, rows], index) =>
      aggregateInsightGroup(
        `${args.groupBy}-${key}`,
        key,
        `${rows.length} grouped records`,
        rows,
        thumbTones[index % thumbTones.length],
      ),
    )
    .sort((a, b) => b.spend - a.spend)
}

function Investigator({
  campaign,
  insight,
  campaigns,
  insightComponents,
  adSets,
  adInsights,
  onSelectCampaign,
  onOpenAiDrawer,
}: {
  campaign: CampaignInsight
  insight: AIInsight
  campaigns: CampaignInsight[]
  insightComponents: WorkspaceData['insightComponents']
  adSets: WorkspaceData['adSets']
  adInsights: WorkspaceData['adInsights']
  onSelectCampaign: (id: string) => void
  onOpenAiDrawer: (context: AiInsightDrawerContext) => void
}) {
  const [groupBy, setGroupBy] = useState<InsightGroupBy>('creative')
  const insightRows = useMemo(
    () => buildInsightRows({ groupBy, campaigns, adSets, adInsights, insightComponents }),
    [adInsights, adSets, campaigns, groupBy, insightComponents],
  )
  const activeGroup = insightGroupOptions.find((option) => option.value === groupBy) ?? insightGroupOptions[0]
  const totals = insightRows.reduce(
    (summary, component) => ({
      spend: summary.spend + component.spend,
      clicks: summary.clicks + component.clicks,
      results: summary.results + component.results,
      purchaseValue: summary.purchaseValue + component.purchaseValue,
    }),
    { spend: 0, clicks: 0, results: 0, purchaseValue: 0 },
  )
  const totalCtr = safeDivide(
    insightRows.reduce((sum, component) => sum + component.ctr * component.clicks, 0),
    totals.clicks,
  )
  const totalCostPerResult = safeDivide(totals.spend, totals.results)
  const totalRoas = safeDivide(totals.purchaseValue, totals.spend)

  return (
    <section className="ai-insights-screen">
      <div className="insights-card" title={`Selected AI confidence ${insight.confidence}%`}>
        <div className="insights-toolbar">
          <div className="group-control">
            <span>Group By</span>
            <label className="group-select" aria-label="Group by insights">
              <ImageIcon size={20} />
              <span>
                <strong>{activeGroup.label}</strong>
                <small>{activeGroup.description}</small>
              </span>
              <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as InsightGroupBy)}>
                {insightGroupOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>
          </div>
          <div className="insight-toolbar-actions">
            <span>{insightRows.length} rows</span>
          </div>
        </div>

        <div className="insights-table-wrap">
          <table className="insights-table">
            <thead>
              <tr>
                <th aria-label="Select">
                  <input className="row-check" type="checkbox" aria-label="Select all creatives" />
                </th>
                <MetricTh label={activeGroup.label} help="เลือก Group By เพื่อดู performance ระดับ Creative, Campaign, Ad set, Ad, Service, Objective หรือ Status" />
                <MetricTh label="Score" help="AI score รวมจาก ROAS, CTR, cost/result และ lead quality" />
                <MetricTh label="Spend" help={metricHelp.adSpend} />
                <MetricTh label="Clicks" help="จำนวนคลิกจาก creative ใช้คู่กับ CTR และ CPC เพื่อวัด hook" />
                <MetricTh label="CTR" help={metricHelp.ctr} />
                <MetricTh label="Results" help="จำนวนผลลัพธ์หลักของ campaign เช่น booking, purchase หรือ lead ตาม objective" />
                <MetricTh label="Cost / Result" help="Spend / Results ใช้วัดต้นทุนต่อผลลัพธ์ตาม objective ของ campaign" />
                <MetricTh label="Purchase Value" help={metricHelp.conversionValue} />
                <MetricTh label="ROAS" help={metricHelp.roas} />
              </tr>
            </thead>
            <tbody>
              {insightRows.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={10}>
                    <div className="empty-state table-empty-state">
                      <ImageIcon size={18} />
                      <strong>ยังไม่มี creative component</strong>
                      <p>เมื่อ Meta API ส่ง ad และ creative metrics ระบบจะจัดอันดับ Score, Spend, CTR, Results และ ROAS ในตารางนี้</p>
                    </div>
                  </td>
                </tr>
              )}
              {insightRows.map((component) => (
                <tr
                  key={component.id}
                  className={campaign.id === component.campaignId ? 'selected-row' : ''}
                  onClick={() => {
                    onSelectCampaign(component.campaignId)
                    onOpenAiDrawer({
                      kind: 'creative',
                      campaignId: component.campaignId,
                      title: component.title,
                      subtitle: `${component.subtitle} · Score ${component.score.toFixed(1)}`,
                    })
                  }}
                >
                  <td>
                    <input
                      className="row-check"
                      type="checkbox"
                      aria-label={`Select ${component.title}`}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </td>
                  <td>
                    <div className="creative-cell">
                      <div className={`creative-thumb ${component.thumbTone}`} aria-hidden="true">
                        <span className="thumb-header" />
                        <span className="thumb-visual" />
                        <span className="thumb-line wide" />
                        <span className="thumb-line" />
                      </div>
                      <div>
                        <button
                          className="table-title"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            onSelectCampaign(component.campaignId)
                            onOpenAiDrawer({
                              kind: 'creative',
                              campaignId: component.campaignId,
                              title: component.title,
                              subtitle: `${component.subtitle} · Score ${component.score.toFixed(1)}`,
                            })
                          }}
                        >
                          {component.title}
                        </button>
                        <span className="creative-meta">
                          {component.count} items
                          <ImageIcon size={13} />
                          {component.subtitle}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="score-cell">
                      <span className="score-track">
                        <span
                          className={`score-fill ${component.tone}`}
                          style={{ width: `${Math.min(component.score * 10, 100)}%` }}
                        />
                      </span>
                      <strong>{component.score.toFixed(1)}</strong>
                    </div>
                  </td>
                  <td>{fmtMoney(component.spend)}</td>
                  <td>{fmtNum(component.clicks)}</td>
                  <td>{component.ctr.toFixed(2)}%</td>
                  <td>{fmtNum(component.results)}</td>
                  <td>{fmtMoney(component.costPerResult)}</td>
                  <td>{fmtMoney(component.purchaseValue)}</td>
                  <td>{component.roas.toFixed(2)}x</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Total ({insightRows.length} rows)</td>
                <td>—</td>
                <td>{fmtMoney(totals.spend)}</td>
                <td>{fmtNum(totals.clicks)}</td>
                <td>{totalCtr.toFixed(2)}%</td>
                <td>{fmtNum(totals.results)}</td>
                <td>{fmtMoney(totalCostPerResult)}</td>
                <td>{fmtMoney(totals.purchaseValue)}</td>
                <td>{totalRoas.toFixed(2)}x</td>
              </tr>
            </tfoot>
          </table>
        </div>

      </div>
    </section>
  )
}

export default App
