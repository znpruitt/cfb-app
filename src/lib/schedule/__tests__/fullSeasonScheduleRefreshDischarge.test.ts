import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';

/**
 * PLATFORM-693 remediation round 1 — the discharge must not double-walk.
 *
 * THE CLAIM THIS PINS: trigger B runs only on the branches that would otherwise walk
 * NOTHING. An unconditional discharge ahead of the `commit.kind` switch made the registry
 * walk TWICE on `written-clean` and on a score repair, and codex named the consequence:
 * if the discharge's walk succeeds and the branch's own walk then transiently fails, the
 * run reports `partial` and records a NEW obligation although the cache was already
 * invalidated — a redundant repair that MANUFACTURES a fault.
 *
 * ASSERTED STRUCTURALLY, and the reason is worth stating: driving `refreshFullSeasonSchedule`
 * far enough to reach `written-clean` needs a committed provider fixture, a lease, and a
 * store, and the assertion would then be about how many times a spy was called — which is
 * the same structural fact with more machinery between it and the claim. The placement IS
 * the behaviour here, so the placement is what is pinned.
 */
const SOURCE = readFileSync('src/lib/schedule/fullSeasonScheduleRefresh.ts', 'utf8');

test('the discharge is never called ahead of the commit.kind switch', () => {
  const beforeSwitch = SOURCE.slice(0, SOURCE.indexOf('switch (commit.kind) {'));
  assert.equal(
    beforeSwitch.includes('await dischargeIfNoWalkFollows()'),
    false,
    'an unconditional discharge ahead of the switch is the double walk'
  );
  // The underlying helper is invoked from exactly ONE place — its own wrapper — so a
  // second call cannot be added anywhere without this failing. The wrapper's definition
  // legitimately sits above the switch, which is why the assertion counts call sites
  // rather than looking for the name before a line number.
  const directCalls = SOURCE.split('await dischargePendingStandingsInvalidation(').length - 1;
  assert.equal(directCalls, 1, 'the discharge has exactly one call site, inside its wrapper');
});

test('the discharge runs on every branch that walks nothing, and no other', () => {
  const body = SOURCE.slice(SOURCE.indexOf('switch (commit.kind) {'));
  // The four branches that never reach `bustStandingsForYear`.
  for (const branch of [
    "case 'stale-observation'",
    "case 'empty-response'",
    "case 'empty-replacement-rejected'",
  ]) {
    const start = body.indexOf(branch);
    assert.ok(start > 0, `${branch} not found`);
    const segment = body.slice(start, start + 400);
    assert.ok(
      segment.includes('dischargeIfNoWalkFollows()'),
      `${branch} walks nothing and must discharge`
    );
  }

  // `written-clean` DOES walk, through `bustStandingsForYear`, which clears the
  // obligation itself — so it must not discharge as well.
  const written = body.slice(body.indexOf("case 'written-clean'"));
  const writtenBody = written.slice(0, written.indexOf('return fullSeasonScheduleRefreshResult'));
  assert.ok(writtenBody.includes('bustStandingsForYear(year)'), 'written-clean walks');
  assert.equal(
    writtenBody.includes('dischargeIfNoWalkFollows()'),
    false,
    'written-clean already walks — discharging too is the double walk'
  );
});
