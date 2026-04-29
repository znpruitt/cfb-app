import React from 'react';
import Link from 'next/link';

type Props = {
  title: string;
  delegationHref: string;
  delegationLabel: string;
};

export default function SectionHead({
  title,
  delegationHref,
  delegationLabel,
}: Props): React.ReactElement {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">{title}</h2>
      <Link
        href={delegationHref}
        className="text-[13px] text-blue-600 hover:underline dark:text-blue-400"
      >
        {delegationLabel}
      </Link>
    </div>
  );
}
