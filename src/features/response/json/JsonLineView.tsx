import { cn } from "@/lib/cn";
import type { JsonKind, JsonNode } from "./jsonTree";
import type { JsonLine } from "./jsonLines";
import { valueLiteral } from "./copyValue";

const LITERAL_CLASS: Record<JsonKind, string> = {
  string: "tok-str",
  number: "tok-num",
  boolean: "tok-bool",
  null: "tok-punct",
  object: "tok-punct",
  array: "tok-punct",
};

export interface JsonLineViewProps {
  line: JsonLine;
  node: JsonNode;
  lineNumber: number;
  isMatch: boolean;
  isActiveMatch: boolean;
  onToggle: (id: string) => void;
  onCopy: (node: JsonNode) => void;
}

export function JsonLineView({
  line, node, lineNumber, isMatch, isActiveMatch, onToggle, onCopy,
}: JsonLineViewProps) {
  const isContainer = node.kind === "object" || node.kind === "array";
  const canFold = isContainer && node.childCount > 0 && (line.kind === "open" || line.kind === "folded");
  const openBracket = node.kind === "array" ? "[" : "{";
  const closeBracket = node.kind === "array" ? "]" : "}";
  const showKey = node.key != null && line.kind !== "close";

  const content = () => {
    switch (line.kind) {
      case "open":
        return <span className="tok-punct">{openBracket}</span>;
      case "close":
        return <span className="tok-punct">{line.trailingComma ? `${closeBracket},` : closeBracket}</span>;
      case "folded":
        return (
          <span className="tok-punct">
            {openBracket} … {closeBracket}{line.trailingComma ? "," : ""}
          </span>
        );
      case "leaf":
        return (
          <>
            <span className={LITERAL_CLASS[node.kind]}>{valueLiteral(node)}</span>
            {line.trailingComma && <span className="tok-punct">,</span>}
          </>
        );
    }
  };

  return (
    <div
      role="treeitem"
      aria-expanded={canFold ? line.kind === "open" : undefined}
      onDoubleClick={() => onCopy(node)}
      className={cn(
        "flex h-[22px] items-center whitespace-pre pr-2 font-mono text-[12.5px] leading-[22px]",
        "cursor-default select-none hover:bg-accent/50",
        isMatch && "bg-[hsl(var(--syntax-num))]/15",
        isActiveMatch && "bg-[hsl(var(--syntax-num))]/35",
      )}
    >
      {/* Fixed line-number gutter — stays put regardless of nesting depth. */}
      <span className="w-[3.5ch] flex-none select-none border-r border-border/40 pr-2 text-right tabular-nums text-[11px] text-muted-foreground/50">
        {lineNumber}
      </span>
      {/* Indented content — only this shifts with depth. */}
      <div className="flex items-center" style={{ paddingLeft: 8 + line.depth * 14 }}>
        {canFold ? (
          <button
            type="button"
            aria-label="toggle-node"
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            className="mr-1 w-[1ch] text-muted-foreground"
          >
            {line.kind === "folded" ? "▸" : "▾"}
          </button>
        ) : (
          <span className="mr-1 w-[1ch]" aria-hidden />
        )}
        {showKey && (
          <>
            <span className="tok-key">"{node.key}"</span>
            <span className="tok-punct">: </span>
          </>
        )}
        {content()}
      </div>
    </div>
  );
}
