import { Copy, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SavedRequestIpc } from "@/ipc/bindings";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import { DropLine } from "./DropLine";
import { zoneFromPointer } from "./dnd";
import type { TreeCallbacks } from "./treeTypes";
import { GrpcIcon } from "./GrpcIcon";
import { HttpMethodBadge } from "@/features/http/HttpMethodBadge";
import {
  GRPC_METHOD_MARK,
  HTTP_METHOD_COLUMN_CH,
  HTTP_METHOD_MARK,
} from "@/features/http/model";
import { bleedStyle } from "./bleed";
import { usePrefs, type GrpcIconPref } from "@/lib/use-prefs";
import { messages } from "@/lib/messages";

const m = messages.catalog.rowMenu;

const methodMarkClass =
  "inline-flex h-4 shrink-0 items-center justify-start whitespace-nowrap font-mono text-[9px] font-semibold leading-none";

const methodLabelClass =
  "text-[9px] font-semibold leading-none translate-y-[0.8px]";

const treeMarkInsetClass = "pl-4!";

const methodColumnStyle = { width: `${HTTP_METHOD_COLUMN_CH}ch` };

function RequestMark({
  req,
  grpcIcon,
}: {
  req: SavedRequestIpc;
  grpcIcon: GrpcIconPref;
}) {
  const mark =
    req.template.protocol === "http" ? (
      <HttpMethodBadge
        method={req.template.method}
        label={HTTP_METHOD_MARK[req.template.method]}
        className={methodLabelClass}
      />
    ) : grpcIcon === "off" ? null : grpcIcon === "letter" ? (
      <span
        aria-label="grpc"
        data-variant="letter"
        className={cn(methodLabelClass, "text-grpc")}
      >
        {GRPC_METHOD_MARK}
      </span>
    ) : (
      <GrpcIcon variant={grpcIcon} className="flex-none" />
    );
  return (
    <span
      data-method-column=""
      className={methodMarkClass}
      style={methodColumnStyle}
    >
      {mark}
    </span>
  );
}

export interface RequestRowProps {
  collectionId: string;
  req: SavedRequestIpc;
  /** Nesting level (1 = direct child of a collection). Drives the full-bleed highlight. */
  depth?: number;
  cb: TreeCallbacks;
}

export function RequestRow({
  collectionId,
  req,
  depth = 1,
  cb,
}: RequestRowProps) {
  const [{ grpcIcon }] = usePrefs();
  const editing = cb.editingId === req.id;
  const active = cb.activeItemId === req.id;
  const focused = cb.focusedId === req.id;
  const hint = cb.dropHint?.id === req.id ? cb.dropHint.zone : null;

  const items: RowMenuItem[] = [
    {
      icon: <Pencil />,
      label: m.rename,
      onClick: () => cb.onEditingChange(req.id),
    },
    {
      icon: <Copy />,
      label: m.duplicate,
      onClick: () => cb.onDuplicateItem(collectionId, req.id),
    },
    { sep: true },
    {
      icon: <Trash2 />,
      label: m.delete,
      danger: true,
      onClick: () => cb.onRequestDeleteItem(collectionId, req.id),
    },
  ];

  const dndHandlers = {
    draggable: !editing,
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      cb.onDragStartItem({ collectionId, itemId: req.id, kind: "request" });
    },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      cb.onDragOverRow(
        { collectionId, id: req.id, kind: "request" },
        zoneFromPointer(r, e.clientY, "request"),
      );
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      cb.onDropRow(
        { collectionId, id: req.id, kind: "request" },
        zoneFromPointer(r, e.clientY, "request"),
      );
    },
    onDragEnd: cb.onDragEndItem,
  };

  return (
    <SidebarMenuSubItem>
      <RowMenu items={items} depth={depth}>
        {editing ? (
          <div
            data-node-id={req.id}
            // `-translate-x-px` matches SidebarMenuSubButton: it cancels the
            // parent sub-menu's `translate-x-px`, so the rename field shares the row's x.
            className={cn(
              "group relative flex h-6 -translate-x-px items-center gap-0.5 pr-8 text-xs",
              treeMarkInsetClass,
            )}
          >
            <RequestMark req={req} grpcIcon={grpcIcon} />
            <RenameInput
              initial={req.name}
              onCommit={(name) => {
                cb.onEditingChange(null);
                cb.onRenameItem(collectionId, req.id, name);
              }}
              onCancel={() => cb.onEditingChange(null)}
            />
          </div>
        ) : (
          <SidebarMenuSubButton asChild isActive={active} size="sm">
            <div
              data-node-id={req.id}
              data-drop={hint ?? undefined}
              {...dndHandlers}
              onClick={() => cb.onOpenRequest(collectionId, req)}
              onDoubleClick={() => cb.onEditingChange(req.id)}
              // Full-bleed highlight: a request lives inside `depth` nested
              // <SidebarMenuSub> wrappers (see bleed.ts). We paint the hover/active
              // background on a ::before that breaks out of that inset back to the sidebar
              // edges, so the row highlights full-width Postman-style while the label stays
              // indented. `overflow-visible!` lets the ::before escape the button's clip;
              // `bg-transparent!` defers the bg to the ::before.
              style={bleedStyle(depth)}
              className={cn(
                "group relative isolate flex h-6! w-full items-center gap-0.5! overflow-visible! bg-transparent! pr-8",
                treeMarkInsetClass,
                "before:pointer-events-none before:absolute before:inset-y-0 before:left-[var(--bl)] before:right-[var(--br)] before:-z-10 before:rounded-md before:content-['']",
                "hover:before:bg-sidebar-accent/50",
                // Active (open) request: full-bleed accent + a left marker pinned to the
                // sidebar edge, so it's clearly distinct from a mere hover.
                active &&
                  "font-medium before:bg-sidebar-accent after:pointer-events-none after:absolute after:inset-y-0 after:left-[var(--bl)] after:w-[2px] after:rounded-full after:bg-primary",
                focused && "ring-1 ring-inset ring-ring",
                cb.dragId === req.id && "opacity-50",
              )}
            >
              {hint === "before" && <DropLine zone="before" />}
              {hint === "after" && <DropLine zone="after" />}
              <RequestMark req={req} grpcIcon={grpcIcon} />
              <span className="min-w-0 flex-1 truncate text-left">
                {req.name || req.template.method}
              </span>
            </div>
          </SidebarMenuSubButton>
        )}
      </RowMenu>
    </SidebarMenuSubItem>
  );
}
