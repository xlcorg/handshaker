import { MoreVertical, Plus } from "lucide-react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentIpc } from "@/ipc/bindings";

export interface EnvSwitcherMenuProps {
  envs: EnvironmentIpc[];
  activeEnv: string | null;
  /** Inner content of the DropdownMenuTrigger — typically the env-pill button. */
  trigger: React.ReactNode;
  onActiveSet: (name: string | null) => void;
  onEditEnv: (name: string) => void;
  onDeleteEnv: (name: string) => void;
  onNewEnv: () => void;
}

/** Postman-style env switcher with per-row direct manipulation.
 *
 * Visually mirrors {@link WorkflowSelector}'s menu: small uppercase header, plain
 * rows (active env is shown in the trigger, not marked in the list), and a
 * Plus-iconed "New env…" footer. Each real env row has a trailing ⋮ submenu
 * (Edit/Delete) that stops propagation so it does not switch the active env.
 */
export const EnvSwitcherMenu = forwardRef<HTMLButtonElement, EnvSwitcherMenuProps>(
  function EnvSwitcherMenu(props, triggerRef) {
    const { envs, activeEnv: _activeEnv, trigger, onActiveSet, onEditEnv, onDeleteEnv, onNewEnv } = props;
    const sorted = [...envs].sort((a, b) => a.name.localeCompare(b.name));

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Environments
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => onActiveSet(null)}
            className="italic text-muted-foreground"
          >
            No environment
          </DropdownMenuItem>
          {sorted.length > 0 && <DropdownMenuSeparator />}
          {sorted.map((env) => (
            <div key={env.name} className="flex items-center group">
              <DropdownMenuItem className="flex-1" onSelect={() => onActiveSet(env.name)}>
                {env.name}
              </DropdownMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Actions for ${env.name}`}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start">
                  <DropdownMenuItem onSelect={() => onEditEnv(env.name)}>Edit env…</DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onDeleteEnv(env.name)}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    Delete env…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewEnv}>
            <Plus className="size-3" /> New env…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
