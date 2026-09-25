import React from 'react';
import { createRoot } from 'react-dom/client';

import CompactGameScoreboard from '../../CompactGameScoreboard';
import GameWeekPanel from '../../GameWeekPanel';
import MatchupsWeekPanel from '../../MatchupsWeekPanel';
import { buildScheduleFromApi } from '../../../lib/schedule';
import type { ScorePack } from '../../../lib/scores';
import type { ProviderClassification } from '../../../lib/conferenceSubdivision';
import type { TeamRankingEnrichment } from '../../../lib/rankings';
import population from './thirdColumnPopulation';

declare const __CFB_SHELL_CLASS__: string;

const games = buildScheduleFromApi({
  season: 2026,
  teams: [],
  aliasMap: {},
  scheduleItems: ['Washington', 'New Mexico State', 'SEMO', 'Westgate Christian University'].map(
    (name, index) => ({
      id: `tier-${index}`,
      week: 1,
      startDate: '2026-09-05T16:00:00.000Z',
      seasonType: 'regular',
      neutralSite: false,
      conferenceGame: false,
      homeConference: '',
      awayConference: '',
      status: 'scheduled',
      homeTeam: ['Ohio State', 'Texas', 'Georgia', 'Oregon'][index],
      awayTeam: name === 'SEMO' ? 'Southeast Missouri State' : name,
      homeClassification: 'fbs',
      awayClassification: index < 2 ? 'fbs' : 'fcs',
    })
  ),
}).games;
const roster = new Map([
  ['Washington', 'Shambaugh'],
  ['New Mexico State', 'Jackson'],
  ['Ohio State', 'Pruitt'],
  ['Texas', 'Pruitt'],
  ['Georgia', 'Pruitt'],
  ['Oregon', 'Pruitt'],
]);
const scores: Record<string, ScorePack> = Object.fromEntries(
  games.map((game) => [
    game.key,
    {
      status: 'Final',
      time: null,
      away: { team: game.csvAway, score: 100 },
      home: { team: game.csvHome, score: 7 },
    },
  ])
);
const rankings = new Map<string, TeamRankingEnrichment>(
  games.flatMap((game) =>
    game.awayClassification === 'fbs'
      ? [
          [
            game.participants.away.kind === 'team' ? game.participants.away.teamId : '',
            { rank: 25, rankSource: 'ap' },
          ] as const,
        ]
      : []
  )
);
const records = Object.fromEntries(
  games.map((game) => [
    String(game.providerGameId),
    { away: { wins: 12, losses: 0 }, home: { wins: 0, losses: 12 } },
  ])
);

export function ThirdColumnTierFixture(): React.ReactElement {
  React.useEffect(() => {
    document.documentElement.dataset.tierReady = 'true';
  }, []);
  return (
    <>
      <div className={__CFB_SHELL_CLASS__} data-app-shell>
        <div data-surface="schedule">
          <GameWeekPanel
            games={games}
            byes={[]}
            oddsByKey={{}}
            scoresByKey={scores}
            rosterByTeam={roster}
            isDebug={false}
            hideByes
            displayTimeZone="UTC"
            rankingsByTeamId={rankings}
          />
        </div>
        <div data-surface="matchups">
          <MatchupsWeekPanel
            games={games}
            oddsByKey={{}}
            scoresByKey={scores}
            rosterByTeam={roster}
            rankingsByTeamId={rankings}
            teamRecordsByProviderGameId={records}
            displayTimeZone="UTC"
            nowMs={Date.parse('2026-09-06T12:00:00Z')}
          />
        </div>
      </div>
      {(['schedule', 'matchups'] as const).map((surface) => (
        <div key={surface} data-population={surface} style={{ width: 600 }}>
          {population.teams
            .filter(
              ([name]) =>
                surface === 'schedule' ||
                !population.matchupsExcluded.some((excluded) => excluded === String(name))
            )
            .map(([name, classification, owned]) => (
              <div key={String(name)} data-population-team={String(name)}>
                <CompactGameScoreboard
                  state="final"
                  matchupLabel={String(name)}
                  away={{
                    teamName: String(name),
                    classification: classification as ProviderClassification,
                    rank: owned ? 25 : null,
                    owner: owned ? 'Shambaugh' : null,
                    record: surface === 'matchups' ? { wins: 12, losses: 0 } : null,
                    score: 100,
                  }}
                  home={{ teamName: 'Ohio State', score: 7 }}
                />
              </div>
            ))}
        </div>
      ))}
    </>
  );
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-fixture-root]');
  if (root) createRoot(root).render(<ThirdColumnTierFixture />);
}
