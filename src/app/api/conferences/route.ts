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

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ConferencesResponse = {
  items: CfbdConferenceRecord[];
  meta: {
    source: 'cfbd_live' | 'cache' | 'local_snapshot';
    generatedAt: string;
    fallbackUsed: boolean;
  };
};

let cache: { at: number; items: CfbdConferenceRecord[] } | null = null;

function parseBooleanQueryParam(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function GET(req: Request) {
  recordRouteRequest('conferences');

  const url = new URL(req.url);
  const bypassCache = parseBooleanQueryParam(url.searchParams.get('bypassCache'));
  if (!bypassCache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    recordRouteCacheHit('conferences');
    return NextResponse.json<ConferencesResponse>({
      items: cache.items,
      meta: {
        source: 'cache',
        generatedAt: new Date(cache.at).toISOString(),
        fallbackUsed: false,
      },
    });
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

    cache = { at: Date.now(), items: Array.isArray(items) ? items : [] };

    return NextResponse.json<ConferencesResponse>({
      items: cache.items,
      meta: {
        source: 'cfbd_live',
        generatedAt: new Date(cache.at).toISOString(),
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
