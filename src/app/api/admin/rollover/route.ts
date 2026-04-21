import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeagues, updateLeagueStatus } from '@/lib/leagueRegistry';
import { sanitizeLeagues } from '@/lib/leagueSanitize';
import { getSeasonArchive, saveSeasonArchive, diffSeasonArchives } from '@/lib/seasonArchive';
import { isSeasonComplete, buildSeasonArchive } from '@/lib/seasonRollover';
import type { League } from '@/lib/league';

// Test league is excluded from global rollover — it has its own independent lifecycle controls
const TEST_LEAGUE_SLUG = 'test';

// GET — season completion status and platform year, admin-gated
export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const allLeagues = await getLeagues();
  // Exclude test league from global rollover
  const leagues = allLeagues.filter((l) => l.slug !== TEST_LEAGUE_SLUG);
  // All non-test leagues are assumed to be on the same year (global rollover model)
  const currentYear = leagues[0]?.year ?? new Date().getUTCFullYear();
  const seasonComplete = await isSeasonComplete(currentYear);

  return Response.json({ seasonComplete, currentYear, leagues: sanitizeLeagues(leagues) });
}

type PostBody = { confirmed?: boolean };

type TopStandingEntry = {
  position: number;
  owner: string;
  wins: number;
  losses: number;
  ties: number;
};

type LeaguePreview = {
  leagueSlug: string;
  displayName: string;
  status: League['status'];
  hasExistingArchive: boolean;
  champion: string | null;
  top3: TopStandingEntry[];
  diff: ReturnType<typeof diffSeasonArchives> | null;
  error: string | null;
};

async function buildLeaguePreview(league: League, currentYear: number): Promise<LeaguePreview> {
  try {
    const [existing, proposed] = await Promise.all([
      getSeasonArchive(league.slug, currentYear),
      buildSeasonArchive(league.slug, currentYear),
    ]);
    const top3: TopStandingEntry[] = proposed.finalStandings.slice(0, 3).map((row, i) => ({
      position: i + 1,
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
    }));
    return {
      leagueSlug: league.slug,
      displayName: league.displayName,
      status: league.status,
      hasExistingArchive: existing !== null,
      champion: top3[0]?.owner ?? null,
      top3,
      diff: existing !== null ? diffSeasonArchives(existing, proposed) : null,
      error: null,
    };
  } catch (err) {
    return {
      leagueSlug: league.slug,
      displayName: league.displayName,
      status: league.status,
      hasExistingArchive: false,
      champion: null,
      top3: [],
      diff: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// POST — two-phase: preview (confirmed: false) or execute (confirmed: true), admin-gated
export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    body = {};
  }

  const allLeagues = await getLeagues();
  // Test league is excluded from global rollover — it has its own independent lifecycle controls
  const leagues = allLeagues.filter((l) => l.slug !== TEST_LEAGUE_SLUG);

  if (leagues.length === 0) {
    return new Response('No leagues registered — nothing to roll over', { status: 400 });
  }

  // All non-test leagues are assumed to be on the same year (global rollover model)
  const currentYear = leagues[0]!.year;

  // Phase 1 — Preview: build per-league archive status and diff without writing
  if (!body.confirmed) {
    const previews = await Promise.all(
      leagues.map((league) => buildLeaguePreview(league, currentYear))
    );
    return Response.json({
      preview: {
        currentYear,
        leagues: previews,
      },
    });
  }

  // Phase 2 — Confirmed: two-stage execution
  // Stage 1: build and save all archives
  // Year increment belongs in the preseason transition (P7B-4), not here
  const archivedLeagues: string[] = [];
  const errors: Array<{ leagueSlug: string; error: string }> = [];

  for (const league of leagues) {
    try {
      const archive = await buildSeasonArchive(league.slug, currentYear);
      await saveSeasonArchive(archive);
      archivedLeagues.push(league.slug);
    } catch (err) {
      errors.push({
        leagueSlug: league.slug,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Bail out before status writes if any archive failed
  if (errors.length > 0) {
    return Response.json({
      success: false,
      archivedLeagues: [],
      errors,
      message:
        'One or more leagues failed to archive. No status updates were made. Resolve errors and retry.',
    });
  }

  // Stage 2: transition all archived leagues to offseason
  // Status write failures are non-fatal — archive is the source of truth
  for (const league of leagues) {
    try {
      await updateLeagueStatus(league.slug, { state: 'offseason' });
    } catch (err) {
      console.error(`Failed to write offseason status for ${league.slug}:`, err);
    }
  }

  return Response.json({ success: true, archivedLeagues, errors: [] });
}
