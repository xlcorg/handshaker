// sidebar.jsx — collections-first navigation (Variant 1).
//
// Primary entity = collection. The tree is Collection → (recursive) Folder →
// Request. Each request carries its own target (resolved from its serverId), so
// one collection freely mixes servers. There is NO server level in the tree, and
// no engine/state indicators (auth/env/cache/connected) — only user structure.
//
// Rows are compact (h-22) with a Postman-style left type marker: quiet blue "g"
// for unary gRPC, a stream arrow for streaming, a coloured verb for HTTP. Hover
// ⋯ and right-click open the same menu; Delete is the only red item. Empty
// folders are pruned; empty collection and no-collections get explicit states.

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
const VERB_ABBR = { DELETE: "DEL" };

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

// Type gutter: colored HTTP verb only. gRPC methods carry no label. (Used by the
// Server browser — kept stable.)
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

// Sidebar request marker (left, Postman-style). gRPC is the default protocol so
// it stays quiet: blue "g" for unary, a stream arrow for streaming. HTTP stands
// out with a coloured verb (DELETE abbreviated). No method-signature hint.
function ReqTypeTag({ def }) {
  if (def && (def.proto === "http" || def.verb)) {
    const v = def.verb || "GET";
    return <span className={cn("font-mono text-[9px] font-bold tabular-nums", VERB_CLASS[v] || VERB_CLASS.GET)}>{VERB_ABBR[v] || v}</span>;
  }
  if (def && def.kind && def.kind !== "unary") {
    return <span className="font-mono text-[11px] font-semibold text-stream/80 leading-none" title={`${def.kind} streaming`}>{STREAM_ARROW[def.kind]}</span>;
  }
  return <span className="font-mono text-[11px] font-semibold text-stream/70 leading-none" title="gRPC unary">g</span>;
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

/* ── absolute hover ⋯ menu (also opens on right-click); Delete is the red item ── */
function RowMenu({ items, children, className, padRight = 28 }) {
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
    setCoords({ left: x, top: Math.min(e.clientY, window.innerHeight - 240) });
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
    <div className={cn("relative group/row", className)} onContextMenu={openAtCursor}>
      {children}
      <button
        ref={btnRef}
        onClick={openAtButton}
        style={{ right: padRight - 24 }}
        className={cn(
          "absolute top-1/2 -translate-y-1/2 z-10 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-[opacity,color,background-color] bg-background/85 backdrop-blur-sm",
          coords ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Icons.More size={13}/>
      </button>
      {coords && (
        <div
          ref={menuRef}
          className="fixed z-[200] min-w-[176px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in"
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
                "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm pl-2 pr-3 py-1.5 text-[13px] outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
                it.danger && "text-destructive hover:!text-destructive hover:!bg-destructive/10",
              )}
            >
              <span className="text-muted-foreground/80 flex-none [.text-destructive_&]:text-destructive">{it.icon}</span>
              {it.label}
              {it.kbd && <span className="ml-auto font-mono text-[10px] text-muted-foreground/45">{it.kbd}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── tree utilities ───────────────────────────── */
function countRequests(node) {
  if (node.type === "request") return 1;
  return (node.children || []).reduce((n, c) => n + countRequests(c), 0);
}
function allContainerIds(nodes, acc = []) {
  for (const n of nodes) {
    if (n.type !== "request") { acc.push(n.id); allContainerIds(n.children || [], acc); }
  }
  return acc;
}
// ids on the path to the selected request (auto-open on mount / reveal)
function pathToSelected(nodes, sel, trail = []) {
  if (!sel) return null;
  for (const n of nodes) {
    if (n.type === "request") {
      const saved = !!n.name;
      const hit = n.serverId === sel.serverId && n.svc === sel.svc && n.mth === sel.mth
        && (saved ? sel.savedName === n.name : !sel.savedName);
      if (hit) return trail;
    } else {
      const r = pathToSelected(n.children || [], sel, [...trail, n.id]);
      if (r) return r;
    }
  }
  return null;
}
// filter: keep matching requests; prune folders with no matches
function filterNode(node, q, D) {
  if (!q) return node;
  if (node.type === "request") {
    const def = D.findMethod(node.serverId, node.svc, node.mth);
    const target = D.findServer(node.serverId)?.host;
    const hay = [node.name, node.svc, node.mth, def?.verb, def?.svcShort, target].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q) ? node : null;
  }
  const kids = (node.children || []).map((c) => filterNode(c, q, D)).filter(Boolean);
  const selfMatch = node.type === "collection" && node.name.toLowerCase().includes(q);
  if (kids.length === 0 && !selfMatch) return null;
  return { ...node, children: kids.length ? kids : (selfMatch ? (node.children || []) : []) };
}

// build the { serverId, svc, mth, savedName } selection for a request node
function reqSel(req) {
  return { serverId: req.serverId, svc: req.svc, mth: req.mth, savedName: req.name };
}

/* ─────────── Sidebar shell (collections-first) ─────────── */
function Sidebar({ collections, selected, onSelect, onOpenCollection, onAddCollection, onAddServer, onImport, onExport, query, setQuery }) {
  const D = window.HS_DATA;
  const list = collections || [];

  // local removal (prototype): hide deleted collections / folders / requests by id
  const [removed, setRemoved] = useStateSB(() => new Set());
  const remove = (id) => setRemoved((s) => new Set(s).add(id));
  const pruneRemoved = (nodes) => nodes
    .filter((n) => !removed.has(n.id))
    .map((n) => n.type === "request" ? n : { ...n, children: pruneRemoved(n.children || []) });

  // open state — auto-open the path to the active request on mount
  const initialOpen = useMemoSB(() => {
    const s = new Set();
    const p = pathToSelected(list, selected);
    if (p) p.forEach((id) => s.add(id));
    else if (list[0]) s.add(list[0].id);
    return s;
  }, []);
  const [open, setOpen] = useStateSB(initialOpen);
  const toggle = (id) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // reveal active: open its path, then center it in the scroll area
  const scrollRef = useRefSB(null);
  const activeRef = useRefSB(null);
  const [revealKey, setRevealKey] = useStateSB(0);
  useEffectSB(() => {
    if (!revealKey) return;
    const c = scrollRef.current, r = activeRef.current;
    if (c && r) { const cr = c.getBoundingClientRect(), rr = r.getBoundingClientRect(); c.scrollTop += (rr.top - cr.top) - c.clientHeight / 2 + 14; }
  }, [revealKey]);
  const revealActive = () => {
    const p = pathToSelected(list, selected);
    if (!p) return;
    setOpen((o) => { const n = new Set(o); p.forEach((id) => n.add(id)); return n; });
    setTimeout(() => setRevealKey((k) => k + 1), 30);
  };

  const q = query.trim().toLowerCase();
  const shown = useMemoSB(
    () => pruneRemoved(list).map((c) => filterNode(c, q, D)).filter(Boolean),
    [list, q, removed],
  );

  // per-node menus — Delete is the only destructive (red) item everywhere
  const menuFor = (kind, node) => {
    if (kind === "collection") return [
      { icon: <Icons.Layers size={13}/>, label: "Open overview", onClick: () => onOpenCollection && onOpenCollection(node) },
      { sep: true },
      { icon: <Icons.Plus size={13}/>, label: "New request" },
      { icon: <Icons.Folder size={13}/>, label: "New folder" },
      { icon: <Icons.Pencil size={13}/>, label: "Rename", kbd: "F2" },
      { icon: <Icons.Copy size={13}/>, label: "Duplicate" },
      { sep: true },
      { icon: <Icons.Upload size={13}/>, label: "Export…", onClick: onExport },
      { sep: true },
      { icon: <Icons.Trash size={13}/>, label: "Delete", danger: true, onClick: () => remove(node.id) },
    ];
    if (kind === "folder") return [
      { icon: <Icons.Plus size={13}/>, label: "New request" },
      { icon: <Icons.Folder size={13}/>, label: "New folder" },
      { icon: <Icons.Pencil size={13}/>, label: "Rename", kbd: "F2" },
      { sep: true },
      { icon: <Icons.Trash size={13}/>, label: "Delete", danger: true, onClick: () => remove(node.id) },
    ];
    return [
      { icon: <Icons.Send size={13}/>, label: "Open", onClick: () => onSelect(reqSel(node)) },
      { icon: <Icons.Pencil size={13}/>, label: "Rename", kbd: "F2" },
      { icon: <Icons.Copy size={13}/>, label: "Duplicate" },
      { sep: true },
      { icon: <Icons.Trash size={13}/>, label: "Delete", danger: true, onClick: () => remove(node.id) },
    ];
  };

  const empty = pruneRemoved(list).length === 0;

  return (
    <SidebarShell>
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/80 pointer-events-none"><Icons.Filter size={12}/></span>
            <SidebarInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter collections & requests" className="pl-7"/>
          </div>
          <Tooltip content="New request">
            <Button variant="ghost" size="icon-sm" className="h-8 w-8 flex-none" onClick={onAddServer}><Icons.Plus size={15}/></Button>
          </Tooltip>
          <RowActions always triggerClassName="h-8 w-8" iconSize={15} items={[
            { icon: <Icons.Layers size={12}/>, label: "New collection", onClick: onAddCollection },
            { sep: true },
            { icon: <Icons.Target size={12}/>, label: "Reveal active request", onClick: revealActive },
            { icon: <Icons.Chevron size={12}/>, label: "Expand all", onClick: () => setOpen(new Set(allContainerIds(shown))) },
            { icon: <Icons.Collapse size={12}/>, label: "Collapse all", onClick: () => setOpen(new Set()) },
            { sep: true },
            { icon: <Icons.Download size={12}/>, label: "Import collection…", onClick: onImport },
            { icon: <Icons.Upload size={12}/>, label: "Export collection…", onClick: onExport },
          ]}/>
        </div>
      </SidebarHeader>
      <SidebarContent ref={scrollRef}>
        {empty ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 gap-3">
            <span className="h-10 w-10 rounded-lg border border-border/70 inline-flex items-center justify-center text-muted-foreground/60"><Icons.Layers size={18}/></span>
            <div className="space-y-1">
              <p className="text-[12.5px] font-medium text-foreground/90">No collections yet</p>
              <p className="text-[11.5px] text-muted-foreground/65 leading-relaxed text-balance">Collections hold your saved requests. Create one to start, or import an existing collection.</p>
            </div>
            <div className="flex flex-col gap-1.5 w-full pt-1">
              <Button size="sm" className="h-8 w-full gap-1.5" onClick={onAddCollection}><Icons.Plus size={13}/> New collection</Button>
              <Button variant="outline" size="sm" className="h-8 w-full gap-1.5" onClick={onImport}><Icons.Download size={13}/> Import collection…</Button>
            </div>
          </div>
        ) : (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {shown.length === 0 ? (
                  <div className="px-2 py-8 text-center text-[11.5px] text-muted-foreground/60">Nothing matches “{query}”.</div>
                ) : shown.map((c) => (
                  <CollectionNode key={c.id} node={c} open={open} toggle={toggle} q={q}
                    selected={selected} onSelect={onSelect} onOpenCollection={onOpenCollection} menuFor={menuFor} activeRef={activeRef}/>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </SidebarShell>
  );
}

/* ─────────── Collection (top level) ─────────── */
function CollectionNode({ node, open, toggle, q, selected, onSelect, onOpenCollection, menuFor, activeRef }) {
  const isOpen = q ? true : open.has(node.id);
  const total = countRequests(node);
  const kids = node.children || [];
  return (
    <SidebarMenuItem>
      <RowMenu items={menuFor("collection", node)}>
        <SidebarMenuButton onClick={() => onOpenCollection && onOpenCollection(node)} className="pl-6 pr-7 !h-[24px] !text-[12px]">
          <span className="truncate flex-1 text-foreground/80">{node.name}</span>
          <span className="font-mono text-[9.5px] text-muted-foreground/40 flex-none">{total || ""}</span>
        </SidebarMenuButton>
        <button
          onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
          aria-label={isOpen ? "Collapse" : "Expand"}
          aria-expanded={isOpen}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-10 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/55 hover:text-foreground hover:bg-accent/80 transition-colors"
        >
          <span className={cn("inline-flex transition-transform duration-150", isOpen && "rotate-90")}><Icons.Chevron size={12}/></span>
        </button>
      </RowMenu>
      {isOpen && (
        <SidebarMenuSub className="!ml-[9px] !pl-[7px]">
          {kids.length ? kids.map((c) => c.type === "folder"
            ? <FolderNode key={c.id} node={c} open={open} toggle={toggle} q={q} selected={selected} onSelect={onSelect} menuFor={menuFor} activeRef={activeRef}/>
            : <RequestRow key={c.id} req={c} selected={selected} onSelect={onSelect} menuFor={menuFor} activeRef={activeRef}/>)
            : (
              <div className="flex items-center gap-2 h-[22px] px-2 text-[11px] text-muted-foreground/45">
                <span>No requests yet</span>
                <button className="ml-auto inline-flex items-center gap-1 text-muted-foreground/65 hover:text-foreground transition-colors"><Icons.Plus size={11}/> Add</button>
              </div>
            )}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

/* ─────────── Folder (recursive) ─────────── */
function FolderNode({ node, open, toggle, q, selected, onSelect, menuFor, activeRef }) {
  const kids = node.children || [];
  if (kids.length === 0) return null;            // empty folders are hidden
  const isOpen = q ? true : open.has(node.id);
  return (
    <SidebarMenuSubItem>
      <RowMenu items={menuFor("folder", node)}>
        <SidebarMenuSubButton onClick={() => toggle(node.id)} className="pr-7 text-muted-foreground !gap-1 !h-[22px] !text-[11.5px]">
          <span className={cn("flex-none inline-flex text-muted-foreground/55 transition-transform duration-150", isOpen && "rotate-90")}><Icons.Chevron size={11}/></span>
          <Icons.Folder size={11} className="flex-none text-muted-foreground/55"/>
          <span className="truncate flex-1 text-left">{node.name}</span>
          <span className="font-mono text-[9.5px] text-muted-foreground/35 flex-none">{countRequests(node)}</span>
        </SidebarMenuSubButton>
      </RowMenu>
      {isOpen && (
        <SidebarMenuSub className="!ml-[9px] !pl-[7px]">
          {kids.map((c) => c.type === "folder"
            ? <FolderNode key={c.id} node={c} open={open} toggle={toggle} q={q} selected={selected} onSelect={onSelect} menuFor={menuFor} activeRef={activeRef}/>
            : <RequestRow key={c.id} req={c} selected={selected} onSelect={onSelect} menuFor={menuFor} activeRef={activeRef}/>)}
        </SidebarMenuSub>
      )}
    </SidebarMenuSubItem>
  );
}

/* ─────────── Request row ─────────── */
function RequestRow({ req, selected, onSelect, menuFor, activeRef }) {
  const D = window.HS_DATA;
  const def = D.findMethod(req.serverId, req.svc, req.mth);
  const target = D.findServer(req.serverId)?.host;
  const saved = !!req.name;
  const active = selected && selected.serverId === req.serverId && selected.svc === req.svc && selected.mth === req.mth
    && (saved ? selected.savedName === req.name : !selected.savedName);
  const label = saved ? req.name : req.mth;

  return (
    <SidebarMenuSubItem>
      <RowMenu items={menuFor("request", req)} padRight={28} className="[&>span]:!flex [&>span]:!w-full [&>span]:!min-w-0">
        <Tooltip side="right" content={
          <span className="font-mono text-[11px]">
            <span className="text-foreground">{def && (def.proto === "http" || def.verb) ? `${def.verb || "GET"} ${req.mth}` : `${req.svc}.${req.mth}`}</span>
            {target && <span className="block text-muted-foreground/70 mt-0.5">{target}</span>}
          </span>
        }>
          <SidebarMenuSubButton ref={active ? activeRef : null} isActive={active} onClick={() => onSelect(reqSel(req))} className="pr-7 relative !gap-1 !h-[22px] !text-[11.5px]">
            {active && <span className="absolute left-[-8px] top-0.5 bottom-0.5 w-[2px] rounded-full bg-foreground"/>}
            <span className="flex-none inline-flex"><ReqTypeTag def={def}/></span>
            <span className={cn("truncate flex-1 text-left", saved ? "font-sans" : "font-mono")}>{label}</span>
          </SidebarMenuSubButton>
        </Tooltip>
      </RowMenu>
    </SidebarMenuSubItem>
  );
}

Object.assign(window, { Sidebar, MethodVerb, MethodTag, ReqTypeTag, ServerStatus, verbOf });
