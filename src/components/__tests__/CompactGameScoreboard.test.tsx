import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CompactGameScoreboard from '../CompactGameScoreboard';

function renderScoreboard(
  overrides: Partial<React.ComponentProps<typeof CompactGameScoreboard>> = {}
): string {
  return renderToStaticMarkup(
    <CompactGameScoreboard
      state="live"
      clock="Q3 8:12"
      matchupLabel="Michigan at Ohio State"
      away={{ teamName: 'Michigan', owner: 'Whited', rank: null, score: 17 }}
      home={{
        teamName: 'Ohio State',
        owner: 'Chamness',
        rank: 7,
        rankSource: 'ap',
        score: 24,
      }}
      {...overrides}
    />
  );
}

test('live scoreboard keeps away above a leading home team and emphasizes the bottom line', () => {
  const html = renderScoreboard();
  const awayRow = html.indexOf('data-scoreboard-side="away"');
  const homeRow = html.indexOf('data-scoreboard-side="home"');

  assert.ok(awayRow >= 0 && homeRow > awayRow, 'away must remain above home');
  assert.match(html, /data-scoreboard-side="away" data-scoreboard-leading="false"/);
  assert.match(
    html,
    /font-semibold dark:text-zinc-50" data-scoreboard-side="home" data-scoreboard-leading="true"/
  );
  assert.match(html, /title="AP rank #7">#7[\s\S]*Ohio State[\s\S]*Chamness[\s\S]*>24</);
});

test('live scoreboard renders an unowned opponent as team-only', () => {
  const html = renderScoreboard({
    away: { teamName: 'Purdue', owner: null, rank: null, score: 6 },
    home: { teamName: 'Penn State', owner: 'Chamness', rank: null, score: 14 },
  });

  assert.match(html, /data-scoreboard-team="away">Purdue<\/span>/);
  assert.doesNotMatch(html, /data-scoreboard-owner="away"/);
  assert.match(html, /data-scoreboard-owner="home">Chamness<\/span>/);
});

test('live scoreboard renders the same owner as each team suffix when one owner holds both sides', () => {
  const html = renderScoreboard({
    away: { teamName: 'Jacksonville State', owner: 'Whited', rank: null, score: 14 },
    home: { teamName: 'North Dakota State', owner: 'Whited', rank: null, score: 10 },
  });

  assert.match(html, /data-scoreboard-owner="away">Whited<\/span>/);
  assert.match(html, /data-scoreboard-owner="home">Whited<\/span>/);
});

test('live scoreboard keeps its header and long team-owner identities on one clipped line', () => {
  const html = renderScoreboard({
    clock: 'Q4 10:59',
    away: {
      teamName: 'Middle Tennessee State University',
      owner: 'An Exceptionally Long Owner Name',
      rank: 24,
      rankSource: 'cfp',
      score: 20,
    },
  });

  assert.match(
    html,
    /overflow-hidden whitespace-nowrap text-xs dark:text-zinc-500" data-scoreboard-header/
  );
  assert.match(html, /flex min-w-0 items-baseline gap-1\.5 overflow-hidden whitespace-nowrap/);
  assert.match(html, /title="CFP rank #24"/);
  assert.match(
    html,
    /class="min-w-0 truncate"><span data-scoreboard-team="away">Middle Tennessee State University/
  );
});

test('ranked FCS participant renders its rank instead of an FCS marker', () => {
  const html = renderScoreboard({
    away: {
      teamName: 'Montana State',
      owner: null,
      rank: 12,
      rankSource: 'ap',
      classification: 'fcs',
      score: 20,
    },
  });
  const awayRow = html.match(/<div[^>]*data-scoreboard-side="away"[\s\S]*?<\/div>/)?.[0];

  assert.ok(awayRow, 'away row must render');
  assert.match(awayRow, /title="AP rank #12">#12<\/span>/);
  assert.doesNotMatch(awayRow, /data-scoreboard-classification="away"|>FCS<\/span>/);
});

test('unranked exact FCS participant renders the classification marker', () => {
  const html = renderScoreboard({
    away: {
      teamName: 'Montana State',
      owner: null,
      rank: null,
      classification: 'fcs',
      score: 20,
    },
  });

  assert.match(
    html,
    /data-scoreboard-classification="away">FCS<\/span>[\s\S]*data-scoreboard-team="away">Montana State<\/span>/
  );
});

test('classification marker rejects a case-variant near miss', () => {
  const html = renderScoreboard({
    away: {
      teamName: 'Montana State',
      owner: null,
      rank: null,
      classification: 'FCS' as unknown as 'fcs',
      score: 20,
    },
  });

  assert.doesNotMatch(html, /data-scoreboard-classification="away"|>FCS<\/span>/);
});

test('live scoreboard expresses live state in green with no amber utility', () => {
  const html = renderScoreboard();

  assert.match(html, /size-1\.5 rounded-full bg-current/);
  assert.match(html, /dark:text-emerald-400/);
  assert.doesNotMatch(html, /amber/);
  assert.match(html, /data-scoreboard-state="live"/);
});

test('neutral-site prop renders a marker in the scoreboard header', () => {
  const html = renderScoreboard({ neutralSite: true });
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(header, 'scoreboard header must render');
  assert.match(header, /data-scoreboard-neutral-site="true">Neutral site<\/span>/);
});

test('scheduled header opens with the neutral-site marker rather than an orphan separator', () => {
  const html = renderScoreboard({
    state: 'scheduled',
    clock: undefined,
    neutralSite: true,
    away: { teamName: 'Michigan', owner: 'Whited', rank: null, score: null },
    home: { teamName: 'Ohio State', owner: 'Chamness', rank: null, score: null },
  });
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(header, 'scoreboard header must render');
  assert.match(header, /data-scoreboard-neutral-site="true">Neutral site<\/span>/);
  assert.doesNotMatch(header, /•/);
});

test('scheduled header opens with the broadcast rather than an orphan separator', () => {
  const html = renderScoreboard({
    state: 'scheduled',
    clock: undefined,
    broadcast: 'ESPN2',
    away: { teamName: 'Michigan', owner: 'Whited', rank: null, score: null },
    home: { teamName: 'Ohio State', owner: 'Chamness', rank: null, score: null },
  });
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(header, 'scoreboard header must render');
  assert.match(header, />ESPN2<\/span>/);
  assert.doesNotMatch(header, /•/);
});

test('header separators still divide the segments that follow an earlier one', () => {
  const html = renderScoreboard({ broadcast: 'ESPN2', neutralSite: true });
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(header, 'scoreboard header must render');
  assert.match(
    header,
    /Q3 8:12<\/span>.*?•.*?>ESPN2<\/span>.*?•.*?data-scoreboard-neutral-site="true"/
  );
});

test('awaiting scoreboard still carries the broadcast of a game that is on the air', () => {
  const html = renderScoreboard({
    state: 'awaiting',
    clock: undefined,
    broadcast: 'ESPN2',
    away: { teamName: 'Michigan', owner: 'Whited', rank: null, score: null },
    home: { teamName: 'Ohio State', owner: 'Chamness', rank: null, score: null },
  });
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(header, 'scoreboard header must render');
  assert.match(header, />Awaiting score<\/span>.*?•.*?>ESPN2<\/span>/);
});

test('live scoreboard renders a supplied broadcast while final scoreboard omits it', () => {
  const liveHtml = renderScoreboard({ broadcast: 'ESPN2' });
  const finalHtml = renderScoreboard({ state: 'final', broadcast: 'ESPN2' });

  assert.match(liveHtml, />ESPN2<\/span>/);
  assert.doesNotMatch(finalHtml, />ESPN2<\/span>/);
});

test('awaiting scoreboard uses a neutral status row without claiming the game is live', () => {
  const html = renderScoreboard({
    state: 'awaiting',
    clock: undefined,
    away: { teamName: 'Michigan', owner: 'Whited', rank: null, score: null },
    home: { teamName: 'Ohio State', owner: 'Chamness', rank: null, score: null },
  });
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(header, 'scoreboard header must render');
  assert.match(html, /data-scoreboard-state="awaiting"/);
  assert.match(header, />Awaiting score<\/span>/);
  assert.match(header, /dark:text-zinc-400/);
  assert.doesNotMatch(header, />Live<\/span>|dark:text-emerald-400|rounded-full bg-current/);
});

test('final scoreboard keeps away above a winning home team and uses neutral final status', () => {
  const html = renderScoreboard({
    state: 'final',
    clock: 'Sat, Dec 19, 7:00 PM',
    away: { teamName: 'Michigan', owner: 'Whited', rank: null, score: 17 },
    home: {
      teamName: 'Ohio State',
      owner: 'Chamness',
      rank: 7,
      rankSource: 'ap',
      score: 24,
    },
  });
  const awayRow = html.indexOf('data-scoreboard-side="away"');
  const homeRow = html.indexOf('data-scoreboard-side="home"');
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(awayRow >= 0 && homeRow > awayRow, 'away must remain above home');
  assert.match(html, /data-scoreboard-side="away" data-scoreboard-leading="false"/);
  assert.match(
    html,
    /font-semibold dark:text-zinc-50" data-scoreboard-side="home" data-scoreboard-leading="true"/
  );
  assert.ok(header, 'scoreboard header must render');
  assert.match(header, />Final<\/span>/);
  assert.match(header, />Sat, Dec 19, 7:00 PM<\/span>/);
  assert.doesNotMatch(header, /rounded-full bg-current|Live/);
  assert.doesNotMatch(html, /emerald|amber/);
  assert.match(html, /data-scoreboard-state="final"/);
});

test('scoreboard exposes an additive context slot above its state row', () => {
  const html = renderScoreboard({ contextSlot: <span>Rivalry reason</span> });

  assert.match(html, /data-scoreboard-context-slot/);
  assert.ok(
    html.indexOf('Rivalry reason') < html.indexOf('data-scoreboard-header'),
    'context must render before the scoreboard state row'
  );
});

test('scoreboard exposes an additive tier-2 slot after its primary rows', () => {
  const html = renderScoreboard({ tier2Slot: <span>Venue and conference</span> });

  assert.match(html, /class="mt-1\.5 min-w-0 overflow-hidden" data-scoreboard-tier-2-slot/);
  assert.ok(
    html.indexOf('data-scoreboard-side="home"') < html.indexOf('Venue and conference'),
    'tier-2 content must follow the primary scoreboard rows'
  );
});

test('live scoreboard omits the clock node when no trustworthy clock is available', () => {
  const html = renderScoreboard({ clock: '  ' });
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(header, 'scoreboard header must render');
  assert.match(header, />Live<\/span>/);
  assert.doesNotMatch(header, /tabular-nums/);
});
