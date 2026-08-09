import { SignIn } from '@clerk/nextjs';

import Wordmark from '@/components/brand/Wordmark';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
      <div className="mb-8 text-center">
        {/* The brand IS the heading here — this page has no other content — so it
            takes the wordmark rather than a plain label. Interior scale: the
            treatment is em-based, so `text-2xl` gets the same optical
            relationship as the landing's clamp with no second set of values.
            `font-bold` dropped: the shared treatment sets weight 800. */}
        <h1 className="text-2xl text-zinc-100">
          <Wordmark />
        </h1>
        <p className="mt-1 text-sm text-zinc-400">Commissioner access</p>
      </div>
      {/* PLATFORM-088 — redirect to `/`, not `/admin`. A non-admin sent to
          `/admin` is bounced back by middleware, which was half of a sign-in
          loop. `/` now shows the admin dashboard to platform admins and the
          public landing to everyone else, so it is correct for both. */}
      <SignIn routing="path" path="/login" forceRedirectUrl="/" />
    </main>
  );
}
