import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatExpandedKickoff,
  formatPrimaryBroadcastLabel,
  formatVenueLabel,
} from '../gameCardPresentation.ts';
import type { ScheduleMediaItem } from '../schedule/schedulePresentation.ts';

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
