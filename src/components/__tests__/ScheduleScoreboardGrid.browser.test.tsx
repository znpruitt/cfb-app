import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppGame } from '../../lib/schedule';
import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';
import GameWeekPanel from '../GameWeekPanel';

const STRESS_TEAM_NAME = 'Westgate Christian University';
const REQUIRED_WIDTHS = [761, 390] as const;

type ScheduleLayoutMeasurement = {
  width: number;
  columns: number;
  teamName: string;
  score: string;
  whiteSpace: string;
  overflow: string;
  textOverflow: string;
  textLineCount: number;
  rowHeight: number;
  labelWidth: number;
  contentWidth: number;
  anchorInset: number;
  anchorInside: boolean;
  valueFlexShrink: string;
};

function stressGame(): AppGame {
  return {
    key: 'schedule-browser-stress',
    eventId: 'schedule-browser-stress',
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: '2026-09-05T16:00:00.000Z',
    stage: 'regular',
    status: 'final',
    completed: true,
    stageOrder: 1,
    slotOrder: 0,
    eventKey: 'schedule-browser-stress',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: 'schedule-browser-stress',
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      away: {
        kind: 'team',
        teamId: 'westgate-christian',
        displayName: STRESS_TEAM_NAME,
        labels: {
          displayName: STRESS_TEAM_NAME,
          shortDisplayName: 'Westgate Christian',
          scoreboardName: 'WCU',
        },
        canonicalName: STRESS_TEAM_NAME,
        rawName: STRESS_TEAM_NAME,
      },
      home: {
        kind: 'team',
        teamId: 'home-team',
        displayName: 'Home Team',
        canonicalName: 'Home Team',
        rawName: 'Home Team',
      },
    },
    csvAway: STRESS_TEAM_NAME,
    csvHome: 'Home Team',
    canAway: STRESS_TEAM_NAME,
    canHome: 'Home Team',
    awayConf: 'FCS',
    homeConf: 'SEC',
  };
}

async function compileFixtureStyles(): Promise<string> {
  const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const productionStyles = await readFile(from, 'utf8');
  const source = `${productionStyles.replace(
    "@import 'tailwindcss';",
    "@import 'tailwindcss' source(none);"
  )}
    @source '../components/GameWeekPanel.tsx';
    @source '../components/CompactGameScoreboard.tsx';
    @source '../lib/teamLogos.ts';
  `;
  const result = await postcss([tailwindcss()]).process(source, { from });
  return result.css;
}

function fixtureMarkup(styles: string): string {
  const game = stressGame();
  const body = renderToStaticMarkup(
    <div data-layout-container style={{ width: REQUIRED_WIDTHS[0] }}>
      <GameWeekPanel
        games={[game]}
        byes={[]}
        oddsByKey={{}}
        scoresByKey={{
          [game.key]: {
            away: { team: STRESS_TEAM_NAME, score: 100 },
            home: { team: 'Home Team', score: 7 },
            status: 'Final',
            time: null,
          },
        }}
        rosterByTeam={new Map()}
        isDebug={false}
        hideByes={true}
        displayTimeZone="UTC"
      />
    </div>
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

async function measureWidths(
  page: BrowserFixturePage,
  widths: readonly number[]
): Promise<ScheduleLayoutMeasurement[]> {
  return page.evaluate<ScheduleLayoutMeasurement[]>(`
    (async () => {
      await document.fonts.ready;
      const widths = ${JSON.stringify(widths)};
      const container = document.querySelector('[data-layout-container]');
      const grid = document.querySelector('[data-schedule-scoreboard-grid]');
      if (!(container instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
        throw new Error('Schedule layout fixture did not render');
      }
      const round = (value) => Math.round(value * 1000) / 1000;
      const results = [];
      for (const width of widths) {
        container.style.width = width + 'px';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const team = grid.querySelector('[data-scoreboard-team="away"]');
        const label = team?.parentElement;
        const row = team?.closest('[data-scoreboard-side="away"]');
        const value = row?.querySelector('[data-scoreboard-value="away"]');
        if (
          !(team instanceof HTMLElement) ||
          !(label instanceof HTMLElement) ||
          !(row instanceof HTMLElement) ||
          !(value instanceof HTMLElement)
        ) {
          throw new Error('Schedule stress row did not render');
        }
        const labelStyle = getComputedStyle(label);
        const valueStyle = getComputedStyle(value);
        const rowRect = row.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const valueRect = value.getBoundingClientRect();
        const contentRange = document.createRange();
        contentRange.selectNodeContents(label);
        const contentRect = contentRange.getBoundingClientRect();
        results.push({
          width,
          columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length,
          teamName: team.textContent ?? '',
          score: value.textContent ?? '',
          whiteSpace: labelStyle.whiteSpace,
          overflow: labelStyle.overflow,
          textOverflow: labelStyle.textOverflow,
          textLineCount: team.getClientRects().length,
          rowHeight: round(rowRect.height),
          labelWidth: round(labelRect.width),
          contentWidth: round(contentRect.width),
          anchorInset: round(rowRect.right - valueRect.right),
          anchorInside: valueRect.right <= rowRect.right + 0.5,
          valueFlexShrink: valueStyle.flexShrink,
        });
      }
      return results;
    })()
  `);
}

test('Schedule keeps the longest provider team name single-line without moving the score anchor', async (t) => {
  assert.equal(
    STRESS_TEAM_NAME.length,
    29,
    'the fixture must retain the owner-required 29-character stress name'
  );

  await withBrowserFixture(
    t,
    {
      directoryPrefix: 'cfb-schedule-grid-',
      markup: async () => fixtureMarkup(await compileFixtureStyles()),
    },
    async (page) => {
      const measurements = await measureWidths(page, REQUIRED_WIDTHS);
      const [twoColumn, oneColumn] = measurements;
      assert.ok(twoColumn && oneColumn, 'both Schedule widths must be measured');
      assert.deepEqual(
        measurements.map(({ width, columns }) => ({ width, columns })),
        [
          { width: 761, columns: 2 },
          { width: 390, columns: 1 },
        ]
      );

      for (const measurement of measurements) {
        assert.equal(measurement.teamName, STRESS_TEAM_NAME);
        assert.equal(measurement.score, '100');
        assert.equal(measurement.whiteSpace, 'nowrap');
        assert.equal(measurement.overflow, 'hidden');
        assert.equal(measurement.textOverflow, 'ellipsis');
        assert.equal(measurement.textLineCount, 1);
        assert.equal(measurement.anchorInside, true);
        assert.equal(measurement.valueFlexShrink, '0');
      }
      assert.equal(oneColumn.rowHeight, twoColumn.rowHeight, 'the team row must stay single-line');
      assert.ok(
        Math.abs(oneColumn.anchorInset - twoColumn.anchorInset) <= 0.1,
        `the right-hand score anchor must keep its row-relative position: ${twoColumn.anchorInset} vs ${oneColumn.anchorInset}`
      );

      const displacedAnchorDetected = await page.evaluate<boolean>(`
        (() => {
          const team = document.querySelector('[data-scoreboard-team="away"]');
          const row = team?.closest('[data-scoreboard-side="away"]');
          const value = row?.querySelector('[data-scoreboard-value="away"]');
          if (!(row instanceof HTMLElement) || !(value instanceof HTMLElement)) {
            throw new Error('Schedule anchor control did not render');
          }
          value.style.transform = 'translateX(100%)';
          return value.getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5;
        })()
      `);
      assert.equal(displacedAnchorDetected, true, 'the anchor-position observer needs a control');

      t.diagnostic(
        measurements
          .map(
            (measurement) =>
              `${measurement.width}px: row ${measurement.rowHeight}px, label ${measurement.labelWidth}px, content ${measurement.contentWidth}px, anchor inset ${measurement.anchorInset}px`
          )
          .join('; ')
      );
    }
  );
});
