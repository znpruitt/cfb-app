import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../../lib/overview';
import type { AvailableWeeklyRecapViewModel } from '../../lib/recap/composeWeeklyRecap';
import type { AppGame } from '../../lib/schedule';
import type { ScorePack } from '../../lib/scores';
import type { StandingsCoverage } from '../../lib/standings';
import OverviewPanel from '../OverviewPanel';
import RecapTile from '../recap/RecapTile';

const coverage: StandingsCoverage = { state: 'complete', message: null };
const matchupMatrix: OwnerMatchupMatrix = { owners: [], rows: [] };
const context: OverviewContext = {
  scopeLabel: 'League',
  scopeDetail: 'Week 1',
  emphasis: 'upcoming',
  highlightsTitle: 'Featured games',
  highlightsDescription: '',
  liveDescription: '',
  sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
};

function game(overrides: Partial<AppGame> = {}): AppGame {
  const key = overrides.key ?? 'game';
  return {
    key,
    eventId: overrides.eventId ?? key,
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    rawStatus: overrides.rawStatus,
    completed: overrides.completed,
    startTimeTBD: overrides.startTimeTBD,
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? key,
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
      away: {
        kind: 'team',
        teamId: key + '-away',
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
      home: {
        kind: 'team',
        teamId: key + '-home',
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
    sources: overrides.sources,
  };
}

function item(gameValue: AppGame, score?: ScorePack): OverviewGameItem {
  return {
    bucket: {
      game: gameValue,
      awayOwner: 'Alice',
      homeOwner: 'Bob',
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    score,
    priority: 2,
    sortDate: gameValue.date ? Date.parse(gameValue.date) : Number.POSITIVE_INFINITY,
  };
}

function renderPanel(args: {
  games: AppGame[];
  sectionItems: OverviewGameItem[];
  now: string;
  keyMatchups?: OverviewGameItem[];
}): string {
  return renderToStaticMarkup(
    <OverviewPanel
      games={args.games}
      standingsLeaders={[]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={args.keyMatchups ?? []}
      sectionItems={args.sectionItems}
      nowMs={Date.parse(args.now)}
      context={context}
      displayTimeZone="UTC"
    />
  );
}

test('Awaiting score renders neutrally inside the Live section without claiming the game is live', () => {
  const awaiting = item(game({ key: 'awaiting-score' }));
  const html = renderPanel({
    games: [awaiting.bucket.game],
    sectionItems: [awaiting],
    now: '2026-09-01T17:30:00.000Z',
  });
  const scoreboard = html.match(
    /<article(?=[^>]*aria-label="Away at Home")[\s\S]*?<\/article>/
  )?.[0];

  assert.match(html, /Live · 1/);
  assert.ok(scoreboard, 'the awaiting-score game must remain visible in the Live section');
  assert.match(scoreboard, /data-scoreboard-state="awaiting"/);
  assert.match(scoreboard, /data-scoreboard-header[^>]*>[\s\S]*>Awaiting score<\/span>/);
  assert.doesNotMatch(scoreboard, />Live<\/span>|dark:text-emerald-400|rounded-full bg-current/);
  assert.doesNotMatch(scoreboard, />Scheduled<\/span>/);
});

test('Recent finals renders score anchors and no records join', () => {
  const final = item(game({ key: 'recent-final', date: '2026-09-05T20:00:00.000Z' }), {
    status: 'Final',
    away: { team: 'Away', score: 21 },
    home: { team: 'Home', score: 24 },
    time: null,
  });
  const html = renderPanel({
    games: [final.bucket.game],
    sectionItems: [final],
    now: '2026-09-05T21:00:00.000Z',
  });

  assert.match(html, /Recent finals/);
  assert.match(html, /data-scoreboard-state="final"/);
  assert.match(html, /data-scoreboard-value="away">21</);
  assert.match(html, /data-scoreboard-value="home">24</);
  assert.doesNotMatch(html, /\(\d+[–-]\d+\)/);
});

test('a narrated recap game remains present in the complete Recent finals listing', () => {
  const final = item(
    game({
      key: 'recent-final',
      csvAway: 'Texas',
      csvHome: 'Georgia',
      date: '2026-09-05T20:00:00.000Z',
    }),
    {
      status: 'Final',
      away: { team: 'Texas', score: 31 },
      home: { team: 'Georgia', score: 17 },
      time: null,
    }
  );
  const recap: AvailableWeeklyRecapViewModel = {
    status: 'available',
    week: 1,
    weekLabel: 'Week 1',
    latestGameDate: '2026-09-05',
    headline: 'Alice takes the week',
    isIncomplete: false,
    ownerLines: [{ owner: 'Alice', recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' }],
    leaderLines: [],
    tileLeaderLines: [],
    movementLines: [],
    recordChangeLines: [],
    headToHeadLines: [],
    notableResultLines: [],
    tileHighlights: [
      {
        kind: 'game',
        id: 'recent-final',
        label: 'Notable result',
        detail: 'Texas beat Georgia',
        winner: { team: 'Texas', owner: 'Alice', score: '31' },
        loser: { team: 'Georgia', owner: 'Bob', score: '17' },
      },
    ],
  };
  const html = renderToStaticMarkup(
    <>
      <RecapTile recap={recap} />
      <OverviewPanel
        games={[final.bucket.game]}
        standingsLeaders={[]}
        standingsCoverage={coverage}
        matchupMatrix={matchupMatrix}
        liveItems={[]}
        keyMatchups={[]}
        sectionItems={[final]}
        nowMs={Date.parse('2026-09-05T21:00:00.000Z')}
        context={context}
        displayTimeZone="UTC"
      />
    </>
  );

  assert.match(html, /Alice takes the week/);
  assert.match(html, /Recent finals/);
  assert.match(html, /data-scoreboard-state="final"/);
  assert.match(html, /data-scoreboard-value="away">31</);
  assert.match(html, /data-scoreboard-value="home">17</);
});

test('a populated Recent finals list does not render a contradictory Featured empty state', () => {
  const final = item(game({ key: 'unfeatured-final', date: '2026-09-05T20:00:00.000Z' }), {
    status: 'Final',
    away: { team: 'Away', score: 21 },
    home: { team: 'Home', score: 24 },
    time: null,
  });
  const html = renderPanel({
    games: [final.bucket.game],
    sectionItems: [final],
    now: '2026-09-05T21:00:00.000Z',
  });

  assert.match(html, /Recent finals/);
  assert.doesNotMatch(html, /No recent results yet\./);
});

test('an incomplete Featured final stays in Live with Awaiting score until both scores attach', () => {
  const incompleteFinal = item(game({ key: 'featured-score-gap' }), {
    status: 'Final',
    away: { team: 'Away', score: 21 },
    home: { team: 'Home', score: null },
    time: null,
  });
  const html = renderPanel({
    games: [incompleteFinal.bucket.game],
    sectionItems: [incompleteFinal],
    keyMatchups: [incompleteFinal],
    now: '2026-09-01T17:30:00.000Z',
  });

  assert.match(html, /Live · 1/);
  assert.match(html, /Awaiting score/);
  assert.doesNotMatch(html, /data-featured-scoreboard-grid/);
  assert.doesNotMatch(html, /data-scoreboard-state="final"/);
});

test('empty promotion sections hide without placeholder rows', () => {
  const html = renderPanel({ games: [], sectionItems: [], now: '2026-09-01T17:30:00.000Z' });

  assert.doesNotMatch(html, /Upcoming watchlist/);
  assert.doesNotMatch(html, /Live ·/);
  assert.doesNotMatch(html, /Recent finals/);
});
