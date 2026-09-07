import { createTeamIdentityResolver } from '../teamIdentity.ts';
import { isLikelyInvalidTeamLabel } from '../teamNormalization.ts';
import type { ScheduleWireItem } from '../schedule.ts';
import {
  applyTeamRecordReconciliationPlan,
  buildTeamRecordReconciliationPlan,
  selectScoreConclusionCandidates,
  validateScoreConclusionCandidates,
} from '../selectors/teamRecordReconciliation.ts';
import { teamRecordsClientProps } from '../selectors/teamRecordsClient.ts';
import {
  EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID,
  type TeamRecordsClientProps,
} from '../teamRecords/clientProjection.ts';
import { readTeamRecordsCache } from '../teamRecords/teamRecordsCache.ts';
import { loadCachedScheduleItems } from './canonicalScheduleCache.ts';
import { getScopedAliasMap } from './globalAliasStore.ts';
import { loadProviderIdSeasonScoreFacts } from './scoreCacheReader.ts';
import { getTeamDatabaseItems } from './teamDatabaseStore.ts';

export const EMPTY_TEAM_RECORDS_CLIENT_PROPS: TeamRecordsClientProps = {
  teamRecordsByProviderGameId: EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID,
};

type TeamRecordClientDependencies = {
  loadSchedule: typeof loadCachedScheduleItems;
  loadRecords: typeof readTeamRecordsCache;
  loadScores: typeof loadProviderIdSeasonScoreFacts;
  loadTeams: typeof getTeamDatabaseItems;
  loadAliases: typeof getScopedAliasMap;
};

const DEFAULT_DEPENDENCIES: TeamRecordClientDependencies = {
  loadSchedule: loadCachedScheduleItems,
  loadRecords: readTeamRecordsCache,
  loadScores: loadProviderIdSeasonScoreFacts,
  loadTeams: getTeamDatabaseItems,
  loadAliases: getScopedAliasMap,
};

function logReconciliationFailure(params: {
  year: number;
  kind:
    | 'guard'
    | 'schedule-store'
    | 'record-store'
    | 'score-store'
    | 'score-conflict'
    | 'score-participant-mismatch'
    | 'identity';
  reason: unknown;
}): void {
  console.error('[team-record-reconciliation] unavailable', params);
}

function observedNamesForGames(
  scheduleItems: ReadonlyArray<ScheduleWireItem>,
  scoreFactsByProviderGameId: Awaited<
    ReturnType<typeof loadProviderIdSeasonScoreFacts>
  >['byProviderGameId']
): string[] {
  const observedNames = new Set<string>();
  for (const item of scheduleItems) {
    for (const name of [item.homeTeam, item.awayTeam]) {
      if (typeof name === 'string' && !isLikelyInvalidTeamLabel(name)) observedNames.add(name);
    }
    const score = scoreFactsByProviderGameId.get(item.id.trim())?.score;
    for (const name of [score?.home.team, score?.away.team]) {
      if (typeof name === 'string' && !isLikelyInvalidTeamLabel(name)) observedNames.add(name);
    }
  }
  return [...observedNames];
}

/**
 * Server-only, request-scoped team-record projection.
 *
 * This deliberately has no React/Next cross-request cache. It reads the raw
 * season schedule and exact-id score facts, finds the small unreflected suffix,
 * and constructs identity only when that suffix needs outcome validation. It
 * never builds the canonical scored season.
 */
export async function loadTeamRecordsClientProps(
  params: {
    leagueSlug: string;
    year: number;
  },
  dependencyOverrides: Partial<TeamRecordClientDependencies> = {}
): Promise<TeamRecordsClientProps> {
  const { leagueSlug, year } = params;
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const [scheduleResult, recordsResult, scoresResult] = await Promise.allSettled([
    dependencies.loadSchedule(year),
    dependencies.loadRecords(year),
    dependencies.loadScores(year),
  ]);

  if (scheduleResult.status === 'rejected') {
    logReconciliationFailure({ year, kind: 'schedule-store', reason: scheduleResult.reason });
  }
  if (recordsResult.status === 'rejected') {
    logReconciliationFailure({ year, kind: 'record-store', reason: recordsResult.reason });
  }
  if (scoresResult.status === 'rejected') {
    logReconciliationFailure({ year, kind: 'score-store', reason: scoresResult.reason });
  }
  if (scheduleResult.status === 'rejected' || recordsResult.status === 'rejected') {
    return EMPTY_TEAM_RECORDS_CLIENT_PROPS;
  }

  const scheduleItems = scheduleResult.value;
  const recordCache = recordsResult.value;
  if (!recordCache) return EMPTY_TEAM_RECORDS_CLIENT_PROPS;

  let storedProps: TeamRecordsClientProps | undefined;
  const getStoredProps = (): TeamRecordsClientProps => {
    storedProps ??= teamRecordsClientProps(scheduleItems, recordCache);
    return storedProps;
  };

  if (scoresResult.status === 'rejected') {
    // Score-store uncertainty is observably distinct from a legitimate empty
    // suffix, but it preserves main's rendering contract: show stored records.
    return getStoredProps();
  }
  const scoreFacts = scoresResult.value;

  if (scoreFacts.ambiguousProviderGameIds.size > 0) {
    logReconciliationFailure({
      year,
      kind: 'score-conflict',
      reason: {
        count: scoreFacts.ambiguousProviderGameIds.size,
        providerGameIds: [...scoreFacts.ambiguousProviderGameIds].sort(),
      },
    });
  }

  type IdentityInputs = [
    Awaited<ReturnType<typeof getTeamDatabaseItems>>,
    Awaited<ReturnType<typeof getScopedAliasMap>>,
  ];
  let identityInputs: IdentityInputs | null = null;
  let identityLoadAttempted = false;
  const loadIdentityInputs = async (): Promise<IdentityInputs | null> => {
    if (identityLoadAttempted) return identityInputs;
    identityLoadAttempted = true;
    try {
      identityInputs = await Promise.all([
        dependencies.loadTeams(),
        dependencies.loadAliases(leagueSlug, year),
      ]);
      return identityInputs;
    } catch (error) {
      logReconciliationFailure({ year, kind: 'identity', reason: error });
      return null;
    }
  };

  const conclusionCandidates = selectScoreConclusionCandidates({
    scheduleItems,
    scoreFactsByProviderGameId: scoreFacts.byProviderGameId,
  });
  const conclusionCandidateIds = new Set(conclusionCandidates.map((item) => item.id.trim()));
  let outcomeResolver: ReturnType<typeof createTeamIdentityResolver> | null = null;
  let validatedScoreConclusionProviderGameIds: ReadonlySet<string> = new Set();
  if (conclusionCandidates.length > 0) {
    const inputs = await loadIdentityInputs();
    if (!inputs) return getStoredProps();
    outcomeResolver = createTeamIdentityResolver({
      teams: inputs[0],
      aliasMap: inputs[1],
      observedNames: observedNamesForGames(conclusionCandidates, scoreFacts.byProviderGameId),
      cache: false,
    });
    const validation = validateScoreConclusionCandidates({
      scheduleItems: conclusionCandidates,
      scoreFactsByProviderGameId: scoreFacts.byProviderGameId,
      resolver: outcomeResolver,
    });
    validatedScoreConclusionProviderGameIds = validation.validatedProviderGameIds;
    if (validation.rejectedProviderGameIds.size > 0) {
      logReconciliationFailure({
        year,
        kind: 'score-participant-mismatch',
        reason: {
          count: validation.rejectedProviderGameIds.size,
          providerGameIds: [...validation.rejectedProviderGameIds].sort(),
        },
      });
    }
  }

  const plan = buildTeamRecordReconciliationPlan({
    scheduleItems,
    recordCache,
    validatedScoreConclusionProviderGameIds,
  });
  if (plan.status === 'unavailable') {
    logReconciliationFailure({ year, kind: 'guard', reason: plan.reason });
    return EMPTY_TEAM_RECORDS_CLIENT_PROPS;
  }
  if (plan.work.tailGames === 0) return getStoredProps();
  if (
    ![...plan.tailScheduleByProviderGameId.keys()].some((providerGameId) =>
      scoreFacts.byProviderGameId.has(providerGameId)
    )
  ) {
    return getStoredProps();
  }

  const tailHasNonCandidate = [...plan.tailScheduleByProviderGameId.keys()].some(
    (providerGameId) => !conclusionCandidateIds.has(providerGameId)
  );
  if (!outcomeResolver || tailHasNonCandidate) {
    const inputs = await loadIdentityInputs();
    if (!inputs) return getStoredProps();
    const resolverGames = tailHasNonCandidate
      ? [...conclusionCandidates, ...plan.tailScheduleByProviderGameId.values()]
      : [...plan.tailScheduleByProviderGameId.values()];
    outcomeResolver = createTeamIdentityResolver({
      teams: inputs[0],
      aliasMap: inputs[1],
      observedNames: observedNamesForGames(resolverGames, scoreFacts.byProviderGameId),
      cache: false,
    });
  }
  const reconciliation = applyTeamRecordReconciliationPlan({
    plan,
    recordCache,
    scoreFactsByProviderGameId: scoreFacts.byProviderGameId,
    resolver: outcomeResolver,
  });

  return teamRecordsClientProps(scheduleItems, recordCache, reconciliation.totalsByTeamId);
}
