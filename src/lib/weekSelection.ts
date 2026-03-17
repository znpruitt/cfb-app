import type { AppGame } from './schedule';
import { isWeekContextGame } from './postseason-display';

export function deriveRegularWeeks(games: AppGame[]): number[] {
  return Array.from(
    new Set(
      games
        .filter((game) => isWeekContextGame(game))
        .map((game) => game.week)
        .filter((week): week is number => Number.isInteger(week) && week >= 0)
    )
  ).sort((a, b) => a - b);
}

export function filterGamesForWeek(games: AppGame[], selectedWeek: number | null): AppGame[] {
  if (selectedWeek == null) return [];
  return games.filter((game) => isWeekContextGame(game) && game.week === selectedWeek);
}

type DefaultWeekArgs = {
  games: AppGame[];
  regularWeeks: number[];
  nowMs?: number;
};

const OFFSEASON_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function parseKickoffMs(date: string | null): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function chooseDefaultWeek({
  games,
  regularWeeks,
  nowMs = Date.now(),
}: DefaultWeekArgs): number | null {
  const fallbackWeek = regularWeeks[0] ?? null;
  if (!regularWeeks.length) return null;

  const weekStartByWeek = new Map<number, number>();

  for (const game of games) {
    if (!isWeekContextGame(game)) continue;
    const kickoffMs = parseKickoffMs(game.date);
    if (kickoffMs == null) continue;

    const existing = weekStartByWeek.get(game.week);
    if (existing == null || kickoffMs < existing) {
      weekStartByWeek.set(game.week, kickoffMs);
    }
  }

  if (!weekStartByWeek.size) return fallbackWeek;

  const sortedWeekStarts = Array.from(weekStartByWeek.entries()).sort((a, b) => a[1] - b[1]);
  const seasonStartMs = sortedWeekStarts[0]?.[1] ?? null;
  const seasonEndMs = sortedWeekStarts[sortedWeekStarts.length - 1]?.[1] ?? null;

  if (seasonStartMs == null || seasonEndMs == null) return fallbackWeek;

  if (nowMs < seasonStartMs || nowMs > seasonEndMs + OFFSEASON_GRACE_MS) {
    return fallbackWeek;
  }

  const startedWeeks = sortedWeekStarts
    .filter(([, weekStartMs]) => weekStartMs <= nowMs)
    .map(([week]) => week)
    .sort((a, b) => a - b);

  return startedWeeks[startedWeeks.length - 1] ?? fallbackWeek;
}
