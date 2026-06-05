import * as ipc from "@/ipc/client";
import type { GrpcTargetIpc, ServiceCatalogIpc, SavedRequestIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { setView } from "@/features/workflow/reducers";
import { createStepFromMethod } from "@/features/workflow/actions";
import { newStep } from "@/features/workflow/model";
import { savedRequestToDraft } from "./mapping";
import { catalogStore } from "./store";
import type { CatalogService } from "./model";

function targetOf(svc: CatalogService): GrpcTargetIpc {
  return { address: svc.address, tls: svc.tls, skip_verify: svc.skipVerify };
}

/** Reflect a service's contract (cache-first on the backend) and store it. */
export async function describeService(svc: CatalogService): Promise<ServiceCatalogIpc> {
  const catalog = await ipc.grpcDescribe(targetOf(svc));
  catalogStore.setContract(svc.id, catalog, Date.now());
  return catalog;
}

/** Force a fresh reflection read, bypassing the backend cache. */
export async function refreshContract(svc: CatalogService): Promise<ServiceCatalogIpc> {
  const catalog = await ipc.grpcRefreshContract(targetOf(svc));
  catalogStore.setContract(svc.id, catalog, Date.now());
  return catalog;
}

/**
 * Create a call from a catalog method and open it as the global pending-draft in Focus.
 * `newWorkflow` (⌥↵) starts a fresh workflow first. The opened method carries the
 * service's `auth` inline (request-first model — the draft is not history).
 * NOTE: skipVerify is not yet propagated into the invoke path.
 */
export async function openCallFromMethod(
  svc: CatalogService,
  service: string,
  method: string,
  opts: { newWorkflow?: boolean } = {},
): Promise<void> {
  if (opts.newWorkflow) workflowStore.createWorkflow(method);
  const step = await createStepFromMethod(
    { address: svc.address, tls: svc.tls },
    service,
    method,
    { auth: svc.auth, defaultMetadata: svc.defaultMetadata },
  );
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(step);
}

/** Open a saved request in Focus as the global pending-draft. */
export function openSavedRequest(saved: SavedRequestIpc): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(savedRequestToDraft(saved));
}

/** Start a fresh, empty pending-draft in Focus (header `+` / menu "Add request"). */
export function newRequestDraft(): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(newStep({ address: "", tls: false, service: "", method: "" }));
}
