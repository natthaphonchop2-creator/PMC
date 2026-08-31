import type { MiniAppAsyncStateIngressResult } from '../../shared/pmcMiniAppAsyncState.js'

export interface QueueFastPathBinding {
  requestId: string
  draftId: string
  payloadHash: string
  taskName: string
  baseVersion: number
  baseAttempt: number
}

export interface SafeQueueProjection {
  requestId: string
  draftId: string
  payloadHash: string
  taskName: string
  state: 'QUEUED'
  version: number
  attemptCount: number
  caseId: null
  confirmationStatus: null
}

export function validatedQueueFastPath(
  binding: QueueFastPathBinding,
  result: MiniAppAsyncStateIngressResult,
): SafeQueueProjection | null {
  if (!validBinding(binding)) return null
  if (result.requestId !== binding.requestId || result.draftId !== binding.draftId) return null

  const noTerminalFields = result.caseId === null && result.confirmationStatus === null
  if (result.outcome !== 'APPLIED' && result.outcome !== 'IDEMPOTENT') return null
  if (result.state !== 'QUEUED' || result.version !== binding.baseVersion + 1
    || result.attemptCount !== binding.baseAttempt || !noTerminalFields) return null
  return safeProjection(binding, result)
}

function validBinding(binding: QueueFastPathBinding): boolean {
  return /^[A-Za-z0-9._:-]{1,124}$/.test(binding.requestId)
    && /^[A-Za-z0-9._:-]{1,124}$/.test(binding.draftId)
    && /^[A-Za-z0-9_-]{4,128}$/.test(binding.payloadHash)
    && /^[A-Za-z0-9._:/-]{1,512}$/.test(binding.taskName)
    && Number.isSafeInteger(binding.baseVersion) && binding.baseVersion >= 1
    && Number.isSafeInteger(binding.baseAttempt) && binding.baseAttempt >= 0
}

function safeProjection(
  binding: QueueFastPathBinding,
  result: MiniAppAsyncStateIngressResult,
): SafeQueueProjection {
  return {
    requestId: binding.requestId,
    draftId: binding.draftId,
    payloadHash: binding.payloadHash,
    taskName: binding.taskName,
    state: 'QUEUED',
    version: result.version,
    attemptCount: result.attemptCount,
    caseId: null,
    confirmationStatus: null,
  }
}
