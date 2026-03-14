import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.cloud import firestore

from src.auth import KeycloakTokenManager
from src.basic_auth import BasicAuthMiddleware
from src.config import load_config
from src.kinexo.client import KinexoClient
from src.api.clients import router as clients_router
from src.api.health import router as health_router
from src.api.rapport import router as rapport_router
from src.api.tasks import router as tasks_router

STATIC_DIR = Path(__file__).parent.parent / 'static'

load_dotenv()

logger = logging.getLogger(__name__)
config = load_config()


@asynccontextmanager
async def lifespan(app: FastAPI):
    token_manager = KeycloakTokenManager(config)
    app.state.kinexo_client = KinexoClient(config.api_base_url, token_manager)
    app.state.firestore_client = firestore.Client(
        project=os.environ.get('GCP_PROJECT_ID')
    )
    try:
        await token_manager.get_access_token()
        logger.info('Startup Keycloak token acquisition succeeded')
    except Exception as exc:
        logger.warning('Startup Keycloak token acquisition failed: %s', exc)
    yield


app = FastAPI(
    title='hello-symphony',
    version='1.0.0',
    docs_url='/docs' if config.swagger_enabled else None,
    openapi_url='/openapi.json' if config.swagger_enabled else None,
    lifespan=lifespan,
)

if config.basic_auth_user and config.basic_auth_password:
    app.add_middleware(BasicAuthMiddleware,
                       username=config.basic_auth_user,
                       password=config.basic_auth_password)

app.include_router(health_router)
app.include_router(clients_router)
app.include_router(tasks_router)
app.include_router(rapport_router)

app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')


@app.get('/', include_in_schema=False)
async def index():
    return FileResponse(STATIC_DIR / 'index.html')


@app.get('/app', include_in_schema=False)
async def clients_view():
    return FileResponse(STATIC_DIR / 'clients.html')

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    uvicorn.run('src.main:app', host='0.0.0.0', port=config.port)
