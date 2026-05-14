import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type {
  AdInsight,
  AdSetInsight,
  AIInsight,
  CampaignInsight,
  RecommendedAction,
  RiskLevel,
  WorkspaceData,
} from '../src/types'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_OPENAI_MODEL = 'gpt-5.5'
const DEFAULT_MAX_OUTPUT_TOKENS = 2800
const MAX_AI_JSON_BODY_BYTES = 1_000_000
const LOCAL_ENV_FILES = [resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '.env')]

interface OpenAiPluginEnv {
  [key: string]: string | undefined
}

interface OpenAiConfig {
  apiKey: string
  model: string
  maxOutputTokens: number
  tokenLocation: 'server-env' | 'local-env-file'
}

interface AiApiRequest {
  url?: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
  on: (event: string, callback: (chunk?: Buffer | string) => void) => void
}

interface AiApiResponse {
  statusCode: number
  setHeader: (key: string, value: string) => void
  end: (body: string) => void
}

interface AiMarketerModelAction {
  campaignId: string
  type: string
  target: string
  summary: string
  expectedImpact: string
  guardrail: string
  before: string
  after: string
  rollbackNote: string
  risk: RiskLevel
  confidence: number
  execution: 'none' | 'pause_campaign' | 'activate_campaign'
}

interface AiMarketerModelResult {
  summary: string
  modelNotes: string[]
  insights: AIInsight[]
  actions: AiMarketerModelAction[]
}

interface AiCreativeModelResult {
  summary: string
  brief: {
    objective: string
    audience: string
    offer: string
    positioning: string
  }
  hooks: string[]
  primaryTexts: string[]
  headlines: string[]
  descriptions: string[]
  launchNotes: string[]
  complianceNotes: string[]
  recommendedCta: string
  workOrders: Array<{
    title: string
    owner: string
    inputContext: string
    expectedOutput: string
  }>
}

class AiApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AiApiError'
    this.status = status
  }
}

export function createOpenAiPlugin(env: OpenAiPluginEnv): Plugin {
  return {
    name: 'clinicstellar-openai-api',
    configureServer(server) {
      server.middlewares.use(createOpenAiMiddleware(env))
    },
  }
}

export function createOpenAiMiddleware(env: OpenAiPluginEnv) {
  return async (req: AiApiRequest, res: AiApiResponse, next: () => void = () => undefined) => {
    if (!req.url?.startsWith('/api/ai/')) {
      next()
      return
    }

    try {
      const requestUrl = new URL(req.url, 'http://localhost')

      if (requestUrl.pathname === '/api/ai/status') {
        const config = await readOpenAiConfig(env)
        writeJson(res, 200, {
          configured: Boolean(config),
          connected: Boolean(config),
          model: config?.model ?? readOpenAiModel(env),
          source: 'OpenAI Responses API',
          tokenLocation: config?.tokenLocation ?? null,
          requiredEnv: await buildOpenAiConfigChecks(env),
        })
        return
      }

      if (requestUrl.pathname === '/api/ai/marketer') {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        assertJsonRequest(req)
        const config = await requireOpenAiConfig(env)
        const body = await readJsonBody(req)
        const workspace = normalizeWorkspacePayload(body.workspace)
        if (!hasWorkspaceSignal(workspace)) {
          throw new AiApiError('ต้อง Sync Meta API ก่อนให้ AI Marketer วิเคราะห์ข้อมูลจริง', 400)
        }

        const startedAt = Date.now()
        const modelResult = await callOpenAiJson<AiMarketerModelResult>({
          config,
          schemaName: 'pmc_ai_marketer_result',
          schema: aiMarketerSchema,
          systemPrompt: aiMarketerSystemPrompt,
          payload: {
            instruction: 'Analyze this real Meta Ads workspace and produce Thai executive-ready insights and guarded actions.',
            workspace,
          },
        })
        const insights = normalizeAiInsights(modelResult.insights, workspace.campaigns)
        const actions = normalizeAiActions(modelResult.actions, workspace.campaigns)

        writeJson(res, 200, {
          ok: true,
          source: 'OpenAI Responses API',
          model: config.model,
          durationMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
          summary: cleanText(modelResult.summary, 'AI Marketer วิเคราะห์ข้อมูลเสร็จแล้ว'),
          modelNotes: cleanStringList(modelResult.modelNotes, 5),
          insights,
          actions,
        })
        return
      }

      if (requestUrl.pathname === '/api/ai/creative') {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'Method not allowed' })
          return
        }

        assertJsonRequest(req)
        const config = await requireOpenAiConfig(env)
        const body = await readJsonBody(req)
        const sourceAd = normalizeAdInsight(body.sourceAd)
        if (!sourceAd) {
          throw new AiApiError('ต้องเลือก Source Creative จาก Meta ad-level data ก่อน', 400)
        }

        const startedAt = Date.now()
        const modelResult = await callOpenAiJson<AiCreativeModelResult>({
          config,
          schemaName: 'pmc_creative_kit_result',
          schema: aiCreativeSchema,
          systemPrompt: aiCreativeSystemPrompt,
          payload: {
            instruction: 'Create a practical creative kit for Thai aesthetic clinic ads. Use supplied Meta metrics only.',
            sourceAd,
            adSet: normalizeAdSetInsight(body.adSet),
            campaign: normalizeCampaignInsight(body.campaign),
            launchForm: sanitizeUnknownRecord(body.launchForm),
          },
        })

        writeJson(res, 200, {
          ok: true,
          source: 'OpenAI Responses API',
          model: config.model,
          durationMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
          result: normalizeCreativeResult(modelResult),
        })
        return
      }

      writeJson(res, 404, { error: 'Unknown AI endpoint' })
    } catch (error) {
      const status = error instanceof AiApiError ? error.status : 500
      writeJson(res, status, {
        error: error instanceof Error ? error.message : 'Unknown AI API error',
      })
    }
  }
}

async function requireOpenAiConfig(env: OpenAiPluginEnv) {
  const config = await readOpenAiConfig(env)
  if (!config) {
    throw new AiApiError('OpenAI API key ยังไม่ได้ตั้งค่า กรุณาใส่ OPENAI_API_KEY ใน server env หรือ .env.local', 400)
  }
  return config
}

async function readOpenAiConfig(env: OpenAiPluginEnv): Promise<OpenAiConfig | null> {
  const localEnv = await readLocalEnvFiles()
  const envKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || ''
  const localKey = localEnv.OPENAI_API_KEY || ''
  const apiKey = (envKey || localKey).trim()
  if (!apiKey) return null

  const model = readOpenAiModel(env, localEnv)
  const maxOutputTokens = Number(env.OPENAI_MAX_OUTPUT_TOKENS || process.env.OPENAI_MAX_OUTPUT_TOKENS || localEnv.OPENAI_MAX_OUTPUT_TOKENS) || DEFAULT_MAX_OUTPUT_TOKENS
  return {
    apiKey,
    model,
    maxOutputTokens,
    tokenLocation: envKey ? 'server-env' : 'local-env-file',
  }
}

function readOpenAiModel(env: OpenAiPluginEnv, localEnv: Record<string, string> = {}) {
  return (env.OPENAI_MODEL || process.env.OPENAI_MODEL || localEnv.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim()
}

async function buildOpenAiConfigChecks(env: OpenAiPluginEnv) {
  const localEnv = await readLocalEnvFiles()
  const hasEnvKey = Boolean((env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim())
  const hasLocalKey = Boolean((localEnv.OPENAI_API_KEY || '').trim())
  return [
    {
      key: 'OPENAI_API_KEY',
      present: hasEnvKey || hasLocalKey,
      source: hasEnvKey ? 'server-env' : hasLocalKey ? 'local-env-file' : 'missing',
      help: 'ใช้เรียก OpenAI Responses API จาก backend เท่านั้น ไม่ส่ง key ไป browser',
    },
    {
      key: 'OPENAI_MODEL',
      present: Boolean(readOpenAiModel(env, localEnv)),
      source: env.OPENAI_MODEL || process.env.OPENAI_MODEL || localEnv.OPENAI_MODEL ? 'configured' : 'default',
      help: `ไม่ใส่จะใช้ ${DEFAULT_OPENAI_MODEL}`,
    },
  ]
}

async function readLocalEnvFiles() {
  const merged: Record<string, string> = {}
  for (const filePath of LOCAL_ENV_FILES) {
    try {
      Object.assign(merged, parseEnvFile(await readFile(filePath, 'utf-8')))
    } catch {
      // Missing local env files are valid in production.
    }
  }
  return merged
}

function parseEnvFile(raw: string) {
  const output: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed
    const separator = withoutExport.indexOf('=')
    if (separator === -1) continue
    const key = withoutExport.slice(0, separator).trim()
    let value = withoutExport.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    output[key] = value
  }
  return output
}

async function callOpenAiJson<T>({
  config,
  schemaName,
  schema,
  systemPrompt,
  payload,
}: {
  config: OpenAiConfig
  schemaName: string
  schema: Record<string, unknown>
  systemPrompt: string
  payload: Record<string, unknown>
}): Promise<T> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify(payload) }],
        },
      ],
      max_output_tokens: config.maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          schema,
          strict: true,
        },
      },
    }),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id')
    const message = extractOpenAiError(json) || `OpenAI request failed (${response.status})`
    throw new AiApiError(
      requestId ? `${message} · OpenAI request id ${requestId}` : message,
      response.status >= 500 ? 502 : response.status,
    )
  }

  const outputText = extractOutputText(json)
  if (!outputText) throw new AiApiError('OpenAI response ไม่มี output text ที่ parse ได้', 502)

  try {
    return JSON.parse(outputText) as T
  } catch {
    throw new AiApiError('OpenAI response ไม่ใช่ JSON ตาม schema ที่กำหนด', 502)
  }
}

function extractOpenAiError(json: unknown) {
  if (!json || typeof json !== 'object') return ''
  const maybe = json as { error?: { message?: string } }
  return maybe.error?.message ?? ''
}

function extractOutputText(json: unknown) {
  if (!json || typeof json !== 'object') return ''
  const response = json as { output_text?: unknown; output?: unknown[] }
  if (typeof response.output_text === 'string') return response.output_text

  const chunks: string[] = []
  for (const item of response.output ?? []) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown[] }).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') chunks.push(text)
    }
  }
  return chunks.join('\n').trim()
}

function assertJsonRequest(req: AiApiRequest) {
  const contentType = headerValue(req.headers?.['content-type']).toLowerCase()
  if (!contentType.includes('application/json')) {
    throw new AiApiError('Content-Type must be application/json', 415)
  }
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join(',')
  return value ?? ''
}

function readJsonBody(
  req: { on: (event: string, callback: (chunk?: Buffer | string) => void) => void },
  maxBytes = MAX_AI_JSON_BODY_BYTES,
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
        fail(new AiApiError(`Request body too large. Limit ${Math.round(maxBytes / 1024)} KB.`, 413))
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
            ? new AiApiError('Invalid JSON body', 400)
            : error instanceof Error
              ? error
              : new AiApiError('Invalid JSON body', 400),
        )
      }
    })
    req.on('error', () => fail(new AiApiError('Request body read failed', 400)))
  })
}

function writeJson(res: AiApiResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function normalizeWorkspacePayload(input: unknown) {
  const workspace = sanitizeUnknownRecord(input) as Partial<WorkspaceData>
  return {
    campaigns: pickArray(workspace.campaigns, normalizeCampaignInsight).slice(0, 20),
    adSets: pickArray(workspace.adSets, normalizeAdSetInsight).slice(0, 30),
    adInsights: pickArray(workspace.adInsights, normalizeAdInsight).slice(0, 40),
    channelPerformance: Array.isArray(workspace.channelPerformance) ? workspace.channelPerformance.slice(0, 10) : [],
    funnelMetrics: Array.isArray(workspace.funnelMetrics) ? workspace.funnelMetrics.slice(0, 10) : [],
    trendData: Array.isArray(workspace.trendData) ? workspace.trendData.slice(-30) : [],
    updatedAt: typeof workspace.updatedAt === 'string' ? workspace.updatedAt : '',
  }
}

function hasWorkspaceSignal(workspace: ReturnType<typeof normalizeWorkspacePayload>) {
  return workspace.campaigns.length > 0 || workspace.adInsights.length > 0 || workspace.adSets.length > 0
}

function pickArray<T>(input: unknown, normalize: (item: unknown, index: number) => T | null) {
  if (!Array.isArray(input)) return []
  return input.map((item, index) => normalize(item, index)).filter((item): item is T => Boolean(item))
}

function normalizeCampaignInsight(input: unknown): CampaignInsight | null {
  const item = sanitizeUnknownRecord(input)
  const id = cleanText(item.id, '')
  if (!id) return null
  return {
    id,
    name: cleanText(item.name, 'Meta campaign'),
    objective: cleanText(item.objective, 'Meta Objective'),
    deliveryStatus: item.deliveryStatus === 'active' ? 'active' : 'paused',
    budget: numberOf(item.budget),
    spend: numberOf(item.spend),
    revenue: numberOf(item.revenue),
    roas: numberOf(item.roas),
    cpa: numberOf(item.cpa),
    ctr: numberOf(item.ctr),
    conversions: numberOf(item.conversions),
    frequency: numberOf(item.frequency),
    aiStatus: ['healthy', 'watch', 'critical', 'scaling'].includes(String(item.aiStatus)) ? item.aiStatus as CampaignInsight['aiStatus'] : 'watch',
    aiSummary: cleanText(item.aiSummary, ''),
  }
}

function normalizeAdSetInsight(input: unknown): AdSetInsight | null {
  const item = sanitizeUnknownRecord(input)
  const id = cleanText(item.id, '')
  if (!id) return null
  return {
    id,
    campaignId: cleanText(item.campaignId, ''),
    name: cleanText(item.name, 'Meta ad set'),
    audience: cleanText(item.audience, ''),
    deliveryStatus: item.deliveryStatus === 'active' ? 'active' : 'paused',
    budget: numberOf(item.budget),
    spend: numberOf(item.spend),
    bookings: numberOf(item.bookings),
    cpa: numberOf(item.cpa),
    roas: numberOf(item.roas),
    status: ['healthy', 'watch', 'critical', 'scaling'].includes(String(item.status)) ? item.status as AdSetInsight['status'] : 'watch',
  }
}

function normalizeAdInsight(input: unknown): AdInsight | null {
  const item = sanitizeUnknownRecord(input)
  const id = cleanText(item.id, '')
  if (!id) return null
  return {
    id,
    campaignId: cleanText(item.campaignId, ''),
    adSetId: cleanText(item.adSetId, ''),
    name: cleanText(item.name, 'Meta ad'),
    creative: cleanText(item.creative, ''),
    status: item.status === 'active' ? 'active' : 'paused',
    spend: numberOf(item.spend),
    impressions: numberOf(item.impressions),
    clicks: numberOf(item.clicks),
    leads: numberOf(item.leads),
    bookings: numberOf(item.bookings),
    showRate: numberOf(item.showRate),
    ctr: numberOf(item.ctr),
    cpc: numberOf(item.cpc),
    roas: numberOf(item.roas),
    score: numberOf(item.score),
  }
}

function normalizeAiInsights(input: unknown, campaigns: CampaignInsight[]): AIInsight[] {
  const campaignIds = new Set(campaigns.map((campaign) => campaign.id))
  const fallbackCampaignId = campaigns[0]?.id ?? 'meta-account'
  return pickArray(input, (item): AIInsight | null => {
    const record = sanitizeUnknownRecord(item)
    const campaignId = campaignIds.has(cleanText(record.campaignId, '')) ? cleanText(record.campaignId, '') : fallbackCampaignId
    return {
      campaignId,
      whatHappened: cleanText(record.whatHappened, 'AI วิเคราะห์ performance จาก Meta metrics แล้ว'),
      why: cleanText(record.why, 'ใช้ spend, ROAS, CTR, CPA และ conversion volume เป็นหลัก'),
      evidence: cleanStringList(record.evidence, 5),
      recommendation: cleanText(record.recommendation, 'ตรวจ metric และ approve action ก่อนยิง API จริง'),
      confidence: clamp(Math.round(numberOf(record.confidence)), 0, 100),
      risk: normalizeRisk(record.risk),
    }
  }).slice(0, 8)
}

function normalizeAiActions(input: unknown, campaigns: CampaignInsight[]): RecommendedAction[] {
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]))
  const fallbackCampaign = campaigns[0]
  const runId = Date.now()

  return pickArray(input, (item, index): RecommendedAction | null => {
    const record = sanitizeUnknownRecord(item)
    const campaign = campaignById.get(cleanText(record.campaignId, '')) ?? fallbackCampaign
    if (!campaign) return null
    const type = cleanText(record.type, 'AI Marketer action')
    const executionType = cleanText(record.execution, 'none')
    const execution = executionForAiAction(campaign, executionType)
    const guardrail = cleanText(record.guardrail, 'ต้องตรวจ evidence และ confirm ก่อน execute ผ่าน Meta API')
    const policyNote =
      executionType !== 'none' && !execution
        ? ' · Server policy: ยังเป็น approval-only เพราะ metric guardrail ฝั่ง backend ยังไม่ผ่าน'
        : ''

    return {
      id: `ai-action-${runId}-${index + 1}-${slugify(type, 'marketer')}`,
      campaignId: campaign.id,
      type,
      target: cleanText(record.target, campaign.name),
      summary: cleanText(record.summary, 'AI Marketer recommendation จากข้อมูล Meta ล่าสุด'),
      expectedImpact: cleanText(record.expectedImpact, 'ลด spend leakage หรือเพิ่ม result quality จากข้อมูลจริง'),
      guardrail: `${guardrail}${policyNote}`,
      before: cleanText(record.before, `Spend ${formatMoney(campaign.spend)} · ROAS ${campaign.roas.toFixed(2)}x · CTR ${campaign.ctr.toFixed(2)}%`),
      after: cleanText(record.after, 'Update plan หลัง approve'),
      rollbackNote: cleanText(record.rollbackNote, 'Sync Meta หลัง execute และย้อนกลับหาก CPA/ROAS แย่ลง'),
      risk: normalizeRisk(record.risk),
      confidence: clamp(Math.round(numberOf(record.confidence)), 0, 100),
      status: 'pending',
      ...(execution ? { execution } : {}),
    }
  }).slice(0, 10)
}

function executionForAiAction(campaign: CampaignInsight, executionType: string): RecommendedAction['execution'] | undefined {
  if (executionType === 'pause_campaign' && canPauseCampaignByPolicy(campaign)) {
    return {
      endpoint: '/api/meta/object-status',
      method: 'POST',
      objectType: 'campaign',
      objectId: campaign.id,
      status: 'PAUSED',
      label: 'Pause campaign in Meta',
    }
  }

  if (executionType === 'activate_campaign' && canActivateCampaignByPolicy(campaign)) {
    return {
      endpoint: '/api/meta/object-status',
      method: 'POST',
      objectType: 'campaign',
      objectId: campaign.id,
      status: 'ACTIVE',
      label: 'Activate campaign in Meta',
    }
  }

  return undefined
}

function canPauseCampaignByPolicy(campaign: CampaignInsight) {
  if (campaign.deliveryStatus !== 'active' || campaign.spend < 500) return false

  const noConversionSpendLeak = campaign.conversions === 0 && campaign.spend >= 500
  const lowReturnWithVolume = campaign.conversions >= 3 && campaign.roas > 0 && campaign.roas < 1.2
  const fatigueWithCost = campaign.frequency >= 6 && campaign.ctr > 0 && campaign.ctr < 0.8 && campaign.spend >= 1_000
  return noConversionSpendLeak || lowReturnWithVolume || fatigueWithCost
}

function canActivateCampaignByPolicy(campaign: CampaignInsight) {
  if (campaign.deliveryStatus !== 'paused') return false
  return campaign.conversions >= 10 && campaign.roas >= 2.5 && campaign.ctr >= 0.8
}

function normalizeCreativeResult(input: AiCreativeModelResult): AiCreativeModelResult {
  return {
    summary: cleanText(input.summary, 'AI Creative Kit พร้อมใช้งาน'),
    brief: {
      objective: cleanText(input.brief?.objective, 'สร้าง creative variation จาก source ad'),
      audience: cleanText(input.brief?.audience, 'ใช้ audience จาก Meta ad set ที่เลือก'),
      offer: cleanText(input.brief?.offer, 'ปรับข้อเสนอให้ชัดแต่ไม่รับประกันผลลัพธ์'),
      positioning: cleanText(input.brief?.positioning, 'เน้นความน่าเชื่อถือและการปรึกษา'),
    },
    hooks: cleanStringList(input.hooks, 6),
    primaryTexts: cleanStringList(input.primaryTexts, 4),
    headlines: cleanStringList(input.headlines, 5),
    descriptions: cleanStringList(input.descriptions, 4),
    launchNotes: cleanStringList(input.launchNotes, 6),
    complianceNotes: cleanStringList(input.complianceNotes, 6),
    recommendedCta: cleanText(input.recommendedCta, 'LEARN_MORE'),
    workOrders: pickArray(input.workOrders, (item) => {
      const record = sanitizeUnknownRecord(item)
      return {
        title: cleanText(record.title, 'Creative work order'),
        owner: cleanText(record.owner, 'Studio / Growth'),
        inputContext: cleanText(record.inputContext, 'Meta source creative metrics'),
        expectedOutput: cleanText(record.expectedOutput, 'Launch-ready creative asset'),
      }
    }).slice(0, 5),
  }
}

function cleanStringList(input: unknown, maxItems: number) {
  if (!Array.isArray(input)) return []
  return input.map((item) => cleanText(item, '')).filter(Boolean).slice(0, maxItems)
}

function sanitizeUnknownRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}

function cleanText(input: unknown, fallback: string) {
  return typeof input === 'string' && input.trim() ? input.trim().slice(0, 900) : fallback
}

function numberOf(input: unknown) {
  const value = Number(input)
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeRisk(input: unknown): RiskLevel {
  return input === 'High' || input === 'Medium' || input === 'Low' ? input : 'Medium'
}

function formatMoney(value: number) {
  return `฿${Math.round(value).toLocaleString('th-TH')}`
}

function slugify(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9ก-ฮ]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

const aiMarketerSystemPrompt = [
  'You are an expert AI performance marketer for a Thai clinic business: aesthetic surgery, injectables, skin laser, and related services.',
  'Use only the supplied Meta Ads metrics. Do not invent spend, ROAS, booking, revenue, age, or location data.',
  'Write concise Thai UI copy with common Ads/AI terms in English when useful.',
  'Every action must include evidence-based guardrails and rollback notes.',
  'Medical/aesthetic ads must avoid guaranteed results, exaggerated claims, and unsafe before/after promises.',
  'Only set execution to pause_campaign or activate_campaign when the evidence is strong enough for a campaign-level status change. Otherwise use none.',
].join('\n')

const aiCreativeSystemPrompt = [
  'You are a senior creative strategist for Thai aesthetic clinic Meta ads.',
  'Create practical copy, hooks, brief, work orders, and launch notes from the supplied real Meta ad/ad set/campaign metrics.',
  'Do not invent unavailable metrics. Do not make medical guarantees, cure claims, or definite result promises.',
  'Keep Thai copy short enough for ads. Use a professional clinic tone, not hype.',
  'The output is used in a web app to prefill Meta Ad Creative forms, so keep fields directly usable.',
].join('\n')

const aiMarketerSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'modelNotes', 'insights', 'actions'],
  properties: {
    summary: { type: 'string' },
    modelNotes: { type: 'array', maxItems: 5, items: { type: 'string' } },
    insights: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['campaignId', 'whatHappened', 'why', 'evidence', 'recommendation', 'confidence', 'risk'],
        properties: {
          campaignId: { type: 'string' },
          whatHappened: { type: 'string' },
          why: { type: 'string' },
          evidence: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
          recommendation: { type: 'string' },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          risk: { type: 'string', enum: ['Low', 'Medium', 'High'] },
        },
      },
    },
    actions: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'campaignId',
          'type',
          'target',
          'summary',
          'expectedImpact',
          'guardrail',
          'before',
          'after',
          'rollbackNote',
          'risk',
          'confidence',
          'execution',
        ],
        properties: {
          campaignId: { type: 'string' },
          type: { type: 'string' },
          target: { type: 'string' },
          summary: { type: 'string' },
          expectedImpact: { type: 'string' },
          guardrail: { type: 'string' },
          before: { type: 'string' },
          after: { type: 'string' },
          rollbackNote: { type: 'string' },
          risk: { type: 'string', enum: ['Low', 'Medium', 'High'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          execution: { type: 'string', enum: ['none', 'pause_campaign', 'activate_campaign'] },
        },
      },
    },
  },
}

const aiCreativeSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'brief',
    'hooks',
    'primaryTexts',
    'headlines',
    'descriptions',
    'launchNotes',
    'complianceNotes',
    'recommendedCta',
    'workOrders',
  ],
  properties: {
    summary: { type: 'string' },
    brief: {
      type: 'object',
      additionalProperties: false,
      required: ['objective', 'audience', 'offer', 'positioning'],
      properties: {
        objective: { type: 'string' },
        audience: { type: 'string' },
        offer: { type: 'string' },
        positioning: { type: 'string' },
      },
    },
    hooks: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
    primaryTexts: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } },
    headlines: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
    descriptions: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } },
    launchNotes: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string' } },
    complianceNotes: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string' } },
    recommendedCta: { type: 'string' },
    workOrders: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'owner', 'inputContext', 'expectedOutput'],
        properties: {
          title: { type: 'string' },
          owner: { type: 'string' },
          inputContext: { type: 'string' },
          expectedOutput: { type: 'string' },
        },
      },
    },
  },
}
