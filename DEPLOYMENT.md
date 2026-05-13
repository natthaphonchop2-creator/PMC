# Deployment

This app now has a production Node server. It serves the built React app from `dist/` and keeps the Meta API proxy at `/api/meta/*`.

## Local Production Check

```bash
npm install
npm run build
PORT=4174 npm start
```

Open:

```txt
http://127.0.0.1:4174/
```

Health/API checks:

```bash
curl http://127.0.0.1:4174/api/meta/status
curl 'http://127.0.0.1:4174/api/meta/workspace?datePreset=maximum'
```

## Temporary Public Link

For temporary exposure, run the production server with Basic Auth first:

```bash
APP_BASIC_AUTH_USER=pmc APP_BASIC_AUTH_PASSWORD=change-this PORT=4174 npm start
```

Then expose port `4174` through a tunnel provider such as localhost.run, Cloudflare Tunnel, or ngrok.
Do not expose this app publicly without `APP_BASIC_AUTH_PASSWORD`, because `/api/meta/*` and Settings are live server endpoints.

## Server Requirements

- Node.js 22+ recommended
- outbound HTTPS access to `graph.facebook.com`
- one of these credential options:
  - set server environment variables from `.env.example`
  - or enter credentials from the web Settings page after deployment
  - or securely copy `.meta-api.local.json` to the project root on the server

Do not commit `.meta-api.local.json`.

## Easiest Permanent Deploy

Use Render or Railway. This project includes both `render.yaml` and `railway.json`.

### Render

1. Push the project to GitHub.
2. In Render, create a new Blueprint from the repo.
3. Render reads `render.yaml`.
4. Fill the prompted secret env vars:
   - `APP_BASIC_AUTH_PASSWORD`
   - `META_ACCESS_TOKEN`
   - `META_AD_ACCOUNT_ID`
5. Deploy.

Render build/start settings are already configured:

```txt
Build Command: npm ci && npm run build
Start Command: npm start
Health Check: /healthz
```

### Railway

1. Push the project to GitHub.
2. In Railway, create a new project from the repo.
3. Railway reads `railway.json`.
4. Add variables:
   - `APP_BASIC_AUTH_USER=pmc`
   - `APP_BASIC_AUTH_PASSWORD=<your password>`
   - `META_ACCESS_TOKEN=<token>`
   - `META_AD_ACCOUNT_ID=act_...`
   - `META_GRAPH_VERSION=v21.0`
   - `META_DATE_PRESET=last_30d`
   - `META_MAX_PAGES=6`
5. Deploy.

## Basic VPS Deploy

Example target path:

```txt
/var/www/pmc-ads-agent
```

Commands on the server:

```bash
cd /var/www/pmc-ads-agent
npm ci
npm run build
PORT=4174 npm start
```

For a persistent process, use PM2 or systemd.

## PM2 Example

```bash
npm install -g pm2
cd /var/www/pmc-ads-agent
npm ci
npm run build
PORT=4174 pm2 start npm --name pmc-ads-agent -- start
pm2 save
```

## Nginx Reverse Proxy Example

```nginx
server {
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:4174;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then enable HTTPS with your normal Certbot/SSL flow.
