const TOKEN_RESPONSE_BYTES = 64 * 1024
const PROVIDER_RESPONSE_BYTES = 2_000_000
const REQUEST_TIMEOUT_MS = 30_000
const SCHEDULED_PROVIDER_ATTEMPTS = 3

export async function requestOperatorToken({ fetch, baseUrl, username, password }) {
  if (typeof fetch !== 'function') throw new Error('JERA operator request is unavailable')
  const response = await fetch(new URL('/openapi/v1/token/', `${baseUrl}/`).toString(), {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error',
  })
  if (!response?.ok) throw new Error('JERA operator token request failed')
  const body = await readBoundedJson(response, TOKEN_RESPONSE_BYTES)
  if (!validTokenPayload(body)) throw new Error('JERA operator token response is invalid')
  return body.access_token
}

export async function requestScheduledProviderJson({ fetch, url, accessToken, sleep = defaultSleep }) {
  if (typeof fetch !== 'function' || typeof sleep !== 'function') throw new Error('JERA operator request is unavailable')
  for (let attempt = 0; attempt < SCHEDULED_PROVIDER_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    })
    if (response?.status === 429 && attempt + 1 < SCHEDULED_PROVIDER_ATTEMPTS) {
      await sleep(parseRetryAfter(response.headers?.get?.('retry-after')) ?? 1_000)
      continue
    }
    if (!response?.ok) throw new Error('JERA operator provider request failed')
    return readBoundedJson(response, PROVIDER_RESPONSE_BYTES)
  }
  throw new Error('JERA operator provider request failed')
}

async function readBoundedJson(response, maxBytes) {
  const advertisedLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) throw new Error('JERA operator response is too large')
  const bytes = await readBoundedBytes(response, maxBytes)
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error('JERA operator response is invalid')
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('JERA operator response is invalid')
  }
}

async function readBoundedBytes(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    if (typeof response.arrayBuffer !== 'function') throw new Error('JERA operator response is invalid')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error('JERA operator response is too large')
    return bytes
  }

  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  let cancelled = false
  const cancel = async () => {
    if (cancelled) return
    cancelled = true
    try { await reader.cancel() } catch { /* an unreadable stream remains invalid */ }
  }
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > maxBytes - length) {
        await cancel()
        throw new Error('JERA operator response is too large')
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

function parseRetryAfter(value, nowMs = Date.now()) {
  if (typeof value !== 'string') return null
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 120 ? seconds * 1_000 : null
  }
  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return null
  const delay = Math.ceil((retryAt - nowMs) / 1_000) * 1_000
  return delay >= 1_000 && delay <= 120_000 ? delay : null
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
