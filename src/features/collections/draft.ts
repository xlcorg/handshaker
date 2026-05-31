import { AUTH_DEFAULTS, type AuthState } from "@/features/invoke/AuthInline";
import type { MetadataRow } from "@/features/invoke/MetadataView";
import type { MethodKind } from "@/features/shell/SelectedMethod";
import type { ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

export interface DraftOrigin {
  collectionId: string;
  itemId: string;
}

export interface DraftRequest {
  address: string; // template, may contain {{var}}
  tls: boolean;
  skipVerify: boolean; // always false in #2
  service: string | null;
  method: string | null;
  kind: MethodKind | null;
  body: string; // JSON template
  metadata: MetadataRow[];
  auth: AuthState; // inline (none/bearer) — send-time only
  origin: DraftOrigin | null;
  dirty: boolean;
}

export function emptyDraft(address = "localhost:5002"): DraftRequest {
  return {
    address,
    tls: false,
    skipVerify: false,
    service: null,
    method: null,
    kind: null,
    body: "{}",
    metadata: [],
    auth: AUTH_DEFAULTS,
    origin: null,
    dirty: false,
  };
}

/** Build a `SavedRequestIpc` from the draft. `auth_by_env` is empty (decision #4). */
export function draftToSavedRequest(
  draft: DraftRequest,
  name: string,
  id: string,
): SavedRequestIpc {
  const metadata: Record<string, string> = {};
  for (const r of draft.metadata) if (r.k.trim()) metadata[r.k.trim()] = r.v;
  return {
    id,
    name,
    address_template: draft.address,
    service: draft.service ?? "",
    method: draft.method ?? "",
    body_template: draft.body,
    metadata,
    auth_by_env: { configs: {} },
    tls_override: draft.tls,
  };
}

/** Wrap a SavedRequest as a request `ItemIpc`. */
export function savedRequestItem(saved: SavedRequestIpc): ItemIpc {
  return { type: "request", ...saved };
}

/** Replace a request node (by id) inside an item tree, returning a new tree. */
export function replaceRequestInItems(
  items: ItemIpc[],
  itemId: string,
  next: SavedRequestIpc,
): ItemIpc[] {
  return items.map((it) => {
    if (it.type === "request" && it.id === itemId) return { type: "request", ...next };
    if (it.type === "folder") {
      return { ...it, items: replaceRequestInItems(it.items, itemId, next) };
    }
    return it;
  });
}

/** Populate a draft from a saved request (inline auth resets to none in #2). */
export function loadIntoDraft(saved: SavedRequestIpc, origin: DraftOrigin): DraftRequest {
  return {
    address: saved.address_template,
    tls: saved.tls_override ?? false,
    skipVerify: false,
    service: saved.service || null,
    method: saved.method || null,
    kind: null, // resolved from catalog after describe
    body: saved.body_template,
    metadata: Object.entries(saved.metadata ?? {}).map(([k, v]) => ({ k, v: v ?? "" })),
    auth: AUTH_DEFAULTS,
    origin,
    dirty: false,
  };
}
