import type {
  MiniAppAsyncConfirmationStatus,
  MiniAppAsyncRequestState,
  MiniAppAsyncStateIngressResult,
} from '../../shared/pmcMiniAppAsyncState.js'

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
  state: MiniAppAsyncRequestState
  version: number
  attemptCount: number
  caseId: string | null
  confirmationStatus: MiniAppAsyncConfirmationStatus | null
}

const LIVE_IDEMPOTENT_STATES = new Set<MiniAppAsyncRequestState>(['PROCESSING', 'RETRYING'])
const CONFIRMED_STATES = new Set<MiniAppAsyncRequestState>(['CONFIRMED', 'CONFIRMED_WITH_RETRY'])
const EMPTY_TERMINAL_STATES = new Set<MiniAppAsyncRequestState>(['NEEDS_REVIEW', 'CANCELLED', 'EXPIRED'])

export function validatedQueueFastPath(
  binding: QueueFastPathBinding,
  result: MiniAppAsyncStateIngressResult,
): SafeQueueProjection | null {
  if (!validBinding(binding)) return null
  if (result.requestId !== binding.requestId || result.draftId !== binding.draftId) return null

  const noTerminalFields = result.caseId === null && result.confirmationStatus === null
  if (result.outcome === 'APPLIED') {
    if (result.state !== 'QUEUED' || result.version !== binding.baseVersion + 1
      || result.attemptCount !== binding.baseAttempt || !noTerminalFields) return null
    return safeProjection(binding, result)
  }

  if (result.outcome === 'IDEMPOTENT') {
    const exactQueue = result.state === 'QUEUED' && result.version === binding.baseVersion + 1
      && result.attemptCount === binding.baseAttempt
    const liveWorker = LIVE_IDEMPOTENT_STATES.has(result.state) && result.version >= binding.baseVersion + 2
      && result.attemptCount >= binding.baseAttempt + 1 && result.attemptCount <= 8
    if ((!exactQueue && !liveWorker) || !noTerminalFields) return null
    return safeProjection(binding, result)
  }

  if (result.outcome !== 'TERMINAL' || result.version < binding.baseVersion + 1) return null
  if (CONFIRMED_STATES.has(result.state)) {
    if (!validCaseId(result.caseId) || !validConfirmationStatus(result.confirmationStatus)
      || result.attemptCount < binding.baseAttempt + 1 || result.attemptCount > 8) return null
    return safeProjection(binding, result)
  }
  if (!EMPTY_TERMINAL_STATES.has(result.state) || !noTerminalFields) return null
  if ((result.state === 'CANCELLED' || result.state === 'EXPIRED')
    && result.attemptCount !== binding.baseAttempt) return null
  if (result.state === 'NEEDS_REVIEW'
    && (result.attemptCount < binding.baseAttempt || result.attemptCount > 8)) return null
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
    state: result.state,
    version: result.version,
    attemptCount: result.attemptCount,
    caseId: result.caseId,
    confirmationStatus: result.confirmationStatus,
  }
}

function validCaseId(value: unknown): value is string {
  return typeof value === 'string' && /^PMC-\d{6}-\d{4,}$/.test(value)
}

function validConfirmationStatus(value: unknown): value is MiniAppAsyncConfirmationStatus {
  return value === 'CONFIRMED' || value === 'TENTATIVE' || value === 'AWAITING_ADMIN_SLOT'
}
