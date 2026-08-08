import { buildHomeView } from '@/app/homeView';
import { isPlatformAdminSession, isSignedInSession } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-088 — a thin auth shell. The branch itself lives in `buildHomeView`
 * so it can be tested directly with each combination of authorization outcomes;
 * everything this file adds is resolving those two facts.
 */
export default async function Page(): Promise<React.ReactElement> {
  const [isPlatformAdmin, isSignedIn] = await Promise.all([
    isPlatformAdminSession(),
    isSignedInSession(),
  ]);
  return buildHomeView({ isPlatformAdmin, isSignedIn });
}
