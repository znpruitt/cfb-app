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

  for (const g of games) {
    const ghVars = variants(g.canHome, aliasMap);
    const gaVars = variants(g.canAway, aliasMap);
    const gh = normWithAliases(g.canHome, aliasMap);
    const ga = normWithAliases(g.canAway, aliasMap);

    const match = oddsEvents.find((e) => {
      const eh = normWithAliases(e.home_team || '', aliasMap);
      const ea = normWithAliases(e.away_team || '', aliasMap);
      if ((eh === gh && ea === ga) || (eh === ga && ea === gh)) return true;
      const startsEither =
        (ghVars.some((v) => eh.startsWith(v)) && gaVars.some((v) => ea.startsWith(v))) ||
        (ghVars.some((v) => ea.startsWith(v)) && gaVars.some((v) => eh.startsWith(v)));
      if (startsEither) return true;
      const containsEither =
        (ghVars.some((v) => eh.includes(v)) && gaVars.some((v) => ea.includes(v))) ||
        (ghVars.some((v) => ea.includes(v)) && gaVars.some((v) => eh.includes(v)));
      return containsEither;
    });

    if (!match) continue;

    const book = pickPreferredBook(match);
    const sourceTitle = book?.title || book?.key || null;
    const markets = book?.markets ?? [];
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
        const nm = normWithAliases(o.name || '', aliasMap);
        if (nm === normWithAliases(match.home_team || '', aliasMap))
          mlHome = typeof o.price === 'number' ? o.price : null;
        if (nm === normWithAliases(match.away_team || '', aliasMap))
          mlAway = typeof o.price === 'number' ? o.price : null;
      }
    }

    if (spreads?.outcomes) {
      const hs = spreads.outcomes.find(
        (o) =>
          normWithAliases(o.name || '', aliasMap) ===
          normWithAliases(match.home_team || '', aliasMap)
      );
      const as = spreads.outcomes.find(
        (o) =>
          normWithAliases(o.name || '', aliasMap) ===
          normWithAliases(match.away_team || '', aliasMap)
      );
      const hPoint = typeof hs?.point === 'number' ? hs.point : null;
      const aPoint = typeof as?.point === 'number' ? as.point : null;
      if (hPoint != null && aPoint != null) {
        const hAbs = Math.abs(hPoint);
        const aAbs = Math.abs(aPoint);
        spread = hAbs <= aAbs ? hPoint : aPoint;
        favorite = hAbs < aAbs ? match.home_team || null : match.away_team || null;
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
