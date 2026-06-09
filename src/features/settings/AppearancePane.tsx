import { ChevronDown } from "lucide-react";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePrefs, type GrpcIconStyle, type MethodGroupStyle } from "@/lib/use-prefs";

const METHOD_GROUP_STYLES: { key: MethodGroupStyle; label: string; hint: string }[] = [
  { key: "band", label: "Band", hint: "Filled header strip" },
  { key: "tree", label: "Tree", hint: "Indent guide to methods" },
  { key: "weight", label: "Weight", hint: "Bold header, light methods" },
  { key: "card", label: "Card", hint: "Each service in a box" },
  { key: "bar", label: "Bar", hint: "Left accent bar" },
  { key: "chip", label: "Chip", hint: "Service name as a pill" },
  { key: "zebra", label: "Zebra", hint: "Header strip + striped rows" },
];

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

      <SettingsGroup title="Method picker">
        <SettingsRow
          title="Group style"
          hint="How service groups are separated from their methods in the method dropdown."
          control={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label="method-list-style"
                  className="min-w-24 justify-between font-normal"
                >
                  {METHOD_GROUP_STYLES.find((s) => s.key === prefs.methodGroupStyle)?.label ?? "Band"}
                  <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={prefs.methodGroupStyle}
                  onValueChange={(v) => setPref("methodGroupStyle", v as MethodGroupStyle)}
                >
                  {METHOD_GROUP_STYLES.map((o) => (
                    <DropdownMenuRadioItem key={o.key} value={o.key} className="gap-2">
                      <span className="font-medium">{o.label}</span>
                      <span className="text-muted-foreground text-[11px]">{o.hint}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </SettingsGroup>
    </>
  );
}
