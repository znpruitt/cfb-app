import type { ForwardLookHistory, RivalryHistory } from '../selectors/forwardLookRivalries.ts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseForwardLook(value: unknown): ForwardLookHistory | null {
  if (!record(value) || !Number.isInteger(value.seasonYear)) return null;
  const seasonYear = value.seasonYear as number;
  if (value.rivalries === null) return { seasonYear, rivalries: null };
  if (!Array.isArray(value.rivalries)) return null;
  const seen = new Set<string>();
  const rivalries: RivalryHistory[] = [];
  for (const pair of value.rivalries) {
    if (
      !record(pair) ||
      !Array.isArray(pair.owners) ||
      pair.owners.length !== 2 ||
      !pair.owners.every((owner) => typeof owner === 'string' && owner.trim().length > 0) ||
      !(pair.owners[0] < pair.owners[1]) ||
      !Array.isArray(pair.wins) ||
      pair.wins.length !== 2 ||
      !pair.wins.every((win) => Number.isSafeInteger(win) && win >= 0)
    )
      return { seasonYear, rivalries: null };
    const key = JSON.stringify(pair.owners);
    if (seen.has(key)) return { seasonYear, rivalries: null };
    seen.add(key);
    const streak = pair.streak;
    if (
      streak !== null &&
      (!record(streak) ||
        !pair.owners.includes(streak.owner) ||
        !Number.isSafeInteger(streak.count) ||
        (streak.count as number) < 1 ||
        (streak.count as number) > pair.wins[pair.owners.indexOf(streak.owner)])
    )
      return { seasonYear, rivalries: null };
    rivalries.push({
      owners: pair.owners as [string, string],
      wins: pair.wins as [number, number],
      streak: streak as RivalryHistory['streak'],
    });
  }
  return { seasonYear, rivalries };
}
