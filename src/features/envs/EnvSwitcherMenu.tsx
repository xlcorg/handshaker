import { Pencil, Plus } from "lucide-react";
import { forwardRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DropLine } from "@/features/catalog/DropLine";
import type { EnvironmentIpc } from "@/ipc/bindings";
import { isMacOS } from "@/lib/platform";

import { colorHex, resolveColorKey } from "./colors";
import { computeReorder } from "./reorder";

export interface EnvSwitcherMenuProps {
  /** Environments in user order (the backend list order is canonical). */
  envs: EnvironmentIpc[];
  /** Inner content of the DropdownMenuTrigger — typically the env-pill button. */
  trigger: React.ReactNode;
  onActiveSet: (name: string | null) => void;
  /** Open the env settings/edit dialog (which also offers delete). */
  onEditEnv: (name: string) => void;
  onNewEnv: () => void;
  /** Drag-and-drop reorder: receives the full new name order. Only fired when
   * the order actually changes. */
  onReorder: (names: string[]) => void;
}

type DropZone = "before" | "after";

/** Derive the insertion zone from the pointer's vertical position in the row. */
function zoneFromPointer(rect: DOMRect, clientY: number): DropZone {
  return clientY - rect.top < rect.height / 2 ? "before" : "after";
}

/** Postman-style env switcher (header typography matching {@link WorkflowSelector}'s
 * menu): small uppercase header with a right-aligned `+` (new env), "No environment"
 * as a plain muted row, then env rows in backend order — draggable to reorder
 * (thin DropLine insertion indicator, same affordance as the sidebar). Each env row
 * reveals a gear on hover that opens the edit dialog (where the env can also be
 * deleted). */
export const EnvSwitcherMenu = forwardRef<HTMLButtonElement, EnvSwitcherMenuProps>(
  function EnvSwitcherMenu(props, triggerRef) {
    const { envs, trigger, onActiveSet, onEditEnv, onNewEnv, onReorder } = props;
    const [dragName, setDragName] = useState<string | null>(null);
    const [hint, setHint] = useState<{ name: string; zone: DropZone } | null>(null);

    const clearDnd = () => {
      setDragName(null);
      setHint(null);
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          <div className="flex items-center justify-between">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Environments
            </DropdownMenuLabel>
            <DropdownMenuItem
              aria-label="New environment"
              onSelect={onNewEnv}
              className="mr-1 h-6 w-6 justify-center p-0"
            >
              <Plus />
            </DropdownMenuItem>
          </div>
          {/* font-extralight = Inter 200, loaded in main.tsx. The weight's .css
              must be imported or the face falls back (300→400); 200 reads as
              clearly thinner than 400 at 14px muted gray, where 300 did not. */}
          <DropdownMenuItem onSelect={() => onActiveSet(null)} className="font-extralight text-muted-foreground">
            No environment
          </DropdownMenuItem>
          {envs.map((env) => (
            <div
              key={env.name}
              data-env-row={env.name}
              draggable
              onDragStart={(e) => {
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", env.name);
                }
                setDragName(env.name);
              }}
              onDragOver={(e) => {
                if (!dragName) return;
                e.preventDefault();
                const zone = zoneFromPointer(e.currentTarget.getBoundingClientRect(), e.clientY);
                const wouldReorder =
                  computeReorder(envs.map((x) => x.name), dragName, env.name, zone) !== null;
                setHint(wouldReorder ? { name: env.name, zone } : null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragName && hint?.name === env.name) {
                  const next = computeReorder(
                    envs.map((x) => x.name),
                    dragName,
                    env.name,
                    hint.zone,
                  );
                  if (next) onReorder(next);
                }
                clearDnd();
              }}
              onDragEnd={clearDnd}
              // DropLine spans between the row's --bl/--br bleed vars (a sidebar
              // concept); zero them so the line covers exactly this row.
              className="group relative flex items-center [--bl:0px] [--br:0px]"
            >
              {hint?.name === env.name && <DropLine zone={hint.zone} />}
              <DropdownMenuItem className="flex-1 gap-2" onSelect={() => onActiveSet(env.name)}>
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorHex(resolveColorKey(env)) }}
                />
                {env.name}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Edit ${env.name}`}
                onSelect={() => onEditEnv(env.name)}
                className="mr-1 h-6 w-6 justify-center p-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Pencil />
              </DropdownMenuItem>
            </div>
          ))}
          <DropdownMenuSeparator />
          {/* Non-interactive footer hints for the global env hotkeys (wired in
              WorkflowEnvControl). Keycap glyphs are aria-hidden; labels carry meaning. */}
          <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground/70">
            <span>Cycle environment</span>
            <span aria-hidden>{isMacOS ? "⌘E" : "Ctrl+E"}</span>
          </div>
          <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground/70">
            <span>Edit environment</span>
            <span aria-hidden>{isMacOS ? "⇧⌘E" : "Ctrl+Shift+E"}</span>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
