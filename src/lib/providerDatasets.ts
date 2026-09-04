/**
 * Shared catalog of provider-backed datasets (PLATFORM-086A).
 *
 * This module is intentionally free of server-only imports so it can be shared
 * by the refresh-status/settings stores, the admin API, the admin panel, and
 * any client-side freshness UI. It is the single source of truth for:
 *   - the `ProviderDataset` union used everywhere refresh status/settings key by
 *     dataset;
 *   - human-facing labels, provider names, and the current automation/policy
 *     description for each dataset.
 *
 * IMPORTANT (honesty rule): `currentAutomation` describes what actually runs
 * today, whether through Vercel Cron or a versioned external-QStash manager.
 * `plannedPolicy` is a grandfathered property name: for shipped datasets it
 * summarizes the active fixed policy; for conferences it records that the
 * dataset intentionally remains manual. Never present an active job as future.
 */

export type ProviderDataset =
  | 'scores'
  | 'schedule'
  | 'odds'
  | 'rankings'
  | 'records'
  | 'conferences'
  | 'game-stats';

export const PROVIDER_DATASETS: readonly ProviderDataset[] = [
  'scores',
  'schedule',
  'odds',
  'rankings',
  'records',
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
   * Whether an automatic refresh job for this dataset exists today — a
   * `vercel.json` lifecycle cron or a fixed external QStash schedule provisioned
   * by a versioned management CLI. `false` means manual/API-only.
   */
  hasActiveAutomation: boolean;
  /** Truthful description of the automation that runs today (or its absence). */
  currentAutomation: string;
  /**
   * Read-only fixed-policy summary. The property name predates activation; an
   * `Active (...)` value describes shipped behavior, not future work.
   */
  plannedPolicy: string;
  /**
   * Lifecycle-critical automation (drives preseason→season/season→offseason
   * transitions) is EXEMPT from the global noncritical auto-refresh pause.
   */
  lifecycleCritical: boolean;
  /**
   * Whether an EXISTING automatic job consumes this dataset's auto-refresh
   * enable/disable setting. Six do today: game stats, scores, Odds, ordinary
   * schedule maintenance, rankings, and team records. The panel uses this to
   * avoid implying a toggle has an effect when no job consumes it (conferences).
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const PROVIDER_DATASET_DESCRIPTORS: Record<ProviderDataset, ProviderDatasetDescriptor> = {
  scores: {
    dataset: 'scores',
    label: 'Scores',
    provider: 'CFBD',
    hasActiveAutomation: true,
    currentAutomation:
      'Every 3 minutes (QStash `turfwar-live-scores-3m` → GET /api/cron/live-scores): schedule-armed, polling only kickoff-window games (~15 min before kickoff through 24 h after) while they remain unresolved — at most ONE billed CFBD /scoreboard or /games score request per run, above the 1,000-call monthly reserve, honoring the global pause and the Scores auto-refresh toggle. A newly committed final can additionally trigger the separately tracked, six-hour-floor-gated Team records refresh. Visible browser tabs refresh scores cache-only on a 90-second cadence while a live game is in window.',
    plannedPolicy:
      'Active (PLATFORM-086B2B): fixed 3-minute schedule-armed cadence — the QStash schedule + 90-second browser refresh are version-controlled, not admin-editable; the auto-refresh toggle pauses/resumes the polling.',
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
      'Preseason transition probe (season-transition cron, lifecycle-critical) plus the active weekly in-season route GET /api/cron/schedule-refresh (QStash `turfwar-schedule-weekly`, Tuesdays 12:00 UTC): each active season year gets one complete regular+postseason refresh through the shared full-season authority. Ordinary weekly maintenance honors the global pause and this toggle; the postseason-boundary maintenance that establishes the season-rollover boundary (from 7 days before the latest regular-season kickoff, while leagues remain in season) is lifecycle-critical and exempt.',
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
      'External QStash schedule (hourly) → GET /api/cron/odds. The application polling policy decides whether a provider request is due, on a staged cadence keyed to the nearest eligible kickoff: every ~24 hours when it is 7–45 days out, every ~6 hours inside 7 days, and every ~2 hours during the 6 hours before each America/Chicago slate date’s first kickoff. No eligible game inside 45 days means no request at all. A due run issues one quota-free /sports probe plus at most one 3-credit /odds request, above a 50-credit reserve; the global pause + this Odds toggle gate it, and public traffic stays cache-only.',
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
    hasActiveAutomation: true,
    currentAutomation:
      'Active external QStash heartbeat (`turfwar-rankings-publication`, 04:00 and 22:00 UTC) → GET /api/cron/rankings. The application publication policy — not the heartbeat — decides whether provider work is due (AP/Coaches Sundays, preseason-discovery Mondays before kickoff, opening-week Tuesdays, CFP Wednesdays, final-poll Wednesdays); each due window is claimed durably exactly once, gated by a fresh CFBD /info probe above the 1,007-call rankings reserve, and refreshed through the shared rankings authority. The global pause + this Rankings toggle gate every automatic refresh; manual admin refresh stays available and ungated; public traffic stays cache-only.',
    plannedPolicy:
      'Active (PLATFORM-086E2B): fixed 04:00/22:00 UTC external heartbeat — the QStash schedule, publication windows, and reserve are version-controlled, never admin-editable; the toggle pauses/resumes all automatic rankings refresh.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: true,
    // Weekly cadence (matches the diagnostics stale-rankings threshold).
    staleAfterMs: 8 * DAY_MS,
  },
  records: {
    dataset: 'records',
    label: 'Team records',
    provider: 'CFBD',
    hasActiveAutomation: true,
    currentAutomation:
      'Triggered immediately when live-scores observes a newly final game and independently by the hourly QStash heartbeat (`turfwar-team-records-hourly`). One shared authority applies a six-hour provider-call floor and a twelve-hour cache-age ceiling; the global pause + this Team records toggle gate both callers. The hourly heartbeat is provider-free while the cache is not due.',
    plannedPolicy:
      'Active (PLATFORM-118): one year-wide /records request at most per invocation, a fixed six-hour call floor, a twelve-hour cache-age ceiling, and a fourteen-hour diagnostic threshold with headroom for the hourly trigger.',
    lifecycleCritical: false,
    autoRefreshSettingConsumed: true,
    // A two-hour cache-age margin beyond the 12h refresh ceiling. Since commits
    // can land between hourly slots, this leaves 1-2 hours after the first
    // ceiling-eligible heartbeat. This assumes the hourly job is unpaused; Item
    // 96 must preserve or replace that applicability contract when generalized
    // offseason pausing is built.
    staleAfterMs: 14 * HOUR_MS,
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
