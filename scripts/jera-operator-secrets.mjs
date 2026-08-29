import { pathToFileURL } from 'node:url'

export const JERA_OPERATOR_PROJECT = 'project-2099d92f-51c8-4d2b-a8c'
export const JERA_OPERATOR_SECRET_NAMES = [
  'JERA_API_BASE_URL',
  'JERA_API_USERNAME',
  'JERA_API_PASSWORD',
]

const INSPECT = Symbol.for('nodejs.util.inspect.custom')
const MAX_SECRET_BYTES = 1_024
const MAX_BASE64_SECRET_LENGTH = 4 * Math.ceil(MAX_SECRET_BYTES / 3)
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

export async function loadJeraOperatorSecrets(input, dependencies = {}) {
  const project = projectFrom(input)
  if (project !== JERA_OPERATOR_PROJECT) throw new Error('JERA operator secrets are unavailable')

  const accessor = dependencies.secretAccessor ?? await defaultSecretAccessor()
  if (!accessor || typeof accessor.accessSecretVersion !== 'function') throw new Error('JERA operator secrets are unavailable')

  const values = []
  for (const name of JERA_OPERATOR_SECRET_NAMES) {
    const version = await accessor.accessSecretVersion({ name: `projects/${project}/secrets/${name}/versions/latest` })
    values.push(readSecretValue(version))
  }
  const [baseUrl, username, password] = values
  if (!safeBaseUrl(baseUrl) || !boundedSecret(username) || !boundedSecret(password)) {
    throw new Error('JERA operator secrets are unavailable')
  }

  return Object.freeze({
    baseUrl,
    username,
    password,
    toJSON: () => redactedSecrets(),
    [INSPECT]: () => redactedSecrets(),
  })
}

function projectFrom(input) {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    if (typeof input.project === 'string') return input.project
    if (typeof input.projectId === 'string') return input.projectId
  }
  return ''
}

async function defaultSecretAccessor() {
  const { google } = await import('googleapis')
  return createJeraOperatorSecretAccessor(google)
}

export function createJeraOperatorSecretAccessor(google) {
  const auth = new google.auth.GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })
  const client = google.secretmanager({ version: 'v1', auth })
  return {
    accessSecretVersion: (request) => client.projects.secrets.versions.access(request),
  }
}

function readSecretValue(response) {
  const value = unwrapSecretPayload(response)
  if (typeof value === 'string') return decodeCanonicalBase64(value)
  if (Buffer.isBuffer(value)) return decodeUtf8(value)
  if (value instanceof Uint8Array) return decodeUtf8(Buffer.from(value))
  throw secretsUnavailable()
}

function decodeCanonicalBase64(value) {
  if (value.length === 0 || value.length > MAX_BASE64_SECRET_LENGTH || !CANONICAL_BASE64.test(value)) {
    throw secretsUnavailable()
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_SECRET_BYTES || bytes.toString('base64') !== value) {
    throw secretsUnavailable()
  }
  return decodeUtf8(bytes)
}

function decodeUtf8(value) {
  if (value.length === 0 || value.length > MAX_SECRET_BYTES) throw secretsUnavailable()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw secretsUnavailable()
  }
}

function secretsUnavailable() {
  return new Error('JERA operator secrets are unavailable')
}

function unwrapSecretPayload(response) {
  const result = Array.isArray(response) ? response[0] : response
  if (!result || typeof result !== 'object') return null
  const direct = result.payload?.data
  if (direct !== undefined) return direct
  return result.data?.payload?.data
}

function safeBaseUrl(value) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
      && (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash
  } catch {
    return false
  }
}

function boundedSecret(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 1_024
}

function redactedSecrets() {
  return { baseUrl: '[REDACTED]', username: '[REDACTED]', password: '[REDACTED]' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write('This module is only available to approved operator scripts.\n')
  process.exitCode = 2
}
