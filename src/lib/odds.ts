import { normWithAliases, type AliasMap, variants } from './teamNames';

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
};

type PreparedOddsEvent = {
  homeNorm: string;
  awayNorm: string;
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

export function buildOddsByGame(games: GameLike[], oddsEvents: OddsEvent[], aliasMap: AliasMap) {
  const next: Record<string, CombinedOdds> = {};

  const normalizedNameCache = new Map<string, string>();
  const normalizeName = (name: string): string => {
    const cached = normalizedNameCache.get(name);
    if (cached) return cached;
    const normalized = normWithAliases(name, aliasMap);
    normalizedNameCache.set(name, normalized);
    return normalized;
  };

  const variantsCache = new Map<string, string[]>();
  const variantsForName = (name: string): string[] => {
    const cached = variantsCache.get(name);
    if (cached) return cached;
    const computed = variants(name, aliasMap);
    variantsCache.set(name, computed);
    return computed;
  };

  const pairKey = (a: string, b: string) => [a, b].sort().join('__');

  const preparedEvents: PreparedOddsEvent[] = [];
  const exactPairIndex = new Map<string, PreparedOddsEvent[]>();

  for (const ev of oddsEvents) {
    const homeTeam = ev.home_team || '';
    const awayTeam = ev.away_team || '';
    const homeNorm = normalizeName(homeTeam);
    const awayNorm = normalizeName(awayTeam);
    const pKey = pairKey(homeNorm, awayNorm);

    const prepared: PreparedOddsEvent = {
      homeNorm,
      awayNorm,
      pairKey: pKey,
      homeTeam,
      awayTeam,
      book: pickPreferredBook(ev),
    };

    preparedEvents.push(prepared);
    const bucket = exactPairIndex.get(pKey) ?? [];
    bucket.push(prepared);
    exactPairIndex.set(pKey, bucket);
  }

  for (const g of games) {
    const homeNorm = normalizeName(g.canHome);
    const awayNorm = normalizeName(g.canAway);
    const homeVars = variantsForName(g.canHome);
    const awayVars = variantsForName(g.canAway);

    let match = exactPairIndex.get(pairKey(homeNorm, awayNorm))?.[0];

    if (!match) {
      match = preparedEvents.find((e) => {
        const startsEither =
          (homeVars.some((v) => e.homeNorm.startsWith(v)) &&
            awayVars.some((v) => e.awayNorm.startsWith(v))) ||
          (homeVars.some((v) => e.awayNorm.startsWith(v)) &&
            awayVars.some((v) => e.homeNorm.startsWith(v)));
        if (startsEither) return true;

        const containsEither =
          (homeVars.some((v) => e.homeNorm.includes(v)) &&
            awayVars.some((v) => e.awayNorm.includes(v))) ||
          (homeVars.some((v) => e.awayNorm.includes(v)) &&
            awayVars.some((v) => e.homeNorm.includes(v)));
        return containsEither;
      });
    }

    if (!match) continue;

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
      const matchHomeNorm = normalizeName(match.homeTeam);
      const matchAwayNorm = normalizeName(match.awayTeam);
      for (const o of h2h.outcomes) {
        const nm = normalizeName(o.name || '');
        if (nm === matchHomeNorm) mlHome = typeof o.price === 'number' ? o.price : null;
        if (nm === matchAwayNorm) mlAway = typeof o.price === 'number' ? o.price : null;
      }
    }

    if (spreads?.outcomes) {
      const matchHomeNorm = normalizeName(match.homeTeam);
      const matchAwayNorm = normalizeName(match.awayTeam);
      const hs = spreads.outcomes.find((o) => normalizeName(o.name || '') === matchHomeNorm);
      const as = spreads.outcomes.find((o) => normalizeName(o.name || '') === matchAwayNorm);
      const hPoint = typeof hs?.point === 'number' ? hs.point : null;
      const aPoint = typeof as?.point === 'number' ? as.point : null;
      if (hPoint != null && aPoint != null) {
        const hAbs = Math.abs(hPoint);
        const aAbs = Math.abs(aPoint);
        spread = hAbs <= aAbs ? hPoint : aPoint;
        favorite = hAbs < aAbs ? match.homeTeam || null : match.awayTeam || null;
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
