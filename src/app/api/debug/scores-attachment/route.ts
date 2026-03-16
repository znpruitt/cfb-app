import { NextResponse } from 'next/server';

import { buildScheduleFromApi, type ScheduleWireItem } from '@/lib/schedule';
import { summarizeAttachmentReasons } from '@/lib/scoreAttachmentDiagnostics';
import type { ScoreAttachmentDebugResponse } from '@/lib/scoreAttachmentDebug';
import { fetchScoresByGame } from '@/lib/scores';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
  const weekParam = url.searchParams.get('week');
  const seasonType = url.searchParams.get('seasonType');
  const source = url.searchParams.get('source') ?? 'cfbd_scores';
  const week = weekParam && /^\d+$/.test(weekParam) ? Number.parseInt(weekParam, 10) : null;
  const origin = `${url.protocol}//${url.host}`;

  const [scheduleRes, teamsRes, aliasesRes] = await Promise.all([
    fetch(`${origin}/api/schedule?year=${year}`, { cache: 'no-store' }),
    fetch(`${origin}/api/teams`, { cache: 'no-store' }),
    fetch(`${origin}/api/aliases?year=${year}`, { cache: 'no-store' }),
  ]);

  const scheduleJson = (await scheduleRes.json().catch(() => ({ items: [] }))) as {
    items?: ScheduleWireItem[];
  };
  const teamsJson = (await teamsRes.json().catch(() => ({ items: [] }))) as {
    items?: Array<Record<string, unknown>>;
  };
  const aliasesJson = (await aliasesRes.json().catch(() => ({ map: {} }))) as {
    map?: Record<string, string>;
  };

  const built = buildScheduleFromApi({
    scheduleItems: scheduleJson.items ?? [],
    teams: (teamsJson.items ?? []) as never[],
    aliasMap: aliasesJson.map ?? {},
    season: year,
  });

  const scopedGames = built.games.filter((game) => {
    if (week != null && game.week !== week) return false;
    if (seasonType === 'regular' && game.stage !== 'regular') return false;
    if (seasonType === 'postseason' && (game.stage === 'regular' || game.stage == null)) {
      return false;
    }
    return true;
  });

  const scores = await fetchScoresByGame({
    games: scopedGames,
    aliasMap: aliasesJson.map ?? {},
    season: year,
    teams: (teamsJson.items ?? []) as never[],
    debugTrace: true,
    apiBaseUrl: origin,
  });

  const diagnostics = scores.debugDiagnostics ?? [];
  const response: ScoreAttachmentDebugResponse = {
    year,
    week,
    seasonType,
    source,
    summary: {
      providerRowCount: scores.debugSnapshot?.providerRowCount ?? 0,
      attachedCount: scores.debugSnapshot?.attachedCount ?? 0,
      ignoredCount: diagnostics.length,
      reasons: summarizeAttachmentReasons(diagnostics),
    },
    schedule: {
      indexedGameCount: scopedGames.length,
      games: scopedGames.slice(0, 250).map((game) => ({
        gameKey: game.key,
        homeTeam: game.canHome ?? null,
        awayTeam: game.canAway ?? null,
        week: game.week ?? null,
        seasonType: game.stage === 'regular' ? 'regular' : 'postseason',
        status: null,
      })),
    },
    diagnostics,
  };

  return NextResponse.json(response);
}
