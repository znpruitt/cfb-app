import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachScoresToSchedule,
  buildScheduleIndex,
  matchScoreRowToSchedule,
  normalizeProviderTeamName,
  resolveCanonicalTeamIdentity,
  type NormalizedScoreRow,
  type ScheduleGameForIndex,
} from '../scoreAttachment.ts';
import { createTeamIdentityResolver } from '../teamIdentity.ts';

const teams = [
  { school: 'North Carolina', level: 'FBS' },
  { school: 'North Carolina Central', level: 'FCS' },
  { school: 'Southern', level: 'FCS' },
  { school: 'Georgia Southern', level: 'FBS' },
  { school: 'Southern Miss', level: 'FBS' },
  { school: 'Texas Southern', level: 'FCS' },
  { school: 'Texas State', level: 'FBS' },
  { school: 'Tennessee State', level: 'FCS' },
  { school: 'Tennessee', level: 'FBS' },
  { school: 'Florida A&M', level: 'FCS' },
  { school: 'Texas A&M', level: 'FBS' },
  { school: 'UAlbany', level: 'FCS', alts: ['Albany'] },
  { school: 'Albany State', level: 'OTHER' },
  { school: 'Army', level: 'FBS' },
  { school: 'Navy', level: 'FBS' },
  { school: 'Iowa State', level: 'FBS' },
  { school: 'Kansas State', level: 'FBS' },
  { school: 'Boise State', level: 'FBS' },
  { school: 'Washington State', level: 'FBS' },
];

function makeResolver(aliasMap: Record<string, string> = {}) {
  return createTeamIdentityResolver({ aliasMap, teams });
}

function game(
  input: Partial<ScheduleGameForIndex> &
    Pick<ScheduleGameForIndex, 'key' | 'week' | 'canHome' | 'canAway'>
): ScheduleGameForIndex {
  return {
    key: input.key,
    week: input.week,
    providerWeek: input.providerWeek ?? input.week,
    canonicalWeek: input.canonicalWeek ?? input.week,
    date: input.date ?? null,
    stage: input.stage ?? 'regular',
    providerGameId: input.providerGameId ?? null,
    canHome: input.canHome,
    canAway: input.canAway,
    participants: input.participants ?? { home: { kind: 'team' }, away: { kind: 'team' } },
  };
}

function row(
  input: Partial<NormalizedScoreRow> & Pick<NormalizedScoreRow, 'home' | 'away' | 'status'>
): NormalizedScoreRow {
  return {
    week: input.week ?? null,
    seasonType: input.seasonType ?? 'regular',
    providerEventId: input.providerEventId ?? null,
    status: input.status,
    time: input.time ?? null,
    date: input.date ?? null,
    home: input.home,
    away: input.away,
  };
}

test('normalization keeps similar names distinct', () => {
  const resolver = makeResolver();

  assert.notEqual(
    normalizeProviderTeamName('North Carolina'),
    normalizeProviderTeamName('North Carolina Central')
  );
  assert.notEqual(
    normalizeProviderTeamName('Southern'),
    normalizeProviderTeamName('Georgia Southern')
  );
  assert.notEqual(
    normalizeProviderTeamName('Southern'),
    normalizeProviderTeamName('Southern Miss')
  );
  assert.notEqual(
    normalizeProviderTeamName('Texas Southern'),
    normalizeProviderTeamName('Texas State')
  );
  assert.notEqual(
    normalizeProviderTeamName('Tennessee State'),
    normalizeProviderTeamName('Tennessee')
  );
  assert.notEqual(normalizeProviderTeamName('Florida A&M'), normalizeProviderTeamName('Texas A&M'));

  const ualbany = resolveCanonicalTeamIdentity('UAlbany', resolver);
  const albanyState = resolveCanonicalTeamIdentity('Albany State', resolver);
  assert.equal(ualbany.canonicalName, 'UAlbany');
  assert.equal(albanyState.canonicalName, 'Albany State');
});

test('manual alias override wins', () => {
  const resolver = makeResolver({ 'wash st': 'Washington State' });
  const resolved = resolveCanonicalTeamIdentity('Wash St', resolver);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.canonicalName, 'Washington State');
});

test('exact scheduled game attaches and unsupported row is ignored', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [game({ key: 'army-navy', week: 16, canHome: 'Army', canAway: 'Navy', providerGameId: 'g1' })],
    resolver
  );

  const matched = matchScoreRowToSchedule(
    row({
      week: 16,
      providerEventId: 'g1',
      home: { team: 'Army', score: 24 },
      away: { team: 'Navy', score: 17 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(matched.matched, true);

  const ignored = matchScoreRowToSchedule(
    row({
      week: 16,
      home: { team: 'UC Davis', score: 31 },
      away: { team: 'Illinois State', score: 14 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(ignored.matched, false);
  if (!ignored.matched) assert.equal(ignored.reason, 'unresolved_both_teams');
});

test('reversed orientation attaches safely', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [game({ key: 'army-navy', week: 16, canHome: 'Army', canAway: 'Navy' })],
    resolver
  );

  const matched = matchScoreRowToSchedule(
    row({
      week: 16,
      home: { team: 'Navy', score: 17 },
      away: { team: 'Army', score: 24 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(matched.matched, true);
  if (matched.matched) assert.equal(matched.orientation, 'reversed');
});

test('ambiguous repeated matchup in postseason does not collapse', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [
      game({
        key: 'reg-boise-wsu',
        week: 3,
        canHome: 'Boise State',
        canAway: 'Washington State',
        stage: 'regular',
        date: '2025-09-10T01:00:00Z',
      }),
      game({
        key: 'bowl-boise-wsu',
        week: 18,
        canHome: 'Washington State',
        canAway: 'Boise State',
        stage: 'bowl',
        date: '2025-12-28T01:00:00Z',
      }),
    ],
    resolver
  );

  const regular = matchScoreRowToSchedule(
    row({
      week: 3,
      seasonType: 'regular',
      home: { team: 'Boise State', score: 30 },
      away: { team: 'Washington State', score: 28 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(regular.matched, true);
  if (regular.matched) assert.equal(regular.entry.gameKey, 'reg-boise-wsu');

  const bowl = matchScoreRowToSchedule(
    row({
      week: 18,
      seasonType: 'postseason',
      home: { team: 'Washington State', score: 21 },
      away: { team: 'Boise State', score: 17 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(bowl.matched, true);
  if (bowl.matched) assert.equal(bowl.entry.gameKey, 'bowl-boise-wsu');
});

test('provider week matching still attaches when canonical week differs for opening week 0 game', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [
      game({
        key: 'isu-week-0',
        week: 0,
        canonicalWeek: 0,
        providerWeek: 1,
        canHome: 'Iowa State',
        canAway: 'Kansas State',
        date: '2025-08-23T18:00:00Z',
      }),
    ],
    resolver
  );

  const matched = matchScoreRowToSchedule(
    row({
      week: 1,
      seasonType: 'regular',
      home: { team: 'Iowa State', score: 27 },
      away: { team: 'Kansas State', score: 24 },
      status: 'final',
    }),
    index,
    resolver
  );

  assert.equal(matched.matched, true);
  if (matched.matched) assert.equal(matched.entry.gameKey, 'isu-week-0');
});

// ---------------------------------------------------------------------------
// PLATFORM-001A — score attachment regression coverage.
// Score attachment is schedule-canonical: provider rows attach only to games in
// the canonical schedule index, never create new identities, and respect
// week/season-type/orientation/postseason-week-remap boundaries.
// ---------------------------------------------------------------------------

test('resolved teams with no scheduled game cannot create scores (no_scheduled_match)', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [game({ key: 'army-navy', week: 16, canHome: 'Army', canAway: 'Navy' })],
    resolver
  );

  // Both teams resolve in the catalog, but no scheduled game exists between them.
  const result = attachScoresToSchedule({
    rows: [
      row({
        week: 16,
        home: { team: 'Iowa State', score: 21 },
        away: { team: 'Kansas State', score: 20 },
        status: 'final',
      }),
    ],
    scheduleIndex: index,
    resolver,
  });

  assert.equal(result.attachedCount, 0);
  assert.deepEqual(result.scoresByKey, {});
  assert.equal(result.diagnostics[0]?.reason, 'no_scheduled_match');
});

test('postseason providerWeek reset attaches to the canonical postseason week', () => {
  const resolver = makeResolver();
  // Provider resets bowl-week numbering (providerWeek 1) while the canonical
  // schedule keeps the postseason canonical week (17).
  const index = buildScheduleIndex(
    [
      game({
        key: 'bowl-army-navy',
        week: 17,
        canonicalWeek: 17,
        providerWeek: 1,
        stage: 'bowl',
        canHome: 'Army',
        canAway: 'Navy',
        date: '2025-12-28T18:00:00Z',
      }),
    ],
    resolver
  );

  const matched = matchScoreRowToSchedule(
    row({
      week: 1,
      seasonType: 'postseason',
      home: { team: 'Army', score: 14 },
      away: { team: 'Navy', score: 10 },
      status: 'final',
    }),
    index,
    resolver
  );

  assert.equal(matched.matched, true);
  if (matched.matched) assert.equal(matched.entry.gameKey, 'bowl-army-navy');
});

test('neutral-site reversed provider orientation attaches via identity-aware pair matching', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [
      game({
        key: 'neutral-army-navy',
        week: 16,
        stage: 'regular',
        canHome: 'Army',
        canAway: 'Navy',
        date: '2025-12-13T20:00:00Z',
      }),
    ],
    resolver
  );

  // Provider reports the neutral-site game with reversed home/away orientation.
  const matched = matchScoreRowToSchedule(
    row({
      week: 16,
      seasonType: 'regular',
      home: { team: 'Navy', score: 20 },
      away: { team: 'Army', score: 17 },
      status: 'final',
    }),
    index,
    resolver
  );

  assert.equal(matched.matched, true);
  if (matched.matched) {
    assert.equal(matched.entry.gameKey, 'neutral-army-navy');
    assert.equal(matched.orientation, 'reversed');
  }
});

test('same teams in regular season and postseason attach to distinct canonical games', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [
      game({
        key: 'reg-boise-wsu',
        week: 3,
        stage: 'regular',
        canHome: 'Boise State',
        canAway: 'Washington State',
        date: '2025-09-10T01:00:00Z',
      }),
      game({
        key: 'bowl-boise-wsu',
        week: 18,
        stage: 'bowl',
        canHome: 'Washington State',
        canAway: 'Boise State',
        date: '2025-12-28T01:00:00Z',
      }),
    ],
    resolver
  );

  const result = attachScoresToSchedule({
    rows: [
      row({
        week: 3,
        seasonType: 'regular',
        home: { team: 'Boise State', score: 30 },
        away: { team: 'Washington State', score: 28 },
        status: 'final',
      }),
      row({
        week: 18,
        seasonType: 'postseason',
        home: { team: 'Washington State', score: 21 },
        away: { team: 'Boise State', score: 17 },
        status: 'final',
      }),
    ],
    scheduleIndex: index,
    resolver,
  });

  // Each meeting lands on its own canonical game — no cross-attachment.
  assert.equal(result.attachedCount, 2);
  assert.equal(result.scoresByKey['reg-boise-wsu']?.home.score, 30);
  assert.equal(result.scoresByKey['bowl-boise-wsu']?.home.score, 21);
});
