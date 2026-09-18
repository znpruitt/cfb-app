import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import CompactGameScoreboard from '../CompactGameScoreboard';
import {
  OverviewScoreboardGridItem,
  OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX,
  OVERVIEW_SCOREBOARD_GRID_CLASSES,
  OVERVIEW_SCOREBOARD_GRID_HEADROOM_PX,
  OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX,
  OVERVIEW_SCOREBOARD_GRID_WIDE_COLUMN_COUNT,
  OVERVIEW_SCOREBOARD_ROW_CONTENT_CAP_PX,
} from '../OverviewPanel';
import { OVERVIEW_RESULTS_LIMIT } from '../../lib/selectors/overview';
import { SCOREBOARD_TEAM_LOGO_SLOT } from '../../lib/teamLogos';
import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';

const REQUIRED_WIDTHS = [760, 761, 1340, 1341, 1600, 1920] as const;
const MINIMUM_SCORE_GAP_PX = 12;

type LayoutMeasurement = {
  width: number;
  columns: number;
  columnGap: number;
  trackWidths: number[];
  cardRects: Array<{ left: number; top: number; width: number }>;
  firstRowInterCardGap: number | null;
  stressLabelClipped: boolean;
  stressLabelWidth: number;
  stressLabelContentWidth: number;
  stressLabelSlack: number;
  stressContentToScoreGap: number;
  stressRowPaddingLeft: number;
  computedFontFamily: string;
};

async function compileFixtureStyles(): Promise<string> {
  const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const productionStyles = await readFile(from, 'utf8');
  const source = `${productionStyles.replace(
    "@import 'tailwindcss';",
    "@import 'tailwindcss' source(none);"
  )}
    @source '../components/OverviewPanel.tsx';
    @source '../components/CompactGameScoreboard.tsx';
    @source '../lib/teamLogos.ts';
  `;
  const result = await postcss([tailwindcss()]).process(source, { from });
  return result.css;
}

function fixtureMarkup(styles: string): string {
  const scoreboards = Array.from({ length: OVERVIEW_RESULTS_LIMIT }, (_, index) => (
    <OverviewScoreboardGridItem key={index}>
      <CompactGameScoreboard
        state="final"
        matchupLabel={`Fixture game ${index + 1}`}
        away={{
          teamName: index === 0 ? 'Southeast Missouri State' : `Away Team ${index + 1}`,
          owner: index === 0 ? 'Mastromatteo' : 'Alice',
          rank: index === 0 ? 25 : null,
          record: index === 0 ? { wins: 12, losses: 0 } : { wins: 3, losses: 5 },
          score: index === 0 ? 100 : 13,
        }}
        home={{
          teamName: `Home Team ${index + 1}`,
          owner: 'Bob',
          record: { wins: 6, losses: 2 },
          score: 20,
        }}
      />
    </OverviewScoreboardGridItem>
  ));
  const body = renderToStaticMarkup(
    <div className="@container" data-layout-container style={{ width: REQUIRED_WIDTHS[0] }}>
      <div className={OVERVIEW_SCOREBOARD_GRID_CLASSES} data-layout-grid>
        {scoreboards}
      </div>
    </div>
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

async function measureWidths(
  page: BrowserFixturePage,
  widths: readonly number[]
): Promise<LayoutMeasurement[]> {
  return page.evaluate<LayoutMeasurement[]>(`
    (async () => {
      await document.fonts.ready;
      const widths = ${JSON.stringify(widths)};
      const container = document.querySelector('[data-layout-container]');
      const grid = document.querySelector('[data-layout-grid]');
      if (!(container instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
        throw new Error('layout fixture did not render');
      }
      const round = (value) => Math.round(value * 1000) / 1000;
      const results = [];
      for (const width of widths) {
        container.style.width = width + 'px';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const gridStyle = getComputedStyle(grid);
        const gridRect = grid.getBoundingClientRect();
        const cards = Array.from(grid.children, (item) => {
          const card = item.querySelector('[data-game-scoreboard]');
          if (!(card instanceof HTMLElement)) {
            throw new Error('Overview scoreboard wrapper did not contain a card');
          }
          const rect = card.getBoundingClientRect();
          return {
            left: round(rect.left - gridRect.left),
            top: round(rect.top - gridRect.top),
            width: round(rect.width),
          };
        });
        const stressTeam = grid.querySelector('[data-scoreboard-team="away"]');
        const stressLabel = stressTeam?.parentElement;
        const stressRow = stressTeam?.closest('[data-scoreboard-side="away"]');
        const stressValue = stressRow?.querySelector('[data-scoreboard-value="away"]');
        if (
          !(stressLabel instanceof HTMLElement) ||
          !(stressRow instanceof HTMLElement) ||
          !(stressValue instanceof HTMLElement)
        ) {
          throw new Error('stress row did not render');
        }
        const stressContentRange = document.createRange();
        stressContentRange.selectNodeContents(stressLabel);
        const stressContentRect = stressContentRange.getBoundingClientRect();
        const stressLabelRect = stressLabel.getBoundingClientRect();
        const stressValueRect = stressValue.getBoundingClientRect();
        const stressLabelContentWidth = stressContentRect.width;
        const stressLabelWidth = stressLabelRect.width;
        const firstRowInterCardGap =
          cards.length >= 2 && Math.abs(cards[0].top - cards[1].top) <= 0.1
            ? round(cards[1].left - cards[0].left - cards[0].width)
            : null;
        results.push({
          width,
          columns: gridStyle.gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length,
          columnGap: round(parseFloat(gridStyle.columnGap)),
          trackWidths: gridStyle.gridTemplateColumns
            .trim()
            .split(/\\s+/)
            .filter(Boolean)
            .map((value) => round(parseFloat(value))),
          cardRects: cards,
          firstRowInterCardGap,
          stressLabelClipped: stressLabelContentWidth > stressLabelWidth + 0.5,
          stressLabelWidth: round(stressLabelWidth),
          stressLabelContentWidth: round(stressLabelContentWidth),
          stressLabelSlack: round(stressLabelWidth - stressLabelContentWidth),
          stressContentToScoreGap: round(stressValueRect.left - stressContentRect.right),
          stressRowPaddingLeft: round(parseFloat(getComputedStyle(stressRow).paddingLeft)),
          computedFontFamily: getComputedStyle(document.body).fontFamily,
        });
      }
      return results;
    })()
  `);
}

function assertNear(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= 0.1,
    `${message}: expected ${expected}, received ${actual}`
  );
}

test('Overview scoreboard grid renders its measured tiers and capped rows', async (t) => {
  await withBrowserFixture(
    t,
    {
      directoryPrefix: 'cfb-overview-grid-',
      markup: async () => fixtureMarkup(await compileFixtureStyles()),
    },
    async (page) => {
      await assert.rejects(
        page.evaluate('undefined'),
        /Browser evaluation returned no serializable value/
      );
      const measurements = await measureWidths(page, [...REQUIRED_WIDTHS, 240]);
      const byWidth = new Map(measurements.map((measurement) => [measurement.width, measurement]));
      assert.deepEqual(
        REQUIRED_WIDTHS.map((width) => ({ width, columns: byWidth.get(width)?.columns })),
        [
          { width: 760, columns: 1 },
          { width: 761, columns: 2 },
          { width: 1340, columns: 2 },
          { width: 1341, columns: 3 },
          { width: 1600, columns: 3 },
          { width: 1920, columns: 3 },
        ]
      );

      const atThree = byWidth.get(1341);
      const at1600 = byWidth.get(1600);
      const at1920 = byWidth.get(1920);
      const clippingControl = byWidth.get(240);
      assert.ok(
        atThree && at1600 && at1920 && clippingControl,
        'all required measurements must be returned'
      );
      t.diagnostic(
        `1341px: ${atThree.trackWidths[0]}px columns, ${atThree.cardRects[0]!.width}px capped rows, ${atThree.stressLabelContentWidth}px stress content in a ${atThree.stressLabelWidth}px fractional label box, ${atThree.stressLabelSlack}px slack, ${atThree.stressContentToScoreGap}px to the score`
      );
      t.diagnostic(
        `1600px: ${at1600.trackWidths[0]}px columns, ${at1600.cardRects[0]!.width}px capped rows, ${at1600.firstRowInterCardGap}px between adjacent cards`
      );
      t.diagnostic(
        `1920px: ${at1920.trackWidths[0]}px columns, ${at1920.cardRects[0]!.width}px capped rows, ${at1920.firstRowInterCardGap}px between adjacent cards`
      );
      assert.match(
        atThree.computedFontFamily,
        /^ui-sans-serif, system-ui/,
        'the fixture must inherit the production body font stack from globals.css'
      );
      assert.equal(
        clippingControl.stressLabelClipped,
        true,
        'the clipping observer needs a control'
      );
      assert.ok(
        clippingControl.stressLabelContentWidth > clippingControl.stressLabelWidth + 0.5,
        'the text-range observer must measure a real overrun in the clipping control'
      );
      assert.ok(
        clippingControl.stressContentToScoreGap < 0,
        'the clipping control must make the untruncated text collide with the score'
      );
      assert.equal(atThree.stressLabelClipped, false, 'the named stress row must fit at the cap');
      assert.ok(
        atThree.stressContentToScoreGap >=
          MINIMUM_SCORE_GAP_PX +
            OVERVIEW_SCOREBOARD_GRID_HEADROOM_PX / OVERVIEW_SCOREBOARD_GRID_WIDE_COLUMN_COUNT -
            0.5,
        'the stress content must retain the 12px score gap plus its per-column font allowance'
      );
      assert.equal(atThree.stressRowPaddingLeft, SCOREBOARD_TEAM_LOGO_SLOT.widthPx);
      assert.equal(atThree.columnGap, OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX);
      assert.ok(atThree.trackWidths[0]! >= OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX);
      assertNear(
        OVERVIEW_SCOREBOARD_GRID_WIDE_COLUMN_COUNT *
          (atThree.trackWidths[0]! - OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX),
        OVERVIEW_SCOREBOARD_GRID_HEADROOM_PX,
        'three rendered columns must distribute the specified total headroom'
      );
      for (const measurement of [atThree, at1600, at1920]) {
        assertNear(
          measurement.cardRects[0]!.width,
          OVERVIEW_SCOREBOARD_ROW_CONTENT_CAP_PX,
          `${measurement.width}px rows must equal the derived cap`
        );
        assert.equal(
          measurement.stressLabelClipped,
          false,
          `${measurement.width}px must not clip the named stress row`
        );
      }
      assertNear(
        at1600.cardRects[0]!.width,
        at1920.cardRects[0]!.width,
        'capped row width must not grow with its grid track'
      );
      for (const measurement of [at1600, at1920]) {
        assert.ok(
          measurement.firstRowInterCardGap !== null,
          `${measurement.width}px must expose an adjacent first-row pair`
        );
        assertNear(
          measurement.firstRowInterCardGap!,
          measurement.trackWidths[0]! -
            OVERVIEW_SCOREBOARD_ROW_CONTENT_CAP_PX +
            OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX,
          `${measurement.width}px inter-card space must be the fixed gap plus unused track width`
        );
      }

      assert.equal(OVERVIEW_RESULTS_LIMIT, 4, 'Featured keeps its owner-approved four-item cap');
      const [first, second, third, fourth] = atThree.cardRects;
      assert.ok(first && second && third && fourth);
      assertNear(first.top, second.top, 'the first grid row must be row-major');
      assertNear(first.top, third.top, 'the first grid row must contain three cards');
      assert.ok(fourth.top > first.top, 'the remainder must follow the first row');
      assertNear(fourth.left, first.left, 'the remainder must start in column one');
      assert.ok(
        third.left > fourth.left,
        "Featured's two unused final-row tracks must remain on the right"
      );
    }
  );
});
