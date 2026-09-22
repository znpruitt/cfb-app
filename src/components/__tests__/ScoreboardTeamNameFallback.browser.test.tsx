import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import tailwindcss from '@tailwindcss/postcss';
import { build as buildBundle } from 'esbuild';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';

import { type BrowserFixturePage, withBrowserFixture } from '../../test/browserFixture';
import {
  ScoreboardTeamNameHydrationFixture,
  ScoreboardTeamNameNoJavaScriptFixture,
} from './fixtures/ScoreboardTeamNameHydrationFixture';

type LabelMeasurement = {
  abbreviationAriaHidden: string | null;
  abbreviationHeight: number;
  abbreviationVisibility: string;
  abbreviationWidth: number;
  accessibleText: string;
  boxRight: number;
  boxWidth: number;
  containerRight: number;
  display: string;
  fullAriaHidden: string | null;
  fullVisibility: string;
  fullWidth: number;
  overflowX: string;
  textOverflow: string;
  visibleText: string;
  visibleHeight: number;
  visibleVariant: string | null;
  visibleVisibility: string;
  visibleWidth: number;
  whiteSpace: string;
};

type BrowserReport = {
  boxIndependence: {
    abbreviationShown: number;
    fullForced: number;
    probesHidden: number;
  };
  compactByWidth: Array<{
    away: LabelMeasurement;
    home: LabelMeasurement;
    ownerVisibleWidth: number;
    recordVisibleWidth: number;
    suffixWidth: number;
  }>;
  font: { family: string; size: string; weight: string };
  hiddenAfterReveal: LabelMeasurement;
  hiddenBeforeReveal: LabelMeasurement;
  hydrationErrors: string[];
  mismatch: LabelMeasurement;
  mismatchErrors: string[];
  neverWider: LabelMeasurement;
  noJavaScript: LabelMeasurement;
  resizeAfterGrow: LabelMeasurement;
  resizeAfterShrink: LabelMeasurement;
  resizeBefore: LabelMeasurement;
  userAgent: string;
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
    @source '../components/__tests__/fixtures/ScoreboardTeamNameHydrationFixture.tsx';
    @source '../lib/teamLogos.ts';
  `;
  const result = await postcss([tailwindcss()]).process(source, { from });
  return result.css;
}

async function compileFixtureScript(): Promise<string> {
  const entry = fileURLToPath(
    new URL('./fixtures/ScoreboardTeamNameHydrationFixture.tsx', import.meta.url)
  );
  const result = await buildBundle({
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    entryPoints: [entry],
    format: 'iife',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [
      {
        name: 'scoreboard-next-image-stub',
        setup(build) {
          build.onResolve({ filter: /^next\/image$/ }, () => ({
            namespace: 'scoreboard-image-stub',
            path: 'next/image',
          }));
          build.onLoad({ filter: /.*/, namespace: 'scoreboard-image-stub' }, () => ({
            contents: 'export default function Image() { return null; }',
            loader: 'js',
          }));
        },
      },
    ],
    target: 'chrome120',
    write: false,
  });
  const script = result.outputFiles[0]?.text;
  if (!script) throw new Error('scoreboard hydration fixture did not bundle');
  return script.replaceAll('</script', '<\\/script');
}

async function fixtureMarkup(): Promise<string> {
  const [styles, script] = await Promise.all([compileFixtureStyles(), compileFixtureScript()]);
  const hydrated = renderToString(<ScoreboardTeamNameHydrationFixture />);
  const noJavaScript = renderToStaticMarkup(<ScoreboardTeamNameNoJavaScriptFixture />);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body><div data-hydration-root>${hydrated}</div><div data-no-js-root>${noJavaScript}</div><div data-mismatch-root><span>deliberate hydration mismatch</span></div><script>window.process={env:{NODE_ENV:'test'}};window.__scoreboardPageErrors=[];window.addEventListener('error',function(event){window.__scoreboardPageErrors.push(String(event.error||event.message));});window.addEventListener('unhandledrejection',function(event){window.__scoreboardPageErrors.push(String(event.reason));});</script><script>${script}</script></body></html>`;
}

async function collectReport(page: BrowserFixturePage): Promise<BrowserReport> {
  return page.evaluate<BrowserReport>(`
    (async () => {
      await document.fonts.ready;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (document.documentElement.dataset.scoreboardHydrated === 'true') break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      if (document.documentElement.dataset.scoreboardHydrated !== 'true') {
        return {
          hydrationReady: false,
          pageErrors: window.__scoreboardPageErrors ?? [],
        };
      }
      const settle = () => new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      await settle();

      const round = (value) => Math.round(value * 1000) / 1000;
      const measure = (marker) => {
        const label = document.querySelector('[data-scoreboard-team-label="' + marker + '"]');
        const full = label?.querySelector('[data-scoreboard-team-full="' + marker + '"]');
        const abbreviation = label?.querySelector(
          '[data-scoreboard-team-abbreviation="' + marker + '"]'
        );
        const accessible = label?.querySelector(
          '[data-scoreboard-team-accessible="' + marker + '"]'
        );
        const visible = label?.querySelector('[data-scoreboard-team-visible="' + marker + '"]');
        if (
          !(label instanceof HTMLElement) ||
          !(full instanceof HTMLElement) ||
          !(abbreviation instanceof HTMLElement) ||
          !(accessible instanceof HTMLElement) ||
          !(visible instanceof HTMLElement)
        ) {
          throw new Error(marker + ' fallback label did not render');
        }
        const display = label.dataset.scoreboardTeamDisplay;
        const style = getComputedStyle(label);
        return {
          abbreviationAriaHidden: abbreviation.getAttribute('aria-hidden'),
          abbreviationHeight: round(abbreviation.getBoundingClientRect().height),
          abbreviationVisibility: getComputedStyle(abbreviation).visibility,
          abbreviationWidth: round(abbreviation.getBoundingClientRect().width),
          accessibleText: accessible.textContent ?? '',
          boxRight: round(label.getBoundingClientRect().right),
          boxWidth: round(label.getBoundingClientRect().width),
          containerRight: round(label.parentElement?.getBoundingClientRect().right ?? 0),
          display: display ?? '',
          fullAriaHidden: full.getAttribute('aria-hidden'),
          fullVisibility: getComputedStyle(full).visibility,
          fullWidth: round(full.getBoundingClientRect().width),
          overflowX: style.overflowX,
          textOverflow: style.textOverflow,
          visibleText: visible.textContent ?? '',
          visibleHeight: round(visible.getBoundingClientRect().height),
          visibleVariant: visible.dataset.scoreboardTeamVisual ?? null,
          visibleVisibility: getComputedStyle(visible).visibility,
          visibleWidth: round(visible.getBoundingClientRect().width),
          whiteSpace: getComputedStyle(visible).whiteSpace,
        };
      };

      const compactContainer = document.querySelector('[data-compact-case]');
      if (!(compactContainer instanceof HTMLElement)) throw new Error('compact case missing');
      const compactByWidth = [];
      for (const width of [430, 390, 320, 240]) {
        compactContainer.style.width = width + 'px';
        await settle();
        const suffix = compactContainer.querySelector('[data-scoreboard-suffix="away"]');
        const record = compactContainer.querySelector('[data-scoreboard-record="away"]');
        const owner = compactContainer.querySelector('[data-scoreboard-owner="away"]');
        if (!(suffix instanceof HTMLElement) || !(record instanceof HTMLElement) ||
            !(owner instanceof HTMLElement)) {
          throw new Error('compact suffix control did not render');
        }
        const suffixRect = suffix.getBoundingClientRect();
        const visibleWidth = (element) => {
          const rect = element.getBoundingClientRect();
          return round(Math.max(0,
            Math.min(rect.right, suffixRect.right) - Math.max(rect.left, suffixRect.left)
          ));
        };
        compactByWidth.push({
          away: measure('away'),
          home: measure('home'),
          ownerVisibleWidth: visibleWidth(owner),
          recordVisibleWidth: visibleWidth(record),
          suffixWidth: round(suffixRect.width),
        });
      }

      // At the same row width, change only the text in the in-flow visual and
      // then suppress both out-of-flow probes. None may resize the allocated box.
      compactContainer.style.width = '390px';
      await settle();
      const box = compactContainer.querySelector('[data-scoreboard-team-label="away"]');
      const visual = box?.querySelector('[data-scoreboard-team-visible="away"]');
      const fullProbe = box?.querySelector('[data-scoreboard-team-full="away"]');
      const abbreviationProbe = box?.querySelector('[data-scoreboard-team-abbreviation="away"]');
      if (!(box instanceof HTMLElement) || !(visual instanceof HTMLElement) ||
          !(fullProbe instanceof HTMLElement) || !(abbreviationProbe instanceof HTMLElement)) {
        throw new Error('name-box independence control did not render');
      }
      const abbreviationShown = round(box.getBoundingClientRect().width);
      visual.textContent = 'Southeast Missouri State';
      const fullForced = round(box.getBoundingClientRect().width);
      fullProbe.style.display = 'none';
      abbreviationProbe.style.display = 'none';
      const probesHidden = round(box.getBoundingClientRect().width);
      fullProbe.style.display = '';
      abbreviationProbe.style.display = '';
      visual.textContent = 'SEMO';

      const hiddenContainer = document.querySelector('[data-hidden-case]');
      if (!(hiddenContainer instanceof HTMLElement)) throw new Error('hidden recap control missing');
      const hiddenBeforeReveal = measure('hidden-recap');
      hiddenContainer.hidden = false;
      await settle();
      const hiddenAfterReveal = measure('hidden-recap');

      const resizeContainer = document.querySelector('[data-resize-case]');
      if (!(resizeContainer instanceof HTMLElement)) throw new Error('resize case missing');
      const resizeBefore = measure('resize');
      resizeContainer.style.width = resizeBefore.fullWidth + 1 + 'px';
      await settle();
      const resizeAfterGrow = measure('resize');
      resizeContainer.style.width =
        (resizeBefore.fullWidth + resizeBefore.abbreviationWidth) / 2 + 'px';
      await settle();
      const resizeAfterShrink = measure('resize');

      const fontTarget = document.querySelector('[data-scoreboard-team-label="away"]');
      if (!(fontTarget instanceof HTMLElement)) throw new Error('font target missing');
      const fontStyle = getComputedStyle(fontTarget);
      return {
        boxIndependence: { abbreviationShown, fullForced, probesHidden },
        compactByWidth,
        font: {
          family: fontStyle.fontFamily,
          size: fontStyle.fontSize,
          weight: fontStyle.fontWeight,
        },
        hydrationErrors: window.__scoreboardHydrationErrors ?? [],
        hiddenAfterReveal,
        hiddenBeforeReveal,
        mismatch: measure('mismatch'),
        mismatchErrors: window.__scoreboardMismatchErrors ?? [],
        neverWider: measure('never-wider'),
        noJavaScript: measure('no-js'),
        resizeAfterGrow,
        resizeAfterShrink,
        resizeBefore,
        userAgent: navigator.userAgent,
      };
    })()
  `);
}

test('SSR and no-JS keep a single untruncated abbreviation', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-scoreboard-name-no-js-', markup: fixtureMarkup },
    async (page) => {
      const report = await collectReport(page);
      const boot = report as BrowserReport & {
        hydrationReady?: boolean;
        pageErrors?: string[];
      };
      assert.equal(boot.hydrationReady, undefined, JSON.stringify(boot.pageErrors ?? []));
      const { noJavaScript } = report;
      assert.equal(noJavaScript.display, 'abbreviation');
      assert.equal(noJavaScript.visibleText, 'SEMO');
      assert.equal(noJavaScript.visibleVariant, 'abbreviation');
      assert.equal(noJavaScript.visibleVisibility, 'visible');
      assert.equal(noJavaScript.accessibleText, 'Southeast Missouri State');
      assert.equal(noJavaScript.fullAriaHidden, 'true');
      assert.equal(noJavaScript.abbreviationAriaHidden, 'true');
      assert.ok(
        noJavaScript.abbreviationWidth > noJavaScript.boxWidth,
        'the no-JS control must force the unwrapped abbreviation beyond its own box'
      );
      assert.equal(
        noJavaScript.overflowX,
        'hidden',
        'the no-JS box must contain its overflowing abbreviation rather than emit page overflow'
      );
      assert.equal(noJavaScript.whiteSpace, 'normal', 'the overflowing abbreviation must wrap');
      assert.ok(
        noJavaScript.visibleHeight > noJavaScript.abbreviationHeight,
        'the full abbreviation must occupy multiple lines instead of being clipped'
      );
      assert.ok(noJavaScript.visibleWidth <= noJavaScript.boxWidth);
      assert.ok(noJavaScript.boxRight <= noJavaScript.containerRight);
      assert.equal(
        noJavaScript.textOverflow,
        'clip',
        'the name box must not manufacture an ellipsis'
      );
    }
  );
});

test('fit, overflow, never-wider, and resize decisions use the rendered name box', async (t) => {
  await withBrowserFixture(
    t,
    { directoryPrefix: 'cfb-scoreboard-name-measurement-', markup: fixtureMarkup },
    async (page) => {
      const report = await collectReport(page);
      const boot = report as BrowserReport & {
        hydrationReady?: boolean;
        pageErrors?: string[];
      };
      assert.equal(boot.hydrationReady, undefined, JSON.stringify(boot.pageErrors ?? []));
      assert.deepEqual(report.hydrationErrors, [], 'matching SSR must hydrate without recovery');
      assert.equal(
        report.boxIndependence.abbreviationShown,
        report.boxIndependence.fullForced,
        'the row-allocated name box must not grow when its visual text changes to the full name'
      );
      assert.equal(
        report.boxIndependence.abbreviationShown,
        report.boxIndependence.probesHidden,
        'the measurement probes must not contribute to the name-box width'
      );
      assert.equal(report.hiddenBeforeReveal.boxWidth, 0);
      assert.equal(report.hiddenBeforeReveal.fullWidth, 0);
      assert.equal(
        report.hiddenBeforeReveal.display,
        'abbreviation',
        'a hidden recap label must not upgrade on zero-width measurements'
      );
      assert.equal(
        report.hiddenAfterReveal.display,
        'full',
        'a recap label upgrades only after its full name fits a laid-out box'
      );
      assert.ok(report.hiddenAfterReveal.fullWidth <= report.hiddenAfterReveal.boxWidth);

      assert.equal(
        report.resizeBefore.display,
        'abbreviation',
        'a full name wider than its own box must remain abbreviated before resize'
      );
      assert.ok(report.resizeBefore.fullWidth > report.resizeBefore.boxWidth);
      assert.equal(
        report.resizeAfterGrow.display,
        'full',
        'the shared ResizeObserver must upgrade after the same name box grows'
      );
      assert.ok(report.resizeAfterGrow.fullWidth <= report.resizeAfterGrow.boxWidth);
      assert.equal(
        report.resizeAfterShrink.display,
        'abbreviation',
        'the shared ResizeObserver must restore the safe abbreviation after the box shrinks'
      );
      assert.ok(report.resizeAfterShrink.fullWidth > report.resizeAfterShrink.boxWidth);

      const fitting = report.compactByWidth[0]?.away;
      assert.ok(fitting);
      assert.ok(
        fitting.fullWidth <= fitting.boxWidth,
        'the 430px control must prove the full name fits its row-allocated box'
      );
      assert.equal(
        fitting.display,
        'full',
        'a fitting full name must upgrade instead of staying abbreviated'
      );

      const nonFitting = report.compactByWidth
        .map(({ away }) => away)
        .filter(
          ({ abbreviationWidth, boxWidth, fullWidth }) =>
            fullWidth > boxWidth && abbreviationWidth < fullWidth
        );
      assert.ok(nonFitting.length >= 2, 'the width sweep must contain multiple genuine overflows');
      for (const measurement of nonFitting) {
        assert.equal(
          measurement.display,
          'abbreviation',
          'every swept tier whose full name does not fit must render the narrower abbreviation'
        );
        assert.equal(measurement.visibleText, 'SEMO');
      }
      const mixed = report.compactByWidth[3];
      assert.ok(mixed);
      assert.equal(mixed.away.display, 'abbreviation');
      assert.ok(mixed.suffixWidth > 0, 'the 240px suffix container must retain rendered width');
      assert.ok(
        mixed.recordVisibleWidth > 0,
        'the 240px record must retain visible width after abbreviation'
      );
      assert.ok(
        mixed.ownerVisibleWidth > 0,
        'the 240px owner must retain visible width after abbreviation'
      );
      assert.equal(
        mixed.home.display,
        'full',
        'the opposing fitting label must stay full when only one side overflows'
      );
      assert.ok(mixed.home.fullWidth <= mixed.home.boxWidth);

      assert.ok(
        report.neverWider.fullWidth > report.neverWider.boxWidth,
        'the never-wider control must force the full name beyond its box'
      );
      assert.ok(
        report.neverWider.abbreviationWidth >= report.neverWider.fullWidth,
        'the current viewer must actually render BERR at least as wide as Berry'
      );
      assert.equal(
        report.neverWider.display,
        'full',
        'a measured abbreviation that is not narrower must never replace the full name'
      );
      assert.equal(report.neverWider.visibleText, 'Berry');

      assert.ok(
        report.mismatchErrors.length > 0,
        'a real hydration mismatch must not be suppressed'
      );
      assert.equal(
        report.mismatch.display,
        'abbreviation',
        'React recovery must regenerate from the conservative client state'
      );
      assert.equal(report.mismatch.visibleText, 'SEMO');

      for (const measurement of [
        ...report.compactByWidth.map(({ away }) => away),
        report.hiddenAfterReveal,
        report.resizeBefore,
        report.resizeAfterGrow,
        report.resizeAfterShrink,
      ]) {
        assert.equal(measurement.accessibleText, 'Southeast Missouri State');
        assert.equal(measurement.fullAriaHidden, 'true');
        assert.equal(measurement.abbreviationAriaHidden, 'true');
        assert.equal(measurement.visibleVariant, measurement.display);
        assert.equal(measurement.visibleVisibility, 'visible');
        assert.equal(measurement.fullVisibility, 'hidden');
        assert.equal(measurement.abbreviationVisibility, 'hidden');
      }
      for (const { home } of report.compactByWidth) {
        assert.equal(home.accessibleText, 'Ohio State');
        assert.equal(home.fullAriaHidden, 'true');
        assert.equal(home.abbreviationAriaHidden, 'true');
      }
      assert.equal(report.neverWider.accessibleText, 'Berry');
      assert.equal(report.neverWider.fullAriaHidden, 'true');
      assert.equal(report.neverWider.abbreviationAriaHidden, 'true');

      t.diagnostic(
        `Measured in ${report.userAgent}; ${report.font.family}, ${report.font.size}, weight ${report.font.weight}`
      );
      t.diagnostic(
        report.compactByWidth
          .map(
            ({ away, home }, index) =>
              `${[430, 390, 320, 240][index]}px: away ${away.display}, full ${away.fullWidth}px / box ${away.boxWidth}px / abbreviation ${away.abbreviationWidth}px; home ${home.display}`
          )
          .join('; ')
      );
    }
  );
});
