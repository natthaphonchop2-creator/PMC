import { describe, expect, it } from 'vitest'
import { canTransitionAsyncBooking } from '../../server/pmc-mini-app/asyncState'
import type { MiniAppRequestState } from '../../server/pmc-mini-app/store'

describe('asynchronous booking state machine', () => {
  it.each<[MiniAppRequestState, MiniAppRequestState]>([
    ['READY_TO_CONFIRM', 'QUEUED'],
    ['READY_TO_CONFIRM', 'PROCESSING'],
    ['QUEUED', 'PROCESSING'],
    ['PROCESSING', 'RETRYING'],
    ['RETRYING', 'PROCESSING'],
    ['PROCESSING', 'CONFIRMED'],
    ['PROCESSING', 'CONFIRMED_WITH_RETRY'],
    ['PROCESSING', 'NEEDS_REVIEW'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransitionAsyncBooking(from, to)).toBe(true)
  })

  it.each<[MiniAppRequestState, MiniAppRequestState]>([
    ['READY_TO_CONFIRM', 'CONFIRMED'],
    ['QUEUED', 'CONFIRMED'],
    ['RETRYING', 'CONFIRMED'],
    ['PROCESSING', 'QUEUED'],
    ['CANCELLED', 'READY_TO_CONFIRM'],
    ['EXPIRED', 'READY_TO_CONFIRM'],
    ['CONFIRMED', 'PROCESSING'],
    ['CONFIRMED_WITH_RETRY', 'CONFIRMED'],
    ['NEEDS_REVIEW', 'PROCESSING'],
  ])('forbids %s -> %s', (from, to) => {
    expect(canTransitionAsyncBooking(from, to)).toBe(false)
  })
})
