import type { AliasMap } from './teamNames';
import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';

export type ScheduleWireItem = {
  id: string;
  week: number;
  startDate: string | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  homeTeam: string;
  awayTeam: string;
  homeConference: string;
  awayConference: string;
  status: string;
};

export type AppGame = {
  key: string;
  week: number;
  csvAway: string;
  csvHome: string;
  neutral: boolean;
  canAway: string;
  canHome: string;
  awayConf: string;
  homeConf: string;
};

export type BuiltSchedule = {
  games: AppGame[];
  weeks: number[];
  byes: Record<number, string[]>;
  conferences: string[];
};

export async function fetchSeasonSchedule(season: number): Promise<ScheduleWireItem[]> {
  const response = await fetch(`/api/schedule?year=${season}`, { cache: 'no-store' });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`schedule ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as { items?: ScheduleWireItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

// API-first schedule builder: CFBD defines the game universe; local aliases/catalog normalize identity.
export function buildScheduleFromApi(params: {
  scheduleItems: ScheduleWireItem[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
}): BuiltSchedule {
  const { scheduleItems, teams, aliasMap } = params;
  const resolver = createTeamIdentityResolver({ teams, aliasMap });

  const games: AppGame[] = [];
  const allTeamNames = new Set<string>();
  const weekParticipants = new Map<number, Set<string>>();
  const conferenceSet = new Set<string>();

  for (const item of scheduleItems) {
    allTeamNames.add(item.homeTeam);
    allTeamNames.add(item.awayTeam);

    const homeResolved = resolver.resolveName(item.homeTeam);
    const awayResolved = resolver.resolveName(item.awayTeam);

    const canHome = homeResolved.canonicalName ?? item.homeTeam;
    const canAway = awayResolved.canonicalName ?? item.awayTeam;

    const key = resolver.buildGameKey({
      week: item.week,
      home: canHome,
      away: canAway,
      neutral: item.neutralSite,
    });

    const homeConf = item.homeConference ?? '';
    const awayConf = item.awayConference ?? '';
    if (homeConf) conferenceSet.add(homeConf);
    if (awayConf) conferenceSet.add(awayConf);

    const weekSet = weekParticipants.get(item.week) ?? new Set<string>();
    weekSet.add(canHome);
    weekSet.add(canAway);
    weekParticipants.set(item.week, weekSet);

    games.push({
      key,
      week: item.week,
      csvAway: item.awayTeam,
      csvHome: item.homeTeam,
      neutral: item.neutralSite,
      canAway,
      canHome,
      awayConf,
      homeConf,
    });
  }

  const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b);
  const allCanonicalTeams = Array.from(allTeamNames).map((name) => resolver.resolveName(name).canonicalName ?? name);

  const byes: Record<number, string[]> = {};
  for (const week of weeks) {
    const participants = weekParticipants.get(week) ?? new Set<string>();
    byes[week] = allCanonicalTeams
      .filter((team) => !participants.has(team))
      .sort((a, b) => a.localeCompare(b));
  }

  return {
    games,
    weeks,
    byes,
    conferences: ['ALL', ...Array.from(conferenceSet).sort((a, b) => a.localeCompare(b))],
  };
}
