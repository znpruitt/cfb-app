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
 * `null` means the page renders normally.
 *
 * An earlier version let a league through when a draft already existed, so it
 * would not be "locked out of its own setup". That exception escaped nothing:
 * the page rendered and then every write it made was refused, because a draft
 * with no confirmed roster cannot be saved or started either. A page that looks
 * usable and is not is worse than an honest refusal — and this refusal names a
 * step that works, after which the draft reconciles itself.
 */
export function resolveDraftSetupGate(input: {
  isConfirmed: boolean;
  isPreseason: boolean;
  slug: string;
  year: number;
}): DraftSetupGate | null {
  const { isConfirmed, isPreseason, slug, year } = input;
  if (isConfirmed) return null;

  // The remedy has to match the lifecycle. `/admin/[slug]/preseason/owners`
  // redirects to the admin home unless the league is in PRESEASON, and this page
  // is not lifecycle-gated — it derives a year for season and offseason leagues
  // too, and every league created through the admin API is born `season`.
  // Linking there unconditionally bounces those leagues with no explanation.
  return isPreseason
    ? { href: `/admin/${slug}/preseason/owners`, cta: `Confirm ${year} owners` }
    : { href: `/admin/${slug}/roster`, cta: `Upload the ${year} roster` };
}
