import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import type { AliasMap } from './teamNames';
import { isLikelyInvalidTeamLabel } from './teamNormalization';
import { buildPostseasonTemplate, type TemplateEvent } from './postseason-template';
import { classifyScheduleRow } from './postseason-classify';
import { hydrateEvents, type HydrationDiagnostic } from './postseason-hydrate';

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
};

export type AppGame = {
  key: string;
  eventId: string;
  week: number;
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
  providerGameId: string | null;
  neutral: boolean;
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

export async function fetchSeasonSchedule(season: number): Promise<ScheduleWireItem[]> {
  const response = await fetch(`/api/schedule?year=${season}`, { cache: 'no-store' });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`schedule ${response.status} ${detail}`);
  }

  const payload = (await response.json()) as { items?: ScheduleWireItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
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

function buildByes(games: AppGame[]): Record<number, string[]> {
  const byes: Record<number, string[]> = {};
  const allCanonicalTeams = Array.from(new Set(games.flatMap((g) => [g.canHome, g.canAway]).filter(Boolean)));
  const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b);

  for (const week of weeks) {
    const participants = new Set<string>();
    for (const game of games) {
      if (game.week !== week) continue;
      if (game.participants.home.kind === 'team') participants.add(game.canHome);
      if (game.participants.away.kind === 'team') participants.add(game.canAway);
    }
    byes[week] = allCanonicalTeams
      .filter((team) => !participants.has(team))
      .sort((a, b) => a.localeCompare(b));
  }

  return byes;
}

function toPlaceholderDisplay(conference?: string | null): string {
  return conference ? `${conference} Team TBD` : 'Team TBD';
}

function buildPlaceholderParticipant(params: {
  resolver: ReturnType<typeof createTeamIdentityResolver>;
  raw: string;
  slotId: string;
  defaultDisplay: string;
}): ParticipantSlot {
  const { resolver, raw, slotId, defaultDisplay } = params;
  const trimmed = raw.trim();

  if (/^winner of /i.test(trimmed)) {
    return {
      kind: 'derived',
      slotId,
      displayName: trimmed,
      sourceEventId: slotId.replace(/-(home|away)$/, ''),
      derivation: 'winner',
    };
  }

  if (trimmed && !/\btbd\b/i.test(trimmed) && !isLikelyInvalidTeamLabel(trimmed)) {
    const resolved = resolver.resolveName(trimmed);
    if (resolved.status === 'resolved') {
      const canonical = resolved.canonicalName ?? trimmed;
      return {
        kind: 'team',
        teamId: resolved.identityKey ?? canonical,
        displayName: canonical,
        canonicalName: canonical,
        rawName: trimmed,
      };
    }
  }

  return { kind: 'placeholder', slotId, displayName: defaultDisplay, source: 'postseason-classifier' };
}

function buildTemplateGame(event: TemplateEvent): AppGame {
  return {
    key: event.id,
    eventId: event.id,
    week: event.week,
    date: event.date,
    stage: event.stage,
    status: 'placeholder',
    stageOrder: stageOrder(event.stage),
    slotOrder: event.slotOrder,
    eventKey: event.eventKey,
    label: event.label,
    conference: event.conference,
    bowlName: event.bowlName,
    playoffRound: event.playoffRound,
    providerGameId: null,
    neutral: true,
    venue: event.venue,
    isPlaceholder: true,
    sources: { event: 'postseason-template', participants: 'postseason-template' },
    participants: {
      home: event.homeDerivedFrom
        ? {
            kind: 'derived',
            slotId: `${event.id}-home`,
            displayName: event.homeDisplay,
            sourceEventId: event.homeDerivedFrom,
            derivation: 'winner',
          }
        : {
            kind: 'placeholder',
            slotId: `${event.id}-home`,
            displayName: event.homeDisplay || toPlaceholderDisplay(event.conference),
            source: 'postseason-template',
          },
      away: event.awayDerivedFrom
        ? {
            kind: 'derived',
            slotId: `${event.id}-away`,
            displayName: event.awayDisplay,
            sourceEventId: event.awayDerivedFrom,
            derivation: 'winner',
          }
        : {
            kind: 'placeholder',
            slotId: `${event.id}-away`,
            displayName: event.awayDisplay || toPlaceholderDisplay(event.conference),
            source: 'postseason-template',
          },
    },
    csvAway: event.awayDisplay,
    csvHome: event.homeDisplay,
    canAway: '',
    canHome: '',
    awayConf: '',
    homeConf: '',
  };
}

function applyManualOverride(base: AppGame, override: Partial<AppGame>): AppGame {
  return {
    ...base,
    ...override,
    participants: {
      home: override.participants?.home ?? base.participants.home,
      away: override.participants?.away ?? base.participants.away,
    },
    sources: { ...base.sources, ...(override.sources ?? {}) },
  };
}

export function buildScheduleFromApi(params: {
  scheduleItems: ScheduleWireItem[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
  observedNames?: string[];
  season: number;
  manualOverrides?: Record<string, Partial<AppGame>>;
}): BuiltSchedule {
  const { scheduleItems, teams, aliasMap, season } = params;
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

  const seedEvents = buildPostseasonTemplate(season).map(buildTemplateGame);
  const rawGames: AppGame[] = [];
  const conferenceSet = new Set<string>();

  for (const item of scheduleItems) {
    const classified = classifyScheduleRow(item, season);
    if (classified.kind === 'invalid_row') {
      issues.push(`invalid-schedule-row: ${classified.reason}`);
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

      rawGames.push({
        key: id,
        eventId: id,
        week: item.week,
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
        providerGameId: item.id,
        neutral: item.neutralSite,
        venue: item.venue ?? null,
        isPlaceholder: !hasKnownTeams,
        sources: {
          event: 'cfbd-label',
          participants: hasKnownTeams ? 'cfbd+resolver' : 'postseason-classifier',
          kickoff: 'cfbd',
          venue: 'cfbd',
        },
        participants: { home: homeParticipant, away: awayParticipant },
        csvAway: awayParticipant.kind === 'team' ? awayParticipant.rawName : awayParticipant.displayName,
        csvHome: homeParticipant.kind === 'team' ? homeParticipant.rawName : homeParticipant.displayName,
        canAway: awayParticipant.kind === 'team' ? awayParticipant.canonicalName : '',
        canHome: homeParticipant.kind === 'team' ? homeParticipant.canonicalName : '',
        awayConf: item.awayConference ?? '',
        homeConf: item.homeConference ?? '',
      });
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

    rawGames.push({
      key,
      eventId: key,
      week: item.week,
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
      providerGameId: item.id,
      neutral: item.neutralSite,
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

  const { games: hydratedGames, diagnostics } = hydrateEvents({
    baseEvents: seedEvents,
    providerEvents: rawGames,
  });

  const deduped = new Map<string, AppGame>();
  for (const game of hydratedGames) {
    const override = params.manualOverrides?.[game.eventId];
    deduped.set(game.eventId, override ? applyManualOverride(game, override) : game);
  }

  const games = sortGames(Array.from(deduped.values()));
  const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b);
  const byes = buildByes(games);

  return {
    games,
    weeks,
    byes,
    conferences: ['ALL', ...Array.from(conferenceSet).sort((a, b) => a.localeCompare(b))],
    issues,
    hydrationDiagnostics: diagnostics,
  };
}
