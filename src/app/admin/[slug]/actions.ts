'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  beginPreseasonTransition,
  completePreseasonSetup,
  getLeague,
  updateLeague,
  resetTestLeagueLifecycle,
  setTestLeagueLifecycleState,
  type TestLeagueLifecycleState,
} from '@/lib/leagueRegistry';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import {
  listAppStateKeys,
  deleteAppState,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import { draftScope, type DraftState, type DraftPick } from '@/lib/draft';
import { TEST_LEAGUE_SLUG } from '@/lib/league';
import teamsData from '@/data/teams.json';

/** The admin path the demo controls revalidate. */
const TEST_LEAGUE_ADMIN_PATH = `/admin/${TEST_LEAGUE_SLUG}`;

/**
 * Every demo-scoped app-state record keyed by a single season year, owned in one
 * place so the slug cannot half-migrate — a change that moved the registry write
 * but not one of these deletes would strand state the controls can no longer
 * reach.
 */
function testLeagueYearScopes(year: number): Array<[string, string]> {
  return [
    [`preseason-owners:${TEST_LEAGUE_SLUG}`, String(year)],
    [`owners:${TEST_LEAGUE_SLUG}:${year}`, 'csv'],
    [draftScope(TEST_LEAGUE_SLUG), String(year)],
  ];
}

/**
 * Set the lifecycle status of the demo league. Structurally demo-only — the
 * authority takes no slug, so no production league is reachable from here.
 *
 * PLATFORM-086F2H1T1: the year is derived and validated INSIDE the registry
 * transaction. This action no longer reads the league first and submits a year
 * computed from that snapshot — `getLeague` is React-`cache`d, so the old
 * read-then-write could derive from a memoized record taken outside the lock.
 */
export async function setTestLeagueStatus(state: TestLeagueLifecycleState): Promise<void> {
  const result = await setTestLeagueLifecycleState(state);

  if (result.outcome === 'league-not-found') throw new Error('Test league not found');
  if (result.outcome !== 'applied') {
    // A structurally unusable stored/derived year is a data-integrity fault
    // requiring intervention; the reset control derives nothing and is the
    // recovery path. Only the public slug and the typed outcome are logged —
    // never a record, request body, or exception text.
    console.error(
      JSON.stringify({
        event: 'lifecycle-action-refused',
        action: 'set-test-league-status',
        leagueSlug: TEST_LEAGUE_SLUG,
        reason: result.outcome,
      })
    );
    throw new Error('Unable to set test league status');
  }

  // Clear the demo-scoped state for the year the AUTHORITY resolved, never a
  // locally recomputed one. Sequenced strictly after the confirmed commit: the
  // registry write and these deletes are separate scopes and are NOT atomic
  // together, so racing them in one `Promise.all` could clear a year the
  // lifecycle write then refused to install.
  if (result.status.state === 'preseason') {
    await Promise.all(
      testLeagueYearScopes(result.status.year).map(([scope, key]) => deleteAppState(scope, key))
    );
  }

  revalidatePath(TEST_LEAGUE_ADMIN_PATH);
}

/**
 * Clear all draft state for the test league. Only valid for slug='test'.
 * Deletes every year key under draft:test and the corresponding owner CSV
 * written by draft confirmation (owners:test:{year} / 'csv').
 */
export async function resetTestDraft(): Promise<void> {
  const scope = draftScope('test');
  const years = await listAppStateKeys(scope);
  await Promise.all(
    years.map(async (year) => {
      await deleteAppState(scope, year);
      // Also clear the owner CSV written when the draft was confirmed
      await deleteAppState(`owners:test:${year}`, 'csv');
    })
  );
  revalidatePath('/admin/test');
}

/**
 * Hard-reset the test league to { state: 'season', year: 2025 }. The lifecycle
 * authority synchronizes league.year in the same write.
 * Also clears all 2026 preseason/draft state so the next dry run starts clean.
 */
export async function resetTestLeague(): Promise<void> {
  const result = await resetTestLeagueLifecycle();
  if (result.outcome === 'league-not-found') throw new Error('Test league not found');
  // Anything other than a confirmed commit must not reach cleanup. The reset
  // authority cannot refuse today, but its return type is the shared outcome
  // union — a future guard on this path would otherwise fall straight through
  // and clear state for a lifecycle write that never landed.
  if (result.outcome !== 'applied') throw new Error('Unable to reset test league');

  // Demo-SCOPED state only, for the season AFTER the one the authority just
  // installed — the preseason a fresh dry run will use. Derived from the
  // returned status rather than a literal, so it cannot drift from
  // `TEST_LEAGUE_RESET_YEAR`.
  //
  // PLATFORM-086F2H1T1 removed a `deleteAppState('schedule-probe', <year>)`
  // from this list. `schedule-probe/<year>` is keyed by YEAR ALONE
  // (`src/lib/scheduleProbe.ts`) and is shared by every league, so resetting the
  // sandbox disarmed that year's probe for production leagues and forced the
  // year back from weekly maintenance to the daily season-transition cron. A
  // demo reset must never mutate schedule state real leagues depend on.
  if (result.status.state === 'season') {
    const nextPreseason = result.status.year + 1;
    await Promise.all(
      testLeagueYearScopes(nextPreseason).map(([scope, key]) => deleteAppState(scope, key))
    );
  }
  revalidatePath(TEST_LEAGUE_ADMIN_PATH);
}

/** Transition a league from offseason to preseason and redirect to the setup page. */
export async function beginPreseason(slug: string): Promise<void> {
  const result = await beginPreseasonTransition(slug);
  if (result.outcome === 'league-not-found') throw new Error('League not found');
  if (result.outcome === 'not-in-offseason') throw new Error('League is not in offseason');
  if (result.outcome === 'unusable-stored-year' || result.outcome === 'unusable-next-year') {
    // An unusable year is a data-integrity fault requiring intervention, so it
    // is error-level. The public league slug is the only correlation field;
    // raw records, request bodies, and exception text never enter the event.
    console.error(
      JSON.stringify({
        event: 'lifecycle-action-refused',
        action: 'begin-preseason',
        leagueSlug: slug,
        reason: result.outcome,
      })
    );
    throw new Error('Unable to begin preseason');
  }
  // Offseason→preseason changes the league's standings surface (prior-season
  // final → preseason owner list). Bust its cached snapshots (umbrella, all
  // years) so the public page reflects the new lifecycle state. Before the
  // redirect, which throws.
  invalidateStandings(slug);
  redirect(`/admin/${slug}/preseason`);
}

/** Persist the commissioner's choice of how teams will be assigned this preseason. */
export async function setAssignmentMethod(slug: string, method: 'draft' | 'manual'): Promise<void> {
  await updateLeague(slug, { assignmentMethod: method });
  revalidatePath(`/admin/${slug}/preseason`);
}

/** Persist the confirmed owner list for the preseason and redirect back to setup. */
export async function confirmPreseasonOwners(
  slug: string,
  year: number,
  owners: string[]
): Promise<void> {
  if (owners.length < 2) throw new Error('At least 2 owners required');
  await savePreseasonOwners(slug, year, owners);
  // Preseason owners feed the preseason standings snapshot; bust this league's
  // cached standings so the confirmed roster shows without a hard refresh.
  // Before the redirect, which throws.
  invalidateStandings(slug, year);
  redirect(`/admin/${slug}/preseason`);
}

/** Mark preseason setup as complete. Season transition happens automatically via cron. */
export async function completeSetup(slug: string, year: number): Promise<void> {
  const result = await completePreseasonSetup(slug, year);
  if (result.outcome === 'league-not-found') throw new Error('League not found');
  if (result.outcome === 'not-in-preseason') throw new Error('League is not in preseason');
  if (result.outcome === 'year-mismatch') {
    // A stale form is an expected concurrency refusal, so it is warning-level.
    console.warn(
      JSON.stringify({
        event: 'lifecycle-action-refused',
        action: 'complete-preseason-setup',
        leagueSlug: slug,
        reason: result.outcome,
      })
    );
  }
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/admin/${slug}`, 'layout');
  revalidatePath(`/admin/${slug}/preseason`);
  redirect(`/admin/${slug}`);
}

/**
 * Copy owners CSV from one year key to the next. Only valid for slug='test'.
 * Useful when draft was confirmed before the preseason year bump.
 */
export async function migrateTestOwnersCsv(fromYear: number, toYear: number): Promise<string> {
  const record = await getAppState<string>(`owners:test:${fromYear}`, 'csv');
  if (!record?.value) {
    return `No owners CSV found at owners:test:${fromYear}`;
  }
  await setAppState(`owners:test:${toYear}`, 'csv', record.value);
  revalidatePath('/admin/test');
  return `Migrated owners CSV from ${fromYear} → ${toYear} (${record.value.length} chars)`;
}

/**
 * Auto-complete the test league draft by filling all remaining picks randomly,
 * then writing the owners CSV. Test league only.
 *
 * Returns the number of picks that were auto-filled.
 */
export async function autoCompleteDraft(): Promise<number> {
  const league = await getLeague('test');
  if (!league) throw new Error('Test league not found');

  const year =
    league.status?.state === 'preseason' || league.status?.state === 'season'
      ? league.status.year
      : league.year;

  const record = await getAppState<DraftState>(draftScope('test'), String(year));
  if (!record?.value) throw new Error(`No draft found for test league year ${year}`);

  const draft = record.value;
  if (draft.phase === 'complete') throw new Error('Draft is already complete');
  if (!draft.settings.draftOrder.length) throw new Error('Draft has no draft order configured');

  // All FBS teams from the catalog (same filter as the main draft route)
  const allTeams = (teamsData as { items: { school: string }[] }).items
    .map((t) => t.school)
    .filter((s) => s !== 'NoClaim');

  const pickedTeams = new Set(draft.picks.map((p) => p.team.toLowerCase()));
  const available = allTeams.filter((t) => !pickedTeams.has(t.toLowerCase()));

  // Shuffle available teams (Fisher-Yates)
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j]!, available[i]!];
  }

  // Calculate total picks: totalRounds * ownerCount
  const n = draft.settings.draftOrder.length;
  const totalPicks = draft.settings.totalRounds * n;
  const remainingSlots = totalPicks - draft.picks.length;

  if (remainingSlots <= 0) throw new Error('All pick slots are already filled');
  if (available.length < remainingSlots) {
    throw new Error(
      `Not enough available teams (${available.length}) to fill ${remainingSlots} remaining picks`
    );
  }

  // Fill remaining picks using snake draft order
  const newPicks: DraftPick[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < remainingSlots; i++) {
    const pickIndex = draft.currentPickIndex + i;
    const round = Math.floor(pickIndex / n);
    const posInRound = pickIndex % n;
    const ownerIdx = round % 2 === 0 ? posInRound : n - 1 - posInRound;
    const owner = draft.settings.draftOrder[ownerIdx]!;

    newPicks.push({
      pickNumber: pickIndex + 1,
      round,
      roundPick: posInRound,
      owner,
      team: available[i]!,
      pickedAt: now,
      autoSelected: true,
    });
  }

  const allPicks = [...draft.picks, ...newPicks];

  // Write completed draft state
  const completed: DraftState = {
    ...draft,
    picks: allPicks,
    currentPickIndex: totalPicks,
    phase: 'complete',
    timerState: 'off',
    timerExpiresAt: null,
    updatedAt: now,
  };
  await setAppState<DraftState>(draftScope('test'), String(year), completed);

  // Write owners CSV (same format as confirm route)
  const csvLines = ['team,owner'];
  for (const pick of allPicks) {
    const team =
      pick.team.includes(',') || pick.team.includes('"')
        ? `"${pick.team.replace(/"/g, '""')}"`
        : pick.team;
    const owner =
      pick.owner.includes(',') || pick.owner.includes('"')
        ? `"${pick.owner.replace(/"/g, '""')}"`
        : pick.owner;
    csvLines.push(`${team},${owner}`);
  }

  // Append NoClaim rows for undrafted teams
  const draftedLower = new Set(allPicks.map((p) => p.team.toLowerCase()));
  for (const teamName of allTeams) {
    if (!draftedLower.has(teamName.toLowerCase())) {
      const field =
        teamName.includes(',') || teamName.includes('"')
          ? `"${teamName.replace(/"/g, '""')}"`
          : teamName;
      csvLines.push(`${field},NoClaim`);
    }
  }

  await setAppState(`owners:test:${year}`, 'csv', csvLines.join('\n'));

  revalidatePath('/admin/test');
  return newPicks.length;
}
