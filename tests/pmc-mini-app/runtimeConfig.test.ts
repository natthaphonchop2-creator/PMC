import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('PMC Mini App runtime configuration checker', () => {
  it('reports required names and readiness without exposing configured values', async () => {
    const checker = await import('../../scripts/check-pmc-mini-app-runtime.mjs')
    const environment = validEnvironment()
    const report = checker.inspectMiniAppRuntime(environment)
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({ mode: 'READ_ONLY', ready: true })
    expect(report.secretBindings.present).toContain('PMC_BOOKING_INGRESS_SECRET')
    expect(serialized).not.toContain(environment.PMC_BOOKING_INGRESS_SECRET)
    expect(serialized).not.toContain(environment.PMC_MINI_APP_SIGNING_SECRET)
  })

  it('requires the enrollment PIN binding only when first-time linking is enabled', async () => {
    const checker = await import('../../scripts/check-pmc-mini-app-runtime.mjs')
    const enabled = {
      ...validEnvironment(),
      PMC_MINI_APP_ENROLLMENT_ENABLED: 'true',
      PMC_MINI_APP_ENROLLMENT_PIN: '482731',
    }

    const ready = checker.inspectMiniAppRuntime(enabled)
    const missingPin = checker.inspectMiniAppRuntime({ ...enabled, PMC_MINI_APP_ENROLLMENT_PIN: '' })

    expect(ready).toMatchObject({ ready: true, enrollmentEnabled: true })
    expect(ready.secretBindings.present).toContain('PMC_MINI_APP_ENROLLMENT_PIN')
    expect(JSON.stringify(ready)).not.toContain(enabled.PMC_MINI_APP_ENROLLMENT_PIN)
    expect(missingPin).toMatchObject({ ready: false, enrollmentEnabled: true })
    expect(missingPin.secretBindings.missing).toContain('PMC_MINI_APP_ENROLLMENT_PIN')
  })

  it('runs against an env file and prints valid JSON without secret values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmc-runtime-check-'))
    temporaryDirectories.push(directory)
    const envPath = join(directory, 'runtime.env')
    const environment = validEnvironment()
    await writeFile(envPath, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n'))

    const result = await execute(process.execPath, [resolve('scripts/check-pmc-mini-app-runtime.mjs'), '--env-file', envPath])
    const report = JSON.parse(result.stdout)

    expect(report.ready).toBe(true)
    expect(result.stdout).not.toContain(environment.PMC_BOOKING_INGRESS_SECRET)
    expect(result.stdout).not.toContain(environment.PMC_MINI_APP_SIGNING_SECRET)
  })

  it('reports only async configuration presence, never configured async values', async () => {
    const checker = await import('../../scripts/check-pmc-mini-app-runtime.mjs')
    const environment = { ...validEnvironment(), ...validAsyncEnvironment() }
    const report = checker.inspectMiniAppRuntime(environment)
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({ asyncBookingEnabled: true })
    expect(report.asyncBooking.present).toContain('PMC_ASYNC_TASK_INVOKER_EMAIL')
    for (const [name, value] of Object.entries(validAsyncEnvironment())) {
      if (name !== 'PMC_MINI_APP_ASYNC_ENABLED') expect(serialized).not.toContain(value)
    }
  })

  it('reports Stock rollout flag readiness without exposing configured values', async () => {
    const checker = await import('../../scripts/check-pmc-mini-app-runtime.mjs')
    const environment = {
      ...validEnvironment(),
      PMC_STOCK_ENABLED: 'true',
      PMC_STOCK_MANAGER_PILOT_ONLY: 'true',
    }

    const report = checker.inspectMiniAppRuntime(environment)
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({
      ready: true,
      stockEnabled: true,
      stockManagerPilotOnly: true,
      stockFlags: {
        present: ['PMC_STOCK_ENABLED', 'PMC_STOCK_MANAGER_PILOT_ONLY'],
        missing: [],
      },
    })
    expect(serialized).not.toContain('PMC_STOCK_INGRESS_URL')
    expect(serialized).not.toContain('PMC_STOCK_INGRESS_SECRET')

    expect(checker.inspectMiniAppRuntime({
      ...environment,
      PMC_STOCK_MANAGER_PILOT_ONLY: 'not-a-boolean-private-value',
    })).toMatchObject({ ready: false, stockManagerPilotOnly: false, stockFlagsValid: false })
  })

  it('keeps Render unchanged and documents Cloud Run disabled-first rollout', async () => {
    const [runbook, render] = await Promise.all([
      readFile(resolve('docs/pmc-mini-app/pilot-runbook.md'), 'utf8'),
      readFile(resolve('render.yaml'), 'utf8'),
    ])
    expect(runbook).toContain('PMC_MINI_APP_ENABLED=false')
    expect(runbook).toContain('JERA_API_USERNAME')
    expect(runbook).not.toContain('JERA_API_USERNAME=')
    expect(runbook).toContain('Google Form')
    expect(render).not.toContain('PMC_MINI_APP_')
    expect(render).not.toContain('JERA_API_')
  })
})

function validEnvironment(): Record<string, string> {
  return {
    PMC_MINI_APP_ENABLED: 'true', PMC_MINI_APP_ID: '2001234567-mini-app', PMC_MINI_APP_LIFF_CHANNEL_ID: '2001234567',
    PMC_SPREADSHEET_ID: 'sheet-1', PMC_DRIVE_INTAKE_FOLDER_ID: 'folder-1',
    PMC_BOOKING_INGRESS_URL: 'https://script.google.com/macros/s/deployment/exec',
    PMC_BOOKING_FALLBACK_FORM_URL: 'https://docs.google.com/forms/d/e/form-id/viewform',
    PMC_MINI_APP_ENROLLMENT_ENABLED: 'false',
    PMC_STOCK_ENABLED: 'false', PMC_STOCK_MANAGER_PILOT_ONLY: 'false',
    PMC_BOOKING_INGRESS_SECRET: 'booking-secret-sentinel', PMC_MINI_APP_SIGNING_SECRET: 'signing-secret-sentinel',
  }
}

function validAsyncEnvironment(): Record<string, string> {
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
