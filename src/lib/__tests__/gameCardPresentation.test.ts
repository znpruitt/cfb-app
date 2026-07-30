import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveExpandedMetadataLines,
  deriveScoreOutcomePresentation,
  formatExpandedKickoff,
  formatPrimaryBroadcastLabel,
  formatVenueLabel,
} from '../gameCardPresentation.ts';
import type { ScheduleMediaItem } from '../schedule/schedulePresentation.ts';

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

// --- PLATFORM-086E1C1: TBD-aware kickoff + broadcast presentation -------------

test('formatExpandedKickoff keeps the confirmed format and TBD fallback unchanged', () => {
  assert.equal(formatExpandedKickoff('2025-09-01T17:00:00.000Z', 'UTC'), 'Mon, Sep 1, 5:00 PM');
  assert.equal(
    formatExpandedKickoff('2025-09-01T17:00:00.000Z', 'UTC', false),
    'Mon, Sep 1, 5:00 PM',
    'an explicit startTimeTBD: false is a confirmed kickoff'
  );
  assert.equal(formatExpandedKickoff(null, 'UTC'), 'TBD');
  assert.equal(formatExpandedKickoff('not-a-date', 'UTC', true), 'TBD');
});

test('formatExpandedKickoff renders date plus Time TBD when startTimeTBD is true', () => {
  assert.equal(
    formatExpandedKickoff('2025-09-01T17:00:00.000Z', 'UTC', true),
    'Mon, Sep 1 · Time TBD',
    'the placeholder clock is never displayed as a confirmed time'
  );
});

test('formatPrimaryBroadcastLabel picks one outlet by tv → web → ppv → mobile → radio priority', () => {
  const media: ScheduleMediaItem[] = [
    { gameId: '1', mediaType: 'radio', outlet: 'ESPN Radio' },
    { gameId: '1', mediaType: 'web', outlet: 'ESPN+' },
    { gameId: '1', mediaType: 'tv', outlet: 'ESPN' },
  ];
  assert.equal(formatPrimaryBroadcastLabel(media), 'ESPN');
  assert.equal(
    formatPrimaryBroadcastLabel(media.filter((row) => row.mediaType !== 'tv')),
    'Streaming · ESPN+'
  );
  assert.equal(
    formatPrimaryBroadcastLabel([{ gameId: '1', mediaType: 'radio', outlet: 'KVET' }]),
    'Radio · KVET',
    'radio-only data uses an explicit radio label'
  );
  assert.equal(
    formatPrimaryBroadcastLabel([{ gameId: '1', mediaType: 'mobile', outlet: 'App' }]),
    'Streaming · App'
  );
  assert.equal(formatPrimaryBroadcastLabel([]), null);
  assert.equal(formatPrimaryBroadcastLabel(undefined), null);
});

test('formatPrimaryBroadcastLabel is deterministic within one media type', () => {
  const forward: ScheduleMediaItem[] = [
    { gameId: '1', mediaType: 'tv', outlet: 'ESPN2' },
    { gameId: '1', mediaType: 'tv', outlet: 'ABC' },
  ];
  assert.equal(formatPrimaryBroadcastLabel(forward), 'ABC');
  assert.equal(formatPrimaryBroadcastLabel([...forward].reverse()), 'ABC');
});

test('deriveExpandedMetadataLines orders line 1 as kickoff, broadcast, then neutral site', () => {
  const metadata = deriveExpandedMetadataLines({
    date: '2025-08-30T00:00:00.000Z',
    timeZone: 'UTC',
    useNeutralSemantics: true,
    venue: { stadium: 'DKR', city: 'Austin', state: 'TX', country: 'USA' },
    media: [{ gameId: '1', mediaType: 'tv', outlet: 'ESPN' }],
  });
  assert.deepEqual(metadata.primary, ['Sat, Aug 30, 12:00 AM', 'ESPN', 'Neutral Site']);
  assert.equal(metadata.secondary, 'DKR • Austin, TX');
});

test('deriveExpandedMetadataLines combines Time TBD with a broadcast and omits absent enrichment', () => {
  const withTbd = deriveExpandedMetadataLines({
    date: '2025-08-30T00:00:00.000Z',
    timeZone: 'UTC',
    useNeutralSemantics: false,
    venue: null,
    startTimeTBD: true,
    media: [{ gameId: '1', mediaType: 'tv', outlet: 'ESPN' }],
  });
  assert.deepEqual(withTbd.primary, ['Sat, Aug 30 · Time TBD', 'ESPN']);

  const withoutEnrichment = deriveExpandedMetadataLines({
    date: '2025-08-30T00:00:00.000Z',
    timeZone: 'UTC',
    useNeutralSemantics: false,
    venue: null,
  });
  assert.deepEqual(
    withoutEnrichment.primary,
    ['Sat, Aug 30, 12:00 AM'],
    'missing enrichment preserves the exact prior card output'
  );
});
