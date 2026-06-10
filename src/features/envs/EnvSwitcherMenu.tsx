import { Pencil, Plus } from "lucide-react";
import { forwardRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { colorHex, resolveColorKey } from "./colors";

export interface EnvSwitcherMenuProps {
  /** Environments in user order (the backend list order is canonical). */
  envs: EnvironmentIpc[];
  /** Inner content of the DropdownMenuTrigger — typically the env-pill button. */
  trigger: React.ReactNode;
  onActiveSet: (name: string | null) => void;
  /** Open the env settings/edit dialog (which also offers delete). */
  onEditEnv: (name: string) => void;
  onNewEnv: () => void;
}

/** Postman-style env switcher matching {@link WorkflowSelector}'s menu: small
 * uppercase header with a right-aligned `+` (new env), "No environment" as a
 * plain muted row, then env rows in backend order. Each env row reveals a gear
 * on hover that opens the edit dialog (where the env can also be deleted). */
export const EnvSwitcherMenu = forwardRef<HTMLButtonElement, EnvSwitcherMenuProps>(
  function EnvSwitcherMenu(props, triggerRef) {
    const { envs, trigger, onActiveSet, onEditEnv, onNewEnv } = props;

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
              <Plus className="h-3.5 w-3.5" />
            </DropdownMenuItem>
          </div>
          <DropdownMenuItem onSelect={() => onActiveSet(null)} className="text-muted-foreground">
            No environment
          </DropdownMenuItem>
          {envs.map((env) => (
            <div key={env.name} className="group flex items-center">
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
                <Pencil className="h-3.5 w-3.5" />
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
