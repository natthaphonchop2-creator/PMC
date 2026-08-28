import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ server: undefined as unknown }))

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    createServer(requestListener: Parameters<typeof actual.createServer>[0]) {
      const server = actual.createServer(requestListener)
      captured.server = server
      return server
    },
  }
})

let originalCwd = ''
let fixtureRoot = ''
let server: Server | undefined
let port = 0
let originalEnvironment: Record<string, string | undefined> = {}

beforeEach(async () => {
  originalCwd = process.cwd()
  originalEnvironment = {
    PORT: process.env.PORT,
    APP_BASIC_AUTH_USER: process.env.APP_BASIC_AUTH_USER,
    APP_BASIC_AUTH_PASSWORD: process.env.APP_BASIC_AUTH_PASSWORD,
    APP_ALLOW_UNAUTHENTICATED: process.env.APP_ALLOW_UNAUTHENTICATED,
  }
  fixtureRoot = await mkdtemp(join(tmpdir(), 'pmc-production-legal-'))
  await mkdir(join(fixtureRoot, 'dist', 'legal'), { recursive: true })
  await writeFile(join(fixtureRoot, 'dist', 'index.html'), '<main>private main app</main>')
  await writeFile(join(fixtureRoot, 'dist', 'legal', 'privacy-policy.html'), '<main>privacy policy</main>')
  await writeFile(join(fixtureRoot, 'dist', 'legal', 'data-deletion.html'), '<main>data deletion</main>')
  await writeFile(join(fixtureRoot, 'dist', 'legal', 'terms.html'), '<main>terms</main>')

  process.chdir(fixtureRoot)
  process.env.PORT = '0'
  process.env.APP_BASIC_AUTH_USER = 'pmc'
  process.env.APP_BASIC_AUTH_PASSWORD = 'legacy-secret'
  process.env.APP_ALLOW_UNAUTHENTICATED = 'false'
  captured.server = undefined
  await import('../server/productionServer')

  server = captured.server as Server | undefined
  if (!server) throw new Error('Production server did not start')
  if (!server.listening) await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()))
  process.chdir(originalCwd)
  await rm(fixtureRoot, { recursive: true, force: true })
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  vi.resetModules()
})

describe('production legal pages', () => {
  it('serves only the exact legal information pages without Basic Auth', async () => {
    const privacy = await request('/privacy-policy?locale=th')
    const deletion = await request('/data-deletion')
    const terms = await request('/terms')
    const privacyHead = await request('/privacy-policy', { method: 'HEAD' })
    const privacyWrite = await request('/privacy-policy', { method: 'POST' })
    const lookalike = await request('/privacy-policy-draft')
    const mainApp = await request('/')

    expect({ status: privacy.status, body: await privacy.text() }).toEqual({
      status: 200, body: '<main>privacy policy</main>',
    })
    expect({ status: deletion.status, body: await deletion.text() }).toEqual({
      status: 200, body: '<main>data deletion</main>',
    })
    expect({ status: terms.status, body: await terms.text() }).toEqual({
      status: 200, body: '<main>terms</main>',
    })
    expect(privacy.headers.get('www-authenticate')).toBeNull()
    expect(privacy.headers.get('cache-control')).toBe('no-cache')
    expect({ status: privacyHead.status, body: await privacyHead.text() }).toEqual({ status: 200, body: '' })
    expect(privacyWrite.status).toBe(405)
    expect(lookalike.status).toBe(401)
    expect(mainApp.status).toBe(401)
  })
})

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, init)
}
