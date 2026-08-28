# PMC LINE Mini App Stock Ledger Design

**Date:** 2026-08-28

**Status:** Approved in chat; pending written specification review

**Project:** PMC Web

**Audience:** PMC owner, Stock managers, active clinic staff, and developers

## 1. Objective

Replace the clinic's handwritten stock-withdrawal notebook with a mobile-first internal Stock module inside the existing PMC LINE Mini App.

Version 1 supports exactly these operating tasks:

1. Add a product with an opening quantity.
2. Receive one or more products into stock.
3. Issue one or more products from stock for clinic use.
4. View current on-hand quantities.
5. Reconcile a product to a physically counted quantity with a mandatory reason.
6. Review immutable stock history.

Google Sheets remains the private backend. Staff and Stock managers perform every operational action in the LINE Mini App. Only developers may inspect or repair the Sheet directly.

## 2. Approved Product Decisions

- The module covers both clinic consumables and products sold to customers.
- Product categories are `CLINIC_SUPPLY` and `RETAIL_PRODUCT`.
- Version 1 has one fixed unit per product. There is no pack conversion or multi-unit support.
- A withdrawal is not linked to a booking, customer, doctor, service, or Case ID.
- One issue document can contain multiple products.
- Every active staff member can view balances and issue products.
- Only Stock managers can add products, receive stock, reconcile physical counts, and deactivate products.
- The initial Stock managers are:
  - the owner's currently linked LINE staff record;
  - `อาย`;
  - `หมวย`.
- Stock-manager resolution is fail-closed. Setup must stop if any configured manager is missing or ambiguous in `CONFIG_STAFF`.
- Issue quantity cannot exceed the latest available balance.
- Low-stock status is shown only inside the Mini App.
- Each product has its own configurable low-stock threshold.
- Physical-count reconciliation is manager-only and requires a reason.
- JERA remains separate in version 1. The Stock module neither reads nor writes JERA.
- Google Sheet links and direct Sheet-edit instructions are not shown to staff.

## 3. Non-Goals

- No JERA stock synchronization or automatic JERA deduction.
- No customer, booking, Case ID, doctor, service, or procedure linkage.
- No supplier master, purchase order, goods-receipt document, or approval workflow.
- No batch, lot, serial number, expiration date, or barcode tracking.
- No pack-size or unit conversion.
- No direct browser-to-Sheet write.
- No direct staff access to the backend Sheet.
- No deletion or editing of historical ledger rows.
- No LINE group notification for low stock in version 1.
- No negative stock, backorder, reservation, or pending approval state.
- No valuation, weighted-average cost, FIFO, revenue, margin, or accounting report.

## 4. Source-of-Truth Boundary

The Stock ledger in Google Sheets is authoritative for the Mini App's operational quantity. JERA may maintain a separate stock record for clinic operations, but version 1 does not reconcile or synchronize the two systems.

| Domain | Authoritative system | Staff interface |
|---|---|---|
| Product master | `STOCK_PRODUCTS` | LINE Mini App |
| Receipts, issues, and adjustments | `STOCK_LEDGER` | LINE Mini App |
| Mini App on-hand quantity | Sum of `STOCK_LEDGER.quantityDeltaMilli` | LINE Mini App |
| Access identity | LINE ID token + `CONFIG_STAFF` | Automatic |
| Stock-manager permission | `CONFIG_STAFF.canManageStock` | Developer configured |
| Denied or failed actions | `STOCK_AUDIT` | Developer inspection |
| JERA stock | JERA | Outside version 1 |

No mutable `quantityOnHand` field is authoritative. On-hand quantity is derived from the immutable ledger so a partial update cannot silently corrupt the balance.

## 5. Architecture

### 5.1 Topology

```text
PMC Rich Menu
     |
     v
LINE Mini App Stock UI
     |
     | verified LINE ID token
     v
Cloud Run: pmc-mini-app
  - verify LINE identity
  - authorize active CONFIG_STAFF record
  - expose stock read APIs
  - validate bounded write requests
  - sign Stock command envelopes
     |
     v
Existing Booking Apps Script web app
  - verify HMAC, timestamp, nonce, and exact payload
  - re-check staff and canManageStock permission
  - acquire Script Lock
  - validate all lines against latest ledger balances
  - append one immutable ledger batch
  - return an idempotent result
     |
     v
Private Google Sheet backend
  - STOCK_PRODUCTS
  - STOCK_LEDGER
  - STOCK_AUDIT
```

Cloud Run may read the allowlisted stock tabs through its keyless service identity. All stock mutations pass through the signed Apps Script boundary because Apps Script `LockService` provides cross-request serialization for the Sheet-backed ledger.

### 5.2 Repository boundaries

```text
src/apps/pmc-mini-app/stock/
  - stock routes and navigation
  - balance list
  - multi-product issue flow
  - manager product/receive/adjust flows
  - stock history
  - typed Stock API client

server/pmc-mini-app/stock/
  - read model and Sheet aggregation
  - LINE staff authorization
  - signed Stock ingress client
  - safe API errors

apps/pmc-google-booking-ops/src/stock/
  - Stock envelope verification
  - role validation
  - lock-protected ledger commands
  - idempotency and audit handling

shared/
  - canonical signed Stock command contracts
```

Stock code remains isolated from booking, evidence, Calendar, LINE notification, call queue, JERA, and commission workflows.

## 6. Identity and Authorization

1. The Mini App sends a raw LINE ID token with every Stock API request.
2. Cloud Run verifies the token against the configured LINE channel.
3. The LINE user ID must map to one active `CONFIG_STAFF` row.
4. Active staff may call read APIs and submit `ISSUE` commands.
5. `CREATE_PRODUCT`, `RECEIVE`, `ADJUST`, and `DEACTIVATE_PRODUCT` require `canManageStock=true`.
6. Apps Script re-checks staff state and role before mutation. A valid Cloud Run signature alone does not bypass the staff role.
7. Denied commands return a generic Thai message and append a safe audit event without raw tokens.

Add `canManageStock` to `CONFIG_STAFF`. Existing rows default to false. The setup workflow sets it true only for the owner's linked staff record, `อาย`, and `หมวย` after exact unambiguous resolution.

## 7. Sheet Schema

### 7.1 `STOCK_PRODUCTS`

```text
productId
name
normalizedName
category
unit
minimumQuantityMilli
active
createdAt
createdByStaffId
updatedAt
updatedByStaffId
version
```

Rules:

- `productId` is server-generated and immutable.
- Active product names must be unique after whitespace and case normalization.
- `category` is `CLINIC_SUPPLY` or `RETAIL_PRODUCT`.
- `unit` is a visible fixed text value such as `ชิ้น`, `กล่อง`, `ขวด`, or `หลอด`.
- Quantities use integer milli-units internally. The UI supports up to three decimal places and hides unnecessary trailing zeros.
- Products are deactivated, never deleted.

### 7.2 `STOCK_LEDGER`

```text
transactionId
documentId
requestId
lineNumber
productId
transactionType
quantityDeltaMilli
balanceBeforeMilli
balanceAfterMilli
actorStaffId
actorDisplayName
reason
idempotencyKey
createdAt
```

`transactionType` values:

- `OPENING` — initial quantity from product creation.
- `RECEIVE` — manager receives stock; positive delta.
- `ISSUE` — active staff withdraws stock; negative delta.
- `ADJUST` — manager reconciles to a physical count; signed positive or negative delta.

All rows belonging to one multi-product action share one `documentId` and `requestId`. One ledger row is written per product line. Duplicate product lines in one request are rejected rather than silently combined.

### 7.3 `STOCK_AUDIT`

```text
eventId
requestId
actorStaffId
action
status
safeErrorCode
targetProductIdsJson
correlationId
createdAt
```

The audit tab stores safe operational evidence such as denied access, insufficient balance, invalid products, replay detection, and recovery of an idempotent request. It does not store raw LINE tokens or secrets.

## 8. Command Model and Transaction Rules

### 8.1 Common envelope

Every mutation uses a signed envelope containing:

```text
kind = MINI_APP_STOCK
version = 1
timestamp
nonce
requestId
staffId
commandType
payload
signature
```

The signature covers an exact canonical payload. Apps Script rejects expired timestamps, reused nonces, unknown fields, inactive staff, invalid role, and altered content.

### 8.2 Multi-product atomicity

For `RECEIVE` and `ISSUE`:

1. Acquire a Script Lock.
2. Resolve the idempotency key. If the request already succeeded, return its existing result.
3. Read active products and current ledger balances.
4. Validate every requested line before writing any ledger row.
5. For issue, reject the entire document if any line would become negative.
6. Append all document lines with one `setValues` call.
7. Append a success audit row.
8. Release the lock and return the document result.

No partial issue document is accepted.

### 8.3 Product creation

Product creation and optional opening balance use one `requestId`.

- Create the product row if it does not exist.
- Append one `OPENING` row when the opening quantity is greater than zero.
- A retry repairs a missing opening row or returns the existing result without creating another product.
- A duplicate normalized active name is rejected.

### 8.4 Physical-count adjustment

The manager submits the physically counted quantity, not a manual delta.

```text
delta = counted quantity - current ledger balance
```

The reason is mandatory. A zero-delta adjustment is recorded only in `STOCK_AUDIT`; it does not create a zero ledger row.

## 9. Mini App Information Architecture

### 9.1 Home integration

- Enable the existing `Stock` card on the Mini App home page.
- Add `STOCK` to the internal route model.
- Do not expose a Google Sheet link.
- Stock remains behind `PMC_STOCK_ENABLED` during rollout.

### 9.2 Stock home

The Stock home screen contains:

- search by product name;
- filters: all, clinic supplies, retail products, low stock;
- product cards showing name, category, on-hand quantity, unit, and low-stock badge;
- primary action `เบิกสินค้า`;
- read-only `ประวัติ` action;
- manager-only actions `รับเข้า` and `จัดการสินค้า`.

Low stock means `onHandMilli <= minimumQuantityMilli`. Inactive products are hidden from normal issue selection and visible only to managers in product management.

### 9.3 Multi-product issue flow

1. Search and select one or more active products.
2. Enter a positive quantity for each line.
3. Show current and projected balance per line.
4. Block duplicate products in the same document.
5. Confirm the complete document once.
6. Disable repeated submission while pending.
7. Return the same result for repeated taps with the same request ID.
8. Show success with the issue document number.

No customer, case, doctor, service, or reason field is shown.

### 9.4 Manager flows

#### Add product

```text
name
category
unit
opening quantity
minimum quantity
```

#### Receive stock

- select multiple active products;
- enter positive quantities;
- confirm one receive document.

#### Adjust physical count

- select one active product;
- show current balance;
- enter counted quantity;
- require a reason;
- show resulting delta before confirmation.

#### Product management

- search all products;
- edit name, category, and minimum quantity using optimistic version checks;
- edit the unit only before the product has ledger activity; otherwise deactivate it and create a new product so historical quantities keep their original meaning;
- deactivate or reactivate a product;
- never delete a product or its ledger history.

### 9.5 History

History shows the latest documents with:

- document number;
- transaction type;
- staff display name;
- date and time;
- number of product lines;
- expandable line details.

Active staff can view stock ledger history. Stock managers can also see adjustment reasons. Developer-only security and failure events remain in `STOCK_AUDIT`. Historical entries are read-only.

## 10. API Surface

Read endpoints:

```text
GET /api/mini-app/stock/products
GET /api/mini-app/stock/history?cursor=...
GET /api/mini-app/stock/documents/:documentId
```

Mutation endpoints:

```text
POST /api/mini-app/stock/issues
POST /api/mini-app/stock/products
POST /api/mini-app/stock/receipts
POST /api/mini-app/stock/adjustments
PATCH /api/mini-app/stock/products/:productId
```

Cloud Run authenticates every endpoint. Manager endpoints fail with `403 STOCK_MANAGER_REQUIRED` for non-managers. API responses expose no Sheet IDs, ranges, service credentials, HMAC secrets, or raw LINE identities.

## 11. Errors and Recovery

| Condition | API code | User behavior |
|---|---|---|
| Insufficient balance | `STOCK_INSUFFICIENT_BALANCE` | Show affected product and refreshed available quantity |
| Product inactive | `STOCK_PRODUCT_INACTIVE` | Remove it from the draft and refresh list |
| Product changed concurrently | `STOCK_STALE_PRODUCT` | Reload and ask manager to review |
| Duplicate product line | `STOCK_DUPLICATE_LINE` | Highlight the duplicate selection |
| Invalid quantity | `STOCK_INVALID_QUANTITY` | Highlight the quantity field |
| Manager permission missing | `STOCK_MANAGER_REQUIRED` | Hide manager controls and show safe denial |
| Request already completed | none; return prior success | Show the original document result |
| Sheet or Apps Script unavailable | `STOCK_STORAGE_UNAVAILABLE` | Preserve the local draft and allow retry |

No failure response may claim that stock changed unless the ledger rows can be read back by idempotency key.

## 12. Security and Integrity

- Verify LINE ID tokens server-side.
- Re-check staff status and role inside Apps Script.
- Use exact allowlisted Sheet tabs and schemas.
- Use HMAC signatures, five-minute timestamps, nonce replay protection, and request idempotency.
- Use Script Lock for every mutation.
- Validate all lines before ledger append.
- Never permit a negative balance.
- Never mutate or delete ledger history.
- Never log raw tokens, secrets, or unrestricted Sheet data.
- Keep Google Sheet backend access restricted to developers.
- Do not place Stock commands on the public LINE Messaging webhook contract.

## 13. Testing Requirements

### Domain and ledger

- opening quantity creates one product and one opening row;
- receive increases balance;
- multi-line issue decreases each product correctly;
- issue rejects the whole document when one product is insufficient;
- adjustment derives the correct signed delta;
- decimal quantities round-trip through integer milli-units;
- inactive products cannot be issued;
- duplicate normalized names are rejected.

### Concurrency and idempotency

- two simultaneous issues cannot create a negative balance;
- duplicate taps return one document and one ledger batch;
- retried product creation does not duplicate the opening row;
- stale product updates fail without overwriting newer data.

### Authorization

- active staff can read and issue;
- inactive or unknown staff are denied;
- non-managers cannot create, receive, adjust, or manage products;
- the owner, `อาย`, and `หมวย` receive manager access only after exact setup resolution.

### UI and browser

- Stock home, filters, search, low-stock badge, and history work on Android and iPhone LINE WebViews;
- multi-product issue shows current and projected balances;
- error focus and Thai messages are accessible;
- pending buttons prevent repeated interaction;
- no Sheet link is rendered.

### Regression

- Booking, Calendar, Drive evidence, LINE booking notification, call queue, JERA reporting pause, enrollment, and Google Form fallback remain unchanged.

## 14. Rollout

1. Ship code with `PMC_STOCK_ENABLED=false`.
2. Add and validate the three managed Sheet tabs without modifying existing tabs or values.
3. Extend `CONFIG_STAFF` with `canManageStock=false` by default.
4. Resolve the owner's linked staff record, `อาย`, and `หมวย`; fail closed on missing or duplicate records.
5. Enable Stock only for the three managers.
6. Create synthetic products and verify opening, receive, multi-line issue, insufficient-balance rejection, adjustment, history, and idempotent retry.
7. Reconcile the synthetic ledger and then deactivate the synthetic products. Do not delete test history automatically.
8. Verify Android and iPhone LINE WebViews.
9. Obtain owner approval and enable the Stock card for all active staff.

Rollback is non-destructive: set `PMC_STOCK_ENABLED=false`. Keep product, ledger, and audit rows intact for investigation. Booking and all existing Mini App modules continue operating.

## 15. Acceptance Criteria

The Stock V1 rollout is accepted only when:

- staff perform every Stock action inside LINE Mini App;
- no operational Sheet access is required;
- Stock managers are exactly the owner, `อาย`, and `หมวย` at pilot start;
- active staff can issue multiple products in one document;
- no issue can make any product negative;
- repeated taps do not duplicate documents or ledger rows;
- on-hand values reconcile exactly to ledger deltas;
- low-stock badges follow each product's threshold;
- adjustments require a reason and retain history;
- all specified mobile, concurrency, authorization, and regression tests pass;
- Stock can be disabled without affecting Booking, Calendar, LINE, Drive, JERA reporting, or Google Form fallback.
