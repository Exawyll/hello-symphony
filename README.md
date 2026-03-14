# hello-symphony

Backend service skeleton for Cloud Run.

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- Docker (for container builds)
- `gcloud` CLI (optional, for triggering Cloud Build)

## Configuration

Copy the example environment file and fill in real values:

```bash
cp .env.example .env
```

Required variables:

- `KEYCLOAK_URL`
- `REALM`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `API_BASE_URL`

The service reads environment variables at startup and exits if any are missing.

## Run Locally

### Node.js

```bash
set -a
source .env
set +a
npm start
```

The server listens on `PORT` (defaults to `8080`).

Test the health endpoint:

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{"status":"ok"}
```

### Docker

```bash
docker build -t hello-symphony .
docker run --rm --env-file .env -p 8080:8080 hello-symphony
```

## Cloud Build (manual trigger)

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions _REGION="europe-west1",_PROJECT_ID="YOUR_PROJECT_ID",_REPO="hello-symphony",_SERVICE_NAME="hello-symphony" \
  .
```

## Project Structure

```
.
├── src/
│   └── index.js   # HTTP server entry point
├── Dockerfile
├── cloudbuild.yaml
├── .env.example
├── package.json
└── README.md
```
