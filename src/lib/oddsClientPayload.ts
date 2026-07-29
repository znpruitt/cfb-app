import type { Dispatch, SetStateAction } from 'react';

import { buildOddsLookup, type CanonicalOddsItem, type CombinedOdds } from './odds.ts';
import { mergeFresherOddsUsage, type OddsUsageSnapshot } from './apiUsage.ts';

/** The `/api/odds` response shape the client decodes (public read or authorized refresh). */
export type OddsClientResponse = {
  items?: CanonicalOddsItem[];
  meta?: {
    usage?: OddsUsageSnapshot | null;
    snapshotCapturedAt?: string | null;
  };
};

export type OddsClientSetters = {
  setOddsByKey: Dispatch<SetStateAction<Record<string, CombinedOdds>>>;
  setOddsSnapshotAt: Dispatch<SetStateAction<string | null>>;
  setOddsUsage: Dispatch<SetStateAction<OddsUsageSnapshot | null>>;
};

/**
 * PLATFORM-086C3 remediation — the SINGLE place the client decodes an `/api/odds`
 * response (`{ items, meta }`) and applies it to shared Odds state. Both the
 * cache-only `useOddsHydration` and the `useLiveRefresh` authorized manual-refresh
 * seam route through here, so the two paths cannot drift on the response shape.
 *
 * `oddsByKey` and `snapshotCapturedAt` are the hydration's authoritative view and
 * replace directly; usage is merged FRESHNESS-AWARE (`mergeFresherOddsUsage`) so a
 * stale or null snapshot never clobbers a newer reading written by the concurrent
 * admin usage poll.
 */
export function applyOddsResponse(payload: OddsClientResponse, setters: OddsClientSetters): void {
  setters.setOddsByKey(buildOddsLookup(payload.items ?? []));
  setters.setOddsSnapshotAt(payload.meta?.snapshotCapturedAt ?? null);
  setters.setOddsUsage((prev) => mergeFresherOddsUsage(prev, payload.meta?.usage ?? null));
}
