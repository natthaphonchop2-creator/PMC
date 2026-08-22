# PMC Internal LINE OCR Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal, one-group LINE workflow that reads transfer slips and receipts, returns a human-reviewable Flex/LIFF draft, records only confirmed income or expense data in private Google Drive and monthly Google Sheets ledgers, and produces on-demand plus 20:00 daily reports.

**Architecture:** Add an isolated `ocr-ledger` module to the existing Render Node/React repository. The unauthenticated LINE webhook verifies the raw signature and appends durable jobs to the master Sheet; a single Render Cron process drains that queue, stores images, calls OpenAI, serializes edit/confirm/cancel actions, writes idempotent monthly ledgers, and sends LINE results. LIFF is the only new browser surface and authenticates by sending a raw LINE ID token to the server for verification.

**Tech Stack:** Node.js HTTP, TypeScript 6, React 19, Vite 8, Vitest 4, `@line/liff` 2.30.0, LINE Messaging API and LINE Login v2.1, OpenAI Responses API with image input and strict JSON Schema, `googleapis` 176, Google Drive, Google Sheets, Sharp 0.35, Render Web Service and Render Cron.

**Spec:** `docs/superpowers/specs/2026-08-22-pmc-internal-line-ocr-ledger-design.md`

## Global Constraints

- Phase 1 accepts JPEG and PNG images from exactly one allowlisted LINE group.
- Document types are exactly `TRANSFER_SLIP` and `RECEIPT`; directions are exactly `INCOME` and `EXPENSE`.
- Every document requires explicit human confirmation; model confidence never confirms or posts a transaction.
- Any current member of the allowed group may edit, confirm, or cancel, and every action is audited.
- Transfer-slip status is `STAFF_CONFIRMED`, never `BANK_VERIFIED`.
- Receipt extraction includes all visible line items; unreadable fields remain `null` and create warnings.
- Google Drive originals remain private; confirmed ledgers are partitioned by `YYYY-MM`.
- `OCR_QUEUE` is the only durable job queue. Web requests append jobs; only the Cron worker mutates drafts, final document state, ledgers, aggregates, or action results.
- The Cron worker runs once per minute and Render's single-run guarantee is required before live use.
- Daily reporting uses `Asia/Bangkok`, defaults to 20:00, catches up after 20:00 if an earlier run failed, and is idempotent per local date.
- Never log or commit secrets, tokens, source images, raw OCR output, full account numbers, unrestricted Drive links, or provider response bodies.
- Do not read production credentials from `API/`; that directory stays ignored by Git.
- Existing `/api/booking-line/webhook`, Booking Operations, Booking Evidence, Ads Dashboard, Page Automation, and Meta/OpenAI endpoints must remain behaviorally independent.
- No implementation task authorizes a LINE webhook change, bot invitation, Google OAuth grant, real financial image, Blueprint sync, Render deployment, or production message. Those are explicit live gates in Task 11.
- Apply TDD for every task: failing focused test, minimal implementation, focused pass, affected-suite pass, then commit.

## External References Checked

- LINE image/webhook receipt and asynchronous processing: `https://developers.line.biz/en/docs/messaging-api/receiving-messages`
- LINE group behavior: `https://developers.line.biz/en/docs/messaging-api/group-chats/`
- LINE Flex: `https://developers.line.biz/en/docs/messaging-api/using-flex-messages/`
- LIFF server-side identity verification: `https://developers.line.biz/en/docs/liff/using-user-profile/`
- LINE Login ID-token verification: `https://developers.line.biz/en/reference/line-login/`
- OpenAI image input: `https://developers.openai.com/api/docs/guides/images-vision`
- OpenAI structured outputs: `https://developers.openai.com/api/docs/guides/structured-outputs`
- Render Cron single-run behavior and UTC schedules: `https://render.com/docs/cronjobs`

---

## File Ownership Map

| Area | Responsibility | Must not do |
|---|---|---|
| `src/apps/ocr-ledger/contracts.ts` | Environment-neutral API/domain contracts and schema version | Call browser, Node, LINE, OpenAI, or Google APIs |
| `server/ocr-ledger/domain.ts` | Pure state transitions, validation, duplicate rules, report-date helpers | Read environment variables or perform I/O |
| `server/ocr-ledger/config.ts` | Parse and validate namespaced runtime configuration | Read local credential files or print values |
| `server/ocr-ledger/security.ts` | LINE body HMAC and signed review/action tokens | Store secrets or authorize a group by client claim alone |
| `server/ocr-ledger/lineEvents.ts` | Parse supported LINE image, command, and postback events | Perform network or Sheet writes |
| `server/ocr-ledger/googleClient.ts` | OAuth2 client plus narrow Drive/Sheets ports | Decide workflow or document state |
| `server/ocr-ledger/googleStore.ts` | Master/monthly Sheet row mapping, queue append/claim, drafts, ledgers, audit, summaries | Call OpenAI or LINE |
| `server/ocr-ledger/setup.ts` | Dry-run-first private Drive/Sheets bootstrap command | Mutate live assets without `--confirm-create` |
| `server/ocr-ledger/imageProcessing.ts` | Safe image normalization, preview, MIME/dimension limits, SHA-256 | Persist or log image bytes |
| `server/ocr-ledger/openAiExtractor.ts` | One strict image-to-document Responses API call | Confirm transactions or silently coerce missing fields |
| `server/ocr-ledger/flexMessages.ts` | Flex drafts, completion cards, reports, safe alt text | Include secrets, full account numbers, raw OCR, or Drive IDs |
| `server/ocr-ledger/lineClient.ts` | LINE content download, reply, push, membership check, ID-token verify, validation API | Apply domain transitions |
| `server/ocr-ledger/worker.ts` | Single-writer queue engine, retries, draft/action/finalization orchestration | Serve HTTP or trust client profile data |
| `server/ocr-ledger/reports.ts` | Pure confirmed-only aggregation and scheduled-report decision | Read pending amounts into financial totals |
| `server/ocr-ledger/middleware.ts` | Webhook and authenticated LIFF review API | Run OCR in the webhook request |
| `server/ocr-ledger/job.ts` | One bounded Cron invocation that drains work and exits | Start an HTTP listener or run forever |
| `src/apps/ocr-ledger/` | Separately built mobile LIFF review UI and API client | Import the authenticated PMC app shell or send decoded profile data as identity |
| `tests/ocr-ledger/` | Focused fakes, unit, contract, UI, workflow, and evaluation tests | Use production credentials or customer documents |

---

### Task 1: Define contracts, document state, queue jobs, and deterministic validation

**Files:**
- Create: `src/apps/ocr-ledger/contracts.ts`
- Create: `server/ocr-ledger/domain.ts`
- Create: `server/ocr-ledger/config.ts`
- Create: `tests/ocr-ledger/domain.test.ts`
- Create: `tests/ocr-ledger/config.test.ts`

**Interfaces:**
- Consumes: no earlier task
- Produces: `OcrDocument`, `OcrDraft`, `OcrLineItem`, `OcrQueueJob`, `OcrAction`, `OcrWarning`, `validateExtraction`, `transitionDocument`, `readOcrLedgerConfig`

- [ ] **Step 1: Write failing state and arithmetic tests**

Create `tests/ocr-ledger/domain.test.ts` with these cases:

```ts
import { describe, expect, it } from 'vitest'
import { transitionDocument, validateExtraction } from '../../server/ocr-ledger/domain'

describe('OCR ledger domain', () => {
  it('requires review before confirmation and makes final states immutable', () => {
    expect(transitionDocument('OCR_PROCESSING', 'OCR_SUCCEEDED')).toBe('PENDING_REVIEW')
    expect(transitionDocument('PENDING_REVIEW', 'CONFIRM')).toBe('CONFIRMED')
    expect(() => transitionDocument('CONFIRMED', 'CANCEL')).toThrow('Final document state')
  })

  it('flags line/header mismatch without replacing the extracted values', () => {
    const result = validateExtraction({
      documentType: 'RECEIPT', direction: 'EXPENSE', documentDate: '2026-08-22',
      currency: 'THB', subtotal: 180, discountAmount: 0, taxAmount: 0,
      serviceCharge: 0, grandTotal: 200,
      lineItems: [
        { lineNumber: 1, description: 'A', quantity: 1, unit: null, unitPrice: 80, discountAmount: 0, taxAmount: 0, lineTotal: 80, categoryId: null, confidence: 0.99 },
        { lineNumber: 2, description: 'B', quantity: 1, unit: null, unitPrice: 100, discountAmount: 0, taxAmount: 0, lineTotal: 100, categoryId: null, confidence: 0.99 },
      ],
    })
    expect(result.normalized.grandTotal).toBe(200)
    expect(result.warnings.map((item) => item.code)).toContain('HEADER_TOTAL_MISMATCH')
  })
})
```

- [ ] **Step 2: Run the focused test and verify the module is absent**

Run: `npm test -- tests/ocr-ledger/domain.test.ts`

Expected: FAIL with module-not-found for `server/ocr-ledger/domain`.

- [ ] **Step 3: Add exact shared contracts**

Create `src/apps/ocr-ledger/contracts.ts` with `OCR_LEDGER_SCHEMA_VERSION = 1` and these exact unions:

```ts
export type OcrDocumentType = 'TRANSFER_SLIP' | 'RECEIPT'
export type OcrDirection = 'INCOME' | 'EXPENSE'
export type OcrDocumentState =
  | 'RECEIVED' | 'STORED' | 'OCR_PROCESSING' | 'PENDING_REVIEW'
  | 'CONFIRMED' | 'CANCELLED' | 'RETRY_PENDING' | 'FAILED'
export type OcrJobType = 'INTAKE' | 'EDIT' | 'CONFIRM' | 'CANCEL' | 'RETRY' | 'REPORT_COMMAND'
export type OcrJobState = 'QUEUED' | 'LEASED' | 'DONE' | 'FAILED'
```

Define the full fields from spec sections 6.1-6.4. Add `draftVersion: number`, `confirmedBy: string | null`, `confirmedAt: string | null`, `verificationStatus: 'STAFF_CONFIRMED' | null`, and `warnings: OcrWarning[]`. Define queue rows with `jobId`, `jobType`, `documentId`, `idempotencyKey`, `payloadJson`, `state`, `attempts`, `availableAt`, `leaseUntil`, `lastErrorCode`, `createdAt`, and `updatedAt`.

- [ ] **Step 4: Implement pure transitions and validation**

In `domain.ts`, export:

```ts
export function transitionDocument(state: OcrDocumentState, event: OcrDomainEvent): OcrDocumentState
export function validateExtraction(input: OcrExtraction): { normalized: OcrExtraction; warnings: OcrWarning[] }
export function exactImageDuplicate(hash: string, confirmedHashes: ReadonlySet<string>): boolean
export function bangkokMonthKey(isoDate: string): string
```

Use a `0.01` THB reconciliation tolerance, preserve `null`, reject non-finite numbers, and flag rather than reject future dates, header arithmetic mismatches, line-sum mismatches, low-confidence required fields, exact hashes, and repeated reference numbers.

- [ ] **Step 5: Write failing configuration tests and implement fail-closed parsing**

Create `tests/ocr-ledger/config.test.ts` asserting missing secrets return `{ configured: false, missing: [...] }` without values, `OCR_ALLOWED_GROUP_ID` must begin with `C`, timezone must equal `Asia/Bangkok`, and report time must match `HH:mm`.

Implement:

```ts
export function readOcrLedgerConfig(env: NodeJS.ProcessEnv): OcrLedgerConfigResult
```

Require the logical values from spec section 13 plus `OCR_LIFF_CHANNEL_ID`, `OCR_WORKER_BATCH_SIZE`, `OCR_MAX_IMAGE_BYTES`, and `OCR_OPENAI_MAX_OUTPUT_TOKENS`. Never fall back to files under `API/`.

- [ ] **Step 6: Run focused tests, type build, and commit**

Run:

```bash
npm test -- tests/ocr-ledger/domain.test.ts tests/ocr-ledger/config.test.ts
npm run build:server
git diff --check
```

Expected: PASS.

Commit:

```bash
git add src/apps/ocr-ledger/contracts.ts server/ocr-ledger/domain.ts server/ocr-ledger/config.ts tests/ocr-ledger/domain.test.ts tests/ocr-ledger/config.test.ts
git commit -m "feat: define OCR ledger domain"
```

---

### Task 2: Secure LINE events, review tokens, and LIFF identity boundaries

**Files:**
- Create: `server/ocr-ledger/security.ts`
- Create: `server/ocr-ledger/lineEvents.ts`
- Create: `tests/ocr-ledger/security.test.ts`
- Create: `tests/ocr-ledger/lineEvents.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts
- Produces: `verifyLineSignature`, `signReviewToken`, `verifyReviewToken`, `parseOcrLineEvents`, `OcrLineEvent`

- [ ] **Step 1: Write fixed-vector token and signature tests**

Test that signature comparison is constant-time-length-safe, altered token bodies fail, expired review tokens fail, and a token binds `documentId`, allowed `groupId`, `draftVersion`, `action`, and `exp`.

```ts
const token = signReviewToken({
  v: 1, documentId: 'OCR-20260822-abc123', groupId: 'Cgroup1',
  draftVersion: 2, action: 'REVIEW', exp: 1_788_000_000,
}, 'review-secret')
expect(verifyReviewToken(token, 'review-secret', 1_787_999_999).documentId)
  .toBe('OCR-20260822-abc123')
expect(() => verifyReviewToken(token, 'review-secret', 1_788_000_001)).toThrow('Expired review token')
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/security.test.ts tests/ocr-ledger/lineEvents.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement security primitives**

Use HMAC-SHA256 and `timingSafeEqual`. Review-token bodies are base64url JSON and signatures are lowercase hex. Actions are exactly `REVIEW`, `CONFIRM`, `CANCEL`, and `RETRY`. Reject extra segments, unknown keys, invalid group/document patterns, unsupported actions, non-integer versions, and TTLs longer than 24 hours. An expired Flex directs staff to `รายการรอยืนยัน`, which issues a fresh token without changing the draft.

- [ ] **Step 4: Implement strict event parsing**

`parseOcrLineEvents(rawBody, allowedGroupId)` returns only:

```ts
type OcrLineEvent =
  | { type: 'IMAGE'; eventId: string; messageId: string; groupId: string; userId: string; replyToken: string }
  | { type: 'POSTBACK'; eventId: string; groupId: string; userId: string; replyToken: string; data: string }
  | { type: 'REPORT_COMMAND'; eventId: string; groupId: string; userId: string; replyToken: string; command: 'TODAY' | 'YESTERDAY' | 'MONTH' | 'PENDING' | 'ERRORS' }
```

Ignore other groups, one-to-one chats, unsupported media, ordinary text, edited messages, and malformed events. Normalize only the five approved Thai report commands from the spec.

- [ ] **Step 5: Verify security/event tests and commit**

Run:

```bash
npm test -- tests/ocr-ledger/security.test.ts tests/ocr-ledger/lineEvents.test.ts
npm run build:server
git diff --check
```

Expected: PASS.

Commit:

```bash
git add server/ocr-ledger/security.ts server/ocr-ledger/lineEvents.ts tests/ocr-ledger/security.test.ts tests/ocr-ledger/lineEvents.test.ts
git commit -m "feat: secure OCR LINE events"
```

---

### Task 3: Build the private Google Drive/Sheets store and dry-run-first bootstrap

**Files:**
- Create: `server/ocr-ledger/googleClient.ts`
- Create: `server/ocr-ledger/googleStore.ts`
- Create: `server/ocr-ledger/setup.ts`
- Create: `tests/ocr-ledger/googleStore.test.ts`
- Create: `tests/ocr-ledger/setup.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 contracts/config
- Produces: `createGoogleOcrPorts`, `createGoogleOcrStore`, `OcrLedgerStore`, `runOcrSetup`

- [ ] **Step 1: Write failing row-mapping and idempotency tests**

Use an in-memory `SheetsPort` and `DrivePort`. Assert:

- `appendJob` returns the existing job for a repeated idempotency key;
- `leaseJobs` skips unexpired leases and increments attempts once;
- `saveDraft` replaces the current draft version without writing confirmed tabs;
- `finalizeDocument` repairs a partial monthly write by document/line write keys instead of duplicating rows;
- report reads exclude non-`CONFIRMED` headers;
- setup defaults to dry-run and makes zero mutations.

```ts
await store.appendJob(job)
await store.appendJob({ ...job, jobId: 'second' })
expect(await store.listJobs()).toHaveLength(1)
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/googleStore.test.ts tests/ocr-ledger/setup.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Define narrow Google ports and OAuth2 construction**

`googleClient.ts` must construct `google.auth.OAuth2(clientId, clientSecret)`, call `setCredentials({ refresh_token })`, and expose only these methods:

```ts
export interface OcrSheetsPort {
  batchGet(spreadsheetId: string, ranges: string[]): Promise<Record<string, unknown[][]>>
  append(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void>
  update(spreadsheetId: string, range: string, rows: unknown[][]): Promise<void>
  batchUpdate(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>): Promise<void>
  create(title: string, tabs: string[]): Promise<string>
}
export interface OcrDrivePort {
  createFolder(name: string, parentId?: string): Promise<string>
  uploadImage(input: { name: string; parentId: string; mimeType: 'image/jpeg' | 'image/png'; bytes: Buffer }): Promise<string>
  downloadImage(fileId: string): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }>
}
```

The OAuth grant procedure uses `drive.file` and `spreadsheets` scopes under the company automation account. `downloadImage` rejects files outside the app-owned OCR hierarchy and unsupported MIME types. Tests inject ports and never call Google.

- [ ] **Step 4: Implement master and monthly schemas**

Use explicit header arrays for the spec tabs plus `OCR_QUEUE`. Store complex payloads as compact JSON strings. Queue appends are append-only. Worker updates target exact row ranges obtained during reads. Protect these implementation invariants:

- only the worker calls draft/finalization methods;
- monthly `TRANSACTIONS.writeState` is `WRITING` until all `LINE_ITEMS.itemWriteKey` values exist, then becomes `CONFIRMED`;
- `documentId` and `itemWriteKey = documentId:lineNumber` are unique by read-before-append under the single Cron writer;
- `MONTHLY_INDEX` stores the `YYYY-MM` ledger ID and aggregate freshness.

- [ ] **Step 5: Implement bootstrap with an explicit create flag**

Export:

```ts
export async function runOcrSetup(input: {
  confirmCreate: boolean
  drive: OcrDrivePort
  sheets: OcrSheetsPort
  titlePrefix: string
}): Promise<{ mode: 'DRY_RUN' | 'CREATED'; checks: SetupCheck[] }>
```

Dry-run reports only named checks. `--confirm-create` creates the private root/master assets and never prints OAuth values. Add scripts:

```json
"ocr:test": "vitest run tests/ocr-ledger",
"ocr:setup": "node dist-server/server/ocr-ledger/setup.js"
```

- [ ] **Step 6: Run tests/build and commit**

Run:

```bash
npm test -- tests/ocr-ledger/googleStore.test.ts tests/ocr-ledger/setup.test.ts
npm run build:server
git diff --check
```

Expected: PASS; no external Google call.

Commit:

```bash
git add package.json package-lock.json server/ocr-ledger/googleClient.ts server/ocr-ledger/googleStore.ts server/ocr-ledger/setup.ts tests/ocr-ledger/googleStore.test.ts tests/ocr-ledger/setup.test.ts
git commit -m "feat: add OCR Google ledger store"
```

---

### Task 4: Normalize images and extract strict OpenAI document drafts

**Files:**
- Create: `server/ocr-ledger/imageProcessing.ts`
- Create: `server/ocr-ledger/openAiExtractor.ts`
- Create: `tests/ocr-ledger/imageProcessing.test.ts`
- Create: `tests/ocr-ledger/openAiExtractor.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts/domain
- Produces: `prepareOcrImage`, `createOpenAiOcrExtractor`, `OcrExtractorPort`

- [ ] **Step 1: Write failing image safety tests**

Generate images in memory with Sharp. Assert EXIF rotation, a maximum analysis edge of 2048 pixels, no enlargement, JPEG output, SHA-256 stability from original bytes, 40-million input-pixel protection, and rejection above `OCR_MAX_IMAGE_BYTES`.

- [ ] **Step 2: Write failing OpenAI request-contract tests**

Inject a fake fetch and assert one Responses API call contains:

```ts
{
  model: 'gpt-5.5',
  input: [{ role: 'user', content: [
    { type: 'input_text', text: expect.stringContaining('STAFF_CONFIRMED') },
    { type: 'input_image', image_url: expect.stringMatching(/^data:image\/jpeg;base64,/) },
  ] }],
  text: { format: { type: 'json_schema', name: 'pmc_internal_ocr_document_v1', strict: true } },
}
```

Also assert refusals, malformed JSON, unsupported enums, missing required keys, rate limits, and provider errors produce typed safe error codes without response bodies.

- [ ] **Step 3: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/imageProcessing.test.ts tests/ocr-ledger/openAiExtractor.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 4: Implement safe image preparation**

Export:

```ts
export async function prepareOcrImage(original: Buffer, maxBytes: number): Promise<{
  originalSha256: string
  analysisJpeg: Buffer
  width: number
  height: number
}>
```

Use `sharp(original, { limitInputPixels: 40_000_000 }).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true })`.

- [ ] **Step 5: Implement one strict extraction call**

`OcrExtractorPort.extract` accepts the prepared image and returns only `OcrExtraction`. The JSON Schema must enumerate both document types/directions, require confidence per field, allow `null` for unreadable values, and require the full line-item array for receipts. The system prompt prohibits inventing missing amounts, account digits, tax IDs, descriptions, or bank verification.

After parsing, call `validateExtraction`; preserve model values and attach deterministic warnings.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm test -- tests/ocr-ledger/imageProcessing.test.ts tests/ocr-ledger/openAiExtractor.test.ts tests/ocr-ledger/domain.test.ts
npm run build:server
git diff --check
```

Expected: PASS; OpenAI is fully mocked.

Commit:

```bash
git add server/ocr-ledger/imageProcessing.ts server/ocr-ledger/openAiExtractor.ts tests/ocr-ledger/imageProcessing.test.ts tests/ocr-ledger/openAiExtractor.test.ts
git commit -m "feat: extract OCR drafts from images"
```

---

### Task 5: Build LINE download/reply/push, Flex cards, and member verification

**Files:**
- Create: `server/ocr-ledger/lineClient.ts`
- Create: `server/ocr-ledger/flexMessages.ts`
- Create: `tests/ocr-ledger/lineClient.test.ts`
- Create: `tests/ocr-ledger/flexMessages.test.ts`

**Interfaces:**
- Consumes: Tasks 1-2 contracts/tokens
- Produces: `OcrLinePort`, `buildDraftFlex`, `buildFinalFlex`, `buildReportMessage`

- [ ] **Step 1: Write failing LINE client tests**

Assert exact endpoints and safe failures for:

- `GET https://api-data.line.me/v2/bot/message/{messageId}/content`;
- `POST https://api.line.me/v2/bot/message/reply`;
- `POST https://api.line.me/v2/bot/message/push`;
- `GET https://api.line.me/v2/bot/group/{groupId}/member/{userId}`;
- `POST https://api.line.me/oauth2/v2.1/verify` with `id_token` and expected `client_id`;
- `POST https://api.line.me/v2/bot/message/validate/push` for no-send validation.

Provider response bodies must not appear in thrown messages.

- [ ] **Step 2: Write failing Flex privacy and action tests**

Build a receipt with seven items and assert:

```ts
expect(visibleFlexText(message)).toContain('+2 รายการ')
expect(visibleFlexText(message)).toContain('ต้องตรวจสอบ')
expect(JSON.stringify(message)).not.toContain('driveFileId')
expect(JSON.stringify(message)).not.toContain('fullAccountNumber')
expect(message.altText).not.toContain('https://')
```

Assert draft actions are signed, `แก้ไขข้อมูล` points to the configured LIFF URL, and final/report cards contain no mutable buttons.

- [ ] **Step 3: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/lineClient.test.ts tests/ocr-ledger/flexMessages.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 4: Implement narrow LINE port**

```ts
export interface OcrLinePort {
  downloadImage(messageId: string): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' }>
  reply(replyToken: string, messages: unknown[]): Promise<void>
  push(to: string, messages: unknown[]): Promise<void>
  verifyLiffIdToken(idToken: string): Promise<{ userId: string; displayName: string }>
  assertGroupMember(groupId: string, userId: string): Promise<{ displayName: string }>
  validatePush(messages: unknown[]): Promise<void>
}
```

Reject content types outside JPEG/PNG, oversized bodies, mismatched LIFF channel audiences, expired tokens, and non-members.

- [ ] **Step 5: Implement Flex builders**

Use one compact bubble, Thai end-user copy, first five line items, `+N`, warning colors, and actions from the spec. Account identifiers must pass a masking helper before inclusion. Empty fields are omitted, not rendered as `null`.

- [ ] **Step 6: Run focused tests/build and commit**

Run:

```bash
npm test -- tests/ocr-ledger/lineClient.test.ts tests/ocr-ledger/flexMessages.test.ts
npm run build:server
git diff --check
```

Expected: PASS; no live LINE call.

Commit:

```bash
git add server/ocr-ledger/lineClient.ts server/ocr-ledger/flexMessages.ts tests/ocr-ledger/lineClient.test.ts tests/ocr-ledger/flexMessages.test.ts
git commit -m "feat: add OCR LINE messaging"
```

---

### Task 6: Implement the durable webhook intake and single-writer worker

**Files:**
- Create: `server/ocr-ledger/worker.ts`
- Create: `server/ocr-ledger/middleware.ts`
- Create: `server/ocr-ledger/job.ts`
- Create: `tests/ocr-ledger/intake.test.ts`
- Create: `tests/ocr-ledger/worker.test.ts`
- Create: `tests/ocr-ledger/job.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5
- Produces: `createOcrLedgerMiddleware`, `createOcrLedgerWorker`, `runOcrLedgerJob`

- [ ] **Step 1: Write failing webhook boundary tests**

Assert invalid signatures return `401` with zero Sheet/LINE calls; wrong groups return `200` with zero jobs; an image event appends `INTAKE` before reply; duplicate event/message IDs append once; webhook response does not wait for image download or OpenAI.

```ts
expect(order).toEqual(['append-job', 'reply-ack', 'respond-200'])
expect(extractor.extract).not.toHaveBeenCalled()
```

- [ ] **Step 2: Write failing worker workflow tests**

Cover:

- `INTAKE`: LINE download -> Drive original -> hash check -> OpenAI -> draft -> Flex;
- exact-image duplicate: show existing status, no second draft;
- provider failure: attempts 1-3 schedule bounded retry, fourth terminal failure writes `ERRORS` and sends retry action;
- `EDIT`: expected draft version required, edit audited, revised Flex sent;
- `CONFIRM`: first queued action writes/repairs monthly ledger, sets `STAFF_CONFIRMED`, later confirm/cancel becomes no-op;
- `CANCEL`: retains Drive image and audit but excludes ledger/report;
- abandoned `LEASED` job becomes claimable after `leaseUntil`;
- one run processes at most `OCR_WORKER_BATCH_SIZE` and exits.

- [ ] **Step 3: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/intake.test.ts tests/ocr-ledger/worker.test.ts tests/ocr-ledger/job.test.ts`

Expected: FAIL with missing workflow modules.

- [ ] **Step 4: Implement webhook middleware**

Expose only:

```ts
export function createOcrLedgerMiddleware(deps: {
  config: OcrLedgerConfig
  store: OcrLedgerStore
  line: OcrLinePort
  now: () => Date
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>
```

Read raw body with a 1 MB limit, verify signature, parse supported events, append idempotent queue jobs, and then acknowledge. Verify the signed postback action before appending it. Postbacks enqueue `CONFIRM`, `CANCEL`, or `RETRY`; report text enqueues `REPORT_COMMAND`. LIFF review POST requests enqueue `EDIT`. Never download images, call OpenAI, or mutate draft/ledger tabs in this request.

- [ ] **Step 5: Implement the single-writer queue engine**

`worker.runOnce()` leases jobs ordered by queue row and applies them serially. Keep all document mutations in this code path. Use error codes `LINE_DOWNLOAD_FAILED`, `DRIVE_UPLOAD_FAILED`, `OCR_RATE_LIMIT`, `OCR_INVALID_OUTPUT`, `SHEET_WRITE_FAILED`, `LINE_SEND_FAILED`, `VERSION_CONFLICT`, and `UNSUPPORTED_IMAGE`; do not store provider messages.

Use retry delays of 1, 5, and 15 minutes. A LINE-send retry reuses the saved draft and does not call OpenAI again.

- [ ] **Step 6: Implement the bounded Cron entrypoint**

```ts
export async function runOcrLedgerJob(env: NodeJS.ProcessEnv): Promise<{
  processed: number
  succeeded: number
  failed: number
  reportSent: boolean
}>
```

The executable calls once, emits a sanitized count-only summary, sets a nonzero exit code on missing configuration or unrecoverable store failure, and exits. It never contains `setInterval`.

- [ ] **Step 7: Run focused/affected tests and commit**

Run:

```bash
npm test -- tests/ocr-ledger/intake.test.ts tests/ocr-ledger/worker.test.ts tests/ocr-ledger/job.test.ts tests/ocr-ledger/googleStore.test.ts
npm run build:server
git diff --check
```

Expected: PASS.

Commit:

```bash
git add server/ocr-ledger/worker.ts server/ocr-ledger/middleware.ts server/ocr-ledger/job.ts tests/ocr-ledger/intake.test.ts tests/ocr-ledger/worker.test.ts tests/ocr-ledger/job.test.ts
git commit -m "feat: process durable OCR jobs"
```

---

### Task 7: Add authenticated LIFF review and private-image APIs

**Files:**
- Modify: `server/ocr-ledger/middleware.ts`
- Modify: `server/ocr-ledger/security.ts`
- Create: `tests/ocr-ledger/reviewApi.test.ts`

**Interfaces:**
- Consumes: Tasks 2-6
- Produces: `GET /api/ocr-ledger/client-config`, `GET /api/ocr-ledger/review?t=...`, `POST /api/ocr-ledger/review?t=...`, `GET /api/ocr-ledger/image?t=...`

- [ ] **Step 1: Write failing review API tests**

Test the public client-config projection contains only `liffId`. Test missing/altered/expired review token, missing bearer ID token, wrong LIFF audience, user no longer in the group, document/group mismatch, stale draft version, valid GET projection, valid authenticated image bytes, and valid POST append of one `EDIT` job.

Assert the client cannot submit `confirmedBy`, state, Drive ID, source hash, source LINE IDs, confidence, warnings, or audit fields.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/reviewApi.test.ts`

Expected: FAIL because review routes do not exist.

- [ ] **Step 3: Implement server-verified LIFF identity**

For every review request:

1. Verify signed review token.
2. Read raw ID token from `Authorization: Bearer`.
3. Call LINE `POST /oauth2/v2.1/verify` with expected `OCR_LIFF_CHANNEL_ID`.
4. Use returned `sub` as the user ID.
5. Call group-member profile for the token-bound group ID.
6. Reject before reading financial draft data if any step fails.

Do not accept `liff.getProfile()` or decoded client claims as identity.

- [ ] **Step 4: Implement safe read/edit projections**

GET client-config returns exactly `{ liffId }` from server configuration and no channel secret, access token, group ID, Drive/Sheet ID, or provider configuration.

GET review returns an authenticated relative `imageUrl`, editable header fields, all line items, warnings, `draftVersion`, and current state. POST validates exact editable fields and appends an `EDIT` job with `expectedVersion`; it returns `202 { accepted: true, jobId }`. It never updates Sheets draft rows directly.

GET image repeats the signed-token, ID-token, and current-group-membership checks, loads the file ID from the server-side draft by token-bound `documentId`, then reads the private Drive file. The token and query string never contain a Drive file ID. The response contains only JPEG/PNG bytes with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; it never returns a Drive URL or file ID.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npm test -- tests/ocr-ledger/reviewApi.test.ts tests/ocr-ledger/security.test.ts tests/ocr-ledger/lineClient.test.ts
npm run build:server
git diff --check
```

Expected: PASS.

Commit:

```bash
git add server/ocr-ledger/middleware.ts server/ocr-ledger/security.ts tests/ocr-ledger/reviewApi.test.ts
git commit -m "feat: add authenticated OCR review API"
```

---

### Task 8: Build the mobile LIFF review page

**Files:**
- Create: `src/apps/ocr-ledger/api.ts`
- Create: `src/apps/ocr-ledger/OcrReviewApp.tsx`
- Create: `src/apps/ocr-ledger/main.tsx`
- Create: `src/apps/ocr-ledger/index.html`
- Create: `src/apps/ocr-ledger/styles.css`
- Create: `vite.ocr-review.config.ts`
- Create: `tests/ocr-ledger/ocrReviewApp.test.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 1 contracts, Task 7 APIs
- Produces: isolated static bundle under `dist/ocr-review/`, `loadOcrClientConfig`, `loadOcrDraft`, `loadOcrImage`, `submitOcrEdit`

- [ ] **Step 1: Install the pinned LIFF SDK**

Run: `npm install @line/liff@2.30.0`

Expected: `package.json` and lockfile add only the LIFF dependency tree.

- [ ] **Step 2: Write failing route, loading, edit, and accessibility tests**

Use server-side rendering plus mocked LIFF/fetch adapters. Assert:

- the standalone `main.tsx` mounts only `OcrReviewApp` and imports no Home, Ads, Booking, or Page Automation shell;
- loading, expired-link, unauthorized, failed, pending, and submitted states use Thai user-facing copy;
- document type, direction, date, category, total, warnings, source preview, and every line item render;
- add/remove line item controls have accessible labels;
- submit is disabled for invalid required/numeric fields;
- the raw ID token, not decoded profile data, is passed to `loadOcrDraft`, `loadOcrImage`, and `submitOcrEdit`;
- successful submit says the change is queued and does not claim the document is confirmed.

- [ ] **Step 3: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/ocrReviewApp.test.tsx`

Expected: FAIL because the route/component is absent.

- [ ] **Step 4: Implement the LIFF API adapter**

Fetch `/api/ocr-ledger/client-config`, initialize LIFF with the returned `liffId`, call `liff.login()` only outside the client when required, call `liff.getIDToken()`, and send it as `Authorization: Bearer <raw token>`. Read the signed draft token only from query parameter `t`; never persist either token to local storage or logs. Fetch the authenticated image endpoint as a Blob, render a temporary object URL, and revoke that URL on replacement or unmount.

- [ ] **Step 5: Implement the one-page editor**

Use a focused `.ocr-review-*` namespace. Keep Thai line-height at least `1.55`, no Thai letter spacing, 44px minimum interactive targets, mobile-first one-column layout, visible field errors, and a sticky submit area. Show original values/warnings without accounting jargon. Do not add dashboard navigation or separate account UI.

- [ ] **Step 6: Add the isolated Vite build and verify UI/build**

Create `vite.ocr-review.config.ts` with a separate root/output:

```ts
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(process.cwd(), 'src/apps/ocr-ledger'),
  base: '/ocr-review/',
  plugins: [react()],
  build: { outDir: resolve(process.cwd(), 'dist/ocr-review'), emptyOutDir: true },
})
```

Add `build:ocr-review` and insert it into the root build between client and server builds. `index.html` loads only `main.tsx`; `main.tsx` imports the LIFF CSS and mounts only `OcrReviewApp`.

Run:

```bash
npm test -- tests/ocr-ledger/ocrReviewApp.test.tsx tests/homeApp.test.tsx
npm run build:ocr-review
npm run lint
git diff --check
```

Expected: PASS; `dist/ocr-review/index.html` exists and the existing main bundle/routes remain unchanged.

Commit:

```bash
git add package.json package-lock.json vite.ocr-review.config.ts src/apps/ocr-ledger tests/ocr-ledger/ocrReviewApp.test.tsx
git commit -m "feat: add LINE OCR review page"
```

---

### Task 9: Add confirmed-only reports and 20:00 Bangkok scheduling

**Files:**
- Create: `server/ocr-ledger/reports.ts`
- Modify: `server/ocr-ledger/worker.ts`
- Modify: `server/ocr-ledger/flexMessages.ts`
- Create: `tests/ocr-ledger/reports.test.ts`

**Interfaces:**
- Consumes: confirmed ledger reads from Task 3 and LINE builders from Task 5
- Produces: `aggregateOcrReport`, `reportWindow`, `shouldSendDailyReport`, command and scheduled report jobs

- [ ] **Step 1: Write failing aggregation tests**

Use mixed `CONFIRMED`, `PENDING_REVIEW`, `FAILED`, and `CANCELLED` fixtures. Assert only confirmed transactions affect income, expense, net, tax, and top categories; operational counts remain separate.

```ts
expect(report).toMatchObject({ income: 1000, expense: 300, net: 700 })
expect(report.operational).toMatchObject({ pending: 1, failed: 1, duplicateWarnings: 1 })
```

- [ ] **Step 2: Write failing Bangkok boundary and catch-up tests**

Assert 19:59 local is not due, 20:00 is due, 23:00 catches up when no daily idempotency row exists, and any later run skips after `report:<groupId>:<YYYY-MM-DD>:daily` is recorded. Cover month/year transitions using UTC timestamps.

- [ ] **Step 3: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/reports.test.ts`

Expected: FAIL because the report module is absent.

- [ ] **Step 4: Implement pure report windows and aggregation**

Support exactly `TODAY`, `YESTERDAY`, `MONTH`, `PENDING`, and `ERRORS`. Category ranking sorts by absolute amount descending, then category ID for deterministic ties. A zero-activity confirmed period produces a short text object. `PENDING` shows at most the ten oldest drafts, includes the total pending count, and signs a fresh 24-hour `REVIEW` token for each listed draft so an expired earlier Flex can be recovered.

- [ ] **Step 5: Integrate command and daily jobs**

`REPORT_COMMAND` builds and pushes the requested report. At the end of every Cron run, `shouldSendDailyReport` decides whether to enqueue/send the daily report. Record the daily idempotency key only after LINE accepts the push.

- [ ] **Step 6: Run report/worker tests and commit**

Run:

```bash
npm test -- tests/ocr-ledger/reports.test.ts tests/ocr-ledger/worker.test.ts tests/ocr-ledger/flexMessages.test.ts
npm run build:server
git diff --check
```

Expected: PASS.

Commit:

```bash
git add server/ocr-ledger/reports.ts server/ocr-ledger/worker.ts server/ocr-ledger/flexMessages.ts tests/ocr-ledger/reports.test.ts
git commit -m "feat: add OCR ledger reports"
```

---

### Task 10: Integrate production routing, scripts, safe configuration, and operator docs

**Files:**
- Create: `server/productionApp.ts`
- Modify: `server/productionServer.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Create: `tests/ocr-ledger/productionApp.test.ts`
- Create: `docs/ocr-ledger/setup.md`
- Create: `docs/ocr-ledger/pilot-runbook.md`
- Create: `docs/ocr-ledger/render-cron-example.yaml`

**Interfaces:**
- Consumes: Tasks 1-9
- Produces: testable production request handler, `npm run ocr:job`, setup/pilot procedures, non-live Render Cron example

- [ ] **Step 1: Write failing route-order and regression tests**

Assert:

- `/healthz` remains public;
- `/api/booking-line/webhook` still delegates to the existing middleware;
- `/api/ocr-ledger/webhook` is public only because LINE HMAC protects it;
- `/api/ocr-ledger/review` delegates to LIFF identity protection;
- `/ocr-review/` and only its `/ocr-review/*` assets are public static content with no embedded document data;
- all unrelated application/API routes retain existing Basic Auth behavior;
- missing OCR config returns safe `503` only for OCR routes;
- OCR failures cannot change Booking responses.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/productionApp.test.ts tests/bookingLineWebhook.test.ts`

Expected: FAIL because `productionApp.ts` does not exist.

- [ ] **Step 3: Extract a testable request handler and wire OCR routes**

Move route ordering/static/basic-auth logic from `productionServer.ts` into `createProductionRequestHandler(deps)`. Keep `productionServer.ts` responsible only for constructing real dependencies and listening. Serve `dist/ocr-review/index.html` and files under `dist/ocr-review/` before Basic Auth, with traversal protection and the same cache rules used for hashed assets. Do not make the main `dist/index.html`, main app routes, or unrelated static paths public. Preserve existing behavior byte-for-byte where practical.

- [ ] **Step 4: Add safe scripts and environment names**

Add:

```json
"ocr:job": "node dist-server/server/ocr-ledger/job.js",
"ocr:test": "vitest run tests/ocr-ledger",
"ocr:setup": "node dist-server/server/ocr-ledger/setup.js"
```

Append blank/example-only OCR variable names from the spec and Tasks 1/7 to `.env.example`. Never add real values or local OAuth filenames.

- [ ] **Step 5: Write the non-live Render Cron example**

`docs/ocr-ledger/render-cron-example.yaml` must show a `type: cron`, `runtime: node`, `schedule: "* * * * *"`, build `npm ci --include=dev && npm run build`, start `npm run ocr:job`, and the names of required secrets with `sync: false`. Add a warning that copying it into `render.yaml` creates a billable Render service and requires explicit owner approval. Do not modify live `render.yaml` in this task.

- [ ] **Step 6: Write setup and pilot runbooks**

`setup.md` includes:

- dedicated OCR OA/channel verification;
- Google account/project/API/scope verification;
- one-time OAuth refresh-token bootstrap without printing it to chat/logs;
- dry-run then `--confirm-create` asset setup;
- LIFF `openid` configuration and endpoint `/ocr-review`;
- group ID capture without storing message text;
- secret placement in Render environment settings;
- rollback and credential rotation.

`pilot-runbook.md` includes synthetic-only local tests, 100-image privacy-safe evaluation, no-send Flex validation, synthetic Drive/Sheet pilot, explicit gates for webhook change/bot invitation/real data, and rollback instructions.

- [ ] **Step 7: Run full route/config verification and commit**

Run:

```bash
npm test -- tests/ocr-ledger/productionApp.test.ts tests/bookingLineWebhook.test.ts tests/bookingEvidenceServer.test.ts
npm run build
npm run lint
git diff --check
```

Expected: PASS; no live asset or service is created.

Commit:

```bash
git add server/productionApp.ts server/productionServer.ts .env.example package.json package-lock.json tests/ocr-ledger/productionApp.test.ts docs/ocr-ledger
git commit -m "feat: integrate internal OCR ledger runtime"
```

---

### Task 11: Add the privacy-safe evaluation harness and complete pre-live verification

**Files:**
- Create: `scripts/evaluate-ocr-ledger.mjs`
- Create: `tests/ocr-ledger/evaluation.test.ts`
- Create: `tests/ocr-ledger/fixtures/evaluation-manifest.example.json`
- Modify: `.gitignore`
- Modify: `docs/ocr-ledger/pilot-runbook.md`

**Interfaces:**
- Consumes: completed Tasks 1-10
- Produces: aggregate-only accuracy report and explicit GO/NO-GO result

- [ ] **Step 1: Write failing manifest/scoring tests**

Define entries with a local image path, privacy-safe fixture ID, expected document type, expected grand total, and expected normalized line items. Test document-type accuracy, exact grand-total accuracy, exact line-item-field accuracy, missing-image rejection, and aggregate-only output.

```json
{
  "fixtureId": "receipt-001",
  "imagePath": "receipt-001.png",
  "expected": {
    "documentType": "RECEIPT",
    "grandTotal": 214.00,
    "lineItems": [{ "description": "ITEM A", "quantity": 2, "unitPrice": 100, "lineTotal": 200 }]
  }
}
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- tests/ocr-ledger/evaluation.test.ts`

Expected: FAIL because evaluator functions are absent.

- [ ] **Step 3: Implement aggregate-only evaluation**

The script reads images only from `OCR_EVAL_FIXTURE_DIR`, refuses paths inside `API/`, never copies images into the repository, and writes only counts/percentages/error codes to `output/ocr-ledger-evaluation/summary.json`. Add both directories to `.gitignore`.

Return GO only when:

- at least 100 fixtures were scored;
- document type is at least 98%;
- grand total is at least 98%;
- exact line-item fields are at least 95%;
- no fixture auto-confirms; and
- no prohibited token/image/OCR content appears in output.

- [ ] **Step 4: Run all automated verification**

Run:

```bash
npm run ocr:test
npm test
npm run lint
npm run build
git diff --check
```

Expected: all PASS. Existing Vite chunk warnings, if unchanged, are informational.

- [ ] **Step 5: Run synthetic no-send checks only**

With synthetic credentials/context approved for test use:

```bash
npm run ocr:setup
npm run ocr:job
```

Expected: setup reports `DRY_RUN`; the job reports sanitized counts and makes no production message or real-data write. Validate representative Flex objects through LINE's validation endpoint only, with no recipient push.

- [ ] **Step 6: Perform local browser QA**

Run: `npm run dev -- --host 127.0.0.1`

Verify `/ocr-review` at 390x844 and desktop widths for loading, valid draft, warnings, seven line items, invalid totals, expired token, queued edit, keyboard focus, and no console errors. Use mocked/test APIs and synthetic images only.

- [ ] **Step 7: Record the pre-live boundary**

Update `pilot-runbook.md` with dated test counts and GO/NO-GO. Stop before all of the following unless the owner gives a new explicit live approval:

- selecting or changing the live LINE webhook URL;
- inviting/enabling the OA in the real group;
- storing production Google OAuth refresh credentials;
- creating real Drive/Sheet assets;
- syncing the Render Blueprint or creating the Cron service;
- sending a message to the live group; or
- processing a real financial document.

- [ ] **Step 8: Commit the completed evaluation harness**

```bash
git add scripts/evaluate-ocr-ledger.mjs tests/ocr-ledger/evaluation.test.ts tests/ocr-ledger/fixtures/evaluation-manifest.example.json .gitignore docs/ocr-ledger/pilot-runbook.md
git commit -m "test: verify internal OCR ledger readiness"
```

---

## Final Verification Matrix

| Requirement | Primary task | Verification |
|---|---:|---|
| One authorized LINE group | 2, 6 | signature/allowlist tests |
| Both slips and receipts | 1, 4 | schema and extraction tests |
| Both income and expense | 1, 9 | domain/report tests |
| All receipt line items | 4, 8, 11 | extraction/UI/evaluation tests |
| Human confirmation only | 1, 6 | state/worker tests |
| Any current group member can act | 5, 7 | ID-token and membership tests |
| Flex plus LIFF editing | 5, 7, 8 | builder/API/UI tests |
| Private Drive originals | 3, 6 | store/worker tests |
| Master plus monthly Sheets | 3, 6 | repair/idempotency tests |
| 50-300 images/day without DB | 3, 6 | bounded queue batch/single-writer design |
| Duplicate and retry safety | 1, 3, 6 | hash/job/partial-write tests |
| On-demand and 20:00 reports | 2, 9 | command/timezone/idempotency tests |
| No bank-verification claim | 1, 4, 5 | schema/prompt/copy tests |
| No impact to Booking/Ads | 10 | production route regression suite |
| Accuracy gates | 11 | 100-image aggregate evaluation |
| No live mutation without approval | 10, 11 | runbook and deployment stop gate |
