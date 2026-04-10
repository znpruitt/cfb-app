'use server';

import { revalidatePath } from 'next/cache';
import { getLeague, updateLeagueStatus } from '@/lib/leagueRegistry';

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
    await updateLeagueStatus('test', { state: 'season', year: league.year });
  } else if (state === 'offseason') {
    await updateLeagueStatus('test', { state: 'offseason' });
  } else {
    await updateLeagueStatus('test', { state: 'preseason', year: league.year + 1 });
  }

  revalidatePath('/admin/test');
}
