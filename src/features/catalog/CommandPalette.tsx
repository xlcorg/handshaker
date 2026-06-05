import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Kbd } from "@/components/ui/kbd";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { flattenRequests, rankRequests, type RequestHit } from "./palette";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Every collection (already loaded); the palette flattens their saved requests. */
  collections: CollectionIpc[];
  /** Open a saved request in Focus. The caller binds origin + handles dirty-confirm. */
  onOpen: (collectionId: string, req: SavedRequestIpc) => void;
}

/** ⌘K palette over saved requests across every collection (spec §9). Single-stage search. */
export function CommandPalette({ open, onClose, collections, onOpen }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const all = useMemo(() => flattenRequests(collections), [collections]);
  const hits = useMemo(() => rankRequests(query, all), [query, all]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, hits.length - 1)));
  }, [hits.length]);

  if (!open) return null;

  const choose = (hit: RequestHit) => {
    onOpen(hit.collectionId, hit.request);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active];
      if (h) choose(h);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[560px] overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search saved requests…"
            aria-label="command-input"
            className="h-11 flex-1 bg-transparent text-sm focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[360px] overflow-auto py-1">
          {hits.length === 0 ? (
            <Empty q={query} />
          ) : (
            hits.map((h, i) => {
              const r = h.request;
              const where = [h.collectionName, ...h.folderPath].join(" › ");
              return (
                <button
                  key={`${h.collectionId}/${r.id}`}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(h)}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-2 text-left text-sm",
                    i === active && "bg-accent",
                  )}
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {r.service ? `${r.service}.${r.method}` : r.method}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground/70">{where}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          <span><Kbd>↵</Kbd> open</span>
          <span><Kbd>esc</Kbd> close</span>
          <span><Kbd>↑↓</Kbd> navigate</span>
        </div>
      </div>
    </div>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
      No saved requests{q ? ` matching "${q}"` : ""}.
    </div>
  );
}
