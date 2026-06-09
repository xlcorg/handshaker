import { Minus, Moon, PanelLeft, RefreshCw, Settings, Square, Sun, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrefs } from "@/lib/use-prefs";
import { isMacOS } from "@/lib/platform";
import { useIsFullscreen } from "@/lib/use-fullscreen";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
import type { UpdatePhase } from "@/features/updater/useUpdateCheck";
import { ViewSwitcher } from "@/features/workflow/ViewSwitcher";

const btn =
  "h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground";

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
        <Tooltip content="Toggle sidebar" side="bottom">
          <button type="button" onClick={() => setPref("sidebar", !prefs.sidebar)} className={btn} aria-label="Toggle sidebar">
            <PanelLeft size={13} />
          </button>
        </Tooltip>
        <Tooltip content={prefs.theme === "dark" ? "Light mode" : "Dark mode"} side="bottom">
          <button
            type="button"
            onClick={() => setPref("theme", prefs.theme === "dark" ? "light" : "dark")}
            className={btn}
            aria-label="Toggle theme"
          >
            {prefs.theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </Tooltip>
        {onCheckForUpdates && (
          <Tooltip
            content={updateBusy ? "Checking for updates…" : updateAvailable ? "Update available" : "Check for updates"}
            side="bottom"
          >
            <button
              type="button"
              onClick={onCheckForUpdates}
              disabled={updateBusy}
              className={`${btn} relative disabled:opacity-50`}
              aria-label="Check for updates"
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
        <Tooltip content="Settings" side="bottom">
          <button type="button" onClick={onOpenSettings} className={btn} aria-label="Settings">
            <Settings size={13} />
          </button>
        </Tooltip>
        {!isMacOS && (
          <>
            <span className="h-3.5 w-px bg-border mx-1" />
            <Tooltip content="Minimize" side="bottom">
              <button type="button" onClick={() => getCurrentWindow().minimize()} className={btn} aria-label="Minimize window">
                <Minus size={11} strokeWidth={1.5} />
              </button>
            </Tooltip>
            <Tooltip content="Maximize" side="bottom">
              <button type="button" onClick={() => getCurrentWindow().toggleMaximize()} className={btn} aria-label="Maximize window">
                <Square size={9} strokeWidth={1.5} />
              </button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <button
                type="button"
                onClick={() => getCurrentWindow().close()}
                className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                aria-label="Close window"
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
