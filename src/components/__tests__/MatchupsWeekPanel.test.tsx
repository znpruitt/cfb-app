import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppGame } from '../../lib/schedule';
import { deriveOwnerWeekSlates } from '../../lib/matchups';
import type { CanonicalStandings } from '../../lib/selectors/leagueStandings';
import type { LiveDelta } from '../../lib/selectors/liveDelta';
import MatchupsWeekPanel from '../MatchupsWeekPanel';

function ownerCardMarkup(html: string, owner: string): string {
  const marker = `data-owner-card="${owner}"`;
  const markerIndex = html.indexOf(marker);
  assert.ok(markerIndex >= 0, `${owner} owner card must render`);
  const start = html.lastIndexOf('<article', markerIndex);
  const nextMarkerIndex = html.indexOf('data-owner-card="', markerIndex + marker.length);
  const end = nextMarkerIndex >= 0 ? html.lastIndexOf('<article', nextMarkerIndex) : html.length;
  return html.slice(start, end);
}

function scoreboardMarkup(cardMarkup: string, matchupLabel: string): string {
  const marker = `aria-label="${matchupLabel}"`;
  const markerIndex = cardMarkup.indexOf(marker);
  assert.ok(markerIndex >= 0, `${matchupLabel} scoreboard must render`);
  const start = cardMarkup.lastIndexOf('<article', markerIndex);
  const end = cardMarkup.indexOf('</article>', markerIndex);
  assert.ok(start >= 0 && end >= 0, `${matchupLabel} scoreboard markup must be bounded`);
  return cardMarkup.slice(start, end + '</article>'.length);
}

function participantMarkup(scoreboard: string, side: 'away' | 'home'): string {
  const row = scoreboard.match(
    new RegExp(`<div(?=[^>]*data-scoreboard-side="${side}")[^>]*>[\\s\\S]*?<\\/div>`)
  )?.[0];
  assert.ok(row, `${side} participant row must render`);
  return row;
}

function participantOpeningTag(scoreboard: string, side: 'away' | 'home'): string {
  const row = scoreboard.match(
    new RegExp(`<div(?=[^>]*data-scoreboard-side="${side}")[^>]*>`)
  )?.[0];
  assert.ok(row, `${side} participant row opening tag must render`);
  return row;
}

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
    awayClassification: overrides.awayClassification,
    homeClassification: overrides.homeClassification,
    sources: overrides.sources,
    startTimeTBD: overrides.startTimeTBD,
  };
}

function renderCompleteGameRowFactInventory(): string {
  return renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'fact-final',
          label: 'Rivalry Showcase',
          csvAway: 'Alabama',
          csvHome: 'Georgia',
          neutral: true,
        }),
        game({ key: 'fact-live', csvAway: 'Clemson', csvHome: 'Miami' }),
        game({
          key: 'fact-scheduled',
          csvAway: 'Oregon',
          csvHome: 'Portland State',
          homeConf: 'Big Sky',
          homeClassification: 'fcs',
        }),
      ]}
      oddsByKey={{
        'fact-final': {
          favorite: 'Georgia',
          spread: -7.5,
          homeSpread: -7.5,
          awaySpread: 7.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: 51.5,
          mlHome: -250,
          mlAway: 210,
          overPrice: -108,
          underPrice: -112,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2025-08-30T18:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{
        'fact-final': {
          status: 'final',
          time: 'Final',
          home: { team: 'Georgia', score: 17 },
          away: { team: 'Alabama', score: 24 },
        },
        'fact-live': {
          status: 'in progress',
          time: 'Q3 8:14',
          home: { team: 'Miami', score: null },
          away: { team: 'Clemson', score: 21 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Alabama', 'Alice'],
          ['Georgia', 'Bob'],
          ['Clemson', 'Alice'],
          ['Miami', 'Carol'],
          ['Oregon', 'Alice'],
        ])
      }
      rankingsByTeamId={
        new Map([
          ['a', { rank: 10, rankSource: 'ap' }],
          ['h', { rank: 2, rankSource: 'ap' }],
        ])
      }
      displayTimeZone="UTC"
    />
  );
}

test('matchups cards map each visible team directly to its owner and tint only the card owner team', () => {
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
          ['Akron', 'NoClaim'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /data-owner-card="Alice"/);
  assert.match(html, /data-owner-card="Bob"/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /0–0 · 1 live/);
  // Owner-vs-owner game is duplicated into both slates: Alice's card carries a
  // "vs Bob" opponent badge while the unowned FBS game has no owner badge.
  assert.match(html, /vs Bob/);
  assert.doesNotMatch(html, /NoClaim/);
  const aliceScoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Alice'), 'Alabama @ Georgia');
  const bobScoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Bob'), 'Alabama @ Georgia');
  const aliceAway = participantMarkup(aliceScoreboard, 'away');
  const aliceHome = participantMarkup(aliceScoreboard, 'home');

  // This is the owner→team defect assertion: the participant rows themselves
  // say which owner holds Alabama and which holds Georgia. It does not infer
  // ownership from tint classes or from the separate `vs Bob` descriptor.
  assert.match(aliceAway, /data-scoreboard-team="away">Alabama/);
  assert.match(aliceAway, /data-scoreboard-owner="away">Alice/);
  assert.match(aliceHome, /data-scoreboard-team="home">Georgia/);
  assert.match(aliceHome, /data-scoreboard-owner="home">Bob/);
  assert.match(aliceAway, /data-scoreboard-value="away">24/);
  assert.match(aliceHome, /data-scoreboard-value="home">17/);

  const aliceAwayTag = participantOpeningTag(aliceScoreboard, 'away');
  const aliceHomeTag = participantOpeningTag(aliceScoreboard, 'home');
  const bobAwayTag = participantOpeningTag(bobScoreboard, 'away');
  const bobHomeTag = participantOpeningTag(bobScoreboard, 'home');
  assert.match(aliceAwayTag, /after:rounded-\[4px\]/);
  assert.doesNotMatch(aliceHomeTag, /after:rounded/);
  assert.doesNotMatch(bobAwayTag, /after:rounded/);
  assert.match(bobHomeTag, /after:rounded-\[4px\]/);
  assert.match(html, /05:00/);
  assert.doesNotMatch(html, /Leading 24-17/);
  assert.doesNotMatch(html, /Trailing 24-17/);
  assert.doesNotMatch(
    html,
    /Kickoff Sat, Aug 30, 4:00 PM<\/span><span>•<\/span><span>Georgia -3.5/
  );
  assert.match(
    html,
    /rounded-xl border p-3\.5 shadow-sm sm:p-4 border-gray-300\/90 bg-white dark:border-zinc-700/
  );
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

test('matchups panel keeps an owner-only empty state without an excluded-games summary', () => {
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
  assert.doesNotMatch(html, /Excluded games/);
  assert.doesNotMatch(html, /1 excluded game/);
});

test('matchups panel summarizes self-matchups as Self', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'g-self',
          providerGameId: 'g-self-provider',
          csvAway: 'Texas',
          csvHome: 'Oklahoma',
        }),
      ]}
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
      teamRecordsByProviderGameId={{
        'g-self-provider': {
          away: { wins: 10, losses: 2 },
          home: { wins: 8, losses: 4 },
        },
      }}
      displayTimeZone="America/New_York"
    />
  );

  assert.match(html, /data-owner-card="Alex"/);
  // Item 135 retarget. `buildOwnerSlateGames` still emits one slate entry per
  // owned SIDE, so this game arrives twice — but one game is one row, so the
  // "Self" badge appears ONCE. Previously 2, alongside a comment recording the
  // duplication as intended. Every other assertion here is unchanged: the 1–1
  // record (counted from buckets, never doubled), the scoreline order, the
  // self-tone border, and the absence of Leading/Trailing phrasing.
  assert.match(html, /1–1/);
  assert.equal((html.match(/>Self</g) ?? []).length, 1);
  const selfScoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Alex'), 'Texas @ Oklahoma');
  const awayRow = participantMarkup(selfScoreboard, 'away');
  const homeRow = participantMarkup(selfScoreboard, 'home');
  assert.match(awayRow, /data-scoreboard-team="away">Texas/);
  assert.match(awayRow, /data-scoreboard-owner="away">Alex/);
  assert.match(awayRow, /data-scoreboard-record="away">\(10–2\)<\/span>/);
  assert.match(awayRow, /data-scoreboard-value="away">28/);
  assert.match(homeRow, /data-scoreboard-team="home">Oklahoma/);
  assert.match(homeRow, /data-scoreboard-owner="home">Alex/);
  assert.match(homeRow, /data-scoreboard-record="home">\(8–4\)<\/span>/);
  assert.match(homeRow, /data-scoreboard-value="home">21/);

  const awayTag = participantOpeningTag(selfScoreboard, 'away');
  const homeTag = participantOpeningTag(selfScoreboard, 'home');
  assert.match(awayTag, /after:rounded-t-\[4px\]/);
  assert.doesNotMatch(awayTag, /after:rounded-\[4px\]/);
  assert.match(homeTag, /after:rounded-b-\[4px\]/);
  assert.doesNotMatch(homeTag, /after:rounded-\[4px\]/);
  assert.match(html, /border-l-violet-400\/80 bg-gray-50\/40/);
  assert.doesNotMatch(html, /border-l-violet-400\/80 bg-violet-50\/40/);
  assert.doesNotMatch(html, /Leading 28-21/);
  assert.doesNotMatch(html, /Trailing 28-21/);
  assert.equal((html.match(/data-scoreboard-team="away">Texas/g) ?? []).length, 1);
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

  const scoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Lane'), 'Iowa @ Nebraska');
  assert.equal(
    (scoreboard.match(/Final/g) ?? []).length,
    1,
    'one completed scoreboard must render one final status and no final clock'
  );
  assert.doesNotMatch(scoreboard, />Final Final<\/span>|>final<\/span>/);
  assert.doesNotMatch(scoreboard, /Final: /);
  assert.doesNotMatch(scoreboard, /Kickoff /);
  assert.match(participantMarkup(scoreboard, 'away'), /data-scoreboard-value="away">31/);
  assert.match(participantMarkup(scoreboard, 'home'), /data-scoreboard-value="home">24/);
});

test('disrupted games never derive hidden score leadership in scheduled presentation', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'g-suspended', csvAway: 'Iowa', csvHome: 'Nebraska' })]}
      oddsByKey={{}}
      scoresByKey={{
        'g-suspended': {
          status: 'Suspended',
          time: null,
          home: { team: 'Nebraska', score: 7 },
          away: { team: 'Iowa', score: 14 },
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

  const scoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Lane'), 'Iowa @ Nebraska');
  assert.match(scoreboard, /data-scoreboard-state="scheduled"/);
  assert.equal((scoreboard.match(/data-scoreboard-leading="false"/g) ?? []).length, 2);
  assert.doesNotMatch(scoreboard, /data-scoreboard-leading="true"/);
  assert.doesNotMatch(scoreboard, /data-scoreboard-value-kind="score"/);
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

  const scoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Nia'), 'Rutgers @ Maryland');
  assert.match(scoreboard, /data-scoreboard-team="away">Rutgers/);
  assert.match(scoreboard, /data-scoreboard-team="home">Maryland/);
  assert.match(html, /Kickoff Sat, Aug 30, 4:00 PM/);
  assert.doesNotMatch(scoreboard, /data-scoreboard-value-kind="score"/);
});

test('matchups threads current records to both participants across scheduled, live, and final rows', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'record-scheduled',
          providerGameId: 'record-scheduled-provider',
          csvAway: 'Army',
          csvHome: 'Navy',
        }),
        game({
          key: 'record-live',
          providerGameId: 'record-live-provider',
          csvAway: 'Georgia',
          csvHome: 'Clemson',
        }),
        game({
          key: 'record-final',
          providerGameId: 'record-final-provider',
          csvAway: 'Texas',
          csvHome: 'Rice',
        }),
      ]}
      oddsByKey={{}}
      scoresByKey={{
        'record-live': {
          status: 'in progress',
          time: 'Q2 4:10',
          away: { team: 'Georgia', score: 14 },
          home: { team: 'Clemson', score: 10 },
        },
        'record-final': {
          status: 'final',
          time: 'Final',
          away: { team: 'Texas', score: 31 },
          home: { team: 'Rice', score: 17 },
        },
      }}
      rosterByTeam={
        new Map([
          ['Army', 'Alice'],
          ['Navy', 'Bob'],
          ['Georgia', 'Alice'],
          ['Clemson', 'Carol'],
          ['Texas', 'Alice'],
          ['Rice', 'Dana'],
        ])
      }
      teamRecordsByProviderGameId={{
        'record-scheduled-provider': {
          away: { wins: 1, losses: 0 },
          home: { wins: 2, losses: 1 },
        },
        'record-live-provider': {
          away: { wins: 3, losses: 0 },
          home: { wins: 2, losses: 2 },
        },
        'record-final-provider': {
          away: { wins: 4, losses: 0 },
          home: { wins: 1, losses: 3 },
        },
      }}
      displayTimeZone="UTC"
    />
  );
  const aliceCard = ownerCardMarkup(html, 'Alice');
  const scheduled = scoreboardMarkup(aliceCard, 'Army @ Navy');
  const live = scoreboardMarkup(aliceCard, 'Georgia @ Clemson');
  const final = scoreboardMarkup(aliceCard, 'Texas @ Rice');

  for (const [side, record] of [
    ['away', '1–0'],
    ['home', '2–1'],
  ] as const) {
    const row = participantMarkup(scheduled, side);
    assert.match(
      row,
      new RegExp(`data-scoreboard-value-kind="record" data-scoreboard-value="${side}">${record}`)
    );
    assert.doesNotMatch(row, /data-scoreboard-record/);
  }
  for (const [scoreboard, expected] of [
    [live, { records: { away: '3–0', home: '2–2' }, scores: { away: 14, home: 10 } }],
    [final, { records: { away: '4–0', home: '1–3' }, scores: { away: 31, home: 17 } }],
  ] as const) {
    for (const side of ['away', 'home'] as const) {
      const row = participantMarkup(scoreboard, side);
      assert.match(
        row,
        new RegExp(`data-scoreboard-record="${side}">\\(${expected.records[side]}\\)`)
      );
      assert.match(
        row,
        new RegExp(
          `data-scoreboard-value-kind="score" data-scoreboard-value="${side}">${expected.scores[side]}`
        )
      );
      assert.doesNotMatch(row, /data-scoreboard-value-kind="record"/);
    }
  }
});

test('scheduled Matchups keeps a missing record anchor blank even when a spread is available', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'recordless-spread',
          providerGameId: 'recordless-spread-provider',
          csvAway: 'Virginia Tech',
          csvHome: 'Virginia',
        }),
      ]}
      oddsByKey={{
        'recordless-spread': {
          favorite: 'Virginia Tech',
          spread: -7.5,
          homeSpread: 7.5,
          awaySpread: -7.5,
          spreadPriceHome: -110,
          spreadPriceAway: -110,
          total: 49.5,
          mlHome: 220,
          mlAway: -260,
          overPrice: -108,
          underPrice: -112,
          source: 'DraftKings',
          bookmakerKey: 'draftkings',
          capturedAt: '2026-09-08T12:00:00.000Z',
          lineSourceStatus: 'latest',
        },
      }}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Virginia Tech', 'Alice'],
          ['Virginia', 'Bob'],
        ])
      }
      teamRecordsByProviderGameId={{
        'recordless-spread-provider': {
          away: null,
          home: { wins: 2, losses: 0 },
        },
      }}
      displayTimeZone="UTC"
    />
  );
  const scoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Alice'), 'Virginia Tech @ Virginia');
  const awayRow = participantMarkup(scoreboard, 'away');
  const homeRow = participantMarkup(scoreboard, 'home');

  assert.doesNotMatch(awayRow, /data-scoreboard-record|data-scoreboard-value="away"|-7\.5|7\.5|—/);
  assert.match(homeRow, /data-scoreboard-value-kind="record" data-scoreboard-value="home">2–0<\//);
  assert.doesNotMatch(scoreboard, /data-scoreboard-odds-footer|DraftKings|O\/U 49\.5/);
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

  assert.match(html, /aria-label="Texas vs Ohio State"/);
  assert.doesNotMatch(html, /aria-label="Texas @ Ohio State"/);
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

  const scoreboard = scoreboardMarkup(
    ownerCardMarkup(html, 'Pat'),
    'Very Long Away Team Name University vs Extremely Long Home Team Name College'
  );
  const awayRow = participantMarkup(scoreboard, 'away');
  const homeRow = participantMarkup(scoreboard, 'home');
  assert.match(awayRow, /Very Long Away Team Name University/);
  assert.match(awayRow, /data-scoreboard-value="away">21/);
  assert.match(homeRow, /Extremely Long Home Team Name College/);
  assert.match(homeRow, /data-scoreboard-value="home">17/);
  assert.ok(scoreboard.indexOf(awayRow) < scoreboard.indexOf(homeRow), 'away row must stay first');
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

  const scoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Kai'), 'Utah @ Arizona');
  assert.match(participantMarkup(scoreboard, 'away'), /data-scoreboard-value="away">21/);
  assert.match(participantMarkup(scoreboard, 'home'), /data-scoreboard-value="home">17/);
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

test('shared row conversion preserves the complete bespoke GameRow fact inventory', () => {
  const html = renderCompleteGameRowFactInventory();
  const aliceCard = ownerCardMarkup(html, 'Alice');
  const finalScoreboard = scoreboardMarkup(aliceCard, 'Alabama vs Georgia');
  const liveScoreboard = scoreboardMarkup(aliceCard, 'Clemson @ Miami');
  const scheduledScoreboard = scoreboardMarkup(aliceCard, 'Oregon @ Portland State');

  // Event label; state; neutral-site fact; team names; rankings and sources;
  // owner mapping; scores; primary/secondary tags; opponent descriptor; and
  // the shipped non-scheduled kickoff metadata all survive the final row.
  assert.match(finalScoreboard, /data-scoreboard-context-slot[\s\S]*Rivalry Showcase/);
  assert.match(finalScoreboard, /data-scoreboard-state="final"/);
  assert.match(finalScoreboard, />Final<\/span>/);
  assert.match(finalScoreboard, /data-scoreboard-neutral-site[\s\S]*Neutral site/);
  assert.match(finalScoreboard, /title="AP rank #10">#10/);
  assert.match(finalScoreboard, /title="AP rank #2">#2/);
  assert.match(participantMarkup(finalScoreboard, 'away'), /Alabama[\s\S]*Alice[\s\S]*>24</);
  assert.match(participantMarkup(finalScoreboard, 'home'), /Georgia[\s\S]*Bob[\s\S]*>17</);
  assert.match(finalScoreboard, /data-eyebrow-tag[^>]*>Upset<\/span>/);
  assert.match(finalScoreboard, /data-eyebrow-tag[^>]*>Top 25<\/span>/);
  assert.match(finalScoreboard, />vs Bob<\/span>/);
  assert.match(finalScoreboard, /Sat, Aug 30, 8:00 PM/);

  // The live row keeps the live state, real clock, score fallback, teams,
  // opponent descriptor, and the same non-scheduled kickoff fact.
  assert.match(liveScoreboard, /data-scoreboard-state="live"/);
  assert.match(liveScoreboard, />Live<\/span>/);
  assert.match(liveScoreboard, /Q3 8:14/);
  assert.match(participantMarkup(liveScoreboard, 'away'), /Clemson[\s\S]*Alice[\s\S]*>21</);
  assert.match(participantMarkup(liveScoreboard, 'home'), /Miami[\s\S]*Carol[\s\S]*>—</);
  assert.match(liveScoreboard, />vs Carol<\/span>/);
  assert.match(liveScoreboard, /Sat, Aug 30, 8:00 PM/);

  // The scheduled row keeps the matchup relationship, participant names,
  // ranked-FCS distinction through its descriptor fallback, and prefixed
  // kickoff while continuing to hide scores.
  assert.match(scheduledScoreboard, /data-scoreboard-state="scheduled"/);
  assert.match(scheduledScoreboard, /Kickoff Sat, Aug 30, 8:00 PM/);
  assert.match(scheduledScoreboard, /data-scoreboard-team="away">Oregon/);
  assert.match(scheduledScoreboard, /data-scoreboard-team="home">Portland State/);
  assert.match(scheduledScoreboard, /title="AP rank #2">#2/);
  assert.doesNotMatch(scheduledScoreboard, /data-scoreboard-classification="home"/);
  assert.equal(
    (scheduledScoreboard.match(/>FCS<\/span>/g) ?? []).length,
    1,
    'ranked FCS must keep one descriptor while rank occupies the inline prefix'
  );
  assert.doesNotMatch(scheduledScoreboard, /data-scoreboard-value-kind="score"/);

  // Records, broadcast, and textual odds were not bespoke GameRow facts and
  // remain absent even though odds still legitimately produce the tags above.
  assert.doesNotMatch(aliceCard, /data-scoreboard-record/);
  assert.doesNotMatch(aliceCard, /DraftKings/);
  assert.doesNotMatch(aliceCard, /Georgia -7\.5/);
  assert.doesNotMatch(aliceCard, /data-scoreboard-broadcast/);
});

test('provider-classified FCS renders once while conference-only FCS retains its fallback', () => {
  const renderFcsScoreboard = (homeClassification?: 'fcs'): string => {
    const html = renderToStaticMarkup(
      <MatchupsWeekPanel
        games={[
          game({
            key: 'fcs-fallback',
            csvAway: 'Oregon',
            csvHome: 'Portland State',
            homeConf: 'Big Sky',
            homeClassification,
          }),
        ]}
        oddsByKey={{}}
        scoresByKey={{}}
        rosterByTeam={new Map([['Oregon', 'Alice']])}
        displayTimeZone="UTC"
      />
    );
    return scoreboardMarkup(ownerCardMarkup(html, 'Alice'), 'Oregon @ Portland State');
  };

  const classified = renderFcsScoreboard('fcs');
  assert.match(classified, /data-scoreboard-classification="home">FCS<\/span>/);
  assert.equal((classified.match(/>FCS<\/span>/g) ?? []).length, 1);

  const conferenceFallback = renderFcsScoreboard();
  assert.doesNotMatch(conferenceFallback, /data-scoreboard-classification="home"/);
  assert.equal((conferenceFallback.match(/>FCS<\/span>/g) ?? []).length, 1);
});

test('ranked provider-classified FCS keeps one descriptor when rank wins inline precedence', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'ranked-fcs',
          csvAway: 'Oregon',
          csvHome: 'Portland State',
          homeConf: 'Big Sky',
          homeClassification: 'fcs',
        }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map([['Oregon', 'Alice']])}
      rankingsByTeamId={new Map([['h', { rank: 3, rankSource: 'ap' }]])}
      displayTimeZone="UTC"
    />
  );

  const scoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Alice'), 'Oregon @ Portland State');
  assert.match(scoreboard, /title="AP rank #3">#3/);
  assert.doesNotMatch(scoreboard, /data-scoreboard-classification="home"/);
  assert.equal(
    (scoreboard.match(/>FCS<\/span>/g) ?? []).length,
    1,
    'ranked FCS must retain the descriptor when the inline prefix is occupied by rank'
  );
});

test('the final scoreboard in each owner game list drops its trailing divider', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[game({ key: 'last-divider', csvAway: 'Iowa', csvHome: 'Nebraska' })]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Iowa', 'Lane'],
          ['Nebraska', 'Mira'],
        ])
      }
      displayTimeZone="America/New_York"
    />
  );

  const laneCard = ownerCardMarkup(html, 'Lane');
  assert.match(laneCard, /<ul[^>]*border-b-0[^>]*>/);
  assert.match(scoreboardMarkup(laneCard, 'Iowa @ Nebraska'), /class="border-b py-3/);
});

test('every rendered eyebrow tag uses the settled bronze hairline treatment with no fill', () => {
  const scoreboard = scoreboardMarkup(
    ownerCardMarkup(renderCompleteGameRowFactInventory(), 'Alice'),
    'Alabama vs Georgia'
  );
  const tags = Array.from(
    scoreboard.matchAll(/<span(?=[^>]*data-eyebrow-tag)[^>]*>/g),
    (match) => match[0]
  );

  assert.equal(tags.length, 2, 'fixture must render both primary and secondary tags');
  for (const tag of tags) {
    assert.match(tag, /border-\[0\.5px\]/);
    assert.match(tag, /border-\[rgba\(201,166,107,0\.40\)\]/);
    assert.match(tag, /text-\[#dbc190\]/);
    assert.doesNotMatch(tag, /(?:^|\s)(?:dark:)?bg-/);
    assert.doesNotMatch(tag, /blue/);
  }
});

test('outcome rail and neutral card-owner tint coexist as distinguishable row treatments', () => {
  const scoreboard = scoreboardMarkup(
    ownerCardMarkup(renderCompleteGameRowFactInventory(), 'Alice'),
    'Alabama vs Georgia'
  );
  const ownerCard = ownerCardMarkup(renderCompleteGameRowFactInventory(), 'Alice');
  const finalRowTag = ownerCard.match(/<li[^>]*dark:border-l-emerald-500\/70[^>]*>/)?.[0];
  assert.ok(finalRowTag, 'winning outcome rail must remain on the wrapper');

  const awayTag = participantOpeningTag(scoreboard, 'away');
  const homeTag = participantOpeningTag(scoreboard, 'home');
  assert.match(awayTag, /dark:after:bg-\[rgba\(255,255,255,0\.055\)\]/);
  assert.match(awayTag, /after:rounded-\[4px\]/);
  assert.doesNotMatch(awayTag, /emerald|rose/);
  assert.doesNotMatch(homeTag, /dark:after:bg-/);
});

test('shared scoreboard public prop surfaces remain exactly unchanged', () => {
  const source = readFileSync(new URL('../CompactGameScoreboard.tsx', import.meta.url), 'utf8');
  const fieldsFor = (typeName: string): string[] => {
    const body = source.match(new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\};`))?.[1];
    assert.ok(body, `${typeName} must remain exported`);
    return Array.from(body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/gm), (match) => match[1]);
  };

  assert.deepEqual(fieldsFor('CompactScoreboardParticipant'), [
    'teamName',
    'owner',
    'isCardOwnerTeam',
    'rank',
    'rankSource',
    'classification',
    'record',
    'score',
  ]);
  assert.deepEqual(fieldsFor('CompactGameScoreboardProps'), [
    'state',
    'clock',
    'broadcast',
    'neutralSite',
    'scheduleNotice',
    'matchupLabel',
    'away',
    'home',
    'contextSlot',
    'footerSlot',
    'tier2Slot',
  ]);
});

test('CFBScheduleApp forwards the server-projected record map into MatchupsWeekPanel', () => {
  const source = readFileSync(new URL('../CFBScheduleApp.tsx', import.meta.url), 'utf8');
  const matchupsCall = source.match(/<MatchupsWeekPanel[\s\S]*?\/>/)?.[0];

  assert.ok(matchupsCall, 'the MatchupsWeekPanel call site must remain present');
  assert.match(
    matchupsCall,
    /teamRecordsByProviderGameId=\{teamRecordsByProviderGameId\}/,
    'the server-projected record map must cross the CFBScheduleApp boundary'
  );
});

test('owner slates count final owned-vs-owned, NoClaim, and FCS results from owned-team participations', () => {
  const games = [
    game({ key: 'g-owned', csvAway: 'Alabama', csvHome: 'Georgia' }),
    game({ key: 'g-noclaim', csvAway: 'Florida State', csvHome: 'Tulane', homeConf: 'AAC' }),
    game({ key: 'g-fcs', csvAway: 'Kansas State', csvHome: 'North Dakota', homeConf: 'MVFC' }),
  ];
  const rosterByTeam = new Map([
    ['Alabama', 'Avery'],
    ['Georgia', 'Blair'],
    ['Florida State', 'Avery'],
    ['Tulane', 'NoClaim'],
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

  assert.match(html, /data-owner-card="Avery"/);
  assert.doesNotMatch(html, /data-owner-card="NoClaim"/);
  assert.match(html, /2–1/);
  // Avery's three owned participations surface FCS and the owner-vs-owner
  // "vs Blair" badge; the unowned FBS game has no owner badge.
  const averyCard = ownerCardMarkup(html, 'Avery');
  assert.match(averyCard, /FCS/);
  assert.doesNotMatch(averyCard, /NoClaim/);
  assert.match(averyCard, /vs Blair/);
  assert.match(
    html,
    /rounded-xl border p-3\.5 shadow-sm sm:p-4 border-gray-300\/90 bg-white dark:border-zinc-700/
  );
  assert.match(html, /data-owner-card="Blair"/);
  assert.match(html, /0–1/);
  assert.match(html, /dark:border-l-emerald-500\/70/);
  assert.match(html, /dark:border-l-rose-500\/70/);
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

  assert.match(html, /data-owner-card="Casey"/);
  assert.match(html, /1–0 · 1 live/);
  // The final/live/scheduled mix shows three opponent badges on Casey's card;
  // only the final game contributes to the record summary above.
  const caseyCard = ownerCardMarkup(html, 'Casey');
  assert.match(caseyCard, /vs Evan/);
  assert.doesNotMatch(caseyCard, /NoClaim/);
  assert.match(caseyCard, /vs Dana/);
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

  assert.match(html, /data-owner-card="Casey"/);
  assert.match(html, /1–0/);
  // Record summary reflects only the final game; the scheduled game still
  // appears as an opponent badge but does not alter the summary text.
  const caseyCard = ownerCardMarkup(html, 'Casey');
  assert.match(caseyCard, /vs Evan/);
  assert.match(caseyCard, /vs Dana/);
  assert.doesNotMatch(html, /1 final/);
  assert.doesNotMatch(html, /1 scheduled/);
});

test('matchups panel distinguishes unowned fbs opponents from fcs opponents', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({ key: 'g-fbs', csvAway: 'Texas Tech', csvHome: 'Houston', homeConf: 'Big 12' }),
        game({ key: 'g-fcs', csvAway: 'Kansas State', csvHome: 'North Dakota', homeConf: 'MVFC' }),
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

  assert.doesNotMatch(html, /NoClaim/);
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

  // Item 135 retarget: the control counts GAMES, which is what the list
  // renders. Taylor has 8 games (across 5 distinct opponents — Pruitt x2,
  // Carter x3, plus Surowiec/Jordan/Ballard; the previous comment said 6).
  // With more games than the default visible count, the card surfaces a
  // truncation control rather than listing every game inline.
  assert.match(html, /data-owner-card="Taylor"/);
  assert.match(html, /Show \d+ more games/);
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

  // Placeholder opponents keep their championship-slot labels as opponent
  // badges instead of collapsing to a generic "FCS" descriptor.
  assert.match(html, /SEC Team TBD/);
  assert.match(html, /ACC Team TBD/);
  assert.doesNotMatch(html, /vs FCS/);
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

  const scoreboard = scoreboardMarkup(ownerCardMarkup(html, 'Alex'), 'Texas @ Oklahoma');
  assert.match(participantMarkup(scoreboard, 'away'), /data-scoreboard-value="away">24/);
  assert.match(participantMarkup(scoreboard, 'home'), /data-scoreboard-value="home">24/);
  // Item 135 retarget: one self game is one row, so one Final label. Was 2.
  assert.equal((html.match(/>Final<\/span>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Counts as 1W \/ 1L/);
  assert.doesNotMatch(html, /1–1–1/);
});

test('postseason matchups render owner-first cards and preserve neutral-site metadata', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'rose-bowl',
          stage: 'bowl',
          postseasonRole: 'bowl',
          label: 'Rose Bowl',
          neutral: true,
          csvAway: 'Oregon',
          csvHome: 'Ohio State',
        }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Oregon', 'Alice'],
          ['Ohio State', 'Bob'],
        ])
      }
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /data-owner-card="Alice"/);
  assert.match(html, /data-owner-card="Bob"/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /Rose Bowl/);
  assert.match(html, /Neutral site/);
  assert.doesNotMatch(html, /Date TBD/);
});

const canonicalForMatchups: CanonicalStandings = {
  slug: 'tsc',
  year: 2025,
  source: 'live',
  lifecycle: 'mid_season',
  rows: [],
  noClaimRow: null,
  // Canonical: Alice before Bob (alphabetical, NoClaim-filtered).
  ownerColorOrder: ['Alice', 'Bob'],
  standingsHistory: null,
  coverage: { state: 'complete', message: null },
  ownersRosterSource: 'csv',
  archiveYearResolved: null,
  inferredSeasonStart: null,
  generatedAt: '2026-04-26T00:00:00.000Z',
};

function makeLiveDelta(params: { inProgressGameKey?: string; isStale?: boolean }): LiveDelta {
  const { inProgressGameKey, isStale = false } = params;
  const byGame: LiveDelta['byGame'] = {};
  if (inProgressGameKey) {
    byGame[inProgressGameKey] = {
      status: 'inprogress',
      score: null,
      participantTeamIds: [],
    };
  }
  return {
    weekKey: '2025:1',
    generatedAt: '2026-04-26T00:00:00.000Z',
    byGame,
    byOwner: {},
    isStale,
  };
}

test('matchups uses the shared live marker unchanged while freshness behavior remains Item 143', () => {
  const liveDeltas = [
    makeLiveDelta({ inProgressGameKey: 'g-live' }),
    makeLiveDelta({ inProgressGameKey: 'g-live', isStale: true }),
    makeLiveDelta({}),
    null,
  ];

  for (const liveDelta of liveDeltas) {
    const html = renderToStaticMarkup(
      <MatchupsWeekPanel
        games={[game({ key: 'g-live', csvAway: 'Alabama', csvHome: 'Georgia' })]}
        oddsByKey={{}}
        scoresByKey={{
          'g-live': {
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
        displayTimeZone="UTC"
        liveDelta={liveDelta}
      />
    );

    assert.match(html, /data-scoreboard-state="live"/);
    assert.match(html, /dark:text-emerald-400[\s\S]*bg-current[\s\S]*>Live<\/span>/);
    assert.doesNotMatch(html, /data-matchups-live-indicator/);
    assert.doesNotMatch(html, /amber/);
  }
});

test('matchups status color vocabulary reserves one emerald and one rose source token for outcomes', () => {
  const source = readFileSync(new URL('../MatchupsWeekPanel.tsx', import.meta.url), 'utf8');

  assert.equal(
    (source.match(/emerald/g) ?? []).length,
    1,
    'emerald must appear exactly once for finalWin'
  );
  assert.equal(
    (source.match(/rose/g) ?? []).length,
    1,
    'rose must appear exactly once for finalLoss'
  );
  assert.doesNotMatch(source, /amber/);
  assert.doesNotMatch(source, /function performanceClasses/);
});

test('matchups panel reorders owner cards to canonical owner identity when canonical is provided', () => {
  // Without canonical, owner-slate order is whatever deriveOwnerWeekSlates
  // produces. With canonical, Alice's data-owner-card should appear before
  // Bob's regardless of source order.
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({ key: 'g-bob', csvAway: 'Georgia', csvHome: 'Alabama' }),
        game({ key: 'g-alice', csvAway: 'Texas', csvHome: 'Akron', homeConf: 'MAC' }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={
        new Map([
          ['Alabama', 'Bob'],
          ['Georgia', 'Bob'],
          ['Texas', 'Alice'],
        ])
      }
      displayTimeZone="UTC"
      canonicalStandings={canonicalForMatchups}
    />
  );

  const aliceCardIndex = html.indexOf('data-owner-card="Alice"');
  const bobCardIndex = html.indexOf('data-owner-card="Bob"');
  assert.ok(aliceCardIndex >= 0 && bobCardIndex >= 0);
  assert.ok(aliceCardIndex < bobCardIndex, 'Alice card should appear before Bob card');
});

// --- PLATFORM-086E1C1: never present a TBD placeholder time as confirmed -----

test('matchups panel renders date plus Time TBD instead of the placeholder clock', () => {
  const html = renderToStaticMarkup(
    <MatchupsWeekPanel
      games={[
        game({
          key: 'tbd-kickoff',
          csvAway: 'Alabama',
          csvHome: 'Georgia',
          date: '2025-08-30T00:00:00.000Z',
          startTimeTBD: true,
        }),
      ]}
      oddsByKey={{}}
      scoresByKey={{}}
      rosterByTeam={new Map([['Alabama', 'Alice']])}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Kickoff Sat, Aug 30 · Time TBD/);
  assert.doesNotMatch(html, /12:00 AM/);
});
