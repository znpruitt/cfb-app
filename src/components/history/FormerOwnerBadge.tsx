import React from 'react';

type FormerOwnerBadgeProps = {
  className?: string;
};

export default function FormerOwnerBadge({
  className = '',
}: FormerOwnerBadgeProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 ring-1 ring-gray-200 dark:text-zinc-500 dark:ring-zinc-700 ${className}`}
    >
      former
    </span>
  );
}
