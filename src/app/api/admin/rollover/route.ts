import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeagues } from '@/lib/leagueRegistry';
import { getSeasonArchive, saveSeasonArchive, diffSeasonArchives } from '@/lib/seasonArchive';
import { isSeasonComplete, buildSeasonArchive } from '@/lib/seasonRollover';
import { updateLeague } from '@/lib/leagueRegistry';

// GET — season completion status and platform year, admin-gated
export async function GET(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
  if (authFailure) return authFailure;

  const leagues = await getLeagues();
  const currentYear = leagues[0]?.year ?? new Date().getUTCFullYear();
  const seasonComplete = await isSeasonComplete(currentYear);

  return Response.json({ seasonComplete, currentYear, leagues });
}

type PostBody = { confirmed?: boolean };

type LeaguePreview = {
  leagueSlug: string;
  displayName: string;
  hasExistingArchive: boolean;
  diff: ReturnType<typeof diffSeasonArchives> | null;
  error: string | null;
};

async function buildLeaguePreview(
  leagueSlug: string,
  displayName: string,
  currentYear: number
): Promise<LeaguePreview> {
  try {
    const [existing, proposed] = await Promise.all([
      getSeasonArchive(leagueSlug, currentYear),
      buildSeasonArchive(leagueSlug, currentYear),
    ]);
    return {
      leagueSlug,
      displayName,
      hasExistingArchive: existing !== null,
      diff: existing !== null ? diffSeasonArchives(existing, proposed) : null,
      error: null,
    };
  } catch (err) {
    return {
      leagueSlug,
      displayName,
      hasExistingArchive: false,
      diff: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// POST — two-phase: preview (confirmed: false) or execute (confirmed: true), admin-gated
export async function POST(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
  if (authFailure) return authFailure;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    body = {};
  }

  const leagues = await getLeagues();
  if (leagues.length === 0) {
    return new Response('No leagues registered — nothing to roll over', { status: 400 });
  }

  const currentYear = leagues[0]!.year;
  const nextYear = currentYear + 1;

  // Phase 1 — Preview: build per-league archive status and diff without writing
  if (!body.confirmed) {
    const previews = await Promise.all(
      leagues.map((league) => buildLeaguePreview(league.slug, league.displayName, currentYear))
    );
    return Response.json({
      preview: {
        currentYear,
        nextYear,
        leagues: previews,
      },
    });
  }

  // Phase 2 — Confirmed: archive all leagues and increment active year
  // Re-derive each archive (stateless — does not rely on Phase 1 server state)
  const archivedLeagues: string[] = [];
  const errors: Array<{ leagueSlug: string; error: string }> = [];

  for (const league of leagues) {
    try {
      const archive = await buildSeasonArchive(league.slug, currentYear);
      await saveSeasonArchive(archive);
      await updateLeague(league.slug, { year: nextYear });
      archivedLeagues.push(league.slug);
    } catch (err) {
      errors.push({
        leagueSlug: league.slug,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return Response.json({ success: true, archivedLeagues, newYear: nextYear, errors });
}
