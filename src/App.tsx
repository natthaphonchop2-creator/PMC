import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  cpa: number
  roas: number
  frequency: number
  ctr: number
  cpc: number
  cpm: number
  cpl: number
  leadQuality: number
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

type MetaStatusResponse = {
  configured: boolean
  connected: boolean
  graphVersion?: string
  adAccountId?: string | null
  datePreset?: string
  source?: string
  settingsSource?: string | null
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
  fetchedAt: string
  graphVersion: string
  source: string
  counts?: MetaWorkspaceResponse['meta']['counts']
}

const navItems: NavItem[] = [
  { id: 'analytics', label: 'Analytics', group: 'Main', icon: LineChart, description: 'Meta ads, clinic funnel, AI actions and audit state' },
  { id: 'ads', label: 'Ads Manager', group: 'Main', icon: Megaphone, description: 'Campaign, ad set and ad delivery controls' },
  { id: 'marketer', label: 'AI Marketer', group: 'Main', icon: BrainCircuit, description: 'Recommendation queue and approval workflow' },
  { id: 'optimization', label: 'Optimization', group: 'Main', icon: Power, description: 'Budget guardrails and automation rules' },
  { id: 'creative', label: 'Creative Studio', group: 'Creative', icon: Layers3, description: 'Creative performance from synced Meta ads' },
  { id: 'audience', label: 'Audience Insights', group: 'Creative', icon: Users, description: 'Segments, placements, geo and lead quality' },
  { id: 'library', label: 'Ad Library', group: 'Creative', icon: ImageIcon, description: 'Assets, compliance and launch readiness' },
  { id: 'reports', label: 'Reports', group: 'System', icon: FileText, description: 'Audit trail and report preparation' },
  { id: 'settings', label: 'Settings', group: 'System', icon: Settings, description: 'Meta connection, workspace and API readiness' },
  { id: 'help', label: 'Help Center', group: 'System', icon: HelpCircle, description: 'Setup guide, states and operating playbook' },
]

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
    throw new Error(typeof payload.error === 'string' ? payload.error : `API request failed (${response.status})`)
  }
  return payload as T
}

function metaDatePresetForUi(preset: string) {
  if (preset === 'Last 7 days') return 'last_7d'
  if (preset === 'This month') return 'this_month'
  if (preset === 'Quarter to date') return 'last_90d'
  if (preset === 'Maximum history') return 'maximum'
  return 'last_30d'
}

function deliveryLabel(status: 'active' | 'paused') {
  return status === 'active' ? 'Active' : 'Paused'
}

function deliveryTone(status: 'active' | 'paused'): Tone {
  return status === 'active' ? 'good' : 'neutral'
}

function nextDeliveryStatus(status: 'active' | 'paused'): 'ACTIVE' | 'PAUSED' {
  return status === 'active' ? 'PAUSED' : 'ACTIVE'
}

function objectTypeLabel(type: AdsObjectType) {
  if (type === 'campaign') return 'Campaign'
  if (type === 'adset') return 'Ad set'
  return 'Ad'
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
    cpa: campaign.cpa,
    roas: campaign.roas,
    frequency: campaign.frequency,
    ctr: campaign.ctr,
    cpc: 0,
    cpm: 0,
    cpl: campaign.cpa,
    leadQuality: Math.round(Math.min(100, Math.max(0, campaign.roas * 18 + campaign.conversions))),
    aiTag: campaign.aiStatus === 'scaling' ? 'Scale' : campaign.aiStatus === 'critical' ? 'Pause' : campaign.aiStatus === 'watch' ? 'Watch' : 'Healthy',
    tone,
  }
}

function mapMetaRecommendation(action: MetaRecommendedAction): Recommendation {
  return {
    id: action.id,
    title: action.type,
    evidence: action.summary,
    risk: action.risk,
    confidence: action.confidence,
    guardrail: action.guardrail,
    impact: `${action.before}. After: ${action.after}. ${action.rollbackNote}`,
    action: action.execution?.label ?? action.after,
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
  const revenue = channel?.revenue ?? campaignList.reduce((sum, campaign) => sum + campaign.spend * campaign.roas, 0)
  const leads = channel?.leads ?? workspace.appointmentStages.find((stage) => stage.id === 'leads')?.count ?? 0
  const bookings = channel?.bookings ?? campaignList.reduce((sum, campaign) => sum + Math.round(campaign.spend / Math.max(campaign.cpa, 1)), 0)
  const paidTreatments = channel?.treatments ?? workspace.appointmentStages.find((stage) => stage.id === 'paid')?.count ?? 0

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
  const [datePreset, setDatePreset] = useState('Maximum history')
  const [automationMode, setAutomationMode] = useState('Suggest only')
  const [syncState, setSyncState] = useState('Checking Meta API')
  const [dataState, setDataState] = useState<DataSourceState>('loading')
  const [apiMessage, setApiMessage] = useState('Connecting to Meta Marketing API')
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
      time: 'just now',
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
          accountName: 'Meta account not configured',
          fetchedAt: new Date().toISOString(),
          graphVersion: status.graphVersion ?? 'v21.0',
          source: status.source ?? 'Meta Marketing API',
        })
        setDataState('setup-required')
        setSyncState('Setup required')
        setApiMessage('Add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID, or save credentials through the Meta config API.')
        return
      }
      if (!status.connected) {
        const failedCheck = status.connection?.checks?.find((check) => check.status === 'fail')
        setWorkspace(null)
        setMetaInfo({
          accountName: 'Meta API connection failed',
          fetchedAt: new Date().toISOString(),
          graphVersion: status.graphVersion ?? 'v21.0',
          source: status.source ?? 'Meta Marketing API',
        })
        setDataState('error')
        setSyncState('Sync error')
        setApiMessage(failedCheck?.detail ?? 'Meta API credentials are configured but connection validation failed.')
        return
      }

      const datePresetParam = metaDatePresetForUi(datePreset)
      const result = await apiJson<MetaWorkspaceResponse>(`/api/meta/workspace?datePreset=${encodeURIComponent(datePresetParam)}`)
      if (!isLatestRequest()) return

      setWorkspace(result.workspace)
      setMetaInfo({
        accountName: result.meta.account?.name || 'Meta ad account',
        counts: result.meta.counts,
        fetchedAt: result.meta.fetchedAt,
        graphVersion: result.meta.graphVersion,
        source: result.meta.source,
      })
      setDataState(result.workspace.campaigns.length ? 'live' : 'empty')
      setSyncState(result.workspace.campaigns.length ? 'Live Meta API' : 'No data')
      setApiMessage(result.workspace.campaigns.length ? `${result.meta.source} synced ${result.meta.counts?.campaigns ?? 0} campaigns` : 'Meta API connected, but this date range returned no campaigns.')
      if (source !== 'auto') {
        appendAudit({
          action: source === 'execution' ? 'Meta API refreshed' : 'Workspace synced',
          detail: `${datePreset} · ${result.meta.counts?.campaigns ?? 0} campaigns · ${result.meta.counts?.adSets ?? 0} ad sets`,
          actor: 'System',
          tone: 'good',
        })
      }
    } catch (error) {
      if (!isLatestRequest()) return

      setWorkspace(null)
      setDataState('error')
      setSyncState('Sync error')
      setApiMessage(error instanceof Error ? error.message : 'Meta API sync failed')
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
      action: 'Rejected recommendation',
      detail: rec?.title ?? 'Recommendation rejected',
      actor: 'Operator',
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
        action: 'Execution failed',
        detail: error instanceof Error ? error.message : 'Meta write failed',
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
          action: 'Post-write refresh failed',
          detail: error instanceof Error ? error.message : 'Meta write succeeded, but the follow-up sync failed',
          actor: 'System',
          tone: 'watch',
        })
      }
    }

    setRecommendationStates((current) => ({ ...current, [activeId]: 'Executed' }))
    appendAudit({
      action: rec?.execution ? 'Meta write succeeded' : 'Review completed',
      detail: `${rec?.title ?? 'Recommendation'} · ${rec?.execution ? 'real Meta API execution' : 'no write endpoint on this recommendation'}`,
      actor: 'Operator',
      tone: 'good',
    })
    setConfirmingId(null)
    setExecutingRecommendationId(null)
  }

  return (
    <div className="app-shell" ref={shellRef}>
      <Sidebar activeTab={activeTab} accountName={metaInfo?.accountName ?? 'PMC Clinic'} dataState={dataState} onSelect={setActiveTab} syncState={syncState} />
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
              action: 'Report prepared',
              detail: `${datePreset} summary is ready for review`,
              actor: 'Operator',
              tone: 'info',
            })
          }}
          onSync={syncWorkspace}
          syncState={syncState}
        />
        <DataSourceBar dataState={dataState} message={apiMessage} metaInfo={metaInfo} onRetry={syncWorkspace} />
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
            <OptimizationPage automationMode={automationMode} campaigns={displayCampaigns} onModeChange={setAutomationMode} />
          )}
          {activeTab === 'creative' && <CreativeStudioPage components={workspace?.insightComponents ?? []} />}
          {activeTab === 'audience' && <AudienceInsightsPage adSets={workspace?.adSets ?? []} />}
          {activeTab === 'library' && <AdLibraryPage reviews={workspace?.complianceReviews ?? []} />}
          {activeTab === 'reports' && <ReportsPage auditTrail={activeAuditTrail} preparedReport={preparedReport} setPreparedReport={setPreparedReport} />}
          {activeTab === 'settings' && <SettingsPage dataState={dataState} metaInfo={metaInfo} onSync={syncWorkspace} syncState={syncState} />}
          {activeTab === 'help' && <HelpCenterPage />}
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
  dataState: DataSourceState
  onSelect: (tab: TabId) => void
  syncState: string
}

function Sidebar({ activeTab, accountName, dataState, onSelect, syncState }: SidebarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const statusTone: Tone = dataState === 'live' ? 'good' : dataState === 'error' ? 'critical' : dataState === 'loading' ? 'info' : 'watch'
  const freshnessLabel =
    dataState === 'live'
      ? 'real API'
      : dataState === 'loading'
        ? 'syncing'
        : dataState === 'empty'
          ? 'no live data'
          : dataState === 'setup-required'
            ? 'setup required'
            : 'sync error'
  const selectTab = (tab: TabId) => {
    onSelect(tab)
    setIsMenuOpen(false)
  }

  return (
    <aside className={`sidebar ${isMenuOpen ? 'menu-open' : ''}`}>
      <div className="sidebar-header">
        <button className="brand" type="button" onClick={() => selectTab('analytics')} aria-label="Open Analytics">
          <span className="brand-logo-wrap">
            <img src="/promedclinicpmc-logo.png" alt="" />
          </span>
          <span>
            <strong>PMC Ads Agent</strong>
            <small>Clinic media cockpit</small>
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

      <nav className="nav-groups" id="dashboard-navigation" aria-label="Dashboard pages">
        {(['Main', 'Creative', 'System'] as const).map((group) => (
          <div className="nav-group" key={group}>
            <span className="nav-group-title">{group}</span>
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
        <StatusBadge label={syncState} tone={statusTone} />
        <strong>Ad account: {accountName}</strong>
        <span>Freshness: {freshnessLabel}</span>
        <span>Mode: Suggest only</span>
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
  const label = dataState === 'live' ? 'Real Meta API' : dataState === 'loading' ? 'Syncing API' : dataState === 'empty' ? 'No live data' : dataState === 'setup-required' ? 'Setup required' : 'Sync error'

  return (
    <section className={`data-source-bar ${dataState}`}>
      <div>
        <StatusBadge label={label} tone={tone} />
        <strong>{metaInfo?.accountName ?? 'Meta API not connected'}</strong>
        <span>{message}</span>
      </div>
      <div className="data-source-meta">
        <span>{metaInfo?.graphVersion ?? 'Meta Graph API'}</span>
        <span>{metaInfo?.counts ? `${metaInfo.counts.campaigns} campaigns · ${metaInfo.counts.ads} ads` : 'Waiting for credentials'}</span>
        <button className="outline-button" type="button" onClick={onRetry} disabled={dataState === 'loading'}>
          Retry sync
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
        <h1>{activePage.label === 'Analytics' ? 'Analytics cockpit' : activePage.label}</h1>
        <p>{activePage.description}</p>
      </div>
      <div className="topbar-actions">
        <PillButton icon={Database} label="Promed Clinic PMC" />
        <select aria-label="Date range" value={datePreset} onChange={(event) => onDateChange(event.target.value)}>
          <option>Maximum history</option>
          <option>Last 7 days</option>
          <option>Last 30 days</option>
          <option>This month</option>
          <option>Quarter to date</option>
        </select>
        <button className="pill-button good" type="button" onClick={onSync}>
          <RefreshCw size={15} />
          {syncState}
        </button>
        <select aria-label="Automation mode" value={automationMode} onChange={(event) => onModeChange(event.target.value)}>
          <option>Suggest only</option>
          <option>Approval required</option>
          <option>Paused automation</option>
        </select>
        <button className="pill-button blue" type="button" onClick={onPrepareReport}>
          <FileText size={15} />
          Prepare report
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
    { label: 'Ad Spend', value: fmtMoneyShort(summary.spend), trend: 'Meta spend', tone: summary.spend > 0 ? ('info' as Tone) : ('neutral' as Tone) },
    { label: 'Revenue', value: fmtMoneyShort(summary.revenue), trend: 'Tracked revenue', tone: summary.revenue > 0 ? ('good' as Tone) : ('neutral' as Tone) },
    { label: 'ROAS', value: `${summary.roas.toFixed(1)}x`, trend: 'Revenue / spend', tone: summary.roas >= 2 ? ('good' as Tone) : summary.roas > 0 ? ('watch' as Tone) : ('neutral' as Tone) },
    { label: 'CPA / Booking', value: fmtMoney(summary.cpa), trend: 'Spend / bookings', tone: summary.cpa > 0 ? ('watch' as Tone) : ('neutral' as Tone) },
    { label: 'Leads', value: fmtNum(summary.leads), trend: 'Meta leads', tone: summary.leads > 0 ? ('info' as Tone) : ('neutral' as Tone) },
    { label: 'Bookings', value: fmtNum(summary.bookings), trend: 'Tracked bookings', tone: summary.bookings > 0 ? ('good' as Tone) : ('neutral' as Tone) },
    { label: 'Paid Treatments', value: fmtNum(summary.paidTreatments), trend: 'Clinic outcomes', tone: summary.paidTreatments > 0 ? ('good' as Tone) : ('neutral' as Tone) },
    { label: 'CAC', value: fmtMoney(summary.cac), trend: 'Spend / paid', tone: summary.cac > 0 ? ('watch' as Tone) : ('neutral' as Tone) },
  ]
  const [kpisCollapsed, setKpisCollapsed] = useState(false)
  const kpiContentId = useId()

  return (
    <div className="analytics-layout">
      <section className="main-stack">
        <section className="data-strip">
          <div className="data-strip-head">
            <div>
              <h2>KPI Overview</h2>
              <p>Spend, revenue and clinic outcome metrics</p>
            </div>
            <CollapseButton
              collapsed={kpisCollapsed}
              controlsId={kpiContentId}
              label="KPI Overview"
              onToggle={() => setKpisCollapsed((value) => !value)}
            />
          </div>
          <div id={kpiContentId} role="region" aria-label="KPI Overview">
            {kpisCollapsed ? (
              <CollapsedPlaceholder title="KPI Overview" />
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
    <SectionCard collapsible title="Clinic Funnel" subtitle="Impressions to paid treatments, with drop-off">
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
          <StatusBadge label={`${stages.length} live stages`} tone={summary.bookings > 0 ? 'good' : 'neutral'} />
        </>
      ) : (
        <EmptyState title="No funnel data" detail="Meta API returned no funnel metrics for this date range." />
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
          <StatusBadge label="Revenue" tone="violet" />
          <StatusBadge label="Spend" tone="info" />
        </>
      }
      title="Performance Trend"
      subtitle="Spend and revenue by day"
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
        <EmptyState title="No trend data" detail="Meta API returned no daily spend or revenue points for this date range." />
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
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search campaigns" />
          </label>
          <StatusBadge label="Active only" tone="neutral" />
        </div>
      }
      className="table-panel"
      collapsible
      headClassName="table-head"
      title="Campaign Performance"
      subtitle="Status, spend, CPA, ROAS, frequency and AI risk"
    >
      <div className="campaign-table-wrap">
        <div className="campaign-table" role="table" aria-label="Campaign performance">
          <div className="campaign-row header" role="row">
            <span>Campaign / Ad Set</span>
            <span>Status</span>
            <span>Budget</span>
            <span>Spend</span>
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
                  <small>Meta API synced · today · CTR {campaign.ctr}% · CPL {fmtMoney(campaign.cpl)}</small>
                </span>
                <StatusBadge label={campaign.status} tone={campaign.tone} />
                <span>{fmtMoney(campaign.budget)}</span>
                <span>{fmtMoney(campaign.spend)}</span>
                <span>{fmtMoney(campaign.cpa)}</span>
                <span>{campaign.roas.toFixed(1)}x</span>
                <span>{campaign.frequency.toFixed(1)}</span>
                <StatusBadge label={campaign.aiTag} tone={campaign.tone} />
              </button>
            ))
          ) : (
            <EmptyState title="No campaigns found" detail="Clear search or change the date range to review campaign delivery." />
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
      action={<StatusBadge label="Suggest only" tone="violet" />}
      className="ai-queue"
      collapsible
      title="AI Marketer Queue"
      subtitle="Pending review, guarded Meta write actions"
    >
      <div className="recommendation-list">
        {recommendations.length > 0 ? recommendations.map((rec, index) => {
          const state = recommendationStates[rec.id] ?? 'Suggested'
          const isFinal = state === 'Executed' || state === 'Rejected' || state === 'Failed'
          const isExecuting = state === 'Executing'

          return (
            <article className={`recommendation-card ${index === 0 ? 'primary' : ''}`} key={rec.id}>
              <div className="recommendation-badges">
                <StatusBadge label={state} tone={state === 'Rejected' || state === 'Failed' ? 'critical' : state === 'Executed' ? 'good' : 'watch'} />
                <StatusBadge label={`${rec.risk} risk`} tone={toneForRisk(rec.risk)} />
              </div>
              <h3>{rec.title}</h3>
              <p>{rec.evidence}</p>
              <strong>Guardrail: {rec.guardrail}</strong>
              {index === 0 ? <p>{rec.impact}</p> : null}
              <div className="recommendation-actions">
                {isFinal ? (
                  <StatusBadge label={state} tone={state === 'Executed' ? 'good' : 'critical'} />
                ) : (
                  <>
                    <button className="danger-button" type="button" onClick={() => onApprove(rec.id)} disabled={isExecuting}>
                      {isExecuting ? 'Executing...' : rec.risk === 'High' ? 'Review pause' : 'Review'}
                    </button>
                    <button className="outline-button" type="button" onClick={() => onReject(rec.id)} disabled={isExecuting}>
                      Reject
                    </button>
                  </>
                )}
                <span className="confidence">{rec.confidence}%</span>
              </div>
            </article>
          )
        }) : (
          <EmptyState title="No AI actions" detail="Meta API returned no guarded recommendations for this date range." />
        )}
      </div>
      <div className="state-legend">
        {['Suggested', 'Approved', 'Executing', 'Executed', 'Failed', 'Rejected', 'Audited'].map((state) => (
          <StatusBadge key={state} label={state} tone={state === 'Failed' || state === 'Rejected' ? 'critical' : state === 'Executed' || state === 'Audited' ? 'good' : 'neutral'} />
        ))}
      </div>
    </SectionCard>
  )
}

function AuditPanel({ auditTrail, compact = false }: { auditTrail: AuditEvent[]; compact?: boolean }) {
  return (
    <SectionCard
      className={`audit-panel ${compact ? 'compact' : ''}`}
      collapsible
      title="Recent Audit Trail"
      subtitle="Approvals, sync events and execution outcomes"
    >
      <div className="audit-list">
        {auditTrail.length > 0 ? (
          auditTrail.map((event) => (
            <div className="audit-row" key={event.id}>
              <StatusBadge label={event.action} tone={event.tone} />
              <strong>{event.detail}</strong>
              <span>{event.actor} · {event.time}</span>
            </div>
          ))
        ) : (
          <EmptyState title="No audit events" detail="Live sync and Meta write events will appear here after they occur." />
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
      setMutationMessage(`${objectTypeLabel(pendingMutation.objectType)} ${pendingMutation.kind === 'delete' ? 'deleted' : 'updated'} in Meta.`)
      setPendingMutation(null)
    } catch (error) {
      setMutationMessage(error instanceof Error ? error.message : 'Meta write failed')
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
        setMutationMessage('Budget must be at least 1 THB.')
        return
      }
      if (Math.round(budgetValue) !== Math.round(editTarget.currentBudget ?? 0)) {
        params.daily_budget = Math.round(budgetValue * 100)
      }
    }

    if (Object.keys(params).length === 0) {
      setMutationMessage('No changes to save.')
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
      setMutationMessage(`${objectTypeLabel(editTarget.objectType)} updated in Meta.`)
      setEditTarget(null)
    } catch (error) {
      setMutationMessage(error instanceof Error ? error.message : 'Meta edit failed')
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
      setMutationMessage('Sync state rechecked from Meta API.')
    } catch (error) {
      setMutationMessage(error instanceof Error ? error.message : 'Sync recheck failed')
    } finally {
      setIsReviewSyncing(false)
    }
  }

  return (
    <TwoColumnPage
      aside={
        <SectionCard collapsible title="Selected Campaign" subtitle="Live campaign detail from Meta API">
          {selectedCampaign ? (
            <div className="detail-stack">
              <StatusBadge label={deliveryLabel(selectedCampaign.deliveryStatus)} tone={deliveryTone(selectedCampaign.deliveryStatus)} />
              <h3>{selectedCampaign.name}</h3>
              <MetricLine label="Campaign ID" value={shortMetaId(selectedCampaign.id)} />
              <MetricLine label="Budget" value={fmtMoney(selectedCampaign.budget)} />
              <MetricLine label="Spend" value={fmtMoney(selectedCampaign.spend)} />
              <MetricLine label="Ad sets / Ads" value={`${selectedAdSets.length} / ${selectedAds.length}`} />
              <MetricLine label="Lead Quality" value={`${selectedCampaign.leadQuality}/100`} />
              <div className="campaign-detail-actions">
                <button className="outline-button" type="button" onClick={() => focusCampaign(selectedCampaign.id)}>
                  Open ad sets
                </button>
                <button className="outline-button" type="button" onClick={() => setReviewTarget('campaign')}>
                  Review campaign
                </button>
              </div>
            </div>
          ) : (
            <EmptyState title="No campaign selected" detail="Search returned no campaigns. Clear the query to select an active ad set." />
          )}
        </SectionCard>
      }
    >
      <SectionCard collapsible title="Ads Manager" subtitle="Campaign, Ad set and Ad controls synced from Meta">
        <div className="ads-manager-toolbar">
          <label className="search-box ads-search">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search campaigns, ad sets or ads" />
          </label>
          <button className="outline-button" type="button" onClick={() => setCompactView((value) => !value)}>
            {compactView ? 'ขยายข้อมูล' : 'ย่อข้อมูล'}
          </button>
          <StatusBadge label={`${campaigns.length} campaigns`} tone="neutral" />
          <StatusBadge label={`${adSets.length} ad sets`} tone="neutral" />
          <StatusBadge label={`${ads.length} ads`} tone="neutral" />
        </div>

        <div className="ads-summary-grid">
          <MetricLine label="Active campaigns" value={`${activeCampaigns}/${campaigns.length}`} />
          <MetricLine label="Active ad sets" value={`${activeAdSets}/${adSets.length}`} />
          <MetricLine label="Active ads" value={`${activeAds}/${ads.length}`} />
        </div>

        <div className="ads-type-legend" aria-label="Ads object type legend">
          <span><span className="ads-type-dot campaign" />Campaign</span>
          <span><span className="ads-type-dot adset" />Ad set</span>
          <span><span className="ads-type-dot ad" />Ad</span>
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
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} campaign ${campaign.name}`}
                        aria-controls={isCollapsed ? undefined : campaignChildrenId}
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleCampaign(campaign.id)}
                      >
                        <CampaignIcon size={16} />
                      </button>
                    )}
                    <button className="ads-entity-main" type="button" onClick={() => openCampaign(campaign.id)}>
                      <span className="ads-kind-line">
                        <span className="ads-type-badge campaign">Campaign</span>
                        <span className="ads-object-id">{shortMetaId(campaign.id)}</span>
                      </span>
                      <strong>{campaign.name}</strong>
                      <span>{campaignAdSets.length} ad sets · {campaignAds.length} ads</span>
                    </button>
                    <StatusBadge label={deliveryLabel(campaign.deliveryStatus)} tone={deliveryTone(campaign.deliveryStatus)} />
                    {!compactView ? (
                      <div className="ads-entity-metrics">
                        <span>{fmtMoney(campaign.spend)} spend</span>
                        <span>{campaign.roas.toFixed(2)}x ROAS</span>
                        <span>{fmtMoney(campaign.budget)} budget</span>
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
                                    aria-label={`${isAdSetCollapsed ? 'Expand' : 'Collapse'} ad set ${adSet.name}`}
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
                                    <span className="ads-type-badge adset">Ad set</span>
                                    <span className="ads-object-id">{shortMetaId(adSet.id)}</span>
                                  </span>
                                  <strong>{adSet.name}</strong>
                                  <span>{adSetAds.length} ads · {adSet.audience}</span>
                                </div>
                                <StatusBadge label={deliveryLabel(adSet.deliveryStatus)} tone={deliveryTone(adSet.deliveryStatus)} />
                                {!compactView ? (
                                  <div className="ads-entity-metrics">
                                    <span>{fmtMoney(adSet.spend)} spend</span>
                                    <span>{adSet.roas.toFixed(2)}x ROAS</span>
                                    <span>{fmtMoney(adSet.budget)} budget</span>
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
                                          <span className="ads-type-badge ad">Ad</span>
                                          <span className="ads-object-id">{shortMetaId(ad.id)}</span>
                                        </span>
                                        <strong>{ad.name}</strong>
                                        <span>{ad.creative}</span>
                                      </div>
                                      <StatusBadge label={deliveryLabel(ad.status)} tone={deliveryTone(ad.status)} />
                                      {!compactView ? (
                                        <div className="ads-entity-metrics">
                                          <span>{fmtMoney(ad.spend)} spend</span>
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
                        <EmptyState title="No ad sets" detail="Meta returned no ad sets for this campaign." />
                      )}
                    </div>
                  ) : null}
                </article>
              )
            })
          ) : (
            <EmptyState title="No Meta objects found" detail="Clear search or sync the workspace again to load campaigns, ad sets and ads." />
          )}
        </div>
      </SectionCard>
      <div className="split-grid">
        <StatePanel
          collapsible
          actionLabel="Open sync review"
          state="Live Synced"
          detail="Campaign, ad set and ad insight data are ready for review."
          tone="good"
          onAction={() => setReviewTarget('live')}
        />
        <StatePanel
          collapsible
          actionLabel={isReviewSyncing ? 'Rechecking...' : 'Recheck sync'}
          disabled={isReviewSyncing}
          state="Stale Sync"
          detail="If freshness exceeds the limit, Meta write actions require recheck."
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
  const title = isCampaignReview ? 'Selected campaign workflow' : isStaleReview ? 'Stale sync recheck' : 'Live sync review'
  const tone: Tone = isCampaignReview ? (selectedCampaign ? deliveryTone(selectedCampaign.deliveryStatus) : 'neutral') : isStaleReview ? 'watch' : 'good'
  const statusLabel = isCampaignReview
    ? selectedCampaign
      ? deliveryLabel(selectedCampaign.deliveryStatus)
      : 'No campaign'
    : isStaleReview
      ? 'Recheck required'
      : 'Ready'
  const detail = isCampaignReview
    ? 'Use this panel to review the currently selected campaign and jump back to its ad sets in the hierarchy.'
    : isStaleReview
      ? 'Run a fresh Meta API sync before making write decisions when the data freshness is unclear.'
      : 'The Ads Manager data model is loaded and separated into Campaign, Ad set and Ad records.'
  const checks = isCampaignReview
    ? [
        { label: 'Campaign selected', value: selectedCampaign ? selectedCampaign.name : 'No campaign selected' },
        { label: 'Ad sets under campaign', value: `${selectedAdSets} ad sets` },
        { label: 'Ads under campaign', value: `${selectedAds} ads` },
      ]
    : [
        { label: 'Campaign rows', value: `${campaignsCount} total · ${activeCampaigns} active` },
        { label: 'Ad set rows', value: `${adSetsCount} total · ${activeAdSets} active` },
        { label: 'Ad rows', value: `${adsCount} total · ${activeAds} active` },
      ]

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal review-modal" role="dialog" aria-modal="true" aria-labelledby="ads-review-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close review">
          <X size={18} />
        </button>
        <StatusBadge label={statusLabel} tone={tone} />
        <h2 id="ads-review-title">{title}</h2>
        <p>{detail}</p>

        <div className="confirm-grid review-grid">
          {isCampaignReview && selectedCampaign ? (
            <>
              <MetricLine label="Campaign ID" value={shortMetaId(selectedCampaign.id)} />
              <MetricLine label="Budget" value={fmtMoney(selectedCampaign.budget)} />
              <MetricLine label="Spend" value={fmtMoney(selectedCampaign.spend)} />
              <MetricLine label="ROAS" value={`${selectedCampaign.roas.toFixed(2)}x`} />
              <MetricLine label="Lead Quality" value={`${selectedCampaign.leadQuality}/100`} />
            </>
          ) : (
            <>
              <MetricLine label="Campaigns" value={`${campaignsCount}`} />
              <MetricLine label="Ad sets" value={`${adSetsCount}`} />
              <MetricLine label="Ads" value={`${adsCount}`} />
              <MetricLine label="Active objects" value={`${activeCampaigns + activeAdSets + activeAds}`} />
            </>
          )}
        </div>

        <div className="review-check-list" aria-label="Review checklist">
          {checks.map((check) => (
            <div className="review-check-row" key={check.label}>
              <span>{check.label}</span>
              <strong>{check.value}</strong>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onClose}>
            Close
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
              Open ad sets
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={() => void onRecheck()} disabled={isSyncing}>
              {isSyncing ? 'Rechecking...' : 'Run Meta recheck'}
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
        title={nextStatus === 'PAUSED' ? 'Pause in Meta' : 'Activate in Meta'}
        aria-label={nextStatus === 'PAUSED' ? `Pause ${objectName}` : `Activate ${objectName}`}
        onClick={() => onStatusChange(objectType, objectId, objectName, currentStatus)}
      >
        <Power size={15} />
      </button>
      <button
        className="icon-action"
        type="button"
        title="Edit name or budget"
        aria-label={`Edit ${objectName}`}
        onClick={() => onEdit({ objectType, objectId, objectName, currentBudget: budget })}
      >
        <Pencil size={15} />
      </button>
      <button
        className="icon-action danger"
        type="button"
        title="Delete in Meta"
        aria-label={`Delete ${objectName}`}
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
  const actionLabel = isDelete ? 'Delete in Meta' : mutation.nextStatus === 'ACTIVE' ? 'Activate in Meta' : 'Pause in Meta'
  const targetStatus = mutation.kind === 'status' ? mutation.nextStatus : 'Deleted'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ads-mutation-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="Close confirmation" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={isDelete ? 'Destructive Meta write' : 'Real Meta write'} tone="critical" />
        <h2 id="ads-mutation-title">{actionLabel}</h2>
        <p>
          This will execute against the live Meta object. Review the scope before continuing.
          {isDelete ? ' Delete is destructive and may remove the object from delivery history workflows.' : ''}
        </p>
        <div className="confirm-grid">
          <MetricLine label="Object" value={mutation.objectName} />
          <MetricLine label="Type" value={objectTypeLabel(mutation.objectType)} />
          <MetricLine label="Meta ID" value={mutation.objectId} />
          <MetricLine label="Requested state" value={targetStatus} />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onConfirm} disabled={isExecuting}>
            {isExecuting ? 'Executing...' : actionLabel}
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
        <button className="modal-close" type="button" onClick={onCancel} aria-label="Close editor" disabled={isSaving}>
          <X size={18} />
        </button>
        <StatusBadge label="Edit Meta object" tone="watch" />
        <h2 id="ads-edit-title">Edit {objectTypeLabel(target.objectType)}</h2>
        <p>Changes are written to Meta after confirmation. Budget is sent as daily_budget in THB.</p>
        <div className="ads-edit-form">
          <label>
            <span>Name</span>
            <input value={editName} onChange={(event) => setEditName(event.target.value)} />
          </label>
          {canEditBudget ? (
            <label>
              <span>Daily budget (THB)</span>
              <input inputMode="numeric" value={editBudget} onChange={(event) => setEditBudget(event.target.value)} placeholder="Leave blank to keep current" />
            </label>
          ) : null}
        </div>
        <div className="confirm-grid">
          <MetricLine label="Object ID" value={target.objectId} />
          <MetricLine label="Type" value={objectTypeLabel(target.objectType)} />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={onSave} disabled={isSaving}>
            <Pencil size={14} />
            {isSaving ? 'Saving...' : 'Save to Meta'}
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
        .slice(0, 5),
    [scoredAds],
  )
  const weakAds = useMemo(
    () =>
      scoredAds
        .slice()
        .sort((a, b) => a.score - b.score || a.roas - b.roas || b.spend - a.spend)
        .slice(0, 5),
    [scoredAds],
  )

  return (
    <TwoColumnPage aside={<AuditPanel auditTrail={auditTrail} />}>
      <SectionCard collapsible title="AI Ad Signal" subtitle="Ads ที่ดีและแย่จาก AI score ของ Meta ad insights">
        <div className="ai-ad-signal-grid">
          <AiAdSignalColumn
            ads={topAds}
            emptyDetail="Meta API ยังไม่มี ads ที่มี insight พอให้จัดอันดับฝั่งดี"
            title="Ads ที่ดี"
            tone="good"
            type="good"
          />
          <AiAdSignalColumn
            ads={weakAds}
            emptyDetail="Meta API ยังไม่มี ads ที่มี insight พอให้จัดอันดับฝั่งแย่"
            title="Ads ที่แย่"
            tone="critical"
            type="bad"
          />
        </div>
      </SectionCard>
      <AiQueue onApprove={onApprove} onReject={onReject} recommendations={recommendations} recommendationStates={recommendationStates} />
      <SectionCard collapsible title="Two-step Meta write safety" subtitle="High-risk changes cannot execute with one click">
        <div className="process-grid">
          {['Suggested', 'Pending approval', 'Confirming scope', 'Executing', 'Executed or Failed', 'Audited'].map((step, index) => (
            <div className="process-step" key={step}>
              <span>{index + 1}</span>
              <strong>{step}</strong>
              <p>{index === 2 ? 'Show campaign/ad set ID, change, guardrail and rollback.' : 'State is visible to the operator.'}</p>
            </div>
          ))}
        </div>
      </SectionCard>
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
        <span>{ads.length} ads</span>
      </div>
      <div className="ai-ad-list">
        {ads.length > 0 ? (
          ads.map((ad) => <AiAdSignalCard ad={ad} key={`${type}-${ad.id}`} type={type} />)
        ) : (
          <EmptyState title="No AI ad signals" detail={emptyDetail} />
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
      ? 'AI ให้คะแนนสูงจาก ROAS, CTR และ conversion signal'
      : ad.roas >= 1.5
        ? 'ROAS ดีกว่ากลุ่ม watch เหมาะกับการเฝ้าดูเพื่อ scale'
        : 'มี engagement signal ที่ดีกว่า ads ส่วนใหญ่ในชุดข้อมูล'
    : ad.bookings === 0 && ad.spend > 0
      ? 'มี spend แต่ยังไม่มี tracked booking/conversion'
      : ad.roas > 0 && ad.roas < 1
        ? 'ROAS ต่ำกว่า guardrail ต้องตรวจ offer หรือ creative'
        : 'AI score ต่ำกว่ากลุ่มอื่น ควรตรวจ creative, audience และ tracking'
  const nextAction = isGood
    ? 'Keep / test staged scale'
    : ad.bookings === 0
      ? 'Review tracking before spending more'
      : 'Refresh creative or reduce exposure'

  return (
    <article className="ai-ad-card">
      <div className="ai-ad-card-head">
        <StatusBadge label={`AI score ${ad.score.toFixed(1)}`} tone={isGood ? 'good' : 'critical'} />
        <StatusBadge label={deliveryLabel(ad.status)} tone={deliveryTone(ad.status)} />
      </div>
      <h3>{ad.name}</h3>
      <p>{ad.creative}</p>
      <div className="ai-ad-metrics">
        <MetricLine label="Spend" value={fmtMoney(ad.spend)} />
        <MetricLine label="ROAS" value={`${ad.roas.toFixed(2)}x`} />
        <MetricLine label="CTR" value={`${ad.ctr.toFixed(2)}%`} />
        <MetricLine label="Bookings" value={fmtNum(ad.bookings)} />
        <MetricLine label="CPA" value={ad.bookings > 0 ? fmtMoney(cpa) : 'No booking'} />
      </div>
      <strong>{reason}</strong>
      <span>{nextAction}</span>
    </article>
  )
}

function OptimizationPage({ automationMode, campaigns, onModeChange }: { automationMode: string; campaigns: Campaign[]; onModeChange: (value: string) => void }) {
  const [scaleCap, setScaleCap] = useState(12)

  return (
    <TwoColumnPage
      aside={
        <AssistantPanel
          title="Guardrail assistant"
          text="Optimization stays in Suggest only until each Meta write action is reviewed and confirmed."
        />
      }
    >
      <SectionCard title="Automation Mode" subtitle="Every rule remains approval-gated">
        <div className="form-grid">
          <label>
            Mode
            <select value={automationMode} onChange={(event) => onModeChange(event.target.value)}>
              <option>Suggest only</option>
              <option>Approval required</option>
              <option>Paused automation</option>
            </select>
          </label>
          <label>
            Scale cap per change
            <input min={5} max={25} type="number" value={scaleCap} onChange={(event) => setScaleCap(Number(event.target.value))} />
          </label>
        </div>
      </SectionCard>
      <SectionCard collapsible title="Optimization Rules" subtitle="Rules use campaign evidence and clinic outcome checks">
        <div className="rule-list">
          {campaigns.length > 0 ? (
            campaigns.map((campaign) => (
              <div className="rule-row" key={campaign.id}>
                <StatusBadge label={campaign.aiTag} tone={campaign.tone} />
                <strong>{campaign.name}</strong>
                <span>Rule: {campaign.roas < 1 ? 'pause candidate' : campaign.roas > 3 ? `scale max ${scaleCap}%` : 'watch quality'}</span>
                <button className="outline-button" type="button">Review rule</button>
              </div>
            ))
          ) : (
            <EmptyState title="No live campaigns" detail="Optimization rules appear after Meta campaigns sync successfully." />
          )}
        </div>
      </SectionCard>
    </TwoColumnPage>
  )
}

function CreativeStudioPage({ components }: { components: WorkspaceData['insightComponents'] }) {
  return (
    <TwoColumnPage
      aside={
        <AssistantPanel
          title="Creative helper"
          text="Use winning proof, refreshed hooks and compliance-safe copy before changing budget."
        />
      }
    >
      <SectionCard collapsible title="Creative Performance" subtitle="Winner and refresh candidates by service line">
        <div className="card-grid">
          {components.length > 0 ? (
            components.map((asset) => (
              <article className="mini-card" key={asset.id}>
                <StatusBadge label={`Score ${asset.score.toFixed(1)}`} tone={asset.tone} />
                <h3>{asset.title}</h3>
                <p>{asset.service}</p>
                <MetricLine label="CTR" value={`${asset.ctr.toFixed(2)}%`} />
                <MetricLine label="Cost / Result" value={fmtMoney(asset.costPerResult)} />
              </article>
            ))
          ) : (
            <EmptyState title="No creative data" detail="Creative performance cards appear after Meta ads and insights sync successfully." />
          )}
        </div>
      </SectionCard>
      <StatePanel state={`${components.length} live creatives`} detail="Creative records come from synced Meta ads and insight rows." tone={components.length > 0 ? 'info' : 'neutral'} />
    </TwoColumnPage>
  )
}

function AudienceInsightsPage({ adSets }: { adSets: WorkspaceData['adSets'] }) {
  return (
    <TwoColumnPage
      aside={<StatePanel state="Audience data" detail="Segments are built from live Meta ad set targeting and insight rows." tone={adSets.length > 0 ? 'good' : 'neutral'} />}
    >
      <SectionCard collapsible title="Audience Segments" subtitle="Segments connected to clinic funnel outcomes">
        <div className="audience-table">
          {adSets.length > 0 ? (
            adSets.map((adSet) => (
              <div className="audience-row" key={adSet.id}>
                <strong>{adSet.audience || adSet.name}</strong>
                <span>{fmtMoney(adSet.spend)} spend</span>
                <span>{fmtNum(adSet.bookings)} bookings</span>
                <StatusBadge label={adSet.status} tone={toneForAiStatus(adSet.status)} />
                <span>{fmtMoney(adSet.cpa)} CPA</span>
              </div>
            ))
          ) : (
            <EmptyState title="No audience data" detail="Audience rows appear after live ad set targeting syncs from Meta." />
          )}
        </div>
      </SectionCard>
      <AudienceChart adSets={adSets} />
    </TwoColumnPage>
  )
}

function AudienceChart({ adSets }: { adSets: WorkspaceData['adSets'] }) {
  const chartData = adSets.map((adSet) => ({
    name: adSet.audience || adSet.name,
    spend: Math.round(adSet.spend),
    bookings: adSet.bookings,
  }))

  return (
    <SectionCard collapsible title="Segment Volume" subtitle="Spend and bookings by live ad set audience">
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
        <EmptyState title="No segment chart" detail="Live ad set spend and booking volume will render here after sync." />
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
      aside={<StatePanel state="Compliance Watch" detail="Medical claims must be reviewed before launch." tone="watch" />}
    >
      <SectionCard collapsible title="Ad Library" subtitle="Creative assets, compliance risk and launch readiness">
        <div className="card-grid">
          {reviews.length > 0 ? (
            reviews.map((review) => (
              <article className="asset-card" key={review.id}>
                <div className="asset-thumb">
                  <ImageIcon size={24} />
                </div>
                <h3>{review.title}</h3>
                <p>{review.issue || review.fix || review.service}</p>
                <StatusBadge label={review.status} tone={toneForComplianceStatus(review.status)} />
              </article>
            ))
          ) : (
            <EmptyState title="No ad library data" detail="Creative compliance cards appear after Meta ad records sync successfully." />
          )}
        </div>
      </SectionCard>
    </TwoColumnPage>
  )
}

function ReportsPage({ auditTrail, preparedReport, setPreparedReport }: { auditTrail: AuditEvent[]; preparedReport: boolean; setPreparedReport: (value: boolean) => void }) {
  return (
    <TwoColumnPage
      aside={<AssistantPanel title="Report assistant" text="Reports include API freshness, live metrics, and before/after action context." />}
    >
      <SectionCard collapsible title="Report Builder" subtitle="Prepare a review-ready operating report">
        <div className="report-preview">
          <StatusBadge label={preparedReport ? 'Ready' : 'Draft'} tone={preparedReport ? 'good' : 'neutral'} />
          <h3>{preparedReport ? 'Maximum history report is ready' : 'Prepare a report from Analytics'}</h3>
          <p>Includes spend, revenue, ROAS, clinic funnel, AI actions, and audit trail.</p>
          <button className="primary-button" type="button" onClick={() => setPreparedReport(true)}>
            Prepare report
          </button>
        </div>
      </SectionCard>
      <AuditPanel auditTrail={auditTrail} />
    </TwoColumnPage>
  )
}

function SettingsPage({ dataState, metaInfo, onSync, syncState }: { dataState: DataSourceState; metaInfo: MetaInfo | null; onSync: () => void; syncState: string }) {
  const account = metaInfo?.accountName ?? 'Meta API not connected'
  const [accessToken, setAccessToken] = useState('')
  const [adAccountId, setAdAccountId] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const isSyncing = syncState === 'Syncing...'
  const stateTone: Tone = dataState === 'live' ? 'good' : dataState === 'error' ? 'critical' : dataState === 'loading' ? 'info' : 'watch'
  const dataModeLabel =
    dataState === 'live'
      ? 'Live synced'
      : dataState === 'loading'
        ? 'Syncing'
        : dataState === 'empty'
          ? 'No data'
          : dataState === 'setup-required'
            ? 'Setup required'
            : 'Sync error'

  const saveMetaConfig = async () => {
    setIsSavingConfig(true)
    setSettingsMessage('Saving Meta API config...')
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
      setSettingsMessage('Meta API config saved. Syncing live workspace...')
      setAccessToken('')
      onSync()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'Meta API config save failed')
    } finally {
      setIsSavingConfig(false)
    }
  }

  return (
    <TwoColumnPage
      aside={<StatePanel collapsible state={syncState} detail={`${metaInfo?.source ?? 'Meta Marketing API'} · ${metaInfo?.graphVersion ?? 'waiting for config'}`} tone={stateTone} />}
    >
      <SectionCard collapsible title="Workspace Settings" subtitle="Meta connection and data-source readiness">
        <div className="form-grid">
          <label>
            Display account
            <input value={account} readOnly />
          </label>
          <label>
            Meta Ad Account ID
            <input value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)} placeholder="act_1234567890" />
          </label>
          <label>
            Access Token
            <input value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Long-lived or system user token" type="password" />
          </label>
          <label>
            Data mode
            <select value={dataModeLabel} disabled>
              <option>Live synced</option>
              <option>Syncing</option>
              <option>No data</option>
              <option>Setup required</option>
              <option>Sync error</option>
            </select>
          </label>
          <button className="primary-button" type="button" onClick={onSync} disabled={isSyncing}>
            {isSyncing ? 'Checking...' : 'Check connection'}
          </button>
          <button className="outline-button" type="button" onClick={saveMetaConfig} disabled={isSavingConfig || (!accessToken && !adAccountId)}>
            {isSavingConfig ? 'Saving...' : 'Save Meta API config'}
          </button>
        </div>
        {settingsMessage ? <p className="settings-message">{settingsMessage}</p> : null}
      </SectionCard>
      <div className="split-grid">
        <StatePanel collapsible state="Setup Required" detail="Shown when API credentials or ad account are missing." tone="watch" />
        <StatePanel collapsible state="No Data" detail="Shown when the selected date range has no campaigns or clinic funnel records." tone="neutral" />
        <StatePanel collapsible state="Disconnected" detail="Shown when Meta authentication fails; write actions stay disabled until reconnect." tone="critical" />
        <StatePanel
          collapsible
          actionLabel={isSyncing ? 'Retrying...' : 'Retry sync'}
          detail="Shown when the API returns a failed refresh; retry sync from this page before review."
          disabled={isSyncing}
          onAction={onSync}
          state="Sync Error"
          tone="critical"
        />
      </div>
    </TwoColumnPage>
  )
}

function HelpCenterPage() {
  return (
    <TwoColumnPage
      aside={<AssistantPanel title="PMC assistant" text="The mascot is decorative. It never replaces approval, risk or state text." />}
    >
      <SectionCard collapsible title="Help Center" subtitle="Operating playbook for daily clinic ads review">
        <div className="help-list">
          {[
            ['Daily review', 'Check KPI row, funnel drop-off, campaign table and AI queue.'],
            ['Before approving a write action', 'Confirm object scope, evidence, guardrail, expected impact and rollback.'],
            ['When data is stale', 'Sync workspace before trusting AI recommendations.'],
            ['When no data exists', 'Change date range or review Settings connection state.'],
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
      <StatusBadge label="Suggest only" tone="violet" />
    </section>
  )
}

function StatePanel({
  actionLabel = 'Review state',
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
  const objectTypeLabel = execution ? { campaign: 'Campaign', adset: 'Ad set', ad: 'Ad' }[execution.objectType] : 'Review only'
  const targetLabel = targetCampaign?.name ?? (execution ? `${objectTypeLabel} ${execution.objectId}` : 'Workspace action')
  const requestedStatus = execution?.status ?? (execution?.operation ? 'Update object' : 'Review only')

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="Close confirmation" disabled={isExecuting}>
          <X size={18} />
        </button>
        <StatusBadge label={execution ? 'Real Meta write' : 'Review confirmation'} tone={execution ? 'critical' : 'watch'} />
        <h2 id="confirm-title">{recommendation.action}</h2>
        <div className="confirm-grid">
          <MetricLine label="Campaign / Target" value={targetLabel} />
          <MetricLine label="Object type" value={objectTypeLabel} />
          <MetricLine label="Current delivery" value={targetCampaign?.status ?? 'Review only'} />
          <MetricLine label="Requested status" value={requestedStatus} />
          <MetricLine label="Rollback" value="Available after execution" />
        </div>
        <div className="modal-actions">
          <button className="outline-button" type="button" onClick={onCancel} disabled={isExecuting}>
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onConfirm} disabled={isExecuting}>
            {isExecuting ? 'Executing...' : 'Confirm in Meta'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default App
