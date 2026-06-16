import { save, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { ipc } from "@/ipc/client";
import { bumpEnvRevision } from "@/features/envs/envRevision";
import type { ImportSummaryIpc, ImportResultIpc } from "@/ipc/bindings";

const FILTERS = [{ name: "Handshaker export", extensions: ["json"] }];

function errMsg(e: unknown): string {
  const t = e as { message?: string; type?: string };
  return t?.message ?? t?.type ?? "operation failed";
}

/** Export one collection (or everything when `collectionId` is null) to a chosen file. */
export async function exportBundle(collectionId: string | null, defaultName: string): Promise<void> {
  let path: string | null;
  try {
    path = await save({ defaultPath: defaultName, filters: FILTERS });
  } catch (e) {
    toast.error(errMsg(e));
    return;
  }
  if (!path) return; // cancelled
  try {
    await ipc.bundleExport(path, collectionId);
    toast.success("Exported");
  } catch (e) {
    toast.error(errMsg(e));
  }
}

/** Pick an export file and inspect it (no mutation). Returns null on cancel/error. */
export async function pickAndInspectImport(): Promise<{ path: string; summary: ImportSummaryIpc } | null> {
  let picked: string | string[] | null;
  try {
    picked = await open({ multiple: false, directory: false, filters: FILTERS });
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
  if (typeof picked !== "string") return null; // cancelled (null) or unexpected
  try {
    const summary = await ipc.bundleImportInspect(picked);
    return { path: picked, summary };
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}

/** Apply a previously-inspected import (merge). Bumps env revision; the caller reloads collections. */
export async function applyImport(path: string): Promise<ImportResultIpc | null> {
  try {
    const result = await ipc.bundleImportApply(path);
    bumpEnvRevision();
    const added = result.collections_added + result.environments_added;
    const updated = result.collections_updated + result.environments_updated;
    toast.success(`Imported — ${added} added, ${updated} updated`);
    return result;
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}
