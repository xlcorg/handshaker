// collection-overview.jsx — interactive Collection Overview panel (Variant A:
// single scroll column of setting blocks). Built on the app's shadcn primitives.
//
// Honors the brief's hard constraints:
//  · shows only user data — no cache/connection/inheritance indicators;
//  · no streaming / OAuth-flow / folder-level variables;
//  · auth secrets are referenced by environment-variable NAME (never raw);
//  · inline-editable name; editable variables table; TLS default + skip-verify
//    (skip-verify only enabled when TLS is on); per-env auth with one method
//    disabled; a single red Delete with confirm dialog.

const { useState: useCO, useRef: useCORef, useEffect: useCOEff } = React;

/* ── tab bar (mirrors the app's UnderlineTabs, with optional count hint) ── */
function COTabs({ value, onChange, items }) {
  return (
    <div className="flex-none flex items-stretch gap-0.5 h-9 px-3 border-b border-border bg-card/40">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button key={it.value} onClick={() => onChange(it.value)}
            className={cn("relative inline-flex items-center gap-1.5 px-2.5 text-[12.5px] transition-colors focus:outline-none",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <span>{it.label}</span>
            {it.hint != null && (
              <span className={cn("font-mono text-[10px] tabular-nums rounded px-1 py-px",
                active ? "bg-accent text-muted-foreground" : "text-muted-foreground/55")}>{it.hint}</span>
            )}
            {active && (
              <span aria-hidden className="absolute left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground"/>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── in-tab block heading (no separators — tabs already partition) ── */
function COBlock({ icon, title, desc, action, children, danger }) {
  return (
    <section>
      <div className="flex items-start gap-3 mb-3.5">
        <span className={cn("mt-0.5 flex-none", danger ? "text-destructive/80" : "text-muted-foreground/70")}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className={cn("text-[13px] font-semibold tracking-tight", danger ? "text-destructive" : "text-foreground")}>{title}</h3>
          {desc && <p className="text-[12px] text-muted-foreground/70 leading-relaxed mt-0.5 text-pretty">{desc}</p>}
        </div>
        {action}
      </div>
      <div className="pl-[27px]">{children}</div>
    </section>
  );
}

/* ── description block (Postman Overview hallmark) — view / edit / empty ── */
function DescriptionBlock({ text }) {
  const [val, setVal] = useCO(text || "");
  const [edit, setEdit] = useCO(false);
  const [draft, setDraft] = useCO(text || "");
  const ref = useCORef(null);
  useCOEff(() => { if (edit && ref.current) ref.current.focus(); }, [edit]);

  if (edit) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setDraft(val); setEdit(false); } }}
          placeholder="Describe what this collection is for. Markdown supported."
          className="w-full min-h-[104px] rounded-md border border-input bg-background px-3 py-2 text-[12.5px] leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/55"
        />
        <div className="flex items-center gap-2">
          <Button size="xs" onClick={() => { setVal(draft); setEdit(false); }}>Save</Button>
          <Button variant="ghost" size="xs" onClick={() => { setDraft(val); setEdit(false); }}>Cancel</Button>
          <span className="ml-auto text-[10.5px] text-muted-foreground/45">Esc to cancel</span>
        </div>
      </div>
    );
  }
  if (!val) {
    return (
      <button onClick={() => { setDraft(""); setEdit(true); }}
        className="w-full rounded-md border border-dashed border-border/80 px-4 py-5 text-left hover:border-border hover:bg-accent/30 transition-colors group/desc">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground/70 group-hover/desc:text-foreground/80">
          <Icons.Plus size={12}/> Add a description
        </span>
        <p className="text-[11px] text-muted-foreground/45 mt-0.5">Explain what the collection covers, conventions, required variables…</p>
      </button>
    );
  }
  return (
    <div className="group/desc relative">
      <p className="text-[12.5px] text-foreground/80 leading-relaxed whitespace-pre-wrap text-pretty pr-8">{val}</p>
      <Tooltip content="Edit description">
        <button onClick={() => { setDraft(val); setEdit(true); }} aria-label="Edit description"
          className="absolute top-0 right-0 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/45 hover:text-foreground hover:bg-accent opacity-0 group-hover/desc:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color]">
          <Icons.Pencil size={12}/>
        </button>
      </Tooltip>
    </div>
  );
}

/* ── env-variable reference field — value is a VARIABLE NAME, not a secret ── */
function EnvVarField({ label, value, placeholder = "ENV_VAR_NAME" }) {
  const [v, setV] = useCO(value || "");
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[11.5px] text-muted-foreground/80">{label}</span>
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground/45 pointer-events-none select-none">{"{}"}</span>
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder}
          className="h-8 pl-7 font-mono text-[12px] tracking-tight"/>
      </div>
    </label>
  );
}

/* ── mini Select (DropdownMenu-based) with disabled options ── */
function MiniSelect({ value, onChange, options, className }) {
  const [open, setOpen] = useCO(false);
  const cur = options.find((o) => o.value === value);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className={cn("inline-flex items-center justify-between gap-2 h-8 rounded-md border border-input bg-background px-2.5 text-[12.5px] hover:bg-accent/50 transition-colors", className)}>
          <span className="truncate">{cur?.label || "Select…"}</span>
          <Icons.ChevronDown size={13} className="opacity-50 flex-none"/>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--w,200px)] min-w-[180px]">
        {options.map((o) => o.disabled ? (
          <Tooltip key={o.value} side="right" content={o.hint}>
            <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12.5px] text-muted-foreground/40 cursor-not-allowed select-none">
              <span className="flex-1">{o.label}</span>
              <Icons.Lock size={11} className="opacity-70"/>
            </div>
          </Tooltip>
        ) : (
          <DropdownMenuItem key={o.value} onClick={() => { onChange(o.value); setOpen(false); }} className={cn(o.value === value && "bg-accent")}>
            <span className="flex-1 text-left">{o.label}</span>
            {o.value === value && <Icons.Check size={13}/>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── variables table ── */
function VariablesBlock({ rows: initial }) {
  const [rows, setRows] = useCO(initial || []);
  const add = () => setRows((r) => [...r, { id: "n" + Math.random().toString(36).slice(2, 7), k: "", v: "" }]);
  const upd = (id, key, val) => setRows((r) => r.map((x) => x.id === id ? { ...x, [key]: val } : x));
  const del = (id) => setRows((r) => r.filter((x) => x.id !== id));

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="w-full rounded-md border border-dashed border-border/80 px-4 py-6 text-center">
          <p className="text-[12px] text-muted-foreground/65">No collection variables yet.</p>
          <p className="text-[11px] text-muted-foreground/45 mt-0.5">Reusable values like base URLs or IDs — referenced as <span className="font-mono">{"{{name}}"}</span> in requests.</p>
        </div>
        <Button variant="outline" size="xs" className="gap-1.5" onClick={add}><Icons.Plus size={12}/> Add variable</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_1.4fr_28px] gap-2 px-1 pb-0.5">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/50">Name</span>
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/50">Value</span>
        <span/>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="group/var grid grid-cols-[1fr_1.4fr_28px] gap-2 items-center">
          <Input value={row.k} onChange={(e) => upd(row.id, "k", e.target.value)} placeholder="name"
            className="h-8 font-mono text-[12px]"/>
          <Input value={row.v} onChange={(e) => upd(row.id, "v", e.target.value)} placeholder="value"
            className="h-8 font-mono text-[12px]"/>
          <Tooltip content="Remove">
            <button onClick={() => del(row.id)} aria-label="Remove variable"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground/45 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/var:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color]">
              <Icons.Trash size={13}/>
            </button>
          </Tooltip>
        </div>
      ))}
      <div className="pt-1">
        <Button variant="ghost" size="xs" className="gap-1.5 text-muted-foreground hover:text-foreground -ml-1.5" onClick={add}><Icons.Plus size={12}/> Add variable</Button>
      </div>
    </div>
  );
}

/* ── TLS block — skip-verify only enabled when TLS is on ── */
function TlsBlock({ tls: initial }) {
  const [tls, setTls] = useCO(initial?.enabled ?? true);
  const [skip, setSkip] = useCO(initial?.skipVerify ?? false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Switch checked={tls} onCheckedChange={setTls}/>
        <div className="min-w-0">
          <div className="text-[12.5px] text-foreground/90">Use TLS by default</div>
          <div className="text-[11.5px] text-muted-foreground/60">New requests in this collection start with TLS enabled.</div>
        </div>
      </div>

      <div className={cn("flex items-center gap-3 pl-1 transition-opacity", !tls && "opacity-40 pointer-events-none select-none")}>
        <Switch checked={tls && skip} onCheckedChange={setSkip} disabled={!tls}/>
        <div className="min-w-0">
          <div className="text-[12.5px] text-foreground/90 flex items-center gap-1.5">
            Skip certificate verification
          </div>
          <div className="text-[11.5px] text-muted-foreground/60">
            {tls ? "Accept self-signed or mismatched certs." : "Enable TLS to configure verification."}
          </div>
        </div>
      </div>

      {tls && skip && (
        <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 ml-1">
          <span className="text-warn mt-0.5 flex-none"><Icons.AlertCircle size={13}/></span>
          <p className="text-[11.5px] text-warn/90 leading-relaxed">Connections won’t validate server certificates. Use only for local or trusted endpoints.</p>
        </div>
      )}
    </div>
  );
}

/* ── per-environment auth block ── */
function AuthBlock({ environments, authByEnv, authTypes }) {
  const [envId, setEnvId] = useCO(environments[0].id);
  const [byEnv, setByEnv] = useCO(() => JSON.parse(JSON.stringify(authByEnv)));
  const cur = byEnv[envId] || { type: "none" };
  const setType = (t) => setByEnv((m) => ({ ...m, [envId]: { ...m[envId], type: t } }));

  return (
    <div className="flex flex-col gap-4">
      {/* environment selector */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[11.5px] text-muted-foreground/80">Environment</span>
        <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 gap-0.5">
          {environments.map((e) => (
            <button key={e.id} onClick={() => setEnvId(e.id)}
              className={cn("inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11.5px] transition-colors",
                envId === e.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }}/>
              {e.name}
            </button>
          ))}
        </div>
      </div>

      {/* method */}
      <div className="flex items-center gap-2.5">
        <span className="text-[11.5px] text-muted-foreground/80 w-[68px] flex-none">Method</span>
        <MiniSelect value={cur.type} onChange={setType} options={authTypes} className="w-[200px]"/>
      </div>

      {/* editor */}
      <div className="rounded-md border border-border/70 bg-muted/20 p-3.5">
        {cur.type === "none" && (
          <p className="text-[12px] text-muted-foreground/55">No authentication for <span className="text-foreground/80">{envId}</span>. Requests are sent without credentials.</p>
        )}
        {cur.type === "bearer" && (
          <EnvVarField label="Token" value={cur.bearer?.tokenVar} placeholder="BEARER_TOKEN_VAR"/>
        )}
        {cur.type === "basic" && (
          <div className="grid grid-cols-2 gap-3">
            <EnvVarField label="Username" value={cur.basic?.userVar} placeholder="BASIC_USER_VAR"/>
            <EnvVarField label="Password" value={cur.basic?.passVar} placeholder="BASIC_PASS_VAR"/>
          </div>
        )}
        {cur.type === "apikey" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] text-muted-foreground/80">Header name</span>
              <Input defaultValue="x-api-key" className="h-8 font-mono text-[12px]"/>
            </label>
            <EnvVarField label="Value" value={cur.apikey?.valueVar} placeholder="API_KEY_VAR"/>
          </div>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground/55 leading-relaxed">
        <span className="mt-0.5 flex-none"><Icons.Key size={11}/></span>
        Secrets are referenced by environment-variable name. The value itself lives in the selected environment — never stored in the collection.
      </p>
    </div>
  );
}

/* ── inline-editable title ── */
function CollectionTitle({ name, editing, onStartEdit }) {
  const [val, setVal] = useCO(name);
  const [isEdit, setEdit] = useCO(!!editing);
  const ref = useCORef(null);
  useCOEff(() => { if (isEdit && ref.current) { ref.current.focus(); ref.current.select(); } }, [isEdit]);
  const commit = () => setEdit(false);
  const cancel = () => { setVal(name); setEdit(false); };

  if (isEdit) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Input ref={ref} value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
          className="h-7 text-[14px] font-semibold w-[260px] px-2"/>
        <Tooltip content="Save (↵)"><Button size="icon-sm" className="h-7 w-7" onClick={commit}><Icons.Check size={14}/></Button></Tooltip>
        <Tooltip content="Cancel (Esc)"><Button variant="ghost" size="icon-sm" className="h-7 w-7" onClick={cancel}><Icons.X size={14}/></Button></Tooltip>
      </div>
    );
  }
  return (
    <button onClick={() => setEdit(true)} className="group/title inline-flex items-center gap-1.5 min-w-0 rounded px-1 -ml-1 h-7 hover:bg-accent/50 transition-colors">
      <span className="text-[14px] font-semibold tracking-tight truncate">{val}</span>
      <Icons.Pencil size={12} className="flex-none text-muted-foreground/0 group-hover/title:text-muted-foreground/60 transition-colors"/>
    </button>
  );
}

/* ── Overview tab — description + targets + (empty hint) ── */
function COOverviewTab({ col, empty, targets }) {
  return (
    <div className="flex flex-col gap-7">
      {empty && (
        <div className="flex items-center gap-3 rounded-md border border-dashed border-border/80 px-4 py-3.5">
          <span className="text-muted-foreground/55 flex-none"><Icons.Layers size={16}/></span>
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] text-foreground/85 font-medium">This collection has no requests yet</p>
            <p className="text-[11.5px] text-muted-foreground/60">Add a request from any server — each request keeps its own target.</p>
          </div>
          <Button size="xs" className="gap-1.5 flex-none"><Icons.Plus size={12}/> Add request</Button>
        </div>
      )}

      <COBlock icon={<Icons.Beautify size={15}/>} title="Description"
        desc="What this collection is for — shown to anyone you share it with.">
        <DescriptionBlock text={empty ? "" : col.description}/>
      </COBlock>

      {targets.length > 0 && (
        <COBlock icon={<Icons.Target size={15}/>} title="Targets"
          desc="Servers this collection’s requests point at. Each saved request keeps its own target.">
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t) => (
              <span key={t} className="font-mono text-[11px] text-foreground/75 bg-card border border-border rounded px-2 py-1">{t}</span>
            ))}
          </div>
        </COBlock>
      )}
    </div>
  );
}

/* ── Settings tab — TLS defaults + danger zone ── */
function COSettingsTab({ col, onDelete }) {
  return (
    <div className="flex flex-col gap-8">
      <COBlock icon={<Icons.Lock size={15}/>} title="TLS defaults"
        desc="The transport security new requests in this collection start with.">
        <TlsBlock tls={col.tls}/>
      </COBlock>

      <div className="border-t border-border/70 pt-7">
        <COBlock icon={<Icons.AlertCircle size={15}/>} title="Delete collection" danger
          desc="Permanently removes this collection and every request inside it. This can’t be undone.">
          <Button variant="destructive" size="sm" className="gap-1.5" onClick={onDelete}>
            <Icons.Trash size={13}/> Delete collection
          </Button>
        </COBlock>
      </div>
    </div>
  );
}

/* ── the panel — tabbed (Variant B): Overview · Authorization · Variables · Settings ── */
function CollectionOverviewPanel({ data, empty, editingName, confirmOpen, initialTab = "overview", height = 600, onClose }) {
  const col = data.collection;
  const reqs = empty ? 0 : col.requests;
  const folders = empty ? 0 : col.folders;
  const targets = empty ? [] : col.targets;
  const vars = empty ? [] : col.variables;
  const [tab, setTab] = useCO(initialTab);
  const [confirm, setConfirm] = useCO(!!confirmOpen);

  const tabs = [
    { value: "overview",  label: "Overview" },
    { value: "auth",      label: "Authorization" },
    { value: "variables", label: "Variables", hint: vars.length || null },
    { value: "settings",  label: "Settings" },
  ];

  return (
    <div className="relative flex flex-col bg-background overflow-hidden" style={{ height }}>
      {/* header — name (inline-edit) + composition summary + export */}
      <div className="flex-none flex items-center gap-3 px-4 h-12 border-b border-border bg-background/85 backdrop-blur-sm">
        <span className="text-muted-foreground/70 flex-none"><Icons.Layers size={15}/></span>
        <CollectionTitle name={col.name} editing={editingName}/>
        <span className="text-[11.5px] text-muted-foreground/55 truncate">
          {folders} {folders === 1 ? "folder" : "folders"} · {reqs} {reqs === 1 ? "request" : "requests"}
        </span>
        <span className="flex-1"/>
        <Button variant="outline" size="xs" className="gap-1.5"><Icons.Upload size={11}/> Export</Button>
        <Tooltip content="Close"><Button variant="ghost" size="icon-sm" onClick={onClose}><Icons.X size={14}/></Button></Tooltip>
      </div>

      {/* tabs */}
      <COTabs value={tab} onChange={setTab} items={tabs}/>

      {/* tab body */}
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        <div className="max-w-[680px] mx-auto px-5 py-6">
          {tab === "overview" && <COOverviewTab col={col} empty={empty} targets={targets}/>}
          {tab === "auth" && (
            <COBlock icon={<Icons.Key size={15}/>} title="Authentication"
              desc="Credentials applied per environment. Configure each environment separately.">
              <AuthBlock environments={data.environments} authByEnv={col.authByEnv} authTypes={data.authTypes}/>
            </COBlock>
          )}
          {tab === "variables" && (
            <COBlock icon={<Icons.Braces size={15}/>} title="Variables"
              desc="Collection-wide key/value pairs, reusable as {{name}} inside requests.">
              <VariablesBlock rows={vars}/>
            </COBlock>
          )}
          {tab === "settings" && <COSettingsTab col={col} onDelete={() => setConfirm(true)}/>}
        </div>
      </div>

      {/* delete confirm — overlaid within the panel so it reads inside the window */}
      {confirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/50 animate-fade-in" onClick={() => setConfirm(false)}>
          <div className="w-full max-w-[420px] rounded-lg border border-border bg-popover shadow-xl animate-zoom-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1.5 px-5 pt-5">
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 rounded-full bg-destructive/10 text-destructive inline-flex items-center justify-center flex-none"><Icons.Trash size={15}/></span>
                <h2 className="text-[15px] font-semibold tracking-tight">Delete collection?</h2>
              </div>
              <p className="text-[12.5px] text-muted-foreground/80 leading-relaxed pt-1">
                This permanently deletes <span className="text-foreground font-medium">“{col.name}”</span> and its {reqs} {reqs === 1 ? "request" : "requests"}. This action can’t be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 mt-3 border-t border-border bg-muted/20">
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setConfirm(false)}><Icons.Trash size={13}/> Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, {
  CollectionOverviewPanel,
  COTabs, COBlock, CollectionTitle, DescriptionBlock,
  VariablesBlock, TlsBlock, AuthBlock, EnvVarField, MiniSelect,
});
