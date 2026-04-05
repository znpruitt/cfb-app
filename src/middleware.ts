import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isAdminRoute = createRouteMatcher(['/admin(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    let role: unknown;
    try {
      const user = await currentUser();
      role = (user?.publicMetadata as Record<string, unknown>)?.role;
    } catch (err) {
      console.error('Middleware: currentUser() failed for /admin route', err);
      return NextResponse.redirect(new URL('/', req.url));
    }
    if (role !== 'platform_admin') {
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
