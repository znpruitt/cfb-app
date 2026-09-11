import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../schedule';
import { buildScoreboardTeamLogosById } from '../teamLogos';

test('scoreboard logos select the 64px CFBD dark variant by resolver identity', () => {
  const logos = buildScoreboardTeamLogosById([
    {
      id: 'oregon-ducks',
      school: 'Oregon',
      logos: [
        'https://cdn.collegefootballdata.com/logos-dark/32/2483.png',
        'https://cdn.collegefootballdata.com/logos/64/2483.png',
        'https://cdn.collegefootballdata.com/logos-dark/64/2483.png',
      ],
    },
  ]);

  assert.deepEqual(logos.get('oregon'), {
    url: 'https://cdn.collegefootballdata.com/logos-dark/64/2483.png',
  });
  assert.equal(logos.has('oregon-ducks'), false);
});

test('scoreboard logos reject light-only, untrusted, and wrong-size artwork', () => {
  const nevadaGame = {
    awayProviderTeamId: 2440,
    participants: {
      away: { kind: 'team', teamId: 'nevada' },
      home: { kind: 'placeholder', slotId: 'home-tbd', displayName: 'Team TBD' },
    },
  } as unknown as AppGame;
  const logos = buildScoreboardTeamLogosById(
    [
      {
        school: 'Nevada',
        logos: ['https://cdn.collegefootballdata.com/logos/64/2440.png'],
      },
      {
        school: 'Wrong Size',
        logos: ['https://cdn.collegefootballdata.com/logos-dark/48/1.png'],
      },
      {
        school: 'Tracking Pixel',
        logos: ['https://example.com/logos-dark/64/1.png'],
      },
    ],
    [nevadaGame]
  );

  assert.equal(
    logos.has('nevada'),
    false,
    'a known catalog identity rejected for missing dark artwork must not use the schedule fallback'
  );
  assert.equal(logos.has('wrongsize'), false);
  assert.equal(logos.has('trackingpixel'), false);
});

test('scoreboard logos use a schedule provider id when the catalog has no logo data', () => {
  const seedCatalogGame = {
    awayProviderTeamId: 2440,
    participants: {
      away: { kind: 'team', teamId: 'nevada' },
      home: { kind: 'placeholder', slotId: 'home-tbd', displayName: 'Team TBD' },
    },
  } as unknown as AppGame;

  const logos = buildScoreboardTeamLogosById([{ school: 'Nevada', logos: [] }], [seedCatalogGame]);

  assert.deepEqual(logos.get('nevada'), {
    url: 'https://cdn.collegefootballdata.com/logos-dark/64/2440.png',
  });
});

test('scoreboard logos cover FCS opponents from retained schedule provider ids', () => {
  const fcsGame = {
    awayProviderTeamId: 2000,
    homeProviderTeamId: 333,
    participants: {
      away: { kind: 'team', teamId: 'abilenechristian' },
      home: { kind: 'team', teamId: 'alabama' },
    },
  } as unknown as AppGame;

  const logos = buildScoreboardTeamLogosById(
    [
      {
        school: 'Alabama',
        logos: ['https://cdn.collegefootballdata.com/logos-dark/64/333.png'],
      },
    ],
    [fcsGame]
  );

  assert.deepEqual(logos.get('abilenechristian'), {
    url: 'https://cdn.collegefootballdata.com/logos-dark/64/2000.png',
  });
  assert.deepEqual(logos.get('alabama'), {
    url: 'https://cdn.collegefootballdata.com/logos-dark/64/333.png',
  });
});

test('catalog artwork wins over a schedule-derived provider logo', () => {
  const game = {
    awayProviderTeamId: 999,
    participants: {
      away: { kind: 'team', teamId: 'alabama' },
      home: { kind: 'placeholder', label: 'TBD' },
    },
  } as unknown as AppGame;

  const logos = buildScoreboardTeamLogosById(
    [
      {
        school: 'Alabama',
        logos: ['https://cdn.collegefootballdata.com/logos-dark/64/333.png'],
      },
    ],
    [game]
  );

  assert.equal(
    logos.get('alabama')?.url,
    'https://cdn.collegefootballdata.com/logos-dark/64/333.png'
  );
});
