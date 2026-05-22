import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { persistRenderEnvVars } from './renderEnvPersistence.js'
import type {
  AdInsight,
  AdSetInsight,
  AgentTask,
  AIInsight,
  AppointmentStage,
  AudienceGeoTarget,
  AudienceTarget,
  AudienceTargeting,
  AuditEvent,
  AutoAdControl,
  CampaignInsight,
  ChannelPerformance,
  ComplianceReview,
  FunnelMetric,
  InsightComponent,
  MemoryItem,
  RecommendedAction,
  ServiceLine,
  WorkspaceData,
} from '../src/types'

const GRAPH_HOST = 'https://graph.facebook.com'
const DEFAULT_GRAPH_VERSION = 'v21.0'
const DEFAULT_DATE_PRESET = 'maximum'
const DEFAULT_MAX_PAGES = 6
const MAX_META_JSON_BODY_BYTES = 1_000_000
const LOCAL_CONFIG_FILE = resolve(process.cwd(), '.meta-api.local.json')

const INSIGHT_FIELDS = [
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'reach',
  'frequency',
  'actions',
  'action_values',
  'cost_per_action_type',
  'purchase_roas',
].join(',')

const PURCHASE_ACTION_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']
const LEAD_ACTION_TYPES = [
  'lead',
  'omni_lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.messaging_conversation_started_7d',
  'contact',
]
const BOOKING_ACTION_TYPES = [
  'schedule',
  'offsite_conversion.fb_pixel_schedule',
  'complete_registration',
  'offsite_conversion.fb_pixel_complete_registration',
  'submit_application',
]

interface MetaApiPluginEnv {
  [key: string]: string | undefined
}

interface MetaConfig {
  accessToken: string
  adAccountId: string
  graphVersion: string
  defaultDatePreset: string
  maxPages: number
  workspaceId: string
  workspaceLabel: string
  source: 'web-settings' | 'server-env'
}

interface PersistedMetaWorkspace {
  id: string
  label: string
  accessToken: string
  adAccountId: string
  graphVersion?: string
  defaultDatePreset?: string
  maxPages?: number
  savedAt?: string
  source?: 'web-settings' | 'server-env'
}

interface PersistedMetaConfig {
  accessToken?: string
  adAccountId?: string
  graphVersion?: string
  defaultDatePreset?: string
  maxPages?: number
  workspaceLabel?: string
  activeWorkspaceId?: string
  disconnected?: boolean
  workspaces?: PersistedMetaWorkspace[]
  savedAt?: string
}

interface MetaUserProfile {
  id: string
  name: string
}

interface MetaAdAccountInfo {
  id: string
  account_id: string
  name: string
  currency: string
  account_status: number
  amount_spent?: string
  balance?: string
  timezone_name?: string
}

interface MetaActionValue {
  action_type: string
  value: string
}

interface MetaInsightsRow {
  date_start?: string
  date_stop?: string
  spend?: string
  impressions?: string
  clicks?: string
  ctr?: string
  cpc?: string
  cpm?: string
  reach?: string
  frequency?: string
  actions?: MetaActionValue[]
  action_values?: MetaActionValue[]
  cost_per_action_type?: MetaActionValue[]
  purchase_roas?: MetaActionValue[]
}

interface MetaCampaignRow {
  id: string
  name: string
  status: string
  effective_status: string
  objective?: string
  daily_budget?: string
  lifetime_budget?: string
  start_time?: string
  stop_time?: string
  insights?: { data: MetaInsightsRow[] }
}

interface MetaAdSetRow {
  id: string
  name: string
  campaign_id?: string
  status: string
  effective_status: string
  daily_budget?: string
  lifetime_budget?: string
  optimization_goal?: string
  billing_event?: string
  targeting?: {
    age_min?: number
    age_max?: number
    genders?: number[]
    publisher_platforms?: string[]
    facebook_positions?: string[]
    instagram_positions?: string[]
    device_platforms?: string[]
    locales?: number[]
    geo_locations?: {
      countries?: string[]
      regions?: Array<{ key?: string; name?: string; country?: string; country_code?: string }>
      cities?: Array<{ key?: string; name?: string; region?: string; country?: string; country_code?: string; radius?: number; distance_unit?: string }>
      zips?: Array<{ key?: string; name?: string; primary_city?: string; region?: string; country?: string }>
      custom_locations?: Array<{ name?: string; latitude?: number; longitude?: number; radius?: number; distance_unit?: string; address_string?: string }>
      location_types?: string[]
    }
    excluded_geo_locations?: {
      countries?: string[]
      regions?: Array<{ key?: string; name?: string; country?: string; country_code?: string }>
      cities?: Array<{ key?: string; name?: string; region?: string; country?: string; country_code?: string }>
    }
    flexible_spec?: Array<Record<string, MetaTargetingEntity[] | undefined>>
    exclusions?: Record<string, MetaTargetingEntity[] | undefined>
    interests?: MetaTargetingEntity[]
    behaviors?: MetaTargetingEntity[]
    demographics?: MetaTargetingEntity[]
    custom_audiences?: MetaTargetingEntity[]
    excluded_custom_audiences?: MetaTargetingEntity[]
    lookalike_spec?: { type?: string; ratio?: number; country?: string; starting_ratio?: number }
  }
  insights?: { data: MetaInsightsRow[] }
}

interface MetaTargetingEntity {
  id?: string
  name?: string
  path?: string[]
  type?: string
}

interface MetaAdRow {
  id: string
  name: string
  adset_id?: string
  campaign_id?: string
  status: string
  effective_status: string
  creative?: { id: string; name?: string; thumbnail_url?: string }
  insights?: { data: MetaInsightsRow[] }
}

interface MetricSummary {
  spend: number
  revenue: number
  roas: number
  cpa: number
  ctr: number
  cpc: number
  cpm: number
  impressions: number
  reach: number
  clicks: number
  leads: number
  bookings: number
  purchases: number
  conversions: number
  frequency: number
}

type GraphParamValue = string | number | boolean | Record<string, unknown> | unknown[] | null | undefined

interface MetaApiRequest {
  url?: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
  on: (event: string, callback: (chunk?: Buffer | string) => void) => void
}

interface MetaApiResponse {
  statusCode: number
  setHeader: (key: string, value: string) => void
  end: (body: string) => void
}

class MetaApiError extends Error {
  status: number
  fbCode?: number
  fbType?: string

  constructor(message: string, status: number, fbCode?: number, fbType?: string) {
    super(message)
    this.name = 'MetaApiError'
    this.status = status
    this.fbCode = fbCode
    this.fbType = fbType
  }
}

export function createMetaApiPlugin(env: MetaApiPluginEnv): Plugin {
  return {
    name: 'clinicstellar-meta-api',
    configureServer(server) {
      server.middlewares.use(createMetaApiMiddleware(env))
    },
  }
}

export function createMetaApiMiddleware(env: MetaApiPluginEnv) {
  return async (req: MetaApiRequest, res: MetaApiResponse, next: () => void = () => undefined) => {
    if (!req.url?.startsWith('/api/meta/')) {
      next()
      return
    }

    try {
      const requestUrl = new URL(req.url, 'http://localhost')
      const config = await readMetaConfig(env)

      if (requestUrl.pathname === '/api/meta/status') {
        const connection = config ? await checkMetaConnection(config) : null
        const configState = await getConfigState(env)
        writeJson(res, 200, {
          configured: Boolean(config),
          connected: Boolean(connection?.ok),
          graphVersion: config?.graphVersion ?? env.META_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION,
          adAccountId: config ? maskAdAccountId(config.adAccountId) : null,
          activeWorkspaceId: config?.workspaceId ?? configState.activeWorkspaceId ?? null,
          workspaceLabel: config?.workspaceLabel ?? configState.workspaceLabel ?? null,
          workspaces: configState.workspaces,
          datePreset: config?.defaultDatePreset ?? DEFAULT_DATE_PRESET,
          source: 'Meta Marketing API',
          settingsSource: config?.source ?? null,
          tokenLocation: config?.source === 'web-settings' ? 'server-local-file' : 'server-env',
          canEditInWeb: true,
          connection,
          requiredEnv: await buildConfigChecks(env),
        })
        return
      }

      if (requestUrl.pathname === '/api/meta/config') {
        if (req.method === 'GET') {
          writeJson(res, 200, await getConfigState(env))
          return
        }

        if (req.method === 'POST') {
          assertJsonRequest(req)
          const body = await readJsonBody(req)
          const action = typeof body.action === 'string' ? body.action.trim() : ''

          if (action === 'switch') {
            const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
            const result = await switchActiveWorkspace(env, workspaceId)
            writeJson(res, 200, result)
            return
          }

          if (action === 'disconnect') {
            const result = await disconnectMetaConfig(env)
            writeJson(res, 200, result)
            return
          }

          const existing = await readLocalConfig()
          const nextConfig = normalizeSubmittedConfig(body, existing)
          const candidateWorkspace = getActiveWorkspace(nextConfig)
          if (!candidateWorkspace?.accessToken || !candidateWorkspace.adAccountId) {
            writeJson(res, 400, {
              ok: false,
              error: 'กรุณาใส่ Access Token และ Ad Account ID',
              checkedAt: new Date().toISOString(),
              checks: [
                {
                  key: 'accessToken',
                  label: 'Access Token',
                  status: candidateWorkspace?.accessToken ? 'pass' : 'fail',
                  detail: candidateWorkspace?.accessToken ? 'ready' : 'ต้องใส่ token หรือมี token saved อยู่แล้ว',
                },
                {
                  key: 'adAccountId',
                  label: 'Ad Account ID',
                  status: candidateWorkspace?.adAccountId ? 'pass' : 'fail',
                  detail: candidateWorkspace?.adAccountId ? 'ready' : 'ใส่ได้ทั้ง act_123 หรือ 123',
                },
              ],
            })
            return
          }

          const candidateConfig = buildMetaConfigFromWorkspace(candidateWorkspace, env, 'web-settings')
          const result = await checkMetaConnection(candidateConfig)
          if (!result.ok) {
            writeJson(res, 400, {
              ...result,
              configured: false,
              settingsSource: null,
              error: 'Meta API config validation failed. Credentials were not saved.',
            })
            return
          }

          const verifiedConfig = applyVerifiedWorkspaceLabel(nextConfig, result.account?.name ?? '')
          await saveLocalConfig(verifiedConfig)
          const renderPersistence = await persistMetaConfigToRender(env, verifiedConfig)
          writeJson(res, 200, {
            ...result,
            configured: true,
            settingsSource: candidateConfig.source,
            activeWorkspaceId: verifiedConfig.activeWorkspaceId,
            workspaceLabel: getActiveWorkspace(verifiedConfig)?.label ?? candidateConfig.workspaceLabel,
            workspaces: buildWorkspaceOptions(verifiedConfig, normalizePersistedConfig(verifiedConfig)?.workspaces ?? []),
            renderPersistence,
          })
          return
        }

        if (req.method === 'DELETE') {
          const result = await disconnectMetaConfig(env)
          writeJson(res, 200, result)
          return
        }

        writeJson(res, 405, { error: 'Method not allowed' })
        return
      }

      if (requestUrl.pathname === '/api/meta/check') {
        if (!config) {
          writeJson(res, 400, {
            ok: false,
            checkedAt: new Date().toISOString(),
            error: 'Meta API ยังไม่ได้ตั้งค่า กรุณาใส่ META_ACCESS_TOKEN และ META_AD_ACCOUNT_ID ใน .env',
            checks: (await buildConfigChecks(env)).map((item) => ({
              key: item.key,
              label: item.key,
              status: item.present ? 'pass' : item.source.includes('optional') ? 'warn' : 'fail',
              detail: item.present ? 'configured' : item.help,
            })),
          })
          return
        }

        const result = await checkMetaConnection(config)
        writeJson(res, 200, result)
        return
      }

      if (requestUrl.pathname === '/api/meta/workspace') {
        if (!config) {
          writeJson(res, 400, {
            error: 'Meta API ยังไม่ได้ตั้งค่า กรุณาใส่ META_ACCESS_TOKEN และ META_AD_ACCOUNT_ID ใน .env',
          })
          return
        }

        const datePreset = requestUrl.searchParams.get('datePreset') || config.defaultDatePreset
        const result = await fetchMetaWorkspace(config, datePreset)
        writeJson(res, 200, result)
        return
      }

      if (requestUrl.pathname === '/api/meta/object-status') {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        if (!config) {
          writeJson(res, 400, {
            error: 'Meta API ยังไม่ได้ตั้งค่า กรุณาใส่ Access Token และ Ad Account ID ใน Settings',
          })
          return
        }

        assertJsonRequest(req)
        const body = await readJsonBody(req)
        const result = await updateMetaObjectStatus(config, body)
        writeJson(res, 200, result)
        return
      }

      if (requestUrl.pathname === '/api/meta/bulk-status') {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        if (!config) {
          writeJson(res, 400, {
            error: 'Meta API ยังไม่ได้ตั้งค่า กรุณาใส่ Access Token และ Ad Account ID ใน Settings',
          })
          return
        }

        assertJsonRequest(req)
        const body = await readJsonBody(req)
        const result = await updateMetaObjectStatuses(config, body)
        writeJson(res, 200, result)
        return
      }

      if (requestUrl.pathname === '/api/meta/object') {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        if (!config) {
          writeJson(res, 400, {
            error: 'Meta API ยังไม่ได้ตั้งค่า กรุณาใส่ Access Token และ Ad Account ID ใน Settings',
          })
          return
        }

        assertJsonRequest(req)
        const body = await readJsonBody(req)
        const result = await mutateMetaObject(config, body)
        writeJson(res, 200, result)
        return
      }

      if (requestUrl.pathname === '/api/meta/creative-launch') {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        if (!config) {
          writeJson(res, 400, {
            error: 'Meta API ยังไม่ได้ตั้งค่า กรุณาใส่ Access Token และ Ad Account ID ใน Settings',
          })
          return
        }

        assertJsonRequest(req)
        const body = await readJsonBody(req)
        const result = await launchMetaCreative(config, body)
        writeJson(res, 200, result)
        return
      }

      writeJson(res, 404, { error: 'Unknown Meta API endpoint' })
    } catch (error) {
      const status = error instanceof MetaApiError ? error.status : 500
      writeJson(res, status, {
        error: error instanceof Error ? error.message : 'Unknown Meta API error',
        fbCode: error instanceof MetaApiError ? error.fbCode : undefined,
        fbType: error instanceof MetaApiError ? error.fbType : undefined,
      })
    }
  }
}

export async function readMetaWorkspaceForPageAutomation(env: MetaApiPluginEnv, datePreset: string): Promise<WorkspaceData | null> {
  const config = await readMetaConfig(env)
  if (!config) return null

  const result = await fetchMetaWorkspace(config, datePreset)
  return result.workspace
}

async function readMetaConfig(env: MetaApiPluginEnv): Promise<MetaConfig | null> {
  const localConfig = await readLocalConfig()
  if (localConfig?.disconnected) return null

  const workspaces = collectMetaWorkspaces(localConfig, env)
  const activeWorkspace = findActiveWorkspace(workspaces, localConfig?.activeWorkspaceId || readEnvActiveWorkspaceId(env))
  return activeWorkspace ? buildMetaConfigFromWorkspace(activeWorkspace, env, activeWorkspace.source ?? 'web-settings') : null
}

function buildMetaConfigFromWorkspace(workspace: PersistedMetaWorkspace, env: MetaApiPluginEnv, source: 'web-settings' | 'server-env'): MetaConfig {
  return {
    accessToken: workspace.accessToken.trim(),
    adAccountId: normalizeAdAccountId(workspace.adAccountId),
    graphVersion: (workspace.graphVersion || env.META_GRAPH_VERSION || process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim(),
    defaultDatePreset: (workspace.defaultDatePreset || env.META_DATE_PRESET || process.env.META_DATE_PRESET || DEFAULT_DATE_PRESET).trim(),
    maxPages: clampMaxPages(Number(workspace.maxPages || env.META_MAX_PAGES || process.env.META_MAX_PAGES || DEFAULT_MAX_PAGES)),
    workspaceId: workspace.id,
    workspaceLabel: workspace.label || maskAdAccountId(workspace.adAccountId),
    source,
  }
}

async function getConfigState(env: MetaApiPluginEnv) {
  const localConfig = await readLocalConfig()
  const config = await readMetaConfig(env)
  const workspaces = localConfig?.disconnected ? [] : collectMetaWorkspaces(localConfig, env)
  const activeWorkspace = config ? findActiveWorkspace(workspaces, config.workspaceId) : null
  return {
    configured: Boolean(config),
    settingsSource: config?.source ?? null,
    hasSavedToken: Boolean(normalizePersistedConfig(localConfig)?.workspaces?.some((workspace) => workspace.accessToken)),
    adAccountId: activeWorkspace ? maskAdAccountId(activeWorkspace.adAccountId) : '',
    activeWorkspaceId: activeWorkspace?.id ?? null,
    workspaceLabel: activeWorkspace?.label ?? null,
    workspaces: buildWorkspaceOptions(localConfig, workspaces),
    graphVersion: localConfig?.graphVersion ?? config?.graphVersion ?? DEFAULT_GRAPH_VERSION,
    datePreset: localConfig?.defaultDatePreset ?? config?.defaultDatePreset ?? DEFAULT_DATE_PRESET,
    maxPages: localConfig?.maxPages ?? config?.maxPages ?? DEFAULT_MAX_PAGES,
    requiredEnv: await buildConfigChecks(env),
  }
}

async function readLocalConfig(): Promise<PersistedMetaConfig | null> {
  try {
    const raw = await readFile(LOCAL_CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as PersistedMetaConfig
    if (!parsed || typeof parsed !== 'object') return null
    return normalizePersistedConfig(parsed)
  } catch {
    return null
  }
}

async function saveLocalConfig(config: PersistedMetaConfig) {
  const normalized = normalizePersistedConfig(config) ?? config
  const activeWorkspace = getActiveWorkspace(normalized)
  await writeFile(
    LOCAL_CONFIG_FILE,
    JSON.stringify(
      {
        ...normalized,
        accessToken: activeWorkspace?.accessToken ?? '',
        adAccountId: activeWorkspace?.adAccountId ? normalizeAdAccountId(activeWorkspace.adAccountId) : '',
        graphVersion: activeWorkspace?.graphVersion ?? normalized.graphVersion ?? DEFAULT_GRAPH_VERSION,
        defaultDatePreset: activeWorkspace?.defaultDatePreset ?? normalized.defaultDatePreset ?? DEFAULT_DATE_PRESET,
        maxPages: activeWorkspace?.maxPages ?? normalized.maxPages ?? DEFAULT_MAX_PAGES,
        workspaceLabel: activeWorkspace?.label ?? normalized.workspaceLabel ?? '',
        activeWorkspaceId: normalized.activeWorkspaceId ?? activeWorkspace?.id ?? '',
        workspaces: (normalized.workspaces ?? []).map((workspace) => ({
          ...workspace,
          adAccountId: normalizeAdAccountId(workspace.adAccountId),
          graphVersion: workspace.graphVersion || DEFAULT_GRAPH_VERSION,
          defaultDatePreset: workspace.defaultDatePreset || DEFAULT_DATE_PRESET,
          maxPages: clampMaxPages(Number(workspace.maxPages || DEFAULT_MAX_PAGES)),
          source: 'web-settings',
          savedAt: workspace.savedAt || new Date().toISOString(),
        })),
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { encoding: 'utf-8', mode: 0o600 },
  )
}

function normalizeSubmittedConfig(body: Record<string, unknown>, existing: PersistedMetaConfig | null): PersistedMetaConfig {
  const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '')
  const base = normalizePersistedConfig(existing) ?? { workspaces: [] }
  const existingWorkspaces = [...(base.workspaces ?? [])]
  const shouldAddAsNew = body.addAsNew === true || text('mode') === 'add'
  const requestedWorkspaceId = text('workspaceId')
  const currentWorkspace = requestedWorkspaceId
    ? existingWorkspaces.find((workspace) => workspace.id === requestedWorkspaceId)
    : getActiveWorkspace(base)
  const accessToken = text('accessToken') || currentWorkspace?.accessToken || ''
  const adAccountId = text('adAccountId') || currentWorkspace?.adAccountId || ''
  const graphVersion = text('graphVersion') || currentWorkspace?.graphVersion || base.graphVersion || DEFAULT_GRAPH_VERSION
  const defaultDatePreset = text('datePreset') || text('defaultDatePreset') || currentWorkspace?.defaultDatePreset || base.defaultDatePreset || DEFAULT_DATE_PRESET
  const maxPages = clampMaxPages(Number(body.maxPages || currentWorkspace?.maxPages || base.maxPages || DEFAULT_MAX_PAGES))
  const label = text('workspaceLabel') || text('label') || currentWorkspace?.label || maskAdAccountId(adAccountId || 'act_0000')
  const workspaceId = shouldAddAsNew || !currentWorkspace
    ? createWorkspaceId(adAccountId, label, existingWorkspaces)
    : currentWorkspace.id
  const nextWorkspace: PersistedMetaWorkspace = {
    id: workspaceId,
    label,
    accessToken,
    adAccountId: adAccountId ? normalizeAdAccountId(adAccountId) : '',
    graphVersion,
    defaultDatePreset,
    maxPages,
    source: 'web-settings',
    savedAt: new Date().toISOString(),
  }
  const nextWorkspaces = existingWorkspaces.some((workspace) => workspace.id === workspaceId)
    ? existingWorkspaces.map((workspace) => (workspace.id === workspaceId ? nextWorkspace : workspace))
    : [...existingWorkspaces, nextWorkspace]

  return {
    ...base,
    disconnected: false,
    activeWorkspaceId: workspaceId,
    accessToken,
    adAccountId: nextWorkspace.adAccountId,
    graphVersion,
    defaultDatePreset,
    maxPages,
    workspaceLabel: label,
    workspaces: nextWorkspaces,
  }
}

async function buildConfigChecks(env: MetaApiPluginEnv) {
  const read = (key: string) => env[key] || process.env[key] || ''
  const localConfig = await readLocalConfig()
  const localWorkspaces = normalizePersistedConfig(localConfig)?.workspaces ?? []
  const envWorkspaces = readEnvWorkspaces(env)
  const hasLocalWorkspace = !localConfig?.disconnected && localWorkspaces.some((workspace) => workspace.accessToken && workspace.adAccountId)
  const hasEnvWorkspace = envWorkspaces.some((workspace) => workspace.accessToken && workspace.adAccountId)
  const source = hasLocalWorkspace ? 'web settings' : hasEnvWorkspace ? 'Render env workspace' : 'server .env'
  const optionalSource = localConfig ? 'web settings optional' : 'server .env optional'
  return [
    {
      key: 'META_WORKSPACES_JSON',
      present: hasLocalWorkspace || hasEnvWorkspace,
      source,
      help: 'เก็บหลาย Ads Account เป็น workspace แยกกันเพื่อให้ deploy รอบถัดไปยังเชื่อมต่ออยู่',
    },
    {
      key: 'META_ACCESS_TOKEN',
      present: Boolean(hasLocalWorkspace || hasEnvWorkspace || read('META_ACCESS_TOKEN').trim()),
      source,
      help: 'ต้องเป็น token ที่มี ads_read สำหรับอ่าน insights',
    },
    {
      key: 'META_AD_ACCOUNT_ID',
      present: Boolean(hasLocalWorkspace || hasEnvWorkspace || read('META_AD_ACCOUNT_ID').trim()),
      source,
      help: 'ใส่ได้ทั้ง act_123 หรือ 123',
    },
    {
      key: 'META_GRAPH_VERSION',
      present: Boolean(localConfig?.graphVersion || hasEnvWorkspace || read('META_GRAPH_VERSION').trim()),
      source: optionalSource,
      help: `ไม่ใส่จะใช้ ${DEFAULT_GRAPH_VERSION}`,
    },
    {
      key: 'META_DATE_PRESET',
      present: Boolean(localConfig?.defaultDatePreset || read('META_DATE_PRESET').trim()),
      source: optionalSource,
      help: `ไม่ใส่จะใช้ ${DEFAULT_DATE_PRESET}`,
    },
  ]
}

function normalizePersistedConfig(config: PersistedMetaConfig | null): PersistedMetaConfig | null {
  if (!config || typeof config !== 'object') return null

  const workspaces = Array.isArray(config.workspaces)
    ? config.workspaces.map((workspace) => normalizeWorkspaceRecord(workspace, 'web-settings')).filter(isPersistedMetaWorkspace)
    : []
  if (workspaces.length === 0 && config.accessToken && config.adAccountId) {
    const legacyWorkspace = normalizeWorkspaceRecord(
      {
        id: config.activeWorkspaceId || createWorkspaceId(config.adAccountId, config.workspaceLabel || '', []),
        label: config.workspaceLabel || maskAdAccountId(config.adAccountId),
        accessToken: config.accessToken,
        adAccountId: config.adAccountId,
        graphVersion: config.graphVersion,
        defaultDatePreset: config.defaultDatePreset,
        maxPages: config.maxPages,
        savedAt: config.savedAt,
        source: 'web-settings',
      },
      'web-settings',
    )
    if (legacyWorkspace) workspaces.push(legacyWorkspace)
  }

  const activeWorkspaceId = config.activeWorkspaceId || workspaces[0]?.id || ''
  const activeWorkspace = findActiveWorkspace(workspaces, activeWorkspaceId)
  return {
    ...config,
    accessToken: activeWorkspace?.accessToken ?? config.accessToken ?? '',
    adAccountId: activeWorkspace?.adAccountId ?? config.adAccountId ?? '',
    graphVersion: activeWorkspace?.graphVersion ?? config.graphVersion ?? DEFAULT_GRAPH_VERSION,
    defaultDatePreset: activeWorkspace?.defaultDatePreset ?? config.defaultDatePreset ?? DEFAULT_DATE_PRESET,
    maxPages: activeWorkspace?.maxPages ?? config.maxPages ?? DEFAULT_MAX_PAGES,
    workspaceLabel: activeWorkspace?.label ?? config.workspaceLabel ?? '',
    activeWorkspaceId,
    workspaces,
  }
}

function normalizeWorkspaceRecord(raw: unknown, fallbackSource: 'web-settings' | 'server-env'): PersistedMetaWorkspace | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const accessToken = typeof record.accessToken === 'string' ? record.accessToken.trim() : ''
  const adAccountId = typeof record.adAccountId === 'string' ? record.adAccountId.trim() : ''
  if (!accessToken || !adAccountId) return null
  const label = typeof record.label === 'string' && record.label.trim()
    ? record.label.trim()
    : typeof record.workspaceLabel === 'string' && record.workspaceLabel.trim()
      ? record.workspaceLabel.trim()
      : maskAdAccountId(adAccountId)
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : createWorkspaceId(adAccountId, label, [])
  const source = record.source === 'server-env' || record.source === 'web-settings' ? record.source : fallbackSource
  return {
    id,
    label,
    accessToken,
    adAccountId: normalizeAdAccountId(adAccountId),
    graphVersion: typeof record.graphVersion === 'string' && record.graphVersion.trim() ? record.graphVersion.trim() : DEFAULT_GRAPH_VERSION,
    defaultDatePreset: typeof record.defaultDatePreset === 'string' && record.defaultDatePreset.trim() ? record.defaultDatePreset.trim() : DEFAULT_DATE_PRESET,
    maxPages: clampMaxPages(Number(record.maxPages || DEFAULT_MAX_PAGES)),
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : undefined,
    source,
  }
}

function collectMetaWorkspaces(localConfig: PersistedMetaConfig | null, env: MetaApiPluginEnv) {
  const localWorkspaces = normalizePersistedConfig(localConfig)?.workspaces ?? []
  const envWorkspaces = readEnvWorkspaces(env)
  const envSingleWorkspace = readSingleEnvWorkspace(env)
  return dedupeWorkspaces([...localWorkspaces, ...envWorkspaces, ...(envSingleWorkspace ? [envSingleWorkspace] : [])])
}

function readEnvWorkspaces(env: MetaApiPluginEnv) {
  const raw = (env.META_WORKSPACES_JSON || process.env.META_WORKSPACES_JSON || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { workspaces?: unknown[] }).workspaces)
        ? (parsed as { workspaces: unknown[] }).workspaces
        : []
    return list.map((item) => normalizeWorkspaceRecord(item, 'server-env')).filter(isPersistedMetaWorkspace)
  } catch {
    return []
  }
}

function isPersistedMetaWorkspace(workspace: PersistedMetaWorkspace | null): workspace is PersistedMetaWorkspace {
  return Boolean(workspace)
}

function readEnvActiveWorkspaceId(env: MetaApiPluginEnv) {
  const explicit = (env.META_ACTIVE_WORKSPACE_ID || process.env.META_ACTIVE_WORKSPACE_ID || '').trim()
  if (explicit) return explicit
  const raw = (env.META_WORKSPACES_JSON || process.env.META_WORKSPACES_JSON || '').trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as { activeWorkspaceId?: unknown }
    return typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId.trim() : ''
  } catch {
    return ''
  }
}

function readSingleEnvWorkspace(env: MetaApiPluginEnv): PersistedMetaWorkspace | null {
  const accessToken = (env.META_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '').trim()
  const adAccountId = (env.META_AD_ACCOUNT_ID || process.env.META_AD_ACCOUNT_ID || '').trim()
  if (!accessToken || !adAccountId) return null
  return normalizeWorkspaceRecord(
    {
      id: createWorkspaceId(adAccountId, env.META_WORKSPACE_LABEL || process.env.META_WORKSPACE_LABEL || '', []),
      label: env.META_WORKSPACE_LABEL || process.env.META_WORKSPACE_LABEL || maskAdAccountId(adAccountId),
      accessToken,
      adAccountId,
      graphVersion: env.META_GRAPH_VERSION || process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
      defaultDatePreset: env.META_DATE_PRESET || process.env.META_DATE_PRESET || DEFAULT_DATE_PRESET,
      maxPages: env.META_MAX_PAGES || process.env.META_MAX_PAGES || DEFAULT_MAX_PAGES,
      source: 'server-env',
    },
    'server-env',
  )
}

function dedupeWorkspaces(workspaces: PersistedMetaWorkspace[]) {
  const seen = new Set<string>()
  const output: PersistedMetaWorkspace[] = []
  for (const workspace of workspaces) {
    if (!workspace.id || seen.has(workspace.id)) continue
    seen.add(workspace.id)
    output.push(workspace)
  }
  return output
}

function findActiveWorkspace(workspaces: PersistedMetaWorkspace[], activeWorkspaceId?: string | null) {
  if (!workspaces.length) return null
  return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0]
}

function getActiveWorkspace(config: PersistedMetaConfig | null) {
  const normalized = normalizePersistedConfig(config)
  return normalized?.workspaces?.find((workspace) => workspace.id === normalized.activeWorkspaceId) ?? normalized?.workspaces?.[0] ?? null
}

function buildWorkspaceOptions(localConfig: PersistedMetaConfig | null, workspaces: PersistedMetaWorkspace[]) {
  const activeWorkspaceId = normalizePersistedConfig(localConfig)?.activeWorkspaceId || workspaces[0]?.id || ''
  return workspaces.map((workspace) => ({
    id: workspace.id,
    label: workspace.label,
    adAccountId: maskAdAccountId(workspace.adAccountId),
    graphVersion: workspace.graphVersion || DEFAULT_GRAPH_VERSION,
    datePreset: workspace.defaultDatePreset || DEFAULT_DATE_PRESET,
    maxPages: workspace.maxPages || DEFAULT_MAX_PAGES,
    source: workspace.source || 'web-settings',
    active: workspace.id === activeWorkspaceId,
  }))
}

function applyVerifiedWorkspaceLabel(config: PersistedMetaConfig, accountName: string): PersistedMetaConfig {
  const activeWorkspace = getActiveWorkspace(config)
  if (!activeWorkspace || !accountName || activeWorkspace.label !== maskAdAccountId(activeWorkspace.adAccountId)) return config
  const workspaces = (config.workspaces ?? []).map((workspace) => (workspace.id === activeWorkspace.id ? { ...workspace, label: accountName } : workspace))
  return {
    ...config,
    workspaceLabel: accountName,
    workspaces,
  }
}

async function switchActiveWorkspace(env: MetaApiPluginEnv, workspaceId: string) {
  const localConfig = await readLocalConfig()
  const workspaces = collectMetaWorkspaces(localConfig, env)
  const workspace = workspaces.find((item) => item.id === workspaceId)
  if (!workspace) {
    throw new MetaApiError('ไม่พบ Ads Account workspace ที่เลือก', 404)
  }

  const candidateConfig = buildMetaConfigFromWorkspace(workspace, env, workspace.source ?? 'web-settings')
  const result = await checkMetaConnection(candidateConfig)
  if (!result.ok) {
    throw new MetaApiError('เชื่อมต่อ Ads Account ที่เลือกไม่สำเร็จ กรุณาตรวจ token และสิทธิ์ Meta', 400)
  }

  await saveLocalConfig({
    ...(localConfig ?? {}),
    disconnected: false,
    activeWorkspaceId: workspace.id,
  })
  const state = await getConfigState(env)
  return {
    ...result,
    ...state,
    configured: true,
    settingsSource: candidateConfig.source,
  }
}

async function disconnectMetaConfig(env: MetaApiPluginEnv) {
  await saveLocalConfig({
    disconnected: true,
    activeWorkspaceId: '',
    workspaces: [],
  })
  const renderPersistence = await persistRenderEnvVars(env, {
    META_WORKSPACES_JSON: '',
    META_ACTIVE_WORKSPACE_ID: '',
    META_ACCESS_TOKEN: '',
    META_AD_ACCOUNT_ID: '',
  })
  const state = await getConfigState(env)
  return {
    ...state,
    configured: false,
    connected: false,
    renderPersistence,
  }
}

async function persistMetaConfigToRender(env: MetaApiPluginEnv, config: PersistedMetaConfig) {
  const activeWorkspace = getActiveWorkspace(config)
  const workspaces = (normalizePersistedConfig(config)?.workspaces ?? []).map((workspace) => ({
    id: workspace.id,
    label: workspace.label,
    accessToken: workspace.accessToken,
    adAccountId: normalizeAdAccountId(workspace.adAccountId),
    graphVersion: workspace.graphVersion || DEFAULT_GRAPH_VERSION,
    defaultDatePreset: workspace.defaultDatePreset || DEFAULT_DATE_PRESET,
    maxPages: workspace.maxPages || DEFAULT_MAX_PAGES,
  }))
  return persistRenderEnvVars(env, {
    META_WORKSPACES_JSON: JSON.stringify({
      activeWorkspaceId: config.activeWorkspaceId || activeWorkspace?.id || workspaces[0]?.id || '',
      workspaces,
    }),
    META_ACTIVE_WORKSPACE_ID: config.activeWorkspaceId || activeWorkspace?.id || '',
    META_ACCESS_TOKEN: activeWorkspace?.accessToken ?? '',
    META_AD_ACCOUNT_ID: activeWorkspace?.adAccountId ?? '',
    META_GRAPH_VERSION: activeWorkspace?.graphVersion || DEFAULT_GRAPH_VERSION,
    META_DATE_PRESET: activeWorkspace?.defaultDatePreset || DEFAULT_DATE_PRESET,
    META_MAX_PAGES: activeWorkspace?.maxPages || DEFAULT_MAX_PAGES,
  })
}

function createWorkspaceId(adAccountId: string, label: string, existing: PersistedMetaWorkspace[]) {
  const baseSource = normalizeAdAccountId(adAccountId || 'act_workspace').replace(/^act_/, '') || label || 'workspace'
  const base = `meta-${baseSource.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'}`
  if (!existing.some((workspace) => workspace.id === base)) return base
  let index = existing.length + 1
  while (existing.some((workspace) => workspace.id === `${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function clampMaxPages(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(20, Math.round(value))) : DEFAULT_MAX_PAGES
}

function assertJsonRequest(req: MetaApiRequest) {
  const contentType = headerValue(req.headers?.['content-type']).toLowerCase()
  if (!contentType.includes('application/json')) {
    throw new MetaApiError('Content-Type must be application/json', 415)
  }
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join(',')
  return value ?? ''
}

function readJsonBody(
  req: { on: (event: string, callback: (chunk?: Buffer | string) => void) => void },
  maxBytes = MAX_META_JSON_BODY_BYTES,
): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let done = false
    const fail = (error: Error) => {
      if (done) return
      done = true
      reject(error)
    }

    req.on('data', (chunk?: Buffer | string) => {
      if (done || !chunk) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.byteLength
      if (totalBytes > maxBytes) {
        fail(new MetaApiError(`Request body too large. Limit ${Math.round(maxBytes / 1024)} KB.`, 413))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (done) return
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        done = true
        resolveBody(parsed)
      } catch (error) {
        fail(
          error instanceof SyntaxError
            ? new MetaApiError('Invalid JSON body', 400)
            : error instanceof Error
              ? error
              : new MetaApiError('Invalid JSON body', 400),
        )
      }
    })
    req.on('error', () => fail(new MetaApiError('Request body read failed', 400)))
  })
}

async function checkMetaConnection(config: MetaConfig) {
  const startedAt = Date.now()
  const [userResult, accountResult, insightsResult] = await Promise.all([
    settled(graphGet<MetaUserProfile>(config, '/me', { fields: 'id,name' })),
    settled(graphGet<MetaAdAccountInfo>(config, `/${config.adAccountId}`, {
      fields: 'id,account_id,name,currency,account_status,timezone_name',
    })),
    settled(graphGet<{ data?: MetaInsightsRow[] }>(config, `/${config.adAccountId}/insights`, {
      fields: 'spend,impressions,clicks',
      date_preset: config.defaultDatePreset,
      limit: 1,
    })),
  ])
  const ok = Boolean(userResult.data && accountResult.data && insightsResult.data)

  return {
    ok,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    graphVersion: config.graphVersion,
    datePreset: config.defaultDatePreset,
    adAccountId: maskAdAccountId(config.adAccountId),
    user: userResult.data ? { id: userResult.data.id, name: userResult.data.name } : null,
    account: accountResult.data
      ? {
          id: accountResult.data.id,
          account_id: accountResult.data.account_id,
          name: accountResult.data.name,
          currency: accountResult.data.currency,
          account_status: accountResult.data.account_status,
          timezone_name: accountResult.data.timezone_name,
        }
      : null,
    checks: [
      {
        key: 'env',
        label: 'Server env',
        status: 'pass',
        detail: 'META_ACCESS_TOKEN และ META_AD_ACCOUNT_ID ถูกโหลดจาก server แล้ว',
      },
      {
        key: 'user',
        label: '/me',
        status: userResult.data ? 'pass' : 'fail',
        detail: userResult.data ? `Token owner: ${userResult.data.name}` : userResult.error,
      },
      {
        key: 'account',
        label: 'Ad account',
        status: accountResult.data ? 'pass' : 'fail',
        detail: accountResult.data ? `${accountResult.data.name} (${accountResult.data.currency})` : accountResult.error,
      },
      {
        key: 'insights',
        label: 'Insights read',
        status: insightsResult.data ? 'pass' : 'fail',
        detail: insightsResult.data ? `อ่าน insights ด้วย ${config.defaultDatePreset} ได้` : insightsResult.error,
      },
    ],
  }
}

async function settled<T>(promise: Promise<T>): Promise<{ data: T | null; error: string }> {
  try {
    return { data: await promise, error: '' }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

function writeJson(res: { statusCode: number; setHeader: (key: string, value: string) => void; end: (body: string) => void }, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function normalizeAdAccountId(id: string) {
  const trimmed = id.trim()
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`
}

function maskAdAccountId(id: string) {
  const clean = id.replace(/^act_/, '')
  if (clean.length <= 4) return `act_${clean}`
  return `act_${clean.slice(0, 2)}...${clean.slice(-4)}`
}

async function graphGet<T>(config: MetaConfig, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(`${GRAPH_HOST}/${config.graphVersion}${path}`)
  url.searchParams.set('access_token', config.accessToken)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const response = await fetch(url)
  const json = await response.json().catch(() => ({}))
  const maybeError = (json as { error?: { message?: string; code?: number; type?: string } }).error

  if (!response.ok || maybeError) {
    throw new MetaApiError(
      maybeError?.message || `Meta API request failed (${response.status})`,
      response.status,
      maybeError?.code,
      maybeError?.type,
    )
  }

  return json as T
}

function appendGraphParams(body: URLSearchParams, params: Record<string, GraphParamValue>) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || key === 'access_token') continue
    body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
}

async function graphGetAllPages<T>(config: MetaConfig, path: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> {
  const firstPage = await graphGet<{ data?: T[]; paging?: { next?: string } }>(config, path, params)
  const records = [...(firstPage.data ?? [])]
  let nextUrl = firstPage.paging?.next
  let pages = 1

  while (nextUrl && pages < config.maxPages) {
    try {
      const response = await fetch(nextUrl)
      const json = (await response.json().catch(() => ({}))) as { data?: T[]; paging?: { next?: string }; error?: { message?: string } }
      if (!response.ok || json.error) {
        if (records.length > 0) break
        throw new MetaApiError(json.error?.message || 'Meta API paging request failed', response.status)
      }
      if (!json.data?.length) break
      records.push(...json.data)
      nextUrl = json.paging?.next
      pages += 1
    } catch (error) {
      if (records.length > 0) break
      throw error
    }
  }

  return records
}

async function graphPost<T>(config: MetaConfig, path: string, params: Record<string, GraphParamValue>): Promise<T> {
  const url = new URL(`${GRAPH_HOST}/${config.graphVersion}${path}`)
  const body = new URLSearchParams()
  body.set('access_token', config.accessToken)
  appendGraphParams(body, params)

  const response = await fetch(url, {
    method: 'POST',
    body,
  })
  const json = await response.json().catch(() => ({}))
  const maybeError = (json as { error?: { message?: string; code?: number; type?: string } }).error

  if (!response.ok || maybeError) {
    throw new MetaApiError(
      maybeError?.message || `Meta API request failed (${response.status})`,
      response.status,
      maybeError?.code,
      maybeError?.type,
    )
  }

  return json as T
}

async function graphDelete<T>(config: MetaConfig, path: string): Promise<T> {
  const url = new URL(`${GRAPH_HOST}/${config.graphVersion}${path}`)
  url.searchParams.set('access_token', config.accessToken)

  const response = await fetch(url, { method: 'DELETE' })
  const json = await response.json().catch(() => ({}))
  const maybeError = (json as { error?: { message?: string; code?: number; type?: string } }).error

  if (!response.ok || maybeError) {
    throw new MetaApiError(
      maybeError?.message || `Meta API request failed (${response.status})`,
      response.status,
      maybeError?.code,
      maybeError?.type,
    )
  }

  return json as T
}

async function updateMetaObjectStatus(config: MetaConfig, body: Record<string, unknown>) {
  const action = readMetaStatusAction(body)
  return executeMetaObjectStatus(config, action)
}

async function updateMetaObjectStatuses(config: MetaConfig, body: Record<string, unknown>) {
  const rawActions = Array.isArray(body.actions) ? body.actions : []
  if (rawActions.length === 0) {
    throw new MetaApiError('Missing status actions', 400)
  }
  if (rawActions.length > 25) {
    throw new MetaApiError('Bulk status update is limited to 25 actions per request.', 400)
  }

  const results = []
  for (const rawAction of rawActions) {
    if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) {
      throw new MetaApiError('Invalid status action payload', 400)
    }
    results.push(await executeMetaObjectStatus(config, readMetaStatusAction(rawAction as Record<string, unknown>)))
  }

  return {
    ok: true,
    count: results.length,
    checkedAt: new Date().toISOString(),
    source: 'Meta Marketing API',
    results,
  }
}

function readMetaStatusAction(body: Record<string, unknown>) {
  const objectType = typeof body.objectType === 'string' ? body.objectType : ''
  const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : ''
  const status = typeof body.status === 'string' ? body.status.toUpperCase() : ''

  if (!['campaign', 'adset', 'ad'].includes(objectType)) {
    throw new MetaApiError('Invalid object type. Use campaign, adset, or ad.', 400)
  }

  if (!objectId) {
    throw new MetaApiError('Missing Meta object ID', 400)
  }

  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    throw new MetaApiError('Invalid status. Use ACTIVE or PAUSED.', 400)
  }

  return {
    objectType: objectType as 'campaign' | 'adset' | 'ad',
    objectId,
    status: status as 'ACTIVE' | 'PAUSED',
  }
}

async function executeMetaObjectStatus(
  config: MetaConfig,
  action: { objectType: 'campaign' | 'adset' | 'ad'; objectId: string; status: 'ACTIVE' | 'PAUSED' },
) {
  await assertMetaObjectMatchesType(config, action)
  const result = await graphPost<{ success?: boolean }>(config, `/${action.objectId}`, { status: action.status })

  return {
    ok: Boolean(result.success ?? true),
    objectType: action.objectType,
    objectId: action.objectId,
    status: action.status,
    checkedAt: new Date().toISOString(),
    source: 'Meta Marketing API',
  }
}

async function assertMetaObjectMatchesType(
  config: MetaConfig,
  action: { objectType: 'campaign' | 'adset' | 'ad'; objectId: string },
) {
  const edge = {
    campaign: 'campaigns',
    adset: 'adsets',
    ad: 'ads',
  }[action.objectType]

  const filtering = JSON.stringify([{ field: 'id', operator: 'IN', value: [action.objectId] }])

  try {
    const result = await graphGet<{ data?: Array<{ id?: string }> }>(config, `/${config.adAccountId}/${edge}`, {
      fields: 'id',
      filtering,
      limit: 1,
    })
    const isExpectedType = result.data?.some((record) => record.id === action.objectId)
    if (isExpectedType) return
  } catch (error) {
    throw new MetaApiError(
      `Unable to verify Meta object ${action.objectId} as ${action.objectType}`,
      error instanceof MetaApiError ? error.status : 400,
      error instanceof MetaApiError ? error.fbCode : undefined,
      error instanceof MetaApiError ? error.fbType : undefined,
    )
  }

  throw new MetaApiError(`Meta object ${action.objectId} is not a ${action.objectType} in ${maskAdAccountId(config.adAccountId)}`, 400)
}

function normalizeMetaObjectType(objectType: string) {
  if (objectType === 'campaign' || objectType === 'adset' || objectType === 'ad') return objectType
  throw new MetaApiError('Invalid object type. Use campaign, adset, or ad.', 400)
}

function readMutationParams(body: Record<string, unknown>) {
  if (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)) return {}
  const params = { ...(body.params as Record<string, GraphParamValue>) }
  delete params.access_token
  return params
}

function createEdgeForObject(config: MetaConfig, objectType: 'campaign' | 'adset' | 'ad') {
  const accountId = normalizeAdAccountId(config.adAccountId)
  if (objectType === 'campaign') return `/${accountId}/campaigns`
  if (objectType === 'adset') return `/${accountId}/adsets`
  return `/${accountId}/ads`
}

async function mutateMetaObject(config: MetaConfig, body: Record<string, unknown>) {
  const operation = typeof body.operation === 'string' ? body.operation : ''
  const objectType = normalizeMetaObjectType(typeof body.objectType === 'string' ? body.objectType : '')
  const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : ''
  const params = readMutationParams(body)

  if (!['create', 'update', 'delete'].includes(operation)) {
    throw new MetaApiError('Invalid operation. Use create, update, or delete.', 400)
  }

  if (operation === 'create') {
    const result = await graphPost<{ id?: string; success?: boolean }>(config, createEdgeForObject(config, objectType), params)
    return {
      ok: Boolean(result.id || result.success),
      operation,
      objectType,
      objectId: result.id ?? null,
      checkedAt: new Date().toISOString(),
      source: 'Meta Marketing API',
    }
  }

  if (!objectId) {
    throw new MetaApiError('Missing Meta object ID', 400)
  }

  await assertMetaObjectMatchesType(config, { objectType, objectId })

  if (operation === 'delete') {
    const result = await graphDelete<{ success?: boolean }>(config, `/${objectId}`)
    return {
      ok: Boolean(result.success ?? true),
      operation,
      objectType,
      objectId,
      checkedAt: new Date().toISOString(),
      source: 'Meta Marketing API',
    }
  }

  const result = await graphPost<{ success?: boolean; id?: string }>(config, `/${objectId}`, params)
  return {
    ok: Boolean(result.success ?? true),
    operation,
    objectType,
    objectId: result.id ?? objectId,
    checkedAt: new Date().toISOString(),
    source: 'Meta Marketing API',
  }
}

async function launchMetaCreative(config: MetaConfig, body: Record<string, unknown>) {
  const accountId = normalizeAdAccountId(config.adAccountId)
  const adSetId = stringField(body, 'adSetId')
  const pageId = stringField(body, 'pageId')
  const linkUrl = stringField(body, 'linkUrl')
  const primaryText = stringField(body, 'primaryText')
  const headline = stringField(body, 'headline')
  const description = stringField(body, 'description')
  const ctaType = stringField(body, 'ctaType') || 'LEARN_MORE'
  const adName = stringField(body, 'adName') || `Auto post ad ${formatNow()}`
  const creativeName = stringField(body, 'creativeName') || `${adName} creative`
  const status = (stringField(body, 'status') || 'PAUSED').toUpperCase()

  if (!adSetId) throw new MetaApiError('Missing adSetId for Meta launch', 400)
  if (!pageId) throw new MetaApiError('Missing pageId for object_story_spec', 400)
  if (!linkUrl) throw new MetaApiError('Missing linkUrl for creative link_data', 400)
  if (!primaryText) throw new MetaApiError('Missing primaryText for creative message', 400)
  if (!headline) throw new MetaApiError('Missing headline for creative name/headline', 400)
  if (status !== 'PAUSED' && status !== 'ACTIVE') throw new MetaApiError('Invalid launch status. Use PAUSED or ACTIVE.', 400)

  const linkData: Record<string, unknown> = {
    link: linkUrl,
    message: primaryText,
    name: headline,
    call_to_action: {
      type: ctaType,
      value: { link: linkUrl },
    },
  }

  if (description) {
    linkData.description = description
  }

  const objectStorySpec = {
    page_id: pageId,
    link_data: linkData,
  }

  const creative = await graphPost<{ id?: string }>(config, `/${accountId}/adcreatives`, {
    name: creativeName,
    object_story_spec: objectStorySpec,
  })

  if (!creative.id) {
    throw new MetaApiError('Meta did not return creative_id', 502)
  }

  const ad = await graphPost<{ id?: string }>(config, `/${accountId}/ads`, {
    name: adName,
    adset_id: adSetId,
    creative: { creative_id: creative.id },
    status,
  })

  return {
    ok: Boolean(ad.id),
    creativeId: creative.id,
    adId: ad.id ?? null,
    adSetId,
    status,
    checkedAt: new Date().toISOString(),
    source: 'Meta Marketing API',
  }
}

function stringField(body: Record<string, unknown>, key: string) {
  return typeof body[key] === 'string' ? body[key].trim() : ''
}

async function fetchMetaWorkspace(config: MetaConfig, datePreset: string) {
  const accountId = normalizeAdAccountId(config.adAccountId)
  const insightsParams = { fields: INSIGHT_FIELDS, date_preset: datePreset, limit: 500 }
  const inlineInsights = `insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`

  const [user, account, accountInsights, timeSeries, campaigns, adSets, ads] = await Promise.all([
    graphGet<MetaUserProfile>(config, '/me', { fields: 'id,name' }),
    graphGet<MetaAdAccountInfo>(config, `/${accountId}`, {
      fields: 'id,account_id,name,currency,account_status,amount_spent,balance,timezone_name',
    }),
    graphGet<{ data?: MetaInsightsRow[] }>(config, `/${accountId}/insights`, insightsParams),
    graphGet<{ data?: MetaInsightsRow[] }>(config, `/${accountId}/insights`, {
      ...insightsParams,
      time_increment: 1,
    }),
    graphGetAllPages<MetaCampaignRow>(config, `/${accountId}/campaigns`, {
      fields: [
        'id',
        'name',
        'status',
        'effective_status',
        'objective',
        'daily_budget',
        'lifetime_budget',
        'start_time',
        'stop_time',
        inlineInsights,
      ].join(','),
      limit: 100,
    }),
    graphGetAllPages<MetaAdSetRow>(config, `/${accountId}/adsets`, {
      fields: [
        'id',
        'name',
        'campaign_id',
        'status',
        'effective_status',
        'daily_budget',
        'lifetime_budget',
        'optimization_goal',
        'billing_event',
        'targeting',
        inlineInsights,
      ].join(','),
      limit: 100,
    }),
    graphGetAllPages<MetaAdRow>(config, `/${accountId}/ads`, {
      fields: ['id', 'name', 'adset_id', 'campaign_id', 'status', 'effective_status', 'creative{id,name,thumbnail_url}', inlineInsights].join(','),
      limit: 100,
    }),
  ])

  const workspace = buildWorkspaceFromMeta({
    user,
    account,
    accountInsight: accountInsights.data?.[0] ?? null,
    timeSeries: timeSeries.data ?? [],
    campaigns,
    adSets,
    ads,
    datePreset,
    graphVersion: config.graphVersion,
  })

  return {
    workspace,
    meta: {
      user,
      account,
      activeWorkspaceId: config.workspaceId,
      workspaceLabel: config.workspaceLabel,
      datePreset,
      graphVersion: config.graphVersion,
      fetchedAt: new Date().toISOString(),
      counts: {
        campaigns: campaigns.length,
        adSets: adSets.length,
        ads: ads.length,
        timeSeries: timeSeries.data?.length ?? 0,
      },
      source: 'Meta Marketing API',
    },
  }
}

function buildWorkspaceFromMeta(args: {
  user: MetaUserProfile
  account: MetaAdAccountInfo
  accountInsight: MetaInsightsRow | null
  timeSeries: MetaInsightsRow[]
  campaigns: MetaCampaignRow[]
  adSets: MetaAdSetRow[]
  ads: MetaAdRow[]
  datePreset: string
  graphVersion: string
}): WorkspaceData {
  const accountMetrics = metricFromInsight(args.accountInsight)
  const campaigns = buildCampaigns(args.campaigns)
  const adSets = buildAdSets(args.adSets)
  const adInsights = buildAdInsights(args.ads)
  const insightComponents = buildInsightComponents(args.ads)
  const channelPerformance = buildChannelPerformance(accountMetrics)

  return {
    campaigns,
    serviceLines: buildServiceLines(campaigns),
    appointmentStages: buildAppointmentStages(accountMetrics),
    complianceReviews: buildComplianceReviews(args.ads, campaigns),
    insights: buildAiInsights(campaigns),
    insightComponents,
    adSets,
    adInsights,
    actions: buildRecommendedActions(campaigns),
    autoAds: buildAutoAds(args.ads),
    tasks: buildAgentTasks(args.ads, campaigns, adSets),
    memoryItems: buildMemoryItems(args.user, args.account, args.datePreset, args.graphVersion, campaigns, adSets, args.ads),
    auditTrail: buildAuditTrail(args.user, args.account, campaigns.length, adSets.length, adInsights.length),
    trendData: args.timeSeries.map((row) => {
      const metrics = metricFromInsight(row)
      return {
        date: row.date_start ?? row.date_stop ?? '-',
        spend: metrics.spend,
        revenue: metrics.revenue,
        cpa: metrics.cpa,
        clicks: metrics.clicks,
        leads: metrics.leads,
        bookings: metrics.conversions,
        showUps: metrics.purchases,
        treatments: metrics.purchases,
      }
    }),
    channelPerformance,
    funnelMetrics: buildFunnelMetrics(accountMetrics),
    autoMode: 'suggest',
    updatedAt: `Meta sync ${formatNow()}`,
  }

  function buildAdSets(rows: MetaAdSetRow[]) {
    return rows
      .map((adSet): WorkspaceData['adSets'][number] => {
        const metrics = metricFromInsight(adSet.insights?.data?.[0])
        const audienceTargeting = buildAudienceTargeting(adSet.targeting)
        return {
          id: adSet.id,
          campaignId: adSet.campaign_id ?? '',
          name: adSet.name,
          audience: audienceTargeting.rawSummary,
          audienceTargeting,
          deliveryStatus: isMetaActive(adSet.effective_status) ? 'active' : 'paused',
          budget: centsToCurrency(adSet.daily_budget || adSet.lifetime_budget),
          spend: metrics.spend,
          bookings: metrics.conversions,
          cpa: metrics.cpa,
          roas: metrics.roas,
          status: statusFromMetrics(metrics, adSet.effective_status),
        }
      })
      .sort((a, b) => b.spend - a.spend)
  }

  function buildAdInsights(rows: MetaAdRow[]): AdInsight[] {
    return rows
      .map((ad) => {
        const metrics = metricFromInsight(ad.insights?.data?.[0])
        return {
          id: ad.id,
          campaignId: ad.campaign_id ?? '',
          adSetId: ad.adset_id ?? '',
          name: ad.name,
          creative: displayMetaCreative(ad.creative),
          status: isMetaActive(ad.effective_status) ? ('active' as const) : ('paused' as const),
          spend: metrics.spend,
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          leads: metrics.leads,
          bookings: metrics.conversions,
          showRate: round1(safeRate(metrics.purchases, metrics.conversions || metrics.leads)),
          ctr: metrics.ctr,
          cpc: metrics.cpc,
          roas: metrics.roas,
          score: scoreFromMetrics(metrics),
        }
      })
      .sort((a, b) => b.spend - a.spend)
  }

  function buildAutoAds(rows: MetaAdRow[]): AutoAdControl[] {
    return rows
      .slice()
      .sort((a, b) => metricFromInsight(b.insights?.data?.[0]).spend - metricFromInsight(a.insights?.data?.[0]).spend)
      .slice(0, 12)
      .map((ad) => {
        const metrics = metricFromInsight(ad.insights?.data?.[0])
        const decision = metrics.spend > 0 && metrics.conversions === 0 ? 'pause' : metrics.roas >= 3 ? 'keep' : metrics.ctr < 0.7 ? 'reduceBudget' : 'keep'
        return {
          id: `meta-auto-${ad.id}`,
          adId: ad.id,
          campaignId: ad.campaign_id ?? '',
          adName: ad.name,
          status: isMetaActive(ad.effective_status) ? 'active' : 'paused',
          recommendation: decision,
          reason: `Meta metrics: spend ${formatMoney(metrics.spend)}, ROAS ${metrics.roas.toFixed(2)}x, conversions ${formatNumber(metrics.conversions)}`,
          guardrail: 'ต้อง confirm ผ่าน UI ก่อนยิง Meta API เพื่อเปลี่ยนสถานะจริง',
          confidence: decision === 'keep' ? 72 : 82,
          risk: decision === 'pause' ? 'High' : decision === 'reduceBudget' ? 'Medium' : 'Low',
          before: `Status ${ad.effective_status} · Spend ${formatMoney(metrics.spend)}`,
          after: decision === 'pause' ? 'Set ad status to PAUSED in Meta' : decision === 'reduceBudget' ? 'Review ad set/campaign budget manually' : 'Keep current delivery',
          rollbackNote: 'ถ้า pause ผิด ให้กด Activate จาก Campaigns หรือ Ads Auto แล้ว sync เพื่อยืนยันผล',
          applied: false,
        }
      })
  }

  function buildInsightComponents(rows: MetaAdRow[]): InsightComponent[] {
    const sourceRows = rows.map((ad) => {
      const metrics = metricFromInsight(ad.insights?.data?.[0])
      return {
        id: ad.id,
        campaignId: ad.campaign_id ?? '',
        title: ad.name,
        service: inferService(ad.name),
        ads: 1,
        metrics,
      }
    })

    return sourceRows
      .sort((a, b) => b.metrics.spend - a.metrics.spend)
      .slice(0, 20)
      .map((row, index) => ({
        id: `meta-component-${row.id}`,
        campaignId: row.campaignId,
        title: row.title,
        service: row.service,
        ads: row.ads,
        score: scoreFromMetrics(row.metrics),
        spend: row.metrics.spend,
        clicks: row.metrics.clicks,
        ctr: row.metrics.ctr,
        results: row.metrics.conversions,
        costPerResult: row.metrics.cpa,
        purchaseValue: row.metrics.revenue,
        roas: row.metrics.roas,
        tone: row.metrics.roas >= 2.5 ? 'good' : row.metrics.roas < 1.2 && row.metrics.spend > 0 ? 'critical' : 'watch',
        thumbTone: ['blue', 'violet', 'teal', 'green', 'amber'][index % 5],
      }))
  }
}

function buildCampaigns(rows: MetaCampaignRow[]): CampaignInsight[] {
  return rows
    .map((campaign) => {
      const metrics = metricFromInsight(campaign.insights?.data?.[0])
      return {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective ?? 'Meta Objective',
        deliveryStatus: isMetaActive(campaign.effective_status) ? 'active' : 'paused',
        budget: centsToCurrency(campaign.daily_budget || campaign.lifetime_budget),
        spend: metrics.spend,
        revenue: metrics.revenue,
        roas: metrics.roas,
        cpa: metrics.cpa,
        ctr: metrics.ctr,
        conversions: metrics.conversions,
        frequency: metrics.frequency,
        aiStatus: statusFromMetrics(metrics, campaign.effective_status),
        aiSummary: summaryFromMetrics(metrics, campaign.effective_status),
      } satisfies CampaignInsight
    })
    .sort((a, b) => b.spend - a.spend)
}

function buildServiceLines(campaigns: CampaignInsight[]): ServiceLine[] {
  const groups = new Map<string, { category: string; campaigns: CampaignInsight[] }>()
  for (const campaign of campaigns) {
    const service = inferService(campaign.name)
    const category = inferServiceCategory(campaign.name, campaign.objective)
    const current = groups.get(service) ?? { category, campaigns: [] }
    current.campaigns.push(campaign)
    groups.set(service, current)
  }

  return Array.from(groups.entries()).map(([service, group], index) => {
    const spend = group.campaigns.reduce((sum, campaign) => sum + campaign.spend, 0)
    const revenue = group.campaigns.reduce((sum, campaign) => sum + campaign.revenue, 0)
    const bookings = group.campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
    const avgStatus = group.campaigns.some((campaign) => campaign.aiStatus === 'critical')
      ? 'critical'
      : group.campaigns.some((campaign) => campaign.aiStatus === 'watch')
        ? 'watch'
        : group.campaigns.some((campaign) => campaign.aiStatus === 'scaling')
          ? 'scaling'
          : 'healthy'

    return {
      id: `meta-service-${index + 1}`,
      name: service,
      category: group.category,
      revenue,
      bookings,
      showRate: 0,
      closeRate: 0,
      cpa: safeDivide(spend, bookings),
      aiStatus: avgStatus,
    }
  })
}

function buildChannelPerformance(metrics: MetricSummary): ChannelPerformance[] {
  if (!hasMetricActivity(metrics)) return []

  return [
    {
      channel: 'Meta Ads',
      spend: metrics.spend,
      impressions: metrics.impressions,
      reach: metrics.reach,
      clicks: metrics.clicks,
      leads: metrics.leads,
      bookings: metrics.conversions,
      showUps: metrics.purchases,
      treatments: metrics.purchases,
      firstTimePatients: metrics.purchases,
      revenue: metrics.revenue,
      leadQuality: Math.round(Math.min(100, Math.max(0, safeRate(metrics.conversions || metrics.purchases, metrics.leads || metrics.clicks) + Math.min(metrics.roas * 12, 50)))),
    },
  ]
}

function buildAppointmentStages(metrics: MetricSummary): AppointmentStage[] {
  if (!hasMetricActivity(metrics)) return []

  const stages = [
    { id: 'impressions', label: 'Impressions', count: metrics.impressions, previous: metrics.impressions, note: 'Meta delivery' },
    { id: 'clicks', label: 'Clicks', count: metrics.clicks, previous: metrics.impressions, note: 'Meta link/click events' },
    { id: 'leads', label: 'Leads', count: metrics.leads, previous: metrics.clicks, note: 'Meta lead actions' },
    { id: 'booked', label: 'Tracked Bookings', count: metrics.bookings, previous: metrics.leads, note: 'Schedule/registration events' },
    { id: 'paid', label: 'Purchases', count: metrics.purchases, previous: metrics.bookings || metrics.leads, note: 'Purchase conversion events' },
  ]

  return stages.map((stage) => {
    const rate = stage.id === 'impressions' ? 100 : safeRate(stage.count, stage.previous)
    return {
      id: stage.id,
      label: stage.label,
      count: stage.count,
      rate: stage.id === 'value' ? formatMoney(metrics.revenue) : `${round1(rate)}%`,
      note: stage.note,
      status: rate === 0 && stage.id !== 'value' ? 'critical' : rate < 5 && stage.id !== 'impressions' ? 'watch' : 'healthy',
    }
  })
}

function buildFunnelMetrics(metrics: MetricSummary): FunnelMetric[] {
  if (!hasMetricActivity(metrics)) return []

  const stages = [
    { stage: 'Impressions', count: metrics.impressions, previous: metrics.impressions, help: 'จำนวนครั้งที่โฆษณาถูกแสดงจาก Meta' },
    { stage: 'Clicks', count: metrics.clicks, previous: metrics.impressions, help: 'จำนวน click จาก Meta ใช้วัด creative และ hook' },
    { stage: 'Leads', count: metrics.leads, previous: metrics.clicks, help: 'Lead actions ที่ Meta ส่งกลับจาก pixel/form/message events' },
    { stage: 'Bookings', count: metrics.bookings || metrics.conversions, previous: metrics.leads || metrics.clicks, help: 'Schedule/registration/purchase actions ที่ใช้แทน booking ใน Meta dataset' },
    { stage: 'Paid', count: metrics.purchases, previous: metrics.bookings || metrics.leads || metrics.clicks, help: 'Purchase conversions และ conversion value จาก Meta' },
  ]

  return stages.map((stage) => {
    const conversionRate = stage.stage === 'Impressions' ? 100 : round1(safeRate(stage.count, stage.previous))
    return {
      stage: stage.stage,
      count: stage.count,
      conversionRate,
      dropOffRate: round1(Math.max(0, 100 - conversionRate)),
      benchmark: stage.stage === 'Impressions' ? 'Meta delivery' : `${stage.stage} rate`,
      help: stage.help,
    }
  })
}

function buildAiInsights(campaigns: CampaignInsight[]): AIInsight[] {
  return campaigns.slice(0, 20).map((campaign) => ({
    campaignId: campaign.id,
    whatHappened: `${campaign.name} ใช้ spend ${formatMoney(campaign.spend)} และสร้าง tracked conversions ${formatNumber(campaign.conversions)}`,
    why: campaign.roas >= 3
      ? 'Meta conversion value ดีเมื่อเทียบกับ spend เหมาะกับ staged scale'
      : campaign.spend > 0 && campaign.conversions === 0
        ? 'มี spend แต่ยังไม่มี tracked conversion ในช่วงเวลานี้'
        : 'ควรอ่านคู่กับ CTR, CPA, frequency และ conversion value ก่อนตัดสินใจ',
    evidence: [
      `ROAS ${campaign.roas.toFixed(2)}x`,
      `CPA ${formatMoney(campaign.cpa)}`,
      `CTR ${campaign.ctr.toFixed(2)}%`,
      `Frequency ${campaign.frequency.toFixed(1)}`,
    ],
    recommendation: campaign.roas >= 3
      ? 'เพิ่มงบแบบ staged scale และ monitor CPA/ROAS 48 ชั่วโมง'
      : campaign.spend > 0 && campaign.conversions === 0
        ? 'ตรวจ event tracking, offer และ creative ก่อนเพิ่มงบ'
        : 'เก็บข้อมูลเพิ่มหรือทดสอบ creative/targeting ใหม่แบบจำกัดงบ',
    confidence: campaign.conversions >= 30 ? 86 : campaign.spend > 0 ? 74 : 62,
    risk: campaign.aiStatus === 'critical' ? 'High' : campaign.aiStatus === 'watch' ? 'Medium' : 'Low',
  }))
}

export function buildRecommendedActions(campaigns: CampaignInsight[]): RecommendedAction[] {
  return campaigns
    .flatMap((campaign) => {
      const actions: RecommendedAction[] = []
      if (campaign.spend > 0 && campaign.conversions === 0) {
        const isPaused = campaign.deliveryStatus === 'paused'
        actions.push(makeAction(
          campaign,
          isPaused ? 'Tracking / reopen review' : 'Tracking / budget protection',
          isPaused ? 'แคมเปญถูกพักอยู่แล้ว ตรวจ tracking, offer และ creative ก่อนเปิดกลับ' : 'มี spend แต่ไม่มี conversion ใน Meta dataset',
          isPaused ? 'ตรวจสาเหตุก่อนเปิดกลับและอย่าส่งคำสั่งพักซ้ำ' : 'Pause or reduce spend until tracking and offer are verified',
          'High',
          84,
        ))
      }
      if (campaign.roas > 0 && campaign.roas < 1.5) {
        actions.push(makeAction(campaign, 'Budget protection', `ROAS ${campaign.roas.toFixed(2)}x ต่ำกว่าเกณฑ์`, 'Reduce budget 10-15% and test new offer/creative', 'Medium', 80))
      }
      if (campaign.roas >= 3 && campaign.conversions >= 10) {
        actions.push(makeAction(campaign, 'Scale opportunity', `ROAS ${campaign.roas.toFixed(2)}x และ conversion volume พร้อม scale`, 'Increase budget 10-15% with daily monitoring', 'Low', 86))
      }
      if (campaign.frequency >= 5 && campaign.ctr < 1) {
        actions.push(makeAction(campaign, 'Creative refresh', `Frequency ${campaign.frequency.toFixed(1)} สูงและ CTR ต่ำ`, 'Create new creative angle and rotate underperforming ads', 'Medium', 78))
      }
      return actions
    })
    .slice(0, 10)
}

function makeAction(campaign: CampaignInsight, type: string, summary: string, after: string, risk: RecommendedAction['risk'], confidence: number): RecommendedAction {
  const execution = executionForRecommendedAction(campaign, type)
  return {
    id: `meta-action-${campaign.id}-${slugify(type)}`,
    campaignId: campaign.id,
    type,
    target: campaign.name,
    summary,
    expectedImpact: 'ลด spend leakage หรือเพิ่ม revenue จากข้อมูล Meta ล่าสุด',
    guardrail: 'ตรวจข้อมูลล่าสุดก่อนดำเนินการ',
    before: `Spend ${formatMoney(campaign.spend)} · ROAS ${campaign.roas.toFixed(2)}x · Conversions ${formatNumber(campaign.conversions)}`,
    after,
    rollbackNote: 'หลังดำเนินการให้ซิงก์ใหม่ และย้อนกลับจาก Ads Manager ได้หากผลลัพธ์ไม่ดีขึ้น',
    risk,
    confidence,
    status: 'pending',
    source: 'meta_metrics',
    ...(execution ? { execution } : {}),
  }
}

function executionForRecommendedAction(campaign: CampaignInsight, type: string): RecommendedAction['execution'] | undefined {
  const normalizedType = type.toLowerCase()
  if (campaign.deliveryStatus !== 'active') return undefined
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

function buildAgentTasks(ads: MetaAdRow[], campaigns: CampaignInsight[], adSets: AdSetInsight[]): AgentTask[] {
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]))
  const adSetById = new Map(adSets.map((adSet) => [adSet.id, adSet]))

  return ads
    .slice()
    .sort((a, b) => metricFromInsight(b.insights?.data?.[0]).spend - metricFromInsight(a.insights?.data?.[0]).spend)
    .slice(0, 8)
    .map((ad) => {
      const metrics = metricFromInsight(ad.insights?.data?.[0])
      const campaign = campaignById.get(ad.campaign_id ?? '')
      const adSet = adSetById.get(ad.adset_id ?? '')
      const taskType =
        metrics.spend > 0 && metrics.conversions === 0
          ? 'Creative conversion check'
          : metrics.ctr > 0 && metrics.ctr < 0.8
            ? 'Hook / CTR diagnosis'
            : metrics.roas >= 3
              ? 'Winner creative extraction'
              : 'Creative performance review'
      const result =
        metrics.spend > 0 && metrics.conversions === 0
          ? 'ตรวจ offer, creative promise, landing/chat flow และ event tracking ก่อนปล่อย spend ต่อ'
          : metrics.roas >= 3
            ? 'ดึง winning angle, audience context และ proof element เพื่อนำไปทำ variation ต่อ'
            : summaryFromMetrics(metrics, ad.effective_status)

      return {
        id: `meta-task-ad-${ad.id}`,
        agent: 'Creative Studio Agent',
        taskType,
        owner: 'Studio / Growth',
        sourceCampaign: campaign?.name ?? adSet?.name ?? 'Meta ad',
        inputContext: `Ad ${ad.name} · creative ${displayMetaCreative(ad.creative)} · spend ${formatMoney(metrics.spend)} · CTR ${metrics.ctr.toFixed(2)}% · ROAS ${metrics.roas.toFixed(2)}x`,
        expectedOutput: 'Creative action note from live Meta ad metrics',
        status: 'done',
        result,
        updatedAt: 'Meta API sync',
      }
    })
}

function buildMemoryItems(
  user: MetaUserProfile,
  account: MetaAdAccountInfo,
  datePreset: string,
  graphVersion: string,
  campaigns: CampaignInsight[],
  adSets: AdSetInsight[],
  ads: MetaAdRow[],
): MemoryItem[] {
  const topCampaign = campaigns.slice().sort((a, b) => b.spend - a.spend)[0]
  const topAdSet = adSets.slice().sort((a, b) => b.spend - a.spend)[0]
  const topAd = ads.slice().sort((a, b) => metricFromInsight(b.insights?.data?.[0]).spend - metricFromInsight(a.insights?.data?.[0]).spend)[0]
  const topAdMetrics = metricFromInsight(topAd?.insights?.data?.[0])
  const now = formatNow()

  return [
    {
      id: 'meta-memory-account',
      category: 'Insight',
      title: `${account.name} synced from Meta API`,
      detail: `${campaigns.length} campaigns, ${adSets.length} ad sets, ${ads.length} ads synced by ${user.name} with ${graphVersion}`,
      source: 'Meta API /me, ad account, campaigns, adsets, ads',
      confidence: 96,
      updatedAt: now,
    },
    topCampaign && {
      id: `meta-memory-campaign-${topCampaign.id}`,
      category: 'Strategy',
      title: `Top spend campaign: ${topCampaign.name}`,
      detail: `Spend ${formatMoney(topCampaign.spend)}, ROAS ${topCampaign.roas.toFixed(2)}x, CTR ${topCampaign.ctr.toFixed(2)}%, status ${topCampaign.aiStatus}`,
      source: 'Meta campaign insights',
      confidence: 90,
      updatedAt: now,
    },
    topAdSet && {
      id: `meta-memory-audience-${topAdSet.id}`,
      category: 'Audience',
      title: `Audience context: ${topAdSet.name}`,
      detail: `${topAdSet.audience} · spend ${formatMoney(topAdSet.spend)} · CPA ${formatMoney(topAdSet.cpa)} · ROAS ${topAdSet.roas.toFixed(2)}x`,
      source: 'Meta ad set targeting and insights',
      confidence: 88,
      updatedAt: now,
    },
    topAd && {
      id: `meta-memory-creative-${topAd.id}`,
      category: 'Creative',
      title: `Creative signal: ${topAd.name}`,
      detail: `Creative ${displayMetaCreative(topAd.creative)} · spend ${formatMoney(topAdMetrics.spend)} · CTR ${topAdMetrics.ctr.toFixed(2)}% · ROAS ${topAdMetrics.roas.toFixed(2)}x`,
      source: 'Meta ad creative and insights',
      confidence: 86,
      updatedAt: now,
    },
    {
      id: 'meta-memory-window',
      category: 'Preference',
      title: `Reporting window: ${datePreset}`,
      detail: `Studio pages use the current Meta date preset and live Meta records`,
      source: 'Meta Marketing API date preset',
      confidence: 92,
      updatedAt: now,
    },
  ].filter(Boolean) as MemoryItem[]
}

function buildComplianceReviews(ads: MetaAdRow[], campaigns: CampaignInsight[]): ComplianceReview[] {
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]))
  return ads
    .slice()
    .sort((a, b) => metricFromInsight(b.insights?.data?.[0]).spend - metricFromInsight(a.insights?.data?.[0]).spend)
    .slice(0, 18)
    .map((ad) => {
      const metrics = metricFromInsight(ad.insights?.data?.[0])
      const name = ad.name.toLowerCase()
      const blocked = /guarantee|รับประกัน|หายขาด|100%/.test(name)
      const needsReview = blocked || /before|after|ผลลัพธ์|รีวิว|review|เห็นผล|เปลี่ยนชีวิต/.test(name)
      const campaign = campaignById.get(ad.campaign_id ?? '')
      return {
        id: `meta-compliance-${ad.id}`,
        title: ad.name,
        service: inferService(ad.name),
        status: blocked ? 'blocked' : needsReview ? 'needsReview' : 'approved',
        issue: blocked
          ? 'พบคำสัญญาผลลัพธ์หรือ claim ที่ควรหยุดใช้ก่อนตรวจ policy'
          : needsReview
            ? 'ชื่อ/creative อาจมี claim, review หรือ before-after signal ที่ควรตรวจก่อน scale'
            : 'ยังไม่พบ claim risk จาก ad และ creative metadata ที่ Meta API ส่งมา',
        fix: blocked
          ? 'แก้ข้อความ claim ให้ไม่รับประกันผลลัพธ์ และตรวจภาพ/landing ก่อนเปิดใช้งาน'
          : needsReview
            ? 'ตรวจข้อความ รูป before/after disclaimer และข้อกำหนดคลินิกก่อน approve'
            : 'ใช้ต่อได้ แต่ควรตรวจ creative asset จริงใน Meta Ads Manager เมื่อ spend สูง',
        adId: ad.id,
        campaignId: ad.campaign_id,
        creativeId: ad.creative?.id,
        thumbnailUrl: ad.creative?.thumbnail_url,
        source: campaign?.name ?? 'Meta ad',
        spend: metrics.spend,
        impressions: metrics.impressions,
        ctr: metrics.ctr,
        roas: metrics.roas,
        deliveryStatus: isMetaActive(ad.effective_status) ? 'active' : 'paused',
      }
    })
}

function buildAuditTrail(user: MetaUserProfile, account: MetaAdAccountInfo, campaigns: number, adSets: number, ads: number): AuditEvent[] {
  return [
    {
      id: `meta-audit-${Date.now()}`,
      actor: user.name,
      action: 'Synced Meta API workspace',
      target: account.name,
      before: 'Previous workspace state',
      after: `${campaigns} campaigns · ${adSets} ad sets · ${ads} ads`,
      reason: 'Pulled live Meta Marketing API data through server-side proxy',
      timestamp: formatNow(),
    },
  ]
}

function metricFromInsight(row: MetaInsightsRow | null | undefined): MetricSummary {
  const spend = numberOf(row?.spend)
  const revenue = extractActionValue(row?.action_values, PURCHASE_ACTION_TYPES)
  const leads = extractActionValue(row?.actions, LEAD_ACTION_TYPES)
  const bookings = extractActionValue(row?.actions, BOOKING_ACTION_TYPES)
  const purchases = extractActionValue(row?.actions, PURCHASE_ACTION_TYPES)
  const conversions = bookings || purchases || leads
  const roas = extractActionValue(row?.purchase_roas, PURCHASE_ACTION_TYPES) || safeDivide(revenue, spend)

  return {
    spend,
    revenue,
    roas,
    cpa: extractActionValue(row?.cost_per_action_type, [...BOOKING_ACTION_TYPES, ...PURCHASE_ACTION_TYPES, ...LEAD_ACTION_TYPES]) || safeDivide(spend, conversions),
    ctr: numberOf(row?.ctr),
    cpc: numberOf(row?.cpc),
    cpm: numberOf(row?.cpm),
    impressions: numberOf(row?.impressions),
    reach: numberOf(row?.reach),
    clicks: numberOf(row?.clicks),
    leads,
    bookings,
    purchases,
    conversions,
    frequency: numberOf(row?.frequency),
  }
}

function hasMetricActivity(metrics: MetricSummary) {
  return [
    metrics.spend,
    metrics.revenue,
    metrics.impressions,
    metrics.reach,
    metrics.clicks,
    metrics.leads,
    metrics.bookings,
    metrics.purchases,
    metrics.conversions,
  ].some((value) => value > 0)
}

function extractActionValue(rows: MetaActionValue[] | undefined, matchTypes: string[]) {
  if (!rows) return 0
  for (const actionType of matchTypes) {
    const found = rows.find((row) => row.action_type === actionType)
    if (found) return numberOf(found.value)
  }
  return 0
}

function statusFromMetrics(metrics: MetricSummary, effectiveStatus: string): CampaignInsight['aiStatus'] {
  if (!isMetaActive(effectiveStatus)) return 'watch'
  if (metrics.spend > 0 && metrics.conversions === 0) return 'critical'
  if (metrics.roas >= 3 && metrics.conversions >= 10) return 'scaling'
  if ((metrics.roas > 0 && metrics.roas < 1.5) || (metrics.frequency >= 5 && metrics.ctr < 1)) return 'watch'
  return 'healthy'
}

function summaryFromMetrics(metrics: MetricSummary, effectiveStatus: string) {
  if (!isMetaActive(effectiveStatus)) return `Meta status ${effectiveStatus}; ใช้ข้อมูล insight เพื่อพิจารณาเปิดกลับ`
  if (metrics.spend > 0 && metrics.conversions === 0) return 'มี spend แต่ยังไม่มี tracked conversion ในช่วงเวลานี้'
  if (metrics.roas >= 3) return 'ROAS จาก Meta สูง เหมาะกับ staged scale ภายใต้ guardrail'
  if (metrics.frequency >= 5 && metrics.ctr < 1) return 'Frequency สูงและ CTR ต่ำ มีสัญญาณ creative fatigue'
  return 'Performance อยู่ในโซนเฝ้าดูจาก Meta campaign insights'
}

function scoreFromMetrics(metrics: MetricSummary) {
  const roasScore = Math.min(metrics.roas * 1.6, 5)
  const ctrScore = Math.min(metrics.ctr * 0.7, 2)
  const conversionScore = Math.min(metrics.conversions / 20, 2)
  const fatiguePenalty = metrics.frequency > 6 ? 1 : 0
  return round1(Math.max(0, Math.min(10, 2 + roasScore + ctrScore + conversionScore - fatiguePenalty)))
}

function inferService(name: string) {
  const text = name.toLowerCase()
  if (/surgery|rhinoplasty|nose|จมูก|ตา|ศัลย/.test(text)) return 'ศัลยกรรม'
  if (/botox|filler|inject|skin booster|ฉีด|โบท็อก|ฟิลเลอร์/.test(text)) return 'ฉีดหน้า'
  if (/laser|acne|scar|skin|เลเซอร์|หลุมสิว|ผิว/.test(text)) return 'เลเซอร์ผิว'
  if (/hair|wellness|ปลูกผม|สุขภาพ/.test(text)) return 'บริการอื่นๆ'
  return 'Meta Ads'
}

function inferServiceCategory(name: string, objective: string) {
  const service = inferService(name)
  if (service === 'ศัลยกรรม') return 'Surgery / Consult'
  if (service === 'ฉีดหน้า') return 'Botox / Filler / Injectables'
  if (service === 'เลเซอร์ผิว') return 'Laser / Skin treatment'
  if (service === 'บริการอื่นๆ') return 'Hair / Wellness / Other service'
  return objective || 'Meta campaign group'
}

function buildAudienceTargeting(targeting: MetaAdSetRow['targeting']): AudienceTargeting {
  const genders = (targeting?.genders ?? []).map(genderLabel).filter(Boolean)
  const publisherPlatforms = (targeting?.publisher_platforms ?? []).map(formatTargetingLabel)
  const placements = [
    ...(targeting?.facebook_positions ?? []).map((placement) => `Facebook ${formatTargetingLabel(placement)}`),
    ...(targeting?.instagram_positions ?? []).map((placement) => `Instagram ${formatTargetingLabel(placement)}`),
  ]
  const devicePlatforms = (targeting?.device_platforms ?? []).map(formatTargetingLabel)
  const geoLocations = collectGeoLocations(targeting)
  const interests = collectAudienceTargets(targeting)
  const exclusions = collectExcludedTargets(targeting)
  const locales = (targeting?.locales ?? []).map((locale) => `Locale ${locale}`)
  const age = targeting?.age_min || targeting?.age_max ? `Age ${targeting.age_min ?? '?'}-${targeting.age_max ?? '?'}` : ''
  const geoSummary = geoLocations.slice(0, 3).map((geo) => geo.name).join(', ')
  const interestSummary = interests.slice(0, 3).map((interest) => interest.name).join(', ')
  const rawSummary =
    [publisherPlatforms.join(', '), age, genders.join('/'), geoSummary, interestSummary ? `Interest: ${interestSummary}` : '']
      .filter(Boolean)
      .join(' · ') || 'Meta targeting'

  return {
    ageMin: targeting?.age_min,
    ageMax: targeting?.age_max,
    genders,
    publisherPlatforms,
    placements,
    devicePlatforms,
    geoLocations,
    interests,
    exclusions,
    locales,
    rawSummary,
  }
}

function collectGeoLocations(targeting: MetaAdSetRow['targeting']): AudienceGeoTarget[] {
  const geo = targeting?.geo_locations
  if (!geo) return []

  const countries = (geo.countries ?? []).map((country) => ({
    type: 'country' as const,
    name: countryName(country) ?? country,
    key: country,
    country,
  }))
  const regions = (geo.regions ?? []).map((region) => ({
    type: 'region' as const,
    name: region.name || region.key || 'Region',
    key: region.key,
    country: countryName(region.country_code || region.country),
  }))
  const cities = (geo.cities ?? []).map((city) => ({
    type: 'city' as const,
    name: city.name || city.key || 'City',
    key: city.key,
    region: city.region,
    country: countryName(city.country_code || city.country),
    radius: city.radius,
    distanceUnit: city.distance_unit,
  }))
  const zips = (geo.zips ?? []).map((zip) => ({
    type: 'zip' as const,
    name: zip.name || zip.key || zip.primary_city || 'Zip',
    key: zip.key,
    region: zip.region,
    country: countryName(zip.country),
  }))
  const custom = (geo.custom_locations ?? []).map((location, index) => ({
    type: 'custom' as const,
    name: location.name || location.address_string || `Custom location ${index + 1}`,
    radius: location.radius,
    distanceUnit: location.distance_unit,
  }))

  return [...countries, ...regions, ...cities, ...zips, ...custom].filter((location) => Boolean(location.name))
}

function collectAudienceTargets(targeting: MetaAdSetRow['targeting']): AudienceTarget[] {
  const directTargets = [
    ...targetEntities(targeting?.interests, 'interest'),
    ...targetEntities(targeting?.behaviors, 'behavior'),
    ...targetEntities(targeting?.demographics, 'demographic'),
    ...targetEntities(targeting?.custom_audiences, 'custom_audience'),
  ]
  const flexibleTargets = (targeting?.flexible_spec ?? []).flatMap((spec) =>
    Object.entries(spec).flatMap(([key, value]) => targetEntities(value, targetTypeFromKey(key), key)),
  )
  const lookalikeSpec = targeting?.lookalike_spec
  const lookalikeTargets = lookalikeSpec
    ? [
        {
          type: 'lookalike' as const,
          name: `Lookalike ${lookalikeSpec.ratio ? `${lookalikeSpec.ratio}%` : lookalikeSpec.type || 'audience'}`,
          source: lookalikeSpec.country ? countryName(lookalikeSpec.country) : 'Meta lookalike spec',
        },
      ]
    : []

  return dedupeAudienceTargets([...directTargets, ...flexibleTargets, ...lookalikeTargets])
}

function collectExcludedTargets(targeting: MetaAdSetRow['targeting']): AudienceTarget[] {
  const exclusionTargets = Object.entries(targeting?.exclusions ?? {}).flatMap(([key, value]) =>
    targetEntities(value, 'excluded', key),
  )
  const excludedCustom = targetEntities(targeting?.excluded_custom_audiences, 'excluded', 'excluded_custom_audiences')
  const excludedCountries = (targeting?.excluded_geo_locations?.countries ?? []).map((country) => ({
    type: 'excluded' as const,
    name: countryName(country) ?? country,
    source: 'excluded_geo_locations',
  }))

  return dedupeAudienceTargets([...exclusionTargets, ...excludedCustom, ...excludedCountries])
}

function targetEntities(entities: MetaTargetingEntity[] | undefined, type: AudienceTarget['type'], source?: string): AudienceTarget[] {
  return (entities ?? [])
    .map((entity) => ({
      type,
      id: entity.id,
      name: entity.name || entity.id || 'Unnamed target',
      path: entity.path?.join(' > '),
      source,
    }))
    .filter((entity) => Boolean(entity.name))
}

function targetTypeFromKey(key: string): AudienceTarget['type'] {
  if (key.includes('interest')) return 'interest'
  if (key.includes('behavior')) return 'behavior'
  if (key.includes('demographic')) return 'demographic'
  if (key.includes('custom')) return 'custom_audience'
  return 'other'
}

function dedupeAudienceTargets(targets: AudienceTarget[]) {
  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = `${target.type}:${target.id || target.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function genderLabel(gender: number) {
  if (gender === 1) return 'Men'
  if (gender === 2) return 'Women'
  return `Gender ${gender}`
}

function formatTargetingLabel(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function countryName(codeOrName: string | undefined) {
  if (!codeOrName) return undefined
  const countryMap: Record<string, string> = {
    TH: 'Thailand',
    US: 'United States',
    SG: 'Singapore',
    MY: 'Malaysia',
    LA: 'Laos',
    KH: 'Cambodia',
    MM: 'Myanmar',
    VN: 'Vietnam',
  }
  return countryMap[codeOrName.toUpperCase()] ?? codeOrName
}

function isMetaActive(status: string) {
  return status.toUpperCase() === 'ACTIVE'
}

function centsToCurrency(value: string | undefined) {
  return safeDivide(numberOf(value), 100)
}

function numberOf(value: string | number | undefined) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'action'
}

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

function displayMetaCreative(creative: MetaAdRow['creative']) {
  return cleanMetaDisplayText(creative?.name, creative?.id ? `Creative ID ${creative.id}` : 'Meta creative')
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('th-TH').format(value)
}

function formatNow() {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())
}
