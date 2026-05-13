import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  FileClock,
  Flag,
  HelpCircle,
  HeartPulse,
  ImageIcon,
  Info,
  Layers3,
  LineChart,
  PauseCircle,
  PlayCircle,
  Plug,
  Power,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Trophy,
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
  ResponsiveContainer,
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
  AppointmentStage,
  ApprovalRequest,
  AutoAdControl,
  AutoDecision,
  AutomationMode,
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
      { id: 'campaigns', label: 'Campaigns', description: 'จัดการ service campaign', icon: Zap },
      { id: 'auto', label: 'Ads Auto', description: 'เปิด ปิด และปรับ Ads ผ่าน Meta API', icon: Power },
    ],
  },
  {
    title: 'Studio',
    description: 'เครื่องมือทำงานกับ creative และ audience',
    tabs: [
      { id: 'tasks', label: 'Creative', description: 'Creative, CRM, LP, Report tasks', icon: Layers3 },
      { id: 'memory', label: 'Audience', description: 'Audience memory และ context', icon: Users },
      { id: 'compliance', label: 'Media Library', description: 'ตรวจ claim และ creative คลินิก', icon: ImageIcon },
    ],
  },
  {
    title: 'Insights',
    description: 'วิเคราะห์ performance และ action',
    tabs: [
      { id: 'overview', label: 'Performance', description: 'ภาพรวมคลินิกและบริการ', icon: LineChart },
      { id: 'investigator', label: 'AI Insights', description: 'จัดอันดับ creative และ signal', icon: BarChart3 },
      { id: 'actions', label: 'Action Queue', description: 'Recommendation ที่รอ approve', icon: ClipboardList },
    ],
  },
  {
    title: 'System',
    description: 'ระบบเสริมและประวัติ',
    tabs: [
      { id: 'settings', label: 'Settings', description: 'API keys, connection checks, system health', icon: Settings },
      { id: 'audit', label: 'Integrations', description: 'Before/after และ approval history', icon: Plug },
      { id: 'appointments', label: 'Help Center', description: 'Lead, booking, show-up', icon: HelpCircle },
    ],
  },
]

const platformModules: ToolTab[] = toolSections.flatMap((section) => section.tabs).filter((tab) => tab.id !== 'platform')

const pageMeta: Record<TabId, { title: string; subtitle: string; icon: typeof BarChart3 }> = {
  platform: {
    title: 'Clinic App Platform',
    subtitle: 'ระบบจัดการ growth, creative, booking และ automation สำหรับคลินิก',
    icon: Sparkles,
  },
  overview: {
    title: 'Performance',
    subtitle: 'ภาพรวม spend, booking, revenue และ service health',
    icon: LineChart,
  },
  appointments: {
    title: 'Help Center',
    subtitle: 'Appointment pipeline และ operational signals ของทีมคลินิก',
    icon: HelpCircle,
  },
  campaigns: {
    title: 'Campaigns',
    subtitle: 'Service campaigns และ performance แยกตามบริการ',
    icon: Zap,
  },
  investigator: {
    title: 'AI Insights',
    subtitle: 'Components ranked by clinic performance • Powered by your campaign data',
    icon: BarChart3,
  },
  actions: {
    title: 'Action Queue',
    subtitle: 'Recommended actions พร้อม approval, guardrail และ before/after',
    icon: ClipboardList,
  },
  auto: {
    title: 'Ads Auto',
    subtitle: 'เปิด/ปิด Ads จาก Meta API ผ่าน approval และ guardrails',
    icon: Power,
  },
  tasks: {
    title: 'Creative',
    subtitle: 'Agent tasks สำหรับ creative, CRM, report และ landing page',
    icon: Layers3,
  },
  memory: {
    title: 'Audience',
    subtitle: 'Knowledge base สำหรับ service, audience และ preference',
    icon: Users,
  },
  compliance: {
    title: 'Media Library',
    subtitle: 'ตรวจ creative, before/after และ claim ก่อนใช้งาน',
    icon: ImageIcon,
  },
  settings: {
    title: 'Settings',
    subtitle: 'ตั้งค่า API, ตรวจ connection และ system readiness',
    icon: Settings,
  },
  audit: {
    title: 'Integrations',
    subtitle: 'Audit trail และ snapshot ของ action ในระบบ',
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

function nextDeliveryStatus(status: AdDeliveryStatus): AdDeliveryStatus {
  return status === 'active' ? 'paused' : 'active'
}

function toMetaObjectStatus(status: AdDeliveryStatus): MetaObjectStatus {
  return status === 'active' ? 'ACTIVE' : 'PAUSED'
}

function normalizeDeliveryStatus(status?: AdDeliveryStatus, spend = 0): AdDeliveryStatus {
  if (status === 'active' || status === 'paused') return status
  return spend > 0 ? 'active' : 'paused'
}

function autoAdObjectId(ad: AutoAdControl) {
  return ad.adId || ad.id.replace(/^meta-auto-/, '')
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

type CampaignControlScope = MetaObjectType
type InsightGroupBy = 'creative' | 'campaign' | 'adset' | 'ad' | 'service' | 'objective' | 'status'

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

const insightGroupOptions: Array<{ value: InsightGroupBy; label: string; description: string }> = [
  { value: 'creative', label: 'Creative', description: 'Images / videos / angles' },
  { value: 'campaign', label: 'Campaign', description: 'Meta campaign level' },
  { value: 'adset', label: 'Ad Set', description: 'Audience and budget set' },
  { value: 'ad', label: 'Ad', description: 'Single ad performance' },
  { value: 'service', label: 'Service', description: 'Clinic service grouping' },
  { value: 'objective', label: 'Objective', description: 'Meta objective grouping' },
  { value: 'status', label: 'Status', description: 'ACTIVE / PAUSED grouping' },
]

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

function normalizeWorkspaceData(input?: Partial<WorkspaceData> | null): WorkspaceData {
  return {
    ...emptyWorkspaceData,
    ...input,
    campaigns: pickArray<CampaignInsight>(input?.campaigns, emptyWorkspaceData.campaigns),
    serviceLines: pickArray<ServiceLine>(input?.serviceLines, emptyWorkspaceData.serviceLines),
    appointmentStages: pickArray<AppointmentStage>(input?.appointmentStages, emptyWorkspaceData.appointmentStages),
    complianceReviews: pickArray<ComplianceReview>(input?.complianceReviews, emptyWorkspaceData.complianceReviews),
    insights: pickArray<AIInsight>(input?.insights, emptyWorkspaceData.insights),
    insightComponents: pickArray(input?.insightComponents, emptyWorkspaceData.insightComponents),
    adSets: pickArray(input?.adSets, emptyWorkspaceData.adSets),
    adInsights: pickArray(input?.adInsights, emptyWorkspaceData.adInsights),
    actions: pickArray<RecommendedAction>(input?.actions, emptyWorkspaceData.actions),
    autoAds: pickArray<AutoAdControl>(input?.autoAds, emptyWorkspaceData.autoAds),
    tasks: pickArray(input?.tasks, emptyWorkspaceData.tasks),
    memoryItems: pickArray<MemoryItem>(input?.memoryItems, emptyWorkspaceData.memoryItems),
    auditTrail: pickArray(input?.auditTrail, emptyWorkspaceData.auditTrail),
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

function App() {
  const [workspace, setWorkspace] = usePersistentWorkspace()
  const [activeTab, setActiveTab] = useState<TabId>('investigator')
  const [selectedCampaignId, setSelectedCampaignId] = useState(workspace.campaigns[0]?.id ?? '')
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light')
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
  const autoMetaSyncRef = useRef(false)
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [performanceDrilldown, setPerformanceDrilldown] = useState<PerformanceDrilldown | null>(null)
  const [aiInsightDrawer, setAiInsightDrawer] = useState<AiInsightDrawerContext | null>(null)
  const [statusChangeRequest, setStatusChangeRequest] = useState<DeliveryStatusChangeRequest | null>(null)
  const [statusChangeState, setStatusChangeState] = useState<{ running: boolean; error: string | null }>({
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

  const approveRecommendedAction = (id: string) => {
    const target = actions.find((action) => action.id === id)
    if (!target) return

    setActions((current) => current.map((action) => (action.id === id ? { ...action, status: 'approved' } : action)))
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
      setWorkspace(nextWorkspace)
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
    if (!metaSync.connected || autoMetaSyncRef.current) return
    autoMetaSyncRef.current = true
    void handleSyncMetaWorkspace()
  }, [handleSyncMetaWorkspace, metaSync.connected])

  const confirmApproval = () => {
    if (!approvalRequest) return
    if (approvalRequest.kind === 'recommendation') {
      approveRecommendedAction(approvalRequest.id)
    } else {
      applyAutoDecision(approvalRequest.id)
    }
    setApprovalRequest(null)
  }

  const approvalTarget =
    approvalRequest?.kind === 'recommendation'
      ? actions.find((action) => action.id === approvalRequest.id)
      : approvalRequest?.kind === 'auto'
        ? autoAds.find((ad) => ad.id === approvalRequest.id)
        : null
  const currentPage = pageMeta[activeTab]
  const CurrentPageIcon = currentPage.icon

  return (
    <div className="app-shell" data-theme={themeMode}>
      <aside className="sidebar" aria-label="Clinic growth navigation">
        <div className="brand">
          <button className="brand-home" type="button" onClick={() => setActiveTab('platform')} aria-label="Open app platform">
            <div className="brand-mark">
              <Sparkles size={18} />
            </div>
            <strong>ClinicStellar AI</strong>
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

        <nav className="tool-nav" aria-label="Dashboard tools">
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
          </div>
        </header>

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
            onOpen={setActiveTab}
            onOpenDrilldown={setPerformanceDrilldown}
            onSelectCampaign={(id) => {
              setSelectedCampaignId(id)
              setActiveTab('investigator')
            }}
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

        {activeTab === 'actions' && actions.length > 0 && (
          <section className="panel">
            <PanelHeader icon={ClipboardList} title="Clinic Action Queue" meta="ทุก action ต้องผ่าน approval" />
            <div className="action-list">
              {actions.map((action) => (
                <article key={action.id} className="action-card">
                  <div className="action-main">
                    <span className={`badge ${riskClass(action.risk)}`}>{action.risk} risk</span>
                    <h3>{action.type}</h3>
                    <strong>{action.target}</strong>
                    <p>{action.summary}</p>
                    <small>{action.expectedImpact}</small>
                  </div>
                  <div className="confidence-ring">
                    <span>{action.confidence}%</span>
                    <small>AI Confidence</small>
                  </div>
                  <div className="queue-actions">
                    {action.status === 'pending' ? (
                      <>
                        <button
                          className="approve-button"
                          type="button"
                          onClick={() => setApprovalRequest({ kind: 'recommendation', id: action.id })}
                        >
                          <Check size={16} />
                          Approve
                        </button>
                        <button className="reject-button" type="button" onClick={() => rejectAction(action.id)}>
                          <X size={16} />
                          Reject
                        </button>
                      </>
                    ) : (
                      <span className={`badge ${action.status === 'approved' ? 'good' : 'critical'}`}>
                        {action.status === 'approved' ? 'Approved' : 'Rejected'}
                      </span>
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

        {activeTab === 'auto' && autoAds.length > 0 && (
          <AutoAdsPanel
            mode={autoMode}
            ads={autoAds}
            onModeChange={setAutoMode}
            onApply={(ad) => {
              const nextStatus = ad.recommendation === 'enable' ? 'active' : 'paused'
              requestDeliveryStatusChange({
                objectType: 'ad',
                objectId: autoAdObjectId(ad),
                targetName: ad.adName,
                currentStatus: normalizeDeliveryStatus(ad.status),
                nextStatus,
                summary: `${autoDecisionLabel(ad.recommendation)} · ${ad.reason}`,
                source: 'ads-auto',
              })
            }}
          />
        )}
        {activeTab === 'auto' && autoAds.length === 0 && (
          <NoDataPanel
            icon={Power}
            title="ยังไม่มี Ads Auto Actions"
            message="ระบบจะเสนอการเปิด ปิด หรือลดงบ ad-level จากข้อมูล ad จริงหลัง Sync Meta แล้วเท่านั้น"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'tasks' && tasks.length > 0 && (
          <section className="panel">
            <PanelHeader icon={Layers3} title="Agent Task Center" meta="Clinic AI Agent เป็น orchestrator กลาง" />
            <div className="task-grid">
              {tasks.map((task) => (
                <article key={task.id} className="task-card">
                  <div className="task-topline">
                    <span className={`badge ${taskClass(task.status)}`}>{task.status}</span>
                    <span>{task.updatedAt}</span>
                  </div>
                  <h3>{task.agent}</h3>
                  <strong>{task.taskType}</strong>
                  <p>{task.result}</p>
                  <div className="task-context">
                    <strong>Input</strong>
                    <span>{task.inputContext}</span>
                    <strong>Expected output</strong>
                    <span>{task.expectedOutput}</span>
                  </div>
                  <div className="task-meta">
                    <span>{task.owner}</span>
                    <span>{task.sourceCampaign}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {activeTab === 'tasks' && tasks.length === 0 && (
          <NoDataPanel
            icon={Layers3}
            title="ยังไม่มี Agent Tasks"
            message="Task จะสร้างจากข้อมูล campaign, creative และ recommendation ที่ดึงจาก workspace จริง"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'memory' && memoryItems.length > 0 && (
          <MemoryPanel items={memoryItems} />
        )}
        {activeTab === 'memory' && memoryItems.length === 0 && (
          <NoDataPanel
            icon={Database}
            title="ยังไม่มี Audience Memory"
            message="Memory จะถูกเติมจาก insight, campaign context และ audit ที่เกิดจากข้อมูลจริงของบัญชี"
            actionLabel="Open Settings"
            onAction={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'compliance' && complianceReviews.length > 0 && (
          <CompliancePage reviews={complianceReviews} />
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
            onRefreshStatus={() => handleRefreshMetaStatus(true)}
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
          onCancel={() => setApprovalRequest(null)}
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
    </div>
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
  onModeChange,
  onApply,
}: {
  mode: AutomationMode
  ads: AutoAdControl[]
  onModeChange: (mode: AutomationMode) => void
  onApply: (ad: AutoAdControl) => void
}) {
  const pendingCount = ads.filter((ad) => !ad.applied && ad.recommendation !== 'keep').length
  const activeCount = ads.filter((ad) => ad.status === 'active').length
  const pausedCount = ads.length - activeCount

  return (
    <section className="auto-grid">
      <div className="panel auto-hero">
        <PanelHeader icon={Power} title="Ads Auto Control" meta="Meta status execution" />
        <div className="auto-hero-content">
          <div>
            <h2>Auto rules สำหรับเปิด/ปิด Ads จากข้อมูลจริง</h2>
            <p>ระบบอ่าน performance จาก Meta แล้วเสนอ status action ระดับ ad ก่อนยิง Meta API ผ่าน confirmation</p>
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
            <strong>{pendingCount}</strong>
          </div>
          <div>
            <span>Execution Mode</span>
            <strong>{mode === 'suggest' ? 'Manual' : 'Guarded'}</strong>
          </div>
        </div>
      </div>

      <div className="panel guardrail-panel">
        <PanelHeader icon={ShieldCheck} title="Auto Guardrails" meta="ข้อจำกัดก่อนเปิด/ปิด" />
        <div className="guardrail-list">
          <Signal icon={ShieldCheck} text="ทุก action ต้องมี reason, confidence และ before/after snapshot" tone="good" />
          <Signal icon={PauseCircle} text="Pause ได้เมื่อ spend และ data volume ผ่าน threshold เท่านั้น" tone="watch" />
          <Signal icon={AlertTriangle} text="High risk action ยังต้องให้คนกด approve เสมอ" tone="critical" />
          <Signal icon={PlayCircle} text="เปิด ad ที่ paused แล้วต้องเริ่มด้วย limited test budget" tone="good" />
        </div>
      </div>

      <div className="panel auto-list-panel">
        <PanelHeader icon={Zap} title="Ads Auto Queue" meta="ad-level status decisions" />
        <div className="auto-list">
          {ads.map((ad) => {
            const canRunStatusAction = ad.recommendation === 'pause' || ad.recommendation === 'enable'
            return (
              <article key={ad.id} className="auto-card">
                <div className="auto-card-main">
                  <div className="auto-card-topline">
                    <span className={`badge ${ad.status === 'active' ? 'good' : 'critical'}`}>
                      {ad.status === 'active' ? 'ACTIVE' : 'PAUSED'}
                    </span>
                    <span className={`badge ${autoDecisionTone(ad.recommendation)}`}>
                      {autoDecisionLabel(ad.recommendation)}
                    </span>
                    <span className={`badge ${riskClass(ad.risk)}`}>{ad.risk} risk</span>
                  </div>
                  <h3>{ad.adName}</h3>
                  <p>{ad.reason}</p>
                  <div className="auto-guardrail">
                    <ShieldCheck size={15} />
                    <span>{ad.guardrail}</span>
                  </div>
                  <div className="snapshot-grid">
                    <span>Before: {ad.before}</span>
                    <span>After: {ad.after}</span>
                  </div>
                </div>
                <div className="confidence-ring">
                  <span>{ad.confidence}%</span>
                  <small>AI Confidence</small>
                </div>
                <div className="queue-actions">
                  {ad.applied ? (
                    <span className="badge good">Applied</span>
                  ) : ad.recommendation === 'keep' ? (
                    <span className="badge scale">Monitor only</span>
                  ) : canRunStatusAction ? (
                    <button className="approve-button" type="button" onClick={() => onApply(ad)}>
                      <Check size={16} />
                      {mode === 'suggest' ? 'Confirm status' : 'Run guarded'}
                    </button>
                  ) : (
                    <span className="badge watch">Budget review</span>
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
  onOpen,
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
  onOpen: (tab: TabId) => void
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

  return (
    <section className="performance-grid">
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
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
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
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <PanelHeader icon={LineChart} title="Funnel Conversion" meta="Stage rate & drop-off" help={metricHelp.dropOff} />
        <div className="chart-wrap compact-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelMetrics} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
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
          </ResponsiveContainer>
        </div>
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
                        nextAction: 'คลิก Campaigns เพื่อดู campaign/ad set/ad ที่เกี่ยวข้อง หรือสร้าง recommendation เข้า Action Queue ใน Step ต่อไป',
                      })
                    }
                  >
                    <td>
                      <button
                        className="table-title"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpen('campaigns')
                        }}
                        title="เปิดหน้า Campaigns"
                      >
                        {channel.channel}
                      </button>
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
          <button className="primary-button" type="button" onClick={() => onOpen('auto')} title={metricHelp.autoAds}>
            Manage Auto
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
                  onClick={() => onSelectCampaign(campaign.id)}
                  title={`${campaign.aiSummary} · เปิด AI Insights`}
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
}: {
  selectedCampaignId: string
  campaigns: CampaignInsight[]
  adSets: WorkspaceData['adSets']
  adInsights: WorkspaceData['adInsights']
  onSelectCampaign: (id: string) => void
  onOpenAiDrawer: (context: AiInsightDrawerContext) => void
  onRequestStatusChange: (request: DeliveryStatusChangeRequest) => void
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
          <button className="collapse-button" type="button" aria-expanded={expandedSections.adSets} onClick={() => toggleSection('adSets')}>
            <ChevronDown size={15} />
            {expandedSections.adSets ? 'ย่อ' : 'ขยาย'}
          </button>
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
          <button className="collapse-button" type="button" aria-expanded={expandedSections.ads} onClick={() => toggleSection('ads')}>
            <ChevronDown size={15} />
            {expandedSections.ads ? 'ย่อ' : 'ขยาย'}
          </button>
        </div>
        {expandedSections.ads && <div className="table-wrap compact-table-wrap">
          <table className="performance-table">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Status</th>
                <th>Spend</th>
                <th>CTR</th>
                <th>CPC</th>
                <th>Leads</th>
                <th>Bookings</th>
                <th>Show-up</th>
                <th>ROAS</th>
                <th>Score</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleAds.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={11}>
                    <div className="empty-state table-empty-state">
                      <ImageIcon size={18} />
                      <strong>ยังไม่มี Ads detail สำหรับ campaign นี้</strong>
                      <p>ตอนนี้ระบบยังใช้ campaign metrics ในการวิเคราะห์ได้ แต่ creative/ad-level optimization ต้องรอ ad detail import</p>
                    </div>
                  </td>
                </tr>
              )}
              {visibleAds.map((ad) => (
                <tr key={ad.id}>
                  <td>
                    <button
                      className="table-title"
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
                  </td>
                  <td>
                    <span className={`badge ${ad.status === 'active' ? 'good' : 'critical'}`}>
                      {ad.status === 'active' ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </td>
                  <td>{fmtMoney(ad.spend)}</td>
                  <td>{ad.ctr.toFixed(2)}%</td>
                  <td>{fmtMoney(ad.cpc)}</td>
                  <td>{fmtNum(ad.leads)}</td>
                  <td>{fmtNum(ad.bookings)}</td>
                  <td>{ad.showRate}%</td>
                  <td>{ad.roas.toFixed(2)}x</td>
                  <td>{ad.score.toFixed(1)}</td>
                  <td>
                    {(() => {
                      const currentStatus = normalizeDeliveryStatus(ad.status, ad.spend)
                      const nextStatus = nextDeliveryStatus(currentStatus)
                      return (
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
                              summary: `${nextStatus === 'active' ? 'Activate' : 'Pause'} ad จาก Ads table`,
                              source: 'campaigns',
                            })
                          }
                        >
                          {nextStatus === 'active' ? 'Activate' : 'Pause'}
                        </button>
                      )
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
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

  return (
    <section className="platform-grid">
      <div className="platform-hero panel">
        <div>
          <span className="badge scale">Clinic App Platform</span>
          <h2>ศูนย์รวมระบบจัดการคลินิก</h2>
          <p>แยกงานเป็นแอปสำหรับ growth, appointment, service, AI, compliance และทีมปฏิบัติการ</p>
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

      <div className="app-module-grid">
        {modules.map((module, index) => {
          const Icon = module.icon
          return (
            <button
              key={module.id}
              type="button"
              className={`app-module-card tone-${(index % 5) + 1}`}
              onClick={() => onOpen(module.id)}
            >
              <span className="app-icon">
                <Icon size={22} />
              </span>
              <strong>{module.label}</strong>
              <small>{module.description}</small>
            </button>
          )
        })}
      </div>

      <div className="panel platform-side">
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
  onRefreshStatus,
  onCheckMeta,
  onSyncMeta,
  onSaveConfig,
  onClearConfig,
}: {
  metaSync: MetaSyncState
  onRefreshStatus: () => void
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
            <strong>GET /api/meta/workspace</strong>
            <span>ดึง Meta dataset และ map เป็นข้อมูลทั้ง Dashboard</span>
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

function CompliancePage({ reviews }: { reviews: ComplianceReview[] }) {
  const statusTone = (status: ComplianceReview['status']) =>
    status === 'approved' ? 'good' : status === 'needsReview' ? 'watch' : 'critical'

  return (
    <section className="panel">
      <PanelHeader icon={ShieldCheck} title="Clinic Compliance Review" meta="claims · creative · proof" />
      <div className="compliance-grid">
        {reviews.map((review) => (
          <article key={review.id} className="compliance-card">
            <div className="compliance-topline">
              <span className={`badge ${statusTone(review.status)}`}>
                {review.status === 'approved' ? 'Approved' : review.status === 'needsReview' ? 'Review' : 'Blocked'}
              </span>
              <span>{review.service}</span>
            </div>
            <h3>{review.title}</h3>
            <p>{review.issue}</p>
            <div className="auto-guardrail">
              <ShieldCheck size={15} />
              <span>{review.fix}</span>
            </div>
          </article>
        ))}
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

function MemoryPanel({ items }: { items: MemoryItem[] }) {
  const categories: MemoryCategory[] = ['Insight', 'Creative', 'Audience', 'Strategy', 'Preference']

  return (
    <section className="memory-grid">
      <div className="panel memory-hero">
        <PanelHeader icon={Database} title="Memory & Knowledge Base" meta="semantic memory" />
        <div className="memory-hero-content">
          <div>
            <h2>ฐานความจำของ Clinic AI Agent</h2>
            <p>
              เก็บ insight, creative notes, strategy history และ user preferences เพื่อให้คำแนะนำครั้งต่อไปไม่เริ่มจากศูนย์
            </p>
          </div>
          <div className="memory-count">
            <strong>{items.length}</strong>
            <span>memory items</span>
          </div>
        </div>
      </div>

      <div className="panel memory-taxonomy">
        <PanelHeader icon={BrainCircuit} title="Knowledge Categories" meta="vector-ready structure" />
        <div className="category-grid">
          {categories.map((category) => (
            <div key={category}>
              <span className="badge scale">{category}</span>
              <strong>{items.filter((item) => item.category === category).length}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="panel memory-list-panel">
        <PanelHeader icon={Database} title="Saved Context" meta="used by Clinic AI Agent" />
        <div className="memory-list">
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

function ApprovalModal({
  request,
  target,
  onCancel,
  onConfirm,
}: {
  request: ApprovalRequest
  target: RecommendedAction | AutoAdControl
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

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="approval-modal-header">
          <div>
            <span className="badge scale">Approval Layer</span>
            <h2 id="approval-title">{title}</h2>
            <p>{targetName}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close approval modal" onClick={onCancel}>
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
          <ShieldCheck size={16} />
          <span>การอนุมัตินี้บันทึก Action Queue และ Audit ใน workspace; ถ้าต้องเปลี่ยนสถานะ Meta ให้ใช้ Campaigns หรือ Ads Auto</span>
        </div>

        <div className="approval-actions">
          <button className="reject-button" type="button" onClick={onCancel}>
            <X size={16} />
            Cancel
          </button>
          <button className="approve-button" type="button" onClick={onConfirm}>
            <Check size={16} />
            Confirm approval
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
                        <button className="table-title" type="button">
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
