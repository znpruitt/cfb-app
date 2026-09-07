/**
 * The ONE table both `hasUnsafeCharacter` implementations are pinned against —
 * the durable store's in `src/lib/server/pollingPlannerRecord.ts` and the CLI's
 * in `scripts/lib/qstashSchedule.ts`.
 *
 * WHY IT EXISTS. The two functions are deliberately re-declared rather than
 * shared: the operator CLI carries no application import, which is the whole
 * safety argument for a script that handles two credentials. Round 2's docstring
 * claimed "a test pins the two against the same table" — and that was FALSE. The
 * two suites each carried their own hand-maintained list, and they had already
 * drifted: the CLI's was missing `0x009f` and `0x2069`. A claim that two things
 * cannot diverge, kept true by two independently edited copies, is the failure
 * mode it describes.
 *
 * Exporting one frozen table makes the claim true by construction instead of by
 * discipline. Adding a code point here is what extends BOTH suites at once, and a
 * function that misses it fails in the suite that owns it.
 *
 * The class is derived from the CONSUMER — an operator's terminal — not from what
 * looks unusual: C0, DEL and C1; the U+2028/U+2029 line separators, which
 * terminate a line in several renderers; and the bidi embeddings, overrides and
 * isolates, which visually reorder text so a value can read as something it is
 * not. `new URL()` accepts every one of them, so it backstops none of this.
 */
export const UNSAFE_CHARACTER_CODES: readonly number[] = Object.freeze([
  0x0000, // NUL
  0x0009, // TAB
  0x000a, // LF — the forged-line case
  0x000d, // CR
  0x001b, // ESC — terminal control sequences
  0x001f, // top of C0
  0x007f, // DEL
  0x0085, // NEL (C1)
  0x009f, // top of C1
  0x2028, // LINE SEPARATOR
  0x2029, // PARAGRAPH SEPARATOR
  0x202a, // LRE — bidi embedding
  0x202e, // RLO — bidi override
  0x2066, // LRI — bidi isolate
  0x2069, // PDI — pop directional isolate
]);

/**
 * Characters that must NOT be refused. Without these the table above is
 * satisfiable by a validator that rejects everything non-ASCII, which would be a
 * different bug wearing a passing badge.
 */
export const SAFE_CHARACTER_SAMPLES: readonly string[] = Object.freeze(['a', '9', '-', 'é', '漢']);
