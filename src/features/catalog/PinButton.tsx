import { Pin } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/cn";

export interface PinButtonProps {
  pinned: boolean;
  onToggle: () => void;
}

/** Collection pin toggle. Hover-only, but always visible when pinned (spec §5). */
export function PinButton({ pinned, onToggle }: PinButtonProps) {
  return (
    <Toggle
      aria-label={pinned ? "unpin-collection" : "pin-collection"}
      pressed={pinned}
      onPressedChange={onToggle}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex h-5 w-5 flex-none items-center justify-center rounded text-muted-foreground hover:text-foreground",
        pinned ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
      )}
    >
      <Pin className={cn("size-3.5", pinned && "fill-current")} />
    </Toggle>
  );
}
