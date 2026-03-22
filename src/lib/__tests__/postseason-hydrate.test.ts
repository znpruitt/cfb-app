import assert from 'node:assert/strict';
import test from 'node:test';

import { hydrateEvents } from '../postseason-hydrate.ts';
import type { AppGame } from '../schedule.ts';
import type { VenueInfo } from '../schedule/cfbdSchedule.ts';

function bowlGame(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'game',
    eventId: overrides.eventId ?? overrides.key ?? 'game',
    week: overrides.week ?? 17,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 17,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 17,
    weekCorrectionReason: overrides.weekCorrectionReason ?? null,
    date: overrides.date ?? '2025-12-31T22:00:00.000Z',
    stage: overrides.stage ?? 'bowl',
    status: overrides.status ?? 'placeholder',
    stageOrder: overrides.stageOrder ?? 4,
    slotOrder: overrides.slotOrder ?? 80,
    eventKey: overrides.eventKey ?? overrides.eventId ?? overrides.key ?? 'game',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? 'bowl',
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? true,
    neutralDisplay: overrides.neutralDisplay ?? 'vs',
    venue: (overrides.venue ?? null) as VenueInfo | string | null,
    isPlaceholder: overrides.isPlaceholder ?? true,
    sources: overrides.sources,
    participants: overrides.participants ?? {
      away: {
        kind: 'placeholder',
        slotId: `${overrides.key ?? 'game'}-away`,
        displayName: 'Team TBD',
      },
      home: {
        kind: 'placeholder',
        slotId: `${overrides.key ?? 'game'}-home`,
        displayName: 'Team TBD',
      },
    },
    csvAway: overrides.csvAway ?? 'Team TBD',
    csvHome: overrides.csvHome ?? 'Team TBD',
    canAway: overrides.canAway ?? 'team-tbd',
    canHome: overrides.canHome ?? 'team-tbd',
    awayConf: overrides.awayConf ?? '',
    homeConf: overrides.homeConf ?? '',
  };
}

test('hydrateEvents uses location-only object venue text to disambiguate postseason placeholders', () => {
  const baseEvents = [
    bowlGame({
      key: 'pasadena-slot',
      eventId: '2025-slot-pasadena',
      eventKey: 'slot-pasadena',
      venue: { city: 'Pasadena', state: 'CA', stadium: null, country: 'USA' },
    }),
    bowlGame({
      key: 'atlanta-slot',
      eventId: '2025-slot-atlanta',
      eventKey: 'slot-atlanta',
      venue: { city: 'Atlanta', state: 'GA', stadium: null, country: 'USA' },
    }),
  ];

  const providerEvents = [
    bowlGame({
      key: 'provider-pasadena',
      eventId: 'provider-pasadena',
      eventKey: 'provider-pasadena',
      status: 'scheduled',
      isPlaceholder: false,
      participants: {
        away: {
          kind: 'team',
          teamId: 'oregon',
          displayName: 'Oregon',
          canonicalName: 'Oregon',
          rawName: 'Oregon',
        },
        home: {
          kind: 'team',
          teamId: 'ohio-state',
          displayName: 'Ohio State',
          canonicalName: 'Ohio State',
          rawName: 'Ohio State',
        },
      },
      csvAway: 'Oregon',
      csvHome: 'Ohio State',
      canAway: 'oregon',
      canHome: 'ohio-state',
      venue: { city: 'Pasadena', state: 'CA', stadium: null, country: 'USA' },
    }),
  ];

  const hydrated = hydrateEvents({ baseEvents, providerEvents });
  const pasadena = hydrated.games.find((game) => game.eventId === '2025-slot-pasadena');
  const atlanta = hydrated.games.find((game) => game.eventId === '2025-slot-atlanta');

  assert.ok(pasadena);
  assert.ok(atlanta);
  assert.equal(pasadena?.participants.away.kind, 'team');
  assert.equal(pasadena?.participants.home.kind, 'team');
  assert.equal(atlanta?.participants.away.kind, 'placeholder');
  assert.equal(atlanta?.participants.home.kind, 'placeholder');
  assert.match(
    hydrated.diagnostics.find((entry) => entry.eventId === '2025-slot-pasadena')?.reason ?? '',
    /matched-by-metadata:.*venue/
  );
});
