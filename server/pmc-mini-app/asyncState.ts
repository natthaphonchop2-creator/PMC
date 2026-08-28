import type { MiniAppRequestState } from './store.js'

const ASYNC_TRANSITIONS: Readonly<Partial<Record<MiniAppRequestState, ReadonlySet<MiniAppRequestState>>>> = {
  READY_TO_CONFIRM: new Set(['QUEUED', 'PROCESSING']),
  QUEUED: new Set(['PROCESSING']),
  PROCESSING: new Set(['RETRYING', 'CONFIRMED', 'CONFIRMED_WITH_RETRY', 'NEEDS_REVIEW']),
  RETRYING: new Set(['PROCESSING']),
}

export function canTransitionAsyncBooking(
  from: MiniAppRequestState,
  to: MiniAppRequestState,
): boolean {
  return ASYNC_TRANSITIONS[from]?.has(to) ?? false
}
