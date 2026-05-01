import React from 'react';
import type { RecordEntry } from '@/lib/selectors/leagueRecords';

type RecordCategory = RecordEntry['category'];

export const STROKE_COLORS: Record<RecordCategory, string> = {
  career: '#0F6E56',
  season: '#534AB7',
  rivalry: '#993C1D',
  event: '#185FA5',
};

type RecordBadgeProps = {
  category: RecordCategory;
  size?: number;
  className?: string;
  ariaLabel?: string;
};

export default function RecordBadge({
  category,
  size = 12,
  className,
  ariaLabel,
}: RecordBadgeProps): React.ReactElement {
  const color = STROKE_COLORS[category];
  const label = ariaLabel ?? category;

  let icon: React.ReactElement;

  if (category === 'career') {
    icon = (
      <polygon
        points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        fill="none"
      />
    );
  } else if (category === 'season') {
    icon = (
      <>
        <rect
          x="3"
          y="4"
          width="18"
          height="18"
          rx="2"
          stroke={color}
          strokeWidth={2}
          fill="none"
        />
        <line x1="3" y1="9" x2="21" y2="9" stroke={color} strokeWidth={2} />
        <line x1="8" y1="2" x2="8" y2="6" stroke={color} strokeWidth={2} strokeLinecap="round" />
        <line x1="16" y1="2" x2="16" y2="6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      </>
    );
  } else if (category === 'rivalry') {
    icon = (
      <>
        <line x1="4" y1="4" x2="20" y2="20" stroke={color} strokeWidth={2} strokeLinecap="round" />
        <line x1="20" y1="4" x2="4" y2="20" stroke={color} strokeWidth={2} strokeLinecap="round" />
      </>
    );
  } else {
    icon = (
      <polygon
        points="13,2 4,13 11,13 9,22 20,11 13,11"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        fill="none"
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-label={label}
      role="img"
      className={className}
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      {icon}
    </svg>
  );
}
