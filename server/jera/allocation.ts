import { createHash } from 'node:crypto'
import type { PaymentRevenueAllocation } from '../../shared/pmcFinance.js'
import type { JeraItemTypeMetadataSource } from './contracts.js'

type MappedRevenueCategory = 'SERVICE' | 'PRODUCT'
type AllocationCategory = MappedRevenueCategory | 'UNCLASSIFIED'

export interface JeraItemTypeMetadata {
  byItemCode: ReadonlyMap<string, MappedRevenueCategory>
  ambiguousItemCodes: string[]
  snapshotHash: string
}

export interface AllocatePaymentRevenueInput {
  paymentUuid: string
  paymentSourceHash: string
  paidAmountSatang: number
  paymentType: string | null
  detail: null | {
    truncated: boolean
    lines: Array<{ kind: 'OPD' | 'COURSE'; itemCode: string | null; netLineSatang: number }>
  }
  metadata: JeraItemTypeMetadata
}

export function buildItemTypeMetadata(rows: ReadonlyArray<JeraItemTypeMetadataSource>): JeraItemTypeMetadata {
  const mappedTypesByCode = new Map<string, Set<MappedRevenueCategory>>()
  for (const row of rows) {
    const mappedType = mapProviderItemType(row.type)
    if (!row.itemCode || !mappedType) continue
    const mappedTypes = mappedTypesByCode.get(row.itemCode) ?? new Set<MappedRevenueCategory>()
    mappedTypes.add(mappedType)
    mappedTypesByCode.set(row.itemCode, mappedTypes)
  }

  const byItemCode = new Map<string, MappedRevenueCategory>()
  const ambiguousItemCodes: string[] = []
  for (const [itemCode, mappedTypes] of [...mappedTypesByCode.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (mappedTypes.size !== 1) {
      ambiguousItemCodes.push(itemCode)
      continue
    }
    byItemCode.set(itemCode, [...mappedTypes][0])
  }

  const pairs = [...byItemCode.entries()].sort(([left], [right]) => left.localeCompare(right))
  return {
    byItemCode,
    ambiguousItemCodes,
    snapshotHash: createHash('sha256').update(JSON.stringify(pairs)).digest('hex'),
  }
}

export function allocatePaymentRevenue(input: AllocatePaymentRevenueInput): PaymentRevenueAllocation {
  if (!Number.isSafeInteger(input.paidAmountSatang) || input.paidAmountSatang < 0) {
    throw new Error('JERA_ALLOCATION_INVALID_MONEY')
  }
  if (isDeposit(input.paymentType) || !input.detail || input.detail.truncated) {
    return unclassified(input, input.detail?.truncated ? 'DETAIL_TRUNCATED' : 'DETAIL_UNAVAILABLE')
  }

  const weights: Record<AllocationCategory, bigint> = { SERVICE: 0n, PRODUCT: 0n, UNCLASSIFIED: 0n }
  for (const line of input.detail.lines) {
    if (!Number.isSafeInteger(line.netLineSatang) || line.netLineSatang <= 0) continue
    const category: AllocationCategory = line.kind === 'COURSE'
      ? 'SERVICE'
      : line.itemCode ? input.metadata.byItemCode.get(line.itemCode) ?? 'UNCLASSIFIED' : 'UNCLASSIFIED'
    weights[category] += BigInt(line.netLineSatang)
  }

  const totalWeight = weights.SERVICE + weights.PRODUCT + weights.UNCLASSIFIED
  if (totalWeight === 0n) return unclassified(input, 'ZERO_ALLOCATION_WEIGHT')
  const allocated = largestRemainder(input.paidAmountSatang, weights, ['SERVICE', 'PRODUCT', 'UNCLASSIFIED'])
  return {
    paymentUuid: input.paymentUuid,
    paymentSourceHash: input.paymentSourceHash,
    serviceSatang: allocated.SERVICE,
    productSatang: allocated.PRODUCT,
    unclassifiedSatang: allocated.UNCLASSIFIED,
    warningCodes: [],
  }
}

function mapProviderItemType(value: string | null): MappedRevenueCategory | null {
  switch (value?.toLowerCase()) {
    case 'medicine':
    case 'product':
      return 'PRODUCT'
    case 'service':
    case 'course':
    case 'ขายบริการ':
      return 'SERVICE'
    default:
      return null
  }
}

function isDeposit(paymentType: string | null): boolean {
  const normalized = paymentType?.toUpperCase()
  return normalized === 'CASH_DEPOSIT' || normalized === 'PRODUCT_DEPOSIT'
}

function unclassified(input: AllocatePaymentRevenueInput, warningCode: string): PaymentRevenueAllocation {
  return {
    paymentUuid: input.paymentUuid,
    paymentSourceHash: input.paymentSourceHash,
    serviceSatang: 0,
    productSatang: 0,
    unclassifiedSatang: input.paidAmountSatang,
    warningCodes: [warningCode],
  }
}

function largestRemainder(
  paidAmountSatang: number,
  weights: Record<AllocationCategory, bigint>,
  categories: AllocationCategory[],
): Record<AllocationCategory, number> {
  const paidAmount = BigInt(paidAmountSatang)
  const totalWeight = categories.reduce((sum, category) => sum + weights[category], 0n)
  const allocated = { SERVICE: 0, PRODUCT: 0, UNCLASSIFIED: 0 }
  const remainders = categories.map((category) => {
    const numerator = paidAmount * weights[category]
    const base = numerator / totalWeight
    if (base > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('JERA_ALLOCATION_INVALID_MONEY')
    allocated[category] = Number(base)
    return { category, remainder: numerator % totalWeight }
  })
  let remaining = paidAmount - categories.reduce((sum, category) => sum + BigInt(allocated[category]), 0n)
  remainders.sort((left, right) => (
    left.remainder === right.remainder
      ? categories.indexOf(left.category) - categories.indexOf(right.category)
      : left.remainder > right.remainder ? -1 : 1
  ))
  for (const { category } of remainders) {
    if (remaining === 0n) break
    allocated[category] += 1
    remaining -= 1n
  }
  return allocated
}
