import type { DraftPhase } from '@/lib/draft';

/**
 * PLATFORM-092 — what the draft-setup page shows when there is no confirmed
 * roster, and where it sends the commissioner to fix that.
 *
 * Extracted from the page because the page cannot be rendered under the test
 * runner: it is gated by `canAccessDraftBoard` → `isPlatformAdminSession`, which
 * has no authorizing path without a Request, so an RSC render only ever produces
 * `NEXT_REDIRECT`. Testing this branch through the render would test nothing.
 */
export type DraftSetupGate = {
  /** Where the commissioner goes to establish a roster. */
  href: string;
  /** The call-to-action label for that destination. */
  cta: string;
};

/**
 * Draft phases in which nothing has happened yet, so blocking the page costs the
 * commissioner nothing they could have used.
 *
 * `null` is "no draft record at all".
 */
const PRE_START_PHASES: ReadonlySet<DraftPhase> = new Set<DraftPhase>([
  'setup',
  'settings',
  'preview',
]);

/**
 * `null` means the page renders normally.
 *
 * This has been wrong in BOTH directions, so the reasoning is worth keeping.
 * The first version let a league through whenever a draft existed, which escaped
 * nothing — every write that page made was still refused. Removing the exception
 * outright then blocked running drafts too, and this page carries the ONLY Reset
 * Draft button and pick-timer control in the app (`DraftControls` has no
 * importers, and the board links here from four places). That justification —
 * "every write is refused anyway" — was checked for pre-start drafts only: a
 * settings-only save and the reset route carry neither `owners` nor `phase`, so
 * they pass the gates untouched.
 *
 * The deciding fact is the draft's PHASE, not its existence. Blocking a draft
 * that has not started costs nothing; blocking one that is running takes away
 * the only way to reset it — which, on the demo league, is exactly what its
 * year-clearing control leaves you needing.
 */
export function resolveDraftSetupGate(input: {
  isConfirmed: boolean;
  draftPhase: DraftPhase | null;
  isPreseason: boolean;
  slug: string;
  year: number;
}): DraftSetupGate | null {
  const { isConfirmed, draftPhase, isPreseason, slug, year } = input;
  if (isConfirmed) return null;
  if (draftPhase !== null && !PRE_START_PHASES.has(draftPhase)) return null;

  // The remedy has to match the lifecycle. `/admin/[slug]/preseason/owners`
  // redirects to the admin home unless the league is in PRESEASON, and this page
  // is not lifecycle-gated — it derives a year for season and offseason leagues
  // too, and every league created through the admin API is born `season`.
  // Linking there unconditionally bounces those leagues with no explanation.
  return isPreseason
    ? { href: `/admin/${slug}/preseason/owners`, cta: `Confirm ${year} owners` }
    : { href: `/admin/${slug}/roster`, cta: `Upload the ${year} roster` };
}
