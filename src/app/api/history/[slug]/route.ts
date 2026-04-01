import { getLeague } from '@/lib/leagueRegistry';
import { listSeasonArchives } from '@/lib/seasonArchive';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;

  const league = await getLeague(slug);
  if (!league) {
    return new Response(`League "${slug}" not found`, { status: 404 });
  }

  const years = await listSeasonArchives(slug);
  return Response.json({ years });
}
