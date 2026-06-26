import { useEffect } from 'react';

import { fetchLatestOddsUsageSnapshot, type OddsUsageSnapshot } from '../../lib/apiUsage';

/**
 * Hydrate odds API-usage diagnostics for admins only.
 *
 * Odds usage is admin-only state — the `/api/admin/odds-usage` route requires
 * admin auth (PLATFORM-020) — so non-admin views must never fetch it. The
 * server-side quota guard in `/api/odds` protects upstream quota for public
 * callers, so non-admins do not need this snapshot. When `isAdmin` is false the
 * effect is a no-op and performs no network request.
 */
export function useAdminOddsUsage(
  isAdmin: boolean,
  setOddsUsage: (snapshot: OddsUsageSnapshot | null) => void
): void {
  useEffect(() => {
    if (!isAdmin) return;
    void fetchLatestOddsUsageSnapshot()
      .then((snapshot) => {
        setOddsUsage(snapshot);
      })
      .catch(() => {
        // non-fatal diagnostics fetch
      });
  }, [isAdmin, setOddsUsage]);
}
