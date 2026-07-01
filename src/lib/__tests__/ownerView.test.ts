import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveOwnerRoster } from '../ownerView.ts';
import type { AppGame, ParticipantSlot } from '../schedule';
import type { ScorePack } from '../scores';

function teamParticipant(overrides: Partial<Extract<ParticipantSlot, { kind: 'team' }>>) {
  return {
    kind: 'team' as const,
    teamId: overrides.teamId ?? 'team-id',
    displayName: overrides.displayName ?? 'Team',
    canonicalName: overrides.canonicalName ?? 'Team',
    rawName: overrides.rawName ?? 'Team',
  };
}

// Provider labels ("Wash St") intentionally differ from the stored/canonical
// assignment ("Washington State") — the mismatch PLATFORM-039 must resolve.
function mismatchGame(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: 'e',
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: overrides.date ?? '2026-09-05T17:00:00.000Z',
    stage: 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: 1,
    slotOrder: 1,
    eventKey: 'event',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: null,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      away: teamParticipant({
        teamId: 'washingtonstate',
        displayName: 'Washington State',
        canonicalName: 'Washington State',
        rawName: 'Wash St',
      }),
      home: teamParticipant({
        teamId: 'oregon',
        displayName: 'Oregon',
        canonicalName: 'Oregon',
        rawName: 'Oregon',
      }),
    },
    csvAway: 'Wash St',
    csvHome: 'Oregon',
    canAway: 'Washington State',
    canHome: 'Oregon',
    awayConf: 'Big Ten',
    homeConf: 'Big Ten',
    ...overrides,
  };
}

const roster = new Map([['Washington State', 'Alice']]);

test('deriveOwnerRoster includes a final owned game and records the W despite a provider-name mismatch', () => {
  const scoresByKey: Record<string, ScorePack> = {
    g: {
      status: 'final',
      time: 'Final',
      away: { team: 'Wash St', score: 31 },
      home: { team: 'Oregon', score: 17 },
    },
  };

  const rows = deriveOwnerRoster(
    'Alice',
    [mismatchGame({ key: 'g', status: 'final' })],
    roster,
    scoresByKey
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.teamName, 'Washington State');
  assert.equal(rows[0]?.record, '1–0');
});

test('deriveOwnerRoster resolves side and next opponent for an upcoming owned game despite a mismatch', () => {
  const rows = deriveOwnerRoster('Alice', [mismatchGame({ key: 'g' })], roster, {});

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row?.ownerTeamSide, 'away');
  // Opponent display remains provider-facing.
  assert.equal(row?.nextOpponent, 'Oregon');
  assert.equal(row?.nextGameLabel, 'at Oregon');
  assert.equal(row?.currentStatus, 'Upcoming');
});
