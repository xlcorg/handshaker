import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import {
  usePrefs,
  clampTimeoutMs,
  MESSAGE_SIZE_STOPS,
  stopIndexFor,
  formatMessageSize,
} from "@/lib/use-prefs";
import { messages } from "@/lib/messages";

const t = messages.settings.network;

function RequestDeadlineRow() {
  const [prefs, setPref] = usePrefs();
  const [draft, setDraft] = useState(String(Math.round(prefs.requestTimeoutMs / 1000)));
  useEffect(() => {
    setDraft(String(Math.round(prefs.requestTimeoutMs / 1000)));
  }, [prefs.requestTimeoutMs]);
  const commit = () => {
    const ms = clampTimeoutMs(Number(draft) * 1000);
    setPref("requestTimeoutMs", ms);
    setDraft(String(Math.round(ms / 1000)));
  };
  return (
    <SettingsRow
      title={t.requestDeadline}
      hint={t.requestDeadlineHint}
      control={
        <div className="flex items-center gap-1">
          <Input
            aria-label={t.requestDeadline}
            type="number"
            min={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className="w-20 h-8 font-mono text-xs"
          />
          <span className="text-xs text-muted-foreground">{t.seconds}</span>
        </div>
      }
    />
  );
}

function MaxMessageSizeRow() {
  const [prefs, setPref] = usePrefs();
  const index = stopIndexFor(prefs.maxMessageBytes);
  const bytes = MESSAGE_SIZE_STOPS[index];
  const readout = bytes === 0 ? t.unlimited : formatMessageSize(bytes);
  return (
    <SettingsRow
      title={t.maxMessageSize}
      hint={bytes === 0 ? t.unlimitedHint : t.maxMessageSizeHint}
      control={
        <div className="flex items-center gap-3 w-[180px]">
          <Slider
            thumbLabel={t.maxMessageSize}
            min={0}
            max={MESSAGE_SIZE_STOPS.length - 1}
            step={1}
            value={[index]}
            onValueChange={([i]) => setPref("maxMessageBytes", MESSAGE_SIZE_STOPS[i])}
            className="flex-1"
          />
          <span className="text-xs font-mono text-muted-foreground w-16 text-right">
            {readout}
          </span>
        </div>
      }
    />
  );
}

export function NetworkPane() {
  return (
    <>
      <SettingsGroup title={t.timeoutsGroup}>
        <RequestDeadlineRow />
      </SettingsGroup>
      <SettingsGroup title={t.messageSizeGroup}>
        <MaxMessageSizeRow />
      </SettingsGroup>
    </>
  );
}
