import Link from 'next/link';

import SignOutControl from '@/components/home/SignOutControl';
import { PerspectiveField, WordmarkFieldUnderline } from '@/components/home/LandingFieldArt';

/**
 * The public entry page. A SERVER component, deliberately.
 *
 * PLATFORM-088 established this and POLISH-004 must not regress it. It was once
 * the signed-out half of a `'use client'` component branched by Clerk's `<Show>`,
 * with three consequences:
 *
 *  1. With JavaScript disabled the page was COMPLETELY BLANK. `<Show>` decides in
 *     the browser, so no landing markup existed in the server HTML at all.
 *  2. The branch ran after the server had already loaded every league and owner
 *     count and serialized them as props, so anonymous visitors received the whole
 *     league directory in the RSC payload. `<Show>` hid it; it did not withhold it.
 *  3. Signed-in non-admins fell into the dashboard half.
 *
 * Nothing here reads the registry, so this page cannot be broken by a storage
 * fault — a visitor who has never heard of the league registry should not depend
 * on it being readable.
 *
 * Entry contract (owner decision, recorded in `docs/vision.md`): members arrive
 * through a link their commissioner sends them. No slug input, no public
 * directory, no signup.
 *
 * `isSignedIn` exists because a signed-in NON-admin lands here too, and an early
 * version TRAPPED them: its only control linked to `/login`, which redirects to
 * `/admin`, which middleware bounces back here. The exit is server-DECIDED — a
 * later attempt used a control that re-derived auth in the browser, which
 * rendered "Sign in" until Clerk hydrated and reopened that loop on any slow
 * connection. Passing the fact down is what closes it.
 *
 * POLISH-004 changed the PRESENTATION only: an always-dark stadium composition,
 * the wordmark treatment, and two decorative field SVGs. No auth, routing,
 * registry, or entry behaviour moved.
 */
export default function PublicLanding({ isSignedIn = false }: { isSignedIn?: boolean } = {}) {
  return (
    <main className="landing-root flex flex-col items-center justify-center px-6 py-16">
      {/* Decoration. Behind the content, inert, and carrying no meaning: every
          string on this page is real DOM text below. */}
      <div className="landing-glow" aria-hidden="true" />
      <PerspectiveField className="landing-field" />

      <div className="landing-content w-full max-w-xl text-center">
        {/*
          The visible wordmark is the stylised one-word `TurfWar`, matching the
          reference. The accessible name is the real product name, so a screen
          reader announces "Turf War" rather than an unfamiliar compound. This is
          a landing treatment only — metadata and every other surface keep the
          spaced form.
        */}
        <p className="landing-wordmark">
          <span aria-hidden="true">TurfWar</span>
          <span className="sr-only">Turf War</span>
        </p>
        <WordmarkFieldUnderline className="landing-wordmark-field" />

        <p className="landing-descriptor mt-5 uppercase">College football pools</p>

        {/* The PRODUCT STATEMENT is the page heading — not the wordmark, which is
            branding rather than a description of the page. */}
        <h1 className="landing-headline mt-8">Draft college football teams. Compete all season.</h1>

        <p className="landing-lede mx-auto mt-5 max-w-md">
          Draft your teams, go head-to-head each week, and follow live scores, standings, and league
          history in one place.
        </p>

        {/* The entry instruction. Members do not look their league up; they open
            the link they were sent. This once read "Enter your league URL" above a
            static code sample with no input to type into — an instruction the page
            could not fulfil. */}
        <div className="landing-guidance mt-10 px-5 py-4 text-left">
          <p className="text-sm leading-relaxed text-zinc-300">
            <span className="font-semibold text-zinc-100">Already in a league?</span> Open the link
            your commissioner shared with you to go straight to it.
          </p>
        </div>

        <div className="landing-account mt-10 pt-6">
          {isSignedIn ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">
                You&apos;re signed in, but this account doesn&apos;t have platform admin access.
              </p>
              {/* A control that decides nothing. Whether it appears is settled on
                  the server, so it is correct from first paint. */}
              <SignOutControl />
            </div>
          ) : (
            <Link
              href="/login"
              className="text-sm text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-100 hover:underline"
            >
              Platform admin sign-in
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
