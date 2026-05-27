import { MoreVertical } from "lucide-react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentIpc } from "@/ipc/bindings";

const NO_ENV_VALUE = "__no_env__"; // sentinel for DropdownMenuRadioGroup; null cannot be a value.

export interface EnvSwitcherMenuProps {
  envs: EnvironmentIpc[];
  activeEnv: string | null;
  /** Inner content of the DropdownMenuTrigger — typically the EnvPill button. */
  trigger: React.ReactNode;
  onActiveSet: (name: string | null) => void;
  onEditEnv: (name: string) => void;
  onDeleteEnv: (name: string) => void;
  onNewEnv: () => void;
}

/** Postman-style env switcher: per-row direct manipulation.
 *
 * Layout:
 *   <DropdownMenuLabel>Environments</DropdownMenuLabel>
 *   <DropdownMenuRadioGroup>
 *     <DropdownMenuRadioItem value="__no_env__">No environment</DropdownMenuRadioItem>
 *     <Separator />
 *     {envs.map(env => (
 *       <div className="flex items-center group">
 *         <DropdownMenuRadioItem value={env.name}>{env.name}</DropdownMenuRadioItem>
 *         <DropdownMenu>{...per-row submenu...}</DropdownMenu>
 *       </div>
 *     ))}
 *   </DropdownMenuRadioGroup>
 *   <Separator />
 *   <DropdownMenuItem>+ New env…</DropdownMenuItem>
 *
 * The trailing ⋮ button uses stopPropagation so the outer radio-group
 * does NOT interpret its click as a row-switch. radix portals the
 * inner DropdownMenu, so click-outside on the inner menu does not
 * bubble to the outer one. See spec §5.1 + R7.
 */
export const EnvSwitcherMenu = forwardRef<HTMLButtonElement, EnvSwitcherMenuProps>(
  function EnvSwitcherMenu(props, triggerRef) {
    const { envs, activeEnv, trigger, onActiveSet, onEditEnv, onDeleteEnv, onNewEnv } = props;
    const sorted = [...envs].sort((a, b) => a.name.localeCompare(b.name));
    const radioValue = activeEnv ?? NO_ENV_VALUE;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[14rem]">
          <DropdownMenuLabel>Environments</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={radioValue}
            onValueChange={(v) => onActiveSet(v === NO_ENV_VALUE ? null : v)}
          >
            <DropdownMenuRadioItem
              value={NO_ENV_VALUE}
              className="text-muted-foreground italic"
            >
              No environment
            </DropdownMenuRadioItem>
            {sorted.length > 0 && <DropdownMenuSeparator />}
            {sorted.map((env) => (
              <div key={env.name} className="flex items-center group">
                <DropdownMenuRadioItem value={env.name} className="flex-1">
                  {env.name}
                </DropdownMenuRadioItem>
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
                    <DropdownMenuItem onSelect={() => onEditEnv(env.name)}>
                      Edit env…
                    </DropdownMenuItem>
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
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewEnv}>+ New env…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
