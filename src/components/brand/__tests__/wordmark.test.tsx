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

// ---------------------------------------------------------------------------
// The shared stylesheet's contract.
//
// These assert PROPERTIES OF THE MARK a user would notice — it scales, it reads
// as one word, and the typeface's own kerning is the authority — not the
// particular optical values, which are a design judgement and are meant to stay
// tunable. An earlier version of this test froze the arithmetic
// (`margin + tracking >= 0.05em`) and so protected the very treatment that
// produced both defects this pass fixed.
// ---------------------------------------------------------------------------

/** The treatment, comments stripped so prose can discuss values it does not set. */
function treatment(): string {
  return readFileSync(join(process.cwd(), 'src/styles/wordmark.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );
}

/** A declared length in em; `normal`/absent reads as 0. Throws on any other unit. */
function em(css: string, rule: string, prop: string): number {
  const block = css.match(new RegExp(`\\.${rule}\\s*\\{([^}]*)\\}`));
  if (!block) return 0;
  const decl = block[1].match(new RegExp(`${prop}:\\s*([^;]+)`));
  if (!decl) return 0;
  const value = decl[1].trim();
  if (value === 'normal' || value === '0') return 0;
  const number = value.match(/^(-?[\d.]+)em$/);
  assert.ok(number, `${rule} { ${prop} } must be em-based for scale invariance; got ${value}`);
  return Number(number[1]);
}

test('the shared treatment stays scale-invariant', () => {
  const css = treatment();

  assert.ok(!/font-size/.test(css), 'size is the caller`s, never the treatment`s');
  assert.ok(!/line-height/.test(css), 'and so is leading');

  // One set of declarations serves a 96px landing mark and a 24px interior
  // header. An absolute length is the regression: it would be tuned at one size
  // and wrong at the other, with no failure at the size it was tuned for.
  assert.ok(
    !/:\s*-?[\d.]+(px|rem|pt|ch|vw|vh)\b/.test(css),
    'the treatment declares no absolute lengths'
  );
});

// REGRESSION TEST — the typeface's kerning is the authority, not a global lever.
//
// The UI faces this renders in kern `r` → `f` OPEN (+0.023em in SF at weight
// 800) because the `r`'s arm and the italic `f` collide without it. Blanket
// negative tracking applies after EVERY letter, so it cancels that correction
// wholesale: at -0.03em the pair closed to a 1px pinch at the landing's 96px
// while its neighbours sat at 5–6px. This pins the mechanism, not a magnitude —
// any non-negative tracking passes.
test('the wordmark applies no global negative tracking', () => {
  const tracking = em(treatment(), 'wordmark', 'letter-spacing');

  assert.ok(
    tracking >= 0,
    `global negative tracking overrides the font's per-pair kerning; got ${tracking}em`
  );
});

// REGRESSION TEST — the brand is ONE WORD, and the join must not become a space.
//
// The join is an optical nudge for a pair no typeface kerns. It is NOT a word
// separator, and past a point that distinction stops being visible: the shipped
// `0.09em` margin, net `0.06em` of the tracking it paid back, read as "Turf War"
// at hero size. This is a CEILING with an empirical basis, so the value below it
// stays a free design choice.
test('the f/W join stays an optical nudge, not a word space', () => {
  const css = treatment();

  // The component emits `.wordmark-join` on every surface, so the stylesheet
  // owes it a rule — a class with no declaration is a leftover, and the
  // separation would silently become whatever the raw font metrics give. `em`
  // is what carries it from the 96px landing mark to a 24px header unchanged.
  assert.match(
    css,
    /\.wordmark-join\s*\{[^}]*margin-left:\s*-?[\d.]+em/,
    'the join the component emits is declared, in em'
  );

  const net = em(css, 'wordmark-join', 'margin-left') + em(css, 'wordmark', 'letter-spacing');

  assert.ok(
    net < 0.04,
    `net f/W separation must not read as a space; got ${net.toFixed(3)}em ` +
      '(0.06em demonstrably rebrands the mark to "Turf War")'
  );
});
