import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const packageRoot = resolve('apps/pmc-google-booking-ops')
const outputDirectory = resolve(packageRoot, 'dist')

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

await build({
  bundle: true,
  entryPoints: [resolve(packageRoot, 'src/entrypoints.ts')],
  footer: {
    js: `
function onBookingFormSubmit(e) { return PmcBooking.onBookingFormSubmit(e); }
function onCallResultSubmit(e) { return PmcBooking.onCallResultSubmit(e); }
function doPost(e) { return PmcBooking.doPost(e); }
function runDailyOperations() { return PmcBooking.runDailyOperations(); }
function runPmcBookingRetries() { return PmcBooking.runPmcBookingRetries(); }
function pollJeraIncoming() { return PmcBooking.pollJeraIncoming(); }
function runIntegrityChecks() { return PmcBooking.runIntegrityChecks(); }
function setupPmcBookingSystem() { return PmcBooking.setupPmcBookingSystem(); }
function preparePmcStaffAeMigration() { return PmcBooking.preparePmcStaffAeMigration(); }
function configurePmcStaffProfileImages() { return PmcBooking.configurePmcStaffProfileImages(); }
function validatePmcBookingFlexMessages() { return PmcBooking.validatePmcBookingFlexMessages(); }
function sendPmcBookingFlexPilot() { return PmcBooking.sendPmcBookingFlexPilot(); }
function sendPmcCallReminderFlexPilot() { return PmcBooking.sendPmcCallReminderFlexPilot(); }
function configurePmcCompactFormIdentityFields() { return PmcBooking.configurePmcCompactFormIdentityFields(); }
function configurePmcFacebookNameField() { return PmcBooking.configurePmcFacebookNameField(); }
function pauseAndCutoverPmcBookingForm() { return PmcBooking.pauseAndCutoverPmcBookingForm(); }
function resumePmcBookingFormAfterAeCutover() { return PmcBooking.resumePmcBookingFormAfterAeCutover(); }
function configurePmcSharedDoctorCalendar() { return PmcBooking.configurePmcSharedDoctorCalendar(); }
function refreshPmcCalendarPresentation0007() { return PmcBooking.refreshPmcCalendarPresentation0007(); }
`,
  },
  format: 'iife',
  globalName: 'PmcBooking',
  outfile: resolve(outputDirectory, 'Code.js'),
  platform: 'browser',
  target: 'es2020',
})

await copyFile(resolve(packageRoot, 'appsscript.json'), resolve(outputDirectory, 'appsscript.json'))
