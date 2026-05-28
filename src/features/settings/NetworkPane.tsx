import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

export function NetworkPane() {
  return (
    <>
      <SettingsGroup title="Timeouts">
        <SettingsRow
          title="Connection timeout"
          control={<Input value="10s" readOnly className="w-24 h-8 font-mono text-xs" />}
        />
        <SettingsRow
          title="Request deadline"
          control={<Input value="30s" readOnly className="w-24 h-8 font-mono text-xs" />}
        />
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
      <p className="text-[11px] text-muted-foreground">Network options are read-only placeholders.</p>
    </>
  );
}
