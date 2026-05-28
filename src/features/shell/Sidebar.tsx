import { Bookmark, Clock, Layers, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export type SidebarTab = "services" | "history" | "saved";

export interface SidebarProps {
  tab: SidebarTab;
  onTabChange: (next: SidebarTab) => void;
  query: string;
  onQueryChange: (next: string) => void;
  servicesCount: number;
  historyCount: number;
  children: React.ReactNode;
}

export function Sidebar({
  tab,
  onTabChange,
  query,
  onQueryChange,
  servicesCount,
  historyCount,
  children,
}: SidebarProps) {
  return (
    <aside className="w-[260px] flex-none border-r border-border bg-background flex flex-col min-h-0">
      <div className="h-10 flex-none flex items-center justify-center gap-1.5 px-2 border-b border-border">
        <SideTabButton
          active={tab === "services"}
          onClick={() => onTabChange("services")}
          icon={<Layers className="size-3.5" />}
          label="Services"
          count={servicesCount}
        />
        <SideTabButton
          active={tab === "history"}
          onClick={() => onTabChange("history")}
          icon={<Clock className="size-3.5" />}
          label="History"
          count={historyCount}
        />
        <SideTabButton
          active={tab === "saved"}
          onClick={() => onTabChange("saved")}
          icon={<Bookmark className="size-3.5" />}
          label="Saved"
        />
      </div>
      <div className="px-2.5 py-2 flex-none border-b border-border">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search className="size-3" />
          </span>
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={
              tab === "services" ? "Filter services…" : tab === "history" ? "Filter history…" : "Filter saved…"
            }
            className="h-8 pl-7 pr-12 text-xs"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            <Kbd>⌘K</Kbd>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto scroll-thin px-1.5 pt-1 pb-3">{children}</div>
    </aside>
  );
}

interface SideTabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}

function SideTabButton({ active, onClick, icon, label, count }: SideTabButtonProps) {
  const tooltip = count !== undefined ? `${label} · ${count}` : label;
  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors relative",
          active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        )}
      >
        {icon}
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              "absolute -top-1 -right-1 h-3.5 min-w-[14px] px-1 rounded-full border border-background",
              "font-mono text-[9px] font-semibold tabular-nums flex items-center justify-center leading-none",
              active ? "bg-foreground text-background" : "bg-muted text-foreground/85",
            )}
          >
            {count}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
