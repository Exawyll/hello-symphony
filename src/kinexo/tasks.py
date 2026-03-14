from calendar import monthrange
from datetime import date, datetime, timezone

from src.kinexo.client import KinexoClient


def _parse_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _current_month_range() -> tuple[date, date]:
    today = _today_utc()
    last_day = monthrange(today.year, today.month)[1]
    return date(today.year, today.month, 1), date(today.year, today.month, last_day)


async def _fetch_tasks_for_dossier(
    client: KinexoClient,
    dossier_id: object,
    client_name: str,
    period_start: date,
    period_end: date,
) -> list[dict]:
    if not dossier_id:
        return []

    resp = await client.get(f"/api/projets?dossierCrmId={dossier_id}&size=100&sort=id,asc")
    if resp.status_code == 204:
        return []
    if not resp.is_success:
        raise RuntimeError(
            f"Kinexo projects request failed with status {resp.status_code}: {resp.text}"
        )

    projects = resp.json().get('content', [])
    tasks = []

    for project in projects:
        project_id = project.get('id')
        if not project_id:
            continue

        resp = await client.get(f"/api/taches?projetId={project_id}&size=200&sort=id,asc")
        if resp.status_code == 204:
            continue
        if not resp.is_success:
            raise RuntimeError(
                f"Kinexo tasks request failed with status {resp.status_code}: {resp.text}"
            )

        project_label = project.get('libelle') or f"#{project_id}"

        for task in resp.json().get('content', []):
            start = _parse_date(task.get('dateDebutAuPlusTot'))
            end = _parse_date(task.get('dateFinAuPlusTard'))
            if not start or not end:
                continue

            if start <= period_end and end >= period_start:
                tasks.append({
                    'clientName': client_name,
                    'projectLabel': project_label,
                    'taskLabel': task.get('libelle') or f"#{task.get('id', 'unknown')}",
                    'statut': task.get('statut'),
                    'startDate': task.get('dateDebutAuPlusTot'),
                    'endDate': task.get('dateFinAuPlusTard'),
                    'agents': task.get('matriculesAgents') or [],
                })

    return tasks


async def retrieve_active_tasks(
    client: KinexoClient,
    dossier_id: object,
    client_name: str,
) -> list[dict]:
    today = _today_utc()
    return await _fetch_tasks_for_dossier(client, dossier_id, client_name, today, today)


async def retrieve_monthly_tasks(
    client: KinexoClient,
    dossier_id: object,
    client_name: str,
) -> list[dict]:
    month_start, month_end = _current_month_range()
    return await _fetch_tasks_for_dossier(client, dossier_id, client_name, month_start, month_end)
