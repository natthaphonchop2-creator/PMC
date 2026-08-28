import { createHash } from 'node:crypto'
import { protos, type CloudTasksClient } from '@google-cloud/tasks'
import { describe, expect, it, vi } from 'vitest'
import { createGoogleBookingTaskQueue } from '../../server/pmc-mini-app/taskQueue'

describe('PMC Mini App booking task queue', () => {
  it('creates the exact deterministic OIDC worker task contract', async () => {
    const createTask = vi.fn(async () => [{ name: expectedTaskName() }])
    const client = fakeClient(createTask)
    const queue = createGoogleBookingTaskQueue({
      projectId: 'pmc-project',
      location: 'asia-southeast1',
      queueName: 'pmc-booking-finalize',
      workerUrl: 'https://pmc-worker.example.com/internal/mini-app/booking-worker',
      workerAudience: 'https://pmc-worker.example.com',
      taskInvokerEmail: 'worker@pmc-project.iam.gserviceaccount.com',
      client,
    })

    const result = await queue.enqueue({
      requestId: 'request-1',
      draftId: 'draft-1',
      scheduleAt: new Date('2026-08-28T02:00:02.123Z'),
    })

    expect(createTask).toHaveBeenCalledWith({
      parent: 'projects/pmc-project/locations/asia-southeast1/queues/pmc-booking-finalize',
      task: {
        name: expectedTaskName(),
        httpRequest: {
          httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
          url: 'https://pmc-worker.example.com/internal/mini-app/booking-worker',
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from('{"requestId":"request-1","draftId":"draft-1"}'),
          oidcToken: {
            serviceAccountEmail: 'worker@pmc-project.iam.gserviceaccount.com',
            audience: 'https://pmc-worker.example.com',
          },
        },
        scheduleTime: { seconds: 1_787_882_402, nanos: 123_000_000 },
        dispatchDeadline: { seconds: 300 },
      },
    })
    expect(result).toEqual({ taskName: expectedTaskName(), alreadyExists: false })
  })

  it('treats only gRPC ALREADY_EXISTS code 6 as idempotent success', async () => {
    const alreadyExists = Object.assign(new Error('provider details'), { code: 6, metadata: { secret: 'hidden' } })
    const createTask = vi.fn().mockRejectedValue(alreadyExists)
    const queue = createGoogleBookingTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-booking-finalize',
      workerUrl: 'https://pmc-worker.example.com/internal/mini-app/booking-worker',
      workerAudience: 'https://pmc-worker.example.com',
      taskInvokerEmail: 'worker@pmc-project.iam.gserviceaccount.com',
      client: fakeClient(createTask),
    })

    await expect(queue.enqueue({
      requestId: 'request-1', draftId: 'draft-1', scheduleAt: new Date('2026-08-28T02:00:02.000Z'),
    })).resolves.toEqual({ taskName: expectedTaskName(), alreadyExists: true })

    for (const code of [5, '6', undefined]) {
      const providerError = Object.assign(new Error('provider details'), { code, providerBody: 'secret' })
      createTask.mockRejectedValueOnce(providerError)
      const failure = await queue.enqueue({
        requestId: 'request-1', draftId: 'draft-1', scheduleAt: new Date('2026-08-28T02:00:02.000Z'),
      }).catch((error: unknown) => error)
      expect(failure).toMatchObject({ message: 'BOOKING_TASK_QUEUE_FAILED' })
      expect(failure).not.toHaveProperty('cause')
      expect(failure).not.toHaveProperty('providerBody')
    }
  })
})

function expectedTaskName(): string {
  const id = createHash('sha256').update('request-1', 'utf8').digest('hex')
  return `projects/pmc-project/locations/asia-southeast1/queues/pmc-booking-finalize/tasks/booking-${id}`
}

function fakeClient(createTask: ReturnType<typeof vi.fn>): CloudTasksClient {
  return {
    queuePath: (project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`,
    taskPath: (project: string, location: string, queue: string, task: string) => `projects/${project}/locations/${location}/queues/${queue}/tasks/${task}`,
    createTask,
  } as unknown as CloudTasksClient
}
