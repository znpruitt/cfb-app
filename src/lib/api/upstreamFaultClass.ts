import { UpstreamFetchError } from './fetchUpstream.ts';

/**
 * PLATFORM-126B — the ONE closed, secret-safe upstream fault vocabulary.
 *
 * ## Why this exists
 *
 * `fetchFullSeasonSchedulePartition` and the rankings `fetchPartition` each
 * reduced every provider transport failure to a single `fetch-failed` token —
 * the same line of code in both files. The September 1, 2026 weekly schedule
 * failure is the production proof of the cost: 153 hours later the entire
 * durable record was `failure / year-results`, and whether CFBD had timed out,
 * refused with an HTTP status, dropped the connection, or returned unparseable
 * JSON was no longer establishable from anything the app had kept.
 *
 * ## What may cross this boundary
 *
 * `UpstreamError` (see `fetchUpstream.ts`) carries `message`, `statusText`,
 * `url` and — on an HTTP fault — the FULL `responseBody`. None of that may reach
 * a durable store. This class is therefore constructed from exactly two of its
 * fields, `kind` and `status`, and is never spread, widened, or built from a raw
 * error object. Five members and one optional bounded integer is the whole
 * surface; a member added here must be secret-safe by construction, not by the
 * care of the caller who records it.
 *
 * ## Why FIVE members and not four
 *
 * It mirrors {@link UpstreamErrorKind} exactly. The item's prose said four and
 * omitted `aborted`; collapsing `aborted` onto `network` would be precisely the
 * lossy mapping this work exists to remove, and inventing one inside the module
 * whose job is not losing things would be self-defeating (owner ruling,
 * 2026-09-07). Neither Tier B caller passes a request signal today, so `aborted`
 * should be unreachable from these two paths — "should be" is exactly the class
 * of assumption that produced the original collapse, so the member is carried.
 */
export type UpstreamFaultKind = 'timeout' | 'aborted' | 'network' | 'http' | 'parse';

/** The closed set, in the order `UpstreamErrorKind` declares it. */
export const UPSTREAM_FAULT_KINDS = [
  'timeout',
  'aborted',
  'network',
  'http',
  'parse',
] as const satisfies readonly UpstreamFaultKind[];

const UPSTREAM_FAULT_KIND_VALUES: ReadonlySet<string> = new Set(UPSTREAM_FAULT_KINDS);

export type UpstreamFaultClass = {
  kind: UpstreamFaultKind;
  /**
   * The upstream HTTP status. Non-null ONLY for `kind: 'http'` — every other
   * member has no status to report, and a stored record claiming one is
   * normalized to null rather than rendered as though the provider had answered.
   * Bounded to a real status code so an arbitrary integer cannot ride in here.
   */
  status: number | null;
};

/** A real HTTP status code — the only numeric value this class may carry. */
function isHttpStatus(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599;
}

/**
 * Classify a thrown upstream error into the closed class, or `null` when the
 * throw did not come from the shared upstream helper and therefore carries no
 * classification this module can honestly make.
 *
 * `null` is deliberate and is NOT defaulted to `network`: an unrecognized throw
 * is an unknown fault, and recording it as a network fault would manufacture
 * exactly the kind of confident-but-wrong evidence the September 1 postmortem
 * lacked. A caller stores the `null` as "fetch failed, class unknown", which is
 * the truth and is also what a legacy receipt reads as.
 */
export function classifyUpstreamFault(error: unknown): UpstreamFaultClass | null {
  if (!(error instanceof UpstreamFetchError)) return null;
  const { kind, status } = error.details;
  if (!UPSTREAM_FAULT_KIND_VALUES.has(kind)) return null;
  return { kind, status: kind === 'http' && isHttpStatus(status) ? status : null };
}

/** True when a STORED value is a shape-valid member of the closed class. */
export function isStoredUpstreamFaultClass(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !UPSTREAM_FAULT_KIND_VALUES.has(record.kind)) return false;
  // The STATUS never rejects a record, on any kind.
  //
  // Rejecting here fails the whole receipt: `isValidStoredYearOutcome` →
  // `isValidYearEntries` → `parseSchedulerExecutionReceipt` returns null, the
  // System Health row degrades to `invalid`, and the run loses `result`,
  // `reason`, `target` and BOTH timestamps. That is the same whole-record
  // rejection identified as this widening's migration hazard, and it would
  // discard exactly the forensic surface this item exists to preserve — over an
  // observability-only integer.
  //
  // Nothing is lost by accepting: `rebuildUpstreamFaultClass` normalizes an
  // out-of-range or wrong-kind status to null, so the worst a corrupt row can
  // render is the bare, truthful label `http`. Round 2 corrected round 1 here,
  // which had left `http` strict while relaxing every other kind — an asymmetry
  // that was incoherent in either direction. Same reasoning as the
  // `buildCommitSha` guard, which this file already documents.
  return true;
}

/**
 * Rebuild a stored class field-by-field so no extra property escapes a durable
 * read. `null` in, `null` out; the status is dropped for every non-`http`
 * member, so a corrupt record cannot render a status the provider never sent.
 */
export function rebuildUpstreamFaultClass(
  value: UpstreamFaultClass | null | undefined
): UpstreamFaultClass | null {
  if (value === null || value === undefined) return null;
  return {
    kind: value.kind,
    status: value.kind === 'http' && isHttpStatus(value.status) ? value.status : null,
  };
}

/**
 * A human, bounded rendering — `http 503`, `timeout`. Never an error message.
 *
 * Takes a PRESENT class deliberately: a partition with no class did not fail in
 * transport at all (a payload, drift, or coverage rejection), and labelling that
 * `unclassified` would read as lost evidence rather than as the absence of a
 * transport fault. Callers render the bare partition name in that case.
 */
export function upstreamFaultLabel(fault: UpstreamFaultClass): string {
  return fault.kind === 'http' && fault.status !== null ? `http ${fault.status}` : fault.kind;
}
