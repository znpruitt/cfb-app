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

test('matchups panel prioritizes owner-vs-owner leading state', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g1', csvAway: 'Alabama', csvHome: 'Georgia' })]}
      oddsByKey={{
        g1: { favorite: 'Georgia', spread: -3.5, total: 51.5, mlHome: -150, mlAway: 130 },
      }}
      scoresByKey={{
        g1: {
          status: 'Q3 05:00',
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

  assert.match(html, /Owner vs Owner/);
  assert.match(html, /Alice vs Bob/);
  assert.match(html, /Alice leading/);
  assert.match(html, /Alice 24 - 17 Bob/);
  assert.match(html, /Teams in this matchup/);
  assert.match(html, /Underlying game score/);
  assert.match(html, /Odds context/);
});

test('matchups panel keeps owned-vs-unowned games in secondary context', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g2', csvAway: 'Michigan', csvHome: 'Akron', homeConf: 'MAC' })]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map([['Michigan', 'Casey']])}
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /Secondary League Context/);
  assert.match(html, /Casey vs Unowned \/ Non-league/);
  assert.doesNotMatch(html, /Owner Matchup:/);
});

test('matchups panel excludes unowned-vs-unowned from matchup cards and summarizes them separately', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g3', csvAway: 'UCLA', csvHome: 'USC' })]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /No owner-vs-owner matchups for this week/);
  assert.match(html, /Other Week Games/);
  assert.match(html, /1 game omitted from owner matchup cards/);
});
