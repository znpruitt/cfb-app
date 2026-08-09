import AppHeaderActions from '@/components/menu/AppHeaderActions';
import Wordmark from '@/components/brand/Wordmark';
import ViewMoreLink from '@/components/navigation/ViewMoreLink';
import type { PublicLeague } from '@/lib/league';

/**
 * PLATFORM-088 — the platform-admin league dashboard.
 *
 * A SERVER component that renders the client `AppHeaderActions` inside it. The
 * previous version made the whole page a client component in order to branch on
 * auth state in the browser; nothing here needs the browser, and the branch now
 * happens on the server (see `homeView.tsx`), so this ships no JavaScript of its
 * own.
 *
 * Only platform admins reach this. Signed-in non-admins get `PublicLanding`, the
 * same page a signed-out visitor sees — middleware already refuses them `/admin`,
 * and this closes the gap where the homepage handed them the full league list
 * anyway. The demo league is deliberately listed here like any other: this
 * surface is the operator's, and hiding the demo from its own operator would
 * misrepresent what exists.
 */
export default function AdminLeagueDashboard({
  leagues,
  ownerCountBySlug,
  isPlatformAdmin,
}: {
  leagues: PublicLeague[];
  /** `null` means the count could not be read — rendered as absent, never as 0. */
  ownerCountBySlug: Record<string, number | null>;
  isPlatformAdmin: boolean;
}) {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          {/* Product identity, not a page title — it sits opposite the account
              menu as the app-level header. `font-bold` dropped: the shared
              treatment sets weight 800. */}
          <h1 className="text-2xl">
            <Wordmark />
          </h1>
          <AppHeaderActions isAdmin={isPlatformAdmin} />
        </div>

        {leagues.length === 0 ? (
          <div className="rounded-lg border border-gray-300 bg-gray-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-gray-600 dark:text-zinc-400">No leagues configured.</p>
            <div className="mt-3">
              <ViewMoreLink href="/admin/leagues">
                Go to League Management to set up your first league
              </ViewMoreLink>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {leagues.map((league) => (
              <div
                key={league.slug}
                className="space-y-3 rounded-lg border border-gray-300 bg-gray-50 p-5 transition-colors hover:border-gray-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                    {league.displayName}
                  </div>
                  <div className="mt-1 text-xs break-words text-gray-600 dark:text-zinc-400">
                    /{league.slug} &middot; {describeLifecycle(league)}
                    {ownerLabel(ownerCountBySlug[league.slug] ?? null) !== null && (
                      <> &middot; {ownerLabel(ownerCountBySlug[league.slug] ?? null)}</>
                    )}
                  </div>
                </div>
                <div className="flex gap-4">
                  <ViewMoreLink href={`/league/${league.slug}`}>View League</ViewMoreLink>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function describeLifecycle(league: PublicLeague): string {
  switch (league.status?.state) {
    case 'season':
      return `${league.status.year} season`;
    case 'preseason':
      return `${league.status.year} pre-season`;
    case 'offseason':
      return 'offseason';
    default:
      return `${league.year} season`;
  }
}

/**
 * `null` renders as nothing at all rather than "No owners". A count that could
 * not be read is not a count of zero, and the two used to be indistinguishable on
 * this card.
 */
function ownerLabel(count: number | null): string | null {
  if (count === null) return null;
  if (count === 0) return 'No owners';
  return `${count} owner${count === 1 ? '' : 's'}`;
}
