import AdminLeagueDashboard from '@/components/home/AdminLeagueDashboard';
import PublicLanding from '@/components/home/PublicLanding';
import { getAppState } from '@/lib/server/appStateStore';
import { getLeagues } from '@/lib/leagueRegistry';
import { resolveLeagueSeason } from '@/lib/leagueSeason';
import { sanitizeLeagues } from '@/lib/leagueSanitize';
import { countDistinctOwners } from '@/lib/selectors/leagueOwnerCounts';
import { seasonYearForToday } from '@/lib/scores/normalizers';

/**
 * PLATFORM-088 — which homepage a visitor gets, decided on the SERVER.
 *
 * Split out of `page.tsx` so the branch is directly testable: the page itself is
 * a thin shell whose only other job is resolving the two auth facts below.
 *
 * Lives under `src/app/` rather than `src/components/`. It transitively imports
 * `appStateStore`, which imports `pg`; a module under `src/components/` invites a
 * client component to import it and pull a database driver into the browser
 * bundle, and this repo has no `server-only` guard to stop that.
 *
 * **The ordering here is the security property, not a performance detail.** The
 * registry read and every owner-count read happen INSIDE the admin branch, after
 * the check. Previously they ran unconditionally in the RSC and were handed to a
 * client component that branched with Clerk's `<Show>` — so the full league
 * directory and owner counts were serialized into the payload for anonymous
 * visitors, exactly the shape the Phase 3 draft-auth fix closed ("full
 * `DraftState` is no longer serialized into server HTML for non-admins").
 *
 * A consequence worth stating: the public landing cannot be broken by a registry
 * or storage fault, because it never touches either.
 */
export async function buildHomeView({
  isPlatformAdmin,
  isSignedIn,
}: {
  isPlatformAdmin: boolean;
  /**
   * Whether ANY Clerk session exists — identity, not role. A signed-in
   * non-admin gets the same landing as a stranger, but needs a way OUT of the
   * session; without one they loop between `/` and `/login` forever. See
   * `PublicLanding`.
   */
  isSignedIn: boolean;
}): Promise<React.ReactElement> {
  if (!isPlatformAdmin) return <PublicLanding isSignedIn={isSignedIn} />;

  const leagues = await getLeagues();
  const ownerCountBySlug = await countOwnersByLeague(leagues);

  return (
    <AdminLeagueDashboard
      leagues={sanitizeLeagues(leagues)}
      ownerCountBySlug={ownerCountBySlug}
      isPlatformAdmin={isPlatformAdmin}
    />
  );
}

/**
 * Owner counts, resolved PER LEAGUE.
 *
 * The previous implementation applied one calendar-derived `seasonYearForToday()`
 * to every league. That helper answers "which season's data are we looking at",
 * not "which season is this league in" — and this page was the app's only
 * league-scoped caller of it; both history surfaces already read the league's own
 * year. With leagues on different years (production has one on 2026 and the demo
 * on 2025), it read a roster the league does not have and reported "No owners"
 * for a league with a full roster.
 *
 * `resolveLeagueSeason` is the existing shared answer: the lifecycle `status.year`
 * when the status carries one, else the league's top-level year. The calendar
 * value survives only as the last-resort default for a record carrying neither.
 */
async function countOwnersByLeague(
  leagues: Awaited<ReturnType<typeof getLeagues>>
): Promise<Record<string, number | null>> {
  const defaultSeason = seasonYearForToday();
  const entries = await Promise.all(
    leagues.map(async (league) => {
      const year = resolveLeagueSeason({
        leagueStatus: league.status,
        leagueYear: league.year,
        defaultSeason,
      });
      try {
        const record = await getAppState<string>(`owners:${league.slug}:${year}`, 'csv');
        // The DERIVATION lives in a selector (AGENTS.md invariant 9); this
        // function's job is the storage lookup and the per-league year, nothing
        // more.
        return [league.slug, countDistinctOwners(record?.value)] as const;
      } catch {
        // Unreadable is NOT zero — the card renders no owner label at all.
        return [league.slug, null] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}
