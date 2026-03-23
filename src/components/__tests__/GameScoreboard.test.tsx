import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import GameScoreboard from '../GameScoreboard.tsx';

const awayTeam = {
  displayName: 'Texas Tech',
  shortDisplayName: 'Texas Tech',
  scoreboardName: 'Texas Tech',
};

const homeTeam = {
  displayName: 'Baylor',
  shortDisplayName: 'Baylor',
  scoreboardName: 'Baylor',
};

function renderScoreboard(
  overrides: Partial<React.ComponentProps<typeof GameScoreboard>> = {}
): string {
  return renderToStaticMarkup(
    <GameScoreboard
      awayTeam={awayTeam}
      homeTeam={homeTeam}
      matchupLabel="Texas Tech @ Baylor"
      kickoffLabel="Sat, Sep 6, 7:00 PM"
      score={{
        status: 'scheduled',
        time: null,
        home: { team: 'Baylor', score: 21 },
        away: { team: 'Texas Tech', score: 17 },
      }}
      {...overrides}
    />
  );
}

test('event name prefers canonical label over provider notes', () => {
  const html = renderScoreboard({ label: 'Rose Bowl', notes: 'Some raw provider string' });

  assert.match(html, /Texas Tech @ Baylor/);
  assert.match(html, /Rose Bowl/);
  assert.doesNotMatch(html, /Some raw provider string/);
});

test('event name falls back to notes when label is missing', () => {
  const html = renderScoreboard({ label: '', notes: 'Big 12 Championship Presented by Dr Pepper' });

  assert.match(html, /Big 12 Championship Presented by Dr Pepper/);
  assert.doesNotMatch(html, /rounded-full/);
});

test('event name falls back when label is rejected and hides when both sources are rejected', () => {
  assert.match(renderScoreboard({ label: 'Texas Tech @ Baylor', notes: 'Rose Bowl' }), /Rose Bowl/);
  assert.doesNotMatch(
    renderScoreboard({ label: '', notes: 'Texas Tech @ Baylor' }),
    /data-scoreboard-event/
  );
  assert.doesNotMatch(renderScoreboard({ label: 'Arlington, TX' }), /data-scoreboard-event/);
});

test('postseason override label wins over unchanged notes', () => {
  const html = renderScoreboard({
    label: 'College Football Playoff Semifinal',
    notes: 'Cotton Bowl Classic raw',
  });

  assert.match(html, /College Football Playoff Semifinal/);
  assert.doesNotMatch(html, /Cotton Bowl Classic raw/);
});

test('conference and owner render under the correct team rows', () => {
  const html = renderScoreboard({
    awayConference: 'Big 12',
    awayOwner: 'Pruitt',
    homeConference: 'SEC',
    homeOwner: 'Morgan',
  });

  assert.ok(
    html.indexOf('data-scoreboard-row="away"') <
      html.indexOf('data-scoreboard-team-context="away">Big 12 · Pruitt</div>')
  );
  assert.ok(
    html.indexOf('data-scoreboard-row="home"') <
      html.indexOf('data-scoreboard-team-context="home">SEC · Morgan</div>')
  );
});

test('metadata row only contains kickoff and neutral-site indicator', () => {
  const html = renderScoreboard({
    label: 'Vrbo Fiesta Bowl',
    awayConference: 'Big 12',
    awayOwner: 'Pruitt',
    homeConference: 'SEC',
    homeOwner: 'Morgan',
    neutralSite: true,
  });

  assert.match(html, /Sat, Sep 6, 7:00 PM/);
  assert.match(html, /Neutral Site/);
  assert.ok(html.includes('Big 12 · Pruitt'));
  assert.ok(html.includes('SEC · Morgan'));
  assert.doesNotMatch(html, /rounded-full border/);
  assert.doesNotMatch(html, /Home owner:/);
  assert.doesNotMatch(html, /Away owner:/);
});

test('team rows handle missing notes owner and conference without extra placeholders', () => {
  const html = renderScoreboard({
    label: '',
    notes: '',
    awayConference: null,
    awayOwner: undefined,
    homeConference: 'SEC',
  });

  assert.doesNotMatch(html, /data-scoreboard-team-context="away"/);
  assert.match(html, /data-scoreboard-team-context="home">SEC<\//);
});
