import type { ForwardLook, ForwardLookLine } from '../selectors/forwardLook.ts';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function target(value: unknown): value is ForwardLook['target'] {
  return (
    record(value) &&
    Number.isInteger(value.week) &&
    typeof value.latestGameDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.latestGameDate) &&
    Number.isFinite(Date.parse(value.latestGameDate))
  );
}

export function parseForwardLook(value: unknown): ForwardLook | null {
  if (
    !record(value) ||
    !Number.isInteger(value.seasonYear) ||
    !target(value.recapTarget) ||
    !target(value.target) ||
    value.target.week <= value.recapTarget.week ||
    typeof value.weekLabel !== 'string' ||
    !Array.isArray(value.lines)
  )
    return null;
  const lines = value.lines.filter(
    (line): line is ForwardLookLine =>
      record(line) &&
      ['standings', 'rivalry', 'upset'].includes(String(line.family)) &&
      ['id', 'storyKey', 'gameKey', 'title', 'detail', 'value'].every(
        (key) => typeof line[key] === 'string'
      ) &&
      typeof line.priorityScore === 'number' &&
      Number.isFinite(line.priorityScore) &&
      typeof line.expiresAt === 'number' &&
      Number.isFinite(line.expiresAt)
  );
  if (lines.length !== value.lines.length) return null;
  return {
    seasonYear: value.seasonYear as number,
    recapTarget: value.recapTarget,
    target: value.target,
    weekLabel: value.weekLabel,
    lines,
  };
}
