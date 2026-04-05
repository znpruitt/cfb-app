import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getLeague } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

const tools = [
  {
    key: 'roster',
    title: 'Roster',
    desc: 'Manage team ownership for this season',
  },
  {
    key: 'draft',
    title: 'Draft',
    desc: 'Set up and run the season draft',
    external: true,
  },
  {
    key: 'data',
    title: 'Data',
    desc: 'Manage league status and team aliases',
  },
  {
    key: 'settings',
    title: 'Settings',
    desc: 'Edit league display name and season year',
  },
] as const;

export default async function AdminLeaguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <div className="space-y-1">
        <Link href="/admin" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">
          {league.displayName} — Commissioner Tools
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => {
          const href =
            tool.key === 'draft'
              ? `/league/${league.slug}/draft/setup`
              : `/admin/${slug}/${tool.key}`;
          return (
            <Link
              key={tool.key}
              href={href}
              className="block rounded-lg border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-600 transition-colors"
            >
              <div className="font-medium text-zinc-100">{tool.title}</div>
              <div className="mt-1 text-sm text-zinc-400">{tool.desc}</div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
