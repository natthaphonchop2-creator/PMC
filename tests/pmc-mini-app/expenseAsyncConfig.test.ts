import { describe, expect, it } from 'vitest'
import { readPmcExpenseAsyncConfig } from '../../server/pmc-mini-app/finance/asyncConfig'

describe('async expense runtime configuration', () => {
  it('is absent unless explicitly enabled and accepts the exact production-shaped topology', () => {
    expect(readPmcExpenseAsyncConfig({}, null)).toBeNull()
    expect(readPmcExpenseAsyncConfig({ PMC_EXPENSE_ASYNC_ENABLED: 'false' }, 'pmc-booking-finalize'))
      .toBeNull()

    expect(readPmcExpenseAsyncConfig(validEnvironment(), 'pmc-booking-finalize')).toEqual({
      enabled: true,
      projectId: 'project-2099d92f-51c8-4d2b-a8c',
      location: 'asia-southeast1',
      jobBucketName: 'pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c',
      queueName: 'pmc-expense-finalize',
      workerUrl: 'https://pmc-mini-app.example/internal/mini-app/finalize-expense',
      workerAudience: 'https://pmc-mini-app.example',
      taskInvokerEmail: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
      pilotStaffIds: new Set(['ADMIN_03']),
    })
  })

  it.each([
    ['invalid flag', { PMC_EXPENSE_ASYNC_ENABLED: 'yes' }],
    ['missing queue', { PMC_EXPENSE_ASYNC_QUEUE: '' }],
    ['booking queue reuse', { PMC_EXPENSE_ASYNC_QUEUE: 'pmc-booking-finalize' }],
    ['finance staging bucket reuse', { PMC_EXPENSE_ASYNC_JOB_BUCKET: 'pmc-expense-staging' }],
    ['booking staging bucket reuse', { PMC_EXPENSE_ASYNC_JOB_BUCKET: 'pmc-booking-staging' }],
    ['wrong region', { PMC_ASYNC_LOCATION: 'us-central1' }],
    ['wrong worker path', { PMC_EXPENSE_ASYNC_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/finalize-booking' }],
    ['credentialed worker URL', { PMC_EXPENSE_ASYNC_WORKER_URL: 'https://user:pass@pmc-mini-app.example/internal/mini-app/finalize-expense' }],
    ['audience with path', { PMC_EXPENSE_ASYNC_WORKER_AUDIENCE: 'https://pmc-mini-app.example/internal/mini-app/finalize-expense' }],
    ['ordinary invoker', { PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL: 'user@example.com' }],
    ['duplicate pilot', { PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS: 'ADMIN_03,ADMIN_03' }],
    ['empty pilot', { PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS: '' }],
  ])('fails closed for %s', (_name, patch) => {
    expect(readPmcExpenseAsyncConfig({ ...validEnvironment(), ...patch }, 'pmc-booking-finalize'))
      .toBeNull()
  })
})

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PMC_EXPENSE_ASYNC_ENABLED: 'true',
    PMC_GCP_PROJECT_ID: 'project-2099d92f-51c8-4d2b-a8c',
    PMC_ASYNC_LOCATION: 'asia-southeast1',
    PMC_ASYNC_BUCKET: 'pmc-booking-staging',
    PMC_FINANCE_STAGING_BUCKET: 'pmc-expense-staging',
    PMC_EXPENSE_ASYNC_JOB_BUCKET: 'pmc-expense-async-jobs-project-2099d92f-51c8-4d2b-a8c',
    PMC_EXPENSE_ASYNC_QUEUE: 'pmc-expense-finalize',
    PMC_EXPENSE_ASYNC_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/finalize-expense',
    PMC_EXPENSE_ASYNC_WORKER_AUDIENCE: 'https://pmc-mini-app.example',
    PMC_EXPENSE_ASYNC_TASK_INVOKER_EMAIL: 'pmc-mini-app-task-invoker@example.iam.gserviceaccount.com',
    PMC_EXPENSE_ASYNC_PILOT_STAFF_IDS: 'ADMIN_03',
  }
}
