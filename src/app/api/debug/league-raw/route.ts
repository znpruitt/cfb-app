import { getLeagues } from '@/lib/leagueRegistry';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const leagues = await getLeagues();
  return NextResponse.json(leagues);
}
