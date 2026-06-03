import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { catalogStore, useCatalog } from "./store";
import { buildServiceTree, filterTree } from "./tree";
import { openCallFromMethod } from "./actions";
import { AddServiceForm } from "./AddServiceForm";
import type { CatalogService } from "./model";

export function Sidebar({
  onOpenService,
  onOpenPalette,
}: {
  onOpenService: (svc: CatalogService) => void;
  onOpenPalette: () => void;
}) {
  const { collection } = useCatalog();
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const favorites = collection.services.filter((s) => s.favorite);

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Фильтр коллекции…"
          className="h-8 text-xs"
          aria-label="collection-filter"
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label="add-service"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {adding ? (
        <div className="border-b border-border bg-muted/30">
          <AddServiceForm onAdded={() => setAdding(false)} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {favorites.length > 0 ? (
          <Section title="★ Избранные">
            {favorites.map((svc) => (
              <ServiceTree
                key={`fav-${svc.id}`}
                svc={svc}
                filter={filter}
                open={expanded.has(`fav-${svc.id}`)}
                onToggle={() => toggle(`fav-${svc.id}`)}
                onOpenService={onOpenService}
              />
            ))}
          </Section>
        ) : null}

        <Section title="Коллекция">
          {collection.services.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Пусто. Добавь сервис (+) или открой ⌘K.
            </div>
          ) : (
            collection.services.map((svc) => (
              <ServiceTree
                key={svc.id}
                svc={svc}
                filter={filter}
                open={expanded.has(svc.id)}
                onToggle={() => toggle(svc.id)}
                onOpenService={onOpenService}
              />
            ))
          )}
        </Section>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
      >
        Нет нужного? <Kbd>⌘K</Kbd>
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pb-2">
      <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function ServiceTree({
  svc,
  filter,
  open,
  onToggle,
  onOpenService,
}: {
  svc: CatalogService;
  filter: string;
  open: boolean;
  onToggle: () => void;
  onOpenService: (svc: CatalogService) => void;
}) {
  const tree = useMemo(
    () => filterTree(buildServiceTree(svc), { showAll: false, query: filter }),
    [svc, filter],
  );

  return (
    <div>
      <div className="group flex items-center gap-1 px-2 py-1 hover:bg-accent/50">
        <button
          type="button"
          aria-label="toggle-service"
          onClick={onToggle}
          className="flex flex-1 items-center gap-1 text-left"
        >
          {open ? <ChevronDown className="size-3 flex-none" /> : <ChevronRight className="size-3 flex-none" />}
          <span className="truncate text-xs font-medium">{svc.label}</span>
          {svc.thirdParty ? (
            <span className="text-[10px] text-muted-foreground">· сторонний</span>
          ) : null}
        </button>
        <button
          type="button"
          aria-label="toggle-favorite"
          onClick={() => catalogStore.toggleFavorite(svc.id)}
        >
          <Star
            className={cn(
              "size-3",
              svc.favorite ? "fill-current text-yellow-400" : "text-muted-foreground",
            )}
          />
        </button>
        <button
          type="button"
          aria-label="open-service-panel"
          onClick={() => onOpenService(svc)}
          className="text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>

      {open ? (
        <div className="pl-4">
          {tree.length === 0 ? (
            <div className="px-3 py-1 text-[11px] text-muted-foreground">
              Нет ● методов — открой панель
            </div>
          ) : (
            tree.map((ps) => (
              <div key={ps.fullName}>
                <div className="truncate px-3 py-0.5 text-[10px] text-muted-foreground">
                  {ps.fullName}
                </div>
                {ps.methods.map((m) => (
                  <button
                    key={m.method}
                    type="button"
                    onClick={(e) =>
                      openCallFromMethod(svc, m.service, m.method, { newWorkflow: e.altKey })
                    }
                    className="flex w-full items-center gap-2 px-3 py-0.5 pl-6 text-left font-mono text-xs hover:bg-accent"
                  >
                    <span className="text-[var(--ok)]">●</span>
                    <span className="truncate">{m.method}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
