// app.jsx — Handshaker main shell (multi-server, collections-driven)

const { useState: useS, useEffect: useE, useMemo: useM, useRef: useR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "#fafafa",
  "density": "regular",
  "sidebar": true,
  "split": "horizontal",
  "fontUi": "inter",
  "fontMono": "jetbrains",
  "dots": true
}/*EDITMODE-END*/;

const SCENARIOS = [
  { id: "request",    label: "Request" },
  { id: "sending",    label: "Sending" },
  { id: "success",    label: "OK" },
  { id: "error",      label: "Error" },
  { id: "streaming",  label: "Stream" },
  { id: "browse",     label: "Browse" },
  { id: "newServer",  label: "New server" },
  { id: "env",        label: "Env" },
  { id: "settings",   label: "Settings" },
];

// default selection — Users API / GetByOrderId (matches the reference)
const DEFAULT_SEL = { serverId: "users", svc: "UsersService", mth: "GetByOrderId" };

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const D = window.HS_DATA;

  const [scenario, setScenario] = useS("connected");
  const [query, setQuery] = useS("");
  const [selected, setSelected] = useS(DEFAULT_SEL);
  const [host, setHost] = useS(() => D.findServer(DEFAULT_SEL.serverId)?.host || "localhost:5002");
  const [tls, setTls] = useS(true);

  const [env, setEnv] = useS(D.environments[0]);
  const [envOpen, setEnvOpen] = useS(false);
  const [envModalOpen, setEnvModalOpen] = useS(false);
  const [settingsOpen, setSettingsOpen] = useS(false);
  const [browseServerId, setBrowseServerId] = useS(DEFAULT_SEL.serverId);

  const [requestTab, setRequestTab] = useS("body");
  const [responseTab, setResponseTab] = useS("body");
  const [streamFrames, setStreamFrames] = useS([]);

  // derived
  const activeServer = D.findServer(selected?.serverId) || D.servers[0];
  const selDef = selected ? D.findMethod(selected.serverId, selected.svc, selected.mth) : null;
  const selKind = selDef?.kind;
  const isStreaming = !!(selDef && activeServer?.proto !== "http" && selKind && selKind !== "unary");

  // pick a method (from tree or picker): switch active host + connect
  const selectMethod = (sel) => {
    const srv = D.findServer(sel.serverId);
    setSelected({ serverId: sel.serverId, svc: sel.svc, mth: sel.mth, savedName: sel.savedName });
    if (srv) { setHost(srv.host); setTls(srv.tls !== false); }
    setScenario((sc) => (sc === "request" ? "request" : "connected"));
  };

  // cursor tracking for dotted bg
  const mainRef = useR(null);
  useE(() => {
    const el = mainRef.current; if (!el) return;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
    };
    el.addEventListener("mousemove", move);
    return () => el.removeEventListener("mousemove", move);
  }, []);

  // scenario presets
  useE(() => {
    const offModals = () => { setEnvModalOpen(false); setSettingsOpen(false); };
    switch (scenario) {
      case "idle":
      case "connecting":
        offModals(); break;
      case "connected":
        offModals();
        if (!selected) setSelected(DEFAULT_SEL);
        setRequestTab("body"); setResponseTab("body"); break;
      case "request":
        offModals(); setRequestTab("body"); break;
      case "sending":
      case "success":
        offModals(); setResponseTab("body");
        if (!selected) { setSelected(DEFAULT_SEL); setHost(D.findServer("users").host); } break;
      case "error":
        offModals();
        setSelected({ serverId: "users", svc: "UsersService", mth: "Authenticate" });
        setHost(D.findServer("users").host); setTls(true);
        setResponseTab("body"); break;
      case "streaming":
        offModals();
        setSelected({ serverId: "orders", svc: "OrderService", mth: "StreamUpdates" });
        setHost(D.findServer("orders").host); setTls(true);
        setStreamFrames([
          { body: '{ "orderId": "ord_8f2a91", "op": "created", "status": "PENDING" }', size: 76, t: 12 },
          { body: '{ "orderId": "ord_8f2a91", "op": "updated", "status": "PAID" }', size: 71, t: 248 },
          { body: '{ "orderId": "ord_91b7c0", "op": "created", "status": "PENDING" }', size: 76, t: 519 },
          { body: '{ "orderId": "ord_8f2a91", "op": "updated", "status": "FULFILLED" }', size: 78, t: 802 },
        ]);
        break;
      case "browse":
      case "server":
        offModals(); setBrowseServerId((id) => id || selected?.serverId || "orders"); break;
      case "newServer":
        offModals();
        setSelected(null); setHost(""); setTls(true);
        setRequestTab("body"); setResponseTab("body"); break;
      case "env":       setEnvModalOpen(true); break;
      case "settings":  setSettingsOpen(true); break;
    }
  }, [scenario]);

  const onSend = () => {
    if (!selected) return;
    if (isStreaming) setScenario("streaming");
    else { setScenario("sending"); setTimeout(() => setScenario("success"), 750); }
  };
  const onCancel = () => setScenario("connected");

  // theme + fonts + accent
  useE(() => {
    document.documentElement.classList.toggle("dark", t.theme === "dark");
    const hsl = hexToHsl(t.accent);
    document.documentElement.style.setProperty("--primary", hsl.join(" "));
    document.documentElement.style.setProperty("--primary-foreground", contrastHsl(hsl));
    document.documentElement.style.setProperty("--ring", t.theme === "dark" ? hsl.join(" ") : "0 0% 3.9%");
    const fs = t.density === "compact" ? "12.5px" : t.density === "cozy" ? "13.5px" : "13px";
    document.getElementById("root").style.fontSize = fs;
    const ui = t.fontUi === "geist" ? "'Geist','Inter',ui-sans-serif,system-ui,sans-serif"
      : t.fontUi === "system" ? "system-ui,-apple-system,'Segoe UI',sans-serif"
      : "'Inter',ui-sans-serif,system-ui,sans-serif";
    const mn = t.fontMono === "geist-mono" ? "'Geist Mono','JetBrains Mono',ui-monospace,monospace"
      : t.fontMono === "ibm" ? "'IBM Plex Mono','JetBrains Mono',ui-monospace,monospace"
      : "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace";
    document.documentElement.style.setProperty("--font-sans-override", ui);
    document.documentElement.style.setProperty("--font-mono-override", mn);
  }, [t.theme, t.accent, t.density, t.fontUi, t.fontMono]);

  // request body
  const body = useM(() => {
    if (!selected) return D.bodies["OrderService/Create"];
    const key = selected.svc ? `${selected.svc}/${selected.mth}` : selected.mth;
    return D.bodies[key] || [{ ln: "{" }, { ln: "}" }];
  }, [selected]);

  const respState =
    scenario === "sending" ? "sending" :
    scenario === "success" ? "success" :
    scenario === "error" ? "error" :
    scenario === "streaming" ? "streaming" : "idle";
  const respBody = scenario === "error" ? D.responses.error : D.responses.success;
  const error = scenario === "error" ? { code: "UNAUTHENTICATED", message: "missing bearer token in metadata" } : null;
  const trailers = D.trailers;
  const latency = scenario === "error" ? "12ms" : "1ms";
  const sizeS = scenario === "error" ? "62B" : "58B";
  const draft = scenario === "newServer";
  const connected = !(scenario === "idle" || scenario === "connecting" || draft);
  const browseServer = D.findServer(browseServerId) || activeServer;

  const selForPanel = selected ? { svc: selected.svc, mth: selected.mth, kind: selKind } : null;

  return (
    <div
      className="fixed inset-0 flex flex-col bg-background border border-border rounded-[10px] overflow-hidden"
      style={{ fontFamily: "var(--font-sans-override, var(--tw-font-sans))" }}
    >
      <style>{`
        body, .font-sans { font-family: var(--font-sans-override, 'Inter', ui-sans-serif, system-ui, sans-serif) !important; }
        .font-mono, code, kbd { font-family: var(--font-mono-override, 'JetBrains Mono', ui-monospace, monospace) !important; }
      `}</style>
      <Titlebar/>
      <Toolbar
        env={env} envOpen={envOpen} setEnvOpen={setEnvOpen}
        onEnvSelect={(e) => { setEnv(e); setEnvOpen(false); }}
        onNewEnv={() => { setEnvOpen(false); setEnvModalOpen(true); }}
        onOpenSettings={() => setSettingsOpen(true)}
        envs={D.environments}
        t={t} setTweak={setTweak}
      />

      <div className="flex-1 flex min-h-0">
        {t.sidebar && (
          <Sidebar
            collection={D.collection}
            selected={selected}
            onSelect={selectMethod}
            onBrowseServer={(id) => { setBrowseServerId(id); setScenario("browse"); }}
            onOpenServer={(id) => { setBrowseServerId(id); setScenario("server"); }}
            onAddServer={() => setScenario("newServer")}
            onImport={() => {}}
            onExport={() => {}}
            query={query} setQuery={setQuery}
          />
        )}
        <main ref={mainRef} className="flex-1 flex flex-col min-w-0 min-h-0 relative bg-background">
          {t.dots && (<><div className="dots-base"/><div className="dots-glow"/></>)}
          <ConnectionBar
            tls={tls} setTls={setTls}
            host={host} setHost={setHost}
            server={activeServer}
            connected={connected}
            connecting={scenario === "connecting"}
            draft={draft}
            onToggle={() => setScenario(connected ? "idle" : "connecting")}
            selected={selForPanel}
            services={activeServer ? activeServer.services : []}
            onSelect={(s) => selectMethod({ serverId: activeServer.id, svc: s.svc, mth: s.mth })}
            onSend={onSend}
            sending={scenario === "sending"}
            browsing={scenario === "browse"}
          />
          {!connected ? (
            draft ? (
              <NewRequestHero/>
            ) : (
              <DisconnectedHero scenario={scenario} host={host}/>
            )
          ) : scenario === "server" ? (
            <ServerOverview
              server={browseServer}
              collection={D.collection}
              onClose={() => setScenario("connected")}
              onSelectMethod={(sel) => selectMethod(sel)}
            />
          ) : scenario === "browse" ? (
            <ServerBrowser
              server={browseServer}
              collection={D.collection}
              onClose={() => setScenario("connected")}
              onAdd={() => setScenario("connected")}
            />
          ) : (
            <div className={cn("flex-1 flex min-h-0 min-w-0", t.split === "horizontal" ? "flex-col" : "flex-row")}>
              <RequestPanel
                selected={selForPanel}
                body={body}
                requestTab={requestTab} setRequestTab={setRequestTab}
                auth={{ kind: "bearer" }}
              />
              <div className={cn(t.split === "horizontal" ? "h-px w-full" : "w-px h-full", "bg-border flex-none")}/>
              <ResponsePanel
                state={respState}
                responseTab={responseTab} setResponseTab={setResponseTab}
                body={respBody} trailers={trailers} streamFrames={streamFrames}
                error={error} latency={latency} size={sizeS} onCancel={onCancel}
              />
            </div>
          )}
        </main>
      </div>

      <EnvironmentModal
        open={envModalOpen}
        onClose={() => { setEnvModalOpen(false); if (scenario === "env") setScenario("connected"); }}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); if (scenario === "settings") setScenario("connected"); }}
        t={t} setTweak={setTweak}
      />

      <StateBar scenario={scenario} setScenario={setScenario}/>

      <TweaksPanel>
        <TweakSection label="Theme"/>
        <TweakRadio label="Mode" value={t.theme} options={["dark","light"]} onChange={(v)=>setTweak('theme',v)}/>
        <TweakColor label="Accent" value={t.accent}
          options={["#fafafa","#7ec8e3","#9ab9d9","#c2a3e3","#e5c07a","#6cd697","#f0a08a"]}
          onChange={(v)=>setTweak('accent', v)}/>
        <TweakSection label="Layout"/>
        <TweakRadio label="Density" value={t.density} options={["compact","regular","cozy"]} onChange={(v)=>setTweak('density',v)}/>
        <TweakToggle label="Sidebar" value={t.sidebar} onChange={(v)=>setTweak('sidebar', v)}/>
        <TweakRadio label="Split" value={t.split} options={["horizontal","vertical"]} onChange={(v)=>setTweak('split',v)}/>
        <TweakToggle label="Dotted background" value={t.dots} onChange={(v)=>setTweak('dots', v)}/>
        <TweakSection label="Typography"/>
        <TweakSelect label="UI font" value={t.fontUi} options={["inter","geist","system"]} onChange={(v)=>setTweak('fontUi',v)}/>
        <TweakSelect label="Mono font" value={t.fontMono} options={["jetbrains","geist-mono","ibm"]} onChange={(v)=>setTweak('fontMono',v)}/>
      </TweaksPanel>
    </div>
  );
}

/* ─────────── Titlebar ─────────── */
function Titlebar() {
  return (
    <div className="tb-drag h-8 flex-none flex items-center px-2.5 gap-2.5 bg-card border-b border-border select-none">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
        <Icons.Logo size={13} className="text-foreground/85"/>
      </span>
      <span className="flex-1"/>
      <div className="tb-nodrag flex items-center gap-0.5">
        <Tooltip content="Minimize" side="left"><button className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"><Icons.Min size={11}/></button></Tooltip>
        <Tooltip content="Maximize" side="left"><button className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"><Icons.Max size={9}/></button></Tooltip>
        <Tooltip content="Close" side="left"><button className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"><Icons.X size={11}/></button></Tooltip>
      </div>
    </div>
  );
}

/* ─────────── Toolbar ─────────── */
function Toolbar({ env, envOpen, setEnvOpen, onEnvSelect, onNewEnv, onOpenSettings, envs, t, setTweak }) {
  return (
    <div className="h-12 flex-none flex items-center px-3.5 gap-2.5 border-b border-border bg-background/85 backdrop-blur-sm relative z-40">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold tracking-tight text-foreground">Handshaker</span>
        </div>
        <DropdownMenu open={envOpen} onOpenChange={setEnvOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 h-8 pl-2.5 pr-2 text-xs font-normal">
              <span className="h-1.5 w-1.5 rounded-full" style={{background: env.color}}/>
              {env.name}
              <Icons.ChevronDown size={11} className="opacity-50"/>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Environments</DropdownMenuLabel>
            {envs.map(e => (
              <DropdownMenuItem key={e.name} onClick={()=>onEnvSelect(e)} className={cn(e.name===env.name && "bg-accent")}>
                <span className="h-1.5 w-1.5 rounded-full flex-none" style={{background:e.color}}/>
                <span className="flex-1 text-left">{e.name}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{e.vars} vars</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator/>
            <DropdownMenuItem onClick={onNewEnv}><Icons.Plus size={12}/> New environment</DropdownMenuItem>
            <DropdownMenuItem><Icons.Settings size={12}/> Manage…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Tooltip content="Toggle sidebar">
          <Button variant="ghost" size="icon-sm" onClick={()=>setTweak('sidebar', !t.sidebar)}>
            <Icons.PanelLeft size={14}/>
          </Button>
        </Tooltip>
        <Tooltip content={t.theme === "dark" ? "Light mode" : "Dark mode"}>
          <Button variant="ghost" size="icon-sm" onClick={()=>setTweak('theme', t.theme==="dark"?"light":"dark")}>
            {t.theme === "dark" ? <Icons.Sun size={14}/> : <Icons.Moon size={14}/>}
          </Button>
        </Tooltip>
        <Tooltip content="Settings">
          <Button variant="ghost" size="icon-sm" onClick={onOpenSettings}>
            <Icons.Settings size={14}/>
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

/* ─────────── Connection bar ─────────── */
function ConnectionBar({ tls, setTls, host, setHost, server, connected, connecting, draft, onToggle, selected, services, onSelect, onSend, sending, browsing }) {
  const hostRef = React.useRef(null);
  React.useEffect(() => {
    if (draft) { const t = setTimeout(() => hostRef.current?.focus(), 40); return () => clearTimeout(t); }
  }, [draft]);
  const canConnect = !draft || host.trim().length > 0;
  return (
    <div className="h-14 flex-none flex items-center gap-2 px-3.5 border-b border-border bg-background relative z-30">
      <Tooltip content={tls ? "TLS enabled — click to switch to plaintext" : "Plaintext — click to enable TLS"}>
        <Button
          variant="outline" size="icon"
          onClick={()=>setTls(!tls)}
          aria-label={tls ? "TLS enabled" : "Plaintext"}
          className="h-9 w-9 flex-none"
        >
          {tls ? <Icons.Lock size={14}/> : <Icons.Unlock size={14}/>}
        </Button>
      </Tooltip>
      <div className={cn(
        "flex-1 min-w-0 flex items-stretch h-9 rounded-md border bg-background",
        draft ? "border-ring ring-1 ring-ring" : "border-input focus-within:ring-1 focus-within:ring-ring",
      )}>
        <input
          ref={hostRef}
          value={host}
          onChange={(e)=>setHost(e.target.value)}
          onKeyDown={(e)=>{ if (draft && e.key === "Enter" && canConnect) onToggle(); }}
          placeholder="host:port"
          className="w-[42%] min-w-[130px] h-full px-2.5 bg-transparent font-mono text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {connected && selected && !browsing ? (
          <>
            <span className="w-px self-stretch bg-border my-1.5"/>
            <div className="flex-1 min-w-0 flex items-center pl-2 pr-1.5">
              <MethodPicker
                selected={selected}
                services={services}
                onSelect={onSelect}
                maxLabel={150}
                className="h-7 px-1.5 flex-1 min-w-0 justify-start"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center pl-2 pr-3 text-[11.5px] text-muted-foreground/70 font-mono select-none">
            {connecting ? "negotiating…"
              : browsing ? "browsing methods…"
              : draft ? (host.trim() ? "press Connect to discover methods" : "enter a server address")
              : connected ? "select a method" : "not connected"}
          </div>
        )}
      </div>
      {!connected && !connecting && (
        <Button onClick={onToggle} disabled={!canConnect} className="h-9 flex-none">Connect</Button>
      )}
      {connecting && <Button disabled className="h-9 flex-none gap-1.5"><span className="spinner"/> Connecting</Button>}
      {connected && (
        <>
          <Button onClick={onSend} disabled={sending || !selected || browsing} className="h-9 flex-none gap-1.5 min-w-[88px]">
            {sending ? <><span className="spinner"/> Sending</> : "Send"}
          </Button>
        </>
      )}
    </div>
  );
}

/* ─────────── Disconnected hero ─────────── */
function DisconnectedHero({ scenario, host }) {
  if (scenario === "connecting") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-10 relative z-10">
        <div className="h-11 w-11 rounded-lg border border-border bg-card flex items-center justify-center mb-3.5 text-foreground/70">
          <span className="spinner" style={{width:18, height:18}}/>
        </div>
        <div className="text-foreground text-sm font-medium mb-1">Negotiating TLS…</div>
        <div className="text-muted-foreground text-xs font-mono">{host}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 relative z-10 text-center">
      <div className="h-14 w-14 rounded-xl border border-border bg-card flex items-center justify-center mb-5 text-foreground/85">
        <Icons.Logo size={26}/>
      </div>
      <div className="text-foreground text-lg font-semibold tracking-tight mb-1.5">Disconnected</div>
      <div className="text-muted-foreground text-sm max-w-[400px] leading-relaxed mb-5">
        Reconnect to resume, or pick any method from your collections in the sidebar — Handshaker connects to its server automatically.
      </div>
      <div className="flex items-center gap-2 text-[11.5px] font-mono text-muted-foreground">
        <span className="px-2 py-1 border border-border rounded-md bg-card">{host}</span>
        <span className="px-2 py-1 border border-border rounded-md bg-card">+ Add server</span>
      </div>
    </div>
  );
}

/* ─────────── New request draft (address-first add server) ─────────── */
function NewRequestHero() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 relative z-10 text-center">
      <div className="h-14 w-14 rounded-xl border border-border bg-card flex items-center justify-center mb-5 text-foreground/85">
        <Icons.Plus size={24}/>
      </div>
      <div className="text-foreground text-lg font-semibold tracking-tight mb-1.5">New request</div>
      <div className="text-muted-foreground text-sm max-w-[430px] leading-relaxed mb-3">
        Type a server address in the bar above and hit <span className="text-foreground/85 font-medium">Connect</span>.
        Handshaker runs reflection and lists every method — no dialog, no setup.
      </div>
      <div className="text-[11px] text-muted-foreground/70 inline-flex items-center gap-2 font-mono">
        <span className="inline-flex items-center gap-1">↑ address bar</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> to connect</span>
      </div>
    </div>
  );
}

/* ─────────── State bar ─────────── */
function StateBar({ scenario, setScenario }) {
  return (
    <div
      className="fixed left-1/2 bottom-4 -translate-x-1/2 z-[100] flex items-center gap-0.5 rounded-full border bg-popover/95 backdrop-blur-md p-1 shadow-lg scroll-hide overflow-x-auto"
      style={{ maxWidth: "calc(100vw - 32px)" }}
    >
      <span className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground px-2.5 flex-none">State</span>
      {SCENARIOS.map(s => (
        <button
          key={s.id}
          onClick={()=>setScenario(s.id)}
          className={cn(
            "h-7 px-3 rounded-full text-[11.5px] transition-colors flex-none",
            scenario===s.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >{s.label}</button>
      ))}
    </div>
  );
}

/* ─────────── helpers ─────────── */
function hexToHsl(hex) {
  const c = hex.replace("#","");
  let r = parseInt(c.slice(0,2),16)/255, g = parseInt(c.slice(2,4),16)/255, b = parseInt(c.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max + min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b)/d + (g < b ? 6 : 0); break;
      case g: h = (b - r)/d + 2; break;
      case b: h = (r - g)/d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h*360), Math.round(s*1000)/10 + "%", Math.round(l*1000)/10 + "%"];
}
function contrastHsl(hsl) {
  const l = parseFloat(hsl[2]);
  return l > 55 ? "0 0% 9%" : "0 0% 98%";
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
