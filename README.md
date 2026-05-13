# ClinicStellar AI Ads Dashboard

React + Vite + TypeScript prototype for an internal clinic ads command dashboard.

## Run

```bash
npm install
npm run dev -- --host 127.0.0.1
```

## Production

```bash
npm install
npm run build
PORT=4174 npm start
```

Production uses `server/productionServer.ts` compiled into `dist-server/`. It serves the React build from `dist/` and keeps the backend proxy endpoints under `/api/meta/*`.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for VPS, PM2, and Nginx notes.

## Meta API Setup

Open `Settings` in the app and fill:

- Access Token
- Ad Account ID
- Graph Version
- Date Preset
- Max Pages

Click `Save & Test`. The dev server stores the values in:

```txt
.meta-api.local.json
```

This file is ignored by git. The token is not stored in browser localStorage.

Alternative setup through `.env` still works. Use `.env.example` as a template.

React calls the local backend proxy endpoints:

- `GET /api/meta/config`
- `POST /api/meta/config`
- `DELETE /api/meta/config`
- `GET /api/meta/status`
- `GET /api/meta/check`
- `GET /api/meta/workspace`

Required Meta permission for read-only dashboard data: `ads_read`.
For future write execution, use a token with the correct `ads_management` permission and keep the approval layer enabled.

## Current Scope

- Meta Marketing API read sync for account, campaigns, ad sets, ads, and insights.
- Maps Meta data into the app-wide `WorkspaceData` model.
- API settings can be entered from the web UI and saved locally on the dev server.
- Write execution to Meta Ads is not enabled in this step.
