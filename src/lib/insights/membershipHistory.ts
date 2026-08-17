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
 * Whether that list is FINISHED is a separate question, answered by
 * `membershipCompleteness.ts` before this module is called.
 *
 * ## Owner identity is normalized ONCE, here
 *
 * Owner identity is a raw string. `cleanOwnerNames` trims but deliberately does
 * not fold case, and no owner-name resolver exists anywhere in the app — so
 * "Alice" in an archive and "alice" re-typed into this year's list are two
 * different people to every comparison in the codebase.
 *
 * Every membership event is a set difference between the current list and the
 * archives, which makes this module the one place where that drift produces false
 * claims rather than merely a duplicate row. The first version compared raw names
 * and special-cased the overlap: any name appearing on BOTH the joined and left
 * sides was dropped from both. That covered one shape and missed its neighbour —
 * a RETURNER is absent from last season's roster, so a re-typed name had nothing
 * on the left side to collide with, and "alice joins the league — no history to
 * hide behind" was served next to a history page showing her two prior seasons.
 *
 * So drift is detected once, over EVERY name this module compares, and an
 * ambiguous identity is dropped from all three event kinds.
 *
 * Detected rather than MERGED, which is the correction review made to the first
 * attempt at this. Merging keyed every set by the normalized name, which resolved
 * the drift but also collapsed two genuinely distinct owners — `cleanOwnerNames`
 * trims without folding case precisely so a league may contain both `Mike` and
 * `mike`, and AGENTS.md invariant 11 records a canonical owner-identity mapping
 * as DEFERRED. Merging would have decided that deferral here, in a content
 * feature, and could attach one owner's placement to the other. Dropping instead
 * decides nothing: raw names stay the identity everywhere, and the one thing this
 * module does with a collision is refuse to speak about either name.
 *
 * ## Placement comes from archive ORDER
 *
 * `finalStandings` carries no rank field; the array is sorted, so the index is
 * the placement. `championOf` reads `finalStandings[0]` and `positionOf` uses
 * `findIndex` in `generators/historical.ts` on the same contract.
 *
 * One difference from `positionOf`, stated because an earlier version of this
 * comment claimed there was none: `seasonFor` indexes a NoClaim-FILTERED copy of
 * the table, and `positionOf` indexes it unfiltered. For every archive written by
 * rollover the two agree, because `deriveStandings` already excludes NoClaim from
 * its rows — the divergence is reachable only for a legacy or hand-written
 * archive carrying a NoClaim row above a real owner, where this module reports the
 * placement one better than the rest of the app. Filtering is the correct
 * derivation of an OWNER's placement; making the two agree means changing
 * `positionOf`, which belongs to the historical generator's own slice.
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
   * returner those are rarely the same. `null` when fewer than two RANKED seasons
   * exist, because "their best finish" collapses to "their only finish" and the
   * warm variant would read as a dig for anyone who left after a bad year.
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
  /**
   * Every season each owner appears in, oldest first, keyed by the owner's name
   * AS WRITTEN in the archives — identity stays raw here (see the docblock).
   */
  seasonsByOwner: Map<string, OwnerSeason[]>;
  /** The most recent archived year, or `null` when there is no history at all. */
  latestArchivedYear: number | null;
  events: MembershipEvent[];
};

/**
 * The one normalization. Case-folded, trimmed, internal whitespace collapsed —
 * the drift a human re-typing a name actually produces.
 */
export function identityKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Names whose normalized form is shared by two or more DIFFERENT raw names
 * anywhere in the comparison — the current member list or any archived season.
 *
 * Either a re-typed name (one owner, two spellings) or two owners the app cannot
 * tell apart. Both are unanswerable here, so both are excluded.
 */
function ambiguousIdentities(
  members: ReadonlySet<string>,
  archived: Iterable<string>
): Set<string> {
  const spellingsByKey = new Map<string, Set<string>>();
  for (const raw of [...members, ...archived]) {
    if (!raw || raw === NO_CLAIM_OWNER) continue;
    const key = identityKey(raw);
    if (!key) continue;
    const seen = spellingsByKey.get(key) ?? new Set<string>();
    seen.add(raw);
    spellingsByKey.set(key, seen);
  }
  return new Set(
    [...spellingsByKey.entries()].filter(([, spellings]) => spellings.size > 1).map(([key]) => key)
  );
}

/**
 * Owners taking part in an archived season, keyed by identity with the name as
 * spelled in that archive kept for display.
 *
 * The ROSTER as well as the standings table: an owner who drafted but never
 * appears in `finalStandings` still took part, and reading only the table would
 * drop them — the same distinction INSIGHTS-023a drew between "who is in the
 * league" and "who owns which team".
 */
function ownersInArchive(
  archive: SeasonArchive,
  parseCsv: (csv: string) => { owner: string }[]
): Set<string> {
  const owners = new Set<string>();
  const add = (raw: string | undefined): void => {
    if (!raw || raw === NO_CLAIM_OWNER) return;
    if (raw.trim()) owners.add(raw);
  };
  for (const row of parseCsv(archive.ownerRosterSnapshot)) add(row.owner);
  for (const row of archive.finalStandings) add(row.owner);
  return owners;
}

function seasonFor(archive: SeasonArchive, owner: string): OwnerSeason {
  const ranked = archive.finalStandings.filter((row) => row.owner && row.owner !== NO_CLAIM_OWNER);
  // RAW equality. Matching on the normalized key would attribute one owner's
  // placement to another whose name differs only in case — the merge this module
  // deliberately does not perform.
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

  // Keyed by the owner's name AS WRITTEN. Keying by normalized identity resolved
  // name drift but silently merged two owners the app treats as distinct, which
  // is the deferral AGENTS.md invariant 11 records — not a content feature's call
  // to make. Drift is handled by refusing to speak, below.
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
  const empty: MembershipHistory = { seasonsByOwner, latestArchivedYear, events: [] };

  // Is the newest archive a USABLE record of last season's membership? Every
  // event below is a set difference against it, so when it cannot answer that,
  // there is nothing to derive and the answer is silence rather than a guess.
  //
  // Three ways it cannot, all one question rather than three guards:
  //
  //  - There is no history. A brand-new league is not a league where fourteen
  //    people just arrived.
  //  - It is not LAST season. `latestArchivedYear` was computed and never read at
  //    first, so a gap re-announced settled events as this year's news — "C has
  //    left the league after finishing 3rd in 2027", served in 2030. The reverse
  //    is worse: an owner whose only season is the unarchived one has no rows at
  //    all and is announced as brand new. Rollover archives before it transitions,
  //    so this is not the ordinary path — but `setTestLeagueStatus` advances a demo
  //    league with no archive at all, and an archive failure skips only that league.
  //  - It names NOBODY. `buildSeasonArchive` defaults `ownersCsvText` to `''` when
  //    the owners record is missing, and `finalStandings` then derives to `[]`, so
  //    an archive can exist for exactly the right year and carry no membership
  //    whatsoever. Measured, that announced an entire eight-owner league as
  //    joining — the emptiest possible input producing the loudest possible claim.
  if (latest === null) return empty;
  if (latestArchivedYear !== currentYear - 1) return empty;

  const lastSeasonOwners = ownersInArchive(latest, parseCsv);
  if (lastSeasonOwners.size === 0) return empty;

  // Current members, as written. NO_CLAIM is not an owner.
  const memberNames = [...members].filter((raw) => raw && raw !== NO_CLAIM_OWNER && raw.trim());

  // Any normalized identity that two DIFFERENT spellings share, anywhere in the
  // comparison — the member list or any archived season.
  //
  // Either one owner re-typed or two owners the app cannot tell apart, and this
  // module can distinguish neither, so it speaks about neither. Computed across
  // every name below, which is what makes it cover a drifted RETURNER: they are
  // absent from last season's roster, so a re-typed name has nothing on the
  // departure side to collide with, and the first version of this rule (which
  // examined only the joined∩left overlap) announced them as a brand-new owner
  // beside their own history.
  const ambiguous = ambiguousIdentities(members, seasonsByOwner.keys());
  const isAmbiguous = (name: string): boolean => ambiguous.has(identityKey(name));

  const events: MembershipEvent[] = [];

  // JOINED — no history under this exact name. Grouped into ONE event: three
  // arrivals must not consume three of the Overview's five slots.
  const joined = memberNames
    .filter((name) => !isAmbiguous(name))
    .filter((name) => !seasonsByOwner.has(name))
    .sort((a, b) => a.localeCompare(b));
  if (joined.length > 0) events.push({ kind: 'joined', owners: joined });

  // RETURNED — has history, missed the most recent season.
  for (const name of [...memberNames].sort((a, b) => a.localeCompare(b))) {
    if (isAmbiguous(name)) continue;
    if (lastSeasonOwners.has(name)) continue;
    const seasons = seasonsByOwner.get(name);
    if (!seasons || seasons.length === 0) continue;
    const lastPlayed = seasons[seasons.length - 1]!;
    // Best = lowest placement number among seasons they were actually RANKED in.
    // Ties break toward the MOST RECENT, so a returner who matched their best
    // more than once is welcomed back with the one people remember.
    //
    // Ranked seasons, not seasons: counting `seasons.length` admitted a returner
    // with two prior seasons of which only one was ranked, so their single
    // finish rendered as a "best" and a 2nd-of-2 read as a podium when it was
    // last place.
    const ranked = seasons.filter((season) => season.placement !== null);
    const bestSeason =
      ranked.length > 1
        ? ranked.reduce((best, season) => (season.placement! <= best.placement! ? season : best))
        : null;
    events.push({
      kind: 'returned',
      owner: name,
      bestSeason,
      // Full seasons missed BETWEEN the last one played and the archived year
      // just finished. Derived from the archives rather than from a calendar, so
      // a league that skipped a year is counted correctly.
      seasonsAway: sorted.filter((a) => a.year > lastPlayed.year).length,
      lastSeason: lastPlayed,
    });
  }

  // LEFT — on the most recent roster, not a member now.
  const left = [...lastSeasonOwners]
    .filter((name) => !isAmbiguous(name))
    .filter((name) => !members.has(name))
    .sort((a, b) => a.localeCompare(b));
  for (const name of left) {
    events.push({
      kind: 'left',
      owner: name,
      finalSeason: seasonFor(latest, name),
      seasonsPlayed: seasonsByOwner.get(name)?.length ?? 1,
    });
  }

  return { seasonsByOwner, latestArchivedYear, events };
}
