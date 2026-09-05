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

function headerMarkup(html: string): string {
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(header, 'scoreboard header must render');
  return header;
}

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function classTokens(markup: string): Set<string> {
  const className = markup.match(/class="([^"]*)"/)?.[1] ?? '';
  return new Set(className.split(/\s+/).filter(Boolean));
}

const LIGHT =
  /^(?:text|bg|border)-(?:white|black|(?:gray|zinc|slate|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

function lightHalves(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of match[1].split(/\s+/).filter(Boolean)) {
      const parts = token.replace(/^!/, '').split(':');
      const base = parts.pop() ?? '';
      if (LIGHT.test(base) && !parts.includes('dark')) out.push(token);
    }
  }
  return out;
}

function assertNoNewLightThemeClass(markup: string): void {
  assert.deepEqual(lightHalves(markup), [], 'new scoreboard markup contains light-theme classes');
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

test('prefix markers share zinc-400 while FCS keeps its bordered-pill geometry', () => {
  const rankedHtml = renderScoreboard();
  const rankMarker = rankedHtml.match(/<span class="[^"]*" title="AP rank #7">#7<\/span>/)?.[0];
  assert.ok(rankMarker, 'rank marker must render');
  assert.match(rankMarker, /dark:text-zinc-400/);

  const fcsHtml = renderScoreboard({
    away: {
      teamName: 'UAlbany',
      owner: null,
      rank: null,
      classification: 'fcs',
      score: 10,
    },
  });
  const fcsMarker = fcsHtml.match(
    /<span class="[^"]*" data-scoreboard-classification="away">FCS<\/span>/
  )?.[0];
  assert.ok(fcsMarker, 'FCS classification marker must render');
  const fcsClassTokens = classTokens(fcsMarker);
  for (const className of [
    'rounded-[3px]',
    'border',
    'px-[3px]',
    'text-[9.5px]',
    'font-semibold',
    'leading-[1.4]',
    'tracking-[0.06em]',
    'dark:border-zinc-800',
    'dark:text-zinc-400',
  ]) {
    assert.ok(fcsClassTokens.has(className), `FCS marker must include exact token ${className}`);
  }
});

test('rank wins only as an upstream-data-defect guard when a ranked team is marked FCS', () => {
  const html = renderScoreboard({
    away: {
      teamName: 'Impossible State',
      owner: 'Whited',
      rank: 4,
      rankSource: 'ap',
      classification: 'fcs',
      score: 17,
    },
  });

  assert.match(html, /title="AP rank #4">#4<\/span>/);
  assert.doesNotMatch(html, /data-scoreboard-classification="away"|>FCS<\/span>/);
});

test('only the exact fcs classification renders FCS, never Division II, III, or a near miss', () => {
  const classifications = ['ii', 'iii', 'FCS'] as const;

  for (const classification of classifications) {
    const html = renderScoreboard({
      away: {
        teamName: 'Unranked opponent',
        owner: null,
        rank: null,
        classification: classification as 'fcs',
        score: 10,
      },
    });
    assert.doesNotMatch(
      html,
      /data-scoreboard-classification="away"|>FCS<\/span>/,
      `${classification} must not render the FCS marker`
    );
  }

  const exactHtml = renderScoreboard({
    away: {
      teamName: 'Exact FCS opponent',
      owner: null,
      rank: null,
      classification: 'fcs',
      score: 10,
    },
  });
  assert.match(exactHtml, /data-scoreboard-classification="away">FCS<\/span>/);
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
    /overflow-hidden whitespace-nowrap text-xs dark:text-zinc-400" data-scoreboard-header/
  );
  assert.match(html, /flex min-w-0 items-baseline gap-1\.5 overflow-hidden whitespace-nowrap/);
  assert.match(html, /title="CFP rank #24"/);
  assert.match(
    html,
    /class="min-w-0 truncate"><span data-scoreboard-team="away">Middle Tennessee State University/
  );
});

test('live scoreboard expresses live state in green with no amber utility', () => {
  const html = renderScoreboard();

  assert.match(html, /size-1\.5 rounded-full bg-current/);
  assert.match(html, /dark:text-emerald-400/);
  assert.doesNotMatch(html, /amber/);
  assert.match(html, /data-scoreboard-state="live"/);
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

test('broadcast renders on scheduled, live, and awaiting scoreboards but not finals', () => {
  for (const state of ['scheduled', 'live', 'awaiting'] as const) {
    const html = renderScoreboard({
      state,
      clock: state === 'scheduled' ? undefined : 'Q2 4:10',
      broadcast: 'ESPN2',
    });
    assert.match(headerMarkup(html), />ESPN2<\/span>/, `${state} must retain its broadcast`);
  }

  const finalHtml = renderScoreboard({ state: 'final', broadcast: 'ESPN2' });
  assert.doesNotMatch(headerMarkup(finalHtml), /ESPN2/);
});

test('scheduled headers open with a lone broadcast or neutral-site marker without an orphan bullet', () => {
  const broadcastHeader = headerMarkup(
    renderScoreboard({ state: 'scheduled', clock: undefined, broadcast: 'ABC' })
  );
  assert.match(broadcastHeader, /^<span[^>]*>ABC<\/span>$/);
  assert.doesNotMatch(broadcastHeader, /•/);

  const neutralHeader = headerMarkup(
    renderScoreboard({ state: 'scheduled', clock: undefined, neutralSite: true })
  );
  assert.match(neutralHeader, /^<span[^>]*data-scoreboard-neutral-site[^>]*>Neutral site<\/span>$/);
  assert.doesNotMatch(neutralHeader, /•/);
});

test('header separators divide kickoff, broadcast, and neutral-site metadata', () => {
  const header = headerMarkup(
    renderScoreboard({
      state: 'scheduled',
      clock: 'Sat, Sep 5, 7:30 PM',
      broadcast: 'ABC',
      neutralSite: true,
    })
  );

  assert.equal(occurrenceCount(header, '>•</span>'), 2);
  assert.ok(header.indexOf('Sat, Sep 5, 7:30 PM') < header.indexOf('ABC'));
  assert.ok(header.indexOf('ABC') < header.indexOf('Neutral site'));
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

test('scoreboard exposes a constrained additive tier-2 slot after the reserved odds band', () => {
  const html = renderScoreboard({
    state: 'scheduled',
    footerSlot: 'Ohio State -7.5 · O/U 48.5',
    tier2Slot: <div>Venue and conference details</div>,
  });
  const tier2OpeningTag = html.match(
    /<div(?=[^>]*class="[^"]*")(?=[^>]*data-scoreboard-tier2-slot)[^>]*>/
  )?.[0];

  assert.ok(tier2OpeningTag, 'tier-2 slot must render when supplied');
  assert.match(tier2OpeningTag, /class="mt-1\.5 min-w-0 overflow-hidden"/);
  assert.match(html, /data-scoreboard-tier2-slot[^>]*>[\s\S]*Venue and conference details/);
  assert.ok(
    html.indexOf('data-scoreboard-odds-footer') < html.indexOf('data-scoreboard-tier2-slot'),
    'the reserved odds band must remain above tier 2'
  );
});

test('optional wrappers reject React-empty content recursively while preserving zero', () => {
  const emptySlots: React.ReactNode[] = [
    null,
    undefined,
    false,
    true,
    '',
    [],
    [null, false, '', []],
    [[[], [false, [null]]]],
  ];

  for (const emptySlot of emptySlots) {
    const html = renderScoreboard({ contextSlot: emptySlot, tier2Slot: emptySlot });
    assert.doesNotMatch(html, /data-scoreboard-context-slot/);
    assert.doesNotMatch(html, /data-scoreboard-tier2-slot/);
  }

  const zeroHtml = renderScoreboard({ contextSlot: 0, tier2Slot: 0 });
  assert.match(zeroHtml, /data-scoreboard-context-slot[^>]*>0<\/div>/);
  assert.match(zeroHtml, /data-scoreboard-tier2-slot[^>]*>0<\/div>/);

  const nestedContentHtml = renderScoreboard({
    contextSlot: [null, [false, <span key="context">Context</span>]],
    tier2Slot: [[<span key="tier-2">Tier 2</span>]],
  });
  assert.match(nestedContentHtml, /data-scoreboard-context-slot[^>]*>[\s\S]*Context/);
  assert.match(nestedContentHtml, /data-scoreboard-tier2-slot[^>]*>[\s\S]*Tier 2/);
});

test('scheduled peers reserve equal odds bands with and without odds across tier-2 states', () => {
  for (const tier2Slot of [null, <span key="tier-2">Tier 2</span>]) {
    const html = renderToStaticMarkup(
      <div className="grid grid-cols-2">
        <CompactGameScoreboard
          state="scheduled"
          matchupLabel="Away at Home with odds"
          away={{ teamName: 'Away', score: null }}
          home={{ teamName: 'Home', score: null }}
          footerSlot="Home -7.5 · O/U 48.5"
          tier2Slot={tier2Slot}
        />
        <CompactGameScoreboard
          state="scheduled"
          matchupLabel="Away at Home without odds"
          away={{ teamName: 'Away', score: null }}
          home={{ teamName: 'Home', score: null }}
          footerSlot={null}
          tier2Slot={tier2Slot}
        />
      </div>
    );
    const scoreboards = html.match(/<article[\s\S]*?<\/article>/g) ?? [];

    assert.equal(scoreboards.length, 2, 'the peer pair must render two scoreboards');
    for (const scoreboard of scoreboards) {
      const footerOpeningTag = scoreboard.match(
        /<div(?=[^>]*class="[^"]*")(?=[^>]*data-scoreboard-odds-footer)[^>]*>/
      )?.[0];
      assert.ok(footerOpeningTag, 'every scheduled peer must render its odds footer');
      assert.equal(
        occurrenceCount(scoreboard, 'data-scoreboard-odds-footer'),
        1,
        'every scheduled peer reserves exactly one odds band'
      );
      // Static markup cannot measure layout height. This exact token is the structural pin for the
      // minimum-height reservation that keeps empty and populated peer bands aligned.
      assert.ok(
        classTokens(footerOpeningTag).has('min-h-4'),
        'the odds footer must structurally reserve its minimum height'
      );
      assert.equal(
        occurrenceCount(scoreboard, 'data-scoreboard-tier2-slot'),
        tier2Slot === null ? 0 : 1,
        'peer cards must have the same tier-2 structure'
      );
    }
  }
});

test('new scoreboard additions reject light-theme utility classes, including unnumbered tokens', () => {
  const html = renderScoreboard({
    state: 'scheduled',
    neutralSite: true,
    away: {
      teamName: 'FCS opponent',
      rank: null,
      classification: 'fcs',
      score: null,
    },
    tier2Slot: <span>Tier 2</span>,
  });
  const newMarkup = [
    html.match(/<span[^>]*data-scoreboard-classification="away"[^>]*>/)?.[0],
    html.match(/<span[^>]*data-scoreboard-neutral-site[^>]*>/)?.[0],
    html.match(/<div[^>]*data-scoreboard-tier2-slot[^>]*>/)?.[0],
  ];

  assert.ok(newMarkup.every(Boolean), 'all new scoreboard elements must render for the guard');
  assertNoNewLightThemeClass(newMarkup.join(''));

  for (const forbidden of [
    'bg-white',
    'text-black',
    'text-white',
    'text-gray-500',
    'border-zinc-800',
    'bg-slate-950',
    'hover:bg-white',
    'focus:text-gray-500',
    'md:bg-zinc-100',
    'group-hover:text-black',
    '!text-white',
    'text-white/50',
  ]) {
    assert.deepEqual(
      lightHalves(`<span class="${forbidden}">bad</span>`),
      [forbidden],
      `positive control must flag ${forbidden}`
    );
  }

  for (const allowed of [
    'dark:text-zinc-400',
    'dark:hover:text-white',
    'text-[9.5px]',
    'rounded-[3px]',
  ]) {
    assert.deepEqual(
      lightHalves(`<span class="${allowed}">allowed</span>`),
      [],
      `${allowed} must remain allowed`
    );
  }
});

test('every scoreboard state excludes the inaccessible dark zinc-500 text token', () => {
  const html = (['scheduled', 'live', 'awaiting', 'final'] as const)
    .map((state) =>
      renderScoreboard({
        state,
        neutralSite: true,
        away: {
          teamName: 'FCS opponent',
          owner: 'Whited',
          rank: null,
          classification: 'fcs',
          record: { wins: 3, losses: 2 },
          score: state === 'scheduled' ? null : 17,
        },
        home: {
          teamName: 'Ohio State',
          owner: 'Chamness',
          rank: 7,
          rankSource: 'ap',
          record: { wins: 5, losses: 0 },
          score: state === 'scheduled' ? null : 24,
        },
      })
    )
    .join('');

  assert.doesNotMatch(html, /dark:text-zinc-500/);
});

test('live scoreboard omits the clock node when no trustworthy clock is available', () => {
  const html = renderScoreboard({ clock: '  ' });
  const header = html.match(/<div[^>]+data-scoreboard-header[^>]*>([\s\S]*?)<\/div>/)?.[1];

  assert.ok(header, 'scoreboard header must render');
  assert.match(header, />Live<\/span>/);
  assert.doesNotMatch(header, /tabular-nums/);
});
