import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import LoginPage from '../../../app/login/[[...sign-in]]/page.tsx';
import AdminLeagueDashboard from '../../home/AdminLeagueDashboard.tsx';
import { renderDeep } from '../../../test/renderTree.ts';

// ---------------------------------------------------------------------------
// The wordmark's contract, asserted at the surfaces that display it.
//
// Deliberately NOT "these files import the shared component" — that pins an
// implementation detail and breaks on any refactor while proving nothing a user
// would notice. What matters is what renders: the brand is spelled `TurfWar` with
// no whitespace, the accessible name is `Turf War`, and the marketing descriptor
// does not follow the mark onto interior pages.
//
// The landing's own copy of this contract lives with its other assertions in
// `src/components/home/__tests__/publicLanding.test.tsx`.
// ---------------------------------------------------------------------------

type El = { type?: unknown; props?: Record<string, unknown> };

function walk(node: unknown, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const el = node as El;
  visit(el);
  walk(el.props?.children, visit);
}

function hostElements(node: unknown): El[] {
  const found: El[] = [];
  walk(node, (el) => {
    if (typeof el.type === 'string') found.push(el);
  });
  return found;
}

/** String CHILDREN only — attribute values are not text. */
function textContent(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) textContent(child, out);
    return out;
  }
  if (node && typeof node === 'object') textContent((node as El).props?.children, out);
  return out;
}

/** The visible mark, concatenated with NO separator — a space here is the defect. */
function visibleMark(tree: unknown): string {
  return hostElements(renderDeep(tree))
    .filter((el) => el.props?.['aria-hidden'] === 'true')
    .map((el) => textContent(el.props?.children).join(''))
    .join('');
}

function accessibleNames(tree: unknown): string[] {
  return hostElements(renderDeep(tree))
    .filter(
      (el) => typeof el.props?.className === 'string' && el.props.className.includes('sr-only')
    )
    .flatMap((el) => textContent(el.props?.children));
}

const SURFACES = [
  { name: '/login', tree: () => LoginPage() },
  {
    name: '/ (admin league dashboard)',
    tree: () => AdminLeagueDashboard({ leagues: [], ownerCountBySlug: {}, isPlatformAdmin: true }),
  },
] as const;

for (const { name, tree } of SURFACES) {
  // REGRESSION TEST — the brand is ONE WORD. The mark is two nodes so the `f`/`W`
  // pair can take optical margin; a space character, or JSX whitespace between
  // them, silently rebrands the product on every surface at once.
  test(`${name} renders the brand as TurfWar with no whitespace`, () => {
    const mark = visibleMark(tree());
    assert.equal(mark, 'TurfWar');
    assert.ok(!/\s/.test(mark), `no whitespace inside the mark; got ${JSON.stringify(mark)}`);
  });

  test(`${name} announces the spaced product name`, () => {
    assert.ok(
      accessibleNames(tree()).includes('Turf War'),
      'a screen reader gets the real product name, not the compound'
    );
  });

  // The marketing descriptor belongs to the landing hero. Following the mark onto
  // an interior header would turn a product identity into a tagline.
  test(`${name} carries no marketing descriptor`, () => {
    const text = textContent(renderDeep(tree())).join(' ');
    assert.ok(!/college football pools/i.test(text));
  });
}

// The treatment is SCALE-INVARIANT, which is what lets one set of declarations
// serve a 96px landing mark and a 24px interior header. Both values are `em`, and
// the join must clear the tracking — at `-0.03em`, a `0.04em` margin nets +0.01em
// and is invisible. Asserting the NET means retightening the tracking cannot
// silently swallow the gap at every surface at once.
test('the shared treatment stays scale-invariant and the join clears the tracking', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/wordmark.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );

  assert.ok(!/font-size/.test(css), 'size is the caller`s, never the treatment`s');
  assert.ok(!/line-height/.test(css), 'and so is leading');

  const tracking = css.match(/\.wordmark\s*\{[^}]*letter-spacing:\s*(-?[\d.]+)em/);
  const margin = css.match(/\.wordmark-join\s*\{[^}]*margin-left:\s*(-?[\d.]+)em/);
  assert.ok(tracking && margin, 'both values are declared in em');

  const net = Number(margin[1]) + Number(tracking[1]);
  assert.ok(
    net >= 0.05,
    `net f/W gap must stay perceptible; got ${net.toFixed(3)}em ` +
      `(margin ${margin[1]}em + tracking ${tracking[1]}em)`
  );
});
