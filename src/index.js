'use strict';

const http = require('http');

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
  loadConfig();
  const port = getPort();
  const server = createServer();
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

module.exports = { createServer, getPort, loadConfig };
