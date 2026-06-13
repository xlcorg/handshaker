import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, X, AlignLeft, Lock, KeyRound, Braces, Bookmark, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { ipc } from "@/ipc/client";
import type { CollectionIpc, ItemIpc, SavedAuthConfigIpc, SavedRequestIpc } from "@/ipc/bindings";
import { flattenRequests } from "../palette";
import { COTabs, type COTabItem } from "./COTabs";
import { COBlock } from "./COBlock";
import { CollectionTitle } from "./CollectionTitle";
import { DescriptionBlock } from "./DescriptionBlock";
import { VariablesBlock, type VarRow } from "./VariablesBlock";
import { TlsBlock } from "./TlsBlock";
import { SavedAuthEditor } from "./SavedAuthEditor";
import { useActiveWorkflow } from "@/features/workflow/store";
import { useEnvRevision } from "@/features/envs/envRevision";

function countFolders(items: ItemIpc[]): number {
  return items.reduce((n, it) => (it.type === "folder" ? n + 1 + countFolders(it.items) : n), 0);
}

function entriesToRows(vars: Partial<{ [k: string]: string }>): VarRow[] {
  return Object.entries(vars)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => ({ id: newId(), k, v }));
}

function rowsToRecord(rows: VarRow[]): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const r of rows) {
    const k = r.k.trim();
    if (k) rec[k] = r.v; // dup keys: last wins (matches persist)
  }
  return rec;
}

export interface CollectionOverviewProps {
  collection: CollectionIpc;
  /** Reload the tree after a persisted change. */
  onChanged: () => void;
  /** Open a saved request in Focus (caller binds origin + handles dirty-confirm). */
  onSelectRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onClose: () => void;
}

/** Main-area collection panel: Overview / Authorization / Variables (spec §8, single-auth). */
export function CollectionOverview({ collection, onChanged, onSelectRequest, onClose }: CollectionOverviewProps) {
  const [tab, setTab] = useState("overview");
  const [varRows, setVarRows] = useState<VarRow[]>(() => entriesToRows(collection.variables));
  // Re-seed the variable buffer only when the collection identity changes, so a persist→reload
  // of the SAME collection doesn't clobber an in-progress edit.
  useEffect(() => {
    setVarRows(entriesToRows(collection.variables));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id]);

  const hits = useMemo(() => flattenRequests([collection]), [collection]);
  const total = hits.length;
  const folders = countFolders(collection.items);
  const varCount = varRows.filter((r) => r.k.trim()).length;

  const tabs: COTabItem[] = [
    { value: "overview", label: "Overview" },
    { value: "auth", label: "Authorization" },
    { value: "variables", label: "Variables", hint: varCount || null },
  ];

  const persistName = (name: string) => {
    const next = name.trim();
    if (!next || next === collection.name) return;
    void ipc.collectionUpsert({ ...collection, name: next }).then(onChanged).catch(() => {});
  };
  const persistDesc = (text: string) => {
    void ipc.collectionUpsert({ ...collection, description: text.trim() || null }).then(onChanged).catch(() => {});
  };
  const persistTls = (next: { enabled: boolean; skipVerify: boolean }) => {
    void ipc
      .collectionUpsert({ ...collection, default_tls: next.enabled, skip_tls_verify: next.skipVerify })
      .then(onChanged)
      .catch(() => {});
  };
  const persistAuth = (config: SavedAuthConfigIpc) => {
    void ipc.collectionSetNodeAuth(collection.id, null, config).then(onChanged).catch(() => {});
  };
  const persistVars = (rows: VarRow[]) => {
    void ipc.collectionSetVariables(collection.id, rowsToRecord(rows)).then(onChanged).catch(() => {});
  };

  const activeWf = useActiveWorkflow();
  // Bumped when an env is saved — the preview resolves against the active env via the
  // backend (env_vars: null), so editing the active env's vars (without renaming it)
  // is otherwise invisible to resolveKey and the preview would go stale.
  const envRevision = useEnvRevision();
  const varsRecord = useMemo(() => rowsToRecord(varRows), [varRows]);
  // Unsaved editor rows overlay the stored collection vars; env = active env (backend resolves it).
  const resolveRow = useCallback(
    (t: string) =>
      ipc.varsResolve(t, { collection_id: null, collection_vars: varsRecord, env_vars: null }),
    [varsRecord],
  );
  const resolveKey = `${JSON.stringify(varsRecord)}|${activeWf.envName ?? ""}|${envRevision}`;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* header */}
      <div className="flex h-12 flex-none items-center gap-3 border-b border-border px-4">
        <Layers size={15} className="flex-none text-muted-foreground" />
        <CollectionTitle name={collection.name} onRename={persistName} />
        <span className="truncate text-[11.5px] text-muted-foreground/55">
          {folders} {folders === 1 ? "folder" : "folders"} · {total}{" "}
          {total === 1 ? "request" : "requests"}
        </span>
        <div className="ml-auto">
          <Tooltip content="Close">
            <Button variant="ghost" size="icon-sm" aria-label="close-overview" onClick={onClose}>
              <X size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <COTabs value={tab} onChange={setTab} items={tabs} />

      {/* body */}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        {/* Variables is a key/value table that benefits from width (long values, JWTs) —
            same reasoning as the Edit Environment dialog (max-w 960px); Overview/Auth stay
            a comfortable reading column at 680px. */}
        <div
          className={cn(
            "mx-auto px-5 py-6",
            tab === "variables" ? "max-w-[min(90vw,960px)]" : "max-w-[680px]",
          )}
        >
          {tab === "overview" && (
            <div className="flex flex-col gap-7">
              <COBlock
                icon={<AlignLeft size={15} />}
                title="Description"
                desc="What this collection is for — shown to anyone you share it with."
              >
                <DescriptionBlock text={collection.description ?? ""} onChange={persistDesc} />
              </COBlock>

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

              {total > 0 && (
                <COBlock
                  icon={<Bookmark size={15} />}
                  title="Requests"
                  desc="Saved requests in this collection. Click any row to open it."
                >
                  <div className="overflow-hidden rounded-md border border-border">
                    {hits.map((h) => (
                      <button
                        key={h.request.id}
                        type="button"
                        onClick={() => onSelectRequest(collection.id, h.request)}
                        className="group flex h-9 w-full items-center gap-2.5 border-b border-border/40 px-3 text-left transition-colors hover:bg-accent/50"
                      >
                        <span
                          className="truncate text-[12.5px] text-foreground/90"
                          style={{ maxWidth: "45%" }}
                        >
                          {h.request.name}
                        </span>
                        <span className="hidden truncate font-mono text-[10.5px] text-muted-foreground/45 md:inline">
                          {h.request.service}.{h.request.method}
                        </span>
                        <Send
                          size={11}
                          className="ml-auto flex-none text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60"
                        />
                      </button>
                    ))}
                  </div>
                </COBlock>
              )}
            </div>
          )}

          {tab === "auth" && (
            <COBlock
              icon={<KeyRound size={15} />}
              title="Authorization"
              desc="A single auth config applied to this collection's requests (a request can override it)."
            >
              <SavedAuthEditor value={collection.auth} onChange={persistAuth} />
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
                resolveRow={resolveRow}
                resolveKey={resolveKey}
              />
            </COBlock>
          )}
        </div>
      </div>
    </div>
  );
}
