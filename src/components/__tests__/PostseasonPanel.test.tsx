import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppGame } from '../../lib/schedule';
import PostseasonPanel from '../PostseasonPanel';

function postseasonGame(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'postseason-game',
    eventId: overrides.eventId ?? overrides.key ?? 'postseason-game',
    week: overrides.week ?? 16,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 16,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 16,
    date: overrides.date ?? null,
    stage: overrides.stage ?? 'bowl',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 0,
    eventKey: overrides.eventKey ?? overrides.key ?? 'postseason-game',
    label: overrides.label ?? 'Orange Bowl',
    notes: overrides.notes ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? 'Orange Bowl',
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? 'bowl',
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? true,
    neutralDisplay: overrides.neutralDisplay ?? 'vs',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      away: {
        kind: 'team',
        teamId: 'texas',
        displayName: 'Texas',
        canonicalName: 'Texas',
        rawName: 'Texas',
      },
      home: {
        kind: 'team',
        teamId: 'georgia',
        displayName: 'Georgia',
        canonicalName: 'Georgia',
        rawName: 'Georgia',
      },
    },
    csvAway: overrides.csvAway ?? 'Texas',
    csvHome: overrides.csvHome ?? 'Georgia',
    canAway: overrides.canAway ?? 'Texas',
    canHome: overrides.canHome ?? 'Georgia',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
    sources: overrides.sources,
  };
}

test('postseason panel threads team records through to shared scoreboards', () => {
  const html = renderToStaticMarkup(
    <PostseasonPanel
      games={[postseasonGame({ key: 'orange-bowl', providerGameId: '401234567' })]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      teamRecordsByProviderGameId={{
        '401234567': { away: { wins: 11, losses: 2 }, home: { wins: 12, losses: 1 } },
      }}
    />
  );

  assert.match(html, /data-scoreboard-value="away">11–2<\/span>/);
  assert.match(html, /data-scoreboard-value="home">12–1<\/span>/);
});

test('postseason panel forwards focused game id to grouped game cards', () => {
  const html = renderToStaticMarkup(
    <PostseasonPanel
      games={[
        postseasonGame({ key: 'orange-bowl', postseasonRole: 'bowl' }),
        postseasonGame({
          key: 'title-game',
          postseasonRole: 'national_championship',
          stage: 'playoff',
          label: 'National Championship',
        }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      focusedGameId="title-game"
    />
  );

  assert.match(html, /data-focused-game="true"/);
});
