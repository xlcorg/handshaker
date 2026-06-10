import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { deriveRows } from "./tree";

export interface ContractTreeProps {
  schema: MessageSchemaIpc;
}

/** Read-only field tree over a flat MessageSchema. Expansion is local state —
 *  it resets with the panel, deliberately (no persistence per spec). */
export function ContractTree({ schema }: ContractTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => deriveRows(schema, expanded), [schema, expanded]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (rows.length === 0) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">No fields</div>;
  }

  return (
    <div className="py-1 font-mono text-xs leading-6">
      {/* Indent: 14px per depth level. Field rows add 8px base; oneof headers add 26px
          (8px base + the 18px chevron-slot width) so their text aligns with field names. */}
      {rows.map((row) =>
        row.kind === "oneof" ? (
          <div
            key={row.path}
            style={{ paddingLeft: `${row.depth * 14 + 26}px` }}
            className="text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            oneof {row.label}
          </div>
        ) : (
          <div
            key={row.path}
            style={{ paddingLeft: `${row.depth * 14 + 8}px` }}
            className="flex items-center gap-1 pr-3"
          >
            {row.expandable ? (
              <button
                type="button"
                onClick={() => toggle(row.path)}
                aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.field.json_name}`}
                className="flex size-4 flex-none items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn("size-3 transition-transform", row.expanded && "rotate-90")} />
              </button>
            ) : (
              <span className="size-4 flex-none" aria-hidden />
            )}
            <span title={row.field.proto_name} className="truncate text-foreground">
              {row.field.json_name}
            </span>
            {row.recursive ? (
              <span title="recursive" aria-label="recursive" className="text-muted-foreground">↻</span>
            ) : null}
            <span className="ml-auto flex-none pl-3 text-muted-foreground">
              {row.field.type_label}
              {row.enumValues ? `: ${row.enumValues.join(" | ")}` : ""}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
