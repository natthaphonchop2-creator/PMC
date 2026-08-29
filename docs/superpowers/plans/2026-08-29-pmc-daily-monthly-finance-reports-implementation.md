# PMC Daily and Monthly Finance Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the provider-oriented Mini App report catalog with cache-only daily and monthly finance views whose received-income total is authoritative, whose payment channels and service/product allocation reconcile explicitly, and whose monthly view is restricted to finance-authorized staff.

**Architecture:** Keep the existing read-only provider cache as the revenue source and add a finance projection layer rather than treating PRODUCT_SALES or OPD as cash ledgers. A resumable, OIDC-protected Cloud Tasks worker builds a bounded payment-detail allocation cache one Bangkok day at a time; report GETs only read bounded cache snapshots and never call the provider. Ship the new UI behind `PMC_FINANCE_REPORTS_ENABLED`, keep category money behind the independent `JERA_FINANCE_CATEGORY_MONEY_ENABLED` reconciliation gate, and retain the legacy report routes for rollback during this release.

**Tech Stack:** TypeScript 6, Node.js, React 19, Vite 8, Vitest 4, Testing Library, Playwright, Google Sheets API, Google Cloud Tasks, Cloud Run, LINE LIFF

**Spec:** `docs/superpowers/specs/2026-08-29-pmc-financial-report-and-expense-capture-design.md`

## Global Constraints

- This plan implements only daily income, 1-31 day history, monthly income, payment/detail allocation, finance visibility, and the finance-first report UI. Expense capture, OCR, approval, payroll, employee DF, doctor DF, and accounting-provider posting require separate plans.
- `PAYMENT.paidAmountSatang` is the authoritative received amount. `REFUND.refundAmountSatang` is subtracted only for net received.
- Service/course, product, and unclassified amounts partition received money and are never added to received money.
- Payment channels are exactly `โอน`, `สด`, `Credit`, and `อื่น ๆ`; `อื่น ๆ` is e-wallet + payment link + existing other-payment buckets.
- A payment must satisfy `serviceSatang + productSatang + unclassifiedSatang === paidAmountSatang` in integer satang.
- Missing detail, missing or ambiguous type metadata, deposits, zero-weight detail, and truncated detail fail closed to `UNCLASSIFIED`.
- Historical daily selection is 1-31 inclusive Bangkok calendar days. Monthly selection is `year` + numeric `month`; the server derives `monthKey` and Bangkok boundaries.
- Report GET requests are cache-only. Opening report home, daily, or monthly pages never starts a provider request, Sheet write, Cloud Task, or polling loop.
- Manual refresh accepts exactly one date, refreshes PAYMENT, REFUND, and PRODUCT_SALES sequentially, then seeds one resumable allocation task.
- Allocation execution has one provider request in flight, at most 20 new payment details per worker run, at least 3,000 ms between PAYMENT_DETAIL attempts, and at least 60 seconds between continuation tasks for the same day. The worker client performs no hidden provider retries, so the global ceiling remains 20 PAYMENT_DETAIL requests per minute.
- Category money renders only when every selected day has `COMPLETE` coverage and `JERA_FINANCE_CATEGORY_MONEY_ENABLED=true`; otherwise render counts plus `กำลังตรวจสอบหมวด` and list incomplete dates.
- Component data older than 24 hours is stale. Category source timestamps more than 15 minutes from PAYMENT show `ข้อมูลหมวดอาจล่าช้า` and cannot be presented as reconciled.
- Every active LINE-linked staff member may read daily income. Only immutable staff IDs with `canViewFinance=true` may read monthly finance.
- `canSubmitExpense` and `canManageExpense` are migrated fail-closed for the approved future expense subsystem but confer no active feature in this plan.
- Provider payloads, credentials, LINE user IDs, private Sheet IDs, and patient contact fields never enter logs, audit bodies, Cloud Task names, or browser storage.
- Existing Booking, Stock, Calendar, LINE notification, OCR, fallback Form, and legacy report-cache behavior must remain green.

---

## File Structure

### New files

- `shared/pmcFinance.ts` — browser/server-safe finance DTOs and enum-like unions.
- `server/jera/financeReports.ts` — pure daily/monthly finance projection and freshness rules.
- `server/jera/allocation.ts` — item metadata classification and deterministic integer-satang allocation.
- `server/jera/allocationStore.ts` — bounded payment-detail lines and day-coverage persistence in Sheets.
- `server/jera/allocationTaskQueue.ts` — deterministic OIDC Cloud Task creation.
- `server/jera/allocationWorker.ts` — resumable 20-detail worker and continuation scheduling.
- `server/jera/financeService.ts` — cache-only daily/monthly reads and one-day manual refresh orchestration.
- `src/apps/pmc-mini-app/financeReports.ts` — client date/month state and safe finance response helpers.
- `src/apps/pmc-mini-app/FinanceReportHome.tsx` — two primary finance cards and disabled expense cards.
- `src/apps/pmc-mini-app/DailyIncomePage.tsx` — daily/history finance report UI.
- `src/apps/pmc-mini-app/MonthlyFinancePage.tsx` — restricted monthly income UI with expense placeholders.
- `scripts/check-finance-report-runtime.mjs` — read-only schema, role-count, task-queue, and Cloud Run gate checker.
- `scripts/seed-finance-report-day.mjs` — owner-gated one-day PAYMENT/REFUND/PRODUCT_SALES seed and allocation status readback.
- `scripts/backfill-finance-report-days.mjs` — owner-gated resumable exact-day backfill for 1-31 Bangkok dates.
- `docs/pmc-mini-app/finance-report-rollout-runbook.md` — migration, sample reconciliation, canary, rollback, and evidence procedure.
- Focused test files named in each task below.

### Existing files modified

- `server/jera/contracts.ts`, `store.ts`, `syncCoordinator.ts`, `middleware.ts`, `runtime.ts`, `config.ts`
- `server/pmc-mini-app/setup.ts`, `contracts.ts`, `store.ts`, `middleware.ts`, `config.ts`, `runtime.ts`
- `apps/pmc-google-booking-ops/src/sheetSchema.ts`, `ports.ts`, `domain/sheetMigration.ts`, `adapters/googleSheets.ts`, `runtime.ts`
- `src/apps/pmc-mini-app/contracts.ts`, `api.ts`, `PmcMiniApp.tsx`, `preview.ts`, `styles.css`
- Existing report tests and Mini App regression tests named below.

---

### Task 1: Define Finance Contracts and Pure Revenue Arithmetic

**Files:**
- Create: `shared/pmcFinance.ts`
- Create: `server/jera/allocation.ts`
- Create: `server/jera/financeReports.ts`
- Create: `tests/jera/allocation.test.ts`
- Create: `tests/jera/financeReports.test.ts`
- Modify: `server/jera/contracts.ts`

**Interfaces:**
- Consumes: existing `JeraNormalizedRow`, `JeraNormalizedPaymentDetail`, and `JeraCacheEnvelope<T>` from `server/jera/contracts.ts`.
- Produces: `RevenueCategory`, `PaymentRevenueAllocation`, `FinanceComponentFreshness`, `DailyIncomeProjection`, `MonthlyIncomeProjection`, `JeraItemTypeMetadata`, `allocatePaymentRevenue()`, `buildDailyIncomeProjection()`, and `buildMonthlyIncomeProjection()`.

- [ ] **Step 1: Write failing contract and allocation tests**

```ts
// tests/jera/allocation.test.ts
import { describe, expect, it } from 'vitest'
import { allocatePaymentRevenue, buildItemTypeMetadata } from '../../server/jera/allocation'

describe('payment-level revenue allocation', () => {
  it('uses deterministic largest remainders and preserves every satang', () => {
    const allocation = allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000001',
      paymentSourceHash: 'a'.repeat(64),
      paidAmountSatang: 10_001,
      paymentType: 'NORMAL',
      detail: {
        truncated: false,
        lines: [
          { kind: 'OPD', itemCode: 'SVC-1', netLineSatang: 2 },
          { kind: 'OPD', itemCode: 'PRD-1', netLineSatang: 1 },
        ],
      },
      metadata: buildItemTypeMetadata([
        { itemCode: 'SVC-1', type: 'service', sourceHash: 'b'.repeat(64) },
        { itemCode: 'PRD-1', type: 'medicine', sourceHash: 'c'.repeat(64) },
      ]),
    })

    expect(allocation).toMatchObject({ serviceSatang: 6_667, productSatang: 3_334, unclassifiedSatang: 0 })
    expect(allocation.serviceSatang + allocation.productSatang + allocation.unclassifiedSatang).toBe(10_001)
  })

  it.each(['CASH_DEPOSIT', 'PRODUCT_DEPOSIT'])('allocates %s entirely to unclassified', (paymentType) => {
    const result = allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000002', paymentSourceHash: 'd'.repeat(64),
      paidAmountSatang: 90_000, paymentType, detail: null,
      metadata: buildItemTypeMetadata([]),
    })
    expect(result).toMatchObject({ serviceSatang: 0, productSatang: 0, unclassifiedSatang: 90_000 })
  })

  it('marks conflicting item types and missing detail as unclassified without changing paid amount', () => {
    const metadata = buildItemTypeMetadata([
      { itemCode: 'X-1', type: 'service', sourceHash: 'e'.repeat(64) },
      { itemCode: 'X-1', type: 'medicine', sourceHash: 'f'.repeat(64) },
    ])
    const result = allocatePaymentRevenue({
      paymentUuid: '10000000-0000-4000-8000-000000000003', paymentSourceHash: '1'.repeat(64),
      paidAmountSatang: 25_000, paymentType: 'NORMAL', detail: null, metadata,
    })
    expect(metadata.ambiguousItemCodes).toEqual(['X-1'])
    expect(result.unclassifiedSatang).toBe(25_000)
  })
})
```

- [ ] **Step 2: Run the allocation test and verify it fails**

Run: `npx vitest run tests/jera/allocation.test.ts`

Expected: FAIL because `server/jera/allocation.ts` and its exports do not exist.

- [ ] **Step 3: Add exact shared DTOs and allocation inputs**

```ts
// shared/pmcFinance.ts
export type RevenueCategory = 'SERVICE' | 'PRODUCT' | 'UNCLASSIFIED'
export type RevenueCategoryState = 'READY' | 'CHECKING'

export interface FinanceComponentFreshness {
  lastSuccessAt: string | null
  stale: boolean
  warningCode: string | null
}

export interface FinancePaymentRow {
  paymentUuid: string
  paymentCode: string | null
  eventDate: string
  patientName: string | null
  paidAmountSatang: number
  transferSatang: number
  cashSatang: number
  creditSatang: number
  otherSatang: number
  serviceSatang: number | null
  productSatang: number | null
  unclassifiedSatang: number | null
}

export interface DailyIncomeProjection {
  startDate: string
  endDate: string
  receivedSatang: number
  refundSatang: number
  netReceivedSatang: number
  channels: {
    transferSatang: number
    cashSatang: number
    creditSatang: number
    otherSatang: number
    differenceSatang: number
  }
  categories: {
    state: RevenueCategoryState
    serviceSatang: number | null
    productSatang: number | null
    unclassifiedSatang: number | null
    incompleteDates: string[]
  }
  payments: FinancePaymentRow[]
  freshness: {
    payment: FinanceComponentFreshness
    refund: FinanceComponentFreshness
    allocation: FinanceComponentFreshness
  }
  warnings: string[]
}

export interface MonthlyIncomeProjection {
  monthKey: string
  startDate: string
  endDate: string
  receivedSatang: number
  refundSatang: number
  netReceivedSatang: number
  channels: DailyIncomeProjection['channels']
  categories: DailyIncomeProjection['categories']
  dailyTrend: Array<{ date: string; receivedSatang: number; refundSatang: number; netReceivedSatang: number }>
  expense: { state: 'NOT_IMPLEMENTED'; clinicExpenseSatang: null; estimatedBalanceSatang: null }
  freshness: DailyIncomeProjection['freshness']
  warnings: string[]
}

export interface PaymentRevenueAllocation {
  paymentUuid: string
  paymentSourceHash: string
  serviceSatang: number
  productSatang: number
  unclassifiedSatang: number
  warningCodes: string[]
}
```

```ts
// server/jera/allocation.ts
export interface JeraItemTypeMetadata {
  byItemCode: ReadonlyMap<string, 'SERVICE' | 'PRODUCT'>
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
```

```ts
// server/jera/financeReports.ts — server-only projection inputs
export interface FinanceDaySourceSnapshot {
  eventDate: string
  payment: JeraCacheEnvelope<JeraNormalizedRow[]>
  refund: JeraCacheEnvelope<JeraNormalizedRow[]>
  productSales: JeraCacheEnvelope<JeraNormalizedRow[]>
  allocations: PaymentRevenueAllocation[]
  allocationCoverage: null | {
    status: 'INCOMPLETE' | 'COMPLETE'
    metadataSnapshotHash: string
    paymentLastSuccessAt: string | null
    productSalesLastSuccessAt: string | null
    lastSuccessAt: string | null
  }
}

export interface BuildDailyIncomeInput {
  days: FinanceDaySourceSnapshot[]
  categoryMoneyEnabled: boolean
  now: Date
}

export function buildDailyIncomeProjection(input: BuildDailyIncomeInput): DailyIncomeProjection
export function buildMonthlyIncomeProjection(input: {
  monthKey: string
  days: FinanceDaySourceSnapshot[]
  categoryMoneyEnabled: boolean
  now: Date
}): MonthlyIncomeProjection
```

- [ ] **Step 4: Implement deterministic allocation and metadata hashing**

```ts
// server/jera/allocation.ts — core implementation shape
export function allocatePaymentRevenue(input: AllocatePaymentRevenueInput): PaymentRevenueAllocation {
  if (!Number.isSafeInteger(input.paidAmountSatang) || input.paidAmountSatang < 0) {
    throw new Error('JERA_ALLOCATION_INVALID_MONEY')
  }
  if (isDeposit(input.paymentType) || !input.detail || input.detail.truncated) {
    return unclassified(input, input.detail?.truncated ? 'DETAIL_TRUNCATED' : 'DETAIL_UNAVAILABLE')
  }
  const weights = { SERVICE: 0, PRODUCT: 0, UNCLASSIFIED: 0 }
  for (const line of input.detail.lines) {
    if (!Number.isSafeInteger(line.netLineSatang) || line.netLineSatang <= 0) continue
    const category = line.kind === 'COURSE'
      ? 'SERVICE'
      : line.itemCode ? input.metadata.byItemCode.get(line.itemCode) ?? 'UNCLASSIFIED' : 'UNCLASSIFIED'
    weights[category] += line.netLineSatang
  }
  const totalWeight = weights.SERVICE + weights.PRODUCT + weights.UNCLASSIFIED
  if (totalWeight === 0) return unclassified(input, 'ZERO_ALLOCATION_WEIGHT')
  const allocated = largestRemainder(input.paidAmountSatang, weights, ['SERVICE', 'PRODUCT', 'UNCLASSIFIED'])
  return {
    paymentUuid: input.paymentUuid, paymentSourceHash: input.paymentSourceHash,
    serviceSatang: allocated.SERVICE, productSatang: allocated.PRODUCT,
    unclassifiedSatang: allocated.UNCLASSIFIED, warningCodes: [],
  }
}
```

`buildItemTypeMetadata()` must lowercase provider types, map `medicine` and `product` to `PRODUCT`, map `service` and `course` to `SERVICE`, mark any code with conflicting mapped types ambiguous, and hash the sorted `[itemCode, mappedType]` pairs with SHA-256. `largestRemainder()` must sort equal fractional remainders by `SERVICE`, then `PRODUCT`, then `UNCLASSIFIED`, so repeated runs are byte-for-byte stable.

- [ ] **Step 5: Write failing finance projection tests**

```ts
// tests/jera/financeReports.test.ts
it('uses PAYMENT as received authority and never adds OPD or PRODUCT_SALES totals', () => {
  const report = buildDailyIncomeProjection(fixture({
    paymentPaidSatang: 100_000, refundSatang: 10_000,
    allocation: { serviceSatang: 60_000, productSatang: 30_000, unclassifiedSatang: 10_000 },
    misleadingProductSalesSatang: 400_000, misleadingOpdSatang: 500_000,
  }))
  expect(report.receivedSatang).toBe(100_000)
  expect(report.netReceivedSatang).toBe(90_000)
  expect(report.categories).toMatchObject({ serviceSatang: 60_000, productSatang: 30_000, unclassifiedSatang: 10_000 })
})

it('keeps channel mismatch visible without rewriting received', () => {
  const report = buildDailyIncomeProjection(fixture({ paymentPaidSatang: 100_000, transferSatang: 90_000 }))
  expect(report.receivedSatang).toBe(100_000)
  expect(report.channels.differenceSatang).toBe(10_000)
  expect(report.warnings).toContain('PAYMENT_METHOD_TOTAL_MISMATCH')
})

it('hides category money when one selected date lacks complete coverage', () => {
  const report = buildDailyIncomeProjection(twoDayFixture({ incompleteDate: '2026-08-28' }))
  expect(report.categories).toEqual({
    state: 'CHECKING', serviceSatang: null, productSatang: null, unclassifiedSatang: null,
    incompleteDates: ['2026-08-28'],
  })
})
```

- [ ] **Step 6: Run the finance projection tests and verify they fail**

Run: `npx vitest run tests/jera/financeReports.test.ts`

Expected: FAIL because `buildDailyIncomeProjection()` and `buildMonthlyIncomeProjection()` do not exist.

- [ ] **Step 7: Implement daily and monthly pure projections**

`buildDailyIncomeProjection(input)` must:

1. deduplicate PAYMENT by immutable `sourceUuid` within its exact day cache, retaining the deterministic latest row by `sourceUpdatedAt ?? sourceCreatedAt ?? fetchedAt` and then lexical `sourceHash`; never count two hashes for one payment;
2. sum `paidAmountSatang` as received and REFUND `refundAmountSatang` as refund;
3. calculate channels from PAYMENT only;
4. fold e-wallet, payment link, and existing other payment into `otherSatang`;
5. attach allocation only when payment UUID + payment source hash match;
6. group historical payment rows newest date first;
7. expose null category money for any incomplete selected day; and
8. calculate stale and mixed-snapshot warnings without changing money.

Add a regression fixture containing two PAYMENT rows with the same `sourceUuid` and different hashes/amounts; assert only the deterministic latest row participates. Exact cache-key filtering still prevents day and month-range copies from entering the same projection.

`buildMonthlyIncomeProjection(input)` must aggregate the already-built Bangkok daily projections, sort `dailyTrend` ascending by date, return `expense.state='NOT_IMPLEMENTED'`, and leave clinic expense and estimated balance null rather than presenting zero.

Define `fixture()` and `twoDayFixture()` in `tests/jera/financeReports.test.ts` as typed `BuildDailyIncomeInput` builders. Each builder must construct exact PAYMENT, REFUND, and PRODUCT_SALES `JeraCacheEnvelope<JeraNormalizedRow[]>` values with day-specific cache keys; the misleading PRODUCT_SALES/OPD amounts exist only to assert they never enter authoritative received arithmetic.

- [ ] **Step 8: Run focused arithmetic tests**

Run: `npx vitest run tests/jera/allocation.test.ts tests/jera/financeReports.test.ts tests/jera/reports.test.ts tests/jera/money.test.ts`

Expected: PASS; the existing PAYMENT projection tests remain green.

- [ ] **Step 9: Commit the pure finance domain**

```bash
git add shared/pmcFinance.ts server/jera/contracts.ts server/jera/allocation.ts server/jera/financeReports.ts tests/jera/allocation.test.ts tests/jera/financeReports.test.ts
git commit -m "feat: add finance revenue projections"
```

---

### Task 2: Add Bounded Allocation Cache Storage and Batch Cache Reads

**Files:**
- Create: `server/jera/allocationStore.ts`
- Create: `tests/jera/allocationStore.test.ts`
- Modify: `server/pmc-mini-app/setup.ts`
- Modify: `tests/pmc-mini-app/setup.test.ts`
- Modify: `server/jera/store.ts`
- Modify: `tests/jera/store.test.ts`
- Modify: `server/jera/syncCoordinator.ts`
- Modify: `tests/jera/syncCoordinator.test.ts`

**Interfaces:**
- Consumes: day-specific JERA cache keys from `jeraCacheKey(reportType, { branchUuid, startDate: day, endDate: day })`.
- Produces: `JeraAllocationStore`, `JeraAllocationCoverage`, `JeraCachedPaymentDetail`, `JeraReportStore.readSnapshots()`, and `JeraSyncCoordinator.readCachedBatch()`.

- [ ] **Step 1: Write exact managed-tab header tests**

```ts
expect(MANAGED_TAB_HEADERS.JERA_PAYMENT_DETAIL_CACHE).toEqual([
  'detailKey', 'branchUuid', 'eventDate', 'paymentUuid', 'paymentSourceHash',
  'detailSourceHash', 'detailFetchedAt', 'lineCount', 'truncated',
])
expect(MANAGED_TAB_HEADERS.JERA_PAYMENT_DETAIL_LINES).toEqual([
  'detailKey', 'lineOrdinal', 'lineKind', 'itemCode', 'netLineSatang',
])
expect(MANAGED_TAB_HEADERS.JERA_ALLOCATION_COVERAGE).toEqual([
  'dayKey', 'branchUuid', 'eventDate', 'paymentCacheKey', 'productSalesCacheKey', 'paymentSetHash',
  'paymentRowCount', 'successfulDetailCount', 'metadataSnapshotHash', 'paymentLastSuccessAt',
  'productSalesLastSuccessAt', 'cursor', 'status', 'lastAttemptAt', 'lastSuccessAt',
  'safeErrorCode', 'leaseOwner', 'leaseExpiresAt',
])
```

- [ ] **Step 2: Run setup tests and verify the new headers fail**

Run: `npx vitest run tests/pmc-mini-app/setup.test.ts`

Expected: FAIL because the three managed tabs are absent.

- [ ] **Step 3: Add the three tabs to `MANAGED_TAB_HEADERS`**

Add exported constants with the exact headers above. `ensureMiniAppWorkbook()` must continue to reject non-empty incompatible headers before any workbook mutation, create only missing tabs, write exact headers, and freeze row 1.

- [ ] **Step 4: Write allocation-store failure tests**

Cover all of these cases in `tests/jera/allocationStore.test.ts`:

- replace one payment detail atomically as one cache header plus ordered line rows;
- accept an empty successful detail with `lineCount=0`;
- reject a line count mismatch, negative satang, invalid hash, duplicate ordinal, or wrong day;
- key identity is SHA-256 of branch UUID + date + payment UUID + PAYMENT source hash;
- repeated identical write is unchanged and does not duplicate lines;
- a changed PAYMENT source hash produces a new detail identity and excludes the old one from the current day snapshot;
- coverage cursor and counts survive process recreation;
- `claimCoverageLease()` and `releaseCoverageLease()` are owner-checked;
- list only `INCOMPLETE` coverage, oldest attempt first, with a hard maximum of 20 rows.

- [ ] **Step 5: Run allocation-store tests and verify they fail**

Run: `npx vitest run tests/jera/allocationStore.test.ts`

Expected: FAIL because `createGoogleJeraAllocationStore()` is undefined.

- [ ] **Step 6: Implement the allocation store**

```ts
export interface JeraAllocationStore {
  replacePaymentDetail(input: JeraCachedPaymentDetail): Promise<void>
  readDay(input: { branchUuid: string; eventDate: string; paymentSetHash: string }): Promise<{
    coverage: JeraAllocationCoverage | null
    details: JeraCachedPaymentDetail[]
  }>
  getCoverage(dayKey: string): Promise<JeraAllocationCoverage | null>
  saveCoverage(value: JeraAllocationCoverage): Promise<void>
  listIncompleteCoverage(limit: number): Promise<JeraAllocationCoverage[]>
  claimCoverageLease(input: { dayKey: string; owner: string; now: string; ttlMs: number }): Promise<boolean>
  releaseCoverageLease(dayKey: string, owner: string): Promise<void>
}

export type JeraAllocationCoverageStatus = 'INCOMPLETE' | 'COMPLETE'
```

Persist only allocation-relevant OPD/course line data—never patient, mobile, Facebook, salesperson, raw provider payload, or credentials. Build OPD `netLineSatang` as `max(0, (priceSatang - discountSatang) * quantity)` after validating integer money and finite positive quantity; build course weight from positive `paidAmountSatang ?? totalSatang ?? 0` and mark its line kind `COURSE`.

- [ ] **Step 7: Write one-snapshot multi-day read tests**

Add tests proving `JeraReportStore.readSnapshots(queries)` loads the cache table once and the sync-state table once for 93 day-source queries, filters by exact cache key, preserves empty successful days, and never mixes a month-range cache row into a day cache.

- [ ] **Step 8: Implement batch cache reads and coordinator envelopes**

```ts
export interface JeraCachedSnapshotQuery {
  reportType: JeraSourceReportType
  filters: JeraReportFilters
}

// JeraReportStore
readSnapshots(queries: JeraCachedSnapshotQuery[]): Promise<Array<{
  query: JeraCachedSnapshotQuery
  rows: JeraNormalizedRow[]
  state: JeraSyncStateRecord | null
}>>

// JeraSyncCoordinator
readCachedBatch(queries: JeraSyncQuery[]): Promise<Array<JeraCacheEnvelope<JeraNormalizedRow[]>>>
```

`readCachedBatch()` must reuse the existing envelope freshness logic, preserve input order, make no provider call, and reject more than 100 source queries.

- [ ] **Step 9: Run store and coordinator tests**

Run: `npx vitest run tests/jera/store.test.ts tests/jera/allocationStore.test.ts tests/jera/syncCoordinator.test.ts tests/pmc-mini-app/setup.test.ts`

Expected: PASS with a bounded number of Sheet reads.

- [ ] **Step 10: Commit storage boundaries**

```bash
git add server/pmc-mini-app/setup.ts server/jera/store.ts server/jera/syncCoordinator.ts server/jera/allocationStore.ts tests/pmc-mini-app/setup.test.ts tests/jera/store.test.ts tests/jera/syncCoordinator.test.ts tests/jera/allocationStore.test.ts
git commit -m "feat: persist bounded revenue allocation cache"
```

---

### Task 3: Build the Resumable Payment-Detail Worker

**Files:**
- Create: `server/jera/allocationTaskQueue.ts`
- Create: `server/jera/allocationWorker.ts`
- Create: `tests/jera/allocationTaskQueue.test.ts`
- Create: `tests/jera/allocationWorker.test.ts`
- Modify: `server/jera/client.ts`
- Modify: `tests/jera/client.test.ts`
- Modify: `server/jera/config.ts`
- Modify: `tests/jera/config.test.ts`
- Modify: `server/jera/runtime.ts`
- Modify: `server/jera/middleware.ts`
- Modify: `server/productionApp.ts`
- Modify: `tests/jera/reportApi.test.ts`
- Modify: `tests/pmc-mini-app/productionApp.test.ts`

**Interfaces:**
- Consumes: `JeraReadPort.request('PAYMENT_DETAIL', { paymentUuid })`, day PAYMENT/PRODUCT_SALES snapshots, `JeraAllocationStore`, and the existing OIDC worker verifier pattern.
- Produces: `JeraAllocationTaskQueuePort.enqueue()`, `JeraAllocationWorker.run()`, and internal route `POST /internal/mini-app/jera-allocation-worker`.

- [ ] **Step 1: Write fail-closed allocation configuration tests**

Add the following accepted environment contract to `tests/jera/config.test.ts`:

```ts
const allocationEnv = {
  JERA_REVENUE_ALLOCATION_ENABLED: 'true',
  JERA_ALLOCATION_PROJECT_ID: 'pmc-project',
  JERA_ALLOCATION_LOCATION: 'asia-southeast1',
  JERA_ALLOCATION_QUEUE: 'pmc-revenue-allocation',
  JERA_ALLOCATION_WORKER_URL: 'https://pmc-mini-app.example/internal/mini-app/jera-allocation-worker',
  JERA_ALLOCATION_WORKER_AUDIENCE: 'https://pmc-mini-app.example',
  JERA_ALLOCATION_TASK_INVOKER_EMAIL: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com',
  JERA_FINANCE_CATEGORY_MONEY_ENABLED: 'false',
}
```

Assert that missing one value, wrong region, HTTP URL, query/fragment, invalid service-account email, unknown `JERA_` variable, or an enabled category-money flag while allocation is disabled makes `readJeraConfig()` return null. Allocation and category money both default false when absent.

- [ ] **Step 2: Run config tests and verify they fail**

Run: `npx vitest run tests/jera/config.test.ts`

Expected: FAIL because `JeraConfig` has no allocation block.

- [ ] **Step 3: Implement the exact allocation config**

Extend `JeraConfig` with:

```ts
allocation: null | {
  projectId: string
  location: 'asia-southeast1'
  queueName: string
  workerUrl: string
  workerAudience: string
  taskInvokerEmail: string
  maxDetailsPerRun: 20
  continuationDelaySeconds: 60
}
financeCategoryMoneyEnabled: boolean
```

Add only the listed environment names to `ALLOWED_NAMES`; retain the current unknown-name fail-closed behavior.

- [ ] **Step 4: Write deterministic queue tests**

```ts
expect(task.httpRequest.body).toEqual(Buffer.from(JSON.stringify({
  branchUuid: BRANCH, eventDate: '2026-08-29', paymentSetHash: 'a'.repeat(64), cursor: 0,
})))
expect(task.httpRequest.oidcToken).toEqual({
  serviceAccountEmail: 'pmc-mini-app-task-invoker@pmc-project.iam.gserviceaccount.com',
  audience: 'https://pmc-mini-app.example',
})
expect(task.scheduleTime).toEqual({ seconds: 1_788_044_460, nanos: 0 })
expect(task.name.split('/').at(-1)).toMatch(/^finance-allocation-[a-f0-9]{64}$/)
```

Also assert gRPC code 6 is idempotent success and all other provider errors become `JERA_ALLOCATION_TASK_FAILED` without cause or provider metadata.

- [ ] **Step 5: Implement `createGoogleJeraAllocationTaskQueue()`**

```ts
export interface JeraAllocationTaskQueuePort {
  enqueue(input: {
    branchUuid: string
    eventDate: string
    paymentSetHash: string
    cursor: number
    scheduleAt: Date
  }): Promise<{ taskName: string; alreadyExists: boolean }>
}
```

Hash the immutable JSON tuple `[branchUuid,eventDate,paymentSetHash,cursor]` for the task ID. Never include the raw branch UUID, date, or payment UUID in the task name.

- [ ] **Step 6: Write worker behavior tests**

Cover:

- exactly one `PAYMENT_DETAIL` request is active at a time;
- no more than 20 new detail requests per run;
- every PAYMENT_DETAIL attempt begins at least 3,000 ms after the prior attempt, using an injected clock/sleep in tests;
- cursor persists after each successful detail;
- an identical detail identity is skipped without a provider call;
- provider `Retry-After` produces a continuation scheduled no earlier than the greater of 60 seconds and Retry-After;
- a 21-payment day schedules cursor 20 continuation at +60 seconds;
- complete coverage stores PAYMENT count, detail count, metadata hash, both source-success timestamps, and `COMPLETE`;
- a changed PAYMENT set hash resets coverage to cursor 0 without deleting historical evidence;
- task replay with complete coverage makes zero provider calls;
- lease conflict returns an idempotent no-op;
- provider errors persist only a safe `JERA_*` code.

Add client tests proving `request('PAYMENT_DETAIL', { paymentUuid })` returns the single registered detail object as a one-element transport array, never treats its nested OPD rows as pagination, and carries only a bounded `retryAfterSeconds` value on the final `JERA_RATE_LIMITED` error. Preserve the existing scheduled-client internal Retry-After wait behavior.

- [ ] **Step 7: Implement the worker**

```ts
export interface JeraAllocationWorker {
  run(input: {
    branchUuid: string
    eventDate: string
    paymentSetHash: string
    cursor: number
    workerId: string
  }): Promise<{ status: 'COMPLETE' | 'CONTINUED' | 'SKIPPED'; processed: number; nextCursor: number | null }>
}
```

The worker must sort payment UUIDs lexicographically, verify the task payment-set hash against the current exact-day PAYMENT snapshot before doing work, use `normalizePaymentDetail()`, persist after every detail, and enqueue continuation only after saving the cursor. Course lines always classify as service; OPD item types come only from the exact-day PRODUCT_SALES snapshot.

Construct a dedicated worker client with `createJeraReadClient(config, tokens, { mode: 'INTERACTIVE' })` so a logical detail attempt is exactly one provider request and retries are controlled only by the durable worker. Inject `now()` and `sleep()` into the worker, wait until 3,000 ms after the previous attempt before the next PAYMENT_DETAIL request, and persist the attempt timestamp with coverage. Extend `JeraReadError` to retain only a bounded `retryAfterSeconds` value for final 429 responses; the worker schedules a continuation instead of retrying in-process. Keep the existing scheduled client behavior for the legacy scheduler and the existing interactive client for user-triggered source refresh. Report GETs use neither client.

- [ ] **Step 8: Add the authenticated internal route**

The internal route must:

1. accept POST only;
2. require an OIDC bearer token for the exact configured audience and service-account email;
3. accept exactly `branchUuid`, `eventDate`, `paymentSetHash`, and `cursor`;
4. cap the body at 2 KB;
5. return 200 with only `{status,processed,nextCursor}`; and
6. replace every unexpected failure with `{error:'JERA_ALLOCATION_FAILED'}`.

Add `/internal/mini-app/jera-allocation-worker` to the explicit Mini App internal-path allowlist in `server/productionApp.ts`; do not rely on the `/api/mini-app/` prefix matcher. Add a production-router test proving the path reaches the Mini App middleware only when configured and remains outside Basic Auth/static fallback handling.

- [ ] **Step 9: Run worker, API, and runtime tests**

Run: `npx vitest run tests/jera/config.test.ts tests/jera/allocationTaskQueue.test.ts tests/jera/allocationWorker.test.ts tests/jera/reportApi.test.ts tests/jera/runtimeSafety.test.ts tests/pmc-mini-app/productionApp.test.ts`

Expected: PASS with raw provider fields absent from serialized errors.

- [ ] **Step 10: Commit resumable allocation processing**

```bash
git add server/jera/client.ts server/jera/config.ts server/jera/runtime.ts server/jera/middleware.ts server/jera/allocationTaskQueue.ts server/jera/allocationWorker.ts server/productionApp.ts tests/jera/client.test.ts tests/jera/config.test.ts tests/jera/allocationTaskQueue.test.ts tests/jera/allocationWorker.test.ts tests/jera/reportApi.test.ts tests/pmc-mini-app/productionApp.test.ts
git commit -m "feat: add resumable payment allocation worker"
```

---

### Task 4: Introduce Finance Permissions with a Fail-Closed Sheet Migration

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/sheetSchema.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/sheetMigration.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Modify: `apps/pmc-google-booking-ops/tests/sheetMigration.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/staffDirectory.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/runtimeStockMigration.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/build.test.ts`
- Modify: `server/pmc-mini-app/store.ts`
- Modify: `server/pmc-mini-app/contracts.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `tests/pmc-mini-app/store.test.ts`
- Modify: `tests/pmc-mini-app/sessionApi.test.ts`
- Modify: `src/apps/pmc-mini-app/contracts.ts`

**Interfaces:**
- Consumes: immutable `CONFIG_STAFF.id` after verified LINE identity.
- Produces: `canSubmitExpense`, `canViewFinance`, and `canManageExpense` on `StaffConfig`, `MiniAppStaffRecord`, `AuthenticatedMiniAppContext`, and `MiniAppConfig`.

- [ ] **Step 1: Write the canonical 12-column schema tests**

```ts
expect(STAFF_CONFIG_COLUMNS).toEqual([
  'id', 'name', 'email', 'lineUserId', 'canCloseBooking', 'canBeAe', 'active',
  'profileImageUrl', 'canManageStock', 'canSubmitExpense', 'canViewFinance', 'canManageExpense',
])
```

Assert that the old nine-column header yields one `APPEND_FINANCE_PERMISSIONS` migration with all three exact headers, the new header yields `NONE`, and any reordered/unknown header throws before writing.

- [ ] **Step 2: Run schema tests and verify they fail**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/staffDirectory.test.ts`

Expected: FAIL because finance permission columns do not exist.

- [ ] **Step 3: Implement the compatible-header migration**

Rename `StaffProfileMigrationPlan`/`staffProfileMigrationPlan()` to `StaffConfigMigrationPlan`/`staffConfigMigrationPlan()` and rename `migrateConfigStaffProfileColumn()` to `migrateConfigStaffColumns()`, updating every call site and test import. The migration loop may append the existing profile/Stock columns for older supported headers, then append all three finance columns together. Newly appended cells remain blank, which every reader interprets as false.

Export an operator-only Apps Script entrypoint `migratePmcFinancePermissionColumns()` that opens the already configured Booking Operations spreadsheet, calls the compatible migration, performs exact 12-column readback, and returns only `{changed:boolean,columnCount:12}`. It must not grant permissions, print rows, or return Sheet/LINE IDs. Add it to `scripts/build.mjs` and `build.test.ts`.

- [ ] **Step 4: Write server authorization parsing tests**

Add tests proving:

- exact boolean true enables each role;
- blank, missing, malformed, or shifted values produce false;
- staff names `owner`, `doctor`, or `มัส` do not enable a role;
- inactive or unlinked records remain denied;
- `/api/mini-app/config` exposes role booleans but not LINE user ID or email;
- `/api/mini-app/session` remains the existing minimal projection.

- [ ] **Step 5: Implement the 12-column reader and authenticated context**

Change `STAFF_RANGE` to `'CONFIG_STAFF'!A2:L`, update enrollment writes to preserve all 12 columns, and add the three booleans to `AuthenticatedMiniAppContext`. Do not derive roles from display name, email, Stock role, or booking role.

- [ ] **Step 6: Run permission and existing Stock/Booking tests**

Run: `npx vitest run tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/sessionApi.test.ts tests/pmc-mini-app/stockApi.test.ts tests/pmc-mini-app/security.test.ts && npm run booking:test`

Expected: PASS; Stock remains controlled only by `canManageStock`.

Run: `npm run booking:typecheck && npm run booking:build`

Expected: both commands PASS and the built Apps Script bundle exports `migratePmcFinancePermissionColumns`.

- [ ] **Step 7: Commit finance authorization**

```bash
git add apps/pmc-google-booking-ops/src/sheetSchema.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/src/domain/sheetMigration.ts apps/pmc-google-booking-ops/src/adapters/googleSheets.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/src/entrypoints.ts apps/pmc-google-booking-ops/scripts/build.mjs apps/pmc-google-booking-ops/tests/sheetMigration.test.ts apps/pmc-google-booking-ops/tests/staffDirectory.test.ts apps/pmc-google-booking-ops/tests/runtimeStockMigration.test.ts apps/pmc-google-booking-ops/tests/build.test.ts server/pmc-mini-app/store.ts server/pmc-mini-app/contracts.ts server/pmc-mini-app/middleware.ts tests/pmc-mini-app/store.test.ts tests/pmc-mini-app/sessionApi.test.ts src/apps/pmc-mini-app/contracts.ts
git commit -m "feat: add fail-closed finance permissions"
```

---

### Task 5: Add Cache-Only Finance Read and One-Day Refresh APIs

**Files:**
- Create: `server/jera/financeService.ts`
- Create: `tests/jera/financeService.test.ts`
- Modify: `server/jera/middleware.ts`
- Modify: `server/jera/runtime.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/productionApp.ts`
- Modify: `tests/jera/reportApi.test.ts`
- Modify: `tests/pmc-mini-app/security.test.ts`
- Modify: `tests/pmc-mini-app/productionApp.test.ts`

**Interfaces:**
- Consumes: `JeraSyncCoordinator.readCachedBatch()`, `manualRefresh()`, `JeraAllocationStore`, `JeraAllocationTaskQueuePort`, finance role flags, and Task 1 projections.
- Produces: `JeraFinanceService.readDaily()`, `readMonthly()`, `refreshDay()`, plus authenticated finance endpoints.

- [ ] **Step 1: Write cache-only service tests**

```ts
export interface JeraFinanceService {
  readDaily(input: { branchUuid: string; startDate: string; endDate: string }): Promise<DailyIncomeProjection>
  readMonthly(input: { branchUuid: string; year: number; month: number }): Promise<MonthlyIncomeProjection>
  refreshDay(input: {
    branchUuid: string; eventDate: string
    actor: { type: 'STAFF'; staffId: string } | { type: 'SCHEDULER'; schedulerId: string }
  }): Promise<{
    accepted: true
    allocationQueued: boolean
    retryAfterSeconds: number
  }>
}
```

Tests must prove:

- 1 and 31 days succeed; 0, 32, reversed, and invalid dates fail before store access;
- `readDaily()` requests exact-day PAYMENT, REFUND, and PRODUCT_SALES cache keys and makes zero provider calls;
- 31 days are loaded through one bounded `readCachedBatch()` call and one bounded allocation read;
- payment rows group newest date first;
- empty cache returns `FINANCE_CACHE_EMPTY`, not a confirmed zero;
- monthly boundaries for January, February 2028, and December use Asia/Bangkok and the server-derived `monthKey`;
- component freshness and the 15-minute category skew rule are visible;
- `refreshDay()` calls PAYMENT, REFUND, PRODUCT_SALES sequentially, seeds coverage from the refreshed exact-day hashes, and enqueues cursor 0;
- a source refresh failure retains previous cache and does not claim full refresh success;
- a 429 reports the minimum safe retry without leaking a partial provider response.

- [ ] **Step 2: Run service tests and verify they fail**

Run: `npx vitest run tests/jera/financeService.test.ts`

Expected: FAIL because `createJeraFinanceService()` does not exist.

- [ ] **Step 3: Implement `createJeraFinanceService()`**

The service must generate day strings using integer UTC date stepping only after validating Bangkok date labels. For monthly input, validate `year` as 2020-2100 and `month` as 1-12, derive the last day with `new Date(Date.UTC(year, month, 0))`, and never accept `monthKey` from the caller.

- [ ] **Step 4: Write API authorization and filter tests**

Exact routes:

```text
GET  /api/mini-app/finance/daily?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
POST /api/mini-app/finance/daily/refresh?date=YYYY-MM-DD
GET  /api/mini-app/finance/monthly?year=2026&month=8
POST /internal/mini-app/finance-daily-seed
```

Assert:

- unauthenticated requests return 401;
- any active staff can GET daily;
- only `canViewFinance=true` can GET monthly, otherwise 403 before cache access;
- only `canViewFinance=true` can refresh a source day in this first rollout;
- unknown, repeated, or extra query parameters return 400;
- daily range over 31 returns 400;
- monthly never accepts `monthKey`, `startDate`, or `endDate`;
- GET calls never invoke `manualRefresh`, allocation queue, or provider client;
- category money remains null when the server gate is false even with complete coverage;
- response JSON contains no raw detail, phone, Facebook, Sheet ID, provider credential, or private cache identity.

The internal daily-seed route uses the same exact OIDC audience/service-account verification as the allocation worker, accepts no user-supplied date/body/query, derives the previous completed Bangkok date on the server, and calls `refreshDay()` with a scheduler actor. Add it to the explicit production-router internal allowlist. Repeated execution is throttled/idempotent through the exact-day sync state and allocation task identity.

- [ ] **Step 5: Implement finance routes before generic report routing**

Add `isJeraFinanceApiPath()` and route these paths under existing LINE staff authentication. Preserve `/api/mini-app/reports/*` unchanged for rollback. Return safe codes `FINANCE_FILTER_INVALID`, `FINANCE_FORBIDDEN`, `FINANCE_CACHE_UNAVAILABLE`, and `FINANCE_REFRESH_UNAVAILABLE` only.

- [ ] **Step 6: Run API and security tests**

Run: `npx vitest run tests/jera/financeService.test.ts tests/jera/reportApi.test.ts tests/pmc-mini-app/security.test.ts tests/pmc-mini-app/productionApp.test.ts`

Expected: PASS; existing report endpoints and authorization still work.

- [ ] **Step 7: Commit finance endpoints**

```bash
git add server/jera/financeService.ts server/jera/middleware.ts server/jera/runtime.ts server/pmc-mini-app/middleware.ts server/productionApp.ts tests/jera/financeService.test.ts tests/jera/reportApi.test.ts tests/pmc-mini-app/security.test.ts tests/pmc-mini-app/productionApp.test.ts
git commit -m "feat: expose cache-only finance report APIs"
```

---

### Task 6: Add Client Finance State and Typed API Methods

**Files:**
- Create: `src/apps/pmc-mini-app/financeReports.ts`
- Create: `tests/pmc-mini-app/financeReports.test.ts`
- Modify: `src/apps/pmc-mini-app/contracts.ts`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Modify: `tests/pmc-mini-app/api.test.ts`
- Modify: `server/pmc-mini-app/config.ts`
- Modify: `tests/pmc-mini-app/config.test.ts`
- Modify: `server/pmc-mini-app/middleware.ts`

**Interfaces:**
- Consumes: Task 1 DTOs and Task 5 routes.
- Produces: `FinanceDailyFilter`, `FinanceMonthSelection`, client validation helpers, and three typed Mini App API methods.

- [ ] **Step 1: Write date/month client-state tests**

```ts
expect(defaultFinanceDailyFilter('2026-08-29')).toEqual({
  preset: 'TODAY', startDate: '2026-08-29', endDate: '2026-08-29',
})
expect(applyFinanceDailyPreset(filter, 'YESTERDAY', '2026-09-01')).toMatchObject({
  startDate: '2026-08-31', endDate: '2026-08-31',
})
expect(financeDailyFilterError({ ...filter, startDate: '2026-08-01', endDate: '2026-09-01' }))
  .toBe('เลือกช่วงเวลาได้ไม่เกิน 31 วัน')
expect(monthSelectionToSearch({ year: 2026, month: 8 }).toString()).toBe('year=2026&month=8')
```

Store only filter preferences in `sessionStorage` under `pmc-finance-report-filters-v1`; never store finance response rows, totals, role flags, or evidence.

- [ ] **Step 2: Run client-state tests and verify they fail**

Run: `npx vitest run tests/pmc-mini-app/financeReports.test.ts`

Expected: FAIL because `financeReports.ts` does not exist.

- [ ] **Step 3: Implement finance filters and Bangkok defaults**

Support only `TODAY`, `YESTERDAY`, and `CUSTOM` daily presets. Monthly state is `{year,month}`. Recompute relative presets on every load so stored dates cannot become stale.

- [ ] **Step 4: Write typed browser API tests**

Add methods to `MiniAppBrowserApi`:

```ts
loadDailyIncome(idToken: string, filter: FinanceDailyFilter): Promise<DailyIncomeProjection>
refreshDailyIncome(idToken: string, eventDate: string): Promise<{
  accepted: true; allocationQueued: boolean; retryAfterSeconds: number
}>
loadMonthlyIncome(idToken: string, selection: FinanceMonthSelection): Promise<MonthlyIncomeProjection>
```

Assert exact URLs, bearer-only auth, POST with no JSON body for refresh, 403 preservation, safe retry parsing, and no `monthKey` query field.

- [ ] **Step 5: Add disabled-first UI configuration**

Add optional environment flag `PMC_FINANCE_REPORTS_ENABLED`; only `true` enables it, invalid values reject Mini App config, and absence is false. Return `financeReportsEnabled: Boolean(deps.jera) && deps.config.financeReportsEnabled` plus `canViewFinance` from `/api/mini-app/config`.

- [ ] **Step 6: Run client API and config tests**

Run: `npx vitest run tests/pmc-mini-app/financeReports.test.ts tests/pmc-mini-app/api.test.ts tests/pmc-mini-app/config.test.ts tests/pmc-mini-app/defaultApiStability.test.tsx`

Expected: PASS with legacy reporting still available when the new flag is false.

- [ ] **Step 7: Commit client contracts**

```bash
git add src/apps/pmc-mini-app/financeReports.ts src/apps/pmc-mini-app/contracts.ts src/apps/pmc-mini-app/api.ts server/pmc-mini-app/config.ts server/pmc-mini-app/middleware.ts tests/pmc-mini-app/financeReports.test.ts tests/pmc-mini-app/api.test.ts tests/pmc-mini-app/config.test.ts
git commit -m "feat: add typed finance report client"
```

---

### Task 7: Replace the Primary Report UI Behind the Finance Feature Flag

**Files:**
- Create: `src/apps/pmc-mini-app/FinanceReportHome.tsx`
- Create: `src/apps/pmc-mini-app/DailyIncomePage.tsx`
- Create: `src/apps/pmc-mini-app/MonthlyFinancePage.tsx`
- Create: `tests/pmc-mini-app/financeReportHome.test.tsx`
- Create: `tests/pmc-mini-app/dailyIncomePage.test.tsx`
- Create: `tests/pmc-mini-app/monthlyFinancePage.test.tsx`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/preview.ts`
- Modify: `src/apps/pmc-mini-app/styles.css`
- Modify: `tests/pmc-mini-app/clientShell.test.tsx`
- Modify: `tests/pmc-mini-app/reportCopy.test.tsx`

**Interfaces:**
- Consumes: `MiniAppConfig.financeReportsEnabled`, `MiniAppConfig.canViewFinance`, Task 6 browser API methods, and Task 1 DTOs.
- Produces: a finance-first report flow with internal views `FINANCE_HOME | DAILY_INCOME | MONTHLY_INCOME`.

- [ ] **Step 1: Run mandatory modern web guidance before client implementation**

Run:

```bash
npx -y modern-web-guidance@latest search "mobile finance dashboard cards date range accessible tables loading stale data" --skill-version 2026_05_16-c5e78707
```

Record only directly applicable accessibility/responsive findings in the implementing agent's task notes; do not add a dependency.

- [ ] **Step 2: Write finance-home tests**

Assert:

- two large primary cards are labeled `รายรับรายวัน` and `รายงานรายเดือน`;
- ordinary staff see daily income and a locked monthly card without finance amounts;
- finance staff can open monthly;
- compact cards list `บิลเอกสาร`, `สมุดรายจ่ายภายในคลินิก`, `สมุดรายจ่ายส่วนตัวหมอ`, `เงินเดือนพนักงาน`, `DF พนักงานตามแพ็กเกจ`, and `DF แพทย์`;
- every expense card renders `เตรียมระบบ` and has no create action in this plan;
- the primary new UI contains none of the legacy labels `สรุปวันนี้`, `มัดจำ`, `นัดหมาย`, or `รายงานเพิ่มเติม`;
- no provider name appears in text or ARIA labels.

- [ ] **Step 3: Run finance-home tests and verify they fail**

Run: `npx vitest run tests/pmc-mini-app/financeReportHome.test.tsx`

Expected: FAIL because `FinanceReportHome` does not exist.

- [ ] **Step 4: Implement the clean report home**

Use semantic buttons, minimum 48px tap targets, visible focus, two primary cards, and compact disabled expense cards. Do not render figures on the home page. The legacy `ReportCenter` remains reachable only when `financeReportsEnabled=false` during rollback.

- [ ] **Step 5: Write daily-income page tests**

Cover:

- today, yesterday, and custom 1-31 day selection;
- received, refund, and net cards;
- service/course, Product, and unclassified cards are visually separate from authoritative received;
- transfer, cash, Credit, other, and channel-difference warning;
- payment detail groups newest day first;
- `กำลังตรวจสอบหมวด` plus exact incomplete dates when category money is null;
- mixed freshness labels and last sync times;
- refresh button accepts one selected day only and performs one reload with no polling;
- lost/failed refresh retains the last cache and announces a safe error;
- provider HTML is inert React text and wide detail tables are explicitly scrollable.

- [ ] **Step 6: Implement `DailyIncomePage`**

The component adapter is:

```ts
export interface DailyIncomePageAdapter {
  load(filter: FinanceDailyFilter): Promise<DailyIncomeProjection>
  refresh(eventDate: string): Promise<{ accepted: true; allocationQueued: boolean; retryAfterSeconds: number }>
}
```

Use a request epoch so an older refresh cannot overwrite a newly selected range. Do not add timers or polling props.

- [ ] **Step 7: Write and implement monthly-income page tests**

Assert finance-only rendering of:

- month selector;
- received, refund, and net income;
- daily trend rendered as an accessible list/table before adding decorative charting;
- payment-channel breakdown;
- category money or checking state;
- `รายจ่ายที่บันทึก — เตรียมระบบ` and `คงเหลือโดยประมาณ — เตรียมระบบ`, never `0 บาท`;
- no refresh-all button;
- drill-down changes to the selected daily range without provider calls.

Adapter:

```ts
export interface MonthlyIncomePageAdapter {
  load(selection: FinanceMonthSelection): Promise<MonthlyIncomeProjection>
}
```

- [ ] **Step 8: Wire feature-flagged navigation in `PmcMiniApp`**

When `financeReportsEnabled=true`, the report tab uses the three finance views. When false, preserve the current legacy report flow exactly. Monthly navigation must also check `config.canViewFinance` client-side, while the server remains authoritative.

- [ ] **Step 9: Add responsive and accessibility CSS**

Use existing PMC color variables and typography. Keep cards single-column below 360px, two-column where space allows, use tabular numerals for money, never encode status by color alone, honor `prefers-reduced-motion`, and keep bottom navigation unobscured by device safe-area insets.

- [ ] **Step 10: Run focused UI tests**

Run: `npx vitest run tests/pmc-mini-app/financeReportHome.test.tsx tests/pmc-mini-app/dailyIncomePage.test.tsx tests/pmc-mini-app/monthlyFinancePage.test.tsx tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/reportCopy.test.tsx tests/pmc-mini-app/reportSafety.test.tsx`

Expected: PASS in jsdom with no legacy primary navigation under the enabled flag.

- [ ] **Step 11: Commit the finance-first UI**

```bash
git add src/apps/pmc-mini-app/FinanceReportHome.tsx src/apps/pmc-mini-app/DailyIncomePage.tsx src/apps/pmc-mini-app/MonthlyFinancePage.tsx src/apps/pmc-mini-app/PmcMiniApp.tsx src/apps/pmc-mini-app/preview.ts src/apps/pmc-mini-app/styles.css tests/pmc-mini-app/financeReportHome.test.tsx tests/pmc-mini-app/dailyIncomePage.test.tsx tests/pmc-mini-app/monthlyFinancePage.test.tsx tests/pmc-mini-app/clientShell.test.tsx tests/pmc-mini-app/reportCopy.test.tsx
git commit -m "feat: replace report catalog with finance views"
```

---

### Task 8: Verify End-to-End Behavior and Regression Safety

**Files:**
- Modify: `tests/pmc-mini-app/endToEnd.test.ts`
- Modify: `tests/pmc-mini-app/browserAcceptance.spec.ts`
- Modify: `tests/pmc-mini-app/productionApp.test.ts`
- Modify: `tests/pmc-mini-app/defaultApiStability.test.tsx`
- Modify: `tests/jera/runtimeSafety.test.ts`

**Interfaces:**
- Consumes: the completed server/client finance flow.
- Produces: automated acceptance evidence for active staff, finance staff, cache-only reads, and disabled-first release behavior.

- [ ] **Step 1: Add server end-to-end acceptance fixtures**

Create synthetic one-day and 31-day caches with PAYMENT, REFUND, PRODUCT_SALES, detail lines, and coverage. Verify:

```text
active staff -> daily 200
ordinary staff -> monthly 403
finance staff -> monthly 200
GET daily/monthly -> zero provider calls and zero task writes
manual one-day refresh -> sequential source refresh + one allocation task
complete allocation + gate off -> category money null
complete allocation + gate on -> exact satang category partition
```

- [ ] **Step 2: Add browser acceptance flows**

```text
Home -> Reports -> Daily income -> yesterday -> payment detail
Home -> Reports -> Daily income -> 31-day custom range -> newest-day groups
Finance account -> Reports -> Monthly -> previous month -> daily drill-down
Staff account -> Reports -> monthly locked, daily available
Expense cards -> visible as เตรียมระบบ, no active submission
```

Mock only network boundaries; render the actual `PmcMiniApp` and finance components.

- [ ] **Step 3: Run focused end-to-end and browser tests**

Run:

```bash
npx vitest run tests/pmc-mini-app/endToEnd.test.ts tests/pmc-mini-app/productionApp.test.ts tests/pmc-mini-app/defaultApiStability.test.tsx tests/jera/runtimeSafety.test.ts
npx playwright test -c playwright.mini-app.config.ts tests/pmc-mini-app/browserAcceptance.spec.ts
```

Expected: PASS with no browser console errors and no unexpected HTTP 5xx.

- [ ] **Step 4: Run the complete project verification matrix**

Run:

```bash
npm run build
npm test
npm run booking:test
npm run ocr:test
npm run lint
```

Expected: all tests PASS; lint has zero errors. Record any pre-existing warning verbatim without changing unrelated generated files.

- [ ] **Step 5: Commit integration acceptance**

```bash
git add tests/pmc-mini-app/endToEnd.test.ts tests/pmc-mini-app/browserAcceptance.spec.ts tests/pmc-mini-app/productionApp.test.ts tests/pmc-mini-app/defaultApiStability.test.tsx tests/jera/runtimeSafety.test.ts
git commit -m "test: verify finance report workflows"
```

---

### Task 9: Add Operator Tooling and Execute a Disabled-First Rollout

**Files:**
- Create: `scripts/check-finance-report-runtime.mjs`
- Create: `scripts/seed-finance-report-day.mjs`
- Create: `scripts/backfill-finance-report-days.mjs`
- Create: `docs/pmc-mini-app/finance-report-rollout-runbook.md`
- Create: `tests/jera/financeOperatorScripts.test.ts`
- Modify: `docs/pmc-mini-app/pilot-runbook.md`
- Modify: `docs/pmc-mini-app/clinic-report-rollout-evidence-2026-08-29.md` only after a real approved rollout produces evidence.

**Interfaces:**
- Consumes: built server modules, `gcloud`, operator-owned authenticated Google access, owner-approved project/service/role selections, and a source-day comparison export.
- Produces: read-only preflight, bounded one-day seed, immutable evidence, and an exact rollback procedure.

- [ ] **Step 1: Write operator-script contract tests**

Assert all three operator scripts:

- require `--allow-readonly-production` before any live read;
- require the additional `--allow-cache-write` flag before the seed script mutates cache or coverage tabs;
- reject unknown flags and missing project/service/region/date;
- accept only `YYYY-MM-DD` seed dates;
- never accept username, password, token, Sheet ID, or LINE user ID on the command line;
- redact configured environment and subprocess errors;
- make no writes in check mode;
- seed PAYMENT, REFUND, and PRODUCT_SALES sequentially;
- print only counts, integer satang totals, coverage counts, timestamps, role counts, and safe codes.

Apply the same contracts to `backfill-finance-report-days.mjs`, plus require `--start-date` and `--end-date`, reject ranges outside 1-31 inclusive Bangkok dates, process oldest day first, write a local operator-owned resume cursor only when an explicit `--resume-file` path is supplied, pace source calls sequentially with at least 20 seconds between report types and at least 60 seconds between dates, and never issue PAYMENT_DETAIL directly—the allocation worker owns detail calls.

- [ ] **Step 2: Implement `check-finance-report-runtime.mjs`**

Exact invocation:

```bash
node scripts/check-finance-report-runtime.mjs \
  --allow-readonly-production \
  --project "$(gcloud config get-value project)" \
  --service pmc-mini-app \
  --region asia-southeast1 \
  --expected-finance-viewers 3
```

The script must check Cloud Run revision/traffic, feature flags, JERA allocation config presence, Cloud Tasks queue configuration, three new tab headers, exactly three `canViewFinance=true` active staff IDs, zero name-based role derivation, and no active coverage lease older than 15 minutes. It prints names only alongside immutable staff IDs and never prints LINE user IDs.

- [ ] **Step 3: Implement the one-day seed script**

Exact invocation:

```bash
npm run build:server
node scripts/seed-finance-report-day.mjs \
  --allow-readonly-production \
  --allow-cache-write \
  --project "$(gcloud config get-value project)" \
  --date 2026-08-22
```

The date is the already approved source-comparison day from `docs/pmc-mini-app/clinic-report-rollout-evidence-2026-08-29.md`. The script refreshes source caches sequentially, seeds allocation coverage, waits only through bounded status reads, and prints PAYMENT received, REFUND, channel totals, service/product/unclassified totals, detail coverage, metadata hash prefix, and safe warnings without patient rows.

- [ ] **Step 4: Implement the bounded exact-day backfill script**

Exact invocation:

```bash
node scripts/backfill-finance-report-days.mjs \
  --allow-readonly-production \
  --allow-cache-write \
  --project "$(gcloud config get-value project)" \
  --start-date 2026-07-30 \
  --end-date 2026-08-29 \
  --resume-file /operator-owned/path/pmc-finance-backfill.json
```

The script must reuse the one-day seed function rather than duplicate provider logic, persist only `{version,startDate,endDate,nextDate,completedDates,safeFailures}` to the operator-owned resume file, fsync/rename the cursor atomically, and resume from `nextDate`. It stops on an unsafe schema/auth error, records bounded retry information for throttling, and never stores provider rows, patient data, credentials, resource IDs, or access tokens.

- [ ] **Step 5: Write the disabled-first runbook**

The runbook must require this order:

1. run the full verification matrix;
2. deploy a no-traffic Cloud Run revision with `PMC_FINANCE_REPORTS_ENABLED=false`, `JERA_REVENUE_ALLOCATION_ENABLED=false`, and `JERA_FINANCE_CATEGORY_MONEY_ENABLED=false`;
3. record current 100% revision as rollback target;
4. create `pmc-revenue-allocation` in `asia-southeast1` with max concurrent dispatches 1 and max dispatch rate `0.016` tasks/second, then grant only the runtime enqueuer plus OIDC invoker roles; each task processes at most 20 detail attempts and the worker spaces attempts by at least 3,000 ms, so the global ceiling remains 20 PAYMENT_DETAIL requests per minute even when several days are pending;
5. run `ensureMiniAppWorkbook()` for the new allocation cache tabs;
6. stop for an Apps Script owner gate: verify the signed-in Google account and exact existing Apps Script project/deployment, run Booking typecheck/build, review the generated bundle diff, push only through the verified project config, create an immutable version, and update only the existing deployment; never print the deployment URL, ID, or secrets;
7. execute `migratePmcFinancePermissionColumns()` once and require exact `{changed,columnCount:12}` readback before continuing;
8. keep all finance permission values false, produce the ID/name roster, and have the owner confirm the three immutable IDs for owner, doctor, and Mus;
9. set only those three `canViewFinance=true`; leave all `canSubmitExpense` and `canManageExpense` values false in this report-only release;
10. run the read-only preflight and require exactly three finance viewers;
11. enable allocation on the no-traffic revision while category money stays false;
12. seed and reconcile 2026-08-22 against PAYMENT/detail/product metadata, requiring per-payment and day allocation equality;
13. run the bounded backfill for the latest 31 completed Bangkok dates, resume safely after interruption, and require exact-day PAYMENT/REFUND/PRODUCT_SALES cache state for every day;
14. configure a daily Cloud Scheduler POST to `/internal/mini-app/finance-daily-seed` at 02:15 Asia/Bangkok using the verified OIDC invoker; the route derives and refreshes only the previous completed day;
15. obtain explicit owner approval for the comparison before setting `JERA_FINANCE_CATEGORY_MONEY_ENABLED=true`;
16. run synthetic daily, 31-day, monthly, ordinary-staff 403, and finance-staff 200 checks against the tagged no-traffic URL;
17. set `PMC_FINANCE_REPORTS_ENABLED=true` only after those checks pass;
18. route 10% traffic, observe at least 30 minutes with no unexpected 5xx, Sheets 429, queue retry storm, scheduler error, or provider write;
19. route 100%, repeat role/device checks, and record exact revision IDs and counts; and
20. rollback by pausing the finance daily Scheduler and routing 100% to the recorded revision without deleting JERA cache, allocation cache, permissions, Booking, Stock, OCR, Drive, Calendar, or LINE evidence.

- [ ] **Step 6: Run tooling tests and dry-run checks**

Run:

```bash
npx vitest run tests/jera/financeOperatorScripts.test.ts
node scripts/check-finance-report-runtime.mjs --help
node scripts/seed-finance-report-day.mjs --help
node scripts/backfill-finance-report-days.mjs --help
```

Expected: PASS; help exits 0 and a missing production-allow flag exits nonzero before `gcloud` or Google API access.

- [ ] **Step 7: Commit tooling and runbook before any live action**

```bash
git add scripts/check-finance-report-runtime.mjs scripts/seed-finance-report-day.mjs scripts/backfill-finance-report-days.mjs docs/pmc-mini-app/finance-report-rollout-runbook.md docs/pmc-mini-app/pilot-runbook.md tests/jera/financeOperatorScripts.test.ts
git commit -m "docs: add finance report rollout gates"
```

- [ ] **Step 8: Stop at the Production approval gate**

Present the exact no-traffic revision, rollback revision, queue configuration, schema diff, three approved immutable staff IDs, source-day reconciliation table, test counts, and expected recurring runtime cost. Do not migrate, change roles, enable flags, route traffic, or append rollout evidence until the owner explicitly authorizes that exact live action.

---

## Final Self-Review Checklist

- [ ] Every accepted daily-income requirement maps to Tasks 1, 5, 6, and 7.
- [ ] Historical 1-31 day bounds and newest-day grouping map to Tasks 1, 5, 6, and 8.
- [ ] Payment-detail identity, metadata hash, cursor, rate cap, and coverage marker map to Tasks 2 and 3.
- [ ] Monthly Bangkok boundaries and finance-only access map to Tasks 4 and 5.
- [ ] UI replacement, disabled expense cards, and no provider naming map to Task 7.
- [ ] Quota safety, no GET refresh, no polling, and bounded batch reads map to Tasks 2, 5, and 8.
- [ ] Disabled-first deployment, source-day reconciliation, explicit category-money gate, canary, and rollback map to Task 9.
- [ ] Expense capture, OCR, approval, payroll, employee DF, and doctor DF are absent from production code in this plan.
- [ ] Run `rg -n 'T[B]D|T[O]DO|implement la[t]er|fill in detai[l]s|appropriate error handlin[g]|similar t[o]' docs/superpowers/plans/2026-08-29-pmc-daily-monthly-finance-reports-implementation.md` and require no matches.
- [ ] Run `git diff --check` and require no whitespace errors.
