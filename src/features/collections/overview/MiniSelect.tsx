import { ChevronDown, Lock, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export interface MiniSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

interface MiniSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: MiniSelectOption[];
  className?: string;
}

export function MiniSelect({ value, onChange, options, className }: MiniSelectProps) {
  const cur = options.find((o) => o.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center justify-between gap-2 h-8 rounded-md border border-input bg-background px-2.5 text-[12.5px] hover:bg-accent/50 transition-colors",
            className,
          )}
        >
          <span className="truncate">{cur?.label ?? "Select…"}</span>
          <ChevronDown size={13} className="opacity-50 flex-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--w,200px)] min-w-[180px]">
        {options.map((o) =>
          o.disabled ? (
            <Tooltip key={o.value} side="right" content={o.hint ?? ""}>
              <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[12.5px] text-muted-foreground/40 cursor-not-allowed select-none">
                <span className="flex-1">{o.label}</span>
                <Lock size={11} className="opacity-70" />
              </div>
            </Tooltip>
          ) : (
            <DropdownMenuItem
              key={o.value}
              onClick={() => onChange(o.value)}
              className={cn(o.value === value && "bg-accent")}
            >
              <span className="flex-1 text-left">{o.label}</span>
              {o.value === value && <Check size={13} />}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
