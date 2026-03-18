import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScheduleIndex,
  matchScoreRowToSchedule,
  normalizeProviderTeamName,
  resolveCanonicalTeamIdentity,
  type NormalizedScoreRow,
  type ScheduleGameForIndex,
} from '../scoreAttachment';
import { createTeamIdentityResolver } from '../teamIdentity';

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
