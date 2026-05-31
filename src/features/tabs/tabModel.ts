import { emptyDraft, type DraftRequest } from "@/features/collections/draft";
import { newId } from "@/lib/ids";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { InvokeOutcomeIpc, ServiceCatalogIpc } from "@/ipc/bindings";

export type Scenario =
  | "connected" | "request" | "sending" | "success"
  | "error" | "idle" | "connecting" | "newServer" | "collection";

export type RequestTabState = {
  id: string;
  draft: DraftRequest;
  selected: SelectedMethod | null;
  catalog: ServiceCatalogIpc | null;
  scenario: Scenario;
  requestTab: "body" | "metadata" | "auth";
  responseTab: "body" | "trailers" | "headers";
  sending: boolean;
  outcome: InvokeOutcomeIpc | null;
  invokeError: string | null;
  reflectNote: string | null;
  openCollectionId: string | null;
};

export function mkTab(init: Partial<RequestTabState> = {}): RequestTabState {
  return {
    id: newId(),
    draft: init.draft ?? emptyDraft(""),
    selected: init.selected ?? null,
    catalog: init.catalog ?? null,
    scenario: init.scenario ?? "newServer",
    requestTab: "body",
    responseTab: "body",
    sending: false,
    outcome: null,
    invokeError: null,
    reflectNote: null,
    openCollectionId: null,
    ...init,
  };
}

export function tabLabel(t: RequestTabState): string {
  if (t.selected) return t.selected.method;
  const h = t.draft.address.trim();
  return h ? h : "New request";
}
