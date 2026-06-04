import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
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
    <>
      <SettingsGroup title="Timeouts">
        <SettingsRow
          title="Connection timeout"
          control={<Input value="10s" readOnly className="w-24 h-8 font-mono text-xs" />}
        />
        <RequestDeadlineRow />
        <SettingsRow
          title="Keep-alive ping"
          control={<Input value="20s" readOnly className="w-24 h-8 font-mono text-xs" />}
        />
      </SettingsGroup>
      <SettingsGroup title="TLS">
        <SettingsRow
          title="Verify server certificate"
          hint="Disable for self-signed certs in dev."
          control={<Switch checked disabled onCheckedChange={() => undefined} />}
        />
        <SettingsRow
          title="ALPN negotiation"
          control={<ToggleGroup value="h2" onValueChange={() => undefined} options={["h2", "h2c"]} />}
        />
      </SettingsGroup>
      <SettingsGroup title="Proxy">
        <SettingsRow
          title="HTTP proxy"
          control={<span className="text-xs text-muted-foreground">Not configured</span>}
        />
      </SettingsGroup>
      <p className="text-[11px] text-muted-foreground">Other network options are read-only placeholders.</p>
    </>
  );
}
