import RosterUploadPanel from '@/components/admin/RosterUploadPanel';
import { getLeague } from '@/lib/leagueRegistry';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminLeagueRosterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-4">
      <h1 className="text-xl font-bold text-zinc-100">{league.displayName} — Roster</h1>
      <RosterUploadPanel leagues={[league]} />
    </main>
  );
}
