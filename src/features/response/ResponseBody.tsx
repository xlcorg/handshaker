import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { JsonTree } from "./json/JsonTreeView";
import { JsonSearchBar } from "./json/JsonSearchBar";
import { parseJsonTree, type JsonNode } from "./json/jsonTree";
import { copyTextForNode } from "./json/copyValue";
import { findMatches, ancestorsToExpand } from "./json/jsonSearch";
import { shouldDegrade } from "./json/degrade";
import { copyToClipboard } from "@/lib/clipboard";
import { downloadText } from "@/lib/download";
import { formatBytes } from "@/lib/grpc-status";

export interface ResponseBodyProps {
  json: string;
}

export function ResponseBody({ json }: ResponseBodyProps) {
  const degraded = useMemo(() => shouldDegrade(json), [json]);
  const tree = useMemo(() => parseJsonTree(json), [json]);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => (query ? findMatches(tree, query) : []), [tree, query]);
  const matchIds = useMemo(() => new Set(matches.map((m) => m.nodeId)), [matches]);
  const activeMatch = matches[activeIndex] ?? null;
  const activeMatchId = activeMatch?.nodeId ?? null;

  // Reset the active match when the result set changes.
  useEffect(() => { setActiveIndex(0); }, [query]);

  // Auto-expand the path to the active match so it is visible.
  useEffect(() => {
    if (!activeMatchId) return;
    const reveal = ancestorsToExpand(tree, activeMatchId);
    setCollapsed((prev) => {
      if (reveal.every((id) => !prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of reveal) next.delete(id);
      return next;
    });
  }, [activeMatchId, tree]);

  // Ctrl/Cmd+F opens the in-response search (only one ResponseBody is mounted at a time).
  useEffect(() => {
    if (degraded) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [degraded]);

  const onToggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onCopy = (node: JsonNode) => { void copyToClipboard(copyTextForNode(node)); };

  if (degraded) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-foreground">
          Ответ слишком большой для просмотра ({formatBytes(json)}).
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Подсветка и дерево отключены, чтобы не вешать интерфейс. Скачайте ответ, чтобы
          открыть его во внешнем редакторе.
        </p>
        <button
          type="button"
          onClick={() => downloadText("response.json", json)}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
        >
          Скачать ответ ({formatBytes(json)})
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-end border-b border-border/60 px-2 py-1">
        <button
          type="button"
          aria-label="copy-all"
          onClick={() => void copyToClipboard(json, "Ответ скопирован")}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Copy className="size-3" /> копировать всё
        </button>
      </div>
      {searchOpen && (
        <JsonSearchBar
          query={query}
          matchCount={matches.length}
          activeIndex={matches.length ? activeIndex : -1}
          onQuery={setQuery}
          onNext={() => matches.length && setActiveIndex((i) => (i + 1) % matches.length)}
          onPrev={() => matches.length && setActiveIndex((i) => (i - 1 + matches.length) % matches.length)}
          onClose={() => { setSearchOpen(false); setQuery(""); }}
        />
      )}
      <JsonTree
        tree={tree}
        collapsed={collapsed}
        matchIds={matchIds}
        activeMatchId={activeMatchId}
        scrollToId={activeMatchId}
        onToggle={onToggle}
        onCopy={onCopy}
      />
    </div>
  );
}
