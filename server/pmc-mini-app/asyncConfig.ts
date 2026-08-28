export interface PmcAsyncBookingConfig {
  enabled: true
  projectId: string
  location: 'asia-southeast1'
  bucketName: string
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  ownerStaffIds: ReadonlySet<string>
  maxBatchBytes: 25_000_000
}

const REQUIRED = [
  'PMC_GCP_PROJECT_ID',
  'PMC_ASYNC_LOCATION',
  'PMC_ASYNC_BUCKET',
  'PMC_ASYNC_QUEUE',
  'PMC_ASYNC_WORKER_URL',
  'PMC_ASYNC_WORKER_AUDIENCE',
  'PMC_ASYNC_TASK_INVOKER_EMAIL',
  'PMC_ASYNC_OWNER_STAFF_IDS',
] as const

const LOCATION = 'asia-southeast1' as const
const MAX_BATCH_BYTES = 25_000_000 as const

export function readPmcAsyncBookingConfig(
  env: Record<string, string | undefined>,
): PmcAsyncBookingConfig | null {
  if (env.PMC_MINI_APP_ASYNC_ENABLED !== 'true') return null
  if (REQUIRED.some((name) => !boundedValue(env[name]))) return null

  const projectId = env.PMC_GCP_PROJECT_ID!.trim()
  const location = env.PMC_ASYNC_LOCATION!.trim()
  const bucketName = env.PMC_ASYNC_BUCKET!.trim()
  const queueName = env.PMC_ASYNC_QUEUE!.trim()
  const workerUrl = env.PMC_ASYNC_WORKER_URL!.trim()
  const workerAudience = env.PMC_ASYNC_WORKER_AUDIENCE!.trim()
  const taskInvokerEmail = env.PMC_ASYNC_TASK_INVOKER_EMAIL!.trim()
  const ownerStaffIds = parseOwnerStaffIds(env.PMC_ASYNC_OWNER_STAFF_IDS!)

  if (!isProjectId(projectId)
    || location !== LOCATION
    || !isResourceName(bucketName)
    || !isResourceName(queueName)
    || !isHttpsUrl(workerUrl)
    || !isHttpsUrl(workerAudience)
    || !isServiceAccountEmail(taskInvokerEmail)
    || !ownerStaffIds) return null

  return {
    enabled: true,
    projectId,
    location: LOCATION,
    bucketName,
    queueName,
    workerUrl,
    workerAudience,
    taskInvokerEmail,
    ownerStaffIds,
    maxBatchBytes: MAX_BATCH_BYTES,
  }
}

function boundedValue(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 && trimmed.length <= 2_048
}

function isProjectId(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)
}

function isResourceName(value: string): boolean {
  return /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(value)
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

function isServiceAccountEmail(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(value)
}

function parseOwnerStaffIds(value: string): ReadonlySet<string> | null {
  const ids = value.split(',').map((id) => id.trim())
  if (ids.length === 0 || ids.some((id) => !/^staff-[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(id))) return null
  return new Set(ids)
}
