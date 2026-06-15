import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, Plus, Search } from "lucide-react";
import { ReflectionFooter, type ReflectionFooterProps } from "@/features/workflow/ReflectionFooter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/use-prefs";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import { deriveKind, shortService, type MethodKind, type SelectedMethod } from "./SelectedMethod";

export interface MethodPickerProps {
  selected: SelectedMethod;
  catalog: ServiceCatalogIpc | null;
  onSelect: (next: SelectedMethod) => void;
  className?: string;
  /** Draft-only: status + reload row at the bottom of the dropdown. Omit to hide. */
  reflection?: ReflectionFooterProps;
  /** Hover «+» on a method row: one-click save to the collection. Omit to hide. */
  onQuickAdd?: (service: string, method: string) => void;
}

export function MethodPicker({ selected, catalog, onSelect, className, reflection, onQuickAdd }: MethodPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [prefs] = usePrefs();

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
    return (catalog?.services ?? [])
      .map((svc) => ({
        full: svc.full_name,
        short: shortService(svc.full_name),
        methods: svc.methods
          .map((m) => ({
            name: m.name,
            kind: deriveKind(m),
          }))
          .filter((m) =>
            needle ? (shortService(svc.full_name) + "." + m.name).toLowerCase().includes(needle) : true,
          ),
      }))
      .filter((svc) => svc.methods.length > 0);
  }, [catalog, q]);

  const hasMethod = selected.method.trim().length > 0;
  const triggerLabel = (
    <>
      <Box className="size-3 text-muted-foreground flex-none" />
      {hasMethod ? (
        <>
          <span className="text-muted-foreground truncate min-w-0">
            {shortService(selected.service)}
          </span>
          <span className="text-muted-foreground/50 flex-none">/</span>
          <span className="text-foreground font-medium truncate min-w-0">
            {selected.method}
          </span>
          {selected.kind !== "unary" && <KindBadge kind={selected.kind} />}
          <ChevronDown className="size-2.5 text-muted-foreground/70 ml-auto flex-none" />
        </>
      ) : (
        <>
          <span className="text-muted-foreground truncate">Select a method</span>
          <ChevronDown className="size-2.5 text-muted-foreground/70 ml-auto flex-none" />
        </>
      )}
    </>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={hasMethod ? `${selected.service}/${selected.method}` : undefined}
          className={cn(
            "group inline-flex min-w-0 items-center gap-2 h-7 px-2 -ml-1.5 rounded-md transition-colors font-mono text-xs",
            "hover:bg-accent",
            open && "bg-accent",
            className,
          )}
        >
          {triggerLabel}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-[480px] max-w-[760px] p-0 overflow-hidden"
      >
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
        <div className="max-h-[360px] overflow-auto scroll-thin py-1" data-mp-style={prefs.methodGroupStyle}>
          {groups.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">No methods match "{q}"</div>
          ) : (
            groups.map((svc) => (
              <div key={svc.full} className="mp-grp pb-1">
                <div className="mp-ghead px-3 pt-2 pb-1 flex items-center gap-1.5 text-muted-foreground">
                  <Box className="size-2.5 flex-none opacity-60" />
                  <ServiceGroupLabel full={svc.full} short={svc.short} />
                </div>
                <div className="mp-gbody">
                  {svc.methods.map((m) => {
                    const active = selected.service === svc.full && selected.method === m.name;
                    return (
                      <div key={m.name} className="group/mrow relative">
                        <button
                          type="button"
                          data-active={active}
                          onClick={() => {
                            onSelect({ service: svc.full, method: m.name, kind: m.kind });
                            setOpen(false);
                          }}
                          className={cn(
                            "mp-mrow w-full flex items-center gap-2 px-3 pl-8 h-7 font-mono text-xs transition-colors text-left",
                            onQuickAdd && "pr-9",
                            active ? "bg-accent text-foreground" : "text-foreground/85 hover:bg-accent/60",
                          )}
                        >
                          <span className="mp-mname min-w-0 flex-1 truncate font-medium text-foreground">{m.name}</span>
                          <KindDot kind={m.kind} />
                        </button>
                        {onQuickAdd && (
                          <button
                            type="button"
                            aria-label={`Add ${m.name} to collection`}
                            title="Add to collection"
                            onClick={(e) => {
                              e.stopPropagation();
                              onQuickAdd(svc.full, m.name);
                              setOpen(false);
                            }}
                            className={cn(
                              "absolute right-2 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded",
                              "text-muted-foreground hover:bg-accent hover:text-foreground transition-opacity",
                              "opacity-0 group-hover/mrow:opacity-100 focus-visible:opacity-100",
                            )}
                          >
                            <Plus className="size-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
        {reflection && (
          <ReflectionFooter
            loading={reflection.loading}
            error={reflection.error}
            onRefresh={reflection.onRefresh}
            onCancel={reflection.onCancel}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Group header for a service. Shows the short service name (last dotted segment)
 * up front for quick reading, then the full dotted path as muted secondary text
 * that truncates from the right when it doesn't fit. The full path is always
 * available on hover via `title`.
 */
export function ServiceGroupLabel({ full, short }: { full: string; short: string }) {
  return (
    <span title={full} className="min-w-0 flex-1 flex items-baseline gap-2">
      <span className="mp-sname flex-none text-xs font-semibold text-foreground/85">{short}</span>
      <span className="mp-spath min-w-0 truncate font-mono text-[11px] text-muted-foreground/55">{full}</span>
    </span>
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
