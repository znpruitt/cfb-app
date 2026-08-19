import assert from 'node:assert/strict';
import test from 'node:test';

import { createTeamIdentityResolver } from '../teamIdentity';
import teamsCatalog from '../../data/teams.json';
import {
  buildRankingsLookup,
  getDefaultRankingsSeason,
  getTeamRanking,
  NON_FBS_POLL_NAMES,
  isKnownNonFbsPoll,
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

test('PLATFORM-104: the three FBS poll names CFBD actually serves map to their sources', () => {
  // These are the exact strings the provider returns, verified against 2014,
  // 2015, 2016, 2019, 2021, 2023, 2024, 2025 and 2026. The previous version of
  // this test asserted 'College Football Playoff Rankings' and 'USA Today
  // Coaches Poll' — neither appears in any of those seasons, so it guarded two
  // invented inputs and never exercised the collision that was live in
  // production.
  assert.equal(normalizePollSource('AP Top 25'), 'ap');
  assert.equal(normalizePollSource('Coaches Poll'), 'coaches');
  assert.equal(normalizePollSource('Playoff Committee Rankings'), 'cfp');

  // Case and surrounding whitespace are provider noise, not a different poll.
  assert.equal(normalizePollSource('  coaches poll  '), 'coaches');
});

test('PLATFORM-104: every non-FBS poll CFBD serves is refused', () => {
  // Each of these contains 'coaches', which the old substring matcher accepted
  // for the FBS Coaches column. At least one is published every season.
  for (const name of NON_FBS_POLL_NAMES) {
    assert.equal(normalizePollSource(name), null, `${name} must not claim a column`);
  }

  // Fails closed: an unrecognised name yields no column rather than someone
  // else's rankings.
  assert.equal(normalizePollSource('College Football Playoff Rankings'), null);
  assert.equal(normalizePollSource('USA Today Coaches Poll'), null);
  assert.equal(normalizePollSource(''), null);
});

test('PLATFORM-104: inherited Object keys do not resolve to a poll source', () => {
  // The allowlist was an object literal, so its lookup walked Object.prototype:
  // 'constructor' returned the Object constructor and '__proto__' an object, both
  // truthy enough to pass the caller's `if (!source)` guard and write a junk key
  // into the durable snapshot. Found by review, 2026-08-19.
  for (const inherited of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.equal(normalizePollSource(inherited), null, `${inherited} must not resolve`);
  }
});

test('PLATFORM-104: a known non-FBS poll stays known through whitespace and case', () => {
  // Round one compared the RAW provider name here while matching on the trimmed
  // lowercased one, so a variant was still refused but stopped counting as an
  // EXPECTED refusal — turning the diagnostic into the noise it exists to avoid.
  for (const variant of [
    'FCS Coaches Poll',
    '  FCS Coaches Poll  ',
    'fcs coaches poll',
    'AFCA Division II Coaches Poll',
    'afca division iii coaches poll',
  ]) {
    assert.equal(normalizePollSource(variant), null, `${variant} is still refused`);
    assert.equal(isKnownNonFbsPoll(variant), true, `${variant} is a KNOWN refusal`);
  }

  // A genuine rename is not a known refusal — that is the case worth a warning.
  assert.equal(isKnownNonFbsPoll('Coaches Poll Presented By Someone'), false);
  assert.equal(isKnownNonFbsPoll('AP Top 25'), false);
});

test('PLATFORM-104: an unrecognised poll warns once per refresh, not once per week', () => {
  const resolver = createTeamIdentityResolver({
    aliasMap: SEED_ALIASES,
    teams: teamsCatalog.items,
  });

  const week = (n: number) => ({
    season: 2027,
    seasonType: 'regular' as const,
    week: n,
    polls: [
      { poll: 'AP Top 25', ranks: [{ school: 'Georgia', rank: 1, conference: 'SEC' }] },
      // A rename affects every week of the season at once.
      { poll: 'Coaches Poll Presented By Someone', ranks: [] },
      // Known refusals must stay silent even in variant form.
      { poll: '  FCS Coaches Poll  ', ranks: [] },
    ],
  });

  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    normalizeCfbdRankingsWeeks([week(1), week(2), week(3), week(4)], resolver);
  } finally {
    console.warn = original;
  }

  assert.equal(warnings.length, 1, 'one warning for four weeks of the same rename');
  assert.match(String(warnings[0]?.[0]), /unrecognised CFBD poll name refused/);
  assert.equal((warnings[0]?.[1] as { poll?: string })?.poll, 'Coaches Poll Presented By Someone');
});

test('PLATFORM-104: the FCS Coaches Poll cannot displace the FBS Coaches Poll', () => {
  // The production defect, reproduced with the provider's real payload shape:
  // both polls are present in the same week and FCS sorts AFTER FBS, so the old
  // unconditional assignment replaced 25 FBS rows with whichever FCS school
  // happened to resolve against an FBS-only registry.
  const resolver = createTeamIdentityResolver({
    aliasMap: SEED_ALIASES,
    teams: teamsCatalog.items,
  });

  const weeks = normalizeCfbdRankingsWeeks(
    [
      {
        season: 2026,
        seasonType: 'regular',
        week: 1,
        polls: [
          { poll: 'AP Top 25', ranks: [{ school: 'Ohio State', rank: 1, conference: 'Big Ten' }] },
          { poll: 'Coaches Poll', ranks: [{ school: 'Georgia', rank: 1, conference: 'SEC' }] },
          {
            poll: 'FCS Coaches Poll',
            ranks: [{ school: 'SE Louisiana', rank: 20, conference: 'Southland' }],
          },
        ],
      },
    ],
    resolver
  );

  const coaches = weeks[0]?.polls.coaches ?? [];
  assert.equal(coaches.length, 1, 'the FBS Coaches Poll survives');
  assert.equal(coaches[0]?.teamName, 'Georgia');
  assert.ok(
    !coaches.some((entry) => /louisiana/i.test(entry.teamName)),
    'no FCS school reaches the Coaches column'
  );

  // The neighbouring columns are untouched by the collision.
  assert.equal(weeks[0]?.polls.ap.length, 1);
  assert.equal(weeks[0]?.polls.ap[0]?.teamName, 'Ohio State');
});

test('PLATFORM-104: a duplicate poll name cannot replace the column it already claimed', () => {
  // Second line of defence, and tested rather than assumed: exact matching means
  // only an identical provider name can collide now, so this is what would catch
  // a CFBD change that emits one twice. The FIRST poll holds the column.
  const resolver = createTeamIdentityResolver({
    aliasMap: SEED_ALIASES,
    teams: teamsCatalog.items,
  });

  const weeks = normalizeCfbdRankingsWeeks(
    [
      {
        season: 2026,
        seasonType: 'regular',
        week: 1,
        polls: [
          { poll: 'Coaches Poll', ranks: [{ school: 'Georgia', rank: 1, conference: 'SEC' }] },
          { poll: 'Coaches Poll', ranks: [{ school: 'Oregon', rank: 1, conference: 'Big Ten' }] },
        ],
      },
    ],
    resolver
  );

  assert.equal(weeks[0]?.polls.coaches.length, 1);
  assert.equal(weeks[0]?.polls.coaches[0]?.teamName, 'Georgia');
});

test('PLATFORM-104: the CFP column is populated from Playoff Committee Rankings', () => {
  // CFP had no end-to-end fixture at all before this. It only exists for ~6
  // weeks a season, so production would not have exercised it until November.
  const resolver = createTeamIdentityResolver({
    aliasMap: SEED_ALIASES,
    teams: teamsCatalog.items,
  });

  const weeks = normalizeCfbdRankingsWeeks(
    [
      {
        season: 2025,
        seasonType: 'regular',
        week: 12,
        polls: [
          {
            poll: 'Playoff Committee Rankings',
            ranks: [{ school: 'Texas', rank: 3, conference: 'SEC' }],
          },
          { poll: 'AP Top 25', ranks: [{ school: 'Texas', rank: 5, conference: 'SEC' }] },
        ],
      },
    ],
    resolver
  );

  const week = weeks[0];
  assert.equal(week?.polls.cfp.length, 1);
  assert.equal(week?.polls.cfp[0]?.rank, 3);

  // CFP outranks AP as the primary source, and the team carries the CFP rank
  // rather than the AP one it also appears under.
  assert.equal(week?.primarySource, 'cfp');
  assert.equal(week?.teams[0]?.primaryRank, 3);
  assert.equal(week?.teams[0]?.primaryRankSource, 'cfp');
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

test('getTeamRanking uses centralized team identity key normalization for lookups', () => {
  const lookup = new Map([['texasam', { rank: 22, rankSource: 'ap' as const }]]);
  assert.deepEqual(getTeamRanking(lookup, 'Texas A&M'), { rank: 22, rankSource: 'ap' });
  assert.deepEqual(getTeamRanking(lookup, 'Texas'), { rank: null, rankSource: null });
});
