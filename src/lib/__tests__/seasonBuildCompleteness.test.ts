import assert from 'node:assert/strict';
import test from 'node:test';

import { assembleLiveAnalyticsProvenance } from '../gameStats/analyticsProvenance.ts';
import { assembleSeasonScoredBuild } from '../seasonBuild.ts';
import { buildSeasonArchive } from '../seasonRollover.ts';
import { getCanonicalStandings } from '../selectors/leagueStandings.ts';
import { SeasonScheduleIncompleteError } from '../server/durableScheduleRow.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../server/teamDatabaseStore.ts';

/**
 * PLATFORM-813 — a durable writer never records a season as complete when rows were lost.
 * These are REPRESENTATIVES; the invariant is tested over its whole input space in
 * `durableRowCorruptionMatrix.test.ts`. Each names the loss site it stands for.
 *
 * **Three loss sites, and each version before this one saw a different subset.** v2 gated
 * on a count of non-object rows and missed the build's own discards. v3 read the build's
 * `issues` and missed the other two: a non-object row dropped at the boundary never reaches
 * the build (round 1's F1), and a postseason or conference-championship participant coerced
 * to `''` becomes a TBD slot rather than a discard (F2). The boundary now reports both, into
 * the same list.
 *
 * **WHERE the refusal lives is also pinned (F3).** v3 put it inside the shared build, so
 * recap and analytics provenance refused too — contradicting the ruling that they render the
 * surviving games. It is in `buildSeasonArchive` now, and standings keep their own.
 */

const SLUG = 'alpha';
const YEAR = 2031;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g-ok',
    week: 1,
    startDate: `${YEAR}-09-01T18:00:00.000Z`,
    neutralSite: false,
    conferenceGame: true,
    homeTeam: 'Alpha U',
    awayTeam: 'Beta U',
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    status: 'final',
    seasonType: 'regular',
    gamePhase: 'regular',
    ...overrides,
  };
}

function championshipRow(overrides: Record<string, unknown> = {}) {
  return scheduleRow({
    id: 'g-ccg',
    week: 14,
    startDate: `${YEAR}-12-06T18:00:00.000Z`,
    awayConference: 'SEC',
    gamePhase: 'conference_championship',
    regularSubtype: 'conference_championship',
    conferenceChampionshipConference: 'SEC',
    eventKey: 'sec-championship',
    ...overrides,
  });
}

function bowlRow(overrides: Record<string, unknown> = {}) {
  return scheduleRow({
    id: 'g-bowl',
    week: 1,
    startDate: `${YEAR}-12-28T18:00:00.000Z`,
    neutralSite: true,
    conferenceGame: false,
    seasonType: 'postseason',
    gamePhase: 'postseason',
    postseasonSubtype: 'bowl',
    bowlName: 'Orange Bowl',
    label: 'Orange Bowl',
    eventKey: 'orange-bowl',
    ...overrides,
  });
}

async function seedSchedule(items: unknown[]): Promise<void> {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items,
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

async function assertArchiveRefuses(reason: RegExp): Promise<void> {
  await assert.rejects(
    () => buildSeasonArchive(SLUG, YEAR),
    (error: Error) => {
      assert.ok(error instanceof SeasonScheduleIncompleteError, `refused as incomplete: ${error}`);
      assert.match(error.message, /refusing to record or cache this season as complete/);
      // The REASON travels, which a count could not carry.
      assert.match(error.message, reason);
      return true;
    }
  );
}

test.before(() => {
  MUTABLE_ENV.NODE_ENV = 'development';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
});

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: `${YEAR}-01-01T00:00:00.000Z`,
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'Big Ten' },
    ],
  });
});

// --- The build's own discard ------------------------------------------------------------

test('a coerced REGULAR participant makes the archive refuse', async () => {
  // Loss site 1: `homeTeam: 7` is coerced to '' and the build discards the row as
  // `invalid_row`. v2's gate, counting only non-object rows, was blind to it.
  await seedSchedule([scheduleRow(), scheduleRow({ id: 'g-bad', week: 2, homeTeam: 7 })]);
  await assertArchiveRefuses(/field homeTeam held number/);
});

test('a null participant name refuses too — the required-field path reaches the same gate', async () => {
  await seedSchedule([scheduleRow(), scheduleRow({ id: 'g-bad', week: 2, awayTeam: null })]);
  await assertArchiveRefuses(/field awayTeam held null/);
});

// --- F1: dropped at the boundary, never seen by the build -------------------------------

test('F1: a NON-OBJECT row inside an otherwise valid season makes the archive refuse', async () => {
  // v3 dropped this with a bare `continue` beside a comment claiming it was "counted
  // separately" — a comment describing a counter v3 had deleted. On `main` this row
  // threw; v3 made it silent.
  await seedSchedule([scheduleRow(), null]);
  await assertArchiveRefuses(/durable row #1 is null, not an object/);
});

test('F1: standings refuse the same row rather than cache a season missing a game', async () => {
  // The second durable writer. Its cache is tag-only, so a snapshot missing a game would
  // persist until something busts the tag (invariant 8).
  await setAppState('leagues', 'registry', [
    {
      slug: SLUG,
      displayName: 'Alpha',
      year: YEAR,
      createdAt: `${YEAR - 1}-01-01T00:00:00.000Z`,
      status: { state: 'season', year: YEAR },
    },
  ]);
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nAlpha U,Ann\nBeta U,Ben');
  await seedSchedule([scheduleRow(), null]);
  await assert.rejects(
    () =>
      getCanonicalStandings({ slug: SLUG, leagueStatusOverride: { state: 'season', year: YEAR } }),
    (error: Error) => error instanceof SeasonScheduleIncompleteError
  );
});

// --- F2: blanked into a placeholder, indistinguishable afterwards -----------------------

test('F2: a coerced POSTSEASON participant makes the archive refuse', async () => {
  // The row bypasses `classifyScheduleRow`, so the build writes no issue: it builds a
  // "Team TBD" placeholder, which is what a real unannounced bowl slot looks like too.
  // Only the boundary knows the '' was coerced.
  await seedSchedule([scheduleRow(), bowlRow({ homeTeam: 123 })]);
  await assertArchiveRefuses(/durable row 'g-bowl' field homeTeam held number/);
});

test('F2: a coerced CONFERENCE-CHAMPIONSHIP participant makes the archive refuse', async () => {
  await seedSchedule([scheduleRow(), championshipRow({ awayTeam: 123 })]);
  await assertArchiveRefuses(/durable row 'g-ccg' field awayTeam held number/);
});

// --- Controls -----------------------------------------------------------------------------

test('a CLEAN season still archives — the discriminating control', async () => {
  // Without this, a refusal that fired unconditionally would satisfy every test above
  // while making every archive impossible.
  await seedSchedule([scheduleRow(), scheduleRow({ id: 'g-2', week: 2 }), bowlRow()]);
  const archive = await buildSeasonArchive(SLUG, YEAR);
  assert.equal(archive.games.length, 3, 'every clean row becomes an archived game');
});

test('a row coerced only in a field that does not change the season still archives', async () => {
  // Coercion alone is not loss. A numeric `label` or `bowlName` changes what a game
  // DISPLAYS, not which game it is or how it ended — the matrix measured this — so it is
  // repaired silently and the archive is honest.
  await seedSchedule([scheduleRow(), scheduleRow({ id: 'g-2', week: 2, label: 99, bowlName: 7 })]);
  const archive = await buildSeasonArchive(SLUG, YEAR);
  assert.equal(archive.games.length, 2, 'a repaired display field loses no game');
});

// --- F3: the refusal is the archive's, not the shared build's ---------------------------

test('F3: the SHARED build does not refuse — it returns the loss on `issues`', async () => {
  // Recap and analytics provenance consume this build and are ruled to RENDER the
  // surviving games. v3 refused here, which made all three refuse.
  //
  // A discard v3's shared build DID refuse on — a coerced regular participant — so this
  // fails at `781c1115`. The first version used a non-object row, which v3 dropped
  // silently (F1) and so never refused on: the test passed against the code it exists to
  // reject.
  await seedSchedule([scheduleRow(), scheduleRow({ id: 'g-bad', week: 2, homeTeam: 7 })]);
  const build = await assembleSeasonScoredBuild(SLUG, YEAR);
  assert.equal(build.games.length, 1, 'the surviving game is built');
  const discarded = build.issues.filter((issue) => issue.startsWith('invalid-schedule-row:'));
  assert.ok(
    discarded.some((issue) => /durable row 'g-bad' field homeTeam held number/.test(issue)),
    `the boundary's report is carried: ${JSON.stringify(discarded)}`
  );
  assert.ok(discarded.length >= 2, "and the build's own discard of the same row");
});

test('F3: live analytics provenance renders past a discarded row instead of reporting build-failed', async () => {
  // Same row as above, for the same reason: at `781c1115` this returned
  // `{ status: 'unavailable', reason: 'build-failed' }`.
  await seedSchedule([scheduleRow(), scheduleRow({ id: 'g-bad', week: 2, homeTeam: 7 })]);
  const result = await assembleLiveAnalyticsProvenance({
    leagueSlug: SLUG,
    year: YEAR,
    now: new Date(`${YEAR}-12-31T00:00:00.000Z`),
  });
  assert.equal(result.status, 'available', JSON.stringify(result));
});

test('F3: an UNREADABLE schedule is reported to provenance as unreadable, not as a build failure', async () => {
  // The actual cause. `build-failed` sends an operator to the build when the stored
  // container is what is broken.
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [null, 7],
    partialFailure: false,
    failedSeasonTypes: [],
  });
  const result = await assembleLiveAnalyticsProvenance({
    leagueSlug: SLUG,
    year: YEAR,
    now: new Date(`${YEAR}-12-31T00:00:00.000Z`),
  });
  assert.deepEqual(result, { status: 'unavailable', reason: 'schedule-cache-unreadable' });
});
