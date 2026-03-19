import { buildSchedulePairIndex, type ScheduleAttachmentGame } from './gameAttachment.ts';
import type { TeamIdentityResolver } from './teamIdentity.ts';

export type OddsAttachmentEventBase = {
  homeTeam: string;
  awayTeam: string;
};

export type AttachedOddsEvent<TEvent extends OddsAttachmentEventBase> = {
  gameKey: string;
  event: TEvent;
};

function teamMatches(resolver: TeamIdentityResolver, left: string, right: string): boolean {
  const l = resolver.resolveName(left);
  const r = resolver.resolveName(right);
  return (l.identityKey ?? l.normalizedInput) === (r.identityKey ?? r.normalizedInput);
}

export function attachOddsEventsToSchedule<TEvent extends OddsAttachmentEventBase>(params: {
  games: ScheduleAttachmentGame[];
  events: TEvent[];
  resolver: TeamIdentityResolver;
}): AttachedOddsEvent<TEvent>[] {
  const { games, events, resolver } = params;

  const pairIndex = new Map<string, TEvent[]>();
  for (const event of events) {
    const key = resolver.buildPairKey(event.homeTeam, event.awayTeam);
    const bucket = pairIndex.get(key) ?? [];
    bucket.push(event);
    pairIndex.set(key, bucket);
  }

  const schedulePairIndex = buildSchedulePairIndex({ games, resolver });
  const attached: AttachedOddsEvent<TEvent>[] = [];

  for (const game of games) {
    const gamePairKey = resolver.buildPairKey(game.canHome, game.canAway);
    if (!schedulePairIndex.get(gamePairKey)?.length) continue;

    let match = pairIndex.get(gamePairKey)?.[0];

    if (!match) {
      const homeVariants = resolver.variantsForName(game.canHome);
      const awayVariants = resolver.variantsForName(game.canAway);

      match = events.find((event) => {
        const eventHome = resolver.variantsForName(event.homeTeam);
        const eventAway = resolver.variantsForName(event.awayTeam);

        const direct =
          homeVariants.some((v) => eventHome.includes(v)) &&
          awayVariants.some((v) => eventAway.includes(v));
        const swapped =
          homeVariants.some((v) => eventAway.includes(v)) &&
          awayVariants.some((v) => eventHome.includes(v));

        return direct || swapped;
      });
    }

    if (!match) continue;

    if (
      !(
        (teamMatches(resolver, game.canHome, match.homeTeam) &&
          teamMatches(resolver, game.canAway, match.awayTeam)) ||
        (teamMatches(resolver, game.canHome, match.awayTeam) &&
          teamMatches(resolver, game.canAway, match.homeTeam))
      )
    ) {
      continue;
    }

    attached.push({ gameKey: game.key, event: match });
  }

  return attached;
}
