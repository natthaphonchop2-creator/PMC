import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ManagedPageRecord, PageAutomationPermission, PageAutomationPermissionReport } from './pageAutomationTypes.js'

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

type GraphErrorPayload = {
  error?: {
    message?: string
  }
}

export async function readPageAutomationMetaConfig(env: PageAutomationMetaEnv = process.env): Promise<PageAutomationMetaConfig> {
  const localConfig = await readLocalMetaConfig()
  const activeWorkspace = localConfig?.disconnected ? null : activeLocalWorkspace(localConfig)

  return {
    accessToken: localConfig?.disconnected
      ? undefined
      : firstNonEmpty(
          activeWorkspace?.accessToken,
          localConfig?.accessToken,
          env.PAGE_AUTOMATION_META_ACCESS_TOKEN,
          env.META_PAGE_ACCESS_TOKEN,
          env.META_ACCESS_TOKEN,
        ),
    graphVersion: firstNonEmpty(
      activeWorkspace?.graphVersion,
      localConfig?.graphVersion,
      env.PAGE_AUTOMATION_META_GRAPH_VERSION,
      env.META_GRAPH_VERSION,
      env.VITE_META_GRAPH_VERSION,
      DEFAULT_GRAPH_VERSION,
    ),
    graphHost: firstNonEmpty(
      activeWorkspace?.graphHost,
      localConfig?.graphHost,
      env.PAGE_AUTOMATION_META_GRAPH_HOST,
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
  if (!requestConfig) return []

  const payload = await graphGet<PageAccountsPayload>(requestConfig, `/${requestConfig.graphVersion}/me/accounts`, fetchImpl, {
    fields: 'id,name,username,followers_count',
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
    permissions: [buildPermissionReport(page.id, 'facebook', FACEBOOK_REQUIRED, now)],
    lastSyncedAt: now,
  }))
}

export async function fetchPageInsights(config: PageAutomationMetaConfig, pageId: string, fetchImpl: typeof fetch = fetch) {
  const requestConfig = graphRequestConfig(config)
  if (!requestConfig) return { reach: 0, engagementRate: 0 }

  const payload = await graphGet<PageInsightsPayload>(
    requestConfig,
    `/${requestConfig.graphVersion}/${encodeURIComponent(pageId)}/insights`,
    fetchImpl,
    {
      metric: 'page_impressions,page_post_engagements',
      period: 'day',
    },
  )
  const reach = metricValue(payload, 'page_impressions')
  const engagements = metricValue(payload, 'page_post_engagements')

  return {
    reach,
    engagementRate: reach > 0 ? (engagements / reach) * 100 : 0,
  }
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
    throw new Error(sanitizeMetaErrorMessage(`Meta API request failed: ${errorMessage(error)}`, config.accessToken))
  }

  const payload = (await response.json().catch(() => ({}))) as GraphErrorPayload
  const maybeError = payload.error
  if (!response.ok || maybeError) {
    throw new Error(sanitizeMetaErrorMessage(maybeError?.message || `Meta API request failed (${response.status})`, config.accessToken))
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
  return numericValue(row?.values?.[0]?.value)
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
