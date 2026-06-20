export interface KVRow {
  k: string;
  v: string;
}

export function KVTable({ rows }: { rows: KVRow[] }) {
  if (rows.length === 0) {
    return <div className="p-4 text-xs text-muted-foreground italic">(no entries)</div>;
  }
  return (
    <div className="flex-1 overflow-auto scroll-thin">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[200px_1fr] border-b border-border/60 font-mono text-[11px]">
          <div className="px-4 py-2 text-[hsl(var(--syntax-key))]">{r.k}</div>
          <div className="px-4 py-2 text-foreground break-all">{r.v}</div>
        </div>
      ))}
    </div>
  );
}
