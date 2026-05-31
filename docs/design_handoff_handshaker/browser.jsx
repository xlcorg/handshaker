// browser.jsx — Server browser: see every method of a server, select & add to a collection.
// Shown in the main area (scenario "browse"). Flush main-app style.

const { useState: useStateBR, useMemo: useMemoBR } = React;

function ServerBrowser({ server, collection, onClose, onAdd }) {
  const MV = window.MethodVerb;
  const verbOfM = window.verbOf;
  const [q, setQ] = useStateBR("");
  const [streamOnly, setStreamOnly] = useStateBR(false);
  const [sel, setSel] = useStateBR(() => new Set());

  const needle = q.trim().toLowerCase();
  const groups = useMemoBR(() => {
    return server.services.map((s) => ({
      svc: s,
      methods: s.methods.filter((m) => {
        if (needle && !((s.short + "." + m.name).toLowerCase().includes(needle))) return false;
        if (streamOnly && !(m.kind && m.kind !== "unary")) return false;
        return true;
      }),
    })).filter((g) => g.methods.length > 0);
  }, [server, needle, streamOnly]);

  const totalMethods = server.services.reduce((n, s) => n + s.methods.length, 0);
  const shown = groups.reduce((n, g) => n + g.methods.length, 0);
  const toggle = (k) => { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); setSel(n); };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background relative z-10">
      {/* header: which server + actions */}
      <div className="h-12 flex-none flex items-center gap-2.5 px-3.5 border-b border-border bg-background/85 backdrop-blur-sm">
        <span className="text-sm font-semibold tracking-tight">{server.name}</span>
        <span className="font-mono text-[11.5px] text-muted-foreground/70">{server.host}</span>
        {server.reflection && (
          <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground ml-1">
            <Icons.Activity size={11} className="text-ok"/>
            reflection · {server.reflection.services} services · {server.reflection.methods} methods
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="xs" className="gap-1.5"><Icons.Activity size={11}/> Update</Button>
          <Tooltip content="Server settings"><Button variant="ghost" size="icon-sm"><Icons.Settings size={14}/></Button></Tooltip>
          <Tooltip content="Close browser"><Button variant="ghost" size="icon-sm" onClick={onClose}><Icons.X size={14}/></Button></Tooltip>
        </div>
      </div>

      {/* filter row */}
      <div className="h-11 flex-none flex items-center gap-2 px-3.5 border-b border-border">
        <div className="flex-1 min-w-0 relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"><Icons.Search size={12}/></span>
          <Input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${totalMethods} methods…`}
            className="h-8 pl-7 pr-3 text-xs"
          />
        </div>
        {server.proto === "grpc" && (
          <Button
            variant={streamOnly ? "secondary" : "outline"} size="xs"
            onClick={() => setStreamOnly(!streamOnly)}
            className="gap-1.5"
          >
            <MV v="gRPC" stream="server"/> Streaming
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground/70 tabular-nums flex-none">{shown} of {totalMethods}</span>
      </div>

      {/* method list */}
      <div className="flex-1 min-h-0 overflow-auto scroll-thin py-1.5">
        {groups.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-muted-foreground">No methods match “{q}”.</div>
        ) : groups.map((g) => (
          <div key={g.svc.short || g.svc.name || "http"} className="mb-1">
            <div className="flex items-center gap-1.5 px-3.5 h-6 label-cap">
              <Icons.Cube size={11} className="opacity-60"/>
              <span className="truncate">{g.svc.short || server.host}</span>
              <span className="font-mono text-[9.5px] text-muted-foreground/50 ml-auto tabular-nums normal-case tracking-normal">{g.svc.methods.length}</span>
            </div>
            {g.methods.map((m) => {
              const key = (g.svc.short || "") + "/" + m.name;
              const checked = sel.has(key);
              const { v, stream } = verbOfM({ ...m, proto: server.proto });
              return (
                <button
                  key={m.name}
                  onClick={() => toggle(key)}
                  className={cn(
                    "group flex w-full items-center gap-2.5 pl-3.5 pr-3.5 h-8 transition-colors relative text-left",
                    checked ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  {checked && <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-primary"/>}
                  <span
                    className={cn(
                      "h-3.5 w-3.5 rounded-[4px] flex-none inline-flex items-center justify-center transition-colors",
                      checked ? "bg-primary text-primary-foreground" : "border border-input group-hover:border-muted-foreground/60",
                    )}
                  >
                    {checked && <Icons.Check size={10}/>}
                  </span>
                  <MethodTag def={{ ...m, proto: server.proto }}/>
                  <span className="font-mono text-[11.5px] text-foreground/85 truncate flex-1">{m.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 font-mono hidden lg:inline">{m.req} → {m.res}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* selection action bar */}
      <div className="h-13 flex-none flex items-center gap-2.5 px-3.5 border-t border-border bg-muted/20" style={{ height: 52 }}>
        <span className="text-xs text-foreground/85"><span className="font-semibold tabular-nums">{sel.size}</span> selected</span>
        {sel.size > 0 && (
          <button onClick={() => setSel(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">Clear</button>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-card text-xs text-foreground/80">
            <Icons.Layers size={12} className="text-muted-foreground"/>
            {collection?.name}
          </span>
          <Button
            disabled={sel.size === 0}
            onClick={() => onAdd && onAdd([...sel])}
            className="h-8 gap-1.5"
          >
            <Icons.Plus size={12}/> Add to collection
          </Button>
        </div>
      </div>
    </div>
  );
}

window.ServerBrowser = ServerBrowser;

/* ─────────── Server overview (opened by clicking a collection) ─────────── */
function SO_KV({ k, children }) {
  return (
    <div className="flex items-center gap-3 h-9 px-3 border-b border-border/60 last:border-0">
      <span className="text-[11.5px] text-muted-foreground w-24 flex-none">{k}</span>
      <span className="text-[12.5px] font-mono text-foreground/90 truncate">{children}</span>
    </div>
  );
}

function SO_Overview({ server, totalServices, totalMethods, protoLabel, q, setQ, onSelectMethod }) {
  const needle = q.trim().toLowerCase();
  const groups = server.services
    .map((s) => ({ svc: s, methods: s.methods.filter((m) => !needle || (s.short + "." + m.name).toLowerCase().includes(needle)) }))
    .filter((g) => g.methods.length > 0);
  const shown = groups.reduce((n, g) => n + g.methods.length, 0);

  return (
    <div className="px-5 py-5 max-w-[780px] mx-auto flex flex-col gap-6">
      <p className="text-[13px] leading-relaxed text-muted-foreground text-pretty">
        {server.name} exposes <span className="text-foreground/80 tabular-nums">{totalMethods}</span> methods across{" "}
        <span className="text-foreground/80 tabular-nums">{totalServices}</span> {totalServices === 1 ? "service" : "services"} over{" "}
        {server.proto === "http" ? "HTTP" : "gRPC"}. Pick any method below to open it in the request editor.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-lg border border-border bg-card/40">
          <div className="label-cap px-3 h-8 flex items-center border-b border-border/60">Connection</div>
          <SO_KV k="Host">{server.host}</SO_KV>
          <SO_KV k="TLS">{server.tls !== false ? "Enabled" : "Disabled"}</SO_KV>
          <SO_KV k="Protocol">{protoLabel}</SO_KV>
        </section>
        <section className="rounded-lg border border-border bg-card/40">
          <div className="label-cap px-3 h-8 flex items-center border-b border-border/60">Catalog</div>
          <SO_KV k="Services">{totalServices}</SO_KV>
          <SO_KV k="Methods">{totalMethods}</SO_KV>
          <SO_KV k="Reflection">{server.reflection ? "Available" : "Not available"}</SO_KV>
        </section>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="label-cap">Methods</span>
          <span className="font-mono text-[10px] text-muted-foreground/50 tabular-nums">{shown}</span>
          <div className="ml-auto relative w-56">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"><Icons.Search size={12}/></span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter methods…" className="h-7 pl-7 pr-2 text-xs"/>
          </div>
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          {groups.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">No methods match “{q}”.</div>
          ) : groups.map((g) => (
            <div key={g.svc.short || g.svc.name || "http"}>
              <div className="flex items-center gap-1.5 px-3 h-7 bg-muted/30 label-cap border-b border-border/60">
                <span className="truncate">{g.svc.short || server.host}</span>
                <span className="font-mono text-[9.5px] text-muted-foreground/50 ml-auto tabular-nums normal-case tracking-normal">{g.svc.methods.length}</span>
              </div>
              {g.methods.map((m) => (
                <button
                  key={m.name}
                  onClick={() => onSelectMethod && onSelectMethod({ serverId: server.id, svc: g.svc.short, mth: m.name, kind: m.kind })}
                  className="group flex w-full items-center gap-2.5 px-3 h-8 hover:bg-accent/50 transition-colors text-left border-b border-border/40 last:border-0"
                >
                  <MethodTag def={{ ...m, proto: server.proto }}/>
                  <span className="font-mono text-[11.5px] text-foreground/85 truncate flex-1">{m.name}</span>
                  <span className="text-[10px] text-muted-foreground/55 font-mono hidden lg:inline">{m.req} → {m.res}</span>
                  <Icons.Chevron size={11} className="text-muted-foreground/25 group-hover:text-muted-foreground flex-none"/>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SO_Auth({ server }) {
  const [type, setType] = useStateBR("bearer");
  const [inherit, setInherit] = useStateBR(true);
  return (
    <div className="px-5 py-5 max-w-[780px] mx-auto flex flex-col gap-5">
      <p className="text-[13px] leading-relaxed text-muted-foreground text-pretty">
        Authorization is applied to every request sent to <span className="font-mono text-foreground/80">{server.name}</span>, unless a method overrides it.
      </p>
      <div className="flex flex-col gap-2">
        <span className="label-cap">Type</span>
        <ToggleGroup
          value={type} onValueChange={setType}
          options={[{ value: "bearer", label: "Bearer token" }, { value: "apikey", label: "API key" }, { value: "none", label: "None" }]}
        />
      </div>
      {type === "bearer" && (
        <div className="flex flex-col gap-2">
          <span className="label-cap">Token</span>
          <Input defaultValue="{{authToken}}" className="h-9 font-mono text-[12.5px]"/>
          <p className="text-[11.5px] text-muted-foreground">Sent as <span className="font-mono text-foreground/70">authorization: Bearer …</span> metadata.</p>
        </div>
      )}
      {type === "apikey" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2"><span className="label-cap">Header</span><Input defaultValue="x-api-key" className="h-9 font-mono text-[12.5px]"/></div>
          <div className="flex flex-col gap-2"><span className="label-cap">Value</span><Input defaultValue="{{apiKey}}" className="h-9 font-mono text-[12.5px]"/></div>
        </div>
      )}
      {type === "none" && (
        <p className="text-[12.5px] text-muted-foreground">No authorization metadata is attached to requests for this server.</p>
      )}
      <div className="flex items-center gap-3 rounded-lg border border-border px-3.5 h-14">
        <div className="flex flex-col">
          <span className="text-[12.5px] text-foreground/90">Inherit from environment</span>
          <span className="text-[11px] text-muted-foreground">Use the active environment's credentials when present.</span>
        </div>
        <div className="ml-auto"><Switch checked={inherit} onCheckedChange={setInherit}/></div>
      </div>
    </div>
  );
}

function SO_Vars({ server }) {
  const rows = [
    { k: "baseUrl", v: server.host, scope: "server" },
    { k: "apiVersion", v: "v1", scope: "server" },
    { k: "tenantId", v: "acme", scope: "server" },
    { k: "timeoutMs", v: "5000", scope: "server" },
  ];
  return (
    <div className="px-5 py-5 max-w-[780px] mx-auto flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-muted-foreground text-pretty">
        Variables scoped to <span className="font-mono text-foreground/80">{server.name}</span>. Reference them anywhere as <span className="font-mono text-foreground/80">{`{{name}}`}</span>.
      </p>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2 px-3 h-8 items-center bg-muted/30 label-cap border-b border-border/60">
          <span>Variable</span><span>Value</span><span>Scope</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2 px-3 h-9 items-center border-b border-border/40 last:border-0">
            <span className="font-mono text-[12px] text-foreground/85 truncate">{`{{${r.k}}}`}</span>
            <span className="font-mono text-[12px] text-muted-foreground truncate">{r.v}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">{r.scope}</Badge>
          </div>
        ))}
      </div>
      <div><Button variant="outline" size="sm" className="h-8 gap-1.5"><Icons.Plus size={12}/> Add variable</Button></div>
    </div>
  );
}

function ServerOverview({ server, collection, onClose, onSelectMethod }) {
  const [tab, setTab] = useStateBR("overview");
  const [q, setQ] = useStateBR("");
  if (!server) return null;

  const totalServices = server.reflection?.services ?? server.services.filter((s) => s.short || s.name).length;
  const totalMethods = server.reflection?.methods ?? server.services.reduce((n, s) => n + s.methods.length, 0);
  const protoLabel = server.proto === "http" ? "HTTP/1.1 · REST" : "gRPC · HTTP/2";
  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "auth", label: "Authorization" },
    { value: "vars", label: "Variables" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background relative z-10">
      {/* header */}
      <div className="h-12 flex-none flex items-center gap-2.5 px-4 border-b border-border bg-background/85 backdrop-blur-sm">
        <span className="text-sm font-semibold tracking-tight">{server.name}</span>
        <span className="font-mono text-[11.5px] text-muted-foreground/70">{server.host}</span>
        <span className={cn("text-[11px] ml-1",
          server.status === "ok" ? "text-ok" : server.status === "slow" ? "text-warn" : "text-destructive")}>
          {server.status === "ok" ? "Reachable" : server.status === "slow" ? "Slow" : "Unreachable"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="xs" className="gap-1.5"><Icons.Activity size={11}/> Refresh</Button>
          <Tooltip content="Close"><Button variant="ghost" size="icon-sm" onClick={onClose}><Icons.X size={14}/></Button></Tooltip>
        </div>
      </div>

      {/* tabs */}
      <div className="h-10 flex-none flex items-stretch gap-0.5 px-4 border-b border-border">
        {tabs.map((tb) => {
          const active = tb.value === tab;
          return (
            <button
              key={tb.value} onClick={() => setTab(tb.value)}
              className={cn("relative inline-flex items-center px-3 text-[12.5px] transition-colors focus:outline-none",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {tb.label}
              {active && <span aria-hidden className="absolute left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground"/>}
            </button>
          );
        })}
      </div>

      {/* content */}
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "overview" && <SO_Overview server={server} totalServices={totalServices} totalMethods={totalMethods} protoLabel={protoLabel} q={q} setQ={setQ} onSelectMethod={onSelectMethod}/>}
        {tab === "auth" && <SO_Auth server={server}/>}
        {tab === "vars" && <SO_Vars server={server}/>}
      </div>
    </div>
  );
}

window.ServerOverview = ServerOverview;

/* ─────────── Collection overview (opened by clicking a collection name) ───────────
   A read-only summary of one collection's structure: the requests it holds
   (grouped by folder, recursively) with their method + target, each clickable to
   open. Shows only user data — no engine/auth/cache/connection indicators. */
const CO_VERB_CLASS = { GET: "text-ok", POST: "text-warn", PATCH: "text-purple-400", PUT: "text-stream", DELETE: "text-destructive" };
const CO_VERB_ABBR = { DELETE: "DEL" };
const CO_STREAM = { server: "↓", client: "↑", bidi: "↕" };

function coCount(n) { return n.type === "request" ? 1 : (n.children || []).reduce((a, c) => a + coCount(c), 0); }
function coTargets(n, D, acc) {
  if (n.type === "request") { const h = D.findServer(n.serverId)?.host; if (h) acc.add(h); }
  else (n.children || []).forEach((c) => coTargets(c, D, acc));
  return acc;
}

function CO_Marker({ def }) {
  if (def && (def.proto === "http" || def.verb)) {
    const v = def.verb || "GET";
    return <span className={cn("font-mono text-[9px] font-bold tabular-nums text-right", CO_VERB_CLASS[v] || CO_VERB_CLASS.GET)} style={{ width: 30 }}>{CO_VERB_ABBR[v] || v}</span>;
  }
  if (def && def.kind && def.kind !== "unary") return <span className="font-mono text-[11px] font-semibold text-stream/80 text-right leading-none" style={{ width: 30 }}>{CO_STREAM[def.kind]}</span>;
  return <span className="font-mono text-[11px] font-semibold text-stream/70 text-right leading-none" style={{ width: 30 }}>g</span>;
}

function CO_Rows({ nodes, depth, D, onSelectMethod }) {
  return nodes.map((n) => {
    if (n.type === "folder") {
      if (!(n.children || []).length) return null;
      return (
        <React.Fragment key={n.id}>
          <div className="flex items-center gap-2 h-7 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/55" style={{ paddingLeft: 12 + depth * 18 }}>
            <Icons.Folder size={11} className="text-muted-foreground/45"/>
            <span className="truncate">{n.name}</span>
            <span className="font-mono text-[9.5px] text-muted-foreground/35 normal-case">{coCount(n)}</span>
          </div>
          <CO_Rows nodes={n.children} depth={depth + 1} D={D} onSelectMethod={onSelectMethod}/>
        </React.Fragment>
      );
    }
    const def = D.findMethod(n.serverId, n.svc, n.mth);
    const target = D.findServer(n.serverId)?.host;
    const saved = !!n.name;
    const sig = def && (def.proto === "http" || def.verb) ? n.mth : `${n.svc}.${n.mth}`;
    return (
      <button
        key={n.id}
        onClick={() => onSelectMethod({ serverId: n.serverId, svc: n.svc, mth: n.mth, savedName: n.name })}
        className="group flex w-full items-center gap-2.5 h-9 pr-3 hover:bg-accent/50 transition-colors text-left border-b border-border/40"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        <CO_Marker def={def}/>
        <span className={cn("truncate text-[12.5px] text-foreground/90", saved ? "" : "font-mono")} style={{ maxWidth: "40%" }}>{saved ? n.name : n.mth}</span>
        {saved && <span className="font-mono text-[10.5px] text-muted-foreground/45 truncate hidden md:inline">{sig}</span>}
        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/45 truncate pl-3">{target}</span>
        <Icons.Send size={11} className="flex-none text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors"/>
      </button>
    );
  });
}

const CO_AUTH_TYPES = [
  { value: "none",   label: "No auth" },
  { value: "bearer", label: "Bearer token" },
  { value: "basic",  label: "Basic auth" },
  { value: "apikey", label: "API key" },
  { value: "mtls",   label: "Mutual TLS", disabled: true, hint: "Client certificates are configured in TLS settings." },
];

function CollectionOverview({ collection, onClose, onSelectMethod, onExport }) {
  const D = window.HS_DATA;
  const [tab, setTab] = React.useState("overview");
  const [confirm, setConfirm] = React.useState(false);
  if (!collection) return null;
  const total = coCount(collection);
  const targets = [...coTargets(collection, D, new Set())];
  const kids = collection.children || [];
  const vars = collection.variables || [];
  const envs = D.environments.map((e) => ({ id: e.name, name: e.name, color: e.color }));

  const tabs = [
    { value: "overview",  label: "Overview" },
    { value: "auth",      label: "Authorization" },
    { value: "variables", label: "Variables", hint: vars.length || null },
    { value: "settings",  label: "Settings" },
  ];

  return (
    <div key={collection.id} className="flex-1 flex flex-col min-h-0 min-w-0 bg-background relative z-10">
      {/* header — name (inline-edit) + composition summary + export */}
      <div className="h-12 flex-none flex items-center gap-3 px-4 border-b border-border bg-background/85 backdrop-blur-sm">
        <Icons.Layers size={15} className="text-muted-foreground flex-none"/>
        <CollectionTitle name={collection.name}/>
        <span className="text-[11.5px] text-muted-foreground/60 truncate">
          {total} {total === 1 ? "request" : "requests"} · {targets.length} {targets.length === 1 ? "target" : "targets"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="xs" className="gap-1.5" onClick={onExport}><Icons.Upload size={11}/> Export</Button>
          <Tooltip content="Close"><Button variant="ghost" size="icon-sm" onClick={onClose}><Icons.X size={14}/></Button></Tooltip>
        </div>
      </div>

      {/* tabs */}
      <COTabs value={tab} onChange={setTab} items={tabs}/>

      {/* body */}
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        <div className="max-w-[720px] mx-auto px-5 py-6">
          {tab === "overview" && (
            <div className="flex flex-col gap-7">
              {total === 0 && (
                <div className="flex items-center gap-3 rounded-md border border-dashed border-border/80 px-4 py-3.5">
                  <span className="text-muted-foreground/55 flex-none"><Icons.Layers size={16}/></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] text-foreground/85 font-medium">This collection has no requests yet</p>
                    <p className="text-[11.5px] text-muted-foreground/60">Add a request from any server — each request keeps its own target.</p>
                  </div>
                </div>
              )}
              <COBlock icon={<Icons.Beautify size={15}/>} title="Description"
                desc="What this collection is for — shown to anyone you share it with.">
                <DescriptionBlock text={collection.description || ""}/>
              </COBlock>
              {targets.length > 0 && (
                <COBlock icon={<Icons.Target size={15}/>} title="Targets"
                  desc="Servers this collection’s requests point at. Each saved request keeps its own target.">
                  <div className="flex flex-wrap gap-1.5">
                    {targets.map((h) => (
                      <span key={h} className="font-mono text-[11px] text-foreground/75 bg-card border border-border rounded px-2 py-1">{h}</span>
                    ))}
                  </div>
                </COBlock>
              )}
              {total > 0 && (
                <COBlock icon={<Icons.Bookmark size={15}/>} title="Requests"
                  desc="Saved requests and pinned methods in this collection. Click any row to open it.">
                  <div className="rounded-md border border-border overflow-hidden">
                    <CO_Rows nodes={kids} depth={0} D={D} onSelectMethod={onSelectMethod}/>
                  </div>
                </COBlock>
              )}
            </div>
          )}
          {tab === "auth" && (
            <COBlock icon={<Icons.Key size={15}/>} title="Authentication"
              desc="Credentials applied per environment. Configure each environment separately.">
              <AuthBlock environments={envs} authByEnv={collection.authByEnv || {}} authTypes={CO_AUTH_TYPES}/>
            </COBlock>
          )}
          {tab === "variables" && (
            <COBlock icon={<Icons.Braces size={15}/>} title="Variables"
              desc="Collection-wide key/value pairs, reusable as {{name}} inside requests.">
              <VariablesBlock rows={vars}/>
            </COBlock>
          )}
          {tab === "settings" && (
            <div className="flex flex-col gap-8">
              <COBlock icon={<Icons.Lock size={15}/>} title="TLS defaults"
                desc="The transport security new requests in this collection start with.">
                <TlsBlock tls={collection.tls || { enabled: true, skipVerify: false }}/>
              </COBlock>
              <div className="border-t border-border/70 pt-7">
                <COBlock icon={<Icons.AlertCircle size={15}/>} title="Delete collection" danger
                  desc="Permanently removes this collection and every request inside it. This can’t be undone.">
                  <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setConfirm(true)}>
                    <Icons.Trash size={13}/> Delete collection
                  </Button>
                </COBlock>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* delete confirm */}
      {confirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/50 animate-fade-in" onClick={() => setConfirm(false)}>
          <div className="w-full max-w-[420px] rounded-lg border border-border bg-popover shadow-xl animate-zoom-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1.5 px-5 pt-5">
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 rounded-full bg-destructive/10 text-destructive inline-flex items-center justify-center flex-none"><Icons.Trash size={15}/></span>
                <h2 className="text-[15px] font-semibold tracking-tight">Delete collection?</h2>
              </div>
              <p className="text-[12.5px] text-muted-foreground/80 leading-relaxed pt-1">
                This permanently deletes <span className="text-foreground font-medium">“{collection.name}”</span> and its {total} {total === 1 ? "request" : "requests"}. This action can’t be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 mt-3 border-t border-border bg-muted/20">
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => { setConfirm(false); onClose && onClose(); }}><Icons.Trash size={13}/> Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.CollectionOverview = CollectionOverview;
