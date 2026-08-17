import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildRosterScheduleProfile, rankBySelfGames } from '@/lib/insights/rosterSchedule';
import { rosterScheduleGenerator } from '@/lib/insights/generators/rosterSchedule';
import {
  applyInsightDecay,
  applyInsightVariants,
  DECAY_FLOOR,
  rotationBucket,
  selectInsightVariant,
} from '@/lib/insights/variants';
import type { AppGame } from '@/lib/schedule';
import type { InsightContext } from '@/lib/insights/types';
import type { Insight } from '@/lib/selectors/insights';

// ---------------------------------------------------------------------------
// INSIGHTS-031 — roster x schedule.
//
// A game between two of one owner's teams banks a win and a loss: two
// roster-games that move nobody, in a league decided by wins over OTHERS.
//
// Everything here is a COUNT. There is no record measured over one population
// and claimed over another, which is the axis every defect in INSIGHTS-030 and
// 023 came from — so these tests are about arithmetic, gating, and copy that
// matches the number it reports.
// ---------------------------------------------------------------------------

function game(home: string, away: string, week = 1): AppGame {
  return {
    key: `${home}-${away}-${week}`,
    week,
    csvHome: home,
    csvAway: away,
    canHome: home,
    canAway: away,
    status: 'scheduled',
  } as unknown as AppGame;
}

function roster(pairs: Array<[string, string]>): Map<string, string> {
  return new Map(pairs);
}

function contextWith(games: AppGame[], teamOwners: Array<[string, string]>): InsightContext {
  return {
    games,
    currentRoster: roster(teamOwners),
    usingArchivedRoster: false,
  } as unknown as InsightContext;
}

// ---------------------------------------------------------------------------
// The computation.
// ---------------------------------------------------------------------------

test('a self-game counts ONCE, not once per side', () => {
  // The owner appears on both sides, but it is a single fixture. Counting it
  // twice would double every headline number in the copy.
  const profile = buildRosterScheduleProfile(
    [game('Georgia', 'Alabama')],
    roster([
      ['Georgia', 'Alice'],
      ['Alabama', 'Alice'],
    ])
  );

  const alice = profile.byOwner.get('Alice');
  assert.equal(alice?.selfGames, 1);
  assert.equal(alice?.totalGames, 1, 'and the game is counted once overall too');
});

test('a game between two owners credits both, and neither as a self-game', () => {
  const profile = buildRosterScheduleProfile(
    [game('Georgia', 'Clemson')],
    roster([
      ['Georgia', 'Alice'],
      ['Clemson', 'Bob'],
    ])
  );

  assert.equal(profile.byOwner.get('Alice')?.selfGames, 0);
  assert.equal(profile.byOwner.get('Bob')?.selfGames, 0);
  assert.equal(profile.byOwner.get('Alice')?.againstByOwner.get('Bob'), 1);
  assert.equal(profile.byOwner.get('Bob')?.againstByOwner.get('Alice'), 1);
});

test('a game against an undrafted team is tracked separately', () => {
  // These are the mirror image of self-games: only one side is owned, so only
  // one participation reaches the standings and no loss is credited to anyone.
  const profile = buildRosterScheduleProfile(
    [game('Georgia', 'Nobody State')],
    roster([['Georgia', 'Alice']])
  );

  const alice = profile.byOwner.get('Alice');
  assert.equal(alice?.againstUndrafted, 1);
  assert.equal(alice?.selfGames, 0);
});

test('a game touching no roster is ignored entirely', () => {
  const profile = buildRosterScheduleProfile(
    [game('Nobody State', 'Nowhere Tech')],
    roster([['Georgia', 'Alice']])
  );
  assert.equal(profile.byOwner.size, 0);
});

test('rankBySelfGames drops owners with none and breaks ties by name', () => {
  const profile = buildRosterScheduleProfile(
    [game('Georgia', 'Alabama'), game('Clemson', 'Auburn'), game('Texas', 'Utah')],
    roster([
      ['Georgia', 'Zoe'],
      ['Alabama', 'Zoe'],
      ['Clemson', 'Amy'],
      ['Auburn', 'Amy'],
      ['Texas', 'Bob'],
      ['Utah', 'Cal'],
    ])
  );

  const ranked = rankBySelfGames(profile);
  assert.deepEqual(
    ranked.map((p) => p.owner),
    ['Amy', 'Zoe'],
    'both at 1, alphabetical; Bob and Cal have none and are dropped'
  );
});

// ---------------------------------------------------------------------------
// Gating.
// ---------------------------------------------------------------------------

/** Six owners, one of whom holds `selfGames` intra-roster fixtures. */
function leagueWhere(selfGamesByOwner: Record<string, number>): InsightContext {
  const games: AppGame[] = [];
  const owners: Array<[string, string]> = [];
  let teamNo = 0;
  for (const [owner, count] of Object.entries(selfGamesByOwner)) {
    for (let i = 0; i < count; i += 1) {
      const home = `T${(teamNo += 1)}`;
      const away = `T${(teamNo += 1)}`;
      owners.push([home, owner], [away, owner]);
      games.push(game(home, away, i + 1));
    }
    // One game against a shared opponent so an owner with zero self-games still
    // has a roster and appears in the profile.
    const solo = `S${(teamNo += 1)}`;
    owners.push([solo, owner]);
    games.push(game(solo, 'Unowned U', 12));
  }
  return contextWith(games, owners);
}

test('a borrowed roster produces NOTHING', () => {
  // Before a draft, `currentRoster` is last season's map. Running it against
  // this season's schedule gives numbers that are wrong and look right.
  const context = {
    ...leagueWhere({ A: 8, B: 1, C: 0, D: 0, E: 0, F: 0 }),
    usingArchivedRoster: true,
  } as InsightContext;

  assert.deepEqual(rosterScheduleGenerator.generate(context), []);
});

test('an empty roster produces nothing', () => {
  const context = contextWith([game('Georgia', 'Alabama')], []);
  assert.deepEqual(rosterScheduleGenerator.generate(context), []);
});

test('a league too small to compare produces nothing', () => {
  const context = leagueWhere({ A: 8, B: 0 });
  assert.deepEqual(rosterScheduleGenerator.generate(context), []);
});

test('below the floor, the bad-bet insight stays quiet', () => {
  // Measured threshold: leaders ran 5-8 across 20 simulated drafts with a league
  // median of 3, so a flat league has no story and should say nothing.
  const context = leagueWhere({ A: 5, B: 4, C: 4, D: 4, E: 3, F: 3 });
  const types = rosterScheduleGenerator.generate(context).map((i) => i.type);
  assert.ok(!types.includes('self_schedule_heavy'), `saw ${types.join(', ')}`);
});

test('a league where everyone is level has no cleanest board', () => {
  const context = leagueWhere({ A: 2, B: 2, C: 2, D: 2, E: 2, F: 2 });
  const types = rosterScheduleGenerator.generate(context).map((i) => i.type);
  assert.ok(!types.includes('self_schedule_clean'), `saw ${types.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Copy that matches the number it reports.
// ---------------------------------------------------------------------------

function generateOne(context: InsightContext, type: string): Insight {
  const found = rosterScheduleGenerator.generate(context).find((i) => i.type === type);
  assert.ok(
    found,
    `expected a ${type} insight; got ${
      rosterScheduleGenerator
        .generate(context)
        .map((i) => i.type)
        .join(', ') || 'none'
    }`
  );
  return found;
}

test('ZERO self-games gets its own wording, never "a single time"', () => {
  // The first version of this copy hardcoded "a single time" because the
  // simulated distribution bottomed out at 1 — so a league whose cleanest board
  // had NONE was told it had one. Zero is the best possible outcome and the case
  // that most deserves a correct sentence.
  const context = leagueWhere({ A: 8, B: 5, C: 4, D: 3, E: 2, F: 0 });
  const clean = generateOne(context, 'self_schedule_clean');

  assert.equal(clean.statValue, 0);
  for (const variant of clean.descriptionVariants ?? []) {
    assert.doesNotMatch(variant, /single time|once|twice|0 times/, `wrong count: ${variant}`);
    assert.match(variant, /F/, 'and it names the owner');
  }
});

test('every tie is named in full, with no quantifier that breaks at three', () => {
  // "both drafted" and "on either board" read fine at two and are wrong at
  // three. Ties at the top were the most common outcome in simulation, and
  // three-way ties happened, so the stems carry no count word at all.
  const context = leagueWhere({ A: 7, B: 7, C: 7, D: 1, E: 1, F: 1 });
  const heavy = generateOne(context, 'self_schedule_heavy');

  for (const variant of heavy.descriptionVariants ?? []) {
    assert.match(variant, /A, B, and C/, `all three must be named: ${variant}`);
    assert.doesNotMatch(variant, /\bboth\b|\beither\b|\bneither\b/, `breaks at three: ${variant}`);
  }
});

test('the reported count matches the stat it carries', () => {
  const context = leagueWhere({ A: 8, B: 2, C: 2, D: 1, E: 1, F: 0 });
  const heavy = generateOne(context, 'self_schedule_heavy');
  assert.equal(heavy.statValue, 8);
  for (const variant of heavy.descriptionVariants ?? []) {
    assert.match(variant, /\b8\b/, `copy must state the number it reports: ${variant}`);
  }
});

// ---------------------------------------------------------------------------
// Variant rotation — and where it is allowed to happen.
// ---------------------------------------------------------------------------

const sample = (id: string, variants: string[]): Insight =>
  ({ id, description: variants[0]!, descriptionVariants: variants }) as Insight;

test('the generator emits every variant and picks NONE', () => {
  // AGENTS.md invariant 3: time-dependent classification belongs in consumers.
  // Generators run inside `unstable_cache`, so a generator that chose "this
  // week's wording" would bake one week's choice into the cached entry and it
  // would persist until someone manually invalidated the tag.
  const context = leagueWhere({ A: 8, B: 2, C: 2, D: 1, E: 1, F: 0 });
  for (const insight of rosterScheduleGenerator.generate(context)) {
    assert.ok((insight.descriptionVariants?.length ?? 0) > 1, 'more than one wording');
    assert.equal(
      insight.description,
      insight.descriptionVariants?.[0],
      'description is the first variant verbatim — no selection has happened yet'
    );
  }

  // And the generator source must not reach for the clock.
  const src = readFileSync(
    fileURLToPath(new URL('../generators/rosterSchedule.ts', import.meta.url)),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Date\.now\(\)|new Date\(/, 'no clock inside a cached generator');
});

test('the same reading always picks the same wording', () => {
  const insight = sample('x', ['one', 'two', 'three']);
  const day = new Date('2026-09-01T12:00:00Z');
  assert.equal(selectInsightVariant(insight, day), selectInsightVariant(insight, day));
});

test('the wording advances across rotation buckets', () => {
  const insight = sample('x', ['one', 'two', 'three']);
  const seen = new Set<string>();
  for (let week = 0; week < 6; week += 1) {
    seen.add(selectInsightVariant(insight, new Date(Date.UTC(2026, 8, 1 + week * 7))));
  }
  assert.ok(seen.size > 1, `expected the wording to move; saw only ${[...seen]}`);
});

test('the wording depends on the insight ID, not on the date alone', () => {
  // Seeded by id as well as bucket, so the whole feed does not switch on the
  // same day and read as the app being rewritten.
  //
  // The first version of this test asserted that no two insights EVER share an
  // index, which a hash cannot promise: ids whose hashes are congruent modulo
  // the pool size sit together forever, and roughly one pair in three does. The
  // property that actually holds is that the index is a function of the id — so
  // across a handful of ids at one instant, they do not all agree.
  const day = new Date(Date.UTC(2026, 8, 15));
  const pool = ['v1', 'v2', 'v3'];
  const indexAt = (id: string): number => pool.indexOf(selectInsightVariant(sample(id, pool), day));

  const indexes = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(indexAt));
  assert.ok(indexes.size > 1, `every id landed on the same variant: ${[...indexes]}`);
});

test('an insight without variants is returned untouched', () => {
  const plain = { id: 'p', description: 'as written' } as Insight;
  const [out] = applyInsightVariants([plain], new Date());
  assert.equal(out, plain, 'same object — nothing to rotate, nothing copied');
});

test('a whole feed rotates on ONE clock reading', () => {
  const day = new Date(Date.UTC(2026, 8, 15));
  const feed = [sample('alpha', ['a1', 'a2']), sample('beta', ['b1', 'b2'])];
  const out = applyInsightVariants(feed, day);
  for (const [i, insight] of out.entries()) {
    assert.equal(insight.description, selectInsightVariant(feed[i]!, day));
  }
});

test('rotationBucket advances exactly once per cadence', () => {
  // Buckets are anchored to the EPOCH, not to a season or a league start, so
  // every league turns over on the same boundary and none needs a stored anchor.
  //
  // That means an arbitrary date plus six days may still cross a boundary — the
  // first version of this test assumed the window began where I picked it, and
  // failed for that reason rather than for a defect. The properties that do hold
  // are these two.
  const day = new Date(Date.UTC(2026, 8, 15));
  const week = 7 * 86_400_000;

  assert.equal(
    rotationBucket(new Date(day.getTime() + week)),
    rotationBucket(day) + 1,
    'exactly one bucket per cadence, from any starting instant'
  );

  // Constant across a full cadence measured from a real boundary.
  const boundary = new Date(rotationBucket(day) * 7 * 86_400_000);
  for (const hours of [0, 1, 24, 6 * 24, 7 * 24 - 1]) {
    assert.equal(
      rotationBucket(new Date(boundary.getTime() + hours * 3_600_000)),
      rotationBucket(boundary),
      `stable ${hours}h into the window`
    );
  }
  assert.equal(
    rotationBucket(new Date(boundary.getTime() + week)),
    rotationBucket(boundary) + 1,
    'and moves at the far edge'
  );
});

// ---------------------------------------------------------------------------
// The trap.
// ---------------------------------------------------------------------------

test('both new types are registered in the Overview priority map', () => {
  // `deriveOverviewInsights` ranks by `priorityScore + (OVERVIEW_TYPE_PRIORITY[type] ?? 0)`,
  // and the listed types carry +54 to +120. An UNREGISTERED type scores +0 and
  // loses to every existing insight, so it would generate correctly and never
  // appear — a silent no-op with green tests. Registration is part of shipping
  // the feature.
  const src = readFileSync(
    fileURLToPath(new URL('../../selectors/insights.ts', import.meta.url)),
    'utf8'
  );
  const map = /const OVERVIEW_TYPE_PRIORITY[^{]*\{([\s\S]*?)\n\};/.exec(src);
  assert.ok(map, 'the priority map must be readable to be pinned');
  assert.match(map[1]!, /self_schedule_heavy:/, 'the bad-bet type must be ranked');
  assert.match(map[1]!, /self_schedule_clean:/, 'the good-bet type must be ranked');

  // Anti-vacuity: the detector must be able to tell a listed type from an absent
  // one, or the two assertions above prove nothing.
  assert.doesNotMatch(map[1]!, /definitely_not_a_type:/);
});

// ---------------------------------------------------------------------------
// Decay — the other thing allowed to depend on the clock.
// ---------------------------------------------------------------------------

const decaying = (score: number): Insight =>
  ({ id: 'd', description: 'x', priorityScore: score, decay: 'draft' }) as Insight;

test('a draft fact keeps full weight until the season is underway', () => {
  for (const lifecycle of ['preseason', 'early_season']) {
    const [out] = applyInsightDecay([decaying(80)], lifecycle);
    assert.equal(out?.priorityScore, 80, `full weight in ${lifecycle}`);
  }
});

test('a draft fact loses weight as the draft recedes', () => {
  const mid = applyInsightDecay([decaying(80)], 'mid_season')[0]!;
  const late = applyInsightDecay([decaying(80)], 'late_season')[0]!;
  assert.ok(mid.priorityScore < 80, 'mid-season is below full');
  assert.ok(late.priorityScore < mid.priorityScore, 'and late-season below mid');
});

test('decay lands on a FLOOR, never zero', () => {
  // A small pool means an insight that disappears takes content with it on
  // exactly the weeks that have least. It should stop competing, not vanish.
  for (const lifecycle of ['late_season', 'postseason', 'offseason', 'something_unknown']) {
    const [out] = applyInsightDecay([decaying(80)], lifecycle);
    assert.ok((out?.priorityScore ?? 0) > 0, `still scoring in ${lifecycle}`);
    assert.equal(out?.priorityScore, Math.round(80 * DECAY_FLOOR), `at the floor in ${lifecycle}`);
  }
});

test('an insight with no decay policy is untouched at any point in the season', () => {
  const plain = { id: 'p', description: 'x', priorityScore: 80 } as Insight;
  for (const lifecycle of ['preseason', 'mid_season', 'offseason']) {
    const [out] = applyInsightDecay([plain], lifecycle);
    assert.equal(out, plain, `same object in ${lifecycle} — nothing to decay`);
  }
});

test('the generator declares decay and never applies it', () => {
  // Same rule that moved variant selection out: a score decayed inside
  // `unstable_cache` freezes at whatever lifecycle warmed the entry.
  const context = leagueWhere({ A: 8, B: 2, C: 2, D: 1, E: 1, F: 0 });
  for (const insight of rosterScheduleGenerator.generate(context)) {
    assert.equal(insight.decay, 'draft', 'the policy is declared');
    assert.ok(insight.priorityScore >= 68, 'and the score is the undecayed base');
  }
});

test('the serving path actually applies decay and variants', () => {
  // WIRING, not behaviour, and that is a deliberate downgrade.
  //
  // Removing the `applyInsightDecay` call from `loadInsights` failed nothing:
  // every test above exercises the helper in isolation or checks that the
  // generator declares its policy. A helper that is correct and never called is
  // the same defect as a helper that is wrong.
  //
  // A behavioural pin needs a seeded post-draft league with a cached schedule in
  // a mid-season lifecycle — a fixture this slice does not otherwise need.
  // Recorded in docs/next-tasks.md rather than faked.
  const src = readFileSync(fileURLToPath(new URL('../loadInsights.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert.match(src, /applyInsightDecay\(/, 'decay must be applied on the way out');
  assert.match(src, /applyInsightVariants\(/, 'and so must the variant pick');

  // Anti-vacuity: the detector must be able to tell a present call from an
  // absent one, and comment-stripping must not be what makes it pass.
  assert.doesNotMatch(src, /applyInsightDefinitelyNotACall\(/);
  assert.match(
    '  const x = applyInsightDecay(served, lifecycleState);'.replace(/\/\/.*$/gm, ''),
    /applyInsightDecay\(/,
    'the detector still matches real code after stripping'
  );
});
