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
    <select
      aria-label="sort-collections"
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      className="h-7 rounded border border-border bg-background px-1 text-xs text-foreground"
    >
      {OPTIONS.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
