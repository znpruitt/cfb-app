import { displayOwner, getGameOwners } from '../gameOwnership.ts';
import { hasUsableFinalScore } from '../gameStatus.ts';
import type { AppGame } from '../schedule.ts';
import type { ScorePack } from '../scores.ts';
import {
  forwardLookCollision,
  type ForwardLookInputs,
  type ForwardLookLine,
} from './forwardLook.ts';

type Meeting = { year: number; week: number; kickoff: number; winner: string | null };

function pairKey(a: string, b: string): string {
  return JSON.stringify([a, b].sort());
}

function liveStreak(meetings: Meeting[]): { owner: string; count: number } | null {
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
  return owner ? { owner, count } : null;
}

export function selectForwardRivalries(inputs: ForwardLookInputs): ForwardLookLine[] {
  if (inputs.context.records.status !== 'available') return [];
  const meetingsByPair = new Map<string, Meeting[]>();
  const seen = new Set<string>();
  const collect = (
    year: number,
    games: AppGame[],
    scores: Record<string, ScorePack>,
    roster: Map<string, string>
  ) => {
    for (const game of games) {
      if (
        game.isPlaceholder ||
        (year === inputs.context.seasonYear &&
          !(Date.parse(game.date ?? '') <= inputs.now.getTime()))
      )
        continue;
      const { homeOwner, awayOwner } = getGameOwners(game, roster);
      const home = displayOwner(homeOwner);
      const away = displayOwner(awayOwner);
      if (!home || !away || home === away || seen.has(`${year}:${game.key}`)) continue;
      seen.add(`${year}:${game.key}`);
      const score = scores[game.key];
      const winner =
        hasUsableFinalScore(score) &&
        Number.isFinite(score.home.score) &&
        Number.isFinite(score.away.score) &&
        score.home.score !== score.away.score
          ? score.home.score! > score.away.score!
            ? home
            : away
          : null;
      const key = pairKey(home, away);
      meetingsByPair.set(key, [
        ...(meetingsByPair.get(key) ?? []),
        {
          year,
          week: game.canonicalWeek,
          kickoff: Date.parse(game.date ?? ''),
          winner,
        },
      ]);
    }
  };
  for (const archive of inputs.context.records.archives) {
    const roster = inputs.context.records.historicalRosters[archive.year];
    if (archive.year < inputs.context.seasonYear && roster)
      collect(archive.year, archive.games, archive.scoresByKey, roster);
  }
  collect(
    inputs.context.seasonYear,
    inputs.context.games,
    inputs.context.scoresByKey,
    inputs.context.rosterByTeam
  );

  return inputs.games.flatMap((game) => {
    const owners = forwardLookCollision(game, inputs);
    if (!owners) return [];
    const meetings = meetingsByPair.get(pairKey(owners.home, owners.away)) ?? [];
    const homeWins = meetings.filter((meeting) => meeting.winner === owners.home).length;
    const awayWins = meetings.filter((meeting) => meeting.winner === owners.away).length;
    const total = homeWins + awayWins;
    const tight = total >= 4 && Math.abs(homeWins - awayWins) <= 1;
    const streak = liveStreak(meetings);
    const running = streak && streak.count >= 3 ? streak : null;
    if (!tight && !running) return [];
    const record = `${owners.away} ${awayWins}–${homeWins} ${owners.home}`;
    return [
      {
        id: `rivalry:${game.key}`,
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
