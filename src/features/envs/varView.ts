import type { RowId } from "./envDraft";

export const SORT_MODES = ["key-asc", "key-desc", "added-newest", "added-oldest"] as const;
export type SortMode = (typeof SORT_MODES)[number];
export const DEFAULT_SORT: SortMode = "key-asc";

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface LayoutHold {
  readonly shown: readonly RowId[];
  readonly hidden: ReadonlySet<RowId>;
}

export interface ViewState {
  readonly query: string;
  readonly sort: SortMode;
  readonly hold: LayoutHold | null;
  readonly shownAnyway: ReadonlySet<RowId>;
}

type Keyed = { readonly id: RowId; readonly key: string };

export interface ViewSource<R extends Keyed> {
  readonly rows: readonly R[];
  readonly pending: R | null;
  readonly mustShow: ReadonlySet<RowId>;
}

export interface ViewEntry<R> {
  readonly row: R;
  readonly match: Span | null;
  readonly pending: boolean;
}

export interface VarView<R> {
  readonly entries: readonly ViewEntry<R>[];
  readonly shown: number;
  readonly total: number;
  readonly noMatches: boolean;
}

export const initialView: ViewState = {
  query: "",
  sort: DEFAULT_SORT,
  hold: null,
  shownAnyway: new Set(),
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function normalize(query: string): string {
  return query.trim().toLowerCase();
}

function arrange<R extends Keyed>(src: ViewSource<R>, view: ViewState): R[] {
  const q = normalize(view.query);
  const kept = src.rows.filter(
    (row) =>
      q === "" ||
      row.key.toLowerCase().includes(q) ||
      view.shownAnyway.has(row.id) ||
      src.mustShow.has(row.id),
  );
  switch (view.sort) {
    case "key-asc":
      return kept.sort((a, b) => collator.compare(a.key, b.key));
    case "key-desc":
      return kept.sort((a, b) => collator.compare(b.key, a.key));
    case "added-oldest":
      return kept;
    case "added-newest":
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

export function viewRows<R extends Keyed>(src: ViewSource<R>, view: ViewState): VarView<R> {
  const visible = view.hold ? heldRows(src.rows, view.hold) : arrange(src, view);
  const entries: ViewEntry<R>[] = visible.map((row) => ({
    row,
    match: matchSpan(row.key, view.query),
    pending: false,
  }));
  if (src.pending) {
    entries.push({ row: src.pending, match: matchSpan(src.pending.key, view.query), pending: true });
  }
  return {
    entries,
    shown: visible.length,
    total: src.rows.length,
    noMatches: normalize(view.query) !== "" && visible.length === 0,
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
  const shownAnyway = normalize(query) === "" ? initialView.shownAnyway : view.shownAnyway;
  return { ...view, query, shownAnyway };
}

export function setSort(view: ViewState, sort: SortMode): ViewState {
  return sort === view.sort ? view : { ...view, sort };
}

export function holdLayout<R extends Keyed>(view: ViewState, src: ViewSource<R>): ViewState {
  if (view.hold) return view;
  const shown = arrange(src, view).map((row) => row.id);
  const visible = new Set(shown);
  const hidden = new Set(src.rows.filter((row) => !visible.has(row.id)).map((row) => row.id));
  return { ...view, hold: { shown, hidden } };
}

export function releaseLayout(view: ViewState): ViewState {
  return view.hold ? { ...view, hold: null } : view;
}

export function showAnyway(view: ViewState, id: RowId): ViewState {
  if (normalize(view.query) === "" || view.shownAnyway.has(id)) return view;
  return { ...view, shownAnyway: new Set(view.shownAnyway).add(id) };
}

export function neighborOf<R extends Keyed>(v: VarView<R>, removed: RowId): RowId | null {
  const ids = v.entries.filter((entry) => !entry.pending).map((entry) => entry.row.id);
  const at = ids.indexOf(removed);
  if (at < 0) return null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}
