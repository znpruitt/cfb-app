/**
 * Shared provider-quota model (PLATFORM-086A-ADMIN-TRUTHFULNESS-HOTFIX).
 *
 * ONE canonical CFBD patron-tier → monthly-limit map and ONE normalization /
 * reconciliation function, consumed by BOTH the Provider Data Status panel and
 * the legacy API Usage panel (and the /api/admin/usage route that feeds them).
 * Keeping the tier map and reconciliation in a single import-safe (client +
 * server) module is what guarantees the two surfaces can never disagree on
 * used/remaining/limit or render an impossible combination such as
 * "5,000 remaining of 3,000".
 *
 * This module must stay free of server-only imports (no `process.env`, no
 * `fetch`) so it is safe to import from client components.
 */

/**
 * CFBD Patreon patron-tier → monthly call allowance. This is the single source
 * of truth for the CFBD quota ceiling; `resolveCfbdUsage` and every quota
 * display derive their limit from here.
 *
 * Tier 1 is 5,000 monthly calls (corrected from a stale 3,000 that produced an
 * impossible "0 used / 5,000 remaining / 3,000 limit" display). Unknown tiers
 * fall back to Tier 0 and should be reviewed when CFBD adds new tiers.
 */
export const CFBD_LIMIT_BY_TIER: Record<number, number> = {
  0: 1000,
  1: 5000,
  2: 30000,
  3: 75000,
  4: 125000,
  5: 200000,
  6: 500000,
};

/** The canonical monthly limit for a CFBD patron tier (Tier 0 fallback for unknown tiers). */
export function cfbdCanonicalLimitForTier(patronLevel: number): number {
  return CFBD_LIMIT_BY_TIER[patronLevel] ?? CFBD_LIMIT_BY_TIER[0];
}

export type NormalizedProviderQuota = {
  /** Reconciled call count used this period, or null if not trustworthy. */
  used: number | null;
  /** Reconciled calls remaining this period, or null if not trustworthy. */
  remaining: number | null;
  /** Reconciled monthly limit, or null if it cannot be trusted at all. */
  limit: number | null;
  /**
   * Whether the RAW provider observation was internally self-consistent
   * (all three present and used + remaining === limit). When false, the
   * normalized fields above were derived/reconciled and the UI should surface
   * the raw values as diagnostic detail rather than as authoritative.
   */
  consistent: boolean;
  /** Human provenance, e.g. "live provider observation". */
  source: string | null;
  /** ISO timestamp of the observation, when known. */
  observedAt: string | null;
  /** The raw provider fields, retained for diagnostic detail. */
  raw?: {
    used?: number | null;
    remaining?: number | null;
    limit?: number | null;
    patronLevel?: number | null;
  };
};

function nonNegInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Normalize and reconcile a raw provider quota observation into a single
 * trustworthy summary (PLATFORM-086A hotfix requirements 2 + 3).
 *
 * Authority rules, in order:
 *   1. A self-consistent explicit triple (used + remaining === limit) is used as-is.
 *   2. Otherwise a single missing value is derived from two present, nonnegative,
 *      unambiguous values (limit = used + remaining, etc.).
 *   3. Otherwise, if a canonical (patron-tier) limit is available and the raw
 *      provider `remaining` is trustworthy against it (0 ≤ remaining ≤ limit),
 *      the summary uses the canonical limit and derives used = limit − remaining.
 *      `remaining` is CFBD's real provider signal; `used` is derived upstream, so
 *      it is never fabricated back into `remaining` when the two conflict.
 *   4. Otherwise, if a canonical limit exists but no trustworthy usage does
 *      (e.g. remaining exceeds the limit), report the limit with null usage.
 *   5. Otherwise report everything as unavailable.
 *
 * `consistent` reflects whether the RAW observation was self-consistent, so the
 * caller can honestly flag reconciled/derived values.
 */
export function normalizeProviderQuota(input: {
  used?: number | null;
  remaining?: number | null;
  limit?: number | null;
  patronLevel?: number | null;
  canonicalLimit?: number | null;
  source?: string | null;
  observedAt?: string | null;
}): NormalizedProviderQuota {
  const source = input.source ?? null;
  const observedAt = input.observedAt ?? null;
  const raw = {
    used: input.used ?? null,
    remaining: input.remaining ?? null,
    limit: input.limit ?? null,
    patronLevel: input.patronLevel ?? null,
  };

  const rawUsed = nonNegInt(input.used);
  const rawRemaining = nonNegInt(input.remaining);
  const rawLimit = nonNegInt(input.limit);
  const canonical = nonNegInt(input.canonicalLimit);

  const done = (
    used: number | null,
    remaining: number | null,
    limit: number | null,
    consistent: boolean
  ): NormalizedProviderQuota => ({ used, remaining, limit, consistent, source, observedAt, raw });

  // 1. Self-consistent explicit provider triple → use it verbatim.
  const rawConsistent =
    rawUsed !== null &&
    rawRemaining !== null &&
    rawLimit !== null &&
    rawUsed + rawRemaining === rawLimit;
  if (rawConsistent) {
    return done(rawUsed, rawRemaining, rawLimit, true);
  }

  // 2. Derive a single missing value from two present, unambiguous values.
  let used = rawUsed;
  let remaining = rawRemaining;
  let limit = rawLimit;
  if (limit === null && used !== null && remaining !== null) {
    limit = used + remaining;
  } else if (used === null && limit !== null && remaining !== null && remaining <= limit) {
    used = limit - remaining;
  } else if (remaining === null && limit !== null && used !== null && used <= limit) {
    remaining = limit - used;
  }
  if (used !== null && remaining !== null && limit !== null && used + remaining === limit) {
    // Internally consistent, but the RAW observation was incomplete → consistent:false.
    return done(used, remaining, limit, false);
  }

  // 3. Reconcile against the canonical tier limit using the trustworthy `remaining`.
  if (canonical !== null && rawRemaining !== null && rawRemaining <= canonical) {
    return done(canonical - rawRemaining, rawRemaining, canonical, false);
  }

  // 4. Canonical limit is known, but usage is not trustworthy (e.g. remaining > limit).
  if (canonical !== null) {
    return done(null, null, canonical, false);
  }

  // 5. Nothing trustworthy → quota status unavailable.
  return done(null, null, null, false);
}

export type QuotaSummaryDisplay = {
  /** True when at least a trustworthy limit exists to show. */
  available: boolean;
  /** Authoritative one-line summary (identical wording across both panels). */
  text: string;
  /** Whether the raw provider observation was inconsistent/reconciled. */
  inconsistent: boolean;
  /** Optional secondary note describing the raw conflict, when inconsistent. */
  detail: string | null;
};

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function rawDetail(raw: NormalizedProviderQuota['raw']): string | null {
  if (!raw) return null;
  const parts: string[] = [];
  if (raw.used != null) parts.push(`used ${raw.used}`);
  if (raw.remaining != null) parts.push(`remaining ${raw.remaining}`);
  if (raw.limit != null) parts.push(`limit ${raw.limit}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Build the authoritative one-line quota summary shared by both quota surfaces
 * (requirement 4: they must agree on used/remaining/limit/consistency). The
 * exact layout is up to each panel, but the numbers and wording come from here.
 */
export function formatQuotaSummary(quota: NormalizedProviderQuota): QuotaSummaryDisplay {
  if (quota.limit == null) {
    return {
      available: false,
      text: 'quota status unavailable — provider values are inconsistent',
      inconsistent: true,
      detail: rawDetail(quota.raw),
    };
  }
  if (quota.used != null && quota.remaining != null) {
    return {
      available: true,
      text: `${fmt(quota.used)} / ${fmt(quota.limit)} used · ${fmt(quota.remaining)} remaining`,
      inconsistent: !quota.consistent,
      detail: quota.consistent ? null : rawDetail(quota.raw),
    };
  }
  // Limit known, usage not trustworthy.
  return {
    available: true,
    text: `limit ${fmt(quota.limit)} · usage unavailable (provider values inconsistent)`,
    inconsistent: true,
    detail: rawDetail(quota.raw),
  };
}
