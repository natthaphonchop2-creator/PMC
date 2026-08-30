import { describe, expect, it } from 'vitest'
import type { MiniAppAsyncStateIngressResult } from '../../shared/pmcMiniAppAsyncState'
import {
  validatedQueueFastPath,
  type QueueFastPathBinding,
} from '../../server/pmc-mini-app/queuedProjection'

describe('validatedQueueFastPath', () => {
  it.each([
    ['APPLIED queue', result({ outcome: 'APPLIED', state: 'QUEUED', version: 5, attemptCount: 0 })],
    ['IDEMPOTENT queue', result({ outcome: 'IDEMPOTENT', state: 'QUEUED', version: 5, attemptCount: 0 })],
  ] as const)('accepts an exact %s projection', (_label, ingressResult) => {
    expect(validatedQueueFastPath(binding(), ingressResult)).toEqual({
      requestId: 'request-1',
      draftId: 'draft-1',
      payloadHash: 'payload-hash',
      taskName: 'tasks/request-1',
      state: ingressResult.state,
      version: ingressResult.version,
      attemptCount: ingressResult.attemptCount,
      caseId: null,
      confirmationStatus: null,
    })
  })

  it.each([
    ['APPLIED processing', result({ outcome: 'APPLIED', state: 'PROCESSING', version: 6, attemptCount: 1 })],
    ['APPLIED queue wrong version', result({ outcome: 'APPLIED', state: 'QUEUED', version: 6, attemptCount: 0 })],
    ['APPLIED queue wrong attempt', result({ outcome: 'APPLIED', state: 'QUEUED', version: 5, attemptCount: 1 })],
    ['IDEMPOTENT queue wrong version', result({ outcome: 'IDEMPOTENT', state: 'QUEUED', version: 4, attemptCount: 0 })],
    ['IDEMPOTENT processing', result({ outcome: 'IDEMPOTENT', state: 'PROCESSING', version: 6, attemptCount: 1 })],
    ['IDEMPOTENT retrying', result({ outcome: 'IDEMPOTENT', state: 'RETRYING', version: 9, attemptCount: 4 })],
    ['IDEMPOTENT processing old version', result({ outcome: 'IDEMPOTENT', state: 'PROCESSING', version: 5, attemptCount: 1 })],
    ['IDEMPOTENT processing unchanged attempt', result({ outcome: 'IDEMPOTENT', state: 'PROCESSING', version: 6, attemptCount: 0 })],
    ['IDEMPOTENT retry beyond worker limit', result({ outcome: 'IDEMPOTENT', state: 'RETRYING', version: 14, attemptCount: 9 })],
    ['BUSY', result({ outcome: 'BUSY', state: 'PROCESSING', version: 6, attemptCount: 1 })],
    ['wrong request ID', result({ requestId: 'request-2', outcome: 'APPLIED', state: 'QUEUED', version: 5, attemptCount: 0 })],
    ['wrong draft ID', result({ draftId: 'draft-2', outcome: 'APPLIED', state: 'QUEUED', version: 5, attemptCount: 0 })],
    ['nonterminal Case ID', result({ outcome: 'APPLIED', state: 'QUEUED', version: 5, attemptCount: 0, caseId: 'PMC-202608-0001' })],
    ['nonterminal status', result({ outcome: 'APPLIED', state: 'QUEUED', version: 5, attemptCount: 0, confirmationStatus: 'CONFIRMED' })],
  ] as const)('rejects %s', (_label, ingressResult) => {
    expect(validatedQueueFastPath(binding(), ingressResult)).toBeNull()
  })

  it.each([
    ['missing payload binding', { payloadHash: '' }],
    ['malformed task binding', { taskName: 'bad task name' }],
    ['invalid base version', { baseVersion: 0 }],
    ['invalid base attempt', { baseAttempt: -1 }],
  ] as const)('rejects an exact result with %s', (_label, patch) => {
    expect(validatedQueueFastPath(
      binding(patch),
      result({ outcome: 'APPLIED', state: 'QUEUED', version: 5, attemptCount: 0 }),
    )).toBeNull()
  })

  it.each([
    ['CONFIRMED', result({ outcome: 'TERMINAL', state: 'CONFIRMED', version: 7, attemptCount: 1, caseId: 'PMC-202608-0001', confirmationStatus: 'CONFIRMED' })],
    ['CONFIRMED_WITH_RETRY', result({ outcome: 'TERMINAL', state: 'CONFIRMED_WITH_RETRY', version: 8, attemptCount: 1, caseId: 'PMC-202608-0001', confirmationStatus: 'TENTATIVE' })],
    ['NEEDS_REVIEW', result({ outcome: 'TERMINAL', state: 'NEEDS_REVIEW', version: 7, attemptCount: 1 })],
    ['CANCELLED', result({ outcome: 'TERMINAL', state: 'CANCELLED', version: 5, attemptCount: 0 })],
    ['EXPIRED', result({ outcome: 'TERMINAL', state: 'EXPIRED', version: 5, attemptCount: 0 })],
  ] as const)('requires an authoritative reread for coherent terminal %s', (_label, ingressResult) => {
    expect(validatedQueueFastPath(binding(), ingressResult)).toBeNull()
  })

  it.each([
    ['terminal outcome on a live state', result({ outcome: 'TERMINAL', state: 'QUEUED', version: 5, attemptCount: 0 })],
    ['confirmed without Case ID', result({ outcome: 'TERMINAL', state: 'CONFIRMED', version: 7, attemptCount: 1, confirmationStatus: 'CONFIRMED' })],
    ['confirmed without status', result({ outcome: 'TERMINAL', state: 'CONFIRMED', version: 7, attemptCount: 1, caseId: 'PMC-202608-0001' })],
    ['review with Case ID', result({ outcome: 'TERMINAL', state: 'NEEDS_REVIEW', version: 7, attemptCount: 1, caseId: 'PMC-202608-0001' })],
    ['cancel with worker attempt', result({ outcome: 'TERMINAL', state: 'CANCELLED', version: 5, attemptCount: 1 })],
    ['terminal before the base version advances', result({ outcome: 'TERMINAL', state: 'EXPIRED', version: 4, attemptCount: 0 })],
  ] as const)('rejects an incoherent %s', (_label, ingressResult) => {
    expect(validatedQueueFastPath(binding(), ingressResult)).toBeNull()
  })
})

function binding(patch: Partial<QueueFastPathBinding> = {}): QueueFastPathBinding {
  return {
    requestId: 'request-1', draftId: 'draft-1', payloadHash: 'payload-hash', taskName: 'tasks/request-1',
    baseVersion: 4, baseAttempt: 0, ...patch,
  }
}

function result(patch: Partial<MiniAppAsyncStateIngressResult>): MiniAppAsyncStateIngressResult {
  return {
    requestId: 'request-1', draftId: 'draft-1', state: 'QUEUED', version: 5, attemptCount: 0,
    caseId: null, confirmationStatus: null, outcome: 'APPLIED', ...patch,
  }
}
