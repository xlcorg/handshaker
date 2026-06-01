import { useEffect, useMemo, useState } from "react";
import {
  Layers,
  Upload,
  X,
  AlignLeft,
  Target,
  Bookmark,
  Folder,
  Send,
  KeyRound,
  Braces,
  Lock,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ipc } from "@/ipc/client";
import type {
  CollectionIpc,
  EnvironmentIpc,
  ItemIpc,
  SavedRequestIpc,
} from "@/ipc/bindings";
import { countRequests } from "../tree/treeUtils";
import { ReqTypeTag } from "../tree/ReqTypeTag";
import { COTabs, type COTabItem } from "./COTabs";
import { COBlock } from "./COBlock";
import { CollectionTitle } from "./CollectionTitle";
import { DescriptionBlock } from "./DescriptionBlock";
import { VariablesBlock, type VarRow } from "./VariablesBlock";
import { TlsBlock } from "./TlsBlock";
import { AuthBlock, type AuthEntry, type AuthTypeOption } from "./AuthBlock";
import { authEntryToConfig, configToAuthEntry } from "./authMap";

// ── description: frontend-only store (CollectionIpc has no description field) ──
// Persisted in localStorage under `handshaker.collection.desc.<id>`. This is a
// known frontend-only store — descriptions are NOT round-tripped to the backend.
const DESC_KEY = (id: string) => `handshaker.collection.desc.${id}`;

export function getCollectionDesc(id: string): string {
  try {
    return localStorage.getItem(DESC_KEY(id)) ?? "";
  } catch {
    return "";
  }
}

export function setCollectionDesc(id: string, text: string): void {
  try {
    if (text) localStorage.setItem(DESC_KEY(id), text);
    else localStorage.removeItem(DESC_KEY(id));
  } catch {
    // ignore quota / unavailable storage
  }
}

const AUTH_TYPES: AuthTypeOption[] = [
  { value: "none", label: "No auth" },
  { value: "bearer", label: "Bearer" },
  { value: "apikey", label: "API key" },
  { value: "basic", label: "Basic", disabled: true, hint: "Not supported by the current backend" },
  { value: "mtls", label: "Mutual TLS", disabled: true, hint: "Not supported by the current backend" },
];

// Count folder nodes recursively across the whole collection.
function countFolders(items: ItemIpc[]): number {
  return items.reduce(
    (sum, it) => (it.type === "folder" ? sum + 1 + countFolders(it.items) : sum),
    0,
  );
}

// Best-effort host extraction from an `address_template` (drops scheme + path).
function hostOf(addr: string): string {
  let s = addr.trim();
  const scheme = s.indexOf("://");
  if (scheme >= 0) s = s.slice(scheme + 3);
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  return s;
}

// Distinct address templates across all request leaves.
function collectTargets(items: ItemIpc[], acc: Set<string>): Set<string> {
  for (const it of items) {
    if (it.type === "request") {
      const t = it.address_template.trim();
      if (t) acc.add(t);
    } else {
      collectTargets(it.items, acc);
    }
  }
  return acc;
}

// Map a collection's variable record to editable buffer rows. Stable enough for
// a fresh edit session — ids only need to be unique within the current buffer.
function entriesToRows(vars: Record<string, string | undefined>): VarRow[] {
  return Object.entries(vars)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v], i) => ({ id: `v${i}`, k, v }));
}

interface RowsProps {
  nodes: ItemIpc[];
  depth: number;
  onSelectRequest: (req: SavedRequestIpc) => void;
}

function CO_Rows({ nodes, depth, onSelectRequest }: RowsProps) {
  return (
    <>
      {nodes.map((n) => {
        if (n.type === "folder") {
          if (n.items.length === 0) return null;
          return (
            <div key={n.id}>
              <div
                className="flex items-center gap-2 h-7 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/55"
                style={{ paddingLeft: 12 + depth * 18 }}
              >
                <Folder size={11} className="text-muted-foreground/45" />
                <span className="truncate">{n.name}</span>
                <span className="font-mono text-[9.5px] text-muted-foreground/35 normal-case">
                  {countRequests(n)}
                </span>
              </div>
              <CO_Rows nodes={n.items} depth={depth + 1} onSelectRequest={onSelectRequest} />
            </div>
          );
        }
        const sig = `${n.service}.${n.method}`;
        const target = hostOf(n.address_template);
        return (
          <button
            key={n.id}
            onClick={() => onSelectRequest(n)}
            className="group flex w-full items-center gap-2.5 h-9 pr-3 hover:bg-accent/50 transition-colors text-left border-b border-border/40"
            style={{ paddingLeft: 12 + depth * 18 }}
          >
            <span className="w-[18px] flex-none text-right">
              <ReqTypeTag />
            </span>
            <span className="truncate text-[12.5px] text-foreground/90" style={{ maxWidth: "40%" }}>
              {n.name}
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground/45 truncate hidden md:inline">
              {sig}
            </span>
            <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/45 truncate pl-3">
              {target}
            </span>
            <Send
              size={11}
              className="flex-none text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors"
            />
          </button>
        );
      })}
    </>
  );
}

interface CollectionOverviewProps {
  collection: CollectionIpc;
  environments: EnvironmentIpc[];
  onClose: () => void;
  onSelectRequest: (req: SavedRequestIpc) => void;
  onChanged: () => void;
  onDeleted: () => void;
}

export function CollectionOverview({
  collection,
  environments,
  onClose,
  onSelectRequest,
  onChanged,
  onDeleted,
}: CollectionOverviewProps) {
  const [tab, setTab] = useState("overview");
  const [confirm, setConfirm] = useState(false);
  const [desc, setDesc] = useState(() => getCollectionDesc(collection.id));

  const total = countRequests(collection);
  const folders = countFolders(collection.items);
  const targets = useMemo(
    () => [...collectTargets(collection.items, new Set<string>())],
    [collection.items],
  );
  // Local edit buffer for variable rows. Re-init ONLY when the collection id
  // changes, so a persist→reload of the SAME collection doesn't clobber an
  // in-progress edit (e.g. a transient empty row or a half-renamed key).
  const [varRows, setVarRows] = useState<VarRow[]>(() => entriesToRows(collection.variables));
  useEffect(() => {
    setVarRows(entriesToRows(collection.variables));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id]);

  // Hint reflects the live buffer: rows with a non-empty trimmed key.
  const varCount = varRows.filter((r) => r.k.trim()).length;

  const tabs: COTabItem[] = [
    { value: "overview", label: "Overview" },
    { value: "auth", label: "Authorization" },
    { value: "variables", label: "Variables", hint: varCount || null },
    { value: "settings", label: "Settings" },
  ];

  // ── persistence helpers ──────────────────────────────────────────────────
  const persistName = (name: string) => {
    const next = name.trim();
    if (!next || next === collection.name) return;
    void ipc
      .collectionUpsert({ ...collection, name: next })
      .then(onChanged)
      .catch((e) => console.error("rename collection failed:", e));
  };

  const persistDesc = (text: string) => {
    setDesc(text);
    setCollectionDesc(collection.id, text);
  };

  const persistVars = (rows: VarRow[]) => {
    const record: Record<string, string> = {};
    for (const r of rows) {
      const k = r.k.trim();
      if (k) record[k] = r.v;
    }
    void ipc
      .collectionSetVariables(collection.id, record)
      .then(onChanged)
      .catch((e) => console.error("set variables failed:", e));
  };

  const persistTls = (next: { enabled: boolean; skipVerify: boolean }) => {
    void ipc
      .collectionUpsert({
        ...collection,
        default_tls: next.enabled,
        skip_tls_verify: next.skipVerify,
      })
      .then(onChanged)
      .catch((e) => console.error("set TLS defaults failed:", e));
  };

  // ── auth round-trip ──────────────────────────────────────────────────────
  const authValue = useMemo<Record<string, AuthEntry>>(() => {
    const out: Record<string, AuthEntry> = {};
    for (const env of environments) {
      out[env.name] = configToAuthEntry(collection.auth_by_env.configs[env.name]);
    }
    return out;
  }, [environments, collection.auth_by_env]);

  const persistAuth = (next: Record<string, AuthEntry>) => {
    // Diff per-env against the current value and persist only what changed.
    const changed = Object.keys(next).filter(
      (envName) => JSON.stringify(next[envName]) !== JSON.stringify(authValue[envName]),
    );
    if (changed.length === 0) return;
    Promise.all(
      changed.map((envName) =>
        // basic/mtls → config `null` clears the env's stored auth.
        ipc.authSetForEnv(collection.id, null, envName, authEntryToConfig(next[envName])),
      ),
    )
      .then(onChanged)
      .catch((e) => console.error("set auth failed:", e));
  };

  const confirmDelete = () => {
    void ipc
      .collectionDelete(collection.id)
      .then(() => {
        setConfirm(false);
        onDeleted();
      })
      .catch((e) => console.error("delete collection failed:", e));
  };

  return (
    <div className="relative flex flex-col bg-background overflow-hidden flex-1 min-h-0">
      {/* header */}
      <div className="h-12 flex-none flex items-center gap-3 px-4 border-b border-border bg-background/85 backdrop-blur-sm">
        <Layers size={15} className="text-muted-foreground flex-none" />
        <CollectionTitle name={collection.name} onRename={persistName} />
        <span className="text-[11.5px] text-muted-foreground/55 truncate">
          {folders} {folders === 1 ? "folder" : "folders"} · {total}{" "}
          {total === 1 ? "request" : "requests"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            className="gap-1.5"
            onClick={() => console.debug("export collection", collection.id)}
          >
            <Upload size={11} /> Export
          </Button>
          <Tooltip content="Close">
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* tabs */}
      <COTabs value={tab} onChange={setTab} items={tabs} />

      {/* body */}
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        <div className="max-w-[680px] mx-auto px-5 py-6">
          {tab === "overview" && (
            <div className="flex flex-col gap-7">
              {total === 0 && (
                <div className="flex items-center gap-3 rounded-md border border-dashed border-border/80 px-4 py-3.5">
                  <span className="text-muted-foreground/55 flex-none">
                    <Layers size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] text-foreground/85 font-medium">
                      This collection has no requests yet
                    </p>
                    <p className="text-[11.5px] text-muted-foreground/60">
                      Add a request from any server — each request keeps its own target.
                    </p>
                  </div>
                </div>
              )}

              <COBlock
                icon={<AlignLeft size={15} />}
                title="Description"
                desc="What this collection is for — shown to anyone you share it with."
              >
                <DescriptionBlock text={desc} onChange={persistDesc} />
              </COBlock>

              {targets.length > 0 && (
                <COBlock
                  icon={<Target size={15} />}
                  title="Targets"
                  desc="Servers this collection's requests point at. Each saved request keeps its own target."
                >
                  <div className="flex flex-wrap gap-1.5">
                    {targets.map((t) => (
                      <span
                        key={t}
                        className="font-mono text-[11px] text-foreground/75 bg-card border border-border rounded px-2 py-1"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </COBlock>
              )}

              {total > 0 && (
                <COBlock
                  icon={<Bookmark size={15} />}
                  title="Requests"
                  desc="Saved requests in this collection. Click any row to open it."
                >
                  <div className="rounded-md border border-border overflow-hidden">
                    <CO_Rows nodes={collection.items} depth={0} onSelectRequest={onSelectRequest} />
                  </div>
                </COBlock>
              )}
            </div>
          )}

          {tab === "auth" && (
            <COBlock
              icon={<KeyRound size={15} />}
              title="Authentication"
              desc="Credentials applied per environment. Configure each environment separately."
            >
              <AuthBlock
                environments={environments.map((e) => ({ name: e.name }))}
                value={authValue}
                onChange={persistAuth}
                authTypes={AUTH_TYPES}
              />
            </COBlock>
          )}

          {tab === "variables" && (
            <COBlock
              icon={<Braces size={15} />}
              title="Variables"
              desc="Collection-wide key/value pairs, reusable as {{name}} inside requests."
            >
              <VariablesBlock
                rows={varRows}
                onChange={(next) => {
                  setVarRows(next);
                  persistVars(next);
                }}
              />
            </COBlock>
          )}

          {tab === "settings" && (
            <div className="flex flex-col gap-8">
              <COBlock
                icon={<Lock size={15} />}
                title="TLS defaults"
                desc="The transport security new requests in this collection start with."
              >
                <TlsBlock
                  enabled={collection.default_tls}
                  skipVerify={collection.skip_tls_verify}
                  onChange={persistTls}
                />
              </COBlock>
              <div className="border-t border-border/70 pt-7">
                <COBlock
                  icon={<AlertCircle size={15} />}
                  title="Delete collection"
                  danger
                  desc="Permanently removes this collection and every request inside it. This can't be undone."
                >
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setConfirm(true)}
                  >
                    <Trash2 size={13} /> Delete collection
                  </Button>
                </COBlock>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* delete confirm overlay */}
      {confirm && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/50 animate-fade-in"
          onClick={() => setConfirm(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-lg border border-border bg-popover shadow-xl animate-zoom-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1.5 px-5 pt-5">
              <div className="flex items-center gap-2">
                <span className="h-8 w-8 rounded-full bg-destructive/10 text-destructive inline-flex items-center justify-center flex-none">
                  <Trash2 size={15} />
                </span>
                <h2 className="text-[15px] font-semibold tracking-tight">Delete collection?</h2>
              </div>
              <p className="text-[12.5px] text-muted-foreground/80 leading-relaxed pt-1">
                This permanently deletes{" "}
                <span className="text-foreground font-medium">“{collection.name}”</span> and its{" "}
                {total} {total === 1 ? "request" : "requests"}. This action can't be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 mt-3 border-t border-border bg-muted/20">
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={confirmDelete}>
                <Trash2 size={13} /> Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
