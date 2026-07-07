import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScheduleIndex,
  matchScoreRowToSchedule,
  type NormalizedScoreRow,
  type ScheduleGameForIndex,
} from '../scoreAttachment.ts';
import { buildScheduleFromApi } from '../schedule.ts';
import { createTeamIdentityResolver } from '../teamIdentity.ts';

// ---------------------------------------------------------------------------
// PLATFORM-073 — postseason attachment edge cases.
//
// 1. A half-hydrated / placeholder postseason game with a provider id must still
//    be attachable by that id (provider identity is hydration-independent).
// 2. A score row without a season type must NOT attach across phases when a
//    same-pair regular/postseason rematch makes the phase ambiguous.
// 3. Postseason-only schedule input must not be week-remapped on regular-season
//    assumptions (no phantom span to append postseason weeks to).
// ---------------------------------------------------------------------------

const TEAMS = [
  { school: 'Alabama', level: 'FBS', conference: 'SEC' },
  { school: 'Georgia', level: 'FBS', conference: 'SEC' },
  { school: 'Notre Dame', level: 'FBS', conference: 'Independent' },
  { school: 'Penn State', level: 'FBS', conference: 'Big Ten' },
];

function makeResolver(aliasMap: Record<string, string> = {}) {
  return createTeamIdentityResolver({ aliasMap, teams: TEAMS });
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
    seasonType: 'seasonType' in input ? input.seasonType! : 'regular',
    providerEventId: input.providerEventId ?? null,
    status: input.status,
    time: input.time ?? null,
    date: input.date ?? null,
    home: input.home,
    away: input.away,
  };
}

// --- Defect 1: half-hydrated game indexed + attachable by provider id ---------

test('a placeholder postseason game with a provider id is indexed by provider id', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [
      // A CFP/bowl slot that has a provider event id before its teams are set:
      // empty canHome/canAway and placeholder participants.
      game({
        key: 'orange-bowl',
        week: 17,
        canHome: '',
        canAway: '',
        stage: 'bowl',
        providerGameId: 'evt-777',
        participants: { home: { kind: 'placeholder' }, away: { kind: 'placeholder' } },
      }),
    ],
    resolver
  );

  // Previously the game was dropped from the whole index (unresolved participants),
  // so provider-id attachment could never find it.
  assert.equal(index.byProviderGameId.get('evt-777')?.length, 1);

  // A finalized score row carrying that provider id + real teams attaches by id.
  const match = matchScoreRowToSchedule(
    row({
      seasonType: 'postseason',
      providerEventId: 'evt-777',
      home: { team: 'Notre Dame', score: 27 },
      away: { team: 'Penn State', score: 24 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(match.matched, true);
  assert.equal(match.matched && match.strategy, 'provider_event_id');
  assert.equal(match.matched && match.entry.gameKey, 'orange-bowl');
});

test('provider-id match attaches even when a score-row team label is unresolved', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [
      game({
        key: 'sugar-bowl',
        week: 17,
        canHome: '',
        canAway: '',
        stage: 'bowl',
        providerGameId: 'evt-888',
        participants: { home: { kind: 'placeholder' }, away: { kind: 'placeholder' } },
      }),
    ],
    resolver
  );

  // Catalog/alias lag: one side's label is not in the catalog, so it can't be
  // resolved — the SAME lag that can leave the schedule game half-hydrated. The
  // unique provider id must still attach (it precedes the team-resolution gate).
  const match = matchScoreRowToSchedule(
    row({
      seasonType: 'postseason',
      providerEventId: 'evt-888',
      home: { team: 'Notre Dame', score: 31 },
      away: { team: 'Some Unlisted School', score: 28 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(match.matched, true);
  assert.equal(match.matched && match.strategy, 'provider_event_id');
  assert.equal(match.matched && match.entry.gameKey, 'sugar-bowl');
});

test('an unresolved-team row does NOT attach by provider id to a hydrated (owned) game', () => {
  const resolver = makeResolver();
  // A fully hydrated game with real, ownable sides.
  const index = buildScheduleIndex(
    [
      game({
        key: 'reg-owned',
        week: 10,
        canHome: 'Alabama',
        canAway: 'Georgia',
        providerGameId: 'evt-owned',
      }),
    ],
    resolver
  );

  // A row with a matching provider id but an unresolvable team label AND reversed
  // order. Attached scores are stored positionally, so accepting this could swap the
  // score onto the wrong owner. It must NOT attach — side attribution can't be
  // established for an owned game.
  const match = matchScoreRowToSchedule(
    row({
      seasonType: 'regular',
      providerEventId: 'evt-owned',
      home: { team: 'Some Unlisted School', score: 10 },
      away: { team: 'Alabama', score: 41 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(match.matched, false);
});

test('a fully hydrated game with real teams still indexes normally by team+week', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [game({ key: 'reg', week: 3, canHome: 'Alabama', canAway: 'Georgia', providerGameId: null })],
    resolver
  );
  assert.equal(index.entries.length, 1, 'hydrated games remain in the team-keyed entries list');
  const match = matchScoreRowToSchedule(
    row({
      week: 3,
      home: { team: 'Alabama', score: 21 },
      away: { team: 'Georgia', score: 20 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(match.matched, true);
  assert.equal(match.matched && match.strategy, 'exact_home_away_week');
});

// --- Defect 2: null seasonType cross-phase rematch ----------------------------

test('a null-seasonType row does not attach across a regular/postseason rematch', () => {
  const resolver = makeResolver();
  // Same pair plays a regular game at week 1 AND a postseason game whose provider
  // week also restarts at 1 (CFBD postseason numbering) — colliding in the week
  // dimension. No provider ids, so matching falls back to week/pair.
  const index = buildScheduleIndex(
    [
      game({ key: 'reg-wk1', week: 1, canHome: 'Alabama', canAway: 'Georgia' }),
      game({
        key: 'cfp-final',
        week: 17,
        providerWeek: 1,
        canonicalWeek: 17,
        stage: 'playoff',
        canHome: 'Alabama',
        canAway: 'Georgia',
      }),
    ],
    resolver
  );

  // Null phase + week 1 matches BOTH phases → ambiguous, refuse to attach.
  const ambiguous = matchScoreRowToSchedule(
    row({
      week: 1,
      seasonType: null,
      home: { team: 'Alabama', score: 30 },
      away: { team: 'Georgia', score: 24 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(ambiguous.matched, false);
  assert.equal(ambiguous.matched === false && ambiguous.reason, 'multiple_candidate_matches');

  // An explicit phase disambiguates deterministically.
  const regular = matchScoreRowToSchedule(
    row({
      week: 1,
      seasonType: 'regular',
      home: { team: 'Alabama', score: 30 },
      away: { team: 'Georgia', score: 24 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(regular.matched, true);
  assert.equal(regular.matched && regular.entry.gameKey, 'reg-wk1');

  const postseason = matchScoreRowToSchedule(
    row({
      week: 1,
      seasonType: 'postseason',
      home: { team: 'Alabama', score: 30 },
      away: { team: 'Georgia', score: 24 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(postseason.matched, true);
  assert.equal(postseason.matched && postseason.entry.gameKey, 'cfp-final');
});

test('a null-seasonType rematch attaches by kickoff date when week is cross-phase ambiguous', () => {
  const resolver = makeResolver();
  // Same collision as above (regular wk1 + postseason providerWeek 1), but both
  // schedule games are dated and the row carries the postseason kickoff.
  const index = buildScheduleIndex(
    [
      game({
        key: 'reg-wk1',
        week: 1,
        canHome: 'Alabama',
        canAway: 'Georgia',
        date: '2025-08-30T18:00:00Z',
      }),
      game({
        key: 'cfp-final',
        week: 17,
        providerWeek: 1,
        canonicalWeek: 17,
        stage: 'playoff',
        canHome: 'Alabama',
        canAway: 'Georgia',
        date: '2026-01-19T23:30:00Z',
      }),
    ],
    resolver
  );

  // Week alone is cross-phase ambiguous, but the kickoff date is within tolerance of
  // exactly one meeting → attach to it instead of rejecting.
  const match = matchScoreRowToSchedule(
    row({
      week: 1,
      seasonType: null,
      date: '2026-01-19T23:40:00Z',
      home: { team: 'Alabama', score: 34 },
      away: { team: 'Georgia', score: 31 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(match.matched, true);
  assert.equal(match.matched && match.strategy, 'pair_date');
  assert.equal(match.matched && match.entry.gameKey, 'cfp-final');
});

test('a null-seasonType row still attaches when only one phase has the pair', () => {
  const resolver = makeResolver();
  const index = buildScheduleIndex(
    [game({ key: 'reg-only', week: 5, canHome: 'Notre Dame', canAway: 'Penn State' })],
    resolver
  );
  const match = matchScoreRowToSchedule(
    row({
      week: 5,
      seasonType: null,
      home: { team: 'Notre Dame', score: 17 },
      away: { team: 'Penn State', score: 14 },
      status: 'final',
    }),
    index,
    resolver
  );
  assert.equal(match.matched, true);
  assert.equal(match.matched && match.entry.gameKey, 'reg-only');
});

// --- Defect 3: postseason-only week remap guard -------------------------------

const POSTSEASON_ITEM = {
  id: 'cfp-championship',
  week: 1,
  startDate: '2026-01-19T23:30:00Z',
  neutralSite: true,
  conferenceGame: false,
  homeTeam: 'Notre Dame',
  awayTeam: 'Penn State',
  homeConference: 'Independent',
  awayConference: 'Big Ten',
  status: 'scheduled',
  label: 'CFP National Championship',
  seasonType: 'postseason' as const,
};

test('postseason-only input keeps postseason provider weeks (no regular-season remap)', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    aliasMap: {},
    teams: TEAMS,
    scheduleItems: [POSTSEASON_ITEM],
  });
  const champ = built.games.find((g) => g.canHome === 'Notre Dame' || g.canAway === 'Penn State');
  assert.ok(champ, 'expected the postseason game to be built');
  // No regular-season context → the CFBD provider week (1) is preserved, NOT shifted
  // by a phantom regular-season span.
  assert.equal(champ.week, 1);
});

test('mixed input still remaps postseason weeks after the regular season', () => {
  const built = buildScheduleFromApi({
    season: 2025,
    aliasMap: {},
    teams: TEAMS,
    scheduleItems: [
      {
        id: 'reg-wk15',
        week: 15,
        startDate: '2025-12-06T20:00:00Z',
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Alabama',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        seasonType: 'regular',
      },
      POSTSEASON_ITEM,
    ],
  });
  const champ = built.games.find((g) => g.canHome === 'Notre Dame' || g.canAway === 'Penn State');
  assert.ok(champ, 'expected the postseason game to be built');
  // maxRegularSeasonWeek (15) + providerWeek (1) = 16 — shifted past the regular season.
  assert.equal(champ.week, 16);
});
