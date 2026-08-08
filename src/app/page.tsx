import { buildHomeView } from '@/components/home/homeView';
import { isPlatformAdminSession } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-088 — a thin auth shell. The branch itself lives in `buildHomeView`
 * so it can be tested directly with each authorization outcome; everything this
 * file adds is the one call that produces that outcome.
 */
export default async function Page(): Promise<React.ReactElement> {
  return buildHomeView({ isPlatformAdmin: await isPlatformAdminSession() });
}
