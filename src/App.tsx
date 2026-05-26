import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  BookOpenCheck,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  FileText,
  ImageIcon,
  Info,
  Layers3,
  LineChart,
  Menu,
  Megaphone,
  Percent,
  Pencil,
  Power,
  RefreshCw,
  Search,
  Settings,
  Trash2,
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
import { HomeApp } from './apps/home/HomeApp'
import { PageAutomationApp } from './apps/page-automation/PageAutomationApp'
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

type TrendDatum = { date: string; day: string; spend: number; revenue: number; bookings: number; treatments?: number }

type DataSourceState = 'loading' | 'live' | 'setup-required' | 'empty' | 'error'
type AutomationMode = 'แนะนำเท่านั้น' | 'ต้องอนุมัติก่อน' | 'พัก automation'
type AutomationToggleValue = 'เปิด Auto' | 'ปิด Auto'
type MascotNotice = {
  id: number
  message: string
  tone: Tone
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

type AiBrainSpecialistReport = NonNullable<AiBrainResponse['specialistOutputs']['campaignAnalyst']>

type BrainDeepDiveState = {
  actionId: string
  target: string
  result?: AiBrainApiResponse
  error?: string
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
  { id: 'ads', toolbarKey: 'campaigns', label: 'Campaigns', group: 'Main', icon: Megaphone, description: 'จัดการ Campaign, Ad group และ Ad จากข้อมูล Meta จริง' },
  { id: 'ads', toolbarKey: 'ad-groups', label: 'Ad Groups', group: 'Main', icon: Layers3, description: 'ตรวจชุดโฆษณาและกลุ่มงานที่อยู่ใต้ Campaign' },
  { id: 'creative', toolbarKey: 'creatives', label: 'Creatives', group: 'Creative', icon: ImageIcon, description: 'ผลงานครีเอทีฟและ asset ที่ซิงก์มา' },
  { id: 'audience', toolbarKey: 'audience', label: 'Audience', group: 'Creative', icon: Users, description: 'กลุ่มเป้าหมาย พื้นที่ และคุณภาพ lead' },
  { id: 'reports', toolbarKey: 'reports', label: 'Reports', group: 'System', icon: FileText, description: 'รายงานสรุปผลงานโฆษณาให้ทีมตรวจและนำไปใช้ต่อ' },
  { id: 'marketer', toolbarKey: 'insights', label: 'Insights', group: 'Main', icon: BrainCircuit, description: 'คำแนะนำและ insight ที่รอทีมตรวจ' },
  { id: 'settings', toolbarKey: 'settings', label: 'Settings', group: 'System', icon: Settings, description: 'การเชื่อมต่อ Meta, workspace และความพร้อมของ API' },
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
  'Performance Overview': 'ดูแนวโน้ม spend, revenue และ booking จากข้อมูลที่ซิงก์',
  'Top Campaigns': 'แคมเปญที่ทำผลงานดีที่สุดตาม conversion และ ROAS',
  'คำแนะนำที่รออนุมัติ': 'รายการที่ควรตรวจวันนี้ก่อนกดรีวิวหรือปฏิเสธ',
  'PMC Insights': 'สรุปสัญญาณล่าสุดจากข้อมูล Ads Dashboard',
  'ตัวจัดการโฆษณา': 'จัดการ Campaign, Ad set และ Ad จาก Meta จริง รวมเปิด ปิด แก้ไข หรือลบ',
  'แคมเปญที่เลือก': 'ดูรายละเอียดของแคมเปญที่กำลังเลือกอยู่ก่อนทำงานต่อ',
  'ผู้ช่วย Insights': 'อ่านข้อมูลโฆษณา หน้าปัจจุบัน และข้อมูลที่บันทึกไว้ก่อนสรุปแผน',
  'ตัวสร้างรายงาน': 'เตรียมรายงานสรุปงานโฆษณาจากข้อมูลล่าสุด',
  'ตั้งค่า Workspace': 'เชื่อมต่อ Meta API และ OpenAI API ที่ backend ใช้ทำงาน',
  'ศูนย์ช่วยเหลือ': 'คู่มือสั้นสำหรับเริ่มใช้งานและแก้ปัญหาเบื้องต้น',
  'ผลงานครีเอทีฟ': 'ดูครีเอทีฟที่ชนะหรือควรรีเฟรชจากข้อมูล ads/insight',
  'Segment กลุ่มเป้าหมาย': 'ดู audience และ segment ที่เชื่อมกับผลลัพธ์ใน funnel',
  'ปริมาณของ Segment': 'เทียบค่าโฆษณาและ booking ตามกลุ่มเป้าหมาย',
  'คลังโฆษณา': 'ตรวจ asset และ compliance ก่อนเปิดใช้งานจริง',
}

const fmtMoney = (value: number) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(value)

const fmtNum = (value: number) => new Intl.NumberFormat('th-TH').format(value)
const fmtMoneyShort = (value: number) => (value >= 1000 ? `฿${Math.round(value / 1000)}k` : fmtMoney(value))
const fmtChartMoney = (value: number | string) => {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  if (Math.abs(amount) >= 1_000_000) return `฿${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`
  if (Math.abs(amount) >= 1000) {
    const scaled = amount / 1000
    const label = scaled >= 10 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\\.0$/, '')
    return `฿${label}k`
  }
  return `฿${Math.round(amount)}`
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
  if (lower.includes('too many calls') || lower.includes('rate limit') || lower.includes('user request limit reached')) {
    return 'Meta จำกัดจำนวนคำขอชั่วคราว กรุณารอสักครู่แล้วกดซิงก์อีกครั้ง'
  }
  if (lower.includes('invalid oauth') || lower.includes('access token') || lower.includes('session has expired')) {
    return 'Access Token ของ Meta ใช้งานไม่ได้หรือหมดอายุ กรุณาตรวจในหน้า Settings'
  }
  if (lower.includes('permission') || lower.includes('does not have access')) {
    return 'บัญชีนี้ยังไม่มีสิทธิ์เข้าถึงข้อมูล Meta ที่ต้องใช้ กรุณาตรวจ permission และ ad account'
  }
  if (lower.includes('unsupported get request') || lower.includes('object does not exist')) {
    return 'Meta ไม่พบ object นี้หรือ token ไม่มีสิทธิ์อ่านข้อมูล กรุณาตรวจ ad account และลองซิงก์ใหม่'
  }
  return message
}

function renderPersistenceLabel(result?: MetaConfigResponse['renderPersistence']) {
  if (!result) return ''
  if (!result.enabled) return ' · บันทึกใน server แล้ว แต่ Render env ยังไม่ได้ตั้ง RENDER_API_KEY/RENDER_SERVICE_ID'
  const failed = result.updated?.find((item) => !item.ok)
  return failed ? ` · Render env อัปเดตบางส่วนไม่สำเร็จ (${failed.key})` : ' · ผูกกับ Render env แล้ว'
}

function metaDatePresetForUi(preset: string) {
  if (preset === '7 วันล่าสุด' || preset === 'Last 7 days') return 'last_7d'
  if (preset === 'เดือนนี้' || preset === 'This month') return 'this_month'
  if (preset === 'ไตรมาสนี้' || preset === 'Quarter to date') return 'last_90d'
  if (preset === 'ข้อมูลทั้งหมด' || preset === 'Maximum history') return 'maximum'
  return 'last_30d'
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
    'Checking Meta API': 'กำลังตรวจ Meta API',
    'Syncing...': 'กำลังซิงก์...',
    'Setup required': 'ต้องตั้งค่าก่อน',
    'Sync error': 'ซิงก์ไม่สำเร็จ',
    'Live Meta API': 'เชื่อมต่อ Meta API',
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

function actionStateLabelForPlan(state: ActionState | string, execution?: Recommendation['execution']) {
  if (!execution && state === 'Executing') return 'กำลังทำแผน'
  if (!execution && state === 'Executed') return 'ทำแผนเสร็จแล้ว'
  return actionStateLabel(state)
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
  if (normalized.includes('pause campaign')) return 'พักแคมเปญใน Meta'
  if (normalized.includes('pause or reduce')) return 'พักหรือลดงบจนกว่าจะตรวจ tracking และ offer แล้ว'
  if (normalized.includes('reduce budget')) return 'ลดงบ 10-15% และทดสอบ offer/creative ใหม่'
  if (normalized.includes('increase budget')) return 'เพิ่มงบ 10-15% พร้อม monitor รายวัน'
  if (normalized.includes('create new creative')) return 'สร้าง creative angle ใหม่และหมุนโฆษณาที่ผลงานต่ำออก'
  return text
}

function cleanRecommendationCopy(text: string) {
  return text
    .replace('Action นี้ยังเป็น approval recommendation จนกว่าจะเปิด Meta write execution', 'ตรวจข้อมูลล่าสุดก่อนดำเนินการ')
    .replace('หากเปิด write execution ต้องบันทึก previous status/budget ก่อนเปลี่ยนทุกครั้ง', 'หลังดำเนินการให้ซิงก์ใหม่ และย้อนกลับจาก Ads Manager ได้หากผลลัพธ์ไม่ดีขึ้น')
    .replaceAll('Meta write execution', 'การดำเนินการ')
    .replaceAll('write execution', 'การดำเนินการ')
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
}

function humanizeAiEvidence(text: string) {
  const normalized = text.trim()
  if (!normalized) return ''
  if (/fallbackReason:/i.test(normalized)) return ''
  if (/OpenAI response/i.test(normalized) || /structured output failed/i.test(normalized)) {
    return 'AI หลักตอบกลับไม่สมบูรณ์ ระบบจึงใช้ข้อมูล Meta จริงมาวิเคราะห์แทน'
  }
  if (/deterministic fallback/i.test(normalized) || /fallback mode/i.test(normalized)) {
    return 'ระบบใช้โหมดวิเคราะห์สำรองจากข้อมูล Meta จริง'
  }
  if (normalized.includes('โมเดลตอบไม่ผ่าน schema')) {
    return 'AI หลักตอบกลับไม่สมบูรณ์ ระบบจึงใช้โหมดวิเคราะห์สำรอง'
  }
  if (normalized.includes('Master Agent ยังคืนผลจาก WorkspaceData') || normalized.includes('แทนการหยุดด้วย 502')) {
    return 'AI หลักตอบกลับไม่สมบูรณ์ ระบบจึงสรุปจากข้อมูล Meta จริงและกฎวิเคราะห์ในระบบแทน'
  }
  if (normalized.includes('ไม่มี campaign ที่ active')) {
    return 'ยังไม่มีแคมเปญที่เปิดใช้งานในข้อมูลรอบนี้'
  }

  return cleanRecommendationCopy(normalized)
    .replace(/activeCampaigns=(\d+)/gi, 'แคมเปญที่กำลังรัน $1')
    .replace(/campaigns=(\d+)/gi, 'แคมเปญทั้งหมด $1')
    .replace(/ads=(\d+)/gi, 'โฆษณาทั้งหมด $1')
    .replace(/account spend/gi, 'ภาพรวมบัญชีใช้จ่าย')
    .replaceAll('metricPack.account', 'ภาพรวมบัญชี')
    .replaceAll('workspace.channelPerformance', 'ภาพรวมช่องทาง')
    .replaceAll('activeCampaigns', 'แคมเปญที่กำลังรัน')
    .replaceAll('campaign ', 'แคมเปญ ')
    .replaceAll('ad ', 'โฆษณา ')
    .replaceAll('adset ', 'ชุดโฆษณา ')
    .replaceAll('status paused', 'สถานะพักอยู่')
    .replaceAll('status active', 'สถานะกำลังรัน')
    .replaceAll('spend', 'ค่าใช้จ่าย')
    .replaceAll('revenue', 'รายได้')
    .replaceAll('conversions', 'ผลลัพธ์')
    .replaceAll('bookings', 'booking')
    .replaceAll('guardrail', 'เกณฑ์')
}

function humanEvidencePreview(items: string[], limit = 2) {
  const lines = items.map(humanizeAiEvidence).filter(Boolean).slice(0, limit)
  return lines.length ? lines.join(' · ') : 'ยังไม่มีหลักฐานเพิ่ม'
}

function isOperatorFacingFinding(finding: AiBrainResponse['findings'][number]) {
  const text = [finding.title, finding.explanation, ...finding.evidence].join(' ').toLowerCase()
  return !['deterministic fallback', 'fallbackreason', 'fallback mode', 'schema', '502', 'openai response', 'โหมดวิเคราะห์สำรอง'].some((term) => text.includes(term))
}

function buildMasterSummaryView(result: AiBrainApiResponse) {
  const firstFinding = result.findings.find(isOperatorFacingFinding)
  const firstRecommendation = result.recommendations[0]
  const policyText = result.policy.approvedForDirectExecution ? 'มี action บางส่วนที่พร้อมดำเนินการหลังอนุมัติ' : 'ทุก action ยังต้องให้ผู้ใช้อนุมัติก่อน'
  const decision = firstRecommendation
    ? `เริ่มจาก ${firstRecommendation.targetName}: ${cleanRecommendationCopy(firstRecommendation.action)}`
    : humanizeAiEvidence(result.masterDecision)
  const focus = firstFinding
    ? `${humanizeAiEvidence(firstFinding.title)}: ${humanizeAiEvidence(firstFinding.explanation)}`
    : 'ยังไม่มีสัญญาณผิดปกติชัดเจนจากข้อมูลรอบนี้'

  return {
    title: 'สรุปจากผู้ช่วย Insights',
    items: [
      focus,
      decision,
      `${result.approvalActions.length} แผนพร้อมให้รีวิว`,
      policyText,
    ].filter(Boolean).slice(0, 4),
  }
}

function buildFocusedWorkspaceForBrain(workspace: WorkspaceData, action: MetaRecommendedAction): WorkspaceData {
  const target = action.target.toLowerCase()
  const campaigns = workspace.campaigns.filter((campaign) => campaign.id === action.campaignId || campaign.name.toLowerCase().includes(target))
  const fallbackCampaigns = workspace.campaigns.filter((campaign) => campaign.id === action.campaignId)
  const selectedCampaigns = (campaigns.length ? campaigns : fallbackCampaigns).slice(0, 6)
  const campaignIds = new Set(selectedCampaigns.map((campaign) => campaign.id))
  const adSetsByName = workspace.adSets.filter((adSet) => adSet.name.toLowerCase().includes(target))
  const adSets = [...adSetsByName, ...workspace.adSets.filter((adSet) => campaignIds.has(adSet.campaignId))]
    .filter((adSet, index, list) => list.findIndex((item) => item.id === adSet.id) === index)
    .slice(0, 8)
  const adSetIds = new Set(adSets.map((adSet) => adSet.id))
  const adsByName = workspace.adInsights.filter((ad) => `${ad.name} ${ad.creative}`.toLowerCase().includes(target))
  const adInsights = [...adsByName, ...workspace.adInsights.filter((ad) => campaignIds.has(ad.campaignId) || adSetIds.has(ad.adSetId))]
    .filter((ad, index, list) => list.findIndex((item) => item.id === ad.id) === index)
    .sort((a, b) => b.spend - a.spend || b.score - a.score)
    .slice(0, 12)

  return {
    ...workspace,
    campaigns: selectedCampaigns,
    adSets,
    adInsights,
    trendData: workspace.trendData.slice(-30),
  }
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
      ? `เปิดใช้งาน${objectLabel}ใน Meta`
      : `พัก${objectLabel}ใน Meta`

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
    ? `ส่งคำสั่งไป Meta: ${recommendation.execution.label}`
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

function mapTrendData(points: TrendPoint[]): TrendDatum[] {
  if (!points.length) return []
  return points.slice(-12).map((point, index) => ({
    date: point.date,
    day: formatTrendDay(point.date, index),
    spend: Math.round(point.spend),
    revenue: Math.round(point.revenue),
    bookings: point.bookings,
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
    analytics: ['Ads Dashboard', 'Impressions', 'Clicks', 'Conversions', 'Cost', 'Performance Overview', 'Top Campaigns', 'คำแนะนำที่รออนุมัติ', 'PMC Insights'],
    audience: ['Segment กลุ่มเป้าหมาย', 'ปริมาณของ Segment'],
    creative: ['ผลงานครีเอทีฟ', 'ครีเอทีฟจากข้อมูลจริง'],
    help: ['ศูนย์ช่วยเหลือ', 'Playbook'],
    library: ['คลังโฆษณา', 'Compliance'],
    marketer: ['Insights', 'ผู้ช่วย Insights', 'สิ่งที่ควรดูตอนนี้', 'แผนที่เลือกทำต่อ'],
    optimization: ['Optimizer & Automation', 'Decision Board', 'คิวคำสั่ง Auto Ads'],
    reports: ['ตัวสร้างรายงาน', 'รายงานฉบับร่าง'],
    settings: ['ตั้งค่า Workspace', 'สถานะ API'],
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
  const [apiMessage, setApiMessage] = useState('กำลังเชื่อมต่อ Meta Marketing API')
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [metaInfo, setMetaInfo] = useState<MetaInfo | null>(null)
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

  const displayCampaigns = useMemo(() => (workspace ? workspace.campaigns.map(mapMetaCampaign) : []), [workspace])
  const activeRecommendations = useMemo(
    () => brainApprovalActions.slice(0, 4).map(mapMetaRecommendation),
    [brainApprovalActions],
  )
  const activePage = navItems.find((item) => item.toolbarKey === activeToolbarKey) ?? navItems.find((item) => item.id === activeTab) ?? navItems[0]
  const filteredCampaigns = displayCampaigns.filter((campaign) => campaign.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const effectiveSelectedCampaignId = displayCampaigns.some((campaign) => campaign.id === selectedCampaignId) ? selectedCampaignId : displayCampaigns[0]?.id ?? ''
  const summary = useMemo(() => buildSummaryFromWorkspace(workspace, displayCampaigns), [displayCampaigns, workspace])
  const trendPoints = useMemo(() => mapTrendData(workspace?.trendData ?? []), [workspace])
  const funnelMetrics = workspace?.funnelMetrics ?? []
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
        workspace,
      }),
    [activeTab, apiMessage, dataState, datePreset, effectiveSelectedCampaignId, filteredCampaigns, workspace],
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
    showMascotNotice(isTurningOn ? 'เปิด Auto แล้ว แต่ยังต้องยืนยันก่อนส่ง Meta ทุกครั้ง' : 'ปิด Auto แล้ว ผมจะเฝ้าดูและแจ้งเตือนให้', isTurningOn ? 'good' : 'watch')
    appendAudit({
      action: isTurningOn ? 'เปิด Auto แล้ว' : 'ปิด Auto แล้ว',
      detail: isTurningOn
        ? 'ระบบพร้อมเตรียมคำสั่ง Meta แต่ยังต้องยืนยันก่อนส่งจริงทุกครั้ง'
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
    showMascotNotice('ผู้ช่วย Insights ส่งแผนให้ตรวจแล้วครับ', toneForRisk(action.risk))
    appendAudit({
      action: 'เปิดแผนจากผู้ช่วย Insights',
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
          accountName: 'ยังไม่ได้ตั้งค่าบัญชี Meta',
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
        setApiMessage('เพิ่ม META_ACCESS_TOKEN และ META_AD_ACCOUNT_ID หรือบันทึกข้อมูลผ่านหน้า Settings')
        showMascotNotice('ยังไม่ได้ตั้งค่า API ไปหน้า Settings ก่อนครับ', 'watch')
        return
      }
      if (!status.connected) {
        const failedCheck = status.connection?.checks?.find((check) => check.status === 'fail')
        setWorkspace(null)
        setMetaInfo({
          accountName: 'เชื่อมต่อ Meta API ไม่สำเร็จ',
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
        setApiMessage(formatApiMessage(failedCheck?.detail ?? 'ตั้งค่า credential แล้ว แต่ตรวจสอบการเชื่อมต่อ Meta API ไม่ผ่าน'))
        showMascotNotice('Meta API เชื่อมต่อไม่ผ่าน ตรวจ token หรือสิทธิ์ก่อนครับ', 'critical')
        return
      }

      const datePresetParam = metaDatePresetForUi(datePreset)
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
        ? `${result.meta.source} ซิงก์แคมเปญแล้ว ${result.meta.counts?.campaigns ?? 0} รายการ`
        : 'เชื่อมต่อ Meta API แล้ว แต่ช่วงวันที่นี้ยังไม่มีแคมเปญ'

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
        showMascotNotice(source === 'execution' ? 'อัปเดต Meta แล้ว ซิงก์ผลกลับมาเรียบร้อย' : `ซิงก์ข้อมูลล่าสุดแล้ว ${result.meta.counts?.campaigns ?? 0} แคมเปญ`, 'good')
        appendAudit({
          action: source === 'execution' ? 'รีเฟรช Meta API แล้ว' : 'ซิงก์ workspace แล้ว',
          detail: `${datePreset} · ${result.meta.counts?.campaigns ?? 0} แคมเปญ · ${result.meta.counts?.adSets ?? 0} ชุดโฆษณา`,
          actor: 'ระบบ',
          tone: 'good',
        })
      }
    } catch (error) {
      if (!isLatestRequest()) return

      const formattedMessage = error instanceof Error ? formatApiMessage(error.message) : 'ซิงก์ Meta API ไม่สำเร็จ'
      setWorkspace(null)
      setDataState('error')
      setSyncState('Sync error')
      setApiMessage(formattedMessage)
      showMascotNotice('ซิงก์สะดุดครับ ตรวจการเชื่อมต่อหรือ credential อีกครั้ง', 'critical')
    }
  }, [appendAudit, datePreset, showMascotNotice])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshWorkspace('auto')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshWorkspace])

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
          gsap.set('.ads-outer-toolbar, .topbar', { clearProps: 'all' })
          timeline.from('.ads-dashboard-metric-card, .ads-dashboard-panel', { y: 16, autoAlpha: 0, stagger: { amount: 0.34 } }, '<0.12')

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
    setActiveTab(tab)
    setActiveToolbarKey(toolbarKey ?? navItems.find((item) => item.id === tab)?.toolbarKey ?? 'dashboard')
    const tabNotices: Record<TabId, { message: string; tone: Tone }> = {
      ads: { message: 'เปิด Campaigns แล้ว ตรวจชื่อให้ชัดก่อนเขียน Meta นะครับ', tone: 'watch' },
      analytics: { message: 'กลับมาดู Ads Dashboard ล่าสุดแล้วครับ', tone: 'info' },
      audience: { message: 'เปิด Audience แล้ว ใช้ดู segment ก่อนปรับแคมเปญ', tone: 'info' },
      creative: { message: 'เปิด Creatives แล้ว ดูสัญญาณงานโฆษณาได้ตรงนี้', tone: 'info' },
      help: { message: 'เปิดศูนย์ช่วยเหลือแล้ว ถ้าติดตั้งค่าให้ไป Settings ได้เลย', tone: 'info' },
      library: { message: 'เปิดคลังโฆษณาแล้ว ตรวจ compliance ก่อนนำไปใช้ต่อครับ', tone: 'watch' },
      marketer: { message: 'เปิด Insights แล้ว ตรวจคำแนะนำก่อนตัดสินใจ', tone: 'info' },
      optimization: { message: 'เปิด Optimizer แล้ว กดวิเคราะห์ล่าสุดก่อนดำเนินแผน', tone: 'info' },
      reports: { message: 'เปิด Reports แล้ว ใช้สรุปงานให้ทีมรีวิวได้', tone: 'good' },
      settings: { message: 'เปิด Settings แล้ว ตั้งค่า Meta และ OpenAI API ได้ตรงนี้', tone: 'watch' },
    }
    const notice = tabNotices[tab]
    showMascotNotice(notice.message, notice.tone)
  }, [showMascotNotice])

  const syncWorkspace = () => {
    showMascotNotice('กำลังดึงข้อมูลล่าสุดจาก Meta API ครับ', 'info')
    void refreshWorkspace('manual')
  }

  const rejectRecommendation = (id: string) => {
    const rec = activeRecommendations.find((item) => item.id === id)
    setRecommendationStates((current) => ({ ...current, [id]: 'Rejected' }))
    showMascotNotice('ปฏิเสธคำแนะนำแล้ว ผมจะไม่ใช้ action นี้', 'neutral')
    appendAudit({
      action: 'ปฏิเสธคำแนะนำ',
      detail: rec?.title ?? 'ปฏิเสธคำแนะนำแล้ว',
      actor: 'ผู้ใช้งาน',
      tone: 'neutral',
    })
  }

  const approveRecommendation = (id: string) => {
    showMascotNotice('เปิดหน้าต่างยืนยันแล้ว ตรวจก่อนอนุมัตินะครับ', 'watch')
    setConfirmingId(id)
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
    showMascotNotice(execution ? 'เริ่มส่งคำสั่งตามแผนไป Meta แล้วครับ' : 'เริ่ม checklist แผนแล้ว ยังไม่เขียน Meta', execution ? 'watch' : 'info')

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
        action: 'ดำเนินการตามแผนใน Meta สำเร็จ',
        detail: `${objectTypeLabel(execution.objectType)} ${execution.objectId} · ${execution.status ? mutationStatusLabel(execution.status) : execution.label}`,
        actor: 'Meta API',
        tone: 'good',
      })
      showMascotNotice('ดำเนินการใน Meta สำเร็จแล้วครับ', 'good')
      await refreshWorkspace('execution')
      setActivePlanExecution(null)
    } catch (error) {
      const detail = error instanceof Error ? formatApiMessage(error.message) : 'เขียนข้อมูลไป Meta ไม่สำเร็จ'
      setPlanExecutionError(detail)
      setRecommendationStates((current) => ({ ...current, [rec.id]: 'Failed' }))
      setActivePlanExecution((current) => (current ? { ...current, status: 'ready' } : current))
      appendAudit({
        action: 'ดำเนินการตามแผนไม่สำเร็จ',
        detail,
        actor: 'Meta API',
        tone: 'critical',
      })
      showMascotNotice('ดำเนินการตามแผนไม่สำเร็จ ตรวจข้อความ error ก่อนครับ', 'critical')
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
        detail: error instanceof Error ? formatApiMessage(error.message) : 'เขียนข้อมูลไป Meta ไม่สำเร็จ',
        actor: 'Meta API',
        tone: 'critical',
      })
      showMascotNotice('เขียนข้อมูลไป Meta ไม่สำเร็จ ตรวจ error ก่อนครับ', 'critical')
      setConfirmingId(null)
      setExecutingRecommendationId(null)
      return
    }

    if (rec?.execution) {
      try {
        await refreshWorkspace('execution')
      } catch (error) {
        appendAudit({
          action: 'รีเฟรชหลังเขียนข้อมูลไม่สำเร็จ',
          detail: error instanceof Error ? formatApiMessage(error.message) : 'เขียนข้อมูลไป Meta สำเร็จ แต่ซิงก์รอบถัดไปไม่สำเร็จ',
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
      action: rec?.execution ? 'เขียนข้อมูลไป Meta สำเร็จ' : 'อนุมัติเป็นแผนแล้ว',
      detail: `${rec?.title ?? 'คำแนะนำ'} · ${rec?.execution ? 'ดำเนินการผ่าน Meta API จริง' : 'บันทึกเป็นแผนเท่านั้น ยังไม่เขียนข้อมูลจริง'}`,
      actor: 'ผู้ใช้งาน',
      tone: 'good',
    })
    showMascotNotice(rec?.execution ? 'เขียนข้อมูลไป Meta สำเร็จแล้วครับ' : 'อนุมัติเป็นแผนแล้ว ไปดำเนินการต่อได้', 'good')
    setConfirmingId(null)
    setExecutingRecommendationId(null)
  }

  return (
    <div className="ads-workspace-shell app-shell" ref={shellRef}>
      <AdsOuterToolbar activeToolbarKey={activeToolbarKey} accountName={metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อ Meta'} automationMode={automationMode} dataState={dataState} mascotNotice={mascotNotice} onSelect={handleTabSelect} syncState={syncState} />
      <main className="ads-main-panel app-main">
        <Topbar
          activePage={activePage}
          onSync={syncWorkspace}
          syncState={syncState}
        />
        {dataState === 'live' ? null : <DataSourceBar dataState={dataState} message={apiMessage} metaInfo={metaInfo} onRetry={syncWorkspace} />}
        <div className="page-body">
          {isPageLoading ? (
            <PageSkeleton activeTab={activeTab} />
          ) : (
            <>
          {activeTab === 'analytics' && (
            <AnalyticsPage
              campaigns={filteredCampaigns}
              funnelMetrics={funnelMetrics}
              onApprove={approveRecommendation}
              onReject={rejectRecommendation}
              recommendations={activeRecommendations}
              recommendationStates={recommendationStates}
              summary={summary}
              trendData={trendPoints}
            />
          )}
          {activeTab === 'ads' && (
            <AdsManagerPage
              adSets={workspace?.adSets ?? []}
              ads={workspace?.adInsights ?? []}
              campaigns={displayCampaigns}
              onMutationComplete={() => refreshWorkspace('execution')}
              onSelectCampaign={setSelectedCampaignId}
              searchQuery={searchQuery}
              selectedCampaign={displayCampaigns.find((campaign) => campaign.id === effectiveSelectedCampaignId) ?? displayCampaigns[0]}
              setSearchQuery={setSearchQuery}
            />
          )}
          {activeTab === 'marketer' && (
	            <AiMarketerPage
		              onBrainApprovalActions={setBrainApprovalActions}
              onOpenPlanExecution={openBrainPlanExecution}
	              onQueueBrainAction={queueBrainAction}
              recommendationStates={recommendationStates}
              websiteContext={websiteContext}
              workspace={workspace}
            />
          )}
          {activeTab === 'optimization' && (
            <AutoAdsPage
              adSets={workspace?.adSets ?? []}
              ads={workspace?.adInsights ?? []}
              automationMode={automationMode}
              autoAds={workspace?.autoAds ?? []}
              campaigns={displayCampaigns}
              datePreset={datePreset}
              onDateChange={setDatePreset}
              onModeChange={requestAutomationModeChange}
              onMutationComplete={() => refreshWorkspace('execution')}
              trendData={workspace?.trendData ?? []}
              workspace={workspace}
            />
          )}
          {activeTab === 'creative' && <CreativeStudioPage components={workspace?.insightComponents ?? []} />}
          {activeTab === 'audience' && <AudienceInsightsPage adSets={workspace?.adSets ?? []} />}
          {activeTab === 'library' && <AdLibraryPage reviews={workspace?.complianceReviews ?? []} />}
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
    creative: 'กำลังโหลดครีเอทีฟ',
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
            <p>กำลังซิงก์ข้อมูลจริงและเตรียมหน้าจอ</p>
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
  accountName: string
  automationMode: string
  dataState: DataSourceState
  mascotNotice: MascotNotice | null
  onSelect: (tab: TabId, toolbarKey?: string) => void
  syncState: string
}

function AdsOuterToolbar({ activeToolbarKey, accountName, automationMode, dataState, mascotNotice, onSelect, syncState }: AdsOuterToolbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const statusTone: Tone = dataState === 'live' ? 'good' : dataState === 'error' ? 'critical' : dataState === 'loading' ? 'info' : 'watch'
  const mascotMessage = mascotNotice?.message ?? mascotNoticeForState(dataState, syncState, automationMode)
  const freshnessLabel =
    dataState === 'live'
      ? 'ข้อมูลจริงจาก API'
      : dataState === 'loading'
        ? 'กำลังซิงก์'
        : dataState === 'empty'
          ? 'ยังไม่มีข้อมูล'
          : dataState === 'setup-required'
            ? 'ต้องตั้งค่าก่อน'
            : 'ซิงก์ผิดพลาด'
  const selectTab = (tab: TabId, toolbarKey?: string) => {
    onSelect(tab, toolbarKey)
    setIsMenuOpen(false)
  }

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

      <div className="ads-toolbar-user-card">
        <div className="ads-toolbar-avatar" aria-hidden="true" />
        <div>
          <strong>PMC Team</strong>
          <span>Marketing Manager</span>
        </div>
        <ChevronDown size={16} aria-hidden="true" />
      </div>

      <div className="ads-toolbar-status-card">
        <StatusBadge label={syncStateLabel(syncState)} tone={statusTone} />
        <strong>บัญชีโฆษณา: {accountName}</strong>
        <span>{freshnessLabel}</span>
        <small>{mascotMessage}</small>
      </div>
    </aside>
  )
}

function mascotNoticeForState(dataState: DataSourceState, syncState: string, automationMode: string) {
  if (dataState === 'loading' || syncState === 'Syncing...') return 'กำลังดึงข้อมูลล่าสุดให้ครับ'
  if (dataState === 'error') return 'ซิงก์สะดุด ลองตรวจ token หรือสิทธิ์ Meta'
  if (dataState === 'setup-required') return 'ไปหน้า Settings เพื่อเชื่อม API ก่อนเริ่มงาน'
  if (dataState === 'empty') return 'ช่วงนี้ยังไม่มีข้อมูล ลองเปลี่ยนวันที่ดูครับ'
  if (normalizeAutomationMode(automationMode) === 'พัก automation') return 'Auto ปิดอยู่ ผมจะแค่เฝ้าดูให้'
  if (normalizeAutomationMode(automationMode) === 'ต้องอนุมัติก่อน') return 'Auto เปิดอยู่ ผมจะรอคุณยืนยันก่อนส่ง Meta'
  return 'ข้อมูลพร้อมแล้ว ผมเฝ้าดูแคมเปญให้อยู่'
}

function DataSourceBar({
  dataState,
  message,
  metaInfo,
  onRetry,
}: {
  dataState: DataSourceState
  message: string
  metaInfo: MetaInfo | null
  onRetry: () => void
}) {
  const tone: Tone = dataState === 'live' ? 'good' : dataState === 'error' ? 'critical' : dataState === 'loading' ? 'info' : 'watch'
  const label = dataState === 'live' ? 'Meta API จริง' : dataState === 'loading' ? 'กำลังซิงก์ API' : dataState === 'empty' ? 'ยังไม่มีข้อมูล' : dataState === 'setup-required' ? 'ต้องตั้งค่าก่อน' : 'ซิงก์ผิดพลาด'

  return (
    <section className={`data-source-bar ${dataState}`}>
      <div>
        <StatusBadge label={label} tone={tone} />
        <strong>{metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อ Meta API'}</strong>
        <span>{message}</span>
      </div>
      <div className="data-source-meta">
        <span>{metaInfo?.graphVersion ?? 'Meta Graph API'}</span>
        <span>{metaInfo?.counts ? `${metaInfo.counts.campaigns} แคมเปญ · ${metaInfo.counts.ads} โฆษณา` : 'รอข้อมูลเชื่อมต่อ'}</span>
        <button className="outline-button" type="button" onClick={onRetry} disabled={dataState === 'loading'}>
          ซิงก์อีกครั้ง
        </button>
      </div>
    </section>
  )
}

type TopbarProps = {
  activePage: NavItem
  onSync: () => void
  syncState: string
}

function Topbar({ activePage, onSync, syncState }: TopbarProps) {
  const isSyncing = syncState === 'Syncing...'
  return (
    <header className="topbar">
      <div>
        <h1>{activePage.id === 'analytics' ? 'แดชบอร์ดวิเคราะห์' : activePage.label}</h1>
        <p>{activePage.description}</p>
      </div>
      <div className="topbar-actions">
        <button className="pill-button good api-check-button" type="button" onClick={onSync} aria-label="เช็ค API" aria-busy={isSyncing}>
          <RefreshCw size={15} />
          เช็ค API
        </button>
      </div>
    </header>
  )
}

export function AnalyticsPage({
  campaigns,
  funnelMetrics,
  onApprove,
  onReject,
  recommendations,
  recommendationStates,
  summary,
  trendData,
}: {
  campaigns: Campaign[]
  funnelMetrics: MetaFunnelMetric[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  recommendations: Recommendation[]
  recommendationStates: Record<string, ActionState>
  summary: Summary
  trendData: TrendDatum[]
}) {
  const topCampaigns = [...campaigns]
    .sort((left, right) => right.conversions - left.conversions || right.roas - left.roas)
    .slice(0, 5)
  const averageCtr = campaigns.length > 0 ? campaigns.reduce((sum, campaign) => sum + campaign.ctr, 0) / campaigns.length : 0
  const totalConversions = campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const unavailableMetaMetricChange: MetricChange = { label: 'รอข้อมูล', tone: 'neutral', detail: 'ยังไม่มีข้อมูลจาก Meta' }
  const impressionsCount = funnelMetricCount(funnelMetrics, 'Impressions')
  const clicksCount = funnelMetricCount(funnelMetrics, 'Clicks')
  const metricCards: DashboardMetric[] = [
    { icon: Info, label: 'Impressions', tone: 'sand', value: impressionsCount !== null ? fmtNum(impressionsCount) : 'รอข้อมูล', helper: impressionsCount !== null ? 'จาก Meta funnel ที่ซิงก์' : 'รอ Meta ส่ง impressions สำหรับช่วงนี้', change: impressionsCount !== null ? { label: 'พร้อมดู', tone: 'good', detail: 'จาก funnel metrics' } : unavailableMetaMetricChange },
    { icon: Megaphone, label: 'Clicks', tone: 'blue', value: clicksCount !== null ? fmtNum(clicksCount) : 'รอข้อมูล', helper: clicksCount !== null ? 'จาก Meta funnel ที่ซิงก์' : 'รอ Meta ส่ง clicks สำหรับช่วงนี้', change: clicksCount !== null ? { label: 'พร้อมดู', tone: 'good', detail: 'จาก funnel metrics' } : unavailableMetaMetricChange },
    { icon: Users, label: 'Conversions', tone: 'purple', value: fmtNum(totalConversions || summary.bookings), helper: 'Conversion ที่ Meta track หรือ booking ที่ซิงก์', change: conversionRatePeriodChange(trendData) },
    { icon: CircleDollarSign, label: 'Cost', tone: 'gold', value: fmtMoneyShort(summary.spend), helper: 'ยอด spend รวมในช่วงที่เลือก', change: periodChange(metricTrendValues(trendData, (point) => point.spend), 'จาก spend รายวัน') },
  ]

  return (
    <div className="ads-dashboard-layout">
      <section className="ads-dashboard-head" aria-label="Ads Dashboard actions">
        <div>
          <h2>Ads Dashboard</h2>
          <p>ภาพรวมแคมเปญ คำแนะนำ และตัวเลขที่ควรตรวจวันนี้</p>
        </div>
        <div className="ads-dashboard-actions">
          <button className="clinic-secondary-button" type="button" disabled aria-label="Customize Dashboard ยังไม่พร้อมใช้งาน" title="Customize Dashboard ยังไม่พร้อมใช้งาน">
            Customize Dashboard
          </button>
          <button className="clinic-primary-button" type="button" disabled>New Campaign</button>
        </div>
      </section>

      <section className="ads-dashboard-metric-grid" aria-label="Ads Dashboard metrics">
        {metricCards.map((metric) => (
          <DashboardMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="ads-dashboard-main-grid">
        <DashboardPanel className="performance-panel" title="Performance Overview" subtitle="Spend, revenue และ booking จากข้อมูลที่ซิงก์">
          <RevenueOverviewChart embedded trendData={trendData} />
        </DashboardPanel>
        <DashboardPanel title="Top Campaigns" subtitle="เรียงตาม conversion และ ROAS">
          <div className="ads-top-campaign-list">
            {topCampaigns.length > 0 ? topCampaigns.map((campaign) => (
              <article className="ads-top-campaign-row" key={campaign.id}>
                <span className={`ads-campaign-rank-dot ${campaign.tone}`} />
                <div>
                  <strong>{campaign.name}</strong>
                  <small>{fmtNum(campaign.conversions)} conversions · ROAS {campaign.roas.toFixed(2)}x</small>
                </div>
                <StatusBadge label={campaignStatusLabel(campaign.status)} tone={campaign.tone} />
              </article>
            )) : <EmptyState title="ยังไม่มีแคมเปญให้จัดอันดับ" detail="เมื่อซิงก์ข้อมูล Meta แล้ว แคมเปญที่ทำผลงานดีที่สุดจะแสดงที่นี่" />}
          </div>
        </DashboardPanel>
        <DashboardPanel className="approval-panel" title="คำแนะนำที่รออนุมัติ" subtitle="รายการที่ควรตรวจวันนี้">
          <ApprovalInsightCard onApprove={onApprove} onReject={onReject} recommendations={recommendations} recommendationStates={recommendationStates} />
        </DashboardPanel>
      </section>

      <section className="ads-dashboard-lower-grid" aria-label="Ads Dashboard secondary metrics">
        <DashboardMetricCard metric={{ icon: CircleDollarSign, label: 'Cost per Result', tone: 'sand', value: summary.cpa > 0 ? fmtMoney(summary.cpa) : 'รอข้อมูล', helper: 'spend / booking', change: { label: summary.cpa > 0 ? 'พร้อมดู' : 'รอข้อมูล', tone: summary.cpa > 0 ? 'good' : 'neutral', detail: 'คำนวณจากข้อมูลเดิม' } }} />
        <DashboardMetricCard metric={{ icon: Percent, label: 'CTR', tone: 'blue', value: averageCtr > 0 ? `${averageCtr.toFixed(2)}%` : 'รอข้อมูล', helper: 'ค่าเฉลี่ย CTR ของแคมเปญ', change: { label: averageCtr > 0 ? 'พร้อมดู' : 'รอข้อมูล', tone: averageCtr > 0 ? 'good' : 'neutral', detail: 'จาก campaign insights' } }} />
        <DashboardMetricCard metric={{ icon: LineChart, label: 'ROAS', tone: 'purple', value: summary.roas > 0 ? `${summary.roas.toFixed(2)}x` : 'รอข้อมูล', helper: 'revenue / spend', change: { label: summary.roas > 0 ? 'พร้อมดู' : 'รอข้อมูล', tone: summary.roas > 0 ? 'good' : 'neutral', detail: 'คำนวณจากข้อมูลเดิม' } }} />
        <DashboardPanel className="ads-insight-panel" title="PMC Insights" subtitle="สรุปจากข้อมูลล่าสุด">
          <p>{recommendations.length > 0 ? 'มีคำแนะนำที่รอทีมตรวจและตัดสินใจ' : 'ยังไม่มีคำแนะนำใหม่ในช่วงนี้'}</p>
          <button className="clinic-primary-button" type="button" disabled aria-label="Insights ใช้งานจากเมนูด้านซ้าย">
            View Insights
          </button>
        </DashboardPanel>
      </section>
    </div>
  )
}

type DashboardMetricTone = 'sand' | 'blue' | 'purple' | 'gold'

type DashboardMetric = {
  change: MetricChange
  helper: string
  icon: LucideIcon
  label: string
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
      <div>
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <small>{metric.helper}</small>
      </div>
      <div className="ads-dashboard-metric-change">
        <em className={metric.change.tone}>{metric.change.label}</em>
        <small>{metric.change.detail}</small>
      </div>
    </article>
  )
}

function DashboardPanel({ children, className = '', subtitle, title }: { children: ReactNode; className?: string; subtitle: string; title: string }) {
  return (
    <section className={`ads-dashboard-panel ${className}`.trim()}>
      <div className="ads-dashboard-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function ApprovalInsightCard({
  onApprove,
  onReject,
  recommendations,
  recommendationStates,
}: {
  onApprove: (id: string) => void
  onReject: (id: string) => void
  recommendations: Recommendation[]
  recommendationStates: Record<string, ActionState>
}) {
  const pendingRecommendations = recommendations.filter((rec) => rec.source === 'ai_brain').slice(0, 3)
  if (pendingRecommendations.length === 0) {
    return <EmptyState title="ยังไม่มีรายการที่ต้องอนุมัติ" detail="เมื่อ AI วิเคราะห์ข้อมูลล่าสุด รายการที่ต้องตัดสินใจจะแสดงที่นี่" />
  }

  return (
    <div className="approval-insight-list">
      {pendingRecommendations.map((rec) => {
        const state = recommendationStates[rec.id] ?? 'Suggested'
        const isFinal = state === 'Approved' || state === 'Executed' || state === 'Rejected' || state === 'Failed'
        const isExecuting = state === 'Executing'
        return (
          <article className="approval-insight-card" key={rec.id}>
            <div>
              <StatusBadge label={riskLabel(rec.risk)} tone={toneForRisk(rec.risk)} />
              <strong>{rec.title}</strong>
              <p>{rec.evidence}</p>
            </div>
            {isFinal ? (
              <StatusBadge label={actionStateLabelForPlan(state, rec.execution)} tone={state === 'Executed' || state === 'Approved' ? 'good' : 'critical'} />
            ) : (
              <div className="approval-insight-actions">
                <button className="clinic-primary-button" type="button" onClick={() => onApprove(rec.id)} disabled={isExecuting}>
                  {isExecuting ? 'กำลังดำเนินการ...' : 'รีวิว'}
                </button>
                <button className="clinic-secondary-button" type="button" onClick={() => onReject(rec.id)} disabled={isExecuting}>
                  ปฏิเสธ
                </button>
              </div>
            )}
          </article>
        )
      })}
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
    return { label: 'รอข้อมูล', tone: 'neutral', detail: 'ต้องมี paid cases รายวัน' }
  }

  const midpoint = Math.max(1, Math.floor(trendData.length / 2))
  const previousPoints = trendData.slice(0, midpoint)
  const currentPoints = trendData.slice(midpoint)
  const previousBookings = previousPoints.reduce((sum, point) => sum + point.bookings, 0)
  const currentBookings = currentPoints.reduce((sum, point) => sum + point.bookings, 0)
  const previousPaidCases = previousPoints.reduce((sum, point) => sum + (point.treatments ?? 0), 0)
  const currentPaidCases = currentPoints.reduce((sum, point) => sum + (point.treatments ?? 0), 0)
  const detail = 'จาก paid / booking รายวัน'

  if (previousBookings <= 0) return currentBookings > 0 ? { label: 'มีข้อมูลใหม่', tone: 'good', detail } : { label: 'รอข้อมูล', tone: 'neutral', detail: 'ยังไม่มี booking รายวันพอ' }
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
  chartStyle,
  option,
}: {
  ariaLabel: string
  className?: string
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
      data-chart-source="real"
      data-chart-style={chartStyle}
      ref={containerRef}
      role="img"
    />
  )
}

type EChartTooltipParam = {
  data?: unknown
  marker?: string
  name?: string
  seriesName?: string
  value?: unknown
}

function buildRevenueTrendOption(trendData: TrendDatum[]): EChartsOption {
  return {
    animation: false,
    aria: { enabled: true },
    backgroundColor: 'transparent',
    color: ['#24b6a2', '#2684ff'],
    grid: { bottom: 34, containLabel: true, left: 8, right: 18, top: 42 },
    legend: {
      data: ['Revenue', 'Spend'],
      icon: 'roundRect',
      itemGap: 18,
      itemHeight: 6,
      itemWidth: 22,
      left: 0,
      textStyle: { color: '#53667f', fontSize: 12, fontWeight: 700 },
      top: 0,
    },
    series: [
      {
        data: trendData.map((point) => point.revenue),
        emphasis: { focus: 'series' },
        itemStyle: { color: '#24b6a2' },
        lineStyle: { color: '#24b6a2', width: 2.5 },
        name: 'Revenue',
        showSymbol: true,
        smooth: false,
        symbol: 'rect',
        symbolSize: 5,
        type: 'line',
      },
      {
        data: trendData.map((point) => point.spend),
        emphasis: { focus: 'series' },
        itemStyle: { color: '#2684ff' },
        lineStyle: { color: '#2684ff', type: 'dashed', width: 2.25 },
        name: 'Spend',
        showSymbol: false,
        smooth: false,
        type: 'line',
      },
    ],
    tooltip: {
      appendToBody: true,
      borderColor: '#dce6f2',
      borderWidth: 1,
      className: 'echart-tooltip-surface',
      confine: true,
      formatter: (params: unknown) => formatRevenueTrendTooltip(params, trendData),
      trigger: 'axis',
    },
    xAxis: {
      axisLabel: { color: '#667792', fontSize: 11, fontWeight: 700 },
      axisLine: { lineStyle: { color: '#dce6f2' } },
      axisTick: { show: false },
      boundaryGap: false,
      data: trendData.map((point) => point.day || point.date),
      type: 'category',
    },
    yAxis: {
      axisLabel: { color: '#667792', formatter: fmtChartMoney, fontSize: 11, fontWeight: 700 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#e7edf5' } },
      type: 'value',
    },
  }
}

function asEChartParams(params: unknown): EChartTooltipParam[] {
  if (Array.isArray(params)) return params as EChartTooltipParam[]
  return params ? [params as EChartTooltipParam] : []
}

function eChartParamNumber(value: unknown) {
  if (Array.isArray(value)) {
    const lastValue = value[value.length - 1]
    return Number(lastValue)
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return Number((value as { value?: unknown }).value)
  }
  return Number(value)
}

function formatRevenueTrendTooltip(params: unknown, trendData: TrendDatum[]) {
  const rows = asEChartParams(params)
  const title = rows[0]?.name ?? ''
  const point = trendData.find((item) => (item.day || item.date) === title)
  const revenue = point?.revenue ?? eChartParamNumber(rows.find((row) => row.seriesName === 'Revenue')?.value)
  const spend = point?.spend ?? eChartParamNumber(rows.find((row) => row.seriesName === 'Spend')?.value)
  const bookings = point?.bookings ?? 0
  const roas = spend > 0 ? revenue / spend : 0

  return eChartTooltip(
    point?.date && point.date !== '-' ? point.date : title,
    [
      ['Revenue', fmtMoney(revenue), rows.find((row) => row.seriesName === 'Revenue')?.marker],
      ['Spend', fmtMoney(spend), rows.find((row) => row.seriesName === 'Spend')?.marker],
      ['ROAS', `${roas.toFixed(2)}x`, undefined],
      ['Booking', fmtNum(bookings), undefined],
    ],
  )
}

function eChartTooltip(title: string, rows: Array<[string, string, string | undefined]>) {
  const renderedRows = rows
    .map(
      ([label, value, marker]) =>
        `<span class="echart-tooltip-row">${marker ?? '<i></i>'}<small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`,
    )
    .join('')
  return `<div class="echart-tooltip"><strong>${escapeHtml(title)}</strong>${renderedRows}</div>`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function RevenueOverviewChart({ embedded = false, trendData }: { embedded?: boolean; trendData: TrendDatum[] }) {
  const option = useMemo(() => buildRevenueTrendOption(trendData), [trendData])
  const content = trendData.length > 0 ? (
    <div className="revenue-chart-wrap">
      <EChart ariaLabel="Performance Overview chart" chartStyle="sharp-lines" className="revenue-echart" option={option} />
    </div>
  ) : (
    <EmptyState title="ยังไม่มี Performance Overview" detail="กราฟจะแสดงเมื่อมีข้อมูล trend จาก Meta และ clinic ในช่วงวันที่นี้" />
  )

  if (embedded) {
    return (
      <div className="revenue-chart-panel is-embedded">
        <div className="revenue-chart-inline-head">
          <StatusBadge label="Daily" tone="info" />
        </div>
        {content}
      </div>
    )
  }

  return (
    <SectionCard
      action={<StatusBadge label="Daily" tone="info" />}
      className="revenue-chart-panel"
      collapsible
      title="Performance Overview"
      subtitle="Spend, revenue และ booking รายวันจากข้อมูลที่ซิงก์แล้ว"
    >
      {content}
    </SectionCard>
  )
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
      setMutationMessage(`${objectTypeLabel(pendingMutation.objectType)} ${pendingMutation.kind === 'delete' ? 'ถูกลบ' : 'ถูกอัปเดต'} ใน Meta แล้ว`)
      setPendingMutation(null)
    } catch (error) {
      setMutationMessage(error instanceof Error ? formatApiMessage(error.message) : 'เขียนข้อมูลไป Meta ไม่สำเร็จ')
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
      setMutationMessage(`${objectTypeLabel(editTarget.objectType)} ถูกอัปเดตใน Meta แล้ว`)
      setEditTarget(null)
    } catch (error) {
      setMutationMessage(error instanceof Error ? formatApiMessage(error.message) : 'แก้ไขข้อมูลบน Meta ไม่สำเร็จ')
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
      setMutationMessage('ตรวจสถานะซิงก์จาก Meta API แล้ว')
    } catch (error) {
      setMutationMessage(error instanceof Error ? formatApiMessage(error.message) : 'ตรวจซิงก์ซ้ำไม่สำเร็จ')
    } finally {
      setIsReviewSyncing(false)
    }
  }

  return (
    <TwoColumnPage
      aside={
        <SectionCard collapsible title="แคมเปญที่เลือก" subtitle="รายละเอียดแคมเปญจริงจาก Meta API">
          {selectedCampaign ? (
            <div className="detail-stack">
              <StatusBadge label={deliveryLabel(selectedCampaign.deliveryStatus)} tone={deliveryTone(selectedCampaign.deliveryStatus)} />
              <h3>{selectedCampaign.name}</h3>
              <MetricLine label="Campaign ID" value={shortMetaId(selectedCampaign.id)} />
              <MetricLine label="งบประมาณ" value={fmtMoney(selectedCampaign.budget)} />
              <MetricLine label="ใช้จ่าย" value={fmtMoney(selectedCampaign.spend)} />
              <MetricLine label="ชุดโฆษณา / โฆษณา" value={`${selectedAdSets.length} / ${selectedAds.length}`} />
              <MetricLine label="Conversion ที่ Meta track" value={fmtNum(selectedCampaign.conversions)} />
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
      <SectionCard collapsible title="ตัวจัดการโฆษณา" subtitle="จัดการแคมเปญ ชุดโฆษณา และโฆษณาจากข้อมูล Meta จริง">
        <div className="ads-manager-toolbar">
          <label className="search-box ads-search">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="ค้นหา campaign, ad set หรือ ad" />
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
                        <EmptyState title="ยังไม่มีชุดโฆษณา" detail="Meta ยังไม่ส่งชุดโฆษณาสำหรับแคมเปญนี้" />
                      )}
                    </div>
                  ) : null}
                </article>
              )
            })
          ) : (
            <EmptyState title="ไม่พบ object จาก Meta" detail="ล้างคำค้นหาหรือซิงก์ workspace อีกครั้งเพื่อโหลดแคมเปญ ชุดโฆษณา และโฆษณา" />
          )}
        </div>
      </SectionCard>
      <div className="split-grid">
        <StatePanel
          collapsible
          actionLabel="เปิดรีวิวซิงก์"
          state="ซิงก์ข้อมูลจริงแล้ว"
          detail="ข้อมูล campaign, ad set และ ad insight พร้อมสำหรับรีวิว"
          tone="good"
          onAction={() => setReviewTarget('live')}
        />
        <StatePanel
          collapsible
          actionLabel={isReviewSyncing ? 'กำลังตรวจซ้ำ...' : 'ตรวจซิงก์ซ้ำ'}
          disabled={isReviewSyncing}
          state="ข้อมูลซิงก์เก่า"
          detail="ถ้าข้อมูลเกินช่วง freshness ต้องตรวจซิงก์ซ้ำก่อนเขียนข้อมูลไป Meta"
          tone="watch"
          onAction={() => {
            setReviewTarget('stale')
            void recheckReviewState()
          }}
        />
      </div>

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
  const title = isCampaignReview ? 'Workflow ของแคมเปญที่เลือก' : isStaleReview ? 'ตรวจข้อมูลซิงก์เก่า' : 'รีวิวข้อมูลซิงก์จริง'
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
      ? 'ซิงก์ Meta API ใหม่ก่อนตัดสินใจเขียนข้อมูล ถ้าความสดของข้อมูลยังไม่ชัดเจน'
      : 'โหลดข้อมูล Ads Manager แล้ว และแยกเป็น Campaign, Ad set และ Ad เรียบร้อย'
  const checks = isCampaignReview
    ? [
        { label: 'แคมเปญที่เลือก', value: selectedCampaign ? selectedCampaign.name : 'ยังไม่มีแคมเปญที่เลือก' },
        { label: 'ชุดโฆษณาในแคมเปญ', value: `${selectedAdSets} ชุดโฆษณา` },
        { label: 'โฆษณาในแคมเปญ', value: `${selectedAds} โฆษณา` },
      ]
    : [
        { label: 'แถว Campaign', value: `${campaignsCount} ทั้งหมด · เปิดอยู่ ${activeCampaigns}` },
        { label: 'แถว Ad set', value: `${adSetsCount} ทั้งหมด · เปิดอยู่ ${activeAdSets}` },
        { label: 'แถว Ad', value: `${adsCount} ทั้งหมด · เปิดอยู่ ${activeAds}` },
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
              <MetricLine label="Campaign ID" value={shortMetaId(selectedCampaign.id)} />
              <MetricLine label="งบประมาณ" value={fmtMoney(selectedCampaign.budget)} />
              <MetricLine label="ใช้จ่าย" value={fmtMoney(selectedCampaign.spend)} />
              <MetricLine label="ROAS" value={`${selectedCampaign.roas.toFixed(2)}x`} />
              <MetricLine label="Conversion ที่ Meta track" value={fmtNum(selectedCampaign.conversions)} />
            </>
          ) : (
            <>
              <MetricLine label="Campaign" value={`${campaignsCount}`} />
              <MetricLine label="Ad set" value={`${adSetsCount}`} />
              <MetricLine label="Ad" value={`${adsCount}`} />
              <MetricLine label="Object ที่เปิดอยู่" value={`${activeCampaigns + activeAdSets + activeAds}`} />
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
              {isSyncing ? 'กำลังตรวจซ้ำ...' : 'ตรวจ Meta ซ้ำ'}
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
        title={nextStatus === 'PAUSED' ? 'พักใน Meta' : 'เปิดใช้งานใน Meta'}
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
        title="ลบใน Meta"
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
  const actionLabel = isDelete ? 'ลบใน Meta' : mutation.nextStatus === 'ACTIVE' ? 'เปิดใช้งานใน Meta' : 'พักใน Meta'
  const targetStatus = mutation.kind === 'status' ? mutation.nextStatus : 'Deleted'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ads-mutation-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={isDelete ? 'เขียนข้อมูลแบบลบจริงใน Meta' : 'เขียนข้อมูลจริงใน Meta'} tone="critical" />
        <h2 id="ads-mutation-title">{actionLabel}</h2>
        <p>
          รายการนี้จะทำงานกับ object จริงบน Meta โปรดตรวจขอบเขตก่อนดำเนินการ
          {isDelete ? ' การลบเป็นการทำลายข้อมูลและอาจกระทบ workflow ประวัติ delivery' : ''}
        </p>
        <div className="confirm-grid">
          <MetricLine label="Object" value={mutation.objectName} />
          <MetricLine label="ประเภท" value={objectTypeLabel(mutation.objectType)} />
          <MetricLine label="Meta ID" value={mutation.objectId} />
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
        <StatusBadge label="แก้ไข object ใน Meta" tone="watch" />
        <h2 id="ads-edit-title">แก้ไข {objectTypeLabel(target.objectType)}</h2>
        <p>รายการแก้ไขจะถูกเขียนไป Meta หลังยืนยัน งบประมาณส่งเป็น daily_budget หน่วย THB</p>
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
          <MetricLine label="Object ID" value={target.objectId} />
          <MetricLine label="ประเภท" value={objectTypeLabel(target.objectType)} />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isSaving}>
            ยกเลิก
          </button>
          <button className="primary-button" type="button" onClick={onSave} disabled={isSaving}>
            <Pencil size={14} />
            {isSaving ? 'กำลังบันทึก...' : 'บันทึกไป Meta'}
          </button>
        </div>
      </section>
    </div>
  )
}

function AiMarketerPage({
  onBrainApprovalActions,
  onOpenPlanExecution,
  onQueueBrainAction,
  recommendationStates,
  websiteContext,
  workspace,
}: {
  onBrainApprovalActions: (actions: MetaRecommendedAction[]) => void
  onOpenPlanExecution: (action: MetaRecommendedAction) => void
  onQueueBrainAction: (action: MetaRecommendedAction) => void
  recommendationStates: Record<string, ActionState>
  websiteContext: WebsiteContext
  workspace: WorkspaceData | null
}) {
  const [brainResult, setBrainResult] = useState<AiBrainApiResponse | null>(null)
  const [brainError, setBrainError] = useState('')
  const [brainActionMessage, setBrainActionMessage] = useState('')
  const [brainDeepDive, setBrainDeepDive] = useState<BrainDeepDiveState | null>(null)
  const [deepDiveRunningTargetId, setDeepDiveRunningTargetId] = useState('')
  const [isBrainRunning, setIsBrainRunning] = useState(false)
  const specialistReports = useMemo<AiBrainSpecialistReport[]>(
    () => Object.values(brainResult?.specialistOutputs ?? {}).filter((report): report is AiBrainSpecialistReport => Boolean(report)),
    [brainResult],
  )
  const visibleBrainFindings = useMemo(() => (brainResult?.findings ?? []).filter(isOperatorFacingFinding), [brainResult])
  const masterSummaryView = useMemo(() => (brainResult ? buildMasterSummaryView(brainResult) : null), [brainResult])
  const runMasterAgent = useCallback(async () => {
    if (!workspace || isBrainRunning) return
    setIsBrainRunning(true)
    setBrainError('')

    try {
      const result = await apiJson<AiBrainApiResponse>('/api/ai/brain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: 'Analyze the current Insights page with live website context, runtime memory, and approval-only recommendations.',
          websiteContext,
          workspace,
        }),
      })
      setBrainResult(result)
      onBrainApprovalActions(result.approvalActions ?? [])
      setBrainActionMessage(`สร้างแผนให้รีวิว ${result.approvalActions?.length ?? 0} รายการ และบันทึกความจำระบบ ${result.knowledge?.memoriesWritten ?? 0} รายการ`)
    } catch (error) {
      setBrainError(error instanceof Error ? formatApiMessage(error.message) : 'ผู้ช่วย Insights วิเคราะห์ไม่สำเร็จ')
    } finally {
      setIsBrainRunning(false)
    }
  }, [isBrainRunning, onBrainApprovalActions, websiteContext, workspace])

  const openPlanApproval = useCallback((action: MetaRecommendedAction) => {
    setBrainActionMessage('เปิดหน้าต่างยืนยันแล้ว: ถ้าอนุมัติ ระบบจะเก็บเป็นแผนและ audit trail ก่อน ยังไม่เขียนข้อมูลจริงไป Meta')
    onQueueBrainAction(action)
  }, [onQueueBrainAction])

  const runBrainDeepDive = useCallback(async (action: MetaRecommendedAction) => {
    if (!workspace || deepDiveRunningTargetId) return
    setDeepDiveRunningTargetId(action.id)
    setBrainDeepDive({ actionId: action.id, target: action.target })
    setBrainActionMessage(`กำลังเจาะลึก ${action.target}`)
    try {
      const focusedWorkspace = buildFocusedWorkspaceForBrain(workspace, action)
      const result = await apiJson<AiBrainApiResponse>('/api/ai/brain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: `Deep dive target "${action.target}" in plain Thai. Explain what happened, why it matters, what to check next, and save useful findings to knowledgebase.`,
          websiteContext: {
            ...websiteContext,
            selectedCampaignId: action.campaignId,
            visibleCards: [...websiteContext.visibleCards, `Deep dive: ${action.target}`],
          },
          workspace: focusedWorkspace,
        }),
      })
      setBrainDeepDive({ actionId: action.id, target: action.target, result })
      setBrainActionMessage(`เจาะลึกแล้ว: บันทึก memory ${result.knowledge?.memoriesWritten ?? 0} รายการ`)
    } catch (error) {
      const message = error instanceof Error ? formatApiMessage(error.message) : 'ถามเจาะลึกไม่สำเร็จ'
      setBrainDeepDive({ actionId: action.id, target: action.target, error: message })
      setBrainActionMessage(message)
    } finally {
      setDeepDiveRunningTargetId('')
    }
  }, [deepDiveRunningTargetId, websiteContext, workspace])

  return (
    <TwoColumnPage>
	      <SectionCard
        className="ai-brain-panel"
        collapsible
        title="ผู้ช่วย Insights"
        subtitle="อ่านข้อมูลโฆษณา หน้าปัจจุบัน และข้อมูลที่บันทึกไว้ก่อนสรุปคำแนะนำ"
      >
        <div className="master-agent-launch">
          <button className={`primary-button master-agent-cta ${isBrainRunning ? 'is-running' : ''}`} type="button" onClick={() => void runMasterAgent()} disabled={!workspace || isBrainRunning}>
            <BrainCircuit size={18} />
            <span className="master-agent-cta-copy">
              <strong>{isBrainRunning ? 'กำลังวิเคราะห์' : 'วิเคราะห์ด้วยผู้ช่วย Insights'}</strong>
              <small>{isBrainRunning ? 'กำลังอ่านข้อมูลจริงและข้อมูลที่บันทึกไว้' : 'ให้ระบบสรุปสิ่งที่ควรตรวจตอนนี้'}</small>
            </span>
          </button>
        </div>
        {isBrainRunning ? (
          <MasterAgentSkeleton />
        ) : brainResult ? (
          <div className="ai-brain-result">
            <div className="ai-brain-summary">
              <BrainCircuit size={22} />
              <div>
                <strong>{masterSummaryView?.title ?? 'สรุปจากผู้ช่วย Insights'}</strong>
                <ul>
                  {(masterSummaryView?.items ?? []).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="ai-brain-metrics">
              <MetricLine label="Memory" value={`${brainResult.knowledge?.memoriesRead ?? 0} อ่าน / ${brainResult.knowledge?.memoriesWritten ?? 0} เขียน`} />
              <MetricLine label="Action cards" value={`${brainResult.approvalActions.length} แผน`} />
              <MetricLine label="Agents checked" value={`${specialistReports.length} agents`} />
            </div>
            <div className="ai-brain-list-grid">
              <div>
                <h3>สิ่งที่ควรดูตอนนี้</h3>
                {visibleBrainFindings.slice(0, 4).map((finding) => (
                  <article className="ai-brain-note" key={finding.title}>
	                    <StatusBadge label={riskLabel(finding.risk)} tone={toneForRisk(finding.risk)} />
	                    <strong>{humanizeAiEvidence(finding.title)}</strong>
	                    <p>{humanizeAiEvidence(finding.explanation)}</p>
	                    <small>หลักฐาน: {humanEvidencePreview(finding.evidence)}</small>
	                  </article>
	                ))}
                {!visibleBrainFindings.length ? <EmptyState title="ยังไม่มีสัญญาณผิดปกติชัดเจน" detail="จะแสดงเฉพาะข้อมูลที่ใช้ตัดสินใจเรื่องโฆษณาได้" /> : null}
              </div>
              <div>
                <h3>สิ่งที่ควรทำก่อน</h3>
                {brainResult.recommendations.slice(0, 3).map((recommendation) => (
                  <article className="ai-brain-note" key={`${recommendation.targetId}-${recommendation.type}`}>
	                    <StatusBadge label={recommendation.requiresApproval ? 'ต้องอนุมัติ' : 'รีวิว'} tone="watch" />
	                    <strong>{recommendation.targetName}</strong>
	                    <p>ควรทำ: {recommendation.action}</p>
	                    <small>เกณฑ์ก่อนทำ: {cleanRecommendationCopy(recommendation.guardrail)}</small>
	                  </article>
	                ))}
	              </div>
	            </div>
	            {brainActionMessage ? <p className="ai-brain-action-message">{brainActionMessage}</p> : null}
	            {brainResult.approvalActions.length ? (
	              <div className="ai-brain-approval-list">
	                <h3>แผนที่เลือกทำต่อ</h3>
	                {brainResult.approvalActions.slice(0, 4).map((action) => {
                    const state = recommendationStates[action.id] ?? 'Suggested'
                    const deepDive = brainDeepDive?.actionId === action.id ? brainDeepDive : null
                    const stateTone = state === 'Rejected' || state === 'Failed' ? 'critical' : state === 'Approved' || state === 'Executed' ? 'good' : 'watch'
                    const deepDiveFindings = deepDive?.result?.findings.filter(isOperatorFacingFinding) ?? []
                    const deepDiveRecommendations = deepDive?.result?.recommendations ?? []
                    const deepDiveSummary = deepDive?.result ? humanizeAiEvidence(deepDive.result.summary) || humanizeAiEvidence(deepDive.result.masterDecision) : ''

                    return (
                      <article className="ai-brain-approval-card" key={action.id}>
                        <div>
                          <div className="recommendation-badges">
                            <StatusBadge label={actionStateLabelForPlan(state, action.execution)} tone={stateTone} />
                            <StatusBadge label={riskLabel(action.risk)} tone={toneForRisk(action.risk)} />
                          </div>
                          <strong>{action.target}</strong>
                          <p>ทำอะไรต่อ: {cleanRecommendationCopy(action.summary)}</p>
                          <small>ข้อมูลก่อนทำ: {humanizeAiEvidence(action.before)}</small>
                          {state === 'Approved' ? <p className="ai-brain-next-step">อนุมัติแล้วเป็นแผน: เก็บไว้ในคิวและ audit trail ยังไม่เขียนข้อมูลจริงไป Meta</p> : null}
                          {state === 'Executing' ? <p className="ai-brain-next-step">กำลังดำเนินการตามแผน: เปิดขั้นตอนต่อเพื่อบันทึกผลเมื่อเสร็จ</p> : null}
                          {state === 'Executed' ? <p className="ai-brain-next-step">ดำเนินการแผนเสร็จแล้ว: บันทึกผลไว้ใน audit trail แล้ว</p> : null}
                          {state === 'Rejected' ? <p className="ai-brain-next-step">ปฏิเสธแล้ว: แผนนี้จะไม่ถูกนำไปทำต่อ</p> : null}
                        </div>
                        <div>
                          <span>{action.confidence}% confidence</span>
                          <small>เกณฑ์: {cleanRecommendationCopy(action.guardrail)}</small>
                          <div className="ai-brain-card-actions">
                            <button className="outline-button" type="button" onClick={() => void runBrainDeepDive(action)} disabled={Boolean(deepDiveRunningTargetId)}>
                              <BrainCircuit size={14} />
                              {deepDiveRunningTargetId === action.id ? 'กำลังเจาะลึก' : 'ถามเจาะลึก'}
                            </button>
                            <button
                              className="primary-button"
                              type="button"
                              onClick={() => {
                                if (state === 'Approved' || state === 'Executing') {
                                  onOpenPlanExecution(action)
                                  return
                                }
                                openPlanApproval(action)
                              }}
                              disabled={state === 'Executed' || state === 'Rejected' || state === 'Failed'}
                            >
                              <BookOpenCheck size={14} />
                              {state === 'Executing' ? 'ดำเนินการต่อ' : state === 'Approved' ? 'ดำเนินการแผน' : state === 'Executed' ? 'เสร็จแล้ว' : 'สร้างแผนอนุมัติ'}
                            </button>
                          </div>
                        </div>
                        {deepDive ? (
                          <div className="ai-brain-deep-dive">
                            <div className="recommendation-badges">
                              <StatusBadge label={deepDive.error ? 'เจาะลึกไม่สำเร็จ' : deepDive.result ? 'ผลเจาะลึก' : 'กำลังเจาะลึก'} tone={deepDive.error ? 'critical' : 'violet'} />
                              {deepDive.result ? <StatusBadge label={`${deepDive.result.knowledge?.memoriesWritten ?? 0} memory`} tone="info" /> : null}
                            </div>
                            <strong>{deepDive.target}</strong>
                            {!deepDive.result && !deepDive.error ? <DeepDiveSkeleton /> : null}
                            {deepDive.error ? <p>{deepDive.error}</p> : null}
                            {deepDive.result ? (
                              <>
                                <p>{deepDiveSummary}</p>
                                {deepDiveFindings.length ? (
                                  <div className="ai-brain-deep-dive-grid">
                                    {deepDiveFindings.slice(0, 3).map((finding) => (
                                      <article className="ai-brain-note" key={`deep-${action.id}-${finding.title}`}>
                                        <StatusBadge label={riskLabel(finding.risk)} tone={toneForRisk(finding.risk)} />
                                        <strong>{humanizeAiEvidence(finding.title)}</strong>
                                        <small>{humanEvidencePreview(finding.evidence)}</small>
                                      </article>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="ai-brain-deep-dive-fallback">
                                    <strong>สรุปที่ใช้ตัดสินใจ</strong>
                                    {deepDiveRecommendations.slice(0, 2).map((recommendation) => (
                                      <p key={`${action.id}-${recommendation.targetId}-${recommendation.type}`}>{cleanRecommendationCopy(recommendation.action)}</p>
                                    ))}
                                    {!deepDiveRecommendations.length ? <p>{humanizeAiEvidence(deepDive.result.masterDecision)}</p> : null}
                                  </div>
                                )}
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
	              </div>
	            ) : null}
	          </div>
	        ) : (
          <EmptyState
            title={brainError || 'ยังไม่ได้วิเคราะห์ Insights'}
            detail={workspace ? 'กดวิเคราะห์เพื่อให้ระบบอ่านหน้าปัจจุบันและข้อมูลที่บันทึกไว้ก่อนสรุป' : 'ต้องซิงก์ Meta workspace ก่อนใช้ผู้ช่วย Insights'}
          />
        )}
      </SectionCard>
    </TwoColumnPage>
  )
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

function DeepDiveSkeleton() {
  return (
    <div className="ai-brain-deep-dive-skeleton" aria-live="polite" aria-busy="true">
      <span className="skeleton-line wide" />
      <span className="skeleton-line" />
      <div className="ai-brain-deep-dive-grid">
        {[0, 1, 2].map((item) => (
          <div className="ai-brain-skeleton-card" key={item}>
            <span className="skeleton-pill" />
            <span className="skeleton-line wide" />
            <span className="skeleton-line short" />
          </div>
        ))}
      </div>
    </div>
  )
}

function autoAdSourceRecommendationLabel(recommendation?: WorkspaceData['autoAds'][number]['recommendation']) {
  if (recommendation === 'pause') return 'Meta metrics เข้าเงื่อนไขปิด'
  if (recommendation === 'enable') return 'Meta metrics เข้าเงื่อนไขเปิด'
  if (recommendation === 'keep') return 'Meta metrics เข้าเงื่อนไขเปิดต่อ'
  if (recommendation === 'reduceBudget') return 'Meta metrics เข้าเงื่อนไขลดแรงส่ง'
  return 'อ่านจาก ad insight สด'
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
    `Spend ${fmtMoney(ad.spend)}`,
    `ROAS ${ad.roas.toFixed(2)}x`,
    `CTR ${ad.ctr.toFixed(2)}%`,
    `Booking ${fmtNum(ad.bookings)}`,
    `Metric score ${ad.score.toFixed(1)}`,
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
      ? `ใช้จ่าย ${fmtMoney(ad.spend)} แล้วแต่ยังไม่มี booking ที่ track ได้`
      : lowReturn
        ? `ROAS ${ad.roas.toFixed(2)}x ต่ำกว่า guardrail หลังมี spend แล้ว`
        : 'Meta metrics เข้าเงื่อนไขควรหยุดเพื่อกัน spend ไหลต่อ'
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
      guardrail: `ปิดได้เมื่อ spend เกิน ${fmtMoney(thresholds.minSpend)} และมีสัญญาณ conversion/ROAS ไม่ผ่านเกณฑ์`,
      impact: 'ลดค่าใช้จ่ายของ ad ที่ยังไม่สร้าง booking และบังคับให้ทีมตรวจ creative, offer หรือ tracking ก่อนเปิดใหม่',
      nextStep: 'เพิ่มเข้าคิว แล้วกดยืนยันคิว Auto Ads เพื่อส่งคำสั่ง PAUSED ไป Meta',
      confidence: 0,
      priority: noBookingLeak ? 5 : 4,
      risk: 'High',
      tone: 'critical',
      evidence: noBookingLeak ? ['ไม่มี booking หลังมี spend'] : lowReturn ? ['ROAS ต่ำกว่า 1.00x'] : ['Meta metrics เข้าเงื่อนไขปิด'],
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
      reason: `แม้ ad ถูกพักอยู่ แต่มี ROAS ${ad.roas.toFixed(2)}x, booking ${fmtNum(ad.bookings)} และ metric score ${ad.score.toFixed(1)}`,
      guardrail: 'เปิดกลับเฉพาะ ad ที่มีสัญญาณชนะจาก Meta metrics และซิงก์ซ้ำหลังเขียนข้อมูล',
      impact: 'ให้ ad ที่มีสัญญาณดีมีโอกาสกลับมาส่ง โดยยังคุมด้วยคิวอนุมัติก่อนเขียน Meta',
      nextStep: 'เพิ่มเข้าคิว แล้วส่งคำสั่ง ACTIVE ไป Meta หลังตรวจรายการ',
      confidence: 0,
      priority: 4,
      risk: 'Medium',
      tone: 'good',
      evidence: ['อยู่ในสถานะหยุดอยู่', winner ? 'ผ่านเกณฑ์ winner' : 'Meta metrics เข้าเงื่อนไขเปิด'],
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
      actionLabel: 'ไม่ต้องเขียน Meta',
      reason: `ROAS ${ad.roas.toFixed(2)}x, booking ${fmtNum(ad.bookings)} และ metric score ${ad.score.toFixed(1)} ผ่านเกณฑ์ตัวชนะ`,
      guardrail: 'ไม่เขียนข้อมูลไป Meta ในรอบนี้ ให้ใช้เป็น reference สำหรับ scale หรือทำ creative variation',
      impact: 'รักษา ad ที่ทำงานดีไว้ และแยกออกจากกลุ่มที่ควรถูกปิด',
      nextStep: 'เปิดต่อและใช้ insight นี้เป็นต้นแบบของ creative หรือ audience รอบถัดไป',
      confidence: 0,
      priority: 3,
      risk: 'Low',
      tone: 'good',
      evidence: ['ผ่านเกณฑ์ winner'],
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
      label: 'เฝ้าดูและตรวจ creative',
      actionLabel: 'ยังไม่ส่งคำสั่ง',
      reason: weakCtr ? `CTR ${ad.ctr.toFixed(2)}% ต่ำกว่าเกณฑ์ ${thresholds.ctrFloor.toFixed(2)}%` : `metric score ${ad.score.toFixed(1)} ยังไม่พอให้สั่งเปิดหรือปิด`,
      guardrail: 'ยังไม่ปิดอัตโนมัติจนกว่าจะมี spend และ conversion signal ชัดพอ',
      impact: 'กันการปิดเร็วเกินไป และส่งให้ตรวจ hook, audience, landing หรือ tracking',
      nextStep: 'ติดตามอีกหนึ่งรอบ หรือส่งให้ทีมครีเอทีฟปรับชิ้นงานก่อนตัดสินใจ',
      confidence: 0,
      priority: 2,
      risk: 'Medium',
      tone: 'watch',
      evidence: weakCtr ? ['CTR ต่ำกว่าเกณฑ์'] : sourceReduce ? ['Meta metrics เข้าเงื่อนไขลดแรงส่ง'] : ['Metric score ต่ำ'],
    })
  }

  return finalize({
    id: `auto-os-${ad.id}`,
    ad,
    adSet,
    campaign,
    source: autoAd,
    decision: ad.status === 'active' ? 'keep' : 'watch',
    label: ad.status === 'active' ? 'เปิดต่อแบบ conservative' : 'รอสัญญาณก่อนเปิดกลับ',
    actionLabel: 'ไม่ต้องเขียน Meta',
    reason: `ยังไม่มีสัญญาณบวกหรือลบที่แรงพอ · spend ${fmtMoney(ad.spend)} · ROAS ${ad.roas.toFixed(2)}x`,
    guardrail: 'รอ insight รอบถัดไปก่อน execute เพื่อเลี่ยงการเปลี่ยนสถานะที่ไม่จำเป็น',
    impact: 'เก็บข้อมูลต่อจนกว่า Meta metrics จะมีสัญญาณชัดพอ',
    nextStep: ad.status === 'active' ? 'เปิดต่อและติดตาม metric หลัก' : 'ยังไม่เปิดกลับจนกว่าจะมีสัญญาณ winner',
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
      nextStep: 'ตรวจสาเหตุและซิงก์ข้อมูลล่าสุดก่อนตัดสินใจอีกครั้ง',
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
    .replace(/Meta metrics/gi, 'ข้อมูลจาก Meta')
    .replace(/winner/gi, 'ตัวชนะ')
    .replace(/booking/gi, 'ยอดจอง')
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
        ? `ปรับ Meta จริง ${optimizerWritablePlans.length} รายการ`
        : 'ไม่มีรายการที่ต้องเขียน Meta'
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
      setMessage('ยังไม่มีรายการเข้าเงื่อนไขจาก Meta metrics สำหรับกลยุทธ์นี้')
      return
    }
    const firstPlan = optimizerPlans[0]
    if (firstPlan) setSelectedPlanId(firstPlan.id)
    if (automationPaused) {
      setMessage('Auto ปิดอยู่: เปิด Auto ก่อนส่งคำสั่งไป Meta')
      return
    }
    if (!approvalMode) {
      if (optimizerWritablePlans.length > 0) {
        onModeChange('ต้องอนุมัติก่อน')
        setMessage(`ยืนยันเปิด Auto ก่อน แล้วกด "ปรับ Meta จริง ${optimizerWritablePlans.length} รายการ" เพื่อเปิดหน้าต่างยืนยันรายการ`)
        return
      }
      setShowAllRecommendations(true)
      setMessage(`พบ ${optimizerPlans.length} รายการจาก Meta จริง แต่ยังไม่มีคำสั่งที่ต้องส่งไป Meta`)
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
      setMessage(plan.blockedReason ?? 'รายการนี้ยังไม่พร้อมเขียน Meta จากสถานะปัจจุบัน')
      return
    }
    if (plan.targetStatus) {
      if (automationPaused) {
        setMessage('Auto ปิดอยู่: เปิด Auto ก่อนส่งคำสั่งไป Meta')
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
      setMessage('ต้องเปิด Auto ก่อนส่งคำสั่งไป Meta แล้วกดยืนยันอีกครั้ง')
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
      setMessage(`ใช้คำแนะนำแล้ว: ${pendingPlan.ad.name} ถูก${mutationStatusLabel(pendingPlan.targetStatus)}ใน Meta`)
      setPendingPlan(null)
    } catch (error) {
      setMessage(error instanceof Error ? formatApiMessage(error.message) : 'เขียนสถานะไป Meta ไม่สำเร็จ')
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
      setMessage('ไม่มีรายการใน batch ที่ยังเขียน Meta ได้จริงหลังตรวจสถานะล่าสุด')
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
      setMessage(`อัปเดตสถานะจริงใน Meta แล้ว ${writablePlans.length} รายการ`)
      setPendingOptimizerBatch(null)
    } catch (error) {
      setMessage(error instanceof Error ? formatApiMessage(error.message) : 'ส่งคำสั่งไป Meta ไม่สำเร็จ')
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
              <p>ตรวจข้อมูล Meta ล่าสุด จัดลำดับแผน และให้ยืนยันก่อนส่งคำสั่งจริง</p>
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

            <div className="optimizer-control-kpis" aria-label="Optimizer metrics from Meta">
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
                <small>ROAS / Booking</small>
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
                aria-label={approvalMode ? 'เปิดหน้าต่างยืนยันรายการก่อนส่ง Meta' : 'เปิด Auto เพื่อส่งคำสั่ง'}
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
                  detail={optimizerAi ? 'ไม่พบรายการที่ควรแสดงในกลุ่มนี้' : 'ระบบจะแสดงแผนหลังตรวจข้อมูล Meta จริงเสร็จ'}
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
                detail={workspace ? 'กดวิเคราะห์ข้อมูลล่าสุด เพื่อสร้างเหตุผลให้แต่ละแผน' : 'ต้องเชื่อมต่อ Meta API ก่อน'}
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
        <h2 id="optimizer-action-title">ใช้คำแนะนำนี้กับ Meta</h2>
        <p>หลังยืนยัน ระบบจะเปลี่ยนสถานะโฆษณานี้ใน Meta ตรวจชื่อโฆษณาและเหตุผลให้ครบก่อนดำเนินการ</p>
        <div className="confirm-grid">
          <MetricLine label="โฆษณา" value={plan.ad.name} />
          <MetricLine label="Meta ID" value={shortMetaId(plan.ad.id)} />
          <MetricLine label="คำสั่งที่จะส่ง" value={actionLabel} />
          <MetricLine label="ค่าใช้จ่าย / ROAS" value={`${fmtMoney(plan.ad.spend)} · ${plan.ad.roas.toFixed(2)}x`} />
          <MetricLine label="ยอดจอง" value={fmtNum(plan.ad.bookings)} />
          <MetricLine label="เหตุผล" value={optimizerUiText(plan.reason, plan.reason)} />
          <MetricLine label="ถ้าต้องย้อนกลับ" value="เปิดหรือปิดกลับได้จาก Ads Manager หลังซิงก์ข้อมูลใหม่" />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className={plan.targetStatus === 'PAUSED' ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={isExecuting || !plan.targetStatus}>
            {isExecuting ? 'กำลังอัปเดต Meta...' : `ยืนยัน ${actionLabel}`}
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
        <p>รายละเอียดนี้อ้างอิงข้อมูล Meta รอบล่าสุด และจะยังไม่เปลี่ยนสถานะจริงจนกว่าคุณจะกดยืนยัน</p>
        <div className="confirm-grid">
          <MetricLine label="โฆษณา" value={plan.ad.name} />
          <MetricLine label="แคมเปญ" value={plan.campaign?.name ?? shortMetaId(plan.ad.campaignId)} />
          <MetricLine label="Meta ID" value={shortMetaId(plan.ad.id)} />
          <MetricLine label="สถานะปัจจุบัน" value={deliveryLabel(plan.ad.status)} />
          <MetricLine label="สิ่งที่แนะนำ" value={actionLabel} />
          <MetricLine label="ค่าใช้จ่าย / ROAS" value={`${fmtMoney(plan.ad.spend)} · ${plan.ad.roas.toFixed(2)}x`} />
          <MetricLine label="ยอดจอง / CPA" value={`${fmtNum(plan.ad.bookings)} · ${cpa ? fmtMoney(cpa) : 'ยังไม่มียอดจอง'}`} />
          <MetricLine label="CTR / Score" value={`${plan.ad.ctr.toFixed(2)}% · ${plan.ad.score.toFixed(1)}`} />
          <MetricLine label="เหตุผล" value={optimizerUiText(plan.reason, plan.reason)} />
          <MetricLine label="เงื่อนไขก่อนทำ" value={optimizerUiText(plan.guardrail, plan.guardrail)} />
          <MetricLine label="ขั้นถัดไป" value={optimizerUiText(plan.nextStep, plan.nextStep)} />
        </div>
        <div className="optimizer-evidence-list" aria-label="หลักฐานจาก Meta metrics">
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
        <p>หลังยืนยัน ระบบจะส่งคำสั่งไป Meta เฉพาะรายการที่ผ่านเงื่อนไขและตรวจแล้วเท่านั้น</p>
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
                ค่าใช้จ่าย {fmtMoney(plan.ad.spend)} · ROAS {plan.ad.roas.toFixed(2)}x · ยอดจอง {fmtNum(plan.ad.bookings)}
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
  return `ข้อมูล Meta จริง: ค่าใช้จ่าย ${fmtMoneyShort(plan.ad.spend)} · ROAS ${plan.ad.roas.toFixed(2)}x · ยอดจอง ${fmtNum(plan.ad.bookings)}`
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
  if (strategy === 'pause') return 'เฉพาะโฆษณาที่เปิดอยู่และเข้าเงื่อนไขหยุดจากค่าใช้จ่าย, ROAS หรือยอดจอง'
  if (strategy === 'activate') return 'เฉพาะโฆษณาที่หยุดอยู่แต่มีสัญญาณชนะจากข้อมูล Meta ล่าสุด'
  if (strategy === 'keep') return 'โฆษณาที่เปิดอยู่และผ่านเกณฑ์ตัวชนะ ใช้เป็นต้นแบบโดยไม่เขียน Meta'
  if (strategy === 'watch') return 'โฆษณาที่ยังไม่ควรเปลี่ยนสถานะ แต่ควรติดตามครีเอทีฟหรือการวัดผล'
  return 'รวมทุกกลุ่มจากข้อมูล Meta ล่าสุด แล้วแยกเฉพาะรายการที่ส่งคำสั่ง Meta ได้จริง'
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
    { decision: 'pause', detail: 'ปิด ad ที่กินงบแต่ยังไม่สร้าง booking/ROAS', count: pauseCount, tone: 'critical' },
    { decision: 'keep', detail: 'เปิดต่อและกันไว้เป็น winner/reference', count: keepCount, tone: 'good' },
    { decision: 'activate', detail: 'เปิดกลับเฉพาะ ad ที่หยุดอยู่แต่มีสัญญาณดี', count: activateCount, tone: 'violet' },
    { decision: 'watch', detail: 'เฝ้าดู creative, audience หรือ tracking ต่อ', count: watchCount, tone: 'watch' },
  ]

  const queuePlan = (plan: AutoAdPlan) => {
    if (automationPaused) {
      setAutoAdsMessage('Auto ปิดอยู่ เปิด Auto ก่อนเพิ่มคำสั่งเข้าคิว')
      return
    }
    if (!plan.targetStatus) {
      setAutoAdsMessage('รายการนี้เป็น insight เท่านั้น ยังไม่ต้องเขียนสถานะไป Meta')
      return
    }
    if (!plan.canQueue) {
      setAutoAdsMessage(plan.blockedReason ?? 'รายการนี้ยังไม่ผ่าน guardrail สำหรับ Auto Ads')
      return
    }
    if (queuedPlans.length >= queueLimit && !queuedPlanIds[plan.id]) {
      setAutoAdsMessage(`คิวต่อรอบจำกัด ${queueLimit} รายการ เพื่อให้ตรวจรายการก่อนเขียน Meta`)
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
      setAutoAdsMessage('ยังไม่มี ad ที่ผ่าน guardrail สำหรับเข้าคิวอัตโนมัติ')
      return
    }
    const next = Object.fromEntries(candidates.map((plan) => [plan.id, true]))
    setQueuedPlanIds((current) => ({ ...current, ...next }))
    setAutoAdsMessage(
      queueablePlans.length > candidates.length
        ? `เพิ่ม ${candidates.length} รายการแรกเข้าคิวแล้ว ที่เหลือให้ตรวจในรอบถัดไป`
        : `เพิ่ม ${candidates.length} รายการที่ผ่าน guardrail เข้าคิวแล้ว`,
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
    setAutoAdsMessage(`วิเคราะห์ใหม่จาก Meta ad insight ${plans.length} รายการแล้ว`)
  }

  const openConfirmModal = () => {
    if (automationPaused) {
      setAutoAdsMessage('Auto ปิดอยู่ เปิด Auto ก่อนยืนยันคำสั่ง')
      return
    }
    if (queuedPlans.length === 0) {
      setAutoAdsMessage('ยังไม่มีคำสั่งในคิว เลือก ad ที่ AI แนะนำก่อน')
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
      setAutoAdsMessage(`Auto Ads อัปเดตสถานะจริงใน Meta แล้ว ${queuedPlans.length} รายการ`)
      setQueuedPlanIds({})
      setIsConfirming(false)
    } catch (error) {
      setAutoAdsMessage(error instanceof Error ? formatApiMessage(error.message) : 'Auto Ads เขียนข้อมูลไป Meta ไม่สำเร็จ')
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <>
      <TwoColumnPage
        aside={
          <>
            <SectionCard className="auto-os-inspector" collapsible title="Ad ที่กำลังรีวิว" subtitle="AI decision, evidence และ action ที่จะส่งไป Meta">
              {activePlan ? (
                <div className="detail-stack">
                  <div className="auto-os-badges">
                    <StatusBadge label={autoAdDecisionLabel(activePlan.decision)} tone={activePlan.tone} />
                    <StatusBadge label={deliveryLabel(activePlan.ad.status)} tone={deliveryTone(activePlan.ad.status)} />
                    <StatusBadge label={`Metric score ${activePlan.ad.score.toFixed(1)}`} tone={activePlan.tone} />
                  </div>
                  <h3 className="auto-os-inspector-title">{activePlan.ad.name}</h3>
                  <MetricLine label="Campaign" value={activePlan.campaign?.name ?? shortMetaId(activePlan.ad.campaignId)} />
                  <MetricLine label="Ad set" value={activePlan.adSet?.name ?? shortMetaId(activePlan.ad.adSetId)} />
                  <MetricLine label="Action" value={activePlan.targetStatus ? mutationStatusLabel(activePlan.targetStatus) : 'ไม่ต้องเขียน Meta'} />
                  <MetricLine label="เหตุผล" value={activePlan.reason} />
                  <MetricLine label="Guardrail" value={activePlan.guardrail} />
                  <div className="auto-os-evidence-stack">
                    {activePlan.evidence.slice(0, 6).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                  <div className="campaign-detail-actions">
                    <button className={activePlan.targetStatus === 'PAUSED' ? 'danger-button' : 'primary-button'} type="button" onClick={() => queuePlan(activePlan)} disabled={!activePlan.targetStatus || automationPaused || !activePlan.canQueue}>
                      {activePlan.targetStatus ? activePlan.actionLabel : 'ไม่ต้องเขียน Meta'}
                    </button>
                    <button className="outline-button" type="button" onClick={() => toggleSkipPlan(activePlan)}>
                      {skippedPlanIds[activePlan.id] ? 'คืนคิว' : 'ข้ามรอบนี้'}
                    </button>
                  </div>
                </div>
              ) : (
                <EmptyState title="ยังไม่มี Ad insight" detail="ซิงก์ Meta API แล้ว Auto Ads จะวิเคราะห์ ad-level insight ให้" />
              )}
            </SectionCard>
            <SectionCard collapsible title="คิวคำสั่ง Auto Ads" subtitle="เปิด/ปิดระดับ Ad หลังตรวจรายการและกดยืนยัน">
              <div className="auto-os-queue-head">
                <StatusBadge label={`${queuedPlans.length}/${queueLimit} รายการ`} tone={queuedPlans.length > 0 ? 'violet' : 'neutral'} />
                <button className="primary-button" type="button" onClick={openConfirmModal} disabled={queuedPlans.length === 0 || automationPaused}>
                  ยืนยันคิวใน Meta
                </button>
              </div>
              <div className="auto-os-queue-list">
                {queuedPlans.length > 0 ? (
                  queuedPlans.map((plan) => (
                    <div className="auto-os-queue-row" key={plan.id}>
                      <StatusBadge label={mutationStatusLabel(plan.targetStatus ?? '')} tone={plan.targetStatus === 'PAUSED' ? 'critical' : 'good'} />
                      <strong>{plan.ad.name}</strong>
                      <span>{shortMetaId(plan.ad.id)} · {fmtMoney(plan.ad.spend)} spend</span>
                      <button className="outline-button" type="button" onClick={() => removeQueuedPlan(plan.id)}>
                        เอาออก
                      </button>
                    </div>
                  ))
                ) : (
                  <EmptyState title="ยังไม่มีคำสั่งในคิว" detail="เลือก ad ที่ AI แนะนำให้ปิดหรือเปิดกลับ หรือใช้ปุ่มเพิ่มรายการที่ผ่าน guardrail" />
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
          subtitle="AI อ่าน ad-level insight จริง แล้วแยกว่าตัวไหนควรปิด เปิดต่อ เปิดกลับ หรือเฝ้าดู"
        >
          <div className="auto-os-command-grid">
            <div className="auto-os-command-copy">
              <div className="auto-os-brand-row">
                <span className="auto-os-orb">
                  <Power size={18} />
                </span>
                <div>
                  <strong>Auto Ads Operating System</strong>
                  <span>วิเคราะห์ → จัดคิว → ยืนยันก่อนเขียน Meta</span>
                </div>
              </div>
              <div className="auto-os-steps" aria-label="Auto Ads workflow">
                <span>1 วิเคราะห์ {fmtNum(ads.length)} ads</span>
                <span>2 ตรวจ {fmtNum(confirmableCount)} actions</span>
                <span>3 ส่งคิว {fmtNum(queuedPlans.length)} รายการ</span>
              </div>
            </div>
            <div className="auto-os-control-grid">
              <label>
                โหมด
                <AutomationToggleControl mode={automationMode} onModeChange={onModeChange} />
              </label>
              <label>
                Spend ขั้นต่ำ
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
              เพิ่มรายการที่ผ่าน guardrail
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

        <SectionCard collapsible title="ภาพรวมการตัดสินใจ" subtitle="กดแต่ละช่องเพื่อกรองรายการใน Decision Board">
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

        <SectionCard collapsible title="Decision Board" subtitle="รายการถูกจัดตาม Meta metrics และ spend ที่เสี่ยงไหลต่อ">
          <div className="auto-os-toolbar">
            <label className="search-box">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา ad, campaign หรือ ad set" />
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
                      {!plan.canQueue && plan.targetStatus ? <StatusBadge label="รอ guardrail" tone="watch" /> : null}
                    </div>
                    <h3>{plan.ad.name}</h3>
                    <p>{plan.campaign?.name ?? 'Meta campaign'} · {plan.adSet?.name ?? 'Meta ad set'}</p>
                    <span>{plan.reason}</span>
                    <div className="auto-os-card-evidence">
                      {plan.evidence.slice(0, 5).map((item) => (
                        <small key={item}>{item}</small>
                      ))}
                    </div>
                  </div>
                  <div className="auto-os-card-metrics">
                    <MetricLine label="Spend" value={fmtMoney(plan.ad.spend)} />
                    <MetricLine label="ROAS" value={`${plan.ad.roas.toFixed(2)}x`} />
                    <MetricLine label="CTR" value={`${plan.ad.ctr.toFixed(2)}%`} />
                    <MetricLine label="Booking" value={fmtNum(plan.ad.bookings)} />
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
                      <span className="auto-os-noop">ไม่ต้องเขียน Meta</span>
                    )}
                  </div>
                </article>
              ))
            ) : ads.length > 0 ? (
              <EmptyState title="ไม่พบ ad ตามเงื่อนไข" detail="ล้างคำค้นหาหรือเปลี่ยนตัวกรองเพื่อดู Auto Ads ทั้งหมด" />
            ) : (
              <EmptyState title="ยังไม่มี ad insight" detail="กดซิงก์ Meta API เพื่อโหลด Ads แล้วให้ AI วิเคราะห์ Auto Ads" />
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
        <p>ระบบจะส่งคำสั่งเปิด/ปิดระดับ Ad ไปที่ Meta ตามรายการในคิว หลังจากกดปุ่มยืนยันนี้เท่านั้น</p>
        <div className="confirm-grid">
          <MetricLine label="จำนวน action" value={`${plans.length} รายการ`} />
          <MetricLine label="ปิด ad" value={`${pauseCount} รายการ`} />
          <MetricLine label="เปิด ad" value={`${activateCount} รายการ`} />
          <MetricLine label="Rollback" value="สามารถเปิด/ปิดกลับจาก Ads Manager หลัง sync" />
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
            {isExecuting ? 'กำลังส่งคำสั่ง...' : 'ยืนยันใน Meta'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function CreativeStudioPage({ components }: { components: WorkspaceData['insightComponents'] }) {
  const syncedCount = components.length

  return (
    <TwoColumnPage
      aside={
        <StatePanel
          state="กลับมาทำต่อเร็ว ๆ นี้"
          detail="หน้านี้ถูกพักไว้ชั่วคราวเพื่อปรับ workflow ครีเอทีฟให้ชัดกว่าเดิม ก่อนเปิดใช้งานอีกครั้ง"
          tone="watch"
        />
      }
    >
      <section className="panel creative-updating-panel">
        <StatusBadge label="กำลังอัพเดท" tone="watch" />
        <h2>สตูดิโอครีเอทีฟกำลังอัพเดท</h2>
        <p>ทีมกำลังปรับหน้า Creative Studio ให้ใช้งานได้ครบขึ้น ระหว่างนี้ข้อมูลครีเอทีฟและการทำงานต่อจากครีเอทีฟจะถูกพักไว้ก่อน</p>
        <div className="creative-updating-meta" aria-label="สถานะข้อมูลครีเอทีฟ">
          <MetricLine label="ข้อมูลครีเอทีฟที่ซิงก์ไว้" value={`${fmtNum(syncedCount)} รายการ`} />
          <MetricLine label="สถานะหน้า" value="พักการใช้งานชั่วคราว" />
          <MetricLine label="Action ใน Meta" value="ไม่มีการเขียนข้อมูลอัตโนมัติ" />
        </div>
      </section>
      <StatePanel
        state="ข้อมูลครีเอทีฟที่ซิงก์ไว้ยังปลอดภัย"
        detail="ข้อมูลจาก Meta ยังอยู่ใน workspace แต่หน้านี้จะไม่แนะนำหรือสร้างงานครีเอทีฟจนกว่าจะปรับ workflow เสร็จ"
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
          detail={`${segments.length} segment จาก ${adSets.length} ad set โดยรวมค่า spend, booking และ CPA แล้ว`}
          tone={segments.length > 0 ? 'good' : 'neutral'}
        />
      }
    >
      <SectionCard collapsible title="Segment กลุ่มเป้าหมาย" subtitle="Segment ที่เชื่อมกับ outcome ใน funnel คลินิก">
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
                <span>{fmtNum(segment.bookings)} booking</span>
                <StatusBadge label={aiStatusLabel(segment.status)} tone={toneForAiStatus(segment.status)} />
                <span>{fmtMoney(segment.cpa)} CPA</span>
              </div>
            ))
          ) : (
            <EmptyState title="ยังไม่มีข้อมูลกลุ่มเป้าหมาย" detail="แถว audience จะแสดงหลังซิงก์ targeting ของ ad set จาก Meta" />
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
    <SectionCard collapsible title="ปริมาณของ Segment" subtitle="ค่าโฆษณาและ booking ตาม audience ของ ad set จริง">
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
        <EmptyState title="ยังไม่มีกราฟ segment" detail="ค่าโฆษณาและ booking ของ ad set จะแสดงที่นี่หลังซิงก์" />
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
      aside={<StatePanel state="เฝ้าระวัง Compliance" detail="ข้อความ claim ทางการแพทย์ต้องผ่านการรีวิวก่อน launch" tone="watch" />}
    >
      <SectionCard collapsible title="คลังโฆษณา" subtitle="Asset, ความเสี่ยง compliance และความพร้อมก่อน launch">
        <div className="card-grid">
          {reviews.length > 0 ? (
            reviews.map((review) => (
              <article className="asset-card" key={review.id}>
                <div className={`asset-thumb ${review.thumbnailUrl ? 'has-image' : ''}`}>
                  {review.thumbnailUrl ? <img alt={review.title} loading="lazy" src={review.thumbnailUrl} /> : <ImageIcon size={24} />}
                </div>
                <h3>{review.title}</h3>
                <p>{review.issue || review.fix || review.service}</p>
                <p className="asset-source-note">{review.source ? `แหล่งข้อมูล: ${review.source}` : 'ตรวจจาก metadata และชื่อโฆษณาที่ Meta ส่งมา'}</p>
                <StatusBadge label={complianceStatusLabel(review.status)} tone={toneForComplianceStatus(review.status)} />
              </article>
            ))
          ) : (
            <EmptyState title="ยังไม่มีข้อมูลคลังโฆษณา" detail="การ์ด compliance ของครีเอทีฟจะแสดงหลังซิงก์ ad records จาก Meta สำเร็จ" />
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
    : 'ยังไม่มีคำแนะนำจาก AI ในช่วงข้อมูลนี้'

  return [
    'รายงาน PMC Ads Agent',
    `ช่วงข้อมูล: ${datePreset}`,
    `บัญชี: ${metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อ Meta API'}`,
    `สถานะซิงก์: ${syncStateLabel(syncState)}`,
    '',
    'ตัวชี้วัด',
    `- ค่าโฆษณา: ${fmtMoney(summary.spend)}`,
    `- รายได้: ${fmtMoney(summary.revenue)}`,
    `- ROAS: ${summary.roas.toFixed(2)}x`,
    `- CPA / Booking: ${fmtMoney(summary.cpa)}`,
    `- Lead: ${fmtNum(summary.leads)}`,
    `- Booking: ${fmtNum(summary.bookings)}`,
    `- เคสชำระเงิน: ${fmtNum(summary.paidTreatments)}`,
    '',
    'งานจาก AI',
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
          detail={`${metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อ Meta API'} · ${syncStateLabel(syncState)} · ${datePreset}`}
          tone={preparedReport ? 'good' : 'neutral'}
        />
      }
    >
      <SectionCard collapsible title="ตัวสร้างรายงาน" subtitle="เตรียมรายงานปฏิบัติการให้พร้อมรีวิว">
        <div className="report-preview">
          <StatusBadge label={preparedReport ? 'พร้อม' : 'ฉบับร่าง'} tone={preparedReport ? 'good' : 'neutral'} />
          <h3>{preparedReport ? 'รายงานข้อมูลทั้งหมดพร้อมแล้ว' : 'เตรียมรายงานจากหน้า Analytics'}</h3>
          <p>รวมค่าโฆษณา รายได้ ROAS, funnel คลินิก และคำแนะนำจาก AI ที่เกี่ยวกับการตัดสินใจ</p>
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
  const account = metaInfo?.workspaceLabel || metaInfo?.accountName || 'ยังไม่ได้เชื่อมต่อ Meta API'
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
      ? 'มี credential ที่บันทึกผ่านหน้า Settings'
      : 'มี credential จาก server environment'
    : 'ยังไม่พบ credential ที่บันทึกไว้'
  const tokenLocationLabel =
    metaInfo?.tokenLocation === 'server-local-file'
      ? 'เก็บ token ในไฟล์ config ฝั่ง server ของเครื่องนี้'
      : metaInfo?.tokenLocation === 'server-env'
        ? 'อ่าน token จาก environment variable ฝั่ง server'
        : 'ยังไม่มีตำแหน่ง token'
  const dataModeLabel =
    dataState === 'live'
      ? 'ซิงก์ข้อมูลจริงแล้ว'
      : dataState === 'loading'
        ? 'กำลังซิงก์'
        : dataState === 'empty'
          ? 'ยังไม่มีข้อมูล'
          : dataState === 'setup-required'
            ? 'ต้องตั้งค่าก่อน'
            : 'ซิงก์ผิดพลาด'

  const openAiCredentialLabel = openAiStatus?.configured
    ? openAiStatus.tokenLocation === 'web-settings'
      ? 'เชื่อม OpenAI จากหน้า Settings แล้ว'
      : openAiStatus.tokenLocation === 'server-env'
        ? 'เชื่อม OpenAI จาก Render/server env'
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
      setSettingsMessage(error instanceof Error ? formatApiMessage(error.message) : 'โหลดสถานะ Meta API ไม่สำเร็จ')
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
    setSettingsMessage(saveAsNewWorkspace ? 'กำลังเพิ่ม Ads Account แยก...' : 'กำลังบันทึกค่า Meta API...')
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
      setSettingsMessage(`บันทึกค่า Meta API แล้ว${renderPersistenceLabel(result.renderPersistence)} กำลังซิงก์ workspace จริง...`)
      setAccessToken('')
      setIsConfirmingConfigSave(false)
      setSaveAsNewWorkspace(false)
      void loadMetaConfig()
      onSync()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? formatApiMessage(error.message) : 'บันทึกค่า Meta API ไม่สำเร็จ')
    } finally {
      setIsSavingConfig(false)
    }
  }

  const switchMetaWorkspace = async () => {
    if (!selectedWorkspaceId) return
    setIsSwitchingWorkspace(true)
    setSettingsMessage('กำลังสลับ Ads Account และตรวจการเชื่อมต่อ...')
    try {
      const result = await apiJson<MetaConfigResponse>('/api/meta/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'switch', workspaceId: selectedWorkspaceId }),
      })
      setMetaConfigState(result)
      setWorkspaceLabel(result.workspaceLabel || activeWorkspace?.label || '')
      setSettingsMessage(`สลับ Ads Account เป็น ${result.workspaceLabel || activeWorkspace?.label || 'workspace ที่เลือก'} แล้ว`)
      onSync()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? formatApiMessage(error.message) : 'สลับ Ads Account ไม่สำเร็จ')
    } finally {
      setIsSwitchingWorkspace(false)
    }
  }

  const disconnectMetaApi = async () => {
    setIsDisconnectingMeta(true)
    setSettingsMessage('กำลังตัดการเชื่อมต่อ Meta API...')
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
      setOpenAiMessage(`เชื่อมต่อ OpenAI API สำเร็จ${renderPersistenceLabel(result.renderPersistence)} และบันทึกไว้ฝั่ง server แล้ว`)
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
            detail={`${metaInfo?.source ?? 'Meta Marketing API'} · ${metaInfo?.graphVersion ?? 'รอการตั้งค่า'} · ${savedCredentialLabel}`}
            tone={stateTone}
          />
        }
      >
        <SectionCard collapsible title="ตั้งค่า Workspace" subtitle="การเชื่อมต่อ Meta, OpenAI และความพร้อมของแหล่งข้อมูล">
          <div className="settings-credential-state">
            <StatusBadge label={savedCredentialLabel} tone={metaConfigState?.settingsSource || metaInfo?.settingsSource ? 'good' : 'watch'} />
            <span>{tokenLocationLabel}</span>
            {metaInfo?.adAccountId ? <span>Ad Account: {metaInfo.adAccountId}</span> : null}
          </div>
          <div className="workspace-switcher">
            <div>
              <strong>Ads Account ที่ใช้งาน</strong>
              <span>{activeWorkspace ? `${activeWorkspace.label} · ${activeWorkspace.adAccountId}` : 'ยังไม่มี Ads Account ที่บันทึกไว้'}</span>
            </div>
            <select aria-label="เลือก Ads Account workspace" value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)} disabled={!metaWorkspaces.length || isSwitchingWorkspace}>
              {metaWorkspaces.length ? (
                metaWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.label} · {workspace.adAccountId}
                  </option>
                ))
              ) : (
                <option value="">ยังไม่มี workspace</option>
              )}
            </select>
            <button className="primary-button" type="button" onClick={() => void switchMetaWorkspace()} disabled={!selectedWorkspaceId || isSwitchingWorkspace || selectedWorkspace?.active}>
              {isSwitchingWorkspace ? 'กำลังสลับ...' : 'สลับ Ads Account'}
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
              ชื่อ Workspace
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
                <option>ซิงก์ข้อมูลจริงแล้ว</option>
                <option>กำลังซิงก์</option>
                <option>ยังไม่มีข้อมูล</option>
                <option>ต้องตั้งค่าก่อน</option>
                <option>ซิงก์ผิดพลาด</option>
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
              {isSavingConfig && saveAsNewWorkspace ? 'กำลังเพิ่ม...' : 'เพิ่ม Ads Account แยก'}
            </button>
          </div>
          {settingsMessage ? <p className="settings-message">{settingsMessage}</p> : null}

          <div className="settings-divider" />
          <div className="settings-credential-state">
            <StatusBadge label={openAiCredentialLabel} tone={openAiTone} />
            <span>{openAiStatus?.source ?? 'OpenAI Responses API'}</span>
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
              Max output tokens
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
          <StatePanel collapsible state="ต้องตั้งค่าก่อน" detail="แสดงเมื่อยังไม่มี API credential หรือ ad account" tone="watch" />
          <StatePanel collapsible state="ยังไม่มีข้อมูล" detail="แสดงเมื่อช่วงวันที่ที่เลือกไม่มีแคมเปญหรือ record ของ clinic funnel" tone="neutral" />
          <StatePanel collapsible state="ตัดการเชื่อมต่อ" detail="แสดงเมื่อ Meta authentication ไม่ผ่าน และ action เขียนข้อมูลจะถูกปิดไว้จนกว่าจะเชื่อมต่อใหม่" tone="critical" />
          <StatePanel
            collapsible
            actionLabel={isSyncing ? 'กำลังลองใหม่...' : 'ซิงก์อีกครั้ง'}
            detail="แสดงเมื่อ API refresh ไม่สำเร็จ ควรซิงก์ใหม่จากหน้านี้ก่อนรีวิว"
            disabled={isSyncing}
            onAction={onSync}
            state="ซิงก์ผิดพลาด"
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
        <StatusBadge label="บันทึก credential จริง" tone="watch" />
        <h2 id="settings-save-title">{isNewWorkspace ? 'ยืนยันการเพิ่ม Ads Account' : 'ยืนยันการบันทึก Meta API'}</h2>
        <p>ระบบจะตรวจ credential กับ Meta บันทึกไว้ฝั่ง server และซิงก์ขึ้น Render env เพื่อให้ deploy รอบถัดไปยังเชื่อมต่ออยู่</p>
        <div className="confirm-grid">
          <MetricLine label="Workspace" value={workspaceLabel || (isNewWorkspace ? 'workspace ใหม่' : 'workspace ปัจจุบัน')} />
          <MetricLine label="Access Token" value={hasAccessToken ? 'มี token ใหม่ในฟอร์ม' : 'ใช้ token ที่บันทึกไว้เดิม'} />
          <MetricLine label="Ad Account ID" value={adAccountId || 'ใช้ค่าที่บันทึกไว้เดิม'} />
          <MetricLine label="ตำแหน่งบันทึก" value="server-local-file + Render env" />
          <MetricLine label="หลังบันทึก" value="ตรวจ connection และซิงก์ workspace" />
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
        <p>ระบบจะทดสอบ key กับ OpenAI Responses API แล้วบันทึกไว้ฝั่ง server เท่านั้น ไม่ส่ง key กลับไปแสดงใน browser</p>
        <div className="confirm-grid">
          <MetricLine label="OpenAI API Key" value={hasApiKey ? 'มี key ใหม่ในฟอร์ม' : 'ใช้ key ที่บันทึกไว้เดิม'} />
          <MetricLine label="Model" value={model || 'gpt-5.5'} />
          <MetricLine label="Max output tokens" value={maxOutputTokens || '2800'} />
          <MetricLine label="ตำแหน่งบันทึก" value="server-local-file / Render env fallback" />
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
          detail: 'ข้อมูล Meta API ซิงก์สำเร็จแล้ว ใช้ Analytics, Ads Manager และ Insights ได้ตามปกติ',
          tone: 'good' as Tone,
          action: 'ซิงก์อีกครั้ง',
          onAction: onSync,
        }
      : dataState === 'setup-required'
        ? {
            state: 'ต้องตั้งค่า Meta API',
            detail: 'เพิ่ม Access Token และ Ad Account ID ในหน้า Settings ก่อนใช้งานข้อมูลจริง',
            tone: 'watch' as Tone,
            action: 'เปิด Settings',
            onAction: onOpenSettings,
          }
        : dataState === 'error'
          ? {
              state: 'ซิงก์ผิดพลาด',
              detail: 'ตรวจ token, permission หรือรอ rate limit จาก Meta แล้วลองซิงก์อีกครั้ง',
              tone: 'critical' as Tone,
              action: 'ซิงก์อีกครั้ง',
              onAction: onSync,
            }
          : dataState === 'empty'
            ? {
                state: 'ยังไม่มีข้อมูลในช่วงนี้',
                detail: 'ลองเปลี่ยนช่วงวันที่หรือกดซิงก์อีกครั้งเพื่อโหลด campaign/ad insight',
                tone: 'neutral' as Tone,
                action: 'ซิงก์อีกครั้ง',
                onAction: onSync,
              }
            : {
                state: 'กำลังซิงก์',
                detail: 'ระบบกำลังโหลดข้อมูลจาก Meta API โปรดรอสักครู่',
                tone: 'info' as Tone,
                action: 'กำลังซิงก์...',
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
      <SectionCard collapsible title="ศูนย์ช่วยเหลือ" subtitle="Playbook สำหรับรีวิวโฆษณาคลินิกรายวัน">
        <div className="help-list">
          {[
            ['รีวิวรายวัน', 'ตรวจ KPI, จุดหลุดใน funnel, ตารางแคมเปญ และคิว AI'],
            ['ก่อนอนุมัติ action ที่เขียนข้อมูล', 'ยืนยันขอบเขต object, evidence, guardrail, ผลกระทบที่คาดไว้ และ rollback'],
            ['เมื่อข้อมูลเก่า', 'ซิงก์ workspace ก่อนเชื่อคำแนะนำจาก AI'],
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
    <div className="two-column-page">
      <section className="main-stack">{children}</section>
      {aside ? <aside className="right-rail">{aside}</aside> : null}
    </div>
  )
}

function CollapseButton({
  collapsed,
  controlsId,
  label = 'ข้อมูล',
  onToggle,
}: {
  collapsed: boolean
  controlsId?: string
  label?: string
  onToggle: () => void
}) {
  const Icon = collapsed ? ChevronRight : ChevronDown

  return (
    <button
      className="collapse-button"
      type="button"
      aria-expanded={!collapsed}
      aria-controls={controlsId}
      aria-label={collapsed ? `ขยาย ${label}` : `พับ ${label}`}
      onClick={onToggle}
    >
      <Icon size={15} />
      {collapsed ? 'ขยายข้อมูล' : 'พับข้อมูล'}
    </button>
  )
}

function CollapsedPlaceholder({ title }: { title: string }) {
  return (
    <div className="collapsed-placeholder">
      <div>
        <strong>{title}</strong>
        <span>ข้อมูลถูกพับเก็บไว้เพื่อลดความแน่นของหน้าจอ</span>
      </div>
      <ChevronRight size={18} />
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
  collapsible = false,
  collapseLabel,
  defaultCollapsed = false,
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
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const contentId = useId()
  const hasActions = Boolean(action) || collapsible
  const panelClassName = ['panel', className, isCollapsed ? 'is-collapsed' : ''].filter(Boolean).join(' ')
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
            {collapsible ? (
              <CollapseButton
                collapsed={isCollapsed}
                controlsId={contentId}
                label={collapseLabel ?? title}
                onToggle={() => setIsCollapsed((value) => !value)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div id={contentId} className="panel-collapsible-content" role={collapsible ? 'region' : undefined} aria-label={collapsible ? title : undefined}>
        {isCollapsed ? <CollapsedPlaceholder title={title} /> : children}
      </div>
    </section>
  )
}

function StatePanel({
  actionLabel = 'ตรวจสถานะ',
  collapsible = false,
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
  const [isCollapsed, setIsCollapsed] = useState(false)
  const contentId = useId()

  return (
    <section className={`panel state-panel ${isCollapsed ? 'is-collapsed' : ''}`}>
      {collapsible ? (
        <div className="state-panel-head">
          <StatusBadge label={state} tone={tone} />
          <CollapseButton
            collapsed={isCollapsed}
            controlsId={contentId}
            label={state}
            onToggle={() => setIsCollapsed((value) => !value)}
          />
        </div>
      ) : (
        <StatusBadge label={state} tone={tone} />
      )}
      <div id={contentId} className="state-panel-content" role={collapsible ? 'region' : undefined} aria-label={collapsible ? state : undefined}>
        {isCollapsed ? (
          <CollapsedPlaceholder title={state} />
        ) : (
          <>
            <p>{detail}</p>
            {onAction ? (
              <button className="outline-button" type="button" onClick={onAction} disabled={disabled}>
                {actionLabel}
              </button>
            ) : null}
          </>
        )}
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
  const statusLabel = execution?.status ? mutationStatusLabel(execution.status) : execution?.operation ? 'อัปเดต object' : 'ไม่มีคำสั่ง Meta'
  const modalTitle = execution ? 'ตรวจคำสั่ง Meta ก่อนส่งจริง' : 'ทำตาม checklist ของแผน'
  const modalIntro = execution
    ? 'แผนนี้อนุมัติแล้ว ด้านล่างแยกให้ชัดว่าอะไรคือแผนที่ใช้ตัดสินใจ และอะไรคือคำสั่งที่จะส่งผ่าน Meta API เมื่อคุณกดยืนยันเท่านั้น'
    : 'แผนนี้เป็นงานตรวจสอบ/วิเคราะห์ที่ยังไม่มีคำสั่ง Meta ชัดพอ ระบบจะไม่เดาเอง ให้ทำตาม checklist แล้วบันทึกผลไว้ใน audit trail'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal plan-execution-modal" role="dialog" aria-modal="true" aria-labelledby="plan-execution-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="ปิดขั้นตอนดำเนินการแผน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={isExecuting ? 'กำลังส่งคำสั่งไป Meta' : execution ? 'พร้อมให้ยืนยันคำสั่ง Meta' : isRunning ? 'กำลังทำ checklist' : 'แผนพร้อมตรวจ'} tone={isExecuting ? 'critical' : execution ? 'watch' : isRunning ? 'info' : 'good'} />
        <h2 id="plan-execution-title">{modalTitle}</h2>
        <p>{modalIntro}</p>
        <div className="plan-execution-target">
          <section className="plan-execution-section" aria-label="แผนที่อนุมัติ">
            <h3>แผนที่อนุมัติ</h3>
            <MetricLine label="แผน" value={rec.action} />
            <MetricLine label="เหตุผลของแผน" value={rec.evidence} />
            <MetricLine label="ความเสี่ยง" value={riskLabel(rec.risk)} />
            <MetricLine label="Confidence" value={`${rec.confidence}%`} />
            <MetricLine label="เงื่อนไขควบคุม" value={rec.guardrail} />
          </section>
          {execution ? (
            <section className="plan-execution-section danger" aria-label="คำสั่ง Meta ที่จะส่ง">
              <h3>คำสั่ง Meta ที่จะส่ง</h3>
              <MetricLine label="คำสั่ง" value={execution.label} />
              <MetricLine label="เป้าหมายใน Meta" value={`${objectTypeLabel(execution.objectType)} ${execution.objectId}`} />
              <MetricLine label="สถานะที่จะตั้ง" value={statusLabel} />
            </section>
          ) : (
            <section className="plan-execution-section" aria-label="สถานะคำสั่ง Meta">
              <h3>คำสั่ง Meta</h3>
              <MetricLine label="สถานะ" value="ยังไม่มีคำสั่งที่ปลอดภัยพอให้ execute อัตโนมัติ" />
            </section>
          )}
        </div>
        <h3 className="plan-execution-steps-title">ลำดับการตรวจ</h3>
        <ol className="plan-execution-steps">
          {draft.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {error ? <div className="plan-execution-error" role="alert">{error}</div> : null}
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={isExecuting}>
            กลับไปดูรายการแผน
          </button>
          {execution ? (
            <button className="danger-button" type="button" onClick={onStart} disabled={isExecuting}>
              {isExecuting ? 'กำลังส่งคำสั่งไป Meta...' : 'ยืนยันส่งคำสั่งไป Meta'}
            </button>
          ) : isRunning ? (
            <button className="primary-button" type="button" onClick={onComplete} disabled={isExecuting}>
              บันทึกว่าเสร็จแล้ว
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={onStart} disabled={isExecuting}>
              เริ่มทำตาม checklist
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
  const targetLabel = targetCampaign?.name ?? (execution ? `${executionObjectTypeLabel} ${execution.objectId}` : 'Action ของ workspace')
  const requestedStatus = execution?.status ? mutationStatusLabel(execution.status) : execution?.operation ? 'อัปเดต object' : 'บันทึกเป็นแผน'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={execution ? 'เขียนข้อมูลจริงใน Meta' : 'อนุมัติเป็นแผน'} tone={execution ? 'critical' : 'watch'} />
        <h2 id="confirm-title">{recommendation.action}</h2>
        <p>
          {execution
            ? 'หลังยืนยัน ระบบจะส่งคำสั่งไป Meta API จริงตามขอบเขตด้านล่าง'
            : 'หลังยืนยัน ระบบจะบันทึกเป็นแผนก่อน จากนั้นเปิดขั้นตอนดำเนินการต่อ ถ้าแผนมีคำสั่ง Meta ที่ชัดเจนคุณจะกดส่งคำสั่งจริงได้ในขั้นตอนถัดไป'}
        </p>
        <div className="confirm-grid">
          <MetricLine label="แคมเปญ / เป้าหมาย" value={targetLabel} />
          <MetricLine label="ประเภท object" value={executionObjectTypeLabel} />
          <MetricLine label="สถานะ delivery ปัจจุบัน" value={targetCampaign ? campaignStatusLabel(targetCampaign.status) : 'รีวิวเท่านั้น'} />
          <MetricLine label="สถานะที่ต้องการ" value={requestedStatus} />
          <MetricLine label="Rollback" value={execution ? 'พร้อมหลังดำเนินการ' : 'ไม่ต้อง rollback เพราะยังไม่เขียน Meta'} />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className={execution ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={isExecuting}>
            {isExecuting ? 'กำลังดำเนินการ...' : execution ? 'ยืนยันใน Meta' : 'อนุมัติเป็นแผน'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default App
