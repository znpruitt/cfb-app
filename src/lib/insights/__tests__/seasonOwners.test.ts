import assert from 'node:assert/strict';
import test from 'node:test';

import { seasonOwnersFrom } from '@/lib/insights/loadInsights';
import { draftPicksSignature } from '@/lib/selectors/draftPublication';
import type { DraftPick, DraftState } from '@/lib/draft';

/**
 * The membership authority, after INSIGHTS-025 v5 deleted the completeness module
 * that preceded it.
 *
 * Four review rounds were spent proving the CONFIRMED OWNER LIST complete, because
 * claims about who left are inferred from absence. Every proof — a lifecycle flag,
 * an assertion, two records agreeing, a publication boolean — could be true while
 * the fact was false. A confirmed draft cannot be half-finished and every owner
 * drafts, so its owner set needs no proof. These tests pin that it is read from
 * the part of the draft publication actually verifies.
 */

function pick(n: number, owner: string, team: string | null = `T${n}`): DraftPick {
  return {
    pickNumber: n,
    round: 1,
    roundPick: n,
    owner,
    team,
    pickedAt: '2026-08-01T00:00:00.000Z',
    autoSelected: false,
  };
}

function draft(overrides: Partial<DraftState> = {}): DraftState {
  const picks = overrides.picks ?? [pick(1, 'Alice'), pick(2, 'Bob'), pick(3, 'Alice')];
  return {
    leagueSlug: 'l',
    year: 2026,
    phase: 'complete',
    owners: ['Alice', 'Bob'],
    settings: { rounds: 2, timerSeconds: 60, order: ['Alice', 'Bob'] },
    picks,
    currentPickIndex: picks.length,
    timerState: 'off',
    timerExpiresAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    publishedPicks: draftPicksSignature(picks),
    ...overrides,
  } as DraftState;
}

test('a CONFIRMED draft yields its owners, deduped, with the year', () => {
  // A multi-round draft repeats owners; the league is the distinct set.
  assert.deepEqual(seasonOwnersFrom(draft(), 2026), { year: 2026, owners: ['Alice', 'Bob'] });
});

test('an UNCONFIRMED draft yields nothing, however complete it looks', () => {
  // `phase: 'complete'` means every pick was made, not that the commissioner
  // confirmed it — the distinction PLATFORM-094 exists to preserve.
  const picks = [pick(1, 'Alice'), pick(2, 'Bob')];
  assert.equal(seasonOwnersFrom(draft({ picks, publishedPicks: undefined }), 2026), null);
  assert.equal(seasonOwnersFrom(draft({ picks, phase: 'live' }), 2026), null);
  // A signature that no longer matches the picks means it was edited since.
  assert.equal(seasonOwnersFrom(draft({ picks, publishedPicks: '[]' }), 2026), null);
  assert.equal(seasonOwnersFrom(null, 2026), null);
});

test('the owners come from the PICKS, not from `draft.owners`', () => {
  // `isDraftPublished` verifies the signature against the picks, so the pick list
  // is the part known to be the published one. `draft.owners` is written at setup
  // and nothing re-verifies it — a league whose owner list was edited after the
  // draft would otherwise report people who never drafted.
  const d = draft({
    picks: [pick(1, 'Alice'), pick(2, 'Bob')],
    owners: ['Alice', 'Bob', 'Carol', 'Dave'],
  });
  assert.deepEqual(seasonOwnersFrom(d, 2026)?.owners, ['Alice', 'Bob']);
});

test('the YEAR travels with the owners', () => {
  // Membership facts previously mixed the requested year with the league's own
  // year, and `?year=2024` on a 2027 league diffed one year's roster against
  // another year's archive. Reading both from one place makes that
  // unrepresentable rather than guarded against.
  assert.equal(seasonOwnersFrom(draft(), 2024)?.year, 2024);
});

test('a draft with no usable owner names yields nothing', () => {
  const blank = draft({ picks: [pick(1, ''), pick(2, '   ')] });
  assert.equal(seasonOwnersFrom(blank, 2026), null);
});
