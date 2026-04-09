import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeagues, addLeague, updateLeague } from '@/lib/leagueRegistry';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import type { League } from '@/lib/league';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const slug = 'test';
  const year = 2025;

  // 1. Register or update the test league
  const leagues = await getLeagues();
  const existing = leagues.find((l) => l.slug === slug);

  if (existing) {
    await updateLeague(slug, { displayName: 'Test League', year, foundedYear: 2025 });
  } else {
    const league: League = {
      slug,
      displayName: 'Test League',
      year,
      createdAt: new Date().toISOString(),
      foundedYear: 2025,
    };
    await addLeague(league);
  }

  // 2. Copy TSC roster to test league
  const tscRoster = await getAppState<string>('owners:tsc:2025', 'csv');
  if (!tscRoster?.value) {
    return Response.json({ error: 'TSC roster not found at owners:tsc:2025' }, { status: 404 });
  }

  await setAppState('owners:test:2025', 'csv', tscRoster.value);

  // 3. Verify
  const testRoster = await getAppState<string>('owners:test:2025', 'csv');
  const tscVerify = await getAppState<string>('owners:tsc:2025', 'csv');

  const countLines = (csv: string) =>
    csv.trim().split('\n').filter((l, i) => i > 0 && l.trim().length > 0).length;

  const testCount = testRoster?.value ? countLines(testRoster.value) : 0;
  const tscCount = tscVerify?.value ? countLines(tscVerify.value) : 0;
  const tscUnchanged = tscVerify?.value === tscRoster.value;

  const updatedLeagues = await getLeagues();
  const testLeague = updatedLeagues.find((l) => l.slug === slug);

  return Response.json({
    success: true,
    testLeague: testLeague ?? null,
    testRosterRows: testCount,
    tscRosterRows: tscCount,
    tscUnchanged,
    registeredLeagues: updatedLeagues.map((l) => l.slug),
  });
}
