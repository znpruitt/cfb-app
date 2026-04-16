import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeague, updateLeague, removeLeague } from '@/lib/leagueRegistry';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { slug } = await params;

  const existing = await getLeague(slug);
  if (!existing) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }

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
  const updates: { displayName?: string; year?: number; foundedYear?: number } = {};

  if ('displayName' in obj) {
    if (typeof obj.displayName !== 'string' || !obj.displayName.trim()) {
      return new Response('displayName must be a non-empty string', { status: 400 });
    }
    updates.displayName = obj.displayName.trim();
  }

  if ('year' in obj) {
    const year =
      typeof obj.year === 'number'
        ? obj.year
        : typeof obj.year === 'string'
          ? Number(obj.year)
          : NaN;
    if (!Number.isFinite(year) || year < 2000) {
      return new Response('year must be a valid season year', { status: 400 });
    }
    updates.year = year;
  }

  if ('foundedYear' in obj) {
    const fy =
      typeof obj.foundedYear === 'number'
        ? obj.foundedYear
        : typeof obj.foundedYear === 'string'
          ? Number(obj.foundedYear)
          : NaN;
    if (!Number.isFinite(fy) || fy < 1900 || fy > new Date().getFullYear()) {
      return new Response('foundedYear must be between 1900 and the current year', { status: 400 });
    }
    updates.foundedYear = fy;
  }

  if (Object.keys(updates).length === 0) {
    return new Response('No updatable fields provided (displayName, year, foundedYear)', {
      status: 400,
    });
  }

  const updated = await updateLeague(slug, updates);
  return Response.json({ league: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const { slug } = await params;

  const existing = await getLeague(slug);
  if (!existing) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }

  const { leagues } = await removeLeague(slug);
  return Response.json({
    leagues,
    note: 'Registry entry removed. League-scoped storage data (owners, aliases, overrides) is not deleted — clean up manually if needed.',
  });
}
