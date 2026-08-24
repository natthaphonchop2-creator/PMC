# PMC Provisional Auto Queue and Complete Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display every submitted booking-evidence image in Admin LINE and add a minimal normal/automatic queue flow whose automatic appointments remain provisional until any Admin confirms them.

**Architecture:** Keep Google Sheets as the canonical store and the existing Google Form as intake. Separate paid-booking state from appointment state, use a pure slot-planning domain module plus Google Calendar adapter, deliver evidence through deterministic LINE message batches, and confirm provisional appointments through a short prefilled Google Form before doctor notification or call-task creation.

**Tech Stack:** TypeScript 6, Vitest, Apps Script V8, Google Forms/Sheets/Drive/Calendar advanced service, LINE Messaging API Flex Messages, esbuild, clasp.

**Spec:** `docs/superpowers/specs/2026-08-24-pmc-provisional-auto-queue-and-complete-evidence-design.md`

## Global Constraints

- Google Sheets remains the operational source of truth; JERA remains the only case-closing authority.
- Do not restore overlap blocking for staff-entered normal queues.
- Automatic candidates start on 30-minute boundaries, remain between 10:30 and 20:30 Asia/Bangkok, use the selected service duration, and search no later than six calendar months after payment receipt.
- A provisional appointment is gray Calendar color `8`, Admin-only, doctor-silent, and call-task-silent.
- Confirmation updates the same deterministic Calendar event, changes it to color `5`, sends doctor LINE once, and creates one Day 1–7 call task.
- Every file accepted by the booking Form is represented in Admin LINE; evidence remains private and is never sent to doctors.
- Use at most ten evidence bubbles per Flex carousel, at most five message objects per LINE push request, and keep each carousel under 50 KB.
- Preserve existing Case IDs, event IDs, Drive folders, audit history, and unrelated dirty-worktree changes.
- Do not mutate the live Form, Sheet schema, Script Properties, triggers, Calendar, or LINE groups without a fresh production approval at the gates in Task 13.

---

## Execution Preflight

The current workspace contains already-deployed but uncommitted booking changes. Before Task 1, record and verify the exact baseline without discarding or resetting it.

- [ ] Run the booking baseline checks.

```bash
git status --short -- apps/pmc-google-booking-ops
npm run booking:test
npm run booking:typecheck
npx eslint apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests apps/pmc-google-booking-ops/scripts
npm run booking:build
git diff --check
```

Expected: all tests/typecheck/lint/build pass; `git status` may remain dirty, but no pre-existing file is reverted.

- [ ] If any file listed in Tasks 1–12 is already modified, stop and obtain owner approval to create a verified baseline commit of the already-deployed booking changes. Do not hide, stash, reset, or mix those changes into a feature-task commit.

---

### Task 1: Queue and Appointment Domain Schema

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/domain/types.ts`
- Modify: `apps/pmc-google-booking-ops/src/config.ts`
- Modify: `apps/pmc-google-booking-ops/src/sheetSchema.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/sheetMigration.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleForms.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/flexValidation.ts`
- Modify: `apps/pmc-google-booking-ops/tests/formSubmit.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/facebookSchemaRegression.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`
- Create: `apps/pmc-google-booking-ops/tests/queueSchemaMigration.test.ts`

**Interfaces:**
- Produces: `QueueType = 'NORMAL' | 'AUTO'` and `AppointmentStatus = 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'`.
- Produces: nullable `BookingIntake.appointmentDate` and `appointmentTime` plus the canonical appointment-state fields on `BookingCase`. Canonical appointment timestamps remain non-null until Task 8 introduces the automatic no-slot state and updates every consumer in the same test cycle.
- Produces: backward-compatible `parseBookingFormEvent()` behavior where a missing queue-type answer means `NORMAL`.

- [ ] **Step 1: Write failing parser and migration tests**

Add these cases to `formSubmit.test.ts`:

```ts
const validBookingFormEvent = () => ({
  responseKey: 'response-1',
  submittedAt: '2026-08-20T09:00:00+07:00',
  submitterEmail: 'admin@example.com',
  namedValues: {
    Admin: ['Admin A'],
    AE: ['Admin A'],
    'ชื่อลูกค้า': ['ลูกค้าทดสอบ'],
    'ชื่อ Facebook': ['PMC Beauty'],
    'เบอร์มือถือ': ['0812345678'],
    หมอ: ['doctor-1'],
    'บริการ/โปรแกรม': ['service-1'],
    'วันที่นัด': ['2026-08-20'],
    'เวลานัด': ['13:00'],
    'จำนวนเงินจอง': ['1000'],
    'สลิปเงินจอง': ['payment-file-id-123456789012345'],
    'หลักฐานแชท': ['chat-file-id-123456789012345'],
  },
})

it('treats a legacy response with no queue type as NORMAL', () => {
  const intake = parseBookingFormEvent(validBookingFormEvent())
  expect(intake.queueType).toBe('NORMAL')
  expect(intake.appointmentDate).toBe('2026-08-20')
  expect(intake.appointmentTime).toBe('13:00')
})

it('parses AUTO without appointment date or time', () => {
  const event = validBookingFormEvent()
  event.namedValues['รูปแบบคิวนัดหมาย'] = ['คิวอัตโนมัติ']
  delete event.namedValues['วันที่นัด']
  delete event.namedValues['เวลานัด']
  expect(parseBookingFormEvent(event)).toMatchObject({
    queueType: 'AUTO',
    appointmentDate: null,
    appointmentTime: null,
  })
})
```

Create `queueSchemaMigration.test.ts`:

```ts
it('adds queue and appointment columns without shifting existing booking values', () => {
  const plan = bookingAppointmentMigrationPlan([
    'caseId', 'version', 'status', 'formResponseId', 'adminId', 'adminName',
    'submitterEmail', 'adminIdentityStatus', 'aeId', 'aeName', 'customerName',
    'facebookName', 'customerNameNormalized', 'phoneNormalized', 'phoneMasked',
  ])
  expect(plan.kind).toBe('INSERT_APPOINTMENT_COLUMNS')
  expect(plan.headers).toEqual([
    'queueType', 'appointmentStatus', 'appointmentProposedAt',
    'appointmentConfirmedAt', 'appointmentConfirmedBy',
  ])
})
```

- [ ] **Step 2: Run tests and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/queueSchemaMigration.test.ts
```

Expected: FAIL because queue types, fields, and migration planner do not exist.

- [ ] **Step 3: Add exact types and labels**

In `domain/types.ts` add:

```ts
export type QueueType = 'NORMAL' | 'AUTO'
export type AppointmentStatus = 'CONFIRMED' | 'TENTATIVE' | 'AWAITING_ADMIN_SLOT'

export interface BookingIntake {
  queueType: QueueType
  appointmentDate: string | null
  appointmentTime: string | null
}

export interface BookingCase {
  queueType: QueueType
  appointmentStatus: AppointmentStatus
  appointmentProposedAt: string | null
  appointmentConfirmedAt: string | null
  appointmentConfirmedBy: string | null
}
```

Add these members to the existing interfaces; retain all pre-existing members exactly as they are.

In `config.ts` add:

```ts
queueType: 'รูปแบบคิวนัดหมาย',
```

Insert the five canonical columns after `aeName` in `BOOKING_MASTER_COLUMNS` and update migration code so existing row values are never rewritten by position.

- [ ] **Step 4: Implement backward-compatible parsing**

In `googleForms.ts` use:

```ts
const queueAnswer = event.namedValues[BOOKING_FORM_LABELS.queueType]?.[0]?.trim()
const queueType = queueAnswer === 'คิวอัตโนมัติ' ? 'AUTO' : 'NORMAL'
const appointmentDate = event.namedValues[BOOKING_FORM_LABELS.appointmentDate]?.[0]?.trim() || null
const appointmentTime = event.namedValues[BOOKING_FORM_LABELS.appointmentTime]?.[0]?.trim() || null
if (queueType === 'NORMAL' && (!appointmentDate || !appointmentTime)) {
  throw new Error('normal queue requires appointment date and time')
}
```

Return all three values in `BookingIntake`. Update fixtures to default to `queueType: 'NORMAL'` and confirmed appointment-state fields.

Add the same five canonical defaults to the synthetic validation booking in `flexValidation.ts`:

```ts
queueType: 'NORMAL',
appointmentStatus: 'CONFIRMED',
appointmentProposedAt: null,
appointmentConfirmedAt: null,
appointmentConfirmedBy: null,
```

- [ ] **Step 5: Run focused tests and full booking tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/formSubmit.test.ts apps/pmc-google-booking-ops/tests/queueSchemaMigration.test.ts apps/pmc-google-booking-ops/tests/facebookSchemaRegression.test.ts
npm run booking:test
npm run booking:typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit only Task 1 files**

```bash
git add apps/pmc-google-booking-ops/src/domain/types.ts \
  apps/pmc-google-booking-ops/src/config.ts \
  apps/pmc-google-booking-ops/src/sheetSchema.ts \
  apps/pmc-google-booking-ops/src/domain/sheetMigration.ts \
  apps/pmc-google-booking-ops/src/adapters/googleForms.ts \
  apps/pmc-google-booking-ops/src/workflows/flexValidation.ts \
  apps/pmc-google-booking-ops/tests/formSubmit.test.ts \
  apps/pmc-google-booking-ops/tests/facebookSchemaRegression.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts \
  apps/pmc-google-booking-ops/tests/queueSchemaMigration.test.ts
git commit -m "feat: add booking appointment state"
```

---

### Task 2: Complete Evidence Reference Model

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/evidenceMedia.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/flexValidation.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/flexValidation.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Produces: `BookingEvidenceImages { payments, chats, totalPaymentCount, totalChatCount }`.
- Produces: `EvidenceMediaPort.images()` with zero truncation and stable ordinals per evidence kind.

- [ ] **Step 1: Write failing all-image tests**

In `evidenceMedia.test.ts` add:

```ts
it('returns every slip and chat reference in source order', () => {
  const images = port.images(
    'PMC-202608-0001',
    ['pay-1aaaaa', 'pay-2bbbbb', 'pay-3ccccc'],
    ['chat-1aaaa', 'chat-2bbbb', 'chat-3cccc', 'chat-4dddd', 'chat-5eeee', 'chat-6ffff'],
  )
  expect(images.payments).toHaveLength(3)
  expect(images.chats).toHaveLength(6)
  expect(images.totalPaymentCount).toBe(3)
  expect(images.totalChatCount).toBe(6)
  expect(images.payments[2].previewUrl).toContain('t=')
  expect(images.chats[5].fullUrl).toContain('t=')
})
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts
```

Expected: FAIL because `payment` is singular and chats are sliced to three.

- [ ] **Step 3: Replace the evidence shape and remove truncation**

In `ports.ts` define:

```ts
export interface BookingEvidenceImages {
  payments: EvidenceImageRef[]
  chats: EvidenceImageRef[]
  totalPaymentCount: number
  totalChatCount: number
}
```

In `evidenceMedia.ts` return:

```ts
return {
  payments: paymentFileIds.map((fileId, index) =>
    imageRef(baseUrl, caseId, fileId, 'PAYMENT', index + 1, secret, crypto),
  ),
  chats: chatFileIds.map((fileId, index) =>
    imageRef(baseUrl, caseId, fileId, 'CHAT', index + 1, secret, crypto),
  ),
  totalPaymentCount: paymentFileIds.length,
  totalChatCount: chatFileIds.length,
}
```

Update all fakes and empty fallbacks to the new four-field shape.

Use this exact empty value in Form submission and retry fallbacks:

```ts
const emptyEvidence: BookingEvidenceImages = {
  payments: [],
  chats: [],
  totalPaymentCount: paymentEvidenceFileIds.length,
  totalChatCount: chatEvidenceFileIds.length,
}
```

For this task only, keep the existing compact thumbnail behavior compiling by reading `evidence.payments[0]` and `evidence.chats.slice(0, 3)`. Task 3 removes this presentation truncation and replaces it with complete carousels.

Add this reusable test fixture to `tests/helpers/fakes.ts`:

```ts
export function evidenceFixture(input: {
  paymentCount: number
  chatCount: number
}): BookingEvidenceImages {
  const ref = (kind: 'payment' | 'chat', index: number): EvidenceImageRef => ({
    previewUrl: `https://media.test/${kind}-${index + 1}/preview`,
    fullUrl: `https://media.test/${kind}-${index + 1}/full`,
  })
  return {
    payments: Array.from({ length: input.paymentCount }, (_, index) => ref('payment', index)),
    chats: Array.from({ length: input.chatCount }, (_, index) => ref('chat', index)),
    totalPaymentCount: input.paymentCount,
    totalChatCount: input.chatCount,
  }
}
```

- [ ] **Step 4: Run evidence, booking, and type tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
npm run booking:typecheck
npm run booking:test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/src/adapters/evidenceMedia.ts \
  apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts \
  apps/pmc-google-booking-ops/src/workflows/formSubmit.ts \
  apps/pmc-google-booking-ops/src/workflows/flexValidation.ts \
  apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts \
  apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts \
  apps/pmc-google-booking-ops/tests/flexValidation.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: preserve every booking evidence image"
```

---

### Task 3: Evidence Flex Carousels

**Files:**
- Create: `apps/pmc-google-booking-ops/src/adapters/evidenceCarouselFlex.ts`
- Create: `apps/pmc-google-booking-ops/tests/evidenceCarouselFlex.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts`
- Modify: `apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts`

**Interfaces:**
- Consumes: complete `BookingEvidenceImages` from Task 2.
- Produces: `buildEvidenceFlexMessages(evidence): Record<string, unknown>[]`, one Flex object per ten images.
- Produces: booking summary Flex with counts but without the old partial thumbnail strip.

- [ ] **Step 1: Write failing carousel tests**

Create `evidenceCarouselFlex.test.ts`:

```ts
it('builds all images in slip-first batches of ten', () => {
  const evidence = evidenceFixture({ paymentCount: 3, chatCount: 19 })
  const messages = buildEvidenceFlexMessages(evidence)
  expect(messages).toHaveLength(3)
  const bubbles = messages.flatMap((message) =>
    (message.contents as { contents: unknown[] }).contents,
  )
  expect(bubbles).toHaveLength(22)
  expect(JSON.stringify(bubbles[0])).toContain('สลิป 1')
  expect(JSON.stringify(bubbles[2])).toContain('สลิป 3')
  expect(JSON.stringify(bubbles[3])).toContain('แชท 1')
  for (const message of messages) {
    expect(JSON.stringify(message).length).toBeLessThan(50_000)
  }
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/evidenceCarouselFlex.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement evidence bubbles and ten-item chunks**

Create these exact exports:

```ts
export interface LabeledEvidenceImage extends EvidenceImageRef {
  label: string
}

export function labeledEvidence(evidence: BookingEvidenceImages): LabeledEvidenceImage[] {
  return [
    ...evidence.payments.map((image, index) => ({ ...image, label: `สลิป ${index + 1}` })),
    ...evidence.chats.map((image, index) => ({ ...image, label: `แชท ${index + 1}` })),
  ]
}

export function buildEvidenceFlexMessages(evidence: BookingEvidenceImages): Record<string, unknown>[] {
  const images = labeledEvidence(evidence)
  const chunks = Array.from({ length: Math.ceil(images.length / 10) }, (_, index) =>
    images.slice(index * 10, index * 10 + 10),
  )
  return chunks.map((chunk, index) => ({
    type: 'flex',
    altText: `หลักฐานการจอง ชุด ${index + 1}/${chunks.length}`,
    contents: { type: 'carousel', contents: chunk.map(evidenceBubble) },
  }))
}
```

`evidenceBubble()` renders one square preview, one label, and `action.uri = fullUrl`.

Implement it as:

```ts
function evidenceBubble(image: LabeledEvidenceImage): Record<string, unknown> {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      contents: [
        {
          type: 'image',
          url: image.previewUrl,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover',
          action: { type: 'uri', label: 'เปิดรูปขนาดเต็ม', uri: image.fullUrl },
        },
        { type: 'text', text: image.label, size: 'xs', align: 'center', margin: 'sm' },
      ],
    },
  }
}
```

- [ ] **Step 4: Remove the partial strip from the summary**

Replace the `หลักฐาน` body contents in `buildAdminMinimalReceipt()` with:

```ts
sectionTitle('หลักฐาน'),
keyValueRow('สลิป', `${evidence.totalPaymentCount} รูป`),
keyValueRow('แชท', `${evidence.totalChatCount} รูป`),
{
  type: 'text',
  text: 'รูปทั้งหมดแสดงในข้อความถัดไป',
  size: 'xxs',
  color: SECONDARY,
  margin: 'sm',
},
```

Delete `evidenceStrip()` and its three-chat slice.

- [ ] **Step 5: Run focused and full tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/evidenceCarouselFlex.test.ts apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts
npm run booking:test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/pmc-google-booking-ops/src/adapters/evidenceCarouselFlex.ts \
  apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts \
  apps/pmc-google-booking-ops/tests/evidenceCarouselFlex.test.ts \
  apps/pmc-google-booking-ops/tests/minimalReceiptFlex.test.ts
git commit -m "feat: render complete evidence carousels"
```

---

### Task 4: LINE Multi-Message Batch Delivery

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`
- Create: `apps/pmc-google-booking-ops/tests/lineEvidenceBatchRetry.test.ts`

**Interfaces:**
- Consumes: summary Flex plus evidence Flex messages from Task 3.
- Produces: `LineMessage.apiMessages?: Record<string, unknown>[]` with 1–5 objects.
- Produces: `adminBookingMessageBatches()` with deterministic batch indices and retry keys.

- [ ] **Step 1: Write failing batch and retry tests**

```ts
it('packs summary plus evidence into requests of at most five objects', () => {
  const logoUrl = 'https://evidence.example/assets/pmc-flex-logo-v1.png'
  const batches = adminBookingMessageBatches(
    bookingFixture(), 'admin-group', evidenceFixture({ paymentCount: 2, chatCount: 49 }),
    logoUrl, 4,
  )
  expect(batches).toHaveLength(2)
  expect(batches[0].apiMessages).toHaveLength(5)
  expect(batches[1].apiMessages).toHaveLength(1)
  expect(batches.map((item) => item.retryKey)).toEqual([
    'PMC-202608-0001:ADMIN_BOOKING_CONFIRMED:4:BATCH:1',
    'PMC-202608-0001:ADMIN_BOOKING_CONFIRMED:4:BATCH:2',
  ])
})

it('retries only the failed evidence batch', () => {
  const ports = createTestPorts({ lineFailsAtPush: 2 })
  const result = submitBookingIntake(validBookingIntake({
    paymentEvidenceFileIds: Array.from({ length: 2 }, (_, index) => `payment-file-${index + 1}`),
    chatEvidenceFileIds: Array.from({ length: 49 }, (_, index) => `chat-file-${index + 1}`),
  }), ports)
  expect(result.lineState).toBe('RETRY')
  expect(ports.retries.listPending()).toMatchObject([
    { operation: 'ADMIN_BOOKING_LINE_BATCH', payload: { batchIndex: 1 } },
  ])
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts apps/pmc-google-booking-ops/tests/lineEvidenceBatchRetry.test.ts
```

Expected: FAIL because batches and `apiMessages` do not exist.

- [ ] **Step 3: Extend the LINE envelope and adapter**

In `ports.ts` add:

```ts
apiMessages?: Record<string, unknown>[]
```

In `createGoogleLinePort.push()` use:

```ts
const messages = message.apiMessages ?? [message.apiMessage ?? { type: 'text', text: message.text }]
if (messages.length < 1 || messages.length > 5) throw new Error('LINE push requires 1-5 messages')
payload: JSON.stringify({ to: message.to, messages })
```

Keep the existing `Authorization` and deterministic `X-Line-Retry-Key` headers unchanged.

- [ ] **Step 4: Build deterministic Admin envelopes**

Export:

```ts
export function adminBookingMessageBatches(
  booking: BookingCase,
  adminLineGroupId: string,
  evidence: BookingEvidenceImages,
  brandLogoUrl: string,
  messageVersion = booking.version,
  profiles?: TeamProfileImages,
): LineMessage[]
```

Compose `[summary, ...buildEvidenceFlexMessages(evidence)]`, slice into groups of five, and suffix retry keys with one-based `BATCH:n`.

Use:

```ts
const objects = [summaryMessage, ...buildEvidenceFlexMessages(evidence)]
return Array.from({ length: Math.ceil(objects.length / 5) }, (_, batchIndex) => ({
  to: adminLineGroupId,
  audience: 'admin' as const,
  eventType: 'BOOKING_CONFIRMED' as const,
  caseIds: [booking.caseId],
  text: `จองเคสใหม่ · ${booking.customerName}`,
  apiMessages: objects.slice(batchIndex * 5, batchIndex * 5 + 5),
  retryKey: `${booking.caseId}:ADMIN_BOOKING_CONFIRMED:${messageVersion}:BATCH:${batchIndex + 1}`,
}))
```

- [ ] **Step 5: Persist the failed batch index**

When an Admin batch push fails, enqueue:

```ts
{
  id: `RETRY-${caseId}-ADMIN-LINE-BATCH-${batchIndex + 1}`,
  caseId,
  operation: 'ADMIN_BOOKING_LINE_BATCH',
  idempotencyKey: `${caseId}:ADMIN_BOOKING_LINE_BATCH:${messageVersion}:${batchIndex + 1}`,
  attempts: 0,
  status: 'PENDING',
  safeError,
  payload: { paymentEvidenceFileIds, chatEvidenceFileIds, messageVersion, batchIndex },
}
```

The retry workflow rebuilds all deterministic batches but pushes only `batches[batchIndex]`. Doctor LINE keeps an independent retry operation.

- [ ] **Step 6: Run focused, failure, and full tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/lineEvidenceBatchRetry.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts
npm run booking:test
```

Expected: PASS with no duplicate accepted batch.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts \
  apps/pmc-google-booking-ops/src/workflows/formSubmit.ts \
  apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts \
  apps/pmc-google-booking-ops/tests/lineEvidenceBatchRetry.test.ts
git commit -m "feat: deliver evidence in retry-safe LINE batches"
```

---

### Task 5: Pure Automatic Slot Planner

**Files:**
- Create: `apps/pmc-google-booking-ops/src/domain/automaticQueue.ts`
- Create: `apps/pmc-google-booking-ops/tests/automaticQueue.test.ts`

**Interfaces:**
- Produces: `CalendarInterval`, `AutomaticQueueInput`, and `proposeAutomaticAppointment(input): { start, end } | null`.
- Does not access Apps Script globals.

- [ ] **Step 1: Write the failing planner matrix**

```ts
it('chooses the first clear 30-minute boundary after a confirmed doctor case', () => {
  expect(proposeAutomaticAppointment({
    durationMinutes: 60,
    submittedAt: '2026-08-24T09:00:00+07:00',
    expiresAt: '2027-02-24T09:00:00+07:00',
    doctorCases: [{ start: '2026-08-25T13:00:00+07:00', end: '2026-08-25T14:00:00+07:00' }],
    busy: [{ start: '2026-08-25T15:00:00+07:00', end: '2026-08-25T16:00:00+07:00' }],
  })).toEqual({
    start: '2026-08-25T14:00:00+07:00',
    end: '2026-08-25T15:00:00+07:00',
  })
})

it('moves by 30 minutes and returns null outside the approved horizon', () => {
  expect(proposeAutomaticAppointment({
    durationMinutes: 60,
    submittedAt: '2026-08-24T09:00:00+07:00',
    expiresAt: '2026-08-24T23:59:59+07:00',
    doctorCases: [],
    busy: [],
  })).toBeNull()
})
```

Add:

```ts
it('allows a clear 20:30 start even when the service ends later', () => {
  expect(proposeAutomaticAppointment({
    durationMinutes: 60,
    submittedAt: '2026-08-24T09:00:00+07:00',
    expiresAt: '2027-02-24T09:00:00+07:00',
    doctorCases: [{ start: '2026-08-25T19:30:00+07:00', end: '2026-08-25T20:30:00+07:00' }],
    busy: [],
  })).toEqual({
    start: '2026-08-25T20:30:00+07:00',
    end: '2026-08-25T21:30:00+07:00',
  })
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/automaticQueue.test.ts
```

Expected: FAIL because the planner does not exist.

- [ ] **Step 3: Implement pure interval planning**

Use these exports:

```ts
export interface CalendarInterval { start: string; end: string }
export interface AutomaticQueueInput {
  durationMinutes: number
  submittedAt: string
  expiresAt: string
  doctorCases: CalendarInterval[]
  busy: CalendarInterval[]
}

export function proposeAutomaticAppointment(
  input: AutomaticQueueInput,
): CalendarInterval | null
```

Implementation rules inside the function:

```ts
function roundUpThirty(valueIso: string): string {
  const minute = Number(valueIso.slice(14, 16))
  const second = Number(valueIso.slice(17, 19))
  const delta = minute % 30 === 0 && second === 0 ? 0 : 30 - (minute % 30)
  return addMinutesInBangkok(`${valueIso.slice(0, 17)}00${valueIso.slice(19)}`, delta)
}

function startsEveryThirtyMinutes(first: string, lastStartTime: string): string[] {
  const starts: string[] = []
  for (let cursor = first; cursor.slice(11, 16) <= lastStartTime; cursor = addMinutesInBangkok(cursor, 30)) {
    starts.push(cursor)
  }
  return starts
}

const candidates = [...input.doctorCases]
  .sort((left, right) => left.end.localeCompare(right.end))
  .flatMap((doctorCase) => startsEveryThirtyMinutes(roundUpThirty(doctorCase.end), '20:30'))
  .filter((start) => start.slice(0, 10) >= input.submittedAt.slice(0, 10))
  .filter((start) => start <= input.expiresAt)
```

Deduplicate and sort candidate starts. Derive the end with `addMinutesInBangkok`, require start at or after 10:30 and at or before 20:30, and reject any full-interval overlap with `busy`.

- [ ] **Step 4: Run planner tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/automaticQueue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/pmc-google-booking-ops/src/domain/automaticQueue.ts \
  apps/pmc-google-booking-ops/tests/automaticQueue.test.ts
git commit -m "feat: plan provisional automatic appointments"
```

---

### Task 6: Calendar Query and Provisional Event Presentation

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts`
- Create: `apps/pmc-google-booking-ops/tests/provisionalCalendar.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Produces: `CalendarPort.listEvents(calendarId, start, end): CalendarInterval[]`.
- Changes: `CalendarPort.updateEvent(eventId, input): 'UPDATED' | 'NOT_FOUND'` so confirmation recovery does not parse provider error strings.
- Produces: `calendarEventInput()` that uses appointment status to select title, color, and private metadata.

- [ ] **Step 1: Write failing provisional Calendar tests**

```ts
it('renders a gray tentative event with private appointment metadata', () => {
  expect(calendarEventInput(bookingFixture({
    appointmentStatus: 'TENTATIVE',
    appointmentStart: '2026-08-25T14:00:00+07:00',
    appointmentEnd: '2026-08-25T15:00:00+07:00',
  }))).toMatchObject({
    colorId: '8',
    summary: 'รอยืนยัน | doctor-1 | service-1 | ลูกค้าทดสอบ',
    privateProperties: {
      caseId: 'PMC-202608-0001',
      doctorId: 'doctor-1',
      appointmentStatus: 'TENTATIVE',
    },
  })
})
```

Add:

```ts
it('renders a confirmed event in color 5 without a tentative prefix', () => {
  const input = calendarEventInput(bookingFixture({ appointmentStatus: 'CONFIRMED' }))
  expect(input.colorId).toBe('5')
  expect(input.summary).not.toContain('รอยืนยัน |')
  expect(input.privateProperties.appointmentStatus).toBe('CONFIRMED')
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/provisionalCalendar.test.ts
```

Expected: FAIL because private properties and tentative rendering do not exist.

- [ ] **Step 3: Extend Calendar interfaces and resource mapping**

In `CalendarEventInput` add:

```ts
privateProperties: Record<string, string>
```

Map it to:

```ts
extendedProperties: { private: input.privateProperties }
```

Add `CalendarPort.listEvents()` and map Calendar API items with both start/end dateTime values into `CalendarInterval[]`.

Change `updateEvent()` to return `UPDATED` after a successful Calendar API update and `NOT_FOUND` only when the Calendar API reports HTTP 404; rethrow every other error. Update the fake Calendar port with the same return contract.

Extend `TestPortOptions` and `createFakeCalendar()` with:

```ts
calendarEvents?: CalendarInterval[]
calendarUpdateResult?: 'UPDATED' | 'NOT_FOUND'
```

`listEvents()` returns a clone of `calendarEvents ?? []`; `updateEvent()` records the attempted update and returns `calendarUpdateResult ?? 'UPDATED'`.

- [ ] **Step 4: Render tentative and confirmed variants**

At the top of `calendarEventInput()` require non-null appointment timestamps. Use:

```ts
const tentative = booking.appointmentStatus === 'TENTATIVE'
const baseSummary = `${booking.doctorId} | ${booking.serviceId} | ${firstCustomerName(booking.customerName)}`
const summary = tentative ? `รอยืนยัน | ${baseSummary}` : baseSummary
const colorId = tentative ? '8' : '5'
```

Append `สถานะนัด: รอยืนยัน` only for tentative events.

- [ ] **Step 5: Run focused and Calendar regression tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/provisionalCalendar.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts apps/pmc-google-booking-ops/tests/calendarCapacity.test.ts
npm run booking:typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts \
  apps/pmc-google-booking-ops/tests/provisionalCalendar.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: support provisional Calendar events"
```

---

### Task 7: Queue Confirmation Form Adapter

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/config.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/types.ts`
- Create: `apps/pmc-google-booking-ops/src/domain/queueConfirmation.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleForms.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Create: `apps/pmc-google-booking-ops/tests/queueConfirmationForm.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Produces: `QueueConfirmationInput` and `parseQueueConfirmationFormEvent()`.
- Produces: `queueConfirmationFormResponseEvent(event)` that converts an Apps Script Form event into `{ submittedAt, submitterEmail, namedValues }` without using call-result semantics.
- Produces: `FormsPort.queueConfirmationUrl(input)`.
- Produces: `FormsPort.ensureQueueConfirmationForm()` for the idempotent confirmation Form structure. Booking Form branching is implemented in Task 10.

- [ ] **Step 1: Write failing confirmation parse tests**

```ts
it('parses any Admin confirmation email and a prefilled proposal', () => {
  expect(parseQueueConfirmationFormEvent({
    submittedAt: '2026-08-24T12:00:00+07:00',
    submitterEmail: 'staff.personal@gmail.com',
    namedValues: {
      'Case ID': ['PMC-202608-0001'],
      'การดำเนินการ': ['ยืนยันคิวนี้'],
      'วันที่ยืนยัน': ['2026-08-25'],
      'เวลายืนยัน': ['14:00'],
    },
  })).toEqual({
    caseId: 'PMC-202608-0001',
    action: 'CONFIRM',
    appointmentDate: '2026-08-25',
    appointmentTime: '14:00',
    actorEmail: 'staff.personal@gmail.com',
    submittedAt: '2026-08-24T12:00:00+07:00',
  })
})
```

Add `เปลี่ยนวัน` mapping to `CHANGE` and rejection of an invalid Case ID.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/queueConfirmationForm.test.ts
```

Expected: FAIL because the parser and type do not exist.

- [ ] **Step 3: Define confirmation types and labels**

```ts
export interface QueueConfirmationInput {
  caseId: string
  action: 'CONFIRM' | 'CHANGE'
  appointmentDate: string
  appointmentTime: string
  actorEmail: string
  submittedAt: string
}
```

Export from `googleForms.ts`:

```ts
export interface QueueConfirmationFormEventInput {
  submittedAt: string
  submitterEmail: string
  namedValues: Record<string, string[]>
}

export function queueConfirmationFormResponseEvent(
  event: GoogleAppsScript.Events.FormsOnFormSubmit,
): QueueConfirmationFormEventInput {
  return {
    submittedAt: bangkokIso(event.response.getTimestamp()),
    submitterEmail: event.response.getRespondentEmail(),
    namedValues: formNamedValues(event.response),
  }
}
```

Add Script Property key:

```ts
queueConfirmationFormId: 'PMC_QUEUE_CONFIRMATION_FORM_ID',
```

Keep it optional until the production cutover operator creates and stores the Form ID.

- [ ] **Step 4: Implement parsing and prefilled URL generation**

Add to `FormsPort`:

```ts
queueConfirmationUrl(input: {
  caseId: string
  action: 'CONFIRM' | 'CHANGE'
  appointmentDate?: string
  appointmentTime?: string
}): string
ensureQueueConfirmationForm(): { confirmationFormReady: true }
```

Update `createTestPorts()` with deterministic implementations:

```ts
queueConfirmationUrl: ({ caseId, action, appointmentDate, appointmentTime }) =>
  `https://forms.test/queue?case=${caseId}&action=${action}&date=${appointmentDate ?? ''}&time=${appointmentTime ?? ''}`,
ensureQueueConfirmationForm: () => ({ confirmationFormReady: true }),
```

`queueConfirmationUrl()` uses `Form.createResponse()`, creates responses for the four exact item titles, and returns `toPrefilledUrl()`.

For `CONFIRM`, prefill all four items. For `CHANGE` from `AWAITING_ADMIN_SLOT`, prefill only Case ID and action; omit empty Date/Time item responses so Google Forms requires the Admin to enter them.

- [ ] **Step 5: Create the pure Form structure plan**

In `queueConfirmation.ts` export the canonical titles and choices:

```ts
export const QUEUE_TYPE_TITLE = 'รูปแบบคิวนัดหมาย'
export const QUEUE_TYPE_CHOICES = ['คิวปกติ', 'คิวอัตโนมัติ'] as const
export const QUEUE_CONFIRM_ACTIONS = ['ยืนยันคิวนี้', 'เปลี่ยนวัน'] as const
```

`ensureQueueConfirmationForm()` must be idempotent and produce one confirmation Form containing Case ID, action, date, time, and collected email.

- [ ] **Step 6: Run tests and commit Task 7**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/queueConfirmationForm.test.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts
npm run booking:typecheck
git add apps/pmc-google-booking-ops/src/config.ts \
  apps/pmc-google-booking-ops/src/domain/types.ts \
  apps/pmc-google-booking-ops/src/domain/queueConfirmation.ts \
  apps/pmc-google-booking-ops/src/adapters/googleForms.ts \
  apps/pmc-google-booking-ops/src/ports.ts \
  apps/pmc-google-booking-ops/tests/queueConfirmationForm.test.ts \
  apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: add queue confirmation form adapter"
```

---

### Task 8: Automatic Submission Workflow

**Files:**
- Create: `apps/pmc-google-booking-ops/src/workflows/automaticQueue.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Create: `apps/pmc-google-booking-ops/src/domain/appointment.ts`
- Modify: `apps/pmc-google-booking-ops/src/domain/types.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/callQueue.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/dashboard.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/integrity.ts`
- Create: `apps/pmc-google-booking-ops/tests/automaticQueueWorkflow.test.ts`
- Create: `apps/pmc-google-booking-ops/tests/appointment.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/endToEnd.test.ts`

**Interfaces:**
- Consumes: queue types, slot planner, Calendar query, evidence batches, and confirmation URL.
- Produces: `prepareAutomaticQueue(booking, ports): BookingCase`.
- Produces: Admin provisional/awaiting-slot Flex; doctor remains silent.

- [ ] **Step 1: Write failing workflow tests**

```ts
function confirmedDoctorCaseFor(date: string, doctorId: string): BookingCase {
  return bookingFixture({
    caseId: 'PMC-202608-9999',
    formResponseId: 'existing-doctor-case',
    doctorId,
    appointmentStatus: 'CONFIRMED',
    appointmentStart: `${date}T13:00:00+07:00`,
    appointmentEnd: `${date}T14:00:00+07:00`,
    calendarEventId: 'existing-event-9999',
  })
}

it('creates a paid tentative booking but no doctor message or call task', () => {
  const ports = createTestPorts({
    calendarEvents: [{ start: '2026-08-25T13:00:00+07:00', end: '2026-08-25T14:00:00+07:00' }],
  })
  ports.bookings.insert(confirmedDoctorCaseFor('2026-08-25', 'doctor-1'))
  const result = submitBookingIntake(validBookingIntake({
    queueType: 'AUTO', appointmentDate: null, appointmentTime: null,
  }), ports)
  expect(result).toMatchObject({
    status: 'BOOKING_CONFIRMED',
    appointmentStatus: 'TENTATIVE',
    appointmentStart: '2026-08-25T14:00:00+07:00',
  })
  expect(ports.calendar.createdEvents()[0].colorId).toBe('8')
  expect(ports.line.adminMessages()).not.toHaveLength(0)
  expect(ports.line.doctorMessages()).toEqual([])
  expect(ports.calls.list()).toEqual([])
})

it('keeps the paid booking and awaits Admin when no candidate exists', () => {
  const ports = createTestPorts()
  const result = submitBookingIntake(validBookingIntake({
    queueType: 'AUTO', appointmentDate: null, appointmentTime: null,
  }), ports)
  expect(result.appointmentStatus).toBe('AWAITING_ADMIN_SLOT')
  expect(result.calendarEventId).toBeNull()
  expect(ports.line.doctorMessages()).toEqual([])
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/automaticQueueWorkflow.test.ts
```

Expected: FAIL because AUTO still requires date/time and follows the normal doctor path.

- [ ] **Step 3: Split paid-booking creation from appointment fulfillment**

In `submitBookingIntake()`:

```ts
if (intake.queueType === 'AUTO' && (intake.appointmentDate || intake.appointmentTime)) {
  throw new Error('automatic queue must not contain placeholder appointment values')
}
```

Create the canonical paid booking and Drive evidence first. For `NORMAL`, call the existing confirmed appointment path. For `AUTO`, call `prepareAutomaticQueue()` and never call `createInitialCallTask()` or doctor messaging.

In this task, change canonical timestamps to nullable:

```ts
appointmentStart: string | null
appointmentEnd: string | null
```

Create `domain/appointment.ts`:

```ts
export function requireAppointment(booking: BookingCase): {
  start: string
  end: string
} {
  if (!booking.appointmentStart || !booking.appointmentEnd) {
    throw new Error(`booking has no appointment: ${booking.caseId}`)
  }
  return { start: booking.appointmentStart, end: booking.appointmentEnd }
}
```

In `appointment.test.ts` add:

```ts
it('requires a real appointment only at confirmed consumers', () => {
  expect(requireAppointment(bookingFixture())).toEqual({
    start: '2026-08-20T13:00:00+07:00',
    end: '2026-08-20T14:00:00+07:00',
  })
  expect(() => requireAppointment(bookingFixture({
    appointmentStatus: 'AWAITING_ADMIN_SLOT',
    appointmentStart: null,
    appointmentEnd: null,
  }))).toThrow('booking has no appointment')
})
```

Use `requireAppointment()` in Calendar rendering, confirmed booking Flex, rescheduling, and call-task creation. Doctor daily schedules skip null appointments. Dashboard may emit null. Integrity requires a Calendar event only when `appointmentStatus` is `CONFIRMED` or `TENTATIVE`; `AWAITING_ADMIN_SLOT` is not an integrity failure.

- [ ] **Step 4: Implement `prepareAutomaticQueue()`**

The workflow:

```ts
function requireCalendarId(booking: BookingCase): string {
  if (!booking.calendarId) throw new Error('doctor calendar is not configured')
  return booking.calendarId
}

function requireServiceConfig(booking: BookingCase, ports: BookingPorts): ServiceConfig {
  const service = ports.config.findService(booking.serviceId)
  if (!service?.active) throw new Error(`service is not active: ${booking.serviceId}`)
  return service
}

function bookingInterval(booking: BookingCase): CalendarInterval {
  if (!booking.appointmentStart || !booking.appointmentEnd) {
    throw new Error(`confirmed booking has no appointment: ${booking.caseId}`)
  }
  return { start: booking.appointmentStart, end: booking.appointmentEnd }
}

const doctorCases = ports.repositories.bookings.list().filter((candidate) =>
  candidate.doctorId === booking.doctorId &&
  candidate.appointmentStatus === 'CONFIRMED' &&
  candidate.appointmentStart && candidate.appointmentEnd &&
  candidate.appointmentStart >= booking.createdAt &&
  candidate.appointmentStart <= booking.depositExpiresAt,
)
const busy = ports.calendar.listEvents(
  requireCalendarId(booking), booking.createdAt, booking.depositExpiresAt,
)
const proposal = proposeAutomaticAppointment({
  durationMinutes: requireServiceConfig(booking, ports).durationMinutes,
  submittedAt: booking.createdAt,
  expiresAt: booking.depositExpiresAt,
  doctorCases: doctorCases.map(bookingInterval),
  busy,
})
```

When `proposal` is null, update `appointmentStatus` to `AWAITING_ADMIN_SLOT`. Otherwise update timestamps, create the gray event, and store its ID.

- [ ] **Step 5: Add concise provisional Admin Flex variants**

Export:

```ts
buildAdminTentativeReceipt(booking, confirmUrl, changeUrl, brandLogoUrl, profiles)
buildAdminAwaitingSlotReceipt(booking, changeUrl, brandLogoUrl, profiles)
```

The tentative card displays proposed date/time and two actions. The awaiting card displays `รอ Admin เลือกวัน` and one `เลือกวัน` action. Both use the complete evidence batches from Task 4.

- [ ] **Step 6: Run focused and full tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/automaticQueueWorkflow.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
npm run booking:test
```

Expected: PASS; normal queue behavior remains unchanged.

- [ ] **Step 7: Commit Task 8**

```bash
git add apps/pmc-google-booking-ops/src/workflows/automaticQueue.ts \
  apps/pmc-google-booking-ops/src/workflows/formSubmit.ts \
  apps/pmc-google-booking-ops/src/domain/appointment.ts \
  apps/pmc-google-booking-ops/src/domain/types.ts \
  apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts \
  apps/pmc-google-booking-ops/src/adapters/minimalReceiptFlex.ts \
  apps/pmc-google-booking-ops/src/adapters/googleCalendar.ts \
  apps/pmc-google-booking-ops/src/workflows/callQueue.ts \
  apps/pmc-google-booking-ops/src/workflows/bookingUpdate.ts \
  apps/pmc-google-booking-ops/src/workflows/dashboard.ts \
  apps/pmc-google-booking-ops/src/workflows/integrity.ts \
  apps/pmc-google-booking-ops/tests/automaticQueueWorkflow.test.ts \
  apps/pmc-google-booking-ops/tests/appointment.test.ts \
  apps/pmc-google-booking-ops/tests/endToEnd.test.ts
git commit -m "feat: create provisional automatic queues"
```

---

### Task 9: Idempotent Queue Confirmation Workflow

**Files:**
- Create: `apps/pmc-google-booking-ops/src/workflows/queueConfirmation.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Create: `apps/pmc-google-booking-ops/tests/queueConfirmationWorkflow.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/build.test.ts`

**Interfaces:**
- Consumes: `QueueConfirmationInput` and canonical tentative booking.
- Produces: `confirmQueue(input, ports): BookingCase` and Apps Script entrypoint `onQueueConfirmationSubmit(event)`.

- [ ] **Step 1: Write failing confirmation transaction tests**

```ts
function tentativeBookingFixture(): BookingCase {
  return bookingFixture({
    appointmentStatus: 'TENTATIVE',
    appointmentStart: '2026-08-25T14:00:00+07:00',
    appointmentEnd: '2026-08-25T15:00:00+07:00',
    calendarId: 'doctor-calendar-1',
    calendarEventId: 'tentative-event-1',
    doctorLineGroupId: 'doctor-group-1',
  })
}

function validQueueConfirmation(): QueueConfirmationInput {
  return {
    caseId: 'PMC-202608-0001',
    action: 'CONFIRM',
    appointmentDate: '2026-08-25',
    appointmentTime: '14:00',
    actorEmail: 'staff.personal@gmail.com',
    submittedAt: '2026-08-24T12:00:00+07:00',
  }
}

it('updates the same Calendar event and starts doctor and call workflows once', () => {
  const ports = createTestPorts()
  ports.bookings.insert(tentativeBookingFixture())
  const first = confirmQueue(validQueueConfirmation(), ports)
  const second = confirmQueue(validQueueConfirmation(), ports)
  expect(first.appointmentStatus).toBe('CONFIRMED')
  expect(second.calendarEventId).toBe(first.calendarEventId)
  expect(ports.calendar.createdEvents()).toHaveLength(0)
  expect(ports.calendar.updatedEvents()).toHaveLength(1)
  expect(ports.calendar.updatedEvents()[0].input.colorId).toBe('5')
  expect(ports.line.doctorMessages()).toHaveLength(1)
  expect(ports.calls.list()).toHaveLength(1)
  expect(first.appointmentConfirmedBy).toBe('staff.personal@gmail.com')
})
```

Add:

```ts
it('recreates one deterministic confirmed event when the tentative event was deleted', () => {
  const ports = createTestPorts({ calendarUpdateResult: 'NOT_FOUND' })
  ports.bookings.insert(tentativeBookingFixture())
  const confirmed = confirmQueue(validQueueConfirmation(), ports)
  expect(confirmed.appointmentStatus).toBe('CONFIRMED')
  expect(ports.calendar.updatedEvents()).toHaveLength(1)
  expect(ports.calendar.createdEvents()).toHaveLength(1)
  expect(ports.calendar.createdEvents()[0].externalId).toBe(
    'PMC-202608-0001:response-1:confirmed-recovery',
  )
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/queueConfirmationWorkflow.test.ts apps/pmc-google-booking-ops/tests/build.test.ts
```

Expected: FAIL because the workflow and entrypoint do not exist.

- [ ] **Step 3: Implement the locked idempotent transaction**

```ts
function requireBooking(caseId: string, ports: BookingPorts): BookingCase {
  const booking = ports.repositories.bookings.getByCaseId(caseId)
  if (!booking) throw new Error(`booking not found: ${caseId}`)
  return booking
}

function requireServiceDuration(booking: BookingCase, ports: BookingPorts): number {
  const service = ports.config.findService(booking.serviceId)
  if (!service?.active) throw new Error(`service is not active: ${booking.serviceId}`)
  return service.durationMinutes
}

function upsertConfirmedCalendarEvent(
  booking: BookingCase,
  calendar: CalendarPort,
): string {
  const input = calendarEventInput(booking)
  if (booking.calendarEventId) {
    const result = calendar.updateEvent(booking.calendarEventId, input)
    if (result === 'UPDATED') return booking.calendarEventId
  }
  return calendar.createEvent({
    ...input,
    externalId: `${booking.caseId}:${booking.formResponseId}:confirmed-recovery`,
  })
}

export function confirmQueue(input: QueueConfirmationInput, ports: BookingPorts): BookingCase {
  const confirmed = ports.locks.withLock(() => {
    const booking = requireBooking(input.caseId, ports)
    if (booking.appointmentStatus === 'CONFIRMED') return booking
    const start = `${input.appointmentDate}T${input.appointmentTime}:00+07:00`
    const end = addMinutesInBangkok(start, requireServiceDuration(booking, ports))
    const candidate = { ...booking, appointmentStart: start, appointmentEnd: end, appointmentStatus: 'CONFIRMED' as const }
    const calendarEventId = upsertConfirmedCalendarEvent(candidate, ports.calendar)
    return ports.repositories.bookings.update(
      booking.caseId,
      booking.version,
      {
        appointmentStart: start,
        appointmentEnd: end,
        appointmentStatus: 'CONFIRMED',
        appointmentConfirmedAt: input.submittedAt,
        appointmentConfirmedBy: input.actorEmail,
        calendarEventId,
        calendarState: 'OK',
      },
      { actor: input.actorEmail, reason: 'Automatic queue confirmed', correlationId: `${booking.caseId}:QUEUE_CONFIRM` },
    )
  })
  createInitialCallTask(confirmed, ports)
  if (!confirmed.doctorLineNotifiedAt) {
    try {
      sendDoctorBookingMessage(confirmed, ports.line, ports.config.brandLogoUrl())
      return ports.repositories.bookings.update(
        confirmed.caseId,
        confirmed.version,
        { doctorLineNotifiedAt: ports.clock.nowIso(), lineState: 'OK' },
        { actor: 'system', reason: 'Confirmed automatic queue sent to doctor', correlationId: `${confirmed.caseId}:DOCTOR_CONFIRM` },
      )
    } catch (error) {
      enqueueDoctorConfirmationRetry(confirmed, error, ports)
    }
  }
  return confirmed
}
```

`enqueueDoctorConfirmationRetry()` writes operation `DOCTOR_LINE_CONFIRMATION` with idempotency key `${caseId}:DOCTOR_LINE_CONFIRMATION:${version}` and no customer text or URLs in `safeError`. `createInitialCallTask()` remains idempotent through `getOpenByCase()`.

Use this helper:

```ts
function enqueueDoctorConfirmationRetry(
  booking: BookingCase,
  error: unknown,
  ports: BookingPorts,
): void {
  const safeError = error instanceof Error
    ? error.message.replace(/https?:\/\/\S+/g, '[url]').slice(0, 300)
    : 'doctor confirmation delivery failed'
  ports.repositories.retries.enqueue({
    id: `RETRY-${booking.caseId}-DOCTOR-CONFIRMATION`,
    caseId: booking.caseId,
    operation: 'DOCTOR_LINE_CONFIRMATION',
    idempotencyKey: `${booking.caseId}:DOCTOR_LINE_CONFIRMATION:${booking.version}`,
    attempts: 0,
    status: 'PENDING',
    safeError,
    payload: { messageVersion: booking.version },
  })
}
```

- [ ] **Step 4: Export the Apps Script entrypoint**

In `entrypoints.ts`:

```ts
export function onQueueConfirmationSubmit(event: GoogleAppsScript.Events.FormsOnFormSubmit) {
  return confirmQueue(
    parseQueueConfirmationFormEvent(queueConfirmationFormResponseEvent(event)),
    createRuntime(),
  )
}
```

Add this top-level build footer function and a `build.test.ts` assertion for it:

```ts
function onQueueConfirmationSubmit(e) {
  return PmcBooking.onQueueConfirmationSubmit(e)
}
```

- [ ] **Step 5: Run focused and full tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/queueConfirmationWorkflow.test.ts apps/pmc-google-booking-ops/tests/build.test.ts
npm run booking:test
```

Expected: PASS.

- [ ] **Step 6: Commit Task 9**

```bash
git add apps/pmc-google-booking-ops/src/workflows/queueConfirmation.ts \
  apps/pmc-google-booking-ops/src/entrypoints.ts \
  apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/scripts/build.mjs \
  apps/pmc-google-booking-ops/tests/queueConfirmationWorkflow.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
git commit -m "feat: confirm provisional queues idempotently"
```

---

### Task 10: Google Form Branching and Setup Operator

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/adapters/googleForms.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Create: `apps/pmc-google-booking-ops/src/domain/queueFormPlan.ts`
- Create: `apps/pmc-google-booking-ops/tests/queueFormPlan.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/build.test.ts`

**Interfaces:**
- Produces: pure `queueFormPlan()` and operator entrypoint `configurePmcQueueModeForms()`.
- Produces: exactly one queue-confirmation submit trigger.

- [ ] **Step 1: Write failing pure Form-plan tests**

```ts
it('plans one required choice and separates normal date/time from AUTO', () => {
  const existingBookingFormTitles = [
    'Admin', 'AE', 'ชื่อลูกค้า', 'ชื่อ Facebook', 'เบอร์มือถือ', 'หมอ',
    'บริการ/โปรแกรม', 'วันที่นัด', 'เวลานัด', 'จำนวนเงินจอง',
    'เพจคลินิก/ช่องทาง', 'สลิปเงินจอง', 'หลักฐานแชท',
  ]
  expect(queueFormPlan(existingBookingFormTitles)).toEqual({
    queueQuestionTitle: 'รูปแบบคิวนัดหมาย',
    choices: ['คิวปกติ', 'คิวอัตโนมัติ'],
    normalSectionTitle: 'คิวปกติ',
    automaticSectionTitle: 'คิวอัตโนมัติ',
    normalFields: ['วันที่นัด', 'เวลานัด'],
  })
})
```

Add:

```ts
it('rejects duplicate queue questions before mutating the Form', () => {
  expect(() => queueFormPlan([
    'รูปแบบคิวนัดหมาย', 'รูปแบบคิวนัดหมาย', 'วันที่นัด', 'เวลานัด',
  ])).toThrow('expected exactly one queue type question')
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/queueFormPlan.test.ts
```

Expected: FAIL because `queueFormPlan` does not exist.

- [ ] **Step 3: Implement the pure plan and adapter application**

Implement the pure planner:

```ts
export function queueFormPlan(titles: string[]) {
  const queueCount = titles.filter((title) => title === QUEUE_TYPE_TITLE).length
  if (queueCount > 1) throw new Error('expected exactly one queue type question')
  for (const required of ['วันที่นัด', 'เวลานัด']) {
    if (titles.filter((title) => title === required).length !== 1) {
      throw new Error(`expected one Form field: ${required}`)
    }
  }
  return {
    queueQuestionTitle: QUEUE_TYPE_TITLE,
    choices: [...QUEUE_TYPE_CHOICES],
    normalSectionTitle: 'คิวปกติ',
    automaticSectionTitle: 'คิวอัตโนมัติ',
    normalFields: ['วันที่นัด', 'เวลานัด'],
  }
}
```

`configurePmcQueueModeForms()` must:

1. locate or create one Multiple choice queue item;
2. create/reuse `คิวปกติ` and `คิวอัตโนมัติ` page breaks;
3. move the existing Date and Time items into the normal section;
4. route `คิวปกติ` to the normal page and `คิวอัตโนมัติ` to the automatic evidence page;
5. leave deposit/evidence fields shared after branching;
6. call `runtime.forms.ensureQueueConfirmationForm()` to verify the confirmation Form items and email collection; and
7. install one `onQueueConfirmationSubmit` trigger.

Use `MultipleChoiceItem.createChoice(label, pageBreakItem)` for both queue choices.

Apply navigation with:

```ts
queueItem
  .setTitle(QUEUE_TYPE_TITLE)
  .setRequired(true)
  .setChoices([
    queueItem.createChoice('คิวปกติ', normalSection),
    queueItem.createChoice('คิวอัตโนมัติ', automaticSection),
  ])
normalSection.setGoToPage(sharedBookingSection)
automaticSection.setGoToPage(sharedBookingSection)
```

Move the existing `วันที่นัด` and `เวลานัด` items immediately after `normalSection`. Keep deposit, channel, slip, and chat fields after `sharedBookingSection` so both branches complete the same evidence questions.

- [ ] **Step 4: Add the operator and build export**

```ts
export function configurePmcQueueModeForms() {
  return configureQueueModeFormsWorkflow()
}
```

Add the footer wrapper and build test assertion:

```ts
function configurePmcQueueModeForms() {
  return PmcBooking.configurePmcQueueModeForms()
}
```

- [ ] **Step 5: Run tests without touching production Forms**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/queueFormPlan.test.ts apps/pmc-google-booking-ops/tests/build.test.ts apps/pmc-google-booking-ops/tests/formSubmit.test.ts
npm run booking:typecheck
npm run booking:build
```

Expected: PASS. Do not run `configurePmcQueueModeForms()` in Apps Script during this task.

- [ ] **Step 6: Commit Task 10**

```bash
git add apps/pmc-google-booking-ops/src/adapters/googleForms.ts \
  apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/src/entrypoints.ts \
  apps/pmc-google-booking-ops/scripts/build.mjs \
  apps/pmc-google-booking-ops/src/domain/queueFormPlan.ts \
  apps/pmc-google-booking-ops/tests/queueFormPlan.test.ts \
  apps/pmc-google-booking-ops/tests/build.test.ts
git commit -m "feat: prepare queue mode Form branching"
```

---

### Task 11: Isolate Daily Operational Stages

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/tests/endToEnd.test.ts`
- Create: `apps/pmc-google-booking-ops/tests/dailyStageIsolation.test.ts`

**Interfaces:**
- Produces: `DailyOperationsResult` with one safe status per stage.
- Ensures a LINE failure in call reminders does not block deposit expiry or dashboard refresh.

- [ ] **Step 1: Write the failing isolation test**

```ts
it('continues expiry and dashboard after call-reminder LINE fails', () => {
  const ports = createTestPorts({
    now: '2027-02-21T09:00:00+07:00',
    lineFailsAtPush: 1,
  })
  ports.bookings.insert(ports.bookingFixture())
  ports.calls.insertFixture()
  const result = runDailyOperationsWorkflow(ports)
  expect(result.stages.callReminders).toBe('FAILED')
  expect(result.stages.depositExpiry).toBe('OK')
  expect(result.stages.dashboard).toBe('OK')
  expect(ports.bookings.getByCaseId('PMC-202608-0001')?.status).toBe('EXPIRED_6M')
  expect(ports.dashboard.lastSnapshot()).not.toBeNull()
})
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/dailyStageIsolation.test.ts
```

Expected: FAIL because the first thrown LINE error aborts later stages.

- [ ] **Step 3: Implement named isolated stages**

```ts
export interface DailyOperationsResult {
  stages: Record<
    'retries' | 'doctorSchedules' | 'callReminders' | 'depositExpiry' | 'dashboard',
    'OK' | 'FAILED'
  >
}

function runDailyStage(name: keyof DailyOperationsResult['stages'], operation: () => void) {
  try {
    operation()
    return 'OK' as const
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'failed'
    const safeDetail = detail
      .replace(/https?:\/\/\S+/g, '[url]')
      .replace(/PMC-\d{6}-\d{4}/g, '[case]')
      .replace(/0\d{8,9}/g, '[phone]')
      .slice(0, 300)
    console.error(`${name}: ${safeDetail}`)
    return 'FAILED' as const
  }
}
```

Call every stage exactly once:

```ts
export function runDailyOperationsWorkflow(ports: BookingPorts): DailyOperationsResult {
  return {
    stages: {
      retries: runDailyStage('retries', () => runEligibleRetries(ports)),
      doctorSchedules: runDailyStage('doctorSchedules', () => runDailyDoctorSchedules(ports)),
      callReminders: runDailyStage('callReminders', () => runDailyCallReminders(ports)),
      depositExpiry: runDailyStage('depositExpiry', () => runDepositExpiryReminders(ports)),
      dashboard: runDailyStage('dashboard', () => writeDashboard(ports)),
    },
  }
}
```

Do not include customer data, tokens, group IDs, or media URLs in logs.

- [ ] **Step 4: Run focused and full tests**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/dailyStageIsolation.test.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts
npm run booking:test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 11**

```bash
git add apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/tests/endToEnd.test.ts \
  apps/pmc-google-booking-ops/tests/dailyStageIsolation.test.ts
git commit -m "fix: isolate daily booking operations"
```

---

### Task 12: Migration and Validation Operators

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/src/entrypoints.ts`
- Modify: `apps/pmc-google-booking-ops/src/workflows/flexValidation.ts`
- Modify: `apps/pmc-google-booking-ops/scripts/build.mjs`
- Modify: `apps/pmc-google-booking-ops/tests/build.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/flexValidation.test.ts`
- Create: `apps/pmc-google-booking-ops/tests/appointmentMigration.test.ts`

**Interfaces:**
- Produces: `preparePmcAutoQueueMigration()` read-only dry-run operator.
- Produces: `applyPmcAutoQueueMigration()` explicit mutation operator.
- Produces: pure `migrateAppointmentRows(rows): BookingCase[]` preserving every existing identifier and external reference.
- Extends LINE validator payloads with tentative, awaiting-slot, and multi-batch evidence examples.

- [ ] **Step 1: Write failing migration and validation tests**

```ts
it('backfills existing Calendar bookings as normal confirmed appointments', () => {
  const migrated = migrateAppointmentRows([bookingFixture({
    calendarEventId: 'event-1',
    queueType: undefined as never,
    appointmentStatus: undefined as never,
  })])
  expect(migrated[0]).toMatchObject({ queueType: 'NORMAL', appointmentStatus: 'CONFIRMED' })
  expect(migrated[0].calendarEventId).toBe('event-1')
})
```

In `flexValidation.test.ts`, require validation messages for confirmed Admin, doctor, tentative Admin, awaiting-slot Admin, and a ten-image evidence carousel.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/pmc-google-booking-ops/tests/appointmentMigration.test.ts apps/pmc-google-booking-ops/tests/flexValidation.test.ts apps/pmc-google-booking-ops/tests/build.test.ts
```

Expected: FAIL because migration operators and expanded validation payloads do not exist.

- [ ] **Step 3: Implement dry-run and apply separation**

`preparePmcAutoQueueMigration()` returns sanitized counts only:

```ts
{
  bookingRows: number,
  rowsNeedingBackfill: number,
  queueConfirmationFormReady: boolean,
  triggerWouldBeCreated: boolean,
  liveWrites: false,
}
```

`applyPmcAutoQueueMigration()` requires a Script Property one-time approval marker, creates a timestamped Spreadsheet backup, deletes the marker immediately, applies the column/backfill migration, and verifies readback counts. It never changes the booking Form; Form branching remains a separate operator and approval.

Implement the pure backfill as:

```ts
export function migrateAppointmentRows(rows: BookingCase[]): BookingCase[] {
  return rows.map((row) => ({
    ...row,
    queueType: row.queueType || 'NORMAL',
    appointmentStatus: row.appointmentStatus ||
      (row.calendarEventId ? 'CONFIRMED' : 'AWAITING_ADMIN_SLOT'),
    appointmentProposedAt: row.appointmentProposedAt || null,
    appointmentConfirmedAt: row.appointmentConfirmedAt || null,
    appointmentConfirmedBy: row.appointmentConfirmedBy || null,
  }))
}
```

The apply operator writes the returned rows through the repository schema and compares Case ID, Calendar event ID, and Drive folder ID arrays before and after. Any mismatch throws before Form configuration begins.

- [ ] **Step 4: Expand LINE validation-only payloads**

Build synthetic messages only. `validatePmcBookingFlexMessages()` posts them to `/v2/bot/message/validate/push`; it never includes `to` and never sends to a group.

- [ ] **Step 5: Export and test operators**

Add build wrappers for:

```ts
function preparePmcAutoQueueMigration() {
  return PmcBooking.preparePmcAutoQueueMigration()
}
function applyPmcAutoQueueMigration() {
  return PmcBooking.applyPmcAutoQueueMigration()
}
function configurePmcQueueModeForms() {
  return PmcBooking.configurePmcQueueModeForms()
}
```

Run:

```bash
npx vitest run apps/pmc-google-booking-ops/tests/appointmentMigration.test.ts apps/pmc-google-booking-ops/tests/flexValidation.test.ts apps/pmc-google-booking-ops/tests/build.test.ts
npm run booking:test
npm run booking:typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 12**

```bash
git add apps/pmc-google-booking-ops/src/runtime.ts \
  apps/pmc-google-booking-ops/src/entrypoints.ts \
  apps/pmc-google-booking-ops/src/workflows/flexValidation.ts \
  apps/pmc-google-booking-ops/scripts/build.mjs \
  apps/pmc-google-booking-ops/tests/build.test.ts \
  apps/pmc-google-booking-ops/tests/flexValidation.test.ts \
  apps/pmc-google-booking-ops/tests/appointmentMigration.test.ts
git commit -m "feat: prepare automatic queue migration"
```

---

### Task 13: Full Verification and Approval-Gated Production Cutover

**Files:**
- Modify: `apps/pmc-google-booking-ops/docs/setup.md`
- Modify: `apps/pmc-google-booking-ops/docs/pilot-runbook.md`
- Modify: `docs/PROJECT_UPDATES.md`

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: verified local bundle, documented rollback, and explicit live-action gates.

- [ ] **Step 1: Run the complete local verification suite**

```bash
npm run booking:test
npm run booking:typecheck
npx eslint apps/pmc-google-booking-ops/src apps/pmc-google-booking-ops/tests apps/pmc-google-booking-ops/scripts
npm run booking:build
git diff --check
```

Expected: zero failed tests, zero type/lint/build errors, and no whitespace errors.

- [ ] **Step 2: Add exact operational documentation**

Document:

- new queue-type Form behavior;
- confirmation Form fields and collected-email audit;
- automatic slot rule;
- gray-to-gold Calendar transition;
- all-image evidence batching;
- six installable triggers including `onQueueConfirmationSubmit`;
- dry-run, backup, migration, Form configuration, validation, pilot, and rollback commands; and
- the fact that no doctor or call notification occurs before confirmation.

- [ ] **Step 3: Commit documentation**

```bash
git add apps/pmc-google-booking-ops/docs/setup.md \
  apps/pmc-google-booking-ops/docs/pilot-runbook.md \
  docs/PROJECT_UPDATES.md
git commit -m "docs: add automatic queue runbook"
```

- [ ] **Step 4: Stop for Production Gate A — source push**

Present the local verification counts and exact `git status`. Obtain explicit owner approval before:

```bash
npm run booking:push
```

Do not run the command without that approval.

- [ ] **Step 5: After Gate A, run validation-only checks**

In Apps Script run only:

```text
preparePmcAutoQueueMigration
validatePmcBookingFlexMessages
```

Expected: dry-run reports `liveWrites: false`; LINE validator returns HTTP 200. No Form, Sheet, Calendar, trigger, or LINE group is mutated.

- [ ] **Step 6: Stop for Production Gate B — backup, migration, and Forms**

Present dry-run results and request explicit approval before running:

```text
applyPmcAutoQueueMigration
configurePmcQueueModeForms
```

After approval, verify:

- timestamped backup exists;
- migrated row counts match dry-run;
- booking Form shows one required queue choice;
- normal route shows date/time;
- automatic route skips date/time;
- confirmation Form collects email; and
- exactly one `onQueueConfirmationSubmit` trigger exists.

- [ ] **Step 7: Run one synthetic normal and one synthetic automatic submission**

Use non-customer test identity and clearly labeled synthetic images. Verify:

- normal creates confirmed color `5`, Admin+doctor delivery, and call task;
- automatic creates tentative color `8`, Admin-only delivery, no call task;
- every synthetic evidence image appears;
- confirmation updates the same event to color `5`; and
- doctor/call workflows occur once after confirmation.

- [ ] **Step 8: Stop for Production Gate C — real group pilot**

Request explicit approval before any pilot message to the Admin or doctor group. Use unique versioned retry keys and never include real customer data in pilot payloads.

- [ ] **Step 9: Record readback and rollback evidence**

Record safe counts, execution timestamps, trigger count, Calendar event IDs only for synthetic cases, validator status, and rollback readiness in `pilot-runbook.md`. Do not record tokens, group IDs, private media URLs, or customer identifiers.

---

## Final Verification Checklist

- [ ] Every submitted slip and chat image is represented in Admin LINE.
- [ ] Evidence ordering is slips first, then chats, with stable labels.
- [ ] No evidence is sent to doctor groups or made public.
- [ ] Legacy Form responses remain normal confirmed bookings.
- [ ] Automatic Form responses require no date/time.
- [ ] The automatic proposal uses the approved doctor/day/time rule.
- [ ] No candidate creates `AWAITING_ADMIN_SLOT` without a fake Calendar event.
- [ ] Tentative Calendar events are gray and doctor/call silent.
- [ ] Any Admin can confirm through collected email.
- [ ] Confirmation updates one event and sends doctor/call actions once.
- [ ] Daily LINE failure cannot block expiry or dashboard stages.
- [ ] All tests, typecheck, lint, build, LINE validation, migration readback, Form readback, trigger readback, and synthetic end-to-end checks pass.
