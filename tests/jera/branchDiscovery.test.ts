import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { discoverClinicBranches } from '../../scripts/discover-clinic-report-branch.mjs'
import { createJeraOperatorSecretAccessor, loadJeraOperatorSecrets } from '../../scripts/jera-operator-secrets.mjs'

const PROJECT = 'project-2099d92f-51c8-4d2b-a8c'
const CLINIC_UUID = '11111111-2222-4333-8444-555555555555'
const BRANCH_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const SECRET_VALUES = {
  JERA_API_BASE_URL: 'https://jera.example',
  JERA_API_USERNAME: 'synthetic-operator-user',
  JERA_API_PASSWORD: 'synthetic-operator-password',
}

describe('safe clinic branch discovery', () => {
  it('constructs the default Secret Manager accessor with explicit Cloud Platform ADC', async () => {
    const auth = { kind: 'synthetic-auth' }
    const access = vi.fn(async () => ({ data: { payload: { data: encodeSecret(SECRET_VALUES.JERA_API_BASE_URL) } } }))
    const GoogleAuth = vi.fn(function GoogleAuth() { return auth })
    const secretmanager = vi.fn(() => ({ projects: { secrets: { versions: { access } } } }))
    const accessor = createJeraOperatorSecretAccessor({ auth: { GoogleAuth }, secretmanager })

    await accessor.accessSecretVersion({ name: `projects/${PROJECT}/secrets/JERA_API_BASE_URL/versions/latest` })

    expect(GoogleAuth).toHaveBeenCalledOnce()
    expect(GoogleAuth).toHaveBeenCalledWith({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
    expect(secretmanager).toHaveBeenCalledWith({ version: 'v1', auth })
    expect(access).toHaveBeenCalledWith({ name: `projects/${PROJECT}/secrets/JERA_API_BASE_URL/versions/latest` })
  })

  it('returns only bounded clinic branch metadata', async () => {
    const result = await discoverClinicBranches(
      ['--allow-readonly-production', '--project', PROJECT],
      dependencies({ clinicBody: [{ uuid: CLINIC_UUID, name: 'Promed', branches: [{ uuid: BRANCH_UUID, name: 'สาขาหลัก' }] }] }),
    )

    expect(result).toEqual({ clinicCount: 1, branchCount: 1, branches: [{ uuid: BRANCH_UUID, name: 'สาขาหลัก' }] })
    expect(JSON.stringify(result)).not.toMatch(/username|password|token|secret/i)
  })

  it('accepts the documented data envelope and documented branch aliases', async () => {
    const result = await discoverClinicBranches(
      ['--allow-readonly-production', '--project', PROJECT],
      dependencies({ clinicBody: { data: [{ branch_data: [{ branch_uuid: BRANCH_UUID, branch_name: 'สาขารอง' }] }] } }),
    )

    expect(result).toEqual({ clinicCount: 1, branchCount: 1, branches: [{ uuid: BRANCH_UUID, name: 'สาขารอง' }] })
  })

  it('fails closed on ambiguous or malformed clinic metadata without including the body', async () => {
    const rawBodyMarker = 'must-not-appear-in-errors'
    await expect(discoverClinicBranches(
      ['--allow-readonly-production', '--project', PROJECT],
      dependencies({ clinicBody: [{ branches: [{ uuid: 'not-a-uuid', name: rawBodyMarker }] }] }),
    )).rejects.toThrow('Clinic branch discovery failed')

    try {
      await discoverClinicBranches(
        ['--allow-readonly-production', '--project', PROJECT],
        dependencies({ clinicBody: [{ branches: [{ uuid: BRANCH_UUID, name: rawBodyMarker }], clinic_branches: [] }] }),
      )
    } catch (error) {
      expect(String(error)).not.toContain(rawBodyMarker)
    }
  })

  it('uses only a token POST and the allowlisted clinic GET', async () => {
    const setup = dependencies({ clinicBody: [{ branches: [{ uuid: BRANCH_UUID, name: 'สาขาหลัก' }] }] })
    await discoverClinicBranches(['--allow-readonly-production', '--project', PROJECT], setup)

    expect(setup.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET'])
    expect(setup.fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://jera.example/openapi/v1/token/', 'https://jera.example/openapi/v1/clinic/',
    ])
  })

  it('rejects a token redirect without making a follow-up request', async () => {
    const secretAccessor = createSecretAccessor()
    const fetch = vi.fn(async (_url: string, init: { redirect?: string }) => {
      if (init.redirect === 'error') throw new Error('redirect rejected')
      return jsonResponse(200, { access_token: 'synthetic-read-token', expires_in: 3600, token_type: 'Bearer' })
    })

    await expect(discoverClinicBranches(['--allow-readonly-production', '--project', PROJECT], { secretAccessor, fetch }))
      .rejects.toThrow('Clinic branch discovery failed')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects a clinic redirect without making a follow-up request', async () => {
    const secretAccessor = createSecretAccessor()
    const fetch = vi.fn(async (url: string, init: { method: string; redirect?: string }) => {
      if (String(url).endsWith('/openapi/v1/token/')) {
        return jsonResponse(200, { access_token: 'synthetic-read-token', expires_in: 3600, token_type: 'Bearer' })
      }
      if (init.redirect === 'error') throw new Error('redirect rejected')
      return jsonResponse(200, [{ branches: [{ uuid: BRANCH_UUID, name: 'สาขาหลัก' }] }])
    })

    await expect(discoverClinicBranches(['--allow-readonly-production', '--project', PROJECT], { secretAccessor, fetch }))
      .rejects.toThrow('Clinic branch discovery failed')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(([, init]) => init.redirect)).toEqual(['error', 'error'])
  })

  it('cancels an oversized chunked clinic response before unbounded buffering', async () => {
    const oversized = chunkedResponse([
      new Uint8Array(2_000_000),
      new Uint8Array([0]),
    ])
    const secretAccessor = createSecretAccessor()
    const fetch = vi.fn(async (url: string) => String(url).endsWith('/openapi/v1/token/')
      ? jsonResponse(200, { access_token: 'synthetic-read-token', expires_in: 3600, token_type: 'Bearer' })
      : oversized.response)

    await expect(discoverClinicBranches(['--allow-readonly-production', '--project', PROJECT], { secretAccessor, fetch }))
      .rejects.toThrow('Clinic branch discovery failed')
    expect(oversized.read).toHaveBeenCalledTimes(2)
    expect(oversized.cancel).toHaveBeenCalledOnce()
    expect(oversized.arrayBuffer).not.toHaveBeenCalled()
  })

  it('fails closed when the temporary token does not satisfy the existing token contract', async () => {
    const setup = dependencies({
      clinicBody: [{ branches: [{ uuid: BRANCH_UUID, name: 'สาขาหลัก' }] }],
      tokenBody: { access_token: 'synthetic-read-token', expires_in: 3600, token_type: 'Basic' },
    })

    await expect(discoverClinicBranches(['--allow-readonly-production', '--project', PROJECT], setup))
      .rejects.toThrow('Clinic branch discovery failed')
    expect(setup.fetch).toHaveBeenCalledTimes(1)
  })

  it('loads exactly the required secret versions and redacts their values during inspection', async () => {
    const secretAccessor = createSecretAccessor()
    const secrets = await loadJeraOperatorSecrets({ project: PROJECT }, { secretAccessor })
    const serialized = `${JSON.stringify(secrets)} ${inspect(secrets)}`

    expect(secretAccessor.accessSecretVersion.mock.calls.map(([request]) => request.name)).toEqual([
      `projects/${PROJECT}/secrets/JERA_API_BASE_URL/versions/latest`,
      `projects/${PROJECT}/secrets/JERA_API_USERNAME/versions/latest`,
      `projects/${PROJECT}/secrets/JERA_API_PASSWORD/versions/latest`,
    ])
    for (const value of Object.values(SECRET_VALUES)) expect(serialized).not.toContain(value)
  })

  it('decodes canonical base64 strings from the googleapis secret envelope for every operator secret', async () => {
    const { secretAccessor, encodedValues } = createGoogleapisSecretAccessor()
    const secrets = await loadJeraOperatorSecrets({ project: PROJECT }, { secretAccessor })
    const serialized = `${JSON.stringify(secrets)} ${inspect(secrets)}`

    expect(secrets.baseUrl).toBe(SECRET_VALUES.JERA_API_BASE_URL)
    expect(secrets.username).toBe(SECRET_VALUES.JERA_API_USERNAME)
    expect(secrets.password).toBe(SECRET_VALUES.JERA_API_PASSWORD)
    for (const value of [...Object.values(SECRET_VALUES), ...encodedValues]) expect(serialized).not.toContain(value)
  })

  it('rejects a plaintext googleapis payload without echoing the payload in its error', async () => {
    const { secretAccessor } = createGoogleapisSecretAccessor((value, secretName) => secretName === 'JERA_API_BASE_URL' ? value : encodeSecret(value))
    const failure = await loadJeraOperatorSecrets({ project: PROJECT }, { secretAccessor })
      .then(() => new Error('expected secret loader to reject plaintext payload'), (error) => error)

    expect(String(failure)).toBe('Error: JERA operator secrets are unavailable')
    expect(String(failure)).not.toContain(SECRET_VALUES.JERA_API_BASE_URL)
  })

  it.each([
    ['base64 without required padding', (value: string, secretName: keyof typeof SECRET_VALUES) => secretName === 'JERA_API_BASE_URL' ? encodeSecret(value).replace(/=+$/, '') : encodeSecret(value)],
    ['base64 with excess padding', (value: string, secretName: keyof typeof SECRET_VALUES) => secretName === 'JERA_API_BASE_URL' ? `${encodeSecret(value)}=` : encodeSecret(value)],
    ['an empty base64 string', (value: string, secretName: keyof typeof SECRET_VALUES) => secretName === 'JERA_API_USERNAME' ? '' : encodeSecret(value)],
    ['base64 for invalid UTF-8 bytes', (value: string, secretName: keyof typeof SECRET_VALUES) => secretName === 'JERA_API_USERNAME' ? 'wyg=' : encodeSecret(value)],
    ['an oversized base64 string', (value: string, secretName: keyof typeof SECRET_VALUES) => secretName === 'JERA_API_USERNAME' ? 'A'.repeat(2_000) : encodeSecret(value)],
  ])('rejects %s from a googleapis secret envelope', async (_description, mapPayload) => {
    const { secretAccessor } = createGoogleapisSecretAccessor(mapPayload)

    await expect(loadJeraOperatorSecrets({ project: PROJECT }, { secretAccessor }))
      .rejects.toThrow('JERA operator secrets are unavailable')
  })

  it('continues accepting Uint8Array secret payloads from injected adapters', async () => {
    const secretAccessor = createSecretAccessor((value) => new Uint8Array(Buffer.from(value)))

    const secrets = await loadJeraOperatorSecrets({ project: PROJECT }, { secretAccessor })
    expect(secrets.baseUrl).toBe(SECRET_VALUES.JERA_API_BASE_URL)
    expect(secrets.username).toBe(SECRET_VALUES.JERA_API_USERNAME)
    expect(secrets.password).toBe(SECRET_VALUES.JERA_API_PASSWORD)
  })

  it('requires the explicit production flag and exact project before reading secrets', async () => {
    const secretAccessor = createSecretAccessor()
    await expect(discoverClinicBranches(['--project', PROJECT], { secretAccessor, fetch: vi.fn() }))
      .rejects.toThrow('Clinic branch discovery failed')
    await expect(discoverClinicBranches(['--allow-readonly-production', '--project', 'other-project'], { secretAccessor, fetch: vi.fn() }))
      .rejects.toThrow('Clinic branch discovery failed')
    expect(secretAccessor.accessSecretVersion).not.toHaveBeenCalled()
  })
})

function dependencies({
  clinicBody,
  tokenBody = { access_token: 'synthetic-read-token', expires_in: 3600, token_type: 'Bearer' },
}: { clinicBody: unknown; tokenBody?: unknown }) {
  const secretAccessor = createSecretAccessor()
  const fetch = vi.fn(async (url: string) => String(url).endsWith('/openapi/v1/token/')
    ? jsonResponse(200, tokenBody)
    : jsonResponse(200, clinicBody))
  return { secretAccessor, fetch }
}

function createSecretAccessor(mapPayload = (value: string) => Buffer.from(value)) {
  return {
    accessSecretVersion: vi.fn(async ({ name }: { name: string }) => {
      const secretName = name.split('/').at(-3) as keyof typeof SECRET_VALUES
      return [{ payload: { data: mapPayload(SECRET_VALUES[secretName]) } }]
    }),
  }
}

function createGoogleapisSecretAccessor(
  mapPayload: (value: string, secretName: keyof typeof SECRET_VALUES) => string = (value) => encodeSecret(value),
) {
  const encodedValues = Object.values(SECRET_VALUES).map(encodeSecret)
  return {
    encodedValues,
    secretAccessor: {
      accessSecretVersion: vi.fn(async ({ name }: { name: string }) => {
        const secretName = name.split('/').at(-3) as keyof typeof SECRET_VALUES
        return { data: { payload: { data: mapPayload(SECRET_VALUES[secretName], secretName) } } }
      }),
    },
  }
}

function encodeSecret(value: string) {
  return Buffer.from(value).toString('base64')
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
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
      headers: { get: () => null },
      body: { getReader: () => ({ read, cancel }) },
      arrayBuffer,
    },
  }
}
