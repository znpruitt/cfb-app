import type { AliasMap } from './teamNames';
import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import { isLikelyInvalidTeamLabel } from './teamNormalization';

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
  issues: string[];
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

export function buildScheduleFromApi(params: {
  scheduleItems: ScheduleWireItem[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  observedNames?: string[];
}): BuiltSchedule {
  const { scheduleItems, teams, aliasMap } = params;
  const issues: string[] = [];
  const providerNames = Array.from(
    new Set(scheduleItems.flatMap((item) => [item.homeTeam, item.awayTeam]).filter((name) => !isLikelyInvalidTeamLabel(name)))
  );

  const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames: [...providerNames, ...(params.observedNames ?? [])] });

  const games: AppGame[] = [];
  const allTeamNames = new Set<string>();
  const weekParticipants = new Map<number, Set<string>>();
  const conferenceSet = new Set<string>();

  for (const item of scheduleItems) {
    if (isLikelyInvalidTeamLabel(item.homeTeam) || isLikelyInvalidTeamLabel(item.awayTeam)) {
      issues.push(`invalid-schedule-row: ${item.homeTeam} vs ${item.awayTeam}`);
      continue;
    }

    const homeResolved = resolver.resolveName(item.homeTeam);
    const awayResolved = resolver.resolveName(item.awayTeam);
    if (homeResolved.status !== 'resolved' || awayResolved.status !== 'resolved') {
      issues.push(`identity-unresolved: ${item.homeTeam} vs ${item.awayTeam}`);
      continue;
    }

    const keepGame = homeResolved.subdivision === 'FBS' || awayResolved.subdivision === 'FBS';
    if (!keepGame) continue;

    const canHome = homeResolved.canonicalName ?? item.homeTeam;
    const canAway = awayResolved.canonicalName ?? item.awayTeam;
    allTeamNames.add(canHome);
    allTeamNames.add(canAway);

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
  const allCanonicalTeams = Array.from(allTeamNames);

  const byes: Record<number, string[]> = {};
  for (const week of weeks) {
    const participants = weekParticipants.get(week) ?? new Set<string>();
    byes[week] = allCanonicalTeams.filter((team) => !participants.has(team)).sort((a, b) => a.localeCompare(b));
  }

  return {
    games,
    weeks,
    byes,
    conferences: ['ALL', ...Array.from(conferenceSet).sort((a, b) => a.localeCompare(b))],
    issues,
  };
}
