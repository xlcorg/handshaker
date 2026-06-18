import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SortKey } from "./sort";

const OPTIONS: { key: SortKey; label: string }[] = [
  { key: "alpha", label: "Name" },
  { key: "created", label: "Created" },
  { key: "recent", label: "Recent" },
  { key: "frequency", label: "Frequency" },
];

export interface SortControlProps {
  value: SortKey;
  onChange: (key: SortKey) => void;
}

/** Global collection-sort selector (spec §5: alpha/created/recent/frequency). */
export function SortControl({ value, onChange }: SortControlProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="sort-collections"
          className="size-5 text-muted-foreground"
        >
          <ArrowUpDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as SortKey)}
        >
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.key} value={o.key}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
