import { NO_CLAIM_OWNER } from '../standings';
import type { SeasonArchive } from '../seasonArchive';

/**
 * INSIGHTS-025 — who joined, who came back, and who is gone.
 *
 * Every fact here is DERIVED from `context.archives` and `context.leagueMembers`
 * at request time. No owner name, season, count or placement is written down
 * anywhere in this feature — a league with a different history running the same
 * code produces different output and nothing needs editing. `__tests__` carries a
 * source scan that fails if a literal ever appears.
 *
 * ## Why this could not be built before
 *
 * Naming who is genuinely returning needs a finalized upcoming roster compared
 * against league history. AGENTS.md Insights invariant 5 said no generator had
 * one — true until INSIGHTS-023a put the confirmed owner list on the context, and
 * INSIGHTS-023 established (owner ruling) that a confirmed list is finalized
 * enough to speak from. This is the feature that clause was waiting for.
 *
 * ## Placement comes from archive ORDER
 *
 * `finalStandings` carries no rank field; the array is sorted, so the index is
 * the placement. That is not an assumption this module invents — `championOf`
 * reads `finalStandings[0]` and `positionOf` uses `findIndex` in
 * `generators/historical.ts`. Same contract, one more consumer.
 */

/** One season an owner took part in, with how it finished for them. */
export type OwnerSeason = {
  year: number;
  /** 1-based finish. `null` when the owner is on the roster but absent from the table. */
  placement: number | null;
  /** How many owners were ranked that season — placement is meaningless without it. */
  fieldSize: number;
  wins: number;
  losses: number;
};

export type MembershipEvent =
  | { kind: 'joined'; owners: string[] }
  /**
   * Away for `seasonsAway` full seasons; `lastSeason` is the most recent one
   * played. `bestSeason` is their strongest finish across all prior seasons —
   * a WELCOME leads with someone's best, not their most recent, and for a
   * returner those are rarely the same. `null` when only one prior season exists,
   * because "their best finish" collapses to "their only finish" and the warm
   * variant would read as a dig for anyone who left after a bad year.
   */
  | {
      kind: 'returned';
      owner: string;
      seasonsAway: number;
      lastSeason: OwnerSeason;
      bestSeason: OwnerSeason | null;
    }
  /** Was on the most recent archived roster and is not a member now. */
  | { kind: 'left'; owner: string; finalSeason: OwnerSeason; seasonsPlayed: number };

export type MembershipHistory = {
  /** Every season each owner appears in, oldest first. */
  seasonsByOwner: Map<string, OwnerSeason[]>;
  /** The most recent archived year, or `null` when there is no history at all. */
  latestArchivedYear: number | null;
  events: MembershipEvent[];
};

function ownersInArchive(
  archive: SeasonArchive,
  parseCsv: (csv: string) => { owner: string }[]
): Set<string> {
  const names = new Set<string>();
  // The ROSTER, not the standings table. An owner who drafted but never appears
  // in `finalStandings` still took part, and reading only the table would drop
  // them — the same distinction INSIGHTS-023a drew between "who is in the
  // league" and "who owns which team".
  for (const row of parseCsv(archive.ownerRosterSnapshot)) {
    if (row.owner && row.owner !== NO_CLAIM_OWNER) names.add(row.owner);
  }
  for (const row of archive.finalStandings) {
    if (row.owner && row.owner !== NO_CLAIM_OWNER) names.add(row.owner);
  }
  return names;
}

function seasonFor(archive: SeasonArchive, owner: string): OwnerSeason {
  const ranked = archive.finalStandings.filter((row) => row.owner && row.owner !== NO_CLAIM_OWNER);
  const index = ranked.findIndex((row) => row.owner === owner);
  const row = index >= 0 ? ranked[index] : undefined;
  return {
    year: archive.year,
    placement: index >= 0 ? index + 1 : null,
    fieldSize: ranked.length,
    wins: row?.wins ?? 0,
    losses: row?.losses ?? 0,
  };
}

/**
 * Build the membership picture.
 *
 * `parseCsv` is injected rather than imported so this module stays free of the
 * parser's own dependencies and can be exercised directly.
 */
export function buildMembershipHistory(params: {
  archives: readonly SeasonArchive[];
  members: ReadonlySet<string>;
  parseCsv: (csv: string) => { owner: string }[];
  /**
   * The season being played or prepared. Events are only derivable when the
   * newest archive is the season immediately before it.
   */
  currentYear: number;
}): MembershipHistory {
  const { archives, members, parseCsv, currentYear } = params;
  const sorted = [...archives].sort((a, b) => a.year - b.year);

  const seasonsByOwner = new Map<string, OwnerSeason[]>();
  for (const archive of sorted) {
    for (const owner of ownersInArchive(archive, parseCsv)) {
      const list = seasonsByOwner.get(owner) ?? [];
      list.push(seasonFor(archive, owner));
      seasonsByOwner.set(owner, list);
    }
  }

  const latest = sorted[sorted.length - 1] ?? null;
  const latestArchivedYear = latest?.year ?? null;
  const events: MembershipEvent[] = [];

  if (latest === null) {
    // No history: nobody can have joined, returned, or left. A brand-new league
    // is not a league where fourteen people just arrived.
    return { seasonsByOwner, latestArchivedYear, events };
  }

  // The newest archive must BE last season. `latestArchivedYear` was computed
  // here and never read, so a gap in the archives re-announced settled events as
  // this year's news — "C has left the league after finishing 3rd in 2027" served
  // in 2030. The reverse is worse: an owner whose only season is the unarchived
  // one has no rows at all and is announced as brand new.
  //
  // Rollover archives before it transitions, so this is not the ordinary path —
  // but `setTestLeagueStatus` advances a demo league with no archive at all, and
  // an archive failure skips only that league.
  if (latestArchivedYear !== currentYear - 1) {
    return { seasonsByOwner, latestArchivedYear, events };
  }

  const lastSeasonOwners = ownersInArchive(latest, parseCsv);

  // NAME DRIFT is indistinguishable from two people, so it produces SILENCE.
  //
  // Owner identity is a raw string — `cleanOwnerNames` trims but deliberately
  // does not fold case, and no owner-name resolver exists anywhere in the app.
  // So a commissioner re-typing "alice" against an archive holding "Alice" made
  // this generator assert BOTH "alice joins the league" and "Alice has left the
  // league" in the same feed. Every other member-filtered generator degrades to
  // silence on that drift; this one was the exception.
  //
  // The app cannot tell a typo from two league members whose names differ only in
  // case, so it must not guess. Any name that would appear on BOTH sides under a
  // loose comparison is dropped from both.
  const loose = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');
  const joinedRaw = [...members].filter(
    (owner) => owner && owner !== NO_CLAIM_OWNER && !seasonsByOwner.has(owner)
  );
  const leftRaw = [...lastSeasonOwners].filter((owner) => !members.has(owner));
  const ambiguous = new Set(
    joinedRaw.map(loose).filter((key) => leftRaw.some((owner) => loose(owner) === key))
  );

  // JOINED — grouped into ONE event. Three arrivals must not consume three of
  // the Overview's five slots.
  const joined = joinedRaw
    .filter((owner) => !ambiguous.has(loose(owner)))
    .sort((a, b) => a.localeCompare(b));
  if (joined.length > 0) events.push({ kind: 'joined', owners: joined });

  // RETURNED — has history, missed the most recent season. One event each,
  // because the gap and the prior finish differ per owner and a merged sentence
  // would have to drop both.
  for (const owner of [...members].sort((a, b) => a.localeCompare(b))) {
    if (!owner || owner === NO_CLAIM_OWNER) continue;
    if (lastSeasonOwners.has(owner)) continue;
    const seasons = seasonsByOwner.get(owner);
    if (!seasons || seasons.length === 0) continue;
    const lastPlayed = seasons[seasons.length - 1]!;
    // Best = lowest placement number among seasons they were actually ranked in.
    // Ties break toward the MOST RECENT, so a returner who matched their best
    // more than once is welcomed back with the one people remember.
    const ranked = seasons.filter((season) => season.placement !== null);
    // RANKED seasons, not seasons. Counting `seasons.length` admitted a returner
    // with two prior seasons of which only one was ranked — so the "welcome"
    // rendered their single ranked finish as a best, and a 2nd-of-2 read as a
    // podium when it was last place.
    const bestSeason =
      ranked.length > 1
        ? ranked.reduce((best, season) => (season.placement! <= best.placement! ? season : best))
        : null;
    events.push({
      kind: 'returned',
      owner,
      bestSeason,
      // Full seasons missed BETWEEN the last one played and the archived year
      // just finished. Derived from the archives rather than from a calendar, so
      // a league that skipped a year is counted correctly.
      seasonsAway: sorted.filter((a) => a.year > lastPlayed.year).length,
      lastSeason: lastPlayed,
    });
  }

  // LEFT — on the most recent roster, not a member now.
  for (const owner of [...leftRaw].sort((a, b) => a.localeCompare(b))) {
    if (ambiguous.has(loose(owner))) continue;
    events.push({
      kind: 'left',
      owner,
      finalSeason: seasonFor(latest, owner),
      seasonsPlayed: seasonsByOwner.get(owner)?.length ?? 1,
    });
  }

  return { seasonsByOwner, latestArchivedYear, events };
}
