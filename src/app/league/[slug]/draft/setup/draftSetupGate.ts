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
 * `hasDraft` short-circuits because the create gate is creation-only: a league
 * that already reached a draft keeps working on it rather than being locked out
 * of its own setup. There are no such leagues today, but the alternative — a page
 * that can strand a draft it cannot fix — is the failure mode worth designing
 * out rather than relying on the population staying empty.
 */
export function resolveDraftSetupGate(input: {
  isConfirmed: boolean;
  hasDraft: boolean;
  isPreseason: boolean;
  slug: string;
  year: number;
}): DraftSetupGate | null {
  const { isConfirmed, hasDraft, isPreseason, slug, year } = input;
  if (isConfirmed || hasDraft) return null;

  // The remedy has to match the lifecycle. `/admin/[slug]/preseason/owners`
  // redirects to the admin home unless the league is in PRESEASON, and this page
  // is not lifecycle-gated — it derives a year for season and offseason leagues
  // too, and every league created through the admin API is born `season`.
  // Linking there unconditionally bounces those leagues with no explanation.
  return isPreseason
    ? { href: `/admin/${slug}/preseason/owners`, cta: `Confirm ${year} owners` }
    : { href: `/admin/${slug}/roster`, cta: `Upload the ${year} roster` };
}
