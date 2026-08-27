import { describe, expect, it } from 'vitest'
import { readPmcMiniAppConfig } from '../../server/pmc-mini-app/config'

describe('PMC Mini App server configuration', () => {
  it('stays disabled when the feature flag is off', () => {
    expect(readPmcMiniAppConfig({ PMC_MINI_APP_ENABLED: 'false' })).toBeNull()
    expect(readPmcMiniAppConfig({})).toBeNull()
  })

  it('fails closed when an enabled service is missing any dependency', () => {
    expect(readPmcMiniAppConfig({ PMC_MINI_APP_ENABLED: 'true' })).toBeNull()
  })

  it('returns only production-safe evidence limits for a complete configuration', () => {
    expect(readPmcMiniAppConfig(validEnvironment())).toMatchObject({
      maxImageBytes: 10_000_000,
      maxFilesPerKind: 10,
      bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
      fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
    })
  })

  it('requires the HTTPS Google Form fallback while the Mini App is in pilot', () => {
    const env = validEnvironment()
    delete env.PMC_BOOKING_FALLBACK_FORM_URL
    expect(readPmcMiniAppConfig(env)).toBeNull()
  })

  it.each([
    ['non-HTTPS ingress', { PMC_BOOKING_INGRESS_URL: 'http://example.test/ingress' }],
    ['blank resource ID', { PMC_SPREADSHEET_ID: '   ' }],
    ['oversized image limit', { PMC_MINI_APP_MAX_IMAGE_BYTES: '10000001' }],
    ['excessive file count', { PMC_MINI_APP_MAX_FILES_PER_KIND: '11' }],
    ['unknown enabled value', { PMC_MINI_APP_ENABLED: 'yes' }],
  ])('rejects %s', (_name, patch) => {
    expect(readPmcMiniAppConfig({ ...validEnvironment(), ...patch })).toBeNull()
  })
})

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PMC_MINI_APP_ENABLED: 'true',
    PMC_MINI_APP_ID: '2001234567-mini-app',
    PMC_MINI_APP_LIFF_CHANNEL_ID: '2001234567',
    PMC_SPREADSHEET_ID: 'spreadsheet-id',
    PMC_DRIVE_INTAKE_FOLDER_ID: 'intake-folder-id',
    PMC_BOOKING_INGRESS_URL: 'https://script.google.com/macros/s/deployment/exec',
    PMC_BOOKING_FALLBACK_FORM_URL: 'https://docs.google.com/forms/d/e/form-id/viewform',
    PMC_BOOKING_INGRESS_SECRET: 'booking-ingress-secret',
    PMC_MINI_APP_SIGNING_SECRET: 'mini-app-signing-secret',
  }
}
