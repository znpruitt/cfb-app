import type { GameStats, TeamGameStats } from './types.ts';
import type { CfbdSeasonType } from '../cfbd.ts';

/**
 * PLATFORM-086H1 — game-stats data contract.
 *
 * One authoritative home for: the recognized category specification, strict
 * category parsing from untrusted provider values, per-row schema versioning,
 * typed row classification, persistence/completeness/analytics predicates,
 * season-aware recovery policy, the canonical analytics projection, and
 * deterministic duplicate-game selection.
 *
 * Boundary rules:
 *   - This module imports only game-stats types. It must never import cron,
 *     route, database, diagnostic, or UI code.
 *   - All decisions here derive from RAW provider evidence (`team.raw` and the
 *     structural points value) re-parsed through the strict parsers below.
 *     Stored normalized fields are NEVER trusted as provider evidence — the
 *     legacy normalizer backfills zeroes for absent/malformed values, so a
 *     normalized `0` cannot be distinguished from an observed `0` without
 *     consulting the raw category map.
 *   - The lenient legacy normalizer (`normalizers.ts`) remains the unchanged
 *     production write path while v2 writers stay dormant; it is deliberately
 *     NOT rewritten here because strict parsing would alter written output for
 *     observed wire quirks (e.g. `fourthDownEff: "2-1"`). The strict system in
 *     this module is the single parser for classification, projection, v2
 *     construction, and future merge rebuilding — no second strict parser may
 *     be introduced elsewhere.
 *
 * The legacy-compatibility bounds in this module were validated against the
 * complete 2021–2025 durable inventory (PLATFORM-086H1-LEGACY-DURABLE-DATA-
 * INVENTORY-AUDIT-v1): 7,335 stored rows, zero identity defects, zero duplicate
 * game ids, and exact owner-analytics parity under these rules (the four rows
 * that initially failed carried leading-space possession clocks such as
 * `" 9:12"`, which is why `possessionTime` — and only `possessionTime` — is
 * trimmed before parsing).
 */

// === Category specification ===

export type CategoryParserKind =
  /** Canonical non-negative safe integer, e.g. `"7"`. */
  | 'count'
  /** Canonical safe integer where negatives are legitimate (yardage). */
  | 'signed-yardage'
  /** `made-attempted` with non-negative components and `made <= attempted`. */
  | 'efficiency'
  /** `count-yards` with non-negative components and NO ordering relation. */
  | 'count-yards'
  /** Possession clock `M:SS`/`MM:SS`, seconds 00–59, minutes 0–90. */
  | 'clock';

export type GameStatCategorySpec = {
  kind: CategoryParserKind;
  /** One of the six categories every analytics-eligible row must carry. */
  analyticsRequired: boolean;
};

/**
 * The one authoritative recognized-category map. Everything the application
 * already consumed via the legacy normalizer is recognized, plus the
 * inventory-confirmed raw-only return-count categories (`kickReturns`,
 * `puntReturns`), which appear on the wire but feed no normalized field.
 *
 * Observed-but-unmodeled wire categories (present in the 2021–2025 inventory,
 * deliberately NOT recognized): sacks, tackles, qbHurries, defensiveTDs,
 * totalFumbles, tacklesForLoss, passesDeflected, kickingPoints, yardsPerPass,
 * yardsPerRushAttempt, and completionAttempts. `completionAttempts` is CFBD's
 * actual completions/attempts pair (e.g. `"22-33"`) — the recognized
 * `passAttempts`/`passCompletions` names never occur on the wire — but adding
 * it would expand normalized analytics behavior, so it stays unmodeled in this
 * PR. Unknown categories never establish persistence authority or strict
 * completeness, and never invalidate an otherwise complete row.
 */
export const GAME_STAT_CATEGORY_SPECS: Readonly<Record<string, GameStatCategorySpec>> = {
  firstDowns: { kind: 'count', analyticsRequired: false },
  fumblesLost: { kind: 'count', analyticsRequired: false },
  fumblesRecovered: { kind: 'count', analyticsRequired: false },
  interceptionTDs: { kind: 'count', analyticsRequired: false },
  interceptions: { kind: 'count', analyticsRequired: false },
  kickReturnTDs: { kind: 'count', analyticsRequired: false },
  kickReturns: { kind: 'count', analyticsRequired: false },
  passAttempts: { kind: 'count', analyticsRequired: false },
  passCompletions: { kind: 'count', analyticsRequired: false },
  passesIntercepted: { kind: 'count', analyticsRequired: false },
  passingTDs: { kind: 'count', analyticsRequired: false },
  puntReturnTDs: { kind: 'count', analyticsRequired: false },
  puntReturns: { kind: 'count', analyticsRequired: false },
  rushingAttempts: { kind: 'count', analyticsRequired: false },
  rushingTDs: { kind: 'count', analyticsRequired: false },
  turnovers: { kind: 'count', analyticsRequired: true },
  interceptionYards: { kind: 'signed-yardage', analyticsRequired: false },
  kickReturnYards: { kind: 'signed-yardage', analyticsRequired: false },
  netPassingYards: { kind: 'signed-yardage', analyticsRequired: true },
  puntReturnYards: { kind: 'signed-yardage', analyticsRequired: false },
  rushingYards: { kind: 'signed-yardage', analyticsRequired: true },
  totalYards: { kind: 'signed-yardage', analyticsRequired: true },
  thirdDownEff: { kind: 'efficiency', analyticsRequired: true },
  fourthDownEff: { kind: 'efficiency', analyticsRequired: false },
  totalPenaltiesYards: { kind: 'count-yards', analyticsRequired: false },
  possessionTime: { kind: 'clock', analyticsRequired: true },
};

export const RECOGNIZED_GAME_STAT_CATEGORIES: readonly string[] = Object.freeze(
  Object.keys(GAME_STAT_CATEGORY_SPECS).sort()
);

/** The six categories required on BOTH sides for strict completeness. */
export const ANALYTICS_REQUIRED_CATEGORIES: readonly string[] = Object.freeze(
  Object.keys(GAME_STAT_CATEGORY_SPECS)
    .filter((category) => GAME_STAT_CATEGORY_SPECS[category]!.analyticsRequired)
    .sort()
);

/**
 * Negative values are legitimate ONLY for these yardage categories — every one
 * was observed negative in the 2021–2025 inventory (930 negative punt-return
 * values alone). All other recognized categories are non-negative.
 */
export const NEGATIVE_ALLOWED_CATEGORIES: ReadonlySet<string> = new Set(
  Object.keys(GAME_STAT_CATEGORY_SPECS).filter(
    (category) => GAME_STAT_CATEGORY_SPECS[category]!.kind === 'signed-yardage'
  )
);

// === Strict parsing from untrusted values ===

// Full-string canonical integer grammars. No prefixes, suffixes, signs (except
// the single leading minus of the signed form), decimals, exponents,
// whitespace, or leading zeroes beyond a lone "0".
const CANONICAL_NON_NEGATIVE_INT = /^(?:0|[1-9]\d*)$/;
const CANONICAL_SIGNED_INT = /^(?:0|[1-9]\d*|-[1-9]\d*)$/;
// Possession clock: M:SS or MM:SS, seconds 00–59. Minutes are bounded to
// MAX_POSSESSION_MINUTES after the structural match.
const POSSESSION_CLOCK = /^(\d{1,2}):([0-5]\d)$/;

/**
 * Upper bound for a parseable possession clock. The inventory's observed
 * maximum is 59 minutes; 90 leaves overtime headroom while still rejecting
 * garbage clocks.
 */
export const MAX_POSSESSION_MINUTES = 90;

export type ParsedStatValue =
  | { kind: 'count'; value: number }
  | { kind: 'signed-yardage'; value: number }
  | { kind: 'efficiency'; made: number; attempted: number }
  | { kind: 'count-yards'; count: number; yards: number }
  | { kind: 'clock'; seconds: number };

export type CategoryParseResult =
  | { status: 'unknown-category' }
  | { status: 'malformed' }
  | { status: 'valid'; value: ParsedStatValue };

function parseCanonicalInt(value: string, allowNegative: boolean): number | null {
  const grammar = allowNegative ? CANONICAL_SIGNED_INT : CANONICAL_NON_NEGATIVE_INT;
  if (!grammar.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePair(value: string): { first: number; second: number } | null {
  // Exactly one delimiter with canonical non-negative components on each side.
  // Splitting on "-" would mis-tokenize negative components (observed wire
  // garbage like "1--1"), so match structurally instead.
  const match = /^(\d+)-(\d+)$/.exec(value);
  if (!match) return null;
  const first = parseCanonicalInt(match[1]!, false);
  const second = parseCanonicalInt(match[2]!, false);
  if (first === null || second === null) return null;
  return { first, second };
}

/**
 * Strictly parse one raw category value. `value` is untrusted: only strings are
 * parseable — non-string values are malformed and never coerced. Unrecognized
 * categories are reported as such (they are not malformed; they are simply
 * outside the contract).
 */
export function parseCategoryValue(category: string, value: unknown): CategoryParseResult {
  const spec = GAME_STAT_CATEGORY_SPECS[category];
  if (!spec) return { status: 'unknown-category' };
  if (typeof value !== 'string') return { status: 'malformed' };

  switch (spec.kind) {
    case 'count': {
      const parsed = parseCanonicalInt(value, false);
      if (parsed === null) return { status: 'malformed' };
      return { status: 'valid', value: { kind: 'count', value: parsed } };
    }
    case 'signed-yardage': {
      const parsed = parseCanonicalInt(value, true);
      if (parsed === null) return { status: 'malformed' };
      return { status: 'valid', value: { kind: 'signed-yardage', value: parsed } };
    }
    case 'efficiency': {
      const pair = parsePair(value);
      if (!pair || pair.first > pair.second) return { status: 'malformed' };
      return {
        status: 'valid',
        value: { kind: 'efficiency', made: pair.first, attempted: pair.second },
      };
    }
    case 'count-yards': {
      const pair = parsePair(value);
      if (!pair) return { status: 'malformed' };
      return {
        status: 'valid',
        value: { kind: 'count-yards', count: pair.first, yards: pair.second },
      };
    }
    case 'clock': {
      // Surrounding whitespace is trimmed for possessionTime ONLY: the durable
      // inventory proved CFBD emits leading-space clocks (" 9:12") for
      // sub-10-minute values, and exact 2021–2025 parity requires accepting
      // them. No other category trims anything.
      const match = POSSESSION_CLOCK.exec(value.trim());
      if (!match) return { status: 'malformed' };
      const minutes = Number(match[1]);
      if (minutes > MAX_POSSESSION_MINUTES) return { status: 'malformed' };
      return {
        status: 'valid',
        value: { kind: 'clock', seconds: minutes * 60 + Number(match[2]) },
      };
    }
  }
}

/**
 * Structural points evidence: a JSON number that is a finite, non-negative safe
 * integer. String `"0"` is malformed — points arrive as numbers on the wire and
 * are never coerced. A normalized fallback zero never establishes evidence.
 */
export function isValidPointsValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Positive safe-integer CFBD provider game id — the only addressable form. */
export function isValidProviderGameId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

// === Row classification ===

export type GameStatsRowClassificationState =
  | 'unaddressable'
  | 'unusable-identity'
  | 'non-persistable-empty'
  | 'non-persistable-unknown-only'
  | 'non-persistable-malformed-only'
  | 'non-persistable-one-sided'
  | 'v2-sparse'
  | 'v2-complete'
  | 'legacy-compatible'
  | 'legacy-statless'
  | 'legacy-malformed'
  | 'legacy-normalized-mismatch'
  | 'malformed-v2'
  | 'unsupported-version';

export type GameStatsRowClassification = {
  state: GameStatsRowClassificationState;
  /**
   * Machine-readable detail tokens (e.g. `home:malformed-category:turnovers`,
   * `normalized-mismatch:possessionSeconds:away`) — enough for tests, future
   * migration inventory, and future diagnostics without re-deriving policy.
   */
  reasons: string[];
};

export const GAME_STATS_SCHEMA_VERSION = 2 as const;

type RowRecord = Record<string, unknown>;

function asRecord(value: unknown): RowRecord | null {
  return typeof value === 'object' && value !== null ? (value as RowRecord) : null;
}

function hasNonblankSchool(team: RowRecord): boolean {
  return typeof team.school === 'string' && team.school.trim().length > 0;
}

type SideContent = {
  /** Raw string-valued entries (the only entries that can carry evidence). */
  entryCount: number;
  recognizedCount: number;
  recognizedValid: Set<string>;
  recognizedMalformed: Set<string>;
};

function evaluateSideContent(raw: unknown): SideContent {
  const content: SideContent = {
    entryCount: 0,
    recognizedCount: 0,
    recognizedValid: new Set(),
    recognizedMalformed: new Set(),
  };
  const map = asRecord(raw);
  if (!map) return content;
  for (const [category, value] of Object.entries(map)) {
    content.entryCount += 1;
    const result = parseCategoryValue(category, value);
    if (result.status === 'unknown-category') continue;
    content.recognizedCount += 1;
    if (result.status === 'valid') content.recognizedValid.add(category);
    else content.recognizedMalformed.add(category);
  }
  return content;
}

function missingOrMalformedRequired(content: SideContent): string[] {
  return ANALYTICS_REQUIRED_CATEGORIES.filter((category) => !content.recognizedValid.has(category));
}

/**
 * Rebuild the six required normalized analytics fields from raw legacy evidence
 * and compare them to the STORED normalized fields. Exact agreement is a
 * precondition of legacy compatibility: the stored fields are what production
 * analytics served historically, so a divergence means either the stored row or
 * the strict rebuild cannot be trusted — the row is quarantined as
 * `legacy-normalized-mismatch` pending investigation. The 2021–2025 inventory
 * found zero mismatches across 14,668 team observations.
 */
function legacyNormalizedMismatches(team: RowRecord, side: 'home' | 'away'): string[] {
  const raw = asRecord(team.raw) ?? {};
  const mismatches: string[] = [];
  const expectValue = (field: string, rebuilt: number): void => {
    if (team[field] !== rebuilt) mismatches.push(`normalized-mismatch:${field}:${side}`);
  };

  const parsedOf = (category: string): ParsedStatValue | null => {
    const result = parseCategoryValue(category, raw[category]);
    return result.status === 'valid' ? result.value : null;
  };

  const totalYards = parsedOf('totalYards');
  if (totalYards?.kind === 'signed-yardage') expectValue('totalYards', totalYards.value);
  const rushingYards = parsedOf('rushingYards');
  if (rushingYards?.kind === 'signed-yardage') expectValue('rushingYards', rushingYards.value);
  const netPassing = parsedOf('netPassingYards');
  if (netPassing?.kind === 'signed-yardage') expectValue('passingYards', netPassing.value);
  const turnovers = parsedOf('turnovers');
  if (turnovers?.kind === 'count') expectValue('turnovers', turnovers.value);
  const thirdDown = parsedOf('thirdDownEff');
  if (thirdDown?.kind === 'efficiency') {
    expectValue('thirdDownConversions', thirdDown.made);
    expectValue('thirdDownAttempts', thirdDown.attempted);
  }
  const possession = parsedOf('possessionTime');
  if (possession?.kind === 'clock') expectValue('possessionSeconds', possession.seconds);

  return mismatches;
}

/**
 * Primary typed classifier for any stored or candidate game-stats row.
 *
 * Version interpretation (per game row, never per team or per partition):
 *   - own `schemaVersion` property absent → legacy;
 *   - exactly the number `2` → version 2;
 *   - a safe integer greater than 2 → `unsupported-version` (unknown future);
 *   - anything else present (strings, fractions, 0, 1, negatives, null) →
 *     `malformed-v2`.
 * A malformed or unsupported version NEVER falls back to legacy handling.
 */
export function classifyGameStatsRow(row: unknown): GameStatsRowClassification {
  const record = asRecord(row);
  if (!record) return { state: 'unaddressable', reasons: ['not-an-object'] };
  if (!isValidProviderGameId(record.providerGameId)) {
    return { state: 'unaddressable', reasons: ['invalid-provider-game-id'] };
  }

  const hasVersion = Object.prototype.hasOwnProperty.call(record, 'schemaVersion');
  const version = record.schemaVersion;
  if (hasVersion && version !== GAME_STATS_SCHEMA_VERSION) {
    if (typeof version === 'number' && Number.isSafeInteger(version) && version > 2) {
      return { state: 'unsupported-version', reasons: [`schema-version:${version}`] };
    }
    return { state: 'malformed-v2', reasons: ['malformed-schema-version'] };
  }

  const home = asRecord(record.home);
  const away = asRecord(record.away);
  if (!home || !away) {
    return { state: 'unusable-identity', reasons: ['missing-side'] };
  }

  const identityReasons: string[] = [];
  if (!hasNonblankSchool(home)) identityReasons.push('home:blank-school');
  if (!hasNonblankSchool(away)) identityReasons.push('away:blank-school');
  if (hasVersion) {
    // v2 rows are written by our own builder, so identity is held to the full
    // incoming-observation standard; legacy identity is bounded to the
    // inventory-validated nonblank-school rule (stored teamIds predate the
    // contract and are not re-litigated on read).
    if (!isValidProviderGameId(home.schoolId)) identityReasons.push('home:invalid-school-id');
    if (!isValidProviderGameId(away.schoolId)) identityReasons.push('away:invalid-school-id');
  }
  if (identityReasons.length > 0) {
    return { state: 'unusable-identity', reasons: identityReasons };
  }

  const homeContent = evaluateSideContent(home.raw);
  const awayContent = evaluateSideContent(away.raw);
  const homeUsable = homeContent.recognizedValid.size > 0;
  const awayUsable = awayContent.recognizedValid.size > 0;
  const totalEntries = homeContent.entryCount + awayContent.entryCount;

  if (!hasVersion) {
    if (totalEntries === 0) return { state: 'legacy-statless', reasons: ['no-raw-evidence'] };

    const reasons = [
      ...missingOrMalformedRequired(homeContent).map((c) => `home:required-not-valid:${c}`),
      ...missingOrMalformedRequired(awayContent).map((c) => `away:required-not-valid:${c}`),
    ];
    if (!isValidPointsValue(home.points)) reasons.push('home:stored-points-invalid');
    if (!isValidPointsValue(away.points)) reasons.push('away:stored-points-invalid');
    if (reasons.length > 0) return { state: 'legacy-malformed', reasons };

    const mismatches = [
      ...legacyNormalizedMismatches(home, 'home'),
      ...legacyNormalizedMismatches(away, 'away'),
    ];
    if (mismatches.length > 0) {
      return { state: 'legacy-normalized-mismatch', reasons: mismatches };
    }
    return { state: 'legacy-compatible', reasons: [] };
  }

  // Version-2 branch. Content states are ordered from least to most usable so
  // each row lands in exactly one deterministic bucket.
  if (totalEntries === 0) return { state: 'non-persistable-empty', reasons: ['no-raw-evidence'] };
  if (!homeUsable && !awayUsable) {
    if (homeContent.recognizedCount + awayContent.recognizedCount === 0) {
      return { state: 'non-persistable-unknown-only', reasons: ['no-recognized-categories'] };
    }
    return { state: 'non-persistable-malformed-only', reasons: ['no-valid-recognized-categories'] };
  }
  if (!homeUsable || !awayUsable) {
    return {
      state: 'non-persistable-one-sided',
      reasons: [homeUsable ? 'away:no-valid-categories' : 'home:no-valid-categories'],
    };
  }

  const sparseReasons = [
    ...missingOrMalformedRequired(homeContent).map((c) => `home:required-not-valid:${c}`),
    ...missingOrMalformedRequired(awayContent).map((c) => `away:required-not-valid:${c}`),
  ];
  if (home.pointsProvided !== true || !isValidPointsValue(home.points)) {
    sparseReasons.push('home:points-evidence-missing');
  }
  if (away.pointsProvided !== true || !isValidPointsValue(away.points)) {
    sparseReasons.push('away:points-evidence-missing');
  }
  if (sparseReasons.length > 0) return { state: 'v2-sparse', reasons: sparseReasons };
  return { state: 'v2-complete', reasons: [] };
}

// === Derived predicates ===

/** Whether a row-like value carries a provider-addressable game id. */
export function hasProviderAddressableGameId(row: unknown): boolean {
  const record = asRecord(row);
  return record !== null && isValidProviderGameId(record.providerGameId);
}

/** Strict v2 completeness — all six required categories AND structural points. */
export function isCompleteStatRow(row: unknown): boolean {
  return classifyGameStatsRow(row).state === 'v2-complete';
}

/**
 * Season-independent, clock-free analytics eligibility: a strictly complete v2
 * row, or a bounded legacy-compatible row (the explicit rollout exception —
 * legacy compatibility never establishes strict completeness).
 */
export function isAnalyticsEligible(row: unknown): boolean {
  const state = classifyGameStatsRow(row).state;
  return state === 'v2-complete' || state === 'legacy-compatible';
}

// === Incoming v2 observation parsing (dormant until PR 2/3) ===

export type ParsedV2TeamObservation = {
  school: string;
  schoolId: number;
  conference: string;
  homeAway: 'home' | 'away';
  /** True ONLY when the wire carried valid structural points for this side. */
  pointsProvided: boolean;
  points: number | null;
  /**
   * Immutable raw category evidence: string-valued entries only, duplicates
   * collapsed last-wins (matching the durable JSONB representation, where the
   * inventory confirmed duplicates cannot survive storage). Non-string stat
   * values are never coerced and therefore never appear here.
   */
  raw: Record<string, string>;
};

export type ParsedV2Observation = {
  providerGameId: number;
  home: ParsedV2TeamObservation;
  away: ParsedV2TeamObservation;
};

export type V2ObservationParseFailureReason =
  | 'not-an-object'
  | 'unaddressable-game-id'
  | 'invalid-teams-shape'
  | 'missing-home-side'
  | 'missing-away-side'
  | 'duplicate-home-side'
  | 'duplicate-away-side'
  | 'unusable-identity';

export type V2ObservationParseResult =
  | { ok: true; observation: ParsedV2Observation }
  | { ok: false; reason: V2ObservationParseFailureReason };

function parseTeamObservation(
  value: unknown,
  side: 'home' | 'away'
): ParsedV2TeamObservation | null {
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.team !== 'string' || record.team.trim().length === 0) return null;
  if (!isValidProviderGameId(record.teamId)) return null;

  const raw: Record<string, string> = {};
  if (Array.isArray(record.stats)) {
    for (const entry of record.stats) {
      const entryRecord = asRecord(entry);
      if (!entryRecord) continue;
      const { category, stat } = entryRecord;
      if (typeof category !== 'string' || category.length === 0) continue;
      if (typeof stat !== 'string') continue;
      raw[category] = stat;
    }
  }

  const pointsProvided = isValidPointsValue(record.points);
  return {
    school: record.team,
    schoolId: record.teamId as number,
    conference: typeof record.conference === 'string' ? record.conference : '',
    homeAway: side,
    pointsProvided,
    points: pointsProvided ? (record.points as number) : null,
    raw,
  };
}

/**
 * Parse one untrusted CFBD `/games/teams` game entry into a typed observation.
 * The interface REPRESENTS successfully parsed data — it never annotates
 * untrusted JSON. Sides are located by their `homeAway` designation: entries
 * with any other designation are ignored, and a missing or duplicated home or
 * away designation rejects the observation.
 */
export function parseV2GameObservation(input: unknown): V2ObservationParseResult {
  const record = asRecord(input);
  if (!record) return { ok: false, reason: 'not-an-object' };
  if (!isValidProviderGameId(record.id)) return { ok: false, reason: 'unaddressable-game-id' };
  if (!Array.isArray(record.teams)) return { ok: false, reason: 'invalid-teams-shape' };

  const homeCandidates = record.teams.filter((t) => asRecord(t)?.homeAway === 'home');
  const awayCandidates = record.teams.filter((t) => asRecord(t)?.homeAway === 'away');
  if (homeCandidates.length > 1) return { ok: false, reason: 'duplicate-home-side' };
  if (awayCandidates.length > 1) return { ok: false, reason: 'duplicate-away-side' };
  if (homeCandidates.length === 0) return { ok: false, reason: 'missing-home-side' };
  if (awayCandidates.length === 0) return { ok: false, reason: 'missing-away-side' };

  const home = parseTeamObservation(homeCandidates[0], 'home');
  const away = parseTeamObservation(awayCandidates[0], 'away');
  if (!home || !away) return { ok: false, reason: 'unusable-identity' };

  return { ok: true, observation: { providerGameId: record.id as number, home, away } };
}

/**
 * Whether a parsed observation earns durable persistence: identity is already
 * guaranteed by the parse, so this requires at least one recognized, strictly
 * parse-valid category INDEPENDENTLY on both sides. Points are NOT required
 * for sparse persistence. Empty, unknown-only, malformed-only, and one-sided
 * observations are not persistable.
 */
export function isPersistableIncomingRow(observation: ParsedV2Observation): boolean {
  return (
    evaluateSideContent(observation.home.raw).recognizedValid.size > 0 &&
    evaluateSideContent(observation.away.raw).recognizedValid.size > 0
  );
}

function strictCount(raw: Record<string, string>, category: string): number {
  const result = parseCategoryValue(category, raw[category]);
  if (result.status !== 'valid') return 0;
  const value = result.value;
  return value.kind === 'count' || value.kind === 'signed-yardage' ? value.value : 0;
}

function strictPair(raw: Record<string, string>, category: string): [number, number] {
  const result = parseCategoryValue(category, raw[category]);
  if (result.status !== 'valid') return [0, 0];
  const value = result.value;
  if (value.kind === 'efficiency') return [value.made, value.attempted];
  if (value.kind === 'count-yards') return [value.count, value.yards];
  return [0, 0];
}

function strictClockSeconds(raw: Record<string, string>, category: string): number {
  const result = parseCategoryValue(category, raw[category]);
  return result.status === 'valid' && result.value.kind === 'clock' ? result.value.seconds : 0;
}

function buildTeamStatsFromEvidence(team: ParsedV2TeamObservation): TeamGameStats {
  const raw = team.raw;
  const [thirdDownConversions, thirdDownAttempts] = strictPair(raw, 'thirdDownEff');
  const [fourthDownConversions, fourthDownAttempts] = strictPair(raw, 'fourthDownEff');
  const [penaltyCount, penaltyYards] = strictPair(raw, 'totalPenaltiesYards');

  // Public normalized fields retain zero fallbacks for absent/malformed values
  // (compatibility with every existing reader), but no contract decision ever
  // treats those fallbacks as observed facts — classification and projection
  // re-parse `raw`.
  return {
    school: team.school,
    schoolId: team.schoolId,
    conference: team.conference,
    homeAway: team.homeAway,
    points: team.pointsProvided ? (team.points as number) : 0,
    pointsProvided: team.pointsProvided,
    totalYards: strictCount(raw, 'totalYards'),
    rushingYards: strictCount(raw, 'rushingYards'),
    passingYards: strictCount(raw, 'netPassingYards'),
    rushingAttempts: strictCount(raw, 'rushingAttempts'),
    passingAttempts: strictCount(raw, 'passAttempts'),
    passingCompletions: strictCount(raw, 'passCompletions'),
    rushingTDs: strictCount(raw, 'rushingTDs'),
    passingTDs: strictCount(raw, 'passingTDs'),
    firstDowns: strictCount(raw, 'firstDowns'),
    turnovers: strictCount(raw, 'turnovers'),
    fumblesLost: strictCount(raw, 'fumblesLost'),
    interceptionsThrown: strictCount(raw, 'interceptions'),
    passesIntercepted: strictCount(raw, 'passesIntercepted'),
    fumblesRecovered: strictCount(raw, 'fumblesRecovered'),
    thirdDownAttempts,
    thirdDownConversions,
    thirdDownPct: thirdDownAttempts > 0 ? thirdDownConversions / thirdDownAttempts : 0,
    fourthDownAttempts,
    fourthDownConversions,
    penaltyCount,
    penaltyYards,
    possessionSeconds: strictClockSeconds(raw, 'possessionTime'),
    interceptionReturnYards: strictCount(raw, 'interceptionYards'),
    interceptionReturnTDs: strictCount(raw, 'interceptionTDs'),
    kickReturnYards: strictCount(raw, 'kickReturnYards'),
    kickReturnTDs: strictCount(raw, 'kickReturnTDs'),
    puntReturnYards: strictCount(raw, 'puntReturnYards'),
    puntReturnTDs: strictCount(raw, 'puntReturnTDs'),
    raw,
  };
}

/**
 * Pure v2 row constructor: builds a `schemaVersion: 2` game row from a
 * trustworthy parsed observation through the single strict normalization path.
 * NO production writer is connected to this in PLATFORM-086H1 — cron and manual
 * refresh continue to write legacy rows via `normalizers.ts` until PR 2/3
 * deliberately migrate them. Reads never stamp or rewrite legacy rows.
 */
export function buildV2GameStats(
  observation: ParsedV2Observation,
  week: number,
  seasonType: CfbdSeasonType
): GameStats {
  return {
    schemaVersion: GAME_STATS_SCHEMA_VERSION,
    providerGameId: observation.providerGameId,
    week,
    seasonType,
    home: buildTeamStatsFromEvidence(observation.home),
    away: buildTeamStatsFromEvidence(observation.away),
  };
}

// === Season-aware recovery policy (pure; not wired to cron in this PR) ===

export type SeasonRelation = 'current' | 'historical';

export type GameStatsRecoveryDisposition =
  | 'satisfied'
  | 'retry-current'
  | 'historical-covered'
  | 'manual-migration-only'
  | 'blocked-unsupported-schema';

export type GameStatsRowEvaluation = {
  classification: GameStatsRowClassification;
  disposition: GameStatsRecoveryDisposition;
  analyticsEligible: boolean;
};

/**
 * Season-aware recovery disposition for a stored row. Classification and
 * analytics eligibility remain season-independent; ONLY the disposition varies
 * with the explicitly passed season relation — no ambient date or season is
 * ever consulted. Legacy-compatible rows stay analytics-eligible while being
 * retried (current) or held as migration candidates (historical). Malformed and
 * unsupported schema versions are never auto-recovered: they represent a stamp
 * this code did not write, so they block pending manual investigation.
 */
export function evaluateGameStatsRow(
  row: unknown,
  context: { seasonRelation: SeasonRelation }
): GameStatsRowEvaluation {
  const classification = classifyGameStatsRow(row);
  const current = context.seasonRelation === 'current';

  let disposition: GameStatsRecoveryDisposition;
  switch (classification.state) {
    case 'v2-complete':
      disposition = 'satisfied';
      break;
    case 'legacy-compatible':
      disposition = current ? 'retry-current' : 'historical-covered';
      break;
    case 'unsupported-version':
    case 'malformed-v2':
      disposition = 'blocked-unsupported-schema';
      break;
    default:
      // Sparse v2, statless/malformed/mismatched legacy, and every
      // non-persistable defect: refetchable now, manual migration later.
      disposition = current ? 'retry-current' : 'manual-migration-only';
      break;
  }

  return {
    classification,
    disposition,
    analyticsEligible:
      classification.state === 'v2-complete' || classification.state === 'legacy-compatible',
  };
}

// === Canonical analytics projection ===

export type AnalyticsTeamStats = {
  school: string;
  points: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  turnovers: number;
  thirdDownConversions: number;
  thirdDownAttempts: number;
  possessionSeconds: number;
};

export type AnalyticsGameStats = {
  providerGameId: number;
  source: 'v2' | 'legacy';
  home: AnalyticsTeamStats;
  away: AnalyticsTeamStats;
};

function projectTeam(team: RowRecord): AnalyticsTeamStats | null {
  const raw = asRecord(team.raw) ?? {};
  const totalYards = parseCategoryValue('totalYards', raw.totalYards);
  const rushingYards = parseCategoryValue('rushingYards', raw.rushingYards);
  const netPassing = parseCategoryValue('netPassingYards', raw.netPassingYards);
  const turnovers = parseCategoryValue('turnovers', raw.turnovers);
  const thirdDown = parseCategoryValue('thirdDownEff', raw.thirdDownEff);
  const possession = parseCategoryValue('possessionTime', raw.possessionTime);
  if (
    totalYards.status !== 'valid' ||
    totalYards.value.kind !== 'signed-yardage' ||
    rushingYards.status !== 'valid' ||
    rushingYards.value.kind !== 'signed-yardage' ||
    netPassing.status !== 'valid' ||
    netPassing.value.kind !== 'signed-yardage' ||
    turnovers.status !== 'valid' ||
    turnovers.value.kind !== 'count' ||
    thirdDown.status !== 'valid' ||
    thirdDown.value.kind !== 'efficiency' ||
    possession.status !== 'valid' ||
    possession.value.kind !== 'clock' ||
    !isValidPointsValue(team.points) ||
    typeof team.school !== 'string'
  ) {
    return null;
  }
  return {
    school: team.school,
    points: team.points,
    totalYards: totalYards.value.value,
    rushingYards: rushingYards.value.value,
    passingYards: netPassing.value.value,
    turnovers: turnovers.value.value,
    thirdDownConversions: thirdDown.value.made,
    thirdDownAttempts: thirdDown.value.attempted,
    possessionSeconds: possession.value.seconds,
  };
}

/**
 * The ONLY sanctioned analytics view of a game-stats row. Eligible rows project
 * to strictly re-parsed raw evidence plus valid points — never to stored
 * normalized fallback values. Ineligible, malformed, sparse, unsupported, or
 * ambiguous rows project to `null`. Owner aggregation consumes this projection
 * exclusively, so it can never read an unsafe normalized field by accident.
 */
export function toAnalyticsGameStats(row: unknown): AnalyticsGameStats | null {
  const classification = classifyGameStatsRow(row);
  if (classification.state !== 'v2-complete' && classification.state !== 'legacy-compatible') {
    return null;
  }
  const record = asRecord(row)!;
  const home = projectTeam(asRecord(record.home)!);
  const away = projectTeam(asRecord(record.away)!);
  if (!home || !away) return null;
  return {
    providerGameId: record.providerGameId as number,
    source: classification.state === 'v2-complete' ? 'v2' : 'legacy',
    home,
    away,
  };
}

function analyticsTeamsEqual(a: AnalyticsTeamStats, b: AnalyticsTeamStats): boolean {
  return (
    a.school === b.school &&
    a.points === b.points &&
    a.totalYards === b.totalYards &&
    a.rushingYards === b.rushingYards &&
    a.passingYards === b.passingYards &&
    a.turnovers === b.turnovers &&
    a.thirdDownConversions === b.thirdDownConversions &&
    a.thirdDownAttempts === b.thirdDownAttempts &&
    a.possessionSeconds === b.possessionSeconds
  );
}

function analyticsProjectionsEqual(a: AnalyticsGameStats, b: AnalyticsGameStats): boolean {
  return analyticsTeamsEqual(a.home, b.home) && analyticsTeamsEqual(a.away, b.away);
}

export type AnalyticsRowConflict = {
  providerGameId: number;
  reason: 'conflicting-projections';
  candidateCount: number;
};

export type AnalyticsRowSelection = {
  selected: AnalyticsGameStats[];
  conflicts: AnalyticsRowConflict[];
};

/**
 * Deterministic duplicate-game selection over an aggregation scope: at most one
 * eligible projection per provider game id.
 *
 * Precedence: eligible v2 > eligible legacy > no eligible row. Within the
 * preferred class, structurally identical projections count once; conflicting
 * projections EXCLUDE the game (reported as a conflict) — array order never
 * decides, and a conflicted preferred class never falls back to the weaker one
 * (the conflict is evidence the data cannot be trusted either way). The
 * 2021–2025 inventory found zero duplicate game ids; this is defensive rollout
 * protection, not a live repair path.
 */
export function selectAnalyticsRows(rows: readonly unknown[]): AnalyticsRowSelection {
  const byGame = new Map<number, AnalyticsGameStats[]>();
  const order: number[] = [];
  for (const row of rows) {
    const projection = toAnalyticsGameStats(row);
    if (!projection) continue;
    const existing = byGame.get(projection.providerGameId);
    if (existing) existing.push(projection);
    else {
      byGame.set(projection.providerGameId, [projection]);
      order.push(projection.providerGameId);
    }
  }

  const selected: AnalyticsGameStats[] = [];
  const conflicts: AnalyticsRowConflict[] = [];
  for (const providerGameId of order) {
    const candidates = byGame.get(providerGameId)!;
    const v2Candidates = candidates.filter((c) => c.source === 'v2');
    const preferred = v2Candidates.length > 0 ? v2Candidates : candidates;
    const allIdentical = preferred.every((c) => analyticsProjectionsEqual(c, preferred[0]!));
    if (allIdentical) selected.push(preferred[0]!);
    else {
      conflicts.push({
        providerGameId,
        reason: 'conflicting-projections',
        candidateCount: preferred.length,
      });
    }
  }
  return { selected, conflicts };
}
