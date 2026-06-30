import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { messages } from "@/lib/messages";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import {
  derivePaletteResults,
  bestCollectionMatch,
  completionFor,
  type PaletteRow,
} from "./paletteModel";
import { methodLabel } from "./palette";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  collections: CollectionIpc[];
  onOpenRequest: (collectionId: string, request: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
}

const LIMITS = { collections: 6, requests: 8 };

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="text-primary font-medium">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

function RowView({
  row,
  showCollection,
}: {
  row: PaletteRow;
  showCollection: boolean;
}) {
  if (row.kind === "overview") {
    return (
      <span className="text-muted-foreground">
        Open <span className="text-foreground">{row.collectionName}</span>{" "}
        overview
      </span>
    );
  }
  if (row.kind === "collection") {
    return (
      <span className="flex w-full items-center gap-2">
        <span className="truncate">
          <Highlighted text={row.collection.name} indices={row.indices} />
        </span>
        <span className="ml-auto flex-none text-[11px] text-muted-foreground">
          ⇥ {messages.palette.drillIn}
        </span>
      </span>
    );
  }
  return (
    <span className="flex w-full items-center gap-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">
          <Highlighted text={row.request.name} indices={row.indices} />
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {methodLabel(row.request)}
        </span>
      </span>
      {showCollection && (
        <span className="flex-none truncate font-mono text-[11px] text-muted-foreground">
          {row.collectionName}
        </span>
      )}
    </span>
  );
}

export function CommandPalette({
  open,
  onClose,
  collections,
  onOpenRequest,
  onOpenCollection,
}: CommandPaletteProps) {
  const [scope, setScope] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Reset transient state whenever the palette closes.
  useEffect(() => {
    if (!open) {
      setScope(null);
      setQuery("");
    }
  }, [open]);

  const result = useMemo(
    () =>
      derivePaletteResults({ tree: collections, scope, query, limits: LIMITS }),
    [collections, scope, query],
  );
  const rowsByValue = useMemo(() => {
    const m = new Map<string, PaletteRow>();
    for (const r of result.rows) m.set(r.value, r);
    return m;
  }, [result]);

  // The currently-selected row. cmdk's `onValueChange` doesn't reliably report keyboard
  // navigation, so read the highlighted item straight from the DOM — cmdk marks it
  // `data-selected` (the same source it uses for Enter). Falls back to the top row before
  // cmdk has marked a selection (e.g. the very first keypress after the list changes).
  function selectedRow(): PaletteRow | undefined {
    const el = rootRef.current?.querySelector<HTMLElement>(
      '[data-slot="command-item"][data-selected="true"]',
    );
    const value = el?.getAttribute("data-row-value") ?? undefined;
    return (value ? rowsByValue.get(value) : undefined) ?? result.rows[0];
  }

  function activate(row: PaletteRow) {
    if (row.kind === "request") onOpenRequest(row.collectionId, row.request);
    else if (row.kind === "overview") onOpenCollection(row.collectionId);
    else onOpenCollection(row.collection.id);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Tab") {
      e.preventDefault();
      const row = selectedRow();
      if (!row) return;
      if (row.kind === "collection") {
        setScope({ id: row.collection.id, name: row.collection.name });
        setQuery("");
      } else if (row.kind === "request") {
        const c = completionFor(row);
        if (c) setQuery(c);
      }
      return;
    }
    if (e.key === "." && !scope) {
      const hi = selectedRow();
      const highlightedColId =
        hi?.kind === "collection" ? hi.collection.id : null;
      const col = bestCollectionMatch(collections, query, highlightedColId);
      if (col) {
        e.preventDefault();
        setScope(col);
        setQuery("");
      }
      return;
    }
    if (e.key === "Backspace" && scope && query === "") {
      e.preventDefault();
      setScope(null);
    }
  }

  const emptyHint = scope
    ? messages.palette.emptyScoped(scope.name)
    : query.trim() === ""
      ? messages.palette.emptyFlat
      : messages.palette.emptyNoMatch;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* Override the shared Dialog's vertical centering: pin near the top so the
          result list grows downward only instead of expanding from the center. */}
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 overflow-hidden gap-0 p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{messages.palette.title}</DialogTitle>
        <DialogDescription className="sr-only">
          {messages.palette.description}
        </DialogDescription>
        <div ref={rootRef} className="contents">
          <Command shouldFilter={false} onKeyDown={onKeyDown}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={
                scope
                  ? messages.palette.searchScoped(scope.name)
                  : messages.palette.searchFlat
              }
              prefix={
                scope ? (
                  <span className="flex flex-none items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-foreground">
                    {scope.name}
                    <ChevronRight className="size-3 opacity-60" aria-hidden />
                  </span>
                ) : undefined
              }
            />
            <CommandList className="max-h-[min(360px,60vh)]">
              <CommandEmpty>{emptyHint}</CommandEmpty>
              {result.groups.map((g, gi) => {
                const items = g.rows.map((row) => (
                  <CommandItem
                    key={row.value}
                    value={row.value}
                    data-row-value={row.value}
                    onSelect={() => activate(row)}
                  >
                    <RowView row={row} showCollection={scope === null} />
                  </CommandItem>
                ));
                return (
                  <CommandGroup key={gi} heading={g.heading ?? undefined}>
                    {items}
                  </CommandGroup>
                );
              })}
            </CommandList>
            <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Kbd>⇥</Kbd> {messages.palette.footerComplete}
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> {messages.palette.footerOpen}
              </span>
              <span className="flex items-center gap-1">
                <Kbd>esc</Kbd> {messages.palette.footerClose}
              </span>
            </div>
          </Command>
        </div>
      </DialogContent>
    </Dialog>
  );
}
