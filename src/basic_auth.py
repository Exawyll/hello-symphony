import base64
import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class BasicAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, username: str, password: str):
        super().__init__(app)
        self.username = username
        self.password = password

    async def dispatch(self, request: Request, call_next):
        if request.url.path == '/health':
            return await call_next(request)

        auth = request.headers.get('Authorization', '')
        if auth.startswith('Basic '):
            try:
                decoded = base64.b64decode(auth[6:]).decode()
                u, _, p = decoded.partition(':')
                ok = (secrets.compare_digest(u, self.username) and
                      secrets.compare_digest(p, self.password))
                if ok:
                    return await call_next(request)
            except Exception:
                pass

        return Response(
            'Unauthorized', status_code=401,
            headers={'WWW-Authenticate': 'Basic realm="Hello Symphony"'}
        )
