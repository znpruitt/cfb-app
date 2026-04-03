import { NextResponse } from 'next/server';

import { CONFERENCES_SNAPSHOT } from '@/data/conferencesSnapshot';
import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildCfbdConferencesUrl } from '@/lib/cfbd';
import type { CfbdConferenceRecord } from '@/lib/conferenceSubdivision';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '@/lib/server/apiUsageBudget';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getConferencesRouteCache, setConferencesRouteCache } from './cache';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ConferencesResponse = {
  items: CfbdConferenceRecord[];
  meta: {
    source: 'cfbd_live' | 'cache' | 'local_snapshot';
    generatedAt: string;
    fallbackUsed: boolean;
    stale?: boolean;
    rebuildRequired?: boolean;
  };
};

function parseBooleanQueryParam(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function GET(req: Request) {
  recordRouteRequest('conferences');

  const url = new URL(req.url);
  const bypassCache = parseBooleanQueryParam(url.searchParams.get('bypassCache'));
  const adminAuthFailure = await requireAdminRequest(req);
  const isAdmin = !adminAuthFailure;
  if (bypassCache && adminAuthFailure) return adminAuthFailure;

  const inMemoryCache = getConferencesRouteCache();
  if (!bypassCache && inMemoryCache && Date.now() - inMemoryCache.at < CACHE_TTL_MS) {
    recordRouteCacheHit('conferences');
    return NextResponse.json<ConferencesResponse>({
      items: inMemoryCache.items,
      meta: {
        source: 'cache',
        generatedAt: new Date(inMemoryCache.at).toISOString(),
        fallbackUsed: false,
      },
    });
  }

  const stored = await getAppState<{ at: number; items: CfbdConferenceRecord[] }>(
    'conferences',
    'snapshot'
  );
  if (!bypassCache && stored?.value && Date.now() - stored.value.at < CACHE_TTL_MS) {
    setConferencesRouteCache(stored.value);
    recordRouteCacheHit('conferences');
    return NextResponse.json<ConferencesResponse>({
      items: stored.value.items,
      meta: {
        source: 'cache',
        generatedAt: new Date(stored.value.at).toISOString(),
        fallbackUsed: false,
      },
    });
  }

  if (!bypassCache && !isAdmin) {
    if (stored?.value) {
      setConferencesRouteCache(stored.value);
      recordRouteCacheHit('conferences');
      return NextResponse.json<ConferencesResponse>({
        items: stored.value.items,
        meta: {
          source: 'cache',
          generatedAt: new Date(stored.value.at).toISOString(),
          fallbackUsed: false,
          stale: true,
          rebuildRequired: true,
        },
      });
    }
    return NextResponse.json(
      {
        error:
          'conferences cache miss: admin refresh required (retry with bypassCache=1 and admin token)',
      },
      { status: 503 }
    );
  }

  recordRouteCacheMiss('conferences');

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    return NextResponse.json<ConferencesResponse>({
      items: CONFERENCES_SNAPSHOT,
      meta: {
        source: 'local_snapshot',
        generatedAt: new Date().toISOString(),
        fallbackUsed: true,
      },
    });
  }

  try {
    const items = await fetchUpstreamJson<CfbdConferenceRecord[]>(
      buildCfbdConferencesUrl().toString(),
      {
        cache: 'no-store',
        timeoutMs: 12_000,
        headers: { Authorization: `Bearer ${cfbdApiKey}` },
      }
    );

    const nextCache = { at: Date.now(), items: Array.isArray(items) ? items : [] };
    setConferencesRouteCache(nextCache);
    await setAppState('conferences', 'snapshot', nextCache);

    return NextResponse.json<ConferencesResponse>({
      items: nextCache.items,
      meta: {
        source: 'cfbd_live',
        generatedAt: new Date(nextCache.at).toISOString(),
        fallbackUsed: false,
      },
    });
  } catch {
    return NextResponse.json<ConferencesResponse>({
      items: CONFERENCES_SNAPSHOT,
      meta: {
        source: 'local_snapshot',
        generatedAt: new Date().toISOString(),
        fallbackUsed: true,
      },
    });
  }
}
