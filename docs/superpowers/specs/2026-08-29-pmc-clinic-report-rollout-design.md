# PMC Clinic Reports Rebrand and Production Rollout Design

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Audience:** PMC owner and active internal staff

## 1. Goal

Enable the existing read-only production reporting subsystem in the PMC LINE Mini App, expose all 14 existing report views to active staff, and remove the provider name `JERA` from every user-visible and accessibility-facing string.

The provider integration remains internally named `JERA_*`. This avoids unnecessary changes to configuration, API contracts, cache schemas, and tested backend modules while presenting the reports as a PMC product surface.

## 2. Current State

- The backend already contains a read-only token client, allowlisted GET client, endpoint normalizers, cache, sync state, audit store, report projections, manual refresh API, and Scheduler route.
- The Mini App already contains the report center, shared date filters, 14 report views, cache/stale status, refresh behavior, and compact tables.
- Production currently has `JERA_REPORTING_ENABLED=false`.
- Secret Manager already contains bindings named `JERA_API_BASE_URL`, `JERA_API_USERNAME`, and `JERA_API_PASSWORD`; Cloud Run does not yet bind them to the active service revision.
- `JERA_DEFAULT_BRANCH_UUID`, `JERA_SYNC_INTERVAL_MINUTES`, and Scheduler bindings are not configured in Cloud Run.
- Existing JERA cache/sync/audit Sheet tabs are already part of the managed workbook schema.

## 3. Scope

### 3.1 User-facing reports

The release exposes these existing report selections:

1. สรุปวันนี้
2. ยอดรับชำระ
3. มัดจำ
4. คืนเงิน
5. นัดหมาย
6. รายการรับชำระ
7. การใช้สินค้าและบริการ
8. ยอดขายสินค้าและบริการ
9. รายการรับชำระที่ยกเลิก
10. รายงาน OPD
11. ค้างชำระที่ยกเลิก
12. ยอดขายคอร์ส
13. คอร์สคงเหลือ
14. คอร์สคงเหลือตามวันที่

`สรุปวันนี้` is computed from PAYMENT, DEPOSIT, REFUND, and APPOINTMENT. The other 13 selections map to the existing source-report registry.

### 3.2 Access

- Every active, LINE-linked `CONFIG_STAFF` member can access every version-1 report.
- Unknown and inactive users remain denied by the existing LINE ID-token and staff mapping boundary.
- Reports remain internal; there is no public URL, export-sharing flow, or customer-facing surface.

### 3.3 Read-only boundary

- The only provider POST is the token request.
- Business data uses only existing allowlisted GET endpoints.
- No patient, appointment, clinic, payment, refund, or course record is created or modified in the provider system.
- No automatic booking closure, DF payout, or commission recalculation is added.

## 4. Non-goals

- No Performer Fee or DF report in this release.
- No commission formula changes.
- No provider/internal type rename from `JERA_*`.
- No webhook or claim of event-driven real time.
- No new database, account system, or role-specific report visibility.
- No Scheduler creation during the initial manual rollout.

## 5. User-facing Language Contract

The provider name is an implementation detail and must not appear in rendered Mini App content, including visible labels, accessible names, alerts, loading states, empty states, headings, captions, and browser acceptance selectors.

Required copy:

| Surface | Copy |
|---|---|
| Home card label and accessible name | `รายงานคลินิก` |
| Home card description | `ดูข้อมูลการเงิน นัดหมาย และการดำเนินงาน` |
| Report center title | `รายงานคลินิก` |
| Report center eyebrow | `REPORT CENTER` |
| Report center source note | `ข้อมูลจากระบบคลินิกแบบอ่านอย่างเดียว` |
| Report page eyebrow | `CLINIC REPORT` |
| Additional-report eyebrow | `CLINIC REPORT` |
| Additional-report item note | `ดูข้อมูลรายงาน` |
| Refresh action | `รีเฟรชข้อมูล` |
| Stale state | `ข้อมูลอาจล่าช้า` |
| No successful cache | `ยังไม่มีข้อมูลที่ยืนยันแล้ว` |

Internal TypeScript names, server routes, safe error codes, Sheet tab names, Secret Manager names, logs, tests that inspect internal contracts, and operator documentation may retain `JERA` where necessary. A rendered-DOM regression test must activate every report UI surface and fail on `/JERA/i`.

The existing Thai-capable typography remains. Body line height must stay at least 1.55, Thai containers must use normal letter spacing, tables must retain semantic headers, and financial figures use tabular numerals.

## 6. Architecture and Data Flow

```text
Active LINE staff
  -> PMC LINE Mini App: รายงานคลินิก
  -> verified LINE ID token
  -> Cloud Run authenticated report API
  -> Google Sheet normalized cache / sync state / audit
  -> allowlisted read-only production provider API when refresh is required
```

The browser never receives provider credentials or bearer tokens. Cloud Run obtains a temporary access token in process memory, calls only allowlisted reads, normalizes data, writes bounded cache rows and safe sync metadata, and returns a report projection.

The implementation adds one owner-operated cache-seeding CLI that reuses the existing token client, read client, normalizers, coordinator, and Google Sheet store. It processes one source report at a time, honors `Retry-After`, requires an explicit production-read flag, emits aggregate evidence only, and has no provider-write capability. It does not add another HTTP endpoint.

## 7. Cache, Freshness, and Refresh

- Report reads are cache-first.
- Manual refresh is available to active staff through `รีเฟรชข้อมูล`.
- Refresh throttling and per-cache-key leases remain enabled to prevent duplicate provider calls.
- A failed live refresh retains the last successful cache and displays `ข้อมูลอาจล่าช้า`.
- An empty cache cannot be presented as a confirmed zero; it displays `ยังไม่มีข้อมูลที่ยืนยันแล้ว`.
- No raw provider body, bearer token, credential, phone number, ID number, or unrestricted customer record is written to logs or rollout evidence.
- Initial cache seeding is sequential across the 13 source report types; it never fans out production requests in parallel.
- Automatic Scheduler remains disabled until manual refresh, cache integrity, and owner review pass.
- When Scheduler is later approved, it refreshes only the existing five core source reports; additional reports remain on-demand unless a separate design expands the schedule.

## 8. Production Rollout Gates

### Gate A — copy and local verification

1. Replace user-facing provider references with the language contract.
2. Add rendered-DOM and browser acceptance tests proving that the provider name is absent.
3. Run full Mini App, JERA, Booking, Stock, OCR, build, lint, and Playwright verification.

### Gate B — disabled/no-traffic revision

1. Deploy a no-traffic revision with reporting disabled.
2. Bind the existing base-URL/username/password secrets to the runtime service account with accessor-only permissions.
3. Keep Scheduler bindings absent.
4. Verify health, Mini App, Booking, Stock, OCR, Calendar/LINE routes, and rollback revision.

### Gate C — production read-only shadow

1. Obtain a token without printing or storing it.
2. Read clinic/branch metadata and set the verified branch UUID as `JERA_DEFAULT_BRANCH_UUID`.
3. Set `JERA_SYNC_INTERVAL_MINUTES=15`.
4. Run sequential one-day shadow reads for PAYMENT, DEPOSIT, REFUND, and APPOINTMENT.
5. Respect provider `Retry-After`; do not parallelize production report requests.
6. Compare counts and totals with the same-day provider UI/export.
7. Record only report type, date, count, total satang, pass/fail, warning code, revision, reviewer, and timestamp.

### Gate D — cache seeding

1. After owner approval of the four core comparisons, enable bounded cache writes.
2. Run the owner-operated cache-seeding CLI for the approved one-day window.
3. Seed one-day cache entries for all 13 source report types sequentially, honoring `Retry-After` between requests.
4. Verify cache counts/totals and sync/audit rows without exposing customer records.
5. Verify `สรุปวันนี้` reconciles from the four core caches.

### Gate E — reporting-enabled revision

1. Deploy a no-traffic revision with reporting enabled and Scheduler still disabled.
2. Verify authenticated report APIs, manual refresh throttling, stale-cache fallback, and all 14 views.
3. Route production traffic only after owner approval.
4. Confirm a manager and a non-manager active account can open reports and that no rendered UI contains the provider name.

### Gate F — optional Scheduler

Scheduler creation is a separate owner gate after the manual rollout is stable. Rollback pauses Scheduler before changing traffic or flags.

## 9. Error Handling and Rollback

- Invalid or missing configuration constructs no report runtime and hides the report UI.
- Authentication failures remain 401/403 without provider details.
- Provider timeout, throttling, or malformed response maps to safe codes and keeps the last successful cache.
- Cache/header/integrity failure returns a safe unavailable response and never falls back to raw provider rows.
- Rollback sets reporting false or routes to the last reporting-disabled revision.
- Rollback never deletes cache, sync state, sync audit, Booking rows, Stock rows, or existing evidence.

## 10. Testing and Acceptance

Required automated evidence:

- User-facing copy tests for Home, report center, additional reports, and report pages.
- Rendered-DOM assertion that `/JERA/i` is absent from enabled report UI and accessibility labels.
- Existing backend config, token, GET allowlist, normalization, cache, lease, report projection, API, scheduler-auth, and runtime-safety suites remain green.
- Cache-empty, stale cache, timeout, throttling, malformed data, and XSS regressions remain green.
- Android-sized Playwright path: Home -> รายงานคลินิก -> filters -> report -> refresh -> back.
- Production readback: reporting flag, secret-binding presence only, authenticated API result, cache metadata, active revision, and no unexpected error logs.

Manual evidence:

- LINE WebView on at least one manager and one non-manager active account.
- Thai marks are not clipped; table scrolling and touch targets remain usable.
- Report totals/counts match the approved one-day comparison.
- No user-facing provider name appears.

## 11. Success Criteria

The release is complete when:

1. All 14 report selections open for active staff.
2. No rendered or accessibility-facing UI contains the provider name.
3. Provider access remains read-only and allowlisted.
4. The four core one-day reports match approved source counts and totals.
5. All 13 source caches are seeded or carry an explicit safe warning before UI enablement.
6. Cache/stale/refresh behavior works without exposing raw provider data.
7. Booking, Stock, evidence, Calendar, LINE, OCR, and Form fallback show no regression.
8. Production has a tested reporting-disabled rollback path.
