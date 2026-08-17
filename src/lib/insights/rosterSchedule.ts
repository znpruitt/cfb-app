import type { AppGame } from '../schedule';
import { getGameOwners } from '../gameOwnership';
import { NO_CLAIM_OWNER } from '../standings';

/**
 * INSIGHTS-031 — what a season's schedule says about the rosters that were
 * drafted from it.
 *
 * The schedule and the team→owner map have both been on `InsightContext` the
 * whole time and nothing has ever crossed them. Everything here is a COUNT over
 * that cross product — no records, no league-wide maxima measured over one
 * population and claimed over another. That is deliberate: every defect in
 * INSIGHTS-030 and 023 came from that axis, and none of it applies to "how many
 * times do these two teams meet".
 *
 * Requires a real drafted roster. Before a draft `currentRoster` is either empty
 * or borrowed from an archive, and a borrowed map would describe LAST season's
 * ownership against THIS season's schedule — so callers must check
 * `usingArchivedRoster` and skip.
 */

/** One owner's exposure to the season's schedule. */
export type OwnerScheduleProfile = {
  owner: string;
  /** Games where BOTH teams belong to this owner. */
  selfGames: number;
  /** Games against another owner's team, by that owner. */
  againstByOwner: Map<string, number>;
  /** Games against a team nobody drafted. */
  againstUndrafted: number;
  /** Every game involving at least one of this owner's teams. */
  totalGames: number;
};

export type RosterScheduleProfile = {
  byOwner: Map<string, OwnerScheduleProfile>;
  /** Games where both sides are owned, by the same owner or by two different ones. */
  ownedMatchups: number;
};

function emptyProfile(owner: string): OwnerScheduleProfile {
  return {
    owner,
    selfGames: 0,
    againstByOwner: new Map(),
    againstUndrafted: 0,
    totalGames: 0,
  };
}

/**
 * Resolve a game's two owners from the roster map.
 *
 * `csv*` first, then `can*`, matching `rivalry.ts`'s resolver — the roster is
 * keyed by the name the CSV carries, and the canonical name is the fallback for
 * rows written before identity resolution. Unlike that resolver, a game with the
 * SAME owner on both sides is kept: here it is the subject rather than something
 * to discard.
 */
/**
 * Resolve a game's two owners through the CANONICAL resolver, then drop
 * `NoClaim`.
 *
 * The first version of this file hand-rolled a two-field lookup —
 * `roster.get(csvHome) ?? roster.get(canHome)`. `getGameOwners` walks an ordered
 * candidate set that also covers the participant team id and its canonical,
 * display and raw names, and AGENTS.md requires current-season attribution to
 * flow through it. A roster keyed by any of those other identities silently read
 * as undrafted and undercounted self-games.
 *
 * ## Order matters: RESOLVE first, exclude second
 *
 * `NoClaim` is not an owner. `buildConfirmedOwnersCsv` writes a row for every
 * eligible team the draft did not take, owned by `NoClaim`, so a post-draft
 * roster maps every leftover to it — and counting leftover-vs-leftover games as
 * one owner's self-games made `NoClaim` the league leader outright.
 *
 * The exclusion happens AFTER resolution, deliberately. An earlier fix made the
 * per-key lookup return `undefined` for a `NoClaim` team, which is
 * indistinguishable from "not in the roster" — so the next candidate in the
 * chain was tried and could resolve the same side to a different owner. Letting
 * the canonical resolver settle identity first, then asking whether the answer
 * is a real owner, removes that question entirely.
 */
function gameOwners(
  game: AppGame,
  roster: Map<string, string>
): { home: string | undefined; away: string | undefined } {
  const { homeOwner, awayOwner } = getGameOwners(game, roster);
  return {
    home: homeOwner === NO_CLAIM_OWNER ? undefined : homeOwner,
    away: awayOwner === NO_CLAIM_OWNER ? undefined : awayOwner,
  };
}

/**
 * Count every owner's exposure across the season.
 *
 * Counts SCHEDULED games, not results — so it is answerable in preseason, the
 * moment a draft is confirmed, which is the point.
 */
export function buildRosterScheduleProfile(
  games: readonly AppGame[],
  roster: Map<string, string>
): RosterScheduleProfile {
  const byOwner = new Map<string, OwnerScheduleProfile>();
  let ownedMatchups = 0;

  const profileFor = (owner: string): OwnerScheduleProfile => {
    const existing = byOwner.get(owner);
    if (existing) return existing;
    const created = emptyProfile(owner);
    byOwner.set(owner, created);
    return created;
  };

  for (const game of games) {
    const { home, away } = gameOwners(game, roster);
    if (!home && !away) continue;

    if (home && away) {
      ownedMatchups += 1;
      if (home === away) {
        // ONE self-game, not two. The owner appears on both sides, but this is a
        // single fixture on the calendar and counting it twice would double
        // every headline number.
        const profile = profileFor(home);
        profile.selfGames += 1;
        profile.totalGames += 1;
        continue;
      }
      const homeProfile = profileFor(home);
      const awayProfile = profileFor(away);
      homeProfile.againstByOwner.set(away, (homeProfile.againstByOwner.get(away) ?? 0) + 1);
      awayProfile.againstByOwner.set(home, (awayProfile.againstByOwner.get(home) ?? 0) + 1);
      homeProfile.totalGames += 1;
      awayProfile.totalGames += 1;
      continue;
    }

    const owner = home ?? away!;
    const profile = profileFor(owner);
    profile.againstUndrafted += 1;
    profile.totalGames += 1;
  }

  return { byOwner, ownedMatchups };
}

/** Owners ranked by self-games, most first; ties broken by name for stability. */
export function rankBySelfGames(profile: RosterScheduleProfile): OwnerScheduleProfile[] {
  return [...profile.byOwner.values()]
    .filter((p) => p.selfGames > 0)
    .sort((a, b) => b.selfGames - a.selfGames || a.owner.localeCompare(b.owner));
}
