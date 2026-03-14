import asyncio
import time

import httpx

from src.config import Config

TOKEN_EXPIRY_SAFETY_WINDOW = 30  # seconds


class KeycloakTokenManager:
    def __init__(self, config: Config) -> None:
        self._config = config
        self._token: str | None = None
        self._expires_at: float = 0
        self._lock = asyncio.Lock()

    @property
    def _token_url(self) -> str:
        return (
            f"{self._config.keycloak_url}"
            f"/realms/{self._config.realm}"
            f"/protocol/openid-connect/token"
        )

    def _is_valid(self) -> bool:
        return self._token is not None and time.monotonic() < self._expires_at

    def invalidate(self) -> None:
        self._token = None
        self._expires_at = 0

    async def get_access_token(self) -> str:
        if self._is_valid():
            return self._token  # type: ignore[return-value]

        async with self._lock:
            if self._is_valid():
                return self._token  # type: ignore[return-value]
            await self._refresh()

        return self._token  # type: ignore[return-value]

    async def _refresh(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    self._token_url,
                    data={
                        'grant_type': 'client_credentials',
                        'client_id': self._config.client_id,
                        'client_secret': self._config.client_secret,
                    },
                )
        except httpx.RequestError as exc:
            raise RuntimeError(f"Keycloak connection failed: {exc}") from exc

        if resp.status_code == 401:
            raise RuntimeError(
                "Keycloak authentication failed – check CLIENT_ID / CLIENT_SECRET"
            )
        if not resp.is_success:
            raise RuntimeError(
                f"Keycloak token request failed with status {resp.status_code}: {resp.text}"
            )

        payload = resp.json()
        if not payload.get('access_token') or not isinstance(payload.get('expires_in'), int):
            raise RuntimeError(
                "Keycloak token response missing access_token or expires_in"
            )

        ttl = max(0, payload['expires_in'] - TOKEN_EXPIRY_SAFETY_WINDOW)
        self._token = payload['access_token']
        self._expires_at = time.monotonic() + ttl
