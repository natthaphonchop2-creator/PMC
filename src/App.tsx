import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  BookOpenCheck,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  HelpCircle,
  ImageIcon,
  Layers3,
  LineChart,
  Menu,
  Megaphone,
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
import gsap from 'gsap'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CampaignInsight, FunnelMetric as MetaFunnelMetric, RecommendedAction as MetaRecommendedAction, TrendPoint, WorkspaceData } from './types'
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
  execution?: MetaRecommendedAction['execution']
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

type TrendDatum = { day: string; spend: number; revenue: number; bookings: number }

type DataSourceState = 'loading' | 'live' | 'setup-required' | 'empty' | 'error'

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

type OptimizerRule = {
  id: string
  title: string
  subtitle: string
  type: 'Budget' | 'Pause' | 'Schedule' | 'Creative'
  condition: string
  lastRun: string
  runCount: number
  tone: Tone
  defaultEnabled: boolean
  affectedAds: number
}

type OptimizerStrategy = AutoAdDecision | 'all'

type OptimizerBatch = {
  generatedAt: string
  plans: AutoAdPlan[]
  strategy: OptimizerStrategy
}

type OptimizerRuleFormValues = {
  affectedAds: number
  condition: string
  enabled: boolean
  title: string
  type: OptimizerRule['type']
}

type OptimizerRuleRunState = {
  lastRun: string
  matchedCount: number
  runCount: number
}

type OptimizerRuleCandidate = {
  action: string
  ad: WorkspaceData['adInsights'][number]
  campaign?: Campaign
  plan: AutoAdPlan
  reason: string
  targetStatus?: 'ACTIVE' | 'PAUSED'
  writable: boolean
}

type OptimizerRuleRun = {
  candidates: OptimizerRuleCandidate[]
  generatedAt: string
  rule: OptimizerRule
  writeEnabled: boolean
}

type MetaStatusResponse = {
  configured: boolean
  connected: boolean
  graphVersion?: string
  adAccountId?: string | null
  datePreset?: string
  source?: string
  settingsSource?: string | null
  tokenLocation?: string | null
  connection?: { ok?: boolean; checks?: Array<{ key: string; label: string; status: string; detail: string }> }
  requiredEnv?: Array<{ key: string; present: boolean; help?: string }>
}

type MetaWorkspaceResponse = {
  workspace: WorkspaceData
  meta: {
    account?: { name?: string; account_id?: string; currency?: string; timezone_name?: string }
    counts?: { campaigns: number; adSets: number; ads: number; timeSeries: number }
    datePreset: string
    fetchedAt: string
    graphVersion: string
    source: string
  }
}

type MetaInfo = {
  accountName: string
  adAccountId?: string | null
  fetchedAt: string
  graphVersion: string
  source: string
  settingsSource?: string | null
  tokenLocation?: string | null
  counts?: MetaWorkspaceResponse['meta']['counts']
}

const navItems: NavItem[] = [
  { id: 'analytics', label: 'วิเคราะห์', group: 'Main', icon: LineChart, description: 'ภาพรวมโฆษณา Meta, funnel คลินิก, งานจาก AI และสถานะ audit' },
  { id: 'ads', label: 'ตัวจัดการโฆษณา', group: 'Main', icon: Megaphone, description: 'ควบคุม Campaign, Ad set และ Ad จาก Meta' },
  { id: 'marketer', label: 'นักการตลาด AI', group: 'Main', icon: BrainCircuit, description: 'คิวคำแนะนำ การอนุมัติ และ workflow ก่อนเขียนข้อมูลจริง' },
  { id: 'optimization', label: 'Optimizer & Automation', group: 'Main', icon: Power, description: 'เพิ่มประสิทธิภาพแคมเปญด้วย AI และระบบอัตโนมัติ เพื่อผลลัพธ์ที่ดีกว่า' },
  { id: 'creative', label: 'สตูดิโอครีเอทีฟ', group: 'Creative', icon: Layers3, description: 'ผลงานครีเอทีฟจาก ads และ insight ที่ซิงก์มา' },
  { id: 'audience', label: 'กลุ่มเป้าหมาย', group: 'Creative', icon: Users, description: 'Segment, placement, พื้นที่ และคุณภาพ lead' },
  { id: 'library', label: 'คลังโฆษณา', group: 'Creative', icon: ImageIcon, description: 'Asset, compliance และความพร้อมก่อนเปิดใช้งาน' },
  { id: 'reports', label: 'รายงาน', group: 'System', icon: FileText, description: 'Audit trail และการเตรียมรายงานสำหรับรีวิว' },
  { id: 'settings', label: 'ตั้งค่า', group: 'System', icon: Settings, description: 'การเชื่อมต่อ Meta, workspace และความพร้อมของ API' },
  { id: 'help', label: 'ศูนย์ช่วยเหลือ', group: 'System', icon: HelpCircle, description: 'คู่มือ setup, สถานะระบบ และ playbook การใช้งาน' },
]

const datePresetOptions = ['ข้อมูลทั้งหมด', '7 วันล่าสุด', '30 วันล่าสุด', 'เดือนนี้', 'ไตรมาสนี้']
const automationModeOptions = ['แนะนำเท่านั้น', 'ต้องอนุมัติก่อน', 'พัก automation']

const fmtMoney = (value: number) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(value)

const fmtNum = (value: number) => new Intl.NumberFormat('th-TH').format(value)
const fmtMoneyShort = (value: number) => (value >= 1000 ? `฿${Math.round(value / 1000)}k` : fmtMoney(value))

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

function navGroupLabel(group: NavItem['group']) {
  if (group === 'Main') return 'หลัก'
  if (group === 'Creative') return 'ครีเอทีฟ'
  return 'ระบบ'
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

function campaignStatusLabel(status: Campaign['status']) {
  if (status === 'Active') return 'ปกติ'
  if (status === 'Watch') return 'เฝ้าดู'
  return 'วิกฤต'
}

function aiTagLabel(tag: string) {
  if (tag === 'Scale') return 'ขยายผล'
  if (tag === 'Pause') return 'ควรพัก'
  if (tag === 'Watch') return 'เฝ้าดู'
  if (tag === 'Healthy') return 'แข็งแรง'
  return tag
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

function actorLabel(actor: string) {
  if (actor === 'System') return 'ระบบ'
  if (actor === 'Operator') return 'ผู้ใช้งาน'
  return actor
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    'Meta API refreshed': 'รีเฟรช Meta API แล้ว',
    'Workspace synced': 'ซิงก์ workspace แล้ว',
    'Rejected recommendation': 'ปฏิเสธคำแนะนำ',
    'Execution failed': 'ดำเนินการไม่สำเร็จ',
    'Post-write refresh failed': 'รีเฟรชหลังเขียนข้อมูลไม่สำเร็จ',
    'Meta write succeeded': 'เขียนข้อมูลไป Meta สำเร็จ',
    'Review completed': 'รีวิวเสร็จแล้ว',
    'Report prepared': 'เตรียมรายงานแล้ว',
  }
  return labels[action] ?? action
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
    evidence: action.summary,
    risk: action.risk,
    confidence: action.confidence,
    guardrail: action.guardrail,
    impact: `${action.before}. หลังทำ: ${recommendationActionLabel(action.after)}. ${action.rollbackNote}`,
    action: recommendationActionLabel(action.execution?.label ?? action.after),
    campaignId: action.campaignId,
    execution: action.execution,
  }
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
    day: point.date.slice(5) || String(index + 1),
    spend: Math.round(point.spend / 1000),
    revenue: Math.round(point.revenue / 1000),
    bookings: point.bookings,
  }))
}

function mapWorkspaceAuditEvent(event: WorkspaceData['auditTrail'][number]): AuditEvent {
  return {
    id: event.id,
    action: event.action,
    detail: `${event.target} · ${event.after}`,
    actor: event.actor,
    time: new Date(event.timestamp).toLocaleString('th-TH', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
    }),
    tone: event.action.toLowerCase().includes('failed') ? 'critical' : 'good',
  }
}

function toneForRisk(risk: Recommendation['risk']): Tone {
  if (risk === 'High') return 'critical'
  if (risk === 'Medium') return 'watch'
  return 'good'
}

function App() {
  const shellRef = useRef<HTMLDivElement>(null)
  const refreshRequestRef = useRef(0)
  const [activeTab, setActiveTab] = useState<TabId>('analytics')
  const [datePreset, setDatePreset] = useState('ข้อมูลทั้งหมด')
  const [automationMode, setAutomationMode] = useState('แนะนำเท่านั้น')
  const [syncState, setSyncState] = useState('Checking Meta API')
  const [dataState, setDataState] = useState<DataSourceState>('loading')
  const [apiMessage, setApiMessage] = useState('กำลังเชื่อมต่อ Meta Marketing API')
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [metaInfo, setMetaInfo] = useState<MetaInfo | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCampaignId, setSelectedCampaignId] = useState('')
  const [recommendationStates, setRecommendationStates] = useState<Record<string, ActionState>>({})
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [executingRecommendationId, setExecutingRecommendationId] = useState<string | null>(null)
  const [auditTrail, setAuditTrail] = useState<AuditEvent[]>([])
  const [preparedReport, setPreparedReport] = useState(false)

  const displayCampaigns = useMemo(() => (workspace ? workspace.campaigns.map(mapMetaCampaign) : []), [workspace])
  const activeRecommendations = useMemo(
    () => (workspace ? workspace.actions.slice(0, 4).map(mapMetaRecommendation) : []),
    [workspace],
  )
  const activeAuditTrail = useMemo(
    () => (workspace ? [...auditTrail, ...workspace.auditTrail.map(mapWorkspaceAuditEvent)].slice(0, 8) : auditTrail),
    [auditTrail, workspace],
  )
  const activePage = navItems.find((item) => item.id === activeTab) ?? navItems[0]
  const filteredCampaigns = displayCampaigns.filter((campaign) => campaign.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const effectiveSelectedCampaignId = displayCampaigns.some((campaign) => campaign.id === selectedCampaignId) ? selectedCampaignId : displayCampaigns[0]?.id ?? ''
  const visibleSelectedCampaign = filteredCampaigns.find((campaign) => campaign.id === effectiveSelectedCampaignId) ?? filteredCampaigns[0]
  const summary = useMemo(() => buildSummaryFromWorkspace(workspace, displayCampaigns), [displayCampaigns, workspace])
  const trendPoints = useMemo(() => mapTrendData(workspace?.trendData ?? []), [workspace])
  const funnelMetrics = workspace?.funnelMetrics ?? []
  const confirmingRecommendation = confirmingId ? activeRecommendations.find((item) => item.id === confirmingId) : undefined

  const appendAudit = useCallback((event: Omit<AuditEvent, 'id' | 'time'>) => {
    const nextEvent: AuditEvent = {
      ...event,
      id: `audit-${Date.now()}`,
      time: 'ตอนนี้',
    }
    setAuditTrail((current) => [nextEvent, ...current].slice(0, 8))
  }, [])

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
          fetchedAt: new Date().toISOString(),
          graphVersion: status.graphVersion ?? 'v21.0',
          source: status.source ?? 'Meta Marketing API',
          settingsSource: status.settingsSource ?? null,
          tokenLocation: status.tokenLocation ?? null,
        })
        setDataState('setup-required')
        setSyncState('Setup required')
        setApiMessage('เพิ่ม META_ACCESS_TOKEN และ META_AD_ACCOUNT_ID หรือบันทึกข้อมูลผ่านหน้า Settings')
        return
      }
      if (!status.connected) {
        const failedCheck = status.connection?.checks?.find((check) => check.status === 'fail')
        setWorkspace(null)
        setMetaInfo({
          accountName: 'เชื่อมต่อ Meta API ไม่สำเร็จ',
          adAccountId: status.adAccountId ?? null,
          fetchedAt: new Date().toISOString(),
          graphVersion: status.graphVersion ?? 'v21.0',
          source: status.source ?? 'Meta Marketing API',
          settingsSource: status.settingsSource ?? null,
          tokenLocation: status.tokenLocation ?? null,
        })
        setDataState('error')
        setSyncState('Sync error')
        setApiMessage(formatApiMessage(failedCheck?.detail ?? 'ตั้งค่า credential แล้ว แต่ตรวจสอบการเชื่อมต่อ Meta API ไม่ผ่าน'))
        return
      }

      const datePresetParam = metaDatePresetForUi(datePreset)
      const result = await apiJson<MetaWorkspaceResponse>(`/api/meta/workspace?datePreset=${encodeURIComponent(datePresetParam)}`)
      if (!isLatestRequest()) return

      const nextMetaInfo: MetaInfo = {
        accountName: result.meta.account?.name || 'บัญชีโฆษณา Meta',
        adAccountId: status.adAccountId ?? result.meta.account?.account_id ?? null,
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
      setDataState(nextDataState)
      setSyncState(nextSyncState)
      setApiMessage(nextApiMessage)
      if (source !== 'auto') {
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
    }
  }, [appendAudit, datePreset])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshWorkspace('auto')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshWorkspace])

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
        if (conditions.reduceMotion) return undefined

        const ctx = gsap.context(() => {
          const timeline = gsap.timeline({ defaults: { duration: 0.52, ease: 'power3.out' } })
          timeline
            .from('.sidebar', { x: conditions.isDesktop ? -18 : 0, y: conditions.isDesktop ? 0 : -10, autoAlpha: 0 })
            .from('.topbar', { y: -16, autoAlpha: 0 }, '<0.08')
            .from('.data-source-bar, .metric-card, .panel', { y: 16, autoAlpha: 0, stagger: { amount: 0.34 } }, '<0.12')

          gsap.to('.sidebar-mascot', {
            y: conditions.isDesktop ? -8 : -4,
            rotation: conditions.isDesktop ? 2 : 1,
            duration: 3.2,
            ease: 'sine.inOut',
            repeat: -1,
            yoyo: true,
          })
        }, root)

        return () => ctx.revert()
      },
    )

    return () => media.revert()
  }, [])

  const syncWorkspace = () => {
    void refreshWorkspace('manual')
  }

  const rejectRecommendation = (id: string) => {
    const rec = activeRecommendations.find((item) => item.id === id)
    setRecommendationStates((current) => ({ ...current, [id]: 'Rejected' }))
    appendAudit({
      action: 'ปฏิเสธคำแนะนำ',
      detail: rec?.title ?? 'ปฏิเสธคำแนะนำแล้ว',
      actor: 'ผู้ใช้งาน',
      tone: 'neutral',
    })
  }

  const approveRecommendation = (id: string) => {
    setConfirmingId(id)
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

    setRecommendationStates((current) => ({ ...current, [activeId]: 'Executed' }))
    appendAudit({
      action: rec?.execution ? 'เขียนข้อมูลไป Meta สำเร็จ' : 'รีวิวเสร็จแล้ว',
      detail: `${rec?.title ?? 'คำแนะนำ'} · ${rec?.execution ? 'ดำเนินการผ่าน Meta API จริง' : 'คำแนะนำนี้ไม่มี endpoint สำหรับเขียนข้อมูล'}`,
      actor: 'ผู้ใช้งาน',
      tone: 'good',
    })
    setConfirmingId(null)
    setExecutingRecommendationId(null)
  }

  return (
    <div className="app-shell" ref={shellRef}>
      <Sidebar activeTab={activeTab} accountName={metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อ Meta'} automationMode={automationMode} dataState={dataState} onSelect={setActiveTab} syncState={syncState} />
      <main className="app-main">
        <Topbar
          activePage={activePage}
          automationMode={automationMode}
          datePreset={datePreset}
          onDateChange={setDatePreset}
          onModeChange={setAutomationMode}
          onPrepareReport={() => {
            setPreparedReport(true)
            setActiveTab('reports')
            appendAudit({
              action: 'เตรียมรายงานแล้ว',
              detail: `สรุปช่วง ${datePreset} พร้อมสำหรับรีวิว`,
              actor: 'ผู้ใช้งาน',
              tone: 'info',
            })
          }}
          onSync={syncWorkspace}
          syncState={syncState}
        />
        {dataState === 'live' ? null : <DataSourceBar dataState={dataState} message={apiMessage} metaInfo={metaInfo} onRetry={syncWorkspace} />}
        <div className="page-body">
          {activeTab === 'analytics' && (
            <AnalyticsPage
              auditTrail={activeAuditTrail}
              campaigns={filteredCampaigns}
              funnelMetrics={funnelMetrics}
              onApprove={approveRecommendation}
              onReject={rejectRecommendation}
              onSelectCampaign={setSelectedCampaignId}
              recommendations={activeRecommendations}
              recommendationStates={recommendationStates}
              searchQuery={searchQuery}
              selectedCampaignId={visibleSelectedCampaign?.id ?? ''}
              setSearchQuery={setSearchQuery}
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
              ads={workspace?.adInsights ?? []}
              auditTrail={activeAuditTrail}
              onApprove={approveRecommendation}
              onReject={rejectRecommendation}
              recommendations={activeRecommendations}
              recommendationStates={recommendationStates}
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
              onModeChange={setAutomationMode}
              onMutationComplete={() => refreshWorkspace('execution')}
              trendData={workspace?.trendData ?? []}
            />
          )}
          {activeTab === 'creative' && <CreativeStudioPage components={workspace?.insightComponents ?? []} />}
          {activeTab === 'audience' && <AudienceInsightsPage adSets={workspace?.adSets ?? []} />}
          {activeTab === 'library' && <AdLibraryPage reviews={workspace?.complianceReviews ?? []} />}
          {activeTab === 'reports' && (
            <ReportsPage
              auditTrail={activeAuditTrail}
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
          {activeTab === 'help' && <HelpCenterPage dataState={dataState} onOpenSettings={() => setActiveTab('settings')} onSync={syncWorkspace} syncState={syncState} />}
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
    </div>
  )
}

type SidebarProps = {
  activeTab: TabId
  accountName: string
  automationMode: string
  dataState: DataSourceState
  onSelect: (tab: TabId) => void
  syncState: string
}

function Sidebar({ activeTab, accountName, automationMode, dataState, onSelect, syncState }: SidebarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const statusTone: Tone = dataState === 'live' ? 'good' : dataState === 'error' ? 'critical' : dataState === 'loading' ? 'info' : 'watch'
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
  const selectTab = (tab: TabId) => {
    onSelect(tab)
    setIsMenuOpen(false)
  }

  return (
    <aside className={`sidebar ${isMenuOpen ? 'menu-open' : ''}`}>
      <div className="sidebar-header">
        <button className="brand" type="button" onClick={() => selectTab('analytics')} aria-label="เปิดหน้าวิเคราะห์">
          <span className="brand-logo-wrap">
            <img src="/promedclinicpmc-logo.png" alt="" />
          </span>
          <span>
            <strong>PMC Ads Agent</strong>
            <small>ศูนย์ควบคุมสื่อคลินิก</small>
          </span>
        </button>
        <button
          className="mobile-nav-toggle"
          type="button"
          aria-controls="dashboard-navigation"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
          onClick={() => setIsMenuOpen((value) => !value)}
        >
          {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
          <span>เมนู</span>
        </button>
      </div>

      <nav className="nav-groups" id="dashboard-navigation" aria-label="หน้าแดชบอร์ด">
        {(['Main', 'Creative', 'System'] as const).map((group) => (
          <div className="nav-group" key={group}>
            <span className="nav-group-title">{navGroupLabel(group)}</span>
            {navItems
              .filter((item) => item.group === group)
              .map((item) => {
                const Icon = item.icon
                const isActive = item.id === activeTab
                return (
                  <button className={`nav-item ${isActive ? 'active' : ''}`} key={item.id} type="button" onClick={() => selectTab(item.id)}>
                    <span className="nav-icon">
                      <Icon size={16} />
                    </span>
                    <span>{item.label}</span>
                  </button>
                )
              })}
          </div>
        ))}
      </nav>

      <div className="sidebar-card">
        <img className="sidebar-mascot" src="/pmc-ai-mascot.png" alt="" />
        <StatusBadge label={syncStateLabel(syncState)} tone={statusTone} />
        <strong>บัญชีโฆษณา: {accountName}</strong>
        <span>ความสดข้อมูล: {freshnessLabel}</span>
        <span>โหมด: {automationMode}</span>
      </div>
    </aside>
  )
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
  automationMode: string
  datePreset: string
  onDateChange: (value: string) => void
  onModeChange: (value: string) => void
  onPrepareReport: () => void
  onSync: () => void
  syncState: string
}

function Topbar({ activePage, automationMode, datePreset, onDateChange, onModeChange, onPrepareReport, onSync, syncState }: TopbarProps) {
  return (
    <header className="topbar">
      <div>
        <h1>{activePage.id === 'analytics' ? 'แดชบอร์ดวิเคราะห์' : activePage.label}</h1>
        <p>{activePage.description}</p>
      </div>
      <div className="topbar-actions">
        <PillButton icon={Database} label="Promed Clinic PMC" />
        <select aria-label="ช่วงวันที่" value={datePreset} onChange={(event) => onDateChange(event.target.value)}>
          {datePresetOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <button className="pill-button good" type="button" onClick={onSync}>
          <RefreshCw size={15} />
          {syncStateLabel(syncState)}
        </button>
        <select aria-label="โหมด automation" value={automationMode} onChange={(event) => onModeChange(event.target.value)}>
          {automationModeOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <button className="pill-button blue" type="button" onClick={onPrepareReport}>
          <FileText size={15} />
          เตรียมรายงาน
        </button>
      </div>
    </header>
  )
}

function AnalyticsPage({
  auditTrail,
  campaigns,
  funnelMetrics,
  onApprove,
  onReject,
  onSelectCampaign,
  recommendations,
  recommendationStates,
  searchQuery,
  selectedCampaignId,
  setSearchQuery,
  summary,
  trendData,
}: {
  auditTrail: AuditEvent[]
  campaigns: Campaign[]
  funnelMetrics: MetaFunnelMetric[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onSelectCampaign: (id: string) => void
  recommendations: Recommendation[]
  recommendationStates: Record<string, ActionState>
  searchQuery: string
  selectedCampaignId: string
  setSearchQuery: (value: string) => void
  summary: Summary
  trendData: TrendDatum[]
}) {
  const kpis = [
    { label: 'ค่าโฆษณา', value: fmtMoneyShort(summary.spend), trend: 'ยอดใช้จ่าย Meta', tone: summary.spend > 0 ? ('info' as Tone) : ('neutral' as Tone) },
    { label: 'รายได้', value: fmtMoneyShort(summary.revenue), trend: 'รายได้ที่ track ได้', tone: summary.revenue > 0 ? ('good' as Tone) : ('neutral' as Tone) },
    { label: 'ROAS', value: `${summary.roas.toFixed(1)}x`, trend: 'รายได้ / ค่าโฆษณา', tone: summary.roas >= 2 ? ('good' as Tone) : summary.roas > 0 ? ('watch' as Tone) : ('neutral' as Tone) },
    { label: 'CPA / Booking', value: fmtMoney(summary.cpa), trend: 'ค่าโฆษณา / booking', tone: summary.cpa > 0 ? ('watch' as Tone) : ('neutral' as Tone) },
    { label: 'Lead', value: fmtNum(summary.leads), trend: 'Lead จาก Meta', tone: summary.leads > 0 ? ('info' as Tone) : ('neutral' as Tone) },
    { label: 'Booking', value: fmtNum(summary.bookings), trend: 'Booking ที่ track ได้', tone: summary.bookings > 0 ? ('good' as Tone) : ('neutral' as Tone) },
    { label: 'เคสชำระเงิน', value: fmtNum(summary.paidTreatments), trend: 'ผลลัพธ์จากคลินิก', tone: summary.paidTreatments > 0 ? ('good' as Tone) : ('neutral' as Tone) },
    { label: 'CAC', value: fmtMoney(summary.cac), trend: 'ค่าโฆษณา / เคสจ่ายจริง', tone: summary.cac > 0 ? ('watch' as Tone) : ('neutral' as Tone) },
  ]
  const [kpisCollapsed, setKpisCollapsed] = useState(false)
  const kpiContentId = useId()

  return (
    <div className="analytics-layout">
      <section className="main-stack">
        <section className="data-strip">
          <div className="data-strip-head">
            <div>
              <h2>ภาพรวม KPI</h2>
              <p>ค่าโฆษณา รายได้ และผลลัพธ์จากคลินิก</p>
            </div>
            <CollapseButton
              collapsed={kpisCollapsed}
              controlsId={kpiContentId}
              label="ภาพรวม KPI"
              onToggle={() => setKpisCollapsed((value) => !value)}
            />
          </div>
          <div id={kpiContentId} role="region" aria-label="ภาพรวม KPI">
            {kpisCollapsed ? (
              <CollapsedPlaceholder title="ภาพรวม KPI" />
            ) : (
              <div className="kpi-grid">
                {kpis.map((kpi) => (
                  <MetricCard key={kpi.label} {...kpi} />
                ))}
              </div>
            )}
          </div>
        </section>
        <div className="split-grid">
          <ClinicFunnel funnelMetrics={funnelMetrics} summary={summary} />
          <PerformanceTrend trendData={trendData} />
        </div>
        <CampaignTable
          campaigns={campaigns}
          onSelectCampaign={onSelectCampaign}
          searchQuery={searchQuery}
          selectedCampaignId={selectedCampaignId}
          setSearchQuery={setSearchQuery}
        />
      </section>
      <aside className="right-rail">
        <AiQueue onApprove={onApprove} onReject={onReject} recommendations={recommendations} recommendationStates={recommendationStates} />
        <AuditPanel auditTrail={auditTrail} compact />
      </aside>
    </div>
  )
}

function MetricCard({ label, value, trend, tone }: { label: string; value: string; trend: string; tone: Tone }) {
  return (
    <article className="metric-card">
      <span className={`metric-dot ${tone}`} />
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small className={tone}>{trend}</small>
    </article>
  )
}

function ClinicFunnel({ funnelMetrics, summary }: { funnelMetrics: MetaFunnelMetric[]; summary: Summary }) {
  const stages = funnelMetrics.map((metric, index) => ({
    label: metric.stage,
    value: fmtNum(metric.count),
    width: index === 0 ? 100 : Math.max(8, Math.min(100, metric.conversionRate)),
    tone: metric.conversionRate < 5 && index > 0 ? ('critical' as Tone) : metric.conversionRate < 25 && index > 0 ? ('watch' as Tone) : index === 1 ? ('violet' as Tone) : ('good' as Tone),
  }))

  return (
    <SectionCard collapsible title="Funnel คลินิก" subtitle="จาก impression ถึงเคสชำระเงิน พร้อมจุดหลุดในแต่ละขั้น">
      {stages.length > 0 ? (
        <>
          <div className="funnel-list">
            {stages.map((stage) => (
              <div className="funnel-row" key={stage.label}>
                <strong>{stage.label}</strong>
                <span className="funnel-track">
                  <span className={`funnel-fill ${stage.tone}`} style={{ width: `${stage.width}%` }} />
                </span>
                <span>{stage.value}</span>
              </div>
            ))}
          </div>
          <StatusBadge label={`${stages.length} ขั้นตอนจากข้อมูลจริง`} tone={summary.bookings > 0 ? 'good' : 'neutral'} />
        </>
      ) : (
        <EmptyState title="ยังไม่มีข้อมูล funnel" detail="Meta API ยังไม่ส่ง metric ของ funnel ในช่วงวันที่นี้" />
      )}
    </SectionCard>
  )
}

function PerformanceTrend({ trendData }: { trendData: TrendDatum[] }) {
  return (
    <SectionCard
      collapsible
      action={
        <>
          <StatusBadge label="รายได้" tone="violet" />
          <StatusBadge label="ค่าโฆษณา" tone="info" />
        </>
      }
      title="แนวโน้มผลงาน"
      subtitle="ค่าโฆษณาและรายได้รายวัน"
    >
      {trendData.length > 0 ? (
        <div className="chart-box">
          <ResponsiveContainer height={238} width="100%">
            <ComposedChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#e7edf5" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#667085' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ border: '1px solid #e1e7f0', borderRadius: 8 }} />
              <Bar dataKey="spend" fill="#cfe4ff" radius={[6, 6, 0, 0]} />
              <Area type="monotone" dataKey="revenue" stroke="#7567d8" fill="rgba(117, 103, 216, 0.12)" strokeWidth={3} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState title="ยังไม่มีข้อมูลแนวโน้ม" detail="Meta API ยังไม่มีค่าโฆษณาหรือรายได้รายวันในช่วงวันที่นี้" />
      )}
    </SectionCard>
  )
}

function CampaignTable({
  campaigns,
  onSelectCampaign,
  searchQuery,
  selectedCampaignId,
  setSearchQuery,
}: {
  campaigns: Campaign[]
  onSelectCampaign: (id: string) => void
  searchQuery: string
  selectedCampaignId: string
  setSearchQuery: (value: string) => void
}) {
  return (
    <SectionCard
      action={
        <div className="table-tools">
          <label className="search-box">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="ค้นหาแคมเปญ" />
          </label>
          <StatusBadge label="เฉพาะที่เปิดอยู่" tone="neutral" />
        </div>
      }
      className="table-panel"
      collapsible
      headClassName="table-head"
      title="ผลงานแคมเปญ"
      subtitle="สถานะ ค่าใช้จ่าย CPA, ROAS, frequency และความเสี่ยงจาก AI"
    >
      <div className="campaign-table-wrap">
        <div className="campaign-table" role="table" aria-label="ผลงานแคมเปญ">
          <div className="campaign-row header" role="row">
            <span>แคมเปญ / ชุดโฆษณา</span>
            <span>สถานะ</span>
            <span>งบประมาณ</span>
            <span>ใช้จ่าย</span>
            <span>CPA</span>
            <span>ROAS</span>
            <span>Freq.</span>
            <span>AI</span>
          </div>
          {campaigns.length > 0 ? (
            campaigns.map((campaign) => (
              <button
                className={`campaign-row ${campaign.id === selectedCampaignId ? 'selected' : ''}`}
                key={campaign.id}
                type="button"
                onClick={() => onSelectCampaign(campaign.id)}
              >
                <span>
                  <strong>{campaign.name}</strong>
                  <small>ซิงก์จาก Meta API · CTR {campaign.ctr}% · Conversion {fmtNum(campaign.conversions)}</small>
                </span>
                <StatusBadge label={campaignStatusLabel(campaign.status)} tone={campaign.tone} />
                <span>{fmtMoney(campaign.budget)}</span>
                <span>{fmtMoney(campaign.spend)}</span>
                <span>{fmtMoney(campaign.cpa)}</span>
                <span>{campaign.roas.toFixed(1)}x</span>
                <span>{campaign.frequency.toFixed(1)}</span>
                <StatusBadge label={aiTagLabel(campaign.aiTag)} tone={campaign.tone} />
              </button>
            ))
          ) : (
            <EmptyState title="ไม่พบแคมเปญ" detail="ล้างคำค้นหาหรือเปลี่ยนช่วงวันที่เพื่อรีวิวการส่งโฆษณา" />
          )}
        </div>
      </div>
    </SectionCard>
  )
}

function AiQueue({
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
  return (
    <SectionCard
      action={<StatusBadge label="แนะนำเท่านั้น" tone="violet" />}
      className="ai-queue"
      collapsible
      title="คิวคำแนะนำจาก Meta metrics"
      subtitle="รายการนี้คำนวณจากข้อมูล Meta จริง และต้องรีวิวก่อนเขียนข้อมูล"
    >
      <div className="recommendation-list">
        {recommendations.length > 0 ? recommendations.map((rec, index) => {
          const state = recommendationStates[rec.id] ?? 'Suggested'
          const isFinal = state === 'Executed' || state === 'Rejected' || state === 'Failed'
          const isExecuting = state === 'Executing'

          return (
            <article className={`recommendation-card ${index === 0 ? 'primary' : ''}`} key={rec.id}>
              <div className="recommendation-badges">
                <StatusBadge label={actionStateLabel(state)} tone={state === 'Rejected' || state === 'Failed' ? 'critical' : state === 'Executed' ? 'good' : 'watch'} />
                <StatusBadge label={riskLabel(rec.risk)} tone={toneForRisk(rec.risk)} />
              </div>
              <h3>{rec.title}</h3>
              <p>{rec.evidence}</p>
              <strong>ข้อกำกับ: {rec.guardrail}</strong>
              {index === 0 ? <p>{rec.impact}</p> : null}
              <div className="recommendation-actions">
                {isFinal ? (
                  <StatusBadge label={actionStateLabel(state)} tone={state === 'Executed' ? 'good' : 'critical'} />
                ) : (
                  <>
                    <button className="danger-button" type="button" onClick={() => onApprove(rec.id)} disabled={isExecuting}>
                      {isExecuting ? 'กำลังดำเนินการ...' : rec.risk === 'High' ? 'รีวิวก่อนพัก' : 'รีวิว'}
                    </button>
                    <button className="outline-button" type="button" onClick={() => onReject(rec.id)} disabled={isExecuting}>
                      ปฏิเสธ
                    </button>
                  </>
                )}
              </div>
            </article>
          )
        }) : (
          <EmptyState title="ยังไม่มีคำแนะนำจากข้อมูลจริง" detail="Meta API ยังไม่มีรายการที่เข้าเงื่อนไข guardrail ในช่วงวันที่นี้" />
        )}
      </div>
    </SectionCard>
  )
}

function AuditPanel({ auditTrail, compact = false }: { auditTrail: AuditEvent[]; compact?: boolean }) {
  return (
    <SectionCard
      className={`audit-panel ${compact ? 'compact' : ''}`}
      collapsible
      title="Audit Trail ล่าสุด"
      subtitle="การอนุมัติ เหตุการณ์ซิงก์ และผลการดำเนินการ"
    >
      <div className="audit-list">
        {auditTrail.length > 0 ? (
          auditTrail.map((event) => (
            <div className="audit-row" key={event.id}>
              <StatusBadge label={auditActionLabel(event.action)} tone={event.tone} />
              <strong>{event.detail}</strong>
              <span>{actorLabel(event.actor)} · {event.time}</span>
            </div>
          ))
        ) : (
          <EmptyState title="ยังไม่มี audit event" detail="เหตุการณ์ซิงก์และการเขียนข้อมูลไป Meta จะแสดงที่นี่หลังเกิดรายการ" />
        )}
      </div>
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
      <SectionCard collapsible title="ตัวจัดการโฆษณา" subtitle="ควบคุม Campaign, Ad set และ Ad ที่ซิงก์จาก Meta">
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
  ads,
  auditTrail,
  onApprove,
  onReject,
  recommendations,
  recommendationStates,
}: {
  ads: WorkspaceData['adInsights']
  auditTrail: AuditEvent[]
  onApprove: (id: string) => void
  onReject: (id: string) => void
  recommendations: Recommendation[]
  recommendationStates: Record<string, ActionState>
}) {
  const scoredAds = useMemo(() => ads.filter((ad) => ad.spend > 0 || ad.impressions > 0), [ads])
  const topAds = useMemo(
    () =>
      scoredAds
        .slice()
        .sort((a, b) => b.score - a.score || b.roas - a.roas || b.bookings - a.bookings || b.spend - a.spend)
        .filter((ad) => ad.score >= 6 || ad.roas >= 1.5 || ad.bookings > 0)
        .slice(0, 5),
    [scoredAds],
  )
  const topAdIds = useMemo(() => new Set(topAds.map((ad) => ad.id)), [topAds])
  const weakAds = useMemo(
    () =>
      scoredAds
        .filter((ad) => !topAdIds.has(ad.id))
        .slice()
        .sort((a, b) => a.score - b.score || a.roas - b.roas || b.spend - a.spend)
        .filter((ad) => ad.score < 6 || (ad.bookings === 0 && ad.spend > 0) || ad.roas < 1)
        .slice(0, 5),
    [scoredAds, topAdIds],
  )

  return (
    <TwoColumnPage aside={<AuditPanel auditTrail={auditTrail} />}>
      <SectionCard collapsible title="สัญญาณโฆษณาจาก Meta metrics" subtitle="โฆษณาที่ดีและแย่จาก spend, ROAS, CTR และ conversion ที่ Meta ส่งมา">
        <div className="ai-ad-signal-grid">
          <AiAdSignalColumn
            ads={topAds}
            emptyDetail="Meta API ยังไม่มีโฆษณาที่มี insight พอให้จัดอันดับฝั่งดี"
            title="โฆษณาที่ดี"
            tone="good"
            type="good"
          />
          <AiAdSignalColumn
            ads={weakAds}
            emptyDetail="Meta API ยังไม่มีโฆษณาที่มี insight พอให้จัดอันดับฝั่งแย่"
            title="โฆษณาที่แย่"
            tone="critical"
            type="bad"
          />
        </div>
      </SectionCard>
      <AiQueue onApprove={onApprove} onReject={onReject} recommendations={recommendations} recommendationStates={recommendationStates} />
    </TwoColumnPage>
  )
}

function AiAdSignalColumn({
  ads,
  emptyDetail,
  title,
  tone,
  type,
}: {
  ads: WorkspaceData['adInsights']
  emptyDetail: string
  title: string
  tone: Tone
  type: 'good' | 'bad'
}) {
  return (
    <div className={`ai-ad-column ${type}`}>
      <div className="ai-ad-column-head">
        <StatusBadge label={title} tone={tone} />
        <span>{ads.length} โฆษณา</span>
      </div>
      <div className="ai-ad-list">
        {ads.length > 0 ? (
          ads.map((ad) => <AiAdSignalCard ad={ad} key={`${type}-${ad.id}`} type={type} />)
        ) : (
          <EmptyState title="ยังไม่มีสัญญาณจากข้อมูลจริง" detail={emptyDetail} />
        )}
      </div>
    </div>
  )
}

function AiAdSignalCard({ ad, type }: { ad: WorkspaceData['adInsights'][number]; type: 'good' | 'bad' }) {
  const isGood = type === 'good'
  const cpa = ad.bookings > 0 ? ad.spend / ad.bookings : 0
  const reason = isGood
    ? ad.score >= 7
      ? 'คะแนน metric สูงจาก ROAS, CTR และ conversion signal'
      : ad.roas >= 1.5
        ? 'ROAS ดีกว่ากลุ่ม watch เหมาะกับการเฝ้าดูเพื่อ scale'
        : 'มี engagement signal ดีกว่าโฆษณาส่วนใหญ่ในชุดข้อมูล'
    : ad.bookings === 0 && ad.spend > 0
      ? 'มี spend แต่ยังไม่มี tracked booking/conversion'
      : ad.roas > 0 && ad.roas < 1
        ? 'ROAS ต่ำกว่า guardrail ต้องตรวจ offer หรือ creative'
        : 'คะแนน metric ต่ำกว่ากลุ่มอื่น ควรตรวจ creative, audience และ tracking'
  const nextAction = isGood
    ? 'คงไว้ / ทดสอบ scale แบบค่อยเป็นค่อยไป'
    : ad.bookings === 0
      ? 'ตรวจ tracking ก่อนเพิ่มงบ'
      : 'รีเฟรชครีเอทีฟหรือลดการแสดงผล'

  return (
    <article className="ai-ad-card">
      <div className="ai-ad-card-head">
        <StatusBadge label={`Metric score ${ad.score.toFixed(1)}`} tone={isGood ? 'good' : 'critical'} />
        <StatusBadge label={deliveryLabel(ad.status)} tone={deliveryTone(ad.status)} />
      </div>
      <h3>{ad.name}</h3>
      <p>{ad.creative}</p>
      <div className="ai-ad-metrics">
        <MetricLine label="ใช้จ่าย" value={fmtMoney(ad.spend)} />
        <MetricLine label="ROAS" value={`${ad.roas.toFixed(2)}x`} />
        <MetricLine label="CTR" value={`${ad.ctr.toFixed(2)}%`} />
        <MetricLine label="Booking" value={fmtNum(ad.bookings)} />
        <MetricLine label="CPA" value={ad.bookings > 0 ? fmtMoney(cpa) : 'ยังไม่มี booking'} />
      </div>
      <strong>{reason}</strong>
      <span>{nextAction}</span>
    </article>
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
  if (mode === 'พัก automation') return 'critical'
  if (mode === 'ต้องอนุมัติก่อน') return 'good'
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
}) {
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [pendingPlan, setPendingPlan] = useState<AutoAdPlan | null>(null)
  const [isExecutingPlan, setIsExecutingPlan] = useState(false)
  const [message, setMessage] = useState('')
  const [optimizerStrategy, setOptimizerStrategy] = useState<OptimizerStrategy>('all')
  const [pendingOptimizerBatch, setPendingOptimizerBatch] = useState<OptimizerBatch | null>(null)
  const [isExecutingOptimizerBatch, setIsExecutingOptimizerBatch] = useState(false)
  const [ruleSearch, setRuleSearch] = useState('')
  const [ruleStatusFilter, setRuleStatusFilter] = useState('all')
  const [ruleTypeFilter, setRuleTypeFilter] = useState('all')
  const [ruleOverrides, setRuleOverrides] = useState<Record<string, boolean>>({})
  const [customRules, setCustomRules] = useState<OptimizerRule[]>(() => readOptimizerCustomRules())
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false)
  const [ruleRun, setRuleRun] = useState<OptimizerRuleRun | null>(null)
  const [ruleRunStates, setRuleRunStates] = useState<Record<string, OptimizerRuleRunState>>({})
  const [isExecutingRule, setIsExecutingRule] = useState(false)
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [isRulesPanelHighlighted, setIsRulesPanelHighlighted] = useState(false)
  const rulesPanelRef = useRef<HTMLElement | null>(null)
  const automationPaused = automationMode === 'พัก automation'
  const approvalMode = automationMode === 'ต้องอนุมัติก่อน'

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
  const pausePlans = plans.filter((plan) => plan.decision === 'pause')
  const keepPlans = plans.filter((plan) => plan.decision === 'keep')
  const activatePlans = plans.filter((plan) => plan.decision === 'activate')
  const watchPlans = plans.filter((plan) => plan.decision === 'watch')
  const allRecommendationPlans = [...activatePlans, ...keepPlans, ...pausePlans, ...watchPlans]
  const optimizerPlans = allRecommendationPlans.filter((plan) => optimizerStrategy === 'all' || plan.decision === optimizerStrategy)
  const selectedPlan = optimizerPlans.find((plan) => plan.id === selectedPlanId) ?? plans.find((plan) => plan.id === selectedPlanId) ?? optimizerPlans[0] ?? plans[0]
  const recommendationPlans = showAllRecommendations ? optimizerPlans : optimizerPlans.slice(0, 3)
  const optimizerWritablePlans = optimizerPlans.filter(isOptimizerPlanWritable)
  const optimizerSpend = optimizerPlans.reduce((sum, plan) => sum + plan.ad.spend, 0)
  const optimizerRevenue = optimizerPlans.reduce((sum, plan) => sum + plan.ad.spend * plan.ad.roas, 0)
  const optimizerRoas = optimizerSpend > 0 ? optimizerRevenue / optimizerSpend : 0
  const optimizerBookings = optimizerPlans.reduce((sum, plan) => sum + plan.ad.bookings, 0)
  const optimizerButtonClass = approvalMode && optimizerWritablePlans.some((plan) => plan.targetStatus === 'PAUSED') ? 'danger-button' : approvalMode && optimizerWritablePlans.length > 0 ? 'primary-button' : 'outline-button'
  const optimizerButtonLabel = automationPaused ? 'พักอยู่' : approvalMode && optimizerWritablePlans.length > 0 ? `Optimize จริง ${optimizerWritablePlans.length} รายการ` : 'ตรวจระบบ Optimizer'
  const optimizerStrategyCards: Array<{ count: number; strategy: OptimizerStrategy; tone: Tone }> = [
    { count: allRecommendationPlans.length, strategy: 'all', tone: 'info' },
    { count: activatePlans.length, strategy: 'activate', tone: 'good' },
    { count: keepPlans.length, strategy: 'keep', tone: 'good' },
    { count: pausePlans.length, strategy: 'pause', tone: 'critical' },
    { count: watchPlans.length, strategy: 'watch', tone: 'watch' },
  ]
  const baseRules = useMemo(() => buildOptimizerRules(plans), [plans])
  const rules = useMemo(() => [...customRules, ...baseRules], [baseRules, customRules])
  const displayRules = useMemo(
    () =>
      rules.map((rule) => {
        const state = ruleRunStates[rule.id]
        return state ? { ...rule, lastRun: state.lastRun, runCount: state.runCount } : rule
      }),
    [ruleRunStates, rules],
  )
  const activeRules = displayRules.filter((rule) => ruleOverrides[rule.id] ?? rule.defaultEnabled)
  const pausedRules = displayRules.length - activeRules.length
  const actionablePlans = plans.filter((plan) => plan.targetStatus).length
  const inspectedSpend = ads.reduce((sum, ad) => sum + ad.spend, 0)
  const trendBookings = trendData.reduce((sum, point) => sum + point.bookings, 0)
  const insightRows = buildOptimizerInsights(plans, trendData)
  const chartPoints = buildOptimizerChart(trendData)
  const query = ruleSearch.trim().toLowerCase()
  const visibleRules = displayRules.filter((rule) => {
    const enabled = ruleOverrides[rule.id] ?? rule.defaultEnabled
    if (ruleStatusFilter === 'active' && !enabled) return false
    if (ruleStatusFilter === 'paused' && enabled) return false
    if (ruleTypeFilter !== 'all' && rule.type !== ruleTypeFilter) return false
    if (!query) return true
    return `${rule.title} ${rule.subtitle} ${rule.condition} ${rule.type}`.toLowerCase().includes(query)
  })

  const manageAllAutomations = () => {
    setRuleSearch('')
    setRuleStatusFilter('all')
    setRuleTypeFilter('all')
    setMessage('')
    setIsRulesPanelHighlighted(true)
    window.setTimeout(() => {
      rulesPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      rulesPanelRef.current?.focus({ preventScroll: true })
    }, 0)
    window.setTimeout(() => setIsRulesPanelHighlighted(false), 1800)
  }

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
      setMessage('Automation ถูกพักอยู่: Optimizer จะไม่เขียน Meta จนกว่าจะเปิดโหมดอีกครั้ง')
      return
    }
    if (!approvalMode) {
      setMessage(`โหมดแนะนำเท่านั้น: ตรวจพบ ${optimizerPlans.length} รายการจาก Meta จริง แต่ยังไม่เขียนข้อมูล`)
      return
    }
    if (!optimizerWritablePlans.length) {
      setMessage('กลยุทธ์นี้ยังไม่มีรายการที่ต้องเขียน Meta จริง ใช้เป็นรายการรีวิวเท่านั้น')
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
    if (plan.targetStatus) {
      if (automationPaused) {
        setMessage('Automation ถูกพักอยู่: เปลี่ยนโหมดเป็น "ต้องอนุมัติก่อน" ก่อนส่งคำสั่งไป Meta')
        return
      }
      if (!approvalMode) {
        setMessage(`โหมดแนะนำเท่านั้น: ${plan.label} จากข้อมูล Meta จริง แต่ยังไม่เปิดการเขียนข้อมูล`)
        return
      }
      setPendingPlan(plan)
      setMessage('')
      return
    }
    setMessage(`เลือกคำแนะนำ: ${plan.label}`)
  }

  const toggleRule = (rule: OptimizerRule) => {
    const current = ruleOverrides[rule.id] ?? rule.defaultEnabled
    setRuleOverrides((value) => ({ ...value, [rule.id]: !current }))
    setMessage(`${rule.title} ${current ? 'ถูกพักไว้' : 'เปิดใช้งานแล้ว'}`)
  }

  const createRule = (values: OptimizerRuleFormValues) => {
    const rule: OptimizerRule = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: values.title.trim(),
      subtitle: optimizerRuleSubtitle(values.type),
      type: values.type,
      condition: values.condition.trim(),
      lastRun: 'สร้างใหม่',
      runCount: 0,
      tone: optimizerRuleTone(values.type),
      defaultEnabled: values.enabled,
      affectedAds: Math.max(1, Math.round(values.affectedAds)),
    }
    setCustomRules((current) => {
      const next = [rule, ...current]
      writeOptimizerCustomRules(next)
      return next
    })
    setRuleOverrides((current) => ({ ...current, [rule.id]: values.enabled }))
    setRuleSearch('')
    setRuleStatusFilter('all')
    setRuleTypeFilter('all')
    setIsRuleModalOpen(false)
    setMessage(`สร้างกฎใหม่แล้ว: ${rule.title}`)
  }

  const markRuleRun = (rule: OptimizerRule, candidates: OptimizerRuleCandidate[]) => {
    setRuleRunStates((current) => ({
      ...current,
      [rule.id]: {
        lastRun: 'เพิ่งรัน',
        matchedCount: candidates.length,
        runCount: (current[rule.id]?.runCount ?? rule.runCount) + 1,
      },
    }))
  }

  const openRuleRun = (rule: OptimizerRule) => {
    const enabled = ruleOverrides[rule.id] ?? rule.defaultEnabled
    if (!enabled) {
      setMessage(`เปิดใช้งานกฎ "${rule.title}" ก่อนรัน`)
      return
    }
    if (automationPaused) {
      setMessage('Automation ถูกพักอยู่: กฎจะไม่รันหรือเขียนข้อมูลจนกว่าจะเปิดโหมดอีกครั้ง')
      return
    }
    const candidates = buildOptimizerRuleCandidates(rule, plans)
    setRuleRun({
      candidates,
      generatedAt: new Date().toISOString(),
      rule,
      writeEnabled: approvalMode,
    })
    setMessage('')
  }

  const recordRuleRun = () => {
    if (!ruleRun) return
    markRuleRun(ruleRun.rule, ruleRun.candidates)
    setMessage(`รันกฎแล้ว: ${ruleRun.rule.title} พบ ${ruleRun.candidates.length} รายการ`)
    setRuleRun(null)
  }

  const executeRuleRun = async () => {
    if (!ruleRun || isExecutingRule) return
    if (!ruleRun.writeEnabled) {
      recordRuleRun()
      return
    }
    const writableCandidates = optimizerRuleWritableCandidates(ruleRun.candidates)
    if (writableCandidates.length === 0) {
      recordRuleRun()
      return
    }

    setIsExecutingRule(true)
    setMessage('')
    try {
      for (const chunk of chunkArray(writableCandidates, 25)) {
        await apiJson('/api/meta/bulk-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            actions: chunk.map((candidate) => ({
              objectType: 'ad',
              objectId: candidate.ad.id,
              status: candidate.targetStatus,
            })),
          }),
        })
      }
      await onMutationComplete()
      markRuleRun(ruleRun.rule, writableCandidates)
      setMessage(`รันกฎและอัปเดต Meta แล้ว ${writableCandidates.length} รายการ: ${ruleRun.rule.title}`)
      setRuleRun(null)
    } catch (error) {
      setMessage(error instanceof Error ? formatApiMessage(error.message) : 'รันกฎไป Meta ไม่สำเร็จ')
    } finally {
      setIsExecutingRule(false)
    }
  }

  const executePlan = async () => {
    if (!pendingPlan?.targetStatus || isExecutingPlan) return
    if (automationMode !== 'ต้องอนุมัติก่อน') {
      setMessage('โหมดนี้ไม่อนุญาตให้เขียน Meta เปลี่ยนเป็น "ต้องอนุมัติก่อน" แล้วกดยืนยันอีกครั้ง')
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
    if (automationMode !== 'ต้องอนุมัติก่อน') {
      setMessage('โหมดนี้ไม่อนุญาตให้ Optimizer เขียน Meta เปลี่ยนเป็น "ต้องอนุมัติก่อน" แล้วรันอีกครั้ง')
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
      setMessage(`Optimizer อัปเดตสถานะจริงใน Meta แล้ว ${writablePlans.length} รายการ`)
      setPendingOptimizerBatch(null)
    } catch (error) {
      setMessage(error instanceof Error ? formatApiMessage(error.message) : 'Optimizer เขียนข้อมูลไป Meta ไม่สำเร็จ')
    } finally {
      setIsExecutingOptimizerBatch(false)
    }
  }

  return (
    <>
    <div className="optimizer-page">
      <div className="optimizer-hero-grid">
        <section className={`optimizer-panel optimizer-recommendations ${showAllRecommendations ? 'expanded' : ''}`}>
          <div className="optimizer-panel-head">
            <div>
              <h2>ระบบ Optimizer</h2>
              <p>คัดรายการจาก Meta metrics จริง และส่งคำสั่งผ่าน approval เท่านั้น</p>
            </div>
            <StatusBadge label={`${optimizerPlans.length}`} tone={optimizerStrategyTone(optimizerStrategy)} />
          </div>
          <div className="optimizer-control-panel">
            <div className="optimizer-control-main">
              <span>กลยุทธ์ที่กำลังตรวจ</span>
              <strong>{optimizerStrategyLabel(optimizerStrategy)}</strong>
              <small>{optimizerStrategyDetail(optimizerStrategy)}</small>
            </div>
            <div className="optimizer-control-kpis" aria-label="Optimizer metrics from Meta">
              <span>
                <small>เข้าเงื่อนไข</small>
                <strong>{fmtNum(optimizerPlans.length)}</strong>
              </span>
              <span>
                <small>พร้อมเขียน Meta</small>
                <strong>{fmtNum(optimizerWritablePlans.length)}</strong>
              </span>
              <span>
                <small>Spend ที่ตรวจ</small>
                <strong>{fmtMoneyShort(optimizerSpend)}</strong>
              </span>
              <span>
                <small>ROAS / Booking</small>
                <strong>{optimizerRoas > 0 ? `${optimizerRoas.toFixed(2)}x` : '0.00x'} · {fmtNum(optimizerBookings)}</strong>
              </span>
            </div>
            <div className="optimizer-strategy-tabs" role="tablist" aria-label="เลือกกลยุทธ์ Optimizer">
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
            <div className="optimizer-control-actions">
              <button className={optimizerButtonClass} type="button" onClick={startOptimizerBatch} disabled={automationPaused || optimizerPlans.length === 0}>
                {optimizerButtonLabel}
              </button>
              <button className="outline-button" type="button" onClick={manageAllAutomations}>
                จัดการกฎ
              </button>
            </div>
          </div>
          <div className="optimizer-recommendation-list">
            {recommendationPlans.length > 0 ? (
              recommendationPlans.map((plan) => (
                <article className={`optimizer-recommendation-row ${plan.tone} ${selectedPlan?.id === plan.id ? 'selected' : ''}`} key={plan.id}>
                  <div className="optimizer-icon-box">
                    <LineChart size={18} />
                  </div>
                  <div>
                    <strong>{optimizerRecommendationTitle(plan)}</strong>
                    <span>{plan.campaign?.name ?? plan.ad.name}</span>
                    <small>{optimizerImpactText(plan)}</small>
                  </div>
                  <button
                    className={approvalMode && plan.targetStatus === 'PAUSED' ? 'danger-button' : approvalMode && plan.targetStatus === 'ACTIVE' ? 'primary-button' : 'outline-button'}
                    type="button"
                    onClick={() => selectRecommendation(plan)}
                    disabled={automationPaused && Boolean(plan.targetStatus)}
                  >
                    {automationPaused && plan.targetStatus ? 'พักอยู่' : plan.targetStatus ? (approvalMode ? 'ใช้แนะนำ' : 'ดูคำแนะนำ') : 'ดูรายละเอียด'}
                  </button>
                </article>
              ))
            ) : (
              <EmptyState title="ยังไม่มีคำแนะนำ" detail="ยังไม่มี ads ที่เข้าเงื่อนไขจาก Meta metrics ในช่วงวันที่นี้" />
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

        <section className="optimizer-panel">
          <div className="optimizer-panel-head">
            <div>
              <h2>อินไซต์ประสิทธิภาพจริง</h2>
              <p>ข้อมูลจริงจาก Meta daily insights · {datePreset}</p>
            </div>
            <select aria-label="ช่วง insight" value={datePreset} onChange={(event) => onDateChange(event.target.value)}>
              {datePresetOptions.map((option) => (
                <option value={option} key={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          {insightRows.length > 0 ? (
            <div className="optimizer-insight-list">
              {insightRows.map((insight) => (
                <div className="optimizer-insight-row" key={insight.label}>
                  <div className={`optimizer-icon-box ${insight.tone}`}>
                    <LineChart size={18} />
                  </div>
                  <div>
                    <span>{insight.label}</span>
                    <strong>{insight.value}</strong>
                    <small>{insight.detail}</small>
                  </div>
                  <OptimizerSparkline unit={insight.unit} values={insight.values} tone={insight.tone} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="ไม่มี daily insight จาก Meta ในช่วงนี้"
              detail="เปลี่ยนช่วงวันที่หรือกดเชื่อมต่อ Meta API อีกครั้ง ระบบจะไม่เติมตัวเลข mockup แทนข้อมูลจริง"
            />
          )}
        </section>

        <section className="optimizer-panel">
          <div className="optimizer-panel-head">
            <div>
              <h2>Active Automations</h2>
              <p>เปิด/ปิด automation ที่ทำงานกับ ads จริง</p>
            </div>
            <StatusBadge label={`${activeRules.length} เปิดอยู่`} tone={automationPaused ? 'critical' : 'good'} />
          </div>
          <div className="optimizer-active-list">
            {displayRules.slice(0, 4).map((rule) => {
              const enabled = ruleOverrides[rule.id] ?? rule.defaultEnabled
              return (
                <article className="optimizer-active-row" key={rule.id}>
                  <div className={`optimizer-icon-box ${rule.tone}`}>
                    <Power size={18} />
                  </div>
                  <div>
                    <strong>{rule.title}</strong>
                    <span>{rule.condition}</span>
                  </div>
                  <button className={`optimizer-switch ${enabled ? 'on' : ''}`} type="button" onClick={() => toggleRule(rule)} aria-pressed={enabled}>
                    <span />
                  </button>
                </article>
              )
            })}
          </div>
          <button className="optimizer-link-button" type="button" onClick={manageAllAutomations}>
            จัดการ Automations ทั้งหมด
            <ChevronRight size={15} />
          </button>
        </section>
      </div>

      <div className="optimizer-lower-grid">
        <section className="optimizer-panel">
          <div className="optimizer-panel-head">
            <div>
              <h2>Automation Summary</h2>
              <p>กฎ automation และ metric จริงจาก Meta รอบปัจจุบัน</p>
            </div>
          </div>
          <div className="optimizer-summary-grid">
            <OptimizerSummaryTile label="กฎที่เปิดอยู่" value={`${activeRules.length}`} detail="Active rules" tone="good" />
            <OptimizerSummaryTile label="กฎที่พักไว้" value={`${pausedRules}`} detail="Paused rules" tone="watch" />
            <OptimizerSummaryTile label="รายการเข้าเกณฑ์" value={`${actionablePlans}`} detail="จาก Meta รอบนี้" tone="info" />
            <OptimizerSummaryTile label="Spend ที่ตรวจ" value={fmtMoneyShort(inspectedSpend)} detail={datePreset} tone={trendBookings > 0 ? 'good' : 'neutral'} />
          </div>
          <div className="optimizer-chart-panel">
            <div className="optimizer-chart-head">
              <strong>Booking ที่ Meta track ตามวัน</strong>
              <select aria-label="ช่วงกราฟ" value={datePreset} onChange={(event) => onDateChange(event.target.value)}>
                {datePresetOptions.map((option) => (
                  <option value={option} key={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {chartPoints.length > 0 ? (
              <OptimizerLineChart points={chartPoints} />
            ) : (
              <EmptyState
                title="ไม่มีข้อมูลรายวันสำหรับกราฟ"
                detail="กราฟนี้ใช้ time_increment=1 จาก Meta API เท่านั้น จึงไม่แสดงเส้นจำลองเมื่อ API ไม่ส่งข้อมูล"
              />
            )}
          </div>
        </section>

        <section
          aria-label="จัดการ Automation Rules ทั้งหมด"
          className={`optimizer-panel optimizer-rules-panel ${isRulesPanelHighlighted ? 'attention' : ''}`}
          ref={rulesPanelRef}
          tabIndex={-1}
        >
          <div className="optimizer-panel-head">
            <div>
              <h2>Automation Rules</h2>
              <p>{visibleRules.length} จาก {displayRules.length} กฎ</p>
            </div>
            <button className="primary-button" type="button" onClick={() => setIsRuleModalOpen(true)}>
              + สร้างกฎใหม่
            </button>
          </div>
          <div className="optimizer-rule-toolbar">
            <label className="search-box">
              <Search size={15} />
              <input value={ruleSearch} onChange={(event) => setRuleSearch(event.target.value)} placeholder="ค้นหากฎ..." />
            </label>
            <select aria-label="สถานะ rule" value={ruleStatusFilter} onChange={(event) => setRuleStatusFilter(event.target.value)}>
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
            <select aria-label="ประเภท rule" value={ruleTypeFilter} onChange={(event) => setRuleTypeFilter(event.target.value)}>
              <option value="all">All Types</option>
              <option value="Budget">Budget</option>
              <option value="Pause">Pause</option>
              <option value="Schedule">Schedule</option>
              <option value="Creative">Creative</option>
            </select>
          </div>
          <div className="optimizer-rule-table">
            <div className="optimizer-rule-row header">
              <span>กฎอัตโนมัติ</span>
              <span>ประเภท</span>
              <span>เงื่อนไข</span>
              <span>ทำงานล่าสุด</span>
              <span>สถานะ</span>
              <span>รันกฎ</span>
            </div>
            {visibleRules.length > 0 ? (
              visibleRules.map((rule) => {
                const enabled = ruleOverrides[rule.id] ?? rule.defaultEnabled
                const candidates = buildOptimizerRuleCandidates(rule, plans)
                const candidateCount = candidates.length
                const writableCount = optimizerRuleWritableCandidates(candidates).length
                const canRunRule = enabled && !automationPaused
                const canWriteRule = approvalMode && writableCount > 0
                return (
                  <article className="optimizer-rule-row" key={rule.id}>
                    <div className="optimizer-rule-name">
                      <span className={`optimizer-icon-box ${rule.tone}`}>
                        <Power size={16} />
                      </span>
                      <div>
                        <strong>{rule.title}</strong>
                        <small>{candidateCount} รายการเข้าเงื่อนไขจาก Meta</small>
                      </div>
                    </div>
                    <StatusBadge label={rule.type} tone={rule.tone} />
                    <span>{rule.condition}</span>
                    <span>
                      {rule.lastRun}
                      <small>{rule.runCount > 0 ? `บันทึกผล ${rule.runCount} ครั้ง` : 'ยังไม่มีประวัติรันจริง'} · พบ {candidateCount} รายการ</small>
                    </span>
                    <div className="optimizer-rule-actions">
                      <button className={`optimizer-switch ${enabled ? 'on' : ''}`} type="button" onClick={() => toggleRule(rule)} aria-label={`${enabled ? 'พัก' : 'เปิด'} ${rule.title}`} aria-pressed={enabled}>
                        <span />
                      </button>
                      <button className="outline-button" type="button" onClick={() => openRuleRun(rule)} disabled={!canRunRule}>
                        {automationPaused ? 'พักอยู่' : canWriteRule ? `รันจริง ${writableCount}` : 'ตรวจรายการ'}
                      </button>
                    </div>
                  </article>
                )
              })
            ) : (
              <EmptyState title="ไม่พบ rule" detail="ล้างตัวกรองหรือค้นหาด้วยชื่อกฎอัตโนมัติ" />
            )}
          </div>
          <div className="optimizer-pagination">
            <span>1-{Math.min(visibleRules.length, 5)} จาก {visibleRules.length} กฎ</span>
            <button type="button" disabled>{'<'}</button>
            <button type="button" className="active">1</button>
            <button type="button" disabled>{'>'}</button>
          </div>
        </section>
      </div>

      <section className="optimizer-selected-strip">
        <img src="/pmc-ai-mascot.png" alt="" />
        <div>
          <strong>{selectedPlan ? selectedPlan.label : 'AI Optimizer พร้อมทำงาน'}</strong>
          <span>{selectedPlan ? selectedPlan.reason : 'ข้อมูลจะแสดงหลังซิงก์ ads จาก Meta API'}</span>
        </div>
        <StatusBadge label={automationMode} tone={autoAdsModeTone(automationMode)} />
        <button className="outline-button" type="button" onClick={() => onModeChange(automationMode === 'พัก automation' ? 'แนะนำเท่านั้น' : 'พัก automation')}>
          {automationMode === 'พัก automation' ? 'เปิด Automation' : 'พัก Automation'}
        </button>
      </section>
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
    {isRuleModalOpen ? <OptimizerRuleCreateModal campaignCount={campaigns.length} onCancel={() => setIsRuleModalOpen(false)} onCreate={createRule} /> : null}
    {ruleRun ? <OptimizerRuleRunModal isExecuting={isExecutingRule} onCancel={() => setRuleRun(null)} onConfirm={executeRuleRun} onRecord={recordRuleRun} run={ruleRun} /> : null}
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
        <StatusBadge label="Meta write" tone={plan.targetStatus === 'PAUSED' ? 'critical' : 'good'} />
        <h2 id="optimizer-action-title">ใช้คำแนะนำนี้กับ Meta</h2>
        <p>ระบบจะเปลี่ยนสถานะระดับ Ad นี้ทันทีหลังยืนยัน ตรวจชื่อและเหตุผลก่อนดำเนินการ</p>
        <div className="confirm-grid">
          <MetricLine label="Ad" value={plan.ad.name} />
          <MetricLine label="Meta ID" value={shortMetaId(plan.ad.id)} />
          <MetricLine label="Action" value={actionLabel} />
          <MetricLine label="Spend / ROAS" value={`${fmtMoney(plan.ad.spend)} · ${plan.ad.roas.toFixed(2)}x`} />
          <MetricLine label="Booking" value={fmtNum(plan.ad.bookings)} />
          <MetricLine label="เหตุผล" value={plan.reason} />
          <MetricLine label="Rollback" value="เปิด/ปิดกลับได้จาก Ads Manager หลังซิงก์" />
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
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน Optimizer" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label="Meta write batch" tone={pauseCount > 0 ? 'critical' : 'good'} />
        <h2 id="optimizer-batch-title">ยืนยัน Optimizer Batch</h2>
        <p>ระบบจะส่งคำสั่งระดับ Ad ไป Meta Marketing API จริงตามรายการที่ผ่าน guardrail แล้วเท่านั้น</p>
        <div className="confirm-grid">
          <MetricLine label="กลยุทธ์" value={optimizerStrategyLabel(batch.strategy)} />
          <MetricLine label="รายการที่จะเขียน Meta" value={`${writablePlans.length} ads`} />
          <MetricLine label="ปิด Ad" value={`${pauseCount} รายการ`} />
          <MetricLine label="เปิด Ad" value={`${activateCount} รายการ`} />
          <MetricLine label="Spend ที่ตรวจ" value={fmtMoneyShort(checkedSpend)} />
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
              <span>{plan.campaign?.name ?? 'Meta campaign'} · {plan.reason}</span>
              <small>
                Spend {fmtMoney(plan.ad.spend)} · ROAS {plan.ad.roas.toFixed(2)}x · Booking {fmtNum(plan.ad.bookings)}
              </small>
            </article>
          ))}
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className={pauseCount > 0 ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={isExecuting || writablePlans.length === 0}>
            {isExecuting ? 'กำลังส่ง Meta...' : `ยืนยันส่ง Meta ${writablePlans.length} รายการ`}
          </button>
        </div>
      </section>
    </div>
  )
}

function OptimizerRuleCreateModal({
  campaignCount,
  onCancel,
  onCreate,
}: {
  campaignCount: number
  onCancel: () => void
  onCreate: (values: OptimizerRuleFormValues) => void
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<OptimizerRule['type']>('Pause')
  const [condition, setCondition] = useState('')
  const [affectedAds, setAffectedAds] = useState(Math.max(1, Math.min(campaignCount || 1, 30)))
  const [enabled, setEnabled] = useState(true)
  const canCreate = title.trim().length > 0 && condition.trim().length > 0 && affectedAds > 0

  const submitRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canCreate) return
    onCreate({
      affectedAds,
      condition,
      enabled,
      title,
      type,
    })
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal rule-create-modal" role="dialog" aria-modal="true" aria-labelledby="optimizer-rule-create-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดหน้าสร้างกฎ">
          <X size={18} />
        </button>
        <StatusBadge label="Automation rule" tone={optimizerRuleTone(type)} />
        <h2 id="optimizer-rule-create-title">สร้างกฎ Automation ใหม่</h2>
        <p>กฎนี้จะถูกเพิ่มในตารางทันที และสามารถเปิด/ปิดหรือกรองสถานะได้เหมือนกฎอื่น</p>
        <form onSubmit={submitRule}>
          <div className="form-grid">
            <label>
              ชื่อกฎ
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="เช่น หยุด Ad เมื่อ CPA สูง" />
            </label>
            <label>
              ประเภท
              <select
                value={type}
                onChange={(event) => {
                  const nextType = event.target.value as OptimizerRule['type']
                  setType(nextType)
                  setCondition(optimizerRuleDefaultCondition(nextType))
                }}
              >
                <option value="Budget">Budget</option>
                <option value="Pause">Pause</option>
                <option value="Schedule">Schedule</option>
                <option value="Creative">Creative</option>
              </select>
            </label>
            <label className="form-grid-wide">
              เงื่อนไข
              <textarea value={condition} onChange={(event) => setCondition(event.target.value)} placeholder="ระบุเงื่อนไขที่ AI/automation ต้องใช้ตัดสินใจ" rows={3} />
            </label>
            <label>
              จำนวนแคมเปญที่กระทบ
              <input min={1} max={999} type="number" value={affectedAds} onChange={(event) => setAffectedAds(Number(event.target.value))} />
            </label>
            <label>
              สถานะเริ่มต้น
              <select value={enabled ? 'active' : 'paused'} onChange={(event) => setEnabled(event.target.value === 'active')}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </label>
          </div>
          <div className="rule-create-preview">
            <StatusBadge label={type} tone={optimizerRuleTone(type)} />
            <strong>{title.trim() || 'ชื่อกฎใหม่'}</strong>
            <span>{condition.trim() || optimizerRuleDefaultCondition(type)}</span>
          </div>
          <div className="modal-actions">
            <button className="outline-button" type="button" onClick={onCancel}>
              ยกเลิก
            </button>
            <button className="primary-button" type="submit" disabled={!canCreate}>
              สร้างกฎ
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function OptimizerRuleRunModal({
  isExecuting,
  onCancel,
  onConfirm,
  onRecord,
  run,
}: {
  isExecuting: boolean
  onCancel: () => void
  onConfirm: () => void
  onRecord: () => void
  run: OptimizerRuleRun
}) {
  const writableCandidates = optimizerRuleWritableCandidates(run.candidates)
  const canWriteMeta = run.writeEnabled && writableCandidates.length > 0
  const hasBlockedWrites = !run.writeEnabled && writableCandidates.length > 0
  const reviewOnlyCount = run.candidates.length - writableCandidates.length

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal rule-run-modal" role="dialog" aria-modal="true" aria-labelledby="optimizer-rule-run-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดผลการรันกฎ" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={canWriteMeta ? 'Meta write ready' : hasBlockedWrites ? 'โหมดแนะนำเท่านั้น' : 'Review only'} tone={canWriteMeta ? 'critical' : run.rule.tone} />
        <h2 id="optimizer-rule-run-title">{canWriteMeta ? 'ยืนยันรันกฎจริงกับ Meta' : `ตรวจรายการกฎ: ${run.rule.title}`}</h2>
        <p>
          {canWriteMeta
            ? `กฎนี้จะส่งคำสั่งไป Meta Marketing API จริงหลังยืนยัน: ${run.rule.condition}`
            : hasBlockedWrites
              ? `${run.rule.condition} · มีรายการที่ส่ง Meta ได้ แต่โหมดปัจจุบันเป็นแนะนำเท่านั้น จึงไม่เขียนข้อมูล`
              : `${run.rule.condition} · กฎนี้ยังไม่มี Meta write action ที่ปลอดภัย จึงเป็นรายการตรวจเท่านั้น`}
        </p>
        <div className="confirm-grid">
          <MetricLine label="พบรายการ" value={`${run.candidates.length} ads`} />
          <MetricLine label="จะส่ง Meta จริง" value={`${canWriteMeta ? writableCandidates.length : 0} ads`} />
          <MetricLine label="ตรวจอย่างเดียว" value={`${canWriteMeta ? reviewOnlyCount : run.candidates.length} ads`} />
          <MetricLine label="รันเมื่อ" value={new Date(run.generatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} />
          <MetricLine label="สถานะ" value={canWriteMeta ? 'พร้อมเขียน Meta หลังยืนยัน' : hasBlockedWrites ? 'ถูกบล็อกโดยโหมดแนะนำเท่านั้น' : 'ยังไม่เขียน Meta'} />
        </div>
        <div className="rule-run-list">
          {run.candidates.length > 0 ? (
            run.candidates.slice(0, 8).map((candidate) => {
              const cpa = candidate.ad.bookings > 0 ? candidate.ad.spend / candidate.ad.bookings : 0
              return (
                <article className="rule-run-row" key={`${run.rule.id}-${candidate.ad.id}`}>
                  <div>
                    <StatusBadge label={candidate.targetStatus ? mutationStatusLabel(candidate.targetStatus) : candidate.action} tone={candidate.targetStatus === 'PAUSED' ? 'critical' : candidate.targetStatus === 'ACTIVE' ? 'good' : run.rule.tone} />
                    {candidate.writable && candidate.targetStatus ? <StatusBadge label="ส่ง Meta ได้" tone="good" /> : null}
                    {!candidate.writable && candidate.targetStatus ? <StatusBadge label={candidate.ad.status === 'active' ? 'รอ guardrail' : 'ไม่ต้องส่งซ้ำ'} tone="watch" /> : null}
                  </div>
                  <strong>{candidate.ad.name}</strong>
                  <span>{candidate.campaign?.name ?? 'Meta campaign'} · {candidate.reason}</span>
                  <small>
                    Spend {fmtMoney(candidate.ad.spend)} · ROAS {candidate.ad.roas.toFixed(2)}x · Booking {fmtNum(candidate.ad.bookings)} · CPA {cpa ? fmtMoney(cpa) : 'ยังไม่มี'}
                  </small>
                </article>
              )
            })
          ) : (
            <EmptyState title="ยังไม่มีรายการเข้าเงื่อนไข" detail="กฎนี้รันแล้ว แต่ข้อมูล ads ปัจจุบันยังไม่เจอรายการที่ควรทำ action" />
          )}
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ปิด
          </button>
          <button className="outline-button" type="button" onClick={onRecord} disabled={isExecuting}>
            บันทึกผลการรัน
          </button>
          {canWriteMeta ? (
            <button className="danger-button" type="button" onClick={onConfirm} disabled={isExecuting}>
              {isExecuting ? 'กำลังส่ง Meta...' : `รันจริงใน Meta ${writableCandidates.length} รายการ`}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function optimizerRecommendationTitle(plan: AutoAdPlan) {
  if (plan.decision === 'pause') return 'ปิดแคมเปญประสิทธิภาพต่ำ'
  if (plan.decision === 'activate') return 'เปิดกลับแคมเปญที่มีสัญญาณดี'
  if (plan.decision === 'keep') return 'เพิ่มงบให้แคมเปญที่มี ROAS สูง'
  return 'เฝ้าดูและปรับครีเอทีฟ'
}

function optimizerImpactText(plan: AutoAdPlan) {
  return `Meta จริง: Spend ${fmtMoneyShort(plan.ad.spend)} · ROAS ${plan.ad.roas.toFixed(2)}x · Booking ${fmtNum(plan.ad.bookings)}`
}

function optimizerStrategyLabel(strategy: OptimizerStrategy) {
  if (strategy === 'pause') return 'ปิดตัวเสีย'
  if (strategy === 'activate') return 'เปิดตัวชนะ'
  if (strategy === 'keep') return 'เปิดต่อ'
  if (strategy === 'watch') return 'เฝ้าดู'
  return 'ทั้งหมด'
}

function optimizerStrategyDetail(strategy: OptimizerStrategy) {
  if (strategy === 'pause') return 'เฉพาะ ads ที่เปิดอยู่และเข้าเงื่อนไขหยุดจาก spend, ROAS หรือ booking'
  if (strategy === 'activate') return 'เฉพาะ ads ที่หยุดอยู่แต่มีสัญญาณชนะจาก Meta metrics'
  if (strategy === 'keep') return 'ads ที่เปิดอยู่และผ่านเกณฑ์ตัวชนะ ใช้เป็น reference โดยไม่เขียน Meta'
  if (strategy === 'watch') return 'ads ที่ยังไม่ควรเขียนสถานะ แต่ควรติดตาม creative หรือ tracking'
  return 'รวมทุกกลุ่มจาก Meta metrics รอบล่าสุด แล้วแยกเฉพาะรายการที่ส่งคำสั่ง Meta ได้จริง'
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

const OPTIMIZER_CUSTOM_RULES_KEY = 'pmc.optimizer.customRules'
const optimizerRuleTypes: OptimizerRule['type'][] = ['Budget', 'Pause', 'Schedule', 'Creative']

function isOptimizerRuleType(value: unknown): value is OptimizerRule['type'] {
  return typeof value === 'string' && optimizerRuleTypes.includes(value as OptimizerRule['type'])
}

function optimizerRuleTone(type: OptimizerRule['type']): Tone {
  if (type === 'Pause') return 'critical'
  if (type === 'Schedule') return 'violet'
  if (type === 'Creative') return 'watch'
  return 'good'
}

function optimizerRuleSubtitle(type: OptimizerRule['type']) {
  if (type === 'Pause') return 'หยุดรายการที่ไม่ผ่าน guardrail'
  if (type === 'Schedule') return 'ปรับตามช่วงเวลาที่กำหนด'
  if (type === 'Creative') return 'จัดการ creative fatigue และ learning'
  return 'ปรับงบตาม performance'
}

function optimizerRuleDefaultCondition(type: OptimizerRule['type']) {
  if (type === 'Pause') return 'ROAS < 1.0x ต่อเนื่อง 2 วัน และมี spend เกินเกณฑ์'
  if (type === 'Schedule') return 'ช่วงเวลา 18:00 - 23:00 เพิ่มงบ 20%'
  if (type === 'Creative') return 'ความถี่สูงหรือ CTR ลดลง ให้สร้าง creative ใหม่'
  return 'ROAS > 3.0x ต่อเนื่อง 2 วัน เพิ่มงบ 20%'
}

function isOptimizerRule(value: unknown): value is OptimizerRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as Partial<OptimizerRule>
  return (
    typeof rule.id === 'string' &&
    typeof rule.title === 'string' &&
    typeof rule.condition === 'string' &&
    isOptimizerRuleType(rule.type) &&
    typeof rule.defaultEnabled === 'boolean' &&
    typeof rule.affectedAds === 'number'
  )
}

function readOptimizerCustomRules(): OptimizerRule[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(OPTIMIZER_CUSTOM_RULES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isOptimizerRule)
  } catch {
    return []
  }
}

function writeOptimizerCustomRules(rules: OptimizerRule[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(OPTIMIZER_CUSTOM_RULES_KEY, JSON.stringify(rules.slice(0, 20)))
  } catch {
    // Local storage is optional; the rule still works in memory for the current session.
  }
}

function optimizerRuleWritableCandidates(candidates: OptimizerRuleCandidate[]): Array<OptimizerRuleCandidate & { targetStatus: 'ACTIVE' | 'PAUSED' }> {
  return candidates.filter((candidate): candidate is OptimizerRuleCandidate & { targetStatus: 'ACTIVE' | 'PAUSED' } => Boolean(candidate.writable && candidate.targetStatus))
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function buildOptimizerRuleCandidates(rule: OptimizerRule, plans: AutoAdPlan[]): OptimizerRuleCandidate[] {
  const candidates = plans
    .filter((plan) => {
      if (rule.type === 'Pause') {
        return plan.decision === 'pause' || plan.ad.roas < 1 || (plan.ad.spend >= 500 && plan.ad.bookings === 0)
      }
      if (rule.id === 'target-cpa') {
        return plan.ad.bookings > 0 && plan.ad.spend / plan.ad.bookings > 120
      }
      if (rule.type === 'Budget') {
        return plan.decision === 'keep' || plan.decision === 'activate' || plan.ad.roas >= 1.5 || plan.ad.score >= 7.5
      }
      if (rule.type === 'Schedule') {
        return plan.ad.bookings > 0 || plan.ad.roas >= 1.2
      }
      return plan.decision === 'watch' || plan.decision === 'pause' || plan.ad.ctr < 1 || plan.ad.score < 6
    })
    .toSorted((a, b) => b.ad.spend - a.ad.spend || b.ad.roas - a.ad.roas)
    .slice(0, Math.max(1, rule.affectedAds))

  return candidates.map((plan) => {
    if (rule.type === 'Pause') {
      return {
        action: 'ปิด Ad',
        ad: plan.ad,
        campaign: plan.campaign,
        plan,
        reason: plan.ad.status === 'active' ? plan.reason : `${plan.reason} · ตอนนี้ไม่ได้ active จึงเป็น review ไม่ส่งคำสั่งซ้ำ`,
        targetStatus: 'PAUSED' as const,
        writable: plan.ad.status === 'active',
      }
    }

    if (rule.type === 'Budget') {
      return {
        action: 'Review budget scale',
        ad: plan.ad,
        campaign: plan.campaign,
        plan,
        reason: `ROAS ${plan.ad.roas.toFixed(2)}x / metric score ${plan.ad.score.toFixed(1)} เหมาะกับการตรวจเพิ่มงบ`,
        writable: false,
      }
    }

    if (rule.type === 'Schedule') {
      return {
        action: 'Review schedule boost',
        ad: plan.ad,
        campaign: plan.campaign,
        plan,
        reason: 'มี booking หรือ ROAS ดีพอให้ตรวจช่วงเวลาเร่งงบ',
        writable: false,
      }
    }

    return {
      action: 'Creative refresh',
      ad: plan.ad,
      campaign: plan.campaign,
      plan,
      reason: plan.decision === 'pause' ? 'ประสิทธิภาพต่ำ ควรทำ creative/offer ใหม่ก่อนเปิดต่อ' : 'สัญญาณ CTR หรือ metric score ยังไม่แข็งแรง',
      writable: false,
    }
  })
}

function buildOptimizerRules(plans: AutoAdPlan[]): OptimizerRule[] {
  const pauseCount = plans.filter((plan) => plan.decision === 'pause').length
  const keepCount = plans.filter((plan) => plan.decision === 'keep').length
  const activateCount = plans.filter((plan) => plan.decision === 'activate').length
  const highCpaCount = plans.filter((plan) => plan.ad.bookings > 0 && plan.ad.spend / plan.ad.bookings > 120).length

  return [
    {
      id: 'scale-high-roas',
      title: 'เพิ่มงบเมื่อ ROAS สูง',
      subtitle: 'ตรวจรายการที่มีสัญญาณชนะจาก Meta',
      type: 'Budget',
      condition: 'ROAS > 3.0x หรือ metric score สูง',
      lastRun: 'ยังไม่เคยรัน',
      runCount: 0,
      tone: 'good',
      defaultEnabled: true,
      affectedAds: keepCount + activateCount,
    },
    {
      id: 'pause-low-roas',
      title: 'หยุดแคมเปญประสิทธิภาพต่ำ',
      subtitle: 'หยุด ads ที่ใช้จ่ายแล้วไม่คุ้ม',
      type: 'Pause',
      condition: 'ROAS < 1.0x หรือมี spend แต่ไม่มี conversion',
      lastRun: 'ยังไม่เคยรัน',
      runCount: 0,
      tone: 'critical',
      defaultEnabled: true,
      affectedAds: pauseCount,
    },
    {
      id: 'target-cpa',
      title: 'ตรวจ CPA เกินเป้าหมาย',
      subtitle: 'ตรวจรายการที่ CPA สูงจาก Meta conversions',
      type: 'Budget',
      condition: 'CPA > ฿120 จาก spend / conversion',
      lastRun: 'ยังไม่เคยรัน',
      runCount: 0,
      tone: 'info',
      defaultEnabled: true,
      affectedAds: highCpaCount,
    },
    {
      id: 'new-ad-boost',
      title: 'ตรวจ creative ที่ต้องรีเฟรช',
      subtitle: 'ตรวจ creative จาก CTR/metric score ของ Meta',
      type: 'Creative',
      condition: 'CTR ต่ำหรือ metric score ต่ำ',
      lastRun: 'ยังไม่เคยรัน',
      runCount: 0,
      tone: 'watch',
      defaultEnabled: false,
      affectedAds: plans.filter((plan) => plan.decision === 'watch' || plan.decision === 'pause' || plan.ad.ctr < 1 || plan.ad.score < 6).length,
    },
  ]
}

type OptimizerInsightUnit = 'money' | 'percent' | 'ratio'

function buildOptimizerInsights(plans: AutoAdPlan[], trendData: TrendPoint[]) {
  const dailyRows = trendData.filter((point) => point.spend > 0 || point.revenue > 0 || point.clicks > 0 || point.bookings > 0)
  if (!dailyRows.length) return []

  const totalSpend = dailyRows.reduce((sum, point) => sum + point.spend, 0)
  const totalRevenue = dailyRows.reduce((sum, point) => sum + point.revenue, 0)
  const totalBookings = dailyRows.reduce((sum, point) => sum + point.bookings, 0)
  const totalClicks = dailyRows.reduce((sum, point) => sum + point.clicks, 0)
  const averageRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0
  const averageCpa = totalBookings > 0 ? totalSpend / totalBookings : 0
  const conversionRate = totalClicks > 0 ? (totalBookings / totalClicks) * 100 : 0
  const sparklineRows = dailyRows.slice(-12)
  const roasSeries = sparklineRows.map((point) => (point.spend > 0 ? point.revenue / point.spend : 0))
  const cpaSeries = sparklineRows
    .filter((point) => point.bookings > 0)
    .map((point) => point.spend / point.bookings)
  const conversionSeries = sparklineRows
    .filter((point) => point.clicks > 0)
    .map((point) => (point.bookings / point.clicks) * 100)
  const sourceDetail = `${fmtNum(dailyRows.length)} วันจาก Meta · ${fmtNum(plans.length)} ads`

  return [
    {
      label: 'ROAS เฉลี่ยจริง',
      value: `${averageRoas.toFixed(2)}x`,
      detail: `${sourceDetail} · spend ${fmtMoneyShort(totalSpend)}`,
      tone: 'good' as Tone,
      unit: 'ratio' as OptimizerInsightUnit,
      values: roasSeries,
    },
    {
      label: 'Cost per Result จริง',
      value: averageCpa ? fmtMoney(averageCpa) : 'ยังไม่มี booking',
      detail: `${fmtNum(totalBookings)} booking จาก spend ${fmtMoneyShort(totalSpend)}`,
      tone: 'info' as Tone,
      unit: 'money' as OptimizerInsightUnit,
      values: cpaSeries,
    },
    {
      label: 'Conversion rate จริง',
      value: `${conversionRate.toFixed(2)}%`,
      detail: `${fmtNum(totalClicks)} clicks / ${fmtNum(totalBookings)} booking`,
      tone: 'violet' as Tone,
      unit: 'percent' as OptimizerInsightUnit,
      values: conversionSeries,
    },
  ]
}

function formatOptimizerInsightMetric(value: number, unit: OptimizerInsightUnit) {
  if (unit === 'money') return fmtMoney(value)
  if (unit === 'ratio') return `${value.toFixed(2)}x`
  return `${value.toFixed(2)}%`
}

function buildOptimizerChart(trendData: TrendPoint[]) {
  return trendData
    .filter((point) => point.spend > 0 || point.revenue > 0 || point.clicks > 0 || point.bookings > 0)
    .slice(-12)
    .map((point) => ({
      label: formatTrendPointLabel(point.date),
      value: point.bookings,
    }))
}

function formatTrendPointLabel(date: string) {
  if (!date || date === '-') return '-'
  const parts = date.split('-')
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`
  return date
}

function OptimizerSummaryTile({ detail, label, tone, value }: { detail: string; label: string; tone: Tone; value: string }) {
  return (
    <article className={`optimizer-summary-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function OptimizerSparkline({ tone, unit, values }: { tone: Tone; unit: OptimizerInsightUnit; values: number[] }) {
  const safeValues = values.filter((value) => Number.isFinite(value))
  if (!safeValues.length) {
    return (
      <div className={`optimizer-sparkline-card ${tone}`}>
        <div className="optimizer-sparkline-empty">ไม่มีข้อมูลรายวัน</div>
      </div>
    )
  }

  const min = Math.min(...safeValues, 0)
  const max = Math.max(...safeValues, 1)
  const range = Math.max(max - min, max || 1, 1)
  const average = safeValues.length ? safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length : 0
  const latest = safeValues.at(-1) ?? 0
  const points = safeValues.map((value, index) => `${(index / Math.max(safeValues.length - 1, 1)) * 92 + 4},${36 - ((value - min) / range) * 28}`).join(' ')
  return (
    <div className={`optimizer-sparkline-card ${tone}`}>
      <svg className="optimizer-sparkline" viewBox="0 0 100 42" aria-label={`ค่าจริงล่าสุด ${formatOptimizerInsightMetric(latest, unit)}`}>
        <polyline points={points} />
        {safeValues.map((value, index) => (
          <circle cx={(index / Math.max(safeValues.length - 1, 1)) * 92 + 4} cy={36 - ((value - min) / range) * 28} key={`${value}-${index}`} r="2.2">
            <title>{formatOptimizerInsightMetric(value, unit)}</title>
          </circle>
        ))}
      </svg>
      <div className="optimizer-sparkline-meta">
        <span>
          <small>ล่าสุด</small>
          <strong>{formatOptimizerInsightMetric(latest, unit)}</strong>
        </span>
        <span>
          <small>เฉลี่ย</small>
          <strong>{formatOptimizerInsightMetric(average, unit)}</strong>
        </span>
      </div>
    </div>
  )
}

function OptimizerLineChart({ points }: { points: Array<{ label: string; value: number }> }) {
  const values = points.map((point) => point.value)
  const total = values.reduce((sum, value) => sum + value, 0)
  const average = values.length ? Math.round(total / values.length) : 0
  const peak = Math.max(...values, 0)
  const lastValue = values.at(-1) ?? 0
  const previousValue = values.at(-2) ?? lastValue
  const trend = previousValue ? Math.round(((lastValue - previousValue) / previousValue) * 100) : 0
  const trendLabel = trend >= 0 ? `+${trend}%` : `${trend}%`

  return (
    <div className="optimizer-line-chart">
      <div className="optimizer-chart-kpis" aria-label="Automation chart metrics">
        <span>
          <small>รวมช่วงนี้</small>
          <strong>{fmtNum(total)}</strong>
        </span>
        <span>
          <small>เฉลี่ยต่อวัน</small>
          <strong>{fmtNum(average)}</strong>
        </span>
        <span>
          <small>สูงสุด</small>
          <strong>{fmtNum(peak)}</strong>
        </span>
        <span className={trend >= 0 ? 'good' : 'critical'}>
          <small>แนวโน้ม</small>
          <strong>{trendLabel}</strong>
        </span>
      </div>
      <div className="optimizer-chart-canvas">
        <ResponsiveContainer height={224} width="100%">
          <ComposedChart data={points} margin={{ top: 18, right: 16, bottom: 2, left: -18 }}>
            <defs>
              <linearGradient id="optimizerActionFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.34} />
                <stop offset="52%" stopColor="#2f86eb" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#7567d8" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="optimizerActionBar" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#30d5a8" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eef2f8" strokeDasharray="3 9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#667085', fontWeight: 700 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#98a2b3', fontWeight: 700 }} axisLine={false} tickLine={false} width={38} />
            <ReferenceLine y={average} stroke="#a78bfa" strokeDasharray="7 7" strokeWidth={1.5} ifOverflow="extendDomain" />
            <Tooltip cursor={{ fill: 'rgba(117, 103, 216, 0.06)', stroke: '#c7d2fe', strokeWidth: 1 }} content={<OptimizerChartTooltip average={average} />} />
            <Bar dataKey="value" fill="url(#optimizerActionBar)" barSize={20} radius={[10, 10, 0, 0]} />
            <Area
              type="monotone"
              dataKey="value"
              name="Tracked booking"
              stroke="#4f46e5"
              strokeWidth={4}
              fill="url(#optimizerActionFill)"
              dot={{ r: 4.5, fill: '#fff', stroke: '#4f46e5', strokeWidth: 3 }}
              activeDot={{ r: 7, fill: '#4f46e5', stroke: '#fff', strokeWidth: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function OptimizerChartTooltip({
  active,
  average,
  label,
  payload,
}: {
  active?: boolean
  average: number
  label?: string | number
  payload?: Array<{ value?: number | string }>
}) {
  if (!active || !payload?.length) return null
  const value = Number(payload[0]?.value) || 0

  return (
    <div className="optimizer-chart-tooltip">
      <span>{label}</span>
      <strong>{fmtNum(value)} booking</strong>
      <small>ค่าเฉลี่ย {fmtNum(average)} booking/วัน</small>
    </div>
  )
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
  const automationPaused = automationMode === 'พัก automation'
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
      setAutoAdsMessage('Automation ถูกพักอยู่ เปลี่ยนโหมดก่อนเพิ่มคำสั่งเข้าคิว')
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
      setAutoAdsMessage('Automation ถูกพักอยู่ เปลี่ยนโหมดก่อนเพิ่มคำสั่งเข้าคิว')
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
      setAutoAdsMessage('Automation ถูกพักอยู่ เปลี่ยนโหมดก่อนยืนยันคำสั่ง')
      return
    }
    if (queuedPlans.length === 0) {
      setAutoAdsMessage('ยังไม่มีคำสั่งในคิว เลือก ad ที่ AI แนะนำก่อน')
      return
    }
    if (automationMode !== 'ต้องอนุมัติก่อน') {
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
          action={<StatusBadge label={automationMode} tone={autoAdsModeTone(automationMode)} />}
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
                <select value={automationMode} onChange={(event) => onModeChange(event.target.value)}>
                  {automationModeOptions.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
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

function CreativeStudioPage({ components }: { components: WorkspaceData['insightComponents'] }) {
  return (
    <TwoColumnPage
      aside={
        <AssistantPanel
          title="ผู้ช่วยครีเอทีฟ"
          text="ใช้หลักฐานจากตัวชนะ hook ใหม่ และข้อความที่ปลอดภัยด้าน compliance ก่อนปรับงบ"
        />
      }
    >
      <SectionCard collapsible title="ผลงานครีเอทีฟ" subtitle="ตัวชนะและรายการที่ควรรีเฟรชแยกตามบริการ">
        <div className="card-grid">
          {components.length > 0 ? (
            components.map((asset) => (
              <article className="mini-card" key={asset.id}>
                <StatusBadge label={`คะแนน ${asset.score.toFixed(1)}`} tone={asset.tone} />
                <h3>{asset.title}</h3>
                <p>{asset.service}</p>
                <MetricLine label="CTR" value={`${asset.ctr.toFixed(2)}%`} />
                <MetricLine label="ต้นทุน / ผลลัพธ์" value={fmtMoney(asset.costPerResult)} />
              </article>
            ))
          ) : (
            <EmptyState title="ยังไม่มีข้อมูลครีเอทีฟ" detail="การ์ดผลงานครีเอทีฟจะแสดงหลังซิงก์ Meta ads และ insights สำเร็จ" />
          )}
        </div>
      </SectionCard>
      <StatePanel state={`${components.length} ครีเอทีฟจากข้อมูลจริง`} detail="รายการครีเอทีฟมาจาก Meta ads และ insight rows ที่ซิงก์มา" tone={components.length > 0 ? 'info' : 'neutral'} />
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
  auditTrail,
  datePreset,
  metaInfo,
  recommendations,
  summary,
  syncState,
}: {
  auditTrail: AuditEvent[]
  datePreset: string
  metaInfo: MetaInfo | null
  recommendations: Recommendation[]
  summary: Summary
  syncState: string
}) {
  const recommendationLines = recommendations.length
    ? recommendations.map((rec, index) => `${index + 1}. ${rec.title} (${riskLabel(rec.risk)}) - ${rec.evidence}`).join('\n')
    : 'ยังไม่มีคำแนะนำจาก AI ในช่วงข้อมูลนี้'
  const auditLines = auditTrail.length
    ? auditTrail.slice(0, 5).map((event, index) => `${index + 1}. ${auditActionLabel(event.action)} - ${event.detail} (${event.time})`).join('\n')
    : 'ยังไม่มี audit event'

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
    '',
    'ประวัติการตรวจสอบ',
    auditLines,
  ].join('\n')
}

function ReportsPage({
  auditTrail,
  datePreset,
  metaInfo,
  preparedReport,
  recommendations,
  setPreparedReport,
  summary,
  syncState,
}: {
  auditTrail: AuditEvent[]
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
    () => buildReportText({ auditTrail, datePreset, metaInfo, recommendations, summary, syncState }),
    [auditTrail, datePreset, metaInfo, recommendations, summary, syncState],
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
          <p>รวมค่าโฆษณา รายได้ ROAS, funnel คลินิก, action จาก AI และ audit trail</p>
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
      <AuditPanel auditTrail={auditTrail} />
    </TwoColumnPage>
  )
}

function SettingsPage({ dataState, metaInfo, onSync, syncState }: { dataState: DataSourceState; metaInfo: MetaInfo | null; onSync: () => void; syncState: string }) {
  const account = metaInfo?.accountName ?? 'ยังไม่ได้เชื่อมต่อ Meta API'
  const [accessToken, setAccessToken] = useState('')
  const [adAccountId, setAdAccountId] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isConfirmingConfigSave, setIsConfirmingConfigSave] = useState(false)
  const isSyncing = syncState === 'Syncing...'
  const stateTone: Tone = dataState === 'live' ? 'good' : dataState === 'error' ? 'critical' : dataState === 'loading' ? 'info' : 'watch'
  const savedCredentialLabel = metaInfo?.settingsSource
    ? metaInfo.settingsSource === 'web-settings'
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

  const saveMetaConfig = async () => {
    setIsSavingConfig(true)
    setSettingsMessage('กำลังบันทึกค่า Meta API...')
    try {
      await apiJson('/api/meta/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          adAccountId,
          graphVersion: metaInfo?.graphVersion ?? 'v21.0',
          defaultDatePreset: 'maximum',
        }),
      })
      setSettingsMessage('บันทึกค่า Meta API แล้ว กำลังซิงก์ workspace จริง...')
      setAccessToken('')
      setIsConfirmingConfigSave(false)
      onSync()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? formatApiMessage(error.message) : 'บันทึกค่า Meta API ไม่สำเร็จ')
    } finally {
      setIsSavingConfig(false)
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
        <SectionCard collapsible title="ตั้งค่า Workspace" subtitle="การเชื่อมต่อ Meta และความพร้อมของแหล่งข้อมูล">
          <div className="settings-credential-state">
            <StatusBadge label={savedCredentialLabel} tone={metaInfo?.settingsSource ? 'good' : 'watch'} />
            <span>{tokenLocationLabel}</span>
            {metaInfo?.adAccountId ? <span>Ad Account: {metaInfo.adAccountId}</span> : null}
          </div>
          <div className="form-grid">
            <label>
              บัญชีที่แสดง
              <input value={account} readOnly />
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
                setIsConfirmingConfigSave(true)
              }}
              disabled={isSavingConfig || (!accessToken && !adAccountId)}
            >
              {isSavingConfig ? 'กำลังบันทึก...' : 'บันทึกค่า Meta API'}
            </button>
          </div>
          {settingsMessage ? <p className="settings-message">{settingsMessage}</p> : null}
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
          onCancel={() => setIsConfirmingConfigSave(false)}
          onConfirm={saveMetaConfig}
        />
      ) : null}
    </>
  )
}

function SettingsSaveConfirmModal({
  adAccountId,
  hasAccessToken,
  isSaving,
  onCancel,
  onConfirm,
}: {
  adAccountId: string
  hasAccessToken: boolean
  isSaving: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="settings-save-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isSaving}>
          <X size={18} />
        </button>
        <StatusBadge label="บันทึก credential จริง" tone="watch" />
        <h2 id="settings-save-title">ยืนยันการบันทึก Meta API</h2>
        <p>ระบบจะตรวจ credential กับ Meta และบันทึกค่าไว้ฝั่ง server ของเครื่องนี้ก่อนซิงก์ข้อมูลจริง</p>
        <div className="confirm-grid">
          <MetricLine label="Access Token" value={hasAccessToken ? 'มี token ใหม่ในฟอร์ม' : 'ใช้ token ที่บันทึกไว้เดิม'} />
          <MetricLine label="Ad Account ID" value={adAccountId || 'ใช้ค่าที่บันทึกไว้เดิม'} />
          <MetricLine label="ตำแหน่งบันทึก" value="server-local-file" />
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
          detail: 'ข้อมูล Meta API ซิงก์สำเร็จแล้ว ใช้ Analytics, Ads Manager และ AI Marketer ได้ตามปกติ',
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

function TwoColumnPage({ aside, children }: { aside: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="two-column-page">
      <section className="main-stack">{children}</section>
      <aside className="right-rail">{aside}</aside>
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

  return (
    <section className={panelClassName}>
      <div className={panelHeadClassName}>
        <div>
          <h2>{title}</h2>
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

function AssistantPanel({ text, title }: { text: string; title: string }) {
  return (
    <section className="panel assistant-panel">
      <img src="/pmc-ai-mascot.png" alt="" />
      <h2>{title}</h2>
      <p>{text}</p>
      <StatusBadge label="แนะนำเท่านั้น" tone="violet" />
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

function PillButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="pill-button">
      <Icon size={15} />
      {label}
    </span>
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
  const requestedStatus = execution?.status ? mutationStatusLabel(execution.status) : execution?.operation ? 'อัปเดต object' : 'รีวิวเท่านั้น'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="ปิดการยืนยัน" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={execution ? 'เขียนข้อมูลจริงใน Meta' : 'ยืนยันการรีวิว'} tone={execution ? 'critical' : 'watch'} />
        <h2 id="confirm-title">{recommendation.action}</h2>
        <div className="confirm-grid">
          <MetricLine label="แคมเปญ / เป้าหมาย" value={targetLabel} />
          <MetricLine label="ประเภท object" value={executionObjectTypeLabel} />
          <MetricLine label="สถานะ delivery ปัจจุบัน" value={targetCampaign ? campaignStatusLabel(targetCampaign.status) : 'รีวิวเท่านั้น'} />
          <MetricLine label="สถานะที่ต้องการ" value={requestedStatus} />
          <MetricLine label="Rollback" value="พร้อมหลังดำเนินการ" />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            ยกเลิก
          </button>
          <button className={execution ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={isExecuting}>
            {isExecuting ? 'กำลังดำเนินการ...' : execution ? 'ยืนยันใน Meta' : 'ยืนยันการรีวิว'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default App
