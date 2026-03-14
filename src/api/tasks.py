from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from src.kinexo.search import search_clients_by_raison_sociale
from src.kinexo.tasks import retrieve_active_tasks

router = APIRouter()


@router.get('/tasks', response_model=None)
async def get_tasks(
    request: Request,
    q: str = Query(..., description='Company name search term (partial match on raison sociale)'),
):
    if not q.strip():
        return JSONResponse({'error': 'Missing required query parameter: q'}, status_code=400)

    kinexo = request.app.state.kinexo_client

    try:
        clients = await search_clients_by_raison_sociale(kinexo, q.strip())
    except RuntimeError as exc:
        return JSONResponse({'error': f'Upstream error: {exc}'}, status_code=502)

    if not clients:
        return JSONResponse(
            {'error': f'No client found matching: {q.strip()}'}, status_code=404
        )

    all_tasks: list[dict] = []
    try:
        for c in clients:
            tasks = await retrieve_active_tasks(kinexo, c['dossier_id'], c['raison_sociale'])
            all_tasks.extend(tasks)
    except RuntimeError as exc:
        return JSONResponse({'error': f'Upstream error: {exc}'}, status_code=502)

    return all_tasks
