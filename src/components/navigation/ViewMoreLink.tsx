import React from 'react';
import Link from 'next/link';

export type ViewMoreLinkProps = {
  href: string;
  children: React.ReactNode;
  external?: boolean;
  className?: string;
};

export const viewMoreLinkClass =
  'text-sm text-gray-500 hover:text-gray-700 transition-colors dark:text-zinc-400 dark:hover:text-zinc-200';

export default function ViewMoreLink({
  href,
  children,
  external = false,
  className,
}: ViewMoreLinkProps): React.ReactElement {
  const resolvedClass = className ?? viewMoreLinkClass;
  const glyph = external ? ' ↗' : ' →';

  if (external) {
    return (
      <a href={href} className={resolvedClass} target="_blank" rel="noopener noreferrer">
        {children}
        {glyph}
      </a>
    );
  }

  return (
    <Link href={href} className={resolvedClass}>
      {children}
      {glyph}
    </Link>
  );
}
