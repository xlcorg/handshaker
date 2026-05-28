import { Moon, PanelLeft, Settings, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrefs } from "@/lib/use-prefs";

export interface ToolbarProps {
  version: string;
  envSlot: React.ReactNode;
  onOpenSettings: () => void;
}

export function Toolbar({ version, envSlot, onOpenSettings }: ToolbarProps) {
  const [prefs, setPref] = usePrefs();
  return (
    <div className="h-12 flex-none flex items-center px-3.5 gap-2.5 border-b border-border bg-background/85 backdrop-blur-sm relative">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold tracking-tight text-foreground">Handshaker</span>
        <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0 h-5">
          v{version}
        </Badge>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Tooltip content="Toggle sidebar">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPref("sidebar", !prefs.sidebar)}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content={prefs.theme === "dark" ? "Light mode" : "Dark mode"}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPref("theme", prefs.theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {prefs.theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
        </Tooltip>
        {envSlot}
        <Tooltip content="Settings">
          <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Settings">
            <Settings className="size-3.5" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
