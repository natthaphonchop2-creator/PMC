# PMC Clinic Reports Rebrand and Production Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the existing read-only report UI as `รายงานคลินิก`, add safe production branch-discovery and sequential cache-seeding tools, and roll all 14 report views into Production without exposing the provider name or adding provider writes.

**Architecture:** Keep all existing internal `JERA_*` contracts, routes, cache tabs, clients, and safe error codes. Change only rendered product language, add owner-operated read-only operator scripts that obtain credentials from Secret Manager in memory, seed the existing Google Sheet cache sequentially through the existing coordinator, and use disabled-first/no-traffic rollout gates before enabling the report runtime for active staff.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Node.js, Google Cloud Run, Secret Manager, Google Sheets API, LINE LIFF, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-pmc-clinic-report-rollout-design.md`

## Global Constraints

- Rendered Mini App content and accessibility labels must not contain `JERA`, case-insensitive.
- Internal TypeScript types, routes, safe error codes, Sheet tabs, Secret Manager bindings, and operator documentation retain `JERA_*` names.
- All 14 existing report selections remain available to every active, LINE-linked `CONFIG_STAFF` member.
- Provider access remains read-only: token POST only; business operations use allowlisted GET requests only.
- Performer Fee, DF payouts, commission formulas, automatic closure, provider writes, and role-specific report visibility are excluded.
- Initial cache seeding processes all 13 source report types sequentially and honors bounded `Retry-After` delays.
- Scheduler creation is excluded from the initial release and remains a separate owner gate.
- Raw provider rows, customer identifiers, credentials, bearer tokens, unrestricted URLs, Sheet IDs, and LINE IDs must not appear in logs or rollout evidence.
- Existing Booking, Async Booking, Stock, OCR, Drive evidence, Calendar, LINE, Google Form fallback, and rollback behavior must remain unchanged.
- Thai body line height remains at least 1.55; Thai letter spacing remains normal; report tables retain semantic headings and keyboard-scrollable regions.

---

### Task 1: Product-facing report language and rendered copy guard

**Files:**
- Create: `tests/pmc-mini-app/reportCopy.test.tsx`
- Modify: `src/apps/pmc-mini-app/Home.tsx`
- Modify: `src/apps/pmc-mini-app/ReportCenter.tsx`
- Modify: `src/apps/pmc-mini-app/ReportPage.tsx`
- Modify: `tests/pmc-mini-app/clientShell.test.tsx`
- Modify: `tests/pmc-mini-app/reportCenter.test.tsx`
- Modify: `tests/pmc-mini-app/reportPage.test.tsx`

**Interfaces:**
- Consumes: existing `Home`, `ReportCenter`, `AdditionalReportMenu`, `ReportPage`, and `MiniAppConfig.reportingEnabled`.
- Produces: exact product-facing copy and `assertNoProviderName(container: HTMLElement): void` test helper behavior.

- [ ] **Step 1: Write failing rendered-copy tests**

Create `tests/pmc-mini-app/reportCopy.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Home } from '../../src/apps/pmc-mini-app/Home'
import { AdditionalReportMenu, ReportCenter } from '../../src/apps/pmc-mini-app/ReportCenter'
import { ReportPage } from '../../src/apps/pmc-mini-app/ReportPage'
import { defaultReportFilters } from '../../src/apps/pmc-mini-app/reports'

afterEach(cleanup)

function assertNoProviderName(container: HTMLElement) {
  expect(container).not.toHaveTextContent(/jera/i)
  expect(container.querySelectorAll('[aria-label*="JERA" i]')).toHaveLength(0)
}

describe('PMC Clinic Reports product language', () => {
  it('brands the enabled Home card as รายงานคลินิก', () => {
    const view = render(<Home
      session={{ staffId: 'ADMIN_01', displayName: 'มัส', active: true }}
      reportingEnabled stockEnabled={false} onAction={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: 'รายงานคลินิก' })).toBeVisible()
    expect(screen.getByText('ดูข้อมูลการเงิน นัดหมาย และการดำเนินงาน')).toBeVisible()
    assertNoProviderName(view.container)
  })

  it('removes the provider name from report menus and pages', () => {
    const adapter = {
      load: vi.fn(async () => ({
        data: { totals: {} }, source: 'CACHE' as const, fetchedAt: null,
        lastSuccessAt: '2026-08-29T00:00:00.000Z', refreshing: false, stale: false, warningCode: null,
      })),
      refresh: vi.fn(async () => ({ accepted: true as const, correlationId: 'refresh-1' })),
    }
    const center = render(<ReportCenter
      filters={defaultReportFilters('2026-08-29')} onFiltersChange={vi.fn()} onSelect={vi.fn()}
    />)
    expect(screen.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()
    expect(screen.getByText('ข้อมูลจากระบบคลินิกแบบอ่านอย่างเดียว')).toBeVisible()
    assertNoProviderName(center.container)
    center.unmount()

    const additional = render(<AdditionalReportMenu onBack={vi.fn()} onSelect={vi.fn()} />)
    assertNoProviderName(additional.container)
    additional.unmount()

    const page = render(<ReportPage
      reportType="PAYMENT" filters={defaultReportFilters('2026-08-29')}
      onFiltersChange={vi.fn()} adapter={adapter} onBack={vi.fn()} pollDelayMs={0}
    />)
    expect(screen.getByText('CLINIC REPORT')).toBeVisible()
    assertNoProviderName(page.container)
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run tests/pmc-mini-app/reportCopy.test.tsx
```

Expected: FAIL because the current Home card, source note, report-page eyebrow, additional-report eyebrow, and item notes render the provider name.

- [ ] **Step 3: Apply the exact copy contract**

Update `Home.tsx`:

```tsx
<button type="button" className="pmc-home-quick-card" aria-label="รายงานคลินิก" onClick={() => onAction?.('REPORTS')}>
  <span className="pmc-card-icon"><ChartNoAxesCombined aria-hidden="true" /></span>
  <strong>รายงานคลินิก</strong>
  <small>ดูข้อมูลการเงิน นัดหมาย และการดำเนินงาน</small>
  <ChevronRight className="pmc-card-chevron" aria-hidden="true" />
</button>
```

Update `ReportCenter.tsx`:

```tsx
<p lang="en">REPORT CENTER</p>
<h1>รายงานคลินิก</h1>
<span>ข้อมูลจากระบบคลินิกแบบอ่านอย่างเดียว</span>
```

Use `CLINIC REPORT` for both report-page and additional-report eyebrows. Replace each additional-item note with `ดูข้อมูลรายงาน`. Do not rename internal `JeraReportType`, `JeraClientEnvelope`, route paths, warning codes, or storage keys.

- [ ] **Step 4: Update existing UI selectors and run GREEN**

Replace rendered queries for `รายงาน JERA` with `รายงานคลินิก`. Keep internal test descriptions free to name the integration when they test an internal contract.

Run:

```bash
npx vitest run tests/pmc-mini-app/reportCopy.test.tsx \
  tests/pmc-mini-app/clientShell.test.tsx \
  tests/pmc-mini-app/reportCenter.test.tsx \
  tests/pmc-mini-app/reportPage.test.tsx
```

Expected: PASS with no rendered `/JERA/i` match.

- [ ] **Step 5: Commit**

```bash
git add src/apps/pmc-mini-app/Home.tsx \
  src/apps/pmc-mini-app/ReportCenter.tsx \
  src/apps/pmc-mini-app/ReportPage.tsx \
  tests/pmc-mini-app/reportCopy.test.tsx \
  tests/pmc-mini-app/clientShell.test.tsx \
  tests/pmc-mini-app/reportCenter.test.tsx \
  tests/pmc-mini-app/reportPage.test.tsx
git commit -m "feat: rebrand PMC clinic reports"
```

---

### Task 2: Safe branch discovery and provider Retry-After handling

**Files:**
- Create: `scripts/jera-operator-secrets.mjs`
- Create: `scripts/discover-clinic-report-branch.mjs`
- Create: `tests/jera/branchDiscovery.test.ts`
- Modify: `server/jera/client.ts`
- Modify: `tests/jera/client.test.ts`
- Modify: `tests/jera/runtimeSafety.test.ts`

**Interfaces:**
- Produces: `loadJeraOperatorSecrets(input, dependencies)`, `discoverClinicBranches(args, dependencies)`, `parseProviderRetryAfter(value, nowMs): number | null`.
- `discoverClinicBranches` returns `{ clinicCount, branchCount, branches: Array<{ uuid: string; name: string }> }` and never returns credentials, tokens, or raw provider bodies.
- Scheduled client mode waits for a bounded provider `Retry-After`; interactive mode continues returning a safe rate-limit error without sleeping.

- [ ] **Step 1: Write failing Retry-After tests**

Add to `tests/jera/client.test.ts`:

```ts
it('honors bounded Retry-After in scheduled mode before retrying a 429', async () => {
  const sleep = vi.fn(async () => undefined)
  const fetch = vi.fn()
    .mockResolvedValueOnce(response(429, {}, { 'retry-after': '31' }))
    .mockResolvedValueOnce(response(200, { payment_data: [] }))
  const client = createJeraReadClient(config(), tokenPort(), { fetch, mode: 'SCHEDULED', sleep })

  await expect(client.request('PAYMENT', filters())).resolves.toEqual([])
  expect(sleep).toHaveBeenCalledWith(31_000)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each(['0', '-1', '121', 'invalid'])('rejects unsafe Retry-After %s', (value) => {
  expect(parseProviderRetryAfter(value, Date.parse('2026-08-29T00:00:00Z'))).toBeNull()
})
```

Update the response test helper so it accepts a lowercase header map.

- [ ] **Step 2: Write failing branch-discovery and redaction tests**

Create `tests/jera/branchDiscovery.test.ts` with an injected secret accessor and fetch:

```ts
it('returns only bounded clinic branch metadata', async () => {
  const result = await discoverClinicBranches(
    ['--allow-readonly-production', '--project', 'project-2099d92f-51c8-4d2b-a8c'],
    dependencies({
      clinicBody: [{ uuid: CLINIC_UUID, name: 'Promed', branches: [{ uuid: BRANCH_UUID, name: 'สาขาหลัก' }] }],
    }),
  )
  expect(result).toEqual({ clinicCount: 1, branchCount: 1, branches: [{ uuid: BRANCH_UUID, name: 'สาขาหลัก' }] })
  expect(JSON.stringify(result)).not.toMatch(/username|password|token|secret/i)
})

it('fails closed on ambiguous or malformed clinic metadata', async () => {
  await expect(discoverClinicBranches(
    ['--allow-readonly-production', '--project', 'project-2099d92f-51c8-4d2b-a8c'],
    dependencies({ clinicBody: [{ branches: [{ uuid: 'not-a-uuid', name: 'bad' }] }] }),
  )).rejects.toThrow('Clinic branch discovery failed')
})
```

The parser accepts a root array or `{ data: [...] }`. Each clinic may expose `branches`, `branch_data`, or `clinic_branches`; each branch must contain `uuid` or `branch_uuid` and a bounded `name` or `branch_name`. Unknown shapes fail without logging the body.

- [ ] **Step 3: Run tests and verify RED**

```bash
npx vitest run tests/jera/client.test.ts tests/jera/branchDiscovery.test.ts tests/jera/runtimeSafety.test.ts
```

Expected: FAIL because the operator modules and Retry-After parser do not exist.

- [ ] **Step 4: Implement Secret Manager loading and branch discovery**

`scripts/jera-operator-secrets.mjs` must access exactly these secret names from the explicit project:

```js
export const JERA_OPERATOR_SECRET_NAMES = [
  'JERA_API_BASE_URL',
  'JERA_API_USERNAME',
  'JERA_API_PASSWORD',
]
```

It validates `project-2099d92f-51c8-4d2b-a8c`, reads `latest` versions through an injected Secret Manager accessor, stores values only in local variables, and returns an object whose custom inspection/JSON methods redact all values.

`discover-clinic-report-branch.mjs` must:

1. Require `--allow-readonly-production` and the exact project argument.
2. Obtain a temporary token through the existing token contract.
3. Call only `GET /openapi/v1/clinic/`.
4. Bound the response to 2 MB.
5. Return only clinic count, branch count, UUID, and bounded display name.
6. Never print raw metadata or credentials on error.

- [ ] **Step 5: Implement scheduled Retry-After behavior**

Export from `server/jera/client.ts`:

```ts
export function parseProviderRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null
  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 120 ? seconds * 1_000 : null
  }
  const dateMs = Date.parse(value)
  if (!Number.isFinite(dateMs)) return null
  const delay = Math.ceil((dateMs - nowMs) / 1_000) * 1_000
  return delay >= 1_000 && delay <= 120_000 ? delay : null
}
```

In scheduled mode, a 429 with retries remaining sleeps for the parsed delay, falling back to 1,000 ms when absent/invalid. A 5xx uses the existing short bounded backoff. Interactive mode never sleeps on 429.

- [ ] **Step 6: Run GREEN and commit**

```bash
npx vitest run tests/jera/client.test.ts tests/jera/branchDiscovery.test.ts tests/jera/runtimeSafety.test.ts
git add server/jera/client.ts scripts/jera-operator-secrets.mjs \
  scripts/discover-clinic-report-branch.mjs tests/jera/client.test.ts \
  tests/jera/branchDiscovery.test.ts tests/jera/runtimeSafety.test.ts
git commit -m "feat: add safe clinic report discovery"
```

---

### Task 3: Sequential owner-operated cache seeding

**Files:**
- Create: `scripts/seed-clinic-report-cache.mjs`
- Create: `tests/jera/seedClinicReportCache.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `CLINIC_REPORT_SOURCE_TYPES` in exact registry order and `seedClinicReportCache(args, environment, dependencies)`.
- CLI output is `{ mode, date, sequential, reports }`; each report contains only `reportType`, `count`, aggregate satang fields, `warningCode`, and `lastSuccessAt`.
- Cache writes use the existing `createJeraSyncCoordinator().scheduledRefresh()` and existing Google Sheet store; no new endpoint or table is created.

- [ ] **Step 1: Write failing sequential/cache evidence tests**

Create `tests/jera/seedClinicReportCache.test.ts`:

```ts
it('seeds all 13 source reports sequentially and emits aggregate evidence only', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const order: string[] = []
  const coordinator = {
    async scheduledRefresh(query: { reportType: string }) {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      order.push(query.reportType)
      await Promise.resolve()
      inFlight -= 1
      return {
        data: [{ patientName: 'must-not-leak', paidAmountSatang: 100 }],
        source: 'LIVE', fetchedAt: NOW, lastSuccessAt: NOW,
        refreshing: false, stale: false, warningCode: null,
      }
    },
  }
  const result = await seedClinicReportCache(
    ['--allow-readonly-production', '--project', 'project-2099d92f-51c8-4d2b-a8c', '--date', '2026-08-29'],
    environment(), dependencies({ coordinator }),
  )
  expect(order).toEqual([...CLINIC_REPORT_SOURCE_TYPES])
  expect(maxInFlight).toBe(1)
  expect(result.reports).toHaveLength(13)
  expect(JSON.stringify(result)).not.toContain('must-not-leak')
})

it('refuses production access without the explicit flag and one-day date', async () => {
  await expect(seedClinicReportCache(['--date', '2026-08-29'], environment(), dependencies()))
    .rejects.toThrow('Explicit read-only production approval is required')
})
```

- [ ] **Step 2: Run test and verify RED**

```bash
npx vitest run tests/jera/seedClinicReportCache.test.ts
```

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the seeding CLI**

Use this exact source registry:

```js
export const CLINIC_REPORT_SOURCE_TYPES = [
  'PAYMENT', 'DEPOSIT', 'REFUND', 'APPOINTMENT', 'PAYMENT_LIST',
  'PRODUCT_USE', 'PRODUCT_SALES', 'CANCELLED_PAYMENT', 'OPD',
  'CANCELLED_UNPAID', 'COURSE_SALES', 'REMAINING_COURSE',
  'REMAINING_COURSE_BY_DATE',
]
```

The CLI requires:

```text
--allow-readonly-production
--project project-2099d92f-51c8-4d2b-a8c
--date 2026-08-29
```

The CLI accepts any strict ISO date; `2026-08-29` is the deterministic test/example date.

It reads `PMC_SPREADSHEET_ID`, `PMC_DRIVE_INTAKE_FOLDER_ID`, `JERA_DEFAULT_BRANCH_UUID`, and `JERA_SYNC_INTERVAL_MINUTES` from the operator environment, obtains the three provider bindings through `loadJeraOperatorSecrets`, creates the existing Google Sheet store/coordinator, and awaits each `scheduledRefresh` inside a `for...of` loop.

For each envelope, aggregate normalized rows without exposing them:

```js
function safeEvidence(reportType, envelope) {
  const rows = Array.isArray(envelope.data) ? envelope.data : []
  return {
    reportType,
    count: rows.length,
    totalSatang: sum(rows, 'totalSatang'),
    paidAmountSatang: sum(rows, 'paidAmountSatang'),
    refundAmountSatang: sum(rows, 'refundAmountSatang'),
    warningCode: envelope.warningCode,
    lastSuccessAt: envelope.lastSuccessAt,
  }
}
```

Add the package script:

```json
"reports:seed": "node scripts/seed-clinic-report-cache.mjs"
```

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run tests/jera/seedClinicReportCache.test.ts tests/jera/syncCoordinator.test.ts tests/jera/store.test.ts
git add scripts/seed-clinic-report-cache.mjs tests/jera/seedClinicReportCache.test.ts package.json
git commit -m "feat: seed clinic report cache safely"
```

---

### Task 4: Runbook, browser acceptance, and full regression matrix

**Files:**
- Modify: `docs/pmc-mini-app/jera-shadow-runbook.md`
- Modify: `src/apps/pmc-mini-app/main.tsx`
- Modify: `src/apps/pmc-mini-app/preview.ts`
- Modify: `tests/jera/runtimeSafety.test.ts`
- Modify: `tests/pmc-mini-app/browserAcceptance.spec.ts`
- Modify: `tests/pmc-mini-app/preview.test.ts`

**Interfaces:**
- Consumes: product copy from Task 1, branch discovery from Task 2, cache seeding from Task 3.
- Produces: exact operator gate sequence and end-to-end mobile acceptance for the renamed report product.

- [ ] **Step 1: Add failing runbook and browser assertions**

Extend `tests/jera/runtimeSafety.test.ts`:

```ts
expect(runbook).toContain('discover-clinic-report-branch.mjs')
expect(runbook).toContain('seed-clinic-report-cache.mjs')
expect(runbook).toContain('13 source report types')
expect(runbook).toContain('Scheduler')
expect(runbook).toContain('owner approval')
expect(runbook).not.toMatch(/JERA_API_(?:USERNAME|PASSWORD)\s*=\s*\S+/)
```

Add a Playwright scenario:

```ts
test('active staff opens renamed clinic reports without provider branding', async ({ page }) => {
  await page.goto('/mini-app/?preview=1&reports=enabled&stock=enabled&role=staff')
  await page.getByRole('button', { name: 'รายงานคลินิก' }).click()
  await expect(page.getByRole('heading', { name: 'รายงานคลินิก' })).toBeVisible()
  await page.getByRole('button', { name: 'ยอดรับชำระ' }).click()
  await expect(page.getByText('CLINIC REPORT')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/JERA/i)
  await page.getByRole('button', { name: 'รีเฟรชข้อมูล' }).click()
  await expect(page.getByText(/อัปเดตล่าสุดเมื่อ|ข้อมูลอาจล่าช้า/)).toBeVisible()
})
```

Update the preview contract without changing Production defaults:

```ts
// main.tsx
const reportingEnabled = search.get('reports') === 'enabled'
return {
  initialSession: preview.PREVIEW_SESSION,
  initialConfig: preview.createPreviewMiniAppConfig({ reportingEnabled, stockEnabled, canManageStock }),
  api: preview.createPreviewMiniAppApi({ reportingEnabled, stockEnabled, canManageStock }),
}
```

Add `reportingEnabled?: boolean` to both preview option types and set `reportingEnabled: options.reportingEnabled === true`. Add a focused preview test proving the default remains false and the explicit option becomes true.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx vitest run tests/jera/runtimeSafety.test.ts tests/pmc-mini-app/reportCopy.test.tsx
npx playwright test --config=playwright.mini-app.config.ts --grep "renamed clinic reports"
```

Expected: FAIL until runbook and preview acceptance are updated.

- [ ] **Step 3: Update the shadow runbook**

Document this exact order:

1. Copy/local verification.
2. Disabled no-traffic revision.
3. Secret binding presence check without values.
4. Branch discovery through the owner-operated script.
5. Sequential one-day core probes.
6. Owner comparison approval.
7. Sequential 13-source cache seed.
8. Cache/sync/audit safe readback.
9. Reporting-enabled no-traffic revision.
10. Authenticated LINE pilot and owner approval.
11. Production traffic.
12. Scheduler remains paused until separate approval.
13. Reporting-disabled rollback without deleting cache/audit rows.

- [ ] **Step 4: Run the complete verification matrix**

```bash
npm run build
npx vitest run --exclude tests/ocr-ledger/job.test.ts
npx vitest run tests/ocr-ledger/job.test.ts
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npx playwright test --config=playwright.mini-app.config.ts
node scripts/check-jera-readonly-runtime.mjs --env-file /dev/null
git diff --check
```

Expected:

- All commands exit 0.
- Rendered report UI contains no provider name.
- Existing Booking, Async Booking, Stock, OCR, and LINE tests remain green.
- Runtime output contains binding names/presence only, never values.
- Any existing generated-output warning is reported separately and not misrepresented as a new regression.

- [ ] **Step 5: Commit**

```bash
git add docs/pmc-mini-app/jera-shadow-runbook.md \
  src/apps/pmc-mini-app/main.tsx \
  src/apps/pmc-mini-app/preview.ts \
  tests/jera/runtimeSafety.test.ts \
  tests/pmc-mini-app/browserAcceptance.spec.ts \
  tests/pmc-mini-app/preview.test.ts
git commit -m "test: verify PMC clinic report rollout"
```

---

### Task 5: Production shadow, cache seed, and reporting enablement

**Files:**
- Create after successful rollout: `docs/pmc-mini-app/clinic-report-rollout-evidence-2026-08-29.md`
- No source changes unless a verification defect starts a new TDD cycle in the responsible task.

**Interfaces:**
- Consumes: commits and operator tools from Tasks 1–4.
- Produces: verified branch UUID, approved one-day comparison, seeded cache, reporting-enabled revision, active-staff LINE access, and a reporting-disabled rollback revision.

- [ ] **Step 1: Verify exact Production identity read-only**

```bash
gcloud config get-value project
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gcloud run services describe pmc-mini-app --region=asia-southeast1 \
  --format='value(status.latestReadyRevisionName,spec.template.spec.serviceAccountName)'
```

Required identity:

```text
project-2099d92f-51c8-4d2b-a8c
promedclinicpmc@gmail.com
pmc-mini-app-runtime@project-2099d92f-51c8-4d2b-a8c.iam.gserviceaccount.com
```

- [ ] **Step 2: Stop for owner approval before provider calls or Cloud changes**

Present source commit, full verification counts, active revision, required secret names, disabled rollback revision, and exact read-only operations. Do not present secret values, URLs, Sheet IDs, or patient data.

- [ ] **Step 3: Deploy the copy-only disabled/no-traffic revision**

```bash
gcloud run deploy pmc-mini-app --source . \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --update-env-vars=JERA_REPORTING_ENABLED=false \
  --update-secrets=JERA_API_BASE_URL=JERA_API_BASE_URL:latest,JERA_API_USERNAME=JERA_API_USERNAME:latest,JERA_API_PASSWORD=JERA_API_PASSWORD:latest \
  --tag=clinic-reports-disabled \
  --no-traffic \
  --quiet
```

The command binds these existing Secret Manager entries without printing values:

```text
JERA_API_BASE_URL     <- JERA_API_BASE_URL:latest
JERA_API_USERNAME     <- JERA_API_USERNAME:latest
JERA_API_PASSWORD     <- JERA_API_PASSWORD:latest
```

Keep Scheduler bindings absent. Verify health 200, Mini App 200, unauthenticated session/config/report APIs 401, and legacy route parity.

- [ ] **Step 4: Discover the branch and run one-day shadow probes**

Use the safe discovery tool with the explicit Production-read flag:

```bash
PMC_REPORT_BRANCH_FILE="$(mktemp -t pmc-clinic-report-branch).json"
node scripts/discover-clinic-report-branch.mjs \
  --allow-readonly-production \
  --project project-2099d92f-51c8-4d2b-a8c > "$PMC_REPORT_BRANCH_FILE"
PMC_REPORT_BRANCH_UUID="$(jq -r 'if .branchCount == 1 then .branches[0].uuid else empty end' "$PMC_REPORT_BRANCH_FILE")"
if [[ ! "$PMC_REPORT_BRANCH_UUID" =~ ^[0-9a-fA-F-]{36}$ ]]; then exit 31; fi
PMC_REPORT_DATE="$(TZ=Asia/Bangkok date +%F)"
```

The branch file contains safe clinic/branch metadata only. Keep the selected UUID in the operator-only variable; never commit it or print it in unrestricted logs.

Run the existing one-day probe sequentially for:

```text
PAYMENT
DEPOSIT
REFUND
APPOINTMENT
```

Use one Bangkok calendar date only. Record safe count/total evidence and compare with the provider UI/export for the same date. Stop if any count/total is unresolved.

Run each probe with secrets loaded into the child process only:

```bash
for PMC_REPORT_TYPE in PAYMENT DEPOSIT REFUND APPOINTMENT; do
  JERA_API_BASE_URL="$(gcloud secrets versions access latest --secret=JERA_API_BASE_URL --project=project-2099d92f-51c8-4d2b-a8c)" \
  JERA_API_USERNAME="$(gcloud secrets versions access latest --secret=JERA_API_USERNAME --project=project-2099d92f-51c8-4d2b-a8c)" \
  JERA_API_PASSWORD="$(gcloud secrets versions access latest --secret=JERA_API_PASSWORD --project=project-2099d92f-51c8-4d2b-a8c)" \
  JERA_REPORTING_ENABLED=true \
  JERA_DEFAULT_BRANCH_UUID="$PMC_REPORT_BRANCH_UUID" \
  JERA_SYNC_INTERVAL_MINUTES=15 \
  node scripts/check-jera-readonly-runtime.mjs \
    --allow-readonly-production \
    --report "$PMC_REPORT_TYPE" \
    --start-date "$PMC_REPORT_DATE" \
    --end-date "$PMC_REPORT_DATE"
done
```

- [ ] **Step 5: Stop for owner approval before cache writes**

Present only report type, date, provider count, provider total satang, comparison count/total, pass/fail, warning code, reviewer, revision, and timestamp.

- [ ] **Step 6: Seed all source caches sequentially**

Run:

```bash
npm run build:server
PMC_REPORT_SERVICE_FILE="$(mktemp -t pmc-clinic-report-service).json"
gcloud run services describe pmc-mini-app \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --format=json > "$PMC_REPORT_SERVICE_FILE"
export PMC_SPREADSHEET_ID="$(jq -r '.spec.template.spec.containers[0].env[] | select(.name == "PMC_SPREADSHEET_ID") | .value' "$PMC_REPORT_SERVICE_FILE")"
export PMC_DRIVE_INTAKE_FOLDER_ID="$(jq -r '.spec.template.spec.containers[0].env[] | select(.name == "PMC_DRIVE_INTAKE_FOLDER_ID") | .value' "$PMC_REPORT_SERVICE_FILE")"
export JERA_DEFAULT_BRANCH_UUID="$PMC_REPORT_BRANCH_UUID"
export JERA_SYNC_INTERVAL_MINUTES=15
npm run reports:seed -- \
  --allow-readonly-production \
  --project project-2099d92f-51c8-4d2b-a8c \
  --date "$PMC_REPORT_DATE"
```

Verify 13 report evidence entries, maximum concurrency 1, non-empty success timestamps or explicit safe warnings, and bounded `JERA_API_CACHE`, `JERA_SYNC_STATE`, `JERA_SYNC_AUDIT` readback.

- [ ] **Step 7: Deploy and validate a reporting-enabled no-traffic revision**

Deploy the same reviewed image using the approved branch UUID:

```bash
PMC_REPORT_DISABLED_REVISION="$(gcloud run services describe pmc-mini-app \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --format=json | jq -r '.status.traffic[] | select(.tag == "clinic-reports-disabled") | .revisionName')"
if [[ ! "$PMC_REPORT_DISABLED_REVISION" =~ ^pmc-mini-app-[0-9]{5}-[a-z]{3}$ ]]; then exit 32; fi
PMC_REPORT_IMAGE="$(gcloud run revisions describe "$PMC_REPORT_DISABLED_REVISION" \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --format='value(spec.containers[0].image)')"
gcloud run deploy pmc-mini-app \
  --image="$PMC_REPORT_IMAGE" \
  --project=project-2099d92f-51c8-4d2b-a8c \
  --region=asia-southeast1 \
  --update-env-vars=JERA_REPORTING_ENABLED=true \
  --update-env-vars="JERA_DEFAULT_BRANCH_UUID=${PMC_REPORT_BRANCH_UUID}" \
  --update-env-vars=JERA_SYNC_INTERVAL_MINUTES=15 \
  --update-secrets=JERA_API_BASE_URL=JERA_API_BASE_URL:latest,JERA_API_USERNAME=JERA_API_USERNAME:latest,JERA_API_PASSWORD=JERA_API_PASSWORD:latest \
  --tag=clinic-reports-pilot \
  --no-traffic \
  --quiet
```

Scheduler variables remain absent. Verify all 14 authenticated report APIs, cache-first reads, manual refresh throttling, stale fallback, and no provider name in the rendered UI.

- [ ] **Step 8: Route Production after owner approval**

Route 100% traffic to the reviewed reporting-enabled revision. Verify a manager and non-manager active account can open reports, all report types remain read-only, Booking/Stock/OCR/LINE routes remain unchanged, and no unexpected ERROR/5xx log appears.

- [ ] **Step 9: Record safe evidence and rollback state**

Create `docs/pmc-mini-app/clinic-report-rollout-evidence-2026-08-29.md` containing only:

```text
source commit
Cloud Run revision names
report date and report types
counts and aggregate satang totals
cache/sync/audit row counts
pass/fail and warning codes
manual LINE role checks
rollback revision
reviewer and timestamps
```

Never include raw rows, patient/customer details, credentials, bearer tokens, URLs, Sheet IDs, or LINE IDs.

Commit:

```bash
git add docs/pmc-mini-app/clinic-report-rollout-evidence-2026-08-29.md
git commit -m "docs: record PMC clinic report rollout"
```
