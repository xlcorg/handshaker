import { Columns2, Minus, PanelLeft, RefreshCw, Rows2, Settings, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrefs } from "@/lib/use-prefs";
import { isMacOS } from "@/lib/platform";
import { useIsFullscreen } from "@/lib/use-fullscreen";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
import type { UpdatePhase } from "@/features/updater/useUpdateCheck";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";
import { compactFocusRing } from "@/lib/focusRing";
import { messages } from "@/lib/messages";
import { Kbd } from "@/components/ui/kbd";
import { nextSplit } from "@/features/shell/splitDirection";

const btn =
  `h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground ${compactFocusRing}`;

/**
 * Единый титлбар: лого + workflow/env слева, view-switcher по центру, утилиты
 * справа. Весь бар — drag-зона (`data-tauri-drag-region`); атрибут не наследуется
 * детьми, поэтому продублирован на неинтерактивных зонах.
 *
 * Платформа:
 * - Windows/Linux — фреймлес окно, кастомные min/max/close справа + wordmark.
 * - macOS — нативный «светофор» (Tauri TitleBarStyle::Overlay) слева: добавляем
 *   левый инсет под него (схлопывается в fullscreen), убираем wordmark и кнопки
 *   окна.
 */
export function Titlebar({
  onOpenSettings,
  onCheckForUpdates,
  updatePhase,
  updateAvailable,
}: {
  onOpenSettings: () => void;
  onCheckForUpdates?: () => void;
  updatePhase?: UpdatePhase;
  updateAvailable?: boolean;
}) {
  const updateBusy = updatePhase === "checking" || updatePhase === "downloading";
  const [prefs, setPref] = usePrefs();
  const fullscreen = useIsFullscreen();
  const showTrafficInset = isMacOS && !fullscreen;
  // ⌥V на macOS печатает символ → используем ⌥⌘V (см. features/shell/splitDirection.ts).
  const splitKeys = isMacOS ? ["⌥", "⌘", "V"] : ["Alt", "V"];

  return (
    <div
      data-tauri-drag-region
      className="grid h-9 flex-none grid-cols-[1fr_auto_1fr] items-center gap-2 bg-card border-b border-border px-2.5 select-none relative z-40"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 min-w-0 justify-self-start">
        {/* Width covers the native traffic-light cluster anchored at
            trafficLightPosition.x in src-tauri/tauri.macos.conf.json — keep in sync. */}
        {showTrafficInset && <span data-tauri-drag-region aria-hidden data-testid="mac-traffic-inset" className="w-[70px] flex-none" />}
        {!isMacOS && (
          <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight text-foreground">
            Handshaker
          </span>
        )}
        <WorkflowSelector />
        <WorkflowEnvControl />
      </div>

      <div className="justify-self-center">
        <ViewSwitcher />
      </div>

      <div data-tauri-drag-region className="flex items-center gap-0.5 justify-self-end">
        <Tooltip content={messages.shell.titlebar.toggleSidebar} side="bottom">
          <button type="button" onClick={() => setPref("sidebar", !prefs.sidebar)} className={btn} aria-label={messages.shell.titlebar.toggleSidebar}>
            <PanelLeft size={13} />
          </button>
        </Tooltip>
        <Tooltip
          content={
            <span>
              {messages.shell.titlebar.splitDirectionTooltip(prefs.split)}{" "}
              {splitKeys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          }
          side="bottom"
        >
          <button
            type="button"
            onClick={() => setPref("split", nextSplit(prefs.split))}
            className={btn}
            aria-label={messages.shell.titlebar.splitDirection}
          >
            {prefs.split === "horizontal" ? <Rows2 size={13} /> : <Columns2 size={13} />}
          </button>
        </Tooltip>
        {onCheckForUpdates && (
          <Tooltip
            content={updateBusy ? messages.shell.titlebar.checkingForUpdates : updateAvailable ? messages.shell.titlebar.updateAvailable : messages.shell.titlebar.checkForUpdates}
            side="bottom"
          >
            <button
              type="button"
              onClick={onCheckForUpdates}
              disabled={updateBusy}
              className={`${btn} relative disabled:opacity-50`}
              aria-label={messages.shell.titlebar.checkForUpdates}
            >
              <RefreshCw size={13} className={updateBusy ? "animate-spin" : undefined} />
              {updateAvailable && (
                <span
                  aria-hidden
                  data-testid="update-available-dot"
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-1 ring-card"
                />
              )}
            </button>
          </Tooltip>
        )}
        <Tooltip content={messages.shell.titlebar.settings} side="bottom">
          <button type="button" onClick={onOpenSettings} className={btn} aria-label={messages.shell.titlebar.settings}>
            <Settings size={13} />
          </button>
        </Tooltip>
        {!isMacOS && (
          <>
            <span className="h-3.5 w-px bg-border mx-1" />
            <Tooltip content={messages.shell.titlebar.minimize} side="bottom">
              <button type="button" onClick={() => getCurrentWindow().minimize()} className={btn} aria-label={messages.shell.titlebar.minimizeWindow}>
                <Minus size={11} strokeWidth={1.5} />
              </button>
            </Tooltip>
            <Tooltip content={messages.shell.titlebar.maximize} side="bottom">
              <button type="button" onClick={() => getCurrentWindow().toggleMaximize()} className={btn} aria-label={messages.shell.titlebar.maximizeWindow}>
                <Square size={9} strokeWidth={1.5} />
              </button>
            </Tooltip>
            <Tooltip content={messages.shell.titlebar.close} side="bottom">
              <button
                type="button"
                onClick={() => getCurrentWindow().close()}
                className={`h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground ${compactFocusRing}`}
                aria-label={messages.shell.titlebar.closeWindow}
              >
                <X size={11} strokeWidth={1.5} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
