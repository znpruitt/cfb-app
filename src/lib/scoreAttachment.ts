import { normalizeAliasLookup, normalizeTeamName } from './teamNormalization.ts';
import type { TeamIdentityResolver } from './teamIdentity.ts';
import {
  buildScoreAttachmentUserMessage,
  classifyScoreAttachmentDiagnostic,
  type ScoreAttachmentDiagnostic,
  type ScoreAttachmentFailureReason,
} from './scoreAttachmentDiagnostics.ts';

export type SeasonPhase = 'regular' | 'postseason';

export type ScheduleGameForIndex = {
  key: string;
  week: number;
  providerWeek?: number;
  canonicalWeek?: number;
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
  providerWeek: number;
  canonicalWeek: number;
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
  // Provider-row canonicalization only (CFBD/ESPN payload cleanup for attachment keys).
  // Team-vs-team equivalence comparisons should use teamIdentity resolver helpers.
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
    // Team-pair / week / date indexing needs both sides hydrated to a resolvable
    // 'team' participant. Provider-event-id indexing does NOT — the provider id is a
    // hydration-independent identity, so a half-hydrated or placeholder postseason
    // slot (bowl/CFP before teams are set) must still be attachable by that id.
    const hasResolvableTeams =
      Boolean(game.canHome && game.canAway) &&
      (game.participants.home.kind ?? 'team') === 'team' &&
      (game.participants.away.kind ?? 'team') === 'team';

    const seasonType = toSeasonType(game);
    const canonicalWeek = game.canonicalWeek ?? game.week;
    const providerWeek = game.providerWeek ?? game.week;
    const homeIdentityKey = hasResolvableTeams
      ? (resolver.resolveName(game.canHome).identityKey ?? normalizeProviderTeamName(game.canHome))
      : '';
    const awayIdentityKey = hasResolvableTeams
      ? (resolver.resolveName(game.canAway).identityKey ?? normalizeProviderTeamName(game.canAway))
      : '';
    const pairKey = hasResolvableTeams ? resolver.buildPairKey(game.canHome, game.canAway) : '';

    const entry: ScheduleIndexEntry = {
      gameKey: game.key,
      game,
      week: canonicalWeek,
      providerWeek,
      canonicalWeek,
      seasonType,
      date: game.date,
      providerGameId: game.providerGameId,
      homeIdentityKey,
      awayIdentityKey,
      pairKey,
    };

    // Provider event id is the strongest, hydration-independent key — index it
    // whenever present, even for a not-yet-hydrated placeholder slot.
    if (game.providerGameId) {
      pushIndex(index.byProviderGameId, game.providerGameId, entry);
    }

    // Everything below is team-identity keyed; placeholders can only attach by
    // provider id, so skip them here (preserving placeholder semantics).
    if (!hasResolvableTeams) continue;

    index.entries.push(entry);

    const indexedWeeks = new Set([canonicalWeek, providerWeek]);
    for (const indexedWeek of indexedWeeks) {
      pushIndex(
        index.byHomeAwayWeek,
        buildHomeAwayWeekKey({
          homeIdentityKey,
          awayIdentityKey,
          week: indexedWeek,
          seasonType,
        }),
        entry
      );
      pushIndex(
        index.byPairWeek,
        buildPairWeekKey({ pairKey, week: indexedWeek, seasonType }),
        entry
      );
    }

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

// Per-phase fallback results. Matching is evaluated one phase at a time so that a
// provider row lacking a season type (null) can be checked against BOTH phases and
// refused when a same-pair regular/postseason rematch makes the phase ambiguous.
type WeekPhaseResult =
  | {
      kind: 'single';
      strategy: 'exact_home_away_week' | 'reversed_pair_week';
      entry: ScheduleIndexEntry;
    }
  | { kind: 'multiple'; entries: ScheduleIndexEntry[]; rejection: string; finalNote: string }
  | { kind: 'none' };

type DatePhaseResult =
  | { kind: 'single'; entry: ScheduleIndexEntry }
  | { kind: 'multiple'; entries: ScheduleIndexEntry[] }
  | { kind: 'none' };

function matchWeekWithinPhase(params: {
  seasonType: SeasonPhase;
  week: number;
  homeResolution: TeamIdentityResolution;
  awayResolution: TeamIdentityResolution;
  scheduleIndex: ScheduleIndex;
  resolver: TeamIdentityResolver;
}): WeekPhaseResult {
  const { seasonType, week, homeResolution, awayResolution, scheduleIndex, resolver } = params;

  const directKey = buildHomeAwayWeekKey({
    homeIdentityKey: homeResolution.identityKey!,
    awayIdentityKey: awayResolution.identityKey!,
    week,
    seasonType,
  });
  const directMatches = scheduleIndex.byHomeAwayWeek.get(directKey) ?? [];
  if (directMatches.length > 1) {
    return {
      kind: 'multiple',
      entries: directMatches,
      rejection: 'duplicate_home_away_week',
      finalNote: 'multiple exact home/away candidates found',
    };
  }
  if (directMatches.length === 1) {
    return { kind: 'single', strategy: 'exact_home_away_week', entry: directMatches[0]! };
  }

  const pairKey = resolver.buildPairKey(
    homeResolution.canonicalName!,
    awayResolution.canonicalName!
  );
  const pairMatches =
    scheduleIndex.byPairWeek.get(buildPairWeekKey({ pairKey, week, seasonType })) ?? [];
  if (pairMatches.length > 1) {
    return {
      kind: 'multiple',
      entries: pairMatches,
      rejection: 'pair_week_conflict',
      finalNote: 'multiple pair matches found for week/season',
    };
  }
  if (pairMatches.length === 1) {
    return { kind: 'single', strategy: 'reversed_pair_week', entry: pairMatches[0]! };
  }

  return { kind: 'none' };
}

function matchDateWithinPhase(params: {
  seasonType: SeasonPhase;
  rowDate: string;
  homeResolution: TeamIdentityResolution;
  awayResolution: TeamIdentityResolution;
  scheduleIndex: ScheduleIndex;
  resolver: TeamIdentityResolver;
}): DatePhaseResult {
  const { seasonType, rowDate, homeResolution, awayResolution, scheduleIndex, resolver } = params;
  const pairKey = resolver.buildPairKey(
    homeResolution.canonicalName!,
    awayResolution.canonicalName!
  );
  const pairDateMatches =
    scheduleIndex.byPairDate.get(buildPairDateKey({ pairKey, seasonType, dateIso: rowDate })) ?? [];
  const narrow = pairDateMatches.filter(
    (entry) => entry.date && withinDateToleranceHours(entry.date, rowDate, 18)
  );
  if (narrow.length > 1) return { kind: 'multiple', entries: narrow };
  if (narrow.length === 1) return { kind: 'single', entry: narrow[0]! };
  return { kind: 'none' };
}

function acceptedTraceCandidate(entry: ScheduleIndexEntry) {
  return {
    gameKey: entry.gameKey,
    homeTeam: entry.game.canHome,
    awayTeam: entry.game.canAway,
    week: entry.week,
    seasonType: entry.seasonType,
    status: null,
    accepted: true as const,
  };
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

  // Attachment precedence: provider event id is the strongest key and wins whenever
  // present and unique. It survives neutral-site/home-away representation differences,
  // and it can hydrate a placeholder game whose teams aren't set yet — so it is tried
  // BEFORE the team-resolution gate below, which only guards the schedule-derived
  // (week/pair/date) fallbacks.
  //
  // Side-attribution safety: the attached score's home/away are stored positionally
  // and standings maps them onto the schedule's home/away, so an id match may only be
  // accepted when the row's sides line up DIRECTLY with the schedule's sides. Validate
  // each KNOWN schedule side (re-resolving the game's own canonical name, since a
  // half-hydrated game's index identity keys are blanked): the correspondingly-
  // positioned row team must resolve to that same identity. A placeholder side (no
  // canonical team, hence no owner) imposes no constraint. If any known side is not a
  // direct match — reversed home/away, an unresolvable row, or a mismatch — the id
  // match is declined and falls through, because a positional attach would credit an
  // owned side with its opponent's score. A pure placeholder game passes trivially
  // (both sides unconstrained) and is hydrated by the row as-is.
  if (row.providerEventId) {
    const idMatches = scheduleIndex.byProviderGameId.get(row.providerEventId) ?? [];
    const matchedById = chooseSingle(idMatches);
    if (matchedById) {
      const homeKnownKey = matchedById.game.canHome
        ? (resolver.resolveName(matchedById.game.canHome).identityKey ?? null)
        : null;
      const awayKnownKey = matchedById.game.canAway
        ? (resolver.resolveName(matchedById.game.canAway).identityKey ?? null)
        : null;
      const homeSideDirectOk = homeKnownKey == null || homeResolution.identityKey === homeKnownKey;
      const awaySideDirectOk = awayKnownKey == null || awayResolution.identityKey === awayKnownKey;

      if (homeSideDirectOk && awaySideDirectOk) {
        return {
          matched: true,
          strategy: 'provider_event_id',
          entry: matchedById,
          orientation: 'direct',
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
      // Not side-safe (reversed / unresolvable known side) — fall through rather
      // than risk a swapped-orientation positional attach.
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

  // Team resolution is required only for the schedule-derived fallbacks (they key on
  // identity/canonical name). A row that reached here without a provider-id match and
  // whose teams can't be resolved has no usable fallback signal.
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

  // Fallbacks remain schedule-derived (week/season/pair/date) to support postseason,
  // conference championships, bowls, CFP rounds, and placeholder slots after hydration.
  //
  // A row WITHOUT a season type is evaluated against both phases, but the phases are
  // scored independently and combined: if candidates exist in more than one phase
  // (a same-pair regular + postseason rematch), the phase is genuinely ambiguous and
  // we refuse to attach rather than silently pick 'regular'. An explicit season type
  // constrains to a single phase, so this reduces to the prior single-phase behavior.
  const fallbackPhases: SeasonPhase[] = row.seasonType
    ? [row.seasonType]
    : ['regular', 'postseason'];

  const crossPhaseWeekAmbiguity = (entries: ScheduleIndexEntry[]): MatchResult => ({
    matched: false,
    reason: 'multiple_candidate_matches',
    homeResolution,
    awayResolution,
    trace: {
      candidateCount: entries.length,
      candidates: debugTrace ? traceCandidates(entries, 'cross_phase_week_ambiguity') : undefined,
      finalNote:
        'row without a season type matched scheduled games in multiple phases (regular + postseason)',
    },
  });
  // A cross-phase week match is only truly ambiguous if a kickoff date can't separate
  // the two meetings. When the row carries a date, defer the rejection to the date
  // fallback (regular vs postseason rematches are days/weeks apart, so the 18h window
  // uniquely identifies one); if the date can't narrow it, this is surfaced afterward.
  let deferredCrossPhaseWeek: ScheduleIndexEntry[] | null = null;

  if (row.week != null) {
    const week = row.week;
    const perPhase = fallbackPhases
      .map((seasonType) => ({
        seasonType,
        result: matchWeekWithinPhase({
          seasonType,
          week,
          homeResolution,
          awayResolution,
          scheduleIndex,
          resolver,
        }),
      }))
      .filter((p) => p.result.kind !== 'none');

    if (perPhase.length > 1) {
      const entries = perPhase.flatMap((p) =>
        p.result.kind === 'single'
          ? [p.result.entry]
          : (p.result as { entries: ScheduleIndexEntry[] }).entries
      );
      // Defer to the date fallback when a kickoff date is available; otherwise reject.
      if (!row.date) {
        return crossPhaseWeekAmbiguity(entries);
      }
      deferredCrossPhaseWeek = entries;
    } else if (perPhase.length === 1) {
      const { result } = perPhase[0]!;
      if (result.kind === 'multiple') {
        return {
          matched: false,
          reason: 'multiple_candidate_matches',
          homeResolution,
          awayResolution,
          trace: {
            candidateCount: result.entries.length,
            candidates: debugTrace ? traceCandidates(result.entries, result.rejection) : undefined,
            finalNote: result.finalNote,
          },
        };
      }
      if (result.kind === 'single') {
        const entry = result.entry;
        return {
          matched: true,
          strategy: result.strategy,
          entry,
          orientation:
            result.strategy === 'exact_home_away_week'
              ? 'direct'
              : entry.homeIdentityKey === homeResolution.identityKey
                ? 'direct'
                : 'reversed',
          trace: debugTrace
            ? {
                candidateCount: 1,
                candidates: [acceptedTraceCandidate(entry)],
                finalNote:
                  result.strategy === 'exact_home_away_week'
                    ? 'matched on exact home/away + week + season type'
                    : 'matched on exact pair + week + season type',
              }
            : undefined,
        };
      }
    }
  }

  if (row.date) {
    const rowDate = row.date;
    const perPhase = fallbackPhases
      .map((seasonType) => ({
        seasonType,
        result: matchDateWithinPhase({
          seasonType,
          rowDate,
          homeResolution,
          awayResolution,
          scheduleIndex,
          resolver,
        }),
      }))
      .filter((p) => p.result.kind !== 'none');

    if (perPhase.length > 1) {
      const entries = perPhase.flatMap((p) =>
        p.result.kind === 'single'
          ? [p.result.entry]
          : (p.result as { entries: ScheduleIndexEntry[] }).entries
      );
      return {
        matched: false,
        reason: 'multiple_candidate_matches',
        homeResolution,
        awayResolution,
        trace: {
          candidateCount: entries.length,
          candidates: debugTrace
            ? traceCandidates(entries, 'cross_phase_date_ambiguity')
            : undefined,
          finalNote:
            'row without a season type matched scheduled games by date in multiple phases (regular + postseason)',
        },
      };
    }

    if (perPhase.length === 1) {
      const { result } = perPhase[0]!;
      if (result.kind === 'multiple') {
        return {
          matched: false,
          reason: 'multiple_candidate_matches',
          homeResolution,
          awayResolution,
          trace: {
            candidateCount: result.entries.length,
            candidates: debugTrace
              ? traceCandidates(result.entries, 'pair_date_conflict')
              : undefined,
            finalNote: 'multiple pair date candidates within tolerance',
          },
        };
      }
      if (result.kind === 'single') {
        const entry = result.entry;
        return {
          matched: true,
          strategy: 'pair_date',
          entry,
          orientation: entry.homeIdentityKey === homeResolution.identityKey ? 'direct' : 'reversed',
          trace: debugTrace
            ? {
                candidateCount: 1,
                candidates: [acceptedTraceCandidate(entry)],
                finalNote: 'matched on pair + date tolerance',
              }
            : undefined,
        };
      }
    }
  }

  // A cross-phase week ambiguity deferred above (row had a date) that the date
  // fallback could not uniquely resolve remains genuinely ambiguous — surface it
  // rather than a generic no-match.
  if (deferredCrossPhaseWeek) {
    return crossPhaseWeekAmbiguity(deferredCrossPhaseWeek);
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

    // Store in SCHEDULE orientation. Downstream (standings, live delta) maps
    // scoresByKey.home/.away positionally onto the schedule's csvHome/csvAway, so a
    // reversed match (provider home/away opposite the schedule's, e.g. neutral-site or
    // a reversed_pair_week/pair_date fallback) must be swapped here — otherwise each
    // side is credited with its opponent's score. Orientation is reliable for every
    // strategy that reaches this point: provider_event_id is only accepted as 'direct'
    // (its guard rejects unvalidatable/reversed sides), and the week/pair/date
    // fallbacks run after team resolution, so their identity-key comparison is valid.
    const rowHome = { team: row.home.team, score: row.home.score };
    const rowAway = { team: row.away.team, score: row.away.score };
    scoresByKey[match.entry.gameKey] = {
      status: row.status,
      time: row.time,
      home: match.orientation === 'reversed' ? rowAway : rowHome,
      away: match.orientation === 'reversed' ? rowHome : rowAway,
    };
  }

  return {
    scoresByKey,
    attachedCount: Object.keys(scoresByKey).length,
    diagnostics,
  };
}
