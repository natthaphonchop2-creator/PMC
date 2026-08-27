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
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
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

  it('documents disabled-first shadow comparison, audit fields, scheduler gate, and rollback', async () => {
    const runbook = await readFile(resolve('docs/pmc-mini-app/jera-shadow-runbook.md'), 'utf8')
    for (const required of [
      'JERA_REPORTING_ENABLED=false', 'no traffic', 'Secret Manager', 'one-day',
      'JERA count', 'cache total satang', 'Cloud Scheduler', 'owner approval', 'rollback',
    ]) expect(runbook.toLowerCase()).toContain(required.toLowerCase())
    expect(runbook).toContain('ห้ามเก็บข้อมูลผู้ป่วย')
    expect(runbook).not.toMatch(/JERA_API_PASSWORD\s*=\s*\S+/)
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
