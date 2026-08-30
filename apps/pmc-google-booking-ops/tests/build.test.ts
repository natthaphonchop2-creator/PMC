import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOOKING_INSTALLABLE_TRIGGER_REGISTRY } from '../src/runtime'

describe('Apps Script bundle', () => {
  it('exports every trigger entrypoint as a top-level function', () => {
    execFileSync('npm', ['run', 'booking:build'], { stdio: 'pipe' })
    const bundle = readFileSync('apps/pmc-google-booking-ops/dist/Code.js', 'utf8')
    const sandbox: Record<string, unknown> = {}

    runInNewContext(bundle, sandbox)

    for (const name of [
      'onBookingFormSubmit',
      'onCallResultSubmit',
      'onQueueConfirmationSubmit',
      'doPost',
      'runDailyOperations',
      'pollJeraIncoming',
      'runPmcJeraFileImportManually',
      'runIntegrityChecks',
      'setupPmcBookingSystem',
      'preparePmcStaffAeMigration',
      'preparePmcAutoQueueMigration',
      'applyPmcAutoQueueMigration',
      'configurePmcStaffProfileImages',
      'validatePmcBookingFlexMessages',
      'sendPmcBookingFlexPilot',
      'sendPmcCallReminderFlexPilot',
      'configurePmcCompactFormIdentityFields',
      'configurePmcFacebookNameField',
      'configurePmcQueueModeForms',
      'runPmcBookingRetries',
      'pauseAndCutoverPmcBookingForm',
      'resumePmcBookingFormAfterAeCutover',
      'configurePmcSharedDoctorCalendar',
      'configurePmcStockManagers',
      'migratePmcFinancePermissionColumns',
      'preparePmcExpensePermissions',
      'applyPmcExpensePermissions',
      'setupPmcExpenseFinanceStorage',
      'runPmcExpenseRecovery',
      'previewPmcBookingAttributionMigration',
      'applyPmcBookingAttributionMigration',
      'previewPmcBookingWorkbookPresentation',
      'applyPmcBookingWorkbookPresentation',
    ]) {
      expect(sandbox[name]).toBeTypeOf('function')
    }
    for (const name of [
      'previewPmcBookingWorkbookPresentation',
      'applyPmcBookingWorkbookPresentation',
    ]) {
      expect(bundle.match(new RegExp(`^function ${name}\\(`, 'gm'))).toHaveLength(1)
    }
    expect(sandbox.refreshPmcCalendarPresentation0007).toBeUndefined()
    expect(sandbox.planBookingAttributionMigration).toBeUndefined()
    expect(sandbox.writeGoogleBookingAttributionMigration).toBeUndefined()
    expect(sandbox.createPmcBookingAttributionMigrationRuntime).toBeUndefined()
  })

  it('keeps owner-only presentation entrypoints out of installed form and clock triggers', () => {
    expect(BOOKING_INSTALLABLE_TRIGGER_REGISTRY).toEqual({
      bookingForm: { handler: 'onBookingFormSubmit', kind: 'FORM' },
      callResultForm: { handler: 'onCallResultSubmit', kind: 'FORM' },
      queueConfirmationForm: { handler: 'onQueueConfirmationSubmit', kind: 'FORM' },
      dailyOperations: { handler: 'runDailyOperations', kind: 'CLOCK' },
      integrityChecks: { handler: 'runIntegrityChecks', kind: 'CLOCK' },
    })
    expect(Object.isFrozen(BOOKING_INSTALLABLE_TRIGGER_REGISTRY)).toBe(true)
    expect(Object.values(BOOKING_INSTALLABLE_TRIGGER_REGISTRY).every(Object.isFrozen)).toBe(true)
    const handlers = Object.values(BOOKING_INSTALLABLE_TRIGGER_REGISTRY)
      .map(({ handler }) => handler)
    expect(handlers).not.toContain('previewPmcBookingWorkbookPresentation')
    expect(handlers).not.toContain('applyPmcBookingWorkbookPresentation')

    const sourceRoot = 'apps/pmc-google-booking-ops/src'
    const source = sourceFiles(sourceRoot).map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source.match(/ScriptApp\.newTrigger\(/g)).toHaveLength(2)
    expect(source.match(/ensureFormTrigger\(\s*BOOKING_INSTALLABLE_TRIGGER_REGISTRY\./g))
      .toHaveLength(3)
    expect(source.match(/ensureClockTrigger\(\s*BOOKING_INSTALLABLE_TRIGGER_REGISTRY\./g))
      .toHaveLength(2)
    expect(source).not.toMatch(/ensure(?:Form|Clock)Trigger\(\s*['"]/)
  })

  it('documents the exact owner maintenance, verification, screenshot, and resume order', () => {
    const runbook = readFileSync('apps/pmc-google-booking-ops/docs/pilot-runbook.md', 'utf8')
    const orderedMarkers = [
      '1. Deploy the reviewed Apps Script version.',
      '2. Pause the exact production Booking queue',
      '3. Read and verify `PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST`.',
      '4. Run `previewPmcBookingWorkbookPresentation()` once.',
      '5. Review the complete safe preview:',
      '6. Install the exact reviewed `reviewDigest`',
      '7. Run `applyPmcBookingWorkbookPresentation()` once.',
      '8. Require a safe result',
      '9. Compare the returned source, plan, and review SHA-256 digests',
      '10. At browser zoom 100%, capture privacy-safe 1280×720 screenshots',
      '11. Only after digest/readback verification and all four screenshots are accepted may the owner resume',
    ]
    let cursor = -1
    for (const marker of orderedMarkers) {
      const next = runbook.indexOf(marker)
      expect(next).toBeGreaterThan(cursor)
      cursor = next
    }
    expect(runbook).toContain('Hiding a tab is a convenience for operators and is **not access control**')
    expect(runbook).toContain('do not rerun automatically')
    expect(runbook).toContain('do not claim rollback')
    expect(runbook).toContain('Do not record customer names, phone numbers, evidence images, cell values')

    for (const command of [
      'npm run booking:build',
      'shasum -a 256 apps/pmc-google-booking-ops/dist/Code.js',
      'npx clasp --user <operator-private-clasp-profile> show-authorized-user',
      'npx clasp --user <operator-private-clasp-profile> deployments <operator-private-script-id>',
      'node scripts/check-pmc-booking-attribution-v2.mjs',
      '--expected-stage MIGRATION',
      '--write-attestation <absolute-new-private-0600-attestation-file>',
      '--script-properties-file <absolute-private-0600-preinstall-property-snapshot>',
      '--script-properties-file <absolute-private-0600-installed-property-snapshot>',
      'npx clasp --user <operator-private-clasp-profile> --project <absolute-private-clasp-project-file> run --nondev previewPmcBookingWorkbookPresentation',
      'npx clasp --user <operator-private-clasp-profile> --project <absolute-private-clasp-project-file> run --nondev applyPmcBookingWorkbookPresentation',
    ]) expect(runbook).toContain(command)
    expect(runbook).toContain('The first attestation generation command must not include `--strict`')
    expect(runbook).toContain('`0600`')
    expect(runbook).toContain('ten minutes')
    expect(runbook).toContain('PMC_BOOKING_ATTRIBUTION_QUEUE_ATTESTATION')
    expect(runbook).toContain('PMC_BOOKING_ATTRIBUTION_EXPECTED_QUEUE_DIGEST')
    expect(runbook).toContain('PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST')
    expect(runbook).toContain('PMC_BOOKING_WORKBOOK_PRESENTATION_APPROVED_DIGEST')
    expect(runbook).toContain('actionCount=0')
    expect(runbook).toContain('readbackVerified=true')
    expect(runbook).toContain('ATTEMPTED')
    expect(runbook).toContain('APPLIED')
  })

  it('does not recreate the paused legacy JERA polling trigger', () => {
    const runtime = readFileSync('apps/pmc-google-booking-ops/src/runtime.ts', 'utf8')

    expect(runtime).not.toContain("ensureClockTrigger('pollJeraIncoming'")
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

  it('enables the Sheets v4 advanced metadata service required by guarded migration', () => {
    execFileSync('npm', ['run', 'booking:build'], { stdio: 'pipe' })
    const manifest = JSON.parse(
      readFileSync('apps/pmc-google-booking-ops/dist/appsscript.json', 'utf8'),
    ) as { dependencies?: { enabledAdvancedServices?: Array<Record<string, string>> } }

    const sheetsServices = manifest.dependencies?.enabledAdvancedServices?.filter(
      (service) => service.userSymbol === 'Sheets' || service.serviceId === 'sheets',
    ) ?? []
    expect(sheetsServices).toEqual([{
      userSymbol: 'Sheets', serviceId: 'sheets', version: 'v4',
    }])
    const driveServices = manifest.dependencies?.enabledAdvancedServices?.filter(
      (service) => service.userSymbol === 'Drive' || service.serviceId === 'drive',
    ) ?? []
    expect(driveServices).toEqual([{
      userSymbol: 'Drive', serviceId: 'drive', version: 'v3',
    }])
  })

  it('avoids structuredClone because the Apps Script V8 global is not guaranteed', () => {
    execFileSync('npm', ['run', 'booking:build'], { stdio: 'pipe' })
    const bundle = readFileSync('apps/pmc-google-booking-ops/dist/Code.js', 'utf8')

    expect(bundle).not.toContain('structuredClone(')
  })
})

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else if (path.endsWith('.ts')) files.push(path)
  }
  return files
}
