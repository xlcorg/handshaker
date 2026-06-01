import { useState } from "react";
import { Input } from "@/components/ui/input";
import { TooltipRoot, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { SavedRequestIpc } from "@/ipc/bindings";
import { ReqTypeTag } from "./ReqTypeTag";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { Pencil, Copy, Trash2, FileText } from "lucide-react";

export interface RequestRowProps {
  collectionId: string;
  req: SavedRequestIpc;
  /** Nesting depth (0 = directly under collection). Controls left indent. */
  depth: number;
  activeItemId: string | null;
  onSelectRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onRenameItem: (collectionId: string, itemId: string, name: string) => void;
  onDeleteItem: (collectionId: string, itemId: string) => void;
}

export function RequestRow({
  collectionId,
  req,
  depth,
  activeItemId,
  onSelectRequest,
  onRenameItem,
  onDeleteItem,
}: RequestRowProps) {
  const [editing, setEditing] = useState(false);
  const active = req.id === activeItemId;
  const hasName = req.name.trim().length > 0;
  const label = hasName ? req.name : req.method;

  // Indent: 20px chevron gutter + 14px per nesting level.
  const padLeft = 20 + depth * 14;

  const tipTitle = req.service ? `${req.service}.${req.method}` : req.method;

  const items: RowMenuItem[] = [
    {
      icon: <FileText />,
      label: "Open",
      onClick: () => onSelectRequest(collectionId, req),
    },
    { icon: <Pencil />, label: "Rename", onClick: () => setEditing(true) },
    {
      icon: <Copy />,
      label: "Duplicate",
      onClick: () => console.debug("[collections] duplicate request (stub)", req.id),
    },
    { sep: true },
    {
      icon: <Trash2 />,
      label: "Delete",
      danger: true,
      onClick: () => onDeleteItem(collectionId, req.id),
    },
  ];

  if (editing) {
    return (
      <div
        className="relative flex !h-[22px] items-center"
        style={{ paddingLeft: padLeft, paddingRight: 8 }}
      >
        <ReqTypeTag />
        <RenameInput
          initial={req.name}
          onCommit={(name) => {
            setEditing(false);
            const trimmed = name.trim();
            if (trimmed && trimmed !== req.name) onRenameItem(collectionId, req.id, trimmed);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <RowMenu items={items} className="rounded-md" padRight={4}>
      <TooltipRoot delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onSelectRequest(collectionId, req)}
            style={{ paddingLeft: padLeft }}
            className={cn(
              "group/req relative flex !h-[22px] w-full items-center gap-1.5 rounded-md pr-7 !text-[11.5px] transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-foreground/75 hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-[14px] w-[2px] -translate-y-1/2 rounded-full bg-foreground" />
            )}
            <ReqTypeTag />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                hasName ? "font-sans" : "font-mono",
              )}
            >
              {label}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[280px]">
          <div className="font-mono text-[11px]">{tipTitle}</div>
          {req.address_template && (
            <div className="font-mono text-[10.5px] text-muted-foreground">
              {req.address_template}
            </div>
          )}
        </TooltipContent>
      </TooltipRoot>
    </RowMenu>
  );
}

interface RenameInputProps {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

export function RenameInput({ initial, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-[18px] min-w-0 flex-1 px-1.5 py-0 !text-[11.5px]"
    />
  );
}
