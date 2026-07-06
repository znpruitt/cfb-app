import { NextResponse } from 'next/server';

import { buildCfbdTeamsUrl } from '@/lib/cfbd';
import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import { buildTeamDatabaseFile, type CfbdTeamRecord } from '@/lib/teamDatabase';
import { getTeamDatabaseFile, setTeamDatabaseFile } from '@/lib/server/teamDatabaseStore';
import { invalidateAllLeaguesStandings } from '@/lib/selectors/leagueStandings';
import { getLeagues } from '@/lib/leagueRegistry';
import { requireAdminRequest } from '@/lib/server/adminAuth';

export async function POST(req: Request): Promise<NextResponse> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure)
    return NextResponse.json({ error: 'admin-authorization-required' }, { status: 401 });

  const apiKey = process.env.CFBD_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'team-database-sync-misconfigured',
        detail: 'Missing CFBD_API_KEY',
      },
      { status: 500 }
    );
  }

  try {
    const previous = await getTeamDatabaseFile();
    const rows = await fetchUpstreamJson<CfbdTeamRecord[]>(buildCfbdTeamsUrl().toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      timeoutMs: 15_000,
      retry: { maxAttempts: 2, baseDelayMs: 300 },
      pacing: { key: 'cfbd-teams', minIntervalMs: 250 },
    });

    const { file, summary } = buildTeamDatabaseFile({
      records: Array.isArray(rows) ? rows : [],
      previousItems: previous.items,
    });

    // Read the registry snapshot BEFORE persisting the catalog so a registry-read
    // failure aborts before the write rather than stranding a persisted catalog
    // with a stale standings cache.
    const leagues = await getLeagues();
    await setTeamDatabaseFile(file);

    // A resynced catalog can change team identity, canonical IDs, derived
    // alts/aliases, and FBS/FCS classification — all consumed by canonical
    // standings via getTeamDatabaseItems(). Bust every league's cached snapshot
    // so warm standings recompute against the new catalog instead of the stale
    // pre-sync one. Team-database data is global, so no year scoping applies.
    await invalidateAllLeaguesStandings(leagues);

    return NextResponse.json(
      {
        ok: true,
        summary,
        source: file.source,
        updatedAt: file.updatedAt,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: 'team-database-sync-failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
