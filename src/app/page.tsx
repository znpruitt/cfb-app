import { buildHomeView } from '@/app/homeView';
import { resolveSessionFacts } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-088 — a thin auth shell. The branch itself lives in `buildHomeView`
 * so it can be tested directly with each combination of outcomes.
 *
 * Both facts come from ONE resolution rather than two independent calls, which
 * could disagree on a misconfigured deployment and tell an admin they were not
 * one.
 */
export default async function Page(): Promise<React.ReactElement> {
  const { isPlatformAdmin, isSignedIn } = await resolveSessionFacts();
  return buildHomeView({ isPlatformAdmin, isSignedIn });
}
