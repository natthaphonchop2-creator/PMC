# PMC Internal LINE OCR Ledger Design

**Date:** 2026-08-22

**Status:** Approved in chat; pending written-spec review before implementation planning

**Project:** PMC Web

**Audience:** Internal operations and finance staff

## 1. Objective

Build a simple internal document-capture workflow operated from one authorized LINE group.

Staff send an image of either a bank-transfer slip or a receipt/bill. The system classifies and extracts the document, returns a LINE Flex draft for review, allows corrections through a compact LIFF page, and writes only human-confirmed data to private Google Drive and Google Sheets. The resulting ledger supports daily and monthly reporting without introducing a separate application login or a general-purpose database.

The intended staff experience is:

```text
send image -> inspect Flex draft -> confirm or edit -> recorded -> included in reports
```

## 2. Approved Product Decisions

- The system is internal-only and operates in exactly one authorized LINE group in phase 1.
- It accepts both bank-transfer slips and receipts/bills.
- It supports both income and expense transactions.
- Document type and income/expense direction are proposed automatically.
- Every document requires explicit human confirmation before it enters the confirmed ledger or reports.
- Any member of the authorized LINE group may edit, confirm, or cancel a draft.
- Receipt extraction includes every visible line item, including quantity and monetary values when present.
- Expected volume is 50-300 images per day.
- The interface uses LINE Flex for summaries and a LIFF web page for full review and editing.
- Google Drive stores private source images.
- Google Sheets remains the operational source of truth and reporting surface.
- The backend follows a Hybrid Lean architecture using the existing Render-hosted Node service plus Google APIs.
- OpenAI image understanding with strict structured output is the phase-1 extraction engine.
- Google Vision is deferred and may be added only if measured phase-1 accuracy fails the agreed acceptance criteria.
- Phase 1 does not verify that funds actually reached a bank account and does not claim that a slip is authentic.
- Reports are available on demand in LINE and are pushed automatically each day at 20:00 Asia/Bangkok.

## 3. Non-Goals

- No public SaaS, subscriptions, packages, billing, or self-service onboarding.
- No new username/password account system.
- No Supabase, PostgreSQL, or other general-purpose database in phase 1.
- No bank account reconciliation or confirmation of actual money movement.
- No anti-counterfeit guarantee for transfer slips.
- No automatic posting into an accounting provider.
- No automatic confirmation, even when model confidence is high.
- No processing from unapproved LINE groups or one-to-one chats.
- No replacement or restructuring of PMC Booking Operations, Ads Dashboard, or existing booking webhook behavior.
- No Google Document AI Expense or Invoice Parser integration in phase 1.
- No PDF, video, audio, HEIC, or multi-page document support in phase 1.

## 4. Architecture

### 4.1 Recommended topology

```text
Authorized LINE group
        |
        | image message / postback / report command
        v
Existing Render Node service
  - verify LINE raw-body signature
  - enforce allowed group ID
  - deduplicate webhook event
  - append durable RECEIVED queue row
  - acknowledge webhook
        |
        +---------------------> Master Google Sheet
                                  durable OCR queue and drafts
        |
        v
OCR worker in the same application boundary
  - download source image promptly
  - store source image in private Drive
  - normalize image
  - calculate SHA-256
  - call OpenAI Responses API
  - validate extracted values
        |
        v
LINE Flex draft <------> LIFF review/edit page
        |
        | explicit human confirmation
        v
Monthly Google Sheets ledger
  - TRANSACTIONS
  - LINE_ITEMS
  - DAILY_SUMMARY
  - CATEGORY_SUMMARY
        |
        v
Master Dashboard + LINE reports
```

### 4.2 Component boundaries

1. **LINE webhook adapter**
   - Reads the untouched request body.
   - Verifies `x-line-signature` before parsing or acting.
   - Accepts only image messages, supported report commands, and signed postbacks from the configured group.
   - Appends a durable `RECEIVED` queue row before returning a successful response.
   - Returns a safe acknowledgement and never waits for image download or AI extraction to complete.

2. **Document intake service**
   - Creates an immutable internal `documentId`.
   - Lets the worker download the LINE image promptly because LINE-hosted message content is temporary.
   - Stores the original image privately in Drive before marking intake complete.
   - Records the source `messageId`, group, sender, and timestamps in the durable queue row.

3. **OCR worker**
   - Claims queued work with a lock and lease timestamp.
   - Normalizes orientation and image dimensions with the repository's existing `sharp` dependency.
   - Computes an exact-file SHA-256 hash.
   - Sends the image to the OpenAI Responses API with a strict JSON Schema.
   - Runs deterministic validation after model extraction.

4. **Draft service**
   - Stores the current editable header and line items separately from confirmed ledger data.
   - Builds the Flex draft.
   - Applies signed edit, confirm, cancel, and retry actions.
   - Enforces first-successful-finalization semantics.

5. **LIFF review page**
   - Shows the image, header fields, validation warnings, and all line items on one mobile-first page.
   - Uses LINE identity and a short-lived signed draft token; it has no separate login.
   - Saves edits to the draft only. Editing never confirms the transaction automatically.

6. **Ledger writer**
   - Writes confirmed headers and line items to the correct monthly ledger.
   - Uses `documentId` as the immutable idempotency key.
   - Records actor, timestamp, before/after values, and reason in the audit log.

7. **Reporting service**
   - Reads confirmed records only.
   - Maintains daily and category aggregates.
   - Builds on-demand and scheduled LINE reports.

### 4.3 LINE channel isolation

The OCR workflow should use a dedicated OCR LINE Official Account and Messaging API channel so its webhook and group routing do not change the live Booking channel. If the provided LINE credentials belong to a channel already used by another production workflow, setup must stop and request an explicit routing decision. It must not silently repoint a live webhook.

Phase 1 has one allowlisted `groupId`. Events from all other sources receive no financial processing.

## 5. End-to-End Data Flow

### 5.1 Image intake

1. A staff member sends one supported image in the authorized group.
2. LINE sends the webhook event to the OCR webhook route.
3. The server verifies the raw-body signature and group ID.
4. The server deduplicates the LINE event and `messageId`.
5. The server creates an `OCR_QUEUE` row in `RECEIVED` state before returning success.
6. The bot acknowledges receipt with `รับเอกสารแล้ว กำลังอ่านข้อมูล`.
7. The worker claims the row, downloads the original image, and stores it in private Drive.
8. The worker changes the row to `STORED`, then `OCR_PROCESSING`.

### 5.2 Extraction and draft creation

1. The worker fixes EXIF orientation and prepares a bounded-size analysis image without replacing the private original.
2. It calculates the source-image SHA-256 hash and checks prior documents.
3. It requests strict structured output from the OpenAI Responses API.
4. It validates document type, direction, dates, totals, taxes, discounts, line arithmetic, and duplicate signals.
5. It saves one draft header plus zero or more draft line-item rows.
6. It changes the state to `PENDING_REVIEW` and pushes a Flex draft to the group.

### 5.3 Review and confirmation

1. Flex shows the key fields, first five line items, warnings, and action buttons.
2. `แก้ไขข้อมูล` opens LIFF with every extracted field and all line items.
3. Saving LIFF changes updates the draft and audit log, then refreshes the Flex state.
4. `ยืนยันบันทึก` finalizes the current draft exactly once.
5. The ledger writer records confirmed header and line items in the monthly ledger.
6. The master recent-transaction view and aggregates are refreshed.
7. The bot reports `บันทึกแล้ว`, the document number, and the confirming member.

### 5.4 Cancellation

`ยกเลิกรายการ` changes the draft to `CANCELLED`. The source image and audit history remain private and retained. A cancelled draft is excluded from financial totals.

## 6. Extraction Contract

### 6.1 Common header fields

```text
documentId
documentType: TRANSFER_SLIP | RECEIPT
direction: INCOME | EXPENSE
documentDate
documentTime
counterpartyName
currency
subtotal
discountAmount
taxAmount
grandTotal
referenceNumber
categoryId
note
sourceImageFileId
sourceImageSha256
sourceLineMessageId
sourceLineUserId
confidenceByField
warnings
```

Missing values remain `null`; the model must never invent placeholders such as `unknown shop` or `0.00` for an unreadable field.

### 6.2 Transfer-slip fields

```text
senderName
senderBank
senderAccountMasked
receiverName
receiverBank
receiverAccountMasked
transferDate
transferTime
amount
referenceNumber
```

Account values are stored only when visibly present and should remain masked where the document itself is masked. Phase 1 records `STAFF_CONFIRMED` rather than `BANK_VERIFIED`.

### 6.3 Receipt header fields

```text
merchantName
merchantTaxId
branch
receiptNumber
receiptDate
subtotal
discountAmount
taxAmount
serviceCharge
grandTotal
paymentMethod
```

### 6.4 Receipt line-item fields

```text
documentId
lineNumber
description
quantity
unit
unitPrice
discountAmount
taxAmount
lineTotal
categoryId
confidence
```

Line numbering reflects visible document order. Unreadable numeric fields remain null and create a review warning.

### 6.5 Deterministic checks

- `subtotal - discount + tax + serviceCharge` should reconcile with `grandTotal` within a configurable tolerance.
- Line totals should reconcile with the header subtotal where the document supplies enough data.
- Dates far in the future or outside a configurable historical window are flagged.
- Exact image hashes are checked before a new draft is created.
- Reused reference numbers are warnings, not automatic rejection, because legitimate repeated formats may exist.
- Model confidence never bypasses human confirmation.

## 7. LINE and LIFF Experience

### 7.1 Flex draft

The Flex draft displays:

- private status label, not a public share link;
- document type and proposed income/expense direction;
- date, counterparty, category, and grand total;
- tax and discount when present;
- first five receipt line items;
- `+N รายการ` when more items exist;
- arithmetic, low-confidence, and duplicate warnings;
- `ยืนยันบันทึก`, `แก้ไขข้อมูล`, and `ยกเลิกรายการ` actions.

The Flex message does not expose tokens, Drive file IDs, raw signed action data, full account numbers, or full OCR text in alt text.

### 7.2 Authorization and concurrency

- Any current member of the configured group may operate a pending draft.
- Every action records the LINE user ID, best available display name, timestamp, and action.
- Signed actions bind the action name and `documentId` and have a bounded lifetime.
- The first successful `CONFIRMED` or `CANCELLED` transition wins.
- Later actions receive an already-finalized response and do not mutate the ledger.

### 7.3 LIFF behavior

- The page is optimized for LINE mobile webviews.
- It displays all header fields and a repeatable line-item editor.
- Required fields are document type, direction, date, category, and grand total.
- Numeric fields use decimal validation and never accept NaN or localized separators without normalization.
- Saving shows a revised preview; it does not confirm automatically.

## 8. Google Drive and Sheets Design

### 8.1 Drive hierarchy

```text
PMC OCR/
├── YYYY/
│   └── MM/
│       ├── TRANSFER_SLIP/
│       └── RECEIPT/
└── Monthly Ledgers/
    └── YYYY-MM PMC OCR Ledger
```

Source files stay private. Sheets store the Drive `fileId` and an authorized-user link rather than embedding binary images in cells.

### 8.2 Master workbook tabs

| Tab | Purpose |
|---|---|
| `DASHBOARD` | Current KPI and filter surface |
| `RECENT_TRANSACTIONS` | Recent confirmed header records |
| `PENDING_REVIEW` | Drafts awaiting group action |
| `CATEGORIES` | Organization-controlled income and expense categories |
| `CONFIG` | Non-secret operating configuration |
| `OCR_QUEUE` | Durable processing queue, leases, attempts, and error codes |
| `DRAFTS` | Editable header drafts |
| `DRAFT_LINE_ITEMS` | Editable line-item drafts |
| `ERRORS` | Operator-visible failed work |
| `AUDIT_LOG` | Append-only user and system actions |
| `MONTHLY_INDEX` | Monthly ledger IDs, status, and aggregate freshness |

### 8.3 Monthly ledger tabs

| Tab | Purpose |
|---|---|
| `TRANSACTIONS` | One confirmed row per document |
| `LINE_ITEMS` | One row per confirmed receipt item |
| `DAILY_SUMMARY` | Confirmed totals by day and direction |
| `CATEGORY_SUMMARY` | Confirmed totals by category and direction |

Monthly partitioning prevents high-volume line items from degrading one long-lived workbook. Staff use the master workbook link; the application creates and indexes monthly ledgers automatically.

### 8.4 Source-of-truth rule

- Draft tabs are the source of truth before confirmation.
- The monthly ledger is the source of truth after confirmation.
- Dashboard and LINE reports are derived views.
- A dashboard refresh failure must never roll back or duplicate a confirmed ledger write.

## 9. State Machine and Idempotency

### 9.1 States

```text
RECEIVED
  -> STORED
  -> OCR_PROCESSING
  -> PENDING_REVIEW
     -> CONFIRMED
     -> CANCELLED

Any non-final processing state
  -> RETRY_PENDING
  -> FAILED
```

Final states are `CONFIRMED` and `CANCELLED`. `FAILED` may be retried explicitly and returns to `RETRY_PENDING`.

### 9.2 Idempotency keys

- Webhook event: LINE webhook event identifier when available, plus stable event digest.
- Image intake: LINE `messageId`.
- Exact-file duplicate: source SHA-256.
- OCR attempt: `documentId:ocr:<attempt>`.
- Flex delivery: `documentId:flex:<draftVersion>`.
- Confirmation: `documentId:confirm`.
- Ledger row: immutable `documentId`.
- Scheduled report: `report:<groupId>:<YYYY-MM-DD>:daily`.

An exact image duplicate does not create a second transaction by default. The group receives the existing document status. Reference-number duplicates show a warning and remain confirmable.

## 10. Error Handling and Recovery

- OCR and transient provider errors retry automatically up to three times with bounded backoff.
- A claimed queue row has a lease timeout so abandoned work can be recovered.
- Drive failure stops extraction because the original source must exist before OCR begins.
- Sheets failure leaves the draft recoverable and does not report success.
- LINE Flex failure preserves the draft and can regenerate the same version.
- Dashboard aggregation failure does not change confirmed transaction state and is repaired independently.
- After automatic retries are exhausted, the row enters `FAILED`, appears in `ERRORS`, and offers `ลองอ่านใหม่`.
- User-visible errors use simple Thai messages. Provider response bodies, tokens, stack traces, file IDs, and raw OCR payloads are not shown in LINE.
- Source images and audit history are not automatically deleted when processing fails or a draft is cancelled.

## 11. Reports

### 11.1 LINE commands

```text
สรุปวันนี้
สรุปเมื่อวาน
สรุปเดือนนี้
รายการรอยืนยัน
รายการผิดพลาด
```

Equivalent normalized command forms may be supported, but phase 1 does not add conversational natural-language reporting.

### 11.2 Report contents

- confirmed income;
- confirmed expense;
- net amount;
- confirmed document count;
- extracted tax total;
- top five categories;
- pending-review count;
- failed-work count;
- duplicate-warning count; and
- authorized link to the master Dashboard.

Pending, failed, and cancelled documents are excluded from financial totals and displayed separately.

### 11.3 Scheduled report

- Runs daily at 20:00 in `Asia/Bangkok`.
- Target time and enabled state are editable in `CONFIG`.
- A no-activity day sends a short text rather than a large Flex card.
- The scheduled-report idempotency key prevents duplicate daily pushes.

### 11.4 Dashboard filters

The master Dashboard supports date range, document type, direction, category, counterparty, sender, and confirmer. It drills from totals to transactions and then to receipt line items.

## 12. Security and Privacy

- Verify every LINE webhook signature before parsing trusted fields.
- Enforce one allowed group ID server-side.
- Use a dedicated OCR LINE channel unless an explicit routing design approves sharing.
- Keep source images and monthly ledgers private to authorized company identities.
- Store production secrets only in Render environment configuration or approved Google secret storage.
- Do not read production credentials from the local `API` directory.
- The local `API` directory remains ignored by Git.
- Do not commit OAuth client files, refresh tokens, access tokens, channel secrets, signed LIFF tokens, or downloaded customer documents.
- Before configuring Google OAuth, verify the active Google account, Cloud project, enabled APIs, granted scopes, and ownership or sharing of the exact Drive and Sheets assets.
- Sanitize logs: no image body, full account number, token, full OCR response, raw provider error, or unrestricted Drive link.
- Prefer masked account values and aggregate reporting in group messages.
- Use least-privilege Google scopes limited to the designated Drive folder and Sheets assets.
- Record staff actions without presenting the audit log as bank verification.

## 13. Runtime Configuration

Exact secret values are never stored in source. The implementation plan may refine names, but the runtime needs these logical values:

```text
OCR_LINE_CHANNEL_SECRET
OCR_LINE_CHANNEL_ACCESS_TOKEN
OCR_ALLOWED_GROUP_ID
OCR_MASTER_SPREADSHEET_ID
OCR_DRIVE_ROOT_ID
OCR_LIFF_ID
OCR_REVIEW_SIGNING_SECRET
OPENAI_API_KEY
OPENAI_OCR_MODEL
OCR_GOOGLE_CLIENT_ID
OCR_GOOGLE_CLIENT_SECRET
OCR_GOOGLE_REFRESH_TOKEN
OCR_DAILY_REPORT_ENABLED
OCR_DAILY_REPORT_TIME
OCR_TIMEZONE
```

Non-secret category lists, report settings, reconciliation tolerance, and date-window rules belong in `CONFIG`. Credentials never belong in Sheet cells.

## 14. Testing Strategy

### 14.1 Automated tests

- raw-body LINE signature acceptance and rejection;
- group allowlist and unsupported source rejection;
- webhook, message, image, confirmation, and report idempotency;
- state-machine transitions and concurrent finalization;
- strict extraction-schema parsing and refusal handling;
- income/expense and document-type normalization;
- total, tax, discount, service-charge, and line-item arithmetic;
- Drive-first intake invariant;
- retry leases, retry exhaustion, and manual retry;
- monthly ledger selection and duplicate-safe writes;
- Dashboard aggregation independent from ledger confirmation;
- signed LIFF and postback action validation;
- Flex object validation and safe alt text;
- Asia/Bangkok report boundaries and scheduled-report idempotency;
- log redaction and secret scanning.

### 14.2 Evaluation dataset

Use at least 100 privacy-safe or synthetic images spanning:

- Thai bank-transfer slip layouts;
- thermal-paper receipts;
- printed tax receipts;
- mixed Thai and English merchant names;
- long receipts with many line items;
- rotated, shadowed, blurred, and low-contrast images;
- duplicate files and repeated reference-number cases; and
- documents with missing or unreadable fields.

### 14.3 Acceptance criteria

- document-type accuracy at least 98%;
- grand-total accuracy at least 98%;
- exact line-item field accuracy at least 95% on the reviewed evaluation set;
- no unconfirmed document in confirmed ledgers or financial totals;
- no duplicate confirmed ledger row for the same `documentId`;
- no cross-group processing;
- no secret or prohibited financial detail in application logs; and
- successful recovery from simulated OpenAI, Drive, Sheets, and LINE failures.

If the extraction targets are not met, add Google Vision as an evaluated fallback rather than silently lowering the acceptance criteria.

## 15. Rollout and Approval Gates

1. Build and test locally using provider fakes and synthetic documents.
2. Run extraction evaluation with the privacy-safe 100-image set.
3. Validate Flex payloads without sending them to a live group.
4. Deploy isolated OCR routes and configuration without changing existing Booking routes.
5. Verify the selected LINE channel is dedicated or obtain explicit approval for shared-channel routing.
6. Verify the intended Google identity, project, API enablement, OAuth scopes, and exact destination assets without exposing credentials.
7. Create the private Drive root, master workbook, and synthetic monthly ledger.
8. Run a synthetic end-to-end pilot in a non-production test context.
9. Request explicit owner approval before inviting or enabling the bot in the real group.
10. Request explicit owner approval before processing any real financial document.
11. Monitor queue age, extraction failures, duplicates, and report totals during pilot.

Production use is not approved by this design alone.

## 16. Success Criteria

The phase-1 system succeeds when:

- staff can record a supported document by sending one image;
- the returned draft is understandable without training in OCR or accounting software;
- all confirmed data is traceable to a private source image and human actor;
- line-item details remain usable at 50-300 documents per day;
- staff use one LINE group and one master Dashboard link;
- reports exclude unconfirmed and failed work;
- provider or network failures are recoverable without duplicate entries; and
- existing PMC production workflows remain unaffected.
