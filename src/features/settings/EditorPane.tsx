import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

export function EditorPane() {
  return (
    <>
      <SettingsGroup title="JSON editor">
        <SettingsRow
          title="Format on save"
          hint="Run prettier before each Send."
          control={<Switch checked disabled onCheckedChange={() => undefined} />}
        />
        <SettingsRow
          title="Show line numbers"
          control={<Switch checked disabled onCheckedChange={() => undefined} />}
        />
        <SettingsRow
          title="Wrap long lines"
          control={<Switch checked={false} disabled onCheckedChange={() => undefined} />}
        />
        <SettingsRow
          title="Tab size"
          control={<ToggleGroup value="4" onValueChange={() => undefined} options={["2", "4", "8"]} />}
        />
      </SettingsGroup>
      <SettingsGroup title="Validation">
        <SettingsRow
          title="Validate against proto"
          hint="Show inline errors for unknown fields."
          control={<Switch checked disabled onCheckedChange={() => undefined} />}
        />
        <SettingsRow
          title="Autocomplete from descriptors"
          control={<Switch checked disabled onCheckedChange={() => undefined} />}
        />
      </SettingsGroup>
      <p className="text-[11px] text-muted-foreground">Editor options are read-only placeholders until wired up.</p>
    </>
  );
}
