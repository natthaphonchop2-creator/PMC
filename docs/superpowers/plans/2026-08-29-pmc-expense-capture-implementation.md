# PMC Expense Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, retry-safe PMC expense-capture subsystem that lets authorized staff submit bill and daily-book evidence while finance-authorized staff can view bounded monthly expense totals, history, and private evidence.

**Architecture:** The LINE Mini App stages one to five validated images in a private GCS bucket, then Cloud Run sends HMAC-signed `PREPARE_EXPENSE` and `COMMIT_EXPENSE` commands to the existing Apps Script ingress. Apps Script is the mutation authority: it verifies immutable staff permissions, serializes book revisions with `LockService`, writes a private monthly finance ledger through `PREPARED` and `COMMITTED`, and maintains an append-only recovery audit. Cloud Run exposes submit-only APIs to staff and bounded one-month finance reads/evidence delivery to finance-authorized staff; no finance workbook or Drive identifiers reach the browser.

**Tech Stack:** React 19, TypeScript 6, Vite 8, LINE LIFF 2.30, Node.js Cloud Run, Google Cloud Storage, Google Drive API, Google Sheets API, Google Apps Script V8, Vitest 4, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-pmc-financial-report-and-expense-capture-design.md`

**Execution prerequisite:** Complete Tasks 1-8 of `docs/superpowers/plans/2026-08-29-pmc-daily-monthly-finance-reports-implementation.md` first. This plan consumes the finance-first report home, monthly-income page, and canonical 12-column `CONFIG_STAFF` permission migration; it must not create a second report shell or a competing staff schema. For one integrated release, execute revenue Tasks 1-8, expense Tasks 1-9, then combine the owner-gated revenue Task 9 and expense Task 10 rollout checks; do not route an intermediate feature to Production merely because its local tasks pass.

## Global Constraints

- First-release capture categories are exactly `BILL_DOCUMENT`, `BOOK_CLINIC`, and `BOOK_DOCTOR_PERSONAL`; salary, employee DF, and doctor DF remain visible as `เตรียมระบบ` with no create API.
- Expense scopes are server-derived: `BOOK_DOCTOR_PERSONAL` is `DOCTOR_PERSONAL`; every other enabled category is `CLINIC`.
- Expense dates and month keys use `Asia/Bangkok`; the server derives `monthKey`, `bookDailyKey`, revision, IDs, timestamps, and submitter identity.
- An expense requires one to five JPEG/PNG images, each no larger than 10 MB, no more than 25 MB total, and no more than 20 megapixels.
- Only effective `COMMITTED` rows enter reports; `PREPARED`, `VOID`, superseded revisions, and incomplete uploads never enter totals.
- Each physical book has at most one effective committed record per `scope + expenseDate`; replacement is finance-manager-only, immutable, revisioned, and enforced by signed Apps Script CAS under `LockService`.
- Staff with `canSubmitExpense` can submit and receive only the current durable receipt; they cannot list or retrieve prior submissions, including their own.
- Only immutable staff IDs with `canViewFinance` can view monthly finance, history, individual evidence, and doctor-personal records; only `canManageExpense` can replace or void.
- Missing permission columns and missing/invalid values default to `false`; new staff receive no finance permission automatically.
- `COMMITTED` means `บันทึกแล้ว` only. It never means approved, audited, bank-verified, or accounting-posted.
- OCR, approval, payroll, DF, PDF, JERA writes, Stock writes, Booking writes, Calendar writes, and accounting-provider posting are outside this plan.
- Original evidence stays private. Browser delivery requires verified LINE identity, `canViewFinance`, expense membership, and a short-lived token; a signature-only public proxy is forbidden.
- Staging expires after 24 hours; stale `PREPARED` records are recovered or abandoned after 48 hours; committed and voided evidence is never automatically deleted in this release.
- Expense GET requests are cache/provider-call free and read only the selected private monthly ledger; they never scan all historical months.
- Ship behind `PMC_EXPENSE_CAPTURE_ENABLED=false` and `PMC_FINANCE_READS_ENABLED=false`; rollback disables flags without deleting finance records or evidence.

## File Structure

### Shared contracts

- Create `shared/pmcExpense.ts` — expense types, Bangkok date derivation, validation, effective-revision selection, and monthly projection.
- Create `shared/pmcMiniAppExpenseIngress.ts` — exact signed command envelope, canonical serialization, result contracts, and safe error codes.

### Cloud Run

- Create `server/pmc-mini-app/finance/config.ts` — finance feature flags and private resource identifiers.
- Create `server/pmc-mini-app/finance/googleClient.ts` — master/month allowlisted Sheet reads and private Drive upload/download.
- Create `server/pmc-mini-app/finance/readStore.ts` — bounded monthly expense, history, and evidence projections.
- Create `server/pmc-mini-app/finance/evidenceToken.ts` — five-minute finance-viewer-bound evidence access tokens.
- Create `server/pmc-mini-app/finance/stagingStore.ts` — expense-only GCS staging with deterministic keys and verified deletion.
- Create `server/pmc-mini-app/finance/stagingToken.ts` — staff-bound, idempotency-bound, 24-hour HMAC staging receipts.
- Create `server/pmc-mini-app/finance/multipart.ts` — one-to-five image parsing with byte and pixel limits.
- Create `server/pmc-mini-app/finance/ingressClient.ts` — HMAC Apps Script expense command client.
- Create `server/pmc-mini-app/finance/submissionService.ts` — prepare, private Drive persist, commit, retry, and staging cleanup orchestration.
- Create `server/pmc-mini-app/finance/middleware.ts` — submit-only and finance-only API router with safe responses.
- Create `server/pmc-mini-app/finance/recovery.ts` — authenticated stale-prepared recovery worker adapter.
- Modify `server/pmc-mini-app/config.ts` — compose finance config without exposing identifiers.
- Modify `server/pmc-mini-app/contracts.ts` — finance permissions and dependency ports.
- Modify `server/pmc-mini-app/store.ts` — read `CONFIG_STAFF!A:L` and fail closed for three finance booleans.
- Modify `server/pmc-mini-app/middleware.ts` — mount finance routes after LINE verification and return only permission booleans in Mini App config.
- Modify `server/pmc-mini-app/runtime.ts` — construct finance ports only when correctly configured.
- Modify `server/productionApp.ts` — route the authenticated internal recovery endpoint to the Mini App middleware.

### Apps Script

- Create `apps/pmc-google-booking-ops/src/expense/sheetTopology.ts` — finance master and monthly-ledger schemas plus exact topology validation.
- Create `apps/pmc-google-booking-ops/src/expense/repository.ts` — private month resolution, expense rows, attachments, summary, and append-only audit.
- Create `apps/pmc-google-booking-ops/src/expense/commands.ts` — prepare, commit CAS, replacement, void, recover, and abandon logic.
- Create `apps/pmc-google-booking-ops/src/expense/ingress.ts` — envelope verification, replay defense, permission checks, and `LockService` boundary.
- Create `apps/pmc-google-booking-ops/src/expense/setup.ts` — fail-closed permission migration, safe roster, explicit grants, and finance topology setup.
- Modify `apps/pmc-google-booking-ops/src/config.ts` — finance master/folder and permission-cutover properties.
- Modify `apps/pmc-google-booking-ops/src/sheetSchema.ts` — append the three canonical staff permission columns.
- Modify `apps/pmc-google-booking-ops/src/domain/sheetMigration.ts` — verify or atomically append the three canonical finance permission columns.
- Modify `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts` — apply the compatible migration.
- Modify `apps/pmc-google-booking-ops/src/ports.ts` — finance permission fields and expense repository port.
- Modify `apps/pmc-google-booking-ops/src/runtime.ts` — construct private finance repositories and recovery workflow.
- Modify `apps/pmc-google-booking-ops/src/entrypoints.ts` — route `MINI_APP_EXPENSE` and expose setup/recovery entrypoints.
- Modify `apps/pmc-google-booking-ops/scripts/build.mjs` — export the finance setup and recovery functions.

### Mini App client

- Create `src/apps/pmc-mini-app/expense/expenseModel.ts` — form state, validation, retry state, and error copy.
- Create `src/apps/pmc-mini-app/expense/ExpenseCards.tsx` — three active and three deferred category cards.
- Create `src/apps/pmc-mini-app/expense/ExpenseForm.tsx` — bill/book fields, one-to-five image picker, review, and submit.
- Create `src/apps/pmc-mini-app/expense/ExpenseReceipt.tsx` — durable receipt and `ยังไม่ผ่านการตรวจสอบ` copy.
- Create `src/apps/pmc-mini-app/expense/ExpenseHistory.tsx` — finance-only month history, replacement, void, and evidence access.
- Create `src/apps/pmc-mini-app/expense/MonthlyExpensePanel.tsx` — finance-only clinic/personal monthly projection for the monthly-report page.
- Modify `src/apps/pmc-mini-app/contracts.ts` — permission booleans and expense projections.
- Modify `src/apps/pmc-mini-app/api.ts` — stage, submit, monthly, history, replace, void, and evidence methods.
- Modify `src/apps/pmc-mini-app/FinanceReportHome.tsx` — replace deferred expense cards with permission-aware `ExpenseCards`.
- Modify `src/apps/pmc-mini-app/MonthlyFinancePage.tsx` — compose the finance-only monthly expense panel and estimated balance.
- Modify `src/apps/pmc-mini-app/PmcMiniApp.tsx` — route expense submission, receipt, and finance views.
- Modify `src/apps/pmc-mini-app/preview.ts` — deterministic submit-only and finance preview adapters.
- Modify `src/apps/pmc-mini-app/styles.css` — compact mobile expense surfaces using existing PMC tokens.

### Verification and operations

- Create `scripts/check-pmc-expense-runtime.mjs` — read-only configuration, route, permission, and bounded-read verifier.
- Create `docs/pmc-mini-app/expense-capture-runbook.md` — setup, pilot, recovery, rollback, and evidence-retention procedure.
- Modify `tests/pmc-mini-app/browserAcceptance.spec.ts` — mobile submit-only and finance acceptance paths.

---

### Task 1: Shared Expense Domain and Projection Safety

**Files:**
- Create: `shared/pmcExpense.ts`
- Test: `tests/pmc-mini-app/expenseDomain.test.ts`

**Interfaces:**
- Consumes: no expense dependencies.
- Produces: `ExpenseCategory`, `EnabledExpenseCategory`, `ExpenseScope`, `ExpensePaymentMethod`, `ExpenseRecordState`, `ExpenseSubmission`, `ExpenseAttachmentSummary`, `ExpenseAuditEvent`, `ExpenseReceipt`, `ExpenseMonthlyProjection`, `ExpenseHistoryRow`, `ExpenseHistoryPage`, `parseExpenseDate()`, `deriveExpenseScope()`, `deriveBookDailyKey()`, `effectiveCommittedExpenses()`, and `projectMonthlyExpenses()`.

- [ ] **Step 1: Write failing domain tests for scope, Bangkok month, revisions, and monthly totals**

```ts
import { describe, expect, it } from 'vitest'
import {
  deriveBookDailyKey,
  deriveExpenseScope,
  effectiveCommittedExpenses,
  parseExpenseDate,
  projectMonthlyExpenses,
  type ExpenseSubmission,
} from '../../shared/pmcExpense'

const row = (patch: Partial<ExpenseSubmission>): ExpenseSubmission => ({
  expenseId: 'EXP-202608-1', expenseDate: '2026-08-29', monthKey: '2026-08',
  category: 'BOOK_CLINIC', scope: 'CLINIC', amountSatang: 10_000,
  counterpartyName: null, description: '', paymentMethod: null,
  recordState: 'COMMITTED', bookDailyKey: 'CLINIC:2026-08-29', revision: 1,
  supersedesExpenseId: null, submittedByStaffId: 'ADMIN_01', submittedByName: 'มัส',
  submittedAt: '2026-08-29T10:00:00+07:00', committedAt: '2026-08-29T10:01:00+07:00',
  updatedAt: '2026-08-29T10:01:00+07:00', version: 2, idempotencyKey: 'expense-request-1',
  ...patch,
})

describe('PMC expense domain', () => {
  it('derives scope and month on the Bangkok calendar', () => {
    expect(parseExpenseDate('2026-08-29')).toEqual({ expenseDate: '2026-08-29', monthKey: '2026-08' })
    expect(deriveExpenseScope('BOOK_DOCTOR_PERSONAL')).toBe('DOCTOR_PERSONAL')
    expect(deriveExpenseScope('BILL_DOCUMENT')).toBe('CLINIC')
    expect(deriveBookDailyKey('BOOK_CLINIC', '2026-08-29')).toBe('CLINIC:2026-08-29')
  })

  it('counts only the latest effective committed book revision', () => {
    const first = row({ expenseId: 'EXP-1', amountSatang: 10_000 })
    const replacement = row({ expenseId: 'EXP-2', amountSatang: 12_000, revision: 2, supersedesExpenseId: 'EXP-1' })
    const prepared = row({ expenseId: 'EXP-3', category: 'BILL_DOCUMENT', bookDailyKey: null, recordState: 'PREPARED', amountSatang: 99_000 })
    expect(effectiveCommittedExpenses([first, replacement, prepared]).map(({ expenseId }) => expenseId)).toEqual(['EXP-2'])
    expect(projectMonthlyExpenses([first, replacement, prepared], '2026-08')).toMatchObject({
      clinicCommittedSatang: 12_000,
      doctorPersonalCommittedSatang: 0,
      unreviewed: true,
    })
  })

  it('does not resurrect a superseded revision when the latest replacement is voided', () => {
    const first = row({ expenseId: 'EXP-1', amountSatang: 10_000 })
    const voidedReplacement = row({
      expenseId: 'EXP-2', amountSatang: 12_000, revision: 2,
      supersedesExpenseId: 'EXP-1', recordState: 'VOID',
    })
    expect(effectiveCommittedExpenses([first, voidedReplacement])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `npx vitest run tests/pmc-mini-app/expenseDomain.test.ts`

Expected: FAIL because `shared/pmcExpense.ts` does not exist.

- [ ] **Step 3: Implement the exact shared contracts and pure projectors**

```ts
export type ExpenseCategory =
  | 'BILL_DOCUMENT' | 'BOOK_CLINIC' | 'BOOK_DOCTOR_PERSONAL'
  | 'SALARY' | 'EMPLOYEE_DF' | 'DOCTOR_DF'
export type EnabledExpenseCategory = Extract<ExpenseCategory,
  'BILL_DOCUMENT' | 'BOOK_CLINIC' | 'BOOK_DOCTOR_PERSONAL'>
export type ExpenseScope = 'CLINIC' | 'DOCTOR_PERSONAL'
export type ExpensePaymentMethod = 'TRANSFER' | 'CASH' | 'CREDIT' | 'OTHER'
export type ExpenseRecordState = 'PREPARED' | 'COMMITTED' | 'VOID'

export interface ExpenseSubmission {
  expenseId: string; expenseDate: string; monthKey: string; category: EnabledExpenseCategory
  scope: ExpenseScope; amountSatang: number; counterpartyName: string | null; description: string
  paymentMethod: ExpensePaymentMethod | null; recordState: ExpenseRecordState; bookDailyKey: string | null
  revision: number; supersedesExpenseId: string | null; submittedByStaffId: string; submittedByName: string
  submittedAt: string; committedAt: string | null; updatedAt: string; version: number; idempotencyKey: string
}

export interface ExpenseAttachmentSummary {
  attachmentId: string; expenseId: string; ordinal: number; mediaType: 'image/jpeg' | 'image/png'
  originalFileName: string
}

export interface ExpenseAuditEvent {
  eventId: string; expenseId: string; actorStaffId: string
  action: 'PREPARE' | 'COMMIT' | 'SUPERSEDE' | 'VOID' | 'RECOVER' | 'ABANDON'
  beforeJson: string; afterJson: string; createdAt: string; correlationId: string
}

export interface ExpenseReceipt {
  expenseId: string; receiptNumber: string; expenseDate: string; monthKey: string
  category: EnabledExpenseCategory; scope: ExpenseScope; amountSatang: number
  recordState: 'COMMITTED'; revision: number; committedAt: string; unreviewed: true
}

export interface ExpenseMonthlyProjection {
  monthKey: string; clinicCommittedSatang: number; doctorPersonalCommittedSatang: number
  clinicByCategorySatang: Record<'BILL_DOCUMENT' | 'BOOK_CLINIC', number>
  effectiveExpenseCount: number; unreviewed: true
}

export interface ExpenseHistoryRow {
  expenseId: string; expenseDate: string; category: EnabledExpenseCategory; scope: ExpenseScope
  amountSatang: number; description: string; recordState: ExpenseRecordState; revision: number
  submittedByName: string; submittedAt: string; committedAt: string | null
  attachments: ExpenseAttachmentSummary[]
}
export interface ExpenseHistoryPage { expenses: ExpenseHistoryRow[]; nextCursor: string | null }

export function parseExpenseDate(value: string): { expenseDate: string; monthKey: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('EXPENSE_INVALID_DATE')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) {
    throw new Error('EXPENSE_INVALID_DATE')
  }
  return { expenseDate: value, monthKey: value.slice(0, 7) }
}

export function deriveExpenseScope(category: EnabledExpenseCategory): ExpenseScope {
  return category === 'BOOK_DOCTOR_PERSONAL' ? 'DOCTOR_PERSONAL' : 'CLINIC'
}

export function deriveBookDailyKey(category: EnabledExpenseCategory, expenseDate: string): string | null {
  parseExpenseDate(expenseDate)
  if (category === 'BILL_DOCUMENT') return null
  return `${deriveExpenseScope(category)}:${expenseDate}`
}

export function effectiveCommittedExpenses(rows: ExpenseSubmission[]): ExpenseSubmission[] {
  const committed = rows.filter((row) => row.recordState === 'COMMITTED')
  const superseded = new Set(rows.flatMap((row) => row.supersedesExpenseId ? [row.supersedesExpenseId] : []))
  return committed.filter((row) => !superseded.has(row.expenseId))
}

export function projectMonthlyExpenses(rows: ExpenseSubmission[], monthKey: string): ExpenseMonthlyProjection {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error('EXPENSE_INVALID_MONTH')
  const effective = effectiveCommittedExpenses(rows).filter((row) => row.monthKey === monthKey)
  const sum = (scope: ExpenseScope) => effective.filter((row) => row.scope === scope)
    .reduce((total, row) => total + row.amountSatang, 0)
  return {
    monthKey,
    clinicCommittedSatang: sum('CLINIC'),
    doctorPersonalCommittedSatang: sum('DOCTOR_PERSONAL'),
    clinicByCategorySatang: {
      BILL_DOCUMENT: effective.filter((row) => row.category === 'BILL_DOCUMENT').reduce((n, row) => n + row.amountSatang, 0),
      BOOK_CLINIC: effective.filter((row) => row.category === 'BOOK_CLINIC').reduce((n, row) => n + row.amountSatang, 0),
    },
    effectiveExpenseCount: effective.length,
    unreviewed: true,
  }
}
```

- [ ] **Step 4: Run the domain test and verify GREEN**

Run: `npx vitest run tests/pmc-mini-app/expenseDomain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the shared domain**

```bash
git add shared/pmcExpense.ts tests/pmc-mini-app/expenseDomain.test.ts
git commit -m "feat: add PMC expense domain"
```

### Task 2: Signed Expense Ingress Contract

**Files:**
- Create: `shared/pmcMiniAppExpenseIngress.ts`
- Test: `tests/pmc-mini-app/expenseIngressContract.test.ts`

**Interfaces:**
- Consumes: `EnabledExpenseCategory`, `ExpensePaymentMethod`, and `ExpenseReceipt` from Task 1.
- Produces: `ExpensePrivateAttachment`, `MiniAppExpenseCommand`, `ExpensePrepareResult`, `ExpenseCommandResult`, `MiniAppExpenseIngressEnvelope`, `canonicalMiniAppExpenseCommand()`, `canonicalMiniAppExpenseIngress()`, and `MiniAppExpenseSafeErrorCode`.

- [ ] **Step 1: Write failing canonicalization and exact-key tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  canonicalMiniAppExpenseCommand,
  canonicalMiniAppExpenseIngress,
  type MiniAppExpenseCommand,
} from '../../shared/pmcMiniAppExpenseIngress'

const command: MiniAppExpenseCommand = {
  rootRequestId: 'expense-request-1', commandIdempotencyKey: 'expense-request-1:prepare',
  staffId: 'ADMIN_01', commandType: 'PREPARE_EXPENSE',
  payload: {
    expenseDate: '2026-08-29', category: 'BOOK_CLINIC', bookDailyKey: 'CLINIC:2026-08-29', amountSatang: 12_000,
    counterpartyName: null, description: 'สมุดประจำวันที่ 29', paymentMethod: null,
    expectedAttachmentCount: 2, expectedManifestHash: 'a'.repeat(64), expectedRevision: 0,
  },
}

describe('expense ingress contract', () => {
  it('produces deterministic field-order canonical JSON', () => {
    expect(canonicalMiniAppExpenseCommand(command)).toBe(canonicalMiniAppExpenseCommand(structuredClone(command)))
    expect(canonicalMiniAppExpenseIngress({
      kind: 'MINI_APP_EXPENSE', version: 1, timestamp: 1_788_000_000, nonce: 'nonce-0001', command,
    })).toContain('"kind":"MINI_APP_EXPENSE"')
  })

  it('rejects extra command fields', () => {
    expect(() => canonicalMiniAppExpenseCommand({ ...command, injected: true } as never)).toThrow('invalid mini app expense command')
  })
})
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx vitest run tests/pmc-mini-app/expenseIngressContract.test.ts`

Expected: FAIL because the ingress contract does not exist.

- [ ] **Step 3: Implement exact commands and safe errors**

```ts
import type {
  EnabledExpenseCategory, ExpensePaymentMethod, ExpenseReceipt,
} from './pmcExpense'

export interface ExpensePrivateAttachment {
  attachmentId: string; expenseId: string; ordinal: number; mediaType: 'image/jpeg' | 'image/png'
  originalFileName: string; privateFileId: string; sha256: string
  uploadedByStaffId: string; uploadedAt: string
}

export type MiniAppExpenseCommand =
  | { rootRequestId: string; commandIdempotencyKey: string; staffId: string; commandType: 'PREPARE_EXPENSE'; payload: {
      expenseDate: string; category: EnabledExpenseCategory; bookDailyKey: string | null; amountSatang: number
      counterpartyName: string | null; description: string; paymentMethod: ExpensePaymentMethod | null
      expectedAttachmentCount: number; expectedManifestHash: string; expectedRevision: number
    } }
  | { rootRequestId: string; commandIdempotencyKey: string; staffId: string; commandType: 'COMMIT_EXPENSE'; payload: {
      expenseId: string; expectedVersion: number; expectedRevision: number
      expectedManifestHash: string; attachments: ExpensePrivateAttachment[]
    } }
  | { rootRequestId: string; commandIdempotencyKey: string; staffId: string; commandType: 'VOID_EXPENSE'; payload: {
      expenseId: string; expectedVersion: number; reason: string
    } }

export interface ExpensePrepareResult {
  commandType: 'PREPARE_EXPENSE'; expenseId: string; monthKey: string
  recordState: 'PREPARED'; version: number; expectedRevision: number
}
export type ExpenseCommandResult = ExpensePrepareResult | ({ commandType: 'COMMIT_EXPENSE' } & ExpenseReceipt)
  | { commandType: 'VOID_EXPENSE'; expenseId: string; recordState: 'VOID'; version: number; updatedAt: string }

export interface UnsignedMiniAppExpenseIngressEnvelope {
  kind: 'MINI_APP_EXPENSE'; version: 1; timestamp: number; nonce: string; command: MiniAppExpenseCommand
}
export interface MiniAppExpenseIngressEnvelope extends UnsignedMiniAppExpenseIngressEnvelope { signature: string }

export const MINI_APP_EXPENSE_SAFE_ERROR_CODES = [
  'EXPENSE_INVALID_REQUEST', 'EXPENSE_INVALID_DATE', 'EXPENSE_INVALID_AMOUNT',
  'EXPENSE_INVALID_CATEGORY', 'EXPENSE_INVALID_PAYMENT_METHOD', 'EXPENSE_INVALID_ATTACHMENTS',
  'EXPENSE_STAFF_REQUIRED', 'EXPENSE_SUBMIT_PERMISSION_REQUIRED', 'EXPENSE_FINANCE_PERMISSION_REQUIRED',
  'EXPENSE_IDEMPOTENCY_CONFLICT', 'EXPENSE_NOT_FOUND', 'EXPENSE_NOT_PREPARED',
  'EXPENSE_REVISION_CONFLICT', 'EXPENSE_IMMUTABLE_FIELD', 'EXPENSE_PRIVATE_FILE_INVALID',
  'EXPENSE_STORAGE_UNAVAILABLE',
] as const
export type MiniAppExpenseSafeErrorCode = typeof MINI_APP_EXPENSE_SAFE_ERROR_CODES[number]

const COMMAND_KEYS = ['rootRequestId', 'commandIdempotencyKey', 'staffId', 'commandType', 'payload'] as const
const ENVELOPE_KEYS = ['kind', 'version', 'timestamp', 'nonce', 'command'] as const

export function canonicalMiniAppExpenseCommand(command: MiniAppExpenseCommand): string {
  return JSON.stringify(orderedCommand(command))
}

export function canonicalMiniAppExpenseIngress(envelope: UnsignedMiniAppExpenseIngressEnvelope): string {
  if (!hasExactKeys(envelope, ENVELOPE_KEYS)
    || envelope.kind !== 'MINI_APP_EXPENSE' || envelope.version !== 1
    || !Number.isSafeInteger(envelope.timestamp) || !safeId(envelope.nonce)) {
    throw new Error('invalid mini app expense envelope')
  }
  return JSON.stringify({
    kind: 'MINI_APP_EXPENSE', version: 1, timestamp: envelope.timestamp,
    nonce: envelope.nonce, command: orderedCommand(envelope.command),
  })
}

function orderedCommand(value: unknown): MiniAppExpenseCommand {
  if (!hasExactKeys(value, COMMAND_KEYS) || !safeId(value.rootRequestId)
    || !safeId(value.commandIdempotencyKey)
    || !safeId(value.staffId) || typeof value.commandType !== 'string' || !isRecord(value.payload)) {
    throw new Error('invalid mini app expense command')
  }
  const expectedSuffix = value.commandType === 'PREPARE_EXPENSE' ? ':prepare'
    : value.commandType === 'COMMIT_EXPENSE' ? ':commit' : ':void'
  if (value.commandIdempotencyKey !== `${value.rootRequestId}${expectedSuffix}`) {
    throw new Error('invalid mini app expense command phase key')
  }
  const common = {
    rootRequestId: value.rootRequestId,
    commandIdempotencyKey: value.commandIdempotencyKey,
    staffId: value.staffId,
  }
  if (value.commandType === 'PREPARE_EXPENSE') {
    const keys = ['expenseDate','category','bookDailyKey','amountSatang','counterpartyName','description','paymentMethod',
      'expectedAttachmentCount','expectedManifestHash','expectedRevision'] as const
    if (!hasExactKeys(value.payload, keys) || typeof value.payload.expenseDate !== 'string'
      || !isEnabledCategory(value.payload.category) || !nullableBookDailyKey(value.payload.bookDailyKey)
      || !positiveSatang(value.payload.amountSatang)
      || !nullableBoundedText(value.payload.counterpartyName, 160) || !boundedText(value.payload.description, 500)
      || !nullablePaymentMethod(value.payload.paymentMethod)
      || !Number.isSafeInteger(value.payload.expectedAttachmentCount)
      || value.payload.expectedAttachmentCount < 1 || value.payload.expectedAttachmentCount > 5
      || !sha256(value.payload.expectedManifestHash)
      || !Number.isSafeInteger(value.payload.expectedRevision) || value.payload.expectedRevision < 0) {
      throw new Error('invalid mini app expense command payload')
    }
    return { ...common, commandType: 'PREPARE_EXPENSE', payload: {
      expenseDate: value.payload.expenseDate, category: value.payload.category,
      bookDailyKey: value.payload.bookDailyKey,
      amountSatang: value.payload.amountSatang, counterpartyName: value.payload.counterpartyName,
      description: value.payload.description, paymentMethod: value.payload.paymentMethod,
      expectedAttachmentCount: value.payload.expectedAttachmentCount,
      expectedManifestHash: value.payload.expectedManifestHash, expectedRevision: value.payload.expectedRevision,
    } }
  }
  if (value.commandType === 'COMMIT_EXPENSE') {
    const keys = ['expenseId','expectedVersion','expectedRevision','expectedManifestHash','attachments'] as const
    if (!hasExactKeys(value.payload, keys) || !safeId(value.payload.expenseId)
      || !Number.isSafeInteger(value.payload.expectedVersion) || value.payload.expectedVersion < 1
      || !Number.isSafeInteger(value.payload.expectedRevision) || value.payload.expectedRevision < 0
      || !sha256(value.payload.expectedManifestHash) || !Array.isArray(value.payload.attachments)
      || value.payload.attachments.length < 1 || value.payload.attachments.length > 5) {
      throw new Error('invalid mini app expense command payload')
    }
    const attachments = value.payload.attachments.map(orderedAttachment)
    if (attachments.some((item, index) => item.ordinal !== index + 1)) {
      throw new Error('invalid mini app expense attachment order')
    }
    return { ...common, commandType: 'COMMIT_EXPENSE', payload: {
      expenseId: value.payload.expenseId, expectedVersion: value.payload.expectedVersion,
      expectedRevision: value.payload.expectedRevision, expectedManifestHash: value.payload.expectedManifestHash,
      attachments,
    } }
  }
  if (value.commandType === 'VOID_EXPENSE') {
    const keys = ['expenseId','expectedVersion','reason'] as const
    if (!hasExactKeys(value.payload, keys) || !safeId(value.payload.expenseId)
      || !Number.isSafeInteger(value.payload.expectedVersion) || value.payload.expectedVersion < 1
      || !boundedText(value.payload.reason, 300) || value.payload.reason.trim().length < 3) {
      throw new Error('invalid mini app expense command payload')
    }
    return { ...common, commandType: 'VOID_EXPENSE', payload: {
      expenseId: value.payload.expenseId, expectedVersion: value.payload.expectedVersion,
      reason: value.payload.reason,
    } }
  }
  throw new Error('invalid mini app expense command')
}

function orderedAttachment(value: unknown): ExpensePrivateAttachment {
  const keys = ['attachmentId','expenseId','ordinal','mediaType','originalFileName','privateFileId','sha256',
    'uploadedByStaffId','uploadedAt'] as const
  if (!hasExactKeys(value, keys) || !safeId(value.attachmentId) || !safeId(value.expenseId)
    || !Number.isSafeInteger(value.ordinal) || value.ordinal < 1 || value.ordinal > 5
    || (value.mediaType !== 'image/jpeg' && value.mediaType !== 'image/png')
    || !boundedText(value.originalFileName, 160) || !safeId(value.privateFileId) || !sha256(value.sha256)
    || !safeId(value.uploadedByStaffId) || typeof value.uploadedAt !== 'string'
    || !Number.isFinite(Date.parse(value.uploadedAt))) throw new Error('invalid mini app expense attachment')
  return {
    attachmentId: value.attachmentId, expenseId: value.expenseId, ordinal: value.ordinal,
    mediaType: value.mediaType, originalFileName: value.originalFileName, privateFileId: value.privateFileId,
    sha256: value.sha256, uploadedByStaffId: value.uploadedByStaffId, uploadedAt: value.uploadedAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function hasExactKeys<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,124}$/.test(value) }
function sha256(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }
function positiveSatang(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0 }
function boundedText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max && !/[\r\n\u0000]/.test(value) }
function nullableBoundedText(value: unknown, max: number): value is string | null { return value === null || boundedText(value, max) }
function isEnabledCategory(value: unknown): value is EnabledExpenseCategory {
  return value === 'BILL_DOCUMENT' || value === 'BOOK_CLINIC' || value === 'BOOK_DOCTOR_PERSONAL'
}
function nullableBookDailyKey(value: unknown): value is string | null {
  return value === null || /^(?:CLINIC|DOCTOR_PERSONAL):\d{4}-\d{2}-\d{2}$/.test(String(value))
}
function nullablePaymentMethod(value: unknown): value is ExpensePaymentMethod | null {
  return value === null || value === 'TRANSFER' || value === 'CASH' || value === 'CREDIT' || value === 'OTHER'
}
```

The implementation must order every union payload explicitly, reject unknown fields, require safe IDs (`^[A-Za-z0-9._:-]{1,124}$`), require 64-character lowercase SHA-256 values, and preserve attachment order by `ordinal`.

- [ ] **Step 4: Run shared contract tests and verify GREEN**

Run: `npx vitest run tests/pmc-mini-app/expenseIngressContract.test.ts tests/pmc-mini-app/expenseDomain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the signed contract**

```bash
git add shared/pmcMiniAppExpenseIngress.ts tests/pmc-mini-app/expenseIngressContract.test.ts
git commit -m "feat: define expense ingress contract"
```

### Task 3: Fail-Closed Finance Permissions and Private Workbook Topology

**Files:**
- Create: `apps/pmc-google-booking-ops/src/expense/sheetTopology.ts`
- Create: `apps/pmc-google-booking-ops/src/expense/setup.ts`
- Modify: `apps/pmc-google-booking-ops/src/config.ts`
- Modify: `apps/pmc-google-booking-ops/src/sheetSchema.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/sheetMigration.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleSheets.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Test: `apps/pmc-google-booking-ops/tests/expenseSetup.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/sheetMigration.test.ts`

**Interfaces:**
- Consumes: Task 1 expense types and existing `SheetStore`/`LockPort` patterns.
- Produces: `EXPENSE_MASTER_SCHEMAS`, `EXPENSE_MONTH_SCHEMAS`, `ensureFinanceMasterTopology()`, `ensureExpenseMonthTopology()`, `prepareExpensePermissionRoster()`, `applyExpensePermissionGrants()`, and finance fields on `StaffConfig`.

- [ ] **Step 1: Write failing migration, exact-topology, and grant tests**

```ts
import { describe, expect, it } from 'vitest'
import { staffConfigMigrationPlan } from '../src/domain/sheetMigration'
import { EXPENSE_MASTER_SCHEMAS, EXPENSE_MONTH_SCHEMAS } from '../src/expense/sheetTopology'
import { prepareExpensePermissionRoster } from '../src/expense/setup'

describe('expense finance setup', () => {
  it('appends finance columns in canonical order without changing existing values', () => {
    const existing = ['id','name','email','lineUserId','canCloseBooking','canBeAe','active','profileImageUrl','canManageStock']
    expect(staffConfigMigrationPlan(existing)).toEqual({
      kind: 'APPEND_FINANCE_PERMISSIONS', afterColumn: 9,
      headers: ['canSubmitExpense', 'canViewFinance', 'canManageExpense'],
    })
  })

  it('uses only the approved private finance tabs', () => {
    expect(Object.keys(EXPENSE_MASTER_SCHEMAS)).toEqual(['EXPENSE_MONTHLY_INDEX', 'EXPENSE_REQUESTS', 'EXPENSE_AUDIT'])
    expect(Object.keys(EXPENSE_MONTH_SCHEMAS)).toEqual(['EXPENSE_SUBMISSIONS', 'EXPENSE_ATTACHMENTS', 'MONTHLY_SUMMARY'])
  })

  it('returns only immutable IDs, names, active state, and finance flags in the review roster', () => {
    expect(prepareExpensePermissionRoster([{ id: 'ADMIN_01', name: 'มัส', email: 'secret@example.com', active: true } as never]))
      .toEqual([{ id: 'ADMIN_01', name: 'มัส', active: true, canSubmitExpense: false, canViewFinance: false, canManageExpense: false }])
  })
})
```

- [ ] **Step 2: Run setup tests and verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/expenseSetup.test.ts apps/pmc-google-booking-ops/tests/sheetMigration.test.ts`

Expected: FAIL because finance topology and permission migration do not exist.

- [ ] **Step 3: Add exact private schemas and staff columns**

```ts
export const EXPENSE_MONTHLY_INDEX_HEADERS = [
  'monthKey', 'ledgerSpreadsheetId', 'monthFolderId', 'createdAt', 'updatedAt',
] as const
export const EXPENSE_REQUEST_HEADERS = [
  'commandIdempotencyKey', 'rootRequestId', 'commandType', 'commandFingerprint',
  'expenseId', 'monthKey', 'recordState',
  'resultJson', 'createdAt', 'updatedAt',
] as const
export const EXPENSE_AUDIT_HEADERS = [
  'eventId', 'expenseId', 'actorStaffId', 'action', 'beforeJson', 'afterJson', 'createdAt', 'correlationId',
] as const
export const EXPENSE_SUBMISSION_HEADERS = [
  'expenseId','expenseDate','monthKey','category','scope','amountSatang','counterpartyName','description',
  'paymentMethod','recordState','bookDailyKey','revision','supersedesExpenseId','submittedByStaffId',
  'submittedByName','submittedAt','committedAt','updatedAt','version','idempotencyKey',
] as const
export const EXPENSE_ATTACHMENT_HEADERS = [
  'attachmentId','expenseId','ordinal','mediaType','originalFileName','privateFileId','sha256',
  'uploadedByStaffId','uploadedAt',
] as const
export const MONTHLY_SUMMARY_HEADERS = [
  'monthKey','scope','category','committedSatang','effectiveCount','calculatedAt','sourceHash',
] as const
```

The prerequisite report plan already appends these exact fields to `STAFF_CONFIG_COLUMNS`:

```ts
'canSubmitExpense', 'canViewFinance', 'canManageExpense'
```

This task must verify the canonical 12-column header and no-op when it is present. If this task is ever executed against the legacy nine-column header, the compatibility migration must append all three finance columns in one `APPEND_FINANCE_PERMISSIONS` operation and perform a final convergence readback. It must not use the older one-column-per-iteration loop.

Extend `StaffConfig`, Cloud Run staff parsing in later tasks, and Apps Script `createConfigPort()` so each missing/non-true value is `false`. Add script-property keys:

```ts
financeMasterSpreadsheetId: 'PMC_FINANCE_MASTER_SPREADSHEET_ID',
financeFolderId: 'PMC_FINANCE_FOLDER_ID',
expenseIngressSecret: 'PMC_EXPENSE_INGRESS_SECRET',
expenseSubmitterIds: 'PMC_EXPENSE_SUBMITTER_IDS',
financeManagerIds: 'PMC_FINANCE_MANAGER_IDS',
financePermissionCutoverApproved: 'PMC_FINANCE_PERMISSION_CUTOVER_APPROVED',
```

Keep these out of the Booking-wide `REQUIRED_PROPERTIES` list. Construct an optional expense config only inside expense setup/ingress entrypoints; missing finance properties must fail the expense feature closed without preventing Form, Booking, Calendar, LINE, or Stock runtime construction.

- [ ] **Step 4: Implement the fail-closed setup workflow**

`preparePmcExpensePermissions()` must return only `{id,name,active,canSubmitExpense,canViewFinance,canManageExpense}`. `applyPmcExpensePermissions()` must refuse to run unless `PMC_FINANCE_PERMISSION_CUTOVER_APPROVED=true`, parse unique safe staff IDs from the two comma-separated properties, require exactly three active manager IDs, require every manager ID in the submitter set, re-read `CONFIG_STAFF` under `LockService`, write only the three appended columns, and verify readback before returning `{submitterCount, managerCount: 3, changedRows}`.

`setupPmcExpenseFinanceStorage()` must verify that the configured master spreadsheet file is inside `PMC_FINANCE_FOLDER_ID`, validate exact headers, create only missing managed tabs, freeze header rows, and return only safe topology status/counts such as `{masterReady,createdTabCount,verifiedTabCount}`. It must not print or return spreadsheet IDs, folder IDs, Drive URLs, LINE IDs, or property values, including to the Apps Script operator console.

- [ ] **Step 5: Run Apps Script tests and build**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/expenseSetup.test.ts apps/pmc-google-booking-ops/tests/sheetMigration.test.ts`

Expected: PASS.

Run: `npm run booking:typecheck && npm run booking:build`

Expected: both commands exit 0 and `apps/pmc-google-booking-ops/dist/Code.js` exports `preparePmcExpensePermissions`, `applyPmcExpensePermissions`, and `setupPmcExpenseFinanceStorage`.

- [ ] **Step 6: Commit topology and permission setup**

```bash
git add apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests apps/pmc-google-booking-ops/scripts/build.mjs
git commit -m "feat: add private expense storage setup"
```

### Task 4: Apps Script Expense Repository, Book CAS, and Recovery Journal

**Files:**
- Create: `apps/pmc-google-booking-ops/src/expense/repository.ts`
- Create: `apps/pmc-google-booking-ops/src/expense/commands.ts`
- Create: `apps/pmc-google-booking-ops/src/expense/ingress.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Test: `apps/pmc-google-booking-ops/tests/expenseRepository.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/expenseIngress.test.ts`
- Test: `apps/pmc-google-booking-ops/tests/expenseRecovery.test.ts`

**Interfaces:**
- Consumes: shared domain and signed ingress contracts, Task 3 private topology and finance permissions.
- Produces: `ExpenseRepository`, `createGoogleExpenseRepository()`, `processExpenseIngressResponse()`, `runExpenseRecovery()`, and `MINI_APP_EXPENSE` handling in `processBookingDoPost()`.

- [ ] **Step 1: Write failing effective-revision, concurrent CAS, and idempotency tests**

```ts
it('serializes two first-book commits and keeps one effective total', () => {
  const first = commitBook({ rootRequestId: 'book-a', expectedRevision: 0, amountSatang: 10_000 })
  expect(first.revision).toBe(1)
  expect(() => commitBook({ rootRequestId: 'book-b', expectedRevision: 0, amountSatang: 20_000 }))
    .toThrow('EXPENSE_REVISION_CONFLICT')
  expect(repository.effectiveByBookDailyKey('CLINIC:2026-08-29')?.amountSatang).toBe(10_000)
})

it('returns the original receipt for the same idempotency command', () => {
  const first = commitBill({ rootRequestId: 'bill-retry-1' })
  expect(commitBill({ rootRequestId: 'bill-retry-1' })).toEqual(first)
})

it('never counts PREPARED, VOID, or superseded rows', () => {
  expect(repository.monthRows('2026-08').filter(({ recordState }) => recordState === 'COMMITTED'))
    .toHaveLength(1)
  expect(repository.monthlyProjection('2026-08').clinicCommittedSatang).toBe(12_000)
})
```

Also add tests that simulate failure after COMMIT audit append but before attachment/submission completion, then verify `runExpenseRecovery()` appends missing attachment rows once and commits once. Add the opposite test: stale PREPARED without a COMMIT audit becomes `VOID` with `ABANDON` after 48 hours.

- [ ] **Step 2: Run repository and ingress tests and verify RED**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/expenseRepository.test.ts apps/pmc-google-booking-ops/tests/expenseIngress.test.ts apps/pmc-google-booking-ops/tests/expenseRecovery.test.ts`

Expected: FAIL because the expense repository and command handler do not exist.

- [ ] **Step 3: Define the focused repository port**

```ts
export interface ExpenseRepository {
  ensureMonth(monthKey: string, createdAt: string): { ledgerSpreadsheetId: string; monthFolderId: string }
  reserveRequest(input: {
    commandIdempotencyKey: string; rootRequestId: string; commandType: MiniAppExpenseCommand['commandType']
    commandFingerprint: string; expenseId: string; monthKey: string; createdAt: string
  }): { state: 'RESERVED' | 'REPLAY'; expenseId: string; monthKey: string; resultJson: string | null }
  completeRequest(input: {
    commandIdempotencyKey: string; commandFingerprint: string; resultJson: string; updatedAt: string
  }): void
  getSubmission(monthKey: string, expenseId: string): ExpenseSubmission | null
  insertPrepared(submission: ExpenseSubmission): ExpenseSubmission
  updateSubmission(monthKey: string, expenseId: string, expectedVersion: number, patch: Partial<ExpenseSubmission>): ExpenseSubmission
  listMonth(monthKey: string): ExpenseSubmission[]
  listAttachments(monthKey: string, expenseId: string): ExpensePrivateAttachment[]
  appendAttachments(monthKey: string, attachments: ExpensePrivateAttachment[]): void
  effectiveByBookDailyKey(monthKey: string, bookDailyKey: string): ExpenseSubmission | null
  appendAudit(event: ExpenseAuditEvent): void
  auditForExpense(expenseId: string): ExpenseAuditEvent[]
  replaceMonthlySummary(monthKey: string, projection: ExpenseMonthlyProjection, calculatedAt: string): void
}
```

`EXPENSE_REQUESTS` is the global command-idempotency authority across every month. One stable browser `rootRequestId` derives phase keys `${rootRequestId}:prepare`, `${rootRequestId}:commit`, and `${rootRequestId}:void`. The same phase key plus the same canonical command fingerprint returns that phase's original result; the same phase key with a different fingerprint returns `EXPENSE_IDEMPOTENCY_CONFLICT` before resolving or creating any monthly ledger. PREPARE and COMMIT therefore never collide with each other. Do not scope lookup to `monthKey`.

The Google implementation must resolve a ledger only from `EXPENSE_MONTHLY_INDEX`, ensure the ledger file remains in the configured private finance folder, validate the exact month headers before every mutation, and never accept a workbook/folder ID from a command.

- [ ] **Step 4: Implement PREPARE and COMMIT journal ordering under one Apps Script lock**

`PREPARE_EXPENSE` must validate fields, derive scope/month/book key, require the signed `bookDailyKey` to equal the server derivation, allocate `EXP-<YYYYMM>-<UUID>`, reserve the global `:prepare` command key with the canonical command fingerprint, store `rootRequestId` as the submission's `idempotencyKey`, create revision `expectedRevision + 1` for books (or 1 for bills), append `PREPARE` audit containing `expectedAttachmentCount`, `expectedManifestHash`, and `expectedRevision`, then persist `PREPARED`. COMMIT separately reserves/completes the derived `:commit` command key. A replay resolves from `EXPENSE_REQUESTS`; a fingerprint mismatch fails before monthly storage access.

`COMMIT_EXPENSE` must execute this exact order under `LockService`:

```text
1. Re-read PREPARED and exact actor/idempotency/fingerprint.
2. Verify every private file is inside the configured month/expense folder.
3. Verify ordered attachment count and manifest hash.
4. For books, re-read effective bookDailyKey and compare exact expectedRevision.
5. Append one durable COMMIT audit whose afterJson contains the attachment descriptors.
6. Append only missing attachment rows by attachmentId.
7. Set the submission COMMITTED, committedAt, version+1, and supersedesExpenseId.
8. If replacing, append SUPERSEDE audit without mutating the prior row.
9. Rebuild MONTHLY_SUMMARY from effective committed rows.
10. Return the durable receipt; retry returns the same receipt.
```

If the effective revision differs at step 4, return `EXPENSE_REVISION_CONFLICT` without a COMMIT audit and without an effective total. Date, month, category, scope, and book key are never patchable. `VOID_EXPENSE` requires `canManageExpense`, preserves evidence, writes `VOID` audit, and recomputes the month summary.

- [ ] **Step 5: Implement HMAC/replay/role ingress and recovery**

Follow `stock/ingress.ts` for exact-key checks, five-minute timestamp tolerance, constant-time HMAC comparison, nonce replay storage, and safe errors. `PREPARE_EXPENSE` requires active `canSubmitExpense`; commit must use the same submitter identity; replacement and void require `canManageExpense`.

Recovery must read the bounded master audit index, inspect only months containing unresolved `PREPARE`, and:

```ts
if (commitAudit && privateFilesStillVerify) finishCommitIdempotently()
else if (ageHours >= 48) abandonPreparedAndKeepAudit()
```

Never delete evidence referenced by a `COMMITTED` or `VOID` expense. Return only counts and safe error codes from the operator entrypoint.

- [ ] **Step 6: Run tests, typecheck, and build**

Run: `npx vitest run apps/pmc-google-booking-ops/tests/expenseRepository.test.ts apps/pmc-google-booking-ops/tests/expenseIngress.test.ts apps/pmc-google-booking-ops/tests/expenseRecovery.test.ts`

Expected: PASS, including concurrent first commit, concurrent replacement, retry, conflict, partial-write recovery, and abandonment cases.

Run: `npm run booking:typecheck && npm run booking:build`

Expected: exit 0.

- [ ] **Step 7: Commit Apps Script mutation authority**

```bash
git add shared apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests
git commit -m "feat: add expense mutation authority"
```

### Task 5: Cloud Run Staging, Pixel Validation, and Staff-Bound Receipts

**Files:**
- Create: `server/pmc-mini-app/finance/stagingStore.ts`
- Create: `server/pmc-mini-app/finance/stagingToken.ts`
- Create: `server/pmc-mini-app/finance/multipart.ts`
- Test: `tests/pmc-mini-app/expenseStaging.test.ts`
- Test: `tests/pmc-mini-app/expenseMultipart.test.ts`

**Interfaces:**
- Consumes: existing GCS patterns in `server/pmc-mini-app/stagingStore.ts`, `sharp`, and the Task 1 image MIME contract.
- Produces: `ExpenseStagingPort`, `ExpenseStagingReceipt`, `createGoogleExpenseStagingPort()`, `signExpenseStagingReceipt()`, `verifyExpenseStagingReceipt()`, and `consumeExpenseMultipart()`.

- [ ] **Step 1: Write failing limits, order, token binding, and retry tests**

```ts
it('preserves one-to-five image order and rejects a sixth file', async () => {
  const batch = await parseExpenseFiles([jpeg(100, 100), png(200, 100)])
  expect(batch.files.map(({ ordinal }) => ordinal)).toEqual([1, 2])
  await expect(parseExpenseFiles(Array.from({ length: 6 }, () => jpeg(10, 10))))
    .rejects.toMatchObject({ code: 'EXPENSE_FILE_LIMIT' })
})

it('rejects an image over twenty megapixels before decode-heavy work', async () => {
  await expect(parseExpenseFiles([jpegHeader(5_001, 4_000)]))
    .rejects.toMatchObject({ code: 'EXPENSE_PIXEL_LIMIT' })
})

it('binds staging tokens to staff and idempotency key', () => {
  const token = signReceipt({ staffId: 'ADMIN_01', rootRequestId: 'expense-1', ordinal: 1 })
  expect(() => verifyReceipt(token, { staffId: 'ADMIN_02', rootRequestId: 'expense-1' }))
    .toThrow('EXPENSE_STAGING_TOKEN_INVALID')
})
```

- [ ] **Step 2: Run staging tests and verify RED**

Run: `npx vitest run tests/pmc-mini-app/expenseStaging.test.ts tests/pmc-mini-app/expenseMultipart.test.ts`

Expected: FAIL because finance staging modules do not exist.

- [ ] **Step 3: Implement deterministic GCS keys and strict multipart parsing**

Use object keys:

```text
expenses/<rootRequestId>/<ordinal>-<sha256>.<jpg|png>
```

The port returns `{objectKey,sizeBytes,mimeType,sha256,ordinal,originalFileName,createdAt}`. Create-only writes must verify metadata on conflict. `sharp(bytes).metadata()` must confirm width, height, safe integer dimensions, `width * height <= 20_000_000`, and MIME/header agreement before staging. Reject zero bytes, unknown fields, duplicate ordinals, more than five files, any file over `10_000_000`, or aggregate bytes over `25_000_000`.

The browser receives an HMAC token containing only `version`, `objectKey`, `staffId`, `rootRequestId`, `ordinal`, `sha256`, and `expiresAt`; it never receives the bucket name. Verification requires the current staff ID and root request ID and rejects tokens older than 24 hours.

- [ ] **Step 4: Run staging tests and verify GREEN**

Run: `npx vitest run tests/pmc-mini-app/expenseStaging.test.ts tests/pmc-mini-app/expenseMultipart.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit bounded staging**

```bash
git add server/pmc-mini-app/finance/stagingStore.ts server/pmc-mini-app/finance/stagingToken.ts server/pmc-mini-app/finance/multipart.ts tests/pmc-mini-app/expenseStaging.test.ts tests/pmc-mini-app/expenseMultipart.test.ts
git commit -m "feat: stage expense evidence safely"
```

### Task 6: Private Finance Google Ports and Expense Submission Service

**Files:**
- Create: `server/pmc-mini-app/finance/config.ts`
- Create: `server/pmc-mini-app/finance/googleClient.ts`
- Create: `server/pmc-mini-app/finance/ingressClient.ts`
- Create: `server/pmc-mini-app/finance/submissionService.ts`
- Modify: `server/pmc-mini-app/config.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Test: `tests/pmc-mini-app/expenseRuntimeConfig.test.ts`
- Test: `tests/pmc-mini-app/expenseGoogleClient.test.ts`
- Test: `tests/pmc-mini-app/expenseIngressClient.test.ts`
- Test: `tests/pmc-mini-app/expenseSubmissionService.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5 contracts, existing Mini App Google scopes, the existing Apps Script deployment URL, and a distinct expense-ingress HMAC secret.
- Produces: `PmcFinanceConfig`, `FinanceGooglePorts`, `ExpenseIngressClient`, `ExpenseSubmissionService`, and `submitExpense()`.

- [ ] **Step 1: Write failing fail-closed config and orchestration tests**

```ts
it('keeps finance disabled when one private binding is missing', () => {
  expect(readPmcFinanceConfig({ PMC_EXPENSE_CAPTURE_ENABLED: 'true' })).toBeNull()
})

it('retries a lost COMMIT response without creating a second receipt', async () => {
  ingress.commit.mockRejectedValueOnce(new ExpenseIngressClientError('EXPENSE_STORAGE_UNAVAILABLE'))
    .mockResolvedValueOnce(committedReceipt)
  await expect(service.submit(input)).rejects.toMatchObject({ code: 'EXPENSE_STORAGE_UNAVAILABLE' })
  await expect(service.submit(input)).resolves.toEqual(committedReceipt)
  expect(ingress.prepare).toHaveBeenCalledTimes(2)
  expect(drive.uploadExpenseImage).toHaveBeenCalledTimes(4)
  expect(new Set(drive.uploadExpenseImage.mock.calls.map(([arg]) => arg.deterministicName)).size).toBe(2)
})
```

- [ ] **Step 2: Run Cloud Run service tests and verify RED**

Run: `npx vitest run tests/pmc-mini-app/expenseRuntimeConfig.test.ts tests/pmc-mini-app/expenseGoogleClient.test.ts tests/pmc-mini-app/expenseIngressClient.test.ts tests/pmc-mini-app/expenseSubmissionService.test.ts`

Expected: FAIL because finance runtime modules do not exist.

- [ ] **Step 3: Implement exact finance configuration**

```ts
export interface PmcFinanceConfig {
  captureEnabled: boolean
  readsEnabled: boolean
  masterSpreadsheetId: string
  folderId: string
  stagingBucketName: string
  expenseIngressUrl: string
  expenseIngressSecret: string
}
```

Read exactly `PMC_EXPENSE_CAPTURE_ENABLED`, `PMC_FINANCE_READS_ENABLED`, `PMC_FINANCE_MASTER_SPREADSHEET_ID`, `PMC_FINANCE_FOLDER_ID`, `PMC_FINANCE_STAGING_BUCKET`, `PMC_EXPENSE_INGRESS_URL`, and `PMC_EXPENSE_INGRESS_SECRET`. If either feature flag is true, every finance identifier and ingress binding must be valid or finance construction returns `null`; the rest of the Mini App remains available. The expense URL may resolve to the existing Apps Script deployment, but the expense HMAC secret is distinct from `PMC_BOOKING_INGRESS_SECRET`. Reuse `PMC_MINI_APP_SIGNING_SECRET` only for short-lived browser tokens. Missing finance properties must never break Form or Booking runtime construction.

- [ ] **Step 4: Implement allowlisted private Drive and Sheet operations**

`FinanceGooglePorts` must expose:

```ts
export interface FinanceGooglePorts {
  readMaster(ranges: string[]): Promise<Record<string, unknown[][]>>
  readMonth(monthKey: string, ranges: string[]): Promise<Record<string, unknown[][]>>
  ensureExpenseFolder(monthKey: string, expenseId: string): Promise<string>
  uploadExpenseImage(input: {
    monthKey: string; expenseId: string; parentId: string; deterministicName: string
    bytes: Buffer; mimeType: 'image/jpeg' | 'image/png'; ordinal: number; sha256: string
  }): Promise<string>
  verifyExpenseFile(input: { monthKey: string; expenseId: string; fileId: string }): Promise<void>
  downloadExpenseFile(input: { monthKey: string; expenseId: string; fileId: string }): Promise<{
    bytes: Buffer; mimeType: 'image/jpeg' | 'image/png'
  }>
}
```

`readMonth` must resolve the candidate spreadsheet only from `EXPENSE_MONTHLY_INDEX`; no caller supplies an ID. Folder/file operations must walk parent ancestry to `PMC_FINANCE_FOLDER_ID`, reject trashed objects, and use deterministic create-only names `NNN-<sha256>.<ext>` so a retry resolves the existing verified file rather than duplicating it.

- [ ] **Step 5: Implement the signed ingress client and service order**

Follow `stock/ingressClient.ts` for canonical HMAC, timeout, strict response parsing, and safe error mapping. The service performs:

```ts
const prepared = await ingress.prepare(buildPrepareCommand({
  ...input,
  commandIdempotencyKey: `${input.rootRequestId}:prepare`,
}))
const folderId = await finance.ensureExpenseFolder(prepared.monthKey, prepared.expenseId)
const attachments = await persistAndVerifyStagedImages(folderId, prepared, stagingReceipts)
const receipt = await ingress.commit(buildCommit({
  rootRequestId: input.rootRequestId,
  commandIdempotencyKey: `${input.rootRequestId}:commit`,
  prepared,
  attachments,
}))
await Promise.allSettled(stagingReceipts.map(({ objectKey }) => staging.deleteVerified(objectKey)))
return receipt
```

The manifest hash is SHA-256 over canonical ordered `{ordinal,mimeType,originalFileName,sha256}` values. A staging cleanup failure after commit must not change the successful receipt. Any earlier failure leaves PREPARED out of reports and preserves typed client state for retry.

- [ ] **Step 6: Run service tests and build**

Run: `npx vitest run tests/pmc-mini-app/expenseRuntimeConfig.test.ts tests/pmc-mini-app/expenseGoogleClient.test.ts tests/pmc-mini-app/expenseIngressClient.test.ts tests/pmc-mini-app/expenseSubmissionService.test.ts`

Expected: PASS.

Run: `npm run build:server`

Expected: exit 0.

- [ ] **Step 7: Commit private finance orchestration**

```bash
git add server/pmc-mini-app/finance server/pmc-mini-app/config.ts server/pmc-mini-app/runtime.ts tests/pmc-mini-app
git commit -m "feat: orchestrate expense submissions"
```

### Task 7: Submit-Only and Finance-Only APIs

**Files:**
- Create: `server/pmc-mini-app/finance/readStore.ts`
- Create: `server/pmc-mini-app/finance/evidenceToken.ts`
- Create: `server/pmc-mini-app/finance/middleware.ts`
- Modify: `server/pmc-mini-app/contracts.ts`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Test: `tests/pmc-mini-app/expenseReadStore.test.ts`
- Test: `tests/pmc-mini-app/expenseSecurity.test.ts`
- Test: `tests/pmc-mini-app/expenseApi.test.ts`

**Interfaces:**
- Consumes: Task 6 service/Google ports and Task 1 monthly projection.
- Produces: `FinanceReadStore`, `FinanceServerDependencies`, `/api/mini-app/expenses/*`, `/api/mini-app/finance/*`, and finance permission booleans in authenticated/config projections.

- [ ] **Step 1: Write failing permission-matrix and bounded-read tests**

```ts
it.each([
  ['unknown', null, 403],
  ['active without submit', { canSubmitExpense: false, canViewFinance: false }, 403],
  ['submit-only', { canSubmitExpense: true, canViewFinance: false }, 200],
])('enforces submit permission for %s', async (_label, staff, status) => {
  expect((await postExpense(staff)).statusCode).toBe(status)
})

it('denies history and evidence to submit-only staff', async () => {
  expect((await getHistory(submitOnlyStaff)).statusCode).toBe(403)
  expect((await getEvidence(submitOnlyStaff)).statusCode).toBe(403)
})

it('reads exactly one selected month for finance staff', async () => {
  await getMonthly(financeStaff, '2026-08')
  expect(financeGoogle.readMonth).toHaveBeenCalledTimes(1)
  expect(financeGoogle.readMonth).toHaveBeenCalledWith('2026-08', expect.any(Array))
})
```

- [ ] **Step 2: Run API/security tests and verify RED**

Run: `npx vitest run tests/pmc-mini-app/expenseReadStore.test.ts tests/pmc-mini-app/expenseSecurity.test.ts tests/pmc-mini-app/expenseApi.test.ts`

Expected: FAIL because finance APIs are not mounted.

- [ ] **Step 3: Verify and consume the prerequisite finance identity fields**

The prerequisite revenue plan already added these booleans to `MiniAppStaffRecord` and `AuthenticatedMiniAppContext` and changed the range to `"'CONFIG_STAFF'!A2:L"`:

```ts
canSubmitExpense: boolean
canViewFinance: boolean
canManageExpense: boolean
```

Add regression assertions—not a second schema/parser implementation—that the exact prerequisite fields remain fail-closed, literal true/`true`/`1` parsing is unchanged, and `/api/mini-app/config` returns only permission booleans rather than LINE user ID or finance resource IDs. Task 7 only adds `FinanceServerDependencies` and route authorization that consumes `AuthenticatedMiniAppContext`; if the canonical fields are absent, stop and complete the prerequisite plan instead of creating competing names.

- [ ] **Step 4: Implement exact route permissions and responses**

```text
POST /api/mini-app/expenses/staging/:rootRequestId      canSubmitExpense
POST /api/mini-app/expenses                             canSubmitExpense
GET  /api/mini-app/finance/months/:YYYY-MM/expenses     canViewFinance
GET  /api/mini-app/finance/expenses?month=YYYY-MM       canViewFinance
POST /api/mini-app/finance/expenses/:id/evidence/:aid/token canViewFinance
GET  /api/mini-app/finance/evidence?token=<short-lived> canViewFinance + matching token staff
POST /api/mini-app/finance/expenses/:id/replace         canManageExpense
POST /api/mini-app/finance/expenses/:id/void            canManageExpense
```

The submit response is exactly `ExpenseReceipt`. No submitter list/search/detail route exists. History is newest-first with cursor `submittedAt|expenseId`, page size 25, and one month required. The token endpoint first proves attachment membership and returns an HMAC token valid for five minutes, bound to `staffId + monthKey + expenseId + attachmentId`. The download endpoint still requires the verified LINE bearer identity, `canViewFinance`, and the same bound staff ID; a token alone is never sufficient. It re-proves attachment membership, then streams `Cache-Control: private, no-store` bytes. Private file IDs and Drive URLs never appear in JSON.

History serializes only `ExpenseHistoryRow`; it must strip `submittedByStaffId`, `idempotencyKey`, `privateFileId`, SHA-256 storage hashes, workbook/folder IDs, and audit JSON before returning browser data.

- [ ] **Step 5: Implement the monthly expense projection interface**

```ts
export interface FinanceReadStore {
  loadMonthlyExpenses(monthKey: string): Promise<ExpenseMonthlyProjection>
  listExpenseHistory(monthKey: string, cursor: string | null, limit: 25): Promise<ExpenseHistoryPage>
  getEvidence(monthKey: string, expenseId: string, attachmentId: string): Promise<{
    bytes: Buffer; mimeType: 'image/jpeg' | 'image/png'
  } | null>
}
```

`evidenceToken.ts` must export `signFinanceEvidenceToken()` and `verifyFinanceEvidenceToken()` using `PMC_MINI_APP_SIGNING_SECRET`, a five-minute expiry, exact-key parsing, constant-time signature comparison, and the authenticated finance staff ID as required verification context.

`loadMonthlyExpenses()` must derive totals from effective `COMMITTED` rows in `EXPENSE_SUBMISSIONS`, not from the thin master index. Doctor-personal totals remain a separate field and are never subtracted from clinic balance by this subsystem.

- [ ] **Step 6: Run API/security tests and server build**

Run: `npx vitest run tests/pmc-mini-app/expenseReadStore.test.ts tests/pmc-mini-app/expenseSecurity.test.ts tests/pmc-mini-app/expenseApi.test.ts tests/pmc-mini-app/security.test.ts tests/pmc-mini-app/defaultApiStability.test.tsx`

Expected: PASS, including direct evidence 403 and one-month bounded reads.

Run: `npm run build:server`

Expected: exit 0.

- [ ] **Step 7: Commit the permission boundary and APIs**

```bash
git add server/pmc-mini-app src/apps/pmc-mini-app/contracts.ts tests/pmc-mini-app
git commit -m "feat: expose private expense APIs"
```

### Task 8: Mini App Expense Capture and Durable Receipt

**Files:**
- Create: `src/apps/pmc-mini-app/expense/expenseModel.ts`
- Create: `src/apps/pmc-mini-app/expense/ExpenseCards.tsx`
- Create: `src/apps/pmc-mini-app/expense/ExpenseForm.tsx`
- Create: `src/apps/pmc-mini-app/expense/ExpenseReceipt.tsx`
- Modify: `src/apps/pmc-mini-app/contracts.ts`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Modify: `src/apps/pmc-mini-app/FinanceReportHome.tsx`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/preview.ts`
- Modify: `src/apps/pmc-mini-app/styles.css`
- Test: `tests/pmc-mini-app/expenseModel.test.ts`
- Test: `tests/pmc-mini-app/expenseForm.test.tsx`
- Test: `tests/pmc-mini-app/expenseReceipt.test.tsx`
- Test: `tests/pmc-mini-app/clientShell.test.tsx`

**Interfaces:**
- Consumes: Task 7 submit APIs and `ExpenseReceipt`.
- Produces: `ExpenseCards`, `ExpenseForm`, `ExpenseReceiptView`, `ExpenseFormAdapter`, and Mini App expense routes.

- [ ] **Step 1: Run modern web guidance before client implementation**

Run: `npx -y modern-web-guidance@latest search "mobile LINE Mini App multipart image form accessible file input retry state" --skill-version 2026_05_16-c5e78707`

Expected: command exits 0; apply only guidance compatible with the approved spec and current React/Vite stack.

- [ ] **Step 2: Write failing form, deferred-card, retry, and receipt tests**

```tsx
it('shows three active and three deferred expense cards', () => {
  render(<ExpenseCards canSubmitExpense onSelect={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'บิลเอกสาร' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'สมุดรายจ่ายภายในคลินิก' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'สมุดรายจ่ายส่วนตัวหมอ' })).toBeEnabled()
  expect(screen.getByText('เงินเดือนพนักงาน')).toHaveTextContent('เตรียมระบบ')
  expect(screen.queryByRole('button', { name: 'เงินเดือนพนักงาน' })).not.toBeInTheDocument()
})

it('keeps typed values and selected files when upload fails', async () => {
  const adapter = failingStageAdapter()
  render(<ExpenseForm category="BILL_DOCUMENT" adapter={adapter} onCommitted={vi.fn()} onBack={vi.fn()} />)
  await user.type(screen.getByLabelText('จำนวนเงิน'), '1200')
  await user.type(screen.getByLabelText('ชื่อร้านหรือผู้รับเงิน'), 'ร้านทดสอบ')
  await user.upload(screen.getByLabelText('รูปหลักฐาน'), [imageFile('a.jpg'), imageFile('b.jpg')])
  await user.click(screen.getByRole('button', { name: 'ตรวจสอบข้อมูล' }))
  await user.click(screen.getByRole('button', { name: 'ยืนยันบันทึก' }))
  expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue('1200')
  expect(screen.getByText('เลือกแล้ว 2 รูป')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run client tests and verify RED**

Run: `npx vitest run tests/pmc-mini-app/expenseModel.test.ts tests/pmc-mini-app/expenseForm.test.tsx tests/pmc-mini-app/expenseReceipt.test.tsx tests/pmc-mini-app/clientShell.test.tsx`

Expected: FAIL because expense client components do not exist.

- [ ] **Step 4: Implement exact form behavior**

`ExpenseFormAdapter` is:

```ts
export interface ExpenseFormAdapter {
  stage(rootRequestId: string, files: File[]): Promise<{ stagingTokens: string[] }>
  submit(input: {
    rootRequestId: string; category: EnabledExpenseCategory; expenseDate: string
    amountSatang: number; counterpartyName: string | null; description: string
    paymentMethod: ExpensePaymentMethod | null; expectedRevision: number; stagingTokens: string[]
  }): Promise<ExpenseReceipt>
}
```

Bill fields are date, amount, counterparty, payment method, optional note, and one-to-five images. Book fields are date, daily total, optional note, and one-to-five images; counterparty and payment method are omitted. Generate one stable `crypto.randomUUID()` root request ID when the form opens and reuse it across stage/submit retries. The server derives the exact `:prepare` and `:commit` command keys; the browser never invents phase keys. Show ordered thumbnails, remove/reorder controls, total selected count, a review screen, and a disabled busy submit button. Render `COMMITTED` as `บันทึกแล้ว — ยังไม่ผ่านการตรวจสอบ` with the durable receipt number.

On `EXPENSE_REVISION_CONFLICT`, submit-only staff see `มีรายการของวันนี้แล้ว กรุณาแจ้งผู้ดูแล`; finance managers receive a reload/replace action from Task 9. No success is shown until the `ExpenseReceipt` response is parsed.

- [ ] **Step 5: Run client tests and Mini App build**

Run: `npx vitest run tests/pmc-mini-app/expenseModel.test.ts tests/pmc-mini-app/expenseForm.test.tsx tests/pmc-mini-app/expenseReceipt.test.tsx tests/pmc-mini-app/clientShell.test.tsx`

Expected: PASS.

Run: `npm run build:mini-app`

Expected: exit 0.

- [ ] **Step 6: Commit submit-only UI**

```bash
git add src/apps/pmc-mini-app tests/pmc-mini-app
git commit -m "feat: add expense capture flow"
```

### Task 9: Finance History, Evidence, Replacement, and Monthly Integration

**Files:**
- Create: `src/apps/pmc-mini-app/expense/ExpenseHistory.tsx`
- Create: `src/apps/pmc-mini-app/expense/MonthlyExpensePanel.tsx`
- Modify: `src/apps/pmc-mini-app/api.ts`
- Modify: `src/apps/pmc-mini-app/PmcMiniApp.tsx`
- Modify: `src/apps/pmc-mini-app/MonthlyFinancePage.tsx`
- Modify: `src/apps/pmc-mini-app/styles.css`
- Test: `tests/pmc-mini-app/expenseHistory.test.tsx`
- Test: `tests/pmc-mini-app/monthlyExpensePanel.test.tsx`
- Test: `tests/pmc-mini-app/reportSafety.test.tsx`

**Interfaces:**
- Consumes: Task 7 finance-only APIs and Task 8 capture form.
- Produces: finance-only history/evidence screens and `MonthlyExpensePanel` for composition by the monthly income report implementation.

- [ ] **Step 1: Write failing finance visibility and monthly-separation tests**

```tsx
it('keeps doctor-personal expense separate from clinic balance inputs', async () => {
  render(<MonthlyExpensePanel projection={{
    monthKey: '2026-08', clinicCommittedSatang: 120_000,
    doctorPersonalCommittedSatang: 50_000,
    clinicByCategorySatang: { BILL_DOCUMENT: 100_000, BOOK_CLINIC: 20_000 },
    effectiveExpenseCount: 4, unreviewed: true,
  }} />)
  expect(screen.getByText('รายจ่ายคลินิก')).toHaveTextContent('1,200.00')
  expect(screen.getByText('รายจ่ายส่วนตัวหมอ')).toHaveTextContent('500.00')
  expect(screen.getByText('ยังไม่ผ่านการตรวจสอบ')).toBeInTheDocument()
})

it('requires an explicit replace action and current expected revision', async () => {
  render(<ExpenseHistory canManageExpense page={bookHistoryPage} adapter={adapter} />)
  await user.click(screen.getByRole('button', { name: 'แทนที่ยอดเดิม' }))
  expect(adapter.replace).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }))
})
```

- [ ] **Step 2: Run finance UI tests and verify RED**

Run: `npx vitest run tests/pmc-mini-app/expenseHistory.test.tsx tests/pmc-mini-app/monthlyExpensePanel.test.tsx tests/pmc-mini-app/reportSafety.test.tsx`

Expected: FAIL because finance components do not exist.

- [ ] **Step 3: Implement bounded finance history and private evidence access**

History requires one `YYYY-MM`, shows effective and void records with clear state labels, paginates 25 rows, and never fetches another month automatically. Evidence thumbnails first request a five-minute viewer-bound token, then use the authenticated bearer token plus that token for blob fetches; object URLs are revoked on unmount. Show replace and void only when `canManageExpense=true`; replacement opens the same book form with `expectedRevision` from the current effective row, while cross-date/month/category/scope correction requires void then new submission.

- [ ] **Step 4: Implement monthly-expense composition boundary**

`MonthlyExpensePanel` renders clinic recorded expense, category split, separate restricted doctor-personal total, effective count, and `ยังไม่ผ่านการตรวจสอบ`. Export this exact prop contract:

```ts
export interface MonthlyExpensePanelProps {
  projection: ExpenseMonthlyProjection | null
  loading?: boolean
  error?: 'EMPTY' | 'UNAVAILABLE' | null
  onOpenHistory?: () => void
}
```

The prerequisite monthly income report composes this panel and computes `ยอดคงเหลือโดยประมาณ` as `monthlyNetIncomeSatang - clinicCommittedSatang`; it must never subtract `doctorPersonalCommittedSatang`. Integrate only through this prop and avoid moving expense logic into JERA modules.

- [ ] **Step 5: Run finance UI tests and build**

Run: `npx vitest run tests/pmc-mini-app/expenseHistory.test.tsx tests/pmc-mini-app/monthlyExpensePanel.test.tsx tests/pmc-mini-app/reportSafety.test.tsx`

Expected: PASS.

Run: `npm run build:mini-app`

Expected: exit 0.

- [ ] **Step 6: Commit finance-only views**

```bash
git add src/apps/pmc-mini-app/expense src/apps/pmc-mini-app/api.ts src/apps/pmc-mini-app/PmcMiniApp.tsx src/apps/pmc-mini-app/MonthlyFinancePage.tsx src/apps/pmc-mini-app/styles.css tests/pmc-mini-app
git commit -m "feat: add expense finance views"
```

### Task 10: Recovery Worker, Full Regression, and Safe Pilot Rollout

**Files:**
- Create: `server/pmc-mini-app/finance/recovery.ts`
- Create: `scripts/check-pmc-expense-runtime.mjs`
- Create: `docs/pmc-mini-app/expense-capture-runbook.md`
- Modify: `server/pmc-mini-app/middleware.ts`
- Modify: `server/pmc-mini-app/runtime.ts`
- Modify: `server/productionApp.ts`
- Modify: `tests/pmc-mini-app/browserAcceptance.spec.ts`
- Test: `tests/pmc-mini-app/expenseRecoveryRoute.test.ts`
- Test: `tests/pmc-mini-app/browserAcceptance.spec.ts`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: authenticated `/internal/mini-app/recover-expenses`, read-only runtime checker, tested rollback procedure, and release evidence.

- [ ] **Step 1: Write failing worker-auth, abandonment, and browser acceptance tests**

Add worker route tests proving missing/invalid Google OIDC bearer tokens return 401, a valid configured task-invoker identity reaches recovery, and the public Mini App cannot call the route. Extend browser acceptance with:

```text
Report home -> Bill document -> two images -> review -> durable receipt
Report home -> Clinic book -> daily total -> two images -> durable receipt
Submit-only account -> expense history/evidence direct URL -> 403
Finance account -> monthly expense -> history -> private evidence
Finance account -> existing book -> replace with expected revision
Android-sized viewport -> lost first submit response -> retry -> same receipt
```

- [ ] **Step 2: Run recovery/browser tests and verify RED**

Run: `npx vitest run tests/pmc-mini-app/expenseRecoveryRoute.test.ts`

Expected: FAIL because the recovery route is not mounted.

- [ ] **Step 3: Implement authenticated recovery and read-only checker**

Reuse `createWorkerIdentityVerifier()` and a dedicated Cloud Tasks/Scheduler target URL ending `/internal/mini-app/recover-expenses`. The handler calls signed Apps Script recovery, returns only `{recovered,abandoned,unchanged,failed}`, and logs only correlation IDs and safe codes.

`scripts/check-pmc-expense-runtime.mjs` must verify without mutation:

```text
health endpoint 200
client config contains booleans but no finance IDs
expense flags and required private bindings are coherent
submit-only direct history/evidence receives 403
finance month read requests one month only
staging bucket lifecycle is 1 day
recovery identity/audience is configured
Apps Script finance topology and permission columns match expected headers
```

- [ ] **Step 4: Run all automated verification**

Run: `npx vitest run tests/pmc-mini-app`

Expected: all Mini App tests PASS.

Run: `npm run booking:test`

Expected: all Apps Script/Booking tests PASS.

Run: `npm run ocr:test`

Expected: all existing OCR tests PASS; no OCR expense route is enabled.

Run: `npm test`

Expected: full repository suite PASS.

Run: `npm run build && npm run lint`

Expected: build and lint exit 0.

Run: `npx playwright test -c playwright.mini-app.config.ts tests/pmc-mini-app/browserAcceptance.spec.ts`

Expected: all Mini App browser acceptance cases PASS.

- [ ] **Step 5: Write the exact runbook and execute the disabled-feature preflight**

The runbook must require this order:

```text
1. Deploy Cloud Run and Apps Script code with both finance flags false.
2. Configure the private finance folder, finance master workbook, staging bucket, existing Apps Script deployment URL, and a distinct expense-ingress HMAC secret in both Secret Manager/Cloud Run and Apps Script properties; do not reuse the Booking ingress secret.
3. Apply a GCS lifecycle rule that deletes expense staging objects after 1 day.
4. Run setupPmcExpenseFinanceStorage and verify exact headers/readback.
5. Run the compatible CONFIG_STAFF migration; verify every new flag is false.
6. Run preparePmcExpensePermissions and obtain owner approval of IDs/names.
7. Set explicit submitter/three-manager ID properties and cutover approval; run applyPmcExpensePermissions.
8. Enable PMC_FINANCE_READS_ENABLED for the three managers only and run the read-only checker.
9. Grant canSubmitExpense initially only to those three IDs; enable PMC_EXPENSE_CAPTURE_ENABLED.
10. Submit one bill, one clinic-book day, one doctor-personal day, one duplicate-book conflict, and one lost-response retry.
11. Verify monthly clinic expense excludes doctor-personal and every receipt has private evidence.
12. Obtain owner approval, then grant canSubmitExpense to additional explicitly reviewed staff IDs.
```

Rollback is exactly: set `PMC_EXPENSE_CAPTURE_ENABLED=false` and `PMC_FINANCE_READS_ENABLED=false`, redeploy, leave private ledgers/evidence untouched, run recovery once for existing PREPARED rows, and confirm Booking/Stock/reports remain healthy. No rollback step deletes committed, voided, or prepared finance data.

- [ ] **Step 6: Commit verification and operations assets**

```bash
git add server/pmc-mini-app/finance/recovery.ts server/pmc-mini-app/middleware.ts server/pmc-mini-app/runtime.ts server/productionApp.ts scripts/check-pmc-expense-runtime.mjs docs/pmc-mini-app/expense-capture-runbook.md tests/pmc-mini-app
git commit -m "test: verify expense capture rollout"
```

## Plan Self-Review

- Spec coverage: dedicated finance master/month ledgers, staff permissions, three enabled categories, multi-image staging, PREPARED/COMMITTED recovery, book revision CAS, private evidence, bounded finance reads, monthly clinic/personal separation, deferred OCR/approval/payroll/DF, and rollback all map to Tasks 1-10.
- Placeholder scan: no implementation step depends on an undefined category, state, route, permission, storage tab, or command result.
- Type consistency: `ExpenseMonthlyProjection`, `ExpenseReceipt`, `ExpenseHistoryRow`, `ExpensePrivateAttachment`, `MiniAppExpenseCommand`, and the three finance permission names are defined once in Tasks 1-2 and consumed unchanged later.
- Mutation boundary: Cloud Run stages/uploads and sends signed commands; only Apps Script changes financial rows under `LockService`.
- Privacy boundary: submit-only users receive only their current receipt; finance history/evidence requires `canViewFinance`; private IDs remain server-side.
