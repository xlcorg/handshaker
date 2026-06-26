import { Kbd } from "@/components/ui/kbd";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { isMacOS } from "@/lib/platform";
import { messages } from "@/lib/messages";

// Word-wrap chord differs by OS: plain ⌥Z is reserved for character input on macOS,
// so the Mac chord is ⌥⌘Z (see features/shell/wordWrap.ts).
const WORD_WRAP_KEYS = isMacOS ? ["⌥", "⌘", "Z"] : ["Alt", "Z"];

// Split direction chord: plain ⌥V is reserved on macOS, so the Mac chord is ⌥⌘V.
const SPLIT_KEYS = isMacOS ? ["⌥", "⌘", "V"] : ["Alt", "V"];

// Each action lists one or more equivalent chords (rendered "·"-separated).
const ROWS: Array<[string, string[][]]> = [
  [messages.shell.keyboard.sendRequest, [["Ctrl", "Enter"], ["Ctrl", "R"]]],
  [messages.shell.keyboard.toggleSidebar, [["Ctrl", "B"]]],
  [messages.shell.keyboard.wordWrap, [WORD_WRAP_KEYS]],
  [messages.shell.keyboard.splitDirection, [SPLIT_KEYS]],
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
