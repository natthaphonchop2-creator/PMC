import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Eye,
  FileText,
  ImageIcon,
  Info,
  Layers3,
  LineChart,
  Menu,
  Megaphone,
  MousePointerClick,
  Percent,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import gsap from 'gsap'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type {
  AiBrainResponse,
  CampaignInsight,
  FunnelMetric as MetaFunnelMetric,
  RecommendedAction as MetaRecommendedAction,
  TrendPoint,
  WebsiteContext,
  WorkspaceData,
} from './types'
import { buildRevenueTrendOption } from './adsDashboardChart'
import {
  adGroupApprovalCommandToMetaRequest,
  buildAdGroupRows,
  createAdGroupApprovalCommand,
  filterAdGroupRows,
  groupAdGroupRowsByCampaign,
  validateAdGroupEditDraft,
  type AdGroupApprovalCommand,
  type AdGroupRow,
  type AdGroupStatusFilter,
  type AdGroupViewMode,
} from './adGroupsWorkspace'
import {
  buildFallbackInsightsCache,
  buildInsightsAnalysisPayload,
  canOpenInsightsApprovalCommand,
  deriveInsightsMetrics,
  formatInsightMetricValue,
  normalizeInsightsAiResponse,
  readInsightsCache,
  writeInsightsCache,
  type InsightsCachedInsight,
  type InsightsConfidence,
  type InsightsDerivedMetric,
  type InsightsEvidenceCard,
  type InsightsFormulaDiagnostic,
  type InsightsMetrics,
  type InsightsRecommendation,
} from './insightsWorkspace'
import { HomeApp } from './apps/home/HomeApp'
import { PageAutomationApp } from './apps/page-automation/PageAutomationApp'
import type { ManagedPage, SharedAdsInsightForPage } from './apps/page-automation/types'
import { metaDatePresetForUi, scopeWorkspaceByDatePreset } from './adsDashboardDateScope'
import './App.css'

type TabId =
  | 'analytics'
  | 'ads'
  | 'marketer'
  | 'optimization'
  | 'creative'
  | 'audience'
  | 'library'
  | 'reports'
  | 'settings'
  | 'help'

type Tone = 'good' | 'watch' | 'critical' | 'info' | 'neutral' | 'violet'
type ActionState = 'Suggested' | 'Pending approval' | 'Approved' | 'Executing' | 'Executed' | 'Failed' | 'Rejected'

type NavItem = {
  id: TabId
  toolbarKey: string
  label: string
  group: 'Main' | 'Creative' | 'System'
  icon: LucideIcon
  description: string
}

type Campaign = {
  id: string
  name: string
  status: 'Active' | 'Watch' | 'Critical'
  deliveryStatus: 'active' | 'paused'
  budget: number
  spend: number
  revenue: number
  conversions: number
  cpa: number
  roas: number
  frequency: number
  ctr: number
  aiTag: string
  tone: Tone
}

type Recommendation = {
  id: string
  title: string
  evidence: string
  risk: 'Low' | 'Medium' | 'High'
  confidence: number
  guardrail: string
  impact: string
  action: string
  campaignId?: string
  targetName?: string
  source?: MetaRecommendedAction['source']
  requiresApproval?: boolean
  execution?: MetaRecommendedAction['execution']
}

type PlanExecutionDraft = {
  recommendation: Recommendation
  status: 'ready' | 'running'
  steps: string[]
}

type AdsObjectType = 'campaign' | 'adset' | 'ad'

type AdsManagerMutation =
  | {
      kind: 'status'
      objectType: AdsObjectType
      objectId: string
      objectName: string
      nextStatus: 'ACTIVE' | 'PAUSED'
    }
  | {
      kind: 'delete'
      objectType: AdsObjectType
      objectId: string
      objectName: string
    }

type AdsEditTarget = {
  objectType: AdsObjectType
  objectId: string
  objectName: string
  currentBudget?: number
}

type AdsReviewTarget = 'live' | 'stale' | 'campaign'

type AuditEvent = {
  id: string
  action: string
  detail: string
  actor: string
  time: string
  tone: Tone
}

type Summary = {
  spend: number
  budget: number
  revenue: number
  leads: number
  bookings: number
  paidTreatments: number
  roas: number
  cpa: number
  cac: number
  aov: number
}

type TrendDatum = { bookings: number; clicks?: number; date: string; day: string; impressions?: number; leads?: number; revenue: number; spend: number; treatments?: number }

type DataSourceState = 'loading' | 'live' | 'setup-required' | 'empty' | 'error'
type AutomationMode = 'แนะนำเท่านั้น' | 'ต้องอนุมัติก่อน' | 'พัก automation'
type AutomationToggleValue = 'เปิด Auto' | 'ปิด Auto'
type MascotNotice = {
  id: number
  message: string
  tone: Tone
}

type PageScopeLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

type AdsPageSelectorOption = {
  detail: string
  id: string
  kind: 'all' | 'page' | 'account'
  label: string
  meta?: string
}

type AutoAdDecision = 'pause' | 'keep' | 'activate' | 'watch'

type AutoAdPlan = {
  id: string
  ad: WorkspaceData['adInsights'][number]
  adSet?: WorkspaceData['adSets'][number]
  campaign?: Campaign
  source?: WorkspaceData['autoAds'][number]
  decision: AutoAdDecision
  targetStatus?: 'ACTIVE' | 'PAUSED'
  label: string
  actionLabel: string
  reason: string
  guardrail: string
  impact: string
  nextStep: string
  evidence: string[]
  confidence: number
  priority: number
  risk: Recommendation['risk']
  tone: Tone
  canQueue: boolean
  blockedReason?: string
  sortScore: number
}

type AutoAdsThresholds = {
  confidenceFloor: number
  ctrFloor: number
  minSpend: number
  winnerRoas: number
}

type OptimizerStrategy = AutoAdDecision | 'all'

type OptimizerBatch = {
  generatedAt: string
  plans: AutoAdPlan[]
  strategy: OptimizerStrategy
}

type OptimizerAiDecision = {
  adId: string
  decision: AutoAdDecision
  actionLabel: string
  reason: string
  conditionAnalysis: string
  guardrail: string
  nextStep: string
  confidence: number
  risk: Recommendation['risk']
}

type OptimizerAiCondition = {
  title: string
  analysis: string
  matchedAdIds: string[]
  recommendedAction: string
  risk: Recommendation['risk']
}

type OptimizerAiApiResponse = {
  ok: boolean
  summary: string
  modelNotes: string[]
  decisions: OptimizerAiDecision[]
  conditions: OptimizerAiCondition[]
  checkedAt: string
  durationMs: number
  model: string
  modelFallback?: {
    reason: string
    mode: string
  }
}

type MetaStatusResponse = {
  configured: boolean
  connected: boolean
  graphVersion?: string
  adAccountId?: string | null
  activeWorkspaceId?: string | null
  workspaceLabel?: string | null
  workspaces?: MetaWorkspaceOption[]
  datePreset?: string
  source?: string
  settingsSource?: string | null
  tokenLocation?: string | null
  connection?: { ok?: boolean; checks?: Array<{ key: string; label: string; status: string; detail: string }> }
  requiredEnv?: Array<{ key: string; present: boolean; help?: string }>
}

type OpenAiStatusResponse = {
  configured: boolean
  connected: boolean
  model?: string
  maxOutputTokens?: number
  source?: string
  settingsSource?: string | null
  tokenLocation?: string | null
  hasSavedApiKey?: boolean
  canEditInWeb?: boolean
  requiredEnv?: Array<{ key: string; present: boolean; source?: string; help?: string }>
  renderPersistence?: {
    enabled: boolean
    updated?: Array<{ key: string; ok: boolean; status: number }>
    error?: string
  }
}

type MetaWorkspaceResponse = {
  workspace: WorkspaceData
  meta: {
    account?: { name?: string; account_id?: string; currency?: string; timezone_name?: string }
    activeWorkspaceId?: string
    workspaceLabel?: string
    counts?: { campaigns: number; adSets: number; ads: number; timeSeries: number }
    datePreset: string
    fetchedAt: string
    graphVersion: string
    source: string
  }
}

type ManagedPagesResponse = {
  pages: ManagedPage[]
  source: 'meta' | 'cache' | 'unavailable'
}

type AdsInsightResponse = {
  insight: SharedAdsInsightForPage | null
  source: 'ads-workspace' | 'unavailable'
}

type AiBrainApiResponse = AiBrainResponse & {
  ok: boolean
  taskId: string
  checkedAt: string
  durationMs: number
  model: string
  knowledge?: {
    targetIds: string[]
    memoriesRead: number
    decisionsRead: number
    memoriesWritten: number
    decisionsWritten: number
  }
}

type MetaInfo = {
  accountName: string
  adAccountId?: string | null
  activeWorkspaceId?: string | null
  workspaceLabel?: string | null
  workspaces?: MetaWorkspaceOption[]
  fetchedAt: string
  graphVersion: string
  source: string
  settingsSource?: string | null
  tokenLocation?: string | null
  counts?: MetaWorkspaceResponse['meta']['counts']
}

type MetaWorkspaceOption = {
  id: string
  label: string
  adAccountId: string
  graphVersion?: string
  datePreset?: string
  maxPages?: number
  source?: string
  active?: boolean
}

type MetaConfigResponse = MetaStatusResponse & {
  hasSavedToken?: boolean
  maxPages?: number
  renderPersistence?: {
    enabled: boolean
    updated?: Array<{ key: string; ok: boolean; status: number }>
    error?: string
  }
}

const navItems: NavItem[] = [
  { id: 'analytics', toolbarKey: 'dashboard', label: 'Ads Dashboard', group: 'Main', icon: LineChart, description: 'ภาพรวมโฆษณาและคำแนะนำที่ควรตรวจวันนี้' },
  { id: 'ads', toolbarKey: 'campaigns', label: 'Campaigns', group: 'Main', icon: Megaphone, description: 'ดูและจัดการแคมเปญ ชุดโฆษณา และโฆษณาที่ใช้งานอยู่' },
  { id: 'ads', toolbarKey: 'ad-groups', label: 'Ad Groups', group: 'Main', icon: Layers3, description: 'ตรวจชุดโฆษณา กลุ่มเป้าหมาย และโฆษณาที่อยู่ในแต่ละแคมเปญ' },
  { id: 'marketer', toolbarKey: 'insights', label: 'Insights', group: 'Main', icon: BrainCircuit, description: 'คำแนะนำที่ควรตรวจและตัดสินใจต่อ' },
  { id: 'creative', toolbarKey: 'automation-ads', label: 'Automation Ads', group: 'Creative', icon: RefreshCw, description: 'จัดการระบบโฆษณาอัตโนมัติและสถานะ workflow ก่อนเปิดใช้งานจริง' },
  { id: 'audience', toolbarKey: 'audience', label: 'Audience', group: 'Creative', icon: Users, description: 'ดูผู้ชม พื้นที่ และคุณภาพลูกค้าที่เข้ามาจากโฆษณา' },
  { id: 'reports', toolbarKey: 'reports', label: 'Reports', group: 'System', icon: FileText, description: 'รายงานสรุปผลงานโฆษณาให้ทีมตรวจและนำไปใช้ต่อ' },
  { id: 'settings', toolbarKey: 'settings', label: 'Settings', group: 'System', icon: Settings, description: 'ตั้งค่าบัญชีโฆษณาและระบบวิเคราะห์ให้พร้อมใช้งาน' },
]

const datePresetOptions = ['ข้อมูลทั้งหมด', '7 วันล่าสุด', '30 วันล่าสุด', 'เดือนนี้', 'ไตรมาสนี้']
const automationToggleOptions: AutomationToggleValue[] = ['เปิด Auto', 'ปิด Auto']

function normalizeAutomationMode(value: string): AutomationMode {
  if (value === 'เปิด Auto' || value === 'ต้องอนุมัติก่อน') return 'ต้องอนุมัติก่อน'
  return 'พัก automation'
}

function automationToggleValue(mode: string): AutomationToggleValue {
  return normalizeAutomationMode(mode) === 'ต้องอนุมัติก่อน' ? 'เปิด Auto' : 'ปิด Auto'
}

function automationDisplayLabel(mode: string) {
  return automationToggleValue(mode)
}

const sectionTooltips: Record<string, string> = {
  'Ads Dashboard': 'ภาพรวมแคมเปญ คำแนะนำ และ KPI ที่ควรตรวจวันนี้',
  'Performance Overview': 'ดูแนวโน้มค่าโฆษณา รายได้ และยอดนัดหมายจากข้อมูลล่าสุด',
  'Top Campaigns': 'แคมเปญที่ทำผลงานดีที่สุดตามผลลัพธ์และผลตอบแทน',
  'คำแนะนำที่รออนุมัติ': 'รายการที่ควรตรวจวันนี้ก่อนกดรีวิวหรือปฏิเสธ',
  'PMC Insights': 'สรุปสัญญาณล่าสุดจากข้อมูล Ads Dashboard',
  'ตัวจัดการโฆษณา': 'จัดการแคมเปญ ชุดโฆษณา และโฆษณา รวมเปิด ปิด แก้ไข หรือลบ',
  'แคมเปญที่เลือก': 'ดูรายละเอียดของแคมเปญที่กำลังเลือกอยู่ก่อนทำงานต่อ',
  Insights: 'สรุป AI brief ตัวเลข สูตรวิเคราะห์ และหลักฐานจากข้อมูลโฆษณาล่าสุด',
  'ตัวสร้างรายงาน': 'เตรียมรายงานสรุปงานโฆษณาจากข้อมูลล่าสุด',
  'ตั้งค่าบัญชีโฆษณา': 'เชื่อมต่อบัญชีโฆษณาและระบบวิเคราะห์ให้พร้อมใช้งาน',
  'ศูนย์ช่วยเหลือ': 'คู่มือสั้นสำหรับเริ่มใช้งานและแก้ปัญหาเบื้องต้น',
  'ผลงานครีเอทีฟ': 'ดูครีเอทีฟที่ทำผลงานดีหรือควรปรับใหม่',
  'กลุ่มเป้าหมาย': 'ดูผู้ชมและกลุ่มลูกค้าที่เชื่อมกับผลลัพธ์ของโฆษณา',
  'ปริมาณของกลุ่มเป้าหมาย': 'เทียบค่าโฆษณาและยอดนัดหมายตามกลุ่มเป้าหมาย',
  'คลังโฆษณา': 'ตรวจครีเอทีฟและความเสี่ยงของข้อความก่อนเปิดใช้งาน',
}

const fmtMoney = (value: number) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(value)

const fmtNum = (value: number) => new Intl.NumberFormat('th-TH').format(value)
const fmtMoneyShort = (value: number) => (value >= 1000 ? `฿${Math.round(value / 1000)}k` : fmtMoney(value))
const ALL_PAGE_SCOPE_ID = 'all-pages'
const DEFAULT_META_WORKSPACE_DATE_PRESET = 'maximum'

function buildAdsPageSelectorOptions(pages: ManagedPage[], metaInfo: MetaInfo | null): AdsPageSelectorOption[] {
  const pageOptions = pages.map((page) => ({
    detail: `${pagePlatformLabel(page.platform)} Page${page.followers > 0 ? ` · ${fmtNum(page.followers)} followers` : ''}`,
    id: page.id,
    kind: 'page' as const,
    label: page.name || page.handle || 'Page ที่เชื่อมต่อ',
    meta: page.handle ? page.handle : page.lastSyncedAt ? `อัปเดต ${formatShortDateTime(page.lastSyncedAt)}` : undefined,
  }))

  const connectedAccountLabel = firstUsefulText(metaInfo?.workspaceLabel, metaInfo?.accountName)
  const accountOption = pageOptions.length === 0 && connectedAccountLabel
    ? [
        {
          detail: 'บัญชีโฆษณาที่เชื่อมไว้',
          id: `account:${metaInfo?.activeWorkspaceId || metaInfo?.adAccountId || connectedAccountLabel}`,
          kind: 'account' as const,
          label: connectedAccountLabel,
          meta: metaInfo?.adAccountId ?? undefined,
        },
      ]
    : []

  return [
    {
      detail: pageOptions.length ? `${pageOptions.length} Page ที่เชื่อมไว้` : 'ทุกข้อมูลจากบัญชีที่เชื่อมไว้',
      id: ALL_PAGE_SCOPE_ID,
      kind: 'all',
      label: 'ข้อมูลทั้งหมด',
      meta: 'All pages',
    },
    ...pageOptions,
    ...accountOption,
  ]
}

function firstUsefulText(...values: Array<string | null | undefined>) {
  return values.find((value) => {
    const normalized = value?.trim()
    return normalized && !normalized.includes('ยังไม่ได้ตั้งค่า') && !normalized.includes('ไม่สำเร็จ')
  })?.trim()
}

function pagePlatformLabel(platform: ManagedPage['platform']) {
  return platform === 'instagram' ? 'Instagram' : 'Facebook'
}

function formatShortDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function App() {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname
  if (pathname.startsWith('/page-automation')) return <PageAutomationApp />
  if (pathname.startsWith('/ads-agent')) return <PmcAdsAgentApp />
  return <HomeApp />
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `คำขอ API ล้มเหลว (${response.status})`)
  }
  return payload as T
}

function formatApiMessage(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('too many calls') || lower.includes('rate limit') || lower.includes('user request limit reached') || lower.includes('application request limit')) {
    return 'Meta จำกัดจำนวนคำขอชั่วคราว กรุณารอสักครู่แล้วกดโหลดข้อมูลอีกครั้ง'
  }
  if (lower.includes('invalid oauth') || lower.includes('access token') || lower.includes('session has expired')) {
    return 'ข้อมูลเชื่อมต่อ Meta ใช้งานไม่ได้หรือหมดอายุ กรุณาตรวจในหน้า Settings'
  }
  if (lower.includes('permission') || lower.includes('does not have access')) {
    return 'บัญชีนี้ยังไม่มีสิทธิ์เข้าถึงข้อมูลโฆษณาที่ต้องใช้ กรุณาตรวจสิทธิ์และบัญชีโฆษณา'
  }
  if (lower.includes('unsupported get request') || lower.includes('object does not exist')) {
    return 'Meta ไม่พบรายการนี้ หรือบัญชีที่เชื่อมต่อยังไม่มีสิทธิ์อ่านข้อมูล กรุณาตรวจบัญชีโฆษณาแล้วลองโหลดข้อมูลอีกครั้ง'
  }
  return message
}

function renderPersistenceLabel(result?: MetaConfigResponse['renderPersistence']) {
  if (!result) return ''
  if (!result.enabled) return ' · บันทึกในเครื่องนี้แล้ว แต่ยังไม่ได้เปิดการบันทึกสำหรับระบบออนไลน์'
  const failed = result.updated?.find((item) => !item.ok)
  return failed ? ` · ระบบออนไลน์อัปเดตบางส่วนไม่สำเร็จ (${failed.key})` : ' · พร้อมใช้กับระบบออนไลน์แล้ว'
}

function deliveryLabel(status: 'active' | 'paused') {
  return status === 'active' ? 'เปิดอยู่' : 'หยุดอยู่'
}

function deliveryTone(status: 'active' | 'paused'): Tone {
  return status === 'active' ? 'good' : 'neutral'
}

function nextDeliveryStatus(status: 'active' | 'paused'): 'ACTIVE' | 'PAUSED' {
  return status === 'active' ? 'PAUSED' : 'ACTIVE'
}

function objectTypeLabel(type: AdsObjectType) {
  if (type === 'campaign') return 'แคมเปญ'
  if (type === 'adset') return 'ชุดโฆษณา'
  return 'โฆษณา'
}

function syncStateLabel(state: string) {
  const labels: Record<string, string> = {
    'Checking Meta API': 'กำลังตรวจการเชื่อมต่อ',
    'Syncing...': 'กำลังโหลดข้อมูล...',
    'Setup required': 'ต้องตั้งค่าก่อน',
    'Sync error': 'โหลดข้อมูลไม่สำเร็จ',
    'Live Meta API': 'เชื่อมต่อแล้ว',
    'No data': 'ไม่มีข้อมูล',
  }
  return labels[state] ?? state
}

function actionStateLabel(state: ActionState | string) {
  const labels: Record<string, string> = {
    Suggested: 'แนะนำ',
    'Pending approval': 'รออนุมัติ',
    Approved: 'อนุมัติแล้ว',
    Executing: 'กำลังดำเนินการ',
    Executed: 'ดำเนินการแล้ว',
    Failed: 'ล้มเหลว',
    Rejected: 'ปฏิเสธแล้ว',
    Audited: 'บันทึก audit แล้ว',
    'Confirming scope': 'ยืนยันขอบเขต',
    'Executed or Failed': 'สำเร็จหรือไม่สำเร็จ',
  }
  return labels[state] ?? state
}

function riskLabel(risk: Recommendation['risk']) {
  if (risk === 'High') return 'ความเสี่ยงสูง'
  if (risk === 'Medium') return 'ความเสี่ยงกลาง'
  return 'ความเสี่ยงต่ำ'
}

function recommendationTypeLabel(type: string) {
  const normalized = type.toLowerCase()
  if (normalized.includes('tracking') || normalized.includes('budget protection')) return 'ป้องกันงบและตรวจ Tracking'
  if (normalized.includes('scale')) return 'โอกาส Scale'
  if (normalized.includes('creative')) return 'รีเฟรชครีเอทีฟ'
  return type
}

function recommendationActionLabel(text: string) {
  const normalized = text.toLowerCase()
  if (normalized.includes('pause campaign')) return 'พักแคมเปญ'
  if (normalized.includes('pause or reduce')) return 'พักหรือลดงบจนกว่าจะตรวจ tracking และ offer แล้ว'
  if (normalized.includes('reduce budget')) return 'ลดงบ 10-15% และทดสอบข้อเสนอหรือครีเอทีฟใหม่'
  if (normalized.includes('increase budget')) return 'เพิ่มงบ 10-15% พร้อมติดตามผลรายวัน'
  if (normalized.includes('create new creative')) return 'สร้างมุมขายใหม่และพักโฆษณาที่ผลงานต่ำ'
  return text
}

function cleanRecommendationCopy(text: string) {
  return text
    .replace('Action นี้ยังเป็น approval recommendation จนกว่าจะเปิด Meta write execution', 'ตรวจข้อมูลล่าสุดก่อนดำเนินการ')
    .replace('หากเปิด write execution ต้องบันทึก previous status/budget ก่อนเปลี่ยนทุกครั้ง', 'หลังดำเนินการให้โหลดข้อมูลใหม่ และย้อนกลับจาก Ads Manager ได้หากผลลัพธ์ไม่ดีขึ้น')
    .replaceAll('Meta write execution', 'การดำเนินการ')
    .replaceAll('write execution', 'การดำเนินการ')
    .replaceAll('ส่งคำสั่งไป Meta', 'ส่งคำสั่ง')
    .replaceAll('ใน Meta', 'ในบัญชีโฆษณา')
    .replaceAll('ไป Meta', 'ไปบัญชีโฆษณา')
    .replaceAll('approval recommendation', 'คำแนะนำ')
    .replaceAll('previous status/budget', 'สถานะหรืองบเดิม')
    .replaceAll('guardrail', 'เกณฑ์')
    .replaceAll('controlled relaunch/test', 'ทดสอบเปิดแบบค่อยเป็นค่อยไป')
    .replaceAll('controlled relaunch', 'ทดสอบเปิดแบบค่อยเป็นค่อยไป')
    .replaceAll('historical evidence', 'หลักฐานผลงานย้อนหลัง')
    .replaceAll('diagnosis note', 'บันทึกการตรวจสาเหตุ')
    .replaceAll('diagnosis', 'ตรวจสาเหตุ')
    .replaceAll('baseline', 'เกณฑ์เดิม')
    .replaceAll('monitor', 'ติดตามผล')
    .replaceAll('action', 'รายการ')
    .replaceAll('Action', 'รายการ')
}

function campaignStatusLabel(status: Campaign['status']) {
  if (status === 'Active') return 'ปกติ'
  if (status === 'Watch') return 'เฝ้าดู'
  return 'วิกฤต'
}

function aiStatusLabel(status: CampaignInsight['aiStatus'] | undefined) {
  if (status === 'critical') return 'วิกฤต'
  if (status === 'watch') return 'เฝ้าดู'
  if (status === 'scaling') return 'กำลังขยายผล'
  return 'แข็งแรง'
}

function complianceStatusLabel(status: WorkspaceData['complianceReviews'][number]['status']) {
  if (status === 'blocked') return 'ถูกบล็อก'
  if (status === 'needsReview') return 'ต้องรีวิว'
  return 'ผ่านแล้ว'
}

function mutationStatusLabel(status: string) {
  if (status === 'ACTIVE') return 'เปิดใช้งาน'
  if (status === 'PAUSED') return 'หยุดใช้งาน'
  if (status === 'Deleted') return 'ลบแล้ว'
  return status
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function autoAdDecisionLabel(decision: AutoAdDecision) {
  if (decision === 'pause') return 'ควรปิด'
  if (decision === 'activate') return 'ควรเปิดกลับ'
  if (decision === 'keep') return 'เปิดต่อ'
  return 'เฝ้าดู'
}

function shortMetaId(id: string) {
  return id.length > 10 ? `...${id.slice(-8)}` : id
}

function campaignDomId(campaignId: string) {
  return `campaign-row-${campaignId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function toneForAiStatus(status: CampaignInsight['aiStatus'] | undefined): Tone {
  if (status === 'critical') return 'critical'
  if (status === 'watch') return 'watch'
  if (status === 'scaling') return 'info'
  return 'good'
}

function mapMetaCampaign(campaign: CampaignInsight): Campaign {
  const tone = toneForAiStatus(campaign.aiStatus)
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.deliveryStatus === 'paused' || campaign.aiStatus === 'critical' ? 'Critical' : campaign.aiStatus === 'watch' ? 'Watch' : 'Active',
    deliveryStatus: campaign.deliveryStatus,
    budget: campaign.budget,
    spend: campaign.spend,
    revenue: campaign.revenue,
    conversions: campaign.conversions,
    cpa: campaign.cpa,
    roas: campaign.roas,
    frequency: campaign.frequency,
    ctr: campaign.ctr,
    aiTag: campaign.aiStatus === 'scaling' ? 'Scale' : campaign.aiStatus === 'critical' ? 'Pause' : campaign.aiStatus === 'watch' ? 'Watch' : 'Healthy',
    tone,
  }
}

function mapMetaRecommendation(action: MetaRecommendedAction): Recommendation {
  return {
    id: action.id,
    title: recommendationTypeLabel(action.type),
    evidence: cleanRecommendationCopy(action.summary),
    risk: action.risk,
    confidence: action.confidence,
    guardrail: cleanRecommendationCopy(action.guardrail),
    impact: cleanRecommendationCopy(`${action.before}. หลังทำ: ${recommendationActionLabel(action.after)}. ${action.rollbackNote}`),
    action: recommendationActionLabel(action.execution?.label ?? action.after),
    campaignId: action.campaignId,
    targetName: action.target,
    source: action.source,
    requiresApproval: action.requiresApproval,
    execution: action.execution,
  }
}

type PlanExecutionTarget = {
  objectType: AdsObjectType
  objectId: string
  objectName: string
  deliveryStatus: 'active' | 'paused'
}

const PLAN_PAUSE_PATTERNS = [
  'pause campaign',
  'pause',
  'paused',
  'หยุดใช้งาน',
  'หยุดโฆษณา',
  'หยุดแคมเปญ',
  'ปิดแคมเปญ',
  'ปิดชุดโฆษณา',
  'ปิดโฆษณา',
  'ห้ามเปิด',
  'ไม่เปิด',
]

const PLAN_NO_WRITE_STATUS_PATTERNS = [
  'keep paused',
  'keep active',
  'คงสถานะพัก',
  'คงสถานะเปิด',
  'พักอยู่แล้ว',
  'เปิดอยู่แล้ว',
  'ตรวจสาเหตุก่อนเปิดกลับ',
  'ก่อนเปิดกลับ',
]

const PLAN_ACTIVATE_PATTERNS = [
  'activate campaign',
  'activate',
  'enable campaign',
  'enable',
  'relaunch',
  'controlled relaunch',
  'เปิดใช้งาน',
  'เปิดกลับ',
  'เปิดแคมเปญ',
  'เปิดชุดโฆษณา',
  'เปิดโฆษณา',
  'ทดสอบเปิด',
]

const PLAN_ACTIVATE_BLOCKERS = ['ห้ามเปิด', 'ไม่เปิด', 'ยังไม่เปิด', 'ก่อนเปิด', 'รอก่อนเปิด', 'keep paused', 'คงสถานะพัก']

function hasAnyPattern(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern))
}

function namesMatch(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function inferPlanMetaStatus(recommendation: Recommendation): 'ACTIVE' | 'PAUSED' | null {
  const text = [
    recommendation.title,
    recommendation.action,
    recommendation.targetName,
  ].join(' ').toLowerCase()

  if (hasAnyPattern(text, PLAN_NO_WRITE_STATUS_PATTERNS)) return null
  if (hasAnyPattern(text, PLAN_PAUSE_PATTERNS)) return 'PAUSED'
  if (hasAnyPattern(text, PLAN_ACTIVATE_PATTERNS) && !hasAnyPattern(text, PLAN_ACTIVATE_BLOCKERS)) return 'ACTIVE'
  return null
}

function findPlanExecutionTarget(recommendation: Recommendation, workspace: WorkspaceData | null): PlanExecutionTarget | null {
  if (!workspace) return null

  const targetId = recommendation.campaignId ?? ''
  const targetName = recommendation.targetName ?? ''

  if (targetName) {
    const namedAd = workspace.adInsights.find((ad) => namesMatch(ad.name, targetName))
    if (namedAd) {
      return { objectType: 'ad', objectId: namedAd.id, objectName: namedAd.name, deliveryStatus: namedAd.status }
    }

    const namedAdSet = workspace.adSets.find((adSet) => namesMatch(adSet.name, targetName))
    if (namedAdSet) {
      return { objectType: 'adset', objectId: namedAdSet.id, objectName: namedAdSet.name, deliveryStatus: namedAdSet.deliveryStatus }
    }

    const namedCampaign = workspace.campaigns.find((campaign) => namesMatch(campaign.name, targetName))
    if (namedCampaign) {
      return { objectType: 'campaign', objectId: namedCampaign.id, objectName: namedCampaign.name, deliveryStatus: namedCampaign.deliveryStatus }
    }
  }

  const campaign = workspace.campaigns.find((item) => item.id === targetId)
  if (campaign) return { objectType: 'campaign', objectId: campaign.id, objectName: campaign.name, deliveryStatus: campaign.deliveryStatus }

  const adSet = workspace.adSets.find((item) => item.id === targetId)
  if (adSet) return { objectType: 'adset', objectId: adSet.id, objectName: adSet.name, deliveryStatus: adSet.deliveryStatus }

  const ad = workspace.adInsights.find((item) => item.id === targetId)
  if (ad) return { objectType: 'ad', objectId: ad.id, objectName: ad.name, deliveryStatus: ad.status }

  return null
}

function findExecutionTarget(execution: NonNullable<Recommendation['execution']>, workspace: WorkspaceData | null): PlanExecutionTarget | null {
  if (!workspace || !execution.status) return null

  if (execution.objectType === 'campaign') {
    const campaign = workspace.campaigns.find((item) => item.id === execution.objectId)
    return campaign ? { objectType: 'campaign', objectId: campaign.id, objectName: campaign.name, deliveryStatus: campaign.deliveryStatus } : null
  }

  if (execution.objectType === 'adset') {
    const adSet = workspace.adSets.find((item) => item.id === execution.objectId)
    return adSet ? { objectType: 'adset', objectId: adSet.id, objectName: adSet.name, deliveryStatus: adSet.deliveryStatus } : null
  }

  if (execution.objectType === 'ad') {
    const ad = workspace.adInsights.find((item) => item.id === execution.objectId)
    return ad ? { objectType: 'ad', objectId: ad.id, objectName: ad.name, deliveryStatus: ad.status } : null
  }

  return null
}

function statusAlreadyMatches(status: 'ACTIVE' | 'PAUSED', target: PlanExecutionTarget) {
  return (status === 'ACTIVE' && target.deliveryStatus === 'active') || (status === 'PAUSED' && target.deliveryStatus === 'paused')
}

function resolvePlanExecution(recommendation: Recommendation, workspace: WorkspaceData | null): Recommendation['execution'] | undefined {
  if (recommendation.execution) {
    const explicitTarget = findExecutionTarget(recommendation.execution, workspace)
    if (recommendation.execution.status && explicitTarget && statusAlreadyMatches(recommendation.execution.status, explicitTarget)) return undefined
    return recommendation.execution
  }

  const status = inferPlanMetaStatus(recommendation)
  const target = findPlanExecutionTarget(recommendation, workspace)
  if (!status || !target) return undefined

  const objectLabel = objectTypeLabel(target.objectType)
  const alreadySameStatus = statusAlreadyMatches(status, target)
  if (alreadySameStatus) return undefined
  const statusLabel =
    status === 'ACTIVE'
      ? `เปิดใช้งาน${objectLabel}`
      : `พัก${objectLabel}`

  return {
    endpoint: '/api/meta/object-status',
    method: 'POST',
    objectType: target.objectType,
    objectId: target.objectId,
    status,
    label: `${statusLabel}: ${target.objectName}`,
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function withResolvedPlanExecution(recommendation: Recommendation, workspace: WorkspaceData | null): Recommendation {
  const execution = resolvePlanExecution(recommendation, workspace)
  if (!execution && recommendation.execution) {
    const withoutExecution = { ...recommendation }
    delete withoutExecution.execution
    return withoutExecution
  }
  return execution && execution !== recommendation.execution ? { ...recommendation, execution } : recommendation
}

function buildPlanExecutionSteps(recommendation: Recommendation) {
  const executionStep = recommendation.execution
    ? `ส่งคำสั่ง: ${recommendation.execution.label}`
    : `ดำเนินการหลัก: ${recommendation.action}`

  return [
    `ตรวจข้อมูลก่อนทำ: ${recommendation.evidence}`,
    executionStep,
    `เช็กเกณฑ์ควบคุม: ${recommendation.guardrail}`,
    `บันทึกผลที่คาดหวัง/สิ่งที่ต้องตามต่อ: ${recommendation.impact}`,
  ].map(cleanRecommendationCopy)
}

function buildSummaryFromWorkspace(workspace: WorkspaceData | null, campaignList: Campaign[]): Summary {
  if (!workspace) {
    return {
      spend: 0,
      budget: 0,
      revenue: 0,
      leads: 0,
      bookings: 0,
      paidTreatments: 0,
      roas: 0,
      cpa: 0,
      cac: 0,
      aov: 0,
    }
  }

  const channel = workspace.channelPerformance[0]
  const spend = channel?.spend ?? campaignList.reduce((sum, campaign) => sum + campaign.spend, 0)
  const revenue = channel?.revenue ?? campaignList.reduce((sum, campaign) => sum + campaign.revenue, 0)
  const leads = channel?.leads ?? 0
  const bookings = channel?.bookings ?? campaignList.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const paidTreatments = channel?.treatments ?? 0

  return {
    spend,
    budget: campaignList.reduce((sum, campaign) => sum + campaign.budget, 0),
    revenue,
    leads,
    bookings,
    paidTreatments,
    roas: spend > 0 ? revenue / spend : 0,
    cpa: bookings > 0 ? spend / bookings : 0,
    cac: paidTreatments > 0 ? spend / paidTreatments : 0,
    aov: paidTreatments > 0 ? revenue / paidTreatments : 0,
  }
}

function buildPageScopedWorkspace(
  workspace: WorkspaceData | null,
  pageInsight: SharedAdsInsightForPage | null,
  selectedPage: ManagedPage | undefined,
  isScoped: boolean,
): WorkspaceData | null {
  if (!workspace || !isScoped) return workspace
  if (!pageInsight) return emptyScopedWorkspace(workspace)

  const campaignIds = new Set(pageInsight.scope.campaignIds)
  const adSetIds = new Set(pageInsight.scope.adSetIds)
  const adIds = new Set(pageInsight.scope.adIds)
  const campaigns = workspace.campaigns.filter((campaign) => campaignIds.has(campaign.id))
  const adSets = workspace.adSets.filter((adSet) => campaignIds.has(adSet.campaignId) || adSetIds.has(adSet.id))
  const adInsights = workspace.adInsights.filter((ad) => adIds.has(ad.id) || adSetIds.has(ad.adSetId) || campaignIds.has(ad.campaignId))
  const autoAds = workspace.autoAds.filter((ad) => adIds.has(ad.adId) || campaignIds.has(ad.campaignId))
  const metrics = pageInsight.metrics
  const spend = finiteOrZero(metrics.spend) || adInsights.reduce((sum, ad) => sum + finiteOrZero(ad.spend), 0)
  const revenue = finiteOrZero(metrics.revenue) || campaigns.reduce((sum, campaign) => sum + finiteOrZero(campaign.revenue), 0)
  const leads = finiteOrZero(metrics.leads) || adInsights.reduce((sum, ad) => sum + finiteOrZero(ad.leads), 0)
  const bookings = finiteOrZero(metrics.bookings) || adInsights.reduce((sum, ad) => sum + finiteOrZero(ad.bookings), 0)
  const impressions = adInsights.reduce((sum, ad) => sum + finiteOrZero(ad.impressions), 0)
  const clicks = adInsights.reduce((sum, ad) => sum + finiteOrZero(ad.clicks), 0)
  const channelLabel = selectedPage?.name || pageInsight.scope.pageName || 'Page ที่เลือก'

  return {
    ...workspace,
    actions: workspace.actions.filter((action) => action.campaignId && campaignIds.has(action.campaignId)),
    adInsights,
    adSets,
    auditTrail: [],
    autoAds,
    campaigns,
    channelPerformance: [
      {
        bookings,
        channel: channelLabel,
        clicks,
        firstTimePatients: 0,
        impressions,
        leadQuality: 0,
        leads,
        reach: selectedPage?.reach ?? 0,
        revenue,
        showUps: 0,
        spend,
        treatments: 0,
      },
    ],
    complianceReviews: workspace.complianceReviews.filter((review) => review.campaignId && campaignIds.has(review.campaignId)),
    funnelMetrics: buildScopedFunnelMetrics({ bookings, clicks, impressions, leads }),
    insightComponents: workspace.insightComponents.filter((component) => campaignIds.has(component.campaignId)),
    insights: workspace.insights.filter((insight) => campaignIds.has(insight.campaignId)),
    memoryItems: [],
    serviceLines: [],
    tasks: [],
    trendData: [],
  }
}

function emptyScopedWorkspace(workspace: WorkspaceData): WorkspaceData {
  return {
    ...workspace,
    actions: [],
    adInsights: [],
    adSets: [],
    auditTrail: [],
    autoAds: [],
    campaigns: [],
    channelPerformance: [],
    complianceReviews: [],
    funnelMetrics: [],
    insightComponents: [],
    insights: [],
    memoryItems: [],
    serviceLines: [],
    tasks: [],
    trendData: [],
  }
}

function buildScopedFunnelMetrics({
  bookings,
  clicks,
  impressions,
  leads,
}: {
  bookings: number
  clicks: number
  impressions: number
  leads: number
}): MetaFunnelMetric[] {
  const stages = [
    { stage: 'Impressions', count: impressions },
    { stage: 'Clicks', count: clicks },
    { stage: 'Leads', count: leads },
    { stage: 'Bookings', count: bookings },
  ]
  if (stages.every((stage) => stage.count <= 0)) return []

  return stages.map((stage, index) => {
    const previous = stages[index - 1]
    const conversionRate = !previous ? 100 : previous.count > 0 ? (stage.count / previous.count) * 100 : 0
    return {
      benchmark: 'Page ที่เลือก',
      conversionRate,
      count: stage.count,
      dropOffRate: !previous ? 0 : Math.max(0, 100 - conversionRate),
      help: 'คำนวณจากโฆษณาที่จับคู่กับ Page นี้',
      stage: stage.stage,
    }
  })
}

function finiteOrZero(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function mapTrendData(points: TrendPoint[]): TrendDatum[] {
  if (!points.length) return []
  return points.slice(-12).map((point, index) => ({
    bookings: point.bookings,
    clicks: point.clicks,
    date: point.date,
    day: formatTrendDay(point.date, index),
    impressions: point.impressions,
    leads: point.leads,
    revenue: Math.round(point.revenue),
    spend: Math.round(point.spend),
    treatments: point.treatments,
  }))
}

function formatTrendDay(date: string, index: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (match) return `${match[2]}-${match[3]}`
  return date && date !== '-' ? date : String(index + 1)
}

function buildWebsiteContext({
  activeTab,
  apiMessage,
  campaigns,
  dataState,
  datePreset,
  selectedCampaignId,
  workspace,
}: {
  activeTab: TabId
  apiMessage: string
  campaigns: Campaign[]
  dataState: DataSourceState
  datePreset: string
  selectedCampaignId: string
  workspace: WorkspaceData | null
}): WebsiteContext {
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId)
  const campaignRows: WebsiteContext['visibleTableRows'] = campaigns.slice(0, 10).map((campaign) => ({
    objectType: 'campaign',
    objectId: campaign.id,
    title: campaign.name,
    visibleMetrics: {
      spend: campaign.spend,
      roas: Number(campaign.roas.toFixed(2)),
      cpa: Math.round(campaign.cpa),
      ctr: Number(campaign.ctr.toFixed(2)),
      conversions: campaign.conversions,
    },
  }))
  const adRows: WebsiteContext['visibleTableRows'] = (workspace?.adInsights ?? []).slice(0, 10).map((ad) => ({
    objectType: 'ad',
    objectId: ad.id,
    title: ad.name,
    visibleMetrics: {
      spend: ad.spend,
      roas: Number(ad.roas.toFixed(2)),
      ctr: Number(ad.ctr.toFixed(2)),
      bookings: ad.bookings,
      score: Number(ad.score.toFixed(1)),
    },
  }))

  return {
    route: typeof window === 'undefined' ? '/' : window.location.pathname,
    activeTab,
    datePreset,
    dataState: dataState === 'setup-required' ? 'unknown' : dataState,
    ...(selectedCampaignId ? { selectedCampaignId } : {}),
    visibleCards: visibleCardsForTab(activeTab, selectedCampaign?.name),
    visibleTableRows: [...campaignRows, ...adRows].slice(0, 20),
    ...(dataState === 'error' ? { lastError: apiMessage } : {}),
    capturedAt: new Date().toISOString(),
  }
}

function visibleCardsForTab(activeTab: TabId, selectedCampaignName?: string) {
  const cards: Record<TabId, string[]> = {
    ads: ['ตัวจัดการโฆษณา', 'แคมเปญที่เลือก', selectedCampaignName ? `เลือก: ${selectedCampaignName}` : 'ยังไม่ได้เลือกแคมเปญ'],
    analytics: ['Ads Dashboard', 'Impressions', 'Clicks', 'Conversions', 'Cost', 'Performance Overview', 'Top Campaigns', 'PMC Insights'],
    audience: ['กลุ่มเป้าหมาย', 'ปริมาณของกลุ่มเป้าหมาย'],
    creative: ['Automation Ads', 'workflow โฆษณาอัตโนมัติ'],
    help: ['ศูนย์ช่วยเหลือ', 'Playbook'],
    library: ['คลังโฆษณา', 'ความเสี่ยงของข้อความ'],
    marketer: ['Insights', 'สรุปล่าสุดจาก AI', 'ตัวเลขสำคัญ', 'คำแนะนำที่ควรตรวจ'],
    optimization: ['Optimizer & Automation', 'บอร์ดตัดสินใจ', 'คิวคำสั่ง Auto Ads'],
    reports: ['ตัวสร้างรายงาน', 'รายงานฉบับร่าง'],
    settings: ['ตั้งค่าบัญชีโฆษณา', 'สถานะการเชื่อมต่อ'],
  }
  return cards[activeTab]
}

function toneForRisk(risk: Recommendation['risk']): Tone {
  if (risk === 'High') return 'critical'
  if (risk === 'Medium') return 'watch'
  return 'good'
}

function PmcAdsAgentApp() {
  const shellRef = useRef<HTMLDivElement>(null)
  const refreshRequestRef = useRef(0)
  const activeMetaWorkspaceRef = useRef<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('analytics')
  const [activeToolbarKey, setActiveToolbarKey] = useState('dashboard')
  const [datePreset, setDatePreset] = useState('ข้อมูลทั้งหมด')
  const [automationMode, setAutomationMode] = useState<AutomationMode>('พัก automation')
  const [pendingAutomationMode, setPendingAutomationMode] = useState<AutomationMode | null>(null)
  const [syncState, setSyncState] = useState('Checking Meta API')
  const [dataState, setDataState] = useState<DataSourceState>('loading')
  const [apiMessage, setApiMessage] = useState('กำลังตรวจการเชื่อมต่อบัญชีโฆษณา')
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [metaInfo, setMetaInfo] = useState<MetaInfo | null>(null)
  const [managedPages, setManagedPages] = useState<ManagedPage[]>([])
  const [pageScopeState, setPageScopeState] = useState<PageScopeLoadState>('idle')
  const [selectedPageId, setSelectedPageId] = useState(ALL_PAGE_SCOPE_ID)
  const [pageAdsInsight, setPageAdsInsight] = useState<SharedAdsInsightForPage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [recommendationStates, setRecommendationStates] = useState<Record<string, ActionState>>({})
  const [brainApprovalActions, setBrainApprovalActions] = useState<MetaRecommendedAction[]>([])
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [executingRecommendationId, setExecutingRecommendationId] = useState<string | null>(null)
  const [activePlanExecution, setActivePlanExecution] = useState<PlanExecutionDraft | null>(null)
  const [executingPlanId, setExecutingPlanId] = useState<string | null>(null)
  const [planExecutionError, setPlanExecutionError] = useState('')
  const [, setAuditTrail] = useState<AuditEvent[]>([])
  const [preparedReport, setPreparedReport] = useState(false)
  const [mascotNotice, setMascotNotice] = useState<MascotNotice | null>(null)

  const pageSelectorOptions = useMemo(() => buildAdsPageSelectorOptions(managedPages, metaInfo), [managedPages, metaInfo])
  const selectedPageExists = selectedPageId === ALL_PAGE_SCOPE_ID || pageSelectorOptions.some((option) => option.id === selectedPageId)
  const effectiveSelectedPageId = selectedPageExists ? selectedPageId : ALL_PAGE_SCOPE_ID
  const selectedManagedPage = managedPages.find((page) => page.id === effectiveSelectedPageId)
  const isPageScoped = effectiveSelectedPageId !== ALL_PAGE_SCOPE_ID && Boolean(selectedManagedPage)
  const dateScopedWorkspace = useMemo(() => scopeWorkspaceByDatePreset(workspace, datePreset), [datePreset, workspace])
  const visibleWorkspace = useMemo(
    () => buildPageScopedWorkspace(dateScopedWorkspace, pageAdsInsight, selectedManagedPage, isPageScoped),
    [dateScopedWorkspace, isPageScoped, pageAdsInsight, selectedManagedPage],
  )
  const displayCampaigns = useMemo(() => (visibleWorkspace ? visibleWorkspace.campaigns.map(mapMetaCampaign) : []), [visibleWorkspace])
  const activeRecommendations = useMemo(
    () => brainApprovalActions.slice(0, 4).map(mapMetaRecommendation),
    [brainApprovalActions],
  )
  const filteredCampaigns = displayCampaigns.filter((campaign) => campaign.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const effectiveSelectedCampaignId = displayCampaigns.some((campaign) => campaign.id === selectedCampaignId) ? selectedCampaignId : displayCampaigns[0]?.id ?? ''
  const summary = useMemo(() => buildSummaryFromWorkspace(visibleWorkspace, displayCampaigns), [displayCampaigns, visibleWorkspace])
  const trendPoints = useMemo(() => mapTrendData(visibleWorkspace?.trendData ?? []), [visibleWorkspace])
  const funnelMetrics = visibleWorkspace?.funnelMetrics ?? []
  const confirmingRecommendation = confirmingId ? activeRecommendations.find((item) => item.id === confirmingId) : undefined
  const isPageLoading = dataState === 'loading' && activeTab !== 'analytics'
  const websiteContext = useMemo(
    () =>
      buildWebsiteContext({
        activeTab,
        apiMessage,
        campaigns: filteredCampaigns,
        dataState,
        datePreset,
        selectedCampaignId: effectiveSelectedCampaignId,
        workspace: visibleWorkspace,
      }),
    [activeTab, apiMessage, dataState, datePreset, effectiveSelectedCampaignId, filteredCampaigns, visibleWorkspace],
  )

  const appendAudit = useCallback((event: Omit<AuditEvent, 'id' | 'time'>) => {
    const nextEvent: AuditEvent = {
      ...event,
      id: `audit-${Date.now()}`,
      time: 'ตอนนี้',
    }
    setAuditTrail((current) => [nextEvent, ...current].slice(0, 8))
  }, [])

  const showMascotNotice = useCallback((message: string, tone: Tone = 'info') => {
    setMascotNotice({
      id: Date.now(),
      message,
      tone,
    })
  }, [])

  const requestAutomationModeChange = useCallback((value: string) => {
    const nextMode = normalizeAutomationMode(value)
    const currentMode = normalizeAutomationMode(automationMode)
    if (nextMode === currentMode) {
      if (automationMode !== currentMode) setAutomationMode(currentMode)
      return
    }
    showMascotNotice(nextMode === 'ต้องอนุมัติก่อน' ? 'กำลังรอยืนยันเปิด Auto ครับ' : 'กำลังรอยืนยันปิด Auto ครับ', nextMode === 'ต้องอนุมัติก่อน' ? 'good' : 'watch')
    setPendingAutomationMode(nextMode)
  }, [automationMode, showMascotNotice])

  const confirmAutomationModeChange = useCallback(() => {
    if (!pendingAutomationMode) return
    const isTurningOn = pendingAutomationMode === 'ต้องอนุมัติก่อน'
    setAutomationMode(pendingAutomationMode)
    showMascotNotice(isTurningOn ? 'เปิด Auto แล้ว แต่ยังต้องยืนยันก่อนส่งคำสั่งทุกครั้ง' : 'ปิด Auto แล้ว ผมจะเฝ้าดูและแจ้งเตือนให้', isTurningOn ? 'good' : 'watch')
    appendAudit({
      action: isTurningOn ? 'เปิด Auto แล้ว' : 'ปิด Auto แล้ว',
      detail: isTurningOn
        ? 'ระบบพร้อมเตรียมคำสั่ง แต่ยังต้องยืนยันก่อนส่งจริงทุกครั้ง'
        : 'ระบบหยุดการดำเนินการ Auto และจะแสดงคำแนะนำเพื่อรีวิวเท่านั้น',
      actor: 'ผู้ใช้งาน',
      tone: isTurningOn ? 'good' : 'watch',
    })
    setPendingAutomationMode(null)
  }, [appendAudit, pendingAutomationMode, showMascotNotice])

  const queueBrainAction = useCallback((action: MetaRecommendedAction) => {
    setBrainApprovalActions((current) => [action, ...current.filter((item) => item.id !== action.id)])
    setRecommendationStates((current) => ({ ...current, [action.id]: current[action.id] ?? 'Suggested' }))
    setConfirmingId(action.id)
    showMascotNotice('Insights ส่งแผนให้ตรวจแล้วครับ', toneForRisk(action.risk))
    appendAudit({
      action: 'เปิดแผนจาก Insights',
      detail: `${action.target} · ${action.summary}`,
      actor: 'ผู้ใช้งาน',
      tone: 'info',
    })
  }, [appendAudit, showMascotNotice])

  const openBrainPlanExecution = useCallback((action: MetaRecommendedAction) => {
    const recommendation = withResolvedPlanExecution(mapMetaRecommendation(action), workspace)
    const state = recommendationStates[action.id]
    setPlanExecutionError('')
    setActivePlanExecution({
      recommendation,
      status: state === 'Executing' ? 'running' : 'ready',
      steps: buildPlanExecutionSteps(recommendation),
    })
  }, [recommendationStates, workspace])

  const refreshWorkspace = useCallback(async (source: 'auto' | 'manual' | 'execution' = 'manual') => {
    const requestId = refreshRequestRef.current + 1
    refreshRequestRef.current = requestId
    const isLatestRequest = () => requestId === refreshRequestRef.current

    setSyncState('Syncing...')
    setDataState('loading')

    try {
      const status = await apiJson<MetaStatusResponse>('/api/meta/status')
      if (!isLatestRequest()) return

      if (!status.configured) {
        setWorkspace(null)
        setMetaInfo({
          accountName: 'ยังไม่ได้ตั้งค่าบัญชีโฆษณา',
          adAccountId: status.adAccountId ?? null,
          activeWorkspaceId: status.activeWorkspaceId ?? null,
          workspaceLabel: status.workspaceLabel ?? null,
          workspaces: status.workspaces ?? [],
          fetchedAt: new Date().toISOString(),
          graphVersion: status.graphVersion ?? 'v21.0',
          source: status.source ?? 'Meta Marketing API',
          settingsSource: status.settingsSource ?? null,
          tokenLocation: status.tokenLocation ?? null,
        })
        activeMetaWorkspaceRef.current = null
        setDataState('setup-required')
        setSyncState('Setup required')
        setApiMessage('เพิ่มข้อมูลเชื่อมต่อบัญชีโฆษณาหรือบันทึกข้อมูลผ่านหน้า Settings')
        showMascotNotice('ยังไม่ได้ตั้งค่าบัญชีโฆษณา ไปหน้า Settings ก่อนครับ', 'watch')
        return
      }
      if (!status.connected) {
        const failedCheck = status.connection?.checks?.find((check) => check.status === 'fail')
        setWorkspace(null)
        setMetaInfo({
          accountName: 'เชื่อมต่อบัญชีโฆษณาไม่สำเร็จ',
          adAccountId: status.adAccountId ?? null,
          activeWorkspaceId: status.activeWorkspaceId ?? null,
          workspaceLabel: status.workspaceLabel ?? null,
          workspaces: status.workspaces ?? [],
          fetchedAt: new Date().toISOString(),
          graphVersion: status.graphVersion ?? 'v21.0',
          source: status.source ?? 'Meta Marketing API',
          settingsSource: status.settingsSource ?? null,
          tokenLocation: status.tokenLocation ?? null,
        })
        setDataState('error')
        setSyncState('Sync error')
        setApiMessage(formatApiMessage(failedCheck?.detail ?? 'ตั้งค่าข้อมูลเชื่อมต่อแล้ว แต่ยังตรวจบัญชีโฆษณาไม่ผ่าน'))
        showMascotNotice('เชื่อมต่อบัญชีโฆษณาไม่ผ่าน ตรวจข้อมูลเชื่อมต่อหรือสิทธิ์ก่อนครับ', 'critical')
        return
      }

      const datePresetParam = DEFAULT_META_WORKSPACE_DATE_PRESET
      const result = await apiJson<MetaWorkspaceResponse>(`/api/meta/workspace?datePreset=${encodeURIComponent(datePresetParam)}`)
      if (!isLatestRequest()) return

      const nextMetaInfo: MetaInfo = {
        accountName: result.meta.account?.name || result.meta.workspaceLabel || status.workspaceLabel || 'บัญชีโฆษณา Meta',
        adAccountId: status.adAccountId ?? result.meta.account?.account_id ?? null,
        activeWorkspaceId: status.activeWorkspaceId ?? result.meta.activeWorkspaceId ?? null,
        workspaceLabel: result.meta.workspaceLabel ?? status.workspaceLabel ?? null,
        workspaces: status.workspaces ?? [],
        counts: result.meta.counts,
        fetchedAt: result.meta.fetchedAt,
        graphVersion: result.meta.graphVersion,
        source: result.meta.source,
        settingsSource: status.settingsSource ?? null,
        tokenLocation: status.tokenLocation ?? null,
      }
      const nextDataState: DataSourceState = result.workspace.campaigns.length ? 'live' : 'empty'
      const nextSyncState = result.workspace.campaigns.length ? 'Live Meta API' : 'No data'
      const nextApiMessage = result.workspace.campaigns.length
        ? `โหลดข้อมูลแคมเปญแล้ว ${result.meta.counts?.campaigns ?? 0} รายการ`
        : 'เชื่อมต่อบัญชีโฆษณาแล้ว แต่ช่วงวันที่นี้ยังไม่มีแคมเปญ'

      setWorkspace(result.workspace)
      setMetaInfo(nextMetaInfo)
      if (activeMetaWorkspaceRef.current && nextMetaInfo.activeWorkspaceId && activeMetaWorkspaceRef.current !== nextMetaInfo.activeWorkspaceId) {
        setSelectedCampaignId('')
        setBrainApprovalActions([])
        setRecommendationStates({})
        setConfirmingId(null)
        setActivePlanExecution(null)
      }
      activeMetaWorkspaceRef.current = nextMetaInfo.activeWorkspaceId ?? null
      setDataState(nextDataState)
      setSyncState(nextSyncState)
      setApiMessage(nextApiMessage)
      if (source !== 'auto') {
        showMascotNotice(source === 'execution' ? 'อัปเดตบัญชีโฆษณาแล้ว โหลดผลล่าสุดกลับมาเรียบร้อย' : `โหลดข้อมูลล่าสุดแล้ว ${result.meta.counts?.campaigns ?? 0} แคมเปญ`, 'good')
        appendAudit({
          action: source === 'execution' ? 'โหลดข้อมูลหลังดำเนินการแล้ว' : 'โหลดข้อมูลบัญชีโฆษณาแล้ว',
          detail: `${datePresetParam} · ${result.meta.counts?.campaigns ?? 0} แคมเปญ · ${result.meta.counts?.adSets ?? 0} ชุดโฆษณา`,
          actor: 'ระบบ',
          tone: 'good',
        })
      }
    } catch (error) {
      if (!isLatestRequest()) return

      const formattedMessage = error instanceof Error ? formatApiMessage(error.message) : 'โหลดข้อมูลบัญชีโฆษณาไม่สำเร็จ'
      setWorkspace(null)
      setDataState('error')
      setSyncState('Sync error')
      setApiMessage(formattedMessage)
      showMascotNotice('โหลดข้อมูลสะดุดครับ ตรวจการเชื่อมต่อหรือข้อมูลบัญชีอีกครั้ง', 'critical')
    }
  }, [appendAudit, showMascotNotice])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshWorkspace('auto')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshWorkspace])

  useEffect(() => {
    let active = true

    async function loadManagedPages() {
      setPageScopeState('loading')
      try {
        const result = await apiJson<ManagedPagesResponse>('/api/page-automation/pages')
        if (!active) return
        setManagedPages(result.pages)
        setPageScopeState('idle')
      } catch {
        if (!active) return
        setManagedPages([])
        setPageScopeState('error')
      }
    }

    void loadManagedPages()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (effectiveSelectedPageId === ALL_PAGE_SCOPE_ID) {
      return
    }

    const selectedPage = managedPages.find((page) => page.id === effectiveSelectedPageId)
    if (!selectedPage) return
    const pageForRequest = selectedPage

    let active = true

    async function loadPageInsight() {
      setPageScopeState('loading')
      try {
        const params = new URLSearchParams({
          datePreset: metaDatePresetForUi(datePreset),
          pageId: pageForRequest.id,
          pageName: pageForRequest.name,
        })
        const result = await apiJson<AdsInsightResponse>(`/api/page-automation/ads-insights?${params.toString()}`)
        if (!active) return
        setPageAdsInsight(result.insight)
        setPageScopeState(result.insight ? 'ready' : 'empty')
      } catch {
        if (!active) return
        setPageAdsInsight(null)
        setPageScopeState('error')
      }
    }

    void loadPageInsight()

    return () => {
      active = false
    }
  }, [datePreset, effectiveSelectedPageId, managedPages])

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
  }, [activeTab])

  useEffect(() => {
    if (!mascotNotice) return undefined
    const timer = window.setTimeout(() => setMascotNotice(null), 6500)
    return () => window.clearTimeout(timer)
  }, [mascotNotice])

  useEffect(() => {
    const root = shellRef.current
    if (!root) return

    const media = gsap.matchMedia()
    media.add(
      {
        isDesktop: '(min-width: 861px)',
        reduceMotion: '(prefers-reduced-motion: reduce)',
      },
      (context) => {
        const conditions = context.conditions as { isDesktop: boolean; reduceMotion: boolean }
        if (document.visibilityState === 'hidden') return undefined
        if (conditions.reduceMotion) return undefined

        const ctx = gsap.context(() => {
          const timeline = gsap.timeline({ defaults: { duration: 0.52, ease: 'power3.out' } })
          gsap.set('.ads-outer-toolbar', { clearProps: 'all' })
          const dashboardAnimationTargets = root.querySelectorAll('.ads-dashboard-metric-card, .ads-dashboard-panel')
          if (dashboardAnimationTargets.length > 0) {
            timeline.from(dashboardAnimationTargets, { y: 16, autoAlpha: 0, stagger: { amount: 0.34 } }, '<0.12')
          }

          const brandMark = root.querySelector('.ads-toolbar-brand-mark')
          if (brandMark) {
            gsap.to(brandMark, {
              y: conditions.isDesktop ? -4 : -2,
              rotation: conditions.isDesktop ? 1 : 0.5,
              duration: 3.2,
              ease: 'sine.inOut',
              repeat: -1,
              yoyo: true,
            })
          }
        }, root)

        return () => ctx.revert()
      },
    )

    return () => media.revert()
  }, [])

  const handleTabSelect = useCallback((tab: TabId, toolbarKey?: string) => {
    const nextToolbarKey = toolbarKey ?? navItems.find((item) => item.id === tab)?.toolbarKey ?? 'dashboard'

    setActiveTab(tab)
    setActiveToolbarKey(nextToolbarKey)
    const tabNotices: Record<TabId, { message: string; tone: Tone }> = {
      ads: { message: 'เปิด Campaigns แล้ว ตรวจชื่อและสถานะให้ชัดก่อนปรับแคมเปญนะครับ', tone: 'watch' },
      analytics: { message: 'กลับมาดู Ads Dashboard ล่าสุดแล้วครับ', tone: 'info' },
      audience: { message: 'เปิด Audience แล้ว ใช้ดูกลุ่มเป้าหมายก่อนปรับแคมเปญ', tone: 'info' },
      creative: { message: 'เปิด Automation Ads แล้ว ตรวจ workflow ก่อนให้ระบบทำงานต่อ', tone: 'info' },
      help: { message: 'เปิดศูนย์ช่วยเหลือแล้ว ถ้าติดตั้งค่าให้ไป Settings ได้เลย', tone: 'info' },
      library: { message: 'เปิดคลังโฆษณาแล้ว ตรวจความเสี่ยงของข้อความก่อนนำไปใช้ต่อครับ', tone: 'watch' },
      marketer: { message: 'เปิด Insights แล้ว ตรวจคำแนะนำก่อนตัดสินใจ', tone: 'info' },
      optimization: { message: 'เปิด Optimizer แล้ว กดวิเคราะห์ล่าสุดก่อนดำเนินแผน', tone: 'info' },
      reports: { message: 'เปิด Reports แล้ว ใช้สรุปงานให้ทีมรีวิวได้', tone: 'good' },
      settings: { message: 'เปิด Settings แล้ว ตั้งค่าบัญชีโฆษณาและระบบวิเคราะห์ได้ตรงนี้', tone: 'watch' },
    }
    const notice =
      tab === 'ads' && nextToolbarKey === 'ad-groups'
        ? { message: 'เปิด Ad Groups แล้ว ตรวจชุดโฆษณา กลุ่มเป้าหมาย และโฆษณาที่เกี่ยวข้องก่อนปรับงาน', tone: 'info' as const }
        : tabNotices[tab]
    showMascotNotice(notice.message, notice.tone)
  }, [showMascotNotice])

  const handlePageScopeSelect = useCallback((pageId: string) => {
    const option = pageSelectorOptions.find((item) => item.id === pageId)
    if (option?.kind === 'account') {
      setSelectedPageId(ALL_PAGE_SCOPE_ID)
      showMascotNotice(`แสดงข้อมูลทั้งหมดของ ${option.label}`, 'info')
      return
    }

    setSelectedPageId(pageId)
    setSelectedCampaignId('')
    setSearchQuery('')
    if (pageId === ALL_PAGE_SCOPE_ID) {
      setPageAdsInsight(null)
      setPageScopeState('idle')
      showMascotNotice('แสดงข้อมูลทุก Page แล้วครับ', 'info')
      return
    }

    setPageAdsInsight(null)
    setPageScopeState('loading')
    showMascotNotice(`กำลังเปิดข้อมูลของ ${option?.label ?? 'Page ที่เลือก'}`, 'info')
  }, [pageSelectorOptions, showMascotNotice])

  const syncWorkspace = () => {
    showMascotNotice('กำลังโหลดข้อมูลล่าสุดจากบัญชีโฆษณาครับ', 'info')
    void refreshWorkspace('manual')
  }

  const startPlanExecution = async () => {
    if (!activePlanExecution || executingPlanId) return
    const rec = activePlanExecution.recommendation
    const execution = rec.execution
    setPlanExecutionError('')
    setActivePlanExecution({ ...activePlanExecution, status: 'running' })
    setRecommendationStates((current) => ({ ...current, [rec.id]: 'Executing' }))
    appendAudit({
      action: 'เริ่มดำเนินการตามแผน',
      detail: `${rec.title} · ${execution ? execution.label : rec.action}`,
      actor: 'ผู้ใช้งาน',
      tone: 'info',
    })
    showMascotNotice(execution ? 'เริ่มส่งคำสั่งตามแผนไปบัญชีโฆษณาแล้วครับ' : 'เริ่มตรวจแผนแล้ว ยังไม่มีการเปลี่ยนข้อมูลจริง', execution ? 'watch' : 'info')

    if (!execution) return

    setExecutingPlanId(rec.id)
    try {
      await apiJson(execution.endpoint, {
        method: execution.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          objectType: execution.objectType,
          objectId: execution.objectId,
          status: execution.status,
          operation: execution.operation,
          params: execution.params,
        }),
      })
      setRecommendationStates((current) => ({ ...current, [rec.id]: 'Executed' }))
      appendAudit({
        action: 'ดำเนินการตามแผนในบัญชีโฆษณาสำเร็จ',
        detail: `${objectTypeLabel(execution.objectType)} ${execution.objectId} · ${execution.status ? mutationStatusLabel(execution.status) : execution.label}`,
        actor: 'บัญชีโฆษณา',
        tone: 'good',
      })
      showMascotNotice('ดำเนินการในบัญชีโฆษณาสำเร็จแล้วครับ', 'good')
      await refreshWorkspace('execution')
      setActivePlanExecution(null)
    } catch (error) {
      const detail = error instanceof Error ? formatApiMessage(error.message) : 'เปลี่ยนข้อมูลในบัญชีโฆษณาไม่สำเร็จ'
      setPlanExecutionError(detail)
      setRecommendationStates((current) => ({ ...current, [rec.id]: 'Failed' }))
      setActivePlanExecution((current) => (current ? { ...current, status: 'ready' } : current))
      appendAudit({
        action: 'ดำเนินการตามแผนไม่สำเร็จ',
        detail,
        actor: 'บัญชีโฆษณา',
        tone: 'critical',
      })
      showMascotNotice('ดำเนินการตามแผนไม่สำเร็จ ตรวจข้อความแจ้งเตือนก่อนครับ', 'critical')
    } finally {
      setExecutingPlanId(null)
    }
  }

  const completePlanExecution = () => {
    if (!activePlanExecution) return
    const rec = activePlanExecution.recommendation
    setRecommendationStates((current) => ({ ...current, [rec.id]: 'Executed' }))
    appendAudit({
      action: 'บันทึกดำเนินการแผนเสร็จแล้ว',
      detail: `${rec.title} · ${rec.action}`,
      actor: 'ผู้ใช้งาน',
      tone: 'good',
    })
    showMascotNotice('บันทึกว่าแผนเสร็จแล้วครับ', 'good')
    setPlanExecutionError('')
    setActivePlanExecution(null)
  }

  const executeRecommendation = async () => {
    if (!confirmingId || executingRecommendationId) return
    const activeId = confirmingId
    const rec = activeRecommendations.find((item) => item.id === activeId)
    setExecutingRecommendationId(activeId)
    setRecommendationStates((current) => ({ ...current, [activeId]: 'Executing' }))

    try {
      if (rec?.execution) {
        await apiJson(rec.execution.endpoint, {
          method: rec.execution.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            objectType: rec.execution.objectType,
            objectId: rec.execution.objectId,
            status: rec.execution.status,
            operation: rec.execution.operation,
            params: rec.execution.params,
          }),
        })
      }
    } catch (error) {
      setRecommendationStates((current) => ({ ...current, [activeId]: 'Failed' }))
      appendAudit({
        action: 'ดำเนินการไม่สำเร็จ',
        detail: error instanceof Error ? formatApiMessage(error.message) : 'เปลี่ยนข้อมูลในบัญชีโฆษณาไม่สำเร็จ',
        actor: 'บัญชีโฆษณา',
        tone: 'critical',
      })
      showMascotNotice('เปลี่ยนข้อมูลในบัญชีโฆษณาไม่สำเร็จ ตรวจข้อความแจ้งเตือนก่อนครับ', 'critical')
      setConfirmingId(null)
      setExecutingRecommendationId(null)
      return
    }

    if (rec?.execution) {
      try {
        await refreshWorkspace('execution')
      } catch (error) {
        appendAudit({
          action: 'โหลดผลล่าสุดหลังเปลี่ยนข้อมูลไม่สำเร็จ',
          detail: error instanceof Error ? formatApiMessage(error.message) : 'เปลี่ยนข้อมูลสำเร็จ แต่โหลดผลล่าสุดกลับมาไม่สำเร็จ',
          actor: 'ระบบ',
          tone: 'watch',
        })
      }
    }

    const finalState: ActionState = rec?.execution ? 'Executed' : 'Approved'
    setRecommendationStates((current) => ({ ...current, [activeId]: finalState }))
    if (rec && !rec.execution) {
      const executablePlan = withResolvedPlanExecution(rec, workspace)
      setPlanExecutionError('')
      setActivePlanExecution({
        recommendation: executablePlan,
        status: 'ready',
        steps: buildPlanExecutionSteps(executablePlan),
      })
    }
    appendAudit({
      action: rec?.execution ? 'เปลี่ยนข้อมูลในบัญชีโฆษณาสำเร็จ' : 'อนุมัติเป็นแผนแล้ว',
      detail: `${rec?.title ?? 'คำแนะนำ'} · ${rec?.execution ? 'ดำเนินการกับบัญชีโฆษณาจริง' : 'บันทึกเป็นแผนเท่านั้น ยังไม่เปลี่ยนข้อมูลจริง'}`,
      actor: 'ผู้ใช้งาน',
      tone: 'good',
    })
    showMascotNotice(rec?.execution ? 'เปลี่ยนข้อมูลในบัญชีโฆษณาสำเร็จแล้วครับ' : 'อนุมัติเป็นแผนแล้ว ไปดำเนินการต่อได้', 'good')
    setConfirmingId(null)
    setExecutingRecommendationId(null)
  }

  return (
    <div className="ads-workspace-shell app-shell" ref={shellRef}>
      <AdsOuterToolbar
        activeToolbarKey={activeToolbarKey}
        dataState={dataState}
        onPageSelect={handlePageScopeSelect}
        onSelect={handleTabSelect}
        pageOptions={pageSelectorOptions}
        pageScopeState={pageScopeState}
        selectedPageId={effectiveSelectedPageId}
      />
      <main className="ads-main-panel app-main">
        <div className="page-body">
          {isPageLoading ? (
            <PageSkeleton activeTab={activeTab} />
          ) : (
            <>
          {activeTab === 'analytics' && (
            <AnalyticsPage
              adSets={visibleWorkspace?.adSets ?? []}
              campaigns={filteredCampaigns}
              dateLabel={datePreset}
              funnelMetrics={funnelMetrics}
              onDatePresetChange={setDatePreset}
              onOpenCampaigns={() => handleTabSelect('ads', 'campaigns')}
              onOpenInsights={() => handleTabSelect('marketer')}
              recommendations={activeRecommendations}
              summary={summary}
              trendData={trendPoints}
            />
          )}
          {activeTab === 'ads' && activeToolbarKey === 'ad-groups' && (
            <AdGroupsPage
              adSets={visibleWorkspace?.adSets ?? []}
              ads={visibleWorkspace?.adInsights ?? []}
              campaigns={displayCampaigns}
              onMutationComplete={() => refreshWorkspace('execution')}
            />
          )}
          {activeTab === 'ads' && activeToolbarKey !== 'ad-groups' && (
            <AdsManagerPage
              adSets={visibleWorkspace?.adSets ?? []}
              ads={visibleWorkspace?.adInsights ?? []}
              campaigns={displayCampaigns}
              onMutationComplete={() => refreshWorkspace('execution')}
              onSelectCampaign={setSelectedCampaignId}
              searchQuery={searchQuery}
              selectedCampaign={displayCampaigns.find((campaign) => campaign.id === effectiveSelectedCampaignId) ?? displayCampaigns[0]}
              setSearchQuery={setSearchQuery}
            />
          )}
          {activeTab === 'marketer' && (
            <InsightsPage
              datePreset={datePreset}
              onBrainApprovalActions={setBrainApprovalActions}
              onOpenPlanExecution={openBrainPlanExecution}
              onQueueBrainAction={queueBrainAction}
              recommendationStates={recommendationStates}
              websiteContext={websiteContext}
              workspace={visibleWorkspace}
            />
          )}
          {activeTab === 'optimization' && (
            <AutoAdsPage
              adSets={visibleWorkspace?.adSets ?? []}
              ads={visibleWorkspace?.adInsights ?? []}
              automationMode={automationMode}
              autoAds={visibleWorkspace?.autoAds ?? []}
              campaigns={displayCampaigns}
              datePreset={datePreset}
              onDateChange={setDatePreset}
              onModeChange={requestAutomationModeChange}
              onMutationComplete={() => refreshWorkspace('execution')}
              trendData={visibleWorkspace?.trendData ?? []}
              workspace={visibleWorkspace}
            />
          )}
          {activeTab === 'creative' && <AutomationAdsPage components={visibleWorkspace?.insightComponents ?? []} />}
          {activeTab === 'audience' && <AudienceInsightsPage adSets={visibleWorkspace?.adSets ?? []} />}
          {activeTab === 'library' && <AdLibraryPage reviews={visibleWorkspace?.complianceReviews ?? []} />}
          {activeTab === 'reports' && (
            <ReportsPage
              datePreset={datePreset}
              metaInfo={metaInfo}
              preparedReport={preparedReport}
              recommendations={activeRecommendations}
              setPreparedReport={setPreparedReport}
              summary={summary}
              syncState={syncState}
            />
          )}
          {activeTab === 'settings' && <SettingsPage dataState={dataState} metaInfo={metaInfo} onSync={syncWorkspace} syncState={syncState} />}
          {activeTab === 'help' && <HelpCenterPage dataState={dataState} onOpenSettings={() => handleTabSelect('settings')} onSync={syncWorkspace} syncState={syncState} />}
            </>
          )}
        </div>
      </main>
      {confirmingId && confirmingRecommendation ? (
        <ConfirmModal
          isExecuting={executingRecommendationId === confirmingId}
          onCancel={() => {
            if (!executingRecommendationId) setConfirmingId(null)
          }}
          onConfirm={executeRecommendation}
          recommendation={confirmingRecommendation}
          targetCampaign={displayCampaigns.find((campaign) => campaign.id === confirmingRecommendation.campaignId)}
        />
      ) : null}
      {activePlanExecution ? (
        <PlanExecutionModal
          draft={activePlanExecution}
          error={planExecutionError}
          isExecuting={executingPlanId === activePlanExecution.recommendation.id}
          onClose={() => {
            if (!executingPlanId) {
              setPlanExecutionError('')
              setActivePlanExecution(null)
            }
          }}
          onComplete={completePlanExecution}
          onStart={startPlanExecution}
        />
      ) : null}
      {pendingAutomationMode ? (
        <AutomationModeConfirmModal
          nextMode={pendingAutomationMode}
          onCancel={() => setPendingAutomationMode(null)}
          onConfirm={confirmAutomationModeChange}
        />
      ) : null}
    </div>
  )
}

function PageSkeleton({ activeTab }: { activeTab: TabId }) {
  const titles: Record<TabId, string> = {
    ads: 'กำลังโหลดตัวจัดการโฆษณา',
    analytics: 'กำลังโหลด Ads Dashboard',
    audience: 'กำลังโหลดกลุ่มเป้าหมาย',
    creative: 'กำลังโหลด Automation Ads',
    help: 'กำลังโหลดศูนย์ช่วยเหลือ',
    library: 'กำลังโหลดคลังโฆษณา',
    marketer: 'กำลังโหลด Insights',
    optimization: 'กำลังโหลด Optimizer',
    reports: 'กำลังโหลดรายงาน',
    settings: 'กำลังโหลดการตั้งค่า',
  }
  const cardCount: Record<TabId, number> = {
    ads: 6,
    analytics: 4,
    audience: 4,
    creative: 4,
    help: 4,
    library: 5,
    marketer: 3,
    optimization: 5,
    reports: 2,
    settings: 3,
  }
  const showChart = activeTab === 'analytics' || activeTab === 'optimization'
  const showTable = activeTab === 'ads' || activeTab === 'library' || activeTab === 'audience' || activeTab === 'settings'
  const showAiPanel = activeTab === 'marketer' || activeTab === 'creative'

  return (
    <div className="page-skeleton" aria-live="polite" aria-busy="true">
      <section className="page-skeleton-panel">
        <div className="page-skeleton-header">
          <div>
            <span className="skeleton-chip" />
            <h2>{titles[activeTab]}</h2>
            <p>กำลังโหลดข้อมูลจริงและเตรียมหน้าจอ</p>
          </div>
          <span className="skeleton-button" />
        </div>
        <div className={`page-skeleton-grid ${activeTab}`}>
          {Array.from({ length: cardCount[activeTab] }).map((_, index) => (
            <article className="page-skeleton-card" key={`${activeTab}-card-${index}`}>
              <span className="skeleton-pill" />
              <span className="skeleton-line wide" />
              <span className="skeleton-line" />
              <span className="skeleton-line short" />
            </article>
          ))}
        </div>
      </section>
      {showChart ? (
        <section className="page-skeleton-panel">
          <div className="page-skeleton-chart">
            {Array.from({ length: 12 }).map((_, index) => (
              <span key={`chart-bar-${index}`} style={{ height: `${32 + (index % 5) * 12}%` }} />
            ))}
          </div>
        </section>
      ) : null}
      {showTable ? (
        <section className="page-skeleton-panel page-skeleton-table">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="page-skeleton-row" key={`${activeTab}-row-${index}`}>
              <span className="skeleton-pill" />
              <span className="skeleton-line wide" />
              <span className="skeleton-line" />
              <span className="skeleton-button" />
            </div>
          ))}
        </section>
      ) : null}
      {showAiPanel ? (
        <section className="page-skeleton-panel">
          <MasterAgentSkeleton />
        </section>
      ) : null}
    </div>
  )
}

type AdsOuterToolbarProps = {
  activeToolbarKey: string
  dataState: DataSourceState
  onPageSelect: (pageId: string) => void
  onSelect: (tab: TabId, toolbarKey?: string) => void
  pageOptions: AdsPageSelectorOption[]
  pageScopeState: PageScopeLoadState
  selectedPageId: string
}

function AdsOuterToolbar({ activeToolbarKey, dataState, onPageSelect, onSelect, pageOptions, pageScopeState, selectedPageId }: AdsOuterToolbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isPageMenuOpen, setPageMenuOpen] = useState(false)
  const pageSelectorRef = useRef<HTMLDivElement>(null)
  const selectedPage = pageOptions.find((option) => option.id === selectedPageId) ?? pageOptions[0] ?? {
    detail: 'ทุกข้อมูลจากบัญชีที่เชื่อมไว้',
    id: ALL_PAGE_SCOPE_ID,
    kind: 'all' as const,
    label: 'ข้อมูลทั้งหมด',
    meta: 'All pages',
  }
  const pageSelectorStatus =
    pageScopeState === 'loading'
      ? 'กำลังโหลด Page'
      : pageScopeState === 'error'
        ? 'เลือกได้เฉพาะข้อมูลทั้งหมด'
        : selectedPage.detail
  const apiStatus =
    dataState === 'live'
      ? { label: 'API พร้อมใช้งาน', tone: 'live' }
      : dataState === 'loading'
        ? { label: 'กำลังตรวจ API', tone: 'loading' }
        : dataState === 'error'
          ? { label: 'API มีปัญหา', tone: 'error' }
          : { label: 'รอการตั้งค่า API', tone: 'waiting' }
  const selectTab = (tab: TabId, toolbarKey?: string) => {
    onSelect(tab, toolbarKey)
    setIsMenuOpen(false)
  }
  const selectPage = (pageId: string) => {
    onPageSelect(pageId)
    setPageMenuOpen(false)
    setIsMenuOpen(false)
  }

  useEffect(() => {
    if (!isPageMenuOpen) return undefined

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pageSelectorRef.current?.contains(event.target as Node)) setPageMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPageMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isPageMenuOpen])

  return (
    <aside className={`ads-outer-toolbar ${isMenuOpen ? 'menu-open' : ''}`}>
      <div className="ads-toolbar-brand-row">
        <a className="ads-toolbar-brand" href="/" aria-label="กลับหน้า Home">
          <span className="ads-toolbar-brand-mark">P</span>
          <span>
            <strong>PMC</strong>
            <small>Aesthetic Clinic</small>
          </span>
        </a>
        <button
          className="ads-mobile-menu-button"
          type="button"
          aria-controls="ads-agent-navigation"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? 'ปิดเมนู Ads Agent' : 'เปิดเมนู Ads Agent'}
          onClick={() => setIsMenuOpen((value) => !value)}
        >
          {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      <nav className="ads-toolbar-nav" id="ads-agent-navigation" aria-label="Ads Agent navigation">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = item.toolbarKey === activeToolbarKey
          return (
            <button
              className={`ads-toolbar-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              data-description={item.description}
              key={item.label}
              type="button"
              onClick={() => selectTab(item.id, item.toolbarKey)}
            >
              <span className="ads-toolbar-icon">
                <Icon size={18} />
              </span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="ads-page-selector-shell" ref={pageSelectorRef}>
        <button
          className={`ads-toolbar-user-card${isPageMenuOpen ? ' open' : ''}`}
          type="button"
          aria-controls="ads-page-selector-menu"
          aria-expanded={isPageMenuOpen}
          aria-haspopup="listbox"
          aria-label="เลือก Page สำหรับดูข้อมูล"
          onClick={() => setPageMenuOpen((value) => !value)}
        >
          <span className="ads-toolbar-avatar" aria-hidden="true">
            {selectedPage.kind === 'all' ? <Layers3 size={19} /> : <UserRound size={20} />}
            <span className={`ads-toolbar-api-dot ${apiStatus.tone}`} title={apiStatus.label} />
          </span>
          <div className="ads-toolbar-user-copy">
            <strong>{selectedPage.label}</strong>
            <span className="ads-toolbar-user-role">
              <BriefcaseBusiness size={12} aria-hidden="true" />
              เลือก Page · {pageSelectorStatus}
            </span>
          </div>
          <span className="ads-toolbar-user-menu" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
        </button>
        <div className="ads-page-selector-popover" hidden={!isPageMenuOpen}>
          <div className="ads-page-selector-menu" id="ads-page-selector-menu" role="listbox" aria-label="Page ที่เชื่อมต่อ">
            {pageOptions.map((option) => {
              const isActive = option.id === selectedPage.id
              return (
                <button
                  className={`ads-page-selector-option ${isActive ? 'active' : ''}`}
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => selectPage(option.id)}
                >
                  <span className={`ads-page-selector-option-icon ${option.kind}`}>
                    {option.kind === 'all' ? <Layers3 size={16} /> : <UserRound size={16} />}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                    {option.meta ? <em>{option.meta}</em> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}

export function AnalyticsPage({
  campaigns,
  dateLabel = 'ข้อมูลล่าสุด',
  funnelMetrics,
  onDatePresetChange,
  onOpenCampaigns,
  onOpenInsights,
  recommendations,
  summary,
  trendData,
}: {
  adSets?: WorkspaceData['adSets']
  campaigns: Campaign[]
  dateLabel?: string
  funnelMetrics: MetaFunnelMetric[]
  onDatePresetChange?: (preset: string) => void
  onOpenCampaigns?: () => void
  onOpenInsights?: () => void
  recommendations: Recommendation[]
  summary: Summary
  trendData: TrendDatum[]
}) {
  const [isCampaignComposerOpen, setCampaignComposerOpen] = useState(false)
  const [localDateLabel, setLocalDateLabel] = useState(dateLabel)
  const selectedDateLabel = onDatePresetChange ? dateLabel : localDateLabel
  const handleDatePresetChange = (nextPreset: string) => {
    setLocalDateLabel(nextPreset)
    onDatePresetChange?.(nextPreset)
  }

  const topCampaigns = [...campaigns]
    .sort((left, right) => right.conversions - left.conversions || right.roas - left.roas)
    .slice(0, 3)
  const totalConversions = campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const dashboardConversions = summary.bookings || totalConversions
  const unavailableMetaMetricChange: MetricChange = { label: 'รอข้อมูล', tone: 'neutral', detail: 'ยังไม่มีข้อมูลในช่วงนี้' }
  const impressionsCount = funnelMetricCount(funnelMetrics, 'Impressions')
  const clicksCount = funnelMetricCount(funnelMetrics, 'Clicks')
  const dashboardCtr = impressionsCount && clicksCount ? (clicksCount / impressionsCount) * 100 : campaigns.length > 0 ? campaigns.reduce((sum, campaign) => sum + campaign.ctr, 0) / campaigns.length : 0
  const funnelSparkline = sparklineFromFunnel(funnelMetrics, ['Impressions', 'Clicks', 'Leads', 'Bookings', 'Paid'])
  const clicksTrendSparkline = sparklineFromTrend(trendData, (point) => point.clicks)
  const conversionTrendSparkline = sparklineFromTrend(trendData, (point) => point.bookings)
  const spendTrendSparkline = sparklineFromTrend(trendData, (point) => point.spend)
  const cpaTrendSparkline = sparklineFromTrend(trendData, (point) => (point.bookings > 0 ? point.spend / point.bookings : undefined))
  const ctrTrendSparkline = sparklineFromTrend(trendData, (point) => (point.impressions && point.impressions > 0 ? ((point.clicks ?? 0) / point.impressions) * 100 : undefined))
  const campaignCtrSparkline = sparklineFromCampaigns(campaigns, (campaign) => campaign.ctr)
  const roasTrendSparkline = sparklineFromTrend(trendData, (point) => (point.spend > 0 ? point.revenue / point.spend : undefined))
  const campaignRoasSparkline = sparklineFromCampaigns(campaigns, (campaign) => campaign.roas)
  const metricCards: DashboardMetric[] = [
    { icon: Eye, label: 'Impressions', tone: 'green', value: impressionsCount !== null ? fmtNum(impressionsCount) : 'รอข้อมูล', helper: impressionsCount !== null ? 'จำนวนครั้งที่โฆษณาถูกเห็น' : 'รอข้อมูลการแสดงผลสำหรับช่วงนี้', change: impressionsCount !== null ? { label: 'ข้อมูลบัญชีโฆษณา', tone: 'good', detail: 'ตามช่วงที่เลือก' } : unavailableMetaMetricChange, sparkline: { label: 'สรุปเส้นทางลูกค้า', source: 'funnel', values: funnelSparkline } },
    { icon: MousePointerClick, label: 'Clicks', tone: 'blue', value: clicksCount !== null ? fmtNum(clicksCount) : 'รอข้อมูล', helper: clicksCount !== null ? 'จำนวนครั้งที่คนกดจากโฆษณา' : 'รอข้อมูลการกดสำหรับช่วงนี้', change: clicksCount !== null ? { label: 'ข้อมูลบัญชีโฆษณา', tone: 'good', detail: 'ตามช่วงที่เลือก' } : unavailableMetaMetricChange, sparkline: { label: clicksTrendSparkline.length ? 'สรุปคลิกรายวัน' : 'สรุปเส้นทางลูกค้า', source: clicksTrendSparkline.length ? 'daily-trend' : 'funnel', values: clicksTrendSparkline.length ? clicksTrendSparkline : sparklineFromFunnel(funnelMetrics, ['Clicks', 'Leads', 'Bookings', 'Paid']) } },
    { icon: BarChart3, label: 'Conversions', tone: 'purple', value: fmtNum(dashboardConversions), helper: 'ผลลัพธ์ที่เกิดขึ้นจากโฆษณาและการนัดหมาย', change: conversionRatePeriodChange(trendData), sparkline: { label: 'สรุปยอดนัดหมายรายวัน', source: conversionTrendSparkline.length ? 'daily-trend' : 'empty', values: conversionTrendSparkline } },
    { icon: CircleDollarSign, label: 'Cost', tone: 'gold', value: fmtMoneyShort(summary.spend), helper: 'ค่าโฆษณารวมในช่วงที่เลือก', change: periodChange(metricTrendValues(trendData, (point) => point.spend), 'จากค่าโฆษณารายวัน'), sparkline: { label: 'สรุปค่าโฆษณารายวัน', source: spendTrendSparkline.length ? 'daily-trend' : 'empty', values: spendTrendSparkline } },
  ]

  return (
    <>
      <div className="ads-dashboard-layout">
      <section className="ads-dashboard-head" aria-label="Ads Dashboard actions">
        <div>
          <h2>Ads Dashboard</h2>
          <label className="ads-dashboard-date-pill">
            <CalendarDays size={15} />
            <select aria-label="ช่วงข้อมูล Ads Dashboard" value={selectedDateLabel} onChange={(event) => handleDatePresetChange(event.currentTarget.value)}>
              {datePresetOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        </div>
        <div className="ads-dashboard-actions">
          <button className="clinic-secondary-button" type="button" disabled aria-label="ปรับแต่งแดชบอร์ดยังไม่พร้อมใช้งาน" title="ปรับแต่งแดชบอร์ดยังไม่พร้อมใช้งาน">
            <SlidersHorizontal size={15} />
            Customize Dashboard
          </button>
          <button className="clinic-primary-button" type="button" onClick={() => setCampaignComposerOpen(true)} aria-haspopup="dialog" aria-label="สร้างแคมเปญใหม่">
            <Plus size={15} />
            New Campaign
          </button>
        </div>
      </section>

      <section className="ads-dashboard-metric-grid" aria-label="Ads Dashboard metrics">
        {metricCards.map((metric) => (
          <DashboardMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="ads-dashboard-main-grid">
        <DashboardPanel className="performance-panel" title="Performance Overview" subtitle="ค่าโฆษณา รายได้ และยอดนัดหมายจากข้อมูลล่าสุด">
          <RevenueOverviewChart embedded trendData={trendData} />
        </DashboardPanel>
        <DashboardPanel action={<button className="ads-dashboard-select-pill" type="button" disabled>ตามผลลัพธ์ <ChevronDown size={14} /></button>} title="Top Campaigns" subtitle="เรียงตามผลลัพธ์และผลตอบแทน">
          <TopCampaignsList campaigns={topCampaigns} onOpenCampaigns={onOpenCampaigns} />
        </DashboardPanel>
      </section>

      <section className="ads-dashboard-lower-grid" aria-label="Ads Dashboard secondary metrics">
        <DashboardMetricCard metric={{ icon: CircleDollarSign, label: 'Cost per Result', tone: 'green', value: summary.cpa > 0 ? fmtMoney(summary.cpa) : 'รอข้อมูล', helper: 'ค่าโฆษณาต่อหนึ่งผลลัพธ์', change: { label: summary.cpa > 0 ? 'คำนวณแล้ว' : 'รอข้อมูล', tone: summary.cpa > 0 ? 'good' : 'neutral', detail: 'จากช่วงที่เลือก' }, sparkline: { label: 'สรุปต้นทุนต่อผลลัพธ์รายวัน', source: cpaTrendSparkline.length ? 'daily-trend' : 'empty', values: cpaTrendSparkline } }} />
        <DashboardMetricCard metric={{ icon: Percent, label: 'CTR', tone: 'blue', value: dashboardCtr > 0 ? `${dashboardCtr.toFixed(2)}%` : 'รอข้อมูล', helper: 'อัตราคนเห็นแล้วกดโฆษณา', change: { label: dashboardCtr > 0 ? 'คำนวณแล้ว' : 'รอข้อมูล', tone: dashboardCtr > 0 ? 'good' : 'neutral', detail: impressionsCount && clicksCount ? 'จากช่วงที่เลือก' : 'จากแคมเปญล่าสุด' }, sparkline: { label: ctrTrendSparkline.length ? 'สรุป CTR รายวัน' : 'สรุป CTR ตามแคมเปญ', source: ctrTrendSparkline.length ? 'daily-trend' : campaignCtrSparkline.length ? 'campaign-summary' : 'empty', values: ctrTrendSparkline.length ? ctrTrendSparkline : campaignCtrSparkline } }} />
        <DashboardMetricCard metric={{ icon: LineChart, label: 'ROAS', tone: 'purple', value: summary.roas > 0 ? `${summary.roas.toFixed(2)}x` : 'รอข้อมูล', helper: 'รายได้เทียบกับค่าโฆษณา', change: { label: summary.roas > 0 ? 'คำนวณแล้ว' : 'รอข้อมูล', tone: summary.roas > 0 ? 'good' : 'neutral', detail: 'จากช่วงที่เลือก' }, sparkline: { label: roasTrendSparkline.length ? 'สรุปผลตอบแทนรายวัน' : 'สรุปผลตอบแทนตามแคมเปญ', source: roasTrendSparkline.length ? 'daily-trend' : campaignRoasSparkline.length ? 'campaign-summary' : 'empty', values: roasTrendSparkline.length ? roasTrendSparkline : campaignRoasSparkline } }} />
        <DashboardPanel className="ads-insight-panel" title="PMC Insights" subtitle="สรุปสิ่งที่ควรตรวจจากข้อมูลล่าสุด">
          <DashboardInsightsBanner onOpenInsights={onOpenInsights} recommendations={recommendations} summary={summary} />
        </DashboardPanel>
      </section>
      </div>
      {isCampaignComposerOpen ? <NewCampaignComposer onClose={() => setCampaignComposerOpen(false)} /> : null}
    </>
  )
}

type DashboardMetricTone = 'green' | 'sand' | 'blue' | 'purple' | 'gold'
type SparklineSource = 'daily-trend' | 'funnel' | 'campaign-summary' | 'empty'

type MetricSparkline = {
  label: string
  source: SparklineSource
  values: number[]
}

type DashboardMetric = {
  change: MetricChange
  helper: string
  icon: LucideIcon
  label: string
  sparkline: MetricSparkline
  tone: DashboardMetricTone
  value: string
}

type MetricChange = {
  detail: string
  label: string
  tone: Tone
}

function DashboardMetricCard({ metric }: { metric: DashboardMetric }) {
  const Icon = metric.icon

  return (
    <article className="ads-dashboard-metric-card">
      <span className={`ads-dashboard-metric-icon ${metric.tone}`}>
        <Icon size={22} />
      </span>
      <div className="ads-dashboard-metric-main">
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <small>{metric.helper}</small>
      </div>
      <div className="ads-dashboard-metric-footer">
        <div className="ads-dashboard-metric-change">
          <em className={metric.change.tone}>{metric.change.label}</em>
          <small>{metric.change.detail}</small>
        </div>
        <MetricSparklineGraph label={metric.label} sparkline={metric.sparkline} tone={metric.tone} />
      </div>
    </article>
  )
}

function MetricSparklineGraph({ label, sparkline, tone }: { label: string; sparkline: MetricSparkline; tone: DashboardMetricTone }) {
  const rawValues = compactSparklineValues(sparkline.values)
  const hasSeries = rawValues.length >= 2
  const source = hasSeries ? sparkline.source : 'empty'
  const visual = buildSparklineVisual(rawValues)
  const values = rawValues.map(formatSparklineValue).join(',')
  const tooltip = metricSparklineTooltip(label, sparkline.label, rawValues)

  return (
    <span
      aria-label={tooltip}
      className={`ads-mini-sparkline ${tone}${hasSeries ? '' : ' is-empty'}`}
      data-sparkline="metric-summary"
      data-sparkline-scale={visual.scale}
      data-sparkline-source={source}
      data-tooltip={tooltip}
      data-values={values}
      role="img"
      tabIndex={0}
      title={tooltip}
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 112 38">
        <path className="ads-sparkline-area" d={visual.areaPath} />
        <path className="ads-sparkline-baseline" d="M4 32 L108 32" />
        <path className="ads-sparkline-line" d={visual.linePath} />
        <circle className="ads-sparkline-dot" cx={visual.lastPoint.x} cy={visual.lastPoint.y} r="3.4" />
      </svg>
    </span>
  )
}

type CampaignComposerDraft = {
  audience: string
  budget: string
  name: string
  note: string
  objective: string
}

function NewCampaignComposer({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<CampaignComposerDraft>({
    audience: '',
    budget: '',
    name: '',
    note: '',
    objective: 'ข้อความและนัดหมาย',
  })
  const [message, setMessage] = useState('')
  const canPrepare = draft.name.trim().length > 0 && draft.budget.trim().length > 0
  const updateDraft = (field: keyof CampaignComposerDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setMessage('')
  }
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canPrepare) return
    setMessage('เตรียมแคมเปญไว้ในหน้านี้แล้ว ตรวจข้อมูลอีกครั้งก่อนส่งเข้าบัญชี Meta')
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal campaign-composer-modal" role="dialog" aria-modal="true" aria-labelledby="new-campaign-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="ปิดหน้าสร้างแคมเปญ">
          <X size={16} />
        </button>
        <span className="status-badge info">New Campaign</span>
        <h2 id="new-campaign-title">สร้างแคมเปญใหม่</h2>
        <p>กรอกข้อมูลหลักเพื่อเตรียมแคมเปญก่อนสร้างจริงในบัญชีโฆษณา</p>

        <form className="campaign-composer-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              ชื่อแคมเปญ
              <input autoFocus value={draft.name} onChange={(event) => updateDraft('name', event.currentTarget.value)} placeholder="เช่น Botox Lead เดือนนี้" />
            </label>
            <label>
              วัตถุประสงค์
              <select value={draft.objective} onChange={(event) => updateDraft('objective', event.currentTarget.value)}>
                <option>ข้อความและนัดหมาย</option>
                <option>เพิ่มยอดจอง</option>
                <option>เพิ่มคนรู้จักแบรนด์</option>
                <option>รีมาร์เก็ตติ้ง</option>
              </select>
            </label>
            <label>
              งบต่อวัน
              <input inputMode="numeric" value={draft.budget} onChange={(event) => updateDraft('budget', event.currentTarget.value)} placeholder="เช่น 3000" />
            </label>
            <label>
              กลุ่มเป้าหมาย
              <input value={draft.audience} onChange={(event) => updateDraft('audience', event.currentTarget.value)} placeholder="เช่น ผู้หญิง 25-45 กรุงเทพ" />
            </label>
            <label className="form-grid-wide">
              โน้ตสำหรับทีม
              <textarea value={draft.note} onChange={(event) => updateDraft('note', event.currentTarget.value)} placeholder="ข้อความหลัก โปรโมชัน หรือข้อควรระวังของแคมเปญนี้" />
            </label>
          </div>

          <div className="campaign-composer-summary" aria-live="polite">
            {message || 'ข้อมูลนี้ยังไม่ถูกส่งออกจากหน้า จนกว่าทีมจะตรวจและสร้างจริง'}
          </div>

          <div className="modal-actions">
            <button className="clinic-secondary-button" type="button" onClick={onClose}>
              ยกเลิก
            </button>
            <button className="clinic-primary-button" type="submit" disabled={!canPrepare}>
              เตรียมแคมเปญ
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function DashboardPanel({ action, children, className = '', subtitle, title }: { action?: ReactNode; children: ReactNode; className?: string; subtitle: string; title: string }) {
  return (
    <section className={`ads-dashboard-panel ${className}`.trim()}>
      <div className="ads-dashboard-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function TopCampaignsList({ campaigns, onOpenCampaigns }: { campaigns: Campaign[]; onOpenCampaigns?: () => void }) {
  if (campaigns.length === 0) {
    return <EmptyState title="ยังไม่มีแคมเปญให้จัดอันดับ" detail="เมื่อโหลดข้อมูลบัญชีโฆษณาแล้ว แคมเปญที่ทำผลงานดีที่สุดจะแสดงที่นี่" />
  }

  return (
    <div className="ads-top-campaign-list">
      {campaigns.map((campaign, index) => (
        <article className="ads-top-campaign-row" key={campaign.id}>
          <span className={`ads-campaign-rank-icon ${campaign.tone}`}>{index + 1}</span>
          <div>
            <strong>{campaign.name}</strong>
            <small>{fmtNum(campaign.conversions)} ผลลัพธ์ · ROAS {campaign.roas.toFixed(2)}x</small>
          </div>
          <span className={`ads-campaign-rank-change ${campaign.tone}`}>{campaign.roas > 1 ? '↑' : '↓'} {Math.abs((campaign.roas - 1) * 10).toFixed(1)}%</span>
        </article>
      ))}
      <button className="ads-view-all-button" type="button" onClick={() => onOpenCampaigns?.()} aria-label="เปิดหน้า Campaigns เพื่อดูแคมเปญทั้งหมด">ดูแคมเปญทั้งหมด</button>
    </div>
  )
}

type AdsPerformanceState = {
  label: 'Good' | 'Average' | 'Poor'
  tone: 'good' | 'medium' | 'bad'
}

function dashboardPerformanceState(summary: Summary, recommendations: Recommendation[]): AdsPerformanceState {
  const highRiskCount = recommendations.filter((rec) => rec.risk === 'High').length
  const hasMeaningfulResults = summary.bookings > 0 || summary.paidTreatments > 0 || summary.revenue > 0

  if (!hasMeaningfulResults || highRiskCount >= 2 || (summary.spend > 0 && summary.roas < 0.65 && summary.bookings < 3)) {
    return { label: 'Poor', tone: 'bad' }
  }

  if (summary.roas >= 1.5 && summary.bookings > 0 && highRiskCount === 0) {
    return { label: 'Good', tone: 'good' }
  }

  return { label: 'Average', tone: 'medium' }
}

function DashboardInsightsBanner({ onOpenInsights, recommendations, summary }: { onOpenInsights?: () => void; recommendations: Recommendation[]; summary: Summary }) {
  const performance = dashboardPerformanceState(summary, recommendations)

  return (
    <div className={`ads-insight-banner ${performance.tone}`} aria-label={`Your ads are performing ${performance.label}`} data-performance-state={performance.tone}>
      <div className="ads-insight-copy">
        <strong>
          Your ads are
          <br />
          performing <b className={`ads-insight-status ${performance.tone}`}>{performance.label}</b>
        </strong>
        <button className="clinic-secondary-button ads-insight-open-button" type="button" onClick={() => onOpenInsights?.()} aria-label="เปิดเมนู Insights จากแถบด้านซ้าย">
          เปิด Insights
        </button>
      </div>
      <div className="ads-insight-visual" aria-hidden="true">
        <img alt="" loading="lazy" src="/pmc-insights-performance.svg" />
      </div>
    </div>
  )
}

function funnelMetricCount(funnelMetrics: MetaFunnelMetric[], stage: string) {
  const normalizedStage = normalizeFunnelStage(stage)
  const match = funnelMetrics.find((metric) => normalizeFunnelStage(metric.stage) === normalizedStage)
  if (!match) return null

  const count = Number(match?.count)
  return Number.isFinite(count) && count >= 0 ? count : null
}

function normalizeFunnelStage(stage: string) {
  return stage.trim().toLowerCase()
}

function sparklineFromFunnel(funnelMetrics: MetaFunnelMetric[], stages: string[]) {
  const values = stages
    .map((stage) => funnelMetricCount(funnelMetrics, stage))
    .filter((value): value is number => value !== null)
  return values.length >= 2 ? values : []
}

function sparklineFromTrend(trendData: TrendDatum[], getValue: (point: TrendDatum) => number | undefined) {
  return compactSparklineValues(trendData.map((point) => getValue(point)))
}

function sparklineFromCampaigns(campaigns: Campaign[], getValue: (campaign: Campaign) => number | undefined) {
  return compactSparklineValues(campaigns.slice(0, 8).map((campaign) => getValue(campaign)))
}

function compactSparklineValues(values: Array<number | undefined | null>) {
  const usableValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return usableValues.length >= 2 ? usableValues : []
}

type SparklineVisual = {
  areaPath: string
  lastPoint: { x: string; y: string }
  linePath: string
  scale: 'linear' | 'log'
}

function buildSparklineVisual(rawValues: number[]): SparklineVisual {
  const width = 112
  const height = 38
  const padX = 4
  const padTop = 5
  const padBottom = 6
  const fallbackValues = rawValues.length >= 2 ? rawValues : [0, 0]
  const minPositive = fallbackValues.filter((value) => value > 0).reduce((lowest, value) => Math.min(lowest, value), Number.POSITIVE_INFINITY)
  const maxValue = Math.max(...fallbackValues)
  const shouldUseLog = Number.isFinite(minPositive) && minPositive > 0 && maxValue / minPositive > 25
  const renderValues = shouldUseLog ? fallbackValues.map((value) => Math.log10(Math.max(0, value) + 1)) : fallbackValues
  const minValue = Math.min(...renderValues)
  const maxRenderValue = Math.max(...renderValues)
  const range = maxRenderValue - minValue || 1
  const availableWidth = width - padX * 2
  const availableHeight = height - padTop - padBottom
  const points = renderValues.map((value, index) => {
    const x = padX + (availableWidth * index) / Math.max(1, renderValues.length - 1)
    const y = padTop + availableHeight - ((value - minValue) / range) * availableHeight
    return { x, y }
  })
  const linePath = buildSmoothPath(points)
  const areaPath = `${linePath} L ${formatSparklineCoord(points[points.length - 1].x)} ${height - padBottom} L ${formatSparklineCoord(points[0].x)} ${height - padBottom} Z`
  const lastPoint = points[points.length - 1]

  return {
    areaPath,
    lastPoint: { x: formatSparklineCoord(lastPoint.x), y: formatSparklineCoord(lastPoint.y) },
    linePath,
    scale: shouldUseLog ? 'log' : 'linear',
  }
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  const [firstPoint, ...nextPoints] = points
  return nextPoints.reduce((path, point, index) => {
    const previous = points[index]
    const midX = (previous.x + point.x) / 2
    return `${path} C ${formatSparklineCoord(midX)} ${formatSparklineCoord(previous.y)}, ${formatSparklineCoord(midX)} ${formatSparklineCoord(point.y)}, ${formatSparklineCoord(point.x)} ${formatSparklineCoord(point.y)}`
  }, `M ${formatSparklineCoord(firstPoint.x)} ${formatSparklineCoord(firstPoint.y)}`)
}

function formatSparklineCoord(value: number) {
  return Number(value.toFixed(2)).toString()
}

function formatSparklineValue(value: number) {
  if (Number.isInteger(value)) return String(value)
  return Number(value.toFixed(2)).toString()
}

function metricSparklineTooltip(metricLabel: string, sparklineLabel: string, rawValues: number[]) {
  if (rawValues.length < 2) return `${metricLabel}: ${sparklineLabel} · ยังไม่มีข้อมูลแนวโน้มเพียงพอ`

  const latest = rawValues[rawValues.length - 1]
  const high = Math.max(...rawValues)
  const low = Math.min(...rawValues)

  return [
    `${metricLabel}: ${sparklineLabel}`,
    `ล่าสุด ${formatSparklineTooltipValue(latest)}`,
    `สูงสุด ${formatSparklineTooltipValue(high)}`,
    `ต่ำสุด ${formatSparklineTooltipValue(low)}`,
  ].join(' · ')
}

function formatSparklineTooltipValue(value: number) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value)
}

function metricTrendValues(trendData: TrendDatum[], getValue: (point: TrendDatum) => number | undefined) {
  if (trendData.length < 2) return []
  const values = trendData.map((point) => getValue(point))
  return values.every((value) => Number.isFinite(value)) ? (values as number[]) : []
}

function periodChange(values: number[], detail: string): MetricChange {
  const usableValues = values.filter((value) => Number.isFinite(value))
  if (usableValues.length < 2) return { label: 'รอข้อมูล', tone: 'neutral' as Tone, detail: 'ยังไม่มีข้อมูลรายวันพอ' }

  const midpoint = Math.max(1, Math.floor(usableValues.length / 2))
  const previous = usableValues.slice(0, midpoint).reduce((sum, value) => sum + value, 0)
  const current = usableValues.slice(midpoint).reduce((sum, value) => sum + value, 0)
  if (previous <= 0) return current > 0 ? { label: 'มีข้อมูลใหม่', tone: 'good' as Tone, detail } : { label: 'รอข้อมูล', tone: 'neutral' as Tone, detail: 'ยังไม่มีข้อมูลรายวันพอ' }

  const change = ((current - previous) / previous) * 100
  const prefix = change >= 0 ? '↑' : '↓'
  const tone: Tone = change > 0 ? 'good' : change < 0 ? 'critical' : 'neutral'
  return { label: `${prefix} ${Math.abs(change).toFixed(1)}%`, tone, detail }
}

function conversionRatePeriodChange(trendData: TrendDatum[]): MetricChange {
  if (trendData.length < 2 || trendData.some((point) => !Number.isFinite(point.treatments))) {
    return { label: 'รอข้อมูล', tone: 'neutral', detail: 'รอข้อมูลชำระเงิน' }
  }

  const midpoint = Math.max(1, Math.floor(trendData.length / 2))
  const previousPoints = trendData.slice(0, midpoint)
  const currentPoints = trendData.slice(midpoint)
  const previousBookings = previousPoints.reduce((sum, point) => sum + point.bookings, 0)
  const currentBookings = currentPoints.reduce((sum, point) => sum + point.bookings, 0)
  const previousPaidCases = previousPoints.reduce((sum, point) => sum + (point.treatments ?? 0), 0)
  const currentPaidCases = currentPoints.reduce((sum, point) => sum + (point.treatments ?? 0), 0)
  const detail = 'เทียบยอดนัดรายวัน'

  if (previousBookings <= 0) return currentBookings > 0 ? { label: 'มีข้อมูลใหม่', tone: 'good', detail } : { label: 'รอข้อมูล', tone: 'neutral', detail: 'ยอดนัดยังไม่พอ' }
  if (currentBookings <= 0) return { label: '↓ 100.0%', tone: 'critical', detail }

  const previousRate = previousPaidCases / previousBookings
  const currentRate = currentPaidCases / currentBookings
  if (previousRate <= 0) return currentRate > 0 ? { label: 'มีข้อมูลใหม่', tone: 'good', detail } : { label: 'รอข้อมูล', tone: 'neutral', detail }

  const change = ((currentRate - previousRate) / previousRate) * 100
  const prefix = change >= 0 ? '↑' : '↓'
  const tone: Tone = change > 0 ? 'good' : change < 0 ? 'critical' : 'neutral'
  return { label: `${prefix} ${Math.abs(change).toFixed(1)}%`, tone, detail }
}

function EChart({
  ariaLabel,
  className = '',
  chartLayout,
  chartStyle,
  option,
}: {
  ariaLabel: string
  className?: string
  chartLayout?: string
  chartStyle?: string
  option: EChartsOption
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const chart = echarts.init(container, undefined, { renderer: 'canvas' })
    chart.setOption(option, true)

    const resizeChart = () => chart.resize()
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            resizeChart()
          })
        : null

    resizeObserver?.observe(container)
    window.addEventListener('resize', resizeChart)

    return () => {
      window.removeEventListener('resize', resizeChart)
      resizeObserver?.disconnect()
      chart.dispose()
    }
  }, [option])

  return (
    <div
      aria-label={ariaLabel}
      className={`echart-canvas ${className}`.trim()}
      data-chart-engine="echarts"
      data-chart-layout={chartLayout}
      data-chart-source="real"
      data-chart-style={chartStyle}
      ref={containerRef}
      role="img"
    />
  )
}

function RevenueOverviewChart({ embedded = false, trendData }: { embedded?: boolean; trendData: TrendDatum[] }) {
  const option = useMemo(() => buildRevenueTrendOption(trendData), [trendData])
  const content = trendData.length > 0 ? (
    <div className="revenue-chart-wrap">
      <EChart
        ariaLabel="กราฟรายวันแบบแยกเส้นรายได้ ค่าโฆษณา และยอดนัดหมาย"
        chartLayout="separated-lanes"
        chartStyle="separated-lines"
        className="revenue-echart"
        option={option}
      />
    </div>
  ) : (
    <div className="performance-empty-chart">
      <div className="performance-empty-lines" aria-hidden="true">
        <span className="line green" />
        <span className="line blue" />
        <span className="line purple" />
      </div>
      <EmptyState title="ยังไม่มีข้อมูลแนวโน้ม" detail="กราฟจะแสดงเมื่อมีข้อมูลรายวันของค่าโฆษณา รายได้ และยอดนัดหมายในช่วงวันที่นี้" />
    </div>
  )

  if (embedded) {
    return (
      <div className="revenue-chart-panel is-embedded">
        <div className="revenue-chart-inline-head">
          <StatusBadge label="รายวัน" tone="info" />
        </div>
        {content}
      </div>
    )
  }

  return (
    <SectionCard
      action={<StatusBadge label="รายวัน" tone="info" />}
      className="revenue-chart-panel"
      collapsible
      title="Performance Overview"
      subtitle="ค่าโฆษณา รายได้ และยอดนัดหมายรายวันจากข้อมูลล่าสุด"
    >
      {content}
    </SectionCard>
  )
}

export function AdGroupsPage({
  adSets,
  ads,
  campaigns,
  onMutationComplete,
}: {
  adSets: WorkspaceData['adSets']
  ads: WorkspaceData['adInsights']
  campaigns: Campaign[]
  onMutationComplete: () => Promise<void>
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [statusFilter, setStatusFilter] = useState<AdGroupStatusFilter>('all')
  const [viewMode, setViewMode] = useState<AdGroupViewMode>('groupedByCampaign')
  const [selectedAdSetId, setSelectedAdSetId] = useState('')
  const [pendingApprovalCommand, setPendingApprovalCommand] = useState<AdGroupApprovalCommand | null>(null)
  const [editRow, setEditRow] = useState<AdGroupRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editBudget, setEditBudget] = useState('')
  const [approvalError, setApprovalError] = useState('')
  const [isSendingApproval, setIsSendingApproval] = useState(false)

  const rows = useMemo(
    () => buildAdGroupRows({ adSets, ads, campaigns, lastSyncedAt: '' }),
    [adSets, ads, campaigns],
  )
  const filteredRows = useMemo(
    () => filterAdGroupRows(rows, { campaignId, searchQuery, statusFilter }),
    [campaignId, rows, searchQuery, statusFilter],
  )
  const groupedRows = useMemo(() => groupAdGroupRowsByCampaign(filteredRows), [filteredRows])
  const selectedFilteredRow = filteredRows.find((row) => row.id === selectedAdSetId)
  const selectedRow = selectedFilteredRow ?? filteredRows[0]
  const selectedRowId = selectedRow?.id ?? ''
  const activeCount = rows.filter((row) => row.deliveryStatus === 'active').length
  const adsCount = rows.reduce((sum, row) => sum + row.adsCount, 0)
  const selectedAds = selectedRow ? ads.filter((ad) => ad.adSetId === selectedRow.id) : []

  const selectRow = (row: AdGroupRow) => {
    setSelectedAdSetId(row.id)
  }

  const openEditRow = (row: AdGroupRow) => {
    setApprovalError('')
    setEditRow(row)
    setEditName(row.name)
    setEditBudget(String(row.budget))
  }

  const queueStatusCommand = (row: AdGroupRow) => {
    setApprovalError('')
    if (row.deliveryStatus === 'paused') {
      setPendingApprovalCommand(createAdGroupApprovalCommand({ operation: 'resume_adset', proposedValue: 'ACTIVE', row }))
      return
    }

    setPendingApprovalCommand(createAdGroupApprovalCommand({ operation: 'pause_adset', proposedValue: 'PAUSED', row }))
  }

  const queueEditCommand = () => {
    if (!editRow) return
    const validation = validateAdGroupEditDraft({
      budgetText: editBudget,
      currentBudget: editRow.budget,
      currentName: editRow.name,
      nameText: editName,
    })

    if (validation.error) {
      setApprovalError(validation.error)
      return
    }

    setApprovalError('')
    if (validation.params.name !== undefined && validation.params.daily_budget === undefined) {
      setPendingApprovalCommand(
        createAdGroupApprovalCommand({
          operation: 'rename_adset',
          proposedValue: { name: validation.params.name },
          row: editRow,
        }),
      )
    } else {
      setPendingApprovalCommand(
        createAdGroupApprovalCommand({
          operation: 'update_budget',
          proposedValue: validation.params,
          row: editRow,
        }),
      )
    }
    setEditRow(null)
  }

  const approveCommand = async () => {
    if (!pendingApprovalCommand || isSendingApproval) return
    const request = adGroupApprovalCommandToMetaRequest(pendingApprovalCommand)
    setIsSendingApproval(true)
    setApprovalError('')

    try {
      await apiJson(request.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      await onMutationComplete()
      setPendingApprovalCommand(null)
    } catch (error) {
      setApprovalError(error instanceof Error ? formatApiMessage(error.message) : 'ส่งคำสั่งไป Meta ไม่สำเร็จ')
    } finally {
      setIsSendingApproval(false)
    }
  }

  const rowList = (listRows: AdGroupRow[]) => (
    <div className="ad-groups-row-list">
      {listRows.map((row) => (
        <button
          aria-pressed={selectedRowId === row.id}
          className={`ad-groups-row ${selectedRowId === row.id ? 'selected' : ''}`}
          key={row.id}
          type="button"
          onClick={() => selectRow(row)}
        >
          <span className="ad-groups-row-main">
            <strong>{row.name}</strong>
            <small>{row.campaignName} · {row.audience}</small>
          </span>
          <span className="ad-groups-row-side">
            <StatusBadge label={deliveryLabel(row.deliveryStatus)} tone={deliveryTone(row.deliveryStatus)} />
            <small>{row.adsCount} Ads</small>
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="ad-groups-workspace">
      <section className="ad-groups-main">
        <div className="ad-groups-header">
          <div>
            <span className="ad-groups-eyebrow">Ad Set operations</span>
            <h2>Ad Groups</h2>
            <p>ตรวจ Ad Set แยกจาก Campaigns ก่อนส่งคำสั่งไป Meta</p>
          </div>
          <div className="ad-groups-stats" aria-label="สรุป Ad Groups">
            <MetricLine label="Ad Set ทั้งหมด" value={fmtNum(rows.length)} />
            <MetricLine label="เปิดอยู่" value={fmtNum(activeCount)} />
            <MetricLine label="Ads รวม" value={fmtNum(adsCount)} />
          </div>
        </div>

        <div className="ad-groups-controls">
          <label className="ad-groups-search search-box">
            <Search size={15} />
            <span>ค้นหา Ad Set หรือ Campaign</span>
            <input
              aria-label="ค้นหา Ad Set หรือ Campaign"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="พิมพ์ชื่อ Ad Set, Campaign หรือกลุ่มเป้าหมาย"
            />
          </label>
          <label className="ad-groups-select">
            <span>Campaign</span>
            <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
              <option value="">ทุก Campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>
          <label className="ad-groups-select">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AdGroupStatusFilter)}>
              <option value="all">ทุกสถานะ</option>
              <option value="active">เปิดอยู่</option>
              <option value="paused">หยุดอยู่</option>
              <option value="pending">รอตรวจคำสั่ง</option>
            </select>
          </label>
          <div className="ad-groups-view-toggle" role="group" aria-label="มุมมอง Ad Groups">
            <button
              aria-pressed={viewMode === 'flat'}
              className={viewMode === 'flat' ? 'selected' : ''}
              type="button"
              onClick={() => setViewMode('flat')}
            >
              รายการรวม
            </button>
            <button
              aria-pressed={viewMode === 'groupedByCampaign'}
              className={viewMode === 'groupedByCampaign' ? 'selected' : ''}
              type="button"
              onClick={() => setViewMode('groupedByCampaign')}
            >
              จัดกลุ่มตาม Campaign
            </button>
          </div>
        </div>

        <div className="ad-groups-list-panel">
          {filteredRows.length > 0 ? (
            viewMode === 'groupedByCampaign' ? (
              <div className="ad-groups-campaign-groups">
                {groupedRows.map((group) => (
                  <section className="ad-groups-campaign-group" key={group.campaignId}>
                    <div className="ad-groups-group-head">
                      <strong>{group.campaignName}</strong>
                      <span>{group.rows.length} Ad Set</span>
                    </div>
                    {rowList(group.rows)}
                  </section>
                ))}
              </div>
            ) : (
              rowList(filteredRows)
            )
          ) : (
            <EmptyState title="ไม่พบ Ad Set" detail="ลองล้างคำค้นหา เปลี่ยน Campaign หรือเลือกสถานะอื่น" />
          )}
        </div>
      </section>

      <AdGroupsInspector
        row={selectedRow}
        selectedAds={selectedAds}
        onEdit={openEditRow}
        onStatusChange={queueStatusCommand}
      />
      {editRow ? (
        <AdGroupEditModal
          editBudget={editBudget}
          editName={editName}
          error={approvalError}
          row={editRow}
          setEditBudget={setEditBudget}
          setEditName={setEditName}
          onCancel={() => {
            setApprovalError('')
            setEditRow(null)
          }}
          onQueue={queueEditCommand}
        />
      ) : null}
      {pendingApprovalCommand ? (
        <AdGroupApprovalModal
          command={pendingApprovalCommand}
          error={approvalError}
          isSending={isSendingApproval}
          onCancel={() => {
            setApprovalError('')
            setPendingApprovalCommand(null)
          }}
          onApprove={() => void approveCommand()}
        />
      ) : null}
    </div>
  )
}

function AdGroupsInspector({
  row,
  selectedAds,
  onEdit,
  onStatusChange,
}: {
  row?: AdGroupRow
  selectedAds: WorkspaceData['adInsights']
  onEdit: (row: AdGroupRow) => void
  onStatusChange: (row: AdGroupRow) => void
}) {
  const [showAdsDetailRowId, setShowAdsDetail] = useState<string | null>(null)
  const showAdsDetail = Boolean(row && showAdsDetailRowId === row.id)

  if (!row) {
    return (
      <aside className="ad-groups-inspector" aria-label="รายละเอียด Ad Set ที่เลือก">
        <EmptyState title="ยังไม่มี Ad Set" detail="เชื่อมข้อมูลจาก Meta เพื่อเริ่มตรวจ Ad Groups" />
      </aside>
    )
  }

  const statusLabel = row.deliveryStatus === 'paused' ? 'เปิด Ad Set' : 'ปิด Ad Set'
  const statusTone = row.deliveryStatus === 'paused' ? 'good' : 'danger'

  return (
    <aside className="ad-groups-inspector" aria-label="รายละเอียด Ad Set ที่เลือก">
      <div className="ad-groups-inspector-head">
        <StatusBadge label={deliveryLabel(row.deliveryStatus)} tone={deliveryTone(row.deliveryStatus)} />
        <h3>{row.name}</h3>
        <p>{row.audience}</p>
      </div>
      <div className="ad-groups-review-state">
        <strong>ตรวจคำสั่งก่อนส่ง Meta</strong>
        <p>ทุกคำสั่งเปลี่ยน Ad Set จะเข้าหน้ายืนยันก่อนส่งไป Meta</p>
      </div>
      <div className="ad-groups-action-grid" aria-label="Ad Set actions">
        <button className={`outline-button ${statusTone}`} type="button" onClick={() => onStatusChange(row)}>
          <Power size={15} />
          {statusLabel}
        </button>
        <button className="outline-button" type="button" onClick={() => onEdit(row)}>
          <Pencil size={15} />
          แก้งบ / แก้ชื่อ
        </button>
        <button
          aria-controls="ad-groups-ads-detail"
          aria-expanded={showAdsDetail}
          className="outline-button"
          type="button"
          onClick={() => setShowAdsDetail((current) => (current === row.id ? null : row.id))}
        >
          <Eye size={15} />
          {showAdsDetail ? 'ซ่อน Ads' : 'ดู Ads'}
        </button>
      </div>
      <div className="ad-groups-detail-lines">
        <MetricLine label="Campaign" value={row.campaignName} />
        <MetricLine label="Status" value={deliveryLabel(row.deliveryStatus)} />
        <MetricLine label="Budget" value={row.budgetDisplay} />
        <MetricLine label="Spend" value={fmtMoney(row.spend)} />
        <MetricLine label="Bookings" value={fmtNum(row.bookings)} />
        <MetricLine label="ROAS" value={`${row.roas.toFixed(2)}x`} />
      </div>
      <section className="ad-groups-ads-summary">
        <div className="ad-groups-group-head">
          <strong>Ads summary</strong>
          <span>{row.adsCount} Ads</span>
        </div>
        <MetricLine label="Active Ads" value={fmtNum(row.activeAdsCount)} />
        <MetricLine label="Paused Ads" value={fmtNum(row.pausedAdsCount)} />
        {selectedAds.length > 0 ? (
          <div className="ad-groups-ad-chips">
            {selectedAds.map((ad) => (
              <span key={ad.id}>{ad.name}</span>
            ))}
          </div>
        ) : (
          <EmptyState title="ยังไม่มี Ads" detail="Ad Set นี้ยังไม่มีโฆษณาใน workspace ล่าสุด" />
        )}
        {showAdsDetail ? (
          <div className="ad-groups-ads-detail" id="ad-groups-ads-detail">
            {selectedAds.length > 0 ? (
              selectedAds.map((ad) => (
                <article className="ad-groups-ad-detail-row" key={ad.id}>
                  <div>
                    <strong>{ad.name}</strong>
                    <span>{ad.creative} · {ad.status}</span>
                  </div>
                  <div className="ad-groups-ad-detail-metrics">
                    <MetricLine label="Spend" value={fmtMoney(ad.spend)} />
                    <MetricLine label="CTR" value={`${ad.ctr.toFixed(1)}%`} />
                    <MetricLine label="Leads" value={fmtNum(ad.leads)} />
                    <MetricLine label="Score" value={fmtNum(ad.score)} />
                  </div>
                </article>
              ))
            ) : (
              <EmptyState title="ไม่มีรายละเอียด Ads" detail="ยังไม่พบ Ads ที่ผูกกับ Ad Set นี้" />
            )}
          </div>
        ) : null}
      </section>
    </aside>
  )
}

function AdGroupEditModal({
  editBudget,
  editName,
  error,
  row,
  setEditBudget,
  setEditName,
  onCancel,
  onQueue,
}: {
  editBudget: string
  editName: string
  error: string
  row: AdGroupRow
  setEditBudget: (value: string) => void
  setEditName: (value: string) => void
  onCancel: () => void
  onQueue: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal ad-group-edit-modal" role="dialog" aria-modal="true" aria-labelledby="ad-group-edit-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดหน้าแก้ไข Ad Set">
          <X size={18} />
        </button>
        <StatusBadge label="เตรียมคำสั่งแก้ไข" tone="watch" />
        <h2 id="ad-group-edit-title">แก้งบ / แก้ชื่อ</h2>
        <p>ตั้งค่าที่ต้องการเปลี่ยนก่อนส่งเข้าหน้ายืนยัน งบรายวันเป็นหน่วยบาท</p>
        <div className="ad-group-edit-form">
          <label>
            <span>ชื่อ Ad Set</span>
            <input value={editName} onChange={(event) => setEditName(event.target.value)} />
          </label>
          <label>
            <span>งบรายวัน (THB)</span>
            <input inputMode="decimal" value={editBudget} onChange={(event) => setEditBudget(event.target.value)} />
          </label>
        </div>
        <div className="confirm-grid">
          <MetricLine label="Ad Set" value={row.name} />
          <MetricLine label="รหัสใน Meta" value={shortMetaId(row.id)} />
          <MetricLine label="Campaign" value={row.campaignName} />
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel}>
            ยกเลิก
          </button>
          <button className="primary-button" type="button" onClick={onQueue}>
            <Pencil size={14} />
            ตรวจคำสั่ง
          </button>
        </div>
      </section>
    </div>
  )
}

function AdGroupApprovalModal({
  command,
  error,
  isSending,
  onApprove,
  onCancel,
}: {
  command: AdGroupApprovalCommand
  error: string
  isSending: boolean
  onApprove: () => void
  onCancel: () => void
}) {
  const actionLabel = adGroupApprovalActionLabel(command)
  const proposedValue = adGroupApprovalProposedValue(command)

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ad-group-approval-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน Ad Set" disabled={isSending}>
          <X size={18} />
        </button>
        <StatusBadge label="ส่งคำสั่งจริง" tone={command.operation === 'pause_adset' ? 'critical' : 'watch'} />
        <h2 id="ad-group-approval-title">{actionLabel}</h2>
        <p>คำสั่งนี้จะเปลี่ยนข้อมูลจริงในบัญชีโฆษณาหลังคุณยืนยันเท่านั้น</p>
        <div className="confirm-grid">
          <MetricLine label="Ad Set" value={command.targetName} />
          <MetricLine label="รหัสใน Meta" value={shortMetaId(command.targetId)} />
          <MetricLine label="Campaign" value={command.parentCampaignName} />
          <MetricLine label="ค่าเดิม" value={String(command.currentValue)} />
          <MetricLine label="ค่าที่จะส่ง" value={proposedValue} />
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isSending}>
            ยกเลิก
          </button>
          <button className="danger-button" type="button" onClick={onApprove} disabled={isSending}>
            {isSending ? 'กำลังส่ง...' : 'อนุมัติและส่ง Meta'}
          </button>
        </div>
      </section>
    </div>
  )
}

function adGroupApprovalActionLabel(command: AdGroupApprovalCommand) {
  if (command.operation === 'pause_adset') return 'ปิด Ad Set'
  if (command.operation === 'resume_adset') return 'เปิด Ad Set'
  if (command.operation === 'rename_adset') return 'แก้ชื่อ Ad Set'
  return 'แก้งบ Ad Set'
}

function adGroupApprovalProposedValue(command: AdGroupApprovalCommand) {
  if (command.operation === 'pause_adset' || command.operation === 'resume_adset') {
    return mutationStatusLabel(command.proposedValue)
  }

  if (command.operation === 'rename_adset') {
    return command.proposedValue.name
  }

  const parts = []
  if (command.proposedValue.name) parts.push(`ชื่อ: ${command.proposedValue.name}`)
  if (command.proposedValue.daily_budget) parts.push(`งบ: ${fmtMoney(command.proposedValue.daily_budget / 100)}`)
  return parts.join(' · ')
}

function AdsManagerPage({
  adSets,
  ads,
  campaigns,
  onMutationComplete,
  onSelectCampaign,
  searchQuery,
  selectedCampaign,
  setSearchQuery,
}: {
  adSets: WorkspaceData['adSets']
  ads: WorkspaceData['adInsights']
  campaigns: Campaign[]
  onMutationComplete: () => Promise<void>
  onSelectCampaign: (id: string) => void
  searchQuery: string
  selectedCampaign?: Campaign
  setSearchQuery: (value: string) => void
}) {
  const [compactView, setCompactView] = useState(false)
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({})
  const [expandedAdSets, setExpandedAdSets] = useState<Record<string, boolean>>({})
  const [pendingMutation, setPendingMutation] = useState<AdsManagerMutation | null>(null)
  const [editTarget, setEditTarget] = useState<AdsEditTarget | null>(null)
  const [reviewTarget, setReviewTarget] = useState<AdsReviewTarget | null>(null)
  const [editName, setEditName] = useState('')
  const [editBudget, setEditBudget] = useState('')
  const [isMutating, setIsMutating] = useState(false)
  const [isReviewSyncing, setIsReviewSyncing] = useState(false)
  const [mutationMessage, setMutationMessage] = useState<string | null>(null)

  const adSetsByCampaign = useMemo(() => {
    const groups = new Map<string, WorkspaceData['adSets']>()
    for (const adSet of adSets) groups.set(adSet.campaignId, [...(groups.get(adSet.campaignId) ?? []), adSet])
    return groups
  }, [adSets])

  const adsByAdSet = useMemo(() => {
    const groups = new Map<string, WorkspaceData['adInsights']>()
    for (const ad of ads) groups.set(ad.adSetId, [...(groups.get(ad.adSetId) ?? []), ad])
    return groups
  }, [ads])

  const adsByCampaign = useMemo(() => {
    const groups = new Map<string, WorkspaceData['adInsights']>()
    for (const ad of ads) groups.set(ad.campaignId, [...(groups.get(ad.campaignId) ?? []), ad])
    return groups
  }, [ads])

  const query = searchQuery.trim().toLowerCase()
  const visibleCampaigns = campaigns.filter((campaign) => {
    if (!query) return true
    const campaignAdSets = adSetsByCampaign.get(campaign.id) ?? []
    const campaignAds = adsByCampaign.get(campaign.id) ?? []
    return [campaign.id, campaign.name, ...campaignAdSets.map((adSet) => `${adSet.id} ${adSet.name}`), ...campaignAds.map((ad) => `${ad.id} ${ad.name}`)]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const selectedAdSets = selectedCampaign ? adSetsByCampaign.get(selectedCampaign.id) ?? [] : []
  const selectedAds = selectedCampaign ? adsByCampaign.get(selectedCampaign.id) ?? [] : []
  const activeCampaigns = campaigns.filter((campaign) => campaign.deliveryStatus === 'active').length
  const activeAdSets = adSets.filter((adSet) => adSet.deliveryStatus === 'active').length
  const activeAds = ads.filter((ad) => ad.status === 'active').length

  const openEdit = (target: AdsEditTarget) => {
    setEditTarget(target)
    setEditName(target.objectName)
    setEditBudget(target.currentBudget && target.currentBudget > 0 ? String(Math.round(target.currentBudget)) : '')
    setMutationMessage(null)
  }

  const requestStatusChange = (
    objectType: AdsObjectType,
    objectId: string,
    objectName: string,
    currentStatus: 'active' | 'paused',
  ) => {
    setPendingMutation({
      kind: 'status',
      objectType,
      objectId,
      objectName,
      nextStatus: nextDeliveryStatus(currentStatus),
    })
  }

  const requestDelete = (objectType: AdsObjectType, objectId: string, objectName: string) => {
    setPendingMutation({ kind: 'delete', objectType, objectId, objectName })
  }

  const confirmMutation = async () => {
    if (!pendingMutation || isMutating) return
    setIsMutating(true)
    setMutationMessage(null)

    try {
      if (pendingMutation.kind === 'status') {
        await apiJson('/api/meta/object-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            objectType: pendingMutation.objectType,
            objectId: pendingMutation.objectId,
            status: pendingMutation.nextStatus,
          }),
        })
      } else {
        await apiJson('/api/meta/object', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operation: 'delete',
            objectType: pendingMutation.objectType,
            objectId: pendingMutation.objectId,
          }),
        })
      }

      await onMutationComplete()
      setMutationMessage(`${objectTypeLabel(pendingMutation.objectType)} ${pendingMutation.kind === 'delete' ? 'ถูกลบ' : 'ถูกอัปเดต'} ในบัญชีโฆษณาแล้ว`)
      setPendingMutation(null)
    } catch (error) {
      setMutationMessage(error instanceof Error ? formatApiMessage(error.message) : 'อัปเดตบัญชีโฆษณาไม่สำเร็จ')
    } finally {
      setIsMutating(false)
    }
  }

  const saveEdit = async () => {
    if (!editTarget || isMutating) return
    const params: Record<string, string | number> = {}
    const nextName = editName.trim()
    if (nextName && nextName !== editTarget.objectName) params.name = nextName

    if (editTarget.objectType !== 'ad' && editBudget.trim()) {
      const budgetValue = Number(editBudget)
      if (!Number.isFinite(budgetValue) || budgetValue < 1) {
        setMutationMessage('งบประมาณต้องอย่างน้อย 1 บาท')
        return
      }
      if (Math.round(budgetValue) !== Math.round(editTarget.currentBudget ?? 0)) {
        params.daily_budget = Math.round(budgetValue * 100)
      }
    }

    if (Object.keys(params).length === 0) {
      setMutationMessage('ยังไม่มีรายการเปลี่ยนแปลงให้บันทึก')
      return
    }

    setIsMutating(true)
    setMutationMessage(null)

    try {
      await apiJson('/api/meta/object', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'update',
          objectType: editTarget.objectType,
          objectId: editTarget.objectId,
          params,
        }),
      })
      await onMutationComplete()
      setMutationMessage(`${objectTypeLabel(editTarget.objectType)} ถูกอัปเดตในบัญชีโฆษณาแล้ว`)
      setEditTarget(null)
    } catch (error) {
      setMutationMessage(error instanceof Error ? formatApiMessage(error.message) : 'แก้ไขข้อมูลในบัญชีโฆษณาไม่สำเร็จ')
    } finally {
      setIsMutating(false)
    }
  }

  const toggleCampaign = (campaignId: string) => {
    setExpandedCampaigns((current) => ({ ...current, [campaignId]: !current[campaignId] }))
  }

  const openCampaign = (campaignId: string) => {
    onSelectCampaign(campaignId)
    if (!compactView) setExpandedCampaigns((current) => ({ ...current, [campaignId]: true }))
  }

  const focusCampaign = (campaignId: string) => {
    setSearchQuery('')
    openCampaign(campaignId)
    window.requestAnimationFrame(() => {
      document.getElementById(campaignDomId(campaignId))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const toggleAdSet = (adSetId: string) => {
    setExpandedAdSets((current) => ({ ...current, [adSetId]: !current[adSetId] }))
  }

  const recheckReviewState = async () => {
    if (isReviewSyncing) return
    setIsReviewSyncing(true)
    setMutationMessage(null)

    try {
      await onMutationComplete()
      setMutationMessage('ตรวจข้อมูลล่าสุดจากบัญชีโฆษณาแล้ว')
    } catch (error) {
      setMutationMessage(error instanceof Error ? formatApiMessage(error.message) : 'ตรวจข้อมูลล่าสุดไม่สำเร็จ')
    } finally {
      setIsReviewSyncing(false)
    }
  }

  return (
    <TwoColumnPage
      aside={
        <SectionCard collapsible title="แคมเปญที่เลือก" subtitle="รายละเอียดแคมเปญจากบัญชีโฆษณา">
          {selectedCampaign ? (
            <div className="detail-stack">
              <StatusBadge label={deliveryLabel(selectedCampaign.deliveryStatus)} tone={deliveryTone(selectedCampaign.deliveryStatus)} />
              <h3>{selectedCampaign.name}</h3>
              <MetricLine label="รหัสแคมเปญ" value={shortMetaId(selectedCampaign.id)} />
              <MetricLine label="งบประมาณ" value={fmtMoney(selectedCampaign.budget)} />
              <MetricLine label="ใช้จ่าย" value={fmtMoney(selectedCampaign.spend)} />
              <MetricLine label="ชุดโฆษณา / โฆษณา" value={`${selectedAdSets.length} / ${selectedAds.length}`} />
              <MetricLine label="ผลลัพธ์ที่บันทึกได้" value={fmtNum(selectedCampaign.conversions)} />
              <div className="campaign-detail-actions">
                <button className="outline-button" type="button" onClick={() => focusCampaign(selectedCampaign.id)}>
                  เปิดชุดโฆษณา
                </button>
                <button className="outline-button" type="button" onClick={() => setReviewTarget('campaign')}>
                  รีวิวแคมเปญ
                </button>
              </div>
            </div>
          ) : (
            <EmptyState title="ยังไม่ได้เลือกแคมเปญ" detail="ผลการค้นหาไม่พบแคมเปญ ล้างคำค้นหาเพื่อเลือกชุดโฆษณาที่เปิดอยู่" />
          )}
        </SectionCard>
      }
    >
      <SectionCard collapsible title="ตัวจัดการโฆษณา" subtitle="ดูและจัดการแคมเปญ ชุดโฆษณา และโฆษณาที่ใช้งานอยู่">
        <div className="ads-manager-toolbar">
          <label className="search-box ads-search">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="ค้นหาแคมเปญ ชุดโฆษณา หรือโฆษณา" />
          </label>
          <button className="outline-button" type="button" onClick={() => setCompactView((value) => !value)}>
            {compactView ? 'ขยายข้อมูล' : 'ย่อข้อมูล'}
          </button>
          <StatusBadge label={`${campaigns.length} แคมเปญ`} tone="neutral" />
          <StatusBadge label={`${adSets.length} ชุดโฆษณา`} tone="neutral" />
          <StatusBadge label={`${ads.length} โฆษณา`} tone="neutral" />
        </div>

        <div className="ads-summary-grid">
          <MetricLine label="แคมเปญที่เปิดอยู่" value={`${activeCampaigns}/${campaigns.length}`} />
          <MetricLine label="ชุดโฆษณาที่เปิดอยู่" value={`${activeAdSets}/${adSets.length}`} />
          <MetricLine label="โฆษณาที่เปิดอยู่" value={`${activeAds}/${ads.length}`} />
        </div>

        <div className="ads-type-legend" aria-label="คำอธิบายประเภทโฆษณา">
          <span><span className="ads-type-dot campaign" />แคมเปญ</span>
          <span><span className="ads-type-dot adset" />ชุดโฆษณา</span>
          <span><span className="ads-type-dot ad" />โฆษณา</span>
        </div>

        {mutationMessage ? <div className="ads-operation-message">{mutationMessage}</div> : null}

        <div className={`ads-hierarchy ${compactView ? 'compact' : ''}`}>
          {visibleCampaigns.length > 0 ? (
            visibleCampaigns.map((campaign) => {
              const campaignAdSets = adSetsByCampaign.get(campaign.id) ?? []
              const campaignAds = adsByCampaign.get(campaign.id) ?? []
              const isCollapsed = compactView || !expandedCampaigns[campaign.id]
              const CampaignIcon = isCollapsed ? ChevronRight : ChevronDown
              const campaignChildrenId = `campaign-children-${campaign.id}`

              return (
                <article className="ads-entity-group" id={campaignDomId(campaign.id)} key={campaign.id}>
                  <div className="ads-entity-row campaign">
                    {compactView ? (
                      <span className="ads-entity-indent compact-indent" />
                    ) : (
                      <button
                        className="ads-entity-toggle"
                        type="button"
                        aria-label={`${isCollapsed ? 'ขยาย' : 'พับ'} แคมเปญ ${campaign.name}`}
                        aria-controls={isCollapsed ? undefined : campaignChildrenId}
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleCampaign(campaign.id)}
                      >
                        <CampaignIcon size={16} />
                      </button>
                    )}
                    <button className="ads-entity-main" type="button" onClick={() => openCampaign(campaign.id)}>
                      <span className="ads-kind-line">
                        <span className="ads-type-badge campaign">แคมเปญ</span>
                        <span className="ads-object-id">{shortMetaId(campaign.id)}</span>
                      </span>
                      <strong>{campaign.name}</strong>
                      <span>{campaignAdSets.length} ชุดโฆษณา · {campaignAds.length} โฆษณา</span>
                    </button>
                    <StatusBadge label={deliveryLabel(campaign.deliveryStatus)} tone={deliveryTone(campaign.deliveryStatus)} />
                    {!compactView ? (
                      <div className="ads-entity-metrics">
                        <span>{fmtMoney(campaign.spend)} ใช้จ่าย</span>
                        <span>{campaign.roas.toFixed(2)}x ROAS</span>
                        <span>{fmtMoney(campaign.budget)} งบ</span>
                      </div>
                    ) : null}
                    <EntityActions
                      currentStatus={campaign.deliveryStatus}
                      objectName={campaign.name}
                      objectId={campaign.id}
                      objectType="campaign"
                      onDelete={requestDelete}
                      onEdit={openEdit}
                      onStatusChange={requestStatusChange}
                      budget={campaign.budget}
                    />
                  </div>

                  {!isCollapsed ? (
                    <div className="ads-entity-children" id={campaignChildrenId}>
                      {campaignAdSets.length > 0 ? (
                        campaignAdSets.map((adSet) => {
                          const adSetAds = adsByAdSet.get(adSet.id) ?? []
                          const isAdSetCollapsed = compactView || !expandedAdSets[adSet.id]
                          const AdSetIcon = isAdSetCollapsed ? ChevronRight : ChevronDown
                          const adSetChildrenId = `adset-children-${adSet.id}`

                          return (
                            <div className="ads-entity-branch" key={adSet.id}>
                              <div className="ads-entity-row adset">
                                {compactView ? (
                                  <span className="ads-entity-indent compact-indent" />
                                ) : adSetAds.length > 0 ? (
                                  <button
                                    className="ads-entity-toggle adset-toggle"
                                    type="button"
                                    aria-label={`${isAdSetCollapsed ? 'ขยาย' : 'พับ'} ชุดโฆษณา ${adSet.name}`}
                                    aria-controls={isAdSetCollapsed ? undefined : adSetChildrenId}
                                    aria-expanded={!isAdSetCollapsed}
                                    onClick={() => toggleAdSet(adSet.id)}
                                  >
                                    <AdSetIcon size={16} />
                                  </button>
                                ) : (
                                  <span className="ads-entity-indent" />
                                )}
                                <div className="ads-entity-main">
                                  <span className="ads-kind-line">
                                    <span className="ads-type-badge adset">ชุดโฆษณา</span>
                                    <span className="ads-object-id">{shortMetaId(adSet.id)}</span>
                                  </span>
                                  <strong>{adSet.name}</strong>
                                  <span>{adSetAds.length} โฆษณา · {adSet.audience}</span>
                                </div>
                                <StatusBadge label={deliveryLabel(adSet.deliveryStatus)} tone={deliveryTone(adSet.deliveryStatus)} />
                                {!compactView ? (
                                  <div className="ads-entity-metrics">
                                    <span>{fmtMoney(adSet.spend)} ใช้จ่าย</span>
                                    <span>{adSet.roas.toFixed(2)}x ROAS</span>
                                    <span>{fmtMoney(adSet.budget)} งบ</span>
                                  </div>
                                ) : null}
                                <EntityActions
                                  currentStatus={adSet.deliveryStatus}
                                  objectName={adSet.name}
                                  objectId={adSet.id}
                                  objectType="adset"
                                  onDelete={requestDelete}
                                  onEdit={openEdit}
                                  onStatusChange={requestStatusChange}
                                  budget={adSet.budget}
                                />
                              </div>

                              {!isAdSetCollapsed ? (
                                <div className="ads-entity-ad-list" id={adSetChildrenId}>
                                  {adSetAds.map((ad) => (
                                    <div className="ads-entity-row ad" key={ad.id}>
                                      <span className="ads-entity-indent" />
                                      <div className="ads-entity-main">
                                        <span className="ads-kind-line">
                                          <span className="ads-type-badge ad">โฆษณา</span>
                                          <span className="ads-object-id">{shortMetaId(ad.id)}</span>
                                        </span>
                                        <strong>{ad.name}</strong>
                                        <span>{ad.creative}</span>
                                      </div>
                                      <StatusBadge label={deliveryLabel(ad.status)} tone={deliveryTone(ad.status)} />
                                      {!compactView ? (
                                        <div className="ads-entity-metrics">
                                          <span>{fmtMoney(ad.spend)} ใช้จ่าย</span>
                                          <span>{ad.ctr.toFixed(2)}% CTR</span>
                                          <span>{ad.roas.toFixed(2)}x ROAS</span>
                                        </div>
                                      ) : null}
                                      <EntityActions
                                        currentStatus={ad.status}
                                        objectName={ad.name}
                                        objectId={ad.id}
                                        objectType="ad"
                                        onDelete={requestDelete}
                                        onEdit={openEdit}
                                        onStatusChange={requestStatusChange}
                                      />
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          )
                        })
                      ) : (
                        <EmptyState title="ยังไม่มีชุดโฆษณา" detail="บัญชีโฆษณายังไม่มีชุดโฆษณาสำหรับแคมเปญนี้" />
                      )}
                    </div>
                  ) : null}
                </article>
              )
            })
          ) : (
            <EmptyState title="ไม่พบรายการโฆษณา" detail="ล้างคำค้นหาหรือโหลดข้อมูลอีกครั้งเพื่อดูแคมเปญ ชุดโฆษณา และโฆษณา" />
          )}
        </div>
      </SectionCard>

      {reviewTarget ? (
        <AdsReviewModal
          activeAds={activeAds}
          activeAdSets={activeAdSets}
          activeCampaigns={activeCampaigns}
          adsCount={ads.length}
          adSetsCount={adSets.length}
          campaignsCount={campaigns.length}
          isSyncing={isReviewSyncing}
          onClose={() => setReviewTarget(null)}
          onOpenCampaign={selectedCampaign ? () => focusCampaign(selectedCampaign.id) : undefined}
          onRecheck={recheckReviewState}
          selectedAds={selectedAds.length}
          selectedAdSets={selectedAdSets.length}
          selectedCampaign={selectedCampaign}
          target={reviewTarget}
        />
      ) : null}

      {pendingMutation ? (
        <MetaMutationModal isExecuting={isMutating} mutation={pendingMutation} onCancel={() => setPendingMutation(null)} onConfirm={confirmMutation} />
      ) : null}

      {editTarget ? (
        <EditMetaObjectModal
          editBudget={editBudget}
          editName={editName}
          isSaving={isMutating}
          target={editTarget}
          onCancel={() => setEditTarget(null)}
          onSave={saveEdit}
          setEditBudget={setEditBudget}
          setEditName={setEditName}
        />
      ) : null}
    </TwoColumnPage>
  )
}

function AdsReviewModal({
  activeAds,
  activeAdSets,
  activeCampaigns,
  adsCount,
  adSetsCount,
  campaignsCount,
  isSyncing,
  onClose,
  onOpenCampaign,
  onRecheck,
  selectedAds,
  selectedAdSets,
  selectedCampaign,
  target,
}: {
  activeAds: number
  activeAdSets: number
  activeCampaigns: number
  adsCount: number
  adSetsCount: number
  campaignsCount: number
  isSyncing: boolean
  onClose: () => void
  onOpenCampaign?: () => void
  onRecheck: () => Promise<void>
  selectedAds: number
  selectedAdSets: number
  selectedCampaign?: Campaign
  target: AdsReviewTarget
}) {
  const isCampaignReview = target === 'campaign'
  const isStaleReview = target === 'stale'
  const title = isCampaignReview ? 'ตรวจแคมเปญที่เลือก' : isStaleReview ? 'ตรวจข้อมูลที่อาจไม่ล่าสุด' : 'รีวิวข้อมูลล่าสุด'
  const tone: Tone = isCampaignReview ? (selectedCampaign ? deliveryTone(selectedCampaign.deliveryStatus) : 'neutral') : isStaleReview ? 'watch' : 'good'
  const statusLabel = isCampaignReview
    ? selectedCampaign
      ? deliveryLabel(selectedCampaign.deliveryStatus)
      : 'ยังไม่มีแคมเปญ'
    : isStaleReview
      ? 'ต้องตรวจซ้ำ'
      : 'พร้อม'
  const detail = isCampaignReview
    ? 'ใช้แผงนี้รีวิวแคมเปญที่เลือก และกลับไปยังชุดโฆษณาในโครงสร้างได้ทันที'
    : isStaleReview
      ? 'โหลดข้อมูลใหม่ก่อนตัดสินใจปรับแคมเปญ ถ้าความสดของข้อมูลยังไม่ชัดเจน'
      : 'โหลดข้อมูลจากบัญชีโฆษณาแล้ว และแยกเป็นแคมเปญ ชุดโฆษณา และโฆษณาเรียบร้อย'
  const checks = isCampaignReview
    ? [
        { label: 'แคมเปญที่เลือก', value: selectedCampaign ? selectedCampaign.name : 'ยังไม่มีแคมเปญที่เลือก' },
        { label: 'ชุดโฆษณาในแคมเปญ', value: `${selectedAdSets} ชุดโฆษณา` },
        { label: 'โฆษณาในแคมเปญ', value: `${selectedAds} โฆษณา` },
      ]
    : [
        { label: 'แคมเปญ', value: `${campaignsCount} ทั้งหมด · เปิดอยู่ ${activeCampaigns}` },
        { label: 'ชุดโฆษณา', value: `${adSetsCount} ทั้งหมด · เปิดอยู่ ${activeAdSets}` },
        { label: 'โฆษณา', value: `${adsCount} ทั้งหมด · เปิดอยู่ ${activeAds}` },
      ]

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal review-modal" role="dialog" aria-modal="true" aria-labelledby="ads-review-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="ปิดหน้ารีวิว">
          <X size={18} />
        </button>
        <StatusBadge label={statusLabel} tone={tone} />
        <h2 id="ads-review-title">{title}</h2>
        <p>{detail}</p>

        <div className="confirm-grid review-grid">
          {isCampaignReview && selectedCampaign ? (
            <>
              <MetricLine label="รหัสแคมเปญ" value={shortMetaId(selectedCampaign.id)} />
              <MetricLine label="งบประมาณ" value={fmtMoney(selectedCampaign.budget)} />
              <MetricLine label="ใช้จ่าย" value={fmtMoney(selectedCampaign.spend)} />
              <MetricLine label="ROAS" value={`${selectedCampaign.roas.toFixed(2)}x`} />
              <MetricLine label="ผลลัพธ์ที่บันทึกได้" value={fmtNum(selectedCampaign.conversions)} />
            </>
          ) : (
            <>
              <MetricLine label="แคมเปญ" value={`${campaignsCount}`} />
              <MetricLine label="ชุดโฆษณา" value={`${adSetsCount}`} />
              <MetricLine label="โฆษณา" value={`${adsCount}`} />
              <MetricLine label="รายการที่เปิดอยู่" value={`${activeCampaigns + activeAdSets + activeAds}`} />
            </>
          )}
        </div>

        <div className="review-check-list" aria-label="รายการตรวจรีวิว">
          {checks.map((check) => (
            <div className="review-check-row" key={check.label}>
              <span>{check.label}</span>
              <strong>{check.value}</strong>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onClose}>
            ปิด
          </button>
          {isCampaignReview ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                onOpenCampaign?.()
                onClose()
              }}
              disabled={!onOpenCampaign}
            >
              เปิดชุดโฆษณา
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={() => void onRecheck()} disabled={isSyncing}>
              {isSyncing ? 'กำลังตรวจซ้ำ...' : 'ตรวจข้อมูลซ้ำ'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function EntityActions({
  budget,
  currentStatus,
  objectId,
  objectName,
  objectType,
  onDelete,
  onEdit,
  onStatusChange,
}: {
  budget?: number
  currentStatus: 'active' | 'paused'
  objectId: string
  objectName: string
  objectType: AdsObjectType
  onDelete: (objectType: AdsObjectType, objectId: string, objectName: string) => void
  onEdit: (target: AdsEditTarget) => void
  onStatusChange: (objectType: AdsObjectType, objectId: string, objectName: string, currentStatus: 'active' | 'paused') => void
}) {
  const nextStatus = nextDeliveryStatus(currentStatus)

  return (
    <div className="ads-actions">
      <button
        className={`icon-action ${nextStatus === 'PAUSED' ? 'danger' : 'good'}`}
        type="button"
        title={nextStatus === 'PAUSED' ? 'พักรายการนี้' : 'เปิดใช้งานรายการนี้'}
        aria-label={nextStatus === 'PAUSED' ? `พัก ${objectName}` : `เปิดใช้งาน ${objectName}`}
        onClick={() => onStatusChange(objectType, objectId, objectName, currentStatus)}
      >
        <Power size={15} />
      </button>
      <button
        className="icon-action"
        type="button"
        title="แก้ไขชื่อหรืองบประมาณ"
        aria-label={`แก้ไข ${objectName}`}
        onClick={() => onEdit({ objectType, objectId, objectName, currentBudget: budget })}
      >
        <Pencil size={15} />
      </button>
      <button
        className="icon-action danger"
        type="button"
        title="ลบรายการนี้"
        aria-label={`ลบ ${objectName}`}
        onClick={() => onDelete(objectType, objectId, objectName)}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

function MetaMutationModal({
  isExecuting,
  mutation,
  onCancel,
  onConfirm,
}: {
  isExecuting: boolean
  mutation: AdsManagerMutation
  onCancel: () => void
  onConfirm: () => void
}) {
  const isDelete = mutation.kind === 'delete'
  const actionLabel = isDelete ? 'ลบรายการนี้' : mutation.nextStatus === 'ACTIVE' ? 'เปิดใช้งานรายการนี้' : 'พักรายการนี้'
  const targetStatus = mutation.kind === 'status' ? mutation.nextStatus : 'Deleted'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ads-mutation-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={isDelete ? 'ลบข้อมูลจริง' : 'เปลี่ยนข้อมูลจริง'} tone="critical" />
        <h2 id="ads-mutation-title">{actionLabel}</h2>
        <p>
          รายการนี้จะเปลี่ยนข้อมูลจริงในบัญชีโฆษณา โปรดตรวจขอบเขตก่อนดำเนินการ
          {isDelete ? ' การลบจะกระทบข้อมูลและประวัติการแสดงผลของรายการนี้' : ''}
        </p>
        <div className="confirm-grid">
          <MetricLine label="รายการ" value={mutation.objectName} />
          <MetricLine label="ประเภท" value={objectTypeLabel(mutation.objectType)} />
          <MetricLine label="รหัสในบัญชีโฆษณา" value={mutation.objectId} />
          <MetricLine label="สถานะที่ต้องการ" value={mutationStatusLabel(targetStatus)} />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className="danger-button" type="button" onClick={onConfirm} disabled={isExecuting}>
            {isExecuting ? 'กำลังดำเนินการ...' : actionLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

function EditMetaObjectModal({
  editBudget,
  editName,
  isSaving,
  onCancel,
  onSave,
  setEditBudget,
  setEditName,
  target,
}: {
  editBudget: string
  editName: string
  isSaving: boolean
  onCancel: () => void
  onSave: () => void
  setEditBudget: (value: string) => void
  setEditName: (value: string) => void
  target: AdsEditTarget
}) {
  const canEditBudget = target.objectType !== 'ad'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ads-edit-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดหน้าแก้ไข" disabled={isSaving}>
          <X size={18} />
        </button>
        <StatusBadge label="แก้ไขข้อมูลจริง" tone="watch" />
        <h2 id="ads-edit-title">แก้ไข {objectTypeLabel(target.objectType)}</h2>
        <p>รายการแก้ไขจะถูกส่งไปยังบัญชีโฆษณาหลังคุณยืนยัน งบประมาณเป็นหน่วยบาทต่อวัน</p>
        <div className="ads-edit-form">
          <label>
            <span>ชื่อ</span>
            <input value={editName} onChange={(event) => setEditName(event.target.value)} />
          </label>
          {canEditBudget ? (
            <label>
              <span>งบรายวัน (THB)</span>
              <input inputMode="numeric" value={editBudget} onChange={(event) => setEditBudget(event.target.value)} placeholder="เว้นว่างเพื่อใช้ค่าเดิม" />
            </label>
          ) : null}
        </div>
        <div className="confirm-grid">
          <MetricLine label="รหัสรายการ" value={target.objectId} />
          <MetricLine label="ประเภท" value={objectTypeLabel(target.objectType)} />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isSaving}>
            ยกเลิก
          </button>
          <button className="primary-button" type="button" onClick={onSave} disabled={isSaving}>
            <Pencil size={14} />
            {isSaving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function InsightsPage({
  datePreset,
  onBrainApprovalActions,
  onOpenPlanExecution,
  onQueueBrainAction,
  recommendationStates,
  websiteContext,
  workspace,
}: {
  datePreset: string
  onBrainApprovalActions: (actions: MetaRecommendedAction[]) => void
  onOpenPlanExecution: (action: MetaRecommendedAction) => void
  onQueueBrainAction: (action: MetaRecommendedAction) => void
  recommendationStates: Record<string, ActionState>
  websiteContext: WebsiteContext
  workspace: WorkspaceData | null
}) {
  const metrics = useMemo<InsightsMetrics | null>(() => (workspace ? deriveInsightsMetrics(workspace) : null), [workspace])
  const analysisPayload = useMemo(
    () => (workspace ? buildInsightsAnalysisPayload({ accountName: websiteContext.route || 'PMC Ads Agent', datePreset, workspace }) : null),
    [datePreset, websiteContext.route, workspace],
  )
  const [cachedInsight, setCachedInsight] = useState<InsightsCachedInsight | null>(() => readInsightsCache())
  const [aiError, setAiError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [isAiRunning, setIsAiRunning] = useState(false)

  const fallbackInsight = useMemo(() => (analysisPayload ? buildFallbackInsightsCache(analysisPayload) : null), [analysisPayload])
  const visibleInsight = cachedInsight ?? fallbackInsight

  const runInsightsAiAnalysis = useCallback(async () => {
    if (!workspace || !analysisPayload || isAiRunning) return
    setIsAiRunning(true)
    setAiError('')
    setActionMessage('')

    try {
      const insightsPayload = {
        ...analysisPayload,
        attribution: analysisPayload.attribution,
        derivedMetrics: analysisPayload.derivedMetrics,
        freshness: analysisPayload.freshness,
        rawMetrics: analysisPayload.rawMetrics,
      }
      const result = await apiJson<AiBrainApiResponse>('/api/ai/brain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: 'Build the Insights AI Brief First analysis from structured Meta metrics, formulas, freshness, attribution, evidence, and approval-gated recommendations.',
          insightsPayload,
          websiteContext,
          workspace,
        }),
      })
      const normalized = normalizeInsightsAiResponse(result, analysisPayload)
      setCachedInsight(normalized)
      writeInsightsCache(normalized)
      onBrainApprovalActions(result.approvalActions ?? [])
      setActionMessage(`วิเคราะห์ล่าสุดแล้ว: ${normalized.recommendations.length} คำแนะนำ และ ${normalized.evidenceCards.length} หลักฐาน`)
    } catch (error) {
      setAiError(error instanceof Error ? formatApiMessage(error.message) : 'AI วิเคราะห์ Insights ไม่สำเร็จ')
    } finally {
      setIsAiRunning(false)
    }
  }, [analysisPayload, isAiRunning, onBrainApprovalActions, websiteContext, workspace])

  const openInsightsApproval = useCallback((recommendation: InsightsRecommendation) => {
    const approval = canOpenInsightsApprovalCommand(recommendation)
    const action = insightsRecommendationToMetaAction(recommendation)
    const state = recommendationStates[action.id] ?? 'Suggested'

    if (state === 'Approved' || state === 'Executing') {
      onOpenPlanExecution(action)
      return
    }

    if (!approval.allowed) {
      setActionMessage(approval.reason)
      return
    }

    setActionMessage('เปิดหน้าต่างอนุมัติแล้ว: ถ้าอนุมัติ ระบบจะเก็บเป็นแผนก่อน และยังไม่เปลี่ยนข้อมูลจริง')
    onQueueBrainAction(action)
  }, [onOpenPlanExecution, onQueueBrainAction, recommendationStates])

  if (!workspace || !metrics || !visibleInsight) {
    return (
      <TwoColumnPage>
        <section className="insights-workspace">
          <div className="insights-brief-panel">
            <StatusBadge label="ข้อมูลยังไม่พอ" tone="watch" />
            <EmptyState title="ต้อง Sync Meta ก่อนใช้ Insights" detail="เมื่อมีข้อมูล Campaign, Ad Set, Ads และ trend แล้ว ระบบจะสร้าง AI brief และสูตรวิเคราะห์ให้ทันที" />
          </div>
        </section>
      </TwoColumnPage>
    )
  }

  return (
    <TwoColumnPage>
      <section className="insights-workspace">
        <InsightsBriefPanel
          aiError={aiError}
          insight={visibleInsight}
          isAiRunning={isAiRunning}
          onRefresh={() => void runInsightsAiAnalysis()}
          workspace={workspace}
        />
        {actionMessage ? <p className="insights-action-message">{actionMessage}</p> : null}
        <InsightsMetricScoreboard metrics={metrics.scoreboard} />
        <InsightsTrendCharts trends={metrics.trends} />
        <InsightsFormulaDiagnostics diagnostics={visibleInsight.metricDiagnostics} />
        <InsightsEvidenceCards evidenceCards={visibleInsight.evidenceCards.length ? visibleInsight.evidenceCards : metrics.evidenceCards} />
        <InsightsRecommendationList
          onOpenApproval={openInsightsApproval}
          recommendationStates={recommendationStates}
          recommendations={visibleInsight.recommendations.length ? visibleInsight.recommendations : metrics.recommendations}
        />
      </section>
    </TwoColumnPage>
  )
}

function InsightsBriefPanel({
  aiError,
  insight,
  isAiRunning,
  onRefresh,
  workspace,
}: {
  aiError: string
  insight: InsightsCachedInsight
  isAiRunning: boolean
  onRefresh: () => void
  workspace: WorkspaceData
}) {
  const analyzedAt = formatShortDateTime(insight.analyzedAt)
  const metaSyncedAt = workspace.updatedAt ? formatShortDateTime(workspace.updatedAt) : 'รอข้อมูล'
  const cacheLabel = insight.source === 'ai' ? 'ข้อมูล AI ล่าสุด' : insight.source === 'cached' ? 'แคชล่าสุด' : 'สรุปจากสูตรล่าสุด'

  return (
    <section className="insights-brief-panel">
      <div className="insights-brief-head">
        <div>
          <div className="recommendation-badges">
            <StatusBadge label="สรุปล่าสุดจาก AI" tone="violet" />
            <StatusBadge label={cacheLabel} tone={insight.source === 'ai' ? 'good' : 'watch'} />
          </div>
          <h2>{insight.brief.title}</h2>
          <p>{insight.brief.summary}</p>
        </div>
        <button className="primary-button insights-refresh-button" type="button" onClick={onRefresh} disabled={isAiRunning}>
          <BrainCircuit size={16} />
          {isAiRunning ? 'กำลังวิเคราะห์' : 'วิเคราะห์ใหม่ด้วย AI'}
        </button>
      </div>
      <div className="insights-brief-meta">
        <InsightsConfidenceBadge confidence={insight.confidence} />
        <MetricLine label="ช่วงข้อมูล" value={insight.payload.dateWindow.preset} />
        <MetricLine label="ซิงก์ Meta ล่าสุด" value={metaSyncedAt} />
        <MetricLine label="วิเคราะห์ล่าสุด" value={analyzedAt} />
      </div>
      <div className="insights-brief-grid">
        <InsightsBriefBlock title="วันนี้ควรรู้อะไร" items={insight.brief.whatChanged} />
        <InsightsBriefBlock title="สิ่งที่ควรทำต่อ" items={insight.brief.whatToDoNext} />
        <InsightsBriefBlock title="ความเสี่ยงที่ต้องจับตา" items={insight.brief.risks.length ? insight.brief.risks : insight.dataWarnings} tone="watch" />
      </div>
      {aiError ? <InsightsDataWarning message={aiError} tone="critical" /> : null}
      {insight.dataWarnings.map((warning) => (
        <InsightsDataWarning key={warning} message={warning} tone="watch" />
      ))}
    </section>
  )
}

function InsightsBriefBlock({ items, title, tone = 'neutral' }: { items: string[]; title: string; tone?: Tone }) {
  return (
    <article className={`insights-brief-block ${tone}`}>
      <h3>{title}</h3>
      <ul>
        {items.slice(0, 4).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  )
}

function InsightsConfidenceBadge({ confidence }: { confidence: InsightsConfidence }) {
  const tone: Tone = confidence.level === 'สูง' ? 'good' : confidence.level === 'กลาง' ? 'watch' : 'critical'
  return (
    <div className="insights-confidence">
      <StatusBadge label={`ความมั่นใจ ${confidence.level}`} tone={tone} />
      <strong>{confidence.overall}%</strong>
      <small>{confidence.reasons.slice(0, 2).join(' · ')}</small>
    </div>
  )
}

function InsightsMetricScoreboard({ metrics }: { metrics: InsightsDerivedMetric[] }) {
  return (
    <section className="insights-section">
      <div className="insights-section-head">
        <div>
          <h2>ตัวเลขสำคัญ</h2>
          <p>Scoreboard และกราฟใช้ metric source ชุดเดียวกัน</p>
        </div>
        <StatusBadge label={`${metrics.length} metrics`} tone="info" />
      </div>
      <div className="insights-scoreboard">
        {metrics.map((metric) => (
          <article className={`insights-metric-card ${metric.availability}`} key={metric.key}>
            <span>{metric.label}</span>
            <strong>{formatInsightMetricValue(metric)}</strong>
            <small>{metric.formula}</small>
            {metric.changeRate !== null ? <em>{metric.changeRate >= 0 ? '+' : ''}{(metric.changeRate * 100).toFixed(1)}%</em> : <em>รอข้อมูลเทียบช่วงก่อน</em>}
          </article>
        ))}
      </div>
    </section>
  )
}

function InsightsTrendCharts({ trends }: { trends: InsightsMetrics['trends'] }) {
  return (
    <section className="insights-section">
      <div className="insights-section-head">
        <div>
          <h2>กราฟแนวโน้ม</h2>
          <p>ใช้ข้อมูลรายวันจาก Meta workspace และสูตร derived metrics</p>
        </div>
        <StatusBadge label={`${trends.length} วัน`} tone="neutral" />
      </div>
      <div className="insights-chart-grid">
        <article className="insights-chart-card">
          <h3>Spend vs Results</h3>
          <ResponsiveContainer height={220} width="100%">
            <BarChart data={trends} margin={{ bottom: 0, left: -18, right: 8, top: 12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} />
              <YAxis tickLine={false} />
              <Tooltip />
              <Bar dataKey="spend" fill="#B98247" radius={[6, 6, 0, 0]} />
              <Bar dataKey="results" fill="#315C6B" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
        <article className="insights-chart-card">
          <h3>CPA / ROAS / CTR</h3>
          <ResponsiveContainer height={220} width="100%">
            <BarChart data={trends} margin={{ bottom: 0, left: -18, right: 8, top: 12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} />
              <YAxis tickLine={false} />
              <Tooltip />
              <Bar dataKey="cpa" fill="#9E6042" radius={[6, 6, 0, 0]} />
              <Bar dataKey="roas" fill="#537A5A" radius={[6, 6, 0, 0]} />
              <Bar dataKey="ctr" fill="#7E6AA8" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>
    </section>
  )
}

function InsightsFormulaDiagnostics({ diagnostics }: { diagnostics: InsightsFormulaDiagnostic[] }) {
  return (
    <section className="insights-section">
      <div className="insights-section-head">
        <div>
          <h2>วิเคราะห์สาเหตุ</h2>
          <p>สูตร diagnostic แยกปัญหา CPA, ROAS, fatigue, waste, momentum และคุณภาพข้อมูล</p>
        </div>
      </div>
      <div className="insights-formula-grid">
        {diagnostics.map((diagnostic) => (
          <article className={`insights-diagnostic-card ${diagnostic.tone}`} key={diagnostic.id}>
            <div className="recommendation-badges">
              <StatusBadge label={diagnostic.availability === 'ready' ? 'คำนวณได้' : 'รอข้อมูล'} tone={diagnostic.availability === 'ready' ? diagnostic.tone : 'neutral'} />
              <StatusBadge label={`มั่นใจ ${diagnostic.confidence.overall}%`} tone={diagnostic.confidence.level === 'สูง' ? 'good' : diagnostic.confidence.level === 'กลาง' ? 'watch' : 'critical'} />
            </div>
            <h3>{diagnostic.title}</h3>
            <p>{diagnostic.summary}</p>
            <small>{diagnostic.formula}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

function InsightsEvidenceCards({ evidenceCards }: { evidenceCards: InsightsEvidenceCard[] }) {
  return (
    <section className="insights-section">
      <div className="insights-section-head">
        <div>
          <h2>หลักฐานที่ใช้</h2>
          <p>ผูกข้อสรุปกลับไปที่ Campaign, Ad Set, Ad หรือภาพรวมบัญชี</p>
        </div>
      </div>
      <div className="insights-evidence-grid">
        {evidenceCards.map((card) => (
          <article className="insights-evidence-card" key={card.id}>
            <div className="recommendation-badges">
              <StatusBadge label={objectTypeLabelForInsight(card.objectType)} tone="neutral" />
              <StatusBadge label={`มั่นใจ ${card.confidence.overall}%`} tone={card.confidence.level === 'สูง' ? 'good' : card.confidence.level === 'กลาง' ? 'watch' : 'critical'} />
            </div>
            <h3>{card.title}</h3>
            <strong>{card.objectName}</strong>
            <p>{card.formulaResult}</p>
            <div className="insights-evidence-metrics">
              {card.metricValues.map((metric) => (
                <MetricLine key={`${card.id}-${metric.label}`} label={metric.label} value={metric.value} />
              ))}
            </div>
            <small>{card.dateWindow} · {shortMetaId(card.objectId)}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

function InsightsRecommendationList({
  onOpenApproval,
  recommendationStates,
  recommendations,
}: {
  onOpenApproval: (recommendation: InsightsRecommendation) => void
  recommendationStates: Record<string, ActionState>
  recommendations: InsightsRecommendation[]
}) {
  return (
    <section className="insights-section">
      <div className="insights-section-head">
        <div>
          <h2>คำแนะนำที่ควรตรวจ</h2>
          <p>อ่านหลักฐานก่อนตัดสินใจ และต้องอนุมัติก่อนส่ง Meta ทุกครั้ง</p>
        </div>
      </div>
      <div className="insights-recommendation-list">
        {recommendations.map((recommendation) => {
          const approval = canOpenInsightsApprovalCommand(recommendation)
          const action = insightsRecommendationToMetaAction(recommendation)
          const state = recommendationStates[action.id] ?? 'Suggested'
          const isApprovedPlan = state === 'Approved' || state === 'Executing'
          return (
            <article className="insights-recommendation-card" key={recommendation.id}>
              <div>
                <div className="recommendation-badges">
                  <StatusBadge label={recommendation.requiresApproval ? 'ต้องอนุมัติก่อนส่ง Meta' : 'รีวิวเท่านั้น'} tone={recommendation.requiresApproval ? 'watch' : 'neutral'} />
                  <StatusBadge label={`มั่นใจ ${recommendation.confidence.overall}%`} tone={recommendation.confidence.level === 'สูง' ? 'good' : recommendation.confidence.level === 'กลาง' ? 'watch' : 'critical'} />
                  <StatusBadge label={actionStateLabel(state)} tone={state === 'Rejected' || state === 'Failed' ? 'critical' : isApprovedPlan ? 'good' : 'info'} />
                </div>
                <h3>{recommendation.title}</h3>
                <p>{recommendation.targetName}</p>
                <small>{recommendation.riskNote}</small>
              </div>
              <button className={approval.allowed || isApprovedPlan ? 'primary-button' : 'outline-button'} type="button" onClick={() => onOpenApproval(recommendation)}>
                <BookOpenCheck size={14} />
                {isApprovedPlan ? 'ดำเนินการแผน' : approval.allowed ? 'เปิดอนุมัติ' : 'ดูเหตุผล'}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function InsightsDataWarning({ message, tone }: { message: string; tone: Tone }) {
  return (
    <div className={`insights-data-warning ${tone}`}>
      <Info size={14} />
      <span>{message}</span>
    </div>
  )
}

function insightsRecommendationToMetaAction(recommendation: InsightsRecommendation): MetaRecommendedAction {
  const risk: MetaRecommendedAction['risk'] = recommendation.confidence.level === 'ต่ำ' ? 'High' : recommendation.confidence.level === 'กลาง' ? 'Medium' : 'Low'
  return {
    after: recommendation.action === 'pause' ? 'พักไว้เป็นแผนหลังตรวจหลักฐาน' : 'เปิดเป็นแผนรีวิวก่อนดำเนินการ',
    before: `เป้าหมายปัจจุบัน: ${recommendation.targetName}`,
    campaignId: recommendation.targetType === 'campaign' ? recommendation.targetId : '',
    confidence: recommendation.confidence.overall,
    expectedImpact: recommendation.title,
    guardrail: recommendation.riskNote,
    id: `insights-${recommendation.id}`,
    requiresApproval: recommendation.requiresApproval,
    risk,
    rollbackNote: 'ยังไม่เปลี่ยนข้อมูลจริงจากหน้า Insights ถ้าต้องย้อนกลับให้กลับไปตรวจใน workspace ที่เกี่ยวข้อง',
    source: 'ai_brain',
    status: 'pending',
    summary: recommendation.title,
    target: recommendation.targetName,
    type: 'insights_review',
  }
}

function objectTypeLabelForInsight(type: InsightsEvidenceCard['objectType']) {
  if (type === 'campaign') return 'Campaign'
  if (type === 'adset') return 'Ad Set'
  if (type === 'ad') return 'Ad'
  return 'Account'
}

function MasterAgentSkeleton() {
  return (
    <div className="ai-brain-skeleton" aria-live="polite" aria-busy="true">
      <p className="ai-brain-skeleton-status">ระบบกำลังอ่านข้อมูลโฆษณาและสรุปคำแนะนำ</p>
      <div className="ai-brain-skeleton-summary">
        <span className="skeleton-chip" />
        <span className="skeleton-line wide" />
        <span className="skeleton-line" />
      </div>
      <div className="ai-brain-skeleton-grid">
        {[0, 1, 2, 3].map((item) => (
          <div className="ai-brain-skeleton-card" key={item}>
            <span className="skeleton-pill" />
            <span className="skeleton-line wide" />
            <span className="skeleton-line" />
            <span className="skeleton-line short" />
          </div>
        ))}
      </div>
      <div className="ai-brain-skeleton-card action">
        <span className="skeleton-line wide" />
        <span className="skeleton-line" />
        <span className="skeleton-button" />
      </div>
    </div>
  )
}

function autoAdSourceRecommendationLabel(recommendation?: WorkspaceData['autoAds'][number]['recommendation']) {
  if (recommendation === 'pause') return 'ข้อมูลโฆษณาเข้าเงื่อนไขปิด'
  if (recommendation === 'enable') return 'ข้อมูลโฆษณาเข้าเงื่อนไขเปิด'
  if (recommendation === 'keep') return 'ข้อมูลโฆษณาเข้าเงื่อนไขเปิดต่อ'
  if (recommendation === 'reduceBudget') return 'ข้อมูลโฆษณาเข้าเงื่อนไขลดแรงส่ง'
  return 'อ่านจากข้อมูลโฆษณาล่าสุด'
}

function autoAdsModeTone(mode: string): Tone {
  const normalized = normalizeAutomationMode(mode)
  if (normalized === 'พัก automation') return 'critical'
  if (normalized === 'ต้องอนุมัติก่อน') return 'good'
  return 'violet'
}

function createAutoAdPlan({
  ad,
  adSet,
  autoAd,
  campaign,
  thresholds,
}: {
  ad: WorkspaceData['adInsights'][number]
  adSet?: WorkspaceData['adSets'][number]
  autoAd?: WorkspaceData['autoAds'][number]
  campaign?: Campaign
  thresholds: AutoAdsThresholds
}): AutoAdPlan {
  const enoughSpend = ad.spend >= thresholds.minSpend
  const noBookingLeak = enoughSpend && ad.bookings === 0 && ad.roas === 0
  const lowReturn = enoughSpend && ad.roas > 0 && ad.roas < 1
  const weakCtr = ad.ctr > 0 && ad.ctr < thresholds.ctrFloor
  const winner = ad.roas >= thresholds.winnerRoas || ad.score >= 7.8 || (ad.bookings >= 2 && ad.roas >= 1.5)
  const sourcePause = autoAd?.recommendation === 'pause' && ad.status === 'active' && enoughSpend
  const sourceEnable = autoAd?.recommendation === 'enable' && ad.status === 'paused' && (winner || ad.score >= 6.5)
  const sourceReduce = autoAd?.recommendation === 'reduceBudget'
  const baseEvidence = [
    `ค่าโฆษณา ${fmtMoney(ad.spend)}`,
    `ROAS ${ad.roas.toFixed(2)}x`,
    `CTR ${ad.ctr.toFixed(2)}%`,
    `ยอดนัดหมาย ${fmtNum(ad.bookings)}`,
    `คะแนน ${ad.score.toFixed(1)}`,
    autoAdSourceRecommendationLabel(autoAd?.recommendation),
  ]
  const finalize = (plan: Omit<AutoAdPlan, 'blockedReason' | 'canQueue' | 'evidence' | 'sortScore'> & { evidence?: string[] }): AutoAdPlan => {
    const canQueue = Boolean(plan.targetStatus)
    const blockedReason = undefined
    return {
      ...plan,
      blockedReason,
      canQueue,
      confidence: 0,
      evidence: [...baseEvidence, ...(plan.evidence ?? [])],
      sortScore: plan.priority * 100000 + ad.spend,
    }
  }

  if (ad.status === 'active' && (noBookingLeak || lowReturn || sourcePause)) {
    const reason = noBookingLeak
      ? `ใช้จ่าย ${fmtMoney(ad.spend)} แล้วแต่ยังไม่มียอดนัดหมายที่บันทึกได้`
      : lowReturn
        ? `ROAS ${ad.roas.toFixed(2)}x ต่ำกว่าเกณฑ์หลังมีค่าโฆษณาแล้ว`
        : 'ข้อมูลโฆษณาเข้าเงื่อนไขควรหยุดเพื่อกันงบไหลต่อ'
    return finalize({
      id: `auto-os-${ad.id}`,
      ad,
      adSet,
      campaign,
      source: autoAd,
      decision: 'pause',
      targetStatus: 'PAUSED',
      label: 'ปิดเพื่อตัดงบที่ไม่สร้างผลลัพธ์',
      actionLabel: 'เพิ่มคิวปิด',
      reason,
      guardrail: `ปิดได้เมื่อค่าโฆษณาเกิน ${fmtMoney(thresholds.minSpend)} และมีสัญญาณผลลัพธ์หรือ ROAS ไม่ผ่านเกณฑ์`,
      impact: 'ลดค่าใช้จ่ายของโฆษณาที่ยังไม่สร้างยอดนัดหมาย และให้ทีมตรวจครีเอทีฟ ข้อเสนอ หรือการวัดผลก่อนเปิดใหม่',
      nextStep: 'เพิ่มเข้าคิว แล้วกดยืนยันคิว Auto Ads เพื่อส่งคำสั่งปิด',
      confidence: 0,
      priority: noBookingLeak ? 5 : 4,
      risk: 'High',
      tone: 'critical',
      evidence: noBookingLeak ? ['ไม่มียอดนัดหมายหลังมีค่าโฆษณา'] : lowReturn ? ['ROAS ต่ำกว่า 1.00x'] : ['ข้อมูลโฆษณาเข้าเงื่อนไขปิด'],
    })
  }

  if (ad.status === 'paused' && (winner || sourceEnable)) {
    return finalize({
      id: `auto-os-${ad.id}`,
      ad,
      adSet,
      campaign,
      source: autoAd,
      decision: 'activate',
      targetStatus: 'ACTIVE',
      label: 'เปิดกลับเพราะมีสัญญาณชนะ',
      actionLabel: 'เพิ่มคิวเปิด',
      reason: `แม้โฆษณาถูกพักอยู่ แต่มี ROAS ${ad.roas.toFixed(2)}x, ยอดนัดหมาย ${fmtNum(ad.bookings)} และคะแนน ${ad.score.toFixed(1)}`,
      guardrail: 'เปิดกลับเฉพาะโฆษณาที่มีสัญญาณชนะจากข้อมูลโฆษณา และโหลดข้อมูลใหม่หลังเปลี่ยนสถานะ',
      impact: 'ให้โฆษณาที่มีสัญญาณดีมีโอกาสกลับมาส่ง โดยยังคุมด้วยคิวอนุมัติก่อนเปลี่ยนข้อมูลจริง',
      nextStep: 'เพิ่มเข้าคิว แล้วส่งคำสั่งเปิดหลังตรวจรายการ',
      confidence: 0,
      priority: 4,
      risk: 'Medium',
      tone: 'good',
      evidence: ['อยู่ในสถานะหยุดอยู่', winner ? 'ผ่านเกณฑ์ตัวชนะ' : 'ข้อมูลโฆษณาเข้าเงื่อนไขเปิด'],
    })
  }

  if (ad.status === 'active' && winner) {
    return finalize({
      id: `auto-os-${ad.id}`,
      ad,
      adSet,
      campaign,
      source: autoAd,
      decision: 'keep',
      label: 'เปิดต่อและใช้เป็นตัวชนะ',
      actionLabel: 'ยังไม่ต้องเปลี่ยนข้อมูลจริง',
      reason: `ROAS ${ad.roas.toFixed(2)}x, ยอดนัดหมาย ${fmtNum(ad.bookings)} และคะแนน ${ad.score.toFixed(1)} ผ่านเกณฑ์ตัวชนะ`,
      guardrail: 'ไม่เปลี่ยนข้อมูลจริงในรอบนี้ ให้ใช้เป็นตัวอย่างสำหรับขยายผลหรือทำครีเอทีฟเวอร์ชันใหม่',
      impact: 'รักษาโฆษณาที่ทำงานดีไว้ และแยกออกจากกลุ่มที่ควรถูกปิด',
      nextStep: 'เปิดต่อและใช้คำแนะนำนี้เป็นต้นแบบของครีเอทีฟหรือกลุ่มเป้าหมายรอบถัดไป',
      confidence: 0,
      priority: 3,
      risk: 'Low',
      tone: 'good',
      evidence: ['ผ่านเกณฑ์ตัวชนะ'],
    })
  }

  if (weakCtr || ad.score < 5 || sourceReduce) {
    return finalize({
      id: `auto-os-${ad.id}`,
      ad,
      adSet,
      campaign,
      source: autoAd,
      decision: 'watch',
      label: 'เฝ้าดูและตรวจครีเอทีฟ',
      actionLabel: 'ยังไม่ส่งคำสั่ง',
      reason: weakCtr ? `CTR ${ad.ctr.toFixed(2)}% ต่ำกว่าเกณฑ์ ${thresholds.ctrFloor.toFixed(2)}%` : `คะแนน ${ad.score.toFixed(1)} ยังไม่พอให้สั่งเปิดหรือปิด`,
      guardrail: 'ยังไม่ปิดอัตโนมัติจนกว่าจะมีค่าโฆษณาและสัญญาณผลลัพธ์ชัดพอ',
      impact: 'กันการปิดเร็วเกินไป และส่งให้ตรวจข้อความเปิด กลุ่มเป้าหมาย หน้า landing หรือการวัดผล',
      nextStep: 'ติดตามอีกหนึ่งรอบ หรือส่งให้ทีมครีเอทีฟปรับชิ้นงานก่อนตัดสินใจ',
      confidence: 0,
      priority: 2,
      risk: 'Medium',
      tone: 'watch',
      evidence: weakCtr ? ['CTR ต่ำกว่าเกณฑ์'] : sourceReduce ? ['ข้อมูลโฆษณาเข้าเงื่อนไขลดแรงส่ง'] : ['คะแนนต่ำ'],
    })
  }

  return finalize({
    id: `auto-os-${ad.id}`,
    ad,
    adSet,
    campaign,
    source: autoAd,
    decision: ad.status === 'active' ? 'keep' : 'watch',
    label: ad.status === 'active' ? 'เปิดต่อแบบระมัดระวัง' : 'รอสัญญาณก่อนเปิดกลับ',
    actionLabel: 'ยังไม่ต้องเปลี่ยนข้อมูลจริง',
    reason: `ยังไม่มีสัญญาณบวกหรือลบที่แรงพอ · ค่าโฆษณา ${fmtMoney(ad.spend)} · ROAS ${ad.roas.toFixed(2)}x`,
    guardrail: 'รอข้อมูลรอบถัดไปก่อนดำเนินการ เพื่อเลี่ยงการเปลี่ยนสถานะที่ไม่จำเป็น',
    impact: 'เก็บข้อมูลต่อจนกว่าข้อมูลโฆษณาจะมีสัญญาณชัดพอ',
    nextStep: ad.status === 'active' ? 'เปิดต่อและติดตามตัวเลขหลัก' : 'ยังไม่เปิดกลับจนกว่าจะมีสัญญาณตัวชนะ',
    confidence: 0,
    priority: 1,
    risk: 'Low',
    tone: ad.status === 'active' ? 'neutral' : 'watch',
  })
}

function optimizerAiRequestKey(plans: AutoAdPlan[], datePreset: string, automationMode: string) {
  return [
    datePreset,
    automationMode,
    plans.length,
    ...plans
      .slice(0, 16)
      .map((plan) => `${plan.ad.id}:${plan.ad.status}:${Math.round(plan.ad.spend)}:${plan.ad.roas.toFixed(2)}:${plan.ad.bookings}:${plan.ad.ctr.toFixed(2)}`),
  ].join('|')
}

function buildOptimizerAiCandidatePayload(plans: AutoAdPlan[]) {
  return plans.slice(0, 25).map((plan) => ({
    adId: plan.ad.id,
    adName: plan.ad.name,
    adSetName: plan.adSet?.name ?? '',
    campaignName: plan.campaign?.name ?? '',
    currentStatus: plan.ad.status,
    deterministicDecision: plan.decision,
    targetStatus: plan.targetStatus ?? '',
    spend: plan.ad.spend,
    roas: plan.ad.roas,
    ctr: plan.ad.ctr,
    bookings: plan.ad.bookings,
    leads: plan.ad.leads,
    clicks: plan.ad.clicks,
    impressions: plan.ad.impressions,
    score: plan.ad.score,
    deterministicReason: plan.reason,
    deterministicGuardrail: plan.guardrail,
    evidence: plan.evidence.slice(0, 8),
  }))
}

// eslint-disable-next-line react-refresh/only-export-components
export function applyOptimizerAiDecisionToPlan(plan: AutoAdPlan, decision?: OptimizerAiDecision): AutoAdPlan {
  if (!decision) return plan

  const targetStatus = decision.decision === 'pause' ? 'PAUSED' : decision.decision === 'activate' ? 'ACTIVE' : undefined
  const writable = targetStatus === 'PAUSED' ? plan.ad.status === 'active' : targetStatus === 'ACTIVE' ? plan.ad.status === 'paused' : false
  const duplicateStatusReason =
    targetStatus === 'PAUSED' && plan.ad.status === 'paused'
      ? 'โฆษณานี้พักอยู่แล้ว จึงไม่ส่งคำสั่งปิดซ้ำ'
      : targetStatus === 'ACTIVE' && plan.ad.status === 'active'
        ? 'โฆษณานี้เปิดใช้งานอยู่แล้ว จึงไม่ส่งคำสั่งเปิดซ้ำ'
        : ''
  const tone: Tone =
    decision.decision === 'pause'
      ? 'critical'
      : decision.decision === 'activate' || decision.decision === 'keep'
        ? 'good'
        : decision.risk === 'High'
          ? 'critical'
          : 'watch'
  const conditionEvidence = decision.conditionAnalysis ? `AI condition: ${decision.conditionAnalysis}` : ''

  if (targetStatus && !writable && duplicateStatusReason) {
    return {
      ...plan,
      decision: 'watch',
      targetStatus: undefined,
      actionLabel: 'ตรวจสอบ ไม่ส่งคำสั่งซ้ำ',
      reason: `${duplicateStatusReason} ใช้เป็น checklist ตรวจข้อมูลก่อนเปลี่ยนสถานะครั้งถัดไป`,
      guardrail: decision.guardrail || plan.guardrail,
      nextStep: 'ตรวจสาเหตุและโหลดข้อมูลล่าสุดก่อนตัดสินใจอีกครั้ง',
      confidence: decision.confidence || plan.confidence,
      risk: decision.risk || plan.risk,
      tone: 'watch',
      canQueue: false,
      blockedReason: duplicateStatusReason,
      evidence: [conditionEvidence, duplicateStatusReason, ...plan.evidence].filter(Boolean).slice(0, 10),
      sortScore: plan.sortScore,
    }
  }

  return {
    ...plan,
    decision: decision.decision,
    targetStatus,
    actionLabel: decision.actionLabel || plan.actionLabel,
    reason: decision.reason || plan.reason,
    guardrail: decision.guardrail || plan.guardrail,
    nextStep: decision.nextStep || plan.nextStep,
    confidence: decision.confidence || plan.confidence,
    risk: decision.risk || plan.risk,
    tone,
    canQueue: writable,
    blockedReason: targetStatus && !writable ? 'สถานะปัจจุบันไม่ตรงกับ action ที่ AI แนะนำ จึงไม่ส่งคำสั่งซ้ำ' : plan.blockedReason,
    evidence: [conditionEvidence, ...plan.evidence].filter(Boolean).slice(0, 10),
    sortScore: (decision.confidence || 0) * 1000 + plan.priority * 100000 + plan.ad.spend,
  }
}

function optimizerAiConditionText(plan: AutoAdPlan) {
  const condition = plan.evidence.find((item) => item.startsWith('AI condition: '))
  return condition ? condition.replace('AI condition: ', '') : plan.guardrail
}

function optimizerConditionTone(risk: Recommendation['risk']): Tone {
  if (risk === 'High') return 'critical'
  if (risk === 'Medium') return 'watch'
  return 'good'
}

function optimizerUiText(value: string, fallback = '') {
  const cleaned = (value || fallback).trim()
  if (!cleaned) return fallback
  return cleaned
    .replace(/^โหมดแนะนำเท่านั้น:\s*/i, '')
    .replace(/^ต้องอนุมัติก่อน:\s*/i, '')
    .replace(/^พัก automation:\s*/i, '')
    .replace(/AI Optimizer/g, 'ตัวช่วยปรับแคมเปญ')
    .replace(/OpenAI/g, 'ระบบวิเคราะห์ที่เชื่อมไว้')
    .replace(/Responses API/g, 'บริการวิเคราะห์')
    .replace(/Settings/g, 'ตั้งค่า')
    .replace(/quota/gi, 'เครดิตการใช้งาน')
    .replace(/billing/gi, 'แพ็กเกจการใช้งาน')
    .replace(/fallback/gi, 'ผลตรวจเบื้องต้น')
    .replace(/schema/gi, 'รูปแบบข้อมูล')
    .replace(/\bAI\b/g, 'ระบบ')
    .replace(/\bad\b/gi, 'โฆษณา')
    .replace(/\bspend\b/gi, 'ค่าใช้จ่าย')
    .replace(/\bmetric score\b/gi, 'คะแนนรวม')
    .replace(/Meta metrics/gi, 'ข้อมูลโฆษณา')
    .replace(/winner/gi, 'ตัวชนะ')
    .replace(/booking/gi, 'ยอดนัดหมาย')
    .replace(/tracking/gi, 'การวัดผล')
    .replace(/\btrack\b/gi, 'วัดผล')
    .replace(/\bactive\b/gi, 'กำลังเปิด')
    .replace(/audience overlap/gi, 'กลุ่มเป้าหมายทับซ้อน')
    .replace(/creative\/audience/gi, 'ครีเอทีฟหรือกลุ่มเป้าหมาย')
    .replace(/diagnostic/gi, 'การตรวจหาสาเหตุ')
    .replace(/\boffer\b/gi, 'ข้อเสนอ')
    .replace(/\baudience\b/gi, 'กลุ่มเป้าหมาย')
    .replace(/\bcreative\b/gi, 'ครีเอทีฟ')
    .replace(/\bplacement\b/gi, 'ตำแหน่งโฆษณา')
    .replace(/\bhook\b/gi, 'มุมเปิดข้อความ')
    .replace(/conversion signal/gi, 'สัญญาณผลลัพธ์')
    .replace(/creative variation/gi, 'ชิ้นงานโฆษณาแบบใหม่')
    .replace(/\breference\b/gi, 'ตัวอย่างอ้างอิง')
    .replace(/\bscale\b/gi, 'เพิ่มแรงส่ง')
    .replace(/\bexecute\b/gi, 'ดำเนินการ')
    .replace(/\bguardrail\b/gi, 'เงื่อนไขก่อนทำ')
    .replace(/แม้ โฆษณา ถูก/g, 'แม้โฆษณาถูก')
    .replace(/ใช้จ่าย ฿/g, 'ค่าใช้จ่าย ฿')
    .replace(/ผ่านเกณฑ์ ตัวชนะ/g, 'ผ่านเกณฑ์ตัวชนะ')
    .replace(/ยัง กำลังเปิด/g, 'ยังเปิดอยู่')
    .replace(/เกิด ยอดจอง/g, 'เกิดยอดจอง')
    .replace(/ไม่มี ยอดจอง ที่ วัดผล ได้/g, 'ไม่มียอดจองที่วัดผลได้')
    .replace(/มี ยอดจอง/g, 'มียอดจอง')
    .replace(/ก่อน เพิ่มแรงส่ง/g, 'ก่อนเพิ่มแรงส่ง')
    .replace(/ใช้เป็น ตัวอย่างอ้างอิง/g, 'ใช้เป็นตัวอย่างอ้างอิง')
    .replace(/action cards?/gi, 'รายการดำเนินการ')
    .replace(/action/gi, 'รายการดำเนินการ')
    .replace(/ad-level candidates/gi, 'รายการโฆษณาที่ตรวจ')
    .replace(/workspace/gi, 'บัญชีโฆษณา')
    .replace(/Winner signal/gi, 'สัญญาณตัวชนะ')
    .replace(/Not enough data/gi, 'ข้อมูลยังไม่พอ')
    .replace(/Creative fatigue/gi, 'ครีเอทีฟเริ่มล้า')
    .replace(/ROAS weakness \/ spend leakage/gi, 'ผลตอบแทนอ่อน / งบไหล')
    .replace(/Tracking gap/gi, 'ช่องว่างการวัดผล')
}

function optimizerErrorText(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : 'วิเคราะห์ข้อมูล Optimizer ไม่สำเร็จ'
  const formatted = formatApiMessage(rawMessage)
  const lower = formatted.toLowerCase()
  if (lower.includes('exceeded your current quota') || lower.includes('billing') || lower.includes('quota')) {
    return 'การวิเคราะห์เชิงลึกยังไม่พร้อม เพราะเครดิตหรือแพ็กเกจของระบบวิเคราะห์ที่เชื่อมไว้ใช้งานไม่ได้ กรุณาตรวจในหน้า ตั้งค่า'
  }
  if (lower.includes('openai api key') || lower.includes('api key')) {
    return 'การเชื่อมต่อระบบวิเคราะห์ยังไม่พร้อม กรุณาตรวจ API Key ในหน้า ตั้งค่า'
  }
  if (lower.includes('openai request failed')) {
    return 'การวิเคราะห์เชิงลึกยังไม่พร้อม กรุณาลองใหม่อีกครั้ง'
  }
  return optimizerUiText(formatted, 'วิเคราะห์ข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
}

function AutoAdsPage({
  adSets,
  ads,
  automationMode,
  autoAds,
  campaigns,
  datePreset,
  onDateChange,
  onModeChange,
  onMutationComplete,
  trendData,
  workspace,
}: {
  adSets: WorkspaceData['adSets']
  ads: WorkspaceData['adInsights']
  automationMode: string
  autoAds: WorkspaceData['autoAds']
  campaigns: Campaign[]
  datePreset: string
  onDateChange: (value: string) => void
  onModeChange: (value: string) => void
  onMutationComplete: () => Promise<void>
  trendData: TrendPoint[]
  workspace: WorkspaceData | null
}) {
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [pendingPlan, setPendingPlan] = useState<AutoAdPlan | null>(null)
  const [reviewPlan, setReviewPlan] = useState<AutoAdPlan | null>(null)
  const [isExecutingPlan, setIsExecutingPlan] = useState(false)
  const [message, setMessage] = useState('')
  const [optimizerStrategy, setOptimizerStrategy] = useState<OptimizerStrategy>('all')
  const [pendingOptimizerBatch, setPendingOptimizerBatch] = useState<OptimizerBatch | null>(null)
  const [isExecutingOptimizerBatch, setIsExecutingOptimizerBatch] = useState(false)
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [optimizerAi, setOptimizerAi] = useState<OptimizerAiApiResponse | null>(null)
  const [optimizerAiError, setOptimizerAiError] = useState('')
  const [isOptimizerAiRunning, setIsOptimizerAiRunning] = useState(false)
  const lastOptimizerAiKeyRef = useRef('')
  const normalizedAutomationMode = normalizeAutomationMode(automationMode)
  const automationPaused = normalizedAutomationMode === 'พัก automation'
  const approvalMode = normalizedAutomationMode === 'ต้องอนุมัติก่อน'

  const campaignById = useMemo(() => new Map(campaigns.map((campaign) => [campaign.id, campaign])), [campaigns])
  const adSetById = useMemo(() => new Map(adSets.map((adSet) => [adSet.id, adSet])), [adSets])
  const autoAdById = useMemo(() => new Map(autoAds.map((autoAd) => [autoAd.adId, autoAd])), [autoAds])
  const basePlans = useMemo(
    () =>
      ads
        .map((ad) =>
          createAutoAdPlan({
            ad,
            adSet: adSetById.get(ad.adSetId),
            autoAd: autoAdById.get(ad.id),
            campaign: campaignById.get(ad.campaignId),
            thresholds: {
              confidenceFloor: 68,
              ctrFloor: 0.8,
              minSpend: 500,
              winnerRoas: 3,
            },
          }),
        )
        .sort((a, b) => b.sortScore - a.sortScore),
    [adSetById, ads, autoAdById, campaignById],
  )
  const aiDecisionByAdId = useMemo(() => new Map((optimizerAi?.decisions ?? []).map((decision) => [decision.adId, decision])), [optimizerAi])
  const aiAppliedPlans = useMemo(() => basePlans.map((plan) => applyOptimizerAiDecisionToPlan(plan, aiDecisionByAdId.get(plan.ad.id))), [aiDecisionByAdId, basePlans])
  const plans = useMemo(
    () => (optimizerAi ? aiAppliedPlans.filter((plan) => aiDecisionByAdId.has(plan.ad.id)) : []),
    [aiAppliedPlans, aiDecisionByAdId, optimizerAi],
  )
  const pausePlans = plans.filter((plan) => plan.decision === 'pause')
  const keepPlans = plans.filter((plan) => plan.decision === 'keep')
  const activatePlans = plans.filter((plan) => plan.decision === 'activate')
  const watchPlans = plans.filter((plan) => plan.decision === 'watch')
  const allRecommendationPlans = [...activatePlans, ...keepPlans, ...pausePlans, ...watchPlans]
  const optimizerPlans = allRecommendationPlans.filter((plan) => optimizerStrategy === 'all' || plan.decision === optimizerStrategy)
  const selectedPlan = optimizerPlans.find((plan) => plan.id === selectedPlanId) ?? plans.find((plan) => plan.id === selectedPlanId) ?? optimizerPlans[0] ?? plans[0]
  const recommendationPlans = showAllRecommendations ? optimizerPlans : optimizerPlans.slice(0, 3)
  const optimizerWritablePlans = optimizerPlans.filter(isOptimizerPlanWritable)
  const optimizerMetricPlans = optimizerAi ? optimizerPlans : basePlans
  const optimizerSpend = optimizerMetricPlans.reduce((sum, plan) => sum + plan.ad.spend, 0)
  const optimizerRevenue = optimizerMetricPlans.reduce((sum, plan) => sum + plan.ad.spend * plan.ad.roas, 0)
  const optimizerRoas = optimizerSpend > 0 ? optimizerRevenue / optimizerSpend : 0
  const optimizerBookings = optimizerMetricPlans.reduce((sum, plan) => sum + plan.ad.bookings, 0)
  const optimizerButtonClass = automationPaused
    ? 'outline-button'
    : approvalMode && optimizerWritablePlans.some((plan) => plan.targetStatus === 'PAUSED')
      ? 'danger-button'
      : optimizerWritablePlans.length > 0
        ? 'primary-button'
        : 'outline-button'
  const optimizerButtonLabel = automationPaused
    ? 'Auto ปิดอยู่'
    : approvalMode
      ? optimizerWritablePlans.length > 0
        ? `ปรับบัญชีโฆษณา ${optimizerWritablePlans.length} รายการ`
        : 'ไม่มีรายการที่ต้องเปลี่ยนข้อมูลจริง'
      : optimizerWritablePlans.length > 0
        ? 'เปิด Auto เพื่อดำเนินการ'
        : 'ดูรายการแนะนำ'
  const optimizerStrategyCards: Array<{ count: number; strategy: OptimizerStrategy; tone: Tone }> = [
    { count: allRecommendationPlans.length, strategy: 'all', tone: 'info' },
    { count: activatePlans.length, strategy: 'activate', tone: 'good' },
    { count: keepPlans.length, strategy: 'keep', tone: 'good' },
    { count: pausePlans.length, strategy: 'pause', tone: 'critical' },
    { count: watchPlans.length, strategy: 'watch', tone: 'watch' },
  ]
  const aiConditionCards = optimizerAi?.conditions ?? []
  const aiAnalyzedCount = optimizerAi?.decisions.length ?? 0
  const optimizerUsedFallback = Boolean(optimizerAi?.modelFallback)
  const optimizerAiCheckedAt = optimizerAi?.checkedAt
    ? new Date(optimizerAi.checkedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    : ''
  const optimizerAiNotes = optimizerAi?.modelNotes.filter(Boolean).slice(0, 2).map((note) => optimizerUiText(note, note)) ?? []
  const optimizerPlanSummary = optimizerAi
    ? optimizerUiText(optimizerAi.summary, 'วิเคราะห์ข้อมูลล่าสุดแล้ว เลือกตรวจรายการที่ควรดำเนินการต่อได้ทันที')
    : 'กดวิเคราะห์ข้อมูลล่าสุดเพื่อสร้างแผน'
  const optimizerAiKey = optimizerAiRequestKey(basePlans, datePreset, automationMode)

  const runOptimizerAi = useCallback(async (mode: 'auto' | 'manual' = 'manual') => {
    if (!workspace || !basePlans.length || isOptimizerAiRunning) return
    if (mode === 'auto' && lastOptimizerAiKeyRef.current === optimizerAiKey) return

    setIsOptimizerAiRunning(true)
    setOptimizerAiError('')
    if (mode === 'manual') setMessage('กำลังตรวจข้อมูลโฆษณาและจัดลำดับแผน...')

    try {
      const result = await apiJson<OptimizerAiApiResponse>('/api/ai/optimizer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          automationMode,
          candidates: buildOptimizerAiCandidatePayload(basePlans),
          datePreset,
          workspace,
        }),
      })
      setOptimizerAi(result)
      lastOptimizerAiKeyRef.current = optimizerAiKey
      setMessage(mode === 'manual' ? 'วิเคราะห์ข้อมูลล่าสุดแล้ว ใช้แผนที่แสดงด้านล่างเพื่อตรวจและดำเนินการต่อ' : '')
    } catch (error) {
      const formatted = optimizerErrorText(error)
      setOptimizerAiError(formatted)
      if (mode === 'auto') lastOptimizerAiKeyRef.current = optimizerAiKey
      if (mode === 'manual') setMessage(formatted)
    } finally {
      setIsOptimizerAiRunning(false)
    }
  }, [automationMode, basePlans, datePreset, isOptimizerAiRunning, optimizerAiKey, workspace])

  useEffect(() => {
    if (!workspace || !basePlans.length) return
    const timer = window.setTimeout(() => {
      void runOptimizerAi('auto')
    }, 250)
    return () => window.clearTimeout(timer)
  }, [basePlans.length, optimizerAiKey, runOptimizerAi, workspace])

  const selectOptimizerStrategy = (strategy: OptimizerStrategy) => {
    setOptimizerStrategy(strategy)
    setShowAllRecommendations(false)
    setMessage('')
    const firstPlan = allRecommendationPlans.find((plan) => strategy === 'all' || plan.decision === strategy)
    if (firstPlan) setSelectedPlanId(firstPlan.id)
  }

  const startOptimizerBatch = () => {
    if (!optimizerPlans.length) {
      setMessage('ยังไม่มีรายการเข้าเงื่อนไขจากข้อมูลโฆษณาสำหรับกลยุทธ์นี้')
      return
    }
    const firstPlan = optimizerPlans[0]
    if (firstPlan) setSelectedPlanId(firstPlan.id)
    if (automationPaused) {
      setMessage('Auto ปิดอยู่: เปิด Auto ก่อนส่งคำสั่ง')
      return
    }
    if (!approvalMode) {
      if (optimizerWritablePlans.length > 0) {
        onModeChange('ต้องอนุมัติก่อน')
        setMessage(`ยืนยันเปิด Auto ก่อน แล้วกด "ปรับบัญชีโฆษณา ${optimizerWritablePlans.length} รายการ" เพื่อเปิดหน้าต่างยืนยันรายการ`)
        return
      }
      setShowAllRecommendations(true)
      setMessage(`พบ ${optimizerPlans.length} รายการจากบัญชีโฆษณา แต่ยังไม่มีคำสั่งที่ต้องส่ง`)
      return
    }
    if (!optimizerWritablePlans.length) {
      setMessage('กลุ่มนี้ยังไม่มีรายการที่ต้องส่งคำสั่งจริง ใช้เป็นรายการรีวิวเท่านั้น')
      return
    }
    setPendingOptimizerBatch({
      generatedAt: new Date().toISOString(),
      plans: optimizerWritablePlans.slice(0, 25),
      strategy: optimizerStrategy,
    })
    setMessage('')
  }

  const selectRecommendation = (plan: AutoAdPlan) => {
    setSelectedPlanId(plan.id)
    if (plan.targetStatus && !isOptimizerPlanWritable(plan)) {
      setReviewPlan(plan)
      setMessage(plan.blockedReason ?? 'รายการนี้ยังไม่พร้อมเปลี่ยนข้อมูลจริงจากสถานะปัจจุบัน')
      return
    }
    if (plan.targetStatus) {
      if (automationPaused) {
        setMessage('Auto ปิดอยู่: เปิด Auto ก่อนส่งคำสั่ง')
        return
      }
      if (!approvalMode) {
        setReviewPlan(plan)
        setMessage('')
        return
      }
      setPendingPlan(plan)
      setMessage('')
      return
    }
    setReviewPlan(plan)
    setMessage('')
  }

  const executePlan = async () => {
    if (!pendingPlan?.targetStatus || isExecutingPlan) return
    if (normalizedAutomationMode !== 'ต้องอนุมัติก่อน') {
      setMessage('ต้องเปิด Auto ก่อนส่งคำสั่ง แล้วกดยืนยันอีกครั้ง')
      setPendingPlan(null)
      return
    }
    setIsExecutingPlan(true)
    setMessage('')

    try {
      await apiJson('/api/meta/object-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          objectType: 'ad',
          objectId: pendingPlan.ad.id,
          status: pendingPlan.targetStatus,
        }),
      })
      await onMutationComplete()
      setMessage(`ใช้คำแนะนำแล้ว: ${pendingPlan.ad.name} ถูก${mutationStatusLabel(pendingPlan.targetStatus)}ในบัญชีโฆษณา`)
      setPendingPlan(null)
    } catch (error) {
      setMessage(error instanceof Error ? formatApiMessage(error.message) : 'อัปเดตสถานะในบัญชีโฆษณาไม่สำเร็จ')
    } finally {
      setIsExecutingPlan(false)
    }
  }

  const executeOptimizerBatch = async () => {
    if (!pendingOptimizerBatch || isExecutingOptimizerBatch) return
    if (normalizedAutomationMode !== 'ต้องอนุมัติก่อน') {
      setMessage('ต้องเปิด Auto ก่อนส่งคำสั่งจริง แล้วลองอีกครั้ง')
      setPendingOptimizerBatch(null)
      return
    }
    const writablePlans = pendingOptimizerBatch.plans.filter(isOptimizerPlanWritable)
    if (!writablePlans.length) {
      setMessage('ไม่มีรายการในชุดนี้ที่ยังเปลี่ยนข้อมูลจริงได้หลังตรวจสถานะล่าสุด')
      setPendingOptimizerBatch(null)
      return
    }

    setIsExecutingOptimizerBatch(true)
    setMessage('')
    try {
      for (const chunk of chunkArray(writablePlans, 25)) {
        await apiJson('/api/meta/bulk-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            actions: chunk.map((plan) => ({
              objectType: 'ad',
              objectId: plan.ad.id,
              status: plan.targetStatus,
            })),
          }),
        })
      }
      await onMutationComplete()
      setMessage(`อัปเดตสถานะในบัญชีโฆษณาแล้ว ${writablePlans.length} รายการ`)
      setPendingOptimizerBatch(null)
    } catch (error) {
      setMessage(error instanceof Error ? formatApiMessage(error.message) : 'ส่งคำสั่งไปบัญชีโฆษณาไม่สำเร็จ')
    } finally {
      setIsExecutingOptimizerBatch(false)
    }
  }

  return (
    <>
      <div className="optimizer-page optimizer-page-clean">
        <section className="optimizer-panel optimizer-ai-control">
          <div className="optimizer-panel-head optimizer-ai-head">
            <div>
              <h2>ตัวช่วยปรับแคมเปญ</h2>
              <p>ตรวจข้อมูลโฆษณาล่าสุด จัดลำดับแผน และให้ยืนยันก่อนส่งคำสั่งจริง</p>
            </div>
            <StatusBadge
              label={isOptimizerAiRunning ? 'กำลังตรวจข้อมูล' : optimizerAi ? (optimizerUsedFallback ? 'ผลตรวจเบื้องต้น' : 'วิเคราะห์ล่าสุดแล้ว') : 'พร้อมตรวจ'}
              tone={isOptimizerAiRunning ? 'info' : optimizerAi ? (optimizerUsedFallback ? 'watch' : 'good') : 'watch'}
            />
          </div>
          <div className="optimizer-control-panel">
            <div className="optimizer-control-main">
              <span>ภาพรวมแผน</span>
              <strong>{optimizerPlanSummary}</strong>
                <small>
                {optimizerAi
                  ? optimizerUsedFallback
                    ? `ตรวจ ${fmtNum(aiAnalyzedCount)} โฆษณา · ${optimizerAiCheckedAt} · แสดงผลตรวจเบื้องต้นก่อน ระหว่างรอตรวจการเชื่อมต่อระบบวิเคราะห์ในหน้า ตั้งค่า`
                    : `วิเคราะห์ ${fmtNum(aiAnalyzedCount)} โฆษณา · ${optimizerAiCheckedAt} · พร้อมใช้แผนที่แสดงด้านล่าง`
                  : 'ระบบจะแสดงเฉพาะแผนที่ผ่านการตรวจ พร้อมเหตุผลและเงื่อนไขก่อนดำเนินการ'}
              </small>
            </div>

            {optimizerAiNotes.length > 0 ? (
              <div className="optimizer-ai-notes">
                {optimizerAiNotes.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </div>
            ) : null}

            <div className="optimizer-control-kpis" aria-label="ตัวเลขสรุปสำหรับจัดลำดับแผน">
              <span>
                <small>{optimizerAi ? 'ตรวจแล้ว' : 'รอตรวจ'}</small>
                <strong>{fmtNum(aiAnalyzedCount || basePlans.length)} โฆษณา</strong>
              </span>
              <span>
                <small>พร้อมดำเนินการ</small>
                <strong>{fmtNum(optimizerWritablePlans.length)} รายการ</strong>
              </span>
              <span>
                <small>งบที่ตรวจ</small>
                <strong>{fmtMoneyShort(optimizerSpend)}</strong>
              </span>
              <span>
                <small>ROAS / ยอดนัดหมาย</small>
                <strong>{optimizerRoas > 0 ? `${optimizerRoas.toFixed(2)}x` : '0.00x'} · {fmtNum(optimizerBookings)}</strong>
              </span>
              <span>
                <small>ข้อมูลรายวัน</small>
                <strong>{fmtNum(trendData.length)} วัน</strong>
              </span>
            </div>

            <div className="optimizer-ai-toolbar">
              <select aria-label="ช่วงข้อมูล Optimizer" value={datePreset} onChange={(event) => onDateChange(event.target.value)}>
                {datePresetOptions.map((option) => (
                  <option value={option} key={option}>
                    {option}
                  </option>
                ))}
              </select>
              <AutomationToggleControl mode={automationMode} onModeChange={onModeChange} />
              <button className="primary-button" type="button" onClick={() => void runOptimizerAi('manual')} disabled={!workspace || !basePlans.length || isOptimizerAiRunning}>
                {isOptimizerAiRunning ? 'กำลังตรวจข้อมูล...' : 'วิเคราะห์ข้อมูลล่าสุด'}
              </button>
              <button
                aria-label={approvalMode ? 'เปิดหน้าต่างยืนยันรายการก่อนส่งคำสั่ง' : 'เปิด Auto เพื่อจัดคิวคำสั่ง'}
                className={optimizerButtonClass}
                type="button"
                onClick={startOptimizerBatch}
                disabled={automationPaused || optimizerPlans.length === 0 || (approvalMode && optimizerWritablePlans.length === 0)}
              >
                {optimizerButtonLabel}
              </button>
            </div>

            <div className="optimizer-strategy-tabs" role="tablist" aria-label="เลือกกลุ่มแผน Optimizer">
              {optimizerStrategyCards.map((card) => (
                <button
                  aria-selected={optimizerStrategy === card.strategy}
                  className={optimizerStrategy === card.strategy ? 'active' : ''}
                  key={card.strategy}
                  onClick={() => selectOptimizerStrategy(card.strategy)}
                  role="tab"
                  type="button"
                >
                  <span>{optimizerStrategyLabel(card.strategy)}</span>
                  <StatusBadge label={`${card.count}`} tone={card.tone} />
                </button>
              ))}
            </div>
            {optimizerAiError ? <p className="settings-message">{optimizerAiError}</p> : null}
          </div>
        </section>

        <div className="optimizer-clean-grid">
          <section className={`optimizer-panel optimizer-recommendations ${showAllRecommendations ? 'expanded' : ''}`}>
            <div className="optimizer-panel-head">
              <div>
                <h2>แผนที่ควรทำต่อ</h2>
                <p>{optimizerStrategyDetail(optimizerStrategy)}</p>
              </div>
              <StatusBadge label={`${optimizerPlans.length} รายการ`} tone={optimizerStrategyTone(optimizerStrategy)} />
            </div>
            <div className="optimizer-recommendation-list">
              {isOptimizerAiRunning && !recommendationPlans.length ? (
                <div className="optimizer-ai-loading" aria-busy="true" aria-live="polite">
                  {[0, 1, 2].map((item) => (
                    <div className="optimizer-ai-loading-card" key={item}>
                      <span className="skeleton-pill" />
                      <span className="skeleton-line wide" />
                      <span className="skeleton-line" />
                      <span className="skeleton-line short" />
                    </div>
                  ))}
                </div>
              ) : recommendationPlans.length > 0 ? (
                recommendationPlans.map((plan) => {
                  const writable = isOptimizerPlanWritable(plan)
                  return (
                    <article className={`optimizer-recommendation-row ${plan.tone} ${selectedPlan?.id === plan.id ? 'selected' : ''}`} key={plan.id}>
                      <div className={`optimizer-icon-box ${plan.tone}`}>
                        <BrainCircuit size={18} />
                      </div>
                      <div>
                        <strong>{optimizerRecommendationTitle(plan)}</strong>
                        <span>{plan.ad.name}</span>
                        <div className="optimizer-recommendation-meta">
                          <StatusBadge label={optimizerPlanStatusLabel(plan)} tone={plan.targetStatus === 'PAUSED' ? 'critical' : plan.targetStatus === 'ACTIVE' ? 'good' : plan.tone} />
                          <StatusBadge label={plan.confidence ? `มั่นใจ ${plan.confidence}%` : 'รอตรวจ'} tone={plan.confidence ? plan.tone : 'neutral'} />
                          <StatusBadge label={deliveryLabel(plan.ad.status)} tone={deliveryTone(plan.ad.status)} />
                          <StatusBadge label={shortMetaId(plan.ad.id)} tone="neutral" />
                        </div>
                        <p className="optimizer-recommendation-reason">{optimizerUiText(plan.reason, plan.reason)}</p>
                        <p className="optimizer-recommendation-condition">{optimizerUiText(optimizerAiConditionText(plan), optimizerAiConditionText(plan))}</p>
                        <small>{optimizerImpactText(plan)}</small>
                      </div>
                      <button
                        className={approvalMode && writable && plan.targetStatus === 'PAUSED' ? 'danger-button' : approvalMode && writable && plan.targetStatus === 'ACTIVE' ? 'primary-button' : 'outline-button'}
                        type="button"
                        onClick={() => selectRecommendation(plan)}
                        disabled={automationPaused && Boolean(plan.targetStatus)}
                      >
                        {optimizerPlanButtonLabel(plan, approvalMode, automationPaused)}
                      </button>
                    </article>
                  )
                })
              ) : (
                <EmptyState
                  title={optimizerAi ? 'ยังไม่มีแผนในกลุ่มนี้' : 'รอการวิเคราะห์'}
                  detail={optimizerAi ? 'ไม่พบรายการที่ควรแสดงในกลุ่มนี้' : 'ระบบจะแสดงแผนหลังตรวจข้อมูลโฆษณาล่าสุดเสร็จ'}
                />
              )}
            </div>
            {optimizerPlans.length > 3 && (
              <button
                aria-expanded={showAllRecommendations}
                className="optimizer-link-button"
                type="button"
                onClick={() => {
                  setShowAllRecommendations((current) => !current)
                  setMessage('')
                }}
              >
                {showAllRecommendations ? 'ย่อรายการ' : `ดูทั้งหมด ${optimizerPlans.length} รายการ`}
                {showAllRecommendations ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
            )}
          </section>

          <section className="optimizer-panel optimizer-condition-panel">
            <div className="optimizer-panel-head">
              <div>
                <h2>เหตุผลที่ระบบตรวจพบ</h2>
                <p>อ่านจากค่าใช้จ่าย ผลตอบแทน อัตราคลิก ยอดจอง และสถานะโฆษณาจริง</p>
              </div>
              <StatusBadge label={`${aiConditionCards.length} ประเด็น`} tone={aiConditionCards.length ? 'info' : 'neutral'} />
            </div>
            {isOptimizerAiRunning ? (
              <div className="optimizer-ai-loading" aria-busy="true" aria-live="polite">
                {[0, 1, 2].map((item) => (
                  <div className="optimizer-ai-loading-card" key={item}>
                    <span className="skeleton-pill" />
                    <span className="skeleton-line wide" />
                    <span className="skeleton-line" />
                    <span className="skeleton-line short" />
                  </div>
                ))}
              </div>
            ) : aiConditionCards.length > 0 ? (
              <div className="optimizer-condition-list">
                {aiConditionCards.map((condition) => (
                  <article className={`optimizer-condition-card ${optimizerConditionTone(condition.risk)}`} key={`${condition.title}-${condition.matchedAdIds.join('-')}`}>
                    <div>
                      <StatusBadge label={condition.risk === 'High' ? 'เสี่ยงสูง' : condition.risk === 'Medium' ? 'ต้องเฝ้าดู' : 'ปลอดภัยกว่า'} tone={optimizerConditionTone(condition.risk)} />
                      <StatusBadge label={`${condition.matchedAdIds.length} โฆษณา`} tone="neutral" />
                    </div>
                    <strong>{optimizerUiText(condition.title, condition.title)}</strong>
                    <p>{optimizerUiText(condition.analysis, condition.analysis)}</p>
                    <span>{optimizerUiText(condition.recommendedAction, condition.recommendedAction)}</span>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="ยังไม่มีเหตุผลที่ตรวจพบ"
                detail={workspace ? 'กดวิเคราะห์ข้อมูลล่าสุด เพื่อสร้างเหตุผลให้แต่ละแผน' : 'ต้องเชื่อมต่อบัญชีโฆษณาก่อน'}
              />
            )}
          </section>
        </div>
        {message ? <p className="settings-message">{message}</p> : null}
      </div>
    {pendingPlan ? (
      <OptimizerActionModal
        isExecuting={isExecutingPlan}
        onCancel={() => {
          if (!isExecutingPlan) setPendingPlan(null)
        }}
        onConfirm={executePlan}
        plan={pendingPlan}
      />
    ) : null}
    {reviewPlan ? (
      <OptimizerPlanDetailModal
        approvalMode={approvalMode}
        onClose={() => setReviewPlan(null)}
        onEnableApproval={() => {
          onModeChange('ต้องอนุมัติก่อน')
          setReviewPlan(null)
          setMessage(`ยืนยันเปิด Auto ก่อน แล้วเลือก "${optimizerPlanButtonLabel(reviewPlan, true, false)}" เพื่อเปิดหน้าต่างยืนยัน`)
        }}
        plan={reviewPlan}
      />
    ) : null}
    {pendingOptimizerBatch ? (
      <OptimizerBatchModal
        batch={pendingOptimizerBatch}
        isExecuting={isExecutingOptimizerBatch}
        onCancel={() => {
          if (!isExecutingOptimizerBatch) setPendingOptimizerBatch(null)
        }}
        onConfirm={executeOptimizerBatch}
      />
    ) : null}
    </>
  )
}

function OptimizerActionModal({
  isExecuting,
  onCancel,
  onConfirm,
  plan,
}: {
  isExecuting: boolean
  onCancel: () => void
  onConfirm: () => void
  plan: AutoAdPlan
}) {
  const actionLabel = plan.targetStatus ? mutationStatusLabel(plan.targetStatus) : 'ดูรายละเอียด'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="optimizer-action-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label="ส่งคำสั่งจริง" tone={plan.targetStatus === 'PAUSED' ? 'critical' : 'good'} />
        <h2 id="optimizer-action-title">ใช้คำแนะนำนี้กับบัญชีโฆษณา</h2>
        <p>หลังยืนยัน ระบบจะเปลี่ยนสถานะโฆษณานี้ในบัญชีโฆษณาจริง ตรวจชื่อโฆษณาและเหตุผลให้ครบก่อนดำเนินการ</p>
        <div className="confirm-grid">
          <MetricLine label="โฆษณา" value={plan.ad.name} />
          <MetricLine label="รหัสโฆษณา" value={shortMetaId(plan.ad.id)} />
          <MetricLine label="คำสั่งที่จะส่ง" value={actionLabel} />
          <MetricLine label="ค่าใช้จ่าย / ROAS" value={`${fmtMoney(plan.ad.spend)} · ${plan.ad.roas.toFixed(2)}x`} />
          <MetricLine label="ยอดนัดหมาย" value={fmtNum(plan.ad.bookings)} />
          <MetricLine label="เหตุผล" value={optimizerUiText(plan.reason, plan.reason)} />
          <MetricLine label="ถ้าต้องย้อนกลับ" value="เปิดหรือปิดกลับได้จาก Ads Manager หลังโหลดข้อมูลใหม่" />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className={plan.targetStatus === 'PAUSED' ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={isExecuting || !plan.targetStatus}>
            {isExecuting ? 'กำลังอัปเดตบัญชีโฆษณา...' : `ยืนยัน ${actionLabel}`}
          </button>
        </div>
      </section>
    </div>
  )
}

function OptimizerPlanDetailModal({
  approvalMode,
  onClose,
  onEnableApproval,
  plan,
}: {
  approvalMode: boolean
  onClose: () => void
  onEnableApproval: () => void
  plan: AutoAdPlan
}) {
  const actionLabel = plan.targetStatus ? mutationStatusLabel(plan.targetStatus) : 'ยังไม่ต้องส่งคำสั่ง'
  const cpa = plan.ad.bookings > 0 ? plan.ad.spend / plan.ad.bookings : 0

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal optimizer-detail-modal" role="dialog" aria-modal="true" aria-labelledby="optimizer-detail-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="ปิดรายละเอียดคำแนะนำ">
          <X size={18} />
        </button>
        <StatusBadge label={optimizerPlanStatusLabel(plan)} tone={plan.targetStatus === 'PAUSED' ? 'critical' : plan.targetStatus === 'ACTIVE' ? 'good' : plan.tone} />
        <h2 id="optimizer-detail-title">{optimizerRecommendationTitle(plan)}</h2>
        <p>รายละเอียดนี้อ้างอิงข้อมูลโฆษณารอบล่าสุด และจะยังไม่เปลี่ยนสถานะจริงจนกว่าคุณจะกดยืนยัน</p>
        <div className="confirm-grid">
          <MetricLine label="โฆษณา" value={plan.ad.name} />
          <MetricLine label="แคมเปญ" value={plan.campaign?.name ?? shortMetaId(plan.ad.campaignId)} />
          <MetricLine label="รหัสโฆษณา" value={shortMetaId(plan.ad.id)} />
          <MetricLine label="สถานะปัจจุบัน" value={deliveryLabel(plan.ad.status)} />
          <MetricLine label="สิ่งที่แนะนำ" value={actionLabel} />
          <MetricLine label="ค่าใช้จ่าย / ROAS" value={`${fmtMoney(plan.ad.spend)} · ${plan.ad.roas.toFixed(2)}x`} />
          <MetricLine label="ยอดนัดหมาย / CPA" value={`${fmtNum(plan.ad.bookings)} · ${cpa ? fmtMoney(cpa) : 'ยังไม่มียอดนัดหมาย'}`} />
          <MetricLine label="CTR / Score" value={`${plan.ad.ctr.toFixed(2)}% · ${plan.ad.score.toFixed(1)}`} />
          <MetricLine label="เหตุผล" value={optimizerUiText(plan.reason, plan.reason)} />
          <MetricLine label="เงื่อนไขก่อนทำ" value={optimizerUiText(plan.guardrail, plan.guardrail)} />
          <MetricLine label="ขั้นถัดไป" value={optimizerUiText(plan.nextStep, plan.nextStep)} />
        </div>
        <div className="optimizer-evidence-list" aria-label="หลักฐานจากข้อมูลโฆษณา">
          {plan.evidence.slice(0, 8).map((item) => (
            <span key={`${plan.id}-${item}`}>{optimizerUiText(item, item)}</span>
          ))}
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onClose}>
            ปิด
          </button>
          {plan.targetStatus && !approvalMode ? (
            <button className="primary-button" type="button" onClick={onEnableApproval}>
              เปิด Auto
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function OptimizerBatchModal({
  batch,
  isExecuting,
  onCancel,
  onConfirm,
}: {
  batch: OptimizerBatch
  isExecuting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const writablePlans = batch.plans.filter(isOptimizerPlanWritable)
  const pauseCount = writablePlans.filter((plan) => plan.targetStatus === 'PAUSED').length
  const activateCount = writablePlans.filter((plan) => plan.targetStatus === 'ACTIVE').length
  const checkedSpend = writablePlans.reduce((sum, plan) => sum + plan.ad.spend, 0)

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal optimizer-batch-modal" role="dialog" aria-modal="true" aria-labelledby="optimizer-batch-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยันรายการ" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label="ส่งคำสั่งหลายรายการ" tone={pauseCount > 0 ? 'critical' : 'good'} />
        <h2 id="optimizer-batch-title">ยืนยันรายการปรับแคมเปญ</h2>
        <p>หลังยืนยัน ระบบจะส่งคำสั่งไปบัญชีโฆษณาเฉพาะรายการที่ผ่านเงื่อนไขและตรวจแล้วเท่านั้น</p>
        <div className="confirm-grid">
          <MetricLine label="กลยุทธ์" value={optimizerStrategyLabel(batch.strategy)} />
          <MetricLine label="รายการที่จะส่งคำสั่ง" value={`${writablePlans.length} โฆษณา`} />
          <MetricLine label="ปิดโฆษณา" value={`${pauseCount} รายการ`} />
          <MetricLine label="เปิดโฆษณา" value={`${activateCount} รายการ`} />
          <MetricLine label="ค่าใช้จ่ายที่ตรวจ" value={fmtMoneyShort(checkedSpend)} />
          <MetricLine label="สร้างเมื่อ" value={new Date(batch.generatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} />
        </div>
        <div className="rule-run-list">
          {writablePlans.slice(0, 8).map((plan) => (
            <article className="rule-run-row" key={`optimizer-batch-${plan.ad.id}`}>
              <div>
                <StatusBadge label={mutationStatusLabel(plan.targetStatus)} tone={plan.targetStatus === 'PAUSED' ? 'critical' : 'good'} />
                <StatusBadge label={shortMetaId(plan.ad.id)} tone="neutral" />
              </div>
              <strong>{plan.ad.name}</strong>
              <span>{plan.campaign?.name ?? 'แคมเปญ'} · {optimizerUiText(plan.reason, plan.reason)}</span>
              <small>
                ค่าใช้จ่าย {fmtMoney(plan.ad.spend)} · ROAS {plan.ad.roas.toFixed(2)}x · ยอดนัดหมาย {fmtNum(plan.ad.bookings)}
              </small>
            </article>
          ))}
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className={pauseCount > 0 ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={isExecuting || writablePlans.length === 0}>
            {isExecuting ? 'กำลังส่งคำสั่ง...' : `ยืนยันส่งคำสั่ง ${writablePlans.length} รายการ`}
          </button>
        </div>
      </section>
    </div>
  )
}

function optimizerRecommendationTitle(plan: AutoAdPlan) {
  if (plan.decision === 'pause') return 'ปิดโฆษณาประสิทธิภาพต่ำ'
  if (plan.decision === 'activate') return 'เปิดโฆษณาที่มีสัญญาณดี'
  if (plan.decision === 'keep') return 'เปิดต่อเป็นตัวชนะ'
  return 'เฝ้าดูและปรับครีเอทีฟ'
}

function optimizerImpactText(plan: AutoAdPlan) {
  return `ข้อมูลโฆษณาล่าสุด: ค่าใช้จ่าย ${fmtMoneyShort(plan.ad.spend)} · ROAS ${plan.ad.roas.toFixed(2)}x · ยอดนัดหมาย ${fmtNum(plan.ad.bookings)}`
}

function optimizerPlanStatusLabel(plan: AutoAdPlan) {
  if (plan.targetStatus === 'ACTIVE') return 'พร้อมเปิดโฆษณา'
  if (plan.targetStatus === 'PAUSED') return 'พร้อมปิดโฆษณา'
  if (plan.decision === 'keep') return 'เปิดต่อ'
  return 'ดูข้อมูลก่อน'
}

function optimizerPlanButtonLabel(plan: AutoAdPlan, approvalMode: boolean, automationPaused: boolean) {
  if (automationPaused && plan.targetStatus) return 'พักอยู่'
  if (plan.targetStatus === 'ACTIVE') return approvalMode ? 'ยืนยันเปิดโฆษณา' : 'ดูเหตุผลเปิด'
  if (plan.targetStatus === 'PAUSED') return approvalMode ? 'ยืนยันปิดโฆษณา' : 'ดูเหตุผลปิด'
  return 'ดูรายละเอียด'
}

function optimizerStrategyLabel(strategy: OptimizerStrategy) {
  if (strategy === 'pause') return 'ปิดตัวเสีย'
  if (strategy === 'activate') return 'เปิดตัวชนะ'
  if (strategy === 'keep') return 'เปิดต่อ'
  if (strategy === 'watch') return 'เฝ้าดู'
  return 'ทั้งหมด'
}

function optimizerStrategyDetail(strategy: OptimizerStrategy) {
  if (strategy === 'pause') return 'เฉพาะโฆษณาที่เปิดอยู่และเข้าเงื่อนไขหยุดจากค่าใช้จ่าย, ROAS หรือยอดนัดหมาย'
  if (strategy === 'activate') return 'เฉพาะโฆษณาที่หยุดอยู่แต่มีสัญญาณชนะจากข้อมูลโฆษณาล่าสุด'
  if (strategy === 'keep') return 'โฆษณาที่เปิดอยู่และผ่านเกณฑ์ตัวชนะ ใช้เป็นต้นแบบโดยยังไม่เปลี่ยนข้อมูลจริง'
  if (strategy === 'watch') return 'โฆษณาที่ยังไม่ควรเปลี่ยนสถานะ แต่ควรติดตามครีเอทีฟหรือการวัดผล'
  return 'รวมทุกกลุ่มจากข้อมูลโฆษณาล่าสุด แล้วแยกเฉพาะรายการที่ส่งคำสั่งได้จริง'
}

function optimizerStrategyTone(strategy: OptimizerStrategy): Tone {
  if (strategy === 'pause') return 'critical'
  if (strategy === 'activate' || strategy === 'keep') return 'good'
  if (strategy === 'watch') return 'watch'
  return 'violet'
}

function isOptimizerPlanWritable(plan: AutoAdPlan): plan is AutoAdPlan & { targetStatus: 'ACTIVE' | 'PAUSED' } {
  if (!plan.targetStatus) return false
  if (plan.targetStatus === 'PAUSED') return plan.ad.status === 'active'
  if (plan.targetStatus === 'ACTIVE') return plan.ad.status === 'paused'
  return false
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export function AutoAdsPageDraft({
  adSets,
  ads,
  automationMode,
  autoAds,
  campaigns,
  onModeChange,
  onMutationComplete,
}: {
  adSets: WorkspaceData['adSets']
  ads: WorkspaceData['adInsights']
  automationMode: string
  autoAds: WorkspaceData['autoAds']
  campaigns: Campaign[]
  onModeChange: (value: string) => void
  onMutationComplete: () => Promise<void>
}) {
  const [minSpend, setMinSpend] = useState(500)
  const [winnerRoas, setWinnerRoas] = useState(2)
  const [ctrFloor, setCtrFloor] = useState(0.8)
  const [activeLane, setActiveLane] = useState<'all' | AutoAdDecision>('all')
  const [search, setSearch] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [queuedPlanIds, setQueuedPlanIds] = useState<Record<string, boolean>>({})
  const [skippedPlanIds, setSkippedPlanIds] = useState<Record<string, boolean>>({})
  const [isConfirming, setIsConfirming] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [autoAdsMessage, setAutoAdsMessage] = useState('')

  const safeMinSpend = clampNumber(minSpend, 100, 100000)
  const safeWinnerRoas = clampNumber(winnerRoas, 0.5, 20)
  const safeCtrFloor = clampNumber(ctrFloor, 0.1, 10)
  const thresholds = useMemo<AutoAdsThresholds>(
    () => ({
      confidenceFloor: 0,
      ctrFloor: safeCtrFloor,
      minSpend: safeMinSpend,
      winnerRoas: safeWinnerRoas,
    }),
    [safeCtrFloor, safeMinSpend, safeWinnerRoas],
  )
  const campaignById = useMemo(() => new Map(campaigns.map((campaign) => [campaign.id, campaign])), [campaigns])
  const adSetById = useMemo(() => new Map(adSets.map((adSet) => [adSet.id, adSet])), [adSets])
  const autoAdById = useMemo(() => new Map(autoAds.map((autoAd) => [autoAd.adId, autoAd])), [autoAds])
  const plans = useMemo(
    () =>
      ads
        .map((ad) =>
          createAutoAdPlan({
            ad,
            adSet: adSetById.get(ad.adSetId),
            autoAd: autoAdById.get(ad.id),
            campaign: campaignById.get(ad.campaignId),
            thresholds,
          }),
        )
        .sort((a, b) => b.sortScore - a.sortScore),
    [adSetById, ads, autoAdById, campaignById, thresholds],
  )
  const queueLimit = 25
  const queuedPlans = plans.filter((plan) => queuedPlanIds[plan.id] && plan.targetStatus && !skippedPlanIds[plan.id]).slice(0, queueLimit)
  const queueablePlans = plans.filter((plan) => plan.canQueue && !queuedPlanIds[plan.id] && !skippedPlanIds[plan.id])
  const query = search.trim().toLowerCase()
  const visiblePlans = plans.filter((plan) => {
    if (activeLane !== 'all' && plan.decision !== activeLane) return false
    if (!query) return true
    return `${plan.ad.name} ${plan.ad.id} ${plan.adSet?.name ?? ''} ${plan.campaign?.name ?? ''} ${plan.label} ${plan.reason}`.toLowerCase().includes(query)
  })
  const activePlan = plans.find((plan) => plan.id === selectedPlanId) ?? visiblePlans[0] ?? queuedPlans[0] ?? plans[0]
  const normalizedAutomationMode = normalizeAutomationMode(automationMode)
  const automationPaused = normalizedAutomationMode === 'พัก automation'
  const pauseCount = plans.filter((plan) => plan.decision === 'pause').length
  const keepCount = plans.filter((plan) => plan.decision === 'keep').length
  const activateCount = plans.filter((plan) => plan.decision === 'activate').length
  const watchCount = plans.filter((plan) => plan.decision === 'watch').length
  const confirmableCount = plans.filter((plan) => plan.canQueue && !skippedPlanIds[plan.id]).length
  const laneCards: Array<{ decision: AutoAdDecision; detail: string; count: number; tone: Tone }> = [
    { decision: 'pause', detail: 'ปิดโฆษณาที่ใช้งบแต่ยังไม่สร้างยอดนัดหมายหรือผลตอบแทน', count: pauseCount, tone: 'critical' },
    { decision: 'keep', detail: 'เปิดต่อและเก็บไว้เป็นตัวอย่างของโฆษณาที่ทำผลงานดี', count: keepCount, tone: 'good' },
    { decision: 'activate', detail: 'เปิดกลับเฉพาะโฆษณาที่หยุดอยู่แต่มีสัญญาณดี', count: activateCount, tone: 'violet' },
    { decision: 'watch', detail: 'เฝ้าดูครีเอทีฟ กลุ่มเป้าหมาย หรือการวัดผลต่อ', count: watchCount, tone: 'watch' },
  ]

  const queuePlan = (plan: AutoAdPlan) => {
    if (automationPaused) {
      setAutoAdsMessage('Auto ปิดอยู่ เปิด Auto ก่อนเพิ่มคำสั่งเข้าคิว')
      return
    }
    if (!plan.targetStatus) {
      setAutoAdsMessage('รายการนี้เป็นคำแนะนำเท่านั้น ยังไม่ต้องเปลี่ยนสถานะจริง')
      return
    }
    if (!plan.canQueue) {
      setAutoAdsMessage(plan.blockedReason ?? 'รายการนี้ยังไม่ผ่านเงื่อนไขความปลอดภัยสำหรับ Auto Ads')
      return
    }
    if (queuedPlans.length >= queueLimit && !queuedPlanIds[plan.id]) {
      setAutoAdsMessage(`คิวต่อรอบจำกัด ${queueLimit} รายการ เพื่อให้ตรวจรายการก่อนเปลี่ยนข้อมูลจริง`)
      return
    }
    setQueuedPlanIds((current) => ({ ...current, [plan.id]: true }))
    setSkippedPlanIds((current) => ({ ...current, [plan.id]: false }))
    setSelectedPlanId(plan.id)
    setAutoAdsMessage(`${plan.ad.name} ถูกเพิ่มเข้าคิว ${mutationStatusLabel(plan.targetStatus)} แล้ว`)
  }

  const queueSafePlans = () => {
    if (automationPaused) {
      setAutoAdsMessage('Auto ปิดอยู่ เปิด Auto ก่อนเพิ่มคำสั่งเข้าคิว')
      return
    }
    const candidates = queueablePlans.slice(0, queueLimit - queuedPlans.length)
    if (candidates.length === 0) {
      setAutoAdsMessage('ยังไม่มีโฆษณาที่ผ่านเงื่อนไขความปลอดภัยสำหรับเข้าคิวอัตโนมัติ')
      return
    }
    const next = Object.fromEntries(candidates.map((plan) => [plan.id, true]))
    setQueuedPlanIds((current) => ({ ...current, ...next }))
    setAutoAdsMessage(
      queueablePlans.length > candidates.length
        ? `เพิ่ม ${candidates.length} รายการแรกเข้าคิวแล้ว ที่เหลือให้ตรวจในรอบถัดไป`
        : `เพิ่ม ${candidates.length} รายการที่ผ่านเงื่อนไขเข้าคิวแล้ว`,
    )
  }

  const removeQueuedPlan = (planId: string) => {
    setQueuedPlanIds((current) => {
      const next = { ...current }
      delete next[planId]
      return next
    })
  }

  const toggleSkipPlan = (plan: AutoAdPlan) => {
    setSkippedPlanIds((current) => ({ ...current, [plan.id]: !current[plan.id] }))
    removeQueuedPlan(plan.id)
    setSelectedPlanId(plan.id)
  }

  const resetAnalysis = () => {
    setQueuedPlanIds({})
    setSkippedPlanIds({})
    setSearch('')
    setActiveLane('all')
    setSelectedPlanId(plans[0]?.id ?? '')
    setAutoAdsMessage(`วิเคราะห์ใหม่จากข้อมูลโฆษณา ${plans.length} รายการแล้ว`)
  }

  const openConfirmModal = () => {
    if (automationPaused) {
      setAutoAdsMessage('Auto ปิดอยู่ เปิด Auto ก่อนยืนยันคำสั่ง')
      return
    }
    if (queuedPlans.length === 0) {
      setAutoAdsMessage('ยังไม่มีคำสั่งในคิว เลือกโฆษณาที่ระบบแนะนำก่อน')
      return
    }
    if (normalizedAutomationMode !== 'ต้องอนุมัติก่อน') {
      onModeChange('ต้องอนุมัติก่อน')
    }
    setIsConfirming(true)
  }

  const executeQueuedPlans = async () => {
    if (queuedPlans.length === 0 || isExecuting) return
    setIsExecuting(true)
    setAutoAdsMessage('')

    try {
      await apiJson('/api/meta/bulk-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actions: queuedPlans.map((plan) => ({
            objectType: 'ad',
            objectId: plan.ad.id,
            status: plan.targetStatus,
          })),
        }),
      })
      await onMutationComplete()
      setAutoAdsMessage(`Auto Ads อัปเดตสถานะในบัญชีโฆษณาแล้ว ${queuedPlans.length} รายการ`)
      setQueuedPlanIds({})
      setIsConfirming(false)
    } catch (error) {
      setAutoAdsMessage(error instanceof Error ? formatApiMessage(error.message) : 'Auto Ads อัปเดตบัญชีโฆษณาไม่สำเร็จ')
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <>
      <TwoColumnPage
        aside={
          <>
            <SectionCard className="auto-os-inspector" collapsible title="โฆษณาที่กำลังรีวิว" subtitle="เหตุผล คำแนะนำ และรายการที่จะส่งหลังคุณยืนยัน">
              {activePlan ? (
                <div className="detail-stack">
                  <div className="auto-os-badges">
                    <StatusBadge label={autoAdDecisionLabel(activePlan.decision)} tone={activePlan.tone} />
                    <StatusBadge label={deliveryLabel(activePlan.ad.status)} tone={deliveryTone(activePlan.ad.status)} />
                    <StatusBadge label={`คะแนน ${activePlan.ad.score.toFixed(1)}`} tone={activePlan.tone} />
                  </div>
                  <h3 className="auto-os-inspector-title">{activePlan.ad.name}</h3>
                  <MetricLine label="แคมเปญ" value={activePlan.campaign?.name ?? shortMetaId(activePlan.ad.campaignId)} />
                  <MetricLine label="ชุดโฆษณา" value={activePlan.adSet?.name ?? shortMetaId(activePlan.ad.adSetId)} />
                  <MetricLine label="คำแนะนำ" value={activePlan.targetStatus ? mutationStatusLabel(activePlan.targetStatus) : 'ยังไม่ต้องเปลี่ยนข้อมูลจริง'} />
                  <MetricLine label="เหตุผล" value={activePlan.reason} />
                  <MetricLine label="เงื่อนไขก่อนทำ" value={activePlan.guardrail} />
                  <div className="auto-os-evidence-stack">
                    {activePlan.evidence.slice(0, 6).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                  <div className="campaign-detail-actions">
                    <button className={activePlan.targetStatus === 'PAUSED' ? 'danger-button' : 'primary-button'} type="button" onClick={() => queuePlan(activePlan)} disabled={!activePlan.targetStatus || automationPaused || !activePlan.canQueue}>
                      {activePlan.targetStatus ? activePlan.actionLabel : 'ยังไม่ต้องเปลี่ยนข้อมูลจริง'}
                    </button>
                    <button className="outline-button" type="button" onClick={() => toggleSkipPlan(activePlan)}>
                      {skippedPlanIds[activePlan.id] ? 'คืนคิว' : 'ข้ามรอบนี้'}
                    </button>
                  </div>
                </div>
              ) : (
                <EmptyState title="ยังไม่มีข้อมูลโฆษณา" detail="เชื่อมต่อบัญชีโฆษณาแล้ว Auto Ads จะวิเคราะห์โฆษณาให้" />
              )}
            </SectionCard>
            <SectionCard collapsible title="คิวคำสั่ง Auto Ads" subtitle="เปิด/ปิดระดับ Ad หลังตรวจรายการและกดยืนยัน">
              <div className="auto-os-queue-head">
                <StatusBadge label={`${queuedPlans.length}/${queueLimit} รายการ`} tone={queuedPlans.length > 0 ? 'violet' : 'neutral'} />
                <button className="primary-button" type="button" onClick={openConfirmModal} disabled={queuedPlans.length === 0 || automationPaused}>
                  ยืนยันคิว
                </button>
              </div>
              <div className="auto-os-queue-list">
                {queuedPlans.length > 0 ? (
                  queuedPlans.map((plan) => (
                    <div className="auto-os-queue-row" key={plan.id}>
                      <StatusBadge label={mutationStatusLabel(plan.targetStatus ?? '')} tone={plan.targetStatus === 'PAUSED' ? 'critical' : 'good'} />
                      <strong>{plan.ad.name}</strong>
                      <span>{shortMetaId(plan.ad.id)} · ค่าโฆษณา {fmtMoney(plan.ad.spend)}</span>
                      <button className="outline-button" type="button" onClick={() => removeQueuedPlan(plan.id)}>
                        เอาออก
                      </button>
                    </div>
                  ))
                ) : (
                  <EmptyState title="ยังไม่มีคำสั่งในคิว" detail="เลือกโฆษณาที่ระบบแนะนำให้ปิดหรือเปิดกลับ หรือใช้ปุ่มเพิ่มรายการที่ผ่านเงื่อนไข" />
                )}
              </div>
            </SectionCard>
          </>
        }
      >
        <SectionCard
          action={<StatusBadge label={automationDisplayLabel(automationMode)} tone={autoAdsModeTone(automationMode)} />}
          className="auto-os-command"
          title="ระบบ Auto Ads"
          subtitle="ระบบอ่านข้อมูลโฆษณาล่าสุด แล้วแยกว่าตัวไหนควรปิด เปิดต่อ เปิดกลับ หรือเฝ้าดู"
        >
          <div className="auto-os-command-grid">
            <div className="auto-os-command-copy">
              <div className="auto-os-brand-row">
                <span className="auto-os-orb">
                  <Power size={18} />
                </span>
                <div>
                  <strong>Auto Ads Operating System</strong>
                  <span>วิเคราะห์ → จัดคิว → ยืนยันก่อนเปลี่ยนข้อมูลจริง</span>
                </div>
              </div>
              <div className="auto-os-steps" aria-label="ขั้นตอน Auto Ads">
                <span>1 วิเคราะห์ {fmtNum(ads.length)} โฆษณา</span>
                <span>2 ตรวจ {fmtNum(confirmableCount)} รายการ</span>
                <span>3 ส่งคิว {fmtNum(queuedPlans.length)} รายการ</span>
              </div>
            </div>
            <div className="auto-os-control-grid">
              <label>
                โหมด
                <AutomationToggleControl mode={automationMode} onModeChange={onModeChange} />
              </label>
              <label>
                ค่าโฆษณาขั้นต่ำ
                <input min={100} step={100} type="number" value={minSpend} onChange={(event) => setMinSpend(Number(event.target.value))} onBlur={() => setMinSpend(safeMinSpend)} />
              </label>
              <label>
                ROAS ตัวชนะ
                <input min={0.5} max={20} step={0.1} type="number" value={winnerRoas} onChange={(event) => setWinnerRoas(Number(event.target.value))} onBlur={() => setWinnerRoas(safeWinnerRoas)} />
              </label>
              <label>
                CTR ต่ำกว่า
                <input min={0.1} max={10} step={0.1} type="number" value={ctrFloor} onChange={(event) => setCtrFloor(Number(event.target.value))} onBlur={() => setCtrFloor(safeCtrFloor)} />
              </label>
            </div>
          </div>
          <div className="auto-os-actions">
            <button className="primary-button" type="button" onClick={queueSafePlans} disabled={queueablePlans.length === 0 || automationPaused}>
              เพิ่มรายการที่ผ่านเงื่อนไข
            </button>
            <button className="outline-button" type="button" onClick={resetAnalysis}>
              วิเคราะห์ใหม่
            </button>
            <button className="outline-button" type="button" onClick={() => setQueuedPlanIds({})}>
              ล้างคิว
            </button>
          </div>
          {autoAdsMessage ? <p className="settings-message">{autoAdsMessage}</p> : null}
        </SectionCard>

        <SectionCard collapsible title="ภาพรวมการตัดสินใจ" subtitle="กดแต่ละช่องเพื่อกรองรายการในบอร์ดตัดสินใจ">
          <div className="auto-os-summary-grid">
            {laneCards.map((card) => (
              <button className={`auto-os-summary-card ${card.tone} ${activeLane === card.decision ? 'selected' : ''}`} key={card.decision} type="button" onClick={() => setActiveLane(card.decision)}>
                <span>{autoAdDecisionLabel(card.decision)}</span>
                <strong>{card.count}</strong>
                <small>{card.detail}</small>
              </button>
            ))}
            <button className={`auto-os-summary-card info ${activeLane === 'all' ? 'selected' : ''}`} type="button" onClick={() => setActiveLane('all')}>
              <span>ทั้งหมด</span>
              <strong>{plans.length}</strong>
              <small>{queuedPlans.length} รายการอยู่ในคิว</small>
            </button>
          </div>
        </SectionCard>

        <SectionCard collapsible title="บอร์ดตัดสินใจ" subtitle="รายการถูกจัดตามผลงานและค่าโฆษณาที่ควรตรวจต่อ">
          <div className="auto-os-toolbar">
            <label className="search-box">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาโฆษณา แคมเปญ หรือชุดโฆษณา" />
            </label>
            <div className="auto-os-tabs" role="tablist" aria-label="กรอง Auto Ads">
              <button className={activeLane === 'all' ? 'selected' : ''} type="button" onClick={() => setActiveLane('all')}>
                ทั้งหมด
              </button>
              {laneCards.map((card) => (
                <button className={activeLane === card.decision ? 'selected' : ''} key={card.decision} type="button" onClick={() => setActiveLane(card.decision)}>
                  {autoAdDecisionLabel(card.decision)}
                </button>
              ))}
            </div>
          </div>
          <div className="auto-os-list">
            {visiblePlans.length > 0 ? (
              visiblePlans.map((plan) => (
                <article className={`auto-os-ad-card ${plan.decision} ${plan.id === activePlan?.id ? 'selected' : ''} ${skippedPlanIds[plan.id] ? 'skipped' : ''}`} key={plan.id}>
                  <div className="auto-os-card-main">
                    <div className="auto-os-badges">
                      <StatusBadge label={autoAdDecisionLabel(plan.decision)} tone={plan.tone} />
                      <StatusBadge label={deliveryLabel(plan.ad.status)} tone={deliveryTone(plan.ad.status)} />
                      {queuedPlanIds[plan.id] ? <StatusBadge label="อยู่ในคิว" tone="violet" /> : null}
                      {!plan.canQueue && plan.targetStatus ? <StatusBadge label="รอเงื่อนไข" tone="watch" /> : null}
                    </div>
                    <h3>{plan.ad.name}</h3>
                    <p>{plan.campaign?.name ?? 'แคมเปญ'} · {plan.adSet?.name ?? 'ชุดโฆษณา'}</p>
                    <span>{plan.reason}</span>
                    <div className="auto-os-card-evidence">
                      {plan.evidence.slice(0, 5).map((item) => (
                        <small key={item}>{item}</small>
                      ))}
                    </div>
                  </div>
                  <div className="auto-os-card-metrics">
                    <MetricLine label="ค่าโฆษณา" value={fmtMoney(plan.ad.spend)} />
                    <MetricLine label="ROAS" value={`${plan.ad.roas.toFixed(2)}x`} />
                    <MetricLine label="CTR" value={`${plan.ad.ctr.toFixed(2)}%`} />
                    <MetricLine label="ยอดนัดหมาย" value={fmtNum(plan.ad.bookings)} />
                  </div>
                  <div className="auto-os-card-actions">
                    <button className="outline-button" type="button" onClick={() => setSelectedPlanId(plan.id)}>
                      รายละเอียด
                    </button>
                    {plan.targetStatus ? (
                      <button className={plan.targetStatus === 'PAUSED' ? 'danger-button' : 'primary-button'} type="button" onClick={() => queuePlan(plan)} disabled={!plan.canQueue || automationPaused || queuedPlanIds[plan.id]}>
                        {queuedPlanIds[plan.id] ? 'อยู่ในคิว' : plan.actionLabel}
                      </button>
                    ) : (
                      <span className="auto-os-noop">ยังไม่ต้องเปลี่ยนข้อมูลจริง</span>
                    )}
                  </div>
                </article>
              ))
            ) : ads.length > 0 ? (
              <EmptyState title="ไม่พบโฆษณาตามเงื่อนไข" detail="ล้างคำค้นหาหรือเปลี่ยนตัวกรองเพื่อดู Auto Ads ทั้งหมด" />
            ) : (
              <EmptyState title="ยังไม่มีข้อมูลโฆษณา" detail="รอข้อมูลจากบัญชีโฆษณาที่เชื่อมไว้ แล้วระบบจะวิเคราะห์ Auto Ads ให้ทันที" />
            )}
          </div>
        </SectionCard>
      </TwoColumnPage>
      {isConfirming ? <AutoAdsConfirmModal isExecuting={isExecuting} plans={queuedPlans} onCancel={() => setIsConfirming(false)} onConfirm={executeQueuedPlans} /> : null}
    </>
  )
}

function AutoAdsConfirmModal({
  isExecuting,
  onCancel,
  onConfirm,
  plans,
}: {
  isExecuting: boolean
  onCancel: () => void
  onConfirm: () => void
  plans: AutoAdPlan[]
}) {
  const pauseCount = plans.filter((plan) => plan.targetStatus === 'PAUSED').length
  const activateCount = plans.filter((plan) => plan.targetStatus === 'ACTIVE').length

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="auto-ads-confirm-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={`${plans.length} คำสั่งพร้อมส่ง`} tone="violet" />
        <h2 id="auto-ads-confirm-title">ยืนยันคิว Auto Ads</h2>
        <p>ระบบจะส่งคำสั่งเปิด/ปิดโฆษณาไปที่บัญชีโฆษณาตามรายการในคิว หลังจากกดปุ่มยืนยันนี้เท่านั้น</p>
        <div className="confirm-grid">
          <MetricLine label="จำนวนรายการ" value={`${plans.length} รายการ`} />
          <MetricLine label="ปิดโฆษณา" value={`${pauseCount} รายการ`} />
          <MetricLine label="เปิดโฆษณา" value={`${activateCount} รายการ`} />
          <MetricLine label="ถ้าต้องย้อนกลับ" value="สามารถเปิดหรือปิดกลับจาก Ads Manager หลังโหลดข้อมูลใหม่" />
        </div>
        <div className="auto-os-confirm-list">
          {plans.slice(0, 5).map((plan) => (
            <div key={plan.id}>
              <strong>{plan.ad.name}</strong>
              <span>{mutationStatusLabel(plan.targetStatus ?? '')} · {shortMetaId(plan.ad.id)}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className="danger-button" type="button" onClick={onConfirm} disabled={isExecuting || plans.length === 0}>
            {isExecuting ? 'กำลังส่งคำสั่ง...' : 'ยืนยันรายการ'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function AutomationAdsPage({ components }: { components: WorkspaceData['insightComponents'] }) {
  const syncedCount = components.length

  return (
    <TwoColumnPage
      aside={
        <StatePanel
          state="กลับมาทำต่อเร็ว ๆ นี้"
          detail="ระบบ Automation Ads ถูกพักไว้ชั่วคราวเพื่อจัด workflow โฆษณาอัตโนมัติให้ชัดก่อนเปิดใช้งานจริง"
          tone="watch"
        />
      }
    >
      <section className="panel automation-ads-updating-panel">
        <StatusBadge label="กำลังอัพเดท" tone="watch" />
        <h2>Automation Ads กำลังอัพเดท</h2>
        <p>ทีมกำลังจัดระบบ workflow โฆษณาอัตโนมัติให้ชัดขึ้น ระหว่างนี้ข้อมูลที่บันทึกไว้จะยังปลอดภัยและจะไม่สั่งเปลี่ยนข้อมูลจริงเอง</p>
        <div className="automation-ads-updating-meta" aria-label="สถานะระบบ Automation Ads">
          <MetricLine label="ข้อมูล Automation Ads ที่บันทึกไว้" value={`${fmtNum(syncedCount)} รายการ`} />
          <MetricLine label="สถานะระบบ" value="พักการใช้งานชั่วคราว" />
          <MetricLine label="การเปลี่ยนข้อมูลจริง" value="ไม่มีการเปลี่ยนข้อมูลอัตโนมัติ" />
        </div>
      </section>
      <StatePanel
        state="ข้อมูล Automation Ads ที่บันทึกไว้ยังปลอดภัย"
        detail="ข้อมูลที่โหลดไว้ยังอยู่ แต่ระบบนี้จะไม่แนะนำหรือสั่งงานอัตโนมัติจนกว่าจะปรับ workflow เสร็จ"
        tone={syncedCount > 0 ? 'info' : 'neutral'}
      />
    </TwoColumnPage>
  )
}

type AudienceSegment = {
  id: string
  name: string
  spend: number
  bookings: number
  cpa: number
  roas: number
  status: WorkspaceData['adSets'][number]['status']
  adSetCount: number
  activeCount: number
  campaignCount: number
}

function pickAudienceStatus(current: AudienceSegment['status'], next: AudienceSegment['status']): AudienceSegment['status'] {
  const priority: Record<AudienceSegment['status'], number> = {
    critical: 4,
    watch: 3,
    scaling: 2,
    healthy: 1,
  }
  return priority[next] > priority[current] ? next : current
}

function buildAudienceSegments(adSets: WorkspaceData['adSets']): AudienceSegment[] {
  type AudienceSegmentDraft = AudienceSegment & { campaignIds: Set<string>; revenue: number }
  const groups = new Map<string, AudienceSegmentDraft>()

  for (const adSet of adSets) {
    const segmentName = adSet.audienceTargeting?.rawSummary || adSet.audience || adSet.name
    const key = segmentName.trim().toLowerCase()
    const existing =
      groups.get(key) ??
      ({
        id: key || adSet.id,
        name: segmentName || adSet.name,
        spend: 0,
        bookings: 0,
        cpa: 0,
        roas: 0,
        status: adSet.status,
        adSetCount: 0,
        activeCount: 0,
        campaignCount: 0,
        campaignIds: new Set<string>(),
        revenue: 0,
      } satisfies AudienceSegmentDraft)

    existing.spend += adSet.spend
    existing.bookings += adSet.bookings
    existing.revenue += adSet.roas * adSet.spend
    existing.adSetCount += 1
    existing.activeCount += adSet.deliveryStatus === 'active' ? 1 : 0
    existing.campaignIds.add(adSet.campaignId)
    existing.status = pickAudienceStatus(existing.status, adSet.status)
    groups.set(key, existing)
  }

  return Array.from(groups.values())
    .map((segment) => ({
      id: segment.id,
      name: segment.name,
      spend: segment.spend,
      bookings: segment.bookings,
      cpa: segment.bookings > 0 ? segment.spend / segment.bookings : 0,
      roas: segment.spend > 0 ? segment.revenue / segment.spend : 0,
      status: segment.status,
      adSetCount: segment.adSetCount,
      activeCount: segment.activeCount,
      campaignCount: segment.campaignIds.size,
    }))
    .sort((a, b) => b.spend - a.spend || b.bookings - a.bookings)
}

function AudienceInsightsPage({ adSets }: { adSets: WorkspaceData['adSets'] }) {
  const segments = useMemo(() => buildAudienceSegments(adSets), [adSets])

  return (
    <TwoColumnPage
      aside={
        <StatePanel
          state="ข้อมูลกลุ่มเป้าหมาย"
          detail={`${segments.length} กลุ่มเป้าหมาย จาก ${adSets.length} ชุดโฆษณา โดยรวมค่าโฆษณา ยอดนัดหมาย และ CPA แล้ว`}
          tone={segments.length > 0 ? 'good' : 'neutral'}
        />
      }
    >
      <SectionCard collapsible title="กลุ่มเป้าหมาย" subtitle="กลุ่มผู้ชมที่เชื่อมกับผลลัพธ์ในเส้นทางลูกค้าของคลินิก">
        <div className="audience-table">
          {segments.length > 0 ? (
            segments.map((segment) => (
              <div className="audience-row" key={segment.id}>
                <div>
                  <strong>{segment.name}</strong>
                  <span className="audience-segment-meta">
                    {segment.adSetCount} ชุดโฆษณา · {segment.campaignCount} แคมเปญ · เปิดอยู่ {segment.activeCount}
                  </span>
                </div>
                <span>{fmtMoney(segment.spend)} ใช้จ่าย</span>
                <span>{fmtNum(segment.bookings)} ยอดนัดหมาย</span>
                <StatusBadge label={aiStatusLabel(segment.status)} tone={toneForAiStatus(segment.status)} />
                <span>{fmtMoney(segment.cpa)} CPA</span>
              </div>
            ))
          ) : (
            <EmptyState title="ยังไม่มีข้อมูลกลุ่มเป้าหมาย" detail="กลุ่มเป้าหมายจะแสดงหลังโหลดข้อมูลการตั้งค่าจากชุดโฆษณา" />
          )}
        </div>
      </SectionCard>
      <AudienceChart segments={segments} />
    </TwoColumnPage>
  )
}

function AudienceChart({ segments }: { segments: AudienceSegment[] }) {
  const chartData = segments.map((segment) => ({
    name: segment.name,
    spend: Math.round(segment.spend),
    bookings: segment.bookings,
  }))

  return (
    <SectionCard collapsible title="ปริมาณของกลุ่มเป้าหมาย" subtitle="ค่าโฆษณาและยอดนัดหมายตามกลุ่มเป้าหมายของชุดโฆษณา">
      {chartData.length > 0 ? (
        <ResponsiveContainer height={260} width="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#e7edf5" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#667085' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ border: '1px solid #e1e7f0', borderRadius: 8 }} />
            <Bar dataKey="spend" fill="#cfe4ff" radius={[6, 6, 0, 0]} />
            <Bar dataKey="bookings" fill="#7567d8" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState title="ยังไม่มีกราฟกลุ่มเป้าหมาย" detail="ค่าโฆษณาและยอดนัดหมายของชุดโฆษณาจะแสดงที่นี่หลังโหลดข้อมูล" />
      )}
    </SectionCard>
  )
}

function toneForComplianceStatus(status: WorkspaceData['complianceReviews'][number]['status']): Tone {
  if (status === 'blocked') return 'critical'
  if (status === 'needsReview') return 'watch'
  return 'good'
}

function AdLibraryPage({ reviews }: { reviews: WorkspaceData['complianceReviews'] }) {
  return (
    <TwoColumnPage
      aside={<StatePanel state="ตรวจความเสี่ยงข้อความ" detail="ข้อความเกี่ยวกับผลลัพธ์ทางการแพทย์ควรผ่านการรีวิวก่อนเปิดใช้งาน" tone="watch" />}
    >
      <SectionCard collapsible title="คลังโฆษณา" subtitle="ครีเอทีฟ ความเสี่ยงของข้อความ และความพร้อมก่อนเปิดใช้งาน">
        <div className="card-grid">
          {reviews.length > 0 ? (
            reviews.map((review) => (
              <article className="asset-card" key={review.id}>
                <div className={`asset-thumb ${review.thumbnailUrl ? 'has-image' : ''}`}>
                  {review.thumbnailUrl ? <img alt={review.title} loading="lazy" src={review.thumbnailUrl} /> : <ImageIcon size={24} />}
                </div>
                <h3>{review.title}</h3>
                <p>{review.issue || review.fix || review.service}</p>
                <p className="asset-source-note">{review.source ? `อ้างอิงจาก: ${review.source}` : 'ตรวจจากข้อมูลครีเอทีฟและชื่อโฆษณาที่บัญชีโฆษณาส่งมา'}</p>
                <StatusBadge label={complianceStatusLabel(review.status)} tone={toneForComplianceStatus(review.status)} />
              </article>
            ))
          ) : (
            <EmptyState title="ยังไม่มีข้อมูลคลังโฆษณา" detail="การ์ดตรวจข้อความของครีเอทีฟจะแสดงหลังโหลดข้อมูลโฆษณาสำเร็จ" />
          )}
        </div>
      </SectionCard>
    </TwoColumnPage>
  )
}

function buildReportText({
  datePreset,
  metaInfo,
  recommendations,
  summary,
  syncState,
}: {
  datePreset: string
  metaInfo: MetaInfo | null
  recommendations: Recommendation[]
  summary: Summary
  syncState: string
}) {
  const recommendationLines = recommendations.length
    ? recommendations.map((rec, index) => `${index + 1}. ${rec.title} (${riskLabel(rec.risk)}) - ${rec.evidence}`).join('\n')
    : 'ยังไม่มีคำแนะนำในช่วงข้อมูลนี้'

  return [
    'รายงาน PMC Ads Agent',
    `ช่วงข้อมูล: ${datePreset}`,
    `บัญชี: ${metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อบัญชีโฆษณา'}`,
    `สถานะข้อมูล: ${syncStateLabel(syncState)}`,
    '',
    'ตัวชี้วัด',
    `- ค่าโฆษณา: ${fmtMoney(summary.spend)}`,
    `- รายได้: ${fmtMoney(summary.revenue)}`,
    `- ROAS: ${summary.roas.toFixed(2)}x`,
    `- CPA / ยอดนัดหมาย: ${fmtMoney(summary.cpa)}`,
    `- Lead: ${fmtNum(summary.leads)}`,
    `- ยอดนัดหมาย: ${fmtNum(summary.bookings)}`,
    `- เคสชำระเงิน: ${fmtNum(summary.paidTreatments)}`,
    '',
    'คำแนะนำที่ควรตรวจ',
    recommendationLines,
  ].join('\n')
}

export function ReportsPage({
  datePreset,
  metaInfo,
  preparedReport,
  recommendations,
  setPreparedReport,
  summary,
  syncState,
}: {
  datePreset: string
  metaInfo: MetaInfo | null
  preparedReport: boolean
  recommendations: Recommendation[]
  setPreparedReport: (value: boolean) => void
  summary: Summary
  syncState: string
}) {
  const [reportMessage, setReportMessage] = useState('')
  const reportText = useMemo(
    () => buildReportText({ datePreset, metaInfo, recommendations, summary, syncState }),
    [datePreset, metaInfo, recommendations, summary, syncState],
  )
  const prepareReport = () => {
    setPreparedReport(true)
    setReportMessage('สร้างรายงานจากข้อมูลล่าสุดแล้ว')
  }
  const copyReport = async () => {
    setPreparedReport(true)
    try {
      await navigator.clipboard.writeText(reportText)
      setReportMessage('คัดลอกรายงานแล้ว')
    } catch {
      setReportMessage('คัดลอกอัตโนมัติไม่ได้ แต่รายงานแสดงอยู่ด้านล่างแล้ว')
    }
  }
  const downloadReport = () => {
    setPreparedReport(true)
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `pmc-ads-report-${new Date().toISOString().slice(0, 10)}.txt`
    link.click()
    URL.revokeObjectURL(url)
    setReportMessage('ดาวน์โหลดรายงานแล้ว')
  }

  return (
    <TwoColumnPage
      aside={
        <StatePanel
          collapsible
          state={preparedReport ? 'รายงานพร้อมใช้งาน' : 'รายงานฉบับร่าง'}
          detail={`${metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อบัญชีโฆษณา'} · ${syncStateLabel(syncState)} · ${datePreset}`}
          tone={preparedReport ? 'good' : 'neutral'}
        />
      }
    >
      <SectionCard collapsible title="ตัวสร้างรายงาน" subtitle="เตรียมรายงานปฏิบัติการให้พร้อมรีวิว">
        <div className="report-preview">
          <StatusBadge label={preparedReport ? 'พร้อม' : 'ฉบับร่าง'} tone={preparedReport ? 'good' : 'neutral'} />
          <h3>{preparedReport ? 'รายงานข้อมูลทั้งหมดพร้อมแล้ว' : 'เตรียมรายงานจากหน้า Analytics'}</h3>
          <p>รวมค่าโฆษณา รายได้ ผลตอบแทน เส้นทางลูกค้า และคำแนะนำที่ควรใช้ตัดสินใจ</p>
          <div className="report-actions">
            <button className="primary-button" type="button" onClick={prepareReport}>
              เตรียมรายงาน
            </button>
            <button className="outline-button" type="button" onClick={copyReport}>
              คัดลอกรายงาน
            </button>
            <button className="outline-button" type="button" onClick={downloadReport}>
              ดาวน์โหลด TXT
            </button>
          </div>
          {reportMessage ? <p className="settings-message">{reportMessage}</p> : null}
          <pre className="report-text-preview">{reportText}</pre>
        </div>
      </SectionCard>
    </TwoColumnPage>
  )
}

function SettingsPage({ dataState, metaInfo, onSync, syncState }: { dataState: DataSourceState; metaInfo: MetaInfo | null; onSync: () => void; syncState: string }) {
  const account = metaInfo?.workspaceLabel || metaInfo?.accountName || 'ยังไม่ได้เชื่อมต่อบัญชีโฆษณา'
  const [accessToken, setAccessToken] = useState('')
  const [adAccountId, setAdAccountId] = useState('')
  const [workspaceLabel, setWorkspaceLabel] = useState('')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [metaConfigState, setMetaConfigState] = useState<MetaConfigResponse | null>(null)
  const [openAiApiKey, setOpenAiApiKey] = useState('')
  const [openAiModel, setOpenAiModel] = useState('gpt-5.5')
  const [openAiMaxOutputTokens, setOpenAiMaxOutputTokens] = useState('2800')
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiStatusResponse | null>(null)
  const [openAiMessage, setOpenAiMessage] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false)
  const [isDisconnectingMeta, setIsDisconnectingMeta] = useState(false)
  const [isSavingOpenAiConfig, setIsSavingOpenAiConfig] = useState(false)
  const [isConfirmingConfigSave, setIsConfirmingConfigSave] = useState(false)
  const [saveAsNewWorkspace, setSaveAsNewWorkspace] = useState(false)
  const [isConfirmingOpenAiSave, setIsConfirmingOpenAiSave] = useState(false)
  const isSyncing = syncState === 'Syncing...'
  const metaWorkspaces = metaConfigState?.workspaces ?? metaInfo?.workspaces ?? []
  const selectedWorkspace = metaWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId)
  const activeWorkspace = metaWorkspaces.find((workspace) => workspace.active) ?? selectedWorkspace
  const stateTone: Tone = dataState === 'live' ? 'good' : dataState === 'error' ? 'critical' : dataState === 'loading' ? 'info' : 'watch'
  const savedCredentialLabel = metaConfigState?.settingsSource || metaInfo?.settingsSource
    ? (metaConfigState?.settingsSource || metaInfo?.settingsSource) === 'web-settings'
      ? 'มีข้อมูลเชื่อมต่อที่บันทึกผ่านหน้า Settings'
      : 'มีข้อมูลเชื่อมต่อจากระบบ'
    : 'ยังไม่พบข้อมูลเชื่อมต่อที่บันทึกไว้'
  const tokenLocationLabel =
    metaInfo?.tokenLocation === 'server-local-file'
      ? 'เก็บ token ไว้ในเครื่องนี้'
      : metaInfo?.tokenLocation === 'server-env'
        ? 'ใช้ token จากระบบที่ตั้งค่าไว้'
        : 'ยังไม่มีตำแหน่ง token'
  const dataModeLabel =
    dataState === 'live'
      ? 'โหลดข้อมูลจริงแล้ว'
      : dataState === 'loading'
        ? 'กำลังโหลดข้อมูล'
        : dataState === 'empty'
          ? 'ยังไม่มีข้อมูล'
          : dataState === 'setup-required'
            ? 'ต้องตั้งค่าก่อน'
            : 'โหลดข้อมูลผิดพลาด'

  const openAiCredentialLabel = openAiStatus?.configured
    ? openAiStatus.tokenLocation === 'web-settings'
      ? 'เชื่อม OpenAI จากหน้า Settings แล้ว'
      : openAiStatus.tokenLocation === 'server-env'
        ? 'เชื่อม OpenAI จากระบบที่ตั้งค่าไว้'
        : 'เชื่อม OpenAI จาก .env.local'
    : 'ยังไม่ได้เชื่อม OpenAI API'
  const openAiTone: Tone = openAiStatus?.configured ? 'good' : 'watch'

  const loadMetaConfig = useCallback(async () => {
    try {
      const status = await apiJson<MetaConfigResponse>('/api/meta/config')
      setMetaConfigState(status)
      const nextWorkspace = status.workspaces?.find((workspace) => workspace.active) ?? status.workspaces?.[0]
      if (nextWorkspace) {
        setSelectedWorkspaceId(nextWorkspace.id)
        setWorkspaceLabel(nextWorkspace.label)
      }
    } catch (error) {
      setSettingsMessage(error instanceof Error ? formatApiMessage(error.message) : 'โหลดสถานะบัญชีโฆษณาไม่สำเร็จ')
    }
  }, [])

  const loadOpenAiStatus = useCallback(async () => {
    try {
      const status = await apiJson<OpenAiStatusResponse>('/api/ai/config')
      setOpenAiStatus(status)
      setOpenAiModel(status.model || 'gpt-5.5')
      setOpenAiMaxOutputTokens(String(status.maxOutputTokens || 2800))
    } catch (error) {
      setOpenAiMessage(error instanceof Error ? error.message : 'โหลดสถานะ OpenAI ไม่สำเร็จ')
    }
  }, [])

  const checkOpenAiConfig = async () => {
    setOpenAiMessage('กำลังทดสอบ OpenAI Responses API...')
    try {
      const result = await apiJson<OpenAiStatusResponse & { ok?: boolean; durationMs?: number }>('/api/ai/check')
      setOpenAiStatus(result)
      setOpenAiMessage(`เชื่อมต่อ OpenAI สำเร็จ · ${result.model ?? openAiModel}`)
    } catch (error) {
      setOpenAiMessage(error instanceof Error ? error.message : 'ทดสอบ OpenAI ไม่สำเร็จ')
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOpenAiStatus()
      void loadMetaConfig()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadMetaConfig, loadOpenAiStatus])

  const saveMetaConfig = async () => {
    setIsSavingConfig(true)
    setSettingsMessage(saveAsNewWorkspace ? 'กำลังเพิ่มบัญชีโฆษณาแยก...' : 'กำลังบันทึกการเชื่อมต่อ Meta...')
    try {
      const result = await apiJson<MetaConfigResponse>('/api/meta/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          adAccountId,
          workspaceId: saveAsNewWorkspace ? undefined : selectedWorkspaceId,
          workspaceLabel,
          addAsNew: saveAsNewWorkspace,
          graphVersion: metaInfo?.graphVersion ?? 'v21.0',
          defaultDatePreset: 'maximum',
        }),
      })
      setMetaConfigState(result)
      setSelectedWorkspaceId(result.activeWorkspaceId || result.workspaces?.find((workspace) => workspace.active)?.id || selectedWorkspaceId)
      setWorkspaceLabel(result.workspaceLabel || workspaceLabel)
      setSettingsMessage(`บันทึกการเชื่อมต่อ Meta แล้ว${renderPersistenceLabel(result.renderPersistence)} กำลังโหลดข้อมูลล่าสุด...`)
      setAccessToken('')
      setIsConfirmingConfigSave(false)
      setSaveAsNewWorkspace(false)
      void loadMetaConfig()
      onSync()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? formatApiMessage(error.message) : 'บันทึกการเชื่อมต่อ Meta ไม่สำเร็จ')
    } finally {
      setIsSavingConfig(false)
    }
  }

  const switchMetaWorkspace = async () => {
    if (!selectedWorkspaceId) return
    setIsSwitchingWorkspace(true)
    setSettingsMessage('กำลังสลับบัญชีโฆษณาและตรวจการเชื่อมต่อ...')
    try {
      const result = await apiJson<MetaConfigResponse>('/api/meta/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'switch', workspaceId: selectedWorkspaceId }),
      })
      setMetaConfigState(result)
      setWorkspaceLabel(result.workspaceLabel || activeWorkspace?.label || '')
      setSettingsMessage(`สลับบัญชีโฆษณาเป็น ${result.workspaceLabel || activeWorkspace?.label || 'บัญชีที่เลือก'} แล้ว`)
      onSync()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? formatApiMessage(error.message) : 'สลับบัญชีโฆษณาไม่สำเร็จ')
    } finally {
      setIsSwitchingWorkspace(false)
    }
  }

  const disconnectMetaApi = async () => {
    setIsDisconnectingMeta(true)
    setSettingsMessage('กำลังตัดการเชื่อมต่อบัญชีโฆษณา...')
    try {
      const result = await apiJson<MetaConfigResponse>('/api/meta/config', { method: 'DELETE' })
      setMetaConfigState(result)
      setAccessToken('')
      setAdAccountId('')
      setWorkspaceLabel('')
      setSelectedWorkspaceId('')
      setSettingsMessage(`ตัดการเชื่อมต่อแล้ว${renderPersistenceLabel(result.renderPersistence)}`)
      onSync()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? formatApiMessage(error.message) : 'ตัดการเชื่อมต่อไม่สำเร็จ')
    } finally {
      setIsDisconnectingMeta(false)
    }
  }

  const saveOpenAiConfig = async () => {
    setIsSavingOpenAiConfig(true)
    setOpenAiMessage('กำลังตรวจและบันทึกค่า OpenAI API...')
    try {
      const result = await apiJson<OpenAiStatusResponse & { ok?: boolean }>('/api/ai/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apiKey: openAiApiKey,
          model: openAiModel,
          maxOutputTokens: Number(openAiMaxOutputTokens),
        }),
      })
      setOpenAiStatus(result)
      setOpenAiApiKey('')
      setIsConfirmingOpenAiSave(false)
      setOpenAiMessage(`เชื่อมต่อ OpenAI API สำเร็จ${renderPersistenceLabel(result.renderPersistence)} และบันทึกไว้แล้ว`)
      void loadOpenAiStatus()
    } catch (error) {
      setOpenAiMessage(error instanceof Error ? error.message : 'บันทึกค่า OpenAI API ไม่สำเร็จ')
    } finally {
      setIsSavingOpenAiConfig(false)
    }
  }

  return (
    <>
      <TwoColumnPage
        aside={
          <StatePanel
            collapsible
            state={syncStateLabel(syncState)}
            detail={`${metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อบัญชีโฆษณา'} · ${metaInfo?.graphVersion ?? 'รอการตั้งค่า'} · ${savedCredentialLabel}`}
            tone={stateTone}
          />
        }
      >
        <SectionCard collapsible title="ตั้งค่าบัญชีโฆษณา" subtitle="ตั้งค่าบัญชีโฆษณา ระบบวิเคราะห์ และสถานะข้อมูล">
          <div className="settings-credential-state">
            <StatusBadge label={savedCredentialLabel} tone={metaConfigState?.settingsSource || metaInfo?.settingsSource ? 'good' : 'watch'} />
            <span>{tokenLocationLabel}</span>
            {metaInfo?.adAccountId ? <span>Ad Account: {metaInfo.adAccountId}</span> : null}
          </div>
          <div className="workspace-switcher">
            <div>
              <strong>บัญชีโฆษณาที่ใช้งาน</strong>
              <span>{activeWorkspace ? `${activeWorkspace.label} · ${activeWorkspace.adAccountId}` : 'ยังไม่มีบัญชีโฆษณาที่บันทึกไว้'}</span>
            </div>
            <select aria-label="เลือกบัญชีโฆษณา" value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)} disabled={!metaWorkspaces.length || isSwitchingWorkspace}>
              {metaWorkspaces.length ? (
                metaWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.label} · {workspace.adAccountId}
                  </option>
                ))
              ) : (
                <option value="">ยังไม่มีบัญชีโฆษณา</option>
              )}
            </select>
            <button className="primary-button" type="button" onClick={() => void switchMetaWorkspace()} disabled={!selectedWorkspaceId || isSwitchingWorkspace || selectedWorkspace?.active}>
              {isSwitchingWorkspace ? 'กำลังสลับ...' : 'สลับบัญชีโฆษณา'}
            </button>
            <button className="danger-button" type="button" onClick={() => void disconnectMetaApi()} disabled={isDisconnectingMeta || (!metaConfigState?.configured && !metaInfo?.settingsSource)}>
              {isDisconnectingMeta ? 'กำลังตัด...' : 'ตัดการเชื่อมต่อ'}
            </button>
          </div>
          <div className="form-grid">
            <label>
              บัญชีที่แสดง
              <input value={account} readOnly />
            </label>
            <label>
              ชื่อบัญชีที่แสดง
              <input value={workspaceLabel} onChange={(event) => setWorkspaceLabel(event.target.value)} placeholder="เช่น Promed Clinic PMC" />
            </label>
            <label>
              Meta Ad Account ID
              <input value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)} placeholder="act_1234567890" />
            </label>
            <label>
              Access Token
              <input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Token ระยะยาวหรือ system user token" type="password" />
            </label>
            <label>
              โหมดข้อมูล
              <select value={dataModeLabel} disabled>
                <option>โหลดข้อมูลจริงแล้ว</option>
                <option>กำลังโหลดข้อมูล</option>
                <option>ยังไม่มีข้อมูล</option>
                <option>ต้องตั้งค่าก่อน</option>
                <option>โหลดข้อมูลผิดพลาด</option>
              </select>
            </label>
            <button className="primary-button" type="button" onClick={onSync} disabled={isSyncing}>
              {isSyncing ? 'กำลังตรวจ...' : 'ตรวจการเชื่อมต่อ'}
            </button>
            <button
              className="outline-button"
              type="button"
              onClick={() => {
                setSettingsMessage('')
                setSaveAsNewWorkspace(false)
                setIsConfirmingConfigSave(true)
              }}
              disabled={isSavingConfig || (!accessToken && !adAccountId && !metaConfigState?.hasSavedToken)}
            >
              {isSavingConfig && !saveAsNewWorkspace ? 'กำลังบันทึก...' : 'บันทึก/อัปเดต'}
            </button>
            <button
              className="outline-button"
              type="button"
              onClick={() => {
                setSettingsMessage('')
                setSaveAsNewWorkspace(true)
                setIsConfirmingConfigSave(true)
              }}
              disabled={isSavingConfig || !accessToken || !adAccountId}
            >
              {isSavingConfig && saveAsNewWorkspace ? 'กำลังเพิ่ม...' : 'เพิ่มบัญชีโฆษณาแยก'}
            </button>
          </div>
          {settingsMessage ? <p className="settings-message">{settingsMessage}</p> : null}

          <div className="settings-divider" />
          <div className="settings-credential-state">
            <StatusBadge label={openAiCredentialLabel} tone={openAiTone} />
            <span>{openAiStatus?.configured ? 'พร้อมใช้ผู้ช่วยวิเคราะห์' : 'รอเชื่อมต่อ OpenAI'}</span>
            <span>Model: {openAiModel || 'gpt-5.5'}</span>
          </div>
          <div className="form-grid">
            <label>
              OpenAI API Key
              <input value={openAiApiKey} onChange={(event) => setOpenAiApiKey(event.target.value)} placeholder={openAiStatus?.hasSavedApiKey ? 'ใช้ key ที่บันทึกไว้เดิม หรือใส่ key ใหม่' : 'sk-proj-...'} type="password" />
            </label>
            <label>
              OpenAI Model
              <input value={openAiModel} onChange={(event) => setOpenAiModel(event.target.value)} placeholder="gpt-5.5" />
            </label>
            <label>
              ความยาวคำตอบสูงสุด
              <input value={openAiMaxOutputTokens} onChange={(event) => setOpenAiMaxOutputTokens(event.target.value)} inputMode="numeric" placeholder="2800" />
            </label>
            <label>
              สถานะ AI
              <select value={openAiStatus?.configured ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้เชื่อม'} disabled>
                <option>เชื่อมต่อแล้ว</option>
                <option>ยังไม่ได้เชื่อม</option>
              </select>
            </label>
            <button className="primary-button" type="button" onClick={() => void checkOpenAiConfig()} disabled={isSavingOpenAiConfig || !openAiStatus?.configured}>
              ตรวจสถานะ OpenAI
            </button>
            <button
              className="outline-button"
              type="button"
              onClick={() => {
                setOpenAiMessage('')
                setIsConfirmingOpenAiSave(true)
              }}
              disabled={isSavingOpenAiConfig || (!openAiApiKey && !openAiStatus?.hasSavedApiKey && !openAiStatus?.configured)}
            >
              {isSavingOpenAiConfig ? 'กำลังบันทึก...' : 'บันทึกค่า OpenAI API'}
            </button>
          </div>
          {openAiMessage ? <p className="settings-message">{openAiMessage}</p> : null}
        </SectionCard>
        <div className="split-grid">
          <StatePanel collapsible state="ต้องตั้งค่าก่อน" detail="แสดงเมื่อยังไม่มีข้อมูลเชื่อมต่อหรือบัญชีโฆษณา" tone="watch" />
          <StatePanel collapsible state="ยังไม่มีข้อมูล" detail="แสดงเมื่อช่วงวันที่ที่เลือกยังไม่มีแคมเปญหรือข้อมูลเส้นทางลูกค้า" tone="neutral" />
          <StatePanel collapsible state="ตัดการเชื่อมต่อ" detail="แสดงเมื่อบัญชีโฆษณายังเชื่อมต่อไม่ผ่าน และจะปิดการเปลี่ยนข้อมูลจริงไว้จนกว่าจะเชื่อมต่อใหม่" tone="critical" />
          <StatePanel
            collapsible
            actionLabel={isSyncing ? 'กำลังลองใหม่...' : 'โหลดอีกครั้ง'}
            detail="แสดงเมื่อโหลดข้อมูลล่าสุดไม่สำเร็จ ควรโหลดใหม่จากหน้านี้ก่อนรีวิว"
            disabled={isSyncing}
            onAction={onSync}
            state="โหลดข้อมูลผิดพลาด"
            tone="critical"
          />
        </div>
      </TwoColumnPage>
      {isConfirmingConfigSave ? (
        <SettingsSaveConfirmModal
          adAccountId={adAccountId}
          hasAccessToken={Boolean(accessToken)}
          isSaving={isSavingConfig}
          isNewWorkspace={saveAsNewWorkspace}
          onCancel={() => setIsConfirmingConfigSave(false)}
          onConfirm={saveMetaConfig}
          workspaceLabel={workspaceLabel}
        />
      ) : null}
      {isConfirmingOpenAiSave ? (
        <OpenAiSaveConfirmModal
          hasApiKey={Boolean(openAiApiKey)}
          isSaving={isSavingOpenAiConfig}
          maxOutputTokens={openAiMaxOutputTokens}
          model={openAiModel}
          onCancel={() => setIsConfirmingOpenAiSave(false)}
          onConfirm={saveOpenAiConfig}
        />
      ) : null}
    </>
  )
}

function SettingsSaveConfirmModal({
  adAccountId,
  hasAccessToken,
  isNewWorkspace,
  isSaving,
  onCancel,
  onConfirm,
  workspaceLabel,
}: {
  adAccountId: string
  hasAccessToken: boolean
  isNewWorkspace: boolean
  isSaving: boolean
  onCancel: () => void
  onConfirm: () => void
  workspaceLabel: string
}) {
  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="settings-save-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isSaving}>
          <X size={18} />
        </button>
        <StatusBadge label="บันทึกข้อมูลเชื่อมต่อ" tone="watch" />
        <h2 id="settings-save-title">{isNewWorkspace ? 'ยืนยันการเพิ่มบัญชีโฆษณา' : 'ยืนยันการบันทึกการเชื่อมต่อ Meta'}</h2>
        <p>ระบบจะตรวจข้อมูลกับ Meta แล้วบันทึกไว้ให้ใช้งานต่อได้ในครั้งถัดไป</p>
        <div className="confirm-grid">
          <MetricLine label="บัญชีที่แสดง" value={workspaceLabel || (isNewWorkspace ? 'บัญชีใหม่' : 'บัญชีปัจจุบัน')} />
          <MetricLine label="Access Token" value={hasAccessToken ? 'มี token ใหม่ในฟอร์ม' : 'ใช้ token ที่บันทึกไว้เดิม'} />
          <MetricLine label="Ad Account ID" value={adAccountId || 'ใช้ค่าที่บันทึกไว้เดิม'} />
          <MetricLine label="ตำแหน่งบันทึก" value="บันทึกในระบบของแอป" />
          <MetricLine label="หลังบันทึก" value="ตรวจการเชื่อมต่อและโหลดข้อมูลล่าสุด" />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isSaving}>
            ยกเลิก
          </button>
          <button className="primary-button" type="button" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'กำลังบันทึก...' : 'ยืนยันและบันทึก'}
          </button>
        </div>
      </section>
    </div>
  )
}

function OpenAiSaveConfirmModal({
  hasApiKey,
  isSaving,
  maxOutputTokens,
  model,
  onCancel,
  onConfirm,
}: {
  hasApiKey: boolean
  isSaving: boolean
  maxOutputTokens: string
  model: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="openai-save-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isSaving}>
          <X size={18} />
        </button>
        <StatusBadge label="บันทึก OpenAI API จริง" tone="watch" />
        <h2 id="openai-save-title">ยืนยันการเชื่อมต่อ OpenAI API</h2>
        <p>ระบบจะทดสอบ key กับ OpenAI แล้วบันทึกไว้ให้ใช้งานต่อ โดยจะไม่แสดง key กลับบนหน้าเว็บ</p>
        <div className="confirm-grid">
          <MetricLine label="OpenAI API Key" value={hasApiKey ? 'มี key ใหม่ในฟอร์ม' : 'ใช้ key ที่บันทึกไว้เดิม'} />
          <MetricLine label="Model" value={model || 'gpt-5.5'} />
          <MetricLine label="ความยาวคำตอบสูงสุด" value={maxOutputTokens || '2800'} />
          <MetricLine label="ตำแหน่งบันทึก" value="บันทึกในระบบของแอป" />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isSaving}>
            ยกเลิก
          </button>
          <button className="primary-button" type="button" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'กำลังตรวจ...' : 'ยืนยันและบันทึก'}
          </button>
        </div>
      </section>
    </div>
  )
}

function HelpCenterPage({
  dataState,
  onOpenSettings,
  onSync,
  syncState,
}: {
  dataState: DataSourceState
  onOpenSettings: () => void
  onSync: () => void
  syncState: string
}) {
  const isSyncing = dataState === 'loading'
  const helpStatus =
    dataState === 'live'
      ? {
          state: 'ระบบพร้อมใช้งาน',
          detail: 'ข้อมูลบัญชีโฆษณาพร้อมใช้งานแล้ว ใช้ Analytics, Ads Manager และ Insights ได้ตามปกติ',
          tone: 'good' as Tone,
          action: 'โหลดอีกครั้ง',
          onAction: onSync,
        }
      : dataState === 'setup-required'
        ? {
            state: 'ต้องตั้งค่าบัญชีโฆษณา',
            detail: 'เพิ่ม Access Token และ Ad Account ID ในหน้า Settings ก่อนใช้งานข้อมูลจริง',
            tone: 'watch' as Tone,
            action: 'เปิด Settings',
            onAction: onOpenSettings,
          }
        : dataState === 'error'
          ? {
              state: 'โหลดข้อมูลผิดพลาด',
              detail: 'ตรวจ token, สิทธิ์บัญชี หรือรอสักครู่ถ้า Meta จำกัดจำนวนคำขอ แล้วลองโหลดอีกครั้ง',
              tone: 'critical' as Tone,
              action: 'โหลดอีกครั้ง',
              onAction: onSync,
            }
          : dataState === 'empty'
            ? {
                state: 'ยังไม่มีข้อมูลในช่วงนี้',
                detail: 'ลองเปลี่ยนช่วงวันที่หรือกดโหลดอีกครั้งเพื่อดูข้อมูลแคมเปญและโฆษณา',
                tone: 'neutral' as Tone,
                action: 'โหลดอีกครั้ง',
                onAction: onSync,
              }
            : {
                state: 'กำลังโหลดข้อมูล',
                detail: 'ระบบกำลังโหลดข้อมูลจากบัญชีโฆษณา โปรดรอสักครู่',
                tone: 'info' as Tone,
                action: 'กำลังโหลด...',
                onAction: onSync,
              }

  return (
    <TwoColumnPage
      aside={
        <StatePanel
          collapsible
          actionLabel={helpStatus.action}
          detail={`${helpStatus.detail} · สถานะปัจจุบัน: ${syncStateLabel(syncState)}`}
          disabled={isSyncing}
          onAction={helpStatus.onAction}
          state={helpStatus.state}
          tone={helpStatus.tone}
        />
      }
    >
      <SectionCard collapsible title="ศูนย์ช่วยเหลือ" subtitle="แนวทางรีวิวโฆษณาคลินิกรายวัน">
        <div className="help-list">
          {[
            ['รีวิวรายวัน', 'ตรวจตัวเลขสำคัญ จุดหลุดในเส้นทางลูกค้า ตารางแคมเปญ และคำแนะนำที่รออนุมัติ'],
            ['ก่อนอนุมัติการเปลี่ยนข้อมูล', 'ยืนยันรายการที่จะเปลี่ยน เหตุผล เงื่อนไขความปลอดภัย ผลกระทบที่คาดไว้ และวิธีย้อนกลับ'],
            ['เมื่อข้อมูลเก่า', 'โหลดข้อมูลล่าสุดก่อนเชื่อคำแนะนำจากระบบ'],
            ['เมื่อไม่มีข้อมูล', 'เปลี่ยนช่วงวันที่หรือรีวิวสถานะการเชื่อมต่อในหน้า Settings'],
          ].map(([title, body]) => (
            <article className="help-item" key={title}>
              <BookOpenCheck size={18} />
              <div>
                <strong>{title}</strong>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </TwoColumnPage>
  )
}

function TwoColumnPage({ aside, children }: { aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="two-column-page ads-tool-window">
      <section className="main-stack">{children}</section>
      {aside ? <aside className="right-rail">{aside}</aside> : null}
    </div>
  )
}

function HelpTooltip({ text }: { text: string }) {
  return (
    <span className="help-tooltip" data-tooltip={text} title={text} aria-label={text} tabIndex={0}>
      <Info size={13} />
    </span>
  )
}

function SectionCard({
  action,
  children,
  className,
  headClassName,
  subtitle,
  title,
}: {
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  collapsible?: boolean
  collapseLabel?: string
  defaultCollapsed?: boolean
  headClassName?: string
  subtitle: string
  title: string
}) {
  const hasActions = Boolean(action)
  const panelClassName = ['panel', className].filter(Boolean).join(' ')
  const panelHeadClassName = ['panel-head', headClassName].filter(Boolean).join(' ')
  const tooltip = sectionTooltips[title]

  return (
    <section className={panelClassName}>
      <div className={panelHeadClassName}>
        <div>
          <div className="panel-title-row">
            <h2>{title}</h2>
            {tooltip ? <HelpTooltip text={tooltip} /> : null}
          </div>
          <p>{subtitle}</p>
        </div>
        {hasActions ? (
          <div className="panel-actions">
            {action}
          </div>
        ) : null}
      </div>
      <div className="panel-collapsible-content">{children}</div>
    </section>
  )
}

function StatePanel({
  actionLabel = 'ตรวจสถานะ',
  detail,
  disabled = false,
  onAction,
  state,
  tone,
}: {
  actionLabel?: string
  collapsible?: boolean
  detail: string
  disabled?: boolean
  onAction?: () => void
  state: string
  tone: Tone
}) {
  return (
    <section className="panel state-panel">
      <StatusBadge label={state} tone={tone} />
      <div className="state-panel-content">
        <p>{detail}</p>
        {onAction ? (
          <button className="outline-button" type="button" onClick={onAction} disabled={disabled}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  )
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EmptyState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: Tone | 'blue' }) {
  return <span className={`status-badge ${tone}`}>{label}</span>
}

function AutomationToggleControl({
  mode,
  onModeChange,
}: {
  mode: string
  onModeChange: (value: string) => void
}) {
  const selectedValue = automationToggleValue(mode)

  const chooseMode = (option: AutomationToggleValue) => {
    if (option !== selectedValue) onModeChange(option)
  }

  return (
    <div className="auto-toggle-control" role="group" aria-label="เปิดหรือปิด Auto">
      {automationToggleOptions.map((option) => {
        const isSelected = option === selectedValue
        return (
          <button
            aria-pressed={isSelected}
            className={`auto-toggle-choice ${option === 'เปิด Auto' ? 'is-on' : 'is-off'} ${isSelected ? 'selected' : ''}`}
            key={option}
            type="button"
            onClick={(event) => {
              if (event.detail === 0) chooseMode(option)
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              chooseMode(option)
            }}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function AutomationModeConfirmModal({
  nextMode,
  onCancel,
  onConfirm,
}: {
  nextMode: AutomationMode
  onCancel: () => void
  onConfirm: () => void
}) {
  const isTurningOn = nextMode === 'ต้องอนุมัติก่อน'
  const title = isTurningOn ? 'เปิดการทำงานอัตโนมัติ' : 'ปิดการทำงานอัตโนมัติ'
  const detail = isTurningOn
    ? 'เมื่อเปิดแล้ว ระบบจะช่วยจัดคิวงานและเตรียมรายการที่ควรทำต่อให้ แต่ทุกคำสั่งที่กระทบบัญชีโฆษณายังต้องให้คุณกดยืนยันก่อนเสมอ'
    : 'เมื่อปิดแล้ว ระบบจะหยุดการส่งคำสั่งไปยังบัญชีโฆษณา และจะแสดงเฉพาะข้อมูลกับคำแนะนำสำหรับตรวจดูเท่านั้น'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="automation-mode-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยันโหมด Auto">
          <X size={18} />
        </button>
        <StatusBadge label={automationDisplayLabel(nextMode)} tone={isTurningOn ? 'good' : 'critical'} />
        <h2 id="automation-mode-title">{title}</h2>
        <p>{detail}</p>
        <div className="confirm-grid">
          <MetricLine label="สถานะใหม่" value={isTurningOn ? 'เปิด Auto' : 'ปิด Auto'} />
          <MetricLine label="สิ่งที่จะทำได้" value={isTurningOn ? 'จัดคิวแผนและเตรียมรายการดำเนินการ' : 'ดูข้อมูลและคำแนะนำเท่านั้น'} />
          <MetricLine label="ก่อนส่งคำสั่งจริง" value={isTurningOn ? 'ต้องให้คุณตรวจและยืนยันทุกครั้ง' : 'ไม่มีการส่งคำสั่ง'} />
          <MetricLine label="เปลี่ยนกลับได้" value="กลับมาเปิดหรือปิดได้จากปุ่มนี้ตลอดเวลา" />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel}>
            ยกเลิก
          </button>
          <button className={isTurningOn ? 'primary-button' : 'danger-button'} type="button" onClick={onConfirm}>
            {isTurningOn ? 'เปิด Auto' : 'ปิด Auto'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function PlanExecutionModal({
  draft,
  error,
  isExecuting,
  onClose,
  onComplete,
  onStart,
}: {
  draft: PlanExecutionDraft
  error: string
  isExecuting: boolean
  onClose: () => void
  onComplete: () => void
  onStart: () => void | Promise<void>
}) {
  const rec = draft.recommendation
  const isRunning = draft.status === 'running'
  const execution = rec.execution
  const statusLabel = execution?.status ? mutationStatusLabel(execution.status) : execution?.operation ? 'อัปเดตรายการ' : 'ไม่มีคำสั่งที่ต้องส่ง'
  const modalTitle = execution ? 'ตรวจคำสั่งก่อนส่งจริง' : 'ทำตามรายการตรวจของแผน'
  const modalIntro = execution
    ? 'แผนนี้อนุมัติแล้ว ด้านล่างแยกให้ชัดว่าอะไรคือแผนที่ใช้ตัดสินใจ และอะไรคือคำสั่งที่จะส่งเมื่อคุณกดยืนยันเท่านั้น'
    : 'แผนนี้เป็นงานตรวจสอบหรือวิเคราะห์ที่ยังไม่มีคำสั่งชัดพอ ระบบจะไม่เดาเอง ให้ทำตามรายการตรวจแล้วบันทึกผลไว้'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal plan-execution-modal" role="dialog" aria-modal="true" aria-labelledby="plan-execution-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="ปิดขั้นตอนดำเนินการแผน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={isExecuting ? 'กำลังส่งคำสั่ง' : execution ? 'พร้อมให้ยืนยันคำสั่ง' : isRunning ? 'กำลังทำรายการตรวจ' : 'แผนพร้อมตรวจ'} tone={isExecuting ? 'critical' : execution ? 'watch' : isRunning ? 'info' : 'good'} />
        <h2 id="plan-execution-title">{modalTitle}</h2>
        <p>{modalIntro}</p>
        <div className="plan-execution-target">
          <section className="plan-execution-section" aria-label="แผนที่อนุมัติ">
            <h3>แผนที่อนุมัติ</h3>
            <MetricLine label="แผน" value={rec.action} />
            <MetricLine label="เหตุผลของแผน" value={rec.evidence} />
            <MetricLine label="ความเสี่ยง" value={riskLabel(rec.risk)} />
            <MetricLine label="ความมั่นใจ" value={`${rec.confidence}%`} />
            <MetricLine label="เงื่อนไขควบคุม" value={rec.guardrail} />
          </section>
          {execution ? (
            <section className="plan-execution-section danger" aria-label="คำสั่งที่จะส่ง">
              <h3>คำสั่งที่จะส่ง</h3>
              <MetricLine label="คำสั่ง" value={cleanRecommendationCopy(execution.label)} />
              <MetricLine label="รายการที่จะเปลี่ยน" value={`${objectTypeLabel(execution.objectType)} ${execution.objectId}`} />
              <MetricLine label="สถานะที่จะตั้ง" value={statusLabel} />
            </section>
          ) : (
            <section className="plan-execution-section" aria-label="สถานะคำสั่ง">
              <h3>คำสั่ง</h3>
              <MetricLine label="สถานะ" value="ยังไม่มีคำสั่งที่ปลอดภัยพอให้ทำอัตโนมัติ" />
            </section>
          )}
        </div>
        <h3 className="plan-execution-steps-title">รายการตรวจ</h3>
        <ol className="plan-execution-steps">
          {draft.steps.map((step) => (
            <li key={step}>{cleanRecommendationCopy(step)}</li>
          ))}
        </ol>
        {error ? <div className="plan-execution-error" role="alert">{error}</div> : null}
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={isExecuting}>
            กลับไปดูรายการแผน
          </button>
          {execution ? (
            <button className="danger-button" type="button" onClick={onStart} disabled={isExecuting}>
              {isExecuting ? 'กำลังส่งคำสั่ง...' : 'ยืนยันส่งคำสั่ง'}
            </button>
          ) : isRunning ? (
            <button className="primary-button" type="button" onClick={onComplete} disabled={isExecuting}>
              บันทึกว่าเสร็จแล้ว
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={onStart} disabled={isExecuting}>
              เริ่มทำตามรายการตรวจ
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function ConfirmModal({
  isExecuting,
  onCancel,
  onConfirm,
  recommendation,
  targetCampaign,
}: {
  isExecuting: boolean
  onCancel: () => void
  onConfirm: () => void
  recommendation: Recommendation
  targetCampaign?: Campaign
}) {
  const execution = recommendation.execution
  const executionObjectTypeLabel = execution ? objectTypeLabel(execution.objectType) : 'รีวิวเท่านั้น'
  const targetLabel = targetCampaign?.name ?? (execution ? `${executionObjectTypeLabel} ${execution.objectId}` : 'แผนนี้')
  const requestedStatus = execution?.status ? mutationStatusLabel(execution.status) : execution?.operation ? 'อัปเดตรายการ' : 'บันทึกเป็นแผน'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={execution ? 'เปลี่ยนข้อมูลจริง' : 'อนุมัติเป็นแผน'} tone={execution ? 'critical' : 'watch'} />
        <h2 id="confirm-title">{recommendation.action}</h2>
        <p>
          {execution
            ? 'หลังยืนยัน ระบบจะส่งคำสั่งไปบัญชีโฆษณาจริงตามขอบเขตด้านล่าง'
            : 'หลังยืนยัน ระบบจะบันทึกเป็นแผนก่อน จากนั้นเปิดขั้นตอนดำเนินการต่อ ถ้าแผนมีคำสั่งที่ชัดเจนคุณจะกดส่งคำสั่งจริงได้ในขั้นตอนถัดไป'}
        </p>
        <div className="confirm-grid">
          <MetricLine label="แคมเปญ / เป้าหมาย" value={targetLabel} />
          <MetricLine label="ประเภทรายการ" value={executionObjectTypeLabel} />
          <MetricLine label="สถานะปัจจุบัน" value={targetCampaign ? campaignStatusLabel(targetCampaign.status) : 'รีวิวเท่านั้น'} />
          <MetricLine label="สถานะที่ต้องการ" value={requestedStatus} />
          <MetricLine label="ถ้าต้องย้อนกลับ" value={execution ? 'ย้อนกลับได้หลังดำเนินการ' : 'ไม่ต้องย้อนกลับ เพราะยังไม่เปลี่ยนข้อมูลจริง'} />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className={execution ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={isExecuting}>
            {isExecuting ? 'กำลังดำเนินการ...' : execution ? 'ยืนยันรายการ' : 'อนุมัติเป็นแผน'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default App
