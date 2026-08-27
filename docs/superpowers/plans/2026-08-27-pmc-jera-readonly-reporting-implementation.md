# PMC JERA Production Read-only Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure cache-first, live-refresh JERA Production reports to the internal PMC LINE Mini App without introducing any JERA mutation or changing Booking/commission state.

**Architecture:** Extend the Cloud Run Mini App platform from the booking plan with an isolated JERA adapter. Obtain short-lived bearer tokens server-side, enforce an explicit GET-only endpoint registry, normalize bounded report data into Google Sheet cache tabs, and serve cache-first reports with deduplicated background refresh, manual throttle, and stale-data disclosure.

**Tech Stack:** TypeScript 6, Node fetch, Google Cloud Run, Secret Manager, Cloud Scheduler OIDC, Google Sheets via keyless service identity, React 19, Recharts 3.8, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-pmc-line-mini-app-jera-reporting-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-27-pmc-line-mini-app-booking-implementation.md` Tasks 1-5 and Task 11 for the Mini App bundle, verified LINE session, active-staff authorization, keyless Google ports, and production route isolation.

## Global Constraints

- JERA credentials are Production credentials and enter Secret Manager only through an explicit owner-authorized action.
- Version 1 is JERA read-only. Reject patient, appointment, clinic, and payment mutation methods before network dispatch.
- The only permitted non-GET JERA request is `POST /openapi/v1/token/` with Basic Auth and `grant_type=client_credentials`.
- The documented token lifetime is 36,000 seconds; refresh before expiry and once after a 401.
- Google Sheets remains the report-cache/audit store; no new database.
- Every active Mini App staff member can view all version-1 reports.
- Main report choices are `สรุปวันนี้`, `ยอดรับชำระ`, `มัดจำ`, `คืนเงิน`, `นัดหมาย`, and `รายงานเพิ่มเติม`.
- Reports return cache immediately, refresh in the background, display last-success time, and disclose stale data.
- Manual refresh is throttled to one accepted refresh per cache key per five minutes.
- Cloud Scheduler refreshes active windows at least every 15 minutes and runs a daily lookback reconciliation.
- Never interpret a provider failure or malformed response as a valid zero report.
- Use JERA UUIDs/stable codes for idempotency and integer satang for money.
- Render all JERA strings as text; never use source strings as HTML.
- No automatic `BOOKING_MASTER` closure, JERA status change, commission update, or patient matching mutation in this plan.
- No production JERA call before the read-only shadow gate and fresh owner approval.

---

## File Structure

```text
server/jera/
  config.ts                  strict Production configuration
  contracts.ts               filters, provider shapes, normalized rows
  tokenClient.ts             Basic Auth token lifecycle
  client.ts                  GET-only endpoint registry and pagination
  money.ts                   decimal string -> integer satang
  normalize.ts               endpoint-specific validation/normalization
  cacheKey.ts                canonical cache/filter keys
  store.ts                   JERA_API_CACHE / SYNC_STATE / SYNC_AUDIT
  syncCoordinator.ts         lease, throttle, lookback, single-flight
  reports.ts                 main and additional report projections
  middleware.ts              report HTTP APIs and refresh endpoint
  runtime.ts                 fail-closed dependency construction

src/apps/pmc-mini-app/
  reports.ts                 client report contracts and state model
  ReportCenter.tsx           six approved cards
  ReportFilters.tsx          shared filters
  ReportPage.tsx             common cache/live/stale shell
  reportViews.tsx            normalized cards/tables/charts

tests/jera/*.test.ts
tests/pmc-mini-app/report*.test.tsx
scripts/check-jera-readonly-runtime.mjs
docs/pmc-mini-app/jera-shadow-runbook.md
```

---

### Task 1: JERA configuration, report contracts, and read-only registry

**Files:**
- Create: `server/jera/config.ts`
- Create: `server/jera/contracts.ts`
- Create: `tests/jera/config.test.ts`
- Create: `tests/jera/contracts.test.ts`

**Interfaces:**
- Produces: `readJeraConfig(env): JeraConfig | null`.
- Produces: `JeraReportType`, `JeraReportFilters`, `JeraCacheEnvelope<T>`, normalized row contracts.
- Produces: immutable `JERA_ENDPOINTS` registry containing method, path template, pagination, and allowed filters.

- [ ] **Step 1: Write failing configuration tests**

```ts
it('requires production base URL and secret bindings only when enabled', () => {
  expect(readJeraConfig({ JERA_REPORTING_ENABLED: 'false' })).toBeNull()
  expect(readJeraConfig({ JERA_REPORTING_ENABLED: 'true' })).toBeNull()
  expect(readJeraConfig(validJeraEnvironment())).toMatchObject({
    baseUrl: 'https://jera.example', syncIntervalMinutes: 15, manualRefreshSeconds: 300,
  })
})
```

Reject non-HTTPS URL, URL with embedded credentials, unsafe intervals, unknown environment names, and blank branch UUID.

- [ ] **Step 2: Write failing registry/contract tests**

```ts
it('contains no JERA data mutation endpoint', () => {
  expect(Object.values(JERA_ENDPOINTS).every(endpoint => endpoint.method === 'GET')).toBe(true)
  expect(JSON.stringify(JERA_ENDPOINTS)).not.toMatch(/Create|Update|Delete|PATCH|PUT|DELETE/)
})
```

Define report types:

```ts
export type JeraReportType =
  | 'TODAY_SUMMARY' | 'PAYMENT' | 'DEPOSIT' | 'REFUND' | 'APPOINTMENT'
  | 'PAYMENT_LIST' | 'PRODUCT_USE' | 'PRODUCT_SALES' | 'CANCELLED_PAYMENT'
  | 'OPD' | 'CANCELLED_UNPAID' | 'COURSE_SALES' | 'REMAINING_COURSE'
  | 'REMAINING_COURSE_BY_DATE'
```

- [ ] **Step 3: Run and verify failures**

Run: `npx vitest run tests/jera/config.test.ts tests/jera/contracts.test.ts`

Expected: FAIL because JERA modules do not exist.

- [ ] **Step 4: Implement exact registry and configuration**

The registry must include only documented GET routes, for example:

```ts
export const JERA_ENDPOINTS = {
  PAYMENT: { method: 'GET', path: '/openapi/v1/report/payment/', paginated: false },
  DEPOSIT: { method: 'GET', path: '/openapi/v1/report/deposit/', paginated: false },
  REFUND: { method: 'GET', path: '/openapi/v1/report/refund/', paginated: false },
  APPOINTMENT: { method: 'GET', path: '/openapi/v1/appointment/', paginated: true },
  PAYMENT_LIST: { method: 'GET', path: '/openapi/v1/report/payment-list/', paginated: false },
} as const
```

Secret values stay opaque in `JeraConfig` and never participate in `.toString()` or logs.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/jera/config.test.ts tests/jera/contracts.test.ts
git add server/jera/config.ts server/jera/contracts.ts tests/jera/config.test.ts tests/jera/contracts.test.ts
git commit -m "feat: define JERA read-only reporting contracts"
```

---

### Task 2: Production token lifecycle with single-flight refresh

**Files:**
- Create: `server/jera/tokenClient.ts`
- Create: `tests/jera/tokenClient.test.ts`

**Interfaces:**
- Produces: `JeraTokenPort.getAccessToken(): Promise<string>`.
- Produces: `JeraTokenPort.invalidate(): void`.
- Consumes: `POST /openapi/v1/token/`, Basic Auth, `grant_type=client_credentials`.

- [ ] **Step 1: Write failing token tests**

```ts
it('caches one token before its safety-margin expiry', async () => {
  const fetch = vi.fn(async () => response(200, { access_token: 'token-1', expires_in: 36000, token_type: 'Bearer', scope: 'read write' }))
  const client = createJeraTokenClient(config(), { fetch, now: () => 1_000 })
  expect(await client.getAccessToken()).toBe('token-1')
  expect(await client.getAccessToken()).toBe('token-1')
  expect(fetch).toHaveBeenCalledOnce()
})
```

Also test concurrent callers share one request, malformed token response, non-positive expiry, provider timeout, Basic header correctness, URL-encoded grant type, secret redaction, and `invalidate()`.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/jera/tokenClient.test.ts`

Expected: FAIL because token client does not exist.

- [ ] **Step 3: Implement token cache**

Cache until:

```ts
expiresAt = nowSeconds + Math.min(expiresIn, 36_000) - 300
```

Reject tokens shorter than a sane provider token minimum, cap response body to 64 KB, and never include provider body or credentials in thrown messages. Implement a single in-flight promise cleared in `finally`.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/jera/tokenClient.test.ts
git add server/jera/tokenClient.ts tests/jera/tokenClient.test.ts
git commit -m "feat: manage JERA production tokens safely"
```

---

### Task 3: GET-only JERA client, filters, date chunking, and pagination

**Files:**
- Create: `server/jera/client.ts`
- Create: `tests/jera/client.test.ts`

**Interfaces:**
- Produces: `JeraReadPort.request<T>(reportType, filters): Promise<unknown[]>`.
- Consumes: `JERA_ENDPOINTS`, `JeraTokenPort`, injected fetch.
- Allows one 401 token refresh and bounded retry for 429/5xx outside interactive latency budget.

- [ ] **Step 1: Write failing method/path allowlist tests**

```ts
it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('rejects %s before fetch', async method => {
  const fetch = vi.fn()
  const client = createJeraReadClient(config(), tokenPort(), { fetch })
  await expect(client.rawRequest({ method, path: '/openapi/v1/appointment/' })).rejects.toThrow('JERA_READ_ONLY_VIOLATION')
  expect(fetch).not.toHaveBeenCalled()
})
```

Also reject absolute URLs, `..`, duplicate scalar filters, unsupported filters, unsafe UUIDs, date reversal, and more than 366 requested days.

- [ ] **Step 2: Write failing pagination/chunk tests**

Require upstream date chunks of at most 31 days, `row_per_page<=100`, `page<=1000`, and stop when provider count/pages are satisfied. Deduplicate by endpoint stable identity.

```ts
it('refreshes the token once after 401 and replays the GET once', async () => {
  // first GET 401, token invalidated, second token and GET 200
})
```

- [ ] **Step 3: Run and verify failures**

Run: `npx vitest run tests/jera/client.test.ts`

Expected: FAIL because JERA read client does not exist.

- [ ] **Step 4: Implement bounded transport**

Use `AbortController` with separate interactive and scheduled timeouts. Parse JSON only after a bounded content-length/body read. Map provider failures to safe codes:

```text
JERA_AUTH_FAILED
JERA_RATE_LIMITED
JERA_TIMEOUT
JERA_PROVIDER_FAILED
JERA_SCHEMA_INVALID
```

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/jera/client.test.ts
git add server/jera/client.ts tests/jera/client.test.ts
git commit -m "feat: add bounded JERA read client"
```

---

### Task 4: Money parsing and endpoint-specific normalization

**Files:**
- Create: `server/jera/money.ts`
- Create: `server/jera/normalize.ts`
- Create: `tests/jera/money.test.ts`
- Create: `tests/jera/normalize.test.ts`
- Create: `tests/jera/fixtures/*.json`

**Interfaces:**
- Produces: `parseThaiMoneyToSatang(value): number`.
- Produces: `normalizePaymentReport`, `normalizeDepositReport`, `normalizeRefundReport`, `normalizeAppointmentList`, `normalizePaymentList`, `normalizePaymentDetail`.
- Produces only bounded normalized rows from `contracts.ts`.

- [ ] **Step 1: Write failing money tests**

```ts
it.each([
  ['550.00', 55_000], ['0', 0], [400, 40_000], ['1.05', 105],
])('parses %p to satang', (raw, expected) => {
  expect(parseThaiMoneyToSatang(raw)).toBe(expected)
})
```

Reject exponent notation, NaN, negative values where the endpoint forbids them, more than two fractional digits, and unsafe integer totals.

- [ ] **Step 2: Add sanitized provider fixtures and failing normalizer tests**

Fixtures must use synthetic patient identity while preserving provider field shapes. Tests require stable UUID/code, event date, branch, type/status, totals, doctor/sales names, and source hash.

```ts
it('treats HTML-looking patient names as plain text data', () => {
  const row = normalizeRefundReport([{ patient_name: '<img src=x onerror=alert(1)> Ray', total_refund_cost: '100.00' }])[0]
  expect(row.patientName).toBe('<img src=x onerror=alert(1)> Ray')
})
```

- [ ] **Step 3: Run and verify failures**

Run: `npx vitest run tests/jera/money.test.ts tests/jera/normalize.test.ts`

Expected: FAIL because normalizers do not exist.

- [ ] **Step 4: Implement strict normalizers**

Do not spread provider objects into normalized output. Read explicit keys, cap strings, convert dates to Bangkok-safe ISO/date values, hash the canonical normalized source, and distinguish missing required fields from valid null optionals.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/jera/money.test.ts tests/jera/normalize.test.ts
git add server/jera/money.ts server/jera/normalize.ts tests/jera tests/jera/fixtures
git commit -m "feat: normalize JERA report data"
```

---

### Task 5: JERA cache, sync state, audit, and schema setup

**Files:**
- Create: `server/jera/store.ts`
- Create: `tests/jera/store.test.ts`
- Modify: `server/pmc-mini-app/setup.ts`
- Modify: `tests/pmc-mini-app/setup.test.ts`

**Interfaces:**
- Produces: `JeraReportStore.upsertRows`, `readRows`, `getSyncState`, `saveSyncState`, `appendSyncAudit`, `claimLease`, `releaseLease`.
- Consumes: keyless `MiniAppSheetsPort` from the booking plan.
- Uses only `JERA_API_CACHE`, `JERA_SYNC_STATE`, `JERA_SYNC_AUDIT`.

- [ ] **Step 1: Write failing upsert/idempotency tests**

```ts
it('upserts the same JERA UUID without duplicate rows', async () => {
  const store = jeraMemoryStore()
  await store.upsertRows('PAYMENT', [paymentRow({ sourceUuid: 'payment-1', paidAmountSatang: 10000 })])
  await store.upsertRows('PAYMENT', [paymentRow({ sourceUuid: 'payment-1', paidAmountSatang: 12000 })])
  expect(await store.readRows('PAYMENT', filters())).toMatchObject([{ sourceUuid: 'payment-1', paidAmountSatang: 12000 }])
})
```

Test source-hash no-op, endpoint-specific stable key, blank-cell clearing as `''`, audit redaction, lease expiry, and incompatible header rejection.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/jera/store.test.ts tests/pmc-mini-app/setup.test.ts`

Expected: FAIL because cache store does not exist and setup lacks JERA headers.

- [ ] **Step 3: Implement normalized cache persistence**

Use explicit columns from the spec. Never store one unbounded raw provider JSON cell. Payment detail may be returned live and optionally cached as bounded child rows only after a later explicit need.

`JERA_SYNC_AUDIT` stores report type, filter hash, counts, safe code, correlation ID, and timestamps only.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/jera/store.test.ts tests/pmc-mini-app/setup.test.ts
git add server/jera/store.ts server/pmc-mini-app/setup.ts tests/jera/store.test.ts tests/pmc-mini-app/setup.test.ts
git commit -m "feat: cache JERA reports in Google Sheets"
```

---

### Task 6: Cache keys, leases, refresh throttle, and sync coordinator

**Files:**
- Create: `server/jera/cacheKey.ts`
- Create: `server/jera/syncCoordinator.ts`
- Create: `tests/jera/cacheKey.test.ts`
- Create: `tests/jera/syncCoordinator.test.ts`

**Interfaces:**
- Produces: `jeraCacheKey(reportType, filters): string` and `filterHash(filters): string`.
- Produces: `JeraSyncCoordinator.readAndRefresh`, `manualRefresh`, `scheduledRefresh`, `dailyLookback`.
- Consumes: JERA client, normalizers, store, clock, correlation ID.

- [ ] **Step 1: Write failing canonical-key tests**

```ts
it('produces the same key regardless of input property order', () => {
  expect(jeraCacheKey('PAYMENT', { branchUuid: 'b', startDate: '2026-08-01', endDate: '2026-08-27' }))
    .toBe(jeraCacheKey('PAYMENT', { endDate: '2026-08-27', branchUuid: 'b', startDate: '2026-08-01' }))
})
```

- [ ] **Step 2: Write failing concurrency/throttle tests**

```ts
it('returns cache immediately and shares one background refresh', async () => {
  const coordinator = coordinatorFixture({ cached: [paymentRow()] })
  const [a, b] = await Promise.all([coordinator.readAndRefresh(query()), coordinator.readAndRefresh(query())])
  expect(a.source).toBe('CACHE')
  expect(b.source).toBe('CACHE')
  expect(coordinator.fetchCalls()).toBe(1)
})
```

Cover five-minute manual throttle, expired lease recovery, 15-minute schedule, daily lookback window, provider failure preserving cache, and valid empty result replacing cache only after a successful provider response.

- [ ] **Step 3: Run and verify failures**

Run: `npx vitest run tests/jera/cacheKey.test.ts tests/jera/syncCoordinator.test.ts`

Expected: FAIL because coordinator does not exist.

- [ ] **Step 4: Implement coordinator**

Return envelope:

```ts
interface JeraCacheEnvelope<T> {
  data: T
  source: 'CACHE' | 'LIVE'
  fetchedAt: string | null
  lastSuccessAt: string | null
  refreshing: boolean
  stale: boolean
  warningCode: string | null
}
```

Interactive calls never wait indefinitely for live refresh. Persist leases before provider access and release them in `finally`.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/jera/cacheKey.test.ts tests/jera/syncCoordinator.test.ts
git add server/jera/cacheKey.ts server/jera/syncCoordinator.ts tests/jera/cacheKey.test.ts tests/jera/syncCoordinator.test.ts
git commit -m "feat: coordinate JERA report refreshes"
```

---

### Task 7: Main report projections and integrity checks

**Files:**
- Create: `server/jera/reports.ts`
- Create: `tests/jera/reports.test.ts`

**Interfaces:**
- Produces `buildTodaySummary`, `buildPaymentReport`, `buildDepositReport`, `buildRefundReport`, `buildAppointmentReport`.
- Consumes normalized cache rows only; provider objects never reach UI.

- [ ] **Step 1: Write failing report-total tests**

```ts
it('reconciles payment totals by method and flags disagreement', () => {
  const report = buildPaymentReport([paymentRow({ paidAmountSatang: 55000, transferSatang: 55000 })])
  expect(report.totals).toMatchObject({ paidAmountSatang: 55000, transferSatang: 55000 })
  expect(report.warnings).toEqual([])
})
```

Cover normal versus deposit payment types, unpaid status, refund totals, appointment status counts, branch/doctor/sales breakdowns, and mismatch warnings.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/jera/reports.test.ts`

Expected: FAIL because report builders do not exist.

- [ ] **Step 3: Implement pure projections**

Use integer satang sums, stable sorting, no hidden dropped rows, and explicit `dataQuality` counts. Never infer JERA case closure or write `BOOKING_MASTER`.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/jera/reports.test.ts
git add server/jera/reports.ts tests/jera/reports.test.ts
git commit -m "feat: build JERA management reports"
```

---

### Task 8: Additional-report registry and bounded drill-down

**Files:**
- Modify: `server/jera/contracts.ts`
- Modify: `server/jera/client.ts`
- Modify: `server/jera/normalize.ts`
- Modify: `server/jera/reports.ts`
- Create: `tests/jera/additionalReports.test.ts`

**Interfaces:**
- Adds product/service sales, product use, OPD, cancelled payment, cancelled unpaid, course sales, remaining course, and remaining course by date.
- Produces `listAvailableReports(): Array<{ type; label; filters }>`.

- [ ] **Step 1: Write failing registry-completeness tests**

```ts
it('exposes every approved additional report and no JERA mutation', () => {
  expect(listAvailableReports().map(item => item.type)).toEqual([
    'PRODUCT_USE', 'PRODUCT_SALES', 'CANCELLED_PAYMENT', 'OPD',
    'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE', 'REMAINING_COURSE_BY_DATE',
  ])
})
```

- [ ] **Step 2: Add sanitized fixtures and failing normalizer tests**

Each report gets one valid, one optional-null, one malformed, and one HTML-looking string fixture. Define exact supported filters per endpoint.

- [ ] **Step 3: Run and verify failure**

Run: `npx vitest run tests/jera/additionalReports.test.ts`

Expected: FAIL until all approved report registry entries normalize safely.

- [ ] **Step 4: Implement the registry and projections**

Keep each normalizer in a focused function. Do not force unrelated endpoints into one broad `Record<string, unknown>` mapper.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/jera/additionalReports.test.ts tests/jera/normalize.test.ts tests/jera/client.test.ts
git add server/jera/contracts.ts server/jera/client.ts server/jera/normalize.ts server/jera/reports.ts tests/jera/additionalReports.test.ts tests/jera/fixtures
git commit -m "feat: add JERA additional reports"
```

---

### Task 9: Authenticated report and refresh HTTP APIs

**Files:**
- Create: `server/jera/runtime.ts`
- Create: `server/jera/middleware.ts`
- Create: `tests/jera/reportApi.test.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`

**Interfaces:**
- Routes: `GET /api/mini-app/reports/:reportType`, `POST .../refresh`, `GET /api/mini-app/integration-health`.
- Consumes the verified Mini App staff context; all active staff are allowed in version 1.
- Produces only normalized cache envelopes and safe error codes.

- [ ] **Step 1: Write failing authentication/filter tests**

```ts
it('does not call JERA before LINE staff authorization', async () => {
  const response = await invoke('/api/mini-app/reports/PAYMENT')
  expect(response.status).toBe(401)
  expect(deps.jera.request).not.toHaveBeenCalled()
})
```

Cover unknown report type, repeated query parameters, invalid date/UUID, custom-range bound, active staff access, refresh throttle 429, and response redaction.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/jera/reportApi.test.ts`

Expected: FAIL because report API does not exist.

- [ ] **Step 3: Implement APIs**

GET returns cached envelope and schedules refresh without blocking. POST refresh returns `202 { accepted, correlationId }` or `429 { error: 'REFRESH_THROTTLED', retryAfterSeconds }`. Add `Retry-After` header.

Integration health returns per-report last success/status/count only; it never returns credentials, raw provider bodies, or customer rows.

Create `createJeraRuntime` in `server/jera/runtime.ts` as the single fail-closed dependency constructor. It must refuse to construct a Production JERA client when reporting is disabled, required secret bindings are absent, the base URL is not HTTPS, or a non-allowlisted operation is requested.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/jera/reportApi.test.ts tests/pmc-mini-app/sessionApi.test.ts
git add server/jera/runtime.ts server/jera/middleware.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/runtime.ts tests/jera/reportApi.test.ts
git commit -m "feat: expose JERA reports to Mini App"
```

---

### Task 10: Mini App report center and shared filters

**Files:**
- Create: `src/apps/pmc-mini-app/reports.ts`
- Create: `src/apps/pmc-mini-app/ReportCenter.tsx`
- Create: `src/apps/pmc-mini-app/ReportFilters.tsx`
- Create: `tests/pmc-mini-app/reportCenter.test.tsx`
- Create: `tests/pmc-mini-app/reportFilters.test.tsx`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/api.ts`

**Interfaces:**
- Produces the six approved report cards and exact shared filter state.
- Consumes `/api/mini-app/reports/*` and active staff session.

- [ ] **Step 1: Write failing report-center test**

```tsx
it('shows the six approved report choices and no role hiding in version 1', () => {
  render(<ReportCenter />)
  for (const label of ['สรุปวันนี้', 'ยอดรับชำระ', 'มัดจำ', 'คืนเงิน', 'นัดหมาย', 'รายงานเพิ่มเติม']) {
    expect(screen.getByRole('button', { name: label })).toBeVisible()
  }
})
```

- [ ] **Step 2: Write failing filter tests**

Require today/yesterday/month/custom, date validation, branch, doctor, salesperson, payment status, unsupported-filter disabling, and no duplicated query parameters.

- [ ] **Step 3: Run and verify failures**

```bash
npx vitest run tests/pmc-mini-app/reportCenter.test.tsx tests/pmc-mini-app/reportFilters.test.tsx
```

Expected: FAIL because report client modules do not exist.

- [ ] **Step 4: Implement report center and filters**

Use two-column mobile cards, 48 px controls, concise Thai labels, and route state inside the Mini App shell. Persist only non-sensitive filter preferences in session memory; do not place patient/report data in localStorage.

- [ ] **Step 5: Run tests/build and commit**

```bash
npx vitest run tests/pmc-mini-app/reportCenter.test.tsx tests/pmc-mini-app/reportFilters.test.tsx
npm run build:mini-app
git add src/apps/pmc-mini-app tests/pmc-mini-app/reportCenter.test.tsx tests/pmc-mini-app/reportFilters.test.tsx
git commit -m "feat: add JERA report center to Mini App"
```

---

### Task 11: Cache-first report page, live refresh, tables, and safe rendering

**Files:**
- Create: `src/apps/pmc-mini-app/ReportPage.tsx`
- Create: `src/apps/pmc-mini-app/reportViews.tsx`
- Create: `tests/pmc-mini-app/reportPage.test.tsx`
- Create: `tests/pmc-mini-app/reportSafety.test.tsx`
- Modify: `src/apps/pmc-mini-app/styles.css`

**Interfaces:**
- Produces common loading/cache/live/stale shell and normalized report views.
- Consumes `JeraCacheEnvelope` client projection.

- [ ] **Step 1: Write failing stale-while-revalidate tests**

```tsx
it('renders cache immediately, refreshes, and discloses stale failure', async () => {
  renderReport({ cached: paymentReport(), live: Promise.reject(new Error('JERA_TIMEOUT')) })
  expect(screen.getByText('อัปเดตล่าสุดเมื่อ 10:00')).toBeVisible()
  expect(await screen.findByText('ข้อมูลอาจล่าช้า')).toBeVisible()
  expect(screen.getByText('10,000 บาท')).toBeVisible()
})
```

- [ ] **Step 2: Write failing XSS and money-display tests**

```tsx
it('renders provider HTML as inert text', () => {
  render(<RefundRows rows={[refundRow({ patientName: '<img src=x onerror=alert(1)>' })]} />)
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
  expect(document.querySelector('img[src="x"]')).toBeNull()
})
```

Verify satang formatting in THB, zero versus missing, negative refund presentation only where valid, and table overflow containment.

- [ ] **Step 3: Run and verify failures**

```bash
npx vitest run tests/pmc-mini-app/reportPage.test.tsx tests/pmc-mini-app/reportSafety.test.tsx
```

Expected: FAIL because report page does not exist.

- [ ] **Step 4: Implement report views**

Show KPI cards, compact breakdowns, accessible tables, last-success time, refresh spinner, `ข้อมูลอาจล่าช้า`, and safe retry controls. Use the existing Recharts dependency only for bounded aggregated series, never raw patient rows.

- [ ] **Step 5: Run tests/build and commit**

```bash
npx vitest run tests/pmc-mini-app/reportPage.test.tsx tests/pmc-mini-app/reportSafety.test.tsx
npm run build:mini-app
git add src/apps/pmc-mini-app/ReportPage.tsx src/apps/pmc-mini-app/reportViews.tsx src/apps/pmc-mini-app/styles.css tests/pmc-mini-app/reportPage.test.tsx tests/pmc-mini-app/reportSafety.test.tsx
git commit -m "feat: render live JERA reports safely"
```

---

### Task 12: Cloud Scheduler sync and daily lookback

**Files:**
- Modify: `server/jera/runtime.ts`
- Modify: `server/jera/middleware.ts`
- Create: `tests/jera/schedulerApi.test.ts`
- Create: `scripts/run-jera-sync.mjs`

**Interfaces:**
- Route: `POST /internal/mini-app/jera-sync` with Cloud Scheduler OIDC identity.
- Produces scheduled current-window refresh and daily lookback.
- CLI is local/synthetic or authenticated operator tool; it never accepts credentials on command line.

- [ ] **Step 1: Write failing scheduler authentication tests**

```ts
it('rejects public and staff tokens on the internal sync route', async () => {
  expect((await invokeInternal({})).status).toBe(401)
  expect((await invokeInternal({ authorization: 'Bearer line-id-token' })).status).toBe(401)
})
```

Inject an OIDC verifier port and require configured scheduler audience/service identity.

- [ ] **Step 2: Write failing schedule/lookback tests**

Require 15-minute current-day/current-month keys and one daily prior-day/prior-month-boundary lookback. Repeated scheduled invocations share cache-key leases.

- [ ] **Step 3: Run and verify failures**

Run: `npx vitest run tests/jera/schedulerApi.test.ts tests/jera/syncCoordinator.test.ts`

Expected: FAIL until internal auth and schedules exist.

- [ ] **Step 4: Implement internal route and operator CLI**

Return only `{ accepted, syncRunId }`. Never return report rows. The CLI reads an authenticated internal URL/token from environment and prints safe report-type/count/status summaries.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run tests/jera/schedulerApi.test.ts tests/jera/syncCoordinator.test.ts
git add server/jera/runtime.ts server/jera/middleware.ts tests/jera/schedulerApi.test.ts scripts/run-jera-sync.mjs
git commit -m "feat: schedule JERA report synchronization"
```

---

### Task 13: JERA Production read-only shadow runbook and acceptance gates

**Files:**
- Create: `docs/pmc-mini-app/jera-shadow-runbook.md`
- Create: `scripts/check-jera-readonly-runtime.mjs`
- Create: `tests/jera/runtimeSafety.test.ts`
- Modify: `docs/pmc-mini-app/pilot-runbook.md`

**Interfaces:**
- Produces no deployment by itself.
- Documents Secret Manager binding, no-traffic revision, one-day GET comparison, sanitized evidence, scheduler, rollback, and explicit owner gates.

- [ ] **Step 1: Write failing runtime-safety tests**

```ts
it('contains no production JERA mutation path or secret value', () => {
  const source = readJeraServerSources()
  const sentinel = 'test-jera-secret-do-not-bundle'
  const assets = buildWithEnv({ JERA_API_PASSWORD: sentinel })
  expect(source).not.toMatch(/\/openapi\/v1\/(patient|appointment|clinic)\/.+method:\s*['"](POST|PATCH|DELETE)/)
  expect(assets).not.toContain(sentinel)
})
```

Also assert runtime checker prints secret names/status only and refuses to call JERA unless `--allow-readonly-production` plus explicit one-day range are provided.

- [ ] **Step 2: Write the exact shadow runbook**

Gate sequence:

1. deploy with `JERA_REPORTING_ENABLED=false` and no traffic;
2. owner adds Production base URL, username, and password directly to Secret Manager;
3. bind secrets to Cloud Run service identity;
4. verify token endpoint without printing token;
5. GET clinic and branch metadata;
6. GET one approved one-day payment/deposit/refund/appointment window;
7. compare counts/totals against JERA UI and CSV for the same date;
8. verify no non-token POST/PATCH/DELETE request occurred;
9. enable cache writes only after comparison passes;
10. enable pilot UI only after owner approval;
11. create Cloud Scheduler only after manual sync passes;
12. rollback by disabling reporting flag and scheduler while retaining prior cache/audit.

- [ ] **Step 3: Add documented data-quality register**

Record only:

```text
commit SHA
Cloud Run revision
report type
date range
JERA count
cache count
JERA total satang
cache total satang
pass/fail
safe warning code
reviewer and timestamp
```

Do not store patient rows, credentials, bearer tokens, or raw API bodies in rollout artifacts.

- [ ] **Step 4: Run final local verification**

```bash
npx vitest run tests/jera tests/pmc-mini-app
npm run build
npx eslint server/jera server/pmc-mini-app src/apps/pmc-mini-app tests/jera tests/pmc-mini-app
node scripts/check-jera-readonly-runtime.mjs --env-file /dev/null
git diff --check
```

Expected: PASS without a Production JERA call.

- [ ] **Step 5: Commit**

```bash
git add docs/pmc-mini-app/jera-shadow-runbook.md docs/pmc-mini-app/pilot-runbook.md scripts/check-jera-readonly-runtime.mjs tests/jera/runtimeSafety.test.ts
git commit -m "docs: add JERA read-only production gates"
```

---

## JERA Reporting Plan Final Verification Gate

Before requesting any Secret Manager, Cloud Run, Scheduler, JERA, Sheet-sharing, or Mini App production action, run:

```bash
npm ci
npx vitest run tests/jera tests/pmc-mini-app tests/ocr-ledger tests/bookingLineWebhook.test.ts
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run build
npx playwright test --config=playwright.mini-app.config.ts
npx eslint server/jera server/pmc-mini-app src/apps/pmc-mini-app tests/jera tests/pmc-mini-app shared/pmcMiniAppBooking.ts apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests
node scripts/check-jera-readonly-runtime.mjs --env-file /dev/null
git diff --check
git status --short
```

The first Production JERA request is a separate owner-gated action. It is limited to token plus the approved one-day GET window and produces sanitized reconciliation evidence only.
