// sidebar.jsx — single Collection · servers-first tree (Variant A)
//
// Collapsed by default (only the active server opens). Each server shows
// "pinned · available". Header carries Collapse-all + an overflow menu
// (reveal active / expand all / import / export). Rows expose hover ⋯ actions.
// Method type tag shows ONLY a stream arrow (gRPC) or an HTTP verb — no
// repeated "gRPC" noise. Saved requests get a stream-colored left edge.

const { useState: useStateSB, useMemo: useMemoSB, useRef: useRefSB, useEffect: useEffectSB } = React;

const VERB_CLASS = {
  gRPC:   "text-foreground/55",
  GET:    "text-ok",
  POST:   "text-warn",
  PATCH:  "text-purple-400",
  PUT:    "text-stream",
  DELETE: "text-destructive",
};
const STREAM_ARROW = { server: "↓", client: "↑", bidi: "↕" };

function verbOf(def) {
  if (!def) return { v: "gRPC" };
  if (def.proto === "http" || def.verb) return { v: def.verb || "GET" };
  return { v: "gRPC", stream: def.kind && def.kind !== "unary" ? def.kind : null };
}

// compact label used by the Server browser filter button
function MethodVerb({ v = "gRPC", stream, width }) {
  return (
    <span
      className={cn("font-mono text-[9px] font-bold tracking-wide flex-none tabular-nums", VERB_CLASS[v] || VERB_CLASS.gRPC)}
      style={width ? { width, display: "inline-flex", alignItems: "center" } : undefined}
    >
      {v}{stream && <span className="ml-0.5 text-purple-400">{STREAM_ARROW[stream]}</span>}
    </span>
  );
}

// Type gutter: colored HTTP verb only. gRPC methods carry no label.
function MethodTag({ def }) {
  if (def && (def.proto === "http" || def.verb)) {
    const v = def.verb || "GET";
    return <span className={cn("font-mono text-[9px] font-bold tracking-wide flex-none text-left", VERB_CLASS[v] || VERB_CLASS.GET)} style={{ width: 34 }}>{v}</span>;
  }
  return null;
}

function ServerStatus({ status }) {
  if (status === "ok") return null;
  return (
    <Tooltip content={status === "slow" ? "Slow — high latency" : "Unreachable"}>
      <span className={cn("flex-none", status === "slow" ? "text-warn" : "text-destructive")}>
        <Icons.AlertCircle size={11}/>
      </span>
    </Tooltip>
  );
}

function availableCount(srv) {
  return srv.reflection?.methods ?? srv.services.reduce((n, s) => n + s.methods.length, 0);
}

/* ── hover row actions (⋯ menu); stays visible while its menu is open ── */
function RowActions({ items, always, triggerClassName, iconSize = 13 }) {
  const [open, setOpen] = useStateSB(false);
  return (
    <span className={cn("flex-none transition-opacity", (always || open) ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button className={cn("h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors", triggerClassName)}>
            <Icons.More size={iconSize}/>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {items.map((it, i) => it.sep ? <DropdownMenuSeparator key={i}/> : (
            <DropdownMenuItem
              key={i}
              onClick={(e) => { e.stopPropagation(); it.onClick && it.onClick(); setOpen(false); }}
              className={cn(it.danger && "text-destructive hover:!text-destructive focus:!text-destructive hover:!bg-destructive/10 focus:!bg-destructive/10")}
            >
              {it.icon}{it.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/* ── absolute hover ⋯ menu for server/method rows (delete, etc.) ── */
function RowMenu({ items, children }) {
  const [coords, setCoords] = useStateSB(null); // null | { left?, right?, top }
  const btnRef = useRefSB(null);
  const menuRef = useRefSB(null);

  const openAtButton = (e) => {
    e.stopPropagation(); e.preventDefault();
    const r = btnRef.current.getBoundingClientRect();
    setCoords({ right: window.innerWidth - r.right, top: r.bottom + 4 });
  };
  const openAtCursor = (e) => {
    e.preventDefault(); e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 184);
    setCoords({ left: x, top: e.clientY });
  };

  useEffectSB(() => {
    if (!coords) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setCoords(null); };
    const onKey = (e) => { if (e.key === "Escape") setCoords(null); };
    const onScroll = () => setCoords(null);
    const id = setTimeout(() => document.addEventListener("pointerdown", onDown, true), 0);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [coords]);

  const posStyle = coords ? (coords.right != null ? { right: coords.right, top: coords.top } : { left: coords.left, top: coords.top }) : null;

  return (
    <div className="relative group/row" onContextMenu={openAtCursor}>
      {children}
      <button
        ref={btnRef}
        onClick={openAtButton}
        className={cn(
          "absolute right-1 top-1/2 -translate-y-1/2 z-10 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-[opacity,color,background-color] bg-background/85 backdrop-blur-sm",
          coords ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Icons.More size={13}/>
      </button>
      {coords && (
        <div
          ref={menuRef}
          className="fixed z-[200] min-w-[168px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in"
          style={posStyle}
          onContextMenu={(e) => e.preventDefault()}
        >
          {items.map((it, i) => it.sep ? (
            <div key={i} className="-mx-1 my-1 h-px bg-border"/>
          ) : (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); it.onClick && it.onClick(); setCoords(null); }}
              className={cn(
                "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
                it.danger && "text-destructive hover:!text-destructive hover:!bg-destructive/10",
              )}
            >
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Sidebar shell ─────────── */
function Sidebar({ collection, selected, onSelect, onBrowseServer, onOpenServer, onAddServer, onImport, onExport, query, setQuery }) {
  const D = window.HS_DATA;
  const servers = collection.servers || [];

  // local removal state (prototype): hide deleted servers / methods
  const [removed, setRemoved] = useStateSB({ servers: new Set(), items: new Set() });
  const itemKey = (svId, it) => `${svId}|${it.svc}|${it.mth}|${it.type === "saved" ? it.name : ""}`;
  const isServerRemoved = (svId) => removed.servers.has(svId);
  const isItemRemoved = (svId, it) => removed.items.has(itemKey(svId, it));
  const removeServer = (svId) => setRemoved((r) => ({ servers: new Set(r.servers).add(svId), items: r.items }));
  const removeItem = (svId, it) => setRemoved((r) => ({ servers: r.servers, items: new Set(r.items).add(itemKey(svId, it)) }));
  const del = { isItemRemoved, removeItem, removeServer };

  const allIds = () => {
    const s = new Set();
    servers.forEach((sv) => { s.add(sv.id); (sv.folders || []).forEach((f) => s.add(`${sv.id}:${f.id}`)); });
    return s;
  };
  const folderOf = (sv, sel) => (sv.folders || []).find((f) => f.items.some((it) => it.svc === sel.svc && it.mth === sel.mth));

  // collapsed by default — open only the active server (+ its active folder)
  const initialOpen = useMemoSB(() => {
    const s = new Set();
    if (selected) {
      const sv = servers.find((x) => x.id === selected.serverId);
      if (sv) { s.add(sv.id); const f = folderOf(sv, selected); if (f) s.add(`${sv.id}:${f.id}`); }
    }
    return s;
  }, []);
  const [open, setOpen] = useStateSB(initialOpen);
  const toggle = (k) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); setOpen(n); };

  // reveal active: open its server/folder, then center it in the scroll area
  const scrollRef = useRefSB(null);
  const activeRef = useRefSB(null);
  const [revealKey, setRevealKey] = useStateSB(0);
  useEffectSB(() => {
    if (!revealKey) return;
    const c = scrollRef.current, r = activeRef.current;
    if (c && r) { const cr = c.getBoundingClientRect(), rr = r.getBoundingClientRect(); c.scrollTop += (rr.top - cr.top) - c.clientHeight / 2 + 14; }
  }, [revealKey]);
  const revealActive = () => {
    if (!selected) return;
    const sv = servers.find((x) => x.id === selected.serverId);
    const n = new Set(open);
    if (sv) { n.add(sv.id); const f = folderOf(sv, selected); if (f) n.add(`${sv.id}:${f.id}`); }
    setOpen(n);
    setTimeout(() => setRevealKey((k) => k + 1), 30);
  };

  const q = query.trim().toLowerCase();
  const matchItem = (it, srv) => {
    if (!q) return true;
    const def = D.findMethod(srv.id, it.svc, it.mth);
    const hay = [it.name, it.svc, it.mth, def?.svcShort, def?.svcName].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  };
  const visibleServers = servers.filter((sv) => {
    if (isServerRemoved(sv.id)) return false;
    if (!q) return true;
    const all = [...(sv.folders || []).flatMap((f) => f.items), ...(sv.loose || [])];
    const srvName = (D.findServer(sv.id)?.name || "").toLowerCase();
    return srvName.includes(q) || all.some((it) => matchItem(it, sv));
  });

  return (
    <SidebarShell>
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/80 pointer-events-none"><Icons.Filter size={12}/></span>
            <SidebarInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" className="pl-7"/>
          </div>
          <Tooltip content="Add server">
            <Button variant="ghost" size="icon-sm" className="h-8 w-8 flex-none" onClick={onAddServer}><Icons.Plus size={15}/></Button>
          </Tooltip>
          <RowActions always triggerClassName="h-8 w-8" iconSize={15} items={[
            { icon: <Icons.Target size={12}/>, label: "Reveal active method", onClick: revealActive },
            { icon: <Icons.Chevron size={12}/>, label: "Expand all", onClick: () => setOpen(allIds()) },
            { icon: <Icons.Collapse size={12}/>, label: "Collapse all", onClick: () => setOpen(new Set()) },
            { sep: true },
            { icon: <Icons.Download size={12}/>, label: "Import collection…", onClick: onImport },
            { icon: <Icons.Upload size={12}/>, label: "Export collection…", onClick: onExport },
          ]}/>
        </div>
      </SidebarHeader>
      <SidebarContent ref={scrollRef}>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleServers.length === 0 ? (
                <div className="px-2 py-8 text-center text-xs text-muted-foreground">No collections or methods match “{query}”.</div>
              ) : visibleServers.map((sv) => (
                <ServerNode
                  key={sv.id} sv={sv} open={open} toggle={toggle}
                  selected={selected} onSelect={onSelect} onBrowseServer={onBrowseServer} onOpenServer={onOpenServer}
                  q={q} matchItem={matchItem} activeRef={activeRef} del={del}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Button variant="outline" size="sm" className="w-full h-8" onClick={onAddServer}>Add server</Button>
      </SidebarFooter>
    </SidebarShell>
  );
}

/* ─────────── Collection (server) ─────────── */
function ServerNode({ sv, open, toggle, selected, onSelect, onBrowseServer, onOpenServer, q, matchItem, activeRef, del }) {
  const D = window.HS_DATA;
  const srv = D.findServer(sv.id);
  if (!srv) return null;
  const isOpen = q ? true : open.has(sv.id);

  return (
    <SidebarMenuItem>
      <RowMenu items={[
        { icon: <Icons.Trash size={12}/>, label: "Delete", danger: true, onClick: () => del.removeServer(sv.id) },
      ]}>
        <SidebarMenuButton className="pr-7" onClick={() => { toggle(sv.id); onOpenServer && onOpenServer(sv.id); }}>
          <span className="truncate font-medium">{srv.name}</span>
        </SidebarMenuButton>
      </RowMenu>
      {isOpen && (
        <SidebarMenuSub>
          {(sv.folders || []).map((fld) => (
            <FolderNode
              key={fld.id} sv={sv} fld={fld} open={open} toggle={toggle}
              selected={selected} onSelect={onSelect} q={q} matchItem={matchItem} activeRef={activeRef} del={del}
            />
          ))}
          {(sv.loose || []).filter((it) => matchItem(it, sv) && !del.isItemRemoved(sv.id, it)).map((it, i) => (
            <ItemRow key={i} it={it} sv={sv} selected={selected} onSelect={onSelect} activeRef={activeRef} del={del}/>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

/* ─────────── Folder ─────────── */
function FolderNode({ sv, fld, open, toggle, selected, onSelect, q, matchItem, activeRef, del }) {
  const key = `${sv.id}:${fld.id}`;
  const items = fld.items.filter((it) => matchItem(it, sv) && !del.isItemRemoved(sv.id, it));
  if (items.length === 0) return null;
  const isOpen = q ? true : open.has(key);
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton className="text-muted-foreground" onClick={() => toggle(key)}>
        <span className="truncate">{fld.name}</span>
      </SidebarMenuSubButton>
      {isOpen && (
        <SidebarMenuSub>
          {items.map((it, i) => (
            <ItemRow key={i} it={it} sv={sv} selected={selected} onSelect={onSelect} activeRef={activeRef} del={del}/>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuSubItem>
  );
}

/* ─────────── Method / Saved-request row ─────────── */
function ItemRow({ it, sv, selected, onSelect, activeRef, del }) {
  const D = window.HS_DATA;
  const def = D.findMethod(sv.id, it.svc, it.mth);
  const saved = it.type === "saved";
  const active = selected && selected.serverId === sv.id && selected.svc === it.svc && selected.mth === it.mth
    && (!saved || selected.savedName === it.name);

  const select = () => onSelect({ serverId: sv.id, svc: it.svc, mth: it.mth, savedName: saved ? it.name : undefined });

  return (
    <SidebarMenuSubItem>
      <RowMenu items={[
        { icon: <Icons.Trash size={12}/>, label: "Delete", danger: true, onClick: () => del.removeItem(sv.id, it) },
      ]}>
        <SidebarMenuSubButton ref={active ? activeRef : null} isActive={active} onClick={select} className="font-mono pr-7">
          <MethodTag def={def}/>
          <span className="truncate flex-1 text-left">{saved ? it.name : it.mth}</span>
        </SidebarMenuSubButton>
      </RowMenu>
    </SidebarMenuSubItem>
  );
}

Object.assign(window, { Sidebar, MethodVerb, MethodTag, ServerStatus, verbOf });
