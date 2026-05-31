import React, { useCallback, useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/cn";

export interface RowMenuItem {
  icon?: React.ReactNode;
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
  kbd?: string;
}

interface MenuPosition {
  x: number;
  y: number;
}

interface FloatingMenuProps {
  items: RowMenuItem[];
  pos: MenuPosition;
  onClose: () => void;
}

function FloatingMenu({ items, pos, onClose }: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll() {
      onClose();
    }

    // Defer the outside-pointerdown listener by one tick so the click that
    // opened the menu can't immediately close it.
    const id = setTimeout(
      () => document.addEventListener("pointerdown", onPointerDown, true),
      0,
    );
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  // Clamp to viewport
  const x = Math.min(pos.x, window.innerWidth - 184);
  const y = Math.min(pos.y, window.innerHeight - 8);

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", left: x, top: y, zIndex: 9999 }}
      className={cn(
        "min-w-[176px] rounded-md border border-border bg-popover shadow-md py-1",
        "text-popover-foreground",
      )}
    >
      {items.map((item, i) => {
        if (item.sep) {
          return <div key={i} className="-mx-0 my-1 h-px bg-border" />;
        }
        return (
          <button
            key={i}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left",
              "hover:bg-accent hover:text-accent-foreground",
              item.danger &&
                "text-destructive hover:bg-destructive/10 hover:text-destructive",
            )}
          >
            {item.icon && (
              <span className="flex-none text-muted-foreground [&_svg]:size-3.5">
                {item.icon}
              </span>
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.kbd && (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
                {item.kbd}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface RowMenuProps {
  items: RowMenuItem[];
  children: React.ReactNode;
  className?: string;
  /** Right-side padding offset for the ⋯ button (px). */
  padRight?: number;
}

/**
 * Row-level context menu component.
 *
 * Wraps `children` in a `group/row` container. The ⋯ button becomes visible on
 * hover or when the menu is open. Right-clicking the row opens the same menu at
 * the cursor position.
 */
export function RowMenu({ items, children, className, padRight = 4 }: RowMenuProps) {
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openAtBtn = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    // Right-align: position so menu's right edge aligns with button's right edge
    const x = rect.right - 176; // 176 ≈ min-w-[176px]
    const y = rect.bottom + 2;
    setMenuPos({ x: Math.max(4, x), y });
  }, []);

  const openAtCursor = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 184);
    const y = Math.min(e.clientY, window.innerHeight - 260);
    setMenuPos({ x, y });
  }, []);

  const close = useCallback(() => setMenuPos(null), []);

  const isOpen = menuPos !== null;

  return (
    <div
      className={cn("group/row relative", className)}
      onContextMenu={openAtCursor}
    >
      {children}

      {/* Hover ⋯ button */}
      <button
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) {
            close();
          } else {
            openAtBtn();
          }
        }}
        style={{ right: padRight }}
        aria-label="More options"
        className={cn(
          "absolute top-1/2 -translate-y-1/2 flex items-center justify-center",
          "h-5 w-5 rounded transition-opacity",
          "bg-background/85 backdrop-blur-sm",
          "text-muted-foreground hover:text-foreground",
          isOpen ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
        )}
      >
        <MoreVertical size={13} />
      </button>

      {isOpen && (
        <FloatingMenu items={items} pos={menuPos} onClose={close} />
      )}
    </div>
  );
}
