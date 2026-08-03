import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDraftEligibleTeams,
  isDraftEligibleTeam,
  buildConfirmedOwnersCsv,
  patchConfirmedOwnersCsv,
  defaultDraftSettings,
  type DraftSettings,
} from '@/lib/draft';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import teamsData from '@/data/teams.json';

// ---------------------------------------------------------------------------
// PLATFORM-072 — confirmed owners CSV builder + post-confirm edit patch.
//
// patchConfirmedOwnersCsv MOVES a pick's roster claim from oldTeam → newTeam,
// preserving unrelated rows (incl. /api/owners overrides). These unit tests pin
// the tricky branches deterministically with a stub canonical resolver: alias
// row matching, NoClaim-as-absent fallback, and override preservation.
// ---------------------------------------------------------------------------

/** Map a lowercased alias/alt label → canonical school; identity otherwise. */
function stubResolver(aliases: Record<string, string>): (label: string) => string {
  return (label: string) => aliases[label.toLowerCase()] ?? label;
}

function ownerOf(csv: string, team: string): string | undefined {
  return parseOwnersCsv(csv).find((r) => r.team.toLowerCase() === team.toLowerCase())?.owner;
}

test('buildConfirmedOwnersCsv reports a structural row count independent of quoted newlines', () => {
  const { csv, rowCount } = buildConfirmedOwnersCsv(
    [
      {
        pickNumber: 1,
        round: 0,
        roundPick: 0,
        owner: 'Line\nBreak',
        team: 'Texas',
        pickedAt: '',
        autoSelected: false,
      },
    ],
    [{ school: 'Texas' }, { school: 'Georgia' }]
  );
  // Two data rows: the pick + Georgia as NoClaim — even though one owner field
  // embeds a newline (which a split('\n') count would miscount as 3).
  assert.equal(rowCount, 2);
  assert.equal(parseOwnersCsv(csv).length, 2);
});

test('patchConfirmedOwnersCsv moves the claim and releases the old team', () => {
  const csv = 'team,owner\nTexas,Alice\nGeorgia,Bob\nOhio State,NoClaim';
  const next = patchConfirmedOwnersCsv(csv, {
    oldTeam: 'Texas',
    newTeam: 'Ohio State',
    fallbackOwner: 'Alice',
    resolveTeam: stubResolver({}),
  });
  assert.equal(ownerOf(next, 'Ohio State'), 'Alice');
  assert.equal(ownerOf(next, 'Texas'), 'NoClaim');
  assert.equal(ownerOf(next, 'Georgia'), 'Bob', 'unrelated row preserved');
});

test('patchConfirmedOwnersCsv resolves alias labels so no duplicate row is created', () => {
  // The roster stored the edited-from team under an alias ("UT") and the
  // edited-to team under an alias ("tOSU"); canonical targets are the schools.
  const csv = 'team,owner\nUT,Alice\nGeorgia,Bob\ntOSU,NoClaim';
  const resolveTeam = stubResolver({ ut: 'Texas', tosu: 'Ohio State' });
  const next = patchConfirmedOwnersCsv(csv, {
    oldTeam: 'Texas',
    newTeam: 'Ohio State',
    fallbackOwner: 'Alice',
    resolveTeam,
  });
  const rows = parseOwnersCsv(next);
  // The alias rows were patched in place — not left stale beside appended canonicals.
  assert.equal(rows.length, 3, 'no duplicate canonical row appended');
  assert.equal(ownerOf(next, 'tOSU'), 'Alice', 'edited-to alias row now owned');
  assert.equal(ownerOf(next, 'UT'), 'NoClaim', 'edited-from alias row released');
});

test('patchConfirmedOwnersCsv treats a NoClaim prior row as absent and uses the fallback owner', () => {
  // An admin repair set the edited-from team to NoClaim before this edit.
  const csv = 'team,owner\nTexas,NoClaim\nOhio State,NoClaim';
  const next = patchConfirmedOwnersCsv(csv, {
    oldTeam: 'Texas',
    newTeam: 'Ohio State',
    fallbackOwner: 'Alice',
    resolveTeam: stubResolver({}),
  });
  // The new team must be claimed by the draft pick's owner, not left NoClaim.
  assert.equal(ownerOf(next, 'Ohio State'), 'Alice');
  assert.equal(ownerOf(next, 'Texas'), 'NoClaim');
});

// ---------------------------------------------------------------------------
// DRAFT-010 — shared draft-eligibility helper.
//
// Eligibility is defined by excluding the `NoClaim` schedule placeholder, NOT by a
// `classification` field. The shipped `teams.json` items carry no `classification`
// key, so any eligibility computation that filtered on `t.classification === 'fbs'`
// silently counted ZERO eligible teams. These tests lock in the correct, shared
// definition so setup/update/auto-pick/confirm can never diverge again.
// ---------------------------------------------------------------------------

type TeamsJson = { items: TeamCatalogItem[] };

test('isDraftEligibleTeam excludes the NoClaim placeholder and accepts real teams', () => {
  assert.equal(isDraftEligibleTeam({ school: 'NoClaim' }), false);
  assert.equal(isDraftEligibleTeam({ school: 'Texas' }), true);
  assert.equal(isDraftEligibleTeam({ school: 'Ohio State' }), true);
});

test('getDraftEligibleTeams drops NoClaim from the eligible set', () => {
  const catalog = [{ school: 'Texas' }, { school: 'NoClaim' }, { school: 'Ohio State' }];
  const eligible = getDraftEligibleTeams(catalog);

  assert.deepEqual(
    eligible.map((t) => t.school),
    ['Texas', 'Ohio State']
  );
  assert.ok(
    !eligible.some((t) => t.school === 'NoClaim'),
    'NoClaim must never appear in the eligible count'
  );
});

test('getDraftEligibleTeams counts every team in the current teams.json (no classification field)', () => {
  const { items } = teamsData as TeamsJson;
  const eligible = getDraftEligibleTeams(items);

  // Regression on the original bug: a classification-based filter returns 0 here
  // because no item in the shipped catalog carries a `classification` key.
  assert.ok(
    !items.some((t) => 'classification' in t),
    'fixture invariant: teams.json items carry no classification key'
  );
  assert.ok(eligible.length > 0, 'eligible team count must be non-zero for the current catalog');
  assert.equal(
    eligible.length,
    items.length,
    'current teams.json has no NoClaim entry, so every item is draft-eligible'
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2G1 — the dead `autoPickMetric` setting (with its `'sp-plus'`
// member) was removed. Removal is migration-safe: the create/update routes merge
// settings by spread, so an old persisted record that still carries the property
// loads and drives unchanged mechanics; new defaults simply omit it.
// ---------------------------------------------------------------------------

test('defaultDraftSettings no longer emits autoPickMetric', () => {
  const settings = defaultDraftSettings(['A', 'B']);
  assert.ok(!('autoPickMetric' in settings), 'autoPickMetric is gone from fresh settings');
  // The live, still-supported fields remain.
  assert.equal(settings.style, 'snake');
  assert.equal(settings.timerExpiryBehavior, 'pause-and-prompt');
  assert.equal(settings.totalRounds, 1);
});

test('an old persisted draft record carrying autoPickMetric still loads inertly', () => {
  // Simulate a durable row written before the field was removed.
  const oldJson = JSON.stringify({
    style: 'snake',
    draftOrder: ['A', 'B'],
    pickTimerSeconds: 60,
    timerExpiryBehavior: 'auto-pick',
    autoPickMetric: 'sp-plus',
    totalRounds: 2,
    scheduledAt: null,
  });
  const parsed = JSON.parse(oldJson) as DraftSettings & { autoPickMetric?: string };

  // Every live field reads exactly as stored — the extra property does not break
  // consumption, and the mechanics fields are untouched.
  assert.equal(parsed.style, 'snake');
  assert.deepEqual(parsed.draftOrder, ['A', 'B']);
  assert.equal(parsed.timerExpiryBehavior, 'auto-pick');
  assert.equal(parsed.totalRounds, 2);

  // The route merge path is `{ ...defaults, ...stored, style: 'snake' }`. Merging
  // preserves the live fields; the inert extra property is not required and is
  // never read by any mechanic.
  const merged: DraftSettings = {
    ...defaultDraftSettings(['A', 'B']),
    ...parsed,
    style: 'snake',
  };
  assert.equal(merged.totalRounds, 2);
  assert.equal(merged.timerExpiryBehavior, 'auto-pick');
});
