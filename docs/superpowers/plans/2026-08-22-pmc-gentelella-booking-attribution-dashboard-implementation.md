# PMC Gentelella Booking Attribution Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authenticated Gentelella Booking and Attribution Dashboard at `/booking-dashboard` that combines Google Booking operations, JERA actual outcomes, and read-only Meta acquisition data without becoming a dependency of booking creation.

**Architecture:** Vendor the pinned Gentelella v4 source as a separate Vanilla JS/Vite application and serve it from the existing Render Node service. Render owns OAuth, sessions, role enforcement, caching, Meta reads, and webhook verification; a separate HMAC-protected Apps Script Dashboard Bridge owns curated Sheet reads and approved attribution/config writes.

**Tech Stack:** Node.js 22, TypeScript 6, Vite 8, Vanilla ES2022, Gentelella v4.1.1, SCSS, ECharts 6, DataTables 3, Google APIs, Google Apps Script V8, Vitest 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-pmc-gentelella-booking-attribution-dashboard-design.md`

**Approved visual evidence:**

- `docs/superpowers/specs/assets/2026-08-22-pmc-gentelella-dashboard-mockup-desktop.jpg`
- `docs/superpowers/specs/assets/2026-08-22-pmc-gentelella-dashboard-mockup-mobile.jpg`

## Global Constraints

- Use upstream `ColorlibHQ/gentelella` pinned at commit `d0064ca25fc916981556e2b2439e569000f61da9`; do not keep a nested `.git` directory or use a submodule.
- Preserve the MIT license and upstream attribution in the vendored application.
- The dashboard route is `/booking-dashboard`; existing `/ads-agent`, `/page-automation`, `/api/meta/*`, LINE bridge, Google Form, Calendar, Drive, JERA import, and Cloud Run evidence paths must remain operationally independent.
- Google Sheets remains the Booking source of truth; JERA import fields remain the only authority for actual closure and actual revenue.
- The reporting timezone is `Asia/Bangkok`; the auto-attribution window is 30 calendar days.
- Browser polling is 15 seconds while visible; Booking/JERA cache TTL is 15 seconds; Meta cache TTL is 60 seconds; reconciliation runs every 15 minutes.
- Active-view Booking freshness must be no more than 30 seconds; unavailable or stale values are never converted to zero.
- Google OAuth sessions last eight hours and recheck `active` plus `accessVersion` at least every five minutes.
- Roles are exactly `OWNER` and `STAFF`; full name and full phone are returned only after successful session and allowlist validation.
- Every mutation requires `OWNER`, CSRF, expected version, non-empty reason, idempotency key, HMAC bridge verification, and an audit row.
- Never store raw Messenger or Instagram message bodies. Never log tokens, secrets, full phone, full name, signed URLs, or raw webhook bodies.
- `META_CAPI_ENABLED=false` is the only phase-1 state; no CAPI network call or queue entry may occur.
- Visible Thai copy must be product-facing. Empty states state the current condition and the next action without exposing internal implementation terminology.
- Thai body line-height is at least `1.55`; Thai text receives no letter spacing; tables keep identity/detail columns start-aligned and center only time/count/status fields.
- No implementation step in this plan authorizes credential changes, webhook subscription, live Apps Script deployment, Meta writes, or Render production deployment. Those remain separate approval gates in Task 16.
- Do not implement direct JERA API access, commission formulas/payouts, customer self-service, full message transcripts, Meta campaign/budget/status/creative writes, a replacement Booking intake, a new database source of truth, or removal of existing Ads/Page Automation UI.

---

## File Ownership Map

| Area | Responsibility | Must not do |
| --- | --- | --- |
| `apps/pmc-booking-dashboard/` | Real vendored Gentelella shell, Thai pages, polling, charts, tables, role-aware UI | Import the existing React dashboard or contain secrets |
| `apps/pmc-booking-dashboard-bridge/` | Separate Apps Script deployment for curated Sheet reads and approved META/config writes | Create/edit Booking rows, Calendar, Drive, LINE, Form, or JERA source records |
| `shared/bookingDashboardContract.ts` | Environment-neutral request/response types, schema version, validators, stable JSON | Call Node, browser, Apps Script, Google, or Meta APIs |
| `shared/thaiPhone.ts` | One canonical Thai-phone normalizer used by Booking and attribution | Read/write any external state |
| `shared/bookingDashboardAttribution.ts` | Pure exact-ID and phone/Page/30-day matching | Persist matches or guess ambiguous candidates |
| `server/bookingDashboard*.ts` | OAuth, session, role checks, bridge client, cache, read APIs, metrics, security | Expose secrets or bypass role projection |
| `server/metaAttributionWebhook.ts` | Verify raw Meta webhook and create minimal envelopes | Store/log raw message text |
| `server/productionApp.ts` | Testable route ordering and static dispatch | Contain business metric or Sheet logic |
| `apps/pmc-google-booking-ops/` | Existing canonical Booking system plus best-effort cache invalidation only | Wait for or depend on the dashboard |

---

### Task 1: Vendor the pinned Gentelella baseline and integrate the build

**Files:**
- Create: `apps/pmc-booking-dashboard/` from the pinned upstream snapshot
- Create: `apps/pmc-booking-dashboard/LICENSE.gentelella.txt`
- Create: `apps/pmc-booking-dashboard/UPSTREAM.md`
- Create: `apps/pmc-booking-dashboard/UPSTREAM.package-lock.json`
- Modify: `apps/pmc-booking-dashboard/package.json`
- Modify: `apps/pmc-booking-dashboard/vite.config.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/booking-dashboard/vendorBaseline.test.ts`

**Interfaces:**
- Consumes: upstream Git commit `d0064ca25fc916981556e2b2439e569000f61da9`
- Produces: root script `npm run dashboard:build`; static output under `dist/booking-dashboard/`

- [ ] **Step 1: Write the failing vendor-integrity test**

```ts
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = 'apps/pmc-booking-dashboard'

describe('PMC Gentelella vendor baseline', () => {
  it('pins the reviewed upstream commit and retains MIT attribution', () => {
    expect(readFileSync(`${root}/UPSTREAM.md`, 'utf8')).toContain(
      'd0064ca25fc916981556e2b2439e569000f61da9',
    )
    expect(readFileSync(`${root}/LICENSE.gentelella.txt`, 'utf8')).toContain(
      'Copyright (c) 2014–2026 Aigars Silkalns & Colorlib',
    )
    expect(existsSync(`${root}/.git`)).toBe(false)
  })

  it('keeps Gentelella as a separate Vanilla JS application', () => {
    const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
    expect(pkg.name).toBe('@pmc/booking-dashboard')
    expect(pkg.dependencies).not.toHaveProperty('react')
    expect(readFileSync(`${root}/src/main-v4.js`, 'utf8')).toContain("./scss/v4/main.scss")
  })
})
```

- [ ] **Step 2: Run the test and verify the vendor directory is absent**

Run: `npm test -- tests/booking-dashboard/vendorBaseline.test.ts`

Expected: FAIL because `apps/pmc-booking-dashboard/UPSTREAM.md` does not exist.

- [ ] **Step 3: Import the exact upstream snapshot without its Git metadata**

```bash
pmc_vendor_tmp=$(mktemp -d /tmp/pmc-gentelella-vendor.XXXXXX)
git clone --filter=blob:none https://github.com/ColorlibHQ/gentelella.git "$pmc_vendor_tmp/source"
git -C "$pmc_vendor_tmp/source" checkout d0064ca25fc916981556e2b2439e569000f61da9
mkdir -p apps/pmc-booking-dashboard
rsync -a --exclude='.git' "$pmc_vendor_tmp/source/" apps/pmc-booking-dashboard/
cp apps/pmc-booking-dashboard/LICENSE.txt apps/pmc-booking-dashboard/LICENSE.gentelella.txt
mv apps/pmc-booking-dashboard/package-lock.json apps/pmc-booking-dashboard/UPSTREAM.package-lock.json
```

- [ ] **Step 4: Record the source and adapt only the package/build identity**

Create `apps/pmc-booking-dashboard/UPSTREAM.md` with:

```md
# Gentelella Upstream

- Repository: https://github.com/ColorlibHQ/gentelella
- Pinned commit: d0064ca25fc916981556e2b2439e569000f61da9
- Imported: 2026-08-22
- License: MIT; see LICENSE.gentelella.txt
- Local deviations: PMC navigation/copy, Thai typography, route allowlist, API adapters, role projection, and output directory.
- Update procedure: import a new snapshot into a temporary directory, review LICENSE/changelog/diff, run all dashboard and existing PMC tests, then replace only after owner approval.
```

Change the nested package name to `@pmc/booking-dashboard`, set Vite `base` to `/booking-dashboard/`, and set `build.outDir` to `../../dist/booking-dashboard`. Preserve full upstream source but production-build only the seven PMC page entries defined in Task 5.

Add root scripts and workspace registration:

```json
{
  "workspaces": ["apps/pmc-booking-dashboard"],
  "scripts": {
    "build": "npm run build:client && npm run dashboard:build && npm run build:server",
    "dashboard:build": "npm run build --workspace @pmc/booking-dashboard",
    "dashboard:smoke": "npm run smoke --workspace @pmc/booking-dashboard",
    "dashboard:browser": "npm run test:visual --workspace @pmc/booking-dashboard"
  }
}
```

Regenerate the root lock without running project scripts:

Run: `npm install --package-lock-only --ignore-scripts`

- [ ] **Step 5: Verify vendor integrity and isolated build output**

Run: `npm test -- tests/booking-dashboard/vendorBaseline.test.ts`

Expected: PASS.

Run: `npm run dashboard:build`

Expected: PASS and `dist/booking-dashboard/production/index.html` exists.

Run: `test ! -e apps/pmc-booking-dashboard/.git`

Expected: exit `0`.

- [ ] **Step 6: Commit the baseline**

```bash
git add package.json package-lock.json tests/booking-dashboard/vendorBaseline.test.ts apps/pmc-booking-dashboard
git commit -m "build: vendor Gentelella booking dashboard"
```

---

### Task 2: Isolate production routing and preserve the existing Basic Auth boundary

**Files:**
- Create: `server/productionApp.ts`
- Modify: `server/productionServer.ts`
- Create: `tests/booking-dashboard/productionApp.test.ts`

**Interfaces:**
- Consumes: `BookingDashboardRouter` supplied by later tasks
- Produces: `createProductionHandler(deps): (req, res) => Promise<void>` and route order `public crypto routes → dashboard OAuth/session routes → existing Basic Auth routes`

- [ ] **Step 1: Write failing route-order tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createProductionHandler } from '../../server/productionApp'
import { invokeNodeHandler } from './testHttp'

describe('production route isolation', () => {
  it('lets the dashboard router handle its paths without existing Basic Auth', async () => {
    const dashboard = { handles: vi.fn(() => true), handle: vi.fn(async (_req, res) => res.end('dashboard')) }
    const response = await invokeNodeHandler(createProductionHandler({ dashboard, basicAuthPassword: 'legacy-secret' }), {
      method: 'GET', url: '/booking-dashboard',
    })
    expect(response.status).toBe(200)
    expect(response.body).toBe('dashboard')
  })

  it('keeps existing Ads and Page Automation routes behind Basic Auth', async () => {
    const response = await invokeNodeHandler(
      createProductionHandler({ dashboard: { handles: () => false, handle: vi.fn() }, basicAuthPassword: 'legacy-secret' }),
      { method: 'GET', url: '/ads-agent' },
    )
    expect(response.status).toBe(401)
    expect(response.headers['www-authenticate']).toContain('PMC Ads Agent')
  })
})
```

Create `tests/booking-dashboard/testHttp.ts` with a deterministic `IncomingMessage`/`ServerResponse` adapter shared by server middleware tests.

- [ ] **Step 2: Run the tests and verify `productionApp.ts` is missing**

Run: `npm test -- tests/booking-dashboard/productionApp.test.ts`

Expected: FAIL with module-not-found for `server/productionApp`.

- [ ] **Step 3: Extract a testable request handler**

```ts
export interface BookingDashboardRouter {
  handles(req: IncomingMessage): boolean
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
}

export interface ProductionAppDependencies {
  dashboard: BookingDashboardRouter
  basicAuthUser?: string
  basicAuthPassword?: string
  allowUnauthenticated?: boolean
}

export function createProductionHandler(deps: ProductionAppDependencies) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.url === '/healthz') return writeHealth(res)
    if (req.method === 'POST' && req.url === '/api/booking-line/webhook') return bookingLineWebhook(req, res)
    if (deps.dashboard.handles(req)) return deps.dashboard.handle(req, res)
    if (!isBasicAuthAllowed(req.headers.authorization, deps)) return writeLegacyUnauthorized(res)
    return handleExistingPmcRoutes(req, res)
  }
}
```

Keep static-path traversal guards and cache headers from `productionServer.ts`. Change `productionServer.ts` to construct dependencies, call `createServer(createProductionHandler(deps))`, and listen; it must no longer contain independent route logic.

- [ ] **Step 4: Verify route ordering and existing behavior**

Run: `npm test -- tests/booking-dashboard/productionApp.test.ts tests/bookingLineWebhook.test.ts tests/page-automation/pageAutomationPlugin.test.ts`

Expected: PASS.

Run: `npm run build:server`

Expected: PASS.

- [ ] **Step 5: Commit the route boundary**

```bash
git add server/productionApp.ts server/productionServer.ts tests/booking-dashboard/productionApp.test.ts tests/booking-dashboard/testHttp.ts
git commit -m "refactor: isolate booking dashboard routes"
```

---

### Task 3: Define the shared contract, role projection, and actual KPI formulas

**Files:**
- Create: `shared/bookingDashboardContract.ts`
- Create: `server/bookingDashboardMetrics.ts`
- Create: `server/bookingDashboardProjection.ts`
- Create: `server/bookingDashboardSynthetic.ts`
- Create: `tests/booking-dashboard/contract.test.ts`
- Create: `tests/booking-dashboard/metrics.test.ts`
- Create: `tests/booking-dashboard/projection.test.ts`

**Interfaces:**
- Produces: `DASHBOARD_SCHEMA_VERSION`, `DashboardRole`, `DashboardFilters`, `BridgeEnvelope<T>`, `DashboardSummary`, `projectDashboardForRole`, `computeDashboardMetrics`
- Consumes: none; every module in this task is pure and environment-neutral except the synthetic fixture factory

- [ ] **Step 1: Write failing contract and metric tests**

```ts
import { describe, expect, it } from 'vitest'
import { computeDashboardMetrics } from '../../server/bookingDashboardMetrics'

describe('actual dashboard metrics', () => {
  it('uses JERA actual revenue and distinct attributed bookings', () => {
    expect(computeDashboardMetrics({ metaSpend: 90_000, jeraActualRevenue: 360_000, attributedCaseIds: ['A', 'A', 'B'], metaBookingCaseIds: ['A', 'B', 'C'] })).toEqual({
      actualRoas: 4,
      costPerBooking: 45_000,
      attributionCoverage: 2 / 3,
      attributedBookingCount: 2,
    })
  })

  it('returns unavailable instead of zero when spend or source windows are invalid', () => {
    expect(computeDashboardMetrics({ metaSpend: 0, jeraActualRevenue: 1_000, attributedCaseIds: [], metaBookingCaseIds: [], windowsAligned: false }).actualRoas).toBeNull()
  })
})
```

Add projection assertions showing that `STAFF` receives full operational identity but no `metaSpend`, `jeraActualRevenue`, `actualRoas`, attribution diagnostics, export capability, or settings mutations.

- [ ] **Step 2: Run focused tests and verify missing modules**

Run: `npm test -- tests/booking-dashboard/contract.test.ts tests/booking-dashboard/metrics.test.ts tests/booking-dashboard/projection.test.ts`

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement explicit versioned types and validators**

```ts
export const DASHBOARD_SCHEMA_VERSION = '1' as const
export type DashboardRole = 'OWNER' | 'STAFF'
export type SourceState = 'FRESH' | 'STALE' | 'UNAVAILABLE' | 'PARTIAL'

export interface DashboardFilters {
  from: string
  to: string
  pageId?: string
  doctorId?: string
  adminId?: string
  aeId?: string
  serviceId?: string
  status?: string
}

export interface BridgeEnvelope<T> {
  schemaVersion: typeof DASHBOARD_SCHEMA_VERSION
  generatedAt: string
  sourceUpdatedAt: string
  sourceFreshness: Record<'BOOKING' | 'CALL' | 'JERA' | 'META', SourceState>
  dataQualitySummary: { warnings: string[]; attributionCoverage: number | null }
  data: T
}

export interface DashboardAppointmentRow {
  caseId: string
  customerName: string
  phone: string
  appointmentStart: string
  appointmentEnd: string
  doctorId: string
  serviceId: string
  adminId: string | null
  aeId: string | null
  status: string
}

export interface DashboardSummary {
  kpis: {
    metaSpend: number | null
    jeraActualRevenue: number | null
    actualRoas: number | null
    costPerBooking: number | null
    attributionCoverage: number | null
  }
  operations: { appointmentsToday: number; callsDue: number; callsOverdue: number; retryCount: number; reconciliationCount: number }
  bookingTrend: Array<{ date: string; bookingCount: number; jeraActualRevenue: number }>
}

export interface MetricInput {
  metaSpend: number
  jeraActualRevenue: number
  attributedCaseIds: string[]
  metaBookingCaseIds: string[]
  windowsAligned?: boolean
}

export interface DashboardMetrics {
  actualRoas: number | null
  costPerBooking: number | null
  attributionCoverage: number | null
  attributedBookingCount: number
}
```

Implement filter validation with `YYYY-MM-DD`, `from <= to`, maximum 366 days, and allowlisted dimensions/statuses. Implement stable keys at the grain `caseId`, `taskId`, `metaLeadKey`, and `attributionId`; never join by row position.

- [ ] **Step 4: Implement actual metric and role-projection functions**

```ts
export function computeDashboardMetrics(input: MetricInput): DashboardMetrics {
  const attributed = new Set(input.attributedCaseIds)
  const metaBookings = new Set(input.metaBookingCaseIds)
  const windowsAligned = input.windowsAligned !== false
  return {
    actualRoas: windowsAligned && input.metaSpend > 0 ? input.jeraActualRevenue / input.metaSpend : null,
    costPerBooking: windowsAligned && attributed.size > 0 ? input.metaSpend / attributed.size : null,
    attributionCoverage: metaBookings.size > 0 ? attributed.size / metaBookings.size : null,
    attributedBookingCount: attributed.size,
  }
}
```

`projectDashboardForRole` must copy operational fields for both roles and explicitly construct owner-only financial/attribution fields instead of deleting keys after serialization.

- [ ] **Step 5: Add deterministic synthetic fixtures matching the approved mockup**

`createSyntheticDashboard(role, now)` uses reserved names (`ทดสอบ ลูกค้า A`) and reserved phone values (`0800000001`); it never reads environment variables, Google, JERA files, or Meta.

- [ ] **Step 6: Verify all pure contracts**

Run: `npm test -- tests/booking-dashboard/contract.test.ts tests/booking-dashboard/metrics.test.ts tests/booking-dashboard/projection.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the contract and formulas**

```bash
git add shared/bookingDashboardContract.ts server/bookingDashboardMetrics.ts server/bookingDashboardProjection.ts server/bookingDashboardSynthetic.ts tests/booking-dashboard/contract.test.ts tests/booking-dashboard/metrics.test.ts tests/booking-dashboard/projection.test.ts
git commit -m "feat: define booking dashboard read model"
```

---

### Task 4: Implement Google OAuth, encrypted sessions, allowlist rechecks, access audit, and CSRF

**Files:**
- Create: `server/bookingDashboardEnv.ts`
- Create: `server/bookingDashboardSession.ts`
- Create: `server/bookingDashboardAuth.ts`
- Create: `tests/booking-dashboard/session.test.ts`
- Create: `tests/booking-dashboard/auth.test.ts`

**Interfaces:**
- Consumes: `DashboardRole`; injected `DashboardAccessPort.lookup(email)` and `DashboardAccessAuditPort.record(event)`
- Produces: `DashboardSession`, `sealSession`, `openSession`, `createDashboardAuth`, `requireDashboardSession`, `requireOwner`, `verifyCsrf`

- [ ] **Step 1: Write failing session and OAuth tests**

```ts
describe('dashboard session', () => {
  it('expires after eight hours and rejects tampering', () => {
    const session = sessionFixture({ issuedAt: 1_787_198_400, expiresAt: 1_787_227_200 })
    const token = sealSession(session, '0123456789abcdef0123456789abcdef')
    expect(openSession(token, '0123456789abcdef0123456789abcdef', 1_787_227_199)).toEqual(session)
    expect(() => openSession(`${token.slice(0, -1)}x`, '0123456789abcdef0123456789abcdef', 1_787_227_199)).toThrow('invalid dashboard session')
    expect(() => openSession(token, '0123456789abcdef0123456789abcdef', 1_787_227_201)).toThrow('expired dashboard session')
  })
})
```

OAuth tests inject a fake `OAuth2Client` and assert state-cookie equality, allowlisted redirect `/booking-dashboard`, ID-token audience validation, inactive-user denial, `accessVersion` capture, no refresh-token persistence, access-audit calls, and production session cookie flags `HttpOnly; Secure; SameSite=Lax; Path=/`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/booking-dashboard/session.test.ts tests/booking-dashboard/auth.test.ts`

Expected: FAIL with missing session/auth modules.

- [ ] **Step 3: Define strict environment parsing**

```ts
export interface BookingDashboardEnv {
  enabled: boolean
  googleClientId: string
  googleClientSecret: string
  googleRedirectUri: string
  sessionSecret: string
  bridgeUrl: string
  bridgeSecret: string
}
```

`readBookingDashboardEnv` returns `enabled=false` when `BOOKING_DASHBOARD_ENABLED` is not `true`; when enabled it rejects missing secrets with only environment variable names in the error.

- [ ] **Step 4: Encrypt and authenticate the session cookie**

Use AES-256-GCM with a SHA-256 key derived from `DASHBOARD_SESSION_SECRET`. Store only `sid`, `email`, `displayName`, `role`, `accessVersion`, `issuedAt`, `expiresAt`, `allowlistCheckedAt`, and random `csrfToken`. Use cookie name `__Host-pmc_dashboard_session`; use a separate five-minute sealed state cookie for OAuth and clear it on callback.

Production always uses the `__Host-` secure cookie. Local tests/dev may use `pmc_dashboard_session_dev`; the environment parser rejects the dev cookie name when `NODE_ENV=production`.

- [ ] **Step 5: Implement OAuth and authorization helpers**

```ts
export interface DashboardAccessPort {
  lookup(email: string): Promise<{
    email: string
    displayName: string
    role: DashboardRole
    active: boolean
    accessVersion: number
  } | null>
}

export interface DashboardAccessAuditPort {
  record(event: { userKey: string; action: 'LOGIN_ALLOWED' | 'LOGIN_DENIED' | 'LOGOUT' | 'ACCESS_REVOKED'; role: DashboardRole | null; timestamp: string; correlationId: string }): Promise<void>
}

export function verifyCsrf(session: DashboardSession, headerValue: string | undefined): void {
  if (!headerValue || !timingSafeTextEqual(headerValue, session.csrfToken)) {
    throw new DashboardHttpError(403, 'คำขอหมดอายุ กรุณาลองใหม่')
  }
}
```

On every protected request, recheck the directory when `now - allowlistCheckedAt >= 300`; reject revoked/inactive/version-changed access and refresh the sealed cookie after a successful recheck.

- [ ] **Step 6: Verify auth behavior**

Run: `npm test -- tests/booking-dashboard/session.test.ts tests/booking-dashboard/auth.test.ts`

Expected: PASS.

Run: `npm run build:server`

Expected: PASS.

- [ ] **Step 7: Commit OAuth and session primitives**

```bash
git add server/bookingDashboardEnv.ts server/bookingDashboardSession.ts server/bookingDashboardAuth.ts tests/booking-dashboard/session.test.ts tests/booking-dashboard/auth.test.ts
git commit -m "feat: add booking dashboard OAuth sessions"
```

---

### Task 5: Adapt the real Gentelella shell into the approved synthetic dashboard

**Files:**
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/page-manifest.js`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/api.js`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/polling.js`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/format.js`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/command-center.js`
- Create: `apps/pmc-booking-dashboard/src/scss/v4/_pmc-booking.scss`
- Create: `apps/pmc-booking-dashboard/production/index.html`
- Create: `apps/pmc-booking-dashboard/production/appointments.html`
- Create: `apps/pmc-booking-dashboard/production/calls.html`
- Create: `apps/pmc-booking-dashboard/production/attribution.html`
- Create: `apps/pmc-booking-dashboard/production/funnel.html`
- Create: `apps/pmc-booking-dashboard/production/reports.html`
- Create: `apps/pmc-booking-dashboard/production/settings.html`
- Modify: `apps/pmc-booking-dashboard/src/main-v4.js`
- Modify: `apps/pmc-booking-dashboard/src/v4/shell-render.js`
- Modify: `apps/pmc-booking-dashboard/src/v4/charts.js`
- Modify: `apps/pmc-booking-dashboard/src/scss/v4/main.scss`
- Modify: `apps/pmc-booking-dashboard/vite.config.js`
- Create: `apps/pmc-booking-dashboard/tests/pageManifest.test.js`
- Create: `apps/pmc-booking-dashboard/tests/visualSmoke.spec.js`
- Create: `apps/pmc-booking-dashboard/scripts/pmc-smoke.mjs`
- Modify: `apps/pmc-booking-dashboard/package.json`
- Create: `server/bookingDashboardRouter.ts`
- Create: `tests/booking-dashboard/routerSynthetic.test.ts`
- Modify: `server/productionApp.ts`

**Interfaces:**
- Consumes: `createDashboardAuth`, `createSyntheticDashboard`, approved visual evidence
- Produces: `createBookingDashboardRouter(deps)`, seven Gentelella pages, same-origin API client, visibility-aware 15-second polling

- [ ] **Step 1: Write failing page-manifest and synthetic-router tests**

```js
import { describe, expect, it } from 'vitest'
import { PMC_PAGES } from '../src/v4/pmc/page-manifest.js'

describe('PMC dashboard page manifest', () => {
  it('contains only the seven approved production pages', () => {
    expect(PMC_PAGES.map(page => page.key)).toEqual([
      'command-center', 'appointments', 'calls', 'attribution', 'funnel', 'reports', 'settings',
    ])
    expect(PMC_PAGES.filter(page => page.ownerOnly).map(page => page.key)).toEqual([
      'attribution', 'funnel', 'reports', 'settings',
    ])
  })
})
```

Router tests inject a valid owner/staff session and assert `/api/booking-dashboard/summary` returns synthetic reserved identity, owner finances are absent for Staff, `/booking-dashboard` resolves the vendored HTML, and `/ads-agent` still falls through to legacy Basic Auth.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- apps/pmc-booking-dashboard/tests/pageManifest.test.js tests/booking-dashboard/routerSynthetic.test.ts`

Expected: FAIL because the page manifest and router do not exist.

- [ ] **Step 3: Define production navigation and entry allowlist**

```js
export const PMC_PAGES = [
  { key: 'command-center', file: 'index.html', href: '/booking-dashboard', label: 'ศูนย์ควบคุมการจอง', icon: 'dashboard', ownerOnly: false },
  { key: 'appointments', file: 'appointments.html', href: '/booking-dashboard/appointments', label: 'นัดหมายวันนี้', icon: 'calendar', ownerOnly: false },
  { key: 'calls', file: 'calls.html', href: '/booking-dashboard/calls', label: 'โทรติดตาม', icon: 'chat', ownerOnly: false },
  { key: 'attribution', file: 'attribution.html', href: '/booking-dashboard/attribution', label: 'คิวตรวจ Attribution', icon: 'projects', ownerOnly: true },
  { key: 'funnel', file: 'funnel.html', href: '/booking-dashboard/funnel', label: 'Ads → Booking → JERA', icon: 'charts', ownerOnly: true },
  { key: 'reports', file: 'reports.html', href: '/booking-dashboard/reports', label: 'รายงานประจำเดือน', icon: 'receipt', ownerOnly: true },
  { key: 'settings', file: 'settings.html', href: '/booking-dashboard/settings', label: 'ตั้งค่าระบบ', icon: 'settings', ownerOnly: true },
]
```

Use this manifest for sidebar rendering, route mapping, Vite production inputs, and `scripts/pmc-smoke.mjs`. Development may retain the upstream playground; production output must not include unrelated demo HTML entries.

Set nested scripts `smoke: node scripts/pmc-smoke.mjs` and `test:visual: playwright test tests/*.spec.js`.

- [ ] **Step 4: Implement the approved Command Center using Gentelella components**

Reuse upstream `data-shell="admin"`, stat, card, table, status, ECharts, toast, command palette, sidebar rail/drawer, dark-mode, and focus behavior. Implement the approved center-alignment rules:

```scss
.pmc-page-header__content,
.pmc-kpi__content,
.pmc-chart-header__content { text-align: center; }
.pmc-page-header__content,
.pmc-chart-header__content { justify-self: center; }
.pmc-appointments th:is(:first-child, :last-child),
.pmc-appointments td:is(:first-child, :last-child) { text-align: center; }
.pmc-appointments th:not(:first-child, :last-child),
.pmc-appointments td:not(:first-child, :last-child) { text-align: start; }
[lang='th'] { letter-spacing: normal; word-break: normal; }
```

Use `Noto Sans Thai` weights 400/500/600/700, body line-height `1.62`, fixed product UI type sizes, and the upstream 4-point spacing tokens. Do not rasterize UI text.

- [ ] **Step 5: Implement role-aware API/polling behavior**

```js
export function startVisiblePolling(load, intervalMs = 15_000) {
  let timer = 0
  const schedule = () => {
    clearTimeout(timer)
    if (!document.hidden) timer = window.setTimeout(run, intervalMs)
  }
  const run = async () => { await load(); schedule() }
  document.addEventListener('visibilitychange', () => document.hidden ? clearTimeout(timer) : run())
  run()
  return () => clearTimeout(timer)
}
```

`api.js` uses `credentials: 'same-origin'`, `cache: 'no-store'`, and `AbortController`. It renders distinct `FRESH`, `STALE`, `PARTIAL`, `UNAVAILABLE`, empty, and error states. Staff navigation never renders owner-only links; server checks remain authoritative.

- [ ] **Step 6: Add synthetic router endpoints and clean route mapping**

`createBookingDashboardRouter` handles OAuth/session endpoints plus synthetic read endpoints when `BOOKING_DASHBOARD_DATA_MODE=synthetic`. Static mappings are exact:

```ts
const dashboardStaticRoutes = new Map([
  ['/booking-dashboard', 'production/index.html'],
  ['/booking-dashboard/appointments', 'production/appointments.html'],
  ['/booking-dashboard/calls', 'production/calls.html'],
  ['/booking-dashboard/attribution', 'production/attribution.html'],
  ['/booking-dashboard/funnel', 'production/funnel.html'],
  ['/booking-dashboard/reports', 'production/reports.html'],
  ['/booking-dashboard/settings', 'production/settings.html'],
])
```

All dashboard HTML requires a valid dashboard session; OAuth start/callback remain public as specified.

- [ ] **Step 7: Verify synthetic functionality and visual contract**

Run: `npm test -- apps/pmc-booking-dashboard/tests/pageManifest.test.js tests/booking-dashboard/routerSynthetic.test.ts`

Expected: PASS.

Run: `npm run dashboard:build && npm run dashboard:smoke`

Expected: PASS; only seven PMC production pages are present in the production manifest.

Run: `npm run dashboard:browser`

Expected: PASS at the three approved viewport sizes.

Run Playwright at `1440x900`, `1024x768`, and `390x844`. Assert centered page/chart axes differ by `0–1px`, no document overflow, tables remain readable, mobile drawer opens/closes, dark mode works, Staff cannot see owner-only navigation, and browser console contains no errors.

- [ ] **Step 8: Commit the authenticated synthetic dashboard**

```bash
git add apps/pmc-booking-dashboard server/bookingDashboardRouter.ts server/productionApp.ts tests/booking-dashboard/routerSynthetic.test.ts
git commit -m "feat: add authenticated Gentelella dashboard shell"
```

---

### Task 6: Scaffold the separate HMAC-protected Apps Script Dashboard Bridge

**Files:**
- Create: `apps/pmc-booking-dashboard-bridge/appsscript.json`
- Create: `apps/pmc-booking-dashboard-bridge/.clasp.json.example`
- Create: `apps/pmc-booking-dashboard-bridge/tsconfig.json`
- Create: `apps/pmc-booking-dashboard-bridge/scripts/build.mjs`
- Create: `apps/pmc-booking-dashboard-bridge/src/auth.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/entrypoints.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/runtime.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/auth.test.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/build.test.ts`
- Modify: `shared/bookingDashboardContract.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: environment-neutral bridge contract and `PropertiesService`
- Produces: Apps Script top-level `doPost`, `setupPmcDashboardBridge`, `runPmcDashboardReconciliation`; signed request/response envelope

- [ ] **Step 1: Write failing HMAC, timestamp, nonce, and bundle tests**

```ts
describe('dashboard bridge authentication', () => {
  it('rejects signature and replay before dispatch', () => {
    const deps = bridgeAuthFixture({ nowEpochSeconds: 1_787_198_400 })
    const request = signBridgeRequest({ action: 'ACCESS_LOOKUP', timestamp: 1_787_198_400, nonce: 'nonce-1', payload: { email: 'owner@example.com' } }, 'bridge-secret')
    expect(verifyBridgeRequest(request, deps)).toMatchObject({ action: 'ACCESS_LOOKUP' })
    expect(() => verifyBridgeRequest(request, deps)).toThrow('bridge request replayed')
    expect(() => verifyBridgeRequest({ ...request, signature: 'bad' }, deps)).toThrow('invalid bridge signature')
  })
})
```

Bundle test runs `npm run dashboard-bridge:build`, evaluates `dist/Code.js`, and requires the three top-level functions. Manifest test requires `ANYONE_ANONYMOUS`, `USER_DEPLOYING`, Spreadsheet scope, and ScriptApp scope only.

- [ ] **Step 2: Run tests and verify the package is absent**

Run: `npm test -- apps/pmc-booking-dashboard-bridge/tests/auth.test.ts apps/pmc-booking-dashboard-bridge/tests/build.test.ts`

Expected: FAIL with missing bridge modules.

- [ ] **Step 3: Extend the shared signed-envelope contract**

```ts
export type DashboardBridgeAction =
  | 'ACCESS_LOOKUP' | 'ACCESS_AUDIT_APPEND' | 'SUMMARY_READ' | 'APPOINTMENTS_READ' | 'CALLS_READ'
  | 'ATTRIBUTION_QUEUE_READ' | 'FUNNEL_READ' | 'MONTHLY_REPORT_READ'
  | 'INTEGRATION_HEALTH_READ' | 'SETTINGS_READ' | 'META_ENVELOPES_INGEST'
  | 'ATTRIBUTION_MATCH' | 'ATTRIBUTION_UNMATCH' | 'ATTRIBUTION_LOCK'
  | 'DASHBOARD_USER_UPSERT' | 'META_PAGE_UPSERT'

export interface SignedBridgeRequest<T = unknown> {
  schemaVersion: '1'
  action: DashboardBridgeAction
  timestamp: number
  nonce: string
  idempotencyKey?: string
  actorEmail?: string
  payload: T
  signature: string
}
```

Canonical signing input is stable JSON of all fields except `signature`. Response contains the request nonce, timestamp, `ok`, `data` or safe error, and its own signature; Render verifies every response before use.

- [ ] **Step 4: Implement Apps Script verification and signed response**

Use `Utilities.computeHmacSha256Signature`, constant-time byte comparison, `LockService`, and a five-minute timestamp window. Record nonces through an injected repository; verify signature and replay before action dispatch or JSON field access beyond the envelope.

Inside the nonce lock, prune rows older than ten minutes before checking/appending and cap the tab at 5,000 current rows. Replay or nonce-store failure fails closed.

Script Properties are exactly:

```text
PMC_DASHBOARD_SPREADSHEET_ID
PMC_DASHBOARD_BRIDGE_SECRET
PMC_DASHBOARD_SHADOW_ATTRIBUTION
```

No secret is stored in a Sheet cell.

- [ ] **Step 5: Add build/typecheck scripts**

```json
{
  "scripts": {
    "dashboard-bridge:test": "vitest run apps/pmc-booking-dashboard-bridge/tests",
    "dashboard-bridge:typecheck": "tsc -p apps/pmc-booking-dashboard-bridge/tsconfig.json --noEmit",
    "dashboard-bridge:build": "node apps/pmc-booking-dashboard-bridge/scripts/build.mjs"
  }
}
```

The bundle global name is `PmcDashboardBridge`; the build footer exports only the three approved top-level functions.

- [ ] **Step 6: Verify package security and bundle shape**

Run: `npm run dashboard-bridge:test && npm run dashboard-bridge:typecheck && npm run dashboard-bridge:build`

Expected: PASS; built bundle contains no secret values or unrelated Booking trigger names.

- [ ] **Step 7: Commit the bridge scaffold**

```bash
git add shared/bookingDashboardContract.ts package.json package-lock.json apps/pmc-booking-dashboard-bridge
git commit -m "feat: scaffold dashboard Apps Script bridge"
```

---

### Task 7: Add Sheet topology, curated snapshots, access lookup, and batch read models

**Files:**
- Create: `apps/pmc-booking-dashboard-bridge/src/sheetSchema.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/sheetStore.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/readModels.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/accessDirectory.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/setup.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/sheetSchema.test.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/readModels.test.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/accessDirectory.test.ts`
- Modify: `apps/pmc-booking-dashboard-bridge/src/runtime.ts`
- Modify: `apps/pmc-booking-dashboard-bridge/src/entrypoints.ts`

**Interfaces:**
- Produces: `BRIDGE_SHEET_SCHEMAS`, `createDashboardReadModels(store, clock)`, `lookupDashboardUser(email)`, `ensureDashboardTopology()`
- Consumes: existing `BOOKING_MASTER`, `CALL_QUEUE`, `CONFIG_STAFF`, `CONFIG_DOCTORS`, `CONFIG_SERVICES`, `CONFIG_CHANNELS`, `RETRY_QUEUE`, `RECONCILIATION`; creates only dashboard-owned tabs

- [ ] **Step 1: Write failing topology and allowlist tests**

```ts
expect(BRIDGE_SHEET_SCHEMAS).toMatchObject({
  CONFIG_DASHBOARD_USERS: ['email', 'displayName', 'role', 'active', 'accessVersion', 'updatedAt', 'updatedBy'],
  CONFIG_META_PAGES: ['channelId', 'pageId', 'pageName', 'active', 'version', 'updatedAt', 'updatedBy'],
  META_LEAD_INDEX: ['metaLeadKey', 'sourceType', 'pageId', 'leadgenId', 'conversationId', 'pageScopedUserId', 'campaignId', 'adSetId', 'adId', 'phoneNormalized', 'capturedAt', 'lastInteractionAt', 'matchStatus', 'matchedCaseId', 'version'],
  META_ATTRIBUTION: ['attributionId', 'caseId', 'metaLeadKey', 'pageId', 'campaignId', 'adSetId', 'adId', 'matchMethod', 'confidence', 'windowDays', 'matchedAt', 'matchedBy', 'lockedAt', 'lockedBy', 'version'],
  META_ATTRIBUTION_AUDIT: ['eventId', 'attributionId', 'caseId', 'actorEmail', 'action', 'before', 'after', 'reason', 'timestamp', 'correlationId'],
  DASHBOARD_AUDIT: ['eventId', 'userKey', 'action', 'target', 'before', 'after', 'reason', 'timestamp', 'correlationId'],
  META_WEBHOOK_EVENTS: ['eventId', 'metaLeadKey', 'capturedAt'],
  DASHBOARD_BRIDGE_NONCES: ['nonce', 'capturedAt'],
  DASHBOARD_SYNC_STATE: ['key', 'value', 'updatedAt'],
})
```

Read-model tests seed extra columns containing `privateInternalNote` and assert no response includes it. Access tests reject duplicates, inactive rows, unknown roles, and invalid `accessVersion`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run dashboard-bridge:test`

Expected: FAIL because schema/read-model modules are missing.

- [ ] **Step 3: Implement exact dashboard-owned schemas and guarded setup**

`ensureDashboardTopology` creates missing dashboard-owned tabs, freezes row 1, writes headers only to empty tabs, and fails closed on mismatched populated headers. It never alters headers or content of existing canonical Booking tabs.

The reconciliation time trigger is created idempotently at 15-minute cadence for `runPmcDashboardReconciliation`; setup does not create Booking, Form, Calendar, Drive, LINE, or JERA triggers.

- [ ] **Step 4: Implement batch reads and curated output**

Each action performs one batch read per source group using `getDataRange().getValues()` only through the last non-empty row/column. Build indexes by stable IDs, apply validated filters, and return `BridgeEnvelope<T>` with `generatedAt`, `sourceUpdatedAt`, freshness, schema version, and data-quality warnings.

Required limits:

```ts
export const READ_LIMITS = {
  appointments: 200,
  calls: 200,
  attributionQueue: 100,
  breakdownRows: 500,
  reportMonths: 1,
} as const
```

Appointments and calls may include full customer identity because only the authenticated Render API can call the HMAC bridge. Audit/config endpoints never duplicate customer identity.

- [ ] **Step 5: Implement access lookup and role validation**

Normalize email with trim/lowercase. Exactly one active row with role `OWNER` or `STAFF` is required. Return `null` for missing/inactive; throw a safe configuration error for duplicates or invalid roles so access fails closed. `ACCESS_AUDIT_APPEND` stores a SHA-256 `userKey`, action, role/target, safe reason, timestamp, and correlation ID in `DASHBOARD_AUDIT`; it never duplicates the email or customer identity.

- [ ] **Step 6: Verify snapshot contracts**

Run: `npm run dashboard-bridge:test && npm run dashboard-bridge:typecheck && npm run dashboard-bridge:build`

Expected: PASS.

- [ ] **Step 7: Commit Sheet read models**

```bash
git add apps/pmc-booking-dashboard-bridge/src apps/pmc-booking-dashboard-bridge/tests
git commit -m "feat: add curated dashboard Sheet read models"
```

---

### Task 8: Connect Render to the bridge with signed responses, bounded cache, and read APIs

**Files:**
- Create: `server/bookingDashboardBridge.ts`
- Create: `server/bookingDashboardCache.ts`
- Create: `server/bookingDashboardService.ts`
- Create: `tests/booking-dashboard/bridge.test.ts`
- Create: `tests/booking-dashboard/cache.test.ts`
- Create: `tests/booking-dashboard/readApi.test.ts`
- Modify: `server/bookingDashboardRouter.ts`
- Modify: `server/bookingDashboardEnv.ts`
- Modify: `server/bookingDashboardAuth.ts`

**Interfaces:**
- Consumes: signed bridge actions and role projection
- Produces: `DashboardBridgePort`, `createDashboardCache`, `createBookingDashboardService`, eight protected read endpoints

- [ ] **Step 1: Write failing bridge and cache tests**

```ts
it('verifies the signed response before caching PII', async () => {
  const fetchImpl = vi.fn(async () => responseWithBadSignature({ data: appointmentFixture() }))
  const bridge = createDashboardBridge({ url: 'https://bridge.test/exec', secret: 'bridge-secret', fetchImpl })
  await expect(bridge.call('APPOINTMENTS_READ', {})).rejects.toThrow('invalid bridge response signature')
  expect(cache.size()).toBe(0)
})

it('expires Booking cache after 15 seconds and Meta cache after 60 seconds', () => {
  const cache = createDashboardCache({ now: fakeNow })
  cache.set('booking:key', value, 15_000)
  cache.set('meta:key', value, 60_000)
  advance(15_001)
  expect(cache.get('booking:key')).toBeNull()
  expect(cache.get('meta:key')).toEqual(value)
})
```

Read API tests assert authentication, filter bounds, role projection, `Cache-Control: no-store`, safe error envelope, and stale-source preservation.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/booking-dashboard/bridge.test.ts tests/booking-dashboard/cache.test.ts tests/booking-dashboard/readApi.test.ts`

Expected: FAIL with missing bridge/cache/service modules.

- [ ] **Step 3: Implement the bridge client**

`DashboardBridgePort.call(action, payload, context)` signs stable JSON with a unique nonce and current epoch seconds, sends `application/json` with a 5-second abort timeout, verifies response nonce/schema/signature, and maps provider detail to `DashboardHttpError(503, 'ข้อมูล Google ยังไม่พร้อม กรุณาลองใหม่')` without logging request bodies.

Implement `DashboardAccessPort.lookup` with `ACCESS_LOOKUP` and `DashboardAccessAuditPort.record` with `ACCESS_AUDIT_APPEND`. Audit delivery failure denies login before a session cookie is issued; logout audit is best-effort after the cookie is cleared.

- [ ] **Step 4: Implement cache and stale fallback**

Cache entries contain `{schemaVersion, sourceUpdatedAt, storedAt, value}` and live only in Render memory. Keys include endpoint, role, and canonical validated filters. On bridge failure, return the last verified entry only if it belongs to the active authenticated role/session scope and mark the source `STALE`; never share cache entries across role projections.

- [ ] **Step 5: Implement protected read endpoints**

```text
GET /api/booking-dashboard/summary
GET /api/booking-dashboard/appointments
GET /api/booking-dashboard/calls
GET /api/booking-dashboard/attribution-queue
GET /api/booking-dashboard/funnel
GET /api/booking-dashboard/monthly-report
GET /api/booking-dashboard/integration-health
GET /api/booking-dashboard/settings
```

Staff requests to owner-only endpoints return `403` with product-facing JSON. All PII API responses set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and no wildcard CORS header.

- [ ] **Step 6: Verify live-mode boundary with a fake bridge**

Run: `npm test -- tests/booking-dashboard/bridge.test.ts tests/booking-dashboard/cache.test.ts tests/booking-dashboard/readApi.test.ts`

Expected: PASS.

Run: `npm run build:server`

Expected: PASS.

- [ ] **Step 7: Commit the bridge-backed read path**

```bash
git add server/bookingDashboardBridge.ts server/bookingDashboardCache.ts server/bookingDashboardService.ts server/bookingDashboardRouter.ts server/bookingDashboardEnv.ts server/bookingDashboardAuth.ts tests/booking-dashboard/bridge.test.ts tests/booking-dashboard/cache.test.ts tests/booking-dashboard/readApi.test.ts
git commit -m "feat: connect dashboard to signed Sheet bridge"
```

---

### Task 9: Reuse the existing Meta workspace for read-only spend, hierarchy, Page, currency, and timezone

**Files:**
- Create: `server/bookingDashboardMeta.ts`
- Create: `tests/booking-dashboard/metaRead.test.ts`
- Modify: `server/metaApiPlugin.ts`
- Modify: `server/bookingDashboardService.ts`

**Interfaces:**
- Consumes: existing Meta workspace/config normalization and Page Automation Page reader
- Produces: `readMetaDashboardSnapshot(env, scope)`, `BookingMetaSnapshot`; Meta TTL 60 seconds

- [ ] **Step 1: Write failing Meta-source separation tests**

```ts
it('uses Meta spend but never Meta-reported revenue as actual revenue', async () => {
  const source = metaWorkspaceFixture({ spend: 10_000, metaReportedRevenue: 999_999 })
  const booking = bookingSnapshotFixture({ jeraActualRevenue: 40_000 })
  const result = await mergeDashboardSources({ meta: source, booking })
  expect(result.kpis.metaSpend).toBe(10_000)
  expect(result.kpis.jeraActualRevenue).toBe(40_000)
  expect(result.kpis.actualRoas).toBe(4)
  expect(JSON.stringify(result.kpis)).not.toContain('999999')
})

it('marks money unavailable when Ad Account currency or timezone is missing', async () => {
  const result = await readMetaDashboardSnapshot(envFixture(), range('2026-08-01', '2026-08-31'), depsWithoutCurrency())
  expect(result.financialState).toBe('UNAVAILABLE')
  expect(result.warnings).toContain('ตรวจสอบสกุลเงินและเขตเวลาของ Ads Account')
})
```

Add regression assertions for `readMetaWorkspaceForPageAutomation` and existing `/api/meta/workspace` behavior.

- [ ] **Step 2: Run focused Meta tests and verify failure**

Run: `npm test -- tests/booking-dashboard/metaRead.test.ts tests/page-automation/pageAutomationMetaApi.test.ts`

Expected: FAIL because `bookingDashboardMeta.ts` does not exist; existing Page Automation tests remain green.

- [ ] **Step 3: Export a narrow read-only dashboard facade from the existing Meta implementation**

```ts
export type MetaInsightScope =
  | { kind: 'preset'; datePreset: 'last_7d' | 'last_30d' }
  | { kind: 'range'; since: string; until: string }

export async function readMetaDashboardWorkspace(env: MetaApiPluginEnv, scope: MetaInsightScope) {
  const config = await readMetaConfig(env)
  if (!config) return null
  return fetchMetaWorkspace(config, scope)
}
```

Refactor `fetchMetaWorkspace` so existing date-preset callers retain identical output, while range callers send an allowlisted `time_range` and build matching inline Insights fields. Do not export the access token or raw `MetaConfig`.

- [ ] **Step 4: Build a dashboard-safe Meta snapshot**

Return only account identity/status/currency/timezone, spend/impressions/reach/clicks/leads, Campaign/Ad Set/Ad IDs/names/spend, Page IDs/names/permissions, and timestamps. Label Meta conversions as `metaReportedConversions`; never map them to Booking or JERA values.

```ts
export interface BookingMetaSnapshot {
  account: { id: string; name: string; status: number; currency: string; timezone: string }
  totals: { spend: number; impressions: number; reach: number; clicks: number; leads: number; metaReportedConversions: number }
  campaigns: Array<{ id: string; name: string; spend: number }>
  adSets: Array<{ id: string; campaignId: string; name: string; spend: number }>
  ads: Array<{ id: string; adSetId: string; campaignId: string; name: string; spend: number }>
  pages: Array<{ id: string; name: string; missingPermissions: string[] }>
  fetchedAt: string
  financialState: 'READY' | 'UNAVAILABLE'
  warnings: string[]
}
```

Use `fetchPageAutomationPages` for multiple Page identity/permission verification and `readMetaDashboardWorkspace` for Ad Account/Insights. Cache this snapshot for 60 seconds.

- [ ] **Step 5: Verify source authority and regressions**

Run: `npm test -- tests/booking-dashboard/metaRead.test.ts tests/page-automation/pageAutomationMetaApi.test.ts tests/page-automation/pageAutomationPlugin.test.ts`

Expected: PASS.

Run: `npm run build:server`

Expected: PASS.

- [ ] **Step 6: Commit the Meta read facade**

```bash
git add server/bookingDashboardMeta.ts server/bookingDashboardService.ts server/metaApiPlugin.ts tests/booking-dashboard/metaRead.test.ts
git commit -m "feat: add read-only Meta dashboard source"
```

---

### Task 10: Verify Meta webhooks and ingest minimal Lead Ads/Messenger/Instagram envelopes in shadow mode

**Files:**
- Create: `server/metaAttributionWebhook.ts`
- Create: `server/metaAttributionEnvelope.ts`
- Create: `tests/booking-dashboard/metaWebhook.test.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/metaLeadRepository.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/metaLeadRepository.test.ts`
- Modify: `shared/bookingDashboardContract.ts`
- Modify: `server/bookingDashboardRouter.ts`
- Modify: `server/productionApp.ts`
- Modify: `apps/pmc-booking-dashboard-bridge/src/runtime.ts`

**Interfaces:**
- Consumes: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, Page tokens already held by the Meta workspace, bridge action `META_ENVELOPES_INGEST`
- Produces: public GET/POST `/api/meta-attribution/webhook`; `MetaAttributionEnvelope`; idempotent `META_LEAD_INDEX` upsert

- [ ] **Step 1: Write failing signature-before-parse and sanitization tests**

```ts
it('rejects an invalid signature before parsing or bridge forwarding', async () => {
  const parse = vi.fn()
  const bridge = { call: vi.fn() }
  const handler = createMetaAttributionWebhook({ appSecret: 'app-secret', verifyToken: 'verify', parse, bridge })
  const result = await handler.delivery(Buffer.from('{invalid json'), 'sha256=bad')
  expect(result.status).toBe(401)
  expect(parse).not.toHaveBeenCalled()
  expect(bridge.call).not.toHaveBeenCalled()
})

it('discards Messenger text after extracting a deterministic Thai phone', async () => {
  const envelope = sanitizeMessagingEvent(metaMessageFixture({ text: 'สนใจค่ะ โทร 0800000007' }))
  expect(envelope.phoneNormalized).toBe('0800000007')
  expect(JSON.stringify(envelope)).not.toContain('สนใจค่ะ')
  expect(envelope).not.toHaveProperty('message')
})
```

Add tests for challenge token, 1 MB body bound, unknown object/field rejection, Lead Ads `leadgen_id`, Messenger referral IDs, Instagram sender/page IDs, safe retry status, and no token/raw-body logging.

- [ ] **Step 2: Run tests and verify missing modules**

Run: `npm test -- tests/booking-dashboard/metaWebhook.test.ts apps/pmc-booking-dashboard-bridge/tests/metaLeadRepository.test.ts`

Expected: FAIL with missing webhook/repository modules.

- [ ] **Step 3: Define the minimal envelope**

```ts
export interface MetaAttributionEnvelope {
  metaLeadKey: string
  sourceType: 'LEAD_ADS' | 'MESSENGER' | 'INSTAGRAM_DM'
  eventId: string
  pageId: string
  leadgenId: string | null
  conversationId: string | null
  pageScopedUserId: string | null
  campaignId: string | null
  adSetId: string | null
  adId: string | null
  referralId: string | null
  phoneNormalized: string | null
  capturedAt: string
  lastInteractionAt: string
}
```

`metaLeadKey` is deterministic from source plus stable Meta identifier. `eventId` is `leadgen_id` for Lead Ads, `message.mid` when supplied, or SHA-256 of Page ID + page-scoped user ID + event timestamp + referral ID for retry-stable referral/postback events. Lead Ads details may be fetched read-only to obtain the phone, but the fetched name/custom answers are discarded unless a future approved contract adds them.

- [ ] **Step 4: Implement public webhook verification**

GET validates `hub.verify_token` with timing-safe comparison and returns only `hub.challenge`. POST buffers at most 1 MB, verifies `X-Hub-Signature-256` over raw bytes, parses after verification, sanitizes, then calls the bridge synchronously with an idempotency key. A bridge timeout returns `503` so Meta can retry; successful duplicate ingestion returns `200`.

Production route order keeps this webhook public only for verification/signed delivery; it never bypasses Basic Auth for another path.

- [ ] **Step 5: Implement idempotent lead-index upsert**

The bridge acquires `ScriptLock`, checks `META_WEBHOOK_EVENTS.eventId`, batch-reads `META_LEAD_INDEX`, inserts a new row at version `1`, or updates only `lastInteractionAt` and newly available IDs/phone for the same `metaLeadKey`. It appends the safe event ID and lead key in the same locked write. It never overwrites a non-empty stable ID with blank data and never changes `LOCKED` or consumed match state during ingestion. Reconciliation prunes webhook-event dedupe rows older than 90 days.

- [ ] **Step 6: Verify shadow ingestion**

Run: `npm test -- tests/booking-dashboard/metaWebhook.test.ts apps/pmc-booking-dashboard-bridge/tests/metaLeadRepository.test.ts tests/booking-dashboard/productionApp.test.ts`

Expected: PASS.

Run: `npm run dashboard-bridge:typecheck && npm run build:server`

Expected: PASS.

- [ ] **Step 7: Commit the webhook shadow path**

```bash
git add shared/bookingDashboardContract.ts server/metaAttributionWebhook.ts server/metaAttributionEnvelope.ts server/bookingDashboardRouter.ts server/productionApp.ts tests/booking-dashboard/metaWebhook.test.ts apps/pmc-booking-dashboard-bridge/src/metaLeadRepository.ts apps/pmc-booking-dashboard-bridge/src/runtime.ts apps/pmc-booking-dashboard-bridge/tests/metaLeadRepository.test.ts
git commit -m "feat: ingest minimal Meta attribution envelopes"
```

---

### Task 11: Implement deterministic exact-ID and phone/Page/30-day attribution plus reconciliation

**Files:**
- Create: `shared/thaiPhone.ts`
- Create: `shared/bookingDashboardAttribution.ts`
- Create: `tests/booking-dashboard/attribution.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/normalize.ts`
- Modify: `apps/pmc-google-booking-ops/tests/domain.test.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/reconciliation.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/reconciliation.test.ts`
- Modify: `apps/pmc-booking-dashboard-bridge/src/entrypoints.ts`
- Modify: `apps/pmc-booking-dashboard-bridge/src/runtime.ts`

**Interfaces:**
- Produces: `normalizeThaiPhone`, `matchBookingAttribution(input)`, `runDashboardReconciliation()`
- Consumes: Booking snapshot, `CONFIG_META_PAGES`, unconsumed `META_LEAD_INDEX`, existing/locked `META_ATTRIBUTION`, source watermarks

- [ ] **Step 1: Write complete failing boundary tests**

```ts
describe('booking attribution matcher', () => {
  it('matches one normalized phone on the same Page at exactly 30 days', () => {
    expect(matchBookingAttribution(matchFixture({ bookingAt: '2026-08-31T10:00:00+07:00', leadAt: '2026-08-01T10:00:00+07:00' }))).toMatchObject({ kind: 'MATCH', method: 'PHONE_PAGE_30D', confidence: 'HIGH' })
  })

  it('queues ambiguity and never selects the nearest candidate', () => {
    const result = matchBookingAttribution(matchFixture({ candidateCount: 2 }))
    expect(result).toMatchObject({ kind: 'AMBIGUOUS' })
    expect(result).not.toHaveProperty('selectedMetaLeadKey')
  })

  it.each(['name-only', 'cross-page', 'consumed', 'outside-window', 'locked-conflict'])(
    'does not auto-match %s', scenario => expect(matchBookingAttribution(scenarioFixture(scenario)).kind).not.toBe('MATCH'),
  )
})
```

Also test exact `leadgenId`, exact referral ID, nine-digit legacy phone normalization, Thai `0XXXXXXXXX`, invalid phones, timezone boundary, and stable output ordering.

- [ ] **Step 2: Run matcher tests and verify failure**

Run: `npm test -- tests/booking-dashboard/attribution.test.ts apps/pmc-google-booking-ops/tests/domain.test.ts`

Expected: FAIL because shared matcher/normalizer are absent.

- [ ] **Step 3: Extract the canonical phone normalizer without changing Booking behavior**

Move only `normalizeThaiPhone` to `shared/thaiPhone.ts`; keep `maskThaiPhone` and name normalization in the Booking domain. Re-export/import the shared function from `apps/pmc-google-booking-ops/src/domain/normalize.ts` so every existing caller keeps its current import path.

- [ ] **Step 4: Implement the pure matcher**

```ts
export type AttributionDecision =
  | { kind: 'MATCH'; metaLeadKey: string; method: 'EXACT_LEAD_ID' | 'EXACT_REFERRAL_ID' | 'PHONE_PAGE_30D'; confidence: 'HIGH'; windowDays: number }
  | { kind: 'AMBIGUOUS'; candidateMetaLeadKeys: string[]; reason: 'MULTIPLE_VALID_CANDIDATES' }
  | { kind: 'NO_MATCH'; reason: 'NO_PAGE_MAPPING' | 'NO_VALID_CANDIDATE' | 'OUTSIDE_WINDOW' | 'LOCKED' }
```

Exact IDs run first. Phone matching requires one Page mapping, exact normalized phone, unconsumed candidate, candidate timestamp not after Booking, and `0 <= calendarDays <= 30`. Sort candidate IDs only for deterministic queue evidence; never use sorting to choose a winner.

- [ ] **Step 5: Implement watermark-driven 15-minute reconciliation**

`runDashboardReconciliation` exits when Booking, Page-map, lead-index, and attribution watermarks are unchanged. Otherwise it batch-reads all four groups, evaluates eligible Meta-channel Bookings, and in shadow mode writes candidate status/quality evidence without presenting matches as authoritative. In reviewed live mode it creates one active attribution per Case ID and marks the lead consumed in the same locked batch.

- [ ] **Step 6: Verify matching, existing Booking regression, and reconciliation idempotency**

Run: `npm test -- tests/booking-dashboard/attribution.test.ts apps/pmc-google-booking-ops/tests/domain.test.ts apps/pmc-booking-dashboard-bridge/tests/reconciliation.test.ts`

Expected: PASS.

Run: `npm run booking:test && npm run booking:typecheck && npm run dashboard-bridge:typecheck`

Expected: PASS.

- [ ] **Step 7: Commit deterministic attribution**

```bash
git add shared/thaiPhone.ts shared/bookingDashboardAttribution.ts tests/booking-dashboard/attribution.test.ts apps/pmc-google-booking-ops/src/domain/normalize.ts apps/pmc-google-booking-ops/tests/domain.test.ts apps/pmc-booking-dashboard-bridge/src/reconciliation.ts apps/pmc-booking-dashboard-bridge/src/entrypoints.ts apps/pmc-booking-dashboard-bridge/src/runtime.ts apps/pmc-booking-dashboard-bridge/tests/reconciliation.test.ts
git commit -m "feat: add deterministic Meta attribution matching"
```

---

### Task 12: Add OWNER attribution/config mutations with optimistic versioning and audit

**Files:**
- Create: `apps/pmc-booking-dashboard-bridge/src/attributionMutations.ts`
- Create: `apps/pmc-booking-dashboard-bridge/src/settingsMutations.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/attributionMutations.test.ts`
- Create: `apps/pmc-booking-dashboard-bridge/tests/settingsMutations.test.ts`
- Create: `server/bookingDashboardMutations.ts`
- Create: `tests/booking-dashboard/mutations.test.ts`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/attribution.js`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/settings.js`
- Modify: `server/bookingDashboardRouter.ts`
- Modify: `apps/pmc-booking-dashboard/production/attribution.html`
- Modify: `apps/pmc-booking-dashboard/production/settings.html`

**Interfaces:**
- Consumes: owner session, CSRF token, bridge mutation actions
- Produces: attribution match/unmatch/lock plus guarded user/Page upserts and audit rows

- [ ] **Step 1: Write failing mutation-guard tests**

```ts
it('requires owner, CSRF, reason, version, and idempotency key', async () => {
  for (const invalid of mutationInvalidCases()) {
    const response = await invokeMutation(invalid)
    expect(response.status).toBe(invalid.expectedStatus)
    expect(bridge.call).not.toHaveBeenCalled()
  }
})

it('returns the first audited result for an idempotent replay', () => {
  const first = repository.match(matchInput({ idempotencyKey: 'intent-1' }))
  const replay = repository.match(matchInput({ idempotencyKey: 'intent-1' }))
  expect(replay).toEqual(first)
  expect(store.read('META_ATTRIBUTION_AUDIT')).toHaveLength(1)
})
```

Add tests for version conflict, second active attribution, consumed lead, locked row rejection, audit PII exclusion, invalid role, duplicate users, last active Owner deactivation, and channel/Page uniqueness.

- [ ] **Step 2: Run mutation tests and verify failure**

Run: `npm test -- tests/booking-dashboard/mutations.test.ts apps/pmc-booking-dashboard-bridge/tests/attributionMutations.test.ts apps/pmc-booking-dashboard-bridge/tests/settingsMutations.test.ts`

Expected: FAIL with missing mutation modules.

- [ ] **Step 3: Implement bridge transactions**

Inside one `ScriptLock`, validate expected versions and invariants, check `META_ATTRIBUTION_AUDIT.correlationId` for attribution idempotency and `DASHBOARD_AUDIT.correlationId` for settings idempotency, update entire rows in one batch, and append one audit row containing IDs/statuses only.

For dashboard-user changes, audit `target=userKey` and before/after `{role, active, accessVersion}` only; do not copy the email or display name into `DASHBOARD_AUDIT`.

Locked attribution cannot be silently changed. `ATTRIBUTION_UNMATCH` and an override match reject a locked row; phase 1 exposes no unlock action.

- [ ] **Step 4: Implement Render mutation endpoints**

```text
POST /api/booking-dashboard/attribution/match
POST /api/booking-dashboard/attribution/unmatch
POST /api/booking-dashboard/attribution/lock
POST /api/booking-dashboard/settings/users/upsert
POST /api/booking-dashboard/settings/meta-pages/upsert
```

`GET /api/booking-dashboard/settings` is Owner-only and returns role-safe user/Page configuration plus version fields through bridge action `SETTINGS_READ`; it never returns secrets or Script Properties.

Every request body is JSON, bounded to 32 KB, and includes `expectedVersion`, `reason`, and `idempotencyKey`. The session email is the only actor identity accepted; actor fields supplied by the browser are ignored.

- [ ] **Step 5: Implement Gentelella owner controls**

Attribution candidate comparison displays Booking identity/timestamp, Page, conversation/lead timestamps, Campaign/Ad context, stop reason, method/confidence, and freshness. Match/unmatch/lock use the upstream modal/toast components, require a reason, send CSRF from `/session`, disable during submission, and refresh the row after success/conflict.

Settings uses native Gentelella tables/forms. It cannot disable the last active Owner and cannot expose CAPI enablement.

- [ ] **Step 6: Verify optimistic mutation and audit behavior**

Run: `npm test -- tests/booking-dashboard/mutations.test.ts apps/pmc-booking-dashboard-bridge/tests/attributionMutations.test.ts apps/pmc-booking-dashboard-bridge/tests/settingsMutations.test.ts`

Expected: PASS.

Run: `npm run dashboard-bridge:typecheck && npm run dashboard:build && npm run build:server`

Expected: PASS.

- [ ] **Step 7: Commit owner mutations**

```bash
git add server/bookingDashboardMutations.ts server/bookingDashboardRouter.ts tests/booking-dashboard/mutations.test.ts apps/pmc-booking-dashboard-bridge/src/attributionMutations.ts apps/pmc-booking-dashboard-bridge/src/settingsMutations.ts apps/pmc-booking-dashboard-bridge/tests apps/pmc-booking-dashboard/src/v4/pmc/attribution.js apps/pmc-booking-dashboard/src/v4/pmc/settings.js apps/pmc-booking-dashboard/production/attribution.html apps/pmc-booking-dashboard/production/settings.html
git commit -m "feat: add audited owner attribution controls"
```

---

### Task 13: Complete appointments, calls, funnel, monthly reports, and owner-safe export

**Files:**
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/appointments.js`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/calls.js`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/funnel.js`
- Create: `apps/pmc-booking-dashboard/src/v4/pmc/reports.js`
- Create: `server/bookingDashboardExport.ts`
- Create: `tests/booking-dashboard/export.test.ts`
- Create: `apps/pmc-booking-dashboard/tests/rolePages.test.js`
- Modify: `apps/pmc-booking-dashboard/production/appointments.html`
- Modify: `apps/pmc-booking-dashboard/production/calls.html`
- Modify: `apps/pmc-booking-dashboard/production/funnel.html`
- Modify: `apps/pmc-booking-dashboard/production/reports.html`
- Modify: `server/bookingDashboardRouter.ts`
- Modify: `server/bookingDashboardService.ts`

**Interfaces:**
- Consumes: role-projected read APIs and Gentelella Calendar/DataTables/ECharts
- Produces: complete phase-1 read-only operations pages and owner-only CSV response from `/api/booking-dashboard/monthly-report?format=csv`

- [ ] **Step 1: Write failing page/role/export tests**

```ts
it('exports a quoted UTF-8 BOM CSV for Owner without storing a file', async () => {
  const result = createMonthlyCsv(reportFixture())
  expect(result.contentType).toBe('text/csv; charset=utf-8')
  expect(result.body.startsWith('\uFEFF')).toBe(true)
  expect(result.body).toContain('"Admin","จำนวน Booking","รายได้ JERA"')
  expect(result.body).not.toContain('commissionAmount')
})

it('denies global export to Staff', async () => {
  const response = await invokeDashboard('/api/booking-dashboard/monthly-report?format=csv', staffSession())
  expect(response.status).toBe(403)
  expect(response.headers).not.toHaveProperty('content-disposition')
})
```

Page tests assert Staff can load Command Center/appointments/calls but receives 403 for funnel/reports/settings/attribution; full identity appears only in authenticated operational responses; no page renders commission amounts.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/booking-dashboard/export.test.ts apps/pmc-booking-dashboard/tests/rolePages.test.js`

Expected: FAIL with missing page modules/export helper.

- [ ] **Step 3: Implement operational pages**

Appointments combines upstream calendar/timeline and DataTable views with full customer name/phone, appointment time, doctor, service, Admin, AE, and status. Calls provides due-today/active/overdue/result filters, next-call time, owner, customer identity, and history summary. Both remain read-only; no call-result or Booking mutation endpoint is added.

- [ ] **Step 4: Implement Ads → Booking → JERA and reports**

Funnel shows Meta acquisition separately from PMC Booking and JERA actuals, along with coverage beside actual ROAS and cost per Booking. Tables break down Page/Campaign/Ad Set/Ad plus service/doctor/Admin/AE/channel/day. Slices with incomplete coverage display `ข้อมูล Attribution ยังไม่ครบ`; they do not rank by actual revenue without visible coverage.

Monthly report accepts exactly one `YYYY-MM` month and summarizes Booking, deposits, JERA closure/revenue, attribution, calls/retries/reconciliation, and dimension breakdowns. Commission columns and payout values remain absent.

- [ ] **Step 5: Implement owner-safe CSV generation**

Generate CSV in memory, prefix UTF-8 BOM, quote every field, neutralize spreadsheet formulas by prefixing cells starting with `=`, `+`, `-`, or `@` with a single quote, set `Content-Disposition: attachment; filename="pmc-booking-report-YYYY-MM.csv"`, and set `Cache-Control: no-store`. Do not write exports to `public/`, `dist/`, Drive, or local runtime storage.

Before returning the CSV, append `EXPORT_CREATED` to `DASHBOARD_AUDIT` with hashed user key, month, row count, timestamp, and correlation ID only. Export audit failure returns `503` and no CSV bytes.

- [ ] **Step 6: Verify all phase-1 pages and export**

Run: `npm test -- tests/booking-dashboard/export.test.ts apps/pmc-booking-dashboard/tests/rolePages.test.js tests/booking-dashboard/readApi.test.ts`

Expected: PASS.

Run: `npm run dashboard:build && npm run dashboard:smoke`

Expected: PASS.

- [ ] **Step 7: Commit phase-1 operational/reporting pages**

```bash
git add apps/pmc-booking-dashboard/src/v4/pmc apps/pmc-booking-dashboard/production apps/pmc-booking-dashboard/tests/rolePages.test.js server/bookingDashboardExport.ts server/bookingDashboardRouter.ts server/bookingDashboardService.ts tests/booking-dashboard/export.test.ts
git commit -m "feat: complete booking dashboard operations pages"
```

---

### Task 14: Harden CSP, rate limits, PII caching, service worker, and disabled CAPI

**Files:**
- Create: `server/bookingDashboardSecurity.ts`
- Create: `server/metaCapi.ts`
- Create: `scripts/assert-no-dashboard-secrets.mjs`
- Create: `apps/pmc-booking-dashboard/scripts/csp-hashes.mjs`
- Create: `tests/booking-dashboard/security.test.ts`
- Create: `tests/booking-dashboard/capi.test.ts`
- Modify: `server/bookingDashboardRouter.ts`
- Modify: `server/productionApp.ts`
- Modify: `apps/pmc-booking-dashboard/package.json`
- Modify: `apps/pmc-booking-dashboard/src/scss/v4/_pmc-booking.scss`
- Modify: `apps/pmc-booking-dashboard/public/sw.js`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: authenticated dashboard router and `META_CAPI_ENABLED`
- Produces: `applyDashboardSecurityHeaders`, `createDashboardRateLimits`, `createMetaCapiClient`

- [ ] **Step 1: Write failing security and no-network CAPI tests**

```ts
it('performs zero Meta writes when CAPI is disabled', async () => {
  const fetchImpl = vi.fn()
  const capi = createMetaCapiClient({ enabled: false, fetchImpl })
  await expect(capi.send(capiFixture())).resolves.toEqual({ status: 'DISABLED' })
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('sets no-store and framing/CSP protection on dashboard responses', async () => {
  const response = await invokeDashboard('/api/booking-dashboard/appointments', ownerSession())
  expect(response.headers['cache-control']).toBe('no-store')
  expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(response.headers['x-content-type-options']).toBe('nosniff')
})
```

Add tests for login/read/mutation/webhook-failure rate buckets, service-worker API exclusion, no wildcard CORS, cookie flags, and secret-pattern absence from built JS/HTML/source maps.

- [ ] **Step 2: Run security tests and verify failure**

Run: `npm test -- tests/booking-dashboard/security.test.ts tests/booking-dashboard/capi.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Self-host Thai fonts and apply restrictive CSP**

Add `@fontsource/noto-sans-thai` to the nested dashboard package and import only 400/500/600/700 WOFF2 assets. Remove Google Fonts network links. CSP permits only same-origin scripts/styles/fonts/images plus `data:` for inline generated chart images when required; it uses `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`, and no `unsafe-eval`.

Keep Gentelella's deterministic pre-paint theme script without `unsafe-inline`: nested build runs `scripts/csp-hashes.mjs` after Vite, hashes every built inline script with SHA-256, and writes `dist/booking-dashboard/csp-script-hashes.json`. The production router loads that manifest and includes every hash in `script-src`; a test fails if built HTML contains an inline script absent from the manifest.

- [ ] **Step 4: Implement route-specific in-memory rate limits**

Use a bounded sliding-window map keyed by hashed IP plus route class; never log raw IP. Initial pilot limits:

```ts
export const DASHBOARD_RATE_LIMITS = {
  oauthStart: { requests: 20, windowMs: 60_000 },
  read: { requests: 180, windowMs: 60_000 },
  mutation: { requests: 30, windowMs: 60_000 },
  webhookFailure: { requests: 30, windowMs: 60_000 },
} as const
```

Expired keys are pruned; map size is capped. A rate-limited response is JSON `429` with `Retry-After` and no request detail.

- [ ] **Step 5: Exclude PII/API requests from PWA caching**

The service worker caches only hashed static files under `/booking-dashboard/assets/` and the shell HTML. It bypasses every `/api/` request and never calls `cache.put` for a response whose `Cache-Control` contains `no-store`.

- [ ] **Step 6: Implement disabled-only CAPI boundary**

```ts
export function createMetaCapiClient(deps: { enabled: boolean; fetchImpl: typeof fetch }) {
  return {
    async send(_event: unknown) {
      if (!deps.enabled) return { status: 'DISABLED' as const }
      throw new Error('CAPI activation is not approved')
    },
  }
}
```

There is no UI control, endpoint, queue, or scheduled task that can change `enabled`.

- [ ] **Step 7: Verify security and bundle scans**

`scripts/assert-no-dashboard-secrets.mjs` recursively reads text files under `dist/booking-dashboard` and `dist-server`, rejects the five forbidden secret variable names plus any test secret literal, and fails when either build directory is missing.

Run: `npm test -- tests/booking-dashboard/security.test.ts tests/booking-dashboard/capi.test.ts`

Expected: PASS.

Run: `npm run dashboard:build && npm run build:server`

Expected: PASS.

Run: `node scripts/assert-no-dashboard-secrets.mjs`

Expected: exit `0` and no match.

- [ ] **Step 8: Commit security hardening**

```bash
git add server/bookingDashboardSecurity.ts server/metaCapi.ts server/bookingDashboardRouter.ts server/productionApp.ts tests/booking-dashboard/security.test.ts tests/booking-dashboard/capi.test.ts scripts/assert-no-dashboard-secrets.mjs apps/pmc-booking-dashboard/package.json apps/pmc-booking-dashboard/scripts/csp-hashes.mjs apps/pmc-booking-dashboard/src/scss/v4/_pmc-booking.scss apps/pmc-booking-dashboard/public/sw.js package-lock.json
git commit -m "security: harden booking dashboard boundaries"
```

---

### Task 15: Add best-effort Booking/JERA/call cache invalidation without coupling canonical writes

**Files:**
- Create: `server/bookingDashboardInvalidation.ts`
- Create: `tests/booking-dashboard/invalidation.test.ts`
- Create: `apps/pmc-google-booking-ops/src/adapters/dashboardInvalidation.ts`
- Create: `apps/pmc-google-booking-ops/src/domain/dashboardInvalidation.ts`
- Create: `apps/pmc-google-booking-ops/tests/dashboardInvalidation.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/config.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `server/bookingDashboardRouter.ts`

**Interfaces:**
- Produces: public signed POST `/api/booking-dashboard/invalidate`; `DashboardInvalidationPort.notify(event): void`
- Consumes: optional Booking Script Properties `PMC_DASHBOARD_INVALIDATION_URL`, `PMC_DASHBOARD_INVALIDATION_SECRET`; Render `DASHBOARD_INVALIDATION_SECRET`

- [ ] **Step 1: Write failing non-coupling and signature tests**

```ts
it('never fails a canonical repository write when invalidation fails', () => {
  const notify = vi.fn(() => { throw new Error('dashboard unavailable') })
  const base = baseRepositories()
  const repositories = createInvalidatingRepositories(base, { notify })
  expect(() => repositories.bookings.insert(bookingFixture())).not.toThrow()
  expect(base.bookings.getByCaseId('PMC-202608-0001')).not.toBeNull()
})

it('rejects invalid invalidation HMAC before clearing cache', async () => {
  const cache = cacheFixture()
  const result = await handleInvalidation({ rawBody: Buffer.from('{}'), signature: 'bad' }, { cache, secret: 'invalidate-secret' })
  expect(result.status).toBe(401)
  expect(cache.clearSource).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/booking-dashboard/invalidation.test.ts apps/pmc-google-booking-ops/tests/dashboardInvalidation.test.ts`

Expected: FAIL with missing invalidation modules.

- [ ] **Step 3: Implement the optional Apps Script invalidation port**

```ts
export interface DashboardInvalidationEvent {
  source: 'BOOKING' | 'CALL' | 'JERA'
  sourceId: string
  version: number
  updatedAt: string
}
```

Wrap Booking repository insert/update, call insert/update/cancel, and successful JERA import state updates. The wrapper invokes `notify` after the underlying write, catches every notification error, and returns the canonical result unchanged. If either optional property is blank, the port is a no-op.

The request contains no customer identity, is timestamped/nonce-protected, and uses HMAC SHA-256 over the raw body.

- [ ] **Step 4: Implement Render verification and cache invalidation**

The public route accepts POST only, buffers at most 16 KB, verifies `x-pmc-signature` before parsing, rejects requests older than five minutes, deduplicates nonce, then clears only cache entries for the declared source. It sets no PII response and returns `{ok:true}`.

- [ ] **Step 5: Verify canonical workflow independence**

Run: `npm test -- tests/booking-dashboard/invalidation.test.ts apps/pmc-google-booking-ops/tests/dashboardInvalidation.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts apps/pmc-google-booking-ops/tests/jeraImport.test.ts`

Expected: PASS, including a fixture where invalidation throws and Booking/JERA still succeeds.

Run: `npm run booking:typecheck && npm run build:server`

Expected: PASS.

- [ ] **Step 6: Commit best-effort invalidation**

```bash
git add server/bookingDashboardInvalidation.ts server/bookingDashboardRouter.ts tests/booking-dashboard/invalidation.test.ts apps/pmc-google-booking-ops/src/adapters/dashboardInvalidation.ts apps/pmc-google-booking-ops/src/domain/dashboardInvalidation.ts apps/pmc-google-booking-ops/src/config.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/tests/dashboardInvalidation.test.ts
git commit -m "feat: add best-effort dashboard invalidation"
```

---

### Task 16: Add end-to-end fixtures, deployment configuration, rollout evidence, and rollback gates

**Files:**
- Create: `tests/booking-dashboard/integration.test.ts`
- Create: `apps/pmc-booking-dashboard/tests/browserAcceptance.spec.js`
- Create: `apps/pmc-booking-dashboard-bridge/docs/setup.md`
- Create: `docs/superpowers/runbooks/2026-08-22-pmc-booking-dashboard-pilot.md`
- Modify: `.env.example`
- Modify: `render.yaml`
- Modify: `package.json`
- Modify: `docs/PROJECT_UPDATES.md`

**Interfaces:**
- Consumes: all Tasks 1–15
- Produces: one-command local acceptance suite, explicit `BOOKING_DASHBOARD_ENABLED=false` deployment boundary, manual production gates, rollback runbook

- [ ] **Step 1: Write failing end-to-end acceptance fixtures**

```ts
it('flows synthetic Messenger phone/Page data through Booking, attribution, and actual ROAS', async () => {
  await ingestWebhook(messengerFixture({ phone: '0800000008', pageId: 'page-1', adId: 'ad-1' }))
  await seedBooking(bookingFixture({ caseId: 'PMC-202608-0100', phoneNormalized: '0800000008', channelId: 'channel-1', status: 'CLOSED_JERA', jeraActualRevenue: 40_000 }))
  await reconcile()
  const summary = await ownerGet('/api/booking-dashboard/summary?from=2026-08-01&to=2026-08-31')
  expect(summary.kpis).toMatchObject({ metaSpend: 10_000, jeraActualRevenue: 40_000, actualRoas: 4 })
})

it('queues two valid candidates and attributes neither', async () => {
  await seedAmbiguousMessengerCandidates()
  await reconcile()
  expect(await readActiveAttributions()).toHaveLength(0)
  expect(await readOwnerQueue()).toHaveLength(1)
})
```

Add OAuth allow/deny/revoke, bridge schema mismatch, cache invalidation/reconcile fallback, webhook duplicate, CAPI zero-network, dashboard-down Booking success, Owner/Staff route matrix, stale/unavailable UI, and monthly CSV formula-neutralization scenarios.

- [ ] **Step 2: Run the new acceptance suite and verify at least one red test**

Run: `npm test -- tests/booking-dashboard/integration.test.ts`

Expected: FAIL until all cross-module adapters and fixtures are wired.

- [ ] **Step 3: Wire deterministic integration fixtures and browser acceptance**

Use only in-memory Sheet/bridge fakes and reserved synthetic identities. Browser acceptance runs the built Node server and validates Gentelella at `1440x900`, `1024x768`, and `390x844`: sidebar rail/drawer, centered heading/KPI/chart axes, DataTables, filters, dark mode, modal/toast, Thai marks, full-phone layout, role navigation, stale/error states, no horizontal overflow, keyboard focus, and zero console errors.

- [ ] **Step 4: Declare environment names without values**

Add these names to `.env.example` and `render.yaml`; every secret uses `sync: false` and no example secret value:

```text
BOOKING_DASHBOARD_ENABLED=false
BOOKING_DASHBOARD_DATA_MODE=synthetic
DASHBOARD_GOOGLE_CLIENT_ID
DASHBOARD_GOOGLE_CLIENT_SECRET
DASHBOARD_GOOGLE_REDIRECT_URI
DASHBOARD_SESSION_SECRET
DASHBOARD_BRIDGE_URL
DASHBOARD_BRIDGE_SECRET
DASHBOARD_INVALIDATION_SECRET
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN
META_CAPI_ENABLED=false
```

Production stays disabled after code deployment until a separate owner approval changes the feature flag.

- [ ] **Step 5: Write the pilot/rollback runbook**

The runbook requires, in order:

1. rotate any operational credential previously exposed in chat/tool logs;
2. verify active Render identity/service and current Meta connection read-only;
3. verify Ad Account ID/status/currency/timezone and all intended Pages/subscriptions without printing tokens;
4. create the separate company-owned Apps Script Bridge project and company-owned OAuth client;
5. back up the Spreadsheet and record tab/header hashes;
6. deploy bridge code but keep attribution shadow mode on;
7. deploy Render with `BOOKING_DASHBOARD_ENABLED=false` and `META_CAPI_ENABLED=false`;
8. enable authenticated synthetic mode for Owner only after explicit approval;
9. enable Booking/JERA read-only pilot after evidence review;
10. subscribe Meta webhooks only after a separate explicit approval;
11. enable owner attribution mutations only after shadow-quality sign-off;
12. add Staff allowlist only after owner acceptance;
13. never enable CAPI in this rollout.

Rollback disables the feature flag, removes webhook subscriptions independently, restores OAuth/bridge secrets independently, preserves new Sheet/audit rows, leaves Google Form/Booking/Calendar/Drive/LINE/JERA untouched, and keeps existing Ads/Page Automation Basic Auth routes active.

- [ ] **Step 6: Run the complete local verification gate**

```bash
npm run dashboard-bridge:test
npm run dashboard-bridge:typecheck
npm run dashboard-bridge:build
npm run dashboard:build
npm run dashboard:smoke
npm run dashboard:browser
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run test
npm run lint
npm run build
node scripts/assert-no-dashboard-secrets.mjs
git diff --check
```

Expected: every command exits `0`; browser acceptance reports no console error or overflow; CAPI network spy count is `0`; existing PMC regression tests remain green.

- [ ] **Step 7: Record the local-only evidence and commit rollout documentation**

Update `docs/PROJECT_UPDATES.md` with test counts, build result, reviewed screenshot paths, feature flags, and the statement `No production credential, webhook subscription, Apps Script deployment, Meta write, or Render deployment changed in this stage.`

```bash
git add tests/booking-dashboard apps/pmc-booking-dashboard/tests/browserAcceptance.spec.js apps/pmc-booking-dashboard-bridge/docs/setup.md docs/superpowers/runbooks/2026-08-22-pmc-booking-dashboard-pilot.md .env.example render.yaml package.json package-lock.json docs/PROJECT_UPDATES.md
git commit -m "test: add booking dashboard rollout gates"
```

---

## Spec Coverage Matrix

| Written Design section | Implemented by |
| --- | --- |
| 1–5 Purpose, decisions, runtime boundary, architecture, real Gentelella | Tasks 1, 2, 5 |
| 6 OAuth, access directory, Owner/Staff matrix | Tasks 4, 7, 8, 13 |
| 7 Data authority and source separation | Tasks 3, 7, 9, 13 |
| 8 Bridge, freshness, quota guardrails | Tasks 6, 7, 8, 11, 15 |
| 9 Meta read path, permissions, verified webhooks, minimal message storage | Tasks 9, 10, 16 |
| 10 Sheet additions | Tasks 7, 10, 12 |
| 11 Exact and 30-day attribution, ambiguity, owner queue | Tasks 11, 12 |
| 12 KPI formulas, operational metrics, breakdowns, guardrails | Tasks 3, 9, 11, 13 |
| 13 All seven Gentelella pages | Tasks 5, 12, 13 |
| 14 Render API and owner mutations | Tasks 4, 8, 10, 12, 13 |
| 15 Disabled CAPI boundary | Task 14 |
| 16 Security and privacy | Tasks 4, 6, 8, 10, 12, 14, 16 |
| 17 Reliability and error handling | Tasks 8, 10, 11, 15 |
| 18 Unit, contract, integration, browser, security QA | Every task; full gate in Task 16 |
| 19–20 Staged rollout and rollback | Task 16 |
| 21 Acceptance criteria | Task 16 end-to-end and browser acceptance suites |
| 22 Explicitly deferred capabilities | Global Constraints and Task 14 CAPI guard |

Self-review result: every Written Design requirement maps to at least one task; no implementation placeholder or unresolved interface remains in this plan.

---

## Execution Order and Approval Gates

1. Tasks 1–5 produce an authenticated synthetic dashboard with no Google Booking or Meta production data.
2. Tasks 6–8 produce the separate signed Sheet read path; code may be built locally but not deployed without approval.
3. Tasks 9–11 add read-only Meta and shadow attribution; no webhook subscription is authorized by code completion.
4. Tasks 12–15 add owner controls, security, and best-effort invalidation; production feature flags remain off.
5. Task 16 proves local acceptance and prepares the pilot. Stop before every live credential, OAuth, Apps Script, webhook, or Render change and request explicit owner approval for that exact action.

The implementation is complete only when all 16 acceptance criteria in the Written Design are evidenced and no deferred capability has been activated.
