import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isDarkTheme } from '../ownerColors.ts';
import { getCategoryConfig } from '../insightCategories.ts';

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
  const g = globalThis as unknown as { window?: unknown };
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
    assert.equal(isDarkTheme(), true, 'a light-reporting matchMedia must not produce light');
  } finally {
    if (!hadWindow) delete g.window;
  }
});

test('positive control: the stubbed matchMedia really does report light', () => {
  // Without this, the assertion above could pass because the stub never took
  // effect rather than because the resolver ignores it.
  const stub = {
    matchMedia: (q: string) => ({ matches: false, media: q }),
  };
  assert.equal(stub.matchMedia('(prefers-color-scheme: dark)').matches, false);
});

test('insight category colours expose a dark value for every category', () => {
  // The category resolver picks `isDark ? darkColor : lightColor`. With the flag
  // pinned true, every category must actually HAVE a dark value or the UI renders
  // undefined.
  for (const category of ['HISTORICAL', 'RIVALRY', 'CAREER', 'TRAJECTORY', 'STATS'] as const) {
    const config = getCategoryConfig(category);
    assert.ok(config.darkColor, `${category} is missing darkColor`);
    assert.match(config.darkColor, /^#[0-9a-fA-F]{6}$/, `${category} darkColor is not a hex`);
  }
});

test('no source file reads prefers-color-scheme through matchMedia', () => {
  // Deliberately NARROW: the exact call shape, over .ts/.tsx only, ignoring
  // comments and CSS. A broader regex over stylesheets grew a new hole every
  // round on the wordmark slice; this one asserts a single fact.
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSyncSafe(dir)) {
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

function readdirSyncSafe(dir: string): { name: string; isDirectory: () => boolean }[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  return readdirSync(dir, { withFileTypes: true });
}
