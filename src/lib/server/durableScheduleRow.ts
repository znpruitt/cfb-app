import type { ScheduleWireItem } from '../schedule.ts';

/**
 * PLATFORM-813 — validate the durable ROW, once, at the boundary.
 *
 * **WHY THE TYPE DOES NOT PROTECT ANYTHING HERE.** `ScheduleWireItem` declares
 * `homeTeam: string`, `id: string`, `status: string`. A durable row is read from
 * JSON and cast straight to that type with no runtime check, so **TypeScript
 * believes every read is sound and the stored row is what lies.** A field holding a
 * JSON number typechecks at every call site and throws at the first string method.
 *
 * **AND `?.` / `?? ''` READ AS GUARDS WITHOUT BEING ONE.** `row.label?.trim()`
 * survives `null` and `undefined` and still throws on a number, because `(5).trim`
 * is `undefined` rather than callable. That is why v1's audit undercounted: the
 * guarded-LOOKING forms were precisely the unguarded ones.
 *
 * **WHY ONCE, HERE, RATHER THAN PER FIELD AT THE READS.** v1 guarded `eventKey` and
 * two review rounds found the next field four times. The measured surface is TEN
 * fields across 24 direct sites plus one transitive path — and every one of them is
 * downstream of the single canonical reader, which has 13 production consumers. One
 * validation covers all thirteen; a per-field guard covers one field and invites the
 * next sibling to jump in front of it. `postseason-classify.ts:216` reads
 * `row.homeTeam.trim()` on the FIRST line of `classifyScheduleRow`, ahead of every
 * guard v1 added — a guard a sibling read jumps in front of is not a guard.
 *
 * **COERCION, NOT DROPPING, AND THE DROP STAYS WHERE IT ALREADY IS.** A non-string
 * becomes `''`, which reproduces exactly what v1's per-field guards did, so no
 * consumer sees new semantics. A REGULAR row whose participant names coerce to empty is
 * then dropped by the rule that already drops nameless rows (`looksEmptyRow` →
 * `invalid_row` in `classifyScheduleRow`). **A postseason or conference-championship row
 * is not**: it bypasses `classifyScheduleRow` and becomes a TBD placeholder, which is
 * indistinguishable from a real one afterwards. That is why the boundary REPORTS what it
 * coerces or drops (`LOSSY_COERCIONS`, `issues`) — this comment used to say the existing
 * drop covered every coerced participant, and it covered one row kind in three. #693
 * binds: a writer that cannot say whether the season is complete reports that rather
 * than assuming.
 *
 * Asserted by `durableScheduleRow.test.ts` (per field, all ten), by
 * `canonicalScheduleCache.test.ts` (the boundary returns them coerced), and by
 * `durableRowCorruptionMatrix.test.ts` (no corrupted row reaches a durable writer's
 * output unreported).
 */

/**
 * Fields declared NON-OPTIONAL and non-nullable on `ScheduleWireItem`.
 *
 * For these, `null` and `undefined` are NOT absence — they are malformed, because the
 * type says a string is always present. `row.homeTeam.trim()` throws on `null` exactly
 * as it throws on a number, and the first version of this module skipped both on the
 * reasoning that "absence is legitimate". **That is true of the optional fields and
 * false of these**, and the fixture that should have caught it held six malformed
 * values, none of them `null`, for the same wrong reason.
 *
 * `startDate` is deliberately NOT here: it is required but its type is
 * `string | null`, so a null start date is a real state.
 */
const REQUIRED_STRING_FIELDS = [
  'id',
  'homeTeam',
  'awayTeam',
  'homeConference',
  'awayConference',
  'status',
] as const satisfies ReadonlyArray<keyof ScheduleWireItem>;

/**
 * Fields whose declared type admits a string but where absence is legitimate —
 * optional, nullable, or both.
 *
 * **THE COUNT IN THIS COMMENT USED TO BE WRONG, AND HOW is the reusable part.** It
 * said "20 of the type's 35 fields, MEASURED", and the enumeration behind it tested
 * whether each field's type ANNOTATION contained the substring `string`. So
 * `ProviderClassification` and `playoffRoundSource`'s union — both string types —
 * were never counted, and three fields were missing. **I measured the annotation, not
 * the type.** That is the same class as v1's short field list and as the regex that
 * produced the prompt's original six: a sweep measuring its own syntax rather than the
 * thing it is about. Third instance in this campaign.
 *
 * **And the corrected figure was then wrong too:** it read "22 … the remaining 15 are
 * here" above a list of sixteen. So this comment no longer carries a count at all. What
 * it claims is structural: every string-admitting field of `ScheduleWireItem` is in
 * `REQUIRED_STRING_FIELDS`, in this list, or is `venue` (handled separately because an
 * object is legitimate there).
 */
const OPTIONAL_STRING_FIELDS = [
  'startDate',
  'label',
  'notes',
  'seasonType',
  'gamePhase',
  'regularSubtype',
  'postseasonSubtype',
  'playoffRound',
  'playoffCompetition',
  'bowlName',
  'conferenceChampionshipConference',
  'eventKey',
  'neutralSiteDisplay',
  'homeClassification',
  'awayClassification',
  'playoffRoundSource',
] as const satisfies ReadonlyArray<keyof ScheduleWireItem>;

/**
 * Fields whose coercion CHANGES what a durable writer records, so the boundary reports
 * it and the archive and standings refuse.
 *
 * **MEASURED, NOT DECLARED.** Found by running every row kind × every string field ×
 * a non-string value through the real build with no refusal, and comparing each
 * game's identity (key, stage, week, participants, placeholder, status), its attached
 * score, and the standings against the uncorrupted season:
 *   - `homeTeam` / `awayTeam` — the game is dropped (regular) or becomes a TBD
 *     placeholder (postseason, conference championship), and its result is lost.
 *   - `status` — a final regular or championship game records as `matchup_set`.
 *   - `id` — a conference championship's score no longer attaches, so its result is
 *     lost. (Regular and postseason scores re-attach by teams. Planning suspected a
 *     key collision here; the matrix found no collision and this instead.)
 *   - `seasonType` — a postseason game moves to the wrong timeline week.
 *   - `eventKey` — a postseason game's key changes, so anything keyed on it (overrides,
 *     odds, the archive) stops matching. OPTIONAL fields, both; a list of required
 *     fields would never have held them.
 * Coercing the rest — conferences, labels, bowl names, subtypes — changes what a game
 * DISPLAYS, not which game it is or how it ended, so those are repaired silently.
 * `durableRowCorruptionMatrix.test.ts` fails if any field outside this set changes a
 * durable writer's output unreported.
 */
const LOSSY_COERCIONS: ReadonlySet<keyof ScheduleWireItem> = new Set<keyof ScheduleWireItem>([
  'id',
  'homeTeam',
  'awayTeam',
  'status',
  'seasonType',
  'eventKey',
]);

/** The ten fields a reader actually calls a string method on — the audited surface. */
export const METHOD_CALLED_FIELDS = [
  'homeTeam',
  'awayTeam',
  'id',
  'eventKey',
  'seasonType',
  'label',
  'startDate',
  'bowlName',
  'conferenceChampionshipConference',
  'status',
] as const satisfies ReadonlyArray<keyof ScheduleWireItem>;

export type DurableRowValidation = {
  items: ScheduleWireItem[];
  /**
   * What the boundary DESTROYED, in the vocabulary `buildScheduleFromApi` already uses
   * for a discarded row (`invalid-schedule-row: <reason>`), so a durable writer seeds
   * these into the build's own `issues` and checks ONE list.
   *
   * PLATFORM-813 v3 round 1: these are facts no other code computes. A non-object row
   * never reaches `classifyScheduleRow`; a postseason or conference-championship row
   * bypasses it; and after the build, a coerced postseason participant is
   * indistinguishable from a legitimate TBD slot. Only this function knows a non-string
   * was coerced rather than an empty string the provider sent — discarding that fact
   * here was the defect. **Which coercions are reported is not a declared list:** it is
   * the set the input-space matrix (`durableRowCorruptionMatrix.test.ts`) shows changing
   * a durable writer's output.
   */
  issues: string[];
  /**
   * The container could not be read as a list of rows at all.
   *
   * A VERDICT, not a count — deliberately. PLATFORM-813 v2 carried
   * `coercedFieldCount` and `droppedRowCount` here, a second and weaker record of a
   * fact `buildScheduleFromApi` already publishes with reasons attached
   * (`issues`, `schedule.ts:227/648/896`). Two sources of truth about one thing is the
   * pattern this repo keeps paying for, and the counts reached no production consumer
   * while the existing channel was being discarded. They are gone; this boolean is
   * the one thing the counts were load-bearing for that `issues` cannot say, because
   * it is about the CONTAINER rather than about any row.
   *
   * True when `items` was not an array, or when a NON-EMPTY array validated down to
   * nothing. Both mean "unreadable", which is distinct from a season that genuinely
   * has no rows — the distinction invariant 8 turns on. v2's `Array.isArray` guard
   * reported `0/0` for a non-array container and so recreated the very collapse it
   * was added to fix.
   */
  unreadableContainer: boolean;
};

/**
 * The prefix for a row that was lost or corrupted in a way that changes the season —
 * written by `buildScheduleFromApi` when it discards a row it cannot classify, and by
 * this module's boundary for what only the boundary can see.
 */
export const INVALID_ROW_ISSUE_PREFIX = 'invalid-schedule-row:';

/**
 * Every lost or corrupted row a completed build knows about, read from ONE list.
 *
 * `buildScheduleFromApi` pushes `invalid-schedule-row: <reason>` per row it discards and
 * returns them on `issues`. **That records one of the three places a row is lost** —
 * v3 treated it as the whole record, which was round 1's F1 and F2. The boundary's
 * reports (a dropped non-object row; a coercion in `LOSSY_COERCIONS`) are therefore
 * SEEDED into the same list through `buildScheduleFromApi`'s `boundaryIssues`, so a
 * durable writer checks one thing and the next loss site has one place to report to.
 */
export function discardedRowIssues(issues: readonly string[]): string[] {
  return issues.filter((issue) => issue.startsWith(INVALID_ROW_ISSUE_PREFIX));
}

/**
 * A build completed, but rows were discarded — so its games are not the season.
 *
 * Thrown by consumers that would otherwise record or cache the result as complete.
 * Distinct from `SeasonScheduleCacheUnavailableError` (nothing was cached) and from
 * `SeasonScheduleUnreadableError` (the container could not be read): here the games
 * are real, and what cannot be supported is the claim that they are ALL of them.
 */
export class SeasonScheduleIncompleteError extends Error {
  constructor(
    readonly year: number,
    readonly discarded: readonly string[]
  ) {
    super(
      `season ${year}: ${discarded.length} schedule row(s) were discarded by the build (${discarded.join('; ')}) — refusing to record or cache this season as complete`
    );
    this.name = 'SeasonScheduleIncompleteError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerce every non-string value in a string-typed field to `''`, and REPORT each one that
 * changes what a durable writer records (`LOSSY_COERCIONS`) along with every dropped row.
 *
 * `undefined` and `null` are left ALONE. They are legitimate values for the optional
 * fields, every consumer already handles them (`?.` and `?? ''` do work for absence),
 * and turning `undefined` into `''` would make an absent field indistinguishable
 * from a present-but-empty one — a different fact, and not this slice's to change.
 */
export function validateDurableScheduleRows(items: unknown): DurableRowValidation {
  // `StoredScheduleEntry.items?: T[]` is the SAME LIE this module's header is about,
  // and the first version of this function trusted it one line into the loop: a
  // non-array `items` threw `items is not iterable` out of the boundary, where the
  // record had previously returned an entry. A module written about not trusting the
  // declared type must not trust it either.
  if (!Array.isArray(items)) {
    // UNREADABLE, not empty. v2 returned `0/0` here, which `assertReadable` then read
    // as "measured, nothing wrong" — a fix that recreated the collapse it fixed.
    return { items: [], unreadableContainer: true, issues: [] };
  }

  const out: ScheduleWireItem[] = [];
  const issues: string[] = [];

  items.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      // A non-object row cannot be repaired into one, so it is DROPPED rather than
      // coerced — there is nothing to coerce — and REPORTED, because nothing downstream
      // can: the row never reaches `buildScheduleFromApi`, so its `issues` cannot carry
      // it. This comment used to say the drop was "counted separately"; it described
      // `droppedRowCount`, which v3 deleted, and it survived the deletion still claiming
      // the loss was recorded. That false comment is why F1 was not seen.
      issues.push(
        `${INVALID_ROW_ISSUE_PREFIX} durable row #${index} is ${describe(raw)}, not an object — dropped at the read boundary`
      );
      return;
    }

    let next: Record<string, unknown> | null = null;

    // REQUIRED: the type promises a string is always there, so null and undefined are
    // malformed here rather than absent, and `.trim()` throws on them just as it does
    // on a number.
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof raw[field] === 'string') continue;
      if (LOSSY_COERCIONS.has(field)) {
        issues.push(
          `${INVALID_ROW_ISSUE_PREFIX} durable row ${rowLabel(raw, index)} field ${field} held ${describe(raw[field])}, coerced to '' at the read boundary`
        );
      }
      if (!next) next = { ...raw };
      next[field] = '';
    }

    // OPTIONAL: absence is a real state every consumer already handles, and coercing
    // it would make an absent field indistinguishable from an empty one.
    for (const field of OPTIONAL_STRING_FIELDS) {
      const value = raw[field];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string') continue;
      if (LOSSY_COERCIONS.has(field)) {
        issues.push(
          `${INVALID_ROW_ISSUE_PREFIX} durable row ${rowLabel(raw, index)} field ${field} held ${describe(value)}, coerced to '' at the read boundary`
        );
      }
      if (!next) next = { ...raw };
      next[field] = '';
    }

    // `venue` admits `VenueInfo | string | null`, so only a value that is neither a
    // string nor an object is wrong here.
    const venue = raw.venue;
    if (
      venue !== undefined &&
      venue !== null &&
      typeof venue !== 'string' &&
      !isPlainObject(venue)
    ) {
      if (!next) next = { ...raw };
      next.venue = null;
    }

    out.push((next ?? raw) as unknown as ScheduleWireItem);
  });

  // A non-empty container that validated down to nothing is unreadable; an empty one
  // is genuine absence.
  return { items: out, unreadableContainer: items.length > 0 && out.length === 0, issues };
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** A string id names the row; otherwise its position does, since the id is what is broken. */
function rowLabel(raw: Record<string, unknown>, index: number): string {
  return typeof raw.id === 'string' && raw.id !== '' ? `'${raw.id}'` : `#${index}`;
}
