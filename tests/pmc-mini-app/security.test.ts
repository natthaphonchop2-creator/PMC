import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { readPmcMiniAppConfig } from '../../server/pmc-mini-app/config'

const sentinel = 'test-mini-app-secret-do-not-bundle'
const previousSecret = process.env.PMC_BOOKING_INGRESS_SECRET

beforeAll(async () => {
  process.env.PMC_BOOKING_INGRESS_SECRET = sentinel
  await build({ configFile: resolve('vite.mini-app.config.ts'), logLevel: 'silent' })
})

afterAll(() => {
  if (previousSecret === undefined) delete process.env.PMC_BOOKING_INGRESS_SECRET
  else process.env.PMC_BOOKING_INGRESS_SECRET = previousSecret
})

describe('PMC Mini App security regression', () => {
  it('keeps server secrets and secret environment names out of browser assets', async () => {
    const assets = await readTree(resolve('dist/mini-app'))
    expect(assets).not.toContain(sentinel)
    expect(assets).not.toContain('PMC_BOOKING_INGRESS_SECRET')
    expect(assets).not.toContain('PMC_MINI_APP_SIGNING_SECRET')
    expect(assets).not.toContain('PMC-PREVIEW-0001')
    expect(assets).not.toContain('staff-preview')
  })

  it('requires HTTPS ingress and fallback URLs before constructing production dependencies', () => {
    const valid = validEnvironment()
    expect(readPmcMiniAppConfig(valid)).not.toBeNull()
    expect(readPmcMiniAppConfig({ ...valid, PMC_BOOKING_INGRESS_URL: 'http://unsafe.test' })).toBeNull()
    expect(readPmcMiniAppConfig({ ...valid, PMC_BOOKING_FALLBACK_FORM_URL: 'http://unsafe.test' })).toBeNull()
  })

  it('contains no PII console logging or raw HTML injection in Mini App source', async () => {
    const serverSource = await readTree(resolve('server/pmc-mini-app'))
    const clientSource = await readTree(resolve('src/apps/pmc-mini-app'))
    const source = `${serverSource}\n${clientSource}`
    expect(source).not.toMatch(/console\.(?:log|warn|error)/)
    expect(source).not.toContain('dangerouslySetInnerHTML')
    expect(source).not.toMatch(/\.innerHTML\s*=/)
  })
})

async function readTree(path: string): Promise<string> {
  const entries = await readdir(path, { withFileTypes: true })
  const contents: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) contents.push(await readTree(child))
    else contents.push((await readFile(child)).toString('utf8'))
  }
  return contents.join('\n')
}

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PMC_MINI_APP_ENABLED: 'true', PMC_MINI_APP_ID: '2001234567-mini-app', PMC_MINI_APP_LIFF_CHANNEL_ID: '2001234567',
    PMC_SPREADSHEET_ID: 'sheet-1', PMC_DRIVE_INTAKE_FOLDER_ID: 'folder-1',
    PMC_BOOKING_INGRESS_URL: 'https://script.google.com/macros/s/deployment/exec',
    PMC_BOOKING_FALLBACK_FORM_URL: 'https://docs.google.com/forms/d/e/form-id/viewform',
    PMC_BOOKING_INGRESS_SECRET: 'ingress-secret', PMC_MINI_APP_SIGNING_SECRET: 'signing-secret',
  }
}
