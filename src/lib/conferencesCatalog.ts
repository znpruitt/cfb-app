import { requireAdminAuthHeaders } from './adminAuth.ts';
import type { CfbdConferenceRecord } from './conferenceSubdivision.ts';

type ConferencesWireResponse = {
  items?: CfbdConferenceRecord[];
};

export async function fetchConferencesCatalog(options?: {
  bypassCache?: boolean;
}): Promise<CfbdConferenceRecord[]> {
  const searchParams = new URLSearchParams();
  if (options?.bypassCache) searchParams.set('bypassCache', '1');
  const query = searchParams.toString();
  const path = query ? `/api/conferences?${query}` : '/api/conferences';

  const response = await fetch(path, {
    cache: 'no-store',
    headers: options?.bypassCache ? requireAdminAuthHeaders() : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`conferences ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as ConferencesWireResponse;
  return Array.isArray(payload.items) ? payload.items : [];
}
