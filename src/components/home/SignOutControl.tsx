'use client';

import { useClerk } from '@clerk/nextjs';

/**
 * PLATFORM-088 — the exit for a signed-in non-admin on the public landing.
 *
 * Deliberately NOT `AppHeaderActions`, which was the first attempt. That
 * component re-derives auth in the browser (`isLoaded && isSignedIn`), so before
 * Clerk hydrates it offered "Sign in" — pointing at `/login`, which sends an
 * already-signed-in user to `/`, reopening the very loop this was meant to close.
 * Anyone on a slow connection who clicked promptly hit it.
 *
 * This component decides NOTHING. Whether it appears at all is settled on the
 * server by `resolveSessionFacts()` and passed down, so the affordance is correct
 * from first paint and cannot change under the user as scripts load. All it owns
 * is the click.
 *
 * The `signOut` call itself does require JavaScript — Clerk offers no server-side
 * session teardown reachable from a plain form post. That is not a regression and
 * not a gap in the no-JavaScript rule: Clerk's SIGN-IN is likewise a client
 * component, so no session can exist without JavaScript having run. The landing's
 * CONTENT renders server-side either way, which is the property that rule
 * protects. `DESIGN.md` states this distinction explicitly.
 */
export default function SignOutControl() {
  const clerk = useClerk();

  return (
    <button
      type="button"
      onClick={() => void clerk.signOut({ redirectUrl: '/' })}
      className="text-sm text-gray-600 underline-offset-2 transition-colors hover:text-gray-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      Sign out
    </button>
  );
}
