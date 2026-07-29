/**
 * Shared catalog of provider-backed datasets (PLATFORM-086A).
 *
 * This module is intentionally free of server-only imports so it can be shared
 * by the refresh-status/settings stores, the admin API, the admin panel, and
 * any client-side freshness UI. It is the single source of truth for:
 *   - the `ProviderDataset` union used everywhere refresh status/settings key by
 *     dataset;
 *   - human-facing labels, provider names, and the CURRENT vs PLANNED automation
 *     description for each dataset.
 *
 * IMPORTANT (honesty rule): `currentAutomation` describes what actually runs in
 * `vercel.json` today; `plannedPolicy` describes the future PLATFORM-086B–086E
 * cadence that is NOT active yet. The admin panel must present these distinctly
 * so operators are never told a planned job is already running.
 */

export type ProviderDataset =
  | 'scores'
  | 'schedule'
  | 'odds'
  | 'rankings'
  | 'conferences'
  | 'game-stats';

export const PROVIDER_DATASETS: readonly ProviderDataset[] = [
  'scores',
  'schedule',
  'odds',
  'rankings',
  'conferences',
  'game-stats',
] as const;

export function isProviderDataset(value: unknown): value is ProviderDataset {
  return typeof value === 'string' && PROVIDER_DATASETS.includes(value as ProviderDataset);
}

export type ProviderName = 'CFBD' | 'The Odds API';

export type ProviderDatasetDescriptor = {
  dataset: ProviderDataset;
  /** Short human label for panels and freshness chips. */
  label: string;
  provider: ProviderName;
  /**
   * Whether an automatic refresh job for this dataset exists in versioned
   * deployment config (`vercel.json`) TODAY. `false` means manual/API-only.
   */
  hasActiveAutomation: boolean;
  /** Truthful description of the automation that runs today (or its absence). */
  currentAutomation: string;
  /**
   * Read-only description of the fixed PLATFORM-086 cadence PLANNED for this
   * dataset. Not active in this task — never render this as if it were running.
   */
  plannedPolicy: string;
  /**
   * Lifecycle-critical automation (drives preseason→season/season→offseason
   * transitions) is EXEMPT from the global noncritical auto-refresh pause. Only
   * the season-transition cron (schedule dataset) is lifecycle-critical today.
   */
  lifecycleCritical: boolean;
  /**
   * Whether an EXISTING automatic job consumes this dataset's auto-refresh
   * enable/disable setting in this task. `game-stats` and `scores` (its live-score
   * cron, PLATFORM-086B2B) do today; the others persist a setting that future
   * 086C–086E jobs will consume. The panel uses this to avoid implying a toggle
   * has an effect it does not yet have.
   */
  autoRefreshSettingConsumed: boolean;
  /**
   * How old a successful refresh may be before the admin panel marks it "stale"
   * (rereview finding #8). Derived per dataset from its expected cadence so a
   * weekly dataset isn't flagged stale after two days, nor near-live scores held
   * fresh for far too long. Aligns with the diagnostics staleness thresholds.
   */
  staleAfterMs: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const PROVIDER_DATASET_DESCRIPTORS: Record<ProviderDataset, ProviderDatasetDescriptor> = {
  scores: {
    dataset: 'scores',
    label: 'Scores',
    provider: 'CFBD',
    hasActiveAutomation: true,
    currentAutomation:
      'Every 3 minutes (QStash `turfwar-live-scores-3m` → GET /api/cron/live-scores): schedule-armed, polling only kickoff-window games (~15 min before kickoff through 24 h after) while they remain unresolved — at most ONE billed CFBD /scoreboard or /games request per run, above the 1,000-call monthly reserve, honoring the global pause and the Scores auto-refresh toggle. Visible browser tabs refresh scores cache-only on the same 3-minute cadence while a live game is in window.',
    plannedPolicy:
      'Active (PLATFORM-086B2B): fixed 3-minute schedule-armed cadence — the QStash schedule + browser refresh are version-controlled, not admin-editable; the auto-refresh toggle pauses/resumes the polling.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: true,
    // Near-live during a slate; 2 days tolerates the offseason gap without holding
    // an in-season stall fresh for long. (The admin card's canonical status surface
    // stays year-scoped pending PLATFORM-086F2, so this broad threshold is retained.)
    staleAfterMs: 2 * DAY_MS,
  },
  schedule: {
    dataset: 'schedule',
    label: 'Schedule',
    provider: 'CFBD',
    hasActiveAutomation: true,
    currentAutomation:
      'Preseason transition probe (season-transition cron, lifecycle-critical) plus the weekly in-season route GET /api/cron/schedule-refresh (QStash `turfwar-schedule-weekly`, Tuesdays 12:00 UTC once provisioned per runbook §8h): each active season year gets one complete regular+postseason refresh through the shared full-season authority. Ordinary weekly maintenance honors the global pause and this toggle; the postseason-boundary maintenance that establishes the season-rollover boundary (from 7 days before the latest regular-season kickoff, while leagues remain in season) is lifecycle-critical and exempt.',
    plannedPolicy:
      'Active (PLATFORM-086E1B): fixed weekly Tuesday 12:00 UTC external trigger — the QStash schedule and cadence are version-controlled, never admin-editable. The toggle pauses ONLY ordinary weekly maintenance; the preseason transition and postseason-boundary maintenance remain exempt.',
    // Lifecycle-critical here means the dataset CONTAINS lifecycle-critical
    // OPERATIONS (the season-transition cron and the weekly cron's
    // postseason-boundary maintenance) that are exempt from operator pause
    // controls — NOT that every schedule refresh bypasses them: ordinary weekly
    // maintenance honors the global pause and this dataset's toggle
    // (PLATFORM-086E1B operation-aware gating).
    lifecycleCritical: true,
    autoRefreshSettingConsumed: true,
    // Weekly cadence (matches the diagnostics stale-schedule threshold).
    staleAfterMs: 8 * DAY_MS,
  },
  odds: {
    dataset: 'odds',
    label: 'Odds',
    provider: 'The Odds API',
    hasActiveAutomation: true,
    currentAutomation:
      'External QStash schedule (hourly) → GET /api/cron/odds. The application polling policy decides whether a provider request is due: normally every ~6 hours, and every ~2 hours during the 6 hours before each America/Chicago slate date’s first kickoff (eligible games within the next 7 days). A due run issues one quota-free /sports probe plus at most one 3-credit /odds request, above a 50-credit reserve; the global pause + this Odds toggle gate it, and public traffic stays cache-only.',
    plannedPolicy:
      'Active (PLATFORM-086C2): hourly external trigger; application-owned 6h baseline / 2h pre-kickoff cadence; 50-credit reserve; global-pause + toggle gated.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: true,
    // Matches the diagnostics stale-odds threshold.
    staleAfterMs: 2 * DAY_MS,
  },
  rankings: {
    dataset: 'rankings',
    label: 'Rankings',
    provider: 'CFBD',
    hasActiveAutomation: false,
    currentAutomation: 'Manual/API refresh only — no automatic job today.',
    plannedPolicy: 'Planned (PLATFORM-086C): Sunday and CFP-release refresh.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: false,
    // Weekly cadence (matches the diagnostics stale-rankings threshold).
    staleAfterMs: 8 * DAY_MS,
  },
  conferences: {
    dataset: 'conferences',
    label: 'Conferences',
    provider: 'CFBD',
    hasActiveAutomation: false,
    currentAutomation: 'Manual/API refresh only — bundled snapshot floor; rarely changes.',
    plannedPolicy: 'Planned: remain manual (reference data, changes infrequently).',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: false,
    // Reference data that changes rarely — a month-old snapshot is not stale.
    staleAfterMs: 30 * DAY_MS,
  },
  'game-stats': {
    dataset: 'game-stats',
    label: 'Game stats',
    provider: 'CFBD',
    hasActiveAutomation: true,
    currentAutomation:
      'Every 15 minutes: at most ONE partition per run, only while a stat-producing game is 3–24h past kickoff with unresolved evidence, and only above the 1,000-call monthly CFBD reserve. Outside the window, manual refresh is the recovery path.',
    plannedPolicy:
      'PLATFORM-086H3E cadence; writing is gated by the operator-controlled writer-control state and the auto-refresh setting. Score automation (PLATFORM-086B) is tracked separately.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: true,
    // Bounded 15-minute kickoff-window polling (PLATFORM-086H3E3): during an
    // active week evidence resolves within hours; a week-old partition without
    // evidence is genuinely stale (window closed — manual refresh required).
    staleAfterMs: 8 * DAY_MS,
  },
};

export function getProviderDatasetDescriptor(dataset: ProviderDataset): ProviderDatasetDescriptor {
  return PROVIDER_DATASET_DESCRIPTORS[dataset];
}
