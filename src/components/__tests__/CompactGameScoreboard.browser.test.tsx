import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { EYEBROW_TAG_CLASSES } from '../../lib/gameUi';
import { LEAGUE_TAG_LABELS } from '../../lib/gameTags';
import type { AppGame } from '../../lib/schedule';
import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';
import CompactGameScoreboard from '../CompactGameScoreboard';
import GameWeekPanel from '../GameWeekPanel';

const STATES = ['scheduled', 'live', 'awaiting', 'unavailable', 'final'] as const;
const PHONE_WIDTHS = [360, 375, 390, 414, 430, 639];
const LABELS = [LEAGUE_TAG_LABELS.upset_watch, LEAGUE_TAG_LABELS.top_25_matchup];

function scheduleGame(): AppGame {
  return {
    key: 'header-wrap',
    eventId: 'header-wrap',
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: '2026-09-05T16:00:00.000Z',
    startTimeTBD: false,
    stage: 'regular',
    status: 'in_progress',
    completed: false,
    stageOrder: 1,
    slotOrder: 0,
    eventKey: 'header-wrap',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: 'header-wrap',
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      away: {
        kind: 'team',
        teamId: 'alabama',
        displayName: 'Alabama',
        canonicalName: 'Alabama',
        rawName: 'Alabama',
      },
      home: {
        kind: 'team',
        teamId: 'georgia',
        displayName: 'Georgia',
        canonicalName: 'Georgia',
        rawName: 'Georgia',
      },
    },
    csvAway: 'Alabama',
    csvHome: 'Georgia',
    canAway: 'Alabama',
    canHome: 'Georgia',
    awayConf: 'SEC',
    homeConf: 'SEC',
    media: [{ gameId: 'header-wrap', mediaType: 'tv', outlet: 'ESPN2' }],
  };
}

async function fixtureMarkup(): Promise<string> {
  const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const source =
    (await readFile(from, 'utf8')).replace(
      "@import 'tailwindcss';",
      "@import 'tailwindcss' source(none);"
    ) +
    `
    @source '../components/CompactGameScoreboard.tsx';
    @source '../components/ScoreboardTeamName.tsx';
    @source '../components/GameWeekPanel.tsx';
    @source '../components/__tests__/CompactGameScoreboard.browser.test.tsx';
    @source '../lib/gameUi.ts';
    @source '../lib/teamLogos.ts';
  `;
  const styles = (await postcss([tailwindcss()]).process(source, { from })).css;
  const game = scheduleGame();
  const body = renderToStaticMarkup(
    <div className="p-4 sm:p-6">
      <div className="@container">
        <div className="grid grid-cols-2 gap-x-10 @max-[760.01px]:grid-cols-1" data-header-grid>
          {STATES.map((state) => (
            <div key={state} data-header-case={state}>
              <CompactGameScoreboard
                state={state}
                statusLabel="SCH"
                matchupLabel={`${state} header`}
                clock={
                  state === 'live' ? 'Q4 12:34' : state === 'scheduled' ? '7:30 PM' : undefined
                }
                broadcast={['scheduled', 'live', 'awaiting'].includes(state) ? 'ESPN2' : undefined}
                neutralSite
                tagSlot={
                  <span className="inline-flex flex-wrap gap-1">
                    {LABELS.map((label) => (
                      <span
                        key={label}
                        data-header-tag
                        className={`inline-flex ${EYEBROW_TAG_CLASSES}`}
                      >
                        {label}
                      </span>
                    ))}
                  </span>
                }
                away={{ teamName: 'Alabama', score: 24 }}
                home={{ teamName: 'Georgia', score: 21 }}
              />
            </div>
          ))}
        </div>
      </div>
      {(['live', 'awaiting'] as const).map((state) => (
        <div key={state} data-header-case={`schedule-${state}`}>
          <GameWeekPanel
            games={[game]}
            byes={[]}
            isDebug={false}
            hideByes
            displayTimeZone="UTC"
            currentDateMs={Date.parse(game.date!) + 60 * 60 * 1000}
            rosterByTeam={new Map()}
            rankingsByTeamId={
              new Map([
                ['alabama', { rank: 5, rankSource: 'ap' as const }],
                ['georgia', { rank: 10, rankSource: 'ap' as const }],
              ])
            }
            oddsByKey={{
              [game.key]: {
                homeSpread: -7,
                awaySpread: 7,
                favorite: 'Georgia',
                spread: -7,
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
            scoresByKey={
              state === 'live'
                ? {
                    [game.key]: {
                      away: { team: 'Alabama', score: 24 },
                      home: { team: 'Georgia', score: 21 },
                      status: 'In Progress',
                      time: 'Q4 12:34',
                    },
                  }
                : {}
            }
          />
        </div>
      ))}
    </div>
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};
type HeaderMeasurement = {
  state: string;
  header: Rect;
  metadata: Rect;
  slot: Rect;
  lastTag: Rect;
  visibleTags: string[];
  metadataOrder: string[];
  broadcastOverflow: number | null;
  font: string;
};

async function measure(page: BrowserFixturePage, key: string): Promise<HeaderMeasurement> {
  return page.evaluate<HeaderMeasurement>(`(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.querySelector('[data-header-case="${key}"]');
    const header = root.querySelector('[data-scoreboard-header]');
    const metadata = root.querySelector('[data-scoreboard-header-metadata]');
    const slot = root.querySelector('[data-scoreboard-tag-slot]');
    const tags = Array.from(slot.querySelectorAll('[data-header-tag], [data-eyebrow-tag]'));
    const rect = element => {
      const {left, right, top, bottom, width, height} = element.getBoundingClientRect();
      return {left, right, top, bottom, width, height};
    };
    const visible = element => {
      if (!element.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
      const r = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), p = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) &&
            (r.left < p.left - 0.5 || r.right > p.right + 0.5)) return false;
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) &&
            (r.top < p.top - 0.5 || r.bottom > p.bottom + 0.5)) return false;
      }
      return r.width > 0 && r.height > 0;
    };
    const broadcast = Array.from(metadata.children).find(child => child.textContent === 'ESPN2');
    let broadcastOverflow = null;
    if (broadcast) {
      const range = document.createRange();
      range.selectNodeContents(broadcast);
      const text = range.getBoundingClientRect();
      let left = text.left, right = text.right;
      let top = text.top, bottom = text.bottom;
      // Include broadcast's own truncate box AND every clipping ancestor.
      for (let element = broadcast; element; element = element.parentElement) {
        const style = getComputedStyle(element), r = element.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
          left = Math.max(left, r.left); right = Math.min(right, r.right);
        }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) {
          top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom);
        }
      }
      broadcastOverflow = Math.max(0, left - text.left, text.right - right, top - text.top, text.bottom - bottom);
      if (!broadcast.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) broadcastOverflow = text.width || 1;
    }
    return {
      state: root.querySelector('[data-scoreboard-state]').dataset.scoreboardState,
      header: rect(header), metadata: rect(metadata), slot: rect(slot), lastTag: rect(tags.at(-1)),
      visibleTags: tags.filter(visible).map(tag => tag.textContent),
      metadataOrder: Array.from(metadata.children).map(child => child.textContent),
      broadcastOverflow, font: getComputedStyle(header).fontFamily,
    };
  })()`);
}

for (const state of STATES) {
  test(`${state}: phone header uses full-width metadata and a right-aligned full-width tag line`, async (t) => {
    await withBrowserFixture(
      t,
      { directoryPrefix: 'cfb-header-wrap-', markup: fixtureMarkup },
      async (page) => {
        for (const width of PHONE_WIDTHS) {
          await page.setViewport(width, 800);
          const m = await measure(page, state);
          const label = `${state} at ${width}px`;
          assert.equal(m.metadata.width, m.header.width, `${label}: metadata takes a full line`);
          assert.equal(m.slot.width, m.header.width, `${label}: tag slot takes a full line`);
          assert.ok(m.slot.top >= m.metadata.bottom + 4, `${label}: tags occupy the second line`);
          assert.ok(
            m.header.height >= m.metadata.height + 4 + m.slot.height,
            `${label}: header contains both lines and their gap`
          );
          assert.ok(
            Math.abs(m.lastTag.right - m.header.right) < 0.5,
            `${label}: tags align to the right edge`
          );
        }
      }
    );
  });
}

test('every state retains one header line above the phone breakpoint', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-header-desktop-', markup: fixtureMarkup },
    async (page) => {
      for (const width of [640, 900, 1280]) {
        await page.setViewport(width, 800);
        const columns = await page.evaluate<number>(
          `getComputedStyle(document.querySelector('[data-header-grid]')).gridTemplateColumns.trim().split(/\\s+/).length`
        );
        assert.equal(columns, width >= 900 ? 2 : 1, `${width}px: measured peer-card column count`);
        for (const state of STATES) {
          const m = await measure(page, state);
          assert.ok(
            Math.abs(m.metadata.top + m.metadata.height / 2 - m.slot.top - m.slot.height / 2) < 0.5,
            `${state} at ${width}px: metadata and tags share one line`
          );
          assert.equal(m.header.height, 16, `${state} at ${width}px: header retains 16px height`);
        }
      }
    }
  );
});

for (const state of ['live', 'awaiting'] as const) {
  test(`${state}: Schedule broadcast is wholly visible at shipped phone widths`, async (t) => {
    await withBrowserFixture(
      t,
      { directoryPrefix: 'cfb-header-broadcast-', markup: fixtureMarkup },
      async (page) => {
        for (const width of PHONE_WIDTHS) {
          await page.setViewport(width, 800);
          const m = await measure(page, `schedule-${state}`);
          assert.equal(m.state, state, 'the production selector must reach the intended state');
          assert.deepEqual(
            m.visibleTags,
            LABELS,
            'the production selector supplies both visible tags'
          );
          assert.equal(
            m.broadcastOverflow,
            0,
            `${state} at ${width}px: broadcast text fits every clipping boundary`
          );
          t.diagnostic(
            `${state}, ESPN2, two tags, ${width}px viewport / ${m.header.width}px header: ${m.broadcastOverflow}px broadcast overflow; ${m.font}`
          );
        }
      }
    );
  });
}

test('phone headers preserve every tag and the state-clock-broadcast-neutral metadata order', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-header-content-', markup: fixtureMarkup },
    async (page) => {
      await page.setViewport(390, 800);
      const expected = {
        scheduled: ['SCH', '7:30 PM', '•', 'ESPN2', '•', 'Neutral site'],
        live: ['Live', 'Q4 12:34', '•', 'ESPN2', '•', 'Neutral site'],
        awaiting: ['Awaiting score', '•', 'ESPN2', '•', 'Neutral site'],
        unavailable: ['No score reported', '•', 'Neutral site'],
        final: ['Final', '•', 'Neutral site'],
      };
      for (const state of STATES) {
        const m = await measure(page, state);
        assert.deepEqual(m.visibleTags, LABELS, `${state}: every supplied tag remains visible`);
        assert.deepEqual(m.metadataOrder, expected[state], `${state}: metadata order is preserved`);
      }
    }
  );
});
