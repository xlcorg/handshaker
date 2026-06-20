import { useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { FocusView } from "@/features/workflow/FocusView";
import { LedgerView } from "@/features/workflow/LedgerView";
import { ListView } from "@/features/workflow/ListView";
import { useActiveWorkflow, useDraft, useDraftOrigin, workflowStore } from "@/features/workflow/store";
import type { ViewMode } from "@/features/workflow/model";
import type { SavedRequestIpc } from "@/ipc/bindings";
import { Titlebar } from "@/features/shell/Titlebar";
import { AppVersionBadge } from "@/features/shell/AppVersionBadge";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { envActiveGet } from "@/ipc/client";
import { SidebarShell } from "@/features/catalog/SidebarShell";
import { CollectionOverview } from "@/features/catalog/overview/CollectionOverview";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { openSavedRequest, newRequestDraft } from "@/features/catalog/actions";
import { findSavedRequest } from "@/features/catalog/treeNav";
import { loadUiState, patchUiState } from "@/features/catalog/uiState";
import { SaveRequestDialog } from "@/features/catalog/SaveRequestDialog";
import { DiscardDraftDialog } from "@/features/catalog/DiscardDraftDialog";
import { needsDiscardConfirm } from "@/features/catalog/discardGuard";
import { saveNewRequest } from "@/features/catalog/save";
import { useAutosaveDraft } from "@/features/catalog/useAutosaveDraft";
import { findSavedLocations } from "@/features/catalog/grouping";
import { planQuickAdd } from "@/features/catalog/quickAdd";
import { CommandPalette } from "@/features/catalog/CommandPalette";
import { isPaletteHotkey } from "@/features/catalog/paletteHotkey";
import { EMPTY_BODY_TEMPLATE } from "@/features/workflow/actions";
import { toast } from "sonner";
import { newId } from "@/lib/ids";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { SidebarProvider } from "@/components/ui/sidebar";
import { usePrefs, readPrefs } from "@/lib/use-prefs";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { useUpdateCheck } from "@/features/updater/useUpdateCheck";
import { UpdateToast } from "@/features/updater/UpdateToast";
import { UpdaterProvider } from "@/features/updater/updaterContext";
import { useUiZoom } from "@/features/shell/zoom";
import { useWordWrapHotkey } from "@/features/shell/wordWrap";
import { dismissSplash } from "@/features/shell/splash";
import { useStartupRecovery } from "@/features/shell/startupRecovery";

function renderView(
  view: ViewMode,
  onRequestSave: () => void,
  onQuickAddMethod: (service: string, method: string) => void,
) {
  switch (view) {
    case "ledger":
      return <LedgerView />;
    case "list":
      return <ListView />;
    default:
      return <FocusView onRequestSave={onRequestSave} onQuickAddMethod={onQuickAddMethod} />;
  }
}

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  const draft = useDraft();
  const activeItemId = useDraftOrigin()?.requestId ?? null;
  // The ONE shared catalog instance — feeds overview + Save dialog AND the sidebar.
  const cat = useCatalog();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelCollectionId, setPanelCollectionId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [prefs, setPref] = usePrefs();
  const update = useUpdateCheck();
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  // The open-request/new-draft action deferred while the discard confirm is up.
  const pendingOpenRef = useRef<(() => void) | null>(null);
  // Restore the persisted active request exactly once, after the tree first loads.
  const restoredRef = useRef(false);

  // Debounced autosave of an origin-bound draft on every content edit (spec §6).
  useAutosaveDraft(cat.updateItemContent);

  // Зум UI: персистентный prefs.zoom → webview.setZoom + хоткеи Ctrl+=/-/0.
  useUiZoom();
  // Глобальный Alt+Z → переключает prefs.wordWrap (перенос строк в редакторах тела).
  useWordWrapHotkey();
  // Уведомить один раз о файлах, помещённых в карантин при старте (битый JSON → .corrupt).
  useStartupRecovery();

  // Снять стартовый оверлей #splash, как только оболочка смонтирована (маунт корня
  // = первый осмысленный кадр). Дисмисс через CSS-fade; идемпотентно (см. splash.ts).
  useEffect(() => {
    dismissSplash();
  }, []);

  // Подхватить сохранённый бэкендом активный env при старте (спека §4).
  useEffect(() => {
    void envActiveGet().then((name) => workflowStore.hydrateEnv(name));
  }, []);

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
      if (mod && (e.key === "s" || e.key === "S")) {
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
      } else if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setPref("sidebar", !readPrefs().sidebar);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // guardedRun reads fresh store state and only calls stable setters; bind once.
  }, []);

  // Командная палитра: Ctrl/Cmd+K|P. CAPTURE-фаза + stopPropagation — иначе Monaco
  // перехватывает Ctrl+K как префикс чорда и палитра не откроется из редактора тела.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // На открытии палитры освежаем дерево каталога (дёшево; гарантирует актуальные коллекции).
  useEffect(() => {
    if (paletteOpen) void cat.reload();
  }, [paletteOpen, cat.reload]);

  // Drive the imperative panel from prefs.sidebar (toggled by Ctrl/Cmd+B).
  useEffect(() => {
    const p = sidebarPanelRef.current;
    if (!p) return;
    if (prefs.sidebar) {
      if (p.isCollapsed()) p.expand();
    } else if (!p.isCollapsed()) {
      p.collapse();
    }
  }, [prefs.sidebar]);

  // Creating a call switches to Focus; close any open collection overview so it is visible.
  useEffect(() => {
    if (wf.activeStepId) setPanelCollectionId(null);
  }, [wf.activeStepId]);

  // Restore the last-open request once the tree is available. Uses the DIRECT
  // open (not the discard guard): at startup there is no draft to protect.
  useEffect(() => {
    if (restoredRef.current || cat.tree.length === 0) return;
    restoredRef.current = true;
    void loadUiState().then((s) => {
      if (!s.active_request) return;
      const req = findSavedRequest(cat.tree, s.active_request.collection_id, s.active_request.item_id);
      if (req) openSavedRequest(s.active_request.collection_id, req);
    });
  }, [cat.tree]);

  const panelCollection = panelCollectionId
    ? cat.tree.find((c) => c.id === panelCollectionId) ?? null
    : null;

  // Save the current unbound draft as a new request, bind its origin, then run any pending open.
  async function handleSave(dest: { collectionId: string; parentId: string | null; name: string }) {
    const current = workflowStore.getState().draft;
    if (!current) return;
    const id = await saveNewRequest(cat.addItem, current, dest);
    const collectionName = cat.tree.find((c) => c.id === dest.collectionId)?.name;
    workflowStore.setDraftOrigin({
      collectionId: dest.collectionId, requestId: id, collectionName, requestName: dest.name,
    });
    await cat.reload();
    const pending = pendingOpenRef.current;
    pendingOpenRef.current = null;
    pending?.();
  }

  const draftMethod = draft?.method ?? "";

  const createFolder = async (collectionId: string, parentId: string | null, name: string) => {
    const id = newId();
    await cat.addItem(collectionId, parentId, { type: "folder", id, name, items: [], expanded: false });
    return id;
  };

  // Opening a request / starting a new draft must reveal Focus — close any open overview first.
  const openRequest = (collectionId: string, req: SavedRequestIpc) =>
    guardedRun(() => {
      setPanelCollectionId(null);
      openSavedRequest(collectionId, req);
      // Record the now-open request so it is restored next launch (inside the guard
      // callback → only persists on an actual open, not a cancelled discard prompt).
      void patchUiState({ active_request: { collection_id: collectionId, item_id: req.id } });
    });

  // Quick «+» on a MethodPicker row: save by recommendation and open the result.
  async function quickAddMethod(service: string, method: string) {
    const current = workflowStore.getState().draft;
    const address = current?.address ?? "";
    // Save into the collection of the request the user is editing (origin); a brand-new
    // unbound draft has no origin → planQuickAdd falls back to the first collection.
    const originCollectionId = workflowStore.getState().draftOrigin?.collectionId ?? null;
    const plan = planQuickAdd(cat.tree, service, method, address, originCollectionId);
    if (plan.kind === "exists") {
      const req = findSavedRequest(cat.tree, plan.location.collectionId, plan.location.requestId);
      if (req) {
        toast.info(`Уже в коллекции «${plan.location.collectionName}»`);
        openRequest(plan.location.collectionId, req);
      }
      return;
    }
    const collectionId = plan.collectionId ?? (await cat.createCollection(plan.collectionName));
    const folderId = plan.folderId ?? (await createFolder(collectionId, null, plan.folderName));
    const saved: SavedRequestIpc = {
      id: newId(),
      name: plan.requestName,
      address_template: address,
      service,
      method,
      body_template: EMPTY_BODY_TEMPLATE,
      metadata: [],
      auth: { kind: "none" },
      tls_override: current?.tls ?? false,
      last_used_at: null,
      use_count: 0,
    };
    await cat.addItem(collectionId, folderId, { type: "request", ...saved });
    toast.success(`Сохранено в ${plan.collectionName} / ${plan.folderName}`);
    openRequest(collectionId, saved);
  }

  const addRequest = () =>
    guardedRun(() => {
      setPanelCollectionId(null);
      newRequestDraft();
    });

  return (
    <UpdaterProvider value={update}>
      <div className="flex h-screen flex-col bg-background text-foreground">
      <Titlebar
        onOpenSettings={() => setSettingsOpen(true)}
        onCheckForUpdates={update.recheck}
        updatePhase={update.phase}
        updateAvailable={update.hasUpdate}
      />

      <SidebarProvider className="min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={{ sidebar: prefs.sidebarPanel, main: 100 - prefs.sidebarPanel }}
          onLayoutChanged={(layout) => {
            const pct = layout["sidebar"];
            if (prefs.sidebar && typeof pct === "number" && pct > 0) setPref("sidebarPanel", pct);
          }}
        >
          <ResizablePanel
            id="sidebar"
            panelRef={sidebarPanelRef}
            collapsible
            collapsedSize="0%"
            minSize="12%"
            maxSize="40%"
            defaultSize={`${prefs.sidebarPanel}%`}
          >
            <SidebarShell
              onOpenCollection={(id) => setPanelCollectionId(id)}
              onOpenRequest={openRequest}
              onAddRequest={addRequest}
              activeItemId={activeItemId}
              activeCollectionId={panelCollectionId}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="main" minSize="40%">
            <div className="h-full min-h-0">
              {panelCollection ? (
                <CollectionOverview
                  collection={panelCollection}
                  onChanged={() => void cat.reload()}
                  onSelectRequest={openRequest}
                  onClose={() => setPanelCollectionId(null)}
                />
              ) : (
                renderView(
                  wf.view,
                  () => {
                    // A direct save is not a continuation of a deferred open — drop any pending action.
                    pendingOpenRef.current = null;
                    setSaveOpen(true);
                  },
                  (service: string, method: string) => void quickAddMethod(service, method).catch(() => {}),
                )
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarProvider>

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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        collections={cat.tree}
        onOpenRequest={(cid, req) => {
          setPaletteOpen(false);
          openRequest(cid, req);
        }}
        onOpenCollection={(cid) => {
          setPaletteOpen(false);
          setPanelCollectionId(cid);
        }}
      />

      <UpdateToast
        phase={update.phase}
        version={update.version}
        progress={update.progress}
        manual={update.manual}
        onUpdate={update.install}
        onDismiss={update.dismiss}
      />
      <AppVersionBadge />
      <Toaster />
    </div>
    </UpdaterProvider>
  );
}
