import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

/** Last dot-segment of a full service name. */
export function serviceShortName(service: string): string {
  const parts = service.split(".");
  return (parts[parts.length - 1] ?? "").trim();
}

export interface SaveTarget {
  /** Folder name derived from the service (short name minus a trailing "Service"). */
  folderName: string;
  /** Request name = the method's short name. */
  requestName: string;
}

/**
 * Recommend where a gRPC call should be saved, mirroring the server's structure:
 * `notes.v1.NotesApiService` + `Create` → folder `NotesApi`, request `Create`.
 * A trailing "Service" is stripped, but a bare "Service" is left intact (never empty).
 */
export function suggestSaveTarget(service: string, method: string): SaveTarget {
  const short = serviceShortName(service);
  const stripped = short.replace(/Service$/, "");
  return {
    folderName: stripped.length > 0 ? stripped : short,
    requestName: method.trim(),
  };
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
