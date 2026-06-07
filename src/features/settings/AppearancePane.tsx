import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { usePrefs, type GrpcIconStyle } from "@/lib/use-prefs";

export function AppearancePane() {
  const [prefs, setPref] = usePrefs();
  return (
    <>
      <SettingsGroup title="Theme">
        <SettingsRow
          title="Mode"
          hint="Dark or light. Stored locally."
          control={
            <ToggleGroup
              value={prefs.theme}
              onValueChange={(v) => setPref("theme", v as "dark" | "light")}
              options={["dark", "light"]}
            />
          }
        />
        <SettingsRow
          title="Density"
          hint="Row height and padding across the app."
          control={
            <ToggleGroup
              value={prefs.density}
              onValueChange={(v) => setPref("density", v as "compact" | "regular" | "cozy")}
              options={["compact", "regular", "cozy"]}
            />
          }
        />
        <SettingsRow
          title="gRPC icon"
          hint="Style of the gRPC method icon in the request list."
          control={
            <ToggleGroup
              value={prefs.grpcIcon}
              onValueChange={(v) => setPref("grpcIcon", v as GrpcIconStyle)}
              options={["solid", "letter", "outline", "circle"]}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <SettingsRow
          title="Sidebar"
          hint="Show the collections sidebar."
          control={<Switch checked={prefs.sidebar} onCheckedChange={(v) => setPref("sidebar", v)} />}
        />
        <SettingsRow
          title="Split direction"
          hint="Request and response orientation."
          control={
            <ToggleGroup
              value={prefs.split}
              onValueChange={(v) => setPref("split", v as "horizontal" | "vertical")}
              options={[
                { value: "horizontal", label: "Top / Bottom" },
                { value: "vertical", label: "Left / Right" },
              ]}
            />
          }
        />
        <SettingsRow
          title="Dotted background"
          hint="Subtle grid that reacts to cursor."
          control={<Switch checked={prefs.dots} onCheckedChange={(v) => setPref("dots", v)} />}
        />
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <SettingsRow
          title="Interface font"
          hint="Used everywhere except code editors."
          control={
            <ToggleGroup
              value={prefs.fontUi}
              onValueChange={(v) => setPref("fontUi", v as "inter" | "geist" | "system")}
              options={["inter", "geist", "system"]}
            />
          }
        />
        <SettingsRow
          title="Mono font"
          hint="Used in editors, code and metadata."
          control={
            <ToggleGroup
              value={prefs.fontMono}
              onValueChange={(v) => setPref("fontMono", v as "jetbrains" | "geist-mono" | "ibm")}
              options={[
                { value: "jetbrains", label: "JetBrains" },
                { value: "geist-mono", label: "Geist" },
                { value: "ibm", label: "IBM Plex" },
              ]}
            />
          }
        />
      </SettingsGroup>
    </>
  );
}
