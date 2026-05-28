import { useEffect, useMemo, useState } from "react";
import { Box, ChevronRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import { deriveKind, shortService, type MethodKind, type SelectedMethod } from "./SelectedMethod";

export interface SidebarServicesPaneProps {
  connected: boolean;
  catalog: ServiceCatalogIpc | null;
  query: string;
  selected: SelectedMethod | null;
  onSelect: (next: SelectedMethod) => void;
}

export function SidebarServicesPane({ connected, catalog, query, selected, onSelect }: SidebarServicesPaneProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  // Default-expand all services on catalog arrival.
  useEffect(() => {
    if (catalog) setOpen(new Set(catalog.services.map((s) => s.full_name)));
  }, [catalog]);

  const groups = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    return catalog.services
      .map((svc) => ({
        full: svc.full_name,
        short: shortService(svc.full_name),
        methods: svc.methods.filter((m) =>
          needle ? (shortService(svc.full_name) + "." + m.name).toLowerCase().includes(needle) : true,
        ),
      }))
      .filter((svc) => svc.methods.length > 0);
  }, [catalog, query]);

  if (!connected) {
    return (
      <div className="px-3 py-6 text-xs text-muted-foreground leading-relaxed">
        <div className="text-foreground/70 text-xs mb-1.5">Not connected</div>
        <div>
          Connect to a host above and we'll discover services via gRPC reflection. Or import a .proto file.
        </div>
        <Button variant="outline" size="sm" className="mt-3 gap-1.5">
          <Upload className="size-3" /> Import .proto
        </Button>
      </div>
    );
  }

  return (
    <>
      {groups.map((svc) => {
        const isOpen = open.has(svc.full);
        return (
          <div key={svc.full} className="mb-0.5">
            <button
              type="button"
              onClick={() => {
                const n = new Set(open);
                if (n.has(svc.full)) n.delete(svc.full); else n.add(svc.full);
                setOpen(n);
              }}
              className="group flex w-full items-center gap-2 rounded-md px-2 h-7 text-[12.5px] text-foreground/85 hover:bg-accent hover:text-foreground transition-colors"
            >
              <span className={cn("transition-transform text-muted-foreground", isOpen && "rotate-90")}>
                <ChevronRight className="size-2.5" />
              </span>
              <Box className="size-3 text-muted-foreground" />
              <span className="truncate flex-1 text-left" title={svc.full}>
                {svc.short}
              </span>
            </button>
            {isOpen &&
              svc.methods.map((m) => {
                const kind = deriveKind(m);
                const active =
                  selected?.service === svc.full && selected?.method === m.name;
                return (
                  <button
                    type="button"
                    key={m.name}
                    onClick={() => onSelect({ service: svc.full, method: m.name, kind })}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md pl-8 pr-2 h-7 font-mono text-[11.5px] transition-colors",
                      active
                        ? "bg-accent text-foreground"
                        : "text-foreground/75 hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <span className="truncate flex-1 text-left">{m.name}</span>
                    <KindPill kind={kind} />
                  </button>
                );
              })}
          </div>
        );
      })}
    </>
  );
}

function KindPill({ kind }: { kind: MethodKind }) {
  const cls =
    kind === "server" ? "text-stream bg-stream/10" :
    kind === "client" ? "text-warn bg-warn/10" :
    kind === "bidi"   ? "text-purple-400 bg-purple-400/10" :
                        "text-muted-foreground bg-muted";
  const label = kind === "server" ? "S→" : kind === "client" ? "→C" : kind === "bidi" ? "↔" : "U";
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono font-semibold text-[9.5px] tracking-wider px-1.5 py-px rounded",
        cls,
      )}
    >
      {label}
    </span>
  );
}
