import { getLeague } from '@/lib/leagueRegistry';
import { isAuthorizedForLeague } from '@/lib/leagueAuth';
import { getSeasonArchive } from '@/lib/seasonArchive';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; year: string }> }
): Promise<Response> {
  const { slug, year: yearParam } = await params;

  // Password-gate: blend unauthorized access into the same 404 shape unknown
  // leagues return, so API callers can't distinguish "passworded" from "missing".
  // Pass req so the gate honors ADMIN_API_TOKEN in addition to Clerk session.
  if (!(await isAuthorizedForLeague(slug, req))) {
    return new Response(null, { status: 404 });
  }

  const year = Number(yearParam);
  if (!Number.isFinite(year) || year < 2000) {
    return new Response('year must be a valid season year', { status: 400 });
  }

  const league = await getLeague(slug);
  if (!league) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }

  const archive = await getSeasonArchive(slug, year);
  if (!archive) {
    return new Response(`No archive found for ${slug} season ${year}`, { status: 404 });
  }

  return Response.json(archive);
}
