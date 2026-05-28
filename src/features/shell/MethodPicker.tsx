import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import { deriveKind, shortService, type MethodKind, type SelectedMethod } from "./SelectedMethod";

export interface MethodPickerProps {
  selected: SelectedMethod;
  catalog: ServiceCatalogIpc;
  onSelect: (next: SelectedMethod) => void;
  maxLabel?: number;
  className?: string;
}

export function MethodPicker({ selected, catalog, onSelect, maxLabel = 160, className }: MethodPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    } else {
      setQ("");
    }
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.services
      .map((svc) => ({
        full: svc.full_name,
        short: shortService(svc.full_name),
        methods: svc.methods
          .map((m) => ({
            name: m.name,
            req: m.input_message,
            res: m.output_message,
            kind: deriveKind(m),
          }))
          .filter((m) =>
            needle ? (shortService(svc.full_name) + "." + m.name).toLowerCase().includes(needle) : true,
          ),
      }))
      .filter((svc) => svc.methods.length > 0);
  }, [catalog, q]);

  const triggerLabel = (
    <>
      <Box className="size-3 text-muted-foreground flex-none" />
      <span className="text-muted-foreground truncate" style={{ maxWidth: maxLabel }}>
        {shortService(selected.service)}
      </span>
      <span className="text-muted-foreground/50">/</span>
      <span className="text-foreground font-medium truncate" style={{ maxWidth: maxLabel }}>
        {selected.method}
      </span>
      {selected.kind !== "unary" && <KindBadge kind={selected.kind} />}
      <ChevronDown className="size-2.5 text-muted-foreground/70 ml-0.5 flex-none" />
    </>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-2 h-7 px-2 -ml-1.5 rounded-md transition-colors font-mono text-xs",
            "hover:bg-accent",
            open && "bg-accent",
            className,
          )}
        >
          {triggerLabel}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[420px] p-0 overflow-hidden">
        <div className="relative border-b border-border">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search className="size-3" />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find service.method…"
            className="w-full h-10 pl-9 pr-12 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Kbd>esc</Kbd>
          </span>
        </div>
        <div className="max-h-[360px] overflow-auto scroll-thin py-1">
          {groups.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">No methods match "{q}"</div>
          ) : (
            groups.map((svc) => (
              <div key={svc.full} className="pb-1">
                <div className="px-3 pt-2 pb-1 label-cap flex items-center gap-1.5">
                  <Box className="size-2.5 opacity-60" />
                  <span className="truncate">{svc.full}</span>
                </div>
                {svc.methods.map((m) => {
                  const active = selected.service === svc.full && selected.method === m.name;
                  return (
                    <button
                      type="button"
                      key={m.name}
                      onClick={() => {
                        onSelect({ service: svc.full, method: m.name, kind: m.kind });
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 pl-8 h-7 font-mono text-xs transition-colors text-left",
                        active ? "bg-accent text-foreground" : "text-foreground/85 hover:bg-accent/60",
                      )}
                    >
                      <span className="truncate flex-1">{m.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {m.req} → {m.res}
                      </span>
                      <KindDot kind={m.kind} />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KindBadge({ kind }: { kind: MethodKind }) {
  if (kind === "unary") return null;
  const label = kind === "server" ? "stream" : kind === "client" ? "client" : "bidi";
  return (
    <Badge variant="secondary" className="ml-1 font-mono text-[10px] gap-1 px-1.5 py-0 flex-none">
      <KindDot kind={kind} />
      {label}
    </Badge>
  );
}

function KindDot({ kind }: { kind: MethodKind }) {
  const cls =
    kind === "server" ? "bg-stream" :
    kind === "client" ? "bg-warn" :
    kind === "bidi"   ? "bg-purple-400" :
                        "bg-muted-foreground/50";
  return <span className={cn("h-1.5 w-1.5 rounded-full flex-none", cls)} aria-hidden />;
}
