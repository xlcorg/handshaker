import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { Switch } from "@/components/ui/switch";
import { usePrefs } from "@/lib/use-prefs";
import { messages } from "@/lib/messages";

const t = messages.settings.history;

export function HistoryPane() {
  const [prefs, setPref] = usePrefs();
  return (
    <SettingsGroup title={t.group}>
      <SettingsRow
        title={t.confirmClear}
        hint={t.confirmClearHint}
        control={
          <Switch
            checked={prefs.confirmClearHistory}
            aria-label={t.confirmClear}
            onCheckedChange={(v) => setPref("confirmClearHistory", v)}
          />
        }
      />
    </SettingsGroup>
  );
}
