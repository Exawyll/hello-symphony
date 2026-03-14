'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const swaggerUiDist = require('swagger-ui-dist');

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

const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

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

const parseBooleanEnv = (value) => {
  if (typeof value !== 'string') {
    return false;
  }
  return BOOLEAN_TRUE_VALUES.has(value.trim().toLowerCase());
};

const isSwaggerEnabled = (env = process.env) => {
  if (typeof env.SWAGGER_ENABLED === 'string') {
    return parseBooleanEnv(env.SWAGGER_ENABLED);
  }
  return String(env.ENV || '').toLowerCase() !== 'production';
};

const getSwaggerUiRoot = () => {
  if (typeof swaggerUiDist.getAbsoluteFSPath === 'function') {
    return swaggerUiDist.getAbsoluteFSPath();
  }
  if (typeof swaggerUiDist.absolutePath === 'function') {
    return swaggerUiDist.absolutePath();
  }
  if (typeof swaggerUiDist.absolutePath === 'string') {
    return swaggerUiDist.absolutePath;
  }
  if (typeof swaggerUiDist === 'string') {
    return swaggerUiDist;
  }
  throw new Error('Unable to locate swagger-ui-dist assets path');
};

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

const searchKinexoClientsByRaisonSociale = async (
  kinexoClient,
  searchTerm
) => {
  const normalizedTerm = String(searchTerm ?? '').toLowerCase();
  const matches = [];
  let page = 0;
  let last = false;

  while (!last) {
    const payload = await withTimeout(
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
          throw error;
        }

        return parseJsonBody(
          bodyText,
          'Kinexo clients response was not valid JSON'
        );
      },
      CLIENTS_REQUEST_TIMEOUT_MS,
      `Kinexo clients request timed out after ${CLIENTS_REQUEST_TIMEOUT_MS}ms`
    );

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

  const projects = await withTimeout(
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
        throw error;
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

  const today = getUtcTodayDate();
  const activeTasks = [];

  for (const project of projects) {
    const projectId = project?.id;
    if (!projectId) {
      continue;
    }

    const tasks = await withTimeout(
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
          throw error;
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

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const sendNotFound = (res) => {
  sendJson(res, 404, { error: 'Not Found' });
};

const getContentType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
};

const buildSwaggerIndexHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API Docs - Swagger UI</title>
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
    <link rel="icon" type="image/png" href="/docs/favicon-32x32.png" sizes="32x32" />
    <link rel="icon" type="image/png" href="/docs/favicon-16x16.png" sizes="16x16" />
    <style>
      body { margin: 0; background: #fafafa; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js" charset="UTF-8"></script>
    <script src="/docs/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout"
      });
    </script>
  </body>
</html>
`;

const buildOpenApiSpec = (config) => {
  const productionBaseUrl = 'https://production.kinexo.fr';
  const apiBaseUrl = config?.apiBaseUrl || productionBaseUrl;
  const serverEntries = [
    {
      url: '/',
      description: 'Current service base URL',
    },
    {
      url: apiBaseUrl,
      description: 'Configured API_BASE_URL (Kinexo upstream)',
    },
  ];
  if (apiBaseUrl !== productionBaseUrl) {
    serverEntries.push({
      url: productionBaseUrl,
      description: 'Production Kinexo API base URL',
    });
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Kinexo Tasks API Gateway',
      version: '1.0.0',
      summary: 'Explore Kinexo tasks and health endpoints.',
      description:
        'HTTP service exposing health checks and Kinexo task search for active client work.',
    },
    servers: serverEntries,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Keycloak access token for Kinexo APIs.',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'string',
              description: 'Human-readable error message.',
            },
          },
        },
        HealthResponse: {
          type: 'object',
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              example: 'ok',
            },
          },
        },
        Task: {
          type: 'object',
          required: [
            'clientName',
            'projectLabel',
            'taskLabel',
            'statut',
            'startDate',
            'endDate',
            'agents',
          ],
          properties: {
            clientName: {
              type: 'string',
              description: 'Client display name from Kinexo.',
            },
            projectLabel: {
              type: 'string',
              description: 'Project label associated with the task.',
            },
            taskLabel: {
              type: 'string',
              description: 'Task label from Kinexo.',
            },
            statut: {
              type: 'string',
              nullable: true,
              description: 'Task status returned by Kinexo.',
            },
            startDate: {
              type: 'string',
              format: 'date',
              description: 'ISO date for the task start window.',
            },
            endDate: {
              type: 'string',
              format: 'date',
              description: 'ISO date for the task end window.',
            },
            agents: {
              type: 'array',
              items: { type: 'string' },
              description: 'Agent identifiers assigned to the task.',
            },
          },
        },
        TasksResponse: {
          type: 'object',
          required: ['query', 'count', 'tasks'],
          properties: {
            query: {
              type: 'string',
              description: 'Search term used for client lookup.',
            },
            count: {
              type: 'integer',
              description: 'Number of tasks returned.',
            },
            tasks: {
              type: 'array',
              items: { $ref: '#/components/schemas/Task' },
            },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          description:
            'Returns a simple status payload confirming the service is online.',
          responses: {
            200: {
              description: 'Service is healthy.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                  examples: {
                    ok: { value: { status: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
      '/tasks': {
        get: {
          summary: 'Search active Kinexo tasks by client name',
          description:
            'Searches Kinexo clients by raison sociale and returns active tasks for matching clients.',
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Search term for client raison sociale.',
              schema: { type: 'string' },
              example: 'acme',
            },
          ],
          responses: {
            200: {
              description: 'Active tasks for matching clients.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TasksResponse' },
                  examples: {
                    sample: {
                      value: {
                        query: 'acme',
                        count: 1,
                        tasks: [
                          {
                            clientName: 'ACME Corporation',
                            projectLabel: 'Onboarding',
                            taskLabel: 'Kickoff meeting',
                            statut: 'EN_COURS',
                            startDate: '2026-03-01',
                            endDate: '2026-03-31',
                            agents: ['A123', 'B456'],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
            400: {
              description: 'Missing or invalid query parameter.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                  examples: {
                    missingQuery: {
                      value: { error: 'Missing required query parameter: q' },
                    },
                  },
                },
              },
            },
            502: {
              description: 'Upstream Kinexo request failed.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            504: {
              description: 'Upstream Kinexo request timed out.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
    },
  };
};

const createServer = ({
  config,
  tokenManager,
  swaggerEnabled = isSwaggerEnabled(),
} = {}) => {
  const swaggerUiRoot = swaggerEnabled ? getSwaggerUiRoot() : null;
  const kinexoClient =
    config && tokenManager ? createKinexoClient(config, tokenManager) : null;

  const serveSwaggerAsset = async (res, assetPath) => {
    if (!swaggerUiRoot) {
      sendNotFound(res);
      return;
    }

    const normalized = path.normalize(assetPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolutePath = path.join(swaggerUiRoot, normalized);
    if (!absolutePath.startsWith(swaggerUiRoot)) {
      sendNotFound(res);
      return;
    }

    try {
      const data = await fs.promises.readFile(absolutePath);
      res.writeHead(200, { 'Content-Type': getContentType(absolutePath) });
      res.end(data);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        sendNotFound(res);
        return;
      }
      sendJson(res, 500, { error: 'Failed to load Swagger UI asset' });
    }
  };

  const handleTasksRequest = async (res, searchTerm) => {
    if (!kinexoClient) {
      sendJson(res, 500, { error: 'Server configuration missing' });
      return;
    }

    if (!searchTerm || !searchTerm.trim()) {
      sendJson(res, 400, { error: 'Missing required query parameter: q' });
      return;
    }

    try {
      const matches = await searchKinexoClientsByRaisonSociale(
        kinexoClient,
        searchTerm.trim()
      );

      const tasks = [];
      for (const match of matches) {
        const clientTasks = await retrieveActiveTasksForClient(kinexoClient, {
          dossierId: match.dossierId,
          clientName: match.raisonSociale,
        });
        tasks.push(...clientTasks);
      }

      sendJson(res, 200, {
        query: searchTerm.trim(),
        count: tasks.length,
        tasks,
      });
    } catch (error) {
      const message = error?.message || 'Upstream request failed';
      if (message.toLowerCase().includes('timed out')) {
        sendJson(res, 504, { error: message });
        return;
      }
      sendJson(res, 502, { error: message });
    }
  };

  const handleRequest = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const requestPath = url.pathname;

    if (req.method === 'GET' && requestPath === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (req.method === 'GET' && requestPath === '/tasks') {
      await handleTasksRequest(res, url.searchParams.get('q'));
      return;
    }

    if (req.method === 'GET' && requestPath === '/openapi.json') {
      if (!swaggerEnabled) {
        sendNotFound(res);
        return;
      }
      sendJson(res, 200, buildOpenApiSpec(config));
      return;
    }

    if (req.method === 'GET' && (requestPath === '/docs' || requestPath === '/docs/')) {
      if (!swaggerEnabled) {
        sendNotFound(res);
        return;
      }
      const html = buildSwaggerIndexHtml();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && requestPath.startsWith('/docs/')) {
      if (!swaggerEnabled) {
        sendNotFound(res);
        return;
      }
      await serveSwaggerAsset(res, requestPath.replace('/docs/', ''));
      return;
    }

    sendNotFound(res);
  };

  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error('Request handling failed:', error);
      sendJson(res, 500, { error: 'Internal Server Error' });
    });
  });
};

if (require.main === module) {
  const config = loadConfig();
  const port = getPort();
  const tokenManager = createKeycloakTokenManager(config);
  const server = createServer({
    config,
    tokenManager,
    swaggerEnabled: isSwaggerEnabled(),
  });

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
  isSwaggerEnabled,
  createKeycloakTokenManager,
  createKinexoClient,
  searchKinexoClientsByRaisonSociale,
  retrieveActiveTasksForClient,
};
