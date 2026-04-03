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
