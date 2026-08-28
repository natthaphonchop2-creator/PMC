#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { JERA_OPERATOR_PROJECT, loadJeraOperatorSecrets } from './jera-operator-secrets.mjs'

const MAX_RESPONSE_BYTES = 2_000_000
const MAX_BRANCH_NAME_LENGTH = 160
const TOKEN_RESPONSE_BYTES = 64 * 1024

export async function discoverClinicBranches(args, dependencies = {}) {
  try {
    const { project } = parseArguments(args)
    const secrets = await (dependencies.loadJeraOperatorSecrets ?? loadJeraOperatorSecrets)(
      { project }, { secretAccessor: dependencies.secretAccessor },
    )
    const request = dependencies.fetch ?? globalThis.fetch
    if (typeof request !== 'function') throw new Error('unavailable')

    const token = await obtainTemporaryToken(request, secrets)
    const response = await request(new URL('/openapi/v1/clinic/', `${secrets.baseUrl}/`).toString(), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    if (!response?.ok) throw new Error('provider failed')
    return sanitizeClinicBranches(await boundedJson(response, MAX_RESPONSE_BYTES))
  } catch {
    throw new Error('Clinic branch discovery failed')
  }
}

function parseArguments(args) {
  let allowReadonlyProduction = false
  let project = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--allow-readonly-production') {
      if (allowReadonlyProduction) throw new Error('duplicate flag')
      allowReadonlyProduction = true
    } else if (argument === '--project' && typeof args[index + 1] === 'string' && project === null) {
      project = args[++index]
    } else {
      throw new Error('invalid arguments')
    }
  }
  if (!allowReadonlyProduction || project !== JERA_OPERATOR_PROJECT) throw new Error('production flag required')
  return { project }
}

async function obtainTemporaryToken(request, secrets) {
  const response = await request(new URL('/openapi/v1/token/', `${secrets.baseUrl}/`).toString(), {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${secrets.username}:${secrets.password}`, 'utf8').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  if (!response?.ok) throw new Error('token request failed')
  const body = await boundedJson(response, TOKEN_RESPONSE_BYTES)
  if (!validTokenPayload(body)) throw new Error('token response invalid')
  return body.access_token
}

function validTokenPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof value.access_token === 'string'
    && value.access_token.length >= 6
    && value.access_token.length <= 8_192
    && !/\s/.test(value.access_token)
    && Number.isSafeInteger(value.expires_in)
    && value.expires_in > 0
    && value.token_type === 'Bearer'
    && (value.scope === undefined || typeof value.scope === 'string')
}

async function boundedJson(response, maxBytes) {
  const advertisedLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) throw new Error('response too large')
  const bytes = await boundedBytes(response, maxBytes)
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error('response invalid')
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('response invalid')
  }
}

async function boundedBytes(response, maxBytes) {
  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    if (typeof response.arrayBuffer !== 'function') throw new Error('response invalid')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('response too large')
    return bytes
  }

  const reader = body.getReader()
  const chunks = []
  let length = 0
  let cancelled = false
  const cancel = async () => {
    if (cancelled) return
    cancelled = true
    try { await reader.cancel() } catch { /* cancellation cannot make oversized data valid */ }
  }
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > maxBytes - length) {
        await cancel()
        throw new Error('response too large')
      }
      chunks.push(chunk.value)
      length += chunk.value.byteLength
    }
  } catch (error) {
    await cancel()
    throw error
  }
  return Buffer.concat(chunks, length)
}

function sanitizeClinicBranches(value) {
  const clinics = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.data) ? value.data : null
  if (!clinics) throw new Error('clinic schema invalid')

  const branches = []
  const seenUuids = new Set()
  for (const clinic of clinics) {
    if (!isObject(clinic)) throw new Error('clinic schema invalid')
    const branchKey = exactlyOneKey(clinic, ['branches', 'branch_data', 'clinic_branches'])
    if (!branchKey || !Array.isArray(clinic[branchKey])) throw new Error('clinic schema invalid')
    for (const branch of clinic[branchKey]) {
      if (!isObject(branch)) throw new Error('branch schema invalid')
      const uuidKey = exactlyOneKey(branch, ['uuid', 'branch_uuid'])
      const nameKey = exactlyOneKey(branch, ['name', 'branch_name'])
      const uuid = uuidKey ? branch[uuidKey] : null
      const name = nameKey ? normalizedBranchName(branch[nameKey]) : null
      if (!isUuid(uuid) || !name || seenUuids.has(uuid)) throw new Error('branch schema invalid')
      seenUuids.add(uuid)
      branches.push({ uuid, name })
    }
  }
  return { clinicCount: clinics.length, branchCount: branches.length, branches }
}

function exactlyOneKey(value, keys) {
  const present = keys.filter((key) => Object.hasOwn(value, key))
  return present.length === 1 ? present[0] : null
}

function normalizedBranchName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && name.length <= MAX_BRANCH_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(name) ? name : null
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  discoverClinicBranches(process.argv.slice(2))
    .then((result) => { process.stdout.write(`${JSON.stringify(result)}\n`) })
    .catch(() => {
      process.stderr.write('Clinic branch discovery failed\n')
      process.exitCode = 2
    })
}
