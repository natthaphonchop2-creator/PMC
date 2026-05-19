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
- `POST /api/ai/brain`
- `POST /api/ai/knowledge/capture`
- `POST /api/ai/outcomes`
- `POST /api/ai/marketer`
- `POST /api/ai/creative`

`POST /api/ai/brain` is the Phase 1 Master Agent endpoint. It assembles real `WorkspaceData`, optional website context, memory, and decision history; routes specialist-agent thinking; enforces no-invented-metrics and approval-required policy; and returns structured findings, recommendations, memory writes, decision records, and agent task results. Phase 1 does not allow direct execution from AI output.

Phase 2 adds frontend website context and a local runtime knowledgebase. The AI Marketer page can send active tab, date preset, selected campaign, visible cards, visible rows, and UI error state to `/api/ai/brain`. The backend retrieves and appends memory/decision JSONL under `knowledge-base/runtime/`, which is local generated data and ignored by git.

Phase 3 adds specialist-agent outputs and approval-only action cards. `/api/ai/brain` now returns `specialistOutputs` for Campaign, Ad Set, Ad, Budget, Funnel, Creative, Audience, Compliance, Approval Gatekeeper, and Action Builder agents, plus `approvalActions` that can appear in the app approval queue. AI Brain approval cards intentionally have no `execution` payload, so approving them records a plan review only and does not write to Meta.

If OpenAI structured output fails with a transient 5xx/429 response, `/api/ai/brain` uses a deterministic specialist fallback from real `WorkspaceData` instead of returning an empty 502. The response includes `modelFallback` when this path is used, and still keeps direct execution disabled.

Phase 4 adds deterministic outcome learning and monitoring through `POST /api/ai/outcomes`. It reads runtime decisions/memories, compares available before snapshots against the latest workspace, writes append-only outcome observations, learning records, monitoring alerts, and Phase 4 reports under `knowledge-base/runtime/`, and returns a read-only report for the Reports page. Phase 4 treats performance deltas as correlation, not proof of causality, and does not grant execution rights.

The AI Marketer page keeps the Master Agent follow-up flow intentionally small: each action card can either run a focused deep dive that writes runtime memory through AI Brain, or open a plan-approval modal. Approving an AI Brain card records the plan and audit trail only; it does not write to Meta unless a separate execution payload is present.

Required Meta permission for read-only dashboard data: `ads_read`.
For future write execution, use a token with the correct `ads_management` permission and keep the approval layer enabled.

## Current Scope

- Meta Marketing API read sync for account, campaigns, ad sets, ads, and insights.
- Maps Meta data into the app-wide `WorkspaceData` model.
- API settings can be entered from the web UI and saved locally on the dev server.
- AI Brain can create approval-only plans; write execution to Meta Ads is still guarded and not enabled from AI Brain output.
