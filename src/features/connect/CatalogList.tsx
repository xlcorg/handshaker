import type { ServiceCatalogIpc } from "@/ipc/bindings";
import type { SelectedMethod } from "@/features/invoke/InvokePanel";

export interface CatalogListProps {
  catalog: ServiceCatalogIpc;
  selected: SelectedMethod | null;
  onSelect: (m: SelectedMethod) => void;
}

export function CatalogList({ catalog, selected, onSelect }: CatalogListProps) {
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
            {s.methods.map((m) => {
              const isSelected =
                selected?.service === s.full_name && selected?.method === m.name;
              return (
                <li key={m.path}>
                  <button
                    type="button"
                    onClick={() => onSelect({ service: s.full_name, method: m.name })}
                    className={`text-left w-full hover:text-foreground transition-colors ${
                      isSelected ? "text-foreground font-medium" : ""
                    }`}
                  >
                    {m.name}
                    <span className="text-xs ml-2 text-muted-foreground">
                      ({m.input_message} → {m.output_message})
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
