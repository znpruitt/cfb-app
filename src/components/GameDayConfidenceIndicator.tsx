import type { ReactElement } from 'react';

import type { GameDayConfidence } from '../lib/selectors/gameDayConfidence';

export default function GameDayConfidenceIndicator({
  confidence,
}: {
  confidence: GameDayConfidence | null;
}): ReactElement {
  if (!confidence) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-game-day-confidence="idle"
        className="sr-only"
      />
    );
  }

  const isTracking = confidence.kind === 'tracking';

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-game-day-confidence={confidence.kind}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-zinc-300"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full bg-gray-400 dark:bg-zinc-500 ${isTracking ? 'motion-safe:animate-pulse' : ''}`}
      />
      {confidence.label}
    </span>
  );
}
