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
      bookingProtocol: { supported: 2, minimumMutation: 1, prepare: false },
      enrollmentPin: null,
      bookingIngressUrl: 'https://script.google.com/macros/s/deployment/exec',
      fallbackFormUrl: 'https://docs.google.com/forms/d/e/form-id/viewform',
    })
  })

  it('raises the Booking mutation floor only for the exact protocol-2 value', () => {
    expect(readPmcMiniAppConfig({
      ...validEnvironment(),
      PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION: '2',
    })).toMatchObject({
      bookingProtocol: { supported: 2, minimumMutation: 2, prepare: false },
    })
  })

  it('keeps the synchronous configuration unchanged when async booking is disabled', () => {
    expect(readPmcMiniAppConfig(validEnvironment())).toMatchObject({ asyncBooking: null })
  })

  it('keeps Stock disabled by default and parses only exact rollout flags', () => {
    expect(readPmcMiniAppConfig(validEnvironment())).toMatchObject({
      stockEnabled: false,
      stockManagerPilotOnly: false,
    })
    expect(readPmcMiniAppConfig({
      ...validEnvironment(),
      PMC_STOCK_ENABLED: 'true',
      PMC_STOCK_MANAGER_PILOT_ONLY: 'true',
    })).toMatchObject({
      stockEnabled: true,
      stockManagerPilotOnly: true,
    })
  })

  it('keeps finance reports disabled by default and enables them only with an exact flag', () => {
    expect(readPmcMiniAppConfig(validEnvironment())).toMatchObject({ financeReportsEnabled: false })
    expect(readPmcMiniAppConfig({ ...validEnvironment(), PMC_FINANCE_REPORTS_ENABLED: 'true' }))
      .toMatchObject({ financeReportsEnabled: true })
  })

  it('fails closed when enabled async booking configuration is incomplete', () => {
    expect(readPmcMiniAppConfig({
      ...validEnvironment(),
      PMC_MINI_APP_ASYNC_ENABLED: 'true',
    })).toBeNull()
  })

  it('enables first-time account linking only with an exact six-digit secret PIN', () => {
    expect(readPmcMiniAppConfig({
      ...validEnvironment(),
      PMC_MINI_APP_ENROLLMENT_ENABLED: 'true',
      PMC_MINI_APP_ENROLLMENT_PIN: '482731',
    })).toMatchObject({ enrollmentPin: '482731' })

    expect(readPmcMiniAppConfig({
      ...validEnvironment(),
      PMC_MINI_APP_ENROLLMENT_ENABLED: 'true',
    })).toBeNull()
    expect(readPmcMiniAppConfig({
      ...validEnvironment(),
      PMC_MINI_APP_ENROLLMENT_ENABLED: 'true',
      PMC_MINI_APP_ENROLLMENT_PIN: '12345',
    })).toBeNull()
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
    ['unknown Stock enabled value', { PMC_STOCK_ENABLED: 'yes' }],
    ['unknown Stock pilot value', { PMC_STOCK_MANAGER_PILOT_ONLY: 'yes' }],
    ['unknown finance reports value', { PMC_FINANCE_REPORTS_ENABLED: 'yes' }],
    ['unknown Booking protocol floor', { PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION: '3' }],
    ['non-exact Booking protocol floor', { PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION: ' 2 ' }],
    ['blank configured Booking protocol floor', { PMC_BOOKING_PROTOCOL_MINIMUM_MUTATION: '' }],
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
