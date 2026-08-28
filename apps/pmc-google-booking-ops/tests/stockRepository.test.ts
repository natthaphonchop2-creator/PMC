import { describe, expect, it } from 'vitest'
import type { StockAuditEvent, StockLedgerEntry, StockProduct } from '../../../shared/pmcStock'
import { createStockRepository, type SheetRow } from '../src/repositories'
import { createMemorySheetStore } from './helpers/fakes'

function productFixture(patch: Partial<StockProduct> = {}): StockProduct {
  return {
    productId: 'STK-000001',
    name: 'น้ำเกลือ',
    normalizedName: 'น้ำเกลือ',
    category: 'CLINIC_SUPPLY',
    unit: 'ขวด',
    minimumQuantityMilli: 2_000,
    active: true,
    createdAt: '2026-08-28T09:00:00+07:00',
    createdByStaffId: 'staff-1',
    updatedAt: '2026-08-28T09:00:00+07:00',
    updatedByStaffId: 'staff-1',
    version: 1,
    ...patch,
  }
}

function ledgerFixture(patch: Partial<StockLedgerEntry> = {}): StockLedgerEntry {
  return {
    transactionId: 'TX-1',
    documentId: 'ISS-202608-0001',
    requestId: 'request-stock-1',
    lineNumber: 1,
    productId: 'STK-000001',
    transactionType: 'OPENING',
    quantityDeltaMilli: 1_000,
    balanceBeforeMilli: 0,
    balanceAfterMilli: 1_000,
    actorStaffId: 'staff-1',
    actorDisplayName: 'ผู้ดูแลสต็อก',
    reason: 'ใช้ในคลินิก',
    idempotencyKey: 'request-stock-1:1',
    createdAt: '2026-08-28T09:00:00+07:00',
    ...patch,
  }
}

function auditFixture(patch: Partial<StockAuditEvent> = {}): StockAuditEvent {
  return {
    eventId: 'AUD-STOCK-1',
    requestId: 'request-stock-1',
    actorStaffId: 'staff-1',
    action: 'ISSUE',
    status: 'ACCEPTED',
    safeErrorCode: '',
    targetProductIdsJson: '["STK-000001"]',
    correlationId: 'ISS-1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: '2026-08-28T09:00:00+07:00',
    ...patch,
  }
}

function preparedAuditFixture(patch: Partial<StockAuditEvent> = {}): StockAuditEvent {
  return auditFixture({
    eventId: 'AUD-STOCK-PREPARED-1',
    status: 'PREPARED' as StockAuditEvent['status'],
    correlationId: 'ISS-1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    targetProductIdsJson: '["STK-000001"]',
    ...patch,
  })
}

function acceptedAuditFixture(patch: Partial<StockAuditEvent> = {}): StockAuditEvent {
  return preparedAuditFixture({ eventId: 'AUD-STOCK-ACCEPTED-1', status: 'ACCEPTED', ...patch })
}

describe('stock repository', () => {
  it('derives current balances only from immutable ledger rows', () => {
    const store = createMemorySheetStore()
    const repository = createStockRepository(store)
    repository.insertProduct(productFixture())
    repository.appendLedgerBatch([
      ledgerFixture({ transactionId: 'TX-1', quantityDeltaMilli: 10_000, balanceBeforeMilli: 0, balanceAfterMilli: 10_000 }),
      ledgerFixture({
        transactionId: 'TX-2',
        lineNumber: 2,
        quantityDeltaMilli: -2_000,
        balanceBeforeMilli: 10_000,
        balanceAfterMilli: 8_000,
      }),
    ])

    expect(repository.balanceByProduct()).toEqual(new Map([['STK-000001', 8_000]]))
  })

  it('finds a completed document by request ID for idempotent retry', () => {
    const store = createMemorySheetStore()
    const repository = createStockRepository(store)
    repository.insertProduct(productFixture())
    repository.appendLedgerBatch([ledgerFixture({ requestId: 'request-stock-1' })])

    expect(repository.findDocumentByRequestId('request-stock-1')?.documentId).toBe('ISS-202608-0001')
  })

  it('finds the single accepted audit event for durable command idempotency', () => {
    const repository = createStockRepository(createMemorySheetStore())
    repository.appendAudit(auditFixture({ status: 'REJECTED', safeErrorCode: 'STOCK_MANAGER_REQUIRED' }))
    const prepared = preparedAuditFixture()
    const accepted = acceptedAuditFixture()
    repository.appendAudit(prepared)
    repository.appendAudit(accepted)

    expect(repository.findAcceptedAuditByRequestId('request-stock-1')).toEqual(accepted)
    expect(repository.findAcceptedAuditByRequestId('missing-request')).toBeNull()
  })

  it('returns one coherent prepared and accepted journal pair', () => {
    const repository = createStockRepository(createMemorySheetStore())
    const prepared = preparedAuditFixture()
    const accepted = acceptedAuditFixture()
    repository.appendAudit(prepared)
    repository.appendAudit(accepted)

    expect(repository.findAuditJournalByRequestId('request-stock-1')).toEqual({ prepared, accepted })
    expect(repository.findAuditJournalByRequestId('missing-request')).toEqual({ prepared: null, accepted: null })
  })

  it('lists only prepared requests that have not reached accepted', () => {
    const repository = createStockRepository(createMemorySheetStore())
    const unresolved = preparedAuditFixture({ requestId: 'request-unresolved' })
    const completedPrepared = preparedAuditFixture({ requestId: 'request-completed', eventId: 'AUD-PREP-COMPLETE' })
    const completedAccepted = acceptedAuditFixture({ requestId: 'request-completed', eventId: 'AUD-ACCEPT-COMPLETE' })
    repository.appendAudit(unresolved)
    repository.appendAudit(completedPrepared)
    repository.appendAudit(completedAccepted)

    expect(repository.listUnresolvedPrepared()).toEqual([unresolved])
  })

  it('fails closed on malformed or multiple unresolved prepared journals', () => {
    const malformedStore = createMemorySheetStore()
    malformedStore.replace('STOCK_AUDIT', [
      preparedAuditFixture({ correlationId: 'malformed' }),
    ] as unknown as SheetRow[])
    expect(() => createStockRepository(malformedStore).listUnresolvedPrepared()).toThrow(
      'stock audit journal invalid',
    )

    const repository = createStockRepository(createMemorySheetStore())
    repository.appendAudit(preparedAuditFixture({ requestId: 'pending-one' }))
    repository.appendAudit(preparedAuditFixture({
      requestId: 'pending-two', eventId: 'AUD-PENDING-2',
      correlationId: 'ISS-2|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    }))
    expect(() => repository.listUnresolvedPrepared()).toThrow('stock multiple unresolved prepared audits')
  })

  it.each([
    ['non-string correlation', { correlationId: 42 as unknown as string }],
    ['non-string target JSON', { targetProductIdsJson: 42 as unknown as string }],
    ['invalid created time', { createdAt: 'not-a-time' }],
  ])('rejects a persisted pending journal with %s using the safe integrity error', (_case, patch) => {
    const store = createMemorySheetStore()
    store.replace('STOCK_AUDIT', [preparedAuditFixture(patch)] as unknown as SheetRow[])

    expect(() => createStockRepository(store).listUnresolvedPrepared()).toThrow('stock audit journal invalid')
  })

  it.each([
    ['action', { action: 'RECEIVE' }],
    ['actor', { actorStaffId: 'staff-2' }],
    ['targets', { targetProductIdsJson: '["STK-000002"]' }],
    ['correlation', { correlationId: 'ISS-2|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['created time', { createdAt: '2026-08-28T09:01:00+07:00' }],
  ])('rejects prepared and accepted audit rows that disagree on %s', (_field, patch) => {
    const repository = createStockRepository(createMemorySheetStore())
    repository.appendAudit(preparedAuditFixture())

    expect(() => repository.appendAudit(acceptedAuditFixture(patch))).toThrow('stock audit journal mismatch')
  })

  it('rejects a second prepared audit for one request ID', () => {
    const repository = createStockRepository(createMemorySheetStore())
    repository.appendAudit(preparedAuditFixture())

    expect(() => repository.appendAudit(preparedAuditFixture({ eventId: 'AUD-STOCK-PREPARED-2' }))).toThrow(
      'stock prepared audit already exists',
    )
  })

  it('rejects a second accepted audit for one request ID', () => {
    const repository = createStockRepository(createMemorySheetStore())
    repository.appendAudit(preparedAuditFixture())
    repository.appendAudit(acceptedAuditFixture())

    expect(() => repository.appendAudit(acceptedAuditFixture({ eventId: 'AUD-STOCK-2' }))).toThrow(
      'stock accepted audit already exists',
    )
  })

  it('rejects persisted duplicate accepted audits for one request ID', () => {
    const store = createMemorySheetStore()
    store.replace('STOCK_AUDIT', [
      auditFixture(),
      auditFixture({ eventId: 'AUD-STOCK-2' }),
    ] as unknown as SheetRow[])
    const repository = createStockRepository(store)

    expect(() => repository.findAcceptedAuditByRequestId('request-stock-1')).toThrow(
      'stock accepted audit conflict',
    )
  })

  it('serializes stock rows in their exact Sheet header order', () => {
    const store = createMemorySheetStore()
    const repository = createStockRepository(store)
    repository.insertProduct(productFixture())
    repository.appendLedgerBatch([ledgerFixture()])
    repository.appendAudit(preparedAuditFixture())

    expect(Object.keys(store.read('STOCK_PRODUCTS')[0])).toEqual([
      'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
      'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
    ])
    expect(Object.keys(store.read('STOCK_LEDGER')[0])).toEqual([
      'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
      'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
      'reason', 'idempotencyKey', 'createdAt',
    ])
    expect(Object.keys(store.read('STOCK_AUDIT')[0])).toEqual([
      'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
      'targetProductIdsJson', 'correlationId', 'createdAt',
    ])
  })

  it('rejects duplicate product IDs and stale product updates', () => {
    const repository = createStockRepository(createMemorySheetStore())
    repository.insertProduct(productFixture())

    expect(() => repository.insertProduct(productFixture())).toThrow('stock product already exists')
    expect(() => repository.updateProduct('STK-000001', 2, { name: 'ใหม่' })).toThrow('version conflict')
    expect(repository.updateProduct('STK-000001', 1, { name: 'ใหม่' })).toMatchObject({ name: 'ใหม่', version: 2 })
  })

  it('rejects conflicting request documents, duplicate transactions, and broken balance chains', () => {
    const repository = createStockRepository(createMemorySheetStore())
    repository.insertProduct(productFixture())
    repository.appendLedgerBatch([ledgerFixture()])

    expect(() => repository.appendLedgerBatch([ledgerFixture({ transactionId: 'TX-2', documentId: 'ISS-202608-0002' })])).toThrow(
      'stock request conflicts with document',
    )
    expect(() => repository.appendLedgerBatch([ledgerFixture()])).toThrow('stock transaction already exists')
    expect(() => repository.appendLedgerBatch([
      ledgerFixture({
        transactionId: 'TX-3',
        requestId: 'request-stock-2',
        documentId: 'ISS-202608-0002',
        balanceBeforeMilli: 9_001,
        balanceAfterMilli: 8_001,
      }),
    ])).toThrow('stock balance chain mismatch')
  })

  it('rejects a document ID reused by a different request', () => {
    const repository = createStockRepository(createMemorySheetStore())
    repository.insertProduct(productFixture())
    repository.appendLedgerBatch([ledgerFixture()])

    expect(() => repository.appendLedgerBatch([
      ledgerFixture({
        transactionId: 'TX-2',
        requestId: 'request-stock-2',
        balanceBeforeMilli: 1_000,
        balanceAfterMilli: 2_000,
      }),
    ])).toThrow('stock document conflicts with request')
  })

  it('rejects an unrelated append when persisted rows reuse a document ID across requests', () => {
    const store = createMemorySheetStore()
    store.replace('STOCK_LEDGER', [
      ledgerFixture(),
      ledgerFixture({
        transactionId: 'TX-2',
        requestId: 'request-stock-2',
        lineNumber: 2,
        balanceBeforeMilli: 1_000,
        balanceAfterMilli: 2_000,
      }),
    ] as unknown as SheetRow[])
    const repository = createStockRepository(store)

    expect(() => repository.appendLedgerBatch([
      ledgerFixture({
        transactionId: 'TX-3',
        requestId: 'request-stock-3',
        documentId: 'ISS-202608-0003',
        lineNumber: 3,
        balanceBeforeMilli: 2_000,
        balanceAfterMilli: 3_000,
      }),
    ])).toThrow('stock document conflicts with request')
  })

  it.each([
    [
      'an empty request ID associated with a reused document',
      ledgerFixture({ requestId: '' }),
      ledgerFixture({
        transactionId: 'TX-2',
        requestId: 'request-stock-2',
        balanceBeforeMilli: 1_000,
        balanceAfterMilli: 2_000,
      }),
    ],
    [
      'an empty document ID associated with a reused request',
      ledgerFixture({ documentId: '' }),
      ledgerFixture({
        transactionId: 'TX-2',
        documentId: 'ISS-202608-0002',
        balanceBeforeMilli: 1_000,
        balanceAfterMilli: 2_000,
      }),
    ],
  ])('rejects an incoming row when existing ledger has %s', (_description, corruptRow, incomingRow) => {
    const store = createMemorySheetStore()
    store.replace('STOCK_LEDGER', [corruptRow] as unknown as SheetRow[])
    const repository = createStockRepository(store)

    expect(() => repository.appendLedgerBatch([incomingRow])).toThrow('stock ledger invalid ID')
  })

  it.each([
    'transactionId',
    'requestId',
    'documentId',
    'productId',
    'actorStaffId',
    'idempotencyKey',
  ] as const)('rejects an incoming empty %s', (field) => {
    const repository = createStockRepository(createMemorySheetStore())
    const entry = ledgerFixture({ [field]: '' })

    expect(() => repository.appendLedgerBatch([entry])).toThrow('stock ledger invalid ID')
  })

  it('rejects unsafe required ledger IDs', () => {
    const repository = createStockRepository(createMemorySheetStore())

    expect(() => repository.appendLedgerBatch([ledgerFixture({ idempotencyKey: 'unsafe/key' })])).toThrow(
      'stock ledger invalid ID',
    )
  })

  it.each([
    [
      'duplicate transaction IDs',
      [
        ledgerFixture(),
        ledgerFixture({ transactionId: 'TX-1', lineNumber: 2, balanceBeforeMilli: 1_000, balanceAfterMilli: 2_000 }),
      ],
      'stock transaction already exists',
    ],
    [
      'request IDs associated with different documents',
      [
        ledgerFixture(),
        ledgerFixture({ transactionId: 'TX-2', documentId: 'ISS-202608-0002', lineNumber: 2, balanceBeforeMilli: 1_000, balanceAfterMilli: 2_000 }),
      ],
      'stock request conflicts with document',
    ],
    [
      'mismatched stored balance chains',
      [ledgerFixture({ balanceBeforeMilli: 1, balanceAfterMilli: 1_001 })],
      'stock balance chain mismatch',
    ],
  ])('rejects an unrelated append when existing ledger has %s', (_description, corruptRows, expectedError) => {
    const store = createMemorySheetStore()
    store.replace('STOCK_LEDGER', corruptRows as unknown as SheetRow[])
    const repository = createStockRepository(store)
    const balanceBeforeMilli = corruptRows.reduce((balance, entry) => balance + entry.quantityDeltaMilli, 0)

    expect(() => repository.appendLedgerBatch([
      ledgerFixture({
        transactionId: 'TX-3',
        requestId: 'request-stock-3',
        documentId: 'ISS-202608-0003',
        balanceBeforeMilli,
        balanceAfterMilli: balanceBeforeMilli + 1_000,
      }),
    ])).toThrow(expectedError)
  })
})
