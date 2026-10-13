import type { ForwardLookHistory, RivalrySummary } from '../selectors/forwardLookRivalries.ts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseForwardLook(value: unknown): ForwardLookHistory | null {
  if (!record(value) || !Number.isInteger(value.seasonYear)) return null;
  if (value.rivalries === null) return { seasonYear: value.seasonYear as number, rivalries: null };
  if (!Array.isArray(value.rivalries)) return null;
  const rivalries: RivalrySummary[] = [];
  const seen = new Set<string>();
  for (const pair of value.rivalries) {
    if (
      !record(pair) ||
      !Array.isArray(pair.owners) ||
      pair.owners.length !== 2 ||
      !pair.owners.every((owner) => typeof owner === 'string' && owner.length > 0) ||
      pair.owners[0] >= pair.owners[1] ||
      !Array.isArray(pair.wins) ||
      pair.wins.length !== 2 ||
      !pair.wins.every(count)
    )
      return null;
    const key = JSON.stringify(pair.owners);
    if (seen.has(key)) return null;
    seen.add(key);
    let streak: RivalrySummary['streak'] = null;
    if (pair.streak !== null) {
      if (
        !record(pair.streak) ||
        !pair.owners.includes(pair.streak.owner) ||
        !count(pair.streak.count) ||
        pair.streak.count === 0 ||
        pair.streak.count > pair.wins[pair.owners.indexOf(pair.streak.owner)]
      )
        return null;
      streak = { owner: pair.streak.owner as string, count: pair.streak.count };
    }
    rivalries.push({
      owners: [pair.owners[0], pair.owners[1]],
      wins: [pair.wins[0], pair.wins[1]],
      streak,
    });
  }
  return { seasonYear: value.seasonYear as number, rivalries };
}
