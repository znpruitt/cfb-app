'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-5xl font-bold text-gray-300 dark:text-zinc-700">!</p>
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          An unexpected error occurred. You can try again or go back to the home page.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 transition-colors hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 transition-colors hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
