'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getLeague, updateLeague, updateLeagueStatus } from '@/lib/leagueRegistry';
import { savePreseasonOwners } from '@/lib/preseasonOwnerStore';
import { listAppStateKeys, deleteAppState, getAppState, setAppState } from '@/lib/server/appStateStore';
import { draftScope } from '@/lib/draft';

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
    await updateLeagueStatus('test', { state: 'preseason', year: preseasonYear });
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

/** Hard-reset the test league to { state: 'season', year: 2025 }, syncing league.year too. */
export async function resetTestLeague(): Promise<void> {
  await updateLeague('test', { year: 2025 });
  await updateLeagueStatus('test', { state: 'season', year: 2025 });
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
