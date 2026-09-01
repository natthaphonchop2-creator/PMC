import { protos, type CloudTasksClient } from '@google-cloud/tasks'
import { describe, expect, it, vi } from 'vitest'
import { createGoogleExpenseTaskQueue } from '../../server/pmc-mini-app/finance/taskQueue'

const ROOT = 'expense-root-1'
const FINGERPRINT = 'a'.repeat(64)

describe('async expense task queue', () => {
  it('creates the exact deterministic OIDC task with no financial payload', async () => {
    const createTask = vi.fn(async () => [{ name: expectedTaskName() }])
    const queue = createGoogleExpenseTaskQueue({
      projectId: 'pmc-project',
      location: 'asia-southeast1',
      queueName: 'pmc-expense-finalize',
      workerUrl: 'https://pmc-worker.example.com/internal/mini-app/finalize-expense',
      workerAudience: 'https://pmc-worker.example.com',
      taskInvokerEmail: 'worker@pmc-project.iam.gserviceaccount.com',
      client: fakeClient(createTask),
    })

    await expect(queue.enqueue({
      rootRequestId: ROOT,
      fingerprint: FINGERPRINT,
      scheduleAt: new Date('2026-09-01T18:00:02.123Z'),
    })).resolves.toEqual({ taskName: expectedTaskName(), alreadyExists: false })

    expect(createTask).toHaveBeenCalledWith({
      parent: 'projects/pmc-project/locations/asia-southeast1/queues/pmc-expense-finalize',
      task: {
        name: expectedTaskName(),
        httpRequest: {
          httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
          url: 'https://pmc-worker.example.com/internal/mini-app/finalize-expense',
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(`{"rootRequestId":"${ROOT}","fingerprint":"${FINGERPRINT}"}`),
          oidcToken: {
            serviceAccountEmail: 'worker@pmc-project.iam.gserviceaccount.com',
            audience: 'https://pmc-worker.example.com',
          },
        },
        scheduleTime: { seconds: 1_788_285_602, nanos: 123_000_000 },
        dispatchDeadline: { seconds: 300 },
      },
    })
    expect(JSON.stringify(createTask.mock.calls)).not.toMatch(/amount|merchant|description|fileId|staff/i)
  })

  it('treats only numeric gRPC code 6 as idempotent success and sanitizes all other failures', async () => {
    const createTask = vi.fn().mockRejectedValue(Object.assign(new Error('provider secret'), { code: 6 }))
    const queue = createGoogleExpenseTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-expense-finalize',
      workerUrl: 'https://pmc-worker.example.com/internal/mini-app/finalize-expense',
      workerAudience: 'https://pmc-worker.example.com',
      taskInvokerEmail: 'worker@pmc-project.iam.gserviceaccount.com',
      client: fakeClient(createTask),
    })
    const input = { rootRequestId: ROOT, fingerprint: FINGERPRINT, scheduleAt: new Date('2026-09-01T18:00:02.000Z') }

    await expect(queue.enqueue(input)).resolves.toEqual({ taskName: expectedTaskName(), alreadyExists: true })
    for (const code of [5, '6', undefined]) {
      createTask.mockRejectedValueOnce(Object.assign(new Error('provider secret'), { code, providerBody: 'hidden' }))
      const error = await queue.enqueue(input).catch((value: unknown) => value)
      expect(error).toMatchObject({ message: 'EXPENSE_TASK_QUEUE_FAILED' })
      expect(error).not.toHaveProperty('providerBody')
      expect(error).not.toHaveProperty('cause')
    }
  })
})

function expectedTaskName(): string {
  return 'projects/pmc-project/locations/asia-southeast1/queues/pmc-expense-finalize/tasks/'
    + 'expense-f6262ffc25d64bac2088ab879352223c6b8f568c7b42b3044ae2e3f7298a0e62'
}

function fakeClient(createTask: ReturnType<typeof vi.fn>): CloudTasksClient {
  return {
    queuePath: (project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`,
    taskPath: (project: string, location: string, queue: string, task: string) => `projects/${project}/locations/${location}/queues/${queue}/tasks/${task}`,
    createTask,
  } as unknown as CloudTasksClient
}
