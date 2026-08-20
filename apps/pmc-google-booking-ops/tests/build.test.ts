import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('Apps Script bundle', () => {
  it('exports every trigger entrypoint as a top-level function', () => {
    execFileSync('npm', ['run', 'booking:build'], { stdio: 'pipe' })
    const bundle = readFileSync('apps/pmc-google-booking-ops/dist/Code.js', 'utf8')
    const sandbox: Record<string, unknown> = {}

    runInNewContext(bundle, sandbox)

    for (const name of [
      'onBookingFormSubmit',
      'onCallResultSubmit',
      'doPost',
      'runDailyOperations',
      'pollJeraIncoming',
      'runIntegrityChecks',
      'setupPmcBookingSystem',
    ]) {
      expect(sandbox[name]).toBeTypeOf('function')
    }

    expect(() => (sandbox.onBookingFormSubmit as (event: unknown) => unknown)({})).toThrow(
      'PMC booking runtime is not configured',
    )
  })
})
