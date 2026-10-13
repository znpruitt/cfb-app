import { displayOwner, getGameOwners } from '../gameOwnership.ts';
import {
  classifyGameConclusionEvidence,
  hasUsableFinalScore,
  isCanceledStatusLabel,
  isCanceledOrPostponedStatusLabel,
} from '../gameStatus.ts';
import type { WeeklyRecapContext } from '../recap/loadRecapContext.ts';
import type { AppGame } from '../schedule.ts';
import type { ScorePack } from '../scores.ts';
import type { ForwardLookInputs, ForwardLookLine } from './forwardLook.ts';

type Streak = { owner: string; count: number };
type Meeting = { year: number; week: number; kickoff: number; winner: string | null };
export type RivalryHistory = {
  owners: [string, string];
  wins: [number, number];
  streak: Streak | null;
};
export type ForwardLookHistory = { seasonYear: number; rivalries: RivalryHistory[] | null };
export type RivalryGame = {
  game: AppGame;
  home: string;
  away: string;
  pair: string;
  kickoff: number;
};

function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b].sort());
}

export function forwardLookCollision(game: AppGame, inputs: ForwardLookInputs) {
  const owners = getGameOwners(game, inputs.context.rosterByTeam);
  const home = displayOwner(owners.homeOwner);
  const away = displayOwner(owners.awayOwner);
  return home && away && home !== away ? { home, away } : null;
}

export function prepareRivalryGames(games: AppGame[], roster: Map<string, string>): RivalryGame[] {
  const seen = new Set<string>();
  return games.flatMap((game) => {
    if (game.isPlaceholder || seen.has(game.key)) return [];
    seen.add(game.key);
    const owners = getGameOwners(game, roster);
    const home = displayOwner(owners.homeOwner);
    const away = displayOwner(owners.awayOwner);
    return home && away && home !== away
      ? [{ game, home, away, pair: pairKey(home, away), kickoff: Date.parse(game.date ?? '') }]
      : [];
  });
}

function winner(meeting: RivalryGame, score: ScorePack | undefined): string | null {
  return hasUsableFinalScore(score) &&
    Number.isFinite(score!.home.score) &&
    Number.isFinite(score!.away.score) &&
    score!.home.score !== score!.away.score
    ? score!.home.score! > score!.away.score!
      ? meeting.home
      : meeting.away
    : null;
}

function liveStreak(meetings: Meeting[]): { streak: Streak | null; open: boolean } {
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
        return { streak: owner ? { owner, count } : null, open: false };
      }
      owner = winner;
      count += group.length;
    }
  }
  return { streak: owner ? { owner, count } : null, open: true };
}

export function prepareForwardLookHistory(
  context: Pick<WeeklyRecapContext, 'seasonYear' | 'records'>
): ForwardLookHistory {
  const result: ForwardLookHistory = { seasonYear: context.seasonYear, rivalries: null };
  try {
    if (context.records.status !== 'available') return result;
    const pairs = new Map<string, { owners: [string, string]; meetings: Meeting[] }>();
    const seen = new Set<string>();
    for (const archive of context.records.archives) {
      const roster = context.records.historicalRosters[archive.year];
      if (archive.year >= context.seasonYear || !roster) continue;
      for (const meeting of prepareRivalryGames(archive.games, roster)) {
        const score = archive.scoresByKey[meeting.game.key];
        const id = `${archive.year}:${meeting.game.key}`;
        if (
          seen.has(id) ||
          [meeting.game.status, meeting.game.rawStatus, score?.status].some(isCanceledStatusLabel)
        )
          continue;
        seen.add(id);
        const pair = pairs.get(meeting.pair) ?? {
          owners: [meeting.home, meeting.away].sort() as [string, string],
          meetings: [],
        };
        pair.meetings.push({
          year: archive.year,
          week: meeting.game.canonicalWeek,
          kickoff: meeting.kickoff,
          winner: winner(meeting, score),
        });
        pairs.set(meeting.pair, pair);
      }
    }
    result.rivalries = [...pairs.values()].map(({ owners, meetings }) => ({
      owners,
      wins: owners.map(
        (owner) => meetings.filter((meeting) => meeting.winner === owner).length
      ) as [number, number],
      streak: liveStreak(meetings).streak,
    }));
  } catch {
    /* Historical uncertainty is confined to the rivalry family. */
  }
  return result;
}

export function selectForwardRivalries(inputs: ForwardLookInputs): ForwardLookLine[] {
  if (!inputs.context.history?.rivalries) return [];
  const history = new Map(
    inputs.context.history.rivalries.map((pair) => [JSON.stringify(pair.owners), pair])
  );
  const meetingsByPair = new Map<string, Meeting[]>();
  const uncovered = new Set<string>();
  for (const meeting of inputs.context.rivalryGames) {
    const { game, kickoff, pair } = meeting;
    const score = inputs.context.scoresByKey[game.key];
    if ([game.status, game.rawStatus, score?.status].some(isCanceledStatusLabel)) continue;
    const concluded = classifyGameConclusionEvidence(game, score) === 'score-required';
    if (
      !concluded &&
      ([game.status, game.rawStatus, score?.status].some(isCanceledOrPostponedStatusLabel) ||
        !(kickoff <= inputs.now.getTime()))
    )
      continue;
    const result = winner(meeting, score);
    if (!result) {
      uncovered.add(pair);
      continue;
    }
    const meetings = meetingsByPair.get(pair) ?? [];
    meetings.push({
      year: inputs.context.seasonYear,
      week: game.canonicalWeek,
      kickoff,
      winner: result,
    });
    meetingsByPair.set(pair, meetings);
  }

  return inputs.games.flatMap((game) => {
    const owners = forwardLookCollision(game, inputs);
    if (!owners) return [];
    const key = pairKey(owners.home, owners.away);
    if (uncovered.has(key)) return [];
    const past = history.get(key);
    const meetings = meetingsByPair.get(key) ?? [];
    const archivedWins = (owner: string) =>
      past ? (past.wins[past.owners.indexOf(owner)] ?? 0) : 0;
    const homeWins =
      archivedWins(owners.home) +
      meetings.filter((meeting) => meeting.winner === owners.home).length;
    const awayWins =
      archivedWins(owners.away) +
      meetings.filter((meeting) => meeting.winner === owners.away).length;
    const total = homeWins + awayWins;
    const tight = total >= 4 && Math.abs(homeWins - awayWins) <= 1;
    const current = liveStreak(meetings);
    const streak = current.open && !current.streak ? past?.streak : current.streak;
    if (streak && current.open && past?.streak?.owner === streak.owner && current.streak) {
      streak.count += past.streak.count;
    }
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
