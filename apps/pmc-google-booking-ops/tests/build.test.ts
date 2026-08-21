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
      'preparePmcStaffAeMigration',
      'configurePmcStaffProfileImages',
      'validatePmcBookingFlexMessages',
      'pauseAndCutoverPmcBookingForm',
      'resumePmcBookingFormAfterAeCutover',
    ]) {
      expect(sandbox[name]).toBeTypeOf('function')
    }
  })

  it('declares the HMAC-protected LINE ingress as a deployable web app', () => {
    execFileSync('npm', ['run', 'booking:build'], { stdio: 'pipe' })
    const manifest = JSON.parse(
      readFileSync('apps/pmc-google-booking-ops/dist/appsscript.json', 'utf8'),
    ) as { webapp?: { access?: string; executeAs?: string } }

    expect(manifest.webapp).toEqual({
      access: 'ANYONE_ANONYMOUS',
      executeAs: 'USER_DEPLOYING',
    })
  })

  it('avoids structuredClone because the Apps Script V8 global is not guaranteed', () => {
    execFileSync('npm', ['run', 'booking:build'], { stdio: 'pipe' })
    const bundle = readFileSync('apps/pmc-google-booking-ops/dist/Code.js', 'utf8')

    expect(bundle).not.toContain('structuredClone(')
  })
})
