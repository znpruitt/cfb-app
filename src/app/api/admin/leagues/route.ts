import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getLeagues, addLeague, isValidSlug } from '@/lib/leagueRegistry';
import { sanitizeLeague, sanitizeLeagues } from '@/lib/leagueSanitize';
import { findResidualLeagueScopes } from '@/lib/server/leagueResidualData';
import {
  isCreatableSeasonYear,
  seasonYearForNewLeague,
  maxCreatableSeasonYear,
  MIN_SEASON_YEAR,
  type League,
} from '@/lib/league';

/** Static `/admin/*` route collisions plus the legacy-reserved `cache` slug. */
const RESERVED_ADMIN_SLUGS = new Set([
  'aliases',
  'season',
  'data',
  'draft',
  'diagnostics',
  'leagues',
  'cache',
]);

export async function GET(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  const leagues = await getLeagues();
  return Response.json({ leagues: sanitizeLeagues(leagues) });
}

export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return new Response('Body must be an object', { status: 400 });
  }

  const obj = body as Record<string, unknown>;

  const slug = typeof obj.slug === 'string' ? obj.slug.trim() : '';
  const displayName = typeof obj.displayName === 'string' ? obj.displayName.trim() : '';

  if (!slug) return new Response('slug is required', { status: 400 });
  if (!isValidSlug(slug))
    return new Response(
      'slug must be lowercase alphanumeric words separated by hyphens (e.g. tsc, work-league)',
      { status: 400 }
    );
  if (RESERVED_ADMIN_SLUGS.has(slug))
    return new Response(
      'Slug is reserved and cannot be used for a league. Choose a different slug.',
      { status: 400 }
    );
  if (!displayName) return new Response('displayName is required', { status: 400 });
  const now = new Date();
  const nowMs = now.getTime();

  const existing = await getLeagues();
  if (existing.some((l) => l.slug === slug)) {
    return new Response(`League with slug "${slug}" already exists`, { status: 409 });
  }

  // PLATFORM-086F2I — a slug whose PREVIOUS occupant's data is still stored.
  //
  // Deleting a league removes one registry entry and nothing else, so rosters,
  // drafts, archives, and suppression records all survive under the slug. A new
  // league taking that slug would ADOPT them — showing one set of people's names
  // to a commissioner with no relationship to them.
  //
  // REFUSED BY DEFAULT, OVERRIDABLE ON PURPOSE. The first version of this guard
  // refused outright, and review caught that it created a dead end rather than a
  // safeguard: nothing in the app deletes those records, so a refused slug was
  // refused FOREVER. Worse, re-creating at the same slug is exactly how an
  // ACCIDENTAL delete was recovered — restoring a league its own rosters and
  // archives — so a blanket refusal blocked the common correct case with the
  // same rule as the rare dangerous one. It also bricked the demo league
  // permanently: `TEST_LEAGUE_SLUG` is hardcoded, `resetTestLeagueLifecycle`
  // answers `league-not-found` for an absent league, and this POST is the only
  // `addLeague` caller — so deleting `test` would have left no way back.
  //
  // The override is deliberate, not incidental: the caller must send
  // `adoptExistingData: true`, which is the same standard as the delete
  // confirmation — impossible by accident, available when it is what you mean.
  const adoptExistingData = obj.adoptExistingData === true;

  // PLATFORM-086F2I — the residue survey runs UNCONDITIONALLY.
  //
  // It used to be skipped whenever `adoptExistingData` was set, which made the
  // flag self-justifying: it suppressed the very check that establishes there is
  // anything to adopt. Two ways that went wrong, both closed by scanning first
  // and deciding after:
  //   - Any caller could send `adoptExistingData: true` on a clean slug and be
  //     handed the recovery-only founding year below — the arbitrary
  //     founding-year-at-creation this slice exists to keep shut.
  //   - The create form does not clear the acknowledgement when the slug is
  //     edited, so an operator who hit the refusal on one slug, ticked adopt,
  //     then changed their mind and typed a DIFFERENT slug carried the flag with
  //     them and skipped the guard for a slug they had never been warned about.
  // Scanning first makes both fail closed: adoption of a slug holding nothing is
  // now itself an error, so a stale flag can only ever produce a refusal.
  const residual = await findResidualLeagueScopes(slug);

  if (!adoptExistingData && residual.length > 0) {
    return new Response(
      `Stored data still exists for slug "${slug}" from a previously deleted league ` +
        `(${residual.length} record group(s)). Creating it now would attach that data — rosters, ` +
        `drafts, and archives — to the new league. If this is the SAME league being restored, ` +
        `re-submit with "adopt existing data" to proceed. If it is a different league, choose ` +
        `another slug: nothing in the app deletes the old records.`,
      { status: 409 }
    );
  }

  if (adoptExistingData && residual.length === 0) {
    return new Response(
      `No stored data exists for slug "${slug}", so there is nothing to adopt. ` +
        `"Adopt existing data" restores a league whose records survived its deletion; it is not ` +
        `a way to create an ordinary league. Re-submit without it.`,
      { status: 400 }
    );
  }

  // PLATFORM-086F2J — the RECOVERY-ONLY founding year.
  //
  // F2J froze `foundedYear` after creation, which made restoring an accidentally
  // deleted league silently rewrite its founding year to today: the F2I adoption
  // path brings back rosters, drafts, and archives, but the `Est. N` header would
  // read the restoration date with no correction path anywhere. That is a
  // regression this slice introduced, not an inherited limitation.
  //
  // Narrow by construction, and the narrowness is ENFORCED rather than asserted.
  // It is a SEPARATE field name — `restoreFoundedYear`, not `foundedYear` — it is
  // refused on ordinary creation, and by the time it is read above we have proven
  // that surviving data exists for this exact slug. A caller who merely wants to
  // choose a founding year has no reachable path to it: they would first have to
  // delete a league at that slug and leave its records behind.
  //
  // REQUIRED when adopting, rather than defaulting to the derived year: a
  // restoration that silently invented a founding year is the exact defect this
  // exists to close, so the caller must state what they are restoring.
  const hasRestoreYear = 'restoreFoundedYear' in obj;
  if (hasRestoreYear && !adoptExistingData) {
    return new Response(
      'restoreFoundedYear is only accepted when adopting the surviving data of a previously ' +
        'deleted league (adoptExistingData: true). Ordinary league creation derives the founding ' +
        'year and accepts no value for it.',
      { status: 400 }
    );
  }

  // `null` is a MEANINGFUL value here, distinct from omission: "this league has
  // no recorded founding year". `foundedYear` is optional and predates nothing —
  // leagues created before the field existed carry none, and league pages render
  // no `Est.` line for them. Without this, restoring such a league would force
  // the operator to invent a year that PATCH then freezes forever, which is the
  // fabrication this whole field exists to prevent. Omission still fails.
  let restoredFoundedYear: number | null = null;
  if (adoptExistingData) {
    if (!hasRestoreYear) {
      return new Response(
        'restoreFoundedYear is required when adopting surviving data: restoring a league must ' +
          'restore its founding year rather than silently recording the restoration date. ' +
          'Send null if the league has no recorded founding year.',
        { status: 400 }
      );
    }
    if (obj.restoreFoundedYear !== null) {
      const candidate =
        typeof obj.restoreFoundedYear === 'number'
          ? obj.restoreFoundedYear
          : typeof obj.restoreFoundedYear === 'string'
            ? Number(obj.restoreFoundedYear)
            : NaN;
      // The ceiling is the CURRENT calendar year, matching what ordinary
      // creation derives — deliberately NOT `maxCreatableSeasonYear`, which is
      // `currentYear + 1` because it bounds which SEASON may be created. A
      // founding year is the year the league came into existence, so a future
      // one is never a restoration of anything, and PATCH would freeze it.
      const ceiling = now.getUTCFullYear();
      if (!Number.isInteger(candidate) || candidate < 1900 || candidate > ceiling) {
        return new Response(
          `restoreFoundedYear must be null, or an integer year between 1900 and ${ceiling}`,
          { status: 400 }
        );
      }
      restoredFoundedYear = candidate;
    }
  }

  // PLATFORM-086F2B — new leagues are born with an explicit lifecycle status.
  // `status` is the lifecycle authority and the top-level `year` its synchronized
  // projection; initializing both here preserves the pre-F2B effective behavior
  // (a missing status was inferred as `{ state: 'season', year }`) while
  // preventing new missing-status records.
  // Adoption supplies the value, INCLUDING an explicit "none recorded";
  // ordinary creation derives it and offers no way to influence it.
  // PLATFORM-093 — the SEASON year, and who gets to state it.
  //
  // Ordinary creation DERIVES it and refuses a supplied value. There is only ever
  // one season in play — either it is under way or it is about to be — so there
  // was never a choice to offer, and accepting one invited a league to be created
  // for a season it will never play. This mirrors `restoreFoundedYear` directly:
  // a value the adopting path must state and the ordinary path may not send.
  //
  // ADOPTION still requires it, unchanged. It re-attaches a record to data that
  // already exists for a particular season, and deriving today's year would file
  // 2024 material under 2026 with no way to correct it afterwards — `updateLeague`
  // and `PATCH` both refuse `year`.
  const hasSuppliedYear = 'year' in obj;
  if (hasSuppliedYear && !adoptExistingData) {
    return new Response(
      'year is only accepted when adopting the surviving data of a previously deleted league ' +
        '(adoptExistingData: true). Ordinary league creation derives the season year and accepts ' +
        'no value for it.',
      { status: 400 }
    );
  }

  let year: number;
  if (adoptExistingData) {
    if (!hasSuppliedYear) {
      return new Response(
        'year is required when adopting surviving data: the data belongs to a particular season, ' +
          'and deriving the current one would file it under a season it does not belong to.',
        { status: 400 }
      );
    }
    const supplied =
      typeof obj.year === 'number'
        ? obj.year
        : typeof obj.year === 'string'
          ? Number(obj.year)
          : NaN;
    if (!isCreatableSeasonYear(supplied, nowMs)) {
      return new Response(
        `year must be an integer season year between ${MIN_SEASON_YEAR} and ${maxCreatableSeasonYear(nowMs)}`,
        { status: 400 }
      );
    }
    year = supplied;
  } else {
    year = seasonYearForNewLeague(now);
  }

  const foundedYear = adoptExistingData ? (restoredFoundedYear ?? undefined) : now.getUTCFullYear();

  const league: League = {
    slug,
    displayName,
    year,
    createdAt: now.toISOString(),
    // PLATFORM-086F2J — the FOUNDING year: the calendar year this league record
    // was created, rendered as `Est. N` on league pages. It is decorative
    // flavour for long-running leagues, and it is FROZEN here — `PATCH` refuses
    // it with `league-founded-year-immutable`.
    //
    // Deliberately NOT called a "first competition season", and deliberately NOT
    // derived from `seasonYearForToday()`. That helper answers "which season's
    // data are we looking at" and returns the PREVIOUS year between January and
    // June, so a league created in March 2026 would record 2025 — a season it
    // never played. The calendar year matches the coming season for most of the
    // year; a December creation records N while the league first plays N+1, and
    // that is accepted rather than special-cased.
    // On a RESTORATION this is the value the operator supplied; on ordinary
    // creation it is derived and there is no way to influence it.
    ...(foundedYear === undefined ? {} : { foundedYear }),
    // PLATFORM-093 — a new league is SETTING UP, not in season. It has no owners,
    // no roster and no draft, so `season` asserted something untrue about it and
    // — because every setup surface is gated on `preseason` — left it unable to
    // confirm owners at all.
    //
    // The old default was never a product decision: PLATFORM-086F2B chose it to
    // preserve the behaviour where a MISSING status was inferred as
    // `{ state: 'season', year }`, making that inference explicit so no new
    // status-less records appeared. It carried the inference forward without
    // asking whether it was right.
    //
    // Adoption keeps the same shape: it is restoring a league that is, from the
    // app's point of view, being set up again.
    status: { state: 'preseason', year },
  };

  const updated = await addLeague(league);
  return Response.json(
    { league: sanitizeLeague(league), leagues: sanitizeLeagues(updated) },
    { status: 201 }
  );
}
