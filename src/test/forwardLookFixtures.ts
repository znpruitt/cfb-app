import type { CombinedOdds } from '../lib/odds.ts';
import type { WeeklyRecapContext } from '../lib/recap/loadRecapContext.ts';
import type { AppGame } from '../lib/schedule.ts';
import type { ScorePack } from '../lib/scores.ts';
import type { SeasonArchive } from '../lib/seasonArchive.ts';

export const FORWARD_NOW = new Date('2026-10-08T10:00:00Z');
export const FORWARD_SCOPE = {
  seasonYear: 2026,
  leagueStatus: { state: 'season', year: 2026 } as const,
};

export function forwardGame(
  key: string,
  week = 6,
  date = '2026-10-10T19:00:00Z',
  home = 'Texas',
  away = 'Georgia'
): AppGame {
  const participant = (name: string) => ({
    kind: 'team' as const,
    teamId: name,
    displayName: name,
    canonicalName: name,
    rawName: name,
  });
  return {
    key,
    eventId: key,
    eventKey: key,
    week,
    canonicalWeek: week,
    providerWeek: week,
    stage: 'regular',
    stageOrder: 1,
    slotOrder: 0,
    date,
    status: 'scheduled',
    rawStatus: 'scheduled',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: key,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: { home: participant(home), away: participant(away) },
    csvHome: home,
    csvAway: away,
    canHome: home,
    canAway: away,
    homeConf: 'SEC',
    awayConf: 'SEC',
  };
}

export function forwardScore(home = 21, away = 14): ScorePack {
  return {
    status: 'final',
    time: null,
    home: { team: 'Texas', score: home },
    away: { team: 'Georgia', score: away },
  };
}

export function forwardOdds(capturedAt = '2026-10-08T09:00:00Z'): CombinedOdds {
  return {
    favorite: 'Georgia',
    spread: -3,
    homeSpread: 3,
    awaySpread: -3,
    capturedAt,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 50,
    mlHome: 120,
    mlAway: -140,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    lineSourceStatus: 'latest',
  };
}

export function forwardContext(): WeeklyRecapContext {
  return {
    seasonYear: 2026,
    games: [forwardGame('prior', 5, '2026-10-03T19:00:00Z'), forwardGame('collision')],
    rosterByTeam: new Map([
      ['Texas', 'Alice'],
      ['Georgia', 'Bob'],
    ]),
    scoresByKey: { prior: forwardScore() },
    odds: { status: 'available', byGameKey: { collision: forwardOdds() } },
    records: { status: 'available', archives: [], historicalRosters: {} },
  };
}

export function addRivalry(
  context: WeeklyRecapContext,
  winners: ('Alice' | 'Bob')[]
): SeasonArchive {
  const games = winners.map((_, i) =>
    forwardGame(`history-${i}`, i + 1, new Date(Date.UTC(2025, 7, 30 + i * 7, 19)).toISOString())
  );
  const archive: SeasonArchive = {
    leagueSlug: 'tsc',
    year: 2025,
    archivedAt: '2026-01-20T00:00:00Z',
    ownerRosterSnapshot: 'team,owner\nTexas,Alice\nGeorgia,Bob\n',
    games,
    scoresByKey: Object.fromEntries(
      games.map((game, i) => [game.key, forwardScore(winners[i] === 'Alice' ? 21 : 7)])
    ),
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
  };
  context.records = {
    status: 'available',
    archives: [archive],
    historicalRosters: { 2025: new Map(context.rosterByTeam) },
  };
  return archive;
}
