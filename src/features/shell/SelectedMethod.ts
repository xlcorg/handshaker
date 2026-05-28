import type { MethodEntryIpc } from "@/ipc/bindings";

export type MethodKind = "unary" | "server" | "client" | "bidi";

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

export function shortService(fullName: string): string {
  const i = fullName.lastIndexOf(".");
  return i < 0 ? fullName : fullName.slice(i + 1);
}
