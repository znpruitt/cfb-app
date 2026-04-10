'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getLeague, updateLeague, updateLeagueStatus } from '@/lib/leagueRegistry';

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
    await updateLeagueStatus('test', { state: 'preseason', year: league.year + 1 });
  }

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

/** Transition a league from preseason to season and redirect to the league hub. */
export async function goLive(slug: string, year: number): Promise<void> {
  const league = await getLeague(slug);
  if (!league) throw new Error('League not found');
  if (league.status?.state !== 'preseason') throw new Error('League is not in preseason');
  await updateLeagueStatus(slug, { state: 'season', year });
  redirect(`/admin/${slug}`);
}
