# PMC Clinic Report Production Rollout Evidence — 2026-08-29

## Release

- Source commit before this evidence record: `c257e21`
- Active Production revision: `pmc-mini-app-00044-lug`
- Production traffic: 100%
- Rollback revision: `pmc-mini-app-00042-hab`
- Reporting flag: enabled
- Scheduler bindings: absent by design for this rollout

## Approved one-day comparison

Report date: `2026-08-22`

| Report | API count | API total | Comparison count | Comparison total | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| PAYMENT | 13 | 18,904,000 satang paid | 13 | 18,904,000 satang paid | PASS |
| DEPOSIT | 0 | 0 satang | 0 | 0 satang | PASS — owner approved |
| REFUND | 1 | 90,000 satang | 1 | 90,000 satang | PASS |
| APPOINTMENT | 0 | 0 satang | 0 | 0 satang | PASS — owner approved |

The comparison export contained 13 unique payment IDs. No raw patient, payment, credential, URL, Sheet, or LINE identifiers are retained in this record.

## Sequential cache seed

| Source report | Rows | Total | Paid | Refund | Final warning |
| --- | ---: | ---: | ---: | ---: | --- |
| PAYMENT | 13 | 19,804,000 | 18,904,000 | 0 | none |
| DEPOSIT | 0 | 0 | 0 | 0 | none |
| REFUND | 1 | 0 | 0 | 90,000 | none |
| APPOINTMENT | 0 | 0 | 0 | 0 | none |
| PAYMENT_LIST | 13 | 19,804,000 | 18,904,000 | 90,000 | none |
| PRODUCT_USE | 73 | 18,246,400 | 17,616,400 | 0 | none |
| PRODUCT_SALES | 29 | 19,444,000 | 18,814,000 | 0 | none |
| CANCELLED_PAYMENT | 1 | 49,000 | 49,000 | 0 | none |
| OPD | 12 | 18,814,000 | 18,814,000 | 0 | none |
| CANCELLED_UNPAID | 0 | 0 | 0 | 0 | none |
| COURSE_SALES | 0 | 0 | 0 | 0 | none |
| REMAINING_COURSE | 0 | 0 | 0 | 0 | none |
| REMAINING_COURSE_BY_DATE | 0 | 0 | 0 | 0 | none |

All monetary values in this table are integer satang.

## Cache and audit readback

- Cache rows: 142
- Sync state rows: 13
- Final states: 13 SUCCESS
- Active leases: 0
- Audit rows: 30
- Successful audit rows: 28
- Failed audit rows: 2 recovered during rollout
- Recovered safe codes: `JERA_PROVIDER_FAILED`, `JERA_STORE_INVALID_INPUT`

## Verification

- Production build: PASS
- Main Vitest: 130 files / 1,461 tests PASS
- Booking Vitest: 42 files / 423 tests PASS
- OCR Vitest: 18 files / 231 tests PASS
- Browser acceptance: 10 / 10 PASS
- Lint: 0 errors; one pre-existing generated-file warning
- Pilot health, Mini App, and client config: HTTP 200
- Unauthenticated session, report, Booking, and Stock gates: HTTP 401
- Post-route Production health and authorization gates: PASS
- Post-route unexpected HTTP 5xx: 0
- Automated active-staff and manager UI contracts: PASS
- Manual LINE-device role check: pending owner open after rollout

## Rollback

Route 100% traffic back to `pmc-mini-app-00042-hab` and keep the report cache/audit tabs intact for investigation. Do not delete cache, sync, audit, Booking, Stock, Drive, Calendar, or LINE evidence during rollback.

## Production quota incident remediation

After the initial release, real report usage exposed a Google Sheets read-quota burst:

- Report requests observed: 28
- Successful report responses: 20
- Report HTTP 503 responses: 8
- Sheets HTTP 429 responses in the incident window: 137
- Cloud Run crash or restart: none
- Root cause: every cache GET started a provider refresh even while cache was fresh; TODAY_SUMMARY fanned out four cache/refresh paths concurrently; the client poll then repeated reads.

Remediation commit: `85871be`

- Fresh cache reads no longer start provider or Sheet writes until the configured 15-minute refresh interval is due.
- Distinct refresh work is serialized, same-key deduplicated, and capped at four pending operations.
- TODAY_SUMMARY cache reads and manual refresh initiation are sequential.
- Initial and manual refresh use bounded polling and stop as stale instead of leaving a permanent spinner.
- An older manual refresh cannot overwrite a newly selected date/filter.
- Scheduler remains disabled and is excluded from this release.

Post-remediation Production revision: `pmc-mini-app-00046-pam`

- Production traffic: 100%
- Build: PASS
- Main Vitest: 130 files / 1,470 tests PASS
- Booking Vitest: 42 files / 423 tests PASS
- OCR Vitest: 18 files / 231 tests PASS
- Browser acceptance: 10 / 10 PASS
- Final focused review: no Critical or Important blockers
- Repeated Production-cache smoke passes: 3
- Core report smoke result: cache source, refreshing false, stale false, no warning
- Post-route unexpected HTTP 5xx: 0
- Rollback revision for this remediation: `pmc-mini-app-00044-lug`
