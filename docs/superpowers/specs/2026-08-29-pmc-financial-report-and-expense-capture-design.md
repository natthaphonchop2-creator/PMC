# PMC Financial Reports and Expense Capture Design

**Date:** 2026-08-29
**Status:** Approved by owner; pending implementation plan
**Audience:** PMC owner, doctor, Mus, and internal staff

## 1. Goal

Replace the current report catalog in the PMC LINE Mini App with a simpler finance-first workflow:

1. a daily income report with historical date selection;
2. a monthly income and recorded-expense report; and
3. a lightweight expense-document intake surface for internal staff.

The first release builds the operational structure without OCR, approval workflow, payroll calculation, employee DF calculation, or doctor DF calculation. Those capabilities remain explicit later phases.

## 2. Approved Product Decisions

- The report home has two primary cards: `รายรับรายวัน` and `รายงานรายเดือน`.
- Expense-capture cards appear below the primary report cards.
- Daily income uses received payments as the authoritative headline amount.
- Procedure/service and product amounts are analytical partitions of the same revenue, never additive revenue sources.
- Course revenue is grouped with procedure/service.
- Payment channels are presented as `โอน`, `สด`, `Credit`, and `อื่น ๆ`.
- `อื่น ๆ` combines e-wallet, payment link, vouchers, points, social-security, and other provider payment buckets.
- Daily history supports a single day and an explicit historical date range of at most 31 days.
- The monthly report shows income, recorded expenses, and an estimated balance.
- Until approval exists, expense totals are labeled `ยังไม่ผ่านการตรวจสอบ` and the balance is labeled `โดยประมาณ`.
- The two physical expense books are captured as one daily total plus one or more page images.
- Each book has at most one active committed total per Bangkok calendar day. A correction creates a new revision and supersedes the previous committed record rather than adding another daily total.
- Staff can submit expense evidence but cannot view monthly finance details or expense history.
- Monthly finance reports, expense history, and doctor-personal evidence are visible only to the owner, doctor, and Mus.
- Approval workflow, OCR, payroll, DF, and accounting-provider posting are deferred.

## 3. Current-State Constraints

- The existing report UI exposes 14 provider-oriented report selections rather than the approved finance-first navigation.
- PAYMENT already provides authoritative received totals and payment-method buckets.
- PRODUCT_SALES and OPD overlap PAYMENT economically and must not be added to PAYMENT.
- PRODUCT_SALES, PRODUCT_USE, and OPD are analysis views, not independent cash ledgers.
- Product/service source labels are provider values such as `medicine`, `service`, and `course`; the production labels must be profiled before final category naming is considered fully reconciled.
- The current report cache and Mini App schema contain no expense, payroll, or DF ledger.
- The existing OCR Ledger is reusable as a later extraction engine, but it is not production-approved for this workflow, supports a single image record, and has authorization rules that are too broad for financial and compensation data.
- Stock remains quantity-only and must not be used as an expense or inventory-valuation source.

## 4. Scope

### 4.1 Daily income

The daily income page contains:

- date controls for today, yesterday, and historical selection;
- received total;
- refund total;
- net received amount;
- procedure/service amount;
- product amount;
- unclassified or reconciliation difference;
- transfer, cash, credit, and other payment-channel totals; and
- received-payment detail rows.

The authoritative equations are:

```text
received = PAYMENT paidAmount
refund = REFUND refundAmount
net received = received - refund

channel total = transfer + cash + credit + other
other = eWallet + paymentLink + existing otherPayment buckets
```

Procedure/service and product are a parallel breakdown of received activity. They are not added to `received`. When the provider category view does not reconcile to PAYMENT, the page exposes the difference as `ยังไม่จัดหมวด` instead of silently changing the authoritative received total.

#### Revenue category allocation contract

The implementation must not label raw PRODUCT_SALES, PRODUCT_USE, or OPD sums as parts of PAYMENT. It creates a payment-level allocation projection instead:

1. PAYMENT provides the authoritative `paidAmountSatang` and immutable payment UUID.
2. The bounded PAYMENT_DETAIL cache supplies the OPD and course lines for that payment.
3. Product/service type metadata maps each referenced item code to `PRODUCT` or `SERVICE`; `course` maps to `SERVICE`.
4. Positive net line values provide allocation weights. The payment's received satang is allocated proportionally using integer satang and a deterministic remainder rule.
5. Missing detail, missing type metadata, deposit-only payments, and zero-weight payments allocate to `UNCLASSIFIED`.
6. For every payment, `serviceSatang + productSatang + unclassifiedSatang` must equal that payment's authoritative `paidAmountSatang` exactly.
7. Refund remains a separate headline amount in the first release and is not guessed back into service or product categories.

If the required payment-detail or item-type cache is incomplete, the UI shows activity counts and `กำลังตรวจสอบหมวด` rather than unverified category revenue amounts. A release gate must reconcile the allocation against a source-day sample before category money is enabled.

#### Allocation cache acquisition

- PAYMENT refresh establishes the immutable payment UUID set for one branch/day cache key.
- A resumable detail-sync job processes that set with one provider request in flight, no more than 20 payment-detail requests per minute, and at most 20 new details per worker run.
- The worker honors provider `Retry-After`, persists its cursor after every detail, and resumes without repeating successful detail rows.
- Payment-detail cache identity is `branchUuid + eventDate + paymentUuid + sourceHash`.
- Item-type metadata comes exactly from the same branch/day PRODUCT_SALES snapshot: `itemCode + type`. Conflicting types for one code are marked ambiguous and allocate to `UNCLASSIFIED`; course records in PAYMENT_DETAIL map directly to `SERVICE`.
- The sorted item-code mapping is versioned with a metadata snapshot hash.
- A daily coverage marker stores PAYMENT row count, successful detail count, metadata snapshot hash, source-success timestamps, cursor, and `INCOMPLETE | COMPLETE`.
- Category money is enabled only when coverage is `COMPLETE` for every day in the selected window. A source-day comparison is an additional release gate, not a replacement for coverage.
- Opening a report never starts this sync. Manual refresh seeds one day and its resumable detail job; a multi-day historical view remains cache-only.

For a historical range, headline values are the sum of each included day, the detail list is grouped newest-day first, and category money is hidden when any included day lacks complete allocation coverage. The UI identifies the incomplete dates and allows staff to refresh those dates one at a time.

### 4.2 Monthly report

The monthly report contains:

- month selector;
- total received income;
- refunds;
- net income;
- recorded clinic expenses;
- estimated clinic balance;
- daily income trend;
- payment-channel breakdown;
- expense-category breakdown; and
- drill-down to received payments and recorded expenses.

Doctor-personal expenses are displayed in a separate restricted section and are excluded from clinic expense and estimated clinic balance by default.

The monthly equations and date bases are:

```text
monthly received = PAYMENT paidAmount whose payment eventDate is inside the Bangkok month
monthly refunds = REFUND refundAmount whose refund eventDate is inside the Bangkok month
monthly net income = monthly received - monthly refunds
monthly clinic expense = COMMITTED CLINIC expense whose expenseDate is inside the Bangkok month
estimated clinic balance = monthly net income - monthly clinic expense
```

`monthKey`, date boundaries, and all derived daily groups use `Asia/Bangkok`. The server derives `monthKey`; clients never submit it.

### 4.3 Expense capture

The expense section exposes these categories:

1. `บิลเอกสาร`
2. `สมุดรายจ่ายภายในคลินิก`
3. `สมุดรายจ่ายส่วนตัวหมอ`
4. `เงินเดือนพนักงาน`
5. `DF พนักงานตามแพ็กเกจ`
6. `DF แพทย์`

The first release enables manual capture only for categories 1-3. Categories 4-6 remain visible as `เตรียมระบบ` and have no active create action.

Supported first-release evidence is JPEG or PNG, with multiple images per submission. PDF support is reserved in the attachment schema but remains disabled until file validation, private delivery, page limits, and rendering are implemented.

## 5. Navigation and Screens

```text
รายงาน
├─ รายรับรายวัน
│  ├─ เลือกวันที่ / ดูย้อนหลัง
│  ├─ ยอดรับ / คืนเงิน / ยอดสุทธิ
│  ├─ หัตถการและบริการ / Product / ยังไม่จัดหมวด
│  ├─ โอน / สด / Credit / อื่น ๆ
│  └─ รายการรับชำระ
│
├─ รายงานรายเดือน
│  ├─ เลือกเดือน
│  ├─ รายรับ / รายจ่ายที่บันทึก / คงเหลือโดยประมาณ
│  ├─ สรุปรายวันและช่องทางรับเงิน
│  ├─ สรุปหมวดรายจ่าย
│  └─ ประวัติรายจ่าย
│
└─ จัดเก็บรายจ่าย
   ├─ บิลเอกสาร
   ├─ สมุดรายจ่ายภายในคลินิก
   ├─ สมุดรายจ่ายส่วนตัวหมอ
   ├─ เงินเดือนพนักงาน — เตรียมระบบ
   ├─ DF พนักงานตามแพ็กเกจ — เตรียมระบบ
   └─ DF แพทย์ — เตรียมระบบ
```

The report home remains clean and mobile-first. It uses two large primary cards and compact expense cards below them. It does not expose the legacy provider report catalog as the primary navigation.

## 6. Data Model

### 6.1 Finance storage boundary

Expense and doctor-personal evidence use a dedicated private finance folder and finance workbook boundary rather than the Booking Operations workbook.

The finance master contains `EXPENSE_MONTHLY_INDEX` and a thin recovery/audit index. Each `YYYY-MM` entry points to one private monthly ledger containing `EXPENSE_SUBMISSIONS`, `EXPENSE_ATTACHMENTS`, and `MONTHLY_SUMMARY`. Report reads therefore remain bounded to one selected month.

The runtime receives finance workbook and folder identifiers through secret/config bindings. They are never returned to the browser or logged.

### 6.2 Expense submissions

Monthly ledger tab: `EXPENSE_SUBMISSIONS`

```text
expenseId
expenseDate
monthKey
category
scope: CLINIC | DOCTOR_PERSONAL
amountSatang
counterpartyName
description
paymentMethod
recordState: PREPARED | COMMITTED | VOID
bookDailyKey
revision
supersedesExpenseId
submittedByStaffId
submittedByName
submittedAt
committedAt
updatedAt
version
idempotencyKey
```

`COMMITTED` is rendered to staff as `บันทึกแล้ว`. It means only that the complete submission and its required evidence were durably recorded. It does not mean reviewed, approved, audited, bank-verified, or accounting-posted.

Only `COMMITTED` rows participate in reports. `PREPARED`, `VOID`, superseded revisions, and incomplete uploads never participate.

### 6.3 Expense attachments

Monthly ledger tab: `EXPENSE_ATTACHMENTS`

```text
attachmentId
expenseId
ordinal
mediaType
originalFileName
privateFileId
sha256
uploadedByStaffId
uploadedAt
```

An expense can have multiple attachments. Original evidence remains private. Browser access must require a verified LINE identity, finance visibility, a short-lived token, and an expense-folder allowlist.

### 6.4 Expense audit and recovery

Finance master audit/recovery index:

```text
eventId
expenseId
actorStaffId
action: PREPARE | COMMIT | SUPERSEDE | VOID | RECOVER | ABANDON
beforeJson
afterJson
createdAt
correlationId
```

The audit is append-only. A voided or superseded submission is excluded from totals but its evidence and audit trail remain retained.

Finalization follows an explicit two-phase order:

1. persist a `PREPARED` submission;
2. persist and verify every required attachment;
3. append the durable audit/recovery record;
4. change the submission to `COMMITTED`; and
5. update the derived monthly summary and thin finance index.

A recovery worker can finish or abandon stale `PREPARED` records idempotently. Reports trust the committed monthly ledger, never the eventually consistent thin index. Orphan staging objects are cleaned without deleting committed private evidence.

### 6.5 Validation matrix

Server-derived fields:

- `expenseId`, `monthKey`, `scope`, `bookDailyKey`, submitter identity, timestamps, revision, and storage destinations;
- `scope=DOCTOR_PERSONAL` only for `BOOK_DOCTOR_PERSONAL`; all other enabled categories are `CLINIC`; and
- `bookDailyKey = scope + expenseDate` for the two book categories.

Required bill fields:

- valid Bangkok `expenseDate`;
- positive safe-integer `amountSatang`;
- bounded counterparty/shop name;
- allowlisted payment method;
- optional bounded description; and
- one to five valid images.

Required book fields:

- valid Bangkok `expenseDate`;
- positive safe-integer daily `amountSatang`;
- selected clinic or doctor-personal book;
- optional bounded description; and
- one to five valid page images.

Counterparty and payment method are nullable for book submissions. Clients cannot submit a category/scope combination outside the allowlist.

### 6.6 Book revision rule

There is at most one effective `COMMITTED` record per `bookDailyKey`. If one already exists, a finance manager must explicitly choose `แทนที่ยอดเดิม`. The server creates a higher committed revision with `supersedesExpenseId`; the projector selects only the latest committed, non-void revision. It never mutates the prior financial evidence in place.

Book commits and replacements go through a signed expense-ingress command handled under an Apps Script `LockService` critical section. The command carries `bookDailyKey`, `expectedRevision`, immutable actor identity, and idempotency key. Inside the same lock, the ingress re-reads the effective revision before append/commit:

- no prior revision plus `expectedRevision=0` creates revision 1;
- an exact expected revision creates the next replacement revision;
- a mismatch returns `EXPENSE_REVISION_CONFLICT` and writes no effective total; and
- retries with the same idempotency key return the original result.

The client reloads the authoritative daily record after a revision conflict. In-process locks or browser-side checks are not accepted as the uniqueness boundary.

The expense date, month, category, and scope are immutable after commit. A correction that moves an expense across a day, month, category, or scope requires a finance manager to void the original in its original monthly ledger and create a new `expenseId` in the destination ledger. Cross-ledger supersession is not permitted in the first release.

### 6.7 Future-compatible fields

The first release does not implement approval. The model must permit a later migration that adds `SUBMITTED`, `APPROVED`, and `REJECTED` states plus approver identity without rewriting immutable IDs or attachments.

Payroll and DF will use dedicated, restricted ledgers when implemented. They must not be inferred from Booking commission placeholders, Stock quantities, or a performer name alone.

## 7. Expense Submission Flows

### 7.1 Bill document

```text
Choose บิลเอกสาร
-> enter date, amount, shop/counterparty, payment method, and note
-> attach one or more images
-> review summary
-> prepare attachments and commit the complete submission
-> show durable receipt number and บันทึกแล้ว — ยังไม่ตรวจสอบ
```

At least one attachment is required for a bill document.

### 7.2 Daily expense book

```text
Choose clinic book or doctor-personal book
-> enter date and daily total
-> attach one or more page images
-> add optional note
-> review summary
-> commit as the active daily book revision
```

The system does not ask staff to retype every line from the physical book. OCR can later propose line items from the same stored images.

If the selected book and day already have a committed record, ordinary submit-only staff receive `มีรายการของวันนี้แล้ว กรุณาแจ้งผู้ดูแล`. Only a finance manager can open the existing daily total and explicitly replace it with a new revision.

### 7.3 Failure recovery

- A client-generated idempotency key prevents duplicate submissions after Android retry, WebView reload, or network timeout.
- Images upload to bounded staging before the financial record is finalized.
- If upload fails, typed fields and successful attachment selections remain on screen.
- If record finalization succeeds but the response is lost, retry returns the same expense receipt rather than writing a duplicate.
- An incomplete upload never appears in monthly expense totals.

## 8. Access and Privacy

The first release introduces finance-specific permissions; it must not reuse `canManageStock`.

```text
canSubmitExpense
canViewFinance
canManageExpense
```

These are canonical boolean columns in `CONFIG_STAFF`. Authorization matches only immutable staff IDs after LINE identity verification; display names such as owner, doctor, or Mus are never authorization keys. Missing columns and missing/invalid values default to `false`.

- Every active, LINE-linked staff member can open the daily income report.
- Active internal staff with `canSubmitExpense` can create the three enabled expense categories and see only the receipt for their current submission.
- The owner, doctor, and Mus receive `canViewFinance` and can open monthly reports, expense history, individual expense evidence, and doctor-personal submissions.
- The owner, doctor, and Mus receive `canManageExpense` for correction revisions and void actions. This is record maintenance, not approval.
- Other staff cannot list, search, or retrieve prior expense submissions, including their own, from the Mini App.
- Unknown, inactive, or unlinked LINE users remain denied.
- Payroll and DF permissions are not introduced until those features are designed.

The eventual approval role is explicitly deferred. `canViewFinance` and `canManageExpense` do not imply approval.

The rollout migration is fail-closed:

1. append the three permission columns through the compatible-header migration;
2. keep every value `false` initially;
3. produce a staff-ID/name roster for owner review without exposing LINE user IDs;
4. grant `canSubmitExpense` only to the explicitly approved active staff IDs;
5. grant `canViewFinance` and `canManageExpense` only to the three owner-verified staff IDs for the owner, doctor, and Mus; and
6. verify manager and ordinary-staff behavior before enabling expense capture.

New staff default to no finance permissions until explicitly granted.

## 9. Architecture and Data Flow

```text
JERA read-only normalized cache
  -> daily income projection
  -> bounded payment-detail and item-type allocation cache
  -> bounded daily/monthly aggregates
  -> active staff daily view / finance-authorized monthly view

LINE Mini App expense form
  -> verified LINE identity and staff permission
  -> bounded image staging
  -> private Drive expense folder
  -> monthly PREPARED submission + attachments
  -> COMMITTED marker + finance audit/recovery index
  -> monthly recorded-expense projection
```

Revenue remains read-only and provider-sourced. Expense capture writes only to the new PMC operational expense ledger. The expense subsystem never writes to JERA, Stock, Booking, Calendar, or accounting providers.

Existing safe Mini App multipart parsing, file magic validation, staging integrity, idempotent async handling, private Drive placement, and managed-tab migration patterns should be reused. Existing OCR extraction may later populate an editable expense draft, but it cannot confirm or approve a financial record automatically.

## 10. Freshness and Quota Safety

- Daily and monthly report GET requests remain cache-only.
- Opening the report home does not trigger provider calls.
- A historical daily report reads one bounded day at a time.
- Monthly daily-series data is assembled from bounded daily cache projections and must not fan out unbounded parallel provider requests.
- Existing manual refresh throttling remains; refresh errors retain the last successful cache.
- Revenue cards expose `lastSyncedAt` for PAYMENT and REFUND. Category cards expose their own allocation-cache timestamp.
- A component older than 24 hours is stale. A category component whose successful source timestamps differ from PAYMENT by more than 15 minutes displays `ข้อมูลหมวดอาจล่าช้า` and does not present the category money as reconciled.
- PAYMENT remains the headline authority even when category or refund components are stale. The UI never merges component values into one apparently atomic snapshot without showing the component freshness state.
- Expense reads open only the selected private monthly ledger or a bounded process snapshot; they do not scan every historical month.
- Derived monthly expense totals include only effective `COMMITTED` revisions and exclude `PREPARED`, `VOID`, superseded, and incomplete submissions.

### 10.1 Evidence limits and retention

- one to five JPEG/PNG images per submission;
- maximum 10 MB per image and 25 MB total request bytes;
- maximum 20 megapixels after header inspection and before decode-heavy work;
- staging objects expire after 24 hours;
- a recovery job abandons stale `PREPARED` records and removes their orphan staging objects after 48 hours;
- committed and voided private evidence is retained with its audit trail until a separately approved finance-retention policy exists; and
- no automatic cleanup may delete committed or voided finance evidence in this release.

## 11. Error Handling

- Empty revenue cache is shown as `ยังไม่มีข้อมูลที่ยืนยันแล้ว`, not a confirmed zero.
- Payment-method mismatch retains the authoritative received amount and shows a reconciliation warning.
- Missing category allocation appears as `ยังไม่จัดหมวด` or `กำลังตรวจสอบหมวด`; it never mutates received income.
- Expense storage failure returns a safe message and never claims success.
- A partial expense write remains `PREPARED` and cannot enter reports; idempotent recovery completes or abandons it.
- A duplicate daily-book submission cannot silently add a second effective total.
- Private evidence is never returned through a signature-only public proxy.
- Invalid or unsupported files are rejected before staging.
- No raw provider payload, credential, full evidence URL, private file ID, payroll value, or doctor-personal detail appears in logs.
- Expense features fail closed without breaking Booking, Stock, health, or existing report cache reads.

## 12. Deferred Phases

### Phase 2 — OCR assistance

- Accept supported bills and book-page evidence.
- OCR proposes merchant, date, total, payment method, category, and line items.
- A human reviews the draft before saving.
- OCR never approves, bank-verifies, or accounting-posts a record.

### Phase 3 — approval workflow

- Add submitted, approved, rejected, and voided decisions.
- Restrict approval to owner-approved finance roles.
- Monthly financial statements clearly distinguish recorded, pending, and approved expense.

### Phase 4 — compensation

- Add manager-only payroll monthly records.
- Add versioned employee package DF rules and frozen month-close lines.
- Add versioned doctor/service DF rules or approved imports.
- Never use Booking commission placeholders as compensation truth.

## 13. Testing and Acceptance

Required automated tests:

- daily received, refund, net, payment-channel, payment-level service/product allocation, deterministic satang remainder, and unclassified arithmetic;
- explicit prevention of PAYMENT + PRODUCT_SALES + OPD double counting;
- allocation fallback when payment detail/type metadata is missing or stale;
- allocation worker cursor, one-in-flight/provider-rate cap, `Retry-After`, cache identity, metadata snapshot hash, and full-day coverage marker;
- historical 1-31 day aggregation, newest-day grouping, incomplete-day disclosure, and month boundary behavior in Asia/Bangkok;
- monthly clinic expense excludes doctor-personal expense;
- monthly equation uses payment date, refund date, and expense date consistently;
- only effective `COMMITTED` expense is counted; `PREPARED`, `VOID`, and superseded revisions are excluded;
- one active daily-book revision per scope/date and explicit finance-manager replacement;
- concurrent first-book commits, concurrent replacement CAS, idempotent retry, and `EXPENSE_REVISION_CONFLICT` recovery through the signed Apps Script ingress;
- immutable date/month/category/scope and void-plus-new correction across boundaries;
- active staff daily-income access, finance-only monthly access, and submit-only staff expense access;
- direct API attempts to list evidence without finance permission return 403;
- multiple image attachment order, hash, size, type, retry, and idempotency;
- partial multi-tab failure, commit-marker recovery, stale prepared abandonment, and orphan staging cleanup;
- Android/WebView lost-response recovery;
- Sheet header compatibility and migration safety;
- report cache quota regression, component freshness/mixed-snapshot warnings, and bounded monthly expense reads;
- Booking, Stock, Calendar, LINE, OCR, and fallback Form regressions remain green.

Browser acceptance:

```text
Home -> Reports -> Daily income -> historical date -> payment detail
Home -> Reports -> Daily income -> 31-day range -> grouped days / incomplete allocation dates
Home -> Reports -> Monthly -> income and recorded expense
Home -> Reports -> Bill document -> attach images -> review -> recorded receipt
Home -> Reports -> Expense book -> daily total + page images -> recorded receipt
Staff account -> submission available, finance history inaccessible
Finance account -> monthly report and evidence history accessible
```

## 14. Success Criteria

The first release is complete when:

1. Daily income provides one authoritative received total with non-additive category and channel breakdowns.
2. Historical daily and monthly income can be viewed without provider-write capability or quota bursts.
3. Monthly clinic report separates recorded clinic expense from doctor-personal expense.
4. Staff can submit bill and daily-book evidence from the LINE Mini App with durable retry-safe receipts.
5. Only the owner, doctor, and Mus can view finance history and private evidence.
6. Salary and DF cards are visible as deferred features but calculate or expose no compensation values.
7. OCR and approval are not accidentally enabled.
8. Existing Booking, Stock, Calendar, LINE notifications, OCR routes, and fallback Form show no regression.
9. Partial expense writes, duplicate daily books, and lost responses cannot inflate monthly expense totals.
10. Concurrent book submissions are serialized by the authoritative ingress, and cross-month corrections cannot leave both monthly ledgers effective.
