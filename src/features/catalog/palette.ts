import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { fuzzyMatch } from "./fuzzy";

export interface RequestHit {
  collectionId: string;
  collectionName: string;
  /** Folder names from collection root to the request's parent (excludes the request). */
  folderPath: string[];
  request: SavedRequestIpc;
}

function walk(items: ItemIpc[], path: string[], c: CollectionIpc, out: RequestHit[]): void {
  for (const it of items) {
    if (it.type === "folder") {
      walk(it.items, [...path, it.name], c, out);
    } else {
      out.push({ collectionId: c.id, collectionName: c.name, folderPath: path, request: it });
    }
  }
}

/** Flatten every saved request across all collections into a searchable list. */
export function flattenRequests(collections: CollectionIpc[]): RequestHit[] {
  const out: RequestHit[] = [];
  for (const c of collections) walk(c.items, [], c, out);
  return out;
}

/** Searchable haystack for a hit: name + `service.method` + address. */
function haystack(h: RequestHit): string {
  const r = h.request;
  return `${r.name} ${r.service}.${r.method} ${r.address_template}`;
}

interface Ranked {
  hit: RequestHit;
  score: number;
}

/**
 * Rank hits by fuzzy match across name/service/method/address. An empty query returns all
 * hits sorted by request name; otherwise non-matching hits are dropped and matches are sorted
 * by descending score (name as the tie-break).
 */
export function rankRequests(query: string, hits: RequestHit[]): RequestHit[] {
  const q = query.trim();
  if (!q) return [...hits].sort((a, b) => a.request.name.localeCompare(b.request.name));
  const ranked: Ranked[] = [];
  for (const hit of hits) {
    const m = fuzzyMatch(q, haystack(hit));
    if (m.matched) ranked.push({ hit, score: m.score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.hit.request.name.localeCompare(b.hit.request.name))
    .map((r) => r.hit);
}

export interface CollectionHit {
  collection: CollectionIpc;
  indices: number[];
}

/**
 * Rank collections by fuzzy match against their name. Empty query returns every
 * collection in tree order; otherwise non-matching collections are dropped and
 * matches sort by descending score (name as the tie-break).
 */
export function rankCollections(query: string, collections: CollectionIpc[]): CollectionHit[] {
  const q = query.trim();
  if (!q) return collections.map((c) => ({ collection: c, indices: [] }));
  const ranked: { hit: CollectionHit; score: number }[] = [];
  for (const c of collections) {
    const m = fuzzyMatch(q, c.name);
    if (m.matched) ranked.push({ hit: { collection: c, indices: m.indices }, score: m.score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.hit.collection.name.localeCompare(b.hit.collection.name))
    .map((r) => r.hit);
}
