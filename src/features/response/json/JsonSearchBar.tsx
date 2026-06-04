import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface JsonSearchBarProps {
  query: string;
  matchCount: number;
  activeIndex: number; // 0-based; -1 when no matches
  onQuery: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function JsonSearchBar({
  query, matchCount, activeIndex, onQuery, onNext, onPrev, onClose,
}: JsonSearchBarProps) {
  const display = matchCount === 0 ? "0/0" : `${activeIndex + 1}/${matchCount}`;

  return (
    <div className="flex flex-none items-center gap-1.5 border-b border-border bg-background/90 px-2 py-1">
      <Input
        autoFocus
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Поиск в ответе…"
        className="h-6 flex-1 text-xs"
      />
      <span className="min-w-[3ch] text-center font-mono text-[11px] tabular-nums text-muted-foreground">
        {display}
      </span>
      <button type="button" aria-label="prev-match" onClick={onPrev} className="text-muted-foreground hover:text-foreground">
        <ChevronUp className="size-4" />
      </button>
      <button type="button" aria-label="next-match" onClick={onNext} className="text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-4" />
      </button>
      <button type="button" aria-label="close-search" onClick={onClose} className="text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
}
