import { describe, expect, it } from 'vitest'
import { createStockTestSystem } from './helpers/stockSystem'

describe('PMC Stock real-domain lifecycle', () => {
  it('creates, receives, issues, adjusts, and reconciles one immutable ledger', async () => {
    const system = createStockTestSystem()
    const product = await system.createProduct({ openingQuantityMilli: 10_000, minimumQuantityMilli: 3_000 })
    await system.receive([{ productId: product.productId, quantityMilli: 5_000 }])
    await system.issue([{ productId: product.productId, quantityMilli: 8_000 }])
    await system.adjust({ productId: product.productId, countedQuantityMilli: 6_000, reason: 'ตรวจนับสิ้นวัน' })

    expect(await system.balance(product.productId)).toBe(6_000)
    expect(system.ledgerDeltas(product.productId)).toEqual([10_000, 5_000, -8_000, -1_000])
  })
})
