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
  const earlyIndex = html.indexOf('F</span> @ <span');
  const lateIndex = html.indexOf('B</span> @ <span');
  const nextDayIndex = html.indexOf('H</span> @ <span');
  const tbdIndex = html.indexOf('D</span> @ <span');

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

test('selected week panel stays aligned with week metadata date basis for the same timezone', () => {
  const games = [
    game({
      key: 'late-night',
      csvAway: 'Visitor',
      csvHome: 'Home',
      date: '2025-09-07T04:30:00.000Z',
    }),
    game({ key: 'daytime', csvAway: 'Guest', csvHome: 'Host', date: '2025-09-07T19:00:00.000Z' }),
  ];
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={games}
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
  assert.ok(html.includes('Sunday, Sep 7'));
  assert.ok(html.includes('Kickoff: Sat, Sep 6, 9:30 PM'));
  assert.ok(html.includes('Kickoff: Sun, Sep 7, 12:00 PM'));
});

test('postseason placeholders with TBD kickoff render stable date fallback', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'placeholder-bowl',
          stage: 'bowl',
          postseasonRole: 'bowl',
          isPlaceholder: true,
          label: 'Placeholder Bowl',
          date: null,
          csvAway: 'Team TBD',
          csvHome: 'Team TBD',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="Pacific/Honolulu"
    />
  );

  assert.ok(html.includes('Date TBD'));
  assert.ok(html.includes('Kickoff: TBD'));
  assert.ok(html.includes('Placeholder Bowl'));
});

test('neutral-site ranked matchup label preserves vs wording', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'neutral',
          csvAway: 'Texas',
          csvHome: 'Ohio State',
          date: '2025-09-01T17:00:00.000Z',
          neutral: true,
          neutralDisplay: 'vs',
          stage: 'bowl',
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Texas<\/span> vs <span>Ohio State/);
  assert.doesNotMatch(html, /Texas<\/span> @ <span>Ohio State/);
});

test('rankings render when lookup keys use canonical team ids instead of canonical display names', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'ranked',
          csvAway: 'Ole Miss',
          csvHome: 'Texas',
          canAway: 'Mississippi',
          canHome: 'Texas',
          participants: {
            away: {
              kind: 'team',
              teamId: 'mississippi',
              displayName: 'Mississippi',
              canonicalName: 'Mississippi',
              rawName: 'Ole Miss',
            },
            home: {
              kind: 'team',
              teamId: 'texas',
              displayName: 'Texas',
              canonicalName: 'Texas',
              rawName: 'Texas',
            },
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={
        new Map([
          ['mississippi', { rank: 12, rankSource: 'ap' }],
          ['texas', { rank: 3, rankSource: 'cfp' }],
        ])
      }
    />
  );

  assert.match(html, /#12 Ole Miss/);
  assert.match(html, /#3 Texas/);
});

test('score block renders stacked scoreboard rows with rankings and final status', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'score-final',
          csvAway: 'Ole Miss',
          csvHome: 'Mississippi State',
          canAway: 'Mississippi',
          canHome: 'Mississippi State',
          participants: {
            away: {
              kind: 'team',
              teamId: 'mississippi',
              displayName: 'Mississippi',
              labels: {
                displayName: 'Mississippi',
                shortDisplayName: 'Ole Miss',
                scoreboardName: 'OLE MISS',
              },
              canonicalName: 'Mississippi',
              rawName: 'Ole Miss',
            },
            home: {
              kind: 'team',
              teamId: 'mississippi-state',
              displayName: 'Mississippi State',
              labels: {
                displayName: 'Mississippi State',
                shortDisplayName: 'Mississippi State',
                scoreboardName: 'MSST',
              },
              canonicalName: 'Mississippi State',
              rawName: 'Mississippi State',
            },
          },
        }),
      ]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-final': {
          away: { team: 'Ole Miss', score: 38 },
          home: { team: 'Mississippi State', score: 19 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
      rankingsByTeamId={new Map([['mississippi', { rank: 7, rankSource: 'ap' }]])}
    />
  );

  assert.match(html, /aria-label="Game scoreboard"/);
  assert.match(html, /FINAL/);
  assert.match(html, /data-scoreboard-row="away"/);
  assert.match(html, /data-scoreboard-row="home"/);
  assert.match(html, /#7 OLE MISS/);
  assert.match(html, /MSST/);
  assert.match(html, /data-scoreboard-score="away">38<\/span>/);
  assert.match(html, /data-scoreboard-score="home">19<\/span>/);
  assert.match(html, /font-semibold text-gray-950[^"]*border-b border-gray-200\/60/);
  assert.doesNotMatch(html, /Ole Miss 38 at Mississippi State 19 \(Final\)<\/div>/);
});

test('score block preserves live and pregame status labels', () => {
  const liveHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-live', csvAway: 'Texas', csvHome: 'Oklahoma' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-live': {
          away: { team: 'Texas', score: 24 },
          home: { team: 'Oklahoma', score: 17 },
          status: 'Q3 8:14',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const scheduledHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-pregame', csvAway: 'USC', csvHome: 'UCLA' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-pregame': {
          away: { team: 'USC', score: null },
          home: { team: 'UCLA', score: null },
          status: '7:30 PM ET',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(liveHtml, /Q3 8:14/);
  assert.match(scheduledHtml, /7:30 PM ET/);
  assert.match(scheduledHtml, /data-scoreboard-score="away">—<\/span>/);
  assert.match(scheduledHtml, /data-scoreboard-score="home">—<\/span>/);
});

test('score block preserves disrupted terminal provider statuses instead of collapsing to FINAL', () => {
  const postponedHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-postponed', csvAway: 'Auburn', csvHome: 'LSU' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-postponed': {
          away: { team: 'Auburn', score: null },
          home: { team: 'LSU', score: null },
          status: 'Postponed',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const weatherHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-weather', csvAway: 'Florida', csvHome: 'Georgia' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-weather': {
          away: { team: 'Florida', score: null },
          home: { team: 'Georgia', score: null },
          status: 'Postponed - weather',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  const canceledHtml = renderToStaticMarkup(
    <GameWeekPanel
      games={[game({ key: 'score-canceled', csvAway: 'UCF', csvHome: 'Houston' })]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'score-canceled': {
          away: { team: 'UCF', score: null },
          home: { team: 'Houston', score: null },
          status: 'Canceled',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(postponedHtml, />Postponed<\/div>/);
  assert.match(weatherHtml, />Postponed - weather<\/div>/);
  assert.match(canceledHtml, />Canceled<\/div>/);
  assert.doesNotMatch(postponedHtml, />FINAL<\/div>/);
  assert.doesNotMatch(weatherHtml, />FINAL<\/div>/);
  assert.doesNotMatch(canceledHtml, />FINAL<\/div>/);
});

test('expanded scoreboard header preserves neutral-site wording from shared matchup helper', () => {
  const neutralGame = game({
    key: 'neutral-expanded',
    csvAway: 'Texas',
    csvHome: 'Ohio State',
    date: '2025-09-01T17:00:00.000Z',
    neutral: true,
    neutralDisplay: 'vs',
    stage: 'bowl',
  });
  const expectedLabel = 'Texas vs Ohio State';
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[neutralGame]}
      byes={[]}
      oddsByKey={{}}
      scoresByKey={{
        'neutral-expanded': {
          away: { team: 'Texas', score: 27 },
          home: { team: 'Ohio State', score: 24 },
          status: 'Final',
          time: null,
        },
      }}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Texas<\/span> vs <span>Ohio State/);
  assert.match(html, />Texas vs Ohio State<\/div>/);
  assert.doesNotMatch(html, />Texas @ Ohio State<\/div>/);
  assert.ok(html.includes(expectedLabel));
});

test('moneyline-only odds still render in expanded scoreboard odds row', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'moneyline-only',
          csvAway: 'South Carolina',
          csvHome: 'Clemson',
        }),
      ]}
      byes={[]}
      oddsByKey={{
        'moneyline-only': {
          favorite: null,
          spread: null,
          homeSpread: null,
          awaySpread: null,
          spreadPriceHome: null,
          spreadPriceAway: null,
          total: null,
          mlHome: -600,
          mlAway: 425,
          overPrice: null,
          underPrice: null,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2025-09-01T12:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /ML: South Carolina \+425 • Clemson -600/);
  assert.doesNotMatch(html, /No odds/);
});

test('odds row stays hidden only when no displayable odds markets exist', () => {
  const html = renderToStaticMarkup(
    <GameWeekPanel
      games={[
        game({
          key: 'empty-odds',
          csvAway: 'Notre Dame',
          csvHome: 'Penn State',
        }),
      ]}
      byes={[]}
      oddsByKey={{
        'empty-odds': {
          favorite: null,
          spread: null,
          homeSpread: null,
          awaySpread: null,
          spreadPriceHome: null,
          spreadPriceAway: null,
          total: null,
          mlHome: null,
          mlAway: null,
          overPrice: null,
          underPrice: null,
          source: null,
          bookmakerKey: null,
          capturedAt: null,
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{}}
      rosterByTeam={new Map()}
      isDebug={false}
      hideByes={true}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /ML:/);
  assert.doesNotMatch(html, /Spread:/);
  assert.doesNotMatch(html, /O\/U:/);
  assert.doesNotMatch(html, /No odds/);
});
