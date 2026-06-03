import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { catalogStore, useCatalog } from "./store";
import { buildServiceTree, filterTree } from "./tree";
import { describeService, openCallFromMethod, refreshContract } from "./actions";

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.type === "string") return o.type;
  }
  return String(e);
}

export function ServicePanel({
  serviceId,
  onClose,
}: {
  serviceId: string;
  onClose: () => void;
}) {
  useCatalog(); // subscribe so curate/contract changes re-render
  const svc = catalogStore.getService(serviceId);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = catalogStore.getService(serviceId);
    if (s && s.contract === null) {
      setLoading(true);
      setError(null);
      describeService(s)
        .catch((e) => setError(msg(e)))
        .finally(() => setLoading(false));
    }
  }, [serviceId]);

  const tree = useMemo(
    () => (svc ? filterTree(buildServiceTree(svc), { showAll, query: filter }) : []),
    [svc, showAll, filter],
  );

  if (!svc) return null;

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshContract(svc);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{svc.label}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {svc.address}
            {svc.thirdParty ? " · сторонний" : ""}
            {svc.team ? ` · ${svc.team}` : ""}
            {svc.contractFetchedAt ? " · контракт загружен" : " · контракт не загружен"}
          </div>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          ⟳ Обновить контракт
        </Button>
        <Button size="sm" variant="ghost" aria-label="close-panel" onClick={onClose}>
          ✕
        </Button>
      </div>

      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Фильтр методов…"
          className="h-8 max-w-xs text-xs"
          aria-label="method-filter"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showAll} onCheckedChange={setShowAll} aria-label="show-all-contract" />
          показать всё из контракта
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground">Загрузка контракта…</div>
        ) : null}
        {error ? <div className="p-4 text-xs text-destructive">{error}</div> : null}
        {!loading && tree.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">Нет методов.</div>
        ) : null}
        {tree.map((ps) => (
          <div key={ps.fullName} className="mb-2">
            <div className="px-2 py-1 font-mono text-xs text-muted-foreground">{ps.fullName}</div>
            {ps.methods.map((m) => (
              <div
                key={m.method}
                className="group flex items-center gap-2 px-2 py-0.5 pl-5 font-mono text-xs hover:bg-accent/50"
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
                {m.inCollection ? (
                  <>
                    <button
                      type="button"
                      aria-label={`create-call-${m.method}`}
                      className="text-[var(--ok)] opacity-0 group-hover:opacity-100"
                      onClick={(e) =>
                        openCallFromMethod(svc, m.service, m.method, { newWorkflow: e.altKey })
                      }
                    >
                      → создать вызов
                    </button>
                    <button
                      type="button"
                      aria-label={`uncurate-${m.method}`}
                      className="text-muted-foreground opacity-0 group-hover:opacity-100"
                      onClick={() => catalogStore.uncurateMethod(svc.id, m.service, m.method)}
                    >
                      − из коллекции
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`curate-${m.method}`}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100"
                    onClick={() => catalogStore.curateMethod(svc.id, m.service, m.method)}
                  >
                    + в коллекцию
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
