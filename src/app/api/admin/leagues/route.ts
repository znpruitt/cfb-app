import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeagues, addLeague, isValidSlug } from '@/lib/leagueRegistry';
import type { League } from '@/lib/league';

/** Slugs that collide with static /admin/* routes and cannot be used for leagues. */
const RESERVED_ADMIN_SLUGS = new Set([
  'season',
  'data',
  'draft',
  'diagnostics',
  'leagues',
  'cache',
]);

export async function GET(): Promise<Response> {
  const leagues = await getLeagues();
  return Response.json({ leagues });
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
  if (!Number.isFinite(year) || year < 2000)
    return new Response('year must be a valid season year', { status: 400 });

  const existing = await getLeagues();
  if (existing.some((l) => l.slug === slug)) {
    return new Response(`League with slug "${slug}" already exists`, { status: 409 });
  }

  const league: League = {
    slug,
    displayName,
    year,
    createdAt: new Date().toISOString(),
    foundedYear: new Date().getFullYear(),
  };

  const updated = await addLeague(league);
  return Response.json({ league, leagues: updated }, { status: 201 });
}
