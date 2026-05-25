import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  FileText,
  Grid2X2,
  InfinityIcon,
  MessageCircle,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fetchHomeSnapshot, fetchHomeStatusSnapshot, initialHomeSnapshot } from './api'
import {
  checkHomeAiSettings,
  fetchHomeSettings,
  saveHomeAiSettings,
  saveHomeMetaSettings,
  type HomeAiConfigState,
  type HomeMetaConfigState,
  type HomeSettingsState,
} from './settingsApi'
import type { HomePriority, HomeSnapshot, HomeStatusState, HomeTool } from './types'
import './styles.css'

const toolIcons: Record<HomeTool['id'], LucideIcon> = {
  ads: InfinityIcon,
  crm: Users,
  erp: Building2,
  knowledge: BookOpen,
  page: MessageCircle,
  reports: BarChart3,
  settings: Settings,
  website: Activity,
}

const adsLogoSrc = '/pmc-ads-logo.png?v=transparent'
const pageAutoLogoSrc = '/pmc-page-auto-logo.png?v=transparent'

const appDescriptions: Record<HomeTool['id'], string> = {
  ads: 'ดูภาพรวมโฆษณาและคำแนะนำก่อนอนุมัติ',
  crm: 'ดูข้อมูลลูกค้า งานติดตาม และโอกาสการขาย',
  erp: 'จัดการงานปฏิบัติการ สต็อก เอกสาร และงานหลังบ้าน',
  knowledge: 'ค้นหาเอกสารองค์กรและฐานความรู้สำหรับ AI',
  page: 'จัดการโพสต์ ข้อความทุกเพจ วิเคราะห์เพจ และรายงาน',
  reports: 'สรุปผลและรายงาน',
  settings: 'ตั้งค่า Meta, AI และการเชื่อมต่อ',
  website: 'ดูพฤติกรรมผู้ใช้งานเว็บไซต์และเส้นทางก่อนติดต่อ',
}

export function HomeApp() {
  const [snapshot, setSnapshot] = useState<HomeSnapshot>(initialHomeSnapshot)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<HomeSettingsState>({ ai: null, meta: null })
  const [isSettingsLoading, setIsSettingsLoading] = useState(false)
  const [savingTarget, setSavingTarget] = useState<'ai' | 'ai-check' | 'meta' | null>(null)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [metaForm, setMetaForm] = useState({ accessToken: '', adAccountId: '', workspaceLabel: '' })
  const [aiForm, setAiForm] = useState({ apiKey: '', maxOutputTokens: '2800', model: 'gpt-5.5' })
  const primarySuggestion = snapshot.priorities[0]

  const refreshHomeSnapshot = useCallback(async () => {
    try {
      const statusSnapshot = await fetchHomeStatusSnapshot()
      setSnapshot(statusSnapshot)

      const nextSnapshot = await fetchHomeSnapshot()
      setSnapshot(nextSnapshot)
    } catch {
      // Keep the conservative loading state when the local API is unavailable.
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setIsSettingsLoading(true)
    try {
      const nextSettings = await fetchHomeSettings()
      const activeWorkspace = nextSettings.meta?.workspaces?.find((workspace) => workspace.active)
      setSettings(nextSettings)
      setMetaForm((current) => ({
        accessToken: '',
        adAccountId: current.adAccountId.includes('...') ? '' : current.adAccountId,
        workspaceLabel: nextSettings.meta?.workspaceLabel ?? activeWorkspace?.label ?? current.workspaceLabel,
      }))
      setAiForm((current) => ({
        apiKey: '',
        maxOutputTokens: String(nextSettings.ai?.maxOutputTokens ?? current.maxOutputTokens ?? 2800),
        model: nextSettings.ai?.model ?? current.model ?? 'gpt-5.5',
      }))
      const loadErrors = [nextSettings.metaError, nextSettings.aiError].filter(Boolean).join(' · ')
      setSettingsMessage(loadErrors ? `โหลดบางสถานะไม่สำเร็จ: ${loadErrors}` : '')
    } finally {
      setIsSettingsLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function loadHome() {
      try {
        const statusSnapshot = await fetchHomeStatusSnapshot()
        if (!active) return
        setSnapshot(statusSnapshot)

        const nextSnapshot = await fetchHomeSnapshot()
        if (active) setSnapshot(nextSnapshot)
      } catch {
        // Keep the conservative loading state when the local API is unavailable.
      }
    }

    void loadHome()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!isSettingsOpen) return undefined

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsSettingsOpen(false)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isSettingsOpen])

  const openSettings = async () => {
    setIsSettingsOpen(true)
    await loadSettings()
  }

  const saveMetaSettings = async () => {
    setSavingTarget('meta')
    setSettingsMessage('กำลังบันทึก Meta API Key...')
    try {
      const nextMeta = await saveHomeMetaSettings(metaForm)
      setSettings((current) => ({ ...current, meta: nextMeta, metaError: undefined }))
      setMetaForm((current) => ({ ...current, accessToken: '' }))
      setSettingsMessage('บันทึก Meta API แล้ว ค่านี้จะใช้ร่วมกับทุก App ที่อ่านข้อมูลจาก Meta')
      await refreshHomeSnapshot()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'บันทึก Meta API ไม่สำเร็จ')
    } finally {
      setSavingTarget(null)
    }
  }

  const saveAiSettings = async () => {
    setSavingTarget('ai')
    setSettingsMessage('กำลังบันทึก AI API Key...')
    try {
      const nextAi = await saveHomeAiSettings({
        apiKey: aiForm.apiKey,
        maxOutputTokens: Number(aiForm.maxOutputTokens || 2800),
        model: aiForm.model,
      })
      setSettings((current) => ({ ...current, ai: nextAi, aiError: undefined }))
      setAiForm((current) => ({ ...current, apiKey: '' }))
      setSettingsMessage('บันทึก AI API แล้ว ค่านี้จะใช้ร่วมกับ AI Priorities, Knowledge และ App ที่ใช้ AI')
      await refreshHomeSnapshot()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'บันทึก AI API ไม่สำเร็จ')
    } finally {
      setSavingTarget(null)
    }
  }

  const checkAiSettings = async () => {
    setSavingTarget('ai-check')
    setSettingsMessage('กำลังตรวจสถานะ AI API...')
    try {
      const nextAi = await checkHomeAiSettings()
      setSettings((current) => ({ ...current, ai: nextAi, aiError: undefined }))
      setSettingsMessage(`AI API พร้อมใช้งาน · ${nextAi.model ?? aiForm.model}`)
      await refreshHomeSnapshot()
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'ตรวจสถานะ AI API ไม่สำเร็จ')
    } finally {
      setSavingTarget(null)
    }
  }

  const canSaveMeta = Boolean(metaForm.accessToken || metaForm.adAccountId || settings.meta?.hasSavedToken)
  const canSaveAi = Boolean(aiForm.apiKey || settings.ai?.hasSavedApiKey || settings.ai?.configured)

  return (
    <div className="home-shell">
      <header className="home-header">
        <a className="home-brand" href="/" aria-label="PMC Home">
          <span className="home-brand-logo-wrap">
            <img src="/promedclinicpmc-logo.png" alt="PMC" />
          </span>
          <span>
            <strong>PMC Home</strong>
            <small>ศูนย์รวม App</small>
          </span>
        </a>

        <div className="home-header-controls">
          <div className="home-status-chips" aria-label="สถานะการเชื่อมต่อ">
            {snapshot.headerStatuses.map((status) => (
              <StatusChip key={status.id} label={status.label} state={status.state} value={status.value} />
            ))}
          </div>
          <button
            className="home-settings-button"
            type="button"
            aria-expanded={isSettingsOpen}
            aria-haspopup="dialog"
            onClick={() => void openSettings()}
          >
            <Settings size={18} />
            ตั้งค่า API Key
          </button>
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero" aria-label="PMC app launcher">
          <div>
            <p className="home-kicker">เริ่มงานของคุณที่นี่</p>
            <h1>เลือก App เพื่อเริ่มงาน</h1>
            <p>เข้าสู่ระบบที่ต้องใช้วันนี้ ดูสถานะการเชื่อมต่อ และเปิด App ที่เกี่ยวข้องกับงานของคุณได้จากหน้านี้</p>
          </div>
          {primarySuggestion ? <SuggestionCard priority={primarySuggestion} /> : null}
        </section>

        <section className="home-apps-section" aria-label="เลือก App">
          <div className="home-section-head">
            <Grid2X2 size={24} />
            <div>
              <h2>App ทั้งหมด</h2>
              <p>เลือกงานที่ต้องการทำ แล้วเปิด App ที่เกี่ยวข้อง</p>
            </div>
          </div>
          <div className="home-app-grid">
            {snapshot.tools.map((tool) => <AppCard key={tool.id} tool={tool} />)}
          </div>
        </section>

        <section className="home-ai-note" aria-label="AI safety note">
          <Sparkles size={19} />
          <div>
            <strong>AI ช่วยแนะนำเท่านั้น</strong>
            <p>ระบบจะแสดงเป็นคำแนะนำ คุณเป็นผู้กดอนุมัติหรือดำเนินการขั้นสำคัญเองเสมอ</p>
          </div>
        </section>
      </main>
      {isSettingsOpen ? (
        <HomeSettingsModal
          aiForm={aiForm}
          canSaveAi={canSaveAi}
          canSaveMeta={canSaveMeta}
          isLoading={isSettingsLoading}
          metaForm={metaForm}
          message={settingsMessage}
          onAiFormChange={setAiForm}
          onCheckAi={() => void checkAiSettings()}
          onClose={() => setIsSettingsOpen(false)}
          onMetaFormChange={setMetaForm}
          onRefresh={() => void loadSettings()}
          onSaveAi={() => void saveAiSettings()}
          onSaveMeta={() => void saveMetaSettings()}
          savingTarget={savingTarget}
          settings={settings}
        />
      ) : null}
    </div>
  )
}

type HomeSettingsModalProps = {
  aiForm: { apiKey: string; maxOutputTokens: string; model: string }
  canSaveAi: boolean
  canSaveMeta: boolean
  isLoading: boolean
  message: string
  metaForm: { accessToken: string; adAccountId: string; workspaceLabel: string }
  onAiFormChange: (form: { apiKey: string; maxOutputTokens: string; model: string }) => void
  onCheckAi: () => void
  onClose: () => void
  onMetaFormChange: (form: { accessToken: string; adAccountId: string; workspaceLabel: string }) => void
  onRefresh: () => void
  onSaveAi: () => void
  onSaveMeta: () => void
  savingTarget: 'ai' | 'ai-check' | 'meta' | null
  settings: HomeSettingsState
}

function HomeSettingsModal({
  aiForm,
  canSaveAi,
  canSaveMeta,
  isLoading,
  message,
  metaForm,
  onAiFormChange,
  onCheckAi,
  onClose,
  onMetaFormChange,
  onRefresh,
  onSaveAi,
  onSaveMeta,
  savingTarget,
  settings,
}: HomeSettingsModalProps) {
  const activeWorkspace = settings.meta?.workspaces?.find((workspace) => workspace.active)

  return (
    <div className="home-settings-backdrop">
      <section className="home-settings-modal" role="dialog" aria-modal="true" aria-labelledby="home-settings-title">
        <button className="home-settings-close" type="button" onClick={onClose} aria-label="ปิดหน้าตั้งค่า">
          <X size={19} />
        </button>

        <div className="home-settings-head">
          <span className="home-settings-icon">
            <Settings size={24} />
          </span>
          <div>
            <p>ตั้งค่ากลางขององค์กร</p>
            <h2 id="home-settings-title">API Key สำหรับทุก App</h2>
            <span>ค่าที่บันทึกจากหน้านี้จะถูกใช้โดย Ads Agent, Page Automation, Knowledge และ App ที่เพิ่มต่อไป</span>
          </div>
        </div>

        <div className="home-settings-status" aria-label="สถานะ API">
          <ApiStatusLine label="Meta API" state={settings.meta?.connected ? 'connected' : settings.meta?.configured ? 'unavailable' : 'setup'} value={metaStatusLabel(settings.meta)} />
          <ApiStatusLine label="AI API" state={settings.ai?.connected ? 'connected' : settings.ai?.configured ? 'unavailable' : 'setup'} value={aiStatusLabel(settings.ai)} />
          <ApiStatusLine label="Knowledge" state={settings.ai?.connected ? 'ready' : 'setup'} value={settings.ai?.connected ? 'พร้อมใช้งาน' : 'รอ AI API'} />
        </div>

        <div className="home-settings-grid">
          <section className="home-settings-card" aria-label="ตั้งค่า Meta API">
            <div className="home-settings-card-head">
              <strong>Meta API Key</strong>
              <span>{activeWorkspace ? `${activeWorkspace.label} · ${activeWorkspace.adAccountId}` : 'ใช้กับ Ads Agent และ Page Automation'}</span>
            </div>
            <label>
              ชื่อ Workspace
              <input
                value={metaForm.workspaceLabel}
                onChange={(event) => onMetaFormChange({ ...metaForm, workspaceLabel: event.target.value })}
                placeholder="เช่น Promed Clinic PMC"
              />
            </label>
            <label>
              Meta Ad Account ID
              <input
                value={metaForm.adAccountId}
                onChange={(event) => onMetaFormChange({ ...metaForm, adAccountId: event.target.value })}
                placeholder={settings.meta?.hasSavedToken ? 'ใช้บัญชีเดิม หรือใส่ act_1234567890' : 'act_1234567890'}
              />
            </label>
            <label>
              Access Token
              <input
                value={metaForm.accessToken}
                onChange={(event) => onMetaFormChange({ ...metaForm, accessToken: event.target.value })}
                placeholder={settings.meta?.hasSavedToken ? 'ใช้ token เดิม หรือใส่ token ใหม่' : 'ใส่ token สำหรับ Meta API'}
                type="password"
              />
            </label>
            <button className="home-settings-primary" type="button" onClick={onSaveMeta} disabled={!canSaveMeta || savingTarget === 'meta'}>
              {savingTarget === 'meta' ? 'กำลังบันทึก...' : 'บันทึก Meta API'}
            </button>
          </section>

          <section className="home-settings-card" aria-label="ตั้งค่า AI API">
            <div className="home-settings-card-head">
              <strong>AI API Key</strong>
              <span>ใช้กับคำแนะนำ AI, Knowledge และการวิเคราะห์ร่วมของทุก App</span>
            </div>
            <label>
              API Key
              <input
                value={aiForm.apiKey}
                onChange={(event) => onAiFormChange({ ...aiForm, apiKey: event.target.value })}
                placeholder={settings.ai?.hasSavedApiKey ? 'ใช้ key เดิม หรือใส่ key ใหม่' : 'sk-proj-...'}
                type="password"
              />
            </label>
            <label>
              Model
              <input
                value={aiForm.model}
                onChange={(event) => onAiFormChange({ ...aiForm, model: event.target.value })}
                placeholder="gpt-5.5"
              />
            </label>
            <label>
              Max output tokens
              <input
                inputMode="numeric"
                value={aiForm.maxOutputTokens}
                onChange={(event) => onAiFormChange({ ...aiForm, maxOutputTokens: event.target.value })}
                placeholder="2800"
              />
            </label>
            <div className="home-settings-actions">
              <button className="home-settings-secondary" type="button" onClick={onCheckAi} disabled={savingTarget === 'ai-check' || !settings.ai?.configured}>
                {savingTarget === 'ai-check' ? 'กำลังตรวจ...' : 'ตรวจสถานะ AI'}
              </button>
              <button className="home-settings-primary" type="button" onClick={onSaveAi} disabled={!canSaveAi || savingTarget === 'ai'}>
                {savingTarget === 'ai' ? 'กำลังบันทึก...' : 'บันทึก AI API'}
              </button>
            </div>
          </section>
        </div>

        <div className="home-settings-foot">
          <p>{message || (isLoading ? 'กำลังโหลดสถานะ API...' : 'API Key จะถูกบันทึกฝั่ง server และไม่แสดงกลับมาบน browser')}</p>
          <div>
            <button className="home-settings-secondary" type="button" onClick={onRefresh} disabled={isLoading}>
              {isLoading ? 'กำลังโหลด...' : 'รีเฟรชสถานะ'}
            </button>
            <button className="home-settings-primary" type="button" onClick={onClose}>
              เสร็จแล้ว
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function ApiStatusLine({ label, state, value }: { label: string; state: HomeStatusState; value: string }) {
  return (
    <div className="home-settings-status-line">
      <span className={`home-dot ${statusStateClass(state)}`} />
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  )
}

function metaStatusLabel(status: HomeMetaConfigState | null) {
  if (status?.connected) return 'เชื่อมต่อ'
  if (status?.configured) return 'มีค่าแล้ว แต่ยังไม่พร้อมใช้งาน'
  return 'ยังไม่ได้ตั้งค่า'
}

function aiStatusLabel(status: HomeAiConfigState | null) {
  if (status?.connected) return status.model ? `เชื่อมต่อ · ${status.model}` : 'เชื่อมต่อ'
  if (status?.configured) return 'มีค่าแล้ว แต่ยังไม่พร้อมใช้งาน'
  return 'ยังไม่ได้ตั้งค่า'
}

function SuggestionCard({ priority }: { priority: HomePriority }) {
  return (
    <a className="home-suggestion-card" href={priority.href}>
      <span className={`home-suggestion-icon ${priority.iconTone}`}>
        {renderPriorityIcon(priority)}
      </span>
      <span>
        <small>คำแนะนำล่าสุดจาก AI</small>
        <strong>{priority.title}</strong>
      </span>
      <ChevronRight size={18} />
    </a>
  )
}

function AppCard({ tool }: { tool: HomeTool }) {
  const Icon = toolIcons[tool.id] ?? Grid2X2
  const isSetup = tool.routeState !== 'enabled'
  const content = (
    <>
      <div className={`home-app-icon ${tool.iconTone}`}>
        {tool.id === 'ads' ? <ProductLogo alt="PMC Ads" src={adsLogoSrc} /> : null}
        {tool.id === 'page' ? <ProductLogo alt="PMC Page Auto" src={pageAutoLogoSrc} /> : null}
        {tool.id !== 'ads' && tool.id !== 'page' ? <Icon size={30} /> : null}
      </div>
      <div className="home-app-copy">
        <strong>{tool.title}</strong>
        <p>{appDescriptions[tool.id]}</p>
        <span><i className={`home-dot ${statusStateClass(tool.status)}`} />{tool.statusText}</span>
        {tool.setupLabel ? <em>{tool.setupLabel}</em> : null}
      </div>
      <b className="home-app-action">
        {isSetup ? 'ยังไม่พร้อม' : 'เปิดใช้งาน'}
        <ChevronRight size={16} />
      </b>
    </>
  )

  if (isSetup) {
    return (
      <div className="home-app-card is-setup" role="group" aria-label={`${tool.title}: ${tool.setupLabel ?? tool.statusText}`}>
        {content}
      </div>
    )
  }

  return (
    <a className="home-app-card" href={tool.href}>
      {content}
    </a>
  )
}

function StatusChip({ label, state, value }: { label: string; state: HomeStatusState; value: string }) {
  return (
    <div className="home-status-chip">
      <span className={`home-dot ${statusStateClass(state)}`} />
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
    </div>
  )
}

function renderPriorityIcon(priority: HomePriority) {
  if (priority.id.includes('draft')) return <FileText size={28} />
  if (priority.source === 'Page Automation') return <ProductLogo alt="PMC Page Auto" src={pageAutoLogoSrc} />
  if (priority.source === 'Ads Agent') return <ProductLogo alt="PMC Ads" src={adsLogoSrc} />
  if (priority.source === 'Knowledge') return <BookOpen size={28} />
  return <Sparkles size={28} />
}

function ProductLogo({ alt, src }: { alt: string; src: string }) {
  return <img className="home-product-logo" src={src} alt={alt} />
}

function statusStateClass(state: HomeStatusState) {
  if (state === 'connected' || state === 'ready') return 'good'
  if (state === 'setup' || state === 'loading') return 'watch'
  return 'critical'
}
