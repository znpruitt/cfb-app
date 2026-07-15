import { cfbdCanonicalLimitForTier } from './providerQuota.ts';

type CfbdInfoResponse = {
  patronLevel?: unknown;
  remainingCalls?: unknown;
};

/**
 * Raw-but-validated CFBD usage observation (PLATFORM-086G1, deferred finding
 * #7). Every field is `null` when the provider did not supply a usable value —
 * missing, null, nonnumeric, non-finite, or negative fields are UNAVAILABLE,
 * never coerced to an authoritative number. In particular a missing
 * `remainingCalls` is never reported as 0 remaining (which downstream reads as
 * quota exhaustion). Reconciliation/display authority stays with
 * `normalizeProviderQuota` — this module only refuses to fabricate inputs.
 */
export type CfbdUsage = {
  patronLevel: number | null;
  used: number | null;
  remaining: number | null;
  limit: number | null;
};

function usableNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A usable patron tier is a non-negative integer; anything else is unknown. */
function usablePatronLevel(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function resolveCfbdUsage(data: CfbdInfoResponse): CfbdUsage {
  const patronLevel = usablePatronLevel(data.patronLevel);
  const remaining = usableNonNegativeNumber(data.remainingCalls);

  // The canonical tier→limit map is the single source of truth (unknown
  // INTEGER tiers fall back to Tier 0 per the existing canonical contract).
  // Tier 1 is 5,000 monthly calls. An unusable patronLevel yields NO limit —
  // never a guessed ceiling.
  const limit = patronLevel !== null ? cfbdCanonicalLimitForTier(patronLevel) : null;

  // `used` is derived, not provider-supplied: only trustworthy when both the
  // canonical limit and a plausible `remaining` (≤ limit) exist. A trustworthy
  // remaining of 0 still derives used === limit — genuine exhaustion is
  // preserved; only fabricated exhaustion is removed.
  const used =
    limit !== null && remaining !== null && remaining <= limit ? limit - remaining : null;

  return {
    patronLevel,
    used,
    remaining,
    limit,
  };
}

export async function fetchCfbdUsage(): Promise<CfbdUsage> {
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    throw new Error('CFBD_API_KEY missing');
  }

  const res = await fetch('https://api.collegefootballdata.com/info', {
    headers: {
      Authorization: `Bearer ${cfbdApiKey}`,
      Accept: 'application/json',
    },
    next: { revalidate: 600 },
  });

  if (!res.ok) {
    throw new Error(`CFBD usage fetch failed: ${res.status}`);
  }

  // A 200 with a non-object body is a MALFORMED payload, not a read failure:
  // resolve it to all-unavailable rather than throwing, keeping "unavailable"
  // distinct from the thrown provider-read-failure path above.
  const parsed: unknown = await res.json();
  const data: CfbdInfoResponse =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CfbdInfoResponse)
      : {};
  return resolveCfbdUsage(data);
}
