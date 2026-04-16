import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';
import { draftScope, type DraftState } from '@/lib/draft';
import { listSeasonArchives, getSeasonArchive, type SeasonArchive } from '@/lib/seasonArchive';
import { selectTopRivalries } from '@/lib/selectors/historySelectors';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import teamsData from '@/data/teams.json';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import DraftSummaryClient from '@/components/draft/DraftSummaryClient';

type TeamsJson = { items: TeamCatalogItem[] };

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Fact derivation — runs server-side to avoid shipping large archive data
// to the client.
// ---------------------------------------------------------------------------

function nthLabel(n: number): string {
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  if (n === 5) return '5th';
  if (n === 10) return '10th';
  return `${n}th`;
}

function deriveFacts(
  archives: SeasonArchive[],
  draftOwners: string[],
  leagueDisplayName: string
): string[] {
  const facts: string[] = [];
  if (archives.length === 0 || draftOwners.length === 0) return facts;

  const draftOwnerSet = new Set(draftOwners.map((o) => o.toLowerCase()));

  // --- League anniversaries ---
  // Count how many archived seasons each draft owner appears in.
  // The current draft adds 1 to that count → milestone seasons to celebrate.
  const milestones = new Set([2, 5, 10]);
  const seasonCountByOwnerLower = new Map<string, number>();
  for (const archive of archives) {
    try {
      const rows = parseOwnersCsv(archive.ownerRosterSnapshot);
      const seen = new Set<string>();
      for (const row of rows) {
        const lc = row.owner.toLowerCase();
        if (!seen.has(lc)) {
          seen.add(lc);
          seasonCountByOwnerLower.set(lc, (seasonCountByOwnerLower.get(lc) ?? 0) + 1);
        }
      }
    } catch {
      // skip archive with unparseable roster
    }
  }
  for (const owner of draftOwners) {
    const pastSeasons = seasonCountByOwnerLower.get(owner.toLowerCase()) ?? 0;
    const currentSeason = pastSeasons + 1;
    if (milestones.has(currentSeason)) {
      facts.push(`${owner}'s ${nthLabel(currentSeason)} season in the ${leagueDisplayName}`);
    }
  }

  // --- Main rivals ---
  // Top rivalries (most competitive all-time records) where both owners
  // are participating in the current draft. Show up to 3.
  const rivalries = selectTopRivalries(archives, 10);
  let rivalryCount = 0;
  for (const r of rivalries) {
    if (rivalryCount >= 3) break;
    if (draftOwnerSet.has(r.ownerA.toLowerCase()) && draftOwnerSet.has(r.ownerB.toLowerCase())) {
      facts.push(`${r.ownerA} vs ${r.ownerB} — ${r.wins}–${r.losses} all time`);
      rivalryCount++;
    }
  }

  // --- Returning champion ---
  // Check whether the most recent archived season's champion is in the current draft.
  const mostRecent = [...archives].sort((a, b) => b.year - a.year)[0];
  if (mostRecent && mostRecent.finalStandings.length > 0) {
    const champion = mostRecent.finalStandings[0]?.owner;
    if (champion && draftOwnerSet.has(champion.toLowerCase())) {
      facts.push(`${champion} returns as ${mostRecent.year} defending champion`);
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DraftSummaryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;

  const league = await getLeague(slug);
  if (!league) notFound();

  const status = league.status;
  const year =
    status?.state === 'preseason' || status?.state === 'season' ? status.year : league.year;

  // Load draft state
  const draftRecord = await getAppState<DraftState>(draftScope(slug), String(year));
  const draft = draftRecord?.value ?? null;

  if (!draft) {
    redirect(`/league/${slug}/draft/setup`);
  }

  // redirect() throws, so draft is non-null past this point
  const liveDraft = draft as DraftState;

  // All FBS team names for the inline team picker (NoClaim excluded)
  const { items } = teamsData as TeamsJson;
  const allTeamNames = items
    .filter((t) => t.school !== 'NoClaim')
    .map((t) => t.school)
    .sort((a, b) => a.localeCompare(b));

  // Build team→conference map for the summary display
  const conferenceMap: Record<string, string> = {};
  for (const t of items) {
    if (t.school !== 'NoClaim' && t.conference) {
      conferenceMap[t.school.toLowerCase()] = t.conference;
    }
  }

  // Build team→display name map (same shortDisplayName resolution as draft board)
  const dbTeams = await getTeamDatabaseItems();
  const displayNameMap: Record<string, string> = {};
  for (const t of dbTeams) {
    if (t.school === 'NoClaim') continue;
    const teamName = t.displayName ?? t.school;
    const shortName = t.shortDisplayName
      ? t.shortDisplayName
      : teamName.length <= 14
        ? teamName
        : (t.abbreviation ?? teamName);
    displayNameMap[t.school.toLowerCase()] = shortName;
  }

  // Derive interesting facts from historical archives — fail silently if unavailable
  let facts: string[] = [];
  try {
    const archiveYears = await listSeasonArchives(slug);
    const archiveResults = await Promise.all(archiveYears.map((y) => getSeasonArchive(slug, y)));
    const archives = archiveResults.filter((a): a is SeasonArchive => a !== null);
    facts = deriveFacts(archives, liveDraft.owners, league.displayName);
  } catch {
    // historical data unavailable — InterestingFactsPanel will render nothing
  }

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/league/${slug}/`}
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            ← {league.displayName}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
            {league.displayName} — {year} Draft Results
          </h1>
        </div>
        <Link
          href={`/league/${slug}/draft`}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          ← Draft Board
        </Link>
      </div>

      <DraftSummaryClient
        slug={slug}
        year={year}
        initialDraft={liveDraft}
        allTeamNames={allTeamNames}
        conferenceMap={conferenceMap}
        displayNameMap={displayNameMap}
        facts={facts}
        leagueStatus={league.status}
      />
    </main>
  );
}
