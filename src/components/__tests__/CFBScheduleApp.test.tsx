import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CFBScheduleApp from '../CFBScheduleApp';
import type { AppGame } from '../../lib/schedule';

function game(overrides: Partial<AppGame> = {}): AppGame {
  return {
    key: overrides.key ?? 'g-1',
    eventId: overrides.eventId ?? 'event-1',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event-key-1',
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
        teamId: 'home-team',
        displayName: 'Home Team',
        canonicalName: 'Home Team',
        rawName: 'Home Team',
      },
      away: {
        kind: 'team',
        teamId: 'away-team',
        displayName: 'Away Team',
        canonicalName: 'Away Team',
        rawName: 'Away Team',
      },
    },
    csvAway: overrides.csvAway ?? 'Away Team',
    csvHome: overrides.csvHome ?? 'Home Team',
    canAway: overrides.canAway ?? 'Away Team',
    canHome: overrides.canHome ?? 'Home Team',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

test('league surface shows compact fatal fallback for schedule bootstrap failures', () => {
  const html = renderToStaticMarkup(
    <CFBScheduleApp initialIssues={['CFBD schedule load failed: upstream CFBD returned 503']} />
  );

  assert.match(html, /League surface unavailable/);
  assert.match(html, /CFBD schedule load failed: upstream CFBD returned 503/);
  assert.match(html, /Rebuild schedule/);
  assert.match(html, /Open Admin \/ Debug/);
  assert.doesNotMatch(html, /Commissioner tools and diagnostics/);
});

test('league surface keeps admin tooling off the landing page when a schedule can render', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp initialGames={[game()]} />);

  assert.match(html, /CFB League Dashboard/);
  assert.match(html, /League Overview/);
  assert.match(html, /Overview/);
  assert.match(html, /Admin \/ Debug/);
  assert.doesNotMatch(html, /League-first/);
  assert.doesNotMatch(html, /CFB Office Pool/);
  assert.doesNotMatch(html, /League surface unavailable/);
  assert.doesNotMatch(html, /Commissioner tools and diagnostics/);
  assert.doesNotMatch(html, /Admin diagnostics: API usage/);
});

test('admin surface still renders dedicated admin and debug tooling', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp surface="admin" />);

  assert.match(html, /Commissioner tools and diagnostics/);
  assert.match(html, /Admin diagnostics: API usage/);
  assert.match(html, /Back to league view/);
});

test('league surface admin attention count ignores informational provider rows', () => {
  const html = renderToStaticMarkup(<CFBScheduleApp initialGames={[game()]} initialIssues={[]} />);

  assert.doesNotMatch(html, /admin item/);
});
