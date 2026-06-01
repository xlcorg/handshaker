import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AppearancePane } from "./AppearancePane";
import { EditorPane } from "./EditorPane";
import { NetworkPane } from "./NetworkPane";
import { KeyboardPane } from "./KeyboardPane";
import { DataPane } from "./DataPane";
import { AboutPane } from "./AboutPane";
import { cn } from "@/lib/cn";

type Section = "appearance" | "editor" | "network" | "keyboard" | "data" | "about";

const SECTIONS: Array<[Section, string]> = [
  ["appearance", "Appearance"],
  ["editor", "Editor"],
  ["network", "Network"],
  ["keyboard", "Keyboard"],
  ["data", "Data & sync"],
  ["about", "About"],
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("appearance");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-3xl p-0 overflow-hidden sm:max-w-3xl">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Settings</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            Preferences persist locally. Restart not required.
          </p>
        </div>
        <div className="grid grid-cols-[180px_1fr] h-[700px] max-h-[calc(100vh-20px)]">
          <div className="border-r border-border p-2 flex flex-col gap-0.5 bg-muted/20 overflow-auto scroll-thin">
            {SECTIONS.map(([k, l]) => (
              <button
                type="button"
                key={k}
                onClick={() => setSection(k)}
                className={cn(
                  "h-8 px-2.5 rounded-md text-left text-xs transition-colors",
                  section === k
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="p-5 overflow-auto scroll-thin flex flex-col gap-5">
            {section === "appearance" && <AppearancePane />}
            {section === "editor" && <EditorPane />}
            {section === "network" && <NetworkPane />}
            {section === "keyboard" && <KeyboardPane />}
            {section === "data" && <DataPane />}
            {section === "about" && <AboutPane />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <h3 className="text-xs font-semibold text-foreground/85 tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

export function SettingsRow({
  title,
  hint,
  control,
}: {
  title: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border/60 last:border-0">
      <div className="grid gap-0.5">
        <div className="text-[12.5px] text-foreground">{title}</div>
        {hint && <div className="text-[11.5px] text-muted-foreground leading-snug">{hint}</div>}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}
