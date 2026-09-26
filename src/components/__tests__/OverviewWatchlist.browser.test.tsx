import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { OverviewGameItem } from '../../lib/overview';
import type { AppGame } from '../../lib/schedule';
import { withBrowserFixture, type BrowserFixturePage } from '../../test/browserFixture';
import OverviewPanel from '../OverviewPanel';

function fixtureItem(key: string, day: number): OverviewGameItem {
  const game: AppGame = {
    key,
    eventId: key,
    eventKey: key,
    providerGameId: key,
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: `2026-09-0${day}T17:00:00Z`,
    status: 'scheduled',
    stage: 'regular',
    stageOrder: 1,
    slotOrder: 0,
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    csvAway: `${key} Away`,
    csvHome: `${key} Home`,
    canAway: `${key}-a`,
    canHome: `${key}-h`,
    awayConf: 'SEC',
    homeConf: 'SEC',
    participants: {
      away: {
        kind: 'team',
        teamId: `${key}-a`,
        displayName: `${key} Away`,
        canonicalName: `${key} Away`,
        rawName: `${key} Away`,
      },
      home: {
        kind: 'team',
        teamId: `${key}-h`,
        displayName: `${key} Home`,
        canonicalName: `${key} Home`,
        rawName: `${key} Home`,
      },
    },
    media: [{ gameId: key, mediaType: 'tv', outlet: 'ESPN2' }],
  };
  return {
    bucket: {
      game,
      awayOwner: 'Alice',
      homeOwner: 'Bob',
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    priority: 2,
    sortDate: Date.parse(game.date!),
  };
}

async function fixtureMarkup(): Promise<string> {
  const items = [fixtureItem('reason-tag', 5), fixtureItem('tag', 6), fixtureItem('untagged', 7)];
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 120,
          pointsAgainst: 100,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 5,
        },
      ]}
      standingsCoverage={{ state: 'complete', message: null }}
      matchupMatrix={{ owners: [], rows: [] }}
      liveItems={[]}
      keyMatchups={items}
      sectionItems={items}
      nowMs={Date.parse('2026-09-01T16:30:00Z')}
      rankingsByTeamId={
        new Map([
          ['reason-tag-a', { rank: 3, rankSource: 'ap' }],
          ['reason-tag-h', { rank: 8, rankSource: 'ap' }],
          ['tag-a', { rank: 3, rankSource: 'ap' }],
          ['tag-h', { rank: 8, rankSource: 'ap' }],
          ['untagged-a', { rank: 25, rankSource: 'ap' }],
        ])
      }
      context={{ scopeDetail: 'Week 1' }}
      displayTimeZone="UTC"
    />
  );
  const dom = new JSDOM(html);
  const grid = dom.window.document.querySelector('[data-watchlist-scoreboard-grid]');
  assert.ok(grid, 'the production selector must render the watchlist');
  const body = `<div class="p-4 sm:p-6"><section class="@container">${grid.outerHTML}</section></div>`;
  dom.window.close();
  const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const source =
    (await readFile(from, 'utf8')).replace(
      "@import 'tailwindcss';",
      "@import 'tailwindcss' source(none);"
    ) +
    `
    @source '../components/OverviewPanel.tsx';
    @source '../components/CompactGameScoreboard.tsx';
    @source '../components/ScoreboardTeamName.tsx';
    @source '../components/LeaguePageShell.tsx';
    @source '../lib/gameUi.ts';
    @source '../lib/teamLogos.ts';
  `;
  const styles = (await postcss([tailwindcss()]).process(source, { from })).css;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

type Rect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};
type Row = {
  name: string;
  card: Rect;
  header: Rect;
  metadata: Rect | null;
  slot: Rect | null;
  contextCount: number;
  footer: Rect;
  tags: Array<{ text: string; rect: Rect; clipped: number }>;
};

async function measure(page: BrowserFixturePage): Promise<Row[]> {
  return page.evaluate<Row[]>(`(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = e => {
      const {top, bottom, left, right, width, height} = e.getBoundingClientRect();
      return {top, bottom, left, right, width, height};
    };
    return [...document.querySelectorAll('[data-game-scoreboard]')].map(card => {
      const header = card.querySelector('[data-scoreboard-header]');
      const metadata = card.querySelector('[data-scoreboard-header-metadata]');
      const slot = card.querySelector('[data-scoreboard-tag-slot]');
      return {name: card.getAttribute('aria-label'), card: rect(card), header: rect(header),
        metadata: metadata && rect(metadata), slot: slot && rect(slot),
        contextCount: card.querySelectorAll('[data-scoreboard-context-slot]').length,
        footer: rect(card.querySelector('[data-scoreboard-odds-footer]')),
        tags: [...card.querySelectorAll('[data-watchlist-reason-label], [data-eyebrow-tag]')].map(tag => {
          const r = rect(tag);
          let clipped = tag.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) ? 0 : r.width;
          for (let parent = tag.parentElement; parent; parent = parent.parentElement) {
            const p = rect(parent), style = getComputedStyle(parent);
            if (['hidden','clip','auto','scroll'].includes(style.overflowX))
              clipped = Math.max(clipped, p.left-r.left, r.right-p.right);
            if (['hidden','clip','auto','scroll'].includes(style.overflowY))
              clipped = Math.max(clipped, p.top-r.top, r.bottom-p.bottom);
          }
          return {text: tag.textContent, rect:r, clipped};
        })};
    });
  })()`);
}

const WIDTHS = [320, 360, 375, 390, 430, 639, 640, 808, 809, 1024, 1388, 1389, 1440];

test('watchlist uses the shared header, removes every context band, and keeps pills wholly visible', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-watchlist-header-', markup: fixtureMarkup },
    async (page) => {
      for (const viewport of WIDTHS) {
        await page.setViewport(viewport, 900);
        const rows = await measure(page);
        assert.equal(rows.length, 3, 'the ordinary population contains three cards');
        const reason = rows.find((row) => row.name === 'reason-tag Away at reason-tag Home');
        const tag = rows.find((row) => row.name === 'tag Away at tag Home');
        const untagged = rows.find((row) => row.name === 'untagged Away at untagged Home');
        assert.ok(reason && tag && untagged);
        assert.deepEqual(
          reason.tags.map((pill) => pill.text),
          ['Game of the Week', 'Top 25 Matchup'],
          'ordinary widest slot is one reason plus one tag'
        );
        assert.deepEqual(
          tag.tags.map((pill) => pill.text),
          ['Top 25 Matchup']
        );
        assert.deepEqual(untagged.tags, []);
        for (const row of rows) {
          const label = `${viewport}px ${row.name}`;
          assert.equal(row.contextCount, 0, `${label}: no context band remains`);
          assert.equal(row.footer.height, 16, `${label}: empty odds footer remains reserved`);
          const wrapped = viewport < 640 && row.tags.length > 0;
          assert.equal(
            row.header.height,
            wrapped ? 36 : 16,
            `${label}: only phone tags add a second header line`
          );
          assert.equal(
            row.card.height,
            wrapped ? 153 : 133,
            `${label}: card height excludes the former band and its margin`
          );
          if (row.tags.length === 0) {
            assert.equal(row.slot, null, `${label}: no empty tag line`);
            continue;
          }
          assert.ok(row.metadata && row.slot, `${label}: tags and metadata share the header`);
          assert.ok(
            Math.abs(row.tags.at(-1)!.rect.right - row.header.right) < 0.5,
            `${label}: last pill pins to the header right edge`
          );
          if (wrapped) {
            assert.equal(
              row.metadata.width,
              row.header.width,
              `${label}: phone metadata keeps the whole line`
            );
            assert.equal(
              row.slot.width,
              row.header.width,
              `${label}: phone tags keep the whole line`
            );
            assert.equal(
              row.slot.top - row.metadata.bottom,
              4,
              `${label}: phone tag line follows metadata`
            );
          } else {
            assert.equal(row.slot.top, row.metadata.top, `${label}: tags sit beside metadata`);
          }
          for (const pill of row.tags) {
            assert.equal(
              pill.clipped,
              0,
              `${label}: ${pill.text} fits every horizontal and vertical clipping ancestor`
            );
            assert.equal(
              pill.rect.height,
              16,
              `${label}: pill inherits the shared slot line height`
            );
          }
        }
        const columns = await page.evaluate<number>(
          `getComputedStyle(document.querySelector('[data-watchlist-scoreboard-grid]')).gridTemplateColumns.split(' ').length`
        );
        assert.equal(
          columns,
          viewport < 809 ? 1 : viewport < 1389 ? 2 : 3,
          `${viewport}px: Overview's existing grid tiers remain`
        );
        t.diagnostic(JSON.stringify({ viewport, columns, rows }));
      }

      // Synthetic only: the scheduled Close guard prevents a third ordinary pill.
      await page.setViewport(375, 900);
      await page.evaluate(`(() => {
      const card = document.querySelector('[aria-label="reason-tag Away at reason-tag Home"]');
      card.setAttribute('data-synthetic-three-pill-stress', '');
      const tag = card.querySelector('[data-eyebrow-tag]').cloneNode(true);
      tag.textContent = 'Close';
      card.querySelector('[data-scoreboard-tag-slot]').append(tag);
      return true;
    })()`);
      const synthetic = (await measure(page)).find(
        (row) => row.name === 'reason-tag Away at reason-tag Home'
      )!;
      assert.deepEqual(
        synthetic.tags.map((pill) => pill.text),
        ['Game of the Week', 'Top 25 Matchup', 'Close'],
        'synthetic-only three-pill stress population'
      );
      assert.ok(
        synthetic.tags.every((pill) => pill.clipped === 0),
        'synthetic three-pill slot is visible at 375px'
      );
      t.diagnostic(`SYNTHETIC ONLY: ${JSON.stringify(synthetic)}`);
    }
  );
});
