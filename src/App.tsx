import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { EnvPill } from "@/features/envs/EnvPill";
import { Titlebar } from "@/features/shell/Titlebar";
import { Toolbar } from "@/features/shell/Toolbar";
import { Sidebar, type SidebarTab } from "@/features/shell/Sidebar";
import { ConnectionBar } from "@/features/shell/ConnectionBar";
import { MethodPicker } from "@/features/shell/MethodPicker";
import { SidebarServicesPane } from "@/features/shell/SidebarServicesPane";
import { SidebarHistoryPane } from "@/features/shell/SidebarHistoryPane";
import { SidebarCollectionsPane } from "@/features/shell/SidebarCollectionsPane";
import { RequestPanel, type RequestPanelHandle } from "@/features/invoke/RequestPanel";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";
import type { EnvironmentIpc, GrpcTargetIpc, InvokeOutcomeIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import { deriveKind, type SelectedMethod } from "@/features/shell/SelectedMethod";
import { useCollections } from "@/features/collections/useCollections";
import { SaveRequestDialog } from "@/features/collections/SaveRequestDialog";
import {
  draftToSavedRequest,
  emptyDraft,
  replaceRequestInItems,
  savedRequestItem,
  type DraftRequest,
} from "@/features/collections/draft";
import { newId } from "@/lib/ids";
import { usePrefs } from "@/lib/use-prefs";
import { cn } from "@/lib/cn";

export default function App() {
  const [prefs] = usePrefs();
  const [version, setVersion] = useState("");
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [selected, setSelected] = useState<SelectedMethod | null>(null);
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [envs, setEnvs] = useState<EnvironmentIpc[]>([]);
  const [sideTab, setSideTab] = useState<SidebarTab>("services");
  const [sideQuery, setSideQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [draft, setDraft] = useState<DraftRequest>(emptyDraft());
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reflectNote, setReflectNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvokeOutcomeIpc | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [guard, setGuard] = useState<{ open: boolean; next: () => void }>({ open: false, next: () => {} });

  const collections = useCollections();
  const envSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const requestPanelRef = useRef<RequestPanelHandle>(null);

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
    ipc.appVersion().then(setVersion).catch(console.error);
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

  async function describe(address: string, tls: boolean) {
    if (!address.trim()) {
      setCatalog(null);
      setReflectNote(null);
      return;
    }
    let resolved: string;
    try {
      const r = await ipc.varsResolve(address);
      if (r.unresolved_vars.length > 0) {
        setReflectNote(`Unresolved: ${r.unresolved_vars.join(", ")}`);
        setCatalog(null);
        return;
      }
      if (r.cycle_chain) {
        setReflectNote(`Variable cycle: ${r.cycle_chain.join(" → ")}`);
        setCatalog(null);
        return;
      }
      resolved = r.resolved;
    } catch {
      return;
    }
    try {
      const cat = await ipc.grpcDescribe({ address: resolved, tls, skip_verify: false });
      setCatalog(cat);
      setReflectNote(null);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setReflectNote(t.message ?? t.type ?? "reflection failed");
      setCatalog(null);
    }
  }

  useEffect(() => {
    if (!isTauri()) return;
    const addr = draft.address;
    const tls = draft.tls;
    const id = setTimeout(() => {
      describe(addr, tls).catch(() => undefined);
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.address, draft.tls]);

  useEffect(() => {
    if (!catalog) {
      setSelected(null);
      return;
    }
    if (selected) {
      const stillThere = catalog.services.some(
        (s) => s.full_name === selected.service && s.methods.some((m) => m.name === selected.method),
      );
      if (stillThere) return;
    }
    const svc = catalog.services[0];
    const mth = svc?.methods[0];
    setSelected(svc && mth ? { service: svc.full_name, method: mth.name, kind: deriveKind(mth) } : null);
    // only re-pick when the catalog changes; reading stale `selected` is safe (the stillThere check falls through to auto-pick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  useEffect(() => {
    setOutcome(null);
    setInvokeError(null);
    setDraft((d) => ({
      ...d,
      service: selected?.service ?? null,
      method: selected?.method ?? null,
      kind: selected?.kind ?? null,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.service, selected?.method]);

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

  const servicesCount = catalog?.services.length ?? 0;

  function handleSend() {
    requestPanelRef.current?.send().catch((e) => console.error("send failed:", e));
  }

  async function handleRefresh() {
    if (!draft.address.trim()) return;
    setRefreshing(true);
    try {
      const r = await ipc.varsResolve(draft.address);
      if (r.unresolved_vars.length > 0 || r.cycle_chain) {
        setReflectNote("address has unresolved variables");
        return;
      }
      const cat = await ipc.grpcRefreshContract({ address: r.resolved, tls: draft.tls, skip_verify: false });
      setCatalog(cat);
      setReflectNote(null);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setReflectNote(t.message ?? t.type ?? "refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  function confirmReplaceIfDirty(next: () => void) {
    if (draft.dirty) {
      setGuard({ open: true, next });
    } else {
      next();
    }
  }

  function newDraft() {
    confirmReplaceIfDirty(() => {
      setDraft(emptyDraft(draft.address));
      setOutcome(null);
      setInvokeError(null);
    });
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
  }

  const respState: RespState =
    sending ? "sending" : invokeError ? "error" : outcome ? (outcome.status_code === 0 ? "success" : "error") : "idle";

  return (
    <div className="fixed inset-0 flex flex-col bg-background border border-border rounded-[10px] overflow-hidden">
      <Titlebar />
      <Toolbar
        version={version}
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
      <div className="flex-1 flex min-h-0">
        {prefs.sidebar && (
          <Sidebar
            tab={sideTab}
            onTabChange={setSideTab}
            query={sideQuery}
            onQueryChange={setSideQuery}
            servicesCount={servicesCount}
            historyCount={0}
          >
            {sideTab === "services" && (
              <SidebarServicesPane
                connected={catalog != null}
                catalog={catalog}
                query={sideQuery}
                selected={selected}
                onSelect={(s) => setSelected(s)}
              />
            )}
            {sideTab === "history" && <SidebarHistoryPane />}
            {sideTab === "saved" && <SidebarCollectionsPane />}
          </Sidebar>
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
            onHostCommit={() => describe(draft.address, draft.tls)}
            tls={draft.tls}
            onTlsChange={(next) => setDraft((d) => ({ ...d, tls: next }))}
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
                onDirty={() => setDraft((d) => (d.dirty ? d : { ...d, dirty: true }))}
                onRequestSave={() => setSaveOpen(true)}
                onNewRequest={newDraft}
                onSending={setSending}
                onOutcome={(o) => {
                  setOutcome(o);
                  setInvokeError(null);
                }}
                onError={(m) => {
                  setInvokeError(m);
                  setOutcome(null);
                }}
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

      <AlertDialog open={guard.open} onOpenChange={(o) => setGuard((g) => ({ ...g, open: o }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits in the current request. Save them, discard them, or cancel?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setGuard((g) => ({ ...g, open: false }))}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const next = guard.next;
                setGuard({ open: false, next: () => {} });
                next();
              }}
            >
              Discard
            </Button>
            <Button
              onClick={() => {
                setGuard({ open: false, next: () => {} });
                setSaveOpen(true);
              }}
            >
              Save…
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
