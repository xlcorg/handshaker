import { cn } from "@/lib/cn";
import type { JsonKind, JsonNode } from "./jsonTree";
import { copyTextForNode, valuePreview } from "./copyValue";

export interface JsonRowViewProps {
  node: JsonNode;
  collapsed: boolean;       // meaningful only for containers
  isMatch: boolean;
  isActiveMatch: boolean;
  onToggle: (id: string) => void;
  onCopy: (node: JsonNode) => void;
}

const VALUE_CLASS: Record<JsonKind, string> = {
  string: "tok-str",
  number: "tok-num",
  boolean: "tok-bool",
  null: "tok-punct",
  object: "tok-punct",
  array: "tok-punct",
};

export function JsonRowView({
  node, collapsed, isMatch, isActiveMatch, onToggle, onCopy,
}: JsonRowViewProps) {
  const isContainer = node.kind === "object" || node.kind === "array";
  const label = node.key != null ? node.key : node.index != null ? String(node.index) : null;

  return (
    <div
      role="treeitem"
      aria-expanded={isContainer ? !collapsed : undefined}
      onDoubleClick={() => onCopy(node)}
      title={copyTextForNode(node)}
      style={{ paddingLeft: 8 + node.depth * 14 }}
      className={cn(
        "flex h-[22px] items-center gap-1.5 whitespace-pre pr-2 font-mono text-[12.5px] leading-[22px]",
        "cursor-default select-none hover:bg-accent/50",
        isMatch && "bg-[hsl(var(--syntax-num))]/15",
        isActiveMatch && "bg-[hsl(var(--syntax-num))]/35",
      )}
    >
      {isContainer ? (
        <button
          type="button"
          aria-label="toggle-node"
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          className="w-[1ch] text-muted-foreground"
        >
          {collapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className="w-[1ch]" aria-hidden />
      )}
      {label != null && (
        <>
          <span className="tok-key">{label}</span>
          <span className="tok-punct">:</span>
        </>
      )}
      <span className={VALUE_CLASS[node.kind]}>{valuePreview(node)}</span>
    </div>
  );
}
