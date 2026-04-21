import { getLeague } from '@/lib/leagueRegistry';
import { isAuthorizedForLeague } from '@/lib/leagueAuth';
import { listSeasonArchives } from '@/lib/seasonArchive';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;

  // Password-gate: blend unauthorized access into the same 404 shape unknown
  // leagues return, so API callers can't distinguish "passworded" from "missing".
  if (!(await isAuthorizedForLeague(slug))) {
    return new Response(null, { status: 404 });
  }

  const league = await getLeague(slug);
  if (!league) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }

  const years = await listSeasonArchives(slug);
  return Response.json({ years });
}
