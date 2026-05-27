import type { ServiceCatalogIpc } from "@/ipc/bindings";

export interface CatalogListProps {
  catalog: ServiceCatalogIpc;
}

export function CatalogList({ catalog }: CatalogListProps) {
  if (catalog.services.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No services in catalog.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {catalog.services.map((s) => (
        <li key={s.full_name} className="flex flex-col gap-1">
          <div className="font-semibold font-mono text-sm">{s.full_name}</div>
          <ul className="flex flex-col gap-0.5 pl-4 text-sm font-mono text-muted-foreground">
            {s.methods.map((m) => (
              <li key={m.path}>
                {m.name}
                <span className="text-xs ml-2">
                  ({m.input_message} → {m.output_message})
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
