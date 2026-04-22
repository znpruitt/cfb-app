import React from 'react';
import Link from 'next/link';

export type BreadcrumbSegment = {
  label: string;
  href?: string;
};

type BreadcrumbsProps = {
  segments: BreadcrumbSegment[];
  className?: string;
};

const linkClass =
  'text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300';
const currentClass = 'text-sm font-medium text-gray-900 dark:text-zinc-100';
const separatorClass = 'text-sm text-gray-400 dark:text-zinc-600 select-none';

export default function Breadcrumbs({ segments, className }: BreadcrumbsProps): React.ReactElement {
  const wrapperClass = ['flex items-center gap-2 text-sm mb-4', className]
    .filter(Boolean)
    .join(' ');

  return (
    <nav aria-label="Breadcrumbs" className={wrapperClass}>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <React.Fragment key={`${segment.label}-${index}`}>
            {segment.href && !isLast ? (
              <Link href={segment.href} className={linkClass}>
                {segment.label}
              </Link>
            ) : (
              <span className={currentClass} aria-current={isLast ? 'page' : undefined}>
                {segment.label}
              </span>
            )}
            {!isLast && (
              <span aria-hidden="true" className={separatorClass}>
                /
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
