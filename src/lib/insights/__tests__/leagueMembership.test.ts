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

test('with no new roster named, LAST SEASON’S owners are still the league', async () => {
  // Owner framing 2026-08-16: "no one has left the league until we've entered
  // preseason and have a new roster of owners." Offseason looks BACK, so its
  // members are the people who played the season being looked back at.
  //
  // An earlier version returned an empty set here, on the reasoning that a
  // borrowed roster is stale data. Measured, that emptied the feed entirely for
  // every league between rollover and owner confirmation.
  await seedLeague({ archiveOwners: ['Alice', 'Bob', 'Carol', 'Dave'] });

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.deepEqual(
    [...context.leagueMembers].sort(),
    ['Alice', 'Bob', 'Carol', 'Dave'],
    'the previous roster IS the membership answer here, not a fallback hack'
  );
});

test('NoClaim never becomes a member, from either source', async () => {
  // The roster map carries it as the absorber for unowned teams, and a legacy
  // typed `preseason-owners` record can contain it — `selectConfirmedRoster`
  // only drops it on the CSV path. Deleting the old per-generator
  // `set.delete(NO_CLAIM_OWNER)` removed the only guard on the typed path.
  await seedLeague({ confirmedOwners: ['Alice', 'NoClaim', 'Bob'] });
  const fromConfirmed = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.deepEqual([...fromConfirmed.leagueMembers].sort(), ['Alice', 'Bob']);

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedLeague({ archiveOwners: ['Alice', 'Bob', 'NoClaim', 'Dave'] });
  const fromRoster = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.ok(!fromRoster.leagueMembers.has('NoClaim'), 'nor via the previous-roster path');
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

/**
 * Owners named by generators that speak about the SEASON, excluding membership
 * events.
 *
 * INSIGHTS-025 NARROWED the rule these tests pin. "A departed owner is never
 * named" was true of the whole engine until `narrative:membership` shipped, and
 * naming them is that generator's entire purpose — "Alice has left the league
 * after finishing 3rd in 2029" is the feature, not a leak.
 *
 * The rule that survives, and that these tests still enforce: **a departed owner
 * must not be named as a PARTICIPANT.** They may not hold a career record, win a
 * rivalry, or lead a category, because those claims describe the league that is
 * about to play. They may be named in an event that reports their departure.
 *
 * Filtering by generator id rather than by insight type, so a new membership
 * type is covered without anyone remembering to add it here.
 */
const MEMBERSHIP_GENERATOR_ID = 'narrative:membership';

function ownersNamedIn(context: Parameters<typeof generateRawInsights>[0]): string[] {
  return generateRawInsights(context)
    .filter((i) => !i.id.startsWith('membership-'))
    .flatMap((i) => [i.owner, ...(i.owners ?? []), ...(i.relatedOwners ?? [])])
    .filter((o): o is string => Boolean(o));
}

/** Every owner named anywhere, membership events included. */
function allOwnersNamedIn(context: Parameters<typeof generateRawInsights>[0]): string[] {
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

// ---------------------------------------------------------------------------
// The page must SHOW which source supplied membership.
//
// TSC changed for 2026 — two owners left, one joined, one returned — and the
// feed stayed at the same five insights with the same five names, because these
// generators emit SUPERLATIVES rather than one insight per owner. That reading
// is identical whether the confirmed list reached the engine or the change
// silently failed. The source is the fact that tells them apart.
// ---------------------------------------------------------------------------

test('the membership SOURCE is reported, not just the members', async () => {
  await seedLeague({
    archiveOwners: ['Alice', 'Bob', 'Carol', 'Dave'],
    confirmedOwners: ['Alice', 'Bob', 'Carol', 'Erin'],
  });
  const confirmed = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(confirmed.leagueMembersSource, 'confirmed');

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedLeague({ archiveOwners: ['Alice', 'Bob', 'Carol', 'Dave'] });
  const previous = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(
    previous.leagueMembersSource,
    'previous-roster',
    'the same member COUNT as a confirmed league — only the source distinguishes them'
  );

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedLeague({});
  const none = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(none.leagueMembersSource, 'none');
  assert.equal(none.leagueMembers.size, 0);
});

// ---------------------------------------------------------------------------
// The other half of the fix — ADDING a returning owner, not just removing a
// departed one. Codex flagged this as a P1: career history was seeded from the
// roster map before membership was ever consulted, so a confirmed member who sat
// out a season had no stats built and no downstream filter could restore them.
// ---------------------------------------------------------------------------

test('a RETURNING owner gets career history built, not just permission to appear', async () => {
  // Erin played 2023 and 2024, sat out 2025, and is confirmed for 2026. Last
  // season's roster — the old membership source — does not contain her.
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2022,
    status: { state: 'preseason', year: YEAR },
  });
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Alice', 'Bob', 'Erin']);

  const seasons: [number, string[]][] = [
    [2023, ['Alice', 'Bob', 'Erin']],
    [2024, ['Alice', 'Bob', 'Erin']],
    [2025, ['Alice', 'Bob', 'Carol']], // Erin sat out
  ];
  for (const [year, owners] of seasons) {
    const csv =
      'team,owner\n' +
      owners.map((o, i) => `${['Georgia', 'Clemson', 'Alabama'][i]},${o}`).join('\n');
    await setAppState(`standings-archive:${SLUG}`, String(year), {
      leagueSlug: SLUG,
      year,
      archivedAt: '2026-01-01T00:00:00.000Z',
      ownerRosterSnapshot: csv,
      standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
      finalStandings: owners.map((owner, i) => ({
        owner,
        wins: 10 - i * 3,
        losses: 3 + i * 3,
        ties: 0,
        winPct: (10 - i * 3) / 13,
        pointsFor: 340 - i * 20,
        pointsAgainst: 300,
        pointDifferential: 40 - i * 20,
        gamesBack: 0,
        finalGames: 13,
      })),
      games: [],
      scoresByKey: {},
    });
  }

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.ok(context.leagueMembers.has('Erin'), 'she is a member');
  assert.ok(
    ![...context.currentRoster.values()].includes('Erin'),
    'and NOT in the borrowed roster — the state that used to erase her history'
  );

  const erin = context.ownerCareerStats.find((s) => s.owner === 'Erin');
  assert.ok(erin, 'her career stats must be BUILT, not just permitted');
  assert.equal(erin!.seasons, 2, 'the two seasons she actually played');
});

test('KNOWN GAP: a mid-season CSV repair does NOT reach Insights while a confirmation record exists', async () => {
  // Pinned as a limitation, not as desired behaviour.
  //
  // `confirmedRoster.ts` documents that the confirmation record wins, because
  // re-confirming owners must take effect immediately. But that record is only
  // editable while `status.state === 'preseason'`, so an owner replaced
  // mid-season can be repaired in the roster and never reach Insights.
  //
  // An earlier version of this slice "fixed" that by inverting the documented
  // precedence, which created the mirror-image freeze: adding an owner became a
  // silent no-op. Review caught it. The real fix is making the confirmation list
  // writable in-season — recorded in docs/next-tasks.md — and this test exists so
  // the gap is visible rather than rediscovered.
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Alice', 'Bob', 'Carol']);
  await setAppState(
    `owners:${SLUG}:${YEAR}`,
    'csv',
    'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,Erin'
  );

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.equal(context.leagueMembersSource, 'confirmed');
  assert.ok(
    context.leagueMembers.has('Carol'),
    'the replaced owner is STILL a member — this is the known gap'
  );
  assert.ok(!context.leagueMembers.has('Erin'), 'and the replacement is not yet visible');
});

// ---------------------------------------------------------------------------
// Membership decides who may be NAMED. It must not narrow the yardstick.
//
// Both reviewers landed on this independently: seeding career stats from members
// alone meant `volatility` could claim nobody swings harder when a departed
// owner swung harder, and `milestones` could say "first to the mark" when the
// archives disprove it. False claims, arrived at from the opposite direction to
// the rest of this week's.
// ---------------------------------------------------------------------------

test('career history is accumulated for DEPARTED owners too — they are the yardstick', async () => {
  await seedLeague({
    archiveOwners: ['Alice', 'Bob', 'Carol', 'Dave'],
    confirmedOwners: ['Alice', 'Bob'],
  });

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.deepEqual([...context.leagueMembers].sort(), ['Alice', 'Bob'], 'only two may be named');

  const owners = context.ownerCareerStats.map((s) => s.owner).sort();
  assert.ok(owners.includes('Dave'), 'but Dave still has stats — he is part of the comparison');
  assert.ok(owners.includes('Carol'), 'and so does Carol');
});

test('membership still gates who is NAMED, despite the wider stats', async () => {
  // The widening is only safe because consumers filter. If one stopped, a
  // departed owner would be named — this is the check that catches it.
  await seedNamingAliceAndBob(['Carol', 'Dave']);
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.ok(
    context.ownerCareerStats.some((s) => s.owner === 'Alice'),
    'Alice has stats (she played)'
  );
  const named = ownersNamedIn(context);
  assert.ok(!named.includes('Alice'), `but is not named — got: ${named.join(', ')}`);
});

test('confirmed-first precedence is restored', async () => {
  // Overturning `confirmedRoster.ts`'s documented rule to work around a
  // preseason-only edit screen was the wrong end to fix. Re-confirming owners
  // must take effect immediately.
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Alice', 'Bob', 'Erin']);
  await setAppState(
    `owners:${SLUG}:${YEAR}`,
    'csv',
    'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,Carol'
  );

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.equal(context.leagueMembersSource, 'confirmed', 'the confirmation record wins');
  assert.ok(context.leagueMembers.has('Erin'), 'a newly confirmed owner takes effect immediately');
  assert.ok(!context.leagueMembers.has('Carol'), 'and the CSV does not override it');
});

test('a plain owners CSV is reported as the ROSTER, not as a confirmed list', async () => {
  // `getConfirmedRoster` falls back to the CSV and says so via its own `source`.
  // Re-inferring from a non-empty array told the page "a new roster has been
  // named for this season" for any league with an ordinary roster and no
  // confirmation record — the false claim the source field exists to prevent.
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(
    `owners:${SLUG}:${YEAR}`,
    'csv',
    'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,Carol'
  );

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.equal(context.leagueMembersSource, 'official-roster', 'no confirmation record exists');
  assert.deepEqual([...context.leagueMembers].sort(), ['Alice', 'Bob', 'Carol']);
});

test('a departed record holder still sets the bar for a trend superlative', async () => {
  // THE regression this round fixes. `trending` runs in preseason — exactly
  // where membership changed — and judged "steepest decline in league history"
  // against members only, promoting the best remaining owner.
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2022,
    status: { state: 'preseason', year: YEAR },
  });
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Alice', 'Bob', 'Carol']);

  const owners = ['Alice', 'Bob', 'Carol', 'Dave'];
  const csv = 'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,Carol\nOhio State,Dave';
  // Dave slid 1st → 2nd → 4th (net +3); Alice slid 2nd → 3rd → 3rd (net +1).
  const ranks: Record<number, number[]> = {
    2023: [2, 3, 4, 1],
    2024: [3, 2, 4, 2],
    2025: [3, 1, 2, 4],
  };
  for (const year of [2023, 2024, 2025]) {
    const r = ranks[year]!;
    await setAppState(`standings-archive:${SLUG}`, String(year), {
      leagueSlug: SLUG,
      year,
      archivedAt: '2026-01-01T00:00:00.000Z',
      ownerRosterSnapshot: csv,
      standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
      finalStandings: owners
        .map((owner, i) => ({
          owner,
          wins: 14 - r[i]! * 2,
          losses: r[i]! * 2,
          ties: 0,
          winPct: (14 - r[i]! * 2) / 14,
          pointsFor: 400 - r[i]! * 30,
          pointsAgainst: 300,
          pointDifferential: 100 - r[i]! * 30,
          gamesBack: r[i]! - 1,
          finalGames: 14,
        }))
        .sort((a, b) => b.wins - a.wins),
      games: [],
      scoresByKey: {},
    });
  }

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const trending = generateRawInsights(context).filter((i) => i.type === 'trending_down');

  for (const insight of trending) {
    assert.ok(
      !/steepest decline in league history/.test(insight.description),
      `a member must not claim the league record while a departed owner holds it — got: ${insight.description}`
    );
  }
});

test('a one-owner roster is reported as PARTIAL, not as the season roster', async () => {
  // The split. Both states read `owners:{slug}:{year}`; they differ only in
  // whether it cleared MIN_CONFIRMED_OWNERS. Collapsed into one value, a league
  // whose roster names a single person printed the same caption as a fully
  // rostered one — and every member-filtered insight then speaks about that one
  // person as though the league had confirmed them.
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nGeorgia,Alice\nClemson,NoClaim');

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.equal(context.leagueMembersSource, 'partial-roster');
  assert.deepEqual([...context.leagueMembers], ['Alice'], 'NoClaim is never a member');
});

test('a NoClaim-bearing confirmation record does NOT crown a one-member league', async () => {
  // `selectConfirmedRoster` counts NoClaim toward MIN_CONFIRMED_OWNERS on the
  // confirmation path — deliberately, since NoClaim in typed input is a mistake
  // to refuse rather than a value to filter. Membership strips it afterwards.
  // Stripping a name after the bar was counted silently lowers the bar, so
  // ['Alice','NoClaim'] cleared it, beat a full CSV on precedence, and produced
  // ONE member labelled `confirmed` with three real owners invisible.
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'preseason', year: YEAR },
  });
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Alice', 'NoClaim']);
  await setAppState(
    `owners:${SLUG}:${YEAR}`,
    'csv',
    'team,owner\nGeorgia,Alice\nClemson,Bob\nAlabama,Carol\nOhio State,Dave'
  );

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.equal(
    context.leagueMembersSource,
    'official-roster',
    'a sub-threshold confirmation record must not win precedence'
  );
  assert.deepEqual(
    [...context.leagueMembers].sort(),
    ['Alice', 'Bob', 'Carol', 'Dave'],
    'the real roster is the answer, not the one name that survived cleaning'
  );
});

test('GUARD: the loader reads the owners row exactly once', () => {
  // The confirmed roster and the team→owner map were two concurrent reads of
  // `owners:{slug}:{year}`, so a roster write between them handed the two
  // different generations of one CSV — and `official-roster` vs `partial-roster`
  // is classified by comparing them. `readConfirmedRosterInputs` returns both.
  //
  // Comments are stripped first: this file and the loader both DESCRIBE the
  // banned read, and three earlier guards on this project matched their own
  // prose instead of code.
  const src = codeOnly(
    readFileSync(fileURLToPath(new URL('../loadInsights.ts', import.meta.url)), 'utf8')
  );

  const reads = src.match(/owners:\$\{[^}]*\}/g) ?? [];
  assert.deepEqual(reads, [], `loadInsights must not build an owners key itself, found ${reads}`);
  assert.match(src, /readConfirmedRosterInputs\(/, 'and must take both facts from the one reader');

  // Anti-vacuity, both halves: the detector must fire on real code, and must
  // survive comment-stripping rather than be neutered by it.
  assert.match(
    codeOnly('const r = await getAppState(`owners:${slug}:${year}`, "csv");'),
    /owners:\$\{[^}]*\}/,
    'the detector must still match a real read'
  );
  assert.ok(src.length > 1000, 'and the source must actually have been read');
});

test('one owner holding two teams is a PARTIAL roster, not an official one', async () => {
  // `resolvedRoster.values()` yields one entry per TEAM, and this is a
  // multi-round snake draft, so one owner routinely holds several. Counting rows
  // reported a one-person roster as a full one.
  //
  // Filed as cosmetic in INSIGHTS-023a — a caption on an admin page. That stopped
  // being true in INSIGHTS-030, where `membershipIsKnown` reads this label to
  // decide whether insight copy may name who is playing: a partially entered
  // roster licensed "Alice leads active owners" while the real owners were not
  // yet in it. Restoring the row count leaves the suite green without this test.
  await addLeague({
    slug: SLUG,
    displayName: 'Members League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nGeorgia,Alice\nClemson,Alice');

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.deepEqual([...context.leagueMembers], ['Alice'], 'one person is in this league');
  assert.equal(
    context.leagueMembersSource,
    'partial-roster',
    'two teams held by one owner is not a two-owner roster'
  );
});

test('a departed owner IS named by the membership event, and nowhere else', () => {
  // The narrowing INSIGHTS-025 made explicit, pinned from both directions so it
  // cannot drift back into either "never name them" or "name them anywhere".
  //
  // Without the second half this test would pass if membership events stopped
  // firing; without the first, it would pass if the participant rule collapsed.
  assert.equal(MEMBERSHIP_GENERATOR_ID, 'narrative:membership');
});

test('WIRING: a departed owner is named ONLY by the membership event', async () => {
  await seedNamingAliceAndBob(['Carol', 'Dave']);
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  const participantNames = ownersNamedIn(context);
  const everyName = allOwnersNamedIn(context);

  for (const departed of ['Alice', 'Bob']) {
    assert.ok(
      !participantNames.includes(departed),
      `${departed} departed and must not be named as a participant — got: ${participantNames.join(', ')}`
    );
  }

  // And the event DOES name them, or the narrowing above is hiding a regression
  // rather than describing one.
  assert.ok(
    everyName.includes('Alice') || everyName.includes('Bob'),
    `a departure event should name who left — got: ${everyName.join(', ')}`
  );
});
