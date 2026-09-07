import { createTeamIdentityResolver } from '../teamIdentity.ts';
import { isLikelyInvalidTeamLabel } from '../teamNormalization.ts';
import {
  applyTeamRecordReconciliationPlan,
  buildTeamRecordReconciliationPlan,
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
  kind: 'guard' | 'score-store' | 'identity';
  reason: unknown;
}): void {
  console.error('[team-record-reconciliation] unavailable', params);
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
  const [scheduleResult, recordsResult] = await Promise.allSettled([
    dependencies.loadSchedule(year),
    dependencies.loadRecords(year),
  ]);

  if (scheduleResult.status === 'rejected' || recordsResult.status === 'rejected') {
    return EMPTY_TEAM_RECORDS_CLIENT_PROPS;
  }

  const scheduleItems = scheduleResult.value;
  const recordCache = recordsResult.value;
  if (!recordCache) return EMPTY_TEAM_RECORDS_CLIENT_PROPS;

  const storedProps = teamRecordsClientProps(scheduleItems, recordCache);
  let scoreFacts: Awaited<ReturnType<typeof loadProviderIdSeasonScoreFacts>>;
  try {
    scoreFacts = await dependencies.loadScores(year);
  } catch (error) {
    // Score-store uncertainty is observably distinct from a legitimate empty
    // suffix, but it preserves main's rendering contract: show stored records.
    logReconciliationFailure({ year, kind: 'score-store', reason: error });
    return storedProps;
  }

  const plan = buildTeamRecordReconciliationPlan({
    scheduleItems,
    recordCache,
    scoreFactsByProviderGameId: scoreFacts.byProviderGameId,
  });
  if (plan.status === 'unavailable') {
    logReconciliationFailure({ year, kind: 'guard', reason: plan.reason });
    return EMPTY_TEAM_RECORDS_CLIENT_PROPS;
  }
  if (plan.work.tailGames === 0) return storedProps;
  if (
    ![...plan.tailScheduleByProviderGameId.keys()].some((providerGameId) =>
      scoreFacts.byProviderGameId.has(providerGameId)
    )
  ) {
    return storedProps;
  }

  let identityInputs: [
    Awaited<ReturnType<typeof getTeamDatabaseItems>>,
    Awaited<ReturnType<typeof getScopedAliasMap>>,
  ];
  try {
    identityInputs = await Promise.all([
      dependencies.loadTeams(),
      dependencies.loadAliases(leagueSlug, year),
    ]);
  } catch (error) {
    logReconciliationFailure({ year, kind: 'identity', reason: error });
    return storedProps;
  }
  const [teams, aliasMap] = identityInputs;

  const observedNames = new Set<string>();
  for (const [providerGameId, item] of plan.tailScheduleByProviderGameId) {
    for (const name of [item.homeTeam, item.awayTeam]) {
      if (typeof name === 'string' && !isLikelyInvalidTeamLabel(name)) observedNames.add(name);
    }
    const score = scoreFacts.byProviderGameId.get(providerGameId)?.score;
    for (const name of [score?.home.team, score?.away.team]) {
      if (typeof name === 'string' && !isLikelyInvalidTeamLabel(name)) observedNames.add(name);
    }
  }

  const resolver = createTeamIdentityResolver({
    teams,
    aliasMap,
    observedNames: [...observedNames],
  });
  const reconciliation = applyTeamRecordReconciliationPlan({
    plan,
    recordCache,
    scoreFactsByProviderGameId: scoreFacts.byProviderGameId,
    resolver,
  });

  return teamRecordsClientProps(scheduleItems, recordCache, reconciliation.totalsByTeamId);
}
