import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectPmcExpenseAsyncRuntime } from '../../scripts/check-pmc-expense-async-runtime.mjs'

const execute = promisify(execFile)
const temporaryDirectories: string[] = []
const NOW = '2026-09-01T13:10:00.000Z'

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('read-only async expense runtime checker', () => {
  it('accepts only the exact disabled preflight and emits a sanitized readiness projection', () => {
    const report = inspectPmcExpenseAsyncRuntime(validSnapshot(), options())
    const serialized = JSON.stringify(report)

    expect(report).toEqual({
      mode: 'READ_ONLY',
      ready: true,
      snapshotSchema: { safe: true, unknownKeyCount: 0 },
      provenance: {
        ready: true, ageSeconds: 600, maxAgeSeconds: 900,
        sourceCheckCount: 5, requiredSourceCheckCount: 5,
        targetMatches: true, environmentMatches: true,
      },
      service: { healthStatus: 200, workerUnauthorizedStatus: 404, ready: true },
      queue: {
        state: 'RUNNING', taskCount: 0, drained: true, retryReady: true,
      },
      bucket: {
        locationMatches: true, uniformBucketLevelAccess: true,
        publicAccessPrevention: true, lifecycleDeleteDays: 7, ready: true,
      },
      bindings: { presentCount: 7, requiredCount: 7, coherent: true },
      flag: { disabled: true, explicit: true },
    })
    for (const sentinel of ['private-job-bucket', 'private-expense-queue', 'private-worker.example', 'private-invoker']) {
      expect(serialized).not.toContain(sentinel)
    }
  })

  it.each([
    ['stale snapshot', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.provenance.collectedAt = '2026-09-01T12:00:00.000Z' }],
    ['wrong environment', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.provenance.environment = 'staging' }],
    ['missing source check', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.provenance.sourceChecks.worker = false }],
    ['queue paused', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.queue.state = 'PAUSED' }],
    ['queue not drained', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.queue.taskCount = 1 }],
    ['wrong bucket lifecycle', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.bucket.lifecycleDeleteDays = 1 }],
    ['public bucket', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.bucket.publicAccessPrevention = false }],
    ['worker route exposed', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.service.workerUnauthorizedStatus = 200 }],
    ['async flag enabled', (snapshot: ReturnType<typeof validSnapshot>) => { snapshot.flag.PMC_EXPENSE_ASYNC_ENABLED = 'true' }],
  ])('fails readiness for %s', (_case, mutate) => {
    const snapshot = validSnapshot()
    mutate(snapshot)
    expect(inspectPmcExpenseAsyncRuntime(snapshot, options()).ready).toBe(false)
  })

  it('rejects unknown private payloads before inspection and never echoes them', () => {
    const snapshot = Object.assign(validSnapshot(), {
      credentials: { secret: 'must-not-print-secret-sentinel' },
    })
    const serialized = JSON.stringify(inspectPmcExpenseAsyncRuntime(snapshot, options()))

    expect(JSON.parse(serialized)).toEqual({
      mode: 'READ_ONLY', ready: false,
      snapshotSchema: { safe: false, unknownKeyCount: 1 },
    })
    expect(serialized).not.toContain('must-not-print-secret-sentinel')
  })

  it('rejects missing, duplicate, or extra expense binding names', () => {
    const missing = validSnapshot()
    missing.bindingNames.pop()
    const duplicate = validSnapshot()
    duplicate.bindingNames[0] = duplicate.bindingNames[1]!
    const extra = validSnapshot()
    extra.bindingNames.push('PRIVATE_SECRET=must-not-print')

    for (const snapshot of [missing, duplicate, extra]) {
      const serialized = JSON.stringify(inspectPmcExpenseAsyncRuntime(snapshot, options()))
      expect(JSON.parse(serialized).ready).toBe(false)
      expect(serialized).not.toContain('must-not-print')
    }
  })

  it('runs only against an explicit local snapshot and prints sanitized strict JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmc-expense-async-check-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'snapshot.json')
    await writeFile(path, JSON.stringify({
      ...validSnapshot(),
      provenance: { ...validSnapshot().provenance, collectedAt: new Date().toISOString() },
    }))

    const result = await execute(process.execPath, [
      resolve('scripts/check-pmc-expense-async-runtime.mjs'),
      '--snapshot-file', path,
      '--expected-target', 'pmc-mini-app',
      '--expected-environment', 'production',
      '--strict',
    ])

    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'READ_ONLY', ready: true })
    expect(result.stdout).not.toContain('private-job-bucket')
    expect(result.stderr).toBe('')
  })
})

function options() {
  return {
    now: () => new Date(NOW), expectedTarget: 'pmc-mini-app',
    expectedEnvironment: 'production', maxAgeSeconds: 900,
  }
}

function validSnapshot() {
  return {
    provenance: {
      schemaVersion: 1,
      profile: 'DISABLED_PREFLIGHT',
      target: 'pmc-mini-app',
      environment: 'production',
      collectedAt: '2026-09-01T13:00:00.000Z',
      sourceChecks: { service: true, worker: true, queue: true, bucket: true, bindings: true },
    },
    service: { healthStatus: 200, workerUnauthorizedStatus: 404 },
    queue: {
      name: 'private-expense-queue', state: 'RUNNING', taskCount: 0,
      maxAttempts: 8, minBackoffSeconds: 10, maxBackoffSeconds: 300,
      maxRetryDurationSeconds: 86_400, maxConcurrentDispatches: 1, maxDispatchesPerSecond: 2,
    },
    bucket: {
      name: 'private-job-bucket', location: 'ASIA-SOUTHEAST1',
      uniformBucketLevelAccess: true, publicAccessPrevention: true, lifecycleDeleteDays: 7,
    },
    flag: { PMC_EXPENSE_ASYNC_ENABLED: 'false' },
    bindingNames: [
      'PMC_EXPENSE_ASYNC_ENABLED',
      'PMC_EXPENSE_ASYNC_JOB_BUCKET',
      'PMC_EXPENSE_ASYNC_QUEUE',
      'PMC_EXPENSE_ASYNC_WORKER_URL',
      'PMC_EXPENSE_ASYNC_WORKER_AUDIENCE',
      'PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL',
      'PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS',
    ],
  }
}
