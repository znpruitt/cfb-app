import { classifyScorePackStatus, formatCompactGameStatus } from '../gameStatus';
import type { OwnerSlateGame, OwnerWeekSlate, WeekMatchupSections } from '../matchups';
import type { ScorePack } from '../scores';

const DEFAULT_VISIBLE_OPPONENTS = 3;

function isFcsConference(conference: string | null | undefined): boolean {
  return /\bfcs\b/i.test(conference ?? '');
}

export type OpponentSummaryEntry = {
  label: string;
  count: number;
};

export type GameOutcomeTone =
  | 'scheduled'
  | 'inprogress'
  | 'finalWin'
  | 'finalLoss'
  | 'finalSelf'
  | 'neutral';

export function deriveOpponentDescriptor(slateGame: OwnerSlateGame): string {
  if (slateGame.opponentOwner) {
    return slateGame.opponentOwner === slateGame.owner ? 'Self' : `vs ${slateGame.opponentOwner}`;
  }

  const opponentConference =
    slateGame.ownerTeamSide === 'away' ? slateGame.game.homeConf : slateGame.game.awayConf;
  const opponentParticipant =
    slateGame.ownerTeamSide === 'away'
      ? slateGame.game.participants.home
      : slateGame.game.participants.away;

  if (opponentParticipant.kind === 'placeholder' || opponentParticipant.kind === 'derived') {
    return opponentParticipant.displayName;
  }

  if (opponentParticipant.kind !== 'team' || isFcsConference(opponentConference)) {
    return 'FCS';
  }

  return 'NoClaim (FBS)';
}

function getSummaryOpponentLabel(slateGame: OwnerSlateGame): string {
  const descriptor = deriveOpponentDescriptor(slateGame);
  if (descriptor.startsWith('vs ')) return descriptor.slice(3);
  return descriptor;
}

export function summarizeSlateOpponents(slate: OwnerWeekSlate): OpponentSummaryEntry[] {
  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const game of slate.games) {
    const label = getSummaryOpponentLabel(game);
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return order.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

function formatOpponentSummaryEntry(entry: OpponentSummaryEntry): string {
  return entry.count > 1 ? `${entry.label} (x${entry.count})` : entry.label;
}

export function formatSlateSummaryText(params: {
  entries: OpponentSummaryEntry[];
  totalGames: number;
  expanded: boolean;
}): string {
  const { entries, totalGames, expanded } = params;
  const visibleEntries = expanded ? entries : entries.slice(0, DEFAULT_VISIBLE_OPPONENTS);
  const hiddenCount = Math.max(entries.length - visibleEntries.length, 0);
  const baseSummary = visibleEntries.length
    ? visibleEntries.map(formatOpponentSummaryEntry).join(', ')
    : '—';
  const suffix = hiddenCount > 0 && !expanded ? ` +${hiddenCount}` : '';
  return `${totalGames} game${totalGames === 1 ? '' : 's'} · vs ${baseSummary}${suffix}`;
}

function isSelfGame(slateGame: OwnerSlateGame): boolean {
  return slateGame.opponentOwner === slateGame.owner;
}

export function deriveOwnerOutcome(params: { slateGame: OwnerSlateGame; score?: ScorePack }): {
  summary: string;
  tone: GameOutcomeTone;
  detail?: string;
} {
  const { slateGame, score } = params;
  const stateBucket = classifyScorePackStatus(score);
  const state = stateBucket === 'disrupted' ? 'scheduled' : stateBucket;

  if (!score) {
    return { summary: 'Scheduled', tone: 'scheduled' };
  }

  const ownerScore = slateGame.ownerTeamSide === 'away' ? score.away.score : score.home.score;
  const opponentScore = slateGame.ownerTeamSide === 'away' ? score.home.score : score.away.score;
  const selfGame = isSelfGame(slateGame);

  if (ownerScore == null || opponentScore == null || state === 'scheduled') {
    return {
      summary: formatCompactGameStatus(score),
      tone: state === 'final' ? 'neutral' : state,
    };
  }

  if (selfGame) {
    const symmetricSummary = `${slateGame.ownerTeamName} ${ownerScore} • ${slateGame.opponentTeamName} ${opponentScore}`;

    if (state === 'final' && ownerScore === opponentScore) {
      return {
        summary: symmetricSummary,
        tone: 'neutral',
        detail: 'Unexpected final tie',
      };
    }

    return {
      summary: symmetricSummary,
      tone: state === 'final' ? 'finalSelf' : state,
      detail: state === 'final' ? 'Counts as 1W / 1L' : undefined,
    };
  }

  const base = `${ownerScore}-${opponentScore}`;
  if (ownerScore === opponentScore) {
    return { summary: state === 'final' ? `${base} (final)` : `Tied ${base}`, tone: 'neutral' };
  }

  if (state === 'final') {
    return {
      summary: `${base} (final)`,
      tone: ownerScore > opponentScore ? 'finalWin' : 'finalLoss',
    };
  }

  const verdict = ownerScore > opponentScore ? 'Leading' : 'Trailing';
  return { summary: `${verdict} ${base}`, tone: state };
}

export function deriveMatchupsHeaderCopy(params: {
  gamesCount: number;
  oddsAvailableCount: number;
}): string | null {
  const { gamesCount, oddsAvailableCount } = params;
  if (gamesCount === 0 || oddsAvailableCount === gamesCount) return null;
  if (oddsAvailableCount === 0) return 'Odds are unavailable.';
  return `Odds available for ${oddsAvailableCount}/${gamesCount} games.`;
}

export function deriveExcludedGamesSummary(sections: WeekMatchupSections): string {
  if (sections.otherGames.length === 0) {
    return 'All games this week appear on a surname card.';
  }

  return `${sections.otherGames.length} excluded game${sections.otherGames.length === 1 ? '' : 's'} do not involve owned teams.`;
}

export function getDefaultVisibleOpponentsCount(): number {
  return DEFAULT_VISIBLE_OPPONENTS;
}
