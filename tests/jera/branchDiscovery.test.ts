import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { discoverClinicBranches } from '../../scripts/discover-clinic-report-branch.mjs'
import { loadJeraOperatorSecrets } from '../../scripts/jera-operator-secrets.mjs'

const PROJECT = 'project-2099d92f-51c8-4d2b-a8c'
const CLINIC_UUID = '11111111-2222-4333-8444-555555555555'
const BRANCH_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const SECRET_VALUES = {
  JERA_API_BASE_URL: 'https://jera.example',
  JERA_API_USERNAME: 'synthetic-operator-user',
  JERA_API_PASSWORD: 'synthetic-operator-password',
}

describe('safe clinic branch discovery', () => {
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

function createSecretAccessor() {
  return {
    accessSecretVersion: vi.fn(async ({ name }: { name: string }) => {
      const secretName = name.split('/').at(-3) as keyof typeof SECRET_VALUES
      return [{ payload: { data: Buffer.from(SECRET_VALUES[secretName]) } }]
    }),
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
