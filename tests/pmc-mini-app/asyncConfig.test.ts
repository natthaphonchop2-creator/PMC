import { describe, expect, it } from 'vitest'
import { readPmcAsyncBookingConfig } from '../../server/pmc-mini-app/asyncConfig'

describe('PMC Mini App asynchronous booking configuration', () => {
  it('stays disabled unless the async feature flag is exactly true', () => {
    expect(readPmcAsyncBookingConfig({ PMC_MINI_APP_ASYNC_ENABLED: 'false' })).toBeNull()
    expect(readPmcAsyncBookingConfig({})).toBeNull()
    expect(readPmcAsyncBookingConfig({ PMC_MINI_APP_ASYNC_ENABLED: 'yes' })).toBeNull()
  })

  it('returns the fixed async limits for a complete enabled configuration', () => {
    const config = readPmcAsyncBookingConfig(validEnvironment())

    expect(config).toMatchObject({
      enabled: true,
      location: 'asia-southeast1',
      maxBatchBytes: 25_000_000,
      projectId: 'project-2099d92f-51c8-4d2b-a8c',
      ownerStaffIds: new Set(['staff-owner']),
    })
  })

  it('accepts the existing short staff ID format for async owners', () => {
    expect(readPmcAsyncBookingConfig({
      ...validEnvironment(),
      PMC_ASYNC_OWNER_STAFF_IDS: 'staff-1, staff-owner',
    })?.ownerStaffIds).toEqual(new Set(['staff-1', 'staff-owner']))
  })

  it.each([
    ['non-Singapore location', { PMC_ASYNC_LOCATION: 'us-central1' }],
    ['non-HTTPS worker URL', { PMC_ASYNC_WORKER_URL: 'http://pmc-mini-app.example/finalize-booking' }],
    ['credentialed worker audience', { PMC_ASYNC_WORKER_AUDIENCE: 'https://user:password@pmc-mini-app.example' }],
    ['worker URL with a query string', { PMC_ASYNC_WORKER_URL: 'https://pmc-mini-app.example/finalize-booking?token=secret' }],
    ['worker audience with a fragment', { PMC_ASYNC_WORKER_AUDIENCE: 'https://pmc-mini-app.example#secret' }],
    ['invalid task invoker service account', { PMC_ASYNC_TASK_INVOKER_EMAIL: 'task-invoker@example.com' }],
    ['invalid owner staff ID', { PMC_ASYNC_OWNER_STAFF_IDS: 'owner' }],
  ])('fails closed for %s', (_name, patch) => {
    expect(readPmcAsyncBookingConfig({ ...validEnvironment(), ...patch })).toBeNull()
  })
})

function validEnvironment(): Record<string, string> {
  return {
    PMC_MINI_APP_ASYNC_ENABLED: 'true',
    PMC_GCP_PROJECT_ID: 'project-2099d92f-51c8-4d2b-a8c',
    PMC_ASYNC_LOCATION: 'asia-southeast1',
    PMC_ASYNC_BUCKET: 'pmc-mini-app-evidence-staging',
    PMC_ASYNC_QUEUE: 'pmc-booking-finalize',
    PMC_ASYNC_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/finalize-booking',
    PMC_ASYNC_WORKER_AUDIENCE: 'https://pmc-mini-app.example',
    PMC_ASYNC_TASK_INVOKER_EMAIL: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
    PMC_ASYNC_OWNER_STAFF_IDS: 'staff-owner',
  }
}
