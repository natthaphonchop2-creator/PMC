import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  DecisionRecord,
  KnowledgeMemory,
  KnowledgeMemoryType,
  MonitoringAlert,
  OutcomeLearningRecord,
  OutcomeObservation,
  Phase4Report,
} from '../src/types'

const RUNTIME_ROOT = resolve(process.cwd(), 'knowledge-base/runtime')
const MEMORY_FILES: Record<KnowledgeMemoryType, string> = {
  audience: resolve(RUNTIME_ROOT, 'memories/audience-memory.jsonl'),
  business: resolve(RUNTIME_ROOT, 'memories/business-preferences.jsonl'),
  campaign: resolve(RUNTIME_ROOT, 'memories/campaign-memory.jsonl'),
  compliance: resolve(RUNTIME_ROOT, 'memories/compliance-memory.jsonl'),
  creative: resolve(RUNTIME_ROOT, 'memories/creative-memory.jsonl'),
  system: resolve(RUNTIME_ROOT, 'memories/system-memory.jsonl'),
}
const RECOMMENDATIONS_FILE = resolve(RUNTIME_ROOT, 'decisions/recommendations.jsonl')
const EXECUTIONS_FILE = resolve(RUNTIME_ROOT, 'decisions/executions.jsonl')
const OUTCOMES_FILE = resolve(RUNTIME_ROOT, 'outcomes/outcome-observations.jsonl')
const LEARNINGS_FILE = resolve(RUNTIME_ROOT, 'outcomes/learning-records.jsonl')
const ALERTS_FILE = resolve(RUNTIME_ROOT, 'monitoring/alerts.jsonl')
const REPORTS_FILE = resolve(RUNTIME_ROOT, 'reports/phase-4-reports.jsonl')
const DEFAULT_QUERY_LIMIT = 20
const MAX_QUERY_LIMIT = 80
const SECRET_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key|access[_-]?token)/i
const SECRET_VALUE_PATTERN = /(sk-[a-z0-9_-]{16,}|EA[A-Za-z0-9]{30,}|Bearer\s+[A-Za-z0-9._-]{16,})/gi

export interface AiKnowledgeQuery {
  targetIds?: string[]
  tags?: string[]
  memoryTypes?: KnowledgeMemoryType[]
  limit?: number
}

export interface AiKnowledgeReadResult {
  memories: KnowledgeMemory[]
  decisions: DecisionRecord[]
  source: 'runtime-jsonl'
}

export interface AiKnowledgeWriteResult {
  memoriesWritten: number
  decisionsWritten: number
  source: 'runtime-jsonl'
}

export interface AiOutcomeReadResult {
  outcomes: OutcomeObservation[]
  learnings: OutcomeLearningRecord[]
  alerts: MonitoringAlert[]
  reports: Phase4Report[]
  source: 'runtime-jsonl'
}

export interface AiOutcomeWriteResult {
  outcomesWritten: number
  learningsWritten: number
  alertsWritten: number
  reportsWritten: number
  source: 'runtime-jsonl'
}

export async function readAiBrainKnowledge(query: AiKnowledgeQuery = {}): Promise<AiKnowledgeReadResult> {
  const [memories, decisions] = await Promise.all([
    readAllMemoryJsonl(),
    readAllDecisionJsonl(),
  ])
  const limit = normalizeLimit(query.limit)
  const targetIds = new Set((query.targetIds ?? []).map(normalizeKey).filter(Boolean))
  const tags = new Set((query.tags ?? []).map(normalizeKey).filter(Boolean))
  const memoryTypes = new Set(query.memoryTypes ?? [])

  return {
    source: 'runtime-jsonl',
    memories: memories
      .filter((memory) => matchesMemory(memory, { memoryTypes, tags, targetIds }))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit),
    decisions: decisions
      .filter((decision) => matchesDecision(decision, { targetIds }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit),
  }
}

export async function appendAiBrainKnowledge({
  decisions,
  memories,
}: {
  decisions: DecisionRecord[]
  memories: KnowledgeMemory[]
}): Promise<AiKnowledgeWriteResult> {
  const [memoryCount, decisionCount] = await Promise.all([appendMemories(memories), appendDecisions(decisions)])
  return {
    source: 'runtime-jsonl',
    memoriesWritten: memoryCount,
    decisionsWritten: decisionCount,
  }
}

export function buildKnowledgeQueryFromTargetIds(targetIds: string[], limit = DEFAULT_QUERY_LIMIT): AiKnowledgeQuery {
  return {
    targetIds: targetIds.map(normalizeKey).filter(Boolean),
    limit,
  }
}

export async function readAiOutcomeKnowledge(limit = DEFAULT_QUERY_LIMIT): Promise<AiOutcomeReadResult> {
  const normalizedLimit = normalizeLimit(limit)
  const [outcomes, learnings, alerts, reports] = await Promise.all([
    readJsonl<OutcomeObservation>(OUTCOMES_FILE),
    readJsonl<OutcomeLearningRecord>(LEARNINGS_FILE),
    readJsonl<MonitoringAlert>(ALERTS_FILE),
    readJsonl<Phase4Report>(REPORTS_FILE),
  ])

  return {
    source: 'runtime-jsonl',
    outcomes: outcomes.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, normalizedLimit),
    learnings: learnings.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, normalizedLimit),
    alerts: alerts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, normalizedLimit),
    reports: reports.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)).slice(0, normalizedLimit),
  }
}

export async function appendAiOutcomeKnowledge({
  alerts,
  learnings,
  outcomes,
  reports,
}: {
  alerts: MonitoringAlert[]
  learnings: OutcomeLearningRecord[]
  outcomes: OutcomeObservation[]
  reports: Phase4Report[]
}): Promise<AiOutcomeWriteResult> {
  const [outcomesWritten, learningsWritten, alertsWritten, reportsWritten] = await Promise.all([
    appendJsonl(OUTCOMES_FILE, outcomes.map(redactKnowledgeRecord)),
    appendJsonl(LEARNINGS_FILE, learnings.map(redactKnowledgeRecord)),
    appendJsonl(ALERTS_FILE, alerts.map(redactKnowledgeRecord)),
    appendJsonl(REPORTS_FILE, reports.map(redactKnowledgeRecord)),
  ])

  return {
    source: 'runtime-jsonl',
    outcomesWritten,
    learningsWritten,
    alertsWritten,
    reportsWritten,
  }
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as T
        } catch {
          return null
        }
      })
      .filter((item): item is T => Boolean(item))
  } catch {
    return []
  }
}

async function readAllMemoryJsonl() {
  const groups = await Promise.all(Object.values(MEMORY_FILES).map((filePath) => readJsonl<KnowledgeMemory>(filePath)))
  return groups.flat()
}

async function readAllDecisionJsonl() {
  const groups = await Promise.all([readJsonl<DecisionRecord>(RECOMMENDATIONS_FILE), readJsonl<DecisionRecord>(EXECUTIONS_FILE)])
  return groups.flat()
}

async function appendMemories(memories: KnowledgeMemory[]) {
  const groups = new Map<KnowledgeMemoryType, KnowledgeMemory[]>()
  for (const memory of dedupeById(memories).map(redactKnowledgeRecord)) {
    groups.set(memory.type, [...(groups.get(memory.type) ?? []), memory])
  }

  const counts = await Promise.all(
    Array.from(groups.entries()).map(([type, records]) => appendJsonl(MEMORY_FILES[type], records)),
  )
  return counts.reduce((sum, count) => sum + count, 0)
}

async function appendDecisions(decisions: DecisionRecord[]) {
  const recommendations: DecisionRecord[] = []
  const executions: DecisionRecord[] = []
  for (const decision of dedupeById(decisions).map(redactKnowledgeRecord)) {
    if (decision.status === 'executed' || decision.status === 'failed' || decision.status === 'rolled_back') {
      executions.push(decision)
    } else {
      recommendations.push(decision)
    }
  }

  const counts = await Promise.all([
    appendJsonl(RECOMMENDATIONS_FILE, recommendations),
    appendJsonl(EXECUTIONS_FILE, executions),
  ])
  return counts.reduce((sum, count) => sum + count, 0)
}

async function appendJsonl<T extends { id: string }>(filePath: string, records: T[]) {
  const uniqueRecords = dedupeById(records).filter((record) => record.id)
  if (!uniqueRecords.length) return 0
  await mkdir(dirname(filePath), { recursive: true })
  await appendFile(filePath, `${uniqueRecords.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf-8')
  return uniqueRecords.length
}

function matchesMemory(
  memory: KnowledgeMemory,
  filters: { memoryTypes: Set<KnowledgeMemoryType>; tags: Set<string>; targetIds: Set<string> },
) {
  if (filters.memoryTypes.size && !filters.memoryTypes.has(memory.type)) return false
  if (filters.tags.size && !memory.tags.some((tag) => filters.tags.has(normalizeKey(tag)))) return false
  if (!filters.targetIds.size) return true

  return memory.entities.some((entity) => {
    const entityId = normalizeKey(entity.id ?? '')
    const entityName = normalizeKey(entity.name)
    return filters.targetIds.has(entityId) || filters.targetIds.has(entityName)
  })
}

function matchesDecision(decision: DecisionRecord, filters: { targetIds: Set<string> }) {
  if (!filters.targetIds.size) return true
  return filters.targetIds.has(normalizeKey(decision.target.objectId)) || filters.targetIds.has(normalizeKey(decision.target.name))
}

function dedupeById<T extends { id: string }>(records: T[]) {
  const seen = new Set<string>()
  const output: T[] = []
  for (const record of records) {
    const id = normalizeKey(record.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    output.push(record)
  }
  return output
}

function normalizeLimit(limit: number | undefined) {
  const nextLimit = Number(limit) || DEFAULT_QUERY_LIMIT
  return Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.round(nextLimit)))
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase()
}

function redactKnowledgeRecord<T>(record: T): T {
  return redactUnknown(record) as T
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUnknown)
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redactUnknown(child)
    }
    return output
  }
  if (typeof value === 'string') return value.replace(SECRET_VALUE_PATTERN, '[redacted]')
  return value
}
