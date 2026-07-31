/**
 * PLATFORM-086F2C — the shared maintenance-action description contract for the
 * Data Maintenance & Recovery page (`/admin/data/cache`).
 *
 * PRESENTATION-ONLY. These descriptors disclose what each existing action
 * calls, nominally costs, durably mutates, and who normally owns it. They do
 * not authorize operations, construct API requests, or infer runtime
 * success/provider status — every string is explicit allowlisted copy. Client
 * panels import the definitions directly (never passed across a Server
 * Component boundary).
 */

export type MaintenanceActionClass = 'routine' | 'recovery' | 'emergency';

export type MaintenanceActionId =
  | 'schedule-full-year-refresh'
  | 'scores-aggregate-refresh'
  | 'game-stats-partition-refresh'
  | 'game-stats-full-backfill'
  | 'sp-ratings-refresh'
  | 'win-totals-upload'
  | 'historical-schedule-repair'
  | 'historical-scores-repair';

export type MaintenanceActionDescriptor = {
  id: MaintenanceActionId;
  label: string;
  provider: string;
  nominalCost: string;
  durableMutations: readonly string[];
  automationOwner: string;
  actionClass: MaintenanceActionClass;
};

/** Stated once beside the disclosures: nominal costs assume clean attempts. */
export const MAINTENANCE_COST_CAVEAT =
  'Provider costs are nominal per successful attempt; retry policies can increase request attempts.';

export const MAINTENANCE_ACTIONS: Record<MaintenanceActionId, MaintenanceActionDescriptor> = {
  'schedule-full-year-refresh': {
    id: 'schedule-full-year-refresh',
    label: 'Full-year schedule refresh',
    provider: 'CFBD',
    nominalCost:
      'Normally 3–4 requests: regular + postseason /games, /games/media, and /venues when due',
    durableMutations: [
      'Schedule cache',
      'Schedule probe',
      'Presentation caches',
      'Provider-refresh statuses',
      'Standings invalidation on canonical change',
    ],
    automationOwner: 'Weekly QStash schedule + lifecycle crons',
    actionClass: 'recovery',
  },
  'scores-aggregate-refresh': {
    id: 'scores-aggregate-refresh',
    label: 'Aggregate score refresh',
    provider: 'CFBD',
    nominalCost: '1–2 applicable /games partitions',
    durableMutations: ['Score caches', 'Provider-refresh status', 'Standings invalidation'],
    automationOwner: 'Live-score QStash schedule',
    actionClass: 'recovery',
  },
  'game-stats-partition-refresh': {
    id: 'game-stats-partition-refresh',
    label: 'Game-stats partition refresh',
    provider: 'CFBD',
    nominalCost: 'One fresh quota probe plus at most one /games/teams request',
    durableMutations: ['Exact game-stat partition', 'Provider-refresh status'],
    automationOwner: 'Game-stats QStash schedule',
    actionClass: 'recovery',
  },
  'game-stats-full-backfill': {
    id: 'game-stats-full-backfill',
    label: 'Full game-stats backfill',
    provider: 'CFBD',
    nominalCost: 'Up to 19 quota probes plus 19 /games/teams calls before retries',
    durableMutations: ['Multiple game-stat partitions', 'Provider-refresh statuses'],
    automationOwner: 'Operator recovery only',
    actionClass: 'emergency',
  },
  'sp-ratings-refresh': {
    id: 'sp-ratings-refresh',
    label: 'SP+ ratings refresh',
    provider: 'CFBD',
    nominalCost: 'Zero when already cached, otherwise one ratings request',
    durableMutations: ['SP+ ratings cache'],
    automationOwner: 'Manual preseason/draft maintenance',
    actionClass: 'routine',
  },
  'win-totals-upload': {
    id: 'win-totals-upload',
    label: 'Win totals upload',
    provider: 'Operator CSV (no provider request)',
    nominalCost: 'No provider request',
    durableMutations: ['Win-totals cache'],
    automationOwner: 'Manual import',
    actionClass: 'routine',
  },
  'historical-schedule-repair': {
    id: 'historical-schedule-repair',
    label: 'Historical schedule repair',
    provider: 'CFBD',
    nominalCost: 'Zero when the accepted cache short-circuits, otherwise two schedule partitions',
    durableMutations: ['Historical schedule cache', 'Scoped provider-refresh status'],
    automationOwner: 'Manual recovery',
    actionClass: 'recovery',
  },
  'historical-scores-repair': {
    id: 'historical-scores-repair',
    label: 'Historical score repair',
    provider: 'CFBD',
    nominalCost: 'Zero when cached, otherwise up to two score partitions',
    durableMutations: ['Regular/postseason score caches', 'Scoped year provider-refresh status'],
    automationOwner: 'Manual recovery',
    actionClass: 'recovery',
  },
};

export const MAINTENANCE_ACTION_IDS = Object.keys(MAINTENANCE_ACTIONS) as MaintenanceActionId[];
