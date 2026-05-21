export type HomeMetaWorkspaceOption = {
  active?: boolean
  adAccountId: string
  graphVersion?: string
  id: string
  label: string
}

export type HomeMetaConfigState = {
  activeWorkspaceId?: string | null
  adAccountId?: string | null
  configured?: boolean
  connected?: boolean
  graphVersion?: string
  hasSavedToken?: boolean
  settingsSource?: string | null
  tokenLocation?: string | null
  workspaceLabel?: string | null
  workspaces?: HomeMetaWorkspaceOption[]
}

export type HomeAiConfigState = {
  canEditInWeb?: boolean
  configured?: boolean
  connected?: boolean
  hasSavedApiKey?: boolean
  maxOutputTokens?: number
  model?: string
  settingsSource?: string | null
  source?: string
  tokenLocation?: string | null
}

export type HomeSettingsState = {
  ai: HomeAiConfigState | null
  aiError?: string
  meta: HomeMetaConfigState | null
  metaError?: string
}

export type HomeMetaSettingsInput = {
  accessToken: string
  adAccountId: string
  workspaceLabel: string
}

export type HomeAiSettingsInput = {
  apiKey: string
  maxOutputTokens: number
  model: string
}

export async function fetchHomeSettings(): Promise<HomeSettingsState> {
  const [meta, ai, metaStatus, aiStatus] = await Promise.allSettled([
    homeApiJson<HomeMetaConfigState>('/api/meta/config'),
    homeApiJson<HomeAiConfigState>('/api/ai/config'),
    homeApiJson<HomeMetaConfigState>('/api/meta/status'),
    homeApiJson<HomeAiConfigState>('/api/ai/status'),
  ])
  const metaConfig = meta.status === 'fulfilled' ? meta.value : null
  const aiConfig = ai.status === 'fulfilled' ? ai.value : null
  const metaConnection = metaStatus.status === 'fulfilled' ? metaStatus.value : null
  const aiConnection = aiStatus.status === 'fulfilled' ? aiStatus.value : null

  return {
    ai: aiConfig
      ? {
          ...aiConfig,
          configured: aiConnection?.configured ?? aiConfig.configured,
          connected: aiConnection?.connected ?? aiConfig.connected,
        }
      : null,
    aiError: ai.status === 'rejected' ? errorMessage(ai.reason) : undefined,
    meta: metaConfig
      ? {
          ...metaConfig,
          configured: metaConnection?.configured ?? metaConfig.configured,
          connected: metaConnection?.connected ?? metaConfig.connected,
        }
      : null,
    metaError: meta.status === 'rejected' ? errorMessage(meta.reason) : undefined,
  }
}

export function saveHomeMetaSettings(input: HomeMetaSettingsInput) {
  return homeApiJson<HomeMetaConfigState>('/api/meta/config', {
    body: JSON.stringify({
      accessToken: input.accessToken,
      adAccountId: input.adAccountId,
      defaultDatePreset: 'maximum',
      graphVersion: 'v21.0',
      workspaceLabel: input.workspaceLabel,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

export function saveHomeAiSettings(input: HomeAiSettingsInput) {
  return homeApiJson<HomeAiConfigState>('/api/ai/config', {
    body: JSON.stringify({
      apiKey: input.apiKey,
      maxOutputTokens: input.maxOutputTokens,
      model: input.model,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

export function checkHomeAiSettings() {
  return homeApiJson<HomeAiConfigState & { ok?: boolean }>('/api/ai/check')
}

async function homeApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `คำขอ API ล้มเหลว (${response.status})`)
  }
  return payload as T
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'โหลดสถานะไม่สำเร็จ'
}
