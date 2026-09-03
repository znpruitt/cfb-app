import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverviewGameItem } from '../../overview';
import type { AppGame } from '../../schedule';
import type { ScorePack } from '../../scores';
import type { PrioritizedOverviewItem } from '../overview';
import { selectOverviewGameSections } from '../overviewGameSections';

const FUTURE = '2026-09-12T16:00:00.000Z';
const KICKOFF = '2026-09-05T16:00:00.000Z';

function game(overrides: Partial<AppGame> = {}): AppGame {
  const key = overrides.key ?? 'game';
  return {
    key,
    eventId: overrides.eventId ?? key,
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? KICKOFF,
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    rawStatus: overrides.rawStatus,
    completed: overrides.completed,
    startTimeTBD: overrides.startTimeTBD,
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? key,
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      away: {
        kind: 'team',
        teamId: `${key}-away`,
        displayName: `${key} Away`,
        canonicalName: `${key} Away`,
        rawName: `${key} Away`,
      },
      home: {
        kind: 'team',
        teamId: `${key}-home`,
        displayName: `${key} Home`,
        canonicalName: `${key} Home`,
        rawName: `${key} Home`,
      },
    },
    csvAway: overrides.csvAway ?? `${key} Away`,
    csvHome: overrides.csvHome ?? `${key} Home`,
    canAway: overrides.canAway ?? `${key} Away`,
    canHome: overrides.canHome ?? `${key} Home`,
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

function score(status: string, away: number | null, home: number | null): ScorePack {
  return {
    status,
    time: null,
    away: { team: 'Away', score: away },
    home: { team: 'Home', score: home },
  };
}

function item(
  gameValue: AppGame,
  options: {
    score?: ScorePack;
    awayOwner?: string;
    homeOwner?: string;
    awayIsLeagueTeam?: boolean;
    homeIsLeagueTeam?: boolean;
  } = {}
): OverviewGameItem {
  const awayOwner = Object.hasOwn(options, 'awayOwner') ? options.awayOwner : 'Alice';
  const homeOwner = Object.hasOwn(options, 'homeOwner') ? options.homeOwner : 'Bob';
  return {
    bucket: {
      game: gameValue,
      awayOwner,
      homeOwner,
      awayIsLeagueTeam: options.awayIsLeagueTeam ?? true,
      homeIsLeagueTeam: options.homeIsLeagueTeam ?? true,
    },
    score: options.score,
    priority: awayOwner === undefined || homeOwner === undefined ? 1 : 2,
    sortDate: gameValue.date ? Date.parse(gameValue.date) : Number.POSITIVE_INFINITY,
  };
}

function prioritized(itemValue: OverviewGameItem, priority = 0): PrioritizedOverviewItem {
  return {
    item: itemValue,
    isGameOfSlate: priority >= 90,
    isUpsetWatch: false,
    isRankedSpotlight: priority >= 70 && priority < 90,
    highlightLabel: priority >= 90 ? 'Game of the Week' : null,
    highlightTags: priority > 0 ? [{ id: 'top25', text: 'Top 25 Matchup', priority }] : [],
  };
}

function select(
  sectionItems: OverviewGameItem[],
  now: string,
  watchlistCandidates = sectionItems.map((entry) => prioritized(entry))
) {
  return selectOverviewGameSections({
    sectionItems,
    scheduleGames: sectionItems.map((entry) => entry.bucket.game),
    watchlistCandidates,
    featuredGameKeys: new Set(),
    now: new Date(now),
  });
}

function memberships(
  sections: ReturnType<typeof selectOverviewGameSections>,
  key: string
): string[] {
  return [
    ...sections.scheduled
      .filter((entry) => entry.item.bucket.game.key === key)
      .map(() => 'scheduled'),
    ...sections.live.filter((entry) => entry.bucket.game.key === key).map(() => 'live'),
    ...sections.recentFinals
      .filter((entry) => entry.bucket.game.key === key)
      .map(() => 'recentFinals'),
  ];
}

test('scheduled promotes to Live exactly at a confirmed kickoff', () => {
  const scheduled = item(game({ key: 'transition', date: KICKOFF }), {
    score: score('Scheduled', null, null),
  });

  const before = select([scheduled], '2026-09-05T15:59:59.000Z');
  const after = select([scheduled], KICKOFF);

  assert.deepEqual(memberships(before, 'transition'), ['scheduled']);
  assert.deepEqual(memberships(after, 'transition'), ['live']);
  assert.equal(after.live[0]?.routeStatus.kind, 'awaiting-score');
});

test('Live promotes to Recent finals only when a final score attaches', () => {
  const gameValue = game({ key: 'score-transition', date: KICKOFF });
  const live = item(gameValue, { score: score('In Progress', 7, 3) });
  const final = item(gameValue, { score: score('Final', 21, 17) });
  const now = '2026-09-05T17:00:00.000Z';

  assert.deepEqual(memberships(select([live], now), gameValue.key), ['live']);
  assert.deepEqual(memberships(select([final], now), gameValue.key), ['recentFinals']);
});

test('the abandonment gate runs before in-progress score-state routing', () => {
  const strandedLive = item(game({ key: 'stranded-live', date: KICKOFF }), {
    score: score('4th Quarter', 14, 10),
  });
  const atBoundary = select([strandedLive], '2026-09-06T00:00:00.000Z');
  const afterBoundary = select([strandedLive], '2026-09-06T00:00:00.001Z');

  assert.deepEqual(memberships(atBoundary, strandedLive.bucket.game.key), ['live']);
  assert.deepEqual(memberships(afterBoundary, strandedLive.bucket.game.key), []);
});

test('terminal metadata waits for both final scores and keeps the eight-hour bound', () => {
  const incompleteFinal = item(game({ key: 'incomplete-final', date: KICKOFF }), {
    score: score('Final', 21, null),
  });
  const completedWithoutScore = item(
    game({ key: 'completed-scoreless', date: KICKOFF, completed: true })
  );
  const boundedNow = '2026-09-05T17:00:00.000Z';
  const abandonedNow = '2026-09-06T00:00:00.001Z';

  for (const entry of [incompleteFinal, completedWithoutScore]) {
    const bounded = select([entry], boundedNow);
    assert.deepEqual(memberships(bounded, entry.bucket.game.key), ['live']);
    assert.equal(bounded.live[0]?.routeStatus.kind, 'awaiting-score');
    assert.deepEqual(memberships(select([entry], abandonedNow), entry.bucket.game.key), []);
  }
});

test('unknown with a future kickoff routes only to the watchlist', () => {
  const unknown = item(game({ key: 'future-unknown', date: FUTURE }));
  const sections = select([unknown], '2026-09-05T17:00:00.000Z');

  assert.deepEqual(memberships(sections, unknown.bucket.game.key), ['scheduled']);
});

test('unknown with a past kickoff stays Live with Awaiting score for the bounded gap', () => {
  const unknown = item(game({ key: 'past-unknown', date: KICKOFF }));
  const sections = select([unknown], '2026-09-05T17:00:00.000Z');

  assert.deepEqual(memberships(sections, unknown.bucket.game.key), ['live']);
  assert.deepEqual(sections.live[0]?.routeStatus, {
    kind: 'awaiting-score',
    label: 'Awaiting score',
  });
});

test('scheduled and unknown scoreless rows are excluded after the per-game eight-hour bound', () => {
  const scheduled = item(game({ key: 'old-scheduled', date: KICKOFF }), {
    score: score('Scheduled', null, null),
  });
  const unknown = item(game({ key: 'old-unknown', date: KICKOFF }));
  const sections = select([scheduled, unknown], '2026-09-06T00:00:00.001Z');

  assert.deepEqual(memberships(sections, scheduled.bucket.game.key), []);
  assert.deepEqual(memberships(sections, unknown.bucket.game.key), []);
});

test('a Time-TBD placeholder never promotes on its placeholder timestamp', () => {
  const placeholderTime = item(game({ key: 'time-tbd', date: KICKOFF, startTimeTBD: true }), {
    score: score('Scheduled', null, null),
  });
  const sections = select([placeholderTime], '2026-09-20T17:00:00.000Z');

  assert.deepEqual(memberships(sections, placeholderTime.bucket.game.key), ['scheduled']);
});

test('an unresolved CFP participant shell cannot bypass the pending authority as in-progress', () => {
  const shell = item(
    game({
      key: 'cfp-shell',
      date: KICKOFF,
      participants: {
        away: {
          kind: 'placeholder',
          slotId: 'away',
          displayName: 'Winner of A',
        },
        home: {
          kind: 'team',
          teamId: 'owned-home',
          displayName: 'Owned Home',
          canonicalName: 'Owned Home',
          rawName: 'Owned Home',
        },
      },
    }),
    {
      score: score('In Progress', 0, 0),
      awayOwner: undefined,
      homeOwner: 'Alice',
    }
  );
  const sections = select([shell], '2026-09-05T17:00:00.000Z');

  assert.deepEqual(memberships(sections, shell.bucket.game.key), []);
});

test('NoClaim opposite undefined or non-league ownership is the none-owned row', () => {
  const noClaimUndefined = item(game({ key: 'none-undefined', date: FUTURE }), {
    awayOwner: 'NoClaim',
    homeOwner: undefined,
  });
  const noClaimNonLeague = item(game({ key: 'none-non-league', date: FUTURE }), {
    awayOwner: 'NoClaim',
    homeOwner: undefined,
    homeIsLeagueTeam: false,
  });
  const sections = select([noClaimUndefined, noClaimNonLeague], '2026-09-05T17:00:00.000Z');

  assert.deepEqual(memberships(sections, noClaimUndefined.bucket.game.key), []);
  assert.deepEqual(memberships(sections, noClaimNonLeague.bucket.game.key), []);
});

test('known disruption never enters Live or claims Awaiting score', () => {
  const disrupted = item(game({ key: 'postponed', date: KICKOFF }), {
    score: score('Postponed', null, null),
  });
  const sections = select([disrupted], '2026-09-05T17:00:00.000Z');

  assert.deepEqual(memberships(sections, disrupted.bucket.game.key), ['scheduled']);
  assert.deepEqual(sections.scheduled[0]?.item.bucket.game.key, disrupted.bucket.game.key);
  assert.deepEqual(sections.scheduled[0]?.routeStatus, {
    kind: 'disrupted',
    label: 'Postponed',
  });
});

test('attached in-progress scores sort ahead of awaiting rows before the six-row cap', () => {
  const awaiting = Array.from({ length: 6 }, (_, index) =>
    item(game({ key: `awaiting-${index}`, date: KICKOFF }))
  );
  const scored = item(game({ key: 'scored-live', date: KICKOFF }), {
    score: score('In Progress', 0, 0),
  });
  const sections = select([...awaiting, scored], '2026-09-05T17:00:00.000Z');

  assert.equal(sections.live.length, 6);
  assert.equal(sections.live[0]?.bucket.game.key, 'scored-live');
  assert.equal(
    sections.live.filter((entry) => entry.routeStatus.kind === 'awaiting-score').length,
    5
  );
});

test('undated live rows retain a deterministic key order under the six-row cap', () => {
  const laterKey = item(game({ key: 'z-undated' }), {
    score: score('In Progress', 0, 0),
  });
  const earlierKey = item(game({ key: 'a-undated' }), {
    score: score('In Progress', 0, 0),
  });
  laterKey.sortDate = Number.NaN;
  earlierKey.sortDate = Number.NaN;

  const sections = select([laterKey, earlierKey], '2026-09-05T17:00:00.000Z');
  assert.deepEqual(
    sections.live.map((entry) => entry.bucket.game.key),
    ['a-undated', 'z-undated']
  );
});

test('watchlist routes the full prioritised pool and caps six survivors', () => {
  const kickedOff = item(game({ key: 'promoted', date: KICKOFF }));
  const future = Array.from({ length: 8 }, (_, index) =>
    item(game({ key: `future-${index}`, date: `2026-09-12T${16 + index}:00:00.000Z` }))
  );
  const candidates = [
    prioritized(kickedOff, 100),
    ...future.map((entry) => prioritized(entry, 90)),
  ];
  const sections = select([kickedOff, ...future], '2026-09-05T17:00:00.000Z', candidates);

  assert.deepEqual(
    sections.scheduled.map((entry) => entry.item.bucket.game.key),
    ['future-0', 'future-1', 'future-2', 'future-3', 'future-4', 'future-5']
  );
  assert.deepEqual(memberships(sections, kickedOff.bucket.game.key), ['live']);
});

test('a Featured game remains outside all three state sections', () => {
  const featured = item(game({ key: 'featured-final' }), { score: score('Final', 31, 24) });
  const sections = selectOverviewGameSections({
    sectionItems: [featured],
    scheduleGames: [featured.bucket.game],
    watchlistCandidates: [],
    featuredGameKeys: new Set([featured.bucket.game.key]),
    now: new Date('2026-09-05T17:00:00.000Z'),
  });

  assert.deepEqual(memberships(sections, featured.bucket.game.key), []);
});

test('Recent finals clears at Thursday 06:00 ET and not one minute before', () => {
  const final = item(game({ key: 'week-final', date: '2026-09-05T20:00:00.000Z' }), {
    score: score('Final', 31, 24),
  });
  const lateWeekGame = game({ key: 'late-week-game', date: '2026-09-06T23:00:00.000Z' });
  const before = selectOverviewGameSections({
    sectionItems: [final],
    scheduleGames: [final.bucket.game, lateWeekGame],
    watchlistCandidates: [],
    featuredGameKeys: new Set(),
    now: new Date('2026-09-10T09:59:00.000Z'),
  });
  const atBoundary = selectOverviewGameSections({
    sectionItems: [final],
    scheduleGames: [final.bucket.game, lateWeekGame],
    watchlistCandidates: [],
    featuredGameKeys: new Set(),
    now: new Date('2026-09-10T10:00:00.000Z'),
  });

  assert.deepEqual(memberships(before, final.bucket.game.key), ['recentFinals']);
  assert.deepEqual(memberships(atBoundary, final.bucket.game.key), []);
});

test('every routed game occupies at most one state section', () => {
  const items = [
    item(game({ key: 'scheduled', date: FUTURE })),
    item(game({ key: 'live', date: KICKOFF }), { score: score('In Progress', 0, 0) }),
    item(game({ key: 'final', date: KICKOFF }), { score: score('Final', 14, 10) }),
  ];
  const sections = select(items, '2026-09-05T17:00:00.000Z');

  for (const entry of items) {
    assert.equal(memberships(sections, entry.bucket.game.key).length, 1, entry.bucket.game.key);
  }
});
