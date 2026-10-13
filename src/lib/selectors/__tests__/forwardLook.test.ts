import {
  composeFixtureForwardLook,
  selectFixtureForwardLookInputs,
} from '../../../test/forwardLookFixtures.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseForwardLook } from '../../recap/parseForwardLook.ts';
import { composeWeeklyRecap } from '../../recap/composeWeeklyRecap.ts';
import {
  addRivalry,
  forwardContext,
  forwardGame,
  forwardOdds,
  forwardScore,
  FORWARD_NOW,
  FORWARD_SCOPE,
} from '../../../test/forwardLookFixtures.ts';
import {
  mergeForwardLookLines,
  selectForwardStandings,
  selectForwardUpsets,
  selectVisibleForwardLook,
  type ForwardLookLine,
} from '../forwardLook.ts';
import { prepareForwardLookHistory, selectForwardRivalries } from '../forwardLookRivalries.ts';
import { selectWeeklyRecapTileState } from '../weeklyRecapFacts.ts';
import { selectOverviewViewModel } from '../overview.ts';

test('Forward Look changes over at the real Thursday boundary minute and ends at next eligibility', () => {
  const context = forwardContext();
  const before = new Date('2026-10-08T09:59:00Z');
  const result = { status: 'available' as const, context };
  const recap = composeWeeklyRecap(result, before, FORWARD_SCOPE);
  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') throw new Error('fixture must produce recap');
  const look = composeFixtureForwardLook(result, before, FORWARD_SCOPE);
  assert.ok(look);
  assert.equal(
    selectWeeklyRecapTileState({ week: recap.week, latestGameDate: recap.latestGameDate }, before),
    'recap'
  );
  assert.equal(selectVisibleForwardLook(look, before), null, 'before cutoff remains recap');
  assert.equal(
    selectVisibleForwardLook(look, FORWARD_NOW)?.weekLabel,
    'Week 6',
    '06:00 ET occupies the zone'
  );
  assert.ok(
    selectVisibleForwardLook(look, new Date('2026-10-11T09:59:00Z')),
    'empty late-week tile persists'
  );
  assert.equal(
    selectVisibleForwardLook(look, new Date('2026-10-11T10:00:00Z')),
    null,
    'next recap eligibility ends this preview'
  );
  context.games = [
    forwardGame('fall-prior', 10, '2026-11-07T19:00:00Z'),
    forwardGame('fall-next', 11, '2026-11-14T19:00:00Z'),
  ];
  const winter = composeFixtureForwardLook(result, new Date('2026-11-12T10:59:00Z'), FORWARD_SCOPE);
  assert.ok(winter);
  assert.equal(selectVisibleForwardLook(winter, new Date('2026-11-12T10:59:00Z')), null);
  assert.ok(
    selectVisibleForwardLook(winter, new Date('2026-11-12T11:00:00Z')),
    'standard-time boundary is 11 UTC'
  );
});

test('Forward Look excludes kicked, final, disrupted, unknown-time and placeholder games without skipping the immediate week', () => {
  const context = forwardContext();
  const variants = [
    { key: 'kicked', date: '2026-10-07T00:00:00Z' },
    { key: 'exact-kickoff', date: FORWARD_NOW.toISOString() },
    { key: 'final', completed: true },
    { key: 'score-final' },
    { key: 'disrupted', rawStatus: 'STATUS_POSTPONED' },
    { key: 'unknown-time', startTimeTBD: true },
    { key: 'placeholder', isPlaceholder: true },
    { key: 'unknown-date', date: null },
  ];
  context.games.push(
    ...variants.map((variant) => ({ ...forwardGame(variant.key), ...variant })),
    forwardGame('later', 8, '2026-10-24T19:00:00Z')
  );
  context.scoresByKey['score-final'] = forwardScore();
  const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  assert.deepEqual(
    inputs.games.map((game) => game.key),
    ['collision'],
    'only the unstarted immediate-week game is eligible'
  );
  context.games = context.games.filter((game) => game.key !== 'collision');
  const empty = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  assert.equal(empty.target.week, 6, 'do not advance to week 8 to find a story');
  assert.deepEqual(empty.games, []);
});

test('Forward Look ranks an unranked close collision above a nationally ranked low-stakes game', () => {
  const context = forwardContext();
  context.rosterByTeam.set('Alabama', 'Carol');
  context.rosterByTeam.set('Ohio State', 'Dan');
  const ranked = {
    ...forwardGame('ranked', 6, '2026-10-10T20:00:00Z', 'Alabama', 'Ohio State'),
    homeRank: 1,
    awayRank: 2,
  };
  context.games.push(ranked);
  for (let i = 0; i < 4; i++) {
    const game = forwardGame(`carol-win-${i}`, 5, '2026-10-03T17:00:00Z', 'Alabama', 'Unowned');
    context.games.push(game);
    context.scoresByKey[game.key] = forwardScore();
  }
  const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  assert.equal(
    inputs.standings.find((row) => row.owner === 'Carol')?.wins,
    4,
    'standings come from results'
  );
  const lines = selectForwardStandings(inputs);
  const national = selectOverviewViewModel({
    standingsLeaders: inputs.standings,
    standingsCoverage: { state: 'complete', message: null },
    context: { scopeDetail: 'Week 6' },
    liveItems: [],
    keyMatchups: inputs.games.map((game) => ({
      bucket: { game, homeIsLeagueTeam: true, awayIsLeagueTeam: true },
      priority: 0,
      sortDate: Date.parse(game.date!),
    })),
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map([
      ['Alabama', { rank: 1, rankSource: 'ap' as const }],
      ['Ohio State', { rank: 2, rankSource: 'ap' as const }],
    ]),
    seasonContext: 'in-season',
  });
  assert.equal(
    national.watchlistCandidates[0]?.item.bucket.game.key,
    'ranked',
    'positive control: national curation chooses the other game'
  );
  assert.equal(lines[0]?.gameKey, 'collision', 'league stakes outrank AP profile');
  assert.ok(
    !lines.some((line) => line.gameKey === 'ranked'),
    'four-win gap is not an order-changing collision'
  );
  assert.match(
    lines[0].detail,
    /draw level on wins/,
    'one win behind can tie, not promise a rank flip'
  );
  context.scoresByKey.prior = forwardScore(7, 21);
  assert.match(
    selectForwardStandings(selectFixtureForwardLookInputs(context, FORWARD_NOW)!)[0].detail,
    /Bob 1 win, Alice 0 wins/
  );
});

test('Forward Look odds expire at 24 hours and refuse later weeks, future stamps and closing lines', () => {
  const context = forwardContext();
  const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  assert.equal(selectForwardUpsets(inputs).length, 1, 'fresh immediate-week odds produce a line');
  context.odds = {
    status: 'available',
    byGameKey: { collision: forwardOdds('2026-10-07T10:00:00.001Z') },
  };
  assert.equal(selectForwardUpsets(inputs).length, 1, 'just inside the freshness window');
  for (const capturedAt of [
    '2026-10-07T10:00:00Z',
    '2026-09-05T13:00:00Z',
    '2026-10-08T10:00:01Z',
    'invalid',
  ]) {
    context.odds.byGameKey.collision = forwardOdds(capturedAt);
    assert.deepEqual(selectForwardUpsets(inputs), [], `reject ${capturedAt}`);
  }
  context.odds.byGameKey.collision = { ...forwardOdds(), lineSourceStatus: 'closing' };
  assert.deepEqual(selectForwardUpsets(inputs), [], 'closing prices are not upcoming prices');
  context.odds.byGameKey.collision = forwardOdds();
  assert.deepEqual(
    selectForwardUpsets({ ...inputs, target: { ...inputs.target, week: 8 } }),
    [],
    'later-week API misuse is refused'
  );
  const later = forwardGame('later', 8, '2026-10-24T19:00:00Z');
  context.odds.byGameKey.later = forwardOdds();
  assert.deepEqual(
    selectForwardUpsets({ ...inputs, games: [later] }),
    [],
    'later rows cannot smuggle prices into the immediate target'
  );
});

test('Forward Look upset risk reaches a single-owner game but never NoClaim or a self-matchup', () => {
  const context = forwardContext();
  context.rosterByTeam.set('Georgia', 'NoClaim');
  let inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  assert.deepEqual(selectForwardStandings(inputs), []);
  assert.equal(selectForwardUpsets(inputs)[0]?.title, 'Alice needs Texas to beat the odds');
  context.rosterByTeam.set('Texas', 'NoClaim');
  assert.deepEqual(selectForwardUpsets(selectFixtureForwardLookInputs(context, FORWARD_NOW)!), []);
  context.rosterByTeam.set('Texas', 'Alice');
  context.rosterByTeam.set('Georgia', 'Alice');
  inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  assert.deepEqual(selectForwardStandings(inputs), []);
  assert.deepEqual(selectForwardUpsets(inputs), []);
});

test('Forward Look rivalry tightness uses aggregate results and streaks use ordered meetings', () => {
  const context = forwardContext();
  context.scoresByKey = {};
  context.games = context.games.map((game) =>
    game.key === 'prior'
      ? {
          ...game,
          csvHome: 'Unowned',
          canHome: 'Unowned',
          participants: forwardGame('x', 5, '2026-10-03T19:00:00Z', 'Unowned').participants,
        }
      : game
  );
  addRivalry(context, [
    'Alice',
    'Bob',
    'Alice',
    'Bob',
    'Alice',
    'Bob',
    'Alice',
    'Bob',
    'Alice',
    'Bob',
  ]);
  const lines = () => selectForwardRivalries(selectFixtureForwardLookInputs(context, FORWARD_NOW)!);
  assert.equal(lines()[0]?.value, '5–5', 'even aggregate earns a rivalry line');
  const archive = addRivalry(context, ['Bob', ...Array<'Alice'>(9).fill('Alice')]);
  assert.equal(lines()[0]?.value, '9 straight', 'nine consecutive wins earn a streak');
  archive.games.reverse();
  assert.equal(lines()[0]?.value, '9 straight', 'array order does not define meeting order');
  addRivalry(context, [...Array<'Alice'>(9).fill('Alice'), 'Bob']);
  assert.deepEqual(
    lines(),
    [],
    'the same 9–1 aggregate with a last-game loss is not a live streak'
  );
  const close = addRivalry(context, [
    'Bob',
    'Alice',
    'Bob',
    'Alice',
    'Bob',
    'Alice',
    'Bob',
    'Alice',
    'Alice',
    'Alice',
  ]);
  assert.equal(lines()[0]?.value, '3 straight', '6–4 can still have a real current streak');
  delete close.scoresByKey['history-9'];
  assert.equal(
    lines()[0]?.value,
    '4–5',
    'unknown latest result stops the streak but preserves known aggregate tightness'
  );
});

test('Forward Look rivalry incorporates current-season finals and refuses ambiguous latest ordering', () => {
  const context = forwardContext();
  const archive = addRivalry(context, ['Bob', 'Alice', 'Alice']);
  const lines = () => selectForwardRivalries(selectFixtureForwardLookInputs(context, FORWARD_NOW)!);
  assert.equal(lines()[0]?.value, '3 straight', 'current-season win extends archived streak');
  context.scoresByKey.prior = forwardScore(7, 21);
  assert.equal(lines()[0]?.value, '2–2', 'current loss breaks streak and updates aggregate');
  archive.games[1].date = archive.games[0].date;
  archive.games[1].canonicalWeek = archive.games[0].canonicalWeek;
  context.games = context.games.filter((game) => game.key !== 'prior');
  context.games.unshift(
    forwardGame('unowned-prior', 5, '2026-10-03T19:00:00Z', 'Unowned', 'Other')
  );
  assert.deepEqual(lines(), [], 'mixed simultaneous meetings do not fabricate ordering');
});

test('Forward Look merger enforces a per-family cap independently of total slots and deduplicates IDs', () => {
  const line = (
    family: ForwardLookLine['family'],
    n: number,
    priorityScore: number
  ): ForwardLookLine => ({
    id: `${family}-${n}`,
    storyKey: `${family}-${n}`,
    family,
    gameKey: String(n),
    title: 'Title',
    detail: 'Detail',
    value: 'Value',
    expiresAt: Infinity,
    priorityScore,
  });
  const standings = [
    line('standings', 1, 200),
    line('standings', 2, 199),
    line('standings', 3, 198),
  ];
  const rivalries = [line('rivalry', 1, 90), line('rivalry', 2, 89), line('rivalry', 3, 88)];
  const upsets = [line('upset', 1, 100), line('upset', 2, 20)];
  const merged = mergeForwardLookLines([standings, rivalries, upsets, [standings[0]]]);
  assert.deepEqual(
    merged.map((row) => row.id),
    ['standings-1', 'standings-2', 'upset-1', 'rivalry-1', 'rivalry-2'],
    'family cap prevents a dominant family taking three slots'
  );
  assert.equal(
    new Set(merged.map((row) => row.id)).size,
    merged.length,
    'duplicate IDs cannot spend slots'
  );
});

test('Forward Look preserves applicable empty weeks and hides inapplicable scopes', () => {
  const context = forwardContext();
  context.rosterByTeam.clear();
  const result = { status: 'available' as const, context };
  const look = composeFixtureForwardLook(result, FORWARD_NOW, FORWARD_SCOPE);
  assert.equal(
    selectVisibleForwardLook(look, FORWARD_NOW)?.weekLabel,
    'Week 6',
    'empty families retain orientation'
  );
  assert.deepEqual(look?.lines, []);
  assert.equal(
    composeFixtureForwardLook(result, FORWARD_NOW, {
      ...FORWARD_SCOPE,
      leagueStatus: { state: 'offseason' },
    }),
    null
  );
  assert.equal(
    composeFixtureForwardLook(result, FORWARD_NOW, { ...FORWARD_SCOPE, leagueStatus: undefined }),
    null
  );
  assert.equal(
    composeFixtureForwardLook(result, FORWARD_NOW, { ...FORWARD_SCOPE, seasonYear: 2025 }),
    null
  );
  assert.equal(
    composeFixtureForwardLook({ status: 'absent', reason: 'schedule' }, FORWARD_NOW, FORWARD_SCOPE),
    null
  );
  context.games = [];
  assert.equal(composeFixtureForwardLook(result, FORWARD_NOW, FORWARD_SCOPE), null);
});

test('Forward Look client expiry removes kicked games and stale prices while retaining the week', () => {
  const look = composeFixtureForwardLook(
    { status: 'available', context: forwardContext() },
    FORWARD_NOW,
    FORWARD_SCOPE
  )!;
  assert.ok(look.lines.some((line) => line.family === 'upset'));
  const aged = selectVisibleForwardLook(look, new Date('2026-10-09T09:00:00Z'))!;
  assert.deepEqual(
    aged.lines.map((line) => line.family),
    ['standings'],
    'odds expire without removing standings'
  );
  const kicked = selectVisibleForwardLook(look, new Date('2026-10-10T19:00:00Z'))!;
  assert.deepEqual(kicked.lines, [], 'kickoff removes preview claims');
  assert.equal(kicked.weekLabel, 'Week 6');
});

test('compact history parsing isolates malformed rivalry data and rejects the old payload shape', () => {
  const context = forwardContext();
  addRivalry(context, ['Alice', 'Alice', 'Alice']);
  const history = prepareForwardLookHistory(context);
  assert.deepEqual(parseForwardLook(JSON.parse(JSON.stringify(history))), history);
  for (const pair of [
    { ...history.rivalries![0], owners: ['Bob', 'Alice'] },
    { ...history.rivalries![0], streak: { owner: 'Alice', count: 4 } },
    { ...history.rivalries![0], streak: undefined },
  ])
    assert.deepEqual(
      parseForwardLook({ ...history, rivalries: [pair] }),
      { seasonYear: 2026, rivalries: null },
      'bad pair drops only history'
    );
  assert.deepEqual(
    parseForwardLook({ ...history, rivalries: [...history.rivalries!, ...history.rivalries!] }),
    { seasonYear: 2026, rivalries: null },
    'duplicate pair is unavailable history'
  );
  assert.equal(
    parseForwardLook(
      composeFixtureForwardLook({ status: 'available', context }, FORWARD_NOW, FORWARD_SCOPE)
    ),
    null,
    'old composed payload is not the compact payload'
  );
  assert.equal(parseForwardLook(undefined), null);
});

test('Forward Look backfills expired stories and deduplicates repeated owner pairs before capping', () => {
  const context = forwardContext();
  context.odds = { status: 'unavailable' };
  context.scoresByKey = {};
  context.games.push(forwardGame('repeat', 6, '2026-10-10T23:00:00Z', 'Georgia', 'Texas'));
  for (let i = 0; i < 4; i++) {
    const home = `Home ${i}`;
    const away = `Away ${i}`;
    context.rosterByTeam.set(home, `Owner H${i}`);
    context.rosterByTeam.set(away, `Owner A${i}`);
    context.games.push(forwardGame(`other-${i}`, 6, '2026-10-10T23:00:00Z', home, away));
  }
  const look = composeFixtureForwardLook(
    { status: 'available', context },
    FORWARD_NOW,
    FORWARD_SCOPE
  )!;
  assert.equal(look.lines.length, 6, 'transport retains candidates beyond the display cap');
  const first = selectVisibleForwardLook(look, FORWARD_NOW)!;
  assert.equal(first.lines.length, 2);
  assert.equal(
    new Set(first.lines.map((line) => line.storyKey)).size,
    2,
    'one story per owner pair per family'
  );
  const late = selectVisibleForwardLook(look, new Date('2026-10-10T20:00:00Z'))!;
  assert.equal(late.lines.length, 2, 'eligible evening stories backfill expired daytime stories');
  assert.equal(
    late.lines.some((line) => line.gameKey === 'collision'),
    false
  );
  assert.equal(
    late.lines.some((line) => line.gameKey === 'repeat'),
    true,
    'a repeated pair can replace its expired earlier meeting'
  );

  context.scoresByKey.prior = forwardScore();
  addRivalry(context, ['Bob', 'Alice', 'Alice']);
  const rivalries = selectForwardRivalries(selectFixtureForwardLookInputs(context, FORWARD_NOW)!);
  assert.equal(rivalries.length, 2);
  assert.equal(
    mergeForwardLookLines([rivalries]).length,
    1,
    'reversed home-away rivalry pairs share one slot'
  );
});

test('Forward Look standings use the canonical final-score population even without kickoff dates', () => {
  const context = forwardContext();
  context.games[0].date = null;
  context.games.push(forwardGame('dated-prior', 5, '2026-10-03T19:00:00Z', 'Unowned', 'Other'));
  const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  assert.equal(
    inputs.standings.find((row) => row.owner === 'Alice')?.wins,
    1,
    'undated finals still count toward canonical wins'
  );
});

test('Forward Look canceled meetings do not break streaks but unresolved meetings suppress live claims', () => {
  const context = forwardContext();
  const archive = addRivalry(context, ['Bob', 'Alice', 'Alice', 'Alice']);
  const lines = () => selectForwardRivalries(selectFixtureForwardLookInputs(context, FORWARD_NOW)!);
  assert.equal(lines()[0]?.value, '4 straight');
  const canceled = forwardGame('canceled', 5, '2026-10-04T19:00:00Z');
  context.games.push(canceled);
  for (const source of ['rawStatus', 'score'] as const) {
    canceled.status = 'scheduled';
    canceled.rawStatus = 'scheduled';
    delete context.scoresByKey.canceled;
    if (source === 'score')
      context.scoresByKey.canceled = { ...forwardScore(), status: 'STATUS_CANCELED' };
    else canceled[source] = 'STATUS_CANCELED';
    assert.equal(lines()[0]?.value, '4 straight', `${source} cancellation is not a meeting result`);
  }
  context.scoresByKey.canceled = { ...forwardScore(), status: 'inprogress' };
  assert.deepEqual(lines(), [], 'unresolved intervening meeting prevents a live-streak promise');
  context.games.pop();
  archive.games.push({
    ...forwardGame('old-canceled', 9, '2025-11-01T19:00:00Z'),
    rawStatus: 'canceled',
  });
  assert.equal(
    lines()[0]?.value,
    '4 straight',
    'archived cancellation preserves the ordered winning run'
  );
});

test('Forward Look family failures leave the other families and the week frame available', () => {
  const context = forwardContext();
  Object.defineProperty(context.records, 'archives', {
    get() {
      throw new Error('rivalry fault');
    },
  });
  assert.doesNotThrow(
    () => composeFixtureForwardLook({ status: 'available', context }, FORWARD_NOW, FORWARD_SCOPE),
    'family exception does not abort composition'
  );
  const look = composeFixtureForwardLook(
    { status: 'available', context },
    FORWARD_NOW,
    FORWARD_SCOPE
  )!;
  assert.deepEqual(
    look.lines.map((line) => line.family),
    ['standings', 'upset'],
    'rivalry exception does not erase healthy families'
  );
  Object.defineProperty(context, 'odds', {
    get() {
      throw new Error('odds fault');
    },
  });
  const fewer = composeFixtureForwardLook(
    { status: 'available', context },
    FORWARD_NOW,
    FORWARD_SCOPE
  )!;
  assert.deepEqual(
    fewer.lines.map((line) => line.family),
    ['standings'],
    'odds exception does not erase standings'
  );
  assert.equal(selectVisibleForwardLook(fewer, FORWARD_NOW)?.weekLabel, 'Week 6');
});

for (const state of ['future', 'undated', 'postponed'] as const) {
  test(`a ${state} meeting does not suppress a verified rivalry`, () => {
    const context = forwardContext();
    addRivalry(context, ['Alice', 'Alice', 'Alice']);
    const meeting = forwardGame(
      'uncertain',
      6,
      state === 'future' ? '2026-10-10T20:00:00Z' : '2026-10-04T19:00:00Z'
    );
    if (state === 'undated') meeting.date = null;
    if (state === 'postponed') meeting.rawStatus = 'STATUS_POSTPONED';
    context.games.push(meeting);
    const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
    assert.equal(
      selectForwardRivalries(inputs).some((line) => line.value === '4 straight'),
      true,
      `${state} preserves verified streak`
    );
  });
}

test('required rivalry coverage withholds only the affected pair and recovers from current scores', () => {
  const context = forwardContext();
  const archive = addRivalry(context, ['Alice', 'Alice', 'Alice']);
  context.rosterByTeam.set('Alabama', 'Carol');
  context.rosterByTeam.set('Ohio State', 'Dan');
  if (context.records.status !== 'available') throw new Error('fixture history');
  context.records.historicalRosters[2025] = new Map(context.rosterByTeam);
  for (let i = 0; i < 3; i++) {
    const game = forwardGame(
      `other-${i}`,
      i + 1,
      `2025-09-0${i + 1}T19:00:00Z`,
      'Alabama',
      'Ohio State'
    );
    archive.games.push(game);
    archive.scoresByKey[game.key] = forwardScore();
  }
  context.games.push(
    forwardGame('other-upcoming', 6, '2026-10-10T19:00:00Z', 'Alabama', 'Ohio State')
  );
  const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  const lines = () => selectForwardRivalries(inputs).filter((line) => line.gameKey === 'collision');
  assert.equal(lines()[0]?.value, '4 straight', 'covered control');
  delete inputs.context.scoresByKey.prior;
  assert.deepEqual(lines(), [], 'missing past result withholds rather than invents aggregate');
  assert.equal(
    selectForwardRivalries(inputs).some((line) => line.gameKey === 'other-upcoming'),
    true,
    'missing pair does not suppress another verified pair'
  );
  inputs.context.scoresByKey.prior = forwardScore();
  assert.equal(
    lines()[0]?.value,
    '4 straight',
    'restored coverage restores the claim without a latch'
  );
  inputs.context.scoresByKey.prior = forwardScore(7, 21);
  assert.deepEqual(lines(), [], 'correction removes a broken non-tight streak');
});

for (const date of [null, '2026-10-20T19:00:00Z']) {
  test(`positive completion evidence requires a result with date ${date}`, () => {
    const context = forwardContext();
    addRivalry(context, ['Alice', 'Alice', 'Alice']);
    context.games.push({ ...forwardGame('completed', 6), date, completed: true });
    const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
    assert.deepEqual(
      selectForwardRivalries(inputs),
      [],
      'known completion requires usable result despite date'
    );
    inputs.context.scoresByKey.completed = forwardScore();
    assert.equal(
      selectForwardRivalries(inputs)[0]?.value,
      '5 straight',
      'usable completed result counts despite date'
    );
  });
}

test('client composition uses supplied canonical rows even when scores disagree; empty rows create no standings or upset facts', () => {
  const context = forwardContext();
  const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  inputs.context.scoresByKey = { prior: forwardScore(7, 21) };
  assert.match(
    selectForwardStandings(inputs)[0].detail,
    /Bob 0 wins, Alice 1 win/,
    'canonical wins override disagreeing client results'
  );
  inputs.standings = [];
  assert.deepEqual(
    selectForwardStandings(inputs),
    [],
    'empty canonical rows have no standings facts'
  );
  assert.deepEqual(
    selectForwardUpsets(inputs),
    [],
    'empty canonical rows have no upset rank facts'
  );
});

test('compact history preserves cross-archive dedup and round-trips all 256 four-meeting outcome combinations', () => {
  for (let combination = 0; combination < 256; combination++) {
    const context = forwardContext();
    const archive = addRivalry(context, ['Alice', 'Alice', 'Alice', 'Alice']);
    let value = combination;
    for (const game of archive.games) {
      const outcome = value % 4;
      value = Math.floor(value / 4);
      if (outcome === 0) delete archive.scoresByKey[game.key];
      else
        archive.scoresByKey[game.key] =
          outcome === 1
            ? forwardScore()
            : outcome === 2
              ? forwardScore(7, 21)
              : { ...forwardScore(), status: 'inprogress' };
    }
    if (context.records.status !== 'available') throw new Error('fixture history');
    const once = prepareForwardLookHistory(context);
    context.records.archives.push(archive);
    const history = prepareForwardLookHistory(context);
    assert.deepEqual(history, once, 'duplicate archive does not double wins or streak');
    assert.deepEqual(
      parseForwardLook(JSON.parse(JSON.stringify(history))),
      history,
      `producer round-trip ${combination}`
    );
  }
});

test('composition never revisits archives after compact preparation', () => {
  const context = forwardContext();
  const archive = addRivalry(context, ['Alice', 'Alice', 'Alice']);
  const inputs = selectFixtureForwardLookInputs(context, FORWARD_NOW)!;
  Object.defineProperty(archive, 'games', {
    get() {
      throw new Error('archive reread');
    },
  });
  assert.equal(
    selectForwardRivalries(inputs)[0]?.value,
    '4 straight',
    'score composition consumes only compact history'
  );
  assert.equal(
    prepareForwardLookHistory(context).rivalries,
    null,
    'positive control: preparation still observes archive access'
  );
});

test('two families cannot occupy five slots before odds arrive', () => {
  const line = (family: ForwardLookLine['family'], n: number): ForwardLookLine => ({
    id: `${family}:${n}`,
    storyKey: `${family}:${n}`,
    family,
    gameKey: String(n),
    title: '',
    detail: '',
    value: '',
    priorityScore: n,
    expiresAt: Infinity,
  });
  const families = ['standings', 'rivalry'].map((family) =>
    Array.from({ length: 4 }, (_, n) => line(family as ForwardLookLine['family'], n))
  );
  assert.equal(mergeForwardLookLines(families).length, 4, 'pre-odds family caps allow four lines');
  assert.equal(
    mergeForwardLookLines([...families, [line('upset', 10)]]).length,
    5,
    'positive control: odds can fill fifth slot'
  );
});

test('malformed wire participants are reconstructed; bypassing that boundary already fails the unchanged live overlay', async () => {
  const { buildScheduleFromApi } = await import('../../schedule.ts');
  const { selectLiveDelta } = await import('../liveDelta.ts');
  const context = forwardContext();
  const overlay = (games: typeof context.games) =>
    selectLiveDelta({
      canonical: null,
      scoresByKey: {},
      games,
      rosterByTeam: context.rosterByTeam,
      weekKey: '6',
      lastFetchedAt: null,
      now: FORWARD_NOW.getTime(),
    });
  assert.throws(
    () => overlay([{ ...forwardGame('bad'), participants: null as never }]),
    'live overlay already rejects bypassed invalid AppGame'
  );
  for (const participants of [null, {}, [], { home: null, away: null }]) {
    const build = buildScheduleFromApi({
      season: 2026,
      teams: [],
      aliasMap: {},
      scheduleItems: [
        {
          id: 'wire',
          week: 6,
          seasonType: 'regular',
          startDate: '2026-10-10T19:00:00Z',
          homeTeam: 'Texas',
          awayTeam: 'Georgia',
          homeConference: 'SEC',
          awayConference: 'SEC',
          status: 'scheduled',
          completed: false,
          neutralSite: false,
          conferenceGame: true,
          participants,
        } as Parameters<typeof buildScheduleFromApi>[0]['scheduleItems'][number],
      ],
    });
    assert.equal(
      build.games[0].participants.home.kind,
      'team',
      'wire home participant is reconstructed'
    );
    assert.equal(
      build.games[0].participants.away.kind,
      'team',
      'wire away participant is reconstructed'
    );
    assert.doesNotThrow(
      () => overlay(build.games),
      'reconstructed game reaches live overlay safely'
    );
  }
});

test('pending annotations are in-progress leads and cannot be standings wins', async () => {
  const { selectLiveDelta } = await import('../liveDelta.ts');
  const context = forwardContext();
  const args = {
    canonical: null,
    games: context.games,
    rosterByTeam: context.rosterByTeam,
    weekKey: '6',
    lastFetchedAt: FORWARD_NOW.toISOString(),
    now: FORWARD_NOW.getTime(),
  };
  const live = selectLiveDelta({
    ...args,
    scoresByKey: { collision: { ...forwardScore(), status: 'inprogress' } },
  });
  assert.equal(live.byOwner.Alice.pendingWins, 1, 'pending win means currently leading');
  const final = selectLiveDelta({ ...args, scoresByKey: { collision: forwardScore() } });
  assert.equal(final.byOwner.Alice, undefined, 'final is excluded from pending wins');
});

test('usable-final count decreases under authoritative manual replacement', async () => {
  const { mergeManualPartition } = await import('../../scores/manualPartitionMerge.ts');
  const { hasUsableFinalScore } = await import('../../gameStatus.ts');
  const first = { ...forwardScore(), id: 'first', week: 6 };
  const omitted = { ...forwardScore(), id: 'omitted', week: 6 };
  const prior = {
    at: 1000,
    source: 'cfbd' as const,
    cfbdFallbackReason: 'none' as const,
    items: [first, omitted],
  };
  assert.equal(prior.items.filter(hasUsableFinalScore).length, 2, 'two-final positive control');
  const merged = mergeManualPartition({ prior, manualItems: [first], now: 5000 });
  assert.equal(
    merged.items.filter(hasUsableFinalScore).length,
    1,
    'authoritative omission decreases final count'
  );
  const nonfinal = mergeManualPartition({
    prior,
    manualItems: [
      {
        ...first,
        status: 'scheduled',
        home: { team: 'Texas', score: null },
        away: { team: 'Georgia', score: null },
      },
    ],
    now: 5000,
  });
  assert.equal(
    nonfinal.items.filter(hasUsableFinalScore).length,
    0,
    'authoritative nonfinal replacement also decreases count'
  );
});
