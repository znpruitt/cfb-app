export type FocusMode = 'all' | 'top' | 'selected';

export function deriveFocusedOwners({
  focusMode,
  selectedOwners,
  orderedOwners,
  topN = 5,
}: {
  focusMode: FocusMode;
  selectedOwners: Set<string>;
  orderedOwners: string[];
  topN?: number;
}): string[] {
  if (focusMode === 'all') return orderedOwners;
  if (focusMode === 'top') return orderedOwners.slice(0, topN);
  if (selectedOwners.size === 0) return orderedOwners.slice(0, topN);
  return orderedOwners.filter((owner) => selectedOwners.has(owner));
}

export function deriveWeekTicks(weeks: number[]): { value: number; label: string }[] {
  const interval = weeks.length > 12 ? 2 : 3;
  return weeks
    .filter((_, i) => i === 0 || i === weeks.length - 1 || i % interval === 0)
    .map((week) => ({ value: week, label: `W${week}` }));
}
