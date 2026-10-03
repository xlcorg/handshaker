import type { MethodEntryIpc, MethodKindIpc, ServiceCatalogIpc } from "@/ipc/bindings";

/** **Method kind** — the generated IPC type is the single spelling
 *  (`"unary" | "server" | "client" | "bidi"`): what the UI derives from the catalog,
 *  passes to `stream_open` and gets back in `Opened.kind` / `MethodKindMismatch`. */
export type MethodKind = MethodKindIpc;

export interface SelectedMethod {
  service: string;
  method: string;
  kind: MethodKind;
}

export function deriveKind(m: Pick<MethodEntryIpc, "client_streaming" | "server_streaming">): MethodKind {
  if (m.client_streaming && m.server_streaming) return "bidi";
  if (m.server_streaming) return "server";
  if (m.client_streaming) return "client";
  return "unary";
}

/** Method kind of `service/method` per the reflected catalog, or `null` when the
 *  catalog is not there yet (pending / failed) or does not list the method. The UI
 *  never treats an unknown kind as unary — `null` means "no badge, unary controls"
 *  (`src/CONTEXT.md`, Method kind). */
export function kindOf(
  catalog: ServiceCatalogIpc | null,
  service: string,
  method: string,
): MethodKind | null {
  const entry = catalog?.services
    .find((s) => s.full_name === service)
    ?.methods.find((m) => m.name === method);
  return entry ? deriveKind(entry) : null;
}

/** Client-streaming and bidi: the kinds with an interactive outbound side (Open →
 *  Send message / Half-close). `null` / `undefined` (unknown kind) is not two-way. */
export function isTwoWay(kind: MethodKind | null | undefined): boolean {
  return kind === "client" || kind === "bidi";
}

/** Any kind that opens a Stream call instead of a unary Send. `null` (unknown) takes
 *  the unary path — never a guessed stream. */
export function isStreaming(kind: MethodKind | null | undefined): boolean {
  return kind === "server" || isTwoWay(kind);
}

export function shortService(fullName: string): string {
  const i = fullName.lastIndexOf(".");
  return i < 0 ? fullName : fullName.slice(i + 1);
}
