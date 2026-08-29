import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'

const execute = promisify(execFile)

describe('JERA Production read-only runtime gates', () => {
  it('contains no JERA data mutation route and does not bundle environment secrets', async () => {
    const source = await readJeraSources()
    const registrySource = await readFile(resolve('server/jera/contracts.ts'), 'utf8')
    expect(source).not.toMatch(/openapi\/v1\/(?:patient|appointment|clinic|payment)\/[^\n]{0,300}method:\s*['"](?:POST|PATCH|PUT|DELETE)/i)
    expect(registrySource).not.toMatch(/method:\s*['"](?:POST|PATCH|PUT|DELETE)/)

    const sentinel = 'test-jera-secret-do-not-bundle'
    await execute('npm', ['run', 'build:mini-app'], {
      cwd: process.cwd(), env: { ...process.env, JERA_API_PASSWORD: sentinel, JERA_API_USERNAME: sentinel },
    })
    expect(await readTree(resolve('dist/mini-app'))).not.toContain(sentinel)
  }, 30_000)

  it('reports secret binding names and readiness without values', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const environment = validEnvironment()
    const report = checker.inspectJeraRuntime(environment)
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({ mode: 'READ_ONLY', ready: true, reportingEnabled: true })
    expect(report.secretBindings.present).toEqual(expect.arrayContaining(['JERA_API_USERNAME', 'JERA_API_PASSWORD']))
    expect(serialized).not.toContain(environment.JERA_API_USERNAME)
    expect(serialized).not.toContain(environment.JERA_API_PASSWORD)
  })

  it('keeps the clinic branch operator path bounded and free of raw provider metadata', async () => {
    const discovery = await import('../../scripts/discover-clinic-report-branch.mjs')
    const rawBodyMarker = 'private-provider-clinic-payload'
    await expect(discovery.discoverClinicBranches([], { fetch: vi.fn() }))
      .rejects.toThrow('Clinic branch discovery failed')
    await expect(discovery.discoverClinicBranches(
      ['--allow-readonly-production', '--project', 'project-2099d92f-51c8-4d2b-a8c'],
      {
        secretAccessor: {
          accessSecretVersion: vi.fn(async ({ name }: { name: string }) => [{
            payload: {
              data: Buffer.from(name.includes('BASE_URL') ? 'https://jera.example' : name.includes('USERNAME') ? 'synthetic-user' : 'synthetic-password'),
            },
          }]),
        },
        fetch: vi.fn(async (url: string) => String(url).endsWith('/openapi/v1/token/')
          ? jsonResponse(200, { access_token: 'synthetic-read-token', expires_in: 3600, token_type: 'Bearer' })
          : jsonResponse(500, { detail: rawBodyMarker })),
      },
    )).rejects.not.toThrow(rawBodyMarker)
  })

  it('never calls JERA without the explicit production flag and exact one-day range', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const fetch = vi.fn()
    const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } }

    await checker.runJeraRuntimeCheck([], { environment: validEnvironment(), fetch, io })
    expect(fetch).not.toHaveBeenCalled()
    await expect(checker.runJeraRuntimeCheck([
      '--allow-readonly-production', '--report', 'PAYMENT',
      '--start-date', '2026-08-26', '--end-date', '2026-08-27',
    ], { environment: validEnvironment(), fetch, io })).rejects.toThrow('one-day')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('limits an authorized synthetic probe to token POST plus one approved GET and prints no rows', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/openapi/v1/token/')) return jsonResponse(200, {
        access_token: 'synthetic-bearer-token', expires_in: 36_000, token_type: 'Bearer', scope: 'read write',
      })
      return jsonResponse(200, { payment_data: [{ uuid: 'row-1', patient_name: 'must-not-print', paid_amount: '100.00' }], refund_data: [], summary_data: {} })
    })
    let stdout = ''
    await checker.runJeraRuntimeCheck([
      '--allow-readonly-production', '--report', 'PAYMENT',
      '--start-date', '2026-08-27', '--end-date', '2026-08-27',
    ], {
      environment: validEnvironment(), fetch,
      io: { stdout: { write: (value: string) => { stdout += value } }, stderr: { write: () => undefined } },
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
    expect(stdout).toContain('"count": 1')
    expect(stdout).toContain('"totalSatang": 10000')
    expect(stdout).not.toContain('synthetic-bearer-token')
    expect(stdout).not.toContain('must-not-print')
  })

  it('uses redirect-safe requests for both the token POST and one-day provider GET', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const fetch = vi.fn(async (url: string) => String(url).endsWith('/openapi/v1/token/')
      ? jsonResponse(200, { access_token: 'synthetic-bearer-token', expires_in: 3600, token_type: 'Bearer' })
      : jsonResponse(200, { payment_data: [] }))

    await expect(runPaymentProbe(checker, fetch)).resolves.toBe(0)
    expect(fetch.mock.calls.map(([, init]) => init.redirect)).toEqual(['error', 'error'])
  })

  it('cancels a chunked provider response before retaining an overflowing chunk', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const oversized = chunkedResponse([new Uint8Array(2_000_000), new Uint8Array([0])])
    const fetch = vi.fn(async (url: string) => String(url).endsWith('/openapi/v1/token/')
      ? jsonResponse(200, { access_token: 'synthetic-bearer-token', expires_in: 3600, token_type: 'Bearer' })
      : oversized.response)

    await expect(runPaymentProbe(checker, fetch)).rejects.toThrow('JERA runtime probe failed')
    expect(oversized.read).toHaveBeenCalledTimes(2)
    expect(oversized.cancel).toHaveBeenCalledOnce()
    expect(oversized.arrayBuffer).not.toHaveBeenCalled()
  })

  it('rejects an invalid token contract before the provider GET', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const fetch = vi.fn(async () => jsonResponse(200, {
      access_token: 'synthetic-bearer-token', expires_in: 3600, token_type: 'Basic',
    }))

    await expect(runPaymentProbe(checker, fetch)).rejects.toThrow('JERA runtime probe failed')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('retries a scheduled provider 429 using its bounded Retry-After delay', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const sleep = vi.fn(async () => undefined)
    let providerAttempts = 0
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/openapi/v1/token/')) {
        return jsonResponse(200, { access_token: 'synthetic-bearer-token', expires_in: 3600, token_type: 'Bearer' })
      }
      providerAttempts += 1
      return providerAttempts === 1
        ? jsonResponse(429, {}, { 'retry-after': '31' })
        : jsonResponse(200, { payment_data: [] })
    })

    await expect(runPaymentProbe(checker, fetch, { sleep })).resolves.toBe(0)
    expect(sleep).toHaveBeenCalledWith(31_000)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('keeps thrown provider details out of the runtime probe failure', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const rawProviderError = 'private-provider-error-detail'
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/openapi/v1/token/')) {
        return jsonResponse(200, { access_token: 'synthetic-bearer-token', expires_in: 3600, token_type: 'Bearer' })
      }
      throw new Error(rawProviderError)
    })

    try {
      await runPaymentProbe(checker, fetch)
      throw new Error('expected probe failure')
    } catch (error) {
      expect(String(error)).toContain('JERA runtime probe failed')
      expect(String(error)).not.toContain(rawProviderError)
    }
  })

  it('reads all bounded appointment pages rather than reporting only page one', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const appointments = Array.from({ length: 101 }, (_, index) => ({
      uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }))
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/openapi/v1/token/')) {
        return jsonResponse(200, { access_token: 'synthetic-bearer-token', expires_in: 3600, token_type: 'Bearer' })
      }
      const page = new URL(String(url)).searchParams.get('page')
      return page === '1'
        ? jsonResponse(200, { count: 101, next: 'page-2', data: appointments.slice(0, 100) })
        : jsonResponse(200, { count: 101, next: null, data: appointments.slice(100) })
    })
    let stdout = ''

    await checker.runJeraRuntimeCheck([
      '--allow-readonly-production', '--report', 'APPOINTMENT',
      '--start-date', '2026-08-27', '--end-date', '2026-08-27',
    ], {
      environment: validEnvironment(), fetch,
      io: { stdout: { write: (value: string) => { stdout += value } }, stderr: { write: () => undefined } },
    })

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.slice(1).map(([url]) => new URL(String(url)).searchParams.get('page'))).toEqual(['1', '2'])
    expect(stdout).toContain('"count": 101')
  })

  it('counts appointments without stable UUIDs without applying money handling to their raw rows', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const fetch = vi.fn(async (url: string) => String(url).endsWith('/openapi/v1/token/')
      ? jsonResponse(200, { access_token: 'synthetic-bearer-token', expires_in: 3600, token_type: 'Bearer' })
      : jsonResponse(200, { count: 1, next: null, data: [null] }))
    let stdout = ''

    await checker.runJeraRuntimeCheck([
      '--allow-readonly-production', '--report', 'APPOINTMENT',
      '--start-date', '2026-08-27', '--end-date', '2026-08-27',
    ], {
      environment: validEnvironment(), fetch,
      io: { stdout: { write: (value: string) => { stdout += value } }, stderr: { write: () => undefined } },
    })

    expect(stdout).toContain('"count": 1')
    expect(stdout).toContain('"totalSatang": 0')
  })

  it('returns only a scalar aggregate after the maximum bounded appointment page sequence', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const rawProviderMarker = 'raw-appointment-payload-must-not-be-retained'
    const fetch = vi.fn(async (url: string) => {
      const page = Number(new URL(String(url)).searchParams.get('page'))
      const firstRow = (page - 1) * 100
      return jsonResponse(200, {
        count: 100_000,
        data: Array.from({ length: 100 }, (_, index) => ({
          appointment_uuid: appointmentUuid(firstRow + index + 1),
          patient_name: rawProviderMarker,
        })),
      })
    })

    const result = await checker.readAppointments({
      baseUrl: 'https://jera.example', branchUuid: validEnvironment().JERA_DEFAULT_BRANCH_UUID,
      date: '2026-08-27', fetch, token: 'synthetic-read-token',
    })

    expect(fetch).toHaveBeenCalledTimes(1_000)
    expect(result).toEqual({ count: 100_000 })
    expect(JSON.stringify(result)).not.toContain(rawProviderMarker)
  })

  it('rejects a duplicate provider UUID across appointment pages', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ uuid: appointmentUuid(index + 1) }))
    const fetch = vi.fn(async (url: string) => Number(new URL(String(url)).searchParams.get('page')) === 1
      ? jsonResponse(200, { count: 101, next: 'page-2', data: firstPage })
      : jsonResponse(200, { count: 101, next: null, data: [{ uuid: appointmentUuid(1) }] }))

    await expect(checker.readAppointments({
      baseUrl: 'https://jera.example', branchUuid: validEnvironment().JERA_DEFAULT_BRANCH_UUID,
      date: '2026-08-27', fetch, token: 'synthetic-read-token',
    })).rejects.toThrow('JERA appointment pagination is inconsistent')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects non-progressing appointment pagination instead of silently using page one', async () => {
    const checker = await import('../../scripts/check-jera-readonly-runtime.mjs')
    const stableUuid = '00000000-0000-4000-8000-000000000001'
    const fetch = vi.fn(async (url: string) => {
      if (String(url).endsWith('/openapi/v1/token/')) {
        return jsonResponse(200, { access_token: 'synthetic-bearer-token', expires_in: 3600, token_type: 'Bearer' })
      }
      const page = new URL(String(url)).searchParams.get('page')
      return page === '1'
        ? jsonResponse(200, { count: 101, next: 'page-2', data: Array.from({ length: 100 }, () => ({ uuid: stableUuid })) })
        : jsonResponse(200, { count: 101, next: null, data: [{ uuid: stableUuid }] })
    })

    await expect(checker.runJeraRuntimeCheck([
      '--allow-readonly-production', '--report', 'APPOINTMENT',
      '--start-date', '2026-08-27', '--end-date', '2026-08-27',
    ], {
      environment: validEnvironment(), fetch,
      io: { stdout: { write: () => undefined }, stderr: { write: () => undefined } },
    })).rejects.toThrow('JERA runtime probe failed')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('documents disabled-first shadow comparison, audit fields, scheduler gate, and rollback', async () => {
    const runbook = await readFile(resolve('docs/pmc-mini-app/jera-shadow-runbook.md'), 'utf8')
    for (const required of [
      'JERA_REPORTING_ENABLED=false', 'no traffic', 'Secret Manager', 'one-day',
      'JERA count', 'cache total satang', 'Cloud Scheduler', 'owner approval', 'rollback',
    ]) expect(runbook.toLowerCase()).toContain(required.toLowerCase())
    expect(runbook).toContain('discover-clinic-report-branch.mjs')
    expect(runbook).toContain('seed-clinic-report-cache.mjs')
    expect(runbook).toContain('13 source report types')
    expect(runbook).toContain('Scheduler')
    expect(runbook).toContain('owner approval')
    expect(runbook).toContain('ห้ามเก็บข้อมูลผู้ป่วย')
    expect(runbook).not.toMatch(/JERA_API_(?:USERNAME|PASSWORD)\s*=\s*\S+/)
  })
})

async function readJeraSources(): Promise<string> {
  const files = (await readdir(resolve('server/jera'))).filter((name) => name.endsWith('.ts'))
  return (await Promise.all(files.map((name) => readFile(resolve('server/jera', name), 'utf8')))).join('\n')
}

async function readTree(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true })
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? readTree(resolve(root, entry.name))
    : readFile(resolve(root, entry.name), 'utf8')))).join('\n')
}

function validEnvironment(): Record<string, string> {
  return {
    JERA_REPORTING_ENABLED: 'true', JERA_API_BASE_URL: 'https://jera.example',
    JERA_DEFAULT_BRANCH_UUID: '11111111-2222-4333-8444-555555555555', JERA_SYNC_INTERVAL_MINUTES: '15',
    JERA_API_USERNAME: 'synthetic-user-secret', JERA_API_PASSWORD: 'synthetic-password-secret',
  }
}

function appointmentUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function runPaymentProbe(checker: typeof import('../../scripts/check-jera-readonly-runtime.mjs'), fetch: typeof globalThis.fetch, options: { sleep?: (milliseconds: number) => Promise<void> } = {}) {
  return checker.runJeraRuntimeCheck([
    '--allow-readonly-production', '--report', 'PAYMENT',
    '--start-date', '2026-08-27', '--end-date', '2026-08-27',
  ], {
    environment: validEnvironment(), fetch,
    io: { stdout: { write: () => undefined }, stderr: { write: () => undefined } },
    ...options,
  })
}

function chunkedResponse(chunks: Uint8Array[]) {
  let index = 0
  const read = vi.fn(async () => index < chunks.length
    ? { done: false, value: chunks[index++] }
    : { done: true, value: undefined })
  const cancel = vi.fn(async () => undefined)
  const arrayBuffer = vi.fn(async () => { throw new Error('must not buffer stream') })
  return {
    read,
    cancel,
    arrayBuffer,
    response: {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => ({ read, cancel }) },
      arrayBuffer,
    },
  }
}
