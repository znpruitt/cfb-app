import Link from 'next/link';

const cards = [
  {
    href: '/admin/draft',
    title: 'Draft Tools',
    desc: 'SP+ ratings, win totals, draft setup',
  },
  {
    href: '/admin/data',
    title: 'Data Management',
    desc: 'Schedule, scores, odds, aliases',
  },
  {
    href: '/admin/season',
    title: 'Season Management',
    desc: 'Rollover, backfill, archive tools',
  },
  {
    href: '/admin/diagnostics',
    title: 'Diagnostics',
    desc: 'API usage, storage, score attachment',
  },
  {
    href: '/admin/leagues',
    title: 'League Management',
    desc: 'Configure leagues and settings',
  },
];

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-100">Platform Admin</h1>
          <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            ← Home
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="block rounded-lg border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-600 transition-colors"
            >
              <div className="font-semibold text-zinc-100">{card.title}</div>
              <div className="mt-1 text-sm text-zinc-400">{card.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
