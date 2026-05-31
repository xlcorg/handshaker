import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { EnvPill } from "@/features/envs/EnvPill";
import { Titlebar } from "@/features/shell/Titlebar";
import { ConnectionBar } from "@/features/shell/ConnectionBar";
import { NewRequestHero, DisconnectedHero } from "@/features/shell/Heroes";
import { MethodPicker } from "@/features/shell/MethodPicker";
import { CollectionsSidebar } from "@/features/collections/tree/CollectionsSidebar";
import { RequestPanel, type RequestPanelHandle } from "@/features/invoke/RequestPanel";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { ipc } from "@/ipc/client";
import type { EnvironmentIpc, GrpcTargetIpc, SavedRequestIpc } from "@/ipc/bindings";
import { deriveKind, type SelectedMethod } from "@/features/shell/SelectedMethod";
import { useCollections } from "@/features/collections/useCollections";
import { SaveRequestDialog } from "@/features/collections/SaveRequestDialog";
import {
  draftToSavedRequest,
  loadIntoDraft,
  replaceRequestInItems,
  savedRequestItem,
  type DraftRequest,
} from "@/features/collections/draft";
import { useTabs } from "@/features/tabs/useTabs";
import { RequestTabs } from "@/features/tabs/RequestTabs";
import { CloseConfirm } from "@/features/tabs/CloseConfirm";
import { newId } from "@/lib/ids";
import { usePrefs } from "@/lib/use-prefs";
import { cn } from "@/lib/cn";

export default function App() {
  const [prefs] = usePrefs();
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [envs, setEnvs] = useState<EnvironmentIpc[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const T = useTabs();
  const active = T.active;
  const { draft, selected, catalog, scenario, sending, outcome, invokeError, reflectNote } = active;
  const isDraft = scenario === "newServer";
  const isConnecting = scenario === "connecting";
  const isConnected = scenario !== "newServer" && scenario !== "idle" && scenario !== "connecting";

  const collections = useCollections();
  const envSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const requestPanelRef = useRef<RequestPanelHandle>(null);
  const pendingCloseRef = useRef<string | null>(null);
  const sendingTabIdRef = useRef<string | null>(null);

  // --- Per-tab setters (write through patchActive on the active tab) -------
  const setDraft = (u: DraftRequest | ((d: DraftRequest) => DraftRequest)) =>
    T.patchActive((t) => ({ draft: typeof u === "function" ? u(t.draft) : u }));
  const setSelected = (s: SelectedMethod | null) => T.patchActive({ selected: s });

  const target: GrpcTargetIpc = { address: draft.address, tls: draft.tls, skip_verify: false };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  useEffect(() => {
    const fs = prefs.density === "compact" ? "12.5px" : prefs.density === "cozy" ? "13.5px" : "13px";
    const root = document.getElementById("root");
    if (root) root.style.fontSize = fs;
    document.documentElement.style.fontSize = "";
    const ui =
      prefs.fontUi === "geist"
        ? `"Geist","Inter",ui-sans-serif,system-ui,sans-serif`
        : prefs.fontUi === "system"
          ? `system-ui,-apple-system,"Segoe UI",sans-serif`
          : `"Inter",ui-sans-serif,system-ui,sans-serif`;
    document.documentElement.style.setProperty("--font-sans-override", ui);
    const mn =
      prefs.fontMono === "geist-mono"
        ? `"Geist Mono","JetBrains Mono",ui-monospace,monospace`
        : prefs.fontMono === "ibm"
          ? `"IBM Plex Mono","JetBrains Mono",ui-monospace,monospace`
          : `"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace`;
    document.documentElement.style.setProperty("--font-mono-override", mn);
  }, [prefs.density, prefs.fontUi, prefs.fontMono]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el || !prefs.dots) return;
    function onMove(e: MouseEvent) {
      const r = el!.getBoundingClientRect();
      el!.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      el!.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    }
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [prefs.dots]);

  useEffect(() => {
    if (!isTauri()) return;
    ipc.envActiveGet().then(setActiveEnv).catch(console.error);
    ipc.envList().then(setEnvs).catch(console.error);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E"))) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      e.preventDefault();
      envSwitcherTriggerRef.current?.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // describe: writes to a captured tab id so a mid-fetch tab switch can't clobber another tab.
  // Returns true on a reachable catalog, false otherwise (so Connect can pick a scenario).
  async function describe(id: string, address: string, tls: boolean): Promise<boolean> {
    if (!address.trim()) {
      T.patchTab(id, { catalog: null, reflectNote: null });
      return false;
    }
    if (!isTauri()) return false;
    let resolved: string;
    try {
      const r = await ipc.varsResolve(address);
      if (r.unresolved_vars.length > 0) {
        T.patchTab(id, { reflectNote: `Unresolved: ${r.unresolved_vars.join(", ")}`, catalog: null });
        return false;
      }
      if (r.cycle_chain) {
        T.patchTab(id, { reflectNote: `Variable cycle: ${r.cycle_chain.join(" → ")}`, catalog: null });
        return false;
      }
      resolved = r.resolved;
    } catch {
      return false;
    }
    try {
      const cat = await ipc.grpcDescribe({ address: resolved, tls, skip_verify: false });
      T.patchTab(id, { catalog: cat, reflectNote: null });
      return true;
    } catch (e) {
      const t = e as { type?: string; message?: string };
      T.patchTab(id, { reflectNote: t.message ?? t.type ?? "reflection failed", catalog: null });
      return false;
    }
  }

  // Explicit Connect / Disconnect from the address bar.
  const onConnect = () => {
    const id = active.id;
    const addr = active.draft.address.trim();
    // Connected → disconnect.
    if (active.scenario !== "idle" && active.scenario !== "newServer") {
      T.patchTab(id, { scenario: "idle" });
      return;
    }
    if (!addr) return;
    T.patchTab(id, { scenario: "connecting", reflectNote: null });
    describe(id, active.draft.address, active.draft.tls)
      .then((ok) => {
        T.patchTab(id, { scenario: ok ? "connected" : "newServer" });
      })
      .catch(() => {
        T.patchTab(id, { scenario: "newServer" });
      });
  };

  useEffect(() => {
    if (!isTauri()) return;
    // Draft / disconnected / connecting tabs wait for an explicit Connect.
    if (active.scenario === "newServer" || active.scenario === "idle" || active.scenario === "connecting") return;
    const id = active.id;
    const addr = active.draft.address;
    const tls = active.draft.tls;
    const timer = setTimeout(() => {
      describe(id, addr, tls).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id, active.draft.address, active.draft.tls, active.scenario]);

  // catalog → auto-pick selected (guarded with captured id)
  useEffect(() => {
    const id = active.id;
    const cat = active.catalog;
    const sel = active.selected;
    if (!cat) {
      if (sel) T.patchTab(id, { selected: null });
      return;
    }
    if (sel) {
      const stillThere = cat.services.some(
        (s) => s.full_name === sel.service && s.methods.some((m) => m.name === sel.method),
      );
      if (stillThere) return;
    }
    const svc = cat.services[0];
    const mth = svc?.methods[0];
    T.patchTab(id, {
      selected: svc && mth ? { service: svc.full_name, method: mth.name, kind: deriveKind(mth) } : null,
    });
    // only re-pick when the active tab's catalog changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id, active.catalog]);

  // selected change → reset outcome + sync draft.service/method/kind.
  // Guarded against tab switches: only fires when the active tab's draft is
  // out of sync with its selection (i.e. a genuine selection change), so
  // switching back to a tab does not wipe its completed response.
  useEffect(() => {
    const id = active.id;
    const sel = active.selected;
    const d = active.draft;
    if ((sel?.service ?? null) === d.service && (sel?.method ?? null) === d.method) return;
    T.patchTab(id, (t) => ({
      outcome: null,
      invokeError: null,
      draft: {
        ...t.draft,
        service: sel?.service ?? null,
        method: sel?.method ?? null,
        kind: sel?.kind ?? null,
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id, active.selected?.service, active.selected?.method]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || (!e.ctrlKey && !e.metaKey)) return;
      if (sending || !selected) return;
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, selected]);

  // --- Collections sidebar handlers ---------------------------------------
  function handleSelectRequest(collectionId: string, req: SavedRequestIpc) {
    T.patchActive({
      draft: loadIntoDraft(req, { collectionId, itemId: req.id }),
      selected:
        req.service && req.method
          ? { service: req.service, method: req.method, kind: "unary" }
          : null,
      scenario: "connected",
      outcome: null,
      invokeError: null,
      reflectNote: null,
    });
  }

  async function handleNewCollection() {
    await collections.createCollection("New collection");
    await collections.loadAll();
  }

  async function handleDeleteItem(collectionId: string, itemId: string) {
    await collections.deleteItem(collectionId, itemId);
  }

  async function handleRenameItem(collectionId: string, itemId: string, name: string) {
    await collections.renameItem(collectionId, itemId, name);
  }

  async function handleDeleteCollection(collectionId: string) {
    await ipc.collectionDelete(collectionId);
    await collections.loadAll();
  }

  function handleSend() {
    sendingTabIdRef.current = active.id;
    requestPanelRef.current?.send().catch((e) => console.error("send failed:", e));
  }

  async function handleRefresh() {
    if (!draft.address.trim()) return;
    const id = active.id;
    setRefreshing(true);
    try {
      const r = await ipc.varsResolve(draft.address);
      if (r.unresolved_vars.length > 0 || r.cycle_chain) {
        T.patchTab(id, { reflectNote: "address has unresolved variables" });
        return;
      }
      const cat = await ipc.grpcRefreshContract({ address: r.resolved, tls: draft.tls, skip_verify: false });
      T.patchTab(id, { catalog: cat, reflectNote: null });
    } catch (e) {
      const t = e as { type?: string; message?: string };
      T.patchTab(id, { reflectNote: t.message ?? t.type ?? "refresh failed" });
    } finally {
      setRefreshing(false);
    }
  }

  async function doSave(args: { collectionId: string; parentId: string | null; name: string }) {
    if (draft.origin) {
      const col = await collections.load(draft.origin.collectionId);
      const updated = draftToSavedRequest(draft, args.name, draft.origin.itemId);
      const next = { ...col, items: replaceRequestInItems(col.items, draft.origin.itemId, updated) };
      await collections.upsert(next);
      setDraft((d) => ({ ...d, dirty: false }));
    } else {
      const id = newId();
      const saved = draftToSavedRequest(draft, args.name, id);
      await collections.addRequest(args.collectionId, args.parentId, savedRequestItem(saved));
      setDraft((d) => ({ ...d, origin: { collectionId: args.collectionId, itemId: id }, dirty: false }));
    }
    const pending = pendingCloseRef.current;
    if (pending) {
      pendingCloseRef.current = null;
      T.closeTab(pending);
    }
  }

  function handleSaveAndClose() {
    const closing = T.closing;
    if (!closing) return;
    T.setActiveId(closing.id);
    pendingCloseRef.current = closing.id;
    setSaveOpen(true);
    T.setClosing(null);
  }

  const respState: RespState =
    sending ? "sending" : invokeError ? "error" : outcome ? (outcome.status_code === 0 ? "success" : "error") : "idle";

  return (
    <div className="fixed inset-0 flex flex-col bg-background border border-border rounded-[10px] overflow-hidden">
      <Titlebar
        envSlot={
          <EnvPill
            ref={envSwitcherTriggerRef}
            envs={envs}
            activeEnv={activeEnv}
            onEnvsChanged={async () => setEnvs(await ipc.envList())}
            onActiveEnvChanged={setActiveEnv}
          />
        }
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <RequestTabs
        tabs={T.tabs}
        activeId={T.activeId}
        onActivate={T.setActiveId}
        onClose={T.requestClose}
        onNew={T.newTab}
      />
      <div className="flex-1 flex min-h-0">
        {prefs.sidebar && (
          <CollectionsSidebar
            tree={collections.tree}
            activeItemId={active.draft.origin?.itemId ?? null}
            onSelectRequest={handleSelectRequest}
            onOpenCollection={(id) =>
              T.patchActive({ scenario: "collection", openCollectionId: id })
            }
            onNewRequest={T.newTab}
            onNewCollection={handleNewCollection}
            onDeleteItem={handleDeleteItem}
            onRenameItem={handleRenameItem}
            onDeleteCollection={handleDeleteCollection}
          />
        )}
        <main ref={mainRef} className="flex-1 flex flex-col min-w-0 min-h-0 relative bg-background">
          {prefs.dots && (
            <>
              <div className="dots-base" />
              <div className="dots-glow" />
            </>
          )}
          <ConnectionBar
            host={draft.address}
            onHostChange={(next) => setDraft((d) => ({ ...d, address: next }))}
            onHostCommit={() => describe(active.id, draft.address, draft.tls)}
            tls={draft.tls}
            onTlsChange={(next) => {
              const id = active.id;
              T.patchTab(id, (t) => ({
                draft: { ...t.draft, tls: next },
                // Switching TLS on a live connection drops it back to disconnected.
                ...(isConnected ? { scenario: "idle" as const } : {}),
              }));
            }}
            draft={isDraft}
            connecting={isConnecting}
            connected={isConnected}
            onConnect={onConnect}
            sending={sending}
            selected={selected}
            onSend={handleSend}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            reflectNote={reflectNote}
            pickerSlot={
              catalog && selected ? (
                <MethodPicker
                  selected={selected}
                  catalog={catalog}
                  onSelect={(next) => setSelected(next)}
                  className="h-7 px-1.5 -ml-0 flex-1 min-w-0 justify-start"
                />
              ) : undefined
            }
          />
          {scenario === "newServer" ? (
            <NewRequestHero />
          ) : scenario === "idle" || scenario === "connecting" ? (
            <DisconnectedHero scenario={scenario} host={active.draft.address} />
          ) : scenario === "collection" ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              Collection
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "flex-1 flex min-h-0 min-w-0",
                  prefs.split === "horizontal" ? "flex-col" : "flex-row",
                )}
              >
                {selected ? (
                  <RequestPanel
                    ref={requestPanelRef}
                    selected={selected}
                    target={target}
                    metadata={draft.metadata}
                    onMetadataChange={(next) => setDraft((d) => ({ ...d, metadata: next }))}
                    auth={draft.auth}
                    onAuthChange={(next) => setDraft((d) => ({ ...d, auth: next }))}
                    onDirty={() =>
                      T.patchActive((t) => (t.draft.dirty ? {} : { draft: { ...t.draft, dirty: true } }))
                    }
                    onRequestSave={() => setSaveOpen(true)}
                    onNewRequest={T.newTab}
                    onSending={(v) =>
                      T.patchTab(sendingTabIdRef.current ?? active.id, { sending: v })
                    }
                    onOutcome={(o) =>
                      T.patchTab(sendingTabIdRef.current ?? active.id, { outcome: o, invokeError: null })
                    }
                    onError={(m) =>
                      T.patchTab(sendingTabIdRef.current ?? active.id, { invokeError: m, outcome: null })
                    }
                  />
                ) : (
                  <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
                    Select a method to begin
                  </div>
                )}
                <div className={cn(prefs.split === "horizontal" ? "h-px w-full" : "w-px h-full", "bg-border")} />
                <ResponsePanel state={respState} outcome={outcome} />
              </div>
              {invokeError && (
                <div className="fixed bottom-4 right-4 z-20 max-w-md rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-md">
                  {invokeError}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <SaveRequestDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        metas={collections.metas}
        loadCollection={collections.load}
        defaultName={selected ? selected.method : "request"}
        onSave={doSave}
        onCreateCollection={collections.createCollection}
        originBound={draft.origin != null}
      />

      <CloseConfirm
        tab={T.closing}
        onCancel={() => T.setClosing(null)}
        onDiscard={() => {
          T.closeTab(T.closing!.id);
          T.setClosing(null);
        }}
        onSave={handleSaveAndClose}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
