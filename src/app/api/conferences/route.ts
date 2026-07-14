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
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';
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

/**
 * A conference record is usable only if it carries a conference identity — a
 * non-empty `name` (the field downstream classification/lookup keys on). A
 * malformed row with no name is not a usable conference, so a payload of only
 * such rows is schema drift, not authoritative absence.
 */
function isUsableConferenceRecord(record: CfbdConferenceRecord | null | undefined): boolean {
  return !!record && typeof record.name === 'string' && record.name.trim().length > 0;
}

/**
 * The bundled-snapshot fallback response. `fallbackUsed: true` / `source:
 * 'local_snapshot'` makes the shared admin interpreter report the refresh as a
 * failure (not "Refresh complete") while prior-good/bundled data still serves.
 */
function conferencesFallbackResponse(): Response {
  return NextResponse.json<ConferencesResponse>({
    items: CONFERENCES_SNAPSHOT,
    meta: {
      source: 'local_snapshot',
      generatedAt: new Date().toISOString(),
      fallbackUsed: true,
    },
  });
}

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

  // Provider-refresh observability (PLATFORM-086A): begin the attempt BEFORE
  // credential validation, so a missing-key early return still resolves a
  // recorded failed attempt instead of leaving the panel with no evidence the
  // refresh was tried (rereview finding #5). Reaching here is always an
  // authorized refresh (bypassCache requires admin; non-admin cache misses
  // returned above).
  const attempt = await beginProviderRefreshAttempt('conferences', {
    startedAt: new Date().toISOString(),
  });

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    // Missing credential: record the failed attempt (prior-good durable snapshot
    // is preserved by the failure helper) and degrade to the bundled snapshot.
    await recordProviderRefreshFailure('conferences', {
      attempt,
      error: 'CFBD_API_KEY missing',
      code: 'cfbd-api-key-missing',
    });
    return conferencesFallbackResponse();
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

    // Classify the raw provider payload BEFORE any durable write (final-truthfulness
    // remediation finding #3). Conference reference data does not legitimately
    // disappear, so an empty/malformed response is uncertainty (a failure), never an
    // authoritative zero-row commit that would clear prior-good conferences and read
    // as "Refresh complete." A read failure / rejection retains prior-good (the
    // failure helper preserves last-success/source/rows) and degrades to the bundled
    // snapshot, which `interpretRefreshResponse` reports as a failed refresh.
    if (!Array.isArray(items)) {
      await recordProviderRefreshFailure('conferences', {
        attempt,
        error: 'CFBD conferences response was not an array',
        code: 'conferences-invalid-payload',
      });
      return conferencesFallbackResponse();
    }
    const usableItems = items.filter(isUsableConferenceRecord);
    if (usableItems.length === 0) {
      await recordProviderRefreshFailure('conferences', {
        attempt,
        error:
          items.length === 0
            ? 'CFBD conferences response was empty'
            : `CFBD conferences response normalized to zero usable rows (${items.length} raw)`,
        code: 'conferences-no-usable-rows',
      });
      return conferencesFallbackResponse();
    }

    const nextCache = { at: Date.now(), items };
    // Durable-first commit order (PLATFORM-085A): persist the provider-derived
    // conferences snapshot before publishing it to the process cache, so a
    // failed durable write can't leave this instance serving a "fresh" snapshot
    // no other instance can durably reproduce.
    await setAppState('conferences', 'snapshot', nextCache);
    // Durable commit time + sequence for success ordering (rereview findings #3/#6).
    const committedAt = new Date().toISOString();
    const commitSeq = nextProviderCommitSeq();
    setConferencesRouteCache(nextCache);

    await recordProviderRefreshSuccess('conferences', {
      attempt,
      committedAt,
      commitSeq,
      source: 'cfbd_live',
      rowsCommitted: nextCache.items.length,
    });

    return NextResponse.json<ConferencesResponse>({
      items: nextCache.items,
      meta: {
        source: 'cfbd_live',
        generatedAt: new Date(nextCache.at).toISOString(),
        fallbackUsed: false,
      },
    });
  } catch (error) {
    // The response gracefully degrades to the bundled snapshot, but the LIVE
    // refresh did fail — record it so operators can see conferences is not
    // refreshing from the provider (prior-good durable snapshot is retained).
    await recordProviderRefreshFailure('conferences', {
      attempt,
      error: error instanceof Error ? error.message : 'conferences refresh failed',
    });
    return conferencesFallbackResponse();
  }
}
