import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleFromApi, type ScheduleWireItem } from '../schedule.ts';
import { mapCfbdScheduleGame, type CfbdScheduleGame } from '../schedule/cfbdSchedule.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086-SCHEDULE-NON-FBS-POSTSEASON-CLASSIFICATION-SAFETY — canonical
// collection regression. On current production data the four 2024 FCS and
// Division III championship semifinals all normalized to the SHARED event key
// `cfp-semifinal`; `buildScheduleFromApi` keys postseason rows by
// `${season}-${eventKey}`, and the authoritative collection can merge same-key
// rows into a HYBRID record carrying one row's participants under another
// row's providerGameId (observed in production: North Dakota State vs South
// Dakota State participants under the Division III providerGameId 401738295,
// surfaced when the resynced team catalog made North Dakota State resolvable).
// With the classification guard, each row keeps a row-specific identity and no
// hybrid can form.
// ---------------------------------------------------------------------------

/** The four confirmed colliding 2024 provider rows (two same-kickoff pairs). */
const RAW_2024: CfbdScheduleGame[] = [
  {
    id: 401729786,
    week: 1,
    home_team: 'North Dakota State',
    away_team: 'South Dakota State',
    home_classification: 'fcs',
    away_classification: 'fcs',
    start_date: '2024-12-21T17:00:00.000Z',
    notes: 'FCS Championship - Semifinals',
  },
  {
    id: 401738295,
    week: 1,
    home_team: 'University of Mount Union',
    away_team: 'Johns Hopkins University',
    home_classification: 'iii',
    away_classification: 'iii',
    start_date: '2024-12-21T17:00:00.000Z',
    notes: 'Division III Championship - Semifinal',
  },
  {
    id: 401738307,
    week: 1,
    home_team: 'North Central College',
    away_team: 'Susquehanna',
    home_classification: 'iii',
    away_classification: 'iii',
    start_date: '2024-12-21T20:30:00.000Z',
    notes: 'Division III Championship - Semifinal',
  },
  {
    id: 401729787,
    week: 1,
    home_team: 'Montana State',
    away_team: 'South Dakota',
    home_classification: 'fcs',
    away_classification: 'fcs',
    start_date: '2024-12-21T20:30:00.000Z',
    notes: 'FCS Championship - Semifinals',
  },
];

const RAW_BY_ID = new Map(RAW_2024.map((row) => [String(row.id), row]));

function mapAll(rows: CfbdScheduleGame[]): ScheduleWireItem[] {
  return rows.map((row) => {
    const result = mapCfbdScheduleGame(row, 'postseason');
    assert.equal(result.ok, true, `fixture row ${row.id} maps`);
    return (result.ok ? result.item : null) as unknown as ScheduleWireItem;
  });
}

test('the two confirmed same-kickoff 2024 pairs receive distinct non-CFP identities', () => {
  const items = mapAll(RAW_2024);
  const keys = items.map((item) => item.eventKey ?? `fallback-${item.id}`);
  for (const key of keys) {
    assert.ok(!String(key).startsWith('cfp-'), `event key must not be CFP: ${key}`);
  }
  assert.equal(new Set(keys).size, keys.length, 'all four identities are row-specific');
  // The same-kickoff pairs explicitly (17:00Z pair and 20:30Z pair).
  assert.notEqual(keys[0], keys[1]);
  assert.notEqual(keys[2], keys[3]);
});

test('canonical collection keeps each row aligned with its own provider id (no hybrid rows)', () => {
  // Reproduce the production trigger: North Dakota State is resolvable (the
  // resynced catalog lists it), the other seven schools are not.
  const items = mapAll(RAW_2024);
  const { games } = buildScheduleFromApi({
    scheduleItems: items,
    teams: [{ school: 'North Dakota State', level: 'FBS', conference: 'Missouri Valley' }],
    aliasMap: {},
    season: 2024,
  });

  for (const game of games) {
    const raw = RAW_BY_ID.get(String(game.providerGameId));
    if (!raw) continue;
    const ownLabels = new Set([raw.home_team, raw.away_team]);
    for (const side of ['home', 'away'] as const) {
      const participant = game.participants[side];
      if (participant.kind !== 'team') continue;
      assert.ok(
        ownLabels.has(participant.rawName) || ownLabels.has(participant.canonicalName),
        `game ${game.providerGameId} carries foreign participant ${participant.canonicalName}`
      );
    }
  }

  // The specific production hybrid can never re-form: nothing carrying the
  // Division III provider id may hold the FCS matchup's participants.
  for (const game of games) {
    if (String(game.providerGameId) !== '401738295') continue;
    for (const side of ['home', 'away'] as const) {
      const participant = game.participants[side];
      if (participant.kind !== 'team') continue;
      assert.notEqual(participant.canonicalName, 'North Dakota State');
      assert.notEqual(participant.canonicalName, 'South Dakota State');
    }
  }

  // The resolvable FCS matchup, when it survives, keeps ITS OWN provider id.
  const ndsuGames = games.filter((game) =>
    (['home', 'away'] as const).some(
      (side) =>
        game.participants[side].kind === 'team' &&
        game.participants[side].canonicalName === 'North Dakota State'
    )
  );
  for (const game of ndsuGames) {
    assert.equal(String(game.providerGameId), '401729786');
  }
});

test('FBS-vs-FCS eligibility remains green (classification guard changes identity only)', () => {
  const mapped = mapCfbdScheduleGame(
    {
      id: 600,
      week: 3,
      home_team: 'Texas',
      away_team: 'Nicholls',
      home_classification: 'fbs',
      away_classification: 'fcs',
      start_date: '2024-09-14T16:00:00.000Z',
    },
    'regular'
  );
  assert.equal(mapped.ok, true);
  const { games } = buildScheduleFromApi({
    scheduleItems: [(mapped.ok ? mapped.item : null) as unknown as ScheduleWireItem],
    teams: [{ school: 'Texas', level: 'FBS', conference: 'SEC' }],
    aliasMap: {},
    season: 2024,
  });
  assert.equal(games.length, 1, 'the FBS-vs-FCS game remains eligible');
  assert.equal(String(games[0]!.providerGameId), '600');
});

// ---------------------------------------------------------------------------
// PLATFORM-086H3E4 — "Second Round" / SEC conference-collision safety.
//
// Confirmed 2024 production corruption: substring alias matching read the
// `sec` inside "Second Round" as the SEC alias, the FCS second-round row
// acquired the `sec-championship` identity, and the authoritative collection
// fieldwise-merged it with the genuine SEC Championship — archiving UC Davis /
// Illinois State participants under provider id 401673469. These regressions
// pin all three corrections: boundary-safe alias matching, non-FBS negative
// evidence for conference-championship inference, and hybrid-proof collection
// behavior.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchConferenceChampionshipSlotByText } from '../conferenceChampionships.ts';
import { buildAuthoritativeGameCollection } from '../schedulePostseasonHelpers.ts';
import type { AppGame } from '../schedule.ts';

const SEC_RAW: CfbdScheduleGame = {
  id: 401673469,
  week: 15,
  home_team: 'Texas',
  away_team: 'Georgia',
  home_classification: 'fbs',
  away_classification: 'fbs',
  neutral_site: true,
  start_date: '2024-12-07T21:00:00.000Z',
  notes: 'SEC Championship',
};

const FCS_SECOND_ROUND_RAW: CfbdScheduleGame = {
  id: 401729753,
  week: 15,
  home_team: 'UC Davis',
  away_team: 'Illinois State',
  home_classification: 'fcs',
  away_classification: 'fcs',
  start_date: '2024-12-07T21:00:00.000Z',
  notes: 'FCS Championship - Second Round',
};

const E4_TEAMS = [
  { school: 'Texas', level: 'FBS', conference: 'SEC' },
  { school: 'Georgia', level: 'FBS', conference: 'SEC' },
  { school: 'UC Davis', level: 'FCS', conference: 'Big Sky' },
  { school: 'Illinois State', level: 'FCS', conference: 'Missouri Valley' },
];

test('E4 text matching: aliases match whole tokens, never substrings', () => {
  assert.equal(matchConferenceChampionshipSlotByText('SEC Championship')?.slug, 'sec');
  assert.equal(matchConferenceChampionshipSlotByText('2024 SEC Championship Game')?.slug, 'sec');
  // The confirmed defect: `sec` inside "Second" must not match.
  assert.equal(matchConferenceChampionshipSlotByText('FCS Championship - Second Round'), null);
  assert.equal(matchConferenceChampionshipSlotByText('Second Round'), null);
  // Multi-token aliases and normalization keep working.
  assert.equal(
    matchConferenceChampionshipSlotByText('Atlantic Coast Conference Championship')?.slug,
    'acc'
  );
  assert.equal(matchConferenceChampionshipSlotByText('Big Ten Championship Game')?.slug, 'big-ten');
  assert.equal(matchConferenceChampionshipSlotByText('C-USA Championship')?.slug, 'c-usa');
  assert.equal(matchConferenceChampionshipSlotByText('Mountain West Championship')?.slug, 'mwc');
  // Token-embedded fragments of other aliases never match either.
  assert.equal(matchConferenceChampionshipSlotByText('Maccabi Games'), null);
});

test('E4 classification: the FCS second-round row never becomes sec-championship', () => {
  const mapped = mapCfbdScheduleGame(FCS_SECOND_ROUND_RAW, 'postseason');
  assert.equal(mapped.ok, true);
  const item = (mapped.ok ? mapped.item : null)!;
  assert.notEqual(item.gamePhase, 'conference_championship');
  assert.notEqual(item.eventKey, 'sec-championship');
  assert.ok(!String(item.eventKey ?? '').startsWith('cfp-'), 'no CFP identity either');
  assert.equal(item.conferenceChampionshipConference ?? null, null);
});

test('E4 classification: the genuine SEC Championship keeps its identity', () => {
  const mapped = mapCfbdScheduleGame(SEC_RAW, 'regular');
  assert.equal(mapped.ok, true);
  const item = (mapped.ok ? mapped.item : null)!;
  assert.equal(item.gamePhase, 'conference_championship');
  assert.equal(item.eventKey, 'sec-championship');
});

test('E4 classification: explicit non-FBS rows cannot infer ANY FBS conference championship', () => {
  for (const [classification, home, away] of [
    ['fcs', 'Alpha FCS', 'Beta FCS'],
    ['ii', 'Gamma DII', 'Delta DII'],
    ['iii', 'Epsilon DIII', 'Zeta DIII'],
  ] as const) {
    const mapped = mapCfbdScheduleGame(
      {
        id: 777,
        week: 15,
        home_team: home,
        away_team: away,
        home_classification: classification,
        away_classification: classification,
        start_date: '2024-12-07T21:00:00.000Z',
        // Wording that WOULD match the ACC slot on an unclassified row.
        notes: 'ACC Championship',
      },
      'postseason'
    );
    assert.equal(mapped.ok, true);
    const item = (mapped.ok ? mapped.item : null)!;
    assert.notEqual(item.gamePhase, 'conference_championship', classification);
    assert.notEqual(item.eventKey, 'acc-championship', classification);
  }
});

test('E4 classification: CFP semifinal and national championship inference stays intact', () => {
  const semifinal = mapCfbdScheduleGame(
    {
      id: 888,
      week: 1,
      home_team: 'Alpha State',
      away_team: 'Beta Tech',
      home_classification: 'fbs',
      away_classification: 'fbs',
      start_date: '2025-01-09T00:30:00.000Z',
      notes: 'College Football Playoff Semifinal',
    },
    'postseason'
  );
  assert.equal(semifinal.ok, true);
  assert.equal((semifinal.ok ? semifinal.item : null)!.playoffRound, 'semifinal');

  const title = mapCfbdScheduleGame(
    {
      id: 889,
      week: 1,
      home_team: 'Alpha State',
      away_team: 'Beta Tech',
      home_classification: 'fbs',
      away_classification: 'fbs',
      start_date: '2025-01-20T00:30:00.000Z',
      notes: 'College Football Playoff National Championship',
    },
    'postseason'
  );
  assert.equal(title.ok, true);
  assert.equal((title.ok ? title.item : null)!.playoffRound, 'national_championship');
});

/** Fresh-normalization end to end: the confirmed pair in BOTH input orders. */
function buildE4Games(order: 'sec-first' | 'fcs-first'): AppGame[] {
  const secItem = mapAll([SEC_RAW])[0]!;
  // The SEC Championship is a regular-season row in CFBD.
  const secRegular = { ...secItem, seasonType: 'regular' as const };
  const fcsItem = mapAll([FCS_SECOND_ROUND_RAW])[0]!;
  const scheduleItems = order === 'sec-first' ? [secRegular, fcsItem] : [fcsItem, secRegular];
  return buildScheduleFromApi({ scheduleItems, teams: E4_TEAMS, aliasMap: {}, season: 2024 }).games;
}

test('E4 end to end: Texas–Georgia survives with its own id, orientation, and stage in both orders', () => {
  for (const order of ['sec-first', 'fcs-first'] as const) {
    const games = buildE4Games(order);
    const sec = games.find((game) => String(game.providerGameId) === '401673469');
    assert.ok(sec, `${order}: the genuine SEC Championship survives`);
    assert.equal(sec!.stage, 'conference_championship', order);
    assert.equal(sec!.neutral, true, order);
    assert.equal(
      sec!.participants.home.kind === 'team' ? sec!.participants.home.canonicalName : null,
      'Texas',
      order
    );
    assert.equal(
      sec!.participants.away.kind === 'team' ? sec!.participants.away.canonicalName : null,
      'Georgia',
      order
    );

    // No hybrid: no game mixes the two matchups, and the FCS id never carries
    // Texas or Georgia.
    for (const game of games) {
      const names = (['home', 'away'] as const)
        .map((side) => game.participants[side])
        .filter((p): p is Extract<typeof p, { kind: 'team' }> => p.kind === 'team')
        .map((p) => p.canonicalName);
      const hasSecTeam = names.some((n) => n === 'Texas' || n === 'Georgia');
      const hasFcsTeam = names.some((n) => n === 'UC Davis' || n === 'Illinois State');
      assert.ok(!(hasSecTeam && hasFcsTeam), `${order}: hybrid participants on ${game.key}`);
      if (String(game.providerGameId) === '401729753') {
        assert.ok(!hasSecTeam, `${order}: FCS id must not carry SEC participants`);
      }
    }
  }
});

test('E4 end to end: output identities and participants are permutation-invariant', () => {
  const project = (games: AppGame[]) =>
    games
      .map((game) => ({
        key: game.key,
        eventId: game.eventId,
        providerGameId: game.providerGameId,
        stage: game.stage,
        home: game.participants.home.kind === 'team' ? game.participants.home.canonicalName : null,
        away: game.participants.away.kind === 'team' ? game.participants.away.canonicalName : null,
      }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  assert.deepEqual(project(buildE4Games('sec-first')), project(buildE4Games('fcs-first')));
});

// --- Direct collection hardening (defensive: stale/already-normalized rows) ---

function e4AppGame(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'e4-game',
    eventId: overrides.eventId ?? '2024-sec-championship',
    week: overrides.week ?? 15,
    providerWeek: overrides.providerWeek ?? 15,
    canonicalWeek: overrides.canonicalWeek ?? 15,
    weekCorrectionReason: null,
    date: overrides.date ?? '2024-12-07T21:00:00.000Z',
    stage: overrides.stage ?? 'conference_championship',
    status: overrides.status ?? 'final',
    stageOrder: overrides.stageOrder ?? 2,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'sec-championship',
    label: overrides.label ?? null,
    conference: overrides.conference ?? 'SEC',
    bowlName: null,
    playoffRound: null,
    postseasonRole: overrides.postseasonRole ?? 'conference_championship',
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? true,
    neutralDisplay: 'vs',
    venue: null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    sources: overrides.sources,
    participants: overrides.participants ?? {
      home: { kind: 'placeholder', slotId: 'e4-home', displayName: 'Team TBD' },
      away: { kind: 'placeholder', slotId: 'e4-away', displayName: 'Team TBD' },
    },
    csvHome: overrides.csvHome ?? 'Team TBD',
    csvAway: overrides.csvAway ?? 'Team TBD',
    canHome: overrides.canHome ?? '',
    canAway: overrides.canAway ?? '',
    awayConf: overrides.awayConf ?? '',
    homeConf: overrides.homeConf ?? '',
  };
}

function teamSlot(teamId: string, name: string) {
  return {
    kind: 'team' as const,
    teamId,
    displayName: name,
    canonicalName: name,
    rawName: name,
  };
}

const STALE_SEC: AppGame = e4AppGame({
  key: '2024-sec-championship',
  providerGameId: '401673469',
  participants: { home: teamSlot('texas', 'Texas'), away: teamSlot('georgia', 'Georgia') },
  csvHome: 'Texas',
  csvAway: 'Georgia',
  canHome: 'Texas',
  canAway: 'Georgia',
});

const STALE_FCS: AppGame = e4AppGame({
  key: '2024-sec-championship',
  providerGameId: '401729753',
  participants: {
    home: teamSlot('ucdavis', 'UC Davis'),
    away: teamSlot('illinoisstate', 'Illinois State'),
  },
  csvHome: 'UC Davis',
  csvAway: 'Illinois State',
  canHome: 'UC Davis',
  canAway: 'Illinois State',
});

test('E4 collection: incompatible fully-resolved games are never fieldwise merged', () => {
  for (const inputs of [
    [STALE_SEC, STALE_FCS],
    [STALE_FCS, STALE_SEC],
  ]) {
    const games = buildAuthoritativeGameCollection([], inputs);
    assert.equal(games.length, 2, 'both real games survive');
    const byPid = new Map(games.map((g) => [String(g.providerGameId), g]));
    const sec = byPid.get('401673469');
    const fcs = byPid.get('401729753');
    assert.ok(sec && fcs, 'each provider id survives exactly once');
    assert.equal(
      sec!.participants.home.kind === 'team' ? sec!.participants.home.teamId : null,
      'texas'
    );
    assert.equal(
      sec!.participants.away.kind === 'team' ? sec!.participants.away.teamId : null,
      'georgia'
    );
    assert.equal(
      fcs!.participants.home.kind === 'team' ? fcs!.participants.home.teamId : null,
      'ucdavis'
    );
    assert.equal(
      fcs!.participants.away.kind === 'team' ? fcs!.participants.away.teamId : null,
      'illinoisstate'
    );
    assert.equal(sec!.neutral, true, 'the SEC game keeps its own metadata');
    // Real shared-base-key disambiguation: the LOWER provider id keeps the
    // base key; the other receives the deterministic disambiguated key —
    // identical in both input orders.
    assert.equal(sec!.key, '2024-sec-championship');
    assert.equal(fcs!.key, '2024-sec-championship::conference_championship::w15::401729753');
  }
});

test('E4 collection: key assignment for a split collision is permutation-invariant', () => {
  const project = (inputs: AppGame[]) =>
    buildAuthoritativeGameCollection([], inputs)
      .map((g) => ({ key: g.key, providerGameId: g.providerGameId }))
      .sort((a, b) => String(a.providerGameId).localeCompare(String(b.providerGameId)));
  assert.deepEqual(project([STALE_SEC, STALE_FCS]), project([STALE_FCS, STALE_SEC]));
});

test('E4 collection: compatible placeholder hydration still works', () => {
  const placeholder = e4AppGame({
    key: '2024-sec-championship-slot',
    isPlaceholder: true,
    status: 'placeholder',
  });
  const games = buildAuthoritativeGameCollection([], [placeholder, STALE_SEC]);
  assert.equal(games.length, 1, 'the placeholder hydrates into the real game');
  const merged = games[0]!;
  assert.equal(String(merged.providerGameId), '401673469');
  assert.equal(
    merged.participants.home.kind === 'team' ? merged.participants.home.teamId : null,
    'texas'
  );
});

test('E4 collection: a fragment naming a foreign team never hydrates the wrong game', () => {
  // A partial row with ONE settled team slot naming UC Davis must not attach
  // its slot to the fully resolved Texas–Georgia candidate.
  const foreignFragment = e4AppGame({
    key: '2024-sec-championship-frag',
    participants: {
      home: teamSlot('ucdavis', 'UC Davis'),
      away: { kind: 'placeholder', slotId: 'frag-away', displayName: 'Team TBD' },
    },
    csvHome: 'UC Davis',
    canHome: 'UC Davis',
  });
  for (const inputs of [
    [STALE_SEC, foreignFragment],
    [foreignFragment, STALE_SEC],
  ]) {
    const games = buildAuthoritativeGameCollection([], inputs);
    assert.equal(games.length, 2, 'the fragment survives as its own candidate');
    const sec = games.find((g) => String(g.providerGameId) === '401673469');
    assert.ok(sec, 'the real game survives');
    assert.equal(
      sec!.participants.home.kind === 'team' ? sec!.participants.home.teamId : null,
      'texas',
      'the foreign fragment did not replace Texas'
    );
    assert.equal(
      sec!.participants.away.kind === 'team' ? sec!.participants.away.teamId : null,
      'georgia',
      'the full pair is intact'
    );
    const fragment = games.find((g) => g !== sec);
    assert.ok(fragment, 'fragment candidate present');
    assert.equal(
      fragment!.participants.home.kind === 'team' ? fragment!.participants.home.teamId : null,
      'ucdavis',
      'the fragment keeps its own slot'
    );
  }
});

test('E4: no provider game id is special-cased in the corrected modules', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  for (const rel of [
    'src/lib/conferenceChampionships.ts',
    'src/lib/schedule/cfbdSchedule.ts',
    'src/lib/schedulePostseasonHelpers.ts',
  ]) {
    const source = readFileSync(path.join(repoRoot, rel), 'utf8');
    for (const id of ['401673469', '401729753', '401506450']) {
      assert.ok(!source.includes(id), `${rel} must not special-case ${id}`);
    }
  }
});

// --- Full permutation invariance (owner-mandated three-way regression) ---

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ])
  );
}

test('E4 collection: two incompatible fulls + an AMBIGUOUS fragment are permutation-invariant', () => {
  // The fragment shares the base key and is compatible with BOTH fulls — it
  // must FAIL CLOSED as its own candidate in every ordering, never attach by
  // arrival order.
  const ambiguousFragment = e4AppGame({
    key: '2024-sec-championship',
    isPlaceholder: true,
    status: 'placeholder',
  });

  const project = (inputs: AppGame[]) =>
    buildAuthoritativeGameCollection([], inputs)
      .map((g) => ({
        key: g.key,
        providerGameId: g.providerGameId,
        home: g.participants.home.kind === 'team' ? g.participants.home.teamId : null,
        away: g.participants.away.kind === 'team' ? g.participants.away.teamId : null,
      }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const expected = project([STALE_SEC, STALE_FCS, ambiguousFragment]);
  assert.equal(expected.length, 3, 'both fulls AND the ambiguous fragment survive');
  assert.deepEqual(
    expected,
    [
      {
        key: '2024-sec-championship',
        providerGameId: '401673469',
        home: 'texas',
        away: 'georgia',
      },
      {
        key: '2024-sec-championship::conference_championship::w15::2024-12-07T21:00:00.000Z',
        providerGameId: null,
        home: null,
        away: null,
      },
      {
        key: '2024-sec-championship::conference_championship::w15::401729753',
        providerGameId: '401729753',
        home: 'ucdavis',
        away: 'illinoisstate',
      },
    ],
    'exact keys, provider bindings, and BOTH participants'
  );

  for (const inputs of permutations([STALE_SEC, STALE_FCS, ambiguousFragment])) {
    assert.deepEqual(project(inputs), expected, `order ${inputs.map((g) => g.providerGameId)}`);
  }
});

test('E4 collection: an exact provider-id fragment attaches to ITS game in every ordering', () => {
  // A fragment carrying the FCS provider id has decisive affinity — it must
  // hydrate the FCS candidate (never the SEC game, never stand alone) in all
  // six orderings. The fragment carries an OBSERVABLE marker (label + settled
  // home slot) so a mis-attachment or a dropped attachment fails loudly.
  const pidFragment = e4AppGame({
    key: '2024-sec-championship',
    providerGameId: '401729753',
    label: 'FCS Second Round (fragment marker)',
    isPlaceholder: false,
    participants: {
      home: teamSlot('ucdavis', 'UC Davis'),
      away: { kind: 'placeholder', slotId: 'pid-frag-away', displayName: 'Team TBD' },
    },
    csvHome: 'UC Davis',
    canHome: 'UC Davis',
  });

  const project = (inputs: AppGame[]) =>
    buildAuthoritativeGameCollection([], inputs)
      .map((g) => ({
        key: g.key,
        providerGameId: g.providerGameId,
        label: g.label ?? null,
        home: g.participants.home.kind === 'team' ? g.participants.home.teamId : null,
        away: g.participants.away.kind === 'team' ? g.participants.away.teamId : null,
      }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const expected = project([STALE_SEC, STALE_FCS, pidFragment]);
  assert.deepEqual(expected, [
    {
      key: '2024-sec-championship',
      providerGameId: '401673469',
      label: null,
      home: 'texas',
      away: 'georgia',
    },
    {
      key: '2024-sec-championship::conference_championship::w15::401729753',
      providerGameId: '401729753',
      label: 'FCS Second Round (fragment marker)',
      home: 'ucdavis',
      away: 'illinoisstate',
    },
  ]);

  for (const inputs of permutations([STALE_SEC, STALE_FCS, pidFragment])) {
    assert.deepEqual(project(inputs), expected, `order ${inputs.map((g) => g.label ?? g.key)}`);
  }
});
