import { createHash } from 'node:crypto'
import { CloudTasksClient, protos } from '@google-cloud/tasks'

export interface JeraAllocationTaskQueuePort {
  enqueue(input: {
    branchUuid: string
    eventDate: string
    paymentSetHash: string
    cursor: number
    scheduleAt: Date
  }): Promise<{ taskName: string; alreadyExists: boolean }>
}

export function createGoogleJeraAllocationTaskQueue(input: {
  projectId: string
  location: 'asia-southeast1'
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  client?: CloudTasksClient
}): JeraAllocationTaskQueuePort {
  const client = input.client ?? new CloudTasksClient()
  const parent = client.queuePath(input.projectId, input.location, input.queueName)
  return {
    async enqueue(taskInput) {
      validate(taskInput)
      const tuple = JSON.stringify([taskInput.branchUuid, taskInput.eventDate, taskInput.paymentSetHash, taskInput.cursor])
      const taskId = `finance-allocation-${createHash('sha256').update(tuple).digest('hex')}`
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
              body: Buffer.from(JSON.stringify({
                branchUuid: taskInput.branchUuid, eventDate: taskInput.eventDate,
                paymentSetHash: taskInput.paymentSetHash, cursor: taskInput.cursor,
              })),
              oidcToken: { serviceAccountEmail: input.taskInvokerEmail, audience: input.workerAudience },
            },
            scheduleTime: timestamp(taskInput.scheduleAt),
            dispatchDeadline: { seconds: 300 },
          },
        })
        return { taskName, alreadyExists: false }
      } catch (error) {
        if (grpcCode(error) === 6) return { taskName, alreadyExists: true }
        throw new Error('JERA_ALLOCATION_TASK_FAILED')
      }
    },
  }
}

function validate(input: { branchUuid: string; eventDate: string; paymentSetHash: string; cursor: number; scheduleAt: Date }): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.branchUuid)
    || !isoDate(input.eventDate) || !/^[a-f0-9]{64}$/.test(input.paymentSetHash)
    || !Number.isSafeInteger(input.cursor) || input.cursor < 0 || !Number.isFinite(input.scheduleAt.getTime())) {
    throw new Error('JERA_ALLOCATION_TASK_FAILED')
  }
}

function isoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function timestamp(value: Date): { seconds: number; nanos: number } {
  const milliseconds = value.getTime()
  const seconds = Math.floor(milliseconds / 1_000)
  return { seconds, nanos: Math.round((milliseconds - seconds * 1_000) * 1_000_000) }
}

function grpcCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined
}
