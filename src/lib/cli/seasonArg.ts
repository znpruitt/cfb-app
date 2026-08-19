/**
 * Parsing for the `--year <season>` flag shared by catalog-regenerating CLI
 * scripts.
 *
 * Pure and I/O-free so it can be tested: the caller decides how to report an
 * `invalid` result (`scripts/fetch-cfbd-teams.ts` prints the message and exits
 * non-zero rather than overwriting the canonical seed with a bad fetch).
 *
 * `Number` rather than `Number.parseInt`: `parseInt('20256x')` silently yields
 * `20256`, so a typo would pin a plausible-looking wrong season. `Number` rejects
 * any trailing garbage outright.
 */
export type SeasonArg =
  | { kind: 'pinned'; year: number }
  | { kind: 'current' }
  | { kind: 'invalid'; message: string };

/** Seasons outside this range are a typo, not a request. */
const MIN_SEASON = 2000;
const MAX_SEASON = 2100;

export function parseSeasonArg(argv: readonly string[]): SeasonArg {
  const flagIndex = argv.indexOf('--year');
  if (flagIndex < 0) return { kind: 'current' };

  const raw = argv[flagIndex + 1];

  // `--year` as the final token previously fell through to an UNPINNED fetch:
  // the operator asked to pin a season and silently got the opposite. Refuse.
  if (raw === undefined || raw.trim() === '' || raw.startsWith('--')) {
    return {
      kind: 'invalid',
      message: '--year requires a season, e.g. --year 2026',
    };
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return {
      kind: 'invalid',
      message: `--year must be a whole season number (got "${raw}")`,
    };
  }

  if (parsed < MIN_SEASON || parsed > MAX_SEASON) {
    return {
      kind: 'invalid',
      message: `--year must be between ${MIN_SEASON} and ${MAX_SEASON} (got "${raw}")`,
    };
  }

  return { kind: 'pinned', year: parsed };
}
