import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export function Titlebar() {
  return (
    <div className="tb-drag h-8 flex-none flex items-center px-2.5 gap-2.5 bg-card border-b border-border select-none">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
        <LogoMark size={13} className="text-foreground/85" />
        Handshaker
      </span>
      <span className="flex-1" />
      <div className="tb-nodrag flex items-center gap-0.5">
        <Tooltip content="Minimize" side="left">
          <button
            type="button"
            onClick={() => getCurrentWindow().minimize()}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Minimize window"
          >
            <Minus size={11} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="Maximize" side="left">
          <button
            type="button"
            onClick={() => getCurrentWindow().toggleMaximize()}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Maximize window"
          >
            <Square size={9} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="Close" side="left">
          <button
            type="button"
            onClick={() => getCurrentWindow().close()}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
            aria-label="Close window"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function LogoMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(className)}
      aria-hidden
    >
      <path d="M4 9 L9 4 L13 8" />
      <path d="M20 15 L15 20 L11 16" />
      <path d="M8 12 L12 8 L16 12 L12 16 Z" />
    </svg>
  );
}
