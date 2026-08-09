/**
 * The TurfWar wordmark.
 *
 * A SERVER component with no state and no behaviour — it exists so the treatment
 * is defined once, because four of its properties are non-obvious and each was a
 * bug at some point:
 *
 *  1. `Turf` and `War` are SEPARATE NODES with no whitespace between them. The
 *     split is optical, not orthographic — the brand is one word. A space
 *     character, or a newline JSX would interpret as one, silently rebrands the
 *     product to "Turf War".
 *  2. The visible mark is `aria-hidden`, with an `sr-only` `Turf War` supplying
 *     the accessible name. A screen reader announcing "TurfWar" as one token is
 *     worse than the product's actual name.
 *  3. The join margin exists to clear the wordmark's NEGATIVE tracking. At
 *     `-0.03em` letter-spacing a naive `0.04em` margin nets +0.01em — about a
 *     pixel, and invisible. The shipped pair is `-0.03em` / `0.09em`, a net
 *     `0.06em` gap.
 *  4. Both values are in `em`, which is what makes the treatment SCALE-INVARIANT:
 *     the same declarations give the homepage's 96px mark and a 24px header the
 *     identical optical relationship, with no second set of values to maintain.
 *
 * Size is deliberately NOT set here. Callers supply it — `clamp()` on the
 * landing, `text-2xl` on interior headers — and the em-based treatment follows.
 * The semantic element is the caller's too: the landing's mark is a `<p>` because
 * its `<h1>` is the product statement, while interior surfaces use `<h1>` because
 * there the brand IS the heading.
 */
export default function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'}>
      {/* No whitespace between these nodes. See (1) above. */}
      <span aria-hidden="true">
        Turf<span className="wordmark-join">War</span>
      </span>
      <span className="sr-only">Turf War</span>
    </span>
  );
}
