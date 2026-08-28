import { classifyGameConclusionEvidence, classifyScorePackStatus } from './gameStatus.ts';
import { getGameOwners } from './gameOwnership.ts';
import type { ScorePack } from './scores.ts';
import type { AppGame } from './schedule.ts';

export type OwnedFinalParticipation = {
  owner: string;
  game: AppGame;
  teamSide: 'away' | 'home';
  teamName: string;
  opponentTeamName: string;
  opponentOwner?: string;
  pointsFor: number;
  pointsAgainst: number;
  result: 'win' | 'loss';
};

export type OwnerStandingsRow = {
  owner: string;
  wins: number;
  losses: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  gamesBack: number;
  finalGames: number;
};

export type StandingsSnapshot = {
  /** Primary rows, sorted canonically; NoClaim is excluded. */
  rows: OwnerStandingsRow[];
  /** NoClaim's own standings row, when the underlying roster contained one. */
  noClaimRow: OwnerStandingsRow | null;
  participations: OwnedFinalParticipation[];
  leaderWins: number;
};

export type StandingsCoverageState = 'complete' | 'partial' | 'error';

export type StandingsCoverage = {
  state: StandingsCoverageState;
  message: string | null;
};

export const NO_CLAIM_OWNER = 'NoClaim';

/** The one claim an incomplete standings snapshot makes (POLISH-011). */
const COVERAGE_INCOMPLETE = 'Waiting on complete results';
/** The same claim for surfaces with no standings heading to supply the subject. */
const COVERAGE_INCOMPLETE_WITH_SUBJECT = 'Standings — waiting on complete results';

/** Canonical member-facing claim for a known partial result population. */
export function standingsIncompleteResultsNotice(): string {
  return COVERAGE_INCOMPLETE;
}

/**
 * Splits a sorted list of owner standings into real-owner rows and the NoClaim
 * aggregate (when present). Mirrors the canonical selector's filter so every
 * consumer of standings data — live derivation and archive reads — produces
 * the same {rows, noClaimRow} shape and never accidentally renders NoClaim.
 */
export function splitOutNoClaim(rows: OwnerStandingsRow[]): {
  rows: OwnerStandingsRow[];
  noClaimRow: OwnerStandingsRow | null;
} {
  let noClaimRow: OwnerStandingsRow | null = null;
  const filtered: OwnerStandingsRow[] = [];
  for (const row of rows) {
    if (row.owner === NO_CLAIM_OWNER) {
      noClaimRow = row;
      continue;
    }
    filtered.push(row);
  }
  return { rows: filtered, noClaimRow };
}

function hasOwnedTeam(game: AppGame, rosterByTeam: Map<string, string>): boolean {
  const { awayOwner, homeOwner } = getGameOwners(game, rosterByTeam);
  return awayOwner !== undefined || homeOwner !== undefined;
}

export function deriveStandingsCoverage(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): StandingsCoverage {
  const hasMissingFinalScores = games.some((game) => {
    const score = scoresByKey[game.key];
    if (classifyGameConclusionEvidence(game, score) !== 'score-required') return false;
    if (!hasOwnedTeam(game, rosterByTeam)) return false;
    if (classifyScorePackStatus(score) !== 'final') return true;

    return score?.away.score == null || score.home.score == null;
  });

  if (!hasMissingFinalScores) {
    return { state: 'complete', message: null };
  }

  // POLISH-011 (owner decision, 2026-08-22). The member surface makes ONE simple
  // claim; the actionable detail — which game, which partition, whether a sweep
  // ran — belongs on System Health (item 67), not here.
  //
  // This branch means exactly one thing: an owned game has score-bearing
  // conclusion evidence and no usable final. It does NOT mean automatic repair
  // was attempted and failed. PLATFORM-107's sweep runs after the schedule
  // commit, but only when the caller asks for it: a manual full-year admin
  // refresh does not (`api/schedule/route.ts` full-season path), and the weekly
  // cron skips it whenever score automation is paused or disabled
  // (`api/cron/schedule-refresh/route.ts`). So a result may still be genuinely
  // en route — which is why "Waiting" is the honest verb, and why the earlier
  // "…are not available YET" was not: it promised a specific imminence this
  // predicate cannot support, and "may be incomplete" hedged a fact we hold
  // positive evidence for.
  //
  // The `error` STATE is deliberately not produced here. It remains reachable via
  // `STANDINGS_COVERAGE_UNAVAILABLE` and still drives the amber styling.
  return {
    state: 'partial',
    message: COVERAGE_INCOMPLETE,
  };
}

/**
 * The coverage notice each member surface should render.
 *
 * Neither surface renders `coverage.message` directly for the `partial` state,
 * and that is the point. `coverage` is DURABLE — `seasonRollover` freezes it into
 * season archives, and canonical standings are cached with `revalidate: false`
 * under a key that does not change when copy changes, so a snapshot minted before
 * a wording change keeps serving the retired sentence until some unrelated
 * invalidation, which may never come for a quiet league.
 *
 * SCOPE, precisely: `complete` renders nothing, `partial` is normalized from
 * STATE ALONE — a stored message is never consulted, so a snapshot whose message
 * is absent or retired still shows current wording — and `error` passes its
 * message through verbatim, which is safe ONLY because the sole `error` producers
 * today are the live `*_COVERAGE_UNAVAILABLE` constants — nothing durable emits
 * one. `docs/next-tasks.md` item 69 leaves open whether `error` gains its own
 * string; the first writer that PERSISTS an `error` message reintroduces exactly
 * the stale-copy defect this function exists to prevent, and must normalize here
 * too. An earlier version of this comment claimed neither surface ever renders
 * the raw message, which was wider than the code.
 *
 * An earlier round applied this reasoning to Overview ONLY and left
 * `StandingsPanel` echoing the raw message. Both reviewers caught it: the same
 * snapshot would render the new wording on Overview and the deleted sentence on
 * the standings page — the surface the owner's decision was actually about.
 *
 * The two forms differ only in whether the surface supplies the subject.
 * `StandingsPanel` sits inside the standings view already (the "League Table"
 * sub-tab under the "Standings" primary tab), so the short form reads fine.
 * Overview shows the identical line above standings, FBS polls and insights
 * together under a tab reading "Overview", so a bare fragment cannot say which
 * of the three is waiting.
 *
 * A blind "Standings: " prefix would be wrong — the `*_COVERAGE_UNAVAILABLE`
 * constants already name their own subject and would read "Standings: Standings
 * coverage is unavailable." Both forms are written out instead. If `partial`
 * ever gains more than one meaning, add a reason code rather than inspecting
 * display text.
 */
export function standingsCoverageNotice(coverage: StandingsCoverage): string | null {
  if (coverage.state === 'complete') return null;
  if (coverage.state === 'partial') return COVERAGE_INCOMPLETE;
  return coverage.message;
}

/** As {@link standingsCoverageNotice}, for a surface that must name its subject. */
export function standingsCoverageNoticeWithSubject(coverage: StandingsCoverage): string | null {
  if (coverage.state === 'complete') return null;
  if (coverage.state === 'partial') return COVERAGE_INCOMPLETE_WITH_SUBJECT;
  return coverage.message;
}

function toOwnedFinalResult(
  side: 'away' | 'home',
  awayScore: number,
  homeScore: number
): 'win' | 'loss' {
  if (side === 'away') {
    return awayScore > homeScore ? 'win' : 'loss';
  }

  return homeScore > awayScore ? 'win' : 'loss';
}

export function deriveFinalOwnedParticipations(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): OwnedFinalParticipation[] {
  const participations: OwnedFinalParticipation[] = [];

  for (const game of games) {
    const score = scoresByKey[game.key];
    if (classifyScorePackStatus(score) !== 'final') continue;

    const awayScore = score.away.score;
    const homeScore = score.home.score;
    if (awayScore == null || homeScore == null) continue;

    const { awayOwner, homeOwner } = getGameOwners(game, rosterByTeam);

    if (awayScore === homeScore) {
      console.warn(
        `[standings] Ignoring unexpected final tie for ${game.key} (${game.csvAway} ${awayScore}-${homeScore} ${game.csvHome}).`
      );
      continue;
    }

    const awayResult = awayOwner ? toOwnedFinalResult('away', awayScore, homeScore) : null;
    const homeResult = homeOwner ? toOwnedFinalResult('home', awayScore, homeScore) : null;

    if (awayOwner && awayResult) {
      participations.push({
        owner: awayOwner,
        game,
        teamSide: 'away',
        teamName: game.csvAway,
        opponentTeamName: game.csvHome,
        opponentOwner: homeOwner,
        pointsFor: awayScore,
        pointsAgainst: homeScore,
        result: awayResult,
      });
    }

    if (homeOwner && homeResult) {
      participations.push({
        owner: homeOwner,
        game,
        teamSide: 'home',
        teamName: game.csvHome,
        opponentTeamName: game.csvAway,
        opponentOwner: awayOwner,
        pointsFor: homeScore,
        pointsAgainst: awayScore,
        result: homeResult,
      });
    }
  }

  return participations;
}

export function deriveStandings(
  games: AppGame[],
  rosterByTeam: Map<string, string>,
  scoresByKey: Record<string, ScorePack>
): StandingsSnapshot {
  const owners = Array.from(new Set(rosterByTeam.values())).sort((a, b) => a.localeCompare(b));
  const participations = deriveFinalOwnedParticipations(games, rosterByTeam, scoresByKey);
  const totals = new Map<
    string,
    Omit<OwnerStandingsRow, 'gamesBack' | 'pointDifferential' | 'winPct'>
  >();

  for (const owner of owners) {
    totals.set(owner, {
      owner,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      finalGames: 0,
    });
  }

  for (const participation of participations) {
    const current = totals.get(participation.owner) ?? {
      owner: participation.owner,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      finalGames: 0,
    };

    if (participation.result === 'win') current.wins += 1;
    if (participation.result === 'loss') current.losses += 1;
    current.pointsFor += participation.pointsFor;
    current.pointsAgainst += participation.pointsAgainst;
    current.finalGames += 1;
    totals.set(participation.owner, current);
  }

  // League standings precedence (SOURCE OF TRUTH):
  // 1. Total Wins (primary ranking metric)
  // 2. Win Percentage (tiebreaker — accounts for unequal games played)
  // 3. Point Differential (secondary tiebreaker)
  //
  // This matches official league rules (confirmed via season-final standings email).
  // Do NOT reorder without updating league rules documentation.
  //
  // gamesBack is intentionally not computed here. NoClaim is excluded from the
  // visible standings (splitOutNoClaim below), so leaderWins must be derived
  // from real-owner rows only — otherwise a high-win NoClaim aggregate would
  // give every visible row a non-zero GB with no leader at 0. We compute
  // leaderWins and gamesBack post-split.
  const sortedAllRows = Array.from(totals.values())
    .map((row) => {
      const decisions = row.wins + row.losses;
      const pointDifferential = row.pointsFor - row.pointsAgainst;
      return {
        ...row,
        winPct: decisions > 0 ? row.wins / decisions : 0,
        pointDifferential,
        gamesBack: 0,
      };
    })
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winPct !== a.winPct) return b.winPct - a.winPct;
      if (b.pointDifferential !== a.pointDifferential) {
        return b.pointDifferential - a.pointDifferential;
      }
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      return a.owner.localeCompare(b.owner);
    });

  const { rows: realRows, noClaimRow: rawNoClaimRow } = splitOutNoClaim(sortedAllRows);
  const leaderWins = realRows.reduce((best, row) => Math.max(best, row.wins), 0);
  const rows = realRows.map((row) => ({ ...row, gamesBack: leaderWins - row.wins }));
  // noClaimRow.gamesBack is computed against the real-owner leader so admin /
  // diagnostic surfaces that render NoClaim alongside real owners see a
  // consistent "games behind real leader" value (Option b). NoClaim leading
  // its own aggregate doesn't make it a competitor in the visible standings.
  const noClaimRow = rawNoClaimRow
    ? { ...rawNoClaimRow, gamesBack: leaderWins - rawNoClaimRow.wins }
    : null;
  return { rows, noClaimRow, participations, leaderWins };
}
