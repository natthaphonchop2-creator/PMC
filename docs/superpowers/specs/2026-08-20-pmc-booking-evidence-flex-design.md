# PMC Booking Evidence Flex and Signed Media Proxy Design

**Date:** 2026-08-20  
**Status:** Approved architecture; pending written-spec review before implementation planning  
**Project:** PMC Google Booking Operations  
**Related design:** `docs/superpowers/specs/2026-08-20-pmc-google-booking-operations-design.md`

## 1. Objective

Upgrade the confirmed-booking LINE Flex Message into a serious white-and-gold operational card and show real payment/chat evidence inside the mapped Admin group without making the Google Drive evidence folders public.

The selected doctor group continues to receive the full operational customer identity required for the appointment, but it does not receive payment slips, chat screenshots, deposit values, or marketing-channel details.

## 2. Approved Decisions

- Use the existing Render service as a signed Google Drive media proxy.
- Keep all evidence files private in the company-owned `PMC Bookings` Drive hierarchy.
- Use a Google Service Account with read-only access to the `PMC Bookings` root.
- Evidence URLs do not expire.
- Evidence URLs are bearer links: anyone who obtains a valid URL can open the image until the signing secret is rotated or the source file is removed.
- Do not make Drive files or folders public-by-link.
- Do not copy evidence into Google Cloud Storage or another storage system.
- Show evidence images only in the mapped Admin operations group.
- Do not show evidence images in doctor groups.
- Use a serious white Flex design with restrained champagne-gold accents and no decorative hero or mascot.
- Support JPEG and PNG evidence only in phase 1.
- Show one payment-slip image and up to three chat images in the Flex card.
- If more than three chat images exist, show a `+N รูปเพิ่มเติมใน Drive` label without exposing a Drive URL.

## 3. Non-Goals

- No public Drive sharing.
- No anonymous evidence directory or file listing.
- No PDF, HEIC, video, or animated-image conversion in phase 1.
- No evidence images in doctor LINE groups.
- No file upload into LINE itself.
- No new customer portal or evidence gallery page.
- No replacement of Google Sheets as the operational source of truth.
- No automatic deletion or retention-policy change.

## 4. User Experience

### 4.1 Admin Flex Message

The mapped Admin group receives one white Flex bubble after Drive and Calendar complete successfully.

**Header**

- `เคสจองใหม่`
- Case ID
- narrow champagne-gold divider

**Booking summary**

- Admin owner
- full customer name
- full customer phone
- doctor
- service/program
- appointment date and time
- deposit amount
- channel
- evidence counts

**Evidence section**

- label `หลักฐานการโอน`
- one large payment-slip preview
- label `หลักฐานแชท`
- one to three chat-image thumbnails
- each image is tappable and opens the signed full-image URL
- if chat evidence exceeds three images, show `+N รูปเพิ่มเติมใน Drive`

The bubble background is `#FFFFFF`. Gold accents use a restrained champagne tone; text uses dark neutral brown/black for contrast. There is no mascot, logo lockup, decorative hero, gradient, or marketing copy.

### 4.2 Doctor Flex Message

The selected doctor's mapped group receives a white operational Flex bubble containing:

- Case ID
- full customer name
- full customer phone
- service/program
- appointment date and time
- Admin owner

It contains no slip, chat image, deposit amount, channel, Drive link, or evidence URL.

### 4.3 Fallback behavior

- If evidence media URL generation fails, the Admin message still sends the booking summary with evidence counts and a safe `รูปหลักฐานยังไม่พร้อมแสดง` status.
- A media failure never prevents the doctor notification.
- A media failure creates a retry item and an Admin-visible operational exception.
- LINE alt text contains Case ID and customer name but never includes a signed evidence URL.

## 5. Architecture

```text
Google Form file upload
        |
        v
Private Google Drive evidence folder
        |
        | Service Account read-only access
        v
Render /api/booking-evidence/image?t=<signed-token>
        |
        | verifies HMAC and fetches by Drive file ID
        v
JPEG/PNG preview or original response
        |
        v
LINE Flex image component (Admin group only)
```

### 5.1 Components

1. **Apps Script media URL signer**
   - creates permanent signed preview/full URLs from Case ID, evidence kind, ordinal, and Drive file ID;
   - never sends the signing secret or raw Drive credentials to LINE;
   - routes evidence URLs only to the Admin Flex builder.

2. **Render evidence proxy**
   - verifies the signed token before contacting Google Drive;
   - uses Service Account credentials from Render environment secrets;
   - validates file type and size;
   - returns resized preview or original image;
   - never lists a Drive directory.

3. **Google Drive**
   - remains the only evidence store;
   - grants the Service Account Viewer access only at the `PMC Bookings` root;
   - keeps customer folders private from anonymous users.

4. **LINE Flex builders**
   - Admin builder includes evidence images;
   - doctor builder never receives evidence URLs;
   - both retain separate idempotent retry keys.

## 6. Signed URL Contract

### 6.1 Token format

The URL contains one opaque base64url payload and one HMAC signature:

```text
https://pmc-ads-agent.onrender.com/api/booking-evidence/image?t=<payload>.<signature>
```

Decoded payload fields:

```json
{
  "v": 1,
  "caseId": "PMC-YYYYMM-NNNN",
  "fileId": "<google-drive-file-id>",
  "kind": "PAYMENT|CHAT",
  "ordinal": 1,
  "variant": "preview|full"
}
```

The canonical signature input is the exact base64url payload string. The signature is HMAC-SHA256 with `BOOKING_MEDIA_SIGNING_SECRET`, encoded as lowercase hex.

There is no expiry field. This is an explicit owner-approved risk decision.

### 6.2 Verification

Render must:

1. split token into exactly two parts;
2. reject malformed base64url;
3. compute HMAC over the unmodified payload segment;
4. compare signatures with constant-time comparison;
5. validate the payload schema and exact allowed enums;
6. validate Case ID and Drive file ID character patterns;
7. reject unknown token versions;
8. fetch only the specified Drive file ID;
9. reject non-JPEG/PNG MIME types;
10. reject files larger than 10 MB;
11. return no credential, file metadata, stack trace, or Drive URL in errors.

### 6.3 Revocation

- Deleting/trashing the Drive file makes that image unavailable.
- Removing Service Account access disables all evidence serving.
- Rotating `BOOKING_MEDIA_SIGNING_SECRET` invalidates all existing evidence URLs.
- Phase 1 does not implement per-token revocation or expiry.

## 7. Google Service Account Boundary

Render receives Service Account credentials through `BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON` as a secret environment variable.

The Service Account:

- has no Editor access to the Spreadsheet;
- has no Calendar access;
- has no Forms access;
- has no LINE access;
- receives Viewer access only to the `PMC Bookings` Drive root;
- uses the Drive API only for `files.get` metadata and media download.

Credentials are never stored in source control, Sheet cells, Apps Script source, LINE messages, logs, or audit payloads.

## 8. Runtime Configuration

### 8.1 Render secrets

```text
BOOKING_GOOGLE_SERVICE_ACCOUNT_JSON
BOOKING_MEDIA_SIGNING_SECRET
```

### 8.2 Apps Script properties

```text
BOOKING_MEDIA_BASE_URL=https://pmc-ads-agent.onrender.com/api/booking-evidence/image
BOOKING_MEDIA_SIGNING_SECRET
```

The signing secret must be identical in Render and Apps Script. Setup must fail by property name only if either property is missing; it must never log the value.

## 9. Evidence Data Flow

1. Admin submits Booking Form with required payment and chat images.
2. Apps Script validates evidence file IDs.
3. Drive workflow moves/renames files into the private case folder without changing file IDs.
4. Calendar conflict check and event creation complete.
5. Apps Script generates preview/full signed URLs for:
   - first payment file;
   - first three chat files.
6. Admin Flex builder receives the approved URLs and evidence counts.
7. Doctor Flex builder receives no evidence URLs.
8. LINE validates/sends Admin and doctor messages with separate retry keys.
9. Audit records audience, evidence counts, and send status, but not signed URLs.

The existing LINE retry payload must persist the evidence file ID arrays so a `BOOKING_LINE` retry can regenerate identical signed URLs. Permanent signed URLs are deterministic for the same Case ID, file ID, kind, ordinal, and variant.

No new `BOOKING_MASTER` columns are required in phase 1. File IDs needed for a failed LINE send remain in the retry payload, encoded as JSON in `RETRY_QUEUE`.

## 10. Image Processing

### 10.1 Preview variant

- applies EXIF orientation;
- resizes inside 1024 x 1024 without enlargement;
- converts to JPEG quality 82;
- targets less than 1 MB;
- uses `image/jpeg` response type.

### 10.2 Full variant

- streams the original JPEG/PNG;
- maximum file size 10 MB;
- uses `Content-Disposition: inline`;
- preserves original orientation metadata behavior of the client.

### 10.3 Unsupported evidence

The Booking Form must restrict both evidence questions to image uploads. If an existing response contains PDF, HEIC, video, or another unsupported MIME type, the proxy returns `415` and the Flex builder uses a no-image fallback for that item.

## 11. HTTP Behavior

| Condition | Response |
|---|---|
| Valid preview | `200 image/jpeg` |
| Valid full JPEG/PNG | `200 image/jpeg` or `200 image/png` |
| Missing token | `400 application/json` |
| Invalid signature | `403 application/json` |
| Unsupported MIME | `415 application/json` |
| File too large | `413 application/json` |
| Missing/trashed/inaccessible file | `404 application/json` |
| Drive unavailable | `502 application/json` |
| Missing server configuration | `503 application/json` |

Responses include `X-Content-Type-Options: nosniff`. Error bodies are generic and contain no file ID, token, customer data, or provider error detail.

## 12. Privacy and Risk Acceptance

Permanent signed URLs are not public directory links, but they are bearer credentials. Anyone who obtains a valid URL can access the evidence while the signing secret and Drive file remain valid.

Controls retained in phase 1:

- unguessable HMAC-signed URLs;
- no directory listing;
- Admin group only;
- no URLs in doctor payloads;
- read-only Service Account;
- source Drive remains private;
- tokens omitted from logs/audit;
- global revocation through signing-secret rotation;
- file-level revocation through Drive deletion/trash.

This does not prevent screenshots, forwarding an already-rendered image, device caching, or a member copying a signed URL from LINE.

## 13. Testing

### 13.1 Unit and contract tests

- deterministic token generation;
- valid signature accepted;
- one-character payload/signature mutation rejected;
- malformed token rejected;
- unknown version/kind/variant rejected;
- constant-time signature comparison path;
- invalid Drive file ID rejected before API call;
- non-image MIME rejected;
- oversized file rejected;
- preview resize/format contract;
- Admin Flex uses white background and contains payment/chat images;
- doctor Flex contains no evidence URL/image component;
- evidence URL absent from alt text, logs, and audit;
- LINE retry regenerates the same deterministic URLs;
- no duplicate Admin/doctor messages after retry.

### 13.2 Integration tests

- mocked Drive metadata/media responses;
- Render proxy valid/invalid HTTP cases;
- full Booking workflow with one payment and multiple chat images;
- LINE official message-object validation for both audiences.

### 13.3 Synthetic production pilot

- one synthetic JPEG payment slip;
- three synthetic JPEG/PNG chat screenshots;
- Admin Flex visibly renders all four approved previews;
- each image opens the signed full-image URL;
- doctor Flex contains no evidence;
- invalid signature returns `403`;
- removing Service Account folder access makes the image unavailable;
- restoring access recovers the same permanent URL;
- audit contains no token or URL.

## 14. Rollout

1. Create/select the company Service Account.
2. Enable Drive API in its Cloud project.
3. Share only `PMC Bookings` root as Viewer to the Service Account email.
4. Store Service Account JSON and signing secret in Render.
5. Store matching base URL and signing secret in Apps Script Properties.
6. Deploy proxy with no Flex image references yet.
7. Verify valid/invalid synthetic proxy requests.
8. Update Admin Flex builder and LINE retry payload.
9. Validate messages with the LINE push-message validator.
10. Run synthetic production pilot.
11. Enable evidence images only after owner review.

## 15. Rollback

- Disable evidence images in the Admin Flex builder.
- Keep text/full operational Flex summaries working.
- Remove Service Account access to `PMC Bookings`.
- Rotate or remove `BOOKING_MEDIA_SIGNING_SECRET` from Render and Apps Script.
- Leave Drive evidence and booking records intact.
- Do not delete audit evidence during rollback.

## 16. Acceptance Criteria

- Admin confirmed-booking Flex is serious, white, readable, and contains the approved evidence previews below the booking details.
- Doctor Flex contains necessary full booking identity but no evidence image or URL.
- Drive files remain private and are never switched to public-by-link.
- LINE can fetch valid preview URLs without Google login.
- Invalid/modified tokens cannot fetch evidence.
- Valid URLs remain usable without expiry until global/file-level revocation.
- Service Account cannot modify Drive evidence or access unrelated PMC Google resources.
- Retry does not duplicate messages and regenerates deterministic URLs.
- No token, Service Account credential, signed URL, raw evidence, or customer PII is written to logs or audit payloads.
- Existing Sheet, Calendar, JERA, call-reminder, and retention workflows continue to pass their full test suites.
