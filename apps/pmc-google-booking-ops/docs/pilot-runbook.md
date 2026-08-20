# PMC Google Booking Operations Pilot Runbook

## Pilot boundary

Use synthetic identities, synthetic phone numbers reserved for testing, non-customer images, and a copied privacy-safe JERA fixture. Do not use real customers during technical verification.

Pilot participants:

- one manager;
- one Admin/assistant;
- two doctor LINE groups; and
- the company automation account.

## Evidence register

For every scenario, record:

- Case ID;
- Form response timestamp;
- Booking status and version;
- Drive folder/file IDs;
- Calendar event ID;
- LINE destination and safe event type;
- call task state;
- JERA import file/hash/status;
- audit event IDs;
- retry/reconciliation IDs; and
- Dashboard KPI before/after values.

Do not paste tokens, full phone numbers, national IDs, slip/chat content, or unrestricted links into the register.

## Scenarios

### 1. Valid booking

Expected:

- one Case ID;
- one private Drive folder with renamed synthetic evidence;
- one event in the selected doctor's Calendar;
- one safe LINE message only in that doctor's group;
- one open call task beginning on appointment day; and
- Dashboard booking/deposit counts increase once.

### 2. Calendar conflict

Expected:

- `TIME_CONFLICT` and `calendarState=CONFLICT`;
- no new Calendar event;
- no doctor LINE booking message; and
- Admin-visible exception.

### 3. Missing evidence

Expected:

- Form validation blocks submission or workflow rejects it;
- no Case ID reservation;
- no Drive, Calendar, or LINE side effect.

### 4. LINE retry

Simulate one non-2xx LINE response.

Expected:

- booking and Calendar remain valid;
- `lineState=RETRY`;
- one retry item with safe error;
- retry does not duplicate Drive or Calendar.

### 5. Call overdue

Advance a synthetic task beyond Day 7 without recording a call.

Expected:

- `CALL_OVERDUE`;
- reminder routed to Admin group and owner only once per day;
- Dashboard overdue count increases.

### 6. JERA paid match

Use one privacy-safe `ชำระแล้ว` row matching normalized phone plus name.

Expected:

- `CLOSED_JERA`;
- JERA payment ID consumed once;
- open call task cancelled;
- commission eligibility `PENDING_RULE`;
- commission amount blank.

### 7. Ambiguous JERA match

Create two open synthetic bookings with the same normalized name and phone.

Expected:

- no case closes;
- one `RECONCILIATION` item lists candidate Case IDs;
- manager identity/reason required for resolution.

### 8. Expiry and retention

Advance a synthetic case beyond six calendar months and then 90 days past terminal status.

Expected:

- `EXPIRED_6M` and call tasks cancelled;
- evidence enters retention approval queue;
- Drive evidence remains until manager approval;
- approval trashes only the evidence folder and appends an audit event.

### 9. Duplicate/replay safety

Resubmit the same Form response, JERA file content, JERA payment ID, LINE ingress nonce, and daily reminder run.

Expected:

- no duplicate Case ID, Calendar event, Drive evidence, closure, directory row, or same-day reminder.

## Verification commands

```bash
npm run booking:test
npm run booking:typecheck
npm run booking:build
npm run lint
npm run test
npm run build
git diff --check
```

## Go/no-go gates

Production is **NO-GO** if any of these are true:

- any test/build/lint command fails;
- a doctor receives another doctor's case;
- a LINE payload contains raw evidence, an unrestricted Drive link, or a national-ID-like value, or customer identity is routed to an unmapped group;
- Google closes a case without unique JERA `ชำระแล้ว` evidence;
- replay creates a duplicate side effect;
- a manager cannot trace a controlled change through `AUDIT_LOG`;
- a retention job deletes evidence without approval; or
- Google/LINE assets are not company-owned.

Production becomes **GO** only after the manager signs the evidence register and explicitly authorizes real-customer use.
