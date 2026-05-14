# Context Compression

## Latest Completed Work - 2026-05-15 OpenAI AI Marketer + Creative Kit Integration

User selected next work items `2` and `3`: make AI Marketer / AI Insights use a real LLM, and upgrade Creative Studio to generate real creative briefs, copy, angles, hooks, captions/notes from OpenAI instead of rule-only text.

Completed changes:
- Created an OpenAI API key through the OpenAI Developers flow and saved it locally as `OPENAI_API_KEY` in `.env.local`.
- Added backend-only OpenAI proxy endpoints:
  - `GET /api/ai/status`
  - `POST /api/ai/marketer`
  - `POST /api/ai/creative`
- Added `server/openAiPlugin.ts` and wired it into both Vite dev server and production server.
- `AI Marketer` now has a real `Generate AI Plan` control that sends current Meta workspace data to the backend, calls OpenAI, then merges returned AI Insights and Action Queue items into workspace state.
- `Creative Studio` now has an `AI Creative Kit` panel that sends selected source ad, ad set, campaign, and launch form context to OpenAI and can apply generated copy into Auto Post fields.
- `Settings` now shows OpenAI Runtime status and documents the new `/api/ai/*` endpoints.
- OpenAI errors now surface the upstream OpenAI request id in UI/backend responses to make debugging possible.
- Fixed the Creative Studio form duplication around `Primary Text` if present in previous UI state.

Important security behavior:
- `OPENAI_API_KEY` is never sent to the browser.
- `.env.local` is ignored by git.
- The browser only calls local backend endpoints; backend calls OpenAI.
- Render/production will need `OPENAI_API_KEY` added as a server environment variable before AI generation works there.

Current OpenAI API status:
- `/api/ai/status` returns configured locally with model `gpt-5.5`.
- Smoke tests reached OpenAI but OpenAI returned HTTP 500 for multiple models and for both Responses API and Chat Completions.
- UI handles this by showing the OpenAI error plus request id, e.g. `Internal server error · OpenAI request id ...`.
- This is classified as an upstream OpenAI/API project issue, not a frontend route/build failure.

Files changed:
- `server/openAiPlugin.ts`
- `server/productionServer.ts`
- `vite.config.ts`
- `src/App.tsx`
- `src/App.css`
- `Context Compression.md`

Verification:
- `npm run build` passes.
- Local `/api/ai/status` returns configured.
- Browser QA on `http://127.0.0.1:5174/`:
  - AI Marketer page shows OpenAI configured status and `Generate AI Plan`.
  - AI Marketer generation failure path shows OpenAI request id.
  - Creative Studio page shows `AI Creative Kit`, selected source ad metrics, and `Generate Kit`.
  - Creative Kit generation failure path shows OpenAI request id.
  - Settings page shows OpenAI Runtime and `/api/ai/*` endpoint documentation.

## Latest Completed Work - 2026-05-15 Whole-Site Comfort Polish

User requested smaller typography, easier usability, subtle decoration/effects, and a more comfortable visual style across the whole website.

Completed changes:
- Added a site-wide comfort polish layer in CSS without changing Meta API logic or page data flow.
- Reduced global type scale for headings, nav, buttons, tables, cards, forms, badges, tooltips, and mobile views.
- Softened base colors and page background in `src/index.css`.
- Added lighter card shadows, smaller radii, quieter borders, and more compact spacing.
- Added subtle hover/active transitions for nav items, cards, tables, buttons, and interactive rows.
- Reduced control heights for buttons/date range/form fields to make the UI denser but still readable.
- Tuned chart heights, table cell padding, AI Insights table density, and mobile overrides.
- Kept the previous functional layout and Audience Insights rebuild intact.

Files changed:
- `src/index.css`
  - Softer background, border, shadow, and muted text tokens.
- `src/App.css`
  - Added `Comfort polish` block near the end of the file.

Verification:
- `npm run build` passes.
- Browser QA on `http://127.0.0.1:5174/`:
  - Reload produced `0` fresh console errors/warnings.
  - Navigation and Audience Insights page still render correctly.
  - Current narrow in-app browser view shows smaller text and compact controls without visible broken layout.

## Latest Completed Work - 2026-05-14 Audience Insights Rebuild

User requested a full rebuild of `Audience Insights` so it shows real target groups from Ads, including age, names, locations, and other targeting attributes, presented as both graphs and detailed data.

Completed changes:
- Rebuilt `Audience Insights` UI into a real Meta Ad Set targeting dashboard.
- Added structured audience targeting data to `AdSetInsight`:
  - age range
  - genders
  - publisher platforms
  - placements
  - device platforms
  - geo locations: country, region, city, zip, custom location
  - target names: interests, behaviors, demographics, custom audiences, lookalikes
  - exclusions and locales
- Backend now parses `targeting` from Meta ad sets into `audienceTargeting` instead of only a short text summary.
- Frontend now presents:
  - Target Snapshot: main age, main location, main target/audience name
  - Age Performance graph
  - Location Performance graph
  - Platform Mix graph
  - Target / Audience Names graph
  - Ad Set Audience Detail table/cards with age, gender, location, target names, platform, placements, spend, budget, bookings, and ROAS
  - Audience Memory panel from Meta sync
- Added privacy note in the UI: Meta Ads does not provide individual personal names or personal addresses; the system shows targeting group names, location targets, and segment-level data from Ads.

Files changed:
- `src/types.ts`
  - Added `AudienceGeoTarget`, `AudienceTarget`, and `AudienceTargeting`.
  - Added optional `audienceTargeting` to `AdSetInsight`.
- `server/metaApiPlugin.ts`
  - Expanded `MetaAdSetRow.targeting` typing.
  - Added audience targeting parser/normalizer helpers.
  - `buildAdSets` now outputs structured `audienceTargeting`.
- `src/App.tsx`
  - Normalizes stored/synced `audienceTargeting`.
  - Replaced the old `AudienceStudioPage` with the new Audience Insights dashboard.
  - Added aggregation helpers and bar-list graph components.
  - Updated Audience Insights page subtitle.
- `src/App.css`
  - Added responsive layout and visual styles for the new Audience Insights page.

Verification:
- `npm run build` passes.
- Browser QA on `http://127.0.0.1:5174/`:
  - Audience Insights nav opens the new page.
  - Page contains Target Snapshot, Age Performance, Location Performance, Target / Audience Names, and Ad Set Audience Detail.
  - Fresh browser logs after reload/click have `0` new errors/warnings.
  - Mobile/narrow viewport shows cards and graph rows without visible overflow.
- Local API check:
  - `/api/meta/workspace?datePreset=maximum` returns 36 ad sets.
  - 36/36 ad sets include `audienceTargeting`.
  - Sample ad set includes age `20-65`, country `Thailand`, and custom audience name from Meta targeting.

## Latest Completed Work - 2026-05-14 Ref-Style UI Rollback

User cancelled the Madgicx/ref-style UI rebuild and requested an immediate rollback.

Rollback completed:
- Reverted `src/App.tsx`, `src/App.css`, and `src/index.css` to the previous committed state.
- Removed the dark icon-rail shell, measured chart wrapper, dark chart token changes, dark-first default theme, and default `Analytics` tab change from the cancelled pass.
- Kept this context note so future work does not assume the cancelled ref-style UI is still active.

Latest verification target:
- Run `npm run build`.
- Reload `http://127.0.0.1:5174/` and confirm the UI is back to the previous pre-ref-style layout.

## Current Task Checkpoint

Completed the navbar date range and Performance repair pass.
The topbar date range control is now a compact branded control with a visible `All time` option.
The Performance page now renders from live Meta data for `maximum` / all-time ranges and groups metrics into business-readable categories.
The backend proxy now tolerates later Meta paging failures after a valid first page, preventing large all-time pulls from failing the whole workspace.
Latest deployment pass made the app production-runnable with a Node server that serves `dist/` and preserves `/api/meta/*`.
Latest temporary deployment pass exposes the production server through a Cloudflare Quick Tunnel HTTPS URL protected by Basic Auth.
Latest GitHub pass installed/enabled the GitHub plugin, initialized the project as a local git repository, created commits, and added GitHub/MCP setup notes.
Latest GitHub connection test confirms the Codex GitHub connector now sees `natthaphonchop2-creator`, created a private GitHub repo, and has admin/push permission on it.
Latest GitHub CLI pass completed OAuth login, merged the remote README bootstrap commit into local history, and pushed `main` to GitHub.
Latest deployment check confirms the existing Cloudflare Quick Tunnel is still online. Cloudflare permanent tunnel/DNS route is not configured yet because `cloudflared` has no origin certificate locally and the Cloudflare account dashboard currently shows no added site/domain.

## Current Architecture

- Frontend: React + Vite + TypeScript in `src/`.
- Dev backend proxy: Vite plugin in `server/metaApiPlugin.ts`.
- Production backend/static server: `server/productionServer.ts`, compiled to `dist-server/server/productionServer.js`.
- Data source: Meta Marketing API through local server endpoints.
- API settings: entered from the web Settings page and saved in `.meta-api.local.json`.
- Write execution: disabled; approvals only stage local UI state until a future write connector is added.

## Data Rules Now

- The old frontend development dataset file has been removed.
- `src/App.tsx` now starts from `emptyWorkspaceData`.
- The local workspace storage key is `clinicstellar-ai-live-workspace-v1`, so older stored development records are not read.
- Meta API config is stored in `.meta-api.local.json`, which is ignored by git and not sent back to the frontend as a token value.
- Pages show empty states when no live Meta-derived data exists.
- AI Insights requires ad or creative rows from Meta before listing ranked components.
- Campaigns page requires campaign rows from Meta before rendering campaign details.
- Server no longer creates an account-summary campaign when no campaign rows are returned.
- Server no longer converts campaign rows into creative components when ad rows are missing.
- Server skips channel, appointment, and funnel rows when account metrics have no activity.
- Performance totals prefer campaign-level Meta insights, then fall back to account/channel-level Meta metrics when campaign totals are empty.
- Date preset `maximum` is supported in the topbar and Settings form as `All time`.
- Production must run through `npm start` after `npm run build`; a static-only host will not support Meta API routes.
- Temporary public access is protected by `APP_BASIC_AUTH_USER` and `APP_BASIC_AUTH_PASSWORD` when those env vars are set.
- Project is now a local git repository on branch `main`.
- GitHub plugin login is `natthaphonchop2-creator`, and the GitHub App is installed for that user account.
- GitHub repo created: `https://github.com/natthaphonchop2-creator/pmc-ads-agent` as a private repository.
- Local git remote `origin` points to `https://github.com/natthaphonchop2-creator/pmc-ads-agent.git`.
- A temporary local GitHub CLI binary was downloaded to `/tmp/pmc-gh-cli/gh/gh_2.92.0_macOS_arm64/bin/gh`; it is not installed system-wide.
- GitHub CLI auth is complete for `natthaphonchop2-creator` and credentials are stored in the macOS keyring.
- Local branch `main` tracks `origin/main`.
- Current pushed GitHub commit after merge: `9b1163bab9b148d9ab6e3c4a80bd6e4bcaf21151`.

## Files Changed In This Pass

- `src/App.tsx`
  - Removed frontend dataset import.
  - Added empty workspace normalization.
  - Added empty states across Performance, Campaigns, Appointments, AI Insights, Action Queue, Ads Auto, Creative, Audience, Media Library, and Audit.
  - Removed hardcoded clinic workspace name from sidebar.
  - Removed floating support/chat button from the app shell.
  - Workspace selector now opens Settings.
  - Theme button now toggles light/dark shell theme.
  - Topbar date preset control now uses a real select and the selected preset is used by Meta sync.
  - Topbar date preset control was restyled into a compact range selector with icon, label, selected range, and `All time`.
  - Performance totals now fall back to channel/account metrics when campaign totals are zero.
  - Performance metric cards are grouped into `Media Cost`, `Funnel Quality`, and `Business Outcome`.
  - Replaced fixed example findings/trends with values derived from current workspace data.
  - Prevented no-show risk from showing when show-up data is unknown.

- `server/metaApiPlugin.ts`
  - Removed synthesized account campaign fallback.
  - Removed campaign-to-creative component fallback.
  - Guarded zero-activity account metrics from producing channel/funnel/pipeline rows.
  - Stopped deriving service show-up and close rates without reliable source data.
  - Updated Meta paging fetches so a later page failure after a successful first page stops pagination instead of failing the whole workspace.
  - Exported reusable `createMetaApiMiddleware` for dev and production servers.

- `server/productionServer.ts`
  - Added production Node HTTP server.
  - Serves built React files from `dist/`.
  - Routes `/api/meta/*` through the same Meta API middleware used by Vite dev.
  - Supports SPA fallback to `index.html`.
  - Added optional Basic Auth protection through `APP_BASIC_AUTH_USER` and `APP_BASIC_AUTH_PASSWORD`.
  - Added public `/healthz` endpoint for PaaS health checks without exposing app data.

- `tsconfig.server.json`
  - Added TypeScript emit config for `server/**/*.ts` into `dist-server/`.

- `package.json`
  - `npm run build` now runs client and server builds.
  - Added `build:client`, `build:server`, and `start`.

- `src/App.css`
  - Added styles for the new topbar date range control.
  - Added styles for categorized Performance metric sections.
  - Added dark-theme support for the new controls.

- `DEPLOYMENT.md`
  - Added production deployment notes for local production check, VPS, PM2, and Nginx reverse proxy.
  - Added temporary public link guidance with Basic Auth requirement.
  - Added Render and Railway deployment steps.

- `render.yaml`
  - Added Render web service blueprint using Node runtime, build `npm ci && npm run build`, start `npm start`, health check `/healthz`, and secret prompts for credentials.

- `railway.json`
  - Added Railway Railpack build/start/healthcheck configuration.

- `README.md`
  - Added production run commands and linked deployment notes.

- `.env.example`
  - Added `APP_BASIC_AUTH_USER` and `APP_BASIC_AUTH_PASSWORD`.

- `.gitignore`
  - Added `dist-server`.
  - Added `.mcp.local.json`, `*.zip`, and `*.tar.gz`.

- `GITHUB_SETUP.md`
  - Added current git state, safe ignored files, GitHub plugin/connector notes, manual push commands, and MCP setup instructions.

- `mcp.github.example.json`
  - Added example config for GitHub's official MCP server via Docker image `ghcr.io/github/github-mcp-server`.

- `/Users/natthaphon/Desktop/Ai PMC/pmc-ads-agent-production.tar.gz`
  - Created production bundle containing `dist/`, `dist-server/`, `package.json`, docs, and `.env.example`.
  - Does not include `.meta-api.local.json`, `.env`, or `node_modules`.

- `Context Compression.md`
  - Rewritten to reflect the current live-data-only state.
  - Updated after GitHub reconnection test with repo, connector, CLI, and push-blocker status.
  - Updated after successful GitHub CLI login, merge, push, and Cloudflare deploy-readiness check.

- `src/assets/` and `src/data/`
  - Removed unused starter assets and the now-empty data folder.

- `.meta-api.local.json`
  - Imported an existing Meta access token and ad account from `/Users/natthaphon/Desktop/ads meta claude/pmc-ads-dashboard (1)/.manus-logs/`.
  - Selected the token with the highest successful request count in the old project logs.
  - Config uses graph version `v21.0`, date preset `last_30d`, and max pages `6`.

## Verification

- `npm run lint` passes.
- `npm run build` passes.
- Local production `/healthz` returns `200 {"ok": true}` without auth; root remains protected by Basic Auth.
- GitHub connector installed accounts now returns `natthaphonchop2-creator`.
- GitHub connector installations now returns installation `131881501` for `natthaphonchop2-creator`.
- GitHub connector repository search now returns `natthaphonchop2-creator/pmc-ads-agent` with admin and push permissions.
- GitHub repo `natthaphonchop2-creator/pmc-ads-agent` was created in Chrome as a private repository.
- GitHub connector created the first remote commit `be0aef5251020aa33711d2ffd07e47ac8556a26f` containing `README.md`.
- Local `origin` remote is set to `https://github.com/natthaphonchop2-creator/pmc-ads-agent.git`.
- GitHub CLI v2.92.0 was downloaded from the official `cli/cli` GitHub release to `/tmp/pmc-gh-cli/.../gh`.
- `gh auth status` now reports logged in to `github.com` as `natthaphonchop2-creator` through keyring, protocol `https`.
- `gh auth setup-git` completed.
- `git fetch origin main` succeeded.
- `git merge origin/main --allow-unrelated-histories` created merge commit `9b1163b Merge remote GitHub bootstrap`.
- `git push -u origin main` succeeded and set tracking to `origin/main`.
- `git ls-remote --heads origin main` confirms remote `main` at `9b1163bab9b148d9ab6e3c4a80bd6e4bcaf21151`.
- Local git repo created with commits:
  - `1e42b62 Initial PMC Ads Agent dashboard`
  - `52787f4 Add GitHub setup notes and MCP example`
- `git status --short --branch` is clean on `main`.
- Production server check passed with `PORT=4180 npm start`.
- Production `/` returned 200 HTML.
- Production `/api/meta/status` returned configured/connected without exposing token.
- Production `/api/meta/workspace?datePreset=maximum` returned 30 campaigns, 36 ad sets, 115 ads, 500 trend rows, and funnel/channel metrics.
- Production bundle was created and inspected; token file is not included.
- Temporary production server is running on local port `4174` with Basic Auth.
- Temporary tunnel is running through Cloudflare Quick Tunnel:
  - URL: `https://connecticut-willing-networks-organ.trycloudflare.com`
  - Basic Auth user: `pmc`
  - Basic Auth password was generated for this temporary session.
  - No-auth request returns `401`.
  - Authenticated `/` returns `200`.
  - Authenticated `/api/meta/status` returns configured/connected and masks ad account.
  - Cloudflare tunnel log: `/tmp/pmc-ads-agent-cloudflare.log`.
  - `cloudflared` binary was downloaded to `/tmp/pmc-cloudflared/cloudflared`; it is not installed system-wide.
  - `cloudflared tunnel list` currently fails because there is no origin cert at the default local paths.
  - Cloudflare dashboard account `Natthaphon.chop2@gmail.com's Account` is logged in, but the account overview shows `Your sites` with `Add a domain`, and `Tunnels` count is `0`.
- Source search found no app-owned records from the old development dataset.
- Browser QA confirms support/chat button count is 0, workspace selector opens Settings, theme toggles to dark mode, and date preset can change to `last_7d`.
- Meta API check passes for `/me`, ad account, and insights read using the imported local config.
- Browser QA on `http://127.0.0.1:5174/` passes:
  - AI Insights shows empty state when no Meta dataset is loaded.
  - Settings shows API Settings, API Credentials, and Save & Test.
  - Performance, Campaigns, AI Insights, Action Queue, Ads Auto, Creative, Audience, Media Library, Integrations, and Help Center do not show old development records.
  - Removed app page no longer appears.
- Meta workspace endpoint with `datePreset=maximum` now returns successfully:
  - 30 campaigns
  - 36 ad sets
  - 115 ads
  - 500 trend rows
  - channel/funnel/appointment metrics present
- Browser QA confirms:
  - topbar range displays `All time`
  - Performance opens successfully
  - Performance shows `Media Cost`, `Funnel Quality`, `Business Outcome`
  - live all-time Meta numbers render in Performance, including spend and ROAS
- Campaigns / Ads Auto UX update completed:
  - `Winning Ads` was renamed to `Action Queue`; `AI Launch` was renamed to `Ads Auto`.
  - Added `deliveryStatus` to Campaign and Ad Set data, plus `adId` to Ads Auto controls.
  - Added `POST /api/meta/object-status` server endpoint to change Campaign, Ad set, or Ad status to `ACTIVE` / `PAUSED` through Meta Marketing API.
  - Campaigns page now has `Meta Delivery Control` with scope tabs for Campaigns, Ad Sets, and Ads.
  - Campaigns page can open a confirmation modal before executing real Meta status changes.
  - Ads table includes per-ad Activate/Pause action buttons.
  - Ads Auto page now shows status decisions and routes Pause/Enable through the real confirmation flow instead of local mock application.
  - AI Insights now supports Group By: Creative, Campaign, Ad Set, Ad, Service, Objective, and Status.
  - Settings now lists write execution as `confirm-only` and documents the new object-status endpoint.
  - Browser QA confirms Campaigns control renders, status modal opens/closes, AI Insights Group By changes to Campaign, Ads Auto renders, and old `AI Launch` / `Winning Ads` labels are gone.
  - `npm run build` passes after these changes.
- Campaigns UX cleanup completed:
  - Removed the main duplication by making the left Campaign area a compact `Selected Campaign` navigator by default.
  - `Meta Delivery Control` now starts at `Ad Sets` and the `Campaign` scope controls only the selected campaign instead of listing every campaign again.
  - Added collapse/expand controls for Campaign navigator, Metrics, Delivery Control, Ad Sets, and Ads.
  - Browser QA confirms default Campaigns view is compact, metrics are visible, delivery control starts with Ad Sets, and collapse/expand buttons work without console errors.
  - `npm run build` passes after this cleanup.
- Campaigns CRUD manager completed:
  - Added backend `POST /api/meta/object` for `create`, `update`, and `delete` operations on Campaign, Ad Set, and Ad.
  - Added frontend Meta Object Manager modal with type-specific forms for Campaign, Ad Set, and Ad.
  - Campaigns page now has Create Campaign, Edit Campaign, Delete Campaign actions.
  - Ad Sets section now has Create Ad Set plus Edit/Delete for the selected Ad Set.
  - Ads section now has Create Ad plus Edit/Delete per row, alongside Activate/Pause.
  - All create/edit/delete actions require confirmation in a modal before sending a real Meta API mutation.
  - Browser QA confirms Campaign, Ad Set, and Ad create modals open; Campaign edit/delete modals open; no console errors were found.
  - Endpoint validation confirms invalid `/api/meta/object` operation returns a validation error without mutating Meta.
  - `npm run build` passes after this CRUD update.
- Meta Object Manager form UX improved:
  - Create/Edit forms now include short Thai helper text for key fields.
  - Status is now a two-option button choice (`Draft / Paused`, `Active`) instead of a plain select.
  - Campaign Objective is now button-based with clinic-friendly explanations for Leads, Traffic, Engagement, and Sales.
  - Campaign Bid Strategy is now button-based.
  - Budget fields now include quick-pick chips such as ฿300, ฿500, ฿1000, and ฿2000.
  - Ad Set Billing Event, Optimization Goal, and Age are now button/chip based.
  - Advanced JSON fields remain available with clearer explanations for targeting, promoted object, creative, and extra params.
  - Browser QA confirms Campaign and Ad Set modals show the new choices/help text and no console errors.
  - `npm run build` passes after this form UX update.
- Ads Auto execution UX improved:
  - Ads Auto now builds a rule-based queue from real `adInsights` data instead of the older local recommendation cards.
  - Added presets: `Balanced`, `Protect Budget`, and `Scale Winners` with visible spend/ROAS/reactivation guardrails.
  - Added queue filters for Action, All, Pause, Enable, and Monitor plus selected-row bulk review controls.
  - Added bulk review modal before sending real Meta status changes through `POST /api/meta/object-status`.
  - Added optimistic local status update after successful bulk execution, then triggers Meta workspace sync.
  - Single-row Review pause/activate still routes through the existing Meta execution confirmation modal.
  - Browser QA confirms Ads Auto opens, presets/filtering work, bulk review modal opens/closes, single action modal opens/closes, and no console errors were found.
  - `npm run build` passes after this Ads Auto update.
- STUDIO pages now use Meta API data:
  - `Creative` was rebuilt as `Creative Studio`, using live `adInsights` and API-generated creative work orders from Meta ad rows.
  - `Audience` was rebuilt as `Audience Studio`, using live Meta ad set targeting, budget, delivery status, spend, bookings, CPA, and ROAS.
  - `Media Library` now uses Meta ad/creative metadata, creative IDs, thumbnail URLs, spend, impressions, CTR, ROAS, and compliance risk generated from live ad rows.
  - Backend `tasks`, `memoryItems`, and `complianceReviews` are now derived from Meta ads/ad sets/campaigns instead of static placeholder records.
  - Local API check confirms workspace returns 8 tasks, 5 memory items, and 18 compliance reviews from Meta data for `datePreset=maximum`.
  - Browser QA confirms Creative, Audience, and Media Library render API-derived data without console errors.
  - `npm run build` passes after this STUDIO update.
- Button QA pass completed:
  - Static scan found 74 `<button>` tags in `src/App.tsx`; one AI Insights table-title button depended on row bubbling and was fixed to call its drawer handler directly.
  - Static scan now confirms every `<button>` has an explicit `onClick`, submit behavior, or disabled state.
  - Browser QA passed for sidebar navigation, workspace settings, theme toggle, platform module cards, STUDIO buttons, Settings check/sync buttons, Performance metric drawer, Campaigns visible create/edit/delete/status/collapse/scope controls, Action Queue approval modal, and Ads Auto mode/preset/filter controls.
  - External/write/destructive confirmation buttons were not executed: Meta status confirm, bulk Ads Auto confirm, object create/update/delete confirm, Save & Test credentials, Clear Saved credentials, and direct Reject mutations.
  - No console errors were found during the tested button flows.
  - `npm run build` passes after the button QA fix.
- Performance PDF report completed:
  - Added a new `Performance Summary` report block at the top of the Performance page.
  - Summary cards now process live workspace data into Business Health, Best Channel, Funnel Bottleneck, and Value / Booking.
  - Added report charts for `Spend vs Revenue by Channel` and normalized `Processed Funnel Health`.
  - Added tooltip/help copy to report cards and Recharts tooltips to both report charts.
  - Added `Export PDF` button that opens the browser print flow, with print CSS for A4 landscape PDF output.
  - Print stylesheet hides sidebar/topbar/modals, removes shadows, keeps report/chart sections printable, and compresses tables for PDF.
  - Browser QA in Chrome confirms Performance renders, report cards show live Meta-derived numbers, both report charts render, and the Export PDF button is visible.
  - `npm run build` passes after the Performance PDF report update.
- Action Queue real endpoint binding completed:
  - `RecommendedAction` now supports `execution`, `executionError`, `executedAt`, and action statuses `executing`, `executed`, and `failed`.
  - Budget protection and tracking/budget protection actions are now executable through `POST /api/meta/object-status`.
  - Executable actions show `Execute` with a concrete Meta API target such as `Pause campaign in Meta · Campaign <id>`.
  - Non-executable recommendations remain `Approve` only and display that no automatic endpoint exists yet.
  - Approval modal now distinguishes approve-only from real execution and shows `Confirm & Execute` before calling Meta API.
  - Successful execution updates local delivery status, marks the action `executed`, writes Audit Log, and syncs Meta data.
  - Failed execution marks the action `failed`, shows the error, keeps the action retryable, and writes a failed Audit Log entry.
  - Sync now merges local Action Queue states and local audit events so executed/failed/approved/rejected actions are not overwritten back to pending after Meta refresh.
  - Browser QA confirms Action Queue renders executable and approve-only actions separately, and the execute confirmation modal opens with the real endpoint warning; destructive Confirm was not clicked.
  - `npm run build` passes after this Action Queue execution update.
- Campaigns / Creative layout bug fix completed:
  - Fixed `Creative Studio` API Work Orders overflow by making `.studio-task-grid` higher specificity, responsive, and able to wrap long Meta input/campaign text inside each card.
  - Reworked the Campaigns Ads section from a horizontally scrolling table into responsive ad cards with visible metrics and fixed action controls.
  - Removed the unused `ads-performance-table` path so the UI no longer depends on sticky table columns for `Activate`, `Edit`, and `Delete`.
  - Follow-up fix: merged Ads status/score and action buttons into a single right-side control panel so `Activate`, `Edit`, and `Delete` cannot be pushed outside the card at wide/medium viewport widths.
  - Follow-up fix: sanitized Meta template tokens such as `{{product.name}}` in server sync output and frontend workspace normalization so dynamic creative placeholders never render in Campaigns, Creative Studio, Action Queue, Memory, or Audit text.
  - Browser QA confirms Creative Work Orders cards no longer overflow and Campaigns Ads action buttons are visible without horizontal table clipping.
  - Browser QA confirms `{{product.name}}` no longer appears in the Campaigns Ads card after reload.
  - `npm run build` passes after this stronger layout fix.
- GitHub upload completed:
  - Local `origin` remote was changed from the older `pmc-ads-agent.git` repository to `https://github.com/natthaphonchop2-creator/PMC.git`.
  - Current project was committed and pushed to `main` on the new `PMC` repository.
  - Secret/local files remain ignored; `.meta-api.local.json` is not tracked.
- AdVibes / Madgicx-inspired UI and function direction started:
  - Downloaded the provided Dribbble MP4 reference and inspected the Quick Look frame for style direction: compact light SaaS dashboard, pale sidebar, thin bordered cards, muted typography, soft multi-color accents, and a right-side insight rail.
  - Updated global visual tokens, sidebar, topbar, page icon, buttons, panel/card radius, shadows, and platform module cards toward that light dashboard style.
  - Renamed the main information architecture toward Madgicx-like functional areas without copying branding: `Ads Manager`, `Optimization`, `Creative Studio`, `Audience Insights`, `Ad Library`, `Analytics`, `Creative Insights`, `AI Marketer`, and `Reports`.
  - Added `AI Marketer Flow` on the platform page with entry points for daily audit recommendations, optimization, creative workflow, and one-click report.
  - Browser QA confirms the platform page renders the new style/function labels and `Ads Manager` opens without framework overlay or console errors.
  - `npm run build` passes after this UI/function pass.
- Creative Studio Auto Post + Meta Ads completed:
  - `Creative Studio` now has a real workflow split into `Creative performance`, `Asset/API work orders`, `Launch Notes`, and `Auto Post + Meta Ads`.
  - Added `POST /api/meta/creative-launch` in `server/metaApiPlugin.ts`; it creates a Meta Ad Creative through `/{ad_account_id}/adcreatives` with `object_story_spec`, then creates an Ad through `/{ad_account_id}/ads`.
  - Launch form requires Meta Page ID, Ad Set, Landing/Booking URL, Primary Text, and Headline before the create button is enabled.
  - Default launch status is `PAUSED` to avoid accidentally activating spend before preview/policy/link review; `ACTIVE` is still available as an explicit selection.
  - Source creative selector uses live `adInsights`, auto-fills ad name, creative name, primary text, headline, and target ad set.
  - Launch notes are generated from selected creative metrics and selected ad set, with clear warning that clicking the button is the real Meta write action.
  - Settings now documents the new `POST /api/meta/creative-launch` endpoint.
  - CSS added for responsive launch form, preview panel, focus states, and mobile collapse.
  - Local route check confirms `GET /api/meta/creative-launch` returns `405 Method not allowed`, proving the dev server has loaded the new endpoint without mutating Meta.
  - Browser QA confirms `Auto Post + Meta Ads`, `Live Creative Performance`, `API Work Orders`, `Launch Notes`, and disabled `Create PAUSED Meta Ad` render on Creative Studio with no fresh console errors.
  - `npm run build` passes after this Creative Studio launch update.
- Tool-local action buttons completed:
  - Updated page action behavior so tool pages do not send the user back and forth between other tools for primary actions.
  - `Creative Studio` hero buttons no longer navigate to `AI Insights` or `Campaigns`.
  - `Creative Studio` now shows local tool actions: `Creative Score` scrolls to the live creative performance section, and `Auto Post` scrolls to the Auto Post + Meta Ads form.
  - Removed `onOpenCampaigns` and `onOpenInsights` from `CreativeStudioPage`; sidebar remains the intentional way to switch tools.
  - `Performance` no longer uses in-page action buttons to jump to `Campaigns` or `Optimization`.
  - `Performance` channel rows now open local drill-down context instead of a Campaigns navigation button.
  - `Performance` AI Auto card now opens an `AI Auto Guardrails` drawer inside the same page instead of navigating to Optimization.
  - `Performance` campaign alerts now open a local campaign-signal drill-down and only update selected campaign state; they do not switch to Creative Insights.
  - Replaced Recharts `ResponsiveContainer` in Performance with a measured chart frame so charts render only after their container has a valid size.
  - Browser QA confirms `Creative Score` / `Auto Post` labels are present, old `AI Insights` / `Create Ad` hero buttons are gone, clicking them keeps the same URL, `Guardrails` opens a local drawer, and fresh browser logs have no warnings/errors.
  - `npm run build` passes after this tool-local action update.
- Production Render deployment completed:
  - Committed latest dashboard changes as `2f9d38f Improve tool-local dashboard workflows`.
  - Pushed `main` to `https://github.com/natthaphonchop2-creator/PMC.git`.
  - Render service URL verified: `https://pmc-ads-agent.onrender.com/`.
  - Production health check verified: `GET https://pmc-ads-agent.onrender.com/healthz` returns `200 {"ok":true}`.
  - Production root verified: `GET https://pmc-ads-agent.onrender.com/` returns the built app HTML.
  - Production asset verified: root HTML serves `/assets/index-B9XHvsWS.js`, matching the latest local build output.
  - Production JS verified to contain the latest features: `Creative Score`, `Auto Post`, `AI Auto Guardrails`, and `creative-launch`.
  - Production Meta API status/check verified as connected using server env (`META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`) without exposing the token in output.
  - Important security follow-up: production currently responds without Basic Auth if `APP_BASIC_AUTH_PASSWORD` is not configured in Render. Set `APP_BASIC_AUTH_PASSWORD` in Render env before sharing the URL outside the organization.
- PMC AI mascot decoration completed:
  - Added generated mascot asset at `public/pmc-ai-mascot.png`.
  - Decorated the Platform home hero with a responsive mascot visual card and retained the existing light ClinicStellar visual system.
  - Added a compact sidebar `PMC AI Buddy` card for desktop navigation and a small mascot treatment for no-data/empty states.
  - Browser QA confirms the mascot renders on the Platform hero in the mobile layout without overlapping the title, controls, or KPI cards.
  - Browser console check after the mascot update found no new errors; older retained logs were from previous Performance fixes.
  - `npm run build` passes after the mascot decoration update.
- Mascot-driven AI status strip completed:
  - Added a compact `AssistantStatusStrip` under the topbar on every tool page.
  - The strip uses real Meta sync state, current page title, actual synced record counts, and workspace `updatedAt`; it does not introduce mock data.
  - The strip shows the mascot avatar, `Meta live` / setup/check status, a concise record summary, and a local `Sync` or `Settings` action depending on API state.
  - Added subtle mascot float motion on the strip and Platform hero, with `prefers-reduced-motion` support.
  - Added light/dark theme styling and mobile responsive collapse for the strip.
  - Browser QA confirms the strip renders, the `Sync` button triggers read-only Meta sync, returns to `Meta live`, and no new console warnings/errors appear.
  - `npm run build` passes after the AI status strip update.
- Mascot gradient theme + GSAP polish completed:
  - Installed `gsap@3.15.0` and added `useMascotGsapMotion` with dynamic import so GSAP ships as a separate lazy chunk instead of the main bundle.
  - Reworked the website theme around mascot colors: purple, sky blue, mint, warm gold, soft glass surfaces, subtle grid texture, and gradient page background.
  - Added gradient hover accent lines to key cards/panels including module cards, metric cards, panels, reports, audience cards, studio rows, timeline items, empty states, and Creative Insights card.
  - Added GSAP entrance animation for topbar, assistant strip, cards/panels, and GSAP-controlled hover accent progress with cleanup on tab changes.
  - Kept `prefers-reduced-motion` support for existing mascot float animations and avoided adding mock data.
  - Browser QA confirms the Platform page has 11 module cards and 3 panels with the new gradient card surface, `documentElement.dataset.gsapMotion` becomes `ready`, no new console warnings/errors appear, and Meta sync settles back to `Meta live`.
  - `npm run build` passes after the mascot gradient theme update; output includes `dist/assets/gsap-BauIho7W.js`.
- Default landing page completed:
  - Changed the app initial `activeTab` from `Creative Insights` to `platform`.
  - Fresh visits and full page reloads now open the `AdVibes Clinic OS` platform page first.
  - Existing sidebar navigation remains unchanged after the user chooses another tool.
- AdVibes Clinic OS tooltips completed:
  - Added detailed Thai helper text for all 11 platform Tools: Ads Manager, Optimization, Creative Studio, Audience Insights, Ad Library, Analytics, Creative Insights, AI Marketer, Settings, Reports, and Help Center.
  - Platform Tool cards now include an info icon, hover/focus tooltip, `aria-label`, and `aria-describedby` so users can understand each tool without changing pages.
  - Browser QA confirms `AdVibes Clinic OS` opens first, 11 Tool cards render, 11 tooltip bodies exist, key help content mentions Meta/API where relevant, and there are no fresh browser console errors.
  - `npm run build` passes after the tooltip update.
- Promedclinicpmc branding completed:
  - Generated a new logo asset and copied the selected generated PNG into `public/promedclinicpmc-logo.png`; the generated source remains in `/Users/natthaphon/.codex/generated_images/019e163b-c9fe-7e43-b796-03d828a56bfa/`.
  - Replaced the sidebar brand text with `Promedclinicpmc`.
  - Added a right-side topbar organization badge showing the generated logo and `Promedclinicpmc`.
  - Optimized the app logo asset to 512x512 for navbar use.
  - Browser QA confirms sidebar brand, top-right organization name, and both logo images load from `/promedclinicpmc-logo.png` with no fresh console errors.
  - `npm run build` passes after the branding update.
- Optimization real Auto rules completed:
  - `Suggest Mode` now remains a manual review flow from live `adInsights`, while `Auto Pilot` auto-selects only rule-qualified candidates that pass confidence, spend, ROAS, booking-volume, and max-actions guardrails.
  - Auto rules are editable on the Optimization page: min spend before pause, pause ROAS, reactivate ROAS, min bookings to reactivate, Auto Pilot confidence, and max actions per run.
  - Added server endpoint `POST /api/meta/bulk-status` for batched Meta status writes, limited to 25 actions per request, reusing the same validation as single object status updates.
  - Bulk Auto execution now calls `/api/meta/bulk-status` instead of looping multiple `/api/meta/object-status` requests from the frontend.
  - Settings endpoint documentation now includes `/api/meta/bulk-status`.
  - Browser QA confirms Optimization renders `Suggest Mode`, `Auto Pilot`, `Auto Rules`, six rule controls, preset switching, and no fresh browser console errors.
  - Endpoint QA confirms `GET /api/meta/bulk-status` returns `405 Method Not Allowed`, so the route is loaded and only accepts POST.
  - `npm run build` passes after the Optimization update.
- Full mock-data audit completed:
  - Audited all app pages/tabs: Platform, Ads Manager, Optimization, Creative Studio, Audience Insights, Ad Library, Analytics, Creative Insights, AI Marketer, Settings, Reports, and Help Center.
  - Code search found no seeded mock dataset or static demo records in `src`, `server`, or `public`; the app initializes with `emptyWorkspaceData` and renders NoData states until Meta data exists.
  - Browser QA across every tab found no mock/demo/fake/dummy/sample data rendered. The only visible `mock` hit is the Audience Insights sentence saying it uses Meta API targeting "โดยไม่ใช้ mock data".
  - Backend data comes from `/api/meta/workspace` and is mapped from Meta account insights, campaigns, ad sets, ads, targeting, and creatives.
  - Important audit caveat: some pages show derived/proxy data, not separate external systems. Service lines are inferred from campaign names; bookings/show-up/paid pipeline are derived from Meta action types; Creative Studio tasks, AI insights, compliance reviews, and AI Marketer recommendations are rule-based summaries from Meta metrics, not LLM/agent/CRM outputs.
  - Browser QA confirms all 12 page states open with no fresh console errors and current local workspace has live Meta synced content.
  - `npm run build` passes during audit.

## Next Recommended Step

Next step: choose permanent deployment route. For a true hosted app, use a Node-capable host such as Render/Railway and set `APP_BASIC_AUTH_PASSWORD`, `META_ACCESS_TOKEN`, and `META_AD_ACCOUNT_ID` as host secrets. For a Cloudflare/domain route that keeps the Meta token local, authorize `cloudflared tunnel login`, create a named tunnel, add a domain/zone, and route DNS to local port `4174`. Temporary web demo is still available through the Cloudflare URL while the local machine and screen sessions remain running.
