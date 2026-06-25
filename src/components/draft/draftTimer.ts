import type { DraftState } from '@/lib/draft';

/**
 * Seconds remaining on the pick clock, or null when no countdown should show.
 *
 * Optimistic (display-only) path: when `localStart` is set — a pick POST is in
 * flight — count down from `pickTimerSeconds` starting at the click instant so the
 * clock moves immediately, before the server round-trip completes.
 *
 * Server-authoritative path: otherwise count down to `timerExpiresAt` while the
 * timer is running.
 *
 * Both paths clamp to `pickTimerSeconds` so client/server clock skew can never
 * render a value above the configured maximum, and floor at 0.
 */
export function computeTimerSecondsLeft(
  now: number,
  pickTimerSeconds: number | null,
  localStart: number | null,
  timerState: DraftState['timerState'],
  timerExpiresAt: string | null
): number | null {
  if (!pickTimerSeconds) return null;

  if (localStart != null) {
    const remaining = Math.max(0, pickTimerSeconds * 1000 - (now - localStart));
    return Math.min(pickTimerSeconds, Math.ceil(remaining / 1000));
  }

  if (timerState !== 'running' || !timerExpiresAt) return null;
  const remaining = Math.max(0, new Date(timerExpiresAt).getTime() - now);
  return Math.min(pickTimerSeconds, Math.ceil(remaining / 1000));
}
