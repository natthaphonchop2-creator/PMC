# PMC Ads Agent Project Updates

This is the canonical update log for PMC Ads Agent development.

## Standing Rule

Every development change must update this file before staging or committing. This includes UI work, API changes, tests, assets, documentation, release preparation, and bug fixes.

Release-specific documents, previews, PDFs, screenshots, and visual QA assets must be grouped under `docs/releases/<date>-v<version>/` with a short README index.

## Current Version

- Version: `0.1.0`
- Date: 2026-05-30
- Branch: `main`
- Release folder: `docs/releases/2026-05-29-v0.1.0/`

## 2026-08-22 - Gentelella Booking Attribution Dashboard design

- Approved a new authenticated `/booking-dashboard` route built from the real Gentelella v4 source pinned to upstream commit `d0064ca25fc916981556e2b2439e569000f61da9` rather than a visual imitation.
- Kept the Google Booking Sheet and JERA as operational authorities while reusing the existing Render Meta proxy for multiple Facebook Pages under one Ad Account.
- Defined Lead Ads and Messenger attribution using exact IDs or unique normalized phone + Page matches inside a 30-day window; ambiguous cases enter an audited Owner queue and names alone never auto-match.
- Selected Google OAuth email allowlisting with Owner/Staff roles, full customer identity for authorized users, 30-second active-view freshness, and a separate Apps Script bridge so dashboard failure cannot block booking operations.
- Defined Actual ROAS, Cost per Booking, Attribution Coverage, source-specific funnel metrics, CAPI prepared-but-disabled behavior, phased rollout, security gates, and rollback boundaries.
- Added the written design specification at `docs/superpowers/specs/2026-08-22-pmc-gentelella-booking-attribution-dashboard-design.md`; implementation and production deployment remain unapproved until spec review and a separate plan approval.

## 2026-08-20 - Google Booking Operations implementation

- Added a separate TypeScript Google Apps Script package under `apps/pmc-google-booking-ops/`.
- Implemented Quick Form validation, Admin/email matching, canonical Sheet repositories, audit/version control, private Drive evidence, doctor Calendar conflicts, and doctor-specific LINE routing.
- Added the PMC Web raw-body LINE webhook bridge so LINE signatures are verified before sanitized source IDs reach Apps Script through an internal HMAC.
- Implemented appointment-day call reminders, Admin group/direct routing, Day-7 overdue handling, six-calendar-month expiry, JERA CP874 import/reconciliation, dashboard metrics, integrity checks, backup deduplication, and approval-gated evidence retention.
- Added synthetic end-to-end tests, setup instructions, and a production pilot runbook. Real Google/LINE assets and real customer use remain setup-gated until the pilot receives manager sign-off.
- Reconciled the new Form with the current Microsoft Form: added an optional page/channel Dropdown, seeded seven Admin names plus existing service/channel choices, and changed attribution to the selected Admin because all staff share one Google account.
- Provisioned the company Google Sheet, Forms, private Drive folders, doctor Calendars, Apps Script triggers, Render-to-Apps-Script HMAC ingress, and three LINE group mappings for the synthetic pilot. The pilot uses Admin-group-only reminders until individual Admin LINE IDs are intentionally mapped.
- Fixed the first live synthetic Form execution by removing the unsupported `structuredClone` dependency from the Apps Script bundle; the stalled synthetic row was audit-recorded and removed before any Drive, Calendar, LINE, or call-task side effect occurred.
- Added validated Misty Rose (`#FEE5E0`) Flex booking confirmations for both the Admin group and selected doctor group, with audience-specific full operational fields and no evidence files or Drive links.
- Approved and specified a serious white Admin Flex evidence layout backed by permanent HMAC-signed Cloud Run media URLs and a read-only Google Drive Service Identity; evidence remains private in Drive and is excluded from doctor groups.
- Added the TDD implementation plan for the evidence proxy, cross-runtime signer, white Admin evidence Flex, retry wiring, read-only Service Account verification, deployment, revocation checks, and synthetic pilot gate.
- Revised evidence delivery to a dedicated Cloud Run Service Identity after organization policy blocked Service Account key creation; the keyless ADC path keeps Render unchanged and preserves the private Drive boundary.
- Deployed and verified the dedicated keyless Cloud Run evidence service with Secret Manager, minimum instances `0`, maximum instances `2`, Viewer-only access to the PMC Bookings folder, and no Service Account JSON credential; health, missing-token, altered-token, permanent-byte, and permission revocation/recovery checks passed.
- Deployed Apps Script version `5`, removed the temporary evidence setup file, validated both audience payloads through the official LINE endpoint, and sent one audited synthetic pilot message to the Admin group and selected doctor group. Admin received one slip and one chat preview; doctor received booking details with no evidence component.
- Verified `64/64` Booking tests and `275/275` full-project tests plus typecheck, lint, build, and diff checks.
- Kept real-customer rollout at **NO-GO** because both Google Form File Upload questions still accept `ANY` file type. Google Forms API cannot update these items and the available browser accounts do not own the form; the form owner must set both questions to **Image only** before go-live.

## 2026-08-21 - Staff identity, AE attribution, and Minimal Flex design

- Approved verified personal-email attribution for the Admin who closes a booking, with no manual closer field in the Form and no staff email displayed in LINE.
- Approved a required `AE ผู้เปิดแชท` dropdown that replaces the current Admin dropdown; closer and AE may be the same person.
- Selected one canonical `CONFIG_STAFF` directory with closer/AE role flags so future AE-only and Admin-only staff do not require separate duplicate tables.
- Approved separate `adminId/adminName` and `aeId/aeName` booking attribution while keeping call ownership with the Admin closer and leaving commission rules undefined.
- Approved the clean Minimal Receipt Flex direction for both Admin and doctor groups: centered generated PMC monogram, generous white space, thin separators, no Case ID/evidence count/status badge, and small fixed evidence thumbnails only in the Admin group.
- Added the design specification at `docs/superpowers/specs/2026-08-21-pmc-booking-staff-ae-minimal-flex-design.md`; implementation remains gated on written-spec approval and the seven personal-email mappings.
- Added a ten-task TDD implementation plan covering Staff contracts, schema migration, Form/runtime cutover, verified closer/AE attribution, Dashboard/call propagation, Minimal Receipt Flex, the public Cloud Run logo route, safe migration entrypoints, local validation, and the synthetic live pilot.
- Implemented the first nine plan tasks on the isolated feature branch: canonical Staff roles, AE-safe schema migration, verified closer/AE attribution, Dashboard/call propagation, Minimal Receipt Flex, an optimized `256x256` transparent PMC monogram, a public immutable Cloud Run logo route, and safe Form cutover controls.
- Verified Booking tests `83/83`, full tests `295/295`, typecheck, lint, Apps Script/client/server builds, and diff checks. Official LINE validation returned `200`; Admin had logo/evidence, doctor had no evidence, and neither visible Case ID nor staff email was present.
- Live Cloud Run/Apps Script/Form cutover remains gated on preparing `CONFIG_STAFF` and entering the seven personal closer emails directly in Sheet.
- Deployed the keyless Cloud Run logo revision and prepared the live Sheet safely: logo/health checks passed, evidence token boundaries remained intact, `CONFIG_STAFF` contains seven blank-email staff rows, AE columns are present, and historical sample data remained aligned.
- The owner deferred personal-email entry and the Form/Apps Script cutover. Production booking triggers and Form labeling therefore remain on the previous live behavior until the deferred checkpoint resumes.
- Approved and implemented the Calendar event contract with full customer name, full phone, and Google Calendar color ID `5` (`Banana`). A future synthetic event was created/read back as active for 60 minutes in `Asia/Bangkok`, contained the full synthetic identity, and had exactly one matching active event with no duplicate.
- The Calendar code change is committed for the next deferred Apps Script cutover; production version 5 continues using the previous Calendar title until that deployment.
- Diagnosed a live Form trigger failure as an eight-digit phone rejected before Case ID allocation. Restored the 51-column v5 `BOOKING_MASTER` schema by removing only the two empty pre-cutover AE columns; historical data remained aligned.
- Added live Google Form validation requiring exactly ten digits starting with `0`, verified invalid/valid synthetic values in the responder UI without submission, and removed the temporary setup helper while preserving the production Apps Script v5 Code unchanged.
- Added circular closer/AE profile avatars to both Admin and doctor booking Flex messages, backed by six metadata-stripped `256x256` Cloud Run assets and blank fallbacks for `ฝ้าย` and the system `Admin` row.
- Added guarded `CONFIG_STAFF.profileImageUrl` migration/configuration with exact roster validation, timestamped Spreadsheet backup, HTTPS/private-Drive rejection, and readback verification.
- Added a validation-only Apps Script operator function that sends synthetic Flex objects only to LINE `/validate/push`; it never pushes to a LINE user or group and returns no credentials or destination identifiers.
- Deployed Cloud Run profile revision `pmc-booking-evidence-proxy-avatar-1f89bc3` and Apps Script version `8` through the existing production deployment. Final LINE validation returned `200`; the Form remained accepting with its existing questions and all five installable triggers remained present.
- Preserved rollback to Apps Script version `5` and Cloud Run revision `pmc-booking-evidence-proxy-00005-w8x`.
- Normalized the safe LINE validator property-path regex to satisfy the repository lint gate without changing validation behavior.
- Added an approval-only production Flex pilot sender that routes one validated synthetic message to the Admin group and one to the active `หมอ Benz` group with fixed LINE retry keys and no booking-data side effects.
- After explicit owner approval, deployed Apps Script version `9` and completed the live group smoke test: one synthetic Flex reached the Admin group and one reached the `หมอ Benz` group, with successful execution and no booking/Drive/Calendar/call-task mutation.
- Refined the team section after live review: shortened row labels to `Admin` and `AE`, fixed the avatar/name columns to a shared left edge across both rows, and advanced the approved pilot retry key to V2 for one new visual smoke-test delivery.
- Deployed Apps Script version `10`, passed the official LINE validator, and completed the approved V2 live smoke test to the Admin and `หมอ Benz` groups without creating operational booking records.
- Added a backward-compatible compact Form identity rollout: parser aliases for old/new titles, `Admin` and `AE` canonical labels, a required `ไม่ระบุ` AE choice stored without a fabricated Staff ID, and an idempotent operator entrypoint that changes only the two existing Dropdown questions.
- Deployed Apps Script version `11` and completed the live compact Form cutover. Readback confirmed `Admin`/`AE`, the first AE choice `ไม่ระบุ`, continued response acceptance, removal of both legacy titles, and no test submission or operational side effect.
- Replaced email-verified closer attribution with the owner-approved open-email policy: any signed-in account may submit, the active `Admin` Dropdown choice controls adminId/call/reporting attribution, submitter email is audit-only, and new bookings record `adminIdentityStatus=SELECTED_ADMIN`.
- Deployed Apps Script version `12` for the any-email policy after confirming the prior personal-email test failed before side effects; Form readback remained accepting with `Admin`, `AE`, and `ไม่ระบุ`, and the failed response was intentionally not replayed.
- Fixed Calendar retry continuity after the personal-email smoke test exposed a deleted deterministic event-ID collision: event keys now include the immutable Form response ID, Calendar retries retain evidence IDs, and a recovered retry continues through call-task creation and both LINE deliveries via an explicit retry-only operator.
- Deployed Apps Script version `13` and completed the approved retry recovery. The synthetic any-email case reached `BOOKING_CONFIRMED` with Drive/Calendar/LINE `OK`, Calendar event present, doctor notified, one call task, and no pending retry; the pre-v13 retry used the no-image Admin fallback because its payload did not yet contain evidence IDs.

## 2026-05-30 - Ads Dashboard and Insights polish deploy

- Updated Ads Dashboard copy to user-facing Thai labels and section names.
- Added Ads Dashboard data status strip for selected date window, daily data count, and campaign ranking scope.
- Added dedicated Ads Dashboard skeleton loading layout for KPI cards, daily trend chart, campaign ranking, and lower metric cards.
- Refined Insights copy away from internal agent labels toward decision-support language.
- Fixed Decision River evidence summaries so the selected driver controls the visible values.
- Added campaign evidence metrics from ad activity: Spend, Results, Clicks, Impressions, CTR, CVR, CPM, Frequency, ROAS, and CPA.
- Updated cached AI evidence handling so older cached cards can receive freshly derived metric values.
- Updated Decision River scoring so CVR, CPM, and Frequency select evidence cards that contain matching driver metrics.
- Added compact evidence metric grid styles for desktop and mobile.
- Verified CVR evidence sheet in headless Chrome: CVR evidence showed CVR, Results, and Clicks, did not show generic ROAS/CPA as the main summary, and had no horizontal overflow.
- Updated regression tests for Ads Dashboard skeleton loading, user-facing copy, Decision River evidence rendering, and derived campaign evidence values.
- Added daily Obsidian project update notes under `Projects/PMC Ads Agent/PROJECT_UPDATES/`.

## 2026-05-29 - v0.1.0

- Added a Page Automation cancel-schedule API flow that records an operator audit intent and appends a cancelled schedule record.
- Added the Auto Post cancel-schedule button and UI feedback for scheduled drafts.
- Refined Home launcher and Page Automation visuals around the softer PMC palette, removed product-logo dependency from the launcher/header, and added the Page Automation background asset.
- Updated regression tests for Home visual rules, Page Automation cancel-schedule UI behavior, and backend cancel-schedule handling.
- Organized user manuals, visual previews, PDFs, and QA screenshots into `docs/releases/2026-05-29-v0.1.0/`.
- Added this project update log and made update-log maintenance a mandatory development rule in `Agent.md`.
- Added the Ad Groups workspace design spec with the approved Split Inspector layout, approval-gated Meta write flow, and phase-1 testing scope.
- Added the Insights AI Analysis workspace design spec with the approved AI Brief First layout, researched measurement formulas, confidence scoring, cached AI refresh flow, and approval-gated recommendation rules.
- Clarified the Insights design scope: the implementation must rebuild and replace the old Insights page rather than patching or preserving the previous UI as a parallel mode.
- Added the Automation Ads workspace design spec with the approved Run Monitor + Tabs layout, configurable safe rule builder, scheduled approval queue, hybrid rule/AI decision engine, and approval-gated Meta writes.
- Added the Ad Groups workspace implementation plan with TDD tasks for routing, data helpers, Split Inspector UI, approval-gated actions, and local QA.
- Implemented the Ad Groups workspace as a dedicated Split Inspector page with Ad Set filters, read-only Ads details, and approval-gated Meta actions.
- Added the Insights AI Analysis workspace implementation plan for replacing the old Insights page with an AI Brief First workspace, structured AI refresh payloads, formula-backed metrics, charts, evidence, confidence, and approval-gated recommendations.
- Implemented the rebuilt Insights AI Analysis workspace with cached AI brief, structured AI refresh payloads, formula metrics, charts, evidence, confidence, and approval-gated recommendations.
- Added the Automation Ads workspace implementation plan for replacing the paused placeholder with a Run Monitor, scheduled approval queue, configurable safe rules, conflict handling, and run history.
- Implemented the Automation Ads workspace with a deterministic rule engine, manual run monitor, approval queue, configurable rule builder, run history, conflict/duplicate guards, and responsive browser QA.
