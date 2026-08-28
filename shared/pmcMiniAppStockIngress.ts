import type { MiniAppStockCommand, StockCategory, StockCommandResult } from './pmcStock'

export type MiniAppStockCommandType =
  | 'CREATE_PRODUCT'
  | 'RECEIVE'
  | 'ISSUE'
  | 'ADJUST'
  | 'UPDATE_PRODUCT'
  | 'DEACTIVATE_PRODUCT'
  | 'REACTIVATE_PRODUCT'

export interface UnsignedMiniAppStockIngressEnvelope {
  kind: 'MINI_APP_STOCK'
  version: 1
  timestamp: number
  nonce: string
  command: MiniAppStockCommand
}

export interface MiniAppStockIngressEnvelope extends UnsignedMiniAppStockIngressEnvelope {
  signature: string
}

export const MINI_APP_STOCK_SAFE_ERROR_CODES = [
  'STOCK_INVALID_ID',
  'STOCK_INVALID_FINGERPRINT',
  'STOCK_STAFF_REQUIRED',
  'STOCK_MANAGER_REQUIRED',
  'STOCK_IDEMPOTENCY_CONFLICT',
  'STOCK_INVALID_LINES',
  'STOCK_INVALID_QUANTITY',
  'STOCK_DUPLICATE_PRODUCT',
  'STOCK_PRODUCT_NOT_FOUND',
  'STOCK_PRODUCT_INACTIVE',
  'STOCK_BALANCE_OVERFLOW',
  'STOCK_INSUFFICIENT_BALANCE',
  'STOCK_INVALID_PRODUCT',
  'STOCK_PRODUCT_NAME_EXISTS',
  'STOCK_ADJUST_REASON_REQUIRED',
  'STOCK_UNIT_LOCKED',
  'STOCK_RECOVERY_REQUIRED',
  'STOCK_UNKNOWN_COMMAND',
  'STOCK_STALE_PRODUCT',
  'STOCK_STORAGE_UNAVAILABLE',
] as const

export type MiniAppStockSafeErrorCode = typeof MINI_APP_STOCK_SAFE_ERROR_CODES[number]

export type MiniAppStockIngressResponse =
  | { ok: true; result: StockCommandResult }
  | { ok: false; error: MiniAppStockSafeErrorCode }

const SAFE_ERROR_CODES = new Set<string>(MINI_APP_STOCK_SAFE_ERROR_CODES)

export function isMiniAppStockSafeErrorCode(value: unknown): value is MiniAppStockSafeErrorCode {
  return typeof value === 'string' && SAFE_ERROR_CODES.has(value)
}

const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'command'] as const
const COMMAND_KEYS = ['requestId', 'staffId', 'commandType', 'payload'] as const

export function canonicalMiniAppStockCommand(command: MiniAppStockCommand): string {
  return JSON.stringify(orderedCommand(command))
}

export function canonicalMiniAppStockIngress(
  envelope: UnsignedMiniAppStockIngressEnvelope,
): string {
  if (!hasExactKeys(envelope, ENVELOPE_KEYS)) throw new Error('invalid mini app stock envelope')
  if (
    envelope.kind !== 'MINI_APP_STOCK' ||
    envelope.version !== 1 ||
    !Number.isSafeInteger(envelope.timestamp) ||
    typeof envelope.nonce !== 'string'
  ) {
    throw new Error('invalid mini app stock envelope')
  }
  return JSON.stringify({
    kind: 'MINI_APP_STOCK',
    version: 1,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    command: orderedCommand(envelope.command),
  })
}

function orderedCommand(input: unknown): MiniAppStockCommand {
  if (!hasExactKeys(input, COMMAND_KEYS)) throw new Error('invalid mini app stock command')
  if (
    typeof input.requestId !== 'string' ||
    typeof input.staffId !== 'string' ||
    typeof input.commandType !== 'string' ||
    !isRecord(input.payload)
  ) {
    throw new Error('invalid mini app stock command')
  }
  const common = {
    requestId: input.requestId,
    staffId: input.staffId,
  }
  switch (input.commandType as MiniAppStockCommandType) {
    case 'CREATE_PRODUCT': {
      const keys = ['name', 'category', 'unit', 'openingQuantityMilli', 'minimumQuantityMilli'] as const
      if (
        !hasExactKeys(input.payload, keys) ||
        typeof input.payload.name !== 'string' ||
        !isCategory(input.payload.category) ||
        typeof input.payload.unit !== 'string' ||
        !Number.isSafeInteger(input.payload.openingQuantityMilli) ||
        !Number.isSafeInteger(input.payload.minimumQuantityMilli)
      ) {
        throw new Error('invalid mini app stock command payload')
      }
      return {
        ...common,
        commandType: 'CREATE_PRODUCT',
        payload: {
          name: input.payload.name,
          category: input.payload.category,
          unit: input.payload.unit,
          openingQuantityMilli: input.payload.openingQuantityMilli as number,
          minimumQuantityMilli: input.payload.minimumQuantityMilli as number,
        },
      }
    }
    case 'RECEIVE':
    case 'ISSUE': {
      if (!hasExactKeys(input.payload, ['lines']) || !Array.isArray(input.payload.lines)) {
        throw new Error('invalid mini app stock command payload')
      }
      const lines = input.payload.lines.map((line) => {
        if (
          !hasExactKeys(line, ['productId', 'quantityMilli']) ||
          typeof line.productId !== 'string' ||
          !Number.isSafeInteger(line.quantityMilli)
        ) {
          throw new Error('invalid mini app stock command line')
        }
        return { productId: line.productId, quantityMilli: line.quantityMilli as number }
      })
      const commandType = input.commandType === 'RECEIVE' ? 'RECEIVE' : 'ISSUE'
      return { ...common, commandType, payload: { lines } }
    }
    case 'ADJUST': {
      const keys = ['productId', 'countedQuantityMilli', 'reason'] as const
      if (
        !hasExactKeys(input.payload, keys) ||
        typeof input.payload.productId !== 'string' ||
        !Number.isSafeInteger(input.payload.countedQuantityMilli) ||
        typeof input.payload.reason !== 'string'
      ) {
        throw new Error('invalid mini app stock command payload')
      }
      return {
        ...common,
        commandType: 'ADJUST',
        payload: {
          productId: input.payload.productId,
          countedQuantityMilli: input.payload.countedQuantityMilli as number,
          reason: input.payload.reason,
        },
      }
    }
    case 'UPDATE_PRODUCT': {
      const keys = [
        'productId', 'expectedVersion', 'name', 'category', 'unit', 'minimumQuantityMilli',
      ] as const
      if (
        !hasExactKeys(input.payload, keys) ||
        typeof input.payload.productId !== 'string' ||
        !Number.isSafeInteger(input.payload.expectedVersion) ||
        typeof input.payload.name !== 'string' ||
        !isCategory(input.payload.category) ||
        typeof input.payload.unit !== 'string' ||
        !Number.isSafeInteger(input.payload.minimumQuantityMilli)
      ) {
        throw new Error('invalid mini app stock command payload')
      }
      return {
        ...common,
        commandType: 'UPDATE_PRODUCT',
        payload: {
          productId: input.payload.productId,
          expectedVersion: input.payload.expectedVersion as number,
          name: input.payload.name,
          category: input.payload.category,
          unit: input.payload.unit,
          minimumQuantityMilli: input.payload.minimumQuantityMilli as number,
        },
      }
    }
    case 'DEACTIVATE_PRODUCT':
    case 'REACTIVATE_PRODUCT': {
      if (
        !hasExactKeys(input.payload, ['productId', 'expectedVersion']) ||
        typeof input.payload.productId !== 'string' ||
        !Number.isSafeInteger(input.payload.expectedVersion)
      ) {
        throw new Error('invalid mini app stock command payload')
      }
      const commandType = input.commandType === 'DEACTIVATE_PRODUCT'
        ? 'DEACTIVATE_PRODUCT'
        : 'REACTIVATE_PRODUCT'
      return {
        ...common,
        commandType,
        payload: {
          productId: input.payload.productId,
          expectedVersion: input.payload.expectedVersion as number,
        },
      }
    }
    default:
      throw new Error('invalid mini app stock command')
  }
}

function isCategory(value: unknown): value is StockCategory {
  return value === 'CLINIC_SUPPLY' || value === 'RETAIL_PRODUCT'
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
