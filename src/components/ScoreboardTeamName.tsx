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
    // Hidden recap panels have no laid-out box. Keep SSR's abbreviation until the
    // shared observer sees real dimensions; 0 >= 0 is not a never-wider result.
    // The hidden-before/after-reveal control in ScoreboardTeamNameFallback.browser.test.tsx pins this.
    if (boxWidth === 0 || fullNameWidth === 0 || abbreviationWidth === 0) return;
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
   * The visible variant alone participates in layout. Both measurement probes are absolute,
   * so neither can set the box's width. The box is allocated by its flex row after suffixes,
   * and text that cannot fit wraps inside it rather than escaping or being ellipsized.
   * "SSR and no-JS keep a single untruncated abbreviation" and "fit, overflow, never-wider,
   * and resize decisions use the rendered name box" pin those mechanisms in Chrome.
   */
  return (
    <span
      className="relative block min-w-[1em] flex-1 overflow-hidden"
      data-scoreboard-team-display={showFullName ? 'full' : 'abbreviation'}
      data-scoreboard-team-label={marker}
      ref={boxRef}
    >
      <span className="sr-only" data-scoreboard-team-accessible={marker}>
        {teamName}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 inline-block whitespace-nowrap"
        data-scoreboard-team-full={marker}
        data-scoreboard-team={marker}
        ref={fullNameRef}
      >
        {teamName}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 inline-block whitespace-nowrap"
        data-scoreboard-team-abbreviation={marker}
        ref={abbreviationRef}
      >
        {abbreviation}
      </span>
      <span
        aria-hidden="true"
        className="block max-w-full whitespace-normal break-words"
        data-scoreboard-team-visible={marker}
        data-scoreboard-team-visual={showFullName ? 'full' : 'abbreviation'}
      >
        {showFullName ? teamName : abbreviation}
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
        className="block min-w-[1em] flex-1 overflow-hidden whitespace-normal break-words"
        data-scoreboard-team={marker}
      >
        {teamName}
      </span>
    );
  }

  return (
    <MeasuredScoreboardTeamName
      key={`${teamName}\u0000${abbreviation}`}
      abbreviation={abbreviation}
      marker={marker}
      teamName={teamName}
    />
  );
}
