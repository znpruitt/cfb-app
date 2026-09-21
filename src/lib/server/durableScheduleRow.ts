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
 * consumer sees new semantics. A row whose participant names coerce to empty is then
 * dropped by the rule that ALREADY drops nameless rows — `looksEmptyRow` →
 * `invalid_row` in `classifyScheduleRow` — rather than by a new rule invented at the
 * boundary. Dropping here would silently change standings, and #693 binds: a reader
 * that cannot say whether the season is complete reports that rather than assuming.
 *
 * Asserted by `durableScheduleRow.test.ts` (per field, all ten) and by
 * `canonicalScheduleCache.test.ts` (the boundary returns them coerced and counts).
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
 * Now: 22 of the type's 35 fields admit a string. Six are required (above), `venue` is
 * handled separately because an object is legitimate there, and the remaining 15 are
 * here.
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
   * How many individual FIELDS were coerced, or `null` when validation did not run.
   *
   * `number | null`, not `number`, and the distinction is load-bearing: a path that
   * never validated and a row set that needed no coercion both produce `0`, and
   * those are different facts. That collapse is #804's defect — a failed count
   * publishing `0` is indistinguishable from a real zero — so `null` means "not
   * measured here" and `0` means "measured, nothing wrong".
   */
  coercedFieldCount: number | null;
  /**
   * How many ROWS were dropped outright for not being objects, or `null` when
   * validation did not run.
   *
   * SEPARATE from the field count on purpose: "six fields were repaired" and "six
   * rows were discarded" are different questions with different consequences, and one
   * number cannot carry both. A dropped row changes the season's CONTENT; a coerced
   * field changes one value within a row that survives. The all-dropped throw in
   * `loadCachedScheduleItems` keys on this one.
   */
  droppedRowCount: number | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerce every non-string value in a string-typed field to `''`, counting each one.
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
    return { items: [], coercedFieldCount: 0, droppedRowCount: 0 };
  }

  const out: ScheduleWireItem[] = [];
  let coerced = 0;
  let dropped = 0;

  for (const raw of items) {
    if (!isPlainObject(raw)) {
      // A non-object row cannot be repaired into one, so it is DROPPED rather than
      // coerced — there is nothing to coerce — and counted separately, because a
      // discarded row changes the season's content while a repaired field does not.
      dropped += 1;
      continue;
    }

    let next: Record<string, unknown> | null = null;

    // REQUIRED: the type promises a string is always there, so null and undefined are
    // malformed here rather than absent, and `.trim()` throws on them just as it does
    // on a number.
    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof raw[field] === 'string') continue;
      if (!next) next = { ...raw };
      next[field] = '';
      coerced += 1;
    }

    // OPTIONAL: absence is a real state every consumer already handles, and coercing
    // it would make an absent field indistinguishable from an empty one.
    for (const field of OPTIONAL_STRING_FIELDS) {
      const value = raw[field];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string') continue;
      if (!next) next = { ...raw };
      next[field] = '';
      coerced += 1;
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
      coerced += 1;
    }

    out.push((next ?? raw) as unknown as ScheduleWireItem);
  }

  return { items: out, coercedFieldCount: coerced, droppedRowCount: dropped };
}
