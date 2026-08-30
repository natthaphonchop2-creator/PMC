// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearExpenseResumeRoot,
  loadExpenseResumeRoot,
  saveExpenseResumeRoot,
} from '../../src/apps/pmc-mini-app/expense/expenseResume'

afterEach(() => sessionStorage.clear())

describe('expense WebView resume storage', () => {
  it('persists only one versioned non-sensitive root request identifier', () => {
    saveExpenseResumeRoot(sessionStorage, 'root-request-1')

    expect(loadExpenseResumeRoot(sessionStorage)).toBe('root-request-1')
    const serialized = sessionStorage.getItem('pmc-expense-resume:v1')
    expect(serialized).toBe('{"version":1,"rootRequestId":"root-request-1"}')
    for (const forbidden of [
      'amount', 'category', 'counterparty', 'description', 'file', 'token',
      'receipt', 'privateFileId', 'staffId',
    ]) expect(serialized).not.toContain(forbidden)

    clearExpenseResumeRoot(sessionStorage)
    expect(loadExpenseResumeRoot(sessionStorage)).toBeNull()
  })

  it('fails closed for malformed, extra-keyed, or unavailable storage', () => {
    sessionStorage.setItem('pmc-expense-resume:v1', JSON.stringify({
      version: 1, rootRequestId: 'root-request-1', stagingTokens: ['secret'],
    }))
    expect(loadExpenseResumeRoot(sessionStorage)).toBeNull()
    expect(loadExpenseResumeRoot({ getItem: () => { throw new Error('disabled') } })).toBeNull()
    expect(() => saveExpenseResumeRoot({ setItem: () => { throw new Error('disabled') } }, 'root-request-1')).not.toThrow()
  })
})
