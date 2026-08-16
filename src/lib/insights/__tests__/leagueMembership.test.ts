import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { buildLeagueInsightContext } from '@/lib/insights/loadInsights';
import { generateRawInsights } from '@/lib/insights/engine';
import '@/lib/insights/generators';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// INSIGHTS-023a — membership comes from the CONFIRMED OWNER LIST, not from team
// assignments.
//
// Five generators reconstructed "who is in the league" as
// `new Set(currentRoster.values())`. `currentRoster` is the RESOLVED roster,
// which falls back to the most recent archive whenever the current-year CSV is
// absent — i.e. every league before its draft. So membership was filtered
// against LAST season's owners: a departed owner still counted, and a new owner
// did not.
//
// These drive the REAL loader, not a hand-built context. Testing the context
// shape alone would prove nothing about the wiring — the mistake that has
// recurred all week.
// ---------------------------------------------------------------------------

const SLUG = 'members';
const YEAR = 2026;

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

async function seedLeague(opts: {
  confirmedOwners?: string[];
  ownersCsv?: string;
  archiveOwners?: string[];
}): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2023,
    status: { state: 'preseason', year: YEAR },
  });

  if (opts.ownersCsv !== undefined) {
    await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', opts.ownersCsv);
  }
  if (opts.confirmedOwners) {
    await setAppState(`preseason-owners:${SLUG}`, String(YEAR), opts.confirmedOwners);
  }
  if (opts.archiveOwners) {
    // Last season's team→owner map — what membership USED to be read from.
    const csv =
      'team,owner\n' +
      opts.archiveOwners
        .map((o, i) => `${['Georgia', 'Clemson', 'Alabama', 'Ohio State'][i]},${o}`)
        .join('\n');
    await setAppState(`standings-archive:${SLUG}`, '2025', {
      leagueSlug: SLUG,
      year: 2025,
      archivedAt: '2026-01-01T00:00:00.000Z',
      ownerRosterSnapshot: csv,
      standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
      finalStandings: opts.archiveOwners.map((owner, i) => ({
        owner,
        wins: 10 - i,
        losses: 2 + i,
        ties: 0,
        winPct: (10 - i) / 12,
        pointsFor: 350 - i * 10,
        pointsAgainst: 300,
        pointDifferential: 50 - i * 10,
        gamesBack: 0,
        finalGames: 12,
      })),
      games: [],
      scoresByKey: {},
    });
  }
}

test('membership is the CONFIRMED list, not last season’s team assignments', async () => {
  // Departed: Dave played in 2025 and is not in the 2026 list.
  // Joined: Erin is in the 2026 list and never held a team.
  await seedLeague({
    archiveOwners: ['Alice', 'Bob', 'Carol', 'Dave'],
    confirmedOwners: ['Alice', 'Bob', 'Carol', 'Erin'],
  });

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.deepEqual(
    [...context.leagueMembers].sort(),
    ['Alice', 'Bob', 'Carol', 'Erin'],
    'the confirmed list, verbatim'
  );
  assert.ok(!context.leagueMembers.has('Dave'), 'the departed owner is NOT a member');
  assert.ok(context.leagueMembers.has('Erin'), 'the new owner IS a member');

  // The borrowed roster is still there — it is what team ATTRIBUTION and the
  // content-safety framing rely on. Membership simply no longer comes from it.
  assert.equal(context.usingArchivedRoster, true, 'still borrowing for attribution');
  assert.ok(
    [...context.currentRoster.values()].includes('Dave'),
    'and the borrowed map still contains last season’s owner — which is exactly ' +
      'what membership used to be read from'
  );
});

test('with no confirmed list, the owners CSV supplies membership', async () => {
  await seedLeague({ ownersCsv: 'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,NoClaim' });

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.deepEqual([...context.leagueMembers].sort(), ['Alice', 'Bob']);
  assert.ok(!context.leagueMembers.has('NoClaim'), 'NoClaim is not an owner');
});

test('with neither, membership is EMPTY — fewer insights, and right', async () => {
  // Owner ruling 2026-08-16. A league with no confirmed list and no CSV gets no
  // member-filtered insights rather than insights about whoever played last.
  await seedLeague({ archiveOwners: ['Alice', 'Bob', 'Carol', 'Dave'] });

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.equal(context.leagueMembers.size, 0, 'no members');
  assert.ok(
    [...context.currentRoster.values()].length > 0,
    'even though a borrowed roster exists — which is the whole point: it is not membership'
  );
});

// ---------------------------------------------------------------------------
// The WIRING. A mutation pointing a generator back at `currentRoster` passed
// every test above — they proved the context field, not that anything reads it.
// ---------------------------------------------------------------------------

/**
 * A fixture whose generated insights are known to name Alice and Bob.
 * `never_last` and `title_chaser` pick them out of these archives — established
 * by running it, not by reading the generators.
 */
async function seedNamingAliceAndBob(confirmed: string[]): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2022,
    status: { state: 'preseason', year: YEAR },
  });
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), confirmed);

  const owners = ['Alice', 'Bob', 'Carol', 'Dave'];
  const csv = 'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,Carol\nOhio State,Dave';
  const byYear: [number, number[]][] = [
    [2023, [2, 8, 9, 11]],
    [2024, [9, 2, 8, 11]],
    [2025, [9, 8, 2, 11]],
  ];
  for (const [year, wins] of byYear) {
    await setAppState(`standings-archive:${SLUG}`, String(year), {
      leagueSlug: SLUG,
      year,
      archivedAt: '2026-01-01T00:00:00.000Z',
      ownerRosterSnapshot: csv,
      standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
      finalStandings: owners.map((owner, i) => ({
        owner,
        wins: wins[i]!,
        losses: 13 - wins[i]!,
        ties: 0,
        winPct: wins[i]! / 13,
        pointsFor: 300 + wins[i]! * 20,
        pointsAgainst: 280,
        pointDifferential: wins[i]! * 20 - 280 + 300,
        gamesBack: 0,
        finalGames: 13,
      })),
      games: [],
      scoresByKey: {},
    });
  }
}

function ownersNamedIn(context: Parameters<typeof generateRawInsights>[0]): string[] {
  return generateRawInsights(context)
    .flatMap((i) => [i.owner, ...(i.owners ?? []), ...(i.relatedOwners ?? [])])
    .filter((o): o is string => Boolean(o));
}

test('WIRING: departed owners disappear from generated insights', async () => {
  // POSITIVE CONTROL first. Without it the second half passes for a fixture that
  // never names anyone — which is exactly how my first attempt at this test was
  // vacuous: it asserted a departed owner was absent from output he was never in.
  await seedNamingAliceAndBob(['Alice', 'Bob', 'Carol', 'Dave']);
  const withEveryone = ownersNamedIn(await buildLeagueInsightContext(SLUG, YEAR, new Date()));

  assert.ok(withEveryone.includes('Alice'), 'control: Alice IS named when she is a member');
  assert.ok(withEveryone.includes('Bob'), 'control: Bob IS named when he is a member');

  // Now drop exactly those two from the confirmed list. The archives are
  // unchanged, and the borrowed roster still contains all four.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedNamingAliceAndBob(['Carol', 'Dave']);
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.ok(
    [...context.currentRoster.values()].includes('Alice'),
    'the borrowed roster still holds her — reverting to it would bring her back'
  );

  const named = ownersNamedIn(context);
  assert.ok(
    !named.includes('Alice'),
    `Alice departed and must not be named — got: ${named.join(', ')}`
  );
  assert.ok(
    !named.includes('Bob'),
    `Bob departed and must not be named — got: ${named.join(', ')}`
  );
});

/**
 * Strip comments before scanning source.
 *
 * A source guard that reads prose is not a guard. This one first flagged all
 * five generator files because their comments DESCRIBE the pattern being banned
 * — the third time this week a guard matched text instead of code (the pool
 * guard matched a comment mentioning `req.json()`, and an earlier one matched an
 * import line). Same lesson each time: scan what executes.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('GUARD: no generator reconstructs membership from the roster map', () => {
  // The five duplicated `new Set(currentRoster.values())` derivations are the
  // defect. This fails if one comes back, in any file, rather than relying on
  // anyone remembering.
  const dir = fileURLToPath(new URL('../generators/', import.meta.url));
  const offenders: string[] = [];
  let scanned = 0;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    scanned++;
    const src = codeOnly(readFileSync(join(dir, entry.name), 'utf8'));
    if (/currentRoster\s*\.\s*values\s*\(/.test(src)) offenders.push(entry.name);
  }

  // Anti-vacuity: if the scan finds no files, the loop above proves nothing.
  assert.ok(scanned >= 5, `expected to scan the generator files, saw ${scanned}`);
  assert.ok(
    /currentRoster\s*\.\s*values\s*\(/.test(codeOnly('const s = currentRoster.values();')),
    'and the detector must still match real code'
  );

  assert.deepEqual(
    offenders,
    [],
    'membership comes from context.leagueMembers; currentRoster answers "who owns which team"'
  );
});
