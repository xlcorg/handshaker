// sidebar.jsx — left navigation: services tree / history / collections (shadcn)

const { useState: useStateSB, useMemo: useMemoSB } = React;

function Sidebar({ tab, setTab, connected, services, history, collections, selected, onSelect, query, setQuery }) {
  return (
    <aside className="w-[260px] flex-none border-r border-border bg-background flex flex-col min-h-0">
      <div className="h-10 flex-none flex items-center justify-center gap-1.5 px-2 border-b border-border">
        <SideTab active={tab === "services"} onClick={() => setTab("services")} icon={<Icons.Layers size={15} />} label="Services" count={services.length} />
        <SideTab active={tab === "history"} onClick={() => setTab("history")} icon={<Icons.Clock size={15} />} label="History" count={history.length} />
        <SideTab active={tab === "collections"} onClick={() => setTab("collections")} icon={<Icons.Bookmark size={15} />} label="Saved" />
      </div>
      <div className="px-2.5 py-2 flex-none border-b border-border">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Icons.Search size={12} />
          </span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "services" ? "Filter services…" : tab === "history" ? "Filter history…" : "Filter saved…"}
            className="h-8 pl-7 pr-12 text-xs" />
          
          <span className="absolute right-2 top-1/2 -translate-y-1/2"><Kbd>⌘K</Kbd></span>
        </div>
      </div>
      <div className="flex-1 overflow-auto scroll-thin px-1.5 pt-1 pb-3">
        {tab === "services" && <ServicesPane services={services} connected={connected} selected={selected} onSelect={onSelect} query={query} />}
        {tab === "history" && <HistoryPane history={history} onSelect={onSelect} query={query} />}
        {tab === "collections" && <CollectionsPane collections={collections} onSelect={onSelect} query={query} />}
      </div>
    </aside>);

}

function SideTab({ active, onClick, icon, label, count }) {
  return (
    <Tooltip content={count !== undefined ? `${label} · ${count}` : label}>
      <button
        onClick={onClick}
        aria-label={label}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors relative",
          active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
        )}>
        {icon}
        {count !== undefined && count > 0 &&
        <span className={cn(
          "absolute -top-1 -right-1 h-3.5 min-w-[14px] px-1 rounded-full border border-background",
          "font-mono text-[9px] font-semibold tabular-nums flex items-center justify-center leading-none",
          active ? "bg-foreground text-background" : "bg-muted text-foreground/85"
        )}>{count}</span>
        }
      </button>
    </Tooltip>);

}

function ServicesPane({ services, connected, selected, onSelect, query }) {
  const [open, setOpen] = useStateSB(() => new Set(services.map((s) => s.name)));
  const toggle = (name) => {
    const next = new Set(open);
    next.has(name) ? next.delete(name) : next.add(name);
    setOpen(next);
  };
  const q = query.trim().toLowerCase();
  const filtered = q ?
  services.map((s) => ({ ...s, methods: s.methods.filter((m) => (s.short + "." + m.name).toLowerCase().includes(q)) })).filter((s) => s.methods.length > 0) :
  services;

  if (!connected) {
    return (
      <div className="px-3 py-6 text-xs text-muted-foreground leading-relaxed">
        <div className="text-foreground/70 text-xs mb-1.5">Not connected</div>
        <div>Connect to a host above and we'll discover services via gRPC reflection. Or import a .proto file.</div>
        <Button variant="outline" size="sm" className="mt-3 gap-1.5">
          <Icons.Upload size={12} /> Import .proto
        </Button>
      </div>);

  }

  return filtered.map((svc) =>
  <div key={svc.name} className="mb-0.5">
      <button
      onClick={() => toggle(svc.name)}
      className="group flex w-full items-center gap-2 rounded-md px-2 h-7 text-[12.5px] text-foreground/85 hover:bg-accent hover:text-foreground transition-colors">
      
        <span className={cn("transition-transform text-muted-foreground", open.has(svc.name) && "rotate-90")}>
          <Icons.Chevron size={10} />
        </span>
        <Icons.Cube size={12} className="text-muted-foreground" />
        <span className="truncate flex-1 text-left" title={svc.name}>{svc.short}</span>
      </button>
      {open.has(svc.name) && svc.methods.map((m) => {
      const active = selected && selected.svc === svc.short && selected.mth === m.name;
      return (
        <button
          key={m.name}
          onClick={() => onSelect({ svc: svc.short, mth: m.name, kind: m.kind })}
          className={cn(
            "flex w-full items-center gap-2 rounded-md pl-8 pr-2 h-7 font-mono text-[11.5px] transition-colors",
            active ? "bg-accent text-foreground" : "text-foreground/75 hover:bg-accent/60 hover:text-foreground"
          )}>
          
            <span className="truncate flex-1 text-left">{m.name}</span>
            <MethodPill kind={m.kind} />
          </button>);

    })}
    </div>
  );
}

function MethodPill({ kind }) {
  const colors = {
    unary: "text-muted-foreground bg-muted",
    server: "text-stream bg-stream/10",
    client: "text-warn bg-warn/10",
    bidi: "text-purple-400 bg-purple-400/10"
  };
  const label = kind === "unary" ? "U" : kind === "server" ? "S→" : kind === "client" ? "→C" : "↔";
  return (
    <span className={cn(
      "inline-flex items-center font-mono font-semibold text-[9.5px] tracking-wider px-1.5 py-px rounded",
      colors[kind] || colors.unary
    )}>{label}</span>);

}

function HistoryPane({ history, onSelect, query }) {
  const q = query.trim().toLowerCase();
  const list = q ? history.filter((h) => (h.svc + "." + h.mth).toLowerCase().includes(q)) : history;
  return (
    <>
      <div className="flex items-center justify-between px-2 pt-2.5 pb-1 label-cap">
        <span>Today</span>
      </div>
      {list.map((h, i) =>
      <button
        key={i}
        onClick={() => onSelect({ svc: h.svc, mth: h.mth })}
        className="flex w-full flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-accent transition-colors text-left">
        
          <div className="flex items-center gap-2 text-xs">
            <span className={cn(
            "h-1.5 w-1.5 rounded-full flex-none",
            h.st === "ok" && "bg-ok",
            h.st === "err" && "bg-destructive",
            h.st === "stream" && "bg-stream"
          )} />
            <span className="font-mono text-[11.5px] text-foreground/85 truncate flex-1">{h.svc}.{h.mth}</span>
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">{h.lat}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground pl-3.5">
            <span className="font-mono">{h.ts}</span>
            <span>·</span>
            <span>{h.env}</span>
          </div>
        </button>
      )}
    </>);

}

function CollectionsPane({ collections, onSelect, query }) {
  const [open, setOpen] = useStateSB(() => new Set(collections.map((c) => c.name)));
  const q = query.trim().toLowerCase();
  return (
    <>
      <div className="flex items-center justify-between px-2 pt-2.5 pb-1 label-cap">
        <span>Collections</span>
        <button className="h-4 w-4 rounded inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
          <Icons.Plus size={11} />
        </button>
      </div>
      {collections.map((c) => {
        const items = q ? c.items.filter((it) => (it.svc + "." + it.mth).toLowerCase().includes(q)) : c.items;
        if (q && items.length === 0) return null;
        const isOpen = open.has(c.name);
        return (
          <div key={c.name} className="mb-1">
            <button
              onClick={() => {const n = new Set(open);n.has(c.name) ? n.delete(c.name) : n.add(c.name);setOpen(n);}}
              className="flex w-full items-center gap-2 rounded-md px-2 h-7 text-[12.5px] text-foreground/85 hover:bg-accent hover:text-foreground transition-colors">
              
              <span className={cn("transition-transform text-muted-foreground", isOpen && "rotate-90")}>
                <Icons.Chevron size={10} />
              </span>
              <Icons.Folder size={12} className="text-muted-foreground" />
              <span className="truncate flex-1 text-left">{c.name}</span>
              <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">{c.items.length}</span>
            </button>
            {isOpen && items.map((it, i) =>
            <button
              key={i}
              onClick={() => onSelect({ svc: it.svc, mth: it.mth })}
              className="flex w-full items-center gap-2 rounded-md pl-8 pr-2 h-7 font-mono text-[11.5px] text-foreground/75 hover:bg-accent/60 hover:text-foreground transition-colors">
              
                <span className="truncate flex-1 text-left">{it.svc}.{it.mth}</span>
              </button>
            )}
          </div>);

      })}
    </>);

}

Object.assign(window, { Sidebar });