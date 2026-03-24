import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppGame } from '../../lib/schedule';
import { deriveOwnerWeekSlates } from '../../lib/matchups';
import MatchupsWeekPanel from '../MatchupsWeekPanel';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? overrides.key ?? 'g',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2025-08-30T20:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 0,
    eventKey: overrides.eventKey ?? overrides.key ?? 'g',
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
    homeConf: overrides.homeConf ?? 'SEC',
    sources: overrides.sources,
  };
}

test('matchups panel renders owner-centric cards and duplicates owner-vs-owner game into both slates', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({ key: 'g1', csvAway: 'Alabama', csvHome: 'Georgia' }),
        game({ key: 'g2', csvAway: 'Alabama', csvHome: 'Akron', homeConf: 'MAC' }),
      ]}
      oddsByKey={{
        g1: {
          favorite: 'Georgia',
          spread: -3.5,
          homeSpread: -3.5,
          awaySpread: 3.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: 51.5,
          mlHome: -150,
          mlAway: 130,
          overPrice: -108,
          underPrice: -112,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2025-08-30T18:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{
        g1: {
          status: 'in progress',
          time: '05:00',
          home: { team: 'Georgia', score: 17 },
          away: { team: 'Alabama', score: 24 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Alabama', 'Alice'],
          ['Georgia', 'Bob'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Weekly Slates/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /0–0 · 1 live/);
  assert.match(html, /2 games · vs Bob, NoClaim \(FBS\)/);
  assert.match(html, /vs Bob/);
  assert.match(html, /NoClaim \(FBS\)/);
  assert.match(html, /Alabama[\s\S]*24[\s\S]*–[\s\S]*17[\s\S]*Georgia/);
  assert.match(html, /05:00/);
  assert.doesNotMatch(html, /Leading 24-17/);
  assert.doesNotMatch(html, /Trailing 24-17/);
  assert.doesNotMatch(
    html,
    /Kickoff Sat, Aug 30, 4:00 PM<\/span><span>•<\/span><span>Georgia -3.5/
  );
  assert.match(html, /rounded-xl border p-4 shadow-sm sm:p-5 border-amber-300\/70 bg-amber-500\/5/);
  assert.doesNotMatch(html, /border-l-4 border-l-emerald-600 bg-emerald-50 text-gray-900/);
  assert.doesNotMatch(html, /Faces Bob/);
  assert.doesNotMatch(html, /vs owner Bob/);
  assert.doesNotMatch(html, /Unowned \/ Non-league/);
});

test('matchups panel keeps scheduled fallback zero-zero scores out of tie messaging', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g-scheduled', csvAway: 'Florida', csvHome: 'LSU' })]}
      oddsByKey={{}}
      scoresByKey={{
        'g-scheduled': {
          status: 'scheduled',
          time: 'Sat 7:00 PM',
          home: { team: 'LSU', score: 0 },
          away: { team: 'Florida', score: 0 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Florida', 'Dana'],
          ['LSU', 'Evan'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Scheduled/);
  assert.doesNotMatch(html, /Tied 0-0/);
});

test('matchups panel omits unowned-vs-unowned from owner cards and summarizes exclusion', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g3', csvAway: 'UCLA', csvHome: 'USC' })]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /No surname-relevant games for this week/);
  assert.match(html, /Excluded games/);
  assert.match(html, /1 excluded game/);
});

test('matchups panel summarizes self-matchups as Self', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g-self', csvAway: 'Texas', csvHome: 'Oklahoma' })]}
      oddsByKey={{}}
      scoresByKey={{
        'g-self': {
          status: 'final',
          time: 'Final',
          home: { team: 'Oklahoma', score: 21 },
          away: { team: 'Texas', score: 28 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Texas', 'Alex'],
          ['Oklahoma', 'Alex'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Alex/);
  assert.match(html, /2 games/);
  assert.match(html, /1–1/);
  assert.match(html, /2 games · vs Self \(x2\)/);
  assert.match(html, /Texas[\s\S]*28[\s\S]*–[\s\S]*21[\s\S]*Oklahoma/);
  assert.match(html, /border-l-violet-400\/80 bg-violet-50\/40/);
  assert.doesNotMatch(html, /Leading 28-21/);
  assert.doesNotMatch(html, /Trailing 28-21/);
  assert.equal((html.match(/Texas/g) ?? []).length, 2);
  assert.doesNotMatch(html, /1 game · vs Self/);
});

test('matchups panel keeps status text non-redundant for completed games', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g-final-clean', csvAway: 'Iowa', csvHome: 'Nebraska' })]}
      oddsByKey={{}}
      scoresByKey={{
        'g-final-clean': {
          status: 'Final',
          time: 'Final',
          home: { team: 'Nebraska', score: 24 },
          away: { team: 'Iowa', score: 31 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Iowa', 'Lane'],
          ['Nebraska', 'Mira'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.equal((html.match(/>Final</g) ?? []).length, 2);
  assert.doesNotMatch(html, /Final: /);
  assert.doesNotMatch(html, /Kickoff /);
  assert.match(html, /Iowa[\s\S]*31[\s\S]*–[\s\S]*24[\s\S]*Nebraska/);
});

test('scheduled rows keep matchup primary and score out of metadata', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g-sched-row', csvAway: 'Rutgers', csvHome: 'Maryland' })]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Rutgers', 'Nia'],
          ['Maryland', 'Omar'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(
    html,
    /Rutgers<\/span><span class="text-gray-400 dark:text-zinc-500">@<\/span><span class="font-medium">Maryland/
  );
  assert.match(html, /Kickoff Sat, Aug 30, 4:00 PM/);
  assert.doesNotMatch(html, /tabular-nums">0</);
});

test('scheduled neutral rows use vs separator instead of @', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({ key: 'g-sched-neutral', csvAway: 'Texas', csvHome: 'Ohio State', neutral: true }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Texas', 'Uma'],
          ['Ohio State', 'Vic'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(
    html,
    /Texas<\/span><span class="text-gray-400 dark:text-zinc-500">vs<\/span><span class="font-medium">Ohio State/
  );
  assert.doesNotMatch(
    html,
    /Texas<\/span><span class="text-gray-400 dark:text-zinc-500">@<\/span><span class="font-medium">Ohio State/
  );
  assert.match(html, /Neutral site/);
});

test('long-name live rows keep canonical ordering with inline scoreline', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'g-long-live',
          csvAway: 'Very Long Away Team Name University',
          csvHome: 'Extremely Long Home Team Name College',
          neutral: true,
        }),
      ]}
      oddsByKey={{}}
      scoresByKey={{
        'g-long-live': {
          status: 'in progress',
          time: 'Q3 8:14',
          home: { team: 'Extremely Long Home Team Name College', score: 17 },
          away: { team: 'Very Long Away Team Name University', score: 21 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Very Long Away Team Name University', 'Pat'],
          ['Extremely Long Home Team Name College', 'Rin'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(
    html,
    /Very Long Away Team Name University<\/span><span class="inline-flex min-w-\[2ch\] justify-end font-semibold tabular-nums">21<\/span><span class="text-gray-400 dark:text-zinc-500">–<\/span><span class="inline-flex min-w-\[2ch\] justify-start font-semibold tabular-nums">17<\/span><span class="font-medium">Extremely Long Home Team Name College/
  );
  assert.match(html, /Q3 8:14/);
  assert.match(html, /Neutral site/);
});

test('live rows do not render ISO kickoff timestamps as live clock metadata', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g-live-iso', csvAway: 'Utah', csvHome: 'Arizona' })]}
      oddsByKey={{}}
      scoresByKey={{
        'g-live-iso': {
          status: 'in progress',
          time: '2026-09-12T23:00:00.000Z',
          home: { team: 'Arizona', score: 17 },
          away: { team: 'Utah', score: 21 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Utah', 'Kai'],
          ['Arizona', 'Lee'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Utah[\s\S]*21[\s\S]*–[\s\S]*17[\s\S]*Arizona/);
  assert.match(html, /vs Lee/);
  assert.match(html, /Sat, Aug 30, 4:00 PM/);
  assert.doesNotMatch(html, /2026-09-12T23:00:00.000Z/);
});

test('live rows still render real in-game clock values', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g-live-clock', csvAway: 'Auburn', csvHome: 'Ole Miss' })]}
      oddsByKey={{}}
      scoresByKey={{
        'g-live-clock': {
          status: 'in progress',
          time: 'Q3 8:14',
          home: { team: 'Ole Miss', score: 24 },
          away: { team: 'Auburn', score: 20 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Auburn', 'Moe'],
          ['Ole Miss', 'Ned'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Q3 8:14/);
  assert.match(html, /vs Ned/);
});

test('owner slates count final owned-vs-owned, NoClaim, and FCS results from owned-team participations', () => {
  const games = [
    game({ key: 'g-owned', csvAway: 'Alabama', csvHome: 'Georgia' }),
    game({ key: 'g-noclaim', csvAway: 'Florida State', csvHome: 'Tulane', homeConf: 'AAC' }),
    game({ key: 'g-fcs', csvAway: 'Kansas State', csvHome: 'North Dakota', homeConf: 'FCS' }),
  ];
  const rosterByTeam = new Map([
    ['Alabama', 'Avery'],
    ['Georgia', 'Blair'],
    ['Florida State', 'Avery'],
    ['Kansas State', 'Avery'],
  ]);
  const scoresByKey = {
    'g-owned': {
      status: 'final',
      time: 'Final',
      home: { team: 'Georgia', score: 17 },
      away: { team: 'Alabama', score: 24 },
    },
    'g-noclaim': {
      status: 'final',
      time: 'Final',
      home: { team: 'Tulane', score: 31 },
      away: { team: 'Florida State', score: 20 },
    },
    'g-fcs': {
      status: 'final',
      time: 'Final',
      home: { team: 'North Dakota', score: 10 },
      away: { team: 'Kansas State', score: 35 },
    },
  };

  const slates = deriveOwnerWeekSlates(games, rosterByTeam, scoresByKey);
  const avery = slates.find((slate) => slate.owner === 'Avery');
  const blair = slates.find((slate) => slate.owner === 'Blair');

  assert.ok(avery);
  assert.ok(blair);
  assert.equal(avery.performance.summary, '2–1');
  assert.equal(blair.performance.summary, '0–1');

  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={games}
      oddsByKey={{}}
      scoresByKey={scoresByKey}
      rosterByTeam={rosterByTeam}
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Avery/);
  assert.match(html, /2–1/);
  assert.match(html, /3 games · vs FCS, NoClaim \(FBS\), Blair/);
  assert.match(html, /bg-emerald-500\/5/);
  assert.match(html, /Blair/);
  assert.match(html, /0–1/);
  assert.match(html, /border-l-emerald-400\/80 bg-emerald-50\/40/);
  assert.match(html, /border-l-rose-400\/80 bg-rose-50\/40/);
});

test('scheduled and live games do not change owner final record summaries', () => {
  const games = [
    game({ key: 'g-final', csvAway: 'Clemson', csvHome: 'Miami' }),
    game({ key: 'g-live', csvAway: 'Oregon', csvHome: 'USC' }),
    game({ key: 'g-scheduled', csvAway: 'Texas', csvHome: 'Baylor' }),
  ];
  const rosterByTeam = new Map([
    ['Clemson', 'Casey'],
    ['Oregon', 'Casey'],
    ['Texas', 'Casey'],
    ['Miami', 'Dana'],
    ['USC', 'Evan'],
  ]);
  const scoresByKey = {
    'g-final': {
      status: 'final',
      time: 'Final',
      home: { team: 'Miami', score: 14 },
      away: { team: 'Clemson', score: 24 },
    },
    'g-live': {
      status: 'in progress',
      time: 'Q3',
      home: { team: 'USC', score: 17 },
      away: { team: 'Oregon', score: 21 },
    },
    'g-scheduled': {
      status: 'scheduled',
      time: 'Sat 7:30 PM',
      home: { team: 'Baylor', score: 0 },
      away: { team: 'Texas', score: 0 },
    },
  };

  const slates = deriveOwnerWeekSlates(games, rosterByTeam, scoresByKey);
  const casey = slates.find((slate) => slate.owner === 'Casey');
  assert.ok(casey);
  assert.equal(casey.performance.summary, '1–0 · 1 live');
  assert.equal(casey.performance.tone, 'inprogress');

  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={games}
      oddsByKey={{}}
      scoresByKey={scoresByKey}
      rosterByTeam={rosterByTeam}
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Casey/);
  assert.match(html, /1–0 · 1 live/);
  assert.match(html, /3 games · vs Evan, NoClaim \(FBS\), Dana/);
});

test('owner slate shows final record when one game is final and another is still scheduled', () => {
  const games = [
    game({ key: 'g-final', csvAway: 'Clemson', csvHome: 'Miami' }),
    game({ key: 'g-later', csvAway: 'Oregon', csvHome: 'USC' }),
  ];
  const rosterByTeam = new Map([
    ['Clemson', 'Casey'],
    ['Oregon', 'Casey'],
    ['Miami', 'Dana'],
    ['USC', 'Evan'],
  ]);
  const scoresByKey = {
    'g-final': {
      status: 'final',
      time: 'Final',
      home: { team: 'Miami', score: 14 },
      away: { team: 'Clemson', score: 24 },
    },
  };

  const slates = deriveOwnerWeekSlates(games, rosterByTeam, scoresByKey);
  const casey = slates.find((slate) => slate.owner === 'Casey');
  assert.ok(casey);
  assert.equal(casey.totalGames, 2);
  assert.equal(casey.finalGames, 1);
  assert.equal(casey.scheduledGames, 1);
  assert.equal(casey.performance.tone, 'neutral');
  assert.equal(casey.performance.summary, '1–0');

  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={games}
      oddsByKey={{}}
      scoresByKey={scoresByKey}
      rosterByTeam={rosterByTeam}
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Casey/);
  assert.match(html, /1–0/);
  assert.match(html, /2 games · vs Evan, Dana/);
  assert.doesNotMatch(html, /1 final/);
  assert.doesNotMatch(html, /1 scheduled/);
});

test('matchups panel distinguishes unowned fbs opponents from fcs opponents', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({ key: 'g-fbs', csvAway: 'Texas Tech', csvHome: 'Houston', homeConf: 'Big 12' }),
        game({ key: 'g-fcs', csvAway: 'Kansas State', csvHome: 'North Dakota', homeConf: 'FCS' }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Texas Tech', 'Jordan'],
          ['Kansas State', 'Jordan'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /NoClaim \(FBS\)/);
  assert.match(html, /FCS/);
  assert.doesNotMatch(html, /Unowned \/ Non-league/);
});

test('matchups panel counts repeated opponents before truncating the summary list', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({ key: 'g1', csvAway: 'A1', csvHome: 'B1' }),
        game({ key: 'g2', csvAway: 'A2', csvHome: 'B2' }),
        game({ key: 'g3', csvAway: 'A3', csvHome: 'B3' }),
        game({ key: 'g4', csvAway: 'A4', csvHome: 'B4' }),
        game({ key: 'g5', csvAway: 'A5', csvHome: 'B5' }),
        game({ key: 'g6', csvAway: 'A6', csvHome: 'B6' }),
        game({ key: 'g7', csvAway: 'A7', csvHome: 'B7' }),
        game({ key: 'g8', csvAway: 'A8', csvHome: 'B8' }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['A1', 'Taylor'],
          ['A2', 'Taylor'],
          ['A3', 'Taylor'],
          ['A4', 'Taylor'],
          ['A5', 'Taylor'],
          ['A6', 'Taylor'],
          ['A7', 'Taylor'],
          ['A8', 'Taylor'],
          ['B1', 'Pruitt'],
          ['B2', 'Pruitt'],
          ['B3', 'Carter'],
          ['B4', 'Carter'],
          ['B5', 'Carter'],
          ['B6', 'Surowiec'],
          ['B7', 'Jordan'],
          ['B8', 'Ballard'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /8 games · vs Pruitt \(x2\), Carter \(x3\), Surowiec \+2/);
  assert.match(html, /Show all/);
});

test('matchups panel preserves championship placeholder labels instead of collapsing them to FCS', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'g-sec-title',
          stage: 'conference_championship',
          label: 'SEC Championship',
          csvAway: 'Georgia',
          csvHome: 'SEC Team TBD',
          participants: {
            away: {
              kind: 'team',
              teamId: 'uga',
              displayName: 'Georgia',
              canonicalName: 'Georgia',
              rawName: 'Georgia',
            },
            home: {
              kind: 'placeholder',
              slotId: 'sec-title-home',
              displayName: 'SEC Team TBD',
              source: 'postseason-classifier',
            },
          },
        }),
        game({
          key: 'g-acc-title',
          stage: 'conference_championship',
          label: 'ACC Championship',
          csvAway: 'Georgia',
          csvHome: 'ACC Team TBD',
          participants: {
            away: {
              kind: 'team',
              teamId: 'uga',
              displayName: 'Georgia',
              canonicalName: 'Georgia',
              rawName: 'Georgia',
            },
            home: {
              kind: 'placeholder',
              slotId: 'acc-title-home',
              displayName: 'ACC Team TBD',
              source: 'postseason-classifier',
            },
          },
        }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map([['Georgia', 'Alex']])}
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /2 games · vs ACC Team TBD, SEC Team TBD/);
  assert.match(html, /SEC Team TBD/);
  assert.match(html, /ACC Team TBD/);
  assert.doesNotMatch(html, /2 games · vs FCS/);
});

test('unexpected final ties do not surface as supported matchup record semantics', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g-tie', csvAway: 'Texas', csvHome: 'Oklahoma' })]}
      oddsByKey={{}}
      scoresByKey={{
        'g-tie': {
          status: 'final',
          time: 'Final',
          home: { team: 'Oklahoma', score: 24 },
          away: { team: 'Texas', score: 24 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Texas', 'Alex'],
          ['Oklahoma', 'Alex'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Texas[\s\S]*24[\s\S]*–[\s\S]*24[\s\S]*Oklahoma/);
  assert.equal((html.match(/>Final</g) ?? []).length, 2);
  assert.doesNotMatch(html, /Counts as 1W \/ 1L/);
  assert.doesNotMatch(html, /1–1–1/);
});
