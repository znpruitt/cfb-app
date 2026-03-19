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
        g1: { favorite: 'Georgia', spread: -3.5, total: 51.5, mlHome: -150, mlAway: 130 },
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

  assert.match(html, /Owner Weekly Slates/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /0–0 · 1 live/);
  assert.match(html, /2 games · vs Bob, NoClaim \(FBS\)/);
  assert.match(html, /vs Bob/);
  assert.match(html, /NoClaim \(FBS\)/);
  assert.match(html, /Leading 24-17/);
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

  assert.match(html, /No owner-relevant games for this week/);
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
  assert.match(html, /1 game/);
  assert.match(html, /1–0/);
  assert.match(html, /1 game · vs Self/);
  assert.equal((html.match(/Texas/g) ?? []).length, 1);
  assert.doesNotMatch(html, /2 games/);
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
  assert.match(html, /2 games · vs Dana, Evan/);
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

  assert.match(html, /2 games · vs SEC Team TBD, ACC Team TBD/);
  assert.match(html, /SEC Team TBD/);
  assert.match(html, /ACC Team TBD/);
  assert.doesNotMatch(html, /2 games · vs FCS/);
});
