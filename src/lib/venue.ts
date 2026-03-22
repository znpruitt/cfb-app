import type { VenueInfo } from './schedule/cfbdSchedule.ts';

export type VenueLike = VenueInfo | string | null | undefined;

function cleanVenuePart(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function comparableVenueText(venue: VenueLike): string {
  if (!venue) return '';
  if (typeof venue === 'string') return cleanVenuePart(venue) ?? '';

  const parts = [venue.stadium, venue.city, venue.state, venue.country]
    .map((value) => cleanVenuePart(value))
    .filter((value): value is string => Boolean(value));

  const deduped: string[] = [];
  for (const part of parts) {
    if (!deduped.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
      deduped.push(part);
    }
  }

  return deduped.join(' ');
}
