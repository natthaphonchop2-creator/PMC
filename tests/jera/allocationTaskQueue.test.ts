import { protos, type CloudTasksClient } from '@google-cloud/tasks'
import { describe, expect, it, vi } from 'vitest'
import {
  createGoogleJeraAllocationTaskQueue,
  enqueueJeraAllocationTaskGeneration,
  MAX_JERA_ALLOCATION_ENQUEUE_GENERATIONS,
  type JeraAllocationTaskQueuePort,
} from '../../server/jera/allocationTaskQueue'

const BRANCH = '11111111-2222-4333-8444-555555555555'

describe('JERA allocation task queue', () => {
  it('creates a deterministic private OIDC continuation task', async () => {
    const createTask = vi.fn(async () => [{}])
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker',
      workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com',
      client: fakeClient(createTask),
    })

    const result = await queue.enqueue({
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt: 0,
      scheduleAt: new Date('2026-08-29T23:01:00.000Z'),
    })

    const task = createTask.mock.calls[0]![0].task!
    expect(task.httpRequest?.body).toEqual(Buffer.from(JSON.stringify({
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt: 0,
    })))
    expect(task.httpRequest?.oidcToken).toEqual({
      serviceAccountEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com',
      audience: 'https://pmc-mini-app.example',
    })
    expect(task.httpRequest?.httpMethod).toBe(protos.google.cloud.tasks.v2.HttpMethod.POST)
    expect(task.scheduleTime).toEqual({ seconds: 1_788_044_460, nanos: 0 })
    expect(task.name!.split('/').at(-1)).toMatch(/^finance-allocation-[a-f0-9]{64}$/)
    expect(task.name).not.toMatch(new RegExp(`${BRANCH}|2026-08-29`))
    expect(result).toEqual({ taskName: task.name, alreadyExists: false, live: true })
  })

  it('treats only numeric gRPC code 6 as idempotent success and replaces provider failures', async () => {
    const createTask = vi.fn()
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com', client: fakeClient(createTask),
    })
    const input = { branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt: 1, scheduleAt: new Date(0) }
    createTask.mockRejectedValueOnce(Object.assign(new Error('private'), { code: 6, metadata: { private: true } }))
    await expect(queue.enqueue(input)).resolves.toMatchObject({ alreadyExists: true, live: true })

    for (const code of [5, '6', undefined]) {
      createTask.mockRejectedValueOnce(Object.assign(new Error('private'), { code, metadata: { private: true } }))
      const error = await queue.enqueue(input).catch((failure: unknown) => failure)
      expect(error).toMatchObject({ message: 'JERA_ALLOCATION_TASK_FAILED' })
      expect(error).not.toHaveProperty('cause')
      expect(error).not.toHaveProperty('metadata')
    }
  })

  it('distinguishes a live ALREADY_EXISTS task from a deleted-task tombstone', async () => {
    const createTask = vi.fn().mockRejectedValue(Object.assign(new Error('exists'), { code: 6 }))
    const getTask = vi.fn()
      .mockResolvedValueOnce([{}])
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 5 }))
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com', client: fakeClient(createTask, getTask),
    })
    const input = { branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64),
      metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt: 1, scheduleAt: new Date(0) }

    await expect(queue.enqueue(input)).resolves.toMatchObject({ alreadyExists: true, live: true })
    await expect(queue.enqueue(input)).resolves.toMatchObject({ alreadyExists: true, live: false })
    expect(getTask).toHaveBeenCalledTimes(2)
  })

  it('skips tombstoned generations within a hard bound and returns the created task attempt', async () => {
    const enqueue = vi.fn()
      .mockResolvedValueOnce({ taskName: 'tombstone-5', alreadyExists: true, live: false })
      .mockResolvedValueOnce({ taskName: 'tombstone-6', alreadyExists: true, live: false })
      .mockResolvedValueOnce({ taskName: 'live-7', alreadyExists: false, live: true })
    const queue = { enqueue } as JeraAllocationTaskQueuePort

    await expect(enqueueJeraAllocationTaskGeneration(queue, {
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64),
      cursor: 4, previousTaskAttempt: 4, scheduleAt: new Date(0),
    })).resolves.toMatchObject({ taskAttempt: 7, created: true })
    expect(enqueue.mock.calls.map(([input]) => input.attempt)).toEqual([5, 6, 7])
  })

  it('fails closed after the bounded tombstone generation budget is exhausted', async () => {
    const enqueue = vi.fn(async () => ({ taskName: 'tombstone', alreadyExists: true, live: false }))
    const queue = { enqueue } as JeraAllocationTaskQueuePort

    await expect(enqueueJeraAllocationTaskGeneration(queue, {
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64),
      cursor: 4, previousTaskAttempt: 4, scheduleAt: new Date(0),
    })).rejects.toThrow('JERA_ALLOCATION_TASK_GENERATIONS_EXHAUSTED')
    expect(enqueue).toHaveBeenCalledTimes(MAX_JERA_ALLOCATION_ENQUEUE_GENERATIONS)
  })

  it('uses attempt in the task identity so a retry at the same cursor cannot strand behind the current task', async () => {
    const createTask = vi.fn(async () => [{}])
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com', client: fakeClient(createTask),
    })
    const base = { branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64), cursor: 0, scheduleAt: new Date(0) }

    const current = await queue.enqueue({ ...base, attempt: 0 })
    const retry = await queue.enqueue({ ...base, attempt: 1 })
    const replay = await queue.enqueue({ ...base, attempt: 1 })

    expect(retry.taskName).not.toBe(current.taskName)
    expect(replay.taskName).toBe(retry.taskName)
    expect(createTask.mock.calls.map(([request]) => JSON.parse(Buffer.from(request.task!.httpRequest!.body!).toString('utf8')).attempt))
      .toEqual([0, 1, 1])
  })

  it('uses metadata snapshot hash in the task identity and exact worker payload', async () => {
    const createTask = vi.fn(async () => [{}])
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com', client: fakeClient(createTask),
    })
    const base = {
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 0, attempt: 0, scheduleAt: new Date(0),
    }

    const first = await queue.enqueue({ ...base, metadataSnapshotHash: 'b'.repeat(64) })
    const changed = await queue.enqueue({ ...base, metadataSnapshotHash: 'c'.repeat(64) })

    expect(changed.taskName).not.toBe(first.taskName)
    expect(createTask.mock.calls.map(([request]) => JSON.parse(Buffer.from(request.task!.httpRequest!.body!).toString('utf8')).metadataSnapshotHash))
      .toEqual(['b'.repeat(64), 'c'.repeat(64)])
  })

  it.each([-1, 1_000_001, Number.MAX_SAFE_INTEGER])('rejects unsafe attempt %s before Cloud Tasks', async (attempt) => {
    const createTask = vi.fn(async () => [{}])
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com', client: fakeClient(createTask),
    })
    await expect(queue.enqueue({ branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), metadataSnapshotHash: 'b'.repeat(64), cursor: 0, attempt, scheduleAt: new Date(0) }))
      .rejects.toThrow('JERA_ALLOCATION_TASK_FAILED')
    expect(createTask).not.toHaveBeenCalled()
  })
})

function fakeClient(createTask: ReturnType<typeof vi.fn>, getTask: ReturnType<typeof vi.fn> = vi.fn(async () => [{}])): CloudTasksClient {
  return {
    queuePath: (project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`,
    taskPath: (project: string, location: string, queue: string, task: string) => `projects/${project}/locations/${location}/queues/${queue}/tasks/${task}`,
    createTask,
    getTask,
  } as unknown as CloudTasksClient
}
