import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveExpandedMetadataLines,
  deriveScoreOutcomePresentation,
  formatVenueLabel,
} from '../gameCardPresentation.ts';

test('deriveExpandedMetadataLines groups kickoff/site on line 1 and venue on line 2', () => {
  const metadata = deriveExpandedMetadataLines({
    date: '2025-09-01T17:00:00.000Z',
    timeZone: 'UTC',
    useNeutralSemantics: true,
    venue: {
      stadium: 'Boone Pickens Stadium',
      city: 'Stillwater',
      state: 'OK',
      country: 'USA',
    },
  });

  assert.deepEqual(metadata.primary, ['Mon, Sep 1, 5:00 PM', 'Neutral Site']);
  assert.equal(metadata.secondary, 'Boone Pickens Stadium • Stillwater, OK');
});

test('deriveExpandedMetadataLines keeps non-neutral metadata compact and omits line 2 when venue is missing', () => {
  const metadata = deriveExpandedMetadataLines({
    date: '2025-09-01T17:00:00.000Z',
    timeZone: 'UTC',
    useNeutralSemantics: false,
    venue: null,
  });

  assert.deepEqual(metadata.primary, ['Mon, Sep 1, 5:00 PM']);
  assert.equal(metadata.secondary, null);
});

test('formatVenueLabel supports stadium-only and location-only fallbacks', () => {
  assert.equal(
    formatVenueLabel({ stadium: 'Aviva Stadium', city: null, state: null, country: 'Ireland' }),
    'Aviva Stadium'
  );
  assert.equal(
    formatVenueLabel({ stadium: null, city: 'Dublin', state: null, country: 'Ireland' }),
    'Dublin, Ireland'
  );
});

test('deriveScoreOutcomePresentation only emphasizes true final winners', () => {
  assert.deepEqual(
    deriveScoreOutcomePresentation({
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 20 },
      home: { team: 'Home', score: 17 },
    }),
    { winner: 'away', shouldEmphasize: true }
  );

  assert.deepEqual(
    deriveScoreOutcomePresentation({
      status: 'Q3 5:00',
      time: null,
      away: { team: 'Away', score: 20 },
      home: { team: 'Home', score: 17 },
    }),
    { winner: null, shouldEmphasize: false }
  );

  assert.deepEqual(
    deriveScoreOutcomePresentation({
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 20 },
      home: { team: 'Home', score: 20 },
    }),
    { winner: null, shouldEmphasize: false }
  );

  assert.deepEqual(
    deriveScoreOutcomePresentation({
      status: 'Postponed',
      time: null,
      away: { team: 'Away', score: 20 },
      home: { team: 'Home', score: 17 },
    }),
    { winner: null, shouldEmphasize: false }
  );
});
