# PMC Booking Evidence Flex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve private Google Drive payment/chat images through permanent HMAC-signed Render URLs and display approved evidence previews only in the serious white Admin LINE Flex booking card.

**Architecture:** Apps Script signs deterministic evidence tokens from Case ID and Drive file IDs. The existing Render service verifies the tokens, uses a read-only Google Service Account to fetch private Drive media, and returns JPEG/PNG preview/full variants. Admin Flex receives one slip and up to three chat images; doctor Flex receives no evidence URL.

**Tech Stack:** TypeScript 6, Node.js HTTP server, Vitest 4, Google Drive API v3, `googleapis`, `sharp`, Google Apps Script V8, LINE Messaging API Flex Messages, Render.

**Spec:** `docs/superpowers/specs/2026-08-20-pmc-booking-evidence-flex-design.md`

## Global Constraints

- Google Drive remains the only evidence store; never make files or folders public-by-link.
- Evidence URLs are permanent bearer links with no expiry field, per owner approval.
- Evidence images appear only in the mapped Admin operations group.
- Doctor groups receive full approved appointment identity but no evidence image, evidence URL, deposit amount, channel, or Drive link.
- Admin Flex uses `#FFFFFF` with restrained champagne-gold accents; no mascot, logo lockup, decorative hero, or gradient.
- Show one payment slip and at most three chat previews.
- Support only JPEG and PNG, maximum 10 MB per source file.
- Preview output is JPEG, inside 1024 x 1024, quality 82, without enlargement.
- Service Account has Viewer access only to the `PMC Bookings` root and no Sheets, Calendar, Forms, or LINE permission.
- Never put Service Account JSON, signing secrets, signed evidence URLs, raw evidence, or customer PII in source control, logs, audit payloads, or test fixtures.
- Invalid signature returns `403`; missing/trashed files return `404`; unsupported MIME returns `415`; oversized media returns `413`.
- The existing text/full-operational Flex summary must still send if evidence preview generation fails.
- LINE and Drive retries remain idempotent.
- Production stays synthetic-pilot-only until every go/no-go check passes.

---

## File Structure

### Create

```text
server/bookingEvidenceToken.ts
server/bookingEvidenceProxy.ts
tests/bookingEvidenceToken.test.ts
tests/bookingEvidenceProxy.test.ts
scripts/verifyBookingEvidenceAccess.mjs
tests/verifyBookingEvidenceAccess.test.ts
apps/pmc-google-booking-ops/src/adapters/evidenceMedia.ts
apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts
```

### Modify

```text
package.json
package-lock.json
.env.example
render.yaml
server/productionServer.ts
apps/pmc-google-booking-ops/src/config.ts
apps/pmc-google-booking-ops/src/ports.ts
apps/pmc-google-booking-ops/src/runtime.ts
apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts
apps/pmc-google-booking-ops/src/workflows/formSubmit.ts
apps/pmc-google-booking-ops/tests/helpers/fakes.ts
apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
apps/pmc-google-booking-ops/tests/endToEnd.test.ts
apps/pmc-google-booking-ops/docs/setup.md
apps/pmc-google-booking-ops/docs/pilot-runbook.md
docs/PROJECT_UPDATES.md
```

## Interface Map

```ts
export type BookingEvidenceKind = 'PAYMENT' | 'CHAT'
export type BookingEvidenceVariant = 'preview' | 'full'

export interface BookingEvidenceTokenPayload {
  v: 1
  caseId: string
  fileId: string
  kind: BookingEvidenceKind
  ordinal: number
  variant: BookingEvidenceVariant
}

export function signBookingEvidenceToken(payload: BookingEvidenceTokenPayload, secret: string): string
export function verifyBookingEvidenceToken(token: string, secret: string): BookingEvidenceTokenPayload

export interface BookingEvidenceDrivePort {
  metadata(fileId: string): Promise<{ mimeType: string; size: number; trashed: boolean }>
  download(fileId: string): Promise<Buffer>
}

export interface BookingEvidencePreviewPort {
  jpegPreview(input: Buffer): Promise<Buffer>
}

export interface BookingEvidenceProxyResult {
  status: number
  contentType: string
  body: Buffer | { error: string }
}

export interface EvidenceImageRef {
  previewUrl: string
  fullUrl: string
}

export interface BookingEvidenceImages {
  payment: EvidenceImageRef | null
  chats: EvidenceImageRef[]
  totalChatCount: number
}

export interface EvidenceMediaPort {
  images(caseId: string, paymentFileIds: string[], chatFileIds: string[]): BookingEvidenceImages
}
```

Cross-runtime fixed vector:

```text
payload = {"v":1,"caseId":"PMC-202608-0001","fileId":"file_ABC123xyz","kind":"PAYMENT","ordinal":1,"variant":"preview"}
secret = unit-test-secret
token = eyJ2IjoxLCJjYXNlSWQiOiJQTUMtMjAyNjA4LTAwMDEiLCJmaWxlSWQiOiJmaWxlX0FCQzEyM3h5eiIsImtpbmQiOiJQQVlNRU5UIiwib3JkaW5hbCI6MSwidmFyaWFudCI6InByZXZpZXcifQ.743a360b59bbdfa6e51296d458d838a3a338462b6258d35f600479ca92287205
```

---

### Task 1: Add the Node Signed-Token Contract

**Files:**
- Create: `server/bookingEvidenceToken.ts`
- Create: `tests/bookingEvidenceToken.test.ts`

**Interfaces:**
- Consumes: Node `crypto`, JSON, base64url.
- Produces: `BookingEvidenceTokenPayload`, `signBookingEvidenceToken`, `verifyBookingEvidenceToken`.

- [ ] **Step 1: Write the failing fixed-vector and mutation tests**

Create `tests/bookingEvidenceToken.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  signBookingEvidenceToken,
  verifyBookingEvidenceToken,
  type BookingEvidenceTokenPayload,
} from '../server/bookingEvidenceToken'

const payload: BookingEvidenceTokenPayload = {
  v: 1,
  caseId: 'PMC-202608-0001',
  fileId: 'file_ABC123xyz',
  kind: 'PAYMENT',
  ordinal: 1,
  variant: 'preview',
}
const expected = 'eyJ2IjoxLCJjYXNlSWQiOiJQTUMtMjAyNjA4LTAwMDEiLCJmaWxlSWQiOiJmaWxlX0FCQzEyM3h5eiIsImtpbmQiOiJQQVlNRU5UIiwib3JkaW5hbCI6MSwidmFyaWFudCI6InByZXZpZXcifQ.743a360b59bbdfa6e51296d458d838a3a338462b6258d35f600479ca92287205'

describe('booking evidence token', () => {
  it('matches the cross-runtime fixed vector', () => {
    expect(signBookingEvidenceToken(payload, 'unit-test-secret')).toBe(expected)
    expect(verifyBookingEvidenceToken(expected, 'unit-test-secret')).toEqual(payload)
  })

  it('rejects payload or signature mutation', () => {
    const [body, signature] = expected.split('.')
    expect(() => verifyBookingEvidenceToken(`${body}A.${signature}`, 'unit-test-secret')).toThrow('Invalid evidence token')
    expect(() => verifyBookingEvidenceToken(`${body}.${signature.slice(0, -1)}0`, 'unit-test-secret')).toThrow('Invalid evidence token')
  })

  it.each([
    { ...payload, v: 2 },
    { ...payload, caseId: 'bad' },
    { ...payload, fileId: '../secret' },
    { ...payload, kind: 'OTHER' },
    { ...payload, ordinal: 0 },
    { ...payload, variant: 'raw' },
  ])('rejects invalid schema %#', (invalid) => {
    expect(() => signBookingEvidenceToken(invalid as BookingEvidenceTokenPayload, 'unit-test-secret')).toThrow('Invalid evidence token')
  })
})
```

- [ ] **Step 2: Run RED**

```bash
npm run test -- tests/bookingEvidenceToken.test.ts
```

Expected: FAIL because `server/bookingEvidenceToken.ts` does not exist.

- [ ] **Step 3: Implement the strict token codec**

Create `server/bookingEvidenceToken.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export type BookingEvidenceKind = 'PAYMENT' | 'CHAT'
export type BookingEvidenceVariant = 'preview' | 'full'

export interface BookingEvidenceTokenPayload {
  v: 1
  caseId: string
  fileId: string
  kind: BookingEvidenceKind
  ordinal: number
  variant: BookingEvidenceVariant
}

function signature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function validPayload(value: unknown): value is BookingEvidenceTokenPayload {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item.v === 1 &&
    typeof item.caseId === 'string' && /^PMC-\d{6}-\d{4}$/.test(item.caseId) &&
    typeof item.fileId === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(item.fileId) &&
    ['PAYMENT', 'CHAT'].includes(String(item.kind)) &&
    Number.isInteger(item.ordinal) && Number(item.ordinal) >= 1 && Number(item.ordinal) <= 99 &&
    ['preview', 'full'].includes(String(item.variant))
}

export function signBookingEvidenceToken(payload: BookingEvidenceTokenPayload, secret: string): string {
  if (!secret || !validPayload(payload)) throw new Error('Invalid evidence token')
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${signature(body, secret)}`
}

export function verifyBookingEvidenceToken(token: string, secret: string): BookingEvidenceTokenPayload {
  const [body, supplied, extra] = token.split('.')
  if (!body || !supplied || extra || !secret) throw new Error('Invalid evidence token')
  const expected = signature(body, secret)
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('Invalid evidence token')
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown
    if (!validPayload(parsed)) throw new Error('Invalid evidence token')
    return parsed
  } catch {
    throw new Error('Invalid evidence token')
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run test -- tests/bookingEvidenceToken.test.ts
npm run build:server
git add server/bookingEvidenceToken.ts tests/bookingEvidenceToken.test.ts
git commit -m "feat: add booking evidence token contract"
```

---

### Task 2: Build the Pure Render Evidence Proxy Handler

**Files:**
- Create: `server/bookingEvidenceProxy.ts`
- Create: `tests/bookingEvidenceProxy.test.ts`

**Interfaces:**
- Consumes: `verifyBookingEvidenceToken`, injected Drive and preview ports.
- Produces: `createBookingEvidenceProxyHandler(config)` with an HTTP-neutral result.

- [ ] **Step 1: Write failing handler tests**

Create tests for:

```ts
const validPreviewToken = signBookingEvidenceToken({
  v: 1,
  caseId: 'PMC-202608-0001',
  fileId: 'file_ABC123xyz',
  kind: 'PAYMENT',
  ordinal: 1,
  variant: 'preview',
}, 'unit-test-secret')

const handler = createBookingEvidenceProxyHandler({
  signingSecret: 'unit-test-secret',
  drive: {
    metadata: async () => ({ mimeType: 'image/png', size: 100, trashed: false }),
    download: async () => Buffer.from('private-image'),
  },
  preview: { jpegPreview: async () => Buffer.from('preview-jpeg') },
})

expect(await handler(validPreviewToken)).toMatchObject({
  status: 200,
  contentType: 'image/jpeg',
  body: Buffer.from('preview-jpeg'),
})
expect((await handler('bad')).status).toBe(403)
```

Add separate cases for trashed `404`, unsupported MIME `415`, size `413`, download failure `502`, and verify the Drive download fake is not called before token/MIME/size checks pass. Error JSON must not contain the token or file ID.

- [ ] **Step 2: Run RED**

```bash
npm run test -- tests/bookingEvidenceProxy.test.ts
```

Expected: FAIL because the proxy handler does not exist.

- [ ] **Step 3: Implement the pure handler**

Create `server/bookingEvidenceProxy.ts` with the interfaces from the Interface Map and:

```ts
export function createBookingEvidenceProxyHandler(config: {
  signingSecret: string
  drive: BookingEvidenceDrivePort
  preview: BookingEvidencePreviewPort
}) {
  return async (token: string): Promise<BookingEvidenceProxyResult> => {
    let payload
    try {
      payload = verifyBookingEvidenceToken(token, config.signingSecret)
    } catch {
      return { status: 403, contentType: 'application/json; charset=utf-8', body: { error: 'Forbidden' } }
    }
    let metadata
    try {
      metadata = await config.drive.metadata(payload.fileId)
    } catch {
      return { status: 404, contentType: 'application/json; charset=utf-8', body: { error: 'Not found' } }
    }
    if (metadata.trashed) return { status: 404, contentType: 'application/json; charset=utf-8', body: { error: 'Not found' } }
    if (!['image/jpeg', 'image/png'].includes(metadata.mimeType)) {
      return { status: 415, contentType: 'application/json; charset=utf-8', body: { error: 'Unsupported media' } }
    }
    if (metadata.size > 10_000_000) {
      return { status: 413, contentType: 'application/json; charset=utf-8', body: { error: 'Media too large' } }
    }
    let source
    try {
      source = await config.drive.download(payload.fileId)
    } catch {
      return { status: 502, contentType: 'application/json; charset=utf-8', body: { error: 'Media unavailable' } }
    }
    if (payload.variant === 'preview') {
      try {
        return { status: 200, contentType: 'image/jpeg', body: await config.preview.jpegPreview(source) }
      } catch {
        return { status: 502, contentType: 'application/json; charset=utf-8', body: { error: 'Media unavailable' } }
      }
    }
    return { status: 200, contentType: metadata.mimeType, body: source }
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm run test -- tests/bookingEvidenceToken.test.ts tests/bookingEvidenceProxy.test.ts
npm run build:server
git add server/bookingEvidenceProxy.ts tests/bookingEvidenceProxy.test.ts
git commit -m "feat: add private booking evidence proxy handler"
```

---

### Task 3: Add the Google Drive Adapter, Image Preview, and Public Signed Route

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `render.yaml`
- Modify: `server/bookingEvidenceProxy.ts`
- Modify: `server/productionServer.ts`
- Modify: `tests/bookingEvidenceProxy.test.ts`

**Interfaces:**
- Consumes: pure proxy handler from Task 2.
- Produces: `createBookingEvidenceProxyMiddleware(env)` mounted at `GET|HEAD /api/booking-evidence/image` before Basic Auth.

- [ ] **Step 1: Add failing middleware tests**

Add this request/response helper:

```ts
async function invoke(
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  url: string,
  method = 'GET',
) {
  const headers: Record<string, string> = {}
  let body = ''
  const req = { method, url, headers: {} } as IncomingMessage
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = String(value) },
    end(value: string | Buffer = '') { body = Buffer.isBuffer(value) ? value.toString('binary') : String(value) },
  } as unknown as ServerResponse
  await middleware(req, res)
  return { status: res.statusCode, headers, body }
}

const fakeDependencies = {
  drive: {
    metadata: async () => ({ mimeType: 'image/png', size: 100, trashed: false }),
    download: async () => Buffer.from('private-image'),
  },
  preview: { jpegPreview: async () => Buffer.from('preview-jpeg') },
}
```

Then assert:

```ts
const middleware = createBookingEvidenceProxyMiddleware({}, fakeDependencies)
expect((await invoke(middleware, '/api/booking-evidence/image')).status).toBe(503)

const token = signBookingEvidenceToken({
  v: 1,
  caseId: 'PMC-202608-0001',
  fileId: 'file_ABC123xyz',
  kind: 'PAYMENT',
  ordinal: 1,
  variant: 'preview',
}, 'unit-test-secret')
const configuredMiddleware = createBookingEvidenceProxyMiddleware(
  { BOOKING_MEDIA_SIGNING_SECRET: 'unit-test-secret', BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON: '{}' },
  fakeDependencies,
)
const valid = await invoke(configuredMiddleware, `/api/booking-evidence/image?t=${token}`)
expect(valid.status).toBe(200)
expect(valid.headers).toMatchObject({
  'content-type': 'image/jpeg',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-disposition': 'inline',
})
```

Also verify `HEAD` has identical headers and an empty body, `POST` returns `405`, and no error contains the token/file ID.

- [ ] **Step 2: Run RED**

```bash
npm run test -- tests/bookingEvidenceProxy.test.ts
```

Expected: FAIL because middleware and real adapters are absent.

- [ ] **Step 3: Add direct runtime dependencies**

```bash
npm install googleapis sharp
```

Confirm both are direct runtime dependencies in `package.json`.

- [ ] **Step 4: Implement the read-only Drive adapter**

In `server/bookingEvidenceProxy.ts`, parse `BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON`, create `google.auth.GoogleAuth` with only `https://www.googleapis.com/auth/drive.readonly`, then:

```ts
metadata(fileId) {
  const result = await drive.files.get({ fileId, fields: 'mimeType,size,trashed' })
  return {
    mimeType: String(result.data.mimeType ?? ''),
    size: Number(result.data.size ?? 0),
    trashed: result.data.trashed === true,
  }
}

async download(fileId) {
  const result = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
  return Buffer.from(result.data as ArrayBuffer)
}
```

No Sheets, Calendar, Forms, or write scope is allowed.

- [ ] **Step 5: Implement preview generation**

```ts
async jpegPreview(input) {
  return sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
}
```

- [ ] **Step 6: Implement middleware and mount it before Basic Auth**

The middleware accepts `GET|HEAD`, reads only `t`, sets `no-store`, `nosniff`, and `inline`, and JSON-encodes generic errors. In `productionServer.ts`:

```ts
if (req.url?.startsWith('/api/booking-evidence/image')) {
  await bookingEvidenceProxy(req, res)
  return
}
```

Place it after `/healthz` and before Basic Auth.

- [ ] **Step 7: Add secret names**

Append to `.env.example` and `render.yaml` (`sync: false`):

```text
BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON
BOOKING_MEDIA_SIGNING_SECRET
```

- [ ] **Step 8: Verify and commit**

```bash
npm run test -- tests/bookingEvidenceToken.test.ts tests/bookingEvidenceProxy.test.ts
npm run lint
npm run build:server
git add package.json package-lock.json .env.example render.yaml server/bookingEvidenceProxy.ts server/productionServer.ts tests/bookingEvidenceProxy.test.ts
git commit -m "feat: serve signed private booking evidence"
```

---

### Task 4: Add the Apps Script Cross-Runtime Media Signer

**Files:**
- Create: `apps/pmc-google-booking-ops/src/adapters/evidenceMedia.ts`
- Create: `apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts`
- Modify: `apps/pmc-google-booking-ops/src/config.ts`
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/tests/helpers/fakes.ts`

**Interfaces:**
- Consumes: `CryptoPort.hmacSha256Hex`, new `CryptoPort.base64UrlUtf8`, base URL and signing secret.
- Produces: `EvidenceMediaPort.images(caseId, paymentFileIds, chatFileIds)`.

- [ ] **Step 1: Write failing fixed-vector and selection tests**

Create `evidenceMedia.test.ts` with a Node crypto fake and the exact literal token:

```ts
expect(evidenceToken({
  v: 1,
  caseId: 'PMC-202608-0001',
  fileId: 'file_ABC123xyz',
  kind: 'PAYMENT',
  ordinal: 1,
  variant: 'preview',
}, 'unit-test-secret', crypto)).toBe(
  'eyJ2IjoxLCJjYXNlSWQiOiJQTUMtMjAyNjA4LTAwMDEiLCJmaWxlSWQiOiJmaWxlX0FCQzEyM3h5eiIsImtpbmQiOiJQQVlNRU5UIiwib3JkaW5hbCI6MSwidmFyaWFudCI6InByZXZpZXcifQ.743a360b59bbdfa6e51296d458d838a3a338462b6258d35f600479ca92287205',
)

const port = createEvidenceMediaPort('https://example.com/api/booking-evidence/image', 'unit-test-secret', crypto)
const images = port.images('PMC-202608-0001', ['pay-123456'], [
  'chat-111111', 'chat-222222', 'chat-333333', 'chat-444444',
])
expect(images.payment).not.toBeNull()
expect(images.chats).toHaveLength(3)
expect(images.totalChatCount).toBe(4)
```

- [ ] **Step 2: Run RED**

```bash
npm run test -- apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts
```

Expected: FAIL because the adapter and crypto method do not exist.

- [ ] **Step 3: Extend the crypto port**

Add:

```ts
base64UrlUtf8(value: string): string
```

Apps Script implementation:

```ts
base64UrlUtf8: (value) =>
  Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8).replace(/=+$/, ''),
```

Test fake implementation:

```ts
base64UrlUtf8: (value) => Buffer.from(value, 'utf8').toString('base64url'),
```

- [ ] **Step 4: Implement deterministic image URLs**

In `evidenceMedia.ts`:

```ts
export function evidenceToken(payload, secret, crypto) {
  const body = crypto.base64UrlUtf8(JSON.stringify(payload))
  return `${body}.${crypto.hmacSha256Hex(body, secret)}`
}

function imageRef(baseUrl, caseId, fileId, kind, ordinal, secret, crypto) {
  const url = (variant: 'preview' | 'full') => {
    const token = evidenceToken({ v: 1, caseId, fileId, kind, ordinal, variant }, secret, crypto)
    return `${baseUrl}?t=${encodeURIComponent(token)}`
  }
  return { previewUrl: url('preview'), fullUrl: url('full') }
}
```

`images()` selects first payment and first three chat IDs and preserves `totalChatCount`.

- [ ] **Step 5: Wire Script Properties and runtime port**

Add to `SCRIPT_PROPERTY_KEYS`:

```ts
mediaBaseUrl: 'BOOKING_MEDIA_BASE_URL',
mediaSigningSecret: 'BOOKING_MEDIA_SIGNING_SECRET',
```

Add both to `REQUIRED_PROPERTIES`, add `media: EvidenceMediaPort` to `BookingPorts`, and create the real/fake ports.

- [ ] **Step 6: Verify and commit**

```bash
npm run test -- apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts
npm run booking:typecheck
npm run booking:build
git add apps/pmc-google-booking-ops/src/adapters/evidenceMedia.ts apps/pmc-google-booking-ops/tests/evidenceMedia.test.ts apps/pmc-google-booking-ops/src/config.ts apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/tests/helpers/fakes.ts
git commit -m "feat: sign booking evidence media URLs"
```

---

### Task 5: Redesign Admin Flex as a Serious White Evidence Card

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/ports.ts`
- Modify: `apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts`
- Modify: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`

**Interfaces:**
- Consumes: `BookingEvidenceImages` from Task 4.
- Produces: evidence-aware `adminBookingMessage`; doctor builder remains evidence-free.

- [ ] **Step 1: Write failing audience/layout tests**

Use:

```ts
const evidence = {
  payment: { previewUrl: 'https://media.test/pay-preview', fullUrl: 'https://media.test/pay-full' },
  chats: [
    { previewUrl: 'https://media.test/chat-1-preview', fullUrl: 'https://media.test/chat-1-full' },
    { previewUrl: 'https://media.test/chat-2-preview', fullUrl: 'https://media.test/chat-2-full' },
    { previewUrl: 'https://media.test/chat-3-preview', fullUrl: 'https://media.test/chat-3-full' },
  ],
  totalChatCount: 5,
}
const adminJson = JSON.stringify(adminBookingMessage(bookingFixture(), 'admin-group', evidence).apiMessage)
const doctorJson = JSON.stringify(doctorBookingMessage(bookingFixture(), 'BOOKING_CONFIRMED').apiMessage)

expect(adminJson).toContain('#FFFFFF')
expect(adminJson).toContain('หลักฐานการโอน')
expect(adminJson).toContain('หลักฐานแชท')
expect(adminJson).toContain('https://media.test/pay-preview')
expect(adminJson).toContain('https://media.test/chat-3-preview')
expect(adminJson).toContain('+2 รูปเพิ่มเติมใน Drive')
expect(adminJson).not.toContain('#FEE5E0')
expect(doctorJson).not.toContain('media.test')
expect(doctorJson).not.toContain('หลักฐานการโอน')
```

Assert every image action points to its matching full URL.

- [ ] **Step 2: Run RED**

```bash
npm run test -- apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
```

Expected: FAIL because Admin builder has no evidence argument and still uses Misty Rose.

- [ ] **Step 3: Implement the serious white/gold Flex**

Use `#FFFFFF` background, dark text `#241F1C`, secondary text `#705C4E`, and gold accent `#C99A3D`. Do not add a hero block.

After booking rows append:

- separator;
- `หลักฐานการโอน` label;
- payment image with `aspectRatio: '20:13'`, `aspectMode: 'fit'`, and URI action to full URL;
- `หลักฐานแชท` label;
- horizontal box of up to three chat images;
- `+N รูปเพิ่มเติมใน Drive` when `totalChatCount > chats.length`.

The doctor function has no evidence parameter, making evidence serialization impossible by interface.

- [ ] **Step 4: Add the no-image fallback test**

```ts
const noImages = { payment: null, chats: [], totalChatCount: 2 }
expect(JSON.stringify(adminBookingMessage(bookingFixture(), 'admin-group', noImages).apiMessage))
  .toContain('รูปหลักฐานยังไม่พร้อมแสดง')
```

- [ ] **Step 5: Validate with LINE and commit**

Validate Admin and doctor message objects through `POST /v2/bot/message/validate/push`; expected HTTP `200`. Do not print access token or signed URLs.

```bash
npm run test -- apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
npm run booking:typecheck
npm run booking:build
git add apps/pmc-google-booking-ops/src/ports.ts apps/pmc-google-booking-ops/src/adapters/lineMessaging.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
git commit -m "feat: add evidence previews to Admin Flex"
```

---

### Task 6: Wire Evidence Through Booking and LINE Retry Workflows

**Files:**
- Modify: `apps/pmc-google-booking-ops/src/workflows/formSubmit.ts`
- Modify: `apps/pmc-google-booking-ops/src/runtime.ts`
- Modify: `apps/pmc-google-booking-ops/tests/endToEnd.test.ts`
- Modify: `apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts`

**Interfaces:**
- Consumes: `ports.media.images(...)`, evidence-aware Admin builder.
- Produces: deterministic evidence URLs on initial send and `BOOKING_LINE` retry.

- [ ] **Step 1: Write the failing workflow/retry test**

```ts
it('routes evidence only to Admin and preserves file IDs for LINE retry', () => {
  const ports = createTestPorts({ linePushFails: true })
  const booking = submitBookingIntake(validBookingIntake({
    paymentEvidenceFileIds: ['payment-file-1'],
    chatEvidenceFileIds: ['chat-file-1', 'chat-file-2'],
  }), ports)
  const retry = ports.retries.listPending()[0]
  expect(retry.operation).toBe('BOOKING_LINE')
  expect(retry.payload).toEqual({
    paymentEvidenceFileIds: ['payment-file-1'],
    chatEvidenceFileIds: ['chat-file-1', 'chat-file-2'],
  })

  ports.line.allowPushes()
  runEligibleRetries(ports)
  expect(JSON.stringify(ports.line.adminMessages()[0].apiMessage)).toContain('payment-file-1')
  expect(JSON.stringify(ports.line.doctorMessages()[0].apiMessage)).not.toContain('payment-file-1')
  expect(ports.retries.listPending()).toHaveLength(0)
  expect(ports.drive.createdFolderCount()).toBe(3)
  expect(ports.calendar.createdEvents()).toHaveLength(1)
})
```

- [ ] **Step 2: Run RED**

```bash
npm run test -- apps/pmc-google-booking-ops/tests/endToEnd.test.ts
```

Expected: FAIL because evidence file IDs are absent from the LINE retry payload and builders receive no evidence object.

- [ ] **Step 3: Wire initial booking confirmation**

After Drive and Calendar succeed:

```ts
const evidence = ports.media.images(
  current.caseId,
  intake.paymentEvidenceFileIds,
  intake.chatEvidenceFileIds,
)
sendBookingConfirmationMessages(
  current,
  ports.line,
  ports.config.adminLineGroupId(),
  evidence,
)
```

If signing fails, use `{ payment: null, chats: [], totalChatCount: intake.chatEvidenceFileIds.length }`, enqueue operation `ADMIN_EVIDENCE_LINE`, and still send both text/full-operational summaries. `ADMIN_EVIDENCE_LINE` stores both file-ID arrays, regenerates media URLs on retry, and sends only the Admin Flex with retry key `${caseId}:ADMIN_EVIDENCE_READY:${version}`; it never resends the doctor notification.

- [ ] **Step 4: Persist and consume retry inputs**

The `BOOKING_LINE` retry row contains:

```ts
payload: {
  paymentEvidenceFileIds: intake.paymentEvidenceFileIds,
  chatEvidenceFileIds: intake.chatEvidenceFileIds,
}
```

`runEligibleRetries` decodes these arrays, regenerates the same deterministic URLs, and sends Admin then doctor. Existing audience-specific retry keys prevent duplicate LINE messages.

- [ ] **Step 5: Add independent failure tests**

Cover:

- signer failure -> summaries send, Admin shows no-image status, and one `ADMIN_EVIDENCE_LINE` retry exists;
- Admin LINE failure -> one combined booking retry;
- doctor LINE failure after Admin success -> retry reuses the Admin retry key;
- replayed retry -> no duplicate Drive folder, Calendar event, or retry row.

- [ ] **Step 6: Verify and commit**

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
git add apps/pmc-google-booking-ops/src/workflows/formSubmit.ts apps/pmc-google-booking-ops/src/runtime.ts apps/pmc-google-booking-ops/tests/endToEnd.test.ts apps/pmc-google-booking-ops/tests/driveCalendarLine.test.ts
git commit -m "feat: route booking evidence through LINE retries"
```

---

### Task 7: Add a Read-Only Service Account Verification Workflow

**Files:**
- Create: `scripts/verifyBookingEvidenceAccess.mjs`
- Create: `tests/verifyBookingEvidenceAccess.test.ts`
- Modify: `package.json`
- Modify: `apps/pmc-google-booking-ops/docs/setup.md`
- Modify: `.gitignore` only if `/API/` is absent.

**Interfaces:**
- Consumes: `BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON`, `BOOKING_EVIDENCE_TEST_FILE_ID`.
- Produces: safe booleans only; never prints credentials, IDs, filenames, URLs, or content.

- [ ] **Step 1: Write the failing safe-output test**

```ts
import { expect, it } from 'vitest'
import { verifyBookingEvidenceAccess } from '../scripts/verifyBookingEvidenceAccess.mjs'

it('reports read-only access without identifiers or content', async () => {
  const result = await verifyBookingEvidenceAccess({
    credentialJson: JSON.stringify({ type: 'service_account', client_email: 'test@example.invalid', private_key: 'test' }),
    fileId: 'synthetic-file-id',
    drive: {
      metadata: async () => ({ mimeType: 'image/jpeg' }),
      firstBytes: async () => Buffer.from('synthetic'),
    },
  })
  expect(result).toEqual({
    credentialType: 'service_account',
    metadataReadable: true,
    mediaReadable: true,
    mimeAllowed: true,
    writeCapabilityRequested: false,
  })
  expect(JSON.stringify(result)).not.toContain('synthetic-file-id')
  expect(JSON.stringify(result)).not.toContain('test@example.invalid')
})
```

- [ ] **Step 2: Run RED**

```bash
npm run test -- tests/verifyBookingEvidenceAccess.test.ts
```

Expected: FAIL because the verifier module does not exist.

- [ ] **Step 3: Write the verifier**

The script exports an injected function for tests and uses the real read-only Drive adapter only in CLI mode:

```js
export async function verifyBookingEvidenceAccess({ credentialJson, fileId, drive }) {
  const credentials = JSON.parse(credentialJson)
  if (credentials.type !== 'service_account') throw new Error('Expected service_account credential')
  const metadata = await drive.metadata(fileId)
  const bytes = await drive.firstBytes(fileId)
  return {
    credentialType: 'service_account',
    metadataReadable: true,
    mediaReadable: Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 64,
    mimeAllowed: ['image/jpeg', 'image/png'].includes(metadata.mimeType),
    writeCapabilityRequested: false,
  }
}

async function realDrive(credentials) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  const api = google.drive({ version: 'v3', auth })
  return {
    async metadata(fileId) {
      const result = await api.files.get({ fileId, fields: 'mimeType' })
      return { mimeType: String(result.data.mimeType ?? '') }
    },
    async firstBytes(fileId) {
      const result = await api.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer', headers: { Range: 'bytes=0-63' } },
      )
      return Buffer.from(result.data)
    },
  }
}
```

The CLI must parse `BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON`, create `realDrive`, read `BOOKING_EVIDENCE_TEST_FILE_ID`, call the exported function, print only the safe result, and exit 1 if any boolean except `writeCapabilityRequested` is false or if `writeCapabilityRequested` is not false.

Output exactly this shape:

```json
{
  "credentialType": "service_account",
  "metadataReadable": true,
  "mediaReadable": true,
  "mimeAllowed": true,
  "writeCapabilityRequested": false
}
```

Exit non-zero if any boolean would be false. Never test a write action.

- [ ] **Step 4: Add the package command**

```json
"booking:verify-evidence-access": "node scripts/verifyBookingEvidenceAccess.mjs"
```

- [ ] **Step 5: Document secure setup**

Document these exact rules:

- Service Account JSON stays in ignored local `API/` and Render secret storage;
- never paste it into chat;
- share only `PMC Bookings` as Viewer;
- use one synthetic JPEG/PNG for the verifier;
- do not grant Sheets, Calendar, Forms, Project Editor, or Owner access;
- remove the synthetic file after pilot.

- [ ] **Step 6: Run tests and safe access verification**

Set both variables without printing them and run:

```bash
npm run booking:verify-evidence-access
npm run test -- tests/verifyBookingEvidenceAccess.test.ts
```

Expected: all five safe fields pass.

- [ ] **Step 7: Commit code/docs only**

```bash
git add scripts/verifyBookingEvidenceAccess.mjs tests/verifyBookingEvidenceAccess.test.ts package.json package-lock.json apps/pmc-google-booking-ops/docs/setup.md .gitignore
git commit -m "chore: verify booking evidence Drive access"
```

Never stage Credential JSON or synthetic evidence.

---

### Task 8: Deploy, Run the Synthetic Evidence Pilot, and Record the Gate

**Files:**
- Modify: `apps/pmc-google-booking-ops/docs/pilot-runbook.md`
- Modify: `docs/PROJECT_UPDATES.md`
- Modify outside Git: `/Users/natthaphon/Documents/LB Ax/Ax/Projects/PMC Ads Agent/Current Work.md`

**Interfaces:**
- Consumes: Tasks 1-7 and company-owned credentials.
- Produces: verified Render proxy, Apps Script deployment, LINE Flex evidence proof, and go/no-go record.

- [ ] **Step 1: Run complete local verification**

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npm run test
npm run build
git diff --check
```

Expected: every command exits 0. The existing Vite chunk notice may remain a warning.

- [ ] **Step 2: Deploy Render code with secrets absent**

Push the approved branch to `main`, wait for Render, then verify:

```text
GET /healthz -> 200
GET /api/booking-evidence/image -> 503 or 400 with generic JSON
```

No Drive access occurs before configuration.

- [ ] **Step 3: Configure secrets without printing values**

```text
Render:
  BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON
  BOOKING_MEDIA_SIGNING_SECRET

Apps Script:
  BOOKING_MEDIA_BASE_URL
  BOOKING_MEDIA_SIGNING_SECRET
```

Use one cryptographically random secret of at least 32 bytes in both systems.

- [ ] **Step 4: Verify negative proxy cases**

- missing token -> `400`;
- altered signature -> `403`;
- unsupported synthetic PDF -> `415`;
- inaccessible file -> `404`;
- no response/log includes token, file ID, filename, or customer content.

- [ ] **Step 5: Deploy Apps Script using the existing deployment ID**

```bash
npm run booking:build
npm run booking:push
npx @google/clasp create-version "Admin evidence Flex and signed media proxy" --json
```

Resolve existing deployment ID and new version from Clasp JSON, then run `clasp deploy` with those resolved values. Do not paste real IDs into source, docs, or chat.

- [ ] **Step 6: Validate LINE messages**

Send Admin and doctor message objects to `POST /v2/bot/message/validate/push`; expected `200`. Do not print token or signed media URLs.

- [ ] **Step 7: Run the synthetic production scenario**

Before submission, verify both Google Form evidence questions accept image uploads only. Then use a synthetic identity, a valid internal test number matching `^0\d{8,9}$`, one synthetic JPEG slip, three synthetic JPEG/PNG chat screenshots, and a future non-conflicting appointment.

Expected:

- `BOOKING_CONFIRMED`;
- Drive `OK`;
- Calendar `OK`;
- Admin LINE `OK` with slip + three chat previews;
- each preview opens its full image;
- doctor LINE contains no evidence;
- call task count `1`;
- retry count `0`;
- audit has audience/count/status only and no URL/token.

- [ ] **Step 8: Verify permanence and revocation**

1. Fetch the same preview URL twice; both return `200` and identical bytes.
2. Remove Service Account Viewer access; the URL becomes unavailable.
3. Restore Viewer access; the URL returns `200` again.
4. Rotate signing secret in both systems; old URL returns `403`, newly generated URL returns `200`.
5. Restore the final approved signing secret and keep all test URLs out of docs/logs.

- [ ] **Step 9: Record safe pilot evidence**

Record only Case ID, pass/fail booleans, HTTP statuses, Apps Script version, Render commit SHA, audience names, image count, and audit event IDs. Do not record signed URLs, file IDs, tokens, credentials, customer identity, or image content.

- [ ] **Step 10: Commit final documentation**

```bash
git add apps/pmc-google-booking-ops/docs/pilot-runbook.md docs/PROJECT_UPDATES.md
git commit -m "docs: record booking evidence Flex pilot"
```

Update Obsidian `Current Work.md` with the same safe summary outside Git.

## Final Go/No-Go Gate

Evidence images remain **NO-GO** if any condition is true:

- Service Account can write Drive or access unrelated PMC resources;
- Drive evidence is public-by-link;
- invalid signature returns image content;
- Admin Flex fails LINE validation;
- doctor payload contains evidence URL/image;
- evidence URL/token appears in logs or audit;
- preview exceeds LINE's size/dimension contract;
- retry duplicates Admin/doctor messages;
- any local test/lint/typecheck/build fails;
- synthetic pilot cannot revoke access through folder permission removal and signing-secret rotation.

Evidence images become **GO** only after the owner reviews rendered Admin/doctor messages and explicitly authorizes real-customer use.
