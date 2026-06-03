import * as ipc from "@/ipc/client";
import type { GrpcTargetIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { addStep, setView } from "@/features/workflow/reducers";
import { createStepFromMethod } from "@/features/workflow/actions";
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
 * Create a call from a catalog method and open it in Focus.
 * `newWorkflow` (⌥↵) starts a fresh workflow first.
 * NOTE: skipVerify/auth are NOT wired into the invoke path yet (Plan #5) —
 * `createStepFromMethod` only takes {address, tls}.
 */
export async function openCallFromMethod(
  svc: CatalogService,
  service: string,
  method: string,
  opts: { newWorkflow?: boolean } = {},
): Promise<void> {
  if (opts.newWorkflow) workflowStore.createWorkflow(method);
  const step = await createStepFromMethod({ address: svc.address, tls: svc.tls }, service, method);
  workflowStore.update((w) => setView(addStep(w, step), "focus"));
}
