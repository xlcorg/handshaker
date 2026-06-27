import { ChevronDown, Minus, Plus } from "lucide-react";
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
import {
  usePrefs,
  type GrpcIconPref,
  type MethodGroupStyle,
  type VarHighlightScheme,
  ZOOM_MIN,
  ZOOM_MAX,
} from "@/lib/use-prefs";
import { nextZoom } from "@/features/shell/zoom";
import { isMacOS } from "@/lib/platform";

// Word-wrap toggle chord — platform-aware (plain ⌥Z is reserved for character input
// on macOS, so the Mac chord is ⌥⌘Z; see features/shell/wordWrap.ts).
const WORD_WRAP_CHORD = isMacOS ? "⌥⌘Z" : "Alt+Z";

const METHOD_GROUP_STYLES: { key: MethodGroupStyle; label: string; hint: string }[] = [
  { key: "band", label: "Band", hint: "Filled header strip" },
  { key: "tree", label: "Tree", hint: "Indent guide to methods" },
  { key: "weight", label: "Weight", hint: "Bold header, light methods" },
  { key: "card", label: "Card", hint: "Each service in a box" },
  { key: "bar", label: "Bar", hint: "Left accent bar" },
  { key: "chip", label: "Chip", hint: "Service name as a pill" },
  { key: "zebra", label: "Zebra", hint: "Header strip + striped rows" },
];

const VAR_HIGHLIGHT_SCHEMES: { key: VarHighlightScheme; label: string; hint: string }[] = [
  { key: "indigo", label: "Indigo", hint: "Editor identifier · red error" },
  { key: "amber", label: "Amber", hint: "Postman warm token · red error" },
  { key: "mono", label: "Mono", hint: "Neutral token · amber error" },
  { key: "teal", label: "Teal", hint: "Soft teal · rose error" },
  { key: "slate", label: "Slate", hint: "Slate token · amber error" },
  { key: "text", label: "Text only", hint: "No fill · colored text" },
];

export function AppearancePane() {
  const [prefs, setPref] = usePrefs();
  return (
    <>
      <SettingsGroup title="Display">
        <SettingsRow
          title="gRPC icon"
          hint="Style of the gRPC method icon in the request list. Off hides it."
          control={
            <ToggleGroup
              value={prefs.grpcIcon}
              onValueChange={(v) => setPref("grpcIcon", v as GrpcIconPref)}
              options={["off", "solid", "letter", "outline", "circle"]}
            />
          }
        />
        <SettingsRow
          title="Zoom"
          hint="UI scale. Ctrl+= / Ctrl+- to step, Ctrl+0 to reset."
          control={
            <div className="flex items-center gap-1.5">
              {prefs.zoom !== 1 && (
                <Button variant="ghost" size="xs" aria-label="Reset zoom" onClick={() => setPref("zoom", 1)}>
                  Reset
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="Zoom out"
                disabled={prefs.zoom <= ZOOM_MIN}
                onClick={() => setPref("zoom", nextZoom(prefs.zoom, "out"))}
              >
                <Minus />
              </Button>
              <span className="w-11 text-center font-mono text-xs tabular-nums">
                {Math.round(prefs.zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="Zoom in"
                disabled={prefs.zoom >= ZOOM_MAX}
                onClick={() => setPref("zoom", nextZoom(prefs.zoom, "in"))}
              >
                <Plus />
              </Button>
            </div>
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
      </SettingsGroup>

      <SettingsGroup title="Editor">
        <SettingsRow
          title="Word wrap"
          hint={`Wrap long lines in the request and response editors. ${WORD_WRAP_CHORD} toggles.`}
          control={
            <Switch checked={prefs.wordWrap} onCheckedChange={(v) => setPref("wordWrap", v)} />
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

      <SettingsGroup title="Variables">
        <SettingsRow
          title="Highlight colors"
          hint="Palette for {{var}} tokens in the address bar and variable editors — resolved vs unresolved."
          control={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label="var-highlight-scheme"
                  className="min-w-24 justify-between font-normal"
                >
                  <span className="flex items-center gap-2" data-vh-scheme={prefs.varHighlight}>
                    <span className="flex gap-1" aria-hidden>
                      <span className="vh-dot-resolved inline-block size-2.5 rounded-full" />
                      <span className="vh-dot-error inline-block size-2.5 rounded-full" />
                    </span>
                    {VAR_HIGHLIGHT_SCHEMES.find((s) => s.key === prefs.varHighlight)?.label ?? "Indigo"}
                  </span>
                  <ChevronDown className="opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={prefs.varHighlight}
                  onValueChange={(v) => setPref("varHighlight", v as VarHighlightScheme)}
                >
                  {VAR_HIGHLIGHT_SCHEMES.map((o) => (
                    <DropdownMenuRadioItem key={o.key} value={o.key} data-vh-scheme={o.key} className="gap-2">
                      <span className="flex gap-1" aria-hidden>
                        <span className="vh-dot-resolved inline-block size-2.5 rounded-full" />
                        <span className="vh-dot-error inline-block size-2.5 rounded-full" />
                      </span>
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
