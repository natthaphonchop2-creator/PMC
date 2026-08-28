# PMC LINE Mini App Stock Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal LINE Mini App Stock ledger where active staff can view and issue multiple products, while the owner, อาย, and หมวย can add products, receive stock, reconcile physical counts, and manage products without operational access to Google Sheets.

**Architecture:** Google Sheets stores an immutable product/ledger/audit backend. Cloud Run verifies LINE identity and serves read APIs, while every mutation is signed and sent to the existing Apps Script web app, which rechecks the staff role, acquires `LockService`, validates the entire document, and appends one idempotent ledger batch.

**Tech Stack:** React 19, TypeScript 6, Vite 8, LINE LIFF, Node.js Cloud Run, Google Sheets API, Google Apps Script V8, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-pmc-mini-app-stock-ledger-design.md`

## Global Constraints

- Staff perform every Stock operation inside LINE Mini App; no Sheet URL or direct Sheet-edit workflow is exposed.
- Google Sheets remains the private backend and is directly accessible only to developers.
- Version 1 supports `OPENING`, `RECEIVE`, `ISSUE`, and `ADJUST`; no JERA integration, case/customer linkage, supplier, lot, expiry, barcode, cost, or multi-unit conversion.
- Product categories are exactly `CLINIC_SUPPLY` and `RETAIL_PRODUCT`.
- Quantities use integer milli-units (`1 unit = 1000 milli-units`) and accept at most three decimal places.
- One issue or receive document may contain multiple products; duplicate product lines are rejected.
- No issue may make any product balance negative.
- Every mutation is idempotent by `requestId`, HMAC-signed, timestamp-bounded, nonce-protected, role-checked, and executed under Apps Script Lock.
- Initial Stock-manager staff IDs are exactly `shared-account-test`, `ADMIN_07`, and `ADMIN_03`; all other existing staff default to `canManageStock=false`.
- Existing Booking, Drive evidence, Calendar, LINE notification, call queue, JERA pause, enrollment, reports, and Google Form fallback behavior must remain unchanged.
- Ship behind `PMC_STOCK_ENABLED=false`; use `PMC_STOCK_MANAGER_PILOT_ONLY=true` for the three-manager pilot, then set it false only after owner approval.

## File Structure

### Shared contracts

- Create `shared/pmcStock.ts` — Stock domain types, quantity conversion, product and ledger projections.
- Create `shared/pmcMiniAppStockIngress.ts` — exact signed command envelope and canonical serialization.

### Cloud Run

- Create `server/pmc-mini-app/stock/readStore.ts` — allowlisted Sheet reads and ledger aggregation.
- Create `server/pmc-mini-app/stock/ingressClient.ts` — signed Apps Script command client.
- Create `server/pmc-mini-app/stock/middleware.ts` — authenticated Stock API router and safe errors.
- Modify `server/pmc-mini-app/config.ts` — `PMC_STOCK_ENABLED` and `PMC_STOCK_MANAGER_PILOT_ONLY` parsing.
- Modify `server/pmc-mini-app/contracts.ts` — staff Stock role and client projections.
- Modify `server/pmc-mini-app/googleClient.ts` — no new scopes; reuse exact Sheet port.
- Modify `server/pmc-mini-app/middleware.ts` — route `/api/mini-app/stock/*` after LINE authentication.
- Modify `server/pmc-mini-app/runtime.ts` — construct Stock read store, ingress client, and router.
- Modify `server/pmc-mini-app/setup.ts` — three managed Stock tabs.
- Modify `server/pmc-mini-app/store.ts` — read `CONFIG_STAFF!A:I` and expose `canManageStock`.

### Apps Script

- Create `apps/pmc-google-booking-ops/src/stock/repository.ts` — product, ledger, and audit Sheet repository.
- Create `apps/pmc-google-booking-ops/src/stock/commands.ts` — lock-protected command handlers.
- Create `apps/pmc-google-booking-ops/src/stock/ingress.ts` — envelope verification, replay checks, and role authorization.
- Modify `apps/pmc-google-booking-ops/src/sheetSchema.ts` — Stock schemas and `canManageStock` staff column.
- Modify `apps/pmc-google-booking-ops/src/ports.ts` — focused Stock repository port.
- Modify `apps/pmc-google-booking-ops/src/repositories.ts` — construct Stock repository.
- Modify `apps/pmc-google-booking-ops/src/runtime.ts` — expose Stock repository and manager setup workflow.
- Modify `apps/pmc-google-booking-ops/src/entrypoints.ts` — route `MINI_APP_STOCK` and expose setup entrypoint.
- Modify `apps/pmc-google-booking-ops/scripts/build.mjs` — export `configurePmcStockManagers`.

### Mini App client

- Create `src/apps/pmc-mini-app/stock/stockModel.ts` — reducer, validation, filters, projected balances.
- Create `src/apps/pmc-mini-app/stock/StockHome.tsx` — list, search, filters, low-stock badges, entry actions.
- Create `src/apps/pmc-mini-app/stock/StockIssueFlow.tsx` — multi-product issue cart and confirmation.
- Create `src/apps/pmc-mini-app/stock/StockManager.tsx` — create, receive, adjust, activate/deactivate flows.
- Create `src/apps/pmc-mini-app/stock/StockHistory.tsx` — read-only document history and details.
- Modify `src/apps/pmc-mini-app/contracts.ts` — Stock client contracts.
- Modify `src/apps/pmc-mini-app/api.ts` — Stock API methods.
- Modify `src/apps/pmc-mini-app/Home.tsx` — enable Stock card from server feature flag.
- Modify `src/apps/pmc-mini-app/PmcMiniApp.tsx` — `STOCK` route and adapters.
- Modify `src/apps/pmc-mini-app/preview.ts` — deterministic preview Stock API.
- Modify `src/apps/pmc-mini-app/styles.css` — mobile Stock components using existing PMC visual tokens.

---

### Task 1: Shared Stock Domain and Quantity Safety

**Files:**
- Create: `shared/pmcStock.ts`
- Test: `tests/pmc-mini-app/stockDomain.test.ts`

**Interfaces:**
- Consumes: no Stock dependencies.
- Produces: `StockCategory`, `StockTransactionType`, `StockProduct`, `StockLedgerEntry`, `StockAuditEvent`, `StockDocumentSummary`, `StockHistoryPage`, `MiniAppStockCommand`, `StockClientCommand`, `StockCommandResult`, `parseNonNegativeQuantityToMilli()`, `parseQuantityToMilli()`, `formatQuantityMilli()`, `aggregateStockBalances()`.

- [ ] **Step 1: Write failing quantity and balance tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  aggregateStockBalances,
  formatQuantityMilli,
  parseNonNegativeQuantityToMilli,
  parseQuantityToMilli,
} from '../../shared/pmcStock'

describe('PMC Stock shared domain', () => {
  it.each([
    ['1', 1000],
    ['1.25', 1250],
    ['0.001', 1],
  ])('converts %s to integer milli-units', (input, expected) => {
    expect(parseQuantityToMilli(input)).toBe(expected)
  })

  it('allows an exact zero only for physical-count reconciliation', () => {
    expect(parseNonNegativeQuantityToMilli('0')).toBe(0)
  })

  it.each(['0', '-1', '1.0001', 'NaN', ''])('rejects unsafe quantity %s', (input) => {
    expect(() => parseQuantityToMilli(input)).toThrow('STOCK_INVALID_QUANTITY')
  })

  it('aggregates immutable deltas without floating point drift', () => {
    expect(aggregateStockBalances([
      { productId: 'STK-000001', quantityDeltaMilli: 10_000 },
      { productId: 'STK-000001', quantityDeltaMilli: -1_250 },
      { productId: 'STK-000002', quantityDeltaMilli: 500 },
    ])).toEqual(new Map([['STK-000001', 8_750], ['STK-000002', 500]]))
    expect(formatQuantityMilli(8_750)).toBe('8.75')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run tests/pmc-mini-app/stockDomain.test.ts`

Expected: FAIL because `shared/pmcStock.ts` does not exist.

- [ ] **Step 3: Implement the shared domain**

```ts
export const STOCK_QUANTITY_SCALE = 1000
export type StockCategory = 'CLINIC_SUPPLY' | 'RETAIL_PRODUCT'
export type StockTransactionType = 'OPENING' | 'RECEIVE' | 'ISSUE' | 'ADJUST'

export interface StockProduct {
  productId: string
  name: string
  normalizedName: string
  category: StockCategory
  unit: string
  minimumQuantityMilli: number
  active: boolean
  createdAt: string
  createdByStaffId: string
  updatedAt: string
  updatedByStaffId: string
  version: number
}

export interface StockLedgerEntry {
  transactionId: string
  documentId: string
  requestId: string
  lineNumber: number
  productId: string
  transactionType: StockTransactionType
  quantityDeltaMilli: number
  balanceBeforeMilli: number
  balanceAfterMilli: number
  actorStaffId: string
  actorDisplayName: string
  reason: string
  idempotencyKey: string
  createdAt: string
}

export interface StockAuditEvent {
  eventId: string
  requestId: string
  actorStaffId: string
  action: string
  status: 'ACCEPTED' | 'REJECTED' | 'RECOVERED'
  safeErrorCode: string
  targetProductIdsJson: string
  correlationId: string
  createdAt: string
}

export interface StockDocumentSummary {
  documentId: string
  requestId: string
  transactionType: StockTransactionType
  actorStaffId: string
  actorDisplayName: string
  createdAt: string
  reason: string
  lineCount: number
  lines: Array<{
    productId: string
    productName: string
    unit: string
    quantityDeltaMilli: number
    balanceBeforeMilli: number
    balanceAfterMilli: number
  }>
}

export interface StockHistoryPage {
  documents: StockDocumentSummary[]
  nextCursor: string | null
}

export type MiniAppStockCommand =
  | { requestId: string; staffId: string; commandType: 'CREATE_PRODUCT'; payload: {
      name: string; category: StockCategory; unit: string; openingQuantityMilli: number; minimumQuantityMilli: number
    } }
  | { requestId: string; staffId: string; commandType: 'RECEIVE' | 'ISSUE'; payload: {
      lines: Array<{ productId: string; quantityMilli: number }>
    } }
  | { requestId: string; staffId: string; commandType: 'ADJUST'; payload: {
      productId: string; countedQuantityMilli: number; reason: string
    } }
  | { requestId: string; staffId: string; commandType: 'UPDATE_PRODUCT'; payload: {
      productId: string; expectedVersion: number; name: string; category: StockCategory;
      unit: string; minimumQuantityMilli: number
    } }
  | { requestId: string; staffId: string; commandType: 'DEACTIVATE_PRODUCT' | 'REACTIVATE_PRODUCT'; payload: {
      productId: string; expectedVersion: number
    } }

type WithoutStaff<T> = T extends { staffId: string } ? Omit<T, 'staffId'> : never
export type StockClientCommand = WithoutStaff<MiniAppStockCommand>

export interface StockCommandResult {
  requestId: string
  documentId: string
  commandType: MiniAppStockCommand['commandType']
  createdAt: string
  lines: Array<{ productId: string; quantityDeltaMilli: number; balanceAfterMilli: number }>
}

export function parseNonNegativeQuantityToMilli(value: string): number {
  const normalized = value.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(normalized)) throw new Error('STOCK_INVALID_QUANTITY')
  const [whole, fraction = ''] = normalized.split('.')
  const result = Number(whole) * STOCK_QUANTITY_SCALE + Number(fraction.padEnd(3, '0'))
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('STOCK_INVALID_QUANTITY')
  return result
}

export function parseQuantityToMilli(value: string): number {
  const result = parseNonNegativeQuantityToMilli(value)
  if (result === 0) throw new Error('STOCK_INVALID_QUANTITY')
  return result
}

export function formatQuantityMilli(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('STOCK_INVALID_QUANTITY')
  return (value / STOCK_QUANTITY_SCALE).toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

export function aggregateStockBalances(
  entries: Array<Pick<StockLedgerEntry, 'productId' | 'quantityDeltaMilli'>>,
): Map<string, number> {
  const balances = new Map<string, number>()
  for (const entry of entries) {
    const next = (balances.get(entry.productId) ?? 0) + entry.quantityDeltaMilli
    if (!Number.isSafeInteger(next)) throw new Error('STOCK_BALANCE_OVERFLOW')
    balances.set(entry.productId, next)
  }
  return balances
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx vitest run tests/pmc-mini-app/stockDomain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/pmcStock.ts tests/pmc-mini-app/stockDomain.test.ts
git commit -m "feat: add PMC Stock domain"
```

### Task 2: Managed Stock Tabs and Staff Role

**Files:**
- Modify: `server/pmc-mini-app/setup.ts`
- Modify: `server/pmc-mini-app/store.ts`
- Modify: `server/pmc-mini-app/contracts.ts`
- Modify: `apps/pmc-google-booking-ops/src/sheetSchema.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/staffDirectory.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Test: `tests/pmc-mini-app/setup.test.ts`
- Test: `tests/pmc-mini-app/store.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/staffDirectory.test.ts`

**Interfaces:**
- Consumes: Task 1 Stock types.
- Produces: exact Stock headers, `MiniAppStaffRecord.canManageStock`, `StaffConfig.canManageStock`, and nine-column `CONFIG_STAFF!A:I` reads.

- [ ] **Step 1: Add failing managed-tab and role tests**

```ts
expect(Object.keys(MANAGED_TAB_HEADERS)).toEqual(expect.arrayContaining([
  'STOCK_PRODUCTS', 'STOCK_LEDGER', 'STOCK_AUDIT',
]))
expect(MANAGED_TAB_HEADERS.STOCK_PRODUCTS).toEqual([
  'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
  'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
])
expect(MANAGED_TAB_HEADERS.STOCK_LEDGER).toEqual([
  'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
  'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
  'reason', 'idempotencyKey', 'createdAt',
])
expect(MANAGED_TAB_HEADERS.STOCK_AUDIT).toEqual([
  'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
  'targetProductIdsJson', 'correlationId', 'createdAt',
])
```

Add a store fixture with `canManageStock=true` in column I and assert the returned staff record includes it. Add an old eight-column fixture and assert it defaults false.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx vitest run tests/pmc-mini-app/setup.test.ts tests/pmc-mini-app/store.test.ts \
  apps/pmc-google-booking-ops/tests/staffDirectory.test.ts
```

Expected: FAIL because Stock tabs and `canManageStock` are absent.

- [ ] **Step 3: Add exact schemas and role parsing**

Append `canManageStock` to `STAFF_CONFIG_COLUMNS`. Change all server staff ranges from `A:H` to `A:I`. Parse manager access only with the existing strict boolean parser; absent values remain false.

```ts
export const STOCK_PRODUCT_HEADERS = [
  'productId', 'name', 'normalizedName', 'category', 'unit', 'minimumQuantityMilli', 'active',
  'createdAt', 'createdByStaffId', 'updatedAt', 'updatedByStaffId', 'version',
] as const

export const STOCK_LEDGER_HEADERS = [
  'transactionId', 'documentId', 'requestId', 'lineNumber', 'productId', 'transactionType',
  'quantityDeltaMilli', 'balanceBeforeMilli', 'balanceAfterMilli', 'actorStaffId', 'actorDisplayName',
  'reason', 'idempotencyKey', 'createdAt',
] as const

export const STOCK_AUDIT_HEADERS = [
  'eventId', 'requestId', 'actorStaffId', 'action', 'status', 'safeErrorCode',
  'targetProductIdsJson', 'correlationId', 'createdAt',
] as const
```

- [ ] **Step 4: Run tests and typechecks**

Run:

```bash
npx vitest run tests/pmc-mini-app/setup.test.ts tests/pmc-mini-app/store.test.ts \
  apps/pmc-google-booking-ops/tests/staffDirectory.test.ts
npm run booking:typecheck
npx tsc -p tsconfig.server.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pmc-mini-app/setup.ts server/pmc-mini-app/store.ts server/pmc-mini-app/contracts.ts \
  apps/pmc-google-booking-ops/src/sheetSchema.ts apps/pmc-google-booking-ops/src/domain/staffDirectory.ts \
  apps/pmc-google-booking-ops/src/ports.ts tests/pmc-mini-app/setup.test.ts tests/pmc-mini-app/store.test.ts \
  apps/pmc-google-booking-ops/tests/staffDirectory.test.ts
git commit -m "feat: add PMC Stock sheet schemas"
```

### Task 3: Apps Script Stock Repository and Balance Projection

**Files:**
- Create: `apps/pmc-google-booking-ops/src/stock/repository.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/repositories.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`
- Test: `apps/pmc-google-booking-ops/tests/stockRepository.test.ts`

**Interfaces:**
- Consumes: `StockProduct`, `StockLedgerEntry`, `aggregateStockBalances()` from Task 1 and the existing `SheetStore`.
- Produces: `StockRepository` with product, ledger, audit, idempotency, and document operations.

- [ ] **Step 1: Write repository tests against a real in-memory SheetStore**

```ts
it('derives current balances only from immutable ledger rows', () => {
  const repository = createStockRepository(store)
  repository.insertProduct(productFixture())
  repository.appendLedgerBatch([
    ledgerFixture({ transactionId: 'TX-1', quantityDeltaMilli: 10_000, balanceBeforeMilli: 0, balanceAfterMilli: 10_000 }),
    ledgerFixture({ transactionId: 'TX-2', quantityDeltaMilli: -2_000, balanceBeforeMilli: 10_000, balanceAfterMilli: 8_000 }),
  ])
  expect(repository.balanceByProduct()).toEqual(new Map([['STK-000001', 8_000]]))
})

it('finds a completed document by request ID for idempotent retry', () => {
  const repository = createStockRepository(store)
  repository.appendLedgerBatch([ledgerFixture({ requestId: 'request-stock-1' })])
  expect(repository.findDocumentByRequestId('request-stock-1')?.documentId).toBe('ISS-202608-0001')
})
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/stockRepository.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement the focused repository port**

```ts
export interface StockRepository {
  listProducts(): StockProduct[]
  getProduct(productId: string): StockProduct | null
  insertProduct(product: StockProduct): StockProduct
  updateProduct(productId: string, expectedVersion: number, patch: Partial<StockProduct>): StockProduct
  listLedger(): StockLedgerEntry[]
  appendLedgerBatch(entries: StockLedgerEntry[]): void
  balanceByProduct(): Map<string, number>
  findDocumentByRequestId(requestId: string): StockDocumentSummary | null
  appendAudit(event: StockAuditEvent): void
}
```

Use exact header order serializers. Reject duplicate product IDs, request IDs with conflicting document IDs, duplicate transaction IDs, and mismatched `balanceBeforeMilli`/`balanceAfterMilli` chains.

- [ ] **Step 4: Run repository and existing repository tests**

Run:

```bash
npx vitest run apps/pmc-google-booking-ops/tests/stockRepository.test.ts \
  apps/pmc-google-booking-ops/tests/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pmc-google-booking-ops/src/stock/repository.ts \
  apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/src/repositories.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts \
  apps/pmc-google-booking-ops/tests/stockRepository.test.ts
git commit -m "feat: add PMC Stock repository"
```

### Task 4: Lock-Protected Stock Commands

**Files:**
- Create: `apps/pmc-google-booking-ops/src/stock/commands.ts`
- Test: `apps/pmc-google-booking-ops/tests/stockCommands.test.ts`

**Interfaces:**
- Consumes: Task 3 `StockRepository`, existing `Clock`, `LockPort`, and staff lookup.
- Produces: `executeStockCommand(input: MiniAppStockCommand, ports: StockCommandPorts): StockCommandResult` supporting create, receive, issue, adjust, update, deactivate, and reactivate.

- [ ] **Step 1: Write command tests for atomic issue and manager permissions**

```ts
it('rejects the complete multi-line issue when one product is insufficient', () => {
  const ports = stockPortsWithBalances({ 'STK-000001': 5_000, 'STK-000002': 1_000 })
  expect(() => executeStockCommand({
    requestId: 'request-issue-1', commandType: 'ISSUE', staffId: 'ADMIN_01',
    payload: { lines: [
      { productId: 'STK-000001', quantityMilli: 2_000 },
      { productId: 'STK-000002', quantityMilli: 2_000 },
    ] },
  }, ports)).toThrow('STOCK_INSUFFICIENT_BALANCE')
  expect(ports.stock.listLedger()).toHaveLength(2)
})

it('returns the original result for a repeated request ID', () => {
  const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
  const command = issueCommand('request-issue-2', 'STK-000001', 1_000)
  expect(executeStockCommand(command, ports)).toEqual(executeStockCommand(command, ports))
  expect(ports.stock.listLedger().filter(row => row.requestId === 'request-issue-2')).toHaveLength(1)
})
```

The initial ledger length assertion includes seeded opening rows, proving no issue line was appended after rejection.

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/stockCommands.test.ts`

Expected: FAIL because command execution is missing.

- [ ] **Step 3: Implement validation before one batch append**

```ts
export interface StockCommandPorts {
  clock: { nowIso(): string }
  locks: { withLock<T>(operation: () => T): T }
  staff: {
    findById(staffId: string): { id: string; name: string; active: boolean; canManageStock: boolean } | null
  }
  stock: StockRepository
  allocateId(prefix: 'STK' | 'ISS' | 'RCV' | 'ADJ' | 'TX' | 'AUDIT'): string
}

export function executeStockCommand(input: MiniAppStockCommand, ports: StockCommandPorts): StockCommandResult {
  return ports.locks.withLock(() => {
    const prior = ports.stock.findDocumentByRequestId(input.requestId)
    if (prior) return prior
    const actor = requireAuthorizedActor(input, ports)
    if (input.commandType === 'ISSUE') return issueProducts(input, actor, ports)
    requireManager(actor)
    if (input.commandType === 'CREATE_PRODUCT') return createProduct(input, actor, ports)
    if (input.commandType === 'RECEIVE') return receiveProducts(input, actor, ports)
    if (input.commandType === 'ADJUST') return adjustProduct(input, actor, ports)
    return manageProduct(input, actor, ports)
  })
}
```

For `ISSUE`, read all products and balances, reject inactive/duplicate/invalid lines, calculate every before/after pair, reject any negative result, then append the complete line array once. For `ADJUST`, calculate `delta = counted - current` and require a nonblank reason of at most 300 characters.

- [ ] **Step 4: Add a two-request lock test**

Use a deterministic fake lock. Seed 5 units; both requests attempt 4 units. Assert one succeeds, one throws `STOCK_INSUFFICIENT_BALANCE`, and final balance is 1 unit.

```ts
const ports = stockPortsWithBalances({ 'STK-000001': 5_000 })
expect(executeStockCommand(issueCommand('issue-a', 'STK-000001', 4_000), ports))
  .toMatchObject({ requestId: 'issue-a' })
expect(() => executeStockCommand(issueCommand('issue-b', 'STK-000001', 4_000), ports))
  .toThrow('STOCK_INSUFFICIENT_BALANCE')
expect(ports.stock.balanceByProduct().get('STK-000001')).toBe(1_000)
expect(ports.lockCalls()).toBe(2)
```

- [ ] **Step 5: Run command tests**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/stockCommands.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pmc-google-booking-ops/src/stock/commands.ts \
  apps/pmc-google-booking-ops/tests/stockCommands.test.ts
git commit -m "feat: add atomic PMC Stock commands"
```

### Task 5: Signed Stock Ingress

**Files:**
- Create: `shared/pmcMiniAppStockIngress.ts`
- Create: `server/pmc-mini-app/stock/ingressClient.ts`
- Create: `apps/pmc-google-booking-ops/src/stock/ingress.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Test: `tests/pmc-mini-app/stockIngressClient.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/stockIngress.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/build.test.ts`

**Interfaces:**
- Consumes: Task 4 `executeStockCommand()`.
- Produces: `canonicalMiniAppStockIngress()`, `createStockIngressClient()`, and Apps Script routing for `kind=MINI_APP_STOCK`.

- [ ] **Step 1: Write a fixed-vector HMAC client test**

```ts
const built = buildMiniAppStockIngress(commandFixture(), {
  timestamp: 1_800_000_000,
  nonce: 'nonce-stock-123',
}, 'stock-ingress-secret')
const { signature, ...unsigned } = built.body
expect(built.body.kind).toBe('MINI_APP_STOCK')
expect(signature).toBe(
  createHmac('sha256', 'stock-ingress-secret')
    .update(canonicalMiniAppStockIngress(unsigned))
    .digest('hex'),
)
expect(JSON.stringify(built.body)).not.toContain('stock-ingress-secret')
```

- [ ] **Step 2: Write Apps Script verification tests**

Cover valid issue, altered quantity, expired timestamp, replayed nonce, inactive staff, non-manager receive, exact manager IDs, unknown keys, and repeated request ID returning the prior document.

```ts
it.each([
  ['altered quantity', () => tamper(validEnvelope(), envelope => { envelope.command.payload.lines[0].quantityMilli = 9_999 })],
  ['expired timestamp', () => signedEnvelope({ timestamp: 1_700_000_000 })],
  ['unknown field', () => ({ ...validEnvelope(), debug: true })],
])('rejects %s', (_name, build) => {
  expect(() => processStockIngress(build(), createStockIngressPorts())).toThrow()
})

it('allows issue for active staff but reserves receive for exact managers', () => {
  expect(processStockIngress(issueEnvelope({ staffId: 'ADMIN_01' }), createStockIngressPorts()))
    .toMatchObject({ commandType: 'ISSUE' })
  expect(() => processStockIngress(receiveEnvelope({ staffId: 'ADMIN_01' }), createStockIngressPorts()))
    .toThrow('STOCK_MANAGER_REQUIRED')
  for (const staffId of ['shared-account-test', 'ADMIN_07', 'ADMIN_03']) {
    expect(processStockIngress(receiveEnvelope({ staffId }), createStockIngressPorts()))
      .toMatchObject({ commandType: 'RECEIVE' })
  }
})
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockIngressClient.test.ts \
  apps/pmc-google-booking-ops/tests/stockIngress.test.ts
```

Expected: FAIL because the shared envelope and clients are missing.

- [ ] **Step 4: Implement exact envelope types**

```ts
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
```

`canonicalMiniAppStockIngress()` must serialize fields in one fixed order and reject unrecognized command keys before signature verification.

- [ ] **Step 5: Route Apps Script doPost without changing existing kinds**

```ts
if (isRecord(parsed) && parsed.kind === 'MINI_APP_STOCK') {
  return processStockIngress(parsed, ports)
}
if (isRecord(parsed) && parsed.kind === 'MINI_APP_EVIDENCE') return uploadMiniAppEvidence(parsed, ports)
if (isRecord(parsed) && parsed.kind === 'MINI_APP_BOOKING') return processMiniAppBooking(parsed, ports)
```

Preserve legacy payloads without a `kind`. Add `configurePmcStockManagers()` to the build footer and source entrypoints; it sets `canManageStock=true` only for `shared-account-test`, `ADMIN_07`, and `ADMIN_03`, and false for every other existing row after validating all three are active and unique.

- [ ] **Step 6: Run ingress, build, and Booking regression tests**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockIngressClient.test.ts \
  apps/pmc-google-booking-ops/tests/stockIngress.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppEvidenceIngress.test.ts \
  apps/pmc-google-booking-ops/tests/miniAppIngress.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/pmcMiniAppStockIngress.ts server/pmc-mini-app/stock/ingressClient.ts \
  apps/pmc-google-booking-ops/src/stock/ingress.ts apps/pmc-google-booking-ops/src/entrypoints.ts \
  apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/scripts/build.mjs \
  tests/pmc-mini-app/stockIngressClient.test.ts apps/pmc-google-booking-ops/tests/stockIngress.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
git commit -m "feat: add signed PMC Stock ingress"
```

### Task 6: Cloud Run Stock Read Model and API

**Files:**
- Create: `server/pmc-mini-app/stock/readStore.ts`
- Create: `server/pmc-mini-app/stock/middleware.ts`
- Modify: `server/pmc-mini-app/config.ts`
- Modify: `server/pmc-mini-app/contracts.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Test: `tests/pmc-mini-app/stockReadStore.test.ts`
- Test: `tests/pmc-mini-app/stockApi.test.ts`
- Test: `tests/pmc-mini-app/config.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, and 5.
- Produces: authenticated Stock read/mutation APIs and `stockEnabled`/`canManageStock` client configuration.

- [ ] **Step 1: Write read-store aggregation tests**

```ts
it('returns current balance and low-stock state from products plus ledger', async () => {
  const store = createStockReadStore({ spreadsheetId: 'sheet-1', sheets })
  await expect(store.listProducts()).resolves.toEqual([
    expect.objectContaining({
      productId: 'STK-000001',
      onHandMilli: 4_000,
      minimumQuantityMilli: 5_000,
      lowStock: true,
    }),
  ])
})
```

Reject incompatible headers, unknown categories/types, unsafe milli-unit integers, duplicate IDs, and any derived negative balance as `STOCK_DATA_INTEGRITY_ERROR`.

- [ ] **Step 2: Write API authorization and command tests**

Cover:

- active staff GET products/history = 200;
- active staff POST issue = accepted;
- non-manager POST receive/product/adjust = 403;
- manager commands call the signed ingress client;
- a browser-supplied `staffId` is rejected as an unknown key; Cloud Run injects the verified staff ID;
- disabled flag returns 404 for Stock routes and `stockEnabled=false` in config;
- manager-pilot mode returns `stockEnabled=false` to non-managers while managers retain access;
- API responses contain no Sheet ranges or IDs.

```ts
const staffRead = await jsonRequest(middleware, 'GET', '/api/mini-app/stock/products', null, 'staff-token')
expect(staffRead.status).toBe(200)

const deniedReceive = await jsonRequest(middleware, 'POST', '/api/mini-app/stock/receipts', {
  requestId: 'receive-1', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
}, 'staff-token')
expect(deniedReceive).toEqual({ status: 403, body: { error: 'STOCK_MANAGER_REQUIRED' } })

const spoofedIssue = await jsonRequest(middleware, 'POST', '/api/mini-app/stock/issues', {
  requestId: 'issue-1', staffId: 'ADMIN_03', lines: [{ productId: 'STK-000001', quantityMilli: 1_000 }],
}, 'staff-token')
expect(spoofedIssue).toEqual({ status: 400, body: { error: 'STOCK_UNKNOWN_FIELD' } })
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockReadStore.test.ts \
  tests/pmc-mini-app/stockApi.test.ts tests/pmc-mini-app/config.test.ts
```

Expected: FAIL because Stock server modules are missing.

- [ ] **Step 4: Implement server contracts and routes**

```ts
export interface StockProductProjection {
  productId: string
  name: string
  category: StockCategory
  unit: string
  minimumQuantityMilli: number
  onHandMilli: number
  lowStock: boolean
  active: boolean
  hasLedgerActivity: boolean
  version: number
}

export interface StockServerDependencies {
  enabled: boolean
  managerPilotOnly: boolean
  readStore: StockReadStore
  ingress: StockIngressClient
}

export interface StockReadStore {
  listProducts(): Promise<StockProductProjection[]>
  listHistory(cursor: string | null, pageSize: number): Promise<StockHistoryPage>
  getDocument(documentId: string): Promise<StockDocumentSummary | null>
}

export interface StockIngressClient {
  send(command: MiniAppStockCommand): Promise<StockCommandResult>
}
```

Mount the Stock router only after the existing LINE token and active-staff check. Bound request JSON to 64 KB, require exact keys, paginate history with an opaque cursor, and return safe codes from the spec.

- [ ] **Step 5: Run server tests and typecheck**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockReadStore.test.ts \
  tests/pmc-mini-app/stockApi.test.ts tests/pmc-mini-app/config.test.ts \
  tests/pmc-mini-app/sessionApi.test.ts tests/pmc-mini-app/productionApp.test.ts
npx tsc -p tsconfig.server.json --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/pmc-mini-app/stock server/pmc-mini-app/config.ts server/pmc-mini-app/contracts.ts \
  server/pmc-mini-app/middleware.ts server/pmc-mini-app/runtime.ts \
  tests/pmc-mini-app/stockReadStore.test.ts tests/pmc-mini-app/stockApi.test.ts \
  tests/pmc-mini-app/config.test.ts
git commit -m "feat: add PMC Stock API"
```

### Task 7: Mini App Stock Home and Navigation

**Files:**
- Create: `src/apps/pmc-mini-app/stock/stockModel.ts`
- Create: `src/apps/pmc-mini-app/stock/StockHome.tsx`
- Modify: `src/apps/pmc-mini-app/contracts.ts`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Modify: `src/apps/pmc-mini-app/Home.tsx`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/preview.ts`
- Modify: `src/apps/pmc-mini-app/styles.css`
- Test: `tests/pmc-mini-app/stockHome.test.tsx`
- Test: `tests/pmc-mini-app/clientShell.test.tsx`

**Interfaces:**
- Consumes: Task 6 API projections.
- Produces: `STOCK` Mini App route, enabled Home card, searchable/filterable Stock list, and manager-only entry actions.

- [ ] **Step 1: Load current frontend guidance**

Run:

```bash
npx -y modern-web-guidance@latest search \
  "mobile inventory product list search filters low stock accessible LINE webview" \
  --skill-version 2026_05_16-c5e7870
```

Retrieve the relevant returned guide IDs before editing React or CSS. Preserve the existing Thai PMC visual language rather than adding an unrelated component system.

- [ ] **Step 2: Write failing Stock Home tests**

```tsx
render(<StockHome
  products={products}
  canManageStock={false}
  onIssue={vi.fn()}
  onManagerAction={vi.fn()}
  onHistory={vi.fn()}
/>)
expect(screen.getByRole('heading', { name: 'Stock' })).toBeVisible()
expect(screen.getByText('4 กล่อง')).toBeVisible()
expect(screen.getByText('ใกล้หมด')).toBeVisible()
expect(screen.queryByRole('button', { name: 'รับเข้า' })).not.toBeInTheDocument()
await user.type(screen.getByRole('searchbox', { name: 'ค้นหาสินค้า' }), 'ถุงมือ')
expect(screen.getByText('ถุงมือ')).toBeVisible()
```

Update `clientShell.test.tsx` so the Stock card is disabled when `stockEnabled=false` and opens the Stock route when true.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockHome.test.tsx tests/pmc-mini-app/clientShell.test.tsx
```

Expected: FAIL because Stock client UI is missing.

- [ ] **Step 4: Implement typed API and Home route**

Add these methods to `MiniAppBrowserApi`:

```ts
loadStockProducts(idToken: string): Promise<{ products: StockProductProjection[] }>
loadStockHistory(idToken: string, cursor?: string): Promise<StockHistoryPage>
submitStockCommand(idToken: string, command: StockClientCommand): Promise<StockCommandResult>
```

The browser command contains no `staffId`. Cloud Run discards unknown identity fields and constructs the signed `MiniAppStockCommand` with the staff ID resolved from the verified LINE token. Add `stockEnabled` and `canManageStock` to server config/session projections. Home renders an enabled `Stock` card only when `stockEnabled=true`. The Stock screen renders one-column mobile cards, a native search input, four visible filters, 48 px minimum targets, and text plus color for low-stock status.

- [ ] **Step 5: Run tests, typecheck, and Mini App build**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockHome.test.tsx tests/pmc-mini-app/clientShell.test.tsx \
  tests/pmc-mini-app/api.test.ts
npx tsc -b
npm run build:mini-app
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/apps/pmc-mini-app/stock/stockModel.ts src/apps/pmc-mini-app/stock/StockHome.tsx \
  src/apps/pmc-mini-app/contracts.ts src/apps/pmc-mini-app/api.ts src/apps/pmc-mini-app/Home.tsx \
  src/apps/pmc-mini-app/PmcMiniApp.tsx src/apps/pmc-mini-app/preview.ts \
  src/apps/pmc-mini-app/styles.css tests/pmc-mini-app/stockHome.test.tsx \
  tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/api.test.ts
git commit -m "feat: add PMC Stock home"
```

### Task 8: Multi-Product Issue Flow

**Files:**
- Create: `src/apps/pmc-mini-app/stock/StockIssueFlow.tsx`
- Modify: `src/apps/pmc-mini-app/stock/stockModel.ts`
- Modify: `src/apps/pmc-mini-app/stock/StockHome.tsx`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/styles.css`
- Test: `tests/pmc-mini-app/stockIssueFlow.test.tsx`

**Interfaces:**
- Consumes: Task 7 Stock API adapter and product projections.
- Produces: one request-ID-stable multi-line issue document and success screen.

- [ ] **Step 1: Write failing issue-flow tests**

```tsx
it('blocks the complete document when one projected balance is negative', async () => {
  renderIssueFlow({ products: [product('A', 5_000), product('B', 1_000)] })
  await addLine('A', '2')
  await addLine('B', '2')
  await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))
  expect(screen.getByRole('alert')).toHaveTextContent('สินค้า B คงเหลือ 1')
  expect(adapter.issue).not.toHaveBeenCalled()
})

it('submits multiple products once with one stable request ID', async () => {
  renderIssueFlow({ products: [product('A', 5_000), product('B', 3_000)] })
  await addLine('A', '2')
  await addLine('B', '1.5')
  await user.click(screen.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }))
  expect(adapter.issue).toHaveBeenCalledWith(expect.objectContaining({
    commandType: 'ISSUE',
    payload: { lines: [
      { productId: 'A', quantityMilli: 2_000 },
      { productId: 'B', quantityMilli: 1_500 },
    ] },
  }))
})
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/pmc-mini-app/stockIssueFlow.test.tsx`

Expected: FAIL because the issue flow does not exist.

- [ ] **Step 3: Implement reducer and UI**

The reducer stores one stable `requestId` from entry until success/cancel, prevents duplicate product IDs, parses quantities through `parseQuantityToMilli`, and computes projected balances locally. On `STOCK_INSUFFICIENT_BALANCE`, replace local balances with the server-provided current values and keep the cart for correction.

Use a visible item selector, quantity input with `inputMode="decimal"`, remove action, projected balance text, add-item action, and one final confirmation button. Do not render customer, case, doctor, service, or reason fields.

```ts
export function issueLines(state: StockIssueState): Array<{ productId: string; quantityMilli: number }> {
  const seen = new Set<string>()
  return state.lines.map(line => {
    if (seen.has(line.productId)) throw new Error('STOCK_DUPLICATE_LINE')
    seen.add(line.productId)
    const quantityMilli = parseQuantityToMilli(line.quantity)
    const product = state.products.find(item => item.productId === line.productId && item.active)
    if (!product) throw new Error('STOCK_PRODUCT_INACTIVE')
    if (quantityMilli > product.onHandMilli) throw new Error(`STOCK_INSUFFICIENT_BALANCE:${line.productId}`)
    return { productId: line.productId, quantityMilli }
  })
}

export function createIssueCommand(state: StockIssueState): StockClientCommand {
  return { requestId: state.requestId, commandType: 'ISSUE', payload: { lines: issueLines(state) } }
}
```

- [ ] **Step 4: Run issue and API tests**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockIssueFlow.test.tsx tests/pmc-mini-app/stockHome.test.tsx \
  tests/pmc-mini-app/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/pmc-mini-app/stock/StockIssueFlow.tsx \
  src/apps/pmc-mini-app/stock/stockModel.ts src/apps/pmc-mini-app/stock/StockHome.tsx \
  src/apps/pmc-mini-app/PmcMiniApp.tsx src/apps/pmc-mini-app/styles.css \
  tests/pmc-mini-app/stockIssueFlow.test.tsx
git commit -m "feat: add multi-product Stock issue flow"
```

### Task 9: Stock Manager Flows

**Files:**
- Create: `src/apps/pmc-mini-app/stock/StockManager.tsx`
- Modify: `src/apps/pmc-mini-app/stock/StockHome.tsx`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/styles.css`
- Test: `tests/pmc-mini-app/stockManager.test.tsx`

**Interfaces:**
- Consumes: Task 7 API adapter and Task 8 shared item selector.
- Produces: create product, multi-product receipt, physical-count adjustment, product update, deactivate, and reactivate screens.

- [ ] **Step 1: Write manager visibility and validation tests**

```tsx
it('requires an adjustment reason and previews the signed delta', async () => {
  renderManager({ product: product('STK-1', 5_000), mode: 'ADJUST' })
  await user.type(screen.getByLabelText('จำนวนที่นับจริง'), '3')
  expect(screen.getByText('ปรับลด 2 กล่อง')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'ยืนยันปรับยอด' }))
  expect(screen.getByRole('alert')).toHaveTextContent('กรุณาระบุเหตุผล')
  expect(adapter.adjust).not.toHaveBeenCalled()
})

it('hides every manager route from non-managers', () => {
  renderStockApp({ canManageStock: false })
  expect(screen.queryByRole('button', { name: 'รับเข้า' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'จัดการสินค้า' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/pmc-mini-app/stockManager.test.tsx`

Expected: FAIL because manager flows are missing.

- [ ] **Step 3: Implement manager screens**

Create product fields are exactly name, category, unit, opening quantity, and minimum quantity. Receive reuses the multi-product cart with positive deltas. Adjustment accepts one product, counted quantity, and a mandatory trimmed reason of 1-300 characters. Product management uses the latest version and blocks unit edits after ledger activity based on `hasLedgerActivity` returned by the API.

Every manager mutation preserves the local form on network/storage failure and shows the original document result on idempotent retry.

```ts
export function createAdjustmentCommand(input: {
  requestId: string
  product: StockProductProjection
  countedQuantity: string
  reason: string
}): StockClientCommand {
  const countedQuantityMilli = parseNonNegativeQuantityToMilli(input.countedQuantity)
  const reason = input.reason.trim()
  if (!reason || reason.length > 300) throw new Error('STOCK_ADJUST_REASON_REQUIRED')
  return {
    requestId: input.requestId,
    commandType: 'ADJUST',
    payload: { productId: input.product.productId, countedQuantityMilli, reason },
  }
}

export function canEditProductUnit(product: StockProductProjection): boolean {
  return !product.hasLedgerActivity
}
```

- [ ] **Step 4: Run manager, issue, and authorization tests**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockManager.test.tsx \
  tests/pmc-mini-app/stockIssueFlow.test.tsx tests/pmc-mini-app/stockApi.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/pmc-mini-app/stock/StockManager.tsx \
  src/apps/pmc-mini-app/stock/StockHome.tsx src/apps/pmc-mini-app/PmcMiniApp.tsx \
  src/apps/pmc-mini-app/styles.css tests/pmc-mini-app/stockManager.test.tsx
git commit -m "feat: add Stock manager flows"
```

### Task 10: History, Setup, End-to-End Verification, and Rollout Gates

**Files:**
- Create: `src/apps/pmc-mini-app/stock/StockHistory.tsx`
- Create: `tests/pmc-mini-app/stockHistory.test.tsx`
- Create: `tests/pmc-mini-app/stockEndToEnd.test.ts`
- Create: `tests/pmc-mini-app/helpers/stockSystem.ts`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/styles.css`
- Modify: `tests/pmc-mini-app/browserAcceptance.spec.ts`
- Modify: `tests/pmc-mini-app/localServer.mjs`
- Modify: `docs/pmc-mini-app/pilot-runbook.md`
- Modify: `scripts/check-pmc-mini-app-runtime.mjs`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: `createStockTestSystem()`, read-only history UI, full simulated Stock lifecycle, manager bootstrap procedure, disabled-first rollout, and rollback instructions.

- [ ] **Step 1: Write history tests**

```tsx
render(<StockHistory page={{
  documents: [{
    documentId: 'ISS-202608-0001', transactionType: 'ISSUE', actorDisplayName: 'อาย',
    createdAt: '2026-08-28T10:00:00+07:00', lineCount: 2, reason: '',
    lines: [
      { productName: 'ถุงมือ', quantityDeltaMilli: -2_000, unit: 'กล่อง' },
      { productName: 'เข็ม', quantityDeltaMilli: -1_000, unit: 'กล่อง' },
    ],
  }],
  nextCursor: null,
}} />)
expect(screen.getByText('ISS-202608-0001')).toBeVisible()
await user.click(screen.getByRole('button', { name: 'ดูรายละเอียด ISS-202608-0001' }))
expect(screen.getByText('ถุงมือ')).toBeVisible()
expect(screen.queryByRole('button', { name: /แก้ไข/ })).not.toBeInTheDocument()
```

- [ ] **Step 2: Write a complete Stock lifecycle test**

The test must use the real shared contracts, Apps Script repository/commands, and Cloud Run read projection with only Google/LINE transport faked:

```ts
it('creates, receives, issues, adjusts, and reconciles one immutable ledger', async () => {
  const system = createStockTestSystem()
  const product = await system.createProduct({ openingQuantityMilli: 10_000, minimumQuantityMilli: 3_000 })
  await system.receive([{ productId: product.productId, quantityMilli: 5_000 }])
  await system.issue([{ productId: product.productId, quantityMilli: 8_000 }])
  await system.adjust({ productId: product.productId, countedQuantityMilli: 6_000, reason: 'ตรวจนับสิ้นวัน' })
  expect(await system.balance(product.productId)).toBe(6_000)
  expect(system.ledgerDeltas(product.productId)).toEqual([10_000, 5_000, -8_000, -1_000])
})
```

The helper has this exact contract and delegates every mutation to the real `executeStockCommand()`:

```ts
export interface StockTestSystem {
  createProduct(input: { openingQuantityMilli: number; minimumQuantityMilli: number }): Promise<StockProduct>
  receive(lines: Array<{ productId: string; quantityMilli: number }>): Promise<StockCommandResult>
  issue(lines: Array<{ productId: string; quantityMilli: number }>): Promise<StockCommandResult>
  adjust(input: { productId: string; countedQuantityMilli: number; reason: string }): Promise<StockCommandResult>
  balance(productId: string): Promise<number>
  ledgerDeltas(productId: string): number[]
}

export function createStockTestSystem(): StockTestSystem {
  const ports = createStockCommandTestPorts()
  let sequence = 0
  const requestId = (prefix: string) => `${prefix}-${++sequence}`
  return {
    async createProduct(input) {
      const result = executeStockCommand({
        requestId: requestId('create'), staffId: 'shared-account-test', commandType: 'CREATE_PRODUCT',
        payload: {
          name: `สินค้าทดสอบ ${sequence}`, category: 'CLINIC_SUPPLY', unit: 'ชิ้น',
          openingQuantityMilli: input.openingQuantityMilli,
          minimumQuantityMilli: input.minimumQuantityMilli,
        },
      }, ports)
      return ports.stock.getProduct(result.lines[0]!.productId)!
    },
    async receive(lines) {
      return executeStockCommand({ requestId: requestId('receive'), staffId: 'shared-account-test', commandType: 'RECEIVE', payload: { lines } }, ports)
    },
    async issue(lines) {
      return executeStockCommand({ requestId: requestId('issue'), staffId: 'ADMIN_01', commandType: 'ISSUE', payload: { lines } }, ports)
    },
    async adjust(input) {
      return executeStockCommand({ requestId: requestId('adjust'), staffId: 'ADMIN_07', commandType: 'ADJUST', payload: input }, ports)
    },
    async balance(productId) {
      return ports.stock.balanceByProduct().get(productId) ?? 0
    },
    ledgerDeltas(productId) {
      return ports.stock.listLedger().filter(row => row.productId === productId).map(row => row.quantityDeltaMilli)
    },
  }
}
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
npx vitest run tests/pmc-mini-app/stockHistory.test.tsx tests/pmc-mini-app/stockEndToEnd.test.ts
```

Expected: FAIL until history and the final test harness are implemented.

- [ ] **Step 4: Implement history and preview fixtures**

Render newest documents first, use Thai date/time formatting, expand details in place, display adjustment reasons only to managers, and paginate with `โหลดเพิ่มเติม`. Do not render Sheet links or mutation controls.

```tsx
export function StockHistory({ page, canManageStock, onLoadMore }: StockHistoryProps) {
  return <main className="pmc-stock-history">
    <h1>ประวัติ Stock</h1>
    {page.documents.map(document => <details key={document.documentId}>
      <summary aria-label={`ดูรายละเอียด ${document.documentId}`}>
        <strong>{document.documentId}</strong>
        <span>{document.actorDisplayName} · {formatThaiDateTime(document.createdAt)}</span>
      </summary>
      <ul>{document.lines.map(line => <li key={`${document.documentId}:${line.productId}`}>
        {line.productName} · {formatQuantityMilli(line.quantityDeltaMilli)} {line.unit}
      </li>)}</ul>
      {canManageStock && document.reason && <p>เหตุผล: {document.reason}</p>}
    </details>)}
    {page.nextCursor && <button type="button" onClick={() => onLoadMore(page.nextCursor!)}>โหลดเพิ่มเติม</button>}
  </main>
}
```

- [ ] **Step 5: Add runtime and setup checks**

Update `scripts/check-pmc-mini-app-runtime.mjs` so the read-only report includes `stockEnabled` and `stockManagerPilotOnly` but no configuration values. Update the runbook with exact manager IDs:

```text
shared-account-test  owner/Admin
ADMIN_07             อาย
ADMIN_03             หมวย
```

The runbook requires:

1. `PMC_STOCK_ENABLED=false` initial Cloud Run revision.
2. Apps Script source push, immutable version creation, and current web-app deployment update.
3. Managed-tab setup and header readback.
4. Exact three-manager setup readback.
5. Synthetic lifecycle and insufficient-balance checks.
6. Manager-only pilot with `PMC_STOCK_ENABLED=true` and `PMC_STOCK_MANAGER_PILOT_ONLY=true`.
7. Android and iPhone LINE WebView browser acceptance.
8. Owner approval before all-staff enablement.
9. Rollback by setting the flag false without deleting rows.

- [ ] **Step 6: Extend browser acceptance**

Add Playwright scenarios for:

- Stock disabled card;
- active staff issue with two products;
- low-stock filter;
- non-manager hidden controls;
- manager create/receive/adjust flows;
- repeated submit returns one document;
- no Sheet link anywhere in Stock UI.

```ts
test('active staff issues two products without any Sheet escape hatch', async ({ page }) => {
  await page.goto('/mini-app/?preview=1&stock=enabled&role=staff')
  await page.getByRole('button', { name: 'Stock' }).click()
  await expect(page.getByRole('link', { name: /Google Sheet/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'เบิกสินค้า' }).click()
  await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click()
  await page.getByLabel('สินค้า').selectOption('STK-000001')
  await page.getByLabel('จำนวน').fill('2')
  await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click()
  await page.getByLabel('สินค้า').nth(1).selectOption('STK-000002')
  await page.getByLabel('จำนวน').nth(1).fill('1')
  await page.getByRole('button', { name: 'ยืนยันเบิกสินค้า' }).click()
  await expect(page.getByText(/ISS-202608-/)).toBeVisible()
})
```

- [ ] **Step 7: Run the complete verification matrix**

Run:

```bash
npm run build
npx vitest run --exclude tests/ocr-ledger/job.test.ts
npx vitest run tests/ocr-ledger/job.test.ts
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npx playwright test --config=playwright.mini-app.config.ts
node scripts/check-pmc-mini-app-runtime.mjs --env-file /dev/null
git diff --check
```

Expected:

- every command exits 0;
- all Stock tests pass;
- the standalone OCR test passes without contending with the full parallel suite;
- no existing Booking/JERA/OCR/LINE test regresses;
- runtime checker prints names/presence only and no secret values.

- [ ] **Step 8: Commit**

```bash
git add src/apps/pmc-mini-app/stock/StockHistory.tsx src/apps/pmc-mini-app/PmcMiniApp.tsx \
  src/apps/pmc-mini-app/styles.css tests/pmc-mini-app/stockHistory.test.tsx \
  tests/pmc-mini-app/stockEndToEnd.test.ts tests/pmc-mini-app/helpers/stockSystem.ts \
  tests/pmc-mini-app/browserAcceptance.spec.ts \
  tests/pmc-mini-app/localServer.mjs docs/pmc-mini-app/pilot-runbook.md \
  scripts/check-pmc-mini-app-runtime.mjs
git commit -m "test: verify PMC Stock rollout"
```

### Task 11: Production Deployment Checkpoints

**Files:**
- No source files unless a verification defect is found; any defect starts a new TDD cycle in the responsible earlier task.

**Interfaces:**
- Consumes: completed Tasks 1-10 and the existing Cloud Run/Apps Script deployment configuration.
- Produces: a disabled-first Stock revision, verified managers-only pilot, and owner-approved all-staff release.

- [ ] **Step 1: Verify the exact production identity and project**

Run read-only commands and confirm:

```bash
gcloud config get-value project
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gcloud run services describe pmc-mini-app --region=asia-southeast1 \
  --format='value(status.latestReadyRevisionName,spec.template.spec.serviceAccountName)'
```

Required results:

```text
project-2099d92f-51c8-4d2b-a8c
promedclinicpmc@gmail.com
pmc-mini-app-runtime@project-2099d92f-51c8-4d2b-a8c.iam.gserviceaccount.com
```

- [ ] **Step 2: Push and version Apps Script**

Use ADC clasp authentication and the existing PMC Booking project configuration. Push the built `apps/pmc-google-booking-ops/dist`, create an immutable version with description `PMC Stock ledger`, and update only the deployment ID already present in `PMC_BOOKING_INGRESS_URL`. Never print the deployment ID or secret values.

- [ ] **Step 3: Create and verify managed tabs**

Run the setup workflow against the canonical spreadsheet. Verify exact headers, frozen row 1, zero deleted tabs, and manager IDs `shared-account-test`, `ADMIN_07`, and `ADMIN_03` only.

- [ ] **Step 4: Deploy disabled no-traffic Cloud Run revision**

```bash
gcloud run deploy pmc-mini-app --source . \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --update-env-vars=PMC_STOCK_ENABLED=false \
  --update-env-vars=PMC_STOCK_MANAGER_PILOT_ONLY=true \
  --tag=stock-disabled \
  --no-traffic \
  --quiet
```

Verify `/api/healthz=200`, `/mini-app/=200`, `/api/mini-app/client-config=200`, and unauthenticated `/api/mini-app/session=401`. Confirm Booking/JERA/OCR routes remain unchanged.

- [ ] **Step 5: Enable managers-only pilot**

Deploy a second no-traffic revision with `PMC_STOCK_ENABLED=true` and `PMC_STOCK_MANAGER_PILOT_ONLY=true`. Test through authenticated LINE accounts for the owner, อาย, and หมวย. Create synthetic products, run opening/receive/issue/adjust/idempotency/insufficient-balance checks, and deactivate synthetic products while retaining ledger history.

- [ ] **Step 6: Obtain owner approval before all-staff traffic**

Present safe evidence only: commit SHA, revision name, document IDs, row counts, balance reconciliation, manager IDs, pass/fail, and timestamps. Do not include product-sensitive notes, LINE IDs, tokens, secrets, Sheet IDs, or unrestricted URLs.

- [ ] **Step 7: Route production traffic and verify**

After owner approval, deploy or select a revision with `PMC_STOCK_MANAGER_PILOT_ONLY=false`, route 100% traffic to it, and verify canonical service URLs, active revision, config flags, one real authorized issue, no duplicate ledger rows, and no impact to Booking flows.

- [ ] **Step 8: Record rollback state**

Record the last known-good Stock-disabled revision. Rollback means routing traffic to that revision or setting `PMC_STOCK_ENABLED=false`; never delete Stock tabs or ledger rows during rollback.
