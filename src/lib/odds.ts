import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import type { AliasMap } from './teamNames';

export type OddsOutcome = { name?: string; price?: number; point?: number };
export type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
export type OddsBookmaker = { key?: string; title?: string; markets?: OddsMarket[] };
export type OddsEvent = { home_team?: string; away_team?: string; bookmakers?: OddsBookmaker[] };

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
  canHome: string;
  canAway: string;
  status?: string;
  participants?: { home?: { kind?: string }; away?: { kind?: string } };
};

type PreparedOddsEvent = {
  pairKey: string;
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
        ...oddsEvents.flatMap((ev) => [ev.home_team ?? '', ev.away_team ?? '']),
      ].filter(Boolean)
    )
  );
  const resolver = createTeamIdentityResolver({ aliasMap, teams, observedNames });
  const preparedEvents: PreparedOddsEvent[] = [];
  const pairIndex = new Map<string, PreparedOddsEvent[]>();

  for (const ev of oddsEvents) {
    const homeTeam = ev.home_team || '';
    const awayTeam = ev.away_team || '';
    const key = resolver.buildPairKey(homeTeam, awayTeam);

    const prepared: PreparedOddsEvent = {
      pairKey: key,
      homeTeam,
      awayTeam,
      book: pickPreferredBook(ev),
    };

    preparedEvents.push(prepared);
    const bucket = pairIndex.get(key) ?? [];
    bucket.push(prepared);
    pairIndex.set(key, bucket);
  }

  for (const g of games) {
    const hasTeamParticipants =
      (g.participants?.home?.kind ?? 'team') === 'team' &&
      (g.participants?.away?.kind ?? 'team') === 'team';
    if (!hasTeamParticipants || !g.canHome || !g.canAway) continue;
    const gamePairKey = resolver.buildPairKey(g.canHome, g.canAway);
    let match = pairIndex.get(gamePairKey)?.[0];

    if (!match) {
      const homeVariants = resolver.variantsForName(g.canHome);
      const awayVariants = resolver.variantsForName(g.canAway);

      match = preparedEvents.find((event) => {
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

    const teamMatches = (left: string, right: string): boolean => {
      const l = resolver.resolveName(left);
      const r = resolver.resolveName(right);
      return (l.identityKey ?? l.normalizedInput) === (r.identityKey ?? r.normalizedInput);
    };

    const sourceTitle = match.book?.title || match.book?.key || null;
    const markets = match.book?.markets ?? [];
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
        if (teamMatches(side, match.homeTeam))
          mlHome = typeof o.price === 'number' ? o.price : null;
        if (teamMatches(side, match.awayTeam))
          mlAway = typeof o.price === 'number' ? o.price : null;
      }
    }

    if (spreads?.outcomes) {
      const homeOutcome = spreads.outcomes.find((outcome) =>
        teamMatches(outcome.name || '', match.homeTeam)
      );
      const awayOutcome = spreads.outcomes.find((outcome) =>
        teamMatches(outcome.name || '', match.awayTeam)
      );

      const homePoint = typeof homeOutcome?.point === 'number' ? homeOutcome.point : null;
      const awayPoint = typeof awayOutcome?.point === 'number' ? awayOutcome.point : null;
      if (homePoint != null && awayPoint != null) {
        const homeAbs = Math.abs(homePoint);
        const awayAbs = Math.abs(awayPoint);
        spread = homeAbs <= awayAbs ? homePoint : awayPoint;
        favorite = homeAbs < awayAbs ? match.homeTeam || null : match.awayTeam || null;
      }
    }

    if (totals?.outcomes) {
      const over = totals.outcomes.find((o) => (o.name || '').toLowerCase().includes('over'));
      if (typeof over?.point === 'number') total = over.point;
    }

    next[g.key] = { favorite, spread, total, mlHome, mlAway, source: sourceTitle };
  }

  return next;
}
