import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildScoreboardTeamColorsById } from '../../lib/teamColors';
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

function directScoreboardRows(html: string): string[] {
  const document = new JSDOM(html).window.document;
  const scoreboard = document.querySelector('[data-game-scoreboard]');
  assert.ok(scoreboard, 'scoreboard must render');
  return Array.from(
    scoreboard.children,
    (element) => element.getAttribute('data-scoreboard-side') ?? 'header'
  );
}

function classTokens(markup: string): Set<string> {
  const className = (markup.match(/class="([^"]*)"/)?.[1] ?? '').replaceAll('&#x27;', "'");
  return new Set(className.split(/\s+/).filter(Boolean));
}

function participantOpeningTag(html: string, side: 'away' | 'home'): string {
  const row = html.match(new RegExp(`<div(?=[^>]*data-scoreboard-side="${side}")[^>]*>`))?.[0];
  assert.ok(row, `${side} participant row must render`);
  return row;
}

function participantMarkup(html: string, side: 'away' | 'home'): string {
  const row = html.match(
    new RegExp(`<div(?=[^>]*data-scoreboard-side="${side}")[^>]*>[\\s\\S]*?<\\/div>`)
  )?.[0];
  assert.ok(row, `${side} participant row must render`);
  return row;
}

function participantFactMarkup(html: string, selector: string, message: string): string {
  const element = new JSDOM(html).window.document.querySelector(selector);
  assert.ok(element, message);
  return element.outerHTML;
}

function EmptyFooterSlot(): null {
  return null;
}

const SCOREBOARD_STATES = ['scheduled', 'live', 'awaiting', 'final'] as const;
type Participant = React.ComponentProps<typeof CompactGameScoreboard>['away'];
type CardOwnerFlag = boolean | undefined | 'absent';

function participantWithCardOwnerFlag(side: 'away' | 'home', flag: CardOwnerFlag): Participant {
  const participant: Participant =
    side === 'away'
      ? { teamName: 'Michigan', owner: 'Whited', rank: null, score: 17 }
      : {
          teamName: 'Ohio State',
          owner: 'Chamness',
          rank: 7,
          rankSource: 'ap',
          score: 24,
        };

  return flag === 'absent' ? participant : { ...participant, isCardOwnerTeam: flag };
}

const THEME_COLOR_UTILITY_FAMILIES = [
  'accent',
  'bg',
  'border',
  'caret',
  'decoration',
  'divide',
  'drop-shadow',
  'fill',
  'from',
  'inset-ring',
  'inset-shadow',
  'outline',
  'placeholder',
  'ring',
  'ring-offset',
  'shadow',
  'stroke',
  'text',
  'text-shadow',
  'to',
  'via',
] as const;
const THEME_COLOR_UTILITY_FAMILY_PATTERN = [...THEME_COLOR_UTILITY_FAMILIES]
  .sort((left, right) => right.length - left.length)
  .join('|');
const THEME_COLOR_UTILITY_PREFIX_PATTERN = `(${THEME_COLOR_UTILITY_FAMILY_PATTERN})(?:-[trblxyse])?`;
const LIGHT = new RegExp(
  String.raw`^${THEME_COLOR_UTILITY_PREFIX_PATTERN}-(?:white|black|(?:gray|zinc|slate|neutral|stone)-\d{2,3})(?:\/[^\s]+)?$`
);
const ARBITRARY_THEME_VALUE_PREFIX = new RegExp(`^${THEME_COLOR_UTILITY_PREFIX_PATTERN}-`);
const CSS_DIMENSION = /^(?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|[a-z]+)|-?0+(?:\.0+)?)$/i;
const CSS_DIMENSION_FUNCTION = /^(?:calc|min|max|clamp)\(/i;

function tailwindTokenParts(token: string): { base: string; variants: string[] } {
  const normalized = token.replace(/^!/, '');
  const parts: string[] = [];
  let nestingDepth = 0;
  let partStart = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '[' || character === '(') nestingDepth += 1;
    if (character === ']' || character === ')') nestingDepth = Math.max(0, nestingDepth - 1);
    if (character === ':' && nestingDepth === 0) {
      parts.push(normalized.slice(partStart, index));
      partStart = index + 1;
    }
  }

  return {
    base: normalized.slice(partStart).replace(/^!|!$/g, ''),
    variants: parts,
  };
}

function isArbitraryThemeValue(base: string): boolean {
  const propertyMatch = base.match(ARBITRARY_THEME_VALUE_PREFIX);
  if (!propertyMatch) return false;
  const property = propertyMatch[1];
  const remainder = base.slice(propertyMatch[0].length);
  const opener = remainder[0];
  if (opener !== '[' && opener !== '(') return false;
  const closer = opener === '[' ? ']' : ')';
  let depth = 0;
  let valueEnd = -1;

  for (let index = 0; index < remainder.length; index += 1) {
    if (remainder[index] === opener) depth += 1;
    if (remainder[index] === closer) depth -= 1;
    if (depth === 0) {
      valueEnd = index;
      break;
    }
  }

  if (valueEnd < 0) return false;
  const modifier = remainder.slice(valueEnd + 1);
  if (modifier !== '' && !/^\/[^\s]+$/.test(modifier)) return false;
  const rawValue = remainder.slice(1, valueEnd);

  // Arbitrary backgrounds can paint colors or images. Requiring an explicit exception keeps a
  // future addition from bypassing this theme guard through another valid CSS spelling.
  if (property === 'bg') return true;

  // Unambiguous dimension-only values control geometry, not color. Composite values in every
  // guarded family are deliberately treated as theme-bearing: even a legitimately dark value such
  // as `shadow-[0_2px_8px_rgba(0,0,0,0.6)]` requires an exact allowlist entry. That conservative
  // speed bump avoids growing a partial CSS color parser whose unhandled forms silently escape.
  return (
    !CSS_DIMENSION.test(rawValue) &&
    !CSS_DIMENSION_FUNCTION.test(rawValue) &&
    !rawValue.startsWith('length:')
  );
}

function lightHalves(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of match[1].split(/\s+/).filter(Boolean)) {
      const { base, variants } = tailwindTokenParts(token);
      const isLightOrDarkColor = LIGHT.test(base) || isArbitraryThemeValue(base);
      if (isLightOrDarkColor && !variants.includes('dark')) {
        out.push(token);
      }
    }
  }
  return out;
}

function assertNoNewLightThemeClass(markup: string): void {
  assert.deepEqual(lightHalves(markup), [], 'new scoreboard markup contains light-theme classes');
}

function verticalInsetFromClasses(classes: Set<string>): number {
  const insetClass = [...classes].find((className) => className.startsWith('after:inset-['));
  assert.ok(insetClass, 'tinted row must include an arbitrary inset utility');
  const verticalValue = insetClass.match(
    /^after:inset-\[(-?(?:\d+(?:\.\d+)?|\.\d+))(?:[a-z%]+)?_/i
  )?.[1];
  assert.ok(verticalValue, `must parse vertical inset from ${insetClass}`);
  return Number(verticalValue);
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

test('classification markers identify both participant sides', () => {
  const awayHtml = renderScoreboard({
    away: {
      teamName: 'Away FCS opponent',
      owner: null,
      rank: null,
      classification: 'fcs',
      score: 10,
    },
  });
  assert.match(awayHtml, /data-scoreboard-classification="away">FCS<\/span>/);

  const homeHtml = renderScoreboard({
    home: {
      teamName: 'Home FCS opponent',
      owner: null,
      rank: null,
      classification: 'fcs',
      score: 24,
    },
  });
  assert.match(homeHtml, /data-scoreboard-classification="home">FCS<\/span>/);
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

test('team-colour bars use the exact full-opacity 8px line-start treatment without widening the row', () => {
  const html = renderScoreboard({
    away: {
      teamName: 'Michigan',
      teamColor: '#4A8FE0',
      owner: 'Whited',
      rank: null,
      score: 17,
    },
    home: {
      teamName: 'Ohio State',
      teamColor: null,
      owner: 'Chamness',
      rank: 7,
      rankSource: 'ap',
      score: 24,
    },
  });
  const document = new JSDOM(html).window.document;
  const awayBar = document.querySelector('[data-scoreboard-team-color="away"]');
  assert.ok(awayBar, 'a normalized catalog colour must render a bar');
  assert.deepEqual(
    new Set(awayBar.className.split(/\s+/)),
    new Set(['absolute', 'inset-y-0.5', 'left-0', 'block', 'w-2', 'rounded-[2px]'])
  );
  assert.doesNotMatch(awayBar.className, /opacity-/, 'the normalised band renders at full opacity');
  assert.equal(awayBar.getAttribute('aria-hidden'), 'true');
  assert.equal(awayBar.getAttribute('style'), 'background-color:#4A8FE0');
  assert.equal(document.querySelectorAll('[data-scoreboard-team-color]').length, 1);
  assert.equal(document.querySelector('[data-scoreboard-team-color="home"]'), null);

  for (const side of ['away', 'home'] as const) {
    const rowClasses = classTokens(participantOpeningTag(html, side));
    assert.ok(rowClasses.has('relative'), `${side} row must establish the containing block`);
    assert.ok(rowClasses.has('pl-4'), `${side} row must take its 16px slot from existing width`);
  }
});

test('alternate-colour prototype draws a 1px inset edge without changing the 8px bar width', () => {
  const html = renderScoreboard({
    away: {
      teamName: 'App State',
      teamColor: { fillColor: '#4E4E4E', outlineColor: '#FFCD00' },
      owner: 'Whited',
      rank: null,
      score: 17,
    },
  });
  const document = new JSDOM(html).window.document;
  const bar = document.querySelector('[data-scoreboard-team-color="away"]');

  assert.ok(bar);
  assert.match(bar.className, /(?:^|\s)w-2(?:\s|$)/);
  assert.equal(bar.getAttribute('data-scoreboard-team-color-outline'), 'alternate');
  assert.equal(
    bar.getAttribute('style'),
    'background-color:#4E4E4E;box-shadow:inset 0 0 0 1px #FFCD00'
  );
});

test('team-logo prototype uses dark-surface CFBD artwork inside the existing line-start slot', () => {
  const html = renderScoreboard({
    away: {
      teamName: 'Ohio State',
      teamColor: '#CC4E54',
      teamLogo: {
        lightUrl: 'https://cdn.collegefootballdata.com/logos/32/194.png',
        darkUrl: 'https://cdn.collegefootballdata.com/logos-dark/32/194.png',
        displaySize: 14,
      },
      owner: 'Gladney',
      rank: 1,
      score: 17,
    },
  });
  const document = new JSDOM(html).window.document;
  const image = document.querySelector('[data-scoreboard-team-logo="away"]');

  assert.ok(image);
  assert.equal(image.getAttribute('aria-hidden'), 'true');
  assert.match(image.className, /h-\[14px\]/);
  assert.match(image.className, /w-\[14px\]/);
  assert.equal(
    image.getAttribute('src'),
    'https://cdn.collegefootballdata.com/logos-dark/32/194.png'
  );
  assert.equal(image.getAttribute('alt'), '');
  assert.equal(image.getAttribute('width'), '14');
  assert.equal(image.getAttribute('height'), '14');
  assert.equal(document.querySelector('[data-scoreboard-team-color="away"]'), null);
  assert.ok(classTokens(participantOpeningTag(html, 'away')).has('pl-4'));
});

test('logo prototypes through 24px grow only the horizontal slot', () => {
  for (const [displaySize, imageClass, paddingClass] of [
    [18, 'h-[18px]', 'pl-[22px]'],
    [20, 'h-5', 'pl-6'],
    [22, 'h-[22px]', 'pl-[26px]'],
    [24, 'h-6', 'pl-7'],
  ] as const) {
    const html = renderScoreboard({
      away: {
        teamName: 'Ohio State',
        score: null,
        teamLogo: {
          lightUrl: 'https://cdn.collegefootballdata.com/logos/48/194.png',
          darkUrl: 'https://cdn.collegefootballdata.com/logos-dark/48/194.png',
          displaySize,
        },
      },
    });
    const document = new JSDOM(html).window.document;
    const image = document.querySelector('[data-scoreboard-team-logo="away"]');

    assert.ok(image);
    assert.match(
      image.className,
      new RegExp(imageClass.replaceAll('[', '\\[').replaceAll(']', '\\]'))
    );
    assert.equal(image.getAttribute('width'), String(displaySize));
    assert.ok(classTokens(participantOpeningTag(html, 'away')).has(paddingClass));
    assert.ok(classTokens(participantOpeningTag(html, 'away')).has('py-0.5'));
  }
});

test('28px logo prototype grows both slots so adjacent rows cannot overlap', () => {
  const html = renderScoreboard({
    away: {
      teamName: 'Ohio State',
      score: null,
      teamLogo: {
        lightUrl: 'https://cdn.collegefootballdata.com/logos/64/194.png',
        darkUrl: 'https://cdn.collegefootballdata.com/logos-dark/64/194.png',
        displaySize: 28,
      },
    },
  });
  const document = new JSDOM(html).window.document;
  const image = document.querySelector('[data-scoreboard-team-logo="away"]');

  assert.ok(image);
  assert.match(image.className, /h-7/);
  assert.ok(classTokens(participantOpeningTag(html, 'away')).has('pl-8'));
  assert.ok(classTokens(participantOpeningTag(html, 'away')).has('py-1.5'));
});

test('catalog fallback stays absent on an FCS team line instead of rendering green', () => {
  const teamColorsById = buildScoreboardTeamColorsById([
    { school: 'Portland State', color: null, altColor: null },
    { school: 'Oregon', color: '#154733', altColor: '#FEE123' },
  ]);
  const html = renderScoreboard({
    state: 'scheduled',
    away: {
      teamName: 'Portland State',
      teamColor: teamColorsById.get('portlandstate'),
      rank: null,
      classification: 'fcs',
      score: null,
    },
    home: {
      teamName: 'Oregon',
      teamColor: teamColorsById.get('oregon'),
      rank: null,
      score: null,
    },
  });

  assert.match(html, /data-scoreboard-classification="away">FCS<\/span>/);
  assert.doesNotMatch(html, /data-scoreboard-team-color="away"/);
  assert.match(html, /data-scoreboard-team-color="home"/);
});

test('adding a team colour leaves team, record, owner, and anchor markup byte-identical', () => {
  const participant: Participant = {
    teamName: 'Michigan',
    owner: 'Whited',
    rank: null,
    record: { wins: 4, losses: 1 },
    score: 17,
  };
  const withoutColor = renderScoreboard({ away: participant });
  const withColor = renderScoreboard({ away: { ...participant, teamColor: '#4A8FE0' } });
  const selectors = [
    ['[data-scoreboard-team="away"]', 'team'],
    ['[data-scoreboard-record="away"]', 'record'],
    ['[data-scoreboard-owner="away"]', 'owner'],
    ['[data-scoreboard-value="away"]', 'anchor'],
  ] as const;

  for (const [selector, fact] of selectors) {
    assert.equal(
      participantFactMarkup(withColor, selector, `${fact} must render with a colour`),
      participantFactMarkup(withoutColor, selector, `${fact} must render without a colour`),
      `${fact} markup must remain byte-identical`
    );
  }
  assert.equal(
    participantOpeningTag(withColor, 'away'),
    participantOpeningTag(withoutColor, 'away'),
    'the slot is structural and must not change row width or classes when colour is absent'
  );
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

test('explicit record states stay equivalent to the former non-scheduled rule across both participants', () => {
  for (const state of SCOREBOARD_STATES) {
    for (const awayHasRecord of [false, true]) {
      for (const homeHasRecord of [false, true]) {
        const html = renderScoreboard({
          state,
          away: {
            teamName: 'Michigan',
            owner: 'Alex',
            isCardOwnerTeam: true,
            record: awayHasRecord ? { wins: 3, losses: 1 } : null,
            score: state === 'scheduled' ? null : 17,
          },
          home: {
            teamName: 'Ohio State',
            owner: 'Alex',
            isCardOwnerTeam: true,
            record: homeHasRecord ? { wins: 4, losses: 0 } : null,
            score: state === 'scheduled' ? null : 24,
          },
        });
        const formerlyShowedInlineRecord = state !== 'scheduled';

        for (const [side, hasRecord] of [
          ['away', awayHasRecord],
          ['home', homeHasRecord],
        ] as const) {
          const row = participantMarkup(html, side);
          assert.equal(
            occurrenceCount(row, `data-scoreboard-record="${side}"`),
            hasRecord && formerlyShowedInlineRecord ? 1 : 0,
            `${state} ${side} must remain equivalent to the former inline-record rule`
          );
          assert.equal(
            occurrenceCount(row, 'data-scoreboard-value-kind="record"'),
            hasRecord && state === 'scheduled' ? 1 : 0,
            `${state} ${side} must preserve its scheduled record anchor`
          );
          assert.equal(
            occurrenceCount(row, 'data-scoreboard-value-kind="score"'),
            state === 'scheduled' ? 0 : 1,
            `${state} ${side} must preserve its state-owned score anchor`
          );
        }

        assert.match(participantOpeningTag(html, 'away'), /dark:after:bg-/);
        assert.match(participantOpeningTag(html, 'home'), /dark:after:bg-/);
      }
    }
  }
});

test('every scoreboard state adds an isolated neutral tint only to the marked participant row', () => {
  const tintClasses = [
    'isolate',
    'after:pointer-events-none',
    'after:absolute',
    'after:inset-[0_-8px]',
    'after:z-[-1]',
    'after:rounded-[4px]',
    'dark:after:bg-[rgba(255,255,255,0.055)]',
    "after:content-['']",
  ];

  for (const state of SCOREBOARD_STATES) {
    for (const markedSide of ['away', 'home'] as const) {
      const unmarkedSide = markedSide === 'away' ? 'home' : 'away';
      const html = renderScoreboard({
        state,
        away: participantWithCardOwnerFlag('away', markedSide === 'away' ? true : 'absent'),
        home: participantWithCardOwnerFlag('home', markedSide === 'home' ? true : 'absent'),
      });
      const markedRow = participantOpeningTag(html, markedSide);
      const markedClasses = classTokens(markedRow);
      const unmarkedClasses = classTokens(participantOpeningTag(html, unmarkedSide));

      assert.ok(
        markedClasses.has('relative') && unmarkedClasses.has('relative'),
        `${state} rows must preserve the shared containing block for the team-colour slot`
      );

      for (const className of tintClasses) {
        assert.ok(
          markedClasses.has(className),
          `${state} ${markedSide} marked row must include exact token ${className}`
        );
        assert.ok(
          !unmarkedClasses.has(className),
          `${state} ${unmarkedSide} unmarked row must omit tint token ${className}`
        );
      }
      assertNoNewLightThemeClass(markedRow);
    }
  }
});

test('every scoreboard state leaves absent, undefined, and false flags byte-identical', () => {
  for (const state of SCOREBOARD_STATES) {
    const withoutFlags = renderScoreboard({
      state,
      away: participantWithCardOwnerFlag('away', 'absent'),
      home: participantWithCardOwnerFlag('home', 'absent'),
    });

    for (const flag of [undefined, false] as const) {
      const html = renderScoreboard({
        state,
        away: participantWithCardOwnerFlag('away', flag),
        home: participantWithCardOwnerFlag('home', flag),
      });

      assert.equal(html, withoutFlags);
      for (const side of ['away', 'home'] as const) {
        assert.ok(
          !classTokens(participantOpeningTag(html, side)).has(
            'dark:after:bg-[rgba(255,255,255,0.055)]'
          ),
          `${state} ${side} row without a true flag must remain untinted`
        );
      }
    }
  }
});

test('every scoreboard state joins both tinted rows without overlap or separation', () => {
  for (const state of SCOREBOARD_STATES) {
    const html = renderScoreboard({
      state,
      away: {
        teamName: 'Jacksonville State',
        owner: 'Whited',
        isCardOwnerTeam: true,
        rank: null,
        score: 14,
      },
      home: {
        teamName: 'North Dakota State',
        owner: 'Whited',
        isCardOwnerTeam: true,
        rank: null,
        score: 10,
      },
    });

    for (const side of ['away', 'home'] as const) {
      const rowClasses = classTokens(participantOpeningTag(html, side));
      assert.ok(rowClasses.has('dark:after:bg-[rgba(255,255,255,0.055)]'));
      assert.ok(rowClasses.has('isolate'));
      assert.equal(
        verticalInsetFromClasses(rowClasses),
        0,
        `${state} ${side} tint must neither overlap nor separate from its adjacent participant row`
      );
      const expectedCornerClass =
        side === 'away' ? 'after:rounded-t-[4px]' : 'after:rounded-b-[4px]';
      const facingCornerClass = side === 'away' ? 'after:rounded-b-[4px]' : 'after:rounded-t-[4px]';
      assert.ok(rowClasses.has(expectedCornerClass));
      assert.ok(!rowClasses.has('after:rounded-[4px]'));
      assert.ok(!rowClasses.has(facingCornerClass));
    }
  }
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

test('overflowing status rows keep equal structure and preserve the fixed tag edge', () => {
  const html = renderScoreboard({
    state: 'scheduled',
    statusLabel: 'SCH',
    clock: 'Saturday, September 5, 2026 at 7:30 PM Central Daylight Time',
    broadcast: 'A very long regional broadcast network name',
    neutralSite: true,
    tagSlot: (
      <>
        <span data-test-tag>Top 25 Matchup</span>
        <span data-test-tag>Upset Watch</span>
      </>
    ),
  });
  const document = new JSDOM(html).window.document;
  const header = document.querySelector('[data-scoreboard-header]');
  const metadata = document.querySelector('[data-scoreboard-header-metadata]');
  const tagSlot = document.querySelector('[data-scoreboard-tag-slot]');
  assert.ok(header && metadata && tagSlot);

  assert.ok(metadata.classList.contains('flex-auto'));
  assert.ok(
    metadata.classList.contains('min-w-0'),
    'metadata must shrink below its content width before the flex-none tag can move'
  );
  assert.ok(metadata.classList.contains('overflow-clip'));
  assert.ok(tagSlot.classList.contains('flex-none'));
  assert.ok(tagSlot.classList.contains('h-4'));
  assert.ok(
    tagSlot.classList.contains('leading-none'),
    'the fixed-height slot must reduce inherited text-xs leading so eyebrow pills fit vertically'
  );
  assert.ok(tagSlot.classList.contains('justify-end'));
  assert.ok(header.classList.contains('overflow-hidden'));
  assert.ok(header.classList.contains('max-sm:flex-wrap'));
  assert.ok(metadata.classList.contains('max-sm:w-full'));
  assert.ok(tagSlot.classList.contains('max-sm:w-full'));
  assert.doesNotMatch(html, /max-sm:whitespace-normal/);
  assert.equal(metadata.nextElementSibling, tagSlot);
  assert.equal(tagSlot.querySelectorAll('[data-test-tag]').length, 2);
  assert.equal(metadata.querySelectorAll('.truncate').length, 2);
  // Static JSDOM markup cannot prove rendered pixel height. This pins the DOM
  // structure and fixed header-row placement that keep tags from adding a line.
  assert.deepEqual(directScoreboardRows(renderScoreboard()), ['header', 'away', 'home']);
  assert.deepEqual(directScoreboardRows(html), ['header', 'away', 'home']);
  const taggedLive = renderScoreboard({ tagSlot: <span>Upset Watch</span> });
  const untaggedScheduled = renderScoreboard({ state: 'scheduled', statusLabel: 'SCH' });
  assert.doesNotMatch(taggedLive, /max-sm:flex-wrap|max-sm:w-full/);
  assert.doesNotMatch(untaggedScheduled, /max-sm:flex-wrap|max-sm:w-full/);
});

test('status-row contract covers every state, zero-to-two tags, and independent metadata', () => {
  for (const state of SCOREBOARD_STATES) {
    for (const tagCount of [0, 1, 2] as const) {
      for (let metadataMask = 0; metadataMask < 8; metadataMask += 1) {
        const clock = metadataMask & 1 ? '7:30 PM' : undefined;
        const broadcast = metadataMask & 2 ? 'ABC' : undefined;
        const neutralSite = Boolean(metadataMask & 4);
        const tags = Array.from({ length: tagCount }, (_, index) => (
          <span key={index} data-contract-tag>
            Tag {index + 1}
          </span>
        ));
        const html = renderScoreboard({
          state,
          statusLabel: 'SCH',
          clock,
          broadcast,
          neutralSite,
          tagSlot: tags,
        });
        const header = headerMarkup(html);
        assert.equal(occurrenceCount(header, 'data-contract-tag'), tagCount);
        assert.equal(occurrenceCount(header, 'data-scoreboard-tag-slot'), tagCount === 0 ? 0 : 1);
        assert.equal(header.includes('7:30 PM'), Boolean(clock));
        assert.equal(header.includes('ABC'), state !== 'final' && Boolean(broadcast));
        assert.equal(header.includes('Neutral site'), neutralSite);
      }
    }
  }
});

test('untagged Overview and Schedule headers remain byte-identical', () => {
  const overview = headerMarkup(
    renderScoreboard({ state: 'scheduled', clock: 'Sat, Sep 5, 7:30 PM', broadcast: 'ABC' })
  );
  const schedule = headerMarkup(
    renderScoreboard({
      state: 'scheduled',
      clock: 'Sat, Sep 5, 7:30 PM',
      broadcast: 'ABC',
      neutralSite: true,
      scheduleNotice: 'Postponed',
    })
  );

  assert.equal(
    overview,
    '<span class="min-w-0 truncate tabular-nums">Sat, Sep 5, 7:30 PM</span><span aria-hidden="true">•</span><span class="min-w-0 truncate">ABC</span>'
  );
  assert.equal(
    schedule,
    '<span class="inline-flex w-fit shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] dark:text-sky-400">Postponed</span><span class="min-w-0 truncate tabular-nums">Sat, Sep 5, 7:30 PM</span><span aria-hidden="true">•</span><span class="min-w-0 truncate">ABC</span><span aria-hidden="true">•</span><span class="shrink-0" data-scoreboard-neutral-site="true">Neutral site</span>'
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

test('broadcast separates neutral-site metadata when neither has an earlier segment', () => {
  const header = headerMarkup(
    renderScoreboard({
      state: 'scheduled',
      clock: undefined,
      broadcast: 'ABC',
      neutralSite: true,
    })
  );

  assert.equal(occurrenceCount(header, '>•</span>'), 1);
  assert.ok(header.indexOf('ABC') < header.indexOf('•'));
  assert.ok(header.indexOf('•') < header.indexOf('Neutral site'));
});

test('schedule notice separates a following broadcast when no clock precedes it', () => {
  const header = headerMarkup(
    renderScoreboard({
      state: 'scheduled',
      clock: undefined,
      scheduleNotice: 'Postponed',
      broadcast: 'ESPN2',
    })
  );

  assert.equal(occurrenceCount(header, '>•</span>'), 1);
  assert.ok(header.indexOf('Postponed') < header.indexOf('•'));
  assert.ok(header.indexOf('•') < header.indexOf('ESPN2'));
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
    <React.Fragment key="empty-fragment" />,
    <React.Fragment key="nested-empty-fragment">{[null, false, '', []]}</React.Fragment>,
    [
      <React.Fragment key="array-empty-fragment" />,
      [
        <React.Fragment key="deep-empty-fragment">
          {[false, [null, <React.Fragment key="deepest-empty-fragment" />]]}
        </React.Fragment>,
      ],
    ],
  ];

  for (const emptySlot of emptySlots) {
    const html = renderScoreboard({
      contextSlot: emptySlot,
      tagSlot: emptySlot,
      footerSlot: emptySlot,
      tier2Slot: emptySlot,
    });
    assert.doesNotMatch(html, /data-scoreboard-context-slot/);
    assert.doesNotMatch(html, /data-scoreboard-tag-slot/);
    assert.doesNotMatch(html, /data-scoreboard-odds-footer/);
    assert.doesNotMatch(html, /data-scoreboard-tier2-slot/);
  }

  const zeroHtml = renderScoreboard({ contextSlot: 0, tagSlot: 0, footerSlot: 0, tier2Slot: 0 });
  assert.match(zeroHtml, /data-scoreboard-context-slot[^>]*>0<\/div>/);
  assert.match(zeroHtml, /data-scoreboard-tag-slot[^>]*>0<\/span>/);
  assert.match(zeroHtml, /data-scoreboard-odds-footer[^>]*>0<\/div>/);
  assert.match(zeroHtml, /data-scoreboard-tier2-slot[^>]*>0<\/div>/);

  const nestedContentHtml = renderScoreboard({
    contextSlot: [
      null,
      [
        false,
        <React.Fragment key="context-fragment">
          <span>Context</span>
        </React.Fragment>,
      ],
    ],
    tier2Slot: [
      [
        <React.Fragment key="tier-2-fragment">
          <span>Tier 2</span>
        </React.Fragment>,
      ],
    ],
  });
  assert.match(nestedContentHtml, /data-scoreboard-context-slot[^>]*>[\s\S]*Context/);
  assert.match(nestedContentHtml, /data-scoreboard-tier2-slot[^>]*>[\s\S]*Tier 2/);
});

test('caller-requested peers reserve equal odds bands with and without rendered odds', () => {
  const tier2Cases: Array<{
    withOdds: React.ReactNode;
    withoutOdds: React.ReactNode;
    expectedCounts: [number, number];
  }> = [
    { withOdds: null, withoutOdds: null, expectedCounts: [0, 0] },
    {
      withOdds: <span>Tier 2 with odds</span>,
      withoutOdds: <span>Tier 2 without odds</span>,
      expectedCounts: [1, 1],
    },
    { withOdds: <span>Tier 2 with odds</span>, withoutOdds: null, expectedCounts: [1, 0] },
    { withOdds: null, withoutOdds: <span>Tier 2 without odds</span>, expectedCounts: [0, 1] },
  ];

  for (const { withOdds, withoutOdds, expectedCounts } of tier2Cases) {
    const html = renderToStaticMarkup(
      <div className="grid grid-cols-2">
        <CompactGameScoreboard
          state="scheduled"
          matchupLabel="Away at Home with odds"
          away={{ teamName: 'Away', score: null }}
          home={{ teamName: 'Home', score: null }}
          footerSlot="Home -7.5 · O/U 48.5"
          tier2Slot={withOdds}
        />
        <CompactGameScoreboard
          state="scheduled"
          matchupLabel="Away at Home without odds"
          away={{ teamName: 'Away', score: null }}
          home={{ teamName: 'Home', score: null }}
          footerSlot={<EmptyFooterSlot />}
          tier2Slot={withoutOdds}
        />
      </div>
    );
    const scoreboards = html.match(/<article[\s\S]*?<\/article>/g) ?? [];

    assert.equal(scoreboards.length, 2, 'the peer pair must render two scoreboards');
    for (const [index, scoreboard] of scoreboards.entries()) {
      const footerOpeningTag = scoreboard.match(
        /<div(?=[^>]*class="[^"]*")(?=[^>]*data-scoreboard-odds-footer)[^>]*>/
      )?.[0];
      assert.ok(footerOpeningTag, 'every caller-requested peer must render its odds footer');
      assert.equal(
        occurrenceCount(scoreboard, 'data-scoreboard-odds-footer'),
        1,
        'every caller-requested peer reserves exactly one odds band'
      );
      // Static markup cannot measure layout height. This exact token is the structural pin for the
      // minimum-height reservation that keeps empty and populated peer bands aligned.
      assert.ok(
        classTokens(footerOpeningTag).has('min-h-4'),
        'the odds footer must structurally reserve its minimum height'
      );
      // Tier 2 reserves nothing: its wrapper follows each card's renderable expansion content.
      assert.equal(
        occurrenceCount(scoreboard, 'data-scoreboard-tier2-slot'),
        expectedCounts[index],
        'each peer must render exactly its own tier-2 expansion wrapper'
      );
    }
  }
});

test('new scoreboard additions reject named and arbitrary values across one guarded utility space', () => {
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

  const forbiddenThemeClasses = new Set([
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
    'bg-white/[0.055]',
    'text-black/[50%]',
    'border-white/(--opacity)',
    'bg-white/5.5',
    'text-black/0.5',
    'bg-[#fff]',
    'bg-[#fff]/50',
    'bg-[#ffff]',
    'bg-[white]',
    'after:bg-[rgba(255,255,255,0.5)]',
    'after:!bg-[#fff]',
    'after:bg-[#fff]!',
    'bg-[rgb(255_255_255/0.5)]',
    'bg-[color:#fff]',
    'bg-(--color-white)',
    'border-[rgb(0,0,0)]',
    'ring-gray-300',
    'divide-gray-200',
    'from-white',
    'via-black',
    'to-zinc-950',
    'shadow-white',
    'outline-black',
    'fill-white',
    'stroke-gray-500',
    'text-shadow-white',
    'text-shadow-[#fff]',
    'placeholder-zinc-400',
    'accent-gray-300',
    'caret-white',
    'decoration-black',
    'drop-shadow-white',
    'inset-ring-zinc-400',
    'inset-shadow-black',
    'ring-offset-white',
    'border-t-white',
    'border-x-zinc-800',
    'divide-y-gray-200',
    'border-t-[#fff]',
    'border-x-[rgb(255,255,255)]',
    'divide-y-[#fff]',
    'shadow-[0_2px_8px_rgba(0,0,0,0.6)]',
    ...THEME_COLOR_UTILITY_FAMILIES.map((family) => `${family}-[#fff]`),
  ]);

  for (const forbidden of forbiddenThemeClasses) {
    assert.deepEqual(
      lightHalves(`<span class="${forbidden}">bad</span>`),
      [forbidden],
      `positive control must flag ${forbidden}`
    );
  }

  for (const allowed of [
    'dark:text-zinc-400',
    'dark:hover:text-white',
    'dark:after:bg-[#fff]',
    'text-[9.5px]',
    'text-[9.5px]/[1.2]',
    'text-[9.5px]/6',
    'border-[3px]',
    'text-[0]',
    'text-[0.0]',
    'border-[0]',
    'text-[length:var(--scoreboard-size)]',
    'text-(length:--scoreboard-size)',
    'text-[calc(0.5rem+1vw)]',
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
