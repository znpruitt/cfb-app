import { NextResponse } from 'next/server';

import { loadDebugSeasonContext, parseDebugYear } from '../_lib/loadDebugSeasonContext';
import { buildScheduleFromApi } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = parseDebugYear(url);
  const origin = `${url.protocol}//${url.host}`;
  const context = await loadDebugSeasonContext({ year, origin });

  const built = buildScheduleFromApi({
    scheduleItems: context.scheduleItems,
    teams: context.teamItems as never[],
    aliasMap: context.aliasMap,
    season: year,
    conferenceRecords: context.conferenceItems,
  });

  return NextResponse.json({
    count: built.games.length,
    issues: built.issues,
    hydrationDiagnostics: built.hydrationDiagnostics,
    sample: built.games.slice(0, 25),
  });
}
