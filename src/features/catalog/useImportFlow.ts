import { useCallback, useState } from "react";
import type { ImportSummaryIpc } from "@/ipc/bindings";
import { useCatalog } from "./CatalogProvider";
import { applyImport, pickAndInspectImport } from "./transfer";

export interface ImportFlow {
  pending: { path: string; summary: ImportSummaryIpc } | null;
  /** Open the file picker + inspect; opens the summary dialog on success. */
  start: () => Promise<void>;
  /** Apply the inspected import, then reload the catalog. */
  confirm: () => Promise<void>;
  cancel: () => void;
}

/** Shared import flow for the panel ⋯ menu and the Settings pane. */
export function useImportFlow(): ImportFlow {
  const cat = useCatalog();
  const [pending, setPending] = useState<{ path: string; summary: ImportSummaryIpc } | null>(null);

  const start = useCallback(async () => {
    const picked = await pickAndInspectImport();
    if (picked) setPending(picked);
  }, []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    const res = await applyImport(pending.path);
    setPending(null);
    if (res) await cat.reload();
  }, [pending, cat]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, start, confirm, cancel };
}
