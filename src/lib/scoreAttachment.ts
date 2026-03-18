import { normalizeAliasLookup, normalizeTeamName } from './teamNormalization';
import type { TeamIdentityResolver } from './teamIdentity';
import {
  buildScoreAttachmentUserMessage,
  classifyScoreAttachmentDiagnostic,
  type ScoreAttachmentDiagnostic,
  type ScoreAttachmentFailureReason,
} from './scoreAttachmentDiagnostics';

export type SeasonPhase = 'regular' | 'postseason';

export type ScheduleGameForIndex = {
  key: string;
  week: number;
  date: string | null;
  stage: 'regular' | 'conference_championship' | 'bowl' | 'playoff';
  providerGameId: string | null;
  canHome: string;
  canAway: string;
  participants: { home: { kind?: string }; away: { kind?: string } };
};

export type ScheduleIndexEntry = {
  gameKey: string;
  game: ScheduleGameForIndex;
  week: number;
  seasonType: SeasonPhase;
  date: string | null;
  providerGameId: string | null;
  homeIdentityKey: string;
  awayIdentityKey: string;
  pairKey: string;
};

export type ScheduleIndex = {
  entries: ScheduleIndexEntry[];
  byProviderGameId: Map<string, ScheduleIndexEntry[]>;
  byHomeAwayWeek: Map<string, ScheduleIndexEntry[]>;
  byPairWeek: Map<string, ScheduleIndexEntry[]>;
  byPairDate: Map<string, ScheduleIndexEntry[]>;
};

export type TeamIdentityResolution = {
  rawInput: string;
  normalizedProviderName: string;
  status: 'resolved' | 'unresolved' | 'ambiguous';
  identityKey: string | null;
  canonicalName: string | null;
  candidates?: string[];
  resolutionSource: 'alias' | 'canonical' | 'unresolved' | 'ambiguous';
};

export type NormalizedScoreRow = {
  week: number | null;
  seasonType: SeasonPhase | null;
  providerEventId: string | null;
  status: string;
  time: string | null;
  date: string | null;
  home: { team: string; score: number | null };
  away: { team: string; score: number | null };
};

export type MatchResult =
  | {
      matched: true;
      strategy: 'provider_event_id' | 'exact_home_away_week' | 'reversed_pair_week' | 'pair_date';
      entry: ScheduleIndexEntry;
      orientation: 'direct' | 'reversed';
      trace?: ScoreAttachmentDiagnostic['trace'];
    }
  | {
      matched: false;
      reason: ScoreAttachmentFailureReason;
      homeResolution: TeamIdentityResolution;
      awayResolution: TeamIdentityResolution;
      trace: ScoreAttachmentDiagnostic['trace'];
    };

export function normalizeProviderTeamName(name: string): string {
  return normalizeTeamName(normalizeAliasLookup(name).replace(/\b&\b/g, ' and '));
}

function toSeasonType(game: ScheduleGameForIndex): SeasonPhase {
  return game.stage === 'regular' ? 'regular' : 'postseason';
}

function buildHomeAwayWeekKey(params: {
  homeIdentityKey: string;
  awayIdentityKey: string;
  week: number;
  seasonType: SeasonPhase;
}): string {
  const { homeIdentityKey, awayIdentityKey, week, seasonType } = params;
  return `${seasonType}::${week}::${homeIdentityKey}::${awayIdentityKey}`;
}

function buildPairWeekKey(params: {
  pairKey: string;
  week: number;
  seasonType: SeasonPhase;
}): string {
  const { pairKey, week, seasonType } = params;
  return `${seasonType}::${week}::${pairKey}`;
}

function dayKey(dateIso: string): string {
  return dateIso.slice(0, 10);
}

function buildPairDateKey(params: {
  pairKey: string;
  seasonType: SeasonPhase;
  dateIso: string;
}): string {
  return `${params.seasonType}::${dayKey(params.dateIso)}::${params.pairKey}`;
}

function pushIndex<T>(map: Map<string, T[]>, key: string, value: T) {
  const items = map.get(key) ?? [];
  items.push(value);
  map.set(key, items);
}

export function resolveCanonicalTeamIdentity(
  rawName: string,
  resolver: TeamIdentityResolver
): TeamIdentityResolution {
  const normalizedProviderName = normalizeProviderTeamName(rawName);
  const resolved = resolver.resolveName(rawName);

  if (resolved.status === 'resolved') {
    return {
      rawInput: rawName,
      normalizedProviderName,
      status: 'resolved',
      identityKey: resolved.identityKey,
      canonicalName: resolved.canonicalName,
      resolutionSource: resolved.resolutionSource === 'alias' ? 'alias' : 'canonical',
    };
  }

  return {
    rawInput: rawName,
    normalizedProviderName,
    status: 'unresolved',
    identityKey: null,
    canonicalName: null,
    resolutionSource: 'unresolved',
  };
}

export function buildScheduleIndex(
  games: ScheduleGameForIndex[],
  resolver: TeamIdentityResolver
): ScheduleIndex {
  const index: ScheduleIndex = {
    entries: [],
    byProviderGameId: new Map<string, ScheduleIndexEntry[]>(),
    byHomeAwayWeek: new Map<string, ScheduleIndexEntry[]>(),
    byPairWeek: new Map<string, ScheduleIndexEntry[]>(),
    byPairDate: new Map<string, ScheduleIndexEntry[]>(),
  };

  for (const game of games) {
    if (!game.canHome || !game.canAway) continue;
    if ((game.participants.home.kind ?? 'team') !== 'team') continue;
    if ((game.participants.away.kind ?? 'team') !== 'team') continue;

    const homeIdentityKey =
      resolver.resolveName(game.canHome).identityKey ?? normalizeProviderTeamName(game.canHome);
    const awayIdentityKey =
      resolver.resolveName(game.canAway).identityKey ?? normalizeProviderTeamName(game.canAway);
    const seasonType = toSeasonType(game);
    const pairKey = resolver.buildPairKey(game.canHome, game.canAway);

    const entry: ScheduleIndexEntry = {
      gameKey: game.key,
      game,
      week: game.week,
      seasonType,
      date: game.date,
      providerGameId: game.providerGameId,
      homeIdentityKey,
      awayIdentityKey,
      pairKey,
    };

    index.entries.push(entry);

    if (game.providerGameId) {
      pushIndex(index.byProviderGameId, game.providerGameId, entry);
    }

    pushIndex(
      index.byHomeAwayWeek,
      buildHomeAwayWeekKey({ homeIdentityKey, awayIdentityKey, week: game.week, seasonType }),
      entry
    );
    pushIndex(index.byPairWeek, buildPairWeekKey({ pairKey, week: game.week, seasonType }), entry);

    if (game.date) {
      pushIndex(
        index.byPairDate,
        buildPairDateKey({ pairKey, seasonType, dateIso: game.date }),
        entry
      );
    }
  }

  return index;
}

function chooseSingle(entries: ScheduleIndexEntry[]): ScheduleIndexEntry | null {
  if (entries.length !== 1) return null;
  return entries[0];
}

function withinDateToleranceHours(leftIso: string, rightIso: string, toleranceHours = 24): boolean {
  const leftMs = Date.parse(leftIso);
  const rightMs = Date.parse(rightIso);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return false;
  return Math.abs(leftMs - rightMs) <= toleranceHours * 60 * 60 * 1000;
}

function traceCandidates(entries: ScheduleIndexEntry[], rejectionReason: string) {
  return entries.map((entry) => ({
    gameKey: entry.gameKey,
    homeTeam: entry.game.canHome ?? null,
    awayTeam: entry.game.canAway ?? null,
    week: entry.week ?? null,
    seasonType: entry.seasonType ?? null,
    status: null,
    accepted: false,
    rejectionReason,
  }));
}

function countPlausibleScheduledGames(params: {
  row: NormalizedScoreRow;
  scheduleIndex: ScheduleIndex;
  homeResolution: TeamIdentityResolution;
  awayResolution: TeamIdentityResolution;
}): number {
  const { row, scheduleIndex, homeResolution, awayResolution } = params;
  const seasonTypes: SeasonPhase[] = row.seasonType ? [row.seasonType] : ['regular', 'postseason'];

  const matches = scheduleIndex.entries.filter((entry) => {
    if (row.week != null && entry.week !== row.week) return false;
    if (!seasonTypes.includes(entry.seasonType)) return false;

    const homeMatches =
      homeResolution.identityKey != null &&
      (entry.homeIdentityKey === homeResolution.identityKey ||
        entry.awayIdentityKey === homeResolution.identityKey);
    const awayMatches =
      awayResolution.identityKey != null &&
      (entry.homeIdentityKey === awayResolution.identityKey ||
        entry.awayIdentityKey === awayResolution.identityKey);

    return homeMatches || awayMatches;
  });

  return matches.length;
}

function unresolvedReason(
  homeResolution: TeamIdentityResolution,
  awayResolution: TeamIdentityResolution
): ScoreAttachmentFailureReason | null {
  if (homeResolution.status !== 'resolved' && awayResolution.status !== 'resolved') {
    return 'unresolved_both_teams';
  }
  if (homeResolution.status !== 'resolved') return 'unresolved_home_team';
  if (awayResolution.status !== 'resolved') return 'unresolved_away_team';
  return null;
}

export function matchScoreRowToSchedule(
  row: NormalizedScoreRow,
  scheduleIndex: ScheduleIndex,
  resolver: TeamIdentityResolver,
  options?: { debugTrace?: boolean }
): MatchResult {
  const debugTrace = options?.debugTrace ?? false;
  const homeResolution = resolveCanonicalTeamIdentity(row.home.team, resolver);
  const awayResolution = resolveCanonicalTeamIdentity(row.away.team, resolver);

  const unresolved = unresolvedReason(homeResolution, awayResolution);
  if (unresolved) {
    const plausibleScheduledGameCount = countPlausibleScheduledGames({
      row,
      scheduleIndex,
      homeResolution,
      awayResolution,
    });

    return {
      matched: false,
      reason: unresolved,
      homeResolution,
      awayResolution,
      trace: {
        candidateCount: 0,
        plausibleScheduledGameCount,
        finalNote:
          plausibleScheduledGameCount > 0
            ? 'team identity could not be resolved for a plausible in-scope scheduled game'
            : 'team identity could not be resolved for an out-of-scope or unmatched provider row',
      },
    };
  }

  // Attachment precedence: provider event id is the strongest key and should win whenever
  // present and unique, because it survives neutral-site/home-away representation differences.
  if (row.providerEventId) {
    const idMatches = scheduleIndex.byProviderGameId.get(row.providerEventId) ?? [];
    const matchedById = chooseSingle(idMatches);
    if (matchedById) {
      return {
        matched: true,
        strategy: 'provider_event_id',
        entry: matchedById,
        orientation:
          matchedById.homeIdentityKey === homeResolution.identityKey ? 'direct' : 'reversed',
        trace: debugTrace
          ? {
              candidateCount: 1,
              candidates: [
                {
                  gameKey: matchedById.gameKey,
                  homeTeam: matchedById.game.canHome,
                  awayTeam: matchedById.game.canAway,
                  week: matchedById.week,
                  seasonType: matchedById.seasonType,
                  status: null,
                  accepted: true,
                },
              ],
              finalNote: 'matched by provider event id',
            }
          : undefined,
      };
    }
    if (idMatches.length > 1) {
      return {
        matched: false,
        reason: 'multiple_candidate_matches',
        homeResolution,
        awayResolution,
        trace: {
          candidateCount: idMatches.length,
          candidates: debugTrace
            ? traceCandidates(idMatches, 'provider_event_id_duplicate')
            : undefined,
          finalNote: 'multiple scheduled games shared provider event id',
        },
      };
    }
  }

  // Fallbacks remain schedule-derived (week/season/pair/date) to support postseason,
  // conference championships, bowls, CFP rounds, and placeholder slots after hydration.
  if (row.week != null) {
    const seasonTypes: SeasonPhase[] = row.seasonType
      ? [row.seasonType]
      : ['regular', 'postseason'];

    for (const seasonType of seasonTypes) {
      const directKey = buildHomeAwayWeekKey({
        homeIdentityKey: homeResolution.identityKey!,
        awayIdentityKey: awayResolution.identityKey!,
        week: row.week,
        seasonType,
      });
      const directMatches = scheduleIndex.byHomeAwayWeek.get(directKey) ?? [];
      const direct = chooseSingle(directMatches);
      if (direct) {
        return {
          matched: true,
          strategy: 'exact_home_away_week',
          entry: direct,
          orientation: 'direct',
          trace: debugTrace
            ? {
                candidateCount: 1,
                candidates: [
                  {
                    gameKey: direct.gameKey,
                    homeTeam: direct.game.canHome,
                    awayTeam: direct.game.canAway,
                    week: direct.week,
                    seasonType: direct.seasonType,
                    status: null,
                    accepted: true,
                  },
                ],
                finalNote: 'matched on exact home/away + week + season type',
              }
            : undefined,
        };
      }
      if (directMatches.length > 1) {
        return {
          matched: false,
          reason: 'multiple_candidate_matches',
          homeResolution,
          awayResolution,
          trace: {
            candidateCount: directMatches.length,
            candidates: debugTrace
              ? traceCandidates(directMatches, 'duplicate_home_away_week')
              : undefined,
            finalNote: 'multiple exact home/away candidates found',
          },
        };
      }

      const pairKey = resolver.buildPairKey(
        homeResolution.canonicalName!,
        awayResolution.canonicalName!
      );
      const pairMatches =
        scheduleIndex.byPairWeek.get(buildPairWeekKey({ pairKey, week: row.week, seasonType })) ??
        [];

      if (pairMatches.length === 1) {
        const entry = pairMatches[0];
        return {
          matched: true,
          strategy: 'reversed_pair_week',
          entry,
          orientation: entry.homeIdentityKey === homeResolution.identityKey ? 'direct' : 'reversed',
          trace: debugTrace
            ? {
                candidateCount: 1,
                candidates: [
                  {
                    gameKey: entry.gameKey,
                    homeTeam: entry.game.canHome,
                    awayTeam: entry.game.canAway,
                    week: entry.week,
                    seasonType: entry.seasonType,
                    status: null,
                    accepted: true,
                  },
                ],
                finalNote: 'matched on exact pair + week + season type',
              }
            : undefined,
        };
      }
      if (pairMatches.length > 1) {
        return {
          matched: false,
          reason: 'multiple_candidate_matches',
          homeResolution,
          awayResolution,
          trace: {
            candidateCount: pairMatches.length,
            candidates: debugTrace ? traceCandidates(pairMatches, 'pair_week_conflict') : undefined,
            finalNote: 'multiple pair matches found for week/season',
          },
        };
      }
    }
  }

  if (row.date) {
    const rowDate = row.date;
    const seasonTypes: SeasonPhase[] = row.seasonType
      ? [row.seasonType]
      : ['regular', 'postseason'];

    for (const seasonType of seasonTypes) {
      const pairKey = resolver.buildPairKey(
        homeResolution.canonicalName!,
        awayResolution.canonicalName!
      );
      const pairDateMatches =
        scheduleIndex.byPairDate.get(buildPairDateKey({ pairKey, seasonType, dateIso: rowDate })) ??
        [];
      const narrow = pairDateMatches.filter(
        (entry) => entry.date && withinDateToleranceHours(entry.date, rowDate, 18)
      );
      if (narrow.length === 1) {
        const entry = narrow[0];
        return {
          matched: true,
          strategy: 'pair_date',
          entry,
          orientation: entry.homeIdentityKey === homeResolution.identityKey ? 'direct' : 'reversed',
          trace: debugTrace
            ? {
                candidateCount: 1,
                candidates: [
                  {
                    gameKey: entry.gameKey,
                    homeTeam: entry.game.canHome,
                    awayTeam: entry.game.canAway,
                    week: entry.week,
                    seasonType: entry.seasonType,
                    status: null,
                    accepted: true,
                  },
                ],
                finalNote: 'matched on pair + date tolerance',
              }
            : undefined,
        };
      }
      if (narrow.length > 1) {
        return {
          matched: false,
          reason: 'multiple_candidate_matches',
          homeResolution,
          awayResolution,
          trace: {
            candidateCount: narrow.length,
            candidates: debugTrace ? traceCandidates(narrow, 'pair_date_conflict') : undefined,
            finalNote: 'multiple pair date candidates within tolerance',
          },
        };
      }
    }
  }

  return {
    matched: false,
    reason: 'no_scheduled_match',
    homeResolution,
    awayResolution,
    trace: {
      candidateCount: 0,
      finalNote: 'no scheduled game matched this provider row',
    },
  };
}

export type AttachScoresResult = {
  scoresByKey: Record<
    string,
    {
      status: string;
      home: { team: string; score: number | null };
      away: { team: string; score: number | null };
      time: string | null;
    }
  >;
  attachedCount: number;
  diagnostics: ScoreAttachmentDiagnostic[];
};

export function attachScoresToSchedule(params: {
  rows: NormalizedScoreRow[];
  scheduleIndex: ScheduleIndex;
  resolver: TeamIdentityResolver;
  debugTrace?: boolean;
  source?: string;
}): AttachScoresResult {
  const { rows, scheduleIndex, resolver, debugTrace = false, source = 'scores_api' } = params;
  const scoresByKey: AttachScoresResult['scoresByKey'] = {};
  const diagnostics: ScoreAttachmentDiagnostic[] = [];

  for (const row of rows) {
    const match = matchScoreRowToSchedule(row, scheduleIndex, resolver, { debugTrace });
    if (!match.matched) {
      const classification = classifyScoreAttachmentDiagnostic({
        reason: match.reason,
        plausibleScheduledGameCount: match.trace.plausibleScheduledGameCount,
      });
      diagnostics.push({
        type: 'ignored_score_row',
        reason: match.reason,
        classification,
        userMessage: buildScoreAttachmentUserMessage({ reason: match.reason, classification }),
        provider: {
          source,
          providerGameId: row.providerEventId,
          week: row.week,
          seasonType: row.seasonType,
          status: row.status,
          homeTeamRaw: row.home.team,
          awayTeamRaw: row.away.team,
          homeScore: row.home.score,
          awayScore: row.away.score,
          kickoff: row.date ?? row.time,
        },
        normalization: {
          homeTeamNormalized: match.homeResolution.normalizedProviderName,
          awayTeamNormalized: match.awayResolution.normalizedProviderName,
        },
        resolution: {
          homeCanonical: match.homeResolution.canonicalName,
          awayCanonical: match.awayResolution.canonicalName,
          homeResolved: match.homeResolution.status === 'resolved',
          awayResolved: match.awayResolution.status === 'resolved',
        },
        trace: match.trace,
      });
      continue;
    }

    scoresByKey[match.entry.gameKey] = {
      status: row.status,
      time: row.time,
      home: { team: row.home.team, score: row.home.score },
      away: { team: row.away.team, score: row.away.score },
    };
  }

  return {
    scoresByKey,
    attachedCount: Object.keys(scoresByKey).length,
    diagnostics,
  };
}
