'use strict';

const http = require('http');

const TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS = 30;

const REQUIRED_ENV = [
  'KEYCLOAK_URL',
  'REALM',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'API_BASE_URL',
];

const loadConfig = (env = process.env) => {
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    const error = new Error(message);
    error.missingEnv = missing;
    throw error;
  }

  return {
    keycloakUrl: env.KEYCLOAK_URL,
    realm: env.REALM,
    clientId: env.CLIENT_ID,
    clientSecret: env.CLIENT_SECRET,
    apiBaseUrl: env.API_BASE_URL,
  };
};

const getPort = (env = process.env) => Number(env.PORT) || 8080;

const normalizeBaseUrl = (value) => value.replace(/\/+$/, '');

const buildKeycloakTokenUrl = (config) =>
  `${normalizeBaseUrl(config.keycloakUrl)}/realms/${config.realm}/protocol/openid-connect/token`;

const parseJsonBody = (bodyText, errorPrefix) => {
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    const message = `${errorPrefix}: ${bodyText}`;
    const wrapped = new Error(message);
    wrapped.cause = error;
    throw wrapped;
  }
};

const fetchKeycloakToken = async (config) => {
  const response = await fetch(buildKeycloakTokenUrl(config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  const bodyText = await response.text();

  if (response.status === 401) {
    throw new Error(
      'Keycloak authentication failed – check CLIENT_ID / CLIENT_SECRET'
    );
  }

  if (!response.ok) {
    throw new Error(
      `Keycloak token request failed with status ${response.status}: ${bodyText}`
    );
  }

  const payload = parseJsonBody(
    bodyText,
    'Keycloak token response was not valid JSON'
  );

  if (!payload.access_token || typeof payload.expires_in !== 'number') {
    throw new Error('Keycloak token response missing access_token or expires_in');
  }

  return { accessToken: payload.access_token, expiresIn: payload.expires_in };
};

const createKeycloakTokenManager = (
  config,
  now = () => Date.now()
) => {
  let cachedToken = null;
  let expiresAt = 0;
  let inFlight = null;

  const invalidate = () => {
    cachedToken = null;
    expiresAt = 0;
  };

  const hasValidToken = () => cachedToken && now() < expiresAt;

  const refreshToken = async () => {
    const { accessToken, expiresIn } = await fetchKeycloakToken(config);
    const ttlSeconds = Math.max(0, expiresIn - TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS);
    cachedToken = accessToken;
    expiresAt = now() + ttlSeconds * 1000;
    return cachedToken;
  };

  const getAccessToken = async () => {
    if (hasValidToken()) {
      return cachedToken;
    }

    if (inFlight) {
      return inFlight;
    }

    inFlight = refreshToken();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };

  return {
    getAccessToken,
    invalidate,
  };
};

const createKinexoClient = (config, tokenManager) => {
  const baseUrl = normalizeBaseUrl(config.apiBaseUrl);

  const requestWithAuth = async (path, options = {}) => {
    const executeRequest = async () => {
      const token = await tokenManager.getAccessToken();
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
      });
    };

    let response = await executeRequest();
    if (response.status === 401) {
      tokenManager.invalidate();
      response = await executeRequest();
      if (response.status === 401) {
        const bodyText = await response.text();
        const error = new Error(
          `Kinexo request unauthorized after token refresh (status 401): ${bodyText}`
        );
        error.status = response.status;
        error.body = bodyText;
        throw error;
      }
    }

    return response;
  };

  return { request: requestWithAuth };
};

const createServer = () =>
  http.createServer((req, res) => {
    const path = req.url ? req.url.split('?')[0] : '';

    if (req.method === 'GET' && path === '/health') {
      const payload = JSON.stringify({ status: 'ok' });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

if (require.main === module) {
  const config = loadConfig();
  const port = getPort();
  const server = createServer();
  const tokenManager = createKeycloakTokenManager(config);

  (async () => {
    try {
      await tokenManager.getAccessToken();
    } catch (error) {
      console.error(
        `Startup Keycloak token acquisition failed: ${error.message}`
      );
      process.exit(1);
    }

    server.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  })();
}

module.exports = {
  createServer,
  getPort,
  loadConfig,
  createKeycloakTokenManager,
  createKinexoClient,
};
