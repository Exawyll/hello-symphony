'use strict';

const http = require('http');

const TOKEN_EXPIRY_SAFETY_WINDOW_SECONDS = 30;
const CLIENTS_PAGE_SIZE = 100;
const CLIENTS_SORT = 'raisonSociale,asc';
const CLIENTS_REQUEST_TIMEOUT_MS = 15_000;
const PROJECTS_PAGE_SIZE = 100;
const PROJECTS_SORT = 'id,asc';
const TASKS_PAGE_SIZE = 200;
const TASKS_SORT = 'id,asc';
const PROJECTS_REQUEST_TIMEOUT_MS = 15_000;
const TASKS_REQUEST_TIMEOUT_MS = 15_000;

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

const markUpstreamError = (error) => {
  if (error && typeof error === 'object') {
    error.isUpstream = true;
  }
  return error;
};

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

const buildClientsPath = (page) =>
  `/api/clients?size=${CLIENTS_PAGE_SIZE}&page=${page}&sort=${CLIENTS_SORT}`;
const buildProjectsPath = (dossierId) =>
  `/api/projets?dossierCrmId=${encodeURIComponent(
    dossierId
  )}&size=${PROJECTS_PAGE_SIZE}&sort=${PROJECTS_SORT}`;
const buildTasksPath = (projectId) =>
  `/api/taches?projetId=${encodeURIComponent(
    projectId
  )}&size=${TASKS_PAGE_SIZE}&sort=${TASKS_SORT}`;

const withTimeout = async (task, timeoutMs, timeoutMessage) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await task(controller.signal);
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error(timeoutMessage);
      timeoutError.cause = error;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const parseIsoDateOnly = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const datePart = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return null;
  }

  const date = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

const getUtcTodayDate = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const buildOpenApiSpec = () => ({
  openapi: '3.0.3',
  info: {
    title: 'hello-symphony',
    version: '1.0.0',
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                  },
                  required: ['status'],
                },
              },
            },
          },
        },
      },
    },
    '/tasks': {
      get: {
        summary: 'Get active tasks for matching clients',
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            description: 'Company name search term',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Aggregated tasks for matching clients',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Task' },
                },
              },
            },
          },
          400: {
            description: 'Missing or blank query parameter',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          404: {
            description: 'No matching client',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          502: {
            description: 'Upstream error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          500: {
            description: 'Internal server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Task: {
        type: 'object',
        properties: {
          clientName: { type: 'string' },
          projectLabel: { type: 'string' },
          taskLabel: { type: 'string' },
          statut: { type: 'string', nullable: true },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          agents: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'clientName',
          'projectLabel',
          'taskLabel',
          'statut',
          'startDate',
          'endDate',
          'agents',
        ],
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
        required: ['error'],
      },
    },
  },
});

const buildDocsHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API Docs</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
    />
    <style>
      html, body { margin: 0; padding: 0; background: #f5f5f5; }
      #swagger-ui { max-width: 1100px; margin: 0 auto; padding: 24px; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: '/openapi.json',
          dom_id: '#swagger-ui',
        });
      };
    </script>
  </body>
</html>`;

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const sendHtml = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const fetchKeycloakToken = async (config) => {
  let response;
  try {
    response = await fetch(buildKeycloakTokenUrl(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
  } catch (error) {
    throw markUpstreamError(error);
  }

  const bodyText = await response.text();

  if (response.status === 401) {
    const error = new Error(
      'Keycloak authentication failed – check CLIENT_ID / CLIENT_SECRET'
    );
    throw markUpstreamError(error);
  }

  if (!response.ok) {
    const error = new Error(
      `Keycloak token request failed with status ${response.status}: ${bodyText}`
    );
    throw markUpstreamError(error);
  }

  let payload;
  try {
    payload = parseJsonBody(
      bodyText,
      'Keycloak token response was not valid JSON'
    );
  } catch (error) {
    throw markUpstreamError(error);
  }

  if (!payload.access_token || typeof payload.expires_in !== 'number') {
    const error = new Error(
      'Keycloak token response missing access_token or expires_in'
    );
    throw markUpstreamError(error);
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
      try {
        return await fetch(`${baseUrl}${path}`, {
          ...options,
          headers,
        });
      } catch (error) {
        throw markUpstreamError(error);
      }
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
        throw markUpstreamError(error);
      }
    }

    return response;
  };

  return { request: requestWithAuth };
};

const searchKinexoClientsByRaisonSociale = async (
  kinexoClient,
  searchTerm
) => {
  const normalizedTerm = String(searchTerm ?? '').toLowerCase();
  const matches = [];
  let page = 0;
  let last = false;

  while (!last) {
    let payload;
    try {
      payload = await withTimeout(
        async (signal) => {
          const response = await kinexoClient.request(buildClientsPath(page), {
            signal,
          });
          const bodyText = await response.text();

          if (!response.ok) {
            const error = new Error(
              `Kinexo clients request failed with status ${response.status}: ${bodyText}`
            );
            error.status = response.status;
            error.body = bodyText;
            throw markUpstreamError(error);
          }

          return parseJsonBody(
            bodyText,
            'Kinexo clients response was not valid JSON'
          );
        },
        CLIENTS_REQUEST_TIMEOUT_MS,
        `Kinexo clients request timed out after ${CLIENTS_REQUEST_TIMEOUT_MS}ms`
      );
    } catch (error) {
      throw markUpstreamError(error);
    }

    const clients = Array.isArray(payload?.content) ? payload.content : [];
    for (const client of clients) {
      const raisonSociale = client?.raisonSociale ?? '';
      if (
        typeof raisonSociale === 'string' &&
        raisonSociale.toLowerCase().includes(normalizedTerm)
      ) {
        matches.push({
          raisonSociale,
          dossierId: client?.dossierId ?? null,
          numeroDossier: client?.numeroDossier ?? null,
        });
      }
    }

    last = Boolean(payload?.last);
    page += 1;
  }

  return matches;
};

const retrieveActiveTasksForClient = async (
  kinexoClient,
  { dossierId, clientName }
) => {
  if (!dossierId) {
    return [];
  }

  let projects = [];
  try {
    projects = await withTimeout(
      async (signal) => {
        const response = await kinexoClient.request(buildProjectsPath(dossierId), {
          signal,
        });
        const bodyText = await response.text();

        if (response.status === 204) {
          return [];
        }

        if (!response.ok) {
          const error = new Error(
            `Kinexo projects request failed with status ${response.status}: ${bodyText}`
          );
          error.status = response.status;
          error.body = bodyText;
          throw markUpstreamError(error);
        }

        const payload = parseJsonBody(
          bodyText,
          'Kinexo projects response was not valid JSON'
        );
        return Array.isArray(payload?.content) ? payload.content : [];
      },
      PROJECTS_REQUEST_TIMEOUT_MS,
      `Kinexo projects request timed out after ${PROJECTS_REQUEST_TIMEOUT_MS}ms`
    );
  } catch (error) {
    throw markUpstreamError(error);
  }

  const today = getUtcTodayDate();
  const activeTasks = [];

  for (const project of projects) {
    const projectId = project?.id;
    if (!projectId) {
      continue;
    }

    let tasks = [];
    try {
      tasks = await withTimeout(
        async (signal) => {
          const response = await kinexoClient.request(buildTasksPath(projectId), {
            signal,
          });
          const bodyText = await response.text();

          if (response.status === 204) {
            return [];
          }

          if (!response.ok) {
            const error = new Error(
              `Kinexo tasks request failed with status ${response.status}: ${bodyText}`
            );
            error.status = response.status;
            error.body = bodyText;
            throw markUpstreamError(error);
          }

          const payload = parseJsonBody(
            bodyText,
            'Kinexo tasks response was not valid JSON'
          );
          return Array.isArray(payload?.content) ? payload.content : [];
        },
        TASKS_REQUEST_TIMEOUT_MS,
        `Kinexo tasks request timed out after ${TASKS_REQUEST_TIMEOUT_MS}ms`
      );
    } catch (error) {
      throw markUpstreamError(error);
    }

    for (const task of tasks) {
      const start = parseIsoDateOnly(task?.dateDebutAuPlusTot);
      const end = parseIsoDateOnly(task?.dateFinAuPlusTard);
      if (!start || !end) {
        continue;
      }

      if (start <= today && today <= end) {
        const projectLabel =
          typeof project?.libelle === 'string' && project.libelle.trim()
            ? project.libelle
            : `#${project?.id ?? 'unknown'}`;
        const taskLabel =
          typeof task?.libelle === 'string' && task.libelle.trim()
            ? task.libelle
            : `#${task?.id ?? 'unknown'}`;
        activeTasks.push({
          clientName,
          projectLabel,
          taskLabel,
          statut: task?.statut,
          startDate: task?.dateDebutAuPlusTot,
          endDate: task?.dateFinAuPlusTard,
          agents: Array.isArray(task?.matriculesAgents)
            ? task.matriculesAgents
            : [],
        });
      }
    }
  }

  return activeTasks;
};

const createServer = ({ config, tokenManager } = {}) => {
  const resolvedConfig = config ?? null;
  const resolvedTokenManager =
    tokenManager ?? (resolvedConfig ? createKeycloakTokenManager(resolvedConfig) : null);
  const kinexoClient =
    resolvedConfig && resolvedTokenManager
      ? createKinexoClient(resolvedConfig, resolvedTokenManager)
      : null;

  const handleTasksRequest = async (req, res, url) => {
    const searchTerm = url.searchParams.get('q');
    if (!searchTerm || !searchTerm.trim()) {
      sendJson(res, 400, { error: 'Missing required query parameter: q' });
      return;
    }

    if (!kinexoClient) {
      sendJson(res, 500, { error: 'Internal server error' });
      return;
    }

    try {
      const clients = await searchKinexoClientsByRaisonSociale(
        kinexoClient,
        searchTerm.trim()
      );

      if (clients.length === 0) {
        sendJson(res, 404, {
          error: `No client found matching: ${searchTerm.trim()}`,
        });
        return;
      }

      const tasks = [];
      for (const client of clients) {
        const clientTasks = await retrieveActiveTasksForClient(kinexoClient, {
          dossierId: client.dossierId,
          clientName: client.raisonSociale,
        });
        tasks.push(...clientTasks);
      }

      sendJson(res, 200, tasks);
    } catch (error) {
      if (error?.isUpstream) {
        sendJson(res, 502, { error: `Upstream error: ${error.message}` });
        return;
      }
      sendJson(res, 500, { error: 'Internal server error' });
    }
  };

  return http.createServer((req, res) => {
    const url = req.url ? new URL(req.url, 'http://localhost') : null;
    const path = url?.pathname ?? '';

    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'GET' && path === '/openapi.json') {
      sendJson(res, 200, buildOpenApiSpec());
      return;
    }

    if (req.method === 'GET' && path === '/docs') {
      sendHtml(res, 200, buildDocsHtml());
      return;
    }

    if (req.method === 'GET' && path === '/tasks') {
      void handleTasksRequest(req, res, url);
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  });
};

if (require.main === module) {
  const config = loadConfig();
  const port = getPort();
  const tokenManager = createKeycloakTokenManager(config);
  const server = createServer({ config, tokenManager });

  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });

  tokenManager.getAccessToken()
    .then(() => console.log('Startup Keycloak token acquisition succeeded'))
    .catch((error) => console.error(`Startup Keycloak token acquisition failed: ${error.message}`));
}

module.exports = {
  createServer,
  getPort,
  loadConfig,
  createKeycloakTokenManager,
  createKinexoClient,
  searchKinexoClientsByRaisonSociale,
  retrieveActiveTasksForClient,
  buildOpenApiSpec,
};
