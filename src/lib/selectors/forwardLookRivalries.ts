import { displayOwner, getGameOwners } from '../gameOwnership.ts';
import { hasUsableFinalScore, isCanceledStatusLabel } from '../gameStatus.ts';
import type { AppGame } from '../schedule.ts';
import type { ScorePack } from '../scores.ts';
import type { WeeklyRecapContext } from '../recap/loadRecapContext.ts';
import {
  forwardLookCollision,
  type ForwardLookInputs,
  type ForwardLookLine,
} from './forwardLook.ts';

export type RivalrySummary = {
  owners: [string, string];
  wins: [number, number];
  streak: { owner: string; count: number } | null;
};
export type ForwardLookHistory = { seasonYear: number; rivalries: RivalrySummary[] | null };
export type RivalryGame = {
  key: string;
  week: number;
  kickoff: number;
  home: string;
  away: string;
};

type Meeting = { year: number; week: number; kickoff: number; winner: string | null };

function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b].sort());
}

function liveStreak(
  meetings: Meeting[],
  previous: RivalrySummary['streak'] = null
): RivalrySummary['streak'] {
  const weeks = new Map<string, Meeting[]>();
  for (const meeting of meetings) {
    const key = `${meeting.year}:${meeting.week}`;
    weeks.set(key, [...(weeks.get(key) ?? []), meeting]);
  }
  const orderedWeeks = [...weeks.values()].sort(
    (a, b) => b[0].year - a[0].year || b[0].week - a[0].week
  );
  let owner: string | null = null;
  let count = 0;
  for (const week of orderedWeeks) {
    const groups = new Map<number, Meeting[]>();
    const unknownTime = week.some((meeting) => !Number.isFinite(meeting.kickoff));
    for (const meeting of week) {
      const key = unknownTime ? 0 : meeting.kickoff;
      groups.set(key, [...(groups.get(key) ?? []), meeting]);
    }
    for (const [, group] of [...groups].sort(([a], [b]) => b - a)) {
      const winners = new Set(group.map((meeting) => meeting.winner));
      const winner = group[0].winner;
      if (!winner || winners.size !== 1 || (owner && owner !== winner)) {
        return owner ? { owner, count } : null;
      }
      owner = winner;
      count += group.length;
    }
  }
  if (previous && (!owner || owner === previous.owner)) {
    return { owner: previous.owner, count: count + previous.count };
  }
  return owner ? { owner, count } : null;
}

export function prepareRivalryGames(games: AppGame[], roster: Map<string, string>): RivalryGame[] {
  const seen = new Set<string>();
  return games.flatMap((game) => {
    if (game.isPlaceholder || [game.status, game.rawStatus].some(isCanceledStatusLabel)) return [];
    const owners = getGameOwners(game, roster);
    const home = displayOwner(owners.homeOwner);
    const away = displayOwner(owners.awayOwner);
    if (!home || !away || home === away || seen.has(game.key)) return [];
    seen.add(game.key);
    return [
      { key: game.key, week: game.canonicalWeek, kickoff: Date.parse(game.date ?? ''), home, away },
    ];
  });
}

function meetingWinner(game: RivalryGame, score: ScorePack | undefined): string | null {
  return score &&
    hasUsableFinalScore(score) &&
    Number.isFinite(score.home.score) &&
    Number.isFinite(score.away.score) &&
    score.home.score !== score.away.score
    ? score.home.score! > score.away.score!
      ? game.home
      : game.away
    : null;
}

export function prepareForwardLookHistory(context: WeeklyRecapContext): ForwardLookHistory {
  const result: ForwardLookHistory = { seasonYear: context.seasonYear, rivalries: null };
  try {
    if (context.records.status !== 'available') return result;
    const pairs = new Map<string, { owners: [string, string]; meetings: Meeting[] }>();
    const seen = new Set<string>();
    for (const archive of context.records.archives) {
      const roster = context.records.historicalRosters[archive.year];
      if (archive.year >= context.seasonYear || !roster) continue;
      for (const game of prepareRivalryGames(archive.games, roster)) {
        const score = archive.scoresByKey[game.key];
        const identity = `${archive.year}:${game.key}`;
        if (isCanceledStatusLabel(score?.status) || seen.has(identity)) continue;
        seen.add(identity);
        const key = pairKey(game.home, game.away);
        let pair = pairs.get(key);
        if (!pair) {
          pair = { owners: [game.home, game.away].sort() as [string, string], meetings: [] };
          pairs.set(key, pair);
        }
        pair.meetings.push({
          year: archive.year,
          week: game.week,
          kickoff: game.kickoff,
          winner: meetingWinner(game, score),
        });
      }
    }
    result.rivalries = [...pairs.values()].map(({ owners, meetings }) => ({
      owners,
      wins: owners.map(
        (owner) => meetings.filter((meeting) => meeting.winner === owner).length
      ) as [number, number],
      streak: liveStreak(meetings),
    }));
  } catch {
    result.rivalries = null;
  }
  return result;
}

export function selectForwardRivalries(inputs: ForwardLookInputs): ForwardLookLine[] {
  if (inputs.context.history.rivalries === null) return [];
  const history = new Map(
    inputs.context.history.rivalries.map((pair) => [pairKey(...pair.owners), pair])
  );
  const meetingsByPair = new Map<string, Meeting[]>();
  const uncoveredPairs = new Set<string>();
  for (const game of inputs.context.rivalryGames) {
    const score = inputs.scoresByKey[game.key];
    if (isCanceledStatusLabel(score?.status) || game.kickoff > inputs.now.getTime()) continue;
    const key = pairKey(game.home, game.away);
    const winner = meetingWinner(game, score);
    // A gap anywhere in this pair's current season invalidates the record, even
    // when newer known wins form a streak. See 'Forward Look withholds even an
    // older gap without suppressing covered pairs or other families'.
    if (!Number.isFinite(game.kickoff) || !winner) {
      uncoveredPairs.add(key);
      continue;
    }
    const meetings = meetingsByPair.get(key) ?? [];
    meetings.push({
      year: inputs.context.seasonYear,
      week: game.week,
      kickoff: game.kickoff,
      winner,
    });
    meetingsByPair.set(key, meetings);
  }

  const evaluated = new Map<string, RivalrySummary>();
  return inputs.games.flatMap((game) => {
    const owners = forwardLookCollision(game, inputs);
    if (!owners) return [];
    const key = pairKey(owners.home, owners.away);
    if (uncoveredPairs.has(key)) return [];
    let summary = evaluated.get(key);
    if (!summary) {
      const meetings = meetingsByPair.get(key) ?? [];
      const prior = history.get(key);
      const pair: [string, string] = [owners.home, owners.away];
      summary = {
        owners: pair,
        wins: pair.map(
          (owner) =>
            (prior ? prior.wins[prior.owners.indexOf(owner)] : 0) +
            meetings.filter((meeting) => meeting.winner === owner).length
        ) as [number, number],
        streak: liveStreak(meetings, prior?.streak),
      };
      evaluated.set(key, summary);
    }
    const homeWins = summary.wins[summary.owners.indexOf(owners.home)];
    const awayWins = summary.wins[summary.owners.indexOf(owners.away)];
    const total = homeWins + awayWins;
    const tight = total >= 4 && Math.abs(homeWins - awayWins) <= 1;
    const streak = summary.streak;
    const running = streak && streak.count >= 3 ? streak : null;
    if (!tight && !running) return [];
    const record = `${owners.away} ${awayWins}–${homeWins} ${owners.home}`;
    return [
      {
        id: `rivalry:${game.key}`,
        storyKey: `rivalry:${pairKey(owners.home, owners.away)}`,
        family: 'rivalry' as const,
        gameKey: game.key,
        title: running
          ? `${running.owner} puts a ${running.count}-game rivalry streak on the line`
          : `${owners.away} and ${owners.home} have little between them`,
        detail: `${game.canAway} vs ${game.canHome} · ${record} in recorded head-to-head results.`,
        value: running ? `${running.count} straight` : `${awayWins}–${homeWins}`,
        priorityScore: running ? 85 + Math.min(running.count, 15) : 90 + Math.min(total, 20) / 2,
        expiresAt: Date.parse(game.date!),
      },
    ];
  });
}
