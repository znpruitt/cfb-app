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
  | 'odds-refresh'
  | 'rankings-refresh'
  | 'sp-ratings-refresh'
  | 'win-totals-upload'
  | 'historical-schedule-repair'
  | 'historical-scores-repair'
  | 'conferences-refresh'
  | 'team-database-sync'
  | 'score-attachment-recovery';

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
  'odds-refresh': {
    id: 'odds-refresh',
    label: 'Odds refresh',
    provider: 'The Odds API',
    nominalCost: 'One /odds request (≈3 billing credits), with a quota observation',
    durableMutations: [
      'Raw and canonical Odds caches',
      'Odds usage snapshot',
      'Provider-refresh status',
    ],
    automationOwner: 'Hourly QStash schedule',
    actionClass: 'recovery',
  },
  'rankings-refresh': {
    id: 'rankings-refresh',
    label: 'Rankings refresh',
    provider: 'CFBD',
    nominalCost: '2 CFBD rankings partitions (regular + postseason)',
    durableMutations: ['Rankings cache', 'Provider-refresh status'],
    automationOwner: 'Publication-aware QStash schedule',
    actionClass: 'recovery',
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
  'conferences-refresh': {
    id: 'conferences-refresh',
    label: 'Conferences refresh',
    provider: 'CFBD',
    nominalCost: 'One global reference-data request',
    durableMutations: ['Global conference cache', 'Provider-refresh status'],
    automationOwner: 'Manual only',
    actionClass: 'routine',
  },
  'team-database-sync': {
    id: 'team-database-sync',
    label: 'Team database sync',
    provider: 'CFBD',
    nominalCost: 'One CFBD teams request',
    durableMutations: ['Global team catalog (replaced)', 'Standings invalidation (all leagues)'],
    automationOwner: 'Manual only',
    actionClass: 'routine',
  },
  'score-attachment-recovery': {
    id: 'score-attachment-recovery',
    label: 'Refresh scores and run attachment trace',
    provider: 'CFBD through the schedule, conference, and score adapters',
    nominalCost:
      'Normally 1–2 score requests; cold context may add 2 schedule partitions and 1 conferences request; a failed season read can fall back across provider weeks before retries',
    durableMutations: [
      'Score caches and scoped provider-refresh statuses',
      'Standings invalidation when scores change',
      'Schedule and conference caches/statuses when cold context rebuilds them',
    ],
    automationOwner: 'Operator diagnostic and recovery only',
    actionClass: 'emergency',
  },
};

export const MAINTENANCE_ACTION_IDS = Object.keys(MAINTENANCE_ACTIONS) as MaintenanceActionId[];
