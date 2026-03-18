import type { AppGame } from './schedule';
import { isWeekContextGame } from './postseason-display';

const NO_DATE_KEY = 'tbd';

export function getPresentationTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export type WeekDateMetadata = {
  week: number;
  dateKeys: string[];
  startDateKey: string | null;
  endDateKey: string | null;
  label: string;
  datedGameCount: number;
  totalGameCount: number;
};

export type GameDateGroup = {
  dateKey: string;
  label: string;
  games: AppGame[];
};

function formatDateParts(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

function parseDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function parseKickoffMs(date: string | null): number | null {
  if (!date) return null;
  const kickoffMs = Date.parse(date);
  return Number.isFinite(kickoffMs) ? kickoffMs : null;
}

export function getGameDisplayDate(
  game: AppGame,
  timeZone = getPresentationTimeZone()
): string | null {
  if (!game.date) return null;
  const kickoff = new Date(game.date);
  if (Number.isNaN(kickoff.getTime())) return null;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(kickoff);
}

export function formatWeekDate(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return formatDateParts(date, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
}

export function formatWeekDateHeader(dateKey: string): string {
  const date = parseDateKey(dateKey);
  return formatDateParts(date, {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export function deriveWeekDateRangeLabel(
  games: AppGame[],
  timeZone = getPresentationTimeZone()
): string {
  const dateKeys = Array.from(
    new Set(
      games
        .map((game) => getGameDisplayDate(game, timeZone))
        .filter((dateKey): dateKey is string => !!dateKey)
    )
  ).sort((a, b) => a.localeCompare(b));

  if (dateKeys.length === 0) return '';
  if (dateKeys.length === 1) return formatWeekDate(dateKeys[0]!);

  return `${formatWeekDate(dateKeys[0]!)} – ${formatWeekDate(dateKeys[dateKeys.length - 1]!)}`;
}

export function deriveWeekDateMetadata(
  games: AppGame[],
  week: number,
  timeZone = getPresentationTimeZone()
): WeekDateMetadata {
  const weekGames = games.filter((game) => isWeekContextGame(game) && game.week === week);
  const dateKeys = Array.from(
    new Set(
      weekGames
        .map((game) => getGameDisplayDate(game, timeZone))
        .filter((dateKey): dateKey is string => !!dateKey)
    )
  ).sort((a, b) => a.localeCompare(b));

  return {
    week,
    dateKeys,
    startDateKey: dateKeys[0] ?? null,
    endDateKey: dateKeys[dateKeys.length - 1] ?? null,
    label: deriveWeekDateRangeLabel(weekGames, timeZone),
    datedGameCount: dateKeys.length,
    totalGameCount: weekGames.length,
  };
}

export function deriveWeekDateMetadataByWeek(
  games: AppGame[],
  timeZone = getPresentationTimeZone()
): Map<number, WeekDateMetadata> {
  const weeks = Array.from(
    new Set(
      games
        .filter((game) => isWeekContextGame(game))
        .map((game) => game.week)
        .filter((week): week is number => Number.isInteger(week) && week >= 0)
    )
  ).sort((a, b) => a - b);

  return new Map(weeks.map((week) => [week, deriveWeekDateMetadata(games, week, timeZone)]));
}

export function sortGamesChronologically(
  games: AppGame[],
  timeZone = getPresentationTimeZone()
): AppGame[] {
  return [...games].sort((left, right) => {
    const leftDateKey = getGameDisplayDate(left, timeZone) ?? NO_DATE_KEY;
    const rightDateKey = getGameDisplayDate(right, timeZone) ?? NO_DATE_KEY;

    if (leftDateKey !== rightDateKey) {
      if (leftDateKey === NO_DATE_KEY) return 1;
      if (rightDateKey === NO_DATE_KEY) return -1;
      return leftDateKey.localeCompare(rightDateKey);
    }

    const leftKickoffMs = parseKickoffMs(left.date);
    const rightKickoffMs = parseKickoffMs(right.date);
    if (leftKickoffMs != null && rightKickoffMs != null && leftKickoffMs !== rightKickoffMs) {
      return leftKickoffMs - rightKickoffMs;
    }
    if (leftKickoffMs == null && rightKickoffMs != null) return 1;
    if (leftKickoffMs != null && rightKickoffMs == null) return -1;

    return (
      left.eventId.localeCompare(right.eventId) ||
      left.csvAway.localeCompare(right.csvAway) ||
      left.csvHome.localeCompare(right.csvHome)
    );
  });
}

export function groupGamesByDisplayDate(
  games: AppGame[],
  timeZone = getPresentationTimeZone()
): GameDateGroup[] {
  const grouped = new Map<string, AppGame[]>();

  for (const game of sortGamesChronologically(games, timeZone)) {
    const dateKey = getGameDisplayDate(game, timeZone) ?? NO_DATE_KEY;
    const bucket = grouped.get(dateKey) ?? [];
    bucket.push(game);
    grouped.set(dateKey, bucket);
  }

  return Array.from(grouped.entries()).map(([dateKey, groupedGames]) => ({
    dateKey,
    label: dateKey === NO_DATE_KEY ? 'Date TBD' : formatWeekDateHeader(dateKey),
    games: groupedGames,
  }));
}
