import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../schedule';
import { buildScoreboardTeamLogosById } from '../teamLogos';

test('scoreboard logos select the 32px CFBD light and dark variants by resolver identity', () => {
  const logos = buildScoreboardTeamLogosById([
    {
      id: 'oregon-ducks',
      school: 'Oregon',
      logos: [
        'https://cdn.collegefootballdata.com/logos/500/2483.png',
        'https://cdn.collegefootballdata.com/logos-dark/32/2483.png',
        'https://cdn.collegefootballdata.com/logos/32/2483.png',
      ],
    },
  ]);

  assert.deepEqual(logos.get('oregon'), {
    lightUrl: 'https://cdn.collegefootballdata.com/logos/32/2483.png',
    darkUrl: 'https://cdn.collegefootballdata.com/logos-dark/32/2483.png',
    displaySize: 14,
  });
  assert.equal(logos.has('oregon-ducks'), false);
});

test('scoreboard logos reuse an available theme variant and reject non-CFBD URLs', () => {
  const logos = buildScoreboardTeamLogosById([
    {
      school: 'Nevada',
      logos: ['https://cdn.collegefootballdata.com/logos-dark/32/2440.png'],
    },
    {
      school: 'Tracking Pixel',
      logos: ['https://example.com/logos/32/1.png'],
    },
  ]);

  assert.deepEqual(logos.get('nevada'), {
    lightUrl: 'https://cdn.collegefootballdata.com/logos-dark/32/2440.png',
    darkUrl: 'https://cdn.collegefootballdata.com/logos-dark/32/2440.png',
    displaySize: 14,
  });
  assert.equal(logos.has('trackingpixel'), false);
});

test('scoreboard logos cover FCS opponents from retained schedule provider ids', () => {
  const fcsGame = {
    awayProviderTeamId: 2000,
    homeProviderTeamId: 333,
    participants: {
      away: { kind: 'team', teamId: 'Abilene Christian' },
      home: { kind: 'team', teamId: 'alabama' },
    },
  } as AppGame;

  const logos = buildScoreboardTeamLogosById(
    [
      {
        school: 'Alabama',
        logos: ['https://cdn.collegefootballdata.com/logos/32/333.png'],
      },
    ],
    [fcsGame]
  );

  assert.deepEqual(logos.get('Abilene Christian'), {
    lightUrl: 'https://cdn.collegefootballdata.com/logos/32/2000.png',
    darkUrl: 'https://cdn.collegefootballdata.com/logos-dark/32/2000.png',
    displaySize: 14,
  });
  assert.deepEqual(logos.get('alabama'), {
    lightUrl: 'https://cdn.collegefootballdata.com/logos/32/333.png',
    darkUrl: 'https://cdn.collegefootballdata.com/logos/32/333.png',
    displaySize: 14,
  });
});

test('18px through 24px treatments select 48px assets and retain the requested display size', () => {
  const team = {
    school: 'Ohio State',
    logos: [
      'https://cdn.collegefootballdata.com/logos/48/194.png',
      'https://cdn.collegefootballdata.com/logos-dark/48/194.png',
    ],
  };

  for (const displaySize of [18, 20, 22, 24] as const) {
    assert.deepEqual(buildScoreboardTeamLogosById([team], [], displaySize).get('ohiostate'), {
      lightUrl: 'https://cdn.collegefootballdata.com/logos/48/194.png',
      darkUrl: 'https://cdn.collegefootballdata.com/logos-dark/48/194.png',
      displaySize,
    });
  }
});

test('28px treatment selects the 64px provider asset', () => {
  const logos = buildScoreboardTeamLogosById(
    [
      {
        school: 'Ohio State',
        logos: [
          'https://cdn.collegefootballdata.com/logos/64/194.png',
          'https://cdn.collegefootballdata.com/logos-dark/64/194.png',
        ],
      },
    ],
    [],
    28
  );

  assert.deepEqual(logos.get('ohiostate'), {
    lightUrl: 'https://cdn.collegefootballdata.com/logos/64/194.png',
    darkUrl: 'https://cdn.collegefootballdata.com/logos-dark/64/194.png',
    displaySize: 28,
  });
});
