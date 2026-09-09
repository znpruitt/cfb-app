import { NextResponse } from 'next/server';

import { buildCfbdTeamsUrl } from '@/lib/cfbd';
import { fetchUpstreamJson } from '@/lib/api/fetchUpstream';
import {
  buildTeamDatabaseFile,
  classifyTeamCatalogSync,
  type CfbdTeamRecord,
} from '@/lib/teamDatabase';
import { getTeamDatabaseFile, setTeamDatabaseFile } from '@/lib/server/teamDatabaseStore';
import { invalidateAllLeaguesStandings } from '@/lib/selectors/leagueStandings';
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

    // PLATFORM-204 — reject before the durable write, retain prior-good.
    //
    // A non-array body is a shape violation, not "no teams": coercing it to `[]`
    // (as this did) laundered schema drift into an authoritative empty commit.
    // Rejected at the fetch boundary, before building, exactly as `/api/schedule`
    // rejects a non-array partition (PLATFORM-085C).
    if (!Array.isArray(rows)) {
      return NextResponse.json(
        {
          error: 'team-database-invalid-payload',
          detail: `CFBD returned a non-array payload. The catalog was NOT changed — the existing ${previous.items.length} teams are still being served.`,
        },
        { status: 502 }
      );
    }

    const { file, summary } = buildTeamDatabaseFile({
      records: rows,
      previousItems: previous.items,
    });

    // Keyed on the BUILT item count, never the fetched row count: a nonempty
    // payload whose rows all fail normalization (CFBD renaming or dropping
    // `school`) wipes the catalog just as thoroughly as a zero-row body, and a
    // `rows.length === 0` check cannot see it.
    const classification = classifyTeamCatalogSync({
      fetchedCount: summary.fetchedCount,
      writtenCount: summary.writtenCount,
    });
    if (classification !== 'commit') {
      return NextResponse.json(
        {
          error:
            classification === 'schema-drift'
              ? 'team-database-schema-drift'
              : 'team-database-empty-replacement-rejected',
          detail:
            classification === 'schema-drift'
              ? `CFBD returned ${summary.fetchedCount} rows but none could be read as a team (schema drift). The catalog was NOT changed — the existing ${previous.items.length} teams are still being served.${summary.errors.length > 0 ? ` First rows: ${summary.errors.slice(0, 3).join('; ')}` : ''}`
              : `CFBD returned 0 teams. The catalog was NOT changed — the existing ${previous.items.length} teams are still being served.`,
          // `summary` rides along for anyone reading the raw response, but the
          // per-row normalization reasons are also folded into `detail` above:
          // the client (`syncTeamDatabase`) discards the payload on a non-ok and
          // keeps only `detail`, so diagnostics left solely in `summary.errors`
          // never reach the operator on the one failure this guard exists for.
          summary,
        },
        { status: 502 }
      );
    }

    await setTeamDatabaseFile(file);

    // A resynced catalog can change team identity, canonical IDs, derived
    // alts/aliases, and FBS/FCS classification — all consumed by canonical
    // standings via getTeamDatabaseItems(). Bust every league's cached snapshot
    // (shared ALL_STANDINGS_TAG) so warm standings recompute against the new
    // catalog instead of the stale pre-sync one. Team-database data is global,
    // so no year scoping applies.
    invalidateAllLeaguesStandings();

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
