import { classifyScorePackStatus, formatCompactGameStatus } from '../gameStatus';
import { displayOwner } from '../gameOwnership';
import type { OwnerSlateGame, OwnerWeekSlate, WeekMatchupSections } from '../matchups';
import type { ScorePack } from '../scores';
import { isPolicyFcsConference } from '../conferenceSubdivision';

const DEFAULT_VISIBLE_OPPONENTS = 3;
// Selector invariant: this module emits deterministic derived copy/tokens only.

// The two descriptors an UNOWNED opponent collapses onto. Both are correct where
// they render — `MatchupsWeekPanel` suppresses `NoClaim (FBS)` from a row's
// metadata and renders `FCS` deliberately, because an FBS-over-FCS result means
// something different. They are named here only so the COUNT can tell them apart
// from a descriptor that already identifies one opponent (Item 135).
const FCS_DESCRIPTOR = 'FCS';
const NO_CLAIM_FBS_DESCRIPTOR = 'NoClaim (FBS)';
const SELF_DESCRIPTOR = 'Self';

export type OpponentSummaryEntry = {
  /**
   * Identity the count is grouped by — NOT rendered. Distinct from `label`
   * precisely because two entries may share a label: three unowned FBS
   * opponents are three opponents that all describe themselves as
   * `NoClaim (FBS)`.
   */
  key: string;
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

function getOpponentParticipant(slateGame: OwnerSlateGame) {
  return slateGame.ownerTeamSide === 'away'
    ? slateGame.game.participants.home
    : slateGame.game.participants.away;
}

export function deriveOpponentDescriptor(slateGame: OwnerSlateGame): string {
  if (slateGame.opponentOwner) {
    return slateGame.opponentOwner === slateGame.owner
      ? SELF_DESCRIPTOR
      : `vs ${slateGame.opponentOwner}`;
  }

  const opponentConference =
    slateGame.ownerTeamSide === 'away' ? slateGame.game.homeConf : slateGame.game.awayConf;
  const opponentParticipant = getOpponentParticipant(slateGame);

  if (opponentParticipant.kind === 'placeholder' || opponentParticipant.kind === 'derived') {
    return opponentParticipant.displayName;
  }

  if (opponentParticipant.kind !== 'team' || isPolicyFcsConference(opponentConference)) {
    return FCS_DESCRIPTOR;
  }

  return NO_CLAIM_FBS_DESCRIPTOR;
}

function getSummaryOpponentLabel(slateGame: OwnerSlateGame): string {
  const descriptor = deriveOpponentDescriptor(slateGame);
  if (descriptor.startsWith('vs ')) return descriptor.slice(3);
  return descriptor;
}

/**
 * Item 135 — the identity the opponent count groups by.
 *
 * Keying on the DESCRIPTOR undercounted, because an unowned opponent collapses
 * onto a marker rather than identifying itself. Every unowned opponent is keyed
 * on team identity; the grouping every other branch already had is preserved:
 *
 * - owned opponent → the opponent OWNER, so one owner fielding two teams against
 *   this owner in one week stays ONE opponent;
 * - self → a single `self` group, for the same reason;
 * - placeholder / derived → the participant display name, which already
 *   distinguishes one unresolved slot from another.
 *
 * "Unowned" is decided by `displayOwner`, not by an absent `opponentOwner`, and
 * that distinction is the whole fix on a real league. A confirmed draft writes
 * the reserved `NoClaim` owner for every undrafted eligible team
 * (`buildConfirmedOwnersCsv`), and `rosterByTeam` carries those rows through
 * unfiltered — so on production data an unclaimed opponent has a TRUTHY owner.
 * Testing `slateGame.opponentOwner` for truthiness therefore sent every
 * unclaimed team into ONE `owner:NoClaim` group and left the defect exactly as
 * it was; only a fixture that omits unowned teams from the roster hides that.
 * `displayOwner` is the shared seam for the sentinel (AGENTS.md rule 11).
 *
 * Keys are namespaced so a category can never collide with another — an owner
 * named "FCS" is not the FCS opponent group.
 */
function getSummaryOpponentKey(slateGame: OwnerSlateGame): string {
  const opponentOwner = displayOwner(slateGame.opponentOwner);
  if (opponentOwner) {
    return opponentOwner === slateGame.owner ? 'self' : `owner:${opponentOwner}`;
  }

  // Derived from the participant rather than the descriptor: for a
  // NoClaim-owned opponent the descriptor is `vs NoClaim`, which identifies no
  // team and would re-collapse the group this branch exists to split.
  const opponentParticipant = getOpponentParticipant(slateGame);
  if (opponentParticipant.kind === 'placeholder' || opponentParticipant.kind === 'derived') {
    return `label:${opponentParticipant.displayName}`;
  }

  return `team:${slateGame.opponentTeamId || slateGame.opponentTeamName || opponentParticipant.displayName}`;
}

export function summarizeSlateOpponents(slate: OwnerWeekSlate): OpponentSummaryEntry[] {
  const entries = new Map<string, OpponentSummaryEntry>();

  for (const game of slate.games) {
    const key = getSummaryOpponentKey(game);
    const existing = entries.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    entries.set(key, { key, label: getSummaryOpponentLabel(game), count: 1 });
  }

  // Map iteration is insertion-ordered, preserving first-appearance order.
  return [...entries.values()];
}

export type SlateOpponentVisibility = {
  entries: OpponentSummaryEntry[];
  /** The games to render. Collapsed, this is a SUBSET of `slate.games`. */
  visibleGames: OwnerSlateGame[];
  /** Opponents withheld while collapsed — the number the control's label states. */
  hiddenOpponentCount: number;
  hasHiddenOpponents: boolean;
};

/**
 * Item 135 — what an owner card shows, collapsed or expanded.
 *
 * The control's label counts OPPONENTS while the list renders GAMES, so
 * collapsing has to slice by opponent: the visible games are those whose
 * opponent falls within the first `DEFAULT_VISIBLE_OPPONENTS` summary entries
 * (first-appearance order). Slicing the games array instead would leave the
 * label stating a number of opponents that bears no relation to what was
 * withheld.
 *
 * `hiddenOpponentCount` is therefore exactly the number of opponents no visible
 * game represents, which is what makes "Show N more opponents" true.
 */
export function selectSlateOpponentVisibility(
  slate: OwnerWeekSlate,
  expanded: boolean
): SlateOpponentVisibility {
  const entries = summarizeSlateOpponents(slate);
  const hiddenOpponentCount = Math.max(entries.length - DEFAULT_VISIBLE_OPPONENTS, 0);
  const hasHiddenOpponents = hiddenOpponentCount > 0;

  if (expanded || !hasHiddenOpponents) {
    return { entries, visibleGames: slate.games, hiddenOpponentCount, hasHiddenOpponents };
  }

  const visibleKeys = new Set(
    entries.slice(0, DEFAULT_VISIBLE_OPPONENTS).map((entry) => entry.key)
  );

  return {
    entries,
    visibleGames: slate.games.filter((game) => visibleKeys.has(getSummaryOpponentKey(game))),
    hiddenOpponentCount,
    hasHiddenOpponents,
  };
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

export function deriveExcludedGamesSummary(sections: WeekMatchupSections): string {
  if (sections.otherGames.length === 0) {
    return 'All games this week appear on an owner card.';
  }

  const gameCount = sections.otherGames.length;
  const noun = gameCount === 1 ? 'game' : 'games';
  const verb = gameCount === 1 ? 'does' : 'do';
  return `${gameCount} excluded ${noun} ${verb} not involve owned teams.`;
}

export function getDefaultVisibleOpponentsCount(): number {
  return DEFAULT_VISIBLE_OPPONENTS;
}
