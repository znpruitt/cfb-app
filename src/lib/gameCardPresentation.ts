import {
  MEDIA_TYPE_DISPLAY_PRIORITY,
  type ScheduleMediaItem,
} from './schedule/schedulePresentation';

type VenueDetails = {
  stadium?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

function cleanVenuePart(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * The SHARED TBD-aware kickoff formatter (PLATFORM-086E1C1) for every `AppGame`
 * kickoff surface that has access to `startTimeTBD`:
 *   - a missing or unparseable date is `TBD` (unchanged);
 *   - a confirmed kickoff (`startTimeTBD` not `true`) keeps the exact
 *     pre-existing localized format;
 *   - `startTimeTBD === true` with a usable date renders the DATE plus
 *     `Time TBD` — the provider's placeholder clock is never displayed as a
 *     confirmed kickoff time.
 */
export function formatExpandedKickoff(
  date: string | null,
  timeZone: string,
  startTimeTBD?: boolean | null
): string {
  if (!date) return 'TBD';
  const kickoff = new Date(date);
  if (Number.isNaN(kickoff.getTime())) return 'TBD';
  if (startTimeTBD === true) {
    const dateOnly = kickoff.toLocaleString(undefined, {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return `${dateOnly} · Time TBD`;
  }
  return kickoff.toLocaleString(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Choose ONE primary display outlet deterministically (PLATFORM-086E1C1):
 * media-type priority `tv → web → ppv → mobile → radio`, then case-insensitive
 * outlet order within a type. Every type but radio displays the outlet name
 * alone; radio keeps an explicit prefix (see below). Returns `null` when no
 * usable media row exists. The full normalized media list stays on the
 * wire/application model — this helper only compresses it for the compact card
 * display.
 */
export function formatPrimaryBroadcastLabel(
  media: ScheduleMediaItem[] | null | undefined
): string | null {
  if (!Array.isArray(media) || media.length === 0) return null;
  let best: ScheduleMediaItem | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;
  for (const row of media) {
    const priority = MEDIA_TYPE_DISPLAY_PRIORITY.indexOf(row.mediaType);
    const outlet = typeof row.outlet === 'string' ? row.outlet.trim() : '';
    if (priority < 0 || outlet.length === 0) continue;
    if (
      priority < bestPriority ||
      (priority === bestPriority &&
        best !== null &&
        outlet.toLowerCase().localeCompare(best.outlet.trim().toLowerCase()) < 0)
    ) {
      best = { ...row, outlet };
      bestPriority = priority;
    }
  }
  if (!best) return null;

  // Item 180 — NO QUALIFIER PREFIX on a streaming outlet. `Streaming · ACC Extra`
  // renders as `ACC Extra`: the prefix does not help a reader who does not
  // recognise the name and is redundant for one who does, and it is inconsistent
  // besides, since FOX and ESPN2 carry no equivalent while being the same kind of
  // answer. It is also the longest metadata string on the surface and the first to
  // truncate. `item-87-reference-game-row.md` §1; `DESIGN.md` → Cards and game
  // results carries the rule.
  //
  // Owner condition, discharged before the cut (2026-09-08, read-only replica,
  // `schedule-media/2026-all`): of 993 `web` rows, the 166 that sit on a game with
  // an FBS participant carry ten distinct outlets — ESPN+, MW+, SECN+, ACCNX,
  // Disney+, ACC Extra, Peacock, HBO Max, ESPN Unlmtd, UConn+ — every one of which
  // reads as a streaming service unprefixed. `mobile` has zero rows in the cache.
  //
  // `Radio ·` STAYS, and it is a different case: radio is a different KIND of
  // broadcast rather than a less familiar name for the same kind, so dropping it
  // could present a radio-only game as watchable. Measured the same day, it renders
  // on ZERO games — both radio rows sit on games that also carry TV, which outranks
  // radio in `MEDIA_TYPE_DISPLAY_PRIORITY` — and that is the reason to keep it: it
  // is a guard against a radio-only game, not a live label. Do not delete it as
  // unreachable.
  return best.mediaType === 'radio' ? `Radio · ${best.outlet}` : best.outlet;
}

export function formatVenueLabel(venue: VenueDetails | string | null | undefined): string | null {
  if (!venue) return null;
  if (typeof venue === 'string') return cleanVenuePart(venue);

  const stadium = cleanVenuePart(venue.stadium);
  const city = cleanVenuePart(venue.city);
  const state = cleanVenuePart(venue.state);
  const country = cleanVenuePart(venue.country);

  const stateOrCountry = state ?? country;
  const location = city ? [city, stateOrCountry].filter(Boolean).join(', ') : null;

  if (stadium && location) return `${stadium} • ${location}`;
  if (stadium) return stadium;
  return location;
}
