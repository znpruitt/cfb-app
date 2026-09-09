import assert from 'node:assert/strict';
import test from 'node:test';

import type { CanonicalGame } from '../canonicalSlate.ts';
import { POLLING_MAX_KICKOFF_AGE_MS, listKickoffWindowPartitions } from '../pollingTarget.ts';
import {
  RECONCILIATION_MAX_ATTEMPTS,
  RECONCILIATION_PASS_OFFSETS_MS,
  listReconciliationCandidates,
  reconciliationPartitionKey,
  reconciliationPassKey,
  selectReconciliationTarget,
  type ReconciliationPass,
  type ReconciliationPassState,
} from '../reconciliationTarget.ts';
import { canonicalGame, slateOf } from './c1Fixtures.ts';

// PLATFORM-110B — the bounded correction-reconciliation cadence. Two passes per
// current-season partition, anchored on its LATEST stat-applicable kickoff, and
// never overlapping ordinary polling.

const H = 60 * 60 * 1000;
const NOW = new Date('2025-10-01T12:00:00.000Z');
const P1 = RECONCILIATION_PASS_OFFSETS_MS.p1;
const P2 = RECONCILIATION_PASS_OFFSETS_MS.p2;

type GameSpec = {
  id: number;
  week?: number;
  seasonType?: 'regular' | 'postseason';
  /** Hours BEFORE `NOW` the game kicked off. */
  agoHours: number;
  applicability?: CanonicalGame['applicability'];
  kickoff?: string | null;
};

function game(spec: GameSpec): CanonicalGame {
  const base = canonicalGame({
    providerGameId: spec.id,
    home: 'Alpha State',
    away: 'Beta Tech',
    week: spec.week ?? 3,
    seasonType: spec.seasonType ?? 'regular',
    applicability: spec.applicability ?? 'expected',
    notExpectedReason: spec.applicability === 'not-expected' ? 'disrupted' : undefined,
  });
  const kickoff =
    spec.kickoff === undefined
      ? new Date(NOW.getTime() - spec.agoHours * H).toISOString()
      : spec.kickoff;
  return { ...base, kickoff };
}

function slate(specs: GameSpec[]) {
  return slateOf(specs.map(game), 2025);
}

const EMPTY: ReadonlyMap<string, ReconciliationPassState> = new Map();

function passStateOf(
  entries: Array<{ week: number; pass: ReconciliationPass; state: ReconciliationPassState }>,
  seasonType: 'regular' | 'postseason' = 'regular'
): ReadonlyMap<string, ReconciliationPassState> {
  const map = new Map<string, ReconciliationPassState>();
  for (const entry of entries) {
    const partitionKey = reconciliationPartitionKey({
      year: 2025,
      week: entry.week,
      seasonType,
    });
    map.set(reconciliationPassKey(partitionKey, entry.pass), entry.state);
  }
  return map;
}

// === The cadence itself ===

test('the ruled cadence is exactly +48h and +7d — the offsets are the decision', () => {
  // Every other test here expresses a RELATIONSHIP and therefore moves with these
  // constants. This one pins the owner's ruling of 2026-09-09 itself, so the
  // cadence cannot be changed without changing a test that says what it was.
  assert.equal(RECONCILIATION_PASS_OFFSETS_MS.p1, 48 * H);
  assert.equal(RECONCILIATION_PASS_OFFSETS_MS.p2, 7 * 24 * H);
  assert.ok(
    RECONCILIATION_PASS_OFFSETS_MS.p1 > POLLING_MAX_KICKOFF_AGE_MS,
    'p1 must fall due after the polling window closes, or the two jobs can collide'
  );
});

test('p1 falls due exactly 48h after the latest kickoff — not a minute before', () => {
  const justBefore = slate([{ id: 1, agoHours: P1 / H - 0.01 }]);
  assert.equal(
    selectReconciliationTarget({ slate: justBefore, now: NOW, passState: EMPTY }),
    null,
    'a partition one minute short of +48h is not due'
  );

  const exactly = slate([{ id: 1, agoHours: P1 / H }]);
  const target = selectReconciliationTarget({ slate: exactly, now: NOW, passState: EMPTY });
  assert.equal(target?.pass, 'p1');
  assert.equal(target?.week, 3);
  assert.equal(target?.dueAt, NOW.toISOString(), 'due exactly at now — the bound is inclusive');
});

test('the anchor is the LATEST stat-applicable kickoff, never the earliest', () => {
  // One game long past its +48h, one played ten hours ago. The partition waits
  // for its last game: the provider endpoint is partition-granular, so the
  // decision must be too.
  const mixed = slate([
    { id: 1, agoHours: 200 },
    { id: 2, agoHours: 10 },
  ]);
  assert.equal(selectReconciliationTarget({ slate: mixed, now: NOW, passState: EMPTY }), null);

  const settled = slate([
    { id: 1, agoHours: 200 },
    { id: 2, agoHours: 60 },
  ]);
  const target = selectReconciliationTarget({ slate: settled, now: NOW, passState: EMPTY });
  assert.equal(target?.pass, 'p1');
  assert.equal(
    target?.anchorKickoff,
    new Date(NOW.getTime() - 60 * H).toISOString(),
    'the anchor is the later of the two kickoffs'
  );
});

test('p2 falls due at +7d, and only after that — p1 due-ness alone never selects it', () => {
  const atFourDays = slate([{ id: 1, agoHours: 96 }]);
  const closedP1 = passStateOf([
    { week: 3, pass: 'p1', state: { attempts: 1, reachedIngestion: true } },
  ]);
  assert.equal(
    selectReconciliationTarget({ slate: atFourDays, now: NOW, passState: closedP1 }),
    null,
    'p1 is closed and p2 is not yet due — nothing to do'
  );

  const atEightDays = slate([{ id: 1, agoHours: 192 }]);
  const target = selectReconciliationTarget({
    slate: atEightDays,
    now: NOW,
    passState: closedP1,
  });
  assert.equal(target?.pass, 'p2');
  assert.equal(
    target?.dueAt,
    new Date(NOW.getTime() - 192 * H + P2).toISOString(),
    'p2 is due 7 days after the anchor kickoff'
  );
});

test('both passes due selects p1 first; after p1 closes the same slate yields p2, then nothing', () => {
  const old = slate([{ id: 1, agoHours: 300 }]);

  const first = selectReconciliationTarget({ slate: old, now: NOW, passState: EMPTY });
  assert.equal(first?.pass, 'p1');

  const second = selectReconciliationTarget({
    slate: old,
    now: NOW,
    passState: passStateOf([
      { week: 3, pass: 'p1', state: { attempts: 1, reachedIngestion: true } },
    ]),
  });
  assert.equal(second?.pass, 'p2');

  const third = selectReconciliationTarget({
    slate: old,
    now: NOW,
    passState: passStateOf([
      { week: 3, pass: 'p1', state: { attempts: 1, reachedIngestion: true } },
      { week: 3, pass: 'p2', state: { attempts: 1, reachedIngestion: true } },
    ]),
  });
  assert.equal(third, null, 'then never again — the horizon terminates');
});

// === What never anchors ===

test('games that never produce statistics contribute no anchor', () => {
  const disruptedOnly = slate([
    { id: 1, agoHours: 300, applicability: 'not-expected' },
    { id: 2, agoHours: 300, applicability: 'not-expected' },
  ]);
  assert.equal(
    selectReconciliationTarget({ slate: disruptedOnly, now: NOW, passState: EMPTY }),
    null,
    'a disrupted-only partition is never reconciled — it was never expected to have stats'
  );
});

test('a disrupted LATER game cannot hold back a partition whose real games have settled', () => {
  const target = selectReconciliationTarget({
    slate: slate([
      { id: 1, agoHours: 60 },
      { id: 2, agoHours: 1, applicability: 'not-expected' },
    ]),
    now: NOW,
    passState: EMPTY,
  });
  assert.equal(target?.pass, 'p1', 'the anchor skips the game that produces no statistics');
});

test('an unprovable kickoff contributes no anchor and never starts a billed request', () => {
  for (const kickoff of [null, 'sometime Saturday', '2025-13-45T99:00:00Z', '']) {
    assert.equal(
      selectReconciliationTarget({
        slate: slate([{ id: 1, agoHours: 0, kickoff }]),
        now: NOW,
        passState: EMPTY,
      }),
      null,
      `kickoff ${JSON.stringify(kickoff)} must not anchor a due time`
    );
  }
});

test('an unparseable kickoff beside a parseable one leaves the parseable anchor intact', () => {
  const target = selectReconciliationTarget({
    slate: slate([
      { id: 1, agoHours: 60 },
      { id: 2, agoHours: 0, kickoff: null },
    ]),
    now: NOW,
    passState: EMPTY,
  });
  assert.equal(target?.anchorKickoff, new Date(NOW.getTime() - 60 * H).toISOString());
});

// === Ledger state gates selection ===

test('a closed pass is never reselected, whatever it concluded', () => {
  const old = slate([{ id: 1, agoHours: 300 }]);
  for (const attempts of [1, 2, 3]) {
    const candidates = listReconciliationCandidates({
      slate: old,
      now: NOW,
      passState: passStateOf([
        { week: 3, pass: 'p1', state: { attempts, reachedIngestion: true } },
      ]),
    });
    assert.deepEqual(
      candidates.map((c) => c.pass),
      ['p2'],
      'reaching ingestion closes the pass regardless of how many attempts preceded it'
    );
  }
});

test('an open pass stays due below the attempt cap and is abandoned at it', () => {
  const old = slate([{ id: 1, agoHours: 300 }]);
  for (let attempts = 0; attempts < RECONCILIATION_MAX_ATTEMPTS; attempts += 1) {
    const candidates = listReconciliationCandidates({
      slate: old,
      now: NOW,
      passState: passStateOf([
        { week: 3, pass: 'p1', state: { attempts, reachedIngestion: false } },
      ]),
    });
    assert.equal(candidates[0]?.pass, 'p1', `p1 is still due after ${attempts} failed attempts`);
  }

  const capped = listReconciliationCandidates({
    slate: old,
    now: NOW,
    passState: passStateOf([
      {
        week: 3,
        pass: 'p1',
        state: { attempts: RECONCILIATION_MAX_ATTEMPTS, reachedIngestion: false },
      },
    ]),
  });
  assert.deepEqual(
    capped.map((c) => c.pass),
    ['p2'],
    'p1 is abandoned at the cap — but p2 still backstops it'
  );
});

test('an EMPTY pass state means nothing has run, never that everything is done', () => {
  const candidates = listReconciliationCandidates({
    slate: slate([{ id: 1, agoHours: 300 }]),
    now: NOW,
    passState: EMPTY,
  });
  assert.deepEqual(
    candidates.map((c) => c.pass),
    ['p1', 'p2']
  );
});

// === Ordering ===

test('candidates order by due time, then pass, then season type, then week', () => {
  const candidates = listReconciliationCandidates({
    slate: slate([
      { id: 1, week: 5, agoHours: 100 },
      { id: 2, week: 4, agoHours: 300 },
      { id: 3, week: 1, seasonType: 'postseason', agoHours: 300 },
    ]),
    now: NOW,
    passState: EMPTY,
  });
  assert.deepEqual(
    candidates.map((c) => `${c.week}:${c.seasonType}:${c.pass}`),
    [
      // Ordering is by DUE TIME, so the most overdue work comes first — week 4's
      // p2 (due 132h ago) outranks week 5's p1 (due 52h ago) even though it is a
      // later pass. Week 4 and postseason week 1 share a kickoff and therefore
      // both due times; regular breaks that tie. Week 5 has no p2 at all: at
      // 100h old its +7d pass is still 68h in the future.
      '4:regular:p1',
      '1:postseason:p1',
      '4:regular:p2',
      '1:postseason:p2',
      '5:regular:p1',
    ],
    'the most overdue pass is selected first, across partitions and passes alike'
  );
});

test('selection is deterministic under a reordered slate', () => {
  const specs: GameSpec[] = [
    { id: 1, week: 5, agoHours: 100 },
    { id: 2, week: 4, agoHours: 300 },
    { id: 3, week: 1, seasonType: 'postseason', agoHours: 300 },
  ];
  const forward = selectReconciliationTarget({ slate: slate(specs), now: NOW, passState: EMPTY });
  const reversed = selectReconciliationTarget({
    slate: slate([...specs].reverse()),
    now: NOW,
    passState: EMPTY,
  });
  assert.deepEqual(forward, reversed);
});

// === The exclusion invariant, asserted over the space rather than over fixtures ===

test('no reconciliation candidate is ever a kickoff-window partition — swept over the space', () => {
  // The claim is an invariant over every arrangement of kickoffs, so it is
  // generated rather than sampled: a hand-picked slate proves the slate. The
  // space is derived from the CONTRACT — kickoff ages from "not yet played" out
  // past the p2 horizon, in steps fine enough to land on both window edges
  // (3h and 24h) and on the p1 edge (48h) — crossed with partition shapes that
  // mix a settled game with a fresh one, which is the only way the two selectors
  // could ever overlap.
  const ages: number[] = [];
  for (let hours = -6; hours <= 200; hours += 0.5) ages.push(hours);

  let checked = 0;
  let windowPartitionsSeen = 0;
  let candidatesSeen = 0;

  for (const anchorAge of ages) {
    for (const companionAge of [anchorAge, anchorAge + 3, anchorAge + 12, anchorAge + 26]) {
      const built = slate([
        { id: 1, week: 3, agoHours: anchorAge },
        { id: 2, week: 3, agoHours: companionAge },
        { id: 3, week: 4, agoHours: companionAge },
      ]);
      const windowKeys = new Set(
        listKickoffWindowPartitions(built, NOW).map((ref) => reconciliationPartitionKey(ref))
      );
      windowPartitionsSeen += windowKeys.size;
      const candidates = listReconciliationCandidates({
        slate: built,
        now: NOW,
        passState: EMPTY,
      });
      candidatesSeen += candidates.length;
      for (const candidate of candidates) {
        assert.ok(
          !windowKeys.has(reconciliationPartitionKey(candidate)),
          `partition ${reconciliationPartitionKey(candidate)} is BOTH reconcilable and pollable ` +
            `(anchor ${anchorAge}h, companion ${companionAge}h)`
        );
        // The stronger statement the disjointness rests on: every stat-applicable
        // game in a candidate partition is provably past the polling window.
        for (const g of built.games) {
          if (g.providerWeek !== candidate.week || g.seasonType !== candidate.seasonType) continue;
          if (g.applicability === 'not-expected') continue;
          const age = NOW.getTime() - Date.parse(g.kickoff!);
          assert.ok(
            age >= POLLING_MAX_KICKOFF_AGE_MS,
            `game ${g.providerGameId} is only ${age / H}h old inside a reconciliation candidate`
          );
        }
        checked += 1;
      }
    }
  }

  // Coverage of the sweep is part of its result: an invariant that held because
  // neither selector ever fired would pass this test vacuously.
  assert.ok(checked > 500, `swept too few candidate partitions (${checked})`);
  assert.ok(
    windowPartitionsSeen > 100,
    `the sweep never produced polling candidates either (${windowPartitionsSeen}) — ` +
      'the disjointness would be vacuous'
  );
  assert.ok(candidatesSeen === checked);
});
