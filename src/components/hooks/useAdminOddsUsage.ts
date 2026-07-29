import { useEffect, type Dispatch, type SetStateAction } from 'react';

import {
  fetchLatestOddsUsageSnapshot,
  mergeFresherOddsUsage,
  type OddsUsageSnapshot,
} from '../../lib/apiUsage';

/**
 * Hydrate odds API-usage diagnostics for admins only.
 *
 * Odds usage is admin-only state — the `/api/admin/odds-usage` route requires
 * admin auth (PLATFORM-020) — so non-admin views must never fetch it. The
 * server-side quota guard in `/api/odds` protects upstream quota for public
 * callers, so non-admins do not need this snapshot. When `isAdmin` is false the
 * effect is a no-op and performs no network request.
 *
 * The admin snapshot and the cache-only `useOddsHydration` read both write the
 * shared `oddsUsage` state; the write here is FRESHNESS-AWARE (`mergeFresherOddsUsage`)
 * so whichever resolves last, the newest reading by `capturedAt` wins and a staler
 * public-cache snapshot never clobbers this durable admin reading (PLATFORM-086C3).
 */
export function useAdminOddsUsage(
  isAdmin: boolean,
  setOddsUsage: Dispatch<SetStateAction<OddsUsageSnapshot | null>>
): void {
  useEffect(() => {
    if (!isAdmin) return;
    void fetchLatestOddsUsageSnapshot()
      .then((snapshot) => {
        setOddsUsage((prev) => mergeFresherOddsUsage(prev, snapshot));
      })
      .catch(() => {
        // non-fatal diagnostics fetch
      });
  }, [isAdmin, setOddsUsage]);
}
