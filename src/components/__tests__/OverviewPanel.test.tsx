import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OverviewPanelImpl from '../OverviewPanel';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../../lib/overview';
import { deriveLeagueInsights, deriveOverviewInsights } from '../../lib/selectors/insights';
import { TREND_EMPTY_MESSAGE } from '../../lib/trendEmptyState';
import { selectSeasonContext, type SeasonContext } from '../../lib/selectors/seasonContext';
import { selectLiveDelta, type LiveDelta } from '../../lib/selectors/liveDelta';
import { deriveStandingsCoverage } from '../../lib/standings';
import type { OwnerStandingsRow, StandingsCoverage } from '../../lib/standings';
import type { StandingsHistory } from '../../lib/standingsHistory';
import type { AppGame } from '../../lib/schedule';
import type { ScorePack } from '../../lib/scores';

type OverviewPanelProps = React.ComponentProps<typeof OverviewPanelImpl>;
type OverviewPanelTestProps = Omit<OverviewPanelProps, 'sectionItems' | 'nowMs'> &
  Partial<Pick<OverviewPanelProps, 'sectionItems' | 'nowMs'>>;

function OverviewPanel(props: OverviewPanelTestProps): React.ReactElement {
  const { sectionItems, nowMs, liveItems, keyMatchups } = props;
  return (
    <OverviewPanelImpl
      {...props}
      sectionItems={sectionItems ?? [...liveItems, ...keyMatchups]}
      nowMs={nowMs ?? Date.parse('2026-09-01T16:30:00.000Z')}
    />
  );
}

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      home: {
        kind: 'team',
        teamId: 'h',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    media: overrides.media,
    sources: overrides.sources,
    startTimeTBD: overrides.startTimeTBD,
  };
}

function item(gameValue: AppGame): OverviewGameItem {
  return {
    bucket: {
      game: gameValue,
      awayOwner: 'Alice',
      homeOwner: 'Bob',
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    priority: 2,
    sortDate: 1,
  };
}

function itemWithScore(gameValue: AppGame, score: ScorePack): OverviewGameItem {
  return {
    ...item(gameValue),
    score,
  };
}

function standingsHistoryFromSnapshots(
  snapshots: Array<{ week: number; standings: OwnerStandingsRow[] }>
): StandingsHistory {
  const byOwner = snapshots.reduce<StandingsHistory['byOwner']>((acc, snapshot) => {
    snapshot.standings.forEach((row) => {
      if (!acc[row.owner]) acc[row.owner] = [];
      acc[row.owner]!.push({
        week: snapshot.week,
        wins: row.wins,
        losses: row.losses,
        ties: 0,
        winPct: row.winPct,
        pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst,
        pointDifferential: row.pointDifferential,
        gamesBack: row.gamesBack,
      });
    });
    return acc;
  }, {});

  return {
    weeks: snapshots.map((snapshot) => snapshot.week),
    byWeek: Object.fromEntries(
      snapshots.map((snapshot) => [
        snapshot.week,
        {
          week: snapshot.week,
          standings: snapshot.standings.map((row) => ({ ...row, ties: 0 })),
          coverage: { state: 'complete', message: null as string | null },
        },
      ])
    ),
    byOwner,
  };
}

const standingsLeaders: OwnerStandingsRow[] = [
  {
    owner: 'Alice',
    wins: 4,
    losses: 1,
    winPct: 0.8,
    pointsFor: 120,
    pointsAgainst: 100,
    pointDifferential: 20,
    gamesBack: 0,
    finalGames: 5,
  },
];

const coverage: StandingsCoverage = { state: 'complete', message: null };

const defaultContext: OverviewContext = {
  scopeLabel: 'League',
  scopeDetail: 'Week 1',
  emphasis: 'upcoming',
  highlightsTitle: 'What matters next',
  highlightsDescription:
    'The active slate is upcoming, so Overview leads with the next head-to-head and owned-team games to watch.',
  liveDescription: 'If games go live, they will automatically move to the top of Overview.',
  sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
};

const matchupMatrix: OwnerMatchupMatrix = {
  owners: ['Alice', 'Bob'],
  rows: [
    {
      owner: 'Alice',
      cells: [
        { owner: 'Alice', gameCount: 0, record: null },
        { owner: 'Bob', gameCount: 2, record: '1–1' },
      ],
    },
    {
      owner: 'Bob',
      cells: [
        { owner: 'Alice', gameCount: 2, record: '1–1' },
        { owner: 'Bob', gameCount: 0, record: null },
      ],
    },
  ],
};

test('overview panel uses neutral wording for neutral-site games', () => {
  const neutralGame = game({
    csvAway: 'Texas',
    csvHome: 'Ohio State',
    neutral: true,
    neutralDisplay: 'vs',
    stage: 'bowl',
  });
  const neutralLive = itemWithScore(neutralGame, {
    status: 'In Progress',
    away: { team: 'Texas', score: 7 },
    home: { team: 'Ohio State', score: 3 },
    time: 'Q1',
  });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[neutralLive]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /aria-label="Texas vs Ohio State"/);
  assert.doesNotMatch(html, /aria-label="Texas at Ohio State"/);
});

test('overview panel keeps home-away wording for standard games', () => {
  const homeAwayGame = game({
    csvAway: 'Texas',
    csvHome: 'Rice',
    neutral: false,
    neutralDisplay: 'home_away',
    stage: 'regular',
  });
  const homeAwayScheduled = item(homeAwayGame);
  const homeAwayLive = itemWithScore(homeAwayGame, {
    status: 'In Progress',
    away: { team: 'Texas', score: 7 },
    home: { team: 'Rice', score: 3 },
    time: 'Q1',
  });

  const liveHtml = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[homeAwayLive]}
      keyMatchups={[]}
      sectionItems={[homeAwayLive]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  const scheduledHtml = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[homeAwayScheduled]}
      sectionItems={[homeAwayScheduled]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(liveHtml, /aria-label="Texas at Rice"/);
  assert.match(scheduledHtml, /aria-label="Texas at Rice"/);
});

test('overview watchlist uses the shared scoreboard with records and one odds footer', () => {
  const watchlistGame = game({
    key: 'fcs-watchlist',
    providerGameId: '401868946',
    date: '2026-09-03T22:00:00.000Z',
    csvAway: 'UAlbany',
    csvHome: 'Buffalo',
    canAway: 'UAlbany',
    canHome: 'Buffalo',
    media: [{ gameId: '401868946', mediaType: 'tv', outlet: 'ESPN' }],
    participants: {
      away: {
        kind: 'team',
        teamId: 'ualbany',
        displayName: 'UAlbany',
        canonicalName: 'UAlbany',
        rawName: 'UAlbany',
      },
      home: {
        kind: 'team',
        teamId: 'buffalo',
        displayName: 'Buffalo',
        canonicalName: 'Buffalo',
        rawName: 'Buffalo',
      },
    },
  });

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[item(watchlistGame)]}
      context={defaultContext}
      displayTimeZone="UTC"
      rankingsByTeamId={new Map([['buffalo', { rank: 24, rankSource: 'ap' }]])}
      teamRecordsByProviderGameId={{
        '401868946': {
          away: { wins: 1, losses: 0 },
          home: { wins: 0, losses: 0 },
        },
      }}
      oddsByKey={{
        'fcs-watchlist': {
          favorite: 'Buffalo',
          spread: -20.5,
          homeSpread: -20.5,
          awaySpread: 20.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: 55.5,
          mlHome: null,
          mlAway: null,
          overPrice: -110,
          underPrice: -110,
          source: 'ESPN BET',
          bookmakerKey: 'espnbet',
          capturedAt: '2026-09-02T12:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
    />
  );

  const scoreboard = html.match(
    /<article(?=[^>]*aria-label="UAlbany at Buffalo")(?=[^>]*data-scoreboard-state="scheduled")[\s\S]*?<\/article>/
  )?.[0];
  assert.ok(scoreboard, 'the FCS matchup must render through CompactGameScoreboard');
  assert.match(scoreboard, /data-watchlist-reason-row/);
  assert.match(scoreboard, /Game of the slate/);
  assert.match(scoreboard, /Contender Watch/);
  assert.match(scoreboard, /Thu, Sep 3, 10:00 PM/);
  assert.match(scoreboard, /ESPN/);
  assert.match(
    scoreboard,
    /data-scoreboard-side="away"[\s\S]*data-scoreboard-team="away">UAlbany<\/span>[\s\S]*data-scoreboard-owner="away">Alice<\/span>[\s\S]*data-scoreboard-value-kind="record" data-scoreboard-value="away">1–0<\//
  );
  assert.match(
    scoreboard,
    /data-scoreboard-side="home"[\s\S]*#24[\s\S]*data-scoreboard-team="home">Buffalo<\/span>[\s\S]*data-scoreboard-owner="home">Bob<\/span>[\s\S]*data-scoreboard-value-kind="record" data-scoreboard-value="home">0–0<\//
  );
  assert.match(scoreboard, /data-scoreboard-odds-footer[^>]*>Buffalo -20\.5 · O\/U 55\.5<\/div>/);
  assert.doesNotMatch(scoreboard, />Scheduled<\/span>|———/);
});

test('overview scoreboards keep current records across scheduled, live, and final states', () => {
  const scheduled = item(
    game({
      key: 'scheduled-record',
      providerGameId: 'schedule-pid',
      csvAway: 'Army',
      csvHome: 'Navy',
    })
  );
  const live = itemWithScore(
    game({
      key: 'live-record',
      providerGameId: 'live-pid',
      csvAway: 'Georgia',
      csvHome: 'Clemson',
      date: '2026-09-01T16:00:00.000Z',
    }),
    {
      status: 'In Progress',
      away: { team: 'Georgia', score: 7 },
      home: { team: 'Clemson', score: 3 },
      time: 'Q1 4:12',
    }
  );
  const final = itemWithScore(
    game({
      key: 'final-record',
      providerGameId: 'final-pid',
      csvAway: 'Texas',
      csvHome: 'Rice',
      date: '2026-09-01T15:00:00.000Z',
    }),
    {
      status: 'Final',
      away: { team: 'Texas', score: 31 },
      home: { team: 'Rice', score: 14 },
      time: null,
    }
  );

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[live]}
      keyMatchups={[scheduled]}
      sectionItems={[scheduled, live, final]}
      context={defaultContext}
      displayTimeZone="UTC"
      teamRecordsByProviderGameId={{
        'schedule-pid': { away: { wins: 0, losses: 0 }, home: { wins: 1, losses: 0 } },
        'live-pid': { away: { wins: 2, losses: 0 }, home: { wins: 1, losses: 1 } },
        'final-pid': { away: { wins: 3, losses: 0 }, home: { wins: 1, losses: 2 } },
      }}
    />
  );

  assert.match(
    html,
    /data-scoreboard-state="scheduled"[\s\S]*data-scoreboard-value-kind="record" data-scoreboard-value="away">0–0<\//
  );
  assert.match(
    html,
    /data-scoreboard-state="live"[\s\S]*data-scoreboard-team="away">Georgia<\/span><span[^>]*data-scoreboard-record="away">\(2–0\)<\/span><span[^>]*data-scoreboard-owner="away">Alice<\/span>[\s\S]*data-scoreboard-value-kind="score" data-scoreboard-value="away">7<\//
  );
  assert.match(
    html,
    /data-scoreboard-state="final"[\s\S]*data-scoreboard-team="away">Texas<\/span><span[^>]*data-scoreboard-record="away">\(3–0\)<\/span><span[^>]*data-scoreboard-owner="away">Alice<\/span>[\s\S]*data-scoreboard-value-kind="score" data-scoreboard-value="away">31<\//
  );
});

test('overview watchlist renders withheld records as absent and preserves an empty odds row', () => {
  const withheldGame = game({
    key: 'withheld-record',
    providerGameId: 'withheld-pid',
    csvAway: 'UAlbany',
    csvHome: 'Buffalo',
  });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[item(withheldGame)]}
      context={defaultContext}
      displayTimeZone="UTC"
      teamRecordsByProviderGameId={{
        'withheld-pid': { away: null, home: { wins: 0, losses: 0 } },
      }}
    />
  );

  const scoreboard = html.match(
    /<article(?=[^>]*aria-label="UAlbany at Buffalo")(?=[^>]*data-scoreboard-state="scheduled")[\s\S]*?<\/article>/
  )?.[0];
  assert.ok(scoreboard, 'the withheld-record fixture must reach the scheduled scoreboard');
  const awayRow = scoreboard.match(
    /<div(?=[^>]*data-scoreboard-side="away")[^>]*>[\s\S]*?<\/div>/
  )?.[0];
  assert.ok(awayRow, 'the withheld away-team line must render');
  assert.doesNotMatch(awayRow, /data-scoreboard-value="away"|>0–0<|———/);
  assert.match(
    scoreboard,
    /data-scoreboard-value-kind="record" data-scoreboard-value="home">0–0<\//
  );
  assert.match(scoreboard, /data-scoreboard-odds-footer[^>]*><\/div>/);
});

test('overview Live section consumes the shared scoreboard in a row-major responsive grid', () => {
  const awayLeading = itemWithScore(
    game({ key: 'away-leading', csvAway: 'Utah', csvHome: 'Arizona State' }),
    {
      status: 'Q3',
      away: { team: 'Utah', score: 31 },
      home: { team: 'Arizona State', score: 20 },
      time: '4:55',
    }
  );
  const homeLeading = itemWithScore(
    game({ key: 'home-leading', csvAway: 'Michigan', csvHome: 'Ohio State' }),
    {
      status: 'STATUS_IN_PROGRESS',
      away: { team: 'Michigan', score: 7 },
      home: { team: 'Ohio State', score: 21 },
      time: 'Q2',
    }
  );
  const rankingsByTeamId = new Map([
    ['a', { rank: 24, rankSource: 'cfp' as const }],
    ['h', { rank: 7, rankSource: 'ap' as const }],
  ]);

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[awayLeading, homeLeading]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
      rankingsByTeamId={rankingsByTeamId}
    />
  );

  assert.match(
    html,
    /grid grid-cols-2 gap-x-10 @max-\[760\.01px\]:grid-cols-1" data-live-scoreboard-grid/
  );
  assert.equal((html.match(/data-game-scoreboard=/g) ?? []).length, 2);
  const awayLeadingCard = html.indexOf('aria-label="Utah at Arizona State"');
  const homeLeadingCard = html.indexOf('aria-label="Michigan at Ohio State"');
  assert.ok(awayLeadingCard >= 0, 'away-leading card must render its matchup label');
  assert.ok(homeLeadingCard > awayLeadingCard, 'cards must keep row-major source order');
  assert.match(
    html,
    /aria-label="Michigan at Ohio State"[\s\S]*data-scoreboard-side="away" data-scoreboard-leading="false"[\s\S]*data-scoreboard-side="home" data-scoreboard-leading="true"/
  );
  assert.match(html, />Live<\/span>[\s\S]*Q3 4:55/);
  assert.match(html, />Live<\/span>[\s\S]*>Q2<\/span>/);
  assert.match(html, /title="CFP rank #24"/);
  assert.match(html, /title="AP rank #7"/);
  assert.doesNotMatch(html, /STATUS_IN_PROGRESS|amber/);
});

test('overview Live section suppresses kickoff timestamps when no game clock is available', () => {
  const genericLive = itemWithScore(
    game({ key: 'generic-live', csvAway: 'Georgia', csvHome: 'Alabama' }),
    {
      status: 'in progress',
      away: { team: 'Georgia', score: 10 },
      home: { team: 'Alabama', score: 7 },
      time: '2026-09-01T17:00:00.000Z',
    }
  );

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[genericLive]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, />Live<\/span>/);
  assert.doesNotMatch(html, /in progress|2026-09-01T17:00:00.000Z/);
});

test('overview Live section treats STATUS_LIVE as a generic state label', () => {
  const genericLive = itemWithScore(
    game({ key: 'status-live', csvAway: 'Auburn', csvHome: 'LSU' }),
    {
      status: 'STATUS_LIVE',
      away: { team: 'Auburn', score: 3 },
      home: { team: 'LSU', score: 7 },
      time: 'Q2',
    }
  );

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[genericLive]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, />Live<\/span>[\s\S]*>Q2<\/span>/);
  assert.doesNotMatch(html, /STATUS_LIVE/);
});

test('overview Featured renders a home-won final through the neutral compact scoreboard', () => {
  const neutralGame = game({
    csvAway: 'Texas',
    csvHome: 'Ohio State',
    date: '2026-12-19T19:00:00.000Z',
    neutral: true,
    neutralDisplay: 'vs',
    stage: 'bowl',
    postseasonRole: 'playoff',
    playoffRound: 'quarterfinal',
  });
  const liveGame = itemWithScore(
    game({ key: 'green-live-control', csvAway: 'Georgia', csvHome: 'Alabama' }),
    {
      status: 'in progress',
      away: { team: 'Georgia', score: 10 },
      home: { team: 'Alabama', score: 7 },
      time: 'Q2 6:14',
    }
  );

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[liveGame]}
      keyMatchups={[
        itemWithScore(neutralGame, {
          status: 'FINAL',
          away: { team: 'Texas', score: 21 },
          home: { team: 'Ohio State', score: 24 },
          time: null,
        }),
      ]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Featured games/);
  const finalScoreboard = html.match(
    /<article(?=[^>]*data-scoreboard-state="final")[\s\S]*?<\/article>/
  )?.[0];
  assert.ok(finalScoreboard, 'Featured final must render through CompactGameScoreboard');
  assert.match(finalScoreboard, /aria-label="Texas vs Ohio State"/);
  assert.match(finalScoreboard, /data-scoreboard-context-slot/);
  assert.match(finalScoreboard, /CFP Quarterfinal/);
  assert.match(finalScoreboard, /Sat, Dec 19, 7:00 PM/);
  assert.match(
    finalScoreboard,
    /data-scoreboard-side="away" data-scoreboard-leading="false"[\s\S]*data-scoreboard-team="away">Texas<\/span>[\s\S]*data-scoreboard-value="away">21<\//
  );
  assert.match(
    finalScoreboard,
    /font-semibold dark:text-zinc-50" data-scoreboard-side="home" data-scoreboard-leading="true"[\s\S]*data-scoreboard-team="home">Ohio State<\/span>[\s\S]*data-scoreboard-value="home">24<\//
  );
  assert.doesNotMatch(finalScoreboard, /emerald|green/);
  const liveScoreboard = html.match(
    /<article(?=[^>]*data-scoreboard-state="live")[\s\S]*?<\/article>/
  )?.[0];
  assert.ok(liveScoreboard, 'positive control must render a live scoreboard');
  assert.match(liveScoreboard, /dark:text-emerald-400/);
  assert.match(
    html,
    /<section class="@container">[\s\S]*?<div class="grid grid-cols-2 gap-x-10 @max-\[760\.01px\]:grid-cols-1" data-featured-scoreboard-grid="true">/
  );
});

test('overview Featured conversion preserves the existing recent-results selection and order', () => {
  const finals = Array.from({ length: 7 }, (_, index) => {
    const value = index + 1;
    return {
      ...itemWithScore(
        game({
          key: `selection-final-${value}`,
          csvAway: `Final Away ${value}`,
          csvHome: `Final Home ${value}`,
        }),
        {
          status: 'Final',
          away: { team: `Final Away ${value}`, score: 14 },
          home: { team: `Final Home ${value}`, score: 21 },
          time: null,
        }
      ),
      sortDate: value,
    };
  });

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={finals}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );
  const recentFinalsStart = html.indexOf('>Recent finals</h2>');
  const featuredRegion = html.slice(
    html.indexOf('data-featured-scoreboard-grid="true"'),
    recentFinalsStart === -1 ? html.length : recentFinalsStart
  );
  const renderedMatchups = Array.from(
    featuredRegion.matchAll(/aria-label="(Final Away \d+ at Final Home \d+)"/g),
    (match) => match[1]
  );

  assert.deepEqual(renderedMatchups, [
    'Final Away 7 at Final Home 7',
    'Final Away 6 at Final Home 6',
    'Final Away 5 at Final Home 5',
    'Final Away 4 at Final Home 4',
    'Final Away 3 at Final Home 3',
    'Final Away 2 at Final Home 2',
  ]);
});

test('overview panel renders league highlights and standings without matrix table', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        ...standingsLeaders,
        {
          owner: 'Bob',
          wins: 3,
          losses: 2,
          winPct: 0.6,
          pointsFor: 110,
          pointsAgainst: 101,
          pointDifferential: 9,
          gamesBack: 1,
          finalGames: 5,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Standings/);
  assert.match(html, /Insights/);
  assert.doesNotMatch(html, /Featured matchups/);
  assert.doesNotMatch(html, /View details/);
  assert.match(html, /All results →/);
  assert.doesNotMatch(html, /Head-to-head matrix/);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /League snapshot/);
});

test('overview standings emphasize leader row and use the pending badge as the only live signal', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      games={[game({ key: 'live-1', csvAway: 'Texas', csvHome: 'Rice' })]}
      scoresByKey={{
        'live-1': {
          status: 'In Progress',
          away: { team: 'Texas', score: 14 },
          home: { team: 'Rice', score: 10 },
          time: '07:11',
        },
      }}
      rosterByTeam={
        new Map([
          ['Texas', 'Alice'],
          ['Rice', 'Bob'],
        ])
      }
      standingsLeaders={[
        ...standingsLeaders,
        {
          owner: 'Bob',
          wins: 3,
          losses: 2,
          winPct: 0.6,
          pointsFor: 110,
          pointsAgainst: 101,
          pointDifferential: 9,
          gamesBack: 1,
          finalGames: 5,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
      liveDelta={overviewLiveDelta({
        Alice: { pendingWins: 1, pendingLosses: 0 },
        Bob: { pendingWins: 0, pendingLosses: 1 },
      })}
    />
  );

  // The leader is surfaced as the rank-1 podium card and the top standings row;
  // the pending badge is the row's one live signal (the count pill is gone).
  assert.match(html, /#1[\s\S]*?Alice/);
  assert.match(html, /data-overview-live-pending="1-0"/);
  assert.match(html, /data-overview-live-pending="0-1"/);
  assert.doesNotMatch(html, /1 live/);
});

test('overview panel summary shows in-season leader, record, and win percentage', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // The in-season leader is surfaced via the rank-1 hero/podium card, which
  // shows the owner, their record, win percentage, and point differential.
  assert.match(html, /#1[\s\S]*?Alice/);
  assert.match(html, /4–1/);
  assert.match(html, /Win% 0.800/);
  assert.match(html, /Diff \+20/);
});

test('overview panel summary uses standings win% gap over #2 during in-season state', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 6,
          losses: 1,
          winPct: 0.857,
          pointsFor: 200,
          pointsAgainst: 180,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 7,
        },
        {
          owner: 'Bob',
          wins: 7,
          losses: 2,
          winPct: 0.778,
          pointsFor: 230,
          pointsAgainst: 210,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 9,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // In-season, the leader and runner-up are shown as ranked hero cards with
  // their distinct win percentages (0.857 vs 0.778); the win% gap over #2 is
  // expressed by the ordered #1/#2 cards rather than a "Gap #2" narrative
  // string. The win percentages differ, confirming the gap is not a tie.
  assert.match(html, /#1[\s\S]*?Alice[\s\S]*?Win% 0.857/);
  assert.match(html, /#2[\s\S]*?Bob[\s\S]*?Win% 0.778/);
});

test('overview panel summary shows tie copy when top win percentages match', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 6,
          losses: 2,
          winPct: 0.75,
          pointsFor: 200,
          pointsAgainst: 180,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 8,
        },
        {
          owner: 'Bob',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 290,
          pointsAgainst: 260,
          pointDifferential: 30,
          gamesBack: 0,
          finalGames: 12,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // A top-win-percentage tie surfaces as a dead-heat insight naming the tied
  // owners; the hero card confirms the leader's tied record and win percentage.
  assert.match(html, /Title race dead heat/);
  assert.match(html, /Alice and Bob are tied for first\./);
  assert.match(html, /#1[\s\S]*?Alice[\s\S]*?6–2[\s\S]*?Win% 0.750/);
});

test('overview panel summary narrative lists all owners in a three-way tie', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 200,
          pointsAgainst: 180,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 12,
        },
        {
          owner: 'Bob',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 190,
          pointsAgainst: 170,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 12,
        },
        {
          owner: 'Chris',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 180,
          pointsAgainst: 160,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 12,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // A multi-way tie surfaces as a dead-heat insight (which names the leader and
  // top runner-up) plus all tied owners shown with identical records at the top
  // of the podium/standings. The full owner list is no longer concatenated into
  // a single narrative string after the standings-ownership redesign.
  assert.match(html, /Title race dead heat/);
  assert.match(html, /#1[\s\S]*?Alice[\s\S]*?9–3/);
  assert.match(html, /#2[\s\S]*?Bob[\s\S]*?9–3/);
  assert.match(html, /#3[\s\S]*?Chris[\s\S]*?9–3/);
});

test('overview panel summary uses postseason in-progress championship language', () => {
  const postseasonGame = game({
    stage: 'bowl',
    status: 'in_progress',
  });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[
        itemWithScore(postseasonGame, {
          status: 'Q3',
          away: { team: 'Away', score: 21 },
          home: { team: 'Home', score: 17 },
          time: '09:10',
        }),
      ]}
      keyMatchups={[item(postseasonGame)]}
      context={{ ...defaultContext, scopeLabel: 'Postseason' }}
      displayTimeZone="UTC"
    />
  );

  // Postseason in-progress promotes the live game card and a matchups link;
  // the old "Championship race"/"View weekly matchups" narrative chrome was
  // removed in the standings-ownership redesign in favor of the live section.
  assert.match(html, /Live · 1/);
  assert.doesNotMatch(html, /League leader/);
  assert.match(html, /All matchups →/);
});

test('overview panel summary shows season-complete champion, second, and third', () => {
  const postseasonFinal = game({ stage: 'bowl', status: 'final' });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Pruitt',
          wins: 81,
          losses: 39,
          winPct: 0.675,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 120,
        },
        {
          owner: 'Maleski',
          wins: 65,
          losses: 41,
          winPct: 0.613,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 106,
        },
        {
          owner: 'Whited',
          wins: 70,
          losses: 45,
          winPct: 0.609,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 115,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(postseasonFinal, {
          status: 'FINAL',
          away: { team: 'Away', score: 17 },
          home: { team: 'Home', score: 24 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeLabel: 'Postseason', emphasis: 'recent' }}
      displayTimeZone="UTC"
    />
  );

  // A completed season renders the three-card podium: rank-1 is flagged as
  // CHAMPION, with #2 and #3 cards. Each card shows owner and record. The prose
  // "won the title by …" / "Season podium" header were dropped in the redesign.
  assert.match(html, /CHAMPION/);
  assert.match(html, /#1/);
  assert.match(html, /#2/);
  assert.match(html, /#3/);
  assert.match(html, /Pruitt/);
  assert.match(html, /Maleski/);
  assert.match(html, /Whited/);
  assert.match(html, /81–39/);
  assert.match(html, /65–41/);
  assert.match(html, /70–45/);
  assert.doesNotMatch(html, /League leader/);
  assert.ok(html.indexOf('Pruitt') < html.indexOf('Maleski'));
  assert.ok(html.indexOf('Maleski') < html.indexOf('Whited'));
});

// POLISH-011 review round 2: the WIRING, not the helper. Reverting
// OverviewPanel to `{coverageForRender.message}` previously left every test
// green — the helper was pinned in standings.test.ts while the render site that
// exists to use it was not. This renders the panel with the REAL canonical
// partial coverage and asserts the subject-bearing form reaches the markup.
// POLISH-011 round 4 residue (Codex, P3): the `partial/null` case was pinned for
// StandingsPanel only. Reverting `standingsCoverageNoticeWithSubject` to the old
// message-first form would have left every Overview test green, because the
// wiring fixture uses `deriveStandingsCoverage`, which always supplies a message.
// One-surface coverage is this slice's recurring defect; both are pinned now.
test('overview shows the notice for partial coverage even with no stored message', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={{ state: 'partial', message: null }}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
    />
  );

  assert.match(html, /Standings — waiting on complete results/);
});

test('overview names the subject of an incomplete standings notice', () => {
  const partial = deriveStandingsCoverage(
    [game({ key: 'owned-final', status: 'final', csvAway: 'Away', csvHome: 'Home' })],
    new Map([['Away', 'Alex']]),
    {}
  );
  assert.equal(partial.state, 'partial', 'fixture must produce real partial coverage');

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={partial}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
    />
  );

  assert.match(html, /Standings — waiting on complete results/);
  // Negative control: the bare fragment must NOT be what Overview renders, or a
  // revert to `coverage.message` would pass this test.
  assert.equal(
    html.includes('>Waiting on complete results<'),
    false,
    'Overview must not render the subject-less form'
  );
});

test('overview panel summary does not render season-complete framing when standings coverage is partial', () => {
  const postseasonFinal = game({ stage: 'bowl', status: 'final' });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={{ state: 'partial', message: 'Some games are still missing.' }}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(postseasonFinal, {
          status: 'FINAL',
          away: { team: 'Away', score: 10 },
          home: { team: 'Home', score: 14 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeLabel: 'Postseason', emphasis: 'recent' }}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /Final results/);
  assert.doesNotMatch(html, /Champion:/);
  // With partial coverage the completed-season champion podium is suppressed;
  // the coverage message renders in its place.
  assert.doesNotMatch(html, /CHAMPION/);
  // POLISH-011 review round 2: Overview renders the CANONICAL subject-bearing
  // notice for any `partial` state, so a caller-supplied message is normalized
  // rather than echoed. That is deliberate — archived snapshots and warm caches
  // carry older copy, and they should still name their subject. What this test
  // pins is that the notice renders AT ALL in place of the champion podium.
  assert.match(html, /Standings — waiting on complete results/);
});

test('overview panel summary does not render season-complete framing when standings coverage is error', () => {
  const postseasonFinal = game({ stage: 'bowl', status: 'final' });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={{ state: 'error', message: 'Standings load failed.' }}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(postseasonFinal, {
          status: 'FINAL',
          away: { team: 'Away', score: 10 },
          home: { team: 'Home', score: 14 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeLabel: 'Postseason', emphasis: 'recent' }}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /Final results/);
  // With error coverage the completed-season champion podium is suppressed; the
  // error message renders in its place.
  assert.doesNotMatch(html, /CHAMPION/);
  assert.match(html, /Standings load failed\./);
});

test('overview panel keeps league-home ordering with standings and highlights ahead of results', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[item(game({ key: 'next-up' }))]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // Section order after the redesign: hero/podium (leader card) → Standings →
  // Featured games (results) → Upcoming watchlist. Live games, when present,
  // come after the watchlist.
  assert.ok(html.indexOf('Alice') < html.indexOf('Standings'));
  assert.ok(html.indexOf('Standings') < html.indexOf('Featured games'));
  assert.ok(html.indexOf('Featured games') < html.indexOf('Upcoming watchlist'));
  assert.doesNotMatch(html, /League pulse/);
  // The leader is the rank-1 hero card.
  assert.match(html, /#1[\s\S]*?Alice/);
});

test('overview panel keeps standings as the only condensed ranking table', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        ...standingsLeaders,
        {
          owner: 'Bob',
          wins: 3,
          losses: 2,
          winPct: 0.6,
          pointsFor: 110,
          pointsAgainst: 101,
          pointDifferential: 9,
          gamesBack: 1,
          finalGames: 5,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[item(game({ key: 'what-matters' }))]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // Exactly one condensed standings table is rendered (one "Standings" heading).
  const standingsHeaderOccurrences = html.match(/>Standings</g) ?? [];
  assert.equal(standingsHeaderOccurrences.length, 1);
  // POLISH-013 remediation: TWO "Full standings" links now, not one. This
  // fixture supplies owner rows and no history, and per the owner decision
  // (2026-08-23) the GB Race section renders for any league with owners — so its
  // header contributes a second link, exactly as it always did whenever the
  // section was visible. The link count was a proxy for "is GB Race here"; the
  // heading count above is this test's actual subject and is unchanged.
  const fullStandingsLinks = html.match(/Full standings →/g) ?? [];
  assert.equal(fullStandingsLinks.length, 2);
  assert.doesNotMatch(html, /League snapshot/);
  // Standings is positioned ahead of the results (Featured games) section.
  assert.ok(html.indexOf('>Standings<') < html.indexOf('Featured games'));
});

test('overview panel shows watchlist alongside results when highlight cards exist', () => {
  const finals = [1, 2, 3, 4].map((value) =>
    itemWithScore(
      game({
        key: `final-${value}`,
        csvAway: `Final Away ${value}`,
        csvHome: `Final Home ${value}`,
        date: `2026-10-0${value}T16:00:00.000Z`,
      }),
      {
        status: 'Final',
        away: { team: `Final Away ${value}`, score: 24 + value },
        home: { team: `Final Home ${value}`, score: 14 },
        time: null,
      }
    )
  );
  const featuredScheduled = itemWithScore(
    game({
      key: 'scheduled-late',
      csvAway: 'Georgia',
      csvHome: 'Florida',
      date: '2026-10-20T22:00:00.000Z',
    }),
    {
      status: 'Scheduled',
      away: { team: 'Georgia', score: null },
      home: { team: 'Florida', score: null },
      time: null,
    }
  );

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[...finals, featuredScheduled]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // Retargeted: this fixture produces highlight cards, which used to suppress
  // the watchlist. That either/or guarded a highlights section that is no
  // longer rendered, so a slate with upcoming games showed none of them. Both
  // sections must now appear together — the completed games in Featured games,
  // the scheduled one in the watchlist.
  assert.match(html, /Upcoming watchlist/);
  assert.match(html, /Featured games/);
  assert.match(html, /data-scoreboard-state="scheduled"/);
  assert.doesNotMatch(
    html,
    />Scheduled<\/span>/,
    'the Upcoming section and kickoff already communicate scheduled state'
  );
});

test('overview panel renders subtle standings movement indicator when prior standings exist', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 6,
          losses: 2,
          winPct: 0.75,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 8,
          gamesBack: 0,
          finalGames: 8,
        },
        {
          owner: 'Bob',
          wins: 5,
          losses: 3,
          winPct: 0.625,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 5,
          gamesBack: 1,
          finalGames: 8,
        },
      ]}
      standingsHistory={standingsHistoryFromSnapshots([
        {
          week: 1,
          standings: [
            {
              owner: 'Bob',
              wins: 5,
              losses: 3,
              winPct: 0.625,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 5,
              gamesBack: 0,
              finalGames: 8,
            },
            {
              owner: 'Alice',
              wins: 6,
              losses: 2,
              winPct: 0.75,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 8,
              gamesBack: 1,
              finalGames: 8,
            },
          ],
        },
        {
          week: 2,
          standings: [
            {
              owner: 'Alice',
              wins: 6,
              losses: 2,
              winPct: 0.75,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 8,
              gamesBack: 0,
              finalGames: 8,
            },
            {
              owner: 'Bob',
              wins: 5,
              losses: 3,
              winPct: 0.625,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 5,
              gamesBack: 1,
              finalGames: 8,
            },
          ],
        },
      ])}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /↑/);
  assert.match(html, /↓/);
});

test('overview panel uses compact live empty state copy', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // With no live games the live card section is omitted entirely rather than
  // rendering a "No live games" empty card.
  assert.doesNotMatch(html, /Live · /);
  assert.doesNotMatch(html, /Postseason focus/);
  // The standings "Full standings →" link is still present.
  assert.match(html, /Full standings →/);
  assert.doesNotMatch(html, /No featured matchups yet for this slate\./);
});

test('overview panel renders League Trends games back section when history is provided', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsHistory={standingsHistoryFromSnapshots([
        {
          week: 1,
          standings: [
            {
              owner: 'Alice',
              wins: 5,
              losses: 1,
              winPct: 0.833,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 10,
              gamesBack: 0,
              finalGames: 6,
            },
            {
              owner: 'Bob',
              wins: 3,
              losses: 3,
              winPct: 0.5,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 2,
              finalGames: 6,
            },
          ],
        },
        {
          week: 2,
          standings: [
            {
              owner: 'Alice',
              wins: 6,
              losses: 1,
              winPct: 0.857,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 12,
              gamesBack: 0,
              finalGames: 7,
            },
            {
              owner: 'Bob',
              wins: 4,
              losses: 3,
              winPct: 0.571,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 2,
              gamesBack: 2,
              finalGames: 7,
            },
          ],
        },
      ])}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // The games-back trend now renders in the "GB Race" section (MiniTrendsGrid +
  // GbChangeTable), showing each owner with their current games-back figure and
  // per-week columns. The old "League Trends" / "Win %" / "Win Bars" cards were
  // replaced by this compact GB Race treatment.
  assert.match(html, /GB Race/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /0 GB/);
  assert.match(html, /2 GB/);
  assert.match(html, /W1/);
  assert.match(html, /W2/);
});

test('overview panel shows win percent empty-state copy when no resolved standings history exists', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsHistory={{
        weeks: [3],
        byWeek: {
          3: {
            week: 3,
            standings: [],
            coverage: { state: 'partial', message: null },
          },
        },
        byOwner: {
          Alice: [
            {
              week: 3,
              wins: 2,
              losses: 1,
              ties: 0,
              winPct: 0.667,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
            },
          ],
        },
      }}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // POLISH-013 (owner decision, 2026-08-23): the section is no longer omitted.
  // It renders with an explained empty state, so the page does not jump when the
  // first week resolves. What must still NOT appear is the zeroed
  // "Latest: 0.0%" win-percentage trend this test was written for.
  assert.match(html, /GB Race/);
  assert.match(html, TREND_EMPTY_MESSAGE_RE);
  assert.doesNotMatch(html, /Latest: 0\.0%/);
});

test('overview panel shows explicit empty states for featured and results when no shared insights exist', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[]}
      standingsCoverage={coverage}
      matchupMatrix={{ owners: [], rows: [] }}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /No featured matchups yet for this slate\./);
  // No insights surface exists with zero owners; the standings column shows its
  // own empty-state hint instead.
  assert.match(html, /Add owners to populate standings\./);
  assert.doesNotMatch(html, /Open insight/);
  assert.match(html, /No recent results yet\./);
});

test('overview panel keeps featured matchups hidden when none are meaningful for current phase', () => {
  const finalOnly = itemWithScore(game({ key: 'final-only' }), {
    status: 'FINAL',
    away: { team: 'Away', score: 30 },
    home: { team: 'Home', score: 20 },
    time: null,
  });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[finalOnly]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /Featured matchups/);
  // The upcoming watchlist stays hidden when the only matchup is already final;
  // no empty "No featured matchups yet" placeholder is rendered either.
  assert.doesNotMatch(html, /Upcoming watchlist/);
  assert.doesNotMatch(html, /No featured matchups yet for this slate\./);
});

test('overview panel renders shared selector insights instead of league pulse cards', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        ...standingsLeaders,
        {
          owner: 'Bob',
          wins: 3,
          losses: 2,
          winPct: 0.6,
          pointsFor: 110,
          pointsAgainst: 101,
          pointDifferential: 9,
          gamesBack: 1,
          finalGames: 5,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[item(game({ key: 'pulse-game' }))]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /League pulse/);
  assert.match(html, /Tight title race/);
  // Insights render in the dedicated Insights column with a "See all →" link
  // rather than per-card "Open insight" CTAs.
  assert.match(html, />Insights</);
  assert.match(html, /See all →/);
});

test('overview panel renders top 3 shared insights in selector order without duplicates', () => {
  const standingsHistory = standingsHistoryFromSnapshots([
    {
      week: 1,
      standings: [
        {
          owner: 'Alice',
          wins: 2,
          losses: 1,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 6,
          gamesBack: 0,
          finalGames: 3,
        },
        {
          owner: 'Bob',
          wins: 1,
          losses: 2,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -3,
          gamesBack: 1,
          finalGames: 3,
        },
        {
          owner: 'Chris',
          wins: 0,
          losses: 3,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -7,
          gamesBack: 2,
          finalGames: 3,
        },
      ],
    },
    {
      week: 2,
      standings: [
        {
          owner: 'Bob',
          wins: 4,
          losses: 2,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 4,
          gamesBack: 0,
          finalGames: 6,
        },
        {
          owner: 'Alice',
          wins: 3,
          losses: 3,
          winPct: 0.5,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 6,
        },
        {
          owner: 'Chris',
          wins: 1,
          losses: 5,
          winPct: 0.167,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -8,
          gamesBack: 3,
          finalGames: 6,
        },
      ],
    },
    {
      week: 3,
      standings: [
        {
          owner: 'Bob',
          wins: 5,
          losses: 4,
          winPct: 0.556,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 2,
          gamesBack: 0,
          finalGames: 9,
        },
        {
          owner: 'Alice',
          wins: 5,
          losses: 4,
          winPct: 0.556,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 1,
          gamesBack: 0,
          finalGames: 9,
        },
        {
          owner: 'Chris',
          wins: 2,
          losses: 7,
          winPct: 0.222,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -10,
          gamesBack: 3,
          finalGames: 9,
        },
      ],
    },
  ]);

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsHistory.byWeek[3]?.standings ?? []}
      standingsHistory={standingsHistory}
      // PLATFORM-109: the panel no longer derives this from the history it is
      // given; the season context arrives as a prop, so the caller supplies the
      // same value this test already computes for its expectation.
      seasonContext={selectSeasonContext({ standingsHistory })}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // Each rendered insight row carries one category label (the small uppercase
  // eyebrow with letter-spacing:0.08em). Count those to know how many insight
  // rows are on screen — the redesign dropped the per-card "Open insight" CTA.
  const insightRowCount = (html.match(/letter-spacing:0\.08em/g) ?? []).length;
  assert.ok(insightRowCount >= 2 && insightRowCount <= 3);
  const rankedInsights = deriveOverviewInsights(
    deriveLeagueInsights({
      rows: standingsHistory.byWeek[3]?.standings ?? [],
      standingsHistory,
      seasonContext: selectSeasonContext({ standingsHistory }),
    })
  ).slice(0, insightRowCount);
  assert.ok(rankedInsights.length > 0);
  for (const insight of rankedInsights) {
    assert.ok(html.includes(insight.title), `expected insight title "${insight.title}" in markup`);
  }
  if (rankedInsights.length > 1) {
    assert.ok(html.indexOf(rankedInsights[0]!.title) < html.indexOf(rankedInsights[1]!.title));
  }
});

test('overview panel suppresses redundant movement chips in completed-season podium mode', () => {
  const postseasonFinal = game({ key: 'title-game', stage: 'bowl', status: 'final' });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Pruitt',
          wins: 81,
          losses: 39,
          winPct: 0.675,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 120,
        },
        {
          owner: 'Maleski',
          wins: 65,
          losses: 41,
          winPct: 0.613,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 106,
        },
        {
          owner: 'Whited',
          wins: 70,
          losses: 45,
          winPct: 0.609,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 115,
        },
      ]}
      standingsHistory={standingsHistoryFromSnapshots([
        {
          week: 14,
          standings: [
            {
              owner: 'Maleski',
              wins: 65,
              losses: 41,
              winPct: 0.613,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
              finalGames: 106,
            },
            {
              owner: 'Pruitt',
              wins: 81,
              losses: 39,
              winPct: 0.675,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
              finalGames: 120,
            },
            {
              owner: 'Whited',
              wins: 70,
              losses: 45,
              winPct: 0.609,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
              finalGames: 115,
            },
          ],
        },
        {
          week: 15,
          standings: [
            {
              owner: 'Pruitt',
              wins: 81,
              losses: 39,
              winPct: 0.675,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
              finalGames: 120,
            },
            {
              owner: 'Maleski',
              wins: 65,
              losses: 41,
              winPct: 0.613,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
              finalGames: 106,
            },
            {
              owner: 'Whited',
              wins: 70,
              losses: 45,
              winPct: 0.609,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
              finalGames: 115,
            },
          ],
        },
      ])}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(postseasonFinal, {
          status: 'FINAL',
          away: { team: 'Away', score: 24 },
          home: { team: 'Home', score: 17 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeLabel: 'Postseason', emphasis: 'recent' }}
      displayTimeZone="UTC"
    />
  );

  // Completed-season podium mode renders the champion podium and suppresses the
  // redundant week-over-week movement chips ("+N wins" / "Biggest drop:").
  assert.match(html, /CHAMPION/);
  assert.doesNotMatch(html, /\(\+\d+ wins\)|Biggest drop:/);
});

test('overview watchlist prefers Top 25 Matchup and Contender Watch chips over lower categories', () => {
  const rankedCloseTopGame = itemWithScore(
    game({
      key: 'badge-priority',
      csvAway: 'Ohio State',
      csvHome: 'Oregon',
      participants: {
        away: {
          kind: 'team',
          teamId: 'osu',
          displayName: 'Ohio State',
          canonicalName: 'Ohio State',
          rawName: 'Ohio State',
        },
        home: {
          kind: 'team',
          teamId: 'oregon',
          displayName: 'Oregon',
          canonicalName: 'Oregon',
          rawName: 'Oregon',
        },
      },
    }),
    {
      status: 'FINAL',
      away: { team: 'Ohio State', score: 31 },
      home: { team: 'Oregon', score: 24 },
      time: null,
    }
  );
  rankedCloseTopGame.bucket.awayOwner = 'Alice';
  rankedCloseTopGame.bucket.homeOwner = 'Bob';

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 8,
          losses: 1,
          winPct: 0.889,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 9,
        },
        {
          owner: 'Bob',
          wins: 7,
          losses: 2,
          winPct: 0.778,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 9,
        },
        {
          owner: 'Cara',
          wins: 6,
          losses: 3,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
          finalGames: 9,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[rankedCloseTopGame]}
      rankingsByTeamId={
        new Map([
          ['osu', { rank: 6, rankSource: 'ap' }],
          ['oregon', { rank: 11, rankSource: 'ap' }],
        ])
      }
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // After the redesign, a completed ranked game renders in the Featured games
  // section with both teams' rankings inlined on their names (#6 Ohio State,
  // #11 Oregon). Watchlist category chips are not emitted for a final result,
  // so no spurious "Close" chip appears.
  assert.match(html, /#6/);
  assert.match(html, /#11/);
  assert.match(html, /Ohio State/);
  assert.match(html, /Oregon/);
  assert.doesNotMatch(html, />Close</);
});

test('overview highlights consume shared insights instead of matchup-derived headline copy', () => {
  const topMatchup = itemWithScore(
    game({
      key: 'top-matchup-highlight',
      participants: {
        away: {
          kind: 'team',
          teamId: 'away-top',
          displayName: 'Away Top',
          canonicalName: 'Away Top',
          rawName: 'Away Top',
        },
        home: {
          kind: 'team',
          teamId: 'home-top',
          displayName: 'Home Top',
          canonicalName: 'Home Top',
          rawName: 'Home Top',
        },
      },
    }),
    {
      status: 'In Progress',
      away: { team: 'Away Top', score: 17 },
      home: { team: 'Home Top', score: 14 },
      time: '05:55',
    }
  );
  topMatchup.bucket.awayOwner = 'Alice';
  topMatchup.bucket.homeOwner = 'Bob';

  const upsetWatch = itemWithScore(
    game({
      key: 'upset-watch-highlight',
      participants: {
        away: {
          kind: 'team',
          teamId: 'favorite-away',
          displayName: 'Favorite Away',
          canonicalName: 'Favorite Away',
          rawName: 'Favorite Away',
        },
        home: {
          kind: 'team',
          teamId: 'home-underdog',
          displayName: 'Home Underdog',
          canonicalName: 'Home Underdog',
          rawName: 'Home Underdog',
        },
      },
    }),
    {
      status: 'In Progress',
      away: { team: 'Favorite Away', score: 10 },
      home: { team: 'Home Underdog', score: 24 },
      time: '08:41',
    }
  );
  upsetWatch.bucket.awayOwner = 'Casey';
  upsetWatch.bucket.homeOwner = 'Drew';

  const rankedSpotlight = item(
    game({
      key: 'ranked-spotlight-highlight',
      participants: {
        away: {
          kind: 'team',
          teamId: 'ranked-away',
          displayName: 'Ranked Away',
          canonicalName: 'Ranked Away',
          rawName: 'Ranked Away',
        },
        home: {
          kind: 'team',
          teamId: 'unranked-home',
          displayName: 'Unranked Home',
          canonicalName: 'Unranked Home',
          rawName: 'Unranked Home',
        },
      },
    })
  );
  rankedSpotlight.bucket.awayOwner = 'Erin';
  rankedSpotlight.bucket.homeOwner = 'Frank';

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 8,
          losses: 2,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 12,
          gamesBack: 0,
          finalGames: 10,
        },
        {
          owner: 'Bob',
          wins: 8,
          losses: 2,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 10,
          gamesBack: 0,
          finalGames: 10,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[topMatchup, upsetWatch]}
      keyMatchups={[rankedSpotlight, upsetWatch, topMatchup]}
      rankingsByTeamId={
        new Map([
          ['away-top', { rank: 11, rankSource: 'ap' }],
          ['home-top', { rank: 15, rankSource: 'ap' }],
          ['favorite-away', { rank: 20, rankSource: 'ap' }],
          ['ranked-away', { rank: 9, rankSource: 'ap' }],
        ])
      }
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Title race dead heat/);
  assert.match(html, /Alice and Bob are tied for first\./);
  assert.doesNotMatch(html, /Top ranked matchup/);
});

test('overview standings context suppresses leader-gap duplicate messaging when race is not tight', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 10,
          losses: 2,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 12,
        },
        {
          owner: 'Bob',
          wins: 8,
          losses: 4,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
          finalGames: 12,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // A non-tight race (2-game gap) emits no race/leader-gap insight at all, so
  // there is no duplicate "Leader gap" / "Tight race" / dead-heat messaging.
  assert.doesNotMatch(html, /Leader gap:/);
  assert.doesNotMatch(html, /Tight race:/);
  assert.doesNotMatch(html, /Tight title race|dead heat/);
  // The standings still surface both owners' win percentages without any
  // redundant gap narrative.
  assert.match(html, /Win% 0.833/);
  assert.match(html, /Win% 0.667/);
});

test('overview highlights show scope context once at section level', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 6,
          gamesBack: 0,
          finalGames: 5,
        },
        {
          owner: 'Bob',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 4,
          gamesBack: 0,
          finalGames: 5,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(game({ key: 'scope-check' }), {
          status: 'Final',
          away: { team: 'Away Team', score: 35 },
          home: { team: 'Home Team', score: 14 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeDetail: 'Postseason' }}
      displayTimeZone="UTC"
    />
  );

  // The redesigned panel no longer stamps a per-section scope label, so there
  // is no repeated "(this postseason slate)" qualifier on individual cards. The
  // insights section is rendered exactly once.
  assert.doesNotMatch(html, /\(this postseason slate\)/i);
  const insightsHeadings = html.match(/>Insights</g) ?? [];
  assert.equal(insightsHeadings.length, 1);
});

test('overview panel renders League Storylines section when selector emits storylines', () => {
  const standingsHistory = standingsHistoryFromSnapshots([
    {
      week: 1,
      standings: [
        {
          owner: 'Alice',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 10,
          gamesBack: 0,
          finalGames: 5,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 3,
          winPct: 0.4,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -5,
          gamesBack: 2,
          finalGames: 5,
        },
      ],
    },
    {
      week: 2,
      standings: [
        {
          owner: 'Alice',
          wins: 5,
          losses: 1,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 12,
          gamesBack: 0,
          finalGames: 6,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 4,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -6,
          gamesBack: 3,
          finalGames: 6,
        },
      ],
    },
  ]);

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 5,
          losses: 1,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 12,
          gamesBack: 0,
          finalGames: 6,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 4,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -6,
          gamesBack: 3,
          finalGames: 6,
        },
      ]}
      standingsHistory={standingsHistory}
      // PLATFORM-109: the panel no longer derives this from the history it is
      // given; the season context arrives as a prop, so the caller supplies the
      // same value this test already computes for its expectation.
      seasonContext={selectSeasonContext({ standingsHistory })}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // The standalone "League Storylines" section was folded into the Insights
  // surface during the redesign. A championship storyline now renders as a
  // "Champion margin" insight describing the winning margin in games.
  assert.match(html, /Champion margin/);
  assert.match(html, /Alice over Bob by 3 games/);
});

test('overview panel omits League Storylines section when no storylines are available', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // No history → no storyline-derived insights (and no legacy "League
  // Storylines" section, which the redesign removed entirely).
  assert.doesNotMatch(html, /League Storylines/);
  assert.doesNotMatch(html, /Champion margin|Failed chase|Toilet bowl/);
});

test('overview panel renders trends detail link in League Trends section', () => {
  // The trends surface is the "GB Race" section, which renders for any league
  // with owner rows — history or not, resolved or not. Its "Full standings →"
  // link points at the trends view (?view=trends#trends). An earlier version of
  // this comment said the section required resolved standings history, which
  // POLISH-013 made untrue.
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsHistory={standingsHistoryFromSnapshots([
        {
          week: 1,
          standings: [
            {
              owner: 'Alice',
              wins: 5,
              losses: 1,
              winPct: 0.833,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 10,
              gamesBack: 0,
              finalGames: 6,
            },
            {
              owner: 'Bob',
              wins: 3,
              losses: 3,
              winPct: 0.5,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 2,
              finalGames: 6,
            },
          ],
        },
        {
          week: 2,
          standings: [
            {
              owner: 'Alice',
              wins: 6,
              losses: 1,
              winPct: 0.857,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 12,
              gamesBack: 0,
              finalGames: 7,
            },
            {
              owner: 'Bob',
              wins: 4,
              losses: 3,
              winPct: 0.571,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 2,
              gamesBack: 2,
              finalGames: 7,
            },
          ],
        },
      ])}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /GB Race/);
  assert.match(html, /href="\/standings\?view=trends#trends"/);
});

// ---------------------------------------------------------------------------
// PLATFORM-051 / PLATFORM-116 — Overview Top-N standings rows show a
// presentation-only liveDelta pending W–L badge. Current game state decides
// whether it renders; the delta decides what it says. Canonical row values and
// order stay untouched.
// ---------------------------------------------------------------------------

function overviewLiveDelta(
  byOwner: Record<string, { pendingWins: number; pendingLosses: number }>,
  opts: { isStale?: boolean } = {}
): LiveDelta {
  return {
    weekKey: '2026:3',
    generatedAt: '2026-10-01T00:00:00.000Z',
    byGame: {},
    byOwner: Object.fromEntries(
      Object.entries(byOwner).map(([owner, d]) => [
        owner,
        { owner, pendingPointsFor: 0, pendingPointsAgainst: 0, ...d },
      ])
    ),
    isStale: opts.isStale ?? false,
  };
}

const overviewPendingGame = game({
  key: 'overview-pending',
  csvAway: 'Texas',
  csvHome: 'Rice',
});

const overviewPendingScores: Record<string, ScorePack> = {
  'overview-pending': {
    status: 'In Progress',
    away: { team: 'Texas', score: 14 },
    home: { team: 'Rice', score: 10 },
    time: '07:11',
  },
};

const overviewPendingRoster = new Map([
  ['Texas', 'Alice'],
  ['Rice', 'Bob'],
]);

function renderOverview(props: {
  liveDelta?: LiveDelta | null;
  standingsLeaders?: OwnerStandingsRow[];
  games?: AppGame[];
  scoresByKey?: Record<string, ScorePack>;
  rosterByTeam?: Map<string, string>;
}): string {
  return renderToStaticMarkup(
    <OverviewPanel
      games={props.games ?? [overviewPendingGame]}
      scoresByKey={props.scoresByKey ?? overviewPendingScores}
      rosterByTeam={props.rosterByTeam ?? overviewPendingRoster}
      standingsLeaders={props.standingsLeaders ?? standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
      liveDelta={props.liveDelta ?? null}
    />
  );
}

const bob: OwnerStandingsRow = {
  owner: 'Bob',
  wins: 3,
  losses: 2,
  winPct: 0.6,
  pointsFor: 110,
  pointsAgainst: 101,
  pointDifferential: 9,
  gamesBack: 1,
  finalGames: 5,
};

test('overview top-N row shows a fresh pending badge without changing canonical values', () => {
  const html = renderOverview({
    liveDelta: overviewLiveDelta({ Alice: { pendingWins: 1, pendingLosses: 0 } }),
  });

  assert.match(html, /data-overview-live-pending="1-0"/);
  assert.match(html, /Live this week: 1–0/);
  assert.match(html, /\+1–0/);
  // Canonical row values unchanged.
  assert.match(html, /4–1/);
  assert.match(html, /Win% 0\.800/);
  assert.match(html, /Diff \+20/);
});

test('overview top-N badge aggregates multiple live games into one badge', () => {
  const html = renderOverview({
    liveDelta: overviewLiveDelta({ Alice: { pendingWins: 2, pendingLosses: 1 } }),
  });
  const matches = html.match(/data-overview-live-pending/g) ?? [];
  assert.equal(matches.length, 1);
  assert.match(html, /data-overview-live-pending="2-1"/);
});

test('overview top-N badge holds the last-known delta while the current game remains live', () => {
  const html = renderOverview({
    liveDelta: overviewLiveDelta(
      { Alice: { pendingWins: 1, pendingLosses: 0 } },
      { isStale: true }
    ),
  });
  assert.match(html, /data-overview-live-pending="1-0"/);
  assert.match(html, /4–1/);
});

test('overview top-N badge replaces the held delta on the next clean read', () => {
  const stale = renderOverview({
    liveDelta: overviewLiveDelta(
      { Alice: { pendingWins: 1, pendingLosses: 0 } },
      { isStale: true }
    ),
  });
  const refreshed = renderOverview({
    liveDelta: overviewLiveDelta({ Alice: { pendingWins: 0, pendingLosses: 1 } }),
  });

  assert.match(stale, /data-overview-live-pending="1-0"/);
  assert.match(refreshed, /data-overview-live-pending="0-1"/);
  assert.doesNotMatch(refreshed, /data-overview-live-pending="1-0"/);
});

test('overview top-N badge is absent when the delta lacks the rendered row owner', () => {
  const html = renderOverview({
    liveDelta: overviewLiveDelta({ Zoe: { pendingWins: 2, pendingLosses: 0 } }),
  });
  assert.doesNotMatch(html, /data-overview-live-pending/);
});

test('overview top-N badge renders +0–0 for a tied live game', () => {
  const html = renderOverview({
    liveDelta: overviewLiveDelta({ Alice: { pendingWins: 0, pendingLosses: 0 } }),
  });
  assert.match(html, /data-overview-live-pending="0-0"/);
  assert.match(html, /\+0–0/);
});

test('overview top-N badge renders +0–0 when a live score is temporarily unavailable', () => {
  const unavailableScores: Record<string, ScorePack> = {
    'overview-pending': {
      status: 'In Progress',
      away: { team: 'Texas', score: null },
      home: { team: 'Rice', score: null },
      time: 'Start delayed',
    },
  };
  const liveDelta = selectLiveDelta({
    canonical: null,
    scoresByKey: unavailableScores,
    games: [overviewPendingGame],
    rosterByTeam: overviewPendingRoster,
    weekKey: '2026:3',
    lastFetchedAt: '2026-10-01T00:00:00.000Z',
    now: Date.parse('2026-10-01T00:01:00.000Z'),
  });
  const html = renderOverview({ liveDelta, scoresByKey: unavailableScores });

  assert.match(html, /data-overview-live-pending="0-0"/);
  assert.match(html, /\+0–0/);
  assert.doesNotMatch(html, /\d+ live/);
});

test('overview top-N badge clears on final while holding the same stale delta', () => {
  const staleDelta = overviewLiveDelta(
    { Alice: { pendingWins: 1, pendingLosses: 0 } },
    { isStale: true }
  );
  const whileLive = renderOverview({ liveDelta: staleDelta });
  assert.match(
    whileLive,
    /data-overview-live-pending="1-0"/,
    'positive control: the stale delta renders while current game state is live'
  );

  const afterFinal = renderOverview({
    liveDelta: staleDelta,
    scoresByKey: {
      'overview-pending': {
        status: 'Final',
        away: { team: 'Texas', score: 24 },
        home: { team: 'Rice', score: 17 },
        time: null,
      },
    },
  });
  assert.doesNotMatch(afterFinal, /data-overview-live-pending/);
});

test('overview top-N badge never renders for NoClaim', () => {
  const html = renderOverview({
    liveDelta: overviewLiveDelta({ NoClaim: { pendingWins: 3, pendingLosses: 1 } }),
  });
  assert.doesNotMatch(html, /data-overview-live-pending/);
});

test('overview top-N shows no badge when liveDelta is absent', () => {
  const html = renderOverview({ liveDelta: null });
  assert.doesNotMatch(html, /data-overview-live-pending/);
  assert.match(html, /4–1/);
});

test('overview top-N row order is unchanged with and without liveDelta', () => {
  const rows = [standingsLeaders[0]!, bob];
  const without = renderOverview({ standingsLeaders: rows, liveDelta: null });
  const withDelta = renderOverview({
    standingsLeaders: rows,
    liveDelta: overviewLiveDelta({ Bob: { pendingWins: 1, pendingLosses: 0 } }),
  });
  // Alice (rank 1) precedes Bob in both renders.
  for (const html of [without, withDelta]) {
    assert.ok(html.indexOf('Alice') < html.indexOf('Bob'), 'Alice should precede Bob');
  }
});

test('overview podium/hero cards do not receive a live badge (Top-N table only)', () => {
  // Three owners → podium renders all three; a fresh delta for the leader must
  // produce exactly ONE badge (the Top-N table row), not a duplicate on podium.
  const rows = [
    standingsLeaders[0]!,
    bob,
    {
      owner: 'Cara',
      wins: 2,
      losses: 3,
      winPct: 0.4,
      pointsFor: 90,
      pointsAgainst: 110,
      pointDifferential: -20,
      gamesBack: 2,
      finalGames: 5,
    },
  ];
  const html = renderOverview({
    standingsLeaders: rows,
    liveDelta: overviewLiveDelta({ Alice: { pendingWins: 1, pendingLosses: 0 } }),
  });
  const matches = html.match(/data-overview-live-pending/g) ?? [];
  assert.equal(matches.length, 1);
});

// --- PLATFORM-086E1C1: never present a TBD placeholder time as confirmed -----

test('overview panel renders date plus Time TBD instead of the placeholder clock', () => {
  const tbdGame = game({
    csvAway: 'Texas',
    csvHome: 'Ohio State',
    date: '2026-09-01T00:00:00.000Z',
    startTimeTBD: true,
  });

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[item(tbdGame)]}
      keyMatchups={[item(tbdGame)]}
      sectionItems={[item(tbdGame)]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Tue, Sep 1 · Time TBD/);
  assert.doesNotMatch(html, /12:00 AM/);
});

// ---------------------------------------------------------------------------
// POLISH-013 — the GB Race section explains its gap instead of rendering a
// heading over nothing.
//
// `deriveStandingsHistory` builds a cumulative standings table for EVERY week
// regardless of `played`, so in preseason every week carries a full 0-0 table.
// The old section guard asked exactly that question — "does any week carry owner
// rows?" — while both children ask the trend selector, which yields nothing
// until a week resolves. Heading, divider and link over an empty body.
// ---------------------------------------------------------------------------

/** Owners and weeks exist; nothing is played, so nothing resolves. */
function unresolvedHistory(): StandingsHistory {
  const owners = ['Alice', 'Bob'];
  const rows = owners.map((owner) => ({
    owner,
    wins: 0,
    losses: 0,
    ties: 0,
    winPct: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesBack: 0,
    finalGames: 0,
  }));
  const weeks = [1, 2, 3];
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const week of weeks) {
    byWeek[week] = {
      week,
      standings: rows,
      coverage: { state: 'complete', message: null },
      played: false,
      pending: [],
    };
  }
  const byOwner: StandingsHistory['byOwner'] = {};
  for (const owner of owners) {
    byOwner[owner] = weeks.map((week) => ({
      week,
      wins: 0,
      losses: 0,
      ties: 0,
      winPct: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      gamesBack: 0,
    }));
  }
  return { weeks, byWeek, byOwner };
}

function renderOverviewWithHistory(history: StandingsHistory): string {
  return renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsHistory={history}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );
}

/**
 * The GB Race section's own markup.
 *
 * Review found the first version of these tests asserting on `>W1<` across the
 * WHOLE page, which three unrelated producers emit — the condensed standings
 * header, the chart's x-axis, and the GB change table. It could not tell "the
 * chart drew" from "the standings table grew a column", and that is precisely
 * what masked the one-resolved-week gap below.
 */
const TREND_EMPTY_MESSAGE_RE = new RegExp(
  TREND_EMPTY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
);

function gbRaceMarkup(html: string): string {
  const start = html.indexOf('GB Race');
  assert.ok(start >= 0, 'the GB Race section must be present');
  return html.slice(start);
}

test('POLISH-013: GB Race explains the gap when no week has resolved', () => {
  const gbRace = gbRaceMarkup(renderOverviewWithHistory(unresolvedHistory()));

  // The section stays — hiding it makes the page jump when week one resolves.
  assert.match(gbRace, TREND_EMPTY_MESSAGE_RE);
  // And it draws nothing at all: no chart, so no axis. A preseason week axis
  // would reshape once the postseason bracket populates.
  assert.ok(!gbRace.includes('<svg'), 'the empty state must draw no chart');
});

test('POLISH-014: one resolved week DRAWS, from the season origin', () => {
  // POLISH-013 pinned the opposite — that one resolved week could not be drawn
  // and had to keep explaining the gap. That was true of `MiniTrendsGrid`, which
  // draws lines only, and it is what three attempts at point markers tried and
  // failed to work around. The origin makes week one an ordinary two-point
  // segment: every owner starts 0-0 and level, so there is a second endpoint.
  const history = unresolvedHistory();
  history.byWeek[1] = { ...history.byWeek[1]!, played: true };
  history.byOwner.Bob = history.byOwner.Bob!.map((point) =>
    point.week === 1 ? { ...point, gamesBack: 1 } : point
  );

  const gbRace = gbRaceMarkup(renderOverviewWithHistory(history));

  assert.ok(!gbRace.includes(TREND_EMPTY_MESSAGE), 'one resolved week is drawable now');
  assert.ok(gbRace.includes('<svg'), 'the chart must render');
  assert.ok(
    /<path d="M[^"]*L/.test(gbRace),
    'a real line, not the moveto-only path that rendered nothing'
  );
  // The origin is labelled by its LIFECYCLE STATE, not a week number (owner
  // decision, 2026-08-25). "W0" would imply a week, and canonical week 0 is a
  // real value `AppGame.week` can hold.
  assert.ok(gbRace.includes('>Preseason<'), 'the origin is labelled Preseason');
  assert.ok(gbRace.includes('>W1<'), 'the resolved week is labelled');
  assert.ok(!/>W0</.test(gbRace), 'the origin must not be labelled as a week');
});

test('POLISH-013: two resolved weeks draw a line', () => {
  // The control: the same fixture MUST be able to produce a real line, or the
  // assertion above would pass against a section that can never draw at all.
  const history = unresolvedHistory();
  for (const week of [1, 2]) {
    history.byWeek[week] = { ...history.byWeek[week]!, played: true };
  }
  history.byOwner.Bob = history.byOwner.Bob!.map((point) =>
    point.week === 1 ? { ...point, gamesBack: 1 } : point
  );

  const gbRace = gbRaceMarkup(renderOverviewWithHistory(history));

  assert.ok(!gbRace.includes(TREND_EMPTY_MESSAGE), 'two resolved weeks is a trend');
  assert.ok(/<path d="M[^"]*L/.test(gbRace), 'two resolved weeks must draw a line');
});

test('POLISH-013: the section renders for a league with owners but no history at all', () => {
  // `preseason-names` — owners confirmed, no draft yet — has owner rows and a
  // NULL history. Gating on history alone still made the section appear out of
  // nowhere, just at the draft instead of at week one.
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  const gbRace = gbRaceMarkup(html);
  assert.match(gbRace, TREND_EMPTY_MESSAGE_RE);
  assert.ok(!gbRace.includes('<svg'), 'nothing to draw without a history');
});

test('POLISH-013: the section stays hidden for a league with no owners', () => {
  // "Add owners to populate standings" is the real blocker there, and the
  // standings panel above already says so.
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[]}
      standingsCoverage={coverage}
      matchupMatrix={{ owners: [], rows: [] }}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /GB Race/);
});

// ---------------------------------------------------------------------------
// PLATFORM-109 round 3 — the season context prop CHANGES WHAT RENDERS.
//
// I previously left this wire unpinned and wrote a comment justifying it with a
// measurement: that rendering with `in-season` and with `final` produced
// byte-identical markup. That measurement was taken with one fixture that
// happened to emit no context-sensitive insights, and I stated it as a general
// fact. Review disproved it by mutating the prop out of two existing tests in
// this file and watching them fail.
//
// `OverviewPanel` forwards the prop to TWO places, and they are not equivalent:
//
//   1. `sharedInsights` -> `deriveLeagueInsights`, where the champion-margin
//      storyline is gated on `final`. RENDER-OBSERVABLE, and this pins it.
//   2. `viewModel` -> `selectOverviewViewModel`, which puts it on
//      `viewModel.storylines` — a field no surface renders today. Measured, not
//      assumed: deleting that second forwarding fails NO test, including this
//      one. It is genuinely unpinnable at the render level until something
//      renders storylines, and a source scan asserting the call shape would be
//      the speculative proof machinery AGENTS.md forbids. The selector-level
//      override test in `selectors-overview.test.ts` is its guarantee.
// ---------------------------------------------------------------------------

function renderCompletedSeasonOverview(seasonContext: SeasonContext): string {
  const standingsHistory = standingsHistoryFromSnapshots([
    {
      week: 1,
      standings: [
        {
          owner: 'Alice',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 10,
          gamesBack: 0,
          finalGames: 5,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 3,
          winPct: 0.4,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -5,
          gamesBack: 2,
          finalGames: 5,
        },
      ],
    },
    {
      week: 2,
      standings: [
        {
          owner: 'Alice',
          wins: 5,
          losses: 1,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 12,
          gamesBack: 0,
          finalGames: 6,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 4,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -6,
          gamesBack: 3,
          finalGames: 6,
        },
      ],
    },
  ]);

  return renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsHistory.byWeek[2]!.standings.map((row) => ({
        owner: row.owner,
        wins: row.wins,
        losses: row.losses,
        winPct: row.winPct,
        pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst,
        pointDifferential: row.pointDifferential,
        gamesBack: row.gamesBack,
        finalGames: row.finalGames,
      }))}
      standingsHistory={standingsHistory}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
      seasonContext={seasonContext}
    />
  );
}

test('PLATFORM-109: the seasonContext prop is observable in the rendered panel', () => {
  const asFinal = renderCompletedSeasonOverview('final');
  const asInSeason = renderCompletedSeasonOverview('in-season');

  // The discriminating claim: a completed-season storyline appears only when the
  // context says the season is over.
  assert.match(asFinal, /Champion margin/, 'a final season must describe its champion');
  assert.doesNotMatch(asInSeason, /Champion margin/, 'a live season must not describe a champion');
  assert.notEqual(asFinal, asInSeason, 'the prop must change the markup');
});

test('POLISH-014: a recent-week WINDOW draws no origin', () => {
  // Review's P2. GB Race charts the last five RESOLVED weeks, so once a season
  // passes five the window no longer begins at the season's start. Drawing the
  // origin there would put "everyone level" one interval before the first
  // retained week, compressing the whole omitted season into that interval and
  // showing a divergence that never happened.
  const owners = ['Alice', 'Bob'];
  const weeks = [1, 2, 3, 4, 5, 6, 7];
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const week of weeks) {
    byWeek[week] = {
      week,
      standings: owners.map((owner, index) => ({
        owner,
        wins: week,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: index * week,
        finalGames: week,
      })),
      coverage: { state: 'complete', message: null },
      played: true,
      pending: [],
    };
  }
  const byOwner: StandingsHistory['byOwner'] = {};
  owners.forEach((owner, index) => {
    byOwner[owner] = weeks.map((week) => ({
      week,
      wins: week,
      losses: 0,
      ties: 0,
      winPct: 1,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      gamesBack: index * week,
    }));
  });

  const gbRace = gbRaceMarkup(renderOverviewWithHistory({ weeks, byWeek, byOwner }));

  // Scope to the CHART. `gbRaceMarkup` runs to the end of the document, and the
  // GB change table beside the chart emits the same week labels.
  const chart = gbRace.slice(gbRace.indexOf('<svg'), gbRace.indexOf('</svg>'));
  const labels = chart.match(/>W\d+</g) ?? [];
  assert.deepEqual(
    labels,
    ['>W3<', '>W4<', '>W5<', '>W6<', '>W7<'],
    'the last five resolved weeks'
  );
  assert.ok(!chart.includes('>Preseason<'), 'a mid-season window has no preseason column');

  // Each drawn series must have exactly one coordinate per labelled week — a
  // sixth would be the origin, placed one interval before W3.
  const paths = chart.match(/<path d="[^"]*"/g) ?? [];
  assert.ok(paths.length > 0, 'the window must still draw');
  for (const path of paths) {
    const coordinates = (path.match(/[ML]\d/g) ?? []).length;
    assert.equal(coordinates, labels.length, `expected one point per week, got ${path}`);
  }
});

test('POLISH-014: the guard and the chart agree when the origin is withheld', () => {
  // Review's third MEDIUM, and the POLISH-013 empty-box defect returning through
  // a new seam. Weeks 1-2 played with incomplete coverage, week 3 resolved: the
  // FULL history's series carries an origin and looks drawable, while the chart
  // withholds the origin (football was played before W3), sees one point, and
  // draws nothing. If the guard asks the full history it renders a heading, a
  // divider and a link over an empty column.
  const owners = ['Alice', 'Bob'];
  const weeks = [1, 2, 3];
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const week of weeks) {
    byWeek[week] = {
      week,
      standings: owners.map((owner, index) => ({
        owner,
        wins: week,
        losses: 0,
        ties: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: index * week,
        finalGames: week,
      })),
      // Played, but coverage never completed — so unresolved, and invisible to
      // the trend selectors while still being football that happened.
      coverage:
        week === 3 ? { state: 'complete', message: null } : { state: 'partial', message: 'x' },
      played: true,
      pending: [],
    };
  }
  const byOwner: StandingsHistory['byOwner'] = {};
  owners.forEach((owner, index) => {
    byOwner[owner] = weeks.map((week) => ({
      week,
      wins: week,
      losses: 0,
      ties: 0,
      winPct: 1,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      gamesBack: index * week,
    }));
  });

  const gbRace = gbRaceMarkup(renderOverviewWithHistory({ weeks, byWeek, byOwner }));

  assert.match(gbRace, TREND_EMPTY_MESSAGE_RE, 'the section must explain itself, not draw nothing');
  assert.ok(!gbRace.includes('<svg'), 'no empty chart column');
});
