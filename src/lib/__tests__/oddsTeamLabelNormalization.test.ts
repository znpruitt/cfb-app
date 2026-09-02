import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScheduleAttachmentGame } from '../gameAttachment.ts';
import {
  createOddsTeamLabelNormalizer,
  parseOddsTeamLabelAliases,
} from '../oddsTeamLabelNormalization.ts';
import { createTeamIdentityResolver, type TeamCatalogItem } from '../teamIdentity.ts';

function scheduleGame(
  key: string,
  canHome: string,
  canAway: string,
  csvHome = canHome,
  csvAway = canAway
): ScheduleAttachmentGame {
  return { key, week: 1, canHome, canAway, csvHome, csvAway };
}

test('PLATFORM-122 — real CFBD alias collisions never choose between scheduled identities', async (t) => {
  const cases: Array<{
    name: string;
    aliasMap: Record<string, string>;
    teams: TeamCatalogItem[];
    games: ScheduleAttachmentGame[];
    providerLabel: string;
  }> = [
    {
      name: 'missourist — Missouri S&T / Missouri State',
      aliasMap: {},
      teams: [{ school: 'Missouri S&T' }, { school: 'Missouri State' }, { school: 'UCF' }],
      games: [
        scheduleGame('mst-ucf', 'Missouri S&T', 'UCF'),
        scheduleGame('most-ucf', 'Missouri State', 'UCF'),
      ],
      providerLabel: 'Missouri State Bears',
    },
    {
      name: 'sc — Santa Clara / South Carolina',
      aliasMap: { sc: 'South Carolina' },
      teams: [{ school: 'Santa Clara' }, { school: 'South Carolina' }, { school: 'UCF' }],
      games: [
        scheduleGame('santa-clara-ucf', 'Santa Clara', 'UCF'),
        scheduleGame('south-carolina-ucf', 'South Carolina', 'UCF', 'SC', 'UCF'),
      ],
      providerLabel: 'Santa Clara Broncos',
    },
    {
      name: 'osu — Ohio State / Ohio State Newark',
      aliasMap: { osu: 'Ohio State' },
      teams: [{ school: 'Ohio State' }, { school: 'Ohio State Newark' }, { school: 'UCF' }],
      games: [
        scheduleGame('ohio-state-ucf', 'Ohio State', 'UCF', 'OSU', 'UCF'),
        scheduleGame('ohio-state-newark-ucf', 'Ohio State Newark', 'UCF'),
      ],
      providerLabel: 'Ohio State Newark Titans',
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const resolver = createTeamIdentityResolver({
        aliasMap: fixture.aliasMap,
        teams: fixture.teams,
      });
      const normalizer = createOddsTeamLabelNormalizer({ games: fixture.games, resolver });

      assert.equal(normalizer.normalize(fixture.providerLabel), fixture.providerLabel);
    });
  }
});

test('PLATFORM-122 — a persisted alias to a scheduled identity outranks static mascot data', () => {
  const games = [
    scheduleGame('bethune-ucf', 'Bethune-Cookman', 'UCF'),
    scheduleGame('other-state-ucf', 'Other State', 'UCF'),
  ];
  const resolver = createTeamIdentityResolver({
    aliasMap: { 'bethune-cookman wildcats': 'Other State' },
    teams: [{ school: 'Bethune-Cookman' }, { school: 'Other State' }, { school: 'UCF' }],
  });
  const normalizer = createOddsTeamLabelNormalizer({ games, resolver });

  assert.equal(normalizer.normalize('Bethune-Cookman Wildcats'), 'Bethune-Cookman Wildcats');
  assert.equal(
    resolver.resolveName(normalizer.normalize('Bethune-Cookman Wildcats')).canonicalName,
    'Other State'
  );
});

test('PLATFORM-122 — malformed hand-edited residual aliases are skipped', () => {
  assert.deepEqual(
    parseOddsTeamLabelAliases({
      aliases: [
        { provider: '  Valid Provider  ', schedule: '  Valid Schedule  ' },
        { provider: 42, schedule: 'Numeric Provider' },
        { provider: 'Missing Schedule' },
        { provider: '   ', schedule: 'Blank Provider' },
        null,
      ],
    }),
    [{ provider: 'Valid Provider', schedule: 'Valid Schedule' }]
  );
  assert.deepEqual(parseOddsTeamLabelAliases({ aliases: 'not-an-array' }), []);
});
