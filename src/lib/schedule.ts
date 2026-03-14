import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import type { AliasMap } from './teamNames';
import { isLikelyInvalidTeamLabel } from './teamNormalization';
import { buildPostseasonTemplate, type TemplateEvent } from './postseason-template';
import { classifyScheduleRow } from './postseason-classify';
import { hydrateEvents, type HydrationDiagnostic } from './postseason-hydrate';

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
  postseasonRole: PostseasonRole | null;
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

function isFbsTeam(
  canonicalTeamName: string,
  teamMetadataByCanonicalName: Map<string, TeamCatalogItem>,
  resolver: ReturnType<typeof createTeamIdentityResolver>
): boolean {
  const resolved = resolver.resolveName(canonicalTeamName);
  if (resolved.status === 'resolved' && resolved.isOwnable) return true;

  const team = teamMetadataByCanonicalName.get(canonicalTeamName);
  if (!team) return false;

  const level = (team.level ?? team.subdivision ?? '').trim().toUpperCase();
  return level.includes('FBS');
}

function isTrackedGame(
  game: AppGame,
  teamMetadataByCanonicalName: Map<string, TeamCatalogItem>,
  resolver: ReturnType<typeof createTeamIdentityResolver>
): boolean {
  const homeIsTeam = game.participants.home.kind === 'team';
  const awayIsTeam = game.participants.away.kind === 'team';

  if (!homeIsTeam && !awayIsTeam) return true;

  const homeIsFbs = homeIsTeam && isFbsTeam(game.canHome, teamMetadataByCanonicalName, resolver);
  const awayIsFbs = awayIsTeam && isFbsTeam(game.canAway, teamMetadataByCanonicalName, resolver);
  return homeIsFbs || awayIsFbs;
}

function resolveRegularSeasonRow(params: {
  item: ScheduleWireItem;
  resolver: ReturnType<typeof createTeamIdentityResolver>;
}): {
  include: boolean;
  emitIdentityIssue: boolean;
  homeResolved: ReturnType<ReturnType<typeof createTeamIdentityResolver>['resolveName']>;
  awayResolved: ReturnType<ReturnType<typeof createTeamIdentityResolver>['resolveName']>;
} {
  const { item, resolver } = params;
  const homeResolved = resolver.resolveName(item.homeTeam);
  const awayResolved = resolver.resolveName(item.awayTeam);
  const homeKnown = homeResolved.status === 'resolved';
  const awayKnown = awayResolved.status === 'resolved';

  const homeIsFbs = homeKnown && homeResolved.subdivision === 'FBS';
  const awayIsFbs = awayKnown && awayResolved.subdivision === 'FBS';

  if (homeKnown && awayKnown) {
    return {
      include: homeIsFbs || awayIsFbs,
      emitIdentityIssue: false,
      homeResolved,
      awayResolved,
    };
  }

  const hasKnownFbsTeam = homeIsFbs || awayIsFbs;
  return {
    include: hasKnownFbsTeam,
    emitIdentityIssue: hasKnownFbsTeam,
    homeResolved,
    awayResolved,
  };
}

function buildByes(
  games: AppGame[],
  trackedFbsTeams: string[],
  teamMetadataByCanonicalName: Map<string, TeamCatalogItem>,
  resolver: ReturnType<typeof createTeamIdentityResolver>
): Record<number, string[]> {
  const byes: Record<number, string[]> = {};
  const weeks = Array.from(new Set(games.map((g) => g.week))).sort((a, b) => a - b);

  for (const week of weeks) {
    const teamsPlayingThisWeek = new Set<string>();
    for (const game of games) {
      if (game.week !== week) continue;
      if (
        game.participants.home.kind === 'team' &&
        isFbsTeam(game.canHome, teamMetadataByCanonicalName, resolver)
      ) {
        teamsPlayingThisWeek.add(game.canHome);
      }
      if (
        game.participants.away.kind === 'team' &&
        isFbsTeam(game.canAway, teamMetadataByCanonicalName, resolver)
      ) {
        teamsPlayingThisWeek.add(game.canAway);
      }
    }
    byes[week] = trackedFbsTeams
      .filter((team) => !teamsPlayingThisWeek.has(team))
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

  return {
    kind: 'placeholder',
    slotId,
    displayName: defaultDisplay,
    source: 'postseason-classifier',
  };
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
    postseasonRole:
      event.stage === 'conference_championship'
        ? 'conference_championship'
        : event.playoffRound === 'national_championship'
          ? 'national_championship'
          : event.stage === 'playoff'
            ? 'playoff'
            : 'bowl',
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

function mergeRealGameWithPlaceholder(
  existing: AppGame,
  template: AppGame,
  override?: Partial<AppGame>
): AppGame {
  const merged: AppGame = {
    ...template,
    ...existing,
    participants: {
      home: existing.participants.home ?? template.participants.home,
      away: existing.participants.away ?? template.participants.away,
    },
    sources: { ...template.sources, ...existing.sources },
  };

  return override ? applyManualOverride(merged, override) : merged;
}

function mergeRegularSeasonAndPostseason(
  regularGames: AppGame[],
  postseasonTemplates: AppGame[],
  overrides?: Record<string, Partial<AppGame>>
): AppGame[] {
  const byKey = new Map<string, AppGame>();

  for (const game of regularGames) {
    const override = overrides?.[game.eventId];
    byKey.set(game.eventId, override ? applyManualOverride(game, override) : game);
  }

  for (const template of postseasonTemplates) {
    const existing = byKey.get(template.eventId);
    const override = overrides?.[template.eventId];
    if (!existing) {
      byKey.set(template.eventId, override ? applyManualOverride(template, override) : template);
      continue;
    }

    byKey.set(template.eventId, mergeRealGameWithPlaceholder(existing, template, override));
  }

  return Array.from(byKey.values());
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
  const apiRegularGames: AppGame[] = [];
  const apiPostseasonGames: AppGame[] = [];

  for (const item of scheduleItems) {
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
        postseasonRole:
          classified.postseasonRole ??
          (classified.stage === 'conference_championship'
            ? 'conference_championship'
            : classified.stage === 'playoff'
              ? 'playoff'
              : 'bowl'),
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

    const rowResolution = resolveRegularSeasonRow({ item, resolver });
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
      week: item.week,
      home: canHome,
      away: canAway,
      neutral: item.neutralSite,
    });

    const homeConf = item.homeConference ?? '';
    const awayConf = item.awayConference ?? '';

    apiRegularGames.push({
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
      postseasonRole: null,
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

  const { games: hydratedPostseasonGames, diagnostics } = hydrateEvents({
    baseEvents: seedEvents,
    providerEvents: apiPostseasonGames,
  });

  const mergedGames = mergeRegularSeasonAndPostseason(
    apiRegularGames,
    hydratedPostseasonGames,
    params.manualOverrides
  );

  if (IS_DEBUG) {
    summarizeGames('raw normalized apiGames', [...apiRegularGames, ...apiPostseasonGames]);
    summarizeGames('postseasonTemplates', seedEvents);
    summarizeGames('combinedGames', mergedGames);
  }

  const canonicalTeamMetadataByName = new Map<string, TeamCatalogItem>();
  for (const team of teams) {
    const canonicalName = resolver.resolveName(team.school).canonicalName ?? team.school;
    canonicalTeamMetadataByName.set(canonicalName, team);
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
    hydrationDiagnostics: diagnostics,
  };
}
