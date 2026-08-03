'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * PLATFORM-086F2G — rebuilds the server view model via `router.refresh()`. There
 * is NO automatic whole-page polling loop; the operator refreshes deliberately.
 */
export default function RefreshViewButton(): React.ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [manualPending, setManualPending] = useState(false);
  const pending = isPending || manualPending;

  return (
    <button
      type="button"
      className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
      disabled={pending}
      onClick={() => {
        setManualPending(true);
        startTransition(() => {
          router.refresh();
          setManualPending(false);
        });
      }}
    >
      {pending ? 'Refreshing…' : 'Refresh view'}
    </button>
  );
}
