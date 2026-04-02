import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeague } from '@/lib/leagueRegistry';
import { getSeasonArchive, saveSeasonArchive, diffSeasonArchives } from '@/lib/seasonArchive';
import { buildSeasonArchive } from '@/lib/seasonRollover';

// NOTE: This route intentionally does NOT call updateLeague or increment the active season year
// for any league. It is a backfill-only operation — archiving a past year without advancing the
// platform year. updateLeague is not imported and must never be added here.

type PostBody = {
  leagueSlug?: unknown;
  year?: unknown;
  confirmed?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
  if (authFailure) return authFailure;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  // Validate leagueSlug
  const leagueSlug = body.leagueSlug;
  if (typeof leagueSlug !== 'string' || leagueSlug.trim() === '') {
    return Response.json(
      { error: 'leagueSlug is required and must be a non-empty string' },
      { status: 400 }
    );
  }

  // Validate year
  const year = Number(body.year);
  if (!Number.isFinite(year) || year < 2000) {
    return Response.json(
      { error: 'year is required and must be a number >= 2000' },
      { status: 400 }
    );
  }

  // Confirm league exists in registry
  const league = await getLeague(leagueSlug);
  if (!league) {
    return Response.json({ error: `League not found: ${leagueSlug}` }, { status: 404 });
  }

  const confirmed = body.confirmed === true;

  // Check for an existing archive
  const existing = await getSeasonArchive(leagueSlug, year);

  if (existing !== null && !confirmed) {
    // Existing archive found but not yet confirmed — return diff for admin review
    let proposed: Awaited<ReturnType<typeof buildSeasonArchive>>;
    try {
      proposed = await buildSeasonArchive(leagueSlug, year);
    } catch (err) {
      return Response.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Failed to build archive — schedule cache may be unavailable',
        },
        { status: 500 }
      );
    }

    const diff = diffSeasonArchives(existing, proposed);
    return Response.json({
      requiresConfirmation: true,
      leagueSlug,
      year,
      diff,
    });
  }

  // Build archive — either no existing archive, or confirmed overwrite
  let archive: Awaited<ReturnType<typeof buildSeasonArchive>>;
  try {
    archive = await buildSeasonArchive(leagueSlug, year);
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to build archive — schedule cache may be unavailable',
      },
      { status: 500 }
    );
  }

  await saveSeasonArchive(archive);

  return Response.json({
    success: true,
    leagueSlug,
    year,
    archivedAt: archive.archivedAt,
    replaced: existing !== null,
  });
}
