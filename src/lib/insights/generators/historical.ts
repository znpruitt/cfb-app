import type { Insight } from '../../selectors/insights';
import type { SeasonArchive } from '../../seasonArchive';
import { registerGenerator } from '../engine';
import {
  formatHolderNames,
  formatOwnerList,
  holderVerb,
  membershipIsKnown,
  resolveSuperlative,
} from '../superlative';
import type {
  InsightContext,
  InsightGenerator,
  LeagueMembersSource,
  LifecycleState,
  NewsHook,
} from '../types';

const HISTORICAL_LIFECYCLES: LifecycleState[] = [
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
  'fresh_offseason',
  'offseason',
];

const NO_CLAIM_OWNER = 'NoClaim';
const MIN_CONSISTENCY_SEASONS = 3;
const MIN_IMPROVEMENT_POSITIONS = 3;
const DROUGHT_BASE_PRIORITY = 60;
const DROUGHT_PER_SEASON_BONUS = 5;
const DROUGHT_PRIORITY_CAP = 85;
const DYNASTY_BASE_PRIORITY = 70;
const DYNASTY_PER_TITLE_BONUS = 10;
const DYNASTY_PRIORITY_CAP = 90;
const IMPROVEMENT_BASE_PRIORITY = 55;
const IMPROVEMENT_PER_POSITION_BONUS = 4;
const IMPROVEMENT_PRIORITY_CAP = 80;
const CONSISTENCY_PRIORITY = 65;

function ownerSlug(owner: string): string {
  return owner.trim().toLowerCase().replace(/\s+/gu, '-');
}

function toInsight(params: {
  id: string;
  type: Insight['type'];
  title: string;
  description: string;
  owner?: string;
  relatedOwners?: string[];
  priorityScore: number;
  lifecycle: LifecycleState[];
  newsHook: NewsHook;
  statValue: number;
}): Insight {
  const { owner, relatedOwners = [], priorityScore } = params;
  return {
    ...params,
    category: 'historical',
    score: priorityScore,
    owners: [owner, ...relatedOwners].filter((entry): entry is string => Boolean(entry)),
  };
}

function sortedArchives(archives: SeasonArchive[]): SeasonArchive[] {
  return [...archives].sort((a, b) => a.year - b.year);
}

function isEligibleOwner(owner: string): boolean {
  return owner !== NO_CLAIM_OWNER;
}

const TIE_SUPPRESSION_THRESHOLD = 4;

function championOf(archive: SeasonArchive): string | null {
  const row = archive.finalStandings[0];
  if (!row) return null;
  if (!isEligibleOwner(row.owner)) return null;
  return row.owner;
}

function positionOf(archive: SeasonArchive, owner: string): number | null {
  const index = archive.finalStandings.findIndex((row) => row.owner === owner);
  if (index === -1) return null;
  return index + 1;
}

function deriveDroughtInsight(
  archives: SeasonArchive[],
  activeOwners: ReadonlySet<string>,
  lifecycles: LifecycleState[],
  membersSource: LeagueMembersSource
): Insight | null {
  if (archives.length === 0) return null;
  const sorted = sortedArchives(archives);

  // Track the last title year per owner and which seasons each owner appeared in
  const lastTitleYear = new Map<string, number>();
  const appearedInYear = new Map<string, Set<number>>();
  for (const archive of sorted) {
    const champion = championOf(archive);
    if (champion) lastTitleYear.set(champion, archive.year);
    for (const row of archive.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      const years = appearedInYear.get(row.owner) ?? new Set<number>();
      years.add(archive.year);
      appearedInYear.set(row.owner, years);
    }
  }

  // INSIGHTS-033 — a drought is counted in SEASONS PLAYED since the last title,
  // for everyone, which is a change from counting calendar years for owners who
  // have won.
  //
  // The conversion below measures the record over every owner in the archives,
  // and calendar years cannot support that: a champion who left in 2022 would
  // keep accruing drought through seasons they were not in, so a departed owner
  // would hold the record almost by default and the card would spend its life
  // citing someone who stopped playing. It also mattered before the conversion,
  // because owners here DO sit a season out and come back (owner, 2026-08-19) —
  // a member who skipped a year was already being charged for it.
  //
  // The never-won branch ALREADY counted appearances (`seasonsPlayed`), so this
  // makes one definition of the two the function was using, rather than
  // introducing a new one. For an owner who has played continuously the number
  // is unchanged.
  type DroughtEntry = { owner: string; drought: number; neverWon: boolean };
  const population: DroughtEntry[] = [];
  for (const [owner, years] of appearedInYear) {
    const lastYear = lastTitleYear.get(owner);
    const drought =
      lastYear === undefined ? years.size : [...years].filter((y) => y > lastYear).length;
    if (drought <= 0) continue;
    population.push({ owner, drought, neverWon: lastYear === undefined });
  }

  if (population.length === 0) return null;

  const droughtStanding = resolveSuperlative({
    population,
    isMember: (e) => activeOwners.has(e.owner),
    value: (e) => e.drought,
    owner: (e) => e.owner,
  });
  if (!droughtStanding) return null;

  const longestDrought = droughtStanding.best.drought;
  if (longestDrought < 2) return null;

  // Every MEMBER at the member maximum, so a shared drought names everyone who
  // holds it. `resolveSuperlative` answers which record the named owners stand
  // in relation to; it does not enumerate co-holders inside the membership.
  const tied = population
    .filter((e) => activeOwners.has(e.owner) && e.drought === longestDrought)
    .sort((a, b) => a.owner.localeCompare(b.owner));

  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const priority = Math.min(
    DROUGHT_PRIORITY_CAP,
    DROUGHT_BASE_PRIORITY + DROUGHT_PER_SEASON_BONUS * longestDrought
  );

  const allNeverWon = tied.every((e) => e.neverWon);
  const ownerNames = tied.map((e) => e.owner);
  const nameList = formatOwnerList(ownerNames);
  const droughtKnown = membershipIsKnown(membersSource);

  const holders = droughtStanding.recordHolders;
  const holdsRecord = holders.length === 0;
  const recordText = formatOwnerList(holders.map((h) => `${h.owner}'s ${h.value} seasons`));

  // Hook: never_won if every tied owner has no title; otherwise streak_extended.
  const hook: NewsHook = allNeverWon ? 'never_won' : 'streak_extended';

  // The FACT, with no superlative in it. Every claim about rank is appended
  // below, so no branch can quietly widen the sentence — which is how "the
  // longest active drought in the league" survived a membership gate that only
  // touched the word "active".
  const plural = tied.length > 1;
  const fact = allNeverWon
    ? `${nameList} ${plural ? 'have' : 'has'} never won a title in ${longestDrought} seasons`
    : `${nameList} ${plural ? "haven't" : "hasn't"} won a title in ${longestDrought} seasons`;

  // OWNER RULING (2026-08-19): say both, active first. The active standing is
  // stated when membership is known AND someone else holds the record; when the
  // named owners hold it outright there is nothing to compare against.
  // The voice survives the gate. "Still waiting for another ring" implies the
  // owner is playing and chasing one, so it is licensed only when membership is
  // known — but dropping it entirely, as the first version of this rewrite did,
  // trades a false claim for a flat one when the claim is true.
  const ring = droughtKnown && !allNeverWon && !plural ? ' Still waiting for another ring.' : '';
  const description = holdsRecord
    ? droughtKnown
      ? `${fact} — the longest active drought in the league.${ring}`
      : `${fact} — the longest title drought on record.`
    : droughtStanding.standing === 'shares'
      ? `${fact}, level with ${recordText}.`
      : droughtKnown
        ? `${fact} — the longest among active owners. ${recordText} ${holderVerb(holders, 'is', 'are')} the longest on record.`
        : `${fact}; ${recordText} ${holderVerb(holders, 'is', 'are')} the longest on record.`;

  // The TITLE carries the same partition. It renders one line above the body, so
  // a constant here re-asserts whatever the body just qualified — both reviewers
  // found that in INSIGHTS-023, and the first INSIGHTS-033 round left "Longest"
  // in place while removing only "active", which WIDENED a member-only claim to
  // a league-wide one.
  const noun = plural ? 'droughts' : 'drought';
  const title = !holdsRecord
    ? `Title ${noun}`
    : droughtKnown
      ? `Longest active title ${noun}`
      : `Longest title ${noun}`;

  return toInsight({
    id: `historical-drought-${ownerNames.map(ownerSlug).join('-')}`,
    type: 'drought',
    title,
    description,
    owner: ownerNames[0],
    relatedOwners: ownerNames.slice(1),
    priorityScore: priority,
    lifecycle: lifecycles,
    newsHook: hook,
    statValue: longestDrought,
  });
}

function deriveDynastyInsight(
  archives: SeasonArchive[],
  activeOwners: ReadonlySet<string>,
  lifecycles: LifecycleState[],
  membersSource: LeagueMembersSource
): Insight | null {
  if (archives.length === 0) return null;
  const sorted = sortedArchives(archives);

  const titleCounts = new Map<string, number>();
  // Track the last title year per owner for tie-breaking copy
  const lastTitleYear = new Map<string, number>();
  for (const archive of sorted) {
    const champion = championOf(archive);
    if (!champion) continue;
    titleCounts.set(champion, (titleCounts.get(champion) ?? 0) + 1);
    lastTitleYear.set(champion, archive.year);
  }

  // Find max title count among active owners only. Correct — this decides who
  // may be NAMED. The league record is resolved separately below (INSIGHTS-030);
  // taking the max over members and then calling it "the most in league history"
  // is the defect.
  let maxCount = 0;
  for (const owner of activeOwners) {
    const count = titleCounts.get(owner) ?? 0;
    if (count > maxCount) maxCount = count;
  }

  if (maxCount < 2) return null;

  // Collect all active owners tied at maxCount
  const tied: string[] = [];
  for (const owner of activeOwners) {
    if ((titleCounts.get(owner) ?? 0) === maxCount) tied.push(owner);
  }

  const priority = Math.min(
    DYNASTY_PRIORITY_CAP,
    DYNASTY_BASE_PRIORITY + DYNASTY_PER_TITLE_BONUS * maxCount
  );

  const latestYear = sorted[sorted.length - 1]!.year;
  // Did the current leader(s) add a title this year?
  const wonThisYear = tied.some((owner) => lastTitleYear.get(owner) === latestYear);

  // INSIGHTS-030 — the title record spans everyone who ever won one, including
  // champions who have since left the league. `titleCounts` is already that
  // population; only the naming list is filtered.
  const titleEntries = [...titleCounts].map(([owner, count]) => ({ owner, count }));
  const dynastyStanding = resolveSuperlative({
    population: titleEntries,
    isMember: (e) => activeOwners.has(e.owner),
    value: (e) => e.count,
    owner: (e) => e.owner,
  });
  const dynastyKnown = membershipIsKnown(membersSource);
  const titleHolders =
    dynastyStanding && dynastyStanding.standing !== 'holds' ? dynastyStanding.recordHolders : [];
  const titleRecord = titleHolders.length > 0;
  // `formatHolderNames`, not `join(' and ')` — three co-holders printed "Dave and
  // Erin and Frank's 3".
  const titleHolderNames = formatHolderNames(titleHolders);
  // The COMBINED list, formatted ONCE. `${a} and ${b}` where both sides are
  // already `and`/Oxford-joined rebuilds the exact "Dave and Erin and Frank"
  // shape the shared formatter exists to prevent — which is how the previous
  // round deleted one join and reintroduced it two lines later.
  const levelNames = (members: string[]): string =>
    formatOwnerList([...members, ...titleHolders.map((h) => h.owner)]);
  const titleRecordText = titleRecord
    ? ` ${titleHolderNames}'s ${titleHolders[0]!.value} ${holderVerb(titleHolders, 'remains', 'remain')} the league record.`
    : '';
  const shares = dynastyStanding?.standing === 'shares';

  if (tied.length === 1) {
    const topOwner = tied[0]!;
    const hook: NewsHook = wonThisYear ? 'streak_extended' : 'new_leader';
    const description = shares
      ? `${levelNames([topOwner])} are level on ${maxCount} league titles, the most in league history.`
      : titleRecord
        ? dynastyKnown
          ? `${topOwner} has ${maxCount} titles — the most of anyone still playing.${titleRecordText}`
          : `${topOwner} has ${maxCount} league titles.${titleRecordText}`
        : hook === 'streak_extended'
          ? `${topOwner} adds another title — now ${maxCount} in league history, the most ever.`
          : `${topOwner} now leads all-time with ${maxCount} titles — the most in league history.`;
    return toInsight({
      id: `historical-dynasty-${ownerSlug(topOwner)}`,
      type: 'dynasty',
      title: dynastyStanding?.standing === 'holds' ? 'Dynasty on record' : 'Title count',
      description,
      owner: topOwner,
      priorityScore: priority,
      lifecycle: lifecycles,
      newsHook: hook,
      statValue: maxCount,
    });
  }

  // Multiple active owners tied — find who won most recently
  tied.sort((a, b) => (lastTitleYear.get(b) ?? 0) - (lastTitleYear.get(a) ?? 0));
  const mostRecent = tied[0]!;
  const mostRecentYear = lastTitleYear.get(mostRecent) ?? 0;
  const othersAtSameYear = tied.filter((o) => (lastTitleYear.get(o) ?? 0) === mostRecentYear);

  // The MEMBER list, through the same formatter as the holder list. The last
  // round shared holder formatting and left this join — which then fed the two
  // new `shares` branches below, so "Alice and Bob and Carol" is copy this slice
  // introduced rather than inherited.
  const allNames = formatOwnerList(tied);
  // Shared top honors: returning_leader when somebody ties a prior dynasty.
  const hook: NewsHook = 'returning_leader';
  let description: string;
  if (shares) {
    description = `${levelNames(tied)} are level on ${maxCount} league titles, the most in league history.`;
  } else if (titleRecord) {
    description = dynastyKnown
      ? `${allNames} each own ${maxCount} league titles — the most of anyone still playing.${titleRecordText}`
      : `${allNames} each own ${maxCount} league titles.${titleRecordText}`;
  } else if (othersAtSameYear.length > 1) {
    description = `${allNames} each own ${maxCount} league titles — the most in league history.`;
  } else {
    const others = tied.filter((o) => o !== mostRecent);
    // The last one. `deriveDynastyInsight` has no tie-suppression threshold, so
    // four tied members with a unique most-recent champion reach this line.
    const othersStr = formatOwnerList(others);
    description = `${mostRecent} now ties ${othersStr} for most titles in league history with ${maxCount}.`;
  }

  return toInsight({
    id: `historical-dynasty-${tied.map(ownerSlug).join('-')}`,
    type: 'dynasty',
    title: dynastyStanding?.standing === 'holds' ? 'Dynasty on record' : 'Title count',
    description,
    owner: tied[0],
    relatedOwners: tied.slice(1),
    priorityScore: priority,
    lifecycle: lifecycles,
    newsHook: hook,
    statValue: maxCount,
  });
}

/**
 * Ordinal suffix. A third local copy — `career.ts` and `membership.ts` each have
 * one and their implementations differ — because unifying them means editing two
 * generators outside this slice's contract. Recorded as a follow-up rather than
 * folded in.
 */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${n % 10 <= 3 ? suffix : 'th'}`;
}

type SeasonClimb = {
  owner: string;
  gain: number;
  fromYear: number;
  toYear: number;
  fromPos: number;
  toPos: number;
};

/**
 * SEASON-TO-SEASON MOVEMENT — reconstructed in INSIGHTS-033 rather than patched
 * a fourth time. The model is `docs/architecture/insight-movement-model.md`.
 *
 * The old `deriveMostImprovedInsight` was wrong in four different ways across
 * three passes, and every one of them was a copy branch reading a partition
 * that had been computed correctly elsewhere: a season claim measured over
 * members only; `shares` collapsed into `trails` so a tie was reported as a
 * loss; an all-time comparison seeded from the member maximum so an equal climb
 * could not displace it; and finally an all-time STANDING attached to a
 * different owner's climb in a different year, which announced this season's
 * smaller move as the league record. That last one was introduced by the round
 * fixing the first three, which is what made reconstruction the right call.
 *
 * Two facts, so TWO CARDS (owner ruling, 2026-08-19):
 *
 *  - the biggest move of the most recent COMPLETED season, and
 *  - the biggest single-season move in league HISTORY.
 *
 * Neither filters by membership. A completed season's biggest mover is a fact
 * about that season the way its champion is, so the subject may be an owner who
 * has since left — licensed by AGENTS.md Insights invariant 5's exemption, which
 * holds ONLY while the copy names its season. Both cards therefore state their
 * years, and that is pinned by test rather than trusted.
 */
function deriveSeasonMovementInsights(
  archives: SeasonArchive[],
  lifecycles: LifecycleState[]
): Insight[] {
  if (archives.length < 2) return [];
  const sorted = sortedArchives(archives);

  // Every climb between every consecutive pair of seasons, for every owner.
  // ONE population, sliced two ways — the latest pair for the season card, all
  // of it for the record card. The previous implementation built the all-time
  // comparison by seeding an accumulator from the member maximum, which is how
  // an equal climb by a departed owner failed to register at all.
  const allClimbs: SeasonClimb[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const from = sorted[i - 1]!;
    const to = sorted[i]!;
    for (const row of to.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      const fromPos = positionOf(from, row.owner);
      const toPos = positionOf(to, row.owner);
      if (fromPos === null || toPos === null) continue;
      allClimbs.push({
        owner: row.owner,
        gain: fromPos - toPos,
        fromYear: from.year,
        toYear: to.year,
        fromPos,
        toPos,
      });
    }
  }
  if (allClimbs.length === 0) return [];

  const latestYear = sorted[sorted.length - 1]!.year;
  const insights: Insight[] = [];

  /** Everyone tied at the maximum gain in a slice, or `[]` if none clears the floor. */
  const leadersOf = (climbs: SeasonClimb[]): SeasonClimb[] => {
    const best = climbs.reduce((max, c) => (c.gain > max ? c.gain : max), 0);
    if (best < MIN_IMPROVEMENT_POSITIONS) return [];
    const leaders = climbs
      .filter((c) => c.gain === best)
      .sort((a, b) => a.owner.localeCompare(b.owner) || a.toYear - b.toYear);
    return leaders.length >= TIE_SUPPRESSION_THRESHOLD ? [] : leaders;
  };

  const seasonLeaders = leadersOf(allClimbs.filter((c) => c.toYear === latestYear));
  const recordLeaders = leadersOf(allClimbs);

  if (seasonLeaders.length > 0) {
    const gain = seasonLeaders[0]!.gain;
    const names = formatOwnerList(seasonLeaders.map((c) => c.owner));
    const only = seasonLeaders[0]!;
    const description =
      seasonLeaders.length === 1
        ? `${names} climbed from ${ordinal(only.fromPos)} to ${ordinal(only.toPos)} between ${only.fromYear} and ${only.toYear} — the biggest move of the ${only.toYear} season.`
        : `${names} each climbed ${gain} places between ${only.fromYear} and ${only.toYear} — the biggest move of the ${only.toYear} season.`;
    insights.push(
      toInsight({
        id: `season-swing-${latestYear}-${seasonLeaders.map((c) => ownerSlug(c.owner)).join('-')}`,
        type: 'improvement',
        // The YEAR is in the headline, not only the body. A card read out of
        // context is the case the exemption has to survive.
        title: `Biggest move of ${latestYear}`,
        description,
        owner: only.owner,
        relatedOwners: seasonLeaders.slice(1).map((c) => c.owner),
        priorityScore: Math.min(
          IMPROVEMENT_PRIORITY_CAP,
          IMPROVEMENT_BASE_PRIORITY + IMPROVEMENT_PER_POSITION_BONUS * gain
        ),
        lifecycle: lifecycles,
        newsHook: 'snapshot',
        statValue: gain,
      })
    );
  }

  // The record card is SUPPRESSED when it would name the same climbs the season
  // card just named — two cards carrying one sentence is worse than one card.
  const sameAsSeason =
    seasonLeaders.length === recordLeaders.length &&
    recordLeaders.every((r) =>
      seasonLeaders.some((s) => s.owner === r.owner && s.toYear === r.toYear)
    );

  if (recordLeaders.length > 0 && !sameAsSeason) {
    const gain = recordLeaders[0]!.gain;
    // Each holder carries their own years, so a shared record cannot collapse
    // into one owner's phrasing.
    const holderText = formatOwnerList(
      recordLeaders.map(
        (c) => `${c.owner}'s ${c.gain} places between ${c.fromYear} and ${c.toYear}`
      )
    );
    insights.push(
      toInsight({
        id: `season-swing-record-${recordLeaders.map((c) => ownerSlug(c.owner)).join('-')}`,
        type: 'improvement',
        title: 'Biggest single-season move on record',
        description: `${holderText} ${recordLeaders.length > 1 ? 'are' : 'is'} the biggest single-season move in league history.`,
        owner: recordLeaders[0]!.owner,
        relatedOwners: recordLeaders.slice(1).map((c) => c.owner),
        priorityScore: IMPROVEMENT_BASE_PRIORITY,
        lifecycle: lifecycles,
        newsHook: 'new_record',
        statValue: gain,
      })
    );
  }

  return insights;
}

function deriveConsistencyInsight(
  archives: SeasonArchive[],
  activeOwners: ReadonlySet<string>,
  lifecycles: LifecycleState[],
  membersSource: LeagueMembersSource
): Insight | null {
  if (archives.length < MIN_CONSISTENCY_SEASONS) return null;

  const topThreeCounts = new Map<string, number>();
  const appearances = new Map<string, number>();
  for (const archive of archives) {
    const topThree = archive.finalStandings.slice(0, 3);
    const seen = new Set<string>();
    for (const row of topThree) {
      if (!isEligibleOwner(row.owner)) continue;
      if (seen.has(row.owner)) continue;
      seen.add(row.owner);
      topThreeCounts.set(row.owner, (topThreeCounts.get(row.owner) ?? 0) + 1);
    }
    for (const row of archive.finalStandings) {
      if (!isEligibleOwner(row.owner)) continue;
      appearances.set(row.owner, (appearances.get(row.owner) ?? 0) + 1);
    }
  }

  const eligible: { owner: string; count: number }[] = [];
  for (const [owner, count] of topThreeCounts) {
    if (!activeOwners.has(owner)) continue;
    const seasonsPlayed = appearances.get(owner) ?? 0;
    if (seasonsPlayed < MIN_CONSISTENCY_SEASONS) continue;
    if (count < MIN_CONSISTENCY_SEASONS) continue;
    eligible.push({ owner, count });
  }

  if (eligible.length === 0) return null;

  const maxCount = eligible.reduce((max, e) => (e.count > max ? e.count : max), 0);
  if (maxCount < MIN_CONSISTENCY_SEASONS) return null;

  const tied = eligible
    .filter((e) => e.count === maxCount)
    .map((e) => e.owner)
    .sort((a, b) => a.localeCompare(b));

  if (tied.length >= TIE_SUPPRESSION_THRESHOLD) return null;

  const nameList = formatOwnerList(tied);
  const consistencyKnown = membershipIsKnown(membersSource);

  // Did the tied leader(s) just add a top-3 this year?
  const latestArchive = [...archives].sort((a, b) => a.year - b.year)[archives.length - 1];
  const justAddedTopThree = latestArchive
    ? latestArchive.finalStandings.slice(0, 3).some((row) => tied.includes(row.owner))
    : false;

  // Compute all-time max across all owners (active or not) to determine if this is a record.
  const allTimeMax = Array.from(topThreeCounts.values()).reduce((m, v) => Math.max(m, v), 0);
  const isRecord = maxCount >= allTimeMax;

  let hook: NewsHook;
  let description: string;
  if (justAddedTopThree && isRecord) {
    hook = 'streak_extended';
    // INSIGHTS-033 — the PRESENT tense is the claim. "finishes top-3 again"
    // describes an owner who is playing; the fact underneath is that they
    // finished top-3 in the most recent ARCHIVE. `isRecord` is measured over
    // every owner (`allTimeMax` above), so the record half needs no gate — only
    // the tense does.
    description = consistencyKnown
      ? tied.length === 1
        ? `${nameList} finishes top-3 again — ${maxCount} times in league history, the most ever.`
        : `${nameList} each finish top-3 again — ${maxCount} times in league history, the most ever.`
      : tied.length === 1
        ? `${nameList} has finished top-3 ${maxCount} times — the most in league history.`
        : `${nameList} have each finished top-3 ${maxCount} times — the most in league history.`;
  } else if (isRecord) {
    hook = 'new_record';
    description =
      tied.length === 1
        ? `${nameList} has finished in the top three ${maxCount} times — the most consistent performer in league history.`
        : `${nameList} have each finished in the top three ${maxCount} times — the most consistent performers in league history.`;
  } else {
    hook = 'snapshot';
    description =
      tied.length === 1
        ? `${nameList} has finished in the top three ${maxCount} seasons on record.`
        : `${nameList} have each finished in the top three in ${maxCount} seasons.`;
  }

  return toInsight({
    id: `historical-consistency-${tied.map(ownerSlug).join('-')}`,
    type: 'consistency',
    title: 'Consistency award',
    description,
    owner: tied[0],
    relatedOwners: tied.slice(1),
    priorityScore: CONSISTENCY_PRIORITY,
    lifecycle: lifecycles,
    newsHook: hook,
    statValue: maxCount,
  });
}

export const historicalGenerator: InsightGenerator = {
  id: 'historical',
  category: 'historical',
  supportedLifecycles: HISTORICAL_LIFECYCLES,
  generate(context: InsightContext): Insight[] {
    const archives = context.archives;
    if (archives.length === 0) return [];

    const activeOwners = context.leagueMembers;

    const insights: Insight[] = [];
    const drought = deriveDroughtInsight(
      archives,
      activeOwners,
      HISTORICAL_LIFECYCLES,
      context.leagueMembersSource
    );
    if (drought) insights.push(drought);

    const dynasty = deriveDynastyInsight(
      archives,
      activeOwners,
      HISTORICAL_LIFECYCLES,
      context.leagueMembersSource
    );
    if (dynasty) insights.push(dynasty);

    insights.push(...deriveSeasonMovementInsights(archives, HISTORICAL_LIFECYCLES));

    const consistency = deriveConsistencyInsight(
      archives,
      activeOwners,
      HISTORICAL_LIFECYCLES,
      context.leagueMembersSource
    );
    if (consistency) insights.push(consistency);

    return insights;
  },
};

registerGenerator(historicalGenerator);
