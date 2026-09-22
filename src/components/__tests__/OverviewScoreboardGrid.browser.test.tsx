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
  OVERVIEW_SCOREBOARD_GRID_HEADROOM_PX,
  OVERVIEW_SCOREBOARD_GRID_STYLE,
  OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX,
  OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_BREAKPOINT_PX,
  OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_MAX_WIDTH_PX,
  OVERVIEW_SCOREBOARD_GRID_TWO_COLUMN_MAX_WIDTH_PX,
  OVERVIEW_SCOREBOARD_GRID_WIDE_COLUMN_COUNT,
  OVERVIEW_SCOREBOARD_MINIMUM_SCORE_GAP_PX,
} from '../OverviewPanel';
import { OVERVIEW_RESULTS_LIMIT } from '../../lib/selectors/overview';
import { SCOREBOARD_TEAM_LOGO_SLOT } from '../../lib/teamLogos';
import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';

const REQUIRED_WIDTHS = [
  760, 761, 790, 820, 846, 880, 881, 900, 1100, 1280, 1340, 1341, 1600, 1920,
] as const;
const REPORTED_WIDTHS = [760, 880, 881, 1341, 1600, 1920] as const;

type LayoutMeasurement = {
  width: number;
  columns: number;
  columnGap: number;
  gridWidth: number;
  gridMaxWidth: string;
  gridLeftOffset: number;
  gridRightSlack: number;
  sectionWidth: number;
  sectionMaxWidth: string;
  sectionLeftOffset: number;
  headerWidth: number;
  dividerWidth: number;
  trackWidths: number[];
  cardRects: Array<{ left: number; top: number; width: number }>;
  firstRowInterCardGap: number | null;
  stressLabelClipped: boolean;
  stressNameWrapped: boolean;
  stressVisibleText: string;
  stressVisibleVisibility: string;
  stressProbeVisibility: string;
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
    @source '../components/ScoreboardTeamName.tsx';
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
  ));
  const body = renderToStaticMarkup(
    <div data-layout-container style={{ width: REQUIRED_WIDTHS[0] }}>
      <hr data-layout-divider />
      <section className="@container" data-layout-section>
        <div data-layout-header>Featured games</div>
        <div
          className={OVERVIEW_SCOREBOARD_GRID_CLASSES}
          style={OVERVIEW_SCOREBOARD_GRID_STYLE}
          data-layout-grid
        >
          {scoreboards}
        </div>
      </section>
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
      const section = document.querySelector('[data-layout-section]');
      const header = document.querySelector('[data-layout-header]');
      const divider = document.querySelector('[data-layout-divider]');
      const grid = document.querySelector('[data-layout-grid]');
      if (
        !(container instanceof HTMLElement) ||
        !(section instanceof HTMLElement) ||
        !(header instanceof HTMLElement) ||
        !(divider instanceof HTMLElement) ||
        !(grid instanceof HTMLElement)
      ) {
        throw new Error('layout fixture did not render');
      }
      const round = (value) => Math.round(value * 1000) / 1000;
      const results = [];
      for (const width of widths) {
        container.style.width = width + 'px';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const gridStyle = getComputedStyle(grid);
        const containerRect = container.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const dividerRect = divider.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const cards = Array.from(grid.children, (item) => {
          const card = item.matches('[data-game-scoreboard]')
            ? item
            : item.querySelector('[data-game-scoreboard]');
          if (!(card instanceof HTMLElement)) {
            throw new Error('Overview scoreboard grid did not contain a card');
          }
          const rect = card.getBoundingClientRect();
          return {
            left: round(rect.left - gridRect.left),
            top: round(rect.top - gridRect.top),
            width: round(rect.width),
          };
        });
        const stressTeam = grid.querySelector('[data-scoreboard-team-label="away"]');
        const visibleStressTeam = stressTeam?.querySelector('[data-scoreboard-team-visible="away"]');
        const abbreviationProbe = stressTeam?.querySelector(
          '[data-scoreboard-team-abbreviation="away"]'
        );
        const stressLabel = stressTeam?.parentElement;
        const stressRow = stressTeam?.closest('[data-scoreboard-side="away"]');
        const stressValue = stressRow?.querySelector('[data-scoreboard-value="away"]');
        const stressContentEnd =
          stressRow?.querySelector('[data-scoreboard-owner="away"]') ??
          stressRow?.querySelector('[data-scoreboard-record="away"]') ??
          visibleStressTeam;
        if (
          !(visibleStressTeam instanceof HTMLElement) ||
          !(abbreviationProbe instanceof HTMLElement) ||
          !(stressLabel instanceof HTMLElement) ||
          !(stressRow instanceof HTMLElement) ||
          !(stressValue instanceof HTMLElement) ||
          !(stressContentEnd instanceof HTMLElement)
        ) {
          throw new Error('stress row did not render');
        }
        const visibleStressTeamRect = visibleStressTeam.getBoundingClientRect();
        const stressContentEndRect = stressContentEnd.getBoundingClientRect();
        const stressLabelRect = stressLabel.getBoundingClientRect();
        const stressValueRect = stressValue.getBoundingClientRect();
        const stressLabelContentWidth = stressContentEndRect.right - visibleStressTeamRect.left;
        const stressLabelWidth = stressLabelRect.width;
        const firstRowInterCardGap =
          cards.length >= 2 && Math.abs(cards[0].top - cards[1].top) <= 0.1
            ? round(cards[1].left - cards[0].left - cards[0].width)
            : null;
        results.push({
          width,
          columns: gridStyle.gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length,
          columnGap: round(parseFloat(gridStyle.columnGap)),
          gridWidth: round(gridRect.width),
          gridMaxWidth: gridStyle.maxWidth,
          gridLeftOffset: round(gridRect.left - containerRect.left),
          gridRightSlack: round(containerRect.right - gridRect.right),
          sectionWidth: round(sectionRect.width),
          sectionMaxWidth: getComputedStyle(section).maxWidth,
          sectionLeftOffset: round(sectionRect.left - containerRect.left),
          headerWidth: round(headerRect.width),
          dividerWidth: round(dividerRect.width),
          trackWidths: gridStyle.gridTemplateColumns
            .trim()
            .split(/\\s+/)
            .filter(Boolean)
            .map((value) => round(parseFloat(value))),
          cardRects: cards,
          firstRowInterCardGap,
          stressLabelClipped: stressLabelContentWidth > stressLabelWidth + 0.5,
          stressNameWrapped:
            visibleStressTeamRect.height > abbreviationProbe.getBoundingClientRect().height + 0.5,
          stressVisibleText: visibleStressTeam.textContent ?? '',
          stressVisibleVisibility: getComputedStyle(visibleStressTeam).visibility,
          stressProbeVisibility: getComputedStyle(abbreviationProbe).visibility,
          stressLabelWidth: round(stressLabelWidth),
          stressLabelContentWidth: round(stressLabelContentWidth),
          stressLabelSlack: round(stressLabelWidth - stressLabelContentWidth),
          stressContentToScoreGap: round(stressValueRect.left - stressContentEndRect.right),
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

test('Overview scoreboard grid renders its measured tiers and derived grid cap', async (t) => {
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
          { width: 790, columns: 2 },
          { width: 820, columns: 2 },
          { width: 846, columns: 2 },
          { width: 880, columns: 2 },
          { width: 881, columns: 2 },
          { width: 900, columns: 2 },
          { width: 1100, columns: 2 },
          { width: 1280, columns: 2 },
          { width: 1340, columns: 2 },
          { width: 1341, columns: 3 },
          { width: 1600, columns: 3 },
          { width: 1920, columns: 3 },
        ]
      );

      const atThree = byWidth.get(1341);
      const at1600 = byWidth.get(1600);
      const at1920 = byWidth.get(1920);
      const at1340 = byWidth.get(1340);
      const clippingControl = byWidth.get(240);
      assert.ok(
        atThree && at1600 && at1920 && at1340 && clippingControl,
        'all required measurements must be returned'
      );
      for (const width of REPORTED_WIDTHS) {
        const measurement = byWidth.get(width);
        assert.ok(measurement);
        t.diagnostic(
          `${width}px: ${measurement.trackWidths[0]}px tracks, ${measurement.cardRects[0]!.width}px cards, ${measurement.firstRowInterCardGap}px between adjacent cards, ${measurement.gridRightSlack}px right slack`
        );
      }
      const at760 = byWidth.get(760);
      assert.ok(at760);
      t.diagnostic(
        `760px computed max-widths: grid ${at760.gridMaxWidth}, section ${at760.sectionMaxWidth}`
      );
      t.diagnostic(
        `1341px stress row: ${atThree.stressLabelContentWidth}px content in a ${atThree.stressLabelWidth}px fractional label box, ${atThree.stressLabelSlack}px label slack, ${atThree.stressContentToScoreGap}px to the score`
      );
      assert.match(
        atThree.computedFontFamily,
        /^ui-sans-serif, system-ui/,
        'the fixture must inherit the production body font stack from globals.css'
      );
      for (const measurement of measurements) {
        assert.equal(measurement.stressVisibleText, 'SEMO');
        assert.equal(measurement.stressVisibleVisibility, 'visible');
        assert.equal(
          measurement.stressProbeVisibility,
          'hidden',
          'the Overview gate must not mistake an out-of-flow probe for the visible name'
        );
      }
      assert.equal(atThree.stressRowPaddingLeft, SCOREBOARD_TEAM_LOGO_SLOT.widthPx);
      assert.equal(
        atThree.columnGap,
        OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX,
        'the rendered grid must retain its derived 40px column gap'
      );
      assert.equal(
        OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_MAX_WIDTH_PX,
        OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_BREAKPOINT_PX,
        'the three-column cap must remain the derived 1341px threshold'
      );
      assert.equal(
        atThree.stressLabelClipped,
        false,
        'the 1341px cap must not clip the named worst-case row'
      );
      assertNear(
        OVERVIEW_SCOREBOARD_GRID_WIDE_COLUMN_COUNT *
          (atThree.trackWidths[0]! - OVERVIEW_SCOREBOARD_GRID_TARGET_COLUMN_PX),
        OVERVIEW_SCOREBOARD_GRID_HEADROOM_PX,
        'three rendered columns must distribute the specified total headroom'
      );
      for (const measurement of REQUIRED_WIDTHS.map((width) => byWidth.get(width)!)) {
        const expectedGridWidth =
          measurement.columns === 1
            ? measurement.width
            : Math.min(
                measurement.width,
                measurement.columns === 2
                  ? OVERVIEW_SCOREBOARD_GRID_TWO_COLUMN_MAX_WIDTH_PX
                  : OVERVIEW_SCOREBOARD_GRID_THREE_COLUMN_MAX_WIDTH_PX
              );
        assertNear(
          measurement.gridWidth,
          expectedGridWidth,
          `${measurement.width}px grid must obey its active tier's derived cap`
        );
        assertNear(
          measurement.gridLeftOffset,
          0,
          `${measurement.width}px grid must stay left-aligned`
        );
        assertNear(
          measurement.gridRightSlack,
          measurement.width - expectedGridWidth,
          `${measurement.width}px surplus must accumulate once to the grid's right`
        );
        assertNear(
          measurement.sectionWidth,
          measurement.width,
          `${measurement.width}px section shell must remain full width`
        );
        assertNear(
          measurement.sectionLeftOffset,
          0,
          `${measurement.width}px section shell must retain the panel's left edge`
        );
        assertNear(
          measurement.headerWidth,
          measurement.width,
          `${measurement.width}px header must remain full width`
        );
        assertNear(
          measurement.dividerWidth,
          measurement.width,
          `${measurement.width}px divider must remain full width`
        );
        const expectedTrackWidth =
          (expectedGridWidth - (measurement.columns - 1) * OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX) /
          measurement.columns;
        for (const trackWidth of measurement.trackWidths) {
          assertNear(
            trackWidth,
            expectedTrackWidth,
            `${measurement.width}px tracks must divide the active grid width equally`
          );
        }
        assertNear(
          measurement.cardRects[0]!.width,
          measurement.trackWidths[0]!,
          `${measurement.width}px cards must fill their tracks`
        );
        if (measurement.columns === 1) {
          assert.equal(
            measurement.firstRowInterCardGap,
            null,
            `${measurement.width}px one-column tier must not manufacture a horizontal pair`
          );
        } else {
          assert.ok(
            measurement.firstRowInterCardGap !== null,
            `${measurement.width}px must expose an adjacent first-row pair`
          );
          assertNear(
            measurement.firstRowInterCardGap!,
            OVERVIEW_SCOREBOARD_GRID_COLUMN_GAP_PX,
            `${measurement.width}px inter-card space must remain the fixed grid gap`
          );
        }
      }
      assertNear(
        at1340.cardRects[0]!.width,
        atThree.cardRects[0]!.width,
        '1340→1341 must add a column without a card-width discontinuity'
      );
      // Below the two-column cap, #821 owns the intentionally narrower tracks. Their
      // exact text-fit boundary depends on which face the host resolves from system-ui,
      // so this cross-host gate asserts their geometry above without classifying fit.
      for (const width of REQUIRED_WIDTHS.filter(
        (candidate) =>
          candidate === 760 ||
          candidate >= Math.ceil(OVERVIEW_SCOREBOARD_GRID_TWO_COLUMN_MAX_WIDTH_PX)
      )) {
        const measurement = byWidth.get(width);
        assert.ok(measurement);
        assert.equal(
          measurement.stressLabelClipped,
          false,
          `${width}px must not clip the named stress row outside the recorded #821 interval`
        );
        assert.ok(
          measurement.stressContentToScoreGap >= OVERVIEW_SCOREBOARD_MINIMUM_SCORE_GAP_PX - 0.5,
          `${width}px must retain the measured minimum score gap`
        );
      }
      assert.equal(atThree.stressNameWrapped, false);
      assert.ok(
        atThree.stressContentToScoreGap >= OVERVIEW_SCOREBOARD_MINIMUM_SCORE_GAP_PX - 0.5,
        'the SSR abbreviation and its suffix must retain the fixed score gap; grid headroom is pinned by track geometry above'
      );
      assert.equal(
        clippingControl.stressLabelClipped,
        false,
        'the 240px row must contain the visible abbreviation and suffix rather than clip the label'
      );
      assert.equal(clippingControl.stressNameWrapped, true);
      assert.ok(
        clippingControl.stressContentToScoreGap >= 0,
        'the wrapped name must not collide with the score anchor'
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
