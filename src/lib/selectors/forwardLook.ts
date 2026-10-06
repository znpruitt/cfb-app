import { displayOwner, getGameOwners } from '../gameOwnership.ts';
import { classifyStatusLabel } from '../gameStatus.ts';
import type { WeeklyRecapContext } from '../recap/loadRecapContext.ts';
import type { AppGame } from '../schedule.ts';
import { deriveStandings, type OwnerStandingsRow } from '../standings.ts';
import {
  selectWeeklyRecapTargetWeek,
  selectWeeklyRecapTileState,
  selectWeeklyRecapWeekTargets,
  type WeeklyRecapTargetWeek,
} from './weeklyRecapFacts.ts';

export type ForwardLookFamily = 'standings' | 'rivalry' | 'upset';
export type ForwardLookLine = {
  id: string;
  family: ForwardLookFamily;
  gameKey: string;
  title: string;
  detail: string;
  value: string;
  priorityScore: number;
  expiresAt: number;
};
export type ForwardLook = {
  seasonYear: number;
  recapTarget: WeeklyRecapTargetWeek;
  target: WeeklyRecapTargetWeek;
  weekLabel: string;
  lines: ForwardLookLine[];
};
export type ForwardLookInputs = {
  context: WeeklyRecapContext;
  now: Date;
  recapTarget: WeeklyRecapTargetWeek;
  target: WeeklyRecapTargetWeek;
  games: AppGame[];
  standings: OwnerStandingsRow[];
};

export const FORWARD_LOOK_SLOTS = 5;
export const FORWARD_LOOK_FAMILY_CAP = 2;
// One day's price, not a season-opening line. Boundary: "Forward Look odds expire at 24 hours".
export const FORWARD_LOOK_ODDS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function selectForwardLookInputs(
  context: WeeklyRecapContext,
  now: Date
): ForwardLookInputs | null {
  const recapTarget = selectWeeklyRecapTargetWeek(context.games, now);
  if (!recapTarget) return null;
  const target = selectWeeklyRecapWeekTargets(context.games).find(
    (week) => week.week > recapTarget.week
  );
  if (!target) return null;
  const games = context.games.filter((game) => {
    const score = context.scoresByKey[game.key];
    return (
      game.canonicalWeek === target.week &&
      !game.isPlaceholder &&
      !game.completed &&
      !game.startTimeTBD &&
      game.participants.home.kind === 'team' &&
      game.participants.away.kind === 'team' &&
      Date.parse(game.date ?? '') > now.getTime() &&
      classifyStatusLabel(game.status) === 'scheduled' &&
      classifyStatusLabel(game.rawStatus) === 'scheduled' &&
      (!score || classifyStatusLabel(score.status) === 'scheduled')
    );
  });
  const playedGames = context.games.filter((game) => Date.parse(game.date ?? '') <= now.getTime());
  return {
    context,
    now,
    recapTarget,
    target,
    games,
    standings: deriveStandings(playedGames, context.rosterByTeam, context.scoresByKey).rows,
  };
}

export function forwardLookCollision(game: AppGame, inputs: ForwardLookInputs) {
  const owners = getGameOwners(game, inputs.context.rosterByTeam);
  const home = displayOwner(owners.homeOwner);
  const away = displayOwner(owners.awayOwner);
  return home && away && home !== away ? { home, away } : null;
}

export function selectForwardStandings(inputs: ForwardLookInputs): ForwardLookLine[] {
  return inputs.games.flatMap((game) => {
    const owners = forwardLookCollision(game, inputs);
    if (!owners) return [];
    const home = inputs.standings.find((row) => row.owner === owners.home);
    const away = inputs.standings.find((row) => row.owner === owners.away);
    if (!home || !away) return [];
    const gap = Math.abs(home.wins - away.wins);
    if (gap > 1) return [];
    const bestRank = Math.min(inputs.standings.indexOf(home), inputs.standings.indexOf(away)) + 1;
    return [
      {
        id: `standings:${game.key}`,
        family: 'standings' as const,
        gameKey: game.key,
        title:
          gap === 0
            ? `${owners.away} and ${owners.home} can break their wins tie`
            : `${owners.away} and ${owners.home} meet one win apart`,
        detail: `${game.canAway} vs ${game.canHome} · ${owners.away} ${away.wins} ${away.wins === 1 ? 'win' : 'wins'}, ${owners.home} ${home.wins} ${home.wins === 1 ? 'win' : 'wins'}. ${gap === 0 ? 'The winner gains a win on the other owner.' : 'The trailing owner can draw level on wins; the leader can pull two clear.'}`,
        value: gap === 0 ? 'Tied on wins' : '1 win apart',
        priorityScore: 100 - gap * 10 + Math.max(0, 16 - bestRank),
        expiresAt: Date.parse(game.date!),
      },
    ];
  });
}

export function selectForwardUpsets(inputs: ForwardLookInputs): ForwardLookLine[] {
  const { context, now } = inputs;
  if (context.odds.status !== 'available') return [];
  const recap = selectWeeklyRecapTargetWeek(context.games, now);
  const immediate =
    recap &&
    selectWeeklyRecapWeekTargets(context.games).find((week) => week.week > recap.week)?.week;
  if (inputs.target.week !== immediate) return [];
  const oddsByKey = context.odds.byGameKey;
  return inputs.games.flatMap((game) => {
    if (game.canonicalWeek !== immediate) return [];
    const odds = oddsByKey[game.key];
    if (!odds || odds.lineSourceStatus !== 'latest') return [];
    const capturedAt = Date.parse(odds.capturedAt ?? '');
    const age = now.getTime() - capturedAt;
    if (!Number.isFinite(age) || age < 0 || age >= FORWARD_LOOK_ODDS_MAX_AGE_MS) return [];
    const owners = getGameOwners(game, context.rosterByTeam);
    return (['home', 'away'] as const).flatMap((side) => {
      const spread = side === 'home' ? odds.homeSpread : odds.awaySpread;
      const owner = displayOwner(side === 'home' ? owners.homeOwner : owners.awayOwner);
      const otherOwner = displayOwner(side === 'home' ? owners.awayOwner : owners.homeOwner);
      if (
        !owner ||
        owner === otherOwner ||
        spread === null ||
        !Number.isFinite(spread) ||
        spread <= 0
      )
        return [];
      const row = inputs.standings.find((standing) => standing.owner === owner);
      if (!row) return [];
      const rank = inputs.standings.indexOf(row) + 1;
      const team = side === 'home' ? game.canHome : game.canAway;
      const opponent = side === 'home' ? game.canAway : game.canHome;
      return [
        {
          id: `upset:${game.key}:${owner}`,
          family: 'upset' as const,
          gameKey: game.key,
          title: `${owner} needs ${team} to beat the odds`,
          detail: `${team} is a ${spread}-point underdog against ${opponent}. ${owner} ${row.gamesBack === 0 ? 'is at the top on wins' : `sits ${row.gamesBack} ${row.gamesBack === 1 ? 'win' : 'wins'} off the lead`}.`,
          value: `+${spread}`,
          priorityScore: 70 + Math.max(0, 16 - rank) + Math.min(spread, 14),
          expiresAt: Math.min(Date.parse(game.date!), capturedAt + FORWARD_LOOK_ODDS_MAX_AGE_MS),
        },
      ];
    });
  });
}

export function mergeForwardLookLines(families: ForwardLookLine[][]): ForwardLookLine[] {
  const ranked = families
    .flat()
    .sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
  const counts = new Map<ForwardLookFamily, number>();
  const seen = new Set<string>();
  return ranked
    .filter((line) => {
      const count = counts.get(line.family) ?? 0;
      if (seen.has(line.id) || count >= FORWARD_LOOK_FAMILY_CAP) return false;
      seen.add(line.id);
      counts.set(line.family, count + 1);
      return true;
    })
    .slice(0, FORWARD_LOOK_SLOTS);
}

export function selectVisibleForwardLook(value: ForwardLook | null, now: Date): ForwardLook | null {
  if (
    !value ||
    selectWeeklyRecapTileState(value.recapTarget, now) !== 'upcoming' ||
    selectWeeklyRecapTileState(value.target, now) !== 'hidden'
  )
    return null;
  return { ...value, lines: value.lines.filter((line) => line.expiresAt > now.getTime()) };
}
