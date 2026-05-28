// panels.jsx — request + response panels (shadcn)

const { useState: useStateP } = React;

/* ─────────── Tokenizer ─────────── */
function tokenize(line) {
  let out = line.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  out = out.replace(/(&quot;|")(.*?)(&quot;|")(\s*:)/g, '<span class="tok-key">"$2"</span>$4');
  out = out.replace(/(:\s*)(&quot;|")(.*?)(&quot;|")/g, '$1<span class="tok-str">"$3"</span>');
  out = out.replace(/\{\{(\w+)\}\}/g, '<span class="tok-num">{{$1}}</span>');
  out = out.replace(/\b(true|false|null)\b/g, '<span class="tok-bool">$1</span>');
  out = out.replace(/(:\s*)(-?\d+(\.\d+)?)/g, '$1<span class="tok-num">$2</span>');
  out = out.replace(/([{}\[\],])/g, '<span class="tok-punct">$1</span>');
  return out;
}

function CodeView({ lines, startLine = 1 }) {
  return (
    <div className="flex-1 min-h-0 overflow-auto scroll-thin font-mono text-[12.5px] leading-relaxed pt-2.5 pb-6">
      {lines.map((row, i) => (
        <div key={i} className="flex items-start px-4">
          <div className="w-7 flex-none text-right pr-3.5 text-muted-foreground select-none tabular-nums">{startLine + i}</div>
          <div className="flex-1 text-foreground whitespace-pre" dangerouslySetInnerHTML={{__html: tokenize(row.ln)}}/>
        </div>
      ))}
    </div>
  );
}

/* ─────────── Underline tabs (Linear/Vercel-style) ─────────── */
function UnderlineTabs({ value, onChange, items }) {
  return (
    <div className="self-stretch flex items-stretch gap-0.5">
      {items.map(it => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-2.5 text-[12.5px] transition-colors focus:outline-none",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{it.label}</span>
            {it.hint != null && (
              <span className={cn(
                "font-mono text-[10px] tabular-nums",
                active ? "text-muted-foreground" : "text-muted-foreground/60",
              )}>{it.hint}</span>
            )}
            <span
              aria-hidden
              className={cn(
                "absolute left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/* ─────────── Request panel ─────────── */
function RequestPanel({ selected, body, requestTab, setRequestTab, auth }) {
  if (!selected) {
    return (
      <Pane>
        <EmptyState
          icon={<Icons.Send size={18}/>}
          title="Select a method to begin"
          desc={<>Pick a service in the sidebar, or paste a method path like <Kbd className="mx-0.5">NotesService.Create</Kbd> into the command palette.</>}
        />
      </Pane>
    );
  }

  return (
    <Pane>
      <PaneHead>
        <UnderlineTabs
          value={requestTab}
          onChange={setRequestTab}
          items={[
            { value: "body", label: "Body" },
            { value: "metadata", label: "Metadata", hint: "3" },
            { value: "auth", label: "Auth", hint: auth?.kind ?? "none" },
          ]}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Beautify"><Button variant="ghost" size="icon-sm"><Icons.Beautify size={14}/></Button></Tooltip>
          <Tooltip content="Word wrap"><Button variant="ghost" size="icon-sm"><Icons.Wrap size={14}/></Button></Tooltip>
          <Tooltip content="Copy"><Button variant="ghost" size="icon-sm"><Icons.Copy size={14}/></Button></Tooltip>
        </div>
      </PaneHead>
      {requestTab === "body" && <CodeView lines={body}/>}
      {requestTab === "metadata" && <MetadataView/>}
      {requestTab === "auth" && <AuthInline auth={auth}/>}
    </Pane>
  );
}

/* ─────────── Method picker (Postman-style) ─────────── */
function MethodPicker({ selected, services, onSelect, className, maxLabel = 180 }) {
  const [open, setOpen] = useStateP(false);
  const [q, setQ] = useStateP("");
  const inputRef = React.useRef(null);

  React.useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 10); }, [open]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return services;
    return services
      .map(s => ({ ...s, methods: s.methods.filter(m => (s.short + "." + m.name).toLowerCase().includes(needle)) }))
      .filter(s => s.methods.length > 0);
  }, [q, services]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "group inline-flex items-center gap-2 h-7 px-2 -ml-1.5 rounded-md transition-colors font-mono text-xs",
            "hover:bg-accent",
            open && "bg-accent",
            className,
          )}
        >
          <Icons.Cube size={12} className="text-muted-foreground flex-none"/>
          <span className="text-muted-foreground truncate" style={{maxWidth: maxLabel}}>{selected.svc}</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="text-foreground font-medium truncate" style={{maxWidth: maxLabel}}>{selected.mth}</span>
          {selected.kind && selected.kind !== "unary" && (
            <Badge variant="secondary" className="ml-1 font-mono text-[10px] gap-1 px-1.5 py-0 flex-none">
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                selected.kind === "server" && "bg-stream",
                selected.kind === "client" && "bg-warn",
                selected.kind === "bidi" && "bg-purple-400",
              )}/>
              {selected.kind === "server" ? "stream" : selected.kind === "client" ? "client" : "bidi"}
            </Badge>
          )}
          <Icons.ChevronDown size={11} className="text-muted-foreground/70 ml-0.5 flex-none"/>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[420px] p-0 overflow-hidden">
        <div className="relative border-b border-border">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Icons.Search size={13}/>
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            placeholder="Find service.method…"
            className="w-full h-10 pl-9 pr-3 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2"><Kbd>esc</Kbd></span>
        </div>
        <div className="max-h-[360px] overflow-auto scroll-thin py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">No methods match "{q}"</div>
          ) : filtered.map(s => (
            <div key={s.name} className="pb-1">
              <div className="px-3 pt-2 pb-1 label-cap flex items-center gap-1.5">
                <Icons.Cube size={11} className="opacity-60"/>
                <span className="truncate">{s.name}</span>
              </div>
              {s.methods.map(m => {
                const active = selected.svc === s.short && selected.mth === m.name;
                return (
                  <button
                    key={m.name}
                    onClick={() => { onSelect({ svc: s.short, mth: m.name, kind: m.kind }); setOpen(false); setQ(""); }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 pl-8 h-7 font-mono text-xs transition-colors text-left",
                      active ? "bg-accent text-foreground" : "text-foreground/85 hover:bg-accent/60",
                    )}
                  >
                    <span className="truncate flex-1">{m.name}</span>
                    <span className="text-[10px] text-muted-foreground">{m.req} → {m.res}</span>
                    <MethodKindDot kind={m.kind}/>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MethodKindDot({ kind }) {
  const colors = {
    unary:  "bg-muted-foreground/50",
    server: "bg-stream",
    client: "bg-warn",
    bidi:   "bg-purple-400",
  };
  return <span className={cn("h-1.5 w-1.5 rounded-full flex-none", colors[kind] || colors.unary)}/>;
}

function MetadataView() {
  const rows = [
    { k: "x-request-id", v: "{{requestId}}", varStr: true },
    { k: "x-tenant", v: "acme-eu" },
    { k: "x-locale", v: "en-US" },
  ];
  return (
    <div className="p-3.5">
      <div className="rounded-md border border-border overflow-hidden bg-card">
        <div className="grid grid-cols-[1fr_1.6fr_28px] border-b border-border bg-muted/30">
          <div className="px-3 py-1.5 label-cap">Key</div>
          <div className="px-3 py-1.5 label-cap">Value</div>
          <div/>
        </div>
        {rows.map((r,i)=>(
          <div key={i} className="grid grid-cols-[1fr_1.6fr_28px] border-b border-border/60 last:border-0">
            <div className="px-3 h-8 flex items-center font-mono text-xs">{r.k}</div>
            <div className={cn("px-3 h-8 flex items-center font-mono text-xs", r.varStr && "text-[var(--syntax-num)]")}>{r.v}</div>
            <div className="flex items-center justify-center">
              <Button variant="ghost" size="icon-sm" className="h-6 w-6 text-muted-foreground hover:text-destructive">
                <Icons.Trash size={11}/>
              </Button>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_1.6fr_28px]">
          <div className="px-3 h-8 flex items-center text-xs text-muted-foreground">Add key…</div>
          <div/>
          <div className="flex items-center justify-center text-muted-foreground"><Icons.Plus size={11}/></div>
        </div>
      </div>
    </div>
  );
}

function AuthInline({ auth }) {
  const [tab, setTab] = useStateP(auth?.kind || "bearer");
  return (
    <div className="p-4 grid gap-4 overflow-auto scroll-thin">
      <ToggleGroup value={tab} onValueChange={setTab} options={[
        { value: "none", label: "None" },
        { value: "bearer", label: "Bearer" },
        { value: "basic", label: "Basic" },
        { value: "mtls", label: "mTLS" },
        { value: "api", label: "API key" },
      ]}/>
      {tab === "bearer" && (
        <>
          <Field label="Token"><FieldDisplay mono><span className="text-[var(--syntax-num)]">{"{{accessToken}}"}</span></FieldDisplay></Field>
          <Field label="Metadata key"><FieldDisplay mono>authorization</FieldDisplay></Field>
          <Field label="Prefix"><FieldDisplay mono>Bearer </FieldDisplay></Field>
        </>
      )}
      {tab === "basic" && (
        <>
          <Field label="Username"><FieldDisplay mono>alice</FieldDisplay></Field>
          <Field label="Password"><FieldDisplay mono><span className="text-[var(--syntax-num)]">{"{{password}}"}</span></FieldDisplay></Field>
        </>
      )}
      {tab === "api" && (
        <>
          <Field label="Header name"><FieldDisplay mono>x-api-key</FieldDisplay></Field>
          <Field label="Value"><FieldDisplay mono><span className="text-[var(--syntax-num)]">{"{{apiKey}}"}</span></FieldDisplay></Field>
        </>
      )}
      {tab === "mtls" && (
        <>
          <Field label="Client certificate">
            <CertZone name="client.crt" desc="CN=handshaker-dev · expires 2027-02-11"/>
          </Field>
          <Field label="Client key">
            <CertZone name="client.key" desc="PKCS#8, 2048-bit RSA"/>
          </Field>
          <Field label="Root CA (optional)">
            <CertZone empty desc="Drop ca.pem or click to choose"/>
          </Field>
        </>
      )}
      {tab === "none" && (
        <div className="text-xs text-muted-foreground py-1">No authentication will be attached to this request.</div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function FieldDisplay({ mono, children }) {
  return <div className={cn("h-9 px-3 rounded-md border border-input bg-background flex items-center text-sm", mono && "font-mono text-[12.5px]")}>{children}</div>;
}
function CertZone({ name, desc, empty }) {
  return (
    <div className={cn(
      "flex items-center gap-3 p-3.5 rounded-md border bg-card",
      empty ? "border-dashed border-border" : "border-border",
    )}>
      <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground">
        {empty ? <Icons.Upload size={14}/> : <Icons.Key size={14}/>}
      </div>
      <div className="flex-1 min-w-0">
        {name && <div className="font-mono text-xs text-foreground">{name}</div>}
        <div className={cn("text-[11px] text-muted-foreground", name && "mt-0.5")}>{desc}</div>
      </div>
      {!empty && <Button variant="outline" size="xs">Replace</Button>}
    </div>
  );
}

/* ─────────── Response panel ─────────── */
function ResponsePanel({ state, responseTab, setResponseTab, body, trailers, streamFrames, error, latency, size, onCancel }) {
  return (
    <Pane>
      <PaneHead>
        <UnderlineTabs
          value={responseTab}
          onChange={setResponseTab}
          items={[
            { value: "body", label: "Body" },
            { value: "trailers", label: "Trailers", hint: trailers.length },
            { value: "headers", label: "Headers", hint: 3 },
          ]}
        />
        <div className="ml-auto flex items-center gap-2.5">
          {state === "streaming" && (
            <Button variant="outline" size="xs" onClick={onCancel} className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Icons.Stop size={11}/> Cancel
            </Button>
          )}
          <RespMeta state={state} latency={latency} size={size} error={error} streamCount={streamFrames?.length}/>
        </div>
      </PaneHead>
      {state === "idle" && <EmptyState icon={<Icons.Activity size={18}/>} title="Awaiting first call" desc="Hit Send to invoke. Response body, trailers and timing will appear here."/>}
      {state === "sending" && <EmptyState icon={<span className="spinner" style={{width:18,height:18}}/>} title="Sending request…" desc="Establishing channel and serializing message."/>}
      {state === "success" && responseTab === "body" && <CodeView lines={body}/>}
      {state === "success" && responseTab === "trailers" && <KVTable rows={trailers}/>}
      {state === "success" && responseTab === "headers" && <KVTable rows={SAMPLE_HEADERS}/>}
      {state === "error" && responseTab === "body" && <ErrorBody error={error}/>}
      {state === "error" && responseTab === "trailers" && <KVTable rows={[...trailers.slice(0,2), { k:"grpc-status", v:"16 (UNAUTHENTICATED)" }, { k:"grpc-message", v:"missing bearer token" }]}/>}
      {state === "error" && responseTab === "headers" && <KVTable rows={SAMPLE_HEADERS}/>}
      {state === "streaming" && <StreamView frames={streamFrames}/>}
    </Pane>
  );
}

const SAMPLE_HEADERS = [
  { k: "content-type", v: "application/grpc" },
  { k: "x-server-version", v: "notex 3.14.0" },
  { k: "date", v: "Thu, 28 May 2026 14:32:08 GMT" },
];

function RespMeta({ state, latency, size, error, streamCount }) {
  if (state === "idle") return <span className="text-xs text-muted-foreground">No response yet</span>;
  if (state === "sending") return <span className="text-xs text-muted-foreground">awaiting…</span>;
  const base = "flex items-center gap-2 font-mono text-[11.5px]";
  if (state === "streaming") return (
    <span className={base}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-stream pulse-dot"/>
        <span className="text-foreground font-medium">STREAMING</span>
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{streamCount}</span>
      <span className="text-muted-foreground">frames</span>
    </span>
  );
  if (state === "error") return (
    <span className={base}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive"/>
        <span className="text-foreground font-medium">{error?.code || "ERROR"}</span>
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{latency}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{size}</span>
    </span>
  );
  return (
    <span className={base}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-ok"/>
        <span className="text-foreground font-medium">OK</span>
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{latency}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{size}</span>
    </span>
  );
}

function ErrorBody({ error }) {
  const lines = [
    { ln: "{" },
    { ln: `  "code": "${error?.code || "UNKNOWN"}",` },
    { ln: `  "message": "${error?.message || "Unknown error"}",` },
    { ln: '  "details": []' },
    { ln: "}" },
  ];
  return (
    <>
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-destructive/5 text-destructive text-xs">
        <Icons.AlertCircle size={14}/>
        <span className="font-mono">{error?.code}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground/85">{error?.message}</span>
      </div>
      <CodeView lines={lines}/>
    </>
  );
}

function KVTable({ rows }) {
  return (
    <div className="flex-1 overflow-auto scroll-thin">
      {rows.map((r,i)=>(
        <div key={i} className="grid grid-cols-[200px_1fr] border-b border-border/60 font-mono text-[11.5px]">
          <div className="px-4 py-2 text-[var(--syntax-key)]">{r.k}</div>
          <div className="px-4 py-2 text-foreground">{r.v}</div>
        </div>
      ))}
    </div>
  );
}

function StreamView({ frames }) {
  if (frames.length === 0) {
    return <EmptyState icon={<Icons.Activity size={18}/>} title="Stream open — awaiting frames"/>;
  }
  return (
    <div className="flex-1 min-h-0 overflow-auto scroll-thin py-1.5">
      {frames.map((f, i) => (
        <div key={i} className="px-4 py-2 border-b border-border/60 font-mono text-[11.5px] hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground mb-1">
            <span>←</span>
            <span className="text-foreground/85 font-medium">frame #{i+1}</span>
            <span>· {f.size}B</span>
            <span className="ml-auto">+{f.t}ms</span>
          </div>
          <div className="text-foreground" dangerouslySetInnerHTML={{__html: tokenize(f.body)}}/>
        </div>
      ))}
    </div>
  );
}

/* ─────────── pane primitives ─────────── */
function Pane({ children }) {
  return <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative">{children}</div>;
}
function PaneHead({ children }) {
  return <div className="h-10 flex-none flex items-center gap-2.5 px-3.5 border-b border-border relative z-10 bg-background/85 backdrop-blur-sm">{children}</div>;
}
function PaneTitle({ children }) {
  return <div className="font-mono text-xs flex items-center gap-1.5 min-w-0 text-muted-foreground">{children}</div>;
}
function EmptyState({ icon, title, desc }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3.5 p-10 text-center relative z-10">
      <div className="h-10 w-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground bg-card">
        {icon}
      </div>
      <div className="text-foreground/85 text-sm font-medium">{title}</div>
      {desc && <div className="text-xs text-muted-foreground max-w-[340px] leading-relaxed">{desc}</div>}
    </div>
  );
}

Object.assign(window, { RequestPanel, ResponsePanel, CodeView, MethodPicker, tokenize });
