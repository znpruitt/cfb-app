import { NextResponse } from 'next/server';

import { getDefaultRankingsSeason } from '@/lib/rankings';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { requireAdminRequest } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

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

    return NextResponse.json(await loadSeasonRankings(year, { allowRefresh: bypassCache }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown rankings error';
    const status = message.includes('admin refresh required') ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
