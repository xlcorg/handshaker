import React from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import { actionRight } from "./bleed";
import { compactFocusRing } from "@/lib/focusRing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export interface RowMenuItem {
  icon?: React.ReactNode;
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
  kbd?: string;
}

export interface RowMenuProps {
  items: RowMenuItem[];
  children: React.ReactNode;
  className?: string;
  /** Right-side padding offset for the ⋯ button (px). */
  padRight?: number;
  /** Nesting depth of the row, used to pin the ⋯ button to the sidebar edge. */
  depth?: number;
}

/** Render the shared item list with a given menu kind's Item/Separator primitives. */
function renderItems(items: RowMenuItem[], Item: React.ElementType, Separator: React.ElementType) {
  return items.map((item, i) =>
    item.sep ? (
      <Separator key={i} />
    ) : (
      <Item
        key={i}
        variant={item.danger ? "destructive" : "default"}
        onSelect={() => item.onClick?.()}
      >
        {item.icon}
        <span className="flex-1 truncate">{item.label}</span>
        {item.kbd ? (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
            {item.kbd}
          </span>
        ) : null}
      </Item>
    ),
  );
}

/**
 * Row-level menu. The ⋯ button (visible on hover / when open) opens a Radix
 * DropdownMenu anchored to it; right-clicking anywhere on the row opens the same
 * items as a Radix ContextMenu at the cursor. Radix portals both to the document
 * root and handles positioning, keyboard nav, focus and ARIA.
 */
export function RowMenu({ items, children, className, padRight = 4, depth = 0 }: RowMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn("group/row relative", className)}>
          {children}

          {/* Hover ⋯ button, pinned to the sidebar edge regardless of nesting depth. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More options"
                style={{ right: actionRight(depth, padRight) }}
                className={cn(
                  "absolute top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded",
                  "text-muted-foreground transition-opacity hover:bg-sidebar-accent hover:text-foreground",
                  "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100",
                  compactFocusRing,
                )}
              >
                <MoreVertical size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="bottom"
              className="min-w-[176px]"
              // Keep focus where the action sends it (e.g. the rename input) instead of
              // snapping back to the ⋯ trigger.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {renderItems(items, DropdownMenuItem, DropdownMenuSeparator)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent
        className="min-w-[176px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {renderItems(items, ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
