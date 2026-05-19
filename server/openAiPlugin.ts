import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import {
  appendAiBrainKnowledge,
  appendAiOutcomeKnowledge,
  buildKnowledgeQueryFromTargetIds,
  readAiBrainKnowledge,
  readAiOutcomeKnowledge,
} from './aiKnowledgeBase.js'
import type {
  AdInsight,
  AdSetInsight,
  AgentTaskEnvelope,
  AgentTaskResult,
  AiPhase4Response,
  AiBrainRecommendation,
  AiBrainResponse,
  AIInsight,
  CampaignInsight,
  DecisionRecord,
  KnowledgeMemory,
  MonitoringAlert,
  OutcomeLearningRecord,
  OutcomeObservation,
  OutcomeStatus,
  Phase4Report,
  RecommendedAction,
  RiskLevel,
  WebsiteContext,
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

interface AiBrainModelFinding {
  title: string
  explanation: string
  evidence: string[]
  confidence: number
  risk: RiskLevel
}

interface AiBrainModelRecommendation {
  type: string
  targetId: string
  targetName: string
  action: string
  expectedImpact: string
  guardrail: string
  rollbackNote: string
  risk: RiskLevel
  confidence: number
  evidence: string[]
}

interface AiBrainModelMemory {
  type: string
  title: string
  summary: string
  evidence: string[]
  entities: string[]
  metrics: Array<{ key: string; value: number }>
  recommendation: string
  outcome: string
  confidence: number
  tags: string[]
}

interface AiBrainModelAgentResult {
  agentName: string
  status: 'done' | 'blocked' | 'needs_review'
  summary: string
  evidence: string[]
  outputSummary: string
  output?: Record<string, unknown>
  blockers: string[]
}

interface AiBrainModelResult {
  summary: string
  masterDecision: string
  modelNotes: string[]
  findings: AiBrainModelFinding[]
  recommendations: AiBrainModelRecommendation[]
  memoryWrites: AiBrainModelMemory[]
  agentResults: AiBrainModelAgentResult[]
}

interface DeterministicMetricPack {
  account: {
    spend: number
    revenue: number
    roas: number
    cpa: number
    ctr: number
    clicks: number
    conversions: number
    campaigns: number
    activeCampaigns: number
    adSets: number
    ads: number
  }
  topCampaigns: Array<{
    id: string
    name: string
    spend: number
    roas: number
    cpa: number
    ctr: number
    conversions: number
    status: string
  }>
  topAds: Array<{
    id: string
    name: string
    spend: number
    roas: number
    ctr: number
    bookings: number
    status: string
  }>
  rules: string[]
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

	      if (requestUrl.pathname === '/api/ai/brain') {
	        if (req.method !== 'POST') {
	          writeJson(res, 405, { error: 'Method not allowed' })
	          return
        }

        assertJsonRequest(req)
        const config = await requireOpenAiConfig(env)
        const body = await readJsonBody(req)
        const workspace = normalizeWorkspacePayload(body.workspace)
        if (!hasWorkspaceSignal(workspace)) {
          throw new AiApiError('ต้อง Sync Meta API ก่อนให้ AI Brain วิเคราะห์ข้อมูลจริง', 400)
        }

        const startedAt = Date.now()
        const intent = cleanText(body.intent, 'Analyze the current PMC Ads workspace as the master controller.')
        const websiteContext = normalizeWebsiteContext(body.websiteContext)
        const suppliedMemories = normalizeKnowledgeMemories(body.memories)
        const suppliedDecisions = normalizeDecisionRecords(body.decisions)
        const targetIds = collectAiBrainTargetIds(workspace, websiteContext)
        const runtimeKnowledge = await readAiBrainKnowledge(buildKnowledgeQueryFromTargetIds(targetIds))
        const memories = mergeKnowledgeMemories(suppliedMemories, runtimeKnowledge.memories)
        const decisions = mergeDecisionRecords(suppliedDecisions, runtimeKnowledge.decisions)
        const metricPack = buildDeterministicMetricPack(workspace)
        const masterTask = createMasterTaskEnvelope({
          intent,
          workspace,
          websiteContext,
          memories,
          decisions,
          metricPack,
        })
        const contextBundle = assembleMasterContext({
          workspace,
          websiteContext,
          memories,
          decisions,
          metricPack,
        })
        const routing = routeMasterTasks(intent, contextBundle)
        const deterministicResults = buildDeterministicAgentResults(masterTask.taskId, contextBundle, routing)

        let modelFallback: string | null = null
        let modelResult: AiBrainModelResult
        try {
          modelResult = await callOpenAiJson<AiBrainModelResult>({
            config: {
              ...config,
              maxOutputTokens: Math.max(config.maxOutputTokens, 5_000),
            },
            schemaName: 'pmc_ai_brain_result',
            schema: aiBrainSchema,
            systemPrompt: aiBrainSystemPrompt,
            payload: {
              instruction: 'Act as PMC Master Agent. Route specialist thinking, enforce policy, and return Thai executive-ready analysis.',
              masterTask,
              routing,
              contextBundle,
            },
          })
        } catch (error) {
          if (!canFallbackAiBrainModel(error)) throw error
          modelFallback = error instanceof Error ? error.message : 'OpenAI response failed'
          modelResult = buildFallbackAiBrainModelResult({
            reason: modelFallback,
            metricPack,
            workspace,
          })
        }
        const brain = normalizeAiBrainResponse(modelResult, {
          masterTask,
          deterministicResults,
          decisions,
          metricPack,
          workspace,
        })
        const knowledgeWrite = await appendAiBrainKnowledge({
          memories: brain.memoryWrites,
          decisions: brain.decisionRecords.filter((decision) => decision.id.startsWith(`${masterTask.taskId}-decision-`)),
        })

        writeJson(res, 200, {
          ok: true,
          source: 'OpenAI Responses API',
          model: config.model,
          durationMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
          taskId: masterTask.taskId,
          contextSummary: contextBundle.summary,
          knowledge: {
            source: runtimeKnowledge.source,
            targetIds,
            memoriesRead: runtimeKnowledge.memories.length,
            decisionsRead: runtimeKnowledge.decisions.length,
            memoriesWritten: knowledgeWrite.memoriesWritten,
            decisionsWritten: knowledgeWrite.decisionsWritten,
          },
          routing,
          ...(modelFallback ? { modelFallback: { reason: modelFallback, mode: 'deterministic-specialist-output' } } : {}),
          ...brain,
	        })
	        return
	      }

	      if (requestUrl.pathname === '/api/ai/outcomes') {
	        if (req.method !== 'POST') {
	          writeJson(res, 405, { error: 'Method not allowed' })
	          return
	        }

	        assertJsonRequest(req)
	        const body = await readJsonBody(req)
	        const workspace = normalizeWorkspacePayload(body.workspace)
	        if (!hasWorkspaceSignal(workspace)) {
	          throw new AiApiError('ต้อง Sync Meta API ก่อนให้ Outcome Learning วิเคราะห์ข้อมูลจริง', 400)
	        }

	        const startedAt = Date.now()
	        const websiteContext = normalizeWebsiteContext(body.websiteContext)
	        const targetIds = collectAiBrainTargetIds(workspace, websiteContext)
	        const [runtimeKnowledge, priorOutcomeKnowledge] = await Promise.all([
	          readAiBrainKnowledge(buildKnowledgeQueryFromTargetIds(targetIds, 60)),
	          readAiOutcomeKnowledge(40),
	        ])
	        const phase4 = buildAiPhase4OutcomeResponse({
	          datePreset: cleanText(body.datePreset, 'current workspace'),
	          priorOutcomeKnowledge,
	          runtimeKnowledge,
	          workspace,
	        })
	        const [outcomeWrite, memoryWrite] = await Promise.all([
	          appendAiOutcomeKnowledge({
	            alerts: phase4.alerts,
	            learnings: phase4.learnings,
	            outcomes: phase4.outcomes,
	            reports: [phase4.report],
	          }),
	          appendAiBrainKnowledge({
	            memories: phase4.memoryWrites,
	            decisions: [],
	          }),
	        ])

	        writeJson(res, 200, {
	          ok: true,
	          source: 'Phase 4 deterministic agents',
	          durationMs: Date.now() - startedAt,
	          checkedAt: new Date().toISOString(),
	          ...phase4,
	          knowledge: {
	            ...phase4.knowledge,
	            memoriesWritten: memoryWrite.memoriesWritten,
	            outcomesWritten: outcomeWrite.outcomesWritten,
	            learningsWritten: outcomeWrite.learningsWritten,
	            alertsWritten: outcomeWrite.alertsWritten,
	            reportsWritten: outcomeWrite.reportsWritten,
	          },
	        })
	        return
	      }

	      if (requestUrl.pathname === '/api/ai/knowledge/capture') {
	        if (req.method !== 'POST') {
	          writeJson(res, 405, { error: 'Method not allowed' })
	          return
	        }

	        assertJsonRequest(req)
	        const body = await readJsonBody(req)
	        const workspace = normalizeWorkspacePayload(body.workspace)
	        if (!hasWorkspaceSignal(workspace)) {
	          throw new AiApiError('ต้อง Sync Meta API ก่อนบันทึกข้อมูลเข้า knowledgebase', 400)
	        }

	        const memory = buildKnowledgeCaptureMemory({
	          note: cleanText(body.note, ''),
	          source: cleanText(body.source, 'PMC Master Agent'),
	          targetId: cleanText(body.targetId, ''),
	          targetName: cleanText(body.targetName, ''),
	          workspace,
	        })
	        const write = await appendAiBrainKnowledge({ memories: [memory], decisions: [] })
	        writeJson(res, 200, {
	          ok: true,
	          checkedAt: new Date().toISOString(),
	          memory,
	          knowledge: {
	            source: write.source,
	            memoriesWritten: write.memoriesWritten,
	            decisionsWritten: write.decisionsWritten,
	          },
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

function normalizeWebsiteContext(input: unknown): WebsiteContext | null {
  const record = sanitizeUnknownRecord(input)
  if (!Object.keys(record).length) return null
  const dataState = cleanText(record.dataState, 'unknown')
  const modalRecord = sanitizeUnknownRecord(record.modal)
  const modalTitle = cleanText(modalRecord.title, '')
  return {
    route: cleanText(record.route, '/'),
    activeTab: cleanText(record.activeTab, 'unknown'),
    datePreset: cleanText(record.datePreset, 'unknown'),
    dataState: ['loading', 'live', 'empty', 'error', 'unknown'].includes(dataState) ? dataState as WebsiteContext['dataState'] : 'unknown',
    ...(cleanText(record.selectedCampaignId, '') ? { selectedCampaignId: cleanText(record.selectedCampaignId, '') } : {}),
    ...(cleanText(record.selectedAdSetId, '') ? { selectedAdSetId: cleanText(record.selectedAdSetId, '') } : {}),
    ...(cleanText(record.selectedAdId, '') ? { selectedAdId: cleanText(record.selectedAdId, '') } : {}),
    visibleCards: cleanStringList(record.visibleCards, 20),
    visibleTableRows: pickArray(record.visibleTableRows, (item): WebsiteContext['visibleTableRows'][number] | null => {
      const row = sanitizeUnknownRecord(item)
      const objectType = cleanText(row.objectType, '')
      const objectId = cleanText(row.objectId, '')
      if (!['campaign', 'adset', 'ad'].includes(objectType) || !objectId) return null
      return {
        objectType: objectType as WebsiteContext['visibleTableRows'][number]['objectType'],
        objectId,
        title: cleanText(row.title, objectId),
        visibleMetrics: sanitizeMetricRecord(row.visibleMetrics),
      }
    }).slice(0, 50),
    ...(modalTitle ? {
      modal: {
        type: cleanText(modalRecord.type, 'modal'),
        title: modalTitle,
        ...(cleanText(modalRecord.targetId, '') ? { targetId: cleanText(modalRecord.targetId, '') } : {}),
      },
    } : {}),
    ...(cleanText(record.lastError, '') ? { lastError: cleanText(record.lastError, '') } : {}),
    capturedAt: cleanText(record.capturedAt, new Date().toISOString()),
  }
}

function sanitizeMetricRecord(input: unknown) {
  const record = sanitizeUnknownRecord(input)
  const output: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(record).slice(0, 20)) {
    const cleanKey = key.trim().slice(0, 60)
    if (!cleanKey) continue
    if (typeof value === 'number' && Number.isFinite(value)) output[cleanKey] = value
    if (typeof value === 'string' && value.trim()) output[cleanKey] = value.trim().slice(0, 120)
  }
  return output
}

function normalizeKnowledgeMemories(input: unknown): KnowledgeMemory[] {
  const now = new Date().toISOString()
  return pickArray(input, (item, index): KnowledgeMemory | null => {
    const record = sanitizeUnknownRecord(item)
    const title = cleanText(record.title, '')
    const summary = cleanText(record.summary ?? record.detail, '')
    if (!title && !summary) return null
    return {
      id: cleanText(record.id, `memory-${Date.now()}-${index + 1}`),
      type: normalizeMemoryType(record.type ?? record.category),
      title: title || `Memory ${index + 1}`,
      summary: summary || title,
      evidence: normalizeMemoryEvidence(record.evidence, now),
      entities: normalizeMemoryEntities(record.entities),
      metrics: normalizeMemoryMetrics(record.metrics),
      ...(cleanText(record.recommendation, '') ? { recommendation: cleanText(record.recommendation, '') } : {}),
      ...(cleanText(record.outcome, '') ? { outcome: cleanText(record.outcome, '') } : {}),
      confidence: clamp(Math.round(numberOf(record.confidence)), 0, 100),
      tags: cleanStringList(record.tags, 12),
      createdAt: cleanText(record.createdAt, now),
      updatedAt: cleanText(record.updatedAt, now),
      ...(cleanText(record.expiresAt, '') ? { expiresAt: cleanText(record.expiresAt, '') } : {}),
    }
  }).slice(0, 20)
}

function normalizeDecisionRecords(input: unknown): DecisionRecord[] {
  const now = new Date().toISOString()
  return pickArray(input, (item, index): DecisionRecord | null => {
    const record = sanitizeUnknownRecord(item)
    const target = sanitizeUnknownRecord(record.target)
    const objectId = cleanText(target.objectId, '')
    const name = cleanText(target.name, objectId)
    if (!objectId && !name) return null
    return {
      id: cleanText(record.id, `decision-${Date.now()}-${index + 1}`),
      syncId: cleanText(record.syncId, 'unknown-sync'),
      actor: normalizeDecisionActor(record.actor),
      actionType: cleanText(record.actionType, 'AI recommendation'),
      target: {
        objectType: normalizeDecisionTargetType(target.objectType),
        objectId: objectId || name,
        name: name || objectId,
      },
      before: sanitizeUnknownRecord(record.before),
      recommendedAfter: sanitizeUnknownRecord(record.recommendedAfter),
      ...(Object.keys(sanitizeUnknownRecord(record.approvedAfter)).length ? { approvedAfter: sanitizeUnknownRecord(record.approvedAfter) } : {}),
      evidence: cleanStringList(record.evidence, 8),
      guardrail: cleanText(record.guardrail, 'ต้องตรวจ evidence ก่อนดำเนินการ'),
      risk: normalizeRisk(record.risk),
      confidence: clamp(Math.round(numberOf(record.confidence)), 0, 100),
      status: normalizeDecisionStatus(record.status),
      ...(cleanText(record.userNote, '') ? { userNote: cleanText(record.userNote, '') } : {}),
      ...(Object.keys(sanitizeUnknownRecord(record.executionResult)).length ? { executionResult: sanitizeUnknownRecord(record.executionResult) } : {}),
      createdAt: cleanText(record.createdAt, now),
      ...(cleanText(record.executedAt, '') ? { executedAt: cleanText(record.executedAt, '') } : {}),
    }
  }).slice(0, 30)
}

function collectAiBrainTargetIds(workspace: ReturnType<typeof normalizeWorkspacePayload>, websiteContext: WebsiteContext | null) {
  const ids = new Set<string>()
  const add = (value: string | undefined | null) => {
    const id = (value ?? '').trim()
    if (id) ids.add(id)
  }

  add(websiteContext?.selectedCampaignId)
  add(websiteContext?.selectedAdSetId)
  add(websiteContext?.selectedAdId)
  for (const row of websiteContext?.visibleTableRows ?? []) add(row.objectId)
  for (const campaign of workspace.campaigns.slice(0, 5)) add(campaign.id)
  for (const adSet of workspace.adSets.slice(0, 5)) add(adSet.id)
  for (const ad of workspace.adInsights.slice(0, 5)) add(ad.id)

  return Array.from(ids).slice(0, 30)
}

function mergeKnowledgeMemories(primary: KnowledgeMemory[], secondary: KnowledgeMemory[]) {
  const byId = new Map<string, KnowledgeMemory>()
  for (const memory of [...secondary, ...primary]) byId.set(memory.id, memory)
  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 30)
}

function mergeDecisionRecords(primary: DecisionRecord[], secondary: DecisionRecord[]) {
  const byId = new Map<string, DecisionRecord>()
  for (const decision of [...secondary, ...primary]) byId.set(decision.id, decision)
  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 40)
}

function buildDeterministicMetricPack(workspace: ReturnType<typeof normalizeWorkspacePayload>): DeterministicMetricPack {
  const campaignSpend = workspace.campaigns.reduce((sum, campaign) => sum + campaign.spend, 0)
  const campaignRevenue = workspace.campaigns.reduce((sum, campaign) => sum + campaign.revenue, 0)
  const campaignConversions = workspace.campaigns.reduce((sum, campaign) => sum + campaign.conversions, 0)
  const adSpend = workspace.adInsights.reduce((sum, ad) => sum + ad.spend, 0)
  const adClicks = workspace.adInsights.reduce((sum, ad) => sum + ad.clicks, 0)
  const adImpressions = workspace.adInsights.reduce((sum, ad) => sum + ad.impressions, 0)
  const adBookings = workspace.adInsights.reduce((sum, ad) => sum + ad.bookings, 0)
  const spend = campaignSpend || adSpend
  const conversions = campaignConversions || adBookings
  const revenue = campaignRevenue

  const rules = [
    'ROAS = revenue / spend from normalized Meta workspace',
    'CPA = spend / conversions from normalized Meta workspace',
    'CTR = clicks / impressions * 100 from ad-level Meta insights when available',
    'Phase 3 policy: Specialist Agents can recommend approval cards only. Direct execution is disabled.',
  ]

  return {
    account: {
      spend: round2(spend),
      revenue: round2(revenue),
      roas: round2(safeDivide(revenue, spend)),
      cpa: round2(safeDivide(spend, conversions)),
      ctr: round2(safeRate(adClicks, adImpressions)),
      clicks: adClicks,
      conversions,
      campaigns: workspace.campaigns.length,
      activeCampaigns: workspace.campaigns.filter((campaign) => campaign.deliveryStatus === 'active').length,
      adSets: workspace.adSets.length,
      ads: workspace.adInsights.length,
    },
    topCampaigns: workspace.campaigns
      .slice()
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 8)
      .map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        spend: round2(campaign.spend),
        roas: round2(campaign.roas),
        cpa: round2(campaign.cpa),
        ctr: round2(campaign.ctr),
        conversions: campaign.conversions,
        status: campaign.deliveryStatus,
      })),
    topAds: workspace.adInsights
      .slice()
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 8)
      .map((ad) => ({
        id: ad.id,
        name: ad.name,
        spend: round2(ad.spend),
        roas: round2(ad.roas),
        ctr: round2(ad.ctr),
        bookings: ad.bookings,
        status: ad.status,
      })),
    rules,
  }
}

function createMasterTaskEnvelope({
  intent,
  workspace,
  websiteContext,
  memories,
  decisions,
  metricPack,
}: {
  intent: string
  workspace: ReturnType<typeof normalizeWorkspacePayload>
  websiteContext: WebsiteContext | null
  memories: KnowledgeMemory[]
  decisions: DecisionRecord[]
  metricPack: DeterministicMetricPack
}): AgentTaskEnvelope {
  const inputSources: AgentTaskEnvelope['inputSources'] = ['meta_api', 'user_input']
  if (websiteContext) inputSources.push('website_ui')
  if (memories.length || decisions.length) inputSources.push('knowledgebase')

  return {
    taskId: `ai-brain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    requestedBy: 'master',
    agentName: 'PMC Master Agent',
    intent,
    inputSources,
    payload: {
      workspaceCounts: {
        campaigns: workspace.campaigns.length,
        adSets: workspace.adSets.length,
        ads: workspace.adInsights.length,
        memories: memories.length,
        decisions: decisions.length,
      },
      selectedContext: websiteContext ? {
        activeTab: websiteContext.activeTab,
        selectedCampaignId: websiteContext.selectedCampaignId ?? null,
        selectedAdSetId: websiteContext.selectedAdSetId ?? null,
        selectedAdId: websiteContext.selectedAdId ?? null,
      } : null,
      accountMetrics: metricPack.account,
    },
    constraints: {
      noInventedMetrics: true,
      requireEvidence: true,
      requireApprovalForWrites: true,
      medicalCompliance: true,
    },
  }
}

function assembleMasterContext({
  workspace,
  websiteContext,
  memories,
  decisions,
  metricPack,
}: {
  workspace: ReturnType<typeof normalizeWorkspacePayload>
  websiteContext: WebsiteContext | null
  memories: KnowledgeMemory[]
  decisions: DecisionRecord[]
  metricPack: DeterministicMetricPack
}) {
  return {
    summary: {
      workspaceUpdatedAt: workspace.updatedAt || 'unknown',
      campaignCount: workspace.campaigns.length,
      adSetCount: workspace.adSets.length,
      adCount: workspace.adInsights.length,
      memoryCount: memories.length,
      decisionCount: decisions.length,
      activeTab: websiteContext?.activeTab ?? 'unknown',
      selectedCampaignId: websiteContext?.selectedCampaignId ?? null,
      selectedAdSetId: websiteContext?.selectedAdSetId ?? null,
      selectedAdId: websiteContext?.selectedAdId ?? null,
    },
    policy: {
      masterAgent: 'PMC Master Agent',
      directExecutionAllowed: false,
      approvalRequiredForWrites: true,
      noInventedMetrics: true,
      metricSourceOfTruth: 'WorkspaceData from Meta API proxy',
      phase: 'Phase 2: Real Data, Website Context & Runtime Knowledgebase',
    },
    dataQuality: buildDataQualityReport(workspace, websiteContext),
    metricPack,
    workspace,
    websiteContext,
    memories,
    decisions,
  }
}

function buildDataQualityReport(workspace: ReturnType<typeof normalizeWorkspacePayload>, websiteContext: WebsiteContext | null) {
  const warnings: string[] = []
  if (!workspace.updatedAt) warnings.push('workspace.updatedAt is missing')
  if (!workspace.campaigns.length) warnings.push('No campaign rows in workspace')
  if (!workspace.adInsights.length) warnings.push('No ad-level rows in workspace')
  if (websiteContext?.dataState === 'error') warnings.push(`Website context reports error: ${websiteContext.lastError || 'unknown error'}`)
  if (websiteContext?.dataState === 'empty') warnings.push('Website context reports empty state')

  return {
    status: warnings.length ? 'needs_review' : 'ready',
    warnings,
  }
}

function routeMasterTasks(intent: string, contextBundle: ReturnType<typeof assembleMasterContext>) {
  const normalizedIntent = intent.toLowerCase()
  const agents = ['Context Assembler Agent', 'Policy Controller Agent', 'Metric Calculator Agent']
  if (contextBundle.summary.campaignCount) agents.push('Campaign Analyst Agent')
  if (contextBundle.summary.adSetCount) agents.push('Ad Set Analyst Agent')
  if (contextBundle.summary.adCount) agents.push('Ad Analyst Agent', 'Creative Strategist Agent')
  if (contextBundle.websiteContext) agents.push('Website Context Reader Agent')
  if (contextBundle.memories.length || contextBundle.decisions.length) agents.push('Memory Retriever Agent', 'Decision Historian Agent')
  if (/budget|งบ|scale|roas|cpa|performance|แคมเปญ/.test(normalizedIntent)) agents.push('Budget Optimization Agent')
  if (/creative|copy|hook|ครีเอทีฟ|โฆษณา/.test(normalizedIntent)) agents.push('Creative Strategist Agent', 'Medical Ads Compliance Agent')
  agents.push('Approval Gatekeeper Agent')

  return Array.from(new Set(agents)).map((agentName, index) => ({
    order: index + 1,
    agentName,
    reason: routeReason(agentName),
  }))
}

function routeReason(agentName: string) {
  const reasons: Record<string, string> = {
    'Context Assembler Agent': 'รวม workspace, website context, memory และ decision history',
    'Policy Controller Agent': 'บังคับ no invented metrics และ no direct write policy',
    'Metric Calculator Agent': 'ใช้ metric ที่ code คำนวณเป็น source of truth',
    'Campaign Analyst Agent': 'มี campaign-level data ให้ตรวจ performance',
    'Ad Set Analyst Agent': 'มี audience/ad set data ให้ตรวจ targeting',
    'Ad Analyst Agent': 'มี ad-level data ให้ตรวจ creative และ delivery',
    'Creative Strategist Agent': 'ต้องอ่าน creative signal และเสนอ copy/brief ที่ปลอดภัย',
    'Website Context Reader Agent': 'มี UI context จากหน้าเว็บที่ผู้ใช้กำลังดู',
    'Memory Retriever Agent': 'มี memory ที่เกี่ยวข้องให้ retrieve',
    'Decision Historian Agent': 'มี decision history ให้ใช้กันคำแนะนำซ้ำหรือขัดกัน',
    'Budget Optimization Agent': 'intent เกี่ยวกับ budget, ROAS, CPA หรือ performance',
    'Medical Ads Compliance Agent': 'intent เกี่ยวกับ creative/copy ในกลุ่มคลินิก',
    'Approval Gatekeeper Agent': 'ทุก action ต้องกลายเป็น approval request ก่อน execute',
  }
  return reasons[agentName] ?? 'specialist routing from Master Controller'
}

function buildDeterministicAgentResults(
  taskId: string,
  contextBundle: ReturnType<typeof assembleMasterContext>,
  routing: ReturnType<typeof routeMasterTasks>,
): AgentTaskResult[] {
  return [
    {
      taskId,
      agentName: 'Context Assembler Agent',
      status: 'done',
      summary: `Context ready: ${contextBundle.summary.campaignCount} campaigns, ${contextBundle.summary.adSetCount} ad sets, ${contextBundle.summary.adCount} ads`,
      evidence: [
        `Workspace updatedAt: ${contextBundle.summary.workspaceUpdatedAt}`,
        `Input active tab: ${contextBundle.summary.activeTab}`,
      ],
      output: contextBundle.summary,
      proposedActions: [],
      memoryWrites: [],
      blockers: [],
    },
    {
      taskId,
      agentName: 'Metric Calculator Agent',
      status: 'done',
      summary: `Deterministic metrics calculated: spend ${formatMoney(contextBundle.metricPack.account.spend)}, ROAS ${contextBundle.metricPack.account.roas.toFixed(2)}x, CPA ${formatMoney(contextBundle.metricPack.account.cpa)}`,
      evidence: contextBundle.metricPack.rules,
      output: contextBundle.metricPack.account,
      proposedActions: [],
      memoryWrites: [],
      blockers: [],
    },
    {
      taskId,
      agentName: 'Task Router Agent',
      status: 'done',
      summary: `Master routed work to ${routing.length} agents`,
      evidence: routing.map((route) => `${route.agentName}: ${route.reason}`).slice(0, 12),
      output: { routing },
      proposedActions: [],
      memoryWrites: [],
      blockers: [],
    },
    {
      taskId,
      agentName: 'Policy Controller Agent',
      status: contextBundle.dataQuality.status === 'ready' ? 'done' : 'needs_review',
      summary: 'Phase 2 policy active: AI can use website context and runtime memory, but direct execution is disabled.',
      evidence: [
        'requireApprovalForWrites=true',
        'noInventedMetrics=true',
        'directExecutionAllowed=false',
        `runtimeMemory=${contextBundle.memories.length}`,
        `runtimeDecisions=${contextBundle.decisions.length}`,
        ...contextBundle.dataQuality.warnings,
      ],
      output: contextBundle.policy,
      proposedActions: [],
      memoryWrites: [],
      blockers: contextBundle.dataQuality.warnings,
    },
  ]
}

function normalizeAiBrainResponse(
  input: AiBrainModelResult,
  context: {
    masterTask: AgentTaskEnvelope
    deterministicResults: AgentTaskResult[]
    decisions: DecisionRecord[]
    metricPack: DeterministicMetricPack
    workspace: ReturnType<typeof normalizeWorkspacePayload>
  },
): AiBrainResponse {
  const recommendations = normalizeBrainRecommendations(input.recommendations, context.workspace)
  const specialistOutputs = buildAiBrainSpecialistOutputs(recommendations, context.metricPack, context.workspace)
  const approvalActions = buildApprovalActionsFromRecommendations(recommendations, context.masterTask.taskId, context.workspace)
  const normalizedMemoryWrites = normalizeBrainMemoryWrites(input.memoryWrites, context.masterTask.taskId, context.workspace)
  const memoryWrites = normalizedMemoryWrites.length
    ? normalizedMemoryWrites
    : [buildFallbackBrainMemory(input, recommendations, context.masterTask.taskId, context.metricPack, context.workspace)]
  const agentResults = [
    ...context.deterministicResults,
    ...specialistReportsToAgentResults(specialistOutputs, approvalActions, context.masterTask.taskId),
    ...normalizeBrainAgentResults(input.agentResults, context.masterTask.taskId),
  ].slice(0, 24)

  return {
    summary: cleanText(input.summary, 'PMC Master Agent วิเคราะห์ workspace แล้ว'),
    masterDecision: cleanText(input.masterDecision, 'Phase 3: แยกงานให้ Specialist Agents และสร้าง approval cards โดยยังไม่ execute โดยตรง'),
    findings: pickArray(input.findings, (item): AiBrainResponse['findings'][number] | null => {
      const record = sanitizeUnknownRecord(item)
      const title = cleanText(record.title, '')
      if (!title) return null
      return {
        title,
        explanation: cleanText(record.explanation, 'วิเคราะห์จาก WorkspaceData และ deterministic metrics'),
        evidence: cleanStringList(record.evidence, 6),
        confidence: clamp(Math.round(numberOf(record.confidence)), 0, 100),
        risk: normalizeRisk(record.risk),
      }
    }).slice(0, 8),
    recommendations,
    specialistOutputs,
    approvalActions,
    agentResults,
    memoryWrites,
    decisionRecords: [
      ...context.decisions,
      ...buildDecisionRecordsFromRecommendations(recommendations, context.masterTask.taskId, context.workspace),
    ].slice(-30),
    policy: {
      approvedForDirectExecution: false,
      reasons: [
        'Phase 3 policy creates approval-only action cards.',
        'Specialist agents can propose work, but Master Agent keeps direct execution disabled.',
        'Meta API write execution remains behind human approval and backend guardrails.',
      ],
    },
  }
}

function normalizeBrainRecommendations(input: unknown, workspace: ReturnType<typeof normalizeWorkspacePayload>): AiBrainRecommendation[] {
  return pickArray(input, (item): AiBrainRecommendation | null => {
    const record = sanitizeUnknownRecord(item)
    const target = resolveWorkspaceTarget(workspace, cleanText(record.targetId, ''), cleanText(record.targetName, ''))
    const action = cleanText(record.action, '')
    if (!action) return null
    return {
      type: cleanText(record.type, 'Master recommendation'),
      targetId: target.objectId,
      targetName: target.name,
      action,
      expectedImpact: cleanText(record.expectedImpact, 'ช่วยให้ทีมตัดสินใจจากข้อมูลจริงได้เร็วขึ้น'),
      guardrail: cleanText(record.guardrail, 'ต้องตรวจ evidence และ approve ก่อนดำเนินการ'),
      rollbackNote: cleanText(record.rollbackNote, 'ถ้า execute ภายหลังแล้วผลแย่ลง ให้ sync ใหม่และย้อนสถานะ/งบผ่าน Meta'),
      risk: normalizeRisk(record.risk),
      confidence: clamp(Math.round(numberOf(record.confidence)), 0, 100),
      executable: false,
      requiresApproval: true,
      evidence: cleanStringList(record.evidence, 6),
    }
  }).slice(0, 10)
}

function buildAiPhase4OutcomeResponse({
  datePreset,
  priorOutcomeKnowledge,
  runtimeKnowledge,
  workspace,
}: {
  datePreset: string
  priorOutcomeKnowledge: Awaited<ReturnType<typeof readAiOutcomeKnowledge>>
  runtimeKnowledge: Awaited<ReturnType<typeof readAiBrainKnowledge>>
  workspace: ReturnType<typeof normalizeWorkspacePayload>
}): AiPhase4Response {
  const now = new Date().toISOString()
  const metricPack = buildDeterministicMetricPack(workspace)
  const decisions = runtimeKnowledge.decisions
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 12)
  const outcomes = buildOutcomeObservations(decisions, workspace, now)
  const alerts = buildMonitoringAlerts({
    decisions,
    metricPack,
    now,
    priorAlerts: priorOutcomeKnowledge.alerts,
    workspace,
  })
  const learnings = buildOutcomeLearnings(outcomes, priorOutcomeKnowledge.learnings, now)
  const report = buildPhase4Report({
    alerts,
    datePreset,
    learnings,
    metricPack,
    now,
    outcomes,
  })
  const memoryWrites = buildPhase4MemoryWrites({ learnings, outcomes, report, now })
  const agents = buildPhase4AgentReports({ alerts, learnings, outcomes, report })

  return {
    summary: report.summary,
    agents,
    outcomes,
    learnings,
    alerts,
    report,
    memoryWrites,
    knowledge: {
      source: runtimeKnowledge.source,
      decisionsRead: runtimeKnowledge.decisions.length,
      memoriesRead: runtimeKnowledge.memories.length,
      memoriesWritten: 0,
      outcomesWritten: 0,
      learningsWritten: 0,
      alertsWritten: 0,
      reportsWritten: 0,
    },
    policy: {
      approvedForDirectExecution: false,
      reasons: [
        'Phase 4 observes and learns; it does not grant execution rights.',
        'Outcome deltas are treated as correlation, not proof of causality.',
        'Meta write actions still require separate approval, guardrails, audit, and post-action sync.',
      ],
    },
  }
}

function buildOutcomeObservations(
  decisions: DecisionRecord[],
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
  observedAt: string,
): OutcomeObservation[] {
  return decisions.map((decision) => {
    const after = snapshotForOutcomeTarget(workspace, decision.target)
    const deltas = calculateOutcomeDeltas(decision.before, after)
    const status = classifyOutcomeStatus(decision, deltas, after)
    const window = selectOutcomeWindow(decision, observedAt)
    return {
      id: `outcome-${decision.id}-${window}`,
      decisionId: decision.id,
      target: decision.target,
      window,
      before: decision.before,
      after,
      deltas,
      status,
      summary: outcomeSummary(decision, status, deltas),
      evidence: buildOutcomeEvidence(decision, after, deltas),
      confidence: confidenceForOutcome(decision, status, deltas),
      observedAt,
    }
  })
}

function snapshotForOutcomeTarget(
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
  target: DecisionRecord['target'],
): Record<string, unknown> {
  if (target.objectType === 'account') {
    const metricPack = buildDeterministicMetricPack(workspace)
    return metricPack.account
  }
  return beforeSnapshotForTarget(workspace, target.objectId)
}

function calculateOutcomeDeltas(before: Record<string, unknown>, after: Record<string, unknown>): OutcomeObservation['deltas'] {
  return {
    spend: round2(numberOf(after.spend) - numberOf(before.spend)),
    revenue: round2(numberOf(after.revenue) - numberOf(before.revenue)),
    roas: round2(numberOf(after.roas) - numberOf(before.roas)),
    cpa: round2(numberOf(after.cpa) - numberOf(before.cpa)),
    ctr: round2(numberOf(after.ctr) - numberOf(before.ctr)),
    conversions: round2(numberOf(after.conversions ?? after.bookings) - numberOf(before.conversions ?? before.bookings)),
  }
}

function classifyOutcomeStatus(
  decision: DecisionRecord,
  deltas: OutcomeObservation['deltas'],
  after: Record<string, unknown>,
): OutcomeStatus {
  if (!Object.keys(after).length) return 'blocked'
  if (decision.status !== 'executed' && decision.status !== 'rolled_back') return 'pending'
  const roasDelta = deltas.roas ?? 0
  const cpaDelta = deltas.cpa ?? 0
  const conversionDelta = deltas.conversions ?? 0
  if (roasDelta >= 0.2 || conversionDelta > 0 || cpaDelta < -50) return 'improved'
  if (roasDelta <= -0.2 || cpaDelta > 50) return 'declined'
  return 'unchanged'
}

function selectOutcomeWindow(decision: DecisionRecord, observedAt: string): OutcomeObservation['window'] {
  if (!decision.executedAt) return 'manual_review'
  const elapsedHours = Math.max(0, (Date.parse(observedAt) - Date.parse(decision.executedAt)) / 3_600_000)
  if (elapsedHours >= 168) return '7d'
  if (elapsedHours >= 48) return '48h'
  if (elapsedHours >= 24) return '24h'
  return 'same_sync'
}

function outcomeSummary(
  decision: DecisionRecord,
  status: OutcomeStatus,
  deltas: OutcomeObservation['deltas'],
) {
  const deltaText = `ROAS ${formatSigned(deltas.roas)} · CPA ${formatSigned(deltas.cpa)} · conversions ${formatSigned(deltas.conversions)}`
  if (status === 'pending') return `ยังเรียนรู้ outcome จริงไม่ได้ เพราะ decision "${decision.actionType}" ยังเป็น ${decision.status}; ${deltaText}`
  if (status === 'blocked') return `ยังเทียบ outcome ไม่ได้ เพราะไม่พบ target ล่าสุดใน workspace; ${deltaText}`
  if (status === 'improved') return `ผลลัพธ์มีทิศทางดีขึ้นหลัง action "${decision.actionType}"; ${deltaText}`
  if (status === 'declined') return `ผลลัพธ์แย่ลงหลัง action "${decision.actionType}" ต้องรีวิวก่อนทำซ้ำ; ${deltaText}`
  return `ผลลัพธ์ยังไม่เปลี่ยนชัดหลัง action "${decision.actionType}"; ${deltaText}`
}

function buildOutcomeEvidence(
  decision: DecisionRecord,
  after: Record<string, unknown>,
  deltas: OutcomeObservation['deltas'],
) {
  return [
    `decision=${decision.id}, status=${decision.status}, target=${decision.target.name}`,
    `before ROAS ${numberOf(decision.before.roas).toFixed(2)}x, CPA ${formatMoney(numberOf(decision.before.cpa))}, conversions ${numberOf(decision.before.conversions ?? decision.before.bookings)}`,
    `after ROAS ${numberOf(after.roas).toFixed(2)}x, CPA ${formatMoney(numberOf(after.cpa))}, conversions ${numberOf(after.conversions ?? after.bookings)}`,
    `delta ROAS ${formatSigned(deltas.roas)}, CPA ${formatSigned(deltas.cpa)}, conversions ${formatSigned(deltas.conversions)}`,
  ].slice(0, 6)
}

function confidenceForOutcome(
  decision: DecisionRecord,
  status: OutcomeStatus,
  deltas: OutcomeObservation['deltas'],
) {
  if (status === 'pending' || status === 'blocked') return 55
  const movement = Math.abs(deltas.roas ?? 0) + Math.abs((deltas.conversions ?? 0) / 10)
  return clamp(Math.round(Math.min(90, decision.confidence * 0.65 + movement * 10)), 45, 90)
}

function buildMonitoringAlerts({
  decisions,
  metricPack,
  now,
  priorAlerts,
  workspace,
}: {
  decisions: DecisionRecord[]
  metricPack: DeterministicMetricPack
  now: string
  priorAlerts: MonitoringAlert[]
  workspace: ReturnType<typeof normalizeWorkspacePayload>
}): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = []
  const highRiskPending = decisions.filter((decision) => decision.risk === 'High' && decision.status === 'suggested')
  const executedDecisions = decisions.filter((decision) => decision.status === 'executed')
  const updatedAtAgeHours = workspace.updatedAt ? (Date.parse(now) - Date.parse(workspace.updatedAt)) / 3_600_000 : Number.POSITIVE_INFINITY
  const channel = workspace.channelPerformance[0]
  const channelSpendDelta = channel ? Math.abs(channel.spend - metricPack.account.spend) : 0
  const channelRevenueDelta = channel ? Math.abs(channel.revenue - metricPack.account.revenue) : 0

  if (metricPack.account.activeCampaigns === 0) {
    alerts.push(createMonitoringAlert({
      detail: 'บัญชีมี historical data แต่ไม่มี campaign active ใน workspace ล่าสุด',
      evidence: [`activeCampaigns=${metricPack.account.activeCampaigns}`, `campaigns=${metricPack.account.campaigns}`],
      now,
      severity: 'watch',
      source: 'sync',
      title: 'ไม่มี active campaign ให้ observe หลัง action',
    }))
  }

  if (updatedAtAgeHours > 24) {
    alerts.push(createMonitoringAlert({
      detail: 'ข้อมูล workspace ล่าสุดเก่ากว่า 24 ชั่วโมง ควร sync ก่อนใช้ outcome learning',
      evidence: [`workspace.updatedAt=${workspace.updatedAt || 'missing'}`, `ageHours=${Math.round(updatedAtAgeHours)}`],
      now,
      severity: 'critical',
      source: 'sync',
      title: 'ข้อมูล stale',
    }))
  }

  if (highRiskPending.length) {
    alerts.push(createMonitoringAlert({
      detail: `มี high-risk recommendations ${highRiskPending.length} รายการที่ยังเป็น suggested`,
      evidence: highRiskPending.slice(0, 4).map((decision) => `${decision.target.name}: ${decision.actionType}`),
      now,
      severity: 'watch',
      source: 'ai',
      title: 'High-risk action ยังรอ approval',
    }))
  }

  if (!executedDecisions.length) {
    alerts.push(createMonitoringAlert({
      detail: 'ยังไม่มี executed decision ใน runtime knowledgebase จึงเรียนรู้ผลหลัง action ได้แบบ pending เท่านั้น',
      evidence: [`runtimeDecisions=${decisions.length}`, 'executedDecisions=0'],
      now,
      severity: 'info',
      source: 'knowledgebase',
      title: 'ยังไม่มี execution outcome',
    }))
  }

  if (channel && (channelSpendDelta > metricPack.account.spend * 0.2 || channelRevenueDelta > metricPack.account.revenue * 0.2)) {
    alerts.push(createMonitoringAlert({
      detail: 'ยอด aggregate จาก channelPerformance ต่างจาก object-level metricPack เกิน 20%',
      evidence: [
        `metricPack spend=${formatMoney(metricPack.account.spend)}, revenue=${formatMoney(metricPack.account.revenue)}`,
        `channel spend=${formatMoney(channel.spend)}, revenue=${formatMoney(channel.revenue)}`,
      ],
      now,
      severity: 'watch',
      source: 'sync',
      title: 'Metric baseline ไม่ตรงกัน',
    }))
  }

  return mergeOpenAlerts(alerts, priorAlerts).slice(0, 8)
}

function createMonitoringAlert({
  detail,
  evidence,
  now,
  severity,
  source,
  title,
}: {
  detail: string
  evidence: string[]
  now: string
  severity: MonitoringAlert['severity']
  source: MonitoringAlert['source']
  title: string
}): MonitoringAlert {
  return {
    id: `phase4-alert-${slugify(title, 'alert')}-${slugify(evidence[0] ?? detail, 'evidence')}`,
    severity,
    title,
    detail,
    source,
    evidence,
    status: 'open',
    createdAt: now,
  }
}

function mergeOpenAlerts(nextAlerts: MonitoringAlert[], priorAlerts: MonitoringAlert[]) {
  const byId = new Map<string, MonitoringAlert>()
  for (const alert of [...priorAlerts.filter((alert) => alert.status === 'open'), ...nextAlerts]) {
    byId.set(alert.id, alert)
  }
  return Array.from(byId.values()).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

function severityRank(severity: MonitoringAlert['severity']) {
  if (severity === 'critical') return 3
  if (severity === 'watch') return 2
  return 1
}

function buildOutcomeLearnings(
  outcomes: OutcomeObservation[],
  priorLearnings: OutcomeLearningRecord[],
  createdAt: string,
): OutcomeLearningRecord[] {
  const improved = outcomes.filter((outcome) => outcome.status === 'improved')
  const declined = outcomes.filter((outcome) => outcome.status === 'declined')
  const pending = outcomes.filter((outcome) => outcome.status === 'pending')
  const learnings: OutcomeLearningRecord[] = []

  if (improved.length) {
    learnings.push({
      id: `learning-improved-${createdAt.slice(0, 10)}`,
      title: 'Pattern ที่มีผลดีขึ้น',
      summary: `${improved.length} executed outcomes มีทิศทางดีขึ้น แต่ยังถือเป็น correlation ต้องดูซ้ำหลายรอบ`,
      pattern: improved.slice(0, 3).map((outcome) => outcome.target.name).join(' | '),
      recommendation: 'เพิ่ม confidence เฉพาะ recommendation ที่มี evidence ใกล้เคียง และยังต้องผ่าน approval',
      supportingOutcomeIds: improved.map((outcome) => outcome.id),
      confidence: 72,
      tags: ['phase-4', 'outcome-learning', 'improved'],
      createdAt,
    })
  }

  if (declined.length) {
    learnings.push({
      id: `learning-declined-${createdAt.slice(0, 10)}`,
      title: 'Pattern ที่ควรระวังก่อนทำซ้ำ',
      summary: `${declined.length} executed outcomes แย่ลง ควรเพิ่ม guardrail ก่อนเสนอ action แบบเดียวกัน`,
      pattern: declined.slice(0, 3).map((outcome) => outcome.target.name).join(' | '),
      recommendation: 'ลด confidence และบังคับ diagnosis/compliance review ก่อนเสนอซ้ำ',
      supportingOutcomeIds: declined.map((outcome) => outcome.id),
      confidence: 80,
      tags: ['phase-4', 'outcome-learning', 'declined'],
      createdAt,
    })
  }

  if (pending.length) {
    learnings.push({
      id: `learning-pending-${createdAt.slice(0, 10)}`,
      title: 'ยังไม่มี executed outcome เพียงพอ',
      summary: `${pending.length} recommendations ยังเป็น plan/suggested จึงยังสรุปผลหลัง action จริงไม่ได้`,
      pattern: 'approval-only queue without execution result',
      recommendation: 'เมื่อเปิด execution layer ต้องส่ง decisionId และ before snapshot กลับมาเพื่อ observe 24h/48h/7d',
      supportingOutcomeIds: pending.map((outcome) => outcome.id),
      confidence: 88,
      tags: ['phase-4', 'outcome-learning', 'pending'],
      createdAt,
    })
  }

  const priorIds = new Set(priorLearnings.map((learning) => learning.id))
  return learnings.filter((learning) => !priorIds.has(learning.id)).slice(0, 6)
}

function buildPhase4Report({
  alerts,
  datePreset,
  learnings,
  metricPack,
  now,
  outcomes,
}: {
  alerts: MonitoringAlert[]
  datePreset: string
  learnings: OutcomeLearningRecord[]
  metricPack: DeterministicMetricPack
  now: string
  outcomes: OutcomeObservation[]
}): Phase4Report {
  const improved = outcomes.filter((outcome) => outcome.status === 'improved').length
  const declined = outcomes.filter((outcome) => outcome.status === 'declined').length
  const pending = outcomes.filter((outcome) => outcome.status === 'pending').length
  const criticalAlerts = alerts.filter((alert) => alert.severity === 'critical').length
  const outcomeStatus: OutcomeStatus = criticalAlerts ? 'blocked' : declined ? 'declined' : improved ? 'improved' : pending ? 'pending' : 'unchanged'
  return {
    id: `phase4-report-${Date.parse(now)}`,
    generatedAt: now,
    period: datePreset,
    summary: `Phase 4 ตรวจ ${outcomes.length} decisions, พบ learning ใหม่ ${learnings.length} รายการ และ alert เปิดอยู่ ${alerts.length} รายการ`,
    outcomeStatus,
    metrics: metricPack.account,
    keyFindings: [
      `Outcome improved=${improved}, declined=${declined}, pending=${pending}`,
      `Open alerts=${alerts.length}, critical=${criticalAlerts}`,
      `Account spend ${formatMoney(metricPack.account.spend)}, ROAS ${metricPack.account.roas.toFixed(2)}x, CPA ${formatMoney(metricPack.account.cpa)}`,
    ],
    nextActions: [
      criticalAlerts ? 'Sync/แก้ alert critical ก่อนใช้รายงาน' : 'ใช้ report เป็นข้อมูลประกอบ weekly review',
      pending ? 'ผูก execution record กับ decisionId เพื่อเริ่มเรียนรู้ outcome จริง' : 'ตรวจ outcome ที่ execute แล้วเทียบ 24h/48h/7d',
      'ห้ามเพิ่มสิทธิ์ auto execution จาก learning เพียงรอบเดียว',
    ],
  }
}

function buildPhase4MemoryWrites({
  learnings,
  now,
  outcomes,
  report,
}: {
  learnings: OutcomeLearningRecord[]
  now: string
  outcomes: OutcomeObservation[]
  report: Phase4Report
}): KnowledgeMemory[] {
  return learnings.slice(0, 4).map((learning) => ({
    id: `phase4-memory-${learning.id}`,
    type: 'system' as const,
    title: learning.title,
    summary: learning.summary,
    evidence: learning.supportingOutcomeIds.slice(0, 6).map((outcomeId) => ({
      source: 'execution_result' as const,
      sourceId: outcomeId,
      observedAt: now,
      value: outcomes.find((outcome) => outcome.id === outcomeId)?.summary ?? report.summary,
    })),
    entities: [{ kind: 'service' as const, name: 'PMC Ads Agent Phase 4' }],
    metrics: {
      spend: report.metrics.spend,
      revenue: report.metrics.revenue,
      roas: report.metrics.roas,
      cpa: report.metrics.cpa,
      ctr: report.metrics.ctr,
      conversions: report.metrics.conversions,
    },
    recommendation: learning.recommendation,
    outcome: learning.pattern,
    confidence: learning.confidence,
    tags: learning.tags,
    createdAt: now,
    updatedAt: now,
  })).slice(0, 4)
}

function buildPhase4AgentReports({
  alerts,
  learnings,
  outcomes,
  report,
}: {
  alerts: MonitoringAlert[]
  learnings: OutcomeLearningRecord[]
  outcomes: OutcomeObservation[]
  report: Phase4Report
}): AiPhase4Response['agents'] {
  const criticalAlerts = alerts.filter((alert) => alert.severity === 'critical')
  const declined = outcomes.filter((outcome) => outcome.status === 'declined')
  const pending = outcomes.filter((outcome) => outcome.status === 'pending')
  return [
    {
      agentName: 'Outcome Observer Agent',
      status: outcomes.length ? 'done' : 'needs_review',
      priority: declined.length ? 'High' : pending.length ? 'Medium' : 'Low',
      summary: `ตรวจ outcome observations ${outcomes.length} รายการ`,
      evidence: outcomes.slice(0, 4).map((outcome) => `${outcome.target.name}: ${outcome.status}`),
      nextStep: pending.length ? 'รอ execution records เพื่อเรียนรู้ผลจริง' : 'ติดตาม 24h/48h/7d ต่อ',
      confidence: outcomes.length ? 76 : 50,
      blockers: outcomes.length ? [] : ['ยังไม่มี decisions ให้ observe'],
    },
    {
      agentName: 'Outcome Learning Agent',
      status: learnings.length ? 'done' : 'needs_review',
      priority: declined.length ? 'High' : 'Medium',
      summary: `สร้าง learning records ใหม่ ${learnings.length} รายการ`,
      evidence: learnings.slice(0, 4).map((learning) => learning.summary),
      nextStep: 'ใช้ learning เพื่อเพิ่ม/ลด confidence ของ recommendation รอบถัดไปเท่านั้น',
      confidence: learnings.length ? 78 : 52,
      blockers: learnings.length ? [] : ['ยังไม่มี outcome ที่ชัดพอสำหรับ learning ใหม่'],
    },
    {
      agentName: 'Monitoring Agent',
      status: criticalAlerts.length ? 'needs_review' : 'done',
      priority: criticalAlerts.length ? 'High' : alerts.length ? 'Medium' : 'Low',
      summary: `พบ monitoring alerts เปิดอยู่ ${alerts.length} รายการ`,
      evidence: alerts.slice(0, 4).map((alert) => `${alert.severity}: ${alert.title}`),
      nextStep: criticalAlerts.length ? 'แก้ critical alert ก่อนตัดสินใจจากข้อมูล' : 'ติดตาม alert ใน daily review',
      confidence: 84,
      blockers: criticalAlerts.map((alert) => alert.title),
    },
    {
      agentName: 'Daily Report Agent',
      status: 'done',
      priority: report.outcomeStatus === 'blocked' ? 'High' : 'Medium',
      summary: report.summary,
      evidence: report.keyFindings,
      nextStep: report.nextActions[0] ?? 'ใช้รายงานนี้ในรอบรีวิว',
      confidence: 82,
      blockers: [],
    },
  ]
}

function formatSigned(value: number | undefined) {
  const number = round2(value ?? 0)
  return `${number >= 0 ? '+' : ''}${number}`
}

function canFallbackAiBrainModel(error: unknown) {
  return error instanceof AiApiError && (error.status === 429 || error.status >= 500)
}

function buildFallbackAiBrainModelResult({
  reason,
  metricPack,
  workspace,
}: {
  reason: string
  metricPack: DeterministicMetricPack
  workspace: ReturnType<typeof normalizeWorkspacePayload>
}): AiBrainModelResult {
  const wasteCampaign = workspace.campaigns
    .slice()
    .sort((a, b) => b.spend - a.spend)
    .find((campaign) => campaign.spend > 0 && (campaign.roas < 1 || campaign.conversions === 0))
  const winnerCampaign = workspace.campaigns
    .slice()
    .sort((a, b) => b.roas - a.roas || b.conversions - a.conversions || b.revenue - a.revenue)
    .find((campaign) => campaign.spend > 0 && (campaign.roas >= 1.3 || campaign.conversions > 0))
  const weakAdSet = workspace.adSets
    .slice()
    .sort((a, b) => b.spend - a.spend)
    .find((adSet) => adSet.spend > 0 && (adSet.roas < 1 || adSet.bookings === 0))
  const topAd = workspace.adInsights
    .slice()
    .sort((a, b) => b.score - a.score || b.roas - a.roas || b.bookings - a.bookings || b.spend - a.spend)[0]

  const fallbackTarget = winnerCampaign ?? wasteCampaign ?? workspace.campaigns[0]
  const findings: AiBrainModelFinding[] = []

  if (metricPack.account.activeCampaigns === 0) {
    findings.push({
      title: 'ยังไม่มีแคมเปญที่เปิดใช้งานในข้อมูลรอบนี้',
      explanation: 'ควรเลือกทดสอบเฉพาะแคมเปญที่เคยมีผลงานดี ไม่ควรเปิดทุกแคมเปญพร้อมกัน',
      evidence: [`แคมเปญที่เปิดใช้งาน ${metricPack.account.activeCampaigns} จากทั้งหมด ${metricPack.account.campaigns}`],
      confidence: 96,
      risk: 'Medium',
    })
  }

  if (wasteCampaign) {
    findings.push({
      title: 'พบแคมเปญใช้งบสูงแต่ ROAS ต่ำกว่าเกณฑ์',
      explanation: 'ควรตรวจสาเหตุก่อนอนุมัติเปิดหรือเพิ่มงบ เพราะมีค่าใช้จ่ายจริงแต่ผลตอบแทนต่ำ',
      evidence: [
        `${wasteCampaign.name}: ใช้จ่าย ${formatMoney(wasteCampaign.spend)}, รายได้ ${formatMoney(wasteCampaign.revenue)}, ROAS ${wasteCampaign.roas.toFixed(2)}x`,
      ],
      confidence: 88,
      risk: 'High',
    })
  }

  const recommendations: AiBrainModelRecommendation[] = []
  if (winnerCampaign) {
    recommendations.push({
      type: 'Controlled relaunch candidate',
      targetId: winnerCampaign.id,
      targetName: winnerCampaign.name,
      action: 'ขออนุมัติทดสอบเปิดแคมเปญแบบค่อยเป็นค่อยไปจากแคมเปญที่เคยมี ROAS หรือ conversion เป็นบวก โดยเริ่มจากงบจำกัดและติดตามผลรายวัน',
      expectedImpact: 'ใช้ historical winner เป็นฐานทดสอบแทนการเปิดทุก campaign พร้อมกัน',
      guardrail: 'ต้องตรวจครีเอทีฟและ compliance ก่อน และหยุดถ้า CPA หรือ ROAS แย่กว่าเกณฑ์เดิมในช่วงติดตามผล',
      rollbackNote: 'หากผลแย่ลงให้ pause กลับและบันทึก outcome ใน knowledgebase',
      risk: 'Medium',
      confidence: 78,
      evidence: [`${winnerCampaign.name}: ROAS ${winnerCampaign.roas.toFixed(2)}x, conversions ${winnerCampaign.conversions}`],
    })
  }

  if (wasteCampaign) {
    recommendations.push({
      type: 'Budget protection diagnosis',
      targetId: wasteCampaign.id,
      targetName: wasteCampaign.name,
      action: 'ขออนุมัติคงสถานะพักไว้และตรวจสาเหตุก่อนเปิดกลับ: ดูครีเอทีฟล้า, กลุ่มเป้าหมายซ้ำ, ข้อเสนอ, tracking และจุดรั่วใน funnel',
      expectedImpact: 'ลดความเสี่ยงเปิด campaign ที่ใช้ spend สูงแต่ ROAS ต่ำกว่า 1',
      guardrail: 'ห้ามเปิดหรือเพิ่มงบจนกว่าจะมีบันทึกการตรวจสาเหตุและเลขอ้างอิงการอนุมัติ',
      rollbackNote: 'หากมีการเปิดภายหลังและ performance แย่ ให้ pause กลับตาม snapshot เดิม',
      risk: 'High',
      confidence: 84,
      evidence: [`${wasteCampaign.name}: spend ${formatMoney(wasteCampaign.spend)}, ROAS ${wasteCampaign.roas.toFixed(2)}x`],
    })
  }

  if (weakAdSet) {
    recommendations.push({
      type: 'Ad set review',
      targetId: weakAdSet.id,
      targetName: weakAdSet.name,
      action: 'ขออนุมัติรีวิวกลุ่มเป้าหมายและงบของชุดโฆษณาที่ใช้เงินแล้ว booking หรือ ROAS ต่ำ ก่อนนำกลับไปทดสอบอีกครั้ง',
      expectedImpact: 'ลดการโยกงบเข้า audience ที่ยังไม่มี evidence ชัด',
      guardrail: 'ต้องเทียบกับ ad set ที่มี booking หรือ ROAS ดีกว่าในช่วงเวลาเดียวกัน',
      rollbackNote: 'ถ้าทดสอบแล้วไม่ดีขึ้น ให้ exclude หรือพัก audience นี้ในรอบถัดไป',
      risk: 'Medium',
      confidence: 72,
      evidence: [`${weakAdSet.name}: spend ${formatMoney(weakAdSet.spend)}, bookings ${weakAdSet.bookings}, ROAS ${weakAdSet.roas.toFixed(2)}x`],
    })
  }

  if (topAd) {
    recommendations.push({
      type: 'Creative refresh brief',
      targetId: topAd.id,
      targetName: topAd.name,
      action: 'ขออนุมัติใช้โฆษณาที่มีคะแนนหรือ booking ดีกว่าเป็นตัวอย่าง แล้วทำข้อความโฆษณาใหม่ที่ผ่าน compliance',
      expectedImpact: 'ใช้สัญญาณจาก ad-level metrics เพื่อสร้าง creative ใหม่โดยไม่ใช้ claim เสี่ยง',
      guardrail: 'ห้ามใช้ claim รับประกันผลลัพธ์, หายขาด, ก่อน-หลัง หรือคำเกินจริง',
      rollbackNote: 'หาก creative ใหม่ CTR/booking ต่ำกว่า reference ให้หยุดและกลับไปใช้ angle เดิม',
      risk: hasMedicalComplianceRisk(`${topAd.name} ${topAd.creative}`) ? 'High' : 'Low',
      confidence: 74,
      evidence: [`${topAd.name}: score ${topAd.score}, ROAS ${topAd.roas.toFixed(2)}x, bookings ${topAd.bookings}`],
    })
  }

  if (!recommendations.length && fallbackTarget) {
    recommendations.push({
      type: 'Manual review',
      targetId: fallbackTarget.id,
      targetName: fallbackTarget.name,
      action: 'ขออนุมัติให้คนรีวิวก่อนดำเนินการ เพราะระบบยังไม่พบสัญญาณชัดว่าควรเพิ่มงบหรือหยุดรายการใด',
      expectedImpact: 'ป้องกัน AI เสนอ action จากข้อมูลที่ไม่พอ',
      guardrail: 'ต้อง sync ข้อมูลเพิ่มก่อนอนุมัติ execution ใด ๆ',
      rollbackNote: 'ยังไม่มี execution จึงไม่ต้อง rollback',
      risk: 'Medium',
      confidence: 55,
      evidence: [`workspace campaigns=${metricPack.account.campaigns}, ads=${metricPack.account.ads}`],
    })
  }

  return {
    summary: `ระบบวิเคราะห์จากข้อมูล Meta จริงแล้ว: ใช้จ่าย ${formatMoney(metricPack.account.spend)}, ROAS ${metricPack.account.roas.toFixed(2)}x, CPA ${formatMoney(metricPack.account.cpa)}`,
    masterDecision: 'ใช้โหมดสำรองเพื่อสร้างแผนรีวิวจากข้อมูลจริง โดยทุก action ยังต้องรอผู้ใช้อนุมัติและยังไม่ดำเนินการอัตโนมัติ',
    modelNotes: ['AI หลักตอบกลับไม่สมบูรณ์ ระบบใช้โหมดวิเคราะห์สำรองจากข้อมูลจริงแทน', trimMiddle(reason, 160)],
    findings: findings.slice(0, 8),
    recommendations: recommendations.slice(0, 6),
    memoryWrites: [{
      type: 'system',
      title: 'AI Brain ใช้โหมดวิเคราะห์สำรอง',
      summary: `ระบบสร้างแผนที่ต้องอนุมัติ ${recommendations.length} รายการจากข้อมูล Meta จริง`,
      evidence: findings.flatMap((finding) => finding.evidence).slice(0, 6),
      entities: fallbackTarget ? [fallbackTarget.name] : ['Meta account'],
      metrics: [
        { key: 'spend', value: metricPack.account.spend },
        { key: 'revenue', value: metricPack.account.revenue },
        { key: 'roas', value: metricPack.account.roas },
        { key: 'cpa', value: metricPack.account.cpa },
        { key: 'ctr', value: metricPack.account.ctr },
        { key: 'conversions', value: metricPack.account.conversions },
      ],
      recommendation: recommendations[0]?.action ?? 'Manual review before action',
      outcome: 'fallback_used',
      confidence: 82,
      tags: ['ai-brain', 'phase-3', 'fallback'],
    }],
    agentResults: [{
      agentName: 'Backup Analysis Agent',
      status: 'needs_review',
      summary: 'สร้างสรุปและแผนที่ต้องอนุมัติจากข้อมูลจริงเมื่อ AI หลักตอบกลับไม่สมบูรณ์',
      evidence: findings.flatMap((finding) => finding.evidence).slice(0, 6),
      outputSummary: `recommendations=${recommendations.length}`,
      blockers: ['ควรรีวิวผลวิเคราะห์ก่อนใช้เป็นแผนสุดท้าย'],
    }],
  }
}

type AiBrainSpecialistReport = NonNullable<AiBrainResponse['specialistOutputs']['campaignAnalyst']>

function buildAiBrainSpecialistOutputs(
  recommendations: AiBrainRecommendation[],
  metricPack: DeterministicMetricPack,
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
): AiBrainResponse['specialistOutputs'] {
  const wasteCampaigns = workspace.campaigns
    .filter((campaign) => campaign.spend > 0 && (campaign.roas < 1 || campaign.conversions === 0))
    .sort((a, b) => b.spend - a.spend)
  const winnerCampaigns = workspace.campaigns
    .filter((campaign) => campaign.spend > 0 && (campaign.roas >= 1.5 || campaign.conversions > 0))
    .sort((a, b) => b.roas - a.roas || b.conversions - a.conversions)
  const weakAdSets = workspace.adSets
    .filter((adSet) => adSet.spend > 0 && (adSet.roas < 1 || adSet.bookings === 0))
    .sort((a, b) => b.spend - a.spend)
  const topAds = workspace.adInsights
    .filter((ad) => ad.spend > 0 || ad.impressions > 0)
    .sort((a, b) => b.score - a.score || b.roas - a.roas || b.bookings - a.bookings)
  const weakAds = workspace.adInsights
    .filter((ad) => ad.spend > 0 && (ad.roas < 1 || ad.bookings === 0 || ad.score < 6))
    .sort((a, b) => b.spend - a.spend)
  const riskyAds = workspace.adInsights.filter((ad) => hasMedicalComplianceRisk(`${ad.name} ${ad.creative}`))
  const activeRecommendations = recommendations.filter((recommendation) => recommendation.requiresApproval)

  return {
    campaignAnalyst: {
      agentName: 'Campaign Analyst Agent',
      status: workspace.campaigns.length ? 'done' : 'blocked',
      priority: wasteCampaigns.length ? 'Medium' : 'Low',
      summary: wasteCampaigns.length
        ? `พบ ${wasteCampaigns.length} campaigns ที่ต้องรีวิว spend/ROAS ก่อนขยับงบ`
        : `อ่าน ${workspace.campaigns.length} campaigns แล้ว ยังไม่พบ waste signal หนักจาก metric จริง`,
      evidence: [
        `Account spend ${formatMoney(metricPack.account.spend)} · ROAS ${metricPack.account.roas.toFixed(2)}x · CPA ${formatMoney(metricPack.account.cpa)}`,
        ...metricPack.topCampaigns.slice(0, 3).map((campaign) => `${campaign.name}: spend ${formatMoney(campaign.spend)}, ROAS ${campaign.roas.toFixed(2)}x, conversions ${campaign.conversions}`),
      ].slice(0, 6),
      nextStep: winnerCampaigns.length
        ? `ใช้ ${winnerCampaigns[0].name} เป็น benchmark ก่อนอนุมัติ action`
        : 'รอ campaign ที่มี conversion/ROAS เพียงพอก่อน scale',
      confidence: workspace.campaigns.length ? 82 : 45,
      blockers: workspace.campaigns.length ? [] : ['ยังไม่มี campaign ใน workspace'],
    },
    adSetAnalyst: {
      agentName: 'Ad Set Analyst Agent',
      status: workspace.adSets.length ? 'done' : 'blocked',
      priority: weakAdSets.length ? 'Medium' : 'Low',
      summary: weakAdSets.length
        ? `พบ ${weakAdSets.length} ad sets ที่ใช้เงินแล้ว booking/ROAS ยังต่ำ`
        : `อ่าน ${workspace.adSets.length} ad sets แล้ว ยังไม่พบ ad set ที่ควร block ทันที`,
      evidence: weakAdSets.slice(0, 4).map((adSet) => `${adSet.name}: spend ${formatMoney(adSet.spend)}, bookings ${adSet.bookings}, ROAS ${adSet.roas.toFixed(2)}x`),
      nextStep: weakAdSets[0] ? `ตรวจ targeting และ budget ของ ${weakAdSets[0].name}` : 'ใช้ ad set ที่มี booking เป็น baseline สำหรับ audience ถัดไป',
      confidence: workspace.adSets.length ? 76 : 42,
      blockers: workspace.adSets.length ? [] : ['ยังไม่มี ad set insight'],
    },
    adAnalyst: {
      agentName: 'Ad Analyst Agent',
      status: workspace.adInsights.length ? 'done' : 'blocked',
      priority: weakAds.length ? 'Medium' : 'Low',
      summary: weakAds.length
        ? `พบ ${weakAds.length} ads ที่ควรรีวิว creative/landing flow`
        : `อ่าน ${workspace.adInsights.length} ads แล้ว มีสัญญาณพอสำหรับจัดอันดับ creative`,
      evidence: topAds.slice(0, 4).map((ad) => `${ad.name}: score ${ad.score}, CTR ${ad.ctr.toFixed(2)}%, ROAS ${ad.roas.toFixed(2)}x, bookings ${ad.bookings}`),
      nextStep: weakAds[0] ? `เทียบ ${weakAds[0].name} กับ creative winner ก่อนตัดสินใจพัก` : 'เก็บ winning ads เป็น reference ใน creative brief',
      confidence: workspace.adInsights.length ? 78 : 40,
      blockers: workspace.adInsights.length ? [] : ['ยังไม่มี ad insight'],
    },
    budgetOptimization: {
      agentName: 'Budget Optimization Agent',
      status: metricPack.account.spend > 0 ? 'needs_review' : 'blocked',
      priority: wasteCampaigns.length || weakAdSets.length ? 'High' : 'Medium',
      summary: wasteCampaigns.length || weakAdSets.length
        ? 'มี budget movement ที่ควรเข้า approval queue ก่อนปรับจริง'
        : 'ยังไม่เสนอโยกงบจริงจนกว่าจะมี winner/waste signal ชัดกว่าเดิม',
      evidence: [
        ...wasteCampaigns.slice(0, 3).map((campaign) => `${campaign.name}: spend ${formatMoney(campaign.spend)}, ROAS ${campaign.roas.toFixed(2)}x`),
        ...weakAdSets.slice(0, 3).map((adSet) => `${adSet.name}: spend ${formatMoney(adSet.spend)}, bookings ${adSet.bookings}`),
      ].slice(0, 6),
      nextStep: 'แปลง budget move เป็น approval card พร้อม guardrail รายวัน',
      confidence: metricPack.account.spend > 0 ? 74 : 38,
      blockers: metricPack.account.spend > 0 ? [] : ['ยังไม่มี spend สำหรับคำนวณ budget move'],
    },
    funnelDiagnosis: {
      agentName: 'Funnel Diagnosis Agent',
      status: workspace.funnelMetrics.length || workspace.channelPerformance.length ? 'done' : 'needs_review',
      priority: metricPack.account.cpa > 0 && metricPack.account.roas < 1 ? 'High' : 'Medium',
      summary: 'เชื่อม spend, click, lead, booking และ revenue เพื่อหาจุดรั่วก่อนอนุมัติ action',
      evidence: [
        ...workspace.funnelMetrics.slice(0, 4).map((metric) => `${metric.stage}: count ${metric.count}, conversion ${metric.conversionRate}%`),
        ...workspace.channelPerformance.slice(0, 2).map((channel) => `${channel.channel}: leads ${channel.leads}, bookings ${channel.bookings}, revenue ${formatMoney(channel.revenue)}`),
      ].slice(0, 6),
      nextStep: 'ถ้า ROAS ต่ำ ให้ตรวจ booking/show-up ก่อนเพิ่มงบ',
      confidence: workspace.funnelMetrics.length || workspace.channelPerformance.length ? 72 : 50,
      blockers: workspace.funnelMetrics.length || workspace.channelPerformance.length ? [] : ['ยังไม่มี funnel/channel metrics เพียงพอ'],
    },
    creativeStrategist: {
      agentName: 'Creative Strategist Agent',
      status: topAds.length ? 'done' : 'needs_review',
      priority: riskyAds.length ? 'High' : weakAds.length ? 'Medium' : 'Low',
      summary: topAds[0]
        ? `ใช้ ${topAds[0].name} เป็น creative reference และรีเฟรช ads ที่ score ต่ำ`
        : 'ยังไม่มี creative winner ที่มี metric พอ',
      evidence: topAds.slice(0, 4).map((ad) => `${ad.name}: creative "${trimMiddle(ad.creative, 90)}", score ${ad.score}, bookings ${ad.bookings}`),
      nextStep: 'สร้าง brief ใหม่โดยยึด hook/offer จาก winner และเลี่ยง claim เสี่ยง',
      confidence: topAds.length ? 77 : 44,
      blockers: topAds.length ? [] : ['ยังไม่มี ad creative ที่มี insight'],
    },
    audienceSegment: {
      agentName: 'Audience Segment Agent',
      status: workspace.adSets.length ? 'needs_review' : 'blocked',
      priority: weakAdSets.length ? 'Medium' : 'Low',
      summary: 'อ่าน audience จาก ad set เพื่อเตรียมแยก segment ที่ควร scale, hold หรือ exclude',
      evidence: workspace.adSets.slice(0, 4).map((adSet) => `${adSet.name}: audience ${trimMiddle(adSet.audience, 90)}, ROAS ${adSet.roas.toFixed(2)}x`),
      nextStep: 'ให้ Master ขอข้อมูล demographic/placement เพิ่มก่อนปรับ targeting จริง',
      confidence: workspace.adSets.length ? 68 : 36,
      blockers: workspace.adSets.length ? [] : ['ยังไม่มี audience/ad set data'],
    },
    medicalCompliance: {
      agentName: 'Medical Ads Compliance Agent',
      status: riskyAds.length ? 'needs_review' : 'done',
      priority: riskyAds.length ? 'High' : 'Low',
      summary: riskyAds.length
        ? `พบ ${riskyAds.length} creatives ที่มีคำ/claim เสี่ยง ต้อง rewrite ก่อนใช้`
        : 'ยังไม่พบคำโฆษณาที่เข้าข่าย guarantee/cure/before-after จากข้อมูล creative ที่ส่งมา',
      evidence: riskyAds.slice(0, 5).map((ad) => `${ad.name}: "${trimMiddle(ad.creative || ad.name, 100)}"`),
      nextStep: riskyAds.length ? 'ส่งต่อ Creative Strategist เพื่อ rewrite แบบไม่รับประกันผลลัพธ์' : 'ให้ compliance ตรวจรอบสุดท้ายก่อน launch creative ใหม่',
      confidence: workspace.adInsights.length ? 80 : 45,
      blockers: [],
    },
    approvalGatekeeper: {
      agentName: 'Approval Gatekeeper Agent',
      status: 'done',
      priority: activeRecommendations.some((recommendation) => recommendation.risk === 'High') ? 'High' : 'Medium',
      summary: `แปลง ${activeRecommendations.length} recommendations เป็น approval-only cards และปิด direct execution`,
      evidence: [
        'directExecutionAllowed=false',
        'allBrainApprovalCards.execution=undefined',
        ...activeRecommendations.slice(0, 4).map((recommendation) => `${recommendation.targetName}: ${recommendation.action}`),
      ].slice(0, 6),
      nextStep: 'ให้ผู้ใช้รีวิว/อนุมัติเป็นแผนก่อนต่อ execution layer จริงในอนาคต',
      confidence: 100,
      blockers: [],
    },
    actionBuilder: {
      agentName: 'Action Builder Agent',
      status: activeRecommendations.length ? 'done' : 'needs_review',
      priority: activeRecommendations.length ? 'Medium' : 'Low',
      summary: activeRecommendations.length
        ? 'สร้าง action cards ที่มี before/after/evidence/guardrail/rollback ครบสำหรับ review'
        : 'ยังไม่มี recommendation ที่แปลงเป็น action card ได้',
      evidence: activeRecommendations.slice(0, 5).map((recommendation) => `${recommendation.type}: ${recommendation.targetName}`),
      nextStep: 'คงสถานะเป็น review-only จนกว่าจะมี approval id และ execution policy',
      confidence: activeRecommendations.length ? 86 : 55,
      blockers: activeRecommendations.length ? [] : ['โมเดลยังไม่ส่ง recommendation ที่ actionable'],
    },
  }
}

function specialistReportsToAgentResults(
  specialistOutputs: AiBrainResponse['specialistOutputs'],
  approvalActions: RecommendedAction[],
  taskId: string,
): AgentTaskResult[] {
  return Object.entries(specialistOutputs)
    .filter((entry): entry is [string, AiBrainSpecialistReport] => Boolean(entry[1]))
    .map(([key, report]) => ({
    taskId,
    agentName: report.agentName,
    status: report.status,
    summary: report.summary,
    evidence: report.evidence,
    output: {
      specialistKey: key,
      priority: report.priority,
      nextStep: report.nextStep,
      confidence: report.confidence,
      approvalActionCount: report.agentName === 'Approval Gatekeeper Agent' ? approvalActions.length : undefined,
    },
    proposedActions: report.agentName === 'Approval Gatekeeper Agent'
      ? approvalActions.map((action) => ({
        actionType: action.type,
        targetId: action.campaignId,
        risk: action.risk,
        requiresApproval: true,
      }))
      : [],
    memoryWrites: [],
    blockers: report.blockers,
  }))
}

function buildApprovalActionsFromRecommendations(
  recommendations: AiBrainRecommendation[],
  taskId: string,
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
): RecommendedAction[] {
  return recommendations.map((recommendation, index) => {
    const target = resolveWorkspaceTarget(workspace, recommendation.targetId, recommendation.targetName)
    const before = beforeSnapshotForTarget(workspace, target.objectId)
    return {
      id: `${taskId}-approval-${index + 1}`,
      campaignId: campaignIdForDecisionTarget(workspace, target),
      type: `AI Brain · ${recommendation.type}`,
      target: target.name,
      summary: recommendation.action,
      expectedImpact: recommendation.expectedImpact,
      guardrail: recommendation.guardrail,
      before: summarizeBeforeSnapshot(before),
      after: recommendation.action,
      rollbackNote: recommendation.rollbackNote,
      risk: recommendation.risk,
      confidence: recommendation.confidence,
      status: 'pending' as const,
      source: 'ai_brain' as const,
      sourceDecisionId: `${taskId}-decision-${index + 1}`,
      requiresApproval: true,
      execution: undefined,
    }
  }).slice(0, 6)
}

function buildKnowledgeCaptureMemory({
  note,
  source,
  targetId,
  targetName,
  workspace,
}: {
  note: string
  source: string
  targetId: string
  targetName: string
  workspace: ReturnType<typeof normalizeWorkspacePayload>
}): KnowledgeMemory {
  const now = new Date().toISOString()
  const target = resolveWorkspaceTarget(workspace, targetId, targetName)
  const snapshot = target.objectType === 'account' ? buildDeterministicMetricPack(workspace).account : beforeSnapshotForTarget(workspace, target.objectId)
  const memoryType: KnowledgeMemory['type'] =
    target.objectType === 'ad'
      ? 'creative'
      : target.objectType === 'adset'
        ? 'audience'
        : target.objectType === 'campaign'
          ? 'campaign'
          : 'system'

  return {
    id: `knowledge-capture-${Date.now()}-${slugify(target.objectId || target.name, 'target')}`,
    type: memoryType,
    title: `Knowledge capture: ${target.name}`,
    summary: note || `บันทึกข้อมูล ${target.name} จาก ${source} เพื่อใช้วิเคราะห์ย้อนหลัง`,
    evidence: [{
      source: 'website_ui',
      sourceId: target.objectId,
      observedAt: now,
      value: humanSnapshotSummary(snapshot),
    }],
    entities: [{
      kind: target.objectType === 'account' ? 'service' : target.objectType,
      ...(target.objectType === 'account' ? {} : { id: target.objectId }),
      name: target.name,
    }],
    metrics: metricsFromSnapshot(snapshot),
    recommendation: note || undefined,
    confidence: 82,
    tags: ['knowledge-capture', 'pmc-master-agent', 'phase-4', target.objectType],
    createdAt: now,
    updatedAt: now,
  }
}

function humanSnapshotSummary(snapshot: Record<string, unknown>) {
  const labels: Record<string, string> = {
    bookings: 'Bookings',
    clicks: 'Clicks',
    conversions: 'Conversions',
    cpa: 'CPA',
    cpc: 'CPC',
    ctr: 'CTR',
    deliveryStatus: 'Delivery',
    impressions: 'Impressions',
    revenue: 'Revenue',
    roas: 'ROAS',
    spend: 'Spend',
    status: 'Status',
  }
  const entries = Object.entries(snapshot).slice(0, 8)
  if (!entries.length) return 'ยังไม่มี snapshot metric ของ target นี้'
  return entries.map(([key, value]) => `${labels[key] ?? key}: ${formatSnapshotValue(value)}`).join(' · ')
}

function metricsFromSnapshot(snapshot: Record<string, unknown>): KnowledgeMemory['metrics'] | undefined {
  const metrics: NonNullable<KnowledgeMemory['metrics']> = {}
  if ('spend' in snapshot) metrics.spend = round2(numberOf(snapshot.spend))
  if ('revenue' in snapshot) metrics.revenue = round2(numberOf(snapshot.revenue))
  if ('roas' in snapshot) metrics.roas = round2(numberOf(snapshot.roas))
  if ('cpa' in snapshot) metrics.cpa = round2(numberOf(snapshot.cpa))
  if ('ctr' in snapshot) metrics.ctr = round2(numberOf(snapshot.ctr))
  if ('conversions' in snapshot || 'bookings' in snapshot) metrics.conversions = round2(numberOf(snapshot.conversions ?? snapshot.bookings))
  return Object.keys(metrics).length ? metrics : undefined
}

function campaignIdForDecisionTarget(
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
  target: DecisionRecord['target'],
): string {
  if (target.objectType === 'campaign') return target.objectId
  if (target.objectType === 'adset') {
    return workspace.adSets.find((adSet) => adSet.id === target.objectId)?.campaignId ?? workspace.campaigns[0]?.id ?? target.objectId
  }
  if (target.objectType === 'ad') {
    return workspace.adInsights.find((ad) => ad.id === target.objectId)?.campaignId ?? workspace.campaigns[0]?.id ?? target.objectId
  }
  return workspace.campaigns[0]?.id ?? target.objectId
}

function summarizeBeforeSnapshot(snapshot: Record<string, unknown>): string {
  const entries = Object.entries(snapshot).slice(0, 6)
  if (!entries.length) return 'ไม่มี snapshot ก่อนดำเนินการ'
  return entries.map(([key, value]) => `${key}: ${formatSnapshotValue(value)}`).join(' · ')
}

function formatSnapshotValue(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(round2(value)) : '0'
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(value) ?? String(value)
}

function hasMedicalComplianceRisk(text: string): boolean {
  return /(รับประกัน|หายขาด|รักษาหาย|100%|เห็นผลทันที|หน้าเด็ก|ก่อนหลัง|before|after|ไม่เจ็บ|ปลอดภัยแน่นอน|ดีที่สุด)/i.test(text)
}

function trimMiddle(text: string, maxLength: number): string {
  const value = cleanText(text, '')
  if (value.length <= maxLength) return value
  const head = value.slice(0, Math.max(0, maxLength - 3))
  return `${head}...`
}

function normalizeBrainMemoryWrites(
  input: unknown,
  taskId: string,
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
): KnowledgeMemory[] {
  const now = new Date().toISOString()
  return pickArray(input, (item, index): KnowledgeMemory | null => {
    const record = sanitizeUnknownRecord(item)
    const title = cleanText(record.title, '')
    const summary = cleanText(record.summary, '')
    if (!title && !summary) return null
    return {
      id: `${taskId}-memory-${index + 1}`,
      type: normalizeMemoryType(record.type),
      title: title || `AI Brain memory ${index + 1}`,
      summary: summary || title,
      evidence: cleanStringList(record.evidence, 6).map((value) => ({
        source: 'ai_analysis' as const,
        sourceId: taskId,
        observedAt: now,
        value,
      })),
      entities: normalizeBrainMemoryEntities(record.entities, workspace),
      metrics: metricsArrayToRecord(record.metrics),
      ...(cleanText(record.recommendation, '') ? { recommendation: cleanText(record.recommendation, '') } : {}),
      ...(cleanText(record.outcome, '') ? { outcome: cleanText(record.outcome, '') } : {}),
      confidence: clamp(Math.round(numberOf(record.confidence)), 0, 100),
      tags: cleanStringList(record.tags, 12),
      createdAt: now,
      updatedAt: now,
    }
  }).slice(0, 8)
}

function buildFallbackBrainMemory(
  input: AiBrainModelResult,
  recommendations: AiBrainRecommendation[],
  taskId: string,
  metricPack: DeterministicMetricPack,
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
): KnowledgeMemory {
  const now = new Date().toISOString()
  const topTarget = recommendations[0]
    ? resolveWorkspaceTarget(workspace, recommendations[0].targetId, recommendations[0].targetName)
    : resolveWorkspaceTarget(workspace, workspace.campaigns[0]?.id ?? '', workspace.campaigns[0]?.name ?? '')
  const summary = cleanText(input.summary, 'PMC Master Agent analysis completed')

  return {
    id: `${taskId}-memory-summary`,
    type: topTarget.objectType === 'ad' ? 'creative' : topTarget.objectType === 'adset' ? 'audience' : topTarget.objectType === 'campaign' ? 'campaign' : 'system',
    title: `Master Agent summary: ${topTarget.name}`,
    summary,
    evidence: [
      {
        source: 'ai_analysis',
        sourceId: taskId,
        observedAt: now,
        value: recommendations[0]?.evidence[0] ?? `Spend ${formatMoney(metricPack.account.spend)} · ROAS ${metricPack.account.roas.toFixed(2)}x`,
      },
    ],
    entities: [{
      kind: topTarget.objectType === 'account' ? 'service' : topTarget.objectType,
      ...(topTarget.objectType === 'account' ? {} : { id: topTarget.objectId }),
      name: topTarget.name,
    }],
    metrics: {
      spend: metricPack.account.spend,
      revenue: metricPack.account.revenue,
      roas: metricPack.account.roas,
      cpa: metricPack.account.cpa,
      ctr: metricPack.account.ctr,
      conversions: metricPack.account.conversions,
    },
    ...(recommendations[0]?.action ? { recommendation: recommendations[0].action } : {}),
    confidence: recommendations[0]?.confidence ?? 70,
    tags: ['ai-brain', 'phase-3', topTarget.objectType],
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeBrainAgentResults(input: unknown, taskId: string): AgentTaskResult[] {
  return pickArray(input, (item): AgentTaskResult | null => {
    const record = sanitizeUnknownRecord(item)
    const agentName = cleanText(record.agentName, '')
    if (!agentName) return null
    const status = cleanText(record.status, 'done')
    const output = sanitizeUnknownRecord(record.output)
    const outputSummary = cleanText(record.outputSummary, '')
    return {
      taskId,
      agentName,
      status: ['done', 'blocked', 'needs_review'].includes(status) ? status as AgentTaskResult['status'] : 'needs_review',
      summary: cleanText(record.summary, `${agentName} completed analysis`),
      evidence: cleanStringList(record.evidence, 6),
      output: Object.keys(output).length ? { ...output, outputSummary } : { outputSummary },
      proposedActions: [],
      memoryWrites: [],
      blockers: cleanStringList(record.blockers, 6),
    }
  }).slice(0, 12)
}

function buildDecisionRecordsFromRecommendations(
  recommendations: AiBrainRecommendation[],
  taskId: string,
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
): DecisionRecord[] {
  const now = new Date().toISOString()
  return recommendations.map((recommendation, index) => {
    const target = resolveWorkspaceTarget(workspace, recommendation.targetId, recommendation.targetName)
    return {
      id: `${taskId}-decision-${index + 1}`,
      syncId: taskId,
      actor: 'ai',
      actionType: recommendation.type,
      target,
      before: beforeSnapshotForTarget(workspace, target.objectId),
      recommendedAfter: {
        action: recommendation.action,
        expectedImpact: recommendation.expectedImpact,
        executable: false,
      },
      evidence: recommendation.evidence,
      guardrail: recommendation.guardrail,
      risk: recommendation.risk,
      confidence: recommendation.confidence,
      status: 'suggested',
      createdAt: now,
    }
  })
}

function resolveWorkspaceTarget(
  workspace: ReturnType<typeof normalizeWorkspacePayload>,
  targetId: string,
  targetName: string,
): DecisionRecord['target'] {
  const campaign = workspace.campaigns.find((item) => item.id === targetId || item.name === targetName)
  if (campaign) return { objectType: 'campaign', objectId: campaign.id, name: campaign.name }
  const adSet = workspace.adSets.find((item) => item.id === targetId || item.name === targetName)
  if (adSet) return { objectType: 'adset', objectId: adSet.id, name: adSet.name }
  const ad = workspace.adInsights.find((item) => item.id === targetId || item.name === targetName)
  if (ad) return { objectType: 'ad', objectId: ad.id, name: ad.name }
  const fallback = workspace.campaigns[0]
  if (fallback) return { objectType: 'campaign', objectId: fallback.id, name: fallback.name }
  return { objectType: 'account', objectId: targetId || 'meta-account', name: targetName || 'Meta account' }
}

function beforeSnapshotForTarget(workspace: ReturnType<typeof normalizeWorkspacePayload>, targetId: string): Record<string, unknown> {
  const campaign = workspace.campaigns.find((item) => item.id === targetId)
  if (campaign) {
    return {
      deliveryStatus: campaign.deliveryStatus,
      spend: campaign.spend,
      revenue: campaign.revenue,
      roas: campaign.roas,
      cpa: campaign.cpa,
      ctr: campaign.ctr,
      conversions: campaign.conversions,
    }
  }

  const adSet = workspace.adSets.find((item) => item.id === targetId)
  if (adSet) {
    return {
      deliveryStatus: adSet.deliveryStatus,
      spend: adSet.spend,
      bookings: adSet.bookings,
      cpa: adSet.cpa,
      roas: adSet.roas,
    }
  }

  const ad = workspace.adInsights.find((item) => item.id === targetId)
  if (ad) {
    return {
      status: ad.status,
      spend: ad.spend,
      impressions: ad.impressions,
      clicks: ad.clicks,
      bookings: ad.bookings,
      ctr: ad.ctr,
      cpc: ad.cpc,
      roas: ad.roas,
    }
  }

  return {}
}

function normalizeMemoryEvidence(input: unknown, observedAt: string): KnowledgeMemory['evidence'] {
  return pickArray(input, (item): KnowledgeMemory['evidence'][number] | null => {
    if (typeof item === 'string') {
      const value = cleanText(item, '')
      return value ? { source: 'ai_analysis', observedAt, value } : null
    }
    const record = sanitizeUnknownRecord(item)
    const value = cleanText(record.value, '')
    if (!value) return null
    return {
      source: normalizeEvidenceSource(record.source),
      ...(cleanText(record.sourceId, '') ? { sourceId: cleanText(record.sourceId, '') } : {}),
      observedAt: cleanText(record.observedAt, observedAt),
      value,
    }
  }).slice(0, 8)
}

function normalizeMemoryEntities(input: unknown): KnowledgeMemory['entities'] {
  return pickArray(input, (item): KnowledgeMemory['entities'][number] | null => {
    const record = sanitizeUnknownRecord(item)
    const name = cleanText(record.name, '')
    if (!name) return null
    return {
      kind: normalizeEntityKind(record.kind),
      ...(cleanText(record.id, '') ? { id: cleanText(record.id, '') } : {}),
      name,
    }
  }).slice(0, 12)
}

function normalizeBrainMemoryEntities(input: unknown, workspace: ReturnType<typeof normalizeWorkspacePayload>): KnowledgeMemory['entities'] {
  const entities = cleanStringList(input, 8).map((name): KnowledgeMemory['entities'][number] => {
    const target = resolveWorkspaceTarget(workspace, '', name)
    return {
      kind: target.objectType === 'account' ? 'service' : target.objectType,
      ...(target.objectType === 'account' ? {} : { id: target.objectId }),
      name: target.name,
    }
  })
  return entities.length ? entities : workspace.campaigns.slice(0, 1).map((campaign) => ({ kind: 'campaign', id: campaign.id, name: campaign.name }))
}

function normalizeMemoryMetrics(input: unknown): KnowledgeMemory['metrics'] | undefined {
  const metrics = sanitizeUnknownRecord(input)
  const output = {
    spend: numberOrUndefined(metrics.spend),
    revenue: numberOrUndefined(metrics.revenue),
    roas: numberOrUndefined(metrics.roas),
    cpa: numberOrUndefined(metrics.cpa),
    ctr: numberOrUndefined(metrics.ctr),
    conversions: numberOrUndefined(metrics.conversions),
  }
  return Object.values(output).some((value) => value !== undefined) ? output : undefined
}

function metricsArrayToRecord(input: unknown): KnowledgeMemory['metrics'] | undefined {
  const output: NonNullable<KnowledgeMemory['metrics']> = {}
  for (const metric of Array.isArray(input) ? input : []) {
    const record = sanitizeUnknownRecord(metric)
    const key = cleanText(record.key, '') as keyof NonNullable<KnowledgeMemory['metrics']>
    if (!['spend', 'revenue', 'roas', 'cpa', 'ctr', 'conversions'].includes(key)) continue
    const value = numberOrUndefined(record.value)
    if (value !== undefined) output[key] = value
  }
  return Object.keys(output).length ? output : undefined
}

function normalizeMemoryType(input: unknown): KnowledgeMemory['type'] {
  const value = String(input || '').toLowerCase()
  if (['campaign', 'creative', 'audience', 'compliance', 'business', 'system'].includes(value)) {
    return value as KnowledgeMemory['type']
  }
  if (value === 'insight' || value === 'strategy' || value === 'preference') return 'business'
  return 'system'
}

function normalizeEvidenceSource(input: unknown): KnowledgeMemory['evidence'][number]['source'] {
  const value = String(input || '').toLowerCase()
  if (['meta_api', 'website_ui', 'user_input', 'ai_analysis', 'execution_result'].includes(value)) {
    return value as KnowledgeMemory['evidence'][number]['source']
  }
  return 'ai_analysis'
}

function normalizeEntityKind(input: unknown): KnowledgeMemory['entities'][number]['kind'] {
  const value = String(input || '').toLowerCase()
  if (['campaign', 'adset', 'ad', 'creative', 'service', 'audience'].includes(value)) {
    return value as KnowledgeMemory['entities'][number]['kind']
  }
  return 'service'
}

function normalizeDecisionActor(input: unknown): DecisionRecord['actor'] {
  return input === 'human' || input === 'system' || input === 'ai' ? input : 'ai'
}

function normalizeDecisionTargetType(input: unknown): DecisionRecord['target']['objectType'] {
  return input === 'campaign' || input === 'adset' || input === 'ad' || input === 'creative' || input === 'account' ? input : 'account'
}

function normalizeDecisionStatus(input: unknown): DecisionRecord['status'] {
  return input === 'approved' || input === 'executed' || input === 'rejected' || input === 'failed' || input === 'rolled_back' || input === 'suggested'
    ? input
    : 'suggested'
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

function numberOrUndefined(input: unknown) {
  const value = Number(input)
  return Number.isFinite(value) ? value : undefined
}

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0
}

function round2(value: number) {
  return Math.round(value * 100) / 100
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

const aiBrainSystemPrompt = [
  'You are PMC Master Agent, the master controller for a Thai clinic ads backend system.',
  'You coordinate specialist agents, but the final answer must be one coherent master decision.',
  'Use only the supplied WorkspaceData, deterministic metricPack, websiteContext, memories, and decisions.',
  'Never invent spend, revenue, ROAS, CPA, CTR, booking, purchase, age, location, or creative data.',
  'If data is missing, state the gap as a finding or blocker.',
  'Phase 3 policy: coordinate specialist agents, use website context and runtime knowledgebase, and convert recommendations into approval-only action cards.',
  'Direct execution is disabled even when the action looks safe.',
  'Every finding and recommendation must include evidence from supplied data.',
  'Every recommendation must include guardrail and rollback note.',
  'Medical/aesthetic clinic ads must avoid guaranteed results, unsafe before/after promises, cure claims, and exaggerated claims.',
  'Write concise Thai output with common Ads/AI terms in English where useful.',
].join('\n')

const aiBrainSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'masterDecision', 'modelNotes', 'findings', 'recommendations', 'memoryWrites', 'agentResults'],
  properties: {
    summary: { type: 'string' },
    masterDecision: { type: 'string' },
    modelNotes: { type: 'array', maxItems: 6, items: { type: 'string' } },
    findings: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'explanation', 'evidence', 'confidence', 'risk'],
        properties: {
          title: { type: 'string' },
          explanation: { type: 'string' },
          evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          risk: { type: 'string', enum: ['Low', 'Medium', 'High'] },
        },
      },
    },
    recommendations: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'targetId', 'targetName', 'action', 'expectedImpact', 'guardrail', 'rollbackNote', 'risk', 'confidence', 'evidence'],
        properties: {
          type: { type: 'string' },
          targetId: { type: 'string' },
          targetName: { type: 'string' },
          action: { type: 'string' },
          expectedImpact: { type: 'string' },
          guardrail: { type: 'string' },
          rollbackNote: { type: 'string' },
          risk: { type: 'string', enum: ['Low', 'Medium', 'High'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
        },
      },
    },
    memoryWrites: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'title', 'summary', 'evidence', 'entities', 'metrics', 'recommendation', 'outcome', 'confidence', 'tags'],
        properties: {
          type: { type: 'string', enum: ['campaign', 'creative', 'audience', 'compliance', 'business', 'system'] },
          title: { type: 'string' },
          summary: { type: 'string' },
          evidence: { type: 'array', maxItems: 6, items: { type: 'string' } },
          entities: { type: 'array', maxItems: 8, items: { type: 'string' } },
          metrics: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'value'],
              properties: {
                key: { type: 'string', enum: ['spend', 'revenue', 'roas', 'cpa', 'ctr', 'conversions'] },
                value: { type: 'number' },
              },
            },
          },
          recommendation: { type: 'string' },
          outcome: { type: 'string' },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          tags: { type: 'array', maxItems: 12, items: { type: 'string' } },
        },
      },
    },
    agentResults: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['agentName', 'status', 'summary', 'evidence', 'outputSummary', 'blockers'],
        properties: {
          agentName: { type: 'string' },
          status: { type: 'string', enum: ['done', 'blocked', 'needs_review'] },
          summary: { type: 'string' },
          evidence: { type: 'array', maxItems: 6, items: { type: 'string' } },
          outputSummary: { type: 'string' },
          blockers: { type: 'array', maxItems: 6, items: { type: 'string' } },
        },
      },
    },
  },
}

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
