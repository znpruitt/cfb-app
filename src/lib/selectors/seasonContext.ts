import { hasGameBeenAbandoned, type StandingsHistory } from '../standingsHistory';
import { isPlayedWeek, selectPlayedWeeks } from './historyResolution';

export type SeasonContext = 'in-season' | 'postseason' | 'final';

// FBS regular season is 15 weeks; conference championships and first-round
// playoff games begin in week 16. This constant is stable for standard schedules.
// If non-standard schedules (< 15 regular-season weeks) become a concern, derive
// this from schedule game stages instead of using a fixed value.
const POSTSEASON_START_WEEK = 16;

export function selectSeasonContext(args: {
  standingsHistory: StandingsHistory | null;
  /**
   * Evaluation time for the abandonment allowance. Defaults to now; passed
   * explicitly by tests, and by any caller replaying a past moment.
   */
  now?: Date;
}): SeasonContext {
  const { standingsHistory, now } = args;
  if (!standingsHistory || standingsHistory.weeks.length === 0) return 'in-season';

  // PLATFORM-105 — BOTH finality and phase come from PLAYED weeks. The first
  // round moved only the finality test and left the early guard and the
  // postseason branch on `latestResolvedWeek`, so a played week 16 with partial
  // score coverage still read `in-season`, and a finished season with a coverage
  // gap in every week did too — the exact defect item 52 originally described,
  // surviving inside its own fix.
  //
  // Resolved weeks are for usable standings SNAPSHOTS. Progress is a different
  // question and no longer borrows that answer.
  // SEASON-OVER IS A QUESTION ABOUT GAMES (owner ruling, 2026-08-20): the season
  // is over when every REAL game has a result. Asking it week-by-week is what let
  // an all-shell playoff week block a season that had finished, and it re-fused
  // the two questions this module exists to separate.
  //
  // The abandonment allowance is applied HERE, at request time, from the
  // time-invariant `pending` list on each snapshot — never inside the cached
  // selector, per AGENTS.md invariant 3.
  const evaluatedAt = now ?? new Date();
  const unresolved = standingsHistory.weeks.flatMap(
    (week) => standingsHistory.byWeek[week]?.pending ?? []
  );

  // PLATFORM-109 remediation — `unresolved.every(...)` is VACUOUSLY TRUE for an
  // empty list, so "nothing pending" used to answer `final` on its own. That is
  // right when the emptiness is a FACT (every week said `pending: []`) and wrong
  // when it merely means nobody told us: PLATFORM-109 began stripping `pending`
  // before the snapshot crosses to the client, and two independent reviews
  // caught the stripped copy reaching `selectOverviewViewModel` and reclassifying
  // a live season as over. `docs/next-tasks.md` item 64 recorded this as latent.
  // It stopped being latent.
  //
  // So the question is per week: can this week's games answer at all?
  //  - `pending` PRESENT (even empty) — yes. An empty list is the positive fact
  //    that nothing is being waited on, which is what lets an all-bracket
  //    playoff week stop blocking a finished season (owner ruling, 2026-08-20).
  //  - `pending` ABSENT but the week was PLAYED — yes, and this is the durable
  //    archive: `buildSeasonArchive` strips the field, and an archive is a
  //    completed season by construction.
  //  - `pending` ABSENT and NOT played — no. Nothing here says the season ended;
  //    it falls through to the phase test below.
  //
  // A first attempt required every week to be played, which is simpler and
  // wrong: it reinstates the exact all-shell-playoff-week defect PLATFORM-105
  // removed. The existing test for that ruling is what caught it.
  const gamesCanAnswer = standingsHistory.weeks.every((week) => {
    const snapshot = standingsHistory.byWeek[week];
    if (!snapshot) return false;
    return snapshot.pending !== undefined || isPlayedWeek(standingsHistory, week);
  });
  if (gamesCanAnswer && unresolved.every((game) => hasGameBeenAbandoned(game, evaluatedAt))) {
    return 'final';
  }

  const playedWeeks = selectPlayedWeeks(standingsHistory);
  if (playedWeeks.length === 0) return 'in-season';

  const latestPlayedWeek = playedWeeks[playedWeeks.length - 1]!;
  if (latestPlayedWeek >= POSTSEASON_START_WEEK) return 'postseason';

  return 'in-season';
}
