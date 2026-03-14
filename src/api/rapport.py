import os

from fastapi import APIRouter, HTTPException, Request
from google.cloud import firestore

router = APIRouter(prefix='/api/rapport')


def _db(request: Request):
    return request.app.state.firestore_client


@router.get('')
def list_rapports(request: Request):
    docs = _db(request).collection('rapports_myk').list_documents()
    mois = sorted([doc.id for doc in docs], reverse=True)
    return {'mois': mois}


@router.get('/latest')
def get_latest(request: Request):
    docs = (
        _db(request)
        .collection('rapports_myk')
        .order_by('last_updated', direction=firestore.Query.DESCENDING)
        .limit(1)
        .stream()
    )
    for doc in docs:
        return doc.to_dict()
    raise HTTPException(404, 'Aucun rapport trouvé')


@router.get('/{mois}')
def get_rapport(mois: str, request: Request):
    doc = _db(request).collection('rapports_myk').document(mois).get()
    if not doc.exists:
        raise HTTPException(404, f'Rapport {mois} introuvable')
    return doc.to_dict()
