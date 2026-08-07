import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeagues, addLeague, isValidSlug } from '@/lib/leagueRegistry';
import { sanitizeLeague, sanitizeLeagues } from '@/lib/leagueSanitize';
import { findResidualLeagueScopes } from '@/lib/server/leagueResidualData';
import {
  isCreatableSeasonYear,
  maxCreatableSeasonYear,
  MIN_SEASON_YEAR,
  type League,
} from '@/lib/league';

/** Static `/admin/*` route collisions plus the legacy-reserved `cache` slug. */
const RESERVED_ADMIN_SLUGS = new Set([
  'aliases',
  'season',
  'data',
  'draft',
  'diagnostics',
  'leagues',
  'cache',
]);

export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const leagues = await getLeagues();
  return Response.json({ leagues: sanitizeLeagues(leagues) });
}

export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return new Response('Body must be an object', { status: 400 });
  }

  const obj = body as Record<string, unknown>;

  const slug = typeof obj.slug === 'string' ? obj.slug.trim() : '';
  const displayName = typeof obj.displayName === 'string' ? obj.displayName.trim() : '';
  const year =
    typeof obj.year === 'number' ? obj.year : typeof obj.year === 'string' ? Number(obj.year) : NaN;

  if (!slug) return new Response('slug is required', { status: 400 });
  if (!isValidSlug(slug))
    return new Response(
      'slug must be lowercase alphanumeric words separated by hyphens (e.g. tsc, work-league)',
      { status: 400 }
    );
  if (RESERVED_ADMIN_SLUGS.has(slug))
    return new Response(
      'Slug is reserved and cannot be used for a league. Choose a different slug.',
      { status: 400 }
    );
  if (!displayName) return new Response('displayName is required', { status: 400 });
  const now = new Date();
  const nowMs = now.getTime();
  if (!isCreatableSeasonYear(year, nowMs)) {
    return new Response(
      `year must be an integer season year between ${MIN_SEASON_YEAR} and ${maxCreatableSeasonYear(nowMs)}`,
      { status: 400 }
    );
  }

  const existing = await getLeagues();
  if (existing.some((l) => l.slug === slug)) {
    return new Response(`League with slug "${slug}" already exists`, { status: 409 });
  }

  // PLATFORM-086F2I — a slug whose PREVIOUS occupant's data is still stored.
  //
  // Deleting a league removes one registry entry and nothing else, so rosters,
  // drafts, archives, and suppression records all survive under the slug. A new
  // league taking that slug would ADOPT them — showing one set of people's names
  // to a commissioner with no relationship to them. Distinct from the 409 above
  // on purpose: that one means a league exists, this one means a league's remains
  // do, and they need different remedies.
  //
  // A stopgap. It refuses reuse and deletes nothing; erasure is deferred work.
  const residual = await findResidualLeagueScopes(slug);
  if (residual.length > 0) {
    return new Response(
      `Stored data still exists for slug "${slug}" from a previously deleted league ` +
        `(${residual.length} record group(s)). Choose a different slug — reusing this one would ` +
        `attach the previous league's rosters, drafts, and archives to the new league.`,
      { status: 409 }
    );
  }

  // PLATFORM-086F2B — new leagues are born with an explicit lifecycle status.
  // `status` is the lifecycle authority and the top-level `year` its synchronized
  // projection; initializing both here preserves the pre-F2B effective behavior
  // (a missing status was inferred as `{ state: 'season', year }`) while
  // preventing new missing-status records.
  const league: League = {
    slug,
    displayName,
    year,
    createdAt: now.toISOString(),
    foundedYear: now.getUTCFullYear(),
    status: { state: 'season', year },
  };

  const updated = await addLeague(league);
  return Response.json(
    { league: sanitizeLeague(league), leagues: sanitizeLeagues(updated) },
    { status: 201 }
  );
}
