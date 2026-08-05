import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { isPlatformAdminClaims, requiresPlatformAdminPage } from '@/lib/auth/platformAdmin';

export default clerkMiddleware(async (auth, req) => {
  // Platform-admin-only browser page families (/admin/*, /debug/*). Fails closed:
  // signed-out → /login, signed-in non-admin → /. API routes (incl. /api/debug/*)
  // are gated at the route boundary by requireAdminAuth (which also honors the
  // ADMIN_API_TOKEN fallback middleware can't express), so they are not matched here.
  if (requiresPlatformAdminPage(req.nextUrl.pathname)) {
    const { userId, sessionClaims } = await auth();

    if (!userId) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    if (!isPlatformAdminClaims(sessionClaims)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  }
});

export const config = {
  matcher: [
    // PLATFORM-086F2H1SA — match the protected page families EXPLICITLY. Entries
    // are OR'd, so position in this array carries no meaning; what matters is
    // that these entries exist at all.
    //
    // Keep them in sync with `PLATFORM_ADMIN_PAGE_PREFIXES` in
    // `src/lib/auth/platformAdmin.ts` — a prefix added there without a matcher
    // entry here reopens the bypass below. A test asserts the two agree; the
    // literals cannot be derived, because Next requires this matcher to be
    // statically analyzable.
    '/admin/:path*',
    '/debug/:path*',
    // Skip Next.js internals and genuine static files.
    //
    // The `$` is load-bearing. Without it this is a SUBSTRING rule rather than a
    // suffix rule: any path merely CONTAINING one of these extensions was
    // skipped, so `/admin/audit.css` bypassed middleware entirely while still
    // resolving to `app/admin/[slug]/page` — a worker where every Server Action
    // is registered. Anchoring alone would NOT have fixed that case (the path
    // genuinely ends in `.css`), which is why the explicit prefixes above are the
    // actual fix; the anchor additionally closes the `/foo/bar.css/baz` shape for
    // any future middleware responsibility.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)$).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
