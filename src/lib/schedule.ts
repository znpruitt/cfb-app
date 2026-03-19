import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity.ts';
import type { AliasMap } from './teamNames.ts';
import { isLikelyInvalidTeamLabel } from './teamNormalization.ts';
import { classifyScheduleRow } from './postseason-classify.ts';
import {
  resetConferenceClassificationRecords,
  setConferenceClassificationRecords,
  type CfbdConferenceRecord,
} from './conferenceSubdivision.ts';
import type { HydrationDiagnostic } from './postseason-hydrate.ts';
import {
  buildAuthoritativeGameCollection,
  buildConferenceChampionshipEventKey,
  buildPlaceholderParticipant,
  toPlaceholderDisplay,
} from './schedulePostseasonHelpers.ts';
import { buildByes, isTrackedGame, resolveRegularSeasonRow } from './scheduleTracking.ts';
import { isFbsTeam } from './scheduleEligibility.ts';
import {
  buildRegularSeasonWeekCalendar,
  deriveCanonicalRegularSeasonWeek,
  type WeekCorrectionReason,
} from './regularSeasonWeekCalendar.ts';

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';

export type ParticipantSlot =
  | {
      kind: 'team';
      teamId: string;
      displayName: string;
      canonicalName: string;
      rawName: string;
    }
  | {
      kind: 'placeholder';
      slotId: string;
      displayName: string;
      source?: string;
    }
  | {
      kind: 'derived';
      slotId: string;
      displayName: string;
      sourceEventId: string;
      derivation: 'winner' | 'loser';
    };

export type GameStage = 'regular' | 'conference_championship' | 'bowl' | 'playoff';
export type GameStatus = 'scheduled' | 'placeholder' | 'matchup_set' | 'in_progress' | 'final';
export type PostseasonRole =
  | 'conference_championship'
  | 'bowl'
  | 'playoff'
  | 'national_championship';

export type ScheduleFieldSources = {
  event?: string;
  participants?: string;
  kickoff?: string;
  venue?: string;
  scores?: string;
  odds?: string;
};

export type ScheduleWireItem = {
  id: string;
  week: number;
  providerWeek?: number;
  canonicalWeek?: number;
  weekCorrectionReason?: WeekCorrectionReason | null;
  startDate: string | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  homeTeam: string;
  awayTeam: string;
  homeConference: string;
  awayConference: string;
  status: string;
  venue?: string | null;
  label?: string | null;
  notes?: string | null;
  seasonType?: 'regular' | 'postseason' | string | null;
  gamePhase?: 'regular' | 'conference_championship' | 'postseason' | string | null;
  regularSubtype?: 'standard' | 'conference_championship' | string | null;
  postseasonSubtype?: 'bowl' | 'playoff' | string | null;
  playoffRound?: 'quarterfinal' | 'semifinal' | 'national_championship' | 'playoff' | string | null;
  bowlName?: string | null;
  conferenceChampionshipConference?: string | null;
  eventKey?: string | null;
  slotOrder?: number | null;
  neutralSiteDisplay?: 'vs' | 'home_away' | string | null;
};

export type ScheduleFetchMeta = {
  source?: string;
  cache?: 'hit' | 'miss';
  generatedAt?: string;
};

type ScheduleResponseWire = {
  items?: ScheduleWireItem[];
  meta?: ScheduleFetchMeta;
};

export type AppGame = {
  key: string;
  eventId: string;
  week: number;
  providerWeek: number;
  canonicalWeek: number;
  weekCorrectionReason?: WeekCorrectionReason | null;
  date: string | null;
  stage: GameStage;
  status: GameStatus;
  stageOrder: number;
  slotOrder: number;
  eventKey: string;
  label: string | null;
  conference: string | null;
  bowlName: string | null;
  playoffRound: string | null;
  postseasonRole: PostseasonRole | null;
  providerGameId: string | null;
  neutral: boolean;
  neutralDisplay: 'vs' | 'home_away';
  venue: string | null;
  isPlaceholder: boolean;
  sources?: ScheduleFieldSources;
  participants: {
    home: ParticipantSlot;
    away: ParticipantSlot;
  };
  csvAway: string;
  csvHome: string;
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
  hydrationDiagnostics: HydrationDiagnostic[];
};

function summarizeGames(label: string, games: AppGame[]): void {
  const weeks = Array.from(
    new Set(games.map((g) => g.week).filter((week) => Number.isFinite(week)))
  ).sort((a, b) => a - b);
  const regular = games.filter((g) => g.stage === 'regular' && !g.isPlaceholder).length;
  const placeholder = games.filter((g) => g.isPlaceholder).length;
  const postseasonReal = games.filter((g) => g.stage !== 'regular' && !g.isPlaceholder).length;

  console.log(label, {
    count: games.length,
    weeks,
    regular,
    placeholder,
    postseasonReal,
    sample: games.slice(0, 10).map((g) => ({
      key: g.key,
      week: g.week,
      away: g.csvAway ?? g.awayConf ?? g.canAway,
      home: g.csvHome ?? g.homeConf ?? g.canHome,
      isPostseasonPlaceholder: Boolean(g.isPlaceholder && g.stage !== 'regular'),
      postseason: g.stage !== 'regular',
    })),
  });
}

export async function fetchSeasonSchedule(
  season: number,
  options?: { bypassCache?: boolean }
): Promise<{
  items: ScheduleWireItem[];
  meta: ScheduleFetchMeta;
}> {
  const searchParams = new URLSearchParams({ year: String(season) });
  if (options?.bypassCache) searchParams.set('bypassCache', '1');

  const response = await fetch(`/api/schedule?${searchParams.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`schedule ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as ScheduleResponseWire;
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    meta: payload.meta ?? {},
  };
}

function stageOrder(stage: GameStage): number {
  if (stage === 'regular') return 1;
  if (stage === 'conference_championship') return 2;
  if (stage === 'bowl') return 3;
  return 4;
}

function mapStatus(rawStatus: string, isPlaceholder: boolean): GameStatus {
  const lower = (rawStatus || '').toLowerCase();
  if (lower.includes('final')) return 'final';
  if (lower.includes('progress') || lower.includes('live')) return 'in_progress';
  if (isPlaceholder) return 'placeholder';
  if (lower.includes('scheduled')) return 'scheduled';
  return 'matchup_set';
}

function sortGames(games: AppGame[]): AppGame[] {
  return [...games].sort((a, b) => {
    const dateCmp = (a.date ?? '').localeCompare(b.date ?? '');
    return (
      a.week - b.week ||
      a.stageOrder - b.stageOrder ||
      a.slotOrder - b.slotOrder ||
      dateCmp ||
      a.eventId.localeCompare(b.eventId)
    );
  });
}

export type {
  RegularSeasonEligibilityDecision,
  ScheduleEligibilityReason,
} from './scheduleEligibility.ts';
export {
  classifyTeamSubdivision,
  getRegularSeasonEligibilityDecision,
} from './scheduleEligibility.ts';

export function buildScheduleFromApi(params: {
  scheduleItems: ScheduleWireItem[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  observedNames?: string[];
  season: number;
  manualOverrides?: Record<string, Partial<AppGame>>;
  conferenceRecords?: CfbdConferenceRecord[];
}): BuiltSchedule {
  const { scheduleItems, teams, aliasMap, season } = params;

  if (params.conferenceRecords) {
    setConferenceClassificationRecords(params.conferenceRecords);
  } else {
    resetConferenceClassificationRecords();
  }
  const issues: string[] = [];
  const providerNames = Array.from(
    new Set(
      scheduleItems
        .flatMap((item) => [item.homeTeam, item.awayTeam])
        .filter((name) => !isLikelyInvalidTeamLabel(name))
    )
  );

  const resolver = createTeamIdentityResolver({
    teams,
    aliasMap,
    observedNames: [...providerNames, ...(params.observedNames ?? [])],
  });

  const canonicalTeamMetadataByName = new Map<string, TeamCatalogItem>();
  for (const team of teams) {
    const canonicalName = resolver.resolveName(team.school).canonicalName ?? team.school;
    canonicalTeamMetadataByName.set(canonicalName, team);
  }

  const apiRegularGames: AppGame[] = [];
  const apiPostseasonGames: AppGame[] = [];
  const regularSeasonWeekCalendar = buildRegularSeasonWeekCalendar(scheduleItems);

  for (const rawItem of scheduleItems) {
    const regularSeasonWeek = deriveCanonicalRegularSeasonWeek(rawItem, regularSeasonWeekCalendar);
    const item: ScheduleWireItem = {
      ...rawItem,
      providerWeek: regularSeasonWeek.providerWeek,
      canonicalWeek: regularSeasonWeek.canonicalWeek,
      weekCorrectionReason: regularSeasonWeek.weekCorrectionReason,
    };
    const canonicalWeek = item.canonicalWeek ?? item.week;
    const providerWeek = item.providerWeek ?? item.week;
    const hasConferenceChampionshipMetadata =
      item.seasonType !== 'postseason' &&
      (item.gamePhase === 'conference_championship' ||
        item.regularSubtype === 'conference_championship');
    if (hasConferenceChampionshipMetadata) {
      const eventKey = buildConferenceChampionshipEventKey(item);
      const eventId = `${season}-${eventKey}`;
      const homeParticipant = buildPlaceholderParticipant({
        resolver,
        raw: item.homeTeam,
        slotId: `${eventId}-home`,
        defaultDisplay: toPlaceholderDisplay(item.conferenceChampionshipConference),
      });
      const awayParticipant = buildPlaceholderParticipant({
        resolver,
        raw: item.awayTeam,
        slotId: `${eventId}-away`,
        defaultDisplay: toPlaceholderDisplay(item.conferenceChampionshipConference),
      });
      const hasKnownTeams = homeParticipant.kind === 'team' || awayParticipant.kind === 'team';

      apiRegularGames.push({
        key: eventId,
        eventId,
        week: canonicalWeek,
        providerWeek,
        canonicalWeek,
        weekCorrectionReason: item.weekCorrectionReason ?? null,
        date: item.startDate,
        stage: 'conference_championship',
        status: mapStatus(item.status, !hasKnownTeams),
        stageOrder: stageOrder('conference_championship'),
        slotOrder: item.slotOrder ?? 1,
        eventKey,
        label: item.label ?? `${item.conferenceChampionshipConference ?? ''} Championship`.trim(),
        conference: item.conferenceChampionshipConference ?? null,
        bowlName: null,
        playoffRound: null,
        postseasonRole: 'conference_championship',
        providerGameId: item.id,
        neutral: item.neutralSite,
        neutralDisplay:
          item.neutralSiteDisplay === 'vs' ? 'vs' : item.neutralSite ? 'vs' : 'home_away',
        venue: item.venue ?? null,
        isPlaceholder: !hasKnownTeams,
        sources: {
          event: 'cfbd-normalized',
          participants: hasKnownTeams ? 'cfbd+resolver' : 'cfbd-normalized',
          kickoff: 'cfbd',
          venue: 'cfbd',
        },
        participants: { home: homeParticipant, away: awayParticipant },
        csvAway:
          awayParticipant.kind === 'team' ? awayParticipant.rawName : awayParticipant.displayName,
        csvHome:
          homeParticipant.kind === 'team' ? homeParticipant.rawName : homeParticipant.displayName,
        canAway: awayParticipant.kind === 'team' ? awayParticipant.canonicalName : '',
        canHome: homeParticipant.kind === 'team' ? homeParticipant.canonicalName : '',
        awayConf: item.awayConference ?? '',
        homeConf: item.homeConference ?? '',
      });
      continue;
    }
    if (item.gamePhase === 'postseason') {
      const eventKey = item.eventKey?.trim() || `${item.week}-${item.id}`;
      const eventId = `${season}-${eventKey}`;
      const stage: GameStage = item.postseasonSubtype === 'playoff' ? 'playoff' : 'bowl';
      const conf = item.conferenceChampionshipConference ?? null;
      const homeParticipant = buildPlaceholderParticipant({
        resolver,
        raw: item.homeTeam,
        slotId: `${eventId}-home`,
        defaultDisplay: 'Team TBD',
      });
      const awayParticipant = buildPlaceholderParticipant({
        resolver,
        raw: item.awayTeam,
        slotId: `${eventId}-away`,
        defaultDisplay: 'Team TBD',
      });
      const hasKnownTeams = homeParticipant.kind === 'team' || awayParticipant.kind === 'team';

      apiPostseasonGames.push({
        key: eventId,
        eventId,
        week: canonicalWeek,
        providerWeek,
        canonicalWeek,
        weekCorrectionReason: item.weekCorrectionReason ?? null,
        date: item.startDate,
        stage,
        status: hasKnownTeams ? 'matchup_set' : 'placeholder',
        stageOrder: stageOrder(stage),
        slotOrder: item.slotOrder ?? 80,
        eventKey,
        label: item.label ?? item.bowlName ?? null,
        conference: conf,
        bowlName: item.bowlName ?? null,
        playoffRound: item.playoffRound ?? null,
        postseasonRole:
          stage === 'playoff'
            ? item.playoffRound === 'national_championship'
              ? 'national_championship'
              : 'playoff'
            : 'bowl',
        providerGameId: item.id,
        neutral: item.neutralSite,
        neutralDisplay: item.neutralSiteDisplay === 'home_away' ? 'home_away' : 'vs',
        venue: item.venue ?? null,
        isPlaceholder: !hasKnownTeams,
        sources: {
          event: 'cfbd-normalized',
          participants: hasKnownTeams ? 'cfbd+resolver' : 'cfbd-normalized',
          kickoff: 'cfbd',
          venue: 'cfbd',
        },
        participants: { home: homeParticipant, away: awayParticipant },
        csvAway:
          awayParticipant.kind === 'team' ? awayParticipant.rawName : awayParticipant.displayName,
        csvHome:
          homeParticipant.kind === 'team' ? homeParticipant.rawName : homeParticipant.displayName,
        canAway: awayParticipant.kind === 'team' ? awayParticipant.canonicalName : '',
        canHome: homeParticipant.kind === 'team' ? homeParticipant.canonicalName : '',
        awayConf: item.awayConference ?? '',
        homeConf: item.homeConference ?? '',
      });
      continue;
    }

    const classified = classifyScheduleRow(item, season);
    if (classified.kind === 'invalid_row') {
      issues.push(`invalid-schedule-row: ${classified.reason}`);
      continue;
    }

    if (classified.kind === 'out_of_scope_postseason') {
      issues.push(`out-of-scope-postseason-row: ${classified.reason}`);
      continue;
    }

    if (classified.kind === 'postseason_placeholder') {
      const id = classified.eventId;
      const conf = classified.conference ?? null;
      const homeParticipant = classified.homeDerivedFrom
        ? {
            kind: 'derived' as const,
            slotId: `${id}-home`,
            displayName: classified.homeDisplay,
            sourceEventId: classified.homeDerivedFrom,
            derivation: 'winner' as const,
          }
        : buildPlaceholderParticipant({
            resolver,
            raw: item.homeTeam,
            slotId: `${id}-home`,
            defaultDisplay: classified.homeDisplay || toPlaceholderDisplay(conf),
          });

      const awayParticipant = classified.awayDerivedFrom
        ? {
            kind: 'derived' as const,
            slotId: `${id}-away`,
            displayName: classified.awayDisplay,
            sourceEventId: classified.awayDerivedFrom,
            derivation: 'winner' as const,
          }
        : buildPlaceholderParticipant({
            resolver,
            raw: item.awayTeam,
            slotId: `${id}-away`,
            defaultDisplay: classified.awayDisplay || toPlaceholderDisplay(conf),
          });

      const hasKnownTeams = homeParticipant.kind === 'team' || awayParticipant.kind === 'team';

      apiPostseasonGames.push({
        key: id,
        eventId: id,
        week: canonicalWeek,
        providerWeek,
        canonicalWeek,
        weekCorrectionReason: item.weekCorrectionReason ?? null,
        date: item.startDate,
        stage: classified.stage,
        status: hasKnownTeams ? 'matchup_set' : 'placeholder',
        stageOrder: stageOrder(classified.stage),
        slotOrder: classified.slotOrder,
        eventKey: classified.eventKey,
        label: classified.label,
        conference: conf,
        bowlName: classified.bowlName ?? null,
        playoffRound: classified.playoffRound ?? null,
        postseasonRole:
          classified.postseasonRole ??
          (classified.stage === 'conference_championship'
            ? 'conference_championship'
            : classified.stage === 'playoff'
              ? 'playoff'
              : 'bowl'),
        providerGameId: item.id,
        neutral: item.neutralSite,
        neutralDisplay: item.neutralSiteDisplay === 'home_away' ? 'home_away' : 'vs',
        venue: item.venue ?? null,
        isPlaceholder: !hasKnownTeams,
        sources: {
          event: 'cfbd-label',
          participants: hasKnownTeams ? 'cfbd+resolver' : 'postseason-classifier',
          kickoff: 'cfbd',
          venue: 'cfbd',
        },
        participants: { home: homeParticipant, away: awayParticipant },
        csvAway:
          awayParticipant.kind === 'team' ? awayParticipant.rawName : awayParticipant.displayName,
        csvHome:
          homeParticipant.kind === 'team' ? homeParticipant.rawName : homeParticipant.displayName,
        canAway: awayParticipant.kind === 'team' ? awayParticipant.canonicalName : '',
        canHome: homeParticipant.kind === 'team' ? homeParticipant.canonicalName : '',
        awayConf: item.awayConference ?? '',
        homeConf: item.homeConference ?? '',
      });
      continue;
    }

    const rowResolution = resolveRegularSeasonRow({
      item,
      resolver,
      teamMetadataByCanonicalName: canonicalTeamMetadataByName,
    });
    if (!rowResolution.include) {
      continue;
    }

    const { homeResolved, awayResolved } = rowResolution;
    if (rowResolution.emitIdentityIssue) {
      issues.push(`identity-unresolved: ${item.homeTeam} vs ${item.awayTeam}`);
    }

    const canHome = homeResolved.canonicalName ?? item.homeTeam;
    const canAway = awayResolved.canonicalName ?? item.awayTeam;
    const key = resolver.buildGameKey({
      week: canonicalWeek,
      home: canHome,
      away: canAway,
      neutral: item.neutralSite,
    });

    const homeConf = item.homeConference ?? '';
    const awayConf = item.awayConference ?? '';

    apiRegularGames.push({
      key,
      eventId: key,
      week: canonicalWeek,
      providerWeek,
      canonicalWeek,
      weekCorrectionReason: item.weekCorrectionReason ?? null,
      date: item.startDate,
      stage: 'regular',
      status: mapStatus(item.status, false),
      stageOrder: stageOrder('regular'),
      slotOrder: 0,
      eventKey: key,
      label: null,
      conference: null,
      bowlName: null,
      playoffRound: null,
      postseasonRole: null,
      providerGameId: item.id,
      neutral: item.neutralSite,
      neutralDisplay:
        item.neutralSiteDisplay === 'vs' ? 'vs' : item.neutralSite ? 'vs' : 'home_away',
      venue: item.venue ?? null,
      isPlaceholder: false,
      sources: { event: 'cfbd', participants: 'cfbd+resolver', kickoff: 'cfbd', venue: 'cfbd' },
      participants: {
        home: {
          kind: 'team',
          teamId: homeResolved.identityKey ?? canHome,
          displayName: canHome,
          canonicalName: canHome,
          rawName: item.homeTeam,
        },
        away: {
          kind: 'team',
          teamId: awayResolved.identityKey ?? canAway,
          displayName: canAway,
          canonicalName: canAway,
          rawName: item.awayTeam,
        },
      },
      csvAway: item.awayTeam,
      csvHome: item.homeTeam,
      canAway,
      canHome,
      awayConf,
      homeConf,
    });
  }

  const mergedGames = buildAuthoritativeGameCollection(
    apiRegularGames,
    apiPostseasonGames,
    params.manualOverrides
  );

  if (IS_DEBUG) {
    summarizeGames('raw normalized apiGames', [...apiRegularGames, ...apiPostseasonGames]);
    summarizeGames('combinedGames', mergedGames);
  }

  const trackedGames = mergedGames.filter((game) =>
    isTrackedGame(game, canonicalTeamMetadataByName, resolver)
  );

  const conferenceSet = new Set<string>();
  for (const game of trackedGames) {
    if (game.awayConf) conferenceSet.add(game.awayConf);
    if (game.homeConf) conferenceSet.add(game.homeConf);
  }

  const trackedFbsTeams = Array.from(
    new Set(
      teams
        .map((team) => resolver.resolveName(team.school).canonicalName ?? team.school)
        .filter((name) => isFbsTeam(name, canonicalTeamMetadataByName, resolver))
    )
  );

  const games = sortGames(trackedGames);
  const weeks = Array.from(
    new Set(games.map((g) => g.week).filter((week) => Number.isFinite(week)))
  ).sort((a, b) => a - b);
  const byes = buildByes(games, trackedFbsTeams, canonicalTeamMetadataByName, resolver);

  if (IS_DEBUG) {
    const regularSeasonGames = games.filter((g) => g.stage === 'regular' && !g.isPlaceholder);
    const numericWeeks = games.map((g) => g.week).filter((week) => Number.isFinite(week));

    if (regularSeasonGames.length === 0) {
      console.error('BUG: no regular-season games survived load pipeline', {
        combinedCount: games.length,
        weeks: Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b),
      });
    }

    console.log('week range', {
      min: numericWeeks.length ? Math.min(...numericWeeks) : null,
      max: numericWeeks.length ? Math.max(...numericWeeks) : null,
    });
    summarizeGames('displayGames', games);

    console.log('combinedWeeks', weeks);

    console.log('conferenceCount', conferenceSet.size);
  }

  return {
    games,
    weeks,
    byes,
    conferences: ['ALL', ...Array.from(conferenceSet).sort((a, b) => a.localeCompare(b))],
    issues,
    hydrationDiagnostics: [] as HydrationDiagnostic[],
  };
}
