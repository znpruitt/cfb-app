import assert from 'node:assert/strict';
import test from 'node:test';
import { composeForwardLook } from '../../recap/composeForwardLook.ts';
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
  selectForwardLookInputs,
  selectForwardStandings,
  selectForwardUpsets,
  selectVisibleForwardLook,
  type ForwardLookLine,
} from '../forwardLook.ts';
import { selectForwardRivalries } from '../forwardLookRivalries.ts';
import { selectWeeklyRecapTileState } from '../weeklyRecapFacts.ts';
import { selectOverviewViewModel } from '../overview.ts';

test('Forward Look changes over at the real Thursday boundary minute and ends at next eligibility', () => {
  const context = forwardContext();
  const before = new Date('2026-10-08T09:59:00Z');
  const result = { status: 'available' as const, context };
  const recap = composeWeeklyRecap(result, before, FORWARD_SCOPE);
  assert.equal(recap.status, 'available');
  if (recap.status !== 'available') throw new Error('fixture must produce recap');
  const look = composeForwardLook(result, before, FORWARD_SCOPE);
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
  const winter = composeForwardLook(result, new Date('2026-11-12T10:59:00Z'), FORWARD_SCOPE);
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
  const inputs = selectForwardLookInputs(context, FORWARD_NOW)!;
  assert.deepEqual(
    inputs.games.map((game) => game.key),
    ['collision'],
    'only the unstarted immediate-week game is eligible'
  );
  context.games = context.games.filter((game) => game.key !== 'collision');
  const empty = selectForwardLookInputs(context, FORWARD_NOW)!;
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
  const inputs = selectForwardLookInputs(context, FORWARD_NOW)!;
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
    selectForwardStandings(selectForwardLookInputs(context, FORWARD_NOW)!)[0].detail,
    /Bob 1 win, Alice 0 wins/
  );
});

test('Forward Look odds expire at 24 hours and refuse later weeks, future stamps and closing lines', () => {
  const context = forwardContext();
  const inputs = selectForwardLookInputs(context, FORWARD_NOW)!;
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
  let inputs = selectForwardLookInputs(context, FORWARD_NOW)!;
  assert.deepEqual(selectForwardStandings(inputs), []);
  assert.equal(selectForwardUpsets(inputs)[0]?.title, 'Alice needs Texas to beat the odds');
  context.rosterByTeam.set('Texas', 'NoClaim');
  assert.deepEqual(selectForwardUpsets(selectForwardLookInputs(context, FORWARD_NOW)!), []);
  context.rosterByTeam.set('Texas', 'Alice');
  context.rosterByTeam.set('Georgia', 'Alice');
  inputs = selectForwardLookInputs(context, FORWARD_NOW)!;
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
  const lines = () => selectForwardRivalries(selectForwardLookInputs(context, FORWARD_NOW)!);
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
  const lines = () => selectForwardRivalries(selectForwardLookInputs(context, FORWARD_NOW)!);
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
  const look = composeForwardLook(result, FORWARD_NOW, FORWARD_SCOPE);
  assert.equal(
    selectVisibleForwardLook(look, FORWARD_NOW)?.weekLabel,
    'Week 6',
    'empty families retain orientation'
  );
  assert.deepEqual(look?.lines, []);
  assert.equal(
    composeForwardLook(result, FORWARD_NOW, {
      ...FORWARD_SCOPE,
      leagueStatus: { state: 'offseason' },
    }),
    null
  );
  assert.equal(
    composeForwardLook(result, FORWARD_NOW, { ...FORWARD_SCOPE, leagueStatus: undefined }),
    null
  );
  assert.equal(
    composeForwardLook(result, FORWARD_NOW, { ...FORWARD_SCOPE, seasonYear: 2025 }),
    null
  );
  assert.equal(
    composeForwardLook({ status: 'absent', reason: 'schedule' }, FORWARD_NOW, FORWARD_SCOPE),
    null
  );
  context.games = [];
  assert.equal(composeForwardLook(result, FORWARD_NOW, FORWARD_SCOPE), null);
});

test('Forward Look client expiry removes kicked games and stale prices while retaining the week', () => {
  const look = composeForwardLook(
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

test('Forward Look payload parsing isolates malformed lines from the recap transport', () => {
  const look = composeForwardLook(
    { status: 'available', context: forwardContext() },
    FORWARD_NOW,
    FORWARD_SCOPE
  )!;
  assert.deepEqual(parseForwardLook(JSON.parse(JSON.stringify(look))), look);
  assert.equal(
    parseForwardLook({ ...look, lines: [{ ...look.lines[0], expiresAt: 'tomorrow' }] }),
    null
  );
  assert.equal(parseForwardLook({ ...look, target: look.recapTarget }), null);
  assert.equal(parseForwardLook(undefined), null);
});
