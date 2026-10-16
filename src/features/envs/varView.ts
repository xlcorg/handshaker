/** How the variable table is shown. The saved row order is separate and is what Save writes. */

export type VarSort =
  | { by: "saved" }
  | { by: "key"; dir: "asc" | "desc" }
  | { by: "value"; dir: "asc" | "desc" };

export function varSortId(sort: VarSort): string {
  return sort.by === "saved" ? "saved" : `${sort.by}-${sort.dir}`;
}

/** Column click: first press sorts ascending, second descending, third returns to saved order. */
export function cycleVarSort(
  current: VarSort,
  column: "key" | "value",
): VarSort {
  if (current.by !== column) return { by: column, dir: "asc" };
  if (current.dir === "asc") return { by: column, dir: "desc" };
  return { by: "saved" };
}

/** Rows whose key contains `query`, in `sort` order. Saved order is the input order. */
export function viewVarRows<T extends { key: string; value: string }>(
  rows: readonly T[],
  query: string,
  sort: VarSort,
): T[] {
  const q = query.trim().toLowerCase();
  const filtered =
    q.length === 0
      ? rows.slice()
      : rows.filter((row) => row.key.toLowerCase().includes(q));
  if (sort.by === "saved") return filtered;
  const dir = sort.dir === "asc" ? 1 : -1;
  const field = sort.by;
  return filtered.sort(
    (a, b) =>
      a[field].localeCompare(b[field], undefined, {
        numeric: true,
        sensitivity: "base",
      }) * dir,
  );
}
