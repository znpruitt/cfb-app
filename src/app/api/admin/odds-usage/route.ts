import { NextResponse } from 'next/server';

import { getLatestKnownOddsUsage } from '@/lib/server/oddsUsageStore';

export async function GET() {
  return NextResponse.json({ usage: await getLatestKnownOddsUsage() });
}
