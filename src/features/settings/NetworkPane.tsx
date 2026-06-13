import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { usePrefs, clampTimeoutMs } from "@/lib/use-prefs";

function RequestDeadlineRow() {
  const [prefs, setPref] = usePrefs();
  const [draft, setDraft] = useState(String(Math.round(prefs.requestTimeoutMs / 1000)));
  // Re-sync the seconds draft if the pref changes from elsewhere (matches the
  // codebase idiom of deriving pref-bound inputs from `prefs` on each render).
  useEffect(() => {
    setDraft(String(Math.round(prefs.requestTimeoutMs / 1000)));
  }, [prefs.requestTimeoutMs]);
  const commit = () => {
    const ms = clampTimeoutMs(Number(draft) * 1000);
    setPref("requestTimeoutMs", ms);
    setDraft(String(Math.round(ms / 1000)));
  };
  return (
    <SettingsRow
      title="Request deadline"
      hint="Per-request deadline; the call is cancelled if it exceeds this."
      control={
        <div className="flex items-center gap-1">
          <Input
            aria-label="Request deadline"
            type="number"
            min={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className="w-20 h-8 font-mono text-xs"
          />
          <span className="text-xs text-muted-foreground">s</span>
        </div>
      }
    />
  );
}

export function NetworkPane() {
  return (
    <SettingsGroup title="Timeouts">
      <RequestDeadlineRow />
    </SettingsGroup>
  );
}
