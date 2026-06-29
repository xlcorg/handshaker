import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";
import { fuzzyMatch } from "./fuzzy";
import { flattenRequests, rankRequests, rankCollections } from "./palette";

export type PaletteRow =
  | { kind: "collection"; value: string; collection: CollectionIpc; indices: number[] }
  | {
      kind: "request";
      value: string;
      collectionId: string;
      collectionName: string;
      request: SavedRequestIpc;
      indices: number[];
    }
  | { kind: "overview"; value: string; collectionId: string; collectionName: string };

export interface PaletteGroup {
  heading: string | null;
  rows: PaletteRow[];
}

export interface PaletteResult {
  /** Flat, in render order — used by the component for highlight lookup. */
  rows: PaletteRow[];
  groups: PaletteGroup[];
}

export interface PaletteLimits {
  collections: number;
  requests: number;
}

export interface DeriveInput {
  tree: CollectionIpc[];
  scope: { id: string; name: string } | null;
  query: string;
  limits: PaletteLimits;
}

/** Fuzzy-match indices of `query` against a display `target` (empty when no match/empty query). */
function matchIndices(query: string, target: string): number[] {
  const q = query.trim();
  if (!q) return [];
  const m = fuzzyMatch(q, target);
  return m.matched ? m.indices : [];
}

/**
 * Pure state → rows for the palette. Flat mode (scope=null) groups matching collections
 * then requests; scoped mode lists the collection's requests (plus an overview row when the
 * method query is empty). Row `value`s are assigned sequentially (`r0`, `r1`, …) in render
 * order so they are unique and lowercase — dodging cmdk's value normalisation.
 */
export function derivePaletteResults(input: DeriveInput): PaletteResult {
  const { tree, scope, query, limits } = input;
  const groups: PaletteGroup[] = [];

  if (scope) {
    const col = tree.find((c) => c.id === scope.id);
    // In scoped mode match only against request name (not full haystack) so that
    // e.g. "sea" doesn't match "GetStatus" via the service string.
    const allHits = col ? rankRequests(query, flattenRequests([col])) : [];
    const hits = query.trim()
      ? allHits.filter((h) => fuzzyMatch(query.trim(), h.request.name).matched)
      : allHits;
    const requestRows: PaletteRow[] = hits.map((h) => ({
      kind: "request",
      value: "",
      collectionId: h.collectionId,
      collectionName: h.collectionName,
      request: h.request,
      indices: matchIndices(query, h.request.name),
    }));
    if (query.trim() === "") {
      groups.push({
        heading: null,
        rows: [{ kind: "overview", value: "", collectionId: scope.id, collectionName: scope.name }],
      });
    }
    if (requestRows.length > 0) groups.push({ heading: messages.palette.groupMethods(scope.name), rows: requestRows });
  } else if (query.trim() !== "") {
    const colRows: PaletteRow[] = rankCollections(query, tree)
      .slice(0, limits.collections)
      .map((h) => ({ kind: "collection", value: "", collection: h.collection, indices: h.indices }));
    const reqRows: PaletteRow[] = rankRequests(query, flattenRequests(tree))
      .slice(0, limits.requests)
      .map((h) => ({
        kind: "request",
        value: "",
        collectionId: h.collectionId,
        collectionName: h.collectionName,
        request: h.request,
        indices: matchIndices(query, h.request.name),
      }));
    if (colRows.length > 0) groups.push({ heading: messages.palette.groupCollections, rows: colRows });
    if (reqRows.length > 0) groups.push({ heading: messages.palette.groupRequests, rows: reqRows });
  }

  let i = 0;
  const rows: PaletteRow[] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      r.value = `r${i++}`;
      rows.push(r);
    }
  }
  return { rows, groups };
}

/**
 * Collection to commit when the user presses "." in flat mode: the highlighted collection
 * if one is highlighted, else the top-ranked fuzzy match. Null for an empty query or no match
 * (so "." on an empty input never commits a random collection).
 */
export function bestCollectionMatch(
  tree: CollectionIpc[],
  query: string,
  highlightedCollectionId: string | null,
): { id: string; name: string } | null {
  if (query.trim() === "") return null;
  if (highlightedCollectionId) {
    const c = tree.find((x) => x.id === highlightedCollectionId);
    if (c) return { id: c.id, name: c.name };
  }
  const top = rankCollections(query, tree)[0];
  return top ? { id: top.collection.id, name: top.collection.name } : null;
}

/** TAB-completion string for a row: a request completes to its name; others don't complete. */
export function completionFor(row: PaletteRow): string | null {
  return row.kind === "request" ? row.request.name : null;
}
