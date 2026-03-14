import logging
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI

from src.auth import KeycloakTokenManager
from src.config import load_config
from src.kinexo.client import KinexoClient
from src.api.health import router as health_router
from src.api.tasks import router as tasks_router

load_dotenv()

logger = logging.getLogger(__name__)
config = load_config()


@asynccontextmanager
async def lifespan(app: FastAPI):
    token_manager = KeycloakTokenManager(config)
    app.state.kinexo_client = KinexoClient(config.api_base_url, token_manager)
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

app.include_router(health_router)
app.include_router(tasks_router)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    uvicorn.run('src.main:app', host='0.0.0.0', port=config.port)
