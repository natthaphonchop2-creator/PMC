import { describe, expect, it } from 'vitest'
import { readJeraConfig } from '../../server/jera/config'

describe('JERA Production read-only configuration', () => {
  it('requires production base URL and secret bindings only when enabled', () => {
    expect(readJeraConfig({ JERA_REPORTING_ENABLED: 'false' })).toBeNull()
    expect(readJeraConfig({ JERA_REPORTING_ENABLED: 'true' })).toBeNull()
    expect(readJeraConfig(validJeraEnvironment())).toMatchObject({
      baseUrl: 'https://jera.example', syncIntervalMinutes: 15, manualRefreshSeconds: 300,
      scheduler: null, allocation: null, financeCategoryMoneyEnabled: false,
    })
  })

  it('accepts only the complete fail-closed allocation contract', () => {
    expect(readJeraConfig({ ...validJeraEnvironment(), ...allocationEnvironment() })).toMatchObject({
      allocation: {
        projectId: 'pmc-project', location: 'asia-southeast1', queueName: 'pmc-revenue-allocation',
        workerUrl: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker',
        workerAudience: 'https://pmc-mini-app.example',
        taskInvokerEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com',
        leaseBucket: 'pmc-private-allocation-leases', maxDetailsPerRun: 20, continuationDelaySeconds: 60,
      },
      financeCategoryMoneyEnabled: false,
    })

    for (const name of Object.keys(allocationEnvironment()).filter((name) => name !== 'JERA_FINANCE_CATEGORY_MONEY_ENABLED')) {
      const invalid = { ...validJeraEnvironment(), ...allocationEnvironment() }
      delete invalid[name]
      expect(readJeraConfig(invalid), `missing ${name}`).toBeNull()
    }
  })

  it.each([
    ['wrong location', { JERA_ALLOCATION_LOCATION: 'us-central1' }],
    ['HTTP worker URL', { JERA_ALLOCATION_WORKER_URL: 'http://pmc-mini-app.example/internal/mini-app/jera-allocation-worker' }],
    ['worker URL query', { JERA_ALLOCATION_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker?secret=x' }],
    ['worker audience fragment', { JERA_ALLOCATION_WORKER_AUDIENCE: 'https://pmc-mini-app.example#worker' }],
    ['invalid invoker email', { JERA_ALLOCATION_TASK_INVOKER_EMAIL: 'worker@example.com' }],
    ['invalid lease bucket URL', { JERA_ALLOCATION_LEASE_BUCKET: 'gs://pmc-private-allocation-leases' }],
    ['invalid lease bucket IPv4', { JERA_ALLOCATION_LEASE_BUCKET: '192.168.1.1' }],
  ])('rejects allocation config with %s', (_name, patch) => {
    expect(readJeraConfig({ ...validJeraEnvironment(), ...allocationEnvironment(), ...patch })).toBeNull()
  })

  it('rejects category money while allocation is disabled', () => {
    expect(readJeraConfig({ ...validJeraEnvironment(), JERA_FINANCE_CATEGORY_MONEY_ENABLED: 'true' })).toBeNull()
    expect(readJeraConfig({ ...validJeraEnvironment(), JERA_FINANCE_CATEGORY_MONEY_ENABLED: 'false' }))
      .toMatchObject({ allocation: null, financeCategoryMoneyEnabled: false })
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

function allocationEnvironment(): NodeJS.ProcessEnv {
  return {
    JERA_REVENUE_ALLOCATION_ENABLED: 'true',
    JERA_ALLOCATION_PROJECT_ID: 'pmc-project',
    JERA_ALLOCATION_LOCATION: 'asia-southeast1',
    JERA_ALLOCATION_QUEUE: 'pmc-revenue-allocation',
    JERA_ALLOCATION_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker',
    JERA_ALLOCATION_WORKER_AUDIENCE: 'https://pmc-mini-app.example',
    JERA_ALLOCATION_TASK_INVOKER_EMAIL: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com',
    JERA_ALLOCATION_LEASE_BUCKET: 'pmc-private-allocation-leases',
    JERA_FINANCE_CATEGORY_MONEY_ENABLED: 'false',
  }
}
