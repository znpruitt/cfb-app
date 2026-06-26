import { NextResponse } from 'next/server';

import { getLatestKnownOddsUsage } from '@/lib/server/oddsUsageStore';
import { requireAdminAuth } from '@/lib/server/adminAuth';

export async function GET(req: Request) {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  return NextResponse.json({ usage: await getLatestKnownOddsUsage() });
}
