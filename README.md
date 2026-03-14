# hello-symphony

Backend service for Cloud Run that searches Kinexo clients, returns their active tasks, and serves a monthly client dashboard fed from Firestore.

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
| `GCP_PROJECT_ID` | auto-detected | GCP project for Firestore (auto-set on Cloud Run) |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to a service account key file (local dev only) |

## Run Locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

set -a && source .env && set +a
uvicorn src.main:app --host 0.0.0.0 --port 8080
```

For local Firestore access, authenticate with a service account key:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json
GCP_PROJECT_ID=hello-490012
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Monthly client dashboard (HTML) |
| `GET` | `/health` | Health check |
| `GET` | `/tasks?q=<term>` | Active tasks for clients matching `term` |
| `GET` | `/api/rapport/latest` | Latest monthly report (JSON) |
| `GET` | `/api/rapport/{mois}` | Report for a specific month, e.g. `2026-02` (JSON) |
| `GET` | `/api/rapport` | List available months (JSON) |
| `GET` | `/docs` | Swagger UI (non-production only) |

```bash
curl http://localhost:8080/health
curl "http://localhost:8080/tasks?q=CERFRANCE"
curl http://localhost:8080/api/rapport/latest
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
  --substitutions _REGION="europe-west1",_PROJECT_ID="hello-490012",_REPO="hello-symphony",_SERVICE_NAME="hello-symphony" \
  .
```

## Cloud Run — Firestore IAM

The Cloud Run service account needs the **Firestore User** role to read from the `rapports_myk` collection. No Secret Manager entry is required — the project is auto-detected from the runtime environment.

```bash
gcloud projects add-iam-policy-binding hello-490012 \
  --member "serviceAccount:684114191255-compute@developer.gserviceaccount.com" \
  --role "roles/datastore.user"
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
│   ├── tasks.py       # GET /tasks
│   ├── clients.py     # GET /clients
│   └── rapport.py     # GET /api/rapport/* — Firestore-backed monthly reports
└── main.py            # FastAPI app entry point
static/
├── index.html         # Monthly client dashboard
└── clients.html       # Client list view
```
