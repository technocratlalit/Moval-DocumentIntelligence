# VPS deployment

For Laravel / third-party integration (APIs, webhook, legacy JSON mapper), see [INTEGRATION.md](INTEGRATION.md).

**Quick handoff:**
- Laravel team → [LARAVEL.md](LARAVEL.md)
- aimodule VPS owner → [MYSIDE.md](MYSIDE.md)

Full stack: **valkey** + **aimodule** (API) + **aimodule-worker** + **test-backend** + **web**.

Same `docker-compose.yml` for local dev and production.

## Prerequisites

- Docker and Docker Compose on the VPS
- External services (not in compose):
  - **MongoDB** — portal user/session data
  - **Google Cloud Storage** — aimodule file staging
  - **Cloudflare R2** — portal file uploads
  - **Gemini API key** — document extraction (RC, DL, workshop, policy, claim forms)
  - **New Relic license key** — observability

## Setup

1. Clone the repo on the VPS.

2. Create environment file:
   ```bash
   cp .env.sample .env
   ```
   Edit `.env` and fill every value. Required highlights:
   - `PUBLIC_URL` — public URL users open (e.g. `https://docs.yourdomain.com`)
   - `GEMINI_API_KEY` and model slugs (`AI_MODEL`, `AI_MODEL_LITE`, `AI_MODEL_PRO`)
   - `CLAIM_AI_MODEL` — claim form extraction (default `gemini-2.5-flash-lite` in `.env.sample`)
   - `GCS_*` credentials
   - `DATABASE_URI`, `R2_*`
   - `JWT_SECRET`, `WEBHOOK_SECRET`, `SESSION_SECRET`, `ADMIN_API_KEY` — use strong random values
   - `NEW_RELIC_LICENSE_KEY`
   - `AIMODULE_PORT` — host port for aimodule API (default `3000`)

   `WEBHOOK_URL` is read from `.env` by compose (default: `http://test-backend:3001/api/webhook/extraction-complete` for local dev). For Laravel on another server, set it to Laravel's public webhook URL before redeploy.

3. Build and start all services:
   ```bash
   docker compose up -d --build
   ```

4. Open the app at `http://<vps-ip>` or your `PUBLIC_URL` (port `WEB_PORT`, default 80).

## Verify

```bash
# All containers running
docker compose ps

# API health (inside aimodule container)
docker compose exec aimodule curl -s localhost:3000/health

# Valkey (queue)
docker compose exec valkey valkey-cli ping

# Logs
docker compose logs -f aimodule aimodule-worker
```

**Smoke test:** upload a document via the web UI → test-backend enqueues to aimodule → worker processes → webhook returns result to portal.

## Workers

Two worker replicas run by default: `aimodule-worker` and `aimodule-worker-2`. Both pull jobs from the same Valkey queues in parallel.

## Architecture

```
Browser → web:80 → test-backend:3001 → aimodule:3000 (enqueue)
aimodule-worker → valkey (BullMQ) → Gemini/GCS → webhook → test-backend
```

Valkey runs in compose (`redis://valkey:6379`), internal network only — not exposed on the host.

## Laravel on another server

When Laravel runs on a **different VPS**, expose aimodule so Laravel can call it by IP or domain:

1. **aimodule API** is published on host port `AIMODULE_PORT` (default **3000**):
   ```bash
   curl http://localhost:3000/health
   # From Laravel server:
   curl http://<aimodule-vps-ip>:3000/health
   ```

2. **Set webhook URLs** in aimodule VPS `.env`:
   ```env
   # Single Laravel backend:
   WEBHOOK_URL=https://api.theirdomain.com/api/webhooks/extraction-complete

   # Two Laravel apps (.in + .com) — also set tenant URLs; Laravel sends X-Aimodule-Tenant header:
   WEBHOOK_URL_IN=https://moval.techkrate.in/backend/api/ai-module/webhook/extraction-complete
   WEBHOOK_URL_COM=https://moval.techkrate.com/backend/api/ai-module/webhook/extraction-complete
   ```
   `docker-compose.yml` passes these from root `.env` into aimodule API and workers.
   Then redeploy: `docker compose up -d --build`

3. **Share secrets** with Laravel team: `JWT_SECRET`, `WEBHOOK_SECRET` (must match exactly).

4. **Firewall** aimodule VPS — allow port 3000 only from Laravel server IP:
   ```bash
   ufw allow from <laravel-server-ip> to any port 3000
   ```

5. **Laravel** sets `AIMODULE_URL=http://<aimodule-vps-ip>:3000` and implements webhook + mapper.

Full step-by-step payloads and examples: [INTEGRATION.md](INTEGRATION.md).

## Observability

Production defaults to **New Relic only** (`OBSERVABILITY_PROVIDER=newrelic`, `OTEL_ENABLED=false`).

Optional SigNoz/OTel for local dev: set `OTEL_ENABLED=true` and configure `OTEL_EXPORTER_OTLP_*` in `.env`.

## Security

- Never commit `.env` or real secrets to git.
- Rotate any keys that were ever committed to `.env.sample` history.
- Set `PUBLIC_URL` before `docker compose build` — web bakes API URLs at build time.
