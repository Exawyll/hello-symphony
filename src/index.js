'use strict';

const http = require('http');

const PORT = process.env.PORT || 3000;

const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mini Dashboard d'Activité</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #1a1b25;
        --muted: #5a5f73;
        --surface: #ffffff;
        --surface-2: #f4f1ec;
        --accent: #e36f4a;
        --accent-2: #2d7fa7;
        --success: #1f8a5b;
        --warning: #e0a12d;
        --danger: #d55656;
        --shadow: 0 20px 45px rgba(26, 27, 37, 0.12);
        --radius: 18px;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Avenir Next", "Gill Sans", "Trebuchet MS", sans-serif;
        color: var(--ink);
        background: radial-gradient(circle at 10% 10%, #f9e7db 0%, #f9e7db 20%, transparent 45%),
          radial-gradient(circle at 85% 15%, #d8ecf4 0%, #d8ecf4 25%, transparent 50%),
          linear-gradient(135deg, #faf7f2 0%, #f5f1eb 60%, #eef2f5 100%);
        min-height: 100vh;
      }

      .page {
        max-width: 1100px;
        margin: 0 auto;
        padding: 40px 24px 60px;
      }

      header {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        align-items: flex-end;
        justify-content: space-between;
        margin-bottom: 32px;
      }

      h1 {
        font-family: "Iowan Old Style", "Palatino", "Book Antiqua", serif;
        font-size: clamp(28px, 4vw, 40px);
        margin: 0 0 6px;
        letter-spacing: -0.5px;
      }

      .subtitle {
        color: var(--muted);
        margin: 0;
        font-size: 15px;
      }

      .pulse {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: 999px;
        background: var(--surface);
        box-shadow: var(--shadow);
        font-size: 13px;
        color: var(--muted);
      }

      .pulse::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 8px rgba(227, 111, 74, 0.6);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
        margin-bottom: 28px;
      }

      .card {
        background: var(--surface);
        border-radius: var(--radius);
        padding: 20px 22px;
        box-shadow: var(--shadow);
        position: relative;
        overflow: hidden;
      }

      .card::after {
        content: "";
        position: absolute;
        inset: auto -30% -40% auto;
        width: 180px;
        height: 180px;
        border-radius: 50%;
        background: rgba(227, 111, 74, 0.12);
      }

      .metric-value {
        font-size: 28px;
        font-weight: 700;
        margin: 0 0 4px;
      }

      .metric-label {
        margin: 0 0 14px;
        color: var(--muted);
        font-size: 14px;
      }

      .trend {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        padding: 6px 10px;
        border-radius: 999px;
      }

      .trend.up {
        color: var(--success);
        background: rgba(31, 138, 91, 0.12);
      }

      .trend.down {
        color: var(--danger);
        background: rgba(213, 86, 86, 0.12);
      }

      .trend.steady {
        color: var(--accent-2);
        background: rgba(45, 127, 167, 0.12);
      }

      .tasks {
        background: var(--surface);
        border-radius: var(--radius);
        padding: 22px;
        box-shadow: var(--shadow);
      }

      .tasks h2 {
        font-family: "Iowan Old Style", "Palatino", "Book Antiqua", serif;
        margin: 0 0 16px;
        font-size: 22px;
      }

      .task {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
        border-bottom: 1px solid #efe9e1;
        gap: 16px;
      }

      .task:last-child {
        border-bottom: none;
      }

      .task-title {
        font-weight: 600;
        margin-bottom: 4px;
      }

      .task-meta {
        font-size: 13px;
        color: var(--muted);
      }

      .status {
        font-size: 12px;
        font-weight: 700;
        padding: 6px 10px;
        border-radius: 999px;
        text-transform: uppercase;
        letter-spacing: 0.6px;
      }

      .status.todo {
        background: rgba(224, 161, 45, 0.18);
        color: #9a6d14;
      }

      .status.progress {
        background: rgba(45, 127, 167, 0.15);
        color: #1f5b77;
      }

      .status.blocked {
        background: rgba(213, 86, 86, 0.15);
        color: #9e3434;
      }

      .status.done {
        background: rgba(31, 138, 91, 0.15);
        color: #1a6a47;
      }

      .mock {
        margin-top: 18px;
        color: var(--muted);
        font-size: 12px;
      }

      @media (max-width: 900px) {
        .grid {
          grid-template-columns: 1fr;
        }

        header {
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header>
        <div>
          <h1>Tableau de bord express</h1>
          <p class="subtitle">Vue rapide de votre activité sans changer de page.</p>
        </div>
        <div class="pulse">Synchronisé il y a 2 min</div>
      </header>

      <section id="metrics" class="grid" aria-label="Métriques clés"></section>

      <section class="tasks" aria-label="Tâches récentes">
        <h2>Vos tâches récentes</h2>
        <div id="tasks"></div>
        <div class="mock">Données mockées en JavaScript — aucune API externe.</div>
      </section>
    </div>

    <script>
      const metrics = [
        { value: "14", label: "Tâches clôturées", trend: "up", delta: "+12% cette semaine" },
        { value: "3h 18", label: "Temps de focus", trend: "steady", delta: "+5% vs hier" },
        { value: "2", label: "Blocages actifs", trend: "down", delta: "-1 depuis lundi" }
      ];

      const tasks = [
        { title: "Préparer la démo client", meta: "Échéance: aujourd'hui 16h", status: "progress", label: "En cours" },
        { title: "Mettre à jour le backlog", meta: "Échéance: demain", status: "todo", label: "À faire" },
        { title: "Corriger la pagination", meta: "Bloqué par QA", status: "blocked", label: "Bloquée" },
        { title: "Envoyer le compte-rendu", meta: "Terminé ce matin", status: "done", label: "Terminé" }
      ];

      const metricsRoot = document.getElementById("metrics");
      const tasksRoot = document.getElementById("tasks");

      metricsRoot.innerHTML = metrics
        .map(
          (metric) =>
            '<article class="card">' +
            '<div class="metric-value">' +
            metric.value +
            '</div>' +
            '<div class="metric-label">' +
            metric.label +
            '</div>' +
            '<div class="trend ' +
            metric.trend +
            '">' +
            '<span>' +
            (metric.trend === "up" ? "▲" : metric.trend === "down" ? "▼" : "●") +
            '</span>' +
            '<span>' +
            metric.delta +
            '</span>' +
            '</div>' +
            '</article>'
        )
        .join("");

      tasksRoot.innerHTML = tasks
        .map(
          (task) =>
            '<div class="task">' +
            '<div>' +
            '<div class="task-title">' +
            task.title +
            '</div>' +
            '<div class="task-meta">' +
            task.meta +
            '</div>' +
            '</div>' +
            '<div class="status ' +
            task.status +
            '">' +
            task.label +
            '</div>' +
            '</div>'
        )
        .join("");
    </script>
  </body>
</html>
`;

const createServer = () =>
  http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
    });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
  });

const renderHtml = () => html;

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

module.exports = { createServer, renderHtml };
