import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isDarkTheme } from '../ownerColors.ts';
import { INSIGHT_CATEGORY_CONFIG, getCategoryConfig } from '../insightCategories.ts';

// ---------------------------------------------------------------------------
// POLISH-010 — dark is the only theme.
//
// The CSS half of this slice (`globals.css` makes `dark:` unconditional) is not
// reachable from node:test. What IS reachable, and what a CSS-only retirement
// would have missed, is the JavaScript half: owner colours, insight category
// colours, and the season-arc chart pick a hex from a light/dark PAIR at runtime.
// If that resolver still read `prefers-color-scheme`, a light-OS visitor would
// get light palettes painted onto a dark UI — worse than the mixed rendering
// this slice exists to fix.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(process.cwd(), 'src');

test('isDarkTheme resolves dark with no window at all (SSR)', () => {
  assert.equal(typeof window, 'undefined', 'precondition: this suite runs without a DOM');
  assert.equal(isDarkTheme(), true);
});

test('isDarkTheme ignores a matchMedia that reports a LIGHT preference', () => {
  // The load-bearing case. A resolver still consulting the media query would
  // return false here; one that has genuinely stopped consulting it cannot.
  type Stubbed = { window?: { matchMedia(q: string): { matches: boolean } } };
  const g = globalThis as unknown as Stubbed;
  const hadWindow = 'window' in g;
  g.window = {
    matchMedia: (q: string) => ({
      matches: false, // light-OS visitor
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };
  try {
    // POSITIVE CONTROL, in the same scope as the assertion it controls: prove the
    // stub is INSTALLED and reporting light. The previous version built a fresh
    // local object and asserted that instead, so it could not fail for any
    // implementation of anything and controlled nothing.
    assert.equal(
      g.window!.matchMedia('(prefers-color-scheme: dark)').matches,
      false,
      'control: the installed stub must report a LIGHT preference'
    );
    assert.equal(isDarkTheme(), true, 'a light-reporting matchMedia must not produce light');
  } finally {
    if (!hadWindow) delete g.window;
  }
});

test('insight category colours expose a dark value for every category', () => {
  // The category resolver picks `isDark ? darkColor : lightColor`. With the flag
  // pinned true, every category must actually HAVE a dark value or the UI renders
  // undefined.
  //
  // KEYED ON REAL IDS, and that is the whole point. The first version of this
  // test looped over LABELS ('HISTORICAL', 'STATS'), which `getCategoryConfig`
  // does not key on — every lookup missed and returned the shared FALLBACK, so it
  // asserted one object five times and never touched a real entry. Deleting
  // `darkColor` from every real category would have left it green. Iterating the
  // config's own keys means it cannot go stale as categories are added.
  const ids = Object.keys(INSIGHT_CATEGORY_CONFIG);
  assert.ok(ids.length >= 5, `expected the category config to be populated, got ${ids.length}`);

  for (const id of ids) {
    const config = getCategoryConfig(id as Parameters<typeof getCategoryConfig>[0]);
    assert.ok(config.darkColor, `${id} is missing darkColor`);
    assert.match(config.darkColor, /^#[0-9a-fA-F]{6}$/, `${id} darkColor is not a hex`);
  }
});

test('the category lookup resolves REAL entries, not the fallback', () => {
  // Control for the test above: proves the ids it iterates actually hit the
  // config. A label-keyed loop passes that test while exercising nothing.
  const fallback = getCategoryConfig('definitely-not-a-category' as never);
  const real = getCategoryConfig('historical' as never);
  assert.notEqual(
    real.darkColor,
    fallback.darkColor,
    'a real category must not resolve to the fallback colour'
  );
});

test('no source file reads prefers-color-scheme through matchMedia', () => {
  // Deliberately NARROW: the exact call shape, over .ts/.tsx only, ignoring
  // comments and CSS. A broader regex over stylesheets grew a new hole every
  // round on the wordmark slice; this one asserts a single fact.
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Production code only. Test files legitimately mention the call shape
        // (this one contains the very regex below), and they are not what ships.
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        const src = readFileSync(full, 'utf8');
        // Strip line comments and block comments before matching, so the
        // explanatory notes in ownerColors.ts do not trip this.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        if (/matchMedia\(\s*['"`]\(prefers-color-scheme/.test(code)) {
          offenders.push(path.relative(REPO_ROOT, full));
        }
      }
    }
  };
  walk(REPO_ROOT);
  assert.deepEqual(offenders, [], `theme is dark-only; these still read the OS: ${offenders}`);
});
