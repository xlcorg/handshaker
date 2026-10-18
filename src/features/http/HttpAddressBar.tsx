import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import type { HttpMethodIpc, ResolutionReportIpc } from "@/ipc/bindings";
import { VarHighlightInput } from "@/features/vars/VarHighlightInput";
import type { VarCandidate } from "@/features/vars/candidates";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import type { ResolveKey } from "@/features/workflow/resolveKey";
import { HTTP_METHOD_META, HTTP_METHODS } from "./model";

export interface HttpAddressBarProps {
  method: HttpMethodIpc;
  url: string;
  running: boolean;
  canSend: boolean;
  onMethod: (method: HttpMethodIpc) => void;
  onUrl: (url: string) => void;
  onSend: () => void;
  onCancel: () => void;
  resolveUrl?: (t: string) => Promise<ResolutionReportIpc>;
  resolveKey?: ResolveKey;
  variables?: VarCandidate[];
}

export function HttpAddressBar({
  method,
  url,
  running,
  canSend,
  onMethod,
  onUrl,
  onSend,
  onCancel,
  resolveUrl,
  resolveKey,
  variables,
}: HttpAddressBarProps) {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <div className="flex h-8 min-w-[16rem] flex-1 items-center gap-1.5 rounded-md border border-input bg-background pr-1 focus-within:ring-1 focus-within:ring-ring">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={messages.http.addressBar.method}
              className={cn(
                "inline-flex h-full flex-none items-center gap-1 rounded-l-md border-r border-input px-2 font-mono text-xs font-semibold outline-none",
                "hover:bg-accent data-[state=open]:bg-accent focus-visible:bg-accent",
                HTTP_METHOD_META[method].tone,
              )}
            >
              {method}
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[9rem]">
            <DropdownMenuRadioGroup
              value={method}
              onValueChange={(next) => onMethod(next as HttpMethodIpc)}
            >
              {HTTP_METHODS.map((m) => (
                <DropdownMenuRadioItem
                  key={m}
                  value={m}
                  className="font-mono text-xs"
                >
                  <span className={cn("font-semibold", HTTP_METHOD_META[m].tone)}>
                    {m}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <VarHighlightInput
          ariaLabel={messages.http.addressBar.url}
          value={url}
          onChange={onUrl}
          placeholder={messages.http.addressBar.urlPlaceholder}
          resolver={resolveUrl}
          resolveKey={resolveKey}
          variables={variables}
          className="min-w-0 flex-1"
        />
      </div>
      {running ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="min-w-[5rem] text-muted-foreground"
        >
          {messages.workflow.addressBar.cancel}
        </Button>
      ) : (
        <Tooltip
          content={
            <span>
              <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> · <Kbd>Ctrl</Kbd> <Kbd>R</Kbd>
            </span>
          }
        >
          <Button
            size="sm"
            onClick={onSend}
            disabled={!canSend}
            className="min-w-[5rem] active:scale-[.97]"
          >
            {messages.workflow.addressBar.send}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
