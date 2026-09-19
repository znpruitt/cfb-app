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
  OVERVIEW_SCOREBOARD_GRID_STYLE,
  OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX,
  OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_BREAKPOINT_PX,
  OVERVIEW_SCOREBOARD_ROW_CONTENT_CAP_PX,
} from '../OverviewPanel';
import { OVERVIEW_RESULTS_LIMIT } from '../../lib/selectors/overview';
import { SCOREBOARD_TEAM_LOGO_SLOT } from '../../lib/teamLogos';
import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';

const REQUIRED_WIDTHS = [760, 761, 846, 880, 1340, 1341, 1600, 1920] as const;

type LayoutMeasurement = {
  width: number;
  containerWidth: number;
  gridWidth: number;
  columns: number;
  columnGap: number;
  columnWidths: number[];
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
        teamName: index === 0 ? 'Southeast Missouri State' : `Away Team ${index + 1}`,
        teamLogo:
          index === 0
            ? { url: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' }
            : null,
        owner: index === 0 ? 'Mastromatteo' : 'Alice',
        rank: index === 0 ? 25 : null,
        rankSource: index === 0 ? 'cfp' : null,
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
  ));
  const body = renderToStaticMarkup(
    <div className="@container" data-layout-container style={{ width: REQUIRED_WIDTHS[0] }}>
      <div
        className={OVERVIEW_SCOREBOARD_GRID_CLASSES}
        style={OVERVIEW_SCOREBOARD_GRID_STYLE}
        data-layout-grid
      >
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
        const containerRect = container.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const columnWidths = gridStyle.gridTemplateColumns
          .trim()
          .split(/\\s+/)
          .filter(Boolean)
          .map((value) => round(parseFloat(value)));
        const cards = Array.from(grid.children, (card) => {
          const rect = card.getBoundingClientRect();
          return {
            left: round(rect.left - gridRect.left),
            top: round(rect.top - gridRect.top),
            width: round(rect.width),
          };
        });
        const stressTeam = grid.querySelector('[data-scoreboard-team="away"]');
        const stressLabel = stressTeam?.parentElement?.parentElement;
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
          containerWidth: round(containerRect.width),
          gridWidth: round(gridRect.width),
          columns: columnWidths.length,
          columnGap: round(parseFloat(gridStyle.columnGap)),
          columnWidths,
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

test('Overview keeps full-width equal tracks while capping each left-aligned scoreboard row', async (t) => {
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
          { width: 846, columns: 2 },
          { width: 880, columns: 2 },
          { width: 1340, columns: 2 },
          { width: 1341, columns: 3 },
          { width: 1600, columns: 3 },
          { width: 1920, columns: 3 },
        ]
      );

      for (const measurement of measurements) {
        assertNear(
          measurement.containerWidth,
          measurement.width,
          `${measurement.width}px container`
        );
        assertNear(
          measurement.gridWidth,
          measurement.width,
          `${measurement.width}px grid must retain the full container width`
        );
        assert.equal(measurement.columnGap, OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX);
        const expectedTrackWidth =
          (measurement.width - (measurement.columns - 1) * OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX) /
          measurement.columns;
        for (const columnWidth of measurement.columnWidths) {
          assertNear(
            columnWidth,
            expectedTrackWidth,
            `${measurement.width}px grid must retain equal tracks`
          );
        }
        const expectedRowWidth = Math.min(
          expectedTrackWidth,
          OVERVIEW_SCOREBOARD_ROW_CONTENT_CAP_PX
        );
        for (const card of measurement.cardRects) {
          assertNear(
            card.width,
            expectedRowWidth,
            `${measurement.width}px row must fill its track only up to the content cap`
          );
        }
        for (let index = 0; index < measurement.columns; index += 1) {
          assertNear(
            measurement.cardRects[index]!.left,
            index * (expectedTrackWidth + OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX),
            `${measurement.width}px row ${index + 1} must align to its track's left edge`
          );
        }
      }

      const atTarget = byWidth.get(846);
      const inKnownNarrowTwoColumnBand = byWidth.get(761);
      const beforeThree = byWidth.get(1340);
      const atThree = byWidth.get(OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_BREAKPOINT_PX);
      const at1600 = byWidth.get(1600);
      const at1920 = byWidth.get(1920);
      const clippingControl = byWidth.get(240);
      assert.ok(
        atTarget &&
          inKnownNarrowTwoColumnBand &&
          beforeThree &&
          atThree &&
          at1600 &&
          at1920 &&
          clippingControl,
        'all required measurements must be returned'
      );
      t.diagnostic(
        `${OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_BREAKPOINT_PX}px: ${atThree.columnWidths[0]}px equal tracks, ${atThree.cardRects[0]!.width}px capped rows, ${atThree.stressLabelContentWidth}px stress content in a ${atThree.stressLabelWidth}px label box, ${atThree.stressContentToScoreGap}px to the score`
      );
      assert.match(
        atThree.computedFontFamily,
        /^ui-sans-serif, system-ui/,
        'the fixture must inherit the production body font stack from globals.css'
      );
      assert.equal(
        clippingControl.stressLabelClipped,
        true,
        'the clipping observer needs a positive control'
      );
      assert.ok(
        clippingControl.stressLabelContentWidth > clippingControl.stressLabelWidth + 0.5,
        'the text-range observer must measure a real overrun in the clipping control'
      );
      assert.ok(
        clippingControl.stressContentToScoreGap < 0,
        'the clipping control must make the untruncated text collide with the score'
      );
      assert.equal(
        inKnownNarrowTwoColumnBand.stressLabelClipped,
        true,
        'the known 761px two-column clipping interval remains explicit pending #821'
      );
      assert.equal(
        atTarget.stressLabelClipped,
        false,
        'the named stress row must fit once each two-column track reaches the measured target'
      );
      assert.equal(atThree.stressLabelClipped, false, 'the named stress row must fit at 1341px');
      assert.ok(
        atThree.stressContentToScoreGap >= 11.5,
        'the stress content must retain the rendered 12px flex gap before the score'
      );
      assert.equal(atThree.stressRowPaddingLeft, SCOREBOARD_TEAM_LOGO_SLOT.widthPx);
      assertNear(
        atTarget.cardRects[0]!.width,
        OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX,
        'the measured 403px target must remain a real two-column geometry point'
      );
      assertNear(
        beforeThree.cardRects[0]!.width,
        atThree.cardRects[0]!.width,
        'the row cap must avoid a width jump at the three-column breakpoint'
      );
      assertNear(
        atThree.cardRects[0]!.width,
        OVERVIEW_SCOREBOARD_ROW_CONTENT_CAP_PX,
        'the first wide row must equal the per-column content cap'
      );
      assertNear(
        at1600.cardRects[0]!.width,
        OVERVIEW_SCOREBOARD_ROW_CONTENT_CAP_PX,
        '1600px rows must stop growing while the grid tracks continue'
      );
      assertNear(
        at1920.cardRects[0]!.width,
        OVERVIEW_SCOREBOARD_ROW_CONTENT_CAP_PX,
        '1920px rows must stop growing while the grid tracks continue'
      );
      assert.ok(
        at1920.columnWidths[0]! > at1920.cardRects[0]!.width,
        'wide-screen surplus space must remain inside each equal track'
      );

      assert.equal(OVERVIEW_RESULTS_LIMIT, 4, 'Featured keeps its owner-approved four-item cap');
      const [first, second, third, fourth] = atThree.cardRects;
      assert.ok(first && second && third && fourth, 'Featured must render four cards for 3 + 1');
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
