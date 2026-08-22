# PMC Gentelella Booking Attribution Dashboard Design

## Status

- **Date:** 2026-08-22
- **Status:** Written design and approved mockup reviewed; implementation planning authorized on 2026-08-22
- **Project:** PMC Web / PMC Google Booking Operations
- **Upstream UI:** `ColorlibHQ/gentelella` master pinned at commit `d0064ca25fc916981556e2b2439e569000f61da9`
- **License:** MIT; the upstream copyright and license text must remain in the vendored application
- The current approval authorizes implementation planning only. It does not authorize implementation, credential changes, webhook subscription, Meta writes, or production deployment.

## 1. Purpose

Build a separate authenticated Booking and Attribution Dashboard under the existing PMC Render service using the real Gentelella v4 source as the application foundation.

The dashboard combines four authoritative operational sources without replacing any of them:

1. Google Form and `BOOKING_MASTER` for paid-booking intake and deposit data;
2. `CALL_QUEUE` and Calendar-derived booking operations for follow-up work;
3. JERA imports for actual case closure and actual revenue; and
4. Meta Marketing API, Lead Ads, and Messenger webhooks for advertising cost and customer-source attribution.

The product must answer both management and daily-operations questions:

- What must the team do today?
- Which customers and appointments need attention?
- Which Campaign, Ad Set, Ad, or Facebook Page generated each paid booking?
- Which attributed bookings later became JERA-closed revenue?
- What are actual cost per booking and actual ROAS using PMC data rather than Meta-reported conversion proxies?

## 2. Approved Product Decisions

- Build an actual web dashboard, not a decorated Google Sheet.
- Use Gentelella v4 source and components directly wherever practical; do not create a React imitation and label it Gentelella.
- Host at `/booking-dashboard` inside the existing Render service.
- Keep `/ads-agent`, `/page-automation`, existing Meta APIs, the LINE bridge, and the Cloud Run evidence service operationally separate.
- Keep Google Sheets as the Booking source of truth.
- Keep JERA as the only source of actual case closure and actual revenue.
- Keep Google Form as the active booking intake; do not revive the cancelled booking Web App project.
- Update the dashboard within 30 seconds during active use and run a 15-minute reconciliation fallback.
- Display full customer name and full phone to authorized dashboard users.
- Use Google OAuth with an email allowlist.
- Use two roles: `OWNER` and `STAFF`.
- Reuse the existing Render-side Meta Ads proxy and server-held Meta credentials.
- Support multiple Facebook Pages under one Ad Account.
- Support both Facebook Lead Ads and Messenger/Instagram messaging attribution.
- PMC normally closes Messenger sales inside Messenger, and a phone number is available before the Booking Form is submitted.
- Use a 30-day Meta attribution window.
- Prepare Meta Conversions API integration but keep it disabled by default.
- No Meta campaign, budget, status, creative, or Conversions API write occurs without a later explicit production approval.

## 3. Existing Runtime Boundary

### 3.1 Existing systems retained

- Render service `pmc-ads-agent` serves the current PMC Web frontend and server APIs.
- `server/metaApiPlugin.ts` already provides server-side Meta account, Campaign, Ad Set, Ad, and Insights retrieval.
- The production server currently uses Basic Auth for the existing application.
- The Booking Apps Script project owns Form intake, Booking Sheet writes, Drive evidence, Calendar, LINE notifications, call tasks, JERA import, retries, audit, and the current basic Sheet dashboard.
- The Booking evidence service remains a separate keyless Cloud Run service.

### 3.2 Boundary of this dashboard

The new route must not become a dependency of booking creation. Booking, Calendar, Drive, LINE, calls, and JERA workflows continue when the dashboard or Render is unavailable.

Dashboard invalidation and attribution enrichment are best-effort downstream actions. They must never cause a paid-booking submission to fail or roll back.

## 4. High-Level Architecture

```text
Authorized browser
    |
    | Google OAuth + secure session
    v
Render: /booking-dashboard
    |
    +--> Gentelella static application
    +--> /api/booking-dashboard/*
    +--> existing /api/meta/* read path
    +--> /api/meta-attribution/webhook
    |
    +------------------------------+
    |                              |
    v                              v
Meta Graph API              Dashboard Apps Script Bridge
Ads / Insights              signed HMAC request/response
Lead Ads / Messaging               |
                                    v
                           PMC Booking Operations Sheet
                           BOOKING / CALL / JERA / META tabs
```

### 4.1 Render responsibilities

- Serve the Gentelella dashboard build.
- Complete Google OAuth and issue secure dashboard sessions.
- Enforce role-based authorization on every dashboard API.
- Call the existing Meta API implementation from server-side code.
- Receive and verify Meta webhook requests.
- Request curated Booking/JERA snapshots from Apps Script.
- Cache safe read models briefly and merge Booking, JERA, and Meta metrics.
- Never expose Meta access tokens, app secrets, Google bridge secrets, or OAuth client secrets to client JavaScript.

### 4.2 Apps Script responsibilities

Use a separate Dashboard Bridge package and deployment rather than adding dashboard request processing to the booking trigger entrypoints.

The bridge:

- reads explicitly allowlisted Sheet tabs and columns;
- writes only the approved Meta attribution/config/audit tabs;
- returns curated JSON rather than arbitrary range access;
- verifies timestamped HMAC requests with replay protection;
- batches Sheet reads and writes;
- runs the 15-minute reconciliation trigger; and
- cannot create or edit Bookings, Calendar events, Drive evidence, or LINE messages.

The existing Booking project may send a best-effort signed cache-invalidation event after a successful canonical write. Failure to send that event is logged safely and never changes booking success.

## 5. Gentelella Source Strategy

### 5.1 Vendored application

Create:

```text
apps/pmc-booking-dashboard/
  LICENSE.gentelella.txt
  UPSTREAM.md
  package.json
  vite.config.js
  production/
  public/
  src/
  tests/
```

Vendor a clean source snapshot from upstream commit:

```text
d0064ca25fc916981556e2b2439e569000f61da9
```

Do not keep a nested `.git` directory and do not use a Git submodule. `UPSTREAM.md` records the repository URL, pinned commit, import date, local deviations, and the procedure for reviewing a future upstream update.

### 5.2 Reuse requirements

Reuse the real Gentelella implementation for:

- shell rendering;
- fixed/collapsible sidebar and mobile drawer;
- top bar and breadcrumbs;
- SCSS tokens and theme infrastructure;
- dark mode capability;
- stat tiles and widgets;
- panels, status badges, progress, skeletons, empty states, modal, toast, and notifications;
- ECharts factories;
- DataTables initialization and accessible table behavior;
- calendar surface where it fits the appointment view;
- command palette;
- responsive behavior and PWA shell.

Adapt only:

- navigation structure;
- Thai user-facing copy;
- PMC identity and required legal/footer attribution;
- API/data adapters;
- OAuth/session behavior;
- role-based visibility and actions;
- Booking/Meta/JERA pages and domain-specific components.

The Gentelella component playground remains available in development builds only. Irrelevant demo pages are excluded from the production navigation and final build manifest, but reusable component source remains available.

### 5.3 Build integration

- Build the dashboard as a separate Vite multi-page/static entry.
- Emit production assets under `dist/booking-dashboard/`.
- The existing root build invokes the dashboard build after its current client build.
- Render serves `/booking-dashboard` and its hashed assets from the same service.
- Dashboard compilation must not alter the existing React app entry, route tree, or CSS cascade.
- Gentelella styles are scoped to the dashboard application and must not load on `/ads-agent` or `/page-automation`.

## 6. Authentication and Authorization

### 6.1 Google OAuth

Use server-side Google OAuth Authorization Code flow.

Required server environment names:

```text
DASHBOARD_GOOGLE_CLIENT_ID
DASHBOARD_GOOGLE_CLIENT_SECRET
DASHBOARD_GOOGLE_REDIRECT_URI
DASHBOARD_SESSION_SECRET
```

Requirements:

- OAuth `state` validation is mandatory.
- Session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax` or stricter.
- Session lifetime is eight hours.
- The browser receives no Google API refresh token.
- Failed allowlist checks end the session and show a product-facing access-denied state.
- Redirect targets are allowlisted; arbitrary post-login redirects are rejected.

The production server dispatches authentication by route in this order:

1. public health and cryptographically verified webhook routes;
2. Google OAuth start/callback routes;
3. dashboard static/API routes protected by the dashboard session; and
4. existing PMC routes protected by their current Basic Auth boundary.

Dashboard OAuth must not remove or silently bypass Basic Auth on the existing Ads Agent and Page Automation surfaces.

### 6.2 Access directory

`CONFIG_DASHBOARD_USERS` is separate from `CONFIG_STAFF`.

```text
email
displayName
role
active
accessVersion
updatedAt
updatedBy
```

Allowed roles:

```text
OWNER
STAFF
```

The server rechecks the active user and `accessVersion` at least every five minutes so revoked access does not remain valid for the full cookie lifetime.

### 6.3 Role matrix

`OWNER` can:

- view every page and full PII;
- view money, JERA revenue, Meta spend, and actual ROAS;
- match, override, unmatch, and lock attribution;
- view attribution confidence and data-quality diagnostics;
- export approved data;
- manage dashboard users, Meta Page mappings, and dashboard configuration;
- see CAPI readiness but cannot enable CAPI from the browser in phase 1.

`STAFF` can:

- view the Command Center, today's appointments, and call queue;
- view full customer name and phone for operational use;
- view operational status and assigned Admin/AE;
- search customer/case records;
- not view owner-only revenue and attribution controls;
- not export global datasets;
- not edit configuration or user access.

Every owner mutation creates an audit record.

## 7. Data Sources and Authority

| Data | Authoritative source | Dashboard use |
| --- | --- | --- |
| Meta spend, reach, impressions, clicks, CTR, CPC, CPM | Meta Insights | acquisition cost and media performance |
| Meta Lead/Conversation | verified Meta webhook | lead volume and source identity |
| Paid booking, deposit, appointment, Admin, AE | `BOOKING_MASTER` | booking and operations |
| Call status | `CALL_QUEUE` | due/overdue follow-up |
| Actual closure and actual revenue | JERA import fields in `BOOKING_MASTER` | closed cases and actual ROAS |
| Doctor, service, channel, staff | existing Config tabs | display dimensions and filters |
| Attribution match | `META_ATTRIBUTION` | Campaign/Ad-to-case relationship |

Meta-reported conversion counts never replace PMC Booking or JERA counts. The UI labels each source and freshness timestamp.

The reporting time zone is `Asia/Bangkok`. The Meta Ad Account currency must be read and verified at runtime; financial cards do not silently assume THB when the account reports another currency.

## 8. Dashboard Bridge and Refresh

### 8.1 Read model

The bridge returns purpose-built endpoints, not general Sheet ranges:

- dashboard summary;
- appointments;
- call queue;
- attribution queue;
- funnel and breakdowns;
- monthly report;
- current-user/role/config metadata.

Each response includes:

```text
generatedAt
sourceUpdatedAt
sourceFreshness
schemaVersion
dataQualitySummary
```

### 8.2 Freshness contract

- Browser polling interval: 15 seconds while the page is active.
- Render Booking snapshot cache: up to 15 seconds.
- Successful Booking/JERA/call writes send a non-blocking cache invalidation when possible.
- Dashboard bridge reconciliation: every 15 minutes.
- Expected active-view freshness: no more than 30 seconds.
- Hidden/background browser tabs reduce polling.
- Meta Insights may use a separate 60-second cache because Meta cost metrics do not require per-second refresh.

When a source is unavailable, the UI shows its last successful timestamp and `ข้อมูลอาจไม่ล่าสุด`. It does not silently convert missing values to zero.

### 8.3 Quota guardrails

- Use one batch read per source group and one batch write per attribution mutation.
- Do not read entire 1000-row blank grids.
- Do not write cells individually.
- Reconciliation exits immediately when no source watermark changed.
- Use locks and idempotency keys for webhook and attribution writes.
- Monitor Apps Script daily runtime and short-time invocation failures.

## 9. Meta API and Webhooks

### 9.1 Existing Meta read path

Reuse the current Meta config/workspace and read-only insight logic. Do not duplicate access-token management or Graph insight normalization inside the dashboard app.

### 9.2 User-confirmed readiness

The owner reports that the Meta App, Page identity, posting, Page, Ads, and messaging permissions are already configured. Implementation still performs read-only production verification of:

- token presence and expiration state;
- Ad Account identity/status/currency/timezone;
- visible Pages;
- Page-to-App webhook subscriptions;
- Lead Ads subscription;
- Messenger/Instagram messaging subscription; and
- required scopes for the exact endpoints used.

No credential value appears in logs, tests, documentation, browser state, or chat.

### 9.3 Webhook boundary

Public routes bypass user login only for Meta verification and signed webhook delivery:

```text
GET  /api/meta-attribution/webhook
POST /api/meta-attribution/webhook
```

Requirements:

- verify the configured webhook challenge token;
- verify `X-Hub-Signature-256` before parsing an event;
- enforce bounded body size;
- deduplicate webhook event IDs;
- reject unknown object/field types;
- log only safe IDs/statuses, never raw message text or tokens;
- forward only the minimum attribution envelope to Apps Script; and
- acknowledge valid Meta deliveries promptly, with processing safe for retries.

Required server environment names include:

```text
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN
META_CAPI_ENABLED=false
```

Additional Page access data reuses the existing server-side workspace/config mechanism.

### 9.4 Stored message boundary

Do not store full Messenger or Instagram message bodies in the Booking Sheet. Store only identifiers and fields needed for attribution:

- Page;
- Page-scoped user/conversation identifier;
- referral/lead identifier when available;
- Campaign, Ad Set, and Ad identifiers;
- normalized phone when deterministically extracted or supplied;
- timestamps;
- matching state and audit metadata.

## 10. Google Sheet Additions

### 10.1 `CONFIG_DASHBOARD_USERS`

Defined in section 6.2.

### 10.2 `CONFIG_META_PAGES`

```text
channelId
pageId
pageName
active
updatedAt
updatedBy
```

`channelId` maps the existing Booking Form channel choice to the authoritative Facebook Page.

### 10.3 `META_LEAD_INDEX`

One row per unique Lead Ads lead or Messenger/Instagram attribution conversation.

```text
metaLeadKey
sourceType
pageId
leadgenId
conversationId
pageScopedUserId
campaignId
adSetId
adId
phoneNormalized
capturedAt
lastInteractionAt
matchStatus
matchedCaseId
version
```

Allowed `sourceType`:

```text
LEAD_ADS
MESSENGER
INSTAGRAM_DM
```

Allowed `matchStatus`:

```text
UNMATCHED
AUTO_MATCHED
MANUAL_MATCHED
AMBIGUOUS
LOCKED
UNMATCHED_EXPIRED
```

### 10.4 `META_ATTRIBUTION`

One active row per attributed Booking Case.

```text
attributionId
caseId
metaLeadKey
pageId
campaignId
adSetId
adId
matchMethod
confidence
windowDays
matchedAt
matchedBy
lockedAt
lockedBy
version
```

Allowed `matchMethod`:

```text
EXACT_LEAD_ID
EXACT_REFERRAL_ID
PHONE_PAGE_30D
MANUAL
```

Allowed `confidence`:

```text
HIGH
MEDIUM
MANUAL
```

### 10.5 `META_ATTRIBUTION_AUDIT`

```text
eventId
attributionId
caseId
actorEmail
action
before
after
reason
timestamp
correlationId
```

Audit payloads contain IDs/statuses only and avoid duplicated full customer PII.

## 11. Attribution Algorithm

### 11.1 Exact matching

Match immediately with `HIGH` confidence when:

- the Booking carries an exact Lead Ads `leadgenId`; or
- an exact Messenger/Instagram referral or deterministic tracking identifier connects the booking to one unconsumed `metaLeadKey`.

### 11.2 Phone and Page matching

For the normal Messenger closing flow:

1. normalize the Booking phone and candidate lead phone to the same Thai-phone representation;
2. require the mapped Facebook Page to match the Booking channel;
3. require the lead/conversation to be unconsumed;
4. require `capturedAt` or `lastInteractionAt` to be no more than 30 calendar days before Booking submission;
5. select only when exactly one candidate remains; and
6. create `PHONE_PAGE_30D` attribution with `HIGH` confidence.

If multiple candidates remain, create no attribution and mark every candidate/case relationship for the owner queue as `AMBIGUOUS`.

### 11.3 Prohibited matching

- Never auto-match on name alone.
- Never auto-match across Pages.
- Never reuse a consumed conversation for another Booking.
- Never choose the nearest candidate when multiple valid candidates remain.
- Never alter historical attribution silently after an owner lock.
- Never attribute a Booking outside the 30-day window automatically.

### 11.4 Owner queue

The owner queue shows:

- Booking identity and timestamp;
- candidate Page and conversation timestamps;
- Campaign/Ad context;
- why auto-match stopped;
- confidence and source freshness; and
- match, unmatch, lock, and reason-required override controls.

Every mutation is version-checked, idempotent, and audited.

## 12. KPI and Metric Model

### 12.1 Primary KPIs

#### Actual ROAS

```text
sum(JERA actual revenue for attributed CLOSED_JERA cases)
-------------------------------------------------------
Meta spend for the selected attributed scope and period
```

Display `—` when spend is zero/unavailable or source windows do not align.

#### Cost per Booking

```text
Meta spend
----------------------------
distinct attributed Bookings
```

#### Attribution Coverage

```text
Meta-channel Bookings with one active attribution
-------------------------------------------------
all Meta-channel Bookings in the selected period
```

### 12.2 Driver metrics

- Distinct Meta leads/conversations;
- Meta-reported leads;
- paid Bookings;
- deposits;
- JERA closed cases;
- actual JERA revenue;
- cost per Meta lead;
- Lead-to-Booking rate;
- Booking-to-JERA-close rate;
- time from lead capture to paid booking;
- auto-match, manual-match, ambiguous, and unmatched counts.

### 12.3 Operational metrics

- today's appointments;
- calls due and calls overdue;
- Calendar conflicts;
- Drive/Calendar/LINE retry states;
- JERA reconciliation queue;
- deposit expiry status; and
- stale-source or webhook-health warnings.

### 12.4 Breakdowns

- Facebook Page;
- Campaign;
- Ad Set;
- Ad;
- service/program;
- doctor;
- Booking Admin;
- AE;
- Booking channel; and
- day/week/month.

### 12.5 Metric guardrails

- Show Meta-reported conversions separately from PMC Booking and JERA metrics.
- Use distinct keys at each grain to prevent join multiplication.
- Align reporting period and timezone before calculating ratios.
- Show matched coverage beside ROAS/Cost per Booking.
- Label low-coverage slices as incomplete.
- Do not rank Campaigns by actual revenue when attribution coverage is not visible.
- Do not set performance targets until enough reviewed historical data exists.

## 13. Gentelella Pages

### 13.1 Dashboard — Hybrid Command Center

Default page for both roles.

- global date, Page, doctor, Admin, AE, program, and status filters;
- role-aware stat tiles;
- urgent work queue;
- 14-day Booking and revenue trend;
- Ads → Lead/Conversation → Booking → JERA funnel;
- upcoming appointments;
- source freshness strip; and
- clear zero, unavailable, stale, and error states.

### 13.2 Today's Appointments

- Gentelella calendar/timeline plus DataTable view;
- full customer name and phone;
- appointment, doctor, program, Admin, AE, and status;
- search and role-safe details;
- no booking mutation in phase 1.

### 13.3 Call Follow-up

- due today, active, overdue, and result filters;
- owner and customer identity;
- next-call time and history summary;
- read-only in phase 1 unless a later design explicitly authorizes call-result writes.

### 13.4 Attribution Queue

Owner-only mutations; Staff may not access this route.

- auto-match exceptions;
- candidate comparison;
- confidence/method badges;
- match/unmatch/lock actions;
- reason requirement; and
- audit history.

### 13.5 Ads → Booking → JERA

- Meta acquisition cards;
- actual Booking and JERA cards;
- funnel and trend charts;
- Campaign/Ad Set/Ad/Page DataTables;
- actual ROAS, cost per booking, coverage, and close rate; and
- source-specific definitions/tooltips.

### 13.6 Monthly Reports

- month selector;
- owner-safe export;
- Booking, deposit, closure, revenue, attribution, and operational summary;
- Admin/AE/doctor/program/channel breakdowns; and
- no commission amount until a separate approved commission policy exists.

### 13.7 Settings

Owner only.

- dashboard user allowlist and role;
- Page/channel mapping;
- read-only integration health;
- feature-flag status;
- cache/reconcile health; and
- audit access.

## 14. Render API Surface

### 14.1 Authentication

```text
GET  /api/booking-dashboard/auth/google
GET  /api/booking-dashboard/auth/callback
POST /api/booking-dashboard/logout
GET  /api/booking-dashboard/session
```

### 14.2 Read endpoints

```text
GET /api/booking-dashboard/summary
GET /api/booking-dashboard/appointments
GET /api/booking-dashboard/calls
GET /api/booking-dashboard/attribution-queue
GET /api/booking-dashboard/funnel
GET /api/booking-dashboard/monthly-report
GET /api/booking-dashboard/integration-health
```

Every endpoint validates the session and role server-side. Query filters are allowlisted and bounded.

### 14.3 Owner attribution mutations

```text
POST /api/booking-dashboard/attribution/match
POST /api/booking-dashboard/attribution/unmatch
POST /api/booking-dashboard/attribution/lock
```

Every mutation requires:

- `OWNER` role;
- CSRF protection;
- expected record version;
- reason;
- idempotency key; and
- Apps Script HMAC bridge verification.

### 14.4 Meta webhook

Defined in section 9.3 and intentionally isolated from user-authenticated endpoints.

## 15. Conversions API Boundary

Prepare the CAPI module and tests, but production behavior is disabled:

```text
META_CAPI_ENABLED=false
```

When false:

- no CAPI network request occurs;
- no background task enqueues a Meta write;
- the dashboard reports `เตรียมพร้อม — ยังไม่เปิดใช้งาน`; and
- there is no browser control that can enable it.

Future activation requires a separate explicit design/production approval after a reviewed shadow-attribution period. The future design must define consent, dataset/pixel, event names, hashing, deduplication, event time, action source, test-event verification, retry policy, and audit evidence.

## 16. Security and Privacy

- Full customer identity is visible only after Google login and allowlist validation.
- Meta tokens, app secret, webhook verification token, Google OAuth secret, session secret, and bridge secret are server/script properties only.
- Secrets are never stored in Sheet cells.
- Raw Messenger/Instagram message bodies are not stored.
- Avoid full phone/name in logs, webhook errors, analytics events, and audit JSON.
- Use output allowlists for every Apps Script response.
- Use CSRF protection on all authenticated mutations.
- Apply rate limits to login, read APIs, attribution mutations, and webhook verification failures.
- Set a restrictive Content Security Policy compatible with the pinned Gentelella assets.
- Disable framing unless an explicit embedding need is approved.
- Use `Cache-Control: no-store` for PII API responses.
- Do not use service-worker caches for customer/API payloads.
- Exports are owner-only and must not be stored in public static directories.
- Dashboard access and attribution mutations are audited.

## 17. Reliability and Error Handling

- Booking workflows never wait for dashboard refresh or Meta attribution.
- Webhook processing is idempotent and retry-safe.
- Render cache entries include source timestamp and schema version.
- Apps Script bridge mismatches fail closed.
- The UI distinguishes `0`, unavailable, stale, partial, and error.
- Partial-source cards identify which source is missing.
- A stale Meta source does not erase previously verified Booking/JERA values.
- An Apps Script bridge outage does not expose cached PII beyond the active authenticated session.
- Owner attribution conflicts remain queued rather than guessed.
- Reconciliation can repair missed webhook-to-Sheet writes using stable Meta IDs.

## 18. Testing Strategy

Implementation follows TDD.

### 18.1 Unit tests

- Thai phone normalization and 30-day boundary;
- Page/channel mapping;
- exact-ID and phone/Page matching;
- duplicate/ambiguous handling;
- one-conversation/one-booking consumption;
- metric formulas and zero/unavailable behavior;
- role permissions;
- session expiry and allowlist revocation;
- webhook signature and deduplication;
- CAPI disabled means zero Meta writes.

### 18.2 Contract tests

- Apps Script bridge request/response schema;
- HMAC timestamp/nonce/replay checks;
- Meta payload sanitization;
- dashboard read-model schema/version;
- Render API error envelopes;
- role-specific response field allowlists.

### 18.3 Integration tests

- synthetic Lead Ads webhook → lead index;
- synthetic Messenger referral + phone → auto attribution;
- ambiguous phone/Page candidate → queue;
- Booking/JERA snapshot + Meta spend → actual ROAS;
- cache invalidation and 15-minute reconciliation;
- OAuth allow/deny/role behavior;
- webhook or dashboard failure does not affect booking creation.

### 18.4 Browser and visual QA

- exact Gentelella shell behavior at desktop, tablet, and mobile;
- sidebar rail, drawer, navigation, DataTables, charts, modals, toasts, empty states, and dark mode;
- Thai typography and full-phone table layouts;
- no horizontal page overflow;
- accessible keyboard/focus behavior;
- no console errors;
- owner/staff route visibility; and
- stale/error/source-freshness states.

### 18.5 Security QA

- no secret in browser bundles, HTML, logs, source maps, or API responses;
- PII endpoints require valid session;
- CSRF and OAuth state tests;
- owner mutations denied to Staff;
- webhook requests rejected before parsing when signature is invalid;
- static/PWA caches exclude PII payloads; and
- CAPI disabled network assertion.

## 19. Rollout

### Stage 0 — Preconditions

- Verify current Render deployment and Meta read-only status.
- Verify user-confirmed Meta permissions and every Page subscription.
- Verify Ad Account currency/timezone.
- Rotate any operational credential previously exposed in chat or tool logs before the live dashboard pilot.
- Create Google OAuth client without exposing its secret.
- Prepare dashboard user and Page mappings.
- Back up the Booking Spreadsheet.

### Stage 1 — Gentelella baseline

- Vendor the pinned upstream snapshot.
- Preserve license/upstream metadata.
- Build and visually verify the unmodified upstream shell first.
- Add the new route without touching existing application routes.

### Stage 2 — Authenticated synthetic dashboard

- Add OAuth, role checks, and synthetic read models.
- Verify no production Booking/Meta data is accessed.
- Complete responsive and accessibility QA.

### Stage 3 — Booking/JERA read-only pilot

- Add the Apps Script bridge and new Sheet tabs.
- Use synthetic attribution records first.
- Enable live Booking/JERA reads for owner allowlist only.
- Confirm freshness and source reconciliation.

### Stage 4 — Meta read-only and webhook shadow mode

- Enable live Meta Insights.
- Subscribe Lead Ads and messaging webhooks after verification.
- Store minimal attribution envelopes.
- Run matching in shadow mode without exposing it as authoritative.
- Review coverage, ambiguity, duplicate, and freshness quality.

### Stage 5 — Owner attribution queue

- Enable owner review/mutation controls.
- Keep Staff read-only.
- Audit every correction.

### Stage 6 — Staff operations rollout

- Add approved Staff allowlist.
- Enable daily operations pages.
- Monitor execution, API, webhook, auth, and data-quality health.

CAPI remains disabled throughout these stages.

## 20. Rollback

- The new dashboard route can be disabled without changing Google Form, Booking Apps Script triggers, Sheet data, Calendar, Drive, LINE, JERA import, or Meta Ads read APIs.
- Meta webhook subscriptions can be removed independently.
- New Meta Sheet tabs are preserved for evidence; rollback does not delete rows.
- OAuth secrets and webhook secrets can be rotated independently.
- The existing Ads Agent/Page Automation routes and Basic Auth remain available.
- The vendored dashboard build can be removed from the deployment manifest while preserving source and audit records.
- CAPI is already disabled and requires no rollback action.

## 21. Acceptance Criteria

The design is implemented only when all of the following are verified:

1. `/booking-dashboard` uses the pinned Gentelella source and does not visually or technically wrap the existing React dashboard as a substitute.
2. Existing PMC routes and APIs pass their pre-existing regression tests.
3. Google OAuth denies non-allowlisted accounts and enforces Owner/Staff roles server-side.
4. No Meta or Google secret appears in the client bundle or responses.
5. Full customer name/phone are returned only to authenticated allowed users.
6. Booking and JERA data reconcile with the source Sheet for reviewed synthetic fixtures.
7. Meta spend/lead metrics remain labeled separately from Booking/JERA actuals.
8. Lead Ads and Messenger webhook signatures, deduplication, and minimal storage pass tests.
9. Exact and 30-day phone/Page matching behave as specified; ambiguous cases never auto-match.
10. Owner attribution mutations are versioned, reason-required, idempotent, and audited.
11. Actual ROAS, cost per booking, coverage, and close-rate calculations pass independent fixture checks.
12. Active-view Booking freshness is no more than 30 seconds under the pilot workload.
13. Dashboard failure does not fail or delay canonical booking creation.
14. Desktop and mobile browser QA passes with no major clipping, overflow, console, or accessibility defect.
15. CAPI produces zero Meta write requests while `META_CAPI_ENABLED=false`.
16. Production rollout and rollback evidence are recorded without credentials or customer PII.

## 22. Explicitly Deferred

- Enabling Meta Conversions API;
- changing Meta Campaign/Ad Set/Ad status or budget;
- replacing Google Form booking intake;
- direct JERA API integration;
- commission formulas or payout approval;
- customer self-service;
- storing full message transcripts;
- moving the operational source of truth to a separate database; and
- removing the existing Ads Agent or Page Automation UI.
