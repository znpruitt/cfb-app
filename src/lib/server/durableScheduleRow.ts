import type { ProviderClassification } from '../conferenceSubdivision.ts';
import type { ScheduleWireItem } from '../schedule.ts';
import type { ScheduleMediaType } from '../schedule/schedulePresentation.ts';

/**
 * PLATFORM-813 v4 — a durable schedule row either CONFORMS to `ScheduleWireItem`, or the
 * read fails with an error that names the row and the field.
 *
 * **WHY THE READ FAILS RATHER THAN SERVING WHAT IS LEFT.** v2 and v3 coerced bad fields and
 * served the surviving rows. Six review rounds each found another consumer that assumed the
 * rows it held were the whole season — an archive, a tag-cached standings snapshot, an odds
 * refresh that erased prior-good data on the strength of the survivors. Each fix worked from
 * a list of consumers somebody had already checked. `main` already failed closed; its defect
 * was that the failure was an unattributable `TypeError` thrown deep in the build. This keeps
 * the failure and makes it legible. No consumer ever holds partial data, so none can cache,
 * archive or destroy anything on the strength of it.
 *
 * **THE CONTRACT IS THE DECLARED TYPE, NOT THE SET OF FIELDS THAT CURRENTLY CRASH.** `main`
 * only crashed on a field some code happened to call a method on, which is why every earlier
 * list was incomplete. {@link ROW_CONTRACT} is keyed by EVERY property of `ScheduleWireItem`
 * — `tsc` rejects it if a field is added to the type without a spec here — and the closed
 * unions are checked against their full sets. Nested types are checked all the way down
 * (`venue`'s fields, each `media` item), because a special case is how a hand-picked list
 * creeps back in.
 *
 * **NO COERCION, ANYWHERE.** Coercion is what turned "malformed" into "silently different" in
 * v2 and v3. A conforming row is returned untouched — the same object — so a well-typed season
 * is byte-identical to what `main` served. Normalising PROVIDER input is the writer's job
 * (`mapCfbdScheduleGame`); this is the reader, and it only checks.
 */

type FieldSpec = {
  /** Required by the type: absence is non-conformance. */
  required: boolean;
  /** What the declared type admits, for the error message. */
  expected: string;
  conforms: (value: unknown) => boolean;
};

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const orNull =
  (check: (value: unknown) => boolean) =>
  (value: unknown): boolean =>
    value === null || check(value);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Closed unions, as `Record<Literal, true>` so the compiler holds them to the type: a literal
 * missing from the type's union, or one the union has and this lacks, is a compile error. The
 * vocabulary therefore cannot drift from the declaration the way a second hand-written set can.
 */
const PROVIDER_CLASSIFICATIONS: Record<ProviderClassification, true> = {
  fbs: true,
  fcs: true,
  ii: true,
  iii: true,
};
const PLAYOFF_ROUND_SOURCES: Record<NonNullable<ScheduleWireItem['playoffRoundSource']>, true> = {
  'cfbd-structured': true,
  'explicit-provider-field': true,
  'text-inferred': true,
};
const MEDIA_TYPES: Record<ScheduleMediaType, true> = {
  tv: true,
  radio: true,
  web: true,
  ppv: true,
  mobile: true,
};

const inSet =
  (set: Record<string, true>) =>
  (value: unknown): boolean =>
    isString(value) && Object.prototype.hasOwnProperty.call(set, value);

/** `VenueInfo`: all four fields declared, each `string | null`. */
function isVenueInfo(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    (['stadium', 'city', 'state', 'country'] as const).every(
      (field) => field in value && orNull(isString)(value[field])
    )
  );
}

/** `ScheduleMediaItem[]`. */
function isMediaList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isPlainObject(item) &&
        isString(item.gameId) &&
        inSet(MEDIA_TYPES)(item.mediaType) &&
        isString(item.outlet)
    )
  );
}

const required = (expected: string, conforms: FieldSpec['conforms']): FieldSpec => ({
  required: true,
  expected,
  conforms,
});
const optional = (expected: string, conforms: FieldSpec['conforms']): FieldSpec => ({
  required: false,
  expected,
  conforms,
});

/**
 * THE CONTRACT: one entry per property of `ScheduleWireItem`, no more and no fewer.
 * `Required<...>` makes the optional properties mandatory KEYS here, so an unspecified field
 * fails to compile rather than passing unchecked.
 */
export const ROW_CONTRACT: { [K in keyof Required<ScheduleWireItem>]: FieldSpec } = {
  id: required('string', isString),
  week: required('number', isNumber),
  providerWeek: optional('number', isNumber),
  canonicalWeek: optional('number', isNumber),
  startDate: required('string | null', orNull(isString)),
  neutralSite: required('boolean', isBoolean),
  conferenceGame: required('boolean', isBoolean),
  homeTeam: required('string', isString),
  awayTeam: required('string', isString),
  homeId: optional('number | null', orNull(isNumber)),
  awayId: optional('number | null', orNull(isNumber)),
  homeConference: required('string', isString),
  awayConference: required('string', isString),
  homeClassification: optional("'fbs' | 'fcs' | 'ii' | 'iii'", inSet(PROVIDER_CLASSIFICATIONS)),
  awayClassification: optional("'fbs' | 'fcs' | 'ii' | 'iii'", inSet(PROVIDER_CLASSIFICATIONS)),
  status: required('string', isString),
  completed: optional('boolean', isBoolean),
  startTimeTBD: optional('boolean', isBoolean),
  venue: optional(
    'VenueInfo | string | null',
    orNull((v) => isString(v) || isVenueInfo(v))
  ),
  venueId: optional('number', isNumber),
  media: optional('ScheduleMediaItem[]', isMediaList),
  label: optional('string | null', orNull(isString)),
  notes: optional('string | null', orNull(isString)),
  seasonType: optional('string | null', orNull(isString)),
  gamePhase: optional('string | null', orNull(isString)),
  regularSubtype: optional('string | null', orNull(isString)),
  postseasonSubtype: optional('string | null', orNull(isString)),
  playoffRound: optional('string | null', orNull(isString)),
  playoffCompetition: optional('string', isString),
  playoffRoundSource: optional(
    "'cfbd-structured' | 'explicit-provider-field' | 'text-inferred'",
    inSet(PLAYOFF_ROUND_SOURCES)
  ),
  bowlName: optional('string | null', orNull(isString)),
  conferenceChampionshipConference: optional('string | null', orNull(isString)),
  eventKey: optional('string | null', orNull(isString)),
  slotOrder: optional('number | null', orNull(isNumber)),
  neutralSiteDisplay: optional('string | null', orNull(isString)),
};

/** What a value IS, for the error message: `null`, `an array`, or its `typeof`. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'absent';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  return typeof value;
}

/**
 * A stored schedule row does not conform to `ScheduleWireItem`, so the season cannot be read.
 *
 * Names everything an operator needs to find it: the durable key, the row's position, its
 * `id` where it has a usable one, the field, and what the field actually holds.
 */
export class ScheduleRowNonConformanceError extends Error {
  constructor(
    readonly key: string,
    /** Position in the stored `items` array; `null` when the container itself is wrong. */
    readonly index: number | null,
    readonly rowId: string | null,
    /** The field, `'<row>'` for a non-object row, or `'items'` for a non-array container. */
    readonly field: string,
    readonly observed: string,
    readonly expected: string
  ) {
    const where =
      index === null
        ? ''
        : ` row #${index}${rowId !== null ? ` (id ${JSON.stringify(rowId)})` : ''}`;
    super(
      `schedule ${key}:${where} ${field} is ${observed}, expected ${expected} — the stored season does not conform to ScheduleWireItem and cannot be read`
    );
    this.name = 'ScheduleRowNonConformanceError';
  }
}

/**
 * Assert that a stored `items` value is an array of conforming rows, and return it UNCHANGED.
 *
 * Throws {@link ScheduleRowNonConformanceError} on the first violation. An empty array
 * conforms: genuine absence is a real state, distinct from a malformed one.
 */
export function assertConformingScheduleRows(key: string, items: unknown): ScheduleWireItem[] {
  if (!Array.isArray(items)) {
    throw new ScheduleRowNonConformanceError(
      key,
      null,
      null,
      'items',
      describe(items),
      'ScheduleWireItem[]'
    );
  }
  items.forEach((row, index) => {
    if (!isPlainObject(row)) {
      throw new ScheduleRowNonConformanceError(
        key,
        index,
        null,
        '<row>',
        describe(row),
        'an object'
      );
    }
    const rowId = isString(row.id) ? row.id : null;
    for (const [field, spec] of Object.entries(ROW_CONTRACT) as Array<[string, FieldSpec]>) {
      const present = Object.prototype.hasOwnProperty.call(row, field) && row[field] !== undefined;
      if (!present) {
        if (spec.required) {
          throw new ScheduleRowNonConformanceError(
            key,
            index,
            rowId,
            field,
            'absent',
            spec.expected
          );
        }
        continue;
      }
      if (!spec.conforms(row[field])) {
        throw new ScheduleRowNonConformanceError(
          key,
          index,
          rowId,
          field,
          describe(row[field]),
          spec.expected
        );
      }
    }
  });
  return items as ScheduleWireItem[];
}
