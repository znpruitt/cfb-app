import { attachOddsEventsToSchedule } from './oddsAttachment';
import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import type { AliasMap } from './teamNames';

export type OddsOutcome = { name?: string; price?: number; point?: number };
export type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
export type OddsBookmaker = { key?: string; title?: string; markets?: OddsMarket[] };
export type OddsEvent = {
  homeTeam?: string;
  awayTeam?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsBookmaker[];
};

export type CombinedOdds = {
  favorite: string | null;
  spread: number | null;
  total: number | null;
  mlHome: number | null;
  mlAway: number | null;
  source?: string | null;
};

type GameLike = {
  key: string;
  week: number;
  canHome: string;
  canAway: string;
  csvHome: string;
  csvAway: string;
  status?: string;
  participants?: { home?: { kind?: string }; away?: { kind?: string } };
};

type PreparedOddsEvent = {
  homeTeam: string;
  awayTeam: string;
  book: OddsBookmaker | undefined;
};

function pickPreferredBook(ev: OddsEvent): OddsBookmaker | undefined {
  const pref = ['draftkings', 'betmgm', 'caesars', 'fanduel', 'espnbet', 'pointsbet', 'bet365'];
  const books = ev.bookmakers ?? [];
  for (const want of pref) {
    const hit = books.find((b) => (b.key || '').toLowerCase() === want);
    if (hit) return hit;
  }
  return books[0];
}

function eventHomeTeam(ev: OddsEvent): string {
  return ev.homeTeam ?? ev.home_team ?? '';
}

function eventAwayTeam(ev: OddsEvent): string {
  return ev.awayTeam ?? ev.away_team ?? '';
}

function teamMatches(
  resolver: ReturnType<typeof createTeamIdentityResolver>,
  left: string,
  right: string
): boolean {
  const l = resolver.resolveName(left);
  const r = resolver.resolveName(right);
  return (l.identityKey ?? l.normalizedInput) === (r.identityKey ?? r.normalizedInput);
}

export function buildOddsByGame(params: {
  games: GameLike[];
  oddsEvents: OddsEvent[];
  aliasMap: AliasMap;
  teams: TeamCatalogItem[];
}) {
  const { games, oddsEvents, aliasMap, teams } = params;
  const next: Record<string, CombinedOdds> = {};

  const observedNames = Array.from(
    new Set(
      [
        ...games.flatMap((g) => [g.canHome, g.canAway]),
        ...oddsEvents.flatMap((ev) => [eventHomeTeam(ev), eventAwayTeam(ev)]),
      ].filter(Boolean)
    )
  );
  const resolver = createTeamIdentityResolver({ aliasMap, teams, observedNames });

  const preparedEvents: PreparedOddsEvent[] = oddsEvents.map((event) => ({
    homeTeam: eventHomeTeam(event),
    awayTeam: eventAwayTeam(event),
    book: pickPreferredBook(event),
  }));

  // Shared-lib attachment boundary: odds events are attached to schedule-derived games here.
  const attached = attachOddsEventsToSchedule({
    games,
    events: preparedEvents,
    resolver,
  });

  const gameByKey = new Map(games.map((game) => [game.key, game]));

  for (const match of attached) {
    const game = gameByKey.get(match.gameKey);
    if (!game) continue;

    const sourceTitle = match.event.book?.title || match.event.book?.key || null;
    const markets = match.event.book?.markets ?? [];
    const getMarket = (key: string): OddsMarket | undefined =>
      markets.find((m) => (m.key || '').toLowerCase() === key);

    const h2h = getMarket('h2h');
    const spreads = getMarket('spreads');
    const totals = getMarket('totals');

    let favorite: string | null = null;
    let spread: number | null = null;
    let total: number | null = null;
    let mlHome: number | null = null;
    let mlAway: number | null = null;

    if (h2h?.outcomes) {
      for (const o of h2h.outcomes) {
        const side = o.name || '';
        if (teamMatches(resolver, side, match.event.homeTeam)) {
          mlHome = typeof o.price === 'number' ? o.price : null;
        }
        if (teamMatches(resolver, side, match.event.awayTeam)) {
          mlAway = typeof o.price === 'number' ? o.price : null;
        }
      }
    }

    if (spreads?.outcomes) {
      const homeOutcome = spreads.outcomes.find((outcome) =>
        teamMatches(resolver, outcome.name || '', match.event.homeTeam)
      );
      const awayOutcome = spreads.outcomes.find((outcome) =>
        teamMatches(resolver, outcome.name || '', match.event.awayTeam)
      );

      const homePoint = typeof homeOutcome?.point === 'number' ? homeOutcome.point : null;
      const awayPoint = typeof awayOutcome?.point === 'number' ? awayOutcome.point : null;
      if (homePoint != null && awayPoint != null) {
        const homeAbs = Math.abs(homePoint);
        const awayAbs = Math.abs(awayPoint);
        spread = homeAbs <= awayAbs ? homePoint : awayPoint;
        favorite = homeAbs < awayAbs ? match.event.homeTeam || null : match.event.awayTeam || null;
      }
    }

    if (totals?.outcomes) {
      const over = totals.outcomes.find((o) => (o.name || '').toLowerCase().includes('over'));
      if (typeof over?.point === 'number') total = over.point;
    }

    next[game.key] = { favorite, spread, total, mlHome, mlAway, source: sourceTitle };
  }

  return next;
}
