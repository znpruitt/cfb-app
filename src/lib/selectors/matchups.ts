import { classifyScorePackStatus, formatCompactGameStatus } from '../gameStatus';
import type {
  MatchupBucket,
  OwnerSlateGame,
  OwnerWeekSlate,
  WeekMatchupSections,
} from '../matchups';
import type { ScorePack } from '../scores';
import { isPolicyFcsConference } from '../conferenceSubdivision';
import { getGameParticipantTeamId } from '../schedule';
import type { GameScoreboardState } from './gameScoreboardState';
import { projectOwnerSlateGameState, type OwnerSlateSurfaceProjection } from './ownerGameState';

// Games shown before an owner card collapses the rest behind its control.
const DEFAULT_VISIBLE_GAMES = 3;
// Opponent groups the DORMANT `formatSlateSummaryText` lists before summarising
// the rest as `+N`. Deliberately distinct from `DEFAULT_VISIBLE_GAMES`: that one
// counts games, this one counts opponent groups, and they are equal by
// coincidence rather than by rule.
const DEFAULT_VISIBLE_OPPONENTS = 3;
// Selector invariant: this module emits deterministic derived copy/tokens only.

// The two descriptors an UNOWNED opponent collapses onto, plus the self marker.
// Named for the render contract they carry, which is the standing gate on this
// module: `MatchupsWeekPanel` suppresses `NoClaim (FBS)` from a row's metadata
// and renders `FCS` deliberately, because an FBS-over-FCS result means something
// different. Nothing counts descriptors — the owner-card control counts games
// (Item 135) — so `deriveOpponentDescriptor` is their only consumer.
const FCS_DESCRIPTOR = 'FCS';
const NO_CLAIM_FBS_DESCRIPTOR = 'NoClaim (FBS)';
const SELF_DESCRIPTOR = 'Self';

/** Raw owned-side entries for one bucket; a self game deliberately emits two. */
export function selectOwnerSlateGamesForBucket(
  bucket: MatchupBucket,
  owner: string
): OwnerSlateGame[] {
  const games: OwnerSlateGame[] = [];

  if (bucket.awayOwner === owner) {
    games.push({
      owner,
      game: bucket.game,
      ownerTeamSide: 'away',
      ownerTeamId: getGameParticipantTeamId(bucket.game, 'away') ?? bucket.game.canAway,
      ownerTeamName: bucket.game.csvAway,
      opponentTeamId: getGameParticipantTeamId(bucket.game, 'home') ?? bucket.game.canHome,
      opponentTeamName: bucket.game.csvHome,
      opponentOwner: bucket.homeOwner,
      isOwnerVsOwner: Boolean(bucket.homeOwner),
      isOpponentUnownedOrNonLeague: !bucket.homeOwner,
    });
  }

  if (bucket.homeOwner === owner) {
    games.push({
      owner,
      game: bucket.game,
      ownerTeamSide: 'home',
      ownerTeamId: getGameParticipantTeamId(bucket.game, 'home') ?? bucket.game.canHome,
      ownerTeamName: bucket.game.csvHome,
      opponentTeamId: getGameParticipantTeamId(bucket.game, 'away') ?? bucket.game.canAway,
      opponentTeamName: bucket.game.csvAway,
      opponentOwner: bucket.awayOwner,
      isOwnerVsOwner: Boolean(bucket.awayOwner),
      isOpponentUnownedOrNonLeague: !bucket.awayOwner,
    });
  }

  return games;
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
 * Item 135 — the distinct GAMES on an owner's slate, in slate order.
 *
 * `selectOwnerSlateGamesForBucket` above has two independent `if` blocks, one
 * per side, so an owner holding BOTH teams in a game gets TWO raw slate entries
 * for that one game — mirror images differing only in `ownerTeamSide`.
 * The 2026 season carries 39 such games out of 888 involving a rostered team,
 * so this is production's shape rather than an edge case.
 *
 * A game is one game. First occurrence wins, which is the `away` entry: the two
 * entries compare equal on every sort key, so their push order survives, and an
 * away-first row states the scoreline in the order the matchup line prints it.
 */
export function selectDistinctOwnerSlateGames(games: OwnerSlateGame[]): OwnerSlateGame[] {
  const seen = new Set<string>();
  const distinct: OwnerSlateGame[] = [];

  for (const slateGame of games) {
    if (seen.has(slateGame.game.key)) continue;
    seen.add(slateGame.game.key);
    distinct.push(slateGame);
  }

  return distinct;
}

export function selectDistinctSlateGames(slate: OwnerWeekSlate): OwnerSlateGame[] {
  return selectDistinctOwnerSlateGames(slate.games);
}

export type OwnerSlateStateProjection = {
  games: OwnerSlateGame[];
  totalGames: number;
  liveGames: number;
  finalGames: number;
  scheduledGames: number;
  unavailableGames: number;
};

type ProjectedSlateGame = {
  slateGame: OwnerSlateGame;
  state: GameScoreboardState;
};

function stateSortRank(state: GameScoreboardState): number {
  switch (state) {
    case 'scheduled':
    case 'live':
    case 'awaiting':
    case 'unavailable':
      return 0;
    case 'final':
      return 1;
  }
}

function kickoffSortTime(slateGame: OwnerSlateGame): number {
  const parsed = slateGame.game.date ? Date.parse(slateGame.game.date) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function compareProjectedSlateGames(a: ProjectedSlateGame, b: ProjectedSlateGame): number {
  const rankDiff = stateSortRank(a.state) - stateSortRank(b.state);
  if (rankDiff !== 0) return rankDiff;

  const kickoffDiff = kickoffSortTime(a.slateGame) - kickoffSortTime(b.slateGame);
  if (kickoffDiff !== 0) return kickoffDiff;
  return a.slateGame.game.key.localeCompare(b.slateGame.game.key);
}

function incrementSlateStateCount(
  counts: Omit<OwnerSlateStateProjection, 'games' | 'totalGames'>,
  state: GameScoreboardState
): void {
  switch (state) {
    case 'scheduled':
      counts.scheduledGames += 1;
      return;
    case 'live':
    case 'awaiting':
      counts.liveGames += 1;
      return;
    case 'unavailable':
      counts.unavailableGames += 1;
      return;
    case 'final':
      counts.finalGames += 1;
      return;
  }
}

/**
 * One distinct game population and one complete surface projection feed slate
 * ordering and every state count. The UI may no longer deduplicate or reclassify
 * this result independently.
 */
export function selectOwnerSlateStateProjection(params: {
  games: OwnerSlateGame[];
  scoresByKey: Record<string, ScorePack>;
  projection: OwnerSlateSurfaceProjection;
}): OwnerSlateStateProjection {
  const { games, scoresByKey, projection } = params;
  const projectedGames = selectDistinctOwnerSlateGames(games).map(
    (slateGame): ProjectedSlateGame => ({
      slateGame,
      state: projectOwnerSlateGameState({
        game: slateGame.game,
        score: scoresByKey[slateGame.game.key],
        projection,
      }),
    })
  );
  const counts = {
    liveGames: 0,
    finalGames: 0,
    scheduledGames: 0,
    unavailableGames: 0,
  };

  for (const projected of projectedGames) incrementSlateStateCount(counts, projected.state);
  projectedGames.sort(compareProjectedSlateGames);

  return {
    games: projectedGames.map(({ slateGame }) => slateGame),
    totalGames: projectedGames.length,
    ...counts,
  };
}

/**
 * Opponent groups for the DORMANT `formatSlateSummaryText`, which is the only
 * thing that needs them — it renders prose like `5 games · vs Alice, FCS (x2)`.
 * Nothing in production calls it; Item 117 decides its fate. The owner-card
 * control no longer consumes this: it counts games, which is what it renders.
 *
 * These groups are built over DISTINCT games, as is `slate.totalGames`. The
 * defensive selector call keeps hand-built/legacy slate fixtures from restoring
 * mirrored self-game entries at this presentation boundary.
 */
export function summarizeSlateOpponents(slate: OwnerWeekSlate): OpponentSummaryEntry[] {
  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const slateGame of selectDistinctSlateGames(slate)) {
    const label = getSummaryOpponentLabel(slateGame);
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return order.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

export type SlateGameVisibility = {
  /** Every game on the slate, deduplicated — one entry per real game. */
  distinctGames: OwnerSlateGame[];
  /** The games to render. Collapsed, this is a prefix of `distinctGames`. */
  visibleGames: OwnerSlateGame[];
  /** Games withheld while collapsed — the number the control's label states. */
  hiddenGameCount: number;
  hasHiddenGames: boolean;
};

/**
 * Item 135 — what an owner card shows, collapsed or expanded.
 *
 * The count is of GAMES, matching the unit the list renders. It previously
 * grouped OPPONENTS — a shape borrowed from `formatSlateSummaryText`, which
 * genuinely needs groups and has no production caller. Every defect on this
 * control descended from that mismatch: a label counting one thing while the
 * list showed another, which is also what let two mirrored rows of a single
 * self game hide behind a count of one opponent. Counting the rendered unit
 * removes the class rather than the instance.
 */
export function selectSlateGameVisibility(
  slate: OwnerWeekSlate,
  expanded: boolean
): SlateGameVisibility {
  const distinctGames = selectDistinctSlateGames(slate);
  const hiddenGameCount = Math.max(distinctGames.length - DEFAULT_VISIBLE_GAMES, 0);
  const hasHiddenGames = hiddenGameCount > 0;

  return {
    distinctGames,
    visibleGames:
      expanded || !hasHiddenGames ? distinctGames : distinctGames.slice(0, DEFAULT_VISIBLE_GAMES),
    hiddenGameCount,
    hasHiddenGames,
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
  // Disrupted-label vocabulary is a FORWARD-LOOKING guard, not observed behaviour: read the
  // measurement note above `DISRUPTED_RE` in `src/lib/gameStatus.ts` before reasoning from this
  // comment (Item 661).
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

export function getDefaultVisibleGamesCount(): number {
  return DEFAULT_VISIBLE_GAMES;
}
