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
  OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX,
  OVERVIEW_SCOREBOARD_GRID_CLASSES,
  OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX,
} from '../OverviewPanel';
import { OVERVIEW_RESULTS_LIMIT } from '../../lib/selectors/overview';
import { SCOREBOARD_TEAM_LOGO_SLOT } from '../../lib/teamLogos';
import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';

const REQUIRED_WIDTHS = [760, 761, 1347, 1348, 1392] as const;

type LayoutMeasurement = {
  width: number;
  columns: number;
  columnGap: number;
  cardRects: Array<{ left: number; top: number; width: number }>;
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
    <CompactGameScoreboard
      key={index}
      state="final"
      matchupLabel={`Fixture game ${index + 1}`}
      away={{
        teamName: index === 0 ? 'Middle Tennessee State' : `Away Team ${index + 1}`,
        owner: index === 0 ? 'Shambaugh' : 'Alice',
        record: { wins: 3, losses: 5 },
        score: 13,
      }}
      home={{
        teamName: `Home Team ${index + 1}`,
        owner: 'Bob',
        record: { wins: 6, losses: 2 },
        score: 20,
      }}
    />
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
        const cards = Array.from(grid.children, (card) => {
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
        results.push({
          width,
          columns: gridStyle.gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length,
          columnGap: round(parseFloat(gridStyle.columnGap)),
          cardRects: cards,
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

test('Overview scoreboard grid renders its required container tiers and 416px target', async (t) => {
  await withBrowserFixture(
    t,
    {
      directoryPrefix: 'cfb-overview-grid-',
      markup: fixtureMarkup(await compileFixtureStyles()),
    },
    async (page) => {
      const measurements = await measureWidths(page, [...REQUIRED_WIDTHS, 240]);
      const byWidth = new Map(measurements.map((measurement) => [measurement.width, measurement]));
      assert.deepEqual(
        REQUIRED_WIDTHS.map((width) => ({ width, columns: byWidth.get(width)?.columns })),
        [
          { width: 760, columns: 1 },
          { width: 761, columns: 2 },
          { width: 1347, columns: 2 },
          { width: 1348, columns: 3 },
          { width: 1392, columns: 3 },
        ]
      );

      const atThree = byWidth.get(1348);
      const clippingControl = byWidth.get(240);
      assert.ok(atThree && clippingControl, 'all required measurements must be returned');
      t.diagnostic(
        `1348px: ${atThree.cardRects[0]!.width}px columns, ${atThree.stressLabelContentWidth}px stress content in a ${atThree.stressLabelWidth}px fractional label box, ${atThree.stressLabelSlack}px slack, ${atThree.stressContentToScoreGap}px to the score`
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
      assert.equal(atThree.stressLabelClipped, false, 'the named stress row must fit at 1348px');
      assert.ok(
        atThree.stressContentToScoreGap >= 11.5,
        'the stress content must retain the rendered 12px flex gap before the score'
      );
      assert.equal(atThree.stressRowPaddingLeft, SCOREBOARD_TEAM_LOGO_SLOT.widthPx);
      assert.equal(atThree.columnGap, OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX);
      assert.ok(atThree.cardRects[0]!.width >= OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX);
      assertNear(
        3 * (atThree.cardRects[0]!.width - OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX),
        20,
        'three rendered columns must distribute the specified total headroom'
      );

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
