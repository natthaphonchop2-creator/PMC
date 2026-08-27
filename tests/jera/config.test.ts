import { describe, expect, it } from 'vitest'
import { readJeraConfig } from '../../server/jera/config'

describe('JERA Production read-only configuration', () => {
  it('requires production base URL and secret bindings only when enabled', () => {
    expect(readJeraConfig({ JERA_REPORTING_ENABLED: 'false' })).toBeNull()
    expect(readJeraConfig({ JERA_REPORTING_ENABLED: 'true' })).toBeNull()
    expect(readJeraConfig(validJeraEnvironment())).toMatchObject({
      baseUrl: 'https://jera.example', syncIntervalMinutes: 15, manualRefreshSeconds: 300,
      scheduler: null,
    })
  })

  it('accepts scheduler OIDC settings only as a complete HTTPS/email pair', () => {
    expect(readJeraConfig({
      ...validJeraEnvironment(),
      JERA_SCHEDULER_AUDIENCE: 'https://pmc-mini-app.example',
      JERA_SCHEDULER_SERVICE_ACCOUNT_EMAIL: 'pmc-scheduler@synthetic-project.iam.gserviceaccount.com',
    })).toMatchObject({
      scheduler: {
        audience: 'https://pmc-mini-app.example',
        serviceAccountEmail: 'pmc-scheduler@synthetic-project.iam.gserviceaccount.com',
      },
    })
    expect(readJeraConfig({ ...validJeraEnvironment(), JERA_SCHEDULER_AUDIENCE: 'https://pmc-mini-app.example' })).toBeNull()
    expect(readJeraConfig({
      ...validJeraEnvironment(),
      JERA_SCHEDULER_AUDIENCE: 'http://unsafe.example',
      JERA_SCHEDULER_SERVICE_ACCOUNT_EMAIL: 'pmc-scheduler@synthetic-project.iam.gserviceaccount.com',
    })).toBeNull()
  })

  it.each([
    ['non-HTTPS base URL', { JERA_API_BASE_URL: 'http://jera.example' }],
    ['embedded URL credentials', { JERA_API_BASE_URL: 'https://user:password@jera.example' }],
    ['unsafe sync interval', { JERA_SYNC_INTERVAL_MINUTES: '1' }],
    ['blank branch UUID', { JERA_DEFAULT_BRANCH_UUID: ' ' }],
    ['unknown JERA environment name', { JERA_WRITE_ENABLED: 'true' }],
  ])('rejects %s', (_name, patch) => {
    expect(readJeraConfig({ ...validJeraEnvironment(), ...patch })).toBeNull()
  })

  it('redacts credentials from string and JSON serialization', () => {
    const config = readJeraConfig(validJeraEnvironment())!
    expect(config.apiUsername.reveal()).toBe('production-user-synthetic')
    expect(config.apiPassword.reveal()).toBe('production-password-synthetic')
    expect(String(config.apiUsername)).toBe('[REDACTED]')
    expect(JSON.stringify(config)).not.toMatch(/production-user-synthetic|production-password-synthetic/)
  })
})

function validJeraEnvironment(): NodeJS.ProcessEnv {
  return {
    JERA_REPORTING_ENABLED: 'true', JERA_API_BASE_URL: 'https://jera.example/',
    JERA_DEFAULT_BRANCH_UUID: '11111111-2222-4333-8444-555555555555', JERA_SYNC_INTERVAL_MINUTES: '15',
    JERA_API_USERNAME: 'production-user-synthetic', JERA_API_PASSWORD: 'production-password-synthetic',
  }
}
