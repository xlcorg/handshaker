# macOS Titlebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать macOS отдельный идиоматичный стиль титлбара — нативный «светофор» (traffic lights) слева через Tauri `TitleBarStyle::Overlay`, без кастомных кнопок окна и без wordmark; Windows/Linux не меняются.

**Architecture:** Две точки ветвления. (1) Build-time: новый `tauri.macos.conf.json` авто-мерджится поверх базового конфига на macOS-сборках (RFC 7396) и включает `decorations:true` + `titleBarStyle:Overlay` + `trafficLightPosition`. (2) Runtime: синхронный `isMacOS` (по `navigator.userAgent`) + хук `useIsFullscreen` управляют ветвлением вёрстки в одном `Titlebar.tsx`.

**Tech Stack:** Tauri 2, React 18, TypeScript, Tailwind, Vitest + @testing-library/react.

**Спек:** [docs/superpowers/specs/2026-06-08-macos-titlebar-design.md](../specs/2026-06-08-macos-titlebar-design.md)

**Команды:** тест одного файла — `pnpm vitest run <path>`; все тесты — `pnpm test`; типы/линт — `pnpm lint`; сборка фронта — `pnpm build`. (Память: vitest ≠ tsc — зелёный тест не гарантирует компиляцию типов, проверяй оба.)

---

## File Structure

- **Create** `src/lib/platform.ts` — синхронный детект ОС (`isMacOS` + чистый хелпер `isMacOSUA`).
- **Create** `src/lib/platform.test.ts` — тест чистого хелпера.
- **Create** `src/lib/use-fullscreen.ts` — хук `useIsFullscreen()` поверх Tauri window API.
- **Create** `src/lib/use-fullscreen.test.ts` — тест хука (initial + resize-перезапрос).
- **Create** `src-tauri/tauri.macos.conf.json` — macOS-оверрайды окна.
- **Create** `src/features/shell/tauri-config-parity.test.ts` — guard: macOS-окно = base-геометрия + overlay-поля.
- **Modify** `src/features/shell/Titlebar.tsx` — ветвление по `isMacOS`/fullscreen.
- **Modify** `src/features/shell/Titlebar.test.tsx` — три describe-блока (common / Windows-Linux / macOS).

---

## Task 1: Platform detection (`isMacOS`)

**Files:**
- Create: `src/lib/platform.ts`
- Test: `src/lib/platform.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/platform.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isMacOSUA } from "./platform";

describe("isMacOSUA", () => {
  it("is true for a macOS WKWebView user-agent", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(isMacOSUA(ua)).toBe(true);
  });

  it("is false for a Windows user-agent", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    expect(isMacOSUA(ua)).toBe(false);
  });

  it("is false for a Linux user-agent", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
    expect(isMacOSUA(ua)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/platform.test.ts`
Expected: FAIL — `Failed to resolve import "./platform"` / `isMacOSUA is not a function`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/platform.ts`:

```ts
/** Pure OS check over a user-agent string. WKWebView (macOS) and Edge WebView2
 *  (Windows) both put the OS family in the UA, so this is reliable inside Tauri. */
export function isMacOSUA(ua: string): boolean {
  return ua.includes("Macintosh") || ua.includes("Mac OS");
}

/** true on macOS. Evaluated synchronously at import — no async flash. The
 *  @tauri-apps/plugin-os `platform()` is async and would flicker the window
 *  buttons on first paint, so we read the UA instead. */
export const isMacOS = isMacOSUA(navigator.userAgent);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/platform.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform.ts src/lib/platform.test.ts
git commit -m "feat(platform): synchronous isMacOS detection via user-agent"
```

---

## Task 2: `useIsFullscreen` hook

**Files:**
- Create: `src/lib/use-fullscreen.ts`
- Test: `src/lib/use-fullscreen.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/use-fullscreen.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const isFullscreen = vi.fn();
const onResized = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen, onResized }),
}));

import { useIsFullscreen } from "./use-fullscreen";

beforeEach(() => {
  vi.clearAllMocks();
  isFullscreen.mockResolvedValue(false);
  onResized.mockResolvedValue(() => {});
});

describe("useIsFullscreen", () => {
  it("reports the initial fullscreen state", async () => {
    isFullscreen.mockResolvedValue(true);
    const { result } = renderHook(() => useIsFullscreen());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("re-queries fullscreen on resize", async () => {
    isFullscreen.mockResolvedValue(false);
    let resizeCb: () => void = () => {};
    onResized.mockImplementation((cb: () => void) => {
      resizeCb = cb;
      return Promise.resolve(() => {});
    });
    const { result } = renderHook(() => useIsFullscreen());
    await waitFor(() => expect(result.current).toBe(false));

    isFullscreen.mockResolvedValue(true);
    resizeCb();
    await waitFor(() => expect(result.current).toBe(true));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/use-fullscreen.test.ts`
Expected: FAIL — `Failed to resolve import "./use-fullscreen"`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/use-fullscreen.ts`:

```ts
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Tracks the window's fullscreen state. On macOS the native traffic lights hide
 *  in fullscreen, so the titlebar drops its left inset. Tauri emits no dedicated
 *  fullscreen event, but `onResized` fires on enter/exit — we re-query there. */
export function useIsFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let active = true;
    let unlisten: (() => void) | undefined;

    const sync = () => {
      void win.isFullscreen().then((v) => {
        if (active) setFullscreen(v);
      });
    };

    sync();
    void win.onResized(sync).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return fullscreen;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/use-fullscreen.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-fullscreen.ts src/lib/use-fullscreen.test.ts
git commit -m "feat(window): useIsFullscreen hook for macOS traffic-light inset"
```

---

## Task 3: macOS window config

**Files:**
- Create: `src-tauri/tauri.macos.conf.json`
- Test: `src/features/shell/tauri-config-parity.test.ts`

- [ ] **Step 1: Write the failing test**

`src/features/shell/tauri-config-parity.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// vitest runs with the repo root as cwd.
const base = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const mac = JSON.parse(readFileSync("src-tauri/tauri.macos.conf.json", "utf8"));

const baseWin = base.app.windows[0];
const macWin = mac.app.windows[0];

describe("tauri.macos.conf.json", () => {
  it("enables native traffic lights via Overlay", () => {
    expect(macWin.decorations).toBe(true);
    expect(macWin.titleBarStyle).toBe("Overlay");
    expect(macWin.trafficLightPosition).toBeTruthy();
  });

  // RFC 7396 replaces arrays wholesale, so the macOS window object must repeat
  // every geometry field from the base — this guards against drift.
  it("keeps window geometry in sync with the base config", () => {
    const keys = [
      "label", "title", "width", "height", "minWidth",
      "minHeight", "resizable", "fullscreen", "dragDropEnabled",
    ];
    for (const k of keys) {
      expect(macWin[k]).toEqual(baseWin[k]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/shell/tauri-config-parity.test.ts`
Expected: FAIL — `ENOENT ... tauri.macos.conf.json`.

- [ ] **Step 3: Create the config file**

`src-tauri/tauri.macos.conf.json`:

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Handshaker",
        "width": 1280,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "dragDropEnabled": false,
        "decorations": true,
        "titleBarStyle": "Overlay",
        "trafficLightPosition": { "x": 14, "y": 11 }
      }
    ]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/shell/tauri-config-parity.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.macos.conf.json src/features/shell/tauri-config-parity.test.ts
git commit -m "feat(tauri): macOS window config — Overlay titlebar + traffic lights"
```

---

## Task 4: Branch `Titlebar.tsx` by platform

**Files:**
- Modify: `src/features/shell/Titlebar.tsx`
- Modify: `src/features/shell/Titlebar.test.tsx`

- [ ] **Step 1: Rewrite the test file with three describe blocks**

Replace the entire contents of `src/features/shell/Titlebar.test.tsx` with:

```tsx
import type * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isFullscreen: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
  }),
}));
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

// isMacOS is a const evaluated at import; expose it through a getter so each
// describe block can flip the platform before rendering.
let mockIsMacOS = false;
vi.mock("@/lib/platform", () => ({
  get isMacOS() {
    return mockIsMacOS;
  },
}));

import { Titlebar } from "./Titlebar";
import { workflowStore } from "@/features/workflow/store";

// Titlebar uses <Tooltip>, which (like main.tsx) requires a TooltipProvider.
function render(ui: React.ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("Titlebar (both platforms)", () => {
  beforeEach(() => {
    mockIsMacOS = false;
  });

  it("renders workflow selector, env control and the English view switcher", async () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
    expect(await screen.findByText("No environment")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Focus" })).toBeInTheDocument();
  });

  it("makes the bar a Tauri drag region", () => {
    const { container } = render(<Titlebar onOpenSettings={() => {}} />);
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  });

  it("calls onOpenSettings when the settings button is clicked", async () => {
    const onOpenSettings = vi.fn();
    const user = userEvent.setup();
    render(<Titlebar onOpenSettings={onOpenSettings} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe("Titlebar on Windows/Linux", () => {
  beforeEach(() => {
    mockIsMacOS = false;
  });

  it("renders the custom window control buttons", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Minimize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });

  it("shows the Handshaker wordmark", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByText("Handshaker")).toBeInTheDocument();
  });
});

describe("Titlebar on macOS", () => {
  beforeEach(() => {
    mockIsMacOS = true;
  });

  it("omits the custom window control buttons (native traffic lights instead)", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.queryByRole("button", { name: "Minimize window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Maximize window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close window" })).toBeNull();
  });

  it("omits the Handshaker wordmark", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.queryByText("Handshaker")).toBeNull();
  });

  it("still renders the sidebar/theme/settings utilities", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: FAIL — the macOS block fails (current component always renders window buttons + wordmark).

- [ ] **Step 3: Rewrite `Titlebar.tsx` with platform branching**

Replace the entire contents of `src/features/shell/Titlebar.tsx` with:

```tsx
import { Minus, Moon, PanelLeft, Settings, Square, Sun, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrefs } from "@/lib/use-prefs";
import { cn } from "@/lib/cn";
import { isMacOS } from "@/lib/platform";
import { useIsFullscreen } from "@/lib/use-fullscreen";
import { WorkflowSelector } from "@/features/workflow/WorkflowSelector";
import { WorkflowEnvControl } from "@/features/workflow/WorkflowEnvControl";
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
export function Titlebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [prefs, setPref] = usePrefs();
  const fullscreen = useIsFullscreen();
  const showTrafficInset = isMacOS && !fullscreen;

  return (
    <div
      data-tauri-drag-region
      className="grid h-9 flex-none grid-cols-[1fr_auto_1fr] items-center gap-2 bg-card border-b border-border px-2.5 select-none relative z-40"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5 min-w-0 justify-self-start">
        {showTrafficInset && <span data-tauri-drag-region aria-hidden className="w-[70px] flex-none" />}
        <span data-tauri-drag-region className="flex items-center gap-1.5">
          <LogoMark size={13} className="text-foreground/85" />
          {!isMacOS && (
            <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight text-foreground">
              Handshaker
            </span>
          )}
        </span>
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

function LogoMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(className)}
      aria-hidden
    >
      <path d="M4 9 L9 4 L13 8" />
      <path d="M20 15 L15 20 L11 16" />
      <path d="M8 12 L12 8 L16 12 L12 16 Z" />
    </svg>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: PASS (all three describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/Titlebar.tsx src/features/shell/Titlebar.test.tsx
git commit -m "feat(titlebar): macOS layout — drop window buttons/wordmark, traffic-light inset"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: PASS — no regressions across the suite.

- [ ] **Step 2: Typecheck / lint**

Run: `pnpm lint`
Expected: clean (tsc -b, no errors). (vitest ≠ tsc — this is the real type gate.)

- [ ] **Step 3: Build the frontend**

Run: `pnpm build`
Expected: success (`tsc -b && vite build`).

- [ ] **Step 4: Manual macOS check (deferred to a human on a Mac)**

Not runnable in CI / on Windows. On a Mac, `pnpm tauri dev` and confirm:
- нативный «светофор» слева, вертикально отцентрирован в баре (подстрой
  `trafficLightPosition.y` в `tauri.macos.conf.json` при необходимости);
- лого/Workflow не наезжают на светофор; нет wordmark и кнопок min/max/close;
- бар перетаскивается, двойной клик — zoom;
- вход/выход из fullscreen: левый инсет появляется/исчезает без дыры.

- [ ] **Step 5: Final commit (if `trafficLightPosition` tuned)**

```bash
git add src-tauri/tauri.macos.conf.json
git commit -m "chore(titlebar): tune macOS traffic-light position"
```

---

## Self-review notes

- **Spec coverage:** Overlay-конфиг (Task 3) ✓; isMacOS-детект (Task 1) ✓; минималистичная вёрстка без wordmark/кнопок (Task 4) ✓; плотный фон `bg-card` (Task 4, без vibrancy) ✓; fullscreen edge case (Task 2 + Task 4 `showTrafficInset`) ✓; переработка тестов на две платформы (Task 4) ✓; RFC7396 array-replace guard (Task 3 parity-тест) ✓.
- **Type consistency:** `isMacOS`/`isMacOSUA` (platform.ts), `useIsFullscreen` (use-fullscreen.ts) — имена совпадают между задачами и импортами в Titlebar.tsx и тестах.
- **YAGNI:** кастомный светофор, vibrancy, настройка-переключатель, Linux-специфика — вне scope (Linux идёт по Windows-ветке).
