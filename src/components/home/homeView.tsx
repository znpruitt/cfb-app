import AdminLeagueDashboard from '@/components/home/AdminLeagueDashboard';
import PublicLanding from '@/components/home/PublicLanding';
import { getAppState } from '@/lib/server/appStateStore';
import { getLeagues } from '@/lib/leagueRegistry';
import { resolveLeagueSeason } from '@/lib/leagueSeason';
import { sanitizeLeagues } from '@/lib/leagueSanitize';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { seasonYearForToday } from '@/lib/scores/normalizers';

const NO_CLAIM_OWNER = 'NoClaim';

/**
 * PLATFORM-088 — which homepage a visitor gets, decided on the SERVER.
 *
 * Split out of `page.tsx` so the branch is directly testable: the page itself is
 * a two-line shell whose only other job is calling `isPlatformAdminSession()`.
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
}: {
  isPlatformAdmin: boolean;
}): Promise<React.ReactElement> {
  if (!isPlatformAdmin) return <PublicLanding />;

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
        if (!record?.value) return [league.slug, 0] as const;
        // The shared header-aware parser, not a positional split on the first
        // comma. It locates the owner column by name and handles quoted fields,
        // so a reordered or quoted CSV counts correctly here and everywhere else.
        const owners = new Set(
          parseOwnersCsv(record.value)
            .map((row) => row.owner.trim())
            .filter((owner) => owner && owner !== NO_CLAIM_OWNER)
        );
        return [league.slug, owners.size] as const;
      } catch {
        // Unreadable is NOT zero — the card renders no owner label at all.
        return [league.slug, null] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}
