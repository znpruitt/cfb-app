'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getLeague, updateLeague, updateLeagueStatus } from '@/lib/leagueRegistry';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import { listAppStateKeys, deleteAppState, getAppState, setAppState } from '@/lib/server/appStateStore';
import { draftScope, type DraftState, type DraftPick } from '@/lib/draft';
import teamsData from '@/data/teams.json';

/**
 * Set the lifecycle status of the test league. Only valid for slug='test'.
 * Hardcoded guard — this action must never be exposed for production leagues.
 */
export async function setTestLeagueStatus(
  state: 'season' | 'offseason' | 'preseason'
): Promise<void> {
  const league = await getLeague('test');
  if (!league) throw new Error('Test league not found');

  if (state === 'season') {
    // Carry forward the year from preseason so the increment set by 'Set: Pre-Season' is preserved
    const seasonYear =
      league.status?.state === 'preseason' ? league.status.year : league.year;
    await updateLeagueStatus('test', { state: 'season', year: seasonYear });
  } else if (state === 'offseason') {
    await updateLeagueStatus('test', { state: 'offseason' });
  } else {
    // Derive preseason year from the current resolved season year to avoid double-increment:
    // season(N) → preseason(N+1); offseason/none → league.year+1; preseason(N) → stay at N
    const cur = league.status;
    const preseasonYear =
      cur?.state === 'season'
        ? cur.year + 1
        : cur?.state === 'preseason'
          ? cur.year
          : league.year + 1;
    // Clear preseason state for the target year so each test starts fresh
    await Promise.all([
      updateLeagueStatus('test', { state: 'preseason', year: preseasonYear }),
      deleteAppState('preseason-owners:test', String(preseasonYear)),
      deleteAppState(`owners:test:${preseasonYear}`, 'csv'),
      deleteAppState(draftScope('test'), String(preseasonYear)),
    ]);
  }

  revalidatePath('/admin/test');
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
 * Hard-reset the test league to { state: 'season', year: 2025 }, syncing league.year too.
 * Also clears all 2026 preseason/draft state so the next dry run starts clean.
 */
export async function resetTestLeague(): Promise<void> {
  await Promise.all([
    updateLeague('test', { year: 2025 }),
    updateLeagueStatus('test', { state: 'season', year: 2025 }),
    deleteAppState('preseason-owners:test', '2026'),
    deleteAppState('owners:test:2026', 'csv'),
    deleteAppState(draftScope('test'), '2026'),
    deleteAppState('schedule-probe', '2026'),
  ]);
  revalidatePath('/admin/test');
}

/** Transition a league from offseason to preseason and redirect to the setup page. */
export async function beginPreseason(slug: string): Promise<void> {
  const league = await getLeague(slug);
  if (!league) throw new Error('League not found');
  await updateLeagueStatus(slug, { state: 'preseason', year: league.year + 1 });
  redirect(`/admin/${slug}/preseason`);
}

/** Persist the commissioner's choice of how teams will be assigned this preseason. */
export async function setAssignmentMethod(
  slug: string,
  method: 'draft' | 'manual'
): Promise<void> {
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
  redirect(`/admin/${slug}/preseason`);
}

/** Transition a league from preseason to season and redirect to the league hub. */
export async function goLive(slug: string, year: number): Promise<void> {
  const league = await getLeague(slug);
  if (!league) throw new Error('League not found');
  if (league.status?.state !== 'preseason') throw new Error('League is not in preseason');
  await updateLeagueStatus(slug, { state: 'season', year });
  await updateLeague(slug, { year });
  redirect(`/admin/${slug}`);
}

/**
 * Mark preseason setup as complete without transitioning to season state.
 * The season transition is handled separately (e.g. by the commissioner
 * clicking Go Live or by an automated process).
 */
export async function completeSetup(slug: string, year: number): Promise<void> {
  const league = await getLeague(slug);
  if (!league) throw new Error('League not found');
  if (league.status?.state !== 'preseason') throw new Error('League is not in preseason');
  await updateLeagueStatus(slug, { state: 'preseason', year, setupComplete: true });
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/admin/${slug}/preseason`);
  redirect(`/admin/${slug}`);
}

/**
 * Copy the raw owner CSV verbatim from one year to another.
 * Test league only — sandbox control for quickly populating a new season's roster.
 */
export async function migrateTestOwnersCsv(fromYear: number, toYear: number): Promise<void> {
  const csvRecord = await getAppState<string>(`owners:test:${fromYear}`, 'csv');
  const csvText = typeof csvRecord?.value === 'string' ? csvRecord.value : '';
  if (!csvText) throw new Error(`No owner CSV found for test league year ${fromYear}`);

  await setAppState(`owners:test:${toYear}`, 'csv', csvText);
  revalidatePath('/admin/test');
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
    const team = pick.team.includes(',') || pick.team.includes('"')
      ? `"${pick.team.replace(/"/g, '""')}"` : pick.team;
    const owner = pick.owner.includes(',') || pick.owner.includes('"')
      ? `"${pick.owner.replace(/"/g, '""')}"` : pick.owner;
    csvLines.push(`${team},${owner}`);
  }

  // Append NoClaim rows for undrafted teams
  const draftedLower = new Set(allPicks.map((p) => p.team.toLowerCase()));
  for (const teamName of allTeams) {
    if (!draftedLower.has(teamName.toLowerCase())) {
      const field = teamName.includes(',') || teamName.includes('"')
        ? `"${teamName.replace(/"/g, '""')}"` : teamName;
      csvLines.push(`${field},NoClaim`);
    }
  }

  await setAppState(`owners:test:${year}`, 'csv', csvLines.join('\n'));

  revalidatePath('/admin/test');
  return newPicks.length;
}
