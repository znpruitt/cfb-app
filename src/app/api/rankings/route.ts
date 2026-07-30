import { NextResponse } from 'next/server';

import { getDefaultRankingsSeason } from '@/lib/rankings';
import { refreshSeasonRankings } from '@/lib/rankings/refreshAuthority';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { requireAdminRequest } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

/**
 * Thin adapter (PLATFORM-086E2A): public reads are strictly cache-only via
 * `loadSeasonRankings`; the authorized `bypassCache` path drives the shared
 * refresh authority and translates its typed result — never re-deriving outcome
 * truth from exceptions. Error bodies stay on the closed secret-free reason
 * vocabulary; provider payloads, URLs, credentials, and stacks never surface.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const bypassCache =
    (url.searchParams.get('bypassCache') ?? '').trim().toLowerCase() === '1' ||
    (url.searchParams.get('bypassCache') ?? '').trim().toLowerCase() === 'true';

  let year = getDefaultRankingsSeason(null);
  if (yearParam !== null) {
    const parsed = parseNonNegativeInt(yearParam);
    const maxYear = new Date().getUTCFullYear() + 1;
    if (parsed == null || parsed < 2000 || parsed > maxYear) {
      return NextResponse.json(
        { error: `year must be an integer between 2000 and ${maxYear}`, field: 'year' },
        { status: 400 }
      );
    }
    year = parsed;
  }

  try {
    const authFailure = await requireAdminRequest(req);
    if (bypassCache && authFailure) return authFailure;

    if (bypassCache) {
      const result = await refreshSeasonRankings({ year, trigger: 'manual' });
      if (result.reason === 'refresh-in-progress') {
        return NextResponse.json({ error: 'rankings-refresh-in-progress' }, { status: 409 });
      }
      if (result.response) {
        return NextResponse.json(result.response, { status: result.httpStatus });
      }
      return NextResponse.json({ error: result.reason }, { status: result.httpStatus });
    }

    return NextResponse.json(await loadSeasonRankings(year));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown rankings error';
    const status = message.includes('admin refresh required') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
