import { createHash } from 'node:crypto'
import { CloudTasksClient, protos } from '@google-cloud/tasks'
import { parseExpenseAsyncTaskPayload } from '../../../shared/pmcExpenseAsync.js'

export interface ExpenseTaskQueue {
  enqueue(input: {
    rootRequestId: string
    fingerprint: string
    scheduleAt: Date
  }): Promise<{ taskName: string; alreadyExists: boolean }>
}

export function createGoogleExpenseTaskQueue(input: {
  projectId: string
  location: 'asia-southeast1'
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  client?: CloudTasksClient
}): ExpenseTaskQueue {
  const client = input.client ?? new CloudTasksClient()
  const parent = client.queuePath(input.projectId, input.location, input.queueName)
  return {
    async enqueue(taskInput) {
      const payload = parseExpenseAsyncTaskPayload({
        rootRequestId: taskInput.rootRequestId,
        fingerprint: taskInput.fingerprint,
      })
      const identity = JSON.stringify([payload.rootRequestId, payload.fingerprint])
      const taskId = `expense-${createHash('sha256').update(identity, 'utf8').digest('hex')}`
      const taskName = client.taskPath(input.projectId, input.location, input.queueName, taskId)
      try {
        await client.createTask({
          parent,
          task: {
            name: taskName,
            httpRequest: {
              httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
              url: input.workerUrl,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(JSON.stringify(payload), 'utf8'),
              oidcToken: {
                serviceAccountEmail: input.taskInvokerEmail,
                audience: input.workerAudience,
              },
            },
            scheduleTime: timestamp(taskInput.scheduleAt),
            dispatchDeadline: { seconds: 300 },
          },
        })
        return { taskName, alreadyExists: false }
      } catch (error) {
        if (grpcCode(error) === 6) return { taskName, alreadyExists: true }
        // Provider details are deliberately discarded at this boundary.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('EXPENSE_TASK_QUEUE_FAILED')
      }
    },
  }
}

function timestamp(value: Date): { seconds: number; nanos: number } {
  const milliseconds = value.getTime()
  if (!Number.isFinite(milliseconds)) throw new Error('EXPENSE_TASK_QUEUE_FAILED')
  const seconds = Math.floor(milliseconds / 1_000)
  return { seconds, nanos: Math.round((milliseconds - seconds * 1_000) * 1_000_000) }
}

function grpcCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined
}
