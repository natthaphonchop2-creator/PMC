export interface PmcExpenseAsyncConfig {
  enabled: true
  projectId: string
  location: 'asia-southeast1'
  jobBucketName: string
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  pilotStaffIds: ReadonlySet<string>
}

type AsyncEnvironment = Record<string, string | undefined>

const LOCATION = 'asia-southeast1' as const
const REQUIRED = [
  'PMC_GCP_PROJECT_ID',
  'PMC_ASYNC_LOCATION',
  'PMC_EXPENSE_ASYNC_JOB_BUCKET',
  'PMC_EXPENSE_ASYNC_QUEUE',
  'PMC_EXPENSE_ASYNC_WORKER_URL',
  'PMC_EXPENSE_ASYNC_WORKER_AUDIENCE',
  'PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL',
  'PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS',
] as const

export function readPmcExpenseAsyncConfig(
  env: AsyncEnvironment,
  bookingQueueName: string | null,
): PmcExpenseAsyncConfig | null {
  if (env.PMC_EXPENSE_ASYNC_ENABLED === undefined || env.PMC_EXPENSE_ASYNC_ENABLED === 'false') return null
  if (env.PMC_EXPENSE_ASYNC_ENABLED !== 'true') return null
  if (REQUIRED.some((name) => !bounded(env[name]))) return null

  const projectId = env.PMC_GCP_PROJECT_ID!.trim()
  const location = env.PMC_ASYNC_LOCATION!.trim()
  const jobBucketName = env.PMC_EXPENSE_ASYNC_JOB_BUCKET!.trim()
  const queueName = env.PMC_EXPENSE_ASYNC_QUEUE!.trim()
  const workerUrl = env.PMC_EXPENSE_ASYNC_WORKER_URL!.trim()
  const workerAudience = env.PMC_EXPENSE_ASYNC_WORKER_AUDIENCE!.trim()
  const taskInvokerEmail = env.PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL!.trim()
  const pilotStaffIds = parseStaffIds(env.PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS!)
  const bookingStagingBucket = env.PMC_ASYNC_BUCKET?.trim() ?? ''
  const financeStagingBucket = env.PMC_FINANCE_STAGING_BUCKET?.trim() ?? ''

  if (
    !project(projectId)
    || location !== LOCATION
    || !resource(jobBucketName)
    || !resource(queueName)
    || queueName === bookingQueueName
    || jobBucketName === bookingStagingBucket
    || jobBucketName === financeStagingBucket
    || !workerEndpoint(workerUrl)
    || !origin(workerAudience)
    || !serviceAccountEmail(taskInvokerEmail)
    || !pilotStaffIds
  ) return null

  return {
    enabled: true,
    projectId,
    location: LOCATION,
    jobBucketName,
    queueName,
    workerUrl,
    workerAudience,
    taskInvokerEmail,
    pilotStaffIds,
  }
}

function bounded(value: string | undefined): boolean {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 && normalized.length <= 2_048
}

function project(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)
}

function resource(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value)
}

function workerEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/internal/mini-app/finalize-expense'
      && !parsed.search
      && !parsed.hash
  } catch { return false }
}

function origin(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && (parsed.pathname === '' || parsed.pathname === '/')
      && !parsed.search
      && !parsed.hash
  } catch { return false }
}

function serviceAccountEmail(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,62}[a-z0-9]@[a-z][a-z0-9-]{4,62}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(value)
}

function parseStaffIds(value: string): ReadonlySet<string> | null {
  const ids = value.split(',').map((id) => id.trim())
  const unique = new Set(ids)
  return ids.length > 0
    && unique.size === ids.length
    && ids.every((id) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,123}$/.test(id))
    ? unique
    : null
}
