# hello-symphony

Backend service for Cloud Run that searches Kinexo clients and returns their active tasks.

## Requirements

- Python 3.12+
- Docker (for container builds)
- `gcloud` CLI (optional, for triggering Cloud Build)

## Configuration

Copy the example environment file and fill in real values:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|---|---|
| `KEYCLOAK_URL` | Keycloak base URL (e.g. `https://auth.example.com/auth`) |
| `REALM` | Keycloak realm |
| `CLIENT_ID` | OAuth client ID |
| `CLIENT_SECRET` | OAuth client secret |
| `API_BASE_URL` | Kinexo API base URL |

Optional:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `ENV` | — | Set to `production` to disable Swagger UI |
| `SWAGGER_ENABLED` | — | Explicit override (`true`/`false`) for Swagger UI |

## Run Locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

set -a && source .env && set +a
uvicorn src.main:app --host 0.0.0.0 --port 8080
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/tasks?q=<term>` | Active tasks for clients matching `term` |
| `GET` | `/docs` | Swagger UI (non-production only) |
| `GET` | `/openapi.json` | OpenAPI spec (non-production only) |

```bash
curl http://localhost:8080/health
curl "http://localhost:8080/tasks?q=CERFRANCE"
```

### Docker

```bash
docker build -t hello-symphony .
docker run --rm --env-file .env -p 8080:8080 hello-symphony
```

## Cloud Build (manual trigger)

All secrets are read from GCP Secret Manager at deploy time.

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions _REGION="europe-west1",_PROJECT_ID="YOUR_PROJECT_ID",_REPO="hello-symphony",_SERVICE_NAME="hello-symphony" \
  .
```

## Project Structure

```
src/
├── config.py          # Environment variable loading
├── auth.py            # Keycloak token manager (async, cached)
├── kinexo/
│   ├── client.py      # Authenticated HTTP client (auto-retry on 401)
│   ├── search.py      # Search clients by raison sociale (paginated)
│   └── tasks.py       # Fan-out: projects → active tasks
├── api/
│   ├── health.py      # GET /health
│   └── tasks.py       # GET /tasks
└── main.py            # FastAPI app entry point
```
