import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { FocusView } from "@/features/workflow/FocusView";
import { useActiveWorkflow } from "@/features/workflow/store";
import { Sidebar } from "@/features/catalog/Sidebar";
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { ServicePanel } from "@/features/catalog/ServicePanel";
import type { CatalogService } from "@/features/catalog/model";

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelServiceId, setPanelServiceId] = useState<string | null>(null);

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

  // Creating a call (from the sidebar, the service panel, or ⌘K) adds a step and
  // switches the workflow to Focus. Close any open service panel so the new call
  // is actually visible instead of staying hidden behind the panel.
  useEffect(() => {
    if (wf.activeStepId) setPanelServiceId(null);
  }, [wf.activeStepId]);

  const openService = (svc: CatalogService) => setPanelServiceId(svc.id);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-9 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-semibold">⚡ Handshaker</span>
        <span className="text-muted-foreground">{wf.name}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
        >
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenService={openService} onOpenPalette={() => setPaletteOpen(true)} />
        <div className="min-h-0 flex-1">
          {panelServiceId ? (
            <ServicePanel serviceId={panelServiceId} onClose={() => setPanelServiceId(null)} />
          ) : (
            <FocusView />
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
