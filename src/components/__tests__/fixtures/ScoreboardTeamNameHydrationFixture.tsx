'use client';

import React from 'react';
import { hydrateRoot } from 'react-dom/client';

import CompactGameScoreboard from '../../CompactGameScoreboard';
import ScoreboardTeamName from '../../ScoreboardTeamName';

export function ScoreboardTeamNameHydrationFixture(): React.ReactElement {
  React.useEffect(() => {
    document.documentElement.dataset.scoreboardHydrated = 'true';
  }, []);

  return (
    <>
      <div data-compact-case style={{ width: 390 }}>
        <CompactGameScoreboard
          state="final"
          matchupLabel="Southeast Missouri State at Ohio State"
          away={{
            teamName: 'Southeast Missouri State',
            owner: 'Mastromatteo',
            rank: 25,
            record: { wins: 12, losses: 0 },
            score: 100,
          }}
          home={{
            teamName: 'Ohio State',
            owner: 'Chamness',
            record: { wins: 12, losses: 0 },
            score: 7,
          }}
        />
      </div>
      <div className="flex" data-resize-case style={{ width: 80 }}>
        <ScoreboardTeamName
          abbreviation="SEMO"
          marker="resize"
          teamName="Southeast Missouri State"
        />
      </div>
      <div className="flex" data-never-wider-case style={{ width: 20 }}>
        <ScoreboardTeamName abbreviation="BERR" marker="never-wider" teamName="Berry" />
      </div>
    </>
  );
}

export function ScoreboardTeamNameNoJavaScriptFixture(): React.ReactElement {
  return (
    <div className="flex" data-no-js-case style={{ width: 1 }}>
      <ScoreboardTeamName abbreviation="SEMO" marker="no-js" teamName="Southeast Missouri State" />
    </div>
  );
}

declare global {
  interface Window {
    __scoreboardHydrationErrors?: string[];
    __scoreboardMismatchErrors?: string[];
  }
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-hydration-root]');
  if (root) {
    window.__scoreboardHydrationErrors = [];
    hydrateRoot(root, <ScoreboardTeamNameHydrationFixture />, {
      onRecoverableError(error) {
        window.__scoreboardHydrationErrors?.push(String(error));
      },
    });
  }

  const mismatchRoot = document.querySelector('[data-mismatch-root]');
  if (mismatchRoot) {
    window.__scoreboardMismatchErrors = [];
    hydrateRoot(
      mismatchRoot,
      <div className="flex" style={{ width: 50 }}>
        <ScoreboardTeamName
          abbreviation="SEMO"
          marker="mismatch"
          teamName="Southeast Missouri State"
        />
      </div>,
      {
        onRecoverableError(error) {
          window.__scoreboardMismatchErrors?.push(String(error));
        },
      }
    );
  }
}
