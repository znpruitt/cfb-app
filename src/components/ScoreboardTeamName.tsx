'use client';

import React from 'react';

type ScoreboardTeamNameProps = {
  abbreviation: string | null;
  marker: string;
  teamName: string;
};

type ResizeHandler = () => void;

const resizeHandlers = new WeakMap<Element, Set<ResizeHandler>>();
let sharedResizeObserver: ResizeObserver | null = null;

function getSharedResizeObserver(): ResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') return null;
  if (sharedResizeObserver) return sharedResizeObserver;

  sharedResizeObserver = new ResizeObserver((entries) => {
    const pendingHandlers = new Set<ResizeHandler>();
    for (const entry of entries) {
      for (const handler of resizeHandlers.get(entry.target) ?? []) {
        pendingHandlers.add(handler);
      }
    }
    for (const handler of pendingHandlers) handler();
  });
  return sharedResizeObserver;
}

function observeSize(element: Element, handler: ResizeHandler): () => void {
  const observer = getSharedResizeObserver();
  if (!observer) return () => undefined;

  let handlers = resizeHandlers.get(element);
  if (!handlers) {
    handlers = new Set();
    resizeHandlers.set(element, handlers);
    observer.observe(element);
  }
  handlers.add(handler);

  return () => {
    handlers.delete(handler);
    if (handlers.size > 0) return;
    observer.unobserve(element);
    resizeHandlers.delete(element);
  };
}

function MeasuredScoreboardTeamName({
  abbreviation,
  marker,
  teamName,
}: ScoreboardTeamNameProps & { abbreviation: string }): React.ReactElement {
  const boxRef = React.useRef<HTMLSpanElement>(null);
  const fullNameRef = React.useRef<HTMLSpanElement>(null);
  const abbreviationRef = React.useRef<HTMLSpanElement>(null);
  const [showFullName, setShowFullName] = React.useState(false);

  const measureFit = React.useCallback(() => {
    const box = boxRef.current;
    const fullName = fullNameRef.current;
    const abbreviationProbe = abbreviationRef.current;
    if (!box || !fullName || !abbreviationProbe) return;

    const boxWidth = box.getBoundingClientRect().width;
    const fullNameWidth = fullName.getBoundingClientRect().width;
    const abbreviationWidth = abbreviationProbe.getBoundingClientRect().width;
    const nextShowFullName = abbreviationWidth >= fullNameWidth || fullNameWidth <= boxWidth;

    setShowFullName((current) => (current === nextShowFullName ? current : nextShowFullName));
  }, []);

  React.useLayoutEffect(() => {
    measureFit();
    const elements = [boxRef.current, fullNameRef.current, abbreviationRef.current].filter(
      (element): element is HTMLSpanElement => element !== null
    );
    const cleanups = elements.map((element) => observeSize(element, measureFit));
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [abbreviation, measureFit, teamName]);

  /*
   * SSR and no-JS deliberately leave the provider abbreviation visible, even when that
   * viewer would measure it wider than the name: never-wider only binds after measurement.
   * Both variants overflow visibly on one line, so neither can be ellipsized, clipped, or
   * wrapped while the layout effect or observer catches up. The browser assertions named
   * "SSR and no-JS keep a single untruncated abbreviation" and "fit, overflow, never-wider,
   * and resize decisions use the rendered name box" pin those two mechanisms.
   */
  return (
    <span
      className="relative block min-w-0 max-w-full shrink-0 overflow-visible whitespace-nowrap"
      data-scoreboard-team-display={showFullName ? 'full' : 'abbreviation'}
      data-scoreboard-team-label={marker}
      ref={boxRef}
    >
      <span className="sr-only" data-scoreboard-team-accessible={marker}>
        {teamName}
      </span>
      <span
        aria-hidden="true"
        className={`inline-block whitespace-nowrap ${showFullName ? '' : 'invisible'}`}
        data-scoreboard-team-full={marker}
        data-scoreboard-team={marker}
        ref={fullNameRef}
      >
        {teamName}
      </span>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0 top-0 inline-block whitespace-nowrap ${
          showFullName ? 'invisible' : ''
        }`}
        data-scoreboard-team-abbreviation={marker}
        ref={abbreviationRef}
      >
        {abbreviation}
      </span>
    </span>
  );
}

export default function ScoreboardTeamName({
  abbreviation,
  marker,
  teamName,
}: ScoreboardTeamNameProps): React.ReactElement {
  if (abbreviation === null) {
    return (
      <span
        className="relative block min-w-0 max-w-full shrink-0 overflow-visible whitespace-nowrap"
        data-scoreboard-team={marker}
      >
        {teamName}
      </span>
    );
  }

  return (
    <MeasuredScoreboardTeamName abbreviation={abbreviation} marker={marker} teamName={teamName} />
  );
}
