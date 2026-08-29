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
      infrastructureReady: true,
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
        requiredBindingCount: 4,
        exactBindingsReady: true,
        forbiddenBroadBindings: false,
        roles: expect.arrayContaining(['roles/cloudtasks.enqueuer', 'roles/iam.serviceAccountUser', 'roles/run.invoker', 'roles/storage.objectUser']),
      },
      deployed: { serviceExists: true, asyncDisabled: true, requiredNameCount: 10, presentNameCount: 10 },
    })
    for (const value of Object.values(privateInputs)) expect(serialized).not.toContain(value)
    expect(serialized).not.toContain('pmc-mini-app-task-invoker@private-project-123.iam.gserviceaccount.com')
    expect(execute.mock.calls.map(([command]) => command.join(' ')).join('\n')).toContain('iam service-accounts get-iam-policy')
  })

  it('fails infrastructure readiness when the runtime cannot act as the task identity', async () => {
    const execute = vi.fn(async (command: string[]) => {
      if (command[1] === 'iam' && command[2] === 'service-accounts') return JSON.stringify({ bindings: [] })
      return responseFor(command)
    })

    const report = await inspectPmcAsyncRuntime(privateInputs, execute, asyncEnvironment())

    expect(report.infrastructureReady).toBe(false)
    expect(report.iam).toMatchObject({ requiredBindingCount: 4, exactBindingsReady: false })
  })

  it('accepts the real gcloud bucket schema without exposing infrastructure values', async () => {
    const execute = vi.fn(async (command: string[]) => {
      if (command[1] === 'storage' && command[2] === 'buckets' && command[3] === 'describe') return JSON.stringify({
        location: 'ASIA-SOUTHEAST1', uniform_bucket_level_access: true, public_access_prevention: 'enforced',
      })
      return responseFor(command)
    })

    const report = await inspectPmcAsyncRuntime(privateInputs, execute, asyncEnvironment())

    expect(report).toMatchObject({ infrastructureReady: true, ready: true, bucket: {
      locationMatches: true, uniformBucketLevelAccess: true, publicAccessPrevention: true,
    } })
    expect(JSON.stringify(report)).not.toContain(privateInputs.bucket)
  })

  it('fails closed for a mixed bucket schema or deployed task-invoker mismatch', async () => {
    const mixed = vi.fn(async (command: string[]) => {
      if (command[1] === 'storage' && command[2] === 'buckets' && command[3] === 'describe') return JSON.stringify({
        location: privateInputs.region, uniform_bucket_level_access: true,
        iamConfiguration: { publicAccessPrevention: 'enforced' },
      })
      return responseFor(command)
    })
    const mismatch = vi.fn(async (command: string[]) => {
      if (command[1] === 'run' && command[2] === 'services' && command[3] === 'describe') return JSON.stringify(serviceConfig('other-invoker@private-project-123.iam.gserviceaccount.com'))
      return responseFor(command)
    })

    await expect(inspectPmcAsyncRuntime(privateInputs, mixed, asyncEnvironment())).resolves.toMatchObject({ infrastructureReady: false })
    await expect(inspectPmcAsyncRuntime(privateInputs, mismatch, asyncEnvironment())).resolves.toMatchObject({ infrastructureReady: true, ready: false })
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

  it('fails closed unless deployed Cloud Run config has the disabled async flag, required names, and exact IAM members', async () => {
    const wrongMember = vi.fn(async (command: string[]) => {
      if (command[1] === 'run' && command[2] === 'services' && command[3] === 'describe') return JSON.stringify({
        spec: { template: { spec: { serviceAccountName: 'private-runtime@private-project-123.iam.gserviceaccount.com', containers: [{
          env: [{ name: 'PMC_MINI_APP_ASYNC_ENABLED', value: 'false' }],
        }] } } },
      })
      if (command[1] === 'projects' && command[2] === 'get-iam-policy') return JSON.stringify({ bindings: [] })
      if (command[1] === 'storage' && command[3] === 'get-iam-policy') return JSON.stringify({ bindings: [
        { role: 'roles/storage.objectUser', members: ['serviceAccount:wrong-member@private-project-123.iam.gserviceaccount.com'] },
      ] })
      return responseFor(command)
    })

    const report = await inspectPmcAsyncRuntime(privateInputs, wrongMember, asyncEnvironment())

    expect(report.ready).toBe(false)
    expect(report.deployed).toMatchObject({ serviceExists: true, asyncDisabled: true, requiredNameCount: 10, presentNameCount: 1 })
    expect(report.iam).toMatchObject({ exactBindingsReady: false, forbiddenBroadBindings: false })
    expect(wrongMember.mock.calls.map(([command]) => command.join(' ')).join('\n')).toContain('run services describe')
    expect(wrongMember.mock.calls.map(([command]) => command.join(' ')).join('\n')).toContain('projects get-iam-policy')
  })

  it('does not treat local environment values or broad identity roles as deployed readiness', async () => {
    const broad = vi.fn(async (command: string[]) => {
      if (command[1] === 'run' && command[2] === 'services' && command[3] === 'describe') return JSON.stringify({
        spec: { template: { spec: { serviceAccountName: 'private-runtime@private-project-123.iam.gserviceaccount.com', containers: [{ env: [] }] } } },
      })
      if (command[1] === 'projects' && command[2] === 'get-iam-policy') return JSON.stringify({ bindings: [
        { role: 'roles/owner', members: ['serviceAccount:private-runtime@private-project-123.iam.gserviceaccount.com'] },
      ] })
      return responseFor(command)
    })

    const report = await inspectPmcAsyncRuntime(privateInputs, broad, { ...asyncEnvironment(), PMC_MINI_APP_ASYNC_ENABLED: 'false' })

    expect(report.ready).toBe(false)
    expect(report.iam.forbiddenBroadBindings).toBe(true)
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
  if (command[1] === 'tasks' && command[3] === 'describe') return JSON.stringify({
    rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 2 },
    retryConfig: { maxAttempts: 8, minBackoff: '10s', maxBackoff: '300s', maxRetryDuration: '86400s' },
  })
  if (command[1] === 'run' && command[2] === 'services' && command[3] === 'describe') return JSON.stringify({
    spec: { template: { spec: { serviceAccountName: 'private-runtime@private-project-123.iam.gserviceaccount.com', containers: [{ env: [
      { name: 'PMC_MINI_APP_ASYNC_ENABLED', value: 'false' },
      { name: 'PMC_GCP_PROJECT_ID', value: privateInputs.project }, { name: 'PMC_ASYNC_LOCATION', value: privateInputs.region },
      { name: 'PMC_ASYNC_BUCKET', value: privateInputs.bucket }, { name: 'PMC_ASYNC_QUEUE', value: privateInputs.queue },
      { name: 'PMC_ASYNC_WORKER_URL', value: 'https://private.example/internal/mini-app/finalize-booking' },
      { name: 'PMC_ASYNC_WORKER_AUDIENCE', value: 'https://private.example' },
      { name: 'PMC_ASYNC_TASK_INVOKER_EMAIL', value: 'pmc-mini-app-task-invoker@private-project-123.iam.gserviceaccount.com' },
      { name: 'PMC_ASYNC_OWNER_STAFF_IDS', value: 'staff-owner' },
      { name: 'PMC_BOOKING_INGRESS_SECRET', valueFrom: { secretKeyRef: { name: 'private-secret', key: 'latest' } } },
    ] }] } } },
  })
  if (command[1] === 'iam' && command[2] === 'service-accounts' && command[3] === 'get-iam-policy') return JSON.stringify({ bindings: [
    { role: 'roles/iam.serviceAccountUser', members: ['serviceAccount:private-runtime@private-project-123.iam.gserviceaccount.com'] },
  ] })
  if (command[1] === 'projects') return JSON.stringify({ bindings: [] })
  return JSON.stringify({ bindings: [
    { role: 'roles/storage.objectUser', members: ['serviceAccount:private-runtime@private-project-123.iam.gserviceaccount.com'] },
    { role: 'roles/cloudtasks.enqueuer', members: ['serviceAccount:private-runtime@private-project-123.iam.gserviceaccount.com'] },
    { role: 'roles/run.invoker', members: ['serviceAccount:pmc-mini-app-task-invoker@private-project-123.iam.gserviceaccount.com'] },
  ] })
}

function serviceConfig(taskInvoker: string) {
  return {
    spec: { template: { spec: { serviceAccountName: 'private-runtime@private-project-123.iam.gserviceaccount.com', containers: [{ env: [
      { name: 'PMC_MINI_APP_ASYNC_ENABLED', value: 'false' }, { name: 'PMC_GCP_PROJECT_ID', value: privateInputs.project },
      { name: 'PMC_ASYNC_LOCATION', value: privateInputs.region }, { name: 'PMC_ASYNC_BUCKET', value: privateInputs.bucket },
      { name: 'PMC_ASYNC_QUEUE', value: privateInputs.queue }, { name: 'PMC_ASYNC_WORKER_URL', value: 'https://private.example/internal/mini-app/finalize-booking' },
      { name: 'PMC_ASYNC_WORKER_AUDIENCE', value: 'https://private.example' }, { name: 'PMC_ASYNC_TASK_INVOKER_EMAIL', value: taskInvoker },
      { name: 'PMC_ASYNC_OWNER_STAFF_IDS', value: 'staff-owner' }, { name: 'PMC_BOOKING_INGRESS_SECRET', valueFrom: { secretKeyRef: { name: 'private-secret', key: 'latest' } } },
    ] }] } } },
  }
}
