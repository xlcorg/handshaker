import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { VAR_PATTERN_SOURCE } from "@/features/vars/varGrammar.gen";
import { uuidV7Millis } from "@/lib/ids";
import type { PickTarget } from "./CollectionPicker";
import { insertItemInTree } from "./treeEdit";

/** A collection the user added in the Save dialog but hasn't persisted yet. */
export interface PendingCollection {
  tempId: string;
  name: string;
}

/** A folder the user added in the Save dialog but hasn't persisted yet.
 *  `collectionId`/`parentId` may reference a pending node's tempId. */
export interface PendingFolder {
  tempId: string;
  collectionId: string;
  parentId: string | null;
  name: string;
}

function emptyCollection(id: string, name: string): CollectionIpc {
  return {
    id,
    name,
    items: [],
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: 0,
    expanded: false,
  };
}

/**
 * The tree the Save picker shows. Pending nodes are spliced in array order, so a
 * parent folder still precedes its children when submit walks `pendingFolders`.
 * Every `items` list is then newest-created first. Collection order is unchanged
 * and the input is not mutated.
 */
export function pickerTree(
  collections: CollectionIpc[],
  pendingCollections: PendingCollection[],
  pendingFolders: PendingFolder[],
): CollectionIpc[] {
  let tree: CollectionIpc[] = [
    ...collections,
    ...pendingCollections.map((p) => emptyCollection(p.tempId, p.name)),
  ];
  for (const pf of pendingFolders) {
    tree = insertItemInTree(tree, pf.collectionId, pf.parentId, {
      type: "folder",
      id: pf.tempId,
      name: pf.name,
      items: [],
      expanded: false,
    });
  }
  return tree.map((c) => ({ ...c, items: newestFirst(c.items) }));
}

/**
 * Where the Save dialog's selection starts: the root of the collection whose name
 * is the leading tokens of the host in `draftAddress`, else the first collection's
 * root, else null. `draftAddress` stays unresolved. A `{{var}}` span is never a token.
 */
export function defaultPickTarget(
  collections: CollectionIpc[],
  draftAddress: string,
): PickTarget | null {
  const host = hostTokens(draftAddress);
  const best = collections
    .map((collection) => matchOf(collection, host))
    .filter((match): match is CollectionMatch => match !== null)
    .sort(byRank)[0];
  const pick = best?.collection ?? collections[0];
  return pick ? { collectionId: pick.id, parentId: null } : null;
}

declare const tokensBrand: unique symbol;

/** Built only by `tokensOf`, so a host and a collection name share one normalization. */
type Tokens = readonly string[] & { readonly [tokensBrand]: true };

const ENV_TOKENS: ReadonlySet<string> = new Set([
  "stg",
  "staging",
  "dev",
  "development",
  "test",
  "testing",
  "prod",
  "production",
  "local",
  "localhost",
]);

const SEPARATOR = /[^\p{L}\p{N}]+/u;

const VAR_SPAN = new RegExp(VAR_PATTERN_SOURCE, "g");

function tokensOf(text: string): Tokens {
  return text
    .toLowerCase()
    .split(SEPARATOR)
    .filter((part) => part !== "" && !ENV_TOKENS.has(part)) as unknown as Tokens;
}

function hostTokens(address: string): Tokens {
  // A var name may contain "/", ":", or spaces. Replace the span before the host cut.
  let rest = address.replace(VAR_SPAN, " ");
  const schemeAt = rest.indexOf("://");
  if (schemeAt !== -1) {
    rest = rest.slice(schemeAt + 3);
    if (rest.startsWith("/")) rest = rest.slice(1);
  }
  const pathAt = rest.search(/[/?#]/);
  if (pathAt !== -1) rest = rest.slice(0, pathAt);
  const at = rest.lastIndexOf("@");
  if (at !== -1) rest = rest.slice(at + 1);
  const colon = rest.indexOf(":");
  if (colon !== -1) rest = rest.slice(0, colon);
  return tokensOf(rest);
}

interface CollectionMatch {
  collection: CollectionIpc;
  matched: number;
}

function matchOf(
  collection: CollectionIpc,
  host: Tokens,
): CollectionMatch | null {
  const name = tokensOf(collection.name);
  const ok =
    name.length > 0 &&
    name.length <= host.length &&
    name.every((token, index) => token === host[index]);
  return ok ? { collection, matched: name.length } : null;
}

function byRank(a: CollectionMatch, b: CollectionMatch): number {
  return (
    b.matched - a.matched ||
    b.collection.created_at - a.collection.created_at ||
    (a.collection.id < b.collection.id ? 1 : -1)
  );
}

function newestFirst(items: ItemIpc[]): ItemIpc[] {
  const ranked = items.map((item, index) => ({
    item:
      item.type === "folder"
        ? { ...item, items: newestFirst(item.items) }
        : item,
    index,
    ms: uuidV7Millis(item.id),
  }));
  ranked.sort(compareNewest);
  return ranked.map((row) => row.item);
}

function compareNewest(
  a: { index: number; ms: number | null },
  b: { index: number; ms: number | null },
): number {
  if (a.ms !== null && b.ms === null) return -1;
  if (a.ms === null && b.ms !== null) return 1;
  if (a.ms !== null && b.ms !== null) {
    if (a.ms !== b.ms) return b.ms - a.ms;
    // The random tail of a v7 is not creation order. The later sibling is the newer one.
    return b.index - a.index;
  }
  return a.index - b.index;
}
