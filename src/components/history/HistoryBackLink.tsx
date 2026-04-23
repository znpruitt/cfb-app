'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

type HistoryBackLinkProps = {
  fallbackHref: string;
  label?: string;
  className?: string;
};

const baseClass = 'text-sm text-blue-600 hover:underline dark:text-blue-400';

export default function HistoryBackLink({
  fallbackHref,
  label = 'Back to League History',
  className,
}: HistoryBackLinkProps): React.ReactElement {
  const router = useRouter();
  const resolvedClass = className ? `${baseClass} ${className}` : baseClass;

  function handleClick(): void {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <button type="button" onClick={handleClick} className={resolvedClass}>
      ← {label}
    </button>
  );
}
