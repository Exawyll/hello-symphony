from src.kinexo.client import KinexoClient

PAGE_SIZE = 100


async def fetch_all_clients(client: KinexoClient) -> list[dict]:
    results = []
    page = 0

    while True:
        resp = await client.get(
            f'/api/clients?size={PAGE_SIZE}&page={page}&sort=raisonSociale,asc'
        )
        if not resp.is_success:
            raise RuntimeError(
                f'Kinexo clients request failed with status {resp.status_code}: {resp.text}'
            )

        payload = resp.json()
        results.extend(payload.get('content', []))

        if payload.get('last', True):
            break
        page += 1

    return results


async def search_clients_by_raison_sociale(client: KinexoClient, term: str) -> list[dict]:
    normalized = term.strip().lower()
    all_clients = await fetch_all_clients(client)

    return [
        {
            'raison_sociale': c.get('raisonSociale'),
            'dossier_id': c.get('dossierId'),
        }
        for c in all_clients
        if normalized in (c.get('raisonSociale') or '').lower()
    ]
