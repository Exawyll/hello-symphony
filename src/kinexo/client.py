import httpx

from src.auth import KeycloakTokenManager

REQUEST_TIMEOUT = 15.0


class KinexoClient:
    def __init__(self, base_url: str, token_manager: KeycloakTokenManager) -> None:
        self._base_url = base_url
        self._token_manager = token_manager

    async def get(self, path: str) -> httpx.Response:
        async with httpx.AsyncClient(base_url=self._base_url, timeout=REQUEST_TIMEOUT) as http:
            for attempt in range(2):
                token = await self._token_manager.get_access_token()
                try:
                    resp = await http.get(path, headers={'Authorization': f'Bearer {token}'})
                except httpx.RequestError as exc:
                    raise RuntimeError(f"Kinexo request failed: {exc}") from exc

                if resp.status_code != 401:
                    return resp

                self._token_manager.invalidate()

            raise RuntimeError(
                f"Kinexo request unauthorized after token refresh: {resp.text}"
            )
