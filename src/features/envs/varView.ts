import type { RowId } from "./envDraft";

export const SORT_MODES = [
  "name-asc",
  "name-desc",
  "oldest",
  "newest",
] as const;
export type SortMode = (typeof SORT_MODES)[number];
export const DEFAULT_SORT: SortMode = "oldest";

export function toggleNameSort(sort: SortMode): SortMode {
  return sort === "name-asc" ? "name-desc" : "name-asc";
}

export interface NameSortIndicator {
  readonly arrow: "up" | "down" | null;
  readonly ariaSort: "ascending" | "descending" | "none";
}

export function nameSortIndicator(sort: SortMode): NameSortIndicator {
  switch (sort) {
    case "name-asc":
      return { arrow: "up", ariaSort: "ascending" };
    case "name-desc":
      return { arrow: "down", ariaSort: "descending" };
    case "oldest":
    case "newest":
      return { arrow: null, ariaSort: "none" };
  }
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface LayoutHold {
  readonly sort: SortMode;
  readonly shown: readonly RowId[];
  readonly hidden: ReadonlySet<RowId>;
}

export interface ViewState {
  readonly query: string;
  readonly hold: LayoutHold | null;
  readonly shownAnyway: ReadonlySet<RowId>;
}

type Keyed = { readonly id: RowId; readonly key: string };

export interface ViewSource<R extends Keyed> {
  readonly rows: readonly R[];
  readonly draft: R | null;
  readonly mustShow: ReadonlySet<RowId>;
}

export interface ViewEntry<R> {
  readonly row: R;
  readonly match: Span | null;
  readonly draft: boolean;
}

export interface VarView<R> {
  readonly entries: readonly ViewEntry<R>[];
  readonly shown: number;
  readonly total: number;
  readonly filtering: boolean;
  readonly noMatches: boolean;
}

export const initialView: ViewState = {
  query: "",
  hold: null,
  shownAnyway: new Set(),
};

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function normalize(query: string): string {
  return query.trim().toLowerCase();
}

function arrange<R extends Keyed>(
  src: ViewSource<R>,
  view: ViewState,
  sort: SortMode,
): R[] {
  const q = normalize(view.query);
  const kept = src.rows.filter(
    (row) =>
      q === "" ||
      row.key.toLowerCase().includes(q) ||
      view.shownAnyway.has(row.id) ||
      src.mustShow.has(row.id),
  );
  switch (sort) {
    case "name-asc":
      return kept.sort((a, b) => collator.compare(a.key, b.key));
    case "name-desc":
      return kept.sort((a, b) => collator.compare(b.key, a.key));
    case "oldest":
      return kept;
    case "newest":
      return kept.reverse();
  }
}

function heldRows<R extends Keyed>(rows: readonly R[], hold: LayoutHold): R[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const held = new Set(hold.shown);
  return [
    ...hold.shown.flatMap((id) => byId.get(id) ?? []),
    ...rows.filter((row) => !held.has(row.id) && !hold.hidden.has(row.id)),
  ];
}

export function viewRows<R extends Keyed>(
  src: ViewSource<R>,
  view: ViewState,
  sort: SortMode,
): VarView<R> {
  const hold = view.hold?.sort === sort ? view.hold : null;
  const visible = hold ? heldRows(src.rows, hold) : arrange(src, view, sort);
  const entries: ViewEntry<R>[] = visible.map((row) => ({
    row,
    match: matchSpan(row.key, view.query),
    draft: false,
  }));
  if (src.draft) {
    entries.push({ row: src.draft, match: null, draft: true });
  }
  const filtering = normalize(view.query) !== "";
  return {
    entries,
    shown: visible.length,
    total: src.rows.length,
    filtering,
    noMatches: filtering && visible.length === 0,
  };
}

/** null when lowercasing changes the key's length, since offsets would lie. */
export function matchSpan(key: string, query: string): Span | null {
  const q = normalize(query);
  if (q === "") return null;
  const lower = key.toLowerCase();
  if (lower.length !== key.length) return null;
  const start = lower.indexOf(q);
  return start < 0 ? null : { start, end: start + q.length };
}

export function setQuery(view: ViewState, query: string): ViewState {
  if (query === view.query) return view;
  const shownAnyway =
    normalize(query) === "" ? initialView.shownAnyway : view.shownAnyway;
  return { ...view, query, shownAnyway };
}

export function holdLayout<R extends Keyed>(
  view: ViewState,
  src: ViewSource<R>,
  sort: SortMode,
): ViewState {
  if (view.hold?.sort === sort) return view;
  const shown = arrange(src, view, sort).map((row) => row.id);
  const visible = new Set(shown);
  const hidden = new Set(
    src.rows.filter((row) => !visible.has(row.id)).map((row) => row.id),
  );
  return { ...view, hold: { sort, shown, hidden } };
}

export function releaseLayout(view: ViewState): ViewState {
  return view.hold ? { ...view, hold: null } : view;
}

export function showAnyway(view: ViewState, id: RowId): ViewState {
  if (normalize(view.query) === "" || view.shownAnyway.has(id)) return view;
  return { ...view, shownAnyway: new Set(view.shownAnyway).add(id) };
}

export function neighborIn<T>(ordered: readonly T[], removed: T): T | null {
  const at = ordered.indexOf(removed);
  if (at < 0) return null;
  return ordered[at + 1] ?? ordered[at - 1] ?? null;
}
