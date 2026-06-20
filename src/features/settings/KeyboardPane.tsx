import { Kbd } from "@/components/ui/kbd";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

// Each action lists one or more equivalent chords (rendered "·"-separated).
const ROWS: Array<[string, string[][]]> = [
  ["Send request", [["Ctrl", "Enter"], ["Ctrl", "R"]]],
  ["Toggle sidebar", [["Ctrl", "B"]]],
  ["Word wrap", [["Alt", "Z"]]],
];

export function KeyboardPane() {
  return (
    <SettingsGroup title="Shortcuts">
      {ROWS.map(([n, combos]) => (
        <SettingsRow
          key={n}
          title={n}
          control={
            <span className="flex items-center gap-1">
              {combos.map((keys, ci) => (
                <span key={ci} className="flex items-center gap-1">
                  {ci > 0 && <span className="px-0.5 text-muted-foreground">·</span>}
                  {keys.map((k, i) => (
                    <Kbd key={i}>{k}</Kbd>
                  ))}
                </span>
              ))}
            </span>
          }
        />
      ))}
    </SettingsGroup>
  );
}
