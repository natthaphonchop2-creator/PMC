import { createHmac, randomUUID } from 'node:crypto'
import type { MiniAppStockCommand, StockCommandResult } from '../../../shared/pmcStock.js'
import {
  canonicalMiniAppStockIngress,
  isMiniAppStockSafeErrorCode,
  type MiniAppStockIngressEnvelope,
  type MiniAppStockCommandType,
  type MiniAppStockSafeErrorCode,
  type UnsignedMiniAppStockIngressEnvelope,
} from '../../../shared/pmcMiniAppStockIngress.js'

interface IngressResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type IngressFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: { 'content-type': string }
    body: string
    signal: AbortSignal
  },
) => Promise<IngressResponse>

export interface StockIngressClientOptions {
  url: string
  secret: string
  timeoutMs?: number
  now?: () => number
  nonce?: () => string
  fetch?: IngressFetch
}

export class StockIngressClientError extends Error {
  readonly code: MiniAppStockSafeErrorCode

  constructor(code: StockIngressClientError['code']) {
    super(`Stock ingress failed: ${code}`)
    this.name = 'StockIngressClientError'
    this.code = code
  }
}

export function buildMiniAppStockIngress(
  command: MiniAppStockCommand,
  context: { timestamp: number; nonce: string },
  secret: string,
): { body: MiniAppStockIngressEnvelope; headers: { 'content-type': 'application/json' } } {
  if (
    !Number.isSafeInteger(context.timestamp) ||
    context.timestamp <= 0 ||
    !safeNonce(context.nonce) ||
    !secret
  ) {
    throw new StockIngressClientError('STOCK_STORAGE_UNAVAILABLE')
  }
  const unsigned: UnsignedMiniAppStockIngressEnvelope = {
    kind: 'MINI_APP_STOCK',
    version: 1,
    timestamp: context.timestamp,
    nonce: context.nonce,
    command,
  }
  let canonical: string
  try {
    canonical = canonicalMiniAppStockIngress(unsigned)
  } catch {
    throw new StockIngressClientError('STOCK_STORAGE_UNAVAILABLE')
  }
  const signature = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
  return {
    body: { ...unsigned, signature },
    headers: { 'content-type': 'application/json' },
  }
}

export function createStockIngressClient(options: StockIngressClientOptions): {
  send(command: MiniAppStockCommand): Promise<StockCommandResult>
} {
  const url = safeHttpsUrl(options.url)
  const secret = options.secret
  const timeoutMs = options.timeoutMs ?? 60_000
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000))
  const nonce = options.nonce ?? randomUUID
  const request = options.fetch ?? (globalThis.fetch as unknown as IngressFetch)
  if (
    !url ||
    !secret ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    !request
  ) {
    throw new Error('Invalid Stock ingress client configuration')
  }

  return {
    async send(command) {
      const built = buildMiniAppStockIngress(command, { timestamp: now(), nonce: nonce() }, secret)
      const controller = new AbortController()
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      try {
        const response = await request(url, {
          method: 'POST',
          headers: built.headers,
          body: JSON.stringify(built.body),
          signal: controller.signal,
        })
        if (!response.ok) throw new StockIngressClientError('STOCK_STORAGE_UNAVAILABLE')
        let body: unknown
        try {
          body = await response.json()
        } catch {
          throw new StockIngressClientError('STOCK_STORAGE_UNAVAILABLE')
        }
        if (hasExactKeys(body, ['ok', 'result']) && body.ok === true) {
          const result = body.result
          if (
            !isStockCommandResult(result) ||
            !isStockCommandResultForCommand(command, result)
          ) {
            throw new StockIngressClientError('STOCK_STORAGE_UNAVAILABLE')
          }
          return result
        }
        if (hasExactKeys(body, ['ok', 'error']) && body.ok === false && isMiniAppStockSafeErrorCode(body.error)) {
          throw new StockIngressClientError(body.error)
        }
        throw new StockIngressClientError('STOCK_STORAGE_UNAVAILABLE')
      } catch (error) {
        if (timedOut) throw new StockIngressClientError('STOCK_STORAGE_UNAVAILABLE')
        if (error instanceof StockIngressClientError) throw error
        throw new StockIngressClientError('STOCK_STORAGE_UNAVAILABLE')
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

function isStockCommandResultForCommand(
  command: MiniAppStockCommand,
  result: StockCommandResult,
): boolean {
  if (
    result.requestId !== command.requestId ||
    result.commandType !== command.commandType ||
    result.lines.some(({ balanceAfterMilli }) => balanceAfterMilli < 0)
  ) return false

  if (command.commandType === 'ISSUE' || command.commandType === 'RECEIVE') {
    const inputProductIds = command.payload.lines.map(({ productId }) => productId)
    if (new Set(inputProductIds).size !== inputProductIds.length || result.lines.length !== command.payload.lines.length) {
      return false
    }
    const direction = command.commandType === 'ISSUE' ? -1 : 1
    return result.lines.every((line, index) => {
      const requested = command.payload.lines[index]!
      return line.productId === requested.productId &&
        line.quantityDeltaMilli === direction * requested.quantityMilli
    })
  }

  if (command.commandType === 'CREATE_PRODUCT') {
    if (command.payload.openingQuantityMilli === 0) return result.lines.length === 0
    return result.lines.length === 1 &&
      result.lines[0]!.productId === result.documentId &&
      result.lines[0]!.quantityDeltaMilli === command.payload.openingQuantityMilli &&
      result.lines[0]!.balanceAfterMilli === command.payload.openingQuantityMilli
  }

  if (command.commandType === 'ADJUST') {
    return result.lines.length === 0 || (result.lines.length === 1 &&
      result.lines[0]!.productId === command.payload.productId &&
      result.lines[0]!.quantityDeltaMilli !== 0 &&
      result.lines[0]!.balanceAfterMilli === command.payload.countedQuantityMilli)
  }

  if (
    command.commandType === 'UPDATE_PRODUCT' ||
    command.commandType === 'DEACTIVATE_PRODUCT' ||
    command.commandType === 'REACTIVATE_PRODUCT'
  ) return result.lines.length === 0 && result.documentId === command.payload.productId

  return false
}

function isStockCommandResult(value: unknown): value is StockCommandResult {
  if (!hasExactKeys(value, ['requestId', 'documentId', 'commandType', 'createdAt', 'lines'])) {
    return false
  }
  if (
    !safeId(value.requestId) ||
    !safeId(value.documentId) ||
    !isCommandType(value.commandType) ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.lines)
  ) {
    return false
  }
  return value.lines.every((line) =>
    hasExactKeys(line, ['productId', 'quantityDeltaMilli', 'balanceAfterMilli']) &&
    safeId(line.productId) &&
    Number.isSafeInteger(line.quantityDeltaMilli) &&
    Number.isSafeInteger(line.balanceAfterMilli),
  )
}

function isCommandType(value: unknown): value is MiniAppStockCommandType {
  return [
    'CREATE_PRODUCT',
    'RECEIVE',
    'ISSUE',
    'ADJUST',
    'UPDATE_PRODUCT',
    'DEACTIVATE_PRODUCT',
    'REACTIVATE_PRODUCT',
  ].includes(String(value))
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value)
}

function safeNonce(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value)
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
