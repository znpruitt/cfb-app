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

/**
 * Every declaration in the file, as `{ prop, value }`.
 *
 * Innermost `{…}` bodies only, which is what keeps an AT-RULE PRELUDE out of the
 * results: in `@media (min-width: 640px) { .wordmark { … } }` the prelude sits
 * outside every innermost body, so `(min-width: 640px)` is never mistaken for a
 * declared value. A scan that split the whole file on `;` read it as one — and
 * then failed the file for containing a media query it was supposed to permit.
 */
function declarations(css: string): Array<{ prop: string; value: string }> {
  return [...css.matchAll(/\{([^{}]*)\}/g)].flatMap((body) =>
    body[1]
      .split(';')
      .map((declaration) => declaration.split(':'))
      .filter((parts) => parts.length >= 2)
      .map(([prop, ...rest]) => ({ prop: prop.trim(), value: rest.join(':').trim() }))
  );
}

/**
 * EVERY declared value of `prop` under `.rule`, in document order, in em.
 *
 * Every one, not the first: a second block — a media query, a dark-mode variant —
 * wins the cascade over the block above it, so reading only the first lets an
 * override reintroduce exactly what these tests forbid. The assertions below hold
 * for ALL declared values rather than modelling which one a given viewport
 * resolves to; a guard should not have to simulate a cascade.
 *
 * The selector match is deliberately loose about what surrounds the class —
 * `.wordmark:hover {`, `.wordmark, .other {` — because an earlier version
 * required a BARE `.wordmark {` and a grouped selector walked straight past it.
 * `(?![\w-])` is what keeps `.wordmark-join` from answering for `.wordmark`.
 *
 * Even so, this is a regex over CSS text and it is only trusted to read VALUES.
 * The two properties whose absence would be a defect are guarded by whole-file
 * scans below, which no selector form can dodge.
 *
 * An empty result means the property is NOT DECLARED, which is never the same as
 * declaring zero — an undeclared `letter-spacing` inherits, and inherited
 * tracking is the thing being guarded against. Callers must reject `[]`
 * explicitly; nothing here defaults it to a passing value.
 */
function declaredEm(css: string, rule: string, prop: string): number[] {
  const blocks = [...css.matchAll(new RegExp(`\\.${rule}(?![\\w-])[^{]*\\{([^}]*)\\}`, 'g'))];
  return blocks.flatMap((block) =>
    [...block[1].matchAll(new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+)`, 'g'))].map((decl) => {
      const value = decl[1].trim();
      if (value === 'normal' || value === '0') return 0;
      const number = value.match(/^(-?[\d.]+)em$/);
      assert.ok(number, `${rule} { ${prop} } must be em-based for scale invariance; got ${value}`);
      return Number(number[1]);
    })
  );
}

test('the shared treatment stays scale-invariant', () => {
  const css = treatment();

  assert.ok(!/font-size/.test(css), 'size is the caller`s, never the treatment`s');
  assert.ok(!/line-height/.test(css), 'and so is leading');

  // One set of declarations serves a 96px landing mark and a 24px interior
  // header. An absolute length is the regression: it would be tuned at one size
  // and wrong at the other, with no failure at the size it was tuned for.
  //
  // Scanned per DECLARATION VALUE, not per character-after-the-colon: a
  // shorthand (`margin: 0 0 0 2px`) overrides the em join with a fixed length
  // and would otherwise slip past — the regression this test is named for,
  // hiding in the one syntax the check could not see.
  //
  // `%` is NOT in the list. It is a relative unit, so it is not the defect this
  // names, and including it failed the file for `hsl(0 0% 50%)` — a guard that
  // rejects valid CSS gets deleted, not obeyed.
  const absolute = /(?:^|[\s(,])-?\d*\.?\d+(px|pt|pc|in|cm|mm|q|ch|ex|rem|vw|vh|vmin|vmax|lh)\b/i;
  for (const { prop, value } of declarations(css)) {
    assert.ok(
      !absolute.test(value),
      `the treatment declares no absolute lengths; got ${prop}: ${value}`
    );
  }
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
  const css = treatment();

  // WHOLE-FILE, not per-selector. Every attempt to read this out of a parsed
  // `.wordmark` block has been walked past by some selector form the regex did
  // not anticipate — `.wordmark:hover`, then `.wordmark, .other`. The property
  // is negative or it is not; nothing in this stylesheet may declare it
  // negative, whatever the selector, so the simplest possible scan is also the
  // only one with no gap in it.
  assert.ok(
    !/letter-spacing:\s*-/.test(css),
    'global negative tracking overrides the font`s per-pair kerning, at any selector'
  );

  // The declaration must EXIST. `letter-spacing: normal` looks like a no-op and
  // invites deletion in a later tidy — the stylesheet's own comment says so —
  // but it is the reset that stops a caller's inherited `tracking-tight` from
  // reaching the mark. Absent, this test would be asserting nothing while the
  // collision it is named for reopened on all three surfaces at once.
  assert.ok(
    declaredEm(css, 'wordmark', 'letter-spacing').length > 0,
    '.wordmark must DECLARE its tracking; an undeclared value inherits the caller`s'
  );
});

// REGRESSION TEST — the `f`/`W` join is VISIBLE, and it is not a word space.
//
// Both bounds are empirical, and both have already been shipped as defects:
//
//  - Below ~0.01em the join is invisible. A `0.04em` margin against `-0.03em`
//    tracking netted +0.01em — about a pixel at hero size, on a centred mark, so
//    each word moved half a pixel. It was correct CSS that won the cascade and
//    changed nothing anyone could see.
//  - At 0.06em net the mark reads as two words: the treatment that shipped
//    before this pass rebranded the product to "Turf War" at hero size.
//
// A BAND, not an equality — the value inside it stays a free design choice,
// which is the point: the assertion this replaced was `net >= 0.05` and so
// protected the very treatment that produced the second defect. The floor does
// mean a future face that kerns `f`/`W` well enough to need no join at all
// requires a deliberate edit here. That is the intent — a guard should force the
// decision, not let the gap drift back to invisible unnoticed.
test('the f/W join stays visible, and stays an optical nudge', () => {
  const css = treatment();
  const joins = declaredEm(css, 'wordmark-join', 'margin-left');
  const trackings = declaredEm(css, 'wordmark', 'letter-spacing');

  // The component emits `.wordmark-join` on every surface, so the stylesheet
  // owes it a rule — a class with no declaration is a leftover, and the
  // separation would silently become whatever the raw font metrics give. `em`
  // is what carries it from the 96px landing mark to a 24px header unchanged.
  assert.ok(joins.length > 0, 'the join the component emits is declared, in em');

  // …and the net below must be the value that actually applies. `margin: 0`
  // after `margin-left: 0.02em` zeroes the join while every reader above still
  // sees the longhand, so the whole band would be asserted about a value the
  // browser discarded. WHOLE-FILE again, for the same reason as the tracking
  // scan: no shorthand at all, at any selector. Switching the join to a logical
  // property is then a deliberate edit here, not a silent one.
  for (const { prop } of declarations(css)) {
    assert.ok(
      !prop.startsWith('margin') || prop === 'margin-left',
      `the join is \`margin-left\`; \`${prop}\` can override it silently`
    );
  }

  // The tracking must be declared for the net to MEAN anything: undeclared, it
  // inherits from the caller and the arithmetic below has no left-hand side. An
  // empty list would otherwise skip the loop entirely and assert nothing — the
  // exact vacuity `declaredEm` warns about.
  assert.ok(
    trackings.length > 0,
    '.wordmark must DECLARE its tracking; the net f/W gap is unknowable without it'
  );

  // Every combination, because `letter-spacing` applies after the `f` too: the
  // margin pays the tracking back before it adds anything visible, so the NET is
  // the only quantity a reader sees.
  for (const join of joins) {
    for (const tracking of trackings) {
      const net = join + tracking;
      assert.ok(
        net >= 0.01,
        `the f/W join must be visible; got ${net.toFixed(3)}em ` +
          `(margin ${join}em + tracking ${tracking}em ≈ ${(net * 96).toFixed(1)}px at hero size)`
      );
      assert.ok(
        net < 0.04,
        `net f/W separation must not read as a space; got ${net.toFixed(3)}em ` +
          '(0.06em demonstrably rebrands the mark to "Turf War")'
      );
    }
  }
});
