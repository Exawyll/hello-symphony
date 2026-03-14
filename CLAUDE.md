# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Setup (first time)
python3 -m venv .venv && pip install -r requirements.txt

# Run locally (requires .env file populated from .env.example)
set -a && source .env && set +a
uvicorn src.main:app --host 0.0.0.0 --port 8080

# Docker
docker build -t hello-symphony .
docker run --rm --env-file .env -p 8080:8080 hello-symphony

# Deploy via Cloud Build (secrets injected from GCP Secret Manager)
gcloud builds submit --config cloudbuild.yaml \
  --substitutions _REGION=europe-west1,_PROJECT_ID=hello-490012,_REPO=hello-symphony,_SERVICE_NAME=hello-symphony .
```

No lint or test commands are configured.

## Architecture

A stateless HTTP gateway running on Cloud Run (Python 3.12, FastAPI + uvicorn). Authenticates with Keycloak (client credentials flow) and acts as an aggregator over the Kinexo API.

**Endpoints:**
- `GET /health` — health check
- `GET /tasks?q=<company>` — search clients by `raisonSociale`, return active tasks
- `GET /docs` / `GET /openapi.json` — Swagger UI & spec (disabled when `ENV=production`)

**Source layout:**
- `src/config.py` — env var validation, `Config` dataclass
- `src/auth.py` — `KeycloakTokenManager`: async token cache with asyncio lock, 30s safety window before expiry
- `src/kinexo/client.py` — `KinexoClient`: authenticated httpx calls, retries once on 401 with a fresh token
- `src/kinexo/search.py` — paginated client search by `raisonSociale`
- `src/kinexo/tasks.py` — fan-out: client → projects → tasks, filters for tasks where `start ≤ today ≤ end`
- `src/api/health.py` / `src/api/tasks.py` — FastAPI routers
- `src/main.py` — app factory, lifespan (token warm-up, `kinexo_client` on `app.state`)

**Required environment variables** (validated at startup — missing ones crash the process):
`KEYCLOAK_URL`, `REALM`, `CLIENT_ID`, `CLIENT_SECRET`, `API_BASE_URL`

Optional: `PORT` (default 8080), `ENV` (set to `production` to disable Swagger), `SWAGGER_ENABLED`

**Error handling conventions:**
- Upstream Kinexo/Keycloak errors → 502
- Internal/unexpected errors → 500
- Kinexo requests time out after 15 seconds (`httpx` timeout)
