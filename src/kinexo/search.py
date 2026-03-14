from src.kinexo.client import KinexoClient

PAGE_SIZE = 100


async def search_clients_by_raison_sociale(client: KinexoClient, term: str) -> list[dict]:
    normalized = term.strip().lower()
    matches = []
    page = 0

    while True:
        resp = await client.get(
            f"/api/clients?size={PAGE_SIZE}&page={page}&sort=raisonSociale,asc"
        )
        if not resp.is_success:
            raise RuntimeError(
                f"Kinexo clients request failed with status {resp.status_code}: {resp.text}"
            )

        payload = resp.json()
        for c in payload.get('content', []):
            raison = c.get('raisonSociale', '')
            if isinstance(raison, str) and normalized in raison.lower():
                matches.append({
                    'raison_sociale': raison,
                    'dossier_id': c.get('dossierId'),
                })

        if payload.get('last', True):
            break
        page += 1

    return matches
