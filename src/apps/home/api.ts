import type { PageMessage, PostDraft } from '../page-automation/types'
import type { HomeActivity, HomePriority, HomeSnapshot, HomeStatusState, HomeSystemStatus, HomeToolId } from './types'
import type { RecommendedAction, WorkspaceData } from '../../types'
import { buildHomeTool, homeToolDefinitions } from './toolRegistry'

type MetaStatusResponse = {
  configured?: boolean
  connected?: boolean
  workspaceLabel?: string | null
}

type AiStatusResponse = {
  configured?: boolean
  connected?: boolean
  model?: string
}

type PageAutomationStatusResponse = {
  autoMode?: 'on' | 'off'
  storage?: 'ready' | 'unavailable'
}

type PageMessagesResponse = {
  messages?: PageMessage[]
}

type PostDraftsResponse = {
  drafts?: PostDraft[]
}

type Settled<T> = {
  ok: boolean
  value: T | null
}

const loadingStatus = 'รอตรวจสถานะ'
type HomeToolState = { state: HomeStatusState; text: string }

const initialToolStateById = {
  ads: { state: 'loading', text: loadingStatus },
  page: { state: 'loading', text: loadingStatus },
  settings: { state: 'ready', text: 'พร้อมใช้งาน' },
  crm: { state: 'setup', text: 'รอตั้งค่า' },
  erp: { state: 'setup', text: 'กำลังมา' },
  knowledge: { state: 'setup', text: 'รอตั้งค่า' },
  website: { state: 'setup', text: 'กำลังมา' },
  reports: { state: 'setup', text: 'กำลังมา' },
} satisfies Record<HomeToolId, HomeToolState>

export const initialHomeSnapshot: HomeSnapshot = {
  activities: [],
  headerStatuses: [
    { id: 'meta', label: 'Meta API', state: 'loading', value: loadingStatus },
    { id: 'ai', label: 'AI API', state: 'loading', value: loadingStatus },
    { id: 'knowledge', label: 'Knowledge', state: 'loading', value: loadingStatus },
  ],
  priorities: [
    {
      id: 'loading-ads',
      actionLabel: 'Open',
      confidence: 0,
      href: '/ads-agent',
      iconTone: 'blue',
      risk: 'ต่ำ',
      source: 'Ads Agent',
      sourceLabel: 'แหล่งข้อมูล: รอตรวจสถานะ',
      title: 'กำลังตรวจข้อมูล Ads Agent',
    },
    {
      id: 'loading-page',
      actionLabel: 'Open',
      confidence: 0,
      href: '/page-automation',
      iconTone: 'green',
      risk: 'ต่ำ',
      source: 'Page Automation',
      sourceLabel: 'แหล่งข้อมูล: รอตรวจสถานะ',
      title: 'กำลังตรวจข้อความและโพสต์ของเพจ',
    },
    {
      id: 'loading-knowledge',
      actionLabel: 'Open',
      confidence: 0,
      href: '#knowledge',
      iconTone: 'purple',
      risk: 'ต่ำ',
      source: 'Knowledge',
      sourceLabel: 'แหล่งข้อมูล: รอตรวจสถานะ',
      title: 'กำลังตรวจสถานะ Knowledge',
    },
  ],
  systemStatuses: [
    { id: 'meta', label: 'Meta API', state: 'loading', value: loadingStatus },
    { id: 'ai', label: 'AI API', state: 'loading', value: loadingStatus },
    { id: 'rag', label: 'RAG / Knowledge', state: 'loading', value: loadingStatus },
    { id: 'website', label: 'Website', state: 'setup', value: 'รอตั้งค่า' },
    { id: 'erp', label: 'ERP', state: 'setup', value: 'รอตั้งค่า' },
    { id: 'crm', label: 'CRM', state: 'setup', value: 'รอตั้งค่า' },
  ],
  tools: homeToolDefinitions.map((definition) => {
    const state = initialToolStateById[definition.id]
    return buildHomeTool(definition, state.state, state.text)
  }),
}

export async function fetchHomeStatusSnapshot(): Promise<HomeSnapshot> {
  const [meta, ai, pageStatus, messages, drafts] = await Promise.all([
    safeJson<MetaStatusResponse>('/api/meta/status'),
    safeJson<AiStatusResponse>('/api/ai/status'),
    safeJson<PageAutomationStatusResponse>('/api/page-automation/status'),
    safeJson<PageMessagesResponse>('/api/page-automation/messages'),
    safeJson<PostDraftsResponse>('/api/page-automation/post-drafts'),
  ])

  return composeHomeSnapshot({
    ai,
    drafts,
    messages,
    meta,
    pageStatus,
    workspace: { ok: false, value: null },
  })
}

export async function fetchHomeSnapshot(): Promise<HomeSnapshot> {
  const [meta, ai, workspace, pageStatus, messages, drafts] = await Promise.all([
    safeJson<MetaStatusResponse>('/api/meta/status'),
    safeJson<AiStatusResponse>('/api/ai/status'),
    safeJson<WorkspaceData>('/api/meta/workspace?datePreset=maximum', 12_000),
    safeJson<PageAutomationStatusResponse>('/api/page-automation/status'),
    safeJson<PageMessagesResponse>('/api/page-automation/messages'),
    safeJson<PostDraftsResponse>('/api/page-automation/post-drafts'),
  ])

  return composeHomeSnapshot({ ai, drafts, messages, meta, pageStatus, workspace })
}

function composeHomeSnapshot({
  ai,
  drafts,
  messages,
  meta,
  pageStatus,
  workspace,
}: {
  ai: Settled<AiStatusResponse>
  drafts: Settled<PostDraftsResponse>
  messages: Settled<PageMessagesResponse>
  meta: Settled<MetaStatusResponse>
  pageStatus: Settled<PageAutomationStatusResponse>
  workspace: Settled<WorkspaceData>
}): HomeSnapshot {
  const metaStatus = statusFromConnection('meta', 'Meta API', meta, 'เชื่อมต่อ')
  const aiStatus = statusFromConnection('ai', 'AI API', ai, 'เชื่อมต่อ')
  const knowledgeStatus = ai.value?.connected
    ? { id: 'knowledge', label: 'Knowledge', state: 'ready', value: 'พร้อมใช้งาน' } satisfies HomeSystemStatus
    : { id: 'knowledge', label: 'Knowledge', state: 'setup', value: 'รอตั้งค่า' } satisfies HomeSystemStatus
  const pageAutomationReady = pageStatus.ok && pageStatus.value?.storage === 'ready'
  const pageToolStatus: HomeStatusState = pageAutomationReady ? 'ready' : 'unavailable'
  const pageToolText = pageAutomationReady ? 'พร้อมใช้งาน' : 'ไม่พร้อมใช้งาน'
  const toolStateById = {
    ads: {
      state: metaStatus.state,
      text: metaStatus.state === 'connected' ? 'พร้อมใช้งาน' : metaStatus.value,
    },
    page: {
      state: pageToolStatus,
      text: pageToolText,
    },
    settings: { state: 'ready' as const, text: 'พร้อมใช้งาน' },
    crm: { state: 'setup' as const, text: 'รอตั้งค่า' },
    erp: { state: 'setup' as const, text: 'กำลังมา' },
    knowledge: {
      state: knowledgeStatus.state,
      text: knowledgeStatus.value,
    },
    website: { state: 'setup' as const, text: 'กำลังมา' },
    reports: { state: 'setup' as const, text: 'กำลังมา' },
  } satisfies Record<HomeToolId, HomeToolState>
  const tools = homeToolDefinitions.map((definition) => {
    const state = toolStateById[definition.id]
    return buildHomeTool(definition, state.state, state.text)
  })

  return {
    activities: buildActivities(messages.value?.messages ?? [], drafts.value?.drafts ?? [], workspace.value),
    headerStatuses: [metaStatus, aiStatus, knowledgeStatus],
    priorities: buildPriorities({
      aiConnected: Boolean(ai.value?.connected),
      drafts: drafts.value?.drafts ?? [],
      messages: messages.value?.messages ?? [],
      metaConnected: Boolean(meta.value?.connected),
      workspace: workspace.value,
    }),
    systemStatuses: [
      metaStatus,
      aiStatus,
      { ...knowledgeStatus, id: 'rag', label: 'RAG / Knowledge' },
      { id: 'website', label: 'Website', state: 'setup', value: 'รอตั้งค่า' },
      { id: 'erp', label: 'ERP', state: 'setup', value: 'รอตั้งค่า' },
      { id: 'crm', label: 'CRM', state: 'setup', value: 'รอตั้งค่า' },
    ],
    tools,
  }
}

async function safeJson<T>(url: string, timeoutMs = 4_000): Promise<Settled<T>> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const payload = await response.json().catch(() => null)
    return {
      ok: response.ok,
      value: response.ok ? (payload as T) : null,
    }
  } catch {
    return { ok: false, value: null }
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

function statusFromConnection(id: string, label: string, result: Settled<{ configured?: boolean; connected?: boolean }>, connectedText: string): HomeSystemStatus {
  if (result.value?.connected) return { id, label, state: 'connected', value: connectedText }
  if (result.value?.configured) return { id, label, state: 'unavailable', value: 'ไม่พร้อมใช้งาน' }
  if (result.ok) return { id, label, state: 'setup', value: 'รอตั้งค่า' }
  return { id, label, state: 'unavailable', value: 'ไม่พร้อมใช้งาน' }
}

function buildPriorities({
  aiConnected,
  drafts,
  messages,
  metaConnected,
  workspace,
}: {
  aiConnected: boolean
  drafts: PostDraft[]
  messages: PageMessage[]
  metaConnected: boolean
  workspace: WorkspaceData | null
}): HomePriority[] {
  const priorities: HomePriority[] = []
  const firstAction = workspace?.actions?.[0]

  if (firstAction) {
    priorities.push(priorityFromAction(firstAction))
  } else if (!metaConnected) {
    priorities.push({
      id: 'setup-meta',
      actionLabel: 'Open',
      confidence: 0,
      href: '/ads-agent',
      iconTone: 'blue',
      risk: 'ปานกลาง',
      source: 'Ads Agent',
      sourceLabel: 'แหล่งข้อมูล: Meta API',
      title: 'ตั้งค่า Meta API เพื่อเปิดข้อมูล Ads Agent',
    })
  } else {
    priorities.push({
      id: 'ads-review-ready',
      actionLabel: 'Review',
      confidence: 86,
      href: '/ads-agent',
      iconTone: 'blue',
      risk: 'ต่ำ',
      source: 'Ads Agent',
      sourceLabel: 'แหล่งข้อมูล: Ads Agent',
      title: 'ตรวจภาพรวม Ads Agent จากข้อมูลล่าสุด',
    })
  }

  const unread = messages.filter((message) => message.unread).length
  if (unread > 0) {
    priorities.push({
      id: 'page-unread',
      actionLabel: 'Open',
      confidence: 78,
      href: '/page-automation/messages',
      iconTone: 'green',
      risk: unread >= 10 ? 'ปานกลาง' : 'ต่ำ',
      source: 'Page Automation',
      sourceLabel: 'แหล่งข้อมูล: Page Automation',
      title: `ข้อความลูกค้ายังไม่ได้ตอบ ${unread} รายการ`,
    })
  } else {
    priorities.push({
      id: 'page-inbox-review',
      actionLabel: 'Open',
      confidence: 78,
      href: '/page-automation/messages',
      iconTone: 'green',
      risk: 'ต่ำ',
      source: 'Page Automation',
      sourceLabel: 'แหล่งข้อมูล: Page Automation',
      title: 'ตรวจข้อความจากทุกเพจและรายการที่ต้องตอบ',
    })
  }

  const readyDrafts = drafts.filter((draft) => draft.status === 'ready').length
  if (readyDrafts > 0) {
    priorities.push({
      id: 'page-drafts',
      actionLabel: 'Open',
      confidence: 92,
      href: '/page-automation/auto-post',
      iconTone: 'purple',
      risk: 'ต่ำ',
      source: 'Page Automation',
      sourceLabel: 'แหล่งข้อมูล: Page Automation',
      title: `โพสต์ร่างพร้อมเผยแพร่ ${readyDrafts} รายการ`,
    })
  } else {
    priorities.push({
      id: 'page-draft-review',
      actionLabel: 'Open',
      confidence: 92,
      href: '/page-automation/auto-post',
      iconTone: 'purple',
      risk: 'ต่ำ',
      source: 'Page Automation',
      sourceLabel: 'แหล่งข้อมูล: Page Automation',
      title: 'ตรวจร่างโพสต์และคิวเผยแพร่ของ Page Automation',
    })
  }

  if (!aiConnected) {
    priorities.push({
      id: 'setup-ai',
      actionLabel: 'Open',
      confidence: 0,
      href: '/ads-agent',
      iconTone: 'purple',
      risk: 'ปานกลาง',
      source: 'Knowledge',
      sourceLabel: 'แหล่งข้อมูล: AI API',
      title: 'ตั้งค่า AI API เพื่อเปิด Knowledge และ AI Priorities',
    })
  }

  priorities.push({
    id: 'setup-crm',
    actionLabel: 'Open',
    confidence: 0,
    href: '#crm',
    iconTone: 'purple',
    risk: 'ต่ำ',
    source: 'CRM',
    sourceLabel: 'แหล่งข้อมูล: รอตั้งค่า',
    title: 'เชื่อมต่อ CRM เพื่อดูงานลูกค้าที่ค้าง',
  })

  return priorities.slice(0, 3)
}

function priorityFromAction(action: RecommendedAction): HomePriority {
  return {
    id: action.id,
    actionLabel: action.execution ? 'Review' : 'Open',
    confidence: action.confidence,
    href: '/ads-agent',
    iconTone: 'blue',
    risk: action.risk === 'High' ? 'สูง' : action.risk === 'Medium' ? 'ปานกลาง' : 'ต่ำ',
    source: 'Ads Agent',
    sourceLabel: 'แหล่งข้อมูล: Ads Agent',
    title: action.summary || action.target || 'ตรวจคำแนะนำจาก Ads Agent',
  }
}

function buildActivities(messages: PageMessage[], drafts: PostDraft[], workspace: WorkspaceData | null): HomeActivity[] {
  const activities: HomeActivity[] = []
  const firstUnread = messages.find((message) => message.unread)
  const firstDraft = drafts.find((draft) => draft.status === 'ready')
  const firstAudit = workspace?.auditTrail?.[0]

  if (firstUnread) {
    activities.push({ id: firstUnread.messageId, label: `Page Automation ถึงข้อความจาก ${firstUnread.customerDisplayName}`, source: 'Page Automation', time: formatRelative(firstUnread.receivedAt) })
  }
  if (firstDraft) {
    activities.push({ id: firstDraft.id, label: `${firstDraft.title} พร้อมตรวจ`, source: 'Page Automation', time: formatRelative(firstDraft.updatedAt) })
  }
  if (firstAudit) {
    activities.push({ id: firstAudit.id, label: firstAudit.action, source: 'Ads Agent', time: formatRelative(firstAudit.timestamp) })
  }

  return activities.slice(0, 2)
}

function formatRelative(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'ล่าสุด'
  const minutes = Math.max(1, Math.round((Date.now() - time) / 60_000))
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.round(minutes / 60)
  return `${hours} ชั่วโมงที่แล้ว`
}
