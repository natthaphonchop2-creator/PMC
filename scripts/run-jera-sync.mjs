#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

export async function runJeraSync(args, environment = process.env, io = { stdout: process.stdout }) {
  let mode = 'current'
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--mode' && (args[index + 1] === 'current' || args[index + 1] === 'daily')) mode = args[++index]
    else throw new Error(`Unknown JERA sync argument: ${args[index]}`)
  }

  const endpoint = requiredHttpsUrl(environment.JERA_INTERNAL_SYNC_URL)
  const oidcToken = requiredToken(environment.JERA_INTERNAL_OIDC_TOKEN)
  const url = new URL(endpoint)
  url.searchParams.set('mode', mode)
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${oidcToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(120_000),
  })
  const advertised = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertised) && advertised > 64 * 1024) throw new Error('JERA sync response is too large')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > 64 * 1024) throw new Error('JERA sync response is invalid')
  let body
  try { body = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('JERA sync response is invalid') }
  if (!response.ok || body?.accepted !== true || typeof body.syncRunId !== 'string') throw new Error('JERA sync was not accepted')
  io.stdout.write(`${JSON.stringify({ accepted: true, syncRunId: body.syncRunId, mode })}\n`)
  return 0
}

function requiredHttpsUrl(value) {
  try {
    const url = new URL(value ?? '')
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('invalid')
    return url.toString()
  } catch {
    throw new Error('JERA_INTERNAL_SYNC_URL must be an HTTPS URL')
  }
}

function requiredToken(value) {
  if (typeof value !== 'string' || value.length < 6 || value.length > 8_192 || /\s/.test(value)) {
    throw new Error('JERA_INTERNAL_OIDC_TOKEN is unavailable')
  }
  return value
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runJeraSync(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'JERA sync failed'}\n`)
      process.exitCode = 2
    })
}
