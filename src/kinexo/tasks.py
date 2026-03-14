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


async def retrieve_active_tasks(
    client: KinexoClient,
    dossier_id: object,
    client_name: str,
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
    today = _today_utc()
    active_tasks = []

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

            if start <= today <= end:
                active_tasks.append({
                    'clientName': client_name,
                    'projectLabel': project_label,
                    'taskLabel': task.get('libelle') or f"#{task.get('id', 'unknown')}",
                    'statut': task.get('statut'),
                    'startDate': task.get('dateDebutAuPlusTot'),
                    'endDate': task.get('dateFinAuPlusTard'),
                    'agents': task.get('matriculesAgents') or [],
                })

    return active_tasks
