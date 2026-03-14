from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from src.kinexo.search import fetch_all_clients
from src.kinexo.tasks import retrieve_monthly_tasks

router = APIRouter()

_CLIENT_FIELDS = ('raisonSociale', 'dossierId', 'numeroDossier', 'ville', 'codePostal')


def _serialize(c: dict) -> dict:
    return {
        'raison_sociale': c.get('raisonSociale'),
        'dossier_id': c.get('dossierId'),
        'numero_dossier': c.get('numeroDossier'),
        'ville': c.get('ville'),
        'code_postal': c.get('codePostal'),
    }


@router.get('/clients', response_model=None)
async def get_clients(
    request: Request,
    q: str = Query('', description='Filter by raison sociale (partial match)'),
):
    kinexo = request.app.state.kinexo_client

    try:
        all_clients = await fetch_all_clients(kinexo)
    except RuntimeError as exc:
        return JSONResponse({'error': f'Upstream error: {exc}'}, status_code=502)

    normalized = q.strip().lower()
    if normalized:
        all_clients = [
            c for c in all_clients
            if normalized in (c.get('raisonSociale') or '').lower()
        ]

    return [_serialize(c) for c in all_clients]


@router.get('/clients/{dossier_id}/tasks', response_model=None)
async def get_client_tasks(request: Request, dossier_id: str):
    kinexo = request.app.state.kinexo_client

    # Resolve client name from dossier_id
    try:
        all_clients = await fetch_all_clients(kinexo)
    except RuntimeError as exc:
        return JSONResponse({'error': f'Upstream error: {exc}'}, status_code=502)

    client_name = next(
        (c.get('raisonSociale', '') for c in all_clients if c.get('dossierId') == dossier_id),
        dossier_id,
    )

    try:
        tasks = await retrieve_monthly_tasks(kinexo, dossier_id, client_name)
    except RuntimeError as exc:
        return JSONResponse({'error': f'Upstream error: {exc}'}, status_code=502)

    return tasks
