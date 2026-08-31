import { execFileSync, spawnSync } from 'node:child_process'
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
      'bootstrapPmcExpenseMonth',
      'bootstrapCurrentPmcExpenseMonth',
      'runPmcExpenseRecovery',
      'previewPmcBookingAttributionMigration',
      'applyPmcBookingAttributionMigration',
      'previewPmcBookingWorkbookPresentation',
      'applyPmcBookingWorkbookPresentation',
      'previewPmcDraftEvidenceRetention',
      'approvePmcDraftEvidenceRetention',
      'executePmcDraftEvidenceRetention',
      'readbackPmcDraftEvidenceRetention',
    ]) {
      expect(sandbox[name]).toBeTypeOf('function')
    }
    for (const name of [
      'previewPmcBookingWorkbookPresentation',
      'applyPmcBookingWorkbookPresentation',
      'previewPmcDraftEvidenceRetention',
      'approvePmcDraftEvidenceRetention',
      'executePmcDraftEvidenceRetention',
      'readbackPmcDraftEvidenceRetention',
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
    expect(handlers).not.toContain('previewPmcDraftEvidenceRetention')
    expect(handlers).not.toContain('approvePmcDraftEvidenceRetention')
    expect(handlers).not.toContain('executePmcDraftEvidenceRetention')
    expect(handlers).not.toContain('readbackPmcDraftEvidenceRetention')

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
    const section = runbook.slice(runbook.indexOf('## Owner-gated Booking workbook presentation maintenance'))
    const orderedMarkers = [
      '1. Deploy the reviewed Apps Script version only through',
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
      const next = section.indexOf(marker)
      expect(next).toBeGreaterThan(cursor)
      cursor = next
    }
    expect(section).toContain('Hiding a tab is a convenience for operators and is **not access control**')
    expect(section).toContain('do not rerun automatically')
    expect(section).toContain('do not claim rollback')
    expect(section).toContain('Do not record customer names, phone numbers, evidence images, cell values')
    expect(section).toContain('set +x')
    expect(section).toContain('set +o history')
    expect(section).toContain('HISTFILE=/dev/null')
    const bashLaunch = section.indexOf('exec /bin/bash --noprofile --norc')
    expect(bashLaunch).toBeGreaterThanOrEqual(0)
    expect(bashLaunch).toBeLessThan(section.indexOf('set +o history'))
    expect(section).toContain('source "$PMC_BOOKING_DEPLOY_ENV_FILE"')
    expect(section).toContain('deploy-workbook-presentation.sh preflight')
    expect(section).toContain('deploy-workbook-presentation.sh approve')
    expect(section).toContain('deploy-workbook-presentation.sh deploy')
    expect(section).toContain('PREFLIGHT_OK')
    expect(section).toContain('APPROVAL_RECORDED')
    expect(section).toContain('DEPLOY_VERIFIED')
    for (const variable of [
      'PMC_OPERATOR_PROJECT', 'PMC_OPERATOR_REGION', 'PMC_OPERATOR_SERVICE',
      'PMC_OPERATOR_QUEUE', 'PMC_OPERATOR_REVISION', 'PMC_OPERATOR_SCRIPT_ID',
      'PMC_OPERATOR_DEPLOYMENT_ID', 'PMC_OPERATOR_MIN_APPS_SCRIPT_VERSION',
      'PMC_OPERATOR_CLASP_PROFILE', 'PMC_OPERATOR_CLASP_PROJECT_FILE',
      'PMC_OPERATOR_PRIVATE_DIR', 'PMC_OPERATOR_PROPERTIES_PREINSTALL',
      'PMC_OPERATOR_PROPERTIES_INSTALLED', 'PMC_OPERATOR_ATTESTATION_FILE',
    ]) expect(section).toContain(`$${variable}`)
    expect(section).toContain('PMC_OPERATOR_EXPECTED_ACCOUNT_EMAIL')
    expect(section).toContain('PMC_OPERATOR_CLASP_VERSION')

    const bashBlocks = [...section.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]!)
    expect(bashBlocks.join('\n')).not.toMatch(/<(?:operator|absolute|reviewed)-[^>]+>/)
    const identityCommands = bashBlocks.flatMap((block) => block.split('\n'))
      .map((line) => line.trim())
      .filter((line) => line.startsWith('gcloud ') || line.startsWith('npx clasp '))
    expect(identityCommands.length).toBeGreaterThan(0)
    for (const command of identityCommands) {
      expect(command).toContain('> "$PMC_OPERATOR_PRIVATE_DIR/')
      expect(command).toContain('2>&1')
    }

    const checkerCommands = bashBlocks.filter((command) =>
      command.includes('node scripts/check-pmc-booking-attribution-v2.mjs'))
    expect(checkerCommands).toHaveLength(2)
    expect(checkerCommands[0]).toContain('--expected-stage PRESENTATION')
    expect(checkerCommands[0]).toContain('--write-attestation "$PMC_OPERATOR_ATTESTATION_FILE"')
    expect(checkerCommands[0]).not.toContain('--strict')
    expect(checkerCommands[1]).toContain('--expected-stage PRESENTATION')
    expect(checkerCommands[1]).toContain('--strict')
    expect(checkerCommands[1]).not.toContain('--write-attestation')
    expect(section).not.toContain('--expected-stage MIGRATION')
    expect(section).toContain('The first PRESENTATION attestation command must not include `--strict`')
    expect(section).toContain('`0600`')
    expect(section).toContain('ten minutes')
    expect(section).toContain('PMC_BOOKING_ATTRIBUTION_QUEUE_ATTESTATION')
    expect(section).toContain('PMC_BOOKING_ATTRIBUTION_EXPECTED_QUEUE_DIGEST')
    expect(section).toContain('PMC_BOOKING_ATTRIBUTION_MIGRATION_MANIFEST')
    expect(section).toContain('PMC_BOOKING_WORKBOOK_PRESENTATION_APPROVED_DIGEST')
    expect(section).toContain('actionCount=0')
    expect(section).toContain('readbackVerified=true')
    expect(section).toContain('ATTEMPTED')
    expect(section).toContain('APPLIED')
  })

  it.each(['/bin/zsh', '/bin/bash'])(
    'launches the private maintenance shell from %s without option errors',
    (sourceShell) => {
      const probe = [
        "exec /bin/bash --noprofile --norc -c '",
        'HISTFILE=/dev/null; export HISTFILE; set +o history; set +x; umask 077; ',
        'PMC_HISTORY_STATE=off; if shopt -qo history; then PMC_HISTORY_STATE=on; fi; ',
        'printf "%s|%s|%s" "$HISTFILE" "$(umask)" "$PMC_HISTORY_STATE"',
        "'",
      ].join('')

      const result = spawnSync(sourceShell, ['-c', probe], { encoding: 'utf8' })

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe('/dev/null|0077|off')
    },
  )

  it('does not recreate the paused legacy JERA polling trigger', () => {
    const runtime = readFileSync('apps/pmc-google-booking-ops/src/runtime.ts', 'utf8')

    expect(runtime).not.toContain("ensureClockTrigger('pollJeraIncoming'")
  })

  it('flushes the new month index before the same-execution bootstrap readback', () => {
    const repository = readFileSync(
      'apps/pmc-google-booking-ops/src/expense/repository.ts',
      'utf8',
    )
    const appendIndex = repository.indexOf("appendRows(master, 'EXPENSE_MONTHLY_INDEX'")
    const flushIndex = repository.indexOf('SpreadsheetApp.flush()', appendIndex)

    expect(appendIndex).toBeGreaterThan(-1)
    expect(flushIndex).toBeGreaterThan(appendIndex)
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
