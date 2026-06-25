import type { TeamCatalogItem } from '@/lib/teamIdentity';

export type DraftPhase = 'setup' | 'settings' | 'preview' | 'live' | 'paused' | 'complete';

export type DraftSettings = {
  style: 'snake';
  draftOrder: string[];
  pickTimerSeconds: number | null;
  timerExpiryBehavior: 'pause-and-prompt' | 'auto-pick';
  autoPickMetric: 'sp-plus' | 'preseason-rank' | null;
  totalRounds: number;
  scheduledAt: string | null;
};

export type DraftPick = {
  pickNumber: number;
  round: number;
  roundPick: number;
  owner: string;
  team: string;
  pickedAt: string;
  autoSelected: boolean;
};

export type DraftState = {
  leagueSlug: string;
  year: number;
  phase: DraftPhase;
  owners: string[];
  settings: DraftSettings;
  picks: DraftPick[];
  currentPickIndex: number;
  timerState: 'running' | 'paused' | 'expired' | 'off';
  timerExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function defaultDraftSettings(owners: string[] = []): DraftSettings {
  return {
    style: 'snake',
    draftOrder: owners,
    pickTimerSeconds: 60,
    timerExpiryBehavior: 'pause-and-prompt',
    autoPickMetric: null,
    totalRounds: 1,
    scheduledAt: null,
  };
}

export function draftScope(leagueSlug: string): string {
  return `draft:${leagueSlug}`;
}

/**
 * Schools in the team catalog that exist only as schedule-side placeholders and
 * can never be assigned to an owner. `NoClaim` absorbs games that belong to no
 * owner and must be excluded from every draft-eligibility computation.
 */
export const NON_DRAFTABLE_SCHOOLS: ReadonlySet<string> = new Set(['NoClaim']);

/** Whether a single catalog team is eligible to be drafted by an owner. */
export function isDraftEligibleTeam(team: Pick<TeamCatalogItem, 'school'>): boolean {
  return !NON_DRAFTABLE_SCHOOLS.has(team.school);
}

/**
 * Single source of truth for "which catalog teams count toward a draft."
 *
 * Setup/update round limits, auto-pick candidate pools, and confirmation expected
 * counts must all derive from this helper so they can never diverge. Eligibility is
 * defined by excluding the `NoClaim` placeholder — NOT by a `classification` field,
 * which is absent from the current `teams.json` shape and would yield zero eligible
 * teams if relied upon.
 */
export function getDraftEligibleTeams<T extends Pick<TeamCatalogItem, 'school'>>(items: T[]): T[] {
  return items.filter(isDraftEligibleTeam);
}
