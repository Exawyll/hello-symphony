import os
from dataclasses import dataclass

REQUIRED_ENV = ['KEYCLOAK_URL', 'REALM', 'CLIENT_ID', 'CLIENT_SECRET', 'API_BASE_URL']
_BOOLEAN_TRUE = {'1', 'true', 'yes', 'on'}


@dataclass
class Config:
    keycloak_url: str
    realm: str
    client_id: str
    client_secret: str
    api_base_url: str
    port: int
    swagger_enabled: bool
    basic_auth_user: str | None
    basic_auth_password: str | None


def load_config() -> Config:
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

    swagger_env = os.environ.get('SWAGGER_ENABLED')
    if swagger_env is not None:
        swagger_enabled = swagger_env.strip().lower() in _BOOLEAN_TRUE
    else:
        swagger_enabled = os.environ.get('ENV', '').lower() != 'production'

    return Config(
        keycloak_url=os.environ['KEYCLOAK_URL'].rstrip('/'),
        realm=os.environ['REALM'],
        client_id=os.environ['CLIENT_ID'],
        client_secret=os.environ['CLIENT_SECRET'],
        api_base_url=os.environ['API_BASE_URL'].rstrip('/'),
        port=int(os.environ.get('PORT', 8080)),
        swagger_enabled=swagger_enabled,
        basic_auth_user=os.environ.get('BASIC_AUTH_USER'),
        basic_auth_password=os.environ.get('BASIC_AUTH_PASSWORD'),
    )
