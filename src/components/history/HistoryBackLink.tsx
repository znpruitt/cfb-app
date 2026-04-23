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
    if (typeof window === 'undefined') {
      router.push(fallbackHref);
      return;
    }

    if (window.history.length <= 1) {
      router.push(fallbackHref);
      return;
    }

    // Only call router.back() when the referrer is same-origin — i.e., we arrived
    // via in-app navigation. An empty or cross-origin referrer means the user
    // deep-linked from outside the app (search, Slack, direct bookmark), and
    // router.back() would eject them to that external site. Fall back safely.
    let cameFromSameOrigin = false;
    try {
      const referrer = document.referrer;
      if (referrer) {
        const referrerOrigin = new URL(referrer).origin;
        cameFromSameOrigin = referrerOrigin === window.location.origin;
      }
    } catch {
      cameFromSameOrigin = false;
    }

    if (cameFromSameOrigin) {
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
