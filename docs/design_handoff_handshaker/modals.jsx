// modals.jsx — Environment + Settings dialogs (shadcn)

const { useState: useStateM } = React;

function EnvironmentModal({ open, onClose, initial }) {
  const [name, setName] = useStateM(initial?.name ?? "prod");
  const [vars, setVars] = useStateM(initial?.vars ?? [
    { k: "host", v: "api.example.com" },
    { k: "userId", v: "01HX9CV2K8…" },
    { k: "accessToken", v: "{{vault:prod-token}}" },
  ]);

  return (
    <Dialog open={open} onOpenChange={(v)=>!v && onClose()}>
      <DialogContent className="overflow-hidden" style={{ display: "flex", flexDirection: "column", width: "60rem", maxWidth: "calc(100vw - 2rem)", height: "660px", maxHeight: "calc(100vh - 2rem)" }}>
        <DialogHeader className="flex-none">
          <DialogTitle>{initial ? "Edit environment" : "New environment"}</DialogTitle>
          <DialogDescription>
            Variables inject into request bodies, metadata and the host field as <code className="font-mono text-[var(--syntax-num)] px-1 rounded bg-muted text-[11.5px]">{"{{name}}"}</code>.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-2 flex-1 min-h-0">
          <div className="grid gap-2">
            <Label htmlFor="env-name" className="text-xs">Name</Label>
            <Input id="env-name" value={name} onChange={(e)=>setName(e.target.value)} placeholder="prod" className="font-mono h-9"/>
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">Variables</Label>
            <div className="rounded-md border border-border overflow-hidden bg-card">
              <div className="grid grid-cols-[1fr_1.6fr_36px] border-b border-border bg-muted/30">
                <div className="px-3 py-1.5 label-cap">Key</div>
                <div className="px-3 py-1.5 label-cap">Value</div>
                <div/>
              </div>
              {vars.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1.6fr_36px] border-b border-border/60 last:border-0">
                  <div className="px-3 h-9 flex items-center">
                    <input className="w-full bg-transparent font-mono text-xs focus:outline-none placeholder:text-muted-foreground" value={row.k} onChange={(e)=>{
                      const n = [...vars]; n[i] = {...n[i], k: e.target.value}; setVars(n);
                    }}/>
                  </div>
                  <div className="px-3 h-9 flex items-center">
                    <input className="w-full bg-transparent font-mono text-xs focus:outline-none placeholder:text-muted-foreground" value={row.v} onChange={(e)=>{
                      const n = [...vars]; n[i] = {...n[i], v: e.target.value}; setVars(n);
                    }}/>
                  </div>
                  <div className="flex items-center justify-center">
                    <Button variant="ghost" size="icon-sm" onClick={()=> setVars(vars.filter((_,j)=>j!==i))} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                      <Icons.Trash size={11}/>
                    </Button>
                  </div>
                </div>
              ))}
              <button onClick={()=> setVars([...vars, {k:"", v:""}])} className="grid grid-cols-[1fr_1.6fr_36px] w-full hover:bg-accent/40 transition-colors text-left">
                <div className="px-3 h-9 flex items-center text-xs text-muted-foreground">Add variable</div>
                <div/>
                <div className="flex items-center justify-center text-muted-foreground"><Icons.Plus size={11}/></div>
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Secrets prefixed with <span className="text-[var(--syntax-num)] font-mono">{"{{vault:…}}"}</span> are read from the system keychain at request time.
            </div>
          </div>
        </DialogBody>
        <DialogFooter className="flex-none">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onClose}>{initial ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────── Settings ─────────── */
function SettingsModal({ open, onClose, t, setTweak }) {
  const [section, setSection] = useStateM("appearance");
  return (
    <Dialog open={open} onOpenChange={(v)=>!v && onClose()}>
      <DialogContent className="p-0 overflow-hidden" style={{ display: "flex", flexDirection: "column", width: "52rem", maxWidth: "calc(100vw - 2rem)", height: "640px", maxHeight: "calc(100vh - 2rem)" }}>
        <DialogHeader className="border-b border-border pb-4 flex-none">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Preferences sync across workspaces. Restart not required.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[200px_1fr] flex-1 min-h-0">
          <div className="border-r border-border p-2 flex flex-col gap-0.5 bg-muted/20 overflow-auto scroll-thin">
            {[
              ["appearance","Appearance"],
              ["editor","Editor"],
              ["network","Network"],
              ["proto","Proto sources"],
              ["keyboard","Keyboard"],
              ["data","Data & sync"],
              ["about","About"],
            ].map(([k,l]) => (
              <button
                key={k}
                onClick={()=>setSection(k)}
                className={cn(
                  "h-8 px-2.5 rounded-md text-left text-xs transition-colors",
                  section===k ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >{l}</button>
            ))}
          </div>
          <div className="p-5 overflow-auto scroll-thin flex flex-col gap-5">
            {section === "appearance" && <AppearancePane t={t} setTweak={setTweak}/>}
            {section === "editor" && <EditorPane/>}
            {section === "network" && <NetworkPane/>}
            {section === "proto" && <ProtoPane/>}
            {section === "keyboard" && <KeyboardPane/>}
            {section === "data" && <DataPane/>}
            {section === "about" && <AboutPane/>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsGroup({ title, children }) {
  return (
    <div className="grid gap-2.5">
      <h3 className="text-xs font-semibold text-foreground/85 tracking-wide">{title}</h3>
      {children}
    </div>
  );
}
function SettingsRow({ title, hint, control }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border/60 last:border-0">
      <div className="grid gap-0.5">
        <div className="text-[12.5px] text-foreground">{title}</div>
        {hint && <div className="text-[11.5px] text-muted-foreground leading-snug">{hint}</div>}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}

function AppearancePane({ t, setTweak }) {
  const accents = ["#fafafa","#7ec8e3","#9ab9d9","#c2a3e3","#e5c07a","#6cd697","#f0a08a"];
  return (
    <>
      <SettingsGroup title="Theme">
        <SettingsRow
          title="Mode" hint="Dark, light, or sync with system."
          control={<ToggleGroup value={t.theme} onValueChange={(v)=>setTweak('theme',v)} options={["dark","light"]}/>}
        />
        <SettingsRow
          title="Accent" hint="Used for primary buttons and active states."
          control={<div className="flex items-center gap-1.5">
            {accents.map(c => (
              <button key={c} onClick={()=>setTweak('accent', c)}
                style={{background:c}}
                className={cn(
                  "h-5 w-5 rounded-md ring-offset-background transition-all",
                  t.accent===c ? "ring-2 ring-ring ring-offset-2" : "ring-1 ring-border",
                )}
              />
            ))}
          </div>}
        />
        <SettingsRow
          title="Density" hint="Row height and padding across the app."
          control={<ToggleGroup value={t.density} onValueChange={(v)=>setTweak('density',v)} options={["compact","regular","cozy"]}/>}
        />
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <SettingsRow title="Sidebar" hint="Show services, history and saved collections."
          control={<Switch checked={t.sidebar} onCheckedChange={(v)=>setTweak('sidebar', v)}/>}
        />
        <SettingsRow title="Split direction" hint="Request and response orientation."
          control={<ToggleGroup value={t.split} onValueChange={(v)=>setTweak('split', v)} options={[
            { value: "horizontal", label: "Top / Bottom" },
            { value: "vertical", label: "Left / Right" },
          ]}/>}
        />
        <SettingsRow title="Dotted background" hint="Subtle grid that reacts to cursor."
          control={<Switch checked={t.dots} onCheckedChange={(v)=>setTweak('dots', v)}/>}
        />
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <SettingsRow title="Interface font" hint="Used everywhere except code editors."
          control={<ToggleGroup value={t.fontUi} onValueChange={(v)=>setTweak('fontUi', v)} options={["inter","geist","system"]}/>}
        />
        <SettingsRow title="Mono font" hint="Used in editors, code and metadata."
          control={<ToggleGroup value={t.fontMono} onValueChange={(v)=>setTweak('fontMono', v)} options={[
            { value: "jetbrains", label: "JetBrains" },
            { value: "geist-mono", label: "Geist" },
            { value: "ibm", label: "IBM Plex" },
          ]}/>}
        />
      </SettingsGroup>
    </>
  );
}

function EditorPane() {
  return (
    <>
      <SettingsGroup title="JSON editor">
        <SettingsRow title="Format on save" hint="Run prettier before each Send." control={<Switch checked onCheckedChange={()=>{}}/>}/>
        <SettingsRow title="Show line numbers" control={<Switch checked onCheckedChange={()=>{}}/>}/>
        <SettingsRow title="Wrap long lines" control={<Switch checked={false} onCheckedChange={()=>{}}/>}/>
        <SettingsRow title="Tab size" control={<ToggleGroup value="4" onValueChange={()=>{}} options={["2","4","8"]}/>}/>
      </SettingsGroup>
      <SettingsGroup title="Validation">
        <SettingsRow title="Validate against proto" hint="Show inline errors for unknown fields." control={<Switch checked onCheckedChange={()=>{}}/>}/>
        <SettingsRow title="Autocomplete from descriptors" control={<Switch checked onCheckedChange={()=>{}}/>}/>
      </SettingsGroup>
    </>
  );
}

function NetworkPane() {
  return (
    <>
      <SettingsGroup title="Timeouts">
        <SettingsRow title="Connection timeout" control={<Input value="10s" readOnly className="w-24 h-8 font-mono text-xs"/>}/>
        <SettingsRow title="Request deadline" control={<Input value="30s" readOnly className="w-24 h-8 font-mono text-xs"/>}/>
        <SettingsRow title="Keep-alive ping" control={<Input value="20s" readOnly className="w-24 h-8 font-mono text-xs"/>}/>
      </SettingsGroup>
      <SettingsGroup title="TLS">
        <SettingsRow title="Verify server certificate" hint="Disable for self-signed certs in dev." control={<Switch checked onCheckedChange={()=>{}}/>}/>
        <SettingsRow title="ALPN negotiation" control={<ToggleGroup value="h2" onValueChange={()=>{}} options={["h2","h2c"]}/>}/>
      </SettingsGroup>
      <SettingsGroup title="Proxy">
        <SettingsRow title="HTTP proxy" control={<span className="text-xs text-muted-foreground">Not configured</span>}/>
      </SettingsGroup>
    </>
  );
}

function ProtoPane() {
  return (
    <>
      <SettingsGroup title="Proto descriptors">
        <p className="text-xs text-muted-foreground leading-relaxed -mt-1">Handshaker prefers gRPC reflection. When reflection is unavailable, import .proto files or descriptor sets here.</p>
        <div className="flex items-center gap-3 p-3.5 rounded-md border border-border bg-card">
          <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground"><Icons.Cube size={14}/></div>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs">notex.descriptor.bin</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">14 services, 87 methods · last loaded 14:21</div>
          </div>
          <Button variant="outline" size="xs">Reload</Button>
        </div>
        <div className="flex items-center gap-3 p-3.5 rounded-md border border-dashed border-border bg-card">
          <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground"><Icons.Upload size={14}/></div>
          <div className="flex-1 text-xs text-muted-foreground">Drop a .proto or .pb here, or click to choose</div>
        </div>
      </SettingsGroup>
    </>
  );
}

function KeyboardPane() {
  const rows = [
    ["Send request", ["⌘","Enter"]],
    ["Cancel stream", ["⌘","."]],
    ["Command palette", ["⌘","K"]],
    ["Switch environment", ["⌘","E"]],
    ["Toggle sidebar", ["⌘","B"]],
    ["New tab", ["⌘","T"]],
    ["Format body", ["⌥","⇧","F"]],
  ];
  return (
    <SettingsGroup title="Shortcuts">
      {rows.map(([n, keys]) => (
        <SettingsRow
          key={n}
          title={n}
          control={<span className="flex items-center gap-1">{keys.map((k,i)=>(<Kbd key={i}>{k}</Kbd>))}</span>}
        />
      ))}
    </SettingsGroup>
  );
}

function DataPane() {
  return (
    <>
      <SettingsGroup title="Workspace">
        <SettingsRow title="Storage location" hint="~/Library/Application Support/Handshaker" control={<Button variant="outline" size="xs">Reveal</Button>}/>
        <SettingsRow title="Sync to git" hint="Push collections and environments to a repo." control={<Switch checked={false} onCheckedChange={()=>{}}/>}/>
      </SettingsGroup>
      <SettingsGroup title="History">
        <SettingsRow title="Retention" control={<ToggleGroup value="30d" onValueChange={()=>{}} options={["7d","30d","∞"]}/>}/>
        <SettingsRow title="Clear history" hint="Removes all logged requests on this machine." control={<Button variant="destructive" size="xs">Clear…</Button>}/>
      </SettingsGroup>
    </>
  );
}

function AboutPane() {
  return (
    <SettingsGroup title="Handshaker">
      <p className="text-xs text-muted-foreground leading-relaxed -mt-1">A gRPC client for the rest of us. No accounts, no telemetry, no nonsense.</p>
      <div className="grid gap-1.5 font-mono text-[11.5px] text-muted-foreground mt-1">
        <div>version <span className="text-foreground">0.1.0 (build 207)</span></div>
        <div>runtime <span className="text-foreground">tauri 1.6 · rust 1.78</span></div>
        <div>grpc    <span className="text-foreground">tonic 0.11</span></div>
        <div>license <span className="text-foreground">Apache-2.0</span></div>
      </div>
    </SettingsGroup>
  );
}

Object.assign(window, { EnvironmentModal, SettingsModal });
