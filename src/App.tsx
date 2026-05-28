import { useEffect, useRef, useState } from "react";
import { EnvPill } from "@/features/envs/EnvPill";
import { Titlebar } from "@/features/shell/Titlebar";
import { Toolbar } from "@/features/shell/Toolbar";
import { Sidebar, type SidebarTab } from "@/features/shell/Sidebar";
import { ipc } from "@/ipc/client";
import { onConnectionStateChanged, onContractUpdated } from "@/ipc/events";
import type { EnvironmentIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import { usePrefs } from "@/lib/use-prefs";
import { cn } from "@/lib/cn";

export default function App() {
  const [prefs] = usePrefs();
  const [version, setVersion] = useState("");
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<SelectedMethod | null>(null);
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [envs, setEnvs] = useState<EnvironmentIpc[]>([]);
  const [sideTab, setSideTab] = useState<SidebarTab>("services");
  const [sideQuery, setSideQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const envSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  useEffect(() => {
    // density → root font-size
    const fs =
      prefs.density === "compact" ? "12.5px" :
      prefs.density === "cozy"    ? "13.5px" :
                                    "13px";
    document.documentElement.style.fontSize = fs;

    // UI font
    const ui =
      prefs.fontUi === "geist"  ? `"Geist","Inter",ui-sans-serif,system-ui,sans-serif` :
      prefs.fontUi === "system" ? `system-ui,-apple-system,"Segoe UI",sans-serif` :
                                  `"Inter",ui-sans-serif,system-ui,sans-serif`;
    document.documentElement.style.setProperty("--font-sans-override", ui);

    // Mono font
    const mn =
      prefs.fontMono === "geist-mono" ? `"Geist Mono","JetBrains Mono",ui-monospace,monospace` :
      prefs.fontMono === "ibm"        ? `"IBM Plex Mono","JetBrains Mono",ui-monospace,monospace` :
                                         `"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace`;
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
    ipc.appVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    let a: (() => void) | undefined;
    let b: (() => void) | undefined;
    onConnectionStateChanged((e) => setConnected(e.connected)).then((fn) => (a = fn));
    onContractUpdated((e) => console.log("contract updated:", e.target_key)).then((fn) => (b = fn));
    return () => {
      a?.();
      b?.();
    };
  }, []);

  useEffect(() => {
    if (!connected) {
      setSelected(null);
      setCatalog(null);
    }
  }, [connected]);

  const servicesCount = catalog?.services.length ?? 0;

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
            <div className="px-3 py-6 text-xs text-muted-foreground">
              {sideTab === "services" && (connected ? "Services catalog appears here" : "Not connected")}
              {sideTab === "history" && "History — not implemented yet"}
              {sideTab === "saved" && "Saved — not implemented yet"}
            </div>
          </Sidebar>
        )}
        <main ref={mainRef} className="flex-1 flex flex-col min-w-0 min-h-0 relative bg-background">
          {prefs.dots && (
            <>
              <div className="dots-base" />
              <div className="dots-glow" />
            </>
          )}
          <div className="h-14 flex-none flex items-center px-3.5 border-b border-border text-xs text-muted-foreground">
            ConnectionBar placeholder · connected={String(connected)} · selected={selected ? `${selected.service}/${selected.method}` : "—"}
          </div>
          <div
            className={cn(
              "flex-1 flex min-h-0 min-w-0",
              prefs.split === "horizontal" ? "flex-col" : "flex-row",
            )}
          >
            <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
              Request pane placeholder (Phase 8)
            </div>
            <div className={cn(prefs.split === "horizontal" ? "h-px w-full" : "w-px h-full", "bg-border")} />
            <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
              Response pane placeholder (Phase 9)
            </div>
          </div>
        </main>
      </div>
      {settingsOpen && (
        <div className="fixed bottom-4 left-4 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
          Settings placeholder · <button onClick={() => setSettingsOpen(false)} className="underline">close</button>
        </div>
      )}
      <ReferenceSink catalog={catalog} setCatalog={setCatalog} setSelected={setSelected} />
    </div>
  );
}

function ReferenceSink(_: {
  catalog: ServiceCatalogIpc | null;
  setCatalog: (c: ServiceCatalogIpc | null) => void;
  setSelected: (s: SelectedMethod | null) => void;
}) {
  return null;
}
