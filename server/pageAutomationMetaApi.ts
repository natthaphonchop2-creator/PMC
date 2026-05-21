import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ManagedPageRecord, PageAutomationPermission, PageAutomationPermissionReport } from './pageAutomationTypes.js'
import type { PageMessage, PageMessageIntent, PageMessagePriority, PageMessageSentiment } from '../src/apps/page-automation/types'

const DEFAULT_GRAPH_HOST = 'https://graph.facebook.com'
const DEFAULT_GRAPH_VERSION = 'v21.0'
const LOCAL_CONFIG_FILE = resolve(process.cwd(), '.meta-api.local.json')

const FACEBOOK_REQUIRED: PageAutomationPermission[] = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
  'pages_messaging',
]

const INSTAGRAM_REQUIRED: PageAutomationPermission[] = ['instagram_basic', 'instagram_manage_insights', 'instagram_manage_messages']

const FACEBOOK_PAGE_FIELDS = 'id,name,username,followers_count,tasks'
const FACEBOOK_PERMISSION_VALUES = new Set<PageAutomationPermission>([
  ...FACEBOOK_REQUIRED,
  'pages_manage_metadata',
  'pages_manage_engagement',
  'ads_read',
  'business_management',
  'leads_retrieval',
])
const GRAPH_PAGE_PERMISSION_KEYS = ['perms', 'permissions', 'granted_permissions', 'tasks'] as const

export type PageAutomationMetaConfig = {
  accessToken?: string
  graphVersion?: string
  graphHost?: string
}

type PageAutomationMetaEnv = Record<string, string | undefined>

type PersistedMetaWorkspace = {
  id?: string
  accessToken?: string
  graphVersion?: string
  graphHost?: string
}

type PersistedMetaConfig = PageAutomationMetaConfig & {
  activeWorkspaceId?: string
  disconnected?: boolean
  workspaces?: PersistedMetaWorkspace[]
}

type GraphRequestConfig = {
  accessToken: string
  graphVersion: string
  graphHost: string
}

type MetaPageRecord = {
  id: string
  name?: string
  username?: string
  followers_count?: number | string
  perms?: unknown
  permissions?: unknown
  granted_permissions?: unknown
  tasks?: unknown
}

type PageAccountsPayload = {
  data?: MetaPageRecord[]
}

type PageInsightsPayload = {
  data?: Array<{
    name: string
    values?: Array<{ value?: number | string }>
  }>
}

type PageConversationsPayload = {
  data?: Array<{
    id?: string
    updated_time?: string
    unread_count?: number | string
    messages?: {
      data?: Array<{
        id?: string
        message?: string
        created_time?: string
        from?: {
          name?: string
        }
      }>
    }
  }>
}

type GraphErrorPayload = {
  error?: {
    message?: string
  }
}

export async function readPageAutomationMetaConfig(env: PageAutomationMetaEnv = process.env): Promise<PageAutomationMetaConfig> {
  const localConfig = await readLocalMetaConfig()
  const activeWorkspace = localConfig?.disconnected ? null : activeLocalWorkspace(localConfig) ?? activeEnvWorkspace(env)

  return {
    accessToken: localConfig?.disconnected
      ? undefined
      : firstNonEmpty(
          env.PAGE_AUTOMATION_META_ACCESS_TOKEN,
          activeWorkspace?.accessToken,
          localConfig?.accessToken,
          env.META_PAGE_ACCESS_TOKEN,
          env.META_ACCESS_TOKEN,
        ),
    graphVersion: firstNonEmpty(
      env.PAGE_AUTOMATION_META_GRAPH_VERSION,
      activeWorkspace?.graphVersion,
      localConfig?.graphVersion,
      env.META_GRAPH_VERSION,
      env.VITE_META_GRAPH_VERSION,
      DEFAULT_GRAPH_VERSION,
    ),
    graphHost: firstNonEmpty(
      env.PAGE_AUTOMATION_META_GRAPH_HOST,
      activeWorkspace?.graphHost,
      localConfig?.graphHost,
      env.META_GRAPH_HOST,
      env.VITE_META_GRAPH_HOST,
      DEFAULT_GRAPH_HOST,
    ),
  }
}

export async function fetchPageAutomationPages(
  config: PageAutomationMetaConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ManagedPageRecord[]> {
  const requestConfig = graphRequestConfig(config)
  if (!requestConfig) throw new Error('Meta API access token is required for Page Automation pages')

  const payload = await graphGet<PageAccountsPayload>(requestConfig, `/${requestConfig.graphVersion}/me/accounts`, fetchImpl, {
    fields: FACEBOOK_PAGE_FIELDS,
  })
  const now = new Date().toISOString()

  return (payload.data ?? []).map((page) => ({
    id: page.id,
    name: page.name || `Page ${page.id}`,
    handle: page.username ? `@${page.username.replace(/^@/, '')}` : page.id,
    platform: 'facebook',
    followers: numericValue(page.followers_count),
    followerDelta: 0,
    reach: 0,
    engagementRate: 0,
    unreadCount: 0,
    responseRate: 0,
    avgFirstResponseMins: 0,
    healthScore: 50,
    permissions: [buildPermissionReport(page.id, 'facebook', extractGrantedFacebookPermissions(page), now)],
    lastSyncedAt: now,
  }))
}

export async function fetchPageInsights(config: PageAutomationMetaConfig, pageId: string, fetchImpl: typeof fetch = fetch) {
  const requestConfig = graphRequestConfig(config)
  if (!requestConfig) throw new Error('Meta API access token is required for Page Automation page insights')

  const payload = await graphGet<PageInsightsPayload>(
    requestConfig,
    `/${requestConfig.graphVersion}/${encodeURIComponent(pageId)}/insights`,
    fetchImpl,
    {
      metric: 'page_impressions_unique,page_impressions,page_post_engagements',
      period: 'day',
    },
  )
  const reach = metricValue(payload, 'page_impressions_unique') ?? metricValue(payload, 'page_impressions') ?? 0
  const engagements = metricValue(payload, 'page_post_engagements') ?? 0

  return {
    reach,
    engagementRate: reach > 0 ? (engagements / reach) * 100 : 0,
  }
}

export async function fetchPageMessages(
  config: PageAutomationMetaConfig,
  pages: ManagedPageRecord[],
  fetchImpl: typeof fetch = fetch,
): Promise<PageMessage[]> {
  const requestConfig = graphRequestConfig(config)
  if (!requestConfig) throw new Error('Meta API access token is required for Page Automation messages')

  const messagePages = pages.filter((page) => page.platform === 'facebook' && hasGrantedPermission(page, 'pages_messaging'))
  const messages = await Promise.all(
    messagePages.map(async (page) => {
      const payload = await graphGet<PageConversationsPayload>(
        requestConfig,
        `/${requestConfig.graphVersion}/${encodeURIComponent(page.id)}/conversations`,
        fetchImpl,
        {
          fields: 'id,updated_time,unread_count,messages.limit(1){id,message,created_time,from}',
          limit: 25,
        },
      )

      return (payload.data ?? []).flatMap((conversation) => messageFromConversation(page, conversation))
    }),
  )

  return messages.flat()
}

export function buildPermissionReport(
  pageId: string,
  platform: PageAutomationPermissionReport['platform'],
  granted: PageAutomationPermission[],
  checkedAt = new Date().toISOString(),
): PageAutomationPermissionReport {
  const required = platform === 'facebook' ? FACEBOOK_REQUIRED : INSTAGRAM_REQUIRED

  return {
    pageId,
    platform,
    granted: [...granted],
    missing: required.filter((permission) => !granted.includes(permission)),
    checkedAt,
  }
}

function hasGrantedPermission(page: ManagedPageRecord, permission: PageAutomationPermission) {
  return page.permissions.some((report) => report.granted.includes(permission))
}

function messageFromConversation(
  page: ManagedPageRecord,
  conversation: NonNullable<PageConversationsPayload['data']>[number],
): PageMessage[] {
  const latestMessage = conversation.messages?.data?.[0]
  if (!conversation.id || !latestMessage?.id) return []

  const receivedAt = normalizeIsoDate(latestMessage.created_time || conversation.updated_time)
  const redacted = redactMessageText(latestMessage.message ?? '')
  const intent = classifyMessageIntent(redacted.text)
  const sentiment = classifyMessageSentiment(redacted.text)
  const unread = numericValue(conversation.unread_count) > 0

  return [
    {
      conversationId: conversation.id,
      messageId: latestMessage.id,
      pageId: page.id,
      channel: 'facebook_message',
      customerDisplayName: latestMessage.from?.name?.trim() || 'Customer',
      textExcerpt: redacted.text,
      receivedAt,
      unread,
      priority: classifyMessagePriority({ intent, privacyFlags: redacted.flags, sentiment, unread }),
      status: unread ? 'new' : 'open',
      sentiment,
      intent,
      slaDueAt: addMinutesIso(receivedAt, 30),
      privacyFlags: redacted.flags,
    },
  ]
}

function redactMessageText(value: string) {
  const flags: string[] = []
  let text = value.trim()

  text = text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, () => {
    if (!flags.includes('email')) flags.push('email')
    return '[email]'
  })
  text = text.replace(/\+?\d[\d\s().-]{7,}\d/g, () => {
    if (!flags.includes('phone')) flags.push('phone')
    return '[phone]'
  })

  return {
    flags,
    text: text || 'No message text',
  }
}

function classifyMessageIntent(text: string): PageMessageIntent {
  if (/(ราคา|เท่าไร|เท่าไหร่|price|cost|fee)/i.test(text)) return 'price'
  if (/(จอง|นัด|booking|book|appointment)/i.test(text)) return 'booking'
  if (/(รีวิว|review)/i.test(text)) return 'review_request'
  if (/(ร้องเรียน|complaint|เสียใจ|แย่|refund|คืนเงิน)/i.test(text)) return 'complaint'
  return 'general'
}

function classifyMessageSentiment(text: string): PageMessageSentiment {
  if (/(ร้องเรียน|complaint|เสียใจ|แย่|refund|คืนเงิน|angry|bad)/i.test(text)) return 'negative'
  if (/(ขอบคุณ|thank|ดีมาก|great|love)/i.test(text)) return 'positive'
  return 'neutral'
}

function classifyMessagePriority({
  intent,
  privacyFlags,
  sentiment,
  unread,
}: {
  intent: PageMessageIntent
  privacyFlags: string[]
  sentiment: PageMessageSentiment
  unread: boolean
}): PageMessagePriority {
  if (sentiment === 'negative' || intent === 'complaint' || (unread && (intent === 'price' || privacyFlags.length > 0))) return 'high'
  if (unread) return 'medium'
  return 'low'
}

function normalizeIsoDate(value: string | undefined) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString()
}

function addMinutesIso(value: string, minutes: number) {
  const time = Date.parse(value)
  const base = Number.isFinite(time) ? time : Date.now()
  return new Date(base + minutes * 60_000).toISOString()
}

async function graphGet<T>(
  config: GraphRequestConfig,
  path: string,
  fetchImpl: typeof fetch,
  params: Record<string, string | number> = {},
): Promise<T> {
  const url = new URL(`${config.graphHost}${path.startsWith('/') ? path : `/${path}`}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }
  url.searchParams.set('access_token', config.accessToken)

  let response: Response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    throw new Error(sanitizeMetaErrorMessage(`Meta API request failed: ${errorMessage(error)}`, config.accessToken), {
      cause: error,
    })
  }

  const responseBody = await response.text().catch(() => '')
  const payload = parseGraphPayload(responseBody)
  const maybeError = payload.error
  if (!response.ok || maybeError) {
    throw new Error(sanitizeMetaErrorMessage(maybeError?.message || graphErrorMessage(response, responseBody), config.accessToken))
  }

  return payload as T
}

function graphRequestConfig(config: PageAutomationMetaConfig): GraphRequestConfig | null {
  const accessToken = firstNonEmpty(config.accessToken)
  if (!accessToken) return null

  return {
    accessToken,
    graphVersion: firstNonEmpty(config.graphVersion, DEFAULT_GRAPH_VERSION),
    graphHost: normalizeGraphHost(firstNonEmpty(config.graphHost, DEFAULT_GRAPH_HOST)),
  }
}

function metricValue(payload: PageInsightsPayload, metric: string) {
  const row = payload.data?.find((entry) => entry.name === metric)
  if (!row) return null
  const values = row.values ?? []
  return numericValue(values.at(-1)?.value)
}

function numericValue(value: number | string | undefined) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function activeLocalWorkspace(config: PersistedMetaConfig | null): PersistedMetaWorkspace | null {
  const workspaces = config?.workspaces?.filter((workspace) => firstNonEmpty(workspace.accessToken)) ?? []
  if (workspaces.length === 0) return null

  const activeWorkspaceId = firstNonEmpty(config?.activeWorkspaceId)
  if (!activeWorkspaceId) return workspaces[0] ?? null

  return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null
}

function activeEnvWorkspace(env: PageAutomationMetaEnv): PersistedMetaWorkspace | null {
  const { activeWorkspaceId, workspaces } = readEnvWorkspaceConfig(env)
  if (workspaces.length === 0) return null
  if (!activeWorkspaceId) return workspaces[0] ?? null

  return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null
}

function readEnvWorkspaceConfig(env: PageAutomationMetaEnv) {
  const raw = firstNonEmpty(env.META_WORKSPACES_JSON)
  if (!raw) return { activeWorkspaceId: firstNonEmpty(env.META_ACTIVE_WORKSPACE_ID), workspaces: [] }

  try {
    const parsed = JSON.parse(raw) as unknown
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    const rawWorkspaces = Array.isArray(parsed) ? parsed : Array.isArray(record?.workspaces) ? record.workspaces : []
    const workspaces = rawWorkspaces.map(normalizeEnvWorkspace).filter(isPersistedMetaWorkspace)

    return {
      activeWorkspaceId: firstNonEmpty(env.META_ACTIVE_WORKSPACE_ID, typeof record?.activeWorkspaceId === 'string' ? record.activeWorkspaceId : undefined),
      workspaces,
    }
  } catch {
    return { activeWorkspaceId: firstNonEmpty(env.META_ACTIVE_WORKSPACE_ID), workspaces: [] }
  }
}

function normalizeEnvWorkspace(raw: unknown): PersistedMetaWorkspace | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const accessToken = typeof record.accessToken === 'string' ? record.accessToken.trim() : ''
  if (!accessToken) return null

  return {
    id: typeof record.id === 'string' ? record.id.trim() : undefined,
    accessToken,
    graphVersion: typeof record.graphVersion === 'string' ? record.graphVersion.trim() : undefined,
    graphHost: typeof record.graphHost === 'string' ? record.graphHost.trim() : undefined,
  }
}

function isPersistedMetaWorkspace(workspace: PersistedMetaWorkspace | null): workspace is PersistedMetaWorkspace {
  return Boolean(workspace)
}

async function readLocalMetaConfig(): Promise<PersistedMetaConfig | null> {
  try {
    const parsed = JSON.parse(await readFile(LOCAL_CONFIG_FILE, 'utf-8')) as PersistedMetaConfig
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return ''
}

function normalizeGraphHost(value: string) {
  return value.replace(/\/+$/, '') || DEFAULT_GRAPH_HOST
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeMetaErrorMessage(message: string, accessToken: string) {
  let sanitized = message
  const token = accessToken.trim()
  if (!token) return sanitized

  sanitized = sanitized.split(token).join('[redacted]')
  const encodedToken = encodeURIComponent(token)
  if (encodedToken !== token) {
    sanitized = sanitized.split(encodedToken).join('[redacted]')
  }

  return sanitized
}

function extractGrantedFacebookPermissions(page: MetaPageRecord) {
  const granted = new Set<PageAutomationPermission>()
  for (const key of GRAPH_PAGE_PERMISSION_KEYS) {
    for (const permission of permissionStrings(page[key])) {
      const normalized = permission.trim()
      if (FACEBOOK_PERMISSION_VALUES.has(normalized as PageAutomationPermission)) {
        granted.add(normalized as PageAutomationPermission)
      }
    }
  }

  return [...granted]
}

function permissionStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []

    const record = item as Record<string, unknown>
    if (record.status && record.status !== 'granted') return []
    const permission = record.permission ?? record.name
    return typeof permission === 'string' ? [permission] : []
  })
}

function parseGraphPayload(body: string): GraphErrorPayload {
  if (!body.trim()) return {}

  try {
    const parsed = JSON.parse(body) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as GraphErrorPayload) : {}
  } catch {
    return {}
  }
}

function graphErrorMessage(response: Response, body: string) {
  const trimmed = body.trim()
  if (!trimmed) return `Meta API request failed (${response.status})`

  return `Meta API request failed (${response.status}): ${trimmed.slice(0, 500)}`
}
