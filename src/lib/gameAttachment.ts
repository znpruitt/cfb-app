import type { TeamIdentityResolver } from './teamIdentity.ts';

export type ScheduleAttachmentGame = {
  key: string;
  week: number;
  canHome: string;
  canAway: string;
  csvHome: string;
  csvAway: string;
  participants?: { home?: { kind?: string }; away?: { kind?: string } };
};

export type IndexedScheduleGame = { week: number; game: ScheduleAttachmentGame };

export function hasTeamParticipants(game: ScheduleAttachmentGame): boolean {
  return (
    (game.participants?.home?.kind ?? 'team') === 'team' &&
    (game.participants?.away?.kind ?? 'team') === 'team'
  );
}

function schedulePairKeys(
  game: ScheduleAttachmentGame,
  resolver: TeamIdentityResolver
): Set<string> {
  return new Set([
    resolver.buildPairKey(game.canHome, game.canAway),
    resolver.buildPairKey(game.csvHome, game.csvAway),
  ]);
}

// Canonical schedule attachment index shared by live score + odds joins.
export function buildSchedulePairIndex(params: {
  games: ScheduleAttachmentGame[];
  resolver: TeamIdentityResolver;
  includeGame?: (game: ScheduleAttachmentGame) => boolean;
}): Map<string, IndexedScheduleGame[]> {
  const { games, resolver, includeGame } = params;
  const index = new Map<string, IndexedScheduleGame[]>();

  for (const game of games) {
    if (!hasTeamParticipants(game) || !game.canHome || !game.canAway) continue;
    if (includeGame && !includeGame(game)) continue;

    for (const key of schedulePairKeys(game, resolver)) {
      const entries = index.get(key) ?? [];
      entries.push({ week: game.week, game });
      index.set(key, entries);
    }
  }

  return index;
}
