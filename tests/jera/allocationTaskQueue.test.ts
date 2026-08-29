import { protos, type CloudTasksClient } from '@google-cloud/tasks'
import { describe, expect, it, vi } from 'vitest'
import { createGoogleJeraAllocationTaskQueue } from '../../server/jera/allocationTaskQueue'

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
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 0, attempt: 0,
      scheduleAt: new Date('2026-08-29T23:01:00.000Z'),
    })

    const task = createTask.mock.calls[0]![0].task!
    expect(task.httpRequest?.body).toEqual(Buffer.from(JSON.stringify({
      branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 0, attempt: 0,
    })))
    expect(task.httpRequest?.oidcToken).toEqual({
      serviceAccountEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com',
      audience: 'https://pmc-mini-app.example',
    })
    expect(task.httpRequest?.httpMethod).toBe(protos.google.cloud.tasks.v2.HttpMethod.POST)
    expect(task.scheduleTime).toEqual({ seconds: 1_788_044_460, nanos: 0 })
    expect(task.name!.split('/').at(-1)).toMatch(/^finance-allocation-[a-f0-9]{64}$/)
    expect(task.name).not.toMatch(new RegExp(`${BRANCH}|2026-08-29`))
    expect(result).toEqual({ taskName: task.name, alreadyExists: false })
  })

  it('treats only numeric gRPC code 6 as idempotent success and replaces provider failures', async () => {
    const createTask = vi.fn()
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com', client: fakeClient(createTask),
    })
    const input = { branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 0, attempt: 1, scheduleAt: new Date(0) }
    createTask.mockRejectedValueOnce(Object.assign(new Error('private'), { code: 6, metadata: { private: true } }))
    await expect(queue.enqueue(input)).resolves.toMatchObject({ alreadyExists: true })

    for (const code of [5, '6', undefined]) {
      createTask.mockRejectedValueOnce(Object.assign(new Error('private'), { code, metadata: { private: true } }))
      const error = await queue.enqueue(input).catch((failure: unknown) => failure)
      expect(error).toMatchObject({ message: 'JERA_ALLOCATION_TASK_FAILED' })
      expect(error).not.toHaveProperty('cause')
      expect(error).not.toHaveProperty('metadata')
    }
  })

  it('uses attempt in the task identity so a retry at the same cursor cannot strand behind the current task', async () => {
    const createTask = vi.fn(async () => [{}])
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com', client: fakeClient(createTask),
    })
    const base = { branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 0, scheduleAt: new Date(0) }

    const current = await queue.enqueue({ ...base, attempt: 0 })
    const retry = await queue.enqueue({ ...base, attempt: 1 })
    const replay = await queue.enqueue({ ...base, attempt: 1 })

    expect(retry.taskName).not.toBe(current.taskName)
    expect(replay.taskName).toBe(retry.taskName)
    expect(createTask.mock.calls.map(([request]) => JSON.parse(Buffer.from(request.task!.httpRequest!.body!).toString('utf8')).attempt))
      .toEqual([0, 1, 1])
  })

  it.each([-1, 1_000_001, Number.MAX_SAFE_INTEGER])('rejects unsafe attempt %s before Cloud Tasks', async (attempt) => {
    const createTask = vi.fn(async () => [{}])
    const queue = createGoogleJeraAllocationTaskQueue({
      projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker', workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com', client: fakeClient(createTask),
    })
    await expect(queue.enqueue({ branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 0, attempt, scheduleAt: new Date(0) }))
      .rejects.toThrow('JERA_ALLOCATION_TASK_FAILED')
    expect(createTask).not.toHaveBeenCalled()
  })
})

function fakeClient(createTask: ReturnType<typeof vi.fn>): CloudTasksClient {
  return {
    queuePath: (project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`,
    taskPath: (project: string, location: string, queue: string, task: string) => `projects/${project}/locations/${location}/queues/${queue}/tasks/${task}`,
    createTask,
  } as unknown as CloudTasksClient
}
