import React from 'react';

import type { OwnerMatchupMatrix } from '../lib/overview';
import type { CanonicalStandings } from '../lib/selectors/leagueStandings';

function recordCellClass(record: string | null, isDiagonal: boolean, hasGames: boolean): string {
  if (isDiagonal) return 'bg-gray-100/80 dark:bg-zinc-800/70';
  if (!hasGames) return 'text-gray-400 dark:text-zinc-600';
  if (!record) return 'font-semibold text-gray-900 dark:text-zinc-100';
  const parts = record.split('\u2013'); // en dash
  const w = parseInt(parts[0] ?? '0', 10);
  const l = parseInt(parts[1] ?? '0', 10);
  if (w > l)
    return 'bg-emerald-50/80 font-semibold text-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100';
  if (l > w)
    return 'bg-rose-50/80 font-semibold text-rose-900 dark:bg-rose-950/25 dark:text-rose-100';
  return 'font-semibold text-gray-900 dark:text-zinc-100';
}

type FocusableElement = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

function ownerPairKey(owners: [string, string]): string {
  const [left, right] = owners;
  return left.localeCompare(right) <= 0 ? `${left}::${right}` : `${right}::${left}`;
}

export function scrollFocusedOwnerPairIntoView(params: {
  focusedOwnerPair: [string, string] | null;
  refsByOwnerPair: Map<string, FocusableElement>;
}): boolean {
  const { focusedOwnerPair, refsByOwnerPair } = params;
  if (!focusedOwnerPair) return false;
  const cell = refsByOwnerPair.get(ownerPairKey(focusedOwnerPair));
  if (!cell) return false;
  cell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  return true;
}

export default function MatchupMatrixView({
  matrix,
  focusedOwnerPair = null,
  canonicalStandings = null,
}: {
  matrix: OwnerMatchupMatrix;
  focusedOwnerPair?: [string, string] | null;
  /**
   * Canonical standings snapshot loaded server-side. When present, drives the
   * matrix axis order (alphabetical, NoClaim-filtered, stable) so the grid
   * matches the owner identity rendered by Standings/Overview/Matchups. Falls
   * back to the matrix's own owner order when canonical is absent.
   */
  canonicalStandings?: CanonicalStandings | null;
}): React.ReactElement {
  const ownerPairRefs = React.useRef<Map<string, HTMLTableCellElement>>(new Map());

  React.useEffect(() => {
    scrollFocusedOwnerPairIntoView({
      focusedOwnerPair,
      refsByOwnerPair: ownerPairRefs.current,
    });
  }, [focusedOwnerPair]);

  // Reorder rows/cells along canonical's owner axis when canonical is present.
  // Owners that exist in matrix but not in canonical (mid-session additions)
  // are appended after the canonical block in alphabetical order so they stay
  // visible. Cell ordering must mirror axis ordering, so we re-key both rows
  // and cells through name lookups instead of index math.
  const orderedMatrix = React.useMemo<OwnerMatchupMatrix>(() => {
    if (!canonicalStandings) return matrix;
    const matrixOwnerSet = new Set(matrix.owners);
    const orderedOwners: string[] = [];
    for (const owner of canonicalStandings.ownerColorOrder) {
      if (matrixOwnerSet.has(owner)) {
        orderedOwners.push(owner);
        matrixOwnerSet.delete(owner);
      }
    }
    const trailingOwners = [...matrixOwnerSet].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    orderedOwners.push(...trailingOwners);
    if (
      orderedOwners.length === matrix.owners.length &&
      orderedOwners.every((owner, index) => owner === matrix.owners[index])
    ) {
      return matrix;
    }
    const rowsByOwner = new Map(matrix.rows.map((row) => [row.owner, row] as const));
    const orderedRows = orderedOwners
      .map((rowOwner) => {
        const sourceRow = rowsByOwner.get(rowOwner);
        if (!sourceRow) return null;
        const cellByOwner = new Map(sourceRow.cells.map((cell) => [cell.owner, cell] as const));
        const orderedCells = orderedOwners
          .map((columnOwner) => cellByOwner.get(columnOwner))
          .filter((cell): cell is NonNullable<typeof cell> => Boolean(cell));
        return { owner: rowOwner, cells: orderedCells };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    return { owners: orderedOwners, rows: orderedRows };
  }, [canonicalStandings, matrix]);

  if (orderedMatrix.owners.length === 0) {
    return (
      <section className="rounded-xl border border-gray-200 bg-gray-50/80 p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-3 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
          No matrix data yet. Upload owner assignments and games to populate owner-vs-owner counts.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-300 bg-gray-50 p-3.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="min-w-max border-separate border-spacing-0 text-center text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-widest text-gray-500 dark:text-zinc-500">
              <th className="sticky left-0 z-10 whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-900">
                Owner
              </th>
              {orderedMatrix.owners.map((owner) => (
                <th
                  key={owner}
                  className="w-14 whitespace-nowrap border-b border-gray-200 px-2 py-1.5 font-semibold dark:border-zinc-700"
                >
                  {owner}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedMatrix.rows.map((row) => (
              <tr
                key={row.owner}
                className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
              >
                <th className="sticky left-0 z-10 whitespace-nowrap border-b border-gray-100 bg-inherit px-2 py-1.5 text-left font-semibold leading-tight text-gray-950 dark:border-zinc-800 dark:text-zinc-50">
                  {row.owner}
                </th>
                {row.cells.map((cell) => {
                  const isDiagonal = cell.owner === row.owner;
                  const hasGames = cell.gameCount > 0;
                  const isFocusedPair =
                    focusedOwnerPair != null &&
                    ((focusedOwnerPair[0] === row.owner && focusedOwnerPair[1] === cell.owner) ||
                      (focusedOwnerPair[1] === row.owner && focusedOwnerPair[0] === cell.owner));

                  return (
                    <td
                      key={`${row.owner}-${cell.owner}`}
                      ref={(element) => {
                        const key = ownerPairKey([row.owner, cell.owner]);
                        if (!element) {
                          ownerPairRefs.current.delete(key);
                          return;
                        }
                        ownerPairRefs.current.set(key, element);
                      }}
                      className={`w-14 border-b border-gray-100 px-2 py-1.5 align-middle leading-tight dark:border-zinc-800 ${recordCellClass(cell.record, isDiagonal, hasGames)} ${isFocusedPair ? 'ring-1 ring-inset ring-blue-500 dark:ring-blue-500' : ''}`}
                      data-owner-pair-cell={ownerPairKey([row.owner, cell.owner])}
                    >
                      {hasGames ? (
                        <span>{cell.record ?? String(cell.gameCount)}</span>
                      ) : (
                        <span>{isDiagonal ? '—' : ''}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
