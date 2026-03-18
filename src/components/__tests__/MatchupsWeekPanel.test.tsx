import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppGame } from '../../lib/schedule';
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
  assert.match(html, /2 games/);
  assert.match(html, /Faces Bob/);
  assert.match(html, /vs owner Bob/);
  assert.match(html, /Unowned \/ Non-league/);
  assert.match(html, /Leading 24-17/);
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

  assert.match(html, /1 game scheduled/);
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
