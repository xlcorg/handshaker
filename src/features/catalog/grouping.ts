import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

/**
 * Strip a trailing `:<digits>` port from an address; templates are preserved.
 * Scoped to gRPC target strings (`host:port`, bare `host`, or `{{var}}:port`) —
 * there is no URL path component, so stripping a trailing `:\d+` is unambiguous.
 */
function hostOf(address: string): string {
  const m = address.match(/^(.*):\d+$/);
  return (m ? m[1] : address).trim();
}

/** Last dot-segment of a full service name. */
function serviceShortName(service: string): string {
  const parts = service.split(".");
  return (parts[parts.length - 1] ?? "").trim();
}

/** Suggested `Host > Service` folder path for the Save dialog. */
export function suggestSavePath(address: string, service: string): string[] {
  return [hostOf(address), serviceShortName(service)].filter((s) => s.length > 0);
}

export interface SaveLocation {
  collectionId: string;
  collectionName: string;
  folderPath: string[]; // folder names from collection root to the request's parent
  requestId: string;
  requestName: string;
}

export interface SavedRequestMatch {
  service: string;
  method: string;
  address: string;
}

function collect(
  items: ItemIpc[],
  path: string[],
  match: SavedRequestMatch,
  collection: CollectionIpc,
  out: SaveLocation[],
): void {
  for (const it of items) {
    if (it.type === "folder") {
      collect(it.items, [...path, it.name], match, collection, out);
    } else if (
      it.service === match.service &&
      it.method === match.method &&
      it.address_template === match.address
    ) {
      out.push({
        collectionId: collection.id,
        collectionName: collection.name,
        folderPath: path,
        requestId: it.id,
        requestName: it.name,
      });
    }
  }
}

/** All saved requests across every collection whose call target equals `match`. */
export function findSavedLocations(
  collections: CollectionIpc[],
  match: SavedRequestMatch,
): SaveLocation[] {
  const out: SaveLocation[] = [];
  for (const c of collections) collect(c.items, [], match, c, out);
  return out;
}
