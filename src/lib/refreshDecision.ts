export type RefreshDecisionReason =
  | 'manual-cooldown'
  | 'no-games'
  | 'odds-disabled-by-plan'
  | 'odds-disabled-by-quota'
  | 'scores-and-odds';

export type RefreshDecision =
  | { kind: 'skip'; reason: 'manual-cooldown' | 'no-games' }
  | { kind: 'scores_only'; reason: 'odds-disabled-by-plan' | 'odds-disabled-by-quota' }
  | { kind: 'scores_and_odds'; reason: 'scores-and-odds' };

export function decideRefresh(params: {
  hasGames: boolean;
  manual: boolean;
  manualCooldownActive: boolean;
  includeOddsRequested: boolean;
  oddsAutoDisabledByQuota: boolean;
}): RefreshDecision {
  const { hasGames, manualCooldownActive, includeOddsRequested, oddsAutoDisabledByQuota } = params;

  if (manualCooldownActive) return { kind: 'skip', reason: 'manual-cooldown' };
  if (!hasGames) return { kind: 'skip', reason: 'no-games' };
  if (!includeOddsRequested) return { kind: 'scores_only', reason: 'odds-disabled-by-plan' };
  if (oddsAutoDisabledByQuota) return { kind: 'scores_only', reason: 'odds-disabled-by-quota' };
  return { kind: 'scores_and_odds', reason: 'scores-and-odds' };
}
