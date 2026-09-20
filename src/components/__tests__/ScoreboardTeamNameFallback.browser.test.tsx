import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';
import CompactGameScoreboard from '../CompactGameScoreboard';

const REQUIRED_WIDTHS = [420, 390, 320, 120] as const;

type LabelMeasurement = {
  abbreviationDisplay: string;
  abbreviationText: string;
  accessibleText: string;
  clipped: boolean;
  fullDisplay: string;
  fullText: string;
  labelWidth: number;
  visibleText: string;
  visibleWidth: number;
};

type FallbackMeasurement = {
  away: LabelMeasurement;
  home: LabelMeasurement;
  width: number;
};

async function compileFixtureStyles(): Promise<string> {
  const from = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const productionStyles = await readFile(from, 'utf8');
  const source = `${productionStyles.replace(
    "@import 'tailwindcss';",
    "@import 'tailwindcss' source(none);"
  )}
    @source '../components/CompactGameScoreboard.tsx';
    @source '../components/ScoreboardTeamName.tsx';
    @source '../lib/teamLogos.ts';
  `;
  const result = await postcss([tailwindcss()]).process(source, { from });
  return result.css;
}

function fixtureMarkup(styles: string): string {
  const body = renderToStaticMarkup(
    <div data-layout-container style={{ width: REQUIRED_WIDTHS[0] }}>
      <CompactGameScoreboard
        state="final"
        matchupLabel="Southeast Missouri State at Ohio State"
        away={{
          teamName: 'Southeast Missouri State',
          owner: 'Mastromatteo',
          rank: 25,
          record: { wins: 12, losses: 0 },
          score: 100,
        }}
        home={{
          teamName: 'Ohio State',
          owner: 'Chamness',
          record: { wins: 12, losses: 0 },
          score: 7,
        }}
      />
    </div>
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`;
}

async function measureWidths(
  page: BrowserFixturePage,
  widths: readonly number[]
): Promise<FallbackMeasurement[]> {
  return page.evaluate<FallbackMeasurement[]>(`
    (async () => {
      await document.fonts.ready;
      const widths = ${JSON.stringify(widths)};
      const container = document.querySelector('[data-layout-container]');
      if (!(container instanceof HTMLElement)) throw new Error('fallback fixture did not render');
      const round = (value) => Math.round(value * 1000) / 1000;
      const measureLabel = (marker) => {
        const label = document.querySelector('[data-scoreboard-team-label="' + marker + '"]');
        const full = label?.querySelector('[data-scoreboard-team-full="' + marker + '"]');
        const abbreviation = label?.querySelector(
          '[data-scoreboard-team-abbreviation="' + marker + '"]'
        );
        const accessible = label?.querySelector(
          '[data-scoreboard-team-accessible="' + marker + '"]'
        );
        const labelBox = label?.parentElement;
        if (
          !(label instanceof HTMLElement) ||
          !(full instanceof HTMLElement) ||
          !(abbreviation instanceof HTMLElement) ||
          !(accessible instanceof HTMLElement) ||
          !(labelBox instanceof HTMLElement)
        ) {
          throw new Error(marker + ' fallback label did not render');
        }
        const fullDisplay = getComputedStyle(full).display;
        const abbreviationDisplay = getComputedStyle(abbreviation).display;
        const visible = fullDisplay === 'none' ? abbreviation : full;
        const visibleRect = visible.getBoundingClientRect();
        const labelRect = labelBox.getBoundingClientRect();
        return {
          abbreviationDisplay,
          abbreviationText: abbreviation.textContent ?? '',
          accessibleText: accessible.textContent ?? '',
          clipped: visibleRect.width > labelRect.width + 0.5,
          fullDisplay,
          fullText: full.textContent ?? '',
          labelWidth: round(labelRect.width),
          visibleText: visible.textContent ?? '',
          visibleWidth: round(visibleRect.width),
        };
      };
      const results = [];
      for (const width of widths) {
        container.style.width = width + 'px';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        results.push({ width, away: measureLabel('away'), home: measureLabel('home') });
      }
      return results;
    })()
  `);
}

test('scoreboard name fallback swaps per label and exposes its precision limits', async (t) => {
  await withBrowserFixture(
    t,
    {
      directoryPrefix: 'cfb-scoreboard-name-fallback-',
      markup: async () => fixtureMarkup(await compileFixtureStyles()),
    },
    async (page) => {
      const measurements = await measureWidths(page, REQUIRED_WIDTHS);
      const [wide, mixed, bothShort, extreme] = measurements;
      assert.ok(wide && mixed && bothShort && extreme);

      assert.equal(wide.away.visibleText, 'Southeast Missouri State');
      assert.equal(wide.away.fullDisplay, 'inline');
      assert.equal(wide.away.abbreviationDisplay, 'none');
      assert.equal(wide.away.clipped, false, 'the full long name must fit before its swap tier');

      assert.equal(mixed.away.visibleText, 'SEMO');
      assert.equal(mixed.away.fullDisplay, 'none');
      assert.equal(mixed.away.abbreviationDisplay, 'inline');
      assert.equal(
        mixed.away.clipped,
        false,
        'the abbreviation must fit at the tier that triggers its swap'
      );
      assert.equal(
        mixed.home.visibleText,
        'Ohio State',
        'the opposing short label must remain full when only the long label crosses its tier'
      );
      assert.equal(mixed.home.fullDisplay, 'inline');
      assert.equal(mixed.home.abbreviationDisplay, 'none');

      assert.equal(bothShort.away.visibleText, 'SEMO');
      assert.equal(bothShort.home.visibleText, 'OSU');
      assert.equal(bothShort.away.clipped, false);
      assert.equal(bothShort.home.clipped, false);

      for (const measurement of measurements) {
        assert.equal(measurement.away.accessibleText, 'Southeast Missouri State');
        assert.equal(measurement.home.accessibleText, 'Ohio State');
        assert.equal(measurement.away.fullText, 'Southeast Missouri State');
        assert.equal(measurement.away.abbreviationText, 'SEMO');
      }

      assert.equal(extreme.away.visibleText, 'SEMO');
      assert.equal(
        extreme.away.clipped,
        true,
        'the precision-limit control must prove that an abbreviation can still fail at extremes'
      );
      assert.ok(extreme.away.visibleWidth > extreme.away.labelWidth + 0.5);

      t.diagnostic(
        measurements
          .map(
            ({ width, away, home }) =>
              `${width}px: ${away.visibleText} ${away.visibleWidth}/${away.labelWidth}px, ${home.visibleText} ${home.visibleWidth}/${home.labelWidth}px`
          )
          .join('; ')
      );
    }
  );
});
