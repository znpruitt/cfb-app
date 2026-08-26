import type { SeasonType } from './cfbdSchedule.ts';

const MAX_VANISHED_GAMES_PER_EVENT = 25;
const MAX_EVENT_STRING_LENGTH = 160;

export type VanishedScheduleGame = {
  providerGameId: number;
  week: number | null;
  seasonType: SeasonType | null;
  startDate: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
};

export type VanishedScheduleGames = {
  count: number;
  games: VanishedScheduleGame[];
  truncated: boolean;
};

function providerGameId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function boundedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_EVENT_STRING_LENGTH) : null;
}

function scheduleWeek(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function seasonType(value: unknown): SeasonType | null {
  return value === 'regular' || value === 'postseason' ? value : null;
}

function asRow(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Compare canonical numeric CFBD record ids across two schedule snapshots.
 * Rewrites to kickoff, teams, venue, or other fields on the SAME id are silent.
 * A prior numeric id followed only by an id-less/synthetic row is still reported:
 * this event observes provider-record disappearance, not cancellation semantics.
 */
export function findVanishedScheduleGames(
  priorItems: readonly unknown[],
  nextItems: readonly unknown[]
): VanishedScheduleGames {
  const nextIds = new Set<number>();
  for (const value of nextItems) {
    const row = asRow(value);
    const id = providerGameId(row?.id);
    if (id !== null) nextIds.add(id);
  }

  const seenPriorIds = new Set<number>();
  const allGames: VanishedScheduleGame[] = [];
  for (const value of priorItems) {
    const row = asRow(value);
    if (!row) continue;
    const id = providerGameId(row.id);
    if (id === null || nextIds.has(id) || seenPriorIds.has(id)) continue;
    seenPriorIds.add(id);
    allGames.push({
      providerGameId: id,
      week: scheduleWeek(row.week),
      seasonType: seasonType(row.seasonType),
      startDate: boundedString(row.startDate),
      homeTeam: boundedString(row.homeTeam),
      awayTeam: boundedString(row.awayTeam),
    });
  }

  return {
    count: allGames.length,
    games: allGames.slice(0, MAX_VANISHED_GAMES_PER_EVENT),
    truncated: allGames.length > MAX_VANISHED_GAMES_PER_EVENT,
  };
}

/** Best-effort structured runtime event; observability can never fail the commit. */
export function emitScheduleGamesVanishedEvent(params: {
  year: number;
  observedAt: string;
  priorItems: readonly unknown[];
  nextItems: readonly unknown[];
}): void {
  try {
    const vanished = findVanishedScheduleGames(params.priorItems, params.nextItems);
    if (vanished.count === 0) return;
    console.log(
      JSON.stringify({
        event: 'schedule-games-vanished',
        year: params.year,
        observedAt: params.observedAt,
        vanishedGameCount: vanished.count,
        vanishedGames: vanished.games,
        truncated: vanished.truncated,
      })
    );
  } catch {
    // The durable schedule commit is authoritative; this signal is best effort.
  }
}
