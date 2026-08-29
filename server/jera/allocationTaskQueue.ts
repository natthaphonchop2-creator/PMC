import { createHash } from 'node:crypto'
import { CloudTasksClient, protos } from '@google-cloud/tasks'

export const MAX_JERA_ALLOCATION_ATTEMPT = 1_000_000
export const MAX_JERA_ALLOCATION_ENQUEUE_GENERATIONS = 8

export interface JeraAllocationTaskQueuePort {
  enqueue(input: {
    branchUuid: string
    eventDate: string
    paymentSetHash: string
    metadataSnapshotHash: string
    cursor: number
    attempt: number
    scheduleAt: Date
  }): Promise<{ taskName: string; alreadyExists: boolean; live: boolean }>
}

export async function enqueueJeraAllocationTaskGeneration(
  queue: JeraAllocationTaskQueuePort,
  input: {
    branchUuid: string
    eventDate: string
    paymentSetHash: string
    metadataSnapshotHash: string
    cursor: number
    previousTaskAttempt: number
    scheduleAt: Date
  },
): Promise<{ taskName: string; taskAttempt: number; created: boolean }> {
  if (!Number.isSafeInteger(input.previousTaskAttempt) || input.previousTaskAttempt < -1
    || input.previousTaskAttempt >= MAX_JERA_ALLOCATION_ATTEMPT) throw safeTaskFailure()
  for (let offset = 1; offset <= MAX_JERA_ALLOCATION_ENQUEUE_GENERATIONS; offset += 1) {
    const taskAttempt = input.previousTaskAttempt + offset
    if (taskAttempt > MAX_JERA_ALLOCATION_ATTEMPT) break
    const result = await queue.enqueue({
      branchUuid: input.branchUuid,
      eventDate: input.eventDate,
      paymentSetHash: input.paymentSetHash,
      metadataSnapshotHash: input.metadataSnapshotHash,
      cursor: input.cursor,
      attempt: taskAttempt,
      scheduleAt: input.scheduleAt,
    })
    if (!result.alreadyExists || result.live) {
      return { taskName: result.taskName, taskAttempt, created: !result.alreadyExists }
    }
  }
  throw new Error('JERA_ALLOCATION_TASK_GENERATIONS_EXHAUSTED')
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
      const tuple = JSON.stringify([
        taskInput.branchUuid, taskInput.eventDate, taskInput.paymentSetHash,
        taskInput.metadataSnapshotHash, taskInput.cursor, taskInput.attempt,
      ])
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
                paymentSetHash: taskInput.paymentSetHash, metadataSnapshotHash: taskInput.metadataSnapshotHash,
                cursor: taskInput.cursor, attempt: taskInput.attempt,
              })),
              oidcToken: { serviceAccountEmail: input.taskInvokerEmail, audience: input.workerAudience },
            },
            scheduleTime: timestamp(taskInput.scheduleAt),
            dispatchDeadline: { seconds: 300 },
          },
        })
        return { taskName, alreadyExists: false, live: true }
      } catch (error) {
        if (grpcCode(error) === 6) {
          try {
            await client.getTask({ name: taskName })
            return { taskName, alreadyExists: true, live: true }
          } catch (lookupError) {
            if (grpcCode(lookupError) === 5) return { taskName, alreadyExists: true, live: false }
            throw safeTaskFailure()
          }
        }
        throw safeTaskFailure()
      }
    },
  }
}

// Cloud Tasks provider failures are deliberately replaced so response bodies and metadata cannot escape this boundary.
function safeTaskFailure(): Error { return new Error('JERA_ALLOCATION_TASK_FAILED') }

function validate(input: {
  branchUuid: string; eventDate: string; paymentSetHash: string; metadataSnapshotHash: string
  cursor: number; attempt: number; scheduleAt: Date
}): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.branchUuid)
    || !isoDate(input.eventDate) || !/^[a-f0-9]{64}$/.test(input.paymentSetHash)
    || !/^[a-f0-9]{64}$/.test(input.metadataSnapshotHash)
    || !Number.isSafeInteger(input.cursor) || input.cursor < 0
    || !Number.isSafeInteger(input.attempt) || input.attempt < 0 || input.attempt > MAX_JERA_ALLOCATION_ATTEMPT
    || !Number.isFinite(input.scheduleAt.getTime())) {
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
