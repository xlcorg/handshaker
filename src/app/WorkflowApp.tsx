import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Toaster } from "@/components/ui/toaster";
import { FocusView } from "@/features/workflow/FocusView";
import { LedgerView } from "@/features/workflow/LedgerView";
import { ListView } from "@/features/workflow/ListView";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
import { useActiveWorkflow } from "@/features/workflow/store";
import type { ViewMode } from "@/features/workflow/model";
import { SidebarShell } from "@/features/catalog/SidebarShell";
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { CollectionOverview } from "@/features/catalog/overview/CollectionOverview";
import { useCatalogTree } from "@/features/catalog/useCatalogTree";
import { openSavedRequest } from "@/features/catalog/actions";

function renderView(view: ViewMode) {
  switch (view) {
    case "ledger":
      return <LedgerView />;
    case "list":
      return <ListView />;
    default:
      return <FocusView />;
  }
}

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  // One catalog snapshot for the ⌘K palette + the collection overview. The sidebar keeps its
  // own instance; both reload on their own mutations (overview via onChanged below, palette via
  // the open effect). Unifying them behind a context is a future refactor, not cleanup.
  const cat = useCatalogTree();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelCollectionId, setPanelCollectionId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Freshen the snapshot whenever the palette opens, so cross-instance edits are searchable.
  useEffect(() => {
    if (paletteOpen) void cat.reload();
  }, [paletteOpen, cat.reload]);

  // Creating a call (sidebar / overview / ⌘K) adds a step and switches the workflow to Focus.
  // Close any open collection overview so the new call is visible.
  useEffect(() => {
    if (wf.activeStepId) setPanelCollectionId(null);
  }, [wf.activeStepId]);

  const panelCollection = panelCollectionId
    ? cat.tree.find((c) => c.id === panelCollectionId) ?? null
    : null;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-9 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-semibold">⚡ Handshaker</span>
        <WorkflowSelector />
        <WorkflowEnvControl />
        <div className="flex-1" />
        <ViewSwitcher />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
        >
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <SidebarShell onOpenCollection={(id) => setPanelCollectionId(id)} />
        <div className="min-h-0 flex-1">
          {panelCollection ? (
            <CollectionOverview
              collection={panelCollection}
              onChanged={() => void cat.reload()}
              onSelectRequest={(collectionId, req) => openSavedRequest(collectionId, req)}
              onClose={() => setPanelCollectionId(null)}
            />
          ) : (
            renderView(wf.view)
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        collections={cat.tree}
        onOpen={(collectionId, req) => openSavedRequest(collectionId, req)}
      />
      <Toaster />
    </div>
  );
}
