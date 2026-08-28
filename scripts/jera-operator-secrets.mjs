import { pathToFileURL } from 'node:url'

export const JERA_OPERATOR_PROJECT = 'project-2099d92f-51c8-4d2b-a8c'
export const JERA_OPERATOR_SECRET_NAMES = [
  'JERA_API_BASE_URL',
  'JERA_API_USERNAME',
  'JERA_API_PASSWORD',
]

const INSPECT = Symbol.for('nodejs.util.inspect.custom')

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
  const client = google.secretmanager({ version: 'v1' })
  return {
    accessSecretVersion: (request) => client.projects.secrets.versions.access(request),
  }
}

function readSecretValue(response) {
  const value = unwrapSecretPayload(response)
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  throw new Error('JERA operator secrets are unavailable')
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
