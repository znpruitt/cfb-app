import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../../lib/overview';
import type { AvailableWeeklyRecapViewModel } from '../../lib/recap/composeWeeklyRecap';
import type { AppGame } from '../../lib/schedule';
import type { ScorePack } from '../../lib/scores';
import type { StandingsCoverage } from '../../lib/standings';
import OverviewPanel from '../OverviewPanel';
import RecapTile from '../recap/RecapTile';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
});
(globalThis as { window: Window }).window = dom.window as unknown as Window;
(globalThis as { document: Document }).document = dom.window.document;
(globalThis as { self: Window }).self = dom.window as unknown as Window;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

afterEach(() => cleanup());

const coverage: StandingsCoverage = { state: 'complete', message: null };
const matchupMatrix: OwnerMatchupMatrix = { owners: [], rows: [] };
const context: OverviewContext = {
  scopeDetail: 'Week 1',
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

const EXPANSION_NOW = '2026-09-05T20:00:00.000Z';

function expansionFixtures(): {
  live: OverviewGameItem[];
  finals: OverviewGameItem[];
  watchlist: OverviewGameItem[];
} {
  const live = Array.from({ length: 8 }, (_, index) => {
    const key = `live-${index}`;
    return item(
      game({
        key,
        csvAway: `${key} Away`,
        csvHome: `${key} Home`,
        date: `2026-09-05T${String(12 + index).padStart(2, '0')}:00:00.000Z`,
      }),
      {
        status: 'In Progress',
        away: { team: `${key} Away`, score: index },
        home: { team: `${key} Home`, score: index + 3 },
        time: 'Q2',
      }
    );
  });
  const finals = Array.from({ length: 7 }, (_, index) => {
    const key = `final-${index}`;
    return item(
      game({
        key,
        csvAway: `${key} Away`,
        csvHome: `${key} Home`,
        date: `2026-09-05T${String(4 + index).padStart(2, '0')}:00:00.000Z`,
      }),
      {
        status: 'Final',
        away: { team: `${key} Away`, score: 17 },
        home: { team: `${key} Home`, score: 24 },
        time: null,
      }
    );
  });
  const watchlist = Array.from({ length: 7 }, (_, index) => {
    const key = `watch-${index}`;
    return item(
      game({
        key,
        csvAway: `${key} Away`,
        csvHome: `${key} Home`,
        date: `2026-09-06T${String(12 + index).padStart(2, '0')}:00:00.000Z`,
      })
    );
  });
  return { live, finals, watchlist };
}

function expansionPanel(
  fixtures: ReturnType<typeof expansionFixtures>,
  sectionItems = [...fixtures.live, ...fixtures.finals, ...fixtures.watchlist]
): React.ReactElement {
  return (
    <OverviewPanel
      games={sectionItems.map((entry) => entry.bucket.game)}
      standingsLeaders={[]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={fixtures.watchlist}
      sectionItems={sectionItems}
      nowMs={Date.parse(EXPANSION_NOW)}
      context={context}
      displayTimeZone="UTC"
    />
  );
}

function scoreboardCount(container: HTMLElement, id: string): number {
  return container.querySelectorAll(`#${id} [data-game-scoreboard]`).length;
}

test('Overview bounds each game section independently and exposes every ordered surplus row', () => {
  const fixtures = expansionFixtures();
  const rendered = render(expansionPanel(fixtures));
  const { container, getByRole } = rendered;

  assert.match(container.textContent ?? '', /Live · 8/);
  assert.match(container.textContent ?? '', /Recent finals/);
  assert.match(container.textContent ?? '', /Upcoming watchlist/);
  assert.doesNotMatch(container.textContent ?? '', /Recent finals ·|Upcoming watchlist ·/);
  assert.equal(scoreboardCount(container, 'overview-live-games'), 6);
  assert.equal(scoreboardCount(container, 'overview-recent-finals'), 6);
  assert.equal(scoreboardCount(container, 'overview-watchlist-games'), 6);

  const liveControl = getByRole('button', { name: 'Show all Live games' });
  const finalsControl = getByRole('button', { name: 'Show all Recent finals' });
  const watchlistControl = getByRole('button', { name: 'Show all Upcoming watchlist' });
  assert.equal(liveControl.getAttribute('aria-expanded'), 'false');
  assert.equal(finalsControl.getAttribute('aria-expanded'), 'false');
  assert.equal(watchlistControl.getAttribute('aria-expanded'), 'false');
  assert.equal(liveControl.getAttribute('aria-controls'), 'overview-live-games');
  assert.equal(finalsControl.getAttribute('aria-controls'), 'overview-recent-finals');
  assert.equal(watchlistControl.getAttribute('aria-controls'), 'overview-watchlist-games');

  fireEvent.click(liveControl);
  assert.equal(scoreboardCount(container, 'overview-live-games'), 8);
  assert.equal(scoreboardCount(container, 'overview-recent-finals'), 6);
  assert.equal(scoreboardCount(container, 'overview-watchlist-games'), 6);
  assert.equal(
    getByRole('button', { name: 'Show fewer Live games' }).getAttribute('aria-expanded'),
    'true'
  );

  fireEvent.click(finalsControl);
  fireEvent.click(watchlistControl);
  assert.equal(scoreboardCount(container, 'overview-recent-finals'), 7);
  assert.equal(scoreboardCount(container, 'overview-watchlist-games'), 7);
});

test('Overview expansion survives a content refresh, follows migration, and resets after navigation', () => {
  const fixtures = expansionFixtures();
  const rendered = render(expansionPanel(fixtures));

  fireEvent.click(rendered.getByRole('button', { name: 'Show all Live games' }));
  fireEvent.click(rendered.getByRole('button', { name: 'Show all Recent finals' }));
  fireEvent.click(rendered.getByRole('button', { name: 'Show all Upcoming watchlist' }));

  const migratingGame = fixtures.live[0]!.bucket.game;
  const migratedFinal = item(migratingGame, {
    status: 'Final',
    away: { team: migratingGame.csvAway, score: 21 },
    home: { team: migratingGame.csvHome, score: 24 },
    time: null,
  });
  const refreshedItems = [
    migratedFinal,
    ...fixtures.live.slice(1),
    ...fixtures.finals,
    ...fixtures.watchlist,
  ];

  // `router.refresh()` reconciles this same unkeyed client component instance. A rerender
  // with new server-derived props exercises the state property this feature relies on:
  // all three disclosures stay open while their selector-owned contents change beneath them.
  rendered.rerender(expansionPanel(fixtures, refreshedItems));

  assert.equal(scoreboardCount(rendered.container, 'overview-live-games'), 7);
  assert.equal(scoreboardCount(rendered.container, 'overview-recent-finals'), 8);
  assert.equal(scoreboardCount(rendered.container, 'overview-watchlist-games'), 7);
  assert.equal(
    rendered.getByRole('button', { name: 'Show fewer Live games' }).getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(
    rendered
      .getByRole('button', { name: 'Show fewer Recent finals' })
      .getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(
    rendered
      .getByRole('button', { name: 'Show fewer Upcoming watchlist' })
      .getAttribute('aria-expanded'),
    'true'
  );
  assert.equal(
    rendered.container.querySelectorAll(
      '#overview-live-games [aria-label="live-0 Away at live-0 Home"]'
    ).length,
    0,
    'the finalising game must leave Live immediately'
  );
  assert.equal(
    rendered.container.querySelectorAll(
      '#overview-recent-finals [aria-label="live-0 Away at live-0 Home"]'
    ).length,
    1,
    'the same non-Featured game must enter Recent finals immediately'
  );

  // CFBScheduleApp renders OverviewPanel only while Overview is active. Replacing it
  // models leaving that conditional branch; returning mounts a fresh bounded default.
  rendered.rerender(<div>Matchups</div>);
  rendered.rerender(expansionPanel(fixtures, refreshedItems));

  assert.equal(scoreboardCount(rendered.container, 'overview-live-games'), 6);
  assert.equal(scoreboardCount(rendered.container, 'overview-recent-finals'), 6);
  assert.equal(scoreboardCount(rendered.container, 'overview-watchlist-games'), 6);
  assert.equal(
    rendered.getByRole('button', { name: 'Show all Live games' }).getAttribute('aria-expanded'),
    'false'
  );
  assert.equal(
    rendered.getByRole('button', { name: 'Show all Recent finals' }).getAttribute('aria-expanded'),
    'false'
  );
  assert.equal(
    rendered
      .getByRole('button', { name: 'Show all Upcoming watchlist' })
      .getAttribute('aria-expanded'),
    'false'
  );
});

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
  assert.doesNotMatch(html, /aria-label="Show all Live games"/);
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

test('overview sections render Featured, Live, Recent finals, then the watchlist', () => {
  // Owner decision 2026-09-03, recorded in
  // docs/campaigns/item-87-followon-section-ordering.md: ordered by temporal
  // distance from now — happening, just happened, coming up. Live sits above the
  // watchlist because it is the only content with a deadline.
  const featured = item(
    game({ key: 'featured-final', csvAway: 'Ohio State', date: '2026-09-05T16:00:00.000Z' }),
    {
      status: 'Final',
      away: { team: 'Ohio State', score: 28 },
      home: { team: 'Home', score: 14 },
      time: null,
    }
  );
  const live = item(game({ key: 'live-now', date: '2026-09-05T20:00:00.000Z' }));
  const recentFinal = item(game({ key: 'plain-final', date: '2026-09-05T18:00:00.000Z' }), {
    status: 'Final',
    away: { team: 'Away', score: 21 },
    home: { team: 'Home', score: 24 },
    time: null,
  });
  const upcoming = item(game({ key: 'later-game', date: '2026-09-06T20:00:00.000Z' }));

  const html = renderPanel({
    games: [featured, live, recentFinal, upcoming].map((entry) => entry.bucket.game),
    // A watchlist row needs BOTH: keyMatchups supplies the candidate, sectionItems
    // supplies the route it is matched against (overviewGameSections.ts:184).
    sectionItems: [live, recentFinal, upcoming],
    keyMatchups: [featured, upcoming],
    now: '2026-09-05T21:00:00.000Z',
  });

  const featuredAt = html.indexOf('>Featured games</h2>');
  const liveAt = html.indexOf('>Live · 1</h2>');
  const finalsAt = html.indexOf('>Recent finals</h2>');
  const watchlistAt = html.indexOf('>Upcoming watchlist</h2>');

  // Positive control: assert every section is actually present before ordering
  // them. Four -1 indices would satisfy a naive ordering assertion.
  assert.notEqual(featuredAt, -1, 'Featured games must render');
  assert.notEqual(liveAt, -1, 'Live must render');
  assert.notEqual(finalsAt, -1, 'Recent finals must render');
  assert.notEqual(watchlistAt, -1, 'Upcoming watchlist must render');

  assert.ok(featuredAt < liveAt, 'Featured must precede Live');
  assert.ok(liveAt < finalsAt, 'Live must precede Recent finals');
  assert.ok(finalsAt < watchlistAt, 'Recent finals must precede the watchlist');
});

test('empty promotion sections hide without placeholder rows', () => {
  const html = renderPanel({ games: [], sectionItems: [], now: '2026-09-01T17:30:00.000Z' });

  assert.doesNotMatch(html, /Upcoming watchlist/);
  assert.doesNotMatch(html, /Live ·/);
  assert.doesNotMatch(html, /Recent finals/);
});
