import { NextResponse } from 'next/server';

import { loadDebugSeasonContext, parseDebugYear } from '../_lib/loadDebugSeasonContext';
import { buildScheduleFromApi, type AppGame } from '@/lib/schedule';
import {
  buildScheduleIndex,
  matchScoreRowToSchedule,
  type NormalizedScoreRow,
  type ScheduleIndexEntry,
} from '@/lib/scoreAttachment';
import { createTeamIdentityResolver } from '@/lib/teamIdentity';

export const dynamic = 'force-dynamic';

type ScoreWire = {
  id?: string | number | null;
  seasonType?: 'regular' | 'postseason' | null;
  startDate?: string | null;
  week?: number | null;
  status?: string | null;
  time?: string | null;
  home?: string | { team?: string; score?: number | null } | null;
  away?: string | { team?: string; score?: number | null } | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

function extractRows(payload: unknown): NormalizedScoreRow[] {
  const items = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : [];

  return items
    .map((item) => {
      const row = item as ScoreWire;
      const home = row.home;
      const away = row.away;
      const homeTeam = typeof home === 'string' ? home : (home?.team ?? '');
      const awayTeam = typeof away === 'string' ? away : (away?.team ?? '');
      const homeScore =
        typeof home === 'string' ? (row.homeScore ?? null) : (home?.score ?? row.homeScore ?? null);
      const awayScore =
        typeof away === 'string' ? (row.awayScore ?? null) : (away?.score ?? row.awayScore ?? null);
      return {
        providerEventId:
          row.id != null && String(row.id).trim().length > 0 ? String(row.id).trim() : null,
        seasonType:
          row.seasonType === 'regular' || row.seasonType === 'postseason' ? row.seasonType : null,
        date: row.startDate ?? null,
        week: typeof row.week === 'number' ? row.week : null,
        status: row.status ?? 'scheduled',
        time: row.time ?? null,
        home: { team: homeTeam, score: typeof homeScore === 'number' ? homeScore : null },
        away: { team: awayTeam, score: typeof awayScore === 'number' ? awayScore : null },
      } satisfies NormalizedScoreRow;
    })
    .filter((row) => row.home.team.trim() && row.away.team.trim());
}

function toSeasonType(game: AppGame): 'regular' | 'postseason' {
  return game.stage === 'regular' ? 'regular' : 'postseason';
}

function closestCandidate(params: {
  candidates: ScheduleIndexEntry[];
  row: NormalizedScoreRow;
  seasonType: 'regular' | 'postseason';
}): { gameKey: string; mismatchReasons: string[] } | null {
  const { candidates, row, seasonType } = params;
  if (candidates.length === 0) return null;

  const kickoffMs = row.date ? Date.parse(row.date) : NaN;
  let best: { entry: ScheduleIndexEntry; score: number; reasons: string[] } | null = null;

  for (const candidate of candidates) {
    let score = 0;
    const reasons: string[] = [];

    if (candidate.seasonType !== seasonType) {
      score += 40;
      reasons.push(`seasonType_mismatch:${candidate.seasonType}!=${seasonType}`);
    }

    if (row.week != null && candidate.week !== row.week) {
      score += 25;
      reasons.push(`week_mismatch:${candidate.week}!=${row.week}`);
    }

    const candidateKickoffMs = candidate.date ? Date.parse(candidate.date) : NaN;
    if (Number.isFinite(kickoffMs) && Number.isFinite(candidateKickoffMs)) {
      const deltaHours = Math.abs(candidateKickoffMs - kickoffMs) / (1000 * 60 * 60);
      if (deltaHours > 18) {
        score += Math.min(20, Math.floor(deltaHours));
        reasons.push(`kickoff_delta_hours:${deltaHours.toFixed(1)}`);
      }
    }

    if (candidate.game.canHome !== row.home.team || candidate.game.canAway !== row.away.team) {
      reasons.push('home_away_name_not_exact');
    }

    if (!best || score < best.score) best = { entry: candidate, score, reasons };
  }

  return best
    ? {
        gameKey: best.entry.gameKey,
        mismatchReasons: best.reasons,
      }
    : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = parseDebugYear(url);
  const origin = `${url.protocol}//${url.host}`;

  const [context, scoresRes] = await Promise.all([
    loadDebugSeasonContext({ year, origin }),
    fetch(`${origin}/api/scores?year=${year}&seasonType=postseason`, { cache: 'no-store' }),
  ]);

  const built = buildScheduleFromApi({
    scheduleItems: context.scheduleItems,
    teams: context.teamItems as never[],
    aliasMap: context.aliasMap,
    season: year,
    conferenceRecords: context.conferenceItems,
  });

  const postseasonGames = built.games.filter((game) => game.stage !== 'regular');
  const resolver = createTeamIdentityResolver({
    aliasMap: context.aliasMap,
    teams: context.teamItems as never[],
    observedNames: Array.from(
      new Set(postseasonGames.flatMap((g) => [g.csvHome, g.csvAway, g.canHome, g.canAway]))
    ),
  });
  const scheduleIndex = buildScheduleIndex(
    postseasonGames.map((game) => ({
      key: game.key,
      week: game.week,
      date: game.date,
      stage: game.stage,
      providerGameId: game.providerGameId,
      canHome: game.canHome,
      canAway: game.canAway,
      participants: {
        home: { kind: game.participants.home.kind },
        away: { kind: game.participants.away.kind },
      },
    })),
    resolver
  );

  const scoreRows = scoresRes.ok ? extractRows(await scoresRes.json()) : [];
  const matchedByGameKey = new Map<string, { providerEventId: string | null; strategy: string }>();
  for (const row of scoreRows) {
    const match = matchScoreRowToSchedule(row, scheduleIndex, resolver, { debugTrace: true });
    if (match.matched) {
      matchedByGameKey.set(match.entry.gameKey, {
        providerEventId: row.providerEventId,
        strategy: match.strategy,
      });
    }
  }

  const indexCandidates = Array.from(scheduleIndex.byPairWeek.values()).flat();

  const games = postseasonGames.map((game) => {
    const matched = matchedByGameKey.get(game.key);
    const canonicalHomeId =
      game.participants.home.kind === 'team' ? game.participants.home.teamId : null;
    const canonicalAwayId =
      game.participants.away.kind === 'team' ? game.participants.away.teamId : null;

    let closest: { gameKey: string; mismatchReasons: string[] } | null = null;
    if (!matched) {
      const rowCandidate = scoreRows.find(
        (row) =>
          row.providerEventId &&
          game.providerGameId &&
          String(row.providerEventId) === String(game.providerGameId)
      );
      if (rowCandidate) {
        closest = closestCandidate({
          candidates: indexCandidates,
          row: rowCandidate,
          seasonType: toSeasonType(game),
        });
      }
    }

    return {
      canonicalGameId: game.key,
      seasonYear: year,
      week: game.week,
      seasonType: toSeasonType(game),
      subtype: game.stage,
      kickoff: game.date,
      homeRawName: game.csvHome,
      awayRawName: game.csvAway,
      homeCanonicalId: canonicalHomeId,
      awayCanonicalId: canonicalAwayId,
      isPlaceholder: game.isPlaceholder,
      participantsResolved:
        game.participants.home.kind === 'team' && game.participants.away.kind === 'team',
      matchedNormalizedScore: Boolean(matched),
      matchedProviderEventId: matched?.providerEventId ?? null,
      matchedStrategy: matched?.strategy ?? null,
      closestCandidate: closest,
    };
  });

  return NextResponse.json({
    year,
    upstream: {
      postseasonScoreFetchOk: scoresRes.ok,
      postseasonScoreRowCount: scoreRows.length,
      endpoint: `/api/scores?year=${year}&seasonType=postseason`,
    },
    examples: games
      .filter(
        (g) =>
          g.subtype === 'bowl' ||
          g.canonicalGameId.includes('championship') ||
          g.subtype === 'playoff'
      )
      .slice(0, 5),
    games,
  });
}
