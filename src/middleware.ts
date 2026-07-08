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
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
