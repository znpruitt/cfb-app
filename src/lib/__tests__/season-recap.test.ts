import assert from 'node:assert/strict';
import test from 'node:test';

import { seasonWrapGenerator } from '../insights/generators/existing';
import { deriveChampionMarginInsight, deriveLeagueInsights } from '../selectors/insights';
import { decayFactor } from '../insights/variants';
import type { InsightContext } from '../insights/types';
import type { SeasonArchive } from '../seasonArchive';
import type { OwnerStandingsRow, StandingsSnapshot } from '../standings';
import type { StandingsHistory } from '../standingsHistory';

// ---------------------------------------------------------------------------
// INSIGHTS-032 — the season recap.
//
// The recap used to read `context.currentStandings`, which holds the finished
// season's finals in `postseason` and `fresh_offseason` but becomes the NEW
// season's 0-0 table the moment the year rolls over. Members arriving in
// preseason found no record of the year they had just played.
//
// This file pins the behaviour the slice settled, decision by decision. It is
// deliberately a reconstruction: the first attempt accumulated three remediation
// rounds and the findings kept landing on code written while remediating, so the
// behaviour was re-derived from clean `main` rather than patched further.
// ---------------------------------------------------------------------------

function row(
  owner: string,
  wins: number,
  losses: number,
  gamesBack: number,
  overrides: Partial<OwnerStandingsRow> = {}
): OwnerStandingsRow {
  const games = wins + losses;
  return {
    owner,
    wins,
    losses,
    winPct: games > 0 ? wins / games : 0,
    pointsFor: 300 + wins * 20,
    pointsAgainst: 300,
    pointDifferential: wins * 20,
    gamesBack,
    finalGames: games,
    ...overrides,
  };
}

/**
 * A weekly history in which `gapsByOwner` gives each owner's games-back series.
 * `partialFinalWeek` marks the last week's coverage incomplete, which is what
 * makes `selectResolvedStandingsWeeks` drop it — the only condition under which
 * the last RESOLVED week and the final table disagree.
 */
function history(
  weeks: number[],
  gapsByOwner: Record<string, number[]>,
  partialFinalWeek = false
): StandingsHistory {
  const owners = Object.keys(gapsByOwner);
  const byOwner: StandingsHistory['byOwner'] = {};
  const byWeek: StandingsHistory['byWeek'] = {};
  weeks.forEach((week, index) => {
    for (const owner of owners) {
      const gamesBack = gapsByOwner[owner]![index]!;
      (byOwner[owner] ??= []).push({
        week,
        wins: 6 - gamesBack,
        losses: gamesBack,
        ties: 0,
        winPct: 0.5,
        pointsFor: 300,
        pointsAgainst: 280,
        pointDifferential: 20,
        gamesBack,
      });
    }
    const ordered = [...owners].sort((a, b) => gapsByOwner[a]![index]! - gapsByOwner[b]![index]!);
    byWeek[week] = {
      week,
      standings: ordered.map((owner) => ({
        ...row(
          owner,
          6 - gapsByOwner[owner]![index]!,
          gapsByOwner[owner]![index]!,
          gapsByOwner[owner]![index]!
        ),
        ties: 0,
      })),
      coverage:
        partialFinalWeek && week === weeks[weeks.length - 1]
          ? { state: 'partial', message: null }
          : { state: 'complete', message: null },
    } as StandingsSnapshot extends never ? never : StandingsHistory['byWeek'][number];
  });
  return { weeks, byWeek, byOwner };
}

function archiveOf(
  year: number,
  finalStandings: OwnerStandingsRow[],
  standingsHistory: StandingsHistory
): SeasonArchive {
  return {
    leagueSlug: 'test',
    year,
    archivedAt: `${year + 1}-01-05T00:00:00.000Z`,
    ownerRosterSnapshot:
      'team,owner\n' + finalStandings.map((r, i) => `Team${i},${r.owner}`).join('\n'),
    standingsHistory,
    finalStandings: finalStandings.map((r) => ({ ...r, ties: 0 })),
    games: [],
    scoresByKey: {},
  };
}

function ctx(overrides: Partial<InsightContext> = {}): InsightContext {
  return {
    leagueSlug: 'test',
    currentYear: 2026,
    lifecycleState: 'preseason',
    seasonOwners: null,
    membershipDisagreement: [],
    seasonContext: 'in-season',
    currentWeek: null,
    currentStandings: [],
    weeklyStandings: [],
    games: [],
    ownerGameStats: null,
    ownerCareerStats: [],
    archives: [],
    historicalRosters: {},
    rankings: null,
    currentRoster: new Map(),
    leagueMembers: new Set(),
    leagueMembersSource: 'previous-roster',
    usingArchivedRoster: false,
    records: { career: [], season: [], rivalry: [], event: [] },
    ...overrides,
  };
}

// 2025 as played: Zoe won it, Yuri closed from 6 back to 3, Xavier sat last.
const WEEKS = [1, 2, 3, 4, 5, 6];
const HISTORY_2025 = history(WEEKS, {
  Zoe: [0, 0, 0, 0, 0, 0],
  Yuri: [6, 6, 6, 5, 4, 3],
  Wren: [2, 3, 4, 5, 5, 5],
  Xavier: [3, 4, 6, 7, 8, 8],
});
const FINAL_2025 = [
  row('Zoe', 11, 1, 0),
  row('Yuri', 8, 4, 3),
  row('Wren', 6, 6, 5),
  row('Xavier', 3, 9, 8),
];
const ARCHIVE_2025 = archiveOf(2025, FINAL_2025, HISTORY_2025);

/** The post-draft preseason state: rolled over, nobody has played. */
function preseason(overrides: Partial<InsightContext> = {}): InsightContext {
  return ctx({
    lifecycleState: 'preseason',
    currentYear: 2026,
    currentStandings: [row('Aaron', 0, 0, 0), row('Bex', 0, 0, 0)],
    archives: [ARCHIVE_2025],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The source: which table the recap reads
// ---------------------------------------------------------------------------

test('preseason describes the ARCHIVE, not the season about to start', () => {
  const insights = seasonWrapGenerator.generate(preseason());
  const champion = insights.find((i) => i.type === 'champion_margin');
  assert.ok(champion, `champion margin must fire from the archive; got ${insights.length} cards`);

  // The new table is led by Aaron and every margin in it is zero, so naming Zoe
  // with a real margin is only possible from the archive.
  assert.match(champion.description, /Zoe/);
  assert.doesNotMatch(champion.description, /Aaron|Bex/, 'the new season has not been played');
  assert.equal(champion.statValue, 3);
});

test('preseason requires the ADJACENT archive, not merely the newest', () => {
  // A league that skipped 2025 has 2024 as its newest archive; "last season's
  // champion" would then name a champion from two years ago.
  const stale = seasonWrapGenerator.generate(
    preseason({ archives: [archiveOf(2024, FINAL_2025, HISTORY_2025)] })
  );
  assert.equal(stale.length, 0, `a non-adjacent archive must produce nothing; got ${stale.length}`);

  // Anti-vacuity: the ONLY difference is the year.
  assert.ok(seasonWrapGenerator.generate(preseason()).length > 0);
});

test('an archive at or after the current year proves the projection stale', () => {
  // `currentYear` is a projection of the lifecycle authority. A league still IN
  // 2025 cannot already have 2025 archived, so the archive set contradicts the
  // year and the recap withholds rather than presenting 2024 as last season.
  const stale = seasonWrapGenerator.generate(
    preseason({
      currentYear: 2025,
      archives: [archiveOf(2024, FINAL_2025, HISTORY_2025), ARCHIVE_2025],
    })
  );
  assert.equal(stale.length, 0, `a stale projection must withhold; got ${stale.length}`);

  // Anti-vacuity: the same archive set one year forward is consistent.
  const consistent = seasonWrapGenerator.generate(
    preseason({
      currentYear: 2026,
      archives: [archiveOf(2024, FINAL_2025, HISTORY_2025), ARCHIVE_2025],
    })
  );
  assert.ok(consistent.length > 0, 'a consistent year and archive set must produce the recap');
});

test('a season nobody played produces no recap, from either source', () => {
  const unplayed = [row('Zoe', 0, 0, 0), row('Yuri', 0, 0, 0)];
  assert.equal(
    seasonWrapGenerator.generate(preseason({ archives: [archiveOf(2025, unplayed, HISTORY_2025)] }))
      .length,
    0,
    'an archive written for a league rolled straight over supports no claim'
  );
  assert.equal(
    seasonWrapGenerator.generate(
      ctx({ lifecycleState: 'fresh_offseason', seasonContext: 'final', currentStandings: unplayed })
    ).length,
    0,
    'a live table reads 0-0 across the board when score attachment has failed'
  );
  // Anti-vacuity for both paths.
  assert.ok(seasonWrapGenerator.generate(preseason()).length > 0);
  assert.ok(
    seasonWrapGenerator.generate(
      ctx({
        lifecycleState: 'fresh_offseason',
        seasonContext: 'final',
        currentStandings: FINAL_2025,
      })
    ).length > 0
  );
});

// ---------------------------------------------------------------------------
// The gate: only once the season is genuinely over
// ---------------------------------------------------------------------------

test('the recap is silent while the postseason is STILL RUNNING', () => {
  // `deriveLifecycleState` maps BOTH `seasonContext` values onto lifecycle
  // `postseason`, so the lifecycle alone cannot tell a finished season from one
  // mid-bracket. Announcing a champion then is the defect this guards.
  const running = seasonWrapGenerator.generate(
    ctx({ lifecycleState: 'postseason', seasonContext: 'postseason', currentStandings: FINAL_2025 })
  );
  assert.equal(
    running.length,
    0,
    `a season still being played has no recap; got ${running.length}`
  );
});

test('the recap DOES serve the completed season before rollover runs', () => {
  // The window a lifecycle-only gate destroys: rollover waits seven days after
  // the championship, and for that stretch the league is still `season` with
  // `seasonContext === 'final'` — lifecycle `postseason`. That is exactly when
  // members go looking for the recap.
  const settled = seasonWrapGenerator.generate(
    ctx({
      lifecycleState: 'postseason',
      seasonContext: 'final',
      currentYear: 2026,
      currentStandings: FINAL_2025,
    })
  );
  assert.ok(settled.length > 0, 'a finished season must have a recap before rollover');
  for (const insight of settled) assert.match(insight.title, /2026/);
});

test('the recap survives the whole offseason without vanishing', () => {
  // The lifecycle flips `fresh_offseason` -> `offseason` on a date cutoff.
  // Omitting `offseason` makes the recap appear, disappear mid-offseason, and
  // reappear in preseason at a lower weight — a present/absent/present sequence
  // that contradicts the ruling the decay curve is built on.
  for (const lifecycleState of ['fresh_offseason', 'offseason'] as const) {
    const insights = seasonWrapGenerator.generate(
      ctx({
        lifecycleState,
        seasonContext: 'final',
        currentYear: 2026,
        currentStandings: FINAL_2025,
      })
    );
    assert.ok(insights.length > 0, `the recap must be served in ${lifecycleState}`);
  }
});

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

test('preseason titles name the ARCHIVED year, never the season about to start', () => {
  for (const insight of seasonWrapGenerator.generate(preseason())) {
    assert.match(insight.title, /2025/, `must self-frame: ${insight.title}`);
    assert.doesNotMatch(insight.title, /2026/, `that season has not started: ${insight.title}`);
  }
});

test('the recap NAMES a departed owner, because the year makes it historical', () => {
  // Xavier sat last in 2025 and is not in the 2026 member set. Withholding the
  // card instead would make the recap dark until owners are confirmed and would
  // silently delete the champion card whenever last season's champion left —
  // a false impression created by omission.
  const insights = seasonWrapGenerator.generate(
    preseason({ leagueMembers: new Set(['Zoe', 'Yuri']), leagueMembersSource: 'confirmed' })
  );
  const throne = insights.find((i) => i.type === 'toilet_bowl');
  assert.ok(throne, 'the throne card must survive its owner leaving the league');
  assert.match(throne.description, /Xavier/);
  assert.match(
    throne.title,
    /2025/,
    'naming a departed owner is safe only when the season is named'
  );
});

test('an unknown membership does not withhold the recap', () => {
  // Before the draft, membership resolves to `previous-roster`. The recap makes
  // no participation claim, so it does not wait for confirmation.
  assert.ok(
    seasonWrapGenerator.generate(
      preseason({ leagueMembers: new Set(), leagueMembersSource: 'previous-roster' })
    ).length > 0
  );
});

test('the toilet-bowl copy keeps its UNIT — weeks, not titles', () => {
  const throne = seasonWrapGenerator.generate(preseason()).find((i) => i.type === 'toilet_bowl');
  assert.ok(throne);
  assert.match(
    throne.description,
    /week/,
    `"captured it N times" reads as N titles: ${throne.description}`
  );
});

// ---------------------------------------------------------------------------
// The tiebreak — and the reason this file exists
// ---------------------------------------------------------------------------

const LEVEL_LEADER = row('Zoe', 10, 2, 0, { pointDifferential: 90, pointsFor: 400 });
const LEVEL_RUNNER = row('Yuri', 10, 2, 0, { pointDifferential: 40, pointsFor: 380 });

test('a title decided level on wins EXPLAINS the deciding factor, on BOTH copy paths', () => {
  // `gamesBack` is `leaderWins - wins`, so a title between owners level on wins
  // has a margin of ZERO and the naive sentence is "by 0 games".
  //
  // BOTH paths are asserted deliberately. The first attempt at this slice fixed
  // the completed-season sentence and left `deriveLeagueInsights` — the set the
  // Standings tab renders — still printing "by 0 games". The margin phrase is
  // now built once and shared, so the two cannot diverge again.
  const completed = deriveChampionMarginInsight([LEVEL_LEADER, LEVEL_RUNNER], 2025);
  assert.ok(completed);
  assert.doesNotMatch(completed.description, /by 0 games/, completed.description);
  assert.match(completed.description, /point differential/, completed.description);

  const live = deriveChampionMarginInsight([LEVEL_LEADER, LEVEL_RUNNER]);
  assert.ok(live);
  assert.doesNotMatch(
    live.description,
    /by 0 games/,
    `the live path prints it too: ${live.description}`
  );
  assert.match(live.description, /point differential/, live.description);
});

test('a title separated ONLY by owner name is withheld', () => {
  // Level on every RANKED criterion: the standings sort falls back to the name.
  // That is a display tiebreak, not a reason anyone won.
  const twin = row('Yuri', 10, 2, 0, { pointDifferential: 90, pointsFor: 400 });
  assert.equal(deriveChampionMarginInsight([LEVEL_LEADER, twin], 2025), null);
  assert.equal(deriveChampionMarginInsight([LEVEL_LEADER, twin]), null);

  // Anti-vacuity: one differing criterion restores the card on both paths.
  assert.ok(deriveChampionMarginInsight([LEVEL_LEADER, LEVEL_RUNNER], 2025));
  assert.ok(deriveChampionMarginInsight([LEVEL_LEADER, LEVEL_RUNNER]));
});

// ---------------------------------------------------------------------------
// The chase
// ---------------------------------------------------------------------------

test('the chase measures the SLOPE, not the finishing position', () => {
  const chase = seasonWrapGenerator.generate(preseason()).find((i) => i.type === 'failed_chase');
  assert.ok(chase, 'Yuri closed on the lead and still lost — that is the card');
  // The window is the final three RESOLVED weeks, so the baseline is week 4,
  // where Yuri sat 5 back; the final table has him 3 back. Ground gained is
  // measured baseline -> FINAL TABLE, so it is 2, not the 3 he shed across the
  // whole season. The card says "over the final N weeks" and means it.
  assert.equal(chase.statValue, 2, 'ground gained, measured to the final table');

  // An owner who never gained ground is a finish, not a chase. Wren drifts from
  // 2 back to 5, and nobody else closes.
  const drifting = history(WEEKS, {
    Zoe: [0, 0, 0, 0, 0, 0],
    Yuri: [3, 3, 3, 3, 3, 3],
    Wren: [2, 3, 4, 5, 5, 5],
    Xavier: [3, 4, 6, 7, 8, 8],
  });
  const none = seasonWrapGenerator.generate(
    preseason({ archives: [archiveOf(2025, FINAL_2025, drifting)] })
  );
  assert.ok(
    !none.some((i) => i.type === 'failed_chase'),
    'holding a steady deficit is not closing a gap'
  );
});

test('the chase states ONE deficit when the final week is unresolved', () => {
  // Mutation-found, and the same gap the first attempt at this slice carried:
  // every ordinary fixture has the last resolved week agreeing with the final
  // table, so measuring the slope to the wrong endpoint is invisible. They
  // diverge only when the final week's coverage is incomplete and
  // `selectResolvedStandingsWeeks` drops it — and then the card can pair a slope
  // with a finish it does not belong to.
  //
  // Week 6 is unresolved, so the window is weeks 3-5. Yuri is 6 back at week 3
  // and finishes 3 back in the FINAL TABLE, so he cut 3. Measuring to week 5
  // (4 back) would say 2.
  const unresolvedTail = history(
    WEEKS,
    {
      Zoe: [0, 0, 0, 0, 0, 0],
      Yuri: [6, 6, 6, 5, 4, 3],
      Wren: [2, 3, 4, 5, 5, 5],
      Xavier: [3, 4, 6, 7, 8, 8],
    },
    true
  );
  const chase = seasonWrapGenerator
    .generate(preseason({ archives: [archiveOf(2025, FINAL_2025, unresolvedTail)] }))
    .find((i) => i.type === 'failed_chase');

  assert.ok(chase, 'an unresolved final week must not silence the card');
  assert.equal(chase.statValue, 3, 'ground gained is measured to the FINAL TABLE');
  assert.match(chase.description, /cut 3 games/, chase.description);
  assert.match(chase.description, /finished 3 games back/, chase.description);
});

test('a chase that CAUGHT the leader is not a failed chase', () => {
  // The card's claim is "closed ground and still came up short". An owner level
  // with the leader did not come up short, and "finished 0 games back" is not a
  // thin story but a false one.
  const caught = [row('Zoe', 11, 1, 0), row('Yuri', 11, 1, 0, { pointDifferential: 10 })];
  const insights = seasonWrapGenerator.generate(
    preseason({ archives: [archiveOf(2025, caught, HISTORY_2025)] })
  );
  assert.ok(
    !insights.some((i) => i.type === 'failed_chase'),
    'an owner level with the leader did not come up short'
  );
});

test('the chase names the leader ONLY when the same owner led throughout', () => {
  // `gamesBack` is measured against whoever led IN THAT WEEK. If the lead changed
  // inside the window, ground gained on an earlier leader is not ground gained on
  // the eventual champion, and crediting it to them is a false claim about two
  // named people.
  const chase = seasonWrapGenerator.generate(preseason()).find((i) => i.type === 'failed_chase');
  assert.ok(chase);
  assert.match(chase.description, /Zoe's lead/, 'Zoe led every week of the fixture');
  assert.deepEqual(chase.relatedOwners, ['Zoe']);

  // Wren leads THE BASELINE WEEK (week 4, where the window opens); Zoe still
  // wins. Yuri's gains therefore came off Wren, not off the eventual champion.
  // An earlier draft of this fixture had Zoe already leading by week 4, so it
  // never exercised a leader change at all.
  const changed = history(WEEKS, {
    Zoe: [5, 5, 5, 1, 0, 0],
    Yuri: [6, 6, 6, 6, 5, 3],
    Wren: [0, 0, 0, 0, 4, 5],
    Xavier: [3, 4, 6, 7, 8, 8],
  });
  const shifted = seasonWrapGenerator
    .generate(preseason({ archives: [archiveOf(2025, FINAL_2025, changed)] }))
    .find((i) => i.type === 'failed_chase');
  assert.ok(shifted, 'the card still fires — only the attribution changes');
  assert.doesNotMatch(
    shifted.description,
    /Zoe/,
    `gains on an earlier leader must not be credited to the champion: ${shifted.description}`
  );
  assert.deepEqual(shifted.relatedOwners, [], 'no owner may be implied by metadata either');
});

// ---------------------------------------------------------------------------
// Navigation and ageing
// ---------------------------------------------------------------------------

test('archive-served cards carry their season; live-served cards do not', () => {
  for (const insight of seasonWrapGenerator.generate(preseason())) {
    assert.equal(insight.season, 2025, `${insight.type} must carry the season it describes`);
  }
  // On the live path the described season IS the one on screen, so the override
  // must stay absent or navigation would redirect a current-season card.
  for (const insight of seasonWrapGenerator.generate(
    ctx({ lifecycleState: 'fresh_offseason', seasonContext: 'final', currentStandings: FINAL_2025 })
  )) {
    assert.equal(insight.season, undefined, `${insight.type} describes the season being viewed`);
  }
});

test('the recap declares season_recap decay and fades only in preseason', () => {
  for (const insight of seasonWrapGenerator.generate(preseason())) {
    assert.equal(insight.decay, 'season_recap', `${insight.type} must declare its ageing policy`);
  }
  for (const state of ['postseason', 'fresh_offseason', 'offseason']) {
    assert.equal(decayFactor('season_recap', state), 1, `${state} is full weight`);
  }
  const preseasonFactor = decayFactor('season_recap', 'preseason');
  assert.ok(
    preseasonFactor < 1,
    `the recap must fade once preseason arrives; got ${preseasonFactor}`
  );

  // The ruling was that DRAFT results outrank the recap once they exist. The
  // membership cards reporting the draft score 80-84.
  const champion = seasonWrapGenerator
    .generate(preseason())
    .find((i) => i.type === 'champion_margin');
  assert.ok(champion);
  assert.ok(
    Math.round(champion.priorityScore * preseasonFactor) < 80,
    'the recap must rank below the draft-result cards in preseason'
  );
});

test('the panel path keeps live-table wording, never a completed-season title', () => {
  // `deriveLeagueInsights` serves both panels a table that may still be in
  // progress, so "How 2026 finished" would be false there.
  for (const insight of deriveLeagueInsights({
    rows: FINAL_2025,
    standingsHistory: HISTORY_2025,
    seasonContext: 'final',
  })) {
    assert.doesNotMatch(
      insight.title,
      /^How \d{4}/,
      `live path must not claim finality: ${insight.title}`
    );
  }
});
