import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

export function DataPane() {
  return (
    <>
      <SettingsGroup title="Workspace">
        <SettingsRow
          title="Storage location"
          hint="OS app-data folder for Handshaker."
          control={
            <Button variant="outline" size="xs" disabled>
              Reveal
            </Button>
          }
        />
        <SettingsRow
          title="Sync to git"
          hint="Push collections and environments to a repo."
          control={<Switch checked={false} disabled onCheckedChange={() => undefined} />}
        />
      </SettingsGroup>
      <SettingsGroup title="History">
        <SettingsRow
          title="Retention"
          control={<ToggleGroup value="30d" onValueChange={() => undefined} options={["7d", "30d", "∞"]} />}
        />
        <SettingsRow
          title="Clear history"
          hint="Removes all logged requests on this machine."
          control={
            <Button variant="destructive" size="xs" disabled>
              Clear…
            </Button>
          }
        />
      </SettingsGroup>
      <p className="text-[11px] text-muted-foreground">Data and history are read-only placeholders until wired up.</p>
    </>
  );
}
