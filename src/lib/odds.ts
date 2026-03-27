import { attachOddsEventsToSchedule } from './oddsAttachment.ts';
import {
  areTeamNamesEquivalent,
  createTeamIdentityResolver,
  type TeamCatalogItem,
  type TeamIdentityResolver,
} from './teamIdentity.ts';
import type { AliasMap } from './teamNames.ts';
import type { AppGame } from './schedule.ts';

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

export type OddsLineSourceStatus = 'latest' | 'closing' | 'fallback-latest-for-completed';

export type DurableOddsSnapshot = {
  capturedAt: string;
  bookmakerKey: string;
  favorite: string | null;
  source: string | null;
  spread: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  spreadPriceHome: number | null;
  spreadPriceAway: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
};

export type DurableOddsRecord = {
  canonicalGameId: string;
  latestSnapshot: DurableOddsSnapshot | null;
  closingSnapshot: DurableOddsSnapshot | null;
  closingFrozenAt: string | null;
};

export type CombinedOdds = {
  favorite: string | null;
  spread: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  spreadPriceHome: number | null;
  spreadPriceAway: number | null;
  total: number | null;
  mlHome: number | null;
  mlAway: number | null;
  overPrice: number | null;
  underPrice: number | null;
  source: string | null;
  bookmakerKey: string | null;
  capturedAt: string | null;
  lineSourceStatus: OddsLineSourceStatus;
};

export type CanonicalOddsItem = {
  canonicalGameId: string;
  odds: CombinedOdds;
};

type GameLike = {
  key: string;
  week: number;
  canHome: string;
  canAway: string;
  csvHome: string;
  csvAway: string;
  status?: string;
  date?: string | null;
  participants?: { home?: { kind?: string }; away?: { kind?: string } };
};

type PreparedOddsEvent = {
  homeTeam: string;
  awayTeam: string;
  book: OddsBookmaker | undefined;
};

function eventHomeTeam(ev: OddsEvent): string {
  return ev.homeTeam ?? ev.home_team ?? '';
}

function eventAwayTeam(ev: OddsEvent): string {
  return ev.awayTeam ?? ev.away_team ?? '';
}

export function pickPreferredBook(ev: OddsEvent): OddsBookmaker | undefined {
  const pref = ['draftkings', 'betmgm', 'caesars', 'fanduel', 'espnbet', 'pointsbet', 'bet365'];
  const books = ev.bookmakers ?? [];
  for (const want of pref) {
    const hit = books.find((b) => (b.key || '').toLowerCase() === want);
    if (hit) return hit;
  }
  return books[0];
}

export function emptyDurableOddsRecord(canonicalGameId: string): DurableOddsRecord {
  return {
    canonicalGameId,
    latestSnapshot: null,
    closingSnapshot: null,
    closingFrozenAt: null,
  };
}

function parseGameKickoffMs(kickoff: string | null | undefined): number | null {
  if (!kickoff) return null;
  const parsed = new Date(kickoff).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isAtOrPastKickoff(
  kickoff: string | null | undefined,
  now: string | Date = new Date()
): boolean {
  const kickoffMs = parseGameKickoffMs(kickoff);
  if (kickoffMs == null) return false;

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return false;

  return nowMs >= kickoffMs;
}

function isCompletedGame(game: Pick<AppGame, 'status'>): boolean {
  return game.status === 'final';
}

function snapshotFromStored(
  snapshot: DurableOddsSnapshot,
  lineSourceStatus: OddsLineSourceStatus
): CombinedOdds {
  return {
    favorite: snapshot.favorite,
    spread: snapshot.spread,
    homeSpread: snapshot.homeSpread,
    awaySpread: snapshot.awaySpread,
    spreadPriceHome: snapshot.spreadPriceHome,
    spreadPriceAway: snapshot.spreadPriceAway,
    total: snapshot.total,
    mlHome: snapshot.moneylineHome,
    mlAway: snapshot.moneylineAway,
    overPrice: snapshot.overPrice,
    underPrice: snapshot.underPrice,
    source: snapshot.source,
    bookmakerKey: snapshot.bookmakerKey,
    capturedAt: snapshot.capturedAt,
    lineSourceStatus,
  };
}

export function reopenClosingSnapshotForDelayedKickoffIfNeeded(params: {
  record: DurableOddsRecord;
  kickoff: string | null | undefined;
  now?: string | Date;
}): DurableOddsRecord {
  const { record, kickoff, now = new Date() } = params;

  if (!record.closingSnapshot) return record;

  const kickoffMs = parseGameKickoffMs(kickoff);
  if (kickoffMs == null) return record;

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs) || nowMs >= kickoffMs) return record;

  const closingCapturedMs = new Date(record.closingSnapshot.capturedAt).getTime();
  if (!Number.isFinite(closingCapturedMs) || closingCapturedMs >= kickoffMs) return record;

  return {
    ...record,
    latestSnapshot: record.latestSnapshot ?? record.closingSnapshot,
    closingSnapshot: null,
    closingFrozenAt: null,
  };
}

export function freezeClosingSnapshotIfNeeded(params: {
  record: DurableOddsRecord;
  kickoff: string | null | undefined;
  now?: string | Date;
}): DurableOddsRecord {
  const { record, kickoff, now = new Date() } = params;

  if (record.closingSnapshot) return record;
  if (!record.latestSnapshot) return record;
  if (!isAtOrPastKickoff(kickoff, now)) return record;

  const kickoffMs = parseGameKickoffMs(kickoff);
  const latestCapturedMs = new Date(record.latestSnapshot.capturedAt).getTime();

  if (kickoffMs != null && Number.isFinite(latestCapturedMs) && latestCapturedMs > kickoffMs) {
    return record;
  }

  const frozenAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  return {
    ...record,
    closingSnapshot: record.latestSnapshot,
    closingFrozenAt: frozenAt,
  };
}

export function applyPregameOddsSnapshot(params: {
  record: DurableOddsRecord;
  snapshot: DurableOddsSnapshot;
  kickoff: string | null | undefined;
  now?: string | Date;
}): DurableOddsRecord {
  const { record, snapshot, kickoff, now = new Date() } = params;

  if (isAtOrPastKickoff(kickoff, now)) {
    return freezeClosingSnapshotIfNeeded({ record, kickoff, now });
  }

  return {
    ...record,
    latestSnapshot: snapshot,
  };
}

export function selectOddsForGame(params: {
  game: Pick<AppGame, 'status' | 'date'>;
  record: DurableOddsRecord | null | undefined;
  now?: string | Date;
}): CombinedOdds | null {
  const { game, record, now = new Date() } = params;
  if (!record) return null;

  const completed = isCompletedGame(game);
  const started = isAtOrPastKickoff(game.date, now);

  if ((completed || started) && record.closingSnapshot) {
    return snapshotFromStored(record.closingSnapshot, 'closing');
  }

  if (completed && record.latestSnapshot) {
    return snapshotFromStored(record.latestSnapshot, 'fallback-latest-for-completed');
  }

  if (record.latestSnapshot) {
    return snapshotFromStored(record.latestSnapshot, 'latest');
  }

  return null;
}

export function buildOddsLookup(items: CanonicalOddsItem[]): Record<string, CombinedOdds> {
  return items.reduce<Record<string, CombinedOdds>>((acc, item) => {
    if (item?.canonicalGameId && item.odds) {
      acc[item.canonicalGameId] = item.odds;
    }
    return acc;
  }, {});
}

export function buildDurableOddsSnapshot(params: {
  game: Pick<GameLike, 'canHome' | 'canAway'>;
  event: PreparedOddsEvent;
  resolver: TeamIdentityResolver;
  capturedAt?: string;
}): DurableOddsSnapshot | null {
  const { game, event, resolver, capturedAt = new Date().toISOString() } = params;
  const book = event.book;
  if (!book) return null;

  const markets = book.markets ?? [];
  const getMarket = (key: string): OddsMarket | undefined =>
    markets.find((m) => (m.key || '').toLowerCase() === key);

  const h2h = getMarket('h2h');
  const spreads = getMarket('spreads');
  const totals = getMarket('totals');

  let favorite: string | null = null;
  let spread: number | null = null;
  let homeSpread: number | null = null;
  let awaySpread: number | null = null;
  let spreadPriceHome: number | null = null;
  let spreadPriceAway: number | null = null;
  let moneylineHome: number | null = null;
  let moneylineAway: number | null = null;
  let total: number | null = null;
  let overPrice: number | null = null;
  let underPrice: number | null = null;

  if (h2h?.outcomes) {
    for (const outcome of h2h.outcomes) {
      const side = outcome.name || '';
      if (areTeamNamesEquivalent(resolver, side, game.canHome)) {
        moneylineHome = typeof outcome.price === 'number' ? outcome.price : null;
      }
      if (areTeamNamesEquivalent(resolver, side, game.canAway)) {
        moneylineAway = typeof outcome.price === 'number' ? outcome.price : null;
      }
    }
  }

  if (spreads?.outcomes) {
    const homeOutcome = spreads.outcomes.find((outcome) =>
      areTeamNamesEquivalent(resolver, outcome.name || '', game.canHome)
    );
    const awayOutcome = spreads.outcomes.find((outcome) =>
      areTeamNamesEquivalent(resolver, outcome.name || '', game.canAway)
    );

    homeSpread = typeof homeOutcome?.point === 'number' ? homeOutcome.point : null;
    awaySpread = typeof awayOutcome?.point === 'number' ? awayOutcome.point : null;
    spreadPriceHome = typeof homeOutcome?.price === 'number' ? homeOutcome.price : null;
    spreadPriceAway = typeof awayOutcome?.price === 'number' ? awayOutcome.price : null;

    if (homeSpread != null && awaySpread != null) {
      const homeAbs = Math.abs(homeSpread);
      const awayAbs = Math.abs(awaySpread);
      if (homeAbs <= awayAbs) {
        spread = homeSpread;
        favorite = homeAbs < awayAbs ? game.canHome : game.canAway;
      } else {
        spread = awaySpread;
        favorite = awayAbs < homeAbs ? game.canAway : game.canHome;
      }
    }
  }

  if (totals?.outcomes) {
    const over = totals.outcomes.find((o) => (o.name || '').toLowerCase().includes('over'));
    const under = totals.outcomes.find((o) => (o.name || '').toLowerCase().includes('under'));
    total =
      typeof over?.point === 'number'
        ? over.point
        : typeof under?.point === 'number'
          ? under.point
          : null;
    overPrice = typeof over?.price === 'number' ? over.price : null;
    underPrice = typeof under?.price === 'number' ? under.price : null;
  }

  return {
    capturedAt,
    bookmakerKey: book.key?.trim() || 'unknown',
    favorite,
    source: book.title?.trim() || book.key?.trim() || null,
    spread,
    homeSpread,
    awaySpread,
    spreadPriceHome,
    spreadPriceAway,
    moneylineHome,
    moneylineAway,
    total,
    overPrice,
    underPrice,
  };
}

/**
 * Legacy helper retained for compatibility with older tests/callers.
 * New route consumption should prefer durable canonical odds selection.
 */
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

  const attached = attachOddsEventsToSchedule({
    games,
    events: preparedEvents,
    resolver,
  });

  const gameByKey = new Map(games.map((game) => [game.key, game]));

  for (const match of attached) {
    const game = gameByKey.get(match.gameKey);
    if (!game) continue;

    const snapshot = buildDurableOddsSnapshot({
      game,
      event: match.event,
      resolver,
      capturedAt: new Date().toISOString(),
    });
    if (!snapshot) continue;

    next[game.key] = snapshotFromStored(snapshot, 'latest');
  }

  return next;
}
