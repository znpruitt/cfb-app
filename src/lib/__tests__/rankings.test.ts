import assert from 'node:assert/strict';
import test from 'node:test';

import { createTeamIdentityResolver } from '../teamIdentity';
import teamsCatalog from '../../data/teams.json';
import {
  buildRankingsLookup,
  getDefaultRankingsSeason,
  normalizePollSource,
  selectPrimaryRankSource,
  selectRankingsWeek,
  type RankingsResponse,
} from '../rankings';
import { normalizeCfbdRankingsWeeks } from '../server/rankings';
import { SEED_ALIASES } from '../teamNames';

test('CFP is preferred when available, otherwise AP is used', () => {
  assert.equal(
    selectPrimaryRankSource({ cfp: [{ teamId: 'a', teamName: 'A', rank: 1, rankSource: 'cfp' }] }),
    'cfp'
  );
  assert.equal(
    selectPrimaryRankSource({ ap: [{ teamId: 'a', teamName: 'A', rank: 1, rankSource: 'ap' }] }),
    'ap'
  );
  assert.equal(
    selectPrimaryRankSource({
      coaches: [{ teamId: 'a', teamName: 'A', rank: 1, rankSource: 'coaches' }],
    }),
    'coaches'
  );
});

test('canonical identity mapping normalizes rankings for inline lookups and page lists', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: SEED_ALIASES,
    teams: teamsCatalog.items,
  });

  const weeks = normalizeCfbdRankingsWeeks(
    [
      {
        season: 2025,
        seasonType: 'regular',
        week: 10,
        polls: [
          {
            poll: 'AP Top 25',
            ranks: [{ school: 'Ole Miss', rank: 12, conference: 'SEC' }],
          },
        ],
      },
    ],
    resolver
  );

  const lookup = buildRankingsLookup(weeks[0]);
  const rankedTeam = weeks[0]?.polls.ap[0];
  const resolved = resolver.resolveName(rankedTeam?.teamName ?? '');
  assert.equal(rankedTeam?.teamId, resolved.identityKey);
  assert.deepEqual(lookup.get(rankedTeam?.teamId ?? ''), { rank: 12, rankSource: 'ap' });
});

test('poll source normalization recognizes CFP, AP, and Coaches polls', () => {
  assert.equal(normalizePollSource('College Football Playoff Rankings'), 'cfp');
  assert.equal(normalizePollSource('AP Top 25'), 'ap');
  assert.equal(normalizePollSource('USA Today Coaches Poll'), 'coaches');
});

test('selected regular-season week does not leak latest-week rankings when no matching poll exists', () => {
  const rankings: RankingsResponse = {
    weeks: [
      {
        season: 2025,
        seasonType: 'regular',
        week: 1,
        primarySource: 'ap',
        teams: [],
        polls: { cfp: [], ap: [], coaches: [] },
      },
      {
        season: 2025,
        seasonType: 'regular',
        week: 10,
        primarySource: 'cfp',
        teams: [],
        polls: { cfp: [], ap: [], coaches: [] },
      },
    ],
    latestWeek: {
      season: 2025,
      seasonType: 'postseason',
      week: 16,
      primarySource: 'cfp',
      teams: [],
      polls: { cfp: [], ap: [], coaches: [] },
    },
    meta: { source: 'cfbd', cache: 'miss', generatedAt: '2025-01-01T00:00:00.000Z' },
  };

  assert.equal(selectRankingsWeek({ rankings, selectedWeek: 0, selectedTab: 0 }), null);
  assert.equal(selectRankingsWeek({ rankings, selectedWeek: 2, selectedTab: 2 }), null);
});

test('postseason view uses latest available rankings rather than a stale regular-season selection', () => {
  const latestWeek = {
    season: 2025,
    seasonType: 'postseason',
    week: 16,
    primarySource: 'cfp' as const,
    teams: [],
    polls: { cfp: [], ap: [], coaches: [] },
  };
  const rankings: RankingsResponse = {
    weeks: [
      {
        season: 2025,
        seasonType: 'regular',
        week: 14,
        primarySource: 'cfp',
        teams: [],
        polls: { cfp: [], ap: [], coaches: [] },
      },
      latestWeek,
    ],
    latestWeek,
    meta: { source: 'cfbd', cache: 'miss', generatedAt: '2025-01-01T00:00:00.000Z' },
  };

  assert.equal(
    selectRankingsWeek({ rankings, selectedWeek: 14, selectedTab: 'postseason' }),
    latestWeek
  );
});

test('default rankings season uses football-season logic during the offseason', () => {
  assert.equal(getDefaultRankingsSeason(null, new Date('2026-03-21T12:00:00.000Z')), 2025);
  assert.equal(getDefaultRankingsSeason(2030, new Date('2026-03-21T12:00:00.000Z')), 2030);
});

test('dashboard/page offseason defaults stay aligned through shared season fallback', () => {
  assert.equal(getDefaultRankingsSeason(null, new Date('2026-03-21T12:00:00.000Z')), 2025);
});
