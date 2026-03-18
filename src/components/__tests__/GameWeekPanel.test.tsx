import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppGame } from '../../lib/schedule';
import GameWeekPanel from '../GameWeekPanel';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? overrides.key ?? 'g',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? null,
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
    awayConf: overrides.awayConf ?? 'IND',
    homeConf: overrides.homeConf ?? 'IND',
    sources: overrides.sources,
  };
}

test('selected week view renders ascending date headers and kickoff order', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({ key: 'late', csvAway: 'B', csvHome: 'A', date: '2025-08-30T20:00:00.000Z' }),
        game({ key: 'tbd', csvAway: 'D', csvHome: 'C', date: null }),
        game({ key: 'early', csvAway: 'F', csvHome: 'E', date: '2025-08-30T15:00:00.000Z' }),
        game({ key: 'next-day', csvAway: 'H', csvHome: 'G', date: '2025-08-31T15:00:00.000Z' }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="America/Los_Angeles"
    />
  );

  const saturdayIndex = html.indexOf('Saturday, Aug 30');
  const sundayIndex = html.indexOf('Sunday, Aug 31');
  const tbdHeaderIndex = html.indexOf('Date TBD');
  const earlyIndex = html.indexOf('F @ E');
  const lateIndex = html.indexOf('B @ A');
  const nextDayIndex = html.indexOf('H @ G');
  const tbdIndex = html.indexOf('D @ C');

  assert.ok(saturdayIndex >= 0);
  assert.ok(sundayIndex > saturdayIndex);
  assert.ok(tbdHeaderIndex > sundayIndex);
  assert.ok(earlyIndex > saturdayIndex);
  assert.ok(lateIndex > earlyIndex);
  assert.ok(nextDayIndex > sundayIndex);
  assert.ok(tbdIndex > tbdHeaderIndex);
});

test('late-night kickoff header matches kickoff text timezone', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'late-night',
          csvAway: 'Visitor',
          csvHome: 'Home',
          date: '2025-09-07T04:30:00.000Z',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="America/Los_Angeles"
    />
  );

  assert.ok(html.includes('Saturday, Sep 6'));
  assert.ok(html.includes('Kickoff: Sat, Sep 6, 9:30 PM'));
});
