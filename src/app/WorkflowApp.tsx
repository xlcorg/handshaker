import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Toaster } from "@/components/ui/toaster";
import { FocusView } from "@/features/workflow/FocusView";
import { LedgerView } from "@/features/workflow/LedgerView";
import { ListView } from "@/features/workflow/ListView";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
import { useActiveWorkflow, useDraft, workflowStore } from "@/features/workflow/store";
import type { ViewMode } from "@/features/workflow/model";
import type { SavedRequestIpc } from "@/ipc/bindings";
import { SidebarShell } from "@/features/catalog/SidebarShell";
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { CollectionOverview } from "@/features/catalog/overview/CollectionOverview";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { openSavedRequest, newRequestDraft } from "@/features/catalog/actions";
import { SaveRequestDialog } from "@/features/catalog/SaveRequestDialog";
import { DiscardDraftDialog } from "@/features/catalog/DiscardDraftDialog";
import { needsDiscardConfirm } from "@/features/catalog/discardGuard";
import { saveNewRequest } from "@/features/catalog/save";
import { useAutosaveDraft } from "@/features/catalog/useAutosaveDraft";
import { findSavedLocations } from "@/features/catalog/grouping";
import { newId } from "@/lib/ids";

function renderView(view: ViewMode, onRequestSave: () => void) {
  switch (view) {
    case "ledger":
      return <LedgerView />;
    case "list":
      return <ListView />;
    default:
      return <FocusView onRequestSave={onRequestSave} />;
  }
}

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  const draft = useDraft();
  // The ONE shared catalog instance — feeds ⌘K + overview + Save dialog AND the sidebar.
  const cat = useCatalog();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelCollectionId, setPanelCollectionId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  // The open-request/new-draft action deferred while the discard confirm is up.
  const pendingOpenRef = useRef<(() => void) | null>(null);

  // Debounced autosave of an origin-bound draft on every content edit (spec §6).
  useAutosaveDraft(cat.updateItemContent);

  // Run an open action, but confirm first if it would drop a dirty *unbound* draft (spec §6).
  function guardedRun(action: () => void) {
    const st = workflowStore.getState();
    if (needsDiscardConfirm(st.draftOrigin, st.draftDirty)) {
      pendingOpenRef.current = action;
      setDiscardOpen(true);
    } else {
      action();
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        // Save only opens the dialog for an UNBOUND draft; bound drafts already autosave.
        const st = workflowStore.getState();
        if (st.draft && st.draftOrigin === null) {
          // A direct save is not a continuation of a deferred open — drop any pending action.
          pendingOpenRef.current = null;
          setSaveOpen(true);
        }
      } else if (mod && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        guardedRun(() => {
          setPanelCollectionId(null);
          newRequestDraft();
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // guardedRun reads fresh store state and only calls stable setters; bind once.
  }, []);

  // Freshen the snapshot whenever the palette opens, so cross-instance edits are searchable.
  useEffect(() => {
    if (paletteOpen) void cat.reload();
  }, [paletteOpen, cat.reload]);

  // Creating a call switches to Focus; close any open collection overview so it is visible.
  useEffect(() => {
    if (wf.activeStepId) setPanelCollectionId(null);
  }, [wf.activeStepId]);

  const panelCollection = panelCollectionId
    ? cat.tree.find((c) => c.id === panelCollectionId) ?? null
    : null;

  // Save the current unbound draft as a new request, bind its origin, then run any pending open.
  async function handleSave(dest: { collectionId: string; parentId: string | null; name: string }) {
    const current = workflowStore.getState().draft;
    if (!current) return;
    const id = await saveNewRequest(cat.addItem, current, dest);
    workflowStore.setDraftOrigin({ collectionId: dest.collectionId, requestId: id });
    await cat.reload();
    const pending = pendingOpenRef.current;
    pendingOpenRef.current = null;
    pending?.();
  }

  const draftMethod = draft?.method ?? "";

  const createFolder = async (collectionId: string, parentId: string | null, name: string) => {
    const id = newId();
    await cat.addItem(collectionId, parentId, { type: "folder", id, name, items: [] });
    return id;
  };

  // Opening a request / starting a new draft must reveal Focus — close any open overview first.
  const openRequest = (collectionId: string, req: SavedRequestIpc) =>
    guardedRun(() => {
      setPanelCollectionId(null);
      openSavedRequest(collectionId, req);
    });

  const addRequest = () =>
    guardedRun(() => {
      setPanelCollectionId(null);
      newRequestDraft();
    });

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
        <SidebarShell
          onOpenCollection={(id) => setPanelCollectionId(id)}
          onOpenRequest={openRequest}
          onAddRequest={addRequest}
        />
        <div className="min-h-0 flex-1">
          {panelCollection ? (
            <CollectionOverview
              collection={panelCollection}
              onChanged={() => void cat.reload()}
              onSelectRequest={openRequest}
              onClose={() => setPanelCollectionId(null)}
            />
          ) : (
            renderView(wf.view, () => {
              // A direct save is not a continuation of a deferred open — drop any pending action.
              pendingOpenRef.current = null;
              setSaveOpen(true);
            })
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        collections={cat.tree}
        onOpen={openRequest}
      />

      <SaveRequestDialog
        open={saveOpen}
        onOpenChange={(o) => {
          setSaveOpen(o);
          if (!o) pendingOpenRef.current = null;
        }}
        collections={cat.tree}
        defaultName={draftMethod}
        draftService={draft?.service ?? ""}
        draftMethod={draftMethod}
        onSave={handleSave}
        onCreateCollection={cat.createCollection}
        onCreateFolder={createFolder}
        existingLocations={
          draft
            ? findSavedLocations(cat.tree, {
                service: draft.service,
                method: draft.method,
                address: draft.address,
              })
            : []
        }
      />

      <DiscardDraftDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={() => {
          const a = pendingOpenRef.current;
          pendingOpenRef.current = null;
          a?.();
        }}
        onSaveFirst={() => {
          setDiscardOpen(false);
          setSaveOpen(true);
        }}
      />

      <Toaster />
    </div>
  );
}
