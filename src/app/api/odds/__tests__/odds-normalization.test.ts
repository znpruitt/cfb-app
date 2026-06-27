import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUpstreamOddsEvent } from '../routeInternals.ts';

// ---------------------------------------------------------------------------
// PLATFORM-031 — upstream Odds API `commence_time` must survive normalization as
// `commenceTime` so the attachment layer can disambiguate same-pair meetings.
// ---------------------------------------------------------------------------

test('normalizeUpstreamOddsEvent carries commence_time through as commenceTime', () => {
  const normalized = normalizeUpstreamOddsEvent({
    home_team: 'Georgia Bulldogs',
    away_team: 'Texas Longhorns',
    commence_time: '2025-12-06T20:00:00Z',
    bookmakers: [],
  });

  assert.ok(normalized);
  assert.equal(normalized?.homeTeam, 'Georgia Bulldogs');
  assert.equal(normalized?.awayTeam, 'Texas Longhorns');
  assert.equal(normalized?.commenceTime, '2025-12-06T20:00:00Z');
});

test('normalizeUpstreamOddsEvent yields null commenceTime when commence_time is absent or blank', () => {
  const missing = normalizeUpstreamOddsEvent({
    home_team: 'Georgia',
    away_team: 'Texas',
    bookmakers: [],
  });
  assert.equal(missing?.commenceTime, null);

  const blank = normalizeUpstreamOddsEvent({
    home_team: 'Georgia',
    away_team: 'Texas',
    commence_time: '   ',
    bookmakers: [],
  });
  assert.equal(blank?.commenceTime, null);
});

test('normalizeUpstreamOddsEvent rejects rows missing a team', () => {
  assert.equal(
    normalizeUpstreamOddsEvent({ home_team: 'Georgia', commence_time: '2025-09-06T23:30:00Z' }),
    null
  );
  assert.equal(normalizeUpstreamOddsEvent({ away_team: 'Texas' }), null);
});
