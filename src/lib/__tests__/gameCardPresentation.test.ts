import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatExpandedKickoff,
  formatMatchupsOddsFooter,
  formatPrimaryBroadcastLabel,
  formatVenueLabel,
} from '../gameCardPresentation.ts';
import type { CombinedOdds } from '../odds.ts';
import {
  MEDIA_TYPE_DISPLAY_PRIORITY,
  type ScheduleMediaItem,
} from '../schedule/schedulePresentation.ts';

function combinedOdds(overrides: Partial<CombinedOdds> = {}): CombinedOdds {
  return {
    favorite: null,
    spread: null,
    homeSpread: null,
    awaySpread: null,
    spreadPriceHome: null,
    spreadPriceAway: null,
    total: null,
    mlHome: null,
    mlAway: null,
    overPrice: null,
    underPrice: null,
    source: null,
    bookmakerKey: null,
    capturedAt: null,
    lineSourceStatus: 'latest',
    ...overrides,
  };
}

const EXPECTED_MINUS_SIGN = String.fromCodePoint(0x2212);
const EXPECTED_MIDDLE_DOT = String.fromCodePoint(0x00b7);

test("formatMatchupsOddsFooter uses the favorite side's row name instead of the canonical favorite", () => {
  const label = formatMatchupsOddsFooter({
    odds: combinedOdds({
      favorite: 'Miami (FL)',
      spread: -7.5,
      homeSpread: -7.5,
      awaySpread: 7.5,
    }),
    homeTeamName: 'Miami',
    awayTeamName: 'Virginia Tech',
  });

  assert.equal(label, `Miami ${EXPECTED_MINUS_SIGN}7.5`, 'home favorite uses homeTeamName');
});

test('formatMatchupsOddsFooter emits the exact minus-sign and middle-dot code points', () => {
  const label = formatMatchupsOddsFooter({
    odds: combinedOdds({
      favorite: 'Georgia Tech',
      spread: -7.5,
      homeSpread: -7.5,
      awaySpread: 7.5,
      total: 48.5,
    }),
    homeTeamName: 'Georgia Tech',
    awayTeamName: 'Colorado',
  });

  assert.equal(
    label.codePointAt(label.indexOf('7.5') - 1),
    0x2212,
    'spread prefix is U+2212 MINUS SIGN'
  );
  assert.equal(
    label.codePointAt(label.indexOf('O/U') - 2),
    0x00b7,
    'segment separator is U+00B7 MIDDLE DOT'
  );
  assert.equal(label, `Georgia Tech ${EXPECTED_MINUS_SIGN}7.5 ${EXPECTED_MIDDLE_DOT} O/U 48.5`);
});

test('formatMatchupsOddsFooter renders spread-only, total-only, and no-line cases independently', () => {
  assert.equal(
    formatMatchupsOddsFooter({
      odds: combinedOdds({ spread: -3.5, homeSpread: 3.5, awaySpread: -3.5 }),
      homeTeamName: 'Texas',
      awayTeamName: 'Oklahoma',
    }),
    `Oklahoma ${EXPECTED_MINUS_SIGN}3.5`,
    'spread-only omits the separator and total'
  );
  assert.equal(
    formatMatchupsOddsFooter({
      odds: combinedOdds({ total: 44.5 }),
      homeTeamName: 'Texas',
      awayTeamName: 'Oklahoma',
    }),
    'O/U 44.5',
    'total-only omits the separator and spread'
  );
  assert.equal(
    formatMatchupsOddsFooter({
      odds: combinedOdds(),
      homeTeamName: 'Texas',
      awayTeamName: 'Oklahoma',
    }),
    'Line not posted',
    'a present odds record with neither display field has explicit content'
  );
  assert.equal(
    formatMatchupsOddsFooter({
      odds: undefined,
      homeTeamName: 'Texas',
      awayTeamName: 'Oklahoma',
    }),
    'Line not posted',
    'an absent odds map entry has explicit content'
  );
});

test("formatMatchupsOddsFooter distinguishes pick'em from missing side data", () => {
  assert.equal(
    formatMatchupsOddsFooter({
      odds: combinedOdds({ spread: 0, homeSpread: 0, awaySpread: 0, total: 51.5 }),
      homeTeamName: 'Iowa',
      awayTeamName: 'Iowa State',
    }),
    `Pick'em ${EXPECTED_MIDDLE_DOT} O/U 51.5`,
    "equal side spreads render the owner-ruled pick'em label"
  );
  assert.equal(
    formatMatchupsOddsFooter({
      odds: combinedOdds({ favorite: 'Iowa', spread: -2.5, homeSpread: -2.5, total: 51.5 }),
      homeTeamName: 'Iowa',
      awayTeamName: 'Iowa State',
    }),
    'O/U 51.5',
    'missing one side refuses the canonical favorite and derived spread fallbacks'
  );
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
  // Item 180 — a streaming outlet renders its NAME, with no `Streaming · ` prefix.
  assert.equal(formatPrimaryBroadcastLabel(media.filter((row) => row.mediaType !== 'tv')), 'ESPN+');
  assert.equal(
    formatPrimaryBroadcastLabel([{ gameId: '1', mediaType: 'radio', outlet: 'KVET' }]),
    'Radio · KVET',
    'radio-only data keeps its explicit radio label — a different KIND of broadcast'
  );
  assert.equal(
    formatPrimaryBroadcastLabel([{ gameId: '1', mediaType: 'mobile', outlet: 'App' }]),
    'App'
  );
  assert.equal(formatPrimaryBroadcastLabel([]), null);
  assert.equal(formatPrimaryBroadcastLabel(undefined), null);
});

/**
 * ITEM 180 — the cut is asserted over EVERY media type the priority list admits,
 * not over the two the old test happened to name. `MEDIA_TYPE_DISPLAY_PRIORITY` is
 * the contract's own space (`AGENTS.md` → an invariant over a space is tested over
 * the space), so a sixth type added later fails here rather than silently
 * inheriting whichever branch it lands in.
 *
 * `ppv` was already unprefixed and is asserted so the cut cannot be read as having
 * changed it. `radio` is the ONE prefix that survives, and it survives because
 * radio is a different KIND of broadcast rather than a less familiar name for the
 * same kind — an unprefixed station would present a radio-only game as watchable.
 */
test('every media type but radio renders the bare outlet name', () => {
  const expected: Record<(typeof MEDIA_TYPE_DISPLAY_PRIORITY)[number], string> = {
    tv: 'Outlet',
    web: 'Outlet',
    ppv: 'Outlet',
    mobile: 'Outlet',
    radio: 'Radio · Outlet',
  };

  for (const mediaType of MEDIA_TYPE_DISPLAY_PRIORITY) {
    assert.equal(
      formatPrimaryBroadcastLabel([{ gameId: '1', mediaType, outlet: 'Outlet' }]),
      expected[mediaType],
      `${mediaType} label`
    );
  }

  // The prefix is gone from the module, not merely from the branches above.
  assert.equal(
    MEDIA_TYPE_DISPLAY_PRIORITY.filter(
      (mediaType) =>
        formatPrimaryBroadcastLabel([{ gameId: '1', mediaType, outlet: 'X' }])?.includes('·') ??
        false
    ).join(','),
    'radio',
    'radio is the only media type that still renders a qualifier prefix'
  );
});

test('formatPrimaryBroadcastLabel is deterministic within one media type', () => {
  const forward: ScheduleMediaItem[] = [
    { gameId: '1', mediaType: 'tv', outlet: 'ESPN2' },
    { gameId: '1', mediaType: 'tv', outlet: 'ABC' },
  ];
  assert.equal(formatPrimaryBroadcastLabel(forward), 'ABC');
  assert.equal(formatPrimaryBroadcastLabel([...forward].reverse()), 'ABC');
});
