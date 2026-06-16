import { Kbd } from "@/components/ui/kbd";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

const ROWS: Array<[string, string[]]> = [
  ["Send request", ["Ctrl", "Enter"]],
  ["Toggle sidebar", ["Ctrl", "B"]],
  ["Word wrap", ["Alt", "Z"]],
];

export function KeyboardPane() {
  return (
    <SettingsGroup title="Shortcuts">
      {ROWS.map(([n, keys]) => (
        <SettingsRow
          key={n}
          title={n}
          control={
            <span className="flex items-center gap-1">
              {keys.map((k, i) => (
                <Kbd key={i}>{k}</Kbd>
              ))}
            </span>
          }
        />
      ))}
    </SettingsGroup>
  );
}
