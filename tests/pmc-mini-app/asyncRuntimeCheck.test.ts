import { describe, expect, it, vi } from 'vitest'
import { inspectPmcAsyncRuntime, runPmcAsyncRuntimeCheck } from '../../scripts/check-pmc-async-runtime.mjs'

const privateInputs = {
  project: 'private-project-123',
  region: 'asia-southeast1',
  service: 'private-service',
  bucket: 'private-evidence-bucket',
  queue: 'private-booking-queue',
}

describe('PMC async runtime checker', () => {
  it('reports readiness with only safe API names, booleans, counts, roles, and status names', async () => {
    const execute = vi.fn(async (command: string[]) => responseFor(command))

    const report = await inspectPmcAsyncRuntime(privateInputs, execute, asyncEnvironment())
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({
      ready: true,
      apis: expect.arrayContaining([
        { name: 'cloudtasks.googleapis.com', enabled: true },
        { name: 'storage.googleapis.com', enabled: true },
        { name: 'iamcredentials.googleapis.com', enabled: true },
      ]),
      bucket: {
        exists: true,
        locationMatches: true,
        uniformBucketLevelAccess: true,
        publicAccessPrevention: true,
      },
      queue: {
        exists: true,
        locationMatches: true,
        retrySettings: {
          maxAttempts: 8,
          minBackoffSeconds: 10,
          maxBackoffSeconds: 300,
          maxRetryDurationSeconds: 86_400,
          maxConcurrentDispatches: 1,
          maxDispatchesPerSecond: 2,
        },
      },
      iam: {
        bindingCount: 3,
        roles: expect.arrayContaining(['roles/cloudtasks.enqueuer', 'roles/run.invoker', 'roles/storage.objectUser']),
      },
      environment: { asyncEnabled: false, requiredNameCount: 8, presentNameCount: 8 },
    })
    for (const value of Object.values(privateInputs)) expect(serialized).not.toContain(value)
    expect(serialized).not.toContain('private-invoker@private-project-123.iam.gserviceaccount.com')
  })

  it('returns a nonzero strict result when a required safe check is missing', async () => {
    const output: string[] = []
    const code = await runPmcAsyncRuntimeCheck(
      ['--project', privateInputs.project, '--region', privateInputs.region, '--service', privateInputs.service,
        '--bucket', privateInputs.bucket, '--queue', privateInputs.queue, '--strict'],
      { stdout: { write: (value: string) => output.push(value) }, stderr: { write: vi.fn() } },
      vi.fn(async (command: string[]) => command[1] === 'services' ? JSON.stringify([]) : responseFor(command)),
      asyncEnvironment(),
    )

    expect(code).toBe(1)
    expect(output.join('')).not.toContain(privateInputs.project)
    expect(output.join('')).not.toContain(privateInputs.bucket)
  })

  it('prints help and makes no Google command call', async () => {
    const execute = vi.fn()
    const output: string[] = []

    await expect(runPmcAsyncRuntimeCheck(['--help'], {
      stdout: { write: (value: string) => output.push(value) }, stderr: { write: vi.fn() },
    }, execute, asyncEnvironment())).resolves.toBe(0)

    expect(output.join('')).toContain('--project')
    expect(execute).not.toHaveBeenCalled()
  })
})

function asyncEnvironment(): Record<string, string> {
  return {
    PMC_MINI_APP_ASYNC_ENABLED: 'false',
    PMC_GCP_PROJECT_ID: privateInputs.project,
    PMC_ASYNC_LOCATION: privateInputs.region,
    PMC_ASYNC_BUCKET: privateInputs.bucket,
    PMC_ASYNC_QUEUE: privateInputs.queue,
    PMC_ASYNC_WORKER_URL: 'https://private.example/internal/mini-app/finalize-booking',
    PMC_ASYNC_WORKER_AUDIENCE: 'https://private.example',
    PMC_ASYNC_TASK_INVOKER_EMAIL: 'private-invoker@private-project-123.iam.gserviceaccount.com',
    PMC_ASYNC_OWNER_STAFF_IDS: 'staff-owner',
  }
}

function responseFor(command: string[]): string {
  if (command[1] === 'services') return JSON.stringify([
    { config: { name: 'cloudtasks.googleapis.com' } },
    { config: { name: 'storage.googleapis.com' } },
    { config: { name: 'iamcredentials.googleapis.com' } },
  ])
  if (command[1] === 'storage' && command[2] === 'buckets' && command[3] === 'describe') {
    return JSON.stringify({
      location: privateInputs.region,
      iamConfiguration: {
        uniformBucketLevelAccess: { enabled: true },
        publicAccessPrevention: 'enforced',
      },
    })
  }
  if (command[1] === 'tasks') return JSON.stringify({
    rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 2 },
    retryConfig: { maxAttempts: 8, minBackoff: '10s', maxBackoff: '300s', maxRetryDuration: '86400s' },
  })
  return JSON.stringify({ bindings: [
    { role: 'roles/storage.objectUser', members: ['serviceAccount:private-runtime@private-project-123.iam.gserviceaccount.com'] },
    { role: 'roles/cloudtasks.enqueuer', members: ['serviceAccount:private-runtime@private-project-123.iam.gserviceaccount.com'] },
    { role: 'roles/run.invoker', members: ['serviceAccount:private-invoker@private-project-123.iam.gserviceaccount.com'] },
  ] })
}
