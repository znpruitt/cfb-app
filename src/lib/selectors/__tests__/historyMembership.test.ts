import assert from 'node:assert/strict';
import test from 'node:test';

import { selectHistoryActiveOwners } from '../historyMembership.ts';
import type { SeasonArchive } from '../../seasonArchive.ts';

function archive(
  year: number,
  snapshotOwners: readonly string[],
  standingsOwners: readonly string[] = snapshotOwners
): SeasonArchive {
  const ownerRosterSnapshot = [
    'Team,Owner',
    ...snapshotOwners.map((owner, index) => `Team ${index + 1},${owner}`),
  ].join('\n');

  return {
    year,
    ownerRosterSnapshot,
    finalStandings: standingsOwners.map((owner) => ({ owner })),
  } as SeasonArchive;
}

test('selectHistoryActiveOwners: confirmed current membership is authoritative', () => {
  const owners = selectHistoryActiveOwners({
    archives: [archive(2025, ['Alice', 'Departed'])],
    confirmedOwners: ['Alice', 'New Owner'],
  });

  assert.deepEqual([...owners], ['Alice', 'New Owner']);
  assert.equal(owners.has('Departed'), false);
});

test('selectHistoryActiveOwners: an unconfirmed season uses only the latest archive roster', () => {
  const owners = selectHistoryActiveOwners({
    archives: [archive(2024, ['Alice', 'Former']), archive(2025, ['Alice', 'Bob'])],
    confirmedOwners: [],
  });

  assert.deepEqual([...owners], ['Alice', 'Bob']);
  assert.equal(owners.has('Former'), false);
});

test('selectHistoryActiveOwners: latest standings backstop a missing roster snapshot', () => {
  const latest = archive(2025, [], ['Alice', 'Bob', 'NoClaim']);
  const owners = selectHistoryActiveOwners({
    archives: [archive(2024, ['Former']), latest],
    confirmedOwners: [],
  });

  assert.deepEqual([...owners], ['Alice', 'Bob']);
});
