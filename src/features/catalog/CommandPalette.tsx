import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Kbd } from "@/components/ui/kbd";
import { catalogStore, useCatalog } from "./store";
import { rankServices } from "./fuzzy";
import { buildServiceTree, type MethodNode } from "./tree";
import { describeService, openCallFromMethod } from "./actions";
import type { CatalogService } from "./model";

type Stage = "service" | "method";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  useCatalog(); // subscribe
  const [stage, setStage] = useState<Stage>("service");
  const [svc, setSvc] = useState<CatalogService | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStage("service");
      setSvc(null);
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const services = catalogStore.services();
  const ranked = useMemo(() => rankServices(query, services), [query, services]);

  const methods: MethodNode[] = useMemo(() => {
    if (stage !== "method" || !svc) return [];
    const all = buildServiceTree(svc).flatMap((ps) => ps.methods);
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((m) => m.method.toLowerCase().includes(needle)) : all;
  }, [stage, svc, query]);

  const count = stage === "service" ? ranked.length : methods.length;
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, count - 1)));
  }, [count]);

  if (!open) return null;

  const pickService = async (s: CatalogService) => {
    setSvc(s);
    setStage("method");
    setQuery("");
    setActive(0);
    if (s.contract === null) {
      setLoading(true);
      try {
        await describeService(s);
      } finally {
        setLoading(false);
      }
    }
    inputRef.current?.focus();
  };

  const pickMethod = (m: MethodNode, newWorkflow: boolean) => {
    if (!svc) return;
    void openCallFromMethod(svc, m.service, m.method, { newWorkflow });
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (stage === "method") {
        setStage("service");
        setSvc(null);
        setQuery("");
        setActive(0);
      } else {
        onClose();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(count - 1, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (stage === "service") {
        const r = ranked[active];
        if (r) void pickService(r.service);
      } else {
        const m = methods[active];
        if (m) pickMethod(m, e.altKey);
      }
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
          {stage === "method" && svc ? (
            <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              {svc.label} ›
            </span>
          ) : null}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={stage === "service" ? "Поиск сервиса…" : "Поиск метода…"}
            aria-label="command-input"
            className="h-11 flex-1 bg-transparent text-sm focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[360px] overflow-auto py-1">
          {loading ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              Загрузка контракта…
            </div>
          ) : null}

          {!loading && stage === "service"
            ? ranked.length === 0
              ? <Empty q={query} />
              : ranked.map((r, i) => (
                  <button
                    key={r.service.id}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void pickService(r.service)}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-2 text-left text-sm",
                      i === active && "bg-accent",
                    )}
                  >
                    <span className="flex-1 truncate">{r.service.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.service.address}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {r.service.curated.length} ●
                    </span>
                  </button>
                ))
            : null}

          {!loading && stage === "method"
            ? methods.length === 0
              ? <Empty q={query} />
              : methods.map((m, i) => (
                  <button
                    key={`${m.service}/${m.method}`}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={(e) => pickMethod(m, e.altKey)}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-1.5 text-left font-mono text-xs",
                      i === active && "bg-accent",
                    )}
                  >
                    <span className={m.inCollection ? "text-[var(--ok)]" : "text-muted-foreground"}>
                      {m.inCollection ? "●" : "○"}
                    </span>
                    <span className="flex-1 truncate">{m.method}</span>
                    {m.entry ? (
                      <span className="text-[10px] text-muted-foreground">
                        {m.entry.input_message} → {m.entry.output_message}
                      </span>
                    ) : null}
                  </button>
                ))
            : null}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          <span><Kbd>↵</Kbd> вызов</span>
          <span><Kbd>⌥↵</Kbd> новый workflow</span>
          <span><Kbd>esc</Kbd> назад</span>
          <span><Kbd>↑↓</Kbd> навигация</span>
        </div>
      </div>
    </div>
  );
}

function Empty({ q }: { q: string }) {
  return (
    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
      Ничего не найдено{q ? ` по «${q}»` : ""}.
    </div>
  );
}
