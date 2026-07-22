import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers, X, AlignLeft, Lock, KeyRound, Braces, Bookmark, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { ipc } from "@/ipc/client";
import type {
  CollectionIpc,
  CollectionLinkIpc,
  ItemIpc,
  SavedAuthConfigIpc,
  SavedRequestIpc,
} from "@/ipc/bindings";
import { flattenRequests } from "../palette";
import { COTabs, type COTabItem } from "./COTabs";
import { COBlock } from "./COBlock";
import { CollectionTitle } from "./CollectionTitle";
import { DescriptionBlock } from "./DescriptionBlock";
import { VariablesBlock, type VarRow } from "./VariablesBlock";
import { QuickLinksStrip } from "./QuickLinksStrip";
import { HeaderLinks } from "./HeaderLinks";
import type { LinkRow } from "./linkTarget";
import { useLinksPlacement } from "../uiState";
import { TlsBlock } from "./TlsBlock";
import { SavedAuthEditor } from "./SavedAuthEditor";
import { usageLabel } from "./usage";
import { useActiveWorkflow } from "@/features/workflow/store";
import { useEnvRevision } from "@/features/envs/envRevision";
import { useActiveEnvVars } from "@/features/envs/useActiveEnvVars";
import { buildVarCandidates } from "@/features/vars/candidates";
import { messages } from "@/lib/messages";

const mo = messages.catalog.overview;

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

function linksToRows(links: CollectionLinkIpc[] | undefined): LinkRow[] {
  return (links ?? []).map((l) => ({ id: newId(), name: l.name, url: l.url }));
}

/** Drop the blank row an "Add link" click seeds — it isn't a link until it has content. */
function rowsToLinks(rows: LinkRow[]): CollectionLinkIpc[] {
  return rows
    .filter((r) => r.name.trim() || r.url.trim())
    .map((r) => ({ name: r.name, url: r.url }));
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
  const [linkRows, setLinkRows] = useState<LinkRow[]>(() => linksToRows(collection.links));
  useEffect(() => {
    setVarRows(entriesToRows(collection.variables));
    setLinkRows(linksToRows(collection.links));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id]);

  const hits = useMemo(() => flattenRequests([collection]), [collection]);
  const total = hits.length;
  const folders = countFolders(collection.items);
  const varCount = varRows.filter((r) => r.k.trim()).length;

  const tabs: COTabItem[] = [
    { value: "overview", label: mo.tabs.overview },
    { value: "auth", label: mo.tabs.auth },
    { value: "variables", label: mo.tabs.variables, hint: varCount || null },
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
  // Links ride the whole-collection upsert path, like description/TLS above — there is
  // no `collection_set_links` command. The write carries this render's snapshot, so a
  // concurrent backend-side change (e.g. a usage bump) is overwritten; same trade-off
  // the sibling blocks already make.
  const persistLinks = (rows: LinkRow[]) => {
    void ipc
      .collectionUpsert({ ...collection, links: rowsToLinks(rows) })
      .then(onChanged)
      .catch(() => {});
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
  const activeEnvVars = useActiveEnvVars();
  const varCandidates = useMemo(
    () => buildVarCandidates(activeEnvVars, varsRecord),
    [activeEnvVars, varsRecord],
  );
  // Unsaved editor rows overlay the stored collection vars; env = active env (backend resolves it).
  const resolveRow = useCallback(
    (t: string) =>
      ipc.varsResolve(t, { collection_id: null, collection_vars: varsRecord, env_vars: null }),
    [varsRecord],
  );
  const resolveKey = `${JSON.stringify(varsRecord)}|${activeWf.envName ?? ""}|${envRevision}`;

  // Stamp for relative "last used" labels. Recomputed each render; the list re-renders
  // when the in-memory tree changes (e.g. a Send optimistically bumps usage), so the
  // count/time refresh live without a reload.
  const now = Date.now();

  // Global preference: quick-links as a strip below the header, or inline in the header.
  const linksPlacement = useLinksPlacement();
  const onLinksChange = (next: LinkRow[]) => {
    setLinkRows(next);
    persistLinks(next);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* header */}
      <div className="flex h-12 flex-none items-center gap-3 border-b border-border px-4">
        <Layers size={15} className="flex-none text-muted-foreground" />
        <CollectionTitle name={collection.name} onRename={persistName} />
        <span className="truncate text-[11px] text-muted-foreground/55">
          {mo.counts(folders, total)}
        </span>
        {/* Header variant: chips inline after the counters, overflow collapsing to "+N". */}
        {linksPlacement === "header" && (
          <HeaderLinks
            rows={linkRows}
            onChange={onLinksChange}
            resolveUrl={resolveRow}
            resolveKey={resolveKey}
            variables={varCandidates}
          />
        )}
        <div className="ml-auto">
          <Tooltip content={mo.close}>
            <Button variant="ghost" size="icon-sm" aria-label="close-overview" onClick={onClose}>
              <X size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Strip variant (default): a slim row of chips on every tab, above the tab bar. Editing
          is behind the pencil / empty-state ghost chip (a dialog), not inline in the body. */}
      {linksPlacement === "strip" && (
        <QuickLinksStrip
          rows={linkRows}
          onChange={onLinksChange}
          resolveUrl={resolveRow}
          resolveKey={resolveKey}
          variables={varCandidates}
        />
      )}

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
                title={mo.description.title}
                desc={mo.description.desc}
              >
                <DescriptionBlock text={collection.description ?? ""} onChange={persistDesc} />
              </COBlock>

              <COBlock
                icon={<Lock size={15} />}
                title={mo.tls.title}
                desc={mo.tls.desc}
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
                  title={mo.requests.title}
                  desc={mo.requests.desc}
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
                        <span className="hidden truncate font-mono text-[10px] text-muted-foreground/55 md:inline">
                          {h.request.service}.{h.request.method}
                        </span>
                        <span
                          className={cn(
                            "ml-auto flex-none whitespace-nowrap font-mono text-[10px] tabular-nums",
                            h.request.use_count > 0 ? "text-muted-foreground/70" : "text-muted-foreground/30",
                          )}
                          title={
                            h.request.last_used_at != null
                              ? mo.requests.lastUsed(new Date(h.request.last_used_at).toLocaleString())
                              : undefined
                          }
                        >
                          {usageLabel(h.request.use_count, h.request.last_used_at, now)}
                        </span>
                        <Send
                          size={11}
                          className="flex-none text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70"
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
              title={mo.auth.title}
              desc={mo.auth.desc}
            >
              <SavedAuthEditor
                value={collection.auth}
                onChange={persistAuth}
                seedKey={collection.id}
                resolver={resolveRow}
                resolveKey={resolveKey}
                variables={varCandidates}
              />
            </COBlock>
          )}

          {tab === "variables" && (
            <COBlock
              icon={<Braces size={15} />}
              title={mo.variables.title}
              desc={mo.variables.desc}
            >
              <VariablesBlock
                rows={varRows}
                onChange={(next) => {
                  setVarRows(next);
                  persistVars(next);
                }}
                resolveRow={resolveRow}
                resolveKey={resolveKey}
                variables={varCandidates}
              />
            </COBlock>
          )}
        </div>
      </div>
    </div>
  );
}
