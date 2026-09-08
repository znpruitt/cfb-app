/**
 * PLATFORM-153 — the eyebrow treatment is ONE treatment.
 *
 * Overview, Schedule and Matchups each render eyebrow tags. Before this slice they
 * rendered three different things: Overview a neutral gray pill beside a blue reason
 * label, Schedule a 1px bronze border at 10px, Matchups a 0.5px bronze border at 12px.
 * Two of those drifted apart purely because each surface held its own string literal.
 *
 * These tests assert across surfaces rather than per surface. A test that checks each
 * panel against a literal it also owns cannot catch the next divergence; a test that
 * compares the three rendered results to each other can.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import Breadcrumbs from '../navigation/Breadcrumbs';
import GameWeekPanel from '../GameWeekPanel';
import MatchupsWeekPanel from '../MatchupsWeekPanel';
import OverviewPanelImpl from '../OverviewPanel';
import { EYEBROW_REASON_CLASSES, EYEBROW_TAG_CLASSES } from '../../lib/gameUi';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../../lib/overview';
import type { AppGame } from '../../lib/schedule';
import type { OwnerStandingsRow, StandingsCoverage } from '../../lib/standings';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? overrides.key ?? 'g',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 0,
    eventKey: overrides.eventKey ?? overrides.key ?? 'g',
    label: overrides.label ?? null,
    notes: overrides.notes ?? null,
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
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.canHome ?? overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.canAway ?? overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    awayClassification: overrides.awayClassification,
    homeClassification: overrides.homeClassification,
    sources: overrides.sources,
    startTimeTBD: overrides.startTimeTBD,
    media: overrides.media,
  };
}

const rankedTeams = new Map([
  ['a', { rank: 3, rankSource: 'ap' as const }],
  ['h', { rank: 9, rankSource: 'ap' as const }],
]);

function renderSchedule(): string {
  return renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'sched', csvAway: 'Away Team', csvHome: 'Home Team' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={rankedTeams}
    />
  );
}

function renderMatchups(): string {
  return renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'matchup', csvAway: 'Alabama', csvHome: 'Georgia' })]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Alabama', 'Alice'],
          ['Georgia', 'Bob'],
        ])
      }
      rankingsByTeamId={rankedTeams}
      displayTimeZone="UTC"
    />
  );
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
const context: OverviewContext = { scopeDetail: 'Week 1' };
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

function overviewItem(gameValue: AppGame): OverviewGameItem {
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

/**
 * A conference-championship game exercises `deriveFeaturedGameBadge`'s second
 * branch — the one that used to return blue — while the scheduled ranked matchup
 * exercises the watchlist reason row and its tag pills.
 */
function renderOverview(): string {
  const watchlistGame = game({ key: 'ov-a-watch', csvAway: 'Away', csvHome: 'Home' });
  const finalGame = game({
    key: 'ov-z-final',
    csvAway: 'Away',
    csvHome: 'Home',
    postseasonRole: 'conference_championship',
    conference: 'SEC',
  });
  const items = [
    overviewItem(watchlistGame),
    {
      ...overviewItem(finalGame),
      score: {
        status: 'final',
        time: 'Final',
        away: { team: 'Away', score: 31 },
        home: { team: 'Home', score: 17 },
      },
    },
  ];

  return renderToStaticMarkup(
    <OverviewPanelImpl
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={items}
      sectionItems={items}
      nowMs={Date.parse('2026-09-01T16:30:00.000Z')}
      context={context}
      displayTimeZone="UTC"
      rankingsByTeamId={rankedTeams}
    />
  );
}

/**
 * Display and flex utilities are the caller's, not the treatment's: Matchups hides
 * its secondary tags below `sm`, which a display class baked into the shared constant
 * would fight. Everything else on an eyebrow must come from the constant.
 */
const LAYOUT_ONLY_CLASSES = new Set(['inline-flex', 'hidden', 'sm:inline-flex', 'shrink-0']);

function eyebrowTags(html: string): string[] {
  return Array.from(
    html.matchAll(/<span(?=[^>]*\sdata-eyebrow-tag)[^>]*\sclass="([^"]*)"[^>]*>/g),
    (match) => match[1] ?? ''
  );
}

function treatmentOf(classAttr: string): string {
  const residual = classAttr
    .split(/\s+/)
    .filter((token) => token.length > 0 && !LAYOUT_ONLY_CLASSES.has(token));
  return residual.join(' ');
}

test('every eyebrow across Overview, Schedule and Matchups renders one identical treatment', () => {
  const bySurface = {
    Overview: eyebrowTags(renderOverview()),
    Schedule: eyebrowTags(renderSchedule()),
    Matchups: eyebrowTags(renderMatchups()),
  };

  for (const [surface, tags] of Object.entries(bySurface)) {
    assert.ok(tags.length > 0, `${surface} fixture must render at least one eyebrow tag`);
  }

  const treatments = new Set(
    Object.values(bySurface)
      .flat()
      .map((classAttr) => treatmentOf(classAttr))
  );

  // One entry means all three surfaces agree. Comparing them to each other is the
  // assertion that catches a fourth spelling; comparing each to a literal is not.
  assert.equal(
    treatments.size,
    1,
    `eyebrow treatments diverged across surfaces: ${JSON.stringify([...treatments], null, 2)}`
  );
  assert.equal([...treatments][0], EYEBROW_TAG_CLASSES);
});

test('no eyebrow on any surface renders blue', () => {
  const overview = renderOverview();
  const surfaces = [overview, renderSchedule(), renderMatchups()];

  for (const html of surfaces) {
    const tags = eyebrowTags(html);
    assert.ok(tags.length > 0, 'fixture must render at least one eyebrow tag');
    for (const classAttr of tags) {
      assert.doesNotMatch(classAttr, /blue/, `eyebrow still blue: ${classAttr}`);
    }
  }

  // Overview's two non-pill eyebrow elements, addressed as elements rather than by
  // their label text — a test keyed on a label has shipped in this campaign before.
  const reasonLabel = overview.match(/<span(?=[^>]*\sdata-watchlist-reason-label)[^>]*>/)?.[0];
  assert.ok(reasonLabel, 'the watchlist reason label must render');
  assert.doesNotMatch(reasonLabel, /blue/);
  assert.ok(reasonLabel.includes(EYEBROW_REASON_CLASSES));

  const featuredBadge = overview.match(/<span(?=[^>]*\sdata-featured-game-badge)[^>]*>/)?.[0];
  assert.ok(featuredBadge, 'the featured conference-championship badge must render');
  assert.doesNotMatch(featuredBadge, /blue/);
  // Slate, matching the CFP branch of the same badge family — see OverviewPanel.
  assert.match(featuredBadge, /slate/);
});

test('the shared constant is the only bronze in any surface that renders an eyebrow', () => {
  const surfaces = [
    'src/components/OverviewPanel.tsx',
    'src/components/GameWeekPanel.tsx',
    'src/components/MatchupsWeekPanel.tsx',
  ];

  for (const path of surfaces) {
    const source = readFileSync(path, 'utf8');
    // A future fourth consumer cannot add its own literal silently: the bronze values
    // exist in exactly one file, and this fails the moment one is pasted back.
    assert.doesNotMatch(source, /#c9a66b/i, `${path} must not carry its own bronze literal`);
    assert.doesNotMatch(source, /#dbc190/i, `${path} must not carry its own bronze literal`);
    assert.doesNotMatch(source, /201\s*,\s*166\s*,\s*107/, `${path} must not carry its own bronze`);
  }
});

test('interactive blue survives the eyebrow conversion', () => {
  // `DESIGN.md` → *Color*: blue is CORRECT for interactivity and active state. The
  // conversion must not reach a link or a selection ring. Mutate any one of these
  // blues to bronze and this test goes red.
  const breadcrumbs = renderToStaticMarkup(
    <Breadcrumbs segments={[{ label: 'League', href: '/league/test' }, { label: 'Schedule' }]} />
  );
  const link = breadcrumbs.match(/<a[^>]*>/)?.[0];
  assert.ok(link, 'a breadcrumb link must render');
  assert.match(link, /text-blue-600/, 'breadcrumb links stay interactive blue');
  assert.match(link, /dark:text-blue-400/);

  const scheduleFocused = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'sched', csvAway: 'Away Team', csvHome: 'Home Team' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      focusedGameId="sched"
    />
  );
  assert.match(scheduleFocused, /ring-blue-500/, 'the focused-card ring stays active-state blue');
});
