import Link from 'next/link';

import AppHeaderActions from '@/components/menu/AppHeaderActions';

/**
 * PLATFORM-088 — the public entry page. A SERVER component, deliberately.
 *
 * This was previously the signed-out half of a `'use client'` component branched
 * by Clerk's `<Show>`. Three consequences, all closed by rendering it here:
 *
 *  1. With JavaScript disabled the page was COMPLETELY BLANK. `<Show>` decides in
 *     the browser, so no landing markup existed in the server HTML at all. A slow
 *     or failed Clerk script produced the same blank page.
 *  2. The branch ran after the server had already loaded every league and owner
 *     count and serialized them as props, so anonymous visitors received the whole
 *     league directory in the RSC payload. `<Show>` hid it; it did not withhold it.
 *  3. Signed-in non-admins fell into the dashboard half.
 *
 * Nothing here reads the registry, so this page cannot be broken by a storage
 * fault — a visitor who has never heard of the league registry should not depend
 * on it being readable.
 *
 * Entry contract (owner decision, 2026-08-08, recorded in `docs/vision.md`):
 * members arrive through a link their commissioner sends them. No slug input, no
 * public directory, no signup. So this page explains what Turf War is and points
 * invited members at their link — it is NOT a marketing site.
 *
 * `isSignedIn` exists because a signed-in NON-admin lands here too, and the first
 * version of this page TRAPPED them: its only control was a link to `/login`,
 * which redirects to `/admin`, which middleware bounces back to here — a closed
 * loop with no sign-out and no explanation. They previously reached the dashboard
 * and its account menu, so removing that was a regression this slice introduced.
 * They still see no league data; they gain an exit and a reason.
 */
export default function PublicLanding({ isSignedIn = false }: { isSignedIn?: boolean }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 py-16 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* TYPOGRAPHY, NOT DECORATION.

          The page read as flat because every block sat at a similar weight with
          uniform spacing between them — not because it lacked colour. DESIGN.md
          reserves amber for champion signals and blue for interactivity, and
          states plainly that no colour is decorative, so an accent here would
          encode nothing and would promise a livelier product than the austere,
          data-dense app behind this page.

          What creates hierarchy instead: a real scale jump to the wordmark, a
          tracked micro-caps line as a second register, a constrained measure so
          body copy holds ~55 characters, and deliberate rather than uniform
          vertical rhythm — tight within a group, generous between groups. */}
      <div className="w-full max-w-lg text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Turf War</h1>
        <p className="mt-3 text-xs font-semibold tracking-[0.18em] text-gray-600 uppercase dark:text-zinc-400">
          College football pools
        </p>

        <p className="mx-auto mt-8 max-w-sm text-base leading-relaxed text-gray-600 dark:text-zinc-300">
          Draft college teams, then follow the season together — weekly matchups, live scores,
          standings, and season history in one place.
        </p>

        {/* The entry instruction. Members do not look their league up; they open
            the link they were sent. Previously this read "Enter your league URL"
            above a static code sample with no input to type into — an instruction
            the page could not fulfil. */}
        <div className="mt-10 rounded-lg border border-gray-300 bg-gray-50 px-5 py-4 text-left dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm leading-relaxed text-gray-700 dark:text-zinc-300">
            <span className="font-semibold">Already in a league?</span> Open the link your
            commissioner shared with you to go straight to it.
          </p>
        </div>

        {/* In normal flow rather than fixed to the corner: at a 390px viewport the
            fixed positioning clipped this off the edge. A hairline rule separates
            the account affordance from the member-facing content above it — a
            structural boundary rather than an ornament. */}
        <div className="mt-10 border-t border-gray-200 pt-6 dark:border-zinc-800">
          {isSignedIn ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-zinc-400">
                You&apos;re signed in, but this account doesn&apos;t have platform admin access.
              </p>
              {/* The account menu already distinguishes signed-in from signed-out
                  itself and offers Manage account / Sign out. Reused rather than
                  rebuilt so there is one sign-out path in the app. */}
              <div className="flex justify-center">
                <AppHeaderActions isAdmin={false} />
              </div>
            </div>
          ) : (
            <Link
              href="/login"
              className="text-sm text-gray-600 underline-offset-2 transition-colors hover:text-gray-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Platform admin sign-in
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
