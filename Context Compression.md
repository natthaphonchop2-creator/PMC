# Context Compression

## Current Task Checkpoint

Completed the navbar date range and Performance repair pass.
The topbar date range control is now a compact branded control with a visible `All time` option.
The Performance page now renders from live Meta data for `maximum` / all-time ranges and groups metrics into business-readable categories.
The backend proxy now tolerates later Meta paging failures after a valid first page, preventing large all-time pulls from failing the whole workspace.
Latest deployment pass made the app production-runnable with a Node server that serves `dist/` and preserves `/api/meta/*`.
Latest temporary deployment pass exposes the production server through a Cloudflare Quick Tunnel HTTPS URL protected by Basic Auth.
Latest GitHub pass installed/enabled the GitHub plugin, initialized the project as a local git repository, created commits, and added GitHub/MCP setup notes.

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
- GitHub plugin login is `natthaphonchop2-creator`, but the GitHub App currently has no installed account/repository access.

## Files Changed In This Pass

- `src/App.tsx`
  - Removed frontend dataset import.
  - Added empty workspace normalization.
  - Added empty states across Performance, Campaigns, Appointments, AI Insights, Action Queue, AI Launch, Creative, Audience, Media Library, and Audit.
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
- GitHub plugin `_get_user_login` returns `natthaphonchop2-creator`.
- GitHub plugin repository and installed account lists are empty.
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
  - GitHub push is blocked until a GitHub browser login/PAT/repository access is available. Safari and the in-app browser were not logged into GitHub; Codex GitHub plugin is authenticated as `natthaphonchop2-creator` but has no installed account/repository access and no create-repo tool.
- Source search found no app-owned records from the old development dataset.
- Browser QA confirms support/chat button count is 0, workspace selector opens Settings, theme toggles to dark mode, and date preset can change to `last_7d`.
- Meta API check passes for `/me`, ad account, and insights read using the imported local config.
- Browser QA on `http://127.0.0.1:5174/` passes:
  - AI Insights shows empty state when no Meta dataset is loaded.
  - Settings shows API Settings, API Credentials, and Save & Test.
  - Performance, Campaigns, AI Insights, Winning Ads, AI Launch, Creative, Audience, Media Library, Integrations, and Help Center do not show old development records.
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

## Next Recommended Step

Next step: create or provide a GitHub repository URL, then add it as `origin` and push `main`. If using Codex GitHub plugin, install/authorize the GitHub App for an account/repository first. Temporary web demo is available through the Cloudflare URL while the local machine and screen sessions remain running.
