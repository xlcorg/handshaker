import { Minus, Moon, PanelLeft, Settings, Square, Sun, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrefs } from "@/lib/use-prefs";
import { cn } from "@/lib/cn";

export function Titlebar({
  envSlot,
  onOpenSettings,
}: {
  envSlot: React.ReactNode;
  onOpenSettings: () => void;
}) {
  const [prefs, setPref] = usePrefs();
  return (
    <div className="tb-drag h-9 flex-none flex items-center px-2.5 gap-2.5 bg-card border-b border-border select-none relative z-40">
      <div className="tb-nodrag flex items-center gap-2.5 min-w-0">
        <span className="flex items-center gap-1.5">
          <LogoMark size={13} className="text-foreground/85" />
          <span className="text-[13px] font-semibold tracking-tight text-foreground">Handshaker</span>
        </span>
        {envSlot}
      </div>
      <span className="flex-1" />
      <div className="tb-nodrag flex items-center gap-0.5 mr-1.5">
        <Tooltip content="Toggle sidebar" side="bottom">
          <button
            type="button"
            onClick={() => setPref("sidebar", !prefs.sidebar)}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={13} />
          </button>
        </Tooltip>
        <Tooltip content={prefs.theme === "dark" ? "Light mode" : "Dark mode"} side="bottom">
          <button
            type="button"
            onClick={() => setPref("theme", prefs.theme === "dark" ? "light" : "dark")}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Toggle theme"
          >
            {prefs.theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </Tooltip>
        <Tooltip content="Settings" side="bottom">
          <button
            type="button"
            onClick={onOpenSettings}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Settings"
          >
            <Settings size={13} />
          </button>
        </Tooltip>
      </div>
      <span className="h-3.5 w-px bg-border" />
      <div className="tb-nodrag flex items-center gap-0.5 ml-1.5">
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
